// ==============================================================================================
// MÀN NỘP THẦU — mã này chạy trên máy NHÀ CUNG CẤP.
//
// Nó import `sealBid` từ chính `packages/sealed-envelope/src/seal.ts` (máy chủ gỡ kiểu rồi phục
// vụ nguyên văn). Không có bản cài thứ hai của định dạng phong bì ở đây, và đó là điểm quan
// trọng nhất của tệp này: thứ trình duyệt chạy là thứ `roundtrip.test.ts` đo.
//
// Bốn điều tệp này CỐ Ý không làm:
//   * không gửi giá dạng rõ đi đâu cả — `fetch` duy nhất mang giá là lần POST phong bì ĐÃ mã hoá;
//   * không kiểm hạn nộp bằng đồng hồ máy này (ADR-005: phán quyết thuộc về `now()` của Postgres);
//     [khoản 196] và cũng không ĐẾM ngược bằng đồng hồ máy này trần: nó đếm theo giờ máy chủ ước
//     tính — giờ máy này cộng độ lệch đo được từ `gioMayChu` của `GET /guest/rfq`;
//   * không tự đoán thuật toán — hỏi trình duyệt làm được gì, rồi giao cho
//     `chooseKeyAgreementAlgorithm` của gói quyết (ADR-011 mục 1);
//   * không giấu lỗi. Một trình duyệt không có `crypto.subtle` được nói thẳng, vì đó là rủi ro
//     sản phẩm số 3 đã ghi trong `docs/PRODUCT.md` §8.
// ==============================================================================================

import { chooseKeyAgreementAlgorithm, describeEnvelope, sealBid } from "/lib/browser.js";
import { cong, donGiaNguoiGo, thanhTien, tien } from "/lib/so-tien.js";
import { conLaiMs, doLechMayChu, docDauThoiGian, moTaConLai, moTaLechMay } from "/lib/dong-ho-may-chu.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

let phien = { orgId: "", token: "", rfq: null, items: [], publicKeys: [] };

// ---------------------------------------------------------------------------------------------
// Nền tảng
// ---------------------------------------------------------------------------------------------

async function goi(method, duong, than) {
  const res = await fetch(`/api${duong}`, {
    method,
    credentials: "same-origin",
    headers: than === undefined ? {} : { "content-type": "application/json" },
    body: than === undefined ? undefined : JSON.stringify(than),
  });
  const chu = await res.text();
  let body = null;
  try { body = chu === "" ? null : JSON.parse(chu); } catch { body = null; }
  return { status: res.status, body, chu };
}

function loiCua(r, macDinh) {
  if (r.body !== null && typeof r.body === "object" && typeof r.body.error === "string") return r.body.error;
  return `${macDinh} (mã ${r.status})`;
}

const tuB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function sangB64(u8) {
  let s = "";
  // Cắt khúc thay vì `String.fromCharCode(...u8)`: một phong bì vài chục KiB làm bản trải phẳng
  // vượt trần số đối số của hàm và ném `RangeError` — đúng loại lỗi chỉ hiện ra với dữ liệu thật.
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Hỏi trình duyệt — không đọc chuỗi user-agent, vì user-agent nói về tên, không nói về khả năng. */
async function trinhDuyetLamDuocGi() {
  const ra = [];
  try {
    await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    ra.push("X25519");
  } catch { /* không có thì thôi — đây chính là phép dò */ }
  try {
    await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    ra.push("ECDH_P256");
  } catch { /* như trên */ }
  return ra;
}

// ---------------------------------------------------------------------------------------------
// Số tiền — [S1.99 / khoản 206] MỘT BẢN CÀI, Ở `apps/web/src/so-tien.ts`
//
// Phép tính từng nằm nội tuyến ngay đây, và vì nó nằm ở một tệp `.js` ngoài `tsconfig.json`
// trong một thư mục không có test nào, nó mang hai khiếm khuyết im lặng suốt từ S1.89: đơn giá
// `1.500` đọc thành MỘT (dấu chấm bị đọc là dấu thập phân trong khi chính trang này in dấu chấm
// là dấu NGHÌN ở dòng tổng), và mọi phần lẻ thừa bị cắt cụt không một lời nào.
//
// Nay nó sống ở `apps/web/src/so-tien.ts`: tsc gác, `so-tien.test.ts` đo 40 ca, và máy chủ gỡ
// kiểu phục vụ đúng tệp ấy ở `/lib/so-tien.js`. Cùng nguyên tắc mà khối mở đầu tệp này đã viết
// cho `sealBid` — thứ trình duyệt chạy là thứ test đo.
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Bước 1 — mở lời mời
// ---------------------------------------------------------------------------------------------

function docLink() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) return;
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}

$("nut-mo").addEventListener("click", async () => {
  bao($("loi1"), "");
  const orgId = $("org").value.trim();
  const token = $("token").value.trim();
  if (orgId === "" || token === "") { bao($("loi1"), "Cần cả mã tổ chức và mã lời mời."); return; }
  $("nut-mo").disabled = true;
  const r = await goi("POST", "/guest/redeem", { orgId, token });
  $("nut-mo").disabled = false;
  if (r.status !== 200) { bao($("loi1"), loiCua(r, "Không mở được lời mời")); return; }
  phien = { ...phien, orgId, token };
  bao($("ok1"), `Lời mời hợp lệ. Link được gửi qua ${r.body.linkChannel}.`);
  const kenh = $("kenh");
  kenh.replaceChildren();
  for (const k of r.body.otpChannels ?? []) {
    const o = document.createElement("option");
    o.value = k; o.textContent = k;
    kenh.append(o);
  }
  $("b1").classList.add("xong");
  hien($("b2"), true);
  $("ma").focus();
});

// ---------------------------------------------------------------------------------------------
// Bước 2 — OTP
// ---------------------------------------------------------------------------------------------

$("nut-gui").addEventListener("click", async () => {
  bao($("loi2"), "");
  const r = await goi("POST", "/guest/otp", { orgId: phien.orgId, token: phien.token, channel: $("kenh").value });
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không gửi được mã")); return; }
  bao($("ok2"), "Đã gửi. Mã có sáu chữ số và hết hạn nhanh.");
});

$("nut-xac").addEventListener("click", async () => {
  bao($("loi2"), "");
  const code = $("ma").value.trim();
  if (!/^\d{6}$/.test(code)) { bao($("loi2"), "Mã phải là sáu chữ số."); return; }
  $("nut-xac").disabled = true;
  const r = await goi("POST", "/guest/otp/verify", { orgId: phien.orgId, token: phien.token, code });
  $("nut-xac").disabled = false;
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Mã không đúng")); return; }
  bao($("ok2"), "Đã xác minh. Phiên nằm trong cookie, mã phiên không đi qua JavaScript.");
  $("b2").classList.add("xong");
  await napGoiThau();
});

// ---------------------------------------------------------------------------------------------
// Bước 3 — gói thầu và bảng giá
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// [khoản 196 / ADR-072 phần 3] ĐẾM NGƯỢC THEO GIỜ MÁY CHỦ
//
// `lechMayChu` là giờ máy chủ trừ giờ máy này, đo MỘT lần ở lời gọi `GET /guest/rfq` (so với điểm
// giữa khứ hồi — `doLechMayChu`). Mỗi giây trang tính lại *còn bao lâu* từ giờ máy này CỘNG độ lệch,
// nên một máy chạy chậm mười phút không thấy "còn mười phút" lúc hệ thống đã đóng cửa. Không đo
// được (trường hỏng) ⇒ không đếm, chỉ in hạn — không đoán. Nút nộp KHÔNG bị khoá theo phép đếm này:
// phán quyết vẫn thuộc về CSDL.
// ---------------------------------------------------------------------------------------------
let lechMayChu = null;
let henDemNguoc = null;

function demNguoc(han) {
  if (henDemNguoc !== null) window.clearInterval(henDemNguoc);
  henDemNguoc = null;
  const el = $("dem-nguoc");
  if (lechMayChu === null || han === null) { bao(el, ""); return; }
  const ve = () => {
    const canhBao = moTaLechMay(lechMayChu);
    el.textContent = `${moTaConLai(conLaiMs(han, lechMayChu, Date.now()))} (theo giờ hệ thống)` + (canhBao === "" ? "" : ` — ${canhBao}`);
    hien(el, true);
  };
  ve();
  henDemNguoc = window.setInterval(ve, 1000);
}

/** Giờ dạng chính tắc của máy chủ → chuỗi đọc được theo múi giờ của máy này (chỉ đổi MÚI, không đổi GIỜ). */
function gioDoc(chuoi) {
  const ms = docDauThoiGian(chuoi);
  return ms === null ? String(chuoi) : new Date(ms).toLocaleString("vi-VN");
}

async function napGoiThau() {
  const guiLuc = Date.now();
  const r = await goi("GET", "/guest/rfq");
  const nhanLuc = Date.now();
  if (r.status !== 200) { bao($("loi3"), loiCua(r, "Không đọc được gói thầu")); hien($("b3"), true); return; }
  phien = { ...phien, rfq: r.body.rfq, items: r.body.items ?? [], publicKeys: r.body.publicKeys ?? [], bafoRound: r.body.bafoRound ?? null };

  // [S1.109 / S2.5 / khoản 227⑶] HẠN NÀO LÀ HẠN ĐANG CÓ HIỆU LỰC.
  //
  // `rfq.deadlineAt` là hạn VÒNG MỘT, và suốt `BAFO_OPEN` nó đã ở QUÁ KHỨ — nó không cập nhật
  // được (vế (b) của bảng cạnh cấm deadline lùi, vế (c) chỉ cho đổi ở `DRAFT`/`OPEN`), và chính
  // vì thế `059` tách hạn BAFO sang bảng riêng. In thẳng `rfq.deadlineAt` trong lúc có vòng BAFO
  // là để màn hình nói một hạn đã qua trong khi người đọc nó vẫn nộp được.
  const vong = phien.bafoRound;
  const han = new Date(vong === null ? phien.rfq.deadlineAt : vong.deadlineAt);
  $("tt-rfq").replaceChildren();
  const dong = [["Gói thầu", phien.rfq.title], ["Trạng thái", phien.rfq.status]];
  if (vong !== null) {
    dong.push(["Vòng", `BAFO ${vong.roundNo} — mời nộp lại, niêm phong như vòng một`]);
    dong.push(["Hạn nộp của vòng này", han.toLocaleString("vi-VN")]);
    dong.push(["Hạn vòng một", new Date(phien.rfq.deadlineAt).toLocaleString("vi-VN")]);
  } else {
    dong.push(["Hạn nộp", han.toLocaleString("vi-VN")]);
  }
  lechMayChu = doLechMayChu(r.body.gioMayChu, guiLuc, nhanLuc);
  if (lechMayChu !== null) dong.push(["Giờ hệ thống lúc tải", gioDoc(r.body.gioMayChu)]);
  for (const [k, v] of dong) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    $("tt-rfq").append(dt, dd);
  }
  demNguoc(Number.isFinite(han.getTime()) ? han.getTime() : null);

  const tbody = $("bang-hang").querySelector("tbody");
  tbody.replaceChildren();
  for (const it of phien.items) {
    const tr = document.createElement("tr");
    const td = (chu, lop) => { const x = document.createElement("td"); x.textContent = chu; if (lop) x.className = lop; return x; };
    const o = document.createElement("input");
    o.inputMode = "numeric"; o.autocomplete = "off"; o.placeholder = "0"; o.dataset.lineNo = String(it.lineNo);
    o.addEventListener("input", tinhLai);
    const tdGia = document.createElement("td"); tdGia.className = "so"; tdGia.append(o);
    tr.append(td(`${it.lineNo}. ${it.description}`), td(String(Number(it.quantity)), "so"), td(it.unit ?? ""), tdGia);
    tbody.append(tr);
  }
  tinhLai();
  hien($("b3"), true);
  $("b3").scrollIntoView({ behavior: "smooth", block: "start" });
}

function dongTien() {
  const ra = [];
  for (const o of $("bang-hang").querySelectorAll("input[data-line-no]")) {
    const it = phien.items.find((x) => String(x.lineNo) === o.dataset.lineNo);
    // [S1.99 / khoản 206] `unitPrice` đi vào phong bì là dạng ĐÃ CHUẨN HOÁ, không phải chuỗi thô.
    // Bản cũ đẩy nguyên thứ người dùng gõ vào `unitPrice` còn `amount` thì tính ra, nên một ô ghi
    // `1.500` niêm phong thành `unitPrice "1.500"` cạnh `amount "1.00"` — hai con số tự cãi nhau
    // trong một phong bì không mở lại được để sửa.
    const chuan = donGiaNguoiGo(o.value);
    ra.push({
      lineNo: it.lineNo,
      unitPrice: chuan,
      amount: chuan === null ? null : thanhTien(it.quantity, chuan),
    });
  }
  return ra;
}

/** Ô đơn giá đầu tiên có chữ mà KHÔNG đọc được — để nói ra ô nào, chứ không chỉ nói "chưa đủ". */
function donGiaKhongDocDuoc() {
  for (const o of $("bang-hang").querySelectorAll("input[data-line-no]")) {
    const go = o.value.trim();
    if (go !== "" && donGiaNguoiGo(go) === null) return go;
  }
  return null;
}

function tinhLai() {
  const d = dongTien();
  const thieu = d.some((x) => x.amount === null);
  const tong = thieu ? null : cong(d.map((x) => x.amount));
  const hong = donGiaKhongDocDuoc();
  $("tong").textContent =
    tong !== null
      ? `Tổng: ${tien(tong)} ${$("tien-te").value.trim() || "VND"}`
      : hong !== null
        ? `Đơn giá "${hong}" không đọc được. Đơn giá là số nguyên đồng, và dấu chấm chỉ dùng để nhóm nghìn — viết 1.500.000 hoặc 1500000.`
        : "Nhập đơn giá cho tất cả hạng mục để ra tổng.";
  $("nut-nop").disabled = tong === null;
  return tong;
}

$("tien-te").addEventListener("input", tinhLai);

// ---------------------------------------------------------------------------------------------
// Bước 4 — niêm phong và nộp
// ---------------------------------------------------------------------------------------------

$("nut-nop").addEventListener("click", async () => {
  bao($("loi3"), "");
  const tong = tinhLai();
  if (tong === null) return;
  $("nut-nop").disabled = true;
  try {
    if (globalThis.crypto?.subtle === undefined) {
      throw new Error("Trình duyệt này không có crypto.subtle — thường gặp ở cửa sổ web trong Zalo hay Messenger. Hãy mở link bằng Chrome hoặc Safari.");
    }
    const lamDuoc = await trinhDuyetLamDuocGi();
    const thuatToan = chooseKeyAgreementAlgorithm(phien.publicKeys.map((k) => k.algorithm), lamDuoc);
    const khoa = phien.publicKeys.find((k) => k.algorithm === thuatToan);

    const banRo = {
      totalAmount: tong,
      currency: $("tien-te").value.trim() || "VND",
      lines: dongTien(),
    };
    const phongBi = await sealBid({
      rfqId: phien.rfq.id,
      algorithm: thuatToan,
      recipientPublicKey: tuB64(khoa.publicKey),
      plaintext: new TextEncoder().encode(JSON.stringify(banRo)),
    });

    const r = await goi("POST", "/guest/bids", { envelope: sangB64(phongBi) });
    if (r.status !== 201) {
      // [khoản 196 / ADR-072 phần 2] Lần chặn VÌ HẠN mang giờ hệ thống lúc phán xử và hạn đã so —
      // in cả hai, để người bị chặn đối chiếu được với đồng hồ của mình và với hạn trên màn hình.
      const b = r.body;
      const viHan = r.status === 422 && b !== null && typeof b === "object" && typeof b.gioPhanXu === "string" && typeof b.hanNop === "string";
      bao(
        $("loi3"),
        viHan
          ? `${b.error} Giờ hệ thống lúc phán xử: ${gioDoc(b.gioPhanXu)} (${b.gioPhanXu}). Hạn nộp: ${gioDoc(b.hanNop)} (${b.hanNop}). ` +
            "Hệ thống đã ghi lại lần nộp bị chặn này."
          : loiCua(r, "Không nộp được"),
      );
      $("nut-nop").disabled = false;
      return;
    }
    veBienNhan(r.body.receipt, phongBi, thuatToan, khoa.keyVersion);
  } catch (e) {
    bao($("loi3"), e instanceof Error ? e.message : "Niêm phong thất bại");
    $("nut-nop").disabled = false;
  }
});

function veBienNhan(bn, phongBi, thuatToan, phienBanKhoa) {
  const h = describeEnvelope(phongBi);
  $("tt-bn").replaceChildren();
  const hang = [
    ["Mã bản nộp", bn.bidVersionId],
    ["Lần nộp", `#${bn.version}`],
    ["Thời điểm", new Date(bn.submittedAt).toLocaleString("vi-VN")],
    ["Thuật toán", thuatToan],
    ["Phiên bản khoá", phienBanKhoa],
  ];
  for (const [k, v] of hang) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    $("tt-bn").append(dt, dd);
  }
  $("mo-ta-pb").textContent =
    `magic TPSE · phiên bản định dạng ${h.formatVersion} · thuật toán ${h.algorithm}\n` +
    `khoá phù du ${h.ephemeralPublicKey.length} byte · phong bì ${phongBi.length} byte`;
  $("van-ban").textContent = bn.canonicalText;
  $("chu-ky").textContent = `chữ ký (base64):\n${bn.signature}`;
  $("b3").classList.add("xong");
  hien($("b4"), true);
  $("b4").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("nut-lai").addEventListener("click", () => {
  hien($("b4"), false);
  $("nut-nop").disabled = false;
  $("b3").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ==============================================================================================
// [S1.98 / khoản 204] ĐỌC LẠI FRAGMENT KHI NÓ ĐỔI, VÌ TRÌNH DUYỆT KHÔNG TẢI LẠI TÀI LIỆU.
//
// Trang này đọc `location.hash` đúng một lần lúc tải, và với ba nhà cung cấp trên ba điện thoại
// thì thế là đủ. Nhưng khi một người bấm link mời THỨ HAI — sau một lần thu hồi rồi mời lại —
// trong tab đang mở, trình duyệt chỉ đổi fragment: tài liệu không tải lại, hai ô giữ mã CŨ, và
// máy chủ trả *"magic link không hợp lệ, đã hết hạn, đã dùng, hoặc đã bị thu hồi"*. Thông điệp
// ấy đổ lỗi cho link MỚI trong khi lỗi nằm ở trang đang giữ link CŨ.
//
// Đo được ở lượt đi thử §11 của S1.97: mở link của nhà cung cấp thứ hai trong tab của người thứ
// nhất ⇒ bước 1 đỏ; `location.reload()` thì đúng ngay.
//
// Ngoài việc đọc lại hai ô, phải XOÁ trạng thái phiên đang dựng dở: một `redeem` của lời mời cũ
// còn sống trong biến `phien` sẽ làm bước 2 gửi OTP cho đúng người của lời mời TRƯỚC.
// ==============================================================================================
window.addEventListener("hashchange", () => {
  docLink();
  phien = { orgId: $("org").value.trim(), token: $("token").value.trim(), rfq: null, items: [], publicKeys: [] };
  for (const id of ["loi1", "loi2", "loi3", "ok1", "ok2"]) {
    const el = $(id);
    if (el !== null) bao(el, "");
  }
});

docLink();

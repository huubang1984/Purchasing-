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
/**
 * [S1.178] Thế hệ của màn: tăng mỗi lần các bước bị đóng về bước 1 (`dongCacBuoc` — đổi link trong cùng thẻ, mở một
 * lời mời khác). Mọi lời gọi đang bay chụp nó trước `await` và bỏ kết quả nếu nó đã đổi: một phản hồi về muộn của lượt
 * cũ không được mở lại bước 3 dưới cookie của người trước.
 */
let theHe = 0;

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

// [S1.255 / khoản 326] Khuôn khoản 323 (S1.254, `mo-thau.js`, `tao-thau.js`) cho trang này: thân 403 của `apps/api` là MỘT
// hằng không dấu, cố ý không nói thiếu quyền nào (khoản 191); trang nói thay bằng việc vừa bấm. Mọi thân lỗi khác — kể cả
// 403 `nguon khong duoc phep` của lớp chống CSRF theo origin — vẫn in nguyên văn.
const THAN_403 = "khong co quyen";

function loiCua(r, macDinh) {
  if (r.status === 403 && r.body?.error === THAN_403) {
    return `${macDinh}: phiên nộp thầu này không có quyền làm việc này. Mở lại đúng link mời bên mua gửi; ` +
      "vẫn bị từ chối thì báo cho bên mua.";
  }
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
  // [S1.178] Fragment không mang mã thì ô mã cũng rỗng: sau lần xác minh, ô còn giữ mã lời mời ĐÃ tiêu thụ, và một ô
  // mã có giá trị làm `thuPhienKhach` không hỏi phiên nữa.
  if (i <= 0) { $("token").value = ""; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}

$("nut-mo").addEventListener("click", async () => {
  bao($("loi1"), "");
  const orgId = $("org").value.trim();
  const token = $("token").value.trim();
  if (orgId === "" || token === "") { bao($("loi1"), "Cần cả mã tổ chức và mã lời mời."); return; }
  $("nut-mo").disabled = true;
  const the = theHe;
  const r = await goi("POST", "/guest/redeem", { orgId, token });
  $("nut-mo").disabled = false;
  if (the !== theHe) return;
  if (r.status !== 200) { bao($("loi1"), loiCua(r, "Không mở được lời mời")); return; }
  // [S1.178] Một lời mời khác vừa mở: bước 3 đang hiện (nếu có) là của cookie cũ — đóng về bước 1 trước khi mở bước 2.
  dongCacBuoc();
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
  const the = theHe;
  const r = await goi("POST", "/guest/otp/verify", { orgId: phien.orgId, token: phien.token, code });
  $("nut-xac").disabled = false;
  if (the !== theHe) return;
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Mã không đúng")); return; }
  xoaManhLink();
  bao($("ok2"), "Đã xác minh. Phiên nằm trong cookie, mã phiên không đi qua JavaScript.");
  $("b2").classList.add("xong");
  // [S1.181 / ADR-109] Từ đây trình duyệt giữ một phiên khách: thoát được, ở bước 1 và ở bước 4.
  hien($("nut-thoat-khach"), true);
  await napGoiThau();
});

/**
 * [S1.177] ADR-020 mục 3: trang xoá fragment khỏi thanh địa chỉ. Làm SAU `/guest/otp/verify` — lượt ấy tiêu thụ
 * mã lời mời (`[H5]`, `packages/invitation`), nên xoá nó không làm mất gì — để mã không nằm lại trong thanh địa
 * chỉ và lịch sử trình duyệt. `replaceState` không bắn `hashchange`. ~~Trang này KHÔNG hỏi lại phiên khách lúc
 * tải: tải lại sau khi xác minh vẫn mất đường vào tới khi được mời lại, có xoá fragment hay không.~~
 * [S1.178] Nay trang hỏi lại phiên khách lúc tải (`thuPhienKhach`, cuối tệp).
 */
function xoaManhLink() {
  try { history.replaceState(null, "", location.pathname + location.search); } catch { /* không xoá được thì thôi */ }
}

// ---------------------------------------------------------------------------------------------
// Bước 3 — gói thầu và bảng giá
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// [khoản 196 / ADR-074 phần 3] ĐẾM NGƯỢC THEO GIỜ MÁY CHỦ
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

/** Trả `true` khi đã nạp và mở bước 3; `false` khi lỗi hay khi màn đã đổi thế hệ trong lúc chờ ([S1.178]). */
async function napGoiThau() {
  const guiLuc = Date.now();
  const the = theHe;
  const r = await goi("GET", "/guest/rfq");
  const nhanLuc = Date.now();
  if (the !== theHe) return false;
  if (r.status !== 200) { bao($("loi3"), loiCua(r, "Không đọc được gói thầu")); hien($("b3"), true); return false; }
  phien = {
    ...phien, rfq: r.body.rfq, items: r.body.items ?? [], publicKeys: r.body.publicKeys ?? [], bafoRound: r.body.bafoRound ?? null,
    // [S1.181 / ADR-109] Tên doanh nghiệp được mời — máy chủ dẫn xuất từ phiên, trang chỉ in lại.
    tenNhaCungCap: typeof r.body.supplier?.legalName === "string" ? r.body.supplier.legalName : "",
  };

  // [S1.109 / S2.5 / khoản 227⑶] HẠN NÀO LÀ HẠN ĐANG CÓ HIỆU LỰC.
  //
  // `rfq.deadlineAt` là hạn VÒNG MỘT, và suốt `BAFO_OPEN` nó đã ở QUÁ KHỨ — nó không cập nhật
  // được (vế (b) của bảng cạnh cấm deadline lùi, vế (c) chỉ cho đổi ở `DRAFT`/`OPEN`), và chính
  // vì thế `059` tách hạn BAFO sang bảng riêng. In thẳng `rfq.deadlineAt` trong lúc có vòng BAFO
  // là để màn hình nói một hạn đã qua trong khi người đọc nó vẫn nộp được.
  const vong = phien.bafoRound;
  const han = new Date(vong === null ? phien.rfq.deadlineAt : vong.deadlineAt);
  $("tt-rfq").replaceChildren();
  const dong = [["Gói thầu", phien.rfq.title]];
  if (phien.tenNhaCungCap !== "") dong.push(["Doanh nghiệp được mời", phien.tenNhaCungCap]);
  dong.push(["Trạng thái", phien.rfq.status]);
  if (vong !== null) {
    dong.push(["Vòng", `BAFO ${vong.roundNo} — mời nộp lại, niêm phong như vòng một`]);
    dong.push(["Hạn nộp của vòng này", han.toLocaleString("vi-VN")]);
    dong.push(["Hạn vòng một", new Date(phien.rfq.deadlineAt).toLocaleString("vi-VN")]);
  } else {
    dong.push(["Hạn nộp", han.toLocaleString("vi-VN")]);
  }
  lechMayChu = doLechMayChu(r.body.gioMayChu, guiLuc, nhanLuc);
  if (lechMayChu !== null) dong.push(["Giờ hệ thống lúc tải", gioDoc(r.body.gioMayChu)]);
  // [S1.165 / khoản 225] Gói đã huỷ thì nói ra VÌ SAO — người huỷ viết lý do cho chính anh/chị, kể cả
  // khi huỷ sau lúc mở thầu. Gói huỷ trước vòng ấy không có lý do lưu ở đây.
  if (phien.rfq.status === "CANCELLED") {
    dong.push(["Lý do huỷ", phien.rfq.cancelReason ?? "(bên mua không ghi lý do)"]);
  }
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
    const tdGia = document.createElement("td"); tdGia.className = "so gia"; tdGia.append(o);
    // [S1.254 / khoản 322] Nhãn của từng ô cho màn hẹp: dưới 480px (`chung.css`) mỗi hạng mục là một khối và đầu bảng ẩn đi.
    const sl = td(String(Number(it.quantity)), "so sl"); sl.dataset.nhan = "SL";
    const dvt = td(it.unit ?? "", "dvt"); dvt.dataset.nhan = "ĐVT";
    tdGia.dataset.nhan = "Đơn giá";
    tr.append(td(`${it.lineNo}. ${it.description}`), sl, dvt, tdGia);
    tbody.append(tr);
  }
  tinhLai();
  if (phien.rfq.status === "CANCELLED") {
    bao($("loi3"), "Gói thầu này đã bị huỷ — không nộp được báo giá nữa. Lý do ở bảng trên.");
  }
  hien($("b3"), true);
  $("b3").scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
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
  // [S1.165 / khoản 225] Gói đã huỷ: không niêm phong một báo giá mà máy chủ chắc chắn từ chối.
  $("nut-nop").disabled = tong === null || phien?.rfq?.status === "CANCELLED";
  return tong;
}

// [S1.165 / khoản 244] `#tien-te` nay là một <select>. `change` là sự kiện mà mọi trình duyệt phát
// cho ô chọn; `input` thì trình duyệt cũ và vài cửa sổ web trong ứng dụng không phát — nghe cả hai.
$("tien-te").addEventListener("change", tinhLai);
$("tien-te").addEventListener("input", tinhLai);

// ---------------------------------------------------------------------------------------------
// Bước 4 — niêm phong và nộp
// ---------------------------------------------------------------------------------------------

// [S1.219 / khoản 230] MÃ LÝ DO TỪ CHỐI → CÂU CHO NGƯỜI NỘP.
//
// Thân 422 của `POST /guest/bids` mang `ma` — tên ràng buộc mà trigger của câu nộp đã đặt, viết hoa (`MA_THEO_RANG_BUOC` của
// `packages/bidding`, cộng `C1_QUA_HAN_NOP` của nhánh vì hạn). Trang tra bảng này chứ KHÔNG đọc câu chữ của `error`: câu
// chữ đổi được, mã là hợp đồng. Mã không có trong bảng (api mới hơn trang, hay thân không mang mã) ⇒ `error` nguyên văn —
// câu chung cũ. Mỗi câu nói rõ báo giá CHƯA đi và việc kế tiếp của người nộp; không câu nào chép câu của CSDL.
const CAU_THEO_MA = {
  C1_QUA_HAN_NOP: "Đã quá hạn nộp báo giá theo giờ của hệ thống — báo giá CHƯA được gửi.",
  C1_GOI_KHONG_NHAN_BAO_GIA:
    "Gói thầu này không còn nhận báo giá — đã đóng, đã huỷ hay chưa mở lại. Báo giá CHƯA được gửi; tải lại trang để xem trạng thái hiện tại của gói.",
  BAFO_NGOAI_TOP_N:
    "Luồng báo giá của bạn không nằm trong vòng BAFO đang mở — vòng này chỉ mời các nhà cung cấp trong top-N của lượt xếp hạng nộp lại. Báo giá CHƯA được gửi.",
  C1_KHONG_VONG_BAFO_DANG_MO:
    "Gói thầu đang ở vòng BAFO nhưng hệ thống không thấy vòng nào đang mở — dữ liệu gói thầu không nhất quán. Báo giá CHƯA được gửi; báo cho bên mua.",
  C1_KHONG_HAN_NOP:
    "Gói thầu đang mở mà không có hạn nộp — dữ liệu gói thầu không nhất quán. Báo giá CHƯA được gửi; báo cho bên mua.",
  PHIEN_KHACH_KHONG_HOP_LE:
    "Phiên nộp thầu đã hết hạn hoặc đã bị thu hồi ngay trước lúc ghi — báo giá CHƯA được gửi. Xin bên mua gửi lại link mời.",
  PHIEN_KHACH_KHAC_LOI_MOI:
    "Phiên nộp thầu trên trình duyệt này thuộc một lời mời khác với luồng báo giá — báo giá CHƯA được gửi. Tải lại trang để làm tiếp với đúng phiên.",
};

/** Câu riêng cho `ma` của thân 422, hay `null` khi thân không mang mã / mã lạ (⇒ người gọi rơi về `error` nguyên văn). */
function cauTuChoi(b) {
  if (b === null || typeof b !== "object" || typeof b.ma !== "string") return null;
  return Object.hasOwn(CAU_THEO_MA, b.ma) ? CAU_THEO_MA[b.ma] : null;
}

$("nut-nop").addEventListener("click", async () => {
  bao($("loi3"), "");
  const tong = tinhLai();
  if (tong === null) return;
  $("nut-nop").disabled = true;
  // [S1.181 / lượt soi] Thoát, hay đổi link trong cùng thẻ, trong lúc lần nộp còn bay: biên nhận về muộn là của phiên
  // trước, không được mở lại bước 4 dưới câu "Đã thoát".
  const the = theHe;
  try {
    // [S1.181 / lượt soi] Tên doanh nghiệp trên màn là ảnh chụp lúc nạp; cookie khách thì chung cho mọi thẻ của trình
    // duyệt. Một thẻ khác vừa xác minh lời mời của doanh nghiệp khác thì lần nộp ở thẻ này sẽ đi vào hồ sơ của doanh nghiệp
    // ấy — nên hỏi lại phiên hiện hành ngay trước khi niêm phong, và dừng nếu nó không còn là phiên trên màn.
    const hienHanh = await goi("GET", "/guest/rfq");
    if (the !== theHe) return;
    const tenHienHanh = typeof hienHanh.body?.supplier?.legalName === "string" ? hienHanh.body.supplier.legalName : "";
    if (hienHanh.status !== 200 || hienHanh.body?.rfq?.id !== phien.rfq.id || tenHienHanh !== phien.tenNhaCungCap) {
      // [lượt soi] Chỉ 401 là phiên chết. Mã khác (500, 502/503 của proxy) nói về máy chủ, không về phiên — câu "hết hạn,
      // xin link mới" ở đó đẩy nhà cung cấp đi xin một link họ không cần. Vế `rfq.id` bắt ca CÙNG doanh nghiệp, KHÁC gói
      // (hai lời mời, hai thẻ): phong bì niêm cho gói trên màn mà nộp vào luồng của gói kia thì không mở được khi mở thầu.
      bao($("loi3"), hienHanh.status === 200
        ? `Phiên nộp thầu trên trình duyệt này đã đổi${tenHienHanh === "" ? "" : ` sang «${tenHienHanh}»`} — có lẽ ở một thẻ khác. ` +
          "Báo giá CHƯA được gửi. Tải lại trang để làm tiếp với đúng phiên."
        : hienHanh.status === 401
          ? "Phiên nộp thầu đã hết hạn hoặc đã thoát — báo giá CHƯA được gửi. Xin bên mua gửi lại link mời."
          : `${loiCua(hienHanh, "Không kiểm được phiên nộp thầu")} — báo giá CHƯA được gửi. Thử lại sau ít phút.`);
      $("nut-nop").disabled = false;
      return;
    }
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
    if (the !== theHe) return;
    if (r.status !== 201) {
      // [khoản 196 / ADR-074 phần 2] Lần chặn VÌ HẠN mang giờ hệ thống lúc phán xử và hạn đã so —
      // in cả hai, để người bị chặn đối chiếu được với đồng hồ của mình và với hạn trên màn hình.
      // [S1.219 / khoản 230] Câu đầu là câu RIÊNG theo `ma` (bảng `CAU_THEO_MA`) khi 422 mang mã trang biết; không thì là
      // `error` nguyên văn — hai giờ vẫn kèm theo hễ thân có, kể cả với một api cũ không mang `ma`.
      const b = r.body;
      const viHan = r.status === 422 && b !== null && typeof b === "object" && typeof b.gioPhanXu === "string" && typeof b.hanNop === "string";
      const cauDau = (r.status === 422 ? cauTuChoi(b) : null) ?? loiCua(r, "Không nộp được");
      bao(
        $("loi3"),
        viHan
          ? `${cauDau} Giờ hệ thống lúc phán xử: ${gioDoc(b.gioPhanXu)} (${b.gioPhanXu}). Hạn nộp: ${gioDoc(b.hanNop)} (${b.hanNop}). ` +
            "Hệ thống đã ghi lại lần nộp bị chặn này."
          : cauDau,
      );
      $("nut-nop").disabled = false;
      return;
    }
    veBienNhan(r.body.receipt, phongBi, thuatToan, khoa.keyVersion);
  } catch (e) {
    if (the !== theHe) return;
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
//
// [S1.178] Và ĐÓNG các bước về bước 1 rồi hỏi lại phiên. Trước đây bước 3 đã mở vẫn để nguyên: nhà cung cấp thứ
// hai mở link của mình trong thẻ của người thứ nhất thấy ngay bảng giá, và "Niêm phong và nộp" đi dưới cookie khách
// của người THỨ NHẤT cho tới khi người thứ hai xác minh xong.
window.addEventListener("hashchange", () => {
  docLink();
  phien = { orgId: $("org").value.trim(), token: $("token").value.trim(), rfq: null, items: [], publicKeys: [] };
  for (const id of ["loi1", "loi2", "loi3", "ok1", "ok2"]) {
    const el = $(id);
    if (el !== null) bao(el, "");
  }
  dongCacBuoc();
  thuPhienKhach();
});

// ==============================================================================================
// [S1.178] HỎI LẠI PHIÊN KHÁCH LÚC TẢI.
//
// Mã lời mời bị tiêu thụ ở lần xác minh OTP (`[H5]`, `packages/invitation`), còn phiên khách là cookie
// `__Host-tp_guest` `Path=/` sống tới 4 giờ (`apps/api/src/routes/anon.ts`). Tới trước vòng này trang chỉ đọc gói
// thầu SAU lần xác minh, nên tải lại trang là mất đường vào giữa lúc nhập giá, tới khi bên mua mời lại — và
// trên điện thoại, trình duyệt tự tải lại một thẻ bị đẩy xuống nền. Nay, ô mã rỗng thì hỏi `GET /guest/rfq`
// (route đã có, không ghi gì); 200 thì HỎI, không tự mở — cùng khuôn ba trang người mua (`thuPhienCo` ở
// `mo-thau.js`): trên một máy dùng chung, phiên ấy có thể của người khác. Câu hỏi nêu tên gói thầu, thứ nhà cung
// cấp nhận ra được — ~~nhưng tên gói KHÔNG nói phiên của nhà cung cấp nào: một gói mời nhiều nhà cung cấp, và không route
// khách nào trả định danh người được mời; câu hỏi nói thẳng điều ấy.~~ **[S1.181 / ADR-109]** và tên DOANH NGHIỆP được
// mời (`supplier.legalName` của `GET /guest/rfq`): một gói mời nhiều nhà cung cấp, nên chỉ tên gói thì hai nhà cung cấp
// cùng gói trên một máy thấy cùng một câu hỏi. Thiếu tên doanh nghiệp thì KHÔNG hỏi — cùng luật với thiếu tên gói.
// Cùng khối hỏi có nút Thoát phiên nộp thầu. `docLink()` phải chạy TRƯỚC hàm này; sau `await`,
// thế hệ (`theHe`) và ô mã được kiểm lại: một phản hồi về muộn, sau khi người khác đã dán link của mình, bị bỏ.
// ==============================================================================================
let khachCho = false;

async function thuPhienKhach() {
  if ($("token").value.trim() !== "") return;
  const the = theHe;
  try {
    const r = await goi("GET", "/guest/rfq");
    if (the !== theHe || $("token").value.trim() !== "") return;
    if (r.status !== 200 || typeof r.body?.rfq?.title !== "string" || typeof r.body?.supplier?.legalName !== "string") return;
    khachCho = true;
    bao($("hoi-phien"), `Trình duyệt này đang giữ một phiên nộp thầu còn hạn của «${r.body.supplier.legalName}» cho gói thầu ` +
      `«${r.body.rfq.title}». Đúng là doanh nghiệp của anh/chị thì bấm Tiếp tục — không cần mở lại link hay nhập lại mã. ` +
      "Không phải thì bấm Thoát phiên nộp thầu để đóng phiên ấy trên trình duyệt này, rồi mở link mời của mình.");
    hien($("nut-dung-phien"), true);
    hien($("nut-thoat-khach"), true);
  } catch { /* mất mạng: trang ở lại bước 1 */ }
}

function boHoiPhien() {
  khachCho = false;
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
}

/**
 * [S1.178] Về lại bước 1: sang thế hệ mới, dừng đếm ngược, bỏ dấu "xong", ẩn bước 2–4 và XOÁ nội dung của chúng (gói
 * thầu, các ô giá đã gõ, biên nhận — của phiên trước), bỏ khối hỏi phiên.
 */
function dongCacBuoc() {
  theHe += 1;
  if (henDemNguoc !== null) window.clearInterval(henDemNguoc);
  henDemNguoc = null;
  for (const b of ["b1", "b2", "b3"]) $(b).classList.remove("xong");
  for (const b of ["b2", "b3", "b4"]) hien($(b), false);
  for (const id of ["tt-rfq", "tt-bn", "mo-ta-pb", "van-ban", "chu-ky"]) $(id).replaceChildren();
  $("bang-hang").querySelector("tbody").replaceChildren();
  // [S1.181 / lượt soi] Dòng tổng mang TỔNG GIÁ dạng rõ người trước đã gõ; ô OTP mang mã của người trước.
  $("tong").textContent = "";
  $("ma").value = "";
  $("tien-te").value = "VND";
  bao($("dem-nguoc"), "");
  for (const id of ["loi3", "loi4"]) bao($(id), "");
  boHoiPhien();
  hien($("nut-thoat-khach"), false);
}

// Phiên có thể đã chết trong lúc khối hỏi nằm chờ (quá 4 giờ, bên mua thu hồi lời mời): khi ấy KHÔNG mở bước 3 rỗng với
// một câu "còn hạn" — nói thẳng ở bước 1.
$("nut-dung-phien").addEventListener("click", async () => {
  if (!khachCho) return;
  boHoiPhien();
  bao($("loi1"), "");
  const the = theHe;
  let duoc = false;
  try {
    duoc = await napGoiThau();
  } catch {
    if (the === theHe) bao($("loi1"), "Không kết nối được máy chủ. Kiểm tra mạng rồi tải lại trang.");
    return;
  }
  if (the !== theHe) return;
  if (!duoc) {
    hien($("b3"), false);
    bao($("loi3"), "");
    hien($("nut-thoat-khach"), false);
    bao($("loi1"), "Phiên nộp thầu đã hết hạn hoặc lời mời đã bị thu hồi. Link mời cũ đã dùng rồi — xin bên mua gửi lại link mời.");
    return;
  }
  const cua = phien.tenNhaCungCap === "" ? "" : ` của «${phien.tenNhaCungCap}»`;
  bao($("ok1"), `Đang dùng phiên nộp thầu còn hạn${cua}. Nộp xong trên máy dùng chung thì bấm Thoát phiên nộp thầu — ` +
    "thoát rồi, muốn vào lại thì xin bên mua gửi lại link mời.");
  $("b1").classList.add("xong");
});

// ==============================================================================================
// [S1.181 / ADR-109] THOÁT PHIÊN NỘP THẦU.
//
// `POST /guest/logout` thu hồi CHÍNH phiên khách đang gọi (máy chủ dẫn xuất nó từ cookie) và xoá cookie
// `__Host-tp_guest`. Trước vòng này không đường nào làm việc ấy: trên một máy dùng chung, phiên sống tới 4 giờ sau
// khi người nộp đã rời đi. 401 nghĩa là phiên đã hết hay đã bị thu hồi — điều người bấm muốn vẫn đạt, nên trang cũng
// về bước 1 (cùng khuôn nút Đăng xuất của ba trang người mua). Mã lời mời đã bị tiêu thụ ở lần xác minh, nên câu báo
// nói thẳng: muốn nộp tiếp phải có link mới — ~~của một lời mời mới~~ **[S1.181 / ADR-110]** link bên mua GỬI LẠI cho
// chính lời mời ấy, đưa về đúng hồ sơ báo giá đã nộp. Lời gọi về muộn sau khi màn đã đổi thế hệ (đổi link trong cùng thẻ)
// không được xoá màn của người sau. Lỗi hiện cạnh nút đã bấm — nút ở bước 4 nằm cuối trang, xa `#loi1`.
// ==============================================================================================
async function thoatPhienKhach(oLoi) {
  for (const id of ["loi1", "loi4", "ok1"]) bao($(id), "");
  const cacNut = ["nut-thoat-khach", "nut-thoat-bn", "nut-dung-phien"];
  for (const id of cacNut) $(id).disabled = true;
  const the = theHe;
  try {
    const r = await goi("POST", "/guest/logout");
    if (the !== theHe) return;
    if (r.status !== 200 && r.status !== 401) { bao(oLoi, loiCua(r, "Không thoát được phiên nộp thầu")); return; }
    phien = { orgId: $("org").value.trim(), token: $("token").value.trim(), rfq: null, items: [], publicKeys: [] };
    for (const id of ["loi2", "loi3", "ok2"]) bao($(id), "");
    dongCacBuoc();
    bao($("ok1"), "Đã thoát phiên nộp thầu trên trình duyệt này. Muốn nộp hay sửa báo giá nữa thì xin bên mua gửi lại link " +
      "mời — link gửi lại đưa về đúng báo giá đã nộp; link cũ đã dùng rồi.");
    $("b1").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    if (the === theHe) bao(oLoi, "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    for (const id of cacNut) $(id).disabled = false;
  }
}
$("nut-thoat-khach").addEventListener("click", () => thoatPhienKhach($("loi1")));
$("nut-thoat-bn").addEventListener("click", () => thoatPhienKhach($("loi4")));

docLink();
thuPhienKhach();

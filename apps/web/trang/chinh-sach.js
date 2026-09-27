// ==============================================================================================
// [S1.169 / S3.1c] MÀN KHAI CHÍNH SÁCH — spec S3 §9 (S3.1c), §8.1 ⑵, §8.10
//
// Ba việc, và không việc nào là chốt: ⑴ đọc các phiên bản — trọn ma trận, chữ ký, phiên bản hiệu lực; ⑵ soạn một phiên
// bản mới, với cảnh báo cấu hình rỗng ruột và số người tối thiểu tính lại ở mỗi lần sửa; ⑶ ký phiên bản mới nhất. Mọi
// luật của cả ba nằm ở máy chủ và CSDL (`069`, `072`, cờ triển khai ADR-105): màn này không kiểm lại luật nào, nó chỉ nói
// trước điều máy chủ sẽ nói. Hai phép tính cảnh báo và số người ở `/lib/chinh-sach.js` — một bản cài, `tsc` gác, vitest đo.
//
// Trang không chèn chuỗi nào của máy chủ vào HTML: mọi ô đi qua `textContent`.
// ==============================================================================================

import { BAC_MAC_DINH, MUC_MAC_DINH, NGUONG_KEP_MAC_DINH, canhBaoChinhSach, soNguoiToiThieu } from "/lib/chinh-sach.js";
import { nhomSo, tien } from "/lib/so-tien.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

let phien = { token: "", daRedeem: false };
let trangThai = { phienBan: [], daBat: false, choKy: false };
let bac = [];

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

function dienDl(el, hang) {
  el.replaceChildren();
  for (const [k, v] of hang) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v === null || v === undefined ? "—" : String(v);
    el.append(dt, dd);
  }
}

function o(noiDung, lop) {
  const td = document.createElement("td");
  td.textContent = noiDung;
  if (lop !== undefined) td.className = lop;
  return td;
}

const soTien = (n) => nhomSo(Number(n).toFixed(0));

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: magic link + TOTP, cùng khuôn `tao-thau.js` (gọi `/auth/redeem` ĐÚNG một lần cho mỗi mã).
// ---------------------------------------------------------------------------------------------

function docLink() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) { if (h !== "") $("token").value = h; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}
docLink();
// [S1.9102] Đổi người trong cùng thẻ: đóng các bước về bước 1 — trước đây chúng ĐỂ NGUYÊN, dưới cookie của
// người trước — rồi hỏi lại phiên (khuôn `mo-thau.js`).
window.addEventListener("hashchange", () => {
  docLink();
  phienCho = null;
  phien = { token: $("token").value.trim(), daRedeem: false };
  for (const id of ["loi1", "ok1", "ghi-danh", "loi2", "ok2", "loi3", "ok3"]) bao($(id), "");
  dongCacBuoc();
  thuPhienCo();
});

$("nut-vao").addEventListener("click", async () => {
  bao($("loi1"), ""); bao($("ghi-danh"), "");
  const orgId = $("org").value.trim();
  const token = $("token").value.trim();
  const code = $("ma").value.trim();
  if (token !== phien.token) phien = { token, daRedeem: false };
  if (orgId === "" || token === "") { bao($("loi1"), "Cần cả mã tổ chức và mã đăng nhập."); return; }
  $("nut-vao").disabled = true;
  try {
    if (!phien.daRedeem) {
      const r1 = await goi("POST", "/auth/redeem", { orgId, token });
      if (r1.status !== 200) { bao($("loi1"), loiCua(r1, "Mã đăng nhập không dùng được")); return; }
      phien = { ...phien, daRedeem: true };
      if (r1.body?.needsEnrollment === true) {
        bao($("ghi-danh"), `Tài khoản này chưa có MFA. Bí mật TOTP (nhập vào ứng dụng xác thực, rồi nhập mã sáu số và bấm Vào lần nữa): ${r1.body.totpSecretBase32}`);
        return;
      }
    }
    if (!/^\d{6}$/.test(code)) { bao($("loi1"), "Nhập mã sáu số của ứng dụng xác thực."); return; }
    const r2 = await goi("POST", "/auth/totp", { orgId, token, code });
    if (r2.status !== 200) {
      bao($("loi1"), r2.body?.reason === "LOCKED_OUT" ? "Tài khoản đang bị khoá tạm thời" : "Mã sáu số không đúng");
      return;
    }
    xoaManhLink();
    const me = await goi("GET", "/me");
    await moSauDangNhap(me.body, false);
  } finally {
    $("nut-vao").disabled = false;
  }
});

const CAC_BUOC_SAU = ["b2", "b3"];

/** [S1.9102] Mở các bước sau đăng nhập — vừa đăng nhập xong, hoặc người dùng bấm "Tiếp tục với phiên này". */
async function moSauDangNhap(me, dungLai) {
  const u = me?.userId;
  bao($("ok1"), typeof u !== "string"
    ? "Đã vào."
    : dungLai
      ? `Đang dùng phiên còn hạn của người dùng ${u.slice(0, 8)}… — cần đổi người thì đăng nhập ở trên bằng link của người ấy.`
      : `Đã vào với người dùng ${u.slice(0, 8)}…`);
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), true);
  $("b1").classList.add("xong");
  for (const b of CAC_BUOC_SAU) hien($(b), true);
  await napPhienBan();
  if (bac.length === 0) dienMau();
}

/** [S1.9102] Về lại bước 1: ẩn mọi bước sau, bỏ dấu "xong", bỏ khối hỏi phiên và nút Đăng xuất. */
function dongCacBuoc() {
  $("b1").classList.remove("xong");
  for (const b of CAC_BUOC_SAU) hien($(b), false);
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), false);
}

/**
 * [S1.9102] Cùng khuôn `mo-thau.js`: phiên người mua là cookie `Path=/` sống tới 8 giờ kể cả sau khi đóng trình
 * duyệt, dùng chung ba trang, còn mã đăng nhập chỉ dùng được một lần — nên lúc tải trang hỏi `/me`. Có phiên
 * còn hạn thì HỎI "Tiếp tục với phiên này" hay "Đăng xuất", không tự mở: trên máy dùng chung phiên ấy có thể
 * của người khác, và bước 2 có nút Ký (người ký phải KHÁC người khai). Không hỏi khi ô mã đã có mã; `docLink()`
 * phải chạy trước hàm này, và ô mã được kiểm lại sau `await`. Sau `/auth/totp` — mã đã tiêu thụ —
 * xoá fragment khỏi thanh địa chỉ (ADR-020 mục 3).
 */
let phienCho = null;
async function thuPhienCo() {
  if ($("token").value.trim() !== "") return;
  try {
    const me = await goi("GET", "/me");
    if ($("token").value.trim() !== "") return;
    if (me.status !== 200 || typeof me.body?.userId !== "string") return;
    phienCho = me.body;
    const toChuc = typeof me.body.orgId === "string" ? `, tổ chức ${me.body.orgId.slice(0, 8)}…` : "";
    bao($("hoi-phien"), `Trình duyệt này đang giữ một phiên còn hạn: người dùng ${me.body.userId.slice(0, 8)}…${toChuc}. ` +
      "Trang không biết tên người ấy. Không chắc đó là bạn thì bấm Đăng xuất, rồi đăng nhập bằng link của bạn.");
    hien($("nut-dung-phien"), true);
    hien($("nut-dang-xuat"), true);
  } catch { /* mất mạng: trang ở lại bước đăng nhập */ }
}

$("nut-dung-phien").addEventListener("click", async () => {
  if (phienCho === null) return;
  const me = phienCho;
  phienCho = null;
  await moSauDangNhap(me, true);
});

// [S1.9102] Cùng khuôn `mo-thau.js`: 401 là phiên đã hết hay đã bị thu hồi — trang cũng về bước 1.
$("nut-dang-xuat").addEventListener("click", async () => {
  bao($("loi1"), ""); bao($("ok1"), "");
  $("nut-dang-xuat").disabled = true;
  try {
    const r = await goi("POST", "/auth/logout");
    if (r.status !== 200 && r.status !== 401) { bao($("loi1"), loiCua(r, "Không đăng xuất được")); return; }
    phienCho = null;
    phien = { token: $("token").value.trim(), daRedeem: false };
    dongCacBuoc();
    bao($("ok1"), "Đã đăng xuất. Trình duyệt này không còn giữ phiên của bạn.");
  } catch {
    bao($("loi1"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    $("nut-dang-xuat").disabled = false;
  }
});

function xoaManhLink() {
  try { history.replaceState(null, "", location.pathname + location.search); } catch { /* không xoá được thì thôi */ }
}


// ---------------------------------------------------------------------------------------------
// Bước 2 — các phiên bản và lần ký
// ---------------------------------------------------------------------------------------------

async function napPhienBan() {
  bao($("loi2"), "");
  const r = await goi("GET", "/policy/versions");
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được các phiên bản chính sách")); return; }
  trangThai = { phienBan: r.body?.phienBan ?? [], daBat: r.body?.daBat === true, choKy: r.body?.choKy === true };
  dienDl($("tt-to-chuc"), [
    ["Kiểm soát theo bậc", trangThai.daBat ? "ĐÃ BẬT — không tắt lại được" : "chưa bật: tổ chức chạy như MVP1"],
    ["Ký phiên bản trên máy chủ này", trangThai.choKy ? "mở" : "khoá — S3 chưa đủ chốt để bật"],
  ]);
  const tb = $("bang-pb").querySelector("tbody");
  tb.replaceChildren();
  for (const p of trangThai.phienBan) {
    const tr = document.createElement("tr");
    tr.append(
      o(String(p.version), "so"),
      o(new Date(p.effectiveFrom).toLocaleString("vi-VN")),
      o(tien(p.dualApprovalThreshold), "so"),
      o(p.tiers === null ? "không bậc" : `${p.tiers.length} bậc`),
      o(p.signedBy === null ? (p.tiers === null ? "không cần" : "chưa ký") : `đã ký ${new Date(p.signedAt).toLocaleString("vi-VN")}`),
      o(p.hieuLuc ? "đang hiệu lực" : ""),
    );
    tb.append(tr);
  }
  // Chỉ phiên bản MỚI NHẤT, có bậc, chưa ký mới ký được (trigger `chinh_sach_kiem_nguoi_ky`); màn chỉ mở đúng ca ấy.
  const moiNhat = trangThai.phienBan[0];
  const kyDuoc = moiNhat !== undefined && moiNhat.tiers !== null && moiNhat.signedBy === null;
  hien($("khoi-ky"), kyDuoc);
  if (kyDuoc) {
    $("mo-ta-ky").textContent = `Phiên bản ${moiNhat.version} có ${moiNhat.tiers.length} bậc và chưa ai ký. Người ký phải khác người khai.`;
    $("hieu-ky").checked = false;
    $("nut-ky").disabled = true;
    $("nut-ky").dataset.policyId = moiNhat.id;
  }
}

$("nut-doc-pb").addEventListener("click", () => { void napPhienBan(); });
$("hieu-ky").addEventListener("change", () => { $("nut-ky").disabled = !$("hieu-ky").checked || !trangThai.choKy; });

$("nut-ky").addEventListener("click", async () => {
  bao($("loi2"), ""); bao($("ok2"), "");
  const id = $("nut-ky").dataset.policyId;
  if (id === undefined || id === "") return;
  $("nut-ky").disabled = true;
  const r = await goi("POST", `/policy/${id}/sign`);
  if (r.status !== 201) { bao($("loi2"), loiCua(r, "Không ký được phiên bản")); $("nut-ky").disabled = false; return; }
  const k = r.body?.chuKy ?? {};
  bao($("ok2"), `Đã ký phiên bản ${k.version}.${k.daBat === true ? " Kiểm soát theo bậc ĐÃ BẬT cho tổ chức." : ""}`);
  await napPhienBan();
});

// ---------------------------------------------------------------------------------------------
// Bước 3 — soạn phiên bản mới
// ---------------------------------------------------------------------------------------------

const COT_BOOL = ["ky_danh_sach_moi", "award_vai_khac_nhau", "tham_dinh_truoc_trao", "khai_xung_dot"];

function bacThuong(tuSoTien) {
  return { tu_so_tien: tuSoTien, so_ncc_toi_thieu: 3, award_vai_khac_nhau: false, ky_danh_sach_moi: true, xoay_vong_n: 0, award_so_chu_ky: 1, award_vai: ["FINANCE", "DIRECTOR"], tham_dinh_truoc_trao: false, khai_xung_dot: true, dau_thau_chinh_thuc: false };
}

function dienMau() {
  bac = BAC_MAC_DINH.map((b) => ({ ...b, award_vai: b.award_vai === undefined ? undefined : [...b.award_vai] }));
  $("nguong").value = NGUONG_KEP_MAC_DINH;
  $("chia-nho").value = String(MUC_MAC_DINH.chiaNhoCuaSoNgay);
  $("tham-dinh").value = String(MUC_MAC_DINH.thamDinhHieuLucThang);
  veBac();
}

function chepMoiNhat() {
  const p = trangThai.phienBan[0];
  if (p === undefined) { bao($("loi3"), "Tổ chức chưa có phiên bản nào để chép."); return; }
  bac = p.tiers === null ? [] : p.tiers.map((b) => ({ ...b }));
  $("nguong").value = p.dualApprovalThreshold;
  $("tien-te").value = p.currency;
  $("chia-nho").value = p.chiaNhoCuaSoNgay === null ? "" : String(p.chiaNhoCuaSoNgay);
  $("tham-dinh").value = p.thamDinhHieuLucThang === null ? "" : String(p.thamDinhHieuLucThang);
  veBac();
}

function oNhap(giaTri, doi, loai) {
  const td = document.createElement("td");
  const i = document.createElement("input");
  if (loai === "bool") {
    i.type = "checkbox";
    i.checked = giaTri === true;
    i.addEventListener("change", () => { doi(i.checked); tinhLai(); });
  } else {
    i.inputMode = "numeric";
    i.value = giaTri === undefined ? "" : String(giaTri);
    i.addEventListener("input", () => { doi(Number(i.value)); tinhLai(); });
  }
  td.append(i);
  return td;
}

function oVai(b) {
  const td = document.createElement("td");
  for (const vai of ["FINANCE", "DIRECTOR"]) {
    const nhan = document.createElement("label");
    const i = document.createElement("input");
    i.type = "checkbox";
    i.checked = (b.award_vai ?? []).includes(vai);
    i.addEventListener("change", () => {
      const tap = new Set(b.award_vai ?? []);
      if (i.checked) tap.add(vai); else tap.delete(vai);
      b.award_vai = ["FINANCE", "DIRECTOR"].filter((v) => tap.has(v));
      tinhLai();
    });
    nhan.append(i, ` ${vai === "FINANCE" ? "Tài chính" : "Giám đốc"}`);
    td.append(nhan);
  }
  return td;
}

function veBac() {
  const tb = $("bang-bac").querySelector("tbody");
  tb.replaceChildren();
  for (const [i, b] of bac.entries()) {
    const tr = document.createElement("tr");
    tr.append(
      oNhap(b.tu_so_tien, (v) => { b.tu_so_tien = v; }),
      oNhap(b.dau_thau_chinh_thuc, (v) => { bac[i] = v ? { tu_so_tien: b.tu_so_tien, dau_thau_chinh_thuc: true } : bacThuong(b.tu_so_tien); veBac(); }, "bool"),
    );
    if (b.dau_thau_chinh_thuc) {
      const td = o("Bậc này không đi qua gói thầu của TrustProcure");
      td.colSpan = 8;
      tr.append(td);
    } else {
      tr.append(
        oNhap(b.so_ncc_toi_thieu, (v) => { b.so_ncc_toi_thieu = v; }),
        oNhap(b.ky_danh_sach_moi, (v) => { b.ky_danh_sach_moi = v; }, "bool"),
        oNhap(b.xoay_vong_n, (v) => { b.xoay_vong_n = v; }),
        oNhap(b.award_so_chu_ky, (v) => { b.award_so_chu_ky = v; }),
        oVai(b),
        ...["award_vai_khac_nhau", "tham_dinh_truoc_trao", "khai_xung_dot"].map((k) => oNhap(b[k], (v) => { b[k] = v; }, "bool")),
      );
    }
    tb.append(tr);
  }
  tinhLai();
}

function tinhLai() {
  const nguong = $("nguong").value.trim() || NGUONG_KEP_MAC_DINH;
  const tb = $("bang-nguoi").querySelector("tbody");
  tb.replaceChildren();
  for (const kq of soNguoiToiThieu(bac, nguong)) {
    const tr = document.createElement("tr");
    tr.append(o(soTien(kq.tuSoTien), "so"));
    if (kq.loai === "NGUOI") {
      tr.append(o(String(kq.nguoi.finance), "so"), o(String(kq.nguoi.muaSam), "so"), o(String(kq.nguoi.giamDoc), "so"), o(String(kq.nguoi.tong), "so"));
    } else {
      const td = o(kq.loai === "DAU_THAU_CHINH_THUC" ? "đấu thầu chính thức — ngoài gói thầu" : `không thực hiện được: ${kq.lyDo}`);
      td.colSpan = 4;
      tr.append(td);
    }
    tb.append(tr);
  }
  const cb = canhBaoChinhSach(bac);
  bao($("canh-bao"), cb.length === 0 ? "" : `Cảnh báo (không chặn): ${cb.join(" ")}`);
}

/** Ma trận gửi lên: bậc thường mang đủ mười khoá, bậc đấu thầu chính thức chỉ mang hai (trigger `chinh_sach_kiem_bac`). */
function bacGuiLen() {
  return bac.map((b) => {
    if (b.dau_thau_chinh_thuc) return { tu_so_tien: b.tu_so_tien, dau_thau_chinh_thuc: true };
    const ra = { tu_so_tien: b.tu_so_tien, dau_thau_chinh_thuc: false, so_ncc_toi_thieu: b.so_ncc_toi_thieu, xoay_vong_n: b.xoay_vong_n, award_so_chu_ky: b.award_so_chu_ky, award_vai: b.award_vai ?? [] };
    for (const k of COT_BOOL) ra[k] = b[k] === true;
    return ra;
  });
}

$("nut-mau").addEventListener("click", () => { bao($("loi3"), ""); dienMau(); });
$("nut-chep").addEventListener("click", () => { bao($("loi3"), ""); chepMoiNhat(); });
$("nut-them-bac").addEventListener("click", () => {
  const cuoi = bac[bac.length - 1];
  if (cuoi?.dau_thau_chinh_thuc === true) {
    // Bậc đấu thầu chính thức chỉ đứng cuối (`069`): bậc mới chen TRƯỚC nó, cận dưới ở giữa hai hàng xóm — người khai sửa.
    const truoc = bac[bac.length - 2];
    bac.splice(bac.length - 1, 0, bacThuong(truoc === undefined ? 0 : Math.floor((truoc.tu_so_tien + cuoi.tu_so_tien) / 2)));
  } else {
    bac.push(bacThuong(cuoi === undefined ? 0 : cuoi.tu_so_tien * 10));
  }
  veBac();
});
$("nut-xoa-bac").addEventListener("click", () => { bac.pop(); veBac(); });
$("nguong").addEventListener("input", () => tinhLai());

$("nut-tao-pb").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  const moiNhat = trangThai.phienBan[0];
  const soNguyenHoacNull = (v) => (v.trim() === "" ? null : Number(v));
  const than = {
    version: (moiNhat?.version ?? 0) + 1,
    dualApprovalThreshold: $("nguong").value.trim(),
    currency: $("tien-te").value.trim(),
    tiers: bac.length === 0 ? null : bacGuiLen(),
    chiaNhoCuaSoNgay: soNguyenHoacNull($("chia-nho").value),
    thamDinhHieuLucThang: soNguyenHoacNull($("tham-dinh").value),
  };
  $("nut-tao-pb").disabled = true;
  try {
    const r = await goi("POST", "/policy", than);
    if (r.status !== 201) { bao($("loi3"), loiCua(r, "Không tạo được phiên bản")); return; }
    bao($("ok3"), `Đã tạo phiên bản ${r.body?.policy?.version}. ${than.tiers === null ? "" : "Một người KHÁC giữ quyền khai chính sách phải ký nó trước khi nó có hiệu lực."}`);
    await napPhienBan();
  } finally {
    $("nut-tao-pb").disabled = false;
  }
});

// [S1.9102] Cuối tệp: mọi `let` của trang đã khởi tạo khi `moSauDangNhap` chạy.
thuPhienCo();

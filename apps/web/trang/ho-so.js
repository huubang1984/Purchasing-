// ==============================================================================================
// [S1.287 / S3.7a1 / ADR-081] MÀN HỒ SƠ NHÀ CUNG CẤP (PASSPORT) — mã này chạy trên máy NHÀ CUNG CẤP, thường là điện thoại.
//
// Khuôn `nop-thau.js`: link `/ho-so#<orgId>:<token>` → OTP khác kênh → phiên (cookie `__Host-tp_passport`, mã phiên không đi qua
// JavaScript) → form → mỗi lần nộp một phiên bản. Kiểm form sớm bằng `/lib/ho-so.js`; máy chủ là thẩm quyền.
// Ba điều tệp này CỐ Ý không làm: không giữ số tài khoản sau khi gửi (ô xoá ngay); không đọc lại số tài khoản (máy chủ chỉ trả bốn
// số cuối); không mở phiên còn hạn mà không hỏi (máy dùng chung).
// ==============================================================================================

import { dongPhienBan, kiemHoSo } from "/lib/ho-so.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

let phien = { orgId: "", token: "" };
/** Thế hệ của màn: tăng mỗi lần các bước đóng về bước 1; phản hồi về muộn của lượt cũ bị bỏ (khuôn `nop-thau.js`). */
let theHe = 0;

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

const THAN_403 = "khong co quyen";
// [lượt đi thử T4] Hằng 401 của máy chủ không dấu và không nói gì với nhà cung cấp; trang nói thay.
const THAN_401 = "phien khong hop le";
/** Lý do từ chối của `POST /guest/passport/otp/verify` — gọi tên từng ca thay vì «mã 401». */
const CAU_XAC_MINH = {
  WRONG_CODE: "Mã không đúng.",
  EXPIRED: "Mã đã hết hạn — bấm «Gửi mã» để nhận mã mới.",
  LOCKED_OUT: "Sai quá nhiều lần — link này tạm khoá 15 phút. Thử lại sau, hay xin bên mua gửi link mới.",
  ALREADY_USED: "Mã này đã dùng rồi — bấm «Gửi mã» để nhận mã mới.",
  NO_CHALLENGE: "Chưa có mã nào cho link này — bấm «Gửi mã» trước.",
};

function loiCua(r, macDinh) {
  if (r.status === 403 && r.body?.error === THAN_403) {
    return `${macDinh}: phiên hồ sơ này không có quyền làm việc này. Mở lại đúng link bên mua gửi; vẫn bị từ chối thì báo cho bên mua.`;
  }
  if (r.status === 401 && r.body?.error === THAN_401) {
    return `${macDinh}: phiên hồ sơ đã hết hạn hay đã bị thu hồi (bên mua vừa gửi link mới?). Mở link mới nhất bên mua gửi.`;
  }
  if (r.status === 401 && typeof r.body?.reason === "string" && Object.hasOwn(CAU_XAC_MINH, r.body.reason)) {
    return CAU_XAC_MINH[r.body.reason];
  }
  if (r.body !== null && typeof r.body === "object" && typeof r.body.error === "string") return r.body.error;
  return `${macDinh} (mã ${r.status})`;
}

function docLink() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) { $("token").value = ""; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}

/** Xoá mảnh link khỏi thanh địa chỉ SAU lần xác minh (mã yêu cầu đã tiêu thụ) — ADR-020 mục 3. */
function xoaManhLink() {
  try { history.replaceState(null, "", location.pathname + location.search); } catch { /* không xoá được thì thôi */ }
}

const O_FORM = ["ten-phap-ly", "mst", "nguoi-dai-dien", "dia-chi", "ngan-hang", "so-tai-khoan", "chung-nhan", "nhom-hang"];

function dongCacBuoc() {
  theHe += 1;
  for (const b of ["b1", "b2"]) $(b).classList.remove("xong");
  for (const b of ["b2", "b3"]) hien($(b), false);
  $("tt-moi").replaceChildren();
  hien($("tt-moi"), false);
  $("ncc-ten").textContent = "";
  for (const id of O_FORM) $(id).value = "";
  $("ma").value = "";
  for (const id of ["loi3", "ok3"]) bao($(id), "");
  boHoiPhien();
  hien($("nut-thoat"), false);
}

$("nut-mo").addEventListener("click", async () => {
  bao($("loi1"), "");
  const orgId = $("org").value.trim();
  const token = $("token").value.trim();
  if (orgId === "" || token === "") { bao($("loi1"), "Cần cả mã tổ chức và mã yêu cầu."); return; }
  $("nut-mo").disabled = true;
  const the = theHe;
  const r = await goi("POST", "/guest/passport/redeem", { orgId, token });
  $("nut-mo").disabled = false;
  if (the !== theHe) return;
  if (r.status !== 200) { bao($("loi1"), loiCua(r, "Không mở được yêu cầu hồ sơ")); return; }
  dongCacBuoc();
  phien = { orgId, token };
  bao($("ok1"), "Yêu cầu hồ sơ hợp lệ.");
  const kenh = $("kenh");
  kenh.replaceChildren();
  for (const k of r.body?.otpChannels ?? []) {
    const o = document.createElement("option");
    o.value = k; o.textContent = k;
    kenh.append(o);
  }
  $("b1").classList.add("xong");
  hien($("b2"), true);
  $("ma").focus();
});

$("nut-gui").addEventListener("click", async () => {
  bao($("loi2"), "");
  const r = await goi("POST", "/guest/passport/otp", { orgId: phien.orgId, token: phien.token, channel: $("kenh").value });
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không gửi được mã")); return; }
  bao($("ok2"), "Đã gửi. Mã có sáu chữ số và hết hạn nhanh.");
});

$("nut-xac").addEventListener("click", async () => {
  bao($("loi2"), "");
  const code = $("ma").value.trim();
  if (!/^\d{6}$/.test(code)) { bao($("loi2"), "Mã phải là sáu chữ số."); return; }
  $("nut-xac").disabled = true;
  const the = theHe;
  const r = await goi("POST", "/guest/passport/otp/verify", { orgId: phien.orgId, token: phien.token, code });
  $("nut-xac").disabled = false;
  if (the !== theHe) return;
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Mã không đúng")); return; }
  xoaManhLink();
  bao($("ok2"), "Đã xác minh. Phiên nằm trong cookie, mã phiên không đi qua JavaScript.");
  $("b2").classList.add("xong");
  hien($("nut-thoat"), true);
  await napHoSo();
});

/** Đọc `GET /passport`, điền form từ phiên bản mới nhất (TRỪ số tài khoản), hiện tóm tắt. Trả `false` khi phiên không còn. */
async function napHoSo() {
  const the = theHe;
  const r = await goi("GET", "/passport");
  if (the !== theHe) return false;
  if (r.status !== 200) { bao($("loi3"), loiCua(r, "Không đọc được hồ sơ")); return false; }
  const ncc = r.body?.nhaCungCap ?? {};
  $("ncc-ten").textContent = typeof ncc.legalName === "string"
    ? `Hồ sơ của «${ncc.legalName}» với bên mua này${typeof ncc.taxCode === "string" ? ` — MST bên mua đang giữ: ${ncc.taxCode}` : ""}.`
    : "";
  const pb = r.body?.phienBanMoiNhat ?? null;
  const tt = $("tt-moi");
  tt.replaceChildren();
  if (pb !== null) {
    for (const [nhan, giaTri] of dongPhienBan(pb)) {
      const dt = document.createElement("dt"); dt.textContent = nhan;
      const dd = document.createElement("dd"); dd.textContent = giaTri;
      tt.append(dt, dd);
    }
    $("ten-phap-ly").value = pb.legalName ?? "";
    $("mst").value = pb.taxCode ?? "";
    $("nguoi-dai-dien").value = pb.nguoiDaiDien ?? "";
    $("dia-chi").value = pb.diaChi ?? "";
    $("ngan-hang").value = pb.nganHang ?? "";
    $("chung-nhan").value = Array.isArray(pb.chungNhan) ? pb.chungNhan.join("\n") : "";
    $("nhom-hang").value = Array.isArray(pb.nhomHang) ? pb.nhomHang.join("\n") : "";
  } else if (typeof ncc.legalName === "string") {
    $("ten-phap-ly").value = ncc.legalName;
    $("mst").value = typeof ncc.taxCode === "string" ? ncc.taxCode : "";
  }
  hien(tt, pb !== null);
  hien($("b3"), true);
  return true;
}

$("nut-nop").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  const kq = kiemHoSo({
    legalName: $("ten-phap-ly").value,
    taxCode: $("mst").value,
    nguoiDaiDien: $("nguoi-dai-dien").value,
    diaChi: $("dia-chi").value,
    nganHang: $("ngan-hang").value,
    soTaiKhoan: $("so-tai-khoan").value,
    chungNhan: $("chung-nhan").value,
    nhomHang: $("nhom-hang").value,
  });
  if (kq.loi !== null) { bao($("loi3"), kq.loi); return; }
  $("nut-nop").disabled = true;
  const the = theHe;
  try {
    const r = await goi("POST", "/passport/versions", kq.than);
    if (the !== theHe) return;
    if (r.status !== 201) { bao($("loi3"), loiCua(r, "Không nộp được hồ sơ")); return; }
    // Số tài khoản không ở lại trên màn sau khi đã gửi.
    $("so-tai-khoan").value = "";
    const thuTu = r.body?.phienBan?.thuTu;
    bao($("ok3"), `Đã nộp phiên bản #${String(thuTu ?? "?")}. Bên mua thẩm định phiên bản mới nhất — nộp thêm là thay phiên bản ấy.`);
    await napHoSo();
  } catch {
    if (the === theHe) bao($("loi3"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    $("nut-nop").disabled = false;
  }
});

// Hỏi lại phiên lúc tải — khuôn `thuPhienKhach` của `nop-thau.js`: ô mã rỗng thì hỏi `GET /passport`; 200 thì HỎI, không tự mở.
let phienCho = false;

async function thuPhien() {
  if ($("token").value.trim() !== "") return;
  const the = theHe;
  try {
    const r = await goi("GET", "/passport");
    if (the !== theHe || $("token").value.trim() !== "") return;
    if (r.status !== 200 || typeof r.body?.nhaCungCap?.legalName !== "string") return;
    phienCho = true;
    bao($("hoi-phien"), `Trình duyệt này đang giữ một phiên hồ sơ còn hạn của «${r.body.nhaCungCap.legalName}». Đúng là doanh nghiệp ` +
      "của anh/chị thì bấm Tiếp tục. Không phải thì bấm Thoát phiên hồ sơ, rồi mở link của mình.");
    hien($("nut-dung-phien"), true);
    hien($("nut-thoat"), true);
  } catch { /* mất mạng: trang ở lại bước 1 */ }
}

function boHoiPhien() {
  phienCho = false;
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
}

$("nut-dung-phien").addEventListener("click", async () => {
  if (!phienCho) return;
  boHoiPhien();
  bao($("loi1"), "");
  const the = theHe;
  let duoc = false;
  try { duoc = await napHoSo(); } catch {
    if (the === theHe) bao($("loi1"), "Không kết nối được máy chủ. Kiểm tra mạng rồi tải lại trang.");
    return;
  }
  if (the !== theHe) return;
  if (!duoc) {
    hien($("b3"), false);
    bao($("loi3"), "");
    hien($("nut-thoat"), false);
    bao($("loi1"), "Phiên hồ sơ đã hết hạn hay đã bị thu hồi — xin bên mua gửi link mới.");
    return;
  }
  bao($("ok1"), "Đang dùng phiên hồ sơ còn hạn. Xong trên máy dùng chung thì bấm Thoát phiên hồ sơ.");
  $("b1").classList.add("xong");
});

$("nut-thoat").addEventListener("click", async () => {
  for (const id of ["loi1", "ok1"]) bao($(id), "");
  $("nut-thoat").disabled = true;
  const the = theHe;
  try {
    const r = await goi("POST", "/passport/logout");
    if (the !== theHe) return;
    if (r.status !== 200 && r.status !== 401) { bao($("loi1"), loiCua(r, "Không thoát được phiên hồ sơ")); return; }
    phien = { orgId: $("org").value.trim(), token: $("token").value.trim() };
    for (const id of ["loi2", "ok2"]) bao($(id), "");
    dongCacBuoc();
    bao($("ok1"), "Đã thoát phiên hồ sơ trên trình duyệt này. Muốn cập nhật nữa thì xin bên mua gửi link mới.");
  } catch {
    if (the === theHe) bao($("loi1"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    $("nut-thoat").disabled = false;
  }
});

window.addEventListener("hashchange", () => {
  docLink();
  phien = { orgId: $("org").value.trim(), token: $("token").value.trim() };
  for (const id of ["loi1", "loi2", "ok1", "ok2"]) bao($(id), "");
  dongCacBuoc();
  thuPhien();
});

docLink();
thuPhien();

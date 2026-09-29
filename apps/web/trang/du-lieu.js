// ==============================================================================================
// [S1.9101 / S4.2b] MÀN DỮ LIỆU NỀN — spec S4 §3.5 (`/du-lieu`), §4.2, §4.3, §8.10
//
// Bốn việc: ⑴ danh sách hàng chuẩn, lọc trên màn; ⑵ tạo hàng chuẩn; ⑶ chi tiết một hàng — phiên bản, bí danh, quy đổi riêng —
// và ghi thêm vào từng thứ; ⑷ danh mục đơn vị cùng bí danh đơn vị của tổ chức. Mọi luật nằm ở máy chủ và CSDL (`083`): màn
// không kiểm lại luật nào, nó chỉ nói trước điều máy chủ sẽ nói (`/lib/du-lieu.js` — một bản cài, `tsc` gác, vitest đo).
//
// Phần GHI chỉ hiện khi `GET /items` trả `choGhi`; không thì màn nói câu §8.10 — vai quản lý dữ liệu là một NGƯỜI MỚI, không
// ghép được với người Tài chính sẵn có. Cổng thật vẫn là mã `item.manage` của route ghi và trigger ở CSDL.
//
// Trang không chèn chuỗi nào của máy chủ vào HTML: mọi ô đi qua `textContent`.
// ==============================================================================================

import { cauVaiQuanLy, docThuocTinh, docTrongYeu, heSoHopLe, locHangChuan, maHopLe, moTaQuyDoi, vietThuocTinh } from "/lib/du-lieu.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

let phien = { token: "", daRedeem: false };
let trangThai = { hangChuan: [], conNua: false, choGhi: false, soNguoiQuanLy: 0 };
let danhMuc = { donVi: [], biDanhChung: [], biDanhToChuc: [] };
/** Chi tiết hàng chuẩn đang mở ở bước 4 — `null` khi bước 4 đóng. */
let dangXem = null;

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
  if (r.status === 403) return `${macDinh}: bạn không giữ quyền quản lý dữ liệu (mã 403)`;
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

/**
 * Một nút ghi chạy MỘT lần mỗi lượt: nút khoá trong lúc lời gọi còn bay. Lượt đi thử T4 đo được bấm đúp *"Thêm phiên bản"* ghi hai
 * phiên bản giống hệt nhau, và *"Khai bí danh"* hai hàng sổ — máy chủ ghi thêm, không gộp bản trùng, nên chặn là việc của màn.
 */
function motLan(nut, viec) {
  return async () => {
    if (nut.disabled) return;
    nut.disabled = true;
    try { await viec(); } finally { nut.disabled = false; }
  };
}

function oNut(chu, viec) {
  const td = document.createElement("td");
  const b = document.createElement("button");
  b.className = "phu";
  b.textContent = chu;
  b.addEventListener("click", motLan(b, viec));
  td.append(b);
  return td;
}

const luc = (iso) => new Date(iso).toLocaleString("vi-VN");
const TRANG_THAI = { DANG_DUNG: "đang dùng", NGUNG_DUNG: "ngừng dùng" };

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: magic link + TOTP, cùng khuôn `chinh-sach.js` (gọi `/auth/redeem` ĐÚNG một lần cho mỗi mã).
// ---------------------------------------------------------------------------------------------

function docLink() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) { if (h !== "") $("token").value = h; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}
docLink();
window.addEventListener("hashchange", () => {
  docLink();
  phienCho = null;
  phien = { token: $("token").value.trim(), daRedeem: false };
  for (const id of ["loi1", "ok1", "ghi-danh", "loi2", "loi3", "ok3", "loi4", "ok4", "loi5", "ok5"]) bao($(id), "");
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

/** Bước 3 chỉ mở cho người ghi được; bước 4 mở khi bấm Xem một hàng. */
const CAC_BUOC_SAU = ["b2", "b5"];

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
  await napHangChuan();
  await napDonVi();
}

function dongCacBuoc() {
  $("b1").classList.remove("xong");
  for (const b of [...CAC_BUOC_SAU, "b3", "b4"]) hien($(b), false);
  xoaChiTiet();
  trangThai = { hangChuan: [], conNua: false, choGhi: false, soNguoiQuanLy: 0 };
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), false);
}

/**
 * Cùng khuôn `chinh-sach.js` (S1.177): phiên người mua là cookie sống tới 8 giờ, dùng chung các trang, nên lúc tải trang hỏi
 * `/me`; có phiên còn hạn thì HỎI, không tự mở — trên máy dùng chung phiên ấy có thể của người khác.
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
thuPhienCo();

$("nut-dung-phien").addEventListener("click", async () => {
  if (phienCho === null) return;
  const me = phienCho;
  phienCho = null;
  await moSauDangNhap(me, true);
});

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
// Bước 2 — danh sách hàng chuẩn, và câu §8.10
// ---------------------------------------------------------------------------------------------

async function napHangChuan() {
  bao($("loi2"), "");
  const r = await goi("GET", "/items");
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được danh sách hàng chuẩn")); return; }
  trangThai = {
    hangChuan: Array.isArray(r.body?.hangChuan) ? r.body.hangChuan : [],
    conNua: r.body?.conNua === true,
    choGhi: r.body?.choGhi === true,
    soNguoiQuanLy: typeof r.body?.soNguoiQuanLy === "number" ? r.body.soNguoiQuanLy : 0,
  };
  bao($("vai-quan-ly"), cauVaiQuanLy(trangThai.choGhi, trangThai.soNguoiQuanLy) ?? "");
  hien($("b3"), trangThai.choGhi);
  for (const id of ["khoi-phien-ban", "khoi-bi-danh", "khoi-quy-doi", "khoi-bi-danh-dv"]) hien($(id), trangThai.choGhi);
  bao($("con-nua"), trangThai.conNua
    ? `Màn hiện ${trangThai.hangChuan.length} hàng chuẩn đầu tiên theo mã; tổ chức còn hàng khác. Ô lọc chỉ lọc trên những hàng đang hiện.`
    : "");
  veHangChuan();
}

function veHangChuan() {
  const tb = $("bang-hang").querySelector("tbody");
  tb.replaceChildren();
  for (const h of locHangChuan(trangThai.hangChuan, $("loc").value)) {
    const tr = document.createElement("tr");
    tr.append(o(h.ma), o(h.ten), o(h.donViGoc), o(TRANG_THAI[h.trangThai] ?? h.trangThai), oNut("Xem", () => { void moChiTiet(h.id); }));
    tb.append(tr);
  }
}

$("loc").addEventListener("input", veHangChuan);
$("nut-doc-hang").addEventListener("click", () => { void napHangChuan(); });

// ---------------------------------------------------------------------------------------------
// Bước 3 — tạo hàng chuẩn
// ---------------------------------------------------------------------------------------------

$("nut-tao").addEventListener("click", motLan($("nut-tao"), async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  const ma = $("tao-ma").value.trim();
  if (!maHopLe(ma)) { bao($("loi3"), "Mã viết hoa, bắt đầu bằng chữ hoặc số, chỉ chữ, số, dấu chấm, gạch ngang, gạch dưới — tối đa 40 ký tự."); return; }
  const tt = docThuocTinh($("tao-thuoc-tinh").value);
  if (!tt.ok) { bao($("loi3"), tt.loi); return; }
  const ty = docTrongYeu($("tao-trong-yeu").value, tt.thuocTinh);
  if (!ty.ok) { bao($("loi3"), ty.loi); return; }
  const r = await goi("POST", "/items", {
    ma, donViGoc: $("tao-don-vi").value.trim(), ten: $("tao-ten").value.trim(), thuocTinh: tt.thuocTinh, thuocTinhTrongYeu: ty.khoa,
  });
  if (r.status !== 201) { bao($("loi3"), loiCua(r, "Không tạo được hàng chuẩn")); return; }
  bao($("ok3"), `Đã tạo ${r.body?.hangChuan?.ma ?? ma}, đơn vị gốc ${r.body?.hangChuan?.donViGoc ?? ""}.`);
  await napHangChuan();
  if (typeof r.body?.hangChuan?.id === "string") await moChiTiet(r.body.hangChuan.id);
}));

// ---------------------------------------------------------------------------------------------
// Bước 4 — chi tiết một hàng chuẩn
// ---------------------------------------------------------------------------------------------

/** Bước 4 trống: không hàng nào đang mở, không bảng nào mang dữ liệu của hàng trước — mọi nút ghi của bước ấy không có đích. */
function xoaChiTiet() {
  dangXem = null;
  $("tt-hang").replaceChildren();
  for (const id of ["bang-phien-ban", "bang-bi-danh", "bang-quy-doi"]) $(id).querySelector("tbody").replaceChildren();
}

async function moChiTiet(id) {
  bao($("loi4"), ""); bao($("ok4"), "");
  const r = await goi("GET", `/items/${id}`);
  // Lượt đi thử T4 (đọc mã): đọc hỏng mà giữ `dangXem` cũ thì bước 4 hiện hàng trước và các nút ghi ghi vào hàng trước.
  if (r.status !== 200) { xoaChiTiet(); bao($("loi4"), loiCua(r, "Không đọc được hàng chuẩn")); hien($("b4"), true); return; }
  dangXem = r.body;
  const h = dangXem.hangChuan;
  dienDl($("tt-hang"), [
    ["Mã", h.ma],
    ["Đơn vị gốc", h.donViGoc],
    ["Tên", h.ten],
    ["Trạng thái", TRANG_THAI[h.trangThai] ?? h.trangThai],
  ]);
  const pb = $("bang-phien-ban").querySelector("tbody");
  pb.replaceChildren();
  // Cột *"Bản"* đếm phiên bản của CHÍNH hàng này, cũ nhất là 1. `seq` là thứ tự ghi chung cả tổ chức (`UNIQUE (org_id, seq)`) —
  // lượt đi thử T4 thấy hàng vừa tạo mang phiên bản *"4"*, dễ đọc thành số bản.
  for (const [i, p] of dangXem.phienBan.entries()) {
    const tr = document.createElement("tr");
    tr.append(o(String(dangXem.phienBan.length - i), "so"), o(p.ten), o(vietThuocTinh(p.thuocTinh).replace(/\n/gu, "; ")), o(p.thuocTinhTrongYeu.join(", ")),
      o(TRANG_THAI[p.trangThai] ?? p.trangThai), o(p.tacGia), o(luc(p.ghiLuc)));
    pb.append(tr);
  }
  $("pb-ten").value = h.ten;
  $("pb-thuoc-tinh").value = vietThuocTinh(h.thuocTinh);
  $("pb-trong-yeu").value = h.thuocTinhTrongYeu.join(", ");
  $("pb-ngung").checked = h.trangThai === "NGUNG_DUNG";
  const bd = $("bang-bi-danh").querySelector("tbody");
  bd.replaceChildren();
  for (const b of dangXem.biDanh) {
    const tr = document.createElement("tr");
    tr.append(o(b.biDanhSach), o(b.tacGia), o(luc(b.ghiLuc)));
    tr.append(trangThai.choGhi ? oNut("Rút", () => { void ghiChiTiet("aliases/withdraw", { biDanh: b.biDanhSach }, `Đã rút bí danh "${b.biDanhSach}".`); }) : o(""));
    bd.append(tr);
  }
  const qd = $("bang-quy-doi").querySelector("tbody");
  qd.replaceChildren();
  for (const q of dangXem.quyDoi) {
    const tr = document.createElement("tr");
    tr.append(o(moTaQuyDoi(q)), o(q.tacGia), o(luc(q.ghiLuc)));
    tr.append(trangThai.choGhi
      ? oNut("Rút", () => { void ghiChiTiet("conversions/withdraw", { tuDonVi: q.tuDonVi, sangDonVi: q.sangDonVi }, `Đã rút quy đổi ${moTaQuyDoi(q)}.`); })
      : o(""));
    qd.append(tr);
  }
  hien($("b4"), true);
}

/** Một lần ghi vào hàng chuẩn đang mở, rồi đọc lại cả chi tiết lẫn danh sách — màn không tự đoán kết quả. */
async function ghiChiTiet(duoi, than, cauOk) {
  bao($("loi4"), ""); bao($("ok4"), "");
  if (dangXem === null) { bao($("loi4"), "Chưa mở hàng chuẩn nào."); return; }
  const id = dangXem.hangChuan.id;
  const r = await goi("POST", `/items/${id}/${duoi}`, than);
  if (r.status !== 201) { bao($("loi4"), loiCua(r, "Máy chủ từ chối")); return; }
  await moChiTiet(id);
  await napHangChuan();
  bao($("ok4"), cauOk);
}

$("nut-phien-ban").addEventListener("click", motLan($("nut-phien-ban"), async () => {
  bao($("loi4"), ""); bao($("ok4"), "");
  const tt = docThuocTinh($("pb-thuoc-tinh").value);
  if (!tt.ok) { bao($("loi4"), tt.loi); return; }
  const ty = docTrongYeu($("pb-trong-yeu").value, tt.thuocTinh);
  if (!ty.ok) { bao($("loi4"), ty.loi); return; }
  await ghiChiTiet("versions", {
    ten: $("pb-ten").value.trim(), thuocTinh: tt.thuocTinh, thuocTinhTrongYeu: ty.khoa, trangThai: $("pb-ngung").checked ? "NGUNG_DUNG" : "DANG_DUNG",
  }, "Đã thêm phiên bản.");
}));

$("nut-bi-danh").addEventListener("click", motLan($("nut-bi-danh"), async () => {
  bao($("loi4"), ""); bao($("ok4"), "");
  const biDanh = $("bd-moi").value.trim();
  if (biDanh === "") { bao($("loi4"), "Nhập bí danh."); return; }
  await ghiChiTiet("aliases", { biDanh }, "Đã khai bí danh.");
  if ($("loi4").hidden) $("bd-moi").value = "";
}));

$("nut-quy-doi").addEventListener("click", motLan($("nut-quy-doi"), async () => {
  bao($("loi4"), ""); bao($("ok4"), "");
  const heSo = $("qd-he-so").value.trim();
  if (!heSoHopLe(heSo)) { bao($("loi4"), "Hệ số là số thập phân dương, dùng dấu chấm: 7.22"); return; }
  await ghiChiTiet("conversions", { tuDonVi: $("qd-tu").value.trim(), sangDonVi: $("qd-sang").value.trim(), heSo }, "Đã khai quy đổi riêng.");
}));

// ---------------------------------------------------------------------------------------------
// Bước 5 — đơn vị đo
// ---------------------------------------------------------------------------------------------

const THU_NGUYEN = { KHOI_LUONG: "khối lượng", CHIEU_DAI: "chiều dài", DIEN_TICH: "diện tích", THE_TICH: "thể tích", DEM: "đếm" };

async function napDonVi() {
  bao($("loi5"), "");
  const r = await goi("GET", "/uom");
  if (r.status !== 200) { bao($("loi5"), loiCua(r, "Không đọc được danh mục đơn vị")); return; }
  danhMuc = {
    donVi: Array.isArray(r.body?.donVi) ? r.body.donVi : [],
    biDanhChung: Array.isArray(r.body?.biDanhChung) ? r.body.biDanhChung : [],
    biDanhToChuc: Array.isArray(r.body?.biDanhToChuc) ? r.body.biDanhToChuc : [],
  };
  const dv = $("bang-don-vi").querySelector("tbody");
  dv.replaceChildren();
  for (const d of danhMuc.donVi) {
    const chung = danhMuc.biDanhChung.filter((b) => b.code === d.code && b.biDanhSach !== d.code).map((b) => b.biDanhSach);
    const tr = document.createElement("tr");
    tr.append(o(d.code), o(THU_NGUYEN[d.thuNguyen] ?? d.thuNguyen), o(d.heSoVeGoc, "so"), o(chung.join(", ")));
    dv.append(tr);
  }
  const tc = $("bang-bi-danh-dv").querySelector("tbody");
  tc.replaceChildren();
  for (const b of danhMuc.biDanhToChuc) {
    const tr = document.createElement("tr");
    tr.append(o(b.biDanhSach), o(b.code), o(b.tacGia), o(luc(b.ghiLuc)));
    tr.append(trangThai.choGhi ? oNut("Rút", () => { void ghiDonVi("/uom/aliases/withdraw", { biDanh: b.biDanhSach }, `Đã rút bí danh "${b.biDanhSach}".`); }) : o(""));
    tc.append(tr);
  }
}

async function ghiDonVi(duong, than, cauOk) {
  bao($("loi5"), ""); bao($("ok5"), "");
  const r = await goi("POST", duong, than);
  if (r.status !== 201) { bao($("loi5"), loiCua(r, "Máy chủ từ chối")); return; }
  await napDonVi();
  bao($("ok5"), cauOk);
}

$("nut-bi-danh-dv").addEventListener("click", motLan($("nut-bi-danh-dv"), async () => {
  bao($("loi5"), ""); bao($("ok5"), "");
  const biDanh = $("bdv-moi").value.trim();
  const donVi = $("bdv-don-vi").value.trim();
  if (biDanh === "" || donVi === "") { bao($("loi5"), "Nhập cả bí danh và đơn vị."); return; }
  await ghiDonVi("/uom/aliases", { biDanh, donVi }, `Đã khai "${biDanh}" là ${donVi}.`);
}));

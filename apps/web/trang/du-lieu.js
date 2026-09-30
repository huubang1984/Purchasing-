// ==============================================================================================
// [S1.199 / S4.2b] MÀN DỮ LIỆU NỀN — spec S4 §3.5 (`/du-lieu`), §4.2, §4.3, §8.10
//
// Bốn việc: ⑴ danh sách hàng chuẩn, lọc trên màn; ⑵ tạo hàng chuẩn; ⑶ chi tiết một hàng — phiên bản, bí danh, quy đổi riêng —
// và ghi thêm vào từng thứ; ⑷ danh mục đơn vị cùng bí danh đơn vị của tổ chức. [S1.234 / S4.3b] Việc thứ năm: ⑸ hàng đợi ánh xạ —
// duyệt (kèm khai bí danh, để hàng đợi học), bác, tạo hàng chuẩn mới rồi duyệt, chuẩn hoá lại cả gói; luật ở trigger `089`. Mọi luật nằm ở máy chủ và CSDL (`083`): màn
// không kiểm lại luật nào, nó chỉ nói trước điều máy chủ sẽ nói (`/lib/du-lieu.js` — một bản cài, `tsc` gác, vitest đo).
//
// Phần GHI chỉ hiện khi `GET /items` trả `choGhi`; không thì màn nói câu §8.10 — vai quản lý dữ liệu là một NGƯỜI MỚI, không
// ghép được với người Tài chính sẵn có. Cổng thật vẫn là mã `item.manage` của route ghi và trigger ở CSDL.
//
// Trang không chèn chuỗi nào của máy chủ vào HTML: mọi ô đi qua `textContent`.
// ==============================================================================================

import {
  cauVaiQuanLy, docThuocTinh, docTrongYeu, heSoHopLe, locHangChuan, locHangDoi, luaChonHangChuan, maHopLe, moTaQuyDoi, nhanGoiY, vietThuocTinh,
} from "/lib/du-lieu.js";
import { ganDangNhap } from "/lib/dang-nhap.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

// [S1.249 / khoản 291] ~~`let phien = { token: "", daRedeem: false };`~~ — mã đăng nhập và "đã đổi ở máy chủ chưa" nay sống trong
// `/lib/dang-nhap.js`, như ở bốn trang người mua kia (khoản 282).
let trangThai = { hangChuan: [], conNua: false, choGhi: false, soNguoiQuanLy: 0 };
let danhMuc = { donVi: [], biDanhChung: [], biDanhToChuc: [] };
/** Chi tiết hàng chuẩn đang mở ở bước 4 — `null` khi bước 4 đóng. */
let dangXem = null;
/** [S1.234 / S4.3b] Hàng đợi đang hiện ở bước 6, và dòng đang mở ở khối xử lý — `null` khi khối đóng. */
let hangDoi = { dong: [], conNua: false };
let dangXuLy = null;

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
// [S1.249 / khoản 291] ~~Cùng khuôn~~ CÙNG MỘT BẢN với `/login` và ba trang người mua kia: nút Tiếp, nút Vào và khối link đăng nhập
// gần đây là `/lib/dang-nhap.js`; trang giữ `docLink`, lối hỏi lại phiên, đăng xuất và `hashchange`, và gọi `dangNhap.datLai()` khi về
// bước 1.
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
  // [S1.249 / khoản 291] ~~`phien = { token: …, daRedeem: false };`~~ — `dangNhap.datLai()` dưới, sau khi các bước đã đóng.
  for (const id of ["loi1", "ok1", "ghi-danh", "loi2", "loi3", "ok3", "loi4", "ok4", "loi5", "ok5", "loi6", "ok6"]) bao($(id), "");
  dongCacBuoc();
  dangNhap.datLai();
  thuPhienCo();
});

// [S1.249 / khoản 291] ~~Trình nghe `nut-vao` chép của `/login` cũ: `/auth/redeem` rồi `/auth/totp` trong một lượt, bí mật TOTP hiện
// cùng chỗ câu lỗi, ô mã sáu số hiện sẵn, mất mạng thì không câu nào~~ — khoản 193 ở trang thứ năm, mà phép đếm của khoản 282 bỏ sót.
// Nay bước 1 là module chung: ô tổ chức đọc qua `docMaToChuc` (ADR-107), bí mật ghi danh ở khối riêng; trang trao cho module việc của
// riêng mình sau khi vào — mở các bước và nạp dữ liệu nền.
const dangNhap = ganDangNhap({ taiLieu: document, goi, lichSu: history, viTri: location, daVao: (me) => moSauDangNhap(me, false) });

/** Bước 3 chỉ mở cho người ghi được; bước 4 mở khi bấm Xem một hàng. */
const CAC_BUOC_SAU = ["b2", "b5", "b6"];

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
  // [S1.249 / khoản 291] Khối link đăng nhập gần đây (khoản 195, 268) — trước lời gọi riêng của màn, không chờ.
  void dangNhap.veLinkGanDay();
  await napHangChuan();
  await napDonVi();
  await napHangDoi();
}

function dongCacBuoc() {
  $("b1").classList.remove("xong");
  for (const b of [...CAC_BUOC_SAU, "b3", "b4"]) hien($(b), false);
  xoaChiTiet();
  xoaXuLy();
  hangDoi = { dong: [], conNua: false };
  $("bang-hang-doi").querySelector("tbody").replaceChildren();
  trangThai = { hangChuan: [], conNua: false, choGhi: false, soNguoiQuanLy: 0 };
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), false);
  // [S1.249 / khoản 291] Về bước 1: danh sách link của người trước đi, và phản hồi về muộn của nó bị bỏ.
  dangNhap.anLinkGanDay();
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
    dongCacBuoc();
    // [S1.249 / khoản 291] ~~`phien = { token: …, daRedeem: false };`~~ Mã đang ở ô phải đổi lại ở máy chủ trước lần vào sau; ô mã
    // sáu số đóng (khoản 193).
    dangNhap.datLai();
    bao($("ok1"), "Đã đăng xuất. Trình duyệt này không còn giữ phiên của bạn.");
  } catch {
    bao($("loi1"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    $("nut-dang-xuat").disabled = false;
  }
});

// [S1.249 / khoản 291] ~~`xoaManhLink()` của trang~~ — ADR-020 mục 3 (xoá mảnh link SAU `/auth/totp`) nay là việc của nút Vào trong
// `/lib/dang-nhap.js`, qua `history` và `location` mà trang trao vào.

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

// ---------------------------------------------------------------------------------------------
// [S1.234 / S4.3b] Bước 6 — hàng đợi ánh xạ (spec S4 §4.4). Đọc mở cho người mua của tổ chức; nút xử lý chỉ hiện khi `choGhi`.
// Mọi luật ở trigger `089`: người trong tập loại trừ của gói, lý do sau khi mở niêm phong, bác sau GOI_Y — máy chủ nói, màn in.
// ---------------------------------------------------------------------------------------------

async function napHangDoi() {
  bao($("loi6"), "");
  const r = await goi("GET", "/mapping-queue");
  if (r.status !== 200) { bao($("loi6"), loiCua(r, "Không đọc được hàng đợi ánh xạ")); return; }
  hangDoi = { dong: Array.isArray(r.body?.dong) ? r.body.dong : [], conNua: r.body?.conNua === true };
  bao($("con-nua-hd"), hangDoi.conNua
    ? `Màn hiện ${hangDoi.dong.length} dòng cũ nhất; hàng đợi còn dòng khác. Xử lý bớt rồi bấm Đọc lại.`
    : hangDoi.dong.length === 0 ? "Hàng đợi trống — mọi dòng của các gói đã nộp đều đã nối với hàng chuẩn hoặc đã được bác." : "");
  // Dòng đang mở mà không còn trong hàng đợi (người khác vừa xử lý) thì đóng khối — nút ghi không có đích cũ.
  if (dangXuLy !== null && !hangDoi.dong.some((d) => d.rfqId === dangXuLy.rfqId && d.lineNo === dangXuLy.lineNo)) xoaXuLy();
  veHangDoi();
}

function veHangDoi() {
  const tb = $("bang-hang-doi").querySelector("tbody");
  tb.replaceChildren();
  for (const d of locHangDoi(hangDoi.dong, $("loc-hd").value)) {
    const tr = document.createElement("tr");
    tr.append(o(d.tieuDe), o(String(d.lineNo), "so"), o(d.moTa), o(d.soLuong, "so"), o(d.donVi), o(nhanGoiY(d.goiY)), o(d.goiY?.tacGia ?? "—"));
    tr.append(trangThai.choGhi ? oNut("Xử lý", () => { moXuLy(d); }) : o(""));
    tb.append(tr);
  }
}

function xoaXuLy() {
  dangXuLy = null;
  $("tt-dong").replaceChildren();
  $("xl-hang").replaceChildren();
  for (const id of ["xl-ly-do", "xl-ma", "xl-don-vi", "xl-ten"]) $(id).value = "";
  hien($("khoi-xu-ly"), false);
}

function moXuLy(d) {
  bao($("loi6"), ""); bao($("ok6"), "");
  dangXuLy = d;
  dienDl($("tt-dong"), [
    ["Gói", d.tieuDe],
    ["Dòng", d.lineNo],
    ["Mô tả", d.moTa],
    ["Số lượng", `${d.soLuong} ${d.donVi}`],
    ["Gợi ý", nhanGoiY(d.goiY)],
    ["Người ghi gợi ý", d.goiY?.tacGia ?? "—"],
  ]);
  const chon = $("xl-hang");
  chon.replaceChildren();
  for (const l of luaChonHangChuan(d.goiY, trangThai.hangChuan)) {
    const op = document.createElement("option");
    op.value = l.id;
    op.textContent = l.nhan;
    chon.append(op);
  }
  // Mỗi dòng mở ra với ô bí danh bật — mặc định là hàng đợi học; người duyệt tắt nó cho một mô tả không nên thành bí danh.
  $("xl-bi-danh").checked = true;
  $("xl-ly-do").value = "";
  $("xl-ma").value = "";
  $("xl-don-vi").value = "";
  $("xl-ten").value = d.moTa;
  hien($("khoi-xu-ly"), true);
}

/** Một lần ghi cho dòng đang mở, rồi đọc lại hàng đợi — màn không tự đoán kết quả. Trả `true` khi máy chủ nhận. */
async function ghiDong(duoi, than, maOk, cauOk) {
  bao($("loi6"), ""); bao($("ok6"), "");
  if (dangXuLy === null) { bao($("loi6"), "Chưa mở dòng nào."); return false; }
  const d = dangXuLy;
  const r = await goi("POST", `/rfqs/${d.rfqId}/${duoi}`, than);
  if (r.status !== maOk) { bao($("loi6"), loiCua(r, "Máy chủ từ chối")); return false; }
  xoaXuLy();
  await napHangDoi();
  bao($("ok6"), cauOk);
  return true;
}

const lyDoNhap = () => { const v = $("xl-ly-do").value.trim(); return v === "" ? null : v; };

/**
 * [lượt soi S4.3b, L4] Bốn nút của khối xử lý khoá CÙNG NHAU: `motLan` chỉ khoá nút được bấm, nên *Duyệt* và *Bác* bay song song được
 * cho cùng một dòng — hai hàng ánh xạ, hàng sau đè hàng trước.
 */
const NUT_XU_LY = ["nut-duyet", "nut-bac", "nut-tao-duyet", "nut-chuan-hoa-lai"];
function motLanKhoi(viec) {
  return async () => {
    const nut = NUT_XU_LY.map((id) => $(id));
    if (nut.some((n) => n.disabled)) return;
    for (const n of nut) n.disabled = true;
    try { await viec(); } finally { for (const n of nut) n.disabled = false; }
  };
}

$("loc-hd").addEventListener("input", veHangDoi);
$("nut-doc-hd").addEventListener("click", () => { void napHangDoi(); });

$("nut-duyet").addEventListener("click", motLanKhoi(async () => {
  const hangChuanId = $("xl-hang").value;
  if (dangXuLy !== null && hangChuanId === "") { bao($("loi6"), "Chọn một hàng chuẩn, hoặc tạo hàng mới ở dưới."); return; }
  const d = dangXuLy;
  // [lượt soi L4] `bam`: băm của dòng mà người duyệt đang thấy — dòng đổi giữa chừng thì máy chủ trả `DONG_DA_DOI`.
  await ghiDong(`items/${d?.lineNo}/mapping`, { hangChuanId, lyDo: lyDoNhap(), taoBiDanh: $("xl-bi-danh").checked, bam: d?.bam },
    201, `Đã duyệt dòng ${d?.lineNo} của gói «${d?.tieuDe}».`);
}));

$("nut-bac").addEventListener("click", motLanKhoi(async () => {
  const d = dangXuLy;
  await ghiDong(`items/${d?.lineNo}/mapping`, { hangChuanId: null, lyDo: lyDoNhap(), bam: d?.bam }, 201,
    `Đã ghi dòng ${d?.lineNo} của gói «${d?.tieuDe}»: không có hàng chuẩn tương ứng.`);
}));

$("nut-tao-duyet").addEventListener("click", motLanKhoi(async () => {
  const ma = $("xl-ma").value.trim();
  if (!maHopLe(ma)) { bao($("loi6"), "Mã viết hoa, bắt đầu bằng chữ hoặc số, chỉ chữ, số, dấu chấm, gạch ngang, gạch dưới — tối đa 40 ký tự."); return; }
  const d = dangXuLy;
  const ok = await ghiDong(`items/${d?.lineNo}/mapping/new-item`, {
    ma, ten: $("xl-ten").value.trim(), donViGoc: $("xl-don-vi").value.trim(), lyDo: lyDoNhap(), taoBiDanh: $("xl-bi-danh").checked, bam: d?.bam,
  }, 201, `Đã tạo ${ma} và duyệt dòng ${d?.lineNo} sang nó.`);
  if (ok) await napHangChuan();
}));

$("nut-chuan-hoa-lai").addEventListener("click", motLanKhoi(async () => {
  bao($("loi6"), ""); bao($("ok6"), "");
  if (dangXuLy === null) { bao($("loi6"), "Chưa mở dòng nào."); return; }
  const d = dangXuLy;
  const r = await goi("POST", `/rfqs/${d.rfqId}/normalize`);
  if (r.status !== 200) { bao($("loi6"), loiCua(r, "Không chuẩn hoá lại được")); return; }
  const k = r.body?.ketQua ?? {};
  xoaXuLy();
  await napHangDoi();
  bao($("ok6"), `Đã chuẩn hoá lại gói «${d.tieuDe}»: ${k.tuDong ?? 0} dòng tự nối, ${(k.goiY ?? 0) + (k.canDuyet ?? 0)} gợi ý mới, ` +
    `${k.daCo ?? 0} dòng đã có ánh xạ.`);
}));

// ==============================================================================================
// MÀN TẠO GÓI THẦU — bước ĐẦU TIÊN của kịch bản §11, và tới S1.97 nó không có giao diện nào.
//
// Lượt đi thử S1.97 đo được: kịch bản hoàn thành MVP1 đi được năm bước rưỡi trên bảy, và một
// trong hai bước không có màn hình là *"người mua tạo một RFQ có ít nhất ba hạng mục và mời ba
// nhà cung cấp"* — thứ duy nhất làm được việc ấy là `tools/gieo-demo`, chạy SQL thẳng. Một bước
// của kịch bản mà chỉ người của dự án gõ lệnh mới đi qua được thì §11 chưa đạt, dù mọi cổng đều
// xanh.
//
// Trang này KHÔNG import một mảnh mật mã nào: khoá của gói thầu sinh ở máy chủ lúc `open`, và
// người mua không giữ nó. Màn này chỉ ra lệnh và đọc lại trạng thái.
//
// [S1.191 / S3.2c2] Hai luồng mời dưới công tắc ADR-080. Tổ chức CHƯA bật: nguyên MVP1 — mời sau khi mở, link đi lúc mời.
// Tổ chức ĐÃ bật: bước mời đứng TRƯỚC bước ngân sách và phê duyệt (người duyệt ký lên danh sách — K4b), lời mời nằm «chưa
// gửi» tới lần mở gói (K6), lần mở gói nói link nào chưa đi, và gói đang chờ duyệt trả về soạn thảo được, có lý do (`077`).
// Màn hỏi `GET /policy/versions` MỘT lần sau đăng nhập để biết luồng nào; mọi phép tính ở `/lib/tao-thau.js`.
// ==============================================================================================

import {
  KHUNG_TIN_HIEU_RONG, LOAI_NGOAI_LE, MA_LY_DO_NGOAI_LE, baoSauKhiMo, baoSauKhiMoi, chiDanChot, cungLanNop, docNhaCungCapChon,
  hangNganSach, hienCotHangChuan, hienTraVe, khungTinHieu, loaiNgoaiLeGoiY, loiGiaiTrinh, loiLyDo, loiLyDoGhiNhan, nhanAnhXa,
  nhanCanhTranh, nhanCo, nhanLoaiNgoaiLe, nhanLoiMoi, nhanMaLyDo, nhanXacMinhNgan, nutLoiMoi, tenKemMst, thuTuBuoc, tuDocNganSach,
  vanBanAnToan,
  canhBaoSoNgayGiao, docSoNgayGiao, hienDatSoNgayGiao, nhanSoNgayGiao, SO_NGAY_GIAO_TOI_DA,
} from "/lib/tao-thau.js";
import { docNhomHang, hienDatNhomHang, luaChonNhomHang, nhanNhomHangCuaGoi } from "/lib/nhom-hang.js";
import { ganDangNhap } from "/lib/dang-nhap.js";
import { chiDanK9, ganKhaiBao, nhaCungCapTuLoiMoi } from "/lib/xung-dot.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

// [S1.240 / khoản 282] `orgId`, `token`, `daRedeem` rời khỏi đây — bước 1 nay là `/lib/dang-nhap.js`.
// [S1.273 / S3.3e1] `nccTaoTrongPhien`: nhà cung cấp đang chọn là hồ sơ vừa tạo ở bước 5 (chỉ hồ sơ ấy được thêm người liên hệ).
// `coQuyenMoi`: cờ hiển thị của `GET /rfqs/:id` (khoản 340). `danhSachKhop`: hai danh sách đang thấy cùng lần nộp với `lanNop` mà nút
// Phê duyệt sẽ gửi (lượt soi CAO-1). `soLoiMoiSong`: số lời mời còn sống của gói — để chọn sẵn loại ngoại lệ.
const phienMoi = () => ({
  rfqId: "", supplierId: "", contactId: "", soHangMuc: 0, nccTaoTrongPhien: false, coQuyenMoi: false, danhSachKhop: true, soLoiMoiSong: 0,
  // [S1.283 / S3.4b] `coQuyenKhai`: cờ của `GET /rfqs/:id` — người xem giữ `coi.declare`. `nccKhai`: nhà cung cấp của bảng lời mời
  // vừa đọc — ô *có xung đột với* của khối khai báo chọn từ đó.
  coQuyenKhai: false, nccKhai: [],
});
let phien = phienMoi();
// [S1.191 / S3.2c2] Luồng của tổ chức (`daBat`) và trạng thái gói đang mở trên màn — dựng lại mỗi lần đổi người.
let luong = { daBat: false, trangThaiGoi: "" };
// [S1.201 / S3.6a] Nhóm hàng của tổ chức (`GET /categories`) — chỉ nạp ở tổ chức đã bật, nơi gói không nhóm hàng không nộp
// duyệt được.
let nhomHang = [];
// [S1.200 / khoản 258] `userId` của phiên đang dùng màn (`GET /me`), rỗng trước khi đăng nhập.
let nguoiDung = "";
// [S1.283 / S3.4b · K9] Khối khai báo xung đột lợi ích ở bước 4 — trước ô Phê duyệt và Ghi nhận tín hiệu. Chỉ tự đọc ở tổ chức đã
// bật và khi người xem giữ `coi.declare` (cờ của `GET /rfqs/:id`, khuôn khoản 340): người không giữ không để lại một 403 và một hàng
// `PERMISSION_DENIED` ở mỗi lần đọc gói. Danh sách nhà cung cấp là bảng lời mời mà trang đã đọc được (quyền mời) — không đọc thêm.
const khaiBao = ganKhaiBao({
  taiLieu: document,
  goi,
  loiCua,
  rfqId: () => phien.rfqId,
  nhaCungCap: () => phien.nccKhai ?? [],
  khiKhongCoDanhSach: "Màn này chỉ thấy danh sách nhà cung cấp của gói khi bạn giữ quyền mời. Khai «có xung đột» cần chọn nhà " +
    "cung cấp: nhờ người tạo gói xem danh sách, hay khai ở /mo-thau sau mở thầu (bảng so sánh).",
});

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

// [S1.254 / khoản 323] Cùng câu với `/mo-thau`: thân 403 của `apps/api` là hằng `khong co quyen` (`dispatch.ts`), in nguyên
// văn là một chuỗi không dấu — đo ở diễn tập §11: người mua vai BUYER bấm «Tạo nhà cung cấp». Thân lỗi khác in nguyên văn.
const THAN_403 = "khong co quyen";

function loiCua(r, macDinh) {
  if (r.status === 403 && r.body?.error === THAN_403) {
    return `${macDinh}: tài khoản đang đăng nhập không có quyền làm việc này — vai hiện tại không được cấp quyền ấy. ` +
      "Đổi sang người phù hợp ở bước 1.";
  }
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

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: magic link + TOTP. Cùng khuôn `mo-thau.js`, kể cả hai phép sửa mà lượt
// chạy thử đầu tiên của màn ấy ép ra: đọc CẢ mã tổ chức từ fragment, và gọi `/auth/redeem` ĐÚNG
// một lần cho mỗi mã đăng nhập (gọi lại là máy chủ sinh bí mật TOTP mới, và mã của người dùng
// không bao giờ đúng nữa).
// [S1.240 / khoản 282] ~~Cùng khuôn~~ CÙNG MỘT BẢN với `/login`: nút Tiếp, nút Vào và khối link đăng nhập gần đây là
// `/lib/dang-nhap.js`; trang giữ `docLink`, lối hỏi lại phiên, đăng xuất và `hashchange`, và gọi `dangNhap.datLai()` khi về bước 1.
// ---------------------------------------------------------------------------------------------

function docLink() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) { if (h !== "") $("token").value = h; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}

// [S1.98 / khoản 204] Đọc LẠI khi fragment đổi. Trang chỉ đọc `location.hash` một lần là đủ cho
// lần tải đầu, nhưng người bấm một link thứ hai cùng đường dẫn khác fragment thì trình duyệt
// KHÔNG tải lại tài liệu — ô vẫn giữ mã cũ, và máy chủ trả "đã dùng" như thể link mới hỏng.
// Khoản 204 đo đúng ca ấy trên `nop-thau.js`; trang này ra đời sau nên nó không lặp lại.
// [S1.99 / khoản 205] Bản đầu của listener này viết `{ ...phien, daRedeem: false, token }`, tức
// nó GIỮ `rfqId`, `supplierId`, `contactId`, `soHangMuc` của người trước. Khoản 204 khai rằng
// trang này *"mang sẵn listener ấy, nên nó không lặp lại khiếm khuyết"* — lời khai ấy sai: một
// nửa trạng thái phiên sống sót qua lần đổi người, và bốn con trỏ ấy được đọc dưới quyền của
// người TRƯỚC. Dựng lại trọn vẹn là câu duy nhất không cần ai nhớ trường nào phải xoá.
// [S1.177] Và đóng các bước về bước 1 — trước đây chúng ĐỂ NGUYÊN, dưới cookie của người trước — rồi hỏi lại
// phiên (khuôn `mo-thau.js`).
window.addEventListener("hashchange", () => {
  docLink();
  phienCho = null;
  phien = phienMoi();
  datLuong({ daBat: false, trangThaiGoi: "" });
  nguoiDung = "";
  xoaNganSach();
  veTinHieu(KHUNG_TIN_HIEU_RONG);
  khaiBao.an();
  xoaDanhSach();
  xoaNhaCungCap();
  quenChinhSach();
  for (const id of ["loi1", "loi2", "loi3", "loi4", "ok1", "ghi-danh", "loi5", "ok5", "loi-nl", "ok-nl"]) {
    const el = $(id);
    if (el !== null) bao(el, "");
  }
  dongCacBuoc();
  dangNhap.datLai();
  thuPhienCo();
});

// [S1.240 / khoản 282] ~~Trình nghe `nut-vao` chép của `/login` cũ: `/auth/redeem` rồi `/auth/totp` trong một lượt, bí mật TOTP hiện
// cùng chỗ câu lỗi~~ — khoản 193 ở trang này. Nay bước 1 là module chung; trang trao cho nó việc của riêng mình sau khi vào.
const dangNhap = ganDangNhap({ taiLieu: document, goi, lichSu: history, viTri: location, daVao: (me) => moSauDangNhap(me, false) });

const CAC_BUOC_SAU = ["b2", "b3", "b4", "b5"];

/**
 * [S1.177] Mở các bước sau đăng nhập — vừa đăng nhập xong, hoặc người dùng bấm "Tiếp tục với phiên này".
 * Cùng khuôn `mo-thau.js`: câu báo không in `kind` (loại phiên, không phải vai).
 */
function moSauDangNhap(me, dungLai) {
  const u = me?.userId;
  // [S1.200 / khoản 258] Người đang dùng màn — để biết họ có phải người tạo gói đang đọc không (ngân sách, `napRfq`).
  nguoiDung = typeof u === "string" ? u : "";
  const ai = typeof u === "string" ? `người dùng ${u.slice(0, 8)}…` : "";
  bao($("ok1"), ai === ""
    ? "Đã vào. Phiên nằm trong cookie HttpOnly."
    : dungLai
      ? `Đang dùng phiên còn hạn của ${ai}. Cần đổi người thì đăng nhập ở trên bằng link của người ấy.`
      : `Đã vào với ${ai}. Phiên nằm trong cookie HttpOnly, JavaScript không đọc được nó.`);
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), true);
  $("b1").classList.add("xong");
  for (const b of CAC_BUOC_SAU) hien($(b), true);
  // [S1.240 / khoản 282] Khối link đăng nhập gần đây (khoản 195, 268) — trước lời gọi riêng của màn, không chờ.
  void dangNhap.veLinkGanDay();
  void napLuong();
}

/**
 * [S1.191 / S3.2c2] Tổ chức đã bật kiểm soát theo bậc chưa — `daBat` của `GET /policy/versions`, đúng hàm công tắc mà
 * máy chủ hỏi (ADR-080). Đọc hỏng thì màn ở luồng MVP1: máy chủ vẫn từ chối mọi thao tác sai luồng, màn chỉ nói kém đi.
 */
// [S1.284 / S4.7b1] Thân của lần đọc ấy — cảnh báo số ngày giao đọc phiên bản đang hiệu lực từ đây, không gọi lần thứ hai. Cũ tới lần
// đăng nhập sau: cảnh báo là lời nói trước, cạnh mở gói mới là chốt (`tco_thieu_so_ngay_giao`). `goiDangDoc` là số ngày giao và trạng
// thái của lần đọc gói gần nhất — để vẽ lại cảnh báo khi lần đọc chính sách về SAU lần đọc gói.
let chinhSach = null;
let goiDangDoc = null;

function veCanhBaoSoNgay() {
  bao($("canh-bao-so-ngay"), goiDangDoc === null ? "" : (canhBaoSoNgayGiao(chinhSach, goiDangDoc.soNgayGiao, goiDangDoc.status) ?? ""));
}

/** [rà soát §S1.284 — THẤP-3] Đổi người hay đăng xuất: quên chính sách của tổ chức trước và cảnh báo vẽ từ nó. */
function quenChinhSach() {
  chinhSach = null;
  goiDangDoc = null;
  veCanhBaoSoNgay();
}

async function napLuong() {
  // [rà soát §S1.284 — THẤP-3] Quên TRƯỚC lần chờ: một lần đọc hỏng không để lại thân của người trước.
  chinhSach = null;
  try {
    const r = await goi("GET", "/policy/versions");
    chinhSach = r.status === 200 ? r.body : null;
    datLuong({ ...luong, daBat: r.status === 200 && r.body?.daBat === true });
    veCanhBaoSoNgay();
    if (luong.daBat) await napNhomHang(null);
  } catch { /* mất mạng: giữ luồng MVP1 */ }
  // [S1.273 / S3.3e1] Ô chọn nhà cung cấp có sẵn — `GET /suppliers` không cổng, không sinh lời từ chối nào.
  try { await napNhaCungCap(""); } catch { /* mất mạng: ô chọn để trống */ }
}

/**
 * [S1.201 / S3.6a] Nạp danh sách nhóm hàng rồi vẽ ô chọn, chọn sẵn `dangChon`. Đọc hỏng thì ô chọn chỉ còn dòng trống: máy
 * chủ vẫn từ chối lần nộp duyệt thiếu nhóm hàng, màn chỉ nói kém đi.
 */
async function napNhomHang(dangChon) {
  const r = await goi("GET", "/categories");
  nhomHang = r.status === 200 ? docNhomHang(r.body) : [];
  veChonNhomHang(dangChon);
}

function veChonNhomHang(dangChon) {
  const chon = $("nhom-hang");
  chon.replaceChildren();
  for (const l of luaChonNhomHang(nhomHang, dangChon)) {
    const o = document.createElement("option");
    o.value = l.value;
    o.textContent = l.nhan;
    chon.append(o);
  }
  chon.value = dangChon ?? "";
}

/** [S1.191 / S3.2c2] Đặt luồng rồi vẽ lại: thứ tự bước, số bước, hai đoạn ghi, khối trả về soạn thảo. */
function datLuong(moi) {
  const doiLuong = moi.daBat !== luong.daBat;
  luong = moi;
  const thuTu = thuTuBuoc(luong.daBat);
  // [S1.193 / S3.2c2] Dời THẬT trong DOM theo `thuTuBuoc`, không bằng CSS `order`: phím Tab và trình đọc màn hình đi theo thứ
  // tự DOM, không theo thứ tự vẽ. Chỉ dời khi luồng đổi — `datLuong` chạy lại mỗi lần nạp gói, và dời một phần tử đang giữ
  // tiêu điểm làm mất tiêu điểm. HTML khai thứ tự MVP1, và `luong` khởi đầu ở MVP1.
  if (doiLuong) {
    if (thuTu.indexOf("b5") < thuTu.indexOf("b4")) $("b4").before($("b5"));
    else $("b5").before($("b4"));
  }
  $("so-b4").textContent = String(thuTu.indexOf("b4") + 2);
  $("so-b5").textContent = String(thuTu.indexOf("b5") + 2);
  hien($("ghi-s3-b4"), luong.daBat);
  hien($("ghi-s3-b5"), luong.daBat);
  hien($("khoi-tra-ve"), hienTraVe(luong.daBat, luong.trangThaiGoi));
  hien($("khoi-nhom-hang"), luong.daBat);
  hien($("nut-nhom-hang"), hienDatNhomHang(luong.daBat, luong.trangThaiGoi));
  // [S1.284 / S4.7b1] Số ngày giao — mọi tổ chức, chỉ ở DRAFT (trigger `rfq_packages_so_ngay_giao`).
  hien($("khoi-so-ngay-giao"), hienDatSoNgayGiao(luong.trangThaiGoi));
  // [S1.273 / S3.3e1] Câu về nhà cung cấp đếm được, hai cột của bảng lời mời và khối ngoại lệ — chỉ tổ chức đã bật; lập và rút
  // ngoại lệ chỉ ở DRAFT (máy chủ từ chối ở trạng thái khác — K4a).
  hien($("ghi-s3-ncc"), luong.daBat);
  hien($("th-xac-minh"), luong.daBat);
  hien($("th-dem"), luong.daBat);
  hien($("khoi-ngoai-le"), luong.daBat);
  hien($("khoi-lap-ngoai-le"), luong.daBat && luong.trangThaiGoi === "DRAFT");
}

/** [S1.177] Về lại bước 1: ẩn mọi bước sau, bỏ dấu "xong", bỏ khối hỏi phiên và nút Đăng xuất. */
function dongCacBuoc() {
  $("b1").classList.remove("xong");
  for (const b of CAC_BUOC_SAU) hien($(b), false);
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), false);
  dangNhap.anLinkGanDay();
}

/**
 * [S1.177] Cùng khuôn `mo-thau.js`: phiên người mua là cookie `Path=/` sống tới 8 giờ kể cả sau khi đóng trình
 * duyệt, dùng chung ba trang, còn mã đăng nhập chỉ dùng được một lần — nên lúc tải trang hỏi `/me`. Có phiên
 * còn hạn thì HỎI "Tiếp tục với phiên này" hay "Đăng xuất", không tự mở: trên máy dùng chung phiên ấy có thể
 * của người khác, và bước 4 có nút Phê duyệt. Không hỏi khi ô mã đã có mã; `docLink()` phải chạy trước hàm
 * này, và ô mã được kiểm lại sau `await`. Sau `/auth/totp` — mã đã tiêu thụ — xoá fragment khỏi
 * thanh địa chỉ (ADR-020 mục 3).
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

$("nut-dung-phien").addEventListener("click", () => {
  if (phienCho === null) return;
  const me = phienCho;
  phienCho = null;
  moSauDangNhap(me, true);
});

// [S1.177] Cùng khuôn `mo-thau.js`: 401 là phiên đã hết hay đã bị thu hồi — trang cũng về bước 1.
$("nut-dang-xuat").addEventListener("click", async () => {
  bao($("loi1"), ""); bao($("ok1"), "");
  $("nut-dang-xuat").disabled = true;
  try {
    const r = await goi("POST", "/auth/logout");
    if (r.status !== 200 && r.status !== 401) { bao($("loi1"), loiCua(r, "Không đăng xuất được")); return; }
    phienCho = null;
    phien = phienMoi();
    datLuong({ daBat: false, trangThaiGoi: "" });
    nguoiDung = "";
    xoaNganSach();
    veTinHieu(KHUNG_TIN_HIEU_RONG);
    khaiBao.an();
    xoaDanhSach();
    xoaNhaCungCap();
    quenChinhSach();
    dongCacBuoc();
    dangNhap.datLai();
    bao($("ok1"), "Đã đăng xuất. Trình duyệt này không còn giữ phiên của bạn.");
  } catch {
    bao($("loi1"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    $("nut-dang-xuat").disabled = false;
  }
});


// ---------------------------------------------------------------------------------------------
// Bước 2 — gói thầu
// ---------------------------------------------------------------------------------------------

async function napRfq(rfqId, lanThu = 0) {
  const r = await goi("GET", `/rfqs/${rfqId}`);
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được gói thầu")); return false; }
  const g = r.body?.rfq ?? {};
  // [S1.198 / khoản 256] Lần nộp của CHÍNH lần đọc này — nút Phê duyệt gửi lại đúng con số ấy, nên chữ ký rơi lên thứ người duyệt
  // đang thấy trên màn. Gói được trả về và nộp lại sau lần đọc thì máy chủ từ chối, và người duyệt đọc lại.
  phien = { ...phien, rfqId, lanNop: typeof g.lanNop === "number" ? g.lanNop : undefined };
  // [S1.273 / S3.3e1 · khoản 340] Cờ hiển thị của máy chủ: người xem giữ quyền mời, tức hai danh sách sẽ cho họ đọc.
  phien = { ...phien, coQuyenMoi: r.body?.coQuyenMoi === true, danhSachKhop: true };
  // [S1.283 / S3.4b] Cờ thứ hai cùng khuôn: người xem giữ `coi.declare`. Danh sách nhà cung cấp của gói TRƯỚC đi ngay.
  phien = { ...phien, coQuyenKhai: r.body?.coQuyenKhai === true, nccKhai: [] };
  datLuong({ ...luong, trangThaiGoi: typeof g.status === "string" ? g.status : "" });
  // [S1.200 / khoản 258 — lượt soi F4] Bảng ngân sách của gói TRƯỚC đi ngay, trước lần chờ đầu tiên: một lần đọc sau đó hỏng
  // giữa chừng không được để lại ngân sách của gói khác cạnh lần nộp mà nút Phê duyệt sẽ gửi.
  const toiTao = tuDocNganSach(nguoiDung, g.createdBy);
  phien = { ...phien, toiTao };
  dienDl($("tt-ns"), []);
  hien($("nut-xem-ns"), !toiTao);
  // [S3.6b2 / K10a] Khung tín hiệu của gói trước cũng đi ngay, cùng lý do với bảng ngân sách.
  veTinHieu(KHUNG_TIN_HIEU_RONG);
  // [S1.283 / S3.4b] …và khai báo của người xem trên gói trước.
  khaiBao.an();
  const hang = [
    ["Mã gói thầu", rfqId],
    ["Tên", g.title],
    ["Trạng thái", g.status],
    ["Hạn nộp", g.deadlineAt === undefined ? null : new Date(g.deadlineAt).toLocaleString("vi-VN")],
    ["Cần hai người duyệt", g.requiresDualApproval === true ? "có" : "không"],
    ["Lần nộp duyệt", g.lanNop],
    // [S1.284 / S4.7b1 / L16] Mọi trạng thái: người duyệt ký lên con số này (`approved_delivery_hash`), nên nó đứng ở màn duyệt.
    ["Số ngày giao yêu cầu", nhanSoNgayGiao(g.soNgayGiao)],
  ];
  $("so-ngay-giao").value = typeof g.soNgayGiao === "number" ? String(g.soNgayGiao) : "";
  goiDangDoc = { soNgayGiao: g.soNgayGiao, status: typeof g.status === "string" ? g.status : "" };
  veCanhBaoSoNgay();
  // [S1.201 / S3.6a] Nhóm hàng của gói — chỉ ở tổ chức đã bật; ô chọn nhảy về đúng nhóm gói đang giữ.
  if (luong.daBat) {
    hang.push(["Nhóm hàng", nhanNhomHangCuaGoi(nhomHang, g.categoryId)]);
    veChonNhomHang(typeof g.categoryId === "string" ? g.categoryId : null);
  }
  dienDl($("tt-rfq"), hang);
  await napHangMuc();
  // [S1.273 / S3.3e1 · khoản 340] Hai danh sách chỉ tự nạp khi người xem đọc được chúng — người không giữ quyền mời (người yêu cầu
  // mua, tài chính) không để lại một 403 và một hàng `PERMISSION_DENIED` ở mỗi lần đọc gói; họ bấm «Đọc danh sách lời mời» hay «Xem
  // ngoại lệ» nếu cần. [lượt soi CAO-1] Hai danh sách phải cùng lần nộp với lần đọc gói mà nút Phê duyệt gửi; lệch thì đọc lại TRỌN
  // gói một lần, vẫn lệch thì chặn nút Phê duyệt trên màn tới lần đọc sau.
  if (luong.daBat) {
    if (phien.coQuyenMoi) {
      const lanMoi = await napLoiMoi();
      const lanNl = await napNgoaiLe();
      if (phien.rfqId !== rfqId) return false;
      if (!cungLanNop(phien.lanNop, lanMoi) || !cungLanNop(phien.lanNop, lanNl)) {
        if (lanThu === 0) return await napRfq(rfqId, 1);
        phien = { ...phien, danhSachKhop: false };
        bao($("loi4"), "Gói vừa được trả về hay nộp lại trong lúc đọc — danh sách đang thấy chưa chắc là của lần nộp này. Bấm «Đọc» " +
          "ở bước gói thầu rồi xem lại trước khi phê duyệt.");
      }
    } else {
      xoaDanhSach();
    }
  }
  // [S1.200 / khoản 258] Người tạo gói thấy ngân sách ở CÙNG lần đọc; người khác bấm «Xem ngân sách» (chủ dự án chốt sau lượt
  // soi F3: lần từ chối phải đến từ một thao tác cố ý, không từ nhịp đọc gói).
  if (toiTao) await napNganSach();
  if (luong.daBat) await napTinHieu();
  // [S1.283 / S3.4b · K9] Khai báo của chính người xem — sau bảng lời mời, để ô *có xung đột với* có danh sách.
  if (luong.daBat && phien.coQuyenKhai) await khaiBao.nap();
  return true;
}

/**
 * [S3.6b2 / K10a] Tín hiệu chia nhỏ của gói đang mở — `GET /rfqs/:rfqId/signals` không có cổng quyền, nên đọc ở mỗi lần đọc gói
 * không sinh lời từ chối nào. Chỉ ở tổ chức đã bật: tổ chức chưa bật không có tín hiệu. Câu trả của gói trước tới muộn thì bỏ,
 * khuôn `napNganSach`.
 */
async function napTinHieu() {
  const id = phien.rfqId;
  if (id === "") return;
  const r = await goi("GET", `/rfqs/${id}/signals`);
  if (phien.rfqId !== id) return;
  veTinHieu(r.status === 200 ? khungTinHieu(r.body, id) : KHUNG_TIN_HIEU_RONG);
}

function veTinHieu(k) {
  hien($("khoi-tin-hieu"), k.hien);
  $("tin-hieu-tom-tat").textContent = k.tomTat;
  const tb = $("bang-tin-hieu").querySelector("tbody");
  tb.replaceChildren();
  for (const g of k.goi) {
    const tr = document.createElement("tr");
    for (const v of [g.laGoiNay ? `${g.tieuDe} (gói này)` : g.tieuDe, g.trangThai]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    tb.append(tr);
  }
  const ls = $("lich-su-tin-hieu");
  ls.replaceChildren();
  for (const d of k.lichSu) {
    const li = document.createElement("li");
    li.textContent = d.luc === null ? d.noiDung : `${new Date(d.luc).toLocaleString("vi-VN")} — ${d.noiDung}`;
    ls.append(li);
  }
  hien($("khoi-ghi-nhan"), k.choGhiNhan);
  bao($("tin-hieu-khong-duoc"), k.khongDuoc ?? "");
}

// [S3.6b2 / K10a] Ghi nhận tín hiệu HIỆN TẠI của gói — `POST /rfqs/:rfqId/signals/acknowledge`, cổng `rfq.approve`, lý do vào sổ.
// Máy chủ kiểm lại mọi luật (quyền, luật người, bằng chứng hiện tại); màn in đúng câu từ chối của nó rồi đọc lại khung.
$("nut-ghi-nhan").addEventListener("click", async () => {
  bao($("loi4"), ""); bao($("ok4"), "");
  if (phien.rfqId === "") { bao($("loi4"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const lyDo = $("ly-do-ghi-nhan").value;
  const sai = loiLyDoGhiNhan(lyDo);
  if (sai !== null) { bao($("loi4"), sai); return; }
  const id = phien.rfqId;
  $("nut-ghi-nhan").disabled = true;
  try {
    const r = await goi("POST", `/rfqs/${id}/signals/acknowledge`, { lyDo: lyDo.trim() });
    if (phien.rfqId !== id) return;
    if (r.status !== 201) {
      // [S1.283 / S3.4b · K9] Lời từ chối K9 mang mã: một câu chỉ chỗ khai trên màn, và khối khai báo đọc lại.
      const chiDan = chiDanK9(r.body?.ma);
      bao($("loi4"), chiDan === null ? loiCua(r, "Không ghi nhận được tín hiệu") : `${loiCua(r, "Không ghi nhận được tín hiệu")} ${chiDan}`);
      await napTinHieu();
      if (chiDan !== null && phien.coQuyenKhai) await khaiBao.nap();
      return;
    }
    $("ly-do-ghi-nhan").value = "";
    bao($("ok4"), r.body?.ghiNhan?.tinHieuMoi === true
      ? "Đã ghi nhận. Tập gói đã đổi từ lần nộp, nên tín hiệu được ghi lại theo tập hiện tại trước khi ghi nhận. Gói mở được khi đủ chữ ký."
      : "Đã ghi nhận tín hiệu. Gói mở được khi đủ chữ ký.");
    await napRfq(id);
  } catch {
    bao($("loi4"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    $("nut-ghi-nhan").disabled = false;
  }
});

/**
 * [S1.200 / khoản 258] Bảng ngân sách từ `GET /rfqs/:rfqId/budget` — năm thứ chữ ký duyệt gói ràng vào. Câu trả chỉ được vẽ khi
 * nó là của gói ĐANG mở trên màn (lượt soi F4): người dùng đọc gói khác trong lúc chờ, hay thân mang mã gói khác, thì bỏ.
 */
async function napNganSach() {
  const id = phien.rfqId;
  if (id === "") return;
  const r = await goi("GET", `/rfqs/${id}/budget`);
  if (phien.rfqId !== id) return;
  if (r.status !== 200) {
    dienDl($("tt-ns"), [["Ngân sách", r.status === 403 ? "không có quyền đọc ngân sách của gói này" : loiCua(r, "Không đọc được ngân sách")]]);
    return;
  }
  const b = r.body?.budget;
  if (b?.rfqId !== id) { dienDl($("tt-ns"), []); return; }
  dienDl($("tt-ns"), hangNganSach(b));
}

/** [S1.200 / khoản 258] Đổi người hay đăng xuất: bảng ngân sách của người trước đi cùng các bước (lượt soi N1). */
function xoaNganSach() {
  dienDl($("tt-ns"), []);
  hien($("nut-xem-ns"), false);
}

// [S1.200 / khoản 258] Người không tạo gói đọc ngân sách bằng một thao tác cố ý — cổng đòi `rfq.approve`, lần từ chối vào sổ.
$("nut-xem-ns").addEventListener("click", async () => {
  bao($("loi4"), ""); bao($("ok4"), "");
  if (phien.rfqId === "") { bao($("loi4"), "Tạo hoặc đọc một gói thầu trước."); return; }
  $("nut-xem-ns").disabled = true;
  try {
    await napNganSach();
  } finally {
    $("nut-xem-ns").disabled = false;
  }
});

$("nut-tao").addEventListener("click", async () => {
  bao($("loi2"), ""); bao($("ok2"), "");
  const title = $("tieu-de").value.trim();
  const han = $("han").value;
  if (title === "" || han === "") { bao($("loi2"), "Cần cả tiêu đề và hạn nộp."); return; }
  // [S1.201 / S3.6a] Nhóm hàng đi cùng lần tạo khi đã chọn; chưa chọn thì gói vẫn tạo được — chốt ở lần nộp duyệt.
  const categoryId = luong.daBat ? $("nhom-hang").value : "";
  const r = await goi("POST", "/rfqs", { title, deadlineAt: new Date(han).toISOString(), ...(categoryId !== "" ? { categoryId } : {}) });
  if (r.status !== 201) { bao($("loi2"), loiCua(r, "Không tạo được gói thầu")); return; }
  const id = r.body?.rfq?.id ?? "";
  $("rfq").value = id;
  bao($("ok2"), "Đã tạo. Mã gói thầu ở ô dưới — người duyệt thứ hai dán mã ấy để vào tiếp.");
  await napRfq(id);
});

$("nut-doc").addEventListener("click", async () => {
  bao($("loi2"), ""); bao($("ok2"), "");
  const id = $("rfq").value.trim();
  if (id === "") { bao($("loi2"), "Dán mã gói thầu trước."); return; }
  await napRfq(id);
});

// [S1.201 / S3.6a] Đặt hay đổi nhóm hàng của gói đang soạn — `PUT /rfqs/:rfqId/category`. Máy chủ từ chối nhóm đã ngừng dùng và
// gói đã rời DRAFT bằng lời có tên; màn in đúng lời ấy.
$("nut-nhom-hang").addEventListener("click", async () => {
  bao($("loi2"), ""); bao($("ok2"), "");
  if (phien.rfqId === "") { bao($("loi2"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const categoryId = $("nhom-hang").value;
  if (categoryId === "") { bao($("loi2"), "Chọn một nhóm hàng."); return; }
  const r = await goi("PUT", `/rfqs/${phien.rfqId}/category`, { categoryId });
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đặt được nhóm hàng")); return; }
  bao($("ok2"), "Đã đặt nhóm hàng cho gói.");
  await napRfq(phien.rfqId);
});

// [S1.284 / S4.7b1] Số ngày giao yêu cầu: để trống là xoá; ngoài miền thì trang nói, không gửi — máy chủ vẫn kiểm lại.
$("nut-so-ngay-giao").addEventListener("click", async () => {
  bao($("loi2"), ""); bao($("ok2"), "");
  if (phien.rfqId === "") { bao($("loi2"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const soNgayGiao = docSoNgayGiao($("so-ngay-giao").value);
  if (soNgayGiao === undefined) {
    bao($("loi2"), `Số ngày giao yêu cầu phải là số nguyên từ 1 đến ${SO_NGAY_GIAO_TOI_DA}, hoặc để trống.`);
    return;
  }
  const r = await goi("PUT", `/rfqs/${phien.rfqId}/delivery-days`, { soNgayGiao });
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không lưu được số ngày giao")); return; }
  bao($("ok2"), soNgayGiao === null ? "Đã xoá số ngày giao yêu cầu của gói." : `Đã lưu số ngày giao yêu cầu: ${soNgayGiao} ngày.`);
  await napRfq(phien.rfqId);
});

// ---------------------------------------------------------------------------------------------
// Bước 3 — hạng mục
// ---------------------------------------------------------------------------------------------

async function napHangMuc() {
  const id = phien.rfqId;
  const r = await goi("GET", `/rfqs/${id}/items`);
  // [S1.234 / S4.3b] Trạng thái ánh xạ từng dòng — chỉ khi gói đã rời DRAFT (trước đó chưa có lượt chuẩn hoá nào). ~~Đọc hỏng thì
  // cột ấy để `—`: bảng hạng mục không phụ thuộc nó.~~ [lượt soi L3] Cột chỉ hiện khi `hienCotHangChuan`: gói còn soạn, tổ chức chưa
  // khai hàng chuẩn nào, hay đọc hỏng ⇒ bảng của hôm nay, bốn cột.
  let anhXa = new Map();
  let hienCot = false;
  if (luong.trangThaiGoi !== "" && luong.trangThaiGoi !== "DRAFT") {
    const m = await goi("GET", `/rfqs/${id}/mappings`);
    if (m.status === 200 && Array.isArray(m.body?.dong)) {
      anhXa = new Map(m.body.dong.map((d) => [d.lineNo, d]));
      hienCot = hienCotHangChuan(m.body);
    }
  }
  // Câu trả chỉ được vẽ khi nó là của gói ĐANG mở trên màn — khuôn `napNganSach` (lượt soi S1.200 F4).
  if (id !== phien.rfqId) return;
  $("th-hang-chuan").hidden = !hienCot;
  const tb = $("bang-hm").querySelector("tbody");
  tb.replaceChildren();
  const ds = Array.isArray(r.body?.items) ? r.body.items : [];
  phien = { ...phien, soHangMuc: ds.length };
  for (const hm of ds) {
    const tr = document.createElement("tr");
    const ax = anhXa.get(hm.lineNo);
    const o = [[hm.lineNo, "so"], [hm.description, ""], [hm.quantity, "so"], [hm.unit, ""]];
    if (hienCot) o.push([ax === undefined ? null : nhanAnhXa(ax), ""]);
    for (const [v, lop] of o) {
      const td = document.createElement("td");
      td.textContent = v === null || v === undefined ? "—" : String(v);
      if (lop !== "") td.className = lop;
      tr.append(td);
    }
    tb.append(tr);
  }
}

$("nut-them-hm").addEventListener("click", async () => {
  bao($("loi3"), "");
  if (phien.rfqId === "") { bao($("loi3"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const description = $("hm-mo-ta").value.trim();
  const quantity = $("hm-sl").value.trim();
  const unit = $("hm-dvt").value.trim();
  if (description === "" || quantity === "" || unit === "") { bao($("loi3"), "Cần đủ mô tả, số lượng và đơn vị."); return; }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/items`, { lineNo: phien.soHangMuc + 1, description, quantity, unit });
  if (r.status !== 201) { bao($("loi3"), loiCua(r, "Không thêm được hạng mục")); return; }
  $("hm-mo-ta").value = ""; $("hm-sl").value = ""; $("hm-dvt").value = "";
  await napHangMuc();
});

// ---------------------------------------------------------------------------------------------
// Bước 4 — ngân sách, nộp duyệt, phê duyệt, mở
// ---------------------------------------------------------------------------------------------

$("nut-ns").addEventListener("click", async () => {
  bao($("loi4"), ""); bao($("ok4"), "");
  if (phien.rfqId === "") { bao($("loi4"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const r = await goi("PUT", `/rfqs/${phien.rfqId}/budget`, { estimatedValue: $("ns").value.trim(), currency: $("tien-te").value.trim() });
  if (r.status !== 200) { bao($("loi4"), loiCua(r, "Không đặt được ngân sách")); return; }
  // [S1.200 / khoản 258 — lượt soi N4] Người tạo gói đọc lại bảng đủ năm hàng. Người mua khác cũng đặt được ngân sách (`rfq.create`)
  // nhưng không đọc được nó nếu không giữ `rfq.approve` — màn không hỏi thay họ, và vẽ ba thứ lần đặt trả về.
  if (phien.toiTao === true) { await napNganSach(); return; }
  const b = r.body?.budget ?? {};
  dienDl($("tt-ns"), [
    ["Giá trị ước lượng", b.estimatedValue],
    ["Tiền tệ", b.currency],
    ["Cần hai người duyệt", b.requiresDualApproval === true ? "có" : "không"],
  ]);
});

for (const [nut, duong, xong] of [
  ["nut-nop-duyet", "submit", "Đã nộp duyệt. Người KHÁC phải phê duyệt — người tạo không tự duyệt được."],
  ["nut-duyet", "approve", "Đã ghi một phê duyệt."],
  ["nut-mo", "open", ""],
]) {
  $(nut).addEventListener("click", async () => {
    bao($("loi4"), ""); bao($("ok4"), "");
    if (phien.rfqId === "") { bao($("loi4"), "Tạo hoặc đọc một gói thầu trước."); return; }
    // [S1.198 / khoản 256] Lời duyệt mang lần nộp đã đọc; tổ chức chưa bật không đòi nó, gửi thì phải đúng.
    const than = duong === "approve" && typeof phien.lanNop === "number" ? { lanNop: phien.lanNop } : undefined;
    // [S1.273 / S3.3e1 — lượt soi CAO-1] Danh sách đang thấy không cùng lần nộp với lần đọc gói ⇒ không gửi chữ ký lên nó.
    if (duong === "approve" && luong.daBat && phien.coQuyenMoi && !phien.danhSachKhop) {
      bao($("loi4"), "Danh sách mời đang thấy chưa chắc là của lần nộp này — bấm «Đọc» ở bước gói thầu rồi xem lại trước khi phê duyệt.");
      return;
    }
    const r = await goi("POST", `/rfqs/${phien.rfqId}/${duong}`, than);
    if (r.status !== 200) {
      // [S1.273 / S3.3e1] Lời từ chối có mã của chốt (K2, K3, K5) kèm MỘT câu chỉ dẫn; câu của máy chủ vẫn đứng trước.
      // [S1.283 / S3.4b · K9] …và của K9 — câu chỉ khối khai báo ở bước này.
      const chiDan = chiDanChot(r.body?.ma, phien.coQuyenMoi) ?? chiDanK9(r.body?.ma);
      const cau = loiCua(r, "Bước này không đi được");
      // [lượt soi CAO-1] Lần duyệt hỏng (lần nộp lệch, gói đổi trạng thái) ⇒ đọc lại trọn gói trước khi người duyệt thử lại.
      if (duong === "approve") await napRfq(phien.rfqId);
      bao($("loi4"), chiDan === null ? cau : `${cau} ${chiDan}`);
      return;
    }
    if (duong === "open") {
      // [S1.191 / S3.2c2 · ADR-113] Gói ĐÃ mở dù một phần link chưa đi — câu báo nói số link ấy, bảng lời mời chỉ dòng.
      const b = baoSauKhiMo(luong.daBat, r.body?.unsentInvitationIds);
      bao($(b.loi ? "loi4" : "ok4"), b.chu);
    } else {
      bao($("ok4"), xong);
    }
    await napRfq(phien.rfqId);
  });
}

// [S1.191 / S3.2c2] Trả gói đang chờ duyệt về soạn thảo (`POST /rfqs/:rfqId/return-to-draft`, `077`): lý do bắt buộc và
// vào sổ; chữ ký cũ không bị xoá — chúng thôi đếm khi nội dung hay danh sách đổi (K4b).
$("nut-tra-ve").addEventListener("click", async () => {
  bao($("loi4"), ""); bao($("ok4"), "");
  if (phien.rfqId === "") { bao($("loi4"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const lyDo = $("ly-do-tra-ve").value;
  const sai = loiLyDo(lyDo);
  if (sai !== null) { bao($("loi4"), sai); return; }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/return-to-draft`, { reason: lyDo.trim() });
  if (r.status !== 200) { bao($("loi4"), loiCua(r, "Không trả gói về soạn thảo được")); return; }
  $("ly-do-tra-ve").value = "";
  bao($("ok4"), "Đã trả gói về soạn thảo. Sửa hạng mục hay danh sách mời rồi nộp duyệt lại — người duyệt phải ký lại " +
    "nếu nội dung hay danh sách đã đổi.");
  await napRfq(phien.rfqId);
});

// ---------------------------------------------------------------------------------------------
// Bước 5 — nhà cung cấp và lời mời
// ---------------------------------------------------------------------------------------------

$("nut-tao-ncc").addEventListener("click", async () => {
  bao($("loi5"), ""); bao($("ok5"), "");
  const r = await goi("POST", "/suppliers", { legalName: $("ncc-ten").value.trim(), taxCode: $("ncc-mst").value.trim() });
  if (r.status !== 201) { bao($("loi5"), loiCua(r, "Không tạo được nhà cung cấp")); return; }
  const id = r.body?.supplier?.id ?? "";
  // [S1.273 / S3.3e1] Hồ sơ vừa tạo vào ô chọn và được chọn — chỉ hồ sơ này được thêm người liên hệ ở màn (lượt soi TRUNG-1).
  await napNhaCungCap(id);
  await chonNhaCungCap(id, true);
  bao($("ok5"), "Đã tạo nhà cung cấp. Thêm một người liên hệ rồi mới mời được.");
});

$("nut-them-lh").addEventListener("click", async () => {
  bao($("loi5"), ""); bao($("ok5"), "");
  if (phien.supplierId === "") { bao($("loi5"), "Tạo nhà cung cấp trước."); return; }
  // [S1.273 / S3.3e1 — lượt soi TRUNG-1] Người liên hệ không xoá được: thêm vào hồ sơ của người khác làm nhà cung cấp ấy thôi được
  // đếm ở gói của bạn và mất xác minh trong cả tổ chức. Màn chỉ cho hồ sơ vừa tạo ở đây.
  if (!phien.nccTaoTrongPhien) {
    bao($("loi5"), "Chỉ thêm người liên hệ được cho nhà cung cấp vừa tạo ở bước này. Hồ sơ có sẵn cần thêm người liên hệ thì nhờ người " +
      "quản lý hồ sơ ấy.");
    return;
  }
  const r = await goi("POST", `/suppliers/${phien.supplierId}/contacts`, {
    fullName: $("lh-ten").value.trim(),
    email: $("lh-email").value.trim(),
    phone: $("lh-dt").value.trim(),
  });
  if (r.status !== 201) { bao($("loi5"), loiCua(r, "Không thêm được người liên hệ")); return; }
  const lh = r.body?.contact?.id ?? "";
  await chonNhaCungCap(phien.supplierId, true);
  phien = { ...phien, contactId: lh };
  $("chon-lh").value = lh;
  bao($("ok5"), "Đã thêm người liên hệ.");
});

$("nut-moi").addEventListener("click", async () => {
  bao($("loi5"), ""); bao($("ok5"), "");
  if (phien.rfqId === "" || phien.supplierId === "" || phien.contactId === "") {
    bao($("loi5"), "Cần một gói thầu, một nhà cung cấp và một người liên hệ.");
    return;
  }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/invitations`, { supplierId: phien.supplierId, contactId: phien.contactId });
  if (r.status !== 201) { bao($("loi5"), loiCua(r, "Không mời được")); return; }
  // Mã mời KHÔNG về màn này: nó đi thẳng tới bộ gửi, và thân `201` chỉ mang id lời mời.
  // [S1.191 / S3.2c2 · ADR-113] Ở tổ chức đã bật, `201` không còn nghĩa là link đã đi — câu báo đọc trạng thái thật.
  const b = baoSauKhiMoi(r.body?.invitation ?? {});
  bao($(b.loi ? "loi5" : "ok5"), b.chu);
  await napLoiMoi();
});

$("nut-doc-moi").addEventListener("click", async () => {
  bao($("loi5"), "");
  if (phien.rfqId === "") { bao($("loi5"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const lan = await napLoiMoi();
  // [S1.273 / S3.3e1 — lượt soi CAO-1] Danh sách của một lần nộp khác lần đọc gói ⇒ đọc lại trọn gói.
  if (luong.daBat && lan !== null && !cungLanNop(phien.lanNop, lan)) await napRfq(phien.rfqId);
});

// ---------------------------------------------------------------------------------------------
// [S1.273 / S3.3e1] Bước 5 — ô chọn nhà cung cấp có sẵn
// ---------------------------------------------------------------------------------------------

let nhaCungCap = [];

// [S1.273 / S3.3e1] Nhãn cột cho bảng xếp khối trên màn hẹp (`table.xep`, `chung.css`).
const NHAN_COT_LOI_MOI = ["Nhà cung cấp", "Người liên hệ", "Kênh", "Trạng thái", "Đã xác minh", "Đếm được"];
const NHAN_COT_NGOAI_LE = ["Loại", "Lý do", "Giải trình", "Lập lúc", "Trạng thái"];

/** Đổi người hay đăng xuất: ô chọn của người trước (có thể của tổ chức khác) đi cùng các bước. */
function xoaNhaCungCap() {
  nhaCungCap = [];
  $("chon-ncc").replaceChildren();
  $("chon-lh").replaceChildren();
  bao($("xac-minh-ncc"), "");
  hien($("ghi-them-lh"), false);
}

/** Nạp `GET /suppliers` (không cổng) vào ô chọn; chọn sẵn `chon` nếu có. Chỉ hồ sơ ACTIVE — hồ sơ khác không mời được. */
async function napNhaCungCap(chon) {
  const r = await goi("GET", "/suppliers");
  nhaCungCap = r.status === 200 ? docNhaCungCapChon(r.body) : [];
  const sel = $("chon-ncc");
  sel.replaceChildren();
  const trong = document.createElement("option");
  trong.value = "";
  trong.textContent = "— chọn nhà cung cấp —";
  sel.append(trong);
  for (const n of nhaCungCap) {
    const o = document.createElement("option");
    o.value = n.id;
    o.textContent = tenKemMst(n.legalName, n.taxCode);
    sel.append(o);
  }
  sel.value = nhaCungCap.some((n) => n.id === chon) ? chon : "";
}

/**
 * Chọn một nhà cung cấp: nạp người liên hệ đang hoạt động (`GET …/contacts`, không cổng) và — ở tổ chức đã bật — trạng thái xác minh
 * (`GET …/verification`, không cổng). `taoTrongPhien`: hồ sơ vừa tạo ở bước này, chỉ hồ sơ ấy được thêm người liên hệ.
 */
async function chonNhaCungCap(id, taoTrongPhien) {
  phien = { ...phien, supplierId: id, contactId: "", nccTaoTrongPhien: taoTrongPhien };
  hien($("ghi-them-lh"), id !== "" && !taoTrongPhien);
  const lh = $("chon-lh");
  lh.replaceChildren();
  bao($("xac-minh-ncc"), "");
  if (id === "") return;
  const [c, v] = await Promise.all([
    goi("GET", `/suppliers/${id}/contacts`),
    luong.daBat ? goi("GET", `/suppliers/${id}/verification`) : Promise.resolve(null),
  ]);
  if (phien.supplierId !== id) return;
  const ds = c.status === 200 && Array.isArray(c.body?.contacts) ? c.body.contacts.filter((x) => x?.status === "ACTIVE") : [];
  for (const x of ds) {
    const o = document.createElement("option");
    o.value = x.id;
    o.textContent = `${vanBanAnToan(x.fullName)} — ${x.email}${typeof x.phone === "string" && x.phone !== "" ? `, ${x.phone}` : ""}`;
    lh.append(o);
  }
  phien = { ...phien, contactId: ds[0]?.id ?? "" };
  lh.value = phien.contactId;
  if (ds.length === 0 && !taoTrongPhien) bao($("loi5"), "Nhà cung cấp này chưa có người liên hệ đang hoạt động — chưa mời được.");
  if (v !== null) bao($("xac-minh-ncc"), nhanXacMinhNgan(v.status === 200 ? v.body?.verification : null));
}

$("chon-ncc").addEventListener("change", async () => {
  bao($("loi5"), ""); bao($("ok5"), "");
  await chonNhaCungCap($("chon-ncc").value, false);
});

$("chon-lh").addEventListener("change", () => {
  phien = { ...phien, contactId: $("chon-lh").value };
});

$("nut-doc-ncc").addEventListener("click", async () => {
  bao($("loi5"), "");
  await napNhaCungCap(phien.supplierId);
});

// ---------------------------------------------------------------------------------------------
// [S1.273 / S3.3e1] Ngoại lệ cạnh tranh — spec S3 §4.4, `105`
// ---------------------------------------------------------------------------------------------

/** Xoá hai danh sách của gói trước — đổi người, đổi gói, hay người xem không đọc được chúng. */
function xoaDanhSach() {
  $("bang-moi").querySelector("tbody").replaceChildren();
  $("bang-ngoai-le").querySelector("tbody").replaceChildren();
  bao($("tom-tat-canh-tranh"), "");
}

/** Hai ô chọn của khối lập ngoại lệ; loại được chọn sẵn theo số lời mời còn sống (khớp chặt của K2). */
let daVeChonNgoaiLe = false;
function veChonNgoaiLe() {
  if (!luong.daBat) return;
  const loai = $("loai-ngoai-le");
  if (!daVeChonNgoaiLe) {
    daVeChonNgoaiLe = true;
    for (const l of LOAI_NGOAI_LE) {
      const o = document.createElement("option");
      o.value = l;
      o.textContent = nhanLoaiNgoaiLe(l);
      loai.append(o);
    }
    const ma = $("ma-ly-do");
    for (const m of MA_LY_DO_NGOAI_LE) {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = nhanMaLyDo(m);
      ma.append(o);
    }
  }
  const goiY = loaiNgoaiLeGoiY(phien.soLoiMoiSong);
  if (goiY !== null && loai.value !== "ROTATION") loai.value = goiY;
}

/** `GET /rfqs/:rfqId/exceptions` — vẽ bảng, trả `lanNop` của danh sách (hay `null` khi đọc hỏng). */
async function napNgoaiLe() {
  const id = phien.rfqId;
  if (id === "") return null;
  const r = await goi("GET", `/rfqs/${id}/exceptions`);
  if (phien.rfqId !== id) return null;
  const tb = $("bang-ngoai-le").querySelector("tbody");
  tb.replaceChildren();
  if (r.status !== 200) { bao($("loi-nl"), loiCua(r, "Không đọc được danh sách ngoại lệ")); return null; }
  veChonNgoaiLe();
  for (const e of Array.isArray(r.body?.exceptions) ? r.body.exceptions : []) {
    const tr = document.createElement("tr");
    const lap = typeof e.lapLuc === "string" ? new Date(e.lapLuc).toLocaleString("vi-VN") : "—";
    const trangThai = e.rut === null ? "còn hiệu lực" : `đã rút — ${vanBanAnToan(e.rut?.lyDo)}`;
    [nhanLoaiNgoaiLe(e.loai), nhanMaLyDo(e.maLyDo), vanBanAnToan(e.giaiTrinh), lap, trangThai].forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = v;
      td.dataset.nhan = NHAN_COT_NGOAI_LE[i];
      tr.append(td);
    });
    const td = document.createElement("td");
    if (e.rut === null && luong.trangThaiGoi === "DRAFT") {
      const nut = document.createElement("button");
      nut.className = "phu";
      nut.textContent = "Rút";
      nut.addEventListener("click", () => rutNgoaiLe(e.id, nut));
      td.append(nut);
    }
    tr.append(td);
    tb.append(tr);
  }
  return typeof r.body?.lanNop === "number" ? r.body.lanNop : null;
}

async function rutNgoaiLe(exceptionId, nut) {
  bao($("loi-nl"), ""); bao($("ok-nl"), "");
  const lyDo = $("ly-do-rut").value;
  const sai = loiLyDo(lyDo);
  if (sai !== null) { bao($("loi-nl"), sai); return; }
  const id = phien.rfqId;
  nut.disabled = true;
  try {
    const r = await goi("POST", `/rfqs/${id}/exceptions/${exceptionId}/withdraw`, { reason: lyDo.trim() });
    if (phien.rfqId !== id) return;
    if (r.status !== 200) { bao($("loi-nl"), loiCua(r, "Không rút được ngoại lệ")); return; }
    $("ly-do-rut").value = "";
    bao($("ok-nl"), "Đã rút ngoại lệ. Gói không đủ cạnh tranh sẽ bị chặn lại ở lần nộp duyệt.");
    await napNgoaiLe();
  } catch {
    bao($("loi-nl"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    nut.disabled = false;
  }
}

$("nut-lap-ngoai-le").addEventListener("click", async () => {
  bao($("loi-nl"), ""); bao($("ok-nl"), "");
  if (phien.rfqId === "") { bao($("loi-nl"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const loai = $("loai-ngoai-le").value;
  const maLyDo = $("ma-ly-do").value;
  const giaiTrinh = $("giai-trinh").value;
  const sai = loiGiaiTrinh(maLyDo, giaiTrinh);
  if (sai !== null) { bao($("loi-nl"), sai); return; }
  const id = phien.rfqId;
  $("nut-lap-ngoai-le").disabled = true;
  try {
    const r = await goi("POST", `/rfqs/${id}/exceptions`, { loai, maLyDo, giaiTrinh: giaiTrinh.trim() });
    if (phien.rfqId !== id) return;
    if (r.status !== 201) { bao($("loi-nl"), loiCua(r, "Không lập được ngoại lệ")); return; }
    $("giai-trinh").value = "";
    bao($("ok-nl"), `Đã lập ngoại lệ «${nhanLoaiNgoaiLe(loai)}». Bạn không còn là người ký độc lập của gói này; người duyệt thấy ngoại ` +
      "lệ cùng danh sách mời.");
    await napNgoaiLe();
  } catch {
    bao($("loi-nl"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    $("nut-lap-ngoai-le").disabled = false;
  }
});

$("nut-xem-ngoai-le").addEventListener("click", async () => {
  bao($("loi-nl"), ""); bao($("ok-nl"), "");
  if (phien.rfqId === "") { bao($("loi-nl"), "Tạo hoặc đọc một gói thầu trước."); return; }
  const lan = await napNgoaiLe();
  if (lan !== null && !cungLanNop(phien.lanNop, lan)) await napRfq(phien.rfqId);
});

async function napLoiMoi() {
  const id = phien.rfqId;
  const r = await goi("GET", `/rfqs/${id}/invitations`);
  if (phien.rfqId !== id) return null;
  const tb = $("bang-moi").querySelector("tbody");
  tb.replaceChildren();
  bao($("tom-tat-canh-tranh"), "");
  if (r.status !== 200) { bao($("loi5"), loiCua(r, "Không đọc được danh sách lời mời")); return null; }
  const ds = Array.isArray(r.body?.invitations) ? r.body.invitations : [];
  // [S1.273 / S3.3e1] Số lời mời còn sống chọn sẵn loại ngoại lệ; số NHÓM đếm được của K2 nói ở một câu trên bảng (lượt soi TRUNG-2).
  phien = { ...phien, soLoiMoiSong: ds.filter((m) => m?.revokedAt === null).length };
  // [S1.283 / S3.4b · K9] Nhà cung cấp của bảng vừa đọc — ô *có xung đột với* của khối khai báo vẽ lại từ đó.
  phien = { ...phien, nccKhai: nhaCungCapTuLoiMoi(ds) };
  khaiBao.veNhaCungCap();
  if (luong.daBat) bao($("tom-tat-canh-tranh"), nhanCanhTranh(r.body?.canhTranh) ?? "");
  veChonNgoaiLe();
  for (const m of ds) {
    const tr = document.createElement("tr");
    // [S1.193 / S3.2c2 · K6] Lời mời thêm lúc gói đã mở mang nhãn *mời sau khi ký* — `listInvitations` trả cờ ấy.
    const o = [vanBanAnToan(m.supplierName), vanBanAnToan(m.contactName), m.linkChannel, nhanLoiMoi(m.status, m.moiSauKhiKy)];
    // [S1.273 / S3.3e1] Hai cột của tổ chức đã bật: nhà cung cấp còn xác minh, lời mời thuộc tập đếm được của K2.
    if (luong.daBat) o.push(nhanCo(m.xacMinhConHieuLuc), nhanCo(m.demDuoc));
    o.forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = v === null || v === undefined ? "—" : String(v);
      td.dataset.nhan = NHAN_COT_LOI_MOI[i];
      tr.append(td);
    });
    const td = document.createElement("td");
    // [S1.191 / S3.2c2] Nút theo luồng và trạng thái gói: ở tổ chức đã bật, thu hồi chỉ ở DRAFT (K4a) và gửi lại chỉ khi
    // gói nhận báo giá (K6 — trước lần mở chưa có token nào).
    const nutDong = nutLoiMoi(luong.daBat, luong.trangThaiGoi, m.revokedAt !== null);
    if (nutDong.guiLai || nutDong.thuHoi) {
      // [S1.181 / ADR-110] Nhà cung cấp mất phiên (thoát, hết 4 giờ, đổi máy) thì bên mua GỬI LẠI link cho chính lời mời
      // này — cùng người liên hệ, cùng kênh, về đúng hồ sơ báo giá đã nộp. Thu hồi rồi mời lại là một lời mời và một luồng
      // báo giá MỚI, nên không phải đường cho việc này.
      const guiLai = document.createElement("button");
      guiLai.className = "phu";
      guiLai.textContent = "Gửi lại link";
      guiLai.addEventListener("click", async () => {
        bao($("loi5"), ""); bao($("ok5"), "");
        guiLai.disabled = true;
        // [lượt soi] Mất mạng giữa chừng thì `goi` NÉM: không có `finally` thì nút kẹt ở trạng thái tắt, không một câu báo.
        let gl;
        try {
          gl = await goi("POST", `/invitations/${m.id}/reissue`);
        } catch {
          bao($("loi5"), "Không gửi lại được link — mất kết nối tới máy chủ. Kiểm tra mạng rồi bấm lại.");
          return;
        } finally {
          guiLai.disabled = false;
        }
        if (gl.status === 429) { bao($("loi5"), "Lời mời này đã được gửi đủ số link cho phép trong một giờ — thử lại sau."); return; }
        // [lượt soi] 502: link cũ chưa dùng đã hết hiệu lực TRƯỚC lần gửi, và lần hỏng vẫn tính vào trần 3 link một giờ.
        if (gl.status === 502) {
          bao($("loi5"), "Không gửi được link mới. Link cũ chưa dùng của lời mời này đã hết hiệu lực, nên nhà cung cấp hiện " +
            "không có link nào — bấm lại sau ít phút. Mỗi lời mời gửi được tối đa 3 link mỗi giờ, kể cả lần gửi hỏng.");
          return;
        }
        if (gl.status !== 200) { bao($("loi5"), loiCua(gl, "Không gửi lại được link")); return; }
        bao($("ok5"), `Đã gửi link mới tới ${m.contactName} qua ${m.linkChannel}. Link cũ chưa dùng (nếu có) đã hết hiệu lực; ` +
          "nhà cung cấp vào lại đúng báo giá đã nộp.");
        // [S1.191 / S3.2c2] Lời mời «chưa gửi» của tổ chức đã bật thành «đã gửi» sau lần gửi lại được — vẽ lại bảng.
        if (luong.daBat) await napLoiMoi();
      });
      const nut = document.createElement("button");
      nut.className = "phu";
      nut.textContent = "Thu hồi";
      nut.addEventListener("click", async () => {
        bao($("loi5"), ""); bao($("ok5"), "");
        const th = await goi("POST", `/invitations/${m.id}/revoke`);
        if (th.status !== 200) { bao($("loi5"), loiCua(th, "Không thu hồi được")); return; }
        // ~~"Đã thu hồi. Mời lại nhà cung cấp ấy được rồi."~~ [S1.181 / ADR-110] Mời lại sau thu hồi là một hồ sơ báo giá
        // MỚI, ~~và báo giá đã nộp theo lời mời vừa thu hồi vẫn nằm trong gói thầu (sổ nợ)~~ — nói ra, và chỉ đường gửi lại link.
        // [S1.240 / khoản 276 / ADR-128] Thu hồi LOẠI báo giá của lời mời ấy khỏi lượt mở thầu, bảng so sánh và xếp hạng: câu nói thẳng.
        bao($("ok5"), "Đã thu hồi. Báo giá đã nộp theo lời mời này (nếu có) không dự thầu nữa — nó không được mở thầu, so sánh " +
          "hay xếp hạng. Nhà cung cấp chỉ cần link mới thì dùng «Gửi lại link», đừng thu hồi.");
        await napLoiMoi();
      });
      if (nutDong.guiLai) td.append(guiLai);
      if (nutDong.thuHoi) td.append(nut);
    }
    tr.append(td);
    tb.append(tr);
  }
  return typeof r.body?.lanNop === "number" ? r.body.lanNop : null;
}

docLink();
thuPhienCo();

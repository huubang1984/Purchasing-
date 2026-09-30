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
  baoSauKhiMo, baoSauKhiMoi, hangNganSach, hienTraVe, loiLyDo, nhanLoiMoi, nutLoiMoi, thuTuBuoc, tuDocNganSach,
} from "/lib/tao-thau.js";
import { docNhomHang, hienDatNhomHang, luaChonNhomHang, nhanNhomHangCuaGoi } from "/lib/nhom-hang.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

let phien = { orgId: "", token: "", daRedeem: false, rfqId: "", supplierId: "", contactId: "", soHangMuc: 0 };
// [S1.191 / S3.2c2] Luồng của tổ chức (`daBat`) và trạng thái gói đang mở trên màn — dựng lại mỗi lần đổi người.
let luong = { daBat: false, trangThaiGoi: "" };
// [S1.201 / S3.6a] Nhóm hàng của tổ chức (`GET /categories`) — chỉ nạp ở tổ chức đã bật, nơi gói không nhóm hàng không nộp
// duyệt được.
let nhomHang = [];
// [S1.200 / khoản 258] `userId` của phiên đang dùng màn (`GET /me`), rỗng trước khi đăng nhập.
let nguoiDung = "";

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

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: magic link + TOTP. Cùng khuôn `mo-thau.js`, kể cả hai phép sửa mà lượt
// chạy thử đầu tiên của màn ấy ép ra: đọc CẢ mã tổ chức từ fragment, và gọi `/auth/redeem` ĐÚNG
// một lần cho mỗi mã đăng nhập (gọi lại là máy chủ sinh bí mật TOTP mới, và mã của người dùng
// không bao giờ đúng nữa).
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
  phien = { orgId: "", token: $("token").value.trim(), daRedeem: false, rfqId: "", supplierId: "", contactId: "", soHangMuc: 0 };
  datLuong({ daBat: false, trangThaiGoi: "" });
  nguoiDung = "";
  xoaNganSach();
  for (const id of ["loi1", "loi2", "loi3", "loi4", "ok1", "ghi-danh"]) {
    const el = $(id);
    if (el !== null) bao(el, "");
  }
  dongCacBuoc();
  thuPhienCo();
});

$("nut-vao").addEventListener("click", async () => {
  bao($("loi1"), ""); bao($("ghi-danh"), "");
  const orgId = $("org").value.trim();
  const token = $("token").value.trim();
  const code = $("ma").value.trim();
  if (token !== phien.token) phien = { ...phien, token, daRedeem: false };
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
    phien = { ...phien, orgId, token };
    xoaManhLink();
    const me = await goi("GET", "/me");
    moSauDangNhap(me.body, false);
  } finally {
    $("nut-vao").disabled = false;
  }
});

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
  void napLuong();
}

/**
 * [S1.191 / S3.2c2] Tổ chức đã bật kiểm soát theo bậc chưa — `daBat` của `GET /policy/versions`, đúng hàm công tắc mà
 * máy chủ hỏi (ADR-080). Đọc hỏng thì màn ở luồng MVP1: máy chủ vẫn từ chối mọi thao tác sai luồng, màn chỉ nói kém đi.
 */
async function napLuong() {
  try {
    const r = await goi("GET", "/policy/versions");
    datLuong({ ...luong, daBat: r.status === 200 && r.body?.daBat === true });
    if (luong.daBat) await napNhomHang(null);
  } catch { /* mất mạng: giữ luồng MVP1 */ }
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
}

/** [S1.177] Về lại bước 1: ẩn mọi bước sau, bỏ dấu "xong", bỏ khối hỏi phiên và nút Đăng xuất. */
function dongCacBuoc() {
  $("b1").classList.remove("xong");
  for (const b of CAC_BUOC_SAU) hien($(b), false);
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), false);
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
    phien = { orgId: "", token: $("token").value.trim(), daRedeem: false, rfqId: "", supplierId: "", contactId: "", soHangMuc: 0 };
    datLuong({ daBat: false, trangThaiGoi: "" });
    nguoiDung = "";
    xoaNganSach();
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
// Bước 2 — gói thầu
// ---------------------------------------------------------------------------------------------

async function napRfq(rfqId) {
  const r = await goi("GET", `/rfqs/${rfqId}`);
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được gói thầu")); return false; }
  const g = r.body?.rfq ?? {};
  // [S1.198 / khoản 256] Lần nộp của CHÍNH lần đọc này — nút Phê duyệt gửi lại đúng con số ấy, nên chữ ký rơi lên thứ người duyệt
  // đang thấy trên màn. Gói được trả về và nộp lại sau lần đọc thì máy chủ từ chối, và người duyệt đọc lại.
  phien = { ...phien, rfqId, lanNop: typeof g.lanNop === "number" ? g.lanNop : undefined };
  datLuong({ ...luong, trangThaiGoi: typeof g.status === "string" ? g.status : "" });
  // [S1.200 / khoản 258 — lượt soi F4] Bảng ngân sách của gói TRƯỚC đi ngay, trước lần chờ đầu tiên: một lần đọc sau đó hỏng
  // giữa chừng không được để lại ngân sách của gói khác cạnh lần nộp mà nút Phê duyệt sẽ gửi.
  const toiTao = tuDocNganSach(nguoiDung, g.createdBy);
  phien = { ...phien, toiTao };
  dienDl($("tt-ns"), []);
  hien($("nut-xem-ns"), !toiTao);
  const hang = [
    ["Mã gói thầu", rfqId],
    ["Tên", g.title],
    ["Trạng thái", g.status],
    ["Hạn nộp", g.deadlineAt === undefined ? null : new Date(g.deadlineAt).toLocaleString("vi-VN")],
    ["Cần hai người duyệt", g.requiresDualApproval === true ? "có" : "không"],
    ["Lần nộp duyệt", g.lanNop],
  ];
  // [S1.201 / S3.6a] Nhóm hàng của gói — chỉ ở tổ chức đã bật; ô chọn nhảy về đúng nhóm gói đang giữ.
  if (luong.daBat) {
    hang.push(["Nhóm hàng", nhanNhomHangCuaGoi(nhomHang, g.categoryId)]);
    veChonNhomHang(typeof g.categoryId === "string" ? g.categoryId : null);
  }
  dienDl($("tt-rfq"), hang);
  await napHangMuc();
  if (luong.daBat) await napLoiMoi();
  // [S1.200 / khoản 258] Người tạo gói thấy ngân sách ở CÙNG lần đọc; người khác bấm «Xem ngân sách» (chủ dự án chốt sau lượt
  // soi F3: lần từ chối phải đến từ một thao tác cố ý, không từ nhịp đọc gói).
  if (toiTao) await napNganSach();
  return true;
}

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

// ---------------------------------------------------------------------------------------------
// Bước 3 — hạng mục
// ---------------------------------------------------------------------------------------------

async function napHangMuc() {
  const r = await goi("GET", `/rfqs/${phien.rfqId}/items`);
  const tb = $("bang-hm").querySelector("tbody");
  tb.replaceChildren();
  const ds = Array.isArray(r.body?.items) ? r.body.items : [];
  phien = { ...phien, soHangMuc: ds.length };
  for (const hm of ds) {
    const tr = document.createElement("tr");
    for (const [v, lop] of [[hm.lineNo, "so"], [hm.description, ""], [hm.quantity, "so"], [hm.unit, ""]]) {
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
    const r = await goi("POST", `/rfqs/${phien.rfqId}/${duong}`, than);
    if (r.status !== 200) { bao($("loi4"), loiCua(r, "Bước này không đi được")); return; }
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
  phien = { ...phien, supplierId: r.body?.supplier?.id ?? "", contactId: "" };
  bao($("ok5"), "Đã tạo nhà cung cấp. Thêm một người liên hệ rồi mới mời được.");
});

$("nut-them-lh").addEventListener("click", async () => {
  bao($("loi5"), ""); bao($("ok5"), "");
  if (phien.supplierId === "") { bao($("loi5"), "Tạo nhà cung cấp trước."); return; }
  const r = await goi("POST", `/suppliers/${phien.supplierId}/contacts`, {
    fullName: $("lh-ten").value.trim(),
    email: $("lh-email").value.trim(),
    phone: $("lh-dt").value.trim(),
  });
  if (r.status !== 201) { bao($("loi5"), loiCua(r, "Không thêm được người liên hệ")); return; }
  phien = { ...phien, contactId: r.body?.contact?.id ?? "" };
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
  await napLoiMoi();
});

async function napLoiMoi() {
  const r = await goi("GET", `/rfqs/${phien.rfqId}/invitations`);
  const tb = $("bang-moi").querySelector("tbody");
  tb.replaceChildren();
  if (r.status !== 200) { bao($("loi5"), loiCua(r, "Không đọc được danh sách lời mời")); return; }
  for (const m of Array.isArray(r.body?.invitations) ? r.body.invitations : []) {
    const tr = document.createElement("tr");
    // [S1.193 / S3.2c2 · K6] Lời mời thêm lúc gói đã mở mang nhãn *mời sau khi ký* — `listInvitations` trả cờ ấy.
    for (const v of [m.supplierName, m.contactName, m.linkChannel, nhanLoiMoi(m.status, m.moiSauKhiKy)]) {
      const td = document.createElement("td");
      td.textContent = v === null || v === undefined ? "—" : String(v);
      tr.append(td);
    }
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
        // MỚI, và báo giá đã nộp theo lời mời vừa thu hồi vẫn nằm trong gói thầu (sổ nợ) — nói ra, và chỉ đường gửi lại link.
        bao($("ok5"), "Đã thu hồi. Báo giá đã nộp theo lời mời này (nếu có) vẫn nằm trong gói thầu. Nhà cung cấp chỉ cần link " +
          "mới thì dùng «Gửi lại link», đừng thu hồi.");
        await napLoiMoi();
      });
      if (nutDong.guiLai) td.append(guiLai);
      if (nutDong.thuHoi) td.append(nut);
    }
    tr.append(td);
    tb.append(tr);
  }
}

docLink();
thuPhienCo();

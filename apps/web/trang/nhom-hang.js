// ==============================================================================================
// [S1.201 / S3.6a] MÀN NHÓM HÀNG — spec S3 §4.3, ADR-084 ⑵
//
// Người giữ `category.manage` (mặc định FINANCE) tạo, ngừng dùng và dùng lại nhóm hàng của tổ chức. Chủ dự án chốt ngày
// 2026-09-29: mã và tên không sửa; màn riêng này, không một khối trong `/chinh-sach`. Mọi luật nằm ở máy chủ và CSDL
// (`085_nhom_hang`): màn không kiểm lại luật nào, nó chỉ nói trước điều máy chủ sẽ nói. Phép tính ở `/lib/nhom-hang.js`.
//
// Trang không chèn chuỗi nào của máy chủ vào HTML: mọi ô đi qua `textContent`.
// ==============================================================================================

import { chuanMa, docNhomHang, loiMa, nhanTrangThaiNhom, nutDoiTrangThai } from "/lib/nhom-hang.js";
import { ganDangNhap } from "/lib/dang-nhap.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

// [S1.9120 / khoản 282] ~~`let phien = { token: "", daRedeem: false };`~~ — mã đăng nhập và "đã đổi ở máy chủ chưa" nay sống trong
// `/lib/dang-nhap.js`.

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

function o(noiDung) {
  const td = document.createElement("td");
  td.textContent = noiDung;
  return td;
}

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: magic link + TOTP, cùng khuôn `chinh-sach.js` (gọi `/auth/redeem` ĐÚNG một lần cho mỗi mã).
// [S1.9120 / khoản 282] ~~Cùng khuôn~~ CÙNG MỘT BẢN với `/login`: nút Tiếp, nút Vào và khối link đăng nhập gần đây là
// `/lib/dang-nhap.js`; trang giữ `docLink`, lối hỏi lại phiên, đăng xuất và `hashchange`, và gọi `dangNhap.datLai()` khi về bước 1.
// ---------------------------------------------------------------------------------------------

function docLink() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) { if (h !== "") $("token").value = h; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}
docLink();
// [S1.177] Đổi người trong cùng thẻ: đóng các bước về bước 1, rồi hỏi lại phiên (khuôn `mo-thau.js`).
window.addEventListener("hashchange", () => {
  docLink();
  phienCho = null;
  for (const id of ["loi1", "ok1", "ghi-danh", "loi2", "ok2", "loi3", "ok3"]) bao($(id), "");
  dongCacBuoc();
  dangNhap.datLai();
  thuPhienCo();
});

// [S1.9120 / khoản 282] ~~Trình nghe `nut-vao` chép của `/login` cũ: `/auth/redeem` rồi `/auth/totp` trong một lượt, bí mật TOTP hiện
// cùng chỗ câu lỗi~~ — khoản 193 ở trang này. Nay bước 1 là module chung; trang trao cho nó việc của riêng mình sau khi vào.
const dangNhap = ganDangNhap({ taiLieu: document, goi, lichSu: history, viTri: location, daVao: (me) => moSauDangNhap(me, false) });

const CAC_BUOC_SAU = ["b2", "b3"];

/** [S1.177] Mở các bước sau đăng nhập — vừa đăng nhập xong, hoặc người dùng bấm "Tiếp tục với phiên này". */
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
  // [S1.9120 / khoản 282] Khối link đăng nhập gần đây (khoản 195, 268) — trước lời gọi riêng của màn, không chờ.
  void dangNhap.veLinkGanDay();
  await napNhomHang();
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
 * [S1.177] Cùng khuôn `chinh-sach.js`: lúc tải hỏi `/me`; có phiên còn hạn thì HỎI "Tiếp tục với phiên này" hay "Đăng xuất",
 * không tự mở — trên máy dùng chung phiên ấy có thể của người khác. Không hỏi khi ô mã đã có mã; `docLink()` chạy trước hàm
 * này, và ô mã được kiểm lại sau `await`.
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

$("nut-dang-xuat").addEventListener("click", async () => {
  bao($("loi1"), ""); bao($("ok1"), "");
  $("nut-dang-xuat").disabled = true;
  try {
    const r = await goi("POST", "/auth/logout");
    if (r.status !== 200 && r.status !== 401) { bao($("loi1"), loiCua(r, "Không đăng xuất được")); return; }
    phienCho = null;
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
// Bước 2 — danh sách, ngừng dùng và dùng lại
// ---------------------------------------------------------------------------------------------

async function napNhomHang() {
  bao($("loi2"), "");
  const r = await goi("GET", "/categories");
  const than = $("bang-nhom").querySelector("tbody");
  than.replaceChildren();
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được danh sách nhóm hàng")); return; }
  for (const n of docNhomHang(r.body)) {
    const tr = document.createElement("tr");
    const nut = document.createElement("button");
    const doi = nutDoiTrangThai(n.conDung);
    nut.className = "phu";
    nut.textContent = doi.nhan;
    nut.addEventListener("click", () => doiTrangThai(n, doi.conDungMoi, nut));
    const oNut = document.createElement("td");
    oNut.append(nut);
    tr.append(o(n.ma), o(n.ten), o(nhanTrangThaiNhom(n.conDung)), oNut);
    than.append(tr);
  }
}

async function doiTrangThai(n, conDung, nut) {
  bao($("loi2"), ""); bao($("ok2"), "");
  nut.disabled = true;
  try {
    const r = await goi("PUT", `/categories/${n.id}/status`, { conDung });
    if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đổi được trạng thái nhóm hàng")); return; }
    bao($("ok2"), conDung ? `Đã dùng lại nhóm ${n.ma}.` : `Đã ngừng dùng nhóm ${n.ma}. Gói đang giữ nhóm này không đổi.`);
    await napNhomHang();
  } finally {
    nut.disabled = false;
  }
}

$("nut-doc-nhom").addEventListener("click", async () => {
  bao($("ok2"), "");
  await napNhomHang();
});

// ---------------------------------------------------------------------------------------------
// Bước 3 — tạo nhóm hàng
// ---------------------------------------------------------------------------------------------

$("nut-tao-nhom").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  const loi = loiMa($("ma-nhom").value);
  if (loi !== null) { bao($("loi3"), loi); return; }
  const ten = $("ten-nhom").value.trim();
  if (ten === "") { bao($("loi3"), "Nhập tên nhóm hàng."); return; }
  $("nut-tao-nhom").disabled = true;
  try {
    const r = await goi("POST", "/categories", { ma: chuanMa($("ma-nhom").value), ten });
    if (r.status !== 201) { bao($("loi3"), loiCua(r, "Không tạo được nhóm hàng")); return; }
    bao($("ok3"), `Đã tạo nhóm ${r.body?.nhomHang?.ma ?? ""}.`);
    $("ma-nhom").value = "";
    $("ten-nhom").value = "";
    await napNhomHang();
  } finally {
    $("nut-tao-nhom").disabled = false;
  }
});

// [S1.177] Cuối tệp: mọi `let` của trang đã khởi tạo khi `moSauDangNhap` chạy.
thuPhienCo();

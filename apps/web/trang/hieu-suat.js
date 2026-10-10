// ==============================================================================================
// [S1.9101 / S3.8b] MÀN HIỆU SUẤT NHÀ CUNG CẤP — spec S3 §4.9, K11; ADR-163
//
// Người giữ `bid.view` (mặc định mua sắm, tài chính, giám đốc) đọc `GET /supplier-performance`. Mọi luật nằm ở máy chủ và CSDL
// (`123_hieu_suat_nha_cung_cap`, `packages/kiem-soat/src/hieu-suat.ts`): gói nào được đếm, sàn lịch sử, cổng quyền, hàng sổ. Màn không
// tính lại chỉ số nào; phép trình bày ở `/lib/hieu-suat.js`. Màn chỉ đọc: không nút ghi nào.
//
// Trang không chèn chuỗi nào của máy chủ vào HTML: mọi ô đi qua `textContent`.
// ==============================================================================================

import { docHieuSuat, oCuaHang, tomTat } from "/lib/hieu-suat.js";
import { vanBanAnToan } from "/lib/tao-thau.js";
import { ganDangNhap } from "/lib/dang-nhap.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

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

// Khuôn khoản 323/326: thân 403 của `apps/api` là MỘT hằng không dấu; trang nói thay bằng việc vừa làm.
const THAN_403 = "khong co quyen";

function loiCua(r, macDinh) {
  if (r.status === 403 && r.body?.error === THAN_403) {
    return `${macDinh}: tài khoản đang đăng nhập không giữ quyền xem báo giá — bảng này chỉ dành cho vai mua sắm, tài chính và ` +
      "giám đốc. Đổi sang người phù hợp ở bước 1.";
  }
  if (r.body !== null && typeof r.body === "object" && typeof r.body.error === "string") return r.body.error;
  return `${macDinh} (mã ${r.status})`;
}

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: CÙNG MỘT BẢN với `/login` (`/lib/dang-nhap.js`); trang giữ `docLink`, lối hỏi lại phiên, đăng xuất và
// `hashchange` (khuôn `nha-cung-cap.js`).
// ---------------------------------------------------------------------------------------------

function docLink() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) { if (h !== "") $("token").value = h; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}
docLink();
// [lượt soi §S1.9101 TRUNG-1] Số của lần nạp bảng mới nhất. Một lần nạp chỉ vẽ khi nó vẫn là lần mới nhất lúc máy chủ trả lời: «Đọc lại»
// bấm khi lần nạp lúc vào còn chờ, bấm hai lần, đổi người hay đăng xuất giữa chừng — bản đầu xoá bảng TRƯỚC khi chờ nên hai lần chồng
// nhau vẽ mỗi nhà cung cấp hai hàng, và lần nạp của người trước vẽ bảng của họ lên màn của người sau.
let luotNap = 0;
function boBang() {
  $("bang-hieu-suat").querySelector("tbody").replaceChildren();
  bao($("tom-tat"), "");
}
// [S1.177] Đổi người trong cùng thẻ: đóng các bước về bước 1, bỏ bảng của người trước, rồi hỏi lại phiên.
window.addEventListener("hashchange", () => {
  docLink();
  phienCho = null;
  luotNap += 1;
  for (const id of ["loi1", "ok1", "ghi-danh", "loi2"]) bao($(id), "");
  boBang();
  dongCacBuoc();
  dangNhap.datLai();
  thuPhienCo();
});

const dangNhap = ganDangNhap({ taiLieu: document, goi, lichSu: history, viTri: location, daVao: (me) => moSauDangNhap(me, false) });

const CAC_BUOC_SAU = ["b2"];

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
  void dangNhap.veLinkGanDay();
  await napHieuSuat();
}

function dongCacBuoc() {
  $("b1").classList.remove("xong");
  for (const b of CAC_BUOC_SAU) hien($(b), false);
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), false);
  dangNhap.anLinkGanDay();
}

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
    luotNap += 1;
    boBang();
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
// Bước 2 — bảng hiệu suất (chỉ đọc)
// ---------------------------------------------------------------------------------------------

async function napHieuSuat() {
  const luot = ++luotNap;
  bao($("loi2"), "");
  let r;
  try {
    r = await goi("GET", "/supplier-performance");
  } catch {
    if (luot !== luotNap) return;
    boBang();
    bao($("loi2"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
    return;
  }
  // Một lần nạp mới hơn đã bắt đầu, hay người đã đổi: lần này không vẽ gì. Xoá và vẽ cùng một nhịp, SAU khi máy chủ trả lời — bảng luôn
  // là kết quả của lần nạp mới nhất, kể cả khi lần ấy hỏng.
  if (luot !== luotNap) return;
  boBang();
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được hiệu suất nhà cung cấp")); return; }
  const bang = docHieuSuat(r.body);
  // [lượt soi §S1.9101 CAO-1] Chủ ngữ là MÀN: *"máy chủ … không đọc"* là câu cấm của `cau-cam-tren-giao-dien`.
  if (bang === null) { bao($("loi2"), "Màn này không đọc được bảng máy chủ vừa trả — tải lại trang, rồi báo người vận hành nếu còn lặp."); return; }
  const than = $("bang-hieu-suat").querySelector("tbody");
  bao($("tom-tat"), tomTat(bang));
  for (const h of bang.nhaCungCap) {
    const tr = document.createElement("tr");
    for (const o of oCuaHang(h, bang.sanLichSu)) {
      const td = document.createElement("td");
      td.textContent = vanBanAnToan(o.noiDung);
      td.dataset.nhan = o.nhan;
      tr.append(td);
    }
    than.append(tr);
  }
}

$("nut-doc-hieu-suat").addEventListener("click", async () => {
  await napHieuSuat();
});

// [S1.177] Cuối tệp: mọi `let` của trang đã khởi tạo khi `moSauDangNhap` chạy.
thuPhienCo();

// ==============================================================================================
// [S1.9101 / S3.3e1] MÀN XÁC MINH NHÀ CUNG CẤP — spec S3 §9 (S3.3a/S3.3e), K8a
//
// Người giữ `supplier.qualify` (mặc định FINANCE) xác minh và thu hồi xác minh của nhà cung cấp. Chủ dự án chốt 2026-10-06: màn
// riêng; màn hiện mọi người liên hệ và lần xác minh gửi băm hồ sơ đã thấy (lượt soi CAO-2). Mọi luật nằm ở máy chủ và CSDL
// (`082_xac_minh_nha_cung_cap`): màn không kiểm lại luật nào. Phép tính ở `/lib/nha-cung-cap.js`. Nút luôn hiện cho người đã vào —
// một lời từ chối 403 ở đây đến từ một thao tác cố ý (ADR-118 F3), không từ nhịp đọc.
//
// Trang không chèn chuỗi nào của máy chủ vào HTML: mọi ô đi qua `textContent`.
// ==============================================================================================

import { docHoSo, dongNguoiLienHe, loiLyDoThuHoi, nhanXacMinh, nutHoSo } from "/lib/nha-cung-cap.js";
import { tenKemMst, vanBanAnToan } from "/lib/tao-thau.js";
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

// Khuôn khoản 323/326: thân 403 của `apps/api` là MỘT hằng không dấu; trang nói thay bằng việc vừa bấm.
const THAN_403 = "khong co quyen";

function loiCua(r, macDinh) {
  if (r.status === 403 && r.body?.error === THAN_403) {
    return `${macDinh}: tài khoản đang đăng nhập không có quyền làm việc này — vai hiện tại không được cấp quyền ấy. ` +
      "Đổi sang người phù hợp ở bước 1.";
  }
  if (r.body !== null && typeof r.body === "object" && typeof r.body.error === "string") return r.body.error;
  return `${macDinh} (mã ${r.status})`;
}

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: CÙNG MỘT BẢN với `/login` (`/lib/dang-nhap.js`); trang giữ `docLink`, lối hỏi lại phiên, đăng xuất và
// `hashchange` (khuôn `nhom-hang.js`).
// ---------------------------------------------------------------------------------------------

function docLink() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) { if (h !== "") $("token").value = h; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}
docLink();
// [S1.177] Đổi người trong cùng thẻ: đóng các bước về bước 1, bỏ bảng của người trước, rồi hỏi lại phiên.
window.addEventListener("hashchange", () => {
  docLink();
  phienCho = null;
  for (const id of ["loi1", "ok1", "ghi-danh", "loi2", "ok2"]) bao($(id), "");
  $("bang-ho-so").querySelector("tbody").replaceChildren();
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
  await napHoSo();
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
    $("bang-ho-so").querySelector("tbody").replaceChildren();
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
// Bước 2 — hồ sơ, xác minh, thu hồi
// ---------------------------------------------------------------------------------------------

function o(noiDung, nhan) {
  const td = document.createElement("td");
  td.textContent = noiDung;
  td.dataset.nhan = nhan;
  return td;
}

async function napHoSo() {
  bao($("loi2"), "");
  const r = await goi("GET", "/supplier-verifications");
  const than = $("bang-ho-so").querySelector("tbody");
  than.replaceChildren();
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được danh sách nhà cung cấp")); return; }
  for (const h of docHoSo(r.body)) {
    const tr = document.createElement("tr");
    const oLh = document.createElement("td");
    oLh.dataset.nhan = "Người liên hệ";
    if (h.contacts.length === 0) {
      oLh.textContent = "Chưa có người liên hệ";
    } else {
      const ul = document.createElement("ul");
      ul.className = "lh";
      for (const c of h.contacts) {
        const li = document.createElement("li");
        li.textContent = vanBanAnToan(dongNguoiLienHe(h, c));
        ul.append(li);
      }
      oLh.append(ul);
    }
    const oNut = document.createElement("td");
    const nut = nutHoSo(h);
    if (nut.xacMinh) {
      const b = document.createElement("button");
      b.className = "phu";
      b.textContent = h.loai === "VERIFIED" ? "Xác minh lại" : "Xác minh";
      b.addEventListener("click", () => xacMinh(h, b));
      oNut.append(b);
    }
    if (nut.thuHoi) {
      const b = document.createElement("button");
      b.className = "phu";
      b.textContent = "Thu hồi";
      b.addEventListener("click", () => thuHoi(h, b));
      oNut.append(b);
    }
    const trangThaiHoSo = h.status === "ACTIVE" ? "" : ` (hồ sơ ${h.status})`;
    tr.append(o(tenKemMst(h.legalName, h.taxCode) + trangThaiHoSo, "Nhà cung cấp"), o(vanBanAnToan(nhanXacMinh(h)), "Xác minh"), oLh, oNut);
    than.append(tr);
  }
}

async function xacMinh(h, nut) {
  bao($("loi2"), ""); bao($("ok2"), "");
  nut.disabled = true;
  try {
    // [lượt soi CAO-2] Băm của ĐÚNG hồ sơ đang hiện: hồ sơ đổi từ lúc đọc ⇒ máy chủ từ chối, và màn đọc lại.
    const r = await goi("POST", `/suppliers/${h.supplierId}/verify`, { bamDaXem: h.bamHoSo });
    if (r.status !== 201) {
      bao($("loi2"), loiCua(r, "Không xác minh được"));
      await napHoSo();
      return;
    }
    bao($("ok2"), `Đã xác minh ${h.legalName}${h.taxCode === null ? "" : ` (MST ${h.taxCode})`}.`);
    await napHoSo();
  } catch {
    bao($("loi2"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    nut.disabled = false;
  }
}

async function thuHoi(h, nut) {
  bao($("loi2"), ""); bao($("ok2"), "");
  const lyDo = $("ly-do-thu-hoi").value;
  const sai = loiLyDoThuHoi(lyDo);
  if (sai !== null) { bao($("loi2"), sai); return; }
  nut.disabled = true;
  try {
    const r = await goi("POST", `/suppliers/${h.supplierId}/verification/revoke`, { reason: lyDo.trim() });
    if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không thu hồi được xác minh")); return; }
    $("ly-do-thu-hoi").value = "";
    bao($("ok2"), `Đã thu hồi xác minh của ${h.legalName}. Nhà cung cấp này không còn được đếm cho cạnh tranh tối thiểu.`);
    await napHoSo();
  } catch {
    bao($("loi2"), "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    nut.disabled = false;
  }
}

$("nut-doc-ho-so").addEventListener("click", async () => {
  bao($("ok2"), "");
  await napHoSo();
});

// [S1.177] Cuối tệp: mọi `let` của trang đã khởi tạo khi `moSauDangNhap` chạy.
thuPhienCo();

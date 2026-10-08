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

import {
  BAC_MAC_DINH,
  BAFO_TOP_N_MAC_DINH,
  BENCHMARK_MAC_DINH,
  MUC_MAC_DINH,
  NGUONG_KEP_MAC_DINH,
  TRONG_SO_MAC_DINH,
  canhBaoBenchmark,
  canhBaoChinhSach,
  canhBaoGoiThieuSoNgayGiao,
  canhBaoTrongSo,
  moTaTco,
  moTaTrongSo,
  soNguoiToiThieu,
  thanhPhanTuMa,
} from "/lib/chinh-sach.js";
import { nhomSo, tien } from "/lib/so-tien.js";
import { ganDangNhap } from "/lib/dang-nhap.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

// [S1.240 / khoản 282] ~~`let phien = { token: "", daRedeem: false };`~~ — mã đăng nhập và "đã đổi ở máy chủ chưa" nay sống trong
// `/lib/dang-nhap.js`.
let trangThai = { phienBan: [], daBat: false, choKy: false, goiThieuSoNgay: 0 };
let bac = [];
// [S1.258 / khoản 329] Thành phần trọng số sẽ gửi khi ô "Khai trọng số" được chọn — không có ô sửa: mẫu, hoặc nguyên văn của
// phiên bản vừa chép (kể cả khi nó ngoài vế hẹp — màn hiện và cảnh báo, không tự đổi).
// [S1.9101 / S4.7b1] ~~không có ô sửa~~ Bốn ô mã TCO (`O_MA_TCO`): bấm một ô thì trọng số thành tập chuẩn của các ô đang chọn
// (`thanhPhanTuMa` — giá luôn có, hệ số 1, thứ tự chính sách); chưa bấm thì bản chép đi nguyên văn, như trước.
let trongSo = TRONG_SO_MAC_DINH;

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

function o(noiDung, lop) {
  const td = document.createElement("td");
  td.textContent = noiDung;
  if (lop !== undefined) td.className = lop;
  return td;
}

const soTien = (n) => nhomSo(Number(n).toFixed(0));

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: magic link + TOTP, cùng khuôn `tao-thau.js` (gọi `/auth/redeem` ĐÚNG một lần cho mỗi mã).
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
docLink();
// [S1.177] Đổi người trong cùng thẻ: đóng các bước về bước 1 — trước đây chúng ĐỂ NGUYÊN, dưới cookie của
// người trước — rồi hỏi lại phiên (khuôn `mo-thau.js`).
window.addEventListener("hashchange", () => {
  docLink();
  phienCho = null;
  for (const id of ["loi1", "ok1", "ghi-danh", "loi2", "ok2", "loi3", "ok3"]) bao($(id), "");
  dongCacBuoc();
  dangNhap.datLai();
  thuPhienCo();
});

// [S1.240 / khoản 282] ~~Trình nghe `nut-vao` chép của `/login` cũ: `/auth/redeem` rồi `/auth/totp` trong một lượt, bí mật TOTP hiện
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
  // [S1.240 / khoản 282] Khối link đăng nhập gần đây (khoản 195, 268) — trước lời gọi riêng của màn, không chờ.
  void dangNhap.veLinkGanDay();
  await napPhienBan();
  if (bac.length === 0) dienMau();
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

// [S1.177] Cùng khuôn `mo-thau.js`: 401 là phiên đã hết hay đã bị thu hồi — trang cũng về bước 1.
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
// Bước 2 — các phiên bản và lần ký
// ---------------------------------------------------------------------------------------------

async function napPhienBan() {
  bao($("loi2"), "");
  const r = await goi("GET", "/policy/versions");
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được các phiên bản chính sách")); return; }
  trangThai = {
    phienBan: r.body?.phienBan ?? [],
    daBat: r.body?.daBat === true,
    choKy: r.body?.choKy === true,
    // [S1.9101 / S4.7b1] Gói chờ duyệt chưa khai số ngày giao — cảnh báo khi phiên bản đang soạn bật chi phí trễ (ADR-153 ⑴).
    goiThieuSoNgay: typeof r.body?.goiChoDuyetThieuSoNgayGiao === "number" ? r.body.goiChoDuyetThieuSoNgayGiao : 0,
  };
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
      o(moTaTrongSo(p.evalComponents ?? null, p.bafoTopN ?? null)),
      o(moTaTco(p.tco ?? null)),
      o(moTaBenchmark(p.benchmark)),
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

/** [S1.256 / S4.5b] Một dòng cho nhóm khoá `benchmark` của một phiên bản. */
function moTaBenchmark(b) {
  if (b === null || b === undefined) return "chưa cấu hình";
  return `${b.cua_so_thang} tháng · sàn ${b.san_goi} gói/${b.san_ncc} NCC · lệch ${b.nguong_lech_vua}/${b.nguong_lech_cao}`;
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

// [S1.256 / S4.5b] Năm ô của nhóm khoá `benchmark`; `phuong_phap` không có ô — một phương pháp duy nhất (`103`).
const O_BENCHMARK = [
  ["bm-cua-so", "cua_so_thang"],
  ["bm-san-goi", "san_goi"],
  ["bm-san-ncc", "san_ncc"],
  ["bm-vua", "nguong_lech_vua"],
  ["bm-cao", "nguong_lech_cao"],
];

function datBenchmark(b) {
  $("co-benchmark").checked = b !== null && b !== undefined;
  hien($("khoi-benchmark"), $("co-benchmark").checked);
  for (const [id, khoa] of O_BENCHMARK) $(id).value = b === null || b === undefined ? "" : (b[khoa] ?? "");
}

/** Nhóm khoá gửi lên: `null` khi bỏ chọn; giá trị là CHUỖI đúng như người gõ (cắt khoảng trắng) — CSDL phán. */
function benchmarkGuiLen() {
  if (!$("co-benchmark").checked) return null;
  const ra = { phuong_phap: BENCHMARK_MAC_DINH.phuong_phap };
  for (const [id, khoa] of O_BENCHMARK) ra[khoa] = $(id).value.trim();
  return ra;
}

// [S1.9101 / S4.7b1] Bốn ô mã TCO — `gia` không có ô: luôn tính.
const O_MA_TCO = [
  ["ma-van-chuyen", "van_chuyen"],
  ["ma-nhap-khau", "nhap_khau"],
  ["ma-chi-phi-thanh-toan", "chi_phi_thanh_toan"],
  ["ma-chi-phi-tre", "chi_phi_tre"],
];
// Ba ô tham số của nhóm khoá `tco`, mỗi ô thuộc đúng một mã quy đổi.
const O_THAM_SO_TCO = [
  ["tco-von", "chi_phi_von_nam", "chi_phi_thanh_toan"],
  ["tco-ky", "ngay_thanh_toan_chuan", "chi_phi_thanh_toan"],
  ["tco-tre", "ty_le_tre_ngay", "chi_phi_tre"],
];
const coMa = (ma) => trongSo.some((t) => t.ma === ma);

/** [S1.258 / khoản 329] Đặt khối trọng số: `thanhPhan` `null` ⇒ bỏ chọn (ô top-N trống); ngược lại hiện thành phần chỉ-đọc. */
function datTrongSo(thanhPhan, topN) {
  const co = thanhPhan !== null && thanhPhan !== undefined;
  trongSo = co ? thanhPhan.map((t) => ({ ...t })) : TRONG_SO_MAC_DINH;
  $("co-trong-so").checked = co;
  $("bafo-top-n").value = co && topN !== null && topN !== undefined ? String(topN) : "";
  veTrongSo();
}

/** [S1.9101 / S4.7b1] Ba ô tham số: giá trị của phiên bản (chép) hay rỗng (mẫu) — không mặc định nào: tổ chức tự khai (spec §4.8). */
function datTco(tco) {
  for (const [id, khoa] of O_THAM_SO_TCO) $(id).value = tco === null || tco === undefined ? "" : (tco[khoa] ?? "");
}

function veTrongSo() {
  const co = $("co-trong-so").checked;
  hien($("khoi-trong-so"), co);
  for (const [id, ma] of O_MA_TCO) $(id).checked = coMa(ma);
  hien($("khoi-tco-thanh-toan"), coMa("chi_phi_thanh_toan"));
  hien($("khoi-tco-tre"), coMa("chi_phi_tre"));
  dienDl($("tt-trong-so"), trongSo.map((t) => [`Thành phần ${t.ma}`, `đơn vị ${t.don_vi}, hệ số ${t.he_so}`]));
}

/**
 * [S1.9101 / S4.7b1] Nhóm khoá `tco` gửi lên: chỉ khoá của mã ĐANG BẬT, giá trị là chuỗi như người gõ (cắt khoảng trắng) — `CHECK`
 * của `112` phán miền và cặp hai khoá thanh toán. Không khoá nào ⇒ `null` (`CHECK` từ chối object rỗng).
 */
function tcoGuiLen() {
  if (!$("co-trong-so").checked) return null;
  const ra = {};
  for (const [id, khoa, ma] of O_THAM_SO_TCO) {
    const v = $(id).value.trim();
    if (coMa(ma) && v !== "") ra[khoa] = v;
  }
  return Object.keys(ra).length === 0 ? null : ra;
}

/** Cặp gửi lên: cả hai `null` khi bỏ chọn (`056` đòi chúng đi cùng nhau); top-N là số như người gõ — máy chủ phán. */
function trongSoGuiLen() {
  if (!$("co-trong-so").checked) return { evalComponents: null, bafoTopN: null };
  const v = $("bafo-top-n").value.trim();
  return { evalComponents: trongSo.map((t) => ({ ...t })), bafoTopN: v === "" ? null : Number(v) };
}

function dienMau() {
  bac = BAC_MAC_DINH.map((b) => ({ ...b, award_vai: b.award_vai === undefined ? undefined : [...b.award_vai] }));
  $("nguong").value = NGUONG_KEP_MAC_DINH;
  $("chia-nho").value = String(MUC_MAC_DINH.chiaNhoCuaSoNgay);
  $("tham-dinh").value = String(MUC_MAC_DINH.thamDinhHieuLucThang);
  datTrongSo(TRONG_SO_MAC_DINH, BAFO_TOP_N_MAC_DINH);
  datTco(null);
  datBenchmark(BENCHMARK_MAC_DINH);
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
  datTrongSo(p.evalComponents ?? null, p.bafoTopN ?? null);
  datTco(p.tco ?? null);
  datBenchmark(p.benchmark);
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
  const tp = trongSoGuiLen().evalComponents;
  const cb = [
    ...canhBaoChinhSach(bac),
    ...canhBaoTrongSo(tp, tcoGuiLen()),
    ...canhBaoGoiThieuSoNgayGiao(tp, trangThai.goiThieuSoNgay, trangThai.daBat),
    ...canhBaoBenchmark(benchmarkGuiLen()),
  ];
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
// Chọn lại ô khi top-N đang trống thì ô nhận mẫu — hiện ra trong ô, người khai sửa được; không mặc định ngầm nào lúc gửi.
$("co-trong-so").addEventListener("change", () => {
  if ($("co-trong-so").checked && $("bafo-top-n").value.trim() === "") $("bafo-top-n").value = String(BAFO_TOP_N_MAC_DINH);
  veTrongSo();
  tinhLai();
});
// [S1.9101 / S4.7b1] Bấm một ô mã ⇒ trọng số thành tập chuẩn của các ô đang chọn.
for (const [id] of O_MA_TCO) {
  $(id).addEventListener("change", () => {
    trongSo = thanhPhanTuMa(O_MA_TCO.filter(([i]) => $(i).checked).map(([, ma]) => ma));
    veTrongSo();
    tinhLai();
  });
}
for (const [id] of O_THAM_SO_TCO) $(id).addEventListener("input", () => tinhLai());
$("co-benchmark").addEventListener("change", () => { hien($("khoi-benchmark"), $("co-benchmark").checked); tinhLai(); });
for (const [id] of O_BENCHMARK) $(id).addEventListener("input", () => tinhLai());

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
    ...trongSoGuiLen(),
    // [S1.9101 / S4.7b1] Nhóm khoá `tco` — `null` khi không mã quy đổi nào bật hay không ô nào điền.
    tco: tcoGuiLen(),
    benchmark: benchmarkGuiLen(),
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

// [S1.177] Cuối tệp: mọi `let` của trang đã khởi tạo khi `moSauDangNhap` chạy.
thuPhienCo();

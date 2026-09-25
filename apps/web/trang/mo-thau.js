// ==============================================================================================
// MÀN NGƯỜI MUA — đăng nhập, đóng thầu, mở thầu hai người duyệt, đọc bảng so sánh.
//
// Tệp này KHÔNG import một mảnh mật mã nào, và đó là điều đáng nói nhất về nó: người mua không
// có khoá, không giải mã được gì trên máy mình. Việc giải mã nằm ở `apps/unseal-worker`, sau một
// cổng chính sách và sau đủ chữ ký phê duyệt. Màn này chỉ ra lệnh và đọc kết quả.
//
// Trước khi mở thầu, thứ duy nhất nó xin được từ máy chủ về giá là MỘT CON SỐ ĐẾM — và ngay cả
// con số ấy cũng có thể bị chính sách giấu (chế độ mù nghiêm). Không có một đường nào ở đây lấy
// được một mức giá trước khi mở thầu, kể cả khi người dùng là quản trị viên.
// ==============================================================================================

import { tien } from "/lib/so-tien.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

let phien = { orgId: "", token: "", rfqId: "", unsealRequestId: "", daRedeem: false };

/** [S1.90 / khoản 190] Câu này phải chỉ ra LỐI ĐI, vì lối đi ấy vừa mới tồn tại. */
const CHUA_CO_YEU_CAU =
  "Chưa nạp được yêu cầu mở thầu nào. Dán mã gói thầu ở bước 2 rồi bấm Đọc — trang sẽ tự lấy " +
  "yêu cầu đang treo của gói ấy, kể cả khi người khác tạo nó ở máy khác.";

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

// [S1.99 / khoản 206] `tien` từng có một bản cài THỨ HAI ngay đây, chép tay từ `nop-thau.js`.
// Hai bản cài của cùng một quy ước hiển thị là hai chỗ để chúng lệch nhau, và trang nộp thầu đã
// chứng minh quy ước ấy đáng được đo.

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: magic link + TOTP
// ---------------------------------------------------------------------------------------------

function docLink() {
  // Link gieo ra mang `#<mã tổ chức>:<mã đăng nhập>` — đường xác thực là đường VÔ DANH, nên máy
  // chủ không biết người gọi thuộc tổ chức nào cho tới khi client nói ra. Bản đầu của trang này
  // chỉ đọc token và lượt chạy thử đầu tiên trả về đúng câu `thiếu trường "orgId"`.
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i <= 0) { if (h !== "") $("token").value = h; return; }
  $("org").value = h.slice(0, i);
  $("token").value = h.slice(i + 1);
}

$("nut-vao").addEventListener("click", async () => {
  bao($("loi1"), ""); bao($("ghi-danh"), "");
  const orgId = $("org").value.trim();
  const token = $("token").value.trim();
  const code = $("ma").value.trim();
  // Đổi sang người thứ hai = dán một mã đăng nhập khác: phải redeem lại cho token mới.
  if (token !== phien.token) phien = { ...phien, token, daRedeem: false };
  if (orgId === "" || token === "") { bao($("loi1"), "Cần cả mã tổ chức và mã đăng nhập."); return; }
  $("nut-vao").disabled = true;
  try {
    // GỌI `/auth/redeem` ĐÚNG MỘT LẦN cho mỗi mã đăng nhập, và đó là một phép sửa do lượt chạy
    // thử đầu tiên ép ra: mỗi lần gọi lại, máy chủ sinh một bí mật TOTP MỚI cho tài khoản chưa
    // ghi danh. Bản đầu của trang này gọi lại ở mỗi lần bấm, nên người dùng vừa gõ bí mật A vào
    // ứng dụng xác thực xong, bấm Vào, thì máy chủ đã đổi sang bí mật B — mã sáu số của họ không
    // bao giờ đúng, và không có gì trên màn hình giải thích vì sao.
    if (!phien.daRedeem) {
      const r1 = await goi("POST", "/auth/redeem", { orgId, token });
      if (r1.status !== 200) { bao($("loi1"), loiCua(r1, "Mã đăng nhập không dùng được")); return; }
      phien = { ...phien, daRedeem: true };
      if (r1.body?.needsEnrollment === true) {
        // Lần đầu của một người mua: máy chủ trả bí mật TOTP đúng một lần. Hiện nguyên văn thay
        // vì giấu sau một mã QR — người đang demo cần gõ nó vào ứng dụng xác thực ngay tại chỗ.
        bao($("ghi-danh"), `Tài khoản này chưa có MFA. Bí mật TOTP (nhập vào ứng dụng xác thực, rồi nhập mã sáu số và bấm Vào lần nữa): ${r1.body.totpSecretBase32}`);
        return;
      }
    }
    if (!/^\d{6}$/.test(code)) { bao($("loi1"), "Nhập mã sáu số của ứng dụng xác thực."); return; }
    const r2 = await goi("POST", "/auth/totp", { orgId, token, code });
    if (r2.status !== 200) {
      const ly = r2.body?.reason === "LOCKED_OUT" ? "Tài khoản đang bị khoá tạm thời" : "Mã sáu số không đúng";
      bao($("loi1"), ly);
      return;
    }
    phien = { ...phien, orgId, token };
    // `/me` trả `{userId, sessionId, orgId, kind}` — CỐ Ý không trả email hay tên: một route
    // "tôi là ai" trả về dữ liệu cá nhân là một route mà mọi lỗ IDOR đều muốn có. Bản đầu của
    // trang này đoán sai hình dạng ấy và in "(không đọc được)" suốt cả lượt chạy thử.
    const me = await goi("GET", "/me");
    const u = me.body?.userId;
    bao($("ok1"), u === undefined
      ? "Đã vào. Phiên nằm trong cookie HttpOnly."
      : `Đã vào với người dùng ${String(u).slice(0, 8)}… (vai: ${me.body?.kind ?? "?"}). Phiên nằm trong cookie HttpOnly, JavaScript không đọc được nó.`);
    $("b1").classList.add("xong");
    hien($("b2"), true);
    hien($("b3"), true);
    hien($("b4"), true);
    hien($("b5"), true);
    hien($("b6"), true);
    hien($("b7"), true);
    hien($("b8"), true);
  } finally {
    $("nut-vao").disabled = false;
  }
});

// ---------------------------------------------------------------------------------------------
// Bước 2 — gói thầu: trạng thái và SỐ ĐẾM, không có giá
// ---------------------------------------------------------------------------------------------

$("nut-doc").addEventListener("click", async () => {
  bao($("loi2"), "");
  const id = $("rfq").value.trim();
  if (id === "") { bao($("loi2"), "Cần mã gói thầu."); return; }
  phien = { ...phien, rfqId: id };
  const r = await goi("GET", `/rfqs/${id}`);
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được gói thầu")); return; }
  const rfq = r.body.rfq;
  dienDl($("tt-rfq"), [
    ["Tên", rfq.title],
    ["Trạng thái", rfq.status],
    ["Hạn nộp", new Date(rfq.deadlineAt).toLocaleString("vi-VN")],
    ["Cần hai người duyệt", rfq.requiresDualApproval === true ? "có" : "không"],
  ]);
  const d = await goi("GET", `/rfqs/${id}/bid-count`);
  if (d.status === 200) {
    const c = d.body.bidCount ?? d.body;
    bao($("dem"), c?.disclosed === false
      ? `Số báo giá đang bị giấu (${c.reason}) — chính sách mù nghiêm còn hiệu lực tới khi đóng thầu.`
      : `Đã nhận ${c?.count ?? "?"} báo giá. Không một mức giá nào đọc được ở đây.`);
  }
  // [S1.90 / khoản 190] Bấm Đọc là lúc người duyệt thứ hai lấy được yêu cầu đang treo.
  await napYeuCau(id);
});

// ---------------------------------------------------------------------------------------------
// Bước 3 — đóng thầu, yêu cầu mở, phê duyệt, điều phối
// ---------------------------------------------------------------------------------------------

function veYeuCau(yc) {
  // [S1.90 / khoản 190] `null` là một câu trả lời ĐÚNG, không phải một lỗi: "gói thầu này chưa
  // ai xin mở" khác hẳn "không có gói thầu ấy", và người duyệt thứ hai cần đọc ra sự khác nhau.
  if (yc === null || yc === undefined) {
    phien = { ...phien, unsealRequestId: "" };
    dienDl($("tt-yc"), [["Yêu cầu mở thầu", "chưa có — người soạn phải tạo trước"]]);
    return;
  }
  phien = { ...phien, unsealRequestId: yc.id };
  // [S1.90 / khoản 192] "1 / 2" chứ không phải "1": trong màn này toàn bộ ý nghĩa nằm ở chỗ ĐÃ
  // ĐỦ CHƯA, và một con số không có mẫu số thì không trả lời được câu ấy. Ngưỡng lấy từ máy chủ,
  // nơi nó gọi đúng hàm mà cổng chính sách gọi — trang không được tự suy ra "hai".
  const can = yc.requiredApprovals;
  const dem = yc.approvalCount;
  dienDl($("tt-yc"), [
    ["Mã yêu cầu", yc.id],
    ["Trạng thái", yc.status],
    ["Số phê duyệt", dem === undefined ? "—" : can === undefined ? String(dem) : `${dem} / ${can}`],
    ["Break-glass", yc.breakGlass === true ? "CÓ" : "không"],
  ]);
}

/**
 * [S1.90 / khoản 190] ĐỌC LẠI yêu cầu đang mở TỪ MÁY CHỦ, thay vì tin bộ nhớ của tab.
 *
 * Trước vòng này mã yêu cầu chỉ tồn tại trong biến `phien` của tab ĐÃ TẠO ra nó, nên người duyệt
 * thứ hai — ngồi máy khác, theo đúng đòi hỏi D2 — không có đường nào lấy được. Hàm này là cả
 * phép sửa: mỗi lần đọc gói thầu, và sau mỗi lần ghi, trang hỏi lại máy chủ.
 */
async function napYeuCau(rfqId) {
  if (rfqId === "") return null;
  const r = await goi("GET", `/rfqs/${rfqId}/unseal`);
  if (r.status !== 200) return r;
  veYeuCau(r.body.unsealRequest ?? null);
  return r;
}

/**
 * [S1.90 / khoản 191] MỘT CÚ BẤM BỊ CHẶN PHẢI NÓI NÓ BỊ CHẶN VÌ SAO — ở TRANG, không ở API.
 *
 * Thân 403 của `apps/api` là một hằng (`{"error":"khong co quyen"}`) và nó phải ở nguyên như thế:
 * nói rõ THIẾU QUYỀN NÀO là dựng sẵn bản đồ mô hình quyền cho người dò. Nhưng trang thì BIẾT
 * người dùng vừa bấm gì, nên nó nói được điều API không nên nói mà không tiết lộ gì thêm.
 */
function loiTuChoiDuyet(r) {
  if (r.status === 403) {
    return "Tài khoản đang đăng nhập không phê duyệt mở thầu được. Hai vế dẫn tới cùng câu trả " +
      "lời này: vai hiện tại không được cấp quyền phê duyệt, hoặc chính tài khoản này đã TẠO ra " +
      "yêu cầu — người yêu cầu không tự duyệt cho mình. Đổi sang người thứ hai ở bước 1.";
  }
  return loiCua(r, "Không phê duyệt được");
}

$("nut-dong").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  const r = await goi("POST", `/rfqs/${phien.rfqId}/close`, { reason: $("ly-do").value.trim() });
  if (r.status !== 200) { bao($("loi3"), loiCua(r, "Không đóng được")); return; }
  bao($("ok3"), "Đã đóng thầu. Từ giờ không nhận thêm báo giá nào.");
});

$("nut-yeu-cau").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  const r = await goi("POST", `/rfqs/${phien.rfqId}/unseal`, { reason: $("ly-do").value.trim() });
  if (r.status !== 201) { bao($("loi3"), loiCua(r, "Không tạo được yêu cầu mở")); return; }
  veYeuCau(r.body.unsealRequest);
  await napYeuCau(phien.rfqId);
  bao($("ok3"), "Đã tạo yêu cầu. Người tạo KHÔNG tự phê duyệt thay cho người thứ hai được.");
});

$("nut-duyet").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  if (phien.unsealRequestId === "") { bao($("loi3"), CHUA_CO_YEU_CAU); return; }
  const r = await goi("POST", `/unseal/${phien.unsealRequestId}/approve`);
  if (r.status !== 200) { bao($("loi3"), loiTuChoiDuyet(r)); return; }
  veYeuCau(r.body.unsealRequest);
  await napYeuCau(phien.rfqId);
  bao($("ok3"), "Đã ghi một chữ ký phê duyệt. Thiếu người thứ hai thì điều phối sẽ bị từ chối.");
});

$("nut-dieu-phoi").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  if (phien.unsealRequestId === "") { bao($("loi3"), CHUA_CO_YEU_CAU); return; }
  const r = await goi("POST", `/unseal/${phien.unsealRequestId}/dispatch`);
  if (r.status !== 200) { bao($("loi3"), loiCua(r, "Cổng chính sách từ chối")); return; }
  bao($("ok3"), "Đã xếp việc cho tiến trình mở thầu. Tiến trình `api` không có khoá để tự giải mã.");
});

// ---------------------------------------------------------------------------------------------
// Bước 4 — bảng so sánh
// ---------------------------------------------------------------------------------------------

$("nut-bang").addEventListener("click", async () => {
  bao($("loi4"), "");
  const r = await goi("GET", `/rfqs/${phien.rfqId}/comparison`);
  if (r.status !== 200) { bao($("loi4"), loiCua(r, "Chưa đọc được bảng so sánh")); return; }
  const c = r.body.comparison;
  const tbody = $("bang").querySelector("tbody");
  tbody.replaceChildren();
  const reNhoNhat = c.aggregates?.min ?? null;
  for (const h of c.rows ?? []) {
    const tr = document.createElement("tr");
    if (reNhoNhat !== null && h.totalAmount === reNhoNhat) tr.className = "thap";
    const td = (chu, lop) => { const x = document.createElement("td"); x.textContent = chu; if (lop) x.className = lop; return x; };
    // [S1.109] Sau một vòng BAFO, bảng này CỐ Ý có hai dòng cho một nhà cung cấp — nó là một
    // bảng LỊCH SỬ, và người mua cần thấy ai hạ bao nhiêu. Không có cột vòng, hai dòng ấy trông
    // như một lỗi; `isLatestForBid` là thứ nói dòng nào đang có hiệu lực.
    if (h.isLatestForBid === false) tr.classList.add("mo");
    tr.append(
      td(h.supplierLegalName), td(tien(h.totalAmount), "so"), td(h.currency ?? "—"),
      td(String(h.version ?? "—"), "so"),
      td(h.bafoRoundNo === null || h.bafoRoundNo === undefined ? "vòng 1" : `BAFO ${h.bafoRoundNo}`),
    );
    tbody.append(tr);
  }
  const a = c.aggregates ?? {};
  dienDl($("tt-tong"), [
    ["Số báo giá đọc được", a.parsed],
    ["Không đọc được", a.unparsed],
    ["Thấp nhất", tien(a.min)],
    ["Cao nhất", tien(a.max)],
    ["Trung bình", tien(a.average)],
    ["Lệch tiền tệ", a.currencyMismatch === true ? "CÓ — không so sánh thẳng được" : "không"],
  ]);
});

// ---------------------------------------------------------------------------------------------
// Bước 5 — chấm thầu và bảng xếp hạng
//
// Thành phần MỞ SẴN, không sau một cú bấm: spec §8 nói *"bảng xếp hạng luôn hiện thành phần, để
// người đọc thấy con số nào đến từ đâu"*, và đó không phải một yêu cầu trang trí. J2 nói mỗi hàng
// xếp hạng tái lập được; một màn hình chỉ hiện `effective_cost` biến J2 thành một lời hứa mà
// người mua không kiểm được — nên cột `components` đi RA TỚI đây chứ không dừng ở CSDL.
// ---------------------------------------------------------------------------------------------

/**
 * Một hàng thành phần thành chữ. Số để NGUYÊN VĂN, không qua `tien()`: đây là dấu vết kiểm toán,
 * và `1.0000` làm tròn thành `1` là đánh mất đúng thứ người đọc tới đây để xem.
 *
 * `he_so`/`gia_tri` vắng thì hiện một gạch ngang — `057` chỉ đòi `ma` và `tien`, nên một hàng có
 * thể thật sự không mang chúng, và bịa ra `1.0000` là bịa ra chính thứ J2 phải kiểm được.
 */
function veThanhPhan(tp) {
  const ul = document.createElement("ul");
  ul.className = "tp";
  for (const t of tp) {
    const li = document.createElement("li");
    // `textContent`, không `innerHTML`: `ma` đến từ chính sách của tổ chức, tức từ người dùng.
    li.textContent = `${t.ma} · ${t.giaTri ?? "—"} × ${t.heSo ?? "—"} = ${t.tien ?? "—"} (${t.donVi})`;
    ul.append(li);
  }
  if (tp.length === 0) {
    const li = document.createElement("li");
    li.textContent = "không thành phần nào — báo giá này không đọc được số tiền";
    ul.append(li);
  }
  return ul;
}

async function veXepHang() {
  bao($("loi5"), "");
  const r = await goi("GET", `/rfqs/${phien.rfqId}/ranking`);
  if (r.status !== 200) { bao($("loi5"), loiCua(r, "Chưa đọc được bảng xếp hạng")); return; }
  const tbody = $("bang-hang").querySelector("tbody");
  tbody.replaceChildren();
  const b = r.body.ranking ?? null;
  // `null` là câu trả lời ĐÚNG cho "chưa chấm lần nào", cùng khuôn `veYeuCau` ở bước 3. Một bảng
  // rỗng thì nói dối: "đã chấm, và không ai trong bảng" khác hẳn "chưa chấm".
  if (b === null) {
    dienDl($("tt-luot"), [["Lượt chấm", "chưa chấm lần nào — bấm Chấm thầu"]]);
    return;
  }
  dienDl($("tt-luot"), [
    ["Mã lượt chấm", b.evaluationId],
    ["Chính sách phiên bản", b.policyVersion],
    ["Tiền tệ", b.currency],
    ["Chấm lúc", new Date(b.evaluatedAt).toLocaleString("vi-VN")],
  ]);
  for (const h of b.rows ?? []) {
    const tr = document.createElement("tr");
    if (h.rank === 1) tr.className = "thap";
    const td = (chu, lop) => { const x = document.createElement("td"); x.textContent = chu; if (lop) x.className = lop; return x; };
    tr.append(
      td(h.rank === null ? "—" : String(h.rank), "so"),
      td(h.supplierName),
      td(h.effectiveCost === null ? "—" : tien(h.effectiveCost), "so"),
    );
    const o = document.createElement("td");
    o.append(veThanhPhan(h.components ?? []));
    tr.append(o);
    tbody.append(tr);
  }
}

$("nut-cham").addEventListener("click", async () => {
  bao($("loi5"), ""); bao($("ok5"), "");
  const r = await goi("POST", `/rfqs/${phien.rfqId}/evaluate`);
  // Năm lối từ chối của cổng chấm đi ra dưới 422 kèm câu người đọc được (`DanhGiaTuChoiError`),
  // nên `loiCua` đã đủ: câu ấy gọi tên được phiên bản chính sách, và trang không cần đoán lại.
  if (r.status !== 201) { bao($("loi5"), loiCua(r, "Không chấm được")); return; }
  bao($("ok5"), `Đã chấm theo chính sách phiên bản ${r.body.evaluation?.policyVersion ?? "?"}. Gói thầu sang EVALUATING.`);
  await veXepHang();
});

$("nut-xep-hang").addEventListener("click", veXepHang);

// ---------------------------------------------------------------------------------------------
// Bước 6 — vòng BAFO
//
// `null` là câu trả lời ĐÚNG cho "chưa mở vòng nào", cùng khuôn `veYeuCau` và `veXepHang`.
// ---------------------------------------------------------------------------------------------

async function veVongBafo() {
  const r = await goi("GET", `/rfqs/${phien.rfqId}/bafo`);
  if (r.status !== 200) { bao($("loi6"), loiCua(r, "Chưa đọc được vòng BAFO")); return; }
  const v = r.body.bafoRound ?? null;
  if (v === null) {
    dienDl($("tt-bafo"), [["Vòng BAFO", "chưa mở vòng nào"]]);
    return;
  }
  dienDl($("tt-bafo"), [
    ["Vòng số", v.roundNo],
    ["Mời top-N", v.topN],
    ["Hạn nộp", new Date(v.deadlineAt).toLocaleString("vi-VN")],
    ["Mở lúc", new Date(v.openedAt).toLocaleString("vi-VN")],
    ["Đóng lúc", v.closedAt === null ? "đang mở" : new Date(v.closedAt).toLocaleString("vi-VN")],
  ]);
}

$("nut-mo-bafo").addEventListener("click", async () => {
  bao($("loi6"), ""); bao($("ok6"), "");
  const gio = $("han-bafo").value;
  if (gio === "") { bao($("loi6"), "Chọn hạn nộp của vòng BAFO trước."); return; }
  // `datetime-local` cho một chuỗi KHÔNG có múi giờ; `new Date(...)` đọc nó theo giờ máy, đúng
  // thứ người bấm vừa gõ. `toISOString()` rồi mới gửi — route đọc ISO 8601.
  const r = await goi("POST", `/rfqs/${phien.rfqId}/bafo`, { deadlineAt: new Date(gio).toISOString() });
  // Bốn lối từ chối có tên của lớp vòng BAFO đi ra dưới 422 kèm câu người đọc được.
  if (r.status !== 201) { bao($("loi6"), loiCua(r, "Không mở được vòng BAFO")); return; }
  bao($("ok6"), `Đã mở vòng BAFO số ${r.body.bafoRound?.roundNo ?? "?"} — mời top-${r.body.bafoRound?.topN ?? "?"}. Gói thầu sang BAFO_OPEN.`);
  await veVongBafo();
});

$("nut-dong-bafo").addEventListener("click", async () => {
  bao($("loi6"), ""); bao($("ok6"), "");
  const r = await goi("POST", `/rfqs/${phien.rfqId}/bafo/close`);
  if (r.status !== 200) { bao($("loi6"), loiCua(r, "Không đóng được vòng BAFO")); return; }
  bao($("ok6"), "Đã đóng vòng BAFO. Gói thầu sang BAFO_CLOSED — mở phong bì vòng hai bằng cổng bốn vế ở bước 3.");
  await veVongBafo();
});

// ---------------------------------------------------------------------------------------------
// Bước 7 — trao thầu
//
// `null` là câu trả lời ĐÚNG cho "chưa có đề xuất nào", cùng khuôn `veYeuCau` / `veXepHang` /
// `veVongBafo`. Trang KHÔNG tự đếm chữ ký: số chữ ký cần sống ở CSDL (`CHU_KY_CAN`), nên nếu
// ngày nào con số ấy thành hai thì trang này không phải đổi một dòng — nó chỉ hiện thứ đọc được.
// ---------------------------------------------------------------------------------------------

async function veTraoThau() {
  const r = await goi("GET", `/rfqs/${phien.rfqId}/award`);
  if (r.status !== 200) { bao($("loi7"), loiCua(r, "Chưa đọc được đề xuất trao thầu")); return; }
  const a = r.body.award ?? null;
  if (a === null) {
    dienDl($("tt-award"), [["Trao thầu", "chưa có đề xuất nào"]]);
    return;
  }
  dienDl($("tt-award"), [
    ["Trạng thái", a.status],
    ["Báo giá được chọn", a.bidVersionId],
    ["Dựa trên lượt chấm", a.evaluationId],
    ["Lý do", a.reason],
    ["Lúc", new Date(a.actedAt).toLocaleString("vi-VN")],
    ["Chữ ký duyệt", a.approvals.length === 0
      ? "chưa có"
      : a.approvals.map((c) => new Date(c.approvedAt).toLocaleString("vi-VN")).join(" · ")],
  ]);
}

$("nut-de-xuat").addEventListener("click", async () => {
  bao($("loi7"), ""); bao($("ok7"), "");
  const bv = $("bao-gia-thang").value.trim();
  const lyDo = $("ly-do-award").value.trim();
  if (bv === "" || lyDo === "") { bao($("loi7"), "Cần cả id báo giá và lý do."); return; }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/award`, { bidVersionId: bv, reason: lyDo });
  // Bốn lối từ chối có tên của lớp trao thầu đi ra dưới 422 với câu của lớp gói; ba trigger của
  // `061` CŨNG ra 422, mang câu của CSDL — `anhXaLoiPostgres` lộ thông điệp khi lỗi đến từ một
  // `RAISE` của trigger, vì câu ấy do migration viết. Nên `loiCua` đủ cho cả hai đường.
  if (r.status !== 201) { bao($("loi7"), loiCua(r, "Không đề xuất được")); return; }
  bao($("ok7"), "Đã ghi đề xuất trao thầu. Gói thầu sang AWARDED — nay cần MỘT người KHÁC phê duyệt.");
  await veTraoThau();
});

$("nut-duyet-award").addEventListener("click", async () => {
  bao($("loi7"), ""); bao($("ok7"), "");
  // Người duyệt ký lên ĐÚNG đề xuất họ vừa đọc, nên `awardId` đi trong đường dẫn: giữa lúc đọc
  // và lúc bấm, đề xuất kia huỷ được và một đề xuất KHÁC dựng lên, và một lời gọi chỉ theo
  // `rfqId` sẽ ký lên đề xuất mới trong im lặng.
  const doc = await goi("GET", `/rfqs/${phien.rfqId}/award`);
  const a = doc.status === 200 ? (doc.body.award ?? null) : null;
  if (a === null) { bao($("loi7"), "Chưa có đề xuất nào để duyệt."); return; }
  if (a.status !== "PROPOSED") { bao($("loi7"), `Đề xuất đang ở ${a.status}, không duyệt được.`); return; }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/award/${a.awardId}/approve`);
  if (r.status !== 201) { bao($("loi7"), loiCua(r, "Không duyệt được")); return; }
  bao($("ok7"), "Đã phê duyệt trao thầu. Gói thầu ĐỨNG YÊN ở AWARDED — nó đã ở đó từ lúc có đề xuất.");
  await veTraoThau();
});

$("nut-huy-award").addEventListener("click", async () => {
  bao($("loi7"), ""); bao($("ok7"), "");
  const lyDo = $("ly-do-award").value.trim();
  if (lyDo === "") { bao($("loi7"), "Lý do là BẮT BUỘC ở cả lần huỷ — một lần huỷ không lý do là đúng thứ D5 cấm."); return; }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/award/cancel`, { reason: lyDo });
  if (r.status !== 201) { bao($("loi7"), loiCua(r, "Không huỷ được")); return; }
  bao($("ok7"), "Đã huỷ trao thầu — một hàng trạng thái MỚI, lịch sử còn nguyên. Gói thầu về EVALUATING.");
  await veTraoThau();
});

// ---------------------------------------------------------------------------------------------
// Bước 8 — xuất bộ bằng chứng (mảnh 1 của `docs/PRODUCT.md` §11)
//
// Máy chủ trả VĂN BẢN của hai tệp, và trang ghi đúng văn bản ấy ra đĩa — không `JSON.parse` rồi
// `JSON.stringify` lại: byte của bundle phải do máy chủ quyết, cùng byte mà `pnpm bang-chung xuat`
// ghi. `Blob` từ một chuỗi JS mã hoá UTF-8, đúng thứ `dacTaSha256` băm.
//
// Trang KHÔNG tự kiểm bundle. Lớp kiểm chịu lực của ADR-059 là một bản cài ĐỘC LẬP chạy ngoài hệ
// thống; một nút "kiểm" ở đây sẽ là chính hệ thống bị kiểm tự phục vụ người kiểm nó.
// ---------------------------------------------------------------------------------------------

function taiVe(ten, noiDung, loai) {
  const url = URL.createObjectURL(new Blob([noiDung], { type: loai }));
  const a = document.createElement("a");
  a.href = url;
  a.download = ten;
  document.body.append(a);
  a.click();
  a.remove();
  // Thu hồi SAU một nhịp: thu hồi ngay trong cùng tác vụ làm vài trình duyệt huỷ lượt tải.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("nut-xuat-bang-chung").addEventListener("click", async () => {
  bao($("loi8"), ""); bao($("ok8"), "");
  $("nut-xuat-bang-chung").disabled = true;
  try {
    const r = await goi("GET", `/rfqs/${phien.rfqId}/evidence-bundle`);
    if (r.status !== 200) { bao($("loi8"), loiCua(r, "Không xuất được bộ bằng chứng")); return; }
    const b = r.body.evidenceBundle ?? null;
    if (b === null) {
      dienDl($("tt-bang-chung"), [["Bộ bằng chứng", "gói thầu chưa được chấm lần nào — không có gì để xuất"]]);
      return;
    }
    const tenTep = Object.keys(b.tep);
    for (const ten of tenTep) {
      taiVe(ten, b.tep[ten], ten.endsWith(".json") ? "application/json" : "text/markdown;charset=utf-8");
    }
    dienDl($("tt-bang-chung"), [
      ["Gói thầu", phien.rfqId],
      ["Lượt chấm", b.soLuotCham],
      ["Hàng (mọi lượt)", b.soHang],
      ["Lần trao thầu (kể cả đã huỷ)", b.soTraoThau],
      ["Tệp", tenTep.join(" · ")],
    ]);
    bao($("ok8"), "Đã tải hai tệp. Kiểm chúng ở một máy khác bằng `pnpm bang-chung kiem --bo <thư-mục>`.");
  } finally {
    $("nut-xuat-bang-chung").disabled = false;
  }
});

// ==============================================================================================
// [S1.99 / khoản 205] ĐỔI FRAGMENT PHẢI ĐỔI CẢ PHIÊN — VÀ Ở TRANG NÀY, KHÔNG LÀM THẾ THÌ NGƯỜI
// DUYỆT THỨ HAI KHOÁ TÀI KHOẢN CỦA NGƯỜI DUYỆT THỨ NHẤT.
//
// Chuỗi hỏng, đo được ở cả ba mắt:
//   ⑴ trang đọc `location.hash` ĐÚNG MỘT LẦN lúc tải, và đổi fragment trên cùng một tài liệu
//     KHÔNG tải lại trang — nên hai ô `org`/`token` giữ nguyên mã của người duyệt THỨ NHẤT;
//   ⑵ cổng đăng nhập ngay trên đọc ô nhập chứ không đọc fragment: `token` bằng `phien.token` nên
//     nó không reset gì, và `phien.daRedeem` vẫn true nên `/auth/redeem` bị bỏ qua;
//   ⑶ `/auth/totp` do đó nhận mã đăng nhập của NGƯỜI THỨ NHẤT kèm mã sáu số của NGƯỜI THỨ HAI.
//     `MFA_MAX_FAILED_ATTEMPTS` là 5 (`packages/identity/src/mfa-credentials.ts`), nên năm lần gõ
//     là chứng chỉ MFA của người thứ nhất bị khoá — bởi một người không hề định làm thế.
//
// Đó là cùng hạng hậu quả với khoản 199 mà ADR-048 vừa tốn trọn một vòng để đóng, và nó là
// khiếm khuyết của chính vòng S1.98: vòng ấy đóng khoản 204 ở `nop-thau.js` và `tao-thau.js` rồi
// bỏ trang này, sau khi tự viết rằng để nguyên sẽ thành *"hai trang cư xử khác nhau ở cùng một
// chỗ"*.
//
// Phiên được dựng LẠI TRỌN VẸN chứ không vá từng trường: `rfqId` và `unsealRequestId` đang giữ
// là hai con trỏ đọc được dưới quyền của NGƯỜI TRƯỚC. Mang chúng sang phiên của người sau là
// đúng hình dạng nửa vời mà `tao-thau.js` mắc phải (khoản 204 ghi sai rằng trang ấy không lặp
// lại khiếm khuyết).
// ==============================================================================================
window.addEventListener("hashchange", () => {
  docLink();
  phien = { orgId: "", token: $("token").value.trim(), rfqId: "", unsealRequestId: "", daRedeem: false };
  for (const id of ["loi1", "loi2", "loi3", "loi4", "loi5", "loi8", "ok1", "ok3", "ok5", "ok8", "ghi-danh"]) {
    const el = $(id);
    if (el !== null) bao(el, "");
  }
});

docLink();

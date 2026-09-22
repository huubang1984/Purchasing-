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
// ==============================================================================================

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

let phien = { orgId: "", token: "", daRedeem: false, rfqId: "", supplierId: "", contactId: "", soHangMuc: 0 };

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
window.addEventListener("hashchange", () => {
  docLink();
  phien = { orgId: "", token: $("token").value.trim(), daRedeem: false, rfqId: "", supplierId: "", contactId: "", soHangMuc: 0 };
  for (const id of ["loi1", "loi2", "loi3", "loi4", "ok1", "ghi-danh"]) {
    const el = $(id);
    if (el !== null) bao(el, "");
  }
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
    const me = await goi("GET", "/me");
    const u = me.body?.userId;
    bao($("ok1"), u === undefined
      ? "Đã vào. Phiên nằm trong cookie HttpOnly."
      : `Đã vào với người dùng ${String(u).slice(0, 8)}… (vai: ${me.body?.kind ?? "?"}). Phiên nằm trong cookie HttpOnly, JavaScript không đọc được nó.`);
    $("b1").classList.add("xong");
    for (const b of ["b2", "b3", "b4", "b5"]) hien($(b), true);
  } finally {
    $("nut-vao").disabled = false;
  }
});

// ---------------------------------------------------------------------------------------------
// Bước 2 — gói thầu
// ---------------------------------------------------------------------------------------------

async function napRfq(rfqId) {
  const r = await goi("GET", `/rfqs/${rfqId}`);
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được gói thầu")); return false; }
  const g = r.body?.rfq ?? {};
  phien = { ...phien, rfqId };
  dienDl($("tt-rfq"), [
    ["Mã gói thầu", rfqId],
    ["Tên", g.title],
    ["Trạng thái", g.status],
    ["Hạn nộp", g.deadlineAt === undefined ? null : new Date(g.deadlineAt).toLocaleString("vi-VN")],
    ["Cần hai người duyệt", g.requiresDualApproval === true ? "có" : "không"],
  ]);
  await napHangMuc();
  return true;
}

$("nut-tao").addEventListener("click", async () => {
  bao($("loi2"), ""); bao($("ok2"), "");
  const title = $("tieu-de").value.trim();
  const han = $("han").value;
  if (title === "" || han === "") { bao($("loi2"), "Cần cả tiêu đề và hạn nộp."); return; }
  const r = await goi("POST", "/rfqs", { title, deadlineAt: new Date(han).toISOString() });
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
  ["nut-mo", "open", "Đã mở thầu. Từ giờ nhà cung cấp nộp được, và khoá của gói đã sinh ở máy chủ."],
]) {
  $(nut).addEventListener("click", async () => {
    bao($("loi4"), ""); bao($("ok4"), "");
    if (phien.rfqId === "") { bao($("loi4"), "Tạo hoặc đọc một gói thầu trước."); return; }
    const r = await goi("POST", `/rfqs/${phien.rfqId}/${duong}`);
    if (r.status !== 200) { bao($("loi4"), loiCua(r, "Bước này không đi được")); return; }
    bao($("ok4"), xong);
    await napRfq(phien.rfqId);
  });
}

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
  bao($("ok5"), "Đã mời. Link đi thẳng tới bộ gửi — màn này không bao giờ thấy mã mời.");
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
    for (const v of [m.supplierName, m.contactName, m.linkChannel, m.status]) {
      const td = document.createElement("td");
      td.textContent = v === null || v === undefined ? "—" : String(v);
      tr.append(td);
    }
    const td = document.createElement("td");
    if (m.revokedAt === null) {
      const nut = document.createElement("button");
      nut.className = "phu";
      nut.textContent = "Thu hồi";
      nut.addEventListener("click", async () => {
        bao($("loi5"), ""); bao($("ok5"), "");
        const th = await goi("POST", `/invitations/${m.id}/revoke`);
        if (th.status !== 200) { bao($("loi5"), loiCua(th, "Không thu hồi được")); return; }
        bao($("ok5"), "Đã thu hồi. Mời lại nhà cung cấp ấy được rồi.");
        await napLoiMoi();
      });
      td.append(nut);
    }
    tr.append(td);
    tb.append(tr);
  }
}

docLink();

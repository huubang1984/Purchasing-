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

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

let phien = { orgId: "", token: "", rfqId: "", unsealRequestId: "", daRedeem: false };

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
  el.innerHTML = "";
  for (const [k, v] of hang) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v === null || v === undefined ? "—" : String(v);
    el.append(dt, dd);
  }
}

const nhomSo = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function tien(chuoi) {
  if (chuoi === null || chuoi === undefined) return "—";
  const [n, l = "00"] = String(chuoi).split(".");
  return `${nhomSo(n)},${l}`;
}

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
});

// ---------------------------------------------------------------------------------------------
// Bước 3 — đóng thầu, yêu cầu mở, phê duyệt, điều phối
// ---------------------------------------------------------------------------------------------

function veYeuCau(yc) {
  phien = { ...phien, unsealRequestId: yc.id };
  dienDl($("tt-yc"), [
    ["Mã yêu cầu", yc.id],
    ["Trạng thái", yc.status],
    ["Số phê duyệt", yc.approvalCount ?? yc.approvals?.length ?? "—"],
    ["Break-glass", yc.breakGlass === true ? "CÓ" : "không"],
  ]);
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
  bao($("ok3"), "Đã tạo yêu cầu. Người tạo KHÔNG tự phê duyệt thay cho người thứ hai được.");
});

$("nut-duyet").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  if (phien.unsealRequestId === "") { bao($("loi3"), "Chưa có yêu cầu nào."); return; }
  const r = await goi("POST", `/unseal/${phien.unsealRequestId}/approve`);
  if (r.status !== 200) { bao($("loi3"), loiCua(r, "Không phê duyệt được")); return; }
  veYeuCau(r.body.unsealRequest);
  bao($("ok3"), "Đã ghi một chữ ký phê duyệt. Thiếu người thứ hai thì điều phối sẽ bị từ chối.");
});

$("nut-dieu-phoi").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  if (phien.unsealRequestId === "") { bao($("loi3"), "Chưa có yêu cầu nào."); return; }
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
  tbody.innerHTML = "";
  const reNhoNhat = c.aggregates?.min ?? null;
  for (const h of c.rows ?? []) {
    const tr = document.createElement("tr");
    if (reNhoNhat !== null && h.totalAmount === reNhoNhat) tr.className = "thap";
    const td = (chu, lop) => { const x = document.createElement("td"); x.textContent = chu; if (lop) x.className = lop; return x; };
    tr.append(td(h.supplierLegalName), td(tien(h.totalAmount), "so"), td(h.currency ?? "—"), td(String(h.version ?? "—"), "so"));
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

docLink();

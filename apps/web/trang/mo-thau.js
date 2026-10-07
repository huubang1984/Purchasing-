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
import {
  chuCoMocNgoai, chuCotNgoai, chuDai, chuDaiNgoai, chuLech, chuMocNgoai, chuNhan, chuThanhPhan, chuTrangThai, doPhu, soDai, tomTatNhan,
} from "/lib/benchmark.js";
import { LA_UUID, SAI_TO_CHUC, docMaToChuc, ganDangNhap } from "/lib/dang-nhap.js";

const $ = (id) => document.getElementById(id);
const hien = (el, co) => { el.hidden = !co; };
const bao = (el, chu) => { el.textContent = chu; hien(el, chu !== ""); };

// [S1.240 / khoản 282] `orgId`, `token`, `daRedeem` rời khỏi đây: mã đăng nhập và "đã đổi ở máy chủ chưa" nay sống trong
// `/lib/dang-nhap.js` (bước 1 chung của bốn trang người mua). Phiên của trang chỉ còn hai con trỏ của các bước sau.
let phien = { rfqId: "", unsealRequestId: "" };
/**
 * [S1.255 / khoản 327] Người đang vào (`/me`.userId): nút «Rút đề xuất» chỉ hiện cho CHÍNH người đề xuất. Mọi lối mở các
 * bước đi qua `moSauDangNhap`, nơi nó được đặt lại.
 */
let nguoiDangVao = null;

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

// [S1.254 / khoản 323] Thân 403 của `apps/api` là MỘT hằng (`THAN_403` của `dispatch.ts` — khoản 191: API không nói thiếu
// quyền NÀO), và in nguyên văn thì người dùng đọc một chuỗi không dấu, kể cả trong kịch bản trình diễn. Trang biết người dùng
// vừa bấm gì, nên nói được một câu đọc được mà không tiết lộ thêm gì; mọi thân lỗi khác vẫn in nguyên văn.
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

// [S1.99 / khoản 206] `tien` từng có một bản cài THỨ HAI ngay đây, chép tay từ `nop-thau.js`.
// Hai bản cài của cùng một quy ước hiển thị là hai chỗ để chúng lệch nhau, và trang nộp thầu đã
// chứng minh quy ước ấy đáng được đo.

// ---------------------------------------------------------------------------------------------
// Bước 1 — đăng nhập: magic link + TOTP
// ---------------------------------------------------------------------------------------------

// [S1.176 / ADR-107] Hình dạng mã tổ chức — UUID (ADR-012) — dùng ở `docLink`. ~~Hằng của trang~~ [S1.240 / khoản 282] `LA_UUID`
// import từ `/lib/dang-nhap.js`: một bản với phép đọc ô tổ chức của bước 1.

// [S1.176 / ADR-107] Trang NHỚ mã tổ chức sau lần vào đầu tiên trên máy này — tiện cho từng người xem,
// không phải trạng thái phải bền: `orgId` không phải bí mật (ADR-107 mục 1), và kho trình duyệt có thể trống
// hay ném (chế độ riêng tư), nên mọi lần đọc/ghi đều bọc và trang chạy đúng khi không có nó. Chỉ ghi SAU khi
// vào thành công — một link lạ mang `#<orgId>` không được đặt mã tổ chức cho lần sau.
const KHOA_TO_CHUC = "tp-ma-to-chuc";
function toChucDaNho() {
  try { return localStorage.getItem(KHOA_TO_CHUC) ?? ""; } catch { return ""; }
}
function nhoToChuc(orgId) {
  try { localStorage.setItem(KHOA_TO_CHUC, orgId); } catch { /* không nhớ được thì thôi */ }
}

// [S1.176 / ADR-107] Đọc ô tổ chức — nhận cả một link cũ dán vào, `""` khi ô rỗng, `null` khi sai hình dạng. ~~`docToChuc()` của
// trang~~ [S1.240 / khoản 282] `docMaToChuc($("org").value)` của `/lib/dang-nhap.js`, cùng câu `SAI_TO_CHUC`: bước 1 của bốn trang
// và ô xin link ở dưới đọc qua MỘT hàm.
const MAT_KET_NOI = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

function docLink() {
  // Link gieo ra mang `#<mã tổ chức>:<mã đăng nhập>` — đường xác thực là đường VÔ DANH, nên máy
  // chủ không biết người gọi thuộc tổ chức nào cho tới khi client nói ra. Bản đầu của trang này
  // chỉ đọc token và lượt chạy thử đầu tiên trả về đúng câu `thiếu trường "orgId"`.
  //
  // [S1.176 / ADR-107] Nay mọi bộ gửi của sản phẩm dựng đúng dạng ấy. Thêm một dạng: `#<mã tổ chức>`
  // trơn — link của tin báo người duyệt khi hạn mức chặn mã đăng nhập. Nó điền ô tổ chức và XOÁ ô mã (mã
  // của người trước không được đứng lại), để ô xin link bên dưới dùng được ngay.
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const i = h.indexOf(":");
  if (i > 0) {
    $("org").value = h.slice(0, i);
    $("token").value = h.slice(i + 1);
    return;
  }
  if (LA_UUID.test(h)) {
    $("org").value = h;
    $("token").value = "";
    return;
  }
  if (h !== "") $("token").value = h;
}

// ---------------------------------------------------------------------------------------------
// [S1.230 / khoản 193] HAI VIỆC, HAI NÚT: «Tiếp» đổi mã đăng nhập (và ghi danh nếu cần), «Vào» vào.
//
// Bản cũ gộp cả hai vào nút Vào: người mới bấm Vào với ô mã sáu số trống, trang gọi `/auth/redeem`,
// máy chủ trả bí mật TOTP, và bí mật ấy hiện ra CÙNG CHỖ với câu lỗi của lần bấm trượt — nên màn
// hình không nói nó đang xin thứ gì, và chủ dự án đã đưa nhầm mã đăng nhập thay vì bí mật (đo ngày
// 2026-09-20). Nay ô mã sáu số ẩn cho tới khi máy chủ đã nói tài khoản này cần ghi danh hay không;
// bí mật hiện ở khối riêng, với nhãn nói rõ nó là gì và KHÔNG phải gì.
//
// [S1.240 / khoản 282] ~~`doiMaDangNhap`, `doiMa`, `dongKhoiMa` và hai trình nghe của trang này~~ Bước ấy nay là MỘT module,
// `/lib/dang-nhap.js`, mà `/tao-thau`, `/nhom-hang`, `/chinh-sach` cũng gắn vào cùng bộ id — ba trang ấy từng chép khối cũ (nút Vào
// gộp «lấy bí mật» với «vào»), nên người mở thẳng chúng với link còn hạn gặp lại đúng khiếm khuyết trên. Trang trao cho module
// `document`, `goi`, `history`, `location` và việc của riêng nó sau khi vào: nhớ mã tổ chức (ADR-107), mở các bước.
// ---------------------------------------------------------------------------------------------
const dangNhap = ganDangNhap({
  taiLieu: document,
  goi,
  lichSu: history,
  viTri: location,
  daVao: (me, orgId) => {
    nhoToChuc(orgId);
    moSauDangNhap(me, false);
  },
});

const CAC_BUOC_SAU = ["b2", "b3", "b4", "b5", "b6", "b7", "b8"];

/**
 * [S1.177] Mở các bước sau đăng nhập. Hai lối vào: vừa đăng nhập xong, hoặc người dùng bấm "Tiếp tục với
 * phiên này" ở khối hỏi của `thuPhienCo`. Bước 1 VẪN hiện: màn này đăng nhập lại được bằng người duyệt thứ hai.
 * Câu báo chỉ nêu tám ký tự đầu của mã người dùng — `/me` cố ý không trả tên hay email, và `kind` là LOẠI phiên
 * (luôn `USER` với cookie trình duyệt), không phải vai nghiệp vụ, nên trang không in nó.
 */
function moSauDangNhap(me, dungLai) {
  const u = me?.userId;
  nguoiDangVao = typeof u === "string" ? u : null;
  const ai = typeof u === "string" ? `người dùng ${u.slice(0, 8)}…` : "";
  bao($("ok1"), ai === ""
    ? "Đã vào. Phiên nằm trong cookie HttpOnly."
    : dungLai
      ? `Đang dùng phiên còn hạn của ${ai}. Cần đổi người thì đăng nhập ở trên bằng link của người ấy. ` +
        "Điều phối giải mã ở bước 3 vẫn đòi lần nhập mã sáu số trong 15 phút gần nhất — quá hạn thì xin link mới."
      : `Đã vào với ${ai}. Phiên nằm trong cookie HttpOnly, JavaScript không đọc được nó.`);
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), true);
  $("b1").classList.add("xong");
  for (const b of CAC_BUOC_SAU) hien($(b), true);
  // [S1.216 / khoản 195] Vừa vào (hay vừa nhận phiên) là lúc hỏi link đăng nhập gần đây của chính mình — không chờ, không chặn.
  // [S1.240 / khoản 282] Khối ấy nay ở `/lib/dang-nhap.js`.
  void dangNhap.veLinkGanDay();
}

/** [S1.177] Về lại bước 1: ẩn mọi bước sau, bỏ dấu "xong", bỏ khối hỏi phiên và nút Đăng xuất. */
function dongCacBuoc() {
  $("b1").classList.remove("xong");
  for (const b of CAC_BUOC_SAU) hien($(b), false);
  bao($("hoi-phien"), "");
  hien($("nut-dung-phien"), false);
  hien($("nut-dang-xuat"), false);
  // [S1.216 / khoản 195] Về bước 1 là danh sách link của người trước phải đi, và một phản hồi về muộn của nó bị bỏ.
  dangNhap.anLinkGanDay();
}

// ---------------------------------------------------------------------------------------------
// [S1.216 / khoản 195 / ADR-126] Link đăng nhập gần đây của CHÍNH mình — vế «báo ngay» của khoản 195.
//
// Thông điệp ở bước đổi mã gộp «không hợp lệ / hết hạn / đã dùng» làm một, và phải thế: ở đường vô danh,
// nói khác đi là cho kẻ cầm một mã lạ biết mã ấy còn sống không. Người ĐÃ vào thì được xem: `GET
// /auth/login-links` trả link của chính họ (máy chủ lấy người từ cookie, không có tham số nào để hỏi
// người khác), và trang vẽ mỗi link một dòng. Một link «đã dùng lúc Y» mà lúc ấy không phải mình đăng
// nhập là dấu hiệu duy nhất người mua thấy được mà không cần mở cơ sở dữ liệu. Khối là trợ giúp: máy chủ
// từ chối hay mất mạng thì ẩn, các bước vẫn mở; về bước 1 thì ẩn và rỗng, và một phản hồi về muộn sau đó
// bị bỏ — cùng phép kiểm-lại-sau-await của `thuPhienCo`, ở đây bằng một bộ đếm lượt: mỗi lần hỏi hay mỗi
// lần về bước 1 là một lượt mới, phản hồi của lượt cũ không vẽ gì (kể cả khi người khác đã vào sau đó).
//
// [S1.240 / khoản 282, 268] ~~`GIO`, `moTaLink`, `anLinkGanDay`, `veLinkGanDay` của trang này~~ Khối ấy nay ở `/lib/dang-nhap.js` —
// bốn trang người mua cùng có nó —, và nó nói thêm cửa sổ 7 ngày và câu «còn nữa» khi thân mang `truncated: true`.
// ---------------------------------------------------------------------------------------------

/**
 * [S1.177] Phiên người mua là cookie `Path=/` sống tới 8 giờ, KỂ CẢ sau khi đóng trình duyệt (`Max-Age`), dùng
 * chung cả ba trang — còn mã đăng nhập chỉ dùng được MỘT lần (`startUserSession` tiêu thụ nó). Trước vòng này
 * trang chỉ hỏi `/me` SAU khi đăng nhập, nên sang trang khác là phải xin link mới. Nay hỏi lúc tải, nhưng
 * KHÔNG tự mở các bước: trên máy dùng chung phiên ấy có thể của người khác, và mở sẵn các nút Phê duyệt dưới
 * danh tính người ấy là để một người trung thực ký thay họ. Trang hỏi — "Tiếp tục với phiên này" hay "Đăng
 * xuất" — và chỉ mở khi được bảo.
 *
 * Không hỏi khi ô mã đã có mã: người mở link của mình thấy ô đăng nhập. `docLink()` phải chạy TRƯỚC hàm này
 * (cuối tệp), vì phép kiểm ô mã chạy đồng bộ trước `await` đầu tiên. Kiểm LẠI sau `await`: một `/me` về muộn,
 * sau khi người khác đã dán link của mình (hashchange) hay đã đăng nhập, bị bỏ — ô mã lúc ấy đã có mã.
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

/**
 * [S1.177] `POST /auth/logout` thu hồi CHÍNH phiên đang gọi và xoá cookie. 401 nghĩa là phiên đã hết hay đã
 * bị thu hồi — điều người bấm muốn vẫn đạt, nên trang cũng về bước 1.
 */
$("nut-dang-xuat").addEventListener("click", async () => {
  bao($("loi1"), ""); bao($("ok1"), "");
  $("nut-dang-xuat").disabled = true;
  try {
    const r = await goi("POST", "/auth/logout");
    if (r.status !== 200 && r.status !== 401) { bao($("loi1"), loiCua(r, "Không đăng xuất được")); return; }
    phienCho = null;
    phien = { rfqId: "", unsealRequestId: "" };
    dongCacBuoc();
    // [S1.240 / khoản 282] Mã đang ở ô phải đổi lại ở máy chủ trước lần vào sau; ô mã sáu số đóng (khoản 193).
    dangNhap.datLai();
    bao($("ok1"), "Đã đăng xuất. Trình duyệt này không còn giữ phiên của bạn.");
  } catch {
    bao($("loi1"), MAT_KET_NOI);
  } finally {
    $("nut-dang-xuat").disabled = false;
  }
});

// [S1.177] ADR-020 mục 3: trang xoá fragment khỏi thanh địa chỉ SAU `/auth/totp` — lúc mã đã bị tiêu thụ nên xoá nó không làm
// mất gì. ~~`xoaManhLink()` của trang~~ [S1.240 / khoản 282] Việc ấy nay là của nút Vào trong `/lib/dang-nhap.js`, qua `history` và
// `location` mà trang trao vào.

// [S1.176 / ADR-107] Xin link đăng nhập. `/auth/link` trả CÙNG một 200 cho mọi email — có người hay
// không, bị hạn mức hay không (sổ nợ 38) — nên câu báo cũng là MỘT câu: trang không được biết thêm điều
// máy chủ cố ý không nói. Chỉ 429 (trần theo người gọi) và 422 (sai hình dạng) nói khác đi. Câu ấy phải
// đúng ở MỌI nhánh sau 200: việc gửi chạy SAU phản hồi (outbox), và một người đã có năm mã trong 15 phút
// (`LOGIN_MAX_TOKENS_PER_WINDOW`, đếm cả mã hệ thống phát) nhận 200 mà không nhận thư.
$("nut-xin-link").addEventListener("click", async () => {
  bao($("loi-link"), ""); bao($("ok-link"), "");
  const orgId = docMaToChuc($("org").value);
  const email = $("email").value.trim();
  if (orgId === null) { bao($("loi-link"), SAI_TO_CHUC); return; }
  if (orgId === "" || email === "") { bao($("loi-link"), "Cần mã tổ chức và email."); return; }
  $("nut-xin-link").disabled = true;
  try {
    const r = await goi("POST", "/auth/link", { orgId, email });
    if (r.status === 200) {
      bao($("ok-link"), "Nếu email này thuộc tổ chức, link đăng nhập sẽ tới trong ít phút. Mỗi người nhận tối đa 5 link mỗi 15 phút, và link đã tới vẫn dùng được trong 15 phút — đừng bấm lại.");
    } else if (r.status === 429) {
      bao($("loi-link"), "Đã xin quá nhiều link trong ít phút. Đợi một lúc rồi thử lại.");
    } else {
      bao($("loi-link"), loiCua(r, "Không gửi được yêu cầu"));
    }
  } catch {
    bao($("loi-link"), MAT_KET_NOI);
  } finally {
    $("nut-xin-link").disabled = false;
  }
});

// ---------------------------------------------------------------------------------------------
// Bước 2 — gói thầu: trạng thái và SỐ ĐẾM, không có giá
// ---------------------------------------------------------------------------------------------

$("nut-doc").addEventListener("click", async () => {
  bao($("loi2"), "");
  const id = $("rfq").value.trim();
  if (id === "") { bao($("loi2"), "Cần mã gói thầu."); return; }
  phien = { ...phien, rfqId: id, xepHang: [], xepHangLuot: "", awardDaDoc: "", soSanh: undefined };
  // [rà soát S4.5c1] Benchmark của gói TRƯỚC không được sống sang gói này: cột Benchmark của bảng xếp hạng đọc `benchmarkHien`.
  datLaiBenchmark();
  const r = await goi("GET", `/rfqs/${id}`);
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không đọc được gói thầu")); return; }
  const rfq = r.body.rfq;
  dienDl($("tt-rfq"), [
    ["Tên", rfq.title],
    ["Trạng thái", rfq.status],
    ["Hạn nộp", new Date(rfq.deadlineAt).toLocaleString("vi-VN")],
    ["Cần hai người duyệt", rfq.requiresDualApproval === true ? "có" : "không"],
    ...(rfq.status === "CANCELLED" ? [["Lý do huỷ", rfq.cancelReason ?? "(gói huỷ trước khi hệ thống lưu lý do)"]] : []),
  ]);
  const d = await goi("GET", `/rfqs/${id}/bid-count`);
  if (d.status === 200) {
    const c = d.body.bidCount ?? d.body;
    // [S1.249 / khoản 299] Từ khoản 271 `count` là số báo giá SẼ DỰ THẦU — luồng của lời mời còn sống (ADR-128) — không phải số
    // đã nhận: ~~"Đã nhận N báo giá."~~ nói "Đã nhận 1" khi bên mua đã thu hồi một lời mời có báo giá, trong khi hai báo giá đã nhận.
    bao($("dem"), c?.disclosed === false
      ? `Số báo giá đang bị giấu (${c.reason}) — chính sách mù nghiêm còn hiệu lực tới khi đóng thầu.`
      : `${c?.count ?? "?"} báo giá sẽ dự thầu (không kể lời mời đã thu hồi). Không một mức giá nào đọc được ở đây.`);
  }
  // [S1.90 / khoản 190] Bấm Đọc là lúc người duyệt thứ hai lấy được yêu cầu đang treo.
  await napYeuCau(id);
});

// [S1.165 / khoản 225] Huỷ gói thầu. Trước vòng ấy, gói đã đóng hay đã mở thầu KHÔNG huỷ được bằng
// bất kỳ đường nào — và một lượt chấm bị từ chối vì lệch tiền tệ để gói đứng yên ở `UNSEALED` mãi.
// Lý do BẮT BUỘC ở máy chủ (`cancelRfq`, và trigger ở bốn cạnh sau khi đóng); trang chỉ nói trước.
$("nut-huy-goi").addEventListener("click", async () => {
  bao($("loi2"), ""); bao($("ok2"), "");
  if (!phien.rfqId) { bao($("loi2"), "Đọc gói thầu trước."); return; }
  const lyDo = $("ly-do-huy").value.trim();
  if (lyDo === "") { bao($("loi2"), "Lý do là BẮT BUỘC — nhà cung cấp đã mời sẽ đọc câu này."); return; }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/cancel`, { reason: lyDo });
  if (r.status !== 200) { bao($("loi2"), loiCua(r, "Không huỷ được")); return; }
  bao($("ok2"), "Đã huỷ gói thầu. Khoá của gói bị thu hồi, lý do vào sổ kiểm toán và hiện ở trang nộp thầu.");
  $("nut-doc").click();
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

/**
 * [S1.259 / khoản 332] Câu báo sau một chữ ký mở thầu, đọc từ yêu cầu VỪA NẠP LẠI. Trước vòng này câu là một hằng — *"Thiếu
 * người thứ hai thì điều phối sẽ bị từ chối"* — kể cả khi chính chữ ký ấy làm yêu cầu đủ (đo trên trình duyệt ở §S1.255: XD-03
 * đã `APPROVED 2 / 2`, câu vẫn nói thiếu). Ngưỡng lấy từ máy chủ (`requiredApprovals`, khoản 192) — trang không tự suy ra "hai".
 */
function cauSauChuKy(yc) {
  const dem = yc?.approvalCount;
  const can = yc?.requiredApprovals;
  const coSo = typeof dem === "number" && typeof can === "number";
  if (yc?.status === "APPROVED") {
    return `Đã ghi chữ ký phê duyệt — yêu cầu đã đủ${coSo ? ` ${dem} / ${can}` : ""} chữ ký. Người xin mở bấm «Điều phối giải mã».`;
  }
  return `Đã ghi một chữ ký phê duyệt. Chưa đủ chữ ký${coSo ? ` (${dem} / ${can})` : ""} — điều phối sẽ bị từ chối cho tới khi đủ.`;
}

$("nut-duyet").addEventListener("click", async () => {
  bao($("loi3"), ""); bao($("ok3"), "");
  if (phien.unsealRequestId === "") { bao($("loi3"), CHUA_CO_YEU_CAU); return; }
  const r = await goi("POST", `/unseal/${phien.unsealRequestId}/approve`);
  if (r.status !== 200) { bao($("loi3"), loiTuChoiDuyet(r)); return; }
  veYeuCau(r.body.unsealRequest);
  const doc = await napYeuCau(phien.rfqId);
  // Phản hồi của lần ký KHÔNG mang `approvalCount`/`requiredApprovals` (đo trên trình duyệt: câu ra "đã đủ chữ ký" không số);
  // `GET /rfqs/:id/unseal` vừa nạp lại thì có. Nạp lại hỏng ⇒ dùng phản hồi của lần ký (vẫn có `status`).
  bao($("ok3"), cauSauChuKy(doc?.status === 200 ? (doc.body.unsealRequest ?? null) : (r.body.unsealRequest ?? null)));
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

/** [S1.260 / S4.5c1] Đọc và vẽ bảng so sánh; trả `false` khi máy chủ từ chối. Benchmark theo dòng dùng lại các hàng của nó. */
async function docBangSoSanh() {
  bao($("loi4"), "");
  const r = await goi("GET", `/rfqs/${phien.rfqId}/comparison`);
  if (r.status !== 200) {
    phien = { ...phien, soSanh: undefined };
    bao($("loi4"), loiCua(r, "Chưa đọc được bảng so sánh"));
    return false;
  }
  const c = r.body.comparison;
  phien = { ...phien, soSanh: Array.isArray(c.rows) ? c.rows : [] };
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
    // [S1.277 / khoản 334] `data-nhan`: dưới 480 px bảng (lớp `xep`) xếp thành khối, mỗi ô mang nhãn cột của mình (`chung.css`).
    const coNhan = (x, nhan) => { x.dataset.nhan = nhan; return x; };
    tr.append(
      coNhan(td(h.supplierLegalName), "Nhà cung cấp"), coNhan(td(tien(h.totalAmount), "so"), "Tổng"),
      coNhan(td(h.currency ?? "—"), "Tiền tệ"),
      coNhan(td(String(h.version ?? "—"), "so"), "Lần nộp"),
      coNhan(td(h.bafoRoundNo === null || h.bafoRoundNo === undefined ? "vòng 1" : `BAFO ${h.bafoRoundNo}`), "Vòng"),
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
  return true;
}

$("nut-bang").addEventListener("click", () => docBangSoSanh());

// ---------------------------------------------------------------------------------------------
// [S1.260 / S4.5c1] Bước 4 — benchmark theo dòng (spec S4 §4.6; ADR-143)
//
// Một bản cho mỗi lần mở thầu: lần đọc đầu tiên tính và lưu, các lần sau đọc bản lưu. Bản lưu không mang số tiền nào — số của dải
// và hàng nền ghi sau mốc chỉ tính khi bấm «Xem dải» một dòng. Ở vòng chào lại đang mở, máy chủ trả trạng thái có tên và không nhãn
// nào; trang in câu ấy.
// ---------------------------------------------------------------------------------------------

/** Benchmark có nhãn lần đọc gần nhất (`trangThai: "CO"`), hay `null`. Bảng xếp hạng đọc nó cho cột Benchmark. */
let benchmarkHien = null;

/** Xoá benchmark đang hiện — đổi gói thì nhãn của gói cũ không được ở lại trên màn. */
function datLaiBenchmark() {
  benchmarkHien = null;
  $("bang-benchmark").querySelector("tbody").replaceChildren();
  dienDl($("tt-benchmark"), []);
  hien($("khoi-dai"), false);
  bao($("loi4b"), "");
  veCotBenchmark();
}

const tenBaoGia = (id) => (phien.soSanh ?? []).find((h) => h.bidVersionId === id)?.supplierLegalName ?? `báo giá ${id.slice(0, 8)}…`;
/** Các dòng phong bì của một báo giá — CHỈ phần tử là đối tượng: phong bì là chữ của nhà cung cấp, một dòng `null` không được làm vỡ bảng. */
const dongCuaBaoGia = (id) => {
  const h = (phien.soSanh ?? []).find((x) => x.bidVersionId === id);
  return Array.isArray(h?.payload?.lines) ? h.payload.lines.filter((l) => l !== null && typeof l === "object") : [];
};

async function veBenchmark() {
  bao($("loi4b"), "");
  hien($("khoi-dai"), false);
  // Benchmark TRƯỚC, bảng so sánh SAU và chỉ khi có nhãn ([rà soát S4.5c1]): ở trạng thái bảng so sánh đóng (đo ở lượt đi thử 375×812
  // trên gói `AWARDED`), hỏi bảng so sánh chỉ để nhận một lần từ chối — và một hàng sổ từ chối — mỗi cú bấm. Khi có nhãn, bảng so sánh
  // đọc LẠI mỗi lần: tên nhà cung cấp, đơn giá chào và độ phủ phải là của đúng tập báo giá bản lưu đã gắn nhãn, không của một lần đọc
  // trước một vòng chào lại.
  const r = await goi("GET", `/rfqs/${phien.rfqId}/benchmark`);
  if (r.status !== 200) { bao($("loi4b"), loiCua(r, "Chưa đọc được benchmark")); return; }
  const b = r.body.benchmark;
  const tbody = $("bang-benchmark").querySelector("tbody");
  tbody.replaceChildren();
  const cau = chuTrangThai(b);
  if (cau !== null) {
    benchmarkHien = null;
    dienDl($("tt-benchmark"), [["Benchmark", cau]]);
    veCotBenchmark();
    return;
  }
  await docBangSoSanh();
  benchmarkHien = b;
  const td = (chu, lop) => { const x = document.createElement("td"); x.textContent = chu; if (lop) x.className = lop; return x; };
  const baoGia = [...new Set(b.dong.map((d) => d.bidVersionId))];
  const phu = baoGia.map((id) => [id, doPhu(b.dong.filter((d) => d.bidVersionId === id), dongCuaBaoGia(id))]);
  const tongDo = phu.reduce((t, [, p]) => t + p.soDoDuoc, 0);
  const tongDong = phu.reduce((t, [, p]) => t + p.soDong, 0);
  dienDl($("tt-benchmark"), [
    ["Phương pháp", b.phuongPhap],
    ["Chính sách phiên bản (ghim lúc mở)", b.policyVersion],
    ["Lần mở thầu", b.bafoRoundId === null ? "vòng 1" : "vòng chào lại (BAFO)"],
    ["Mốc mở giá", new Date(b.mocMoGia).toLocaleString("vi-VN")],
    ["Tính lúc", `${new Date(b.tinhLuc).toLocaleString("vi-VN")}${b.nguon === "TINH_MOI" ? " — lần đọc này vừa tính" : ""}`],
    ["Độ phủ của gói", `${String(tongDo)}/${String(tongDong)} (báo giá × dòng) đo được`],
    ...phu.map(([id, p]) => [
      `Độ phủ — ${tenBaoGia(id)}`,
      `${String(p.soDoDuoc)}/${String(p.soDong)} dòng${p.phanTramGiaTri === null ? "" : ` · ${p.phanTramGiaTri}% giá trị`}`,
    ]),
  ]);
  const dongSo = [...new Set(b.dong.map((d) => d.lineNo))].sort((x, y) => x - y);
  for (const lineNo of dongSo) {
    const cuaDong = b.dong.filter((d) => d.lineNo === lineNo);
    for (const [i, d] of cuaDong.entries()) {
      const tr = document.createElement("tr");
      const o = document.createElement("td");
      if (i === 0) {
        const chu = document.createElement("span");
        chu.textContent = `Dòng ${String(lineNo)} `;
        const nut = document.createElement("button");
        nut.className = "phu";
        nut.textContent = "Xem dải";
        nut.addEventListener("click", () => veDai(lineNo));
        o.append(chu, nut);
      }
      const gia = dongCuaBaoGia(d.bidVersionId).find((l) => l.lineNo === lineNo)?.unitPrice ?? null;
      // `data-nhan`: trên màn hẹp bảng xếp thành khối, mỗi ô mang nhãn cột của mình (`chung.css`, khuôn `hang-gia` của `/nop-thau`).
      const coNhan = (x, nhan) => { x.dataset.nhan = nhan; return x; };
      // [S1.276 / S4.6b] Lịch sử ngoài: nhãn riêng của bản lưu; mốc ngoài: cờ theo (hàng chuẩn, tiền tệ) của dòng — không con số.
      const doDuoc = d.nhan !== "KHONG_DO_DUOC";
      const moc = doDuoc
        ? (b.mocNgoai ?? []).find((m) => m.canonicalItemId === d.canonicalItemId && m.tienTe === d.tienTe)
        : undefined;
      const ngoai = (b.dongNgoai ?? []).find((x) => x.bidVersionId === d.bidVersionId && x.lineNo === lineNo);
      tr.append(
        o,
        coNhan(td(tenBaoGia(d.bidVersionId)), "Nhà cung cấp"),
        coNhan(td(gia === null ? "—" : tien(String(gia)), "so"), "Đơn giá chào"),
        coNhan(td(chuNhan(d)), "Benchmark"),
        coNhan(td(chuThanhPhan(d)), "Thành phần dải"),
        coNhan(td(chuCotNgoai(b.dongNgoai ?? null, d.bidVersionId, lineNo, doDuoc), ngoai?.nhan === "LECH_CAO" ? "lech" : ""), "Lịch sử ngoài"),
        coNhan(td(doDuoc ? chuCoMocNgoai(moc) : "—"), "Mốc ngoài"),
      );
      // Tô cả hàng theo nhãn NỘI BỘ; nhãn ngoài lệch cao chỉ tô ô của nó (L15: hai nhãn không trộn).
      if (d.nhan === "LECH_CAO") tr.className = "lech";
      tbody.append(tr);
    }
  }
  veCotBenchmark();
}

async function veDai(lineNo) {
  bao($("loi4b"), "");
  const r = await goi("GET", `/rfqs/${phien.rfqId}/items/${String(lineNo)}/benchmark`);
  if (r.status !== 200) { bao($("loi4b"), loiCua(r, "Chưa tính được dải")); return; }
  const d = r.body.dai;
  // Dải tính trên bản lưu MỚI NHẤT; bảng đang hiện có thể là của một lần mở thầu trước (một vòng chào lại vừa mở niêm phong).
  const cu = d.trangThai === "CO" && benchmarkHien !== null && d.snapshotId !== benchmarkHien.snapshotId
    ? [["Lưu ý", "Dải này của lần mở thầu MỚI hơn bảng benchmark đang hiện — bấm Đọc benchmark để đọc lại nhãn."]] : [];
  if (d.trangThai !== "CO") {
    const cau = d.trangThai === "CHUA_CO_BAN_LUU" ? "Chưa có bản benchmark của lần mở thầu này — bấm Đọc benchmark trước."
      : d.trangThai === "KHONG_CO_DAI" ? `Dòng ${String(lineNo)} không có báo giá nào đo được — không có dải.`
      : chuTrangThai(d);
    dienDl($("tt-dai"), [[`Dòng ${String(lineNo)}`, cau]]);
    hien($("khoi-dai"), true);
    return;
  }
  // [S1.276 / S4.6b] Dải lịch sử ngoài (nhãn riêng, ghi rõ nguồn) và mốc ngoài (con số, độ lệch của từng báo giá — không nhãn). Độ
  // lệch chỉ in khi tiền tệ của CHÍNH báo giá có mốc (rà soát §S1.276: tiền tệ khác của dòng có mốc không được kéo theo "—").
  dienDl($("tt-dai"), [
    ...cu,
    ...d.dai.map((x) => [`Dòng ${String(lineNo)} — dải lịch sử nội bộ (${x.tienTe})`, chuDai(x, d.donViGoc)]),
    ...(d.daiNgoai ?? []).map((x) => [
      `Dòng ${String(lineNo)} — dải lịch sử mua ngoài hệ thống (${x.tienTe})`,
      chuDaiNgoai(x, d.donViGoc),
    ]),
    ...(d.mocNgoai ?? []).map((m) => [`Dòng ${String(lineNo)} — mốc giá ngoài (${m.tienTe})`, chuMocNgoai(m, d.donViGoc)]),
    ...d.giaCuaGoi.map((g) => [
      `Đơn giá quy đổi — ${tenBaoGia(g.bidVersionId)}`,
      g.donGiaQuyDoi === null
        ? `không quy đổi được (${g.trangThai})`
        : `${soDai(g.donGiaQuyDoi)} ${g.tienTe ?? ""}/${d.donViGoc ?? "đơn vị gốc"}${g.lechMoc == null ? "" : ` · ${chuLech(g.lechMoc)} so với mốc ngoài`}`,
    ]),
  ]);
  hien($("khoi-dai"), true);
}

$("nut-benchmark").addEventListener("click", veBenchmark);

/** Ô cột Benchmark của bảng xếp hạng đang vẽ — `veXepHang` đặt lại, `veCotBenchmark` viết lại chữ sau mỗi lần đọc benchmark. */
let oCotBenchmark = [];

/** Cột Benchmark của bảng xếp hạng: tóm tắt nhãn và độ phủ của từng báo giá theo lần đọc benchmark gần nhất. */
function veCotBenchmark() {
  for (const o of oCotBenchmark) o.textContent = chuCotBenchmark(o.dataset.bidVersionId ?? "");
}

function chuCotBenchmark(bidVersionId) {
  if (benchmarkHien === null) return "—";
  const dong = benchmarkHien.dong.filter((d) => d.bidVersionId === bidVersionId);
  if (dong.length === 0) return "—";
  const p = doPhu(dong, dongCuaBaoGia(bidVersionId));
  return `${tomTatNhan(dong)} · phủ ${String(p.soDoDuoc)}/${String(p.soDong)} dòng`;
}

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
  oCotBenchmark = [];
  const b = r.body.ranking ?? null;
  // `null` là câu trả lời ĐÚNG cho "chưa chấm lần nào", cùng khuôn `veYeuCau` ở bước 3. Một bảng
  // rỗng thì nói dối: "đã chấm, và không ai trong bảng" khác hẳn "chưa chấm".
  if (b === null) {
    phien = { ...phien, xepHang: [], xepHangLuot: "" };
    dienDl($("tt-luot"), [["Lượt chấm", "chưa chấm lần nào — bấm Chấm thầu"]]);
    return;
  }
  phien = { ...phien, xepHang: Array.isArray(b.rows) ? b.rows : [], xepHangLuot: b.evaluationId };
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
    // [S1.277 / khoản 334] `data-nhan`: dưới 480 px bảng xếp hạng (lớp `xep`) xếp thành khối, mỗi ô mang nhãn cột của mình
    // (`chung.css`) — đo trên Chromium ở 375×812: bảng bảy trăm px, cả trang cuộn ngang.
    const coNhan = (x, nhan) => { x.dataset.nhan = nhan; return x; };
    tr.append(
      coNhan(td(h.rank === null ? "—" : String(h.rank), "so"), "Hạng"),
      coNhan(td(h.supplierName), "Nhà cung cấp"),
      coNhan(td(h.effectiveCost === null ? "—" : tien(h.effectiveCost), "so"), "Chi phí hiệu dụng"),
    );
    const o = coNhan(document.createElement("td"), "Thành phần");
    o.append(veThanhPhan(h.components ?? []));
    tr.append(o);
    // [S1.260 / S4.5c1] Nhãn ở bảng xếp hạng (spec S4 §4.6): tóm tắt theo lần đọc benchmark gần nhất ở bước 4.
    const bm = coNhan(td(typeof h.bidVersionId === "string" ? chuCotBenchmark(h.bidVersionId) : "—", "cot-benchmark"), "Benchmark");
    bm.dataset.bidVersionId = typeof h.bidVersionId === "string" ? h.bidVersionId : "";
    oCotBenchmark.push(bm);
    tr.append(bm);
    // [S1.254 / khoản 320] Bước 7 đề xuất trên ĐÚNG id phiên bản báo giá, mà trước vòng này không bảng nào in id ấy — người
    // mua thật không đề xuất trao thầu được bằng giao diện. Nút chỉ có ở hàng có hạng: báo giá không có chi phí hiệu dụng đọc
    // được ở lượt chấm này thì `award_kiem_de_xuat` từ chối nó.
    const chon = document.createElement("td");
    if (h.rank !== null && typeof h.bidVersionId === "string") {
      const nut = document.createElement("button");
      nut.className = "phu";
      nut.textContent = "Chọn";
      nut.addEventListener("click", () => {
        $("bao-gia-thang").value = h.bidVersionId;
        bao($("loi5"), "");
        bao($("ok5"), `Đã chọn ${h.supplierName} (hạng ${String(h.rank)}). Id phiên bản báo giá đã điền ở bước 7 — ghi lý do rồi bấm ` +
          "Đề xuất trao thầu.");
      });
      chon.append(nut);
    }
    tr.append(chon);
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
    phien = { ...phien, awardDaDoc: "" };
    dienDl($("tt-award"), [["Trao thầu", "chưa có đề xuất nào"]]);
    hien($("nut-rut-de-xuat"), false);
    return;
  }
  // Cùng cổng `bid.view` với lời đọc vừa qua, nên bảng xếp hạng đọc được; hỏng thì bước 5 nói lý do, đề xuất vẫn hiện id.
  const timHang = () => (phien.xepHangLuot === a.evaluationId
    ? (phien.xepHang ?? []).find((h) => h.bidVersionId === a.bidVersionId) ?? null
    : null);
  if (timHang() === null) await veXepHang();
  // [S1.231 / khoản 232 / ADR-133] Nút RÚT chỉ hiện khi rút được: đề xuất đang PROPOSED và CHƯA chữ ký. Trang
  // đọc hai thứ ấy từ máy chủ, không tự đếm — và lớp có thẩm quyền vẫn là trigger `094`, kể cả khi nút hiện sai.
  // [S1.255 / khoản 327] …và CHỈ cho chính người đề xuất (`actedBy` của hàng PROPOSED): từ khoản 321 người duyệt cũng đọc
  // được đề xuất, và nút rút hiện cạnh «Phê duyệt» cho cả Tổng Giám đốc (đo trên trình duyệt thật).
  hien($("nut-rut-de-xuat"), a.status === "PROPOSED" && (a.approvals ?? []).length === 0 && a.actedBy === nguoiDangVao);
  // [S1.254 / khoản 321] Id phiên bản không nói được với người duyệt là AI thắng: gọi tên từ hàng xếp hạng cùng id, của ĐÚNG
  // lượt chấm mà đề xuất dựa trên (`evaluationId`). Không có hàng ấy thì hiện id như trước — không đoán từ một lượt khác.
  const hang = timHang();
  dienDl($("tt-award"), [
    ["Trạng thái", a.status],
    ...(hang === null ? [] : [
      ["Nhà cung cấp", hang.supplierName],
      ["Chi phí hiệu dụng", hang.effectiveCost === null ? "—" : tien(hang.effectiveCost)],
      ["Hạng ở lượt chấm", hang.rank === null ? "—" : String(hang.rank)],
    ]),
    ["Báo giá được chọn", a.bidVersionId],
    ["Dựa trên lượt chấm", a.evaluationId],
    ["Lý do", a.reason],
    ["Lúc", new Date(a.actedAt).toLocaleString("vi-VN")],
    ["Chữ ký duyệt", a.approvals.length === 0
      ? "chưa có"
      : a.approvals.map((c) => new Date(c.approvedAt).toLocaleString("vi-VN")).join(" · ")],
  ]);
  phien = { ...phien, awardDaDoc: a.awardId };
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

// [S1.254 / khoản 321] Đọc đề xuất mà không ký — cùng khuôn «Đọc bảng xếp hạng» của bước 5.
$("nut-doc-award").addEventListener("click", async () => {
  bao($("loi7"), ""); bao($("ok7"), "");
  if (phien.rfqId === "") { bao($("loi7"), "Đọc gói thầu ở bước 2 trước."); return; }
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
  // [S1.254 / khoản 321] Ký lên đề xuất ĐÃ HIỆN TRÊN MÀN: lần bấm đầu — hay khi đề xuất đã đổi từ lúc đọc — chỉ vẽ nó ra
  // (nhà cung cấp, chi phí hiệu dụng, lý do). Trước vòng này nút ký lên một khối trống. Không tự vẽ lúc nạp gói: người không giữ
  // `bid.view` mở gói sẽ để lại hai hàng PERMISSION_DENIED cho một lần xem mà họ không hề bấm.
  if (phien.awardDaDoc !== a.awardId) {
    await veTraoThau();
    if (phien.awardDaDoc !== "") {
      bao($("ok7"), "Đề xuất sắp ký hiện ở dưới — đọc nhà cung cấp, chi phí và lý do, rồi bấm Phê duyệt lần nữa để ký.");
    }
    return;
  }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/award/${a.awardId}/approve`);
  if (r.status !== 201) { bao($("loi7"), loiCua(r, "Không duyệt được")); return; }
  bao($("ok7"), "Đã phê duyệt trao thầu. Gói thầu ĐỨNG YÊN ở AWARDED — nó đã ở đó từ lúc có đề xuất.");
  await veTraoThau();
});

// [S1.231 / khoản 232 / ADR-133] Rút đề xuất — đường của chính người đề xuất (`award.recommend`), cho một đề xuất
// chưa chữ ký. Ba vế (PROPOSED · cùng người · 0 chữ ký) ràng ở CSDL; lớp gói gọi tên lý do dưới 422 nên `loiCua` đủ.
$("nut-rut-de-xuat").addEventListener("click", async () => {
  bao($("loi7"), ""); bao($("ok7"), "");
  const lyDo = $("ly-do-award").value.trim();
  if (lyDo === "") { bao($("loi7"), "Lý do là BẮT BUỘC ở cả lần rút — một hàng trạng thái không lý do là đúng thứ D5 cấm."); return; }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/award/withdraw`, { reason: lyDo });
  if (r.status !== 201) { bao($("loi7"), loiCua(r, "Không rút được")); return; }
  bao($("ok7"), "Đã rút đề xuất — một hàng WITHDRAWN, lịch sử còn nguyên. Gói thầu về EVALUATING; đề xuất lại được.");
  await veTraoThau();
});

$("nut-huy-award").addEventListener("click", async () => {
  bao($("loi7"), ""); bao($("ok7"), "");
  const lyDo = $("ly-do-award").value.trim();
  if (lyDo === "") { bao($("loi7"), "Lý do là BẮT BUỘC ở cả lần huỷ — một lần huỷ không lý do là đúng thứ D5 cấm."); return; }
  // [S1.259 / khoản 333] Huỷ lên trao thầu ĐÃ HIỆN TRÊN MÀN — khuôn khoản 321 của «Phê duyệt». Trước vòng này nút huỷ theo GÓI
  // (route không nhận id trao thầu) khi bước 7 còn trống: đo trên trình duyệt, Tổng Giám đốc nạp XD-04, gõ lý do, bấm Huỷ ⇒
  // `CANCELLED`, và thứ vừa huỷ chỉ hiện sau đó. Lần bấm đầu — hay khi trao thầu mới nhất đã đổi từ lúc đọc — chỉ vẽ nó ra. ~~Giới hạn,
  // nói ra: giữa lần đọc lại dưới đây và lần huỷ, máy chủ vẫn huỷ trao thầu CÒN SỐNG lúc ấy, không theo id.~~ [S1.261 / khoản
  // 335] Route huỷ nay mang id trao thầu, cùng khuôn «Phê duyệt»: máy chủ từ chối khi nó không còn là trao thầu mới nhất của gói.
  const doc = await goi("GET", `/rfqs/${phien.rfqId}/award`);
  if (doc.status !== 200) { bao($("loi7"), loiCua(doc, "Chưa đọc được trao thầu sắp huỷ")); return; }
  const a = doc.body.award ?? null;
  if (a === null) { bao($("loi7"), "Gói thầu này chưa có trao thầu nào để huỷ."); return; }
  if (phien.awardDaDoc !== a.awardId) {
    await veTraoThau();
    if (phien.awardDaDoc !== "") {
      bao($("ok7"), "Trao thầu sắp huỷ hiện ở dưới — đọc nhà cung cấp, trạng thái và lý do, rồi bấm Huỷ trao thầu lần nữa để huỷ.");
    }
    return;
  }
  const r = await goi("POST", `/rfqs/${phien.rfqId}/award/${a.awardId}/cancel`, { reason: lyDo });
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
// [S1.240 / khoản 282] "Cổng đăng nhập ngay trên" của mắt ⑵ nay ở `/lib/dang-nhap.js`: `phien.token`/`phien.daRedeem` thành trạng
// thái của module, và lối về bước 1 dưới đây đặt lại nó bằng `dangNhap.datLai()`.
// ==============================================================================================
// [S1.177] Trình nghe này từng chỉ xoá câu báo, còn các bước 2–8 đã mở thì ĐỂ NGUYÊN — dưới cookie của
// người trước, và giờ không còn câu nào nói phiên ấy của ai. Mọi link thư đều trỏ `/login`, nên người duyệt
// thứ hai mở link của mình trong cùng thẻ chính là đường này. Nay đóng các bước về bước 1, rồi hỏi lại phiên
// (link không mang mã, như `#<mã tổ chức>` của tin báo người duyệt, vẫn được hỏi thay vì tự mở).
window.addEventListener("hashchange", () => {
  docLink();
  phienCho = null;
  phien = { rfqId: "", unsealRequestId: "" };
  for (const id of ["loi1", "loi2", "loi3", "loi4", "loi5", "loi8", "ok1", "ok3", "ok5", "ok8", "ghi-danh", "loi-link", "ok-link"]) {
    const el = $(id);
    if (el !== null) bao(el, "");
  }
  dongCacBuoc();
  // [S1.230 / khoản 193] Mã mới thì phải đổi lại ở máy chủ: ô mã sáu số đóng cùng `daRedeem`. [S1.240 / khoản 282] Cả hai nay sống
  // trong `/lib/dang-nhap.js`; `datLai()` đọc mã mới mà `docLink()` vừa đặt vào ô.
  dangNhap.datLai();
  thuPhienCo();
});

docLink();
if ($("org").value.trim() === "") $("org").value = toChucDaNho();
thuPhienCo();

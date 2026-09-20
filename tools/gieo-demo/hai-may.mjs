// =================================================================================================
// PHÉP ĐO CỦA VÒNG S1.90 — HAI NGƯỜI DUYỆT, HAI PHIÊN ĐỘC LẬP, KHÔNG AI CHÉP MÃ CHO AI
//
// Đây là kịch bản đã tìm ra khoản 190, chạy lại trên bản đã vá. Ba "máy" là ba hũ cookie riêng;
// hũ B và C KHÔNG BAO GIỜ nhận `unsealRequestId` từ mã của script này — chúng chỉ được đưa id GÓI
// THẦU, đúng như một người duyệt thật đọc từ email hay từ lời nhắn của đồng nghiệp.
//
// Nếu bản vá sai, bước B4 sẽ trả về null và script đỏ ở đó.
// =================================================================================================
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const GOC = "http://127.0.0.1:18090/api";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function giaiBase32(s) {
  let bit = 0, gia = 0;
  const ra = [];
  for (const c of s.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase()) {
    gia = (gia << 5) | B32.indexOf(c);
    bit += 5;
    if (bit >= 8) { ra.push((gia >>> (bit - 8)) & 0xff); bit -= 8; }
  }
  return Buffer.from(ra);
}

function maTotp(biMat, lech = 0) {
  const dem = Buffer.alloc(8);
  dem.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + lech));
  const h = createHmac("sha1", giaiBase32(biMat)).update(dem).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

/** Một "máy": hũ cookie riêng, không chia sẻ gì với máy khác. */
function taoMay(ten) {
  const hu = new Map();
  return {
    ten,
    async goi(method, duong, than) {
      const headers = { origin: "http://127.0.0.1:18090" };
      if (hu.size > 0) headers.cookie = [...hu].map(([k, v]) => `${k}=${v}`).join("; ");
      if (than !== undefined) headers["content-type"] = "application/json";
      const res = await fetch(`${GOC}${duong}`, {
        method, headers, body: than === undefined ? undefined : JSON.stringify(than), redirect: "manual",
      });
      for (const c of res.headers.getSetCookie()) {
        const [cap] = c.split(";");
        const i = cap.indexOf("=");
        hu.set(cap.slice(0, i).trim(), cap.slice(i + 1).trim());
      }
      const chu = await res.text();
      let body = null;
      try { body = chu === "" ? null : JSON.parse(chu); } catch { /* giữ null */ }
      return { status: res.status, body, chu };
    },
  };
}

async function dangNhap(may, orgId, token) {
  const r1 = await may.goi("POST", "/auth/redeem", { orgId, token });
  if (r1.status !== 200) throw new Error(`${may.ten}: redeem ${r1.status} ${r1.chu}`);
  const biMat = r1.body?.totpSecretBase32;
  if (biMat === undefined) throw new Error(`${may.ten}: hồ sơ đã ghi danh MFA, script này cần hồ sơ mới gieo`);
  for (const lech of [0, -1, 1]) {
    const r2 = await may.goi("POST", "/auth/totp", { orgId, token, code: maTotp(biMat, lech) });
    if (r2.status === 200) return;
  }
  throw new Error(`${may.ten}: /auth/totp trượt cả ba bước thời gian`);
}

function dat(dieu, cau) {
  if (!dieu) { console.log(`  ✗ ${cau}`); process.exitCode = 1; }
  else console.log(`  ✓ ${cau}`);
}

const nhat = readFileSync(process.argv[2], "utf8");
const orgId = /tổ chức\s*:\s*([0-9a-f-]{36})/u.exec(nhat)[1];
const rfqId = /gói thầu:\s*([0-9a-f-]{36})/u.exec(nhat)[1];
const maNguoiMua = [...nhat.matchAll(/\/mo-thau#[0-9a-f-]{36}:([A-Za-z0-9_-]+)/gu)].map((m) => m[1]);
const [tkSoan, tkDuyet1, tkDuyet2] = maNguoiMua;
console.log(`tổ chức ${orgId}\ngói thầu ${rfqId}\n`);

// ---- MÁY A — người soạn -------------------------------------------------------------------------
const A = taoMay("A/soạn");
await dangNhap(A, orgId, tkSoan);
console.log("MÁY A — người soạn");
dat((await A.goi("POST", `/rfqs/${rfqId}/close`, { reason: "het han nop" })).status === 200, "đóng thầu");
const taoYc = await A.goi("POST", `/rfqs/${rfqId}/unseal`, { reason: "den gio mo thau" });
dat(taoYc.status === 201, "tạo yêu cầu mở");
const idThat = taoYc.body.unsealRequest.id;
console.log(`  (mã yêu cầu chỉ MÁY A biết: ${idThat})`);
const tuDuyet = await A.goi("POST", `/unseal/${idThat}/approve`);
dat(tuDuyet.status === 403 || tuDuyet.status === 422, `người tạo tự phê duyệt bị chặn (${tuDuyet.status})`);

// ---- MÁY B — người duyệt 1, KHÔNG biết mã yêu cầu -----------------------------------------------
const B = taoMay("B/duyệt1");
await dangNhap(B, orgId, tkDuyet1);
console.log("\nMÁY B — người duyệt 1, chỉ có mã GÓI THẦU");
const timB = await B.goi("GET", `/rfqs/${rfqId}/unseal`);
dat(timB.status === 200, "đường tìm trả 200");
dat(timB.body?.unsealRequest?.id === idThat, "TÌM RA đúng yêu cầu mà máy A tạo — đây là khoản 190");
dat(timB.body?.unsealRequest?.approvalCount === 0, "approvalCount = 0");
dat(timB.body?.unsealRequest?.requiredApprovals === 2, "requiredApprovals = 2 — khoản 192");
const idB = timB.body?.unsealRequest?.id;
dat((await B.goi("POST", `/unseal/${idB}/approve`)).status === 200, "phê duyệt từ máy B");
dat((await B.goi("GET", `/rfqs/${rfqId}/unseal`)).body?.unsealRequest?.approvalCount === 1, "đếm lên 1");

// ---- MÁY C — người duyệt 2 ----------------------------------------------------------------------
const C = taoMay("C/duyệt2");
await dangNhap(C, orgId, tkDuyet2);
console.log("\nMÁY C — người duyệt 2, cũng chỉ có mã GÓI THẦU");
const timC = await C.goi("GET", `/rfqs/${rfqId}/unseal`);
dat(timC.body?.unsealRequest?.id === idThat, "TÌM RA đúng yêu cầu");
const idC = timC.body?.unsealRequest?.id;
dat((await C.goi("POST", `/unseal/${idC}/approve`)).status === 200, "phê duyệt từ máy C");
const sauHai = await C.goi("GET", `/rfqs/${rfqId}/unseal`);
dat(sauHai.body?.unsealRequest?.approvalCount === 2, "đếm lên 2");
dat(sauHai.body?.unsealRequest?.status === "APPROVED", "trạng thái APPROVED");
dat((await C.goi("POST", `/unseal/${idC}/dispatch`)).status === 200, "điều phối giải mã");

// ---- Sau khi điều phối: không còn yêu cầu ĐANG MỞ ------------------------------------------------
console.log("\nSAU KHI ĐIỀU PHỐI");
for (let i = 0; i < 20; i += 1) {
  const r = await C.goi("GET", `/rfqs/${rfqId}/unseal`);
  if (r.body?.unsealRequest === null) { dat(true, "yêu cầu đã EXECUTED không còn là 'đang mở' — vế lọc trạng thái, đo trên đường thật"); break; }
  if (i === 19) dat(false, "yêu cầu vẫn hiện ra sau khi worker chạy xong");
  await new Promise((x) => setTimeout(x, 1000));
}
console.log(process.exitCode === 1 ? "\n==> CÓ KHẲNG ĐỊNH ĐỎ" : "\n==> TẤT CẢ ĐẠT");

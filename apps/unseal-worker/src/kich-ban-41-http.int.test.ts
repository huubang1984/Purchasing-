// ==============================================================================================
// [S1.10.6] KỊCH BẢN MỤC 41 — ĐI TRỌN QUA HTTP, cộng BỘ QUÉT RÒ RỈ trên tiến trình thật.
//
// Bản gói (`kich-ban-41.int.test.ts`) gọi thẳng mười một gói. Bản này gọi `fetch`: mọi thứ người
// mua và nhà cung cấp làm đều là một yêu cầu HTTP tới `apps/api`; thứ duy nhất KHÔNG qua HTTP là
// bước 11 (worker giải mã) — vì đó chính là điều A1/G1 đòi: không có một endpoint nào làm việc ấy.
// File sống trong `apps/unseal-worker/` vì họ `g1-` cấm mọi module ngoài worker import
// `executeUnsealRequest` — cùng lý do bản gói sống ở đây.
//
//   [INV-A1] [INV-A2]  BỘ QUÉT: gieo năm mức giá THẬT qua năm phong bì niêm phong, rồi gọi MỌI route
//                      trong `ROUTES` (đủ bốn đối tượng) TRƯỚC khi mở thầu, quét thân + header phản
//                      hồi + mọi dòng `console.error` bắt được — không một chữ số giá nào lọt. Kèm
//                      đối chứng dương: chính bộ quét bắt được một chuỗi giá gieo vào một thân giả.
//   [INV-A6]  số báo giá đã nhận bị giấu trước CLOSED (qua HTTP), công bố sau.
//   [INV-B1] [INV-B2] [INV-D1] [INV-D2] [INV-A4] [INV-A3] [INV-B5] — cùng phép đo bản gói, qua HTTP.
//
// PHẦN CHÊNH của A2, nói trước: bộ quét đo PHẢN HỒI, HEADER và LOG BẮT ĐƯỢC của tiến trình api.
// Nó KHÔNG đo heap, KHÔNG đo APM trace, KHÔNG đo lỗi ở tầng vận chuyển ngoài tiến trình. §4 của ma
// trận ghi đúng ba vế ấy; ô ✅ của A2 KHÔNG được đọc rộng hơn.
//
// [S1.174 / S3.1d] HAI LUỒNG — spec S3 §8.11, cùng khuôn bản gói: mọi bước chạy cho tổ chức CHƯA bật (MVP1, trên bộ điều
// phối cấu hình MẶC ĐỊNH — cờ ký tắt, đúng máy chủ thật hôm nay) rồi cho tổ chức ĐÃ BẬT (trên bộ điều phối cờ ký BẬT). Luồng
// S3 khác ở bước 1 — người tài chính khai phiên bản CÓ BẬC, người tài chính thứ hai ký nó QUA ROUTE ký — và ở thân mà bộ
// quét gửi cho `POST /policy`: tổ chức đã bật từ chối phiên bản không bậc.
// ==============================================================================================
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { auditStoredCiphertexts, verifyReceipt } from "@trustprocure/bidding";
import { migrate } from "@trustprocure/db";
import { CHOT_VAO_SO, counterForTime, deriveTotpCode } from "@trustprocure/identity";
import { sealBid } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";
import { quetGiaMoiQuanHe, startPostgres, type TestDatabase } from "@trustprocure/test-support";
// Import TƯƠNG ĐỐI xuyên app, có chủ đích: `@trustprocure/api` không có alias vitest và không nên
// là dependency của worker (đường chạy của worker không chạm api). Test là nơi duy nhất nối hai app.
import { createApiServer, createDispatcher, ROUTES } from "../../api/src/index.js";
import { COOKIE_PHIEN_KHACH } from "../../api/src/routes/anon.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "../../api/src/routes/auth.js";
import { dichVuTest, outboxTest, type DichVuTest } from "../../api/src/test-services.js";
// [S1.174 / S3.1d] Mẫu bậc của màn `/chinh-sach` — cùng lý do import tương đối xuyên app ở trên.
import { BAC_MAC_DINH, MUC_MAC_DINH } from "../../web/src/chinh-sach.js";
// [S1.286 / S4.7b2] Thước TCO của màn `/nop-thau` và phép tính của `/mo-thau` — khối TCO cuối tệp dựng phong bì bằng chính các hàm ấy.
// [S1.288 / S4.7c1] …và ô giải trình lệch hạng cùng các dòng cam kết của bước 7 `/mo-thau`.
import {
  canGiaiTrinh,
  docThuocTco,
  loiOKhai,
  moTaCamKet,
  moTaThanhPhan,
  oCanKhai,
  truongKhai,
  type CamKetHien,
  type ThanhPhanXepHang,
} from "../../web/src/tco.js";
import { executeUnsealRequest } from "./index.js";
import { createOrgKeyUnwrapper } from "@trustprocure/crypto-keys/unwrap";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

const NHA_CUNG_CAP = [
  { ten: "Thep Hoa Phat", gia: "980000000.00" },
  { ten: "Thep Viet Duc", gia: "1050000000.00" },
  { ten: "Thep Pomina", gia: "1120000000.00" },
  { ten: "Thep Nam Kim", gia: "999000000.00" },
  { ten: "Thep Tung Kuang", gia: "1400000000.00" },
] as const;
const GIA_SUA_LAI = "930000000.00";
const NGAN_SACH = "1000000000.00";
/**
 * [S1.109 / S2.5] HAI GIÁ CỦA VÒNG BAFO — và ba tính chất của chúng đều là điều kiện để **J4**
 * đo được thật:
 *
 * ⑴ **Chuỗi chữ số KHÁC HẲN mọi giá vòng một.** Nếu một giá BAFO trùng chữ số với một giá đã mở,
 *    thì *"bộ quét thấy nó"* và *"bộ quét không thấy nó"* đều KHÔNG nói gì — con số ấy đã hợp lệ
 *    có mặt ở khắp nơi từ trước. Lượt quét khi ấy xanh mà rỗng ruột.
 * ⑵ **Thấp hơn mọi giá vòng một** (`930000000.00` là thấp nhất sau lần sửa) — BAFO là *best and
 *    final*, nên một giá BAFO cao hơn sẽ làm bảng xếp hạng sau vòng hai không đổi và ca *"xếp
 *    hạng tính LẠI"* mất răng.
 * ⑶ **Khác nhau đôi một**, để hai nhà cung cấp không hoán đổi được cho nhau trong khẳng định.
 */
const GIA_BAFO = ["911000000.00", "922000000.00"] as const;
/** Mọi chuỗi giá đã đi vào hệ thống dưới dạng rõ — thứ bộ quét đi tìm. */
const MOI_GIA: readonly string[] = [...NHA_CUNG_CAP.map((n) => n.gia), GIA_SUA_LAI, ...GIA_BAFO];
/**
 * [S1.251 / S4.4b] Gói chính có ĐÚNG MỘT dòng, 100 tấm (bước 1). Phong bì mang `lines` như trình duyệt dựng (`nop-thau.js`,
 * spec S4 §2.5 ⒅): `amount` bằng tổng, `unitPrice` = tổng / 100 — đơn giá của mọi giá trên là một số NGUYÊN đồng, và chuỗi chữ
 * số của nó không nằm trong chuỗi của tổng (`9300000.00` không là chuỗi con của `930000000.00`: sau bảy chữ số là `00.`).
 */
const SO_LUONG_DONG = 100;
const donGiaCua = (tong: string): string => (Number(tong) / SO_LUONG_DONG).toFixed(2);
/**
 * [S1.272 / S4.6a] Hai KIM của dữ liệu ngoài (ADR-095 ⑹): đơn giá của một mốc giá ngoài và của một dòng lịch sử mua ngoài hệ thống,
 * nhập ở bước 1 — TRƯỚC mọi lượt chấm, benchmark và xuất bộ bằng chứng — và quét ở bước 14. Hai con số không trùng giá nào của kịch
 * bản, và khác nhau, nên mỗi kim chỉ được phép đứng ở ĐÚNG bảng của nó.
 */
const KIM_MOC_NGOAI = "73519.83";
const KIM_LICH_SU_NGOAI = "64287.19";
const banRo = (tong: string, ten: string): string =>
  JSON.stringify({ totalAmount: tong, currency: "VND", nhaCungCap: ten, lines: [{ lineNo: 1, unitPrice: donGiaCua(tong), amount: tong }] });
/** Hàng chuẩn của dòng ấy (bước 1): gốc `kg`, tấm 1 500 × 6 000 × 12 mm thép 7 850 kg/m³ = 847,8 kg. */
const HANG_CHUAN_CHINH = { ma: "THEP-TAM-SS400-12", ten: "Thep tam SS400 day 12mm", donViGoc: "kg", heSoTam: "847.8" } as const;

/** Bộ mở bọc CẶP với `rfqKeyWrapper` của `dichVuTest()` (xor 0xff) — chỉ worker cầm. */
// [ADR-062] Mở cặp khoá tổ chức mà bộ sinh của test "bọc" bằng xor 0xff.
const boMoBoc = createOrgKeyUnwrapper({
  name: "doi-xung-cua-test",
  moKhoaRieng: (k) => Promise.resolve(new Uint8Array(k.wrappedPrivateKey).map((b) => b ^ 0xff)),
});

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let unsealPool: pg.Pool;
let dv: DichVuTest;
let ob: ReturnType<typeof outboxTest>;
let orgA: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;
/** [S1.174 / S3.1d] Máy chủ của luồng S3: cùng CSDL, cùng dịch vụ, cờ ký chính sách BẬT (ADR-105). */
let serverS3: ReturnType<typeof createApiServer>;
let gocMacDinh: string;
let gocS3: string;
const logLoi: string[] = [];

interface Nguoi {
  readonly id: string;
  readonly cookie: string;
}
interface PhanHoi {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

function base32Decode(s: string): Buffer {
  const BANG = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let gia = 0;
  const ra: number[] = [];
  for (const ch of s) {
    const v = BANG.indexOf(ch);
    if (v < 0) throw new Error("base32 hong");
    gia = (gia << 5) | v;
    bits += 5;
    if (bits >= 8) {
      ra.push((gia >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(ra);
}

/**
 * [S1.281 / S3.4a / K9] Luồng S3: người sắp ký, chấm, đề xuất hay duyệt trao thầu, ghi nhận tín hiệu khai *không xung đột* trên gói
 * qua chính route của màn — K9 đòi lời khai với đúng danh sách mời hiện tại (bậc mặc định `khai_xung_dot: true`), và danh sách của
 * luồng S3 đứng yên từ DRAFT nên một lời khai sống trọn kịch bản. Luồng MVP1 không gọi — tổ chức chưa bật, K9 không sống.
 */
async function khaiKhongXungDot(rfqId: string, cookie: string): Promise<void> {
  const r = await goi("POST", `/rfqs/${rfqId}/coi-declarations`, cookie, { trangThai: "KHONG_XUNG_DOT" });
  expect(r.status, r.text).toBe(201);
}

async function goi(method: string, path: string, cookie?: string, body?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  let than: string | undefined;
  if (body !== undefined) {
    than = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${goc}${path}`, { method, headers, body: than });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
}

/** Người mua đi TRỌN đường đăng nhập của S1.10.4: link → ghi danh TOTP → mã đúng → cookie. */
async function dangNhap(email: string, vaiTro: string): Promise<Nguoi> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [orgA, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgA, id, vaiTro]);
  const truoc = dv.linkDaGui.length;
  expect((await goi("POST", "/auth/link", undefined, { orgId: orgA, email })).status).toBe(200);
  await ob.chay(orgA); // [sổ nợ 38] link ra đời khi job chạy
  expect(dv.linkDaGui).toHaveLength(truoc + 1);
  const token = dv.linkDaGui.at(-1)!.token;
  const rd = await goi("POST", "/auth/redeem", undefined, { orgId: orgA, token });
  expect(rd.status, rd.text).toBe(200);
  const biMat = base32Decode((rd.body as { totpSecretBase32: string }).totpSecretBase32);
  const r = await goi("POST", "/auth/totp", undefined, { orgId: orgA, token, code: deriveTotpCode(biMat, counterForTime(Date.now())) });
  expect(r.status, r.text).toBe(200);
  const gt = /tp_session=([^;]+)/u.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
  expect(gt).not.toBe("");
  return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${gt}` };
}

/** Nhà cung cấp đi TRỌN đường S1.3 qua HTTP: link (từ bộ gửi) → redeem → OTP → verify → cookie. */
async function moPhienKhach(tokenLink: string): Promise<string> {
  expect((await goi("POST", "/guest/redeem", undefined, { orgId: orgA, token: tokenLink })).status).toBe(200);
  const truoc = dv.otpDaGui.length;
  expect((await goi("POST", "/guest/otp", undefined, { orgId: orgA, token: tokenLink, channel: "SMS" })).status).toBe(200);
  expect(dv.otpDaGui).toHaveLength(truoc + 1);
  const r = await goi("POST", "/guest/otp/verify", undefined, { orgId: orgA, token: tokenLink, code: dv.otpDaGui.at(-1)!.code });
  expect(r.status, r.text).toBe(200);
  const gt = /tp_guest=([^;]+)/u.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
  expect(gt).not.toBe("");
  return `${COOKIE_PHIEN_KHACH}=${gt}`;
}

/** Giá dưới dạng SỐ NGUYÊN đồng (không phần thập phân) — thứ bộ dò so sánh, thay vì một cách viết. */
const GIA_SO: ReadonlyMap<number, string> = new Map(MOI_GIA.map((g) => [Number(g), g]));
/** [S1.251 / S4.4b] ĐƠN GIÁ của mỗi giá, dạng số nguyên đồng → giá (tổng) của nó. */
const DON_GIA_SO: ReadonlyMap<number, string> = new Map(MOI_GIA.map((g) => [Number(g) / SO_LUONG_DONG, g]));

/**
 * Rút mọi giá trị số có thể đọc ra từ một văn bản, theo MỌI cách viết thường gặp:
 * `980000000.00`, `980000000`, `980,000,000`, `980.000.000`, `980 000 000`, `9.8e8`, `9.8E+8`.
 * Mỗi mẩu số cho vài cách đọc (bỏ hết dấu phân cách; bỏ hai chữ số thập phân cuối rồi bỏ phân cách);
 * số mũ được tính ra. Trả về tập số nguyên.
 */
function rutSo(vanBan: string): ReadonlySet<number> {
  const ra = new Set<number>();
  // ============================================================================================
  // [S1.19 / CI run 34125062632] NHÁNH KÝ HIỆU KHOA HỌC PHẢI CÓ BIÊN — NẾU KHÔNG NÓ ĐỌC UUID
  // ============================================================================================
  // Bản trước không có hai vế nhìn trước/nhìn sau, nên nó khớp `98e7` **bên trong** một chuỗi
  // hex: `Number("98e7")` = 980 000 000 = ĐÚNG một giá của kịch bản. Một UUID bất kỳ chứa `98e7`
  // hay `14e8` làm bộ quét báo RÒ RỈ trên một phản hồi KHÔNG có một trường giá nào —
  // `GET /guest/session` trả về đúng bốn trường: hai UUID, một rfqId, một kênh.
  //
  // ĐO ĐƯỢC, và đây là lý do nó chỉ thỉnh thoảng đỏ: trên 300 000 thân giả lập của
  // `GET /guest/session` (5 phiên, 15 UUID mỗi thân) bản cũ báo rò rỉ **1381 lần — 0,46%**. Với
  // hơn bốn mươi route mỗi lượt quét và hai lượt quét mỗi lần chạy, một lượt CI đỏ vì lý do này
  // là chuyện thường gặp chứ không phải hiếm — và nó đã đỏ ở CI của chính vòng S1.19
  // (`kich-ban-41-http.int.test.ts`, `GET /guest/session (200): 930000000.00`).
  //
  // Vì sao đây là khiếm khuyết NẶNG dù nó là ĐỎ GIẢ: nó là một cổng an ninh kêu sai định kỳ, và
  // một cổng như thế dạy người ta chạy lại thay vì đọc. Ngày nó kêu ĐÚNG, phản xạ đã được huấn
  // luyện sẵn là bấm "re-run".
  //
  // Biên: hai vế chặn cả chữ-số-chữ-cái LẪN dấu `-` (một mảnh UUID có thể ĐÚNG BẰNG `98e7`, khi
  // ấy nó đứng giữa hai dấu gạch nối). Giá là số DƯƠNG, nên `-9.8e8` không phải thứ cần bắt.
  // Mọi cách viết thật vẫn khớp: `gia: 9.8e8 VND`, `9.8E+8`, `0.98e9`, `"9.8e8"` trong JSON.
  for (const m of vanBan.matchAll(/(?<![0-9A-Za-z-])\d+(?:[.,]\d+)?[eE][+-]?\d+(?![0-9A-Za-z-])/gu)) {
    const n = Number(m[0].replace(",", "."));
    if (Number.isFinite(n)) ra.add(Math.round(n));
  }
  for (const m of vanBan.matchAll(/\d(?:[\d.,_ ]*\d)?/gu)) {
    const t = m[0];
    const chiSo = t.replace(/[^\d]/gu, "");
    if (chiSo.length > 0 && chiSo.length <= 15) ra.add(Number(chiSo));
    const boThapPhan = t.replace(/[.,]\d{1,2}$/u, "").replace(/[^\d]/gu, "");
    if (boThapPhan.length > 0 && boThapPhan.length <= 15) ra.add(Number(boThapPhan));
    // [S1.251 / S4.4b] SỐ THẬP PHÂN DÀI. Đơn giá của lịch sử giá là thương của một phép chia `numeric` — Postgres in
    // `9300000.000000000000` (đo trên 16-alpine). Hai cách đọc trên đều ra 19 chữ số và BỎ QUA nó: bộ quét mù với mọi đơn giá
    // ở `GET /items/:itemId/price-history`. Cách đọc thứ ba lấy giá trị số, làm tròn tới đồng.
    if (/^\d{1,15}[.,]\d+$/u.test(t)) {
      const n = Number(t.replace(",", "."));
      if (Number.isFinite(n)) ra.add(Math.round(n));
    }
  }
  // [lượt soi §S1.251 — L1] MẢNG SỐ TRẦN của JSON: `[9300000,9220000]` là MỘT mẩu cho biểu thức trên (dấu phẩy là dấu phân cách
  // nghìn), và cả hai cách đọc đều sai. Thân là JSON thì đọc thêm mọi lá SỐ của nó theo giá trị.
  const la = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) ra.add(Math.round(v));
    else if (Array.isArray(v)) v.forEach(la);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(la);
  };
  try {
    la(JSON.parse(vanBan));
  } catch {
    // Không phải JSON — hai cách đọc trên là đủ.
  }
  return ra;
}

/**
 * [S1.251 / S4.4b] Bộ quét ĐƠN GIÁ — cùng bộ rút số của `quetRoRi`, so với `DON_GIA_SO`; trả các GIÁ (tổng) mà đơn giá của
 * chúng hiện ra. Không giải mã base64/hex: thứ nó soi là thân JSON của lịch sử giá, nơi đơn giá đứng dạng chữ số.
 */
function quetDonGia(vanBan: string): readonly string[] {
  const thay = new Set<string>();
  for (const so of rutSo(vanBan)) {
    const g = DON_GIA_SO.get(so);
    if (g !== undefined) thay.add(g);
  }
  return MOI_GIA.filter((g) => thay.has(g));
}

/**
 * [S1.260 / S4.5c1] Bộ quét ĐƠN GIÁ QUY ĐỔI — đơn giá theo đơn vị gốc của hàng chuẩn chính (`thanhTien / (100 tấm · 847,8 kg/tấm)`), con
 * số KHÔNG nguyên mà `rutSo` không đọc ra: `quetDonGia` mù với nó. *Xem dải* của benchmark trả đúng dạng này. So theo GIÁ TRỊ, sai số tương
 * đối 1e-9, trên mọi số thập phân trong văn bản; trả các GIÁ (tổng) mà đơn giá quy đổi của chúng hiện ra. Hàm THUẦN để có đối chứng dương.
 */
function quetDonGiaQuyDoi(vanBan: string): readonly string[] {
  const so = [...vanBan.matchAll(/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gu)].map((m) => Number(m[0]));
  return MOI_GIA.filter((g) => {
    const k = Number(g) / (SO_LUONG_DONG * Number(HANG_CHUAN_CHINH.heSoTam));
    return so.some((x) => Math.abs(x - k) <= 1e-9 * k);
  });
}

/**
 * Bộ quét: mọi giá TÌM THẤY trong một văn bản, theo GIÁ TRỊ — không phải theo một chuỗi đã biết.
 * [sổ nợ 49 / review H2-4] Bản cũ là `includes` trên chuỗi thập phân: `980,000,000`, `9.8e8`, base64
 * đi lọt. Nay: rút số theo mọi cách viết; và mọi khối trông như base64 ~~(≥ 16 ký tự) được giải mã rồi
 * quét lại một lần~~ [review H4-11] base64, base64url (`-`/`_` — dạng token và cookie của dự án) hay HEX
 * (≥ 16 ký tự) được giải mã rồi quét lại, sâu HAI tầng. Vẫn KHÔNG bắt được rò THỨ TỰ (xếp hạng), và
 * không bắt mã hoá/nén khác ba dạng ấy — §4 của A2. Hàm THUẦN để có đối chứng dương.
 */
const SAU_TOI_DA = 2;
function quetRoRi(vanBan: string, sau = 0): readonly string[] {
  const thay = new Set<string>();
  for (const so of rutSo(vanBan)) {
    const g = GIA_SO.get(so);
    if (g !== undefined) thay.add(g);
  }
  if (sau < SAU_TOI_DA) {
    const khoi: { chuoi: string; ma: BufferEncoding }[] = [];
    for (const m of vanBan.matchAll(/[A-Za-z0-9+/]{16,}={0,2}/gu)) khoi.push({ chuoi: m[0], ma: "base64" });
    for (const m of vanBan.matchAll(/[A-Za-z0-9_-]{16,}/gu)) if (/[_-]/u.test(m[0])) khoi.push({ chuoi: m[0], ma: "base64url" });
    for (const m of vanBan.matchAll(/\b[0-9a-fA-F]{16,}\b/gu)) if (m[0].length % 2 === 0) khoi.push({ chuoi: m[0], ma: "hex" });
    for (const { chuoi, ma } of khoi) {
      let giaiMa: string;
      try {
        giaiMa = Buffer.from(chuoi, ma).toString("utf8");
      } catch {
        continue;
      }
      // Chỉ văn bản in được mới đáng quét lại — một phong bì nhị phân không phải chỗ giá đứng dạng rõ.
      if (/^[\x20-\x7e\s]+$/u.test(giaiMa)) for (const g of quetRoRi(giaiMa, sau + 1)) thay.add(g);
    }
  }
  return MOI_GIA.filter((g) => thay.has(g));
}

/** Trạng thái RFQ của kịch bản, đọc thẳng dưới vai superuser — không qua route nào. */
async function trangThaiRfq(): Promise<string> {
  const { rows } = await db.pool.query<{ status: string }>(
    "SELECT status FROM rfq_packages WHERE id = $1",
    [trangThai.rfqId],
  );
  return rows[0]?.status ?? "";
}

/**
 * [S1.164 / khoản 245] Số hàng sổ của một `action` trên gói thầu của kịch bản, và người ghi hàng MỚI NHẤT — đọc dưới vai superuser.
 * Ba lượt đọc giá (bảng so sánh, bảng xếp hạng, bộ bằng chứng) mỗi lượt để lại đúng một hàng; lần bị từ chối không để lại hàng nào.
 */
async function soHangDoc(action: string): Promise<{ n: number; nguoiMoiNhat: string | null }> {
  const { rows } = await db.pool.query<{ n: string; nguoi: string | null }>(
    "SELECT count(*) OVER ()::text AS n, actor_id AS nguoi FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3 ORDER BY seq DESC LIMIT 1",
    [orgA, action, trangThai.rfqId],
  );
  return { n: Number(rows[0]?.n ?? "0"), nguoiMoiNhat: rows[0]?.nguoi ?? null };
}

/** [S1.251 / S4.4b] Một quan sát của `GET /items/:itemId/price-history` — đúng những trường kịch bản này đọc. */
interface QuanSatHttp {
  readonly rfqId: string;
  readonly supplierId: string;
  readonly bidVersionId: string;
  readonly thanhTien: string | null;
  readonly donGia: string | null;
  readonly trangThai: string;
  readonly hoiTo: readonly string[];
  readonly sauMoc: Readonly<Record<string, number>>;
}

/** [S1.251 / S4.4b] Lịch sử giá của hàng chuẩn chính qua HTTP, dưới một cookie: phản hồi, và các quan sát của GÓI CHÍNH. */
async function docLichSuQuaHttp(cookie: string): Promise<{ ph: PhanHoi; tatCa: readonly QuanSatHttp[]; cuaGoi: readonly QuanSatHttp[] }> {
  const ph = await goi("GET", `/items/${trangThai.hangChuanId}/price-history`, cookie);
  const tatCa = ph.status === 200 ? (ph.body as { lichSuGia: { quanSat: QuanSatHttp[] } }).lichSuGia.quanSat : [];
  return { ph, tatCa, cuaGoi: tatCa.filter((q) => q.rfqId === trangThai.rfqId) };
}

/** [S1.251 / S4.4b] Số hàng `PRICE_HISTORY_READ` của hàng chuẩn chính, và người ghi hàng MỚI NHẤT — đọc dưới vai superuser. */
async function soHangLichSu(): Promise<{ n: number; nguoiMoiNhat: string | null }> {
  const { rows } = await db.pool.query<{ n: string; nguoi: string | null }>(
    "SELECT count(*) OVER ()::text AS n, actor_id AS nguoi FROM audit_events WHERE org_id = $1 AND action = 'PRICE_HISTORY_READ' AND resource_id = $2 ORDER BY seq DESC LIMIT 1",
    [orgA, trangThai.hangChuanId],
  );
  return { n: Number(rows[0]?.n ?? "0"), nguoiMoiNhat: rows[0]?.nguoi ?? null };
}

/** [S1.260 / S4.5c1] Benchmark của gói chính và *Xem dải* dòng 1 qua HTTP, dưới một cookie. */
async function docBenchmarkQuaHttp(cookie: string): Promise<{ bm: PhanHoi; dai: PhanHoi }> {
  return {
    bm: await goi("GET", `/rfqs/${trangThai.rfqId}/benchmark`, cookie),
    dai: await goi("GET", `/rfqs/${trangThai.rfqId}/items/1/benchmark`, cookie),
  };
}

/** [S1.260 / S4.5c1] Số hàng sổ của hai route benchmark trên gói chính — đọc dưới vai superuser. */
async function soHangBenchmark(): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action IN ('BENCHMARK_READ', 'BENCHMARK_BAND_READ') AND resource_id = $2",
    [orgA, trangThai.rfqId],
  );
  return Number(rows[0]?.n ?? "0");
}

const trangThai: {
  rfqId: string;
  /** [S1.201 / S3.6a] Luồng S3: nhóm hàng người tài chính dựng ở bước 1 — gói chính và hai gói hy sinh mang nó. */
  nhomHangId: string | null;
  loiMoi: { invitationId: string; supplierId: string; ten: string; gia: string; cookie: string }[];
  bienNhan: { canonicalText: string; signature: string; ten: string; bidVersionId: string }[];
  unsealRequestId: string;
  bafoRoundId: string;
  awardId: string;
  topN: string[];
  giaBafo: Map<string, string>;
  mua: Nguoi;
  pm2: Nguoi;
  pm3: Nguoi;
  gd1: Nguoi;
  gd2: Nguoi;
  taiChinh: Nguoi;
  /** [S1.174 / S3.1d] Luồng S3: người tài chính THỨ HAI — ký phiên bản mà `taiChinh` khai. */
  taiChinh2: Nguoi;
  /** [S1.157 / khoản 243] BUYER KHÔNG giữ `bid.view` — người bấm chấm ở bước 12b và 12g. */
  cham: Nguoi;
  /** [S1.251 / S4.4b] Người quản lý dữ liệu (`DATA_STEWARD`) — khai hàng chuẩn của dòng 1 ở bước 1; KHÔNG giữ `bid.view` (L3). */
  duLieu: Nguoi;
  /** [S1.251 / S4.4b] Hàng chuẩn của dòng 1 — khoá của lịch sử giá. */
  hangChuanId: string;
  /**
   * [S1.266 / S3.3c1] Luồng S3: ba nhà cung cấp ĐẾM ĐƯỢC phụ — dựng ở bộ quét, mời vào hai gói hy sinh và ba gói của bước 16 (K2
   * đòi hai ở bậc 0, ba ở bậc từ 100 triệu). Không ai trong số họ được mời vào gói chính.
   */
  nccPhu: { supplierId: string; contactId: string }[];
} = trangThaiMoi();

/** [S1.174 / S3.1d] Trạng thái rỗng của MỘT luồng — `dungToChuc` dựng lại nó trước mỗi luồng. */
function trangThaiMoi(): typeof trangThai {
  return {
  rfqId: "",
  nhomHangId: null,
  loiMoi: [],
  bienNhan: [],
  unsealRequestId: "",
  bafoRoundId: "",
  awardId: "",
  topN: [],
  giaBafo: new Map(),
  mua: { id: "", cookie: "" },
  pm2: { id: "", cookie: "" },
  pm3: { id: "", cookie: "" },
  gd1: { id: "", cookie: "" },
  gd2: { id: "", cookie: "" },
  taiChinh: { id: "", cookie: "" },
  taiChinh2: { id: "", cookie: "" },
  cham: { id: "", cookie: "" },
  duLieu: { id: "", cookie: "" },
  hangChuanId: "",
  nccPhu: [],
  };
}

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logLoi.push(args.map(String).join(" "));
  });
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
  dv = dichVuTest();
  ob = outboxTest(apiPool, dv.services);
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  gocMacDinh = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const s3 = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services, choKyChinhSach: true }));
  serverS3 = s3;
  await new Promise<void>((xong) => s3.listen(0, "127.0.0.1", xong));
  gocS3 = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
}, 240000);

/**
 * [S1.174 / S3.1d] Bối cảnh của MỘT luồng: tổ chức mới, máy chủ của luồng, và mọi người đăng nhập qua HTTP như trước —
 * luồng S3 thêm người tài chính thứ hai. Gọi ở `beforeAll` của từng luồng.
 */
async function dungToChuc(batS3: boolean): Promise<void> {
  goc = batS3 ? gocS3 : gocMacDinh;
  orgA = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      batS3 ? ["Cong ty Mua Sam A (S3)", "cong-ty-a-s3"] : ["Cong ty Mua Sam A", "cong-ty-a"],
    )
  ).rows[0]?.id ?? "";
  Object.assign(trangThai, trangThaiMoi());
  trangThai.mua = await dangNhap("mua@vidu.vn", "PROCUREMENT_MANAGER");
  trangThai.pm2 = await dangNhap("pm2@vidu.vn", "PROCUREMENT_MANAGER");
  trangThai.pm3 = await dangNhap("pm3@vidu.vn", "PROCUREMENT_MANAGER");
  trangThai.gd1 = await dangNhap("gd1@vidu.vn", "DIRECTOR");
  trangThai.gd2 = await dangNhap("gd2@vidu.vn", "DIRECTOR");
  // [033 / nợ 44] Ngưỡng phê duyệt kép do FINANCE đặt — PM (người đặt ước lượng, người duyệt) không được.
  trangThai.taiChinh = await dangNhap("taichinh@vidu.vn", "FINANCE");
  if (batS3) trangThai.taiChinh2 = await dangNhap("taichinh2@vidu.vn", "FINANCE");
  trangThai.duLieu = await dangNhap("dulieu@vidu.vn", "DATA_STEWARD");
}

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((xong) => server?.close(() => xong()));
  await new Promise<void>((xong) => (serverS3 === undefined ? xong() : serverS3.close(() => xong())));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

/**
 * [S1.266 / S3.3c1] Một hồ sơ nhà cung cấp và người liên hệ của nó qua HTTP, dưới cookie `nguoiDung` (người giữ `supplier.manage`
 * — chỉ PROCUREMENT_MANAGER); luồng S3 thêm lần XÁC MINH qua route của người tài chính thứ hai. Trả hai id.
 *
 * K2 chỉ đếm nhà cung cấp mà hồ sơ và người liên hệ KHÔNG do người tạo gói hay một người mời dựng, có MST và một xác minh còn hiệu
 * lực mà người xác minh không khai phiên bản chính sách gói ghim. Nên luồng S3 dựng bằng `pm3` — PM không tạo, không mời, không
 * nộp gói nào; ký đúng một gói (gói chính) mà `pm2` cũng ký, nên K5 của gói ấy vẫn có một chữ ký ngoài tập loại trừ — và xác minh
 * bằng `taiChinh2`: `taiChinh` khai phiên bản 1, `taiChinh2` chỉ ký nó. Người liên hệ có TRƯỚC lần xác minh (băm hồ sơ phủ nó).
 */
/** [S1.273 / S3.3e1] Băm hồ sơ hiện tại của một nhà cung cấp, đọc qua `GET /supplier-verifications` dưới phiên người xác minh. */
async function bamHoSoQuaHttp(cookie: string, supplierId: string): Promise<string> {
  const r = await goi("GET", "/supplier-verifications", cookie);
  expect(r.status, r.text).toBe(200);
  const h = (r.body as { hoSo: { supplierId: string; bamHoSo: string }[] }).hoSo.find((x) => x.supplierId === supplierId);
  expect(h, `hồ sơ ${supplierId} có trong danh sách xác minh`).toBeDefined();
  return h!.bamHoSo;
}

async function dungNccQuaHttp(
  nguoiDung: Nguoi,
  ncc: { readonly ten: string; readonly mst: string; readonly lienHe: string; readonly email: string; readonly phone: string },
  xacMinh: boolean,
): Promise<{ supplierId: string; contactId: string }> {
  const s = await goi("POST", "/suppliers", nguoiDung.cookie, { legalName: ncc.ten, taxCode: ncc.mst });
  expect(s.status, s.text).toBe(201);
  const supplierId = (s.body as { supplier: { id: string } }).supplier.id;
  const c = await goi("POST", `/suppliers/${supplierId}/contacts`, nguoiDung.cookie, { fullName: ncc.lienHe, email: ncc.email, phone: ncc.phone });
  expect(c.status, c.text).toBe(201);
  const contactId = (c.body as { contact: { id: string } }).contact.id;
  if (xacMinh) {
    // [S1.273 / S3.3e1] Lần xác minh mang băm hồ sơ người xác minh vừa thấy — như màn `/nha-cung-cap`.
    const xm = await goi("POST", `/suppliers/${supplierId}/verify`, trangThai.taiChinh2.cookie, {
      bamDaXem: await bamHoSoQuaHttp(trangThai.taiChinh2.cookie, supplierId),
    });
    expect(xm.status, xm.text).toBe(201);
    expect((xm.body as { verification: { conHieuLuc: boolean } }).verification.conHieuLuc, `xác minh của ${ncc.ten} còn hiệu lực`).toBe(true);
  }
  return { supplierId, contactId };
}

/**
 * [S1.190 / S3.2c1] Một nhà cung cấp, một người liên hệ, một lời mời qua HTTP — CHUNG cho hai luồng, chỉ khác LÚC gọi: luồng S3
 * gọi ở DRAFT, trước khi nộp duyệt (K4b); luồng MVP1 gọi sau khi mở, như trước. Trả thân `201` của lời mời.
 * [S1.266 / S3.3c1] Và khác NGƯỜI DỰNG hồ sơ: luồng S3 dựng nhà cung cấp ĐẾM ĐƯỢC (`dungNccQuaHttp` bằng `pm3`, xác minh) — K2 chặn
 * lần nộp gói 1 tỷ khi dưới năm; luồng MVP1 giữ nguyên người mua. MST, người liên hệ và người mời không đổi ở cả hai luồng.
 */
async function taoNccVaMoi(i: number, batS3: boolean): Promise<{ supplierId: string; invitation: { id: string; status: string; moiSauKhiKy: boolean } }> {
  const m = trangThai.mua.cookie;
  const ncc = NHA_CUNG_CAP[i]!;
  const { supplierId, contactId } = await dungNccQuaHttp(
    batS3 ? trangThai.pm3 : trangThai.mua,
    { ten: ncc.ten, mst: `03000000${i}${i}`, lienHe: `Kinh doanh ${i}`, email: `kd${i}@ncc.vn`, phone: `090000000${i}` },
    batS3,
  );
  const lm = await goi("POST", `/rfqs/${trangThai.rfqId}/invitations`, m, { supplierId, contactId });
  expect(lm.status, lm.text).toBe(201);
  return { supplierId, invitation: (lm.body as { invitation: { id: string; status: string; moiSauKhiKy: boolean } }).invitation };
}

/** [S1.174 / S3.1d] Hai luồng của spec S3 §8.11 — xem khối đầu tệp. */
const LUONG = [
  ["MVP1 — tổ chức CHƯA bật S3, cờ ký tắt", false],
  ["S3 — tổ chức ĐÃ BẬT qua route ký, cờ ký bật", true],
] as const;

/**
 * [S1.256 / S4.5b] Nhóm khoá `benchmark` đi qua `POST /policy` thật — mẫu của spec S4 §4.1. Lượt chấm của bước 12b vì thế GHI hàng
 * kết quả benchmark, và bộ quét giá ở cuối kịch bản chạy SAU một lần ghi thật (spec §2.5 ⒅).
 */
const BENCHMARK_KB41 = {
  cua_so_thang: "12",
  san_goi: "3",
  san_ncc: "3",
  nguong_lech_vua: "0.05",
  nguong_lech_cao: "0.10",
  phuong_phap: "TRUNG_VI_THEO_GOI_V1",
} as const;

/** [S1.174 / S3.1d] Ma trận bậc mặc định §4.1 và hai cột mức — thân `POST /policy` của luồng S3. */
const BAC_S3 = { tiers: BAC_MAC_DINH, chiaNhoCuaSoNgay: MUC_MAC_DINH.chiaNhoCuaSoNgay, thamDinhHieuLucThang: MUC_MAC_DINH.thamDinhHieuLucThang };

describe.each(LUONG)("[KỊCH BẢN 41 — QUA HTTP · %s] RFQ 1 tỷ, 5 nhà cung cấp, sửa giá, mở thầu phê duyệt kép, bảng so sánh", (_ten, batS3) => {
  beforeAll(() => dungToChuc(batS3), 240000);

  it("bước 1 — người mua dựng RFQ 1 tỷ qua HTTP và nó GIỮ yêu cầu phê duyệt kép", async () => {
    const m = trangThai.mua.cookie;
    expect((await goi("POST", "/policy", m, { version: 1, dualApprovalThreshold: "500000000.00", currency: "VND" })).status).toBe(403);
    // [S1.107 / lượt soi ngang 77 — CAO ②] Chính sách NAY khai trọng số qua HTTP. Trước vòng này
    // `createProcurementPolicy` không có đường ghi `eval_components`, nên mọi tổ chức tạo qua
    // sản phẩm đều KHÔNG chấm thầu được — và không cổng nào thấy, vì mọi fixture ghi SQL thẳng.
    const cs = await goi("POST", "/policy", trangThai.taiChinh.cookie, { version: 1, dualApprovalThreshold: "500000000.00", currency: "VND", evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }], bafoTopN: 2, benchmark: BENCHMARK_KB41, ...(batS3 ? BAC_S3 : {}) });
    expect(cs.status, cs.text).toBe(201);
    if (batS3) {
      // [S1.174 / S3.1d] Luồng S3: người tài chính THỨ HAI ký qua route ký (cờ bật) ⇒ lần ký đầu tiên của một phiên bản có
      // bậc BẬT S3 cho tổ chức. Mọi bước sau chạy dưới K1: ngân sách dưới đây ghim đúng bản vừa ký.
      const ky = await goi("POST", `/policy/${(cs.body as { policy: { id: string } }).policy.id}/sign`, trangThai.taiChinh2.cookie);
      expect(ky.status, ky.text).toBe(201);
      expect((ky.body as { chuKy: { daBat: boolean } }).chuKy.daBat).toBe(true);
    }
    if (batS3) {
      // [S1.201 / S3.6a] Người tài chính dựng nhóm hàng qua route (`category.manage`); người mua không dựng được — và gói của
      // tổ chức đã bật không nộp duyệt được khi thiếu nhóm hàng. Luồng MVP1: không nhóm hàng nào.
      expect((await goi("POST", "/categories", m, { ma: "THEP", ten: "Thep tam" })).status).toBe(403);
      const nhom = await goi("POST", "/categories", trangThai.taiChinh.cookie, { ma: "thep", ten: "Thep tam" });
      expect(nhom.status, nhom.text).toBe(201);
      trangThai.nhomHangId = (nhom.body as { nhomHang: { id: string } }).nhomHang.id;
    }
    const rfq = await goi("POST", "/rfqs", m, {
      title: "Mua thep tam SS400 quy IV",
      deadlineAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      ...(trangThai.nhomHangId === null ? {} : { categoryId: trangThai.nhomHangId }),
    });
    expect(rfq.status, rfq.text).toBe(201);
    expect((rfq.body as { rfq: { categoryId: string | null } }).rfq.categoryId).toBe(trangThai.nhomHangId);
    trangThai.rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/items`, m, { lineNo: 1, description: "Thep tam SS400 12mm", quantity: "100.0000", unit: "tam" })).status).toBe(201);
    // [S1.251 / S4.4b] Hàng chuẩn của dòng 1, khai qua HTTP bởi người quản lý dữ liệu TRƯỚC lần nộp (spec S4 §2.5 ⒅): bí danh đúng
    // mô tả của dòng ⇒ lượt chuẩn hoá sau commit của lần nộp ở bước 2 nối dòng ấy `TU_DONG`; quy đổi riêng tấm → kg.
    const dl = trangThai.duLieu.cookie;
    const hc = await goi("POST", "/items", dl, { ma: HANG_CHUAN_CHINH.ma, donViGoc: HANG_CHUAN_CHINH.donViGoc, ten: HANG_CHUAN_CHINH.ten });
    expect(hc.status, hc.text).toBe(201);
    trangThai.hangChuanId = (hc.body as { hangChuan: { id: string } }).hangChuan.id;
    const bd = await goi("POST", `/items/${trangThai.hangChuanId}/aliases`, dl, { biDanh: "Thep tam SS400 12mm" });
    expect(bd.status, bd.text).toBe(201);
    const qd = await goi("POST", `/items/${trangThai.hangChuanId}/conversions`, dl, { tuDonVi: "tam", sangDonVi: "kg", heSo: HANG_CHUAN_CHINH.heSoTam });
    expect(qd.status, qd.text).toBe(201);
    // [S1.272 / S4.6a] Người quản lý dữ liệu dán một mốc giá ngoài và một dòng lịch sử mua ngoài hệ thống cho hàng chuẩn này — cả
    // kịch bản sau đó (chấm, benchmark, BAFO, xuất bộ bằng chứng) chạy trong một thế giới CÓ dữ liệu ngoài; bước 14 quét hai kim.
    // [S1.276 / S4.6b] Ngày TƯƠNG ĐỐI theo lịch Việt Nam: S4.6b đọc hai bảng trong cửa sổ 12 tháng của phiên bản ghim, nên một ngày
    // viết cứng là quả bom hẹn giờ — rơi khỏi cửa sổ thì dải và mốc ngoài lặng lẽ rỗng mà kịch bản vẫn xanh ở mọi phép đo cũ.
    const ngayLui = async (n: number): Promise<string> =>
      (
        await db.pool.query<{ d: string }>(
          "SELECT ((timezone('UTC', clock_timestamp()) + interval '7 hours')::date - $1::int)::text AS d",
          [n],
        )
      ).rows[0]!.d;
    const mn = await goi("POST", "/external-references/import", dl, {
      vanBan: `ma_hang,don_gia,don_vi,tien_te,ngay_hieu_luc,nguon\n${HANG_CHUAN_CHINH.ma},${KIM_MOC_NGOAI},kg,VND,${await ngayLui(30)},Bang gia nha may\n`,
    });
    expect(mn.status, mn.text).toBe(201);
    const ls = await goi("POST", "/external-purchase-history/import", dl, {
      vanBan: `ma_hang,don_gia,don_vi,tien_te,ngay_mua,nha_cung_cap,nguon\n${HANG_CHUAN_CHINH.ma},${KIM_LICH_SU_NGOAI},kg,VND,${await ngayLui(60)},Cong ty Thep Ngoai,So mua 2025\n`,
    });
    expect(ls.status, ls.text).toBe(201);
    const ns = await goi("PUT", `/rfqs/${trangThai.rfqId}/budget`, m, { estimatedValue: NGAN_SACH, currency: "VND" });
    expect(ns.status, ns.text).toBe(200);
    expect((ns.body as { budget: { requiresDualApproval: boolean } }).budget.requiresDualApproval).toBe(true);
    // [S1.174 / S3.1d] Hai luồng khác nhau ĐÚNG ở đây, và phép đo nói ra điều ấy: tổ chức đã bật hay chưa, và gói mang bậc
    // nào — bậc 2 của §4.1 (từ 1 tỷ) cho ngân sách 1 tỷ ở luồng S3, không bậc ở luồng MVP1.
    const { rows: hai } = await db.pool.query<{ bat: boolean; bac: string | null }>(
      "SELECT public.to_chuc_da_bat_s3($1) AS bat, (SELECT tier_tu_so_tien::text FROM rfq_budgets WHERE rfq_id = $2) AS bac",
      [orgA, trangThai.rfqId],
    );
    expect(hai[0]).toEqual(batS3 ? { bat: true, bac: "1000000000.00" } : { bat: false, bac: null });
  });

  it("bước 2 — hai người KHÁC NHAU duyệt qua HTTP, rồi RFQ mở kèm cặp khoá của chính nó", async () => {
    const m = trangThai.mua.cookie;
    if (batS3) {
      // [S1.190 / S3.2c1 · INV-K4a · INV-K6] Luồng S3 dựng danh sách mời ở DRAFT, TRƯỚC khi nộp duyệt, vì chữ ký mang danh sách
      // lúc ký (K4b): mỗi lần mời trả `201` với lời mời `UNSENT`, không nhãn *mời sau khi ký*, và bộ gửi KHÔNG được gọi.
      const truoc = dv.loiMoiDaGui.length;
      for (const [i, ncc] of NHA_CUNG_CAP.entries()) {
        const { supplierId, invitation } = await taoNccVaMoi(i, true);
        expect({ status: invitation.status, moiSauKhiKy: invitation.moiSauKhiKy }).toEqual({ status: "UNSENT", moiSauKhiKy: false });
        trangThai.loiMoi.push({ invitationId: invitation.id, supplierId, ten: ncc.ten, gia: ncc.gia, cookie: "" });
      }
      expect(dv.loiMoiDaGui, "luồng S3: không link nào đi trước lần mở gói").toHaveLength(truoc);
    }
    const nop = await goi("POST", `/rfqs/${trangThai.rfqId}/submit`, m);
    expect(nop.status).toBe(200);
    // [S1.251 / S4.4b] Lượt chuẩn hoá sau commit của lần nộp đã nối dòng 1 với hàng chuẩn của bước 1 — TRƯỚC mọi mốc mở giá, nên
    // lịch sử giá về sau không mang nhãn hồi tố nào.
    const ax = await goi("GET", `/rfqs/${trangThai.rfqId}/mappings`, m);
    expect(ax.status, ax.text).toBe(200);
    expect((ax.body as { dong: { lineNo: number; trangThai: string; hangChuan: { id: string } | null }[] }).dong).toEqual([
      { lineNo: 1, trangThai: "TU_DONG", hangChuan: { id: trangThai.hangChuanId, ma: HANG_CHUAN_CHINH.ma }, lyDo: null },
    ]);
    // [S1.198 / khoản 256] Luồng S3: lời duyệt mang lần nộp người duyệt đã xem (thân `{lanNop}`). Luồng MVP1 giữ lời duyệt KHÔNG
    // thân — hợp đồng cũ, và đó là phép đo *tổ chức chưa bật không đổi*.
    const moc = batS3 ? { lanNop: (nop.body as { rfq: { lanNop: number } }).rfq.lanNop } : undefined;
    // [INV-D2] người tạo không tự duyệt được (trigger 011 — 422, và [review H2-10] đọc đúng LÝ DO), hai PM khác duyệt.
    // [S1.180 / khoản 247 / ADR-108] Tầng gói bắt lỗi của trigger theo TÊN ràng buộc, từ chối theo chốt — câu là của bảng
    // `CHOT_VAO_SO`, vẫn gọi tên `(D2)` — và để lại một hàng `CONTROL_DENIED`.
    const tuDuyet = await goi("POST", `/rfqs/${trangThai.rfqId}/approve`, m, moc);
    expect(tuDuyet.status).toBe(422);
    expect(tuDuyet.text).toContain("Người tạo gói thầu không được duyệt chính gói ấy — cần một người khác duyệt (D2).");
    const { rows: soD2 } = await db.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'CONTROL_DENIED' AND resource_id = $1 AND payload->>'ma' = 'D2_NGUOI_TAO_TU_DUYET'",
      [trangThai.rfqId],
    );
    expect(soD2, "lần tự duyệt ấy để lại đúng một hàng sổ").toHaveLength(1);
    // [S1.281 / S3.4a / K9] Luồng S3: hai người ký khai *không xung đột* trước — lời khai sống tới lần đề xuất trao thầu của `pm2`.
    if (batS3) {
      for (const ai of [trangThai.pm2, trangThai.pm3]) await khaiKhongXungDot(trangThai.rfqId, ai.cookie);
    }
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/approve`, trangThai.pm2.cookie, moc)).status).toBe(200);
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/approve`, trangThai.pm3.cookie, moc)).status).toBe(200);
    const guiTruocMo = dv.loiMoiDaGui.length;
    const mo = await goi("POST", `/rfqs/${trangThai.rfqId}/open`, m);
    expect(mo.status, mo.text).toBe(200);
    expect((mo.body as { rfq: { status: string } }).rfq.status).toBe("OPEN");
    // [S1.190 / S3.2c1 · INV-K6] Luồng S3: lần mở gói gửi ĐÚNG một link cho mỗi lời mời dựng ở DRAFT, không link nào hỏng, và mọi
    // lời mời thành `SENT`. Luồng MVP1: chưa có lời mời nào — không gửi gì, danh sách rỗng.
    expect((mo.body as { unsentInvitationIds: string[] }).unsentInvitationIds).toEqual([]);
    expect(dv.loiMoiDaGui.slice(guiTruocMo).map((l) => l.invitationId).sort()).toEqual(trangThai.loiMoi.map((l) => l.invitationId).sort());
    if (batS3) {
      const ds = await goi("GET", `/rfqs/${trangThai.rfqId}/invitations`, m);
      expect(ds.status, ds.text).toBe(200);
      expect((ds.body as { invitations: { status: string }[] }).invitations.map((x) => x.status)).toEqual(Array(NHA_CUNG_CAP.length).fill("SENT"));
    }
    const { rows } = await db.pool.query("SELECT algorithm FROM rfq_key_material WHERE rfq_id = $1", [trangThai.rfqId]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("bước 3 — mời năm nhà cung cấp qua HTTP; mỗi người đi trọn link → OTP → phiên khách qua HTTP", async () => {
    // [S1.190 / S3.2c1] Luồng S3: năm lời mời có từ DRAFT, link đi lúc mở gói — mỗi nhà cung cấp mở phiên bằng ĐÚNG link bộ gửi
    // nhận cho lời mời của mình. Luồng MVP1: mời bây giờ, link đi ngay lúc mời.
    for (const [i, ncc] of NHA_CUNG_CAP.entries()) {
      if (batS3) {
        const lm = trangThai.loiMoi[i]!;
        const link = dv.loiMoiDaGui.find((l) => l.invitationId === lm.invitationId);
        if (link === undefined) throw new Error(`luong S3: khong co link cho ${lm.ten}`);
        lm.cookie = await moPhienKhach(link.token);
        continue;
      }
      const truoc = dv.loiMoiDaGui.length;
      const { supplierId, invitation } = await taoNccVaMoi(i, false);
      expect(dv.loiMoiDaGui).toHaveLength(truoc + 1);
      const cookie = await moPhienKhach(dv.loiMoiDaGui.at(-1)!.token);
      trangThai.loiMoi.push({ invitationId: invitation.id, supplierId, ten: ncc.ten, gia: ncc.gia, cookie });
    }
    expect(trangThai.loiMoi).toHaveLength(5);
  });

  it("bước 4 — năm báo giá niêm phong ở phía nhà cung cấp, nộp qua HTTP, mỗi lần một biên nhận đã ký", async () => {
    for (const lm of trangThai.loiMoi) {
      const r = await goi("GET", "/guest/rfq", lm.cookie);
      expect(r.status, r.text).toBe(200);
      const khoa = (r.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256");
      if (khoa === undefined) throw new Error("RFQ khong co khoa ECDH_P256 qua HTTP");
      const phongBi = await sealBid({
        rfqId: trangThai.rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: new Uint8Array(Buffer.from(khoa.publicKey, "base64")),
        plaintext: new TextEncoder().encode(banRo(lm.gia, lm.ten)),
      });
      const bn = await goi("POST", "/guest/bids", lm.cookie, { envelope: Buffer.from(phongBi).toString("base64") });
      expect(bn.status, bn.text).toBe(201);
      const rc = (bn.body as { receipt: { version: number; canonicalText: string; signature: string; bidVersionId: string } }).receipt;
      expect(rc.version).toBe(1);
      expect(quetRoRi(bn.text), "phản hồi nộp thầu mang giá dạng rõ").toEqual([]);
      trangThai.bienNhan.push({ canonicalText: rc.canonicalText, signature: rc.signature, ten: lm.ten, bidVersionId: rc.bidVersionId });
    }
    expect(trangThai.bienNhan).toHaveLength(5);
  });

  it("bước 5 — [INV-B2] nhà cung cấp kiểm chứng biên nhận nhận qua HTTP bằng KHOÁ CÔNG KHAI MỘT MÌNH", async () => {
    for (const bn of trangThai.bienNhan) {
      expect(await verifyReceipt({ canonicalText: bn.canonicalText, signature: new Uint8Array(Buffer.from(bn.signature, "base64")), publicKey: dv.khoaKy.publicKey }), bn.ten).toBe(true);
    }
    const dau = trangThai.bienNhan[0]!;
    expect(await verifyReceipt({ canonicalText: dau.canonicalText.replace("version=1", "version=9"), signature: new Uint8Array(Buffer.from(dau.signature, "base64")), publicKey: dv.khoaKy.publicKey })).toBe(false);
    expect(createPublicKey({ key: Buffer.from(dv.khoaKy.publicKey), format: "der", type: "spki" }).asymmetricKeyType).toBe("ec");
  });

  it("bước 6 — [INV-B1] SỬA GIÁ trước hạn qua HTTP: version 2, bản cũ VẪN CÒN", async () => {
    const lm = trangThai.loiMoi[3]!;
    const r = await goi("GET", "/guest/rfq", lm.cookie);
    const khoa = (r.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256")!;
    const phongBi = await sealBid({
      rfqId: trangThai.rfqId,
      algorithm: "ECDH_P256",
      recipientPublicKey: new Uint8Array(Buffer.from(khoa.publicKey, "base64")),
      plaintext: new TextEncoder().encode(banRo(GIA_SUA_LAI, lm.ten)),
    });
    const bn2 = await goi("POST", "/guest/bids", lm.cookie, { envelope: Buffer.from(phongBi).toString("base64") });
    expect(bn2.status, bn2.text).toBe(201);
    expect((bn2.body as { receipt: { version: number } }).receipt.version).toBe(2);
    const ds = await goi("GET", "/guest/bids", lm.cookie);
    expect((ds.body as { bids: { versions: { version: number }[] }[] }).bids[0]?.versions.map((v) => v.version)).toEqual([1, 2]);
    lm.gia = GIA_SUA_LAI;
  });

  it("[INV-A1] [INV-A2] BỘ QUÉT RÒ RỈ: mọi route, bốn đối tượng, TRƯỚC mở thầu — không một chữ số giá nào ở thân, header, hay log", async () => {
    // Đối chứng dương TRƯỚC: bộ quét phải bắt được thứ nó đi tìm — theo GIÁ TRỊ, mọi cách viết (sổ nợ 49).
    expect(quetRoRi(JSON.stringify({ x: NHA_CUNG_CAP[0].gia }))).toEqual([NHA_CUNG_CAP[0].gia]);
    expect(quetRoRi(JSON.stringify({ x: 930000000 }))).toEqual([GIA_SUA_LAI]);
    for (const cachViet of ["980,000,000", "980.000.000", "980 000 000", "980,000,000.00", "9.8e8", "9.8E+8", "0.98e9"]) {
      expect(quetRoRi(`gia: ${cachViet} VND`), cachViet).toEqual([NHA_CUNG_CAP[0].gia]);
    }
    expect(quetRoRi(Buffer.from('{"totalAmount":"1400000000.00"}').toString("base64"))).toEqual(["1400000000.00"]);
    // [review H4-11] base64url (dạng token/cookie của dự án), hex, và hai tầng (base64 trong base64url).
    expect(quetRoRi(Buffer.from('{"gia":"980000000.00","k":">>>???"}').toString("base64url"))).toEqual([NHA_CUNG_CAP[0].gia]);
    expect(quetRoRi(Buffer.from('{"totalAmount":"1400000000.00"}').toString("hex"))).toEqual(["1400000000.00"]);
    expect(quetRoRi(Buffer.from(Buffer.from('{"gia":"980000000.00","k":">>>???"}').toString("base64")).toString("base64url"))).toEqual([NHA_CUNG_CAP[0].gia]);
    expect(quetRoRi("{}")).toEqual([]);
    expect(quetRoRi(JSON.stringify({ deadlineAt: "2026-09-07T10:00:00.000Z", id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", n: 98000000 }))).toEqual([]);
    // [S1.19 / CI run 34125062632] BA CA UUID PHẢI SẠCH — chúng là ca đã làm CI đỏ.
    // `98e7` và `14e8` nằm trong một chuỗi hex đọc ra 980 000 000 và 1 400 000 000, đúng hai giá
    // của kịch bản; và một mảnh UUID có thể ĐÚNG BẰNG `98e7`, khi ấy nó đứng giữa hai gạch nối.
    expect(quetRoRi(JSON.stringify({ id: "c98e7abc-1234-4567-89ab-000000000000" })), "98e7 trong hex").toEqual([]);
    expect(quetRoRi(JSON.stringify({ id: "abcd1234-98e7-4567-89ab-00000014e800" })), "98e7 là MỘT mảnh UUID").toEqual([]);
    expect(quetRoRi(JSON.stringify({ id: "0000000a-0000-4000-8000-0000c14e8abc" })), "14e8 trong hex").toEqual([]);
    // Và bộ quét KHÔNG được mất răng vì hai vế biên vừa thêm: một thân đúng năm phiên khách của
    // `GET /guest/session` mang một giá THẬT vẫn phải bị bắt.
    expect(
      quetRoRi(
        JSON.stringify({
          sessions: [{ guestSessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", tong: "980000000.00" }],
        }),
      ),
    ).toEqual([NHA_CUNG_CAP[0].gia]);

    const m = trangThai.mua.cookie;
    const k = trangThai.loiMoi[0]!.cookie;
    const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    // [sổ nợ 49 / review H2-4 ⑶] HAI RFQ HY SINH để route GHI được gọi với thân HỢP LỆ và đích THẬT, thay
    // vì `{}` (422 trước nghiệp vụ). `hyB` ở DRAFT đi qua items → budget → submit → approve → open theo
    // đúng thứ tự ROUTES; `hyA` đã OPEN kèm một lời mời và một phiên khách — cho route khách ghi (nộp
    // một phong bì THẬT với giá mồi KHÔNG thuộc bộ giá) và cho extend → close → unseal → approve/cancel.
    // Không chạm RFQ chính: bộ quét không được làm hỏng kịch bản nó đang bảo vệ.
    const GIA_MOI = "777000000.00";
    const taoRfqHy = async (ten: string): Promise<string> => {
      // [S1.201 / S3.6a] Luồng S3: gói hy sinh cũng mang nhóm hàng — nếu không, lần nộp duyệt của nó dừng ở chốt nhóm hàng.
      const r = await goi("POST", "/rfqs", m, {
        title: ten,
        deadlineAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
        ...(trangThai.nhomHangId === null ? {} : { categoryId: trangThai.nhomHangId }),
      });
      expect(r.status, r.text).toBe(201);
      return (r.body as { rfq: { id: string } }).rfq.id;
    };
    const hyA = await taoRfqHy("RFQ hy sinh A (mo)");
    expect((await goi("POST", `/rfqs/${hyA}/items`, m, { lineNo: 1, description: "Vat tu hy sinh", quantity: "1.0000", unit: "cai" })).status).toBe(201);
    expect((await goi("PUT", `/rfqs/${hyA}/budget`, m, { estimatedValue: "10000000.00", currency: "VND" })).status).toBe(200);
    // [S1.266 / S3.3c1] Luồng S3: K2 đòi HAI nhà cung cấp đếm được ở bậc 0 của hai gói hy sinh (và BA ở bậc từ 100 triệu của ba gói
    // bước 16) — trước vòng này hai gói hy sinh nộp duyệt không một lời mời nào. Ba nhà cung cấp PHỤ, dựng một lần như năm người của
    // gói chính (`pm3` dựng, `taiChinh2` xác minh), mời ở DRAFT bởi người mua. Lời mời hy sinh SAU lần mở (dưới) giữ nguyên: nó là
    // đích của route mời và route phát lại link. MST và số điện thoại xa mọi giá của bộ quét.
    // [S1.270 / S3.3d] NĂM nhà cung cấp phụ: bậc từ 100 triệu xoay vòng (`xoay_vong_n` = 5, K3), nên mỗi gói của bước 16 mời hai người
    // đầu cộng một người MỚI của riêng nó.
    if (batS3) {
      for (const k of [1, 2, 3, 4, 5]) {
        trangThai.nccPhu.push(
          await dungNccQuaHttp(
            trangThai.pm3,
            { ten: `NCC phu ${k}`, mst: `037700000${k}`, lienHe: `Kinh doanh phu ${k}`, email: `phu${k}@ncc.vn`, phone: `093770000${k}` },
            true,
          ),
        );
      }
      for (const n of trangThai.nccPhu.slice(0, 2)) {
        const lm = await goi("POST", `/rfqs/${hyA}/invitations`, m, n);
        expect(lm.status, lm.text).toBe(201);
      }
    }
    const nopHyA = await goi("POST", `/rfqs/${hyA}/submit`, m);
    expect(nopHyA.status).toBe(200);
    const mocHyA = batS3 ? { lanNop: (nopHyA.body as { rfq: { lanNop: number } }).rfq.lanNop } : undefined;
    if (batS3) await khaiKhongXungDot(hyA, trangThai.pm2.cookie);
    expect((await goi("POST", `/rfqs/${hyA}/approve`, trangThai.pm2.cookie, mocHyA)).status).toBe(200);
    expect((await goi("POST", `/rfqs/${hyA}/open`, m)).status).toBe(200);
    const nccHy = await goi("POST", "/suppliers", m, { legalName: "Cong ty Hy Sinh", taxCode: "0399999999" });
    expect(nccHy.status, nccHy.text).toBe(201);
    const nccHyId = (nccHy.body as { supplier: { id: string } }).supplier.id;
    const lhHy = await goi("POST", `/suppliers/${nccHyId}/contacts`, m, { fullName: "Lien he hy sinh", email: "hy@ncc.vn", phone: "0909999999" });
    expect(lhHy.status, lhHy.text).toBe(201);
    const lhHyId = (lhHy.body as { contact: { id: string } }).contact.id;
    const truocMoi = dv.loiMoiDaGui.length;
    const lmHy = await goi("POST", `/rfqs/${hyA}/invitations`, m, { supplierId: nccHyId, contactId: lhHyId });
    expect(lmHy.status, lmHy.text).toBe(201);
    expect(dv.loiMoiDaGui).toHaveLength(truocMoi + 1);
    const kHy = await moPhienKhach(dv.loiMoiDaGui.at(-1)!.token);
    const khoaHy = (await goi("GET", "/guest/rfq", kHy)).body as { publicKeys: { algorithm: string; publicKey: string }[] };
    const phongBiHy = await sealBid({
      rfqId: hyA,
      algorithm: "ECDH_P256",
      recipientPublicKey: new Uint8Array(Buffer.from(khoaHy.publicKeys.find((x) => x.algorithm === "ECDH_P256")!.publicKey, "base64")),
      plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: GIA_MOI, currency: "VND" })),
    });
    const hyB = await taoRfqHy("RFQ hy sinh B (nhap)");
    // [S1.266 / S3.3c1] Luồng S3: hai nhà cung cấp phụ cho gói hy sinh B, ở DRAFT — route nộp của bộ quét đi qua K2 như trước vòng
    // này đi qua mọi chốt, và chuỗi duyệt → mở → huỷ phía sau giữ nguyên.
    if (batS3) {
      for (const n of trangThai.nccPhu.slice(0, 2)) {
        const lm = await goi("POST", `/rfqs/${hyB}/invitations`, m, n);
        expect(lm.status, lm.text).toBe(201);
      }
    }
    const nanHy = await dangNhap("nan-hy@vidu.vn", "BUYER");
    // [S1.199 / S4.2b] Người quản lý dữ liệu HY SINH: tám route ghi dữ liệu nền đòi `item.manage`, và chỉ `DATA_STEWARD` giữ
    // mã ấy — gọi bằng `m` thì dừng ở 403 của cổng, tức route không đi tới nghiệp vụ.
    const quanLyHy = await dangNhap("quan-ly-hy@vidu.vn", "DATA_STEWARD");
    const hy: {
      unsealId: string; mfaResetId: string; policyId: string; nhomId: string; itemId: string; lanNopB: number;
      mocTay: string; loMoc: string; loLichSu: string;
    } = {
      unsealId: UUID0,
      mfaResetId: UUID0,
      policyId: UUID0,
      nhomId: UUID0,
      itemId: UUID0,
      lanNopB: 0,
      mocTay: UUID0,
      loMoc: UUID0,
      loLichSu: UUID0,
    };

    /** Thân + đích + người gọi hợp lệ cho MỖI route ghi; đọc kết quả để cho route sau một đích thật. */
    const thanHopLe = (r: (typeof ROUTES)[number]): { path: string; body: unknown; cookie: string; sau?: (ph: PhanHoi) => void } | null => {
      const han = new Date(Date.now() + 9 * 86400_000).toISOString();
      const tokenGia = "A".repeat(43); // đúng hình dạng base64url ≥ 32 ký tự, không tồn tại
      switch (`${r.method} ${r.path}`) {
        // Sáu route VÔ DANH mang credential trong thân: thân đúng hình dạng để qua bộ đọc thân và dừng ở
        // nghiệp vụ (token lạ ⇒ 422 có tên; email lạ ⇒ cùng một 200). Không dùng credential thật ở đây —
        // bộ quét không được tiêu thụ link/OTP của kịch bản nó đang bảo vệ.
        case "POST /guest/redeem":
          return { path: r.path, body: { orgId: orgA, token: tokenGia }, cookie: "" };
        case "POST /guest/otp":
          return { path: r.path, body: { orgId: orgA, token: tokenGia, channel: "EMAIL" }, cookie: "" };
        case "POST /guest/otp/verify":
          return { path: r.path, body: { orgId: orgA, token: tokenGia, code: "000000" }, cookie: "" };
        case "POST /auth/link":
          return { path: r.path, body: { orgId: orgA, email: "quet-vo-danh@vidu.vn" }, cookie: "" };
        case "POST /auth/redeem":
          return { path: r.path, body: { orgId: orgA, token: tokenGia }, cookie: "" };
        case "POST /auth/totp":
          return { path: r.path, body: { orgId: orgA, token: tokenGia, code: "000000" }, cookie: "" };
        case "POST /guest/bids":
          return { path: r.path, body: { envelope: Buffer.from(phongBiHy).toString("base64") }, cookie: kHy };
        // [S1.181 / ADR-109] Thoát phiên khách HY SINH — sau lần nộp của nó (bảng route đặt route thoát sau route nộp; nếu thứ
        // tự đổi, lần nộp ở trên gặp 401, không phải 422 hình dạng). Không đụng phiên của kịch bản.
        case "POST /guest/logout":
          return { path: r.path, body: {}, cookie: kHy };
        // [S1.287 / S3.7a1 / ADR-081] Ba bước vô danh của Passport — token lạ ⇒ 422 có tên, không tiêu thụ link nào.
        case "POST /guest/passport/redeem":
          return { path: r.path, body: { orgId: orgA, token: tokenGia }, cookie: "" };
        case "POST /guest/passport/otp":
          return { path: r.path, body: { orgId: orgA, token: tokenGia, channel: "SMS" }, cookie: "" };
        case "POST /guest/passport/otp/verify":
          return { path: r.path, body: { orgId: orgA, token: tokenGia, code: "000000" }, cookie: "" };
        // Hai route ghi của phiên Passport: kịch bản chưa mở phiên Passport nào (S3.7a2 sẽ đi đường ấy) ⇒ 401 trước bộ đọc thân; thân
        // vẫn đúng hình dạng để ngày có phiên thì nó chạm nghiệp vụ.
        case "POST /passport/versions":
          return {
            path: r.path,
            body: { legalName: "Quet", taxCode: "0101010101", nguoiDaiDien: "Quet", diaChi: "Quet", nganHang: "Quet", soTaiKhoan: "123456789", chungNhan: [], nhomHang: [] },
            cookie: "",
          };
        case "POST /passport/logout":
          return { path: r.path, body: {}, cookie: "" };
        // Yêu cầu hồ sơ cho một nhà cung cấp KHÔNG tồn tại, dưới phiên tài chính (`supplier.qualify`): qua cổng, dừng ở hàm vị từ với
        // mã có tên (chưa bật ⇒ `PASSPORT_TO_CHUC_CHUA_BAT`; đã bật ⇒ `PASSPORT_NCC_KHONG_HOP_LE`) — không link nào được đúc.
        case "POST /suppliers/:supplierId/passport-requests":
          return {
            path: `/suppliers/${UUID0}/passport-requests`,
            body: { contactId: UUID0 },
            cookie: trangThai.taiChinh.cookie,
            sau: (ph) => {
              expect([ph.status, (ph.body as { ma?: string }).ma]).toEqual([422, batS3 ? "PASSPORT_NCC_KHONG_HOP_LE" : "PASSPORT_TO_CHUC_CHUA_BAT"]);
            },
          };
        case "POST /policy":
          // ~~[S1.107] Bản v2 mà bộ quét tạo THÀNH bản hiệu lực, nên nó phải khai trọng số — nếu không,
          // bước 12b chấm thầu trên một chính sách không khai và dừng ở `CHINH_SACH_CHUA_KHAI_TRONG_SO`.~~
          // [S1.253 / S4.5a / L14] Tiền đề trên thôi đúng: lượt chấm đọc phiên bản hiệu lực lúc gói MỞ, và bản v2 này ra đời sau
          // bước 2 — bước 12b và 12g chấm dưới bản 1 (khai trọng số ở bước 1). Thân giữ trọng số để lời gọi tới được 201.
          return {
            path: r.path,
            // [S1.174 / S3.1d] Tổ chức đã bật từ chối phiên bản không bậc (`069`), nên luồng S3 gửi kèm bậc. Bản v2 ấy CHƯA
            // KÝ nên không hiệu lực: luồng S3 chấm thầu trên bản 1 — cũng khai trọng số ở bước 1.
            body: { version: 2, dualApprovalThreshold: "500000000.00", currency: "VND", evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }], bafoTopN: 2, benchmark: BENCHMARK_KB41, ...(batS3 ? BAC_S3 : {}) },
            cookie: trangThai.taiChinh.cookie,
            sau: (ph) => {
              if (ph.status === 201) hy.policyId = (ph.body as { policy: { id: string } }).policy.id;
            },
          };
        // [S1.169 / S3.1c] Lần ký đứng sau cờ triển khai (ADR-105), và bộ điều phối của kịch bản này không khai cờ ⇒ TẮT:
        // lời gọi qua cổng `policy.manage`, tới handler, và dừng ở 409 có tên — không ở một 422 hình dạng. Đích là bản v2 mà
        // ca ngay trên vừa tạo; cờ có mở thì lời gọi cũng dừng ở trigger (bản không bậc), không bật S3 cho tổ chức.
        // [S1.174 / S3.1d] Luồng S3 chạy trên máy chủ CỜ BẬT: lời gọi tới trigger, và người gọi chính là người khai bản v2
        // ⇒ 422 *"khong duoc tu ky"* có tên — bản v2 không thành hiệu lực, kịch bản không đổi chính sách giữa chừng.
        case "POST /policy/:policyId/sign":
          return { path: r.path.replace(":policyId", hy.policyId), body: {}, cookie: trangThai.taiChinh.cookie };
        // [S1.201 / S3.6a] Nhóm hàng HY SINH: người tài chính dựng, rồi ngừng dùng — không chạm nhóm của kịch bản. Bảng route đặt
        // hai route ấy trước `PUT /rfqs/:rfqId/category`, nên lần gán dưới gặp đúng nhóm đã ngừng dùng ở luồng MVP1.
        case "POST /categories":
          return {
            path: r.path,
            body: { ma: "QUET", ten: "Nhom quet" },
            cookie: trangThai.taiChinh.cookie,
            sau: (ph) => {
              if (ph.status === 201) hy.nhomId = (ph.body as { nhomHang: { id: string } }).nhomHang.id;
            },
          };
        case "PUT /categories/:categoryId/status":
          return { path: r.path.replace(":categoryId", hy.nhomId), body: { conDung: false }, cookie: trangThai.taiChinh.cookie };
        case "POST /suppliers":
          return { path: r.path, body: { legalName: "Cong ty Quet", taxCode: "0388888888" }, cookie: m };
        case "POST /suppliers/:supplierId/contacts":
          return { path: r.path.replace(":supplierId", nccHyId), body: { fullName: "Lien he quet", email: "quet@ncc.vn", phone: "0908888888" }, cookie: m };
        // [S1.196 / S3.3a / K8a] Xác minh nhà cung cấp HY SINH bằng tài chính (giữ `supplier.qualify`, không dựng hồ sơ ấy): luồng
        // S3 ghi một hàng xác minh của nhà cung cấp không ai mời trong kịch bản, luồng MVP1 dừng ở lời từ chối *tổ chức chưa bật*.
        // [S1.273 / S3.3e1] Thân mang băm hồ sơ đọc NGAY lúc gọi — route thêm người liên hệ của bộ quét chạy trước và đổi băm. Thân là
        // một lời hứa; vòng quét chờ nó trước khi gửi.
        case "POST /suppliers/:supplierId/verify":
          return {
            path: r.path.replace(":supplierId", nccHyId),
            body: bamHoSoQuaHttp(trangThai.taiChinh.cookie, nccHyId).then((bamDaXem) => ({ bamDaXem })),
            cookie: trangThai.taiChinh.cookie,
          };
        case "POST /suppliers/:supplierId/verification/revoke":
          return { path: r.path.replace(":supplierId", nccHyId), body: { reason: "thu hoi xac minh de quet" }, cookie: trangThai.taiChinh.cookie };
        case "POST /rfqs":
          return { path: r.path, body: { title: "RFQ quet", deadlineAt: han }, cookie: m };
        case "POST /rfqs/:rfqId/items":
          return { path: r.path.replace(":rfqId", hyB), body: { lineNo: 1, description: "Hang muc quet", quantity: "2.0000", unit: "cai" }, cookie: m };
        case "PUT /rfqs/:rfqId/budget":
          return { path: r.path.replace(":rfqId", hyB), body: { estimatedValue: "20000000.00", currency: "VND" }, cookie: m };
        // [S1.201 / S3.6a] Luồng S3: nhóm của kịch bản (còn dùng) — gói hy sinh B đi tiếp nộp duyệt như trước. Luồng MVP1: nhóm hy
        // sinh vừa ngừng dùng ⇒ 422 nghiệp vụ có tên, gói không đổi.
        case "PUT /rfqs/:rfqId/category":
          return { path: r.path.replace(":rfqId", hyB), body: { categoryId: trangThai.nhomHangId ?? hy.nhomId }, cookie: m };
        // [S1.284 / S4.7b1] Số ngày giao yêu cầu của gói hy sinh B ĐANG SOẠN — phiên bản của kịch bản không tính chi phí trễ, nên con
        // số chỉ đi vào chữ ký (băm số ngày giao, `112`); gói B nộp duyệt và được ký như trước, trên đúng con số này.
        case "PUT /rfqs/:rfqId/delivery-days":
          return { path: r.path.replace(":rfqId", hyB), body: { soNgayGiao: 30 }, cookie: m };
        case "POST /rfqs/:rfqId/submit":
          return {
            path: r.path.replace(":rfqId", hyB),
            body: {},
            cookie: m,
            sau: (ph) => {
              if (ph.status === 200) hy.lanNopB = (ph.body as { rfq: { lanNop: number } }).rfq.lanNop;
            },
          };
        // [S1.198 / khoản 256] Luồng S3 gửi lần nộp mà ca ngay trên vừa đọc; luồng MVP1 giữ thân rỗng — hợp đồng cũ.
        // [S1.281 / S3.4a / K9] Luồng S3: `pm2` khai *không xung đột* trên gói hy sinh B ngay trước khi ký — thân là một lời hứa, như
        // ca xác minh; lời khai ấy đi qua chính route khai báo (201).
        case "POST /rfqs/:rfqId/approve":
          return {
            path: r.path.replace(":rfqId", hyB),
            body: batS3 ? khaiKhongXungDot(hyB, trangThai.pm2.cookie).then(() => ({ lanNop: hy.lanNopB })) : {},
            cookie: trangThai.pm2.cookie,
          };
        // [S1.203 / S3.6b1 · K10a] Người duyệt thứ hai ghi nhận tín hiệu của gói hy sinh B — gói nhỏ, không tín hiệu nào ở cả hai
        // luồng, nên lời gọi qua cổng `rfq.approve`, qua bộ đọc thân, và dừng ở lời từ chối nghiệp vụ có tên của `KiemSoatError`.
        case "POST /rfqs/:rfqId/signals/acknowledge":
          return { path: r.path.replace(":rfqId", hyB), body: { lyDo: "ghi nhan de quet" }, cookie: trangThai.pm2.cookie };
        // [S1.285 / S3.6d · K10b] Ghi nhận tín hiệu KHAI THẤP trên gói hy sinh B bằng giám đốc (`po.approve`): gói B không có đề xuất
        // trao thầu nào ở cả hai luồng, nên lời gọi qua cổng quyền, qua bộ đọc thân, và dừng ở lời từ chối nghiệp vụ có tên.
        case "POST /rfqs/:rfqId/award/signals/acknowledge":
          return { path: r.path.replace(":rfqId", hyB), body: { lyDo: "ghi nhan khai thap de quet" }, cookie: trangThai.gd1.cookie };
        // [S1.281 / S3.4a / K9] Khai báo xung đột trên gói hy sinh B bằng `pm3` (không ký gói ấy): luồng S3 đi trọn tới 201; luồng
        // MVP1 dừng ở lời từ chối *tổ chức chưa bật* của trigger `coi_kiem_khai_bao` — 422 nghiệp vụ có tên, không 422 hình dạng.
        case "POST /rfqs/:rfqId/coi-declarations":
          return { path: r.path.replace(":rfqId", hyB), body: { trangThai: "KHONG_XUNG_DOT" }, cookie: trangThai.pm3.cookie };
        case "POST /rfqs/:rfqId/open":
          return { path: r.path.replace(":rfqId", hyB), body: {}, cookie: m };
        case "POST /rfqs/:rfqId/extend":
          return { path: r.path.replace(":rfqId", hyA), body: { reason: "gia han de quet", newDeadlineAt: han }, cookie: m };
        case "POST /rfqs/:rfqId/close":
          return { path: r.path.replace(":rfqId", hyA), body: { reason: "dong de quet" }, cookie: m };
        case "POST /rfqs/:rfqId/cancel":
          return { path: r.path.replace(":rfqId", hyB), body: { reason: "huy de quet" }, cookie: m };
        // [S1.186 / S3.2b1 / K4a] Bảng route đặt route này SAU route huỷ, nên gói hy sinh B đã HUỶ khi tới đây: luồng S3 dừng ở
        // lời từ chối trạng thái có tên, luồng MVP1 ở lời từ chối *tổ chức chưa bật* — cả hai là 422 NGHIỆP VỤ, không đổi gói nào.
        case "POST /rfqs/:rfqId/return-to-draft":
          return { path: r.path.replace(":rfqId", hyB), body: { reason: "tra ve de quet" }, cookie: m };
        // [S1.265 / S3.3b / K4a] Hai route ngoại lệ trên gói hy sinh B — bảng route đặt chúng sau route huỷ, nên gói B đã HUỶ: luồng
        // S3 dừng ở lời từ chối K4a có tên (422, vào sổ), luồng MVP1 ở lời từ chối *tổ chức chưa bật* (422). Rút một id không có:
        // trigger kiểm trạng thái gói TRƯỚC khi tìm ngoại lệ, nên cùng hai lời từ chối ấy. Không đổi gói nào của kịch bản.
        case "POST /rfqs/:rfqId/exceptions":
          return { path: r.path.replace(":rfqId", hyB), body: { loai: "SINGLE_SOURCE", maLyDo: "EMERGENCY", giaiTrinh: "khan cap de quet" }, cookie: m };
        case "POST /rfqs/:rfqId/exceptions/:exceptionId/withdraw":
          return { path: r.path.replace(":rfqId", hyB).replace(":exceptionId", UUID0), body: { reason: "rut de quet" }, cookie: m };
        case "POST /rfqs/:rfqId/invitations":
          return { path: r.path.replace(":rfqId", hyA), body: { supplierId: nccHyId, contactId: lhHyId }, cookie: m };
        case "POST /invitations/:invitationId/revoke":
          return { path: r.path.replace(":invitationId", UUID0), body: { reason: "thu hoi de quet" }, cookie: m };
        case "POST /invitations/:invitationId/unlock":
          return { path: r.path.replace(":invitationId", UUID0), body: { reason: "mo khoa de quet" }, cookie: m };
        // [S1.181 / ADR-110] Gửi lại link cho lời mời HY SINH — tới nghiệp vụ (200, hay 409 nếu gói hy sinh đã đóng), không chạm
        // lời mời nào của kịch bản.
        case "POST /invitations/:invitationId/reissue":
          return { path: r.path.replace(":invitationId", (lmHy.body as { invitation: { id: string } }).invitation.id), body: {}, cookie: m };
        case "POST /rfqs/:rfqId/unseal":
          return {
            path: r.path.replace(":rfqId", hyA),
            body: { reason: "mo thau RFQ hy sinh" },
            cookie: m,
            sau: (ph) => {
              if (ph.status === 201) hy.unsealId = (ph.body as { unsealRequest: { id: string } }).unsealRequest.id;
            },
          };
        case "POST /unseal/:unsealRequestId/approve":
          return { path: r.path.replace(":unsealRequestId", hy.unsealId), body: {}, cookie: trangThai.gd1.cookie };
        case "POST /unseal/:unsealRequestId/dispatch":
          return { path: r.path.replace(":unsealRequestId", hy.unsealId), body: {}, cookie: m };
        case "POST /unseal/:unsealRequestId/cancel":
          return { path: r.path.replace(":unsealRequestId", hy.unsealId), body: {}, cookie: m };
        // [S1.106 / S2.4] RFQ hy sinh B đang ở DRAFT, nên lượt chấm dừng ở
        // `RFQ_KHONG_CHAM_DUOC` — một 422 NGHIỆP VỤ có tên, đúng thứ bộ quét cần: thân đã qua
        // bộ đọc thân và chạm nghiệp vụ. Không dùng RFQ thật của kịch bản: một lượt chấm đổi
        // trạng thái gói thầu sang EVALUATING và bộ quét không được làm thế.
        case "POST /rfqs/:rfqId/evaluate":
          return { path: r.path.replace(":rfqId", hyB), body: {}, cookie: m };
        // [S1.109 / S2.5] Hai route BAFO đi tới `hyB` — một RFQ ở `DRAFT`, nên chúng dừng ở lời
        // TỪ CHỐI CÓ TÊN của `VongBafoTuChoiError` (422) chứ không ở một 422 hình dạng. Đó đúng
        // là thứ sổ nợ 49 đòi: route ghi phải đi TỚI nghiệp vụ, không dừng ở bộ đọc thân.
        case "POST /rfqs/:rfqId/bafo":
          return { path: r.path.replace(":rfqId", hyB), body: { deadlineAt: han }, cookie: m };
        case "POST /rfqs/:rfqId/bafo/close":
          return { path: r.path.replace(":rfqId", hyB), body: {}, cookie: m };
        // [S1.110 / S2.6] BA route trao thầu đi tới `hyB` — một RFQ ở `DRAFT` — nên chúng
        // dừng ở lời TỪ CHỐI CÓ TÊN của `TraoThauTuChoiError` (422), sau khi đã qua bộ đọc
        // thân và chạm nghiệp vụ. `bidVersionId` là `UUID0`: nó chỉ cần đúng HÌNH DẠNG, vì
        // phép kiểm trạng thái gói thầu nổ TRƯỚC khi câu `INSERT` chạm khoá ngoại nào.
        //
        // Hai route DUYỆT và HUỶ đi bằng cookie GIÁM ĐỐC, không `m`: cổng của chúng là
        // `po.approve`, và `PROCUREMENT_MANAGER` KHÔNG giữ mã ấy — dùng `m` sẽ cho một 403 ở
        // cổng quyền, tức route KHÔNG đi tới nghiệp vụ và bộ quét đo một thế giới rỗng.
        case "POST /rfqs/:rfqId/award":
          return { path: r.path.replace(":rfqId", hyB), body: { bidVersionId: UUID0, reason: "de xuat de quet" }, cookie: m };
        case "POST /rfqs/:rfqId/award/:awardId/approve":
          return { path: r.path.replace(":rfqId", hyB).replace(":awardId", UUID0), body: {}, cookie: trangThai.gd1.cookie };
        // [S1.261 / khoản 335] Route huỷ mang `awardId` trong đường dẫn, cùng khuôn route duyệt; `hyB` ở DRAFT nên lời từ chối
        // trạng thái nổ TRƯỚC phép so id.
        case "POST /rfqs/:rfqId/award/:awardId/cancel":
          return { path: r.path.replace(":rfqId", hyB).replace(":awardId", UUID0), body: { reason: "huy de quet" }, cookie: trangThai.gd1.cookie };
        // [S1.231 / khoản 232] Route RÚT đi bằng `m` (PROCUREMENT_MANAGER giữ `award.recommend`) tới `hyB` ở DRAFT ⇒ dừng ở
        // `TraoThauTuChoiError` 422 có tên, sau bộ đọc thân — cùng lý do ba route trên.
        case "POST /rfqs/:rfqId/award/withdraw":
          return { path: r.path.replace(":rfqId", hyB), body: { reason: "rut de quet" }, cookie: m };
        case "POST /users/:userId/mfa-reset":
          return {
            path: r.path.replace(":userId", nanHy.id),
            body: { reason: "mat may, quet" },
            cookie: m,
            sau: (ph) => {
              if (ph.status === 201) hy.mfaResetId = (ph.body as { mfaReset: { id: string } }).mfaReset.id;
            },
          };
        case "POST /mfa-resets/:requestId/approve":
          return { path: r.path.replace(":requestId", hy.mfaResetId), body: {}, cookie: trangThai.pm2.cookie };
        // [review H4-2] Yêu cầu ở trên đã được duyệt (tiêu thụ) trước khi tới đây ⇒ 422 nghiệp vụ có
        // tên — vẫn là "qua bộ đọc thân", đúng thứ bộ quét cần.
        case "POST /mfa-resets/:requestId/cancel":
          return { path: r.path.replace(":requestId", hy.mfaResetId), body: {}, cookie: m };
        // [S1.199 / S4.2b] Tám route dữ liệu nền, trên một hàng chuẩn HY SINH do ca đầu tạo — không hàng nào dính tới gói của
        // kịch bản. Bảng route đặt tạo → phiên bản → khai/rút bí danh → khai/rút quy đổi → khai/rút bí danh đơn vị, nên mỗi lần
        // rút có đúng hàng đang hiệu lực để rút: cả tám đi trọn tới 201.
        case "POST /items":
          return {
            path: r.path,
            body: { ma: "QUET-HY-SINH", donViGoc: "kg", ten: "Hang chuan quet" },
            cookie: quanLyHy.cookie,
            sau: (ph) => {
              if (ph.status === 201) hy.itemId = (ph.body as { hangChuan: { id: string } }).hangChuan.id;
            },
          };
        case "POST /items/:itemId/versions":
          return { path: r.path.replace(":itemId", hy.itemId), body: { ten: "Hang chuan quet ban 2" }, cookie: quanLyHy.cookie };
        case "POST /items/:itemId/aliases":
          return { path: r.path.replace(":itemId", hy.itemId), body: { biDanh: "hang quet hy sinh" }, cookie: quanLyHy.cookie };
        case "POST /items/:itemId/aliases/withdraw":
          return { path: r.path.replace(":itemId", hy.itemId), body: { biDanh: "hang quet hy sinh" }, cookie: quanLyHy.cookie };
        case "POST /items/:itemId/conversions":
          return { path: r.path.replace(":itemId", hy.itemId), body: { tuDonVi: "bao", sangDonVi: "kg", heSo: "50" }, cookie: quanLyHy.cookie };
        case "POST /items/:itemId/conversions/withdraw":
          return { path: r.path.replace(":itemId", hy.itemId), body: { tuDonVi: "bao", sangDonVi: "kg" }, cookie: quanLyHy.cookie };
        case "POST /uom/aliases":
          return { path: r.path, body: { biDanh: "bao quet", donVi: "kg" }, cookie: quanLyHy.cookie };
        case "POST /uom/aliases/withdraw":
          return { path: r.path, body: { biDanh: "bao quet" }, cookie: quanLyHy.cookie };
        // [S1.272 / S4.6a] Bảy route ghi dữ liệu ngoài, trên hàng chuẩn hy sinh. Thứ tự của bảng route: nhập tay → dán mốc → dán lịch
        // sử → rút lô mốc → rút lô lịch sử → rút hàng mốc → rút hàng lịch sử. Sáu route đi tới 201; route cuối rút một id không có
        // (không route nào trả id hàng của một lô dán) ⇒ 422 có tên `KHONG_CO_HANG_DU_LIEU`, tức vẫn qua bộ đọc thân.
        case "POST /items/:itemId/external-references":
          return {
            path: r.path.replace(":itemId", hy.itemId),
            body: { donGia: "12.5", donVi: "kg", tienTe: "VND", ngayHieuLuc: "2026-01-15", nguon: "Bang gia quet" },
            cookie: quanLyHy.cookie,
            sau: (ph) => {
              if (ph.status === 201) hy.mocTay = (ph.body as { moc: { hangId: string } }).moc.hangId;
            },
          };
        case "POST /external-references/import":
          return {
            path: r.path,
            body: { vanBan: "ma_hang,don_gia,don_vi,tien_te,ngay_hieu_luc,nguon\nQUET-HY-SINH,13.5,kg,VND,2026-01-16,Bang gia quet\n" },
            cookie: quanLyHy.cookie,
            sau: (ph) => {
              if (ph.status === 201) hy.loMoc = (ph.body as { lo: { loNhapId: string } }).lo.loNhapId;
            },
          };
        case "POST /external-purchase-history/import":
          return {
            path: r.path,
            body: { vanBan: "ma_hang,don_gia,don_vi,tien_te,ngay_mua,nha_cung_cap,nguon\nQUET-HY-SINH,14.5,kg,VND,2025-11-20,Cong ty quet,So quet\n" },
            cookie: quanLyHy.cookie,
            sau: (ph) => {
              if (ph.status === 201) hy.loLichSu = (ph.body as { lo: { loNhapId: string } }).lo.loNhapId;
            },
          };
        case "POST /external-references/batches/:batchId/withdraw":
          return { path: r.path.replace(":batchId", hy.loMoc), body: {}, cookie: quanLyHy.cookie };
        case "POST /external-purchase-history/batches/:batchId/withdraw":
          return { path: r.path.replace(":batchId", hy.loLichSu), body: {}, cookie: quanLyHy.cookie };
        case "POST /external-references/:rowId/withdraw":
          return { path: r.path.replace(":rowId", hy.mocTay), body: {}, cookie: quanLyHy.cookie };
        case "POST /external-purchase-history/:rowId/withdraw":
          return { path: r.path.replace(":rowId", UUID0), body: {}, cookie: quanLyHy.cookie };
        // [S1.234 / S4.3b] Ba route ghi ánh xạ, trên gói HY SINH A (đã nộp, đã đóng) và hàng chuẩn hy sinh ở trên — người quản lý
        // dữ liệu hy sinh không chạm gói nào nên nằm ngoài tập loại trừ. Lý do khai sẵn: nếu gói A đã có bản rõ, L13 đòi nó.
        case "POST /rfqs/:rfqId/normalize":
          return { path: r.path.replace(":rfqId", hyA), body: {}, cookie: quanLyHy.cookie };
        case "POST /rfqs/:rfqId/items/:lineNo/mapping":
          return {
            path: r.path.replace(":rfqId", hyA).replace(":lineNo", "1"),
            body: { hangChuanId: hy.itemId, lyDo: "anh xa de quet" },
            cookie: quanLyHy.cookie,
          };
        case "POST /rfqs/:rfqId/items/:lineNo/mapping/new-item":
          return {
            path: r.path.replace(":rfqId", hyA).replace(":lineNo", "1"),
            body: { ma: "QUET-HY-SINH-2", ten: "Hang chuan quet moi", donViGoc: "kg", lyDo: "tao moi de quet" },
            cookie: quanLyHy.cookie,
          };
        default:
          return null;
      }
    };
    const LOI_HINH_DANG = /thiếu trường|phải là|không phải ngày|không hợp lệ"?\s*$/u;

    // [S1.251 / S4.4b] `:itemId` là hàng chuẩn THẬT của dòng 1: lịch sử giá được hỏi trên đúng hàng có báo giá đã nộp (L6).
    // [rà soát S4.5c1] `:lineNo` là dòng THẬT `1`, không `UUID0`: *Xem dải* trước đây dừng ở 422 hình dạng của tham số — tức không
    // tới nghiệp vụ, và lượt quét trước mở thầu đo một thế giới rỗng. Chỉ route ĐỌC đi qua đây; route ghi mang `:lineNo` ở `thanHopLe`.
    const thay = (path: string) =>
      path
        .replace(":rfqId", trangThai.rfqId)
        .replace(":bidVersionId", trangThai.bienNhan[0]!.bidVersionId)
        .replace(":itemId", trangThai.hangChuanId)
        .replace(":lineNo", "1")
        .replace(/:[A-Za-z]+/gu, UUID0);
    // Cookie của route ĐỌC: khách ⇒ phiên khách; [S1.287 / S3.7a1] phiên Passport ⇒ không cookie (kịch bản chưa mở phiên Passport nào,
    // 401 trước nghiệp vụ); hồ sơ Passport của bên mua ⇒ phiên tài chính — cổng `supplier.qualify` nằm TRONG hàm, và đọc bằng phiên
    // `m` để lại một `PERMISSION_DENIED` ăn vào trần từ chối của phiên ấy (đo: bước 16 nhận 429 thay vì 422 ở lần tự ghi nhận).
    const cookieDoc = (r: (typeof ROUTES)[number]): string | undefined =>
      r.audience === "GUEST" ? k
      : r.audience === "PASSPORT" ? undefined
      : r.path === "/suppliers/:supplierId/passport" ? trangThai.taiChinh.cookie
      : m;
    const phanHoiDoc = new Map<string, PhanHoi>();
    const logTruoc = logLoi.length;
    const roRi: string[] = [];
    const loiHinhDang: string[] = [];
    let soGoi = 0;
    let soThanhCong = 0;
    for (const r of ROUTES) {
      if (r.audience === "BUYER" && r.mutates && r.self === true) continue; // đăng xuất — không tự bắn vào chân
      const laGhi = r.method !== "GET";
      const hopLe = laGhi ? thanHopLe(r) : null;
      if (laGhi && r.audience !== "PUBLIC") {
        expect(hopLe, `route ghi ${r.method} ${r.path} chưa có thân hợp lệ trong bộ quét (sổ nợ 49)`).not.toBeNull();
      }
      const cacCa: { path: string; cookie?: string; body?: unknown; sau?: (ph: PhanHoi) => void }[] =
        r.audience === "PUBLIC" ? [{ path: thay(r.path) }]
        : hopLe !== null
          ? [{ path: hopLe.path, ...(hopLe.cookie === "" ? {} : { cookie: hopLe.cookie }), body: hopLe.body, ...(hopLe.sau === undefined ? {} : { sau: hopLe.sau }) }]
          : [{ path: thay(r.path), cookie: cookieDoc(r) }];
      for (const ca of cacCa) {
        // [S1.273 / S3.3e1] Thân có thể là một lời hứa (ca xác minh đọc băm hồ sơ ngay lúc gọi) — chờ nó trước khi gửi.
        const than: unknown = r.method === "GET" ? undefined : await Promise.resolve(ca.body ?? {});
        const ph = await goi(r.method, ca.path, ca.cookie, than);
        soGoi += 1;
        if (!laGhi) phanHoiDoc.set(`${r.method} ${r.path}`, ph);
        ca.sau?.(ph);
        if (laGhi && ph.status < 300) soThanhCong += 1;
        if (laGhi && ph.status === 422 && LOI_HINH_DANG.test(ph.text)) loiHinhDang.push(`${r.method} ${r.path}: ${ph.text}`);
        const headerText = [...ph.headers.entries()].map(([a, b]) => `${a}: ${b}`).join("\n");
        for (const g of quetRoRi(ph.text + "\n" + headerText)) roRi.push(`${r.method} ${r.path} (${ph.status}): ${g}`);
      }
    }
    // [khoản 141] Số route bị bỏ qua SUY từ chính bảng, không viết cứng: vòng lặp trên bỏ MỌI
    // route tự thân, và S1.76 thêm cái thứ hai (`POST /auth/agent-session`). Con số `- 1` cũ
    // đúng khi chỉ có đăng xuất, và nó thiu lặng lẽ ngay khi lớp route ấy có thêm một thành viên.
    const soTuThan = ROUTES.filter((r) => r.audience === "BUYER" && r.mutates && r.self === true).length;
    expect(soTuThan, "không còn route tự thân nào — vòng lặp trên đã bỏ qua nhầm thứ gì đó").toBeGreaterThan(0);
    expect(soGoi).toBeGreaterThanOrEqual(ROUTES.length - soTuThan);
    // [sổ nợ 49] Không route ghi nào dừng ở 422 HÌNH DẠNG — mọi thân đều qua bộ đọc thân và chạm nghiệp vụ;
    // và ít nhất mười route ghi đi trọn tới 2xx trên RFQ hy sinh.
    expect(loiHinhDang, "route ghi dừng ở 422 hình dạng — thân chưa hợp lệ").toEqual([]);
    expect(soThanhCong).toBeGreaterThanOrEqual(10);
    for (const dong of logLoi.slice(logTruoc)) for (const g of quetRoRi(dong)) roRi.push(`log: ${g}`);
    expect(roRi, "giá dạng rõ lọt ra trước khi mở thầu").toEqual([]);
    // [rà soát S4.5c1] Hai route benchmark TỚI nghiệp vụ trên gói thật và trả trạng thái đóng có tên — không 422 hình dạng nào.
    for (const [duong, khoa] of [["GET /rfqs/:rfqId/benchmark", "benchmark"], ["GET /rfqs/:rfqId/items/:lineNo/benchmark", "dai"]] as const) {
      const ph = phanHoiDoc.get(duong);
      expect(ph?.status, `${duong}: ${ph?.text ?? "không gọi"}`).toBe(200);
      expect((ph?.body as Record<string, unknown>)[khoa]).toEqual({ trangThai: "KHONG_HIEN", rfqStatus: "OPEN" });
    }
    // Và trạng thái nghiệp vụ không bị bộ quét làm hỏng: RFQ vẫn OPEN, vẫn 5 lời mời.
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}`, m);
    expect((r.body as { rfq: { status: string } }).rfq.status).toBe("OPEN");
  });

  it("bước 7 — [INV-A6] trước khi đóng, số báo giá đã nhận bị GIẤU qua HTTP; sau khi đóng thì công bố", async () => {
    const m = trangThai.mua.cookie;
    const truoc = await goi("GET", `/rfqs/${trangThai.rfqId}/bid-count`, m);
    expect(truoc.status, truoc.text).toBe(200);
    expect((truoc.body as { bidCount: unknown }).bidCount).toEqual({ disclosed: false, reason: "STRICT_BLIND_BEFORE_CLOSE", rfqStatus: "OPEN" });
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/close`, m, { reason: "dong dung han theo ke hoach mua sam Q4" })).status).toBe(200);
    const sau = await goi("GET", `/rfqs/${trangThai.rfqId}/bid-count`, m);
    expect((sau.body as { bidCount: unknown }).bidCount).toEqual({ disclosed: true, count: 5 });
  });

  it("bước 8 — [INV-A4] RFQ đã CLOSED nhưng CHƯA mở thầu: bảng so sánh qua HTTP vẫn bị từ chối", async () => {
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
    expect(r.status).toBe(422);
    expect(quetRoRi(r.text)).toEqual([]);
    const { rows } = await withTenant(apiPool, orgA, (c) => c.query<{ n: string }>("SELECT count(*)::text AS n FROM rfq_unsealed_bids"));
    expect(rows[0]?.n).toBe("0");
  });

  it("bước 9 — [INV-D2] mở thầu cần HAI phê duyệt của HAI người qua HTTP, và người yêu cầu không tự duyệt", async () => {
    const yc = await goi("POST", `/rfqs/${trangThai.rfqId}/unseal`, trangThai.mua.cookie, { reason: "da het han nop, mo thau de cham" });
    expect(yc.status, yc.text).toBe(201);
    trangThai.unsealRequestId = (yc.body as { unsealRequest: { id: string; status: string } }).unsealRequest.id;
    expect((yc.body as { unsealRequest: { status: string } }).unsealRequest.status).toBe("PENDING");
    // Người yêu cầu (PM, không có rfq.unseal.approve) ⇒ 403 ngay ở dispatcher.
    expect((await goi("POST", `/unseal/${trangThai.unsealRequestId}/approve`, trangThai.mua.cookie)).status).toBe(403);
    const mot = await goi("POST", `/unseal/${trangThai.unsealRequestId}/approve`, trangThai.gd1.cookie);
    expect(mot.status, mot.text).toBe(200);
    expect((mot.body as { unsealRequest: { status: string } }).unsealRequest.status).toBe("PENDING");
    const hai = await goi("POST", `/unseal/${trangThai.unsealRequestId}/approve`, trangThai.gd2.cookie);
    expect((hai.body as { unsealRequest: { status: string } }).unsealRequest.status).toBe("APPROVED");
  });

  it("bước 10 — [INV-D1] cổng bốn vế cho qua qua HTTP, và `api` chỉ ĐẶT MỘT JOB chứ không giải mã", async () => {
    const dp = await goi("POST", `/unseal/${trangThai.unsealRequestId}/dispatch`, trangThai.mua.cookie);
    expect(dp.status, dp.text).toBe(200);
    expect((dp.body as { gate: { clauses: string[] } }).gate.clauses).toEqual(["PERMISSION", "MFA_FRESH", "RFQ_CLOSED", "POLICY_GATE"]);
    const { rows } = await db.pool.query<{ kind: string }>("SELECT kind FROM outbox_jobs WHERE payload->>'unsealRequestId' = $1", [trangThai.unsealRequestId]);
    // [S1.91 / khoản 194] Câu này TỪNG là `toEqual(["UNSEAL_RFQ"])`, và nó đỏ ở lượt evidence của vòng
    // khoản 194 vì `requestUnseal` nay xếp thêm một việc BÁO cho mỗi người duyệt — những việc ấy mang
    // cùng `unsealRequestId` nên lọt vào đúng câu SELECT này.
    //
    // Lời khai GỐC không sai, chỉ được viết hẹp hơn thứ nó muốn nói: *điều phối chỉ ĐẶT MỘT job GIẢI
    // MÃ, `api` không tự giải mã*. Vế ấy giữ nguyên độ sắc ở dòng đầu dưới đây — đúng MỘT `UNSEAL_RFQ`,
    // không phải "ít nhất một". Hai dòng sau nói thêm điều mới mà không nới vế cũ.
    expect(rows.filter((r) => r.kind === "UNSEAL_RFQ"), "điều phối đặt ĐÚNG MỘT việc giải mã").toHaveLength(1);
    expect(rows.filter((r) => r.kind === "UNSEAL_APPROVAL_NOTICE").length, "và ít nhất một tin báo người duyệt").toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.kind)), "không loại việc nào khác bám theo một yêu cầu mở thầu").toEqual(
      new Set(["UNSEAL_RFQ", "UNSEAL_APPROVAL_NOTICE"]),
    );
    // Bảng so sánh VẪN bị từ chối — điều phối không phải giải mã.
    expect((await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie)).status).toBe(422);
  });

  it("bước 11 — worker (KHÔNG qua HTTP, và đó là điểm mấu chốt) mở năm phong bì, lấy PHIÊN BẢN CUỐI", async () => {
    const kq = await withTenant(unsealPool, orgA, (c) => executeUnsealRequest(c, orgA, { unsealRequestId: trangThai.unsealRequestId, unwrapper: boMoBoc }, unsealPool));
    expect(kq.opened).toBe(5);
    expect(kq.failedBidVersionIds).toEqual([]);
  });

  it("bước 12 — BẢNG SO SÁNH qua HTTP: năm dòng, sắp theo giá, giá SỬA LẠI thắng — và đây là lần ĐẦU giá đi ra", async () => {
    const truocXem = await soHangDoc("COMPARISON_VIEWED");
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
    expect(r.status, r.text).toBe(200);
    // [S1.164 / khoản 245] Lần đầu giá đi ra cũng là lần đầu có một hàng `COMPARISON_VIEWED` — của đúng người đã đọc.
    const sauXem = await soHangDoc("COMPARISON_VIEWED");
    expect(sauXem.n - truocXem.n, "một lượt đọc bảng so sánh ⇒ đúng một hàng sổ").toBe(1);
    expect(sauXem.nguoiMoiNhat).toBe(trangThai.mua.id);
    const bang = (r.body as { comparison: { rfqStatus: string; rows: { supplierLegalName: string; totalAmount: string }[]; aggregates: { min: string; max: string; belowBudget: number } } }).comparison;
    expect(bang.rfqStatus).toBe("UNSEALED");
    const mongDoi = [...trangThai.loiMoi].sort((a, b) => Number(a.gia) - Number(b.gia));
    expect(bang.rows.map((x) => x.supplierLegalName)).toEqual(mongDoi.map((x) => x.ten));
    expect(bang.rows.map((x) => x.totalAmount)).toEqual(mongDoi.map((x) => x.gia));
    expect(bang.rows[0]?.totalAmount).toBe(GIA_SUA_LAI);
    expect(bang.aggregates.min).toBe(GIA_SUA_LAI);
    expect(bang.aggregates.max).toBe("1400000000.00");
    expect(bang.aggregates.belowBudget).toBe(2);
    // Sau UNSEALED, giá đi ra là ĐÚNG — bộ quét phải thấy nó, nếu không bộ quét mù.
    expect(quetRoRi(r.text).length).toBeGreaterThan(0);
  });

  it("[INV-L6] LỊCH SỬ GIÁ qua HTTP NGAY khi gói UNSEALED — người giữ bid.view THẤY năm quan sát (vị thế cuối, đơn giá = tổng / 100), mỗi lần đọc một hàng sổ; người không giữ bid.view và phiên khách thì không", async () => {
    // Đối chứng dương của bộ dò đơn giá, trên đúng cách Postgres in thương của phép chia `numeric` (đo trên 16-alpine).
    expect(quetDonGia(JSON.stringify({ donGia: "9300000.000000000000" }))).toEqual([GIA_SUA_LAI]);
    expect(quetRoRi(JSON.stringify({ donGia: "9300000.000000000000" }))).toEqual([]);
    expect(quetDonGia(JSON.stringify({ donGia: [9300000, 9220000] })), "mảng số trần (lượt soi L1)").toEqual([GIA_SUA_LAI, GIA_BAFO[1]]);
    expect(quetRoRi("[930000000,922000000]")).toEqual([GIA_SUA_LAI, GIA_BAFO[1]]);
    expect(await trangThaiRfq()).toBe("UNSEALED");
    const truoc = await soHangLichSu();
    const { ph, tatCa, cuaGoi } = await docLichSuQuaHttp(trangThai.mua.cookie);
    expect(ph.status, ph.text).toBe(200);
    // Mỗi nhà cung cấp một quan sát, ở vị thế CUỐI: người thứ tư là bản sửa giá, không phải bản đầu.
    const cuoi = trangThai.loiMoi.map((lm) => lm.gia).sort();
    expect(tatCa, "lúc này chỉ gói chính đã mở niêm phong").toEqual(cuaGoi);
    expect(cuaGoi.map((q) => q.thanhTien).sort()).toEqual(cuoi);
    for (const q of cuaGoi) {
      expect([q.trangThai, q.hoiTo, q.sauMoc], q.supplierId).toEqual(["HOP_LE", [], {}]);
      expect(Number(q.donGia)).toBe(Number(q.thanhTien) / SO_LUONG_DONG);
    }
    expect([...quetDonGia(ph.text)].sort(), "bộ quét phải THẤY đơn giá ngay khi gói UNSEALED").toEqual(cuoi);
    expect(quetDonGia(ph.text), "bản đầu của người sửa giá không phải một quan sát").not.toContain(NHA_CUNG_CAP[3].gia);
    const sau = await soHangLichSu();
    expect(sau.n - truoc.n, "một lần đọc lịch sử ⇒ đúng một hàng sổ").toBe(1);
    expect(sau.nguoiMoiNhat).toBe(trangThai.mua.id);
    const { rows: tai } = await db.pool.query<{ payload: unknown }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'PRICE_HISTORY_READ' AND resource_id = $2 ORDER BY seq DESC LIMIT 1",
      [orgA, trangThai.hangChuanId],
    );
    expect(quetRoRi(JSON.stringify(tai)), "hàng sổ đọc không mang giá").toEqual([]);
    expect(quetDonGia(JSON.stringify(tai))).toEqual([]);

    // Người quản lý dữ liệu không giữ `bid.view` (L3): 403. Phiên khách: route của người mua không mở cho cookie khách.
    const dl = await docLichSuQuaHttp(trangThai.duLieu.cookie);
    expect(dl.ph.status).toBe(403);
    for (const k of [dl.ph, ...(await Promise.all(trangThai.loiMoi.map((lm) => goi("GET", `/items/${trangThai.hangChuanId}/price-history`, lm.cookie))))]) {
      expect(k.status).not.toBe(200);
      expect([...quetRoRi(k.text), ...quetDonGia(k.text)]).toEqual([]);
    }
    expect((await soHangLichSu()).n, "lần bị từ chối không ghi hàng đọc").toBe(sau.n);
    // Hàng chuẩn không có trong tổ chức ⇒ 404 sau cổng; đường dẫn sai hình dạng ⇒ 404 trước handler. Không hàng đọc nào.
    expect((await goi("GET", "/items/3f2504e0-4f89-11d3-9a0c-0305e82c3301/price-history", trangThai.mua.cookie)).status).toBe(404);
    expect((await goi("GET", "/items/khong-phai-uuid/price-history", trangThai.mua.cookie)).status).toBe(404);
    expect((await soHangLichSu()).n).toBe(sau.n);
  });

  it("[INV-L6] [S1.260 / S4.5c1] BENCHMARK qua HTTP NGAY khi gói UNSEALED — lần đọc đầu tính và lưu, nhãn không mang giá; Xem dải THẤY đơn giá quy đổi của gói; người không giữ bid.view và phiên khách thì không", async () => {
    expect(await trangThaiRfq()).toBe("UNSEALED");
    const truoc = await soHangBenchmark();
    const { bm, dai } = await docBenchmarkQuaHttp(trangThai.mua.cookie);
    expect(bm.status, bm.text).toBe(200);
    const b = (bm.body as { benchmark: { trangThai: string; nguon: string; bafoRoundId: string | null; dong: { nhan: string }[] } }).benchmark;
    expect([b.trangThai, b.nguon, b.bafoRoundId]).toEqual(["CO", "TINH_MOI", null]);
    expect(b.dong.length).toBeGreaterThan(0);
    for (const d of b.dong) expect(["BINH_THUONG", "LECH_VUA", "LECH_CAO", "CHUA_DU_LICH_SU", "KHONG_DO_DUOC"]).toContain(d.nhan);
    expect([...quetRoRi(bm.text), ...quetDonGia(bm.text), ...quetDonGiaQuyDoi(bm.text)], "bản lưu và nhãn không mang con số tiền nào").toEqual([]);
    // Đối chứng dương của bộ quét quy đổi, trên đúng cách Postgres in thương của phép chia `numeric` (đo trên 16-alpine).
    const { rows: pg } = await db.pool.query<{ v: string }>("SELECT ($1::numeric / ($2::numeric * $3::numeric))::text AS v", [
      GIA_SUA_LAI, "100.0000", HANG_CHUAN_CHINH.heSoTam,
    ]);
    expect(quetDonGiaQuyDoi(JSON.stringify({ donGiaQuyDoi: pg[0]!.v }))).toEqual([GIA_SUA_LAI]);
    expect(quetDonGia(JSON.stringify({ donGiaQuyDoi: pg[0]!.v })), "bộ quét đơn giá thô MÙ với đơn giá quy đổi").toEqual([]);
    // Đối chứng dương: route *Xem dải* trả giá quy đổi của CHÍNH gói — bộ quét quy đổi phải THẤY năm đơn giá vị thế cuối.
    expect(dai.status, dai.text).toBe(200);
    expect((dai.body as { dai: { trangThai: string } }).dai.trangThai).toBe("CO");
    const cuoi = trangThai.loiMoi.map((lm) => lm.gia).sort();
    expect([...quetDonGiaQuyDoi(dai.text)].sort(), "bộ quét phải THẤY đơn giá quy đổi ở Xem dải ngay khi gói UNSEALED").toEqual(cuoi);
    // [S1.276 / S4.6b — L15 vế ĐỌC] Dữ liệu ngoài của bước 1 đi qua đường đọc `bid.view`: bản lưu mang nhãn ngoài (một dòng lịch sử
    // ⇒ dưới sàn) và cờ mốc ngoài KHÔNG con số; Xem dải THẤY mốc ngoài theo kg (đối chứng dương của bộ đọc giá) và dải ngoài một dòng
    // không con số; mỗi báo giá có độ lệch so với mốc.
    const bn = (bm.body as { benchmark: { dongNgoai: { nhan: string; soDong: number }[] | null; mocNgoai: { nguon: string }[] } }).benchmark;
    expect(bn.dongNgoai?.length, "mỗi (báo giá, dòng) đo được một nhãn ngoài").toBe(b.dong.filter((d) => d.nhan !== "KHONG_DO_DUOC").length);
    for (const d of bn.dongNgoai ?? []) expect([d.nhan, d.soDong]).toEqual(["CHUA_DU_LICH_SU", 1]);
    expect(bn.mocNgoai.map((m) => m.nguon)).toEqual(["Bang gia nha may"]);
    expect(bm.text, "bản lưu và cờ mốc không mang kim ngoài").not.toContain(KIM_MOC_NGOAI);
    expect(bm.text).not.toContain(KIM_LICH_SU_NGOAI);
    const dn = (
      dai.body as {
        dai: {
          daiNgoai: { soDong: number; duSan: boolean; trungVi: string | null }[];
          mocNgoai: { moc: { donGiaQuyDoi: string } | null }[];
          giaCuaGoi: { donGiaQuyDoi: string | null; lechMoc: string | null }[];
        };
      }
    ).dai;
    expect(dn.daiNgoai.map((x) => [x.soDong, x.duSan, x.trungVi])).toEqual([[1, false, null]]);
    expect(Number(dn.mocNgoai[0]?.moc?.donGiaQuyDoi), "bộ đọc giá dưới `bid.view` THẤY mốc ngoài").toBe(Number(KIM_MOC_NGOAI));
    expect(dn.giaCuaGoi.filter((g) => g.donGiaQuyDoi !== null).every((g) => g.lechMoc !== null)).toBe(true);
    expect(await soHangBenchmark(), "mỗi lần đọc một hàng sổ").toBe(truoc + 2);
    const { rows: tai } = await db.pool.query<{ payload: unknown }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action IN ('BENCHMARK_READ', 'BENCHMARK_BAND_READ') AND resource_id = $2",
      [orgA, trangThai.rfqId],
    );
    expect([...quetRoRi(JSON.stringify(tai)), ...quetDonGia(JSON.stringify(tai))], "hàng sổ không mang giá").toEqual([]);
    const lai = await goi("GET", `/rfqs/${trangThai.rfqId}/benchmark`, trangThai.mua.cookie);
    expect((lai.body as { benchmark: { nguon: string } }).benchmark.nguon, "lần đọc sau đọc bản lưu").toBe("BAN_LUU");

    // Người quản lý dữ liệu không giữ `bid.view`: 403 ở cả hai route. Phiên khách: route của người mua không mở cho cookie khách.
    const dl = await docBenchmarkQuaHttp(trangThai.duLieu.cookie);
    expect([dl.bm.status, dl.dai.status]).toEqual([403, 403]);
    for (const lm of trangThai.loiMoi) {
      const k = await docBenchmarkQuaHttp(lm.cookie);
      for (const ph of [k.bm, k.dai]) {
        expect(ph.status).not.toBe(200);
        expect([...quetRoRi(ph.text), ...quetDonGia(ph.text), ...quetDonGiaQuyDoi(ph.text)]).toEqual([]);
      }
    }
  });

  it("bước 12b — CHẤM THẦU qua HTTP: `POST /evaluate` rồi `GET /ranking`, và THÀNH PHẦN đi ra tới người đọc", async () => {
    // [S1.107 / lượt soi ngang 77 — CAO ②] Bước này KHÔNG dựng được trước vòng này: không đường
    // sản xuất nào ghi `eval_components`, nên `POST /evaluate` của S1.106 luôn trả 422 ngoài cụm
    // test. Đây là phép đo đầu tiên đi TRỌN đường chấm thầu bằng HTTP, trên chính sách mà người
    // mua tạo qua HTTP.
    const m = trangThai.mua.cookie;
    // [S1.157 / khoản 243] Người BẤM CHẤM là một BUYER KHÔNG giữ `bid.view` (`005`): vai mà
    // `evaluation.perform` cho qua còn cổng đọc giá thì không. Trước khoản 243 thân phản hồi của
    // lần bấm ấy mang nguyên `lines` — giá và hạng của cả năm báo giá — tức một đường đọc thứ hai
    // của `rfq_evaluation_lines` mà ADR-054 không khai. Bảng xếp hạng đọc qua `GET /ranking` dưới
    // `m` (PROCUREMENT_MANAGER, giữ `bid.view`).
    trangThai.cham = await dangNhap("cham-khong-xem@vidu.vn", "BUYER");
    // [S1.281 / S3.4a / K9] Luồng S3: người bấm chấm khai *không xung đột* trước lượt chấm — lời khai sống tới lượt chấm lại (12g).
    if (batS3) await khaiKhongXungDot(trangThai.rfqId, trangThai.cham.cookie);
    const r = await goi("POST", `/rfqs/${trangThai.rfqId}/evaluate`, trangThai.cham.cookie, {});
    expect(r.status, r.text).toBe(201);
    const ld = (r.body as { evaluation: { evaluationId: string; currency: string } }).evaluation;
    expect(ld.currency).toBe("VND");
    expect(Object.keys(ld).sort(), "thân của lần bấm chấm là danh sách trắng").toEqual(["currency", "evaluationId", "policyId", "policyVersion"]);
    expect(quetRoRi(r.text + "\n" + [...r.headers.entries()].map(([a, b]) => `${a}: ${b}`).join("\n")), "lần bấm chấm KHÔNG trả một mức giá nào").toEqual([]);
    // Và cổng đọc đứng đúng chỗ: người bấm chấm không có `bid.view` thì không đọc được bảng xếp hạng.
    const truocXem = await soHangDoc("RANKING_VIEWED");
    expect((await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, trangThai.cham.cookie)).status).toBe(403);
    expect((await soHangDoc("RANKING_VIEWED")).n, "[S1.164 / khoản 245] lần bị từ chối KHÔNG phải một lượt đọc").toBe(truocXem.n);

    const bxh = await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, m);
    expect(bxh.status, bxh.text).toBe(200);
    const sauXem = await soHangDoc("RANKING_VIEWED");
    expect(sauXem.n - truocXem.n, "[S1.164 / khoản 245] một lượt đọc bảng xếp hạng ⇒ đúng một hàng sổ").toBe(1);
    expect(sauXem.nguoiMoiNhat).toBe(trangThai.mua.id);
    const bang = (bxh.body as {
      ranking: {
        evaluationId: string;
        rows: { supplierName: string; effectiveCost: string | null; rank: number | null; components: { ma: string; tien: string | null }[] }[];
      };
    }).ranking;
    expect(bang.evaluationId).toBe(ld.evaluationId);
    expect(bang.rows).toHaveLength(5);
    expect([...bang.rows].map((x) => x.rank).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5]);
    const mongDoi = [...trangThai.loiMoi].sort((a, b) => Number(a.gia) - Number(b.gia));
    expect(bang.rows.map((x) => x.supplierName)).toEqual(mongDoi.map((x) => x.ten));
    expect(bang.rows[0]?.effectiveCost).toBe(GIA_SUA_LAI);
    // VẾ CHỊU LỰC của cả S2.4: mỗi hàng mang THÀNH PHẦN sinh ra con số. Hệ số là `1.0000`, nên
    // `tien` phải bằng chính `effectiveCost` — một bảng chỉ hiện tổng thì J2 là lời hứa rỗng.
    for (const h of bang.rows) {
      expect(h.components, JSON.stringify(h)).toHaveLength(1);
      expect(h.components[0]?.ma).toBe("gia");
      expect(h.components[0]?.tien).toBe(h.effectiveCost);
    }

    // Chấm LẦN HAI dừng ở một từ chối CÓ TÊN: cạnh `UNSEALED->EVALUATING` đã đi qua một lần.
    const lai = await goi("POST", `/rfqs/${trangThai.rfqId}/evaluate`, m, {});
    expect(lai.status, lai.text).toBe(422);
    expect(lai.text).toContain("UNSEALED");
  });

  it("[INV-A2] [INV-A5] [INV-A4] BỘ QUÉT RÒ RỈ LẦN HAI — SAU mở thầu, khi bản rõ ĐÃ nằm trong CSDL: năm phiên khách và một người mua KHÔNG có bid.view đọc mọi route đọc — không giá nào lọt", async () => {
    // [review H2-4 ⑴⑷] Vòng quét thứ nhất chạy TRƯỚC mở thầu, khi bản rõ giá chưa tồn tại phía máy chủ —
    // không route nào rò được thứ chưa có. Vòng này chạy ở cửa sổ có nghĩa: `rfq_unsealed_bids` đã có
    // năm hàng, và người đọc là đúng hai đối tượng A5/A4 nói tới. Đối chứng dương ngay trên: bước 12
    // thấy giá với người có `bid.view`.
    const khongXem = await dangNhap("khongxem@vidu.vn", "BUYER"); // BUYER không có bid.view (005)
    const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    // [S1.260 / S4.5c1] `:lineNo` ⇒ dòng 1 có thật — để lượt quét hỏi đúng *Xem dải* của gói (lượt chỉ GET).
    const thay = (path: string) =>
      path.replace(":rfqId", trangThai.rfqId).replace(":unsealRequestId", trangThai.unsealRequestId).replace(":itemId", trangThai.hangChuanId).replace(":lineNo", "1").replace(/:[A-Za-z]+/gu, UUID0);
    const roRi: string[] = [];
    let soGoi = 0;
    for (const r of ROUTES) {
      if (r.method !== "GET") continue;
      const cookies =
        r.audience === "GUEST" ? trangThai.loiMoi.map((lm) => lm.cookie)
        : r.audience === "BUYER" ? [khongXem.cookie]
        : [];
      for (const cookie of cookies) {
        const path = r.audience === "GUEST" && r.path.includes(":bidVersionId")
          ? r.path.replace(":bidVersionId", trangThai.bienNhan.find((b) => trangThai.loiMoi.some((lm) => lm.cookie === cookie && lm.ten === b.ten))?.bidVersionId ?? UUID0)
          : thay(r.path);
        const ph = await goi(r.method, path, cookie);
        soGoi += 1;
        const headerText = [...ph.headers.entries()].map(([a, b]) => `${a}: ${b}`).join("\n");
        for (const g of quetRoRi(ph.text + "\n" + headerText)) roRi.push(`${r.method} ${r.path} (${ph.status}): ${g}`);
        // [S1.260 / S4.5c1] Và đơn giá — thô và quy đổi về đơn vị gốc — không lọt qua route nào tới người không được xem.
        for (const g of [...quetDonGia(ph.text), ...quetDonGiaQuyDoi(ph.text)]) roRi.push(`${r.method} ${r.path} (${ph.status}) đơn giá: ${g}`);
      }
    }
    expect(soGoi).toBeGreaterThan(5 * 4 + 8);
    expect(roRi, "giá dạng rõ lọt ra SAU mở thầu tới người không được xem").toEqual([]);
    // Và cổng bid.view thật sự đóng với người này (403), không phải "rỗng vì chưa có gì".
    expect((await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, khongXem.cookie)).status).toBe(403);
  });

  // ==============================================================================================
  // [S1.109 / S2.5] VÒNG BAFO QUA HTTP — và **J4**, bất biến mà cả vòng này sinh ra để đo.
  //
  // J4: *"Báo giá BAFO niêm phong đúng như vòng một: không route nào trả một mức giá BAFO trước
  // khi vòng ấy được mở qua cổng bốn vế."* Khoản **227** ghi vì sao nó KHÔNG đo được ở S1.108:
  // nó là một vòng quét ROUTE, và quét khi chưa route nào tồn tại cho ra một cổng XANH trên tập
  // RỖNG — đúng cái bẫy lượt soi ngang 77 gọi tên.
  //
  // Vế người đọc ở đây RỘNG HƠN lượt quét lần hai một cách có chủ đích: lần hai hỏi *"người
  // KHÔNG có `bid.view` thấy gì"*, còn J4 hỏi *"NGƯỜI MUA CÓ ĐỦ QUYỀN thấy gì"* — vì lời hứa của
  // BAFO là niêm phong với CHÍNH NGƯỜI MUA cho tới khi cổng bốn vế chạy. Một bộ quét chỉ soi
  // người không quyền sẽ xanh kể cả khi giá BAFO nằm sẵn trong bảng so sánh.
  //
  // ------------------------------------------------------------------------------------------
  // VÌ SAO BA CA DƯỚI ĐÂY **KHÔNG** MANG NHÃN bất biến của nhóm J, dù chúng có đủ ba thứ spec §5 đòi
  // (phép đo thật, đối chứng dương, đột biến giết được nó)
  // ------------------------------------------------------------------------------------------
  // Vì cho một mã J vào sổ đăng ký là một đổi thay của CỖ MÁY BẰNG CHỨNG, không phải một hạng
  // mục của S2.5. Đo được, không suy: dải mã bất biến được ghim `[A-H]` ở **tám** chỗ — trong đó
  // `tools/inv-matrix/src/parse.ts` giữ BA (`HANG_BAT_BIEN`, `NHAN_PHU_DO_DUOC`, và bộ đếm độc
  // lập `demHangUngVien`), `tests/architecture/so-no-tu-doi-chieu.test.ts` giữ BA, cộng
  // `nhan-bat-bien-cho-dat.test.ts` và `tools/inv-matrix/src/danh-gia.test.ts`. Nới dải ấy đổi
  // cách ĐẾM của mọi bất biến về sau, và nó kéo theo hai con số tổng ở `docs/TEST-PLAN.md` cùng
  // mọi lời khai *56/56* đang sống.
  //
  // Gộp một đổi thay như thế vào một vòng đã chạm lõi niêm phong là gộp đúng hai thứ phải tách.
  // Nên vòng này giao PHẦN CHẤT của J4 — ba ca dưới — và để phần ĐĂNG KÝ thành một khoản riêng,
  // cùng lúc với J1/J2 (`packages/danh-gia/src/luot-danh-gia.int.test.ts` đã ghi vì sao hai mã ấy
  // cũng chưa vào sổ). Gắn nhãn hôm nay là ghi một dòng `passed` vào một hàng chưa tồn tại.
  //
  // **[S1.115 / khoản 229] KHOẢN RIÊNG ẤY ĐÃ CHẠY, và con số *tám* ở trên SAI.** Đo lại trên
  // `master` ngày 2026-09-23: **MƯỜI** chỗ ghim, không tám — `parse.ts` giữ **BỐN** chứ không ba
  // (vế *nhãn chưa khai* không được kể), và có một chỗ thứ mười ở `packages/outbox/src/`, một GÓI
  // mà cả hai đoạn văn trên đều không nhắc tên. Cả mười nay là `[A-HJ]`, `J4` đã có ô, và ba ca
  // dưới mang nhãn `[INV-J4]`.
  //
  // **[S1.153 / S3.0]** Cả mười nay là `[A-HJK]`: dải có chỗ cho nhóm K TRƯỚC khi K1 vào sổ (spec S3
  // §9), để K1 không lặp lại chuyện của J4. Đo lại trên `master` `fa8d4ea` vẫn đúng mười chỗ.
  //
  // **[S1.192 / S4.0]** Cả mười nay là `[A-HJ-L]`: nhóm L của spec S4 vào sổ từ L1, L4 (S4.1).
  // ==============================================================================================

  it("bước 12c — MỞ VÒNG BAFO qua HTTP: top-N suy từ bảng xếp hạng, và nhà cung cấp thấy hạn CỦA VÒNG", async () => {
    const m = trangThai.mua.cookie;

    // Cổng quyền TRƯỚC: `rfq.bafo.open` chỉ `PROCUREMENT_MANAGER` (ADR-055). GIÁM ĐỐC chấm thầu
    // được (`evaluation.perform`) mà KHÔNG mở vòng BAFO được — đó là toàn bộ lý do mã quyền này
    // tồn tại riêng thay vì dùng lại `evaluation.perform` (khoản 220).
    const han = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/bafo`, trangThai.gd1.cookie, { deadlineAt: han.toISOString() })).status).toBe(403);

    const mo = await goi("POST", `/rfqs/${trangThai.rfqId}/bafo`, m, { deadlineAt: han.toISOString() });
    expect(mo.status, mo.text).toBe(201);
    const vong = (mo.body as { bafoRound: { bafoRoundId: string; roundNo: number; topN: number } }).bafoRound;
    expect(vong.roundNo).toBe(1);
    expect(vong.topN).toBe(2);
    trangThai.bafoRoundId = vong.bafoRoundId;

    // Ai là top-2 thì SUY từ bảng xếp hạng, không gõ tay — đó chính là lời hứa của §8.1⑴.
    const bxh = await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, m);
    const hang = (bxh.body as { ranking: { rows: { supplierName: string; rank: number | null }[] } }).ranking.rows;
    trangThai.topN = hang.filter((h) => h.rank !== null && h.rank <= 2).sort((a, b) => Number(a.rank) - Number(b.rank)).map((h) => h.supplierName);
    expect(trangThai.topN).toHaveLength(2);

    // NHÀ CUNG CẤP THẤY HẠN CỦA VÒNG — khoản 227⑶. Và `rfq.deadlineAt` lúc này đã ở QUÁ KHỨ, nên
    // không có trường này thì màn nộp thầu chỉ đọc được một hạn đã qua trong khi vẫn nộp được.
    const lm = trangThai.loiMoi.find((x) => x.ten === trangThai.topN[0])!;
    const gr = await goi("GET", "/guest/rfq", lm.cookie);
    expect(gr.status, gr.text).toBe(200);
    const br = (gr.body as { rfq: { deadlineAt: string }; bafoRound: Record<string, unknown> | null }).bafoRound;
    expect(br).not.toBeNull();
    // ĐÚNG HAI TRƯỜNG: `topN` và `openedBy` là tin cạnh tranh thật và chúng KHÔNG ra khỏi đây.
    expect(Object.keys(br!).sort()).toEqual(["deadlineAt", "roundNo"]);
    expect(br!.roundNo).toBe(1);
    expect(new Date(String(br!.deadlineAt)).getTime()).toBeGreaterThan(Date.now());
    // [S1.109 — PHÉP ĐO BÁC MỘT CÂU CỦA CHÍNH LƯỢT SOI NÀY] Lượt soi hình dạng viết rằng hạn
    // vòng một *"đã ở QUÁ KHỨ"* suốt `BAFO_OPEN`. Ở kịch bản này nó **CHƯA** — gói thầu được ĐÓNG
    // SỚM (`early_close_reason`), nên `rfq.deadlineAt` vẫn nằm ở tương lai. Đo, không suy.
    //
    // Và ca ấy còn TỆ HƠN ca lượt soi tưởng tượng: một nhà cung cấp đọc `rfq.deadlineAt` sẽ tin
    // mình còn tới NGÀY XA HƠN hạn thật của vòng BAFO — tức màn hình không chỉ nói sai, nó nói
    // sai theo chiều ru ngủ. Vế phải đo là *hai hạn KHÁC NHAU, và hạn đúng là hạn của VÒNG*.
    const hanVongMot = new Date((gr.body as { rfq: { deadlineAt: string } }).rfq.deadlineAt).getTime();
    const hanVongBafo = new Date(String(br!.deadlineAt)).getTime();
    expect(hanVongBafo, "hai hạn phải KHÁC nhau — nếu bằng thì trường mới không mua gì").not.toBe(hanVongMot);
    expect(hanVongMot, "ở kịch bản này gói thầu đóng SỚM, nên hạn vòng một còn XA HƠN hạn BAFO").toBeGreaterThan(hanVongBafo);

    // [S1.181 / ADR-110 — lượt soi] Người trong top-N mất phiên giữa vòng hai thì bên mua GỬI LẠI được link: `BAFO_OPEN` còn
    // hạn của vòng là trạng thái nhận báo giá. Phiên khách đang sống không bị chạm — bước 12d nộp bằng chính cookie ấy.
    const guiLai = await goi("POST", `/invitations/${lm.invitationId}/reissue`, m);
    expect(guiLai.status, guiLai.text).toBe(200);
    expect(guiLai.body).toEqual({ reissued: true });
  });

  it("bước 12d — TOP-2 nộp lại NIÊM PHONG; người NGOÀI top-2 bị chặn, và bằng 422 chứ không 500", async () => {
    for (const [i, ten] of trangThai.topN.entries()) {
      const lm = trangThai.loiMoi.find((x) => x.ten === ten)!;
      const r = await goi("GET", "/guest/rfq", lm.cookie);
      const khoa = (r.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256")!;
      const phongBi = await sealBid({
        rfqId: trangThai.rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: new Uint8Array(Buffer.from(khoa.publicKey, "base64")),
        plaintext: new TextEncoder().encode(banRo(GIA_BAFO[i]!, lm.ten)),
      });
      const bn = await goi("POST", "/guest/bids", lm.cookie, { envelope: Buffer.from(phongBi).toString("base64") });
      expect(bn.status, `${ten}: ${bn.text}`).toBe(201);
      trangThai.giaBafo.set(ten, GIA_BAFO[i]!);
    }

    // NGƯỜI NGOÀI TOP-2 — `bid_kiem_vong_bafo` (059 mục 6) chặn, và phép suy từ `rank` thành một
    // lớp CHẶN chứ không một truy vấn hiển thị.
    //
    // 422, KHÔNG 500, và đó là một bản vá của chính vòng này: câu `INSERT` của `bidding.ts` không
    // bọc try/catch, nên lỗi `pg` đi lên với `name === "error"` và rơi ra ngoài danh sách ĐÓNG
    // `LOI_NGHIEP_VU_422` của `dispatch.ts`. Đo được rằng trước vòng này KHÔNG ca nào ghim hành
    // vi ấy — kể cả cho lần từ chối QUÁ HẠN của C1, vốn đã có từ S1.4.
    const ngoai = trangThai.loiMoi.find((x) => !trangThai.topN.includes(x.ten))!;
    const r2 = await goi("GET", "/guest/rfq", ngoai.cookie);
    const khoa2 = (r2.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256")!;
    const pb2 = await sealBid({
      rfqId: trangThai.rfqId,
      algorithm: "ECDH_P256",
      recipientPublicKey: new Uint8Array(Buffer.from(khoa2.publicKey, "base64")),
      plaintext: new TextEncoder().encode(banRo("888000000.00", ngoai.ten)),
    });
    const bn2 = await goi("POST", "/guest/bids", ngoai.cookie, { envelope: Buffer.from(pb2).toString("base64") });
    expect(bn2.status, bn2.text).toBe(422);
    // Và thông điệp KHÔNG chép lại câu của CSDL: hai trong ba câu ấy nội suy UUID.
    expect(bn2.text).not.toContain(trangThai.bafoRoundId);
    // [S1.180 / khoản 247 / ADR-108] ...và lần chặn ấy để lại ĐÚNG MỘT hàng `BID_STATE_DENIED` mang mã của nhánh, qua đường
    // HTTP thật: route khách trả 422 mà COMMIT.
    const { rows: soBafo } = await db.pool.query<{ payload: unknown }>(
      "SELECT payload FROM audit_events WHERE action = 'BID_STATE_DENIED' AND resource_id = $1",
      [trangThai.rfqId],
    );
    expect(soBafo).toEqual([{ payload: { ma: "BAFO_NGOAI_TOP_N" } }]);
  });

  it("[INV-A2] [INV-J4] BỘ QUÉT RÒ RỈ LẦN BA — giá BAFO đã NẰM TRONG CSDL mà chưa qua cổng bốn vế: không route nào trả nó, KỂ CẢ cho người mua đủ quyền", async () => {
    // TIỀN ĐỀ, đo trước khi quét: hai phong bì BAFO thật sự đã nộp. Không có khẳng định này, lượt
    // quét xanh cả khi bước trên hỏng lặng lẽ — và một bộ quét trên tập rỗng thì không đo gì.
    const { rows: dem } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM vendor_bid_versions WHERE bafo_round_id = $1", [trangThai.bafoRoundId],
    );
    expect(dem[0]?.n, "hai phong bì BAFO phải đã nằm trong CSDL trước khi quét").toBe("2");

    const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    // [S1.251 / S4.4b] `:itemId` là hàng chuẩn THẬT — lịch sử giá của nó được hỏi bởi người mua ĐỦ QUYỀN khi vòng hai còn niêm phong.
    // [S1.260 / S4.5c1] `:lineNo` ⇒ dòng 1 có thật — lượt J4 hỏi đúng *Xem dải* của gói.
    const thayDuong = (path: string) =>
      path.replace(":rfqId", trangThai.rfqId).replace(":unsealRequestId", trangThai.unsealRequestId).replace(":itemId", trangThai.hangChuanId).replace(":lineNo", "1").replace(/:[A-Za-z]+/gu, UUID0);
    const roRi: string[] = [];
    let soGoi = 0;
    let thayGiaVongMot = 0;
    for (const r of ROUTES) {
      if (r.method !== "GET") continue;
      const cookies =
        r.audience === "GUEST" ? trangThai.loiMoi.map((lm) => lm.cookie)
        // NGƯỜI MUA CÓ ĐỦ QUYỀN — vế làm J4 khác lượt quét lần hai.
        : r.audience === "BUYER" ? [trangThai.mua.cookie]
        : [];
      for (const cookie of cookies) {
        const path = r.audience === "GUEST" && r.path.includes(":bidVersionId")
          ? r.path.replace(":bidVersionId", trangThai.bienNhan.find((b) => trangThai.loiMoi.some((lm) => lm.cookie === cookie && lm.ten === b.ten))?.bidVersionId ?? UUID0)
          : thayDuong(r.path);
        const ph = await goi(r.method, path, cookie);
        soGoi += 1;
        const headerText = [...ph.headers.entries()].map(([a, b]) => `${a}: ${b}`).join("\n");
        for (const g of quetRoRi(ph.text + "\n" + headerText)) {
          if ((GIA_BAFO as readonly string[]).includes(g)) roRi.push(`${r.method} ${r.path} (${ph.status}): ${g}`);
          else thayGiaVongMot += 1;
        }
        // [S1.260 / S4.5c1] Đơn giá BAFO, thô hay quy đổi về đơn vị gốc (*Xem dải*), cũng không lọt. Đối chứng dương của bộ quét quy
        // đổi là ca benchmark ở `BAFO_UNSEALED`.
        for (const g of [...quetDonGia(ph.text), ...quetDonGiaQuyDoi(ph.text)]) {
          if ((GIA_BAFO as readonly string[]).includes(g)) roRi.push(`${r.method} ${r.path} (${ph.status}) đơn giá: ${g}`);
        }
      }
    }
    expect(soGoi).toBeGreaterThan(5 * 4 + 8);
    expect(roRi, "[J4] một mức giá BAFO lọt ra TRƯỚC khi vòng ấy đi qua cổng bốn vế").toEqual([]);
    // ĐỐI CHỨNG: bộ quét KHÔNG mù ở chính lượt chạy này — nó vẫn thấy giá vòng một (đã mở, và
    // người mua có `bid.view`). Thiếu vế này, một `quetRoRi` hỏng sẽ cho `roRi` rỗng và ca xanh.
    expect(thayGiaVongMot, "bộ quét phải VẪN thấy giá VÒNG MỘT ở chính lượt này").toBeGreaterThan(0);
  });

  it("[INV-L6] LỊCH SỬ GIÁ ở BAFO_OPEN — vòng hai đã nằm trong CSDL mà chưa mở niêm phong: người mua ĐỦ QUYỀN đọc được, và gói không cho một quan sát nào, không một đơn giá nào", async () => {
    expect(await trangThaiRfq()).toBe("BAFO_OPEN");
    const { ph, cuaGoi } = await docLichSuQuaHttp(trangThai.mua.cookie);
    expect(ph.status, ph.text).toBe(200);
    // ADR-136: `gia_da_lo` đòi MỌI vòng mở trước mốc có yêu cầu mở thầu `EXECUTED` — một vòng BAFO đang mở rút CẢ gói khỏi lịch sử,
    // kể cả bản vòng một đã mở: vị thế cuối của top-2 chưa biết, nên không quan sát nào của gói là vị thế cuối.
    expect(cuaGoi).toEqual([]);
    expect(quetDonGia(ph.text), "không đơn giá nào của gói — vòng hai càng không").toEqual([]);
    expect(quetRoRi(ph.text)).toEqual([]);
  });

  it("[INV-L6] [S1.260 / S4.5c1] BENCHMARK ở BAFO_OPEN — người mua ĐỦ QUYỀN nhận trạng thái có tên, không nhãn, không dải, không đơn giá", async () => {
    expect(await trangThaiRfq()).toBe("BAFO_OPEN");
    const { bm, dai } = await docBenchmarkQuaHttp(trangThai.mua.cookie);
    expect([bm.status, dai.status]).toEqual([200, 200]);
    expect((bm.body as { benchmark: unknown }).benchmark).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_OPEN" });
    expect((dai.body as { dai: unknown }).dai).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_OPEN" });
    expect([...quetRoRi(bm.text + dai.text), ...quetDonGia(bm.text + dai.text), ...quetDonGiaQuyDoi(bm.text + dai.text)]).toEqual([]);
  });

  it("[INV-J4] ĐỘT BIẾN — gỡ lớp giữ J4 lúc chạy thì bộ quét THẤY giá BAFO ngay ở route ấy", async () => {
    // J4 đúng KHÔNG phải vì bộ quét mù, và không phải vì route khéo: nó đúng vì **chưa có một
    // hàng bản rõ nào** cho phong bì BAFO, và đường DUY NHẤT sinh ra hàng ấy đi qua cổng bốn vế
    // (`rfq_kiem_yeu_cau_mo_thau` của `019 §4`, và từ `059` nó phân biệt được VÒNG).
    //
    // Ca này gỡ đúng lớp ấy LÚC CHẠY rồi hỏi lại cùng một câu hỏi. Nếu bộ quét vẫn im, nó đang
    // im vì một lý do khác lý do ta nghĩ — và cả lượt quét ở trên là một cổng xanh rỗng ruột.
    const { rows: pb } = await db.pool.query<{ id: string }>(
      "SELECT id FROM vendor_bid_versions WHERE bafo_round_id = $1 ORDER BY id LIMIT 1",
      [trangThai.bafoRoundId],
    );
    const versionId = pb[0]?.id ?? "";
    expect(versionId, "tiền đề: phải có một phong bì BAFO để đột biến").not.toBe("");

    // Yêu cầu mở thầu VÒNG MỘT — đã `EXECUTED`, và nó KHÔNG thuộc vòng BAFO. Dùng lại nó là
    // đúng kịch bản mà cổng tồn tại để chặn.
    await db.pool.query("ALTER TABLE rfq_unsealed_bids DISABLE TRIGGER USER");
    try {
      await db.pool.query(
        "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)",
        [orgA, trangThai.unsealRequestId, versionId, JSON.stringify({ totalAmount: GIA_BAFO[0], currency: "VND" })],
      );
      // ------------------------------------------------------------------------------------
      // VÀ ĐÂY LÀ THỨ PHÉP ĐO TRẢ VỀ, KHÁC THỨ CA NÀY ĐƯỢC VIẾT RA ĐỂ CHỜ.
      //
      // Bản đầu của ca này khẳng định bộ quét sẽ THẤY giá — tức J4 chỉ đứng nhờ MỘT lớp (không có
      // hàng bản rõ nào). Phép đo BÁC câu ấy: hàng bản rõ đã nằm đó mà không route nào trả nó, vì
      // một lớp THỨ HAI cũng đang từ chối — `COMPARISON_ALLOWED_STATUSES` không chứa `BAFO_OPEN`
      // (`packages/unseal/src/comparison.ts`), nên `buildComparisonTable` trả 422 suốt cửa sổ
      // niêm phong của vòng hai, bất kể trong bảng có gì.
      //
      // Kết quả MẠNH HƠN thứ được đi tìm, nên nó được ghi đúng như nó là: gỡ MỘT lớp không đủ để
      // giết J4. Cả hai vế dưới đây đều được khẳng định — nếu ngày nào lớp thứ hai bị nới ra
      // `BAFO_OPEN`, vế thứ nhất ĐỎ ngay và ca này kể đúng câu chuyện đã đổi.
      // ------------------------------------------------------------------------------------
      const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
      const thay = quetRoRi(r.text).filter((g) => (GIA_BAFO as readonly string[]).includes(g));
      expect(thay, "gỡ lớp *không có hàng bản rõ* KHÔNG đủ để giá BAFO đi ra").toEqual([]);
      expect(r.status, "vì lớp thứ hai — cổng trạng thái của bảng so sánh — vẫn đang từ chối").toBe(422);
    } finally {
      await db.pool.query("DELETE FROM rfq_unsealed_bids WHERE bid_version_id = $1", [versionId]);
      await db.pool.query("ALTER TABLE rfq_unsealed_bids ENABLE TRIGGER USER");
    }

    // KHÔI PHỤC ĐƯỢC TỰ KIỂM, không tin vào `finally`: bảng phải trở lại đúng năm hàng bản rõ
    // của vòng một, và trigger phải bật lại. S1.86 để sót một đột biến vì không có vế này.
    const { rows: con } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_unsealed_bids WHERE org_id = $1", [orgA],
    );
    expect(con[0]?.n, "đột biến phải được gỡ sạch").toBe("5");
    const { rows: tg } = await db.pool.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.rfq_unsealed_bids'::regclass AND NOT tgisinternal",
    );
    expect(tg.length).toBeGreaterThan(0);
    expect(tg.every((t) => t.tgenabled !== "D"), "mọi trigger phải được bật lại").toBe(true);
    // ------------------------------------------------------------------------------------------
    // MỘT KHẲNG ĐỊNH CỦA CHÍNH CA NÀY ĐÃ BỊ PHÉP ĐO BÁC, VÀ THỨ THAY NÓ HẸP HƠN.
    //
    // Bản đầu đóng ca bằng *"cổng THẬT vẫn chặn: cùng câu INSERT, trigger đã bật, phải ĐỎ"*. Nó
    // XANH — tức câu INSERT ĐI QUA. Lý do đo được: `unseal_kiem_yeu_cau_khi_ghi_ban_ro` (`019`)
    // chỉ đòi yêu cầu mở thầu ở `APPROVED`/`EXECUTED`, và yêu cầu VÒNG MỘT đúng ở `EXECUTED`;
    // không ràng buộc nào buộc `bid_version_id` thuộc CÙNG gói thầu với `unseal_request_id` —
    // hai khoá ngoại hợp thành trỏ về hai bảng khác nhau, không về nhau.
    //
    // Nó KHÔNG phải một lỗ đang mở: `INSERT` trên bảng bản rõ chỉ cấp cho `app_unseal`, và tiến
    // trình duy nhất mang vai ấy suy CẢ HAI giá trị từ cùng một yêu cầu. Nhưng nó là một lớp
    // MỎNG HƠN thứ ca này tưởng, nên nó được ghi thành một khoản nợ thay vì nuốt vào im lặng.
    //
    // Thứ thay thế là vế THẬT SỰ chịu lực cho J4 ở phía route: vai của `apps/api` không ghi được
    // một hàng bản rõ nào, bằng lối nào.
    // ------------------------------------------------------------------------------------------
    // [S1.170 / khoản 228] `073` khép khe ấy: trigger nay đòi phong bì thuộc CÙNG gói và CÙNG vòng
    // với yêu cầu — đúng vị từ worker dùng để chọn phong bì. Nên khẳng định của bản đầu quay lại, dưới
    // chính vai DUY NHẤT được cấp `INSERT`: cùng câu, trigger bật, `app_unseal` ⇒ ĐỎ.
    await expect(
      withTenant(unsealPool, orgA, (c) =>
        c.query(
          "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)",
          [orgA, trangThai.unsealRequestId, versionId, JSON.stringify({ totalAmount: GIA_BAFO[0], currency: "VND" })],
        ),
      ),
      "phong bì VÒNG HAI dưới yêu cầu mở thầu VÒNG MỘT — trigger phải chặn, kể cả với app_unseal",
    ).rejects.toThrow(/Ban ro phai thuoc cung goi thau va cung vong/u);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)",
          [orgA, trangThai.unsealRequestId, versionId, JSON.stringify({ totalAmount: GIA_BAFO[0], currency: "VND" })],
        ),
      ),
      "vai app_api KHÔNG được ghi bản rõ — đó là lớp giữ J4 ở phía route",
    ).rejects.toThrow(/permission denied/u);
  });

  it("bước 12e — ĐÓNG vòng BAFO qua HTTP", async () => {
    const dong = await goi("POST", `/rfqs/${trangThai.rfqId}/bafo/close`, trangThai.mua.cookie);
    expect(dong.status, dong.text).toBe(200);
    expect(await trangThaiRfq()).toBe("BAFO_CLOSED");
  });

  it("[INV-L6] LỊCH SỬ GIÁ ở BAFO_CLOSED — vòng đã đóng nhưng CHƯA mở niêm phong: vẫn không một quan sát nào của gói, không một đơn giá BAFO nào", async () => {
    // Spec S4 §5.1 L6: đối chứng chạy ở CẢ `BAFO_OPEN` lẫn `BAFO_CLOSED` — ở `BAFO_CLOSED` phong bì vòng hai chưa vào bảng bản rõ, và
    // một vị từ theo `status` (*"mọi vòng BAFO đã ĐÓNG"* của bản nháp) sẽ cho gói đi ra với giá vòng một làm vị thế cuối.
    expect(await trangThaiRfq()).toBe("BAFO_CLOSED");
    const { ph, cuaGoi } = await docLichSuQuaHttp(trangThai.mua.cookie);
    expect(ph.status, ph.text).toBe(200);
    expect(cuaGoi).toEqual([]);
    expect(quetDonGia(ph.text)).toEqual([]);
    expect(quetRoRi(ph.text)).toEqual([]);
  });

  it("[INV-L6] [S1.260 / S4.5c1] BENCHMARK ở BAFO_CLOSED — vẫn trạng thái có tên, không nhãn, không dải, không đơn giá", async () => {
    expect(await trangThaiRfq()).toBe("BAFO_CLOSED");
    const { bm, dai } = await docBenchmarkQuaHttp(trangThai.mua.cookie);
    expect((bm.body as { benchmark: unknown }).benchmark).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_CLOSED" });
    expect((dai.body as { dai: unknown }).dai).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_CLOSED" });
    expect([...quetRoRi(bm.text + dai.text), ...quetDonGia(bm.text + dai.text), ...quetDonGiaQuyDoi(bm.text + dai.text)]).toEqual([]);
  });

  it("bước 12e2 — cổng bốn vế LẦN HAI, và worker mở ĐÚNG hai phong bì của vòng hai", async () => {
    const m = trangThai.mua.cookie;

    // Cổng bốn vế chạy LẠI, nguyên khuôn — mỗi vòng là một hàng `unseal_requests` mới, nên *hai
    // người khác nhau* được đo LẠI. Đây là phần lãi của phép ảnh mà S1.108 chọn: không khuôn thứ
    // hai nào được dựng cho vòng BAFO.
    const yc = await goi("POST", `/rfqs/${trangThai.rfqId}/unseal`, m, { reason: "het han vong BAFO, mo phong bi vong hai" });
    expect(yc.status, yc.text).toBe(201);
    const ycId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;
    expect(ycId).not.toBe(trangThai.unsealRequestId);
    expect((await goi("POST", `/unseal/${ycId}/approve`, trangThai.gd1.cookie)).status).toBe(200);
    expect((await goi("POST", `/unseal/${ycId}/approve`, trangThai.gd2.cookie)).status).toBe(200);
    const dp = await goi("POST", `/unseal/${ycId}/dispatch`, m);
    expect(dp.status, dp.text).toBe(200);
    expect((dp.body as { gate: { clauses: string[] } }).gate.clauses).toEqual(["PERMISSION", "MFA_FRESH", "RFQ_CLOSED", "POLICY_GATE"]);

    const kq = await withTenant(unsealPool, orgA, (c) => executeUnsealRequest(c, orgA, { unsealRequestId: ycId, unwrapper: boMoBoc }, unsealPool));
    // ĐÚNG HAI — không năm. Nhà cung cấp ngoài top-2 không nộp lại, nên phiên bản mới nhất của họ
    // vẫn là phong bì VÒNG MỘT **đã mở rồi**; đọc lại nó sẽ đụng `UNIQUE (org_id, bid_version_id)`.
    expect(kq.opened, "worker phải lọc theo bafo_round_id").toBe(2);
    expect(kq.failedBidVersionIds).toEqual([]);
    const { rows: tt } = await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [trangThai.rfqId]);
    expect(tt[0]?.status).toBe("BAFO_UNSEALED");
    // Hàng sổ mang DẤU VÒNG — không có nó, sau BAFO sổ có hai hàng `RFQ_UNSEALED` giống hệt nhau.
    const { rows: so } = await db.pool.query<{ payload: { bafoRoundId: string | null } }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'RFQ_UNSEALED' ORDER BY occurred_at", [orgA],
    );
    expect(so).toHaveLength(2);
    expect(so[0]?.payload.bafoRoundId).toBeNull();
    expect(so[1]?.payload.bafoRoundId).toBe(trangThai.bafoRoundId);
  });

  it("[INV-J4] ĐỐI CHỨNG DƯƠNG — SAU cổng bốn vế, cùng bộ quét ấy THẤY giá BAFO", async () => {
    // §6 của spec gọi đúng vế này: *"Vòng quét route chứng minh KHÔNG thấy giá BAFO; nó chỉ có
    // nghĩa khi có một lượt chứng minh bộ quét THẤY giá ấy sau khi vòng BAFO mở."*
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
    expect(r.status, r.text).toBe(200);
    const thay = quetRoRi(r.text).filter((g) => (GIA_BAFO as readonly string[]).includes(g));
    expect(thay.sort(), "cùng bộ quét, cùng route, sau cổng — giá BAFO phải hiện ra").toEqual([...GIA_BAFO].sort());
  });

  it("[INV-L6] ĐỐI CHỨNG DƯƠNG — lịch sử giá THẤY quan sát vòng hai NGAY khi vòng ấy mở niêm phong: bản BAFO của top-2, bản vòng một của ba người còn lại", async () => {
    expect(await trangThaiRfq()).toBe("BAFO_UNSEALED");
    const { ph, cuaGoi } = await docLichSuQuaHttp(trangThai.mua.cookie);
    expect(ph.status, ph.text).toBe(200);
    const cuoi = trangThai.loiMoi.map((lm) => trangThai.giaBafo.get(lm.ten) ?? lm.gia).sort();
    expect(cuaGoi.map((q) => q.thanhTien).sort()).toEqual(cuoi);
    expect(cuaGoi.every((q) => q.trangThai === "HOP_LE")).toBe(true);
    expect([...quetDonGia(ph.text)].sort(), "cùng bộ quét, cùng route — đơn giá BAFO phải hiện ra").toEqual(cuoi);
    for (const g of GIA_BAFO) expect(quetDonGia(ph.text)).toContain(g);
  });

  it("[INV-L6] [S1.260 / S4.5c1] ĐỐI CHỨNG DƯƠNG — BENCHMARK NGAY khi vòng chào lại mở niêm phong: bản lưu MỚI của lần mở thầu ấy, Xem dải THẤY đơn giá BAFO", async () => {
    expect(await trangThaiRfq()).toBe("BAFO_UNSEALED");
    const { bm, dai } = await docBenchmarkQuaHttp(trangThai.mua.cookie);
    const b = (bm.body as { benchmark: { trangThai: string; nguon: string; bafoRoundId: string | null } }).benchmark;
    expect([b.trangThai, b.nguon, b.bafoRoundId]).toEqual(["CO", "TINH_MOI", trangThai.bafoRoundId]);
    expect([...quetRoRi(bm.text), ...quetDonGia(bm.text), ...quetDonGiaQuyDoi(bm.text)]).toEqual([]);
    const cuoi = trangThai.loiMoi.map((lm) => trangThai.giaBafo.get(lm.ten) ?? lm.gia).sort();
    expect([...quetDonGiaQuyDoi(dai.text)].sort(), "cùng bộ quét, cùng route — đơn giá BAFO quy đổi phải hiện ra").toEqual(cuoi);
    for (const g of GIA_BAFO) expect(quetDonGiaQuyDoi(dai.text)).toContain(g);
  });

  it("bước 12f — BẢNG SO SÁNH sau BAFO: BẢY dòng lịch sử, nhưng phần TỔNG HỢP khử trùng còn NĂM", async () => {
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
    const bang = (r.body as {
      comparison: {
        rfqStatus: string;
        rows: { supplierLegalName: string; totalAmount: string; bafoRoundNo: number | null; isLatestForBid: boolean }[];
        aggregates: { parsed: number; unparsed: number; min: string; max: string };
      };
    }).comparison;
    expect(bang.rfqStatus).toBe("BAFO_UNSEALED");

    // NĂM dòng vòng một + HAI dòng BAFO. Chủ dự án chọn giữ cả hai (2026-09-22): bảng này là một
    // bảng LỊCH SỬ, và người mua cần thấy AI HẠ BAO NHIÊU.
    expect(bang.rows).toHaveLength(7);
    expect(bang.rows.filter((x) => x.bafoRoundNo === 1)).toHaveLength(2);
    expect(bang.rows.filter((x) => x.bafoRoundNo === null)).toHaveLength(5);
    // Hai nhà cung cấp top-2 có HAI dòng, và đúng một dòng của mỗi người là dòng đang có hiệu lực.
    for (const ten of trangThai.topN) {
      const cua = bang.rows.filter((x) => x.supplierLegalName === ten);
      expect(cua, ten).toHaveLength(2);
      expect(cua.filter((x) => x.isLatestForBid), ten).toHaveLength(1);
      expect(cua.find((x) => x.isLatestForBid)?.totalAmount).toBe(trangThai.giaBafo.get(ten));
    }

    // VÀ ĐÂY LÀ VẾ KHÔNG PHẢI MỘT LỰA CHỌN: `min`/`max`/`parsed` là lời khai về TẬP NGƯỜI DỰ
    // THẦU. Tính chúng trên bảy dòng thì `parsed` nói có bảy người dự thầu — sai dưới mọi cách
    // đọc, vì có năm.
    expect(bang.aggregates.parsed, "khử trùng: NĂM luồng báo giá, không bảy dòng").toBe(5);
    expect(bang.aggregates.unparsed).toBe(0);
    expect(bang.aggregates.min, "giá thấp nhất ĐANG CÓ HIỆU LỰC là giá BAFO thấp hơn").toBe(
      [...GIA_BAFO].sort((a, b) => Number(a) - Number(b))[0],
    );
  });

  it("bước 12g — CHẤM LẠI sau BAFO: mỗi nhà cung cấp đúng MỘT hàng, và thứ hạng tính trên giá MỚI", async () => {
    const m = trangThai.mua.cookie;
    // [S1.157 / khoản 243] Cùng người bấm chấm của bước 12b — BUYER không giữ `bid.view`. Ở đây
    // cái được canh là giá BAFO: vòng hai vừa mở, và thân của lần bấm chấm là chỗ đầu tiên chúng
    // có thể lọt ra tới một vai không có cổng đọc.
    const r = await goi("POST", `/rfqs/${trangThai.rfqId}/evaluate`, trangThai.cham.cookie, {});
    expect(r.status, r.text).toBe(201);
    const ld = (r.body as { evaluation: { evaluationId: string } }).evaluation;
    expect(Object.keys(ld).sort()).toEqual(["currency", "evaluationId", "policyId", "policyVersion"]);
    expect(quetRoRi(r.text), "lần chấm lại sau BAFO KHÔNG trả một mức giá nào — kể cả giá BAFO").toEqual([]);

    const bxh = await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, m);
    const bang = (bxh.body as { ranking: { evaluationId: string; rows: { supplierName: string; effectiveCost: string | null; rank: number | null }[] } }).ranking;
    expect(bang.evaluationId, "bảng xếp hạng là của lượt chấm VỪA tạo").toBe(ld.evaluationId);
    // NĂM hàng — không bảy. Đây là vế mà mục 7d của §S1.108 vá ở `docBaoGia`, và ca này là phép
    // đo của nó trên đường HTTP thật.
    expect(bang.rows, "một hàng mỗi LUỒNG báo giá, không một hàng mỗi phong bì đã mở").toHaveLength(5);
    expect([...bang.rows].map((x) => x.rank).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5]);
    // Hạng NHẤT là giá BAFO thấp nhất — bảng xếp hạng tính LẠI thật, không giữ bảng vòng một.
    const nhat = bang.rows.find((x) => x.rank === 1)!;
    expect(nhat.effectiveCost).toBe([...GIA_BAFO].sort((a, b) => Number(a) - Number(b))[0]);
    expect(trangThai.topN).toContain(nhat.supplierName);
    // Và người NGOÀI top-2 vẫn đứng trong bảng với giá vòng một — BAFO cải thiện giá của top-N,
    // nó không loại ai khỏi cuộc thi.
    const ngoai = trangThai.loiMoi.filter((x) => !trangThai.topN.includes(x.ten)).map((x) => x.ten);
    for (const ten of ngoai) {
      const h = bang.rows.find((x) => x.supplierName === ten);
      expect(h, ten).toBeDefined();
      expect(h?.effectiveCost, ten).toBe(trangThai.loiMoi.find((x) => x.ten === ten)?.gia);
    }
    expect(await goi("GET", `/rfqs/${trangThai.rfqId}/bafo`, m).then((x) => (x.body as { bafoRound: { closedAt: string | null } }).bafoRound.closedAt)).not.toBeNull();
  });

  // ============================================================================================
  // [S1.110 / S2.6] TRAO THẦU QUA HTTP — hành động CUỐI, và chỗ duy nhất đòi đúng HAI con người
  //
  // Bốn route của S2.6 đã có một vòng quét quyền ở `buyer.int.test.ts` (403 cho phiên không quyền,
  // đúng một mã đi qua), nhưng vòng quét ấy chứng minh cổng ĐÓNG chứ không chứng minh đường ĐI
  // ĐƯỢC. Hai bước dưới đây là phép đo ấy, trên cùng tiến trình HTTP thật với cùng năm con người
  // mà kịch bản đã dựng — và đúng ba vai khác nhau, nên J3 có việc thật để làm.
  // ============================================================================================

  // [S1.282 / S3.5b / K2b] Ngoại lệ HẬU KIỂM qua ĐƯỜNG CỦA MÀN: hai route ngoại lệ của `/tao-thau` (S3.3b) nay cũng là đường của khối
  // «Ngoại lệ hậu kiểm» ở bước 7 `/mo-thau`. Tới vòng này loại `LOW_ACTUAL_COMPETITION` ở EVALUATING chỉ đo ở tầng gói
  // (`trao-thau-theo-bac.int`); đây là lần đầu nó đi qua HTTP — và ở ĐÚNG lúc màn gọi nó: sau lượt chấm, trước đề xuất.
  it("[INV-K2b] bước 12g2 — NGOẠI LỆ HẬU KIỂM qua HTTP ở EVALUATING: người giữ quyền mời lập 201 và rút 200; giám đốc không giữ `rfq.invite` ⇒ 403; luồng MVP1 ⇒ 422 không hàng sổ", async () => {
    const duong = `/rfqs/${trangThai.rfqId}/exceptions`;
    const than = { loai: "LOW_ACTUAL_COMPETITION", maLyDo: "NO_ALTERNATIVE", giaiTrinh: "bon nha cung cap nop bao gia hop le, bac doi nam" };
    expect(await trangThaiRfq(), "tiền đề: gói đang ở lượt chấm").toBe("EVALUATING");
    const chanQuyen = await goi("POST", duong, trangThai.gd1.cookie, than);
    expect(chanQuyen.status, chanQuyen.text).toBe(403);
    const lap = await goi("POST", duong, trangThai.pm2.cookie, than);
    if (!batS3) {
      // Tổ chức chưa bật S3: cấu hình, không phải người đi tắt — 422 và KHÔNG hàng CONTROL_DENIED (S3.3b ⑺).
      expect(lap.status, lap.text).toBe(422);
      return;
    }
    expect(lap.status, lap.text).toBe(201);
    const e = (lap.body as { exception: { id: string; loai: string; rut: unknown } }).exception;
    expect([e.loai, e.rut]).toEqual(["LOW_ACTUAL_COMPETITION", null]);
    const docDs = await goi("GET", duong, trangThai.pm2.cookie);
    expect(docDs.status, docDs.text).toBe(200);
    expect((docDs.body as { exceptions: { id: string; loai: string }[] }).exceptions.map((x) => x.loai)).toContain("LOW_ACTUAL_COMPETITION");
    // Rút kèm lý do — gói vẫn EVALUATING; năm nhóm đã nộp nên bước 12h không cần ngoại lệ nào.
    const rut = await goi("POST", `${duong}/${e.id}/withdraw`, trangThai.pm2.cookie, { reason: "nguoi thu nam da nop; khong can ngoai le" });
    expect(rut.status, rut.text).toBe(200);
    expect(await trangThaiRfq()).toBe("EVALUATING");
  });

  it("[INV-J3] bước 12h — ĐỀ XUẤT trao thầu qua HTTP: người TẠO gói thầu bị J3 chặn, người KHÁC đi qua", async () => {
    // `trangThai.mua` vừa là `created_by` của RFQ vừa là người ĐIỀU PHỐI cả hai lượt mở thầu, nên
    // J3 chặn họ trên HAI vế cùng lúc; trigger kiểm `created_by` trước nên thông điệp nói vế ấy.
    // Đây là lần DUY NHẤT trong kho một cổng quyền nói CÓ mà một trigger nói KHÔNG — `mua` là
    // `PROCUREMENT_MANAGER`, tức họ GIỮ `award.recommend`.
    const nhat = (await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, trangThai.mua.cookie).then(
      (x) => (x.body as { ranking: { rows: { bidVersionId: string; rank: number | null }[] } }).ranking,
    )).rows.find((h) => h.rank === 1)!;
    expect(nhat.bidVersionId, "tiền đề: phải có một hàng hạng NHẤT để trao thầu").toBeTruthy();

    const tuChoi = await goi("POST", `/rfqs/${trangThai.rfqId}/award`, trangThai.mua.cookie, {
      bidVersionId: nhat.bidVersionId,
      reason: "nguoi tao goi thau tu de xuat",
    });
    // 422 MANG CÂU CỦA TRIGGER, không 500 — và lời khai đầu của vòng này nói 500, rồi phép đo bác
    // nó. `anhXaLoiPostgres` (`dispatch.ts`) ánh xạ `23514` tới 422, và nó LỘ thông điệp khi lỗi
    // đến từ một `RAISE` của trigger (`routine = exec_stmt_raise`) — đúng ca của ba trigger `061`,
    // vì thông điệp ấy do migration VIẾT chứ không nội suy dữ liệu người dùng. Nên J3 nói được cho
    // người bấm biết vì sao, mà không cần một dòng nào ở `LOI_NGHIEP_VU_422`.
    //
    // [S1.180 / khoản 247 / ADR-108] Nay câu ấy là của BẢNG CHỐT, không của trigger: `deXuatTraoThau` bắt lỗi của trigger theo
    // TÊN ràng buộc, từ chối bằng `ChotKiemSoatError` (422 qua `LOI_NGHIEP_VU_422`) và để lại một hàng `CONTROL_DENIED`. Câu vẫn
    // gọi tên `(J3)`.
    expect(tuChoi.status, tuChoi.text).toBe(422);
    expect(tuChoi.text, "câu từ chối phải GỌI TÊN bất biến, không chỉ nói không").toMatch(/\(J3\)/u);
    expect(await trangThaiRfq(), "lần từ chối KHÔNG được để lại một trạng thái nửa vời").toBe("EVALUATING");
    const { rows: soJ3 } = await db.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'CONTROL_DENIED' AND resource_id = $1 AND payload->>'ma' = 'J3_NGUOI_TAO_DE_XUAT'",
      [trangThai.rfqId],
    );
    expect(soJ3, "lần tự đề xuất ấy để lại đúng một hàng sổ").toHaveLength(1);

    // ĐỐI CHỨNG DƯƠNG — cùng gói, cùng báo giá, chỉ đổi NGƯỜI: `pm2` cũng là
    // `PROCUREMENT_MANAGER`, cũng giữ `award.recommend`, nhưng họ không tạo và không điều phối.
    const ok = await goi("POST", `/rfqs/${trangThai.rfqId}/award`, trangThai.pm2.cookie, {
      bidVersionId: nhat.bidVersionId,
      reason: "gia BAFO thap nhat, ky thuat dat",
    });
    expect(ok.status, ok.text).toBe(201);
    const aw = (ok.body as { award: { awardId: string; status: string; bidVersionId: string; evaluationId: string } }).award;
    expect(aw.status).toBe("PROPOSED");
    expect(aw.bidVersionId).toBe(nhat.bidVersionId);
    trangThai.awardId = aw.awardId;

    // `AWARDED` nghĩa là *ĐANG CÓ một award còn sống* (ADR-057), nên nó đặt ngay ở hàng PROPOSED.
    expect(await trangThaiRfq()).toBe("AWARDED");

    // [S1.282 / S3.5b / K2b] Có đề xuất rồi thì ngoại lệ hậu kiểm KHÔNG lập được nữa — câu của chốt mang mã, và màn `/mo-thau` đọc mã
    // ấy thành câu chỉ dẫn («rút đề xuất đang có…»); đúng một hàng `CONTROL_DENIED` dưới người gọi.
    if (batS3) {
      const muon = await goi("POST", `/rfqs/${trangThai.rfqId}/exceptions`, trangThai.pm2.cookie, {
        loai: "LOW_ACTUAL_COMPETITION", maLyDo: "NO_ALTERNATIVE", giaiTrinh: "lap sau khi da de xuat",
      });
      expect(muon.status, muon.text).toBe(422);
      expect((muon.body as { ma?: string }).ma).toBe("K2B_NGOAI_LE_SAI_TRANG_THAI");
      const { rows: soK2b } = await db.pool.query(
        "SELECT 1 FROM audit_events WHERE action = 'CONTROL_DENIED' AND resource_id = $1 AND payload->>'ma' = 'K2B_NGOAI_LE_SAI_TRANG_THAI'",
        [trangThai.rfqId],
      );
      expect(soK2b).toHaveLength(1);
    }

    // Và lượt chấm mà award dựa trên là lượt SAU BAFO — vế mà `deXuatTraoThau` canh MỘT MÌNH
    // (khoản 231). Bước 12g vừa tạo lượt ấy, nên đây là thế giới có HAI lượt chấm.
    const { rows: luot } = await db.pool.query<{ id: string }>(
      "SELECT id FROM rfq_evaluations WHERE org_id = $1 AND rfq_id = $2 ORDER BY created_at DESC, id DESC",
      [orgA, trangThai.rfqId],
    );
    expect(luot.length, "tiền đề: phải có HAI lượt chấm sau một chu kỳ BAFO").toBe(2);
    expect(aw.evaluationId, "award phải dựa trên bảng xếp hạng SAU BAFO").toBe(luot[0]?.id);
  });

  it("[INV-K10c] bước 12i — PHÊ DUYỆT qua HTTP: chữ ký đầu bị chặn vì ĐÓNG SỚM chưa ghi nhận (422 K10C), giám đốc thứ hai ghi nhận qua route dùng chung; người đề xuất bị chặn ở cổng QUYỀN, giám đốc ký, RFQ đứng yên", async () => {
    const duong = `/rfqs/${trangThai.rfqId}/award/${trangThai.awardId}/approve`;

    // `pm2` vừa đề xuất, và `PROCUREMENT_MANAGER` KHÔNG giữ `po.approve` — nên họ dừng ở cổng
    // QUYỀN (403), trước cả khi trigger *không tự duyệt* được hỏi. Hai lớp, và lớp ngoài chặn trước.
    const chan = await goi("POST", duong, trangThai.pm2.cookie);
    expect(chan.status, chan.text).toBe(403);

    // [S1.281 / S3.4a / K9] Luồng S3: giám đốc khai *không xung đột* trước khi ký duyệt trao thầu.
    // [S1.289 / S3.6c / K10c] Luồng S3: bước 7 đóng gói TRƯỚC hạn khi đã có năm báo giá ⇒ tín hiệu ĐÓNG SỚM chặn chữ ký đầu có tên; giám
    // đốc THỨ HAI (ngoài gói — không tạo, không nộp, không đóng) khai không xung đột rồi ghi nhận kèm lý do qua route dùng chung
    // (thân mang `loai`), chữ ký mới đi qua.
    if (batS3) {
      await khaiKhongXungDot(trangThai.rfqId, trangThai.gd1.cookie);
      const chanDongSom = await goi("POST", duong, trangThai.gd1.cookie);
      expect(chanDongSom.status, chanDongSom.text).toBe(422);
      expect((chanDongSom.body as { ma?: string }).ma).toBe("K10C_TIN_HIEU_CHUA_GHI_NHAN");
      await khaiKhongXungDot(trangThai.rfqId, trangThai.gd2.cookie);
      const gn = await goi("POST", `/rfqs/${trangThai.rfqId}/award/signals/acknowledge`, trangThai.gd2.cookie, {
        lyDo: "Da doc: dong som vi du nam bao gia theo ke hoach mua sam Q4",
        loai: "EARLY_CLOSE",
      });
      expect(gn.status, gn.text).toBe(201);
    }
    const ok = await goi("POST", duong, trangThai.gd1.cookie);
    expect(ok.status, ok.text).toBe(201);
    const sauMot = (ok.body as { award: { status: string; chuKyCan: number; approvals: unknown[] } }).award;
    // [S1.280 / S3.5a] Luồng S3: gói 1 tỷ ghim bậc 2 của §4.1 — `award_so_chu_ky` 2 — nên chữ ký đầu SỐNG mà đề xuất đứng yên ở
    // `PROPOSED` (khoản 242 ⑴ lật); luồng MVP1 một chữ ký là xong, nguyên văn.
    expect([sauMot.status, sauMot.chuKyCan, sauMot.approvals.length]).toEqual(batS3 ? ["PROPOSED", 2, 1] : ["APPROVED", 1, 1]);
    if (batS3) {
      // Cùng người ký lại ⇒ 422 có tên (`DA_KY_DE_XUAT_NAY`), chữ ký không nhân đôi; giám đốc THỨ HAI hoàn tất.
      const lapLai = await goi("POST", duong, trangThai.gd1.cookie);
      expect(lapLai.status, lapLai.text).toBe(422);
      // [S1.281 / S3.4a / K9] Giám đốc thứ hai ~~cũng khai *không xung đột* trước khi ký~~ đã khai lúc ghi nhận tín hiệu đóng sớm (trên).
      const hai = await goi("POST", duong, trangThai.gd2.cookie);
      expect(hai.status, hai.text).toBe(201);
      expect((hai.body as { award: { status: string } }).award.status).toBe("APPROVED");
    }

    // Duyệt KHÔNG đổi trạng thái RFQ — nó đã ở `AWARDED` từ lúc có đề xuất.
    expect(await trangThaiRfq()).toBe("AWARDED");

    const doc = await goi("GET", `/rfqs/${trangThai.rfqId}/award`, trangThai.mua.cookie);
    expect(doc.status, doc.text).toBe(200);
    const day = (doc.body as { award: { status: string; chuKyCan: number; approvals: { approverUserId: string }[] } }).award;
    expect(day.status).toBe("APPROVED");
    // Luồng MVP1: MỘT chữ ký, đúng §7 — của GIÁM ĐỐC, không của người đề xuất. Luồng S3: HAI, cả hai DIRECTOR (bậc 2 cho
    // FINANCE/DIRECTOR, không đòi hai vai khác nhau), và số cần đi ra tới người đọc.
    expect(day.approvals.map((c) => c.approverUserId)).toEqual(batS3 ? [trangThai.gd1.id, trangThai.gd2.id] : [trangThai.gd1.id]);
    expect(day.chuKyCan).toBe(batS3 ? 2 : 1);

    // Lần duyệt NỮA trên cùng đề xuất bị từ chối: hàng mới nhất nay là `APPROVED`.
    const lai = await goi("POST", duong, batS3 ? trangThai.gd1.cookie : trangThai.gd2.cookie);
    expect(lai.status, lai.text).toBe(422);
  });

  // [mảnh 1 / màn xuất bằng chứng] Bước cuối của kịch bản `docs/PRODUCT.md` §11 — *"xuất được
  // bộ bằng chứng kiểm toán của trọn chuỗi ấy"* — nay có đường HTTP dưới phiên một con người.
  // Ba điều được đo, và điều thứ ba là điều chịu lực:
  //   ⑴ cổng: `PROCUREMENT_MANAGER` chấm và đề xuất được nhưng KHÔNG giữ `audit.read` ⇒ 403;
  //   ⑵ hai tệp đi ra đúng byte mà CLI `pnpm bang-chung xuat` ghi (trừ đúng một dòng `xuatLuc`);
  //   ⑶ hai tệp tải qua HTTP đi qua bộ kiểm ĐỘC LẬP `pnpm bang-chung kiem` — chạy như một tiến
  //      trình riêng, KHÔNG có `DATABASE_URL`, tức đúng lượt kiểm mà màn hình dặn người dùng chạy.
  it("bước 12j — XUẤT BỘ BẰNG CHỨNG qua HTTP: cổng audit.read, cùng byte với CLI, và qua bộ kiểm độc lập", async () => {
    const duong = `/rfqs/${trangThai.rfqId}/evidence-bundle`;

    const truocXuat = await soHangDoc("EVIDENCE_BUNDLE_EXPORTED");
    const chan = await goi("GET", duong, trangThai.mua.cookie);
    expect(chan.status, chan.text).toBe(403);
    expect((await soHangDoc("EVIDENCE_BUNDLE_EXPORTED")).n, "[S1.164 / khoản 245] lần xuất bị từ chối KHÔNG vào sổ như một lần xuất").toBe(truocXuat.n);

    const ok = await goi("GET", duong, trangThai.gd1.cookie);
    expect(ok.status, ok.text).toBe(200);
    // [S1.164 / khoản 245] Bộ bằng chứng mang giá của từng báo giá — lần xuất là một lượt đọc giá, nên để lại đúng một hàng.
    const sauXuat = await soHangDoc("EVIDENCE_BUNDLE_EXPORTED");
    expect(sauXuat.n - truocXuat.n).toBe(1);
    expect(sauXuat.nguoiMoiNhat).toBe(trangThai.gd1.id);
    const eb = (ok.body as {
      evidenceBundle: { tep: Record<string, string>; soLuotCham: number; soHang: number; soTraoThau: number };
    }).evidenceBundle;
    expect(Object.keys(eb.tep).sort()).toEqual(["DAC-TA.md", "bo-bang-chung.json"]);
    // Hai lượt chấm (trước và SAU BAFO) — bộ bằng chứng mang MỌI lượt, không chỉ lượt mới nhất.
    expect(eb.soLuotCham).toBe(2);
    expect(eb.soTraoThau).toBe(2);
    const bo = JSON.parse(eb.tep["bo-bang-chung.json"] ?? "") as {
      dacTaSha256: string;
      traoThau: { awardId: string; status: string }[];
    };
    expect(bo.dacTaSha256).toBe(createHash("sha256").update(Buffer.from(eb.tep["DAC-TA.md"] ?? "", "utf8")).digest("hex"));
    expect(bo.traoThau.map((t) => t.status)).toEqual(["PROPOSED", "APPROVED"]);
    expect(bo.traoThau[0]?.awardId).toBe(trangThai.awardId);

    const goc = fileURLToPath(new URL("../../../", import.meta.url));
    const chayCli = (dbUrl: string | null, ...thamSo: string[]): { ma: number; ra: string; loi: string } => {
      const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test" };
      if (dbUrl === null) delete env["DATABASE_URL"];
      else env["DATABASE_URL"] = dbUrl;
      const kq = spawnSync(
        execPath,
        [
          "--experimental-transform-types",
          "--import",
          pathToFileURL(join(goc, "tools", "bo-xuat-danh-gia", "register-ts-resolve.mjs")).href,
          join(goc, "tools", "bo-xuat-danh-gia", "src", "index.ts"),
          ...thamSo,
        ],
        { env, encoding: "utf8", cwd: goc },
      );
      return { ma: kq.status ?? -1, ra: kq.stdout ?? "", loi: kq.stderr ?? "" };
    };

    const thuMuc = await mkdtemp(join(tmpdir(), "tp-bang-chung-http-"));
    try {
      const quaHttp = join(thuMuc, "qua-http");
      const quaCli = join(thuMuc, "qua-cli");
      await mkdir(quaHttp);
      // Ghi đúng như trình duyệt ghi: văn bản → byte UTF-8, không phân tích lại.
      for (const [ten, noiDung] of Object.entries(eb.tep)) await writeFile(join(quaHttp, ten), Buffer.from(noiDung, "utf8"));

      // [S1.276 / S4.6b — L15] Nhãn ngoài không vào lượt chấm, nên không vào bộ bằng chứng; hai kim ngoài không ở tệp nào của bộ.
      for (const [ten, noiDung] of Object.entries(eb.tep)) {
        expect(noiDung, `${ten} mang kim mốc ngoài`).not.toContain(KIM_MOC_NGOAI);
        expect(noiDung, `${ten} mang kim lịch sử ngoài`).not.toContain(KIM_LICH_SU_NGOAI);
      }
      const kiem = chayCli(null, "kiem", "--bo", quaHttp);
      expect(kiem.ma, `${kiem.ra}\n${kiem.loi}`).toBe(0);
      expect(kiem.ra).toContain("ok=true");
      // [S1.262 / S4.5c2] Phiên bản chính sách của kịch bản khai nhóm `benchmark` (`BENCHMARK_KB41`): bundle mang lớp dữ liệu nền
      // của CẢ HAI lượt chấm, và bộ kiểm ngoại tuyến tính lại MỌI nhãn — không một hàng lệch.
      const dong = /benchmark\tdong=(\d+)\tdat=(\d+)\tlech=(\d+)/u.exec(kiem.ra);
      expect(dong, kiem.ra).not.toBeNull();
      expect(Number(dong?.[1])).toBeGreaterThan(0);
      expect([dong?.[2], dong?.[3]]).toEqual([dong?.[1], "0"]);
      const boDln = JSON.parse(eb.tep["bo-bang-chung.json"] ?? "") as {
        luotCham: { coBenchmark: boolean }[];
        duLieuNen: { luotCham: { dong: unknown[] }[]; bangQuanSat: { quanSat: unknown[] }[] } | null;
      };
      const dln = boDln.duLieuNen;
      expect(dln?.luotCham).toHaveLength(2);
      // [rà soát S4.5c2] Cờ của lớp chấm thầu nói lớp dữ liệu nền PHẢI có mặt; hàng sổ của lần xuất mang số hàng benchmark và số quan
      // sát của gói KHÁC đã đi ra (THẤP-6) — đúng bằng thứ trong bundle.
      expect(boDln.luotCham.map((l) => l.coBenchmark)).toEqual([true, true]);
      const { rows: soKiem } = await db.pool.query<{ payload: Record<string, unknown> }>(
        "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'EVIDENCE_BUNDLE_EXPORTED' AND resource_id = $2 ORDER BY seq DESC LIMIT 1",
        [orgA, trangThai.rfqId],
      );
      expect(soKiem[0]?.payload).toEqual({
        exportedBySessionId: expect.any(String) as unknown,
        soDongBenchmark: dln!.luotCham.reduce((t, l) => t + l.dong.length, 0),
        soQuanSat: dln!.bangQuanSat.reduce((t, b) => t + b.quanSat.length, 0),
      });

      const xuat = chayCli(db.connectionString, "xuat", "--org", orgA, "--rfq", trangThai.rfqId, "--ra", quaCli);
      expect(xuat.ma, `${xuat.ra}\n${xuat.loi}`).toBe(0);
      expect(await readFile(join(quaCli, "DAC-TA.md"), "utf8")).toBe(eb.tep["DAC-TA.md"]);
      // `xuatLuc` là đồng hồ của TIẾN TRÌNH xuất — hai tiến trình, hai mốc. Mọi dòng khác bằng nhau.
      // [S1.262 / S4.5c2] ~~Mọi dòng khác bằng nhau~~ — trừ mã băm của lớp dữ liệu nền: muối NGẪU NHIÊN mỗi lần xuất (chủ dự án chốt
      // 2026-10-02), nên hai lần xuất khác nhau ở mã băm và BẰNG nhau sau khi đổi mỗi mã thành số thứ tự lần gặp đầu.
      const doiTenBam = (v: string): string => {
        const thu = new Map<string, string>();
        return v.replace(/"[0-9a-f]{32}"/gu, (m) => {
          if (!thu.has(m)) thu.set(m, `"#${String(thu.size)}"`);
          return thu.get(m)!;
        });
      };
      const boQua = (v: string): string => doiTenBam(v.replace(/"xuatLuc": \{[^}]*\}/u, '"xuatLuc": {}'));
      expect(boQua(await readFile(join(quaCli, "bo-bang-chung.json"), "utf8"))).toBe(boQua(eb.tep["bo-bang-chung.json"] ?? ""));
    } finally {
      await rm(thuMuc, { recursive: true, force: true });
    }
  }, 120000);

  it("bước 13 — [INV-B5] job toàn vẹn chạy sạch trên TÁM phiên bản (đường vận hành, không HTTP)", async () => {
    const bc = await withTenant(unsealPool, orgA, (c) => auditStoredCiphertexts(c, orgA, trangThai.rfqId));
    // ~~SÁU~~ **[S1.109] TÁM**: năm phong bì vòng một + một bản sửa giá + HAI phong bì BAFO. Con
    // số này là một lời khai về *mọi phiên bản của gói thầu*, nên nó phải lớn lên cùng vòng BAFO;
    // giữ nguyên 6 sẽ là một cổng toàn vẹn KHÔNG soi hai phong bì mới nhất.
    expect(bc.checked).toBe(8);
    expect(bc.mismatched).toEqual([]);
    expect(bc.missingReceipt).toEqual([]);
  });

  it("bước 14 — [INV-A3] sau tất cả, giá dạng rõ chỉ tồn tại ở ĐÚNG MỘT bảng", async () => {
    // ~~`relkind IN ('r', 'p')`~~ [S1.251 / S4.4b] bộ quét chung của `@trustprocure/test-support`: bảng, bảng cha phân mảnh, view,
    // materialized view (spec S4 §2.1 — một đối tượng dựng lúc chạy chứa giá dạng rõ đi qua bản cũ mà không dòng nào đỏ).
    const { dinh, soQuanHe } = await quetGiaMoiQuanHe(db.pool, GIA_SUA_LAI);
    expect(soQuanHe).toBeGreaterThan(20);
    // [S1.107 / khoản 224 — QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN] Lời khai cũ ở đây là *"giá dạng rõ chỉ tồn
    // tại ở ĐÚNG MỘT bảng"*, và nó ĐÚNG — trong một kịch bản KHÔNG CHẤM THẦU LẦN NÀO. `057` dựng
    // chỗ ở thứ hai từ S1.105 (`effective_cost` và `components.tien` của `rfq_evaluation_lines`),
    // và lượt soi ngang 77 đo ra rằng cổng này xanh vì phạm vi của nó, không vì lời khai đúng.
    //
    // Bước 12b nay chấm thầu THẬT trước khi tới đây, nên phép quét dưới chạy trong một thế giới
    // CÓ lượt chấm — và lời khai đổi theo ADR-054: giá dạng rõ chỉ ở những bảng ĐƯỢC KHAI, mỗi
    // bảng kèm vai ghi và cổng đọc của nó:
    //   • `rfq_unsealed_bids`     — ghi bởi `app_unseal` (019), đọc qua `bid.view`;
    //   • `rfq_evaluation_lines`  — ghi bởi `app_api` qua `taoLuotDanhGia` với GRANT theo CỘT
    //                               (057), đọc qua `bid.view` ở `docBangXepHang`.
    // Tập viết VÉT CẠN chứ không "chứa": một bảng THỨ BA mai sau phải làm dòng này ĐỎ.
    expect(dinh).toEqual(["rfq_evaluation_lines", "rfq_unsealed_bids"]);
    // [S1.256 / S4.5b] Phép quét trên chạy SAU một lần ghi benchmark thật — hai bảng kết quả có hàng, và không bảng nào trong hai
    // bảng ấy mang giá (spec §2.5 ⒅; ADR-142: không cột tiền).
    const bm = (
      await db.pool.query<{ a: string }>("SELECT count(*)::text AS a FROM public.price_benchmark_results")
    ).rows[0]!;
    expect(Number(bm.a), "lượt chấm của kịch bản đã ghi hàng benchmark").toBeGreaterThan(0);
    // [S1.251 / S4.4b] Kim ĐƠN GIÁ (spec S4 §2.5 ⒅). Đơn giá chỉ đứng trong `lines[].unitPrice` của bản rõ: lượt chấm đọc TỔNG
    // và không để lại đơn giá; lịch sử giá là một HÀM, không lưu gì (ADR-095) — dù đã được đọc bốn lần ở trên.
    expect(donGiaCua(GIA_SUA_LAI)).toBe("9300000.00");
    expect((await quetGiaMoiQuanHe(db.pool, donGiaCua(GIA_SUA_LAI))).dinh, "đơn giá chỉ ở bảng bản rõ").toEqual(["rfq_unsealed_bids"]);
    expect((await quetGiaMoiQuanHe(db.pool, donGiaCua(GIA_BAFO[0]))).dinh).toEqual(["rfq_unsealed_bids"]);
    // [lượt soi §S1.251 — L2] Đơn giá ĐÃ QUY ĐỔI (về kg) — đúng con số một bảng đệm của benchmark dễ lưu nhất — không ở đâu cả, kể
    // cả bảng bản rõ: nó chỉ sinh ra trong thân `quan_sat_gia`. Kim là thương in đúng như Postgres in nó trong lịch sử.
    const quyDoi = (
      await db.pool.query<{ v: string }>("SELECT ($1::numeric / ($2::numeric * $3::numeric))::text AS v", [GIA_SUA_LAI, "100.0000", HANG_CHUAN_CHINH.heSoTam])
    ).rows[0]!.v;
    expect(quyDoi.startsWith("10969.568")).toBe(true);
    expect((await quetGiaMoiQuanHe(db.pool, quyDoi)).dinh, "đơn giá quy đổi không được lưu ở đâu").toEqual([]);
    // [S1.272 / S4.6a — ADR-095 ⑸⑹, ADR-054] Hai bảng giá KHÔNG phải báo giá: mỗi kim của bước 1 chỉ ở đúng bảng của nó — không ở
    // sổ kiểm toán (payload lần nhập không mang giá), không ở bảng chấm, benchmark hay bản lưu, không ở bảng kia.
    expect((await quetGiaMoiQuanHe(db.pool, KIM_MOC_NGOAI)).dinh, "mốc giá ngoài chỉ ở bảng của nó").toEqual(["external_price_references"]);
    expect((await quetGiaMoiQuanHe(db.pool, KIM_LICH_SU_NGOAI)).dinh, "lịch sử ngoài chỉ ở bảng của nó").toEqual(["external_purchase_history"]);
    // Đối chứng dương trên CỤM CỦA KỊCH BẢN: một materialized view dựng LÚC CHẠY, ngoài migration — đúng chỗ hở mục (C) của
    // hardening không thấy — chép đơn giá ra; cùng bộ quét phải kể nó.
    await db.pool.query("CREATE MATERIALIZED VIEW public.zz_doi_chung_don_gia AS SELECT payload -> 'lines' AS dong FROM public.rfq_unsealed_bids");
    try {
      expect((await quetGiaMoiQuanHe(db.pool, donGiaCua(GIA_SUA_LAI))).dinh).toEqual(["rfq_unsealed_bids", "zz_doi_chung_don_gia"]);
    } finally {
      await db.pool.query("DROP MATERIALIZED VIEW public.zz_doi_chung_don_gia");
    }
  }, 120000);

  it("bước 15 — sổ kiểm toán kể lại toàn bộ kịch bản, kể cả năm lần đăng nhập qua TOTP, theo đúng thứ tự", async () => {
    const { rows } = await db.pool.query<{ action: string }>("SELECT action FROM audit_events WHERE org_id = $1 ORDER BY seq", [orgA]);
    const cac = rows.map((r) => r.action);
    for (const moc of ["RFQ_CREATED", "RFQ_SUBMITTED_FOR_APPROVAL", "RFQ_APPROVED", "RFQ_KEY_MATERIAL_ISSUED", "RFQ_OPENED", "GUEST_SESSION_STARTED", "RFQ_CLOSED", "UNSEAL_REQUESTED", "UNSEAL_APPROVED", "UNSEAL_DISPATCHED", "RFQ_KEY_MATERIAL_UNWRAPPED", "RFQ_UNSEALED"]) {
      expect(cac, `sổ kiểm toán thiếu mốc ${moc}`).toContain(moc);
    }
    // [S1.109] Hai khẳng định này trộn `indexOf` với `lastIndexOf`, và câu ấy chỉ đúng khi kho
    // có ĐÚNG MỘT lượt mở thầu. Vòng BAFO cho lượt thứ hai, nên `lastIndexOf("UNSEAL_APPROVED")`
    // trỏ vào phê duyệt của vòng HAI còn `indexOf("RFQ_KEY_MATERIAL_UNWRAPPED")` trỏ vào lần mở
    // bọc của vòng MỘT — so hai vòng khác nhau, và nó ĐỎ. Nay khẳng định theo TỪNG vòng: lần đầu
    // so với lần đầu, lần cuối so với lần cuối — mạnh hơn bản cũ, vì nó đòi trật tự ấy ở CẢ HAI.
    for (const lay of [
      (a: string) => cac.indexOf(a),
      (a: string) => cac.lastIndexOf(a),
    ]) {
      expect(lay("RFQ_KEY_MATERIAL_UNWRAPPED")).toBeGreaterThan(lay("UNSEAL_APPROVED"));
      expect(lay("RFQ_UNSEALED")).toBeGreaterThan(lay("RFQ_KEY_MATERIAL_UNWRAPPED"));
    }
    // Và hai vòng là HAI, không một — nếu khối BAFO ở trên lặng lẽ không chạy, hai dòng này đỏ.
    expect(cac.filter((a) => a === "RFQ_UNSEALED")).toHaveLength(2);
    expect(cac.filter((a) => a === "RFQ_BAFO_ROUND_OPENED")).toHaveLength(1);
    // [S1.110 / S2.6] Hành động CUỐI để lại ĐÚNG hai dòng, và thứ tự của chúng là một phần
    // của mệnh đề: một đề xuất rồi một lần duyệt, không bao giờ ngược lại.
    expect(cac.filter((a) => a === "RFQ_AWARD_PROPOSED")).toHaveLength(1);
    expect(cac.filter((a) => a === "RFQ_AWARD_APPROVED")).toHaveLength(1);
    expect(cac.indexOf("RFQ_AWARD_APPROVED")).toBeGreaterThan(cac.indexOf("RFQ_AWARD_PROPOSED"));
    // ...và lần đề xuất đứng SAU lượt chấm cuối: award dựa trên bảng xếp hạng SAU BAFO.
    expect(cac.indexOf("RFQ_AWARD_PROPOSED")).toBeGreaterThan(cac.lastIndexOf("RFQ_EVALUATED"));
    // Năm phiên khách của kịch bản + MỘT của RFQ hy sinh mà bộ quét (sổ nợ 49) mở để nộp một phong bì thật.
    expect(cac.filter((a) => a === "GUEST_SESSION_STARTED")).toHaveLength(6);
    // [S1.193 / S3.2c / ADR-113] Thứ tự MỜI của gói chính: luồng S3 mời TRƯỚC khi nộp duyệt, luồng MVP1 SAU khi mở; ở cả hai,
    // không token mời nào trước lần mở gói (K6). Hàng token mang id của TOKEN — lời mời của nó nằm ở payload.
    const cuaGoi = new Set([trangThai.rfqId, ...trangThai.loiMoi.map((l) => l.invitationId)]);
    const { rows: theoGoi } = await db.pool.query<{ action: string; khoa: string | null }>(
      "SELECT action, CASE WHEN action = 'MAGIC_LINK_TOKEN_ISSUED' THEN payload->>'invitationId' ELSE resource_id::text END AS khoa " +
        "FROM audit_events WHERE org_id = $1 ORDER BY seq",
      [orgA],
    );
    const mocGoi = theoGoi.filter((r) => r.khoa !== null && cuaGoi.has(r.khoa)).map((r) => r.action);
    expect(mocGoi.filter((a) => a === "INVITATION_CREATED")).toHaveLength(5);
    if (batS3) {
      expect(mocGoi.lastIndexOf("INVITATION_CREATED"), "luồng S3: cả năm lời mời có TRƯỚC lần nộp duyệt").toBeLessThan(mocGoi.indexOf("RFQ_SUBMITTED_FOR_APPROVAL"));
    } else {
      expect(mocGoi.indexOf("INVITATION_CREATED"), "luồng MVP1: mời SAU khi mở gói").toBeGreaterThan(mocGoi.indexOf("RFQ_OPENED"));
    }
    expect(mocGoi.indexOf("MAGIC_LINK_TOKEN_ISSUED"), "không token mời nào trước lần mở gói (K6)").toBeGreaterThan(mocGoi.indexOf("RFQ_OPENED"));
    // Không một dòng sổ nào mang giá — sổ là bằng chứng, không phải nơi rò.
    const { rows: so } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND payload::text LIKE '%' || $2 || '%'", [orgA, GIA_SUA_LAI]);
    expect(so[0]?.n).toBe("0");
    // Và token, mã OTP, bí mật TOTP không ở đâu trong sổ. [bước 0 đợt 2] So theo RANH GIỚI token, không `LIKE '%…%'` trần: một mã OTP
    // sáu chữ số trùng ngẫu nhiên với sáu ký tự liền của một UUID hay một chuỗi hex trong payload (đo: một lượt `pnpm evidence` đỏ
    // "expected '2' to be '0'", chạy riêng xanh) — một bí mật LỌT thật thì đứng nguyên vẹn giữa hai ký tự không phải chữ-số hex.
    for (const t of [...dv.linkDaGui.map((l) => l.token), ...dv.otpDaGui.map((o) => o.code), ...dv.loiMoiDaGui.map((l) => l.token)]) {
      const { rows: r2 } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND payload::text ~ ('(^|[^0-9A-Za-z])' || $2 || '($|[^0-9A-Za-z])')",
        [orgA, t],
      );
      expect(r2[0]?.n, "bí mật lọt vào sổ kiểm toán").toBe("0");
    }
    // Không log lỗi nào của tiến trình mang bất kỳ bí mật nào. [review H2-4 ⑵] Bản trước "chống rỗng
    // ruột" bằng `sha256(log).length === 64` — đúng cả với chuỗi rỗng. Nay ép MỘT 500 THẬT (bộ mở bí
    // mật TOTP ném, thông điệp cố ý mang phong bì) để log KHÔNG rỗng trước khi đòi nó sạch.
    const truocLog = logLoi.length;
    expect((await goi("POST", "/auth/link", undefined, { orgId: orgA, email: "mua@vidu.vn" })).status).toBe(200);
    await ob.chay(orgA);
    const tokenHong = dv.linkDaGui.at(-1)!.token;
    dv.hong.totpUnsealer = true;
    try {
      expect((await goi("POST", "/auth/totp", undefined, { orgId: orgA, token: tokenHong, code: "000000" })).status).toBe(500);
    } finally {
      dv.hong.totpUnsealer = false;
    }
    expect(logLoi.length).toBe(truocLog + 1);
    const toanBo = logLoi.join("\n");
    expect(toanBo.length).toBeGreaterThan(0);
    for (const t of [...dv.linkDaGui.map((l) => l.token), ...dv.otpDaGui.map((o) => o.code)]) expect(toanBo).not.toContain(t);
    expect(toanBo).not.toContain("KMS gia dang hong");
    for (const g of quetRoRi(toanBo)) expect.fail(`giá trong log: ${g}`);
  });

  it("[INV-K10a] bước 16 — [S3.6b2] ba gói 480/470/490 triệu cùng nhóm hàng qua HTTP: gói nộp sau cùng mang tín hiệu chia nhỏ, lần mở dừng ở 422 có tên, người tạo tự ghi nhận bị từ chối, người độc lập ghi nhận rồi gói mở — luồng MVP1 mở cả ba như trước", async () => {
    // Fixture spec S3 §7: mỗi gói dưới cận 1 tỷ của bậc 2 (§4.1), tổng 1,44 tỷ chạm cận ấy. Nhóm hàng RIÊNG: tập anh em của tín hiệu
    // là mọi gói cùng nhóm trong tổ chức, và hai gói hy sinh của bộ quét nằm ở nhóm của gói chính. Luồng MVP1: không nhóm hàng, không
    // bậc — lời duyệt không thân, và cả ba gói đi đúng đường cũ.
    const m = trangThai.mua.cookie;
    let nhomHang: string | null = null;
    if (batS3) {
      const nhom = await goi("POST", "/categories", trangThai.taiChinh.cookie, { ma: "thep-ct", ten: "Thep tam cho cong trinh" });
      expect(nhom.status, nhom.text).toBe(201);
      nhomHang = (nhom.body as { nhomHang: { id: string } }).nhomHang.id;
    }
    const goiCon: string[] = [];
    for (const [i, giaTri] of ["480000000.00", "470000000.00", "490000000.00"].entries()) {
      const r = await goi("POST", "/rfqs", m, {
        title: `Thep tam cong trinh ${i + 1}`,
        deadlineAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        ...(nhomHang === null ? {} : { categoryId: nhomHang }),
      });
      expect(r.status, r.text).toBe(201);
      const id = (r.body as { rfq: { id: string } }).rfq.id;
      expect((await goi("POST", `/rfqs/${id}/items`, m, { lineNo: 1, description: "Thep tam SS400 10mm", quantity: "150.0000", unit: "tan" })).status).toBe(201);
      const ns = await goi("PUT", `/rfqs/${id}/budget`, m, { estimatedValue: giaTri, currency: "VND" });
      expect(ns.status, ns.text).toBe(200);
      expect((ns.body as { budget: { requiresDualApproval: boolean } }).budget.requiresDualApproval, "dưới ngưỡng kép 500 triệu").toBe(false);
      // [S1.266 / S3.3c1] Luồng S3: bậc từ 100 triệu đòi BA nhà cung cấp đếm được (K2) — trước vòng này ba gói nộp duyệt không một
      // lời mời nào. Người mua mời ba nhà cung cấp phụ của bộ quét ở DRAFT. Tín hiệu chia nhỏ đọc ngân sách và nhóm hàng, không đọc
      // lời mời; `pm2` ký và nằm ngoài tập loại trừ, nên K5 của bậc (`ky_danh_sach_moi`) cho lần mở qua. Luồng MVP1: danh sách rỗng.
      // [S1.270 / S3.3d] Bậc ấy cũng xoay vòng (K3): gói i mời phụ 1, phụ 2 — đã mời ở gói trước — cộng phụ (3 + i), mới.
      for (const n of trangThai.nccPhu.filter((_, k) => k < 2 || k === 2 + i)) {
        const lm = await goi("POST", `/rfqs/${id}/invitations`, m, n);
        expect(lm.status, lm.text).toBe(201);
      }
      const nop = await goi("POST", `/rfqs/${id}/submit`, m);
      expect(nop.status, nop.text).toBe(200);
      const moc = batS3 ? { lanNop: (nop.body as { rfq: { lanNop: number } }).rfq.lanNop } : undefined;
      if (batS3) await khaiKhongXungDot(id, trangThai.pm2.cookie);
      expect((await goi("POST", `/rfqs/${id}/approve`, trangThai.pm2.cookie, moc)).status).toBe(200);
      goiCon.push(id);
      // Hai gói đầu: tổng 950 triệu chưa chạm cận — mở như mọi gói, ở cả hai luồng.
      if (i < 2) {
        const mo = await goi("POST", `/rfqs/${id}/open`, m);
        expect(mo.status, mo.text).toBe(200);
      }
    }
    const [g1, g2, g3] = goiCon;
    if (g1 === undefined || g2 === undefined || g3 === undefined) throw new Error("thieu goi cua buoc 16");
    const hangChot = async (): Promise<string[]> =>
      (
        await db.pool.query<{ ma: string }>(
          "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = ANY($2::uuid[]) ORDER BY seq",
          [orgA, goiCon],
        )
      ).rows.map((r) => r.ma);
    const docTinHieu = async (cookie: string): Promise<Record<string, unknown>> => {
      const ph = await goi("GET", `/rfqs/${g3}/signals`, cookie);
      expect(ph.status, ph.text).toBe(200);
      return (ph.body as { tinHieu: Record<string, unknown> }).tinHieu;
    };

    if (!batS3) {
      expect(await docTinHieu(m), "luồng MVP1: không tín hiệu, không ai được mời bấm").toMatchObject({
        hienTai: null,
        canGhiNhan: false,
        tinHieu: [],
        goi: {},
        nguoiXem: { ghiNhanDuoc: false, lyDo: null },
      });
      const mo = await goi("POST", `/rfqs/${g3}/open`, m);
      expect(mo.status, "luồng MVP1: gói thứ ba mở như hai gói đầu").toBe(200);
      const { rows } = await db.pool.query("SELECT 1 FROM governance_signals WHERE rfq_id = ANY($1::uuid[])", [goiCon]);
      expect(rows, "luồng MVP1: không một hàng tín hiệu nào").toHaveLength(0);
      expect(await hangChot(), "luồng MVP1: không một lần từ chối nào vào sổ").toEqual([]);
      return;
    }

    // Màn `/tao-thau` đọc route này trước khi mời bấm: người tạo đọc được lý do KHÔNG, người độc lập đọc được mình ghi nhận được —
    // và trong tổ chức hai người ghi nhận được (hai PM duyệt), không một con số tiền nào trong thân.
    const docMua = await docTinHieu(m);
    expect(docMua).toMatchObject({ canGhiNhan: true, nguoiXem: { ghiNhanDuoc: false, lyDo: CHOT_VAO_SO.K10A_TU_GHI_NHAN.thongDiep } });
    const docPm3 = await docTinHieu(trangThai.pm3.cookie);
    expect(docPm3).toMatchObject({ canGhiNhan: true, nguoiXem: { ghiNhanDuoc: true, lyDo: null }, soNguoiGhiNhanDuoc: 2 });
    expect(docPm3.goi).toEqual({
      [g1]: { tieuDe: "Thep tam cong trinh 1", trangThai: "OPEN" },
      [g2]: { tieuDe: "Thep tam cong trinh 2", trangThai: "OPEN" },
      [g3]: { tieuDe: "Thep tam cong trinh 3", trangThai: "PENDING_APPROVAL" },
    });
    expect(JSON.stringify(docPm3), "thân đọc tín hiệu không mang ước lượng nào").not.toMatch(/4[789]0000000/u);

    // Đủ chữ ký mà vẫn không mở: 422 với câu của bảng `CHOT_VAO_SO`, gói đứng yên, không khoá nào được đúc.
    const chan = await goi("POST", `/rfqs/${g3}/open`, m);
    expect(chan.status).toBe(422);
    expect(chan.text).toContain(CHOT_VAO_SO.TIN_HIEU_CHUA_GHI_NHAN.thongDiep);
    const { rows: khoa } = await db.pool.query("SELECT 1 FROM rfq_key_material WHERE rfq_id = $1", [g3]);
    expect(khoa, "không khoá nào được đúc cho gói bị chặn").toHaveLength(0);

    // Người tạo tự ghi nhận — màn đã nói trước là không; route từ chối theo chốt, và lần ấy cũng vào sổ.
    const tuGhi = await goi("POST", `/rfqs/${g3}/signals/acknowledge`, m, { lyDo: "Toi tao ca ba goi, toi xac nhan" });
    expect(tuGhi.status).toBe(422);
    expect(tuGhi.text).toContain(CHOT_VAO_SO.K10A_TU_GHI_NHAN.thongDiep);

    const LY_DO = "Ba cong trinh khac nhau, ba hop dong khung rieng";
    if (batS3) await khaiKhongXungDot(g3, trangThai.pm3.cookie);
    const ghi = await goi("POST", `/rfqs/${g3}/signals/acknowledge`, trangThai.pm3.cookie, { lyDo: LY_DO });
    expect(ghi.status, ghi.text).toBe(201);
    expect((ghi.body as { ghiNhan: { tinHieuMoi: boolean } }).ghiNhan.tinHieuMoi, "tập gói không đổi từ lúc nộp").toBe(false);
    const sau = await docTinHieu(m);
    expect(sau.canGhiNhan, "sau lần ghi nhận không còn gì cần ghi nhận").toBe(false);
    const mo = await goi("POST", `/rfqs/${g3}/open`, m);
    expect(mo.status, mo.text).toBe(200);
    expect((mo.body as { rfq: { status: string } }).rfq.status).toBe("OPEN");

    // Sổ kể lại câu chuyện của gói thứ ba theo đúng thứ tự: nộp và tín hiệu, duyệt, bị chặn, tự ghi nhận bị từ chối, ghi nhận độc
    // lập, rồi mới đúc khoá và mở.
    const { rows: soG3 } = await db.pool.query<{ action: string; ma: string | null; nguoi: string | null }>(
      "SELECT action, payload->>'ma' AS ma, actor_id::text AS nguoi FROM audit_events WHERE org_id = $1 AND resource_id = $2 ORDER BY seq",
      [orgA, g3],
    );
    const QUAN_TAM = new Set([
      "RFQ_SUBMITTED_FOR_APPROVAL",
      "GOVERNANCE_SIGNAL_RECORDED",
      "RFQ_APPROVED",
      "CONTROL_DENIED",
      "GOVERNANCE_SIGNAL_ACKNOWLEDGED",
      "RFQ_OPENED",
    ]);
    expect(soG3.filter((r) => QUAN_TAM.has(r.action)).map((r) => (r.ma === null ? r.action : `${r.action}:${r.ma}`))).toEqual([
      "RFQ_SUBMITTED_FOR_APPROVAL",
      "GOVERNANCE_SIGNAL_RECORDED",
      "RFQ_APPROVED",
      "CONTROL_DENIED:TIN_HIEU_CHUA_GHI_NHAN",
      "CONTROL_DENIED:K10A_TU_GHI_NHAN",
      "GOVERNANCE_SIGNAL_ACKNOWLEDGED",
      "RFQ_OPENED",
    ]);
    expect(soG3.find((r) => r.action === "GOVERNANCE_SIGNAL_ACKNOWLEDGED")?.nguoi, "người ghi nhận là người độc lập").toBe(trangThai.pm3.id);
    const hanhDong = soG3.map((r) => r.action);
    expect(hanhDong.indexOf("RFQ_KEY_MATERIAL_ISSUED"), "khoá chỉ được đúc SAU lần ghi nhận").toBeGreaterThan(
      hanhDong.indexOf("GOVERNANCE_SIGNAL_ACKNOWLEDGED"),
    );
    expect(await hangChot()).toEqual(["TIN_HIEU_CHUA_GHI_NHAN", "K10A_TU_GHI_NHAN"]);
  });

  it("[INV-K2] [INV-K5] [INV-K3] bước 17 — [S3.3e2] ngoại lệ cạnh tranh qua HTTP: gói MỘT nhà cung cấp bị K2 chặn lúc nộp, `SINGLE_SOURCE` cứu, chữ ký của người lập ngoại lệ bị K5 chặn lúc mở, người độc lập ký thì mở; gói mời lại nhà cung cấp cũ bị K3 chặn, `ROTATION` cứu — luồng MVP1: không chốt nào, ngoại lệ không lập được", async () => {
    // Hai gói ở bậc từ 100 triệu (§4.1: ba nhà cung cấp, ký danh sách, xoay vòng 5), một nhóm hàng RIÊNG — tổng 450 triệu, không cận
    // nào của K10a. Mỗi chốt đã có ca riêng ở `apps/api` (`canh-tranh-toi-thieu`, `xoay-vong`, `ngoai-le-canh-tranh`); bước này nối
    // chúng thành câu chuyện của màn `/tao-thau`, qua đúng các route màn gọi, và sổ kể lại theo thứ tự. Người lập ngoại lệ là `pm2` —
    // giữ `rfq.invite`, không tạo, không mời —, nên vào tập loại trừ của K5; `pm3` dựng mọi hồ sơ nhà cung cấp nên cũng ở đó. Người
    // ký độc lập là `pm4`, người dùng MỚI của bước này: thêm từ đầu luồng thì đổi số người ghi nhận được tín hiệu ở bước 16.
    const m = trangThai.mua.cookie;
    const taoGoi = async (tieuDe: string, giaTri: string, nhomHang: string | null): Promise<string> => {
      const r = await goi("POST", "/rfqs", m, {
        title: tieuDe,
        deadlineAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        ...(nhomHang === null ? {} : { categoryId: nhomHang }),
      });
      expect(r.status, r.text).toBe(201);
      const id = (r.body as { rfq: { id: string } }).rfq.id;
      expect((await goi("POST", `/rfqs/${id}/items`, m, { lineNo: 1, description: "Van dieu ap DN100 PN16", quantity: "4.0000", unit: "cai" })).status).toBe(201);
      const ns = await goi("PUT", `/rfqs/${id}/budget`, m, { estimatedValue: giaTri, currency: "VND" });
      expect(ns.status, ns.text).toBe(200);
      return id;
    };
    const NGOAI_LE_A = { loai: "SINGLE_SOURCE", maLyDo: "PROPRIETARY_TECHNOLOGY", giaiTrinh: "Chi mot hang giu ban quyen van dieu ap loai nay tai Viet Nam" };
    const hangChot = async (goiXet: readonly string[]): Promise<string[]> =>
      (
        await db.pool.query<{ ma: string }>(
          "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = ANY($2::uuid[]) ORDER BY seq",
          [orgA, goiXet],
        )
      ).rows.map((r) => r.ma);
    /** Câu chuyện của một gói trong sổ: chốt chặn, ngoại lệ, nộp, ký, mở — kèm người làm. */
    const tenNguoi = new Map([
      [trangThai.mua.id, "mua"],
      [trangThai.pm2.id, "pm2"],
    ]);
    const cauChuyen = async (rfqId: string): Promise<string[]> => {
      const QUAN_TAM = new Set(["CONTROL_DENIED", "SOURCING_EXCEPTION_CREATED", "RFQ_SUBMITTED_FOR_APPROVAL", "RFQ_APPROVED", "RFQ_OPENED"]);
      const { rows } = await db.pool.query<{ action: string; ma: string | null; nguoi: string | null }>(
        "SELECT action, payload->>'ma' AS ma, actor_id::text AS nguoi FROM audit_events WHERE org_id = $1 AND resource_id = $2 ORDER BY seq",
        [orgA, rfqId],
      );
      return rows
        .filter((r) => QUAN_TAM.has(r.action))
        .map((r) => `${r.ma === null ? r.action : `${r.action}:${r.ma}`}@${tenNguoi.get(r.nguoi ?? "") ?? "khac"}`);
    };

    // Đồ gá (khuôn đồ gá ⒜ của khối khoản 275 cuối tệp): bộ quét rò rỉ cố ý gọi mọi route bằng phiên `mua`, và mỗi lần từ chối tiêu
    // một suất của ngân sách 30 lần từ chối mỗi phiên mỗi cửa sổ 15 phút (ADR-092). Đo trên cây gộp với PR #251 (thêm route vào bộ
    // quét): phiên `mua` của luồng S3 tới đây đã 30/30, và lần từ chối CÓ CHỦ ĐÍCH đầu tiên của bước này (K2) nhận 429 thay vì 422.
    // Một người mua thật không quét mọi route. Xoá bucket người gọi của cụm test — bảng toàn cục, cụm của riêng tệp này — trả bước về
    // một cửa sổ mới; không lần từ chối nào bị bỏ khỏi sổ, và ba lần của bước vẫn đi qua đúng bucket ấy.
    await db.pool.query("DELETE FROM caller_rate_limits");

    if (!batS3) {
      // Luồng MVP1: K2/K3/K5 không sống ở tổ chức chưa bật — gói không lời mời nộp, ký và mở như bước 16; lập ngoại lệ dừng ở lời
      // từ chối *tổ chức chưa bật* của trigger (422 nghiệp vụ, không hàng ngoại lệ, không vào sổ chốt).
      const a = await taoGoi("Van dieu ap mot nguon", "200000000.00", null);
      const lap = await goi("POST", `/rfqs/${a}/exceptions`, trangThai.pm2.cookie, NGOAI_LE_A);
      expect(lap.status, "luồng MVP1: tổ chức chưa bật không lập được ngoại lệ").toBe(422);
      expect((await goi("POST", `/rfqs/${a}/submit`, m)).status).toBe(200);
      expect((await goi("POST", `/rfqs/${a}/approve`, trangThai.pm2.cookie)).status).toBe(200);
      const mo = await goi("POST", `/rfqs/${a}/open`, m);
      expect(mo.status, mo.text).toBe(200);
      const { rows } = await db.pool.query("SELECT 1 FROM rfq_sourcing_exceptions WHERE rfq_id = $1", [a]);
      expect(rows, "luồng MVP1: không một hàng ngoại lệ nào").toHaveLength(0);
      expect(await hangChot([a]), "luồng MVP1: không một lần từ chối nào vào sổ").toEqual([]);
      return;
    }

    const nhom = await goi("POST", "/categories", trangThai.taiChinh.cookie, { ma: "van", ten: "Van cong nghiep" });
    expect(nhom.status, nhom.text).toBe(201);
    const nhomHang = (nhom.body as { nhomHang: { id: string } }).nhomHang.id;

    // ── Gói A: MỘT nhà cung cấp đếm được, MỚI với mọi gói của người mua (MST, email, điện thoại xa mọi người trước) ──
    const a = await taoGoi("Van dieu ap mot nguon", "200000000.00", nhomHang);
    const nccMoi = await dungNccQuaHttp(
      trangThai.pm3,
      { ten: "Van cong nghiep Mot Nguon", mst: "0377001700", lienHe: "Kinh doanh mot nguon", email: "motnguon@ncc.vn", phone: "0937700170" },
      true,
    );
    const lmA = await goi("POST", `/rfqs/${a}/invitations`, m, nccMoi);
    expect(lmA.status, lmA.text).toBe(201);
    const idLoiMoiA = (lmA.body as { invitation: { id: string } }).invitation.id;

    // ⑴ K2: một nhóm đếm được, bậc đòi ba — 422 mang mã, màn đọc được cùng hai con số ở danh sách lời mời.
    const chanK2 = await goi("POST", `/rfqs/${a}/submit`, m);
    expect(chanK2.status).toBe(422);
    expect(chanK2.body).toEqual({ error: CHOT_VAO_SO.K2_THIEU_CANH_TRANH.thongDiep, ma: "K2_THIEU_CANH_TRANH" });
    const dsA = await goi("GET", `/rfqs/${a}/invitations`, m);
    expect(dsA.status, dsA.text).toBe(200);
    expect((dsA.body as { canhTranh: unknown }).canhTranh).toEqual({ soNhomDemDuoc: 1, toiThieu: 3 });

    // ⑵ pm2 lập `SINGLE_SOURCE` (một lời mời còn sống ⇒ đúng loại ấy); danh sách ngoại lệ mang lần nộp của CHÍNH gói.
    const lapA = await goi("POST", `/rfqs/${a}/exceptions`, trangThai.pm2.cookie, NGOAI_LE_A);
    expect(lapA.status, lapA.text).toBe(201);
    const nlA = await goi("GET", `/rfqs/${a}/exceptions`, m);
    expect(nlA.status, nlA.text).toBe(200);
    const goiA = await goi("GET", `/rfqs/${a}`, m);
    expect(nlA.body).toMatchObject({
      lanNop: (goiA.body as { rfq: { lanNop: number } }).rfq.lanNop,
      trangThai: "DRAFT",
      exceptions: [{ loai: "SINGLE_SOURCE", maLyDo: "PROPRIETARY_TECHNOLOGY", lapBoi: trangThai.pm2.id, rut: null }],
    });

    // ⑶ Lần nộp qua; pm2 ký trên lần nộp ấy.
    const nopA = await goi("POST", `/rfqs/${a}/submit`, m);
    expect(nopA.status, nopA.text).toBe(200);
    const mocA = { lanNop: (nopA.body as { rfq: { lanNop: number } }).rfq.lanNop };
    await khaiKhongXungDot(a, trangThai.pm2.cookie);
    expect((await goi("POST", `/rfqs/${a}/approve`, trangThai.pm2.cookie, mocA)).status).toBe(200);

    // ⑷ K5: đủ số chữ ký (gói dưới ngưỡng kép — một), nhưng người ký duy nhất là người lập ngoại lệ — một ngoại lệ không bao giờ tự
    // duyệt (spec §4.4). Gói đứng yên, không khoá nào được đúc, không link nào đi.
    const guiTruoc = dv.loiMoiDaGui.length;
    const chanK5 = await goi("POST", `/rfqs/${a}/open`, m);
    expect(chanK5.status).toBe(422);
    expect(chanK5.body).toEqual({ error: CHOT_VAO_SO.K5_THIEU_CHU_KY_DOC_LAP.thongDiep, ma: "K5_THIEU_CHU_KY_DOC_LAP" });
    const { rows: khoaA } = await db.pool.query("SELECT 1 FROM rfq_key_material WHERE rfq_id = $1", [a]);
    expect(khoaA, "không khoá nào được đúc cho gói bị chặn").toHaveLength(0);
    expect(dv.loiMoiDaGui, "không link nào đi khi gói bị chặn").toHaveLength(guiTruoc);

    // ⑸ Người ký độc lập: pm4 — không tạo, không mời, không dựng hồ sơ, không lập ngoại lệ. Gói mở; link đi tới đúng một lời mời.
    const pm4 = await dangNhap("pm4@vidu.vn", "PROCUREMENT_MANAGER");
    tenNguoi.set(pm4.id, "pm4");
    await khaiKhongXungDot(a, pm4.cookie);
    expect((await goi("POST", `/rfqs/${a}/approve`, pm4.cookie, mocA)).status).toBe(200);
    const moA = await goi("POST", `/rfqs/${a}/open`, m);
    expect(moA.status, moA.text).toBe(200);
    expect((moA.body as { rfq: { status: string } }).rfq.status).toBe("OPEN");
    expect(dv.loiMoiDaGui.slice(guiTruoc).map((l) => l.invitationId)).toEqual([idLoiMoiA]);
    expect(await cauChuyen(a)).toEqual([
      "CONTROL_DENIED:K2_THIEU_CANH_TRANH@mua",
      "SOURCING_EXCEPTION_CREATED@pm2",
      "RFQ_SUBMITTED_FOR_APPROVAL@mua",
      "RFQ_APPROVED@pm2",
      "CONTROL_DENIED:K5_THIEU_CHU_KY_DOC_LAP@mua",
      "RFQ_APPROVED@pm4",
      "RFQ_OPENED@mua",
    ]);

    // ── Gói B: ba nhà cung cấp phụ đầu — đếm được, nhưng đã có trong các gói gần đây của người mua (bước 16, và gói A vừa mở) ──
    const b = await taoGoi("Van dieu ap thay the", "250000000.00", nhomHang);
    for (const n of trangThai.nccPhu.slice(0, 3)) {
      const lm = await goi("POST", `/rfqs/${b}/invitations`, m, n);
      expect(lm.status, lm.text).toBe(201);
    }
    const chanK3 = await goi("POST", `/rfqs/${b}/submit`, m);
    expect(chanK3.status).toBe(422);
    expect(chanK3.body).toEqual({ error: CHOT_VAO_SO.K3_KHONG_XOAY_VONG.thongDiep, ma: "K3_KHONG_XOAY_VONG" });
    const lapB = await goi("POST", `/rfqs/${b}/exceptions`, trangThai.pm2.cookie, {
      loai: "ROTATION",
      maLyDo: "EXISTING_CONTRACT",
      giaiTrinh: "Ba nha cung cap dang giu hop dong khung bao tri van den het quy",
    });
    expect(lapB.status, lapB.text).toBe(201);
    const nopB = await goi("POST", `/rfqs/${b}/submit`, m);
    expect(nopB.status, nopB.text).toBe(200);
    await khaiKhongXungDot(b, pm4.cookie);
    expect((await goi("POST", `/rfqs/${b}/approve`, pm4.cookie, { lanNop: (nopB.body as { rfq: { lanNop: number } }).rfq.lanNop })).status).toBe(200);
    const moB = await goi("POST", `/rfqs/${b}/open`, m);
    expect(moB.status, moB.text).toBe(200);
    expect(await cauChuyen(b)).toEqual([
      "CONTROL_DENIED:K3_KHONG_XOAY_VONG@mua",
      "SOURCING_EXCEPTION_CREATED@pm2",
      "RFQ_SUBMITTED_FOR_APPROVAL@mua",
      "RFQ_APPROVED@pm4",
      "RFQ_OPENED@mua",
    ]);
    expect(await hangChot([a, b])).toEqual(["K2_THIEU_CANH_TRANH", "K5_THIEU_CHU_KY_DOC_LAP", "K3_KHONG_XOAY_VONG"]);
  });
});

// ===============================================================================================
// [S1.243 / khoản 275 / ADR-129 §3] CÂU SUY PHONG BÌ HỎNG NGOÀI SỔ — ĐO TRÊN LƯỢT MỞ THẦU VÒNG BAFO
//
// ADR-129 cắt `failedBidVersionIds` của hai bản ghi sổ mở thầu còn K = 20 id ĐẦU và nói phần còn lại SUY được bằng
// MỘT câu SQL (§3), câu ấy lọc `v.bafo_round_id IS NOT DISTINCT FROM r.bafo_round_id`. §S1.221 đo nó ở
// `unseal-worker.int.test.ts` (N = 50, N = 20) nhưng CHỈ với `bafo_round_id` NULL (vòng một); kịch bản 41 ở trên có lượt
// BAFO thật mà 0 phong bì hỏng (bước 12e: `failedBidVersionIds` rỗng). Khối này là phép đo còn thiếu — khoản 275, phần
// BAFO (câu 9 của kế hoạch đợt 3; công cụ/route đọc cho người vận hành HOÃN, hàng sổ giữ MỞ phần ấy). Một gói RIÊNG
// của một tổ chức RIÊNG, đi qua HTTP như kịch bản: 23 nhà cung cấp nộp vòng một (phong bì tốt; thêm luồng thứ 24, dưới),
// mở thầu, chấm, vòng BAFO mời top-22; 21 người nộp lại phong bì HỎNG — niêm phong cho một RFQ KHÁC: hình dạng đúng nên `POST /guest/bids` nhận và
// ký biên nhận, `unsealBid` từ chối —, 1 người nộp lại phong bì tốt, người thứ 23 (ngoài top-N) không nộp lại. Worker
// mở vòng hai, rồi đo:
//   ⑴ hai bản ghi sổ của lượt BAFO: `failedCount` 21, đúng K = 20 id ĐẦU, cờ cắt bật, `bafoRoundId` của vòng;
//   ⑵ câu §3 — ĐỌC NGUYÊN VĂN từ `docs/DECISIONS.md` (ADR-129), không chép — trả ĐÚNG 21 id theo thứ tự luồng: 20 đầu bằng
//      payload, cả 21 bằng mảng đủ trong tiến trình và bằng tập phong bì hỏng đã nộp; chạy dưới superuser (người vận
//      hành) VÀ trong phiên `app_api` gắn tổ chức — hai nơi ADR-129 §3 nói câu chạy được;
//   ⑶ ĐỐI CHỨNG vế vòng: cùng câu gỡ vế `IS NOT DISTINCT FROM r.bafo_round_id` trả ~~23~~ [S1.249 / khoản 298] 22 id —
//      phong bì VÒNG MỘT của người thứ 23 ~~và của luồng đã thu hồi (dưới)~~, không có hàng bản rõ dưới yêu cầu vòng hai, lọt
//      vào — tức vế ấy CHỊU LỰC ở vòng BAFO. [S1.249] Luồng đã thu hồi (dưới) nay bị vế `i.revoked_at IS NULL` của câu §3 loại
//      trước cả vế vòng.
// Và một luồng THỨ 24: nộp vòng một rồi bị thu hồi ở `CLOSED`, trước lần mở (ADR-128 cho phép tới lần mở đầu tiên) —
// worker không mở nó, lượt chấm không thấy nó, nó không vào top-N. ~~Với YÊU CẦU VÒNG MỘT, câu §3 trả ĐÚNG id của luồng ấy
// dù hai bản ghi sổ vòng một mang `failedCount` 0: câu §3 không mang vế `i.revoked_at IS NULL` của ADR-128 (hai ADR cùng đợt
// 2, hai lô song song), nên luồng BỊ LOẠI được suy thành phong bì HỎNG. Lỗ kề, ngoài phạm vi khoản 275 (vòng một; ở vòng BAFO
// luồng đã thu hồi không có phiên bản nào nên vế vòng đã loại nó) — khoản 298, GHIM ở ca cuối để lần sửa ADR-129 §3 đỏ đúng
// đó.~~ [S1.249 / khoản 298] Câu §3 nay mang vế `i.revoked_at IS NULL` của ADR-128: với YÊU CẦU VÒNG MỘT nó trả 0 id, khớp
// `failedCount` 0 của hai bản ghi sổ; gỡ vế ấy thì trả đúng id của luồng đã thu hồi (ca cuối — đo trước bản vá: câu cũ trả
// đúng id ấy, ca ghim ở §S1.243).
//
// Hai điểm đồ gá, nói ra: ⒜ cụm test có MỘT địa chỉ người gọi, và `issueOtpChallenge` khoá người gọi sau
// `OTP_MAX_PER_CALLER` = 10 lần mỗi 15 phút mỗi tổ chức — 24 nhà cung cấp thật đến từ 24 địa chỉ, nên ngay trước mỗi lần
// xin OTP khối này xoá bucket `CALLER` của tổ chức (superuser); mọi bucket khác giữ nguyên. ⒝ tổ chức và người dùng dựng
// như `dungToChuc` (không gọi lại nó: hai slug của nó đã dùng), ngưỡng phê duyệt kép đặt TRÊN ngân sách — một chữ ký mở
// gói, một chữ ký mở thầu —, vì thứ đo ở đây là câu suy, không phải D2. Không nhãn INV.
// ===============================================================================================
describe("[S1.243 / khoản 275] câu suy phong bì hỏng của ADR-129 §3 trên lượt mở thầu VÒNG BAFO — 21 phong bì hỏng ⇒ câu suy trả 21 id, 20 đầu là K id của payload", () => {
  /** Số nhà cung cấp CÒN SỐNG nộp vòng một (không kể luồng thu hồi); `bafoTopN` của chính sách; số phong bì hỏng ở vòng BAFO. */
  const SO_NCC = 23;
  const TOP_N = 22;
  const SO_HONG = 21;
  /** K của ADR-129 — hằng `FAILED_BID_VERSION_IDS_AUDIT_CAP` (ghim ở `unseal-worker.int.test.ts`); viết số ở đây để lần đổi K phải đi qua phép đo này. */
  const K_ADR_129 = 20;
  /** RFQ mà phong bì hỏng được niêm phong cho — cùng giá trị fixture `unseal-worker.int.test.ts` dùng cho ca `unsealBid` từ chối. */
  const RFQ_KHAC = "99999999-9999-4999-8999-999999999999";
  /** Giá vòng một: 700 triệu + i × 7 triệu — không trùng giá nào của `MOI_GIA`; người thứ 23 đắt nhất nên đứng ngoài top-22. */
  const giaVongMot = (i: number): string => `${String(700_000_000 + i * 7_000_000)}.00`;
  const GIA_BAFO_TOT = "690000000.00";
  /** Bản rõ bên trong một phong bì hỏng — không bao giờ mở được, nên không bao giờ thành một giá. */
  const GIA_BAFO_HONG = "680000000.00";
  /** Luồng thứ 24 — bị thu hồi ở `CLOSED`, trước lần mở. Giá RẺ NHẤT: nếu một bộ đọc quên vế thu hồi, nó lên hạng 1. */
  const TEN_NCC_THU_HOI = "NCC K275 THU HOI";
  const GIA_NCC_THU_HOI = "650000000.00";

  interface NccK275 {
    readonly ten: string;
    readonly cookie: string;
    /** Phiên bản vòng một (biên nhận của `POST /guest/bids`). */
    readonly v1: string;
  }
  interface PayloadMoThau {
    readonly bafoRoundId: string | null;
    readonly opened: number;
    readonly failedCount: number;
    readonly failedBidVersionIds: readonly string[];
    readonly failedBidVersionIdsTruncated: boolean;
  }
  interface TrangThaiK275 {
    mua: Nguoi;
    pm2: Nguoi;
    gd1: Nguoi;
    taiChinh: Nguoi;
    rfqId: string;
    ncc: NccK275[];
    ycVongMot: string;
    bafoRoundId: string;
    /** Tên nhà cung cấp trong top-N, theo HẠNG — suy từ `GET /ranking`, không gõ tay. */
    topTheoHang: string[];
    ycVongBafo: string;
    /** Phong bì hỏng đã nộp ở vòng BAFO (biên nhận), theo thứ tự nộp. */
    vBafoHong: string[];
    vBafoTot: string;
    /** Phiên bản vòng một của người ngoài top-N — người không nộp lại. */
    v1NguoiNgoai: string;
    /** Lời mời và phiên bản vòng một của luồng thứ 24 — thu hồi ở `CLOSED`, trước lần mở. */
    loiMoiThuHoi: string;
    v1ThuHoi: string;
    /** Mảng ĐỦ trong tiến trình của lượt mở thầu vòng BAFO. */
    hongTrongTienTrinh: readonly string[];
  }
  const st: TrangThaiK275 = {
    mua: { id: "", cookie: "" },
    pm2: { id: "", cookie: "" },
    gd1: { id: "", cookie: "" },
    taiChinh: { id: "", cookie: "" },
    rfqId: "",
    ncc: [],
    ycVongMot: "",
    bafoRoundId: "",
    topTheoHang: [],
    ycVongBafo: "",
    vBafoHong: [],
    vBafoTot: "",
    v1NguoiNgoai: "",
    loiMoiThuHoi: "",
    v1ThuHoi: "",
    hongTrongTienTrinh: [],
  };

  /** Câu §3 của ADR-129, đọc NGUYÊN VĂN từ `docs/DECISIONS.md`: khối ```sql DUY NHẤT của mục ADR-129, bỏ thụt lề danh sách. */
  async function cauSuyCuaAdr129(): Promise<string> {
    // [Windows, 2026-10-01] Checkout Windows (`core.autocrlf=true`; `.gitattributes` không ghim `.md`) cho tệp này CRLF, và khối
    // ```sql dưới khớp bằng `\n` — chuẩn hoá xuống dòng trước khi tách, chữ của câu §3 không đổi.
    const vanBan = (await readFile(fileURLToPath(new URL("../../../docs/DECISIONS.md", import.meta.url)), "utf8")).replace(/\r\n/gu, "\n");
    const dau = vanBan.indexOf("\n## ADR-129 ");
    expect(dau, "không thấy mục ADR-129 trong docs/DECISIONS.md").toBeGreaterThan(0);
    const cuoi = vanBan.indexOf("\n## ADR-", dau + 1);
    const muc = vanBan.slice(dau, cuoi < 0 ? undefined : cuoi);
    expect(muc.split("```sql").length - 1, "ADR-129 phải có ĐÚNG MỘT khối ```sql — câu §3").toBe(1);
    const khoi = /```sql\n([\s\S]*?)\n[ ]*```/u.exec(muc);
    if (khoi?.[1] === undefined) throw new Error("ADR-129: khối ```sql không đóng");
    const cau = khoi[1].split("\n").map((d) => d.replace(/^ {3}/u, "")).join("\n").trim();
    expect(cau, "câu §3 phải mang vế vòng — thứ khối này đo").toContain("AND v.bafo_round_id IS NOT DISTINCT FROM r.bafo_round_id");
    return cau;
  }

  /** Nhà cung cấp nộp một phong bì qua HTTP — niêm phong cho `niemPhongCho` bằng khoá công khai THẬT của gói. Trả id phiên bản. */
  async function nopQuaHttp(cookie: string, niemPhongCho: string, gia: string, ten: string): Promise<string> {
    const r = await goi("GET", "/guest/rfq", cookie);
    expect(r.status, r.text).toBe(200);
    const khoa = (r.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256");
    if (khoa === undefined) throw new Error("goi thau khong co khoa ECDH_P256 qua HTTP");
    const phongBi = await sealBid({
      rfqId: niemPhongCho,
      algorithm: "ECDH_P256",
      recipientPublicKey: new Uint8Array(Buffer.from(khoa.publicKey, "base64")),
      plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: gia, currency: "VND", nhaCungCap: ten })),
    });
    const bn = await goi("POST", "/guest/bids", cookie, { envelope: Buffer.from(phongBi).toString("base64") });
    expect(bn.status, `${ten}: ${bn.text}`).toBe(201);
    return (bn.body as { receipt: { bidVersionId: string } }).receipt.bidVersionId;
  }

  /** Một nhà cung cấp, một người liên hệ, một lời mời qua HTTP; mở phiên khách qua link bộ gửi nhận; nộp vòng một bằng phong bì TỐT. */
  async function moiVaNopVongMot(ten: string, so: string, gia: string): Promise<{ invitationId: string; cookie: string; v1: string }> {
    const m = st.mua.cookie;
    const s = await goi("POST", "/suppliers", m, { legalName: ten, taxCode: `03100000${so}` });
    expect(s.status, s.text).toBe(201);
    const supplierId = (s.body as { supplier: { id: string } }).supplier.id;
    const c = await goi("POST", `/suppliers/${supplierId}/contacts`, m, { fullName: `Kinh doanh K275 ${so}`, email: `k275-${so}@ncc.vn`, phone: `09120000${so}` });
    expect(c.status, c.text).toBe(201);
    const contactId = (c.body as { contact: { id: string } }).contact.id;
    const truoc = dv.loiMoiDaGui.length;
    const lm = await goi("POST", `/rfqs/${st.rfqId}/invitations`, m, { supplierId, contactId });
    expect(lm.status, lm.text).toBe(201);
    expect(dv.loiMoiDaGui).toHaveLength(truoc + 1);
    // Đồ gá ⒜ (khối đầu): một địa chỉ người gọi thay cho 24 — chỉ bucket `CALLER` của CHÍNH tổ chức này.
    await db.pool.query("DELETE FROM otp_rate_limits WHERE org_id = $1 AND bucket_kind = 'CALLER'", [orgA]);
    const cookie = await moPhienKhach(dv.loiMoiDaGui.at(-1)!.token);
    return { invitationId: (lm.body as { invitation: { id: string } }).invitation.id, cookie, v1: await nopQuaHttp(cookie, st.rfqId, gia, ten) };
  }

  /** Xin mở thầu, một giám đốc duyệt, người mua điều phối — cổng bốn vế qua HTTP; rồi worker mở (không qua HTTP, như bước 11). */
  async function moThauQuaCong(lyDo: string): Promise<{ ycId: string; kq: Awaited<ReturnType<typeof executeUnsealRequest>> }> {
    const yc = await goi("POST", `/rfqs/${st.rfqId}/unseal`, st.mua.cookie, { reason: lyDo });
    expect(yc.status, yc.text).toBe(201);
    const ycId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;
    const duyet = await goi("POST", `/unseal/${ycId}/approve`, st.gd1.cookie);
    expect(duyet.status, duyet.text).toBe(200);
    expect((duyet.body as { unsealRequest: { status: string } }).unsealRequest.status, "một chữ ký là đủ dưới ngưỡng kép").toBe("APPROVED");
    const dp = await goi("POST", `/unseal/${ycId}/dispatch`, st.mua.cookie);
    expect(dp.status, dp.text).toBe(200);
    const kq = await withTenant(unsealPool, orgA, (c) => executeUnsealRequest(c, orgA, { unsealRequestId: ycId, unwrapper: boMoBoc }, unsealPool));
    return { ycId, kq };
  }

  beforeAll(async () => {
    goc = gocMacDinh;
    orgA =
      (
        await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
          "Cong ty Mua Sam K275",
          "cong-ty-k275",
        ])
      ).rows[0]?.id ?? "";
    st.mua = await dangNhap("mua-k275@vidu.vn", "PROCUREMENT_MANAGER");
    st.pm2 = await dangNhap("pm2-k275@vidu.vn", "PROCUREMENT_MANAGER");
    st.gd1 = await dangNhap("gd1-k275@vidu.vn", "DIRECTOR");
    st.taiChinh = await dangNhap("taichinh-k275@vidu.vn", "FINANCE");
  }, 240000);

  it("dựng qua HTTP: chính sách top-N 22, gói 1 tỷ dưới ngưỡng kép, 24 nhà cung cấp được mời, mở phiên khách và nộp vòng một bằng phong bì TỐT", async () => {
    const m = st.mua.cookie;
    const cs = await goi("POST", "/policy", st.taiChinh.cookie, {
      version: 1,
      dualApprovalThreshold: "5000000000.00",
      currency: "VND",
      evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }],
      bafoTopN: TOP_N,
    });
    expect(cs.status, cs.text).toBe(201);
    const rfq = await goi("POST", "/rfqs", m, { title: "Thep tam — do cau suy BAFO", deadlineAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
    expect(rfq.status, rfq.text).toBe(201);
    st.rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    expect((await goi("POST", `/rfqs/${st.rfqId}/items`, m, { lineNo: 1, description: "Thep tam SS400 10mm", quantity: "100.0000", unit: "tam" })).status).toBe(201);
    const ns = await goi("PUT", `/rfqs/${st.rfqId}/budget`, m, { estimatedValue: NGAN_SACH, currency: "VND" });
    expect(ns.status, ns.text).toBe(200);
    expect((ns.body as { budget: { requiresDualApproval: boolean } }).budget.requiresDualApproval).toBe(false);
    expect((await goi("POST", `/rfqs/${st.rfqId}/submit`, m)).status).toBe(200);
    expect((await goi("POST", `/rfqs/${st.rfqId}/approve`, st.pm2.cookie)).status).toBe(200);
    const mo = await goi("POST", `/rfqs/${st.rfqId}/open`, m);
    expect(mo.status, mo.text).toBe(200);

    for (let i = 0; i < SO_NCC; i++) {
      const so = String(i).padStart(2, "0");
      const ten = `NCC K275 ${so}`;
      const { cookie, v1 } = await moiVaNopVongMot(ten, so, giaVongMot(i));
      st.ncc.push({ ten, cookie, v1 });
    }
    expect(st.ncc).toHaveLength(SO_NCC);
    const thuHoi = await moiVaNopVongMot(TEN_NCC_THU_HOI, String(SO_NCC), GIA_NCC_THU_HOI);
    st.loiMoiThuHoi = thuHoi.invitationId;
    st.v1ThuHoi = thuHoi.v1;
  }, 240000);

  it("vòng một: thu hồi luồng thứ 24 ở CLOSED, cổng bốn vế, worker mở 23 phong bì (0 hỏng, luồng đã thu hồi không mở), chấm qua HTTP, mở vòng BAFO — top-22 suy từ bảng xếp hạng, người đắt nhất đứng ngoài", async () => {
    const m = st.mua.cookie;
    expect((await goi("POST", `/rfqs/${st.rfqId}/close`, m, { reason: "dong som de do cau suy vong BAFO" })).status).toBe(200);
    // ADR-128: thu hồi còn được tới lần mở đầu tiên — và nó LOẠI luồng ấy khỏi lượt mở thầu, bảng so sánh, lượt chấm.
    const thuHoi = await goi("POST", `/invitations/${st.loiMoiThuHoi}/revoke`, m);
    expect(thuHoi.status, thuHoi.text).toBe(200);
    expect(thuHoi.body).toEqual({ revoked: true });
    const { ycId, kq } = await moThauQuaCong("het han nop, mo thau vong mot");
    st.ycVongMot = ycId;
    expect([kq.opened, kq.failedBidVersionIds], "vòng một: 23 phong bì tốt mở, luồng đã thu hồi không mở và không hỏng").toEqual([SO_NCC, []]);

    const cham = await goi("POST", `/rfqs/${st.rfqId}/evaluate`, m, {});
    expect(cham.status, cham.text).toBe(201);
    const bafo = await goi("POST", `/rfqs/${st.rfqId}/bafo`, m, { deadlineAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString() });
    expect(bafo.status, bafo.text).toBe(201);
    const vong = (bafo.body as { bafoRound: { bafoRoundId: string; topN: number } }).bafoRound;
    expect(vong.topN).toBe(TOP_N);
    st.bafoRoundId = vong.bafoRoundId;

    const bxh = await goi("GET", `/rfqs/${st.rfqId}/ranking`, m);
    expect(bxh.status, bxh.text).toBe(200);
    const hang = (bxh.body as { ranking: { rows: { supplierName: string; rank: number | null }[] } }).ranking.rows;
    expect(hang).toHaveLength(SO_NCC);
    // Ai trong top-N thì SUY từ bảng xếp hạng, như bước 12c — giá tăng theo thứ tự mời nên hạng phải đúng thứ tự ấy.
    st.topTheoHang = hang
      .filter((h) => h.rank !== null && h.rank <= TOP_N)
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .map((h) => h.supplierName);
    expect(st.topTheoHang).toEqual(st.ncc.slice(0, TOP_N).map((x) => x.ten));
    const ngoai = hang.filter((h) => h.rank === null || h.rank > TOP_N).map((h) => h.supplierName);
    expect(ngoai, "đúng một người ngoài top-22: người đắt nhất").toEqual([st.ncc[SO_NCC - 1]?.ten]);
    st.v1NguoiNgoai = st.ncc.find((x) => x.ten === ngoai[0])?.v1 ?? "";
    expect(st.v1NguoiNgoai).not.toBe("");
  }, 240000);

  it("vòng BAFO qua HTTP: 21 người trong top-22 nộp lại phong bì HỎNG (niêm phong cho RFQ khác — nhận, ký biên nhận), hạng 1 nộp lại phong bì tốt; đóng vòng, cổng bốn vế lần hai, worker mở 1, 21 hỏng", async () => {
    for (const [j, ten] of st.topTheoHang.entries()) {
      const ncc = st.ncc.find((x) => x.ten === ten);
      if (ncc === undefined) throw new Error(`khong thay nha cung cap ${ten}`);
      if (j === 0) st.vBafoTot = await nopQuaHttp(ncc.cookie, st.rfqId, GIA_BAFO_TOT, ten);
      else st.vBafoHong.push(await nopQuaHttp(ncc.cookie, RFQ_KHAC, GIA_BAFO_HONG, ten));
    }
    expect(st.vBafoHong).toHaveLength(SO_HONG);
    // Tiền đề: 22 phiên bản mới mang ĐÚNG dấu vòng — C1 đặt, J4 cho qua vì cả 22 luồng nằm trong top-N.
    const { rows: dau } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM vendor_bid_versions WHERE org_id = $1 AND bafo_round_id = $2",
      [orgA, st.bafoRoundId],
    );
    expect(dau[0]?.n).toBe(String(TOP_N));

    expect((await goi("POST", `/rfqs/${st.rfqId}/bafo/close`, st.mua.cookie)).status).toBe(200);
    const { ycId, kq } = await moThauQuaCong("het han vong BAFO, mo phong bi vong hai");
    st.ycVongBafo = ycId;
    st.hongTrongTienTrinh = kq.failedBidVersionIds;
    expect(kq.opened, "vòng hai: đúng MỘT phong bì tốt").toBe(1);
    expect(kq.failedBidVersionIds, "mảng trong tiến trình KHÔNG cắt (ADR-129 ⑷)").toHaveLength(SO_HONG);
    expect([...kq.failedBidVersionIds].sort()).toEqual([...st.vBafoHong].sort());
    const { rows: tt } = await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [st.rfqId]);
    expect(tt[0]?.status).toBe("BAFO_UNSEALED");
  }, 240000);

  it("⑴ hai bản ghi sổ của lượt BAFO: `failedCount` 21, ĐÚNG 20 id đầu theo thứ tự luồng, cờ cắt bật, mang dấu vòng", async () => {
    const { rows: so } = await db.pool.query<{ action: string; payload: PayloadMoThau }>(
      "SELECT action, payload FROM audit_events WHERE org_id = $1 AND resource_id = $2 " +
        " AND action IN ('RFQ_KEY_MATERIAL_UNWRAPPED', 'RFQ_UNSEALED') AND payload->>'unsealRequestId' = $3 ORDER BY seq",
      [orgA, st.rfqId, st.ycVongBafo],
    );
    expect(so.map((b) => b.action)).toEqual(["RFQ_KEY_MATERIAL_UNWRAPPED", "RFQ_UNSEALED"]);
    for (const b of so) {
      expect(b.payload.bafoRoundId, b.action).toBe(st.bafoRoundId);
      expect(b.payload.opened, b.action).toBe(1);
      expect(b.payload.failedCount, b.action).toBe(SO_HONG);
      expect(b.payload.failedBidVersionIdsTruncated, b.action).toBe(true);
      expect(b.payload.failedBidVersionIds, `${b.action}: K = ${String(K_ADR_129)} id ĐẦU của mảng đủ`).toEqual(
        st.hongTrongTienTrinh.slice(0, K_ADR_129),
      );
    }
  });

  it("⑵ câu §3 của ADR-129 (đọc nguyên văn) trên vòng BAFO: ĐÚNG 21 id = `failedCount`, 20 đầu bằng payload, đủ 21 theo thứ tự luồng — dưới superuser và trong phiên `app_api` gắn tổ chức", async () => {
    const cau = await cauSuyCuaAdr129();
    const { rows: so } = await db.pool.query<{ payload: PayloadMoThau }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'RFQ_UNSEALED' AND payload->>'unsealRequestId' = $2",
      [orgA, st.ycVongBafo],
    );
    const payload = so[0]?.payload;
    if (payload === undefined) throw new Error("khong thay ban ghi RFQ_UNSEALED cua luot BAFO");

    const { rows: suy } = await db.pool.query<{ id: string }>(cau, [st.ycVongBafo, orgA]);
    const id = suy.map((r) => r.id);
    expect(id, "câu suy trả ĐÚNG `failedCount` id").toHaveLength(payload.failedCount);
    expect(id.slice(0, K_ADR_129), "20 id đầu của câu suy BẰNG K id đã ghi sổ").toEqual([...payload.failedBidVersionIds]);
    expect(id, "cả 21 id theo cùng thứ tự luồng với mảng đủ trong tiến trình").toEqual([...st.hongTrongTienTrinh]);
    expect([...id].sort(), "tập suy ra = tập phong bì hỏng đã nộp ở vòng BAFO").toEqual([...st.vBafoHong].sort());
    expect(id, "phong bì tốt của vòng hai có hàng bản rõ — không nằm trong tập suy").not.toContain(st.vBafoTot);

    const { rows: suyApi } = await withTenant(apiPool, orgA, (c) => c.query<{ id: string }>(cau, [st.ycVongBafo, orgA]));
    expect(suyApi.map((r) => r.id), "cùng câu trong phiên `app_api` gắn tổ chức (RLS bật)").toEqual(id);
  });

  it("⑶ ĐỐI CHỨNG vế vòng: gỡ `IS NOT DISTINCT FROM r.bafo_round_id` ⇒ 22 id (lọt phong bì VÒNG MỘT của người ngoài top-N; luồng đã thu hồi bị vế lời mời còn sống loại) ≠ `failedCount` 21", async () => {
    const cau = await cauSuyCuaAdr129();
    const khongVeVong = cau.replace(" AND v.bafo_round_id IS NOT DISTINCT FROM r.bafo_round_id", "");
    expect(khongVeVong, "phép gỡ vế phải thật sự đổi câu").not.toBe(cau);
    const { rows: lech } = await db.pool.query<{ id: string }>(khongVeVong, [st.ycVongBafo, orgA]);
    // [S1.249 / khoản 298] Không còn `st.v1ThuHoi`: vế `i.revoked_at IS NULL` của câu §3 loại luồng đã thu hồi dù vế vòng vắng.
    expect(lech.map((r) => r.id).sort(), "không vế vòng: 21 hỏng + bản vòng một của người không nộp lại").toEqual(
      [...st.vBafoHong, st.v1NguoiNgoai].sort(),
    );
  });

  it("[S1.249 / khoản 298] ở YÊU CẦU VÒNG MỘT câu §3 KHÔNG kể luồng bị thu hồi trước lần mở — 0 id, khớp `failedCount` 0 của hai bản ghi sổ; gỡ vế `i.revoked_at IS NULL` ⇒ đúng id của luồng ấy", async () => {
    // ~~[S1.243] Câu §3 không mang vế `i.revoked_at IS NULL` (ADR-128) nên luồng BỊ LOẠI — không mở, không hỏng — được suy thành
    // phong bì hỏng.~~ [S1.249] Ca ghim của §S1.243 (câu trả `[st.v1ThuHoi]`) đỏ đúng ở lần sửa ADR-129 §3 và được lật: câu mang
    // vế lời mời còn sống như worker (`apps/unseal-worker/src/index.ts`), và vế ấy CHỊU LỰC — gỡ nó thì luồng đã thu hồi quay lại.
    const cau = await cauSuyCuaAdr129();
    expect(cau, "câu §3 phải mang vế lời mời còn sống của ADR-128").toContain("AND i.revoked_at IS NULL");
    const { rows: so } = await db.pool.query<{ payload: PayloadMoThau }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action IN ('RFQ_KEY_MATERIAL_UNWRAPPED', 'RFQ_UNSEALED') " +
        " AND payload->>'unsealRequestId' = $2 ORDER BY seq",
      [orgA, st.ycVongMot],
    );
    expect(so.map((b) => [b.payload.bafoRoundId, b.payload.opened, b.payload.failedCount]), "sổ vòng một: 23 mở, 0 hỏng").toEqual([
      [null, SO_NCC, 0],
      [null, SO_NCC, 0],
    ]);
    const { rows: vongMot } = await db.pool.query<{ id: string }>(cau, [st.ycVongMot, orgA]);
    expect(vongMot.map((r) => r.id), "câu §3 ở vòng một: 0 phong bì hỏng — khớp `failedCount` 0").toEqual([]);
    const khongVeThuHoi = cau.replace(/\n\s*AND i\.revoked_at IS NULL/u, "");
    expect(khongVeThuHoi, "phép gỡ vế phải thật sự đổi câu").not.toBe(cau);
    const { rows: lech } = await db.pool.query<{ id: string }>(khongVeThuHoi, [st.ycVongMot, orgA]);
    expect(lech.map((r) => r.id), "không vế lời mời còn sống: luồng đã thu hồi bị suy thành phong bì hỏng").toEqual([st.v1ThuHoi]);
  });
});

// ===============================================================================================
// [S1.286 / S4.7b2] TCO QUA HTTP — THƯỚC ĐI TỚI NHÀ CUNG CẤP, Ô KHAI ĐI VÀO PHONG BÌ, HAI HẠNG ĐI RA TỚI NGƯỜI MUA
//
// S4.7a đo lượt chấm năm mã trên hàng bản rõ dựng sẵn (`luot-danh-gia-tco.int.test.ts`); S4.7b1 cho người mua khai mã, tham số và
// số ngày giao qua HTTP. Khối này nối hai đầu bằng đúng đường của sản phẩm: chính sách bốn mã qua `POST /policy`, số ngày giao qua
// `PUT /rfqs/:rfqId/delivery-days`, gói mở (trigger chụp tập mã VÀ tham số — `117`), nhà cung cấp đọc thước ở `GET /guest/rfq`,
// dựng trường phong bì bằng CHÍNH hàm của màn `/nop-thau` (`truongKhai` của `apps/web/src/tco.ts` — import tương đối xuyên app như
// `chinh-sach.js` ở đầu tệp), worker mở, lượt chấm đọc ô khai bằng bộ đọc SQL, và `GET /ranking` trả hạng chi phí, hạng giá, mã
// thiếu, phép tính của mã quy đổi. Một tên khoá lệch giữa màn và bộ đọc SQL là một báo giá thiếu ô ở đây — không phải ở màn.
//
// Ba báo giá, chọn để hai hạng KHÁC nhau (ADR-156 ⑷):
//   A — 100 000 000, phí vận chuyển gõ "500.000" (dấu chấm nhóm nghìn như ở màn), trả đúng kỳ chuẩn, giao đúng hạn ⇒ 100 500 000.
//   B —  98 000 000, không phí, đòi trả ngay (0 ngày) và giao muộn 15 ngày ⇒ 98 000 000 + 1 933 150,68 + 1 470 000 = 101 403 150,68.
//   C —  90 000 000 — rẻ nhất — nhưng phong bì KHÔNG có số ngày giao (một nhà cung cấp không qua màn) ⇒ không hạng, thiếu `chi_phi_tre`,
//        và không hạng giá: hạng giá chỉ tính trên báo giá có hạng (chủ dự án chốt 2026-10-08).
// Hạng chi phí: A 1, B 2. Hạng giá: B 1, A 2. Tổ chức RIÊNG, luồng MVP1 (TCO không phụ thuộc S3 — `112` (5) chụp ở cả hai), một chữ
// ký mở gói, một chữ ký mở thầu: thứ đo là thước, không phải D2.
// ===============================================================================================
describe("[S1.286 / S4.7b2] TCO qua HTTP — nhà cung cấp THẤY thước và số ngày giao, ô khai của màn đi vào phong bì, người mua thấy HAI hạng và phép tính", () => {
  /** Tham số quy đổi của phiên bản — cùng bộ GIẢ ĐỊNH của `gieo:demo` (`THAM_SO_TCO_DEMO`), viết lại ở đây để phép đo đứng một mình. */
  const THAM_SO = { chi_phi_von_nam: "0.12", ngay_thanh_toan_chuan: "60", ty_le_tre_ngay: "0.001" } as const;
  const MA = ["gia", "van_chuyen", "chi_phi_thanh_toan", "chi_phi_tre"] as const;
  const SO_NGAY_GIAO = 30;
  /** Ô như người gõ ở `/nop-thau` — `null` là ô người ấy KHÔNG có (phong bì dựng ngoài màn). */
  const BAO_GIA = [
    { ten: "NCC TCO A dung han", tong: "100000000.00", o: { vanChuyen: "500.000", nhapKhau: "", ngayThanhToan: "60", ngayGiao: "30" } },
    { ten: "NCC TCO B tra ngay giao muon", tong: "98000000.00", o: { vanChuyen: "0", nhapKhau: "", ngayThanhToan: "0", ngayGiao: "45" } },
    { ten: "NCC TCO C thieu ngay giao", tong: "90000000.00", o: { vanChuyen: "0", nhapKhau: "", ngayThanhToan: "60", ngayGiao: null } },
  ] as const;

  const st = {
    mua: { id: "", cookie: "" } as Nguoi,
    pm2: { id: "", cookie: "" } as Nguoi,
    gd1: { id: "", cookie: "" } as Nguoi,
    taiChinh: { id: "", cookie: "" } as Nguoi,
    rfqId: "",
    phien: [] as string[],
    hang: [] as { rank: number | null; hangGia: number | null }[],
  };

  beforeAll(async () => {
    goc = gocMacDinh;
    orgA =
      (
        await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
          "Cong ty Mua Sam TCO",
          "cong-ty-tco",
        ])
      ).rows[0]?.id ?? "";
    st.mua = await dangNhap("mua-tco@vidu.vn", "PROCUREMENT_MANAGER");
    st.pm2 = await dangNhap("pm2-tco@vidu.vn", "PROCUREMENT_MANAGER");
    st.gd1 = await dangNhap("gd1-tco@vidu.vn", "DIRECTOR");
    st.taiChinh = await dangNhap("taichinh-tco@vidu.vn", "FINANCE");
  }, 240000);

  it("dựng qua HTTP: chính sách bốn mã và tham số, số ngày giao, gói mở — hàng gói CHỤP tập mã và tham số của phiên bản ghim", async () => {
    const m = st.mua.cookie;
    const cs = await goi("POST", "/policy", st.taiChinh.cookie, {
      version: 1,
      dualApprovalThreshold: "5000000000.00",
      currency: "VND",
      evalComponents: MA.map((ma) => ({ ma, don_vi: "TIEN", he_so: "1.0000" })),
      bafoTopN: 0,
      tco: THAM_SO,
    });
    expect(cs.status, cs.text).toBe(201);
    const rfq = await goi("POST", "/rfqs", m, { title: "Van bi — do thuoc TCO", deadlineAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
    expect(rfq.status, rfq.text).toBe(201);
    st.rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    expect((await goi("POST", `/rfqs/${st.rfqId}/items`, m, { lineNo: 1, description: "Van bi DN50", quantity: "10.0000", unit: "cai" })).status).toBe(201);
    const ns = await goi("PUT", `/rfqs/${st.rfqId}/budget`, m, { estimatedValue: "120000000.00", currency: "VND" });
    expect(ns.status, ns.text).toBe(200);
    const ng = await goi("PUT", `/rfqs/${st.rfqId}/delivery-days`, m, { soNgayGiao: SO_NGAY_GIAO });
    expect(ng.status, ng.text).toBe(200);
    expect((await goi("POST", `/rfqs/${st.rfqId}/submit`, m)).status).toBe(200);
    expect((await goi("POST", `/rfqs/${st.rfqId}/approve`, st.pm2.cookie)).status).toBe(200);
    const mo = await goi("POST", `/rfqs/${st.rfqId}/open`, m);
    expect(mo.status, mo.text).toBe(200);
    const { rows } = await db.pool.query<{ tco_ma_ghim: string[]; tco_tham_so_ghim: unknown }>(
      "SELECT tco_ma_ghim, tco_tham_so_ghim FROM rfq_packages WHERE id = $1",
      [st.rfqId],
    );
    expect(rows[0], "trigger cạnh mở chụp tập mã theo thứ tự chính sách, và NGUYÊN nhóm khoá tco của phiên bản ghim").toEqual({
      tco_ma_ghim: [...MA],
      tco_tham_so_ghim: THAM_SO,
    });
    // [rà soát §S1.286 — THẤP-3] Ảnh chụp không nằm trong `RfqRecord`: `GET /rfqs/:rfqId` (route agent — công cụ MCP `get_rfq`) không
    // mang tham số quy đổi; chỉ route khách mang, lọc theo mã bật.
    const doc = await goi("GET", `/rfqs/${st.rfqId}`, m);
    expect(doc.status, doc.text).toBe(200);
    for (const lo of ["tcoThamSoGhim", "tcoMaGhim", "chi_phi_von_nam", "ty_le_tre_ngay"]) expect(doc.text, lo).not.toContain(lo);
  });

  it("nhà cung cấp mở phiên và đọc ở `GET /guest/rfq`: số ngày giao yêu cầu, tập mã, tham số của mã bật — không gì khác của chính sách", async () => {
    const m = st.mua.cookie;
    for (const [i, bg] of BAO_GIA.entries()) {
      const s = await goi("POST", "/suppliers", m, { legalName: bg.ten, taxCode: `032000000${String(i)}` });
      expect(s.status, s.text).toBe(201);
      const supplierId = (s.body as { supplier: { id: string } }).supplier.id;
      const c = await goi("POST", `/suppliers/${supplierId}/contacts`, m, {
        fullName: `Kinh doanh TCO ${String(i)}`,
        email: `tco-${String(i)}@ncc.vn`,
        phone: `09130000${String(i)}0`,
      });
      expect(c.status, c.text).toBe(201);
      const truoc = dv.loiMoiDaGui.length;
      const lm = await goi("POST", `/rfqs/${st.rfqId}/invitations`, m, { supplierId, contactId: (c.body as { contact: { id: string } }).contact.id });
      expect(lm.status, lm.text).toBe(201);
      expect(dv.loiMoiDaGui).toHaveLength(truoc + 1);
      st.phien.push(await moPhienKhach(dv.loiMoiDaGui.at(-1)!.token));
    }
    const r = await goi("GET", "/guest/rfq", st.phien[0]);
    expect(r.status, r.text).toBe(200);
    const than = r.body as { rfq: { soNgayGiao: unknown }; tco: unknown };
    expect(than.rfq.soNgayGiao).toBe(SO_NGAY_GIAO);
    expect(than.tco, "thước của lượt chấm: mã theo thứ tự chính sách, tham số bằng chữ — không ngưỡng, không bậc, không hệ số").toEqual({
      ma: [...MA],
      thamSo: { chiPhiVonNam: "0.12", ngayThanhToanChuan: "60", tyLeTreNgay: "0.001" },
    });
    // Màn đọc thước bằng hàm của chính nó, và đòi đúng ba ô của ba mã ngoài giá đang bật — ô nhập khẩu không hiện.
    expect(oCanKhai(docThuocTco(than.tco))).toEqual({ vanChuyen: true, nhapKhau: false, ngayThanhToan: true, ngayGiao: true });
  });

  it("ba báo giá niêm phong: trường TCO dựng bằng `truongKhai` của màn từ ô người gõ; báo giá C không có số ngày giao", async () => {
    for (const [i, bg] of BAO_GIA.entries()) {
      const cookie = st.phien[i]!;
      const r = await goi("GET", "/guest/rfq", cookie);
      expect(r.status, r.text).toBe(200);
      const than = r.body as { tco: unknown; publicKeys: { algorithm: string; publicKey: string }[] };
      const can = oCanKhai(docThuocTco(than.tco));
      const o = { ...bg.o, ngayGiao: bg.o.ngayGiao ?? "" };
      // Màn chặn nút nộp khi thiếu ô (ADR-156 ⑶) — C đi qua màn thì không nộp được; phong bì của C dựng NGOÀI màn, bỏ ô ấy.
      expect(loiOKhai(can, o) === null, `${bg.ten}: màn ${bg.o.ngayGiao === null ? "chặn" : "cho"} nút nộp`).toBe(bg.o.ngayGiao !== null);
      const truong = truongKhai(can, o);
      const khoa = than.publicKeys.find((k) => k.algorithm === "ECDH_P256");
      if (khoa === undefined) throw new Error("goi thau khong co khoa ECDH_P256 qua HTTP");
      const phongBi = await sealBid({
        rfqId: st.rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: new Uint8Array(Buffer.from(khoa.publicKey, "base64")),
        plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: bg.tong, currency: "VND", nhaCungCap: bg.ten, ...truong })),
      });
      const bn = await goi("POST", "/guest/bids", cookie, { envelope: Buffer.from(phongBi).toString("base64") });
      expect(bn.status, `${bg.ten}: ${bn.text}`).toBe(201);
    }
    expect(truongKhai({ vanChuyen: true, nhapKhau: false, ngayThanhToan: true, ngayGiao: true }, BAO_GIA[0].o), "ô tiền gõ có dấu chấm nhóm nghìn đi vào phong bì dạng chuẩn").toEqual({
      freight: "500000",
      paymentDays: "60",
      leadTimeDays: "30",
    });
  });

  it("đóng, mở thầu, chấm — `GET /ranking` trả hạng chi phí, hạng GIÁ trên báo giá có hạng, mã thiếu, và phép tính của hai mã quy đổi", async () => {
    const m = st.mua.cookie;
    expect((await goi("POST", `/rfqs/${st.rfqId}/close`, m, { reason: "dong som de do thuoc TCO" })).status).toBe(200);
    const yc = await goi("POST", `/rfqs/${st.rfqId}/unseal`, m, { reason: "het han nop, mo thau de cham TCO" });
    expect(yc.status, yc.text).toBe(201);
    const ycId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;
    const duyet = await goi("POST", `/unseal/${ycId}/approve`, st.gd1.cookie);
    expect((duyet.body as { unsealRequest: { status: string } }).unsealRequest.status, duyet.text).toBe("APPROVED");
    expect((await goi("POST", `/unseal/${ycId}/dispatch`, m)).status).toBe(200);
    const kq = await withTenant(unsealPool, orgA, (c) => executeUnsealRequest(c, orgA, { unsealRequestId: ycId, unwrapper: boMoBoc }, unsealPool));
    expect([kq.opened, kq.failedBidVersionIds]).toEqual([3, []]);

    const cham = await goi("POST", `/rfqs/${st.rfqId}/evaluate`, m, {});
    expect(cham.status, cham.text).toBe(201);
    const bxh = await goi("GET", `/rfqs/${st.rfqId}/ranking`, m);
    expect(bxh.status, bxh.text).toBe(200);
    const hang = (bxh.body as {
      ranking: {
        rows: {
          supplierName: string;
          effectiveCost: string | null;
          rank: number | null;
          hangGia: number | null;
          maThieu: readonly string[] | null;
          components: ThanhPhanXepHang[];
        }[];
      };
    }).ranking.rows;
    expect(hang.map((h) => [h.supplierName, h.effectiveCost, h.rank, h.hangGia, h.maThieu])).toEqual([
      [BAO_GIA[0].ten, "100500000.00", 1, 2, null],
      [BAO_GIA[1].ten, "101403150.68", 2, 1, null],
      [BAO_GIA[2].ten, null, null, null, ["chi_phi_tre"]],
    ]);
    const b = hang[1]!;
    expect(b.components.map((c) => [c.ma, c.tien, c.nguon ?? null]), "mã quy đổi mang phép tính của nó; mã khai thẳng không").toEqual([
      ["gia", "98000000.00", null],
      ["van_chuyen", "0.00", null],
      ["chi_phi_thanh_toan", "1933150.68", { coSo: "98000000.00", ngayKhai: "0", ngayChuan: "60", tyLe: "0.12" }],
      ["chi_phi_tre", "1470000.00", { coSo: "98000000.00", ngayKhai: "45", ngayYeuCau: "30", tyLe: "0.001" }],
    ]);
    // Màn `/mo-thau` viết phép tính bằng hàm của chính nó, từ đúng thân ấy (§8.6).
    expect(b.components.map((c) => moTaThanhPhan(c, 1)).slice(2)).toEqual([
      "Chi phí thanh toán = max(0, kỳ chuẩn 60 − 0 ngày khai) × 0.12/năm ÷ 365 × 98000000.00 = 1933150.68 — tham số của chính sách phiên bản 1",
      "Chi phí trễ giao = max(0, 45 ngày khai − 30 ngày yêu cầu) × 0.001/ngày × 98000000.00 = 1470000.00 — tham số của chính sách phiên bản 1",
    ]);
    expect(hang[2]!.components, "báo giá không hạng không có thành phần").toEqual([]);
    st.hang = hang.map((h) => ({ rank: h.rank, hangGia: h.hangGia }));
  });

  // [S1.288 / S4.7c1 / L8 vế cam kết] Đề xuất A — hạng chi phí 1, hạng giá 2 — đòi giải trình; cam kết là lời khai của A do CSDL chụp.
  it("đề xuất báo giá lệch hạng: không giải trình ⇒ 422 gọi tên; giải trình rỗng ⇒ 422; kèm giải trình ⇒ 201 — `GET /award/commitment` trả lời khai, hai hạng, tham số và giải trình do CSDL chụp", async () => {
    const m = st.mua.cookie;
    expect(canGiaiTrinh(st.hang[0] ?? null), "màn hiện ô giải trình cho A").toBe(true);
    expect(canGiaiTrinh(st.hang[1] ?? null)).toBe(true);
    const bxh = await goi("GET", `/rfqs/${st.rfqId}/ranking`, m);
    const a = (bxh.body as { ranking: { rows: { bidVersionId: string }[] } }).ranking.rows[0]!.bidVersionId;
    const thieu = await goi("POST", `/rfqs/${st.rfqId}/award`, st.pm2.cookie, { bidVersionId: a, reason: "chi phi hieu dung thap nhat" });
    expect(thieu.status, thieu.text).toBe(422);
    expect(thieu.body, "câu và MÃ — màn hiện ô giải trình theo mã").toEqual({
      error: "Báo giá được chọn có hạng giá khác hạng chi phí hiệu dụng: đề xuất trao thầu cần một lời giải trình lệch hạng.",
      ma: "THIEU_GIAI_TRINH_LECH_HANG",
    });
    // Ký tự rộng 0 và khoảng trắng không ngắt — `trim` của JS để lại cái đầu, `btrim` mặc định của CSDL để lại cả hai.
    const rong = await goi("POST", `/rfqs/${st.rfqId}/award`, st.pm2.cookie, { bidVersionId: a, reason: "chi phi", giaiTrinhLechHang: "\u200b \u00a0" });
    expect([rong.status, (rong.body as { error: string }).error], "route chặn trước câu ghi — không phải 23514 không tên của CSDL").toEqual([
      422,
      'trường "giaiTrinhLechHang" rỗng — bỏ trường đi, hoặc viết giải trình',
    ]);
    const dai = await goi("POST", `/rfqs/${st.rfqId}/award`, st.pm2.cookie, { bidVersionId: a, reason: "chi phi", giaiTrinhLechHang: "x".repeat(2001) });
    expect([dai.status, (dai.body as { error: string }).error]).toEqual([422, 'trường "giaiTrinhLechHang" dài quá 2000 ký tự']);
    const giaiTrinh = "dat hon B 2 trieu theo gia nhung giao dung han va thanh toan dung ky";
    const dx = await goi("POST", `/rfqs/${st.rfqId}/award`, st.pm2.cookie, {
      bidVersionId: a,
      reason: "chi phi hieu dung thap nhat",
      giaiTrinhLechHang: giaiTrinh,
    });
    expect(dx.status, dx.text).toBe(201);
    expect((dx.body as { award: { giaiTrinhLechHang: string } }).award.giaiTrinhLechHang).toBe(giaiTrinh);

    const ck = await goi("GET", `/rfqs/${st.rfqId}/award/commitment`, m);
    expect(ck.status, ck.text).toBe(200);
    const k = (ck.body as { commitment: CamKetHien & { bidVersionId: string; effectiveCost: string; thamSo: unknown } }).commitment;
    expect(k).toMatchObject({
      bidVersionId: a,
      hangTco: 1,
      hangGia: 2,
      effectiveCost: "100500000.00",
      khai: { freight: "500000.00", importCost: null, paymentDays: 60, leadTimeDays: 30 },
      tapMa: [...MA],
      thamSo: THAM_SO,
      soNgayGiao: SO_NGAY_GIAO,
      giaiTrinhLechHang: giaiTrinh,
    });
    // Bước 7 của `/mo-thau` viết cam kết bằng hàm của chính nó, từ đúng thân ấy.
    expect(moTaCamKet(k)).toEqual([
      ["Hạng lúc đề xuất", "chi phí hiệu dụng 1 · giá 2"],
      ["Lời khai cam kết", "phí vận chuyển 500000.00 · số ngày thanh toán 60 · số ngày giao 30 (yêu cầu 30)"],
      ["Giải trình lệch hạng", giaiTrinh],
    ]);
  });
});

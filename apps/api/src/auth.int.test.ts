// ==============================================================================================
// ĐĂNG NHẬP NGƯỜI MUA QUA HTTP — ADR-020 mục 2, và nửa PHÁT của khoản nợ 6, đo trên tiến trình thật.
//
//   [INV-E1]  token đăng nhập: băm trong CSDL, dùng một lần, có hạn; replay ⇒ 422.
//   [INV-E2]  token magic link một mình KHÔNG là phiên: nhét vào cookie ⇒ 401; chỉ /auth/totp mở phiên.
//   [INV-E3]  TOTP: sai 5 lần ⇒ khoá; lần khoá ghi ĐÚNG MỘT `MFA_LOCKED` (nợ ADR-008 phương án ii).
//   [INV-E6]  token đăng nhập và bí mật TOTP không đi vào log (`console.error` bị theo dõi), token không
//             về client trong phản hồi `/auth/link`; phiên đi ra bằng cookie HttpOnly/Secure/Strict.
//   [029]     app_api KHÔNG chèn được phiên thiếu MFA; đột biến gỡ trigger ⇒ chèn được (RED thật).
//   Không liệt kê được email: email lạ, email bị đình chỉ, và email đúng cho CÙNG một 200.
// ==============================================================================================
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { LOGIN_MAX_TOKENS_PER_WINDOW, MFA_MAX_FAILED_ATTEMPTS, MFA_TRAN_SAI_DUONG_PHU, counterForTime, deriveTotpCode } from "@trustprocure/identity";
import { OTP_RATE_WINDOW_SECONDS } from "@trustprocure/invitation";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { taoDocDiaChi } from "./dia-chi.js";
import { BOI_TRAN_DIA_CHI, createDispatcher } from "./dispatch.js";
import type { Route } from "./route-types.js";
import { COOKIE_PHIEN_NGUOI_MUA, LOGIN_LINK_MAX_PER_CALLER, LOGIN_LINK_MAX_PER_ORG, LOGIN_REDEEM_MAX_PER_CALLER, LOGIN_TOTP_MAX_PER_CALLER } from "./routes/auth.js";
import { ROUTES } from "./routes.js";
import { createApiServer } from "./server.js";
import { dichVuTest, outboxTest, type DichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let dv: DichVuTest;
let ob: ReturnType<typeof outboxTest>;
let orgA: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;
const logLoi: string[] = [];
// [sổ nợ 39] Mỗi test một địa chỉ người gọi riêng (qua X-Forwarded-For, socket 127.0.0.1 khai là proxy),
// để trần theo người gọi của một test không rơi vào test khác.
let soIp = 0;
let ipHienTai = "203.0.113.1";
// ==============================================================================================
// [khoản nợ 66] MỘT NGƯỠNG THỜI GIAN TUYỆT ĐỐI KHÔNG ĐO ĐƯỢC TÍNH CHẤT MÀ NÓ MANG TÊN
//
// Trước vòng này, `TRE_TEST_MS` gánh BA vai bằng ĐÚNG MỘT con số: ⒜ độ trễ được TIÊM vào
// dispatcher, ⒝ TRẦN TRÊN của *"được phục vụ ngay"*, ⒞ SÀN DƯỚI của *"bị làm chậm"*. Vai ⒝ là
// chỗ hỏng: dưới tải — đúng lượt gộp `pnpm evidence` — một lượt BÌNH THƯỜNG mất **1090 ms** và
// cổng đỏ mà không có gì hỏng: *"lần 61 phải nhanh: expected 1090 to be less than 800"*.
//
// VẤN ĐỀ KHÔNG ĐỐI XỨNG, NÊN BẢN VÁ CŨNG KHÔNG ĐỐI XỨNG. Vai ⒞ là một **SÀN** đặt trên một
// request bị làm chậm CỐ Ý: tải chỉ làm nó LỚN HƠN, nên nó **không đỏ oan được bao giờ** và nó ở
// lại nguyên vẹn. Chỉ vai ⒝ bị gỡ.
//
// THAY VÌ MỘT NGƯỠNG TƯƠNG ĐỐI, BỎ ĐỒNG HỒ ĐI. Tính chất cần chứng minh cho 300 lượt đầu là
// *"KHÔNG đi vào nhánh làm chậm"* — một câu hỏi PHẠM TRÙ, không phải một phép đo thời gian. Nhánh
// ấy để lại dấu vết trực tiếp ở `dispatch.ts` (`console.error("... qua tran to chuc ...")`), và
// `logLoi` đã bắt sẵn mọi `console.error` từ `beforeAll`. Đếm dấu vết ấy thì:
//   • KHÔNG đỏ oan được — không có đồng hồ nào trong khẳng định;
//   • MẠNH HƠN phép đo cũ — nó bắt cả một throttle bắn với độ trễ 0 ms, thứ đồng hồ mù hoàn toàn;
//   • ĐỎ NGAY LƯỢT ĐẦU với thông điệp gọi tên đúng lượt, thay vì chết bằng timeout ở lượt thứ ~73.
//
// VÀ NÓ TỰ CHỐNG RỖNG RUỘT. Một khẳng định ÂM (*"số lần làm chậm vẫn là 0"*) sẽ XANH OAN nếu ai
// đổi chuỗi log — bộ đếm khi ấy đứng yên vì nó không thấy gì nữa. Nên mỗi test có một **ĐỐI CHỨNG
// DƯƠNG trong cùng lượt chạy**: sau vòng lặp, số ấy phải thành ĐÚNG 1. Kênh quan sát hỏng thì
// chính khẳng định dương ấy ĐỎ.
//
// ----------------------------------------------------------------------------------------------
// BỐN MŨI ĐỘT BIẾN — BA MŨI ĐỎ SẮC, MŨI THỨ TƯ LÀ MỘT KHOẢN ĐÁNH ĐỔI PHẢI NÓI RA
// ----------------------------------------------------------------------------------------------
// Đo ngày 2026-09-08, đối chứng không-đột-biến 27/27 xanh trước mỗi mũi:
//
//   M1  xoá `console.error` trong nhánh làm chậm   -> ĐỎ 2/27 ở ĐỐI CHỨNG DƯƠNG
//                                                     *"nếu 0, kênh quan sát đã hỏng"*
//   M2  `soLanToChuc > orgLimit` thành `>=`        -> ĐỎ 2/27 *"lần 300 không được đi vào nhánh
//                                                     làm chậm: expected 1 to be +0"*
//   M3  xoá `setTimeout` (log mà không làm chậm)   -> ĐỎ 2/27 *"expected 14 to be greater than
//                                                     or equal to 800"* (SÀN vẫn có răng)
//   M4  đưa `setTimeout` RA NGOÀI khối `if`        -> ĐỎ 4/27, NHƯNG BẰNG **HẾT GIỜ**
//       (mọi lượt đều bị làm chậm)                    (120 000 ms / 60 000 ms), lượt chạy mất
//                                                     **514 giây** thay vì 45.
//
// PHẠM VI CHÍNH XÁC, vì khối này dễ đọc rộng hơn thứ nó làm [review an ninh lượt 17, I-5]:
// vai ⒝ bị gỡ ở HAI test — `[nợ 52]` và `[review H6-2]`, hai chỗ có vòng lặp 300 lượt. Nó KHÔNG
// bị gỡ ở cả tệp: `:546` (`toBeLessThan(TRE_TEST_MS)`, test H5-1) và `:768`
// (`toBeLessThan(3000)`) vẫn là khẳng định thời gian tuyệt đối kiểu "phải nhanh". Cả hai đo MỘT
// lượt chứ không 300, nên cửa sổ đỏ oan của chúng hẹp hơn hẳn — nhưng chúng CÙNG HỌ, và ngày một
// trong hai đỏ oan dưới tải thì cách sửa là cách ở đây, không phải nới hằng số.
//
// M4 LÀ CÁI GIÁ, VÀ ĐÂY LÀ LÝ DO TRẢ NÓ. Trước vòng này, M4 bị bắt trong ~1 giây với một thông
// điệp gọi đúng tên. Nay nó bị bắt sau 60–120 giây bằng một timeout không nói gì. Đổi lại: **300
// khẳng định thôi đỏ oan dưới tải**, và cái đỏ oan ấy KHÔNG phải giả thuyết — nó đã xảy ra thật
// (*"lần 61 phải nhanh: expected 1090 to be less than 800"*).
//
// VÌ SAO KHÔNG VÁ M4 BẰNG MỘT TRẦN TÍCH LUỸ cho cả vòng lặp — cách hiển nhiên nhất: 300 lượt dưới
// đúng lượt tải từng cho ra 1090 ms cho MỘT lượt sẽ chạm bất kỳ trần tích luỹ nào đủ chặt để bắt
// M4. Tức nó **dựng lại đúng khoản nợ 66 ở một chỗ mới**, chỉ khó thấy hơn. Một mũi đột biến bắt
// chậm còn hơn một cổng đỏ giả mà người ta học cách chạy lại. M4 vẫn ĐỎ, và nó là một thay đổi mã
// mà bất kỳ lượt review nào cũng nhìn thấy.
// ==============================================================================================
const TRE_TEST_MS = 800;

/**
 * Số lần nhánh LÀM CHẬM của trần toàn tổ chức đã chạy, đếm bằng DẤU VẾT của chính nhánh ấy
 * (`apps/api/src/dispatch.ts` — `console.error(... "qua tran to chuc" ...)`), không bằng đồng hồ.
 * `logLoi` cộng dồn suốt tệp nên mọi chỗ dùng phải so với một MỐC chụp trước đó, không so với 0.
 */
function soLanLamCham(): number {
  return logLoi.filter((d) => d.includes("qua tran to chuc")).length;
}
beforeEach(() => {
  soIp += 1;
  ipHienTai = `203.0.${Math.floor(soIp / 250)}.${(soIp % 250) + 1}`;
});

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

async function taoNguoi(email: string, status = "ACTIVE"): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Nguoi mua', $3) RETURNING id",
    [orgA, email, status],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER')", [orgA, id]);
  return id;
}

interface PhanHoi {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

async function goi(method: string, path: string, tuyChon: { cookie?: string; body?: unknown; ip?: string; goc?: string } = {}): Promise<PhanHoi> {
  const headers: Record<string, string> = { "x-forwarded-for": tuyChon.ip ?? ipHienTai };
  if (tuyChon.cookie !== undefined) headers.cookie = tuyChon.cookie;
  let body: string | undefined;
  if (tuyChon.body !== undefined) {
    body = JSON.stringify(tuyChon.body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${tuyChon.goc ?? goc}${path}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
}

/** link → redeem (ghi danh) → trả về {token đăng nhập, bí mật TOTP}. */
async function linkVaGhiDanh(email: string): Promise<{ token: string; biMat: Buffer }> {
  const truoc = dv.linkDaGui.length;
  const r = await goi("POST", "/auth/link", { body: { orgId: orgA, email } });
  expect(r.status).toBe(200);
  // [sổ nợ 38] Link chỉ ra đời khi job chạy — test chạy runner tường minh.
  await ob.chay(orgA);
  expect(dv.linkDaGui).toHaveLength(truoc + 1);
  const token = dv.linkDaGui.at(-1)!.token;
  const rd = await goi("POST", "/auth/redeem", { body: { orgId: orgA, token } });
  expect(rd.status, rd.text).toBe(200);
  const b = rd.body as { needsEnrollment: boolean; totpSecretBase32?: string };
  expect(b.needsEnrollment).toBe(true);
  return { token, biMat: base32Decode(b.totpSecretBase32 ?? "") };
}

function maHienTai(biMat: Buffer): string {
  return deriveTotpCode(biMat, counterForTime(Date.now()));
}

async function dangNhap(email: string): Promise<{ cookie: string; token: string; biMat: Buffer }> {
  const { token, biMat } = await linkVaGhiDanh(email);
  const r = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: maHienTai(biMat) } });
  expect(r.status, r.text).toBe(200);
  const sc = r.headers.get("set-cookie") ?? "";
  const gt = /tp_session=([^;]+)/u.exec(sc)?.[1] ?? "";
  expect(gt).not.toBe("");
  return { cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${gt}`, token, biMat };
}

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logLoi.push(args.map(String).join(" "));
  });
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  dv = dichVuTest();
  ob = outboxTest(apiPool, dv.services);
  // [review H5-1] `treQuaTranMs` nhỏ để đo "làm chậm, không khoá" mà không chờ 2 s thật.
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services, treQuaTranMs: TRE_TEST_MS }), { remoteAddressOf: taoDocDiaChi(["127.0.0.1"]) });
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180000);

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("/auth/link — không liệt kê được email", () => {
  // ==========================================================================================
  // [sổ nợ 63 / S1.27] HAI TẦNG KHÔNG ĐƯỢC MỖI TẦNG MỘT ĐỊNH NGHĨA "CHỮ THƯỜNG"
  //
  // Bản vá đầu của khoản nợ 63 thêm `CHECK (email = lower(email))` rồi khai là *"chữ hoa thành
  // BẤT KHẢ"*. Lượt soi đối kháng bác câu ấy bằng một phép đo, và phép đo đúng:
  //
  //   `.toLowerCase()` của JS hạ **1488** điểm mã. `lower()` của PostgreSQL trên `postgres:16-
  //   alpine` (đúng ảnh mà `startPostgres()` ghim) hạ **1364**. Phần chênh là những điểm mã
  //   BẤT ĐỘNG với `lower()` của máy chủ — nên chúng ĐI QUA `CHECK` — mà JS vẫn hạ.
  //
  // Hậu quả không phải một vết xước thẩm mỹ: `issueLoginToken` dựng khoá tra cứu bằng hàm của
  // JS còn hàng nằm trong CSDL là điểm bất động của hàm PostgreSQL ⇒ `WHERE lower(email) = $1`
  // trả **0 hàng**. Người ấy KHÔNG BAO GIỜ nhận được magic link, kể cả khi gõ đúng nguyên văn
  // địa chỉ đã đăng ký — và thiết kế *"luôn 200, cùng một thân"* của `/auth/link` (đúng thứ
  // khối describe này canh) bảo đảm không ai nhìn thấy điều đó. Một cửa khoá câm vĩnh viễn.
  //
  // Bản vá: bỏ hẳn MỘT trong hai định nghĩa. `login.ts` thôi gọi `.toLowerCase()`, và câu truy
  // vấn hạ chữ thường CẢ HAI VẾ bằng `pg_catalog.lower()`. Khi ấy khoá tra cứu và giá trị đã
  // lưu đi qua CÙNG một hàm, nên chúng không lệch được nữa — bất kể libc của ảnh nền là gì.
  //
  // TEST NÀY TỰ HIỆU CHUẨN, có chủ đích: nó KHÔNG đóng cứng một điểm mã, vì tập điểm mã phân
  // kỳ phụ thuộc libc của máy chủ (đo được: 124 điểm trên musl, 28 trên glibc). Nó hỏi chính
  // CSDL đang chạy xem điểm mã nào phân kỳ, rồi dùng cái đầu tiên. Không có điểm nào — nghĩa là
  // hai hàm đã trùng khít — thì test nói thẳng là nó không đo được gì, chứ không xanh im lặng.
  // ==========================================================================================
  it("[sổ nợ 63] địa chỉ mà JS và máy chủ hạ chữ thường KHÁC NHAU vẫn tìm ra người dùng", async () => {
    // Ứng viên: mọi điểm mã mà JS coi là hạ được. Dừng ở BMP cho rẻ.
    const ungVien: string[] = [];
    for (let i = 0x21; i < 0x2600; i += 1) {
      const c = String.fromCodePoint(i);
      if (c.toLowerCase() !== c && /^[^\s\u0000-\u001f\u007f@]$/u.test(c)) ungVien.push(c);
    }
    // ...và trong số đó, cái nào là ĐIỂM BẤT ĐỘNG của `lower()` trên máy chủ NÀY.
    const { rows: phanKy } = await db.pool.query<{ c: string }>(
      "SELECT c FROM unnest($1::text[]) AS c WHERE lower(c) = c ORDER BY c LIMIT 1",
      [ungVien],
    );
    if (phanKy.length === 0) {
      // Dấu hiệu tích cực ngược: không có gì để đo thì phải NÓI RA, không được xanh im lặng.
      throw new Error(
        "Không tìm được điểm mã nào phân kỳ giữa `.toLowerCase()` của JS và `lower()` của máy " +
          "chủ. Nếu hai hàm đã trùng khít thì test này hết ý nghĩa và phải được viết lại — " +
          "đừng xoá nó đi trong im lặng.",
      );
    }
    const ky = phanKy[0]!.c;
    const diaChi = `${ky}lice-63@vidu.vn`;

    // TỔ CHỨC RIÊNG, không dùng `orgA`. Test ngay dưới khẳng định `user_login_tokens` của `orgA`
    // bằng 0 ở một thời điểm cụ thể; phát một token vào đó từ đây là làm đỏ nó — đo được, và đó
    // đúng là kiểu ràng buộc chéo mà một test mới dễ mang vào mà không ai thấy.
    const org63 = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('Cong ty 63', 'cong-ty-63') RETURNING id",
      )
    ).rows[0]!.id;
    // Hàng phải cất được: đây chính là vế mà `CHECK (email = lower(email))` CHO QUA.
    const nguoi63 = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Nguoi 63', 'ACTIVE') RETURNING id",
        [org63, diaChi],
      )
    ).rows[0]!.id;
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER')", [org63, nguoi63]);

    const truoc = dv.linkDaGui.length;
    const r = await goi("POST", "/auth/link", { body: { orgId: org63, email: diaChi } });
    expect(r.status).toBe(200);
    await ob.chay(org63);

    // ĐỎ TRƯỚC BẢN VÁ: khoá tra cứu do JS sinh không khớp hàng, `issueLoginToken` trả NO_USER,
    // và KHÔNG job nào được xếp hàng — `linkDaGui` đứng yên.
    expect(
      dv.linkDaGui.length,
      `địa chỉ ${JSON.stringify(diaChi)} (điểm mã ${JSON.stringify(ky)}) đã đăng ký nhưng ` +
        "không sinh được magic link — hai tầng đang dùng hai hàm hạ chữ thường khác nhau",
    ).toBe(truoc + 1);
    expect(dv.linkDaGui.at(-1)!.email, "link phải đi tới ĐỊA CHỈ ĐÃ ĐĂNG KÝ").toBe(diaChi);
  });

  // [S1.15] Khối này cũng có một vòng đếm (`LOGIN_MAX_TOKENS_PER_WINDOW + 3`) — cùng lý do.
  beforeEach(choDuCuaSo);

  it("email đúng, email lạ, email bị đình chỉ: CÙNG một 200; token chỉ đi tới bộ gửi, KHÔNG về client", async () => {
    await taoNguoi("a@vidu.vn");
    await taoNguoi("dinhchi@vidu.vn", "SUSPENDED");
    const truoc = dv.linkDaGui.length;
    const dung = await goi("POST", "/auth/link", { body: { orgId: orgA, email: "A@vidu.vn " } });
    const la = await goi("POST", "/auth/link", { body: { orgId: orgA, email: "khong-co@vidu.vn" } });
    const dc = await goi("POST", "/auth/link", { body: { orgId: orgA, email: "dinhchi@vidu.vn" } });
    expect([dung.status, la.status, dc.status]).toEqual([200, 200, 200]);
    expect(new Set([dung.text, la.text, dc.text]).size).toBe(1);
    // [sổ nợ 38] TRƯỚC khi runner chạy: ba email để lại đúng BA job và KHÔNG một token nào — handler
    // HTTP không nhìn vào bảng người dùng, nên hai nhánh có/không người dùng là cùng một câu lệnh.
    const { rows: job } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs WHERE org_id = $1 AND kind = 'LOGIN_LINK_SEND' AND status = 'PENDING'",
      [orgA],
    );
    expect(Number(job[0]?.n)).toBe(3);
    const { rows: tokenTruoc } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM user_login_tokens WHERE org_id = $1", [orgA]);
    expect(Number(tokenTruoc[0]?.n)).toBe(0);
    expect(dv.linkDaGui).toHaveLength(truoc);
    expect(await ob.chay(orgA)).toBe(3);
    expect(dv.linkDaGui).toHaveLength(truoc + 1);
    expect(dv.linkDaGui.at(-1)?.email).toBe("a@vidu.vn");
    expect(dung.text).not.toContain(dv.linkDaGui.at(-1)!.token);
    // [review H4-3 / 041] Job xong ⇒ payload về `{}`: không email nào (có người hay không) nằm lại
    // trong `outbox_jobs`. Đo theo GIÁ TRỊ trên toàn bảng, không chỉ ba job vừa chạy.
    const { rows: conEmail } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs WHERE kind = 'LOGIN_LINK_SEND' AND status IN ('DONE', 'FAILED') AND payload::text <> '{}'",
    );
    expect(Number(conEmail[0]?.n)).toBe(0);
    const { rows: daXong } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs WHERE org_id = $1 AND kind = 'LOGIN_LINK_SEND' AND status = 'DONE'",
      [orgA],
    );
    expect(Number(daXong[0]?.n)).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify((await db.pool.query("SELECT payload FROM outbox_jobs WHERE org_id = $1 AND kind = 'LOGIN_LINK_SEND'", [orgA])).rows)).not.toContain("vidu.vn");
  });

  it("[review H4-3] chuỗi không có hình dạng email ⇒ 422 TRƯỚC khi chạm CSDL: không job nào được để lại", async () => {
    const { rows: truoc } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM outbox_jobs WHERE org_id = $1 AND kind = 'LOGIN_LINK_SEND'", [orgA]);
    for (const xau of ["khong-phai-email", "@vidu.vn", "a@", "a b@vidu.vn", "a@b@c", "a\u0000@vidu.vn"]) {
      const r = await goi("POST", "/auth/link", { body: { orgId: orgA, email: xau } });
      expect(r.status, JSON.stringify(xau)).toBe(422);
    }
    const { rows: sau } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM outbox_jobs WHERE org_id = $1 AND kind = 'LOGIN_LINK_SEND'", [orgA]);
    expect(sau[0]?.n).toBe(truoc[0]?.n);
    // ĐỘT BIẾN 041: gỡ trigger ⇒ email nằm lại sau khi job xong; khôi phục ⇒ xoá lại.
    await db.pool.query("DROP TRIGGER outbox_jobs_xoa_payload_dang_nhap ON outbox_jobs");
    try {
      expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "dot-bien-041@vidu.vn" } })).status).toBe(200);
      await ob.chay(orgA);
      const { rows } = await db.pool.query<{ payload: unknown }>(
        "SELECT payload FROM outbox_jobs WHERE org_id = $1 AND kind = 'LOGIN_LINK_SEND' AND status = 'DONE' AND payload::text <> '{}'",
        [orgA],
      );
      expect(JSON.stringify(rows), "RED THẬT: không có 041, email nằm lại vĩnh viễn trong outbox_jobs").toContain("dot-bien-041@vidu.vn");
    } finally {
      await db.pool.query(
        "CREATE TRIGGER outbox_jobs_xoa_payload_dang_nhap BEFORE UPDATE ON outbox_jobs FOR EACH ROW " +
          "WHEN (NEW.kind = 'LOGIN_LINK_SEND' AND NEW.status IN ('DONE', 'FAILED') AND OLD.status IS DISTINCT FROM NEW.status) " +
          "EXECUTE FUNCTION public.outbox_jobs_xoa_payload_dang_nhap(); " +
          "ALTER TABLE outbox_jobs ENABLE ALWAYS TRIGGER outbox_jobs_xoa_payload_dang_nhap",
      );
      await db.pool.query("UPDATE outbox_jobs SET payload = '{}' WHERE kind = 'LOGIN_LINK_SEND' AND status = 'DONE'");
    }
  });

  it("[INV-E1] hạn mức theo người dùng: quá LOGIN_MAX_TOKENS_PER_WINDOW ⇒ vẫn 200 nhưng không gửi thêm", async () => {
    await taoNguoi("hanmuc@vidu.vn");
    const truoc = dv.linkDaGui.length;
    for (let i = 0; i < LOGIN_MAX_TOKENS_PER_WINDOW + 3; i += 1) {
      expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "hanmuc@vidu.vn" } })).status).toBe(200);
    }
    // [sổ nợ 38] Cả tám job đều chạy XONG (không job nào thất bại); ba job cuối không gửi gì.
    expect(await ob.chay(orgA)).toBe(LOGIN_MAX_TOKENS_PER_WINDOW + 3);
    expect(ob.loi).toHaveLength(0);
    expect(dv.linkDaGui.length - truoc).toBe(LOGIN_MAX_TOKENS_PER_WINDOW);
  });
});

/**
 * [S1.15] CỬA SỔ HẠN MỨC LÀ RỜI RẠC, VÀ MỘT VÒNG ĐẾM VẮT QUA RANH GIỚI CỦA NÓ LÀ MỘT FLAKE.
 *
 * `demVaTang`/`tangBucketNguoiGoi` làm tròn `window_start` xuống bội của `OTP_RATE_WINDOW_SECONDS`
 * TÍNH TỪ EPOCH, nên mọi bộ đếm về 0 cùng lúc, ở những mốc biết trước. Chính `invitation.ts` đã ghi
 * tính chất ấy như một đánh đổi có chủ đích ("một kẻ tấn công canh đúng ranh giới hai cửa sổ gửi
 * được GẤP ĐÔI hạn mức"). Hệ quả cho bộ test thì chưa ai ghi, và nó ĐÃ NỔ:
 *
 *   Lượt `pnpm evidence` của vòng S1.15 (song song, máy phát triển) — 1 test đỏ, 1277 khẳng định:
 *     [review H5-1] MỘT địa chỉ không khoá được cả tổ chức …
 *       AssertionError: lần 201: expected 200 to be 429   (auth.int.test.ts:411)
 *   Chạy LẠI riêng tệp ấy ngay sau đó: 26/26 XANH, vòng 300 lời gọi tốn 4,6 s.
 *
 * Chữ ký khớp đúng một cơ chế: sau ~200 lời gọi (≈3 s ở nhịp đo được), cửa sổ lăn sang mốc mới và
 * bộ đếm của người gọi về 0 ⇒ lời gọi 201 được 200 thay vì 429. KHÔNG phải hồi quy của vòng này:
 * ba bộ đếm của `/auth/*` nằm ở `caller_rate_limits`, không phải bảng mà `044` đụng tới.
 *
 * Bản vá KHÔNG nới một ngưỡng nào và không bọc lại một khẳng định nào: nó chỉ không bắt đầu một
 * vòng đếm khi cửa sổ sắp hết. Ngưỡng 45 giây là ~10 lần thời gian đo được của vòng dài nhất, nên
 * nó chịu được cả một lượt chạy song song chậm gấp mấy lần; và vì nó chỉ chờ khi thật sự cần
 * (5% số lượt), giá trung bình là vài giây cho cả tệp.
 */
const CAN_CUA_SO_MS = 45_000;
const choDuCuaSo = async (): Promise<void> => {
  const cuaSoMs = OTP_RATE_WINDOW_SECONDS * 1000;
  const conLai = cuaSoMs - (Date.now() % cuaSoMs);
  if (conLai < CAN_CUA_SO_MS) await new Promise((xong) => setTimeout(xong, conLai + 100));
};

describe("[sổ nợ 39] hạn mức theo NGƯỜI GỌI trên /auth/* — đếm sống qua rollback của handler", () => {
  // Mọi test trong khối này đếm CỘNG DỒN qua nhiều lời gọi, nên không cái nào được vắt qua ranh giới.
  beforeEach(choDuCuaSo);

  it("/auth/link: lần thứ N+1 từ cùng địa chỉ ⇒ 429 + Retry-After; địa chỉ khác vẫn 200; email lạ cũng bị đếm", async () => {
    for (let i = 0; i < LOGIN_LINK_MAX_PER_CALLER; i += 1) {
      expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: `khong-co-${i}@vidu.vn` } })).status).toBe(200);
    }
    const chan = await goi("POST", "/auth/link", { body: { orgId: orgA, email: "khong-co-x@vidu.vn" } });
    expect(chan.status).toBe(429);
    expect(chan.headers.get("retry-after")).toBe("900");
    expect(chan.text).toBe(JSON.stringify({ error: "qua nhieu yeu cau" }));
    expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "khong-co-y@vidu.vn" } })).status).toBe(429);
    expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "khong-co-z@vidu.vn" }, ip: "198.51.100.7" })).status).toBe(200);
  });

  it("/auth/redeem: token SAI bị đếm dù handler rollback (LoginTokenError ⇒ 422) — lần thứ N+1 ⇒ 429", async () => {
    const rac = "A".repeat(43);
    for (let i = 0; i < LOGIN_REDEEM_MAX_PER_CALLER; i += 1) {
      expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: rac } })).status).toBe(422);
    }
    expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: rac } })).status).toBe(429);
    // Bộ đếm nằm ở CSDL, đúng kind và đúng số: N+1 lần cho khoá của route + địa chỉ này.
    // Khoá bucket đã băm nên không lọc theo route được; đo "có đúng một bucket vừa chạm N+1" thay vì
    // "bucket lớn nhất" (~~ORDER BY hits DESC~~ [review H4-4] trần link nay 30, bucket link của test
    // trước lớn hơn N+1 của redeem).
    // [nợ 55] Bộ đếm theo người gọi nay ở `caller_rate_limits` — bảng TOÀN CỤC, không `org_id`, nên
    // phép đo lọc theo `hits` chứ không theo tổ chức (đó chính là tính chất đang được đo).
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM caller_rate_limits WHERE hits = $1",
      [LOGIN_REDEEM_MAX_PER_CALLER + 1],
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
    // Và KHÔNG hàng nào của `otp_rate_limits` mang số ấy: bucket người gọi đã rời khỏi bảng tenant.
    const { rows: cu } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM otp_rate_limits WHERE bucket_kind = 'LOGIN_CALLER' AND hits = $1",
      [LOGIN_REDEEM_MAX_PER_CALLER + 1],
    );
    expect(cu[0]?.n).toBe("0");
  });

  it("[S1.21, review lượt 13 H13-1] /auth/totp: lần thứ N+1 từ cùng địa chỉ ⇒ 429 + Retry-After — vế GIỚI HẠN TẦN SUẤT của E3 trên đường TOTP", async () => {
    // Trước vòng này, `callerLimit` của `/auth/totp` là một dòng cấu hình mà KHÔNG test nào canh:
    // hai test ở trên chỉ đo `/auth/link` và `/auth/redeem`, còn đối chứng thì gỡ cờ khỏi MỌI route
    // ANON rồi vẫn chỉ đo `/auth/redeem`. Xoá đúng dòng 166 của `routes/auth.ts` thì đường đoán mã
    // TOTP mất trần theo người gọi và bộ test vẫn XANH — đó là lý do khoản nợ 1 không được tuyên
    // ĐÓNG cho tới khi có test này (và lớp tĩnh ở `routes.test.ts`).
    const rac = "C".repeat(43);
    const than = { orgId: orgA, token: rac, code: "000000" };
    for (let i = 0; i < LOGIN_TOTP_MAX_PER_CALLER; i += 1) {
      const r = await goi("POST", "/auth/totp", { body: than });
      expect(r.status, `lần ${i + 1}`).toBe(422);
    }
    const chan = await goi("POST", "/auth/totp", { body: than });
    expect(chan.status).toBe(429);
    expect(chan.headers.get("retry-after")).toBe("900");
    expect(chan.text).toBe(JSON.stringify({ error: "qua nhieu yeu cau" }));
    // Bucket theo (route, địa chỉ): một địa chỉ khác vẫn đi qua — trần KHÔNG phải một công tắc toàn cục.
    expect((await goi("POST", "/auth/totp", { body: than, ip: "198.51.100.11" })).status).toBe(422);
    // Và trần của `/auth/totp` là bucket RIÊNG: `/auth/redeem` từ cùng địa chỉ vẫn còn ngân sách.
    expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: rac } })).status).toBe(422);
  });

  it("[review H4-4] IPv6: hai địa chỉ CÙNG /64 dùng chung bucket (lần N+1 từ địa chỉ thứ hai ⇒ 429); /64 khác ⇒ 200", async () => {
    const rac = "A".repeat(43);
    for (let i = 0; i < LOGIN_REDEEM_MAX_PER_CALLER; i += 1) {
      // Mỗi lần một địa chỉ KHÁC trong cùng /64 — nếu bucket theo địa chỉ nguyên vẹn thì không bao giờ 429.
      const r = await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: rac }, ip: `2001:db8:77:1::${(i + 1).toString(16)}` });
      expect(r.status, `lần ${i + 1}`).toBe(422);
    }
    expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: rac }, ip: "2001:db8:77:1:ffff:ffff:ffff:ffff" })).status).toBe(429);
    expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: rac }, ip: "2001:db8:77:2::1" })).status).toBe(422);
  });

  it("ĐỐI CHỨNG: cùng dispatcher nhưng bảng route KHÔNG khai callerLimit ⇒ không bao giờ 429 — trần đúng là cờ ấy, không phải thứ gì khác", async () => {
    const khongTran = ROUTES.map((r) =>
      r.audience === "ANON" ? (Object.fromEntries(Object.entries(r).filter(([k]) => k !== "callerLimit")) as unknown as Route) : r,
    );
    const s2 = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services, routes: khongTran }), {
      remoteAddressOf: taoDocDiaChi(["127.0.0.1"]),
    });
    await new Promise<void>((xong) => s2.listen(0, "127.0.0.1", xong));
    const goc2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      const rac = "B".repeat(43);
      for (let i = 0; i < LOGIN_REDEEM_MAX_PER_CALLER + 5; i += 1) {
        expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: rac }, goc: goc2 })).status).toBe(422);
      }
    } finally {
      await new Promise<void>((xong) => s2.close(() => xong()));
    }
  });

  it("[sổ nợ 55 / 042] tổ chức KHÔNG tồn tại đi qua ĐÚNG cùng đường với tổ chức thật: mồi N lần vào MỘT UUID lạ rồi gọi lại ⇒ 429 y hệt tổ chức thật, cùng thân, cùng Retry-After", async () => {
    const orgLa = "00000000-0000-4000-8000-00000000abcd";
    for (let i = 0; i < LOGIN_LINK_MAX_PER_CALLER; i += 1) {
      const r = await goi("POST", "/auth/link", { body: { orgId: orgLa, email: "ai-do@vidu.vn" } });
      expect(r.status, `lần ${i + 1}`).toBe(200);
      expect(r.text).toBe(JSON.stringify({ ok: true }));
    }
    // [nợ 55] RED THẬT trước 042: tổ chức lạ ném 23503 nên KHÔNG đếm được — lần này và mọi lần sau
    // đều 200. Nay nó có một hàng ở `caller_rate_limits` (không khoá ngoại) như tổ chức thật.
    const chan = await goi("POST", "/auth/link", { body: { orgId: orgLa, email: "ai-do@vidu.vn" } });
    expect(chan.status).toBe(429);
    expect(chan.headers.get("retry-after")).toBe("900");
    // Tổ chức THẬT từ cùng địa chỉ, cùng số lần ⇒ CÙNG một 429 với cùng thân: không có gì phân biệt.
    for (let i = 0; i < LOGIN_LINK_MAX_PER_CALLER; i += 1) {
      expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "ai-do@vidu.vn" } })).status, `thật lần ${i + 1}`).toBe(200);
    }
    const that = await goi("POST", "/auth/link", { body: { orgId: orgA, email: "ai-do@vidu.vn" } });
    expect(that.status).toBe(429);
    expect(that.text).toBe(chan.text);
    expect(that.headers.get("retry-after")).toBe(chan.headers.get("retry-after"));
    // [review H6-1] Trần TOÀN CỤC của địa chỉ đã đếm cả hai loại: 2N lời gọi thành công + 2 lần bị chặn.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM caller_rate_limits WHERE hits = $1",
      [2 * LOGIN_LINK_MAX_PER_CALLER + 2],
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("[review H6-1] một địa chỉ KHÔNG khoá được cả nền tảng: chạm trần với tổ chức A xong, tổ chức B từ CÙNG địa chỉ vẫn 200 — tới khi chạm trần TOÀN CỤC của địa chỉ", async () => {
    const orgE = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty E', 'cong-ty-e') RETURNING id")).rows[0]?.id ?? "";
    for (let i = 0; i < LOGIN_LINK_MAX_PER_CALLER; i += 1) {
      expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "nen-tang@vidu.vn" } })).status, `A lần ${i + 1}`).toBe(200);
    }
    expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "nen-tang@vidu.vn" } })).status).toBe(429);
    // RED THẬT với bản chỉ-toàn-cục (S1.14 trước H6-1): dòng dưới là 429 — một địa chỉ khoá mọi tổ chức.
    expect(
      (await goi("POST", "/auth/link", { body: { orgId: orgE, email: "nen-tang@vidu.vn" } })).status,
      "trần theo người gọi phải là trần TRONG một tổ chức, không phải trần của cả nền tảng",
    ).toBe(200);
  }, 60_000);

  it("[review H6-1] trần TOÀN CỤC của một địa chỉ vẫn có: xoay orgId LẠ không cho ngân sách vô hạn", async () => {
    // Mỗi orgId lạ là một bucket (địa chỉ, tổ chức) mới; thứ chặn lại là bucket TOÀN CỤC của địa chỉ.
    const tranToanCuc = LOGIN_LINK_MAX_PER_CALLER * BOI_TRAN_DIA_CHI;
    for (let i = 0; i < tranToanCuc; i += 1) {
      const orgLa = `00000000-0000-4000-8000-${(0x500000000000 + i).toString(16).padStart(12, "0")}`;
      const r = await goi("POST", "/auth/link", { body: { orgId: orgLa, email: "xoay@vidu.vn" } });
      expect(r.status, `lần ${i + 1}`).toBe(200);
    }
    const chan = await goi("POST", "/auth/link", { body: { orgId: "00000000-0000-4000-8000-0000ffffffff", email: "xoay@vidu.vn" } });
    expect(chan.status, "RED THẬT: không có trần toàn cục, xoay orgId lạ là ngân sách vô hạn cho một địa chỉ").toBe(429);
    // Địa chỉ khác vẫn sạch.
    expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "xoay@vidu.vn" }, ip: "198.51.100.90" })).status).toBe(200);
  }, 120_000);

  it("[nợ 52] trần TOÀN TỔ CHỨC: N địa chỉ KHÁC NHAU cùng tổ chức ⇒ lần N+1 ~~là 429~~ [H5-1] vẫn 200 nhưng bị LÀM CHẬM; tổ chức khác từ cùng địa chỉ vẫn 200 và nhanh", async () => {
    const orgC = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty C', 'cong-ty-c') RETURNING id")).rows[0]?.id ?? "";
    const ipThu = (i: number): string => `2001:db8:52:${(i + 1).toString(16)}::1`; // mỗi lần một /64 khác
    // [khoản nợ 66] Mốc, không phải 0: `logLoi` cộng dồn suốt tệp.
    const mocC = soLanLamCham();
    for (let i = 0; i < LOGIN_LINK_MAX_PER_ORG; i += 1) {
      const r = await goi("POST", "/auth/link", { body: { orgId: orgC, email: "tran-to-chuc@vidu.vn" }, ip: ipThu(i) });
      expect(r.status, `lần ${i + 1}`).toBe(200);
      // PHẠM TRÙ, không phải đồng hồ: lượt này có đi vào nhánh làm chậm không. Rẻ, tất định, và
      // đỏ ngay ở lượt ĐẦU TIÊN vi phạm — xem khối [khoản nợ 66] đầu tệp.
      expect(soLanLamCham(), `lần ${i + 1} không được đi vào nhánh làm chậm`).toBe(mocC);
    }
    const t1 = Date.now();
    const cham = await goi("POST", "/auth/link", { body: { orgId: orgC, email: "tran-to-chuc@vidu.vn" }, ip: ipThu(LOGIN_LINK_MAX_PER_ORG) });
    expect(cham.status).toBe(200);
    // ĐỐI CHỨNG DƯƠNG cho kênh quan sát: 300 khẳng định âm ở trên sẽ XANH OAN nếu chuỗi log đổi.
    // Khẳng định này đỏ khi ấy, trong cùng lượt chạy.
    expect(soLanLamCham() - mocC, "nhánh làm chậm phải chạy ĐÚNG một lần — nếu 0, kênh quan sát đã hỏng và 300 khẳng định trên là rỗng ruột").toBe(1);
    // SÀN tuyệt đối, GIỮ NGUYÊN: đặt trên một request bị làm chậm cố ý, nên tải chỉ làm nó lớn hơn.
    expect(Date.now() - t1).toBeGreaterThanOrEqual(TRE_TEST_MS);
    // Cùng địa chỉ mới ấy, tổ chức A: 200 và KHÔNG bị làm chậm — trần là của tổ chức C, không phải
    // của địa chỉ. Lại là phép đếm, không phải đồng hồ.
    const mocA = soLanLamCham();
    expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "tran-to-chuc@vidu.vn" }, ip: ipThu(LOGIN_LINK_MAX_PER_ORG) })).status).toBe(200);
    expect(soLanLamCham(), "tổ chức A không được đi vào nhánh làm chậm").toBe(mocA);
    // Bucket CSDL của TỔ CHỨC: ~~N+1 bucket theo địa chỉ ở 1~~ [nợ 55] bucket theo địa chỉ nay ở
    // `caller_rate_limits` (không org_id), nên `otp_rate_limits` của tổ chức C còn ĐÚNG MỘT hàng —
    // bucket toàn tổ chức — và nó đếm đủ N+1.
    const { rows } = await db.pool.query<{ hits: number; n: string }>(
      "SELECT hits, count(*)::text AS n FROM otp_rate_limits WHERE org_id = $1 AND bucket_kind = 'LOGIN_CALLER' GROUP BY hits ORDER BY hits",
      [orgC],
    );
    // [review H6-2] Bucket toàn tổ chức rời khỏi `otp_rate_limits` sang `caller_rate_limits` (không
    // khoá ngoại) để tổ chức lạ cũng đếm được — nên bảng cũ không còn hàng `LOGIN_CALLER` nào.
    expect(rows).toEqual([]);
    const { rows: moi } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM caller_rate_limits WHERE hits = $1",
      [LOGIN_LINK_MAX_PER_ORG + 1],
    );
    expect(Number(moi[0]?.n)).toBeGreaterThanOrEqual(1);
    // [S1.73] 120 s — đúng hạn của hai test cùng độ dài vòng lặp trong chính describe này. Ở lượt evidence song song của
    // S1.73, test này chạm hạn 60 s (chạy riêng mất 6 304 ms); và vitest KHÔNG huỷ lượt chạy quá hạn, nên những lần gọi
    // còn lại của nó cộng tiếp vào `soLanLamCham` và làm test [review H6-2] đỏ theo — đỏ dây chuyền, không phải hai lỗi.
  }, 120_000);

  it("[review H6-2] tổ chức LẠ cũng bị LÀM CHẬM khi vượt trần toàn tổ chức — độ trễ không còn là oracle tồn tại tổ chức", async () => {
    const orgLa = "00000000-0000-4000-8000-00000000cafe";
    const ipThu = (i: number): string => `2001:db8:62:${(i + 1).toString(16)}::1`;
    const mocLa = soLanLamCham();
    for (let i = 0; i < LOGIN_LINK_MAX_PER_ORG; i += 1) {
      const r = await goi("POST", "/auth/link", { body: { orgId: orgLa, email: "la@vidu.vn" }, ip: ipThu(i) });
      expect(r.status, `lần ${i + 1}`).toBe(200);
      expect(soLanLamCham(), `lần ${i + 1} không được đi vào nhánh làm chậm`).toBe(mocLa);
    }
    const t1 = Date.now();
    const cham = await goi("POST", "/auth/link", { body: { orgId: orgLa, email: "la@vidu.vn" }, ip: ipThu(LOGIN_LINK_MAX_PER_ORG) });
    expect(cham.status).toBe(200);
    // RED THẬT trước H6-2: tổ chức lạ ném 23503 ở bucket tổ chức nên KHÔNG BAO GIỜ chậm, và một
    // phép đo thời gian phân biệt được tổ chức thật với tổ chức lạ.
    //
    // [khoản nợ 66] Nay vế ấy được đo bằng DẤU VẾT trước, đồng hồ sau — và dấu vết mạnh hơn: nếu
    // 23503 quay lại, nhánh làm chậm KHÔNG chạy và khẳng định này đỏ ngay, không phụ thuộc tải.
    expect(soLanLamCham() - mocLa, "tổ chức lạ phải đi vào nhánh làm chậm ĐÚNG một lần, y như tổ chức thật").toBe(1);
    expect(Date.now() - t1, "tổ chức lạ phải chậm y như tổ chức thật").toBeGreaterThanOrEqual(TRE_TEST_MS);
  }, 120_000);

  it("[review H5-1] MỘT địa chỉ không khoá được cả tổ chức: 300 lời gọi từ một địa chỉ (30 tới handler, 270 là 429 rẻ) chỉ cộng 30 vào bucket tổ chức; địa chỉ sạch sau đó 200 và NHANH", async () => {
    const orgD = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty D', 'cong-ty-d') RETURNING id")).rows[0]?.id ?? "";
    for (let i = 0; i < LOGIN_LINK_MAX_PER_ORG; i += 1) {
      const r = await goi("POST", "/auth/link", { body: { orgId: orgD, email: "mot-dia-chi@vidu.vn" }, ip: "198.51.100.200" });
      expect(r.status, `lần ${i + 1}`).toBe(i < LOGIN_LINK_MAX_PER_CALLER ? 200 : 429);
    }
    const t0 = Date.now();
    const sach = await goi("POST", "/auth/link", { body: { orgId: orgD, email: "nguoi-that@vidu.vn" }, ip: "198.51.100.201" });
    expect(sach.status, "RED THẬT nếu bucket tổ chức được cộng cả khi người gọi đã vượt trần riêng").toBe(200);
    expect(Date.now() - t0).toBeLessThan(TRE_TEST_MS);
    const { rows } = await db.pool.query<{ hits: number; n: string }>(
      "SELECT hits, count(*)::text AS n FROM otp_rate_limits WHERE org_id = $1 AND bucket_kind = 'LOGIN_CALLER' GROUP BY hits ORDER BY hits",
      [orgD],
    );
    // [review H6-2] Bucket toàn tổ chức nay cũng ở `caller_rate_limits` (không khoá ngoại), nên
    // `otp_rate_limits` KHÔNG còn hàng `LOGIN_CALLER` nào của tổ chức này — bucket duy nhất còn ở
    // bảng cũ là bốn kind theo ĐÍCH của khách.
    expect(rows).toEqual([]);
    const { rows: moi } = await db.pool.query<{ hits: number; n: string }>(
      "SELECT hits, count(*)::text AS n FROM caller_rate_limits WHERE hits = $1 GROUP BY hits",
      [LOGIN_LINK_MAX_PER_CALLER + 1],
    );
    expect(Number(moi[0]?.n ?? 0)).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("/auth/redeem + /auth/totp — token không là phiên; TOTP mới là phiên", () => {
  it("[INV-E2] token đăng nhập nhét vào cookie ⇒ 401; redeem ghi danh trả bí mật ĐÚNG MỘT LẦN; không mở phiên", async () => {
    await taoNguoi("e2@vidu.vn");
    const { token, biMat } = await linkVaGhiDanh("e2@vidu.vn");
    expect(biMat).toHaveLength(20);
    expect((await goi("GET", "/me", { cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${token}` })).status).toBe(401);
  });

  it("[sổ nợ 42] hai cookie CÙNG TÊN trong một header ⇒ 401, kể cả khi một trong hai là phiên hợp lệ", async () => {
    await taoNguoi("trung-ten@vidu.vn");
    const { cookie } = await dangNhap("trung-ten@vidu.vn");
    expect((await goi("GET", "/me", { cookie })).status).toBe(200);
    const gia = `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${"x".repeat(43)}`;
    expect((await goi("GET", "/me", { cookie: `${gia}; ${cookie}` })).status).toBe(401);
    expect((await goi("GET", "/me", { cookie: `${cookie}; ${gia}` })).status).toBe(401);
    // Một cookie KHÁC TÊN đứng cạnh thì vô hại.
    expect((await goi("GET", "/me", { cookie: `khac=1; ${cookie}` })).status).toBe(200);
  });

  it("[review M-5] hồ sơ CHƯA xác nhận ⇒ redeem lần hai ghi danh LẠI (bí mật KHÁC), vẫn không mở phiên", async () => {
    await taoNguoi("e2b@vidu.vn");
    const { token, biMat } = await linkVaGhiDanh("e2b@vidu.vn");
    const lan2 = await goi("POST", "/auth/redeem", { body: { orgId: orgA, token } });
    expect(lan2.status).toBe(200);
    expect((lan2.body as { needsEnrollment: boolean; totpSecretBase32: string }).needsEnrollment).toBe(true);
    expect(base32Decode((lan2.body as { totpSecretBase32: string }).totpSecretBase32).equals(biMat)).toBe(false);
    expect(lan2.headers.get("set-cookie")).toBeNull();
  });

  it("[INV-E6] bí mật TOTP và token đăng nhập KHÔNG xuất hiện trong bất kỳ dòng log lỗi nào — trên một 500 THẬT", async () => {
    // [review M-6] Bản trước gửi `code: 123456` (số) và tin rằng nó ép 500 — thực tế 422 và không một
    // dòng log nào chạy: một phép đo RỖNG mang nhãn [INV-E6]. Nay ép 500 bằng bộ mở bí mật TOTP ném
    // (thông điệp lỗi giả CỐ Ý mang phong bì bí mật — nếu dispatcher in `err.message`, test đỏ), và
    // đòi log KHÔNG rỗng trước khi đòi nó không chứa bí mật.
    await taoNguoi("log@vidu.vn");
    const { token, biMat } = await linkVaGhiDanh("log@vidu.vn");
    const truoc = logLoi.length;
    dv.hong.totpUnsealer = true;
    try {
      const r = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
      expect(r.status).toBe(500);
      expect(r.text).toBe(JSON.stringify({ error: "loi noi bo" }));
    } finally {
      dv.hong.totpUnsealer = false;
    }
    expect(logLoi.length, "đường 500 phải ghi ĐÚNG một dòng — không có nó, phép đo dưới rỗng ruột").toBe(truoc + 1);
    const toanBo = logLoi.join("\n");
    expect(toanBo).not.toContain(token);
    expect(toanBo).not.toContain(biMat.toString("base64"));
    expect(toanBo).not.toContain(biMat.toString("hex"));
    expect(toanBo).not.toContain("KMS gia dang hong");
  });

  it("[review L-1] người bị ĐÌNH CHỈ với phiên còn hạn ⇒ 401 ngay, không đợi hết TTL", async () => {
    const u = await taoNguoi("dinhchi2@vidu.vn");
    const { cookie } = await dangNhap("dinhchi2@vidu.vn");
    expect((await goi("GET", "/me", { cookie })).status).toBe(200);
    await db.pool.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [u]);
    const r = await goi("GET", "/me", { cookie });
    expect(r.status).toBe(401);
    expect(r.text).toBe(JSON.stringify({ error: "phien khong hop le" }));
  });

  it("[review M-5] hồ sơ TOTP CHƯA xác nhận được ghi danh LẠI và để lại MFA_ENROLLED; hồ sơ ĐÃ xác nhận thì không", async () => {
    const u = await taoNguoi("ghidanh@vidu.vn");
    const dem = async () => Number((await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'MFA_ENROLLED'", [orgA, u])).rows[0]?.n ?? "-1");
    // Lần 1 (kẻ đọc trộm hộp thư): ghi danh, KHÔNG xác nhận.
    const l1 = await linkVaGhiDanh("ghidanh@vidu.vn");
    expect(await dem()).toBe(1);
    // Lần 2 (người thật, link mới): hồ sơ chưa xác nhận ⇒ ghi danh LẠI, bí mật KHÁC, MFA_ENROLLED thứ hai.
    const l2 = await linkVaGhiDanh("ghidanh@vidu.vn");
    expect(l2.biMat.equals(l1.biMat)).toBe(false);
    expect(await dem()).toBe(2);
    // Bí mật cũ KHÔNG còn mở được phiên; bí mật mới thì có.
    expect((await goi("POST", "/auth/totp", { body: { orgId: orgA, token: l2.token, code: maHienTai(l1.biMat) } })).status).toBe(401);
    const ok = await goi("POST", "/auth/totp", { body: { orgId: orgA, token: l2.token, code: maHienTai(l2.biMat) } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.text).not.toContain("userId");
    // Đã xác nhận: redeem link mới ⇒ needsEnrollment false, KHÔNG có MFA_ENROLLED mới, bí mật giữ nguyên.
    expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "ghidanh@vidu.vn" } })).status).toBe(200);
    await ob.chay(orgA);
    const rd = await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: dv.linkDaGui.at(-1)!.token } });
    expect(rd.body).toEqual({ needsEnrollment: false });
    expect(await dem()).toBe(2);
    // ~~Đột biến ở tầng SQL: UPDATE thay bí mật của hồ sơ ĐÃ xác nhận dưới app_api ⇒ 0 hàng (vế WHERE giữ).~~
    // [review H2-1] Câu trên xanh vì lý do SAI: nó tự mang `AND confirmed_at IS NULL`, nên 0 hàng chỉ
    // chứng minh hồ sơ đã xác nhận, không chứng minh CSDL từ chối. Nay câu đột biến KHÔNG mang vế
    // WHERE ấy và đòi trigger 032 ném; rồi gỡ trigger ⇒ cùng câu ĐI LỌT (1 hàng); khôi phục ⇒ lại ném.
    const thayBiMat = (ver = "x") =>
      withTenant(apiPool, orgA, (c) => c.query("UPDATE mfa_credentials SET secret_key_version = $2 WHERE user_id = $1", [u, ver]));
    const datLaiXacNhan = () =>
      withTenant(apiPool, orgA, (c) => c.query("UPDATE mfa_credentials SET confirmed_at = NULL WHERE user_id = $1", [u]));
    await expect(thayBiMat()).rejects.toThrow(/da xac nhan/u);
    await expect(datLaiXacNhan()).rejects.toThrow(/da xac nhan/u); // cặp UPDATE "mở khoá rồi thay" cũng chết ở nửa đầu
    await db.pool.query("DROP TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan ON mfa_credentials");
    try {
      expect((await thayBiMat()).rowCount).toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan BEFORE UPDATE ON mfa_credentials FOR EACH ROW EXECUTE FUNCTION public.mfa_credentials_khoa_ho_so_da_xac_nhan()",
      );
      await db.pool.query("ALTER TABLE mfa_credentials ENABLE ALWAYS TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan");
    }
    // Sau khi khôi phục: một giá trị KHÁC (hàng đã mang 'x' từ lần đột biến — cùng giá trị thì không có gì để đổi).
    await expect(thayBiMat("y")).rejects.toThrow(/da xac nhan/u);
    await expect(datLaiXacNhan()).rejects.toThrow(/da xac nhan/u);
    // Đường HỢP LỆ vẫn đi: đúng hình dạng câu UPDATE của `verifyTotpAttempt` (bộ đếm + COALESCE
    // confirmed_at) trên hồ sơ đã xác nhận ⇒ 1 hàng. (Đường TOTP thật trên hồ sơ đã xác nhận chạy
    // dưới cùng trigger ở `mfa.int.test.ts` [INV-E3] "confirmed_at không bị ghi đè".)
    const hopLe = await withTenant(apiPool, orgA, (c) =>
      c.query(
        "UPDATE mfa_credentials SET last_used_counter = 7, failed_attempts = 0, confirmed_at = COALESCE(confirmed_at, clock_timestamp()) WHERE user_id = $1",
        [u],
      ),
    );
    expect(hopLe.rowCount).toBe(1);
  });

  it("[INV-E1] mã đúng ⇒ cookie HttpOnly/Secure/Strict/Path=/ và /me mở; token đăng nhập TIÊU THỤ — replay ⇒ 422", async () => {
    const u = await taoNguoi("ok@vidu.vn");
    const { cookie, token } = await dangNhap("ok@vidu.vn");
    const me = await goi("GET", "/me", { cookie });
    expect(me.status).toBe(200);
    expect((me.body as { userId: string }).userId).toBe(u);
    // [review H2-10] Bản trước có một vòng `expect(tt).toBeTruthy()` trên bốn chuỗi hằng — một khẳng
    // định không thể đỏ, mang nhãn [INV-E1]. Đã bỏ; thuộc tính cookie đo ở test "thuộc tính cookie" dưới.
    const replay = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
    expect(replay.status).toBe(422);
    expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token } })).status).toBe(422);
    // Hàng phiên do app_api chèn mang mfa_verified_at — không có "đăng nhập nửa chừng".
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND mfa_verified_at IS NULL",
      [u],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("thuộc tính cookie phiên người mua", async () => {
    await taoNguoi("cookie@vidu.vn");
    const { token, biMat } = await linkVaGhiDanh("cookie@vidu.vn");
    const r = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: maHienTai(biMat) } });
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/^__Host-tp_session=[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,}/u);
    for (const tt of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/;"]) expect(sc).toContain(tt);
    // [sổ nợ 42] `__Host-` chỉ có nghĩa khi KHÔNG có `Domain` — trình duyệt bỏ cookie nếu có.
    expect(sc).not.toMatch(/domain=/iu);
    expect(r.text).not.toContain(/tp_session=[^.]+\.([^;]+)/u.exec(sc)?.[1] ?? "@@");
  });

  it("[INV-E3] sai MFA_MAX_FAILED_ATTEMPTS lần ⇒ khoá; ĐÚNG MỘT bản ghi MFA_LOCKED; lần sau vẫn khoá, không ghi thêm", async () => {
    const u = await taoNguoi("khoa@vidu.vn");
    const { token } = await linkVaGhiDanh("khoa@vidu.vn");
    const dem = async () =>
      Number(
        (await db.pool.query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'MFA_LOCKED'",
          [orgA, u],
        )).rows[0]?.n ?? "-1",
      );
    let cuoi: PhanHoi | undefined;
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i += 1) {
      cuoi = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
      expect(cuoi.status).toBe(401);
    }
    expect((cuoi?.body as { reason: string }).reason).toBe("WRONG_CODE");
    expect(await dem()).toBe(1);
    const sau = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
    expect(sau.status).toBe(401);
    expect((sau.body as { reason: string }).reason).toBe("LOCKED_OUT");
    expect(await dem()).toBe(1);
  });

  // =============================================================================================
  // [S1.75 / khoản 139 — lượt soi 70, H-1] ĐIỀU KIỆN ① CỦA ĐÁNH ĐỔI: CÁI THIẾU PHẢI ĐỂ LẠI DẤU.
  //
  // Chủ dự án nhận đánh đổi "hồ sơ khoá được, sổ thiếu một dòng" NGÀY 2026-09-17 kèm điều kiện cái
  // thiếu ấy không im lặng. Cưỡng chế của điều kiện ấy là MỘT dòng `console.error` ở
  // `routes/auth.ts`. Trước vế này, xoá cả khối log đi thì KHÔNG test nào đỏ — tức điều kiện của
  // chủ dự án sống bằng thiện chí của người sửa sau, không bằng một lớp.
  //
  // Vế này đi qua HTTP thật, với khoá ghi sổ của tổ chức bị một giao dịch khác giữ.
  // =============================================================================================
  it("[S1.75 / khoản 139] khoá ghi sổ bị giữ ⇒ hồ sơ VẪN khoá, sổ KHÔNG có dòng nào, và ĐÚNG MỘT dòng log để lại dấu", async () => {
    const u = await taoNguoi("k139@vidu.vn");
    const { token } = await linkVaGhiDanh("k139@vidu.vn");
    const demKhoa = async () =>
      Number(
        (await db.pool.query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'MFA_LOCKED'",
          [orgA, u],
        )).rows[0]?.n ?? "-1",
      );

    const giu = await apiPool.connect();
    // [khoản nợ 66] Mốc, không phải 0: `logLoi` cộng dồn suốt tệp.
    const mocLog = logLoi.length;
    let cuoi: PhanHoi | undefined;
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      await giu.query(
        "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'K139_GIU_KHOA', 'K139', NULL, '{}'::jsonb, NULL, NULL, NULL)",
        [orgA],
      );
      for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i += 1) {
        cuoi = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
      }
    } finally {
      await giu.query("ROLLBACK").catch(() => undefined);
      giu.release();
    }

    const dong = logLoi.slice(mocLog).filter((d) => d.includes("khoan 139"));
    const soDong = await demKhoa();
    const sau = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
    const ke = `status cuối: ${String(cuoi?.status)}; dòng log khoản 139: ${dong.length}; MFA_LOCKED: ${soDong}`;

    // ⑴ Không lần nào thành 500: 55P03 bị nuốt trong SAVEPOINT, request vẫn là một 401 bình thường.
    expect(cuoi?.status, `lần chạm ngưỡng vẫn là 401, không phải 500 — ${ke}`).toBe(401);
    // ⑵ Trần đã trở lại: lần sau bị chặn.
    expect(sau.status).toBe(401);
    expect((sau.body as { reason: string }).reason, `hồ sơ phải KHOÁ thật — ${ke}`).toBe("LOCKED_OUT");
    // ⑶ Sổ trống trong cửa sổ ấy.
    expect(soDong, `sổ không nhận dòng MFA_LOCKED nào — ${ke}`).toBe(0);
    // ⑷ VÀ CÁI THIẾU ĐỂ LẠI DẤU — đúng MỘT dòng. Đây là vế cưỡng chế điều kiện của chủ dự án.
    expect(dong.length, `phải có ĐÚNG một dòng log cho cái thiếu — ${ke}`).toBe(1);
    // ⑸ Dòng ấy KHÔNG nội suy giá trị nào (kỷ luật A2).
    expect(dong[0], "dòng log không được mang orgId").not.toContain(orgA);
    expect(dong[0], "dòng log không được mang userId").not.toContain(u);
  });

  it("đăng xuất: cookie bị xoá, phiên bị thu hồi, /me ⇒ 401; đăng xuất lần hai vẫn 401 (không phiên)", async () => {
    await taoNguoi("out@vidu.vn");
    const { cookie } = await dangNhap("out@vidu.vn");
    const r = await goi("POST", "/auth/logout", { cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await goi("GET", "/me", { cookie })).status).toBe(401);
    expect((await goi("POST", "/auth/logout", { cookie })).status).toBe(401);
  });
});

describe("[review H2-7] [sổ nợ 38] bộ gửi treo không chạm được phản hồi — và job treo có trần", () => {
  it("bộ gửi link TREO ⇒ /auth/link về 200 ngay (handler không gọi bộ gửi); ~~job của nó hết hạn với lý do HANDLER_TIMEOUT~~ [nợ 53] job DONE, việc gửi sau commit quá hạn ⇒ AFTER_COMMIT_FAILED; không log nào mang token", async () => {
    // ~~Bản trước: `await viec()` không trần; bộ gửi treo ⇒ email CÓ THẬT treo vô hạn, email lạ về ngay.~~
    // [sổ nợ 38] Handler HTTP không còn gọi bộ gửi — nó chỉ enqueue — nên một bộ gửi treo KHÔNG có cách
    // nào chạm vào RTT của phản hồi. Cái còn có trần là JOB: runner cắt handler theo `handlerTimeoutMs`.
    // [sổ nợ 53] Gửi nay là việc SAU COMMIT: job đã DONE, token đã commit, phần gửi quá hạn được báo
    // riêng và không thử lại.
    await taoNguoi("treo@vidu.vn");
    const treo = { name: "bo-gui-treo", send: () => new Promise<void>(() => undefined) };
    const dvTreo = { ...dv.services, loginLinkSender: treo };
    const obTreo = outboxTest(apiPool, dvTreo, { handlerTimeoutMs: 200 });
    const s2 = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dvTreo }));
    await new Promise<void>((xong) => s2.listen(0, "127.0.0.1", xong));
    try {
      const truoc = logLoi.length;
      const batDau = Date.now();
      const res = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/auth/link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: orgA, email: "treo@vidu.vn" }),
      });
      expect(res.status).toBe(200);
      expect(Date.now() - batDau).toBeLessThan(3000);
      expect(logLoi.slice(truoc)).toHaveLength(0);
      await obTreo.chay(orgA);
      expect(obTreo.loi.map((b) => b.reason)).toEqual(["AFTER_COMMIT_FAILED"]);
      expect(obTreo.loi[0]?.gaveUp).toBe(false);
      const { rows: jobTreo } = await db.pool.query<{ status: string; last_failure_reason: string | null }>(
        "SELECT status, last_failure_reason FROM outbox_jobs WHERE org_id = $1 AND kind = 'LOGIN_LINK_SEND' ORDER BY created_at DESC LIMIT 1",
        [orgA],
      );
      expect(jobTreo[0]).toEqual({ status: "DONE", last_failure_reason: null });
      // Không dòng log nào (của dispatcher lẫn runner test) mang email hay token.
      expect(logLoi.slice(truoc).join("\n")).not.toContain("treo@vidu.vn");
    } finally {
      await new Promise<void>((xong) => s2.close(() => xong()));
    }
  });
});

describe("[sổ nợ 53 / ADR-023] gửi link là việc SAU COMMIT", () => {
  it("tại lúc `send` được gọi, token ĐÃ COMMIT (đếm được từ pool khác) và job đã DONE; gửi hỏng ⇒ job vẫn DONE, AFTER_COMMIT_FAILED, không email thứ hai", async () => {
    await taoNguoi("saucommit@vidu.vn");
    const demToken = async (): Promise<number> =>
      Number((await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM user_login_tokens WHERE org_id = $1", [orgA])).rows[0]?.n);
    const truoc = await demToken();
    const thayLucGui: { token: number; job: string | undefined }[] = [];
    const guiRoiHong = {
      name: "bo-gui-do-truoc-commit",
      send: async () => {
        // ~~Trước nợ 53: token nằm trong giao dịch CHƯA commit của job ⇒ pool khác đếm được `truoc`.~~
        const { rows } = await db.pool.query<{ status: string }>(
          "SELECT status FROM outbox_jobs WHERE org_id = $1 AND kind = 'LOGIN_LINK_SEND' ORDER BY created_at DESC LIMIT 1",
          [orgA],
        );
        thayLucGui.push({ token: await demToken(), job: rows[0]?.status });
        throw new Error("SMTP hong");
      },
    };
    const obHong = outboxTest(apiPool, { ...dv.services, loginLinkSender: guiRoiHong });
    expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "saucommit@vidu.vn" } })).status).toBe(200);
    expect(await obHong.chay(orgA)).toBe(1);
    expect(thayLucGui).toEqual([{ token: truoc + 1, job: "DONE" }]);
    expect(obHong.loi.map((b) => [b.reason, b.gaveUp])).toEqual([["AFTER_COMMIT_FAILED", false]]);
    // Không thử lại: lượt chạy sau không nhặt gì, không token thứ hai, bộ gửi không được gọi lần hai.
    expect(await obHong.chay(orgA)).toBe(0);
    expect(await demToken()).toBe(truoc + 1);
    expect(thayLucGui).toHaveLength(1);
  });
});

describe("[029] app_api không tạo được phiên thiếu MFA", () => {
  it("INSERT sessions thiếu mfa_verified_at bởi app_api bị trigger từ chối; superuser thì chèn được; đột biến gỡ trigger ⇒ ĐI LỌT", async () => {
    const u = await taoNguoi("trigger@vidu.vn");
    const chen = () =>
      withTenant(apiPool, orgA, (c) =>
        c.query("INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [
          orgA,
          u,
          randomBytes(32),
        ]),
      );
    await expect(chen()).rejects.toThrow(/MFA/u);
    // Superuser (đường test/vận hành) vẫn tạo được — trigger cố ý điều kiện theo role.
    await db.pool.query("INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [orgA, u, randomBytes(32)]);
    // Đột biến: gỡ trigger → câu chèn của app_api ĐI LỌT. Khôi phục sau đó.
    await db.pool.query("DROP TRIGGER sessions_kiem_mfa_khi_tao ON sessions");
    try {
      await expect(chen()).resolves.toBeDefined();
    } finally {
      await db.pool.query("CREATE TRIGGER sessions_kiem_mfa_khi_tao BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION public.sessions_kiem_mfa_khi_tao()");
      await db.pool.query("ALTER TABLE sessions ENABLE ALWAYS TRIGGER sessions_kiem_mfa_khi_tao");
    }
    await expect(chen()).rejects.toThrow(/MFA/u);
  });
});

// ==============================================================================================
// [khoản 141 / ADR-039] PHẠM VI CỦA CHỨNG CHỈ — ĐO TRÊN POSTGRES THẬT, QUA HTTP THẬT
//
// Trước vòng này, "MCP chỉ đọc" là một tính chất của MÁY KHÁCH: mọi lớp nằm ở phía `apps/mcp`, và
// một máy khách khác cầm cùng cookie làm được mọi thứ người mua làm được. Bộ đo dưới đây là chỗ
// câu ấy thôi là lời hứa và thành một 403 THẬT do `apps/api` nói.
//
// Bốn nhóm, và nhóm thứ tư mới là nhóm khó giả mạo nhất:
//   ⑴ đường PHÁT chứng chỉ agent chạy được, và nó đòi một mã TOTP tươi (trigger 039 bắt buộc thế);
//   ⑵ phiên agent LÀM ĐƯỢC việc của nó — đối chứng dương, để ba khẳng định TỪ CHỐI không xanh vì
//      phiên hỏng;
//   ⑶ phiên agent bị TỪ CHỐI ở đúng ba nhóm: route ghi, route đọc ngoài phạm vi, và chính đường
//      phát chứng chỉ (không tự nhân bản);
//   ⑷ mỗi lần từ chối để lại một hàng `AGENT_SCOPE_DENIED` trong sổ, và CSDL tự giữ hai bảo đảm
//      còn lại: trần TTL một giờ, và phạm vi KHÔNG nâng cấp tại chỗ được (42501).
// ==============================================================================================
describe("[khoản 141] phạm vi của chứng chỉ phiên", () => {
  const UUID_GIA = "00000000-0000-4000-8000-000000000001";

  /** Đăng nhập NGƯỜI rồi đổi lấy một chứng chỉ agent bằng một mã TOTP tươi. */
  async function phienAgent(email: string): Promise<{ cookie: string; cookieNguoi: string; token: string }> {
    await taoNguoi(email);
    const nguoi = await dangNhap(email);
    // Mã của bước KẾ TIẾP, không phải mã hiện tại: `dangNhap` vừa tiêu thụ mã của bước này, và
    // `verifyTotpAttempt` chống phát lại bằng `last_used_counter` — dùng lại chính nó thì 401
    // WRONG_CODE. Bước +1 vẫn nằm trong cửa sổ ±3 mà trigger 039 đòi.
    const r = await goi("POST", "/auth/agent-session", {
      cookie: nguoi.cookie,
      body: { code: deriveTotpCode(nguoi.biMat, counterForTime(Date.now()) + 1) },
    });
    expect(r.status, r.text).toBe(200);
    const b = r.body as { token: string; expiresInSeconds: number; kind: string };
    expect(b.kind).toBe("AGENT_READONLY");
    // Lần PHÁT một phạm vi mới là sự kiện duy nhất trong vòng đời chứng chỉ, nên nó phải ở trong
    // sổ — và hàng ấy nêu cả phiên NGƯỜI đã xin, thứ cần tra ngược khi một `AGENT_SCOPE_DENIED`
    // xuất hiện. (Một lượt đột biến đổi tên action đi qua sạch trước khi có khẳng định này.)
    const soPhat = await db.pool.query<{ resource_id: string; payload: { issuedBySessionId?: string } }>(
      `SELECT resource_id, payload FROM audit_events
        WHERE org_id = $1 AND action = 'AGENT_SESSION_ISSUED' ORDER BY seq DESC LIMIT 1`,
      [orgA],
    );
    expect(soPhat.rows[0]?.payload?.issuedBySessionId, "hàng sổ không nêu phiên người đã xin").toBeTruthy();
    // Trần một giờ, và nó do `startAgentSession` ghim — người gọi không xin dài hơn được.
    expect(b.expiresInSeconds).toBe(3600);
    return { cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${b.token}`, cookieNguoi: nguoi.cookie, token: b.token };
  }

  it("⑴ đường phát ĐÒI một mã TOTP tươi — mã sai thì 401 và không có phiên nào ra đời", async () => {
    await taoNguoi("agent-ma-sai@vd.test");
    const nguoi = await dangNhap("agent-ma-sai@vd.test");
    const truoc = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM sessions WHERE org_id = $1 AND kind = 'AGENT_READONLY'",
      [orgA],
    );
    const r = await goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: "000000" } });
    expect(r.status, r.text).toBe(401);
    const sau = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM sessions WHERE org_id = $1 AND kind = 'AGENT_READONLY'",
      [orgA],
    );
    expect(sau.rows[0]?.n).toBe(truoc.rows[0]?.n);
  });

  it("⑵ ĐỐI CHỨNG DƯƠNG: phiên agent đọc được đúng những đường nó được phép", async () => {
    const a = await phienAgent("agent-doi-chung@vd.test");
    const me = await goi("GET", "/me", { cookie: a.cookie });
    expect(me.status, me.text).toBe(200);
    // `/me` nay trả `kind` — đường DUY NHẤT để một máy khách tự kiểm mình đang cầm loại gì.
    expect((me.body as { kind: string }).kind).toBe("AGENT_READONLY");
    for (const duong of ["/suppliers", "/policy"]) {
      const r = await goi("GET", duong, { cookie: a.cookie });
      expect(r.status, `${duong}: ${r.text}`).toBe(200);
    }
  });

  it("⑶ TỪ CHỐI: route ghi, route đọc ngoài phạm vi, và chính đường phát chứng chỉ", async () => {
    const a = await phienAgent("agent-tu-choi@vd.test");
    const ca = [
      { ten: "route GHI", method: "POST", duong: "/suppliers", body: { legalName: "X", taxCode: "1" } },
      { ten: "bảng so sánh GIÁ", method: "GET", duong: `/rfqs/${UUID_GIA}/comparison` },
      { ten: "số hồ sơ thầu", method: "GET", duong: `/rfqs/${UUID_GIA}/bid-count` },
      { ten: "liên hệ nhà cung cấp", method: "GET", duong: `/suppliers/${UUID_GIA}/contacts` },
      { ten: "tự nhân bản chứng chỉ", method: "POST", duong: "/auth/agent-session", body: { code: "123456" } },
    ];
    for (const c of ca) {
      const r = await goi(c.method, c.duong, { cookie: a.cookie, body: c.body });
      expect(r.status, `${c.ten} (${c.method} ${c.duong}): ${r.text}`).toBe(403);
    }
    // ĐỐI CHỨNG: cùng một đường, dưới phiên NGƯỜI, KHÔNG ra 403 — nếu không thì các khẳng định
    // trên xanh vì một lý do khác (route hỏng, uuid sai), chứ không vì phạm vi.
    //
    // Chọn `/suppliers/:id/contacts` chứ KHÔNG chọn `/comparison`, và lý do đáng ghi: `comparison`
    // và `bid-count` là hai route ĐỌC CÓ CỔNG QUYỀN riêng — gói tự gọi `requirePermission(BID_VIEW)`
    // — nên chúng ra 403 cho cả phiên người của một vai BUYER thường. Dùng chúng làm đối chứng là
    // đo nhầm lớp: một 403 ở đó không phân biệt được "sai quyền" với "sai phạm vi". Hàng sổ
    // `AGENT_SCOPE_DENIED` ở khẳng định ⑷ mới là thứ phân biệt hai ca.
    const nguoi = await goi("GET", `/suppliers/${UUID_GIA}/contacts`, { cookie: a.cookieNguoi });
    expect(nguoi.status, nguoi.text).not.toBe(403);
  });

  it("⑷ mỗi lần từ chối để lại ĐÚNG MỘT hàng `AGENT_SCOPE_DENIED` nêu tên route", async () => {
    const a = await phienAgent("agent-so-kiem-toan@vd.test");
    const truoc = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND action = 'AGENT_SCOPE_DENIED'",
      [orgA],
    );
    const r = await goi("GET", `/rfqs/${UUID_GIA}/comparison`, { cookie: a.cookie });
    expect(r.status).toBe(403);
    const sau = await db.pool.query<{ n: string; payload: { routePath?: string } | null }>(
      `SELECT count(*) OVER () AS n, payload FROM audit_events
        WHERE org_id = $1 AND action = 'AGENT_SCOPE_DENIED'
        ORDER BY seq DESC LIMIT 1`,
      [orgA],
    );
    expect(Number(sau.rows[0]?.n ?? 0)).toBe(Number(truoc.rows[0]?.n ?? 0) + 1);
    // Hàng sổ nêu MẪU đường dẫn đã khai trong ROUTES, không phải chuỗi người gọi gửi.
    expect(sau.rows[0]?.payload?.routePath).toBe("/rfqs/:rfqId/comparison");
  });

  it("⑷ CHECK trần TTL là của CSDL, không của TypeScript — chèn thẳng một phiên agent 2 giờ thì 23514", async () => {
    // Đột biến bỏ `sessions_agent_ttl_ngan` từng đi qua sạch: khẳng định cũ đọc `expires_at −
    // created_at` của một hàng do `startAgentSession` tạo, mà hàm ấy tự ghim 3 600 s — tức nó đo
    // TypeScript. Câu dưới đây đi thẳng vào bảng dưới quyền superuser, nên nó đo đúng CHECK.
    const nguoiId = await taoNguoi("agent-check-ttl@vd.test");
    const chen = (giay: number): Promise<unknown> =>
      db.pool.query(
        `INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at, kind)
         VALUES ($1, $2, decode(repeat('ab', 32), 'hex'), now() + make_interval(secs => $3), now(), 'AGENT_READONLY')`,
        [orgA, nguoiId, giay],
      );
    await expect(chen(7200)).rejects.toMatchObject({ code: "23514" });
    // Đối chứng dương: đúng trong trần thì vào được — nếu không, câu trên đỏ vì một lý do khác.
    await expect(chen(1800)).resolves.toBeDefined();
  });

  it("⑷ `kind` lạ đọc lên thì NÉM, không rơi về USER — fail-closed ở tầng đọc", async () => {
    // Đột biến làm `docKind` trả "USER" cho mọi giá trị lạ từng đi qua sạch. Ca này dựng đúng tình
    // huống ấy: gỡ CHECK trong MỘT giao dịch, đặt một giá trị lạ, rồi đo qua HTTP thật. CHECK được
    // đặt lại ở `finally` — một phép đo để lại lược đồ hỏng là một phép đo hỏng.
    const a = await phienAgent("agent-kind-la@vd.test");
    try {
      await db.pool.query("ALTER TABLE sessions DROP CONSTRAINT sessions_kind_hop_le");
      await db.pool.query(
        "UPDATE sessions SET kind = 'KHONG_PHAI_LOAI_NAO' WHERE org_id = $1 AND kind = 'AGENT_READONLY'",
        [orgA],
      );
      const r = await goi("GET", "/me", { cookie: a.cookie });
      // `SessionInvalidError` ⇒ 401, cùng một thân với mọi ca phiên hỏng khác.
      expect(r.status, r.text).toBe(401);
    } finally {
      await db.pool.query(
        "UPDATE sessions SET kind = 'AGENT_READONLY' WHERE org_id = $1 AND kind = 'KHONG_PHAI_LOAI_NAO'",
        [orgA],
      );
      await db.pool.query(
        "ALTER TABLE sessions ADD CONSTRAINT sessions_kind_hop_le CHECK (kind IN ('USER', 'AGENT_READONLY'))",
      );
    }
  });

  it("⑷ CSDL giữ trần TTL một giờ và KHÔNG cho nâng cấp phạm vi tại chỗ", async () => {
    await phienAgent("agent-csdl@vd.test");
    const { rows } = await db.pool.query<{ giay: string; kind: string }>(
      `SELECT extract(epoch FROM (expires_at - created_at)) AS giay, kind
         FROM sessions WHERE org_id = $1 AND kind = 'AGENT_READONLY' ORDER BY created_at DESC LIMIT 1`,
      [orgA],
    );
    expect(Number(rows[0]?.giay ?? 0)).toBeLessThanOrEqual(3600);

    // Bất biến ⑶ của 051: phạm vi bất biến bằng một QUYỀN VẮNG MẶT, không bằng một trigger.
    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await c.query("UPDATE public.sessions SET kind = 'USER' WHERE org_id = $1", [orgA]);
      }),
    ).rejects.toMatchObject({ code: "42501" });

    // Và tập giá trị: một loại phiên thứ ba không vào bảng được, kể cả dưới superuser.
    await expect(
      db.pool.query("UPDATE sessions SET kind = 'SOMETHING_ELSE' WHERE org_id = $1", [orgA]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  // ===============================================================================================
  // ⑸ [GIAO ĐIỂM S1.75 × S1.76 — ĐO] ĐIỀU KIỆN ① CỦA CHỦ DỰ ÁN ĐI THEO SỰ KIỆN, KHÔNG THEO ĐƯỜNG.
  //
  // Khoản 139 (§S1.75) nhận đánh đổi "hồ sơ khoá được, sổ thiếu một dòng" kèm điều kiện cái thiếu
  // phải để lại dấu, và cưỡng chế điều kiện ấy bằng MỘT dòng log ở `/auth/totp`. Vòng này thêm một
  // đường phát thứ hai đi qua CÙNG `verifyTotpForLogin`. Hai nhánh gộp sạch — không xung đột, mọi
  // cổng xanh — và đường mới im lặng: `auditSkipped` không ai đọc ở đó.
  //
  // Đây là lý do vế này tồn tại: điều kiện của chủ dự án nói về SỰ KIỆN `MFA_LOCKED`, không về một
  // đường HTTP cụ thể, nên mỗi đường mới đi qua hàm ấy phải tự mang lại cái dấu. Đo qua HTTP thật,
  // với khoá ghi sổ của tổ chức bị một giao dịch khác giữ.
  // ===============================================================================================
  it("⑸ đường phát agent cũng để lại ĐÚNG MỘT dấu khi `MFA_LOCKED` không vào được sổ", async () => {
    const u = await taoNguoi("agent-k139@vd.test");
    const nguoi = await dangNhap("agent-k139@vd.test");
    const demKhoa = async () =>
      Number(
        (
          await db.pool.query<{ n: string }>(
            "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'MFA_LOCKED'",
            [orgA, u],
          )
        ).rows[0]?.n ?? "-1",
      );

    // [S1.78 / lượt soi ngang 72] TIỀN ĐỀ CỦA VẾ NÀY ĐÃ HẾT ĐÚNG, và nói ra chứ không sửa lặng lẽ.
    //
    // Bản S1.76 mồi hồ sơ tới `MFA_MAX_FAILED_ATTEMPTS - 1` rồi coi MỘT lần sai trên đường phát
    // agent là lần CHẠM NGƯỠNG — cảnh ấy tới được vì trần khi đó là trần theo CỬA SỔ, và một cửa sổ
    // sạch cho ba lần bất kể hồ sơ đang ở đâu.
    //
    // Trần nay là trần theo TRẠNG THÁI (`mfaTranDuongPhu`, §S1.78), nên với hồ sơ đã ở 4 thì đường
    // phát agent KHÔNG thử mã nữa — nó trả 429 trước khi chạm `verifyTotpForLogin`. Tức đường này
    // **không bao giờ còn là lần khoá được nữa**, và đó là một SIẾT, không phải một hồi quy.
    //
    // Vế này vì thế đổi thứ nó đo: từ *"lần chạm ngưỡng để lại dấu"* sang *"đường phụ không chạm
    // được ngưỡng"* — mệnh đề mạnh hơn, và là mệnh đề mà chủ dự án đã chọn ngày 2026-09-18. Mồi vẫn
    // bằng CSDL để cảnh là cảnh thật (hồ sơ sát ngưỡng vì những lần sai trên `/auth/totp`).
    await db.pool.query("UPDATE mfa_credentials SET failed_attempts = $1 WHERE org_id = $2 AND user_id = $3", [
      MFA_MAX_FAILED_ATTEMPTS - 1,
      orgA,
      u,
    ]);

    const giu = await apiPool.connect();
    // [khoản nợ 66] Mốc, không phải 0: `logLoi` cộng dồn suốt tệp.
    const mocLog = logLoi.length;
    let cuoi: PhanHoi | undefined;
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      await giu.query(
        "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'K139_GIU_KHOA_AGENT', 'K139', NULL, '{}'::jsonb, NULL, NULL, NULL)",
        [orgA],
      );
      cuoi = await goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: "000000" } });
    } finally {
      await giu.query("ROLLBACK").catch(() => undefined);
      giu.release();
    }

    const dong = logLoi.slice(mocLog).filter((d) => d.includes("khoan 139"));
    const soDong = await demKhoa();
    const ke = `status cuối: ${String(cuoi?.status)}; dòng log khoản 139: ${dong.length}; MFA_LOCKED: ${soDong}`;

    const sauCung = await db.pool.query<{ locked_until: string | null; failed_attempts: number }>(
      "SELECT locked_until, failed_attempts FROM mfa_credentials WHERE org_id = $1 AND user_id = $2",
      [orgA, u],
    );
    const keDu = `${ke}; failed sau: ${String(sauCung.rows[0]?.failed_attempts)}; locked: ${String(sauCung.rows[0]?.locked_until)}`;

    // ⑴ Hồ sơ đã ở sát ngưỡng thì đường phụ TỪ CHỐI, không thử mã: 429, không 401.
    expect(cuoi?.status, `đường phụ phải từ chối khi hồ sơ sát ngưỡng — ${keDu}`).toBe(429);
    // ⑵ Và lần từ chối ấy KHÔNG làm bộ đếm tăng — nếu nó tăng thì chính lớp phòng thủ này là đường
    //    đẩy hồ sơ tới ngưỡng, chỉ chậm hơn.
    expect(Number(sauCung.rows[0]?.failed_attempts), `lần từ chối không được tăng bộ đếm — ${keDu}`)
      .toBe(MFA_MAX_FAILED_ATTEMPTS - 1);
    // ⑶ Hồ sơ KHÔNG khoá. Đây là mệnh đề thay chỗ cho ⑶⑷⑸ của bản S1.76 (đếm dòng log của lần
    //    chạm ngưỡng): đường này không chạm ngưỡng được nữa nên không có dấu nào để đếm.
    expect(sauCung.rows[0]?.locked_until, `hồ sơ KHÔNG được khoá qua đường phụ — ${keDu}`).toBeNull();
    // ⑷ Và không có `MFA_LOCKED` nào — kể cả một hàng sổ ghi được.
    expect(soDong, `không lần khoá nào xảy ra — ${keDu}`).toBe(0);
    // ⑸ Không dòng log nào của khoản 139 trên đường này, vì không có cái thiếu nào để báo.
    expect(dong.length, `không có lần ghi sổ nào hỏng để phải báo — ${keDu}`).toBe(0);
  });
  // ===============================================================================================
  // ⑹ [S1.78 / khoản 144 — ĐO; chủ dự án chọn "trần theo TRẠNG THÁI" ngày 2026-09-18]
  // MỘT COOKIE TRỘM ĐƯỢC KHÔNG KHOÁ ĐƯỢC HỒ SƠ CỦA CHỦ NHÂN NÓ — KỂ CẢ KHI KẺ TẤN CÔNG BIẾT CHỜ.
  //
  // Vế này thay vế ⑹ của S1.76, và lý do thay là một phép đo chứ không phải một ý thích.
  //
  // Bản S1.76 chặn bằng trần theo CỬA SỔ (`sessionLimit: 3` trên `caller_rate_limits`) và vế ⑹ cũ
  // gọi bảy lời gọi trong MỘT vòng lặp chặt — trọn vẹn trong một cửa sổ. Lượt soi ngang 72 chỉ ra
  // cửa sổ ấy NHẢY về 0 ở những mốc công khai còn `failed_attempts` thì ĐƠN ĐIỆU, và phép đo bác
  // bản vá ấy: `401,401,401,401,401`, `failed_attempts` 3 → 5, hồ sơ KHOÁ, nạn nhân `LOCKED_OUT`
  // trên đường đăng nhập thật với mã ĐÚNG (§S1.78 mục 2).
  //
  // VÌ SAO VẾ NÀY XOÁ SẠCH BẢNG ĐẾM GIỮA CHỪNG, và đó là chỗ nó có răng: xoá `caller_rate_limits`
  // là dạng MẠNH NHẤT của "một cửa sổ mới đã tới" — mạnh hơn mọi lần chờ. Một trần theo cửa sổ,
  // bất kể độ dài, đi qua được vế này; chỉ một trần đọc THẲNG `failed_attempts` mới đứng. Ai thay
  // trần trạng thái bằng một bộ đếm song song thì vế này ĐỎ.
  // ===============================================================================================
  it("⑹ trần trạng thái đứng qua MỌI lần cửa sổ đếm được làm mới ⇒ hồ sơ không khoá, nạn nhân vẫn đăng nhập được", async () => {
    const u = await taoNguoi("tran-trang-thai@vd.test");
    const nguoi = await dangNhap("tran-trang-thai@vd.test");

    const ma: number[] = [];
    const ban = async (): Promise<void> => {
      const r = await goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: "000000" } });
      ma.push(r.status);
    };

    // Đợt 1 — tới ngưỡng trạng thái.
    for (let i = 0; i < 3; i += 1) await ban();
    // MỌI bộ đếm theo cửa sổ được làm mới hoàn toàn. Đây là điều kẻ tấn công có được bằng cách CHỜ.
    const xoa = await db.pool.query("DELETE FROM caller_rate_limits");
    // Đợt 2 — nếu trần là một bộ đếm song song thì đợt này lại đi qua được.
    for (let i = 0; i < 3; i += 1) await ban();

    const { rows } = await db.pool.query<{ locked_until: string | null; failed_attempts: number }>(
      "SELECT locked_until, failed_attempts FROM mfa_credentials WHERE org_id = $1 AND user_id = $2",
      [orgA, u],
    );
    const ke = `chuỗi status: ${ma.join(",")}; đã xoá ${String(xoa.rowCount)} hàng bucket; failed=${String(rows[0]?.failed_attempts)}`;

    // ⑴ Ngưỡng cắt ở đúng chỗ đã khai, và LẦN CẮT KHÔNG LÀM BỘ ĐẾM TĂNG — nếu nó tăng thì chính
    //    lớp phòng thủ này là đường đẩy hồ sơ tới ngưỡng.
    expect(ma.slice(0, MFA_TRAN_SAI_DUONG_PHU), `hai lần đầu tới handler — ${ke}`)
      .toEqual(Array(MFA_TRAN_SAI_DUONG_PHU).fill(401));
    expect(ma.slice(MFA_TRAN_SAI_DUONG_PHU), `mọi lần sau phải là 429, KỂ CẢ sau khi xoá bucket — ${ke}`)
      .toEqual(Array(ma.length - MFA_TRAN_SAI_DUONG_PHU).fill(429));
    expect(Number(rows[0]?.failed_attempts), `bộ đếm phải dừng ở ngưỡng — ${ke}`).toBe(MFA_TRAN_SAI_DUONG_PHU);

    // ⑵ Và đây là điều trần ấy tồn tại để bảo vệ.
    expect(rows[0]?.locked_until, `hồ sơ KHÔNG được khoá — ${ke}`).toBeNull();

    // ⑶ Đòn không tới đích: nạn nhân đăng nhập được bằng mã ĐÚNG, qua đúng đường thật.
    const truoc = dv.linkDaGui.length;
    await goi("POST", "/auth/link", { body: { orgId: orgA, email: "tran-trang-thai@vd.test" } });
    await ob.chay(orgA);
    expect(dv.linkDaGui).toHaveLength(truoc + 1);
    const tk = dv.linkDaGui.at(-1)?.token ?? "";
    await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: tk } });
    const vao = await goi("POST", "/auth/totp", {
      body: { orgId: orgA, token: tk, code: deriveTotpCode(nguoi.biMat, counterForTime(Date.now()) + 1) },
    });
    expect(vao.status, `nạn nhân phải đăng nhập được — ${ke}; thân: ${vao.text}`).toBe(200);
  });
  // ===============================================================================================
  // ⑺ [S1.78 / khoản 144 — ĐO] MỘT YÊU CẦU GIỮ ĐÚNG **MỘT** KẾT NỐI CỦA POOL NGHIỆP VỤ.
  //
  // Vế ⑺ của S1.76 đo một tính chất KHÁC: "phép đếm sống qua một handler ném". Tính chất ấy nay
  // KHÔNG CÒN Ý NGHĨA và nói ra chứ không lặng lẽ bỏ — trần trạng thái là một phép ĐỌC THUẦN, nên
  // không có gì để sống qua một rollback. Thứ thế chỗ nó là tính chất dưới đây, và nó quan trọng
  // hơn: bản S1.76 mở một `withTenant(deps.pool, …)` LỒNG bên trong giao dịch đang giữ một kết nối
  // của CHÍNH pool ấy, không trần chờ.
  //
  // `composition.ts` dùng tiền đề "mỗi yêu cầu giữ MỘT kết nối của `pool`" để định cỡ `auditPool`;
  // `pool.ts` viết rằng rút cạn pool là "chạm tới người của TỔ CHỨC KHÁC". Đo trên bản S1.76
  // (§S1.78 mục 3): còn một kết nối rảnh thì route có trần TREO 8 007 ms còn route không trần đi
  // qua trong 36 ms; nhả kết nối thì nó chạy tiếp trong 17 ms.
  //
  // Vế này là phép đo ấy, giữ lại làm vế canh. `apiPool` của `poolAs` có `max = 3`.
  // ===============================================================================================
  it("⑺ route có trần trạng thái chỉ cần MỘT kết nối: còn một kết nối rảnh thì nó vẫn đi qua", async () => {
    await taoNguoi("mot-ket-noi-a@vd.test");
    await taoNguoi("mot-ket-noi-b@vd.test");
    const a = await dangNhap("mot-ket-noi-a@vd.test");
    const b = await dangNhap("mot-ket-noi-b@vd.test");

    const coHan = async (ten: string, p: Promise<{ status: number }>): Promise<string> => {
      const t = Date.now();
      let het: NodeJS.Timeout | undefined;
      const dongHo = new Promise<string>((ok) => {
        het = setTimeout(() => ok("TREO"), 8_000);
      });
      const r = await Promise.race([p.then((v) => `xong:${String(v.status)}`, () => "ném"), dongHo]);
      if (het !== undefined) clearTimeout(het);
      return `${ten}=${r}/${String(Date.now() - t)}ms`;
    };

    // Chiếm 2 trong 3 kết nối ⇒ còn ĐÚNG MỘT. Một route cần hai kết nối sẽ đứng ở đây.
    const giu1 = await apiPool.connect();
    const giu2 = await apiPool.connect();
    const ke: string[] = [];
    try {
      // Đối chứng: route tự thân KHÔNG chạm hồ sơ MFA (`mfaTranDuongPhu: null`) — vốn chỉ cần một.
      ke.push(await coHan("logout", goi("POST", "/auth/logout", { cookie: a.cookie })));
      // Vế chịu lực: route CÓ trần trạng thái cũng chỉ được cần một.
      const pAgent = goi("POST", "/auth/agent-session", { cookie: b.cookie, body: { code: "000000" } });
      void pAgent.catch(() => undefined);
      ke.push(await coHan("agent-session", pAgent));
    } finally {
      giu1.release();
      giu2.release();
    }
    const chung = ke.join(" | ");

    expect(chung, `đối chứng: route một-kết-nối phải đi qua — ${chung}`).toContain("logout=xong:200");
    expect(chung, `route có trần trạng thái KHÔNG được cần kết nối thứ hai — ${chung}`).toContain("agent-session=xong:401");
  });
});

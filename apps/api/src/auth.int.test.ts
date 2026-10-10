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
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { verifyAuditChain } from "@trustprocure/audit";
import { LOGIN_MAX_TOKENS_PER_WINDOW, MFA_MAX_FAILED_ATTEMPTS, MFA_TRAN_SAI_DUONG_PHU, counterForTime, deriveTotpCode, issueLoginToken } from "@trustprocure/identity";
import { OTP_RATE_WINDOW_SECONDS } from "@trustprocure/invitation";
import { createRfq } from "@trustprocure/rfq";
import { createSupplier } from "@trustprocure/supplier";
import { withTenant } from "@trustprocure/tenancy";
import { choQuaMocCuaSo, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { taoDocDiaChi } from "./dia-chi.js";
import { BOI_TRAN_DIA_CHI, createDispatcher } from "./dispatch.js";
import { THAN_429_MFA, agentGoiDuoc, type Route } from "./route-types.js";
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
// bị gỡ ở cả tệp: `toBeLessThan(TRE_TEST_MS)` trong test `[review H5-1]` và `toBeLessThan(3000)`
// trong test `[sổ nợ 38]` (bộ gửi treo) vẫn là khẳng định thời gian tuyệt đối kiểu "phải nhanh".
// [S1.79] Neo theo TÊN TEST: hai con trỏ cũ ~~`:546`~~ ~~`:768`~~ lệch 7 dòng NGAY TỪ commit viết ra
// chúng (chính khối chú thích này đẩy xuống), và ở HEAD lệch 90 và 149 dòng. Cả hai đo MỘT
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

// [khoản 346] Các ca của tệp này đếm tới trần của bộ đếm cửa sổ CỐ ĐỊNH (`caller_rate_limits`/`otp_rate_limits`, cửa sổ
// `OTP_RATE_WINDOW_SECONDS` neo vào giờ CSDL) rồi đòi lần N+1 bị chặn, hay đếm hàng của một cửa sổ — đúng chỉ khi cả ca nằm
// trong MỘT cửa sổ. Sát mốc lật thì chờ qua mốc trước khi ca chạy; biên 60 s gấp gần sáu lần ca dài nhất đo ở evidence (10,6 s).
beforeEach(async () => {
  await choQuaMocCuaSo(db.pool, { cuaSoGiay: OTP_RATE_WINDOW_SECONDS, bienGiay: 60 });
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
  // ~~TEST NÀY TỰ HIỆU CHUẨN, có chủ đích: nó KHÔNG đóng cứng một điểm mã, vì tập điểm mã phân
  // kỳ phụ thuộc libc của máy chủ (đo được: 124 điểm trên musl, 28 trên glibc). Nó hỏi chính
  // CSDL đang chạy xem điểm mã nào phân kỳ, rồi dùng cái đầu tiên. Không có điểm nào — nghĩa là
  // hai hàm đã trùng khít — thì test nói thẳng là nó không đo được gì, chứ không xanh im lặng.~~
  // [S1.229 / khoản 71] Đoạn vừa gạch mô tả ca CŨ; ca dưới lật theo `092_email_ascii` — xem chú thích ngay trên `it`.
  // ==========================================================================================
  // **[S1.229 / khoản 71 / ADR-132] LẬT CÓ CHỦ ĐÍCH.** ~~địa chỉ mà JS và máy chủ hạ chữ thường KHÁC NHAU vẫn tìm ra người dùng~~ — ca
  // cũ CẤT một địa chỉ mang điểm mã phân kỳ (tự tìm lúc chạy) rồi đo `/auth/link` tìm ra nó. Nay `092_email_ascii` thu hẹp miền
  // `users.email` về ASCII in được: địa chỉ ấy KHÔNG CẤT ĐƯỢC (23514) — nên trên mọi giá trị cất được, hai hàm hạ chữ thường trùng khít
  // bất kể libc. Bản vá S1.27 (cả hai vế cùng `pg_catalog.lower()`) vẫn giữ trong `login.ts`: nó đúng không nhờ miền. Và `/auth/link` với
  // địa chỉ ấy vẫn là CÙNG một 200, một job, không link — không ai liệt kê được miền qua cửa này. Không cần tự hiệu chuẩn nữa: điểm mã
  // chọn cố định (Ⓐ, U+24B6 — điểm phân kỳ đo được trên musl ở S1.27).
  it("[sổ nợ 63] [S1.229 / khoản 71] địa chỉ mang điểm mã ngoài ASCII không cất được vào `users` (092, cả dạng hoa lẫn dạng đã hạ), và `/auth/link` với nó vẫn 200 không link", async () => {
    const diaChi = "\u24B6lice-63@vidu.vn";
    const org63 = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('Cong ty 63', 'cong-ty-63') RETURNING id",
      )
    ).rows[0]!.id;
    const chen = (email: string): Promise<string | null> =>
      db.pool
        .query("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Nguoi 63', 'ACTIVE')", [org63, email])
        .then(
          () => null,
          (e: { code?: string; constraint?: string }) => `${e.code ?? "?"} ${e.constraint ?? "?"}`,
        );
    expect(await chen(diaChi), "dạng hoa: hai ràng buộc cùng vi phạm, PostgreSQL nêu một").toMatch(/^23514 users_email_(ascii|chu_thuong)$/u);
    expect(await chen(diaChi.toLowerCase()), "dạng đã hạ (ⓐ — điểm bất động của lower() trên musl, 048 cho qua): 092 chặn").toBe("23514 users_email_ascii");
    expect(await chen("alice-63@vidu.vn"), "đối chứng ASCII").toBeNull();

    const truoc = dv.linkDaGui.length;
    const r = await goi("POST", "/auth/link", { body: { orgId: org63, email: diaChi } });
    expect(r.status, "cùng một 200 với mọi email đúng hình dạng").toBe(200);
    expect(await ob.chay(org63), "handler không nhìn bảng người dùng: vẫn một job").toBe(1);
    expect(dv.linkDaGui.length, "không người dùng nào mang địa chỉ ấy ⇒ không link").toBe(truoc);
  });

  // [S1.247 / khoản 283 / ADR-139] DẤU CHẤM CUỐI TÊN MIỀN. RFC 5321 coi `vidu.vn.` là dạng tuyệt đối của `vidu.vn`: hai hàng `users` khác
  // nhau MỘT dấu chấm cuối là HAI người dùng cho MỘT hộp thư, mỗi người xin được một magic link riêng — đo trước (lược đồ tới 095): hàng thứ
  // hai VÀO và `/auth/link` với dạng có dấu chấm phát link cho nó. Nay `users_email_khong_dau_cham_cuoi` (`100_email_khong_dau_cham_cuoi.sql`)
  // chặn ở lược đồ, và `/auth/link` KHÔNG chuẩn hoá (câu 12 của kế hoạch đợt 3 — chuẩn hoá là phương án bị loại): dạng có dấu chấm không tìm
  // ra người dùng dạng không dấu chấm — cùng một 200, một job, không link. Link của dạng không dấu chấm là đối chứng dương của kênh quan sát.
  // Một phép so gộp để lần đỏ in trọn trạng thái đo được, không dừng ở vế đầu.
  it("[khoản 283] `dot-283@vidu.vn.` không cất được cạnh `dot-283@vidu.vn` ở `users` (23514 có tên), và `/auth/link` với dạng có dấu chấm cuối vẫn 200 không link — không chuẩn hoá", async () => {
    const org283 = (
      await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty 283', 'cong-ty-283') RETURNING id")
    ).rows[0]!.id;
    const chen = (email: string): Promise<string | null> =>
      db.pool
        .query("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Nguoi 283', 'ACTIVE')", [org283, email])
        .then(
          () => null,
          (e: { code?: string; constraint?: string }) => `${e.code ?? "?"} ${e.constraint ?? "?"}`,
        );
    expect(await chen("dot-283@vidu.vn"), "đối chứng").toBeNull();
    const truoc = dv.linkDaGui.length;
    const chenCham = await chen("dot-283@vidu.vn.");
    const chenHaiCham = await chen("hai-283@vidu.vn..");
    const trangThai: number[] = [];
    for (const email of ["dot-283@vidu.vn", "dot-283@vidu.vn."]) {
      trangThai.push((await goi("POST", "/auth/link", { body: { orgId: org283, email } })).status);
    }
    const soJob = await ob.chay(org283);
    const linkToi = dv.linkDaGui
      .slice(truoc)
      .map((l) => l.email)
      .sort();
    expect({ chenCham, chenHaiCham, trangThai, soJob, linkToi }, "một hộp thư, một người dùng, một link").toEqual({
      chenCham: "23514 users_email_khong_dau_cham_cuoi",
      chenHaiCham: "23514 users_email_khong_dau_cham_cuoi",
      trangThai: [200, 200],
      soJob: 2,
      linkToi: ["dot-283@vidu.vn"],
    });
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

  it("[khoản 199] `tranRieng` chỉ SIẾT, không NỚI — một tham số không được phép vượt trần chung", async () => {
    // Vế kẹp `Math.min` của `issueLoginToken`. Không đường sản xuất nào truyền một trần lớn hơn
    // trần chung hôm nay, nên nếu không có phép đo này thì đổi `Math.min(...)` thành `??` là một
    // đột biến SỐNG — đã chạy và đã thấy nó sống ở lượt đột biến của vòng S1.93.
    await taoNguoi("kep@vidu.vn");
    const ket: string[] = [];
    await withTenant(apiPool, orgA, async (c) => {
      for (let i = 0; i < LOGIN_MAX_TOKENS_PER_WINDOW + 2; i += 1) {
        const kq = await issueLoginToken(c, orgA, { email: "kep@vidu.vn", tranRieng: 9999 });
        ket.push(kq.ok ? "ok" : kq.reason);
      }
    });
    expect(ket.filter((k) => k === "ok"), "trần chung vẫn cưỡng chế dù người gọi xin 9999").toHaveLength(
      LOGIN_MAX_TOKENS_PER_WINDOW,
    );
    expect(ket.at(-1)).toBe("RATE_LIMITED");
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
  // ===============================================================================================
  // ⑻ [S1.83 / lượt soi ngang 73 — khoản 144, LẦN THỨ BA] TRẦN TRẠNG THÁI PHẢI ĐỨNG CẢ KHI
  // CÙNG LÚC, KHÔNG CHỈ KHI TUẦN TỰ.
  //
  // Vế ⑹ ngay trên đo kịch bản TUẦN TỰ và tự viết rằng *"ai thay trần trạng thái bằng một bộ đếm
  // song song thì vế này ĐỎ"*. Nó đúng — nhưng nó KHÔNG BAO GIỜ bắn hai yêu cầu cùng lúc, nên nó
  // không nói gì về chiều ĐỒNG THỜI. Lượt soi ngang 73 hỏi đúng chiều ấy, và phép đo trả lời:
  //
  //   `conChoChoDuongPhu` (mfa-credentials.ts) là một `SELECT c.failed_attempts` TRẦN — không
  //   `FOR UPDATE`, không khoá tư vấn — rồi trả `failed_attempts < tran`. Lần TĂNG nằm ở CUỐI
  //   đường, trong một câu khác (`CAU_DAT_COC`). Giữa hai chỗ đó là cả handler. Ở READ COMMITTED,
  //   N giao dịch bắn cùng lúc đều đọc `failed_attempts = 0`, đều thấy `0 < 2`, đều ĐI QUA cổng;
  //   rồi N câu tăng xếp hàng trên khoá HÀNG và bộ đếm cuối = N.
  //
  // VÀ NÓ LÀ MỘT HỒI QUY, đo được: thứ S1.78 thay — `tangBucketNguoiGoi`
  // (`packages/invitation/src/invitation.ts`) — là `INSERT … ON CONFLICT DO UPDATE SET
  // hits = hits + 1 RETURNING hits`, một phép TĂNG-RỒI-ĐỌC **nguyên tử**: N yêu cầu song song vẫn
  // chỉ cho `sessionLimit` lần thử. Ở chiều TUẦN TỰ bản S1.78 mạnh hơn (nó đứng qua mọi lần cửa
  // sổ làm mới — vế ⑹); ở chiều CÙNG LÚC nó KHÔNG có trần nào, còn bản cũ thì có. Hai chiều, hai
  // kết quả ngược nhau, nên cả hai vế phải cùng sống ở đây.
  //
  // CỠ CỦA LỖ BẰNG SỐ KẾT NỐI KẺ TẤN CÔNG GIÀNH ĐƯỢC. `poolAs` của bộ test có `max = 3`, nên ở
  // đây đo được ĐÚNG vế "ngưỡng bị vượt" (3 > 2). Vế HỆ QUẢ — khoá hẳn hồ sơ — cần đồng thời
  // >= `MFA_MAX_FAILED_ATTEMPTS`, tức một pool >= 5; pool nghiệp vụ mặc định của sản xuất là 10
  // (`apps/api/src/cau-hinh.ts`). KHÔNG đo được ở đây thì KHÔNG khai ở đây: vế dưới khẳng định
  // đúng thứ đo được, và hệ quả ghi ở biên bản §S1.83.
  //
  // RED THẬT trên mã trước bản vá: `failed_attempts` = 3 và ba mã đều 401.
  //
  // -----------------------------------------------------------------------------------------------
  // [S1.220 / khoản 184 — lượt soi ngang 74 góc 4] CHỒNG LẤN ĐƯỢC ÉP VÀ ĐƯỢC ĐO, KHÔNG ĐƯỢC CẦU MAY.
  //
  // Bản S1.83 của vế này bắn ba yêu cầu bằng `Promise.all` rồi đòi `2×401, 1×429, failed = 2`. Nó
  // KHÔNG chứng được ba yêu cầu thật sự chồng nhau: chỉ cần chúng chạy TUẦN TỰ (tải máy, gộp socket,
  // máy chủ xử lý nối tiếp) là cổng đọc-rồi-làm CŨ ở bộ điều phối cho ra ĐÚNG bộ số ấy — đo được:
  // đổi `Promise.all` thành ba `await` nối tiếp ⇒ vế xanh (§S1.220). Tức phép đo có thể suy biến
  // thành bản sao đắt tiền của vế ⑹ mà không ai biết, đúng lúc khoản 144 — lớp lỗi đã quay lại BA
  // lần — cần một người tố giác.
  //
  // Nay cảnh được DỰNG: một giao dịch ngoài giữ khoá HÀNG hồ sơ MFA của người này (`FOR UPDATE`),
  // nên cả ba yêu cầu đi qua cổng đọc-rồi-làm của bộ điều phối (cùng đọc `failed_attempts = 0`) rồi
  // cùng ĐỨNG CHỜ ở câu `CAU_DAT_COC`. Vế đếm qua `pg_stat_activity`/`pg_locks` đủ BA backend đang
  // chờ — bị chặn (trực tiếp hay dây chuyền) bởi người giữ, và đã cầm `RowExclusiveLock` trên
  // `mfa_credentials`, tức đang ở chính câu `UPDATE` ấy — RỒI MỚI nhả khoá. Không đủ ba thì vế ĐỎ
  // ở tiền đề, không ở kết luận. Ba câu `UPDATE` được thả nối tiếp trên cùng một hàng: hai câu đầu
  // thấy `0 < 2`, `1 < 2` và tăng; câu thứ ba đánh giá lại vị từ trên hàng ĐÃ cập nhật (EvalPlanQual),
  // thấy `2 < 2` sai, chạm 0 hàng ⇒ `SIDE_PATH_EXHAUSTED` ⇒ 429. Nên bộ số nay là ĐẲNG THỨC.
  //
  // Đột biến đo được (§S1.220): ⒜ ba yêu cầu tuần tự ⇒ chỉ MỘT backend chờ ⇒ tiền đề đỏ; ⒝ gỡ vị
  // từ `$3` khỏi `CAU_DAT_COC` (mô phỏng cổng đọc-rồi-làm của bản trước S1.83) ⇒ `401,401,401`,
  // `failed = 3` ⇒ kết luận đỏ.
  //
  // Khẳng định `locked_until IS NULL` của bản trước ĐÃ BỎ: `MFA_MAX_FAILED_ATTEMPTS = 5`, cả bản cũ
  // (3) lẫn bản mới (2) đều dưới ngưỡng, nên nó luôn đúng — chính khối trên đã viết "KHÔNG đo được ở
  // đây thì KHÔNG khai ở đây".
  // -----------------------------------------------------------------------------------------------
  // ===============================================================================================
  it("⑻ ba lần thử CÙNG LÚC không vượt được trần trạng thái — ngưỡng là của CÂU LỆNH, không của một phép đọc trước đó", async () => {
    const u = await taoNguoi("tran-cung-luc@vd.test");
    const nguoi = await dangNhap("tran-cung-luc@vd.test");

    /**
     * Số backend đang CHỜ ở câu `CAU_DAT_COC`: bị chặn bởi `pidGiu` — trực tiếp, hay dây chuyền qua một
     * backend khác đang chờ cùng hàng (PostgreSQL xếp người chờ thứ hai sau người chờ thứ nhất, nên
     * `pg_blocking_pids` của nó trỏ tới người ấy chứ không tới người giữ) — VÀ đã cầm `RowExclusiveLock`
     * trên `mfa_credentials`, thứ chỉ một câu ghi lên bảng ấy mới lấy. Cổng đọc của bộ điều phối chỉ
     * lấy `AccessShareLock`, nên một backend còn đứng ở cổng KHÔNG được đếm.
     */
    const demBackendChoDatCoc = async (pidGiu: number): Promise<number> => {
      const { rows } = await db.pool.query<{ n: number }>(
        "WITH RECURSIVE cho(pid) AS (" +
          "  SELECT a.pid FROM pg_catalog.pg_stat_activity a WHERE $1::int = ANY (pg_catalog.pg_blocking_pids(a.pid))" +
          "  UNION" +
          "  SELECT a.pid FROM pg_catalog.pg_stat_activity a JOIN cho c ON c.pid = ANY (pg_catalog.pg_blocking_pids(a.pid))" +
          ") SELECT count(*)::int AS n FROM cho c WHERE EXISTS (" +
          "  SELECT 1 FROM pg_catalog.pg_locks l WHERE l.pid = c.pid AND l.granted AND l.locktype = 'relation'" +
          "    AND l.relation = 'public.mfa_credentials'::pg_catalog.regclass AND l.mode = 'RowExclusiveLock')",
        [pidGiu],
      );
      return rows[0]?.n ?? -1;
    };

    const giu = await db.pool.connect();
    let soChoToiDa = 0;
    let msDuBa = -1;
    let ma: number[] = [];
    try {
      await giu.query("BEGIN");
      const pidGiu = (await giu.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      const khoa = await giu.query("SELECT 1 FROM mfa_credentials WHERE org_id = $1 AND user_id = $2 FOR UPDATE", [orgA, u]);
      expect(khoa.rowCount, "tiền đề: phải khoá được ĐÚNG hàng hồ sơ MFA của người này").toBe(1);

      // Ba yêu cầu bắn CÙNG LÚC. `poolAs` có max = 3 nên cả ba nằm trong ba giao dịch song song —
      // và từ vòng này điều đó được ĐO ở vòng lặp dưới, không được suy ra từ cỡ pool.
      const viec = Promise.all(
        Array.from({ length: 3 }, () => goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: "000000" } })),
      );
      void viec.catch(() => undefined);

      const batDau = Date.now();
      while (Date.now() - batDau < 10_000) {
        const n = await demBackendChoDatCoc(pidGiu);
        soChoToiDa = Math.max(soChoToiDa, n);
        if (n >= 3) {
          msDuBa = Date.now() - batDau;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      // Nhả khoá RỒI mới chờ ba câu trả lời — thứ tự ngược lại là một vòng chờ khép kín.
      await giu.query("ROLLBACK");
      ma = (await viec).map((r) => r.status);
    } finally {
      await giu.query("ROLLBACK").catch(() => undefined);
      giu.release();
    }

    const { rows } = await db.pool.query<{ failed_attempts: number }>(
      "SELECT failed_attempts FROM mfa_credentials WHERE org_id = $1 AND user_id = $2",
      [orgA, u],
    );
    const dem = Number(rows[0]?.failed_attempts);
    const ke =
      `status: ${ma.slice().sort().join(",")}; failed=${String(dem)}; trần=${String(MFA_TRAN_SAI_DUONG_PHU)}; ` +
      `chờ tối đa ${String(soChoToiDa)} backend, đủ ba sau ${String(msDuBa)} ms`;

    // ⓪ TIỀN ĐỀ, và nó là vế làm hai vế dưới có nghĩa: cả BA đã cùng đứng ở câu `CAU_DAT_COC` trước khi
    //    khoá được nhả. Đây là chỗ đột biến ⒜ (ba yêu cầu tuần tự) đỏ.
    expect(soChoToiDa, `tiền đề: cả BA backend phải cùng chờ ở CAU_DAT_COC trước khi khoá được nhả — ${ke}`).toBe(3);

    // ⑴ VẾ CHỊU LỰC. Bộ đếm dừng ĐÚNG ở ngưỡng, dù ba câu tăng được thả liền nhau trên cùng một hàng.
    //    Đây là đúng lời khai mà khối `mfaTranDuongPhu` ở `routes/auth.ts` viết ra, đọc theo chiều đồng
    //    thời; và vì chồng lấn đã được ép, nó là đẳng thức chứ không còn là `<=`.
    expect(dem, `bộ đếm phải dừng ĐÚNG ở ngưỡng dù ba câu tăng chồng nhau — ${ke}`).toBe(MFA_TRAN_SAI_DUONG_PHU);

    // ⑵ Hệ quả trực tiếp, đếm bằng chính mã trả về chứ không bằng đồng hồ: đúng `ngưỡng` lần tới được
    //    cổng mở bí mật (401), phần dư bị cắt bằng 429 — ở câu lệnh, vì cổng của bộ điều phối đã cho
    //    cả ba đi qua.
    expect(ma.slice().sort(), `đúng ${String(MFA_TRAN_SAI_DUONG_PHU)}×401 và phần dư 429 — ${ke}`).toEqual([
      ...Array<number>(MFA_TRAN_SAI_DUONG_PHU).fill(401),
      ...Array<number>(3 - MFA_TRAN_SAI_DUONG_PHU).fill(429),
    ]);
  });
  // ===============================================================================================
  // ⑼ [S1.209 / khoản 188] NGƯỠNG MÀ CÂU LỆNH DÙNG LÀ NGƯỠNG CỦA BẢNG ROUTE — KHÔNG PHẢI MỘT HẰNG HANDLER TỰ NHẬP.
  //
  // S1.83 khai *"cùng một hằng nên hai nơi không trôi khỏi nhau"* — đúng cho GIÁ TRỊ, không đúng cho SỰ CÓ MẶT (S1.87): không ai canh
  // handler của một route khai ngưỡng có truyền ngưỡng ấy xuống câu lệnh không. Từ vòng này bộ điều phối đưa `route.mfaTranDuongPhu`
  // vào `ctx.mfaTranDuongPhu` và handler truyền ĐÚNG thứ ấy xuống `CAU_DAT_COC` (vế T1 ở `routes.test.ts`). Vế này đo qua HTTP thật,
  // TUẦN TỰ và TẤT ĐỊNH: nhân bản bảng route với `/auth/agent-session` khai ngưỡng 3 — LỚN HƠN hằng 2, nhỏ hơn ngưỡng khoá 5 — rồi gõ
  // sai liên tiếp. Lần thứ ba đi qua cổng đi trước của bộ điều phối (`failed_attempts` 2 < 3, cổng đọc bảng route), nên thứ duy nhất
  // còn cắt được nó là vị từ trong câu lệnh, với ngưỡng mà HANDLER truyền: nhập hằng 2 ⇒ `CAU_DAT_COC` không giành được cọc ⇒ 429 ở
  // lần ba (ĐỎ trên mã trước vòng này, đo được `401,401,429`, failed = 2); đọc ctx ⇒ 401 ở lần ba, 429 ở lần bốn, failed = 3.
  //
  // VÌ SAO KHÔNG ĐO CHIỀU CÙNG LÚC như ⑻: bản đầu của vế này bắn ba mã sai song song với ngưỡng route 1, và trên mã CŨ ba lượt chạy
  // đều cho `401,429,429` — các yêu cầu của CÙNG một phiên xếp hàng qua cổng đi trước trên máy đo, nên chiều ấy không phân biệt được
  // hai nguồn ngưỡng. Một phép đo không đỏ được trên mã cũ thì không phải một phép đo; hình dạng tuần tự ở đây đỏ tất định.
  // ===============================================================================================
  it("⑼ bảng route nhân bản khai ngưỡng 3 (≠ hằng 2): ba lần sai đều 401, lần bốn 429, failed_attempts = 3 — câu lệnh dùng ngưỡng của route", async () => {
    const NGUONG_ROUTE = 3;
    expect(NGUONG_ROUTE, "vế chỉ có nghĩa khi ngưỡng của route LỚN HƠN hằng: lần thứ (hằng + 1) mới là lần phân biệt").toBeGreaterThan(MFA_TRAN_SAI_DUONG_PHU);
    expect(NGUONG_ROUTE, "và nhỏ hơn ngưỡng khoá, để vẫn là một ngưỡng phụ có nghĩa").toBeLessThan(MFA_MAX_FAILED_ATTEMPTS);
    // Hai route tự thân VỌNG LẠI thứ bộ điều phối đưa vào `ctx.mfaTranDuongPhu` — đo trực tiếp vế "bộ điều phối điền từ bảng route",
    // vì chuỗi tuần tự của agent-session bên dưới không phân biệt được "điền null" với "điền đúng" (không ngưỡng trong câu lệnh thì cổng
    // đi trước vẫn cắt ở cùng chỗ). Cùng khuôn `/auth/*`, `self: true`, `agent: false` mà `timViPhamBangRoute` đòi.
    const vong = (path: string, mfaTranDuongPhu: number | null): Route => ({
      method: "POST", path, audience: "BUYER", mutates: true, self: true, agent: false, mfaTranDuongPhu,
      handler: (ctx) => Promise.resolve({ status: 200, body: { nguong: ctx.mfaTranDuongPhu } }),
    });
    const bangHep: readonly Route[] = [
      ...ROUTES.map((r) =>
        r.audience === "BUYER" && r.mutates && r.self === true && r.path === "/auth/agent-session" ? { ...r, mfaTranDuongPhu: NGUONG_ROUTE } : r,
      ),
      vong("/auth/vong-nguong-9101", NGUONG_ROUTE),
      vong("/auth/vong-khong-nguong-9101", null),
    ];
    expect(bangHep.filter((r) => r.audience === "BUYER" && r.mutates && r.self === true && r.mfaTranDuongPhu === NGUONG_ROUTE)).toHaveLength(2);
    const s2 = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services, routes: bangHep }), {
      remoteAddressOf: taoDocDiaChi(["127.0.0.1"]),
    });
    await new Promise<void>((xong) => s2.listen(0, "127.0.0.1", xong));
    const goc2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      const u = await taoNguoi("nguong-cua-route@vd.test");
      const nguoi = await dangNhap("nguong-cua-route@vd.test");
      // ⓐ Bộ điều phối điền đúng lời khai của TỪNG route: có ngưỡng ⇒ ngưỡng ấy; `null` ⇒ `null`.
      const v1 = await goi("POST", "/auth/vong-nguong-9101", { cookie: nguoi.cookie, body: {}, goc: goc2 });
      expect(v1.status, v1.text).toBe(200);
      expect(v1.body, "ctx.mfaTranDuongPhu phải là ngưỡng route khai").toEqual({ nguong: NGUONG_ROUTE });
      const v0 = await goi("POST", "/auth/vong-khong-nguong-9101", { cookie: nguoi.cookie, body: {}, goc: goc2 });
      expect(v0.status, v0.text).toBe(200);
      expect(v0.body, "route khai null thì ctx mang null").toEqual({ nguong: null });
      // ⓑ Và handler thật truyền đúng thứ ấy xuống câu lệnh: chuỗi tuần tự dưới đây.
      const ma: number[] = [];
      for (let i = 0; i < NGUONG_ROUTE + 1; i += 1) {
        ma.push((await goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: "000000" }, goc: goc2 })).status);
      }
      const { rows } = await db.pool.query<{ locked_until: string | null; failed_attempts: number }>(
        "SELECT locked_until, failed_attempts FROM mfa_credentials WHERE org_id = $1 AND user_id = $2",
        [orgA, u],
      );
      const dem = Number(rows[0]?.failed_attempts);
      const ke = `status: ${ma.join(",")}; failed=${String(dem)}; ngưỡng route=${String(NGUONG_ROUTE)}; hằng=${String(MFA_TRAN_SAI_DUONG_PHU)}`;
      // Vế chịu lực: lần thứ (hằng + 1) — cổng đi trước đã cho qua — phải TỚI câu lệnh và tiêu ngân sách, tức 401, không 429.
      expect(ma.slice(0, NGUONG_ROUTE), `đúng ${String(NGUONG_ROUTE)} lần đầu tới câu lệnh — ngưỡng của ROUTE, không của hằng — ${ke}`)
        .toEqual(Array<number>(NGUONG_ROUTE).fill(401));
      expect(ma[NGUONG_ROUTE], `lần thứ ${String(NGUONG_ROUTE + 1)} bị cắt ở đúng ngưỡng route — ${ke}`).toBe(429);
      expect(dem, `bộ đếm dừng ở ngưỡng của ROUTE — ${ke}`).toBe(NGUONG_ROUTE);
      expect(rows[0]?.locked_until, `hồ sơ KHÔNG được khoá — ${ke}`).toBeNull();
    } finally {
      await new Promise<void>((xong) => s2.close(() => xong()));
    }
  });
  // ===============================================================================================
  // ⑽ [S1.209 / khoản 174] HỆ QUẢ VẬN HÀNH CỦA GIAO ĐIỂM 144 × 153, GHIM LẠI: GÕ SAI TOTP ĐỦ NGƯỠNG TRÊN ĐƯỜNG CHÍNH THÌ KHÔNG XOAY ĐƯỢC
  // CHỨNG CHỈ AGENT — KỂ CẢ VỚI MÃ ĐÚNG — CHO TỚI KHI ĐĂNG NHẬP ĐÚNG MỘT LẦN.
  //
  // Chứng chỉ `AGENT_READONLY` có TTL trần một giờ và cách duy nhất có chứng chỉ mới là gọi lại `/auth/agent-session` với một mã tươi
  // (khoản 153, ADR-039). Trần trạng thái của ⑹–⑻ đứng trên đúng route ấy và đọc `failed_attempts` — một bộ đếm mà ĐƯỜNG CHÍNH cũng
  // tăng. Hệ quả: một người đã sai `MFA_TRAN_SAI_DUONG_PHU` lần trên `/auth/totp` thì đường phát agent từ chối họ TRƯỚC khi thử mã, dù
  // mã đúng; tiến trình MCP đang chạy dừng ở giờ kế tiếp. Fail-closed CÓ CHỦ Ý (đường phụ không được tiêu ngân sách của đường chính)
  // — vế này ghim bốn điều để nó không thành một bất ngờ vận hành: ⒜ mã đúng vẫn 429 thân cố định; ⒝ lần cắt không tiêu mã, không tăng
  // bộ đếm, không khoá; ⒞ đường ra DUY NHẤT là một lần đăng nhập đúng trên đường chính (`CAU_GHI_THANH_CONG` đặt `failed_attempts = 0`)
  // — cùng mã vừa bị 429 vẫn dùng được ở đó; ⒟ sau đó đường phát agent lại tới được câu lệnh (một mã sai cho 401, không 429).
  // ===============================================================================================
  it("⑽ failed_attempts = ngưỡng trên đường chính ⇒ /auth/agent-session 429 kể cả mã ĐÚNG và không tiêu mã; đăng nhập đúng mở lại", async () => {
    const email = "xoay-agent-sau-sai@vd.test";
    const u = await taoNguoi(email);
    const nguoi = await dangNhap(email);
    const docHoSo = async (): Promise<{ failed_attempts: number; locked_until: string | null; last_used_counter: string | null }> =>
      (
        await db.pool.query<{ failed_attempts: number; locked_until: string | null; last_used_counter: string | null }>(
          "SELECT failed_attempts, locked_until, last_used_counter FROM mfa_credentials WHERE org_id = $1 AND user_id = $2",
          [orgA, u],
        )
      ).rows[0] ?? { failed_attempts: -1, locked_until: "?", last_used_counter: "?" };
    // Mồi cảnh bằng CSDL: chừng ấy lần sai TRÊN ĐƯỜNG CHÍNH — hồ sơ vẫn bình thường (chưa khoá), chỉ đã tới ngưỡng đường phụ.
    await db.pool.query("UPDATE mfa_credentials SET failed_attempts = $1 WHERE org_id = $2 AND user_id = $3", [MFA_TRAN_SAI_DUONG_PHU, orgA, u]);
    const truoc = await docHoSo();
    // Mã của bước KẾ TIẾP — `dangNhap` vừa tiêu bước hiện tại; +1 vẫn trong cửa sổ ±1 của `verifyTotpCode` và ±3 của trigger 039.
    const maDung = deriveTotpCode(nguoi.biMat, counterForTime(Date.now()) + 1);

    // ⒜ Mã ĐÚNG vẫn bị cắt, cùng thân với mọi lần cắt của trần trạng thái.
    const r = await goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: maDung } });
    expect(r.status, "mã đúng vẫn phải 429 khi hồ sơ đã ở ngưỡng đường phụ (thân không in: phản hồi 200 mang token)").toBe(429);
    expect(r.body).toEqual(THAN_429_MFA);
    // ⒝ Lần cắt là một phép đọc: không tiêu mã, không tăng bộ đếm, không khoá.
    expect(await docHoSo(), "lần cắt không được đổi hồ sơ").toEqual(truoc);
    expect(truoc.locked_until).toBeNull();

    // ⒞ Đường ra duy nhất: đăng nhập đúng trên đường chính — bằng CHÍNH mã vừa bị 429, vì lần cắt không tiêu nó.
    const daGui = dv.linkDaGui.length;
    await goi("POST", "/auth/link", { body: { orgId: orgA, email } });
    await ob.chay(orgA);
    expect(dv.linkDaGui).toHaveLength(daGui + 1);
    const tk = dv.linkDaGui.at(-1)?.token ?? "";
    expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: tk } })).status).toBe(200);
    const vao = await goi("POST", "/auth/totp", { body: { orgId: orgA, token: tk, code: maDung } });
    expect(vao.status, `đăng nhập đúng phải mở lại được — ${vao.text}`).toBe(200);
    expect((await docHoSo()).failed_attempts, "một lần đúng đặt bộ đếm về 0").toBe(0);

    // ⒟ Đường phát agent lại tới được câu lệnh: một mã SAI cho 401 (đã thử mã), không còn 429 (bị cắt trước khi thử).
    const lai = await goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: "000000" } });
    expect(lai.status, `sau khi đăng nhập đúng, đường phát agent phải thử mã trở lại — ${lai.text}`).toBe(401);
    expect((await docHoSo()).failed_attempts).toBe(1);
  });

  // ===============================================================================================
  // [S1.154 / khoản 142 · 144 / ADR-091] NHÁNH CHO QUA: MỖI LẦN ĐỌC CỦA AGENT LÀ MỘT HÀNG SỔ, CÙNG
  // GIAO DỊCH VỚI CHÍNH LẦN ĐỌC — VÀ MỘT TRẦN THEO PHIÊN ĐỨNG TRƯỚC NÓ.
  //
  // Trước vòng này, bảy route ĐỌC mà `agentGoiDuoc` cho qua không để lại một dòng nào trong
  // `audit_events` — đo trên mã cũ: vế ⒜ ra 0 hàng `AGENT_READ` ở mọi route. Bốn vế:
  //   ⒜ mỗi route trong bảy: phiên agent ⇒ ĐÚNG MỘT hàng, mang MẪU route; phiên NGƯỜI ⇒ KHÔNG hàng
  //      nào (lần đọc của người vẫn không ghi sổ, như trước);
  //   ⒝ fail-closed: khoá ghi sổ của tổ chức bị giữ ⇒ lần ghi gãy 55P03 ở 2 s ⇒ 500 thân cố định,
  //      KHÔNG một byte dữ liệu và không hàng nào;
  //   ⒞ chuỗi sổ vẫn liền sau các lần đọc ấy (bộ kiểm chứng thật);
  //   ⒟ vượt trần theo phiên ⇒ 429, không hàng sổ thêm; phiên agent KHÁC và phiên người không bị
  //      ảnh hưởng.
  // ===============================================================================================
  describe("[S1.154 / khoản 142] lần đọc của phiên agent ghi sổ cùng giao dịch", () => {
    /** Bảy route ĐỌC mà phiên agent gọi được, dựng trên dữ liệu THẬT để handler trả 200. */
    interface CanhDoc {
      readonly a: { cookie: string; cookieNguoi: string };
      readonly sessionAgent: string;
      readonly duong: readonly { readonly mau: string; readonly that: string }[];
      readonly tenNhaCungCap: string;
    }

    async function demAgentRead(): Promise<number> {
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND action = 'AGENT_READ'",
        [orgA],
      );
      return Number(rows[0]?.n ?? "-1");
    }

    async function dungCanh(email: string): Promise<CanhDoc> {
      const a = await phienAgent(email);
      const meNguoi = await goi("GET", "/me", { cookie: a.cookieNguoi });
      expect(meNguoi.status, meNguoi.text).toBe(200);
      const { userId, sessionId: sessionNguoi } = meNguoi.body as { userId: string; sessionId: string };
      const meAgent = await goi("GET", "/me", { cookie: a.cookie });
      const sessionAgent = (meAgent.body as { sessionId: string }).sessionId;
      const tenNhaCungCap = `NCC bi mat ${randomBytes(4).toString("hex")}`;
      const { ncc, rfq } = await withTenant(apiPool, orgA, async (c) => ({
        ncc: await createSupplier(c, orgA, { legalName: tenNhaCungCap, actorSessionId: sessionNguoi }),
        rfq: await createRfq(c, orgA, { title: "goi thau doc boi agent", createdBySessionId: sessionNguoi }),
      }));
      // Yêu cầu mở thầu đòi gói ĐÃ ĐÓNG (trigger `unseal_requests_kiem_rfq_da_dong`). Fixture tắt
      // đúng trigger MÁY TRẠNG THÁI của `rfq_packages` trong MỘT giao dịch rồi trả nó về đúng chế
      // độ cũ (`tgenabled`) — cùng khuôn `bidding.int.test.ts`; trigger đang được đo ở vòng này
      // không nằm trên bảng ấy.
      const g = await db.pool.connect();
      let unsealId = "";
      try {
        await g.query("BEGIN");
        const cheDo = (
          await g.query<{ tgenabled: string }>(
            "SELECT tgenabled FROM pg_trigger WHERE tgname = 'rfq_packages_kiem_chuyen_trang_thai' AND tgrelid = 'public.rfq_packages'::regclass",
          )
        ).rows[0]?.tgenabled;
        await g.query("ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
        await g.query(
          "UPDATE rfq_packages SET status = 'CLOSED', opened_at = now(), deadline_at = now() + interval '1 day', " +
            "closed_at = now(), early_close_reason = 'dong som de do', " +
            "closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
          [rfq.id, userId, sessionNguoi],
        );
        await g.query(
          `ALTER TABLE rfq_packages ENABLE ${cheDo === "A" ? "ALWAYS " : ""}TRIGGER rfq_packages_kiem_chuyen_trang_thai`,
        );
        unsealId =
          (
            await g.query<{ id: string }>(
              "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) " +
                "VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
              [orgA, rfq.id, userId, sessionNguoi],
            )
          ).rows[0]?.id ?? "";
        await g.query("COMMIT");
      } catch (e) {
        await g.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        g.release();
      }
      return {
        a,
        sessionAgent,
        tenNhaCungCap,
        duong: [
          { mau: "/me", that: "/me" },
          { mau: "/suppliers", that: "/suppliers" },
          { mau: "/suppliers/:supplierId", that: `/suppliers/${ncc.id}` },
          { mau: "/policy", that: "/policy" },
          { mau: "/rfqs/:rfqId", that: `/rfqs/${rfq.id}` },
          { mau: "/rfqs/:rfqId/items", that: `/rfqs/${rfq.id}/items` },
          { mau: "/unseal/:unsealRequestId", that: `/unseal/${unsealId}` },
        ],
      };
    }

    it("⒜ bảng đo phủ ĐÚNG tập route ĐỌC mà `agentGoiDuoc` cho qua — không thừa, không thiếu", () => {
      // Không có vế này, một route đọc thứ tám được mở cho agent mà bảng ⒝ không biết tới.
      const doc = ROUTES.filter((r) => r.audience === "BUYER" && !r.mutates && agentGoiDuoc(r))
        .map((r) => r.path)
        .sort();
      expect(doc).toEqual(
        ["/me", "/policy", "/rfqs/:rfqId", "/rfqs/:rfqId/items", "/suppliers", "/suppliers/:supplierId", "/unseal/:unsealRequestId"].sort(),
      );
    });

    it("⒜ mỗi route trong bảy: phiên agent ⇒ ĐÚNG MỘT hàng `AGENT_READ` mang mẫu route; phiên người ⇒ KHÔNG hàng nào", async () => {
      const canh = await dungCanh("agent-doc-ghi-so@vd.test");
      for (const d of canh.duong) {
        const truoc = await demAgentRead();
        const r = await goi("GET", d.that, { cookie: canh.a.cookie });
        expect(r.status, `${d.mau}: ${r.text}`).toBe(200);
        expect(await demAgentRead(), `${d.mau}: phiên agent phải để lại ĐÚNG MỘT hàng`).toBe(truoc + 1);
        const { rows } = await db.pool.query<{
          actor_type: string;
          resource_type: string;
          resource_id: string;
          payload: Record<string, unknown>;
        }>(
          `SELECT actor_type, resource_type, resource_id, payload FROM audit_events
            WHERE org_id = $1 AND action = 'AGENT_READ' ORDER BY seq DESC LIMIT 1`,
          [orgA],
        );
        const hang = rows[0];
        // MẪU route, không phải đường dẫn đã gọi (không id nào của người gọi đi vào sổ).
        expect(hang?.payload.routePath, d.mau).toBe(d.mau);
        expect(hang?.payload.method, d.mau).toBe("GET");
        expect(hang?.payload.status, d.mau).toBe(200);
        expect(hang?.resource_type).toBe("SESSION");
        expect(hang?.resource_id, "hàng sổ nêu PHIÊN agent đã đọc").toBe(canh.sessionAgent);
        // Không một byte của thân phản hồi: đúng bốn khoá đã khai.
        expect(Object.keys(hang?.payload ?? {}).sort()).toEqual(["method", "requestId", "routePath", "status"]);

        // ĐỐI CHỨNG: cùng route, phiên NGƯỜI ⇒ 200 và KHÔNG hàng nào — lần đọc của người vẫn không ghi sổ.
        const truocNguoi = await demAgentRead();
        const rn = await goi("GET", d.that, { cookie: canh.a.cookieNguoi });
        expect(rn.status, `${d.mau} (người): ${rn.text}`).toBe(200);
        expect(await demAgentRead(), `${d.mau}: phiên người KHÔNG được ghi hàng AGENT_READ`).toBe(truocNguoi);
      }
    });

    it("⒝ fail-closed: lần ghi sổ hỏng ⇒ 500 thân cố định, KHÔNG dữ liệu, KHÔNG hàng — không phải 200 kèm một sổ thiếu", async () => {
      const canh = await dungCanh("agent-doc-hong@vd.test");
      // Đối chứng dương: không giữ khoá thì cùng lời gọi ấy trả dữ liệu — nên 500 dưới đây là vì sổ.
      const binhThuong = await goi("GET", "/suppliers", { cookie: canh.a.cookie });
      expect(binhThuong.status).toBe(200);
      expect(binhThuong.text).toContain(canh.tenNhaCungCap);

      const truoc = await demAgentRead();
      const mocLog = logLoi.length;
      const giu = await apiPool.connect();
      let r: PhanHoi | undefined;
      try {
        await giu.query("BEGIN");
        await giu.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
        // Cùng khuôn vế ⑸: một hàng sổ chưa commit giữ khoá tư vấn nối tiếp của tổ chức.
        await giu.query(
          "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'K142_GIU_KHOA', 'K142', NULL, '{}'::jsonb, NULL, NULL, NULL)",
          [orgA],
        );
        r = await goi("GET", "/suppliers", { cookie: canh.a.cookie });
      } finally {
        await giu.query("ROLLBACK").catch(() => undefined);
        giu.release();
      }
      expect(r?.status, r?.text).toBe(500);
      expect(r?.text).toBe(JSON.stringify({ error: "loi noi bo" }));
      expect(r?.text).not.toContain(canh.tenNhaCungCap);
      expect(await demAgentRead(), "lần đọc không có hàng sổ thì cũng không có hàng nào khác").toBe(truoc);
      // MỘT dòng log, nêu MẪU route và lớp bọc — không id tổ chức, không tên nhà cung cấp.
      const dong = logLoi.slice(mocLog).filter((l) => l.includes("AgentReadAuditFailedError"));
      expect(dong, logLoi.slice(mocLog).join("\n")).toHaveLength(1);
      expect(dong[0]).toContain("GET /suppliers");
      expect(dong[0]).toContain("55P03");
      expect(dong[0]).not.toContain(orgA);
    });

    it("⒞ chuỗi sổ của tổ chức vẫn liền sau các lần đọc của agent — bộ kiểm chứng thật", async () => {
      const canh = await dungCanh("agent-doc-chuoi@vd.test");
      for (const d of canh.duong) expect((await goi("GET", d.that, { cookie: canh.a.cookie })).status).toBe(200);
      const kq = await withTenant(apiPool, orgA, (c) => verifyAuditChain(c, orgA, { externalAnchors: [] }));
      expect(kq.checked).toBeGreaterThan(0);
      // `NOT_ANCHORED` là của phép gọi không mốc neo ngoài, không phải của sổ.
      expect(kq.problems.filter((p) => p.kind !== "NOT_ANCHORED")).toEqual([]);
    });

    it("⒟ vượt trần theo phiên ⇒ 429 TRƯỚC handler và KHÔNG hàng sổ; phiên agent khác và phiên người vẫn đọc được", async () => {
      const TRAN = 3;
      const s2 = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services, tranDocAgent: TRAN }), {
        remoteAddressOf: taoDocDiaChi(["127.0.0.1"]),
      });
      await new Promise<void>((xong) => s2.listen(0, "127.0.0.1", xong));
      const goc2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
      try {
        const a = await phienAgent("agent-doc-tran@vd.test");
        const b = await phienAgent("agent-doc-tran-khac@vd.test");
        const truoc = await demAgentRead();
        for (let i = 0; i < TRAN; i += 1) {
          expect((await goi("GET", "/suppliers", { cookie: a.cookie, goc: goc2 })).status, `lần ${i + 1}`).toBe(200);
        }
        expect(await demAgentRead()).toBe(truoc + TRAN);
        for (let i = 0; i < 3; i += 1) {
          const r = await goi("GET", "/suppliers", { cookie: a.cookie, goc: goc2 });
          expect(r.status, `lần ${TRAN + i + 1}: ${r.text}`).toBe(429);
          expect(r.text).toBe(JSON.stringify({ error: "qua nhieu yeu cau" }));
          expect(r.headers.get("retry-after")).toBe(String(OTP_RATE_WINDOW_SECONDS));
        }
        expect(await demAgentRead(), "429 KHÔNG được ghi hàng sổ").toBe(truoc + TRAN);
        // Trần theo PHIÊN: một phiên agent khác và chính phiên người của `a` vẫn đi qua.
        expect((await goi("GET", "/suppliers", { cookie: b.cookie, goc: goc2 })).status).toBe(200);
        expect((await goi("GET", "/suppliers", { cookie: a.cookieNguoi, goc: goc2 })).status).toBe(200);
        expect(await demAgentRead()).toBe(truoc + TRAN + 1);
      } finally {
        await new Promise<void>((xong) => s2.close(() => xong()));
      }
    });
  });

  describe("[S1.155 / khoản 122 · 144] trần lần TỪ CHỐI theo phiên — 429 trước lần ghi sổ", () => {
    const TRAN = 3;
    const THAN_429 = JSON.stringify({ error: "qua nhieu yeu cau" });
    const NCC = { legalName: "NCC bi tu choi", taxCode: "0100000001" };

    async function demHanh(action: string): Promise<number> {
      const { rows } = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND action = $2", [orgA, action]);
      return Number(rows[0]?.n ?? "-1");
    }

    /** Một máy chủ riêng mang trần nhỏ; `lam` nhận gốc URL của nó. Cùng khuôn vế ⒟. */
    async function voiMayChu(lam: (goc2: string) => Promise<void>): Promise<void> {
      const s2 = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services, tranTuChoi: TRAN }), {
        remoteAddressOf: taoDocDiaChi(["127.0.0.1"]),
      });
      await new Promise<void>((xong) => s2.listen(0, "127.0.0.1", xong));
      try {
        await lam(`http://127.0.0.1:${(s2.address() as AddressInfo).port}`);
      } finally {
        await new Promise<void>((xong) => s2.close(() => xong()));
      }
    }

    it("⒠ [INV-D5] phiên NGƯỜI thiếu quyền: N lần 403 mỗi lần một hàng `PERMISSION_DENIED`, rồi 429 KHÔNG hàng; việc nó CÓ quyền vẫn đi qua; phiên khác không bị kéo theo", async () => {
      await voiMayChu(async (goc2) => {
        await taoNguoi("tu-choi-nguoi@vd.test");
        await taoNguoi("tu-choi-nguoi-khac@vd.test");
        const a = await dangNhap("tu-choi-nguoi@vd.test");
        const b = await dangNhap("tu-choi-nguoi-khac@vd.test");
        const truoc = await demHanh("PERMISSION_DENIED");
        // BUYER không có `supplier.manage` ⇒ POST /suppliers là một lần từ chối quyền (api.int.test.ts, INV-H17).
        for (let i = 0; i < TRAN; i += 1) {
          const r = await goi("POST", "/suppliers", { cookie: a.cookie, body: NCC, goc: goc2 });
          expect(r.status, `lần ${i + 1}: ${r.text}`).toBe(403);
        }
        expect(await demHanh("PERMISSION_DENIED"), "N lần đầu VẪN vào sổ").toBe(truoc + TRAN);
        for (let i = 0; i < 3; i += 1) {
          const r = await goi("POST", "/suppliers", { cookie: a.cookie, body: NCC, goc: goc2 });
          expect(r.status, `lần ${TRAN + i + 1}: ${r.text}`).toBe(429);
          expect(r.text).toBe(THAN_429);
          expect(r.headers.get("retry-after")).toBe(String(OTP_RATE_WINDOW_SECONDS));
        }
        expect(await demHanh("PERMISSION_DENIED"), "429 KHÔNG ghi hàng sổ — không chạm khoá chuỗi sổ").toBe(truoc + TRAN);
        // Trần đếm LẦN TỪ CHỐI, không khoá phiên: route mà phiên ấy CÓ quyền vẫn chạy.
        const tao = await goi("POST", "/rfqs", { cookie: a.cookie, body: { title: "van tao duoc sau tran tu choi" }, goc: goc2 });
        expect(tao.status, tao.text).toBe(201);
        // Trần theo PHIÊN: phiên khác vẫn nhận 403 và vẫn để lại hàng của mình.
        const rb = await goi("POST", "/suppliers", { cookie: b.cookie, body: NCC, goc: goc2 });
        expect(rb.status, rb.text).toBe(403);
        expect(await demHanh("PERMISSION_DENIED")).toBe(truoc + TRAN + 1);
      });
    });

    it("⒡ [INV-D5] phiên AGENT ngoài phạm vi: N lần 403 mỗi lần một hàng `AGENT_SCOPE_DENIED`, rồi 429 KHÔNG hàng; lần đọc trong phạm vi và phiên người của cùng người dùng không bị kéo theo", async () => {
      await voiMayChu(async (goc2) => {
        const a = await phienAgent("tu-choi-agent@vd.test");
        const truoc = await demHanh("AGENT_SCOPE_DENIED");
        for (let i = 0; i < TRAN; i += 1) {
          const r = await goi("GET", `/rfqs/${UUID_GIA}/comparison`, { cookie: a.cookie, goc: goc2 });
          expect(r.status, `lần ${i + 1}: ${r.text}`).toBe(403);
        }
        expect(await demHanh("AGENT_SCOPE_DENIED")).toBe(truoc + TRAN);
        for (let i = 0; i < 3; i += 1) {
          const r = await goi("GET", `/rfqs/${UUID_GIA}/comparison`, { cookie: a.cookie, goc: goc2 });
          expect(r.status, `lần ${TRAN + i + 1}: ${r.text}`).toBe(429);
          expect(r.text).toBe(THAN_429);
        }
        expect(await demHanh("AGENT_SCOPE_DENIED"), "429 KHÔNG ghi hàng sổ").toBe(truoc + TRAN);
        expect((await goi("GET", "/suppliers", { cookie: a.cookie, goc: goc2 })).status, "lần đọc trong phạm vi là bucket khác").toBe(200);
        expect((await goi("POST", "/suppliers", { cookie: a.cookieNguoi, body: NCC, goc: goc2 })).status, "phiên người là phiên khác").toBe(403);
      });
    });

    it("⒢ [INV-D5] tám lần từ chối CÙNG LÚC của một phiên ⇒ đúng N lần 403 và đúng N hàng sổ — trần là của câu đếm, không của một phép đọc trước", async () => {
      await voiMayChu(async (goc2) => {
        await taoNguoi("tu-choi-cung-luc@vd.test");
        const a = await dangNhap("tu-choi-cung-luc@vd.test");
        const truoc = await demHanh("PERMISSION_DENIED");
        const kq = await Promise.all(Array.from({ length: 8 }, () => goi("POST", "/suppliers", { cookie: a.cookie, body: NCC, goc: goc2 })));
        expect(kq.map((r) => r.status).sort(), kq.map((r) => r.text).join("\n")).toEqual([403, 403, 403, 429, 429, 429, 429, 429]);
        expect(await demHanh("PERMISSION_DENIED")).toBe(truoc + TRAN);
      });
    });

    it("⒣ lần ghi sổ từ chối HỎNG (khoá chuỗi sổ bị giữ) vẫn tiêu ngân sách: 500 như trước, và lần đếm của nó KHÔNG cuộn theo", async () => {
      await voiMayChu(async (goc2) => {
        await taoNguoi("tu-choi-so-hong@vd.test");
        const a = await dangNhap("tu-choi-so-hong@vd.test");
        const truoc = await demHanh("PERMISSION_DENIED");
        const giu = await apiPool.connect();
        const ketQua: PhanHoi[] = [];
        try {
          await giu.query("BEGIN");
          await giu.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
          // Cùng khuôn ⒝: một hàng sổ chưa commit giữ khoá tư vấn nối tiếp của tổ chức ⇒ lần ghi từ chối không vào được sổ.
          await giu.query(
            "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'K122_GIU_KHOA', 'K122', NULL, '{}'::jsonb, NULL, NULL, NULL)",
            [orgA],
          );
          for (let i = 0; i < TRAN; i += 1) ketQua.push(await goi("POST", "/suppliers", { cookie: a.cookie, body: NCC, goc: goc2 }));
        } finally {
          await giu.query("ROLLBACK").catch(() => undefined);
          giu.release();
        }
        for (const r of ketQua) {
          expect(r.status, r.text).toBe(500);
          expect(r.text).toBe(JSON.stringify({ error: "loi noi bo" }));
        }
        expect(await demHanh("PERMISSION_DENIED"), "lần ghi hỏng không để hàng nào").toBe(truoc);
        // Khoá đã nhả. Nếu lần đếm cuộn theo lần ghi hỏng thì lời gọi này là lần ĐẦU và ra 403 kèm một hàng — đo: đúng thế khi gỡ
        // nhánh `DenialAuditFailedError`/`PermissionAuditFailedError` của `phanQuyetTuChoi`.
        const r = await goi("POST", "/suppliers", { cookie: a.cookie, body: NCC, goc: goc2 });
        expect(r.status, r.text).toBe(429);
        expect(await demHanh("PERMISSION_DENIED")).toBe(truoc);
      });
    }, 30_000);

    // ============================================================================================
    // [S1.184 / khoản 248 / ADR-112] LẦN TỪ CHỐI DO HANDLER CŨNG TIÊU CÙNG NGÂN SÁCH
    //
    // ADR-092 để ngoài phạm vi mọi lần từ chối mà HANDLER tự ghi — `requirePermission` gọi từ gói, `throwAuditedDenial` của cổng mở
    // thầu, bảng so sánh, và (khoản 247) mọi `CONTROL_DENIED`. Bảng so sánh có đủ hai lối: người không giữ `bid.view` bị
    // `buildComparisonTable` từ chối QUYỀN (403, `PERMISSION_DENIED`); người giữ nó mà gói chưa mở thầu bị từ chối A4 (422,
    // `COMPARISON_DENIED`). Route ấy là route ĐỌC nên bộ điều phối không hỏi quyền — cả hai lần từ chối là của handler.
    // ============================================================================================
    async function goiRfq(cookie: string, goc2: string): Promise<string> {
      const tao = await goi("POST", "/rfqs", { cookie, body: { title: "k248 bang so sanh" }, goc: goc2 });
      expect(tao.status, tao.text).toBe(201);
      return (JSON.parse(tao.text) as { rfq: { id: string } }).rfq.id;
    }

    it("⒤ [INV-D5] [khoản 248] lần từ chối QUYỀN do HANDLER tự hỏi: N lần 403 mỗi lần một hàng `PERMISSION_DENIED`, rồi 429 KHÔNG hàng", async () => {
      await voiMayChu(async (goc2) => {
        await taoNguoi("k248-quyen@vd.test");
        const a = await dangNhap("k248-quyen@vd.test");
        const rfqId = await goiRfq(a.cookie, goc2);
        const truoc = await demHanh("PERMISSION_DENIED");
        for (let i = 0; i < TRAN; i += 1) {
          const r = await goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 });
          expect(r.status, `lần ${i + 1}: ${r.text}`).toBe(403);
        }
        expect(await demHanh("PERMISSION_DENIED"), "N lần đầu VẪN vào sổ").toBe(truoc + TRAN);
        for (let i = 0; i < 3; i += 1) {
          const r = await goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 });
          expect(r.status, `lần ${TRAN + i + 1}: ${r.text}`).toBe(429);
          expect(r.text).toBe(THAN_429);
          expect(r.headers.get("retry-after")).toBe(String(OTP_RATE_WINDOW_SECONDS));
        }
        expect(await demHanh("PERMISSION_DENIED"), "429 KHÔNG ghi hàng sổ").toBe(truoc + TRAN);
      });
    });

    it("⒥ [INV-D5] [khoản 248] lần từ chối qua `throwAuditedDenial` của HANDLER (A4 của bảng so sánh): N lần 422 mỗi lần một hàng, rồi 429 KHÔNG hàng", async () => {
      await voiMayChu(async (goc2) => {
        // Người giữ `bid.view` là FINANCE THUẦN: BUYER kèm FINANCE vi phạm D2 của trigger `033`. Gói do một người mua khác tạo.
        await taoNguoi("k248-a4-tao@vd.test");
        const rfqId = await goiRfq((await dangNhap("k248-a4-tao@vd.test")).cookie, goc2);
        const { rows: nd } = await db.pool.query<{ id: string }>(
          "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, 'k248-a4@vd.test', 'Ke toan', 'ACTIVE') RETURNING id",
          [orgA],
        );
        await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'FINANCE')", [orgA, nd[0]?.id]);
        const a = await dangNhap("k248-a4@vd.test");
        const truoc = await demHanh("COMPARISON_DENIED");
        for (let i = 0; i < TRAN; i += 1) {
          const r = await goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 });
          expect(r.status, `lần ${i + 1}: ${r.text}`).toBe(422);
        }
        expect(await demHanh("COMPARISON_DENIED"), "N lần đầu VẪN vào sổ").toBe(truoc + TRAN);
        for (let i = 0; i < 3; i += 1) {
          const r = await goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 });
          expect(r.status, `lần ${TRAN + i + 1}: ${r.text}`).toBe(429);
          expect(r.text).toBe(THAN_429);
        }
        expect(await demHanh("COMPARISON_DENIED"), "429 KHÔNG ghi hàng sổ").toBe(truoc + TRAN);
      });
    });

    it("⒦ [khoản 248] MỘT ngân sách cho cả hai tầng: lần từ chối của bộ điều phối và của handler cùng tiêu bucket `tu-choi|<phiên>`", async () => {
      await voiMayChu(async (goc2) => {
        await taoNguoi("k248-chung@vd.test");
        const a = await dangNhap("k248-chung@vd.test");
        const rfqId = await goiRfq(a.cookie, goc2);
        const truoc = await demHanh("PERMISSION_DENIED");
        // Hai lần ở bộ điều phối (POST /suppliers), một lần ở handler (bảng so sánh) — đủ TRAN = 3.
        expect((await goi("POST", "/suppliers", { cookie: a.cookie, body: NCC, goc: goc2 })).status).toBe(403);
        expect((await goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 })).status).toBe(403);
        expect((await goi("POST", "/suppliers", { cookie: a.cookie, body: NCC, goc: goc2 })).status).toBe(403);
        expect(await demHanh("PERMISSION_DENIED")).toBe(truoc + TRAN);
        // Hết ngân sách ở CẢ HAI tầng.
        expect((await goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 })).status).toBe(429);
        expect((await goi("POST", "/suppliers", { cookie: a.cookie, body: NCC, goc: goc2 })).status).toBe(429);
        expect(await demHanh("PERMISSION_DENIED")).toBe(truoc + TRAN);
      });
    });

    it("⒧ [INV-D5] [khoản 248] tám lần từ chối CÙNG LÚC ở handler ⇒ đúng N lần 403 và đúng N hàng sổ", async () => {
      await voiMayChu(async (goc2) => {
        await taoNguoi("k248-cung-luc@vd.test");
        const a = await dangNhap("k248-cung-luc@vd.test");
        const rfqId = await goiRfq(a.cookie, goc2);
        const truoc = await demHanh("PERMISSION_DENIED");
        const kq = await Promise.all(Array.from({ length: 8 }, () => goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 })));
        expect(kq.map((r) => r.status).sort(), kq.map((r) => r.text).join("\n")).toEqual([403, 403, 403, 429, 429, 429, 429, 429]);
        expect(await demHanh("PERMISSION_DENIED")).toBe(truoc + TRAN);
      });
    });

    it("⒨ [khoản 248] lần ghi sổ từ chối của HANDLER hỏng (khoá chuỗi sổ bị giữ) vẫn tiêu ngân sách: 500, và lần đếm KHÔNG cuộn theo", async () => {
      await voiMayChu(async (goc2) => {
        await taoNguoi("k248-so-hong@vd.test");
        const a = await dangNhap("k248-so-hong@vd.test");
        const rfqId = await goiRfq(a.cookie, goc2);
        const truoc = await demHanh("PERMISSION_DENIED");
        const giu = await apiPool.connect();
        const ketQua: PhanHoi[] = [];
        try {
          await giu.query("BEGIN");
          await giu.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
          // Cùng khuôn ⒣: một hàng sổ chưa commit giữ khoá tư vấn nối tiếp của tổ chức.
          await giu.query(
            "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'K248_GIU_KHOA', 'K248', NULL, '{}'::jsonb, NULL, NULL, NULL)",
            [orgA],
          );
          for (let i = 0; i < TRAN; i += 1) ketQua.push(await goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 }));
        } finally {
          await giu.query("ROLLBACK").catch(() => undefined);
          giu.release();
        }
        for (const r of ketQua) {
          expect(r.status, r.text).toBe(500);
          expect(r.text).toBe(JSON.stringify({ error: "loi noi bo" }));
        }
        expect(await demHanh("PERMISSION_DENIED"), "lần ghi hỏng không để hàng nào").toBe(truoc);
        // Lần đếm ở giao dịch RIÊNG đã commit trước lần ghi hỏng — nên đây là lần thứ N+1, không phải lần đầu.
        const r = await goi("GET", `/rfqs/${rfqId}/comparison`, { cookie: a.cookie, goc: goc2 });
        expect(r.status, r.text).toBe(429);
        expect(await demHanh("PERMISSION_DENIED")).toBe(truoc);
      });
    }, 30_000);
  });
});

// ==============================================================================================
// [S1.175 / khoản 145] KHOÁ GHI SỔ BỊ GIỮ LÚC PHÁT CHỨNG CHỈ AGENT ⇒ KHÔNG PHÁT, 503 CÓ TÊN
//
// `startAgentSession` ghi `AGENT_SESSION_ISSUED` trong cùng giao dịch với hàng phiên và lần tiêu thụ mã TOTP. Khoá tư vấn ghi sổ của tổ
// chức bị giữ quá trần 2 s (050) thì lần ghi gãy 55P03. Trước vòng này lỗi ném ra thành 500 thân cố định — không ai biết vì sao, và
// không dòng log nào nói. Chủ dự án chọn: một chứng chỉ phát ra mà sổ không ghi thì KHÔNG được phát (khác khoản 139). Vế đo: 503 có
// tên, không hàng phiên AGENT nào, không hàng sổ nào, một dòng log cố định; mã TOTP đã tiêu thụ không dùng lại được. Đường phát bình
// thường có đo riêng ở khối khoản 141 (`phienAgent`).
// ==============================================================================================
describe("[S1.175 / khoản 145] sổ không nhận lần phát chứng chỉ agent thì chứng chỉ không được phát", () => {
  it("khoá ghi sổ bị giữ ⇒ 503 có tên, không phiên AGENT, không hàng sổ, một dòng log; mã đã tiêu thụ không phát lại được", async () => {
    await taoNguoi("k145-agent@vd.test");
    const nguoi = await dangNhap("k145-agent@vd.test");
    const dem = async (): Promise<{ phien: number; so: number }> => {
      const p = await db.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.org_id = $1 AND s.kind = 'AGENT_READONLY' AND u.email = $2",
        [orgA, "k145-agent@vd.test"],
      );
      const so = await db.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM audit_events a JOIN users u ON u.id = a.actor_id WHERE a.org_id = $1 AND a.action = 'AGENT_SESSION_ISSUED' AND u.email = $2",
        [orgA, "k145-agent@vd.test"],
      );
      return { phien: p.rows[0]!.n, so: so.rows[0]!.n };
    };
    const truoc = await dem();
    const buoc = counterForTime(Date.now());
    const maMot = deriveTotpCode(nguoi.biMat, buoc + 1);

    const giu = await apiPool.connect();
    const mocLog = logLoi.length;
    let r: PhanHoi | undefined;
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      await giu.query(
        "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'K145_GIU_KHOA', 'K145', NULL, '{}'::jsonb, NULL, NULL, NULL)",
        [orgA],
      );
      r = await goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: maMot } });
    } finally {
      await giu.query("ROLLBACK").catch(() => undefined);
      giu.release();
    }
    const sauGiu = await dem();
    const dong = logLoi.slice(mocLog).filter((d) => d.includes("khoan 145"));
    const ke = `status: ${String(r?.status)} ${r?.text ?? ""}; phiên/sổ trước ${JSON.stringify(truoc)} sau ${JSON.stringify(sauGiu)}; log: ${dong.length}`;

    expect(r?.status, `sổ không nhận thì phải 503 có tên, không 500 — ${ke}`).toBe(503);
    expect(sauGiu, `không chứng chỉ nào được phát, không hàng sổ nào — ${ke}`).toEqual(truoc);
    expect(dong.length, `đúng một dòng log cố định — ${ke}`).toBe(1);
    expect(dong[0], "dòng log không nội suy giá trị").not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u);

    // Mã đã tiêu thụ trong lần 503 KHÔNG dùng lại được — giao dịch đã commit lần tiêu thụ ấy.
    const lai = await goi("POST", "/auth/agent-session", { cookie: nguoi.cookie, body: { code: maMot } });
    expect(lai.status, `mã đã tiêu thụ không phát lại được — ${lai.text}`).toBe(401);
    expect(await dem(), "lần thử lại bị từ chối cũng không phát gì").toEqual(truoc);
  }, 60_000);
});

// ==============================================================================================
// [S1.216 / khoản 195 / ADR-126] NGƯỜI ĐÃ ĐĂNG NHẬP TỰ XEM LINK ĐĂNG NHẬP GẦN ĐÂY CỦA CHÍNH MÌNH
//
// `LoginTokenError` gộp ba trạng thái — không hợp lệ, hết hạn, đã dùng — làm MỘT câu ở route vô danh, và
// đó là chống dò tìm có lý: vòng này KHÔNG nới câu ấy. Nhưng vế "đã dùng" đáng lẽ dẫn tới *báo ngay, có
// kẻ đã dùng link của tôi*, và tới trước vòng này phải mở cơ sở dữ liệu mới biết. Nay `GET /auth/login-links`
// trả cho CHÍNH người gọi (userId dẫn xuất từ cookie, không từ thân) các link gần đây của họ: tạo lúc, hết
// hạn, dùng lúc, mục đích, và trạng thái suy ở CSDL bằng cùng đồng hồ với `redeemLoginToken`
// (`clock_timestamp()`). KHÔNG BAO GIỜ `token_hash` — băm của một token còn hiệu lực là thứ đối chiếu được
// với một token bị rò. Ba vế: ⑴ chủ nhân thấy ba trạng thái ra ba kết quả, thân không mang băm hay một chuỗi
// bí mật nào; ⑵ người khác cùng tổ chức chỉ thấy của mình; ⑶ không cookie ⇒ 401, chứng chỉ agent ⇒ 403 kèm
// một hàng `AGENT_SCOPE_DENIED` nêu mẫu route (`agent: false` là một quyết định — `routes.test.ts` ghim).
// Đo trước trên mã trước vòng này: đường không tồn tại ⇒ 404 ở cả ba vế.
// ==============================================================================================
describe("[INV-E1] [S1.216 / khoản 195] GET /auth/login-links — link đăng nhập gần đây của chính người gọi", () => {
  interface LinkGanDay {
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly consumedAt: string | null;
    readonly purpose: string;
    readonly status: string;
  }

  /** Phát thêm một mã cho chính chủ, như handler tin báo hay `/auth/link` làm — dạng rõ bị bỏ, chỉ hàng băm ở lại. */
  async function phatThem(email: string): Promise<void> {
    const kq = await withTenant(apiPool, orgA, (c) => issueLoginToken(c, orgA, { email }));
    expect(kq.ok, "phát thêm một mã cho chính chủ").toBe(true);
  }

  function docThan(r: PhanHoi): readonly LinkGanDay[] {
    const b = r.body as { loginLinks?: readonly LinkGanDay[] } | undefined;
    expect(Array.isArray(b?.loginLinks), r.text).toBe(true);
    return b?.loginLinks ?? [];
  }

  it("⑴ chủ nhân thấy ba trạng thái — đã dùng, hết hạn, còn hiệu lực — mỗi link một hàng, mới nhất trước; KHÔNG `token_hash`, không một chuỗi bí mật nào trong thân", async () => {
    const email = "k195-chu@vd.test";
    await taoNguoi(email);
    const chu = await dangNhap(email); // ⇒ mã ĐÃ DÙNG (startUserSession tiêu thụ nó)
    await phatThem(email); // ⇒ mã CÒN HIỆU LỰC
    await phatThem(email); // ⇒ mã sẽ bị đẩy về quá khứ ⇒ HẾT HẠN
    // `app_api` không có `UPDATE (expires_at)` (029) — đúng thiết kế —, nên đẩy về quá khứ bằng pool superuser của test-support.
    // Đẩy cả `created_at` để hàng ấy là hàng CŨ NHẤT: vế thứ tự đo được.
    const day = await db.pool.query(
      `UPDATE user_login_tokens SET created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
        WHERE id = (SELECT t.id FROM user_login_tokens t JOIN users u ON u.id = t.user_id
                     WHERE u.org_id = $1 AND u.email = $2 AND t.consumed_at IS NULL ORDER BY t.created_at DESC LIMIT 1)`,
      [orgA, email],
    );
    expect(day.rowCount).toBe(1);

    const r = await goi("GET", "/auth/login-links", { cookie: chu.cookie });
    expect(r.status, r.text).toBe(200);
    const ds = docThan(r);
    expect(ds.map((l) => l.status), "mới nhất trước: còn hiệu lực (vừa phát), đã dùng (lúc đăng nhập), hết hạn (đẩy về 20 phút trước)").toEqual([
      "PENDING",
      "CONSUMED",
      "EXPIRED",
    ]);
    for (const l of ds) {
      expect(Object.keys(l).sort(), "đúng năm trường, không hơn").toEqual(["consumedAt", "createdAt", "expiresAt", "purpose", "status"]);
      expect(l.purpose).toBe("LOGIN");
      expect(Number.isNaN(Date.parse(l.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(l.expiresAt))).toBe(false);
    }
    const [conHan, daDung, hetHan] = ds;
    expect(conHan?.consumedAt).toBeNull();
    expect(Date.parse(conHan?.expiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(typeof daDung?.consumedAt).toBe("string");
    expect(hetHan?.consumedAt).toBeNull();
    expect(Date.parse(hetHan?.expiresAt ?? "")).toBeLessThan(Date.now());
    expect(Date.parse(ds[0]?.createdAt ?? "")).toBeGreaterThanOrEqual(Date.parse(ds[1]?.createdAt ?? ""));
    expect(Date.parse(ds[1]?.createdAt ?? "")).toBeGreaterThanOrEqual(Date.parse(ds[2]?.createdAt ?? ""));
    // Không băm, không token: thân không có chữ "hash", không mang token dạng rõ đã dùng, không mang băm hex/base64 của nó,
    // và không một chuỗi base64url dài nào — hình dạng của mọi token kho này phát.
    expect(r.text).not.toMatch(/hash/iu);
    expect(r.text).not.toContain(chu.token);
    const bamToken = createHash("sha256").update(chu.token, "utf8").digest();
    expect(r.text).not.toContain(bamToken.toString("hex"));
    expect(r.text).not.toContain(bamToken.toString("base64"));
    expect(r.text).not.toMatch(/[A-Za-z0-9_-]{32,}/u);
  });

  it("⑵ người khác CÙNG tổ chức chỉ thấy link của mình — không hàng nào của chủ nhân ở vế ⑴", async () => {
    const email = "k195-nguoi-khac@vd.test";
    await taoNguoi(email);
    const khac = await dangNhap(email);
    const r = await goi("GET", "/auth/login-links", { cookie: khac.cookie });
    expect(r.status, r.text).toBe(200);
    const ds = docThan(r);
    expect(ds.map((l) => l.status)).toEqual(["CONSUMED"]);
    // Đối chứng, đọc thẳng CSDL bằng pool superuser: chủ nhân của vế ⑴ vẫn có ba hàng — tức ba hàng ấy có thật, cùng tổ chức,
    // và người này không thấy chúng; hàng duy nhất người này thấy là hàng của CHÍNH họ (cùng mốc tạo).
    const cuaChu = await db.pool.query<{ created_at: Date }>(
      "SELECT t.created_at FROM user_login_tokens t JOIN users u ON u.id = t.user_id WHERE u.org_id = $1 AND u.email = $2",
      [orgA, "k195-chu@vd.test"],
    );
    expect(cuaChu.rows.length).toBeGreaterThanOrEqual(3);
    const mocCuaChu = new Set(cuaChu.rows.map((h) => h.created_at.toISOString()));
    for (const l of ds) expect(mocCuaChu.has(new Date(l.createdAt).toISOString()), "một hàng của chủ nhân lọt sang người khác").toBe(false);
    const cuaKhac = await db.pool.query<{ created_at: Date }>(
      "SELECT t.created_at FROM user_login_tokens t JOIN users u ON u.id = t.user_id WHERE u.org_id = $1 AND u.email = $2",
      [orgA, email],
    );
    expect(cuaKhac.rows.map((h) => h.created_at.toISOString())).toEqual(ds.map((l) => new Date(l.createdAt).toISOString()));
  });

  it("⑶ không cookie ⇒ 401 không thân dữ liệu; chứng chỉ agent ⇒ 403 và ĐÚNG MỘT hàng `AGENT_SCOPE_DENIED` nêu mẫu route", async () => {
    const khong = await goi("GET", "/auth/login-links");
    expect(khong.status, khong.text).toBe(401);
    expect(khong.text).not.toContain("loginLinks");

    const email = "k195-agent@vd.test";
    await taoNguoi(email);
    const nguoi = await dangNhap(email);
    const phat = await goi("POST", "/auth/agent-session", {
      cookie: nguoi.cookie,
      body: { code: deriveTotpCode(nguoi.biMat, counterForTime(Date.now()) + 1) },
    });
    expect(phat.status, phat.text).toBe(200);
    const agent = `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${(phat.body as { token: string }).token}`;
    const truoc = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND action = 'AGENT_SCOPE_DENIED'",
      [orgA],
    );
    const r = await goi("GET", "/auth/login-links", { cookie: agent });
    expect(r.status, r.text).toBe(403);
    expect(r.text).not.toContain("loginLinks");
    const sau = await db.pool.query<{ n: string; payload: { routePath?: string } | null }>(
      `SELECT count(*) OVER () AS n, payload FROM audit_events
        WHERE org_id = $1 AND action = 'AGENT_SCOPE_DENIED' ORDER BY seq DESC LIMIT 1`,
      [orgA],
    );
    expect(Number(sau.rows[0]?.n ?? 0)).toBe(Number(truoc.rows[0]?.n ?? 0) + 1);
    expect(sau.rows[0]?.payload?.routePath).toBe("/auth/login-links");
    // Đối chứng: cùng đường dưới phiên NGƯỜI của chính người ấy thì mở.
    const mo = await goi("GET", "/auth/login-links", { cookie: nguoi.cookie });
    expect(mo.status, mo.text).toBe(200);
  });
});

// ==============================================================================================
// [S1.240 / khoản 268 / ADR-126] DANH SÁCH LINK ĐĂNG NHẬP GẦN ĐÂY CẮT THEO THỜI GIAN, VÀ NÓI KHI NÓ BỊ CẮT
//
// Tới trước vòng này `listRecentLoginTokens` trả `LIMIT 20` mới nhất trước: trần phát là 5 mã tự phục vụ + 2 mã hệ thống mỗi 15 phút
// (tối đa 7 hàng / 15 phút), nên 20 hàng phủ chừng 43 phút ở nhịp dày nhất — một link «đã dùng» cũ hơn thế rơi khỏi danh sách, và
// thân không nói mình cắt. Chủ dự án chốt câu 6 (2026-09-30): cắt theo THỜI GIAN 7 ngày (dài hơn mọi TTL và mọi cửa sổ phát), trần
// cứng 100 hàng, thân thêm `truncated: boolean` — đúng khi còn hàng TRONG cửa sổ mà trần cắt đi. Mã chèn thẳng bằng pool superuser:
// `app_api` không có `UPDATE (created_at)` (029), và trần phát 5 mã / 15 phút không cho dựng 101 mã qua đường thật trong một test.
//   ① 25 mã trong cửa sổ, mã «đã dùng» là mã CŨ NHẤT ⇒ vẫn thấy — đủ 25 hàng — và `truncated: false`;
//   ② 101 mã trong cửa sổ ⇒ đúng 100 hàng — 100 mã mới nhất, mới nhất trước — và `truncated: true`;
//   ③ ĐÚNG 100 mã trong cửa sổ (một mã sát mép, 6 ngày 23 giờ trước) cộng hai mã NGOÀI cửa sổ (7 ngày 1 giờ — đã dùng — và 30 ngày)
//      ⇒ đủ 100 hàng, không mã ngoài cửa sổ nào, và `truncated: false`: mã cũ hơn 7 ngày không làm cờ đúng.
// Đo trước trên cây trước vòng này: ba vế đỏ — 20 hàng thay vì 25/100, thân không có `truncated`.
// ==============================================================================================
describe("[S1.240 / khoản 268] GET /auth/login-links — cửa sổ 7 ngày, trần 100 hàng, `truncated`", () => {
  interface ThanLink {
    readonly loginLinks?: readonly { readonly createdAt: string; readonly consumedAt: string | null; readonly status: string }[];
    readonly truncated?: unknown;
  }

  /** Chèn `soMa` mã chưa dùng cho chủ nhân `email`: mã thứ g tạo `g` phút trước lúc này, hết hạn 15 phút sau khi tạo. */
  async function chenMa(email: string, soMa: number): Promise<void> {
    const r = await db.pool.query(
      `INSERT INTO user_login_tokens (org_id, user_id, token_hash, purpose, expires_at, created_at)
       SELECT u.org_id, u.id, sha256(convert_to('k268-' || u.id::text || '-' || g::text, 'UTF8')), 'LOGIN',
              now() - make_interval(mins => g) + interval '15 minutes', now() - make_interval(mins => g)
         FROM users u, generate_series(1, $2::int) g
        WHERE u.org_id = $1 AND u.email = $3`,
      [orgA, soMa, email],
    );
    expect(r.rowCount).toBe(soMa);
  }

  /** Chèn MỘT mã tạo `truoc` (một interval) trước lúc này; `daDung` ⇒ dùng 3 phút sau khi tạo. */
  async function chenMaLuc(email: string, truoc: string, daDung: boolean): Promise<void> {
    const r = await db.pool.query(
      `INSERT INTO user_login_tokens (org_id, user_id, token_hash, purpose, expires_at, created_at, consumed_at)
       SELECT u.org_id, u.id, sha256(convert_to('k268-luc-' || u.id::text || '-' || $3::text, 'UTF8')), 'LOGIN',
              now() - $3::interval + interval '15 minutes', now() - $3::interval,
              CASE WHEN $4::boolean THEN now() - $3::interval + interval '3 minutes' END
         FROM users u
        WHERE u.org_id = $1 AND u.email = $2`,
      [orgA, email, truoc, daDung],
    );
    expect(r.rowCount).toBe(1);
  }

  async function docLink(cookie: string): Promise<ThanLink> {
    const r = await goi("GET", "/auth/login-links", { cookie });
    expect(r.status, r.text).toBe(200);
    return r.body as ThanLink;
  }

  it("① 25 mã trong cửa sổ, mã «đã dùng» là mã CŨ NHẤT (2 ngày trước) ⇒ vẫn thấy — đủ 25 hàng, hàng cuối là nó — và `truncated: false`", async () => {
    const email = "k268-mot@vd.test";
    await taoNguoi(email);
    const chu = await dangNhap(email); // ⇒ một mã ĐÃ DÙNG, tạo lúc này
    // Mã đã dùng lùi về 2 ngày trước — tạo, hết hạn, dùng cùng dịch —, nên nó thành mã CŨ NHẤT của chủ nhân.
    const lui = await db.pool.query(
      `UPDATE user_login_tokens t
          SET created_at = t.created_at - interval '2 days', expires_at = t.expires_at - interval '2 days',
              consumed_at = t.consumed_at - interval '2 days'
         FROM users u
        WHERE u.id = t.user_id AND u.org_id = $1 AND u.email = $2 AND t.consumed_at IS NOT NULL`,
      [orgA, email],
    );
    expect(lui.rowCount).toBe(1);
    await chenMa(email, 24); // 24 mã mới hơn, trong 24 phút gần nhất ⇒ 25 mã trong cửa sổ
    const b = await docLink(chu.cookie);
    const ds = b.loginLinks ?? [];
    expect(ds.length, "25 mã trong cửa sổ ⇒ 25 hàng").toBe(25);
    expect(ds.at(-1)?.status, "mã «đã dùng» — cũ nhất — phải còn thấy").toBe("CONSUMED");
    expect(ds.filter((l) => l.status === "CONSUMED")).toHaveLength(1);
    expect(b.truncated).toBe(false);
  });

  it("② 101 mã trong cửa sổ ⇒ ĐÚNG 100 hàng — 100 mã mới nhất, mới nhất trước — và `truncated: true`", async () => {
    const email = "k268-hai@vd.test";
    await taoNguoi(email);
    const chu = await dangNhap(email); // ⇒ một mã đã dùng, lúc này
    await chenMa(email, 100); // 100 mã trong 100 phút gần nhất ⇒ 101 mã trong cửa sổ
    const b = await docLink(chu.cookie);
    const ds = b.loginLinks ?? [];
    expect(ds.length, "trần cứng 100 hàng").toBe(100);
    expect(b.truncated, "còn hàng TRONG cửa sổ mà trần cắt đi").toBe(true);
    // Đối chứng bằng CSDL: 100 hàng trả về là ĐÚNG 100 mã mới nhất của chủ nhân, cùng thứ tự; mã cũ nhất là mã bị cắt.
    const tat = await db.pool.query<{ created_at: Date }>(
      `SELECT t.created_at FROM user_login_tokens t JOIN users u ON u.id = t.user_id
        WHERE u.org_id = $1 AND u.email = $2 ORDER BY t.created_at DESC, t.id DESC`,
      [orgA, email],
    );
    expect(tat.rows).toHaveLength(101);
    expect(ds.map((l) => new Date(l.createdAt).toISOString())).toEqual(tat.rows.slice(0, 100).map((h) => h.created_at.toISOString()));
  });

  it("③ ĐÚNG 100 mã trong cửa sổ cộng hai mã NGOÀI cửa sổ (7 ngày 1 giờ — đã dùng —, 30 ngày) ⇒ 100 hàng, không mã ngoài cửa sổ nào, `truncated: false`", async () => {
    const email = "k268-ba@vd.test";
    await taoNguoi(email);
    const chu = await dangNhap(email); // ⇒ một mã đã dùng, lúc này
    await chenMa(email, 98); // 98 mã trong 98 phút gần nhất
    await chenMaLuc(email, "6 days 23 hours", false); // trong cửa sổ, sát mép ⇒ đúng 100 mã trong cửa sổ
    await chenMaLuc(email, "7 days 1 hour", true); // ngoài cửa sổ — và đã dùng
    await chenMaLuc(email, "30 days", false); // ngoài cửa sổ
    const b = await docLink(chu.cookie);
    const ds = b.loginLinks ?? [];
    expect(ds.length, "100 mã trong cửa sổ ⇒ 100 hàng").toBe(100);
    expect(b.truncated, "mã cũ hơn 7 ngày không được làm cờ «còn nữa» đúng").toBe(false);
    const bayNgayTruoc = Date.now() - 7 * 24 * 3600 * 1000;
    for (const l of ds) expect(Date.parse(l.createdAt), "một mã ngoài cửa sổ 7 ngày lọt vào danh sách").toBeGreaterThan(bayNgayTruoc);
    expect(Date.parse(ds.at(-1)?.createdAt ?? ""), "mã sát mép (6 ngày 23 giờ) vẫn trong cửa sổ, và là hàng cuối").toBeLessThan(Date.now() - 6 * 24 * 3600 * 1000);
    expect(ds.filter((l) => l.status === "CONSUMED"), "chỉ mã dùng lúc đăng nhập — mã dùng 7 ngày 1 giờ trước nằm ngoài cửa sổ").toHaveLength(1);
  });
});

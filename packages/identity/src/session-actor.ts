import { createHash } from "node:crypto";
import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";

// =============================================================================================
// ADR-016 — DANH TÍNH ĐÃ XÁC THỰC LÀ DẪN XUẤT, KHÔNG PHẢI LỜI KHAI
//
// Hàm này nằm ở `identity` chứ không ở `audit` vì `sessions` là bảng của 006, tức của lát cắt
// định danh. Nó nằm ở MỘT gói chứ không ba vì ba bản sao của cùng một câu SQL là đúng thứ dự án
// đã dựng một meta-test để chặn (`tax-code.test.ts` canh hai bản sao của luật MST, và
// `db/rls-coverage.int.test.ts` canh `HINH_DANG_CHUAN` với hardening.always.sql).
//
// ---------------------------------------------------------------------------------------------
// VÌ SAO NÓ ĐƯỢC Ở TRONG BARREL, TRONG KHI `hasPermission` THÌ KHÔNG
// ---------------------------------------------------------------------------------------------
// Tiêu chí đã được chính `packages/identity/src/index.ts` viết ra khi rút `hasPermission`:
// `assertFreshMfa` ở lại vì nó NÉM khi không thoả (fail-closed) chứ không trả boolean, "nên nó
// không dựng ra được một cổng gác im lặng". Hàm này cùng hình dạng: nó trả về một danh tính hoặc
// NÉM. Không có nhánh nào trả `null`/`false` để một người gọi vô tình nuốt.
//
// ---------------------------------------------------------------------------------------------
// PHÁT BIỂU ĐÚNG MỨC — BA THỨ HÀM NÀY KHÔNG LÀM
// ---------------------------------------------------------------------------------------------
// (1) Nó KHÔNG phải một cổng quyền. ADR-016 mục 1 đặt `requirePermission` ở TẦNG ỨNG DỤNG. Hàm
//     này chỉ trả lời "phiên này thuộc về ai", không trả lời "người ấy được làm gì".
// (2) Nó KHÔNG kiểm độ tươi MFA. Đó là `assertFreshMfa`, một mệnh đề khác (D1) với ngưỡng riêng.
//     Gộp hai thứ vào đây sẽ làm mọi đường ghi kế thừa một ràng buộc mà không đường nào khai.
// (3) Nó KHÔNG là lớp có thẩm quyền. Lớp ấy là trigger `kiem_danh_tinh_theo_phien` ở 013, chạy
//     kể cả với một câu `INSERT` viết tay đi vòng qua gói này. Hàm này tồn tại để người gọi nhận
//     một lỗi đọc được thay vì một mã 23514 của Postgres — cùng lý do `TAX_CODE_PATTERN` tồn tại
//     song song với `CHECK` của 008.
// =============================================================================================

/** Phiên không tồn tại, hết hạn, bị thu hồi, hoặc thuộc tổ chức khác. Bốn ca, một thông báo. */
export class SessionInvalidError extends Error {
  constructor(message = "phiên không hợp lệ: hết hạn, bị thu hồi, hoặc thuộc tổ chức khác") {
    super(message);
    this.name = "SessionInvalidError";
  }
}

/**
 * Danh tính đọc ra từ một phiên. `sessionId` được trả lại cùng để người gọi ghi thẳng nó xuống
 * cột `*_session_id` — không phải để tiện, mà để không ai phải cầm hai biến rồi ghép nhầm.
 */
export interface SessionActor {
  readonly type: "USER";
  readonly id: string;
  readonly sessionId: string;
}

/**
 * Đọc chủ nhân của một phiên còn hiệu lực, hoặc NÉM.
 *
 * Bốn ca hỏng ném CÙNG MỘT thông báo, cùng lý do đã ghi cho `docToken` ở
 * `packages/invitation`: phân biệt được chúng là một oracle trên chính tập phiên.
 */
export async function resolveSessionActor(
  client: pg.PoolClient,
  orgId: string,
  sessionId: string,
): Promise<SessionActor> {
  await assertTenantBound(client, orgId, "resolveSessionActor");

  // [034 / sổ nợ 48] Nối `users.status = 'ACTIVE'` — cùng vế chịu lực của `hasPermission` và của
  // `resolveSessionByToken` (đường HTTP, review L-1). Trigger 034 thu hồi phiên lúc đình chỉ; vế này
  // đứng riêng cho ca phiên CÒN SỐNG của người bị đình chỉ (chèn sau đình chỉ, hoặc trigger bị gỡ).
  // Cùng một lỗi cho mọi ca hỏng — "bị đình chỉ" nói ra cũng là một oracle.
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT s.user_id
       FROM public.sessions s
       JOIN public.users u ON u.id OPERATOR(pg_catalog.=) s.user_id
      WHERE s.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND s.revoked_at IS NULL
        AND s.expires_at OPERATOR(pg_catalog.>) pg_catalog.now()
        AND u.status OPERATOR(pg_catalog.=) 'ACTIVE'`,
    [sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new SessionInvalidError();
  return { type: "USER", id: hang.user_id, sessionId };
}

// ==============================================================================================
// [ADR-020 mục 2 — S1.10.2] BEARER → PHIÊN, bằng BĂM. Đường "cookie → SessionActor" của apps/api.
//
// `resolveSessionActor` nhận `sessionId` (UUID) và tồn tại cho các gói nghiệp vụ, nơi phiên đã
// được xác lập. Tầng HTTP cầm thứ khác: một TOKEN dạng rõ từ cookie. 006 đã thiết kế sẵn cột
// `token_hash` + `UNIQUE (org_id, token_hash)` cho đúng việc này — chỉ chưa có hàm nào dùng tới
// (khoản nợ 6). Hàm này là nửa ĐỌC của khoản nợ ấy; ~~nửa PHÁT (`startUserSession`) là
// S1.10.4~~ **[S1.21] nửa PHÁT đã có từ S1.10.4** — `login.ts:228`, gọi ở
// `apps/api/src/routes/auth.ts:184`. Câu ở thì tương lai đã sống qua mười vòng.
//
// HAI ĐIỀU CỐ Ý:
//   ⑴ Đòi `mfa_verified_at IS NOT NULL`. ADR-020 nói "không có đăng nhập nửa chừng": một phiên
//      chưa qua TOTP không mở được route người mua nào, kể cả route đọc. ~~Trigger ép điều đó ở
//      tầng CSDL là S1.10.4; cho tới lúc đó, đây là lớp duy nhất và test đo nó.~~
//      **[S1.21, review lượt 13 H13-7] Trigger ấy ĐÃ CÓ:** `sessions_kiem_mfa_khi_tao`
//      (`db/migrations/029_dang_nhap_nguoi_mua.sql`, viết lại theo `la_duong_ung_dung` ở `037`,
//      thân được hardening ghim). Nên đây KHÔNG còn là lớp duy nhất — chiều sai của câu vừa
//      gạch là BI QUAN (khai ít lớp hơn số lớp thật), và nó vẫn là một lời khai sai.
//   ⑵ MỌI ca hỏng — token sai, phiên thu hồi, hết hạn, chưa MFA, tổ chức khác — ném CÙNG MỘT
//      `SessionInvalidError`. Cùng lý do đã ghi ở `resolveSessionActor`: phân biệt chúng là một
//      oracle trên tập phiên, và tầng HTTP còn nén tiếp thành một 401 duy nhất.
// ==============================================================================================

/** base64url, 32–128 ký tự. Sai hình dạng thì không tra CSDL — không có gì để tra. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/u;

export async function resolveSessionByToken(
  client: pg.PoolClient,
  orgId: string,
  token: string,
): Promise<SessionActor> {
  await assertTenantBound(client, orgId, "resolveSessionByToken");
  if (!TOKEN_RE.test(token)) throw new SessionInvalidError();
  const hash = createHash("sha256").update(token, "utf8").digest();

  // [review L-1] JOIN `users.status`: một người bị đình chỉ không được đọc gì nữa — không đợi hết TTL.
  // Cùng một lỗi cho ca này như bốn ca kia: "bị đình chỉ" cũng là một oracle nếu nói ra.
  const { rows } = await client.query<{ id: string; user_id: string }>(
    `SELECT s.id, s.user_id
       FROM public.sessions s
       JOIN public.users u ON u.id OPERATOR(pg_catalog.=) s.user_id
      WHERE s.token_hash OPERATOR(pg_catalog.=) $1::pg_catalog.bytea
        AND s.revoked_at IS NULL
        AND s.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()
        AND s.mfa_verified_at IS NOT NULL
        AND u.status OPERATOR(pg_catalog.=) 'ACTIVE'`,
    [hash],
  );
  const hang = rows[0];
  if (hang === undefined) throw new SessionInvalidError();
  return { type: "USER", id: hang.user_id, sessionId: hang.id };
}

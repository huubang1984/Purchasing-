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

  const { rows } = await client.query<{ user_id: string }>(
    `SELECT s.user_id
       FROM public.sessions s
      WHERE s.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND s.revoked_at IS NULL
        AND s.expires_at OPERATOR(pg_catalog.>) now()`,
    [sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new SessionInvalidError();
  return { type: "USER", id: hang.user_id, sessionId };
}

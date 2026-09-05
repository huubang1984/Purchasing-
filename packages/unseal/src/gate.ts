// ==============================================================================================
// [D1] CỔNG CHÍNH SÁCH MỞ THẦU — MỘT HÀM HỢP BỐN VẾ, KHÔNG PHẢI BỐN PHÉP KIỂM GỌI LẦN LƯỢT
//
// Mệnh đề D1: *"Mở thầu cần đồng thời: quyền hợp lệ **và** MFA còn hiệu lực trong cửa sổ ngắn
// **và** RFQ đã CLOSED **và** cổng chính sách thông qua."*
//
// Rủi ro số 5 của kế hoạch S1 gọi tên trước cách hạng mục này hỏng:
//
//   *"S1.6 rất dễ viết 4 phép kiểm rời rồi gọi lần lượt. Đúng chức năng, nhưng KHÔNG đo được
//    phép hội, và ô ✅ lại rộng hơn phép đo. Một hàm hợp cả bốn vế, và test đo chính hàm đó —
//    vô hiệu hoá TỪNG vế một → RED thật cho từng vế."*
//
// Và ghi chú §4 của D1 ở cuối S0 đã đo ra đúng trạng thái ấy: 17 test mang nhãn D1 tách làm HAI
// cụm rời — 12 test đo MFA, 5 test đo quyền — và **không test nào đo hai vế cùng lúc**, vì không
// có hàm nào hợp hai vế lại. Hai vế còn lại thì không có một dòng mã nào.
//
// ---------------------------------------------------------------------------------------------
// CÁCH ĐO PHÉP HỘI Ở ĐÂY, và vì sao nó KHÔNG phải đột biến mã nguồn
// ---------------------------------------------------------------------------------------------
// Ba lớp trước của dự án đo bằng ĐỘT BIẾN: gỡ một trigger, chạy lại, đòi thao tác đi lọt. Cách ấy
// không áp được cho TypeScript trong một lượt test — không có `DROP FUNCTION` cho một câu `if`.
//
// Cách ở đây mạnh tương đương và không cần sửa mã: **với mỗi vế i, dựng một trạng thái mà CHỈ vế
// i sai, rồi đòi cổng từ chối VÀ gọi đúng tên vế i.** Nếu một vế bị quên trong cài đặt, test của
// vế ấy sẽ THẤY CỔNG CHO QUA — tức nó đỏ, đúng như một lượt đột biến. Cộng một đối chứng dương
// nơi cả bốn vế đúng.
//
// `UnsealDeniedError.clause` tồn tại CHO phép đo ấy. Nó không phải một tiện nghi cho giao diện:
// một cổng chỉ ném `Error("từ chối")` sẽ làm bốn test trên không phân biệt được vế nào đã chặn,
// và lúc đó bốn test ấy lại đo đúng một thứ.
// ---------------------------------------------------------------------------------------------
//
// PHẦN CHÊNH PHẢI NÓI RA, và nó đi vào §4 của ma trận: cổng này chạy ở thời điểm **ĐIỀU PHỐI**
// (`dispatchUnseal`), không ở thời điểm **GIẢI MÃ**.
//
// [REVIEW AN NINH S1.6 — HIGH-3] Nguyên văn câu cũ, giữ để đối chiếu vì nó SAI và vì cái sai của
// nó đã che một lớp có thật:
//
//   ~~*"Nó không chạy được ở worker: `app_unseal` cố ý KHÔNG đọc được `users` (quyết định của~~
//   ~~002) và không đọc được ma trận quyền (005), nên HAI vế đầu của D1 là những câu worker~~
//   ~~không hỏi được."*~~
//
// Vế `users` SAI: `006:232` cấp `SELECT (id, org_id, status) ON users TO app_unseal`, và `006:305`
// cấp đúng sáu cột của `sessions` mà `assertFreshMfa` đọc — 006 ghi rõ là cấp *"vì bất biến D1"*.
// Chỉ vế QUYỀN là thật sự không hỏi được ở worker (`app_unseal` không có GRANT nào trên
// `user_roles`/`role_permissions`/`permissions`).
//
// Nay: `executeUnsealRequest` chạy LẠI `assertFreshMfa` trên phiên đã điều phối (022 thêm ba cột
// `dispatched_*` để có thứ mà hỏi), với một cửa sổ riêng của lúc giải mã. Phần chênh CÒN LẠI, và
// nó hẹp hơn hẳn: một người bị GỠ QUYỀN nhưng vẫn giữ phiên hợp lệ, trong khoảng giữa điều phối
// và giải mã, vẫn dẫn tới một lượt mở thầu chạy trọn.
// ==============================================================================================

import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";
import {
  MfaRequiredError,
  PERMISSIONS,
  PermissionDeniedError,
  assertFreshMfa,
  requirePermission,
  resolveSessionActor,
} from "@trustprocure/identity";

/** Bốn vế của D1, theo đúng thứ tự chúng xuất hiện trong mệnh đề. */
export const UNSEAL_CLAUSES = ["PERMISSION", "MFA_FRESH", "RFQ_CLOSED", "POLICY_GATE"] as const;
export type UnsealClause = (typeof UNSEAL_CLAUSES)[number];

/**
 * Cửa sổ MFA mặc định cho mở thầu: 15 phút.
 *
 * Mệnh đề D1 nói *"MFA còn hiệu lực trong cửa sổ NGẮN"* mà không cho một con số, nên con số phải
 * được đặt ở đâu đó — và đặt nó ở đây, có tên, đọc được, tốt hơn là để mỗi người gọi tự chọn.
 * Người gọi vẫn đổi được, nhưng đổi là một tham số nhìn thấy trong diff.
 */
export const UNSEAL_MFA_MAX_AGE_SECONDS = 15 * 60;

export class UnsealDeniedError extends Error {
  constructor(
    readonly clause: UnsealClause,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "UnsealDeniedError";
  }
}

export interface UnsealGateInput {
  readonly unsealRequestId: string;
  /** [ADR-016] Phiên của chính người bấm "mở thầu". Danh tính là DẪN XUẤT. */
  readonly actorSessionId: string;
  readonly maxMfaAgeSeconds?: number;
}

/**
 * Bằng chứng rằng CẢ BỐN vế đã qua. Nó chỉ dựng được khi không vế nào ném, nên một giá trị thuộc
 * kiểu này là một phát biểu về phép HỘI, không phải về bốn phép kiểm rời.
 */
export interface UnsealGateReport {
  readonly unsealRequestId: string;
  readonly rfqId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly clauses: readonly UnsealClause[];
  /**
   * [REVIEW AN NINH S1.6 — MED-4] Yêu cầu này có đi đường break-glass không.
   *
   * Nó ở đây vì `clauses` là một HẰNG SỐ — nó nói cổng có BỐN vế, không nói vế nào đã thật sự
   * đếm được gì. Với break-glass, `POLICY_GATE` bỏ qua phép đếm phê duyệt, nên một bản ghi kiểm
   * toán chỉ mang `clauses` sẽ khiến một lần điều phối break-glass GIỐNG HỆT một lần điều phối
   * đã đủ phê duyệt.
   */
  readonly breakGlass: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HangYeuCau {
  readonly rfq_id: string;
  readonly status: string;
  readonly break_glass: boolean;
  readonly rfq_status: string;
  readonly so_phe_duyet: string;
  readonly can_phe_duyet: number;
}

/**
 * [D1] Cổng chính sách mở thầu — bốn vế, một hàm, một kết luận.
 *
 * Ném `UnsealDeniedError` mang tên vế đã chặn. Không có đường trả về `false`: một cổng gác trả
 * boolean là một cổng gác người gọi quên kiểm được, và dự án đã rút `hasPermission` khỏi mặt tiền
 * của `@trustprocure/identity` vì đúng lý do ấy.
 */
export async function assertUnsealAllowed(
  client: pg.PoolClient,
  orgId: string,
  input: UnsealGateInput,
  auditPool: pg.Pool,
): Promise<UnsealGateReport> {
  await assertTenantBound(client, orgId, "assertUnsealAllowed");
  if (!UUID_PATTERN.test(input.unsealRequestId)) {
    throw new Error(`unsealRequestId phải là UUID hợp lệ: "${input.unsealRequestId}".`);
  }
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  // Đọc MỘT LẦN mọi sự thật mà hai vế cuối cần. Hai câu SELECT rời sẽ mở một cửa sổ mà trạng thái
  // RFQ đổi được ở giữa — và cửa sổ ấy nằm đúng giữa hai vế của một phép hội.
  const { rows } = await client.query<HangYeuCau>(
    `SELECT r.rfq_id, r.status, r.break_glass, p.status AS rfq_status,
            (SELECT count(*) FROM unseal_approvals a
              WHERE a.unseal_request_id = r.id AND a.org_id = r.org_id) AS so_phe_duyet,
            public.unseal_so_phe_duyet_can(r.rfq_id) AS can_phe_duyet
       FROM unseal_requests r
       JOIN rfq_packages p ON p.id = r.rfq_id AND p.org_id = r.org_id
      WHERE r.id = $1`,
    [input.unsealRequestId],
  );
  const yc = rows[0];
  if (yc === undefined) {
    throw new UnsealDeniedError(
      "POLICY_GATE",
      "không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn",
    );
  }

  // ---- VẾ 1: QUYỀN HỢP LỆ ------------------------------------------------------------------
  // `requirePermission` chứ không `hasPermission`: mỗi lần TỪ CHỐI phải để lại một bản ghi kiểm
  // toán (D5), và nó ghi trong một transaction ĐỘC LẬP nên một lần rollback của người gọi không
  // xoá dấu vết.
  try {
    await requirePermission(
      client,
      {
        userId: actor.id,
        orgId,
        permission: PERMISSIONS.RFQ_UNSEAL,
        resourceType: "UNSEAL_REQUEST",
        resourceId: input.unsealRequestId,
      },
      auditPool,
    );
  } catch (loi) {
    if (loi instanceof PermissionDeniedError) {
      throw new UnsealDeniedError("PERMISSION", "người dùng không có quyền mở thầu", {
        cause: loi,
      });
    }
    throw loi;
  }

  // ---- VẾ 2: MFA CÒN HIỆU LỰC TRONG CỬA SỔ NGẮN ---------------------------------------------
  try {
    await assertFreshMfa(client, {
      sessionId: actor.sessionId,
      userId: actor.id,
      orgId,
      maxAgeSeconds: input.maxMfaAgeSeconds ?? UNSEAL_MFA_MAX_AGE_SECONDS,
    });
  } catch (loi) {
    if (loi instanceof MfaRequiredError) {
      throw new UnsealDeniedError("MFA_FRESH", "phiên chưa qua MFA trong cửa sổ cho phép", {
        cause: loi,
      });
    }
    throw loi;
  }

  // ---- VẾ 3: RFQ ĐÃ CLOSED -------------------------------------------------------------------
  // Vế này CHÍNH LÀ hàng C3 của sổ đăng ký. Ở cuối S0, ghi chú §4 của D1 chỉ ra rằng hai hàng ấy
  // cách nhau tám dòng trong ma trận, một hàng ✅ và một hàng ⏳, cùng nói về một điều. Nay chúng
  // nói về một điều VÀ cùng được một lớp giữ.
  if (yc.rfq_status !== "CLOSED") {
    throw new UnsealDeniedError(
      "RFQ_CLOSED",
      `RFQ phải ở trạng thái CLOSED để mở thầu; đang ở ${yc.rfq_status}`,
    );
  }

  // ---- VẾ 4: CỔNG CHÍNH SÁCH THÔNG QUA -------------------------------------------------------
  // "Thông qua" ở đây có nội dung cụ thể: yêu cầu đã ở APPROVED, và số phê duyệt thật sự đạt
  // ngưỡng mà chính sách của tổ chức đòi (D2). Vế thứ hai KHÔNG thừa: nó là lớp bắt được ca một
  // ai đó lật `status` bằng SQL viết tay mà bỏ qua trigger — trigger chỉ chạy trên đường DML.
  if (yc.status !== "APPROVED") {
    throw new UnsealDeniedError(
      "POLICY_GATE",
      `yêu cầu mở thầu phải ở trạng thái APPROVED; đang ở ${yc.status}`,
    );
  }
  if (!yc.break_glass && Number(yc.so_phe_duyet) < yc.can_phe_duyet) {
    throw new UnsealDeniedError(
      "POLICY_GATE",
      `yêu cầu này cần ${yc.can_phe_duyet} phê duyệt, mới có ${yc.so_phe_duyet} (D2)`,
    );
  }

  return {
    unsealRequestId: input.unsealRequestId,
    rfqId: yc.rfq_id,
    userId: actor.id,
    sessionId: actor.sessionId,
    clauses: UNSEAL_CLAUSES,
    breakGlass: yc.break_glass,
  };
}

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound, type AuditEventInput } from "@trustprocure/audit";
import { withTenant } from "@trustprocure/tenancy";
import { PERMISSIONS, type Permission } from "./permissions.js";

/** Ném khi người dùng không có quyền được yêu cầu. Bản ghi kiểm toán ĐÃ được ghi trước đó. */
export class PermissionDeniedError extends Error {
  constructor(
    readonly userId: string,
    readonly permission: string,
  ) {
    // Cố ý KHÔNG nội suy userId vào message: message đi vào log, và khuôn "ném dữ liệu đầu vào
    // vào message" là thứ được sao chép sang chỗ mà dữ liệu ĐÚNG LÀ bí mật. Cùng lý do với
    // TenantError ở packages/tenancy/src/with-tenant.ts. Người điều tra lấy userId từ chính
    // trường `userId` hoặc từ sổ kiểm toán.
    super(`Người dùng không có quyền "${permission}".`);
    this.name = "PermissionDeniedError";
  }
}

/**
 * Ném khi việc TỪ CHỐI đã xảy ra nhưng bản ghi kiểm toán của nó KHÔNG ghi được.
 *
 * Vì sao đây là một lớp lỗi RIÊNG chứ không phải một cờ trên `PermissionDeniedError`: đường xử
 * lý mặc định của một API là `catch (PermissionDeniedError) -> 403`. Nếu ca "không audit được"
 * cũng là `PermissionDeniedError`, nó rơi vào đúng nhánh đó và biến mất — một lần từ chối
 * KHÔNG ĐƯỢC GHI SỔ trông y hệt một lần từ chối bình thường. D5 nói lần từ chối PHẢI được
 * audit; khi không thoả được, hệ thống phải gãy ỒN ÀO, không suy giảm im lặng.
 *
 * Vẫn fail-CLOSED: thao tác không được phép trong cả hai nhánh. `cause` giữ nguyên nhân gốc,
 * `denial` giữ lần từ chối mà lẽ ra phải được ghi.
 */
export class PermissionAuditFailedError extends Error {
  constructor(
    readonly denial: PermissionDeniedError,
    /**
     * [S1.85 / khoản 131] `resource_type` của bản ghi ĐÃ KHÔNG ghi được — một MÃ ĐỊNH DANH viết hoa, đã qua `HINH_DANG_LOAI_TAI_NGUYEN`
     * ở đầu `requirePermission`. Có mặt ở đây để dòng log nói được lần từ chối NÀO đã mất; `action` của lần ghi ấy là hằng
     * `ACTION_TU_CHOI_QUYEN`, và `permission` đọc từ `denial`.
     */
    readonly resourceType: string,
    cause: Error,
    /**
     * [S1.216 / khoản 177 / ADR-127] BĂM RÚT GỌN của người bị từ chối — 12 hex đầu của sha256(`denial.userId`), tính ở
     * `requirePermission` bằng `bamNguoiRutGon`. Có mặt để dòng log của lần MẤT SỔ nói được lần từ chối của AI: ở đúng ca này
     * hàng sổ — nơi `actor_id` sống — là hàng không ghi được, nên lập luận "danh tính lấy từ sổ" không đứng (§S1.85 mục 7). Là
     * BĂM chứ không phải `userId`: các dòng của cùng một người nối được với nhau mà không nêu ai; đi vào dòng log qua phép canh
     * hình dạng `^[0-9a-f]{12}$` ở `moTaHangDongCuaLanTuChoi` — một chuỗi khác (kể cả chính UUID) ra `HANG_LA`. `null` ở chỗ
     * dựng cũ/test ⇒ dòng không có `nguoi=`.
     */
    readonly nguoiBam: string | null = null,
  ) {
    super(
      `Từ chối vì thiếu quyền "${denial.permission}" nhưng KHÔNG ghi được bản ghi kiểm toán ` +
        `(bất biến D5): ${cause.message}`,
      { cause },
    );
    this.name = "PermissionAuditFailedError";
  }
}

/**
 * [S1.68 / khoản 119] Ném khi một lần TỪ CHỐI ngoài `requirePermission` đã xảy ra nhưng bản ghi kiểm toán của nó KHÔNG ghi được.
 *
 * Cùng lý do tồn tại với `PermissionAuditFailedError`, cho các lần từ chối còn lại: vế 2–4 của cổng mở thầu (`UnsealDeniedError`), lần THỬ
 * vi phạm D2 của phê duyệt mở thầu và của đặt lại TOTP (lỗi 23514 của CSDL). Trước lớp này ba chỗ ấy để lỗi của lần ghi THAY CHỖ lần từ
 * chối. Đo trên master 749f925 qua HTTP (biên bản §S1.68), trigger chặn lần ghi: RAISE 23514 ⇒ 422 mang thông điệp của trigger, 0 dòng
 * log; RAISE TP119 ⇒ 500; EXECUTE trên `audit_append` thu hồi ⇒ 403 — không ca nào để lại hàng sổ, và không ca nào cho người gọi biết
 * một lần từ chối vừa không vào sổ. Mã khác đi theo bảng `anhXaLoiPostgres` của bộ điều phối (đọc: 23505 ⇒ 409; 23503 và lớp 22 ⇒ 422).
 *
 * Vẫn fail-CLOSED: `denial` giữ lần từ chối, `cause` giữ lỗi của lần ghi, `action` là mã sự kiện đã không ghi được (hằng của người gọi).
 * KHÁC `PermissionAuditFailedError` ở một điểm, có chủ đích: thông điệp KHÔNG nối `cause.message` — lỗi gốc ở đây có thể là thông điệp do
 * một trigger viết, và lớp này không biết thông điệp ấy mang gì. Người điều tra đọc `cause`.
 */
export class DenialAuditFailedError extends Error {
  constructor(
    readonly action: string,
    /** [S1.85 / khoản 131] `resource_type` của bản ghi đã không ghi được — cùng lý do với `PermissionAuditFailedError.resourceType`. */
    readonly resourceType: string,
    readonly denial: Error,
    cause: Error,
    /**
     * [S1.225 / khoản 179] VẾ đã từ chối — hằng của người gọi `throwAuditedDenial` (vế của cổng mở thầu trong `UNSEAL_CLAUSES`, vế của
     * worker lúc giải mã, trạng thái RFQ của A4, [S1.241 / khoản 279] mã chốt kiểm soát, mã từ chối trạng thái, [S1.245 / khoản 267] lý
     * do từ chối huỷ yêu cầu mở thầu), hay `null` khi người gọi không có vế nào để kể. Có mặt ở đây vì hàng sổ mang vế ấy CHÍNH LÀ hàng
     * đã không ghi được — ba đường từ chối ghi cùng `action`/`resourceType` [S1.241 / khoản 279] (và ~~mười bảy~~ ~~[S1.265] mười chín~~ ~~[S1.269] hai mươi hai~~ [S1.9101] hai mươi ba mã chốt vào sổ chung một
     * `CONTROL_DENIED`, chín mã lý do chung một `RFQ_STATE_DENIED`, [S1.245 / khoản 267] hai lý do chung một `UNSEAL_CANCEL_DENIED`),
     * nên không có nó dòng log không nói được vế nào của cổng đã chặn. Đi vào dòng log qua phép thuộc-tập `DANH_MUC_VE_CONG`, không
     * nguyên văn.
     */
    readonly clause: string | null = null,
    /**
     * [S1.216 / khoản 177 / ADR-127] Băm rút gọn của `event.actorId` mà `throwAuditedDenial` tính — cùng lý do và cùng phép
     * canh với `PermissionAuditFailedError.nguoiBam`. Lần từ chối của SERVICE (worker lúc giải mã, `actorId` null) không có ⇒ `null`.
     */
    readonly nguoiBam: string | null = null,
  ) {
    super("Một lần từ chối KHÔNG ghi được bản ghi kiểm toán (bất biến D5).", { cause });
    this.name = "DenialAuditFailedError";
  }
}

export interface PermissionCheck {
  readonly userId: string;
  readonly orgId: string;
  readonly permission: Permission;
}

/**
 * Người dùng U có quyền P trong tổ chức đang gắn không?
 *
 * PHẢI gọi bên trong `withTenant()` của ĐÚNG `orgId` — có khẳng định ở câu lệnh đầu tiên.
 *
 * BA QUYẾT ĐỊNH TRUY VẤN, mỗi cái đóng một đường đi:
 *
 * (1) `assertTenantBound` TRƯỚC MỌI THỨ. Truy vấn bên dưới đọc DƯỚI RLS, mà RLS lọc theo GUC
 *     `app.org_id` chứ không theo tham số `orgId`. Không có vế này thì `orgId` là một tham số
 *     TRANG TRÍ: gọi với tổ chức P trên một phiên đang gắn tổ chức Q trả về `false` — đúng
 *     hướng an toàn, nhưng là "không thấy gì" chứ không phải "không có quyền", và hai thứ đó
 *     phải phân biệt được. Đây là cùng bài học đã đo ở Task 6 cho `verifyAuditChain`.
 *
 *     [vòng fix 1 — F5] NÓI ĐÚNG MỨC NÓ CHỊU LỰC TRƯỚC AI. Bản trước gọi `orgId` là "tham số
 *     CHỊU LỰC" trần trụi. Đo được: mở phiên bằng `withTenant(P)`, để `fn` chạy
 *     `set_config('app.org_id', Q)` rồi gọi `requirePermission({ orgId: Q })` -> sổ kiểm toán
 *     của Q nhận một bản ghi mang `actor_id` của người thuộc P, VÀ bản ghi đó đi qua
 *     `noi_chuoi_kiem_toan()` nên nằm VĨNH VIỄN trong chuỗi băm chống-sửa của Q.
 *     `assertTenantBound` so MỘT giá trị người gọi kiểm soát (`orgId`) với MỘT giá trị người
 *     gọi cũng kiểm soát (GUC `app.org_id`, thứ mà chính `fn` đặt lại được — điều
 *     packages/tenancy/src/with-tenant.ts ĐÃ ghi ra).
 *     => Nó chịu lực trước LỖI LẬP TRÌNH (gọi nhầm tổ chức), KHÔNG trước KẺ TẤN CÔNG.
 *     Trung thực về mức độ: đây KHÔNG phải leo thang quyền — một `app_api` bị chiếm đã gọi
 *     được `audit_append` trực tiếp từ Task 6. Cái mới là một SINK dễ dùng. Khoản nợ thuộc gói
 *     `tenancy` (GUC phạm vi phiên do `fn` đặt lại được), không thuộc gói này.
 *
 * (2) `u.status = 'ACTIVE'` nằm TRONG chính truy vấn, không tách thành một bước riêng có thể
 *     bị quên ở đường gọi khác — người dùng bị đình chỉ mất toàn bộ quyền ngay lập tức.
 *
 * (3) VẾ NỐI QUA `public.users` LÀ VẾ CHỊU LỰC CỦA CÔ LẬP TỔ CHỨC, không phải một tiện nghi để
 *     lọc `status`. `user_roles` không ép `org_id` khớp `users.org_id` (xem khối dư lượng ở
 *     005_identity.sql), nên một hàng (tổ_chức_A, người_của_B, DIRECTOR) chèn được. Nó vô hiệu
 *     CHÍNH VÌ vế nối này chạy dưới RLS của tổ chức A, nơi người của B không tồn tại. Gỡ vế
 *     nối ra là mở đúng đường leo thang đó — có test đối kháng.
 *
 * [QT3] Mọi tên bảng viết đủ `public.`, mọi hàm viết đủ `pg_catalog.`/`public.`, VÀ MỌI TOÁN TỬ
 * `=` viết đủ `OPERATOR(pg_catalog.=)`. Hàm này chạy trên pool ỨNG DỤNG, dưới `search_path` mà
 * dự án KHÔNG kiểm soát (xem khối "GHIM TÊN HÀM" ở packages/tenancy/src/with-tenant.ts).
 *
 * ============================================================================
 * [vòng fix 1 — F3] VÌ SAO TOÁN TỬ ĐƯỢC GHI ĐỦ SCHEMA Ở ĐÂY — VÀ VÌ SAO LẬP LUẬN CŨ SAI
 * ============================================================================
 * Bản trước KHÔNG ghi đủ schema cho `=`, với lý do "đường đi tới đó đã bị hai lớp khác đóng
 * (hardening cưỡng chế `rolconfig IS NULL`; `createPool` từ chối tham số `options`)". Lập luận
 * đó SAI ở cả ba chỗ, và cả ba đều đo được trên PostgreSQL 16.15:
 *
 *   (1) Hai lớp đó canh `rolconfig` và chuỗi KẾT NỐI. Chúng KHÔNG đóng đường một câu
 *       `SET search_path = ...` do CHÍNH MÃ ỨNG DỤNG phát ra trên client này (hoặc do một SQLi
 *       trong `fn`). Toán tử `=` cướp được THẬT — fixture tự chứng minh trước khi kết luận:
 *       với `SET search_path = doc, pg_catalog, public` và `CREATE OPERATOR doc.=` trả `true`,
 *       phép so `'1111…'::uuid = '2222…'::uuid` cho `true`.
 *       (Ghi lại tiền đề đi kèm: nếu KHÔNG nêu tên `pg_catalog` thì nó được tìm NGẦM TRƯỚC và
 *       toán tử KHÔNG cướp được — đã đo `false`. Nêu tên nó ở vị trí sau là đủ để cướp. Cùng
 *       quy tắc đã ghi ở packages/db/src/migrate.ts.)
 *   (2) Lớp `rolconfig` chỉ tự chữa cho BỐN tên role được ban phước (`app_api`, `app_unseal`,
 *       `app_api_login`, `app_unseal_login`); với một role đăng nhập tên khác, `migrate()` thu
 *       hồi luôn membership. Tức bảo đảm ấy chỉ đúng dưới MỘT QUY ƯỚC ĐẶT TÊN chưa hề được nêu
 *       ở file này.
 *   (3) Lớp THẬT SỰ chịu lực hôm qua là một thứ khác hẳn và TÌNH CỜ: `app_current_org_id()`
 *       KHÔNG ghim `search_path` (`proconfig` = null), nên `NULLIF` bên trong nó phân giải `=`
 *       dưới search_path NGƯỜI GỌI; toán tử thù địch làm nó sập về NULL => RLS không thấy hàng
 *       nào => `assertTenantBound` ném TRƯỚC khi truy vấn dễ tổn thương chạy.
 *       PHÉP ĐO PHẢN CHỨNG, chạy trên đúng lược đồ này: chỉ cần
 *       `ALTER FUNCTION public.app_current_org_id() SET search_path = pg_catalog` — đúng thứ
 *       QT3 KHUYẾN KHÍCH và đúng thứ 005 đã làm cho hai hàm trigger D3 — thì
 *           hasPermission(BUYER, po.approve) = TRUE   (sự thật: false)
 *           hasPermission(BUYER, rfq.unseal) = TRUE   (sự thật: false)
 *           hasPermission(BUYER, audit.read) = TRUE   (sự thật: false)
 *       D1 SỤP HOÀN TOÀN. Với `OPERATOR(pg_catalog.=)` viết đủ như hiện nay, CÙNG kịch bản đó
 *       (toán tử VẪN bị cướp — fixture khẳng định `true`) cho lại `false, false, false`.
 *   => Bảo đảm nay đứng bằng CHÍNH câu truy vấn này, không bằng một tính chất tình cờ của một
 *      hàm khác. Có test đối kháng ở rbac.int.test.ts.
 *
 * Phản bác lập luận cũ "mở nó ở đây một mình sẽ là một bảo đảm chỉ đúng ở một file": `hasPermission`
 * là hàm DUY NHẤT trong repo trả lời câu hỏi CÓ/KHÔNG về quyền dưới một `search_path` không kiểm
 * soát. Nó khác về LOẠI, không phải khác về MỨC ĐỘ, so với một truy vấn nghiệp vụ thường —
 * một truy vấn thường bị cướp toán tử thì trả sai dữ liệu; hàm này bị cướp thì trả `true` cho
 * MỌI quyền của MỌI người.
 *
 * [vòng fix 2 — MỤC A] BẢN TRƯỚC CỦA ĐÚNG ĐOẠN NÀY LÀ MỘT KHẲNG ĐỊNH SAI KÈM LỜI KHAI "ĐÃ ĐO",
 * và nó phải được nêu ra chứ không lặng lẽ thay thế. Nguyên văn câu bị gỡ: «`assertTenantBound`
 * KHÔNG cần bản vá tương ứng: nó dùng `IS NOT DISTINCT FROM`, thứ phân giải qua opclass mặc
 * định của kiểu chứ không qua `search_path` (đo: dưới đúng search_path thù địch ở trên, nó vẫn
 * phán xét ĐÚNG)». SAI ở tiền đề: PostgreSQL phân giải `IS [NOT] DISTINCT FROM` bằng cách TRA
 * CỨU TOÁN TỬ `=` THEO TÊN qua `search_path` (`make_distinct_op` -> `make_op`), không qua
 * opclass. Phép đo đã được chạy lại và cho ngược lại: `assertTenantBound` BỊ VÔ HIỆU HOÀN TOÀN
 * dưới một `search_path` cướp `=` của `uuid`, và `exportChainHead` khi đó đúc được một mốc neo
 * mang nhãn tổ chức Q từ sổ của tổ chức P. Toàn bộ phép đo và bản vá nằm ở docblock của
 * packages/audit/src/tenant-guard.ts; đây chỉ là con trỏ tới nó, để câu sai không sống lại.
 * Bài học ghi cho chính chỗ này: một câu "đã đo" mà KHÔNG kèm số đo cụ thể trong văn bản là một
 * câu chưa được kiểm — cả ba khối "đã đo" khác trong file này đều dán số vào.
 *
 * TIỀN ĐỀ CỦA PostgreSQL mà bảo đảm này dựa vào, viết ra vì nó vô hình: `pg_temp` KHÔNG BAO GIỜ
 * được tìm cho HÀM và TOÁN TỬ, kể cả khi được nêu tên tường minh trong `search_path`. Đó là thứ
 * giữ cho kịch bản A1 ("app_api bị chiếm") không với tới trục này: `app_api` không CREATE được
 * schema hay function ngoài `pg_temp` (đã đo), nên nó KHÔNG tự dựng được toán tử thù địch —
 * kẻ tấn công phải đã có sẵn một schema do người khác tạo. Nếu tiền đề đó đổi, phần (3) ở trên
 * đổi theo.
 *
 * DƯ LƯỢNG CÒN LẠI, nói ra thay vì hứa suông: quy ước `OPERATOR(pg_catalog.…)` mới chỉ áp cho
 * file này và cho `CAU_KHOA_TU_VAN` bên dưới. Mọi truy vấn nghiệp vụ của các task sau vẫn viết
 * `=` trần, và KHÔNG có lớp nào (lint, depcruise, test) cưỡng chế quy ước ấy — nên hôm nay nó
 * là một quy ước theo KỶ LUẬT, không phải một bất biến được canh.
 */
export async function hasPermission(
  client: pg.PoolClient,
  { userId, orgId, permission }: PermissionCheck,
): Promise<boolean> {
  await assertTenantBound(client, orgId, "hasPermission");

  const { rowCount } = await client.query(
    `SELECT 1
       FROM public.user_roles ur
       JOIN public.users u ON u.id OPERATOR(pg_catalog.=) ur.user_id
       JOIN public.role_permissions rp ON rp.role_code OPERATOR(pg_catalog.=) ur.role_code
      WHERE ur.user_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND rp.permission_code OPERATOR(pg_catalog.=) $2::pg_catalog.text
        AND u.status OPERATOR(pg_catalog.=) 'ACTIVE'
      LIMIT 1`,
    [userId, permission],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * [S1.91 / khoản 194] AI TRONG TỔ CHỨC GIỮ MỘT MÃ QUYỀN — danh sách NGƯỜI NHẬN, không phải một cổng.
 *
 * Vì sao hàm này được phép ra mặt tiền gói trong khi `hasPermission` thì KHÔNG (khối đầu `index.ts`):
 * `hasPermission` nguy hiểm vì nó trả lời câu hỏi *"được hay không"* mà không để lại dấu vết, nên nó
 * mời gọi một cổng quyền im lặng. Hàm này không trả lời câu hỏi ấy cho ai — nó trả về một danh sách
 * người để GỬI TIN. Không nhánh nào trong kho được dùng nó để quyết định cho qua hay chặn.
 *
 * Trả `userId` chứ KHÔNG trả email, và vế ấy là có chủ đích: người gọi duy nhất hôm nay là đường xếp
 * việc thông báo, nó chỉ cần định danh. Giải ra email là việc của handler, đọc từ chính hàng `users`
 * — cùng kỷ luật đã ghi ở `issueLoginToken` (review lượt 14, H14-6): không tin một chuỗi email do
 * người gọi mang tới, vì `UNIQUE (org_id, email)` so NGUYÊN VĂN.
 *
 * Phạm vi tổ chức do RLS giữ, như mọi câu đọc khác của gói này; `assertTenantBound` là vế thứ hai.
 */
export async function listUserIdsWithPermission(
  client: pg.PoolClient,
  orgId: string,
  permission: string,
): Promise<readonly string[]> {
  await assertTenantBound(client, orgId, "listUserIdsWithPermission");
  const { rows } = await client.query<{ id: string }>(
    `SELECT DISTINCT u.id
       FROM public.user_roles ur
       JOIN public.users u ON u.id OPERATOR(pg_catalog.=) ur.user_id
       JOIN public.role_permissions rp ON rp.role_code OPERATOR(pg_catalog.=) ur.role_code
      WHERE rp.permission_code OPERATOR(pg_catalog.=) $1::pg_catalog.text
        AND u.status OPERATOR(pg_catalog.=) 'ACTIVE'
      ORDER BY u.id`,
    [permission],
  );
  return rows.map((r) => r.id);
}

export interface PermissionRequirement extends PermissionCheck {
  /**
   * Loại tài nguyên bị từ chối, ghi thẳng vào cột `resource_type` của sổ kiểm toán BẤT BIẾN.
   *
   * [vòng fix 1 — F7] PHẢI khớp `HINH_DANG_LOAI_TAI_NGUYEN`. Chú thích của `payload` canh rất
   * kỹ việc "KHÔNG BAO GIỜ đưa giá/bí mật vào đây" nhưng trường này thì trước đây không một
   * dòng nào nói tới — trong khi nó là một chuỗi TỰ DO đi vào cùng một sổ chỉ-ghi-thêm, đi qua
   * `noi_chuoi_kiem_toan()`, và nằm vĩnh viễn trong chuỗi băm. Đo được: một chuỗi mang giá
   * chào thầu và một mã OTP đi lọt trọn vẹn vào cột đó.
   */
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly requestId?: string | null;
}

/**
 * [vòng fix 1 — F7] Hình dạng cho phép của `resourceType`: MÃ ĐỊNH DANH viết hoa, tối đa 64 ký
 * tự — `RFQ`, `PURCHASE_ORDER`, `AUDIT_LOG`.
 *
 * Vì sao một biểu thức hình dạng chứ không phải một union đóng: ở S0 chưa có bảng nghiệp vụ nào
 * ngoài `organizations`/`users`/`audit_events`, nên một union đóng viết hôm nay sẽ phải sửa ở
 * MỌI task sau và sẽ bị nới ra bằng phản xạ. Hình dạng này ngược lại KHÔNG cần sửa khi thêm
 * loại tài nguyên mới, mà vẫn loại được chính lớp nội dung nguy hiểm: mọi thứ có khoảng trắng,
 * dấu câu, chữ thường, hay chữ số đứng một mình — tức mọi câu văn xuôi, mọi số tiền, mọi mã
 * OTP. Đây là một CHẶN CẤU TRÚC, không phải một bộ lọc nội dung: nó không "phát hiện giá", nó
 * làm chỗ đó không chứa được văn xuôi.
 *
 * Phát biểu đúng mức: một người CỐ TÌNH vẫn nhét được `GIA_1500000` qua. Cái nó đóng là đường
 * đi VÔ Ý — nội suy một chuỗi người dùng hoặc một thông báo lỗi vào trường này.
 *
 * [S1.225 / khoản 189] Hình dạng này nay chỉ canh đường vào SỔ (`requirePermission`, `throwAuditedDenial`). Đường ra DÒNG LOG
 * (`moTaHangDongCuaLanTuChoi`) thôi dùng nó: nó nhận cả lớp bí mật mà kho này tự sinh ra (bí mật TOTP base32 bắt đầu bằng chữ cái,
 * UUID viết hoa bỏ gạch nối, hex viết hoa), nên dòng log canh theo TẬP ĐÓNG — ba danh mục dưới đây.
 */
const HINH_DANG_LOAI_TAI_NGUYEN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * ~~Hình dạng của một MÃ QUYỀN: các đoạn chữ thường nối bằng dấu chấm (`supplier.manage`) — khuôn của MỌI giá trị trong `PERMISSIONS`,~~
 * ~~và có meta-test đối chiếu danh mục ấy với bảng `permissions` của `005`.~~ [S1.225 / khoản 189] Biểu thức ấy đã bị gỡ: nó nhận
 * `supplier.delete` — đúng khuôn, không có trong `PERMISSIONS`. Mã quyền ra dòng log nay phải THUỘC `PERMISSIONS` (`MA_QUYEN` dưới đây).
 */

/**
 * Thứ thay chỗ một hằng ~~KHÔNG đúng hình dạng~~ [S1.225 / khoản 189] KHÔNG CÓ TRONG DANH MỤC. Chính nó là một hằng: nó nói "có một
 * trường ở đây và nó không đúng ~~khuôn~~ tên nào đã khai" mà không nói trường ấy mang gì. Im lặng bỏ đi thì dòng log ngắn lại một cách
 * không ai giải thích được — cùng lý do với `loi khong ro`.
 */
const HANG_LA = "HANG_LA";

/** `action` của bản ghi mà `requirePermission` ghi khi từ chối. MỘT chỗ ở: câu `appendAuditEvent` dưới đây và dòng log đọc cùng hằng. */
const ACTION_TU_CHOI_QUYEN = "PERMISSION_DENIED";

/**
 * [S1.225 / khoản 189] BA DANH MỤC ĐÓNG CỦA DÒNG LOG — "tên thì được, giá trị thì không" nay là phép THUỘC-TẬP, không phải phép canh
 * hình dạng.
 *
 * Vì sao đổi, đo được (§S1.87, khoản 189): `HINH_DANG_LOAI_TAI_NGUYEN` nhận MỌI chuỗi hoa-số-gạch-dưới ≤ 64 bắt đầu bằng chữ cái, mà
 * đó chính là hình dạng của lớp bí mật kho NÀY tự sinh ra — bí mật TOTP base32 (`JBSWY3DPEHPK3PXP` khớp; `base32()` ở
 * `apps/api/src/routes/auth.ts` phát nó, bắt đầu bằng chữ cái 26/32 số lần), UUID viết hoa bỏ gạch nối, hex viết hoa — và biểu thức mã
 * quyền nhận `supplier.delete` dù không có mã ấy. Một tập đóng thì không: thứ không có TÊN trong danh mục ra `HANG_LA`, bất kể hình dạng
 * (đo ở `mo-ta-hang-dong.test.ts`: bốn chuỗi ấy đi lọt trên mã trước vòng này, nay ra `HANG_LA` ở cả bốn trường).
 *
 * Nội dung ba danh mục là thứ ĐO ĐƯỢC ở chỗ gọi, không phải thứ đoán, và phép đo đi HAI CHIỀU: `danh-muc-tu-choi.test.ts` đọc cây cú
 * pháp của mọi lời gọi `requirePermission`/`throwAuditedDenial` trong mã sản xuất (cộng bảng route của `apps/api`, nơi `resourceType` của
 * cổng quyền sống, và ba từ vựng vế: `UNSEAL_CLAUSES`, `UnsealExecutionClause`, `RFQ_STATUSES`) và đòi tập hằng ở đó BẰNG tập ở đây;
 * `mo-ta-hang-dong.test.ts` đòi mọi mã ở đây đi qua nguyên vẹn. Một lần từ chối mới mang mã mới ⇒ test đầu đỏ cho tới khi mã ấy được
 * khai ở đây — cái giá của một tập đóng, trả lúc viết mã chứ không lúc đọc log sau sự cố.
 *
 * Ranh giới, nói ra: đây là danh mục của DÒNG LOG. Đường vào SỔ vẫn canh `action`/`resourceType` theo hình dạng F7 (`requirePermission`
 * và ⑴ của `throwAuditedDenial`): từ vựng của sổ là mở theo thiết kế — mỗi gói khai hành động của nó, hôm nay hơn tám mươi mã — và
 * siết nó về một tập trong gói này là cái mà docstring của `HINH_DANG_LOAI_TAI_NGUYEN` đã tiên đoán *sẽ bị nới ra bằng phản xạ*; bán
 * kính của khoản 189 ở sổ bằng 0 (`action`/`resourceType` là hằng viết cứng ở mọi chỗ gọi, `permission` có kiểu union), còn dòng log là
 * nơi duy nhất một chuỗi của ba trường ấy đi ra NGOÀI CSDL.
 */
/** Hành động của các lần TỪ CHỐI: `PERMISSION_DENIED` của cổng quyền, và `action` ở mọi lời gọi `throwAuditedDenial`. */
export const DANH_MUC_HANH_DONG_TU_CHOI: ReadonlySet<string> = new Set([
  ACTION_TU_CHOI_QUYEN,
  "AGENT_SCOPE_DENIED",
  "COMPARISON_DENIED",
  // [S1.213 / khoản 133] "Không tìm thấy RFQ" ở hai đường đọc có cổng của bảng so sánh (`packages/unseal/src/comparison.ts`).
  "COMPARISON_NOT_FOUND_DENIED",
  "CONTROL_DENIED",
  "MFA_RESET_APPROVAL_DENIED",
  "RFQ_STATE_DENIED",
  "UNSEAL_APPROVAL_DENIED",
  "UNSEAL_CANCEL_DENIED",
  "UNSEAL_DENIED",
  // [S1.213 / khoản 133] Điều phối LẦN HAI khi lượt trước còn sống (`dieuPhoiLaiSauKhiChet`, `packages/unseal/src/requests.ts`).
  "UNSEAL_DISPATCH_DENIED",
  "UNSEAL_EXECUTION_DENIED",
  // [S1.213 / khoản 133] "Không tìm thấy yêu cầu mở thầu" ở huỷ và phê duyệt (`packages/unseal/src/requests.ts`).
  "UNSEAL_NOT_FOUND_DENIED",
]);
/** `resourceType` ở mọi lời gọi `requirePermission`/`throwAuditedDenial` và ở bảng route của `apps/api`. */
export const DANH_MUC_LOAI_TAI_NGUYEN: ReadonlySet<string> = new Set([
  // [S1.199 / S4.2b] Route ghi của dữ liệu nền (`apps/api/src/routes/du-lieu.ts`) — vào danh mục ở lần hợp master sau đợt 2.
  "CANONICAL_ITEM",
  "INVITATION",
  "MFA_RESET_REQUEST",
  "PROCUREMENT_CATEGORY",
  "PROCUREMENT_POLICY",
  "RFQ",
  // [S1.200 / khoản 258] Lần đọc ngân sách có cổng (`getRfqBudget`, `packages/rfq/src/procurement-policy.ts`).
  "RFQ_BUDGET",
  "RFQ_INVITATION",
  "SESSION",
  "SUPPLIER",
  "UNSEAL_REQUEST",
  // [S1.199 / S4.2b] Bí danh đơn vị của tổ chức (`apps/api/src/routes/du-lieu.ts`).
  "UOM_ALIAS",
  "USER",
]);
/**
 * [S1.225 / khoản 179] VẾ đã từ chối: bốn vế `UNSEAL_CLAUSES` của cổng mở thầu (`packages/unseal/src/gate.ts`), hai vế
 * `UnsealExecutionClause` của worker lúc giải mã (`apps/unseal-worker/src/index.ts`, tập con), và trạng thái RFQ `RFQ_STATUSES`
 * (`packages/rfq/src/rfq.ts`) mà lần từ chối A4 của bảng so sánh mang. ~~Gói này không import được ba nguồn ấy (chúng phụ thuộc gói này),~~
 * [S1.241 / khoản 279] Cộng hai từ vựng MÃ: mã chốt kiểm soát — tập khoá của `CHOT_VAO_SO` (`./chot-kiem-soat.ts`, `CONTROL_DENIED`) —
 * và mã từ chối trạng thái — tập khoá của `VAO_SO` (`packages/danh-gia/src/tu-choi-vao-so.ts`, `RFQ_STATE_DENIED`): hai đường ấy ghi
 * mười bảy / chín mã vào sổ dưới MỘT `action` mỗi đường, nên khi lần ghi gãy, dòng log không có vế thì không nói được chốt hay bước nào
 * (khoản 279). Cả mã `vaoSo: false` (không bao giờ tới dòng mất sổ) cũng ở đây — mười chín và mười bốn tên: nguồn là một tập, đo nó
 * nguyên vẹn rẻ hơn đo một hiệu.
 * [S1.245 / khoản 267] Cộng từ vựng thứ sáu: hai lý do từ chối huỷ yêu cầu mở thầu — kiểu hợp `LyDoTuChoiHuy`
 * (`packages/unseal/src/requests.ts`, `UNSEAL_CANCEL_DENIED`): từ vòng ấy một `action` mang hai lý do trên cùng route huỷ.
 * Tệp này không import được ~~năm~~ [S1.245] sáu nguồn ấy — ~~bốn~~ năm phụ thuộc gói này, và `chot-kiem-soat.ts` import
 * `throwAuditedDenial` từ đây nên chiều ngược là một vòng —, nên danh mục chép lại, và `danh-muc-tu-choi.test.ts` đòi bản chép bằng
 * nguồn (vế ⑷, đọc theo tên ở nguồn).
 * Danh mục là MỘT tập phẳng: nó canh "tên thì được, giá trị thì không", không canh "vế thuộc đúng từ vựng của `action`" — một vế của
 * từ vựng này đặt dưới `action` của từ vựng kia vẫn ra nguyên văn (một tên đã khai, không phải một giá trị).
 */
export const DANH_MUC_VE_CONG: ReadonlySet<string> = new Set([
  "PERMISSION",
  "MFA_FRESH",
  "RFQ_CLOSED",
  "POLICY_GATE",
  "DRAFT",
  "PENDING_APPROVAL",
  "OPEN",
  "CLOSED",
  "UNSEALED",
  "EVALUATING",
  "BAFO_OPEN",
  "BAFO_CLOSED",
  "BAFO_UNSEALED",
  "AWARDED",
  "CANCELLED",
  // [S1.241 / khoản 279] Mã chốt kiểm soát — `MaChotKiemSoat`, tập khoá của `CHOT_VAO_SO` (`./chot-kiem-soat.ts`).
  "BAC_LECH_HAM_PHAN_BAC",
  "D2_NGUOI_TAO_TU_DUYET",
  "D2_PHIEN_KHONG_HOP_LE",
  "D2_PHIEN_NGUOI_KHAC",
  "J3_NGUOI_DE_XUAT_TU_DUYET",
  "J3_NGUOI_DIEU_PHOI_DE_XUAT",
  "J3_NGUOI_TAO_DE_XUAT",
  "J3_PHIEN_DE_XUAT_DUYET",
  "J5_LUOT_CHAM_KHONG_MOI_NHAT",
  "K2_DAU_THAU_CHINH_THUC",
  "K2_THIEU_CANH_TRANH",
  "K3_KHONG_XOAY_VONG",
  "K4A_NGOAI_LE_SAI_TRANG_THAI",
  "K4A_THEM_SAI_TRANG_THAI",
  "K4A_THU_HOI_SAI_TRANG_THAI",
  "K8A_NGUOI_MOI_XAC_MINH",
  "K8A_NGUOI_TAO_TU_XAC_MINH",
  "K5_THIEU_CHU_KY_DOC_LAP",
  "L14_PHIEN_BAN_KHONG_GHIM",
  "NGAN_SACH_GHIM_BAN_CU",
  "K10A_TAC_GIA_CHINH_SACH",
  "K10A_TU_GHI_NHAN",
  "THIEU_NGAN_SACH",
  "THIEU_NHOM_HANG",
  "TIN_HIEU_CHUA_GHI_NHAN",
  // [S1.241 / khoản 279] Mã từ chối trạng thái — `MaTuChoiTrangThai`, tập khoá của `VAO_SO` (`packages/danh-gia/src/tu-choi-vao-so.ts`).
  "CHINH_SACH_CHUA_KHAI_TRONG_SO",
  "CHINH_SACH_TAT_BAFO",
  "CHUA_CHAM_LAN_NAO",
  "DE_XUAT_DA_CO_CHU_KY",
  "KHONG_CO_AWARD_CON_SONG",
  "KHONG_CO_BAO_GIA_DOC_DUOC",
  "KHONG_CO_DE_XUAT_DANG_CHO",
  "KHONG_CO_VONG_DANG_MO",
  "KHONG_PHAI_NGUOI_DE_XUAT",
  "LECH_TIEN_TE",
  "RFQ_KHONG_CHAM_DUOC",
  "RFQ_KHONG_DE_XUAT_DUOC",
  "RFQ_KHONG_MO_VONG_DUOC",
  "THANH_PHAN_CHUA_CO_NGUON",
  // [S1.245 / khoản 267] Lý do từ chối huỷ yêu cầu mở thầu — `LyDoTuChoiHuy` (`packages/unseal/src/requests.ts`, `UNSEAL_CANCEL_DENIED`).
  "KHONG_O_TRANG_THAI_HUY_DUOC",
  "KHONG_PHAI_NGUOI_YEU_CAU_VA_KHONG_DUYET_DUOC",
]);
/** Mã quyền ra dòng log phải là một giá trị của `PERMISSIONS` — danh mục đã có meta-test đối chiếu với bảng `permissions` của `005`. */
const MA_QUYEN: ReadonlySet<string> = new Set(Object.values(PERMISSIONS));

/** Phép thuộc-tập: `v` có tên trong `danhMuc` thì đi qua nguyên vẹn, không thì `HANG_LA`. */
function hangMaHoa(v: string, danhMuc: ReadonlySet<string>): string {
  return danhMuc.has(v) ? v : HANG_LA;
}

function hangMaQuyen(v: string): string {
  return hangMaHoa(v, MA_QUYEN);
}

/**
 * [S1.216 / khoản 177 / ADR-127] Băm rút gọn của một `userId` cho dòng log của lần từ chối MẤT SỔ: 12 ký tự hex đầu của
 * sha256(userId), không khoá, không muối — ADR-127 khai đúng phép này để người điều tra tính lại được từ id trong `users` (đó
 * là toàn bộ giá trị của nó: NỐI các dòng của cùng một người, và đối chiếu được khi cần), trong khi một dòng đơn lẻ không nêu ai.
 * 48 bit: đủ để ba người trong một sự cố không trùng nhau, không đủ để ai coi nó là một định danh. Tính ở chỗ đã có `userId`
 * trong tay — `requirePermission` (`requirement.userId`) và `throwAuditedDenial` (`event.actorId`) — không ở lớp lỗi, để một
 * lớp lỗi dựng từ nơi khác không tự băm một thứ không phải `userId`.
 */
function bamNguoiRutGon(userId: string): string {
  return createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 12);
}

/**
 * Hình dạng của khe `nguoi=` — đúng 12 hex thường. Đây là ranh giới của ngoại lệ ADR-127 với A2: một UUID thô (36 ký tự, có
 * gạch nối), một băm đầy đủ (64 hex), một băm viết hoa, một email, một bí mật base32 — không thứ nào khớp, và ra `HANG_LA` như
 * mọi trường khác. Không có khe thứ hai.
 */
const HINH_DANG_BAM_NGUOI = /^[0-9a-f]{12}$/u;

function hangBamNguoi(v: string): string {
  return HINH_DANG_BAM_NGUOI.test(v) ? v : HANG_LA;
}

/** Nối khe `nguoi=` vào phần hằng — chỉ khi lớp lỗi mang băm; không băm thì dòng y như trước vòng này. */
function noiNguoi(hang: string, nguoiBam: string | null): string {
  return nguoiBam === null ? hang : `${hang} nguoi=${hangBamNguoi(nguoiBam)}`;
}

/**
 * [S1.85 / khoản 131] CÁC HẰNG ĐÓNG CỦA MỘT LẦN TỪ CHỐI KHÔNG GHI ĐƯỢC SỔ — cho dòng log, và CHỈ hằng.
 *
 * VÌ SAO NÓ TỒN TẠI, đo được (§S1.85): khoá ghi sổ của một tổ chức bị giữ quá trần 2 s của `050` ⇒ mọi lần từ chối của tổ chức ấy
 * gãy `55P03`, và tới trước vòng này bộ điều phối để lại đúng một dòng
 * `[api] <requestId> PermissionAuditFailedError <- error 55P03` — không `action`, không mã quyền, không `resourceType`, không mẫu
 * route. Sau sự cố không nguồn nào còn cho biết lần từ chối NÀO đã mất (khoản 131, ghi từ S1.72).
 *
 * "TÊN THÌ ĐƯỢC, GIÁ TRỊ THÌ KHÔNG" LÀ MỘT PHÉP KIỂM, KHÔNG PHẢI MỘT LỜI HỨA. ~~Mỗi trường đi qua hình dạng của chính nó — mã định~~
 * ~~danh viết hoa cho `action`/`resourceType`, khuôn chấm chữ thường cho mã quyền — và thứ không khớp ra `HANG_LA`.~~ [S1.225 / khoản 189]
 * Mỗi trường đi qua DANH MỤC ĐÓNG của chính nó — `DANH_MUC_HANH_DONG_TU_CHOI`, `DANH_MUC_LOAI_TAI_NGUYEN`, `PERMISSIONS`, và
 * `DANH_MUC_VE_CONG` cho vế — và thứ không có tên trong danh mục ra `HANG_LA`. Nên kể cả khi một vòng sau đưa nhầm một giá trị (id,
 * email, giá, bí mật) vào một trong các trường ấy, nó KHÔNG ra được dòng log: ~~một UUID có dấu gạch nối, một email có `@`, một số bắt~~
 * ~~đầu bằng chữ số — cả ba trượt cả hai hình dạng.~~ không giá trị nào là một tên đã khai.
 *
 * [S1.87 / lượt soi ngang 74 góc 2 — ĐO] RANH GIỚI CỦA PHÉP KIỂM ~~ẤY~~ CŨ, VÀ CÂU CŨ RỘNG HƠN THỨ NÓ LÀM ĐƯỢC.
 * ~~cả ba trượt cả hai hình dạng — nên một giá trị KHÔNG ra được dòng log~~ đúng cho ĐÚNG BA ví dụ ấy, không đúng cho mọi giá trị.
 * `HINH_DANG_LOAI_TAI_NGUYEN` nhận MỌI chuỗi hoa-số-gạch-dưới dài ≤ 64 bắt đầu bằng chữ cái, mà đó chính là hình dạng của lớp bí
 * mật kho NÀY tự sinh ra: `base32()` ở `apps/api/src/routes/auth.ts` phát bí mật TOTP theo RFC 4648 (A–Z2–7), và một bí mật bắt đầu
 * bằng chữ cái — 26/32 số lần — KHỚP (đo: `JBSWY3DPEHPK3PXP` khớp; một UUID viết hoa đã bỏ gạch nối cũng khớp). Nên phát biểu đúng
 * mức: ~~đây là~~ phép canh hình dạng là CHẶN CẤU TRÚC chống nội suy văn xuôi/id/email/số, KHÔNG phải một bộ lọc bí mật. Hôm nay không
 * đường sản xuất nào đưa một bí mật vào ba trường ấy (`action`/`resourceType` là hằng viết cứng, `permission` có kiểu union), nên bán
 * kính bằng 0 — và đó là lý do đây là một lời khai được thu hẹp chứ không phải một lỗ. ~~Muốn giữ lời hứa rộng thì phải kiểm theo TẬP~~
 * ~~ĐÓNG chứ không theo hình dạng: khoản 189.~~ [S1.225 / khoản 189] Nay kiểm theo tập đóng — xem ba danh mục ở trên; đo ở
 * `mo-ta-hang-dong.test.ts` (`JBSWY3DPEHPK3PXP`, UUID viết hoa bỏ gạch nối, hex viết hoa, `supplier.delete` đều ra `HANG_LA`).
 *
 * [S1.225 / khoản 179] HẰNG THỨ BA CỦA `DenialAuditFailedError` — VẾ ĐÃ TỪ CHỐI. Tới trước vòng này nhánh ấy chỉ in `action` và
 * `resourceType`, mà ba đường từ chối của cổng mở thầu ghi cùng `UNSEAL_DENIED UNSEAL_REQUEST` (đo §S1.87: khoá ghi sổ bị giữ ⇒ dòng
 * `… UNSEAL_DENIED UNSEAL_REQUEST <- error 55P03`, không nói vế nào), và hàng sổ mang `clause` chính là hàng không ghi được. Nay in
 * thêm `clause` khi người gọi `throwAuditedDenial` truyền nó — qua `DANH_MUC_VE_CONG`; không truyền thì hai hằng như trước.
 * [S1.241 / khoản 279] Hai đường nữa truyền vế: chốt kiểm soát (`… CONTROL_DENIED RFQ THIEU_NGAN_SACH …`) và từ chối trạng thái
 * (`… RFQ_STATE_DENIED RFQ RFQ_KHONG_CHAM_DUOC …`) — đo ở `chot-kiem-soat.test.ts` và `packages/danh-gia/src/tu-choi-vao-so.test.ts`.
 * [S1.245 / khoản 267] Và huỷ yêu cầu mở thầu (`… UNSEAL_CANCEL_DENIED UNSEAL_REQUEST KHONG_O_TRANG_THAI_HUY_DUOC …` khác
 * `… KHONG_PHAI_NGUOI_YEU_CAU_VA_KHONG_DUYET_DUOC …`) — đo ở `packages/unseal/src/unseal.int.test.ts`, khối `[S1.245 / khoản 266 · 267]`.
 *
 * [S1.216 / khoản 177 / ADR-127] KHE THỨ NĂM, CÓ HÌNH DẠNG — AI BỊ TỪ CHỐI. §S1.85 để ngỏ (*"ghi id người dùng hay không là một
 * quyết định A2 riêng"*), và chủ dự án chọn ⒞ ngày 2026-09-30: dòng của lần MẤT SỔ mang `nguoi=<băm rút gọn của userId>` — không
 * phải mọi dòng, và không phải `userId`. Vì sao ở đúng dòng này: mọi ca khác lấy danh tính từ sổ, còn ca này được định nghĩa bởi
 * việc hàng sổ ấy không ghi được; sau một sự cố khoá ghi sổ kéo dài, không có nó người vận hành biết route nào bị từ chối mà không
 * biết bao nhiêu người, và không nguồn nào bù. Vì sao băm chứ không id: các dòng của cùng một người NỐI được với nhau (đo:
 * `apps/api/src/log-tu-choi-mat.int.test.ts` — ba người, ba băm khác nhau, dựng lại từ stderr một mình), còn một dòng đơn lẻ
 * không nêu ai; và khe chỉ nhận `^[0-9a-f]{12}$` (`hangBamNguoi`), nên đây là một TOKEN hình dạng cố định như mọi hằng khác trên
 * dòng, không phải một giá trị người dùng — đó là ranh giới mà `apps/api/src/mo-ta-loi.ts` ghi và ADR-127 khai. Không băm
 * (`null`) ⇒ dòng như trước; lần từ chối của SERVICE (worker) không có `actorId` nên không có khe này.
 *
 * Cùng kỷ luật A2 với `moTaLoiKhongGiaTri` ở
 * `apps/api/src/mo-ta-loi.ts`, và hàm này là nguồn DUY NHẤT của phần hằng ấy: `apps/api` và `apps/unseal-worker` đều gọi nó, nên hai
 * tiến trình không lệch nhau được.
 *
 * `instanceof` chứ không phải đọc theo tên trường, có chủ đích: một lỗi BẤT KỲ mang một trường tên `permission` không mua được chỗ
 * trong dòng log. Lỗi khác ⇒ chuỗi rỗng, người gọi không nối gì thêm.
 */
export function moTaHangDongCuaLanTuChoi(loi: unknown): string {
  if (loi instanceof PermissionAuditFailedError) {
    return noiNguoi(
      `${ACTION_TU_CHOI_QUYEN} ${hangMaHoa(loi.resourceType, DANH_MUC_LOAI_TAI_NGUYEN)} ${hangMaQuyen(loi.denial.permission)}`,
      loi.nguoiBam,
    );
  }
  if (loi instanceof DenialAuditFailedError) {
    const haiHang = `${hangMaHoa(loi.action, DANH_MUC_HANH_DONG_TU_CHOI)} ${hangMaHoa(loi.resourceType, DANH_MUC_LOAI_TAI_NGUYEN)}`;
    return noiNguoi(loi.clause === null ? haiHang : `${haiHang} ${hangMaHoa(loi.clause, DANH_MUC_VE_CONG)}`, loi.nguoiBam);
  }
  return "";
}

/**
 * Câu hỏi mà `requirePermission` phải trả lời TRƯỚC khi thử ghi: phiên NGƯỜI GỌI có đang giữ
 * khoá tư vấn ghi sổ của chính tổ chức này không?
 *
 * Nếu có, việc ghi audit ở một PHIÊN KHÁC sẽ chờ tới khi transaction người gọi kết thúc — mà
 * transaction đó lại đang chờ chính lời gọi này. Đã đo trên PostgreSQL 16.15:
 *   ĐO-5a  phiên người gọi vừa ghi một sự kiện -> giữ ĐÚNG 1 khoá tư vấn, khoá
 *          523703854382776997 = hashtextextended(org::text, 0)
 *   ĐO-5b  phiên độc lập ghi audit CÙNG tổ chức -> KẸT 3005 ms rồi
 *          "canceling statement due to lock timeout"
 *   ĐO-6a  phiên người gọi CHƯA ghi audit -> giữ 0 khoá tư vấn (không dương tính giả)
 *
 * Vế này KHÔNG đổi kết cục — nó biến một lần treo dài bằng `lock_timeout` (mặc định 15 giây,
 * xem packages/db/src/pool.ts) thành một lỗi TỨC THÌ có chẩn đoán chính xác. Hợp đồng mà nó
 * cưỡng chế: gọi `requirePermission` TRƯỚC mọi lần ghi sổ trong cùng một transaction.
 * [S1.71 / khoản 123, lượt soi 65a-11] Lần treo ấy nay tối đa 2 s ở mọi pool — trần `lock_timeout` trên chính `noi_chuoi_kiem_toan()`
 * (050) — rồi gãy 55P03; vế này vẫn cho chẩn đoán đúng NGAY (test rbac đòi thông điệp của vế và dưới 1 s).
 *
 * Khoá được so theo (classid, objid) tách rời thay vì dựng lại số 64 bit: `classid::int8 << 32`
 * TRÀN với mọi khoá có bit cao bằng 1 (một nửa không gian băm), và một lỗi "bigint out of
 * range" ở đây sẽ biến vế phòng thủ thành vế gây sự cố.
 */
const CAU_KHOA_TU_VAN =
  `SELECT EXISTS (
     SELECT 1
       FROM pg_catalog.pg_locks l
      WHERE l.locktype OPERATOR(pg_catalog.=) 'advisory'
        AND l.pid OPERATOR(pg_catalog.=) pg_catalog.pg_backend_pid()
        AND l.granted
        AND l.classid OPERATOR(pg_catalog.=) ((pg_catalog.hashtextextended($1::pg_catalog.text, 0)
                            OPERATOR(pg_catalog.>>) 32)
                          OPERATOR(pg_catalog.&) 4294967295)::pg_catalog.oid
        AND l.objid OPERATOR(pg_catalog.=) (pg_catalog.hashtextextended($1::pg_catalog.text, 0)
                          OPERATOR(pg_catalog.&) 4294967295)::pg_catalog.oid
   ) AS dang_giu`;

/**
 * [S1.69 / khoản 120] Trần chờ lấy kết nối `auditPool` cho MỌI lần ghi sổ từ chối — `requirePermission` và `throwAuditedDenial`.
 *
 * Thay cho phép chụp "pool còn chỗ" tức thì của `khangDinhGhiDuocDocLap`. Đo trên b8d38c7 (biên bản §S1.69), `auditPool` 2 kết nối như sản
 * xuất trước vòng này: phép chụp làm lần từ chối gãy NGAY khi pool đầy tạm thời — giữ 2/2 kết nối trong 300 ms ⇒ `PermissionAuditFailedError`
 * sau 16 ms, không hàng sổ; 10 lần từ chối song song mất 5 bản ghi; khoá tư vấn ghi sổ của một tổ chức ghim cả hai kết nối ⇒ lần từ chối
 * của tổ chức KHÁC gãy sau 15 ms. Trong khi đó 100 lần ghi sổ xếp hàng trên cùng pool xả hết trong 177 ms.
 *
 * Vì sao 5 giây: gấp khoảng 28 lần thời gian xả đo được của 100 lần ghi xếp hàng, nên pool đầy ~~tạm thời~~ DƯỚI 5 s không còn làm mất bản
 * ghi — lần ghi đã có kết nối vẫn chờ khoá tư vấn tới ~~`lock_timeout`/`statement_timeout`~~ [S1.72 / lượt soi ngang 66c-1] trần 2 s của 050
 * (lượt soi 63a-6); và NGẮN
 * hơn `connectionTimeoutMillis` 20 s của `createPool`, nên thứ người trực đọc là lỗi có tên của trần — `TenantError` CONNECT_WAIT_EXCEEDED —
 * chứ không phải `Error` không tên của pg-pool (đo: 20006 ms, "timeout exceeded when trying to connect"). Ca cấu hình sai mà phép chụp
 * sinh ra để bắt — `auditPool` trùng pool đang giữ giao dịch người gọi — vẫn gãy ồn ào: sau 5 s thay vì 17 ms, và không treo trên pool
 * không đặt hạn.
 *
 * Nói ra: khi `auditPool` không có chỗ, lần ghi giữ giao dịch và kết nối nghiệp vụ của người gọi tới 5 s. Ở `apps/api`, `auditPool` có cỡ
 * bằng pool nghiệp vụ (composition.ts), nên nhu cầu đồng thời của tiến trình ấy không vượt cỡ của nó (đọc; một ca đo ở
 * composition.int.test.ts). [lượt soi 63a-2, 63b-3] Và khi khoá tư vấn ghi sổ của MỘT tổ chức bị giữ lâu, mỗi lần từ chối của tổ chức ấy giữ
 * kết nối nghiệp vụ của nó tới `statement_timeout` 15 s. Đo lặp ba lượt trên tiến trình thật với `TRUSTPROCURE_DB_POOL_MAX` 3, `/me` của
 * tổ chức khác gửi 1 s sau yêu cầu cuối (biên bản §S1.69): ba lần từ chối tới tuần tự ⇒ `/me` đứng 13 620–13 647 ms, mã trước khoản 120
 * 16–17 ms; tới cùng lúc ⇒ 13 999–14 016 ms, mã trước khoản 120 14 002–14 018 ms; ba lần GHI hợp lệ ⇒ khoảng 14 s ở cả hai bản. Chủ dự án
 * chọn giữ cỡ này ngày 2026-09-13 — khoản 123, 124. [S1.71 / khoản 123] Lần chờ khoá ghi sổ ấy nay tối đa 2 s (050, trần trên
 * `noi_chuoi_kiem_toan()`): lần từ chối gãy 55P03 thay vì giữ kết nối tới 15 s — ADR-016 tiểu mục [S1.71 / khoản 123].
 */
const TRAN_CHO_KET_NOI_AUDIT_MS = 5_000;

/**
 * [vòng fix 1 — F9] Những pool đã được kiểm QUYỀN rồi — mỗi pool đúng một lần cho cả vòng đời
 * tiến trình.
 *
 * Vì sao có bộ nhớ đệm thay vì kiểm mỗi lần: `current_user` của một pool là hằng số theo tiến
 * trình (createPool không đổi role giữa chừng), nên kiểm lại ở MỖI lần từ chối là một round
 * trip mua đúng 0 thông tin mới trên một đường đi vốn đã ba round trip. WeakSet để pool bị thu
 * hồi không giữ lại tham chiếu.
 */
const poolDaKiemQuyen = new WeakSet<pg.Pool>();

/**
 * [vòng fix 1 — F9] `auditPool` phải là pool ỨNG DỤNG, không phải một pool mạnh hơn.
 *
 * Trước bản vá này, `auditPool` chỉ bị canh về TÍNH ĐỘC LẬP (còn chỗ không, có đang giữ khoá
 * không) chứ KHÔNG canh gì về QUYỀN: đo được, một pool SUPERUSER được nhận IM LẶNG. Hậu quả
 * không phải là leo thang trực tiếp — nó là mất một lớp: một kết nối superuser BỎ QUA RLS và
 * FORCE RLS, nên vế `WITH CHECK (org_id = app_current_org_id())` trên `audit_events` — thứ
 * ngăn một bản ghi bị ghi sang tổ chức khác — không còn cưỡng chế gì trên đúng đường ghi sổ.
 *
 * Ném chứ không WARNING: một pool sai quyền là lỗi CẤU HÌNH của người gọi, phát hiện ở lần từ
 * chối đầu tiên, và fail-closed ở đây vẫn giữ nguyên kết cục an toàn (thao tác không được phép
 * trong cả hai nhánh — xem `PermissionAuditFailedError`).
 *
 * [S1.11 / review H3-1] GIỚI HẠN, viết ra: phép kiểm này đọc `CURRENT_USER` — danh tính SAU
 * `SET ROLE`. Một pool có vai (`createPool(..., { role: "app_api" })`) luôn cho `app_api` ở đây,
 * kể cả khi PHIÊN đăng nhập là superuser (superuser `SET ROLE` sang bất kỳ role nào). Danh tính
 * phiên (`session_user`) do composition root chứng minh lúc khởi động —
 * `khangDinhPhienDangNhapUngDung` ở `@trustprocure/db` — không phải ở đây, vì `poolAs` của
 * test-support cố ý đăng nhập bằng superuser rồi `SET ROLE`.
 *
 * [S1.69 / khoản 120] Câu kiểm chạy trên `client` — CHÍNH kết nối mà lần ghi sổ đã lấy có trần — chứ không qua `auditPool.query()`: câu ấy
 * lấy một kết nối KHÔNG trần, nên ở lần đầu của một pool (chưa có bộ nhớ đệm) trên pool đã cạn nó chờ tới `connectionTimeoutMillis` hay
 * không bao giờ. Kết cục của lớp canh không đổi: vai bỏ qua RLS ⇒ ném trước khi ghi, giao dịch của lần ghi ROLLBACK.
 */
async function khangDinhAuditPoolDungQuyen(auditPool: pg.Pool, client: pg.PoolClient): Promise<void> {
  if (poolDaKiemQuyen.has(auditPool)) return;

  const { rows } = await client.query<{
    ten: string;
    sieu_nguoi_dung: boolean;
    bo_qua_rls: boolean;
  }>(
    // `CURRENT_USER` viết TRẦN là bắt buộc: nó là TỪ KHOÁ SQL, không phải một hàm trong
    // `pg_catalog`, nên `pg_catalog.current_user` bị phân giải thành một BẢNG và cho lỗi
    // "missing FROM-clause entry for table pg_catalog" (đã tự vấp phải khi viết bản đầu). Vì là
    // từ khoá, nó KHÔNG cướp được bằng search_path — đúng lý do quy ước QT3 không áp cho nó.
    `SELECT r.rolname AS ten, r.rolsuper AS sieu_nguoi_dung, r.rolbypassrls AS bo_qua_rls
       FROM pg_catalog.pg_roles r
      WHERE r.rolname OPERATOR(pg_catalog.=) CURRENT_USER`,
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new Error("không đọc được current_user của auditPool để kiểm quyền.");
  }
  if (hang.sieu_nguoi_dung || hang.bo_qua_rls) {
    throw new Error(
      `auditPool đang chạy dưới role "${hang.ten}" có ` +
        `${hang.sieu_nguoi_dung ? "SUPERUSER" : "BYPASSRLS"} — role đó BỎ QUA RLS, nên vế ` +
        "WITH CHECK trên audit_events không còn cưỡng chế được việc bản ghi thuộc đúng tổ " +
        "chức. Dùng pool của role ứng dụng (app_api).",
    );
  }
  poolDaKiemQuyen.add(auditPool);
}

async function khangDinhGhiDuocDocLap(client: pg.PoolClient, orgId: string): Promise<void> {
  // ~~Pool cạn kiệt: `pool.connect()` KHÔNG có timeout mặc định, nên `withTenant` trên một pool
  // hết chỗ treo VĨNH VIỄN. Đây đúng là lớp lỗi [fix I4] mà migrate() đã vấp ("với pool max: 1
  // ... migrate() treo VĨNH VIỄN, không timeout"). Phép đo có tính đua, và nó đua theo hướng
  // AN TOÀN: dương tính giả chỉ đổi một lần từ chối thành một lỗi ồn ào (vẫn fail-closed), âm
  // tính giả rơi lại đúng hành vi cũ.~~
  // [S1.69 / khoản 120] Phép chụp "pool còn chỗ" tức thì đã gỡ. Câu "dương tính giả CHỈ đổi một lần từ chối thành một lỗi ồn ào" sai ở chữ
  // CHỈ: lỗi ồn ào ấy là một lần từ chối không vào sổ, trong khi chờ vài chục mili-giây thì ghi được — đo trên b8d38c7: 10 lần từ chối song
  // song trên `auditPool` 2 kết nối mất 5 bản ghi; khoá tư vấn của một tổ chức ghim cả hai kết nối làm lần từ chối của tổ chức khác gãy sau
  // 15 ms. Lỗ [fix I4] nay đóng bằng trần của chính lần lấy kết nối — `TRAN_CHO_KET_NOI_AUDIT_MS`.
  const { rows } = await client.query<{ dang_giu: boolean }>(CAU_KHOA_TU_VAN, [orgId]);
  if (rows[0]?.dang_giu === true) {
    throw new Error(
      "transaction của người gọi ĐANG GIỮ khoá tư vấn ghi sổ của tổ chức này, nên một " +
        "transaction độc lập không ghi audit được (đã đo: kẹt tới khi lock_timeout huỷ câu " +
        "lệnh). Gọi requirePermission() TRƯỚC mọi lần ghi sổ trong cùng transaction.",
    );
  }
}

/**
 * [S1.184 / khoản 248 / ADR-112] Trần lần từ chối theo phiên cho lần từ chối do HANDLER ghi — bối cảnh của MỘT yêu cầu.
 *
 * ADR-092 đếm lần từ chối ở BỘ ĐIỀU PHỐI và để ngoài phạm vi mọi lần từ chối mà handler tự ghi: `requirePermission` gọi từ một gói,
 * `throwAuditedDenial` của cổng mở thầu, bảng so sánh, và mọi `CONTROL_DENIED` (khoản 247). Một phiên lặp một thao tác bị từ chối
 * như thế nối đuôi khoá chuỗi sổ của cả tổ chức mà không trần nào chặn — khoản 248. Chủ dự án chọn phạm vi *mọi lần từ chối ở handler*
 * và cơ chế *bối cảnh yêu cầu*: bộ điều phối đặt `dem` quanh lời gọi handler, và hai đường ghi sổ từ chối của tệp này đọc nó —
 * không hàm gói nào đổi chữ ký, và một lần từ chối mới viết ngày mai tự được đếm.
 *
 * `dem` chạy trên một kết nối của `auditPool`, ở giao dịch RIÊNG commit TRƯỚC lần ghi sổ: lần ghi hỏng vẫn tiêu ngân sách (vế ⒣ của
 * ADR-092), và lần vượt trần ném trước khi chạm khoá chuỗi sổ. Lỗi của nó đi ra NGUYÊN DẠNG, không bọc `…AuditFailedError`: nó không
 * phải một lần ghi sổ hỏng mà là quyết định rằng lần từ chối này không được ghi — cùng hợp đồng với móc `truocKhiGhiTuChoi`. Không
 * bối cảnh — worker, job, test gọi gói trực tiếp — thì không đếm gì, y như trước.
 *
 * Chỗ ĐẶT bối cảnh bị giam ở `apps/api/src/dispatch.ts` (`tests/architecture/ghi-so-tu-choi-mot-duong.test.ts`): nó là cách thứ hai để
 * một lần từ chối không vào sổ, cùng loại với móc của ADR-092.
 */
export interface BoiCanhTranTuChoi {
  /** Đếm một lần từ chối của phiên đang gọi trên `c`; vượt trần thì ném. */
  readonly dem: (c: pg.PoolClient) => Promise<void>;
}

const khoTranTuChoi = new AsyncLocalStorage<BoiCanhTranTuChoi>();

/** Chạy `viec` — lời gọi handler của một yêu cầu — với bối cảnh trần từ chối của phiên đang gọi. Chỉ bộ điều phối gọi. */
export function chayVoiTranTuChoi<T>(boiCanh: BoiCanhTranTuChoi, viec: () => Promise<T>): Promise<T> {
  return khoTranTuChoi.run(boiCanh, viec);
}

/** Đếm theo bối cảnh của yêu cầu đang chạy, ở giao dịch riêng trên `auditPool`; không bối cảnh thì không làm gì. */
async function demTheoBoiCanh(auditPool: pg.Pool, orgId: string): Promise<void> {
  const boiCanh = khoTranTuChoi.getStore();
  if (boiCanh === undefined) return;
  await withTenant(auditPool, orgId, (c) => boiCanh.dem(c), { maxConnectWaitMs: TRAN_CHO_KET_NOI_AUDIT_MS });
}

/**
 * [S1.155 / khoản 122 · 144 / ADR-092] Tuỳ chọn của `requirePermission`. `truocKhiGhiTuChoi` chạy đúng một lần, chỉ trên đường
 * TỪ CHỐI, trước lần ghi `PERMISSION_DENIED`; nó ném thì lần từ chối KHÔNG được ghi sổ và lỗi của nó đi ra nguyên dạng.
 */
export interface TuyChonCongQuyen {
  readonly truocKhiGhiTuChoi?: () => Promise<void>;
}

/**
 * Ném `PermissionDeniedError` khi thiếu quyền, và ghi bản ghi kiểm toán của lần từ chối đó
 * trong một TRANSACTION ĐỘC LẬP trước khi ném (bất biến **D5**).
 *
 * ============================================================================
 * VÌ SAO `auditPool` LÀ THAM SỐ BẮT BUỘC — LỆCH KHỎI BRIEF, CÓ ĐO
 * ============================================================================
 * Brief ghi audit bằng chính `client` của người gọi. Đo trên PostgreSQL 16.15:
 *   ĐO-2  ghi sổ trong transaction người gọi -> trong transaction: 1 bản ghi
 *         -> sau ROLLBACK của người gọi:        0 bản ghi
 * Và đó KHÔNG phải ca hiếm, nó là ĐƯỜNG CHÍNH: `requirePermission` NÉM, `withTenant` bắt lỗi
 * lan ra và ROLLBACK. Nghĩa là với thiết kế của brief, bản ghi kiểm toán của MỌI lần từ chối
 * biến mất — kể cả chính test "[INV-D5]" trong brief cũng không thể xanh.
 * Một audit chỉ tồn tại khi transaction người gọi commit KHÔNG thoả D5 như phát biểu.
 *   ĐO-6  ghi ở transaction ĐỘC LẬP (7 ms) rồi người gọi ROLLBACK -> 1 bản ghi CÒN NGUYÊN.
 *
 * PHẦN THƯỞNG THỨ HAI, đóng luôn cạm bẫy khoá tư vấn: `noi_chuoi_kiem_toan()` mở đầu bằng
 * `pg_advisory_xact_lock(hashtextextended(org_id, 0))` — PHẠM VI TRANSACTION. Ghi trong
 * transaction người gọi có nghĩa là mỗi lần TỪ CHỐI QUYỀN giữ khoá ghi sổ của cả tổ chức tới
 * KHI TRANSACTION NGHIỆP VỤ KẾT THÚC. Đã đo:
 *   ĐO-3  transaction giữ khoá -> nạn nhân cùng tổ chức kẹt 3004 ms rồi lock timeout
 *   ĐO-4  20 transaction NGẮN song song cùng tổ chức -> 52 ms, ghi đủ 20
 * Nên phí tổn thật của D5 không phải "một lần lấy khoá" mà là "khoá bị giữ bao lâu". Ghi ở
 * transaction riêng đưa nó về đúng chi phí của một lần ghi sổ bình thường (ĐO-4).
 *
 * ĐIỀU NÀY KHÔNG MUA ĐƯỢC, nói ra thay vì hứa suông: một kẻ gọi API sai quyền liên tục vẫn nối
 * tiếp hoá việc ghi sổ của tổ chức đó, vì mỗi lần từ chối vẫn là một lần lấy khoá. Cái nó mua
 * là bỏ đi bậc tự do NGUY HIỂM (giữ khoá suốt một transaction nghiệp vụ dài). Hạn mức theo
 * người gọi thuộc tầng API, không thuộc S0 — ~~ghi vào sổ nợ~~ [S1.69] khoản 122.
 *
 * `auditPool` PHẢI là pool riêng — ~~xem `khangDinhGhiDuocDocLap`~~ [S1.69 / khoản 120] pool trùng với pool đang giữ giao dịch người gọi
 * gãy ở trần chờ, xem `TRAN_CHO_KET_NOI_AUDIT_MS`.
 */
export async function requirePermission(
  client: pg.PoolClient,
  requirement: PermissionRequirement,
  auditPool: pg.Pool,
  tuyChon: TuyChonCongQuyen = {},
): Promise<void> {
  // [vòng fix 1 — F7] Kiểm hình dạng TRƯỚC cả phép kiểm quyền, và ném thẳng chứ không bọc
  // trong PermissionAuditFailedError: đây là lỗi của NGƯỜI GỌI, không phải một lần từ chối
  // không ghi sổ được, nên nó không được rơi vào nhánh `catch (PermissionDeniedError) -> 403`.
  // Đặt trước để một lời gọi sai hình dạng gãy ở CẢ đường cho qua lẫn đường từ chối — nếu chỉ
  // kiểm ở nhánh từ chối, lỗi chỉ lộ ra khi có người thiếu quyền.
  if (!HINH_DANG_LOAI_TAI_NGUYEN.test(requirement.resourceType)) {
    throw new Error(
      "resourceType phải là MÃ ĐỊNH DANH viết hoa (^[A-Z][A-Z0-9_]{0,63}$) vì nó đi thẳng vào " +
        "cột resource_type của sổ kiểm toán bất biến và nằm vĩnh viễn trong chuỗi băm. " +
        "Cố ý KHÔNG nội suy giá trị nhận được vào thông báo này: nó có thể chính là thứ không " +
        "được phép ghi ra (giá, mã OTP, token).",
    );
  }

  if (await hasPermission(client, requirement)) return;

  const tuChoi = new PermissionDeniedError(requirement.userId, requirement.permission);

  // [S1.155 / khoản 122 · 144 / ADR-092] Móc của người gọi, chạy SAU phép kiểm quyền và TRƯỚC lần ghi sổ — chỗ duy nhất biết
  // "lần này là một lần TỪ CHỐI" mà chưa chạm khoá chuỗi sổ. Lỗi của nó đi ra TRẦN (không bọc `PermissionAuditFailedError`): nó
  // không phải một lần ghi sổ hỏng mà là quyết định của người gọi rằng lần từ chối này không được ghi — hôm nay là trần theo phiên
  // của bộ điều phối (429). ~~Không móc ⇒ hành vi y như trước.~~
  // [S1.184 / khoản 248] Không móc ⇒ bối cảnh trần của yêu cầu, nếu có: lần gọi từ HANDLER — lời
  // gọi của bộ điều phối luôn mang móc, và bối cảnh chỉ bao lời gọi handler, nên một lần từ chối không bị đếm hai lần.
  if (tuyChon.truocKhiGhiTuChoi !== undefined) await tuyChon.truocKhiGhiTuChoi();
  else await demTheoBoiCanh(auditPool, requirement.orgId);

  try {
    // ~~THỨ TỰ HAI DÒNG NÀY LÀ LOAD-BEARING, và bản đầu viết ngược. `khangDinhAuditPoolDungQuyen`
    // chạy một `auditPool.query()`, mà `pool.connect()` KHÔNG có timeout mặc định — nên trên
    // một auditPool ĐÃ CẠN nó treo VĨNH VIỄN, tức nó biến chính lỗ [fix I4] mà
    // `khangDinhGhiDuocDocLap` sinh ra để đóng thành lỗ của riêng nó. Tự bắt được bằng hai test
    // hồi quy có sẵn ("auditPool hết chỗ..." và "PermissionAuditFailedError giữ nguyên...") —
    // cả hai treo tới timeout 30 s. Phép kiểm nào KHÔNG chạm pool thì phải đứng trước.~~
    // [S1.69 / khoản 120] Không câu nào chạm `auditPool` ngoài lần lấy kết nối có trần: phép kiểm khoá tư vấn chạy trên client người gọi,
    // lớp canh quyền chạy trên CHÍNH kết nối lần ghi đã lấy. Pool cạn — kể cả ở lần đầu, khi lớp canh chưa có bộ nhớ đệm — gãy ở trần với
    // `TenantError` CONNECT_WAIT_EXCEEDED, không treo.
    await khangDinhGhiDuocDocLap(client, requirement.orgId);
    await withTenant(
      auditPool,
      requirement.orgId,
      async (c) => {
        await khangDinhAuditPoolDungQuyen(auditPool, c);
        return appendAuditEvent(c, requirement.orgId, {
          actorType: "USER",
          actorId: requirement.userId,
          action: ACTION_TU_CHOI_QUYEN,
          resourceType: requirement.resourceType,
          resourceId: requirement.resourceId ?? null,
          requestId: requirement.requestId ?? null,
          // KHÔNG BAO GIỜ đưa giá/bí mật vào đây. `permission` là một mã trong danh sách đóng
          // PERMISSIONS, không phải chuỗi tự do của người dùng.
          payload: { permission: requirement.permission },
        });
      },
      { maxConnectWaitMs: TRAN_CHO_KET_NOI_AUDIT_MS },
    );
  } catch (loi) {
    // [vòng fix 1 — M4] `loi as Error` trần MẤT CHẨN ĐOÁN khi tầng dưới `throw` thứ không phải
    // Error: `cause.message` khi đó là `undefined` và thông báo của
    // PermissionAuditFailedError thành "...: undefined" — đúng lúc người trực đêm cần biết vì
    // sao một lần từ chối không ghi được sổ. `pg` không ném giá trị nguyên thuỷ hôm nay, nhưng
    // đường này đi qua cả `withTenant` lẫn `appendAuditEvent` lẫn mã người gọi truyền vào, và
    // một khẳng định về thứ MÃ NGƯỜI KHÁC ném ra không phải là thứ file này bảo đảm được.
    //
    // [vòng fix 2 — MỤC E] `String(loi)` ĐÃ BỊ GỠ. Bản vá M4 nội suy chính giá trị lạ vào một
    // thông báo đi vào log, mâu thuẫn với kỷ luật F7 viết cách đây ~40 dòng ("cố ý KHÔNG nội
    // suy giá trị nhận được: nó có thể chính là thứ không được phép ghi ra"). Bán kính nhỏ
    // (chỉ giá trị do `pg`/`withTenant`/mã người gọi ném) nhưng đúng lý do đã cấm ở chỗ kia:
    // một `throw { token }` ở tầng dưới là đủ. Giữ nguyên thứ M4 THẬT SỰ mua được — chẩn đoán
    // không còn là "undefined" — bằng cách nêu KIỂU chứ không nêu GIÁ TRỊ. Giá trị gốc vẫn tới
    // được người điều tra qua `cause` của Error này.
    throw new PermissionAuditFailedError(
      tuChoi,
      requirement.resourceType,
      loi instanceof Error
        ? loi
        : new Error(`tầng dưới ném một giá trị không phải Error (typeof = ${typeof loi})`, {
            cause: loi,
          }),
      // [S1.216 / khoản 177] Băm rút gọn của người bị từ chối — cho dòng log của lần MẤT SỔ; xem `bamNguoiRutGon`.
      bamNguoiRutGon(requirement.userId),
    );
  }

  throw tuChoi;
}

/**
 * [S1.68 / khoản 119] Ghi sổ một lần TỪ CHỐI ngoài `requirePermission` rồi ném CHÍNH nó (bất biến D5).
 *
 * Người gọi hôm nay: `tuChoi` của cổng mở thầu (packages/unseal/src/gate.ts), nhánh D2 của `approveUnseal` (packages/unseal/src/requests.ts)
 * và của `approveMfaReset` (./mfa-reset.ts). Trước khoản 119 cả ba tự gọi `withTenant(auditPool, …)` và không bọc lỗi của lần ghi.
 * [S1.72 / khoản 121] Thêm hai người gọi: lần từ chối A4 của `buildComparisonTable` (packages/unseal/src/comparison.ts), và lần từ chối lúc
 * giải mã của worker (apps/unseal-worker/src/index.ts) — worker ghi dưới vai `app_unseal` của nó.
 * [S1.213 / khoản 133] Thêm: nhánh không tìm thấy của hai đường đọc bảng so sánh (`tuChoiKhongTimThay`, comparison.ts), của
 * `cancelUnseal` và `approveUnseal` (23503 bọc), và vế "còn một lượt đang sống" của `dieuPhoiLaiSauKhiChet` (requests.ts).
 * [S1.245 / khoản 267] Thêm: vế TRẠNG THÁI của `cancelUnseal` — yêu cầu có thật đã `EXECUTED`/`CANCELLED` (requests.ts).
 *
 * Làm theo thứ tự:
 *   ⑴ `action` và `resourceType` phải là MÃ ĐỊNH DANH viết hoa — cùng hình dạng F7 của `requirePermission`, vì cả hai đi vào sổ bất biến
 *      (lượt soi 62a-15); kiểm trước khi chạm pool;
 *   ⑵ `auditPool` không được bỏ qua RLS — cùng lớp canh [F9]. Đo trước bản vá với SUPERUSER: bản ghi được nhận không một lời. [S1.69 /
 *      khoản 120] Lớp canh chạy trên CHÍNH kết nối của lần ghi, lấy với trần chờ `TRAN_CHO_KET_NOI_AUDIT_MS`;
 *   ⑶ lần ghi ở giao dịch ĐỘC LẬP — bản ghi sống qua rollback của người gọi (khoản nợ 32).
 * Lỗi ở bất kỳ bước nào ⇒ `DenialAuditFailedError` giữ lần từ chối; không lỗi ⇒ ném `denial`. Không có đường trả về.
 *
 * [S1.225 / khoản 179] `clause` — VẾ đã từ chối, một hằng của người gọi (vế của `UNSEAL_CLAUSES`, vế của worker lúc giải mã, trạng thái
 * RFQ của A4) — đi vào `DenialAuditFailedError.clause` để dòng log của lần MẤT SỔ nói được vế nào; không truyền ⇒ `null`, dòng log như
 * trước. Nhận qua tham số chứ không đọc `event.payload`: gói này không được đọc tên trường tuỳ ý của một payload (xem
 * `moTaHangDongCuaLanTuChoi`), và người gọi là người biết trường nào của payload là VẾ. ~~Ba~~ [S1.241 / khoản 279] ~~Năm~~ [S1.245 /
 * khoản 267] Sáu tệp gọi truyền nó hôm nay: `tuChoi` của cổng mở thầu, lần từ chối A4 của `buildComparisonTable`, `tuChoiLucGiaiMa` của
 * worker, [S1.241 / khoản 279] `tuChoiTheoChotTaiNguyen` (`./chot-kiem-soat.ts`, vế là mã chốt) và `nemTuChoi`
 * (`packages/danh-gia/src/tu-choi-vao-so.ts`, vế là mã lý do), [S1.245 / khoản 267] và hai lời gọi `UNSEAL_CANCEL_DENIED` của
 * `cancelUnseal` (`packages/unseal/src/requests.ts`, vế là `lyDo` ∈ `LyDoTuChoiHuy`) — `danh-muc-tu-choi.test.ts` ghim đúng ~~ba~~ ~~năm~~
 * sáu tệp ấy. Các chỗ gọi khác (D2 của phê duyệt mở thầu và đặt lại TOTP, ~~huỷ yêu cầu mở thầu,~~ ~~chốt kiểm soát, từ chối trạng thái,~~
 * phạm vi agent) không có vế cổng theo nghĩa ấy — `action` của chúng đã là một hằng riêng cho mỗi đường — nên không truyền. [S1.241 /
 * khoản 279] Chốt kiểm soát và từ chối trạng thái từng đứng trong danh sách ấy, sai: mỗi đường là MỘT `action` cho cả một tập mã đóng,
 * và mã chỉ sống ở payload của chính hàng không ghi được. Danh sách ấy cũng THIẾU — đếm lại ở §S1.241 trên cây cú pháp: mười bốn lời gọi
 * trong mã sản xuất, năm truyền vế, chín không; chín chỗ ấy là D2 của phê duyệt mở thầu và đặt lại TOTP (`viPham: "D2"`), ~~huỷ yêu cầu
 * mở thầu (`lyDo` cố định),~~ điều phối lần hai (`reason` cố định), ba lần "không tìm thấy" (`operation` — mỗi giá trị một route), phạm vi
 * agent (mẫu route), và thu hồi lời mời sau lần mở thầu (`packages/invitation/src/invitation.ts`, `RFQ_STATE_DENIED` payload `{ ma }` —
 * lời gọi `RFQ_STATE_DENIED` duy nhất trên route thu hồi). Mỗi lần từ chối của ~~chín~~ [S1.245] tám chỗ ấy nhận ra được từ `action` hay
 * từ mẫu route mà bộ điều phối in cùng dòng. [S1.245 / khoản 267] Đếm lại trên cây cú pháp sau vòng này: mười lăm lời gọi, bảy truyền
 * vế, tám không. Huỷ yêu cầu mở thầu rời danh sách không truyền: vế trạng thái của nó vào sổ từ vòng này, nên `UNSEAL_CANCEL_DENIED`
 * mang HAI lý do trên cùng route — `action` và mẫu route không còn nói được lý do nào.
 *
 * [S1.216 / khoản 177] `DenialAuditFailedError.nguoiBam` — băm rút gọn của `event.actorId` (`bamNguoiRutGon`), tính ở đây vì đây là chỗ
 * duy nhất của đường này có id trong tay. Ở mọi chỗ gọi hôm nay `actorId` là id NGƯỜI bị từ chối (`actor.id`, `nguoiXem.id`, `userId`);
 * lần từ chối của SERVICE (worker lúc giải mã) không có ⇒ `null`, dòng log của worker không đổi.
 *
 * KHÔNG kiểm "pool còn chỗ" tức thì như ~~`khangDinhGhiDuocDocLap`~~ `requirePermission` trước khoản 120 (lượt soi 62a-1, 63a-6). Bản đầu của vòng này có kiểm ấy, và nó đổi hành vi cả
 * khi lần ghi lẽ ra thành công: `auditPool` sản xuất khi ấy (S1.68) có hai kết nối và dùng chung mọi tổ chức, nên một loạt lần ghi song song làm lần từ
 * chối của người khác gãy ngay — 500, không hàng sổ — trong khi chờ thì ghi được. Không kiểm ấy, lần lấy kết nối xếp hàng: ~~pool dựng bằng
 * `createPool` chờ tối đa `connectionTimeoutMillis` 20 s rồi ném, và lỗi ấy thành `DenialAuditFailedError` (đọc); pool không đặt thời
 * hạn — pool của test — chờ không hạn (đo ở cổng mở thầu trên bản trước khoản 119: quá 4000 ms). Kiểm tức thì của `requirePermission`
 * giữ nguyên — khoản nợ 120.~~ [S1.69 / khoản 120] tới trần `TRAN_CHO_KET_NOI_AUDIT_MS` trên MỌI pool, rồi `TenantError`
 * CONNECT_WAIT_EXCEEDED thành `cause` của `DenialAuditFailedError` (đo ở rbac.int.test.ts); `requirePermission` cũng đã gỡ phép chụp.
 *
 * KHÔNG giữ vế khoá tư vấn của `khangDinhGhiDuocDocLap`: phép kiểm ấy chạy trên client NGƯỜI GỌI, mà hai chỗ D2 đến đây SAU một câu đã
 * hỏng — giao dịch aborted, câu kiểm ném 25P02 (đo bằng đột biến chế độ đo, §S1.68). Người gọi đã ghi sổ trong cùng giao dịch trước khi
 * gọi hàm này thì lần ghi chờ khoá tư vấn mà chính giao dịch ấy giữ: ~~dưới `createPool` tới `lock_timeout` 15 s rồi gãy — vẫn ồn ào; dưới~~
 * ~~pool không đặt `lock_timeout` thì treo không hạn~~ [S1.71 / khoản 123] tối đa 2 s ở mọi pool rồi gãy 55P03 (050). Các đường sản xuất không ghi sổ trước lần từ chối của chúng (đọc: `dispatchUnseal`,
 * `approveUnseal`, `approveMfaReset`; [S1.72 / lượt soi 67a-9] `buildComparisonTable`, và `executeUnsealRequest` trong giao dịch job của runner); `apps/unseal-worker/src/kich-ban-41.int.test.ts` bước 9 từng có hình dạng ấy nhưng dừng ở
 * `requirePermission` (lượt soi 62a-3, 62a-14).
 */
export async function throwAuditedDenial(
  auditPool: pg.Pool,
  orgId: string,
  event: AuditEventInput,
  denial: Error,
  clause?: string,
): Promise<never> {
  // [S1.184 / khoản 248 / ADR-112] Đếm TRƯỚC lần ghi, ngoài khối bọc lỗi: vượt trần ném nguyên dạng — xem `BoiCanhTranTuChoi`.
  await demTheoBoiCanh(auditPool, orgId);
  try {
    if (!HINH_DANG_LOAI_TAI_NGUYEN.test(event.action) || !HINH_DANG_LOAI_TAI_NGUYEN.test(event.resourceType)) {
      throw new Error(
        "action và resourceType của lần ghi sổ từ chối phải là MÃ ĐỊNH DANH viết hoa (^[A-Z][A-Z0-9_]{0,63}$) vì chúng đi thẳng vào " +
          "sổ kiểm toán bất biến. Cố ý KHÔNG nội suy giá trị nhận được vào thông báo này.",
      );
    }
    await withTenant(
      auditPool,
      orgId,
      async (c) => {
        await khangDinhAuditPoolDungQuyen(auditPool, c);
        return appendAuditEvent(c, orgId, event);
      },
      { maxConnectWaitMs: TRAN_CHO_KET_NOI_AUDIT_MS },
    );
  } catch (loi) {
    // Cùng khuôn [vòng fix 2 — MỤC E] của `requirePermission`: nêu KIỂU của thứ lạ bị ném, không nội suy GIÁ TRỊ; giá trị gốc ở `cause`.
    throw new DenialAuditFailedError(
      event.action,
      event.resourceType,
      denial,
      loi instanceof Error
        ? loi
        : new Error(`tầng dưới ném một giá trị không phải Error (typeof = ${typeof loi})`, { cause: loi }),
      clause ?? null,
      // [S1.216 / khoản 177] Băm rút gọn của `actorId` — id người bị từ chối ở mọi chỗ gọi hôm nay; SERVICE (worker) không có ⇒ null.
      typeof event.actorId === "string" ? bamNguoiRutGon(event.actorId) : null,
    );
  }
  throw denial;
}

import type pg from "pg";
import { appendAuditEvent, assertTenantBound, type AuditEventInput } from "@trustprocure/audit";
import { withTenant } from "@trustprocure/tenancy";
import type { Permission } from "./permissions.js";

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
    cause: Error,
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
    readonly denial: Error,
    cause: Error,
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
 */
const HINH_DANG_LOAI_TAI_NGUYEN = /^[A-Z][A-Z0-9_]{0,63}$/;

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
 * ghi — lần ghi đã có kết nối vẫn chờ khoá tư vấn tới `lock_timeout`/`statement_timeout` (lượt soi 63a-6); và NGẮN
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
 * chọn giữ cỡ này ngày 2026-09-13 — khoản 123, 124.
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
          action: "PERMISSION_DENIED",
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
      loi instanceof Error
        ? loi
        : new Error(`tầng dưới ném một giá trị không phải Error (typeof = ${typeof loi})`, {
            cause: loi,
          }),
    );
  }

  throw tuChoi;
}

/**
 * [S1.68 / khoản 119] Ghi sổ một lần TỪ CHỐI ngoài `requirePermission` rồi ném CHÍNH nó (bất biến D5).
 *
 * Người gọi hôm nay: `tuChoi` của cổng mở thầu (packages/unseal/src/gate.ts), nhánh D2 của `approveUnseal` (packages/unseal/src/requests.ts)
 * và của `approveMfaReset` (./mfa-reset.ts). Trước khoản 119 cả ba tự gọi `withTenant(auditPool, …)` và không bọc lỗi của lần ghi.
 *
 * Làm theo thứ tự:
 *   ⑴ `action` và `resourceType` phải là MÃ ĐỊNH DANH viết hoa — cùng hình dạng F7 của `requirePermission`, vì cả hai đi vào sổ bất biến
 *      (lượt soi 62a-15); kiểm trước khi chạm pool;
 *   ⑵ `auditPool` không được bỏ qua RLS — cùng lớp canh [F9]. Đo trước bản vá với SUPERUSER: bản ghi được nhận không một lời. [S1.69 /
 *      khoản 120] Lớp canh chạy trên CHÍNH kết nối của lần ghi, lấy với trần chờ `TRAN_CHO_KET_NOI_AUDIT_MS`;
 *   ⑶ lần ghi ở giao dịch ĐỘC LẬP — bản ghi sống qua rollback của người gọi (khoản nợ 32).
 * Lỗi ở bất kỳ bước nào ⇒ `DenialAuditFailedError` giữ lần từ chối; không lỗi ⇒ ném `denial`. Không có đường trả về.
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
 * gọi hàm này thì lần ghi chờ khoá tư vấn mà chính giao dịch ấy giữ: dưới `createPool` tới `lock_timeout` 15 s rồi gãy — vẫn ồn ào; dưới
 * pool không đặt `lock_timeout` thì treo không hạn. Các đường sản xuất không ghi sổ trước lần từ chối của chúng (đọc: `dispatchUnseal`,
 * `approveUnseal`, `approveMfaReset`); `apps/unseal-worker/src/kich-ban-41.int.test.ts` bước 9 từng có hình dạng ấy nhưng dừng ở
 * `requirePermission` (lượt soi 62a-3, 62a-14).
 */
export async function throwAuditedDenial(
  auditPool: pg.Pool,
  orgId: string,
  event: AuditEventInput,
  denial: Error,
): Promise<never> {
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
      denial,
      loi instanceof Error
        ? loi
        : new Error(`tầng dưới ném một giá trị không phải Error (typeof = ${typeof loi})`, { cause: loi }),
    );
  }
  throw denial;
}

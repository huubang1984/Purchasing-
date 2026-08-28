import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
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
 * (2) `u.status = 'ACTIVE'` nằm TRONG chính truy vấn, không tách thành một bước riêng có thể
 *     bị quên ở đường gọi khác — người dùng bị đình chỉ mất toàn bộ quyền ngay lập tức.
 *
 * (3) VẾ NỐI QUA `public.users` LÀ VẾ CHỊU LỰC CỦA CÔ LẬP TỔ CHỨC, không phải một tiện nghi để
 *     lọc `status`. `user_roles` không ép `org_id` khớp `users.org_id` (xem khối dư lượng ở
 *     005_identity.sql), nên một hàng (tổ_chức_A, người_của_B, DIRECTOR) chèn được. Nó vô hiệu
 *     CHÍNH VÌ vế nối này chạy dưới RLS của tổ chức A, nơi người của B không tồn tại. Gỡ vế
 *     nối ra là mở đúng đường leo thang đó — có test đối kháng.
 *
 * [QT3] Mọi tên bảng viết đủ `public.`, mọi hàm viết đủ `pg_catalog.`/`public.`. Hàm này chạy
 * trên pool ỨNG DỤNG, dưới `search_path` mà dự án KHÔNG kiểm soát (xem khối "GHIM TÊN HÀM" ở
 * packages/tenancy/src/with-tenant.ts) — một `doc.user_roles` đặt trước `public` trong
 * search_path sẽ trả lời thay nếu tên viết trần.
 * DƯ LƯỢNG, nói ra thay vì hứa suông: TOÁN TỬ (`=`) không được ghi đủ schema, nên về lý thuyết
 * một schema đứng trước còn cướp được phép so sánh. Đường đi tới đó đã bị hai lớp khác đóng
 * (hardening cưỡng chế `rolconfig IS NULL`; `createPool` từ chối tham số `options` trong chuỗi
 * kết nối), và việc ghi đủ `OPERATOR(pg_catalog.=)` cho mọi phép so sánh của tầng ứng dụng là
 * một quy ước chưa nơi nào trong repo này áp dụng — mở nó ở đây một mình sẽ là một bảo đảm chỉ
 * đúng ở một file.
 */
export async function hasPermission(
  client: pg.PoolClient,
  { userId, orgId, permission }: PermissionCheck,
): Promise<boolean> {
  await assertTenantBound(client, orgId, "hasPermission");

  const { rowCount } = await client.query(
    `SELECT 1
       FROM public.user_roles ur
       JOIN public.users u ON u.id = ur.user_id
       JOIN public.role_permissions rp ON rp.role_code = ur.role_code
      WHERE ur.user_id = $1
        AND rp.permission_code = $2
        AND u.status = 'ACTIVE'
      LIMIT 1`,
    [userId, permission],
  );
  return (rowCount ?? 0) > 0;
}

export interface PermissionRequirement extends PermissionCheck {
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly requestId?: string | null;
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
 *
 * Khoá được so theo (classid, objid) tách rời thay vì dựng lại số 64 bit: `classid::int8 << 32`
 * TRÀN với mọi khoá có bit cao bằng 1 (một nửa không gian băm), và một lỗi "bigint out of
 * range" ở đây sẽ biến vế phòng thủ thành vế gây sự cố.
 */
const CAU_KHOA_TU_VAN =
  `SELECT EXISTS (
     SELECT 1
       FROM pg_catalog.pg_locks l
      WHERE l.locktype = 'advisory'
        AND l.pid = pg_catalog.pg_backend_pid()
        AND l.granted
        AND l.classid = ((pg_catalog.hashtextextended($1::pg_catalog.text, 0)
                            OPERATOR(pg_catalog.>>) 32)
                          OPERATOR(pg_catalog.&) 4294967295)::pg_catalog.oid
        AND l.objid = (pg_catalog.hashtextextended($1::pg_catalog.text, 0)
                          OPERATOR(pg_catalog.&) 4294967295)::pg_catalog.oid
   ) AS dang_giu`;

async function khangDinhGhiDuocDocLap(
  client: pg.PoolClient,
  auditPool: pg.Pool,
  orgId: string,
): Promise<void> {
  // Pool cạn kiệt: `pool.connect()` KHÔNG có timeout mặc định, nên `withTenant` trên một pool
  // hết chỗ treo VĨNH VIỄN. Đây đúng là lớp lỗi [fix I4] mà migrate() đã vấp ("với pool max: 1
  // ... migrate() treo VĨNH VIỄN, không timeout"). Phép đo có tính đua, và nó đua theo hướng
  // AN TOÀN: dương tính giả chỉ đổi một lần từ chối thành một lỗi ồn ào (vẫn fail-closed), âm
  // tính giả rơi lại đúng hành vi cũ.
  if (auditPool.idleCount === 0 && auditPool.totalCount >= auditPool.options.max) {
    throw new Error(
      `pool ghi kiểm toán đã hết chỗ (max=${String(auditPool.options.max)}, ` +
        `total=${String(auditPool.totalCount)}, idle=0, ` +
        `waiting=${String(auditPool.waitingCount)}). Lấy thêm kết nối sẽ CHỜ VÔ HẠN. ` +
        "`auditPool` phải là pool RIÊNG, không dùng chung với pool đang giữ transaction gọi.",
    );
  }

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
 * người gọi thuộc tầng API, không thuộc S0 — ghi vào sổ nợ.
 *
 * `auditPool` PHẢI là pool riêng — xem `khangDinhGhiDuocDocLap`.
 */
export async function requirePermission(
  client: pg.PoolClient,
  requirement: PermissionRequirement,
  auditPool: pg.Pool,
): Promise<void> {
  if (await hasPermission(client, requirement)) return;

  const tuChoi = new PermissionDeniedError(requirement.userId, requirement.permission);

  try {
    await khangDinhGhiDuocDocLap(client, auditPool, requirement.orgId);
    await withTenant(auditPool, requirement.orgId, (c) =>
      appendAuditEvent(c, requirement.orgId, {
        actorType: "USER",
        actorId: requirement.userId,
        action: "PERMISSION_DENIED",
        resourceType: requirement.resourceType,
        resourceId: requirement.resourceId ?? null,
        requestId: requirement.requestId ?? null,
        // KHÔNG BAO GIỜ đưa giá/bí mật vào đây. `permission` là một mã trong danh sách đóng
        // PERMISSIONS, không phải chuỗi tự do của người dùng.
        payload: { permission: requirement.permission },
      }),
    );
  } catch (loi) {
    throw new PermissionAuditFailedError(tuChoi, loi as Error);
  }

  throw tuChoi;
}

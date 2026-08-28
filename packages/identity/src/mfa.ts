import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";

/** Ném khi thao tác đòi một lần xác thực hai lớp CÒN TƯƠI mà phiên không có. */
export class MfaRequiredError extends Error {
  constructor(readonly maxAgeSeconds: number) {
    // `maxAgeSeconds` là một hằng CHÍNH SÁCH do mã gọi chọn, không phải dữ liệu người dùng, nên
    // nội suy nó vào message là an toàn. Cố ý KHÔNG nội suy `sessionId`/`userId`: message đi vào
    // log, và khuôn "ném đầu vào vào message" là thứ được sao chép sang chỗ mà đầu vào ĐÚNG LÀ
    // bí mật (giá thầu, token phiên, mã OTP). Cùng kỷ luật với TenantError và
    // PermissionDeniedError.
    super(
      `Thao tác này yêu cầu xác thực hai lớp trong vòng ${maxAgeSeconds} giây gần đây. ` +
        "Vui lòng xác thực lại.",
    );
    this.name = "MfaRequiredError";
  }
}

/**
 * LỆCH KHỎI BRIEF — BRIEF TỰ MÂU THUẪN, VÀ CẢ HAI BẢN ĐỀU THIẾU MỘT VẾ.
 *
 * Mục "Interfaces" của brief khai `assertFreshMfa(client, { userId, orgId, maxAgeSeconds })`;
 * Step 6 cài đặt `{ sessionId, maxAgeSeconds }`. Bản này lấy CẢ BA, và đó không phải một phép
 * cộng cho hoà:
 *   * `sessionId` là thứ định danh hàng cần đọc — bản `{userId, orgId}` không nói được phiên
 *     NÀO trong nhiều phiên của cùng một người;
 *   * `userId` + `orgId` là danh tính mà người gọi TIN rằng phiên đó thuộc về. Không có chúng,
 *     hàm trả lời "phiên này vừa xác thực chưa" trong khi câu hỏi thật của bất biến D1 là
 *     "NGƯỜI đang thực hiện thao tác này vừa xác thực chưa". Một lỗi ghép sessionId của người
 *     khác vào request sẽ đi lọt.
 */
export interface MfaFreshnessCheck {
  readonly sessionId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly maxAgeSeconds: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Chặn hai giá trị làm hỏng transaction của người gọi trước khi chúng tới được Postgres.
 *
 * Một uuid sai hình dạng cho `22P02` và một `maxAgeSeconds` không phải số cho `22P02`/`22023` —
 * cả hai ĐỀU LÀM TRANSACTION ĐANG MỞ CHUYỂN SANG TRẠNG THÁI HỎNG, nên mọi câu lệnh sau đó của
 * `withTenant` (kể cả COMMIT) im lặng biến thành ROLLBACK. Đó là lỗi LẬP TRÌNH của người gọi
 * chứ không phải "MFA hết hạn", nên nó KHÔNG được ném `MfaRequiredError`: nhánh xử lý mặc định
 * của một API là `catch (MfaRequiredError) -> đòi xác thực lại`, và một lỗi ghép tham số rơi
 * vào nhánh đó sẽ biến mất. Cùng lập luận đã ghi cho `PermissionAuditFailedError` ở rbac.ts.
 */
function khangDinhThamSo({ sessionId, userId, orgId, maxAgeSeconds }: MfaFreshnessCheck): void {
  for (const [ten, giaTri] of [
    ["sessionId", sessionId],
    ["userId", userId],
    ["orgId", orgId],
  ] as const) {
    if (!UUID_RE.test(giaTri)) {
      throw new Error(`assertFreshMfa: ${ten} phải là UUID hợp lệ.`);
    }
  }
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error("assertFreshMfa: maxAgeSeconds phải là một số dương hữu hạn.");
  }
}

/**
 * Ném `MfaRequiredError` nếu phiên chưa xác thực hai lớp, hoặc đã xác thực nhưng quá cũ.
 *
 * Bất biến D1 đòi MFA "còn hiệu lực trong một cửa sổ ngắn" chứ không phải chỉ cần đã đăng nhập.
 * Mở thầu là hành động không hoàn tác được — người thực hiện phải chứng minh mình đang ngồi
 * trước máy TẠI THỜI ĐIỂM ĐÓ, chứ không phải đã đăng nhập từ sáng rồi bỏ máy mở.
 *
 * ============================================================================
 * (1) `clock_timestamp()`, KHÔNG PHẢI `now()` — BRIEF NÓI ĐÚNG MÀ DÙNG SAI ĐỒNG HỒ
 * ============================================================================
 * Brief viết phép so bằng `now()` kèm chú thích "độ tươi được tính bằng đồng hồ của cơ sở dữ
 * liệu". Chú thích đúng, hàm sai: `now()` là bí danh của `transaction_timestamp()`, tức nó đóng
 * băng ở thời điểm BẮT ĐẦU transaction. Hệ quả là một transaction mở đủ lâu vẫn qua được phép
 * kiểm "tươi 5 phút" — và một transaction dài KHÔNG phải chuyện hiếm trong một luồng mở thầu
 * (nó bao cả việc giải mã hồ sơ). `clock_timestamp()` đọc đồng hồ tại ĐÚNG câu lệnh này.
 * Áp cho CẢ vế `expires_at`: một phiên hết hạn giữa chừng transaction cũng phải hết hạn ở đây.
 *
 * ============================================================================
 * (2) CẬN TRÊN, KHÔNG CHỈ CẬN DƯỚI — MỘT MỐC Ở TƯƠNG LAI KHÔNG PHẢI LÀ "TƯƠI"
 * ============================================================================
 * Một phép kiểm chỉ có `mfa_verified_at > clock_timestamp() - <cửa sổ>` coi mọi mốc ở TƯƠNG LAI
 * là tươi — vĩnh viễn. `app_api` được cấp `UPDATE (mfa_verified_at)` (xem 006), nên một dòng mã
 * lỗi (hoặc một app_api bị chiếm) đặt mốc vào năm sau là đủ để một phiên "luôn vừa xác thực".
 * Vế `mfa_verified_at <= clock_timestamp()` biến ca đó thành fail-CLOSED. Nó cũng bắt luôn ca
 * vô ý: lệch đồng hồ giữa hai node.
 *
 * ============================================================================
 * (3) NỐI QUA `public.users` — CÙNG VẾ CHỊU LỰC MÀ `hasPermission` ĐÃ PHẢI THÊM
 * ============================================================================
 * Brief đọc `sessions` một mình. Hai thứ mất đi khi làm vậy, và cả hai đều là bất biến có tên:
 *   * `users.status = 'ACTIVE'`: một người bị ĐÌNH CHỈ vẫn mở thầu được bằng một phiên đã xác
 *     thực trước đó. `hasPermission` cưỡng chế vế này TRONG chính truy vấn, cố ý không tách
 *     thành một bước có thể quên ở đường gọi khác (rbac.ts, quyết định (2)); hai hàm canh cùng
 *     một trục mà không nhất quán là một khiếm khuyết.
 *   * cô lập tổ chức: 006 đã đóng đường "hàng lệch tổ chức" bằng một khoá ngoại TỔ HỢP
 *     `(org_id, user_id) REFERENCES users (org_id, id)`, nên vế nối này KHÔNG còn là lớp duy
 *     nhất — nhưng nó vẫn là lớp DUY NHẤT cưỡng chế `status`, và nó giữ cho phép kiểm đứng vững
 *     nếu một task sau nới ràng buộc kia. Hai lớp, phát biểu riêng.
 *
 * MỘT MŨI ĐỘT BIẾN SỐNG SÓT, ghi ra đúng mức: gỡ RIÊNG vế `AND u.org_id = s.org_id` của phép
 * nối (giữ nguyên `u.id = s.user_id` và `u.status`) SỐNG SÓT — 43/43 test xanh. Đó là DƯ THỪA
 * LOGIC có cơ chế nói được, không phải một lỗ: khoá ngoại TỔ HỢP của 006 làm mọi hàng `sessions`
 * đã có `org_id` khớp `users.org_id` của cùng `user_id`, nên vế ấy không loại thêm hàng nào. Nó
 * được GIỮ vì hai lý do: (a) nó là thứ giữ phép kiểm đứng vững nếu một task sau nới khoá ngoại
 * đó, và (b) `hasPermission` viết cùng khuôn — hai hàm canh cùng một trục phải đọc giống nhau.
 * Nếu ai đó gỡ nó với lý do "đột biến sống sót nên nó thừa", câu trả lời nằm ở đây.
 *
 * ============================================================================
 * (4) `assertTenantBound` TRƯỚC MỌI THỨ
 * ============================================================================
 * Truy vấn bên dưới đọc DƯỚI RLS, mà RLS lọc theo GUC `app.org_id` chứ không theo tham số
 * `orgId`. Không có vế này thì `orgId` là tham số TRANG TRÍ: gọi với tổ chức P trên một phiên
 * đang gắn Q trả về "không tươi" — đúng hướng an toàn, nhưng là "không thấy gì" chứ không phải
 * "chưa xác thực". Cùng lập luận và cùng phạm vi đã ghi ở rbac.ts quyết định (1): nó chịu lực
 * trước LỖI LẬP TRÌNH, KHÔNG trước KẺ TẤN CÔNG (chính `fn` đặt lại được GUC đó).
 *
 * ============================================================================
 * [QT3] GHIM TÊN HÀM, TÊN KIỂU VÀ TOÁN TỬ
 * ============================================================================
 * Hàm này chạy trên pool ỨNG DỤNG, dưới `search_path` mà dự án KHÔNG kiểm soát (xem khối
 * "GHIM TÊN HÀM" ở packages/tenancy/src/with-tenant.ts). Cả ba trục đã được đo là cướp được
 * trong dự án này:
 *   toán tử  -> `OPERATOR(pg_catalog.=)`, `OPERATOR(pg_catalog.>)`, ... (Task 8 vòng fix 1)
 *   tên kiểu -> `::pg_catalog.uuid` (`TYPE ... AS ENUM` + `CREATE CAST ... AS IMPLICIT` LẬT
 *               ĐƯỢC phán xét — Task 8 vòng fix 2, đo trên mã sản phẩm)
 *   tên hàm  -> `pg_catalog.clock_timestamp()`, `pg_catalog.make_interval(...)`
 * Ở ĐÂY BẢO ĐẢM TỰ NÓ CHỊU LỰC, không nhờ một tính chất tình cờ: `IS TRUE` bọc ngoài đưa
 * `NULL` (phiên không tồn tại, hoặc một vế bị làm sập) về nhánh NÉM.
 *
 * BA TRỤC KHÔNG NGANG NHAU VỀ MỨC ĐƯỢC CANH — nói đúng mức thay vì gộp làm một:
 *   toán tử  : CÓ mốc chết. Gỡ `OPERATOR(pg_catalog.=)` ở `s.id` -> test [QT3] ĐỎ.
 *   tên hàm  : CÓ mốc chết. Gỡ `pg_catalog.` khỏi `make_interval` -> test [QT3] ĐỎ.
 *   tên BẢNG : CÓ mốc chết. Gỡ `public.` khỏi `sessions` hoặc `users` -> test [QT3] ĐỎ.
 *   tên KIỂU : *** KHÔNG CÓ MỐC CHẾT ***. Mũi đột biến đổi cả bốn `::pg_catalog.uuid` thành
 *              `::uuid` SỐNG SÓT — đã đo, 45/45 test xanh. Và trục này KHÔNG phải trang trí:
 *              Task 8 vòng fix 2 đã tái lập END-TO-END trên mã sản phẩm rằng
 *              `CREATE TYPE ... AS ENUM` + `CREATE CAST ... AS IMPLICIT` LẬT ĐƯỢC phán xét mà
 *              không cần cướp một toán tử nào. Dựng fixture ấy cho hàm này khó hơn cho
 *              `assertTenantBound` vì ở đây có BA tham số uuid khác nhau, còn ENUM bóng chỉ
 *              mang được một giá trị. Nên hôm nay `::pg_catalog.uuid` ở đây là GHIM THEO KỶ
 *              LUẬT trên một trục ĐÃ BIẾT LÀ KHAI THÁC ĐƯỢC — vào sổ nợ, xem task-9-report.md.
 *
 * DƯ LƯỢNG NÓI THẲNG: không lớp nào (lint, depcruise, AST-check) cưỡng chế quy ước này — nó là
 * kỷ luật cộng test, đúng như khoản nợ số 1 trong task-8-report.md §V3.5. Bảng đột biến đầy đủ
 * nằm trong task-9-report.md.
 */
export async function assertFreshMfa(
  client: pg.PoolClient,
  kiemTra: MfaFreshnessCheck,
): Promise<void> {
  khangDinhThamSo(kiemTra);
  const { sessionId, userId, orgId, maxAgeSeconds } = kiemTra;

  await assertTenantBound(client, orgId, "assertFreshMfa");

  const { rows } = await client.query<{ tuoi: boolean }>(
    `SELECT (s.mfa_verified_at IS NOT NULL
             AND s.revoked_at IS NULL
             AND s.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()
             AND s.mfa_verified_at OPERATOR(pg_catalog.<=) pg_catalog.clock_timestamp()
             AND s.mfa_verified_at OPERATOR(pg_catalog.>)
                 (pg_catalog.clock_timestamp() OPERATOR(pg_catalog.-)
                  pg_catalog.make_interval(secs => $4::pg_catalog.float8))
            ) IS TRUE AS tuoi
       FROM public.sessions s
       JOIN public.users u
         ON u.id OPERATOR(pg_catalog.=) s.user_id
        AND u.org_id OPERATOR(pg_catalog.=) s.org_id
      WHERE s.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND s.user_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND s.org_id OPERATOR(pg_catalog.=) $3::pg_catalog.uuid
        AND u.status OPERATOR(pg_catalog.=) 'ACTIVE'::pg_catalog.text`,
    [sessionId, userId, orgId, maxAgeSeconds],
  );

  if (rows[0]?.tuoi !== true) {
    throw new MfaRequiredError(maxAgeSeconds);
  }
}

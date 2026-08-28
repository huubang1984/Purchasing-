import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";
import {
  isWellFormedTotpCode,
  verifyTotpCode,
  type TotpFailureReason,
  type TotpResult,
} from "./totp.js";

// ============================================================================================
// BẤT BIẾN E3 Ở DẠNG BỀN VỮNG — VÀ VÌ SAO FILE NÀY TỒN TẠI
//
// Brief tạo hai cột `mfa_credentials.failed_attempts` và `locked_until` rồi KHÔNG có một dòng
// mã nào đọc hay ghi chúng. Hệ quả đo được nếu để nguyên: vế (1) của E3 (giới hạn số lần thử)
// KHÔNG ĐƯỢC CÀI ĐẶT, và vế (2) (dùng một lần) chỉ tồn tại trong một hàm THUẦN — tức nó biến
// mất giữa hai request. Sáu test mang thẻ [INV-E3] của brief khi đó đều chỉ đo hàm thuần, tức
// một BẰNG CHỨNG GIẢ cho evidence pack.
//
// File này cài đặt cả ba vế trên chính hai cột đó, và các GRANT ở 006 được cắt đúng theo những
// cột file này ghi — không hơn.
//
// ============================================================================================
// T9-A: VÌ SAO GÓI NÀY KHÔNG MỞ PHONG BÌ, VÀ CỔNG `TotpSecretUnsealer` LÀ CÂU TRẢ LỜI
// ============================================================================================
// Brief viết "bí mật TOTP được lưu dưới dạng đã bọc bằng KeyWrapper (Task 7)". Thiết kế đó
// KHÔNG BIÊN DỊCH ĐƯỢC, và lý do là một hàng rào kiến trúc CÓ CHỦ ĐÍCH chứ không phải một
// thiếu sót:
//   * `packages/crypto-keys/src/index.ts` chỉ xuất đường BỌC (`KeyWrapper`, `MasterKeyRing`,
//     `WrappedKey`). Đường MỞ nằm ở `./unwrap`.
//   * `.dependency-cruiser.cjs` quy tắc `g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts` giới
//     hạn `unwrap.ts` cho `apps/unseal-worker/**` (cộng hai ngoại lệ dev-only), và
//     `g1-crypto-keys-chi-index-va-unwrap-la-cua-cong-khai` biến CẢ thư mục `src` thành vùng
//     hạn chế. `packages/identity` KHÔNG import được `unwrap`.
// Mà `verifyTotpCode(secret: Buffer, ...)` đòi bí mật RÕ 20 byte.
//
// BỐN ĐƯỜNG RA, VÀ VÌ SAO BA ĐƯỜNG ĐẦU BỊ TỪ CHỐI:
//   (a) Bỏ bọc, lưu bí mật MFA dạng rõ — không cần bàn.
//   (b) Đưa xác thực TOTP vào `apps/unseal-worker` — biến tiến trình MỞ THẦU thành tiến trình
//       ĐĂNG NHẬP, tức phình bề mặt của đúng thành phần được giữ nhỏ nhất.
//   (c) NỚI G1 cho `packages/identity` được import `unwrap` — đúng thứ QT2 cấm. G1 giam khả
//       năng GIẢI MÃ HỒ SƠ THẦU vào MỘT app; nới nó ra nghĩa là một API server bị chiếm giải
//       mã được hồ sơ thầu. Đổi một tính năng đăng nhập lấy bán kính nổ của cả sàn.
//   (d) Một cặp bọc/mở RIÊNG cho bí mật KHÔNG-PHẢI-KHOÁ-THẦU, với master key riêng.
//
// BẢN NÀY CHỌN HÌNH DẠNG CỦA (d) NHƯNG KHÔNG CÀI ĐẶT NÓ TRONG TASK NÀY, và lý do phải nói
// thẳng vì nó là một khoản nợ chứ không phải một bảo đảm đã mua:
//   * Cái (d) mua được là PHÂN TÁCH BÁN KÍNH NỔ giữa hai tài sản. Cổng dưới đây mua đúng điều
//     đó và mua bằng máy: gói `identity` KHÔNG có một cạnh phụ thuộc nào tới `crypto-keys` —
//     cưỡng chế bởi quy tắc `g3-identity-khong-co-nang-luc-mat-ma` trong `.dependency-cruiser.cjs`,
//     có test tự canh ở tests/architecture/boundaries.test.ts. Đây là hướng NGƯỢC với (c): thay
//     vì NỚI một hàng rào, nó GHIM thêm một hàng rào (QT2 làm đúng chiều).
//   * Cái (d) KHÔNG mua thêm ở S0: một cài đặt cụ thể. S0 chưa có composition root (thư mục
//     `apps/` chưa tồn tại), nên một định dạng phong bì THỨ HAI viết hôm nay sẽ có ĐÚNG 0 lời
//     gọi sản phẩm — cùng hạng với khoản nợ số 2 của Task 8 ("(E3) là một KHẢ NĂNG, không phải
//     LỚP ĐANG CHẠY"). Một cài đặt mật mã thứ hai không người dùng là bề mặt an ninh thêm vào
//     cho một giả định.
//   * DƯ LƯỢNG, viết ra để không ai tuyên bố nó đã đóng: hôm nay KHÔNG lớp nào cưỡng chế được
//     rằng cài đặt cổng này ở composition root tương lai KHÔNG PHẢI là bộ mở phong bì hồ sơ
//     thầu. Cưỡng chế được duy nhất khi `apps/` ra đời — và khi đó nó là một quy tắc depcruise
//     cùng khuôn g1/g2/g3. Xem task-9-report.md.
//
// HAI LỚP CHẶN VIỆC TIÊM NHẦM BỘ MỞ HỒ SƠ THẦU, cả hai đo được bằng `tsc`:
//   * TÊN PHƯƠNG THỨC KHÁC: `openTotpSecret`, không phải `unwrap`. TypeScript là kiểu CẤU TRÚC —
//     nếu phương thức tên `unwrap` thì `KeyUnwrapper` (`{ name, unwrap(orgId, wrapped) }`) tự
//     động GÁN ĐƯỢC vào cổng này mà không ai viết một dòng nào tuyên bố ý định đó.
//   * TRƯỜNG PHÂN BIỆT `kind`: `KeyUnwrapper` không có nó, nên ngay cả khi tên phương thức
//     trùng nhau, phép gán vẫn hỏng. Một người CỐ TÌNH vẫn viết được adapter — không lớp kiểu
//     nào chặn được điều đó, và nói ngược lại là nói quá. Cái mua được là: việc đó không còn
//     viết được MỘT CÁCH TÌNH CỜ.
// ============================================================================================

/**
 * Một bí mật đã được bọc, đúng như nó nằm trong `mfa_credentials`.
 *
 * Hình dạng này KHÔNG import từ `@trustprocure/crypto-keys` (dù `WrappedKey` ở đó có cùng hai
 * trường): một `import type` cũng tạo một cạnh phụ thuộc mà `tsPreCompilationDeps: true` của
 * dependency-cruiser NHÌN THẤY, và cạnh đó là chính thứ quy tắc `g3-` cấm. Khai lại tại chỗ là
 * giá phải trả để gói này không có một sợi dây nào tới mật mã.
 */
export interface WrappedTotpSecret {
  readonly ciphertext: Uint8Array;
  readonly keyVersion: string;
}

/**
 * Cổng mở bí mật TOTP. Xem khối T9-A ở đầu file để biết vì sao nó là một CỔNG chứ không phải
 * một lời gọi trực tiếp.
 *
 * HỢP ĐỒNG mà người cài đặt phải giữ, viết ra vì kiểu không nói được:
 *   * Nó KHÔNG ĐƯỢC là bộ mở phong bì hồ sơ thầu, và không được dùng chung vòng khoá chính với
 *     bộ đó (ADR-006, bất biến G1).
 *   * Nó phải ràng buộc `orgId` vào phép giải mã (AAD hoặc khoá dẫn xuất theo tổ chức), để
 *     phong bì của tổ chức A không mở được trong ngữ cảnh tổ chức B — cùng tính chất mà
 *     `deriveOrgKey` mua cho khoá thầu.
 *   * Nó phải NÉM khi không mở được, không được trả một mảng rỗng: một bí mật rỗng làm
 *     `verifyTotpCode` chạy bình thường trên khoá HMAC rỗng, tức fail-OPEN im lặng.
 */
export interface TotpSecretUnsealer {
  /** Trường phân biệt — xem "HAI LỚP CHẶN VIỆC TIÊM NHẦM" ở đầu file. */
  readonly kind: "TOTP_SECRET_UNSEALER";
  /** Tên adapter, dùng cho chẩn đoán. KHÔNG được chứa bí mật. */
  readonly name: string;
  openTotpSecret(orgId: string, wrapped: WrappedTotpSecret): Promise<Uint8Array>;
}

/**
 * Số lần thất bại LIÊN TIẾP làm khoá hồ sơ. Phát biểu chính xác vì một con số ở đây rất dễ bị
 * kể sai đi một đơn vị: lần thất bại THỨ `MFA_MAX_FAILED_ATTEMPTS` là lần ĐẶT khoá, nên số lần
 * đoán được trong một cửa sổ đúng bằng con số này.
 */
export const MFA_MAX_FAILED_ATTEMPTS = 5;

/** Độ dài cửa sổ khoá, tính bằng giây. */
export const MFA_LOCKOUT_SECONDS = 900;

export type MfaDenialReason =
  | "NO_CREDENTIAL"
  | "LOCKED_OUT"
  | TotpFailureReason;

export type MfaAttemptResult =
  | { readonly ok: true; readonly counter: number }
  | {
      readonly ok: false;
      readonly reason: MfaDenialReason;
      /** Thời điểm hết khoá, nếu hồ sơ đang bị khoá. */
      readonly lockedUntil: Date | null;
      /** Chính lần thử này có làm hồ sơ chuyển sang trạng thái BỊ KHOÁ không. */
      readonly justLocked: boolean;
    };

export interface TotpEnrollment {
  readonly orgId: string;
  readonly userId: string;
  readonly wrapped: WrappedTotpSecret;
}

export interface TotpAttempt {
  readonly orgId: string;
  readonly userId: string;
  readonly code: string;
  /** Thời điểm mili-giây epoch dùng cho phép tính bộ đếm. Cho phép truyền vào để test tất định. */
  readonly now?: number;
  readonly window?: number;
  readonly maxFailedAttempts?: number;
  readonly lockoutSeconds?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function khangDinhUuid(ten: string, giaTri: string, tenHam: string): void {
  if (!UUID_RE.test(giaTri)) {
    // Cố ý KHÔNG nội suy giá trị — cùng kỷ luật với rbac.ts và with-tenant.ts.
    throw new Error(`${tenHam}: ${ten} phải là UUID hợp lệ.`);
  }
}

interface HangHoSo {
  id: string;
  secret_wrapped: Buffer;
  secret_key_version: string;
  last_used_counter: string | null;
  locked_until: Date | null;
  dang_khoa: boolean;
}

/**
 * Đọc hồ sơ TOTP của một người dùng.
 *
 * [QT3] Xem khối cùng tên ở mfa.ts. Vế `c.org_id = $1` KHÔNG thừa dù RLS đã lọc: phát biểu
 * "RLS đã giới hạn tập hàng" là CÓ ĐIỀU KIỆN — nó sai với một phiên SUPERUSER hoặc BYPASSRLS
 * (một người vận hành chạy công cụ bằng tay là đúng ca đó), và Task 8 vòng fix 2 đã ĐO một tập
 * hàng tràn ra ngoài tổ chức ở đúng khuôn này.
 *
 * Vế nối `public.users` + `u.status = 'ACTIVE'`: cùng vế chịu lực của `hasPermission`. Một
 * người bị ĐÌNH CHỈ không được đi qua phép xác thực hai lớp, và điều đó phải nằm TRONG truy vấn
 * chứ không phải một bước riêng có thể quên ở đường gọi khác.
 */
const CAU_DOC_HO_SO = `
  SELECT c.id,
         c.secret_wrapped,
         c.secret_key_version,
         c.last_used_counter,
         c.locked_until,
         (c.locked_until IS NOT NULL
          AND c.locked_until OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()) IS TRUE
           AS dang_khoa
    FROM public.mfa_credentials c
    JOIN public.users u
      ON u.id OPERATOR(pg_catalog.=) c.user_id
     AND u.org_id OPERATOR(pg_catalog.=) c.org_id
   WHERE c.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
     AND c.user_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
     AND c.kind OPERATOR(pg_catalog.=) 'TOTP'::pg_catalog.text
     AND u.status OPERATOR(pg_catalog.=) 'ACTIVE'::pg_catalog.text`;

/**
 * [INV-E3(2)] GHI NHẬN MỘT LẦN THÀNH CÔNG — NGUYÊN TỬ, KHÔNG CÓ CỬA SỔ ĐUA.
 *
 * Đường ĐỌC-RỒI-GHI ngây thơ ("đọc last_used_counter, so, rồi UPDATE") có một cửa sổ TOCTOU
 * thật: hai request đồng thời mang CÙNG một mã đều đọc `last_used_counter = NULL`, cả hai
 * `verifyTotpCode` trả `ok`, và CẢ HAI QUA — tức vế "dùng một lần" của E3 biến mất đúng lúc nó
 * cần nhất (kẻ tấn công chơi lại một mã bắt được thì gửi nó SONG SONG, không tuần tự).
 *
 * Vế `last_used_counter IS NULL OR last_used_counter < $2` biến toàn bộ phép chuyển trạng thái
 * thành MỘT câu lệnh, và `rowCount` là phán xét. Dưới READ COMMITTED, request thứ hai chờ khoá
 * hàng của request thứ nhất rồi ĐÁNH GIÁ LẠI vị từ trên hàng ĐÃ CẬP NHẬT (EvalPlanQual), nên nó
 * thấy `last_used_counter = $2` và không còn thoả `< $2`: `rowCount = 0`.
 *
 * `COALESCE` cố ý viết TRẦN: nó là một CẤU TRÚC NGỮ PHÁP (`CoalesceExpr`), không phải một hàm
 * trong `pg_proc`, nên nó KHÔNG cướp được qua `search_path` — và `pg_catalog.coalesce(...)` cho
 * `42883`. Cả hai vế đã được đo ở packages/audit/src/tenant-guard.ts.
 *
 * `confirmed_at` được đóng ở LẦN THÀNH CÔNG ĐẦU TIÊN: đó chính là thời điểm người dùng chứng
 * minh mình giữ được thiết bị. Không cần một hàm `confirm` riêng, và không có trạng thái "đã
 * xác nhận" nào đặt được mà không đi qua một mã đúng.
 */
const CAU_GHI_THANH_CONG = `
  UPDATE public.mfa_credentials c
     SET last_used_counter = $3::pg_catalog.int8,
         failed_attempts = 0,
         locked_until = NULL,
         confirmed_at = COALESCE(c.confirmed_at, pg_catalog.clock_timestamp())
   WHERE c.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
     AND c.org_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
     AND (c.last_used_counter IS NULL
          OR c.last_used_counter OPERATOR(pg_catalog.<) $3::pg_catalog.int8)
     AND (c.locked_until IS NULL
          OR c.locked_until OPERATOR(pg_catalog.<=) pg_catalog.clock_timestamp())`;

/**
 * [INV-E3(1)] GHI NHẬN MỘT LẦN THẤT BẠI VÀ ĐẶT KHOÁ KHI VƯỢT NGƯỠNG.
 *
 * CTE `truoc` tính số lần thất bại MỚI trước khi ghi, và nó có hai nhánh chứ không phải một —
 * đây là chỗ dễ kể sai nhất nên viết ra bằng số:
 *   * hồ sơ vừa HẾT một cửa sổ khoá (`locked_until` đã qua): bộ đếm ĐẶT LẠI VỀ 1. Không có
 *     nhánh này thì sau lần khoá đầu tiên, MỖI lần thất bại tiếp theo (5 -> 6, 6 -> 7, ...) đều
 *     vượt ngưỡng và khoá lại ngay lập tức — nghĩa là người dùng thật chỉ còn ĐÚNG MỘT lần thử
 *     mỗi cửa sổ, vĩnh viễn, cho tới khi có một lần đúng. Bảo đảm mà bản này phát biểu được là
 *     "MỖI cửa sổ cho phép đúng `maxFailedAttempts` lần đoán", và nó chỉ đúng nhờ nhánh này.
 *   * ngược lại: `failed_attempts + 1`.
 * Ngưỡng so trên giá trị MỚI (`so_lan >= max`), nên lần thất bại thứ `max` là lần ĐẶT khoá.
 *
 * `locked_until` được ĐẶT LẠI VỀ NULL ở nhánh chưa vượt ngưỡng: nếu giữ giá trị cũ, một hồ sơ
 * đã hết khoá vẫn mang một mốc quá khứ và mọi phép đọc sau đó phải tự nhớ so nó với hiện tại.
 */
const CAU_GHI_THAT_BAI = `
  WITH truoc AS (
    SELECT c.id,
           (CASE WHEN c.locked_until IS NOT NULL
                  AND c.locked_until OPERATOR(pg_catalog.<=) pg_catalog.clock_timestamp()
                 THEN 1
                 ELSE c.failed_attempts OPERATOR(pg_catalog.+) 1
            END) AS so_lan
      FROM public.mfa_credentials c
     WHERE c.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
       AND c.org_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
  )
  UPDATE public.mfa_credentials c
     SET failed_attempts = t.so_lan,
         locked_until = CASE
             WHEN t.so_lan OPERATOR(pg_catalog.>=) $3::pg_catalog.int4
             THEN pg_catalog.clock_timestamp() OPERATOR(pg_catalog.+)
                  pg_catalog.make_interval(secs => $4::pg_catalog.float8)
             ELSE NULL END
    FROM truoc t
   WHERE c.id OPERATOR(pg_catalog.=) t.id
  RETURNING c.locked_until AS khoa_toi`;

/**
 * Ghi một hồ sơ TOTP mới. `wrapped` là KHỐI ĐỤC — gói này không diễn giải nó.
 *
 * Ràng buộc `UNIQUE (org_id, user_id, kind)` của 006 làm hàm này ném khi người dùng ĐÃ có hồ
 * sơ. Đó là hành vi đúng và cố ý: ở tầng CSDL app_api KHÔNG có UPDATE trên hai cột bí mật và
 * KHÔNG có DELETE, nên "đăng ký lại" không phải một thao tác của ứng dụng ở S0 (xem khối §(3)
 * của 006). Ném ở đây làm điều đó lộ ra tại chỗ thay vì âm thầm ghi đè.
 */
export async function enrollTotpCredential(
  client: pg.PoolClient,
  { orgId, userId, wrapped }: TotpEnrollment,
): Promise<void> {
  khangDinhUuid("orgId", orgId, "enrollTotpCredential");
  khangDinhUuid("userId", userId, "enrollTotpCredential");
  if (wrapped.ciphertext.length === 0) {
    throw new Error("enrollTotpCredential: ciphertext rỗng — không có gì để lưu.");
  }
  if (wrapped.keyVersion.length === 0) {
    throw new Error("enrollTotpCredential: keyVersion rỗng — bí mật sẽ không mở lại được.");
  }

  await assertTenantBound(client, orgId, "enrollTotpCredential");

  await client.query(
    `INSERT INTO public.mfa_credentials
       (org_id, user_id, kind, secret_wrapped, secret_key_version)
     VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, 'TOTP'::pg_catalog.text,
             $3::pg_catalog.bytea, $4::pg_catalog.text)`,
    [orgId, userId, Buffer.from(wrapped.ciphertext), wrapped.keyVersion],
  );
}

function docBoDem(tho: string | null, hoSo: string): number | null {
  if (tho === null) return null;
  const so = Number(tho);
  if (!Number.isSafeInteger(so) || so < 0) {
    // `bigint` về JS dưới dạng chuỗi; một giá trị vượt Number.MAX_SAFE_INTEGER sẽ so sánh SAI
    // trong im lặng. Fail-closed và nói rõ hồ sơ nào — `hoSo` là một uuid, không phải bí mật.
    throw new Error(
      `verifyTotpAttempt: last_used_counter của hồ sơ ${hoSo} không phải số nguyên an toàn.`,
    );
  }
  return so;
}

/**
 * Mở phong bì, so mã, rồi XOÁ bí mật rõ khỏi heap trên MỌI đường ra.
 *
 * Tách thành hàm riêng để `finally` bọc trọn vòng đời của `biMat` và để không nhánh nào của
 * `verifyTotpAttempt` giữ được một tham chiếu tới nó. Cùng kỷ luật `orgKey.fill(0)` trong
 * `finally` mà packages/crypto-keys đã phải sửa ở vòng fix 1 của Task 7 (ở đó `fill(0)` nằm
 * NGOÀI `try`, nên một lần ném giữa chừng để lại khoá dẫn xuất còn nguyên trong bộ nhớ).
 *
 * MŨI ĐỘT BIẾN SỐNG SÓT, ghi ra thay vì để dòng này trông như có mốc chết: thay `biMat?.fill(0)`
 * bằng `void biMat` SỐNG SÓT — 43/43 test xanh. Đúng như phải thế: không một khẳng định nào ở
 * tầng ứng dụng quan sát được nội dung heap sau khi hàm trả về. Nó KHÔNG phải dư thừa logic (gỡ
 * đi là để bí mật 20 byte nằm lại trong bộ nhớ tiến trình cho tới lần GC sau, nơi một core dump
 * hay một heap snapshot đọc được nó), cũng KHÔNG phải fail-open. Nó là PHÒNG THỦ CHIỀU SÂU
 * KHÔNG CÓ MỐC CHẾT — cùng hạng với `orgKey.fill(0)` của crypto-keys, và cùng cách xử lý: nói ra.
 *
 * [CẤM LOG] Lỗi do cổng ném được bọc lại KHÔNG nội suy giá trị nào: một adapter viết ẩu có thể
 * đưa chính bí mật vào `message` của nó, nên nguyên nhân gốc chỉ đi tiếp qua `cause` (đường
 * dành cho người điều tra), không đi vào chuỗi mà lớp trên có thể ghi log.
 */
async function moPhongBiVaSo(
  unsealer: TotpSecretUnsealer,
  orgId: string,
  hoSo: HangHoSo,
  code: string,
  tuyChon: { now?: number; window?: number; lastUsedCounter: number | null },
): Promise<TotpResult> {
  let biMat: Buffer | null = null;
  try {
    biMat = Buffer.from(
      await unsealer.openTotpSecret(orgId, {
        ciphertext: hoSo.secret_wrapped,
        keyVersion: hoSo.secret_key_version,
      }),
    );
    if (biMat.length === 0) {
      // Fail-closed trước một cổng cài đặt sai: HMAC với khoá RỖNG vẫn tính ra một mã hợp lệ,
      // nên "bí mật rỗng" là một lỗ fail-OPEN im lặng chứ không phải một ca vô hại.
      throw new Error("verifyTotpAttempt: cổng mở bí mật trả về 0 byte.");
    }
    return verifyTotpCode(biMat, code, tuyChon);
  } finally {
    biMat?.fill(0);
  }
}

/**
 * [INV-E3] Xác thực một mã TOTP và cập nhật trạng thái bền vững của hồ sơ.
 *
 * THỨ TỰ CÁC NHÁNH LÀ CHỊU LỰC, không phải tuỳ tiện:
 *   1. không có hồ sơ (hoặc người dùng không ACTIVE, hoặc lệch tổ chức) -> `NO_CREDENTIAL`.
 *      Không có gì để đếm nên KHÔNG ghi gì.
 *   2. đang bị khoá -> `LOCKED_OUT`. Đặt TRƯỚC phép kiểm hình dạng để một hồ sơ đang bị khoá
 *      chỉ trả về đúng một câu trả lời, bất kể mã gửi lên trông thế nào.
 *   3. mã sai hình dạng -> `MALFORMED_CODE`, KHÔNG tính là một lần thất bại. Phát biểu đúng
 *      mức: một kẻ đang đoán mã gửi mã ĐÚNG HÌNH DẠNG, nên không tính nhánh này không nới lỏng
 *      vế (1) của E3; đổi lại, một client hỏng không tự khoá tài khoản người dùng thật.
 *   4. mở bí mật, so mã (hằng-thời-gian), rồi ghi kết quả bằng MỘT câu lệnh nguyên tử.
 *
 * ============================================================================
 * BẤT BIẾN D5 KHÔNG ĐƯỢC ÁP CHO NHÁNH NÀY — MỘT QUYẾT ĐỊNH, KÈM LÝ DO ĐO ĐƯỢC
 * ============================================================================
 * Task 8 lập tiền lệ "mỗi lần TỪ CHỐI QUYỀN để lại một bản ghi kiểm toán" cho
 * `requirePermission`. Hàm này CỐ Ý KHÔNG ghi kiểm toán, và có test khẳng định điều đó — để nó
 * là một phát biểu đo được chứ không phải một chỗ bỏ quên:
 *   * D5 nói về TỪ CHỐI QUYỀN. Một mã TOTP sai không phải một phán xét về quyền; nó là một
 *     phép thử chứng thực.
 *   * Chi phí đã được Task 8 đo trên đúng đường này: `appendAuditEvent` đi qua
 *     `noi_chuoi_kiem_toan()`, thứ mở đầu bằng `pg_advisory_xact_lock` THEO TỔ CHỨC (ĐO-5a/5b:
 *     một phiên khác cùng tổ chức kẹt tới `lock_timeout`). Ghi sổ ở đây nghĩa là MỖI lần đoán
 *     sai của MỖI người lạ đều nối tiếp hoá sổ kiểm toán của cả tổ chức — trên một đường đi mà
 *     kẻ tấn công KHÔNG CẦN đăng nhập được để chạm tới. Đó là đổi một dòng nhật ký lấy một cần
 *     gạt từ chối dịch vụ.
 *   * Cái được ghi lại BỀN VỮNG vẫn còn: `failed_attempts` và `locked_until` trên chính hàng
 *     đó. Và sự kiện đáng ghi sổ thật sự — CHUYỂN SANG TRẠNG THÁI BỊ KHOÁ, thứ xảy ra nhiều
 *     nhất một lần mỗi cửa sổ — được đưa ra ngoài qua `justLocked` để tầng gọi ghi ĐÚNG sự kiện
 *     có giới hạn đó.
 *   * DƯ LƯỢNG, nói thẳng: hôm nay KHÔNG có người gọi nào trong repo, nên `justLocked` là một
 *     KHẢ NĂNG chứ không phải một lớp đang chạy — cùng hạng với khoản nợ số 2 của Task 8.
 *
 * ĐÁNH ĐỔI ĐÃ BIẾT của vế (1) E3: khoá theo hồ sơ nghĩa là ai gửi được `maxFailedAttempts` mã
 * sai cũng khoá được tài khoản của người khác trong một cửa sổ. Đó là tính chất cố hữu của mọi
 * cơ chế giới hạn số lần thử theo tài khoản; lớp bù là hạn mức theo NGƯỜI GỌI ở tầng API, thứ
 * không thuộc S0 (cùng khoản nợ đã ghi ở rbac.ts).
 *
 * [CẤM LOG] Bí mật rõ chỉ tồn tại trong biến `biMat` và bị `fill(0)` trong `finally`. Không
 * nhánh nào của hàm này đưa bí mật, mã đã gửi, hay một mảnh của chúng vào một thông báo lỗi
 * hoặc một giá trị trả về — có test quét đúng điều đó.
 */
export async function verifyTotpAttempt(
  client: pg.PoolClient,
  attempt: TotpAttempt,
  unsealer: TotpSecretUnsealer,
): Promise<MfaAttemptResult> {
  const { orgId, userId, code } = attempt;
  khangDinhUuid("orgId", orgId, "verifyTotpAttempt");
  khangDinhUuid("userId", userId, "verifyTotpAttempt");

  const nguong = attempt.maxFailedAttempts ?? MFA_MAX_FAILED_ATTEMPTS;
  const giaySauKhiKhoa = attempt.lockoutSeconds ?? MFA_LOCKOUT_SECONDS;
  if (!Number.isSafeInteger(nguong) || nguong < 1) {
    throw new Error("verifyTotpAttempt: maxFailedAttempts phải là số nguyên >= 1.");
  }
  if (!Number.isFinite(giaySauKhiKhoa) || giaySauKhiKhoa <= 0) {
    throw new Error("verifyTotpAttempt: lockoutSeconds phải là một số dương hữu hạn.");
  }

  await assertTenantBound(client, orgId, "verifyTotpAttempt");

  const { rows } = await client.query<HangHoSo>(CAU_DOC_HO_SO, [orgId, userId]);
  const hoSo = rows[0];
  if (hoSo === undefined) {
    return { ok: false, reason: "NO_CREDENTIAL", lockedUntil: null, justLocked: false };
  }
  if (hoSo.dang_khoa) {
    return { ok: false, reason: "LOCKED_OUT", lockedUntil: hoSo.locked_until, justLocked: false };
  }

  const ghiThatBai = async (lyDo: MfaDenialReason): Promise<MfaAttemptResult> => {
    const { rows: sau } = await client.query<{ khoa_toi: Date | null }>(CAU_GHI_THAT_BAI, [
      hoSo.id,
      orgId,
      nguong,
      giaySauKhiKhoa,
    ]);
    const khoaToi = sau[0]?.khoa_toi ?? null;
    return { ok: false, reason: lyDo, lockedUntil: khoaToi, justLocked: khoaToi !== null };
  };

  // Hình dạng mã được xét TRƯỚC khi mở phong bì: không có lý do gì phải giải mã một bí mật để
  // từ chối một chuỗi không phải sáu chữ số.
  if (!isWellFormedTotpCode(code)) {
    return {
      ok: false,
      reason: "MALFORMED_CODE",
      lockedUntil: hoSo.locked_until,
      justLocked: false,
    };
  }

  const daDung = docBoDem(hoSo.last_used_counter, hoSo.id);
  const ketQua = await moPhongBiVaSo(unsealer, orgId, hoSo, code, {
    now: attempt.now,
    window: attempt.window,
    lastUsedCounter: daDung,
  });

  if (!ketQua.ok) {
    return await ghiThatBai(ketQua.reason);
  }

  const { rowCount } = await client.query(CAU_GHI_THANH_CONG, [hoSo.id, orgId, ketQua.counter]);
  if ((rowCount ?? 0) === 0) {
    // Thua cuộc đua: một request đồng thời đã ghi nhận CHÍNH bộ đếm này (hoặc lớn hơn), hoặc
    // hồ sơ vừa bị khoá giữa chừng. Cả hai đều là "mã này không còn dùng được nữa" — gộp về một
    // câu trả lời là fail-CLOSED, và phân biệt hai ca sẽ tốn một round trip để mua đúng một
    // thông tin mà kẻ tấn công quan tâm hơn người dùng thật.
    return {
      ok: false,
      reason: "CODE_ALREADY_USED",
      lockedUntil: hoSo.locked_until,
      justLocked: false,
    };
  }

  return { ok: true, counter: ketQua.counter };
}

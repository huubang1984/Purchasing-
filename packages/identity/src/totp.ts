import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ============================================================================================
// TOTP THEO RFC 6238 — CÁC NGUYÊN THUỶ THUẦN
//
// File này CỐ Ý không chạm cơ sở dữ liệu và không chạm khoá bọc. Nó trả lời đúng một câu hỏi:
// "chuỗi sáu chữ số này có phải mã TOTP của bí mật này, trong cửa sổ thời gian này không".
//
// PHÁT BIỂU ĐÚNG MỨC VỀ BẤT BIẾN E3, vì đây là chỗ dễ nói quá nhất.
//
// [vòng fix 1 — MỤC 6] BẢN TRƯỚC VIẾT "E3 GỒM BA VẾ". SAI, VÀ SAI THEO HƯỚNG HẸP HƠN SỔ ĐĂNG
// KÝ. docs/TEST-PLAN.md:82 định nghĩa E3 bằng NĂM vế; đánh số dưới đây bám ĐÚNG thứ tự đó, và
// mọi thẻ `[INV-E3(n)]` trong repo đã được đánh số lại theo nó:
//   (1) giới hạn số lần thử  — KHÔNG nằm ở file này. Một hàm thuần không đếm được gì qua hai
//       request. Vế đó nằm ở `packages/identity/src/mfa-credentials.ts`, trên hai cột
//       `failed_attempts`/`locked_until` của `mfa_credentials`.
//   (2) GIỚI HẠN TẦN SUẤT    — *** KHÔNG CÓ LỚP NÀO TRONG TOÀN S0 ***. Không ở file này, không
//       ở mfa-credentials.ts, không ở tầng CSDL. Nó là một KHOẢN NỢ MỞ mang tên một vế bất
//       biến, không phải một "lớp bù tuỳ chọn" — xem khối đầu mfa-credentials.ts.
//   (3) hết hạn              — cửa sổ trượt của `verifyTotpCode`: một mã chỉ hợp lệ trong
//       `2*window+1` bước 30 giây quanh hiện tại. Trần `MAX_TOTP_WINDOW` giữ cho vế này không
//       bị chính người gọi vô hiệu hoá.
//   (4) dùng một lần         — file này chỉ cưỡng chế được nó KHI người gọi truyền
//       `lastUsedCounter` vào; bản thân nó không nhớ gì. Vế BỀN VỮNG (và vế chống đua giữa hai
//       request đồng thời) nằm ở `mfa-credentials.ts`.
//   (5) so sánh chống tấn công thời gian — vế DUY NHẤT được cưỡng chế trọn vẹn ở đây, VÀ là vế
//       DUY NHẤT không có mốc chết (nói rõ ở docblock của `verifyTotpCode`).
//
// VÌ SAO THẺ Ở ĐÂY LÀ `[INV-E3(n)]` CHỨ KHÔNG PHẢI `[INV-E3]`, và một lưu ý BẮT BUỘC cho Task
// 11: một thẻ rộng hơn thứ được đo là bằng chứng giả cho evidence pack, nên các test của file
// này nói rõ chúng đo vế NÀO. Hệ quả phụ, ĐÃ ĐƯỢC KIỂM CHỦ ĐÍCH: cú pháp `(n)` làm nhãn KHÔNG
// khớp regex `\[INV-([A-H]\d+)\]` của bộ sinh ma trận, nên các test này KHÔNG được đếm vào hàng
// E3. Đó là kết cục ĐÚNG (chúng đo hàm thuần, không đo bất biến bền vững) — nhưng nó ĐÚNG DO
// MAY, không do thiết kế, và bây giờ thì do thiết kế vì câu này tồn tại. TASK 11 KHÔNG ĐƯỢC nới
// regex để nhận `(n)`: làm thế sẽ đổ 9 test hàm thuần vào hàng E3 và biến E3 thành "đã phủ" khi
// vế (2) không có một dòng mã nào. Hàng E3 của ma trận phải được nuôi bằng các test `[INV-E3]`
// trong mfa.int.test.ts, thứ chạy trên CSDL thật.
// ============================================================================================

const STEP_SECONDS = 30;
const DIGITS = 6;
const DEFAULT_WINDOW = 1;

/**
 * [vòng fix 1 — MỤC 5] TRẦN CỦA `window`, tính bằng bước 30 giây.
 *
 * `window` do NGƯỜI GỌI truyền và bản trước chỉ kiểm `>= 0`. Ba hệ quả đo được của việc không
 * có cận trên, cả ba đều ở MẶT TIỀN CÔNG KHAI:
 *   (a) vế E3(3) ("hết hạn") do chính người gọi định đoạt — đo: `window = 60` làm một mã của
 *       30 PHÚT TRƯỚC trả `{ ok: true }`, trong khi mặc định (1) trả `WRONG_CODE`;
 *   (b) không gian mã hợp lệ tại mỗi thời điểm là `2*window+1`, nên với `window` đủ lớn MỌI
 *       chuỗi sáu chữ số đều hợp lệ — tức MFA biến thành trang trí mà không một lỗi nào nổ;
 *   (c) một cần gạt DoS CPU ĐỒNG BỘ — đo: `window = 200000` tốn 8745 ms CPU (400001 lần
 *       HMAC-SHA1) trong MỘT lời gọi, trên luồng sự kiện của Node.
 *
 * Con số 10 là một CHÍNH SÁCH: RFC 6238 §5.2 khuyến nghị "at most one time step", và 10 bước
 * (±5 phút) là biên rộng rãi cho lệch đồng hồ thiết bị mà vẫn giữ không gian mã ở 21/10^6. Ai
 * cần rộng hơn phải sửa dòng này, tức phải viết ra thành một quyết định nhìn thấy được.
 *
 * [vòng fix 2 — MỤC 3] TRẦN NÀY KHÔNG ĐỘC LẬP VỚI `MFA_MAX_ALLOWED_FAILED_ATTEMPTS`. "21/10^6"
 * ở trên là không gian mã cho MỘT lần đoán; số lần đoán mỗi cửa sổ là trần KIA, và hai con số
 * NHÂN với nhau. Ca xấu nhất hợp thành mà mặt tiền cho phép người gọi chọn được viết ra bằng số
 * ở docblock của `MFA_MAX_ALLOWED_FAILED_ATTEMPTS` (mfa-credentials.ts) — đọc kèm, đừng biện
 * minh con số này một mình.
 */
export const MAX_TOTP_WINDOW = 10;

/**
 * Phán xét `window`, CÙNG một phép kiểm mà `verifyTotpCode` dùng.
 *
 * Tồn tại vì `verifyTotpAttempt` phải từ chối một `window` xấu TRƯỚC khi tốn một round trip và
 * trước khi một bí mật rõ tồn tại trong tiến trình (xem hệ quả (c) ở trên) — và nhân bản phép
 * kiểm sang file kia là đúng lớp "hai bản lệch nhau trong im lặng" mà dự án này đã phải đóng
 * nhiều lần. Một hàm, một phép kiểm; cùng khuôn `isWellFormedTotpCode`.
 *
 * CỐ Ý KHÔNG nằm ở barrel công khai: hợp đồng NỘI BỘ của gói.
 *
 * [CẤM LOG] `window` là một hằng CHÍNH SÁCH do mã gọi chọn, không phải dữ liệu người dùng và
 * không phải bí mật, nên nội suy nó vào message là an toàn — cùng lập luận đã ghi cho
 * `maxAgeSeconds` của `MfaRequiredError`. Bí mật và mã KHÔNG bao giờ đi vào một message nào.
 */
export function khangDinhCuaSo(window: number, tenHam: string): void {
  if (!Number.isSafeInteger(window) || window < 0) {
    throw new RangeError(`${tenHam}: window phải là số nguyên không âm.`);
  }
  if (window > MAX_TOTP_WINDOW) {
    throw new RangeError(
      `${tenHam}: window = ${window} vượt trần MAX_TOTP_WINDOW = ${MAX_TOTP_WINDOW}. ` +
        "Một cửa sổ đủ rộng làm vế 'hết hạn' của E3 biến mất và mở một cần gạt DoS CPU.",
    );
  }
}

/**
 * Sáu chữ số ASCII, KHÔNG hơn không kém.
 *
 * `$` trong JavaScript (không cờ `m`) neo vào HẾT chuỗi, không neo trước một `\n` cuối như
 * Python — nên `"123456\n"` KHÔNG khớp. Và `[0-9]` chứ không phải `\d` với cờ `u`: cả hai
 * tương đương ở đây, nhưng viết ra tập ký tự làm việc "chữ số Ả Rập-Ấn Độ ١٢٣٤٥٦ bị từ chối"
 * thành thứ đọc được từ chính biểu thức thay vì một tính chất phải nhớ.
 */
const CODE_PATTERN = /^[0-9]{6}$/;

/**
 * Hình dạng của mã có hợp lệ không — CÙNG một phép kiểm mà `verifyTotpCode` dùng.
 *
 * Tồn tại vì `verifyTotpAttempt` cần phán xét hình dạng TRƯỚC khi mở phong bì bí mật (không có
 * lý do gì phải giải mã một bí mật để từ chối một chuỗi không phải sáu chữ số), và nhân bản
 * biểu thức chính quy sang file kia là đúng lớp "hai bản lệch nhau trong im lặng" mà dự án này
 * đã phải đóng nhiều lần bằng meta-test. Một hàm, một biểu thức.
 *
 * CỐ Ý KHÔNG nằm ở barrel công khai: nó là hợp đồng NỘI BỘ của gói.
 */
export function isWellFormedTotpCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export interface TotpVerifyOptions {
  /** Thời điểm tính theo mili-giây epoch. Cho phép truyền vào để test tất định. */
  readonly now?: number;
  /**
   * Số bước 30 giây được chấp nhận lệch về mỗi phía. Mặc định 1, trần `MAX_TOTP_WINDOW`.
   * Vượt trần thì NÉM `RangeError` — xem khối tài liệu của `MAX_TOTP_WINDOW`.
   */
  readonly window?: number;
  /** Bộ đếm của lần xác thực thành công gần nhất — nền tảng chống dùng lại mã. */
  readonly lastUsedCounter?: number | null;
}

/**
 * Lý do từ chối.
 *
 * LỆCH KHỎI BRIEF, CÓ LÝ DO: brief đặt tên các nhánh bằng tiếng Việt
 * (`SAI_DINH_DANG`/`SAI_MA`/`DA_DUNG`). Quy ước của dự án là MẶT TIỀN CÔNG KHAI viết tiếng Anh
 * — và các thành viên của một union chuỗi LÀ mặt tiền: chúng là giá trị mà tầng API sẽ ánh xạ
 * ra mã lỗi HTTP và ghi vào log, ngang hàng với `PERMISSIONS` (`rfq.create`) và tên các lớp lỗi
 * (`PermissionDeniedError`). Chú thích, tên biến cục bộ và tên test vẫn tiếng Việt.
 */
export type TotpFailureReason = "MALFORMED_CODE" | "WRONG_CODE" | "CODE_ALREADY_USED";

export type TotpResult =
  | { readonly ok: true; readonly counter: number }
  | { readonly ok: false; readonly reason: TotpFailureReason };

/**
 * Bí mật TOTP mới, 20 byte theo RFC 4226 §4 (độ dài khoá HMAC-SHA1 được khuyến nghị).
 *
 * [CẤM LOG] Giá trị trả về là BÍ MẬT ngang hàng với mật khẩu. Nó KHÔNG được đi vào log, thông
 * báo lỗi, sổ kiểm toán, hay bất kỳ chuỗi nào. Đó là lý do gói này KHÔNG có hàm nào dựng URI
 * `otpauth://` hay mã QR: một đường như thế mang bí mật ở dạng RÕ và base32, và nó là đường dễ
 * nhất để bí mật rơi vào một dòng log. Khi đường ghi danh được viết (task sau), nó phải trả bí
 * mật thẳng cho client trong một response không được ghi log, và phải có test khẳng định điều
 * đó — không phải một lời hứa trong chú thích.
 */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** Số bước 30 giây kể từ epoch. */
export function counterForTime(epochMs: number): number {
  if (!Number.isFinite(epochMs)) {
    // Cố ý KHÔNG nội suy giá trị nhận được: cùng kỷ luật với TenantError và
    // PermissionDeniedError — khuôn "ném đầu vào vào message" là thứ được sao chép sang chỗ mà
    // đầu vào ĐÚNG LÀ bí mật.
    throw new RangeError("counterForTime: epochMs phải là một số hữu hạn.");
  }
  return Math.floor(epochMs / 1000 / STEP_SECONDS);
}

/**
 * HOTP theo RFC 4226 với phép cắt động, dùng làm nền cho TOTP theo RFC 6238.
 *
 * `counter` âm bị TỪ CHỐI thay vì để `writeBigUInt64BE` ném một `RangeError` khó đọc: bộ đếm
 * âm nghĩa là thời điểm trước epoch, tức một lỗi lập trình, và một thông báo mờ ở đây sẽ tốn
 * thời gian của người đang điều tra một lỗi đăng nhập.
 */
export function deriveTotpCode(secret: Buffer, counter: number): string {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new RangeError("deriveTotpCode: counter phải là số nguyên không âm.");
  }

  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Kiểm tra mã TOTP.
 *
 * [INV-E3(5)] SO SÁNH BẰNG `timingSafeEqual`, VÀ DUYỆT HẾT CỬA SỔ TRƯỢT. So sánh chuỗi thông
 * thường (`===`) thoát sớm ở ký tự đầu khác nhau, và độ chênh thời gian đó đủ để dò từng chữ số
 * một khi kẻ tấn công gửi đủ nhiều yêu cầu. Vòng lặp KHÔNG `break` khi khớp, cũng vì lý do đó:
 * dừng sớm làm thời gian chạy phụ thuộc VỊ TRÍ bước khớp, tức rò rỉ độ lệch đồng hồ của thiết
 * bị người dùng.
 *
 * PHẠM VI CỦA BẢO ĐẢM NÀY, nói đúng mức: nó là hằng-thời-gian theo NỘI DUNG của mã, KHÔNG theo
 * mọi thứ khác. Ba thứ vẫn quan sát được từ bên ngoài và cố ý không bị che ở tầng này:
 *   * `MALFORMED_CODE` trả về TRƯỚC mọi phép băm — một mã sai định dạng nhanh hơn hẳn. Vô hại:
 *     hình dạng của mã là thứ client đã biết.
 *   * `CODE_ALREADY_USED` được phán sau khi đã khớp, nên nó chậm hơn `WRONG_CODE` không đáng
 *     kể, nhưng KHÔNG bằng nhau.
 *   * Ở tầng trên (`mfa-credentials.ts`) mỗi nhánh làm một lượng việc CSDL khác nhau; tổng thời
 *     gian một request KHÔNG hằng số và file này không mua được điều đó.
 *
 * `lastUsedCounter` là vế E3(4) ở dạng KHÔNG BỀN VỮNG: hàm này không nhớ gì giữa hai lời gọi.
 * Người gọi phải lấy giá trị đó từ `mfa_credentials.last_used_counter` và ghi lại giá trị mới
 * một cách NGUYÊN TỬ — xem `verifyTotpAttempt`.
 *
 * HAI MŨI ĐỘT BIẾN SỐNG SÓT Ở ĐÂY, ghi ra thay vì để chúng trông như hàng rào có mốc chết:
 *   * `timingSafeEqual(mong, daNhap)` -> `mong.equals(daNhap)`  : SỐNG SÓT (22/22 test xanh).
 *   * bỏ `&& khop === null` và `break` khi khớp                : SỐNG SÓT (22/22 test xanh).
 * CẢ HAI ĐÚNG NHƯ PHẢI THẾ, và lý do là ĐỊNH NGHĨA chứ không phải thiếu sót: tính chất mà hai
 * dòng ấy mua là THỜI GIAN CHẠY, thứ mà một khẳng định về GIÁ TRỊ TRẢ VỀ không quan sát được.
 * Chúng KHÔNG phải dư thừa logic (gỡ đi là mở lại một kênh phụ có thật), và cũng KHÔNG phải
 * fail-open (kết cục vẫn đúng). Một mốc chết thật cho trục này đòi phép đo thống kê thời gian —
 * thứ nổi tiếng là bất ổn trên máy CI và sẽ trở thành một test flaky, tức tệ hơn không có. Nói
 * thẳng phạm vi: hôm nay hai dòng này được giữ bằng KỶ LUẬT VÀ CHÚ THÍCH, không bằng một test.
 */
export function verifyTotpCode(
  secret: Buffer,
  code: string,
  options: TotpVerifyOptions = {},
): TotpResult {
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: "MALFORMED_CODE" };

  const now = options.now ?? Date.now();
  const window = options.window ?? DEFAULT_WINDOW;
  khangDinhCuaSo(window, "verifyTotpCode");

  const hienTai = counterForTime(now);
  const daNhap = Buffer.from(code, "ascii");

  let khop: number | null = null;
  for (let lech = -window; lech <= window; lech += 1) {
    const buoc = hienTai + lech;
    // Bộ đếm âm chỉ xảy ra trong 60 giây đầu của epoch (tức chỉ trong test). Bỏ qua nhánh đó
    // thay vì để `deriveTotpCode` ném: điều kiện phụ thuộc `now`, KHÔNG phụ thuộc mã hay bí
    // mật, nên nó không mở một kênh phụ nào.
    if (buoc < 0) continue;
    const mong = Buffer.from(deriveTotpCode(secret, buoc), "ascii");
    if (timingSafeEqual(mong, daNhap) && khop === null) {
      khop = buoc;
    }
  }

  if (khop === null) return { ok: false, reason: "WRONG_CODE" };

  const daDung = options.lastUsedCounter;
  if (typeof daDung === "number" && khop <= daDung) {
    return { ok: false, reason: "CODE_ALREADY_USED" };
  }

  return { ok: true, counter: khop };
}

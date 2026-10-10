// ==============================================================================================
// [khoản 9402] CHỜ QUA MỐC LẬT CỦA MỘT BỘ ĐẾM CỬA SỔ CỐ ĐỊNH
//
// Hai bộ đếm hạn mức của dự án — `tangBucketNguoiGoi` (`caller_rate_limits`) và `demVaTang` (`otp_rate_limits`) — đếm theo
// cửa sổ CỐ ĐỊNH neo vào đồng hồ CSDL: `window_start = floor(epoch(now()) / 900) * 900`. Cửa sổ lật đúng vào :00, :15, :30,
// :45. Một test đếm tới trần rồi đòi lần N+1 bị chặn chỉ đúng khi CẢ chuỗi rơi vào MỘT cửa sổ: chuỗi vắt qua mốc thì lần N+1
// là lần ĐẦU của cửa sổ mới và đi qua. Đo: ca ⒨ của `apps/api/src/auth.int.test.ts` (khoá chuỗi sổ bị giữ, ba lần chờ trần 2 s
// ⇒ ~6,5 s) chạy lúc ~22:29:40–22:30 trong lượt evidence ngày 2026-10-08 và nhận 403 thay vì 429. Xác suất mỗi chuỗi xấp xỉ
// thời lượng của nó chia 900 s — nhỏ, nhưng có ở MỌI chuỗi như thế, và lớn lên đúng khi máy bận.
//
// Hàm này đặt trong `beforeEach` của tệp có chuỗi như thế: còn ít hơn `bienGiay` tới mốc kế tiếp thì NGỦ qua mốc thêm một
// giây; không thì trả ngay. Giờ là giờ CSDL — `now()` của giao dịch đếm — không phải giờ tiến trình: đồng hồ container từng
// chậm 6 giờ 22 phút sau một đêm máy ngủ (khoản 196), nên đọc qua `doLechDongHo`, câu đọc đồng hồ đã có của `@trustprocure/db`.
// Hook chạy dưới `hookTimeout` (180 s), không ăn vào trần của test.
// ==============================================================================================
import { doLechDongHo, type DongHo, type NguonTruyVan } from "@trustprocure/db";

export interface TuyChonMocCuaSo {
  /** Độ dài cửa sổ của bộ đếm, giây — `OTP_RATE_WINDOW_SECONDS` cho cả hai bộ đếm hiện có. */
  readonly cuaSoGiay: number;
  /** Còn ít hơn chừng này giây tới mốc kế tiếp thì chờ qua mốc. Phải ngắn hơn cửa sổ. */
  readonly bienGiay: number;
  /** Đồng hồ tiến trình — tiêm được để đo; mặc định `Date.now`. */
  readonly dongHo?: DongHo;
  /** Hàm ngủ — tiêm được để đo; mặc định `setTimeout`. */
  readonly ngu?: (ms: number) => Promise<void>;
}

/** Số mili-giây từ `csdlMs` tới mốc lật kế tiếp của một cửa sổ `cuaSoGiay` neo vào epoch. Luôn trong (0, cửa sổ]. */
export function msToiMocKeTiep(csdlMs: number, cuaSoGiay: number): number {
  const cuaSoMs = cuaSoGiay * 1000;
  return cuaSoMs - (((csdlMs % cuaSoMs) + cuaSoMs) % cuaSoMs);
}

/** Chờ qua mốc lật nếu đang sát mốc. Trả số mili-giây đã ngủ (0 khi không chờ). */
export async function choQuaMocCuaSo(nguon: NguonTruyVan, tc: TuyChonMocCuaSo): Promise<number> {
  if (!(tc.bienGiay > 0 && tc.bienGiay < tc.cuaSoGiay)) {
    throw new RangeError(`choQuaMocCuaSo: bienGiay (${String(tc.bienGiay)}) phải dương và ngắn hơn cửa sổ (${String(tc.cuaSoGiay)})`);
  }
  const dongHo = tc.dongHo ?? Date.now;
  const { lechMs } = await doLechDongHo(nguon, dongHo);
  const conLai = msToiMocKeTiep(dongHo() + lechMs, tc.cuaSoGiay);
  if (conLai >= tc.bienGiay * 1000) return 0;
  const choMs = Math.ceil(conLai) + 1000;
  await (tc.ngu ?? ((ms: number) => new Promise<void>((xong) => setTimeout(xong, ms))))(choMs);
  return choMs;
}

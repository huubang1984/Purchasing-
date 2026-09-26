// ==============================================================================================
// [khoản 196 / ADR-069 phần 3] TRANG NỘP ĐẾM THEO GIỜ MÁY CHỦ, KHÔNG THEO GIỜ MÁY NGƯỜI DÙNG TRẦN
//
// Hạn nộp được phán xử bằng `now()` của CSDL (C1). Trang nộp thầu trước vòng này in hạn bằng
// `toLocaleString` và KHÔNG nói gì về đồng hồ: một máy người dùng chạy chậm mười phút thấy "còn
// mười phút" đúng lúc hệ thống đã đóng cửa. Tệp này là phép tính của phía trình duyệt:
//
//   ⑴ `doLechMayChu` — độ lệch giữa giờ máy chủ (trường `gioMayChu` của `GET /guest/rfq`, đọc
//      từ `clock_timestamp()` của CSDL) và giờ máy này, so với ĐIỂM GIỮA khứ hồi của chính lời gọi
//      ấy — cùng khuôn `packages/db/src/lech-dong-ho.ts` ở phía máy chủ;
//   ⑵ `conLaiMs` — thời gian còn lại tới hạn theo giờ máy chủ ƯỚC TÍNH = giờ máy này + độ lệch;
//   ⑶ ba bộ mô tả cho người đọc.
//
// Cùng nguyên tắc với `so-tien.ts`: tệp `.ts` được tsc gác và vitest đo, máy chủ web gỡ kiểu và
// phục vụ nó ở `/lib/dong-ho-may-chu.js`. `nop-thau.js` KHÔNG tính giờ nội tuyến.
//
// Một điều tệp này KHÔNG làm: quyết định còn hạn hay không. Nút nộp không bị khoá theo phép tính
// này — phán quyết thuộc về CSDL (ADR-005), và một phép tính phía trình duyệt khoá nhầm một người
// còn hạn là một lỗi nặng hơn một con số hiển thị lệch vài trăm mili-giây.
// ==============================================================================================

/** Dạng chính tắc của biên nhận: `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC, sáu chữ số micro-giây). */
const DANG_CHINH_TAC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/u;

/**
 * Đọc một dấu thời gian chính tắc thành mili-giây kể từ epoch. Cắt phần micro-giây về mili-giây
 * TRƯỚC khi đưa cho `Date.parse` — định dạng chuẩn của ECMAScript chỉ có ba chữ số, và một chuỗi
 * sáu chữ số được hay không được chấp nhận là tuỳ bộ máy. Không đúng dạng ⇒ `null`.
 */
export function docDauThoiGian(chuoi: unknown): number | null {
  if (typeof chuoi !== "string") return null;
  const m = DANG_CHINH_TAC.exec(chuoi);
  if (m === null) return null;
  const ms = Date.parse(`${m[1] ?? ""}.${(m[2] ?? "").slice(0, 3)}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Giờ máy chủ trừ giờ máy này, ms — dương khi máy này CHẬM. `guiLuc`/`nhanLuc` là giờ máy này ngay
 * trước khi gửi và ngay sau khi nhận lời gọi mang `gioMayChu`; giờ máy chủ được so với điểm giữa.
 * `gioMayChu` hỏng ⇒ `null`, và trang rơi về hiển thị không đếm ngược chứ không đoán.
 */
export function doLechMayChu(gioMayChu: unknown, guiLuc: number, nhanLuc: number): number | null {
  const may = docDauThoiGian(gioMayChu);
  if (may === null) return null;
  return may - (guiLuc + (nhanLuc - guiLuc) / 2);
}

/** Còn bao nhiêu ms tới `han` theo giờ máy chủ ước tính (`bayGio` là giờ máy này). Âm ⇒ đã qua. */
export function conLaiMs(han: number, lechMs: number, bayGio: number): number {
  return han - (bayGio + lechMs);
}

const hai = (n: number): string => String(n).padStart(2, "0");

/** `Còn 2 ngày 03:04:05` / `Còn 00:00:09` / `Đã quá hạn theo giờ hệ thống`. */
export function moTaConLai(ms: number): string {
  if (ms <= 0) return "Đã quá hạn theo giờ hệ thống";
  const giay = Math.floor(ms / 1000);
  const ngay = Math.floor(giay / 86_400);
  const gio = Math.floor((giay % 86_400) / 3600);
  const phut = Math.floor((giay % 3600) / 60);
  const s = giay % 60;
  return `Còn ${ngay > 0 ? `${ngay} ngày ` : ""}${hai(gio)}:${hai(phut)}:${hai(s)}`;
}

/** Độ dài của một khoảng, cho người đọc: `6 giờ 22 phút`, `12 phút 5 giây`, `3 giây`. */
export function moTaKhoang(ms: number): string {
  const giay = Math.round(Math.abs(ms) / 1000);
  const gio = Math.floor(giay / 3600);
  const phut = Math.floor((giay % 3600) / 60);
  const s = giay % 60;
  if (gio > 0) return `${gio} giờ ${phut} phút`;
  if (phut > 0) return `${phut} phút ${s} giây`;
  return `${s} giây`;
}

/** Ngưỡng mà dưới nó trang không nói gì về đồng hồ máy người dùng — cùng con số với ngưỡng phía máy chủ. */
export const NGUONG_BAO_LECH_MS = 2000;

/** Một câu cảnh báo khi đồng hồ máy người dùng lệch giờ hệ thống quá ngưỡng; chuỗi rỗng khi không. */
export function moTaLechMay(lechMs: number): string {
  if (Math.abs(lechMs) <= NGUONG_BAO_LECH_MS) return "";
  const chieu = lechMs > 0 ? "chậm" : "nhanh";
  return (
    `Đồng hồ máy của anh/chị ${chieu} ${moTaKhoang(lechMs)} so với giờ hệ thống. ` +
    "Hạn nộp được tính theo giờ hệ thống — đếm ngược dưới đây đã trừ độ lệch ấy."
  );
}

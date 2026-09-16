// ==============================================================================================
// apps/mcp/src/duong-dan.ts — DỰNG ĐƯỜNG DẪN TỪ MỘT CÔNG CỤ VÀ THAM SỐ CỦA NGƯỜI LẠ. FAIL-CLOSED.
//
// Đây là nơi lời khai "MCP chỉ đọc, và không đọc bảng so sánh giá" (ADR-038) đứng hay đổ: bảng
// công cụ chỉ khai MẪU đường dẫn, còn thứ thật sự gửi đi là chuỗi hàm này trả về. Lý do từng ca
// chặn, kèm ba đường tấn công cụ thể, nằm ở khối đầu `duong-dan.test.ts`.
//
// VÌ SAO TỪ CHỐI CHỨ KHÔNG MÃ HOÁ: `encodeURIComponent` biến `abc/comparison` thành một id hợp lệ
// về cú pháp và gửi đi — API trả 404, không ai thấy gì. Một lần thử đi tới `/comparison` là một
// SỰ KIỆN, không phải một lỗi đánh máy cần được sửa giúp.
// ==============================================================================================

import type { CongCuMcp } from "./cong-cu.js";

/** Tham số không dùng được. Thông điệp nêu TÊN tham số, không bao giờ nêu GIÁ TRỊ. */
export class ThamSoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThamSoError";
  }
}

/**
 * Hình dạng DUY NHẤT một tham số đường dẫn được phép mang.
 *
 * Route của `apps/api` nhận UUID; tập này rộng hơn UUID một chút (chữ, số, `-`, `_`) để không ghim
 * MCP vào một dạng id mà api có thể đổi, nhưng nó không chứa `/`, `?`, `#`, `%`, `\`, khoảng
 * trắng, ký tự điều khiển — tức không ký tự nào đổi được Ý NGHĨA của đường dẫn.
 */
const HINH_DANG_THAM_SO = /^[A-Za-z0-9_-]{1,64}$/u;

/**
 * Đường dẫn THẬT gửi tới `apps/api`, hoặc ném.
 *
 * Ba vế, tất cả fail-closed:
 *   ⑴ mọi tham số mà mẫu đòi phải CÓ MẶT và là chuỗi đúng hình dạng;
 *   ⑵ không được có tham số LẠ — một khoá không hiểu là một lời gọi không hiểu;
 *   ⑶ chuỗi trả về không còn `:` của mẫu nào (vế này là đối chứng cho chính ⑴).
 */
export function dungDuongDan(
  pCongCu: CongCuMcp,
  pThamSo: Readonly<Record<string, unknown>>,
): string {
  const daKhai = new Set(pCongCu.thamSo);
  for (const khoa of Object.keys(pThamSo)) {
    if (!daKhai.has(khoa)) {
      throw new ThamSoError(
        `công cụ "${pCongCu.ten}" không có tham số "${khoa}" — lời gọi không khớp bảng công cụ`,
      );
    }
  }

  const doan = pCongCu.path.split("/").map((d) => {
    if (!d.startsWith(":")) return d;
    const ten = d.slice(1);
    const gt: unknown = pThamSo[ten];
    if (typeof gt !== "string") {
      throw new ThamSoError(`tham số "${ten}" của công cụ "${pCongCu.ten}" thiếu hoặc không phải chuỗi`);
    }
    if (!HINH_DANG_THAM_SO.test(gt)) {
      throw new ThamSoError(
        `tham số "${ten}" của công cụ "${pCongCu.ten}" sai hình dạng — chỉ chữ, số, "-" và "_", ` +
          "tối đa 64 ký tự. Giá trị KHÔNG được ghi lại ở đây.",
      );
    }
    return gt;
  });

  const duong = doan.join("/");
  // Đối chứng ⑶: nếu còn một `:` của mẫu thì vòng trên đã bỏ sót một đoạn — ném thay vì gửi đi.
  if (duong.split("/").some((d) => d.startsWith(":"))) {
    throw new ThamSoError(`công cụ "${pCongCu.ten}" còn tham số chưa thay — đường dẫn không dựng được`);
  }
  return duong;
}

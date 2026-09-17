// ==============================================================================================
// apps/mcp/src/vong-lap.ts — MỖI DÒNG VÀO LÀ MỘT YÊU CẦU, MỖI PHẢN HỒI LÀ MỘT DÒNG RA
//
// Tách khỏi `main.ts` vì cùng lý do `cau-hinh.ts` tách khỏi `composition.ts` ở `apps/api`: file
// này không chạm `process`, nên mọi ca — JSON hỏng, notification, lời hứa bị từ chối — đo được ở
// T1 mà không cần một tiến trình. `main.ts` chỉ nối stdin/stdout vào đây.
// ==============================================================================================

import { xuLyYeuCau, type PhuThuoc } from "./giao-thuc.js";
import { taoBoGomDong, type BoGomDong } from "./khung-dong.js";

export interface PhuThuocVongLap extends PhuThuoc {
  /** Ghi MỘT dòng JSON ra kênh giao thức (stdout trong sản xuất). */
  readonly ghi: (dong: string) => void;
  /** Ghi một dòng cho con người đọc (stderr trong sản xuất). KHÔNG mang nội dung thông điệp. */
  readonly ghiLog: (dong: string) => void;
  /**
   * Trần số lời gọi công cụ chạy CÙNG LÚC. Không khai ⇒ `TRAN_DONG_THOI`.
   *
   * [lượt soi 69 L-1] Bản đầu sinh ngay một `fetch` cho mỗi dòng, không hàng đợi, không trần: một
   * chunk stdin 10 MB chứa hàng chục nghìn `tools/call` hợp lệ mở hàng chục nghìn kết nối tới
   * `apps/api` DƯỚI PHIÊN CỦA NGƯỜI MUA THẬT — vừa là DoS lên chính MCP, vừa là khuếch đại lên api.
   */
  readonly tranDongThoi?: number;
}

/** Trần mặc định cho số lời gọi công cụ chạy cùng lúc. */
export const TRAN_DONG_THOI = 8;

function moTaLoi(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return "loi khong ro";
}

const laObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Thứ tự các phản hồi KHÔNG bảo đảm khớp thứ tự yêu cầu — JSON-RPC 2.0 cho phép, và máy khách
 * ghép bằng `id`. Nói ra vì đó là một lựa chọn: xếp hàng tuần tự sẽ để một lời gọi api chậm chặn
 * mọi lời gọi sau nó.
 */
export function taoVongLap(pt: PhuThuocVongLap): BoGomDong {
  const tran = pt.tranDongThoi ?? TRAN_DONG_THOI;
  let dangChay = 0;

  const traLoi = (phanHoi: object | null): void => {
    if (phanHoi === null) return;
    // [lượt soi 69 L-2] `pt.ghi` NÉM được: stdout bị huỷ cho `ERR_STREAM_DESTROYED`. Bản đầu để
    // lời hứa kết quả bị từ chối mà không ai bắt (`unhandledRejection` ⇒ Node 22 kết thúc tiến
    // trình), và ở nhánh -32700 thì tệ hơn — lời gọi ấy đồng bộ trong handler `data`, tức
    // `uncaughtException`.
    try {
      pt.ghi(JSON.stringify(phanHoi));
    } catch (e) {
      pt.ghiLog(`[mcp] khong ghi duoc phan hoi — ${moTaLoi(e)}`);
    }
  };

  return taoBoGomDong({
    khiQuaTran: (moTa) => {
      pt.ghiLog(`[mcp] ${moTa}`);
    },
    khiCoDong: (dong) => {
      let yeuCau: unknown;
      try {
        yeuCau = JSON.parse(dong);
      } catch {
        // -32700: dòng không phải JSON. `id` không đọc được nên `null` — JSON-RPC 2.0 §5.1.
        traLoi({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "dong khong phai JSON" },
        });
        return;
      }
      // [lượt soi 69 L-1] Quá trần thì TỪ CHỐI ngay, không xếp hàng vô hạn: một hàng đợi không
      // trần chỉ dời chỗ tích bộ nhớ từ socket sang đây. -32603 mang đúng nghĩa "máy chủ đang
      // không phục vụ được", và máy khách MCP thử lại được.
      if (laObject(yeuCau) && "id" in yeuCau && dangChay >= tran) {
        traLoi({
          jsonrpc: "2.0",
          id: (yeuCau as { id: unknown }).id,
          error: { code: -32603, message: `qua tran ${String(tran)} loi goi cung luc` },
        });
        return;
      }

      dangChay += 1;
      xuLyYeuCau(yeuCau, pt)
        .then(traLoi, (e: unknown) => {
          // Không để một lời hứa bị từ chối thoát ra: `unhandledRejection` giết tiến trình, và máy
          // khách mất cả phiên vì một yêu cầu hỏng.
          pt.ghiLog(`[mcp] xu ly that bai — ${moTaLoi(e)}`);
        })
        .finally(() => {
          dangChay -= 1;
        });
    },
  });
}

// ==============================================================================================
// apps/mcp/src/khach-api.ts — LỜI GỌI RA NGOÀI DUY NHẤT CỦA TIẾN TRÌNH MCP
//
// `fetch` của Node, không thư viện HTTP nào — cùng lập luận ADR-020 dùng cho `node:http` trần ở
// `apps/api`, và cùng ràng buộc: `tests/architecture/pham-vi-san-xuat.test.ts` ghim đúng hai phụ
// thuộc ngoài ở phạm vi sản xuất.
//
// NĂM LỰA CHỌN FAIL-CLOSED, lý do đo được ở khối đầu `khach-api.test.ts`:
//   ⑴ `redirect: "manual"` — cookie phiên do TA đặt bằng tay, nên nó sẽ theo mọi chuyển hướng tới
//      bất kỳ host nào nếu để `fetch` tự đi. Luật same-origin của cookie là luật của TRÌNH DUYỆT,
//      không của `fetch` phía máy chủ. 3xx đi ra như một mã trạng thái, không như một lời mời;
//   ⑵ trần thời gian cho MỌI lời gọi, không có đường nào không có trần;
//   ⑶ [lượt soi 69 M-2] trần THÂN chặn TRƯỚC khi nạp: đọc theo stream, cộng byte, huỷ ngay khi
//      vượt. Bản đầu gọi `await phanHoi.text()` rồi mới so độ dài — tức đã nạp trọn một thân tuỳ
//      ý vào bộ nhớ trước khi nói "vượt trần";
//   ⑷ [lượt soi 69 L-5] URL dựng bằng `new URL(...)` rồi ĐỐI CHIẾU `origin`, không nối chuỗi.
//      Nối chuỗi làm một `path` tương lai thiếu gạch chéo đầu (`"rfqs/:rfqId"`) biến
//      `https://api.example.com` + `rfqs/x` thành một HOST KHÁC, và cookie đi theo;
//   ⑸ [lượt soi 69 L-6] cookie CHỈ đi kèm lời gọi cần nó — `/health` là route PUBLIC của
//      `apps/api` và không nhận chứng chỉ nào.
//
// Tiến trình này KHÔNG ghi log lời gọi. Không có dòng log nào thì không có dòng log nào lỡ mang
// cookie — và `main.ts` là nơi duy nhất được viết ra stderr.
// ==============================================================================================

import type { CauHinhMcp } from "./cau-hinh.js";
import type { GoiApi, KetQuaApi } from "./giao-thuc.js";

/**
 * Tên cookie phiên người mua của `apps/api` (`COOKIE_PHIEN_NGUOI_MUA`).
 *
 * Đây là một bản CHÉP, và nó được chép có chủ đích: khai `@trustprocure/api` ở `dependencies` của
 * MCP là kéo cả cây nghiệp vụ vào một tiến trình chỉ nói HTTP (xem khối đầu `cong-cu.test.ts`).
 * Bản chép không trôi được vì `khach-api.test.ts` đối chiếu nó với chính hằng số bên kia.
 */
export const TEN_COOKIE_PHIEN = "__Host-tp_session";

/**
 * Trần thân phản hồi, tính bằng BYTE THẬT (không phải đơn vị mã UTF-16 — lượt soi 69 L-4).
 *
 * Sống ở đây chứ không ở `giao-thuc.ts` vì đây là nơi DUY NHẤT nhìn thấy byte; `giao-thuc.ts` chỉ
 * đọc cờ `quaTran`. Đặt ngược lại sẽ tạo một cạnh `giao-thuc → khach-api` và đóng một vòng phụ
 * thuộc mà `khong-phu-thuoc-vong` của depcruise cấm.
 */
export const TRAN_THAN_BYTE = 256 * 1024;

/** Nhãn nhận dạng để `apps/api` phân biệt được lời gọi đến từ bề mặt agent với lời gọi của người. */
export const NHAN_MAY_KHACH = "trustprocure-mcp/0.1.0";

export function taoGoiApi(pCauHinh: CauHinhMcp): GoiApi {
  return async (method, duongDan, canPhien) => {
    // ⑷ Dựng rồi ĐỐI CHIẾU: `new URL` một mình không đủ — nó vui vẻ nhận một đường dẫn tuyệt đối.
    const u = new URL(duongDan, pCauHinh.apiBaseUrl);
    if (u.origin !== pCauHinh.apiBaseUrl) {
      throw new Error(`duong dan dung ra ngoai goc api da cau hinh: ${duongDan}`);
    }

    const phanHoi = await fetch(u, {
      method,
      headers: {
        accept: "application/json",
        "user-agent": NHAN_MAY_KHACH,
        // ⑸ Không có cookie trong lời gọi công khai.
        ...(canPhien ? { cookie: `${TEN_COOKIE_PHIEN}=${pCauHinh.sessionCookie}` } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(pCauHinh.timeoutMs),
    });

    const kieuNoiDung = phanHoi.headers.get("content-type");
    return { status: phanHoi.status, kieuNoiDung, ...(await docThan(phanHoi)) };
  };
}

/** ⑶ Đọc thân theo stream, dừng NGAY khi vượt trần. Không có bước "nạp trọn rồi mới đo". */
async function docThan(phanHoi: Response): Promise<Pick<KetQuaApi, "than" | "quaTran">> {
  const khai = phanHoi.headers.get("content-length");
  if (khai !== null && /^[0-9]+$/u.test(khai) && Number(khai) > TRAN_THAN_BYTE) {
    // Máy chủ tự khai đã vượt: không đọc một byte thân nào.
    await phanHoi.body?.cancel();
    return { than: "", quaTran: true };
  }

  const than = phanHoi.body;
  if (than === null) return { than: "", quaTran: false };

  // `Response.body` của Node 22 khai `ReadableStream<any>`, nên phải nói rõ kiểu ở đây thay vì để
  // `any` chảy vào phép cộng byte — eslint `no-unsafe-*` bắt đúng điều đó.
  const doc = than.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const cacDoan: Uint8Array[] = [];
  let soByte = 0;
  for (;;) {
    const { done, value } = await doc.read();
    if (done || value === undefined) break;
    soByte += value.byteLength;
    if (soByte > TRAN_THAN_BYTE) {
      await doc.cancel();
      return { than: "", quaTran: true };
    }
    cacDoan.push(value);
  }
  return { than: Buffer.concat(cacDoan).toString("utf8"), quaTran: false };
}

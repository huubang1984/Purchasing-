// ==============================================================================================
// VÒNG LẶP GIAO THỨC — BA LỚP RA ĐỜI TỪ LƯỢT SOI 69, VÀ CẢ BA PHẢI ĐO ĐƯỢC Ở T1
//
//   ⑴ [L-1] trần số lời gọi CÙNG LÚC. Không có nó, một chunk stdin chứa hàng chục nghìn
//      `tools/call` hợp lệ mở hàng chục nghìn kết nối tới `apps/api` DƯỚI PHIÊN NGƯỜI MUA THẬT —
//      vừa là DoS lên chính MCP, vừa là khuếch đại lên api. Trần phải TỪ CHỐI chứ không xếp hàng:
//      một hàng đợi không trần chỉ dời chỗ tích bộ nhớ từ socket sang bộ nhớ tiến trình.
//   ⑵ [L-2] `ghi` NÉM được (stdout bị huỷ ⇒ `ERR_STREAM_DESTROYED`). Bản đầu để lời hứa kết quả
//      bị từ chối mà không ai bắt — `unhandledRejection` giết tiến trình; ở nhánh -32700 thì lời
//      gọi ấy đồng bộ trong handler `data`, tức `uncaughtException`.
//   ⑶ dòng không phải JSON ⇒ -32700 với `id: null`, và phiên SỐNG TIẾP.
// ==============================================================================================

import { describe, expect, it, vi } from "vitest";
import { taoVongLap } from "./vong-lap.js";

interface LuotChay {
  readonly raGiaoThuc: string[];
  readonly raLog: string[];
}

function dung(
  goiApi: ReturnType<typeof vi.fn>,
  tuyChon: { tranDongThoi?: number; ghiNem?: boolean } = {},
): LuotChay & { nhan: (s: string) => void } {
  const raGiaoThuc: string[] = [];
  const raLog: string[] = [];
  const vongLap = taoVongLap({
    goiApi: goiApi as never,
    ghi: (d) => {
      if (tuyChon.ghiNem === true) throw new Error("ERR_STREAM_DESTROYED");
      raGiaoThuc.push(d);
    },
    ghiLog: (d) => raLog.push(d),
    ...(tuyChon.tranDongThoi === undefined ? {} : { tranDongThoi: tuyChon.tranDongThoi }),
  });
  return {
    raGiaoThuc,
    raLog,
    nhan: (s: string) => {
      vongLap.nhan(Buffer.from(s, "utf8"));
    },
  };
}

const goiThu = (id: number) =>
  `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "me" },
  })}\n`;

describe("vòng lặp giao thức", () => {
  it("⑶ dòng không phải JSON ⇒ -32700 id null, và dòng sau vẫn được xử lý", async () => {
    const api = vi.fn().mockResolvedValue({ status: 200, than: "{}", kieuNoiDung: "application/json", quaTran: false });
    const l = dung(api);
    l.nhan("khong phai JSON\n");
    l.nhan(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "ping" })}\n`);
    await vi.waitFor(() => {
      expect(l.raGiaoThuc.length).toBe(2);
    });
    expect(JSON.parse(l.raGiaoThuc[0] ?? "")).toMatchObject({ id: null, error: { code: -32700 } });
    expect(JSON.parse(l.raGiaoThuc[1] ?? "")).toMatchObject({ id: 5 });
  });

  // KHÔNG `async`: mọi khẳng định ở đây là ĐỒNG BỘ, và đó chính là điều đang được đo — lời gọi quá
  // trần phải bị từ chối NGAY trong lượt `nhan`, không phải sau một vòng vi-tác-vụ nào.
  it("⑴ quá trần lời gọi cùng lúc ⇒ -32603 NGAY, và api không được gọi thêm lần nào", () => {
    // `goiApi` không bao giờ giải quyết: ba lời gọi đầu chiếm trọn trần và ở đó.
    const api = vi.fn().mockReturnValue(new Promise(() => {}));
    const l = dung(api, { tranDongThoi: 3 });

    for (const id of [1, 2, 3]) l.nhan(goiThu(id));
    expect(api).toHaveBeenCalledTimes(3);
    expect(l.raGiaoThuc, "ba lời gọi đầu còn đang bay, chưa có phản hồi nào").toEqual([]);

    l.nhan(goiThu(4));
    l.nhan(goiThu(5));
    expect(api, "lời gọi quá trần KHÔNG được chạm api").toHaveBeenCalledTimes(3);
    expect(l.raGiaoThuc.length).toBe(2);
    expect(JSON.parse(l.raGiaoThuc[0] ?? "")).toMatchObject({ id: 4, error: { code: -32603 } });
    expect(JSON.parse(l.raGiaoThuc[1] ?? "")).toMatchObject({ id: 5, error: { code: -32603 } });
  });

  it("⑴ chỗ trong trần được TRẢ LẠI khi một lời gọi xong — trần không phải một lần khoá vĩnh viễn", async () => {
    let giaiQuyet: ((x: unknown) => void) | undefined;
    const api = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            giaiQuyet = res;
          }),
      )
      .mockResolvedValue({ status: 200, than: "{}", kieuNoiDung: "application/json", quaTran: false });
    const l = dung(api, { tranDongThoi: 1 });

    l.nhan(goiThu(1));
    l.nhan(goiThu(2));
    expect(JSON.parse(l.raGiaoThuc[0] ?? "")).toMatchObject({ id: 2, error: { code: -32603 } });

    giaiQuyet?.({ status: 200, than: "{}", kieuNoiDung: "application/json", quaTran: false });
    await vi.waitFor(() => {
      expect(l.raGiaoThuc.length).toBe(2);
    });

    l.nhan(goiThu(3));
    await vi.waitFor(() => {
      expect(l.raGiaoThuc.length).toBe(3);
    });
    expect(JSON.parse(l.raGiaoThuc[2] ?? "")).toMatchObject({ id: 3, result: {} });
  });

  it("⑵ `ghi` ném KHÔNG làm thoát một lời hứa bị từ chối — nó thành một dòng log", async () => {
    const api = vi.fn().mockResolvedValue({ status: 200, than: "{}", kieuNoiDung: "application/json", quaTran: false });
    const l = dung(api, { ghiNem: true });

    // Nhánh đồng bộ (-32700): ném ở đây là `uncaughtException` nếu không ai bắt.
    expect(() => {
      l.nhan("khong phai JSON\n");
    }).not.toThrow();
    // Nhánh bất đồng bộ (tools/call): ném ở đây là `unhandledRejection`.
    l.nhan(goiThu(7));
    await vi.waitFor(() => {
      expect(l.raLog.length).toBeGreaterThanOrEqual(2);
    });
    expect(l.raLog.every((d) => d.includes("khong ghi duoc phan hoi"))).toBe(true);
  });
});

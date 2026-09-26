// ==============================================================================================
// [ADR-083] DÒNG TỒN ĐỌNG OUTBOX — HÌNH DẠNG LÀ HỢP ĐỒNG VỚI METRIC FILTER, NÊN GHIM NGUYÊN VĂN
//
// Phần CSDL (`doTonDong` trong `withTenant`, cách ly tổ chức) đo ở
// `packages/outbox/src/ton-dong.int.test.ts`. Tệp này đo phần thuần: gộp (MAX tuổi, TỔNG số
// job), định dạng, chiều hỏng khi một tổ chức hay lời liệt kê ném, và vòng đời hẹn giờ.
// ==============================================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { canhTonDongDinhKy, doTonDongMotLuot, dongLogTonDong, gopTonDong } from "./canh-ton-dong.js";

/** Lỗi mang GIÁ TRỊ trong message — bên gọi không được để nó lọt; ở đây chỉ đếm là đã tới `baoLoi`. */
class LoiGia extends Error {
  constructor() {
    super("gia thau 123456789");
    this.name = "LoiGia";
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("[ADR-083] gộp và định dạng dòng tồn đọng", () => {
  it("dòng log đúng NGUYÊN VĂN — metric filter phụ thuộc nó", () => {
    expect(dongLogTonDong({ giay: 734, soJob: 12, soToChuc: 3 })).toBe(
      "[unseal-worker] outbox ton dong: 734 giay, 12 job qua han, 3 to chuc",
    );
    // ASCII thuần: không dấu tiếng Việt lọt vào (một ký tự ngoài ASCII là filter không khớp).
    expect(dongLogTonDong({ giay: 0, soJob: 0, soToChuc: 0 })).toMatch(/^[\x20-\x7e]+$/u);
  });

  it("tuổi là MAX qua các tổ chức, số job là TỔNG, số tổ chức là số phần tử", () => {
    expect(
      gopTonDong([
        { giay: 10, soJob: 1 },
        { giay: 900, soJob: 4 },
        { giay: 0, soJob: 0 },
        { giay: 300, soJob: 7 },
      ]),
    ).toEqual({ giay: 900, soJob: 12, soToChuc: 4 });
  });

  it("không tổ chức nào ⇒ 0 / 0 / 0", () => {
    expect(gopTonDong([])).toEqual({ giay: 0, soJob: 0, soToChuc: 0 });
  });
});

describe("[ADR-083] một lượt đo", () => {
  it("một tổ chức đo lỗi ⇒ báo lỗi, đi tiếp, dòng tổng chỉ đếm tổ chức ĐO ĐƯỢC", async () => {
    const ghi: string[] = [];
    const loi: unknown[] = [];
    const tong = await doTonDongMotLuot({
      lietKeToChuc: () => Promise.resolve(["a", "b", "c"]),
      doMotToChuc: (org) =>
        org === "b" ? Promise.reject(new LoiGia()) : Promise.resolve({ giay: org === "a" ? 50 : 20, soJob: 2 }),
      ghi: (d) => ghi.push(d),
      baoLoi: (e) => loi.push(e),
    });
    expect(tong).toEqual({ giay: 50, soJob: 4, soToChuc: 2 });
    expect(ghi).toEqual(["[unseal-worker] outbox ton dong: 50 giay, 4 job qua han, 2 to chuc"]);
    expect(loi).toHaveLength(1);
    expect(loi[0]).toBeInstanceOf(LoiGia);
  });

  it("MỌI tổ chức đo lỗi ⇒ KHÔNG ghi dòng tổng (không báo `0 giay` lúc đang mù)", async () => {
    const ghi: string[] = [];
    const loi: unknown[] = [];
    const tong = await doTonDongMotLuot({
      lietKeToChuc: () => Promise.resolve(["a", "b"]),
      doMotToChuc: () => Promise.reject(new LoiGia()),
      ghi: (d) => ghi.push(d),
      baoLoi: (e) => loi.push(e),
    });
    expect(tong).toBeUndefined();
    expect(ghi).toEqual([]);
    expect(loi).toHaveLength(2);
  });

  it("lời liệt kê ném ⇒ một lỗi, không dòng tổng, không ném ra ngoài", async () => {
    const ghi: string[] = [];
    const loi: unknown[] = [];
    await expect(
      doTonDongMotLuot({
        lietKeToChuc: () => Promise.reject(new LoiGia()),
        doMotToChuc: () => Promise.resolve({ giay: 1, soJob: 1 }),
        ghi: (d) => ghi.push(d),
        baoLoi: (e) => loi.push(e),
      }),
    ).resolves.toBeUndefined();
    expect(ghi).toEqual([]);
    expect(loi).toHaveLength(1);
  });
});

describe("[ADR-083] vòng đời hẹn giờ", () => {
  it("đo một lần sau `treDauMs`, rồi mỗi `chuKyMs`; hàm dừng huỷ cả hai", async () => {
    vi.useFakeTimers();
    const ghi: string[] = [];
    const dung = canhTonDongDinhKy({
      chuKyMs: 10_000,
      treDauMs: 500,
      lietKeToChuc: () => Promise.resolve(["a"]),
      doMotToChuc: () => Promise.resolve({ giay: 7, soJob: 1 }),
      ghi: (d) => ghi.push(d),
      baoLoi: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(ghi).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ghi).toEqual(["[unseal-worker] outbox ton dong: 7 giay, 1 job qua han, 1 to chuc"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ghi).toHaveLength(2);
    dung();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ghi).toHaveLength(2);
  });

  it("dừng giữa một lượt đang dở ⇒ kết quả của lượt ấy bị NUỐT, không ghi sau khi đã dừng", async () => {
    vi.useFakeTimers();
    const ghi: string[] = [];
    let nhaDo: ((v: { giay: number; soJob: number }) => void) | undefined;
    const dung = canhTonDongDinhKy({
      chuKyMs: 10_000,
      treDauMs: 100,
      lietKeToChuc: () => Promise.resolve(["a"]),
      doMotToChuc: () =>
        new Promise((r) => {
          nhaDo = r;
        }),
      ghi: (d) => ghi.push(d),
      baoLoi: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(nhaDo).toBeDefined();
    dung();
    nhaDo!({ giay: 1, soJob: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(ghi).toEqual([]);
  });

  it("một lượt chưa xong thì nhịp sau BỎ QUA thay vì chồng lượt", async () => {
    vi.useFakeTimers();
    let soLanLietKe = 0;
    const dung = canhTonDongDinhKy({
      chuKyMs: 1_000,
      treDauMs: 1_000,
      lietKeToChuc: () => {
        soLanLietKe += 1;
        return new Promise<readonly string[]>(() => undefined);
      },
      doMotToChuc: () => Promise.resolve({ giay: 0, soJob: 0 }),
      ghi: () => undefined,
      baoLoi: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(soLanLietKe).toBe(1);
    dung();
  });
});

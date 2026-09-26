// [khoản 196 / ADR-072 phần 1] Phép đo lệch đồng hồ — thuần, không CSDL: nguồn truy vấn và đồng hồ
// tiến trình đều tiêm, nên từng vế của phép đo (điểm giữa khứ hồi, lần khứ hồi ngắn nhất, trị tuyệt
// đối của ngưỡng) đo được bằng những con số viết tay.
import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import {
  LechDongHoError,
  canhLechDongHoDinhKy,
  doLechDongHo,
  kiemLechDongHo,
  type NguonTruyVan,
} from "./lech-dong-ho.js";

/** Nguồn giả: mỗi lời gọi trả `giờ CSDL` kế tiếp trong danh sách. */
function nguonGia(gioCsdl: readonly unknown[]): NguonTruyVan & { soLan: () => number } {
  let i = 0;
  return {
    soLan: () => i,
    query<R extends pg.QueryResultRow>(): Promise<pg.QueryResult<R>> {
      const ms = gioCsdl[Math.min(i, gioCsdl.length - 1)];
      i += 1;
      return Promise.resolve({ rows: [{ ms }] } as unknown as pg.QueryResult<R>);
    },
  };
}

/** Đồng hồ giả: trả lần lượt các giá trị cho trước. */
function dongHoGia(moc: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = moc[Math.min(i, moc.length - 1)] ?? 0;
    i += 1;
    return v;
  };
}

describe("[khoản 196] doLechDongHo", () => {
  it("so giờ CSDL với ĐIỂM GIỮA khứ hồi, không với t0 hay t1", async () => {
    // Ba lần đo giống nhau: t0 = 1000, t1 = 1100 ⇒ điểm giữa 1050; CSDL nói 6050 ⇒ lệch +5000.
    const p = await doLechDongHo(nguonGia([6050, 6050, 6050]), dongHoGia([1000, 1100, 1000, 1100, 1000, 1100]));
    expect(p.khuHoiMs).toBe(100);
    expect(p.lechMs).toBe(5000);
  });

  it("giữ lần có khứ hồi NGẮN NHẤT trong ba lần", async () => {
    // Lần 1: khứ hồi 900 ms, lệch đo được +450; lần 2: khứ hồi 10 ms, lệch +3; lần 3: khứ hồi 500 ms.
    const p = await doLechDongHo(
      nguonGia([1900, 2008, 3500]),
      dongHoGia([1000, 1900, 2000, 2010, 3000, 3500]),
    );
    expect(p.khuHoiMs).toBe(10);
    expect(p.lechMs).toBe(3);
  });

  it("câu đọc không trả một số hữu hạn ⇒ NÉM, không đọc thành 'khớp'", async () => {
    await expect(doLechDongHo(nguonGia(["khong phai so"]))).rejects.toThrow(/không đọc được đồng hồ CSDL/u);
    await expect(doLechDongHo(nguonGia([Number.NaN]))).rejects.toThrow(/không đọc được đồng hồ CSDL/u);
  });
});

describe("[khoản 196] kiemLechDongHo — đường khởi động", () => {
  it("lệch quá ngưỡng ở CẢ HAI chiều ⇒ LechDongHoError có tên, chỉ mang ba con số", async () => {
    const nhanh = await kiemLechDongHo(nguonGia([10_000]), 2000, () => 0).catch((e: unknown) => e);
    expect(nhanh).toBeInstanceOf(LechDongHoError);
    expect((nhanh as Error).name).toBe("LechDongHoError");
    expect((nhanh as Error).message).toContain("+10000 ms");
    expect((nhanh as Error).message).toContain("ngưỡng 2000 ms");
    const cham = await kiemLechDongHo(nguonGia([-22_920_000]), 2000, () => 0).catch((e: unknown) => e);
    expect((cham as LechDongHoError).lechMs).toBe(-22_920_000);
  });

  it("ĐỐI CHỨNG: lệch trong ngưỡng ⇒ không ném, trả phép đo", async () => {
    await expect(kiemLechDongHo(nguonGia([1999]), 2000, () => 0)).resolves.toMatchObject({ lechMs: 1999 });
    await expect(kiemLechDongHo(nguonGia([-1999]), 2000, () => 0)).resolves.toMatchObject({ lechMs: -1999 });
  });
});

describe("[khoản 196] canhLechDongHoDinhKy — đường lúc chạy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("vượt ngưỡng ⇒ gọi baoLech, KHÔNG ném; lần đo hỏng ⇒ gọi baoLoi; dừng thì thôi đo", async () => {
    vi.useFakeTimers();
    const lech: number[] = [];
    const loi: unknown[] = [];
    let gio = 0;
    const nguon: NguonTruyVan = {
      query<R extends pg.QueryResultRow>(): Promise<pg.QueryResult<R>> {
        if (gio === 2) return Promise.reject(new Error("mat ket noi"));
        return Promise.resolve({ rows: [{ ms: gio === 0 ? 100 : 50_000 }] } as unknown as pg.QueryResult<R>);
      },
    };
    const dung = canhLechDongHoDinhKy({
      nguon,
      nguongMs: 2000,
      chuKyMs: 1000,
      dongHo: () => 0,
      baoLech: (p) => lech.push(p.lechMs),
      baoLoi: (e) => loi.push(e),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lech).toEqual([]);
    gio = 1;
    await vi.advanceTimersByTimeAsync(1000);
    expect(lech).toEqual([50_000]);
    gio = 2;
    await vi.advanceTimersByTimeAsync(1000);
    expect(loi).toHaveLength(1);
    dung();
    gio = 1;
    await vi.advanceTimersByTimeAsync(5000);
    expect(lech).toEqual([50_000]);
  });
});

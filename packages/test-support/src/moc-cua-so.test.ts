// [khoản 346] `choQuaMocCuaSo` — chờ khi giờ CSDL sát mốc lật, không chờ khi xa; giờ là giờ CSDL, không phải giờ tiến trình.
import { describe, expect, it } from "vitest";
import type { NguonTruyVan } from "@trustprocure/db";
import { choQuaMocCuaSo, msToiMocKeTiep } from "./moc-cua-so.js";

const CUA_SO = 900;
/** Một mốc lật thật: bội của 900 s kể từ epoch (2026-10-08T15:30:00Z = 22:30 giờ Hà Nội). */
const MOC = Date.UTC(2026, 9, 8, 15, 30, 0);

/** Nguồn truy vấn giả: câu đọc đồng hồ CSDL trả `csdlMs`. */
function csdlTai(csdlMs: number): NguonTruyVan {
  return { query: () => Promise.resolve({ rows: [{ ms: csdlMs }] }) } as unknown as NguonTruyVan;
}

describe("[khoản 346] msToiMocKeTiep", () => {
  it("đúng mốc là trọn một cửa sổ, sát trước mốc là phần còn lại, trước epoch vẫn dương", () => {
    expect(MOC % (CUA_SO * 1000)).toBe(0);
    expect(msToiMocKeTiep(MOC, CUA_SO)).toBe(900_000);
    expect(msToiMocKeTiep(MOC - 5_000, CUA_SO)).toBe(5_000);
    expect(msToiMocKeTiep(MOC + 1, CUA_SO)).toBe(899_999);
    expect(msToiMocKeTiep(-1, CUA_SO)).toBe(1);
  });
});

describe("[khoản 346] choQuaMocCuaSo", () => {
  it("giờ CSDL còn 5 s tới mốc, biên 60 s ⇒ ngủ qua mốc thêm một giây (6 000 ms)", async () => {
    const ngu: number[] = [];
    const da = await choQuaMocCuaSo(csdlTai(MOC - 5_000), {
      cuaSoGiay: CUA_SO,
      bienGiay: 60,
      dongHo: () => MOC - 5_000,
      ngu: (ms) => {
        ngu.push(ms);
        return Promise.resolve();
      },
    });
    expect([da, ngu]).toEqual([6_000, [6_000]]);
  });

  it("xa mốc ⇒ không ngủ", async () => {
    const ngu: number[] = [];
    const da = await choQuaMocCuaSo(csdlTai(MOC - 120_000), {
      cuaSoGiay: CUA_SO,
      bienGiay: 60,
      dongHo: () => MOC - 120_000,
      ngu: (ms) => {
        ngu.push(ms);
        return Promise.resolve();
      },
    });
    expect([da, ngu]).toEqual([0, []]);
  });

  it("đọc giờ CSDL, không giờ tiến trình: tiến trình xa mốc mà CSDL sát mốc ⇒ ngủ; ngược lại ⇒ không", async () => {
    const ngu: number[] = [];
    const ghi = (ms: number): Promise<void> => {
      ngu.push(ms);
      return Promise.resolve();
    };
    // CSDL chậm 6 giờ 22 phút như lần đo của khoản 196, và đang còn 10 s tới mốc của chính nó.
    const lech = -(6 * 3600 + 22 * 60) * 1000;
    expect(await choQuaMocCuaSo(csdlTai(MOC - 10_000), { cuaSoGiay: CUA_SO, bienGiay: 60, dongHo: () => MOC - 10_000 - lech, ngu: ghi })).toBe(11_000);
    // Tiến trình còn 10 s tới mốc, CSDL còn 7 phút.
    expect(await choQuaMocCuaSo(csdlTai(MOC - 420_000), { cuaSoGiay: CUA_SO, bienGiay: 60, dongHo: () => MOC - 10_000, ngu: ghi })).toBe(0);
    expect(ngu).toEqual([11_000]);
  });

  it("biên không dương hay không ngắn hơn cửa sổ ⇒ RangeError, không đọc đồng hồ", async () => {
    let doc = 0;
    const nguon = {
      query: () => {
        doc += 1;
        return Promise.resolve({ rows: [{ ms: MOC }] });
      },
    } as unknown as NguonTruyVan;
    await expect(choQuaMocCuaSo(nguon, { cuaSoGiay: CUA_SO, bienGiay: 0 })).rejects.toThrow(RangeError);
    await expect(choQuaMocCuaSo(nguon, { cuaSoGiay: CUA_SO, bienGiay: CUA_SO })).rejects.toThrow(RangeError);
    expect(doc).toBe(0);
  });
});

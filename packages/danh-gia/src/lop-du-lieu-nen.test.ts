// [S1.9101 / S4.5c2] Hai phép thuần của lớp dữ liệu nền: mốc micro giây → ISO sáu chữ số lẻ, và dạng `ngay` đã làm thô (`DAC-TA.md`
// §8.2 — ngày UTC, trừ trên ngày biên).
import { describe, expect, it } from "vitest";
import { isoMicro, ngayXuat } from "./lop-du-lieu-nen.js";

describe("[INV-L7] [S1.9101 / S4.5c2] mốc của lớp dữ liệu nền", () => {
  it("`isoMicro`: đúng sáu chữ số lẻ, không làm tròn, qua ranh mili giây và ranh ngày", () => {
    expect(isoMicro(0n)).toBe("1970-01-01T00:00:00.000000Z");
    const ms = (y: number, mo: number, d: number, h: number, mi: number, se: number, milli: number): bigint =>
      BigInt(Date.UTC(y, mo - 1, d, h, mi, se, milli)) * 1000n;
    expect(isoMicro(ms(2026, 9, 21, 13, 33, 20, 0) + 999n)).toBe("2026-09-21T13:33:20.000999Z");
    expect(isoMicro(ms(2026, 9, 21, 13, 33, 20, 1))).toBe("2026-09-21T13:33:20.001000Z");
    expect(isoMicro(ms(2026, 9, 21, 23, 59, 59, 999) + 999n)).toBe("2026-09-21T23:59:59.999999Z");
    expect(isoMicro(ms(2026, 9, 21, 23, 59, 59, 999) + 1000n)).toBe("2026-09-22T00:00:00.000000Z");
    expect(() => isoMicro(-1n)).toThrow(RangeError);
  });

  it("`ngayXuat`: ngày trơn ngoài ngày biên; đủ micro giây trên ngày biên", () => {
    const bien = new Set(["2026-09-30", "2025-09-30"]);
    expect(ngayXuat(BigInt(Date.UTC(2026, 8, 21, 13, 33, 20)) * 1000n + 999n, bien)).toBe("2026-09-21");
    const tren = BigInt(Date.UTC(2026, 8, 30, 7, 0, 0)) * 1000n + 123n;
    expect(ngayXuat(tren, bien)).toBe("2026-09-30T07:00:00.000123Z");
  });
});

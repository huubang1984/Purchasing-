// [sổ nợ 52] Bucket trong bộ nhớ cho tổ chức lạ: cửa sổ, tách khoá, trần kích thước fail-closed.
import { describe, expect, it } from "vitest";
import { BUCKET_BO_NHO_TOI_DA_MAC_DINH, BucketBoNho } from "./bucket-bo-nho.js";

describe("[sổ nợ 52] BucketBoNho", () => {
  it("đếm trong cửa sổ, hai khoá độc lập, cửa sổ qua thì về 1", () => {
    let t = 1_000;
    const b = new BucketBoNho({ cuaSoMs: 100, bayGio: () => t });
    expect([b.tang("a"), b.tang("a"), b.tang("b"), b.tang("a")]).toEqual([1, 2, 1, 3]);
    t = 1_099;
    expect(b.tang("a")).toBe(4);
    t = 1_100;
    expect(b.tang("a")).toBe(1);
    expect(b.tang("b")).toBe(1);
  });

  it("đầy ⇒ dọn khoá hết hạn; vẫn đầy ⇒ FAIL-CLOSED (vô cực) cho khoá mới, khoá cũ còn sống vẫn đếm bình thường", () => {
    let t = 0;
    const b = new BucketBoNho({ cuaSoMs: 100, toiDaKhoa: 3, bayGio: () => t });
    expect([b.tang("a"), b.tang("b"), b.tang("c")]).toEqual([1, 1, 1]);
    expect(b.tang("d")).toBe(Number.POSITIVE_INFINITY);
    expect(b.soKhoa).toBe(3);
    expect(b.tang("a")).toBe(2);
    // Khoá hết hạn được dọn khi cần chỗ, không sớm hơn.
    t = 100;
    expect(b.tang("d")).toBe(1);
    expect(b.soKhoa).toBe(1);
  });

  it("tham số sai ⇒ ném lúc dựng; mặc định 50 000 khoá", () => {
    expect(() => new BucketBoNho({ cuaSoMs: 0 })).toThrow(RangeError);
    expect(() => new BucketBoNho({ cuaSoMs: 10, toiDaKhoa: 0 })).toThrow(RangeError);
    expect(BUCKET_BO_NHO_TOI_DA_MAC_DINH).toBe(50_000);
  });
});

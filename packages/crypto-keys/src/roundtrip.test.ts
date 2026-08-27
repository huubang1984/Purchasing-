import { randomBytes, randomUUID } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createLocalDevWrapper, MasterKeyRing } from "./index.js";
import { createLocalDevUnwrapper } from "./unwrap.js";

function ring(): MasterKeyRing {
  return new MasterKeyRing("v2", {
    v1: randomBytes(32),
    v2: randomBytes(32),
  });
}

describe("vòng đời khóa", () => {
  it("bọc rồi mở trả lại đúng nguyên bản", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();

    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 512 }), async (plaintext) => {
        const wrapped = await wrapper.wrap(orgId, plaintext);
        const opened = await unwrapper.unwrap(orgId, wrapped);
        expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("[INV-A2] ciphertext không chứa chuỗi con của bản rõ", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const orgId = randomUUID();
    const plaintext = Buffer.from("gia-bao-1250000-VND-bi-mat");

    const wrapped = await wrapper.wrap(orgId, plaintext);
    expect(Buffer.from(wrapped.ciphertext).includes(plaintext)).toBe(false);
  });

  it("[INV-G2] đổi một bit bất kỳ trong phong bì làm việc mở thất bại", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();
    const wrapped = await wrapper.wrap(orgId, Buffer.from("noi dung can bao ve"));

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: wrapped.ciphertext.length - 1 }),
        fc.integer({ min: 1, max: 255 }),
        async (index, xor) => {
          const hong = Uint8Array.from(wrapped.ciphertext);
          hong[index] = hong[index]! ^ xor;
          await expect(unwrapper.unwrap(orgId, { ...wrapped, ciphertext: hong })).rejects.toThrow();
        },
      ),
      { numRuns: 60 },
    );
  });

  it("[INV-F3] khóa của tổ chức khác không mở được phong bì", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgA = randomUUID();
    const orgB = randomUUID();

    const wrapped = await wrapper.wrap(orgA, Buffer.from("du lieu cua to chuc A"));
    await expect(unwrapper.unwrap(orgB, wrapped)).rejects.toThrow(/mở phong bì thất bại/i);
  });

  it("[INV-G3] xoay master key vẫn mở được phong bì bọc bằng phiên bản cũ", async () => {
    const v1 = randomBytes(32);
    const cu = new MasterKeyRing("v1", { v1 });
    const orgId = randomUUID();
    const plaintext = Buffer.from("bao gia cu");

    const wrappedCu = await createLocalDevWrapper(cu).wrap(orgId, plaintext);
    expect(wrappedCu.keyVersion).toBe("v1");

    // Sau khi xoay: v2 là phiên bản đang dùng, v1 vẫn giữ để giải mã dữ liệu cũ.
    const sauXoay = new MasterKeyRing("v2", { v1, v2: randomBytes(32) });
    const opened = await createLocalDevUnwrapper(sauXoay).unwrap(orgId, wrappedCu);
    expect(Buffer.from(opened).equals(plaintext)).toBe(true);

    // Phong bì mới dùng phiên bản mới.
    const wrappedMoi = await createLocalDevWrapper(sauXoay).wrap(orgId, plaintext);
    expect(wrappedMoi.keyVersion).toBe("v2");
  });

  it("[INV-G3] thiếu phiên bản khóa trong vòng khóa thì báo lỗi rõ ràng", async () => {
    const orgId = randomUUID();
    const wrapped = await createLocalDevWrapper(
      new MasterKeyRing("v1", { v1: randomBytes(32) }),
    ).wrap(orgId, Buffer.from("x"));

    const thieu = new MasterKeyRing("v9", { v9: randomBytes(32) });
    await expect(createLocalDevUnwrapper(thieu).unwrap(orgId, wrapped)).rejects.toThrow(
      /không có phiên bản khóa "v1"/i,
    );
  });

  it("hai lần bọc cùng bản rõ cho ra hai phong bì khác nhau", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const orgId = randomUUID();
    const plaintext = Buffer.from("cung mot noi dung");

    const a = await wrapper.wrap(orgId, plaintext);
    const b = await wrapper.wrap(orgId, plaintext);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("từ chối master key không đủ 32 byte", () => {
    expect(() => new MasterKeyRing("v1", { v1: randomBytes(16) })).toThrow(/32 byte/);
  });

  it("từ chối vòng khóa không chứa phiên bản đang dùng", () => {
    expect(() => new MasterKeyRing("v2", { v1: randomBytes(32) })).toThrow(/phiên bản đang dùng/i);
  });
});

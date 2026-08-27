import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
// Cố ý: chỉ import từ entrypoint bọc khóa (an toàn cho mọi service),
// không đụng tới "./unwrap.js" — đúng như mọi consumer thật sẽ làm.
import { createLocalDevWrapper, MasterKeyRing } from "./index.js";

const HEADER_LENGTH = 1 + 12 + 16; // version(1) + iv(12) + tag(16)

describe("bộ bọc khóa (local-dev)", () => {
  it("trả về tên nhà cung cấp và phiên bản khóa đang dùng", async () => {
    const ring = new MasterKeyRing("v1", { v1: randomBytes(32) });
    const wrapper = createLocalDevWrapper(ring);

    const wrapped = await wrapper.wrap(randomUUID(), Buffer.from("noi dung"));

    expect(wrapper.name).toBe("local-dev");
    expect(wrapped.keyVersion).toBe("v1");
  });

  it("phong bì đúng định dạng version || iv || tag || ciphertext", async () => {
    const ring = new MasterKeyRing("v1", { v1: randomBytes(32) });
    const wrapper = createLocalDevWrapper(ring);
    const plaintext = Buffer.from("noi dung can bao ve dai hon mot chut");

    const wrapped = await wrapper.wrap(randomUUID(), plaintext);
    const envelope = Buffer.from(wrapped.ciphertext);

    expect(envelope.length).toBe(HEADER_LENGTH + plaintext.length);
    expect(envelope[0]).toBe(1); // ENVELOPE_VERSION
  });

  it("bọc bản rỗng vẫn tạo phong bì hợp lệ", async () => {
    const ring = new MasterKeyRing("v1", { v1: randomBytes(32) });
    const wrapper = createLocalDevWrapper(ring);

    const wrapped = await wrapper.wrap(randomUUID(), new Uint8Array(0));

    expect(Buffer.from(wrapped.ciphertext).length).toBe(HEADER_LENGTH);
  });

  it("dùng đúng phiên bản đang hoạt động của vòng khóa nhiều phiên bản", async () => {
    const ring = new MasterKeyRing("v3", {
      v1: randomBytes(32),
      v2: randomBytes(32),
      v3: randomBytes(32),
    });
    const wrapper = createLocalDevWrapper(ring);

    const wrapped = await wrapper.wrap(randomUUID(), Buffer.from("x"));

    expect(wrapped.keyVersion).toBe("v3");
  });
});

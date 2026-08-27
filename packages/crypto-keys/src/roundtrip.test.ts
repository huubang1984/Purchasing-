import { randomBytes, randomUUID } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createLocalDevWrapper, KeyError, MasterKeyRing, type WrappedKey } from "./index.js";
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

  // Không gắn [INV-A2]: A2 phát biểu "giá dạng rõ không tồn tại trong api service tại bất kỳ
  // thời điểm nào — kể cả bộ nhớ, log, APM trace, thông báo lỗi" (docs/TEST-PLAN.md:36), một
  // bất biến kiến trúc ở tầng service api, đo bằng bộ quét rò rỉ (T2/T5). Test dưới đây chỉ
  // kiểm tra một tính chất hẹp hơn nhiều của AES-GCM (ciphertext không chứa chuỗi con của bản
  // rõ) — một phép kiểm tra hạ tầng hữu ích nhưng không phải bằng chứng cho A2. Gắn nhãu A2 ở
  // đây sẽ tạo bằng chứng giả trong ma trận kiểm thử (phát hiện I3, fix round 1).
  it("ciphertext không chứa chuỗi con của bản rõ", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const orgId = randomUUID();
    const plaintext = Buffer.from("gia-bao-1250000-VND-bi-mat");

    const wrapped = await wrapper.wrap(orgId, plaintext);
    expect(Buffer.from(wrapped.ciphertext).includes(plaintext)).toBe(false);
  });

  // Không gắn [INV-G2]: G2 phát biểu "mỗi RFQ một cặp khóa; lộ một RFQ không lan sang RFQ
  // khác" (docs/TEST-PLAN.md:100) — một bất biến về cô lập khóa theo RFQ. Package này (Task 7)
  // chưa có khái niệm RFQ/bid trong chữ ký wrap()/unwrap() — đơn vị cô lập duy nhất hiện có là
  // orgId (bất biến F3, đã có test riêng bên dưới). G2 THỰC SỰ CHƯA ĐƯỢC PHỦ bởi test nào ở
  // Task 7; cần một task sau (khi wrap()/unwrap() nhận thêm contextId cho rfqId/bidId — xem
  // ruling AAD của controller, hoãn qua S1) mới viết được test đúng cho G2. Hai test dưới đây
  // kiểm tra tính toàn vẹn AEAD (GCM tag) chống giả mạo — một bất biến mật mã hạ tầng thật
  // nhưng không trùng với phát biểu của G2, nên không gắn tag nào.
  it("lật một byte trong vùng tag GCM (offset 13-28) làm unwrap ném lỗi toàn vẹn", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();
    const wrapped = await wrapper.wrap(orgId, Buffer.from("noi dung can bao ve"));

    // Định dạng phong bì: version(1) || iv(12) || tag(16) || ciphertext — vùng tag là
    // offset 13..28 (16 byte, kết thúc trước HEADER_LENGTH = 29).
    const hong = Uint8Array.from(wrapped.ciphertext);
    hong[20] = hong[20]! ^ 0xff;

    await expect(unwrapper.unwrap(orgId, { ...wrapped, ciphertext: hong })).rejects.toThrow(
      /dữ liệu không toàn vẹn hoặc sai ngữ cảnh tổ chức/i,
    );
  });

  it("lật byte 0 (phiên bản định dạng) làm unwrap ném lỗi phiên bản không hỗ trợ", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();
    const wrapped = await wrapper.wrap(orgId, Buffer.from("noi dung can bao ve"));

    const hong = Uint8Array.from(wrapped.ciphertext);
    hong[0] = hong[0]! ^ 0xff;

    await expect(unwrapper.unwrap(orgId, { ...wrapped, ciphertext: hong })).rejects.toThrow(
      /phiên bản định dạng .* không hỗ trợ/i,
    );
  });

  it("sửa keyVersion trong WrappedKey làm unwrap ném lỗi (AAD ràng buộc keyVersion)", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();
    const wrapped = await wrapper.wrap(orgId, Buffer.from("noi dung can bao ve"));

    // wrapped.keyVersion đang là "v2" (phiên bản active của ring()). Sửa nó sang "v1" —
    // vẫn là một phiên bản hợp lệ trong ring nên ring.get() không ném, nhưng AAD dùng để
    // tính tag xác thực đã ràng buộc keyVersion gốc ("v2"), nên đổi keyVersion mà không đổi
    // lại ciphertext phải làm decipher.setAuthTag()/final() thất bại.
    const gia = { ...wrapped, keyVersion: "v1" };
    await expect(unwrapper.unwrap(orgId, gia)).rejects.toThrow(
      /dữ liệu không toàn vẹn hoặc sai ngữ cảnh tổ chức/i,
    );
  });

  it("từ chối orgId rỗng ở cả wrap() và unwrap()", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);

    await expect(wrapper.wrap("", Buffer.from("x"))).rejects.toThrow(/orgId phải là UUID hợp lệ/i);
    await expect(unwrapper.unwrap("", { ciphertext: new Uint8Array(29), keyVersion: "v2" })).rejects.toThrow(
      /orgId phải là UUID hợp lệ/i,
    );
  });

  it("từ chối orgId không phải UUID ở cả wrap() và unwrap()", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);

    await expect(wrapper.wrap("khong-phai-uuid", Buffer.from("x"))).rejects.toThrow(
      /orgId phải là UUID hợp lệ/i,
    );
    await expect(
      unwrapper.unwrap("khong-phai-uuid", { ciphertext: new Uint8Array(29), keyVersion: "v2" }),
    ).rejects.toThrow(/orgId phải là UUID hợp lệ/i);
  });

  it("ciphertext hỏng (không phải mảng byte) ném KeyError, không phải TypeError trần", async () => {
    const r = ring();
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();

    // Mô phỏng dữ liệu DB hỏng: cột ciphertext là null/undefined thay vì bytea. Ép kiểu qua
    // `unknown` (không dùng `any`) vì WrappedKey thật sự không cho phép ciphertext là null —
    // đây là cách duy nhất để mô phỏng dữ liệu hỏng từ bên ngoài hợp đồng kiểu.
    const hong = { ciphertext: null, keyVersion: "v2" } as unknown as WrappedKey;
    await expect(unwrapper.unwrap(orgId, hong)).rejects.toThrow(KeyError);
    await expect(unwrapper.unwrap(orgId, hong)).rejects.toThrow(/ciphertext không hợp lệ/i);
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

describe("rào chắn production cho adapter local-dev (bất biến G1)", () => {
  const NODE_ENV_GOC = process.env["NODE_ENV"];
  const CO_GHI_DE_GOC = process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"];

  function datLai(): void {
    if (NODE_ENV_GOC === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = NODE_ENV_GOC;
    if (CO_GHI_DE_GOC === undefined) delete process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"];
    else process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"] = CO_GHI_DE_GOC;
  }

  it("chặn createLocalDevWrapper khi NODE_ENV=production và không có cờ ghi đè", () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"];
    try {
      expect(() => createLocalDevWrapper(ring())).toThrow(/production/i);
    } finally {
      datLai();
    }
  });

  it("chặn createLocalDevUnwrapper khi NODE_ENV=production và không có cờ ghi đè", () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"];
    try {
      expect(() => createLocalDevUnwrapper(ring())).toThrow(/production/i);
    } finally {
      datLai();
    }
  });

  it("cho phép cả hai factory khi NODE_ENV=production có cờ ghi đè tường minh", () => {
    process.env["NODE_ENV"] = "production";
    process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"] = "1";
    try {
      expect(() => createLocalDevWrapper(ring())).not.toThrow();
      expect(() => createLocalDevUnwrapper(ring())).not.toThrow();
    } finally {
      datLai();
    }
  });

  it("cho phép cả hai factory khi NODE_ENV không phải production", () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"];
    try {
      expect(() => createLocalDevWrapper(ring())).not.toThrow();
      expect(() => createLocalDevUnwrapper(ring())).not.toThrow();
    } finally {
      datLai();
    }
  });
});

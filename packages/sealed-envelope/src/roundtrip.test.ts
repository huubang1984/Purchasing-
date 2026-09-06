// ==============================================================================================
// VÒNG ĐỜI MỘT PHONG BÌ — BỐN PHÉP ĐO MÀ ADR-011 §"Đo bằng gì" ĐẶT TÊN TRƯỚC
//
// File này KHÔNG chạm CSDL có chủ đích: nó đo phần mật mã, thứ phải đúng độc lập với mọi lớp
// khác. Phần vòng đời trên Postgres (C5, G4, quyền cột) nằm ở `key-material.int.test.ts`.
//
// MỘT ĐIỀU FILE NÀY KHÔNG CHỨNG MINH ĐƯỢC, và nó phải được nói ra ở đây chứ không ở một tài liệu
// nào khác: nó chạy trên **Node**, không trên webview Android. Đã đo 2026-09-04 rằng Node 22 và
// Node 24 đều có đủ `ECDH P-256`, `X25519` và `Ed25519` trong `crypto.subtle` — nên một lượt CI
// xanh cho nhánh X25519 nói về Node, KHÔNG nói gì về trình duyệt của nhà cung cấp. Khoản nợ 23
// vẫn mở, và ADR-011 §"Đo bằng gì" mục 4 đã ghi trước chỗ trống ấy.
// ==============================================================================================

import type { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  chooseKeyAgreementAlgorithm,
  describeEnvelope,
  KEY_AGREEMENT_ALGORITHMS,
  sealBid,
  SealedEnvelopeError,
  SEALED_ENVELOPE_FORMAT_VERSION,
  type KeyAgreementAlgorithm,
} from "./index.js";
import { decodeEnvelope, deriveContentKey, importPrivateKey, importPublicKey } from "./format.js";
import { unsealBid } from "./unseal.js";

const RFQ_A = "11111111-1111-4111-8111-111111111111";
const RFQ_B = "22222222-2222-4222-8222-222222222222";

const chu = new TextEncoder();
const doc = new TextDecoder();

/** Sinh một cặp khoá NHẬN, đúng như `issueRfqKeyPair` làm, nhưng không bọc và không ghi CSDL. */
async function capKhoaNhan(
  algorithm: KeyAgreementAlgorithm,
): Promise<{ spki: Uint8Array; pkcs8: Uint8Array }> {
  const s = globalThis.crypto.subtle;
  const tham =
    algorithm === "ECDH_P256" ? { name: "ECDH", namedCurve: "P-256" } : { name: "X25519" };
  const cap = (await s.generateKey(tham, true, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  return {
    spki: new Uint8Array(await s.exportKey("spki", cap.publicKey)),
    pkcs8: new Uint8Array(await s.exportKey("pkcs8", cap.privateKey)),
  };
}

/** Lật một bit ở byte cuối. Là hàm vì `noUncheckedIndexedAccess` biến `a[i] ^= 1` thành lỗi kiểu. */
function latBitCuoi(mang: Uint8Array): Uint8Array {
  const ra = Uint8Array.from(mang);
  const i = ra.length - 1;
  ra[i] = (ra[i] ?? 0) ^ 0x01;
  return ra;
}

describe("phong bì niêm phong — vòng đời mật mã", () => {
  // [ADR-011 §"Đo bằng gì" mục 1] "Một phong bì niêm phong CHỈ BẰNG P-256 phải mở được trọn vẹn.
  // Không có vế này, 'hỗ trợ cả hai' là một lời khai."
  it.each(KEY_AGREEMENT_ALGORITHMS)(
    "[INV-G2] niêm phong rồi mở lại bằng %s cho đúng bản rõ ban đầu",
    async (algorithm) => {
      const khoa = await capKhoaNhan(algorithm);
      const banRo = chu.encode("Đơn giá: 1.234.567 VND — 200 hạng mục");

      const phongBi = await sealBid({
        rfqId: RFQ_A,
        algorithm,
        recipientPublicKey: khoa.spki,
        plaintext: banRo,
      });

      // Chống rỗng ruột: bản rõ KHÔNG được xuất hiện nguyên vẹn trong phong bì. Không có vế này,
      // một cài đặt "mã hoá" bằng phép sao chép vẫn qua được phép đo roundtrip.
      expect(Buffer.from(phongBi).includes(Buffer.from(banRo))).toBe(false);

      const mo = await unsealBid({
        rfqId: RFQ_A,
        algorithm,
        envelope: phongBi,
        recipientPrivateKey: khoa.pkcs8,
      });
      expect(doc.decode(mo)).toBe("Đơn giá: 1.234.567 VND — 200 hạng mục");
    },
  );

  // [ADR-011 §"Đo bằng gì" mục 3] Phong bì phải TỰ KHAI — đọc được mà không cần khoá nào.
  it.each(KEY_AGREEMENT_ALGORITHMS)("[INV-G2] phong bì %s tự khai thuật toán của nó", async (algorithm) => {
    const khoa = await capKhoaNhan(algorithm);
    const phongBi = await sealBid({
      rfqId: RFQ_A,
      algorithm,
      recipientPublicKey: khoa.spki,
      plaintext: chu.encode("x"),
    });
    const dau = describeEnvelope(phongBi);
    expect(dau.algorithm).toBe(algorithm);
    expect(dau.formatVersion).toBe(SEALED_ENVELOPE_FORMAT_VERSION);
    expect(dau.ephemeralPublicKey.length).toBeGreaterThan(0);
    // Khoá phù du KHÔNG được trùng khoá nhận — nếu trùng thì "phù du" chỉ là một cái tên.
    expect(Buffer.from(dau.ephemeralPublicKey).equals(Buffer.from(khoa.spki))).toBe(false);
  });

  // ============================================================================================
  // [INV-G2] "LỘ MỘT RFQ KHÔNG LAN SANG RFQ KHÁC" — BA MŨI, MỖI MŨI MỘT ĐỐI CHỨNG DƯƠNG
  // ============================================================================================
  it("[INV-G2] khoá riêng của RFQ A không mở được phong bì của RFQ B", async () => {
    const khoaA = await capKhoaNhan("ECDH_P256");
    const khoaB = await capKhoaNhan("ECDH_P256");

    const phongBiB = await sealBid({
      rfqId: RFQ_B,
      algorithm: "ECDH_P256",
      recipientPublicKey: khoaB.spki,
      plaintext: chu.encode("giá của B"),
    });

    await expect(
      unsealBid({
        rfqId: RFQ_B,
        algorithm: "ECDH_P256",
        envelope: phongBiB,
        recipientPrivateKey: khoaA.pkcs8,
      }),
    ).rejects.toThrow(SealedEnvelopeError);

    // Đối chứng dương: đúng khoá thì mở được. Không có vế này, phép đo trên xanh kể cả khi
    // `unsealBid` luôn ném.
    const mo = await unsealBid({
      rfqId: RFQ_B,
      algorithm: "ECDH_P256",
      envelope: phongBiB,
      recipientPrivateKey: khoaB.pkcs8,
    });
    expect(doc.decode(mo)).toBe("giá của B");
  });

  it("[INV-G2] ĐÚNG khoá riêng nhưng SAI mã RFQ vẫn không mở được — ràng buộc nằm trong HKDF", async () => {
    // Đây là mũi đáng giá nhất của G2 và nó KHÔNG hiển nhiên: kể cả khi hai RFQ vô tình dùng
    // chung một cặp khoá (một lỗi cấu hình, hoặc một lần khôi phục sao lưu vụng về), phong bì
    // của A vẫn không mở được dưới ngữ cảnh B — vì `rfqId` đi vào INFO của HKDF, nên khoá nội
    // dung là hàm của cả hai. Ràng buộc này là MẬT MÃ, không phải một câu `if` ai đó có thể quên.
    const khoa = await capKhoaNhan("X25519");
    const phongBiA = await sealBid({
      rfqId: RFQ_A,
      algorithm: "X25519",
      recipientPublicKey: khoa.spki,
      plaintext: chu.encode("giá của A"),
    });

    await expect(
      unsealBid({
        rfqId: RFQ_B,
        algorithm: "X25519",
        envelope: phongBiA,
        recipientPrivateKey: khoa.pkcs8,
      }),
    ).rejects.toThrow(SealedEnvelopeError);

    const mo = await unsealBid({
      rfqId: RFQ_A,
      algorithm: "X25519",
      envelope: phongBiA,
      recipientPrivateKey: khoa.pkcs8,
    });
    expect(doc.decode(mo)).toBe("giá của A");
  });

  it("[INV-G2] hai lần niêm phong CÙNG một bản rõ cho hai phong bì khác nhau", async () => {
    // Khoá phù du mới mỗi lần + IV ngẫu nhiên. Nếu hai phong bì bằng nhau thì việc "hai nhà cung
    // cấp báo cùng một giá" nhìn thấy được từ bên ngoài, và A5 vỡ trước cả khi ai mở thầu.
    const khoa = await capKhoaNhan("ECDH_P256");
    const banRo = chu.encode("100000");
    const mot = await sealBid({ rfqId: RFQ_A, algorithm: "ECDH_P256", recipientPublicKey: khoa.spki, plaintext: banRo });
    const hai = await sealBid({ rfqId: RFQ_A, algorithm: "ECDH_P256", recipientPublicKey: khoa.spki, plaintext: banRo });
    expect(Buffer.from(mot).equals(Buffer.from(hai))).toBe(false);
  });

  // ============================================================================================
  // PHONG BÌ BỊ SỬA — AAD LÀ THỨ ĐỨNG GIỮA
  // ============================================================================================
  it("[INV-G2] đổi mã thuật toán trong phong bì đã niêm phong thì phong bì không mở được", async () => {
    const khoa = await capKhoaNhan("X25519");
    const phongBi = await sealBid({
      rfqId: RFQ_A,
      algorithm: "X25519",
      recipientPublicKey: khoa.spki,
      plaintext: chu.encode("giá"),
    });
    expect(phongBi[5]).toBe(2); // X25519

    const haCap = Uint8Array.from(phongBi);
    haCap[5] = 1; // giả làm ECDH_P256
    // Lớp thứ nhất: `unsealBid` đòi phong bì khai đúng thuật toán của khoá riêng đang cầm.
    await expect(
      unsealBid({ rfqId: RFQ_A, algorithm: "X25519", envelope: haCap, recipientPrivateKey: khoa.pkcs8 }),
    ).rejects.toThrow(/khai thuật toán/);
    // Lớp thứ hai, ĐỘC LẬP với lớp trên: kể cả khi người gọi cũng bị lừa và cầm sang mã mới, khoá
    // công khai phù du 44 byte của X25519 không nhập được thành một khoá P-256.
    await expect(
      unsealBid({ rfqId: RFQ_A, algorithm: "ECDH_P256", envelope: haCap, recipientPrivateKey: khoa.pkcs8 }),
    ).rejects.toThrow(SealedEnvelopeError);
  });

  // ============================================================================================
  // AAD — VÀ MỘT PHÉP ĐO ĐỎ ĐÃ CHO MỘT KẾT QUẢ KHÔNG DỄ CHỊU, GHI NGUYÊN Ở ĐÂY
  // ============================================================================================
  // Lượt chạy ĐỎ ngày 2026-09-04: gỡ `additionalData` khỏi CẢ HAI chiều (seal + unseal) và chạy
  // lại toàn bộ file này -> **16/16 vẫn XANH**. Tức lớp AAD, lúc ấy, KHÔNG CÓ RĂNG trong phép đo.
  //
  // Vì sao: mọi trường trong phần đầu đều đã bị ràng buộc bởi một lớp KHÁC. `algorithm` đi vào
  // INFO của HKDF *và* bị `unsealBid` đối chiếu tường minh; `formatVersion` và mã thuật toán lạ
  // bị `decodeEnvelope` từ chối; đổi `ephLen` làm dịch ranh giới nên khoá phù du đọc ra khác đi,
  // và bí mật chung khác đi theo. AAD hôm nay là lớp thứ HAI ở mọi chỗ, không phải lớp duy nhất
  // ở chỗ nào.
  //
  // Giữ AAD, vì nó thôi thừa đúng vào ngày phần đầu có thêm một trường KHÔNG nằm trong HKDF và
  // KHÔNG được `decodeEnvelope` kiểm — mà ngày ấy sẽ không ai nhớ ra để thêm AAD vào. Nhưng "giữ
  // vì có lý" không thay được một phép đo, nên test dưới đây cho nó răng: nó giải mã TAY bằng AAD
  // là ĐÚNG phần đầu của chính phong bì. Bản cài không dùng AAD làm test này ĐỎ ngay.
  it("[INV-G2] AAD của một phong bì ĐÚNG BẰNG phần đầu của chính nó", async () => {
    const khoa = await capKhoaNhan("ECDH_P256");
    const banRo = "giá được ràng vào phần đầu";
    const phongBi = await sealBid({
      rfqId: RFQ_A,
      algorithm: "ECDH_P256",
      recipientPublicKey: khoa.spki,
      plaintext: chu.encode(banRo),
    });

    const tach = decodeEnvelope(phongBi);
    const khoaNoiDung = await deriveContentKey(
      "ECDH_P256",
      await importPrivateKey("ECDH_P256", khoa.pkcs8),
      await importPublicKey("ECDH_P256", tach.header.ephemeralPublicKey),
      RFQ_A,
    );

    // Vế dương: AAD = đúng phần đầu -> mở được. Một bản cài KHÔNG dùng AAD hỏng ngay ở đây.
    const mo = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: tach.iv, additionalData: tach.aad },
      khoaNoiDung,
      tach.ciphertext,
    );
    expect(doc.decode(new Uint8Array(mo))).toBe(banRo);

    // Vế âm: AAD lệch một byte -> hỏng. Không có vế này, vế trên xanh cả khi AAD bị bỏ qua.
    const lech = latBitCuoi(tach.aad);
    await expect(
      globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: tach.iv, additionalData: lech },
        khoaNoiDung,
        tach.ciphertext,
      ),
    ).rejects.toThrow();
  });

  it("[INV-G2] sửa MỘT byte của ciphertext làm phong bì không mở được", async () => {
    const khoa = await capKhoaNhan("ECDH_P256");
    const phongBi = await sealBid({
      rfqId: RFQ_A,
      algorithm: "ECDH_P256",
      recipientPublicKey: khoa.spki,
      plaintext: chu.encode("giá thật"),
    });
    const sua = latBitCuoi(phongBi);
    await expect(
      unsealBid({ rfqId: RFQ_A, algorithm: "ECDH_P256", envelope: sua, recipientPrivateKey: khoa.pkcs8 }),
    ).rejects.toThrow("Không mở được phong bì niêm phong.");
  });

  it("phong bì rác, cắt cụt, hay sai phiên bản đều bị TỪ CHỐI, không mở một phần", () => {
    expect(() => describeEnvelope(new Uint8Array(4))).toThrow(/ngắn hơn/);
    expect(() => describeEnvelope(chu.encode("KHONG PHAI PHONG BI"))).toThrow(/không phải một phong bì/);
    const gia = new Uint8Array(64);
    gia.set([0x54, 0x50, 0x53, 0x45], 0);
    gia[4] = 99;
    expect(() => describeEnvelope(gia)).toThrow(/phiên bản định dạng/i);
    gia[4] = SEALED_ENVELOPE_FORMAT_VERSION;
    gia[5] = 77;
    expect(() => describeEnvelope(gia)).toThrow(/mã thuật toán/i);
    gia[5] = 1;
    gia[6] = 0xff;
    gia[7] = 0xff;
    expect(() => describeEnvelope(gia)).toThrow(/cắt cụt/);
  });

  it("không niêm phong một báo giá rỗng, và rfqId phải là UUID", async () => {
    const khoa = await capKhoaNhan("ECDH_P256");
    await expect(
      sealBid({ rfqId: RFQ_A, algorithm: "ECDH_P256", recipientPublicKey: khoa.spki, plaintext: new Uint8Array(0) }),
    ).rejects.toThrow(/rỗng/);
    await expect(
      sealBid({ rfqId: "rfq-1", algorithm: "ECDH_P256", recipientPublicKey: khoa.spki, plaintext: chu.encode("x") }),
    ).rejects.toThrow(/UUID/);
  });
});

// ================================================================================================
// [ADR-011 §"Đo bằng gì" mục 2] ĐỐI CHỨNG CHO ĐƯỜNG CHỌN
//
// "Vô hiệu hoá X25519 trong máy dò → hệ thống phải TỰ RƠI VỀ P-256 và nộp thầu vẫn thành công,
// KHÔNG báo lỗi cho nhà cung cấp." Đây là vế biến ADR-011 mục 1 từ một câu thành một hành vi.
// ================================================================================================
describe("chọn thuật toán là một phép đo lúc chạy, không phải một hằng số cấu hình", () => {
  const rfqCoCaHai: readonly KeyAgreementAlgorithm[] = ["ECDH_P256", "X25519"];

  it("[INV-G2] trình duyệt có X25519 thì đi đường nâng cấp", () => {
    expect(chooseKeyAgreementAlgorithm(rfqCoCaHai, ["ECDH_P256", "X25519"])).toBe("X25519");
  });

  it("[INV-G2] trình duyệt KHÔNG có X25519 thì tự rơi về P-256, không báo lỗi", () => {
    expect(chooseKeyAgreementAlgorithm(rfqCoCaHai, ["ECDH_P256"])).toBe("ECDH_P256");
  });

  it("[INV-G2] và phong bì rơi-về-P-256 ấy phải mở được TRỌN VẸN — không dừng ở việc chọn đúng", async () => {
    // Chọn đúng thuật toán mà không niêm phong được là một nửa phép đo. Nối liền hai vế ở đây.
    const daChon = chooseKeyAgreementAlgorithm(rfqCoCaHai, ["ECDH_P256"]);
    const khoa = await capKhoaNhan(daChon);
    const phongBi = await sealBid({
      rfqId: RFQ_A,
      algorithm: daChon,
      recipientPublicKey: khoa.spki,
      plaintext: chu.encode("báo giá từ một máy cũ"),
    });
    const mo = await unsealBid({
      rfqId: RFQ_A,
      algorithm: daChon,
      envelope: phongBi,
      recipientPrivateKey: khoa.pkcs8,
    });
    expect(doc.decode(mo)).toBe("báo giá từ một máy cũ");
  });

  it("RFQ chỉ có P-256 mà trình duyệt có cả hai thì vẫn đi P-256 — RFQ quyết cái nó CÓ", () => {
    expect(chooseKeyAgreementAlgorithm(["ECDH_P256"], ["ECDH_P256", "X25519"])).toBe("ECDH_P256");
  });

  it("không có giao nhau thì NÉM, không trả về một lựa chọn im lặng", () => {
    expect(() => chooseKeyAgreementAlgorithm(["X25519"], ["ECDH_P256"])).toThrow(SealedEnvelopeError);
    expect(() => chooseKeyAgreementAlgorithm(rfqCoCaHai, [])).toThrow(/không làm được thuật toán nào/);
  });
});

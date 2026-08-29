// Đo trục 3 của ADR-009: một lượt mở thầu tốn bao nhiêu LỜI GỌI MẠNG tới KMS.
//
// Câu hỏi KHÔNG phải "AES có nhanh không". Câu hỏi là: trong một lần mở thầu, có bao
// nhiêu thứ ĐI QUA KMS. Trả lời bằng cách ĐẾM, không bằng cách suy luận.
//
// Chạy:  node tools/bench-kms/dem-loi-goi-kms.mjs
// Không phụ thuộc gói nào ngoài `node:crypto`, và KHÔNG nằm trong CI — đây là phép đo
// phục vụ một quyết định kiến trúc, không phải một bất biến.
//
// GIỚI HẠN, nói trước để không ai đọc rộng hơn thứ được đo:
//   1. Đây là MÔ PHỎNG. Nó dùng đúng các primitive mà thiết kế §3.2 đòi (AES-256-GCM,
//      HKDF-SHA256, X25519) nhưng KHÔNG đi qua `packages/crypto-keys` — gói đó chưa có
//      phần khoá theo RFQ (đó chính là mã G2, còn trống).
//   2. `kmsDecrypt` là hàm giả lập. Nó đo SỐ LẦN GỌI, không đo độ trễ AWS thật.
//   3. Kết luận "1 lời gọi" ĐÚNG DƯỚI MÔ HÌNH B và chỉ dưới mô hình B. Nhánh đối chứng
//      (mô hình A) ở dưới tồn tại để chứng minh bộ đếm thật sự đếm — một bộ đếm hỏng
//      cũng trả về 1.

import {
  createCipheriv, createDecipheriv, randomBytes, hkdfSync, createPrivateKey,
  generateKeyPairSync, diffieHellman,
} from "node:crypto";

const IV = 12;

// --- điểm đếm DUY NHẤT ---
let soLanGoiKms = 0;
function kmsDecrypt(dataKeyDaBoc) {
  soLanGoiKms += 1;
  return dataKeyDaBoc;
}

function deriveOrgKey(master, orgId) {
  return Buffer.from(hkdfSync("sha256", master, Buffer.from(orgId, "utf8"),
    Buffer.from("trustprocure/org-dek/v1", "utf8"), 32));
}
function bocAesGcm(key, plaintext) {
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
function moAesGcm(key, env) {
  const d = createDecipheriv("aes-256-gcm", key, env.subarray(0, IV));
  d.setAuthTag(env.subarray(IV, IV + 16));
  return Buffer.concat([d.update(env.subarray(IV + 16)), d.final()]);
}
function contentKeyTu(shared) {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0),
    Buffer.from("trustprocure/content-key/v1", "utf8"), 32));
}

/** Dựng dữ liệu: 1 RFQ, `soPhongBi` phong bì do nhà cung cấp nộp. */
function dungKichBan(soPhongBi, byteMoiBaoGia) {
  const rfq = generateKeyPairSync("x25519");
  const master = randomBytes(32);
  const orgId = "6f0d4c1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f";
  const orgKey = deriveOrgKey(master, orgId);
  // Private key RFQ bọc bằng org data key — ĐÂY là thứ DUY NHẤT KMS chạm tới.
  const privRaw = rfq.privateKey.export({ type: "pkcs8", format: "der" });
  const privDaBoc = bocAesGcm(orgKey, privRaw);

  const phongBi = [];
  for (let i = 0; i < soPhongBi; i++) {
    const eph = generateKeyPairSync("x25519");
    const ck = contentKeyTu(diffieHellman({ privateKey: eph.privateKey, publicKey: rfq.publicKey }));
    phongBi.push({ ephPub: eph.publicKey, ciphertext: bocAesGcm(ck, randomBytes(byteMoiBaoGia)) });
  }
  return { master, orgId, privDaBoc, phongBi };
}

/**
 * MÔ HÌNH B — envelope encryption đúng cách dùng KMS, và là mô hình ADR-009 GHIM.
 * Một lời gọi KMS lấy data key của tổ chức; mọi thứ sau đó là cục bộ.
 */
function moThauMoHinhB({ master, orgId, privDaBoc, phongBi }) {
  const orgKey = deriveOrgKey(kmsDecrypt(master), orgId); // (1) MỘT lời gọi KMS
  const priv = createPrivateKey({                          // (2) mở private key RFQ — cục bộ
    key: moAesGcm(orgKey, privDaBoc), format: "der", type: "pkcs8",
  });
  let tong = 0;
  for (const pb of phongBi) {                              // (3) mỗi phong bì — cục bộ
    const ck = contentKeyTu(diffieHellman({ privateKey: priv, publicKey: pb.ephPub }));
    tong += moAesGcm(ck, pb.ciphertext).length;
  }
  return tong;
}

/**
 * MÔ HÌNH A — ĐỐI CHỨNG, CỐ Ý SAI. Gọi KMS lại cho TỪNG phong bì.
 *
 * Nhánh này không phải phương án đang cân nhắc; nó tồn tại để chứng minh bộ đếm ĐẾM THẬT.
 * Nếu nó cũng ra 1 thì con số 1 của mô hình B là vô nghĩa.
 */
function moThauMoHinhA({ master, orgId, privDaBoc, phongBi }) {
  let tong = 0;
  for (const pb of phongBi) {
    const orgKey = deriveOrgKey(kmsDecrypt(master), orgId); // gọi lại MỖI vòng
    const priv = createPrivateKey({
      key: moAesGcm(orgKey, privDaBoc), format: "der", type: "pkcs8",
    });
    const ck = contentKeyTu(diffieHellman({ privateKey: priv, publicKey: pb.ephPub }));
    tong += moAesGcm(ck, pb.ciphertext).length;
  }
  return tong;
}

const KICH_BAN = [
  { ten: "50 NCC, 1 phong bì/NCC (đúng §3.2 của spec)", n: 50, byte: 200 * 120 },
  { ten: "10.000 phong bì RIÊNG (xấu nhất, KHÔNG phải thiết kế)", n: 10000, byte: 120 },
];

console.log("| Kịch bản | Phong bì | Mô hình | LỜI GỌI KMS | Mật mã cục bộ (ms) |");
console.log("|---|---|---|---|---|");
for (const kb of KICH_BAN) {
  const du = dungKichBan(kb.n, kb.byte);
  for (const [nhan, ham] of [["B (ghim)", moThauMoHinhB], ["A (đối chứng)", moThauMoHinhA]]) {
    soLanGoiKms = 0;
    const t0 = process.hrtime.bigint();
    const byteRa = ham(du);
    const ms = Number(t0 - process.hrtime.bigint()) / -1e6;
    if (byteRa !== kb.n * kb.byte) throw new Error(`GIẢI MÃ SAI: ${byteRa} != ${kb.n * kb.byte}`);
    console.log(`| ${kb.ten} | ${kb.n} | ${nhan} | **${soLanGoiKms}** | ${ms.toFixed(1)} |`);
    // Bằng chứng DƯƠNG rằng bộ đếm đo thật: A phải bằng đúng số phong bì, B phải bằng 1.
    const doi = ham === moThauMoHinhB ? 1 : kb.n;
    if (soLanGoiKms !== doi) throw new Error(`BỘ ĐẾM HỎNG: đếm ${soLanGoiKms}, đòi ${doi}`);
  }
}
console.log("\nMọi kịch bản đã giải mã ĐÚNG toàn bộ byte, và bộ đếm đã được đối chứng ở cả hai chiều");
console.log("(mô hình A ra đúng N, mô hình B ra đúng 1) — nếu lệch, script ném lỗi thay vì in bảng.");

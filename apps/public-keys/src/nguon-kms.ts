// ==============================================================================================
// [S1.128 / khoản 15 / ADR-064] NGUỒN KHOÁ CÔNG KHAI TỪ AWS KMS — ẢNH CHỤP LÚC KHỞI ĐỘNG
//
// Dưới `aws-kms` khoá riêng ký biên nhận không rời KMS, nên không tiến trình nào có một
// `ReceiptSigningKeyRing`. Nửa công khai lấy bằng `GetPublicKey` (`layKhoaCongKhaiBienNhanKms`) —
// MỘT lần mỗi `kid`, lúc khởi động — và giữ thành một ảnh chụp TĨNH. Tiến trình công bố vì thế chỉ
// cần quyền `kms:GetPublicKey`, không bao giờ `kms:Sign`, và không giữ kết nối KMS nào khi đã lên.
//
// NHIỀU `kid` là điều kiện, không phải tính năng: xoay khoá = CMK mới + `kid` mới, CMK cũ vẫn phải
// được CÔNG BỐ để biên nhận ký trước lần xoay còn kiểm chứng được (ADR-011 mục 3).
//
// FAIL-CLOSED: một `kid` hỏng thì KHÔNG có nguồn nào — không có chuyện "công bố những khoá lấy
// được". Một tài liệu thiếu khoá cũ là một tài liệu làm biên nhận cũ hỏng kiểm chứng TRONG IM LẶNG.
//
// ẢNH CHỤP TĨNH, GIÁ NÓI RA: đổi danh sách khoá (thêm `kid` khi xoay) cần khởi động lại tiến trình.
// Xoay khoá vốn đã là một lần đổi cấu hình (`TRUSTPROCURE_KMS_RECEIPT_KEYS`) nên nó vốn đã là một
// lần triển khai; một nguồn tự làm mới theo nhịp thì phải trả lời câu "một lần làm mới lỗi thì
// phục vụ gì" — và câu trả lời đúng duy nhất ở đây là "không gì cả", tức đúng thứ khởi động lại làm.
// ==============================================================================================

import { createPublicKey } from "node:crypto";
import { assertReceiptKid, layKhoaCongKhaiBienNhanKms, type KmsDocKhoaCongKhai } from "@trustprocure/bidding";
import { NguonKhoaError, type NguonKhoaCongKhai } from "./nguon.js";

/** Một `kid` và CMK của nó (ARN, key id hay alias). */
export interface KhoaKmsCongBo {
  readonly kid: string;
  readonly keyId: string;
}

export interface CauHinhNguonKms {
  /** Chỉ cần `send(GetPublicKeyCommand)` — `KMSClient` thật thoả nó. */
  readonly client: KmsDocKhoaCongKhai;
  /** Mọi `kid` phải được công bố — đang dùng VÀ cũ. */
  readonly khoa: readonly KhoaKmsCongBo[];
  /** `kid` bộ ký của `api` đang dùng (`TRUSTPROCURE_KMS_RECEIPT_KID`). */
  readonly activeKid: string;
}

function kiemDanhSach(cfg: CauHinhNguonKms): void {
  if (cfg.khoa.length === 0) throw new NguonKhoaError("aws-kms: danh sách khoá công bố rỗng");
  const kid = new Set<string>();
  const keyId = new Set<string>();
  for (const k of cfg.khoa) {
    try {
      assertReceiptKid(k.kid);
    } catch (e) {
      throw new NguonKhoaError("aws-kms: một kid không hợp lệ (1–64 ký tự [A-Za-z0-9._:-])", { cause: e });
    }
    if (k.keyId.trim() === "") throw new NguonKhoaError(`aws-kms: kid "${k.kid}" có keyId rỗng`);
    if (kid.has(k.kid)) throw new NguonKhoaError(`aws-kms: kid "${k.kid}" khai hai lần`);
    // So theo chuỗi khai: alias và ARN của cùng một CMK lọt qua đây — phép so SPKI bên dưới bắt nốt.
    if (keyId.has(k.keyId)) throw new NguonKhoaError(`aws-kms: kid "${k.kid}" trỏ một CMK đã khai cho kid khác`);
    kid.add(k.kid);
    keyId.add(k.keyId);
  }
  if (!kid.has(cfg.activeKid)) throw new NguonKhoaError("aws-kms: kid đang dùng không có trong danh sách khoá công bố");
}

/**
 * `GetPublicKey` cho TỪNG `kid`, tuần tự, rồi trả một ảnh chụp tĩnh. Ném `NguonKhoaError` nếu bất
 * kỳ khoá nào hỏng — trước mọi lời gọi KMS nếu danh sách tự nó đã sai.
 */
export async function dungNguonKhoaKms(cfg: CauHinhNguonKms): Promise<NguonKhoaCongKhai> {
  kiemDanhSach(cfg);
  const anh = new Map<string, Uint8Array>();
  const theoVanTay = new Map<string, string>();
  for (const { kid, keyId } of cfg.khoa) {
    let spki: Uint8Array;
    try {
      spki = await layKhoaCongKhaiBienNhanKms(cfg.client, keyId);
    } catch (e) {
      // `kid` là nhãn công khai; `keyId` (ARN mang số tài khoản) không đi vào thông điệp.
      throw new NguonKhoaError(`aws-kms: không lấy được khoá công khai của kid "${kid}"`, { cause: e });
    }
    // KMS khai `ECC_NIST_P256`; chuỗi byte nó trả thì chưa ai đọc. Đọc ở đây, lúc khởi động, chứ
    // không để tay nhà cung cấp phát hiện một SPKI hỏng lúc kiểm biên nhận.
    let chiTiet: string | undefined;
    try {
      const k = createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" });
      chiTiet = k.asymmetricKeyType === "ec" ? k.asymmetricKeyDetails?.namedCurve : undefined;
    } catch (e) {
      throw new NguonKhoaError(`aws-kms: khoá công khai của kid "${kid}" không đọc được theo SPKI DER`, { cause: e });
    }
    if (chiTiet !== "prime256v1") {
      throw new NguonKhoaError(`aws-kms: khoá công khai của kid "${kid}" không phải EC P-256 (ADR-011 mục 2)`);
    }
    const vanTay = Buffer.from(spki).toString("base64");
    const trung = theoVanTay.get(vanTay);
    if (trung !== undefined) {
      throw new NguonKhoaError(`aws-kms: kid "${kid}" và kid "${trung}" trả cùng một khoá công khai — hai cách viết của một CMK?`);
    }
    theoVanTay.set(vanTay, kid);
    anh.set(kid, new Uint8Array(spki));
  }
  const activeKeyId = cfg.activeKid;
  return {
    activeKeyId,
    // Mỗi lần gọi trả một BẢN SAO: người gọi sửa mảng trả về không đổi được ảnh chụp.
    publicKeys: () => new Map([...anh].map(([kid, b]) => [kid, new Uint8Array(b)])),
  };
}

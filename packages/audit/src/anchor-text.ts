// ==============================================================================================
// VĂN BẢN CHÍNH TẮC CỦA MỘT MỐC NEO NGOÀI — THỨ ĐƯỢC KÝ, VÀ KHÔNG MỘT KHẢ NĂNG NÀO KHÁC
//
// [khoản nợ 11 / khoản nợ 30 nửa sau] Sổ nợ ghi *"cơ chế có, artefact thì chưa"* từ S0: kiểu
// `ExternalAnchor`, `exportChainHead` và nhánh `externalAnchors` của bộ kiểm chứng đã có, nhưng
// KHÔNG exporter, KHÔNG nơi cất, KHÔNG chữ ký, KHÔNG entry point. Hệ quả đo được, viết ở
// `writer.ts`: `source` là CHỮ CỦA NGƯỜI GỌI, nên một dòng `{ ...xuat, source: "bịa" }` cho ra
// một kết luận kiểm toán màu xanh không phân biệt được với một kết luận thật.
//
// File này là mắt xích đầu của đường đóng khoản nợ ấy: nó biến một `ChainHeadExport` thành MỘT
// CHUỖI BYTE XÁC ĐỊNH để đem đi ký. Nó KHÔNG ký, KHÔNG kiểm chữ ký, KHÔNG chạm khoá nào — đúng
// khuôn `packages/crypto-keys/src/moi-truong.ts`: một file mở ra cửa công khai được vì nó không
// mang thêm một bậc tự do nào cho ai import nó.
//
// KHUÔN LẤY TỪ `packages/bidding/src/receipt.ts`, CÓ CHỦ ĐÍCH. Hai artefact khác nhau về đối
// tượng (biên nhận đi tới nhà cung cấp; mốc neo đi tới kiểm toán viên) nhưng giống hệt nhau về
// yêu cầu: một chuỗi byte mà `openssl dgst -sha256 -verify` đọc được mà không cần thư viện của
// chúng ta. Nên thứ tự trường là một phần của định dạng, mọi trường qua regex trước khi vào
// dòng, và văn bản kết thúc bằng đúng một `\n`.
//
// [review lượt 9 — H9-9] Nói cho hết: cái ĐÃ ĐO là ĐỊNH DẠNG — chữ ký kiểm được bằng OpenSSL qua
// `createVerify` của `node:crypto`, một lối vào khác bộ ký. Cái CHƯA ĐO là CÔNG THỨC: tách `text`
// và `sig` ra khỏi dòng JSONL rồi chạy `openssl(1)` trên tệp. Đừng đọc đoạn trên rộng hơn thế.
// ==============================================================================================

/** Nhãn định dạng. Đổi nhãn là đổi định dạng — mọi neo cũ phải vẫn kiểm được, nên nhãn có `v1`. */
export const ANCHOR_FORMAT_LABEL = "trustprocure-anchor-v1";

/**
 * Thuật toán ký mốc neo. CÙNG một thuật toán với biên nhận (ADR-011) và CÙNG một lý do: đây là
 * thứ AWS KMS ký được nguyên bản (`ECC_NIST_P256` + `ECDSA_SHA_256`, ADR-009), nên đường đi từ
 * bộ ký local-dev sang KMS là đổi adapter chứ không đổi định dạng.
 *
 * Nói rõ một điều KHÔNG suy ra được từ câu trên: vòng khoá ký NEO là một vòng khoá KHÁC vòng khoá
 * ký BIÊN NHẬN. Xem `anchor-sign.ts` để biết vì sao dùng chung là một lỗi.
 */
export const ANCHOR_SIGNING_ALGORITHM = "ECDSA_P256_SHA256";

/** Thứ tự trường là MỘT PHẦN CỦA ĐỊNH DẠNG. Đổi thứ tự là đổi thứ được ký. */
const TRUONG = ["alg", "kid", "org_id", "seq", "chain_hash", "exported_at"] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;
/**
 * `exportedAt` do bộ xuất sinh bằng `new Date().toISOString()`, tức mili-giây — KHÁC biên nhận,
 * nơi dấu thời gian phải lấy từ Postgres ở độ chính xác micro-giây.
 *
 * Vì sao khác được, nói ra để không ai "sửa cho đồng bộ": dấu thời gian của biên nhận là MỘT
 * PHẦN CỦA NGHIỆP VỤ (thứ tự nộp thầu), nên nó phải do CSDL quyết. Dấu thời gian của mốc neo
 * KHÔNG chịu lực trong bất kỳ phép phát hiện nào — thứ bắt được kẻ cắt đuôi là cặp
 * `(seq, chain_hash)`. Nó ở đây để một báo cáo kiểm toán nói được *"neo lần cuối lúc nào"*, tức
 * để đo ĐỘ RỘNG CỦA CỬA SỔ GIẢ MẠO, và mili-giây thừa sức cho việc đó.
 */
const THOI_GIAN_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** `kid` đi vào một dòng `khoa=gia-tri`, nên nó không được mang `\n` hay `=`. */
const KID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * [review lượt 9 — H9-6] Khử độc một giá trị CHƯA XÁC THỰC trước khi nội suy nó vào một thông
 * điệp mà kiểm toán viên sẽ ĐỌC.
 *
 * Sản phẩm của cả cơ chế neo ngoài là một BÁO CÁO, và mọi thông điệp lỗi ở đây kết thúc trên
 * stdout/stderr của `tools/neo-so-kiem-toan`. Một `kid` mang `\r` hoặc một escape ANSI
 * (`\x1b[2K`, `\x1b[1A`) xoá hoặc ghi đè những dòng đã in — tức một bản ghi độc trong nơi cất
 * viết lại được phần kết luận mà người đọc nhìn thấy.
 *
 * Hai vế, cả hai cần: cắt độ dài (một `kid` dài 1 MB đẩy mọi thứ khác ra khỏi màn hình), và
 * thay MỌI ký tự điều khiển bằng escape đọc được. Ghim bằng lớp `\p{C}` của Unicode chứ không
 * bằng một danh sách ký tự cấm — cùng lý do QT2 đã dùng cho đường tệp.
 */
export function antoanChoBaoCao(gt: string): string {
  const catBot = gt.length > 120 ? `${gt.slice(0, 120)}…(cắt, ${gt.length} ký tự)` : gt;
  return catBot.replace(/\p{C}/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
}

export class AnchorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnchorError";
  }
}

/** Các trường đi vào văn bản chính tắc của một mốc neo. */
export interface AnchorFields {
  readonly kid: string;
  readonly orgId: string;
  /** Độ dài chuỗi tại thời điểm xuất. Số nguyên dương — `seq` của `audit_events` bắt đầu từ 1. */
  readonly seq: number;
  /** Băm của sự kiện ở `seq`, 64 ký tự hex THƯỜNG. */
  readonly hashHex: string;
  /** ISO-8601 UTC tới mili-giây, kết thúc bằng `Z`. */
  readonly exportedAt: string;
}

function batBuoc(dieuKien: boolean, thongDiep: string): void {
  if (!dieuKien) throw new AnchorError(thongDiep);
}

/**
 * Bộ kiểm hình dạng, dùng chung cho đường DỰNG và đường ĐỌC.
 *
 * [review lượt 9 — H9-10] Trước vòng sửa này nó chỉ chạy ở đường DỰNG, nên `parseAnchorText` —
 * một hàm ở CỬA CÔNG KHAI của gói — trả về những trường chưa qua một phép kiểm nào.
 * `verifyAnchorRecord` không bị ảnh hưởng (nó có vế dựng-lại-và-so-từng-byte ngay sau đó), nhưng
 * người gọi THỨ HAI của `parseAnchorText` thì không có vế ấy, và docstring cũ không cảnh báo gì.
 * Rẻ hơn nhiều so với việc chờ người gọi thứ hai xuất hiện: chạy đúng bộ kiểm ấy ở cả hai đường.
 *
 * Mọi giá trị nội suy vào thông điệp đều đi qua `antoanChoBaoCao` — ở đường ĐỌC chúng là dữ liệu
 * CHƯA XÁC THỰC (H9-6).
 */
function kiemHinhDang(fields: AnchorFields): void {
  batBuoc(KID_PATTERN.test(fields.kid), `kid không hợp lệ: "${antoanChoBaoCao(fields.kid)}".`);
  batBuoc(
    UUID_PATTERN.test(fields.orgId),
    `org_id phải là UUID thường: "${antoanChoBaoCao(fields.orgId)}".`,
  );
  batBuoc(
    Number.isInteger(fields.seq) && fields.seq > 0,
    `seq phải là số nguyên dương: ${antoanChoBaoCao(String(fields.seq))}.`,
  );
  batBuoc(
    HEX64_PATTERN.test(fields.hashHex),
    `chain_hash phải là 64 ký tự hex thường: "${antoanChoBaoCao(fields.hashHex)}".`,
  );
  batBuoc(
    THOI_GIAN_PATTERN.test(fields.exportedAt),
    `exported_at phải là ISO-8601 UTC tới mili-giây: "${antoanChoBaoCao(fields.exportedAt)}".`,
  );
}

/**
 * Dựng văn bản chính tắc của một mốc neo.
 *
 * Kết thúc bằng **một `\n`** vì đúng lý do đã ghi ở `buildReceiptText`: artefact này sẽ nằm trong
 * một tệp mà kiểm toán viên mở bằng công cụ của họ, và hầu hết trình soạn thảo tự thêm một dòng
 * trắng cuối tệp.
 */
export function buildAnchorText(fields: AnchorFields): string {
  kiemHinhDang(fields);

  const giaTri: Readonly<Record<(typeof TRUONG)[number], string>> = {
    alg: ANCHOR_SIGNING_ALGORITHM,
    kid: fields.kid,
    org_id: fields.orgId,
    seq: String(fields.seq),
    chain_hash: fields.hashHex,
    exported_at: fields.exportedAt,
  };

  const dong = [ANCHOR_FORMAT_LABEL, ...TRUONG.map((t) => `${t}=${giaTri[t]}`)];
  // Phép kiểm lần cuối trên CHÍNH chuỗi sắp ký, chép khuôn từ `buildReceiptText`. Mọi trường ở
  // trên đã qua regex nên không thể mang `\n`; phép kiểm này KHÔNG dựa vào lập luận ấy, vì nó
  // tồn tại cho một trường MỚI thêm vào sau này mà quên regex.
  for (const d of dong) {
    batBuoc(
      !d.includes("\n") && !d.includes("\r"),
      "Một trường của mốc neo chứa ký tự xuống dòng.",
    );
  }
  return dong.join("\n") + "\n";
}

/**
 * Đọc ngược một văn bản chính tắc.
 *
 * CÙNG cảnh báo với `parseReceiptText`, và ở đây nó nặng hơn: KHÔNG dùng hàm này để dựng lại văn
 * bản rồi kiểm chữ ký trên bản dựng lại. Thứ phải đem đi kiểm là chuỗi byte ĐÃ LƯU. Một vòng
 * phân tích-rồi-dựng-lại làm cho mọi khác biệt mà bộ phân tích bỏ qua trở thành vô hình, và đó
 * đúng là chỗ một kẻ tấn công sẽ chèn.
 */
export function parseAnchorText(text: string): AnchorFields & { readonly alg: string } {
  batBuoc(text.endsWith("\n"), "Văn bản mốc neo phải kết thúc bằng một dòng mới.");
  const dong = text.slice(0, -1).split("\n");
  batBuoc(dong[0] === ANCHOR_FORMAT_LABEL, "Đây không phải một mốc neo TrustProcure v1.");
  batBuoc(
    dong.length === TRUONG.length + 1,
    `Mốc neo phải có đúng ${TRUONG.length + 1} dòng, gặp ${dong.length}.`,
  );

  const doc: Record<string, string> = {};
  for (let i = 0; i < TRUONG.length; i += 1) {
    const ten = TRUONG[i]!;
    const d = dong[i + 1]!;
    const moc = d.indexOf("=");
    batBuoc(
      moc > 0,
      `Dòng ${i + 1} của mốc neo không có dạng khoa=gia-tri: "${antoanChoBaoCao(d)}".`,
    );
    batBuoc(
      d.slice(0, moc) === ten,
      `Dòng ${i + 1} của mốc neo phải là trường "${ten}", gặp ` +
        `"${antoanChoBaoCao(d.slice(0, moc))}".`,
    );
    doc[ten] = d.slice(moc + 1);
  }

  const truong: AnchorFields = {
    kid: doc["kid"]!,
    orgId: doc["org_id"]!,
    seq: Number(doc["seq"]),
    hashHex: doc["chain_hash"]!,
    exportedAt: doc["exported_at"]!,
  };
  // [review lượt 9 — H9-10] CÙNG bộ kiểm với đường dựng. Nó KHÔNG thay thế vế dựng-lại-và-so
  // -từng-byte của `verifyAnchorRecord` (vế ấy bắt được cả `seq=06`, thứ regex `Number.isInteger`
  // ở đây cho qua) — nó là lớp thứ hai cho những người gọi không có vế ấy.
  kiemHinhDang(truong);
  return { ...truong, alg: doc["alg"]! };
}

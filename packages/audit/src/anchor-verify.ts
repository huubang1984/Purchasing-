// ==============================================================================================
// KIỂM CHỮ KÝ CỦA MỘT MỐC NEO — VÀ CHỖ DUY NHẤT ĐÚC RA ĐƯỢC MỘT `ExternalAnchor`
//
// ----------------------------------------------------------------------------------------------
// LỖ ĐƯỢC ĐÓNG Ở ĐÂY, TRÍCH NGUYÊN VĂN TỪ `writer.ts` TRƯỚC VÒNG NÀY
// ----------------------------------------------------------------------------------------------
//   "Người gọi vẫn tự tay đúc được một neo giả (`{ ...xuat, source: "bịa" }`) — không lớp kiểu
//    nào chặn được điều đó, và nói ngược lại là nói quá."
//
// Câu ấy đúng khi `ExternalAnchor` chỉ là `ChainHeadExport` cộng một chuỗi. Nay nó KHÔNG còn
// đúng, và đây là cơ chế: kiểu mang một **dấu đúc** — một `symbol` module-private, không export,
// không đặt qua `Symbol.for` nên không lấy lại được từ sổ đăng ký toàn cục. Object literal thiếu
// nó thì KHÔNG TYPECHECK; một `as unknown as ExternalAnchor` vượt được tầng kiểu thì bị
// `verifyAuditChain` bắt ở TẦNG CHẠY và báo `ANCHOR_UNVERIFIED`.
//
// Đây là cùng một nước đi với ADR-016: lỗ được đóng bằng HÌNH DẠNG CHỮ KÝ chứ không bằng một
// phép kiểm mà người gọi phải nhớ gọi. Khác biệt so với ADR-016 là ở đó hình dạng chữ ký đóng
// được lỗ MỘT MÌNH; ở đây nó chỉ là lớp thứ hai — lớp chịu lực là chữ ký số, và dấu đúc chỉ bảo
// đảm rằng KHÔNG CÓ ĐƯỜNG NÀO KHÁC dẫn tới một `ExternalAnchor`.
//
// ----------------------------------------------------------------------------------------------
// [review lượt 9 — H9-2] BẰNG CHỨNG Ở TẦNG CHẠY LÀ MỘT `WeakSet`, KHÔNG PHẢI THUỘC TÍNH SYMBOL
// ----------------------------------------------------------------------------------------------
// Bản đầu của vòng này đặt dấu đúc làm một thuộc tính own **enumerable** khoá bằng symbol, và
// `laNeoDaKiemChuKy` đọc nó bằng phép truy cập thuộc tính. Reviewer đo được rằng như thế lớp này
// KHÔNG mua được thứ nó tự nhận:
//
//     const neoGia = { ...neo, seq: 3, hashHex: "b".repeat(64) };   // typecheck SẠCH
//
// Spread và `Object.assign` sao chép own enumerable **symbol** keys, nên `neoGia` mang dấu đúc mà
// KHÔNG cần một `as unknown as` nào; `Object.create(neo)` cũng đi lọt vì phép truy cập thuộc tính
// đọc qua chuỗi prototype. Tức đường lọt KHÔNG phải một nỗ lực có chủ đích như khối cũ mô tả —
// nó là **một dòng refactor bình thường**, đúng thứ "lọt vào một cách TÌNH CỜ" mà dấu đúc sinh ra
// để chặn.
//
// Nên bằng chứng thì sống trong một `WeakSet` module-private: nó không sao chép được bằng spread,
// `Object.assign`, `structuredClone` hay `Object.create`, vì tư cách thành viên gắn với CHÍNH
// THAM CHIẾU chứ không với nội dung. Thuộc tính symbol vẫn còn — nhưng CHỈ để lớp KIỂU giữ được
// hai `@ts-expect-error` làm mốc chết.
//
// ----------------------------------------------------------------------------------------------
// NÓI ĐÚNG MỨC — DẤU ĐÚC KHÔNG PHẢI MỘT HÀNG RÀO AN NINH
// ----------------------------------------------------------------------------------------------
// Kẻ chạy được mã trong tiến trình kiểm toán vẫn không bị chặn: họ import `verifyAnchorRecord`,
// đúc một mốc neo thật từ một bản ghi họ tự ký, hoặc đơn giản hơn là sửa thẳng kết quả trả về.
// Thứ dấu đúc mua được, đúng bằng chừng này: một mốc neo chưa qua kiểm chữ ký KHÔNG CÒN LỌT VÀO
// ĐƯỢC MỘT CÁCH TÌNH CỜ.
// ==============================================================================================

import { createPublicKey, createVerify } from "node:crypto";
import {
  ANCHOR_SIGNING_ALGORITHM,
  AnchorError,
  antoanChoBaoCao,
  buildAnchorText,
  parseAnchorText,
} from "./anchor-text.js";
import type { ChainHeadExport } from "./writer.js";

/**
 * Dấu đúc. `Symbol()` chứ KHÔNG `Symbol.for()`: `Symbol.for` đăng ký vào sổ toàn cục, nên bất kỳ
 * ai biết chuỗi khoá cũng lấy lại được đúng symbol ấy — tức dấu đúc sẽ đúc được từ bên ngoài và
 * cả lớp này thành trang trí.
 */
const DAU_DUC: unique symbol = Symbol("trustprocure.neo-ngoai.chu-ky-da-kiem");

/**
 * Sổ các mốc neo ĐÃ THẬT SỰ đi qua `verifyAnchorRecord`, theo THAM CHIẾU.
 *
 * [review lượt 9 — H9-2] Đây là bằng chứng ở tầng chạy; thuộc tính `[DAU_DUC]` chỉ còn giữ vai
 * trò ở tầng KIỂU. `WeakSet` chứ không `Set`: giữ một tham chiếu mạnh tới mọi mốc neo từng được
 * kiểm sẽ là một chỗ rò bộ nhớ trong một tiến trình kiểm định kỳ.
 */
const DA_KIEM = new WeakSet<object>();

/**
 * Một `ChainHeadExport` đã LẤY VỀ TỪ NƠI CẤT NGOÀI DATABASE **và đã kiểm chữ ký**.
 *
 * `source` KHÔNG còn là chữ của người gọi. Nó do `verifyAnchorRecord` sinh ra từ hai thứ đã biết
 * chắc: mô tả nơi cất đã trả bản ghi về, và `kid` lấy TỪ CHÍNH VĂN BẢN ĐÃ ĐƯỢC KÝ. Nó đi vào
 * chẩn đoán `ANCHOR_MISSING` để một kết luận kiểm toán tự nói ra gốc tin cậy mà nó dựa vào.
 */
export interface ExternalAnchor extends ChainHeadExport {
  readonly source: string;
  /** Xem khối đầu file. Không export symbol này — đó là toàn bộ cơ chế. */
  readonly [DAU_DUC]: true;
}

/**
 * Bản ghi nằm trong nơi cất. Hai trường, và sự phân công giữa chúng là điều đáng đọc:
 *
 * `text` là văn bản chính tắc **nguyên văn**, không phải các trường đã tách. Nhờ vậy thứ đem đi
 * kiểm chữ ký là ĐÚNG chuỗi byte đã được ký, không phải kết quả của một vòng phân tích-rồi-dựng
 * -lại — vòng ấy làm mọi khác biệt mà bộ phân tích bỏ qua trở thành vô hình.
 *
 * `sig` là chữ ký **DER**, base64. DER vì đó là dạng `openssl dgst -sha256 -verify` đọc được.
 *
 * ~~kiểm toán viên kiểm được artefact này mà không cần một dòng mã nào của chúng ta.~~
 * [review lượt 9 — H9-9] Câu vừa gạch RỘNG HƠN thứ đã đo, và phần chênh đáng nói. Thứ ĐÃ ĐO:
 * cùng một chữ ký kiểm được bằng `createVerify` của `node:crypto` — tức bằng OpenSSL, qua một
 * lối vào KHÁC bộ ký (xem `packages/test-support/src/neo-fixture.ts`). Thứ CHƯA ĐO: một kiểm
 * toán viên cầm tệp JSONL và chạy `openssl(1)`. Giữa hai chỗ đó còn ba thao tác không ai trong
 * kho này từng chạy — tách `text` ra khỏi JSON (chuỗi trong tệp mang `\n` ở dạng escape),
 * `base64 -d` cho `sig`, và đổi SPKI DER sang PEM. ~~Phát biểu đúng mức: ĐỊNH DẠNG là thứ
 * OpenSSL kiểm được; CÔNG THỨC tách nó ra khỏi nơi cất thì chưa được đo.~~
 *
 * **[S1.19] BA THAO TÁC ẤY NAY LÀ `pnpm neo trich`, VÀ CÔNG THỨC ĐÃ ĐƯỢC CHẠY.**
 * `cong-cu.int.test.ts` gọi `openssl dgst -sha256 -verify` trên ba tệp do `trich` sinh ra và
 * nhận *Verified OK*; ba đối chứng âm làm nó từ chối. Phát biểu đúng mức **hôm nay**: công thức
 * chạy được đầu-cuối, nhưng nó KHÔNG chứng minh một cài đặt mật mã độc lập — `node:crypto` gọi
 * OpenSSL bên dưới. Xem ADR-026 §5⑶ và khối `trich` ở `tools/neo-so-kiem-toan/src/index.ts`.
 */
export interface SignedAnchorRecord {
  readonly text: string;
  readonly sig: string;
}

/**
 * Đọc `kid` ra khỏi một văn bản CHƯA kiểm chữ ký, để chọn khoá công khai đem đi kiểm.
 *
 * Đây là bước duy nhất trong file này đọc dữ liệu chưa xác thực, và nó an toàn vì `kid` nằm
 * TRONG văn bản được ký: chọn nhầm khoá thì chữ ký không khớp, chọn đúng khoá của một `kid`
 * không có trong vòng khoá thì bị từ chối ngay dưới đây. Khuôn giống trường `alg`/`kid` của một
 * JWS header, và cạm bẫy cũng giống: giá trị này KHÔNG được dùng cho việc gì khác ngoài tra khoá.
 */
function docKidChuaXacThuc(text: string): string {
  return parseAnchorText(text).kid;
}

function batBuoc(dieuKien: boolean, thongDiep: string): void {
  if (!dieuKien) throw new AnchorError(thongDiep);
}

/**
 * Kiểm chữ ký của một bản ghi lấy từ nơi cất, và ĐÚC ra một `ExternalAnchor` nếu đạt.
 *
 * NÉM khi bản ghi sai hình dạng, khi `kid` không có trong vòng khoá công khai, hoặc khi chữ ký
 * không khớp — không có đường trả về "một mốc neo yếu". Fail-closed, vì một mốc neo hỏng nằm
 * trong nơi cất là một trong hai điều: kho bị hỏng, hoặc kho bị tấn công. Cả hai đều là thứ
 * kiểm toán viên phải NHÌN THẤY, không phải thứ để lọc ra rồi kết luận xanh trên phần còn lại.
 *
 * `moTaNoiCat` đi vào `source`. Nó là chữ của NGƯỜI DỰNG KHO chứ không của người gọi lẻ, và nó
 * vẫn KHÔNG phải một chứng cứ mật mã — thứ mật mã ở đây là `kid` cộng chữ ký. Nói rõ để không ai
 * đọc `source` thành một khẳng định đã được kiểm.
 */
export function verifyAnchorRecord(
  banGhi: unknown,
  khoaCongKhai: ReadonlyMap<string, Uint8Array>,
  moTaNoiCat: string,
): ExternalAnchor {
  batBuoc(
    typeof banGhi === "object" && banGhi !== null,
    "Bản ghi mốc neo phải là một đối tượng.",
  );
  const b = banGhi as Partial<SignedAnchorRecord>;
  batBuoc(typeof b.text === "string", "Bản ghi mốc neo thiếu trường `text`.");
  batBuoc(typeof b.sig === "string", "Bản ghi mốc neo thiếu trường `sig`.");
  const text = b.text as string;
  const sig = b.sig as string;

  const kid = docKidChuaXacThuc(text);
  const spki = khoaCongKhai.get(kid);
  if (spki === undefined) {
    // Thông điệp nói ra hệ quả, vì đây là chỗ một lần "dọn khoá cũ" hiện ra hậu quả của nó —
    // cùng một câu với `ReceiptSigningKeyRing.get`, và cùng một lý do (ADR-011 mục 3).
    throw new AnchorError(
      `Vòng khoá công khai không có "${antoanChoBaoCao(kid)}". Mốc neo ký bằng khoá này không ` +
        "kiểm chứng được nữa — khoá neo cũ KHÔNG được gỡ khỏi vòng khoá.",
    );
  }

  // ==============================================================================================
  // LOẠI KHOÁ PHẢI ĐƯỢC CHỐT, VÌ `alg` KHÔNG CHỌN THUẬT TOÁN — KHOÁ MỚI CHỌN
  // ==============================================================================================
  // `createVerify("sha256").verify(...)` suy thuật toán chữ ký từ LOẠI KHOÁ: một khoá RSA cho ra
  // phép kiểm RSA-PKCS1, một khoá Ed25519 cho ra Ed25519. Trường `alg` của văn bản không tham gia.
  //
  // Nên nếu một khoá KHÔNG phải EC P-256 lọt vào vòng khoá, `verifyAnchorRecord` vẫn "đạt" — trên
  // một thuật toán KHÁC thuật toán mà chính artefact khai. Đó không phải một lỗ leo thang (ai đặt
  // được khoá vào vòng khoá của kiểm toán viên thì đã kiểm soát gốc tin cậy), nhưng nó là một
  // ARTEFACT NÓI SAI VỀ CHÍNH NÓ — và với một tài liệu dùng cho kiểm toán, đó đủ để phải chặn.
  // Ca thật sẽ xảy ra: một lần xoay khoá sang RSA mà quên rằng `ANCHOR_SIGNING_ALGORITHM` là hằng số.
  let khoa: ReturnType<typeof createPublicKey>;
  try {
    khoa = createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" });
  } catch (loi) {
    throw new AnchorError(`Khoá công khai của "${kid}" không đọc được ở dạng SPKI DER.`, {
      cause: loi,
    });
  }
  const duongCong = khoa.asymmetricKeyDetails?.namedCurve;
  if (khoa.asymmetricKeyType !== "ec" || duongCong !== "prime256v1") {
    throw new AnchorError(
      `Khoá công khai của "${kid}" là ${khoa.asymmetricKeyType ?? "không rõ"}` +
        `${duongCong === undefined ? "" : `/${duongCong}`}, không phải EC P-256. Văn bản mốc neo ` +
        `khai ${ANCHOR_SIGNING_ALGORITHM}, và phép kiểm chọn thuật toán theo KHOÁ chứ không theo ` +
        "trường đó — hai thứ lệch nhau thì không được coi là đã kiểm.",
    );
  }

  let dat: boolean;
  try {
    dat = createVerify("sha256")
      .update(text, "utf8")
      .verify(khoa, Buffer.from(sig, "base64"));
  } catch (loi) {
    throw new AnchorError(`Không kiểm được chữ ký của mốc neo "${kid}".`, { cause: loi });
  }
  if (!dat) {
    throw new AnchorError(
      `Chữ ký của mốc neo "${kid}" KHÔNG khớp văn bản. Bản ghi đã bị sửa, hoặc nó được ký bằng ` +
        "một khoá khác khoá mà kiểm toán viên tin.",
    );
  }

  // Chỉ tách trường SAU khi chữ ký đã đạt. Thứ tự này là một quyết định: mọi giá trị dưới đây
  // nay là dữ liệu ĐÃ ĐƯỢC KÝ, nên không vế nào phía sau phải hỏi lại "cái này đáng tin không".
  const truong = parseAnchorText(text);
  batBuoc(
    truong.alg === ANCHOR_SIGNING_ALGORITHM,
    `Mốc neo khai thuật toán "${truong.alg}", không phải ${ANCHOR_SIGNING_ALGORITHM}.`,
  );
  // Dựng lại văn bản từ các trường đã tách và đòi nó BẰNG TỪNG BYTE với văn bản đã ký. Vế này
  // bắt đúng một lớp lỗi mà chữ ký KHÔNG bắt được: một văn bản hợp lệ với bộ phân tích nhưng
  // KHÔNG phải thứ `buildAnchorText` sinh ra (ví dụ một trường lọt qua vì regex chỉ chạy ở đường
  // DỰNG, không ở đường ĐỌC). Kẻ ký được văn bản ấy là kẻ có khoá riêng — nhưng "có khoá riêng"
  // không có nghĩa là "được phép sinh ra một hình dạng khác".
  batBuoc(
    buildAnchorText(truong) === text,
    "Văn bản mốc neo không ở dạng chính tắc: dựng lại từ chính các trường của nó ra một chuỗi khác.",
  );

  const neo: ExternalAnchor = {
    orgId: truong.orgId,
    seq: truong.seq,
    hashHex: truong.hashHex,
    exportedAt: truong.exportedAt,
    // `moTaNoiCat` là chữ của người dựng kho và nó đi thẳng vào báo cáo kiểm toán — khử độc như
    // mọi giá trị khác trên đường ấy (H9-6). `kid` đã qua `KID_PATTERN` nên nó sạch sẵn.
    source: `${antoanChoBaoCao(moTaNoiCat)} · kid=${truong.kid} · chữ ký ĐÃ KIỂM`,
    [DAU_DUC]: true,
  };
  DA_KIEM.add(neo);
  return neo;
}

/**
 * `true` khi giá trị CHÍNH LÀ một mốc neo do `verifyAnchorRecord` đúc ra.
 *
 * [review lượt 9 — H9-2] Hỏi `WeakSet`, KHÔNG đọc thuộc tính. Nguyên văn cũ, giữ để không ai
 * khôi phục nó:
 *   ┌ return (neo as Partial<Record<typeof DAU_DUC, unknown>>)[DAU_DUC] === true;
 *   └
 * Phép đọc thuộc tính ấy trả `true` cho `{ ...neoThat }` và cho `Object.create(neoThat)` — hai
 * đường mà một dòng refactor bình thường viết ra được, không cần `as unknown as`.
 *
 * Xuất khẩu PHÉP KIỂM chứ không xuất khẩu symbol hay `WeakSet` — xuất khẩu chúng là mở lại đúng
 * cánh cửa mà lớp này đóng.
 */
export function laNeoDaKiemChuKy(neo: ExternalAnchor): boolean {
  return DA_KIEM.has(neo);
}

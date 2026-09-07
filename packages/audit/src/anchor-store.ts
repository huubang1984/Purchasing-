// ==============================================================================================
// NƠI CẤT MỐC NEO — VÀ VÌ SAO "CHỈ GHI THÊM" LÀ TÍNH CHẤT CHỊU LỰC, KHÔNG PHẢI MỘT TIỆN NGHI
//
// ----------------------------------------------------------------------------------------------
// HAI YÊU CẦU, TRÍCH TỪ `writer.ts` [vòng fix 1 — M5]
// ----------------------------------------------------------------------------------------------
//   ⑴ "NƠI CẤT PHẢI CHỈ-GHI-THÊM, không được GHI ĐÈ. ... Nếu nơi cất ghi đè, một lần cắt đuôi
//      được RỬA THÀNH GỐC TIN CẬY mới. Và việc kiểm chứng phải xét MỌI neo còn giữ, không chỉ neo
//      mới nhất."
//   ⑵ "ARTEFACT HIỆN KHÔNG ĐƯỢC KÝ, nên 'nằm ngoài vùng ghi của role deploy' là bảo đảm DUY
//      NHẤT."
//
// Vế ⑵ ĐÃ ĐỔI trong vòng này: artefact nay ĐƯỢC KÝ (`anchor-sign.ts`), nên nơi cất không còn là
// bảo đảm duy nhất. Nhưng vế ⑴ thì KHÔNG đổi, và chữ ký không thay được nó — một kẻ ghi đè được
// nơi cất không cần giả mạo gì cả, họ chỉ cần GIỮ LẠI mốc neo cũ. Mọi bản ghi còn lại đều thật,
// đều có chữ ký hợp lệ, và kết luận kiểm toán vẫn xanh trên một cái sổ đã bị cắt đuôi.
//
// Nên chữ ký và tính chỉ-ghi-thêm chặn hai thứ KHÁC NHAU: chữ ký chặn BỊA THÊM, chỉ-ghi-thêm
// chặn BỎ BỚT. Không cái nào thay được cái kia.
//
// ----------------------------------------------------------------------------------------------
// NÓI THẲNG PHẦN BẢN CÀI ĐẶT NÀY *KHÔNG* ĐÓNG
// ----------------------------------------------------------------------------------------------
// `createFileAnchorStore` ghi ra một thư mục trên đĩa. Ai xoá được thư mục ấy thì xoá được mốc
// neo, và không dòng mã nào ở đây đổi được điều đó — `chmod`, một tệp chỉ-đọc, hay một phép kiểm
// "tệp có ngắn đi không" đều là những thứ chính tác nhân ấy gỡ được.
//
// Tính chất *"nằm ngoài vùng ghi của role deploy"* là một sự thật về TRIỂN KHAI, không phải về mã
// nguồn. Bản cài đặt này giữ đúng phần hợp đồng mà mã giữ được — **không có một thao tác nào sửa
// hay xoá một bản ghi đã ghi**, và đường ghi mở tệp ở chế độ nối thêm — rồi để phần còn lại cho
// nơi triển khai: một bucket S3 bật Object Lock ở chế độ Compliance, trong một tài khoản AWS mà
// role deploy không có vai trò nào (ADR-026 §4). Ở đó, "không xoá được" là một chính sách IAM
// đọc được, không phải một câu trong tài liệu này.
//
// ----------------------------------------------------------------------------------------------
// [review lượt 9 — H9-1] MỘT CÂU CỦA KHỐI TRÊN ĐÃ BỊ ĐO LÀ SAI, VÀ NÓ CHE MỘT LỖ FAIL-OPEN
// ----------------------------------------------------------------------------------------------
// Nguyên văn: ~~"Ai xoá được thư mục ấy thì xoá được mốc neo, và **không dòng mã nào ở đây đổi
// được điều đó**"~~. Vế đầu đúng; vế sau SAI, và bản đầu của file này làm đúng điều tệ nhất mà mã
// làm được ở chỗ đó: `append` gọi `mkdir(recursive)` rồi `appendFile` tự tạo tệp. Ghép với một bộ
// xuất chạy theo lịch, một lần XOÁ nơi cất không phải là mất mốc neo — nó là **RESET nơi cất về
// trạng thái "chưa từng neo"**, và lượt xuất kế tiếp lấp đầy lại bằng mốc neo của cái sổ đã bị
// cắt. Kết luận kiểm toán khi ấy XANH, đúng "Vế B" mà `chain.int.test.ts` đo được, nhưng đạt tới
// bằng XOÁ chứ không cần một nơi cất ghi đè.
//
// Mã KHÔNG ngăn được việc xoá. Mã NGĂN ĐƯỢC việc âm thầm coi một nơi cất vừa biến mất là một nơi
// cất mới tinh, và đó là thứ hai lớp dưới đây làm:
//   ⑴ `append` KHÔNG tạo thư mục gốc. Thư mục nơi cất là một tiền đề triển khai — nó vắng mặt thì
//      NÉM. Khởi tạo là một thao tác tường minh (`neo-so-kiem-toan khoi-tao`).
//   ⑵ `tools/neo-so-kiem-toan` từ chối ghi một mốc neo có `seq` LÙI so với mốc cao nhất đã kiểm
//      được trong nơi cất — tức "cắt đuôi rồi xuất lại" chết ỒN ÀO ở đúng thời điểm xuất.
// Ca còn hở, nói thẳng: xoá đúng MỘT tệp `<org>.jsonl` mà giữ thư mục thì lớp ⑵ mất mốc so sánh.
// Đóng nó đòi một trạng thái nằm NGOÀI nơi cất, tức lại là chính bài toán triển khai ở trên.
// ==============================================================================================

import { appendFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { AnchorError, antoanChoBaoCao } from "./anchor-text.js";
import { verifyAnchorRecord, type ExternalAnchor, type SignedAnchorRecord } from "./anchor-verify.js";

/**
 * Chế độ mở tệp của đường GHI. **`"a"` là thứ chịu lực của cả file này.**
 *
 * MỐC CHẾT — đổi hằng số này thành `"w"`, chạy `anchor-store.test.ts`, và test
 * *"cắt đuôi rồi xuất lại KHÔNG rửa được thành gốc tin cậy mới"* phải ĐỎ: với `"w"` nơi cất chỉ
 * còn giữ mốc neo mới nhất, tức đúng mốc neo của cái sổ đã bị cắt, và kiểm toán trả về SẠCH.
 */
const CO_CHE_MO_DE_GHI = "a";

/** UUID thường. `orgId` đi vào TÊN TỆP, nên nó phải qua đây trước — xem `duongDanCua`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Nơi cất mốc neo.
 *
 * `readAllRaw` trả `unknown[]`, KHÔNG trả `SignedAnchorRecord[]`, và đó là một quyết định: nơi
 * cất nằm NGOÀI vùng tin cậy của chúng ta theo đúng định nghĩa của nó, nên dữ liệu lấy về là dữ
 * liệu chưa xác thực. Một kiểu trả về hứa hẹn hơn thế sẽ mời gọi người gọi bỏ qua bước kiểm chữ
 * ký, và bước ấy là toàn bộ giá trị của vòng này.
 */
export interface AnchorStore {
  /** Mô tả nơi cất, đi vào `source` của mốc neo đã kiểm. */
  readonly moTa: string;
  append(orgId: string, banGhi: SignedAnchorRecord): Promise<void>;
  readAllRaw(orgId: string): Promise<readonly unknown[]>;
}

function duongDanCua(thuMuc: string, orgId: string): string {
  // `orgId` đi thẳng vào một tên tệp. Không có phép kiểm này, một `orgId` mang `..` hoặc một dấu
  // gạch chéo đọc và ghi được ra ngoài thư mục nơi cất. Ở đường GHI đó là một lần chèn bản ghi
  // vào sổ neo của tổ chức khác; ở đường ĐỌC đó là một lần đọc tệp bất kỳ trên đĩa.
  //
  // Ghim bằng HÌNH DẠNG chứ không bằng danh sách ký tự cấm: một danh sách cấm phải liệt kê cho
  // đủ (`..`, `/`, `\`, `:` của Windows, byte 0, tên thiết bị `NUL`/`CON`...), còn một UUID
  // thường thì chỉ có hex và gạch nối. Đây là quy tắc QT2 của dự án, áp cho đường tệp.
  if (!UUID_PATTERN.test(orgId)) {
    throw new AnchorError(`orgId phải là UUID thường: "${orgId}".`);
  }
  return join(thuMuc, `${orgId}.jsonl`);
}

/**
 * Nơi cất trên hệ tệp: một tệp JSONL cho mỗi tổ chức, mỗi dòng một bản ghi đã ký.
 *
 * JSONL chứ không phải một tài liệu JSON duy nhất, và lý do là vế ⑴ ở khối đầu: cập nhật một tài
 * liệu JSON là ĐỌC-SỬA-GHI ĐÈ, tức đúng thao tác mà nơi cất không được có. Với JSONL, đường ghi
 * duy nhất là nối thêm một dòng, và mọi dòng cũ nằm nguyên chỗ cũ.
 *
 * Văn bản chính tắc mang `\n`; `JSON.stringify` đổi nó thành `\\n` nên một bản ghi luôn là ĐÚNG
 * một dòng. Test `anchor-store.test.ts` khẳng định điều đó bằng một phép đếm dòng, vì nếu nó sai
 * thì hai bản ghi kề nhau nhập làm một và cả tệp không đọc lại được.
 */
export function createFileAnchorStore(thuMuc: string, moTa?: string): AnchorStore {
  // `moTa` đi vào `source` của mốc neo, rồi vào chẩn đoán, rồi ra stdout của công cụ. Khử độc ở
  // ĐÂY, chỗ nó ra đời, chứ không chỉ ở nơi nó được đọc (H9-6).
  return {
    moTa: antoanChoBaoCao(moTa ?? `kho tệp ${thuMuc}`),

    async append(orgId: string, banGhi: SignedAnchorRecord): Promise<void> {
      const duongDan = duongDanCua(thuMuc, orgId);
      // [review lượt 9 — H9-1] KHÔNG `mkdir`. Một nơi cất vừa bị xoá phải KÊU, không được tự dựng
      // lại: chính lượt tự dựng lại ấy là thứ biến một vụ cắt đuôi thành một kết luận xanh.
      try {
        const tt = await stat(thuMuc);
        if (!tt.isDirectory()) throw new AnchorError(`Nơi cất "${thuMuc}" không phải thư mục.`);
      } catch (loi) {
        if ((loi as NodeJS.ErrnoException).code !== "ENOENT") throw loi;
        throw new AnchorError(
          `Nơi cất "${thuMuc}" không tồn tại. Nó là một tiền đề triển khai, không phải thứ bộ ` +
            "xuất tự dựng — một thư mục vừa biến mất có nghĩa là mọi mốc neo cũ đã mất, và ghi " +
            "tiếp vào một nơi cất trống sẽ RỬA lần mất ấy thành một gốc tin cậy mới. Dựng nó " +
            "bằng `neo-so-kiem-toan khoi-tao` sau khi đã hiểu vì sao nó vắng mặt.",
        );
      }
      const dong = JSON.stringify(banGhi);
      if (dong.includes("\n")) {
        // Không diễn đạt được với `JSON.stringify` hôm nay, và chính vì thế phép kiểm này tồn
        // tại: nó canh một bộ tuần tự hoá KHÁC được thay vào sau này.
        throw new AnchorError("Bản ghi mốc neo tuần tự hoá ra nhiều dòng.");
      }
      await appendFile(duongDan, dong + "\n", { encoding: "utf8", flag: CO_CHE_MO_DE_GHI });
    },

    async readAllRaw(orgId: string): Promise<readonly unknown[]> {
      const duongDan = duongDanCua(thuMuc, orgId);
      let noiDung: string;
      try {
        noiDung = await readFile(duongDan, "utf8");
      } catch (loi) {
        if ((loi as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw loi;
      }
      const dong = noiDung.split("\n").filter((d) => d.trim() !== "");
      return dong.map((d, i) => {
        try {
          return JSON.parse(d) as unknown;
        } catch (loi) {
          // Fail-closed: một dòng hỏng là một bản ghi KHÔNG ĐỌC ĐƯỢC, và bỏ qua nó rồi kết luận
          // xanh trên phần còn lại là đúng hình dạng của một lần cắt đuôi đã được rửa.
          throw new AnchorError(`Dòng ${i + 1} của ${duongDan} không phải JSON hợp lệ.`, {
            cause: loi,
          });
        }
      });
    },
  };
}

/**
 * Lấy MỌI mốc neo của một tổ chức từ nơi cất và kiểm chữ ký từng cái.
 *
 * NÉM nếu bất kỳ bản ghi nào không kiểm được, và thông điệp liệt kê ĐỦ các bản ghi hỏng chứ
 * không dừng ở cái đầu tiên — người đọc cần biết "một dòng hỏng" hay "cả tệp hỏng", vì hai thứ
 * đó dẫn tới hai hành động khác nhau.
 *
 * MỌI mốc neo, không phải mốc mới nhất: xem vế ⑴ ở khối đầu file. Một bộ kiểm chỉ xét mốc mới
 * nhất tự nguyện bỏ đi đúng thứ mà tính chỉ-ghi-thêm mua được.
 */
export async function loadVerifiedAnchors(
  store: AnchorStore,
  orgId: string,
  khoaCongKhai: ReadonlyMap<string, Uint8Array>,
): Promise<readonly ExternalAnchor[]> {
  const tho = await store.readAllRaw(orgId);
  const neo: ExternalAnchor[] = [];
  const hong: string[] = [];

  for (let i = 0; i < tho.length; i += 1) {
    let daKiem: ExternalAnchor;
    try {
      daKiem = verifyAnchorRecord(tho[i], khoaCongKhai, store.moTa);
    } catch (loi) {
      hong.push(`bản ghi ${i + 1}: ${loi instanceof Error ? loi.message : String(loi)}`);
      continue;
    }
    if (daKiem.orgId !== orgId) {
      // Chữ ký hợp lệ KHÔNG có nghĩa là bản ghi nằm đúng chỗ. Tên tệp là chữ của người GHI; thứ
      // đã được ký là `org_id` bên trong văn bản. Khi hai thứ lệch nhau, tin cái đã được ký, và
      // coi việc lệch là một sự cố phải nhìn thấy — nó là hình dạng của một lần chép mốc neo của
      // tổ chức khác sang đây để làm kết luận xanh.
      hong.push(
        `bản ghi ${i + 1}: văn bản đã ký mang org_id ${daKiem.orgId}, không phải ${orgId}`,
      );
      continue;
    }
    neo.push(daKiem);
  }

  if (hong.length > 0) {
    throw new AnchorError(
      `Nơi cất "${store.moTa}" có ${hong.length}/${tho.length} bản ghi không kiểm được cho tổ ` +
        `chức ${orgId}. Một kết luận kiểm toán KHÔNG được xanh trên phần còn lại:\n  ` +
        hong.join("\n  "),
    );
  }
  return neo;
}

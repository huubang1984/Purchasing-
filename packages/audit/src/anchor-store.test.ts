import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taoBoKyNeoThuNghiem, type BoKyNeoThuNghiem } from "@trustprocure/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileAnchorStore, loadVerifiedAnchors } from "./anchor-store.js";

const ORG = "11111111-2222-3333-4444-555555555555";
const ORG_KHAC = "99999999-8888-7777-6666-555555555555";

function truong(seq: number, hashChar: string, phut = 0): Omit<
  Parameters<BoKyNeoThuNghiem["ky"]>[0],
  never
> {
  return {
    orgId: ORG,
    seq,
    hashHex: hashChar.repeat(64),
    exportedAt: `2026-09-07T10:${String(phut).padStart(2, "0")}:00.000Z`,
  };
}

let thuMuc: string;
let bo: BoKyNeoThuNghiem;

beforeEach(async () => {
  thuMuc = await mkdtemp(join(tmpdir(), "tp-neo-"));
  bo = taoBoKyNeoThuNghiem("neo-2026");
});

afterEach(async () => {
  await rm(thuMuc, { recursive: true, force: true });
});

describe("nơi cất mốc neo — chỉ ghi thêm", () => {
  it("[INV-B3] mốc neo CŨ vẫn còn sau khi ghi mốc neo MỚI", async () => {
    // ==========================================================================================
    // ĐÂY LÀ PHÉP ĐO CHỊU LỰC CỦA CẢ FILE. Nó viết lại thành mã đúng kịch bản mà `writer.ts`
    // [vòng fix 1 — M5] mục (1) mô tả bằng lời:
    //
    //   sổ có 6 hàng  ->  xuất neo seq 6  ->  kẻ tấn công CẮT ĐUÔI còn 3 hàng  ->  bộ xuất chạy
    //   lại theo lịch  ->  xuất neo seq 3
    //
    // Nếu nơi cất GHI ĐÈ, thứ còn lại là mốc neo seq 3 — mốc neo của chính cái sổ đã bị cắt — và
    // một lần cắt đuôi vừa được RỬA THÀNH GỐC TIN CẬY MỚI. Không có gì để phát hiện nữa: mọi
    // hàng còn lại đều thật, chuỗi hash tự nhất quán, mốc neo khớp, chữ ký hợp lệ.
    //
    // MỐC CHẾT: đổi `CO_CHE_MO_DE_GHI` trong `anchor-store.ts` từ `"a"` sang `"w"` thì test này
    // ĐỎ ngay ở khẳng định `seq` đầu tiên. Vế còn lại của kịch bản — "và bộ kiểm chứng khi ấy
    // trả về SẠCH" — cần một cái sổ thật, nên nó nằm ở `chain.int.test.ts`.
    // ==========================================================================================
    const kho = createFileAnchorStore(thuMuc, "kho thử");
    await kho.append(ORG, bo.ky(truong(6, "a", 0)));
    await kho.append(ORG, bo.ky(truong(3, "b", 5)));

    const neo = await loadVerifiedAnchors(kho, ORG, bo.khoaCongKhai);
    expect(neo.map((n) => n.seq)).toEqual([6, 3]);
    expect(neo[0]!.hashHex).toBe("a".repeat(64));
  });

  it("một bản ghi là ĐÚNG một dòng, dù văn bản chính tắc mang xuống dòng", async () => {
    // Văn bản chính tắc có 7 dòng. Nếu bộ tuần tự hoá để lọt một `\n` thật vào tệp thì hai bản
    // ghi kề nhau nhập làm một và cả tệp không đọc lại được — một nơi cất tự huỷ trong im lặng.
    const kho = createFileAnchorStore(thuMuc);
    await kho.append(ORG, bo.ky(truong(1, "a")));
    await kho.append(ORG, bo.ky(truong(2, "b")));

    const noiDung = await readFile(join(thuMuc, `${ORG}.jsonl`), "utf8");
    expect(noiDung.split("\n").filter((d) => d !== "")).toHaveLength(2);
    expect(await kho.readAllRaw(ORG)).toHaveLength(2);
  });

  it("sổ neo của tổ chức này không thấy bản ghi của tổ chức kia", async () => {
    const kho = createFileAnchorStore(thuMuc);
    await kho.append(ORG, bo.ky(truong(1, "a")));
    expect(await kho.readAllRaw(ORG_KHAC)).toEqual([]);
  });

  it("nơi cất chưa có gì thì trả mảng rỗng, không ném", async () => {
    expect(await createFileAnchorStore(thuMuc).readAllRaw(ORG)).toEqual([]);
  });

  // `orgId` đi thẳng vào một tên tệp. Ở đường GHI, một `orgId` mang `..` chèn bản ghi ra ngoài
  // thư mục nơi cất; ở đường ĐỌC nó đọc được tệp bất kỳ trên đĩa rồi nộp nội dung cho bộ kiểm.
  it.each([
    ["đường lên thư mục cha", "../../etc/passwd"],
    ["gạch chéo", "11111111-2222-3333-4444-555555555555/x"],
    ["gạch ngược", "..\\..\\windows"],
    ["rỗng", ""],
    // CHÚ Ý: ca này suýt tự làm mù mình. Bản đầu viết `ORG.toUpperCase()`, mà `ORG` toàn CHỮ SỐ
    // — `toUpperCase()` là một phép đồng nhất trên nó, nên "ca viết HOA" thật ra là ca HỢP LỆ và
    // nó ĐỎ ngay lượt chạy đầu. Cùng lớp lỗi với `rows=2000` là tiền tố của `rows=200000` ở
    // S1.16: một dữ liệu thử không phân biệt được với thứ nó phải phân biệt.
    ["viết HOA", "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"],
  ])("từ chối orgId %s ở CẢ hai đường", async (_ten, xau) => {
    const kho = createFileAnchorStore(thuMuc);
    await expect(kho.readAllRaw(xau)).rejects.toThrow(/orgId phải là UUID thường/);
    await expect(kho.append(xau, bo.ky(truong(1, "a")))).rejects.toThrow(
      /orgId phải là UUID thường/,
    );
  });

  it("[INV-B3] nơi cất bị XOÁ thì đường ghi NÉM — nó không tự dựng lại", async () => {
    // ==========================================================================================
    // [review lượt 9 — H9-1] Bản đầu gọi `mkdir(recursive)` rồi `appendFile` (tự tạo tệp), nên
    // một lần `rm -rf` nơi cất không phải là mất mốc neo — nó là RESET về "chưa từng neo", và
    // lượt xuất kế tiếp lấp đầy lại bằng mốc neo của cái sổ đã bị cắt. Kết luận kiểm toán khi ấy
    // XANH, đạt tới bằng XOÁ chứ không cần một nơi cất ghi đè.
    //
    // Mã không ngăn được việc xoá — nhưng nó KHÔNG ĐƯỢC âm thầm coi một nơi cất vừa biến mất là
    // một nơi cất mới tinh. MỐC CHẾT: trả `mkdir(thuMuc, { recursive: true })` vào `append` thì
    // test này ĐỎ.
    // ==========================================================================================
    const kho = createFileAnchorStore(thuMuc);
    await kho.append(ORG, bo.ky(truong(1, "a")));
    await rm(thuMuc, { recursive: true, force: true });

    await expect(kho.append(ORG, bo.ky(truong(2, "b")))).rejects.toThrow(
      /không tồn tại.*tiền đề triển khai/s,
    );
    // Và đường ĐỌC vẫn trả rỗng — đúng, vì rỗng ở đây sinh `NOT_ANCHORED` ở tầng trên chứ không
    // sinh một kết luận xanh.
    expect(await kho.readAllRaw(ORG)).toEqual([]);
  });

  it("[review lượt 9 — H9-6] mô tả nơi cất mang ký tự điều khiển bị khử độc trước khi vào báo cáo", async () => {
    // `moTa` đi vào `source` của mốc neo, rồi vào chẩn đoán `ANCHOR_MISSING`, rồi ra stdout của
    // công cụ. Một `\r` hoặc một escape ANSI ở đó ghi đè những dòng đã in trên terminal của kiểm
    // toán viên — tức nội dung nơi cất viết lại được phần kết luận mà người đọc nhìn thấy.
    const kho = createFileAnchorStore(thuMuc, "kho\u001b[2K\r-doc");
    await kho.append(ORG, bo.ky(truong(1, "a")));
    const neo = await loadVerifiedAnchors(kho, ORG, bo.khoaCongKhai);
    expect(neo[0]!.source).not.toMatch(/\p{C}/u);
    expect(neo[0]!.source).toContain("\\u{1b}");
  });

  it("một dòng hỏng làm CẢ lượt đọc ném — không lọc ra rồi kết luận trên phần còn lại", async () => {
    const kho = createFileAnchorStore(thuMuc);
    await kho.append(ORG, bo.ky(truong(1, "a")));
    await writeFile(join(thuMuc, `${ORG}.jsonl`), "{ khong phai json\n", { flag: "a" });
    await expect(kho.readAllRaw(ORG)).rejects.toThrow(/Dòng 2 .* không phải JSON hợp lệ/);
  });
});

describe("lấy mốc neo đã kiểm từ nơi cất", () => {
  it("[INV-B3] một bản ghi không kiểm được làm CẢ lượt lấy ném, và thông điệp liệt kê đủ", async () => {
    const kho = createFileAnchorStore(thuMuc, "kho thử");
    await kho.append(ORG, bo.ky(truong(1, "a")));
    const gia = taoBoKyNeoThuNghiem("neo-2026");
    await kho.append(ORG, gia.ky(truong(2, "b")));
    await kho.append(ORG, gia.ky(truong(3, "c")));

    await expect(loadVerifiedAnchors(kho, ORG, bo.khoaCongKhai)).rejects.toThrow(
      /2\/3 bản ghi không kiểm được/,
    );
  });

  it("[INV-B3] bản ghi nằm đúng tệp nhưng văn bản đã ký mang org_id KHÁC thì bị từ chối", async () => {
    // Tên tệp là chữ của người GHI; `org_id` bên trong là thứ ĐÃ ĐƯỢC KÝ. Khi hai thứ lệch nhau,
    // hình dạng ấy là một lần chép mốc neo của tổ chức khác sang đây để làm kết luận xanh — nên
    // nó phải KÊU, không phải bị bỏ qua như một bản ghi lạc chỗ.
    const kho = createFileAnchorStore(thuMuc, "kho thử");
    await kho.append(ORG, bo.ky({ ...truong(1, "a"), orgId: ORG_KHAC }));
    await expect(loadVerifiedAnchors(kho, ORG, bo.khoaCongKhai)).rejects.toThrow(
      new RegExp(`mang org_id ${ORG_KHAC}, không phải ${ORG}`),
    );
  });

  it("nơi cất rỗng trả mảng rỗng — và mảng rỗng KHÔNG phải một kết luận xanh", async () => {
    // `verifyAuditChain` biến mảng rỗng thành `NOT_ANCHORED`; ở tầng này nó chỉ là "không có gì".
    // Hai câu ấy phải nằm ở hai chỗ khác nhau, vì nơi cất không biết gì về sổ.
    const kho = createFileAnchorStore(thuMuc);
    expect(await loadVerifiedAnchors(kho, ORG, bo.khoaCongKhai)).toEqual([]);
  });
});

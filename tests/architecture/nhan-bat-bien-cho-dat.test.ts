// ==============================================================================================
// [INV-H22] MỘT NHÃN `[INV-XX]` PHẢI ĐƯỢC ĐẶT Ở MỘT CHỖ ĐÃ KHAI — ĐO TRÊN ĐÚNG THỨ NUÔI MA TRẬN
//
// ----------------------------------------------------------------------------------------------
// KHIẾM KHUYẾT, NÓI THẲNG (khoản nợ 12)
// ----------------------------------------------------------------------------------------------
// `evidence/INV-matrix.md` gom độ phủ bằng nhãn `[INV-XX]` trong `fullName` của báo cáo vitest.
// Một nhãn sai vì thế không phải chuyện vệ sinh: nó ghi một dòng *"passed"* vào hàng của một bất
// biến và làm một lỗ trống TRÔNG NHƯ ĐÃ VÁ. Task 9 đã trả giá đúng ở đó — bốn test biên giới mang
// `[INV-G3]` trong khi G3 nói về xoay master key.
//
// Trước H22, kho có hai lớp và không lớp nào xét CHỖ ĐẶT: `packages/outbox/src/nhan-bat-bien.test.ts`
// (một danh sách cấm, chỉ phủ một gói) và `findUnregisteredLabels` (bắt nhãn trỏ tới mã KHÔNG TỒN
// TẠI — một nhãn đúng cú pháp gắn sai chỗ đi qua nó sạch sẽ).
//
// ----------------------------------------------------------------------------------------------
// BẢN ĐẦU CỦA TỆP NÀY BỊ LƯỢT SOI ĐỐI KHÁNG LƯỢT 19 BÁC — VÀ BÁC ĐÚNG
// ----------------------------------------------------------------------------------------------
// Bản đầu (S1.29) quét DÒNG NGUỒN bắt đầu bằng `it(`/`describe(` rồi đối chiếu với một sổ khai.
// Lượt soi đo được: bộ sinh đếm theo `fullName` LÚC CHẠY, nên `test(`, `suite(`, `it.concurrent(`,
// `it.fails(`, `it.skipIf(x)(`, tiêu đề nằm ở DÒNG SAU của `it.each([...])(` — đều nuôi ma trận mà
// bộ quét mù. Không phải giả thuyết: kho ĐANG có 8 tên test như thế (`anchor-verify.test.ts:109,167`,
// `crypto-keys/src/roundtrip.test.ts:254,269,287,300`, `sealed-envelope/src/roundtrip.test.ts:60`,
// `boundaries.test.ts:230`), và chúng chỉ "được khai" nhờ TRÙNG HỢP có một dòng `it(` khác cùng
// mã, cùng tệp. Mũi thật: đổi tên một test `it.each` ở `roundtrip.test.ts` thành `[INV-A1]…` — tệp
// KHÔNG được khai cho A1 — bản đầu vẫn **7/7 xanh** trong khi vitest báo **11** tên test mang
// `[INV-A1]`. Tức bản đầu chọn ứng viên bằng PHONG CÁCH VIẾT — đúng thứ ADR-035 §2⑴ cấm — và nó
// suýt ra đời với đúng cái lỗ nó sinh ra để bịt, LẦN THỨ HAI trong cùng một vòng.
//
// Bản này bỏ hẳn việc đọc mã nguồn. Phép kiểm sống ở `tools/inv-matrix/src/parse.ts`
// (`findMisplacedLabels`) và đọc CHÍNH báo cáo vitest — cùng nguồn với `collectCoverage` — nên
// không còn cách viết test nào làm hai bộ đọc lệch nhau. Nó được CƯỠNG CHẾ ở cổng `pnpm evidence`
// (job *Evidence pack* trên CI, và `evidence:check` trước mỗi lần đẩy), cạnh `findUnregisteredLabels`.
// Tệp này là lớp T1 cho HÀM THUẦN ấy: fixture + đột biến, không I/O, không đọc kho.
//
// **Bảo đảm, nói đúng mức:** không cặp (mã, tệp) nào ĐƯỢC TÍNH LÀ ĐỘ PHỦ mà chưa được khai, và không
// dòng khai nào thiu — đo trên cùng báo cáo mà độ phủ đo. **Không bảo đảm:** một cặp đã khai là
// ĐÚNG. Sổ khai sinh từ đo lường rồi đóng băng; nó chặn cặp thứ 138, không kiểm toán 137 cặp có sẵn.
// ==============================================================================================

import { describe, expect, it } from "vitest";

import {
  collectCoverage,
  collectLabelUses,
  duongTuongDoi,
  findMisplacedLabels,
} from "../../tools/inv-matrix/src/parse.js";
import { SO_KHAI_NHAN } from "../../tools/inv-matrix/src/so-khai-nhan.js";

const GOC = "D:/kho";

function baoCao(
  tep: ReadonlyArray<{ readonly name: string; readonly tests: readonly string[] }>,
): string {
  return JSON.stringify({
    testResults: tep.map((t) => ({
      name: `${GOC}/${t.name}`,
      assertionResults: t.tests.map((fullName) => ({ fullName, status: "passed" })),
    })),
  });
}

const SO_MAU: Readonly<Record<string, readonly string[]>> = {
  A1: ["apps/x/a.test.ts"],
  B2: ["apps/x/a.test.ts", "packages/y/b.test.ts"],
};

describe("[INV-H22] nhãn bất biến phải đặt ở chỗ đã khai", () => {
  it("P1 — một cặp có trong báo cáo mà chưa khai thì ĐỎ, và thông điệp nêu đúng mã + tệp", () => {
    const uses = collectLabelUses(baoCao([{ name: "apps/x/a.test.ts", tests: ["[INV-A1] a", "[INV-C1] lạc"] }]));
    const kq = findMisplacedLabels(uses, { A1: ["apps/x/a.test.ts"] }, GOC);
    expect(kq.chuaKhai).toEqual([
      "[INV-C1] xuất hiện trong tên test ở apps/x/a.test.ts — cặp này CHƯA CÓ trong sổ khai",
    ]);
  });

  it("P1 — DỜI một nhãn sang một tệp đã khai cho mã KHÁC thì vẫn ĐỎ (chiều hỏng thật của khoản nợ 12)", () => {
    // Nhãn đúng cú pháp, mã có thật, tệp có thật và đang mang nhãn khác — chỉ CHỖ ĐẶT sai.
    const uses = collectLabelUses(baoCao([{ name: "packages/y/b.test.ts", tests: ["[INV-B2] ok", "[INV-A1] lạc chỗ"] }]));
    const kq = findMisplacedLabels(uses, SO_MAU, GOC);
    expect(kq.chuaKhai).toHaveLength(1);
    expect(kq.chuaKhai[0]).toContain("[INV-A1]");
    expect(kq.chuaKhai[0]).toContain("packages/y/b.test.ts");
  });

  it("P1 — nhãn ở BẤT KỲ đâu trong fullName đều được xét, kể cả nhãn thừa hưởng từ describe", () => {
    // Đây là chỗ bản đầu mù: bộ sinh không biết nhãn đến từ `it(`, `test(`, `it.each` nhiều dòng hay
    // `describe(` — nó chỉ thấy fullName. Phép kiểm này đọc đúng thứ ấy.
    const uses = collectLabelUses(baoCao([{ name: "apps/x/a.test.ts", tests: ["khối [INV-D5] > it.concurrent thường"] }]));
    expect(findMisplacedLabels(uses, SO_MAU, GOC).chuaKhai).toEqual([
      "[INV-D5] xuất hiện trong tên test ở apps/x/a.test.ts — cặp này CHƯA CÓ trong sổ khai",
    ]);
  });

  it("P2 — một dòng khai THIU (tệp đã đổi tên, nhãn đã gỡ) thì ĐỎ", () => {
    const uses = collectLabelUses(baoCao([{ name: "apps/x/a.test.ts", tests: ["[INV-A1] a", "[INV-B2] b"] }]));
    const kq = findMisplacedLabels(uses, SO_MAU, GOC);
    expect(kq.chuaKhai).toEqual([]);
    expect(kq.khaiThiu).toEqual([
      "sổ khai kể [INV-B2] ở packages/y/b.test.ts — báo cáo không có tên test nào như thế",
    ]);
  });

  it("P2 — báo cáo RỖNG thì ĐỎ ở MỌI cặp đã khai: đối chứng dương dựng sẵn, không xanh im lặng", () => {
    const soCap = Object.values(SO_KHAI_NHAN).reduce((n, ds) => n + ds.length, 0);
    const kq = findMisplacedLabels([], SO_KHAI_NHAN, GOC);
    expect(kq.khaiThiu).toHaveLength(soCap);
    expect(soCap).toBeGreaterThan(100);
  });

  it("chủ thể của P1/P2 BẰNG chủ thể của độ phủ: nhãn có hậu tố vế và nhãn ngoài [A-H] không bị xét", () => {
    // `collectCoverage` không đếm `[INV-E3(3)]` hay `[INV-M5]`; nếu H22 xét chúng thì nó đo một
    // tập RỘNG HƠN tập nuôi ma trận — sai đối tượng theo chiều ngược lại.
    const bc = baoCao([{ name: "apps/x/a.test.ts", tests: ["[INV-E3(3)] vế", "[INV-M5] lạ", "[INV-A1] a"] }]);
    expect([...collectCoverage(bc).keys()]).toEqual(["A1"]);
    expect(findMisplacedLabels(collectLabelUses(bc), { A1: ["apps/x/a.test.ts"] }, GOC).chuaKhai).toEqual([]);
  });

  it("đường dẫn: tuyệt đối Windows/POSIX đều về tương đối trong kho; ngoài kho thì giữ nguyên", () => {
    expect(duongTuongDoi("D:\\kho\\apps\\x\\a.test.ts", "D:\\kho\\")).toBe("apps/x/a.test.ts");
    expect(duongTuongDoi("D:/kho/apps/x/a.test.ts", "D:/kho")).toBe("apps/x/a.test.ts");
    expect(duongTuongDoi("E:/noi-khac/a.test.ts", "D:/kho")).toBe("E:/noi-khac/a.test.ts");
  });

  it("sổ khai đóng băng có HÌNH DẠNG hợp lệ: mã theo mẫu, tệp tương đối kiểu `/`, không trùng", () => {
    for (const [ma, ds] of Object.entries(SO_KHAI_NHAN)) {
      expect(ma).toMatch(/^[A-H]\d+$/);
      expect(new Set(ds).size).toBe(ds.length);
      for (const tep of ds) {
        expect(tep).toMatch(/^[a-z0-9./_-]+\.test\.ts$/i);
        expect(tep).not.toContain("\\");
      }
    }
  });
});

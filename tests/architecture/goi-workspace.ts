// ==============================================================================================
// [S1.18 / review lượt 10 — H10-1] MỘT GÓI LÀ MỘT THƯ MỤC CÓ `package.json`, KHÔNG PHẢI MỘT THƯ
// MỤC CÓ `src/index.ts`
//
// Hai bất biến của kho — [INV-H16] (mọi gói có họ quy tắc biên giới) và [INV-H18] (mọi gói có
// danh sách trắng barrel) — đều tự nhận là "suy TỪ TÍNH CHẤT, không từ một danh sách tên". Bản
// đầu của cả hai dùng vị từ *"thư mục con của `packages/` có `src/index.ts`"*, và lượt review thứ
// mười gọi đúng tên vấn đề: **danh sách tên chỉ chuyển từ một biến sang một phép thử tồn tại
// tệp.** Kịch bản, không cần một dòng mã xấu nào:
//
//   packages/kms/package.json   →  "exports": { ".": "./src/main.ts" }
//   packages/kms/src/main.ts    →  (không có src/index.ts)
//
// Gói ấy rơi khỏi CẢ HAI vị từ. Không họ quy tắc biên giới nào bị đòi, không danh sách trắng nào
// bị đòi, và hai khẳng định *"danh sách miễn RỖNG"* vẫn XANH — vì miễn trừ đúng là rỗng thật.
// Toàn bộ `packages/kms/src/` với tới được bằng import tương đối từ mọi gói, và bề mặt công khai
// của nó không lớp nào canh: khoản nợ 9 và 17 mở lại **trong im lặng, ngay sau vòng tuyên bố đóng
// chúng**. Cùng lối đó, đổi tên `packages/db/src/index.ts` thành `main.ts` (và sửa `exports` cho
// khớp) làm `db` biến mất khỏi cả hai lớp.
//
// File này là vị từ ĐÚNG, và nó dùng CHUNG cho cả hai bất biến — vì hai bản chép gần giống nhau
// của cùng một vị từ là đúng thứ sẽ trôi khỏi nhau.
//
// HAI QUYẾT ĐỊNH FAIL-CLOSED, nói rõ để không ai "sửa" chúng cho êm:
//   ⑴ một gói KHÔNG khai `exports` thì NÉM, không bị bỏ qua. Không có `exports` nghĩa là không xác
//      định được cửa công khai nào để canh, và "không xác định được" phải ồn ào chứ không được đọc
//      thành "không có gì để canh";
//   ⑵ cửa được đọc TỪ `exports`, không suy ra từ quy ước đặt tên. Mở một cửa thứ hai vì thế buộc
//      phải là một dòng trong `package.json` — thứ mà [INV-H18] cũng nhìn thấy.
// ==============================================================================================

import { existsSync, readFileSync, readdirSync } from "node:fs";

export interface GoiWorkspace {
  readonly ten: string;
  /** Cửa công khai: subpath (`"."`, `"./unwrap"`, …) → đường dẫn tệp so với GỐC KHO. */
  readonly cua: ReadonlyMap<string, string>;
  /** Trường `main` chuẩn hoá về cùng dạng với giá trị của `cua`, hoặc `undefined` nếu không khai. */
  readonly main: string | undefined;
}

const GOC_PACKAGES = new URL("../../packages/", import.meta.url);

/** Mọi thư mục con của `packages/` (kể cả thư mục KHÔNG có `package.json`). */
export function cacThuMucTrongPackages(): string[] {
  return readdirSync(GOC_PACKAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function chuanHoa(pTen: string, pDuongDan: string): string {
  return `packages/${pTen}/${pDuongDan.replace(/^\.\//, "")}`;
}

/** Mọi gói workspace dưới `packages/`, đọc từ ĐĨA và từ chính `package.json` của từng gói. */
export function cacGoiWorkspace(): GoiWorkspace[] {
  return cacThuMucTrongPackages()
    .filter((ten) => existsSync(new URL(`${ten}/package.json`, GOC_PACKAGES)))
    .map((ten) => {
      const noiDung = JSON.parse(
        readFileSync(new URL(`${ten}/package.json`, GOC_PACKAGES), "utf8"),
      ) as { main?: string; exports?: Record<string, string> };

      const khaiCua = noiDung.exports;
      if (khaiCua === undefined || Object.keys(khaiCua).length === 0) {
        throw new Error(
          `packages/${ten}/package.json không khai trường "exports". Không có nó thì không xác ` +
            "định được cửa công khai nào để canh, và [INV-H16]/[INV-H18] sẽ đo một tập RỖNG — " +
            "tức xanh mà không đo gì. Khai `exports` cho gói này.",
        );
      }

      const cua = new Map<string, string>();
      for (const [subpath, duongDan] of Object.entries(khaiCua)) cua.set(subpath, chuanHoa(ten, duongDan));

      return {
        ten,
        cua,
        main: noiDung.main === undefined ? undefined : chuanHoa(ten, noiDung.main),
      };
    });
}

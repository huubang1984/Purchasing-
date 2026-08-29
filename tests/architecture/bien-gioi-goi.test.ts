import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

// ==============================================================================================
// [INV-H16] BIÊN GIỚI MODULE, SUY TỪ TÍNH CHẤT — LỚP THAY CHO VIỆC NHỚ
//
// Tới S1.2 dự án đã thêm TAY năm họ quy tắc biên giới, mỗi họ cho một gói:
//   crypto-keys -> `g1-` (fix round 4) · identity -> `g2-`/H11 (Task 9) · outbox -> `g4-`/H13
//   (Task 10) · supplier -> `g5-`/H15 (S1.1) · rfq -> `g6-` (S1.2, file này).
//
// BỐN LẦN ĐẦU ĐỀU LÀ VÁ XONG RỒI SỬA: một probe import tương đối xuyên gói được đo là đi lọt CẢ
// BA cổng (depcruise, tsc, eslint), rồi quy tắc mới được thêm. Tới lần thứ năm, hình dạng của
// việc này đã hiện rõ và nó KHÔNG dễ chịu: **danh sách các gói được bảo vệ đang nằm trong đầu
// người viết, không nằm trong một biến nào.** Đó đúng là KHUÔN DANH-SÁCH-TÊN mà dự án đã bắt gặp
// hỏng ba lần (khoản nợ 3, 16, 17) — chỉ khác ở chỗ danh sách này còn không được viết ra.
//
// Test này đảo chiều: nó KHÔNG liệt kê các gói ĐƯỢC bảo vệ, nó liệt kê các gói ĐƯỢC MIỄN, và
// danh sách miễn trừ là ĐÓNG, có lý do từng dòng, và CHỈ ĐƯỢC CO LẠI. Gói thứ sáu sẽ không đòi
// ai phải nhớ gì: nó ra đời không có quy tắc thì test này đỏ ngay.
//
// PHẦN LỚP NÀY KHÔNG MUA ĐƯỢC, nói thẳng:
//   * nó đòi quy tắc TỒN TẠI và có HÌNH DẠNG đúng; nó KHÔNG chạy depcruise nên không chứng minh
//     quy tắc có răng. Vế đó do các test probe trong `boundaries.test.ts` giữ, mỗi họ ba ca.
//   * nó KHÔNG phủ danh sách trắng barrel (khoản nợ 9). Bốn gói S0 vẫn không có, và hai gói S1
//     có — nhưng "có" ấy vẫn là một hằng viết tay trong `barrel-exports.test.ts`, không phải một
//     tính chất. Đó là khoản nợ còn lại sau file này.
// ==============================================================================================

interface QuyTac {
  name?: string;
  from?: { path?: string | string[]; pathNot?: string | string[] };
  to?: { path?: string | string[]; pathNot?: string | string[] };
}

const cauHinh = require("../../.dependency-cruiser.cjs") as { forbidden: QuyTac[] };
const { ciFile, ciPrefix } = require("../../dependency-cruiser-ci.cjs") as {
  ciFile: (p: string) => string;
  ciPrefix: (p: string) => string;
};

/**
 * Gói được MIỄN, mỗi dòng một lý do. Danh sách này CHỈ ĐƯỢC CO LẠI — thêm một dòng là mở một lỗ,
 * và nó phải đi qua review của `.github/CODEOWNERS`.
 *
 * Cả bốn đều là gói của S0 và đều nằm trong khoản nợ 17 ("hai mặt tiền chịu lực nhất repo không
 * có lớp nào canh đường vào"). Chúng KHÔNG được miễn vì an toàn hơn — `tenancy/src/with-tenant.ts`
 * là điểm DUY NHẤT gắn `app.org_id` và `audit/src/writer.ts` là đường ghi sổ kiểm toán, tức đúng
 * hai chỗ đáng canh nhất. Chúng được miễn vì đóng chúng là một thay đổi có rủi ro hồi quy riêng,
 * và trộn nó vào S1.2 sẽ làm cả hai việc khó xem xét hơn.
 */
const MIEN_TRU: ReadonlyMap<string, string> = new Map([
  ["audit", "khoản nợ 17 — chưa đóng; `writer.ts` là đường ghi sổ kiểm toán"],
  ["db", "khoản nợ 17 — chưa đóng"],
  ["tenancy", "khoản nợ 17 — chưa đóng; `with-tenant.ts` là điểm DUY NHẤT gắn app.org_id"],
  ["test-support", "hạ tầng kiểm thử, không phải mã sản phẩm — xem khoản nợ 21"],
]);

/** Mọi thư mục con của `packages/` có `src/index.ts`. Đọc từ đĩa, không từ một danh sách. */
function cacGoi(): string[] {
  const goc = new URL("../../packages/", import.meta.url);
  return readdirSync(goc, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((ten) => existsSync(new URL(`${ten}/src/index.ts`, goc)))
    .sort();
}

function nhuMang(giaTri: string | string[] | undefined): string[] {
  if (giaTri === undefined) return [];
  return Array.isArray(giaTri) ? giaTri : [giaTri];
}

/** Quy tắc đóng `packages/<ten>/src/` với `index.ts` là cửa duy nhất, và không cửa nào khác. */
function coQuyTacBienGioi(ten: string): boolean {
  const tienTo = ciPrefix(`packages/${ten}/src/`);
  const cua = ciFile(`packages/${ten}/src/index.ts`);
  return cauHinh.forbidden.some((r) => {
    const toPath = nhuMang(r.to?.path);
    const toPathNot = nhuMang(r.to?.pathNot);
    const fromPathNot = nhuMang(r.from?.pathNot);
    return (
      toPath.includes(tienTo) &&
      toPathNot.includes(cua) &&
      // Cửa duy nhất: nếu `to.pathNot` có thêm phần tử thì gói này mở nhiều hơn một cửa, và ca đó
      // phải được xem tay (crypto-keys là ca như vậy — nó mở `unwrap.ts` và có quy tắc RIÊNG canh
      // cửa thứ hai). Cho phép tối đa hai để không đỏ oan trên crypto-keys.
      toPathNot.length <= 2 &&
      // Miễn trừ `from` duy nhất được phép là CHÍNH thư mục đang được bảo vệ. Một miễn trừ khác
      // nghĩa là có module ngoài được đi thẳng vào trong, và đó phải là một quyết định nhìn thấy
      // được — đúng bất biến chống-tái-diễn của họ `g1-`/`g2-`.
      fromPathNot.length === 1 &&
      fromPathNot[0] === tienTo
    );
  });
}

describe("biên giới module của mọi gói", () => {
  it("[INV-H16] mọi gói trong packages/ có quy tắc biên giới, trừ danh sách miễn ĐÓNG", () => {
    const goi = cacGoi();

    // Chống rỗng ruột theo hai chiều: phải đọc được gói, và phải có gói KHÔNG được miễn (nếu mọi
    // gói đều nằm trong danh sách miễn thì test này xanh mà không đo gì).
    expect(goi.length, "không đọc được gói nào trong packages/").toBeGreaterThan(4);
    const phaiCo = goi.filter((t) => !MIEN_TRU.has(t));
    expect(phaiCo.length, "mọi gói đều được miễn — lớp này không đo gì").toBeGreaterThan(0);

    expect(
      phaiCo.filter((ten) => !coQuyTacBienGioi(ten)),
      "Gói không có họ quy tắc biên giới đóng `src/` với `index.ts` là cửa duy nhất. Thêm một họ " +
        "quy tắc mới vào .dependency-cruiser.cjs theo khuôn `g5-`/`g6-`, CỘNG ba test probe " +
        "trong tests/architecture/boundaries.test.ts — quy tắc chưa từng đỏ thật là quy tắc chưa " +
        "được đo. Thêm gói vào MIEN_TRU KHÔNG phải cách sửa: danh sách đó chỉ được co lại.",
    ).toEqual([]);
  });

  it("[INV-H16] danh sách miễn trừ không chứa gói đã có quy tắc — nó phải CO LẠI, không được ôm", () => {
    // Ràng buộc hai chiều, cùng cơ chế với `MA_DUOC_PHEP_CHUA_PHU` của evidence pack: một gói vừa
    // có quy tắc vừa nằm trong danh sách miễn là một dòng đã hết hạn, và nếu không ai gỡ thì danh
    // sách sẽ chỉ dài thêm.
    expect(
      [...MIEN_TRU.keys()].filter((ten) => coQuyTacBienGioi(ten)),
      "Gói này đã có quy tắc biên giới — gỡ nó khỏi MIEN_TRU và cập nhật khoản nợ 17.",
    ).toEqual([]);
  });

  it("[INV-H16] mọi tên trong danh sách miễn trừ là một gói CÓ THẬT", () => {
    // Một dòng miễn trừ trỏ tới gói không tồn tại là một dòng chết: nó không miễn gì, nhưng nó
    // làm danh sách trông dài hơn thực tế và làm khoản nợ 17 trông lớn hơn thực tế.
    const goi = new Set(cacGoi());
    expect([...MIEN_TRU.keys()].filter((ten) => !goi.has(ten))).toEqual([]);
  });
});

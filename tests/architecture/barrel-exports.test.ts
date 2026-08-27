import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ============================================================================================
// FIX ROUND 5 (CR3) — CHẶN SYMBOL, KHÔNG PHẢI CHẶN CẠNH
//
// dependency-cruiser cưỡng chế bất biến G1 ở tầng CẠNH phụ thuộc: module nào được phép import
// module nào. Nó KHÔNG nhìn thấy symbol. Vì vậy có một cây cầu mà không cấu hình depcruise nào
// bắt được — mọi cạnh trên đường đi đều hợp pháp:
//
//   local-dev-wrapper.ts += export { deriveOrgKey } from "./local-dev-shared.js";
//   index.ts             += export { deriveOrgKey } from "./local-dev-wrapper.js";
//   apps/bat-ky/src/x.ts :  export { deriveOrgKey } from "@trustprocure/crypto-keys";
//
// Cạnh 1 (local-dev-wrapper.ts → local-dev-shared.ts) hợp pháp: wrapper cần deriveOrgKey để bọc
// khóa. Cạnh 2 (index.ts → local-dev-wrapper.ts) hợp pháp và cần thiết: barrel phải re-export
// createLocalDevWrapper. Cạnh 3 hợp pháp: index.ts là cửa công khai mọi service được import.
// Kết quả đã kiểm chứng trên 564850d: `pnpm depcruise` cho EXIT=0. deriveOrgKey — cộng
// node:crypto là đủ tự mở phong bì giá thầu — ra tới mặt tiền công khai mà hàng rào im lặng.
//
// Đây không phải lỗi cấu hình; đó là giới hạn nguyên lý của phân tích cạnh. Cần một công cụ
// khác cho đúng việc khác: KHẲNG ĐỊNH TẬP EXPORT THẬT của hai cửa khớp danh sách trắng.
//
// Ba quyết định thiết kế, nói rõ để người sau không phải đoán:
//
// 1. ĐỌC LÚC CHẠY, KHÔNG PHÂN TÍCH TĨNH CHUỖI. Test `import()` chính file cửa rồi đếm
//    Object.keys(). Nhờ vậy nó đỏ CẢ KHI symbol tới qua re-export bắc cầu nhiều tầng —
//    thứ mà việc đọc nội dung index.ts bằng regex sẽ bỏ sót hoàn toàn (chuỗi "deriveOrgKey"
//    có thể không hề xuất hiện trong index.ts nếu dùng `export * from "./local-dev-wrapper.js"`).
//
// 2. ĐI QUA "exports" CỦA package.json, KHÔNG HARDCODE ĐƯỜNG DẪN FILE. Test hỏi chính
//    packages/crypto-keys/package.json xem cửa "." và "./unwrap" trỏ vào đâu rồi mới import.
//    Nếu ai đó trỏ lại cửa sang file khác, test đi theo cửa mới — nó canh CÁI CỬA, không canh
//    một file cố định. Test thứ ba khóa luôn TẬP cửa, vì thêm một subpath export là thêm một
//    cửa công khai vượt mặt cả hai danh sách trắng.
//
// 3. DYNAMIC IMPORT VỚI BIẾN LÀ CỐ Ý, KHÔNG PHẢI TIỆN TAY. Một `import` tĩnh từ file test này
//    vào @trustprocure/crypto-keys/unwrap sẽ TỰ NÓ vi phạm
//    g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts (tsPreCompilationDeps: true nên depcruise
//    thấy cả import chỉ-kiểu) và làm `pnpm depcruise` đỏ. Test cần ĐỌC bề mặt export chứ không
//    cần PHỤ THUỘC vào module; dynamic import với specifier dựng từ biến diễn đạt đúng ý đó và
//    không tạo cạnh phụ thuộc nào.
//
// GIỚI HẠN ĐÃ BIẾT — danh sách trắng chỉ phủ export GIÁ TRỊ. Export chỉ-kiểu (`WrappedKey`,
// `KeyWrapper`, `KeyUnwrapper`) bị xóa lúc biên dịch nên không có mặt trong Object.keys() và
// không cách nào liệt kê lúc chạy. Chấp nhận được vì đúng thứ cần chặn là NĂNG LỰC: một kiểu
// không giải mã được gì; chỉ hàm/giá trị mới làm được, và toàn bộ hàm/giá trị đều bị phủ.
// Cách duy nhất canh được export chỉ-kiểu là `import type` tĩnh trong test — mà với cửa
// unwrap thì chính nó là vi phạm G1 (xem quyết định 3), nên sẽ bất đối xứng và sai hướng.
// ============================================================================================

/** Danh sách trắng: export GIÁ TRỊ của mặt tiền bọc khóa, cửa mọi service được phép import. */
const DANH_SACH_TRANG_INDEX = ["KeyError", "MasterKeyRing", "createLocalDevWrapper"];

/** Danh sách trắng: export GIÁ TRỊ của cửa hạn chế, chỉ apps/unseal-worker được import. */
const DANH_SACH_TRANG_UNWRAP = ["createLocalDevUnwrapper"];

/** Tập subpath export hợp lệ của package — mỗi mục là MỘT cửa công khai. */
const TAP_CUA_HOP_LE = [".", "./unwrap"];

const PACKAGE_JSON_URL = new URL("../../packages/crypto-keys/package.json", import.meta.url);

function docExportsCuaPackage(): Record<string, string> {
  const noiDung = JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8")) as {
    exports?: Record<string, string>;
  };
  if (!noiDung.exports) {
    throw new Error("packages/crypto-keys/package.json không khai trường 'exports'");
  }
  return noiDung.exports;
}

/** Import THẬT file mà một cửa trỏ tới, trả về tên các export giá trị (đã sắp xếp). */
async function docExportGiaTri(pTenCua: string): Promise<string[]> {
  const duongDanTuongDoi = docExportsCuaPackage()[pTenCua];
  if (duongDanTuongDoi === undefined) {
    throw new Error(`packages/crypto-keys/package.json không khai cửa "${pTenCua}"`);
  }
  const urlCua = new URL(duongDanTuongDoi, PACKAGE_JSON_URL);
  const moduleThat = (await import(/* @vite-ignore */ urlCua.href)) as Record<string, unknown>;
  return Object.keys(moduleThat).sort();
}

function kiemChungDanhSachTrang(pTenCua: string, pThucTe: string[], pDanhSachTrang: string[]): void {
  const thua = pThucTe.filter((ten) => !pDanhSachTrang.includes(ten));
  expect(
    thua,
    `Symbol LẠ lọt ra cửa "${pTenCua}" của @trustprocure/crypto-keys: ${thua.join(", ")}. ` +
      "Mỗi symbol ở đây là một năng lực mọi service gọi được. Nếu nó tới qua re-export bắc " +
      "cầu, gỡ dòng re-export đó; nếu thật sự cần công khai, thêm vào danh sách trắng trong " +
      "tests/architecture/barrel-exports.test.ts kèm lý do — đó phải là một quyết định nhìn " +
      "thấy được, không phải một dòng lặng lẽ (bất biến G1, ADR-006).",
  ).toEqual([]);

  const thieu = pDanhSachTrang.filter((ten) => !pThucTe.includes(ten));
  expect(
    thieu,
    `Symbol trong danh sách trắng đã BIẾN MẤT khỏi cửa "${pTenCua}": ${thieu.join(", ")}. ` +
      "Danh sách trắng là hợp đồng HAI CHIỀU của mặt tiền công khai: thiếu cũng sai như thừa.",
  ).toEqual([]);
}

describe("bề mặt export công khai của crypto-keys", () => {
  it("[INV-G1] cửa an toàn @trustprocure/crypto-keys chỉ xuất đúng danh sách trắng", async () => {
    kiemChungDanhSachTrang(".", await docExportGiaTri("."), DANH_SACH_TRANG_INDEX);
  });

  it("[INV-G1] cửa hạn chế @trustprocure/crypto-keys/unwrap chỉ xuất đúng danh sách trắng", async () => {
    kiemChungDanhSachTrang("./unwrap", await docExportGiaTri("./unwrap"), DANH_SACH_TRANG_UNWRAP);
  });

  it("[INV-G1] package crypto-keys chỉ khai đúng hai cửa subpath export", () => {
    // Hai danh sách trắng ở trên chỉ có nghĩa khi TẬP cửa là cố định. Thêm một subpath export
    // (vd. "./local-dev-shared") là mở một cửa thứ ba đi vòng qua cả hai danh sách trắng —
    // và depcruise vẫn im vì cạnh tới file đó có thể hợp pháp với chính cửa mới.
    expect(Object.keys(docExportsCuaPackage()).sort()).toEqual([...TAP_CUA_HOP_LE].sort());
  });
});

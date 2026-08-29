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

// ============================================================================================
// [vòng fix 1 — F6] CÙNG CÔNG CỤ, MỘT MẶT TIỀN KHÁC: @trustprocure/identity
//
// `hasPermission` trả `boolean` và KHÔNG ghi kiểm toán. Một cổng gác viết bằng nó hợp lệ về
// kiểu, đọc rất tự nhiên, và vi phạm bất biến D5 ("mỗi lần TỪ CHỐI quyền để lại bản ghi kiểm
// toán") TRONG IM LẶNG — đo trên PostgreSQL 16.15: dò 11 mã quyền qua `hasPermission` cho ra
// 0 bản ghi mới trong sổ. Thân `requirePermission` thì vững (ba đường làm một lần từ chối biến
// mất đều thất bại); lỗ nằm ở MẶT TIỀN GÓI.
//
// depcruise KHÔNG bắt được: mọi cạnh trên đường `rbac.ts -> index.ts -> gói khác` đều hợp
// pháp — đúng giới hạn nguyên lý đã mô tả ở đầu file này cho `deriveOrgKey`. Nên lớp cưỡng chế
// là khẳng định TẬP EXPORT THẬT, cùng công cụ, cùng lập luận.
//
// PHÁT BIỂU ĐÚNG MỨC: việc này đóng ĐÚNG MỘT đường — một gói KHÁC vô tình dựng cổng gác bằng
// `hasPermission`. Mã bên trong chính gói identity vẫn gọi nó trực tiếp được (và test tích hợp
// của gói đó đang làm thế, có chủ ý), còn một lần từ chối ở TẦNG CSDL (RLS/GRANT) vẫn không
// sinh bản ghi nào. D5 được cưỡng chế cho ĐƯỜNG ĐI QUA `requirePermission`, không hơn.
// ============================================================================================
// [Task 9] Bốn nhóm mới, và HAI vắng mặt là load-bearing:
//   * `isWellFormedTotpCode` (totp.ts) — hợp đồng NỘI BỘ giữa totp.ts và mfa-credentials.ts.
//     Nó là một biểu thức hình dạng, không phải một năng lực; đưa ra cửa chỉ mời gọi một tầng
//     khác tự viết phép kiểm mã TOTP bằng nó.
//   * `MfaRequiredError`/`assertFreshMfa` thì CÓ ở đây, và đó là đúng: khác `hasPermission`,
//     `assertFreshMfa` NÉM khi không thoả (fail-closed) chứ không trả boolean, nên nó không
//     dựng ra được một cổng gác im lặng — đúng lý do đã rút `hasPermission` khỏi cửa này.
//
// [vòng fix 1 — MỤC 4] VẮNG MẶT THỨ BA, VÀ NÓ LÀ MỘT LỖ ĐÃ ĐO CHỨ KHÔNG PHẢI MỘT SỰ GỌN GÀNG:
// `verifyTotpCode` từng nằm trong danh sách này. Tiêu chí ngay trên ("không trả boolean nên
// không dựng ra được cổng gác im lặng") ĐÃ KHÔNG được áp cho nó — nó trả `{ok:false, reason}`.
// ĐO: `tools/zzprobe/cong-gac-im-lang.ts` thân `return verifyTotpCode(biMatRo, code).ok` cho
// typecheck/lint/depcruise ĐỀU exit 0. Cổng gác ấy bỏ qua `failed_attempts` và `locked_until`,
// tức bỏ qua E3(1) và E3(4) trong im lặng — và bên dựng được nó là composition root, nơi DUY
// NHẤT có bí mật TOTP rõ. Đường sản phẩm là `verifyTotpAttempt`. Xem khối lý do ở
// packages/identity/src/index.ts.
//
// GIỚI HẠN CỦA CHÍNH LỚP NÀY, viết ra để lần sau không ai tưởng nó rộng hơn thực tế: file này
// khoá DANH SÁCH export, KHÔNG khoá HÌNH DẠNG từng symbol. Lớp mà Task 8 mua được cho D5 vì
// vậy KHÔNG tự động áp cho E3 — nó chỉ bắt được symbol MỚI xuất hiện, không bắt được một
// symbol đã nằm trong danh sách trắng nhưng có hình dạng "cổng gác im lặng".
//
// SỔ NỢ (QT1 quét toàn thư mục packages/): hôm nay CHỈ `crypto-keys` và `identity` có danh
// sách trắng barrel. `audit`, `tenancy`, `db`, `test-support` KHÔNG CÓ — nên một symbol mọc ra
// ở mặt tiền của một trong bốn gói đó ngày mai KHÔNG được canh bởi lớp nào. Xem
// task-9-report.md §V3.5.
const DANH_SACH_TRANG_IDENTITY = [
  "CHAIN_COVERING_ROLE_PAIRS",
  "MAX_TOTP_WINDOW",
  "MFA_LOCKOUT_SECONDS",
  "MFA_MAX_ALLOWED_FAILED_ATTEMPTS",
  "MFA_MAX_FAILED_ATTEMPTS",
  "MfaRequiredError",
  "PERMISSIONS",
  "PermissionAuditFailedError",
  "PermissionDeniedError",
  "SEPARATION_OF_DUTIES_CHAIN",
  "assertFreshMfa",
  "counterForTime",
  "deriveTotpCode",
  "enrollTotpCredential",
  "generateTotpSecret",
  "requirePermission",
  "verifyTotpAttempt",
];

const IDENTITY_PACKAGE_JSON_URL = new URL("../../packages/identity/package.json", import.meta.url);

describe("bề mặt export công khai của identity", () => {
  it("[INV-D5] cửa @trustprocure/identity chỉ xuất đúng danh sách trắng", async () => {
    const noiDung = JSON.parse(readFileSync(IDENTITY_PACKAGE_JSON_URL, "utf8")) as {
      exports?: Record<string, string>;
    };
    const duongDan = noiDung.exports?.["."];
    if (duongDan === undefined) {
      throw new Error("packages/identity/package.json không khai cửa '.'");
    }
    const urlCua = new URL(duongDan, IDENTITY_PACKAGE_JSON_URL);
    const moduleThat = (await import(/* @vite-ignore */ urlCua.href)) as Record<string, unknown>;
    const thucTe = Object.keys(moduleThat).sort();

    expect(thucTe.length, "chống rỗng ruột: cửa phải xuất ít nhất một symbol").toBeGreaterThan(0);
    expect(
      thucTe.filter((ten) => !DANH_SACH_TRANG_IDENTITY.includes(ten)),
      "Symbol LẠ lọt ra cửa công khai của @trustprocure/identity. Nếu đó là một hàm trả lời " +
        "câu hỏi quyền mà KHÔNG ghi kiểm toán, nó là một cổng gác vi phạm D5 trong im lặng — " +
        "giữ nó ở trong gói. Xem khối chú thích ở packages/identity/src/index.ts.",
    ).toEqual([]);
    expect(
      DANH_SACH_TRANG_IDENTITY.filter((ten) => !thucTe.includes(ten)),
      "Symbol trong danh sách trắng đã biến mất khỏi cửa @trustprocure/identity.",
    ).toEqual([]);
  });

  it("[INV-D5] `hasPermission` KHÔNG có mặt ở cửa công khai — đối chứng chống rỗng ruột", async () => {
    // Vế đối chứng: nếu ai đó thêm lại `hasPermission` vào barrel, khẳng định "danh sách trắng"
    // ở trên đã đỏ — nhưng test này nêu ĐÍCH DANH symbol đang được canh, nên thông báo lỗi nói
    // đúng thứ bị vi phạm thay vì "có một symbol lạ".
    const urlCua = new URL("./src/index.ts", IDENTITY_PACKAGE_JSON_URL);
    const moduleThat = (await import(/* @vite-ignore */ urlCua.href)) as Record<string, unknown>;
    expect(Object.keys(moduleThat)).not.toContain("hasPermission");
    // Và nó PHẢI còn tồn tại ở module nội bộ — nếu không, test này xanh vì hàm đã bị xoá chứ
    // không vì nó được giữ đúng chỗ.
    const noiBo = (await import(
      /* @vite-ignore */ new URL("./src/rbac.ts", IDENTITY_PACKAGE_JSON_URL).href
    )) as Record<string, unknown>;
    expect(typeof noiBo["hasPermission"]).toBe("function");
  });

  it("[INV-E3] `verifyTotpCode` KHÔNG có mặt ở cửa công khai — cổng gác MFA im lặng không dựng được", async () => {
    // Cùng khuôn với test `hasPermission` ngay trên, và cùng lý do ở một bất biến KHÁC: một hàm
    // trả `{ok:false, reason}` mà KHÔNG đọc `mfa_credentials`, KHÔNG ghi `last_used_counter`,
    // KHÔNG đếm `failed_attempts` và KHÔNG tôn trọng `locked_until` là một cổng gác bỏ qua
    // E3(1) và E3(4) trong im lặng. Đường sản phẩm là `verifyTotpAttempt`.
    // Test này nêu ĐÍCH DANH symbol đang được canh, nên nếu ai đó thêm lại nó, thông báo lỗi nói
    // đúng thứ bị vi phạm thay vì "có một symbol lạ".
    const urlCua = new URL("./src/index.ts", IDENTITY_PACKAGE_JSON_URL);
    const moduleThat = (await import(/* @vite-ignore */ urlCua.href)) as Record<string, unknown>;
    expect(Object.keys(moduleThat)).not.toContain("verifyTotpCode");
    // Đối chứng chống rỗng ruột, HAI vế:
    //   (a) hàm PHẢI còn tồn tại ở module nội bộ — nếu không, test này xanh vì nó đã bị xoá.
    const noiBo = (await import(
      /* @vite-ignore */ new URL("./src/totp.ts", IDENTITY_PACKAGE_JSON_URL).href
    )) as Record<string, unknown>;
    expect(typeof noiBo["verifyTotpCode"]).toBe("function");
    //   (b) đường SẢN PHẨM phải VẪN ở cửa — nếu không, "không dựng được cổng gác im lặng" xanh
    //       vì gói không còn xác thực được gì cả.
    expect(typeof moduleThat["verifyTotpAttempt"]).toBe("function");
  });
});

// ============================================================================================
// [Task 10] GÓI THỨ BA CÓ DANH SÁCH TRẮNG BARREL: @trustprocure/outbox
//
// Cùng công cụ, cùng lập luận, một mặt tiền khác. Sổ nợ mà Task 9 để lại ("bốn gói KHÔNG có
// danh sách trắng barrel — audit, tenancy, db, test-support") nay còn ĐÚNG BỐN gói đó; gói
// outbox ra đời KÈM lớp này thay vì thêm một khoản nợ thứ năm.
//
// PHÁT BIỂU ĐÚNG MỨC, để không ai trích quá lời: lớp này khoá DANH SÁCH export, KHÔNG khoá
// HÌNH DẠNG từng symbol — đúng giới hạn đã ghi cho identity ở khối trên. Nó bắt được một symbol
// MỚI mọc ra ở cửa (kể cả khi tới qua re-export bắc cầu), không bắt được một symbol đã nằm
// trong danh sách trắng nhưng đổi hành vi.
//
// HAI VẮNG MẶT LÀ LOAD-BEARING: `KetCucKhongGhiDuocError` và `HetGioHandlerError` KHÔNG ở cửa.
// Cả hai là tín hiệu nội bộ giữa `runOnceForOrg` và khối bắt lỗi của chính nó; đưa ra cửa chỉ
// mời gọi một tầng khác tự phán xử vòng đời hạn thuê bằng tay, và đó là đúng thứ hàng rào
// `attempts = <giá trị đã claim>` sinh ra để không ai phải làm.
// (`LeaseLostError` là TÊN CŨ của lớp thứ nhất — xem `JobFailureReason` ở runner.ts để biết vì
// sao cái tên đó gộp ba nguyên nhân khác hẳn nhau và đã bị đổi ở vòng fix 1.)
const DANH_SACH_TRANG_OUTBOX = [
  "JobRunner",
  "MAX_ATTEMPTS_LIMIT",
  "MAX_BATCH_SIZE",
  "MAX_HANDLER_TIMEOUT_MS",
  "MAX_LEASE_SECONDS",
  "MAX_POLL_INTERVAL_MS",
  "MAX_RETRY_DELAY_SECONDS",
  "MIN_POLL_INTERVAL_MS",
  "OutboxError",
  "enqueueJob",
];

const OUTBOX_PACKAGE_JSON_URL = new URL("../../packages/outbox/package.json", import.meta.url);

describe("bề mặt export công khai của outbox", () => {
  it("cửa @trustprocure/outbox chỉ xuất đúng danh sách trắng", async () => {
    const noiDung = JSON.parse(readFileSync(OUTBOX_PACKAGE_JSON_URL, "utf8")) as {
      exports?: Record<string, string>;
    };
    const duongDan = noiDung.exports?.["."];
    if (duongDan === undefined) {
      throw new Error("packages/outbox/package.json không khai cửa '.'");
    }
    const urlCua = new URL(duongDan, OUTBOX_PACKAGE_JSON_URL);
    const moduleThat = (await import(/* @vite-ignore */ urlCua.href)) as Record<string, unknown>;
    const thucTe = Object.keys(moduleThat).sort();

    expect(thucTe.length, "chống rỗng ruột: cửa phải xuất ít nhất một symbol").toBeGreaterThan(0);
    expect(
      thucTe.filter((ten) => !DANH_SACH_TRANG_OUTBOX.includes(ten)),
      "Symbol LẠ lọt ra cửa công khai của @trustprocure/outbox. Mỗi symbol ở đây là một năng " +
        "lực mọi service gọi được; thêm nó vào danh sách trắng phải là một quyết định nhìn " +
        "thấy được, không phải một dòng re-export lặng lẽ.",
    ).toEqual([]);
    expect(
      DANH_SACH_TRANG_OUTBOX.filter((ten) => !thucTe.includes(ten)),
      "Symbol trong danh sách trắng đã biến mất khỏi cửa @trustprocure/outbox — hợp đồng hai " +
        "chiều: thiếu cũng sai như thừa.",
    ).toEqual([]);
  });

  it("tín hiệu nội bộ của runner KHÔNG có mặt ở cửa công khai — đối chứng chống rỗng ruột", async () => {
    const urlCua = new URL("./src/index.ts", OUTBOX_PACKAGE_JSON_URL);
    const moduleThat = (await import(/* @vite-ignore */ urlCua.href)) as Record<string, unknown>;
    expect(Object.keys(moduleThat)).not.toContain("LeaseLostError");
    expect(Object.keys(moduleThat)).not.toContain("KetCucKhongGhiDuocError");
    expect(Object.keys(moduleThat)).not.toContain("HetGioHandlerError");
    // Và đường SẢN PHẨM phải VẪN ở cửa — nếu không, test này xanh vì gói không còn chạy job nào.
    expect(typeof moduleThat["JobRunner"]).toBe("function");
    expect(typeof moduleThat["enqueueJob"]).toBe("function");
  });

  it("package outbox chỉ khai đúng MỘT cửa subpath export", () => {
    const noiDung = JSON.parse(readFileSync(OUTBOX_PACKAGE_JSON_URL, "utf8")) as {
      exports?: Record<string, string>;
    };
    expect(Object.keys(noiDung.exports ?? {})).toEqual(["."]);
  });
});

// ============================================================================================
// [INV-H15] CÙNG CÔNG CỤ, MẶT TIỀN THỨ BA: @trustprocure/supplier
//
// Khối "SỔ NỢ" ở trên viết: hôm nay CHỈ `crypto-keys` và `identity` có danh sách trắng barrel.
// Câu đó nay HẸP HƠN thực tế — `supplier` là gói thứ ba, và nó có danh sách trắng NGAY TỪ KHI
// RA ĐỜI thay vì mua bằng một vòng fix sau khi lỗ đã đo được. Bốn gói còn lại (`audit`,
// `tenancy`, `db`, `test-support`) VẪN không có gì; khoản nợ 9 không được đóng bởi khối này.
//
// Bất biến đang được canh ở đây KHÔNG phải "danh sách export cho gọn". Mọi hàm của gói supplier
// gọi `assertTenantBound` TRƯỚC MỌI THỨ; một symbol mọc ra ở cửa này mà bỏ bước đó sẽ là một
// đường đọc/ghi sổ nhà cung cấp KHÔNG có phép kiểm "phiên đang gắn đúng tổ chức chưa" — và hậu
// quả không phải một lỗi, mà là một MẢNG RỖNG đọc như "không có gì".
//
// GIỚI HẠN, cùng giới hạn đã ghi cho identity: lớp này khoá DANH SÁCH, không khoá HÌNH DẠNG.
// Một hàm mới được thêm vào danh sách trắng kèm một dòng lý do vẫn đi lọt; lớp cuối là người đọc.
// ============================================================================================
const DANH_SACH_TRANG_SUPPLIER = [
  "SUPPLIER_LEVELS",
  "SUPPLIER_STATUSES",
  "SupplierError",
  "TAX_CODE_PATTERN",
  "addSupplierContact",
  "createSupplier",
  "findSupplierByTaxCode",
  "getSupplier",
  "listSupplierContacts",
  "listSuppliers",
];

const SUPPLIER_PACKAGE_JSON_URL = new URL("../../packages/supplier/package.json", import.meta.url);

describe("bề mặt export công khai của supplier", () => {
  it("[INV-H15] cửa @trustprocure/supplier chỉ xuất đúng danh sách trắng", async () => {
    const noiDung = JSON.parse(readFileSync(SUPPLIER_PACKAGE_JSON_URL, "utf8")) as {
      exports?: Record<string, string>;
    };
    const duongDan = noiDung.exports?.["."];
    if (duongDan === undefined) {
      throw new Error("packages/supplier/package.json không khai cửa '.'");
    }
    const urlCua = new URL(duongDan, SUPPLIER_PACKAGE_JSON_URL);
    const moduleThat = (await import(/* @vite-ignore */ urlCua.href)) as Record<string, unknown>;
    const thucTe = Object.keys(moduleThat).sort();

    expect(thucTe.length, "chống rỗng ruột: cửa phải xuất ít nhất một symbol").toBeGreaterThan(0);
    expect(
      thucTe.filter((ten) => !DANH_SACH_TRANG_SUPPLIER.includes(ten)),
      "Symbol LẠ lọt ra cửa công khai của @trustprocure/supplier. Mọi hàm ở cửa này phải gọi " +
        "assertTenantBound trước mọi thứ — xem khối chú thích ở packages/supplier/src/index.ts.",
    ).toEqual([]);
    expect(
      DANH_SACH_TRANG_SUPPLIER.filter((ten) => !thucTe.includes(ten)),
      "Symbol trong danh sách trắng đã biến mất khỏi cửa @trustprocure/supplier.",
    ).toEqual([]);
  });
});

// ============================================================================================
// MẶT TIỀN THỨ TƯ: @trustprocure/rfq (S1.2)
//
// `RFQ_TRANSITIONS` ở trong danh sách này là symbol đáng chú ý nhất, và lý do nó ĐƯỢC ở lại đáng
// ghi: nó là DỮ LIỆU (bản sao để đọc của bảng cạnh trong 009), không phải một hàm phán xét. Tiêu
// chí đã dùng cho `hasPermission` và `verifyTotpCode` — "thứ dựng được một cổng gác im lặng thì
// giữ trong gói" — vẫn áp: ai dựng cổng gác bằng mảng này sẽ canh đúng đường đi qua nó, trong khi
// trigger canh mọi đường. Nhưng khác hai ca kia ở một điểm quyết định: cổng gác ấy KHÔNG làm hàng
// rào thật biến mất, nó chỉ thừa. Có test đọc thẳng 009 và đòi hai bên khớp byte-với-cạnh.
// ============================================================================================
const DANH_SACH_TRANG_RFQ = [
  "RFQ_STATUSES",
  "RFQ_TRANSITIONS",
  "RfqError",
  "addRfqItem",
  "approveRfq",
  "cancelRfq",
  "closeRfq",
  "createRfq",
  "extendRfqDeadline",
  "getRfq",
  "listRfqItems",
  "openRfq",
  "submitRfqForApproval",
];

const RFQ_PACKAGE_JSON_URL = new URL("../../packages/rfq/package.json", import.meta.url);

describe("bề mặt export công khai của rfq", () => {
  it("[INV-H16] cửa @trustprocure/rfq chỉ xuất đúng danh sách trắng", async () => {
    const noiDung = JSON.parse(readFileSync(RFQ_PACKAGE_JSON_URL, "utf8")) as {
      exports?: Record<string, string>;
    };
    const duongDan = noiDung.exports?.["."];
    if (duongDan === undefined) throw new Error("packages/rfq/package.json không khai cửa '.'");
    const urlCua = new URL(duongDan, RFQ_PACKAGE_JSON_URL);
    const moduleThat = (await import(/* @vite-ignore */ urlCua.href)) as Record<string, unknown>;
    const thucTe = Object.keys(moduleThat).sort();

    expect(thucTe.length, "chống rỗng ruột: cửa phải xuất ít nhất một symbol").toBeGreaterThan(0);
    expect(
      thucTe.filter((ten) => !DANH_SACH_TRANG_RFQ.includes(ten)),
      "Symbol LẠ lọt ra cửa công khai của @trustprocure/rfq.",
    ).toEqual([]);
    expect(
      DANH_SACH_TRANG_RFQ.filter((ten) => !thucTe.includes(ten)),
      "Symbol trong danh sách trắng đã biến mất khỏi cửa @trustprocure/rfq.",
    ).toEqual([]);
  });
});

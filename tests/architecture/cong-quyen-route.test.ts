import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// =============================================================================================
// [ADR-016 mục 4] CỔNG QUYỀN Ở TẦNG ỨNG DỤNG LÀ MẶC ĐỊNH MỞ — ĐÂY LÀ LỚP ĐÓNG NÓ LẠI
//
// ADR-016 chọn đặt `requirePermission` ở TẦNG ỨNG DỤNG chứ không trong gói nghiệp vụ, vì ba lý do
// cụ thể (auditPool là transaction độc lập; mã quyền ánh xạ theo CA SỬ DỤNG chứ không theo hàm;
// `listSuppliers` còn có đường gọi không có người dùng nào). Nhược điểm của lựa chọn ấy được ghi
// ngay trong ADR: **một route mới không có cổng thì không lớp nào kêu.**
//
// ADR-016 mục 4 vì vậy ghim một điều kiện: *route đầu tiên của `apps/` phải ra đời CÙNG LÚC với
// lớp canh này.* File này là lớp ấy, và nó ra đời TRƯỚC route đầu tiên — đúng thứ tự, vì thứ tự
// ngược lại là đúng thứ đã sinh ra khoản nợ 17 (*"LẦN THỨ BA CÙNG MỘT LỚP LỖ"*).
//
// ---------------------------------------------------------------------------------------------
// NÓ CANH ĐIỀU GÌ — VÀ VÌ SAO KHÔNG PHẢI "MỌI ROUTE"
// ---------------------------------------------------------------------------------------------
// Định nghĩa "route" phụ thuộc vào framework chưa được chọn, nên canh theo route là canh theo một
// thứ chưa tồn tại. Vị từ ở đây KHÔNG dùng chữ "route": **một module trong `apps/` mà gọi tới một
// hàm ĐỔI TRẠNG THÁI của gói nghiệp vụ thì phải nhắc tới `requirePermission`.**
//
// Đó là một vị từ yếu hơn "route có cổng đúng mã quyền" và điều đó phải nói ra: nó KHÔNG kiểm mã
// quyền có ĐÚNG không, KHÔNG kiểm cổng chạy TRƯỚC lời gọi, và một `requirePermission` nằm trong
// một nhánh `if (false)` vẫn đi lọt. Nó đóng đúng MỘT đường: một module ứng dụng gọi thẳng
// `createSupplier` mà **không có một dòng nào** về quyền. Đó là hình dạng của một sơ suất thật,
// không phải hình dạng của một kẻ tấn công.
//
// ---------------------------------------------------------------------------------------------
// HAI LỚP, VÌ MỘT LỚP TỰ LÀM MÙ MÌNH
// ---------------------------------------------------------------------------------------------
// Lớp thứ hai (§2 dưới đây) là lớp quan trọng hơn: danh sách hàm-đổi-trạng-thái được đối chiếu với
// TẬP EXPORT THẬT của ba barrel. Không có nó, một hàm ghi MỚI thêm vào một gói ngày mai sẽ không
// nằm trong danh sách, và lớp thứ nhất im lặng bỏ qua — đúng khuôn *"hàng rào tự làm mù mình bằng
// một danh sách tên"* mà khoản nợ 3 và 16 đã ghi hai lần.
// =============================================================================================

const GOC = fileURLToPath(new URL("../../", import.meta.url));
const THU_MUC_APPS = "apps";

/** Hàm ĐỔI TRẠNG THÁI — mọi lời gọi từ `apps/` phải đi kèm một phép kiểm quyền. */
const HAM_DOI_TRANG_THAI = [
  "addRfqItem",
  "addSupplierContact",
  "approveRfq",
  "approveUnseal",
  "cancelRfq",
  "cancelUnseal",
  "clearOtpLockout",
  "closeRfq",
  "createInvitation",
  "createProcurementPolicy",
  "createRfq",
  "createSupplier",
  "dispatchUnseal",
  "extendRfqDeadline",
  "issueMagicLinkToken",
  "openRfq",
  "requestUnseal",
  "revokeInvitation",
  "setRfqBudget",
  "submitRfqForApproval",
] as const;

/**
 * Hàm ĐỌC — không đổi trạng thái nào, nên một cổng quyền cho chúng là quyết định của tầng ứng
 * dụng chứ không phải một bất biến. `listSuppliers` nằm đây có lý do đã ghi trong ADR-016: nó có
 * đường gọi KHÔNG CÓ NGƯỜI DÙNG NÀO (một job nền chạy dưới `app_api`).
 */
const HAM_CHI_DOC = [
  // [khoản nợ 33] `auditStoredCiphertexts` là một JOB VẬN HÀNH: nó chạy theo lịch, dưới role
  // `app_unseal`, và KHÔNG có người dùng nào để hỏi quyền. Cùng lý do đã ghi cho `listSuppliers`.
  "auditStoredCiphertexts",
  "findSupplierByTaxCode",
  "getActiveProcurementPolicy",
  "getBidReceipt",
  "getRfq",
  "getSupplier",
  "getUnsealRequest",
  "listBidVersions",
  "listRfqItems",
  "listSupplierContacts",
  "listSuppliers",
] as const;

/**
 * Đường KHÁCH — cố ý KHÔNG có cổng quyền, và đó là toàn bộ lý do gói `invitation` tồn tại: ràng
 * buộc sản phẩm 1 nói lần báo giá đầu KHÔNG yêu cầu tài khoản. Ba hàm này tự chứng minh thẩm
 * quyền bằng token và mã OTP — một phép chứng minh MẠNH HƠN một phiên, không phải một ngoại lệ.
 */
const HAM_DUONG_KHACH = [
  "issueOtpChallenge",
  "redeemMagicLink",
  "verifyOtpAndStartSession",
  // [khoản nợ 33] `submitBid` ở đây chứ không ở `HAM_DOI_TRANG_THAI`, và đó là một QUYẾT ĐỊNH:
  // nó ghi thật (một phiên bản báo giá cộng một biên nhận), nhưng người ghi là NHÀ CUNG CẤP, và
  // họ tự chứng minh thẩm quyền bằng phiên khách — thứ đã đi qua token cộng OTP. Một cổng quyền
  // ở đây sẽ đòi một tài khoản người mua, tức phá ràng buộc sản phẩm 1.
  "submitBid",
] as const;

/**
 * [khoản nợ 33] HÀM ĐỌC MÀ VẪN PHẢI CÓ CỔNG QUYỀN — rổ THỨ TƯ, và nó tồn tại vì rổ
 * `HAM_CHI_DOC` biện minh bằng một câu SAI với chúng.
 *
 * Câu biện minh của `HAM_CHI_DOC` là *"không đổi trạng thái nào, nên một cổng quyền cho chúng là
 * quyết định của tầng ứng dụng"*. Câu ấy đúng cho `getSupplier`; nó SAI cho một hàm mà MỤC ĐÍCH
 * DUY NHẤT là kiểm soát TIẾT LỘ. `buildComparisonTable` trả về giá của mọi nhà cung cấp trong
 * một gói thầu; `countReceivedBids` trả về một con số mà A6 gọi thẳng là nhạy cảm.
 *
 * Rổ này KHÔNG phải một nhãn: test bên dưới đọc MÃ NGUỒN của từng hàm và đòi thân nó thật sự gọi
 * `requirePermission`. Một hàm nằm ở đây mà không có cổng là một lần ĐỎ.
 */
const HAM_DOC_CO_QUYEN = ["buildComparisonTable", "countReceivedBids"] as const;

/**
 * [khoản nợ 33] HÀM THUẦN TUÝ — không nhận `client`, không nhận `orgId`, không chạm CSDL.
 *
 * Một cổng quyền cho chúng là một câu không có chủ ngữ. `verifyReceipt` là ca chịu lực: B2 đòi nó
 * kiểm chứng được bằng khoá công khai MỘT MÌNH, nên thêm bất kỳ tham số "chỉ máy chủ mới có" nào
 * vào đây là phá chính bất biến ấy — `barrel-exports.test.ts` canh riêng điều đó.
 */
const HAM_THUAN_TUY = [
  "buildReceiptText",
  "createLocalDevReceiptSigner",
  "derToRawSignature",
  "parseReceiptText",
  "rawToDerSignature",
  "sha256Hex",
  "verifyReceipt",
] as const;

/**
 * [khoản nợ 33] Hàm TỰ NÓ LÀ cổng quyền. `assertUnsealAllowed` là phép hội bốn vế của D1; hỏi
 * "nó có được canh bởi một cổng quyền không" là một câu vòng tròn.
 */
const HAM_TU_LA_CONG = ["assertUnsealAllowed"] as const;

/**
 * [khoản nợ 33] Đọc THÂN của một hàm export từ mã nguồn thật, để rổ `HAM_DOC_CO_QUYEN` là một
 * phép đo chứ không một cái nhãn.
 *
 * Quét MỌI file nguồn dưới `packages` theo tính chất, không theo một danh sách file — nên một hàm
 * chuyển sang module khác vẫn tìm thấy. "Thân" ở đây là đoạn từ chỗ khai báo tới `export` kế
 * tiếp: thô, nhưng đủ, và nó không bao giờ ĐỌC THIẾU (chỉ có thể đọc THỪA sang phần sau, tức
 * lệch về phía KHOAN DUNG — nên một lần ĐỎ luôn là một lần đỏ thật).
 */
function thanHamExport(pTen: string): string | null {
  const cacTep = execFileSync("git", ["ls-files", "packages/*/src/*.ts"], {
    cwd: GOC,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((t) => t.length > 0 && !t.endsWith(".test.ts"));
  for (const t of cacTep) {
    const noiDung = readFileSync(join(GOC, t), "utf8");
    const vt = noiDung.indexOf(`export async function ${pTen}(`);
    if (vt < 0) continue;
    const ke = noiDung.indexOf(`${String.fromCharCode(10)}export `, vt + 1);
    return ke < 0 ? noiDung.slice(vt) : noiDung.slice(vt, ke);
  }
  return null;
}

// [khoản nợ 33] Hai gói MỚI vào danh sách. Trước vòng sửa này, `CUA_GOI` gồm ba gói của S1.1–S1.3
// và KHÔNG có `unseal` lẫn `bidding` — tức toàn bộ phê duyệt kép của việc lộ mọi giá trong một
// RFQ, cộng hai hàm đọc bảng giá, đều nằm ngoài tầm nhìn của cả hai lớp ở file này. Một module
// `apps/api` gọi `approveUnseal` mà quên dòng quyền sẽ đi qua sạch sẽ. Đúng khuôn *"hàng rào tự
// làm mù mình bằng một danh sách tên"* mà khoản nợ 3 và 16 đã ghi — lần thứ ba.
const CUA_GOI = [
  "@trustprocure/supplier",
  "@trustprocure/rfq",
  "@trustprocure/invitation",
  "@trustprocure/unseal",
  "@trustprocure/bidding",
] as const;

// ---------------------------------------------------------------------------------------------
// QUÉT BẰNG `git ls-files`, KHÔNG BẰNG `readdirSync` — VÀ ĐÂY LÀ MỘT BẢN VÁ CỦA MỘT BẢN VÁ
// ---------------------------------------------------------------------------------------------
// Bản đầu quét thư mục thật. Nó ĐỎ khi chạy toàn bộ bộ test, vì `boundaries.test.ts` dựng fixture
// dò ngay trong `apps/`. Bản vá thứ nhất loại trừ theo TÊN (`tmp-probe-*`) — và bản vá ấy SAI:
// nó suy danh sách tên từ những `mkdirSync` mà tôi grep được, bỏ sót `apps/tmp-probe/src` (không
// có gạch nối ở cuối). Máy tôi vẫn xanh vì thời điểm chạy tình cờ không trùng.
//
// **CI bắt được, máy không** — lần thứ hai trong dự án, và cùng một bài học: một hàng rào suy từ
// DANH SÁCH TÊN thì mù đúng ở chỗ danh sách ấy thiếu. Khoản nợ 3 và 16 đã ghi khuôn này hai lần.
//
// Bản này suy từ một TÍNH CHẤT: chỉ những file **được git theo dõi** mới là mã của kho này.
// Fixture dò là file untracked, thoáng qua — bất kể đặt tên gì, nó không bao giờ lọt vào đây.
//
// GIỚI HẠN PHẢI NÓI RA: một route VỪA VIẾT và CHƯA `git add` thì lớp này chưa thấy. Đó là đánh
// đổi có chủ đích — vị từ trở thành "cái gì ĐÃ VÀO KHO thì phải có cổng quyền", và CI, nơi lớp
// này phải cắn, chỉ bao giờ nhìn thấy mã đã commit.
function quetTepTs(thuMucTuongDoi: string): string[] {
  const ra = execFileSync("git", ["ls-files", "--", thuMucTuongDoi], {
    cwd: GOC,
    encoding: "utf8",
  });
  return ra
    .split(/\r?\n/)
    .filter((d) => d.endsWith(".ts") && !d.includes(".test."))
    .map((d) => join(GOC, d));
}
/**
 * Vị từ, tách khỏi I/O để nó ĐO ĐƯỢC bằng một chuỗi giả lập. Không có bước tách này, vế đối chứng
 * dương chỉ chạy được bằng cách viết một file thật vào `apps/` rồi xoá đi — một phép đo để lại
 * rác và không chạy được trên CI ở chế độ chỉ-đọc.
 */
export function timViPham(maNguon: string): readonly string[] {
  const nhacToiQuyen = maNguon.includes("requirePermission");
  if (nhacToiQuyen) return [];
  return HAM_DOI_TRANG_THAI.filter((ten) =>
    new RegExp("\\b" + ten + "\\s*\\(").test(maNguon),
  );
}

describe("[ADR-016] cổng quyền của tầng ứng dụng", () => {
  it("ĐỐI CHỨNG DƯƠNG: vị từ BẮT được một module gọi hàm ghi mà không nhắc tới quyền", () => {
    const gia = [
      'import { createSupplier } from "@trustprocure/supplier";',
      "export async function handler(c, orgId, body) {",
      "  return createSupplier(c, orgId, body);",
      "}",
    ].join("\n");
    // Không có khẳng định này, mọi khẳng định còn lại cũng xanh khi vị từ luôn trả về mảng rỗng —
    // và một lớp canh luôn trả rỗng là một lớp canh KHÔNG TỒN TẠI.
    expect(timViPham(gia)).toEqual(["createSupplier"]);
  });

  it("ĐỐI CHỨNG ÂM: cùng module ấy ĐI QUA khi có `requirePermission`", () => {
    const dung = [
      'import { requirePermission, PERMISSIONS } from "@trustprocure/identity";',
      'import { createSupplier } from "@trustprocure/supplier";',
      "export async function handler(c, orgId, body, auditPool) {",
      "  await requirePermission(c, { ...body.check, permission: PERMISSIONS.SUPPLIER_MANAGE,",
      '    resourceType: "SUPPLIER" }, auditPool);',
      "  return createSupplier(c, orgId, body);",
      "}",
    ].join("\n");
    expect(timViPham(dung)).toEqual([]);
  });

  it("không module nào trong `apps/` gọi hàm đổi trạng thái mà thiếu phép kiểm quyền", () => {
    const cacTep = quetTepTs(THU_MUC_APPS);
    const viPham = cacTep
      .map((tep) => ({ tep, ham: timViPham(readFileSync(tep, "utf8")) }))
      .filter((x) => x.ham.length > 0)
      .map((x) => `${x.tep.slice(GOC.length)}: ${x.ham.join(", ")}`);

    expect(
      viPham,
      "Một module trong apps/ gọi hàm ĐỔI TRẠNG THÁI mà không có một dòng nào về quyền. " +
        "ADR-016 mục 1 đặt cổng quyền ở TẦNG NÀY — nếu nó không ở đây thì nó không ở đâu cả.",
    ).toEqual([]);
  });

  it("BỘ QUÉT CÓ RĂNG: cùng hàm ấy TÌM THẤY file khi thư mục THẬT SỰ có mã đã vào kho", () => {
    // Không có khẳng định này, một bộ quét hỏng (git không có trên PATH, sai `cwd`, đổi cờ)
    // trả về mảng rỗng và MỌI khẳng định phía trên xanh — một lớp canh RỖNG RUỘT trông y hệt
    // một lớp canh sạch. `packages/` là thư mục đối chứng vì nó chắc chắn có mã đã commit.
    expect(quetTepTs("packages").length).toBeGreaterThan(10);
  });

  // ============================================================================================
  // *** KHẲNG ĐỊNH CŨ ĐÃ ĐỎ ĐÚNG NGÀY NÓ ĐƯỢC HẸN. GIỮ NGUYÊN VĂN ĐỂ ĐỐI CHIẾU. ***
  //
  //   it("PHÁT BIỂU ĐÚNG MỨC: hôm nay `apps/` chưa có module `.ts` nào, nên khẳng định trên là
  //       RỖNG RUỘT", () => { expect(quetTepTs(THU_MUC_APPS)).toEqual([]); });
  //
  // Nguyên văn lý do khi ấy: *"Khi `apps/` có module đầu tiên, khẳng định này ĐỎ và phải bị xoá —
  // đó là dấu hiệu lớp trên bắt đầu có nghĩa, không phải một lỗi."*
  //
  // [S1.6] `apps/unseal-worker` ra đời, và khẳng định ấy đỏ ở đúng lượt chạy đầu tiên sau đó.
  // ============================================================================================
  it("PHÁT BIỂU ĐÚNG MỨC: `apps/` NAY CÓ MÃ, và lớp trên vừa quét nó thật", () => {
    const cacTep = quetTepTs(THU_MUC_APPS);
    expect(cacTep.length, "apps/ phải có ít nhất một module .ts đã vào kho").toBeGreaterThan(0);

    // ... NHƯNG phát biểu đúng mức vẫn phải nói ra phần chênh, và nó KHÔNG nhỏ: thứ vừa ra đời là
    // một WORKER, không phải một ROUTE. Nó không nhận request HTTP, không có người dùng cuối, và
    // nó chạy dưới `app_unseal` — một role cố ý không đọc được `users` hay ma trận quyền, nên một
    // câu `requirePermission` ở đó là câu KHÔNG VIẾT ĐƯỢC.
    //
    // Tức lớp này nay quét mã THẬT, và mã thật ấy đúng là không được phép mang cổng quyền. Vế
    // *"cổng quyền ở tầng ứng dụng"* của ADR-016 mục 1 vẫn CHƯA có một route nào để canh; nó chỉ
    // thôi rỗng ruột về mặt PHẠM VI QUÉT. Ngày `apps/api` ra đời mới là ngày nó có nghĩa trọn vẹn.
    const coRoute = cacTep.some((t) => !t.includes("unseal-worker"));
    expect(
      coRoute,
      "Nếu câu này đỏ thì `apps/` đã có một app KHÁC ngoài worker — hãy đọc lại khối chú thích " +
        "trên và viết lại phần chênh cho đúng thứ vừa ra đời.",
    ).toBe(false);
  });
});

describe("[ADR-016] danh sách hàm ghi không được tự làm mù mình", () => {
  it("mọi hàm export của ba gói nghiệp vụ đều được PHÂN LOẠI — thêm một hàm mới buộc phải quyết", async () => {
    const daPhanLoai = new Set<string>([
      ...HAM_DOI_TRANG_THAI,
      ...HAM_CHI_DOC,
      ...HAM_DUONG_KHACH,
      ...HAM_DOC_CO_QUYEN,
      ...HAM_THUAN_TUY,
      ...HAM_TU_LA_CONG,
    ]);

    const chuaPhanLoai: string[] = [];
    for (const cua of CUA_GOI) {
      const mod = (await import(/* @vite-ignore */ cua)) as Record<string, unknown>;
      for (const [ten, giaTri] of Object.entries(mod)) {
        if (typeof giaTri !== "function") continue;
        // Lớp lỗi (`SupplierError`, `PepperRing`, …) là `function` trong JavaScript nhưng không
        // phải một thao tác. Phân biệt bằng chữ hoa đầu — quy ước đặt tên của chính dự án.
        if (/^[A-Z]/.test(ten)) continue;
        if (!daPhanLoai.has(ten)) chuaPhanLoai.push(`${cua}: ${ten}`);
      }
    }

    expect(
      chuaPhanLoai,
      "Một hàm export MỚI chưa được phân loại. Nó ghi hay chỉ đọc? Nếu ghi, thêm vào " +
        "HAM_DOI_TRANG_THAI — nếu không, lớp canh ở trên sẽ im lặng bỏ qua mọi route gọi nó. " +
        "Đây đúng khuôn 'hàng rào tự làm mù mình bằng một danh sách tên' (khoản nợ 3 và 16).",
    ).toEqual([]);
  });

  it("sáu nhóm không giao nhau — một hàm không thể vừa ghi vừa chỉ đọc", () => {
    const tatCa = [
      ...HAM_DOI_TRANG_THAI,
      ...HAM_CHI_DOC,
      ...HAM_DUONG_KHACH,
      ...HAM_DOC_CO_QUYEN,
      ...HAM_THUAN_TUY,
      ...HAM_TU_LA_CONG,
    ];
    expect(new Set(tatCa).size).toBe(tatCa.length);
  });

  it("[khoản nợ 33] rổ `HAM_DOC_CO_QUYEN` KHÔNG phải một nhãn — mỗi hàm phải THẬT SỰ có cổng", () => {
    // Không có phép đo này, rổ mới chỉ là một chỗ để cất tên cho qua lớp phân loại — đúng thứ
    // rủi ro số 3 của kế hoạch S1 gọi là *"lấp mã bằng nhãn thay vì bằng lớp"*.
    const thieu: string[] = [];
    for (const ten of HAM_DOC_CO_QUYEN) {
      const than = thanHamExport(ten);
      if (than === null) {
        thieu.push(`${ten}: không tìm thấy định nghĩa`);
      } else if (!than.includes("requirePermission")) {
        thieu.push(`${ten}: thân hàm không gọi requirePermission`);
      }
    }
    expect(
      thieu,
      "Một hàm ở rổ HAM_DOC_CO_QUYEN không thật sự kiểm quyền. Rổ ấy tồn tại vì câu biện minh " +
        "của HAM_CHI_DOC ('không đổi trạng thái') SAI với một hàm mà mục đích duy nhất là kiểm " +
        "soát tiết lộ — nên nó phải mang một cổng, không mang một cái tên.",
    ).toEqual([]);

    // Chống rỗng ruột: phép đọc mã nguồn phải BIẾT trả về `null` cho một tên không tồn tại, và
    // biết thấy một thân hàm KHÔNG có cổng.
    expect(thanHamExport("khongCoHamTenNay")).toBeNull();
    expect(thanHamExport("getUnsealRequest")?.includes("requirePermission")).toBe(false);
  });
});

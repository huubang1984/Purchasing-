import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { MFA_MAX_FAILED_ATTEMPTS } from "@trustprocure/identity";
import { ROUTES } from "../../apps/api/src/routes.js";

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
  // [S1.110 / S2.6] SÁU hàm ghi của `@trustprocure/danh-gia`, vào cùng lúc gói ấy vào
  // `CUA_GOI`. Cả sáu đổi `rfq_packages.status`, và ba hàm trao thầu còn ghi vào hai bảng
  // CHỈ-GHI-THÊM mà không vai nào `UPDATE` được — tức một lần ghi sai không sửa lại được.
  "deXuatTraoThau",
  "dongVongBafo",
  "duyetTraoThau",
  "huyTraoThau",
  "moVongBafo",
  "taoLuotDanhGia",
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
  // [S1.110] `docVongBafo` KHÔNG mang cổng, và `packages/danh-gia/src/vong-bafo.ts` đã ghi vì
  // sao ở chỗ người đọc sẽ tìm: hàng nó trả không mang một mức giá nào, và `topN` thì một
  // người mua đã đọc được qua `GET /policy`. Một cổng `bid.view` ở đó canh một thứ không phải
  // bí mật, rồi làm người đọc tưởng nó là. Vế *ai gọi được* đóng ở route (`agent: false`).
  "docVongBafo",
  // [mảnh 1] `dungBoBangChung` KHÔNG mang cổng vì người gọi DUY NHẤT của nó ngoài gói là
  // `pnpm bang-chung xuat` — công cụ vận hành giữ `DATABASE_URL`, đứng ngoài mọi cổng ứng dụng,
  // cùng lập luận của `listSuppliers`. Đường của một CON NGƯỜI là `xuatBoBangChung` (rổ
  // `HAM_DOC_CO_QUYEN`), và test cuối tệp này đòi `apps/` không gọi thẳng hàm này.
  "dungBoBangChung",
  "findSupplierByTaxCode",
  "getActiveProcurementPolicy",
  "getBidReceipt",
  // [S1.90 / khoản 190] cùng hạng với `getUnsealRequest`: nó trả TRẠNG THÁI của một yêu cầu mở
  // thầu, không trả một mức giá nào. Cái nó mở rộng là khả năng TÌM, và vế ấy được đóng ở route
  // (`agent: false`), không ở đây — rổ này nói về cổng quyền, không nói về đối tượng gọi.
  "getOpenUnsealForRfq",
  "getRfq",
  "getSupplier",
  "getUnsealRequest",
  // [S1.91 / khoản 154] Kênh + địa chỉ của một lời mời còn sống. Người gọi DUY NHẤT là handler
  // outbox của `apps/api`, chạy ngoài mọi phiên người dùng — không có ai để hỏi quyền, cùng
  // lập luận đã ghi cho `listSuppliers` và `auditStoredCiphertexts`.
  "getInvitationNoticeTarget",
  "listBidVersions",
  "listRfqItems",
  "listSupplierContacts",
  "listSuppliers",
  // [S1.91 / khoản 194] Trả danh sách NGƯỜI NHẬN của một tin báo, không trả lời một câu hỏi
  // quyền nào. Người gọi là `requestUnseal`, đã qua cổng `RFQ_UNSEAL` của chính nó trước đó.
  "listUserIdsWithPermission",
] as const;

/**
 * Đường KHÁCH — cố ý KHÔNG có cổng quyền, và đó là toàn bộ lý do gói `invitation` tồn tại: ràng
 * buộc sản phẩm 1 nói lần báo giá đầu KHÔNG yêu cầu tài khoản. Ba hàm này tự chứng minh thẩm
 * quyền bằng token và mã OTP — một phép chứng minh MẠNH HƠN một phiên, không phải một ngoại lệ.
 */
const HAM_DUONG_KHACH = [
  // [S1.110 / S2.6] `docVongBafoKhach` — hàm DUY NHẤT của `@trustprocure/danh-gia` mà một
  // phiên KHÁCH chạm tới, và nó trả đúng HAI trường (`roundNo`, `deadlineAt`). Không cổng
  // quyền vì không có tài khoản người mua nào ở đầu dây; hai lớp canh nó là policy
  // `rfq_bafo_rounds_khach` (`060`, canh HÀNG nào ra khỏi CSDL) và kiểu trả về (canh TRƯỜNG
  // nào ra khỏi tiến trình). `topN` và `openedBy` không đi ra đường khách bằng lối nào.
  "docVongBafoKhach",
  "issueOtpChallenge",
  "redeemMagicLink",
  // [ADR-020 / S1.10.2] cookie khách → phiên khách: tự chứng minh bằng token, không có mã quyền.
  "resolveGuestSessionByToken",
  "verifyOtpAndStartSession",
  // [khoản nợ 33] `submitBid` ở đây chứ không ở `HAM_DOI_TRANG_THAI`, và đó là một QUYẾT ĐỊNH:
  // nó ghi thật (một phiên bản báo giá cộng một biên nhận), nhưng người ghi là NHÀ CUNG CẤP, và
  // họ tự chứng minh thẩm quyền bằng phiên khách — thứ đã đi qua token cộng OTP. Một cổng quyền
  // ở đây sẽ đòi một tài khoản người mua, tức phá ràng buộc sản phẩm 1.
  "submitBid",
  // [sổ nợ 39] `tangBucketHanMuc` GHI (một hàng đếm trong `otp_rate_limits`) nhưng người gọi là chính
  // DISPATCHER, TRƯỚC khi có bất kỳ danh tính nào — nó đếm kẻ gõ vào cửa đăng nhập, và một cổng
  // quyền ở đó là hỏi thẻ của người chưa vào. Cùng lý do với `issueOtpChallenge` ở đầu danh sách.
  "tangBucketHanMuc",
  // [sổ nợ 55] Cùng lý do, cùng người gọi: `tangBucketNguoiGoi` đếm ở bảng TOÀN CỤC (042) nên nó
  // còn ít quyền hơn — không `org_id` để nhầm, không hàng nào của một tổ chức để chạm.
  "tangBucketNguoiGoi",
  // [sổ nợ 55] `donBucketNguoiGoiCu` XOÁ, nhưng nó là việc NỀN của tiến trình, không có người gọi
  // nào để hỏi thẻ; thứ nó xoá là bộ đếm hết hạn, không phải dữ liệu của ai.
  "donBucketNguoiGoiCu",
  // [sổ nợ 57] `donOtpRateLimitsCu` cùng lý do, và cửa của nó HẸP HƠN cả hai hàm trên: nó chạy trên
  // kết nối CHƯA gắn tổ chức (tự kiểm và ném nếu không), và policy `FOR DELETE` của `044` chỉ duyệt
  // hàng đã quá 30 phút. Một cổng quyền ở đây là hỏi thẻ của một `setInterval`.
  "donOtpRateLimitsCu",
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
const HAM_DOC_CO_QUYEN = [
  "buildComparisonTable",
  "countReceivedBids",
  // [S1.106 / S2.4] Đọc một bảng xếp hạng là một lần TIẾT LỘ GIÁ, nên nó chịu đúng cổng
  // `bid.view` mà bảng so sánh chịu — không phải `evaluation.perform`.
  "docBangXepHang",
  // [S1.110 / S2.6] Award không mang một con SỐ nào, nhưng nó mang **ai thắng** — kết luận
  // của mọi thứ ADR-038 rút khỏi bề mặt MCP. Nên nó chịu đúng cổng `bid.view` mà bảng xếp
  // hạng chịu, và lời gọi đứng THẲNG trong thân `docTraoThau` (khoản 33).
  "docTraoThau",
  "listInvitations",
  // [mảnh 1 / màn xuất bằng chứng] Bộ bằng chứng mang MỌI hàng của MỌI lượt chấm — rộng hơn cả
  // bảng xếp hạng. Hai cổng `audit.read` + `bid.view` đứng THẲNG trong thân `xuatBoBangChung`.
  "xuatBoBangChung",
] as const;

/**
 * [khoản nợ 33] HÀM THUẦN TUÝ — không nhận `client`, không nhận `orgId`, không chạm CSDL.
 *
 * Một cổng quyền cho chúng là một câu không có chủ ngữ. `verifyReceipt` là ca chịu lực: B2 đòi nó
 * kiểm chứng được bằng khoá công khai MỘT MÌNH, nên thêm bất kỳ tham số "chỉ máy chủ mới có" nào
 * vào đây là phá chính bất biến ấy — `barrel-exports.test.ts` canh riêng điều đó.
 */
const HAM_THUAN_TUY = [
  "buildReceiptText",
  // [S1.110] Năm hàm thuần của `@trustprocure/danh-gia`: không `client`, không `orgId`, không
  // chạm CSDL. `tinhChiPhiHieuDung` là hàm mà **J2** đòi tái lập được, nên một tham số
  // "chỉ máy chủ mới có" thêm vào nó phá đúng bất biến ấy — cùng ca `verifyReceipt`.
  "docSo",
  "laTuChoi",
  "lamTron",
  "tinhChiPhiHieuDung",
  "vietSo",
  // [ADR-011] Bộ ký aws-kms và phép đọc khoá công khai: không `client` CSDL, không `orgId` —
  // dựng ở composition root, như bản local-dev ngay dưới.
  "createAwsKmsReceiptSigner",
  "layKhoaCongKhaiBienNhanKms",
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
  const cacTep = execFileSync("git", ["ls-files", "--deduplicate", "packages/*/src/*.ts"], {
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
//
// [S1.110 / S2.6] LẦN THỨ TƯ, và lần này danh sách bỏ sót gói chứa MỌI đường ghi của S2.
// Đo: `CUA_GOI` có NĂM cửa và KHÔNG có `@trustprocure/danh-gia`, nên phép kiểm *"mọi hàm
// export đều được PHÂN LOẠI"* không đọc gói ấy một dòng nào — trong khi `taoLuotDanhGia`
// (S1.105), `moVongBafo` + `dongVongBafo` (S1.109) và `deXuatTraoThau` + `duyetTraoThau` +
// `huyTraoThau` (S1.110) đều là hàm ĐỔI TRẠNG THÁI. Hậu quả đọc được từ chính vị từ
// `timViPham`: một module gọi chúng mà KHÔNG nhắc `requirePermission` đi qua sạch sẽ, vì tên
// chúng không nằm trong `HAM_DOI_TRANG_THAI`. Tức lớp canh này đã mù với sáu hàm ghi suốt
// từ S1.105 — và `docBangXepHang` thì có mặt ở `HAM_DOC_CO_QUYEN`, nên nó nhận phép kiểm
// "có cổng THẬT" mà KHÔNG nhận phép kiểm phân loại: một nửa lớp canh, đúng thứ khó thấy
// nhất. Mười lăm hàm của gói được phân loại ở vòng này, trải năm rổ.
const CUA_GOI = [
  "@trustprocure/supplier",
  "@trustprocure/rfq",
  "@trustprocure/invitation",
  "@trustprocure/unseal",
  "@trustprocure/bidding",
  "@trustprocure/danh-gia",
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
  const ra = execFileSync("git", ["ls-files", "--deduplicate", "--", thuMucTuongDoi], {
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
      'import { MFA_MAX_FAILED_ATTEMPTS, PERMISSIONS, requirePermission } from "@trustprocure/identity";',
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
    // [ADR-020 / S1.10.2] `apps/api/src/routes/**` ĐƯỢC LOẠI KHỎI vị từ này, và đó là một sự THAY
    // THẾ chứ không phải một miễn trừ: handler ở đó CỐ Ý không nhắc tới `requirePermission` —
    // cổng chạy ở dispatch.ts TRƯỚC handler, và một cổng thứ hai trong handler là hai nơi để
    // lệch nhau. Lớp canh cho thư mục ấy mạnh hơn lớp này: nó đọc CẤU TRÚC `ROUTES` (một route
    // ghi thiếu `permission` không biên dịch, và không qua `timViPhamBangRoute`), và nó đo trên
    // tiến trình HTTP thật (403 + bản ghi PERMISSION_DENIED). Xem apps/api/src/routes.test.ts
    // [INV-H17] và apps/api/src/api.int.test.ts.
    const cacTep = quetTepTs(THU_MUC_APPS).filter((t) => !t.includes(`${sep}api${sep}src${sep}routes${sep}`));
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
  // ============================================================================================
  // *** KHẲNG ĐỊNH THỨ HAI CŨNG ĐÃ ĐỎ ĐÚNG NGÀY NÓ ĐƯỢC HẸN. GIỮ NGUYÊN VĂN ĐỂ ĐỐI CHIẾU. ***
  //
  //   const coRoute = cacTep.some((t) => !t.includes("unseal-worker"));
  //   expect(coRoute, "Nếu câu này đỏ thì `apps/` đã có một app KHÁC ngoài worker — hãy đọc lại
  //       khối chú thích trên và viết lại phần chênh cho đúng thứ vừa ra đời.").toBe(false);
  //
  // [khoản nợ 30] `apps/public-keys` ra đời ở commit 623458b, và khẳng định ấy đỏ ở lượt CI đầu
  // tiên sau đó (run 33978573210, cả ubuntu lẫn windows) — commit ấy không chạy lại tầng T1
  // trước khi đẩy, nên chính CI là nơi mốc chết này nổ. Đúng việc nó sinh ra để làm.
  // ============================================================================================
  // ============================================================================================
  // *** MỐC CHẾT THỨ BA ĐÃ NỔ ĐÚNG NGÀY NÓ ĐƯỢC HẸN — apps/api ra đời (S1.10.2). ***
  //
  // Nguyên văn khẳng định trước: `const APP_DA_BIET = ["unseal-worker", "public-keys"]` cộng
  // thông điệp *"Nếu thứ vừa ra đời là `apps/api`, đây là ngày ADR-016 mục 4 hẹn: route đầu tiên
  // phải ra đời CÙNG LÚC với cổng quyền của nó."* Đúng thế: route đầu tiên (`POST /suppliers`)
  // và cổng của nó (`dispatch.ts` + `routes.test.ts` [INV-H17]) vào kho trong CÙNG một commit.
  // ============================================================================================
  // ============================================================================================
  // *** MỐC CHẾT THỨ TƯ ĐÃ NỔ ĐÚNG NGÀY NÓ ĐƯỢC HẸN — apps/mcp ra đời (ADR-038). ***
  //
  // Nguyên văn khẳng định trước: `const APP_DA_BIET = ["unseal-worker", "public-keys", "api"]` cộng
  // tiêu đề *"`apps/` NAY CÓ BA APP, và app thứ ba là nơi cổng quyền CÓ NGHĨA"*. Nó đỏ ở lượt chạy
  // đầu tiên sau khi `apps/mcp` được `git add` — và CHỈ khi ấy: `quetTepTs` đọc `git ls-files`, nên
  // một app chưa vào kho là một app cổng này không nhìn thấy. Lượt chạy trước lúc stage XANH, và
  // cái xanh ấy không nói gì cả.
  // ============================================================================================
  it("PHÁT BIỂU ĐÚNG MỨC: `apps/` NAY CÓ NĂM APP, và app thứ năm KHÔNG CÓ ROUTE NÀO CỦA RIÊNG NÓ", () => {
    const cacTep = quetTepTs(THU_MUC_APPS);
    expect(cacTep.length, "apps/ phải có ít nhất một module .ts đã vào kho").toBeGreaterThan(0);

    // Phần chênh, viết lại cho đúng thứ đang có — và nó VẪN không nhỏ:
    //
    //   ⑴ `apps/unseal-worker` là một WORKER: không nhận request HTTP, không có người dùng cuối,
    //      chạy dưới `app_unseal` — role cố ý không đọc được ma trận quyền, nên `requirePermission`
    //      ở đó là câu KHÔNG VIẾT ĐƯỢC.
    //   ⑵ `apps/public-keys` là app HTTP ĐẦU TIÊN của kho, nhưng nó CHỈ ĐỌC và KHÔNG XÁC THỰC:
    //      nó phục vụ khoá CÔNG KHAI, không chạm CSDL, không gọi một hàm đổi trạng thái nào, và
    //      không có người dùng nào để hỏi quyền. Một cổng quyền ở đó là một cổng canh cửa vào
    //      một căn phòng trống.
    //
    //   ⑶ [ADR-038] `apps/mcp` là app đầu tiên mang một BỀ MẶT AGENT, và nó KHÔNG chạm CSDL: nó
    //      nói HTTP với `apps/api` dưới một phiên người mua đã có. Một `requirePermission` viết
    //      TRONG `apps/mcp` sẽ là bản sao thứ hai của ma trận quyền, đặt ở một tiến trình không
    //      đọc được ma trận ấy: một cổng sẽ trôi, không phải một lớp thêm. Thứ `apps/mcp` tự canh
    //      không phải QUYỀN mà là PHẠM VI — chỉ route đọc, và ba đường ở `ROUTE_DOC_KHONG_PHOI`
    //      (`apps/mcp/src/cong-cu.test.ts`).
    //
    //      ~~Cổng quyền của nó LÀ cổng quyền của `apps/api` — mọi công cụ đi qua `dispatch.ts`,
    //      `requirePermission`, RLS và sổ kiểm toán, ghi đúng người dùng của phiên ấy.~~
    //      **[lượt soi 69 M-3] CÂU VỪA GẠCH RỘNG HƠN PHÉP ĐO, và nó là câu đang BIỆN MINH cho việc
    //      `apps/mcp` không mang lớp quyền nào — đúng khuôn "lấp mã bằng nhãn thay vì bằng lớp"
    //      mà chính tệp này cảnh báo ở khối trên.** ~~`dispatch.ts:504`~~ [S1.79] `dispatch.ts:592` là
    //      `if (route.mutates && route.self !== true)`: route ĐỌC KHÔNG BAO GIỜ gọi
    //      `requirePermission`. Phát biểu đúng mức: tám công cụ của MCP đi qua phiên + RLS theo tổ
    //      chức, và **không công cụ nào để lại một dòng nào trong `audit_events`** — hai đường đọc
    //      DUY NHẤT có cổng quyền thật (`buildComparisonTable`, `countReceivedBids` — rổ
    //      `HAM_DOC_CO_QUYEN` ở đầu tệp này, và khối *"Hai đường ĐỌC CÓ CỔNG (khoản nợ 33)"* trong
    //      `apps/api/src/routes/buyer.ts` — ~~`:206`~~ [S1.79] số dòng ấy nay là `GET /rfqs/:rfqId/items`,
    //      một route ĐỌC KHÔNG có cổng, tức con trỏ cũ minh hoạ NGƯỢC câu nó đứng cạnh) đều nằm trong
    //      `ROUTE_DOC_KHONG_PHOI`, tức MCP cố ý không phơi. Khoảng trống pháp y ấy là khoản nợ 142.
    //
    // Tức lớp này quét mã THẬT của hai app, và cả hai đúng là không được phép mang cổng quyền. Vế
    // *"cổng quyền ở tầng ứng dụng"* của ADR-016 mục 1 vẫn CHƯA có một route nào để canh. Ngày
    // `apps/api` ra đời — route đầu tiên nhận một phiên NGƯỜI DÙNG và gọi một hàm ghi — mới là
    // ngày nó có nghĩa trọn vẹn, và ngày ấy khẳng định dưới đây phải đỏ rồi được viết lại lần nữa.
    //   ⑷ [ADR-044] `apps/web` là app THỨ NĂM và nó KHÔNG CÓ MỘT ROUTE NÀO CỦA RIÊNG NÓ: nó phục
    //      vụ vài tệp tĩnh đã biết trước tên, và chuyển tiếp `/api/*` sang `apps/api` NGUYÊN VĂN —
    //      cùng phương thức, cùng đường dẫn, cùng thân, cùng cookie. Không có một handler nghiệp
    //      vụ nào, không chạm CSDL, `dependencies` rỗng. Một `requirePermission` ở đó sẽ là bản
    //      sao thứ hai của ma trận quyền đặt ở một tiến trình không đọc được ma trận ấy — đúng
    //      cái bẫy mà ⑶ vừa mô tả cho `apps/mcp`. Thứ nó tự canh là BỀ MẶT TỆP (một bản đồ đóng,
    //      đọc xong lúc khởi động) và DANH SÁCH TRẮNG header hai chiều, cả hai đo ở
    //      `apps/web/src/phuc-vu.test.ts`.
    //
    //      **Phần chênh, nói thẳng:** bộ chuyển tiếp THẤY cookie phiên khi nó đi qua. Nó không
    //      lưu, không ghi log, không đọc — nhưng ADR-044 ghi rằng app này KHÔNG được đứng trước
    //      một cụm sản xuất, và đó là một ràng buộc VẬN HÀNH, không phải một lớp mã.
    const APP_DA_BIET = ["unseal-worker", "public-keys", "api", "mcp", "web"] as const;
    const tepNgoaiDanhSach = cacTep.filter(
      (t) => !APP_DA_BIET.some((app) => t.includes(`${THU_MUC_APPS}${sep}${app}${sep}`)),
    );
    expect(
      tepNgoaiDanhSach,
      "Nếu câu này đỏ thì `apps/` đã có một app THỨ NĂM — hãy đọc lại khối chú thích trên và viết " +
        "lại phần chênh cho đúng thứ vừa ra đời, và quyết định nó có route hay không.",
    ).toEqual([]);

    // Đối chứng cho vế ⑵ và vế ⑶, để "hai app này không mang cổng quyền" là một PHÉP ĐO chứ không
    // phải một câu trong chú thích: mã nguồn của chúng không gọi một hàm đổi trạng thái nào — tức
    // chúng rơi vào ca "không có gì để canh", không phải ca "có thứ để canh mà không canh".
    // [ADR-038] `mcp` vào vòng này cùng ngày nó ra đời: một công cụ MCP gọi thẳng một hàm nghiệp
    // vụ là đúng thứ vế ⑶ nói rằng nó KHÔNG làm.
    for (const app of ["public-keys", "mcp"] as const) {
      const tepCuaApp = cacTep.filter((t) => t.includes(`${sep}${app}${sep}`));
      expect(tepCuaApp.length, `apps/${app} phải có mã đã vào kho`).toBeGreaterThan(0);
      for (const tep of tepCuaApp) {
        const ma = readFileSync(tep, "utf8");
        const hamGhiDuocGoi = HAM_DOI_TRANG_THAI.filter((ten) =>
          new RegExp("\\b" + ten + "\\s*\\(").test(ma),
        );
        expect(
          hamGhiDuocGoi,
          `${tep.slice(GOC.length)} gọi hàm đổi trạng thái — app "chỉ đọc" không còn chỉ đọc nữa, ` +
            "và phần chênh ở trên đã sai.",
        ).toEqual([]);
      }
    }
  });
});

describe("[ADR-016] danh sách hàm ghi không được tự làm mù mình", () => {
  it("mọi hàm export của ~~ba~~ [S1.110] SÁU gói nghiệp vụ đều được PHÂN LOẠI — thêm một hàm mới buộc phải quyết", async () => {
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

// =================================================================================================
// [S1.76 / khoản 139 × khoản 141 — LƯỢT RÀ GIAO ĐIỂM] MỘT ĐƯỜNG HTTP THỬ MÃ TOTP PHẢI MANG HAI THỨ.
//
// Vòng khoản 139 đổi `verifyTotpForLogin` thành *"ghi `MFA_LOCKED`, TRỪ khi khoá ghi sổ của tổ chức
// bị giữ ⇒ trả về `auditSkipped`"*, và cưỡng chế điều kiện của chủ dự án (*"cái thiếu phải để lại
// dấu"*) bằng MỘT dòng log ở `/auth/totp` — đường duy nhất lúc ấy. Vòng khoản 141 thêm đường thứ
// hai qua CÙNG hàm ấy. Hai nhánh gộp SẠCH: không xung đột, `tsc` im (trường là tuỳ chọn), không
// cổng nào đỏ — và đường mới im lặng. Vòng khoản 141 cũng đo được rằng đường mới không có trần nào,
// nên năm request khoá được hồ sơ của chủ nhân cookie.
//
// Cổng này biến hai bài học ấy thành một lớp: mỗi lời gọi `verifyTotpForLogin` trong bảng route
// phải đi kèm MỘT chỗ đọc `auditSkipped` và MỘT lời khai trần.
//
// PHÁT BIỂU ĐÚNG MỨC — đây là phép đếm theo TỆP, không phải phép đọc theo hàm bao. Nó bắt ca thật
// (chép một handler và bỏ quên khối log hay dòng trần), và nó MÙ với ca hai lời gọi cùng nằm trong
// một handler đã có đủ hai thứ. Phép đọc chặt hơn cần cây cú pháp; hàng này chưa cần tới đó vì bảng
// route là dữ liệu phẳng, mỗi route một object.
// =================================================================================================
describe("[S1.76] đường HTTP nào thử mã TOTP cũng phải đọc `auditSkipped` và khai một trần", () => {
  const tepRoute = quetTepTs("apps/api/src/routes");

  it("mỗi lời gọi `verifyTotpForLogin` có một chỗ đọc `auditSkipped` trong cùng tệp", () => {
    const thieu: string[] = [];
    for (const t of tepRoute) {
      const ma = readFileSync(t, "utf8");
      const soGoi = (ma.match(/verifyTotpForLogin\s*\(/gu) ?? []).length;
      if (soGoi === 0) continue;
      const soDoc = (ma.match(/auditSkipped/gu) ?? []).length;
      if (soDoc < soGoi) thieu.push(`${relative(GOC, t)}: ${String(soGoi)} lời gọi, ${String(soDoc)} chỗ đọc`);
    }
    expect(thieu, "một đường thử TOTP không đọc `auditSkipped` là một lần mất dòng sổ trong im lặng").toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: phép đếm ấy thấy được ít nhất một tệp — nó không xanh vì không tìm thấy gì", () => {
    const coGoi = tepRoute.filter((t) => /verifyTotpForLogin\s*\(/u.test(readFileSync(t, "utf8")));
    expect(coGoi.length, "không tệp route nào gọi `verifyTotpForLogin` — phép đếm rỗng ruột").toBeGreaterThan(0);
  });

  // Vế này đọc qua `unknown` CÓ CHỦ Ý: viết thẳng `!("mfaTranDuongPhu" in r)` thì TypeScript thu hẹp
  // kết quả thành `never` và báo lỗi biên dịch — tức lớp KIỂU đã cưỡng chế điều này rồi, và đó là
  // lớp mạnh hơn. Vế runtime ở lại cho ca một bảng route dựng bằng ép kiểu (`as unknown as Route`,
  // hình dạng mà chính `auth.int.test.ts` dùng để đo) đi vào `ROUTES` thật.
  it("mỗi route tự thân khai `mfaTranDuongPhu` — kể cả khi câu trả lời là `null`", () => {
    const khongKhai = ROUTES.filter((r) => r.audience === "BUYER" && r.mutates && r.self === true)
      .map((r) => ({ ten: `${r.method} ${r.path}`, gt: (r as { mfaTranDuongPhu?: unknown }).mfaTranDuongPhu }))
      .filter((x) => x.gt === undefined);
    expect(khongKhai.map((x) => x.ten), "route tự thân phải tự khai ngưỡng trạng thái").toEqual([]);
  });

  // [S1.78 / lượt soi ngang 72] VÀ NGƯỠNG ẤY PHẢI CÓ NGHĨA. Một trần bằng hay lớn hơn
  // `MFA_MAX_FAILED_ATTEMPTS` không chặn được gì — hồ sơ khoá trước khi trần chạm. Vế trên chỉ đòi
  // route TỰ KHAI; vế này đòi câu trả lời đúng. Bản S1.76 khai 3 và 3 < 5, nên vế này KHÔNG bắt
  // được lỗi của nó — nó canh một chiều hỏng khác, và nói ra để không ai đọc nó rộng hơn.
  it("ngưỡng trạng thái đã khai phải nhỏ hơn `MFA_MAX_FAILED_ATTEMPTS`", () => {
    const vuot = ROUTES.filter((r) => r.audience === "BUYER" && r.mutates && r.self === true)
      .map((r) => ({ ten: `${r.method} ${r.path}`, gt: (r as { mfaTranDuongPhu?: unknown }).mfaTranDuongPhu }))
      .filter((x) => typeof x.gt === "number" && x.gt >= MFA_MAX_FAILED_ATTEMPTS);
    expect(vuot.map((x) => x.ten), "ngưỡng ≥ ngưỡng khoá là một trần không bao giờ chạm").toEqual([]);
  });
});

// =================================================================================================
// [mảnh 1 / màn xuất bằng chứng] `dungBoBangChung` KHÔNG CÓ CỔNG, NÊN `apps/` KHÔNG ĐƯỢC GỌI NÓ.
//
// Nó nằm ở rổ `HAM_CHI_DOC` vì người gọi duy nhất ngoài gói là công cụ vận hành. Rổ ấy không canh
// AI gọi — nên một route viết `dungBoBangChung(…)` thay cho `xuatBoBangChung(…)` sẽ trả MỌI giá của
// MỌI lượt chấm cho bất kỳ phiên người mua nào, và không lớp nào ở trên kêu. Vế này đóng đúng đường ấy.
// =================================================================================================
describe("[mảnh 1] `apps/` không gọi thẳng `dungBoBangChung`", () => {
  it("không tệp nào dưới `apps/` nhắc tới `dungBoBangChung`", () => {
    const vi = quetTepTs(THU_MUC_APPS).filter((t) => /\bdungBoBangChung\b/u.test(readFileSync(t, "utf8")));
    expect(vi.map((t) => relative(GOC, t)), "đường của một con người phải đi qua `xuatBoBangChung`").toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: `xuatBoBangChung` có người gọi dưới `apps/` — phép quét không rỗng ruột", () => {
    const co = quetTepTs(THU_MUC_APPS).filter((t) => /\bxuatBoBangChung\b/u.test(readFileSync(t, "utf8")));
    expect(co.length).toBeGreaterThan(0);
  });
});

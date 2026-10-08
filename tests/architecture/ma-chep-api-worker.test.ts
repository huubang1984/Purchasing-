// ==============================================================================================
// [S1.224 / khoản 187] BẢNG KIỂM KÊ MÃ CHÉP GIỮA `apps/api/src` VÀ `apps/unseal-worker/src` — ĐÓNG, ĐỌC BẰNG MÁY
// [S1.238 / khoản 280] … VÀ GIỮA MỌI `apps/*/src`, `tools/*/src` (N ĐƠN VỊ)
//
// [S1.238 / khoản 280] Bộ quét ~~đọc HAI app theo đề bài S1.224~~ nay đọc MỌI đơn vị `apps/*/src` và `tools/*/src` (tệp theo
// `git ls-files`, không `readdirSync` — khoản 189): một tên khai mức module ở ≥ 2 ĐƠN VỊ thì MỌI tệp khai nó phải thuộc một hàng của
// `BANG_TEN`, một literal regex ở ≥ 2 đơn vị thì mọi tệp mang nó phải thuộc một hàng của `BANG_MAU`. Một hàng là một HỌ bản chép cùng
// tên (hay cùng literal) chung một cách xử lý; một tên có thể có nhiều họ, tập tệp rời nhau (`moTaLoi` của năm điểm vào / của hai
// module MCP). Đo trước: bản thứ ba ở `apps/web/src/main.ts` trôi (bỏ nhánh `CauHinhError`) thì cổng cũ 83/83 xanh; bộ quét N đơn vị
// với ba bảng cũ đỏ (liệt kê ở biên bản §S1.238). Kiểm kê KHÔNG gộp mã chép nào thành hàm chung (đề bài lô A1) — năm bản `moTaLoi`
// của điểm vào trùng từng ký tự (đo bằng so văn bản), nên không có đề xuất hàm chung.
//
// Worker mở thầu ra đời (S1.6, S1.82) bằng cách CHÉP từng mảnh của `api`: bộ đọc cấu hình, bộ mô tả lỗi, hai bộ nghe pool,
// `moTaLoi` của điểm vào. `g1-` cấm mọi module ngoài worker import nó và worker không import `apps/api`, nên chép là con đường
// duy nhất — và không ai liệt kê những gì đã chép. Ba bản chép ĐÃ trôi thật trước khi ai đo (khoản 166: bản `moTaLoi` của worker
// thiếu tầng `cause`, không nhận `TenantError` theo lớp; hằng mã năm ký tự hai bản) và được nâng lên `@trustprocure/identity` ở
// S1.222. Khoản 187 hỏi câu còn lại: *còn gì nữa đã chép mà chưa ai đối chiếu* — và đòi một câu trả lời có kết quả ghi ra, có
// cổng giữ. Tệp này là cả hai: ba bảng dưới đây LÀ bảng kiểm kê (biên bản §S1.224 chép từ đây), và ba `describe` là cổng.
//
// BA CHIỀU KIỂM KÊ, đọc cây cú pháp TypeScript (không regex trên văn bản: chú thích và chuỗi không phải khai báo):
//   ⑴ CÙNG TÊN — khai báo MỨC MODULE (function, const/let, class, interface, type, enum) có mặt ở CẢ HAI app: `BANG_TEN`;
//   ⑵ CÙNG HẰNG — một biểu thức chính quy có mặt ở cả hai app, dù đặt tên khác hay không đặt tên: `BANG_MAU`;
//   ⑶ KHÁC TÊN, CÙNG VIỆC — cặp tìm bằng tay (đọc hai tệp), khai để cổng giữ chúng còn tồn tại ở đúng tệp: `BANG_KHAC_TEN`.
//   [S1.238 / khoản 280] "Cả hai app" ở ⑴ ⑵ đọc là "≥ 2 đơn vị"; ⑶ nhận hai bản trở lên (bộ nghe pool của `tools/neo-so-kiem-toan`
//   là bản thứ ba của khuôn worker).
// Mỗi hàng chọn ĐÚNG MỘT cách xử lý và ghi lý do tại hàng:
//   `NANG`  — một bản ở gói chung, hai bên import. Cổng đòi tên KHÔNG còn khai ở app nào và CÓ khai ở tệp gói chung (kèm regex
//             đi theo nếu có) — để một bản cục bộ không mọc lại. [S1.238 / khoản 280] "App nào" là các ĐƠN VỊ của tệp cũ (`tepCu`);
//             một bản cục bộ ở đơn vị khác là một họ riêng, có hàng riêng (`moTaLoiKhongGiaTri` của hai tool).
//   `GIU`   — hai bản, KÈM phép đo chống trôi: `VAN_BAN` (mục II so văn bản khai báo từng ký tự, bỏ `export`) hay `HANH_VI`
//             (mục III chạy hai `docCauHinh` trên CÙNG giá trị của CÙNG biến — cùng nhận hay cùng từ chối, cùng nêu tên biến).
//             [S1.238 / khoản 280] ~~hai bản~~ HAI BẢN TRỞ LÊN; thêm `KHUON` (mục II so điều kiện và khuôn dòng log của bộ nghe pool,
//             bỏ tiền tố tiến trình — cặp ở `BANG_KHAC_TEN` phải phủ mọi tệp của hàng) và `TEP_TEST` (phép đo HÀNH VI nằm ở tệp test
//             của từng bản, ghi đường dẫn — cổng đòi tệp ấy còn trong kho và nhắc tên hàm).
//   `RIENG` — cùng tên nhưng khác hợp đồng CÓ CHỦ ĐÍCH (điểm vào, role đăng nhập, bộ biến khoá) — lý do ghi tại hàng, không đo.
//             [S1.238 / khoản 280] Kể cả TRÙNG TÊN không phải bản chép (`main`, `chay`, `chuoi` của các tool — khác việc), và bản
//             chép ĐÃ khác chữ theo lớp lỗi của chính chương trình (`bat`, `batBuoc`) — lý do nêu chỗ khác.
//
// CỔNG CÓ RĂNG HAI CHIỀU: một tên mới xuất hiện ở cả hai app mà không có hàng ⇒ đỏ (lần chép kế tiếp không đi vào lặng lẽ); một
// hàng không còn đúng — tệp đổi, loại đổi, một bên đã xoá, một `NANG` mọc lại, một `GIU` không có phép đo ⇒ đỏ (bảng không được
// thiu). Đối chứng trong bộ nhớ: một lần quét giả có thêm một hàm chép sang worker phải bị bắt; bộ quét tự kiểm trên văn bản mẫu.
// [S1.238 / khoản 280] Và: một bản chép ở một đơn vị MỚI (`apps/moi/src/main.ts` mang `moTaLoi`) ⇒ đỏ nêu tệp; hai họ cùng tên giữ
// chung một tệp ⇒ đỏ; một họ `GIU` chỉ một tệp ⇒ đỏ (không có gì để so).
//
// RANH GIỚI, nói ra — một cổng im lặng bỏ qua một vùng mã là một cổng nói dối về phạm vi của chính nó:
//   ⒜ ⑴ chỉ khai báo MỨC MODULE và chỉ theo TÊN — một hàm chép rồi ĐỔI TÊN một bên chỉ bị bắt khi mang một biểu thức chính quy
//      chung (⑵) hay được khai tay ở ⑶; một khối mã chép vào TRONG thân một hàm khác thì mù. Tệp quét bằng `git ls-files` (tệp dò
//      tạm không tính), bỏ test và `.d.ts`.
//   ⒝ ⑵ chỉ regex, không so chuỗi hay số: chuỗi chung của hai app là khuôn dòng log của bộ nghe pool và có phép đo riêng ở mục II.
//   ⒞ `HANH_VI` chỉ phủ các biến HAI tiến trình cùng đọc; phần riêng mỗi bên (ba vòng bí mật và bộ gửi của `api`, cảnh báo của
//      worker) đo ở `cau-hinh.test.ts` của mỗi app. Một lệch ĐÃ KHAI (độ dài khoá 32 byte) ghim riêng ở mục III, không giấu.
//   ⒟ ~~`apps/mcp`, `apps/web`, `apps/public-keys` và `tools/` mang `moTaLoi`/`cau-hinh.ts` cùng khuôn — ngoài tầm (khoản 280).~~
//      [S1.238 / khoản 280] Nay trong tầm. Còn ngoài tầm: `packages/` (mã chép giữa gói với nhau hay gói ↔ app — gói chung là CHỖ
//      nâng tới, không phải bản chép), tệp ngoài `src/` (`apps/web/trang/*.js` ra thẳng trình duyệt), `.mjs` và mã không khai tên
//      (bộ mô tả lỗi viết thẳng trong thân của `tools/gieo-demo`). Tên trùng trong MỘT đơn vị mà không đơn vị nào khác khai thì
//      không đòi hàng (chép trong một app là việc của review app ấy).
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MasterKeyRing } from "@trustprocure/crypto-keys";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
const API = "apps/api/src/";
const WORKER = "apps/unseal-worker/src/";

type LoaiKhaiBao = "function" | "const" | "class" | "interface" | "type" | "enum";
type XuLy = "NANG" | "GIU" | "RIENG";
/** [S1.238 / khoản 280] Thêm `KHUON` và `TEP_TEST` — xem khối đầu tệp. */
type DoLuong = "VAN_BAN" | "KHUON" | "HANH_VI" | "TEP_TEST" | "KHONG";

interface HangTen {
  readonly ten: string;
  readonly loai: LoaiKhaiBao;
  /**
   * ~~Tệp (so với gốc kho) khai tên này ở mỗi bên (`api`, `worker`).~~ [S1.238 / khoản 280] MỌI tệp (mọi đơn vị) khai tên này và
   * thuộc HỌ bản chép của hàng — cổng so đúng tập. Họ khác cùng tên là hàng khác, tập tệp rời nhau. Hàng `NANG`: rỗng.
   */
  readonly tep: readonly string[];
  readonly xuLy: XuLy;
  readonly doLuong: DoLuong;
  /** [S1.238 / khoản 280] `NANG`: tệp TỪNG giữ bản chép (lịch sử) — tên không được mọc lại ở ĐƠN VỊ của chúng. */
  readonly tepCu?: readonly string[];
  /** `NANG`: tệp của gói chung nay giữ bản DUY NHẤT; `mauKemTheo`: regex đi theo hàm, cũng không được còn ở app nào. */
  readonly goiChung?: string;
  readonly mauKemTheo?: string;
  /** [S1.238 / khoản 280] `TEP_TEST`: tệp test đo HÀNH VI của từng bản — phải còn trong kho và nhắc tên hàm. */
  readonly tepTest?: readonly string[];
  readonly lyDo: string;
}

interface HangMau {
  /** Đúng văn bản của literal, kể cả cờ — như `ts.RegularExpressionLiteral.text`. */
  readonly mau: string;
  readonly ten: string;
  /** ~~`api`, `worker`~~ [S1.238 / khoản 280] Mọi tệp mang literal và thuộc họ của hàng — so đúng tập; họ khác là hàng khác. */
  readonly tep: readonly string[];
  /** [S1.238 / khoản 280] `RIENG`: cùng literal, khác việc (tách dòng, hex của một băm) — không phải bản chép. */
  readonly xuLy: "GIU" | "RIENG";
  readonly lyDo: string;
}

interface HangKhacTen {
  /** ~~`api`, `worker`~~ [S1.238 / khoản 280] Hai bản trở lên. */
  readonly ban: readonly { readonly ten: string; readonly tep: string }[];
  readonly xuLy: "GIU";
  /** ~~`VAN_BAN`~~ [S1.238 / khoản 280] `KHUON` — tên đúng của thứ mục II so ở hai cặp bộ nghe (điều kiện + khuôn dòng log). */
  readonly doLuong: "KHUON" | "HANH_VI";
  readonly lyDo: string;
}

const MO_TA_LOI_CHUNG = "packages/identity/src/mo-ta-loi.ts";
const CAU_HINH_API = `${API}cau-hinh.ts`;
const CAU_HINH_WORKER = `${WORKER}cau-hinh.ts`;
const MAIN_API = `${API}main.ts`;
const MAIN_WORKER = `${WORKER}main.ts`;
// [S1.238 / khoản 280] Các đơn vị khác mà kiểm kê nêu tên nhiều lần.
const MCP = "apps/mcp/src/";
const WEB = "apps/web/src/";
const PUBLIC_KEYS = "apps/public-keys/src/";
const NEO = "tools/neo-so-kiem-toan/src/index.ts";
const BO_XUAT = "tools/bo-xuat-danh-gia/src/";
const KHOI_TAO = "tools/khoi-tao-to-chuc/src/";
const PILOT = "tools/pilot-gia-lap/src/";
const KIEM_TRUOC_APPLY = "tools/kiem-truoc-apply/src/";

// ==============================================================================================
// I. BẢNG KIỂM KÊ — kết quả của khoản 187, ĐÓNG. Thêm một hàng là một quyết định nhìn thấy được, kèm lý do.
// ==============================================================================================

/** ⑴ Cùng tên ở hai app. Thứ tự: đã nâng, rồi giữ (đo văn bản, đo hành vi), rồi riêng. */
const BANG_TEN: readonly HangTen[] = [
  {
    ten: "moTaLoiKhongGiaTri",
    loai: "function",
    tep: [],
    tepCu: [`${API}mo-ta-loi.ts`, `${WORKER}tien-trinh.ts`],
    xuLy: "NANG",
    doLuong: "KHONG",
    goiChung: MO_TA_LOI_CHUNG,
    lyDo:
      "[S1.222 / khoản 166] Bản của worker (tên cục bộ `moTaLoi`, ~5 dòng) thiếu tầng `cause` và không nhận `TenantError` " +
      "theo lớp — lệch THẬT, đo trên tiến trình worker (`composition.int.test.ts`). Nâng lên identity (gói cả hai đã phụ thuộc, " +
      "nơi `moTaHangDongCuaLanTuChoi` sống); `api` xuất lại đúng hàm ấy (`mo-ta-loi.test.ts` ghim `toBe`), worker gọi thẳng.",
  },
  {
    ten: "moTaMotTang",
    loai: "function",
    tep: [],
    tepCu: [`${API}mo-ta-loi.ts`],
    xuLy: "NANG",
    doLuong: "KHONG",
    goiChung: MO_TA_LOI_CHUNG,
    lyDo: "[S1.222] Hàm phụ đi theo `moTaLoiKhongGiaTri`; worker chưa từng có tên này (bản chép của nó gộp một dòng). Giữ hàng để " +
      "một bản phụ không mọc lại ở `api`.",
  },
  {
    ten: "MA_NAM_KY_TU",
    loai: "const",
    tep: [],
    tepCu: [`${API}mo-ta-loi.ts`, `${WORKER}tien-trinh.ts`],
    xuLy: "NANG",
    doLuong: "KHONG",
    goiChung: MO_TA_LOI_CHUNG,
    mauKemTheo: "/^[0-9A-Z]{5}$/u",
    lyDo: "[S1.222 / khoản 166] Hình dạng SQLSTATE chép hai bản (worker chép literal không tên). Đi cùng hàm lên identity; cổng " +
      "đòi cả TÊN lẫn LITERAL không còn ở app nào.",
  },
  {
    ten: "moTaLoi",
    loai: "function",
    tep: [MAIN_API, `${MCP}main.ts`, `${PUBLIC_KEYS}main.ts`, MAIN_WORKER, `${WEB}main.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Bộ mô tả lỗi KHỞI ĐỘNG của điểm vào (`CauHinhError` ⇒ message; `Error` ⇒ `tên: message`; khác ⇒ `loi khong ro`). Giữ hai " +
      "bản vì mỗi bản `instanceof` lớp `CauHinhError` của CHÍNH app (hai lớp, mục dưới) và điểm vào cố ý không phụ thuộc gói nào " +
      "ngoài hai tệp cạnh nó. Hai bản trùng từng ký tự — cổng giữ đúng thế. [S1.238 / khoản 280] NĂM điểm vào (thêm `apps/mcp`, " +
      "`apps/public-keys`, `apps/web`), cùng lý do; đo bằng so văn bản ở vòng này: năm bản trùng từng ký tự — CHƯA lệch, nên không " +
      "đề xuất hàm chung (hàng sổ 280). Hai bản cùng tên trong `apps/mcp` (`giao-thuc.ts`, `vong-lap.ts`) là một họ khác — hàng dưới.",
  },
  {
    ten: "CauHinhError",
    loai: "class",
    tep: [CAU_HINH_API, `${MCP}cau-hinh.ts`, `${PUBLIC_KEYS}cau-hinh.ts`, CAU_HINH_WORKER, `${WEB}cau-hinh.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "[ADR-021] Lớp lỗi cấu hình, `name` cố định. Hai lớp riêng vì hai `docCauHinh` là hai hợp đồng riêng (worker cố ý KHÔNG " +
      "đọc ba vòng bí mật của `api` — khối đầu `cau-hinh.ts` của worker); thân lớp trùng từng ký tự. [S1.238 / khoản 280] Năm app, " +
      "năm `docCauHinh` (hàng `docCauHinh`), mỗi điểm vào `instanceof` lớp của CHÍNH app (hàng `moTaLoi`); năm bản trùng từng ký tự.",
  },
  {
    ten: "VongBiMat",
    loai: "interface",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Hình dạng một vòng bí mật có phiên bản — đúng thứ `MasterKeyRing` nhận. Kiểu, không năng lực; trùng từng ký tự.",
  },
  {
    ten: "MoiTruong",
    loai: "type",
    tep: [CAU_HINH_API, `${PUBLIC_KEYS}cau-hinh.ts`, CAU_HINH_WORKER, "tools/chay-migrate/src/index.ts"],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Bản đồ tên → chuỗi của `process.env`; `api` xuất (test của nó dùng), worker không. So văn bản bỏ `export`. " +
      "[S1.238 / khoản 280] `apps/public-keys/src/cau-hinh.ts` và `tools/chay-migrate` khai cùng kiểu; bốn bản trùng.",
  },
  {
    ten: "BASE64",
    loai: "const",
    tep: [CAU_HINH_API, `${PUBLIC_KEYS}cau-hinh.ts`, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Hình dạng base64 chuẩn của giá trị khoá. Cùng literal còn ở `routes/guest.ts` của `api` (BANG_MAU). [S1.238 / khoản 280] " +
      "`apps/public-keys` kiểm khoá công khai biên nhận (`TRUSTPROCURE_RECEIPT_PUBLIC_KEYS`) bằng cùng hằng; ba bản trùng.",
  },
  {
    ten: "TEN_PHIEN_BAN",
    loai: "const",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Tên phiên bản khoá đi vào AAD/`kid` — hai bên phải nhận cùng một tập tên, vì cùng một `TRUSTPROCURE_MASTER_KEYS` đi vào cả hai.",
  },
  {
    ten: "EMAIL_DON",
    loai: "const",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Địa chỉ email đơn cho `TRUSTPROCURE_SES_FROM` — cùng biến ở hai tiến trình (ADR-065).",
  },
  {
    ten: "EMAIL",
    loai: "const",
    tep: [`${API}adapters/gui-ses.ts`, `${WORKER}adapters/canh-bao-ses.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Cùng hình dạng email kiểm lại lúc gửi ở hai adapter SES (`taoBoGuiSes`, `taoCanhBaoSes`). Mỗi adapter là một cửa ra " +
      "riêng (IAM riêng, `FromAddress` riêng) nên hai bản; literal trùng.",
  },
  {
    ten: "bat",
    loai: "function",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Đọc biến bắt buộc, thông điệp chỉ nêu TÊN (quy tắc ⑵). [S1.224] Worker viết `v.length === 0` nơi `api` viết `v === \"\"` " +
      "— cùng nghĩa, khác chữ; đồng văn bản ở vòng này để cổng so được từng ký tự.",
  },
  {
    ten: "docAdapter",
    loai: "function",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Đọc tên adapter trong tập ĐÓNG; tên lạ (kể cả khác hoa/thường) ⇒ ném nêu tên biến. Thông điệp khác chữ (`api`: \"CHƯA " +
      "CÓ trong kho\", worker: \"CHƯA TỒN TẠI\") và mỗi `cau-hinh.test.ts` ghim chữ của mình — không đồng văn bản; đo hành vi.",
  },
  {
    ten: "docVong",
    loai: "function",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Ngữ pháp `v1=<base64>,v2=<base64>`: thiếu `=`, tên phiên bản sai, khai hai lần, base64 sai, `active` không có trong vòng " +
      "⇒ cả hai ném nêu tên biến. LỆCH ĐÃ KHAI: `api` có tham số độ dài byte và từ chối khoá ≠ 32 byte ngay ở `docCauHinh`; " +
      "worker để `MasterKeyRing` ném lúc dựng tiến trình (khối đầu `cau-hinh.ts` của worker nói rõ) — mục III ghim cả hai nửa.",
  },
  {
    ten: "docDatabaseUrl",
    loai: "function",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Cùng ngữ pháp URI, KHÁC role đăng nhập có chủ đích (`app_api_login` / `app_unseal_login` — cặp duy nhất hardening giữ). " +
      "Đo: không phải URI và superuser đều bị cả hai từ chối.",
  },
  {
    ten: "docThuMucTuyetDoi",
    loai: "function",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Đường dẫn tương đối ⇒ ném (thư mục nằm trong cây repo khi chạy dev). Thông điệp nêu lý do riêng mỗi bên (hộp thư dev / " +
      "cảnh báo break-glass) nên không đồng văn bản; đo hành vi trên hai biến `TRUSTPROCURE_DEV_MAILBOX_DIR` / `TRUSTPROCURE_ALERT_DIR`.",
  },
  {
    ten: "tuChoiBienCuaAdapterKhac",
    loai: "function",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "[ADR-064] Hai bộ biến khoá loại trừ nhau. Đo: dưới `local-dev` còn `TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID`, dưới `aws-kms` còn " +
      "`TRUSTPROCURE_MASTER_KEYS` ⇒ cả hai ném nêu tên biến sót.",
  },
  {
    ten: "chinh",
    loai: "function",
    tep: [MAIN_API, `${MCP}main.ts`, `${PUBLIC_KEYS}main.ts`, MAIN_WORKER, `${WEB}main.ts`, "tools/gieo-demo/src/index.ts", `${PILOT}index.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Thân điểm vào của mỗi tiến trình: cùng ba việc, khác tiến trình dựng (`taoTienTrinhApi` / `taoTienTrinhUnsealWorker`) và " +
      "`api` in thêm dòng đang nghe. Không phải bản chép để giữ giống. [S1.238 / khoản 280] Cùng tên ở ba điểm vào khác (`apps/mcp`, " +
      "`apps/public-keys`, `apps/web`) và hai tool (`gieo-demo`, `pilot-gia-lap`) — mỗi thân dựng chương trình của CHÍNH nó.",
  },
  {
    ten: "docCauHinh",
    loai: "function",
    tep: [CAU_HINH_API, `${MCP}cau-hinh.ts`, `${PUBLIC_KEYS}cau-hinh.ts`, CAU_HINH_WORKER, `${WEB}cau-hinh.ts`, "tools/chay-migrate/src/index.ts"],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Hai hợp đồng cấu hình khác nhau có chủ đích (worker KHÔNG đọc ba vòng bí mật của `api` — ADR-006, đo ở `cau-hinh.test.ts` " +
      "của worker vế ⑼). Phần biến CHUNG của hai hàm đo ở mục III. [S1.238 / khoản 280] Sáu hợp đồng: mỗi app (và `tools/chay-migrate`) " +
      "đọc tập biến của CHÍNH nó; luật chung — thông điệp nêu TÊN biến, không giá trị (ADR-021 ⑵) — đo ở `cau-hinh.test.ts` của từng app.",
  },
  {
    ten: "ROLE_DANG_NHAP",
    loai: "const",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "`app_api_login` / `app_unseal_login` — hai cặp role mà `hardening.always.sql` (`CAP_HOP_LE`) giữ; khác giá trị là bản chất.",
  },
  {
    ten: "THAN_403",
    loai: "const",
    tep: [`${API}dispatch.ts`, `${WEB}dang-nhap.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "[S1.255 / khoản 326] `api`: THÂN phản hồi 403 (một object, khoản 191 — không nói thiếu quyền nào). `/lib/dang-nhap.js`: " +
      "CHUỖI mà `loiCua` của trang nhận ra để nói thay bằng câu đọc được (khuôn khoản 323; `apps/web/trang/*.js` cũng khai, ngoài tầm " +
      "cổng này). Khác kiểu, khác việc — không phải bản chép để giữ giống mã. Phụ thuộc GIÁ TRỊ thì có, và nói ra: `api` đổi chuỗi " +
      "thì trang trở về in nguyên văn (hành vi trước S1.254) — không test nào nối hai bên; test của `api` chỉ đo mã 403.",
  },
  {
    ten: "BIEN_KHOA_LOCAL_DEV",
    loai: "const",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "`api`: sáu biến của ba vòng; worker: hai biến của MỘT vòng — worker không được cầm lối vào bí mật nào khác (ADR-006; " +
      "`cau-hinh.test.ts` của worker vế ⑼ đặt giá trị rác vào ba vòng kia và đòi KHÔNG ném).",
  },
  {
    ten: "BIEN_KHOA_KMS",
    loai: "const",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "[ADR-064] `api`: bảy biến (ba CMK và nhãn); worker: vùng và đúng MỘT CMK `alias/tp-org-wrap`. Cùng lý do với hàng trên.",
  },
  {
    ten: "docChuoi",
    loai: "function",
    tep: [`${API}outbox-api.ts`, `${WORKER}composition.ts`, `${WEB}cau-hinh.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Đọc một trường chuỗi khỏi `payload` của job. `api` có trần `EMAIL_MAX_BYTES` vì chuỗi là email đi gửi; worker đọc id " +
      "(`unsealRequestId`, `rfqId`) rồi truyền làm tham số SQL kiểu uuid — CSDL từ chối rác. Hai hợp đồng, không phải một bản trôi. " +
      "[S1.238 / khoản 280] Hợp đồng thứ ba cùng tên: `apps/web/src/cau-hinh.ts` đọc một biến môi trường TUỲ CHỌN (rỗng ⇒ `null`).",
  },
  // ============================================================================================
  // [S1.238 / khoản 280] HỌ MỚI của bộ quét N đơn vị. Thứ tự: giữ (có phép đo), rồi riêng. Họ thứ hai của một tên đã có hàng ở trên
  // ghi tên ấy lần nữa — tập tệp rời nhau.
  // ============================================================================================
  {
    ten: "moTaLoi",
    loai: "function",
    tep: [`${MCP}giao-thuc.ts`, `${MCP}vong-lap.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Mô tả lỗi cho MÁY KHÁCH MCP (`giao-thuc.ts` tự khai \"cùng khuôn `moTaLoi` của apps/api\"): khuôn điểm vào trừ nhánh " +
      "`CauHinhError` — hai module ấy không chạm lỗi cấu hình. Họ khác với năm điểm vào (khác thân có chủ đích); hai bản trong " +
      "`apps/mcp` trùng từng ký tự — cổng giữ thế.",
  },
  {
    ten: "moTaLoiKhongGiaTri",
    loai: "function",
    tep: [`${BO_XUAT}index.ts`, NEO],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "[S1.227 / khoản 180] Bản cục bộ ~4 dòng của hai tool: tên lỗi + mã hằng `^[0-9A-Z_]{2,64}$`, không `cause`, không " +
      "`TenantError` theo lớp — HẸP hơn bản identity (hàng NANG trên). Hai trong bốn bộ mô tả lỗi cục bộ của `tools/` (§S1.227): " +
      "`khoi-tao-to-chuc` dùng `maLoi` (hàng `maLoi`), `gieo-demo` in thẳng `name`/`code` trong thân (không khai hàm — bộ quét không " +
      "thấy). Nay có đường trả qua `@trustprocure/identity` (S1.222); nâng là gộp mã — ngoài lô A1. Hai bản trùng từng ký tự.",
  },
  {
    ten: "batBuoc",
    loai: "function",
    tep: [`${BO_XUAT}index.ts`, NEO],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Đọc biến bắt buộc của hai tool đọc thẳng `process.env` (ném `Error` nêu TÊN biến). Hai bản trùng từng ký tự — cổng giữ thế. " +
      "Hai bản khác cùng tên là một họ khác (hàng RIENG dưới).",
  },
  {
    ten: "UUID",
    loai: "const",
    tep: [`${API}adapters/totp-aws-kms.ts`, `${API}adapters/totp-local-dev.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "`orgId` trước khi vào ngữ cảnh mã hoá bí mật TOTP của hai adapter khoá (KMS / cục bộ) — nhận cả chữ hoa (`/iu`). Hai bản " +
      "trùng từng ký tự. Họ của `tools/neo-so-kiem-toan` (hàng dưới) CHỈ nhận chữ thường — khác hợp đồng có chủ đích (khoá S3).",
  },
  {
    ten: "UUID",
    loai: "const",
    tep: ["tools/neo-so-kiem-toan/src/aws.ts", "tools/neo-so-kiem-toan/src/canh-moc-neo.ts"],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "`orgId` làm tiền tố khoá S3 của sổ neo (\"orgId phải là UUID thường\") và tên thư mục mà bộ canh mốc neo đọc lại — CHỈ " +
      "chữ thường (`/u`): khoá S3 phân biệt hoa/thường, một orgId viết hoa là một thư mục KHÁC. Hai bản trùng từng ký tự.",
  },
  {
    ten: "ThamSoError",
    loai: "class",
    tep: [`${MCP}duong-dan.ts`, `${KHOI_TAO}index.ts`, `${PILOT}tham-so.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Lớp lỗi THAM SỐ, `name` cố định — mỗi chương trình bắt lớp của CHÍNH nó (`giao-thuc.ts` của mcp đổi thành JSON-RPC -32602; " +
      "`khoi-tao-to-chuc` tách lỗi có tên khỏi lỗi lạ). Ba bản trùng từng ký tự — cổng giữ thế.",
  },
  {
    ten: "CAU_LIET_KE_TO_CHUC",
    loai: "const",
    tep: [`${WORKER}tien-trinh.ts`, NEO],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "[ADR-072] Câu liệt kê tổ chức qua `public.outbox_danh_sach_to_chuc()` — câu hỏi \"những tổ chức nào\" đứng trước \"tổ chức " +
      "nào\" nên chạy ngoài `withTenant`, ở bộ chạy outbox của worker và ở `lietKeToChuc` của job neo. Hàm SQL là hợp đồng; hai câu gọi " +
      "trùng từng ký tự — cổng giữ thế.",
  },
  {
    ten: "MIGRATIONS_DIR",
    loai: "const",
    tep: ["tools/chay-migrate/src/index.ts", "tools/gieo-demo/src/index.ts", `${PILOT}csdl.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Thư mục `db/migrations` tính từ tệp của tool (ba tầng lên) — ba tool chạy `migrate()` trên cùng thư mục. Ba bản trùng từng " +
      "ký tự; một tool dời tầng thì bản ấy đổi và cổng đỏ (đường dẫn tương đối không còn chỉ tới cùng chỗ).",
  },
  {
    ten: "chuoi",
    loai: "function",
    tep: [`${API}routes/anon.ts`, `${API}routes/auth.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Đọc trường chuỗi BẮT BUỘC của thân yêu cầu ⇒ `HttpError(422)` nêu tên trường — hai tệp route cùng hợp đồng, trùng từng ký " +
      "tự. Năm bản cùng tên ở chỗ khác là họ khác (hàng RIENG dưới).",
  },
  // [S1.249 / kid] Hàng `KID` ~~RIENG (ở nhóm riêng dưới)~~ nay GIU VAN_BAN — dời lên đây theo thứ tự của bảng.
  {
    ten: "KID",
    loai: "const",
    tep: [CAU_HINH_API, `${PUBLIC_KEYS}cau-hinh.ts`, "tools/neo-so-kiem-toan/src/aws.ts"],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "~~RIENG — `public-keys`: hình dạng kid biên nhận (`assertReceiptKid` của `@trustprocure/bidding`, cho `:`); job neo: kid làm " +
      "TÊN ĐỐI TƯỢNG S3 khi neo tài liệu khoá — bỏ `:` có chủ đích. Hệ quả nói ra: một kid hợp lệ mang `:` thì lệnh neo tài liệu khoá " +
      "NÉM (không im).~~ [S1.249 / kid] Chủ dự án chốt 2026-09-30: phía PHÁT HÀNH và CÔNG BỐ thu hẹp về đúng tập của job neo, trước " +
      "khi có biên nhận thật nào được ký. Ba bản — kid biên nhận ở cấu hình `api` (`TRUSTPROCURE_KMS_RECEIPT_KID`, tên phiên bản của " +
      "`TRUSTPROCURE_RECEIPT_SIGNING_KEYS`), kid của tài liệu khoá mà `public-keys` công bố, kid làm tên đối tượng khi job neo neo tài " +
      "liệu khoá — trùng từng ký tự; cổng giữ thế: một bản nới lại `:` là một kid phát hành hay công bố được mà neo không được. Bản " +
      "thứ tư là `assertReceiptKid` của `@trustprocure/bidding` (gói — ngoài tầm bộ quét; đo hành vi ở `receipt.test.ts` và " +
      "`signer-aws-kms.test.ts`). ĐỊNH DẠNG biên nhận (`KID_PATTERN` của `receipt.ts`) vẫn cho `:` — ADR-026 §1. [S1.250 / kid] " +
      "Bản của job neo nay cũng là tập phát hành của kid KÝ MỐC NEO trong công cụ (`laKidPhatHanh`: bộ ký KMS `taoBoKyNeoAwsKms`, " +
      "`TRUSTPROCURE_NEO_KID` ở `index.ts`) — một tập, không thêm bản chép; vòng khoá local-dev giữ cùng tập ở `KID_PHAT_HANH` của " +
      "`packages/audit/src/anchor-sign.ts` (gói — đo hành vi ở `anchor-sign.test.ts`).",
  },
  {
    ten: "ghiKetNoiHuy",
    loai: "const",
    tep: [`${WORKER}tien-trinh.ts`, NEO],
    xuLy: "GIU",
    doLuong: "KHUON",
    lyDo: "[S1.227 / khoản 180] `tools/neo-so-kiem-toan` chép khuôn bộ nghe `release` của worker (tiền tố `[neo-so]`); đo khuôn ở mục II " +
      "cùng họ `ghiLogKetNoiHuy` của BANG_KHAC_TEN.",
  },
  {
    ten: "ghiLoiToiMuon",
    loai: "const",
    tep: [`${WORKER}tien-trinh.ts`, NEO],
    xuLy: "GIU",
    doLuong: "KHUON",
    lyDo: "[S1.227 / khoản 180] Như hàng trên, cho bộ nghe lỗi-tới-muộn; đo khuôn ở mục II cùng họ `ghiLogLoiKetNoiToiMuon`.",
  },
  {
    ten: "thanhTien",
    loai: "function",
    tep: [`${WEB}so-tien.ts`, `${PILOT}tien.ts`],
    xuLy: "GIU",
    doLuong: "TEP_TEST",
    tepTest: [`${WEB}so-tien.test.ts`, `${PILOT}tien.test.ts`],
    lyDo: "[S1.230 / khoản 218] Thành tiền `lượng × đơn giá` về xu, nửa-ra-xa-0: trang nộp thầu và bộ giả lập — không import được gói " +
      "chung (trang ra thẳng trình duyệt qua `/lib/`). Văn bản khác (bigint trần / số lẻ có kiểm hình dạng); MỖI bản đo HÀNH VI khớp " +
      "`lamTron` của `@trustprocure/danh-gia` ở tệp test của nó — cùng một luật, ba tầng.",
  },
  {
    ten: "EMAIL",
    loai: "const",
    tep: [`${KHOI_TAO}ban-khai.ts`, `${KIEM_TRUOC_APPLY}luat.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "`khoi-tao-to-chuc`: địa chỉ trong bản khai (sẽ ghi `users`/`supplier_contacts`) — hình dạng SES (chú thích tại chỗ nói thế) " +
      "CỘNG `\\p{C}` vì `/auth/link` từ chối email mang ký tự điều khiển/định dạng: hợp đồng GHI, hẹp hơn hợp đồng GỬI của họ api/worker. " +
      "`kiem-truoc-apply`: bóc MIỀN (nhóm bắt) để hỏi danh tính SES đã xác minh — khác việc. Đo bằng so văn bản: ba văn bản khác nhau.",
  },
  {
    ten: "bat",
    loai: "function",
    tep: [`${PUBLIC_KEYS}cau-hinh.ts`, "tools/chay-migrate/src/index.ts", "tools/gieo-demo/src/index.ts"],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Cùng khuôn ADR-021 (đọc biến bắt buộc, thông điệp chỉ nêu TÊN) nhưng mỗi chương trình ném lớp lỗi mà điểm vào của CHÍNH nó " +
      "nhận ra: `public-keys` — `CauHinhError` của nó, đọc qua `doc(env, ten)`, thông điệp `<tên>: thiếu`; `chay-migrate` — " +
      "`ChayMigrateError`; `gieo-demo` — `GieoError`, đọc thẳng `process.env`. Đo bằng so văn bản: ba văn bản khác nhau và khác họ api/worker.",
  },
  {
    ten: "batBuoc",
    loai: "function",
    tep: [`${MCP}cau-hinh.ts`, `${KHOI_TAO}index.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Như hàng `bat` RIENG: `apps/mcp` nhận `env` truyền vào và ném `CauHinhError` của nó; `khoi-tao-to-chuc` ném `ThamSoError`. " +
      "Khác lớp lỗi của điểm vào — khác họ `bo-xuat`/`neo`.",
  },
  {
    ten: "chuoi",
    loai: "function",
    tep: [`${API}adapters/kho-token-zalo.ts`, `${BO_XUAT}bo.ts`, `${KHOI_TAO}ban-khai.ts`, `${KIEM_TRUOC_APPLY}nguon.ts`, `${PILOT}hop-thu.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Đọc một trường chuỗi của một object — mỗi bản ném lớp lỗi của bối cảnh nó với vị trí của nó: bí mật Zalo (`GuiKenhError`, " +
      "cho phép rỗng tuỳ trường), bộ bằng chứng (`BoHongError` + đường dẫn JSON), bản khai (`BanKhaiError`, cắt khoảng trắng), biến Terraform " +
      "đọc qua `terraform console` (`DocBienError`), hộp thư giả lập (không ném, trả `undefined`). Trùng tên, khác hợp đồng.",
  },
  {
    ten: "chuoiTuyChon",
    loai: "function",
    tep: [`${API}routes/buyer.ts`, `${BO_XUAT}bo.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Trường chuỗi TUỲ CHỌN: thân yêu cầu (`null` khi vắng, sai kiểu ⇒ 422) / bộ bằng chứng (`undefined` khi vắng, `BoHongError`).",
  },
  {
    ten: "soNguyen",
    loai: "function",
    tep: [CAU_HINH_API, `${API}routes/buyer.ts`, `${BO_XUAT}bo.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Ba việc: biến môi trường số trong miền (`cau-hinh.ts` — bản song sinh của `docSoNguyen` worker, đo ở BANG_KHAC_TEN), " +
      "trường số nguyên của thân yêu cầu (⇒ 422), trường số nguyên của bộ bằng chứng (`BoHongError`).",
  },
  {
    ten: "tuyChon",
    loai: "function",
    tep: [CAU_HINH_API, NEO],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Biến tuỳ chọn, rỗng ⇒ không có: `api` nhận `env` truyền vào (test tiêm), job neo đọc thẳng `process.env`. Cùng luật một dòng, " +
      "khác chữ ký — không phải bản chép để giữ giống.",
  },
  {
    ten: "doiTuong",
    loai: "function",
    tep: [`${BO_XUAT}bo.ts`, `${KIEM_TRUOC_APPLY}nguon.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Đòi một object: giá trị ở một đường dẫn JSON của bộ bằng chứng / một trường của biến Terraform đọc qua `terraform console` — hai chữ ký, hai lớp lỗi.",
  },
  {
    ten: "laDoiTuong",
    loai: "const",
    tep: [`${WEB}tao-thau.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Vị từ object thuần một dòng của trang tạo thầu (ra thẳng trình duyệt, không import gói). Cùng tên, dạng hàm, ở bản khai của " +
      "`khoi-tao-to-chuc` (hàng dưới) — một dòng mỗi nơi, không phải bản chép để giữ giống.",
  },
  {
    ten: "laDoiTuong",
    loai: "function",
    tep: [`${KHOI_TAO}ban-khai.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Vị từ object thuần của bộ đọc bản khai — xem hàng trên.",
  },
  {
    ten: "cong",
    loai: "function",
    tep: [`${WEB}so-tien.ts`, "tools/bo-xuat-danh-gia/src/doc-lap/tinh-lai.ts", `${PILOT}tham-so.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Ba việc: cộng các chuỗi tiền ở trang nộp thầu, cộng hai số thập phân của bộ tính lại độc lập, đọc SỐ CỔNG của bộ giả lập.",
  },
  {
    ten: "maLoi",
    loai: "function",
    tep: [`${API}adapters/gui-zalo.ts`, `${KHOI_TAO}index.ts`, `${KHOI_TAO}khoi-tao.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Ba việc: mã HTTP + mã lỗi số của phản hồi Zalo; đuôi ` (ma CODE)` của dòng lỗi khởi tạo (bộ mô tả lỗi thứ ba của `tools/`, " +
      "§S1.227); đọc `code` thô để phân loại lỗi SQL trong giao dịch khởi tạo.",
  },
  {
    ten: "HttpError",
    loai: "class",
    tep: [`${API}http.ts`, `${PILOT}http.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "`api`: lỗi handler ném để bộ điều phối trả mã — `(status, message)`; bộ giả lập: lỗi của MÁY KHÁCH khi api trả mã lạ — " +
      "`(message, status)`. Hai hợp đồng ngược chiều; thứ tự tham số khác nhau.",
  },
  // [S1.249 / kid] ~~Hàng `KID` RIENG (public-keys cho `:`, job neo bỏ `:`)~~ — nay GIU VAN_BAN, ba bản, ở nhóm giữ phía trên.
  {
    ten: "CONG_MAC_DINH",
    loai: "const",
    tep: [`${WEB}cau-hinh.ts`, `${PILOT}cum.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Cổng mặc định của máy chủ trang / bộ ba cổng của cụm giả lập — khác kiểu, khác việc.",
  },
  {
    ten: "TRAN_MAC_DINH_MS",
    loai: "const",
    tep: [`${API}adapters/gui-zalo.ts`, `${MCP}cau-hinh.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Trùng tên và giá trị (10 s), khác việc: trần một lời gọi Zalo ZNS / trần mặc định một lời gọi api của mcp. Đổi một bên không kéo bên kia.",
  },
  {
    ten: "TRAN_THAN_BYTE",
    loai: "const",
    tep: [`${API}router.ts`, `${MCP}khach-api.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "64 KiB thân YÊU CẦU mà api nhận / 256 KiB thân PHẢN HỒI mà mcp đọc từ api — hai chiều, hai trần.",
  },
  {
    ten: "docCookie",
    loai: "function",
    tep: [`${API}router.ts`, `${MCP}cau-hinh.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Bóc header `Cookie` của yêu cầu (tên trùng ⇒ bỏ) / kiểm hình dạng cookie phiên agent trong cấu hình mcp — khác việc.",
  },
  {
    ten: "docThan",
    loai: "function",
    tep: [`${API}server.ts`, `${MCP}khach-api.ts`, `${WEB}phuc-vu.ts`, "tools/neo-so-kiem-toan/src/aws.ts"],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Đọc thân: yêu cầu HTTP có trần byte (api), phản hồi của api có trần (mcp), yêu cầu của máy chủ trang, đối tượng S3 (neo) — " +
      "bốn nguồn, bốn hợp đồng trần.",
  },
  {
    ten: "traLoi",
    loai: "function",
    tep: [`${PUBLIC_KEYS}index.ts`, `${WEB}phuc-vu.ts`, `${PILOT}cum.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Ghi phản hồi JSON (public-keys) / ghi phản hồi có header chung (web) / hỏi một URL có trả lời không (cụm giả lập).",
  },
  {
    ten: "doc",
    loai: "const",
    tep: [`${API}routes/anh-xa.ts`, `${API}routes/buyer.ts`, `${API}routes/du-lieu.ts`, `${API}routes/du-lieu-ngoai.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Bảng route ĐỌC của ~~hai~~ [S1.237 / gộp #217] ba tệp route người mua (thêm năm route ánh xạ của S4.3b) — nội dung khác nhau " +
      "theo tệp. Cùng tên, dạng hàm, ở `public-keys` (hàng dưới). [S1.272 / S4.6a] Thêm tệp route mốc ngoài và lịch sử ngoài hệ thống.",
  },
  {
    ten: "doc",
    loai: "function",
    tep: [`${PUBLIC_KEYS}cau-hinh.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Đọc một biến môi trường đã cắt khoảng trắng của `public-keys` — khác việc với bảng route `doc` của api.",
  },
  {
    ten: "ketQua",
    loai: "const",
    tep: [`${MCP}giao-thuc.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Dựng thông điệp kết quả JSON-RPC. Cùng tên, dạng hàm, ở `tools/inv-matrix` (hàng dưới) — khác việc.",
  },
  {
    ten: "ketQua",
    loai: "function",
    tep: ["tools/inv-matrix/src/danh-gia.ts"],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Phán xét một hàng của ma trận bất biến từ kết quả test — khác việc với `ketQua` của mcp.",
  },
  {
    ten: "CACH_DUNG",
    loai: "const",
    tep: [`${BO_XUAT}index.ts`, `${KHOI_TAO}index.ts`, NEO],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Chuỗi hướng dẫn dùng của mỗi CLI — nội dung là lệnh của chính tool.",
  },
  {
    ten: "Lenh",
    loai: "type",
    tep: [`${BO_XUAT}index.ts`, NEO, `${PILOT}tham-so.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Tập lệnh CLI của mỗi tool.",
  },
  {
    ten: "laLenh",
    loai: "function",
    tep: [`${BO_XUAT}index.ts`, NEO],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Vị từ thuộc tập lệnh của mỗi tool (hàng `Lenh`).",
  },
  {
    ten: "ThamSo",
    loai: "interface",
    tep: [`${KHOI_TAO}index.ts`, `${PILOT}tham-so.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Tham số dòng lệnh đã đọc của mỗi tool.",
  },
  {
    ten: "docThamSo",
    loai: "function",
    tep: [`${KHOI_TAO}index.ts`, `${PILOT}tham-so.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Bộ đọc dòng lệnh của mỗi tool (hàng `ThamSo`).",
  },
  {
    ten: "main",
    loai: "function",
    tep: ["tools/bench-keyprovider/src/index.ts", `${BO_XUAT}index.ts`, "tools/cap-so/src/index.ts", "tools/inv-matrix/src/index.ts", `${KIEM_TRUOC_APPLY}index.ts`, NEO],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Điểm vào của sáu tool — mỗi thân chạy tool của nó.",
  },
  {
    ten: "chay",
    loai: "function",
    tep: ["tools/chay-migrate/src/index.ts", `${KHOI_TAO}index.ts`, `${KIEM_TRUOC_APPLY}nguon.ts`, `${PILOT}index.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Thân lệnh chính của ba tool, và bộ chạy một tiến trình con của `kiem-truoc-apply` — khác việc.",
  },
  {
    ten: "xuat",
    loai: "function",
    tep: [`${BO_XUAT}index.ts`, NEO],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Lệnh `xuat` của mỗi tool: bộ bằng chứng đánh giá / bản neo sổ kiểm toán.",
  },
  {
    ten: "kiem",
    loai: "function",
    tep: [`${BO_XUAT}index.ts`, "tools/cap-so/src/index.ts", NEO],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Lệnh `kiem` của mỗi tool: bộ bằng chứng / số tạm ADR-090 / bản neo.",
  },
  {
    ten: "khoiTao",
    loai: "function",
    tep: [`${KHOI_TAO}khoi-tao.ts`, NEO],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Chạy bản khai khởi tạo tổ chức / lệnh `khoi-tao` kho neo (một lần, có người gõ) — khác việc.",
  },
  {
    ten: "handler",
    loai: "function",
    tep: ["tools/canh-dang-ky/src/canh-dang-ky.ts", "tools/neo-so-kiem-toan/src/canh-moc-neo.ts"],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Điểm vào Lambda của hai bộ canh (đăng ký SNS / mốc neo) — tên do Lambda đặt.",
  },
  {
    ten: "dongLog",
    loai: "function",
    tep: ["tools/canh-dang-ky/src/canh-dang-ky.ts", "tools/neo-so-kiem-toan/src/canh-moc-neo.ts"],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Dòng log kết luận của hai bộ canh — nội dung theo thứ mỗi bộ canh.",
  },
  // [S1.237 / gộp #217 vào đợt 3] Tên trùng do S4.3b (#217) mang vào sau khi lô A1 kiểm kê — cùng tên, khác việc.
  {
    ten: "phanTram",
    loai: "function",
    tep: [`${WEB}du-lieu.ts`, `${PILOT}tien.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Màn `/du-lieu` in một TỈ LỆ 0..1 thành `N%` làm tròn (độ tin của gợi ý ánh xạ, S4.3b); `pilot-gia-lap` chia hai SỐ TIỀN chuỗi " +
      "bằng `bigint`, một chữ số thập phân dấu phẩy — hai phép tính khác nhau cùng tên.",
  },
  // [S1.237 / tích hợp lô A3] Module đăng nhập dùng chung của web (`apps/web/src/dang-nhap.ts`, khoản 282) mang hai tên và một literal
  // đã có ở đơn vị khác; lô A3 dựng trên nền chưa có bộ quét N đơn vị của lô A1 nên không thấy.
  {
    ten: "loiCua",
    loai: "function",
    tep: [`${WEB}dang-nhap.ts`, `${KHOI_TAO}khoi-tao.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Web dựng câu lỗi từ thân phản hồi HTTP (`error`, hay câu mặc định kèm mã); `khoi-tao-to-chuc` đổi lỗi `pg` (mã, tên ràng " +
      "buộc) thành `KhoiTaoError` — cùng tên, khác đầu vào và khác việc.",
  },
  {
    ten: "truong",
    loai: "function",
    tep: [`${API}routes/anh-xa.ts`, `${API}routes/buyer.ts`, `${API}routes/du-lieu.ts`, `${WEB}dang-nhap.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Đọc một khoá của một thân chưa kiểm kiểu ở hai phía của HTTP: ba tệp route của api đọc thân YÊU CẦU (cùng một dòng, trong " +
      "một đơn vị), module đăng nhập của web đọc thân PHẢN HỒI và tự kiểm `typeof` vì chạy trong trình duyệt — không phải bản chép để " +
      "giữ giống qua ranh giới api ↔ web.",
  },
];

/** ⑵ Cùng biểu thức chính quy ở hai app — bắt cả bản chép KHÔNG TÊN. Tệp ghi là TẬP tệp mỗi bên có literal ấy. */
const BANG_MAU: readonly HangMau[] = [
  // [S1.237 / tích hợp lô A3] Literal UUID của api (tám tệp, một đơn vị) nay cũng ở module đăng nhập của web.
  {
    mau: "/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu",
    ten: "UUID",
    tep: [
      `${API}adapters/totp-aws-kms.ts`,
      `${API}adapters/totp-local-dev.ts`,
      `${API}dispatch.ts`,
      `${API}router.ts`,
      `${API}routes/anh-xa.ts`,
      `${API}routes/buyer.ts`,
      `${API}routes/du-lieu.ts`,
      `${API}routes/du-lieu-ngoai.ts`,
      `${API}routes/guest.ts`,
      `${WEB}dang-nhap.ts`,
    ],
    xuLy: "GIU",
    lyDo: "Cùng một việc ở mọi chỗ — kiểm hình dạng một id UUID trước khi đưa vào câu SQL hay URL; literal phải giữ y hệt (không nới " +
      "chữ hoa hay bỏ dấu gạch ở một bản).",
  },
  {
    mau: "/^[A-Za-z0-9+/]+={0,2}$/u",
    ten: "BASE64",
    tep: [CAU_HINH_API, `${API}routes/guest.ts`, `${PUBLIC_KEYS}cau-hinh.ts`, CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Hình dạng base64 chuẩn; `routes/guest.ts` dùng cho thân yêu cầu của khách (không phải cấu hình). Đo văn bản qua hàng `BASE64`. " +
      "[S1.238 / khoản 280] Cộng `apps/public-keys` (hàng `BASE64`).",
  },
  {
    mau: "/^[A-Za-z0-9._:-]{1,32}$/u",
    ten: "TEN_PHIEN_BAN",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Tên phiên bản khoá. Đo văn bản qua hàng `TEN_PHIEN_BAN`; đo hành vi qua `TRUSTPROCURE_MASTER_KEYS` (mục III).",
  },
  {
    mau: "/^[A-Za-z0-9/:_.-]{1,2048}$/u",
    ten: "định danh CMK (`docKeyIdKms` của `api`; literal không tên ở `docKhoa` của worker)",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Cùng biến `TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID` đi vào cả hai (ADR-064). Đo hành vi ở mục III.",
  },
  {
    mau: "/^[A-Za-z0-9_-]{1,64}$/u",
    ten: "tên configuration set SES (`TEN_CAU_HINH_AWS` của `api`; literal không tên ở worker)",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Cùng biến `TRUSTPROCURE_SES_CONFIGURATION_SET` (ADR-065). Đo hành vi ở mục III.",
  },
  {
    mau: '/^[^\\s@,;<>"]{1,64}@[^\\s@,;<>"]{1,253}\\.[^\\s@,;<>"]{2,63}$/u',
    ten: "EMAIL_DON / EMAIL",
    tep: [`${API}adapters/gui-ses.ts`, CAU_HINH_API, `${WORKER}adapters/canh-bao-ses.ts`, CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Địa chỉ email đơn, kiểm ở cấu hình và kiểm lại lúc gửi. Đo văn bản qua hai hàng `EMAIL_DON`, `EMAIL`; hành vi qua `TRUSTPROCURE_SES_FROM`.",
  },
  {
    mau: "/^[a-z]{2}(?:-[a-z]+)+-\\d$/u",
    ten: "vùng AWS (`VUNG_AWS` của `api`; literal không tên, hai chỗ, ở worker)",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Cùng biến `TRUSTPROCURE_AWS_REGION`, `TRUSTPROCURE_SES_REGION`. Đo hành vi ở mục III (chữ hoa, thiếu số cuối ⇒ cả hai từ chối).",
  },
  {
    mau: "/^\\d{1,9}$/u",
    ten: "số nguyên không âm (`soNguyen` của `api`, `docSoNguyen` của worker)",
    tep: [CAU_HINH_API, CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Ngữ pháp của mọi biến số. Đo hành vi ở mục III trên `TRUSTPROCURE_DB_POOL_MAX`, `TRUSTPROCURE_CLOCK_SKEW_*` (biên, rỗng, chữ).",
  },
  // ============================================================================================
  // [S1.238 / khoản 280] HỌ MỚI của bộ quét N đơn vị. Literal là chính nó: một bản đổi chữ thì rời họ và hàng thiu — cổng đỏ.
  // ============================================================================================
  {
    mau: "/^[A-Za-z0-9_-]{1,64}$/u",
    ten: "tham số đường dẫn của mcp (`HINH_DANG_THAM_SO`)",
    tep: [`${MCP}duong-dan.ts`],
    xuLy: "RIENG",
    lyDo: "Cùng literal với tên configuration set SES của api/worker (hàng trên), khác việc: hình dạng một tham số đường dẫn mà công cụ " +
      "MCP chèn vào URL của api.",
  },
  {
    // [S1.249 / kid] ~~`/^[A-Za-z0-9._:-]{1,64}$/u` — nhãn khoá / kid biên nhận (`NHAN_KMS` của `api`; `KID` của `public-keys`)~~
    mau: "/^[A-Za-z0-9._-]{1,64}$/u",
    ten: "kid biên nhận (`KID` của `api`, của `public-keys` và của job neo)",
    tep: [CAU_HINH_API, `${PUBLIC_KEYS}cau-hinh.ts`, "tools/neo-so-kiem-toan/src/aws.ts"],
    xuLy: "GIU",
    lyDo: "~~`KID_PATTERN` của `@trustprocure/bidding` (`assertReceiptKid`): api kiểm nhãn KMS, gồm kid biên nhận " +
      "`TRUSTPROCURE_KMS_RECEIPT_KID`; public-keys kiểm kid của tài liệu khoá công khai — một kid api ký được thì public-keys phải " +
      "phát được. Kid của job neo (hàng `KID` RIENG của BANG_TEN) bỏ `:`.~~ [S1.249 / kid] Tập PHÁT HÀNH của kid biên nhận " +
      "(`assertReceiptKid` của `@trustprocure/bidding`, không `:`): api ký được thì public-keys công bố được và job neo neo được — ba " +
      "đơn vị, một literal. Đo văn bản qua hàng `KID` của BANG_TEN. `NHAN_KMS` của `api` (hai nhãn phiên bản khoá, GIỮ `:` — chúng " +
      "vào AAD và encryption context, không thành tên tệp hay tên đối tượng) nay chỉ ở một đơn vị: không còn hàng.",
  },
  {
    mau: "/^\\d{1,5}$/u",
    ten: "số cổng máy chủ (`public-keys`, `web`)",
    tep: [`${PUBLIC_KEYS}cau-hinh.ts`, `${WEB}cau-hinh.ts`],
    xuLy: "GIU",
    lyDo: "Ngữ pháp cổng TCP của hai máy chủ tĩnh (`TRUSTPROCURE_PUBLIC_KEYS_PORT`, cổng của web) — cùng việc, cùng literal.",
  },
  {
    mau: "/^[0-9A-Z_]{2,64}$/u",
    ten: "mã hằng của lỗi (`moTaLoiKhongGiaTri` của hai tool)",
    tep: [`${BO_XUAT}index.ts`, NEO],
    xuLy: "GIU",
    lyDo: "Đi theo họ `moTaLoiKhongGiaTri` của `bo-xuat-danh-gia`/`neo-so-kiem-toan` — đo văn bản ở hàng ấy của BANG_TEN.",
  },
  {
    mau: "/\\B(?=(\\d{3})+(?!\\d))/gu",
    ten: "nhóm ba chữ số khi HIỂN THỊ tiền",
    tep: [`${WEB}tao-thau.ts`, `${PILOT}tien.ts`],
    xuLy: "RIENG",
    lyDo: "Trang tạo thầu nhóm số cho người đọc; bộ giả lập nhóm số \"chỉ cho báo cáo\" (`dinhDangVnd`) — không bên nào so chuỗi hiển " +
      "thị với bên kia; phép tính tiền thật nằm ở `thanhTien` (hàng GIU TEP_TEST).",
  },
  // [S1.9101 / S4.7b1] Số nguyên dương tối đa bốn chữ số, không số 0 đầu — hai việc khác nhau.
  {
    mau: "/^[1-9][0-9]{0,3}$/u",
    ten: "số nguyên dương ≤ 4 chữ số",
    tep: [`${WEB}tao-thau.ts`, "tools/neo-so-kiem-toan/src/canh-moc-neo.ts"],
    xuLy: "RIENG",
    lyDo: "Màn tạo thầu đọc ô số ngày giao yêu cầu (miền 1–3650 của `112_tco`, biên trên kiểm riêng); công cụ neo sổ đọc ngưỡng giờ " +
      "`NGUONG_GIO` của biến môi trường — không phải bản chép, không bên nào đối chiếu với bên kia.",
  },
  {
    mau: "/\\r?\\n/u",
    ten: "tách dòng",
    tep: [`${WEB}du-lieu.ts`, `${PILOT}cum.ts`, `${PILOT}kiem-doc-lap.ts`],
    xuLy: "RIENG",
    lyDo: "Tách một văn bản thành dòng — ba chỗ, ba văn bản khác nhau; không phải bản chép.",
  },
  {
    mau: "/^[0-9a-f]{40}$/",
    ten: "SHA-1 của git (40 hex)",
    tep: ["tools/cap-so/src/index.ts", "tools/inv-matrix/src/danh-gia.ts"],
    xuLy: "RIENG",
    lyDo: "Hình dạng mã commit git mà hai tool đọc từ `git` — hình dạng tự nhiên của dữ liệu, không phải bản chép.",
  },
  {
    mau: "/^[0-9a-f]{64}$/u",
    ten: "hex của SHA-256",
    tep: [`${API}routes/anh-xa.ts`, `${KHOI_TAO}index.ts`, `${KIEM_TRUOC_APPLY}luat.ts`],
    xuLy: "RIENG",
    lyDo: "Băm bản khai đã duyệt (`--bam`) / digest ảnh ECR — hai giá trị khác nhau cùng hình dạng SHA-256. [S1.237 / gộp #217] Và băm " +
      "dòng hạng mục (`bam`) của route ánh xạ (S4.3b) — giá trị thứ ba, cùng hình dạng.",
  },
  {
    mau: "/^\\d+$/",
    ten: "chuỗi toàn chữ số",
    tep: [`${WEB}so-tien.ts`, "tools/cap-so/src/index.ts"],
    xuLy: "RIENG",
    lyDo: "Ô số tiền của trang / số trong tên tệp và dòng khai mà `cap-so` đọc — khác việc.",
  },
];

/** ⑶ Khác tên, cùng việc — tìm bằng tay; cổng chỉ giữ chúng còn ở đúng tệp, phép đo ghi ở `doLuong`. */
const BANG_KHAC_TEN: readonly HangKhacTen[] = [
  {
    ban: [{ ten: "soNguyen", tep: CAU_HINH_API }, { ten: "docSoNguyen", tep: CAU_HINH_WORKER }],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Đọc số nguyên trong miền `[nhoNhat, lonNhat]`, rỗng ⇒ mặc định. `api` đi qua `tuyChon`, worker viết thẳng; cùng regex " +
      "(BANG_MAU). Đo ở mục III kể cả hai biên của miền.",
  },
  {
    ban: [
      { ten: "ghiLogKetNoiHuy", tep: `${API}mo-ta-loi.ts` },
      { ten: "ghiKetNoiHuy", tep: `${WORKER}tien-trinh.ts` },
      // [S1.238 / khoản 280] Bản thứ ba: khuôn worker chép vào job neo ở S1.227 (tiền tố `[neo-so]`).
      { ten: "ghiKetNoiHuy", tep: NEO },
    ],
    xuLy: "GIU",
    doLuong: "KHUON",
    lyDo: "[S1.84 / khoản 129, 173] Bộ nghe `release`: chỉ `TenantError SESSION_STATE_LEFT`, một dòng `ket noi huy <pool> <mô tả>`. " +
      "Hình dạng khác có chủ đích: `api` gắn trong hàm bọc (cổng `pool-nghe-du-tin-hieu` TIN theo đường import `./mo-ta-loi.js`), " +
      "worker trả bộ nghe và gắn tại chỗ dựng pool (cổng ấy đọc lời gọi `.on`). Mục II so ĐIỀU KIỆN và KHUÔN dòng log (bỏ tiền tố " +
      "tiến trình); thân đo bằng hành vi ở hai `loi-ket-noi-toi-muon.int.test.ts` (S1.221). [S1.238 / khoản 280] `tools/neo-so-kiem-toan` " +
      "mang bản thứ ba (khuôn worker, gắn tại chỗ dựng pool); mục II so khuôn của nó cùng hai bản kia — thân của nó chưa có phép đo hành vi.",
  },
  {
    ban: [
      { ten: "ghiLogLoiKetNoiToiMuon", tep: `${API}mo-ta-loi.ts` },
      { ten: "ghiLoiToiMuon", tep: `${WORKER}tien-trinh.ts` },
      { ten: "ghiLoiToiMuon", tep: NEO },
    ],
    xuLy: "GIU",
    doLuong: "KHUON",
    lyDo: "[S1.84 / khoản 129] Bộ nghe lỗi-tới-muộn: một dòng `loi ket noi toi muon <pool> <mô tả>`. Cùng lý do và cùng phép đo với hàng trên.",
  },
];

/** Tên mà mục III thật sự chạy qua (qua các biến chung) — một hàng `HANH_VI` không nằm ở đây là một lời khai không có phép đo. */
const TEN_DO_HANH_VI: ReadonlySet<string> = new Set([
  "docAdapter",
  "docVong",
  "docDatabaseUrl",
  "docThuMucTuyetDoi",
  "tuChoiBienCuaAdapterKhac",
  "soNguyen",
  "docSoNguyen",
]);

// ==============================================================================================
// BỘ QUÉT — cây cú pháp, khai báo mức module và literal regex; tệp theo `git ls-files`.
// ==============================================================================================

interface KhaiBao {
  readonly tep: string;
  readonly loai: LoaiKhaiBao;
  readonly nut: ts.Node;
  readonly sf: ts.SourceFile;
}

interface KetQuaQuet {
  readonly khaiBao: ReadonlyMap<string, readonly KhaiBao[]>;
  readonly mau: ReadonlyMap<string, ReadonlySet<string>>;
  readonly soTep: number;
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: GOC, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Tệp MÃ SẢN XUẤT của một app — bỏ test, bỏ `.d.ts`; `git ls-files` để tệp dò tạm không lọt vào. Mẫu `<tiền tố>*.ts`, KHÔNG
 * `**\/*.ts`: pathspec của git khớp `*` qua cả `/`, còn `src/**\/*.ts` đòi thêm một `/` sau `src/` và bỏ sót mọi tệp ngay
 * trong `src/` (bản đầu của bộ quét mù đúng chỗ ấy — 13/28 tệp của `api`; vế "bộ quét không mù" ghim cả hai tầng).
 */
function tepSanXuat(tienTo: string): string[] {
  return git(["ls-files", "-z", "--", `${tienTo}*.ts`])
    .split("\0")
    .filter((d) => d.startsWith(tienTo) && !d.endsWith(".d.ts") && !/\.(test|int\.test)\.ts$/u.test(d))
    .sort();
}

function quetVanBan(tep: string, vanBan: string, khaiBao: Map<string, KhaiBao[]>, mau: Map<string, Set<string>>): void {
  const sf = ts.createSourceFile(tep, vanBan, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const them = (ten: string, loai: LoaiKhaiBao, nut: ts.Node): void => {
    const ds = khaiBao.get(ten) ?? [];
    ds.push({ tep, loai, nut, sf });
    khaiBao.set(ten, ds);
  };
  for (const cau of sf.statements) {
    if (ts.isFunctionDeclaration(cau) && cau.name !== undefined) them(cau.name.text, "function", cau);
    else if (ts.isClassDeclaration(cau) && cau.name !== undefined) them(cau.name.text, "class", cau);
    else if (ts.isInterfaceDeclaration(cau)) them(cau.name.text, "interface", cau);
    else if (ts.isTypeAliasDeclaration(cau)) them(cau.name.text, "type", cau);
    else if (ts.isEnumDeclaration(cau)) them(cau.name.text, "enum", cau);
    else if (ts.isVariableStatement(cau)) {
      for (const d of cau.declarationList.declarations) if (ts.isIdentifier(d.name)) them(d.name.text, "const", d);
    }
  }
  const duyet = (n: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(n)) {
      const tap = mau.get(n.text) ?? new Set<string>();
      tap.add(tep);
      mau.set(n.text, tap);
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
}

function quetTep(tep: readonly string[]): KetQuaQuet {
  const khaiBao = new Map<string, KhaiBao[]>();
  const mau = new Map<string, Set<string>>();
  for (const t of tep) quetVanBan(t, readFileSync(`${GOC}${t}`, "utf8"), khaiBao, mau);
  return { khaiBao, mau, soTep: tep.length };
}

/**
 * [S1.238 / khoản 280] ĐƠN VỊ của một tệp: `apps/<app>/src/` hay `tools/<tool>/src/`. Tệp ngoài hai dạng ấy (gói chung, văn bản mẫu
 * của đối chứng) là đơn vị của chính nó.
 */
function donViCua(tep: string): string {
  const m = /^(?:apps|tools)\/[^/]+\/src\//u.exec(tep);
  return m === null ? tep : m[0];
}

/**
 * [S1.238 / khoản 280] Tệp MÃ SẢN XUẤT của MỌI đơn vị `apps/*\/src`, `tools/*\/src` — `git ls-files`, cùng lọc với `tepSanXuat` (pathspec
 * `*` khớp qua `/`, nên `apps/*\/src/*.ts` gồm cả thư mục con; vế lọc giữ đúng hình dạng đơn vị). Không `readdirSync` (khoản 189).
 */
function tepSanXuatMoiDonVi(): string[] {
  return git(["ls-files", "-z", "--", "apps/*/src/*.ts", "tools/*/src/*.ts"])
    .split("\0")
    .filter((d) => /^(?:apps|tools)\/[^/]+\/src\//u.test(d) && !d.endsWith(".d.ts") && !/\.(test|int\.test)\.ts$/u.test(d))
    .sort();
}

// ~~`QUET_API`, `QUET_WORKER` — hai lần quét, một mỗi app.~~ [S1.238 / khoản 280] MỘT lần quét mọi đơn vị; tệp mang đường dẫn nên
// mọi phép lọc theo app/tệp đi qua `tep`.
const QUET = quetTep(tepSanXuatMoiDonVi());

function tepCua(ds: readonly KhaiBao[] | undefined): string[] {
  return [...new Set((ds ?? []).map((k) => k.tep))].sort();
}

/** [S1.238 / khoản 280] Tệp test mà hàng `TEP_TEST` trỏ tới: văn bản nếu tệp ĐÃ vào kho, `null` nếu không. */
function docTepTestKho(tep: string): string | null {
  return git(["ls-files", "--", tep]).trim() === tep ? readFileSync(`${GOC}${tep}`, "utf8") : null;
}

// ==============================================================================================
// PHÉP ĐỐI CHIẾU — hàm thuần trên ~~hai kết quả quét~~ [S1.238 / khoản 280] một kết quả quét mọi đơn vị, để đối chứng trong bộ
// nhớ dựng được lần quét giả.
// ==============================================================================================

/** Nhóm các hàng theo khoá, và đòi tập tệp của các hàng cùng khoá RỜI nhau — mỗi tệp thuộc đúng một họ. */
function nhomHo<H extends { readonly tep: readonly string[] }>(bang: readonly H[], khoa: (h: H) => string, ten: string, loi: string[]): Map<string, H[]> {
  const nhom = new Map<string, H[]>();
  for (const h of bang) nhom.set(khoa(h), [...(nhom.get(khoa(h)) ?? []), h]);
  for (const [k, ds] of nhom) {
    const dem = new Map<string, number>();
    for (const h of ds) for (const t of h.tep) dem.set(t, (dem.get(t) ?? 0) + 1);
    for (const [t, n] of dem) if (n > 1) loi.push(`${ten}: tệp ${t} nằm ở ${String(n)} hàng của ${k} — mỗi tệp thuộc đúng một họ`);
  }
  return nhom;
}

function doiChieuTen(
  bang: readonly HangTen[],
  quet: KetQuaQuet,
  goiChung: (tep: string) => KetQuaQuet,
  bangKhacTen: readonly HangKhacTen[] = BANG_KHAC_TEN,
  docTepTest: (tep: string) => string | null = docTepTestKho,
): string[] {
  const loi: string[] = [];
  const hangCua = nhomHo(bang, (h) => `\`${h.ten}\``, "BANG_TEN", loi);
  for (const [ten, ds] of hangCua) if (ds.filter((h) => h.xuLy === "NANG").length > 1) loi.push(`BANG_TEN khai ${ten} NANG hai lần`);
  // ~~Tên có ở api VÀ worker mà không hàng.~~ [S1.238 / khoản 280] Tên khai ở ≥ 2 ĐƠN VỊ: mọi tệp khai nó phải thuộc một hàng.
  for (const [ten, kb] of quet.khaiBao) {
    const donVi = [...new Set(kb.map((k) => donViCua(k.tep)))].sort();
    if (donVi.length < 2) continue;
    const daKhai = new Set((hangCua.get(`\`${ten}\``) ?? []).flatMap((h) => h.tep));
    const chuaKhai = tepCua(kb).filter((t) => !daKhai.has(t));
    if (chuaKhai.length > 0) {
      loi.push(
        `CHƯA KHAI: \`${ten}\` khai ở ${String(donVi.length)} đơn vị (${donVi.join(", ")}) — tệp chưa thuộc hàng nào: ${chuaKhai.join(", ")}. ` +
          "Thêm (hay nới) một hàng BANG_TEN và chọn NANG / GIU (kèm phép đo) / RIENG (kèm lý do).",
      );
    }
  }
  for (const h of bang) {
    const kb = quet.khaiBao.get(h.ten) ?? [];
    if (h.xuLy === "NANG") {
      if (h.tep.length > 0) loi.push(`hàng NANG \`${h.ten}\` ghi tệp hiện tại [${h.tep.join(", ")}] — bản đã nâng không còn ở app; bản cục bộ khác là một họ khác`);
      const donViCu = new Set((h.tepCu ?? []).map(donViCua));
      if (donViCu.size === 0) loi.push(`hàng NANG \`${h.ten}\` không ghi tệp cũ (tepCu) — không biết bản chép từng ở đâu`);
      const mocLai = kb.filter((k) => donViCu.has(donViCua(k.tep)));
      if (mocLai.length > 0) loi.push(`hàng NANG \`${h.ten}\` MỌC LẠI ở app — ${tepCua(mocLai).join(", ")}`);
      if (h.goiChung === undefined) loi.push(`hàng NANG \`${h.ten}\` không ghi tệp gói chung`);
      else if (!goiChung(h.goiChung).khaiBao.has(h.ten)) loi.push(`hàng NANG \`${h.ten}\`: ${h.goiChung} không khai tên ấy`);
      if (h.mauKemTheo !== undefined) {
        const conO = [...(quet.mau.get(h.mauKemTheo) ?? [])].filter((t) => donViCu.has(donViCua(t))).sort();
        if (conO.length > 0) loi.push(`hàng NANG \`${h.ten}\`: literal ${h.mauKemTheo} còn ở app — ${conO.join(", ")}`);
        if (h.goiChung !== undefined && !goiChung(h.goiChung).mau.has(h.mauKemTheo)) {
          loi.push(`hàng NANG \`${h.ten}\`: ${h.goiChung} không mang literal ${h.mauKemTheo}`);
        }
      }
      if (h.doLuong !== "KHONG") loi.push(`hàng NANG \`${h.ten}\` không mang phép đo (một bản thì không có gì để trôi)`);
      continue;
    }
    if (h.tep.length === 0) loi.push(`hàng \`${h.ten}\` (${h.xuLy}) không ghi tệp nào`);
    // ~~So tập tệp mỗi bên.~~ [S1.238 / khoản 280] Mỗi tệp của hàng còn khai tên ấy (hàng thiu); tệp khai mà chưa thuộc hàng nào thì
    // vế CHƯA KHAI trên đã nêu.
    for (const t of h.tep) if (!kb.some((k) => k.tep === t)) loi.push(`hàng \`${h.ten}\`: ${t} không còn khai tên ấy — bảng ghi [${h.tep.join(", ")}]`);
    const loaiThat = new Set(kb.filter((k) => h.tep.includes(k.tep)).map((k) => k.loai));
    if (loaiThat.size > 1 || (loaiThat.size === 1 && !loaiThat.has(h.loai))) loi.push(`hàng \`${h.ten}\`: loại ${h.loai} nhưng thấy ${[...loaiThat].join("/")}`);
    if (h.xuLy === "GIU" && h.tep.length < 2) loi.push(`hàng GIU \`${h.ten}\` chỉ một tệp — không có gì để so`);
    if (h.xuLy === "GIU" && h.doLuong === "KHONG") loi.push(`hàng GIU \`${h.ten}\` KHÔNG có phép đo — giữ hai bản thì phải đo chống trôi`);
    if (h.xuLy === "RIENG" && h.doLuong !== "KHONG") loi.push(`hàng RIENG \`${h.ten}\` khai phép đo — riêng thì không có gì để so`);
    if (h.doLuong === "HANH_VI" && !TEN_DO_HANH_VI.has(h.ten)) loi.push(`hàng \`${h.ten}\` khai HANH_VI nhưng mục III không chạy qua nó`);
    if (h.doLuong === "KHUON") {
      for (const t of h.tep) {
        if (!bangKhacTen.some((k) => k.doLuong === "KHUON" && k.ban.some((b) => b.ten === h.ten && b.tep === t))) {
          loi.push(`hàng \`${h.ten}\` khai KHUON nhưng ${t} không nằm trong cặp KHUON nào của BANG_KHAC_TEN — mục II không so nó`);
        }
      }
    }
    if (h.doLuong === "TEP_TEST") {
      if ((h.tepTest ?? []).length === 0) loi.push(`hàng \`${h.ten}\` khai TEP_TEST mà không ghi tệp test nào`);
      for (const t of h.tepTest ?? []) {
        const vb = docTepTest(t);
        if (vb === null) loi.push(`hàng \`${h.ten}\`: tệp test ${t} không có trong kho — phép đo trỏ vào chỗ trống`);
        else if (!vb.includes(h.ten)) loi.push(`hàng \`${h.ten}\`: tệp test ${t} không nhắc tên ấy — không đo nó`);
      }
    }
  }
  return loi;
}

function doiChieuMau(bang: readonly HangMau[], quet: KetQuaQuet): string[] {
  const loi: string[] = [];
  const hangCua = nhomHo(bang, (h) => h.mau, "BANG_MAU", loi);
  // ~~Literal có ở api VÀ worker mà không hàng.~~ [S1.238 / khoản 280] Literal ở ≥ 2 ĐƠN VỊ: mọi tệp mang nó phải thuộc một hàng.
  for (const [mau, tap] of quet.mau) {
    const donVi = [...new Set([...tap].map(donViCua))].sort();
    if (donVi.length < 2) continue;
    const daKhai = new Set((hangCua.get(mau) ?? []).flatMap((h) => h.tep));
    const chuaKhai = [...tap].sort().filter((t) => !daKhai.has(t));
    if (chuaKhai.length > 0) {
      loi.push(`CHƯA KHAI: literal ${mau} ở ${String(donVi.length)} đơn vị (${donVi.join(", ")}) — tệp chưa thuộc hàng nào: ${chuaKhai.join(", ")}. Thêm (hay nới) một hàng BANG_MAU.`);
    }
  }
  for (const h of bang) {
    const tap = quet.mau.get(h.mau) ?? new Set<string>();
    if (h.tep.length === 0) loi.push(`hàng mẫu \`${h.ten}\` không ghi tệp nào`);
    for (const t of h.tep) if (!tap.has(t)) loi.push(`hàng mẫu \`${h.ten}\`: ${t} không còn mang literal — bảng ghi [${h.tep.join(", ")}]`);
    if (h.xuLy === "GIU" && h.tep.length < 2) loi.push(`hàng mẫu GIU \`${h.ten}\` chỉ một tệp — không có gì để giữ giống`);
  }
  return loi;
}

function doiChieuKhacTen(bang: readonly HangKhacTen[], quet: KetQuaQuet): string[] {
  const loi: string[] = [];
  for (const h of bang) {
    const ten = h.ban.map((b) => `\`${b.ten}\``).join("/");
    if (h.ban.length < 2) loi.push(`cặp khác tên ${ten}: cần hai bản trở lên`);
    for (const b of h.ban) if (!(quet.khaiBao.get(b.ten) ?? []).some((k) => k.tep === b.tep)) loi.push(`cặp khác tên: \`${b.ten}\` không còn ở ${b.tep}`);
    if (h.doLuong === "HANH_VI" && !h.ban.every((b) => TEN_DO_HANH_VI.has(b.ten))) loi.push(`cặp khác tên ${ten} khai HANH_VI nhưng mục III không chạy qua`);
  }
  return loi;
}

const QUET_GOI_CHUNG = new Map<string, KetQuaQuet>();
function quetGoiChung(tep: string): KetQuaQuet {
  const co = QUET_GOI_CHUNG.get(tep);
  if (co !== undefined) return co;
  const kq = quetTep([tep]);
  QUET_GOI_CHUNG.set(tep, kq);
  return kq;
}

describe("[S1.224 / khoản 187] bảng kiểm kê mã chép api ↔ worker — đóng, và cổng giữ nó", () => {
  it("bộ quét không mù: thấy đủ tệp sản xuất và những khai báo đã biết ở cả hai app", () => {
    // ~~`QUET_API.soTep`, `QUET_WORKER.soTep`~~ [S1.238 / khoản 280] một lần quét; đếm theo tiền tố.
    expect(tepSanXuat(API).length).toBeGreaterThanOrEqual(25);
    expect(tepSanXuat(WORKER).length).toBeGreaterThanOrEqual(8);
    // Cả tệp ngay trong `src/` lẫn tệp ở thư mục con — hai tầng mà một glob sai bỏ sót một tầng.
    expect(tepSanXuat(API)).toEqual(expect.arrayContaining([CAU_HINH_API, MAIN_API, `${API}adapters/gui-ses.ts`, `${API}routes/guest.ts`]));
    expect(tepSanXuat(WORKER)).toEqual(expect.arrayContaining([CAU_HINH_WORKER, MAIN_WORKER, `${WORKER}adapters/canh-bao-ses.ts`]));
    expect(tepSanXuat(API).some((t) => /\.test\.ts$/u.test(t))).toBe(false);
    for (const ten of ["docCauHinh", "moTaLoi", "CauHinhError", "EMAIL"]) {
      expect(QUET.khaiBao.get(ten)?.some((k) => k.tep.startsWith(API)), `api: ${ten}`).toBe(true);
      expect(QUET.khaiBao.get(ten)?.some((k) => k.tep.startsWith(WORKER)), `worker: ${ten}`).toBe(true);
    }
    expect([...(QUET.mau.get("/^\\d{1,9}$/u") ?? [])].sort()).toEqual([CAU_HINH_API, CAU_HINH_WORKER]);
  });

  it("[S1.238 / khoản 280] bộ quét không mù ở N đơn vị: đủ năm app, các tool mang mã, tệp ở cả `src/` lẫn thư mục con; `moTaLoi` thấy ở năm điểm vào", () => {
    const tep = tepSanXuatMoiDonVi();
    const donVi = new Set(tep.map(donViCua));
    for (const d of [API, WORKER, MCP, WEB, PUBLIC_KEYS, BO_XUAT, KHOI_TAO, PILOT, KIEM_TRUOC_APPLY, "tools/neo-so-kiem-toan/src/"]) {
      expect(donVi.has(d), `thiếu đơn vị ${d}`).toBe(true);
    }
    // Không sàn theo con số hôm nay: đòi mỗi đơn vị quét thấy là một `apps/<x>/src/` hay `tools/<x>/src/` có thật và không tệp test lọt vào.
    for (const d of donVi) expect(d, "đơn vị lạ").toMatch(/^(?:apps|tools)\/[a-z0-9-]+\/src\/$/u);
    expect(tep.some((t) => /\.test\.ts$|\.d\.ts$/u.test(t))).toBe(false);
    expect(tep).toEqual(expect.arrayContaining([`${MCP}main.ts`, `${PILOT}http.ts`, `${API}routes/anon.ts`]));
    expect(QUET.soTep).toBe(tep.length);
    expect(tepCua(QUET.khaiBao.get("moTaLoi")).filter((t) => t.endsWith("/main.ts"))).toEqual(
      [MAIN_API, `${MCP}main.ts`, `${PUBLIC_KEYS}main.ts`, MAIN_WORKER, `${WEB}main.ts`].sort(),
    );
  });

  it("⑴ mọi khai báo cùng tên ở hai app đều có hàng, và mọi hàng đều còn đúng (tệp, loại, cách xử lý, phép đo; NANG không mọc lại)", () => {
    expect(doiChieuTen(BANG_TEN, QUET, quetGoiChung)).toEqual([]);
  });

  it("⑵ mọi biểu thức chính quy chung của hai app đều có hàng, và tập tệp của mỗi hàng còn đúng", () => {
    expect(doiChieuMau(BANG_MAU, QUET)).toEqual([]);
  });

  it("⑶ mọi cặp khác tên còn ở đúng tệp, và cặp khai HANH_VI được mục III chạy qua", () => {
    expect(doiChieuKhacTen(BANG_KHAC_TEN, QUET)).toEqual([]);
  });

  /** Lần quét GIẢ: bản sao của lần quét thật, cộng các tệp mẫu (đường dẫn, văn bản). */
  const quetGia = (...them: readonly (readonly [string, string])[]): KetQuaQuet => {
    const khaiBao = new Map<string, KhaiBao[]>();
    const mau = new Map<string, Set<string>>();
    for (const [k, v] of QUET.khaiBao) khaiBao.set(k, [...v]);
    for (const [k, v] of QUET.mau) mau.set(k, new Set(v));
    for (const [tep, vanBan] of them) quetVanBan(tep, vanBan, khaiBao, mau);
    return { khaiBao, mau, soTep: QUET.soTep + them.length };
  };

  it("đối chứng trong bộ nhớ: một hàm chép sang worker, một literal chép sang worker, một hàng thiu, một NANG mọc lại — mỗi thứ một dòng đỏ", () => {
    const workerGia = quetGia([
      `${WORKER}adapters/canh-bao-ses.ts`,
      'export function laDiaChiEmail(s: string): boolean { return s.length <= 320; }\nconst NHAN_KMS = /^[A-Za-z0-9._:-]{1,64}$/u;\nconst MA_NAM_KY_TU = /^[0-9A-Z]{5}$/u;\n',
    ]);
    // `laDiaChiEmail` có thật ở `api` (gui-ses.ts); `NHAN_KMS` literal có thật ở `api`; `MA_NAM_KY_TU` là hàng NANG.
    const loiTen = doiChieuTen(BANG_TEN, workerGia, quetGoiChung);
    expect(loiTen.filter((l) => l.includes("CHƯA KHAI") && l.includes("`laDiaChiEmail`"))).toHaveLength(1);
    expect(loiTen.filter((l) => l.includes("MỌC LẠI") && l.includes("`MA_NAM_KY_TU`"))).toHaveLength(1);
    expect(loiTen.filter((l) => l.includes("literal /^[0-9A-Z]{5}$/u còn ở app"))).toHaveLength(1);
    const loiMau = doiChieuMau(BANG_MAU, workerGia);
    expect(loiMau.filter((l) => l.includes("CHƯA KHAI") && l.includes("/^[A-Za-z0-9._:-]{1,64}$/u"))).toHaveLength(1);
    // Hàng thiu: bảng ghi một tệp không còn khai — đỏ; hàng GIU không phép đo — đỏ; hàng khác tên trỏ tên không có — đỏ.
    const hangMoTaLoi = BANG_TEN.find((h) => h.ten === "moTaLoi" && h.tep.includes(MAIN_API))!;
    // ~~`api: [khong-co.ts]`~~ [S1.238 / khoản 280] thêm một tệp không khai vào họ.
    const thiu: HangTen = { ...hangMoTaLoi, tep: [...hangMoTaLoi.tep, `${API}khong-co.ts`] };
    expect(doiChieuTen([thiu], QUET, quetGoiChung).some((l) => l.includes("apps/api/src/khong-co.ts không còn khai tên ấy"))).toBe(true);
    const khongDo: HangTen = { ...hangMoTaLoi, doLuong: "KHONG" };
    expect(doiChieuTen([khongDo], QUET, quetGoiChung).some((l) => l.includes("KHÔNG có phép đo"))).toBe(true);
    const capThiu: HangKhacTen = { ...BANG_KHAC_TEN[0]!, ban: [BANG_KHAC_TEN[0]!.ban[0]!, { ten: "docSoNguyenCu", tep: CAU_HINH_WORKER }] };
    expect(doiChieuKhacTen([capThiu], QUET).some((l) => l.includes("`docSoNguyenCu` không còn"))).toBe(true);
  });

  it("[S1.238 / khoản 280] đối chứng N đơn vị: bản chép ở một đơn vị MỚI ⇒ CHƯA KHAI nêu tệp; hai tệp một đơn vị ⇒ không đòi hàng; một literal chép sang đơn vị mới ⇒ đỏ", () => {
    const donViMoi = quetGia(
      ["apps/moi/src/main.ts", 'function moTaLoi(e: unknown): string { return String(e); }\nconst NHOM = /\\B(?=(\\d{3})+(?!\\d))/gu;\nvoid NHOM;\n'],
      ["apps/moi/src/a.ts", "export const MOT_DON_VI_A1 = 1;\n"],
      ["apps/moi/src/b.ts", "export const MOT_DON_VI_A1 = 2;\n"],
    );
    const loiTen = doiChieuTen(BANG_TEN, donViMoi, quetGoiChung);
    expect(loiTen.filter((l) => l.startsWith("CHƯA KHAI: `moTaLoi`") && l.includes("tệp chưa thuộc hàng nào: apps/moi/src/main.ts"))).toHaveLength(1);
    expect(loiTen.some((l) => l.includes("MOT_DON_VI_A1")), "tên trùng trong MỘT đơn vị không đòi hàng").toBe(false);
    expect(doiChieuMau(BANG_MAU, donViMoi).filter((l) => l.startsWith("CHƯA KHAI: literal /\\B(?=(\\d{3})+(?!\\d))/gu") && l.includes("apps/moi/src/main.ts"))).toHaveLength(1);
    // Bản đầu của bộ quét N đơn vị trên văn bản thật: năm tệp `main.ts` mang `moTaLoi`; bỏ một tệp khỏi họ thì tệp ấy CHƯA KHAI.
    const hangMoTaLoi = BANG_TEN.find((h) => h.ten === "moTaLoi" && h.tep.includes(MAIN_API))!;
    const thieuWeb: HangTen = { ...hangMoTaLoi, tep: hangMoTaLoi.tep.filter((t) => t !== `${WEB}main.ts`) };
    expect(doiChieuTen([...BANG_TEN.filter((h) => h !== hangMoTaLoi), thieuWeb], QUET, quetGoiChung)).toEqual([
      expect.stringMatching(/^CHƯA KHAI: `moTaLoi` khai ở 5 đơn vị .*tệp chưa thuộc hàng nào: apps\/web\/src\/main\.ts\./u),
    ]);
  });

  it("[S1.238 / khoản 280] đối chứng hình dạng bảng: hai họ giữ chung một tệp; họ GIU một tệp; KHUON không nằm ở BANG_KHAC_TEN; TEP_TEST trỏ tệp không có hay không nhắc tên; NANG ghi tệp hiện tại", () => {
    const hangMoTaLoi = BANG_TEN.find((h) => h.ten === "moTaLoi" && h.tep.includes(MAIN_API))!;
    /** Bảng THẬT với đúng một hàng thay — để lỗi in ra là lỗi của hàng ấy, không phải của một bảng thiếu. */
    const thay = (moi: HangTen, cu: HangTen = hangMoTaLoi): readonly HangTen[] => BANG_TEN.map((h) => (h === cu ? moi : h));
    const chong: HangTen = { ...hangMoTaLoi, xuLy: "RIENG", doLuong: "KHONG", tep: [MAIN_API] };
    expect(doiChieuTen([...BANG_TEN, chong], QUET, quetGoiChung)).toEqual(["BANG_TEN: tệp apps/api/src/main.ts nằm ở 2 hàng của `moTaLoi` — mỗi tệp thuộc đúng một họ"]);
    expect(doiChieuTen(thay({ ...hangMoTaLoi, tep: [MAIN_API] }), QUET, quetGoiChung)).toContain("hàng GIU `moTaLoi` chỉ một tệp — không có gì để so");
    const khuon = doiChieuTen(thay({ ...hangMoTaLoi, doLuong: "KHUON" }), QUET, quetGoiChung);
    expect(khuon).toHaveLength(hangMoTaLoi.tep.length);
    for (const l of khuon) expect(l).toMatch(/^hàng `moTaLoi` khai KHUON nhưng .* không nằm trong cặp KHUON nào của BANG_KHAC_TEN/u);
    const tepTest: HangTen = { ...hangMoTaLoi, doLuong: "TEP_TEST", tepTest: ["apps/web/src/khong-co.test.ts", "apps/web/src/so-tien.test.ts"] };
    // Bộ đọc THẬT: tệp chưa vào kho ⇒ `null`; `so-tien.test.ts` có thật nhưng không nhắc `moTaLoi`.
    expect(doiChieuTen(thay(tepTest), QUET, quetGoiChung)).toEqual([
      "hàng `moTaLoi`: tệp test apps/web/src/khong-co.test.ts không có trong kho — phép đo trỏ vào chỗ trống",
      "hàng `moTaLoi`: tệp test apps/web/src/so-tien.test.ts không nhắc tên ấy — không đo nó",
    ]);
    // Đối chứng dương của `TEP_TEST` trên kho thật: hàng `thanhTien` đọc hai tệp test THẬT (vế ⑴ xanh ở trên) — ở đây đòi bộ đọc thật
    // trả văn bản cho tệp đã vào kho và `null` cho tệp không có.
    expect(docTepTestKho(`${WEB}so-tien.test.ts`)).toContain("thanhTien");
    expect(docTepTestKho(`${WEB}khong-co.test.ts`)).toBeNull();
    const nang = BANG_TEN.find((h) => h.ten === "moTaMotTang")!;
    expect(doiChieuTen(thay({ ...nang, tep: [MAIN_API] }, nang), QUET, quetGoiChung)).toEqual([
      "hàng NANG `moTaMotTang` ghi tệp hiện tại [apps/api/src/main.ts] — bản đã nâng không còn ở app; bản cục bộ khác là một họ khác",
    ]);
  });

  it("bộ quét tự kiểm: sáu loại khai báo mức module được thấy; khai báo trong thân hàm, tên trong chú thích và trong chuỗi thì không", () => {
    const khaiBao = new Map<string, KhaiBao[]>();
    const mau = new Map<string, Set<string>>();
    quetVanBan(
      "mau.ts",
      [
        "// function trongChuThich() {}",
        'const CHUOI = "function trongChuoi() {}";',
        "export function ham(): void { const benTrong = 1; function lồng(): void {} void benTrong; }",
        "class Lop {}",
        "interface GiaoDien { a: number }",
        "type BiDanh = string;",
        "enum Liet { A }",
        "let bien = /^x$/u;",
      ].join("\n"),
      khaiBao,
      mau,
    );
    expect([...khaiBao.keys()].sort()).toEqual(["BiDanh", "CHUOI", "GiaoDien", "Liet", "Lop", "bien", "ham"]);
    expect(khaiBao.get("Lop")?.[0]?.loai).toBe("class");
    expect(khaiBao.get("bien")?.[0]?.loai).toBe("const");
    expect([...mau.keys()]).toEqual(["/^x$/u"]);
  });
});

// ==============================================================================================
// II. PHÉP ĐO CHỐNG TRÔI — VĂN BẢN. Hàng `GIU` + `VAN_BAN`: khai báo hai bên trùng TỪNG KÝ TỰ sau khi bỏ `export`. Hai cặp bộ nghe
// pool: so ĐIỀU KIỆN lọc và KHUÔN dòng log (đầu, các đoạn chữ, hình dạng từng biểu thức), bỏ tiền tố tiến trình.
// [S1.238 / khoản 280] ~~hai bên~~ MỌI tệp của họ trùng từng ký tự với tệp đầu; hai "cặp" bộ nghe nay là hai HỌ (thêm bản của
// `tools/neo-so-kiem-toan`), mỗi bản cùng khuôn mong đợi.
// ==============================================================================================

function khaiBaoDuyNhat(q: KetQuaQuet, ten: string, tep: string): KhaiBao {
  const ds = (q.khaiBao.get(ten) ?? []).filter((k) => k.tep === tep);
  if (ds.length !== 1) throw new Error(`${tep} phải khai \`${ten}\` đúng một lần, thấy ${String(ds.length)}`);
  return ds[0]!;
}

function vanBanKhaiBao(k: KhaiBao): string {
  return k.nut.getText(k.sf).replace(/^export\s+(?:default\s+)?/u, "");
}

/** Điều kiện `if` đầu tiên và khuôn của lời `console.error(\`…\`)` đầu tiên trong một khai báo. */
interface KhuonBoNghe {
  readonly dieuKien: string | null;
  readonly doanChu: readonly string[];
  readonly bieuThuc: readonly string[];
}

function hinhDangBieuThuc(e: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isIdentifier(e)) return "<tên>";
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.arguments.length === 1 && ts.isIdentifier(e.arguments[0]!)) {
    return `${e.expression.text}(<tên>)`;
  }
  return e.getText(sf);
}

function khuonBoNghe(k: KhaiBao): KhuonBoNghe {
  let dieuKien: string | null = null;
  let mau: ts.TemplateExpression | null = null;
  const duyet = (n: ts.Node): void => {
    if (dieuKien === null && ts.isIfStatement(n)) dieuKien = n.expression.getText(k.sf);
    if (mau === null && ts.isCallExpression(n) && n.expression.getText(k.sf) === "console.error") {
      const doiSo = n.arguments[0];
      if (doiSo !== undefined && ts.isTemplateExpression(doiSo)) mau = doiSo;
    }
    ts.forEachChild(n, duyet);
  };
  duyet(k.nut);
  if (mau === null) throw new Error(`${k.tep}: không thấy console.error(\`…\`) trong khai báo`);
  const m: ts.TemplateExpression = mau;
  return {
    dieuKien,
    // [S1.238 / khoản 280] Thêm tiền tố `[neo-so]` (bản thứ ba của khuôn bộ nghe worker). Danh sách ĐÓNG — một tiền tố gõ sai vẫn đỏ.
    doanChu: [m.head.text.replace(/^\[(?:api|unseal-worker|neo-so)\] /u, "[<tiến trình>] "), ...m.templateSpans.map((s) => s.literal.text)],
    bieuThuc: m.templateSpans.map((s) => hinhDangBieuThuc(s.expression, k.sf)),
  };
}

describe("[S1.224 / khoản 187] phép đo chống trôi — văn bản của các cặp GIU", () => {
  const hangVanBan = BANG_TEN.filter((h) => h.xuLy === "GIU" && h.doLuong === "VAN_BAN");

  // ~~"… và mỗi hàng khai đúng một tệp mỗi bên"~~ [S1.238 / khoản 280] mỗi họ khai hai tệp trở lên.
  it("có hàng VAN_BAN để đo, và mỗi hàng khai hai tệp trở lên", () => {
    // Không sàn theo con số hôm nay (một sàn đặt đúng bằng hiện trạng không bao giờ kêu): chỉ đòi có thứ để đo, và vế `it.each`
    // dưới là một test cho MỖI hàng — hàng nào biến mất thì mục I đã đỏ ở "hàng thiu".
    expect(hangVanBan.length).toBeGreaterThan(0);
    for (const h of hangVanBan) expect(h.tep.length, h.ten).toBeGreaterThanOrEqual(2);
  });

  // ~~"khai báo ở api và ở worker trùng từng ký tự"~~ [S1.238 / khoản 280] mọi tệp của họ trùng với tệp đầu; tên test mang tệp đầu để
  // hai họ cùng tên (`moTaLoi`, `UUID`…) là hai test phân biệt được.
  it.each(hangVanBan.map((h) => ({ ten: h.ten, dau: h.tep[0]!, h })))("`$ten` ($dau …): mọi tệp của họ trùng từng ký tự (bỏ `export`)", ({ h }) => {
    const [dau, ...conLai] = h.tep;
    const mau = vanBanKhaiBao(khaiBaoDuyNhat(QUET, h.ten, dau!));
    for (const t of conLai) expect(vanBanKhaiBao(khaiBaoDuyNhat(QUET, h.ten, t)), `${t} lệch ${dau!}`).toBe(mau);
  });

  /** [S1.238 / khoản 280] Họ bộ nghe ở `BANG_KHAC_TEN` có bản `api` tên `tenApi` — mọi bản của nó, theo thứ tự khai. */
  const hoBoNghe = (tenApi: string): readonly { readonly ten: string; readonly tep: string }[] => {
    const h = BANG_KHAC_TEN.find((x) => x.doLuong === "KHUON" && x.ban.some((b) => b.ten === tenApi));
    if (h === undefined) throw new Error(`BANG_KHAC_TEN không có họ KHUON chứa ${tenApi}`);
    return h.ban;
  };

  it("bộ nghe `release`: `ghiLogKetNoiHuy` (api) và `ghiKetNoiHuy` (worker) cùng điều kiện lọc và cùng khuôn dòng log", () => {
    const mongDoi: KhuonBoNghe = {
      dieuKien: 'loi instanceof TenantError && loi.code === "SESSION_STATE_LEFT"',
      doanChu: ["[<tiến trình>] ket noi huy ", " ", ""],
      bieuThuc: ["<tên>", "moTaLoiKhongGiaTri(<tên>)"],
    };
    // ~~hai bản `a`, `w`~~ [S1.238 / khoản 280] mọi bản của họ (api, worker, neo-so-kiem-toan).
    const ban = hoBoNghe("ghiLogKetNoiHuy");
    expect(ban.length).toBeGreaterThanOrEqual(2);
    for (const b of ban) expect(khuonBoNghe(khaiBaoDuyNhat(QUET, b.ten, b.tep)), `${b.tep}: ${b.ten}`).toEqual(mongDoi);
  });

  it("bộ nghe lỗi-tới-muộn: `ghiLogLoiKetNoiToiMuon` (api) và `ghiLoiToiMuon` (worker) cùng khuôn dòng log, không lọc", () => {
    const mongDoi: KhuonBoNghe = {
      dieuKien: null,
      doanChu: ["[<tiến trình>] loi ket noi toi muon ", " ", ""],
      bieuThuc: ["<tên>", "moTaLoiKhongGiaTri(<tên>)"],
    };
    const ban = hoBoNghe("ghiLogLoiKetNoiToiMuon");
    expect(ban.length).toBeGreaterThanOrEqual(2);
    for (const b of ban) expect(khuonBoNghe(khaiBaoDuyNhat(QUET, b.ten, b.tep)), `${b.tep}: ${b.ten}`).toEqual(mongDoi);
  });

  it("đối chứng: bộ đọc khuôn thấy tiền tố tiến trình khác nhau là MỘT khuôn, nhưng thấy một chữ đổi trong dòng là khuôn KHÁC", () => {
    const doc = (vanBan: string): KhuonBoNghe => {
      const kb = new Map<string, KhaiBao[]>();
      quetVanBan("mau.ts", vanBan, kb, new Map());
      return khuonBoNghe(kb.get("f")![0]!);
    };
    const api = doc("function f(p: string): void { console.error(`[api] loi ket noi toi muon ${p} ${moTaLoiKhongGiaTri(e)}`); }");
    const worker = doc("const f = (ten: string) => (loi: unknown): void => { console.error(`[unseal-worker] loi ket noi toi muon ${ten} ${moTaLoiKhongGiaTri(loi)}`); };");
    expect(worker).toEqual(api);
    const lech = doc("const f = (ten: string) => (loi: unknown): void => { console.error(`[unseal-worker] loi ket noi tre ${ten} ${moTaLoiKhongGiaTri(loi)}`); };");
    expect(lech).not.toEqual(api);
  });
});

// ==============================================================================================
// III. PHÉP ĐO CHỐNG TRÔI — HÀNH VI. Hai `docCauHinh` là hai hợp đồng, nhưng chúng đọc CHUNG một tập biến (khoá tổ chức, KMS, SES, số
// nhịp/ngưỡng, URL CSDL). Một giá trị cho một biến chung phải được cả hai NHẬN (và đọc ra cùng giá trị) hay cả hai TỪ CHỐI bằng
// `CauHinhError` nêu tên biến, không nêu giá trị — vì cùng một tệp biến môi trường đi vào cả hai task ECS. Nạp hai mô-đun bằng
// dynamic import với đường dẫn dựng từ biến: KHÔNG tạo cạnh phụ thuộc cho depcruise (cùng cách `barrel-exports.test.ts`), và tệp này
// không import gì từ `apps/`.
// ==============================================================================================

type MoiTruong = Readonly<Record<string, string | undefined>>;
type DocCauHinh = (env: MoiTruong) => Record<string, unknown>;
type Canh = "local-dev" | "aws-kms" | "ses";

async function napDocCauHinh(tep: string): Promise<DocCauHinh> {
  const m = (await import(/* @vite-ignore */ new URL(tep, new URL("../../", import.meta.url)).href)) as { docCauHinh?: unknown };
  if (typeof m.docCauHinh !== "function") throw new Error(`${tep} không xuất docCauHinh`);
  return m.docCauHinh as DocCauHinh;
}

const BI_MAT = {
  master: randomBytes(32).toString("base64"),
  master2: randomBytes(32).toString("base64"),
  master16: randomBytes(16).toString("base64"),
  totp: randomBytes(32).toString("base64"),
  pepper: randomBytes(32).toString("base64"),
  ky: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
};

function envApi(canh: Canh): Record<string, string | undefined> {
  const chung: Record<string, string | undefined> = {
    TRUSTPROCURE_DATABASE_URL: "postgres://app_api_login:mk@127.0.0.1:5432/trustprocure",
    TRUSTPROCURE_PUBLIC_BASE_URL: "https://mua.vidu.vn",
    TRUSTPROCURE_TRUSTED_PROXIES: "direct",
    TRUSTPROCURE_OTP_PEPPERS: `p1=${BI_MAT.pepper}`,
    TRUSTPROCURE_OTP_PEPPER_ACTIVE: "p1",
    TRUSTPROCURE_SENDER_ADAPTER: "dev-mailbox",
    TRUSTPROCURE_DEV_MAILBOX_DIR: "/tmp/trustprocure-hop-thu-dev",
  };
  const khoaLocalDev: Record<string, string | undefined> = {
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${BI_MAT.master}`,
    TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
    TRUSTPROCURE_TOTP_MASTER_KEYS: `t1=${BI_MAT.totp}`,
    TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE: "t1",
    TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `ky-2026=${BI_MAT.ky}`,
    TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "ky-2026",
  };
  if (canh === "aws-kms") {
    return {
      ...chung,
      TRUSTPROCURE_KEY_ADAPTER: "aws-kms",
      TRUSTPROCURE_AWS_REGION: "ap-southeast-1",
      TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID: "alias/tp-org-wrap",
      TRUSTPROCURE_KMS_ORG_KEY_VERSION: "kms-1",
      TRUSTPROCURE_KMS_TOTP_KEY_ID: "alias/tp-totp",
      TRUSTPROCURE_KMS_TOTP_KEY_VERSION: "kms-totp-1",
      TRUSTPROCURE_KMS_RECEIPT_KEY_ID: "alias/tp-receipt-sign",
      TRUSTPROCURE_KMS_RECEIPT_KID: "kms-2026-09",
    };
  }
  if (canh === "ses") {
    return {
      ...chung,
      ...khoaLocalDev,
      TRUSTPROCURE_SENDER_ADAPTER: "ses",
      TRUSTPROCURE_DEV_MAILBOX_DIR: undefined,
      TRUSTPROCURE_SES_REGION: "ap-southeast-1",
      TRUSTPROCURE_SES_FROM: "thu@vidu.vn",
    };
  }
  return { ...chung, ...khoaLocalDev };
}

function envWorker(canh: Canh): Record<string, string | undefined> {
  const chung: Record<string, string | undefined> = {
    TRUSTPROCURE_DATABASE_URL: "postgres://app_unseal_login:mk@127.0.0.1:5432/trustprocure",
    TRUSTPROCURE_ALERT_ADAPTER: "dev-file",
    TRUSTPROCURE_ALERT_DIR: "/tmp/trustprocure-canh-bao-dev",
  };
  const khoaLocalDev: Record<string, string | undefined> = {
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${BI_MAT.master}`,
    TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
  };
  if (canh === "aws-kms") {
    return {
      ...chung,
      TRUSTPROCURE_KEY_ADAPTER: "aws-kms",
      TRUSTPROCURE_AWS_REGION: "ap-southeast-1",
      TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID: "alias/tp-org-wrap",
    };
  }
  if (canh === "ses") {
    return {
      ...chung,
      ...khoaLocalDev,
      TRUSTPROCURE_ALERT_ADAPTER: "ses",
      TRUSTPROCURE_ALERT_DIR: undefined,
      TRUSTPROCURE_SES_REGION: "ap-southeast-1",
      TRUSTPROCURE_SES_FROM: "thu@vidu.vn",
      TRUSTPROCURE_ALERT_EMAILS: "a@vidu.vn",
    };
  }
  return { ...chung, ...khoaLocalDev };
}

type KetQuaDoc = { readonly ok: true; readonly ch: Record<string, unknown> } | { readonly ok: false; readonly loi: unknown };

function chay(doc: DocCauHinh, env: MoiTruong): KetQuaDoc {
  try {
    return { ok: true, ch: doc(env) };
  } catch (loi) {
    return { ok: false, loi };
  }
}

function lay(ch: Record<string, unknown>, ...duong: readonly string[]): unknown {
  let x: unknown = ch;
  for (const k of duong) {
    if (typeof x !== "object" || x === null) return undefined;
    x = (x as Record<string, unknown>)[k];
  }
  return x;
}

interface CaChung {
  /** Nhãn cho tên test — KHÔNG in giá trị (giá trị có thể là khoá). */
  readonly nhan: string;
  readonly bien: string;
  /** Khi hai bên đọc cùng một việc qua hai TÊN biến khác nhau (thư mục tuyệt đối). */
  readonly bienWorker?: string;
  readonly giaTri: string | undefined;
  readonly canh: Canh;
  readonly mongDoi: "NHAN" | "TU_CHOI";
  /** NHAN: giá trị đọc ra phải bằng nhau ở hai bên. */
  readonly doc?: (ch: Record<string, unknown>) => unknown;
}

const CAC_CA: readonly CaChung[] = [
  // soNguyen / docSoNguyen — biên miền, rỗng ⇒ mặc định, chữ, số 0 đầu.
  { nhan: "DB_POOL_MAX=3", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "3", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["dbPoolMax"] },
  { nhan: "DB_POOL_MAX=1 (biên dưới)", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "1", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["dbPoolMax"] },
  { nhan: "DB_POOL_MAX=100 (biên trên)", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "100", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["dbPoolMax"] },
  { nhan: "DB_POOL_MAX=007", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "007", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["dbPoolMax"] },
  { nhan: "DB_POOL_MAX rỗng ⇒ mặc định", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "  ", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["dbPoolMax"] },
  { nhan: "DB_POOL_MAX=0", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "0", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "DB_POOL_MAX=101", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "101", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "DB_POOL_MAX=ba", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "ba", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "DB_POOL_MAX=1e1", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "1e1", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "DB_POOL_MAX=-1", bien: "TRUSTPROCURE_DB_POOL_MAX", giaTri: "-1", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "CLOCK_SKEW_MAX_MS=100 (biên dưới)", bien: "TRUSTPROCURE_CLOCK_SKEW_MAX_MS", giaTri: "100", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["lechDongHoToiDaMs"] },
  { nhan: "CLOCK_SKEW_MAX_MS=60000 (biên trên)", bien: "TRUSTPROCURE_CLOCK_SKEW_MAX_MS", giaTri: "60000", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["lechDongHoToiDaMs"] },
  { nhan: "CLOCK_SKEW_MAX_MS=99", bien: "TRUSTPROCURE_CLOCK_SKEW_MAX_MS", giaTri: "99", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "CLOCK_SKEW_MAX_MS=60001", bien: "TRUSTPROCURE_CLOCK_SKEW_MAX_MS", giaTri: "60001", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "CLOCK_SKEW_CHECK_MS=1000 (biên dưới)", bien: "TRUSTPROCURE_CLOCK_SKEW_CHECK_MS", giaTri: "1000", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["chuKyCanhDongHoMs"] },
  { nhan: "CLOCK_SKEW_CHECK_MS=999", bien: "TRUSTPROCURE_CLOCK_SKEW_CHECK_MS", giaTri: "999", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "CLOCK_SKEW_CHECK_MS=3600001", bien: "TRUSTPROCURE_CLOCK_SKEW_CHECK_MS", giaTri: "3600001", canh: "local-dev", mongDoi: "TU_CHOI" },
  // docAdapter — tập đóng, không nới hoa/thường, thiếu là thiếu.
  { nhan: "KEY_ADAPTER=kms", bien: "TRUSTPROCURE_KEY_ADAPTER", giaTri: "kms", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "KEY_ADAPTER=Local-Dev", bien: "TRUSTPROCURE_KEY_ADAPTER", giaTri: "Local-Dev", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "KEY_ADAPTER thiếu", bien: "TRUSTPROCURE_KEY_ADAPTER", giaTri: undefined, canh: "local-dev", mongDoi: "TU_CHOI" },
  // Dưới cảnh `aws-kms` không còn biến local-dev nào để phép loại trừ (hàng `tuChoiBienCuaAdapterKhac`) bắt hộ: phép kiểm
  // thuộc-tập của `docAdapter` là lớp DUY NHẤT — đột biến bỏ nó chỉ đỏ ở đây (đo: hai ca trên xanh giả với đột biến ấy).
  { nhan: "KEY_ADAPTER=kms dưới cảnh aws-kms", bien: "TRUSTPROCURE_KEY_ADAPTER", giaTri: "kms", canh: "aws-kms", mongDoi: "TU_CHOI" },
  { nhan: "KEY_ADAPTER=AWS-KMS dưới cảnh aws-kms", bien: "TRUSTPROCURE_KEY_ADAPTER", giaTri: "AWS-KMS", canh: "aws-kms", mongDoi: "TU_CHOI" },
  // docVong — ngữ pháp vòng khoá, cùng biến TRUSTPROCURE_MASTER_KEYS.
  { nhan: "MASTER_KEYS hai phiên bản", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: `v1=${BI_MAT.master},v2=${BI_MAT.master2}`, canh: "local-dev", mongDoi: "NHAN", doc: (c) => [lay(c, "masterKeys", "active"), Object.keys(lay(c, "masterKeys", "keys") as object).sort()] },
  { nhan: "MASTER_KEYS dấu phẩy cuối và khoảng trắng", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: ` v1 = ${BI_MAT.master} , `, canh: "local-dev", mongDoi: "NHAN", doc: (c) => Object.keys(lay(c, "masterKeys", "keys") as object) },
  { nhan: "MASTER_KEYS khai hai lần", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: `v1=${BI_MAT.master},v1=${BI_MAT.master2}`, canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "MASTER_KEYS không phải base64", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: "v1=khong-phai-base64!", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "MASTER_KEYS thiếu dấu =", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: BI_MAT.master, canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "MASTER_KEYS tên phiên bản có khoảng trắng", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: `v 1=${BI_MAT.master}`, canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "MASTER_KEYS tên phiên bản 33 ký tự", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: `${"v".repeat(33)}=${BI_MAT.master}`, canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "MASTER_KEYS chỉ dấu phẩy", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: " , ", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "MASTER_KEY_ACTIVE không có trong vòng", bien: "TRUSTPROCURE_MASTER_KEY_ACTIVE", giaTri: "v9", canh: "local-dev", mongDoi: "TU_CHOI" },
  // tuChoiBienCuaAdapterKhac — biến của adapter kia còn sót.
  { nhan: "local-dev còn KMS_ORG_WRAP_KEY_ID", bien: "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", giaTri: "alias/tp-org-wrap", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "aws-kms còn MASTER_KEYS", bien: "TRUSTPROCURE_MASTER_KEYS", giaTri: `v1=${BI_MAT.master}`, canh: "aws-kms", mongDoi: "TU_CHOI" },
  // Vùng AWS và định danh CMK — cùng regex không tên ở worker.
  { nhan: "AWS_REGION hợp lệ", bien: "TRUSTPROCURE_AWS_REGION", giaTri: "ap-southeast-1", canh: "aws-kms", mongDoi: "NHAN", doc: (c) => lay(c, "kms", "region") },
  { nhan: "AWS_REGION=us-gov-east-1", bien: "TRUSTPROCURE_AWS_REGION", giaTri: "us-gov-east-1", canh: "aws-kms", mongDoi: "NHAN", doc: (c) => lay(c, "kms", "region") },
  { nhan: "AWS_REGION chữ hoa", bien: "TRUSTPROCURE_AWS_REGION", giaTri: "AP-SOUTHEAST-1", canh: "aws-kms", mongDoi: "TU_CHOI" },
  { nhan: "AWS_REGION thiếu số cuối", bien: "TRUSTPROCURE_AWS_REGION", giaTri: "ap-southeast", canh: "aws-kms", mongDoi: "TU_CHOI" },
  { nhan: "AWS_REGION=singapore", bien: "TRUSTPROCURE_AWS_REGION", giaTri: "singapore", canh: "aws-kms", mongDoi: "TU_CHOI" },
  { nhan: "AWS_REGION hai chữ số cuối", bien: "TRUSTPROCURE_AWS_REGION", giaTri: "ap-southeast-12", canh: "aws-kms", mongDoi: "TU_CHOI" },
  { nhan: "AWS_REGION có khoảng trắng đầu/cuối ⇒ cắt", bien: "TRUSTPROCURE_AWS_REGION", giaTri: " ap-southeast-1 ", canh: "aws-kms", mongDoi: "NHAN", doc: (c) => lay(c, "kms", "region") },
  { nhan: "KMS_ORG_WRAP_KEY_ID alias", bien: "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", giaTri: "alias/tp-org-wrap", canh: "aws-kms", mongDoi: "NHAN", doc: (c) => lay(c, "kms", "orgWrapKeyId") },
  { nhan: "KMS_ORG_WRAP_KEY_ID ARN", bien: "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", giaTri: "arn:aws:kms:ap-southeast-1:123456789012:key/mrk-1a2b", canh: "aws-kms", mongDoi: "NHAN", doc: (c) => lay(c, "kms", "orgWrapKeyId") },
  { nhan: "KMS_ORG_WRAP_KEY_ID có khoảng trắng", bien: "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", giaTri: "alias/tp org", canh: "aws-kms", mongDoi: "TU_CHOI" },
  { nhan: "KMS_ORG_WRAP_KEY_ID thiếu", bien: "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", giaTri: undefined, canh: "aws-kms", mongDoi: "TU_CHOI" },
  // SES — vùng, địa chỉ gửi, configuration set: cùng ba biến ở hai tiến trình (ADR-065).
  { nhan: "SES_REGION hợp lệ", bien: "TRUSTPROCURE_SES_REGION", giaTri: "eu-central-1", canh: "ses", mongDoi: "NHAN", doc: (c) => lay(c, "ses", "region") },
  { nhan: "SES_REGION=singapore", bien: "TRUSTPROCURE_SES_REGION", giaTri: "singapore", canh: "ses", mongDoi: "TU_CHOI" },
  { nhan: "SES_FROM hợp lệ", bien: "TRUSTPROCURE_SES_FROM", giaTri: "canh-bao@thu.vidu.vn", canh: "ses", mongDoi: "NHAN", doc: (c) => lay(c, "ses", "tuDiaChi") },
  { nhan: "SES_FROM có khoảng trắng", bien: "TRUSTPROCURE_SES_FROM", giaTri: "canh bao@vidu.vn", canh: "ses", mongDoi: "TU_CHOI" },
  { nhan: "SES_FROM không có TLD", bien: "TRUSTPROCURE_SES_FROM", giaTri: "a@b", canh: "ses", mongDoi: "TU_CHOI" },
  { nhan: "SES_FROM hai địa chỉ", bien: "TRUSTPROCURE_SES_FROM", giaTri: "a@vidu.vn,b@vidu.vn", canh: "ses", mongDoi: "TU_CHOI" },
  { nhan: "SES_FROM thiếu", bien: "TRUSTPROCURE_SES_FROM", giaTri: undefined, canh: "ses", mongDoi: "TU_CHOI" },
  { nhan: "SES_CONFIGURATION_SET hợp lệ", bien: "TRUSTPROCURE_SES_CONFIGURATION_SET", giaTri: "tp-cs_1", canh: "ses", mongDoi: "NHAN", doc: (c) => lay(c, "ses", "configurationSet") },
  { nhan: "SES_CONFIGURATION_SET rỗng ⇒ không có", bien: "TRUSTPROCURE_SES_CONFIGURATION_SET", giaTri: " ", canh: "ses", mongDoi: "NHAN", doc: (c) => lay(c, "ses", "configurationSet") },
  { nhan: "SES_CONFIGURATION_SET có khoảng trắng", bien: "TRUSTPROCURE_SES_CONFIGURATION_SET", giaTri: "cs 1", canh: "ses", mongDoi: "TU_CHOI" },
  { nhan: "SES_CONFIGURATION_SET 65 ký tự", bien: "TRUSTPROCURE_SES_CONFIGURATION_SET", giaTri: "c".repeat(65), canh: "ses", mongDoi: "TU_CHOI" },
  // docDatabaseUrl — cùng ngữ pháp; role khác nhau là RIENG, nhưng superuser và chuỗi không phải URI thì cả hai từ chối.
  { nhan: "DATABASE_URL không phải URI", bien: "TRUSTPROCURE_DATABASE_URL", giaTri: "khong-phai-uri", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "DATABASE_URL superuser", bien: "TRUSTPROCURE_DATABASE_URL", giaTri: "postgres://postgres:mk@127.0.0.1:5432/db", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "DATABASE_URL thiếu", bien: "TRUSTPROCURE_DATABASE_URL", giaTri: undefined, canh: "local-dev", mongDoi: "TU_CHOI" },
  // docThuMucTuyetDoi — hai TÊN biến khác nhau, cùng phép kiểm.
  { nhan: "thư mục tuyệt đối", bien: "TRUSTPROCURE_DEV_MAILBOX_DIR", bienWorker: "TRUSTPROCURE_ALERT_DIR", giaTri: "/var/tmp/tp-thu-muc", canh: "local-dev", mongDoi: "NHAN", doc: (c) => c["devMailboxDir"] ?? c["alertDir"] },
  { nhan: "thư mục tương đối", bien: "TRUSTPROCURE_DEV_MAILBOX_DIR", bienWorker: "TRUSTPROCURE_ALERT_DIR", giaTri: "./thu-muc", canh: "local-dev", mongDoi: "TU_CHOI" },
  { nhan: "thư mục trần", bien: "TRUSTPROCURE_DEV_MAILBOX_DIR", bienWorker: "TRUSTPROCURE_ALERT_DIR", giaTri: "thu-muc", canh: "local-dev", mongDoi: "TU_CHOI" },
];

function moTaKetQua(kq: KetQuaDoc): string {
  if (kq.ok) return "NHẬN";
  const e = kq.loi;
  return e instanceof Error ? `TỪ CHỐI ${e.name}: ${e.message}` : "TỪ CHỐI (không phải Error)";
}

describe("[S1.224 / khoản 187] phép đo chống trôi — hành vi: hai `docCauHinh` trên cùng giá trị của cùng biến", () => {
  let docApi: DocCauHinh;
  let docWorker: DocCauHinh;
  const nap = async (): Promise<void> => {
    docApi ??= await napDocCauHinh(CAU_HINH_API);
    docWorker ??= await napDocCauHinh(CAU_HINH_WORKER);
  };

  it("đối chứng dương: hai môi trường nền đọc được ở cả ba cảnh (local-dev, aws-kms, ses)", async () => {
    await nap();
    for (const canh of ["local-dev", "aws-kms", "ses"] as const) {
      const a = chay(docApi, envApi(canh));
      const w = chay(docWorker, envWorker(canh));
      expect(a.ok, `api ${canh}: ${moTaKetQua(a)}`).toBe(true);
      expect(w.ok, `worker ${canh}: ${moTaKetQua(w)}`).toBe(true);
    }
  });

  it("bảng ca phủ mọi tên khai HANH_VI ở bảng kiểm kê", () => {
    // Mỗi tên trong TEN_DO_HANH_VI có ít nhất một ca đi qua nó — bảng ca không được ngắn hơn lời khai.
    const bienCua: Record<string, readonly string[]> = {
      docAdapter: ["TRUSTPROCURE_KEY_ADAPTER"],
      docVong: ["TRUSTPROCURE_MASTER_KEYS", "TRUSTPROCURE_MASTER_KEY_ACTIVE"],
      docDatabaseUrl: ["TRUSTPROCURE_DATABASE_URL"],
      docThuMucTuyetDoi: ["TRUSTPROCURE_DEV_MAILBOX_DIR"],
      tuChoiBienCuaAdapterKhac: ["TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", "TRUSTPROCURE_MASTER_KEYS"],
      soNguyen: ["TRUSTPROCURE_DB_POOL_MAX", "TRUSTPROCURE_CLOCK_SKEW_MAX_MS", "TRUSTPROCURE_CLOCK_SKEW_CHECK_MS"],
      docSoNguyen: ["TRUSTPROCURE_DB_POOL_MAX", "TRUSTPROCURE_CLOCK_SKEW_MAX_MS", "TRUSTPROCURE_CLOCK_SKEW_CHECK_MS"],
    };
    expect(Object.keys(bienCua).sort()).toEqual([...TEN_DO_HANH_VI].sort());
    const bienCoCa = new Set(CAC_CA.map((c) => c.bien));
    for (const [ten, cacBien] of Object.entries(bienCua)) {
      for (const b of cacBien) expect(bienCoCa.has(b), `${ten}: không ca nào đặt ${b}`).toBe(true);
    }
  });

  it.each(CAC_CA.map((ca) => ({ nhan: ca.nhan, ca })))("$nhan ⇒ cả hai cùng nhận (cùng giá trị) hay cùng từ chối nêu tên biến, không nêu giá trị", async ({ ca }) => {
    await nap();
    const bienWorker = ca.bienWorker ?? ca.bien;
    const a = chay(docApi, { ...envApi(ca.canh), [ca.bien]: ca.giaTri });
    const w = chay(docWorker, { ...envWorker(ca.canh), [bienWorker]: ca.giaTri });
    expect(a.ok, `api: ${moTaKetQua(a)}`).toBe(ca.mongDoi === "NHAN");
    expect(w.ok, `worker: ${moTaKetQua(w)}`).toBe(ca.mongDoi === "NHAN");
    if (a.ok && w.ok) {
      if (ca.doc !== undefined) expect(ca.doc(w.ch)).toEqual(ca.doc(a.ch));
      return;
    }
    for (const [ben, kq, bien] of [
      ["api", a, ca.bien],
      ["worker", w, bienWorker],
    ] as const) {
      if (kq.ok) continue;
      expect(kq.loi, ben).toBeInstanceOf(Error);
      const e = kq.loi as Error;
      expect(e.name, ben).toBe("CauHinhError");
      expect(e.message, ben).toContain(bien);
      for (const [tenBiMat, gt] of Object.entries(BI_MAT)) expect(e.message, `${ben} lộ ${tenBiMat}`).not.toContain(gt.slice(0, 12));
    }
  });

  it("LỆCH ĐÃ KHAI (hàng `docVong`): khoá 16 byte — api từ chối ngay ở docCauHinh nêu tên biến; worker nhận ở docCauHinh rồi MasterKeyRing từ chối lúc dựng tiến trình", async () => {
    await nap();
    const a = chay(docApi, { ...envApi("local-dev"), TRUSTPROCURE_MASTER_KEYS: `v1=${BI_MAT.master16}` });
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect((a.loi as Error).name).toBe("CauHinhError");
      expect((a.loi as Error).message).toContain("TRUSTPROCURE_MASTER_KEYS");
      expect((a.loi as Error).message).not.toContain(BI_MAT.master16.slice(0, 12));
    }
    const w = chay(docWorker, { ...envWorker("local-dev"), TRUSTPROCURE_MASTER_KEYS: `v1=${BI_MAT.master16}` });
    expect(w.ok, moTaKetQua(w)).toBe(true);
    if (w.ok) {
      const keys = lay(w.ch, "masterKeys", "keys") as Record<string, Buffer>;
      expect(keys["v1"]?.length).toBe(16);
      // Cả hai tiến trình vẫn KHÔNG LÊN với khoá sai độ dài — worker chỉ nổ muộn hơn một bước (`taoTienTrinhUnsealWorker`).
      expect(() => new MasterKeyRing(lay(w.ch, "masterKeys", "active") as string, keys)).toThrow(/32 byte/u);
    }
  });
});

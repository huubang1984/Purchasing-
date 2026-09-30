// ==============================================================================================
// [S1.224 / khoản 187] BẢNG KIỂM KÊ MÃ CHÉP GIỮA `apps/api/src` VÀ `apps/unseal-worker/src` — ĐÓNG, ĐỌC BẰNG MÁY
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
// Mỗi hàng chọn ĐÚNG MỘT cách xử lý và ghi lý do tại hàng:
//   `NANG`  — một bản ở gói chung, hai bên import. Cổng đòi tên KHÔNG còn khai ở app nào và CÓ khai ở tệp gói chung (kèm regex
//             đi theo nếu có) — để một bản cục bộ không mọc lại.
//   `GIU`   — hai bản, KÈM phép đo chống trôi: `VAN_BAN` (mục II so văn bản khai báo từng ký tự, bỏ `export`) hay `HANH_VI`
//             (mục III chạy hai `docCauHinh` trên CÙNG giá trị của CÙNG biến — cùng nhận hay cùng từ chối, cùng nêu tên biến).
//   `RIENG` — cùng tên nhưng khác hợp đồng CÓ CHỦ ĐÍCH (điểm vào, role đăng nhập, bộ biến khoá) — lý do ghi tại hàng, không đo.
//
// CỔNG CÓ RĂNG HAI CHIỀU: một tên mới xuất hiện ở cả hai app mà không có hàng ⇒ đỏ (lần chép kế tiếp không đi vào lặng lẽ); một
// hàng không còn đúng — tệp đổi, loại đổi, một bên đã xoá, một `NANG` mọc lại, một `GIU` không có phép đo ⇒ đỏ (bảng không được
// thiu). Đối chứng trong bộ nhớ: một lần quét giả có thêm một hàm chép sang worker phải bị bắt; bộ quét tự kiểm trên văn bản mẫu.
//
// RANH GIỚI, nói ra — một cổng im lặng bỏ qua một vùng mã là một cổng nói dối về phạm vi của chính nó:
//   ⒜ ⑴ chỉ khai báo MỨC MODULE và chỉ theo TÊN — một hàm chép rồi ĐỔI TÊN một bên chỉ bị bắt khi mang một biểu thức chính quy
//      chung (⑵) hay được khai tay ở ⑶; một khối mã chép vào TRONG thân một hàm khác thì mù. Tệp quét bằng `git ls-files` (tệp dò
//      tạm không tính), bỏ test và `.d.ts`.
//   ⒝ ⑵ chỉ regex, không so chuỗi hay số: chuỗi chung của hai app là khuôn dòng log của bộ nghe pool và có phép đo riêng ở mục II.
//   ⒞ `HANH_VI` chỉ phủ các biến HAI tiến trình cùng đọc; phần riêng mỗi bên (ba vòng bí mật và bộ gửi của `api`, cảnh báo của
//      worker) đo ở `cau-hinh.test.ts` của mỗi app. Một lệch ĐÃ KHAI (độ dài khoá 32 byte) ghim riêng ở mục III, không giấu.
//   ⒟ `apps/mcp`, `apps/web`, `apps/public-keys` và `tools/` mang `moTaLoi`/`cau-hinh.ts` cùng khuôn — ngoài tầm (khoản 280).
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
type DoLuong = "VAN_BAN" | "HANH_VI" | "KHONG";

interface HangTen {
  readonly ten: string;
  readonly loai: LoaiKhaiBao;
  /** Tệp (so với gốc kho) khai tên này ở mỗi bên. Hàng `NANG`: tệp TỪNG giữ bản chép — lịch sử, cổng không đọc. */
  readonly api: readonly string[];
  readonly worker: readonly string[];
  readonly xuLy: XuLy;
  readonly doLuong: DoLuong;
  /** `NANG`: tệp của gói chung nay giữ bản DUY NHẤT; `mauKemTheo`: regex đi theo hàm, cũng không được còn ở app nào. */
  readonly goiChung?: string;
  readonly mauKemTheo?: string;
  readonly lyDo: string;
}

interface HangMau {
  /** Đúng văn bản của literal, kể cả cờ — như `ts.RegularExpressionLiteral.text`. */
  readonly mau: string;
  readonly ten: string;
  readonly api: readonly string[];
  readonly worker: readonly string[];
  readonly xuLy: "GIU";
  readonly lyDo: string;
}

interface HangKhacTen {
  readonly api: { readonly ten: string; readonly tep: string };
  readonly worker: { readonly ten: string; readonly tep: string };
  readonly xuLy: "GIU";
  readonly doLuong: "VAN_BAN" | "HANH_VI";
  readonly lyDo: string;
}

const MO_TA_LOI_CHUNG = "packages/identity/src/mo-ta-loi.ts";
const CAU_HINH_API = `${API}cau-hinh.ts`;
const CAU_HINH_WORKER = `${WORKER}cau-hinh.ts`;
const MAIN_API = `${API}main.ts`;
const MAIN_WORKER = `${WORKER}main.ts`;

// ==============================================================================================
// I. BẢNG KIỂM KÊ — kết quả của khoản 187, ĐÓNG. Thêm một hàng là một quyết định nhìn thấy được, kèm lý do.
// ==============================================================================================

/** ⑴ Cùng tên ở hai app. Thứ tự: đã nâng, rồi giữ (đo văn bản, đo hành vi), rồi riêng. */
const BANG_TEN: readonly HangTen[] = [
  {
    ten: "moTaLoiKhongGiaTri",
    loai: "function",
    api: [`${API}mo-ta-loi.ts`],
    worker: [`${WORKER}tien-trinh.ts`],
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
    api: [`${API}mo-ta-loi.ts`],
    worker: [],
    xuLy: "NANG",
    doLuong: "KHONG",
    goiChung: MO_TA_LOI_CHUNG,
    lyDo: "[S1.222] Hàm phụ đi theo `moTaLoiKhongGiaTri`; worker chưa từng có tên này (bản chép của nó gộp một dòng). Giữ hàng để " +
      "một bản phụ không mọc lại ở `api`.",
  },
  {
    ten: "MA_NAM_KY_TU",
    loai: "const",
    api: [`${API}mo-ta-loi.ts`],
    worker: [`${WORKER}tien-trinh.ts`],
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
    api: [MAIN_API],
    worker: [MAIN_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Bộ mô tả lỗi KHỞI ĐỘNG của điểm vào (`CauHinhError` ⇒ message; `Error` ⇒ `tên: message`; khác ⇒ `loi khong ro`). Giữ hai " +
      "bản vì mỗi bản `instanceof` lớp `CauHinhError` của CHÍNH app (hai lớp, mục dưới) và điểm vào cố ý không phụ thuộc gói nào " +
      "ngoài hai tệp cạnh nó. Hai bản trùng từng ký tự — cổng giữ đúng thế.",
  },
  {
    ten: "CauHinhError",
    loai: "class",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "[ADR-021] Lớp lỗi cấu hình, `name` cố định. Hai lớp riêng vì hai `docCauHinh` là hai hợp đồng riêng (worker cố ý KHÔNG " +
      "đọc ba vòng bí mật của `api` — khối đầu `cau-hinh.ts` của worker); thân lớp trùng từng ký tự.",
  },
  {
    ten: "VongBiMat",
    loai: "interface",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Hình dạng một vòng bí mật có phiên bản — đúng thứ `MasterKeyRing` nhận. Kiểu, không năng lực; trùng từng ký tự.",
  },
  {
    ten: "MoiTruong",
    loai: "type",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Bản đồ tên → chuỗi của `process.env`; `api` xuất (test của nó dùng), worker không. So văn bản bỏ `export`.",
  },
  {
    ten: "BASE64",
    loai: "const",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Hình dạng base64 chuẩn của giá trị khoá. Cùng literal còn ở `routes/guest.ts` của `api` (BANG_MAU).",
  },
  {
    ten: "TEN_PHIEN_BAN",
    loai: "const",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Tên phiên bản khoá đi vào AAD/`kid` — hai bên phải nhận cùng một tập tên, vì cùng một `TRUSTPROCURE_MASTER_KEYS` đi vào cả hai.",
  },
  {
    ten: "EMAIL_DON",
    loai: "const",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Địa chỉ email đơn cho `TRUSTPROCURE_SES_FROM` — cùng biến ở hai tiến trình (ADR-065).",
  },
  {
    ten: "EMAIL",
    loai: "const",
    api: [`${API}adapters/gui-ses.ts`],
    worker: [`${WORKER}adapters/canh-bao-ses.ts`],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Cùng hình dạng email kiểm lại lúc gửi ở hai adapter SES (`taoBoGuiSes`, `taoCanhBaoSes`). Mỗi adapter là một cửa ra " +
      "riêng (IAM riêng, `FromAddress` riêng) nên hai bản; literal trùng.",
  },
  {
    ten: "bat",
    loai: "function",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "Đọc biến bắt buộc, thông điệp chỉ nêu TÊN (quy tắc ⑵). [S1.224] Worker viết `v.length === 0` nơi `api` viết `v === \"\"` " +
      "— cùng nghĩa, khác chữ; đồng văn bản ở vòng này để cổng so được từng ký tự.",
  },
  {
    ten: "docAdapter",
    loai: "function",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Đọc tên adapter trong tập ĐÓNG; tên lạ (kể cả khác hoa/thường) ⇒ ném nêu tên biến. Thông điệp khác chữ (`api`: \"CHƯA " +
      "CÓ trong kho\", worker: \"CHƯA TỒN TẠI\") và mỗi `cau-hinh.test.ts` ghim chữ của mình — không đồng văn bản; đo hành vi.",
  },
  {
    ten: "docVong",
    loai: "function",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Ngữ pháp `v1=<base64>,v2=<base64>`: thiếu `=`, tên phiên bản sai, khai hai lần, base64 sai, `active` không có trong vòng " +
      "⇒ cả hai ném nêu tên biến. LỆCH ĐÃ KHAI: `api` có tham số độ dài byte và từ chối khoá ≠ 32 byte ngay ở `docCauHinh`; " +
      "worker để `MasterKeyRing` ném lúc dựng tiến trình (khối đầu `cau-hinh.ts` của worker nói rõ) — mục III ghim cả hai nửa.",
  },
  {
    ten: "docDatabaseUrl",
    loai: "function",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Cùng ngữ pháp URI, KHÁC role đăng nhập có chủ đích (`app_api_login` / `app_unseal_login` — cặp duy nhất hardening giữ). " +
      "Đo: không phải URI và superuser đều bị cả hai từ chối.",
  },
  {
    ten: "docThuMucTuyetDoi",
    loai: "function",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Đường dẫn tương đối ⇒ ném (thư mục nằm trong cây repo khi chạy dev). Thông điệp nêu lý do riêng mỗi bên (hộp thư dev / " +
      "cảnh báo break-glass) nên không đồng văn bản; đo hành vi trên hai biến `TRUSTPROCURE_DEV_MAILBOX_DIR` / `TRUSTPROCURE_ALERT_DIR`.",
  },
  {
    ten: "tuChoiBienCuaAdapterKhac",
    loai: "function",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "[ADR-064] Hai bộ biến khoá loại trừ nhau. Đo: dưới `local-dev` còn `TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID`, dưới `aws-kms` còn " +
      "`TRUSTPROCURE_MASTER_KEYS` ⇒ cả hai ném nêu tên biến sót.",
  },
  {
    ten: "chinh",
    loai: "function",
    api: [MAIN_API],
    worker: [MAIN_WORKER],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Thân điểm vào của mỗi tiến trình: cùng ba việc, khác tiến trình dựng (`taoTienTrinhApi` / `taoTienTrinhUnsealWorker`) và " +
      "`api` in thêm dòng đang nghe. Không phải bản chép để giữ giống.",
  },
  {
    ten: "docCauHinh",
    loai: "function",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Hai hợp đồng cấu hình khác nhau có chủ đích (worker KHÔNG đọc ba vòng bí mật của `api` — ADR-006, đo ở `cau-hinh.test.ts` " +
      "của worker vế ⑼). Phần biến CHUNG của hai hàm đo ở mục III.",
  },
  {
    ten: "ROLE_DANG_NHAP",
    loai: "const",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "`app_api_login` / `app_unseal_login` — hai cặp role mà `hardening.always.sql` (`CAP_HOP_LE`) giữ; khác giá trị là bản chất.",
  },
  {
    ten: "BIEN_KHOA_LOCAL_DEV",
    loai: "const",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "`api`: sáu biến của ba vòng; worker: hai biến của MỘT vòng — worker không được cầm lối vào bí mật nào khác (ADR-006; " +
      "`cau-hinh.test.ts` của worker vế ⑼ đặt giá trị rác vào ba vòng kia và đòi KHÔNG ném).",
  },
  {
    ten: "BIEN_KHOA_KMS",
    loai: "const",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "[ADR-064] `api`: bảy biến (ba CMK và nhãn); worker: vùng và đúng MỘT CMK `alias/tp-org-wrap`. Cùng lý do với hàng trên.",
  },
  {
    ten: "docChuoi",
    loai: "function",
    api: [`${API}outbox-api.ts`],
    worker: [`${WORKER}composition.ts`],
    xuLy: "RIENG",
    doLuong: "KHONG",
    lyDo: "Đọc một trường chuỗi khỏi `payload` của job. `api` có trần `EMAIL_MAX_BYTES` vì chuỗi là email đi gửi; worker đọc id " +
      "(`unsealRequestId`, `rfqId`) rồi truyền làm tham số SQL kiểu uuid — CSDL từ chối rác. Hai hợp đồng, không phải một bản trôi.",
  },
];

/** ⑵ Cùng biểu thức chính quy ở hai app — bắt cả bản chép KHÔNG TÊN. Tệp ghi là TẬP tệp mỗi bên có literal ấy. */
const BANG_MAU: readonly HangMau[] = [
  {
    mau: "/^[A-Za-z0-9+/]+={0,2}$/u",
    ten: "BASE64",
    api: [CAU_HINH_API, `${API}routes/guest.ts`],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Hình dạng base64 chuẩn; `routes/guest.ts` dùng cho thân yêu cầu của khách (không phải cấu hình). Đo văn bản qua hàng `BASE64`.",
  },
  {
    mau: "/^[A-Za-z0-9._:-]{1,32}$/u",
    ten: "TEN_PHIEN_BAN",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Tên phiên bản khoá. Đo văn bản qua hàng `TEN_PHIEN_BAN`; đo hành vi qua `TRUSTPROCURE_MASTER_KEYS` (mục III).",
  },
  {
    mau: "/^[A-Za-z0-9/:_.-]{1,2048}$/u",
    ten: "định danh CMK (`docKeyIdKms` của `api`; literal không tên ở `docKhoa` của worker)",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Cùng biến `TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID` đi vào cả hai (ADR-064). Đo hành vi ở mục III.",
  },
  {
    mau: "/^[A-Za-z0-9_-]{1,64}$/u",
    ten: "tên configuration set SES (`TEN_CAU_HINH_AWS` của `api`; literal không tên ở worker)",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Cùng biến `TRUSTPROCURE_SES_CONFIGURATION_SET` (ADR-065). Đo hành vi ở mục III.",
  },
  {
    mau: '/^[^\\s@,;<>"]{1,64}@[^\\s@,;<>"]{1,253}\\.[^\\s@,;<>"]{2,63}$/u',
    ten: "EMAIL_DON / EMAIL",
    api: [`${API}adapters/gui-ses.ts`, CAU_HINH_API],
    worker: [`${WORKER}adapters/canh-bao-ses.ts`, CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Địa chỉ email đơn, kiểm ở cấu hình và kiểm lại lúc gửi. Đo văn bản qua hai hàng `EMAIL_DON`, `EMAIL`; hành vi qua `TRUSTPROCURE_SES_FROM`.",
  },
  {
    mau: "/^[a-z]{2}(?:-[a-z]+)+-\\d$/u",
    ten: "vùng AWS (`VUNG_AWS` của `api`; literal không tên, hai chỗ, ở worker)",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Cùng biến `TRUSTPROCURE_AWS_REGION`, `TRUSTPROCURE_SES_REGION`. Đo hành vi ở mục III (chữ hoa, thiếu số cuối ⇒ cả hai từ chối).",
  },
  {
    mau: "/^\\d{1,9}$/u",
    ten: "số nguyên không âm (`soNguyen` của `api`, `docSoNguyen` của worker)",
    api: [CAU_HINH_API],
    worker: [CAU_HINH_WORKER],
    xuLy: "GIU",
    lyDo: "Ngữ pháp của mọi biến số. Đo hành vi ở mục III trên `TRUSTPROCURE_DB_POOL_MAX`, `TRUSTPROCURE_CLOCK_SKEW_*` (biên, rỗng, chữ).",
  },
];

/** ⑶ Khác tên, cùng việc — tìm bằng tay; cổng chỉ giữ chúng còn ở đúng tệp, phép đo ghi ở `doLuong`. */
const BANG_KHAC_TEN: readonly HangKhacTen[] = [
  {
    api: { ten: "soNguyen", tep: CAU_HINH_API },
    worker: { ten: "docSoNguyen", tep: CAU_HINH_WORKER },
    xuLy: "GIU",
    doLuong: "HANH_VI",
    lyDo: "Đọc số nguyên trong miền `[nhoNhat, lonNhat]`, rỗng ⇒ mặc định. `api` đi qua `tuyChon`, worker viết thẳng; cùng regex " +
      "(BANG_MAU). Đo ở mục III kể cả hai biên của miền.",
  },
  {
    api: { ten: "ghiLogKetNoiHuy", tep: `${API}mo-ta-loi.ts` },
    worker: { ten: "ghiKetNoiHuy", tep: `${WORKER}tien-trinh.ts` },
    xuLy: "GIU",
    doLuong: "VAN_BAN",
    lyDo: "[S1.84 / khoản 129, 173] Bộ nghe `release`: chỉ `TenantError SESSION_STATE_LEFT`, một dòng `ket noi huy <pool> <mô tả>`. " +
      "Hình dạng khác có chủ đích: `api` gắn trong hàm bọc (cổng `pool-nghe-du-tin-hieu` TIN theo đường import `./mo-ta-loi.js`), " +
      "worker trả bộ nghe và gắn tại chỗ dựng pool (cổng ấy đọc lời gọi `.on`). Mục II so ĐIỀU KIỆN và KHUÔN dòng log (bỏ tiền tố " +
      "tiến trình); thân đo bằng hành vi ở hai `loi-ket-noi-toi-muon.int.test.ts` (S1.221).",
  },
  {
    api: { ten: "ghiLogLoiKetNoiToiMuon", tep: `${API}mo-ta-loi.ts` },
    worker: { ten: "ghiLoiToiMuon", tep: `${WORKER}tien-trinh.ts` },
    xuLy: "GIU",
    doLuong: "VAN_BAN",
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

const QUET_API = quetTep(tepSanXuat(API));
const QUET_WORKER = quetTep(tepSanXuat(WORKER));

function tepCua(ds: readonly KhaiBao[] | undefined): string[] {
  return [...new Set((ds ?? []).map((k) => k.tep))].sort();
}

function cungTap(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// ==============================================================================================
// PHÉP ĐỐI CHIẾU — hàm thuần trên hai kết quả quét, để đối chứng trong bộ nhớ dựng được lần quét giả.
// ==============================================================================================

function doiChieuTen(bang: readonly HangTen[], api: KetQuaQuet, worker: KetQuaQuet, goiChung: (tep: string) => KetQuaQuet): string[] {
  const loi: string[] = [];
  const tenDaKhai = new Set<string>();
  for (const h of bang) {
    if (tenDaKhai.has(h.ten)) loi.push(`BANG_TEN khai \`${h.ten}\` hai lần`);
    tenDaKhai.add(h.ten);
  }
  for (const [ten, ds] of api.khaiBao) {
    if (worker.khaiBao.has(ten) && !tenDaKhai.has(ten)) {
      loi.push(
        `CHƯA KHAI: \`${ten}\` khai ở cả hai app — api: ${tepCua(ds).join(", ")}; worker: ${tepCua(worker.khaiBao.get(ten)).join(", ")}. ` +
          "Thêm một hàng vào BANG_TEN và chọn NANG / GIU (kèm phép đo) / RIENG (kèm lý do).",
      );
    }
  }
  for (const h of bang) {
    const a = api.khaiBao.get(h.ten) ?? [];
    const w = worker.khaiBao.get(h.ten) ?? [];
    if (h.xuLy === "NANG") {
      if (a.length > 0 || w.length > 0) {
        loi.push(`hàng NANG \`${h.ten}\` MỌC LẠI ở app — api: ${tepCua(a).join(", ") || "—"}; worker: ${tepCua(w).join(", ") || "—"}`);
      }
      if (h.goiChung === undefined) loi.push(`hàng NANG \`${h.ten}\` không ghi tệp gói chung`);
      else if (!goiChung(h.goiChung).khaiBao.has(h.ten)) loi.push(`hàng NANG \`${h.ten}\`: ${h.goiChung} không khai tên ấy`);
      if (h.mauKemTheo !== undefined) {
        if (api.mau.has(h.mauKemTheo) || worker.mau.has(h.mauKemTheo)) loi.push(`hàng NANG \`${h.ten}\`: literal ${h.mauKemTheo} còn ở app`);
        if (h.goiChung !== undefined && !goiChung(h.goiChung).mau.has(h.mauKemTheo)) {
          loi.push(`hàng NANG \`${h.ten}\`: ${h.goiChung} không mang literal ${h.mauKemTheo}`);
        }
      }
      if (h.doLuong !== "KHONG") loi.push(`hàng NANG \`${h.ten}\` không mang phép đo (một bản thì không có gì để trôi)`);
      continue;
    }
    if (!cungTap(tepCua(a), h.api)) loi.push(`hàng \`${h.ten}\`: api khai ở [${tepCua(a).join(", ")}], bảng ghi [${h.api.join(", ")}]`);
    if (!cungTap(tepCua(w), h.worker)) loi.push(`hàng \`${h.ten}\`: worker khai ở [${tepCua(w).join(", ")}], bảng ghi [${h.worker.join(", ")}]`);
    const loaiThat = new Set([...a, ...w].map((k) => k.loai));
    if (loaiThat.size !== 1 || !loaiThat.has(h.loai)) loi.push(`hàng \`${h.ten}\`: loại ${h.loai} nhưng thấy ${[...loaiThat].join("/") || "—"}`);
    if (h.xuLy === "GIU" && h.doLuong === "KHONG") loi.push(`hàng GIU \`${h.ten}\` KHÔNG có phép đo — giữ hai bản thì phải đo chống trôi`);
    if (h.xuLy === "RIENG" && h.doLuong !== "KHONG") loi.push(`hàng RIENG \`${h.ten}\` khai phép đo — riêng thì không có gì để so`);
    if (h.doLuong === "HANH_VI" && !TEN_DO_HANH_VI.has(h.ten)) loi.push(`hàng \`${h.ten}\` khai HANH_VI nhưng mục III không chạy qua nó`);
  }
  return loi;
}

function doiChieuMau(bang: readonly HangMau[], api: KetQuaQuet, worker: KetQuaQuet): string[] {
  const loi: string[] = [];
  const daKhai = new Set(bang.map((h) => h.mau));
  for (const [mau, tepApi] of api.mau) {
    const tepWorker = worker.mau.get(mau);
    if (tepWorker !== undefined && !daKhai.has(mau)) {
      loi.push(`CHƯA KHAI: literal ${mau} ở cả hai app — api: ${[...tepApi].join(", ")}; worker: ${[...tepWorker].join(", ")}. Thêm hàng vào BANG_MAU.`);
    }
  }
  for (const h of bang) {
    const a = [...(api.mau.get(h.mau) ?? [])];
    const w = [...(worker.mau.get(h.mau) ?? [])];
    if (!cungTap(a, h.api)) loi.push(`hàng mẫu \`${h.ten}\`: api có ở [${a.join(", ")}], bảng ghi [${h.api.join(", ")}]`);
    if (!cungTap(w, h.worker)) loi.push(`hàng mẫu \`${h.ten}\`: worker có ở [${w.join(", ")}], bảng ghi [${h.worker.join(", ")}]`);
  }
  return loi;
}

function doiChieuKhacTen(bang: readonly HangKhacTen[], api: KetQuaQuet, worker: KetQuaQuet): string[] {
  const loi: string[] = [];
  for (const h of bang) {
    if (!(api.khaiBao.get(h.api.ten) ?? []).some((k) => k.tep === h.api.tep)) loi.push(`cặp khác tên: \`${h.api.ten}\` không còn ở ${h.api.tep}`);
    if (!(worker.khaiBao.get(h.worker.ten) ?? []).some((k) => k.tep === h.worker.tep)) {
      loi.push(`cặp khác tên: \`${h.worker.ten}\` không còn ở ${h.worker.tep}`);
    }
    if (h.doLuong === "HANH_VI" && !(TEN_DO_HANH_VI.has(h.api.ten) && TEN_DO_HANH_VI.has(h.worker.ten))) {
      loi.push(`cặp khác tên \`${h.api.ten}\`/\`${h.worker.ten}\` khai HANH_VI nhưng mục III không chạy qua`);
    }
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
    expect(QUET_API.soTep).toBeGreaterThanOrEqual(25);
    expect(QUET_WORKER.soTep).toBeGreaterThanOrEqual(8);
    // Cả tệp ngay trong `src/` lẫn tệp ở thư mục con — hai tầng mà một glob sai bỏ sót một tầng.
    expect(tepSanXuat(API)).toEqual(expect.arrayContaining([CAU_HINH_API, MAIN_API, `${API}adapters/gui-ses.ts`, `${API}routes/guest.ts`]));
    expect(tepSanXuat(WORKER)).toEqual(expect.arrayContaining([CAU_HINH_WORKER, MAIN_WORKER, `${WORKER}adapters/canh-bao-ses.ts`]));
    expect(tepSanXuat(API).some((t) => /\.test\.ts$/u.test(t))).toBe(false);
    for (const ten of ["docCauHinh", "moTaLoi", "CauHinhError", "EMAIL"]) {
      expect(QUET_API.khaiBao.has(ten), `api: ${ten}`).toBe(true);
      expect(QUET_WORKER.khaiBao.has(ten), `worker: ${ten}`).toBe(true);
    }
    expect(QUET_API.mau.has("/^\\d{1,9}$/u")).toBe(true);
    expect(QUET_WORKER.mau.has("/^\\d{1,9}$/u")).toBe(true);
  });

  it("⑴ mọi khai báo cùng tên ở hai app đều có hàng, và mọi hàng đều còn đúng (tệp, loại, cách xử lý, phép đo; NANG không mọc lại)", () => {
    expect(doiChieuTen(BANG_TEN, QUET_API, QUET_WORKER, quetGoiChung)).toEqual([]);
  });

  it("⑵ mọi biểu thức chính quy chung của hai app đều có hàng, và tập tệp của mỗi hàng còn đúng", () => {
    expect(doiChieuMau(BANG_MAU, QUET_API, QUET_WORKER)).toEqual([]);
  });

  it("⑶ mọi cặp khác tên còn ở đúng tệp, và cặp khai HANH_VI được mục III chạy qua", () => {
    expect(doiChieuKhacTen(BANG_KHAC_TEN, QUET_API, QUET_WORKER)).toEqual([]);
  });

  it("đối chứng trong bộ nhớ: một hàm chép sang worker, một literal chép sang worker, một hàng thiu, một NANG mọc lại — mỗi thứ một dòng đỏ", () => {
    const khaiBao = new Map<string, KhaiBao[]>();
    const mau = new Map<string, Set<string>>();
    for (const [k, v] of QUET_WORKER.khaiBao) khaiBao.set(k, [...v]);
    for (const [k, v] of QUET_WORKER.mau) mau.set(k, new Set(v));
    quetVanBan(
      `${WORKER}adapters/canh-bao-ses.ts`,
      'export function laDiaChiEmail(s: string): boolean { return s.length <= 320; }\nconst NHAN_KMS = /^[A-Za-z0-9._:-]{1,64}$/u;\nconst MA_NAM_KY_TU = /^[0-9A-Z]{5}$/u;\n',
      khaiBao,
      mau,
    );
    const workerGia: KetQuaQuet = { khaiBao, mau, soTep: QUET_WORKER.soTep };
    // `laDiaChiEmail` có thật ở `api` (gui-ses.ts); `NHAN_KMS` literal có thật ở `api`; `MA_NAM_KY_TU` là hàng NANG.
    const loiTen = doiChieuTen(BANG_TEN, QUET_API, workerGia, quetGoiChung);
    expect(loiTen.filter((l) => l.includes("CHƯA KHAI") && l.includes("`laDiaChiEmail`"))).toHaveLength(1);
    expect(loiTen.filter((l) => l.includes("MỌC LẠI") && l.includes("`MA_NAM_KY_TU`"))).toHaveLength(1);
    expect(loiTen.filter((l) => l.includes("literal /^[0-9A-Z]{5}$/u còn ở app"))).toHaveLength(1);
    const loiMau = doiChieuMau(BANG_MAU, QUET_API, workerGia);
    expect(loiMau.filter((l) => l.includes("CHƯA KHAI") && l.includes("/^[A-Za-z0-9._:-]{1,64}$/u"))).toHaveLength(1);
    // Hàng thiu: bảng ghi một tệp không còn khai — đỏ; hàng GIU không phép đo — đỏ; hàng khác tên trỏ tên không có — đỏ.
    const thiu: HangTen = { ...BANG_TEN[3]!, api: [`${API}khong-co.ts`] };
    expect(doiChieuTen([thiu], QUET_API, QUET_WORKER, quetGoiChung).some((l) => l.includes("bảng ghi [apps/api/src/khong-co.ts]"))).toBe(true);
    const khongDo: HangTen = { ...BANG_TEN[3]!, doLuong: "KHONG" };
    expect(doiChieuTen([khongDo], QUET_API, QUET_WORKER, quetGoiChung).some((l) => l.includes("KHÔNG có phép đo"))).toBe(true);
    const capThiu: HangKhacTen = { ...BANG_KHAC_TEN[0]!, worker: { ten: "docSoNguyenCu", tep: CAU_HINH_WORKER } };
    expect(doiChieuKhacTen([capThiu], QUET_API, QUET_WORKER).some((l) => l.includes("`docSoNguyenCu` không còn"))).toBe(true);
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
    doanChu: [m.head.text.replace(/^\[(?:api|unseal-worker)\] /u, "[<tiến trình>] "), ...m.templateSpans.map((s) => s.literal.text)],
    bieuThuc: m.templateSpans.map((s) => hinhDangBieuThuc(s.expression, k.sf)),
  };
}

describe("[S1.224 / khoản 187] phép đo chống trôi — văn bản của các cặp GIU", () => {
  const hangVanBan = BANG_TEN.filter((h) => h.xuLy === "GIU" && h.doLuong === "VAN_BAN");

  it("có hàng VAN_BAN để đo, và mỗi hàng khai đúng một tệp mỗi bên", () => {
    // Không sàn theo con số hôm nay (một sàn đặt đúng bằng hiện trạng không bao giờ kêu): chỉ đòi có thứ để đo, và vế `it.each`
    // dưới là một test cho MỖI hàng — hàng nào biến mất thì mục I đã đỏ ở "hàng thiu".
    expect(hangVanBan.length).toBeGreaterThan(0);
    for (const h of hangVanBan) expect([h.api.length, h.worker.length], h.ten).toEqual([1, 1]);
  });

  it.each(hangVanBan.map((h) => ({ ten: h.ten, h })))("`$ten`: khai báo ở api và ở worker trùng từng ký tự (bỏ `export`)", ({ h }) => {
    const a = vanBanKhaiBao(khaiBaoDuyNhat(QUET_API, h.ten, h.api[0]!));
    const w = vanBanKhaiBao(khaiBaoDuyNhat(QUET_WORKER, h.ten, h.worker[0]!));
    expect(w).toBe(a);
  });

  it("bộ nghe `release`: `ghiLogKetNoiHuy` (api) và `ghiKetNoiHuy` (worker) cùng điều kiện lọc và cùng khuôn dòng log", () => {
    const a = khuonBoNghe(khaiBaoDuyNhat(QUET_API, "ghiLogKetNoiHuy", `${API}mo-ta-loi.ts`));
    const w = khuonBoNghe(khaiBaoDuyNhat(QUET_WORKER, "ghiKetNoiHuy", `${WORKER}tien-trinh.ts`));
    const mongDoi: KhuonBoNghe = {
      dieuKien: 'loi instanceof TenantError && loi.code === "SESSION_STATE_LEFT"',
      doanChu: ["[<tiến trình>] ket noi huy ", " ", ""],
      bieuThuc: ["<tên>", "moTaLoiKhongGiaTri(<tên>)"],
    };
    expect(a).toEqual(mongDoi);
    expect(w).toEqual(mongDoi);
  });

  it("bộ nghe lỗi-tới-muộn: `ghiLogLoiKetNoiToiMuon` (api) và `ghiLoiToiMuon` (worker) cùng khuôn dòng log, không lọc", () => {
    const a = khuonBoNghe(khaiBaoDuyNhat(QUET_API, "ghiLogLoiKetNoiToiMuon", `${API}mo-ta-loi.ts`));
    const w = khuonBoNghe(khaiBaoDuyNhat(QUET_WORKER, "ghiLoiToiMuon", `${WORKER}tien-trinh.ts`));
    const mongDoi: KhuonBoNghe = {
      dieuKien: null,
      doanChu: ["[<tiến trình>] loi ket noi toi muon ", " ", ""],
      bieuThuc: ["<tên>", "moTaLoiKhongGiaTri(<tên>)"],
    };
    expect(a).toEqual(mongDoi);
    expect(w).toEqual(mongDoi);
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

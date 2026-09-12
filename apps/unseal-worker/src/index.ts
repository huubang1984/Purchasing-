// ==============================================================================================
// apps/unseal-worker — CĂN PHÒNG SAU CÁNH CỬA ĐÃ KHOÁ TỪ S0
//
// Thư mục này được nhắc tên trong `.dependency-cruiser.cjs` từ **fix round 4 của Task 7**, tức là
// từ trước khi nó tồn tại. Hai họ quy tắc canh nó — `g1-` (đường mở bọc khoá của `crypto-keys`)
// và `g8-` (đường mở phong bì của `sealed-envelope`) — và cả hai đều mở đúng MỘT miễn trừ:
// `apps/unseal-worker/`. Ghi chú §4 của bất biến G1 gọi tình trạng ấy bằng một câu:
//
//   *"Ô ✅ này chứng minh CÁNH CỬA ĐÃ KHOÁ; nó chưa chứng minh gì về CĂN PHÒNG, vì căn phòng
//    chưa được xây."*
//
// File này là căn phòng.
//
// ---------------------------------------------------------------------------------------------
// BỐN THỨ TIẾN TRÌNH NÀY LÀ NƠI DUY NHẤT LÀM ĐƯỢC, VÀ MỘT THỨ NÓ KHÔNG LÀM
// ---------------------------------------------------------------------------------------------
//   ✔ mở bọc khoá riêng RFQ              — `crypto-keys/unwrap`, cửa hạn chế của `g1-`
//   ✔ mở phong bì niêm phong             — `sealed-envelope/unseal`, cửa hạn chế của `g8-`
//   ✔ ghi bản rõ vào `rfq_unsealed_bids` — `app_unseal` là role DUY NHẤT có INSERT (019)
//   ✔ tuyên bố RFQ đã `UNSEALED`         — nơi làm việc cũng là nơi tuyên bố (019 mục 4)
//
//   ✘ **KHÔNG** phán xử QUYỀN. `app_unseal` cố ý không có một GRANT nào trên `user_roles`,
//     `role_permissions` hay `permissions` (005), nên vế 1 của D1 là một câu tiến trình này
//     KHÔNG HỎI ĐƯỢC. Cổng bốn vế chạy ở `dispatchUnseal` phía `api`.
//
// ---------------------------------------------------------------------------------------------
// [REVIEW AN NINH S1.6 — HIGH-3] MỘT CÂU SAI ĐÃ ĐỨNG Ở ĐÂY, VÀ NÓ ĐANG CHẶN MỘT LỚP CÓ THẬT
// ---------------------------------------------------------------------------------------------
// Nguyên văn câu cũ, giữ lại để đối chiếu:
//
//   ~~*"`app_unseal` cố ý không đọc được `users` (002) hay ma trận quyền (005), nên HAI vế đầu~~
//   ~~của D1 là những câu tiến trình này KHÔNG HỎI ĐƯỢC."*~~
//
// **Vế `users` của câu ấy SAI.** `006_sessions_and_mfa.sql:232` cấp
// `SELECT (id, org_id, status) ON users TO app_unseal`, và `:305` cấp đúng sáu cột của `sessions`
// mà `assertFreshMfa` đọc — chính 006 ghi rằng nó cấp *"vì bất biến D1"*. Tức vế 2 (MFA còn hiệu
// lực) **hỏi được ở đây**, và một câu sai đã dùng để biện minh cho việc không hỏi nó, trên đúng
// hành động không thu hồi được của cả hệ thống.
//
// Nay nó được hỏi: `executeUnsealRequest` chạy lại `assertFreshMfa` trên PHIÊN ĐÃ ĐIỀU PHỐI, với
// một cửa sổ riêng của lúc GIẢI MÃ. Chỉ vế 1 (quyền) là thật sự không hỏi được ở đây.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { assertFreshMfa } from "@trustprocure/identity";
import type { KeyUnwrapper } from "@trustprocure/crypto-keys/unwrap";
import {
  KEY_AGREEMENT_ALGORITHMS,
  describeEnvelope,
  type KeyAgreementAlgorithm,
} from "@trustprocure/sealed-envelope";
import { unsealBid } from "@trustprocure/sealed-envelope/unseal";

export class UnsealWorkerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnsealWorkerError";
  }
}

/**
 * Cửa sổ MFA ở thời điểm GIẢI MÃ — rộng hơn cửa sổ 15 phút của lúc điều phối, và có lý do.
 *
 * Hai thời điểm hỏi hai câu khác nhau. Lúc điều phối, câu hỏi là *"người này VỪA chứng minh danh
 * tính chưa"* — 15 phút là câu trả lời đúng. Lúc giải mã, câu hỏi là *"uỷ quyền này còn sống
 * không, hay nó đã nằm trong hàng đợi qua một sự cố"* — và một hàng đợi bị nghẽn nửa giờ là
 * chuyện vận hành bình thường, không phải một cuộc tấn công.
 *
 * Thứ nó ĐÓNG là ca mà `assertFreshMfa` cũng kiểm cùng lúc và không có cửa sổ nào cả: phiên bị
 * THU HỒI, phiên HẾT HẠN, hoặc người dùng không còn `ACTIVE`. Ba thứ ấy chặn ngay lập tức.
 */
export const UNSEAL_DECRYPT_MFA_MAX_AGE_SECONDS = 60 * 60;

export interface ExecuteUnsealInput {
  readonly unsealRequestId: string;
  readonly unwrapper: KeyUnwrapper;
  /** Ghi đè cửa sổ MFA lúc giải mã — chỉ để test đo được cả hai phía của ngưỡng. */
  readonly maxMfaAgeSeconds?: number;
}

export interface UnsealOutcome {
  readonly unsealRequestId: string;
  readonly rfqId: string;
  /** Số phong bì đã mở được. */
  readonly opened: number;
  /**
   * Các phiên bản báo giá KHÔNG mở được — ĐÍCH DANH, không phải một con số.
   *
   * [REVIEW AN NINH S1.4 — HIGH-2] Bản trước chỉ đếm. Một con số làm *"đã mở 4 trên 5 và đi
   * tiếp"* không phân biệt được với *"đã mở 5 trên 5"* ở mọi chỗ phía sau — và trong một hệ đấu
   * thầu kín thì đó là một hỏng hóc về CÔNG BẰNG, không phải một dòng log thiếu.
   *
   * LÝ DO thất bại CỐ Ý không được ghi: ba nguyên nhân (sai khoá, sai RFQ, bị sửa) cho cùng một
   * câu, và phân biệt được chúng là một oracle. Danh tính hàng thì không phải oracle — nhà cung
   * cấp đã biết mình nộp gì.
   */
  readonly failedBidVersionIds: readonly string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HangYeuCau {
  readonly rfq_id: string;
  readonly status: string;
  readonly dispatched_by: string | null;
  readonly dispatched_by_session_id: string | null;
}

interface HangKhoa {
  readonly algorithm: string;
  readonly wrapped_private_key: Buffer;
  readonly key_version: string;
}

interface HangPhongBi {
  readonly id: string;
  readonly envelope: Buffer;
}

function laThuatToanBiet(x: string): x is KeyAgreementAlgorithm {
  return (KEY_AGREEMENT_ALGORITHMS as readonly string[]).includes(x);
}

/**
 * [khoản nợ 106] Độ sâu lồng tối đa của một bản rõ JSON được cất NGUYÊN hình dạng. Sâu hơn thì cất dưới `{ raw }`.
 *
 * Đây là một biên an toàn, không phải một giới hạn sản phẩm. `JSON.stringify` của V8 đệ quy: đo cục bộ trên Node 24.18 ở một
 * ngăn xếp nông, mảng lồng 4 744 tầng đã ném `RangeError`. ~~Ngăn xếp lúc worker gọi `JSON.stringify` — sau một `await` — thì KHÔNG
 * đo. Bộ phân tích JSON của PostgreSQL cũng đệ quy (`check_stack_depth`), và ngưỡng của nó CHƯA đo.~~ Một báo giá thật chỉ lồng vài
 * tầng; 64 tầng — mảng lồng lẫn đối tượng lồng — đo được là cất nguyên hình dạng (`unseal-worker.int.test.ts`). Bản rõ sâu hơn KHÔNG
 * mất: nó nằm trong `raw`.
 * **[S1.65, khoản nợ 107]** Đường có cấu trúc nay KHÔNG gọi `JSON.stringify` (xem `thanhJson`): văn bản gốc đi thẳng vào bộ phân tích
 * JSON của PostgreSQL, và bộ ấy đệ quy (`check_stack_depth`). Đo trên PostgreSQL 16.15, `max_stack_depth` 2MB, một mảng lồng đứng riêng:
 * 5 000 tầng nhận, 20 000 tầng ném `54001`. Biên 64 đứng rất xa khoảng ấy.
 */
const DO_SAU_JSON_TOI_DA = 64;

const KY_TU_NUL = String.fromCharCode(0);

/** Ở chế độ `u`, một cặp surrogate hợp lệ là MỘT điểm mã, nên `\p{Surrogate}` chỉ khớp surrogate ĐƠN LẺ. */
const SURROGATE_DON_LE = /\p{Surrogate}/u;

/** Một chuỗi — giá trị hay khoá — mà `jsonb` nhận: không mang U+0000, không mang surrogate đơn lẻ. */
function chuoiJsonbNhan(chuoi: string): boolean {
  return !chuoi.includes(KY_TU_NUL) && !SURROGATE_DON_LE.test(chuoi);
}

/**
 * [khoản nợ 106] ~~`true` thì `JSON.stringify(goc)` chạy xong VÀ `jsonb` nhận văn bản nó sinh ra.~~ **[S1.65, khoản nợ 107]** Số khoá
 * của cây `goc`, cộng trên mọi đối tượng, khi mọi chuỗi, mọi khoá và độ sâu của cây đều trong miền `jsonb` nhận; `null` khi không. Đây
 * là vế ⑴ của điều kiện ĐỦ để `jsonb` nhận văn bản gốc (xem `thanhJson`), cố ý chặt hơn điều kiện cần: cây 65 tầng thì `jsonb` vẫn
 * nhận, nhưng hàm trả `null` — biên an toàn của `DO_SAU_JSON_TOI_DA`.
 *
 * Đi cây bằng VÒNG LẶP trên ngăn xếp tường minh: một hàm đệ quy ở đây ~~sẽ ném đúng cái `RangeError` nó được viết ra để tránh~~ có thể
 * ném `RangeError` trên một cây RẤT sâu — lượt soi 58 đo trên Node 24.18, ngoài worker: một phép đi cây đệ quy không chặn độ sâu chạy xong
 * 5 000 tầng và ném ở 20 000 tầng. Ba lớp bị loại, lớp nào cũng đã đo làm CẢ lượt mở thầu rollback:
 *   ⑴⑵ chuỗi hay KHOÁ mang U+0000 — ~~`JSON.stringify` xuất lại escape của nó,~~ `jsonb` từ chối escape của nó (`22P05`);
 *   ⑶ chuỗi hay khoá mang surrogate đơn lẻ — ~~`JSON.stringify` xuất escape,~~ `jsonb` từ chối escape của nó (`22P02`);
 *   ⑷ độ sâu vượt `DO_SAU_JSON_TOI_DA` — ~~`JSON.stringify` ném `RangeError`.~~ [S1.65] bộ phân tích JSON của PostgreSQL ném `54001`
 *      ở đâu đó giữa 5 000 và 20 000 tầng (xem `DO_SAU_JSON_TOI_DA`).
 * Escape của U+0000 trong KHOÁ không bị gỡ: hai khoá chỉ khác nhau ở U+0000 sẽ gộp làm một, và một giá trị mất âm thầm (lượt soi 56
 * C1). U+0000 THÔ không tới được đây: `JSON.parse` của văn bản gốc đã ném trước (lượt soi 57 NẶNG-1, xem `thanhJson`).
 */
function demKhoaJsonbNhan(goc: object): number | null {
  const ngan: object[] = [goc];
  const doSau: number[] = [1];
  let soKhoa = 0;
  for (;;) {
    const nut = ngan.pop();
    const sau = doSau.pop();
    if (nut === undefined || sau === undefined) return soKhoa;
    if (sau > DO_SAU_JSON_TOI_DA) return null;
    if (!Array.isArray(nut)) {
      const cacKhoa = Object.keys(nut);
      if (!cacKhoa.every((khoa) => chuoiJsonbNhan(khoa))) return null;
      soKhoa += cacKhoa.length;
    }
    const cacCon: readonly unknown[] = Array.isArray(nut) ? nut : Object.values(nut);
    for (const con of cacCon) {
      if (typeof con === "string") {
        if (!chuoiJsonbNhan(con)) return null;
      } else if (typeof con === "object" && con !== null) {
        ngan.push(con);
        doSau.push(sau + 1);
      }
    }
  }
}

/**
 * [khoản nợ 107] Biên của văn bản MỘT số JSON được cất nguyên giá trị: dài tối đa `DO_DAI_SO_TOI_DA` ký tự kể cả dấu, trị tuyệt đối của
 * số mũ tối đa `SO_MU_TOI_DA`. Một số ngoài biên đẩy CẢ bản rõ sang `{ raw }`.
 *
 * Hai biên an toàn, không phải giới hạn sản phẩm; mỗi biên canh một thứ đã đo trên PostgreSQL 16.15:
 *   ⑴ trần của `numeric` — số nguyên 131 072 chữ số và `0.` cùng 16 383 chữ số thập phân thì nhận; thêm một chữ số, hay `1e131072`,
 *      `1e-16384`, thì ném `22003`, tức CẢ lượt mở thầu rollback. Trong hai biên, phần nguyên lẫn phần thập phân của giá trị không quá
 *      1 324 chữ số;
 *   ⑵ độ phình khi ĐỌC — `numeric` in ra đủ mọi chữ số: `1e131071`, tám ký tự, đọc lại qua `payload::text` là 131 072 ký tự. Số mũ 324
 *      phủ mọi số mà `JSON.stringify` của JavaScript viết ra (`5e-324` tới `1.7976931348623157e+308`), và giữ độ phình gần bản cũ: bản
 *      cũ đi qua `double` vốn đã cất được số 309 chữ số phần nguyên, còn `1e324` nay đọc lại 325 ký tự (đo). Ở ca xấu nhất — bản rõ toàn
 *      phần tử `1e324,` so với toàn `1e308,` của bản cũ — độ phình hơn khoảng 5% (lượt soi 58, tính theo `numeric_out`, chưa đo).
 * Văn bản dài 1 000 ký tự gấp nhiều lần mọi con số của một báo giá.
 */
const DO_DAI_SO_TOI_DA = 1000;
const SO_MU_TOI_DA = 324;

/** Khoảng trắng của ngữ pháp JSON: dấu cách, tab, xuống dòng, về đầu dòng. */
function laKhoangTrangJson(ma: number): boolean {
  return ma === 0x20 || ma === 0x09 || ma === 0x0a || ma === 0x0d;
}

/** Ký tự có thể đứng trong văn bản một số JSON: chữ số, `.`, `+`, `-`, `e`, `E`. */
function laKyTuCuaSo(ma: number): boolean {
  return (ma >= 0x30 && ma <= 0x39) || ma === 0x2e || ma === 0x2b || ma === 0x2d || ma === 0x65 || ma === 0x45;
}

/**
 * [khoản nợ 107] Văn bản số `van[dau, cuoi)` nằm trong biên của `DO_DAI_SO_TOI_DA` và `SO_MU_TOI_DA`. Số mũ đọc theo trị tuyệt đối,
 * số 0 đứng đầu nó không tính, và phép đọc dừng ngay khi vượt biên — nên một số mũ dài bao nhiêu cũng không tràn.
 */
function soTrongBien(van: string, dau: number, cuoi: number): boolean {
  if (cuoi - dau > DO_DAI_SO_TOI_DA) return false;
  let i = dau;
  while (i < cuoi && van.charCodeAt(i) !== 0x65 && van.charCodeAt(i) !== 0x45) i += 1;
  let soMu = 0;
  for (i += 1; i < cuoi; i += 1) {
    const ma = van.charCodeAt(i);
    if (ma >= 0x30 && ma <= 0x39) {
      soMu = soMu * 10 + (ma - 0x30);
      if (soMu > SO_MU_TOI_DA) return false;
    }
  }
  return true;
}

/**
 * [khoản nợ 107] Quét MỘT lượt văn bản JSON mà `JSON.parse` VỪA nhận: trả số token KHOÁ — chuỗi mà ký tự khác khoảng trắng kế tiếp là
 * dấu hai chấm — hoặc `null` khi văn bản của một số vượt biên (`soTrongBien`). Không cấp phát gì trên đường đi.
 *
 * Chỉ đúng với văn bản JSON HỢP LỆ, và lập luận dựa hẳn vào điều ấy: ngoài chuỗi, dấu trừ và chữ số chỉ mở đầu một số; trong chuỗi,
 * gạch chéo ngược thoát đúng MỘT ký tự kế nó, nên dấu nháy đứng sau nó không đóng chuỗi. Chữ số, ngoặc và dấu hai chấm nằm TRONG chuỗi
 * bị bỏ qua. Với một đối tượng JSON hợp lệ, phép so `i < van.length` ở vòng chuỗi và vòng khoảng trắng không bao giờ sai trước khi gặp
 * dấu nháy đóng hay một ký tự khác khoảng trắng; chúng ở đó để một lỗi ở chỗ khác không thành một vòng lặp vô tận.
 */
function demKhoaVanBan(van: string): number | null {
  let soKhoa = 0;
  let i = 0;
  while (i < van.length) {
    const ma = van.charCodeAt(i);
    if (ma === 0x22) {
      i += 1;
      while (i < van.length && van.charCodeAt(i) !== 0x22) i += van.charCodeAt(i) === 0x5c ? 2 : 1;
      i += 1;
      while (i < van.length && laKhoangTrangJson(van.charCodeAt(i))) i += 1;
      if (van.charCodeAt(i) === 0x3a) soKhoa += 1;
    } else if (ma === 0x2d || (ma >= 0x30 && ma <= 0x39)) {
      let cuoi = i + 1;
      while (cuoi < van.length && laKyTuCuaSo(van.charCodeAt(cuoi))) cuoi += 1;
      if (!soTrongBien(van, i, cuoi)) return null;
      i = cuoi;
    } else {
      i += 1;
    }
  }
  return soKhoa;
}

/**
 * Chuyển bản rõ thành `jsonb`.
 *
 * MỘT QUYẾT ĐỊNH VỀ SẴN SÀNG, không phải về định dạng: nếu bản rõ không phải một đối tượng JSON
 * thì nó được cất dưới `{ "raw": "..." }` thay vì làm cả lượt mở thầu hỏng. Một nhà cung cấp gửi
 * rác — cố ý hay do lỗi trình duyệt — KHÔNG được phép chặn việc mở báo giá của những người khác.
 *
 * ~~Bản rõ không bao giờ bị VỨT ĐI: nó luôn tới được `rfq_unsealed_bids`, chỉ khác hình dạng.~~
 * [lượt soi 56 I2, C1, N2 — ĐO] Nói quá: một bản rõ JSON HỢP LỆ mà `jsonb` hay `JSON.stringify` không nhận — escape của
 * U+0000 trong một chuỗi hay một khoá (`22P05`), escape surrogate đơn lẻ (`22P02`), mảng lồng từ 5 000 tầng (`RangeError`)
 * ~~— làm CẢ lượt mở thầu rollback ở mọi lần thử, báo giá sạch cũng không mở được. Khoản nợ 106.~~
 * **[S1.64, khoản nợ 106 ĐÓNG]** Nay ~~`jsonbNhanDuoc`~~ `demKhoaJsonbNhan` (tên từ S1.65) nhận ra các bản rõ ấy sau `JSON.parse`, và
 * chúng được cất dưới `{ raw }`;
 * lượt mở thầu chạy trọn. `raw` là văn bản ĐÃ GIẢI MÃ, không phải byte của bản rõ: `TextDecoder` bỏ BOM đầu và thay byte hỏng
 * bằng U+FFFD, rồi U+0000 THÔ bị gỡ (lượt soi 57). Đường `{ raw }` cất được với mọi bản rõ: văn bản ấy không mang surrogate đơn
 * lẻ (`TextDecoder` không sinh ra) cũng không mang U+0000, `JSON.stringify` thoát gạch chéo ngược lẫn ký tự điều khiển, và độ sâu
 * là 1. Ranh giới nói ra: ⑴ cụm mã hoá UTF8, và `client_encoding` của phiên là UTF8 — một `SET` phạm vi phiên đi theo kết nối
 * trong pool (khoản 104); ⑵ phong bì tối đa 8 MiB nên giới hạn kích thước của `jsonb` không chạm tới — nhưng trần ấy là một
 * `CHECK` (018), đúng lớp của khoản 105; ⑶ `JSON.parse` dựng trọn cây trước phép đi cây, và hết bộ nhớ không phải một ngoại lệ
 * bắt được (chưa đo). Câu gạch đầu đoạn vẫn gạch: U+0000 THÔ bị gỡ khỏi `raw` không để lại dấu — nhưng một bản rõ mang nó không
 * còn thành JSON có cấu trúc (lượt soi 57 NẶNG-1).
 *
 * [REVIEW AN NINH S1.6 — HIGH-1] `U+0000` BỊ GỠ, VÀ ĐÓ LÀ MỘT LỖ HỔNG SẴN SÀNG CÓ THẬT.
 * Kiểu `jsonb` của PostgreSQL KHÔNG biểu diễn được `U+0000` trong chuỗi — nó ném `22P05`. Câu
 * bảo đảm ở đoạn trên được viết cho bước GIẢI MÃ, còn bước GHI thì không được che: một byte NUL
 * duy nhất trong bản rõ của MỘT nhà cung cấp làm cả giao dịch rollback, và lượt mở thầu ấy hỏng
 * lại y hệt ở mọi lần thử lại. Tức một nhà cung cấp khoá được cả cuộc thầu bằng một byte.
 *
 * Gỡ ở đây, chứ không chỉ bắt lỗi ở chỗ ghi: một `payload` không cất được là dữ liệu đã MẤT, còn
 * ~~một `payload` đã gỡ NUL là dữ liệu đã cất được kèm một sai lệch đọc được từ chính nó.~~ một `payload` đã gỡ NUL
 * là dữ liệu đã cất được — nhưng sai lệch ấy KHÔNG đọc được từ chính nó: U+0000 bị gỡ không để lại dấu (lượt soi 56 I2).
 * **[S1.64, lượt soi 57 NẶNG-1]** Bước gỡ nay chạy SAU `JSON.parse` và chỉ trên `raw`. Gỡ TRƯỚC khi phân tích — như bản S1.6 —
 * biến một văn bản KHÔNG hợp lệ thành JSON hợp lệ mang nội dung khác mà không để lại dấu: `{"a␀":1,"a":2}` thành `{"a":2}`, và
 * `{"totalAmount":1␀5}` thành số 15 (␀ là U+0000 THÔ; đo trên Node 24.18).
 *
 * **[S1.65, khoản nợ 107 ĐÓNG] SỐ GIỮ NGUYÊN GIÁ TRỊ — `jsonb` PHÂN TÍCH CHÍNH VĂN BẢN GỐC.** Tới S1.64 hàm này trả đối tượng mà
 * `JSON.parse` dựng ra và người gọi ghi `JSON.stringify` của nó, nên mọi số đi qua `double`: `99999999999999.99` thành `…98`,
 * `9007199254740993` thành `…992`, và `bid_so_tien` nhận con số đã đổi (đo S1.64). Nay hàm trả VĂN BẢN để ghi: văn bản gốc khi `jsonb`
 * nhận nó, `{ raw }` khi không. `numeric` của PostgreSQL là số thập phân chính xác, nên số giữ nguyên GIÁ TRỊ — không giữ nguyên chữ
 * viết: `1E2` đọc lại là `100`, `1.50e1` là `15.0`, `-0` là `0` (đo trên PostgreSQL 16.15).
 * Văn bản gốc chỉ được ghi khi đủ BA vế, mỗi vế chặn một thứ `JSON.parse` nhận mà `jsonb` từ chối hay đọc khác:
 *   ⑴ `demKhoaJsonbNhan` trả một số — chuỗi, khoá và độ sâu của cây trong miền `jsonb` (khoản 106);
 *   ⑵ `demKhoaVanBan` trả ĐÚNG số ấy — không có khoá trùng. `JSON.parse` và `jsonb` cùng giữ giá trị SAU CÙNG của khoá trùng, nhưng
 *      `jsonb` vẫn phân tích giá trị bị ghi đè: escape surrogate đơn lẻ ở đó ném `22P02`, escape U+0000 ném `22P05` (đo) — mà cây của
 *      `JSON.parse` không còn giá trị ấy, nên vế ⑴ không thấy. Cất dưới `{ raw }`, khoá trùng giữ được CẢ HAI giá trị thay vì mất một
 *      giá trị không dấu vết (cùng hướng lượt soi 56 C1);
 *   ⑶ văn bản của mọi số trong biên (`soTrongBien`) — ngoài biên, `numeric` ném `22003` hay phình khi đọc.
 * Không đọc số bằng reviver của `JSON.parse` kèm `context.source` và `JSON.rawJSON`: đo trên Node 24.18, bản rõ 8 MiB gồm 4,19 triệu số
 * `0` mất 2 941 ms và 604 MiB RSS với reviver, 29 ms và 84 MiB không reviver; `JSON.parse` trơn cộng phép đi cây và phép quét mất khoảng
 * 90 ms và 96 MiB. Reviver nhân bộ nhớ của worker lên khoảng bảy lần bằng đúng một báo giá.
 * Ranh giới nói ra: `demKhoaVanBan` chỉ đúng với văn bản `JSON.parse` VỪA nhận; `payload` đọc qua `pg` lại đi qua `JSON.parse`, nên số
 * trong nó lại qua `double` ở phía người đọc (khoản 108); cụm mã hoá và `client_encoding` UTF8 như đường `{ raw }`.
 */
function thanhJson(banRo: Uint8Array): string {
  const van = new TextDecoder("utf-8", { fatal: false }).decode(banRo);
  try {
    // Phân tích văn bản GỐC. JSON không cho U+0000 THÔ đứng ở bất kỳ đâu — trong chuỗi, trong khoá, giữa hai token, đầu hay cuối
    // văn bản — nên bản rõ mang nó ném ở đây (đo trên Node 24.18 ở cả sáu vị trí) và đi vào `raw`.
    const doc: unknown = JSON.parse(van);
    if (typeof doc === "object" && doc !== null && !Array.isArray(doc)) {
      // [khoản nợ 107] Ba vế ở chú thích hàm. Đủ cả ba thì `jsonb` phân tích chính văn bản gốc, và mọi số giữ nguyên giá trị.
      const soKhoa = demKhoaJsonbNhan(doc);
      if (soKhoa !== null && demKhoaVanBan(van) === soKhoa) return van;
    }
  } catch {
    // Không phải JSON hợp lệ.
  }
  return JSON.stringify({ raw: van.replace(/\u0000/gu, "") });
}

/**
 * [D1 vế 2+3+4, C3, D2, G4] Chạy một yêu cầu mở thầu ĐÃ ĐƯỢC PHÊ DUYỆT.
 *
 * Người gọi phải mở transaction và phải nối bằng role `app_unseal`. Hàm này KHÔNG tự `BEGIN`:
 * bản rõ, mốc `EXECUTED` và trạng thái `UNSEALED` phải cùng sống hoặc cùng chết.
 */
export async function executeUnsealRequest(
  client: pg.PoolClient,
  orgId: string,
  input: ExecuteUnsealInput,
): Promise<UnsealOutcome> {
  await assertTenantBound(client, orgId, "executeUnsealRequest");
  if (!UUID_PATTERN.test(input.unsealRequestId)) {
    throw new UnsealWorkerError("unsealRequestId phải là UUID hợp lệ.");
  }

  const { rows: yc } = await client.query<HangYeuCau>(
    "SELECT rfq_id, status, dispatched_by, dispatched_by_session_id FROM public.unseal_requests " +
      " WHERE id OPERATOR(pg_catalog.=) $1 AND org_id OPERATOR(pg_catalog.=) $2 FOR NO KEY UPDATE",
    [input.unsealRequestId, orgId],
  );
  const r = yc[0];
  if (r === undefined) {
    throw new UnsealWorkerError("không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn");
  }
  if (r.status !== "APPROVED") {
    // Lớp này KHÔNG phải lớp có thẩm quyền — trigger `rfq_unsealed_bids_kiem_yeu_cau` (019) mới
    // là lớp ấy. Nó ở đây để thông báo nói được VÌ SAO, và để không tốn một lần mở bọc khoá.
    throw new UnsealWorkerError(
      `yêu cầu mở thầu phải ở trạng thái APPROVED để chạy; đang ở ${r.status}`,
    );
  }

  // [D1 vế 2, đo LẠI ở thời điểm GIẢI MÃ] Xem khối [HIGH-3] ở đầu file. Một phiên bị thu hồi
  // ngay sau khi điều phối KHÔNG còn dẫn tới một lượt mở thầu chạy trọn.
  if (r.dispatched_by_session_id === null || r.dispatched_by === null) {
    throw new UnsealWorkerError(
      "yêu cầu mở thầu không mang phiên đã điều phối — không kiểm lại được MFA (D1 vế 2)",
    );
  }
  await assertFreshMfa(client, {
    sessionId: r.dispatched_by_session_id,
    userId: r.dispatched_by,
    orgId,
    maxAgeSeconds: input.maxMfaAgeSeconds ?? UNSEAL_DECRYPT_MFA_MAX_AGE_SECONDS,
  });

  // [REVIEW AN NINH S1.6 — LOW-3] Lấy MỌI khoá còn hiệu lực, và ném nếu một thuật toán có HAI
  // hàng. Bản trước lấy `khoa[0]` không `ORDER BY`: hai hàng còn hiệu lực làm mọi phong bì rơi
  // vào nhánh thất bại trong khi hàm vẫn báo thành công và vẫn lật RFQ sang `UNSEALED`.
  const { rows: khoa } = await client.query<HangKhoa>(
    `SELECT algorithm, wrapped_private_key, key_version
       FROM public.rfq_key_material
      WHERE rfq_id OPERATOR(pg_catalog.=) $1 AND org_id OPERATOR(pg_catalog.=) $2 AND revoked_at IS NULL
      ORDER BY algorithm`,
    [r.rfq_id, orgId],
  );
  const theoThuatToan = new Map<string, HangKhoa>();
  for (const k of khoa) {
    if (theoThuatToan.has(k.algorithm)) {
      throw new UnsealWorkerError(
        `RFQ có HAI vật liệu khoá còn hiệu lực cho ${k.algorithm} — không chọn hộ được`,
      );
    }
    theoThuatToan.set(k.algorithm, k);
  }
  if (theoThuatToan.size === 0) {
    throw new UnsealWorkerError("RFQ không có vật liệu khoá còn hiệu lực để mở thầu");
  }

  // Chỉ lấy PHIÊN BẢN CUỐI của mỗi luồng báo giá. B1 giữ mọi phiên bản để không ai sửa lén được
  // thứ đã nộp; mở thầu thì chỉ mở thứ nhà cung cấp muốn được chấm — bản cuối trước hạn.
  const { rows: phongBi } = await client.query<HangPhongBi>(
    `SELECT DISTINCT ON (v.bid_id) v.id, v.envelope
       FROM public.vendor_bid_versions v
       JOIN public.vendor_bids b ON b.id OPERATOR(pg_catalog.=) v.bid_id AND b.org_id OPERATOR(pg_catalog.=) v.org_id
       JOIN public.rfq_invitations i ON i.id OPERATOR(pg_catalog.=) b.invitation_id AND i.org_id OPERATOR(pg_catalog.=) b.org_id
      WHERE i.rfq_id OPERATOR(pg_catalog.=) $1 AND v.org_id OPERATOR(pg_catalog.=) $2
      ORDER BY v.bid_id, v.version DESC`,
    [r.rfq_id, orgId],
  );

  // ---------------------------------------------------------------------------------------
  // [REVIEW AN NINH S1.4 — HIGH-1] KHOÁ ĐƯỢC CHỌN THEO THỨ PHONG BÌ TỰ KHAI, KHÔNG THEO MỘT
  // HẰNG SỐ CHÉP TAY.
  //
  // Bản trước đọc `WHERE algorithm = 'ECDH_P256'` và truyền `algorithm: "ECDH_P256"` vào
  // `unsealBid`. Cùng lúc đó `issueRfqKeyPair` mặc định sinh CẢ HAI cặp khoá và
  // `chooseKeyAgreementAlgorithm` **ưu tiên X25519**. Hệ quả: một nhà cung cấp dùng trình duyệt
  // hiện đại niêm phong bằng X25519, NHẬN MỘT BIÊN NHẬN ĐÃ KÝ chứng minh nộp đúng hạn, rồi báo
  // giá của họ rơi vào nhánh `failed` trong im lặng — và `app_api` không đọc được `envelope` nên
  // sau đó không ai khôi phục hay chẩn đoán được nữa.
  //
  // Đây là lý do định dạng phong bì TỰ MÔ TẢ ngay từ ADR-011: `describeEnvelope` đọc mã thuật
  // toán từ chính header đã được AAD ràng buộc, nên nó không nói dối được mà không hỏng tag.
  // ---------------------------------------------------------------------------------------
  const khoaRieng = new Map<KeyAgreementAlgorithm, Uint8Array>();
  let opened = 0;
  const failedBidVersionIds: string[] = [];
  try {
    for (const pb of phongBi) {
      const byte = new Uint8Array(pb.envelope);
      let banRo: Uint8Array;
      try {
        const thuatToan = describeEnvelope(byte).algorithm;
        if (!laThuatToanBiet(thuatToan)) throw new UnsealWorkerError("thuật toán lạ");
        let rieng = khoaRieng.get(thuatToan);
        if (rieng === undefined) {
          const k = theoThuatToan.get(thuatToan);
          if (k === undefined) throw new UnsealWorkerError("RFQ không có khoá cho thuật toán này");
          rieng = await input.unwrapper.unwrap(orgId, {
            ciphertext: new Uint8Array(k.wrapped_private_key),
            keyVersion: k.key_version,
          });
          khoaRieng.set(thuatToan, rieng);
        }
        banRo = await unsealBid({
          rfqId: r.rfq_id,
          algorithm: thuatToan,
          envelope: byte,
          recipientPrivateKey: rieng,
        });
      } catch {
        // Một phong bì hỏng KHÔNG dừng lượt mở thầu. Lý do KHÔNG được ghi vào payload: ba nguyên
        // nhân (sai khoá, sai RFQ, bị sửa) cho cùng một câu, và phân biệt được chúng là một oracle.
        failedBidVersionIds.push(pb.id);
        continue;
      }
      try {
        await client.query(
          `INSERT INTO public.rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload)
           VALUES ($1, $2, $3, $4)`,
          [orgId, input.unsealRequestId, pb.id, thanhJson(banRo)],
        );
        opened += 1;
      } finally {
        // [REVIEW AN NINH S1.6 — LOW-2] Bản rõ cũng là bí mật, không chỉ khoá. Chuỗi mà
        // `thanhJson` dựng ra thì bất biến và không xoá được — ghi ra như một dư lượng đã biết
        // thay vì im lặng.
        banRo.fill(0);
      }
    }
  } finally {
    // Cùng khuôn `pkcs8.fill(0)` ở `sealed-envelope/src/key-material.ts`: một lần ném giữa chừng
    // không được để lại khoá riêng RFQ nguyên vẹn trong heap.
    for (const rieng of khoaRieng.values()) rieng.fill(0);
  }

  // [G4] Vế "MỞ BỌC" của mệnh đề *"mọi thao tác khoá — sinh, bọc, mở bọc, huỷ — đều sinh audit"*.
  // Ở S1.4 vế này không có một dòng mã nào, và ghi chú §4 của G4 nói đúng thế. Dòng dưới đây là
  // vế ấy — và nó ghi được vì `app_unseal` có quyền INSERT theo cột trên `audit_events` (003/004).
  await appendAuditEvent(client, orgId, {
    actorType: "SERVICE",
    actorId: null,
    action: "RFQ_KEY_MATERIAL_UNWRAPPED",
    resourceType: "rfq_key_material",
    resourceId: r.rfq_id,
    payload: {
      unsealRequestId: input.unsealRequestId,
      algorithms: [...khoaRieng.keys()].sort(),
      opened,
      failedBidVersionIds,
    },
  });

  // [REVIEW AN NINH S1.6 — LOW-1] Hai câu kết thúc mang `org_id` TƯỜNG MINH và một vế trạng
  // thái, và `rowCount` được kiểm. `runner.ts` của outbox đã ghi rằng *"RLS đã thu hẹp tập hàng"*
  // là một câu ĐO ĐƯỢC LÀ SAI với một phiên `BYPASSRLS`; worker không được là chỗ ngoại lệ.
  const kt1 = await client.query(
    "UPDATE public.unseal_requests SET status = 'EXECUTED', executed_at = pg_catalog.now() " +
      " WHERE id OPERATOR(pg_catalog.=) $1 AND org_id OPERATOR(pg_catalog.=) $2 AND status OPERATOR(pg_catalog.=) 'APPROVED'",
    [input.unsealRequestId, orgId],
  );
  if (kt1.rowCount !== 1) {
    throw new UnsealWorkerError("không đóng được yêu cầu mở thầu — trạng thái đã đổi giữa chừng");
  }
  const kt2 = await client.query(
    "UPDATE public.rfq_packages SET status = 'UNSEALED' WHERE id OPERATOR(pg_catalog.=) $1 AND org_id OPERATOR(pg_catalog.=) $2 AND status OPERATOR(pg_catalog.=) 'CLOSED'",
    [r.rfq_id, orgId],
  );
  if (kt2.rowCount !== 1) {
    throw new UnsealWorkerError("không tuyên bố được RFQ đã UNSEALED — trạng thái đã đổi giữa chừng");
  }

  await appendAuditEvent(client, orgId, {
    actorType: "SERVICE",
    actorId: null,
    action: "RFQ_UNSEALED",
    resourceType: "rfq_package",
    resourceId: r.rfq_id,
    payload: { unsealRequestId: input.unsealRequestId, opened, failedBidVersionIds },
  });

  return {
    unsealRequestId: input.unsealRequestId,
    rfqId: r.rfq_id,
    opened,
    failedBidVersionIds,
  };
}

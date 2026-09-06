// =============================================================================================
// PHẦN PHÁN XÉT CỦA BỘ SINH — CẤU HÌNH ĐƯỢC GHIM, KHÔNG PHẢI BẢO ĐẢM ĐƯỢC NỚI (QT2)
//
// Brief của Task 11 đề nghị đặt `continue-on-error: true` cho job `evidence` vì ma trận còn đỏ
// tới hết S1. Lý do chính đáng, NHƯNG nó là fail-open và IM LẶNG: một job xanh-nhưng-thực-ra-đỏ.
// Trả lời QT1 cho thiết kế đó — *ai nhìn thấy nó đỏ, bằng cách nào, trong bao lâu?* — cho ra
// **không ai, không bằng cách nào, không bao giờ**: `continue-on-error` không sinh ra chú thích
// nào trên PR, và không một lượt review nào bắt buộc phải mở log của một job đã xanh.
//
// Cách làm ở đây đảo chiều: GHIM DANH SÁCH các mã được phép chưa phủ ở cuối S0, mỗi mã một lý
// do đọc được, rồi cho job ĐỎ THẬT khi một mã NGOÀI danh sách chưa phủ. Trả lời QT1 lúc này:
// người mở PR nhìn thấy, ngay trên cổng CI bắt buộc, trong một lượt chạy.
//
// Danh sách này là RÀNH BUỘC HAI CHIỀU, và chiều thứ hai mới là chiều quan trọng: một mã trong
// danh sách mà ĐÃ ĐƯỢC PHỦ cũng làm bộ sinh ĐỎ, kèm lời nhắc gỡ nó ra.
//
// *** CÂU DƯỚI ĐÂY SAI. ĐÃ ĐO. GIỮ NGUYÊN VĂN ĐỂ ĐỐI CHIẾU, KHÔNG XOÁ. ***
//   >>> "Nhờ vậy danh sách chỉ co lại, không bao giờ nở ra trong im lặng — nếu thiếu chiều đó
//   >>>  thì nó lại đúng là một `continue-on-error` viết dài hơn."
//
// VÌ SAO NÓ SAI — HAI MŨI, ĐO TRÊN CHÍNH BỘ SINH NÀY, CẢ HAI CHO exit=0 + "Cổng evidence: XANH":
//   (1) XOÁ mọi khẳng định `[INV-F3]` khỏi `evidence/vitest-report.json` (F3 tụt về CHƯA PHỦ)
//       VÀ thêm `F3` vào danh sách, TRONG CÙNG MỘT LƯỢT -> 23/47, không một dòng đỏ nào, và §3
//       in ra một LÝ DO như thể nó là một quyết định có thẩm quyền. Một HỒI QUY ĐỘ PHỦ đi lọt.
//   (2) Thêm một mã mới (`G9`) vào SỔ ĐĂNG KÝ *và* vào danh sách -> 24/48: danh sách NỞ RA,
//       mẫu số nở ra, tử số đứng yên.
// Chiều thứ hai chỉ kích hoạt khi `coTest && trongDs`, nên nó KHÔNG bắt được hai thay đổi BÙ
// TRỪ NHAU trong cùng một PR. Câu ĐÚNG với cơ chế ấy chỉ là: *một mã ĐÃ PHỦ mà còn nằm trong
// danh sách thì đỏ*. "Danh sách chỉ co lại" KHÔNG phải hệ quả của nó — muốn có thì phải ĐO,
// và đó là việc của `MOC_GHIM` / `kiemTraMocGhim` bên dưới: hai con số nằm trong repo, đi qua
// CODEOWNERS, biến một CÂU VĂN thành một PHÉP ĐO.
// =============================================================================================

import type { Invariant, TestOutcome } from "./parse.js";

export type NhanKetQua = "✅ ĐẠT" | "🔴 ĐANG ĐỎ" | "⚠️ BỊ BỎ QUA" | "⏳ CHƯA PHỦ";

export interface KetQuaHang {
  readonly nhan: NhanKetQua;
  /** Có ít nhất một test mang nhãn của mã này. KHÔNG đồng nghĩa với "đạt". */
  readonly coTest: boolean;
  /** Trạng thái này chặn merge. */
  readonly chan: boolean;
}

/**
 * MÃ ĐƯỢC PHÉP CHƯA PHỦ Ở CUỐI S0 — 23 mã, mỗi mã một lý do.
 *
 * Ba nguồn của lý do, không được lẫn lộn: (a) chủ ngữ của bất biến chưa tồn tại trong mã sản
 * phẩm; (b) một task trước đã CỐ Ý BỎ thẻ kèm phép đo; (c) lớp cưỡng chế chưa được viết.
 * Trạng thái ĐÚNG của một hàng trống là "chưa phủ, có lý do" — nguy hiểm không nằm ở chỗ nó
 * trống, mà đến khi ai đó LẤP NÓ BẰNG NHÃN THAY VÌ BẰNG LỚP.
 */
export const MA_DUOC_PHEP_CHUA_PHU: ReadonlyMap<string, string> = new Map([
  // --- Nhóm A: toàn bộ bí mật giá. Chủ ngữ là RFQ + phong bì niêm phong, thuộc S1. ---
  // [S1.6] A1 ĐÃ ĐƯỢC GỠ. Lý do cũ ("không có endpoint nào, và không có trường giá nào") hết
  // hiệu lực theo một chiều bất thường: trường giá NAY CÓ (`rfq_unsealed_bids.payload`), và
  // chính vì thế mệnh đề mới có chủ ngữ. Mang cờ PHẠM VI HẸP — xem §4.
  // [S1.8] Lý do cũ HẾT ĐÚNG và được viết lại — không xoá. Nguyên văn: *"S1 — mã hoá phía trình
  // duyệt (ADR-007) chưa có"*. S1.4 dựng xong đường ấy (`sealBid` chạy bằng WebCrypto), nên vế ấy
  // không còn là lý do. Lý do THẬT thì khác hẳn, và nặng hơn.
  ["A2", "S2+ — CHỦ NGỮ ĐÃ CÓ, THIẾT BỊ ĐO THÌ CHƯA. Ba vế của mệnh đề nói về MỘT TIẾN TRÌNH `api` ĐANG CHẠY: bộ nhớ, APM trace, thông báo lỗi. `apps/` chỉ có một worker mở thầu; không có tiến trình `api` nào để gắn một heap dump hay một APM agent vào. Phần ĐÃ đo được thì nằm ở chỗ khác và đã mang ô của nó: A1 (bảng bản rõ rỗng trước mở thầu), A3 (quét năm bảng dưới superuser) và G1 (`app_api` không đọc được `envelope`). Cái còn thiếu là một phép đo TRÊN TIẾN TRÌNH, và nó đòi một tầng HTTP."],
  // [S1.5] A3 ĐÃ ĐƯỢC GỠ. Lý do cũ ("bảng bid chưa tồn tại") hết hiệu lực: `vendor_bid_versions`
  // nay tồn tại, không có một cột giá nào, và giá dạng rõ được QUÉT trên dữ liệu thật ở NĂM bảng
  // dưới superuser. Mang cờ PHẠM VI HẸP — xem §4.
  // [S1.7] A4 và A6 rời danh sách này. A4 rời với một THU HẸP được ghi ở §4: bộ quét đã có, nhưng
  // nó quét TẦNG DỮ LIỆU chứ không quét OpenAPI — lý do cũ ("đòi OpenAPI và endpoint") vẫn đúng
  // về endpoint và vì thế đi vào §4 thay vì biến mất. A6 rời với một thu hẹp KHÁC HẲN: cột
  // "Cưỡng chế" của nó ghi *"Ứng dụng"*, và hàng rào ứng dụng thì một câu SQL viết tay đi vòng
  // qua được — có test ĐO đúng điều đó thay vì để nó thành phỏng đoán.
  // [S1.8] Lý do cũ HẾT ĐÚNG và được viết lại — không xoá. Nguyên văn: *"S1 — chưa có nhà cung
  // cấp, lời mời, hay ID báo giá"*. Cả ba nay đều có từ S1.1/S1.3/S1.5. Lý do thật là CẤU TRÚC.

  // --- Nhóm B: hai mã đòi luồng nộp thầu; B5 đòi job định kỳ. ---
  // [S1.5] B1 và B2 ĐÃ ĐƯỢC GỠ. Nguyên văn hai lý do cũ, giữ để đối chiếu:
  //   B1 — "bảng `vendor_bid_versions` chưa tồn tại."
  //   B2 — "biên nhận nộp thầu đòi RFQ, ciphertext báo giá và chữ ký hệ thống; không thứ nào có ở S0."
  //
  // B1 **KHÔNG** mang cờ phạm vi hẹp, và việc đó là một QUYẾT ĐỊNH chứ không phải một lần quên.
  // Phần chênh duy nhất còn lại của nó là *"một superuser `DISABLE TRIGGER` rồi xoá"* — nhưng đó
  // là DDL, không phải DML, và nó đúng với MỌI bất biến dựa trên trigger của dự án, kể cả B4 vốn
  // đã mang ô ✅ từ S0 mà không có ghi chú ấy. Thêm nó vào riêng B1 sẽ là một câu đúng đặt sai
  // chỗ: nó thuộc về một ghi chú CHUNG về giới hạn của trigger, không thuộc về một hàng.
  // [S1.8] B5 ĐÃ ĐƯỢC GỠ. Lý do cũ, giữ để đối chiếu: *"S1/S6 — job kiểm tra ciphertext định
  // kỳ chưa tồn tại"*. Job ấy nay tồn tại (`auditStoredCiphertexts`), và migration 021 mở đúng ba
  // cột nó cần — trước đó KHÔNG ROLE NÀO chạy được phép so này, vì `envelope` chỉ `app_unseal`
  // đọc được còn `canonical_text` chỉ `app_api` đọc được. Mang cờ PHẠM VI HẸP: chữ *"định kỳ"*
  // trong chính lý do cũ VẪN chưa có chủ thể, và nó đi vào §4 thay vì biến mất.

  // --- Nhóm C: thời gian. C2/D4 do Task 10 CỐ Ý bỏ thẻ, kèm phép đo. ---
  // [S1.5] C1 ĐÃ ĐƯỢC GỠ — `deadline_at` và đường nộp thầu nay đều tồn tại, và phán quyết nằm
  // trong chính transaction ghi (trigger `bid_kiem_han_nop`, 018). Mang cờ PHẠM VI HẸP — xem §4.
  // [S1.8] C2 ĐÃ ĐƯỢC GỠ. Lý do cũ, giữ để đối chiếu: *"Task 10 CỐ Ý bỏ thẻ [INV-C2]: chủ ngữ
  // (RFQ, `deadline_at`, báo giá muộn) chưa có trong 001–007"*. Ba chủ ngữ ấy nay đều có, và phép
  // đo được dựng đúng theo hình dạng của mệnh đề: KHÔNG scheduler nào chạy, RFQ VẪN ở `OPEN` sau
  // hạn, mà báo giá muộn vẫn bị từ chối — kèm một khẳng định ĐỌC THÔNG BÁO LỖI để chắc rằng lời
  // từ chối đến từ phép so THỜI GIAN chứ không từ trạng thái. Mang cờ PHẠM VI HẸP — xem §4.
  // [S1.6] C3 ĐÃ ĐƯỢC GỠ, và nó KHÔNG mang cờ phạm vi hẹp — hiếm, nên nói ra lý do: mệnh đề
  // *"Mở thầu chỉ hợp lệ khi RFQ đã CLOSED"* có đúng MỘT vế, và vế ấy được giữ ở BA chỗ độc lập
  // (trigger lúc tạo yêu cầu, trigger trên cạnh `CLOSED -> UNSEALED`, và vế 3 của cổng D1).
  // Không có phần nào của câu chữ nằm ngoài thứ được đo.
  // [S1.8] C4 ĐÃ ĐƯỢC GỠ. Lý do cũ, giữ để đối chiếu: *"S1 — chưa có deadline để rút ngắn hay
  // gia hạn"*. Bốn vế đầu đã có từ S1.2 (trigger của 011 cộng `extendRfqDeadline`); vế thứ NĂM —
  // thông báo toàn bộ nhà cung cấp đã mời — là thứ S1.8 thêm vào, và nó là một job outbox cho MỖI
  // lời mời, ghi trong CÙNG giao dịch. Mang cờ PHẠM VI HẸP: *"thông báo"* ở đây là một Ý ĐỊNH
  // GỬI, không phải một lần giao tới tay ai — xem §4.
  // [S1.4] C5 ĐÃ ĐƯỢC GỠ khỏi danh sách này. Chủ ngữ của nó — `rfq_key_material` — nay tồn tại
  // (migration 017), và mệnh đề được cưỡng chế bởi một BỘ BA trigger chứ không bởi một câu lệnh
  // ứng dụng: không sớm hơn, không mồ côi, và chiều ngược lại. Mỗi vế có một phép đo riêng CỘNG
  // một phép đo ĐỘT BIẾN gỡ đúng lớp ấy đi và đòi cùng thao tác ĐI LỌT.

  // --- Nhóm D: hai mã còn lại. ---
  // [S1.6] D2 ĐÃ ĐƯỢC GỠ, và cũng KHÔNG mang cờ phạm vi hẹp — kể cả vế mà kế hoạch S1 §3 đã dự
  // đoán là KHÔNG cưỡng chế được ở tầng CSDL (*"hai phiên khác nhau ... là thuộc tính của phiên,
  // không của hàng"*). Dự đoán ấy sai theo hướng tốt: ADR-016 biến danh tính thành DẪN XUẤT của
  // một phiên, nên `approver_session_id` là một CỘT — và có cột thì có `UNIQUE`. Xem khối mở đầu
  // mục (2) của migration 019.
  // [S1.6] D4 ĐÃ ĐƯỢC GỠ. Nguyên văn lý do cũ, giữ để đối chiếu: *"Task 10 CỐ Ý bỏ thẻ
  // [INV-D4]: D4 đòi cảnh báo TỨC THÌ, còn outbox là POLL và độ trễ của nó bị chặn dưới bởi
  // `pollIntervalMs`; đường đúng là NOTIFY/LISTEN hoặc một đường đồng bộ."* ADR-010 chốt đúng
  // hình dạng ấy — outbox BỀN cộng `NOTIFY` ĐÁNH THỨC — và trigger của 019 làm cả hai trong
  // cùng giao dịch tạo yêu cầu. Mang cờ PHẠM VI HẸP — xem §4.

  // --- Nhóm E: magic link và OTP. ---
  // [S1.3] E1, E2 và E5 ĐÃ ĐƯỢC GỠ khỏi danh sách này: `packages/invitation` cộng migration 010
  // dựng đủ lớp cho cả ba. E2 và E5 đi kèm ghi chú §4 (xem PHAM_VI_HEP) — ô ✅ của chúng HẸP hơn
  // câu chữ ở sổ đăng ký, và phần chênh được nói ra thay vì nuốt vào.
  // E4 và E6 Ở LẠI, mỗi mã một lý do KHÁC nhau và cả hai đều KHÔNG phải "chưa kịp làm".
  //
  // *** [REVIEW AN NINH S1.3] E2 VÀ E5 TỪNG BỊ ĐƯA TRỞ LẠI DANH SÁCH NÀY, VÀ NAY ĐƯỢC GỠ LẠI ***
  // — nhưng gỡ vì một lý do KHÁC HẲN lần đầu. Lần đầu chúng được gỡ vì có test mang nhãn; lần
  // này chúng được gỡ vì CHUỖI TẤN CÔNG ĐÃ ĐƯỢC DỰNG LẠI VÀ BỊ CHẶN Ở TỪNG BƯỚC, mỗi bước một
  // test, và mỗi phép chặn kèm một vế đối chứng dương. Xem `packages/invitation/src/
  // invitation.int.test.ts` §"chuỗi tấn công của review an ninh, nay bị chặn ở từng bước".
  // Hai mã ấy được gỡ khỏi đây ở commit bca870f và điều đó SAI. Chuỗi tấn công đã được dựng lại
  // thành phép đo trên Postgres thật, và nó chạy trọn. Đây là lần đầu trong dự án `coDanhSachToiDa`
  // NỞ RA thay vì co lại — cơ chế `MOC_GHIM` được dựng để chặn đúng chiều đó, nên việc nới nó ở
  // đây là một quyết định phải nhìn thấy được, không phải một dòng lặng lẽ.
  // [S1.8] E4 ĐÃ ĐƯỢC GỠ. Lý do cũ, giữ để đối chiếu: *"đường xác thực của người mua chưa có
  // endpoint nào để đối kháng. Tầng test của nó là T5."* Tầng T5 nay TỒN TẠI
  // (`tests/adversarial/`), và kịch bản tấn công được dựng trọn: cầm ĐÚNG mã số thuế và ĐÚNG mã
  // RFQ của tổ chức A, kẻ tấn công không đọc được gì và không dựng được một phiên khách nào.
  // Mang cờ PHẠM VI HẸP — vế "chưa có endpoint" vẫn đúng và nó đi vào §4.
  ["E6", "S1 — VẪN chưa có URL nào. Magic link của S1.3 sinh ra một TOKEN, không sinh ra một URL: việc token đi vào đường dẫn, vào fragment, hay vào một form POST là quyết định của tầng HTTP, và `apps/` vẫn rỗng. Referrer-Policy cũng thuộc tầng đó. Đây là mã DUY NHẤT của nhóm E còn trống, và nó trống vì một lý do KIẾN TRÚC chứ không vì thiếu thời gian."],

  // --- Nhóm G: hai mã trống, hai lý do KHÁC NHAU. ---
  // [S1.4] G2 và G4 ĐÃ ĐƯỢC GỠ. Nguyên văn hai lý do cũ, giữ để đối chiếu:
  //   G2 — "khoá THEO RFQ đòi RFQ ... Cái S0 có là bọc khoá theo TỔ CHỨC có phiên bản."
  //   G4 — "CHƯA CÓ LỚP, không phải chưa có nhãn — `grep audit` trên crypto-keys = 0 hit."
  // Cả hai lý do nay hết hiệu lực: `packages/sealed-envelope` sinh khoá THEO RFQ và ghi sổ kiểm
  // toán ở cả hai thao tác nó có. CẢ HAI mã mang cờ PHẠM VI HẸP — xem §4, và phần chênh của G4
  // ("mở bọc" chưa tồn tại) là phần dễ bị nuốt nhất.
]);

/**
 * PHẠM VI THẬT HẸP HƠN MỆNH ĐỀ — cho những mã ĐÃ PHỦ mà bảo đảm đo được KHÔNG rộng bằng câu
 * chữ ở sổ đăng ký. Đây là phần dễ bị bỏ nhất của một evidence pack, và là phần một kiểm toán
 * viên hỏi tới thứ hai: một ô ✅ cạnh một mệnh đề rộng LÀ một phát biểu rộng hơn thứ được đo.
 */
export const PHAM_VI_HEP: ReadonlyMap<string, string> = new Map([
  ["A5", "**[khoản nợ 29, 2026-09-05] Ô ✅ NÀY HẸP HƠN MỆNH ĐỀ THEO HAI TRỤC, VÀ CẢ HAI ĐƯỢC GHI RA.** Lý do cũ, giữ nguyên văn để đọc được lịch sử: ~~S2+ (khoản nợ 29) — KHÔNG CÓ ROLE NÀO ĐỂ DIỄN ĐẠT CÂU HỎI. Mệnh đề nói về thứ MỘT NHÀ CUNG CẤP nhìn thấy, nhưng đường người mua và đường khách dùng CHUNG một role CSDL (`app_api`), nên không có lớp nào mà “nhà cung cấp truy vấn” khác “hệ thống truy vấn”.~~ `027` diễn đạt được câu hỏi ấy mà KHÔNG cần role thứ ba: policy `AS RESTRICTIVE` đọc `app.guest_session_id`, mặc định là TỪ CHỐI, và mọi bảng có RLS đều mang một policy `<bảng>_khach` — có lớp canh suy từ `pg_class.relrowsecurity` bắt bảng tiếp theo phải được quyết định. Đo bằng hai nhà cung cấp trên CÙNG một RFQ, kèm đối chứng dương và một mũi đột biến ĐỎ THẬT. **PHẦN CHÊNH THỨ NHẤT:** bảo đảm chỉ đứng KHI kết nối đã gắn phiên khách qua `withGuestSession()`. Một đường phục vụ khách quên gắn thì vị từ trả `NULL` và policy mở lại — hôm nay không có tầng HTTP nào để cưỡng chế việc gắn ấy, nên đó vẫn là kỷ luật ứng dụng. **PHẦN CHÊNH THỨ HAI, chưa nhúc nhích:** vế *“gián tiếp qua thời gian phản hồi”* là một phép đo T6 trên tải thật và chưa ai chạy. Vế ĐÃ được chốt và cưỡng chế từ trước: ADR-012 cấm UUIDv7/ULID nên không ID nào sắp theo thứ tự; và `version` của `vendor_bid_versions` đếm theo TỪNG luồng báo giá chứ không theo RFQ, nên nó không rò số người đã nộp."],
  ["D1", "~~**MỆNH ĐỀ HỘI BỐN VẾ, VÀ PHÉP HỘI CHƯA TỪNG ĐƯỢC ĐO MỘT LẦN NÀO.**~~ **[S1.6] PHÉP HỘI NAY ĐƯỢC ĐO, VÀ ĐO BẰNG MỘT CÁCH KHÁC ĐỘT BIẾN MÃ NGUỒN.** Nguyên văn cũ giữ để đối chiếu: *17 test mang nhãn tách làm ĐÚNG HAI cụm rời nhau — 12 test chỉ đo vế (2) MFA, 5 test chỉ đo vế (1) quyền; KHÔNG test nào đo hai vế cùng lúc, và vế (3) cùng vế (4) KHÔNG CÓ MỘT DÒNG MÃ NÀO.* Nay cả bốn vế nằm trong **một hàm** (`assertUnsealAllowed`), và phép hội được đo bằng khuôn *một trạng thái chỉ sai đúng một vế*: với mỗi vế i, dựng trạng thái mà CHỈ vế i sai rồi đòi cổng từ chối VÀ **gọi đúng tên vế i**. Cộng một đối chứng dương nơi cả bốn vế đúng. **PHẦN CHÊNH — VÀ NÓ ĐÃ HẸP LẠI MỘT LẦN, SAU KHI MỘT CÂU SAI BỊ BẮT.** Nguyên văn phần chênh cũ: *~~“cổng chạy lúc ĐIỀU PHỐI chứ không lúc GIẢI MÃ, và nó không chạy được ở worker vì `app_unseal` cố ý không đọc được `users` (002) hay ma trận quyền (005), nên HAI vế đầu là những câu worker KHÔNG HỎI ĐƯỢC”~~*. Vế `users` của câu ấy **SAI**, và review an ninh S1.6 (HIGH-3) đã chỉ ra: `006:232` cấp `SELECT (id, org_id, status) ON users TO app_unseal` và `006:305` cấp đúng sáu cột `sessions` mà `assertFreshMfa` đọc — 006 ghi rõ là cấp *“vì bất biến D1”*. Một câu sai đã biện minh cho việc không kiểm lại MFA ở đúng hành động KHÔNG THU HỒI ĐƯỢC của hệ thống. Nay `executeUnsealRequest` chạy LẠI `assertFreshMfa` trên phiên đã điều phối (022 thêm ba cột `dispatched_*` để có thứ mà hỏi), nên một phiên bị thu hồi giữa chừng KHÔNG còn dẫn tới một lượt mở thầu chạy trọn. **PHẦN CHÊNH CÒN LẠI, và chỉ còn một vế:** vế QUYỀN thật sự không hỏi được ở worker — `app_unseal` không có một GRANT nào trên `user_roles`/`role_permissions`/`permissions`. Một người bị GỠ QUYỀN nhưng còn giữ phiên hợp lệ, trong khoảng giữa điều phối và giải mã, vẫn dẫn tới một lượt mở thầu chạy trọn."],
  ["D5", "Được cưỡng chế cho đường đi **qua `requirePermission`**. Một lần từ chối ở tầng CSDL (RLS/GRANT) không sinh bản ghi nào, và một lần thử MFA thất bại **cố ý** không ghi sổ (ADR-008)."],
  ["E1", "**Vế *thu hồi được* đúng cho TOKEN, và chỉ cho token.** `revokeInvitation` giết được `redeemMagicLink`, nhưng nó KHÔNG chạm tới thách thức OTP đang mở và KHÔNG thu hồi phiên khách; đo được: sau khi thu hồi vẫn phát được OTP và vẫn mở được PHIÊN MỚI. Thêm một phần chênh thứ hai: `consumed_at` của token **không bao giờ được ghi** và `redeemMagicLink` cũng không đọc nó, nên magic link là một bearer token **chơi lại được cho tới khi hết hạn** — sổ đăng ký không đòi *dùng một lần* nên ô ✅ vẫn đứng, nhưng kịch bản T5 #9 (*dùng lại magic link đã dùng*) thì chưa có lớp nào."],
  ["E2", "**Hai vế đã được đóng, và phần chênh còn lại KHÔNG phải phần đã bị bắt.** Vế *token một mình không đủ* nay được cưỡng chế bằng KIỂU: `issueOtpChallenge` và `verifyOtpAndStartSession` đòi **token dạng rõ**, và trigger ở 012 đòi thách thức mang `token_id` của đúng lời mời. Vế *trên kênh đã đăng ký* nay đọc đích **từ `supplier_contacts`**, và `channel` quyết định CỘT nào được đọc — nhãn và sự thật là một thứ. PHẦN CHÊNH: *\"kênh đã đăng ký\"* vẫn là kênh do **NGƯỜI MUA KHAI** khi tạo người liên hệ (`supplier_contacts.phone`, do người mua nhập). Ô ✅ chống được *link bị chuyển tiếp* và *đích do người gọi chọn*; nó **không** chống được *người mua khai sai số*. Xem ADR-015."],
  ["E5", "Phiên khách ghi `verified_contact_id` **DẪN XUẤT từ thách thức OTP đã đối chiếu** — trigger `guest_sessions_kiem_danh_tinh` (012) đòi nó khớp `invitation_otp_challenges.contact_id`, và một câu INSERT viết tay khai một danh tính khác bị CSDL từ chối (có test). PHẦN CHÊNH: giá trị ấy là **NGƯỜI GIỮ KÊNH đã nhận OTP**, KHÔNG phải con người đang ngồi trước màn hình. Một người chuyển tiếp cả link LẪN mã OTP vừa đọc được cho đồng nghiệp thì hệ thống ghi nhận người giữ kênh, và không cơ chế nào trong S1 phân biệt được hai ca đó."],
  ["E3", "Sổ đăng ký định nghĩa E3 bằng **năm** vế. ~~Vế *giới hạn tần suất* **không có một dòng mã nào** trong toàn S0.~~ **[S1.3] Vế ấy nay CÓ LỚP — nhưng CHỈ trên đường OTP của LỜI MỜI** (`otp_rate_limits`, hai hạn mức với hai loại phản ứng, ADR-015 mục 5). **Đường TOTP của `packages/identity` VẪN KHÔNG CÓ giới hạn tần suất nào** — khoản nợ 1 thu hẹp lại, không đóng. Trần loạt đầu của vế *giới hạn số lần thử*: trên đường lời mời nó nay là một hằng số cấu hình thật (`FOR UPDATE` trên thách thức mới nhất), còn trên đường TOTP nó vẫn là độ đồng thời của kẻ tấn công."],
  ["E4", "**ĐO Ở TẦNG DỮ LIỆU; MỆNH ĐỀ NÓI VỀ MỘT ĐƯỜNG XÁC THỰC CHƯA CÓ ENDPOINT NÀO.** Thứ đã đo, và đo bằng một kịch bản tấn công dựng trọn: cùng một mã số thuế tồn tại được ở HAI tổ chức (ADR-013 ở dạng đo được — một `UNIQUE (tax_code)` toàn cục sẽ làm khẳng định ấy đỏ, và lúc ấy MST thành một danh tính toàn hệ thống); cầm ĐÚNG MST và ĐÚNG mã RFQ của tổ chức A, tổ chức B đọc được 0 hàng ở cả ba đường, kèm đối chứng dương dưới đúng tổ chức; không đường nào dựng được một phiên khách nếu chỉ có hai mã ấy (thiếu thách thức OTP, hoặc thách thức chưa đối chiếu, đều bị chặn), kèm đối chứng dương cho đường hợp pháp; và một lần quét NỘI DUNG bốn bảng trên đường xác thực cho thấy không bảng nào CẤT hai mã ấy. **PHẦN CHÊNH:** tất cả những phép đo trên chạy trên Postgres, không trên một đường đăng nhập. Chúng chứng minh hai mã ấy không phải credential TRONG DỮ LIỆU; chúng KHÔNG chứng minh một form đăng nhập tương lai sẽ từ chối chúng. Đó là T5 trên một tầng HTTP, và `apps/` chưa có tầng ấy. **PHẦN CHÊNH THỨ HAI, cùng họ với A3 và A4:** phép quét bốn bảng tìm MỘT CHUỖI đã biết; một mã cất ở dạng đã băm hay đã biến đổi sẽ đi lọt."],
  ["F1", "RLS + FORCE phủ mọi bảng tenant, `outbox_jobs` gồm cả. Hàng rào `assertTenantBound` ở tầng ứng dụng là lớp thứ hai và nó tự làm mù mình bằng DANH SÁCH TÊN ở hai chỗ đã đo: `NOBYPASSRLS` chỉ ghim đúng bốn tên role, và hàm plpgsql ngoài danh sách không được ghim."],
  ["G1", "~~**TÀI SẢN ĐƯỢC BẢO VỆ CHƯA TỒN TẠI.**~~ ~~**[S1.4] VẾ ẤY HẾT HIỆU LỰC**~~ **[S1.6] VÀ NAY CĂN PHÒNG ĐÃ ĐƯỢC XÂY.** Ba trạng thái nối tiếp, giữ cả ba để đọc được lịch sử: ở S0 hàng rào canh một cánh cửa **không có phòng ở sau**; ở S1.4 tài sản ra đời (`rfq_key_material.wrapped_private_key`) nhưng **chưa ai đi qua cửa**; ở S1.6 `apps/unseal-worker` tồn tại và **thật sự import cả hai cửa hạn chế** (`crypto-keys/unwrap` của `g1-`, `sealed-envelope/unseal` của `g8-`). Kể từ đây quy tắc chuyển từ *“chưa ai vi phạm được vì chưa có gì để vi phạm”* sang *“có đúng một nơi được phép, và mọi nơi khác bị chặn”* — và cả hai vế được đo bằng probe có đối chứng dương. **BA PHẦN CHÊNH CÒN LẠI, không phần nào là phần cũ:** ⑴ tiến trình `api` **CÓ** chạm khoá riêng RFQ dạng rõ trong cửa sổ của đúng hàm `issueRfqKeyPair` (ADR-019) — `fill(0)` xoá được chuỗi byte PKCS8 tự xuất ra nhưng không xoá được phần khoá bên trong `CryptoKey` của runtime, nên vế *“không vào core dump”* không đúng tuyệt đối; ⑵ worker cũng giữ khoá riêng đã mở bọc trong bộ nhớ suốt vòng lặp mở phong bì — đó là **đúng nơi** mệnh đề cho phép, nhưng nó là bộ nhớ thật của một tiến trình thật, không phải một HSM; ⑶ bốn gói (`audit`, `tenancy`, `db`, `test-support`) **VẪN CHƯA** có danh sách trắng barrel — khoảng trống này độc lập với hai vế trên và không nhúc nhích từ S0."],
  ["A1", "**Ô ✅ NÀY ĐỨNG TRÊN SỰ VẮNG MẶT CỦA DỮ LIỆU, KHÔNG TRÊN MỘT CỔNG ĐỌC — VÀ ĐÓ LÀ ĐIỂM MẠNH, KHÔNG PHẢI ĐIỂM YẾU.** Hàng của `rfq_unsealed_bids` không TỒN TẠI cho tới lúc mở thầu chạy, nên *“không endpoint nào trả về trường giá”* đúng kể cả với một câu `SELECT *` viết bởi người chưa đọc tài liệu nào. Ba lớp cộng lại: `app_api` không có INSERT trên bảng ấy (nó không giải mã được nên nó không có gì để ghi, và một GRANT INSERT sẽ cho phép nó **BỊA** một bản rõ); trigger đòi một yêu cầu đã được phê duyệt; và `app_api` không đọc được `vendor_bid_versions.envelope`. **PHẦN CHÊNH:** mệnh đề nói *“không ENDPOINT nào”*, và **không có endpoint nào để đo** — `apps/` chỉ có một worker, không có API. Thứ được đo là TẦNG DỮ LIỆU; vế *“cho bất kỳ actor nội bộ nào”* ở tầng HTTP thuộc T2/T5 và thuộc S2+."],
  ["D4", "**BA VẾ ĐẦU ĐƯỢC ĐO; VẾ *“không bao giờ im lặng”* CHỈ ĐƯỢC ĐO MỘT NỬA.** Đã đo: break-glass là một ĐƯỜNG RIÊNG (nó bỏ qua ngưỡng phê duyệt, và có test cho ca RFQ vượt ngưỡng vẫn đi qua); lý do là BẮT BUỘC ở tầng lược đồ; cảnh báo **BỀN** (một hàng `outbox_jobs` mang `severity: HIGH`, sinh trong CÙNG giao dịch tạo yêu cầu) và **TỨC THÌ** (`pg_notify` — test dùng một kết nối `LISTEN` và **không chạy một vòng poll nào**); cộng một lượt đột biến gỡ trigger cho thấy break-glass đi qua trong im lặng khi không có nó. **[S1.6, review an ninh HIGH-2a] MỘT LỖ ĐÃ ĐƯỢC BỊT Ở ĐÂY, VÀ NÓ NẶNG HƠN PHẦN CHÊNH:** tới trước vòng sửa, break-glass đi tới `APPROVED` với **KHÔNG một hàng phê duyệt nào** — `unseal_kiem_du_phe_duyet` trả về ngay, bảng cạnh cho phép, và `app_api` có `UPDATE (status, approved_at)` — nên MỘT câu lệnh viết tay hoàn tất chuyển trạng thái và chính người yêu cầu điều phối được nó. Một người sở hữu trọn chuỗi, và lớp bù duy nhất là một cảnh báo chưa ai tiêu thụ. 022 đòi một **NHÂN CHỨNG**: khác người yêu cầu, khác phiên — đúng hai vế `unseal_kiem_nguoi_duyet` đòi ở đường thường. Break-glass vẫn bỏ qua NGƯỠNG; nó không còn bỏ qua NGƯỜI THỨ HAI. **PHẦN CHÊNH:** **chưa ai TIÊU THỤ cảnh báo ấy.** Không handler nào đăng ký cho `BREAK_GLASS_UNSEAL_ALERT` và không tiến trình nào `LISTEN` trong sản phẩm; tệ hơn, một job không có handler bị `JobRunner` ghi thẳng `FAILED` với lý do `NO_HANDLER` và `onJobFailure` mặc định IM LẶNG. Hôm nay mệnh đề đúng ở mức *“tín hiệu đã được phát, bền và tức thì”*; nó CHƯA đúng ở mức *“có người biết”*, và khoảng cách ấy đòi một tầng vận hành mà `apps/` chưa có."],
  ["A3", "**PHÉP ĐO LÀ MỘT LẦN QUÉT TÌM MỘT CHUỖI ĐÃ BIẾT, KHÔNG PHẢI MỘT ĐỊNH LÝ.** Lớp thật gồm ba phần và chỉ phần thứ ba là một phép đo trên dữ liệu: ⑴ `vendor_bid_versions` KHÔNG có một cột giá nào — bảng không có cột thì không có gì để rò; ⑵ đường ghi DUY NHẤT nhận một `bytea` phong bì và từ chối thứ không đọc được thành phong bì; ⑶ một lần quét `t::text` trên **năm** bảng (ba bảng báo giá cộng `audit_events` và `outbox_jobs`) dưới **superuser** — tức đúng vế *“kể cả bằng role quản trị”* — đòi chuỗi giá không xuất hiện, kèm đối chứng dương chứng minh phép quét biết tìm ra nó. **PHẦN CHÊNH:** vế ⑶ tìm **một chuỗi cụ thể**. Một bản rõ bị cất ở dạng đã biến đổi (nén, base64, đảo byte) sẽ đi lọt, và không lớp nào ở S1 bắt được điều đó. Vế ⑴ và ⑵ mới là phần chịu lực; vế ⑶ là lưới an toàn, không phải bằng chứng."],
  ["A4", "**BA LỚP, VÀ LỚP THỨ HAI ĐƯỢC ĐO TRONG MỘT THẾ GIỚI NƠI LỚP THỨ NHẤT ĐÃ HỎNG.** ⑰ Trước mở thầu không có gì để tổng hợp: `rfq_unsealed_bids` rỗng và `app_api` không đọc được `vendor_bid_versions.envelope`. ⑱ `buildComparisonTable` từ chối ở cả **năm** trạng thái còn lại — và phép đo ấy chạy với bản rõ ĐANG NẰM TRONG BẢNG, trạng thái bị ép lùi bằng cách gỡ bảng cạnh; nếu cổng chỉ là một cách nói khác của “chưa có dữ liệu” thì năm khẳng định đó xanh sai, và một lượt đột biến gỡ cổng đã chứng minh chúng không xanh sai. ⑲ Một **bộ quét rò rỉ** gieo mốc giá vào phong bì thật rồi tìm nó ở MỌI bảng của schema — danh sách bảng đọc từ `pg_class`, không viết tay — với hai đối chứng: một chuỗi có thật thì tìm ra được, và SAU mở thầu mốc giá xuất hiện ở ĐÚNG MỘT bảng, đúng bảng mà 019 chỉ định. **PHẦN CHÊNH THỨ NHẤT:** §6 của đặc tả định nghĩa bộ quét này là một vòng lặp trên MỌI endpoint của OpenAPI. Không có endpoint nào, nên phép quét ở TẦNG DỮ LIỆU. Một trường phái sinh tính trong một handler HTTP tương lai và không bao giờ ghi xuống là thứ bộ quét này **không nhìn thấy** — nó thuộc T2 và thuộc S2+. **PHẦN CHÊNH THỨ HAI, cùng họ với A3:** phép quét tìm MỘT CHUỖI đã biết; một bản rõ cất ở dạng đã biến đổi (nén, base64) đi lọt. **PHẦN CHÊNH THỨ BA, và nó là một khiếm khuyết ĐÃ TÍNH RA của khuôn mà đặc tả gợi ý:** mốc phải là một chuỗi có chữ HOA chứ không phải một con số, vì `bytea` hiện ra dưới `::text` bằng hex và chữ số thập phân LÀ chữ số hex — một mốc 10 chữ số cho kỳ vọng ~2.6 lần khớp GIẢ trong một phong bì ~150 byte."],
  ["A6", "**Ô ✅ NÀY LÀ MỘT HÀNG RÀO Ở TẦNG HÀM, KHÔNG Ở TẦNG QUYỀN — VÀ CÓ MỘT TEST ĐO ĐÚNG ĐIỀU ĐÓ.** Thứ đã đo, và đo bằng khuôn *đổi đúng một thứ*: cùng trạng thái `OPEN`, hai RFQ chỉ khác nhau ở cờ chính sách, câu trả lời lật; chính sách ĐÃ GHIM qua `rfq_budgets` thắng chính sách mới nhất ở **cả hai chiều** (bản đầu của phép đo này bị chứng minh là KHÔNG CÓ RĂNG và đã được dựng lại); không tra được chính sách nào thì MẶC ĐỊNH ĐÓNG, kèm đối chứng dương; và con số bị giấu KHÔNG ĐƯỢC ĐẾM — hai truy vấn tách rời, nên nó không lọt vào log hay vào một thông báo lỗi mang cả đối tượng kết quả. **PHẦN CHÊNH, ĐÃ ĐO CHỨ KHÔNG PHỎNG ĐOÁN:** `app_api` vẫn giữ `SELECT` trên `vendor_bids`, nên một câu SQL viết tay đếm được số báo giá trong khi hàm đang giấu — có một test khẳng định đúng con số ấy, và nếu một ngày nó ĐỎ thì A6 đã lên được tầng quyền. Lớp đúng là một policy RLS trên `vendor_bids`, và S1 KHÔNG dựng được nó vì một lý do cấu trúc: đường người mua và đường khách dùng CHUNG role `app_api` (khoản nợ 29). **PHẦN CHÊNH THỨ HAI:** mệnh đề nói *“ẩn khỏi Buyer”*, và chữ “Buyer” là một khái niệm của tầng HTTP; thứ được đo là hàm, không phải màn hình. **[review an ninh S1.7 MED-2] ĐƯỜNG GHI CỦA CÁI CÔNG TẮC ẤY CŨNG ĐÃ PHẢI SIẾT, và đó là một phần chênh KHÔNG ai nêu ra khi S1.7 được viết:** `strict_blind_mode` sống trên một bảng mà 014 cấp `INSERT (effective_from)` và để người gọi tự chọn `version`. Hai đường ấy lật được phán quyết HỒI TỐ — một hàng `effective_from = now() - 1 năm` kèm cờ TẮT đổi chế độ của mọi RFQ chưa có ngân sách; một hàng `version = 2147483647` ghim vĩnh viễn tổ chức vào chính sách ấy trong khi mọi lần siết sau đó bị bỏ qua trong im lặng. 022 đóng cả hai bằng `CHECK (effective_from >= created_at)` và một trigger đòi phiên bản TĂNG DẦN. Bằng chứng nó có răng: chính đối chứng dương của phép đo *“mặc định đóng”* đã ĐỎ khi ràng buộc được thêm — nó từng đi đường lùi ngày, và nó đã phải viết lại."],
  ["B2", "**MỆNH ĐỀ NÓI *“nhà cung cấp kiểm chứng độc lập được”*, VÀ CHỮ *“nhà cung cấp”* CHƯA TỪNG XUẤT HIỆN TRONG BẤT KỲ PHÉP ĐO NÀO.** Thứ đã đo, và đo mạnh: chữ ký kiểm được bằng **khoá công khai một mình** (`verifyReceipt` nhận đúng ba thứ, không nhận `client`, không nhận `orgId`, và có test đọc số tham số của nó); cùng chữ ký ấy kiểm được bằng **một cài đặt khác** (`createVerify` của `node:crypto` — con đường mà `openssl dgst -sha256 -verify` đi); ba đối chứng âm (sửa văn bản, sửa chữ ký, sai khoá); và biên nhận cũ vẫn kiểm được sau khi xoay khoá. **PHẦN CHÊNH — ADR-011 §“Đo bằng gì” mục 5 đặt tên trước:** không có phép đo nào cho *“một nhà cung cấp THẬT đã kiểm chứng được”*. Trang kiểm chứng là tầng HTTP và `apps/` còn rỗng; chỗ trống ấy thuộc T5/S1.9. **PHẦN CHÊNH THỨ HAI, VIẾT LẠI [khoản nợ 30, 2026-09-05]:** ~~khoá công khai chưa được CÔNG BỐ ở đâu cả — vòng khoá có `publicKeys()` nhưng đường công bố (một endpoint theo `kid`) chưa tồn tại, nên hôm nay nhà cung cấp lấy khoá bằng cách hỏi chính chúng ta.~~ **ĐƯỜNG nay đã có** (`apps/public-keys`, `/.well-known/trustprocure-receipt-keys`, tra được theo `kid`, chỉ đọc, không phụ thuộc `pg`). Nhưng phần chênh KHÔNG biến mất, nó chỉ đổi hình: một endpoint do CHÍNH CHÚNG TA phục vụ vẫn là *“hỏi chúng ta”* — nhanh hơn, không đáng tin hơn. Một máy chủ bị chiếm phục vụ được một khoá khác và mọi biên nhận giả ký bằng khoá ấy sẽ kiểm chứng SẠCH. Thứ đóng nốt là một NEO NGOÀI (`fingerprint` SHA-256 của SPKI, in vào hợp đồng hay đăng ở nơi ta không kiểm soát), và nó là **cùng một khoản nợ với artefact neo ngoài của B3** — cơ chế có, artefact thì chưa."],
  ["B5", "**MỘT LẦN GỌI TRÊN MỘT RFQ — CHỮ *“định kỳ”* VÀ CHỮ *“mọi thời điểm về sau”* VẪN CHƯA CÓ CHỦ THỂ.** Thứ đã đo, và đo mạnh: `auditStoredCiphertexts` băm LẠI từng phong bì đang nằm trong bảng rồi so với chuỗi hash đọc từ biên nhận; một lượt phá thật (gỡ trigger `bid_chi_ghi_them` rồi thay phong bì) làm nó chỉ ĐÍCH DANH đúng phiên bản ấy và KHÔNG vạ lây phiên bản sạch; và gọi nhầm role hỏng ỒN ÀO với `permission denied` thay vì âm thầm báo “mọi thứ đều khớp”. Cộng một phép đo cho thấy B1 chặn TRƯỚC: không gỡ trigger thì kể cả superuser cũng không đổi được phong bì. **PHẦN CHÊNH THỨ NHẤT:** không có gì GỌI hàm này theo lịch — không cron, không handler outbox. Ở S1 mệnh đề đúng ở mức *“phép so tồn tại và nó biết phát hiện”*, chưa đúng ở mức *“nó chạy mãi về sau”*; chặng ấy thuộc S6. **PHẦN CHÊNH THỨ HAI, và nó nặng hơn:** job so phong bì với BIÊN NHẬN TRONG CÙNG CƠ SỞ DỮ LIỆU. Một lần khôi phục sai hay một kẻ tấn công viết lại CẢ HAI sẽ đi lọt. Thứ đóng được lỗ ấy là chữ ký của biên nhận — và chữ ký CỐ Ý không nằm trong quyền của `app_unseal` (xem 021), vì B2 nói phép kiểm ấy phải làm được bằng khoá công khai một mình, tức bởi NHÀ CUNG CẤP chứ không bởi máy chủ."],
  ["C1", "**VẾ *“sau `deadline_at` mọi lần nộp bị từ chối”* ĐÚNG THEO `now()`, KHÔNG THEO ĐỒNG HỒ TƯỜNG.** Trigger `bid_kiem_han_nop` (018) so `now()` — dấu thời gian ĐẦU transaction — với `deadline_at`, và đó là một lựa chọn có lý do: `now()` cũng chính là giá trị `submitted_at DEFAULT now()` ghi xuống và là giá trị đi vào biên nhận đã ký, nên một biên nhận không bao giờ mang dấu thời gian trước hạn cho một lần nộp bị từ chối vì trễ. **PHẦN CHÊNH:** một transaction MỞ trước hạn rồi COMMIT sau hạn **vẫn được nhận**. Chặn nó là việc của `statement_timeout` trên đường nộp, và đường ấy chưa tồn tại (`apps/` rỗng). Cửa sổ ấy bị chặn trên bởi thời gian sống của một transaction, không bởi một hằng số nào của dự án. **PHẦN CHÊNH THỨ HAI:** kịch bản T5 #4 (*nộp 50ms sau hạn qua retry, replay và HTTP/2 multiplexing*) chưa chạy — nó đòi một tầng HTTP."],
  ["C2", "**SCHEDULER KHÔNG CHẾT — NÓ CHƯA TỪNG RA ĐỜI, VÀ PHÉP ĐO NÓI ĐÚNG ĐIỀU ĐÓ.** Thứ đã đo: hạn nộp bị đẩy về quá khứ, KHÔNG một job nào tồn tại trong `outbox_jobs` và không runner nào được khởi động, RFQ vì thế VẪN mang trạng thái `OPEN` sau hạn — rồi một lần nộp vào đúng cửa sổ ấy bị từ chối. Khẳng định chịu lực không phải “bị từ chối” mà là **lời từ chối nói về HẠN, không về TRẠNG THÁI**: nếu nó nói về trạng thái thì phép kiểm đang dựa vào việc một scheduler đã kịp đặt `CLOSED`, tức đúng thứ mệnh đề cấm. Kèm một lượt đột biến gỡ trigger cho thấy đúng lần nộp ấy đi lọt. **PHẦN CHÊNH:** mệnh đề nói *“job đóng RFQ CHẾT”*, và ở S1 job ấy chưa được viết — phép đo dựng sự VẮNG MẶT của nó chứ không giết một tiến trình đang chạy. Hai thứ này cho cùng một trạng thái CSDL, nhưng chúng không cho cùng một bảo đảm về một scheduler chết NỬA CHỪNG. **PHẦN CHÊNH THỨ HAI, thừa hưởng nguyên vẹn từ §4 của C1:** một transaction MỞ trước hạn rồi COMMIT sau hạn vẫn được nhận. **PHẦN CHÊNH THỨ BA:** tầng test của C2 gồm cả T6 (tải quanh hạn, lệch đồng hồ), và T6 chưa chạy một lần nào."],
  ["C4", "**NĂM VẾ ĐỀU CÓ LỚP; VẾ THỨ NĂM LÀ MỘT Ý ĐỊNH GỬI, KHÔNG PHẢI MỘT LẦN GIAO.** Thứ đã đo: rút ngắn bị chặn ở CẢ HAI lớp — hàm ứng dụng (nó định nghĩa “gia hạn” là ĐẨY RA XA, nên nó chặn cả ca BẰNG NHAU mà trigger cố ý không chạy) và trigger của 011 cho đường SQL viết tay, kèm đột biến gỡ trigger; gia hạn khi RFQ đã `CLOSED` bị từ chối; lý do rỗng bị chặn TRƯỚC mọi lần ghi — và câu ấy nay được đo BÊN TRONG giao dịch chứ không sau khi rollback (bản đầu của phép đo ấy VÔ NGHĨA, review an ninh S1.7 MED-5 chỉ ra, và nó đã được dựng lại); một lần gia hạn hợp lệ sinh ĐÚNG một bản ghi kiểm toán và ĐÚNG một job cho MỖI lời mời — so bằng phép so TẬP HỢP chứ không phép đếm; và một lần rollback xoá sạch cả ba. **[review an ninh S1.7 HIGH-1] MỘT LỖ ĐÃ ĐƯỢC BỊT:** vì job đóng RFQ chưa được viết, MỌI RFQ quá hạn đều nằm ở `OPEN` — và ở đó, gia hạn HỒI SINH được một cửa sổ đã hết, tức đạt được cạnh `CLOSED -> OPEN` mà máy trạng thái cố ý không có, không chạm `status`, không qua phê duyệt kép, và với một quyết định ĐÃ BIẾT có bao nhiêu báo giá trong tay. 022 chặn nó ở tầng trigger. **PHẦN CHÊNH:** `RFQ_DEADLINE_EXTENDED_NOTICE` CHƯA CÓ HANDLER nào, nên không email hay SMS nào rời khỏi hệ thống — mệnh đề đúng ở mức *“ý định thông báo không bao giờ lạc khỏi lần ghi hạn mới”*, không ở mức *“nhà cung cấp đã biết”*. **PHẦN CHÊNH THỨ HAI:** payload cố ý KHÔNG mang `reason`, nên nhà cung cấp biết hạn mới mà không biết vì sao."],
  ["G2", "**MỆNH ĐỀ NÓI “MỘT CẶP KHOÁ”, HIỆN THỰC CHO HAI — và vế chịu lực là vế thứ hai.** ADR-011 chốt *P-256 mặc định, X25519 cơ hội*, mà ECDH đòi hai bên cùng đường cong, nên một RFQ mang một cặp khoá CHO MỖI thuật toán (`UNIQUE (org_id, rfq_id, algorithm)`). Vế *“lộ một RFQ không lan sang RFQ khác”* thì nguyên vẹn và được đo ba mũi: khoá riêng của A không mở được phong bì của B; ĐÚNG khoá riêng nhưng SAI mã RFQ cũng không mở được (`rfqId` nằm trong INFO của HKDF, nên ràng buộc là MẬT MÃ chứ không phải một câu `if`); và hai lần niêm phong cùng một bản rõ cho hai phong bì khác nhau. **PHẦN CHÊNH:** vẫn còn một TỔ TIÊN CHUNG mà mệnh đề không nói tới — cả hai khoá riêng được bọc bằng khoá dẫn xuất THEO TỔ CHỨC (`deriveOrgKey`), nên mất khoá gốc của tổ chức là mất mọi RFQ của tổ chức ấy. Đó là địa hạt của G1 và F3, không phải của G2; ghi ở đây để không ai đọc ô ✅ thành *“mỗi RFQ là một ốc đảo”*. **PHẦN CHÊNH THỨ HAI, do ADR-011 §“Đo bằng gì” mục 4 ĐẶT TÊN TRƯỚC và đòi phải nằm đúng ở đây:** không có phép đo nào ở S1 trả lời *“bao nhiêu %% nhà cung cấp đi được đường nhanh X25519”*. Bộ test chạy trên **Node** — và đã đo được rằng Node 22 lẫn Node 24 đều có đủ cả ba thuật toán trong `crypto.subtle` (2026-09-04), nên một lượt CI xanh cho nhánh X25519 nói về Node, KHÔNG nói gì về webview Android. Câu hỏi ấy chỉ trả lời được bằng dữ liệu vận hành thật sau khi có người dùng thật; nó thuộc S2+, và khoản nợ 23 vẫn mở."],
  ["G4", "~~**MỆNH ĐỀ LIỆT KÊ BỐN THAO TÁC; S1.4 CÓ BA, VÀ CHỈ ĐO ĐƯỢC BA.**~~ **[S1.6] VẾ THỨ TƯ ĐÃ CÓ MÃ.** *Sinh* và *bọc* là MỘT hành vi không tách được (ADR-019: bản rõ không tồn tại ngoài một hàm) nên chúng là một bản ghi `RFQ_KEY_MATERIAL_ISSUED`; *huỷ* là `RFQ_KEY_MATERIAL_REVOKED`; và *mở bọc* nay là `RFQ_KEY_MATERIAL_UNWRAPPED`, ghi bởi chính `apps/unseal-worker` — nó ghi được vì `app_unseal` có quyền INSERT theo cột trên `audit_events` từ 003/004. **PHẦN CHÊNH CÒN LẠI:** *huỷ* ở S1 có ĐÚNG MỘT nguyên nhân được hỗ trợ (RFQ bị huỷ); thu hồi vì một sự cố an ninh trong khi RFQ đang mở không phải đường đi được hỗ trợ. ~~Và thu hồi là một **DẤU**, không phải một lần xoá mật mã: `wrapped_private_key` vẫn nằm nguyên trong hàng — xem khoản nợ 26.~~ **[2026-09-05] Câu ấy hết đúng:** `026` cho phép xoá `wrapped_private_key` về `NULL` sau khi đã thu hồi, hết quãng ân hạn của chính sách, và dưới quyền `rfq.key.purge` — kèm bản ghi `RFQ_KEY_MATERIAL_PURGED`. Mặc định của chính sách là KHÔNG xoá, nên với một tổ chức chưa bật thì câu cũ vẫn mô tả đúng trạng thái. **PHẦN CHÊNH MỚI, và nó là phần chênh THẬT:** `UPDATE ... = NULL` xoá GIÁ TRỊ ở mức logic — byte cũ còn trong hàng chết, WAL, bản sao lưu và bản standby. Bảo đảm mật mã đóng lại chỉ khi khoá chủ ở KMS cũng bị huỷ (ADR-009), và đó là lý do bản ghi mang tên `PURGED` chứ không `CRYPTO_ERASED`."],
]);

/**
 * NĂM MÃ PHẢI CÓ CỜ "PHẠM VI HẸP" — GHIM DANH SÁCH, KHÔNG PHẢI GHI CHÚ SUÔNG.
 *
 * Khiếm khuyết đã đo (I1 của review cuối): xoá MỘT DÒNG khỏi `PHAM_VI_HEP` làm biến mất CẢ cờ
 * trên hàng LẪN mục §4 của nó; ma trận tự sinh lại KHỚP BYTE nên `git diff --exit-code` vẫn
 * xanh, và cổng vẫn XANH. §4 là THỨ DUY NHẤT đứng giữa một ô ✅ và một câu rộng hơn thứ được
 * đo — mà không lớp máy nào canh nó.
 *
 * Ghim ở đây đảo chiều ấy: gỡ một cờ là một QUYẾT ĐỊNH phải sửa hai chỗ và đi qua CODEOWNERS,
 * chứ không phải một dòng biến mất trong im lặng. Cùng lập luận đã biện minh cho
 * `NGOAI_LE_HINH_DANG`: mỗi lần thu hẹp phần "được khai báo là hẹp" là một quyết định an ninh
 * mà không máy nào phán xử hộ được.
 */
export const MA_PHAI_CO_CO_HEP: ReadonlySet<string> = new Set([
  "A1", "A3", "B2", "C1", "D1", "D4", "D5", "E1", "E2", "E3", "E5", "F1", "G1",
  // [S1.4] Hai mã MỚI, và cả hai vào đây CÙNG LÚC với ô ✅ của chúng — không phải sau một vòng
  // review. G2 vì mệnh đề nói "một cặp khoá" trong khi hiện thực cho hai; G4 vì mệnh đề liệt kê
  // bốn thao tác trong khi S1.4 chỉ có ba.
  "G2", "G4",
  // [khoản nợ 29] A5 rời khỏi danh sách được-phép-chưa-phủ và vào ĐÂY cùng lúc: `027` cưỡng
  // chế được nó ở tầng CSDL, nhưng chỉ KHI kết nối đã gắn `app.guest_session_id`, và vế
  // "gián tiếp qua thời gian phản hồi" thì vẫn chưa ai đo.
  "A5",
  // [S1.5] BA mã mới nữa: A3 (phép quét tìm một chuỗi đã biết, không phải một định lý), B2 (chữ
  // "nhà cung cấp" chưa xuất hiện trong phép đo nào), C1 (`now()` là đầu transaction, không phải
  // đồng hồ tường). B1 CỐ Ý không ở đây — xem lý do tại chỗ nó được gỡ khỏi danh sách trên.
  // [S1.6] HAI mã mới: A1 (mệnh đề nói "không ENDPOINT nào" và không có endpoint nào để đo) và
  // D4 (tín hiệu đã phát, bền và tức thì — nhưng CHƯA AI TIÊU THỤ nó). C3 và D2 CỐ Ý không ở
  // đây, và cả hai lý do được ghi tại chỗ chúng rời khỏi danh sách được-phép-chưa-phủ.
  // [S1.7] HAI mã mới nữa, và cả hai vào đây CÙNG LÚC với ô ✅: A4 (bộ quét quét tầng DỮ LIỆU,
  // không quét OpenAPI — và nó tìm MỘT CHUỖI, không chứng minh một định lý) và A6 (cưỡng chế ở
  // tầng ứng dụng, nên `app_api` vẫn đếm được bảng bằng SQL viết tay — đã đo).
  "A4", "A6",
  // [S1.8] BỐN mã mới, và cả bốn vào đây CÙNG LÚC với ô ✅ của chúng. Tỷ lệ 4/4 là cao nhất của
  // mọi hạng mục trong dự án, và nó KHÔNG phải dấu hiệu xấu: bốn mệnh đề này đều nói về MỘT THẾ
  // GIỚI ĐANG VẬN HÀNH — một job chạy theo lịch, một scheduler thật, một lá thư tới tay ai đó,
  // một endpoint để đối kháng — trong khi `apps/` mới có đúng một worker. Phần chênh ấy có thật,
  // và nó phải đọc được ở §4 chứ không được nuốt vào bốn ô ✅.
  "B5", "C2", "C4", "E4",
]);

/**
 * MỐC GHIM CỦA ĐỘ PHỦ — BIẾN MỘT CÂU VĂN THÀNH MỘT PHÉP ĐO.
 *
 * Xem khối đầu file: câu *"danh sách chỉ co lại, không bao giờ nở ra trong im lặng"* đã bị đo
 * là SAI. Ràng buộc hai chiều của `MA_DUOC_PHEP_CHUA_PHU` chỉ kích hoạt khi `coTest && trongDs`,
 * nên hai thay đổi BÙ TRỪ NHAU trong cùng một PR đi lọt.
 *
 * Hai con số dưới đây đóng đúng hai mũi đã đo, và chúng là RÀNG BUỘC HAI CHIỀU THẬT — lệch về
 * BÊN NÀO cũng đỏ:
 *   `soPhuToiThieu`   tử số không được TỤT. Mũi (1) — xoá test + thêm mã vào danh sách — làm
 *                     tử số 24 -> 23 và chết ở đây, bất kể danh sách nói gì.
 *   `coDanhSachToiDa` danh sách không được NỞ. Mũi (2) — thêm `G9` vào sổ đăng ký và vào danh
 *                     sách — làm cỡ danh sách 23 -> 24 và chết ở đây, dù tử số đứng yên.
 *
 * VÌ SAO LỆCH LÊN CŨNG ĐỎ, chứ không chỉ lệch xuống: một mốc chỉ chặn một chiều sẽ TỰ TRÔI —
 * phủ thêm một mã hôm nay nâng trần cho một lần tụt ngày mai mà không ai thấy. Đỏ cả hai chiều
 * biến mỗi lần đổi độ phủ thành MỘT DÒNG SỬA trong repo, nằm dưới `.github/CODEOWNERS`, đọc
 * được trong diff của PR. Đó đúng là QT2: GHIM CẤU HÌNH thay vì NỚI BẢO ĐẢM.
 *
 * ĐIỀU NÀY KHÔNG ĐÓNG ĐƯỢC: một PR đổi cả mã, cả danh sách, VÀ cả hai con số này cùng lúc vẫn
 * xanh. Không có phép đo nào chặn được điều đó — chỉ có mắt người đọc diff. Khác biệt là ở chỗ
 * lúc ấy nó là một DÒNG PHẢI SỬA CÓ TÊN trong một file có chủ sở hữu, không phải một sự im lặng.
 */
export interface MocGhim {
  /** Tổng số mã ĐÃ PHỦ (nghiệp vụ + hàng rào) mà lượt chạy phải đạt ĐÚNG BẰNG. */
  readonly soPhuToiThieu: number;
  /** Số phần tử của `MA_DUOC_PHEP_CHUA_PHU` mà cấu hình phải giữ ĐÚNG BẰNG. */
  readonly coDanhSachToiDa: number;
}

// [S1.1] 24 -> 26. Hai mã MỚI, cả hai thuộc nhóm HÀNG RÀO và cả hai ĐÃ PHỦ ngay khi vào sổ:
//   H14 — bộ dò oracle xuyên tổ chức qua ràng buộc duy nhất (db/unique-oracle.int.test.ts);
//   H15 — biên giới module của packages/supplier (họ quy tắc `g5-` + danh sách trắng barrel).
// Mẫu số đi 47 -> 49 cùng lúc. `coDanhSachToiDa` KHÔNG đổi và đó là điểm mấu chốt: danh sách
// "được phép chưa phủ" không nở ra một dòng nào, nên hai mã mới không mua được chỗ trốn nào cho
// 23 mã nghiệp vụ đang trống. S1.1 KHÔNG phủ thêm một mã nghiệp vụ nào — E4 và A5 vẫn ⏳, đúng
// như kế hoạch S1 §1 ánh xạ (A5 cần cả S1.9; E4 cần chủ ngữ "mã RFQ" của S1.2).
// [S1.2] 26 -> 27. Mot ma MOI, lai thuoc nhom HANG RAO va lai da phu ngay khi vao so:
//   H16 - bien gioi module SUY TU TINH CHAT cho moi goi trong packages/.
// Mau so 49 -> 50. `coDanhSachToiDa` VAN KHONG DOI (23) qua ca S1.1 lan S1.2, va do la con so
// dang doc nhat trong ba con so nay: sau HAI hang muc, KHONG mot ma NGHIEP VU nao duoc lap.
// Dung nhu §1 cua ke hoach S1 anh xa - C4 con thieu ve "thong bao toan bo NCC da moi" (can loi
// moi, S1.3); C5 chua co chu ngu (`rfq_key_material` la S1.4); C3/D2 can cong chinh sach cua
// S1.6. Do phu nghiep vu se nhay o S1.3, khong som hon.
// [S1.3] 27 -> 30, va lan dau tien trong S1 con so NGHIEP VU nhuc nhich: 11 -> 14.
// Ba ma duoc lap la E1 (token magic link), E2 (token mot minh khong du) va E5 (danh tinh THUC TE
// da xac thuc) - ca ba deu nam trong mot hang muc, va do la he qua cua viec chu ngu cua chung
// (loi moi, phien khach) cuoi cung cung ton tai.
// `coDanhSachToiDa` 23 -> 20: danh sach duoc-phep-chua-phu CO LAI dung ba dong, khong nhieu hon.
// KHONG co ma HANG RAO moi nao o S1.3 - H16 (S1.2) da phu san goi thu sau, dung nhu no duoc
// dung ra de lam.
// [REVIEW AN NINH S1.3 — 2026-08-29] 30 -> 28, va danh sach 20 -> 22.
// Day la lan DAU TIEN hai con so nay di NGUOC chieu du kien, va do la ly do chung ton tai: mot
// luot review co phep do da chung minh hai o xanh (E2, E5) rong hon co che. Sua o day la mot
// dong PHAI SUA BANG TAY, co ten, trong mot file co chu so huu (.github/CODEOWNERS) - dung nhu
// thiet ke, thay vi mot su im lang.
// E1 O LAI nhung nay MANG CO PHAM VI HEP: ve 'thu hoi duoc' chi dung cho token.
// [VONG SUA SAU REVIEW AN NINH] 28 -> 30, danh sach 22 -> 20. E2 va E5 quay lai o DA PHU — lan
// nay KEM mot chuoi doi chung: tung buoc cua chuoi tan cong da do duoc nay la mot test, va moi
// phep chan co mot ve doi chung duong. Ca hai VAN mang co PHAM VI HEP, va phan chenh duoc ghi
// ra la phan CHUA TUNG bi bat: 'kenh da dang ky' la kenh do NGUOI MUA khai, va
// `verified_contact_id` la NGUOI GIU KENH chu khong phai con nguoi dang thao tac.
// [S1.4] 30 -> 33, danh sach 20 -> 17. Ba ma duoc lap deu la ma NGHIEP VU — C5, G2, G4 — nen con
// so nghiep vu di 14 -> 17 va nhom hang rao dung yen 16/16. Day la lan dau tien trong S1 mot hang
// muc lap duoc BA ma nghiep vu, va ly do khong phai no lam nhieu hon: no lam mot chu ngu ma ca ba
// menh de deu doi (`rfq_key_material`), dung nhu §1 cua ke hoach S1 da anh xa tu truoc.
// KHONG ma HANG RAO moi nao: H16 (S1.2) da phu san goi thu bay, dung nhu no duoc dung ra de lam.
// HAI trong ba ma moi mang co PHAM_VI_HEP ngay tu dau — xem MA_PHAI_CO_CO_HEP.
// [S1.5] 33 -> 37, danh sach 17 -> 13. BON ma nghiep vu: A3, B1, B2, C1 — nen con so nghiep vu di
// 17 -> 21 va nhom hang rao dung yen 16/16. KHONG ma HANG RAO moi nao: H16 (S1.2) da phu san goi
// thu tam, va do la lan thu BA no lam dung viec no duoc dung ra de lam.
// BA trong bon ma moi mang co PHAM_VI_HEP ngay tu dau. Ty le ay (3/4) khong phai dau hieu xau: no
// la dau hieu cua nhung menh de RONG — B2 noi ve mot con nguoi that, C1 noi ve thoi gian, A3 noi
// ve "moi truy van SQL". Ma tran ghi ra phan chenh thay vi thu hep menh de cho vua phep do.
// [S1.6] 37 -> 41, danh sach 13 -> 9. BON ma nghiep vu: A1, C3, D2, D4 — nghiep vu 21 -> 25.
// Hai trong bon mang co PHAM_VI_HEP; HAI ma con lai (C3, D2) KHONG, va do la lan dau tien tu S1.3
// mot ma duoc lap ma menh de KHONG rong hon phep do. Voi D2 dieu do dac biet dang ghi: ke hoach
// S1 §3 da du doan mot phan chenh cho no, va phan chenh ay KHONG ra doi.
// [khoan no 29 - 2026-09-05] 47 -> 48, danh sach 3 -> 2. MOT ma NGHIEP VU duoc lap: A5, nen
// con so nghiep vu di 31 -> 32 va nhom hang rao dung yen 16/16. Day la lan dau tien mot ma
// duoc lap boi mot lan tra NO chu khong boi mot hang muc, va cach lap dang ghi: no KHONG di
// theo hinh dang da de xuat trong so no (mot role `app_guest`) ma di theo policy AS RESTRICTIVE
// - vi doc `hardening.always.sql` thay mot role thu ba keo theo mot lan sua file 1600 dong
// chiu luc nhat kho, con RESTRICTIVE thi da duoc chua san cho. A5 mang co PHAM_VI_HEP ngay tu
// dau: bao dam chi dung KHI ket noi da gan phien khach.
export const MOC_GHIM: MocGhim = { soPhuToiThieu: 48, coDanhSachToiDa: 2 };

/**
 * Đếm số VẾ của một mệnh đề trong sổ đăng ký. Sổ đăng ký viết phép hội bằng `**và**` đậm —
 * quy ước có sẵn, không phải một danh sách mới phải nuôi.
 *
 * Vì sao DẪN XUẤT thay vì ghim một danh sách "mã nào là phép hội": một danh sách như thế lại
 * đúng lớp khiếm khuyết I1 (gỡ một dòng là xong). Đọc thẳng từ mệnh đề thì mã mới của S1 tự
 * rơi vào phạm vi ngay hôm nó được viết vào `docs/TEST-PLAN.md`.
 */
export function demVeMenhDe(statement: string): number {
  return (statement.match(/\*\*và\*\*/g) ?? []).length + 1;
}

/**
 * MỌI LÝ DO CHẶN MERGE ĐẾN TỪ MỐC GHIM. Hàm THUẦN, tách khỏi `kiemTraCong` để mỗi vế kiểm thử
 * đột biến được riêng. `index.ts` gọi CẢ HAI và gộp kết quả.
 */
export function kiemTraMocGhim(
  invariants: readonly Invariant[],
  coverage: ReadonlyMap<string, readonly TestOutcome[]>,
  duocPhep: ReadonlyMap<string, string> = MA_DUOC_PHEP_CHUA_PHU,
  phamViHep: ReadonlyMap<string, string> = PHAM_VI_HEP,
  moc: MocGhim = MOC_GHIM,
  phaiCoCoHep: ReadonlySet<string> = MA_PHAI_CO_CO_HEP,
): string[] {
  const van: string[] = [];
  const trongSo = new Set(invariants.map((i) => i.id));
  const soPhu = invariants.filter((i) => ketQua(coverage.get(i.id)).coTest).length;

  if (soPhu < moc.soPhuToiThieu) {
    van.push(
      `HỒI QUY ĐỘ PHỦ: lượt này phủ ${soPhu} mã, mốc ghim là ${moc.soPhuToiThieu}. Một mã đã ` +
        `từng có test mang nhãn nay KHÔNG còn. Thêm một dòng vào MA_DUOC_PHEP_CHUA_PHU KHÔNG ` +
        `sửa được điều này — đó chính là mũi mà mốc này sinh ra để chặn.`,
    );
  } else if (soPhu > moc.soPhuToiThieu) {
    van.push(
      `ĐỘ PHỦ TĂNG (${soPhu} > ${moc.soPhuToiThieu}) — tin tốt, nhưng mốc phải được NÂNG TAY: ` +
        `đặt \`MOC_GHIM.soPhuToiThieu = ${soPhu}\` trong \`tools/inv-matrix/src/danh-gia.ts\`. ` +
        `Một mốc chỉ chặn một chiều sẽ tự trôi và mua sẵn chỗ cho một lần tụt sau này.`,
    );
  }

  if (duocPhep.size > moc.coDanhSachToiDa) {
    van.push(
      `DANH SÁCH ĐƯỢC PHÉP CHƯA PHỦ NỞ RA: ${duocPhep.size} mã, trần ghim là ` +
        `${moc.coDanhSachToiDa}. Danh sách này chỉ được CO LẠI. Nếu một bất biến MỚI thật sự ` +
        `thuộc S1, nó phải được thêm vào cùng một lần nâng trần có chữ ký trong diff.`,
    );
  } else if (duocPhep.size < moc.coDanhSachToiDa) {
    van.push(
      `Danh sách được phép chưa phủ đã CO LẠI (${duocPhep.size} < ${moc.coDanhSachToiDa}) — ` +
        `hạ \`MOC_GHIM.coDanhSachToiDa\` xuống ${duocPhep.size} để trần không giữ chỗ trống.`,
    );
  }

  for (const ma of phaiCoCoHep) {
    if (!trongSo.has(ma)) {
      van.push(`MA_PHAI_CO_CO_HEP nhắc mã \`${ma}\` KHÔNG có trong sổ đăng ký.`);
      continue;
    }
    if (!phamViHep.has(ma)) {
      van.push(
        `\`${ma}\` được ghim là PHẢI CÓ ghi chú "phạm vi hẹp" nhưng ghi chú đã biến mất khỏi ` +
          `PHAM_VI_HEP. Gỡ một cờ §4 làm ô ✅ của nó tự nhận trọn mệnh đề — mà ma trận sinh ` +
          `lại vẫn khớp byte, nên KHÔNG lớp nào khác bắt được.`,
      );
    }
  }

  for (const inv of invariants) {
    const soVe = demVeMenhDe(inv.statement);
    if (soVe < 2) continue;
    if (!ketQua(coverage.get(inv.id)).coTest) continue;
    if (phamViHep.has(inv.id)) continue;
    van.push(
      `\`${inv.id}\` là một MỆNH ĐỀ HỘI ${soVe} VẾ đang mang ô ✅ mà KHÔNG có ghi chú §4. ` +
        `Bộ sinh gom theo NHÃN và không hề biết mệnh đề là phép hội: một test đo một vế cũng ` +
        `thắp ✅ cho cả bốn. Ghi ra vế nào được đo và vế nào không, vào PHAM_VI_HEP.`,
    );
  }

  return van;
}

/**
 * TRÍCH NGUYÊN VĂN hai phát biểu bàn giao đã chốt ở Task 6 (`progress.md`, mục *PHAT BIEU BAN
 * GIAO CHO TASK 8+ VA CHO BAN DOI CHIEU BAT BIEN (Task 11)* và mục tương ứng cho Task 6).
 * Chúng đã được hiệu chuẩn qua hai vòng fix — CHÉP LẠI NGUYÊN BYTE, không diễn đạt lại.
 * Giữ nguyên chính tả không dấu của sổ tay tiến trình: đó là bằng chứng, không phải văn bản.
 */
export const TRICH_BAN_GIAO: ReadonlyArray<{ ma: string; trich: string }> = [
  {
    ma: "B3",
    trich: `B3 BAO DAM: voi so cua mot to chuc MA PHIEN HIEN TAI DOC DUOC, verifyAuditChain() phat hien moi thao tac
  XOA, CHEN, CAT DUOI, va moi thao tac SUA tren cac truong di vao bam. Tien anh v2 phu DU 13 COT DU LIEU
  cong prev_hash (vao bam dang byte) va hash (dau ra) — KHONG con cot nao cua bang so nam ngoai phep bam.
  \`checked\` la SO HANG DOC DUOC DUOI RLS, khong phai so hang ton tai.
TRUOC app_api/app_unseal/injection: manh — nhung CONG VIEC DO TRIGGER VA REVOKE THEO COT CUA B4 LAM,
  khong phai chuoi hash.
TRUOC CHU SO HUU BANG KHONG-SUPERUSER: chuoi KHONG CO NEO NGOAI chung minh VE CO BAN LA KHONG GI CA.
  Do duoc: 11 cot du lieu bi sua theo kieu "tinh lai duoi" cho ok:true tu chuoi; CHI NEO NGOAI bat duoc.
  Chuoi tu no chi bat KE TAN CONG LUOI.
NEU VA CHI NEU co ExternalAnchor giu o noi role deploy KHONG GHI DUOC: chuoi con phat hien so bi
  THAY THE / DUNG LAI / LAM RONG — CHO TIEN TO TOI LAN XUAT CUOI.
MOT CHUOI HASH "HOP LE" CHUNG MINH GI CHO KIEM TOAN VIEN: rang cac hang HIEN DANG DOC DUOC, TINH TOI LAN
  XUAT NEO CUOI, LA DUNG NHUNG HANG DA TON TAI O THOI DIEM DO — VA CHI KHI kem mot ExternalAnchor xuat xu
  ngoai vung ghi cua role deploy. KHONG CO NEO, NO CHUNG MINH KHONG GI CA truoc mot chu so huu bang.
NO KHONG CHUNG MINH: (1) "moi su kien da xay ra deu co mat" — lop phong thu la DANH SACH TRANG TRIGGER
  trong hardening, KHONG phai chuoi; (2) moi thu SAU lan xuat neo cuoi — NHIP NEO CHINH LA CUA SO GIA MAO;
  (3) \`source\` cua ExternalAnchor la NHAN XUAT XU DO NGUOI GOI VIET, khong xac thuc, khong the xac thuc o S0.
  Lop KIEU chi mua duoc MOT dieu: duong tat "tu duc neo tu chinh so dang kiem" KHONG CON VIET DUOC MOT
  CACH TINH CO. O THI CHAY KHONG CO LOP NAO CHAN; (4) ARTEFACT NEO NGOAI HIEN KHONG TON TAI — CO CHE da co,
  ARTEFACT thi chua; audit_events, audit_chain_anchors VA schema_migrations DEU CUNG VUNG TIN CAY nen
  KHONG CAI NAO trong ba duoc dung lam goc tin cay; (5) TINH TOAN VEN CUA LUOC DO — (D5) la PHAT HIEN,
  KHONG NGAN CHAN; giua luc mot cot bi doi ten va lan migrate() ke, ben ghi TU CHON DUOC seq/prev_hash/hash.`,
  },
  {
    ma: "B4",
    trich: `B4 BAO DAM: truoc app_api/app_unseal bi chiem, role dang nhap ung dung, SQL injection, va thanh vien
  pg_write_all_data — HANG DA NAM TRONG public.audit_events KHONG BI SUA, KHONG BI XOA, KHONG BI CAT DUOI.
  Lop A (trigger ENABLE ALWAYS) rang buoc ca chu so huu bang lan superuser TREN DUONG DML TRUC TIEP;
  lop B (ACL) la lop DUY NHAT con dung khi mot trigger bi tat; lop C dua trang thai ve dung hoac
  GAY ON AO o lan migrate() ke.
VONG 2 THEM DUNG BA THU, KHONG HON:
  (i) mot loi o BUOC 0/1/1b khong con giet luot sua => 004_*.sql LUON TOI DICH, tuc duong thoat QT1
      "va bang mot migration moi" nay la TINH CHAT cua CA LUOT SUA;
  (ii) viec lop C GO mot trigger/rule khoi so kiem toan khong con im lang => mac dinh-DONG tro thanh
      mot RANG BUOC BAN GIAO DOC DUOC thay vi mot cai bay;
  (iii) moi thong bao chan deploy nay NEU DUNG BANG NAO, O SCHEMA NAO.
B4 KHONG BAO DAM: "moi su kien da xay ra deu co mat trong bang", va "day van la cai so cu".
  Ba duong do duoc o 5ae8040, TAT CA deu MIGRATE OK va KHONG MOT WARNING NAO, deu trong tay
  CHU SO HUU BANG KHONG-SUPERUSER (tuc chinh role deploy):
    RENAME + CREATE TABLE (LIKE ... INCLUDING ALL) + dung lai RLS/policy/GRANT + DROP ban cu -> 4 hang -> 0
    SET SCHEMA -> sua -> tra ve -> 4 hang -> 2
    DROP ca hai + DELETE FROM schema_migrations WHERE version LIKE '003%' -> 003 chay lai, so RONG
  => GIOI HAN CAU TRUC, khong dong duoc o tang nay (can event trigger cap cum, doi SUPERUSER,
     hoac mot NEO NGOAI DATABASE).`,
  },
];

/**
 * XUẤT XỨ CỦA BẰNG CHỨNG: đòi một DẤU HIỆU TÍCH CỰC — đúng **40** ký tự hex thường — thay vì
 * hỏi "có lỗi không". Ném, không trả về `"khong-xac-dinh"`: một evidence pack ghi SHA rỗng là
 * một evidence pack KHÔNG CÓ XUẤT XỨ, tệ hơn là không có evidence pack.
 *
 * Vì sao hàm này THUẦN và nằm ở đây thay vì nằm trong `commitSha()` của `index.ts`: ràng buộc
 * (11) áp vào chính mã sản phẩm chỉ có giá trị khi nó ĐO ĐƯỢC. Đo được ở harness Task 11 —
 * khi phép kiểm còn nằm trong vỏ I/O, mũi nới `{40}` thành `{7,40}` SỐNG SÓT: `git rev-parse
 * --short` cho SHA bảy ký tự, vẫn là hex, vẫn khác rỗng, và không oracle nào phân biệt được.
 * Con số 40 không phải trang trí: `--short` KHÔNG tất định (Git nới độ dài khi kho lớn lên),
 * nên một xuất xứ ngắn là một xuất xứ có thể đổi hình dạng giữa hai lượt chạy.
 */
export function assertFullSha(raw: unknown): string {
  const sha = typeof raw === "string" ? raw.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(
      `commitSha(): không lấy được SHA hợp lệ (nhận được ${JSON.stringify(sha)}). ` +
        `Evidence pack không có xuất xứ thì không phải bằng chứng.`,
    );
  }
  return sha;
}

/** Phán xét một hàng từ danh sách kết quả test mang nhãn của nó. */
export function ketQua(outcomes: readonly TestOutcome[] | undefined): KetQuaHang {
  if (outcomes === undefined || outcomes.length === 0) {
    return { nhan: "⏳ CHƯA PHỦ", coTest: false, chan: false };
  }
  if (outcomes.some((o) => o.status === "failed")) {
    return { nhan: "🔴 ĐANG ĐỎ", coTest: true, chan: true };
  }
  if (outcomes.every((o) => o.status === "skipped")) {
    return { nhan: "⚠️ BỊ BỎ QUA", coTest: true, chan: true };
  }
  return { nhan: "✅ ĐẠT", coTest: true, chan: false };
}

/**
 * Mọi lý do chặn merge, tính trên toàn ma trận. Mảng RỖNG nghĩa là cổng xanh.
 * Hàm thuần: không đọc file, không `process.exit` — nên mọi vế của nó kiểm thử đột biến được.
 */
export function kiemTraCong(
  invariants: readonly Invariant[],
  coverage: ReadonlyMap<string, readonly TestOutcome[]>,
  duocPhep: ReadonlyMap<string, string> = MA_DUOC_PHEP_CHUA_PHU,
  phamViHep: ReadonlyMap<string, string> = PHAM_VI_HEP,
): string[] {
  const van: string[] = [];
  const trongSo = new Set(invariants.map((i) => i.id));

  for (const ma of duocPhep.keys()) {
    if (!trongSo.has(ma)) {
      van.push(
        `Danh sách "được phép chưa phủ" nhắc mã \`${ma}\` KHÔNG có trong sổ đăng ký — ` +
          `hoặc mã sai, hoặc một hàng đã biến mất khỏi docs/TEST-PLAN.md.`,
      );
    }
  }
  for (const ma of phamViHep.keys()) {
    if (!trongSo.has(ma)) {
      van.push(`Ghi chú "phạm vi hẹp" nhắc mã \`${ma}\` KHÔNG có trong sổ đăng ký.`);
    }
  }

  for (const inv of invariants) {
    const kq = ketQua(coverage.get(inv.id));
    const trongDs = duocPhep.has(inv.id);

    if (kq.chan) {
      van.push(`\`${inv.id}\` ${kq.nhan}: có test mang nhãn nhưng không có test nào ĐẠT.`);
      continue;
    }
    if (!kq.coTest && !trongDs) {
      van.push(
        `\`${inv.id}\` CHƯA PHỦ và KHÔNG nằm trong danh sách được phép. Viết lớp cưỡng chế và ` +
          `một test mang nhãn \`[INV-${inv.id}]\`, hoặc — nếu đây là một khoảng trống có lý do — ` +
          `ghi lý do đó vào MA_DUOC_PHEP_CHUA_PHU. Đừng gắn nhãn lên một test đo thứ khác.`,
      );
      continue;
    }
    if (kq.coTest && trongDs) {
      van.push(
        `\`${inv.id}\` ĐÃ ĐƯỢC PHỦ nhưng vẫn nằm trong danh sách được phép chưa phủ. ` +
          `GỠ nó khỏi MA_DUOC_PHEP_CHUA_PHU: một lý do "chưa phủ" đứng dưới một hàng đã phủ ` +
          `là một dòng SAI trong evidence pack. (Vế "tụt lại trong im lặng" KHÔNG do phép ` +
          `kiểm này mua — nó do MOC_GHIM đo; xem khối đầu file.)`,
      );
    }
  }

  return van;
}

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
  ["A1", "S1 — không có endpoint nào, và không có trường giá nào, trong 001–007."],
  ["A2", "S1 — mã hoá phía trình duyệt (ADR-007) chưa có; `packages/crypto-keys/src/roundtrip.test.ts:31` tự ghi lý do KHÔNG gắn thẻ."],
  ["A3", "S1 — bảng bid chưa tồn tại."],
  ["A4", "S1 — bộ quét rò rỉ đòi OpenAPI và endpoint, cả hai chưa có."],
  ["A5", "S1 — chưa có nhà cung cấp, lời mời, hay ID báo giá."],
  ["A6", "S1 — chưa có báo giá để đếm."],

  // --- Nhóm B: hai mã đòi luồng nộp thầu; B5 đòi job định kỳ. ---
  ["B1", "S1 — bảng `vendor_bid_versions` chưa tồn tại."],
  ["B2", "S1 — biên nhận nộp thầu đòi RFQ, ciphertext báo giá và chữ ký hệ thống; không thứ nào có ở S0."],
  ["B5", "S1/S6 — job kiểm tra ciphertext định kỳ chưa tồn tại."],

  // --- Nhóm C: thời gian. C2/D4 do Task 10 CỐ Ý bỏ thẻ, kèm phép đo. ---
  ["C1", "S1 — `deadline_at` và đường nộp thầu chưa tồn tại."],
  ["C2", "S1 — Task 10 CỐ Ý bỏ thẻ `[INV-C2]`: chủ ngữ (RFQ, `deadline_at`, báo giá muộn) chưa có trong 001–007, nên test 'kind lạ chuyển sang FAILED chứ không treo' đo một tính chất THẬT của runner nhưng không đo C2."],
  ["C3", "S1 — chưa có trạng thái RFQ nào để gác."],
  ["C4", "S1 — chưa có deadline để rút ngắn hay gia hạn."],
  // [S1.4] C5 ĐÃ ĐƯỢC GỠ khỏi danh sách này. Chủ ngữ của nó — `rfq_key_material` — nay tồn tại
  // (migration 017), và mệnh đề được cưỡng chế bởi một BỘ BA trigger chứ không bởi một câu lệnh
  // ứng dụng: không sớm hơn, không mồ côi, và chiều ngược lại. Mỗi vế có một phép đo riêng CỘNG
  // một phép đo ĐỘT BIẾN gỡ đúng lớp ấy đi và đòi cùng thao tác ĐI LỌT.

  // --- Nhóm D: hai mã còn lại. ---
  ["D2", "S1 — ngưỡng RFQ và luồng phê duyệt kép chưa tồn tại."],
  ["D4", "S1 — Task 10 CỐ Ý bỏ thẻ `[INV-D4]`: D4 đòi cảnh báo *tức thì*, còn outbox là POLL và độ trễ của nó bị chặn dưới bởi `pollIntervalMs`; đường đúng là `NOTIFY`/`LISTEN` hoặc một đường đồng bộ."],

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
  ["E4", "S1 — MST nay đã có (008) và mã RFQ nay đã có (009), nhưng E4 là một mệnh đề PHỦ ĐỊNH về ĐƯỜNG XÁC THỰC ('không bao giờ là credential'), và đường xác thực của người mua chưa có endpoint nào để đối kháng. Tầng test của nó là T5. Phần cưỡng chế được ĐÃ có: không hàm nào ở cửa `@trustprocure/supplier` hay `@trustprocure/invitation` nhận MST hay mã RFQ làm bằng chứng danh tính."],
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
  ["D1", "**MỆNH ĐỀ HỘI BỐN VẾ, VÀ PHÉP HỘI CHƯA TỪNG ĐƯỢC ĐO MỘT LẦN NÀO.** 17 test mang nhãn tách làm ĐÚNG HAI cụm rời nhau, đếm từ chính báo cáo `vitest --reporter=json`: **12** test ở `packages/identity/src/mfa.int.test.ts` chỉ đo vế **(2) MFA còn hiệu lực trong cửa sổ ngắn** qua `assertFreshMfa`; **5** test ở `packages/identity/src/rbac.int.test.ts` chỉ đo vế **(1) quyền hợp lệ** qua `hasPermission`. KHÔNG test nào đo hai vế cùng lúc, và không có một hàm nào hợp hai vế lại. Vế **(3) RFQ đã CLOSED** và vế **(4) cổng chính sách thông qua** KHÔNG CÓ MỘT DÒNG MÃ NÀO: `grep` toàn repo cho `rfqs`, `wrapped_private_key`, `policyGate` cho **0 hit**, và `git ls-files apps/` cho đúng `apps/.gitkeep`. Vế (3) **CHÍNH LÀ hàng `C3`** trong bảng này, và C3 là **⏳ CHƯA PHỦ** — hai hàng cách nhau tám dòng, một hàng ✅, một hàng ⏳, cùng nói về một điều. Cuối cùng, cả hai phép kiểm ĐÃ CÓ đều **chưa có người gọi sản phẩm**: `assertFreshMfa` và `requirePermission` chỉ xuất hiện ở barrel export, ở chú thích, và ở test — toàn bộ đường đời của `sessions` (phát token, tra token, đặt `mfa_verified_at`) chưa tồn tại. Ô ✅ này chứng minh *hai vế được đo RIÊNG RẼ trên hai phép kiểm chưa có ai gọi*; nó **không** chứng minh mệnh đề ở cột kế bên."],
  ["D5", "Được cưỡng chế cho đường đi **qua `requirePermission`**. Một lần từ chối ở tầng CSDL (RLS/GRANT) không sinh bản ghi nào, và một lần thử MFA thất bại **cố ý** không ghi sổ (ADR-008)."],
  ["E1", "**Vế *thu hồi được* đúng cho TOKEN, và chỉ cho token.** `revokeInvitation` giết được `redeemMagicLink`, nhưng nó KHÔNG chạm tới thách thức OTP đang mở và KHÔNG thu hồi phiên khách; đo được: sau khi thu hồi vẫn phát được OTP và vẫn mở được PHIÊN MỚI. Thêm một phần chênh thứ hai: `consumed_at` của token **không bao giờ được ghi** và `redeemMagicLink` cũng không đọc nó, nên magic link là một bearer token **chơi lại được cho tới khi hết hạn** — sổ đăng ký không đòi *dùng một lần* nên ô ✅ vẫn đứng, nhưng kịch bản T5 #9 (*dùng lại magic link đã dùng*) thì chưa có lớp nào."],
  ["E2", "**Hai vế đã được đóng, và phần chênh còn lại KHÔNG phải phần đã bị bắt.** Vế *token một mình không đủ* nay được cưỡng chế bằng KIỂU: `issueOtpChallenge` và `verifyOtpAndStartSession` đòi **token dạng rõ**, và trigger ở 012 đòi thách thức mang `token_id` của đúng lời mời. Vế *trên kênh đã đăng ký* nay đọc đích **từ `supplier_contacts`**, và `channel` quyết định CỘT nào được đọc — nhãn và sự thật là một thứ. PHẦN CHÊNH: *\"kênh đã đăng ký\"* vẫn là kênh do **NGƯỜI MUA KHAI** khi tạo người liên hệ (`supplier_contacts.phone`, do người mua nhập). Ô ✅ chống được *link bị chuyển tiếp* và *đích do người gọi chọn*; nó **không** chống được *người mua khai sai số*. Xem ADR-015."],
  ["E5", "Phiên khách ghi `verified_contact_id` **DẪN XUẤT từ thách thức OTP đã đối chiếu** — trigger `guest_sessions_kiem_danh_tinh` (012) đòi nó khớp `invitation_otp_challenges.contact_id`, và một câu INSERT viết tay khai một danh tính khác bị CSDL từ chối (có test). PHẦN CHÊNH: giá trị ấy là **NGƯỜI GIỮ KÊNH đã nhận OTP**, KHÔNG phải con người đang ngồi trước màn hình. Một người chuyển tiếp cả link LẪN mã OTP vừa đọc được cho đồng nghiệp thì hệ thống ghi nhận người giữ kênh, và không cơ chế nào trong S1 phân biệt được hai ca đó."],
  ["E3", "Sổ đăng ký định nghĩa E3 bằng **năm** vế. ~~Vế *giới hạn tần suất* **không có một dòng mã nào** trong toàn S0.~~ **[S1.3] Vế ấy nay CÓ LỚP — nhưng CHỈ trên đường OTP của LỜI MỜI** (`otp_rate_limits`, hai hạn mức với hai loại phản ứng, ADR-015 mục 5). **Đường TOTP của `packages/identity` VẪN KHÔNG CÓ giới hạn tần suất nào** — khoản nợ 1 thu hẹp lại, không đóng. Trần loạt đầu của vế *giới hạn số lần thử*: trên đường lời mời nó nay là một hằng số cấu hình thật (`FOR UPDATE` trên thách thức mới nhất), còn trên đường TOTP nó vẫn là độ đồng thời của kẻ tấn công."],
  ["F1", "RLS + FORCE phủ mọi bảng tenant, `outbox_jobs` gồm cả. Hàng rào `assertTenantBound` ở tầng ứng dụng là lớp thứ hai và nó tự làm mù mình bằng DANH SÁCH TÊN ở hai chỗ đã đo: `NOBYPASSRLS` chỉ ghim đúng bốn tên role, và hàm plpgsql ngoài danh sách không được ghim."],
  ["G1", "~~**TÀI SẢN ĐƯỢC BẢO VỆ CHƯA TỒN TẠI.**~~ **[S1.4] VẾ ẤY HẾT HIỆU LỰC — và một vế THU HẸP MỚI ra đời cùng lúc, ngược chiều.** Nguyên văn cũ giữ để đối chiếu: *`grep wrapped_private_key` toàn repo cho 0 hit, `git ls-files apps/` cho đúng `apps/.gitkeep`*. Nay `rfq_key_material.wrapped_private_key` là một cột thật có dữ liệu thật, `app_api` GHI được mà KHÔNG ĐỌC được nó (đo được: `SELECT` bị Postgres từ chối, cùng câu ấy dưới `app_unseal` chạy), và một lượt đột biến cấp thêm đúng cột ấy cho `app_api` chứng minh quyền cột LÀ thứ đang chặn. **PHẦN CHÊNH MỚI, do ADR-019 tạo ra và không được nuốt vào ô ✅:** tiến trình `api` **CÓ** chạm khoá riêng RFQ dạng rõ, trong cửa sổ thời gian của đúng hàm `issueRfqKeyPair`. `fill(0)` xoá được chuỗi byte PKCS8 tự xuất ra; nó KHÔNG xoá được phần khoá bên trong đối tượng `CryptoKey` của runtime. Vế *“không vào core dump”* của mệnh đề vì vậy **không đúng tuyệt đối** kể từ S1.4, và điều kiện xét lại có mốc: khi `apps/unseal-worker` ra đời ở S1.6. Khoảng trống thứ hai, ĐỘC LẬP và VẪN NGUYÊN: bốn gói (`audit`, `tenancy`, `db`, `test-support`) CHƯA có danh sách trắng barrel."],
  ["G2", "**MỆNH ĐỀ NÓI “MỘT CẶP KHOÁ”, HIỆN THỰC CHO HAI — và vế chịu lực là vế thứ hai.** ADR-011 chốt *P-256 mặc định, X25519 cơ hội*, mà ECDH đòi hai bên cùng đường cong, nên một RFQ mang một cặp khoá CHO MỖI thuật toán (`UNIQUE (org_id, rfq_id, algorithm)`). Vế *“lộ một RFQ không lan sang RFQ khác”* thì nguyên vẹn và được đo ba mũi: khoá riêng của A không mở được phong bì của B; ĐÚNG khoá riêng nhưng SAI mã RFQ cũng không mở được (`rfqId` nằm trong INFO của HKDF, nên ràng buộc là MẬT MÃ chứ không phải một câu `if`); và hai lần niêm phong cùng một bản rõ cho hai phong bì khác nhau. **PHẦN CHÊNH:** vẫn còn một TỔ TIÊN CHUNG mà mệnh đề không nói tới — cả hai khoá riêng được bọc bằng khoá dẫn xuất THEO TỔ CHỨC (`deriveOrgKey`), nên mất khoá gốc của tổ chức là mất mọi RFQ của tổ chức ấy. Đó là địa hạt của G1 và F3, không phải của G2; ghi ở đây để không ai đọc ô ✅ thành *“mỗi RFQ là một ốc đảo”*."],
  ["G4", "**MỆNH ĐỀ LIỆT KÊ BỐN THAO TÁC; S1.4 CÓ BA, VÀ CHỈ ĐO ĐƯỢC BA.** *Sinh* và *bọc* là MỘT hành vi không tách được ở thiết kế của ADR-019 (bản rõ không tồn tại ngoài một hàm), nên chúng là MỘT bản ghi `RFQ_KEY_MATERIAL_ISSUED` — ghi ra thay vì để người đọc đếm bốn action và tìm không thấy. *Huỷ* là `RFQ_KEY_MATERIAL_REVOKED`. **VẾ *MỞ BỌC* KHÔNG CÓ MỘT DÒNG MÃ NÀO**: nó sống trong `apps/unseal-worker`, thứ chưa tồn tại (S1.6) — và đó là vế mà một kiểm toán viên hỏi tới ĐẦU TIÊN, vì nó là lần duy nhất một khoá riêng thật sự được dùng. **PHẦN CHÊNH THỨ HAI:** *huỷ* ở S1 chỉ có ĐÚNG MỘT nguyên nhân được hỗ trợ — RFQ bị huỷ. Thu hồi vì một sự cố an ninh trong khi RFQ đang mở không phải đường đi được hỗ trợ, và thu hồi là một DẤU chứ không phải một lần xoá mật mã: `wrapped_private_key` vẫn nằm nguyên trong hàng."],
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
  "D1", "D5", "E1", "E2", "E3", "E5", "F1", "G1",
  // [S1.4] Hai mã MỚI, và cả hai vào đây CÙNG LÚC với ô ✅ của chúng — không phải sau một vòng
  // review. G2 vì mệnh đề nói "một cặp khoá" trong khi hiện thực cho hai; G4 vì mệnh đề liệt kê
  // bốn thao tác trong khi S1.4 chỉ có ba.
  "G2", "G4",
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
export const MOC_GHIM: MocGhim = { soPhuToiThieu: 33, coDanhSachToiDa: 17 };

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

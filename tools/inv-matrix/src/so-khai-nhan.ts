// =============================================================================================
// SỔ KHAI NHÃN BẤT BIẾN — mã bất biến ⇒ những tệp test được phép mang nhãn ấy trong `fullName`
//
// [INV-H22, khoản nợ 12] Bộ sinh gom độ phủ bằng nhãn `[INV-XX]` trong `fullName` của báo cáo
// vitest. Một nhãn gắn SAI CHỖ ghi một dòng *"passed"* vào hàng của một bất biến và làm một lỗ
// trống trông như đã vá. Sổ này là câu trả lời: mỗi cặp (mã, tệp) phải được KHAI, và cổng
// evidence đọc CHÍNH báo cáo vitest — cùng nguồn với bộ gom độ phủ — để đối chiếu hai chiều.
//
// Vì sao nằm ở đây chứ không ở một tệp test quét mã nguồn: bản đầu của [INV-H22] (S1.29) quét
// DÒNG NGUỒN bắt đầu bằng `it(`/`describe(`. Lượt soi đối kháng lượt 19 đo được rằng bộ sinh
// đếm theo `fullName` LÚC CHẠY, nên `test(`, `it.concurrent(`, tiêu đề ở dòng sau của
// `it.each([...])(`, đều nuôi ma trận mà bộ quét mù — và kho ĐANG có 8 tên test như thế. Một
// phép kiểm đọc nguồn KHÁC với thứ nó canh là một phép kiểm đo sai đối tượng. Nay hai bên đọc
// cùng một báo cáo: không còn cách viết nào làm chúng lệch nhau.
//
// Sinh từ phép đo trên báo cáo vitest tại `4d8f901` rồi ĐÓNG BĂNG: 56 mã, 137 cặp (tại `bebeb41`
// — trước khi tệp test của H22 tồn tại — là 55 mã, 136 cặp; cặp thứ 137 là của chính H22).
// Thêm một dòng ở đây là một quyết định, và nó phải đi kèm câu trả lời cho *"tệp ấy đo được bất
// biến này bằng cách nào"*. Sổ này KHÔNG kiểm toán 137 cặp có sẵn — nó chặn cặp thứ 138 đi vào
// lặng lẽ. Vế *"test này có thật sự đo bất biến ấy không"* là một PHÁN XÉT của mắt người.
// =============================================================================================

export const SO_KHAI_NHAN: Readonly<Record<string, readonly string[]>> = {
  A1: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
  ],
  A2: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    // [S1.85 / khoản 131] Dòng log của một lần từ chối MẤT khỏi sổ giàu thêm bốn hằng đóng — và hai tệp này đo vế A2 của
    // lần giàu ấy: `mo-ta-hang-dong` ở mức hàm (một giá trị đặt đúng vào trường được đọc vẫn ra `HANG_LA`), và
    // `log-tu-choi-mat` qua HTTP trên tiến trình thật (dòng không mang id tổ chức, id người dùng hay thân yêu cầu).
    "apps/api/src/log-tu-choi-mat.int.test.ts",
    "packages/identity/src/mo-ta-hang-dong.test.ts",
  ],
  A3: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/bidding/src/bidding.int.test.ts",
  ],
  A4: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
    "packages/unseal/src/comparison.int.test.ts",
  ],
  A5: [
    "apps/api/src/api.int.test.ts",
    "apps/api/src/guest.int.test.ts",
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "tests/adversarial/a5-co-lap-nha-cung-cap.int.test.ts",
  ],
  A6: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/unseal/src/comparison.int.test.ts",
  ],
  B1: [
    "apps/api/src/guest.int.test.ts",
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/bidding/src/bidding.int.test.ts",
  ],
  B2: [
    "apps/api/src/guest.int.test.ts",
    "apps/public-keys/src/public-keys.test.ts",
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/bidding/src/bidding.int.test.ts",
    "packages/bidding/src/receipt.test.ts",
    "tests/architecture/barrel-exports.test.ts",
  ],
  B3: [
    "db/audit-append-only.int.test.ts",
    "packages/audit/src/anchor-sign.test.ts",
    "packages/audit/src/anchor-store.test.ts",
    "packages/audit/src/anchor-verify.test.ts",
    "packages/audit/src/chain.int.test.ts",
    "packages/audit/src/tenant-guard.int.test.ts",
    "packages/audit/src/verifier.test.ts",
    "tools/neo-so-kiem-toan/src/cong-cu.int.test.ts",
  ],
  B4: [
    "db/audit-append-only.int.test.ts",
    "packages/audit/src/chain.int.test.ts",
  ],
  B5: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "tests/adversarial/t5-doi-khang.int.test.ts",
  ],
  C1: [
    "packages/bidding/src/bidding.int.test.ts",
  ],
  C2: [
    "tests/adversarial/t5-doi-khang.int.test.ts",
  ],
  C3: [
    "packages/unseal/src/unseal.int.test.ts",
  ],
  C4: [
    // [S1.151 / khoản 127] Ca gia hạn ĐỒNG THỜI tới cùng một hạn đo vế *"gia hạn chỉ khi hạn mới xa hơn, có audit"* của
    // C4 dưới khoá hàng thật: lần sau bị từ chối và sổ mang đúng MỘT `RFQ_DEADLINE_EXTENDED` với `truoc` của lần đầu.
    "packages/rfq/src/rfq.int.test.ts",
    "tests/adversarial/t5-doi-khang.int.test.ts",
  ],
  C5: [
    "packages/sealed-envelope/src/hang-so.test.ts",
    "packages/sealed-envelope/src/key-material.int.test.ts",
  ],
  D1: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/identity/src/dinh-chi.int.test.ts",
    "packages/identity/src/mfa.int.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
  ],
  D2: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    // [S1.85 / khoản 147] Bộ lọc D2 của `approveUnseal` đối chiếu NGUYÊN VĂN với các câu `RAISE` của `019` — khuôn §R3,
    // và là lớp duy nhất canh được một vế mà đường sản xuất không tới.
    "packages/unseal/src/loc-vi-pham-d2.test.ts",
    "packages/identity/src/ma-tran-quyen.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    // [S1.185 / S3.2a] Điểm chịu lực của băm danh sách NULL ở MVP1: thêm lời mời ở PENDING_APPROVAL rồi cùng người ký lại vẫn bị
    // UNIQUE chặn, và hai đột biến (băm cho mọi tổ chức, UNIQUE mất `NULLS NOT DISTINCT`) mở gói cấp kép với MỘT người.
    "packages/rfq/src/danh-sach-moi.int.test.ts",
    // [S1.193 / khoản 254] Gói cấp kép MỘT chữ ký, trả về, hạ ngân sách về một chữ ký: chữ ký cho lúc gói cần hai người
    // không mở được gói — và đột biến bỏ phép đếm trên ngân sách mở lại đúng lỗ ấy.
    "packages/rfq/src/rang-ngan-sach.int.test.ts",
    // [S1.194 / khoản 256 · khoản 257] Cột lần nộp về NULL ở tổ chức chưa bật là điểm chịu lực của phép đếm HÀNG ở `071`: gói cấp
    // kép, một người duyệt không mốc rồi mốc đúng bị UNIQUE chặn — và đột biến bỏ vế NULL mở gói bằng một người. Lời tự duyệt
    // thiếu mốc vẫn là lời từ chối D2 có sổ (trigger so lần nộp chạy sau chốt D2), và đột biến đổi thứ tự làm nó rơi khỏi sổ.
    "packages/rfq/src/lan-nop-da-xem.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
  ],
  D3: [
    "packages/identity/src/ma-tran-quyen.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    // [S1.100 / khoản 209 + 210] Ba tệp trên đo D3 ở mức VAI TRÒ và QUYỀN — kể cả một khối *phân tách nhiệm
    // vụ ở mức người dùng* ở `rbac.int.test.ts`. KHÔNG tệp nào đo đường BREAK-GLASS, đúng chỗ D3 phá được
    // bằng một câu `UPDATE` sau khi đường phê duyệt đã bị bỏ.
    "packages/unseal/src/unseal.int.test.ts",
  ],
  D4: [
    "apps/unseal-worker/src/composition.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
  ],
  D5: [
    "apps/api/src/api.int.test.ts",
    // [S1.86 / khoản 128] Ai GIỮ được khoá ghi sổ của tổ chức, và giữ được bao lâu: một phiên vai ứng dụng nay KHÔNG lấy
    // được khoá mức PHIÊN (42501), nên không còn đường CỐ Ý làm mọi lần ghi sổ của một tổ chức gãy 55P03 vô thời hạn.
    "db/khoa-ghi-so-nguoi-giu.int.test.ts",
    // [S1.85 / khoản 131] Lần từ chối KHÔNG ghi được sổ vì trần 2 s của `050`: D5 vẫn fail-closed, và dòng log nay nói
    // lần từ chối nào đã mất. [khoản 147] `loc-vi-pham-d2` canh vế D2 mà `unseal.int.test.ts` không dựng được.
    "apps/api/src/log-tu-choi-mat.int.test.ts",
    "packages/unseal/src/loc-vi-pham-d2.test.ts",
    // [S1.155 / khoản 122 · 144] Trần lần từ chối theo phiên: N lần đầu mỗi cửa sổ VẪN để lại hàng sổ, phần còn lại 429 không
    // hàng — D5 đo bằng số hàng `PERMISSION_DENIED`/`AGENT_SCOPE_DENIED` trước và sau trần.
    "apps/api/src/auth.int.test.ts",
    "apps/api/src/buyer.int.test.ts",
    "apps/api/src/composition.int.test.ts",
    "apps/api/src/loi-giao-thuc.int.test.ts",
    "apps/unseal-worker/src/composition.int.test.ts",
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
    "packages/identity/src/mfa-reset.int.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    "packages/unseal/src/comparison.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
    "tests/architecture/ghi-so-tu-choi-mot-duong.test.ts",
  ],
  E1: [
    "apps/api/src/auth.int.test.ts",
    "apps/api/src/guest.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
  ],
  E2: [
    "apps/api/src/auth.int.test.ts",
    "apps/api/src/guest.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
  ],
  E3: [
    "apps/api/src/auth.int.test.ts",
    "packages/identity/src/mfa.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
  ],
  E4: [
    "tests/adversarial/t5-doi-khang.int.test.ts",
  ],
  E5: [
    "packages/invitation/src/invitation.int.test.ts",
  ],
  E6: [
    "apps/api/src/api.int.test.ts",
    "apps/api/src/auth.int.test.ts",
    "apps/api/src/guest.int.test.ts",
    "apps/api/src/routes.test.ts",
  ],
  F1: [
    "db/migration-shape.test.ts",
    "db/migrations.int.test.ts",
    "db/rls-coverage.int.test.ts",
    "packages/audit/src/chain.int.test.ts",
    "packages/audit/src/tenant-guard.int.test.ts",
    "packages/audit/src/verifier.test.ts",
    "packages/identity/src/mfa.int.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
    "packages/outbox/src/outbox.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    "packages/sealed-envelope/src/key-material.int.test.ts",
    "packages/supplier/src/suppliers.int.test.ts",
    "packages/tenancy/src/with-tenant.int.test.ts",
  ],
  F2: [
    "packages/tenancy/src/with-tenant.int.test.ts",
  ],
  F3: [
    "packages/crypto-keys/src/roundtrip.test.ts",
  ],
  G1: [
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
    "packages/audit/src/anchor-sign.test.ts",
    "packages/crypto-keys/src/roundtrip.test.ts",
    "packages/sealed-envelope/src/key-material.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
    "tests/architecture/boundaries.test.ts",
  ],
  G2: [
    "packages/sealed-envelope/src/key-material.int.test.ts",
    "packages/sealed-envelope/src/roundtrip.test.ts",
  ],
  G3: [
    "packages/crypto-keys/src/roundtrip.test.ts",
  ],
  G4: [
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
    "packages/sealed-envelope/src/key-material.int.test.ts",
  ],
  H1: [
    "tests/hooks/git-safety.test.ts",
  ],
  H10: [
    "tests/hooks/git-safety.test.ts",
    "tests/hooks/protect-secrets.test.ts",
  ],
  H11: [
    "tests/architecture/boundaries.test.ts",
  ],
  H12: [
    "tests/architecture/boundaries.test.ts",
  ],
  H13: [
    "tests/architecture/boundaries.test.ts",
  ],
  H14: [
    "db/unique-oracle.int.test.ts",
  ],
  H15: [
    "tests/architecture/barrel-exports.test.ts",
    "tests/architecture/boundaries.test.ts",
  ],
  H16: [
    "tests/architecture/barrel-exports.test.ts",
    "tests/architecture/bien-gioi-goi.test.ts",
    "tests/architecture/boundaries.test.ts",
  ],
  H17: [
    "apps/api/src/api.int.test.ts",
    "apps/api/src/buyer.int.test.ts",
    "apps/api/src/routes.test.ts",
  ],
  H18: [
    "tests/architecture/barrel-exports.test.ts",
  ],
  H19: [
    // [S1.100 / khoan 211] Luot tu chua cua hardening cai lai DUNG ban da ghim — cho ghim ⑵ so voi ⑴/⑶ bang
    // chinh PostgreSQL lam bo chuan hoa, vi hai ben viet hai chinh ta khac nhau.
    "db/ghim-trigger-tu-chua.int.test.ts",
    "db/hardening-suy-tu-tinh-chat.int.test.ts",
    "tests/architecture/hardening-co-ly-do.test.ts",
  ],
  H2: [
    "tests/hooks/git-safety.test.ts",
  ],
  H20: [
    "tests/architecture/so-no-tu-doi-chieu.test.ts",
  ],
  H21: [
    "tests/architecture/qt3-cu-phap.int.test.ts",
    "tests/architecture/qt3-ghim-schema.test.ts",
    "tests/architecture/qt3-ngu-phap.int.test.ts",
  ],
  H22: [
    "tests/architecture/nhan-bat-bien-cho-dat.test.ts",
  ],
  H3: [
    "tests/hooks/git-safety.test.ts",
  ],
  H4: [
    "tests/hooks/git-safety.test.ts",
  ],
  H5: [
    "tests/hooks/git-safety.test.ts",
  ],
  H6: [
    "tests/hooks/git-safety.test.ts",
  ],
  H7: [
    "tests/hooks/git-safety.test.ts",
  ],
  H8: [
    "tests/hooks/protect-secrets.test.ts",
  ],
  H9: [
    "tests/hooks/protect-secrets.test.ts",
  ],
  // ---------------------------------------------------------------------------------------
  // [S1.115 / khoản 229] NHÓM J — và mỗi dòng dưới đây trả lời câu *"tệp ấy đo được bất biến
  // này bằng cách nào"* mà khối đầu tệp đòi.
  //
  // ~~**J6 KHÔNG có ở đây**, và đó là một lời khai chứ không một sơ suất: mệnh đề của nó rộng hơn
  // thứ đang được cưỡng chế (khoản **239**), nên nó chưa có hàng trong sổ đăng ký để khai vào.~~
  // **[S1.116 / khoản 239 / ADR-060] J6 NAY CÓ MẶT.** Mệnh đề được phát biểu lại đúng mức, luật ghi sổ
  // CHỌN LỌC cài ở `packages/danh-gia/src/tu-choi-vao-so.ts`, và ba ca đo nó — một mã CHUỖI vào sổ, một mã
  // CẤU HÌNH không vào, và một đột biến chặn lần ghi để chứng minh nó fail-CLOSED.
  // ---------------------------------------------------------------------------------------
  // J1 — vế LỌC: `DIEM` không bao giờ vào tổng. Hàm thuần đo vế tính; tệp tích hợp đo vế
  // trigger, cộng một đột biến gỡ trigger lúc chạy.
  J1: [
    "packages/danh-gia/src/chi-phi-hieu-dung.test.ts",
    "packages/danh-gia/src/luot-danh-gia.int.test.ts",
  ],
  // J2 — TÁI LẬP ĐƯỢC. Năm tệp vì bất biến này sống ở năm chỗ khác nhau: hàm thuần, luật làm
  // tròn đối chiếu với Postgres, dữ liệu ĐÃ GHI, và hai nửa của bộ bằng chứng S2.7 — trong đó
  // `kiem.test.ts` mang ba mũi đột biến của ADR-059.
  J2: [
    "packages/danh-gia/src/chi-phi-hieu-dung.test.ts",
    "packages/danh-gia/src/luot-danh-gia.int.test.ts",
    "packages/danh-gia/src/nua-xu.int.test.ts",
    "tools/bo-xuat-danh-gia/src/bo-xuat.int.test.ts",
    "tools/bo-xuat-danh-gia/src/kiem.test.ts",
  ],
  // J3 — ba vế phân tách nhiệm vụ; tệp HTTP đo vế ấy trên đường sản xuất thật.
  J3: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/danh-gia/src/luot-danh-gia.int.test.ts",
  ],
  // J4 — giá BAFO không rò trước cổng bốn vế. Cùng bộ quét với `[INV-A2]`, câu hỏi KHÁC: A2
  // hỏi *người KHÔNG có quyền thấy gì*, J4 hỏi *người CÓ ĐỦ quyền thấy gì*.
  J4: ["apps/unseal-worker/src/kich-ban-41-http.int.test.ts"],
  // J5 — award trỏ đúng báo giá của đúng RFQ, và báo giá ấy đọc được giá.
  J5: ["packages/danh-gia/src/luot-danh-gia.int.test.ts"],
  // J6 — dấu vết của một hành động và của một lần từ chối. Ba ca nằm cùng tệp với giàn cảnh trao thầu,
  // vì đột biến của nó cần một lối từ chối THẬT trên đường sản xuất chứ không một lời gọi tay.
  J6: ["packages/danh-gia/src/luot-danh-gia.int.test.ts"],
  // J7 — tối đa MỘT award còn sống.
  J7: ["packages/danh-gia/src/luot-danh-gia.int.test.ts"],
  // J8 — tiền tệ báo giá đọc qua MỘT hàm. Ba tệp vì ba câu hỏi: lượt chấm (bảng ca, đích M1/M2, đột
  // biến thay thân hàm), bảng so sánh (đích M4/M5), và cổng kiến trúc cấm một bộ đọc thứ sáu đọc trần.
  J8: [
    "packages/danh-gia/src/luot-danh-gia.int.test.ts",
    "packages/unseal/src/comparison.int.test.ts",
    "tests/architecture/tien-te-mot-cho-doc.test.ts",
  ],
  // K1 — [S1.166 / S3.1b] gói rời DRAFT mang đúng bậc. `bac-chinh-sach` đo ở tầng gói và tầng CSDL: bảng ca biên hằng
  // số, mỗi vế của `rfq_chot_ngan_sach` một đột biến, đua với lần ký. Tệp HTTP đo lời từ chối có tên qua route thật và
  // hàng `CONTROL_DENIED` nó để lại.
  K1: [
    "apps/api/src/buyer.int.test.ts",
    "packages/rfq/src/bac-chinh-sach.int.test.ts",
  ],
  // K4a · K4b · K6 — [S1.185 / S3.2a] danh sách mời. `danh-sach-moi` đo ba chốt CSDL dưới `app_api`: mỗi trạng thái của gói
  // một ca, đua `FOR SHARE` với cạnh nộp duyệt, đổi danh sách GIỮA hai chữ ký, và mỗi trigger một đột biến. Tầng gói và route
  // của lời mời đổi ở S3.2b.
  // [S1.186 / S3.2b1] `tra-ve-nhap` đo cạnh về DRAFT ở tầng gói và tầng CSDL (K4a), chữ ký cũ sau lần trả về (K4b) và cột
  // `duc_khi_goi_da_mo` (K6); tệp HTTP đo route của cạnh; `token-goi-da-mo` đo K6 ở PHÍA DÙNG — đổi link, xin và xác minh OTP.
  // [S1.188 / S3.2b2] `luong-moi-s3` đo luồng mời mới qua HTTP: mời ở DRAFT không token (K4a, K6), đúc lúc mở gói, gửi sau
  // commit, `SENT` sau lần gửi được, gửi hỏng để lời mời *chưa gửi* (K6).
  // [S1.193 / khoản 254] `rang-ngan-sach` đo chữ ký ràng vào ngân sách (K4b): hạ bậc, nâng cùng bậc, ghim phiên bản chính sách
  // mới, cột ngoài `GRANT`, vế NULL của MVP1, hàng cũ không điền, và mỗi vế của bản vá một đột biến.
  // [S1.194 / khoản 256 · khoản 257] `lan-nop-da-xem` đo lời duyệt mang lần nộp đã xem và lần trả về rút chữ ký của chính người
  // trả (K4b), hàng `rfq_tra_ve` mà cạnh về DRAFT đòi (K4a), và mỗi vế một đột biến; `buyer.int` đo thân `{lanNop}` của route duyệt
  // ở tổ chức đã bật (K4b).
  K4a: [
    "apps/api/src/buyer.int.test.ts",
    "apps/api/src/luong-moi-s3.int.test.ts",
    "packages/rfq/src/danh-sach-moi.int.test.ts",
    "packages/rfq/src/lan-nop-da-xem.int.test.ts",
    "packages/rfq/src/tra-ve-nhap.int.test.ts",
  ],
  K4b: [
    "apps/api/src/buyer.int.test.ts",
    "packages/rfq/src/danh-sach-moi.int.test.ts",
    "packages/rfq/src/lan-nop-da-xem.int.test.ts",
    "packages/rfq/src/rang-ngan-sach.int.test.ts",
    "packages/rfq/src/tra-ve-nhap.int.test.ts",
  ],
  K6: [
    "apps/api/src/luong-moi-s3.int.test.ts",
    "apps/api/src/token-goi-da-mo.int.test.ts",
    "packages/rfq/src/danh-sach-moi.int.test.ts",
    "packages/rfq/src/tra-ve-nhap.int.test.ts",
  ],
  // L1 · L4 — [S1.192 / S4.1] đơn vị đo. `don-vi` đo dưới `app_api` trên Postgres thật: khuôn ghi của bảng dữ liệu nền (ba cột
  // ngoài GRANT, trigger đặt `seq`/`ghi_luc`, chỉ-ghi-thêm, hai giao dịch đồng thời, tổng điều tra `BANG_DU_LIEU_NEN`) cho L1;
  // bảng ca quy đổi, bí danh tại mốc và đột biến `ELSE 1` cho L4.
  L1: ["packages/du-lieu-nen/src/don-vi.int.test.ts"],
  L4: ["packages/du-lieu-nen/src/don-vi.int.test.ts"],
};

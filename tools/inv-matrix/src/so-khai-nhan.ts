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
    "packages/identity/src/ma-tran-quyen.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
  ],
  D3: [
    "packages/identity/src/ma-tran-quyen.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
  ],
  D4: [
    "apps/unseal-worker/src/composition.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
  ],
  D5: [
    "apps/api/src/api.int.test.ts",
    "apps/api/src/buyer.int.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
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
};

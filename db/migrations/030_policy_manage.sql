-- =============================================================================================
-- 030 — [S1.10.5 / ADR-017 + ADR-020] MÃ QUYỀN `policy.manage`: ai được đặt ngưỡng phê duyệt kép
-- =============================================================================================
-- ADR-017 để ngỏ *"ai được sửa chính sách"* và trỏ sang ADR-016 mục 4 (mã quyền cho route ấy).
-- Chốt 2026-09-06 cùng ADR-020: `PROCUREMENT_MANAGER`.
--
--   • KHÔNG cấp cho `BUYER`: người khai ước lượng (`setRfqBudget`) không được là người đặt ngưỡng
--     mà ước lượng ấy bị so với — cùng lớp lý do D3 tách "tạo" khỏi "duyệt".
--   • KHÔNG cấp cho `DIRECTOR`: vai phê duyệt mở thầu cố ý đứng ngoài việc định hình chính sách,
--     cùng lý do 023 không cấp `rfq.open` cho họ.
--   • Không chạm chuỗi D3 (`rfq.create → rfq.invite → rfq.unseal → award.recommend → po.approve`),
--     nên trigger `role_permissions_ma_tran_quyen` không có gì để nói — và test
--     `ma-tran-quyen.test.ts` đòi PERMISSIONS (TypeScript) khớp NGUYÊN VĂN bảng này: hai bên đổi
--     trong cùng commit.
-- =============================================================================================

INSERT INTO permissions (code, description) VALUES
  ('policy.manage', 'Tạo phiên bản chính sách mua sắm — ngưỡng phê duyệt kép của tổ chức (ADR-017)');

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('PROCUREMENT_MANAGER', 'policy.manage');

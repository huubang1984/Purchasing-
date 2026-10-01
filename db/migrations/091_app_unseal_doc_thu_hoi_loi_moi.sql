-- ==============================================================================================
-- 091_app_unseal_doc_thu_hoi_loi_moi — [S1.217 / khoản 250 / ADR-128] `app_unseal` ĐỌC ĐƯỢC `rfq_invitations.revoked_at`
--
-- Thu hồi lời mời từ S1.217 LOẠI báo giá của lời mời ấy khỏi lượt mở thầu, bảng so sánh và lượt chấm (ADR-128). Ba câu
-- chọn phong bì/bản rõ mang cùng một vế `i.revoked_at IS NULL` — bản chép nguyên văn ở ba tệp, cổng tĩnh
-- `tests/architecture/phong-bi-loi-moi-con-song.test.ts` đòi bằng nhau. Hai bộ đọc (bảng so sánh, lượt chấm) chạy dưới
-- `app_api`, vai có SELECT cả bảng (`010`); bộ đọc thứ ba là worker mở thầu dưới `app_unseal`, và `019` cấp vai ấy ĐÚNG BA
-- cột `(id, org_id, rfq_id)`. Đo ở §S1.217 (đo trước bản vá của worker): câu chọn phong bì mang vế mới gãy
-- `permission denied for table rfq_invitations`. Không cột nào vai ấy đọc được mang dấu thu hồi, nên đây là một GRANT không
-- tránh được — MỘT cột, CHỈ SELECT.
--
-- KHÔNG cấp `status`: `revoked_at` là dấu duy nhất vế lọc cần (`rfq_invitations_thu_hoi_co_moc` ở `010`:
-- `status = 'REVOKED'` ⇔ `revoked_at IS NOT NULL`), và `supplier_id`, `contact_id`, `link_channel`, `status` vẫn KHÔNG
-- cấp — worker không có việc gì với danh tính nhà cung cấp (lý do của `019` giữ nguyên, chỉ con số "ba cột" đổi thành
-- bốn). Lời khai cột của `app_unseal` ở `db/rls-coverage.int.test.ts` đổi cùng commit.
--
-- Không bảng mới, không hàm, không trigger, không policy: `hardening.always.sql` không có gì để ghim.
-- ==============================================================================================

GRANT SELECT (revoked_at) ON rfq_invitations TO app_unseal;

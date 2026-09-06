-- =============================================================================================
-- 036 — [sổ nợ 46 / review lượt 2 H2-9 ⑵] NGƯỜI LIÊN HỆ ĐƯỢC MỜI PHẢI THUỘC NHÀ CUNG CẤP ĐƯỢC MỜI
-- =============================================================================================
-- `rfq_invitations` (010) có hai khoá ngoại RỜI: `(org_id, supplier_id) → suppliers` và
-- `(org_id, contact_id) → supplier_contacts`. Không ràng buộc nào nói `contact ∈ supplier`. Route
-- `/rfqs/:rfqId/invitations` kiểm điều đó ở tầng ứng dụng (S1.10.7, trước khi tạo); nhưng
-- `createInvitation` gọi từ một nơi khác (job, route tương lai, một câu INSERT dưới `app_api`)
-- với `supplierId = X` và `contactId` của Y thì magic link đi tới người của Y trong khi phiên khách
-- và đơn thầu mang danh X — sai danh tính ở đúng chỗ E5 nói tới.
--
-- Lớp CSDL: một khoá ngoại TỔ HỢP `(org_id, supplier_id, contact_id) → supplier_contacts
-- (org_id, supplier_id, id)`. Đích cần một UNIQUE tương ứng; `(org_id, supplier_id, id)` là siêu
-- khoá của `id` nên không mang oracle mới (org_id đứng đầu — H14, `unique-oracle.int.test.ts`
-- đo mọi chỉ mục duy nhất). Hai khoá ngoại cũ GIỮ NGUYÊN: chúng canh hai vế riêng và thông điệp
-- 23503 của chúng đang được test đọc.
-- =============================================================================================

ALTER TABLE supplier_contacts
  ADD CONSTRAINT supplier_contacts_org_supplier_id_key UNIQUE (org_id, supplier_id, id);

ALTER TABLE rfq_invitations
  ADD CONSTRAINT rfq_invitations_contact_thuoc_supplier
  FOREIGN KEY (org_id, supplier_id, contact_id)
  REFERENCES supplier_contacts (org_id, supplier_id, id);

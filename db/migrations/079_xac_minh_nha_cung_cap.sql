-- ==============================================================================================
-- 079_xac_minh_nha_cung_cap — [S1.192 / S3.3a của spec S3] XÁC MINH NỘI BỘ NHÀ CUNG CẤP (K8a)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.8, §5.1 (K8), §9 (S3.3). ADR-081 ⑵,
-- ADR-084 ⑵ ⑶ ⑷. Chủ dự án chốt ngày 2026-09-29: S3.3 chia năm PR, S3.3a là xác minh; hạn hiệu lực của xác minh dùng CHUNG
-- cột `tham_dinh_hieu_luc_thang` của phiên bản chính sách hiệu lực.
--
-- XÁC MINH là cấp đầu của hai cấp ở ADR-081 ⑵: việc nội bộ bên mua, không đòi nhà cung cấp làm gì. Một người giữ
-- `supplier.qualify`, khác người tạo bản ghi nhà cung cấp và không giữ `rfq.invite`, xác nhận MST, tên pháp lý và đích liên
-- hệ. K2 (S3.3c) chỉ đếm nhà cung cấp có xác minh CÒN HIỆU LỰC — hàm (5) dưới đây là câu hỏi duy nhất ấy.
--
-- (1) MÃ QUYỀN `supplier.qualify` CHO `FINANCE` (ADR-084 ⑵): vào CSDL đúng ở hạng mục dựng hành vi của nó (⑶). Không
--     chạm chuỗi D3 nên `role_permissions_ma_tran_quyen` không có gì để nói; `PERMISSIONS` (TypeScript) đổi cùng commit.
-- (2) BẢNG `supplier_verifications`, CHỈ GHI THÊM — khuôn `org_policy_signatures` (`069`). Hai loại hàng: `VERIFIED` và
--     `REVOKED` (có lý do). Trạng thái của một nhà cung cấp là hàng có `thu_tu` LỚN NHẤT — không xếp theo `now()`: một
--     `REVOKED` bắt đầu trước nhưng commit sau một `VERIFIED` sẽ bị lờ (ADR-081 ⑵). `thu_tu` do trigger đặt DƯỚI KHOÁ TƯ VẤN
--     theo nhà cung cấp, nên thứ tự cấp số là thứ tự commit.
-- (3) BĂM HỒ SƠ LÚC XÁC MINH (`ncc_bam_xac_minh`) — khuôn C-1 của `011`: một xác minh nói nó đã xác nhận ĐÚNG hồ sơ nào. Đổi
--     MST, tên pháp lý, trạng thái, hay một người liên hệ (email, điện thoại, trạng thái; thêm hay bớt) thì xác minh thôi
--     hiệu lực mà không hàng nào bị sửa. Hôm nay `app_api` không `UPDATE` được hai bảng ấy (`011` thu hồi), nhưng THÊM được
--     người liên hệ — đúng đường một đích liên hệ chưa ai xác nhận lọt vào hồ sơ đã xác minh; và một đường sửa hồ sơ về sau
--     (hay một câu sửa tay của chủ CSDL) cũng rơi vào đây mà không cần ai nhớ thu hồi xác minh.
-- (4) LUẬT NGƯỜI Ở TRIGGER, đọc DỮ LIỆU THẬT lúc chèn (khuôn ADR-051): người xác minh giữ `supplier.qualify`, KHÔNG giữ
--     `rfq.invite`, và KHÔNG là người tạo bản ghi nhà cung cấp hay bất kỳ người liên hệ nào của nó — người liên hệ nằm trong
--     băm, nên người tạo người liên hệ là người đặt một nửa thứ được xác nhận. Hai vế sau mang TÊN RÀNG BUỘC (khuôn `074`,
--     ADR-108): tầng gói bắt chúng và ghi `CONTROL_DENIED` (K12). Chỉ tổ chức đã bật S3 xác minh được — hạn hiệu lực đọc từ
--     phiên bản chính sách có bậc; tổ chức chưa bật chạy nguyên MVP1 (ADR-080).
-- (5) `ncc_xac_minh_con_hieu_luc(org, ncc)` — hàng mới nhất là `VERIFIED`, chưa hết hạn, và băm lúc xác minh bằng băm HIỆN
--     TẠI. Không SECURITY DEFINER: chạy dưới quyền người gọi, RLS áp.
--
-- Mọi hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) MÃ QUYỀN
-- ============================================================================================
INSERT INTO permissions (code, description) VALUES
  ('supplier.qualify', 'Xác minh và thẩm định nhà cung cấp — không đứng cùng rfq.invite (ADR-081, ADR-084)');

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('FINANCE', 'supplier.qualify');

-- ============================================================================================
-- (3) BĂM HỒ SƠ — đứng TRƯỚC bảng vì trigger của bảng gọi nó
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.ncc_bam_xac_minh(p_org uuid, p_ncc uuid) RETURNS bytea
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT sha256(convert_to(
    coalesce((SELECT s.legal_name || '|' || coalesce(s.tax_code, '') || '|' || s.status
                FROM public.suppliers s
               WHERE s.org_id = p_org AND s.id = p_ncc), '')
    || '#' ||
    coalesce((SELECT string_agg(c.id::text || ':' || c.email || ':' || coalesce(c.phone, '') || ':' || c.status, ';'
                                ORDER BY c.id)
                FROM public.supplier_contacts c
               WHERE c.org_id = p_org AND c.supplier_id = p_ncc), ''),
    'UTF8'))
$ham$;

-- ============================================================================================
-- (2) BẢNG
-- ============================================================================================
CREATE TABLE supplier_verifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  supplier_id           uuid NOT NULL,
  loai                  text NOT NULL CHECK (loai IN ('VERIFIED', 'REVOKED')),
  -- Lý do bắt buộc ở `REVOKED`, cấm ở `VERIFIED`. Trần 2000 byte như lý do trả gói về soạn thảo.
  ly_do                 text CHECK (ly_do IS NULL OR (octet_length(btrim(ly_do)) > 0 AND octet_length(ly_do) <= 2000)),
  -- Ba cột do trigger đặt, ngoài `GRANT`: thứ tự dưới khoá, băm hồ sơ và hạn hiệu lực lúc xác minh.
  thu_tu                bigint NOT NULL,
  bam_ho_so             bytea,
  het_han_at            timestamptz,
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, supplier_id) REFERENCES suppliers (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  CONSTRAINT supplier_verifications_ly_do_theo_loai CHECK ((loai = 'REVOKED') = (ly_do IS NOT NULL)),
  CONSTRAINT supplier_verifications_xac_minh_du_cot
    CHECK (loai = 'REVOKED' OR (bam_ho_so IS NOT NULL AND het_han_at IS NOT NULL)),
  -- org_id đứng đầu (ADR-013); chỉ mục này cũng phục vụ câu hỏi *hàng mới nhất của nhà cung cấp X*.
  UNIQUE (org_id, supplier_id, thu_tu)
);

ALTER TABLE supplier_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_verifications FORCE ROW LEVEL SECURITY;

CREATE POLICY supplier_verifications_tenant_isolation ON supplier_verifications
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: xác minh là việc nội bộ bên mua.
CREATE POLICY supplier_verifications_khach ON supplier_verifications AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `thu_tu`, `bam_ho_so`, `het_han_at`, `created_at` do CSDL đặt. KHÔNG `UPDATE`, KHÔNG `DELETE`: chỉ ghi thêm.
-- `app_unseal` không đụng bảng này.
GRANT SELECT ON supplier_verifications TO app_api;
GRANT INSERT (org_id, supplier_id, loai, ly_do, created_by, created_by_session_id) ON supplier_verifications TO app_api;

-- [ADR-016] Người xác minh là DẪN XUẤT từ phiên.
CREATE TRIGGER supplier_verifications_kiem_danh_tinh
  BEFORE INSERT ON supplier_verifications
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE supplier_verifications ENABLE ALWAYS TRIGGER supplier_verifications_kiem_danh_tinh;

-- Chỉ ghi thêm bằng HAI lớp, khuôn `061`: không quyền UPDATE/DELETE, và trigger chặn cả vai sở hữu.
CREATE TRIGGER supplier_verifications_chi_ghi_them
  BEFORE UPDATE OR DELETE ON supplier_verifications
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE supplier_verifications ENABLE ALWAYS TRIGGER supplier_verifications_chi_ghi_them;

CREATE TRIGGER supplier_verifications_chan_truncate
  BEFORE TRUNCATE ON supplier_verifications
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE supplier_verifications ENABLE ALWAYS TRIGGER supplier_verifications_chan_truncate;

-- ============================================================================================
-- (4) LUẬT NGƯỜI, THỨ TỰ, BĂM, HẠN — một trigger, tên xếp SAU `_kiem_danh_tinh` nên `created_by` đã là người của phiên
-- ============================================================================================
-- Khoá tư vấn theo NHÀ CUNG CẤP, hạt giống 7 — cùng khuôn `chinh_sach_kiem_nguoi_ky` (`069`, hạt giống 2). Hai lần ghi
-- cùng nhà cung cấp xếp hàng; `thu_tu` = lớn nhất + 1 đọc SAU khi giữ khoá, nên thứ tự cấp số là thứ tự commit.
CREATE OR REPLACE FUNCTION public.ncc_kiem_xac_minh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao_ncc uuid;
  mst text;
  trang_thai text;
  loai_cuoi text;
  thang integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.supplier_id::pg_catalog.text, 7));
  SELECT s.created_by, s.tax_code, s.status INTO nguoi_tao_ncc, mst, trang_thai
    FROM public.suppliers s
   WHERE s.org_id = NEW.org_id AND s.id = NEW.supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay nha cung cap de xac minh (K8a)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Chi to chuc da bat S3 moi xac minh nha cung cap (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                    AND rp.permission_code = 'supplier.qualify') THEN
    RAISE EXCEPTION 'Nguoi xac minh phai giu supplier.qualify (K8a)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1
               FROM public.user_roles ur
               JOIN public.role_permissions rp ON rp.role_code = ur.role_code
              WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                AND rp.permission_code = 'rfq.invite') THEN
    RAISE EXCEPTION 'Nguoi giu rfq.invite khong xac minh nha cung cap (K8a)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k8a_nguoi_moi_xac_minh';
  END IF;
  IF nguoi_tao_ncc = NEW.created_by
     OR EXISTS (SELECT 1 FROM public.supplier_contacts c
                 WHERE c.org_id = NEW.org_id AND c.supplier_id = NEW.supplier_id
                   AND c.created_by = NEW.created_by) THEN
    RAISE EXCEPTION 'Nguoi tao ho so nha cung cap hay nguoi lien he khong tu xac minh (K8a)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k8a_nguoi_tao_tu_xac_minh';
  END IF;

  SELECT v.loai INTO loai_cuoi
    FROM public.supplier_verifications v
   WHERE v.org_id = NEW.org_id AND v.supplier_id = NEW.supplier_id
   ORDER BY v.thu_tu DESC
   LIMIT 1;
  NEW.thu_tu := coalesce((SELECT max(v.thu_tu) FROM public.supplier_verifications v
                           WHERE v.org_id = NEW.org_id AND v.supplier_id = NEW.supplier_id), 0) + 1;

  IF NEW.loai = 'REVOKED' THEN
    IF loai_cuoi IS DISTINCT FROM 'VERIFIED' THEN
      RAISE EXCEPTION 'Nha cung cap chua duoc xac minh — khong co gi de thu hoi (K8a)'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.bam_ho_so := NULL;
    NEW.het_han_at := NULL;
    RETURN NEW;
  END IF;

  IF mst IS NULL THEN
    RAISE EXCEPTION 'Nha cung cap chua co MST — xac minh la xac nhan MST (K8a)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF trang_thai <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Chi xac minh nha cung cap dang ACTIVE (K8a)'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT p.tham_dinh_hieu_luc_thang INTO thang
    FROM public.org_procurement_policies p
   WHERE p.org_id = NEW.org_id AND p.id = public.chinh_sach_hieu_luc(NEW.org_id, now());
  IF thang IS NULL THEN
    RAISE EXCEPTION 'Phien ban chinh sach hieu luc khong co han hieu luc tham dinh (K8a)'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.bam_ho_so := public.ncc_bam_xac_minh(NEW.org_id, NEW.supplier_id);
  NEW.het_han_at := now() + pg_catalog.make_interval(months => thang);
  RETURN NEW;
END
$ham$;

CREATE TRIGGER supplier_verifications_kiem_xac_minh
  BEFORE INSERT ON supplier_verifications
  FOR EACH ROW EXECUTE FUNCTION public.ncc_kiem_xac_minh();
ALTER TABLE supplier_verifications ENABLE ALWAYS TRIGGER supplier_verifications_kiem_xac_minh;

-- ============================================================================================
-- (5) CÂU HỎI DUY NHẤT: NHÀ CUNG CẤP NÀY CÓ XÁC MINH CÒN HIỆU LỰC KHÔNG
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.ncc_xac_minh_con_hieu_luc(p_org uuid, p_ncc uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT coalesce((
    SELECT v.loai = 'VERIFIED'
           AND v.het_han_at > now()
           AND v.bam_ho_so = public.ncc_bam_xac_minh(p_org, p_ncc)
      FROM public.supplier_verifications v
     WHERE v.org_id = p_org AND v.supplier_id = p_ncc
     ORDER BY v.thu_tu DESC
     LIMIT 1), false)
$ham$;

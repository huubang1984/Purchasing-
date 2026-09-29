-- ==============================================================================================
-- 9501_nhom_hang — [S1.9101 / S3.6a của spec S3] NHÓM HÀNG: DANH SÁCH CỦA TỔ CHỨC, BẮT BUỘC ĐỂ GÓI RỜI DRAFT Ở TỔ
-- CHỨC ĐÃ BẬT, KHOÁ SAU DRAFT
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.3, §4.6, §9 (S3.6). ADR-080 (công tắc),
-- ADR-084 ⑵ ⑶ ⑷ (`category.manage` cho `FINANCE`; mã vào CSDL ở đúng hạng mục dựng hành vi; `CONTROL_DENIED`). Chủ dự án
-- chốt ngày 2026-09-29: S3.6 chia bốn PR, S3.6a là nhóm hàng; nhóm hàng bắt buộc để rời DRAFT ở tổ chức đã bật ngay S3.6a;
-- lần từ chối `THIEU_NHOM_HANG` vào sổ; nhóm hàng chỉ tạo, ngừng dùng và dùng lại — mã và tên không sửa.
--
-- Nhóm hàng là KHOÁ của tín hiệu chia nhỏ (`PURCHASE_SPLITTING`, S3.6b): tín hiệu gộp các gói cùng nhóm hàng trong cửa sổ.
-- Không có nhóm hàng thì tín hiệu phải gộp MỌI gói, và một người mua nhiều thứ khác nhau sẽ báo động giả liên tục (§4.3).
-- Đây KHÔNG phải item master: ánh xạ hạng mục sang hàng chuẩn là S4.
--
-- (1) MÃ QUYỀN `category.manage` CHO `FINANCE` (ADR-084 ⑵): một vai tạo gói mà chỉnh được nhóm hàng thì chỉnh được chính
--     tín hiệu soi mình. `FINANCE` giữ `policy.manage`, và `033` cấm một NGƯỜI giữ `policy.manage` cùng `rfq.create` — nên
--     người quản lý nhóm hàng không tạo được gói. Test ghim rằng mọi vai giữ `category.manage` đều giữ `policy.manage`.
-- (2) HAI BẢNG CHỈ GHI THÊM. `procurement_categories` — mã và tên, không sửa, không xoá. `procurement_category_changes` —
--     mỗi lần ngừng dùng hay dùng lại là một hàng, và trạng thái là hàng có `thu_tu` LỚN NHẤT (khuôn `supplier_verifications`
--     của S3.3a). Không cột nào sửa tại chỗ, nên không cột *người đổi* nào còn mang người của lần đổi trước.
-- (3) LUẬT NGƯỜI Ở TRIGGER, đọc dữ liệu thật (khuôn ADR-051): người tạo nhóm hàng và người đổi trạng thái giữ
--     `category.manage`. Route hỏi quyền trước (lần từ chối vào sổ `PERMISSION_DENIED`); trigger là lớp chặn cuối cho câu
--     viết tay. Lần đổi trạng thái đi đúng chiều: chỉ ngừng dùng nhóm đang dùng, chỉ dùng lại nhóm đã ngừng — hai nhánh mang
--     TÊN RÀNG BUỘC để tầng gói nói được câu của người dùng.
-- (4) `nhom_hang_con_dung(org, nhóm)` — câu hỏi DUY NHẤT về trạng thái. Nhóm chưa có hàng đổi nào là đang dùng.
-- (5) `rfq_packages.category_id` — NULL cho gói cũ, khoá ngoại theo (tổ chức, nhóm). Trigger RIÊNG (spec §4.3 [S1.139]: khối
--     *"chỉ sửa ở DRAFT"* của thân ghim `061` chỉ phủ `title` và `requires_dual_approval`): cột chỉ đổi ở DRAFT, và chỉ gán
--     được nhóm CÒN DÙNG — dưới khoá tư vấn CHIA SẺ theo nhóm, cùng khoá mà lần đổi trạng thái giữ ĐỘC QUYỀN, nên một lần
--     gán và một lần ngừng dùng chen nhau thì xếp hàng thay vì cùng đi qua.
-- (6) CHỐT `rfq_chot_nhom_hang(org, nhóm)` ở cạnh `DRAFT→PENDING_APPROVAL`: ở tổ chức đã bật, gói không nhóm hàng không rời
--     DRAFT (`THIEU_NHOM_HANG`). Hàm nhận GIÁ TRỊ của cột, không đọc hàng: trigger BEFORE thấy hàng CŨ trong bảng, nên một câu
--     viết tay vừa nộp duyệt vừa xoá nhóm hàng sẽ đi lọt một hàm đọc bảng. Tầng gói hỏi cùng hàm trên hàng DRAFT, TRƯỚC câu
--     ghi, và từ chối theo `CHOT_VAO_SO`; trigger là lớp chặn cuối — khuôn K1 (`072`).
--     Spec viết *"bắt buộc khi chính sách có `chia_nho_cua_so_ngay`"*. Hàm hỏi `to_chuc_da_bat_s3` thay vì hỏi cột ấy:
--     `069` bắt mọi phiên bản CÓ BẬC khai cửa sổ, nên ở tổ chức đã bật hai câu hỏi trùng nhau; nhưng `069` cũng cho một
--     phiên bản KHÔNG bậc khai cửa sổ, và hỏi cột thì tổ chức chưa bật ấy đổi hành vi trong im lặng — đúng rủi ro §8.11.
--
-- Mọi hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) MÃ QUYỀN
-- ============================================================================================
INSERT INTO permissions (code, description) VALUES
  ('category.manage', 'Quản lý danh sách nhóm hàng — khoá của tín hiệu chia nhỏ; không đứng cùng rfq.create (ADR-084)');

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('FINANCE', 'category.manage');

-- ============================================================================================
-- (2) HAI BẢNG
-- ============================================================================================
CREATE TABLE procurement_categories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  -- Mã là một định danh, không phải tên: chữ HOA, số và `_ . -`, tối đa 32. Tầng gói viết hoa trước khi chèn.
  ma                    text NOT NULL CHECK (ma ~ '^[A-Z0-9][A-Z0-9_.-]{0,31}$'),
  ten                   text NOT NULL CHECK (ten = btrim(ten) AND octet_length(ten) > 0 AND octet_length(ten) <= 200),
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  -- Đích của khoá ngoại theo (tổ chức, nhóm) từ `rfq_packages` và từ bảng đổi trạng thái (ADR-013).
  UNIQUE (org_id, id),
  UNIQUE (org_id, ma)
);

ALTER TABLE procurement_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_categories_tenant_isolation ON procurement_categories
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: nhóm hàng là việc nội bộ bên mua.
CREATE POLICY procurement_categories_khach ON procurement_categories AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- KHÔNG `UPDATE`, KHÔNG `DELETE`: chỉ ghi thêm. `app_unseal` không đụng bảng này.
GRANT SELECT ON procurement_categories TO app_api;
GRANT INSERT (org_id, ma, ten, created_by, created_by_session_id) ON procurement_categories TO app_api;

-- [ADR-016] Người tạo là DẪN XUẤT từ phiên.
CREATE TRIGGER procurement_categories_kiem_danh_tinh
  BEFORE INSERT ON procurement_categories
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE procurement_categories ENABLE ALWAYS TRIGGER procurement_categories_kiem_danh_tinh;

-- Chỉ ghi thêm bằng HAI lớp, khuôn `061`: không quyền UPDATE/DELETE, và trigger chặn cả vai sở hữu.
CREATE TRIGGER procurement_categories_chi_ghi_them
  BEFORE UPDATE OR DELETE ON procurement_categories
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE procurement_categories ENABLE ALWAYS TRIGGER procurement_categories_chi_ghi_them;

CREATE TRIGGER procurement_categories_chan_truncate
  BEFORE TRUNCATE ON procurement_categories
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE procurement_categories ENABLE ALWAYS TRIGGER procurement_categories_chan_truncate;

CREATE TABLE procurement_category_changes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  category_id           uuid NOT NULL,
  loai                  text NOT NULL CHECK (loai IN ('RETIRED', 'REACTIVATED')),
  -- Do trigger đặt DƯỚI KHOÁ TƯ VẤN theo nhóm, ngoài `GRANT`: thứ tự cấp số là thứ tự commit.
  thu_tu                bigint NOT NULL,
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, category_id) REFERENCES procurement_categories (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  -- org_id đứng đầu (ADR-013); chỉ mục này cũng phục vụ câu hỏi *hàng mới nhất của nhóm X*.
  UNIQUE (org_id, category_id, thu_tu)
);

ALTER TABLE procurement_category_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_category_changes FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_category_changes_tenant_isolation ON procurement_category_changes
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Như bảng trên.
CREATE POLICY procurement_category_changes_khach ON procurement_category_changes AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON procurement_category_changes TO app_api;
GRANT INSERT (org_id, category_id, loai, created_by, created_by_session_id) ON procurement_category_changes TO app_api;

CREATE TRIGGER procurement_category_changes_kiem_danh_tinh
  BEFORE INSERT ON procurement_category_changes
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE procurement_category_changes ENABLE ALWAYS TRIGGER procurement_category_changes_kiem_danh_tinh;

CREATE TRIGGER procurement_category_changes_chi_ghi_them
  BEFORE UPDATE OR DELETE ON procurement_category_changes
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE procurement_category_changes ENABLE ALWAYS TRIGGER procurement_category_changes_chi_ghi_them;

CREATE TRIGGER procurement_category_changes_chan_truncate
  BEFORE TRUNCATE ON procurement_category_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE procurement_category_changes ENABLE ALWAYS TRIGGER procurement_category_changes_chan_truncate;

-- ============================================================================================
-- (3) LUẬT NGƯỜI VÀ CHIỀU ĐỔI — tên trigger xếp SAU `_kiem_danh_tinh`, nên `created_by` đã là người của phiên
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.nhom_hang_kiem_nguoi_tao() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                    AND rp.permission_code = 'category.manage') THEN
    RAISE EXCEPTION 'Nguoi tao nhom hang phai giu category.manage (ADR-084)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER procurement_categories_kiem_nguoi
  BEFORE INSERT ON procurement_categories
  FOR EACH ROW EXECUTE FUNCTION public.nhom_hang_kiem_nguoi_tao();
ALTER TABLE procurement_categories ENABLE ALWAYS TRIGGER procurement_categories_kiem_nguoi;

-- Khoá tư vấn theo NHÓM HÀNG, hạt giống 8, ĐỘC QUYỀN — trigger gán nhóm cho gói (mục (5)) giữ cùng khoá ở chế độ CHIA SẺ.
-- `thu_tu` = lớn nhất + 1 đọc SAU khi giữ khoá, nên thứ tự cấp số là thứ tự commit.
CREATE OR REPLACE FUNCTION public.nhom_hang_kiem_doi() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  loai_cuoi text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.category_id::pg_catalog.text, 8));
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                    AND rp.permission_code = 'category.manage') THEN
    RAISE EXCEPTION 'Nguoi doi trang thai nhom hang phai giu category.manage (ADR-084)'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT c.loai INTO loai_cuoi
    FROM public.procurement_category_changes c
   WHERE c.org_id = NEW.org_id AND c.category_id = NEW.category_id
   ORDER BY c.thu_tu DESC
   LIMIT 1;
  IF NEW.loai = 'RETIRED' AND loai_cuoi IS NOT DISTINCT FROM 'RETIRED' THEN
    RAISE EXCEPTION 'Nhom hang da ngung dung roi'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'nhom_hang_ngung_dung_hai_lan';
  END IF;
  IF NEW.loai = 'REACTIVATED' AND loai_cuoi IS DISTINCT FROM 'RETIRED' THEN
    RAISE EXCEPTION 'Nhom hang dang dung — khong co gi de dung lai'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'nhom_hang_dung_lai_khi_dang_dung';
  END IF;
  NEW.thu_tu := coalesce((SELECT max(c.thu_tu) FROM public.procurement_category_changes c
                           WHERE c.org_id = NEW.org_id AND c.category_id = NEW.category_id), 0) + 1;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER procurement_category_changes_kiem_doi
  BEFORE INSERT ON procurement_category_changes
  FOR EACH ROW EXECUTE FUNCTION public.nhom_hang_kiem_doi();
ALTER TABLE procurement_category_changes ENABLE ALWAYS TRIGGER procurement_category_changes_kiem_doi;

-- ============================================================================================
-- (4) CÂU HỎI DUY NHẤT: NHÓM HÀNG NÀY CÒN DÙNG KHÔNG
-- ============================================================================================
-- Không SECURITY DEFINER: chạy dưới quyền người gọi, RLS áp — một nhóm của tổ chức khác không có hàng đổi nào để đọc,
-- và khoá ngoại theo (tổ chức, nhóm) của `rfq_packages` đã chặn gán nó.
CREATE OR REPLACE FUNCTION public.nhom_hang_con_dung(p_org uuid, p_nhom uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT coalesce((
    SELECT c.loai <> 'RETIRED'
      FROM public.procurement_category_changes c
     WHERE c.org_id = p_org AND c.category_id = p_nhom
     ORDER BY c.thu_tu DESC
     LIMIT 1), true)
$ham$;

-- ============================================================================================
-- (5) NHÓM HÀNG CỦA GÓI
-- ============================================================================================
ALTER TABLE rfq_packages ADD COLUMN category_id uuid;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_packages_category_fkey
  FOREIGN KEY (org_id, category_id) REFERENCES procurement_categories (org_id, id);
-- Quyền theo CỘT là cộng dồn — thêm vào tập `INSERT`/`UPDATE` của `009`, `011`. Chỉ sửa ở DRAFT là việc của trigger dưới.
GRANT INSERT (category_id), UPDATE (category_id) ON rfq_packages TO app_api;

CREATE OR REPLACE FUNCTION public.rfq_kiem_nhom_hang() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
      RETURN NEW;
    END IF;
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Nhom hang cua goi thau chi doi duoc o DRAFT (S3.6a)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'nhom_hang_chi_doi_o_draft';
    END IF;
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(
              pg_catalog.hashtextextended(NEW.category_id::pg_catalog.text, 8));
    IF NOT public.nhom_hang_con_dung(NEW.org_id, NEW.category_id) THEN
      RAISE EXCEPTION 'Nhom hang da ngung dung — chon nhom khac (S3.6a)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'nhom_hang_da_ngung_dung';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_nhom_hang
  BEFORE INSERT OR UPDATE OF category_id ON rfq_packages
  FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_nhom_hang();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_nhom_hang;

-- ============================================================================================
-- (6) CHỐT NHÓM HÀNG Ở CẠNH DRAFT→PENDING_APPROVAL
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO` (`packages/identity/src/chot-kiem-soat.ts`); một mã mới ở đây mà không có dòng ở
-- đó thì tầng gói ném một lỗi không tên thay vì một lời từ chối có tên.
CREATE OR REPLACE FUNCTION public.rfq_chot_nhom_hang(p_org uuid, p_nhom uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF p_nhom IS NULL AND public.to_chuc_da_bat_s3(p_org) THEN
    RETURN 'THIEU_NHOM_HANG';
  END IF;
  RETURN NULL;
END
$ham$;

-- KHÔNG lấy khoá tư vấn theo tổ chức như trigger K1 (`072`). Câu trả lời chỉ đổi theo `to_chuc_da_bat_s3` khi gói không có
-- nhóm hàng, và trạng thái ấy chỉ đổi một chiều — ở lần ký bật tổ chức, lần ký cũng đổi phiên bản hiệu lực. Nên gói soạn trước
-- lần bật bị K1 chặn trước (`THIEU_NGAN_SACH` hay `NGAN_SACH_GHIM_BAN_CU`): trigger K1 xếp trước trigger này theo tên, và khi
-- trigger này đọc thì giao dịch đã giữ khoá ấy. Một khoá thứ hai ở đây không chặn thêm lối nào, còn che phép đo khoá của K1 —
-- gỡ khoá K1 mà lần nộp vẫn đứng chờ ở đây (`bac-chinh-sach.int`, ca ĐUA).
CREATE OR REPLACE FUNCTION public.rfq_kiem_nhom_hang_khi_nop() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  ly_do := public.rfq_chot_nhom_hang(NEW.org_id, NEW.category_id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Goi thau chua roi DRAFT duoc (S3.6a): %', ly_do
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_nhom_hang_khi_nop
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL')
  EXECUTE FUNCTION public.rfq_kiem_nhom_hang_khi_nop();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nhom_hang_khi_nop;

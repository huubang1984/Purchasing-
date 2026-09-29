-- =============================================================================================
-- 081 — [S1.195 / S4.2a] HÀNG CHUẨN, VAI QUẢN LÝ DỮ LIỆU MÙ GIÁ, QUY ĐỔI RIÊNG (spec S4 §4.2, §4.3, §5.1 L1 · L3 · L4)
-- =============================================================================================
-- Năm thứ, theo đúng thứ tự tệp:
--
--   (1) Mã `item.manage` và vai `DATA_STEWARD` (spec §2.4 ⑺, ADR-084 ⑶ — mã vào CSDL ở hạng mục dựng hành
--       vi của nó). Hai trigger khuôn `033`: `item.manage` KHÔNG đứng cùng `bid.view`, `po.approve`,
--       `award.recommend`, `rfq.create`, `rfq.invite` — ở MỘT VAI (`role_permissions`) và ở MỘT NGƯỜI (hợp các
--       vai trong `user_roles`). Người đặt thước dữ liệu không thấy giá, không tạo gói, không mời, không đề
--       xuất, không duyệt trao. Danh sách có bản TypeScript `ITEM_MANAGE_EXCLUDES` mà `ma-tran-quyen.test.ts`
--       khoá khớp nguyên văn với hai thân dưới đây (khuôn §R3 của `033`). Cùng khe hở `005` §(3) đã ghi: sửa
--       `role_permissions` sau khi người đã mang vai thì không trigger nào thấy trục người.
--   (2) Cổng GHI của dữ liệu nền ở CSDL: `du_lieu_nen_kiem_quyen_ghi` — người ghi (`tac_gia`, đã được
--       `kiem_danh_tinh_theo_phien` buộc bằng người của phiên) phải giữ `item.manage` trong tổ chức của hàng.
--       Áp cho `uom_aliases` của `079` và bốn bảng mới. Cổng ở tầng ứng dụng (ADR-016) đến ở S4.2b cùng route;
--       cổng này đứng dưới nó, nên một câu SQL viết tay dưới `app_api` cũng không lọt.
--   (3) Bốn bảng hàng chuẩn, mọi bảng mang khuôn nền L1 của `079` (`du_lieu_nen_dat_thu_tu`, chỉ-ghi-thêm kể cả
--       `TRUNCATE`, tác giả dẫn xuất từ phiên, `id`/`seq`/`ghi_luc` ngoài GRANT):
--         `canonical_items`          — DANH TÍNH bất biến: `ma`, `don_vi_goc` (mã của `uom_units`, không đơn vị
--                                       đóng gói). Đổi đơn vị gốc là tạo hàng chuẩn mới (spec §4.3).
--         `canonical_item_versions`  — mỗi lần sửa một phiên bản: tên, thuộc tính, thuộc tính trọng yếu, trạng
--                                       thái. `category_id` CHƯA có: đợi nhóm hàng của S3.6 (ADR-084 ⑶).
--         `item_aliases`             — chuỗi đã làm sạch → hàng chuẩn; hàng rút không mang hàng chuẩn. Hàng mới
--                                       nhất theo `seq` của một chuỗi thắng — khuôn `uom_aliases`.
--         `item_uom_conversions`     — quy đổi RIÊNG của một hàng chuẩn: `1 tu_don_vi = he_so sang_don_vi`.
--                                       `sang_don_vi` là mã của danh mục; `tu_don_vi` là mã (khác thứ nguyên)
--                                       hoặc chuỗi đóng gói đã làm sạch (`cay`, `cuon`).
--   (4) `quy_doi_don_vi` thêm vế ⑵ của L4 — luật ghép ở ADR-115: ⑴ cùng thứ nguyên vẫn đi trước; ⑵ đúng MỘT
--       cạnh riêng còn hiệu lực TẠI MỐC của đúng hàng chuẩn, ghép với quy đổi chung cùng thứ nguyên ở hai đầu,
--       dùng được cả chiều ngược (1/hệ số); không ghép hai cạnh riêng; nhiều hơn một cạnh dùng được ⇒ mơ hồ
--       ⇒ `KHONG_QUY_DOI_DUOC`. Mã mới `QUY_DOI_RIENG`.
--
-- Khoá tư vấn: khuôn `079` hạt giống `3` theo (bảng, tổ chức) — bốn bảng mới không chờ nhau.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- (1) MÃ QUYỀN, VAI, VÀ HAI TRIGGER KHUÔN 033
-- ---------------------------------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
  ('item.manage', 'Quản lý dữ liệu nền — hàng chuẩn, bí danh, quy đổi; người giữ không thấy giá');

INSERT INTO roles (code, name) VALUES
  ('DATA_STEWARD', 'Quản lý dữ liệu');

CREATE OR REPLACE FUNCTION public.kiem_tra_quan_ly_du_lieu_mu_gia_vai_tro() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $tqv$
DECLARE
  co_thuoc boolean;
  co_bi_do bigint;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_code = NEW.role_code
                    AND rp.permission_code = 'item.manage')
    INTO co_thuoc;
  IF NOT co_thuoc THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO co_bi_do
    FROM unnest(ARRAY['bid.view', 'po.approve', 'award.recommend', 'rfq.create', 'rfq.invite']) AS loai_tru(ma)
   WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_code = NEW.role_code
                    AND rp.permission_code = loai_tru.ma);

  IF co_bi_do > 0 THEN
    RAISE EXCEPTION 'Nguoi dat thuoc du lieu khong duoc thay gia hay cam thu bi do (L3, S4.2): vai tro % giu item.manage cung bid.view/po.approve/award.recommend/rfq.create/rfq.invite', NEW.role_code
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END
$tqv$;

CREATE TRIGGER role_permissions_quan_ly_du_lieu_mu_gia
  AFTER INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_quan_ly_du_lieu_mu_gia_vai_tro();
ALTER TABLE role_permissions ENABLE ALWAYS TRIGGER role_permissions_quan_ly_du_lieu_mu_gia;

CREATE OR REPLACE FUNCTION public.kiem_tra_quan_ly_du_lieu_mu_gia_nguoi_dung() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $tqn$
DECLARE
  co_thuoc boolean;
  co_bi_do bigint;
BEGIN
  SELECT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id
                    AND ur.user_id = NEW.user_id
                    AND rp.permission_code = 'item.manage')
    INTO co_thuoc;
  IF NOT co_thuoc THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO co_bi_do
    FROM unnest(ARRAY['bid.view', 'po.approve', 'award.recommend', 'rfq.create', 'rfq.invite']) AS loai_tru(ma)
   WHERE EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id
                    AND ur.user_id = NEW.user_id
                    AND rp.permission_code = loai_tru.ma);

  IF co_bi_do > 0 THEN
    RAISE EXCEPTION 'Nguoi dat thuoc du lieu khong duoc thay gia hay cam thu bi do (L3, S4.2): nguoi dung % se giu item.manage cung bid.view/po.approve/award.recommend/rfq.create/rfq.invite', NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END
$tqn$;

CREATE TRIGGER user_roles_quan_ly_du_lieu_mu_gia
  AFTER INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_quan_ly_du_lieu_mu_gia_nguoi_dung();
ALTER TABLE user_roles ENABLE ALWAYS TRIGGER user_roles_quan_ly_du_lieu_mu_gia;

-- Trigger tạo TRƯỚC câu ghi: chính câu seed đi qua phép kiểm (khuôn `033`).
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('DATA_STEWARD', 'item.manage');

-- ---------------------------------------------------------------------------------------------
-- (2) CỔNG GHI CỦA DỮ LIỆU NỀN
-- ---------------------------------------------------------------------------------------------
-- Đọc `user_roles` dưới RLS của phiên ghi: phiên đang gắn đúng tổ chức của hàng mới (WITH CHECK của
-- bảng ép), nên thấy đủ — cùng lập luận hàm mức người của `033`. Tên ràng buộc để tầng gói đọc được
-- lần từ chối mà không so thông báo.
CREATE OR REPLACE FUNCTION public.du_lieu_nen_kiem_quyen_ghi() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id
                    AND ur.user_id = NEW.tac_gia
                    AND rp.permission_code = 'item.manage') THEN
    RAISE EXCEPTION 'Du lieu nen chi do nguoi giu item.manage ghi (L3): nguoi dung % khong giu item.manage', NEW.tac_gia
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'du_lieu_nen_can_item_manage';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER uom_aliases_kiem_quyen_ghi
  BEFORE INSERT ON uom_aliases
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_kiem_quyen_ghi();
ALTER TABLE uom_aliases ENABLE ALWAYS TRIGGER uom_aliases_kiem_quyen_ghi;

-- ---------------------------------------------------------------------------------------------
-- (3) BỐN BẢNG HÀNG CHUẨN
-- ---------------------------------------------------------------------------------------------
-- `ma` viết hoa: *"d10"* và *"D10"* là một mã, nên CSDL chỉ nhận một dạng. `UNIQUE (org_id, id)` là đích của
-- ba khoá ngoại hợp thành bên dưới — một phiên bản, bí danh hay quy đổi không trỏ sang hàng chuẩn của tổ chức
-- khác được, kể cả khi RLS bị tắt.
CREATE TABLE canonical_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id),
  ma          text NOT NULL CONSTRAINT canonical_items_ma_hinh_dang CHECK (ma ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  don_vi_goc  text NOT NULL REFERENCES uom_units (code),
  tac_gia     uuid NOT NULL,
  session_id  uuid NOT NULL,
  seq         bigint NOT NULL,
  ghi_luc     timestamptz NOT NULL,
  UNIQUE (org_id, ma),
  UNIQUE (org_id, id),
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

-- Thuộc tính là một đối tượng phẳng khoá → chuỗi (nhà sản xuất, vật liệu, mác, kích thước, tiêu chuẩn —
-- V2.1 §14): khoá viết thường, giá trị là chuỗi không rỗng. Thuộc tính trọng yếu phải là khoá có mặt —
-- một khoá trọng yếu mà hàng chuẩn không khai giá trị thì bộ chuẩn hoá (S4.3) không có gì để so.
CREATE TABLE canonical_item_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations (id),
  canonical_item_id     uuid NOT NULL,
  ten                   text NOT NULL
                        CONSTRAINT canonical_item_versions_ten_hinh_dang
                        CHECK (ten = btrim(ten) AND length(ten) BETWEEN 1 AND 300),
  thuoc_tinh            jsonb NOT NULL DEFAULT '{}'::jsonb
                        CONSTRAINT canonical_item_versions_thuoc_tinh_hinh_dang
                        CHECK (jsonb_typeof(thuoc_tinh) = 'object'
                               AND NOT jsonb_path_exists(thuoc_tinh, '$.* ? (@.type() != "string" || @ == "")')
                               AND NOT jsonb_path_exists(thuoc_tinh, '$.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{0,39}$"))')),
  thuoc_tinh_trong_yeu  text[] NOT NULL DEFAULT '{}'
                        CONSTRAINT canonical_item_versions_trong_yeu_co_gia_tri
                        CHECK (thuoc_tinh ?& thuoc_tinh_trong_yeu),
  trang_thai            text NOT NULL DEFAULT 'DANG_DUNG'
                        CONSTRAINT canonical_item_versions_trang_thai_mien
                        CHECK (trang_thai IN ('DANG_DUNG', 'NGUNG_DUNG')),
  tac_gia               uuid NOT NULL,
  session_id            uuid NOT NULL,
  seq                   bigint NOT NULL,
  ghi_luc               timestamptz NOT NULL,
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

CREATE TABLE item_aliases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations (id),
  bi_danh_sach       text NOT NULL
                     CONSTRAINT item_aliases_bi_danh_sach_da_lam_sach
                     CHECK (bi_danh_sach <> '' AND bi_danh_sach = public.chuoi_sach(bi_danh_sach)),
  canonical_item_id  uuid,
  rut                boolean NOT NULL DEFAULT false,
  tac_gia            uuid NOT NULL,
  session_id         uuid NOT NULL,
  seq                bigint NOT NULL,
  ghi_luc            timestamptz NOT NULL,
  CONSTRAINT item_aliases_rut_khong_hang
    CHECK ((rut AND canonical_item_id IS NULL) OR (NOT rut AND canonical_item_id IS NOT NULL)),
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

CREATE TABLE item_uom_conversions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations (id),
  canonical_item_id  uuid NOT NULL,
  tu_don_vi          text NOT NULL
                     CONSTRAINT item_uom_conversions_tu_don_vi_da_lam_sach
                     CHECK (tu_don_vi <> '' AND tu_don_vi = public.chuoi_sach(tu_don_vi)),
  sang_don_vi        text NOT NULL REFERENCES uom_units (code),
  he_so              numeric,
  rut                boolean NOT NULL DEFAULT false,
  tac_gia            uuid NOT NULL,
  session_id         uuid NOT NULL,
  seq                bigint NOT NULL,
  ghi_luc            timestamptz NOT NULL,
  CONSTRAINT item_uom_conversions_rut_khong_he_so
    CHECK ((rut AND he_so IS NULL) OR (NOT rut AND he_so IS NOT NULL AND he_so > 0)),
  CONSTRAINT item_uom_conversions_hai_dau_khac CHECK (tu_don_vi <> sang_don_vi),
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

ALTER TABLE canonical_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_items FORCE ROW LEVEL SECURITY;
ALTER TABLE canonical_item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_item_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE item_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_aliases FORCE ROW LEVEL SECURITY;
ALTER TABLE item_uom_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_uom_conversions FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_items_tenant_isolation ON canonical_items
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY canonical_item_versions_tenant_isolation ON canonical_item_versions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY item_aliases_tenant_isolation ON item_aliases
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY item_uom_conversions_tenant_isolation ON item_uom_conversions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Policy khách ĐÓNG HẲN — không phiên khách nào đọc dữ liệu nền.
CREATE POLICY canonical_items_khach ON canonical_items AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);
CREATE POLICY canonical_item_versions_khach ON canonical_item_versions AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);
CREATE POLICY item_aliases_khach ON item_aliases AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);
CREATE POLICY item_uom_conversions_khach ON item_uom_conversions AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

REVOKE ALL ON canonical_items, canonical_item_versions, item_aliases, item_uom_conversions FROM PUBLIC;
GRANT SELECT ON canonical_items, canonical_item_versions, item_aliases, item_uom_conversions TO app_api;
GRANT INSERT (org_id, ma, don_vi_goc, tac_gia, session_id) ON canonical_items TO app_api;
GRANT INSERT (org_id, canonical_item_id, ten, thuoc_tinh, thuoc_tinh_trong_yeu, trang_thai, tac_gia, session_id)
  ON canonical_item_versions TO app_api;
GRANT INSERT (org_id, bi_danh_sach, canonical_item_id, rut, tac_gia, session_id) ON item_aliases TO app_api;
GRANT INSERT (org_id, canonical_item_id, tu_don_vi, sang_don_vi, he_so, rut, tac_gia, session_id)
  ON item_uom_conversions TO app_api;

-- Bốn trigger mỗi bảng, đúng khuôn `uom_aliases`: thứ tự, danh tính, cổng ghi, chỉ-ghi-thêm (+ TRUNCATE).
CREATE TRIGGER canonical_items_dat_thu_tu
  BEFORE INSERT ON canonical_items
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE canonical_items ENABLE ALWAYS TRIGGER canonical_items_dat_thu_tu;
CREATE TRIGGER canonical_items_kiem_danh_tinh
  BEFORE INSERT ON canonical_items
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE canonical_items ENABLE ALWAYS TRIGGER canonical_items_kiem_danh_tinh;
CREATE TRIGGER canonical_items_kiem_quyen_ghi
  BEFORE INSERT ON canonical_items
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_kiem_quyen_ghi();
ALTER TABLE canonical_items ENABLE ALWAYS TRIGGER canonical_items_kiem_quyen_ghi;
CREATE TRIGGER canonical_items_chi_ghi_them
  BEFORE UPDATE OR DELETE ON canonical_items
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE canonical_items ENABLE ALWAYS TRIGGER canonical_items_chi_ghi_them;
CREATE TRIGGER canonical_items_chan_truncate
  BEFORE TRUNCATE ON canonical_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE canonical_items ENABLE ALWAYS TRIGGER canonical_items_chan_truncate;

CREATE TRIGGER canonical_item_versions_dat_thu_tu
  BEFORE INSERT ON canonical_item_versions
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE canonical_item_versions ENABLE ALWAYS TRIGGER canonical_item_versions_dat_thu_tu;
CREATE TRIGGER canonical_item_versions_kiem_danh_tinh
  BEFORE INSERT ON canonical_item_versions
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE canonical_item_versions ENABLE ALWAYS TRIGGER canonical_item_versions_kiem_danh_tinh;
CREATE TRIGGER canonical_item_versions_kiem_quyen_ghi
  BEFORE INSERT ON canonical_item_versions
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_kiem_quyen_ghi();
ALTER TABLE canonical_item_versions ENABLE ALWAYS TRIGGER canonical_item_versions_kiem_quyen_ghi;
CREATE TRIGGER canonical_item_versions_chi_ghi_them
  BEFORE UPDATE OR DELETE ON canonical_item_versions
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE canonical_item_versions ENABLE ALWAYS TRIGGER canonical_item_versions_chi_ghi_them;
CREATE TRIGGER canonical_item_versions_chan_truncate
  BEFORE TRUNCATE ON canonical_item_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE canonical_item_versions ENABLE ALWAYS TRIGGER canonical_item_versions_chan_truncate;

CREATE TRIGGER item_aliases_dat_thu_tu
  BEFORE INSERT ON item_aliases
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE item_aliases ENABLE ALWAYS TRIGGER item_aliases_dat_thu_tu;
CREATE TRIGGER item_aliases_kiem_danh_tinh
  BEFORE INSERT ON item_aliases
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE item_aliases ENABLE ALWAYS TRIGGER item_aliases_kiem_danh_tinh;
CREATE TRIGGER item_aliases_kiem_quyen_ghi
  BEFORE INSERT ON item_aliases
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_kiem_quyen_ghi();
ALTER TABLE item_aliases ENABLE ALWAYS TRIGGER item_aliases_kiem_quyen_ghi;
CREATE TRIGGER item_aliases_chi_ghi_them
  BEFORE UPDATE OR DELETE ON item_aliases
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE item_aliases ENABLE ALWAYS TRIGGER item_aliases_chi_ghi_them;
CREATE TRIGGER item_aliases_chan_truncate
  BEFORE TRUNCATE ON item_aliases
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE item_aliases ENABLE ALWAYS TRIGGER item_aliases_chan_truncate;

CREATE TRIGGER item_uom_conversions_dat_thu_tu
  BEFORE INSERT ON item_uom_conversions
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE item_uom_conversions ENABLE ALWAYS TRIGGER item_uom_conversions_dat_thu_tu;
CREATE TRIGGER item_uom_conversions_kiem_danh_tinh
  BEFORE INSERT ON item_uom_conversions
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE item_uom_conversions ENABLE ALWAYS TRIGGER item_uom_conversions_kiem_danh_tinh;
CREATE TRIGGER item_uom_conversions_kiem_quyen_ghi
  BEFORE INSERT ON item_uom_conversions
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_kiem_quyen_ghi();
ALTER TABLE item_uom_conversions ENABLE ALWAYS TRIGGER item_uom_conversions_kiem_quyen_ghi;
CREATE TRIGGER item_uom_conversions_chi_ghi_them
  BEFORE UPDATE OR DELETE ON item_uom_conversions
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE item_uom_conversions ENABLE ALWAYS TRIGGER item_uom_conversions_chi_ghi_them;
CREATE TRIGGER item_uom_conversions_chan_truncate
  BEFORE TRUNCATE ON item_uom_conversions
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE item_uom_conversions ENABLE ALWAYS TRIGGER item_uom_conversions_chan_truncate;

-- ---------------------------------------------------------------------------------------------
-- (4) QUY ĐỔI — THÊM VẾ ⑵ (ADR-115)
-- ---------------------------------------------------------------------------------------------
-- `canh`: cạnh riêng mới nhất theo `seq` của mỗi cặp (tu, sang) trong những hàng ghi TRƯỚC mốc; hàng rút
-- làm cặp ấy hết hiệu lực. `khoa_*`: mã nếu chuỗi quy về một mã của danh mục, không thì chuỗi đã làm sạch —
-- đúng dạng `tu_don_vi` được lưu. Chiều xuôi: `p_tu` khớp đầu `tu` (đúng khoá, hoặc cùng thứ nguyên khi đầu
-- ấy là mã) và `p_sang` cùng thứ nguyên với đầu `sang`. Chiều ngược đối xứng, hệ số nghịch đảo. `p_hang_chuan`
-- NULL thì không cạnh nào, và hàm là đúng bản `079`.
CREATE OR REPLACE FUNCTION public.quy_doi_don_vi(
  p_org uuid, p_hang_chuan uuid, p_tu text, p_sang text, p_moc timestamptz)
  RETURNS TABLE (he_so numeric, ma text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  WITH u AS (
    SELECT d.tu, d.sang,
           coalesce(d.tu, public.chuoi_sach(p_tu)) AS khoa_tu,
           coalesce(d.sang, public.chuoi_sach(p_sang)) AS khoa_sang,
           a.thu_nguyen AS tn_tu, a.he_so_ve_goc AS hs_tu,
           b.thu_nguyen AS tn_sang, b.he_so_ve_goc AS hs_sang
      FROM (SELECT public.don_vi_tai(p_org, p_tu, p_moc) AS tu,
                   public.don_vi_tai(p_org, p_sang, p_moc) AS sang) d
      LEFT JOIN public.uom_units a ON a.code = d.tu
      LEFT JOIN public.uom_units b ON b.code = d.sang
  ),
  canh AS (
    SELECT DISTINCT ON (c.tu_don_vi, c.sang_don_vi) c.tu_don_vi, c.sang_don_vi, c.he_so, c.rut
      FROM public.item_uom_conversions c
     WHERE c.org_id = p_org
       AND c.canonical_item_id = p_hang_chuan
       AND c.ghi_luc < p_moc
     ORDER BY c.tu_don_vi, c.sang_don_vi, c.seq DESC
  ),
  ung_vien AS (
    SELECT (CASE WHEN c.tu_don_vi = u.khoa_tu THEN 1::numeric ELSE u.hs_tu / t.he_so_ve_goc END)
             * c.he_so * (s.he_so_ve_goc / u.hs_sang) AS he_so
      FROM u
      JOIN canh c ON NOT c.rut
      JOIN public.uom_units s ON s.code = c.sang_don_vi
      LEFT JOIN public.uom_units t ON t.code = c.tu_don_vi
     WHERE s.thu_nguyen = u.tn_sang
       AND (c.tu_don_vi = u.khoa_tu OR t.thu_nguyen = u.tn_tu)
    UNION ALL
    SELECT (u.hs_tu / s.he_so_ve_goc) / c.he_so
             * (CASE WHEN c.tu_don_vi = u.khoa_sang THEN 1::numeric ELSE t.he_so_ve_goc / u.hs_sang END)
      FROM u
      JOIN canh c ON NOT c.rut
      JOIN public.uom_units s ON s.code = c.sang_don_vi
      LEFT JOIN public.uom_units t ON t.code = c.tu_don_vi
     WHERE s.thu_nguyen = u.tn_tu
       AND (c.tu_don_vi = u.khoa_sang OR t.thu_nguyen = u.tn_sang)
  )
  SELECT CASE WHEN u.tu = u.sang THEN 1::numeric
              WHEN u.tn_tu = u.tn_sang THEN u.hs_tu / u.hs_sang
              WHEN (SELECT count(*) FROM ung_vien) = 1 THEN (SELECT v.he_so FROM ung_vien v)
              ELSE NULL END,
         CASE WHEN u.tu = u.sang THEN 'CUNG_DON_VI'
              WHEN u.tn_tu = u.tn_sang THEN 'QUY_DOI_CHUNG'
              WHEN (SELECT count(*) FROM ung_vien) = 1 THEN 'QUY_DOI_RIENG'
              ELSE 'KHONG_QUY_DOI_DUOC' END
    FROM u
$ham$;

REVOKE ALL ON FUNCTION public.kiem_tra_quan_ly_du_lieu_mu_gia_vai_tro() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiem_tra_quan_ly_du_lieu_mu_gia_nguoi_dung() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.du_lieu_nen_kiem_quyen_ghi() FROM PUBLIC;

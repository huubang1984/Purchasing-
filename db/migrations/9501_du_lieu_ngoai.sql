-- =============================================================================================
-- 9501 — [S1.9101 / S4.6a] MỐC GIÁ NGOÀI VÀ LỊCH SỬ MUA NGOÀI HỆ THỐNG — HAI BẢNG GIÁ KHÔNG PHẢI BÁO GIÁ (spec S4 §4.6, §4.7,
-- §5.1 L1 · L3 · L15; ADR-096, ADR-095 ⑸, ADR-054)
-- =============================================================================================
-- Chủ dự án chốt ngày 2026-10-06 (ADR-9201), cả bốn theo đề xuất: người quản lý dữ liệu (mù giá) KHÔNG đọc lại giá mình nhập — màn
-- `/du-lieu` hiện hàng đã nhập không cột giá, cổng đọc giá giữ đúng `bid.view` của ADR-096 ⑵; dải lịch sử ngoài lấy (ngày mua, nhà
-- cung cấp) làm "gói"; dòng của gói X hiện mốc ngoài MỚI NHẤT trong cửa sổ; S4.6 chia hai PR — vòng này (S4.6a) là đường GHI, phép
-- đọc giá và màn `/mo-thau` ở S4.6b.
--
-- Ba thứ:
--
--   (1) Hai bảng, mọi bảng mang khuôn nền L1 của `079` (`du_lieu_nen_dat_thu_tu`, chỉ-ghi-thêm kể cả `TRUNCATE`, tác giả dẫn xuất
--       từ phiên, `id`/`seq`/`ghi_luc` ngoài GRANT) và cổng ghi `item.manage` của `083` (L3):
--         `external_price_references`  — mốc giá ngoài: hàng chuẩn, đơn giá, đơn vị, tiền tệ, NGÀY HIỆU LỰC của mức giá (không phải
--                                         ngày nhập), nguồn (tên nguồn, tham chiếu — lời khai của người nhập, ADR-096 ⑶);
--         `external_purchase_history`  — lịch sử mua ngoài hệ thống: cùng cột, thêm ngày mua và tên nhà cung cấp dạng chữ.
--       Cả hai mang `lo_nhap_id`: một lần nhập (tay, hay một lần dán CSV) là MỘT lô, và một lô là MỘT hàng sổ (ADR-096 ⑸).
--   (2) RÚT THEO MÃ HÀNG — khuôn `rfq_sourcing_exceptions` (`105`), không khuôn khoá tự nhiên của bí danh: hai mốc ngoài của cùng
--       một hàng chuẩn là hai lời khai độc lập, không có khoá nào để hàng mới nhất "thắng". Hàng rút trỏ `rut_cua` về đúng một hàng
--       dữ liệu và không mang dữ liệu; `UNIQUE (org_id, rut_cua)` giữ mỗi hàng một lần rút kể cả khi hai lần rút đua nhau; trigger
--       từ chối hàng rút trỏ về một hàng rút. Một hàng còn hiệu lực TẠI MỐC M khi nó ghi trước M và không hàng rút nào của nó ghi
--       trước M — phép đọc as-of của S4.6b, khuôn `quan_sat_gia`.
--   (3) ĐƠN VỊ QUY ĐỔI ĐƯỢC, KHÔNG THÌ TỪ CHỐI KHI GHI (spec §4.7). `don_vi` lưu KHOÁ — mã của danh mục nếu chuỗi người quản lý dữ
--       liệu nhập quy về một mã (`maDanhMuc`), không thì chuỗi đã làm sạch (đơn vị đóng gói, đúng dạng `tu_don_vi` của quy đổi
--       riêng). Trigger hỏi lõi quy đổi DUY NHẤT (`quy_doi_da_giai`, L4) tại `clock_timestamp()`: `KHONG_QUY_DOI_DUOC` ⇒ từ chối
--       có tên. Phép đọc của S4.6b hỏi CÙNG lõi tại mốc mở giá của gói — một quy đổi riêng rút trước mốc ấy làm hàng thành không
--       đo được ở gói ấy, không đổi lần ghi đã qua.
--
-- KHÔNG CÓ ĐỌC GIÁ Ở VÒNG NÀY. `app_api` có `SELECT` mức bảng (khuôn mọi bảng nền); ranh giới là lớp `bang-ngoai-liet-ke.test.ts`:
-- mọi câu SQL chạm hai bảng có tên, và không câu `SELECT` nào đọc `don_gia` cho tới bộ đọc `bid.view` của S4.6b.
--
-- Khoá tư vấn: khuôn `079` hạt giống `3` theo (bảng, tổ chức). Mọi hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG
-- commit (S1.96).
-- =============================================================================================

CREATE TABLE external_price_references (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations (id),
  -- Hàng rút trỏ về hàng dữ liệu nó rút; hàng dữ liệu để trống.
  rut_cua            uuid,
  canonical_item_id  uuid,
  don_gia            numeric,
  don_vi             text,
  tien_te            text,
  ngay_hieu_luc      date,
  nguon              text,
  lo_nhap_id         uuid,
  tac_gia            uuid NOT NULL,
  session_id         uuid NOT NULL,
  seq                bigint NOT NULL,
  ghi_luc            timestamptz NOT NULL,
  CONSTRAINT external_price_references_hinh_dang CHECK (
    (rut_cua IS NULL AND canonical_item_id IS NOT NULL AND don_gia IS NOT NULL AND don_vi IS NOT NULL AND tien_te IS NOT NULL
     AND ngay_hieu_luc IS NOT NULL AND nguon IS NOT NULL AND lo_nhap_id IS NOT NULL)
    OR (rut_cua IS NOT NULL AND canonical_item_id IS NULL AND don_gia IS NULL AND don_vi IS NULL AND tien_te IS NULL
        AND ngay_hieu_luc IS NULL AND nguon IS NULL AND lo_nhap_id IS NULL)),
  -- Dương và HỮU HẠN — bài học `item_uom_conversions_he_so_huu_han` (`103`): `'NaN' > 0` là đúng ở Postgres.
  CONSTRAINT external_price_references_don_gia_duong CHECK (
    don_gia IS NULL
    OR (don_gia OPERATOR(pg_catalog.>) 0
        AND don_gia OPERATOR(pg_catalog.<>) 'NaN'::pg_catalog.numeric
        AND don_gia OPERATOR(pg_catalog.<) 'Infinity'::pg_catalog.numeric)),
  CONSTRAINT external_price_references_don_vi_da_lam_sach CHECK (
    don_vi IS NULL OR (don_vi <> '' AND don_vi = public.chuoi_sach(don_vi))),
  CONSTRAINT external_price_references_tien_te_mien CHECK (tien_te IS NULL OR tien_te IN ('VND', 'USD')),
  CONSTRAINT external_price_references_nguon_hinh_dang CHECK (
    nguon IS NULL OR (nguon = btrim(nguon) AND length(nguon) BETWEEN 1 AND 500)),
  UNIQUE (org_id, id),
  UNIQUE (org_id, seq),
  -- Mỗi hàng rút một lần.
  UNIQUE (org_id, rut_cua),
  FOREIGN KEY (org_id, rut_cua) REFERENCES external_price_references (org_id, id),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

CREATE TABLE external_purchase_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations (id),
  rut_cua            uuid,
  canonical_item_id  uuid,
  don_gia            numeric,
  don_vi             text,
  tien_te            text,
  ngay_mua           date,
  nha_cung_cap_text  text,
  nguon              text,
  lo_nhap_id         uuid,
  tac_gia            uuid NOT NULL,
  session_id         uuid NOT NULL,
  seq                bigint NOT NULL,
  ghi_luc            timestamptz NOT NULL,
  CONSTRAINT external_purchase_history_hinh_dang CHECK (
    (rut_cua IS NULL AND canonical_item_id IS NOT NULL AND don_gia IS NOT NULL AND don_vi IS NOT NULL AND tien_te IS NOT NULL
     AND ngay_mua IS NOT NULL AND nha_cung_cap_text IS NOT NULL AND nguon IS NOT NULL AND lo_nhap_id IS NOT NULL)
    OR (rut_cua IS NOT NULL AND canonical_item_id IS NULL AND don_gia IS NULL AND don_vi IS NULL AND tien_te IS NULL
        AND ngay_mua IS NULL AND nha_cung_cap_text IS NULL AND nguon IS NULL AND lo_nhap_id IS NULL)),
  CONSTRAINT external_purchase_history_don_gia_duong CHECK (
    don_gia IS NULL
    OR (don_gia OPERATOR(pg_catalog.>) 0
        AND don_gia OPERATOR(pg_catalog.<>) 'NaN'::pg_catalog.numeric
        AND don_gia OPERATOR(pg_catalog.<) 'Infinity'::pg_catalog.numeric)),
  CONSTRAINT external_purchase_history_don_vi_da_lam_sach CHECK (
    don_vi IS NULL OR (don_vi <> '' AND don_vi = public.chuoi_sach(don_vi))),
  CONSTRAINT external_purchase_history_tien_te_mien CHECK (tien_te IS NULL OR tien_te IN ('VND', 'USD')),
  -- Tên nhà cung cấp là CHỮ người nhập dán vào — không khoá ngoại tới `suppliers`: lịch sử ngoài hệ thống là của những lần mua mà
  -- hệ thống không thấy, và phần lớn nhà cung cấp ấy chưa từng là một hàng của `suppliers`.
  CONSTRAINT external_purchase_history_nha_cung_cap_hinh_dang CHECK (
    nha_cung_cap_text IS NULL OR (nha_cung_cap_text = btrim(nha_cung_cap_text) AND length(nha_cung_cap_text) BETWEEN 1 AND 300)),
  CONSTRAINT external_purchase_history_nguon_hinh_dang CHECK (
    nguon IS NULL OR (nguon = btrim(nguon) AND length(nguon) BETWEEN 1 AND 500)),
  UNIQUE (org_id, id),
  UNIQUE (org_id, seq),
  UNIQUE (org_id, rut_cua),
  FOREIGN KEY (org_id, rut_cua) REFERENCES external_purchase_history (org_id, id),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

CREATE INDEX external_price_references_theo_hang ON external_price_references (org_id, canonical_item_id);
CREATE INDEX external_price_references_theo_lo ON external_price_references (org_id, lo_nhap_id);
CREATE INDEX external_purchase_history_theo_hang ON external_purchase_history (org_id, canonical_item_id);
CREATE INDEX external_purchase_history_theo_lo ON external_purchase_history (org_id, lo_nhap_id);

ALTER TABLE external_price_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_price_references FORCE ROW LEVEL SECURITY;
ALTER TABLE external_purchase_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_purchase_history FORCE ROW LEVEL SECURITY;

CREATE POLICY external_price_references_tenant_isolation ON external_price_references
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY external_purchase_history_tenant_isolation ON external_purchase_history
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Policy khách ĐÓNG HẲN — hai bảng mang giá (ADR-096 ⑵).
CREATE POLICY external_price_references_khach ON external_price_references AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);
CREATE POLICY external_purchase_history_khach ON external_purchase_history AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

REVOKE ALL ON external_price_references, external_purchase_history FROM PUBLIC;
GRANT SELECT ON external_price_references, external_purchase_history TO app_api;
GRANT INSERT (org_id, rut_cua, canonical_item_id, don_gia, don_vi, tien_te, ngay_hieu_luc, nguon, lo_nhap_id, tac_gia, session_id)
  ON external_price_references TO app_api;
GRANT INSERT (org_id, rut_cua, canonical_item_id, don_gia, don_vi, tien_te, ngay_mua, nha_cung_cap_text, nguon, lo_nhap_id,
              tac_gia, session_id)
  ON external_purchase_history TO app_api;

-- ---------------------------------------------------------------------------------------------
-- LUẬT GHI — một hàm cho hai bảng: hàng rút không trỏ về hàng rút; hàng dữ liệu mang đơn vị quy đổi được sang đơn vị gốc.
-- ---------------------------------------------------------------------------------------------
-- Hàng rút trỏ về một hàng KHÔNG có (hay của tổ chức khác) thì `dich_rut` rỗng và khoá ngoại tự trỏ từ chối ở cuối câu — trigger
-- không lặp lại lời từ chối ấy. Hàng chuẩn không có thì cũng vậy (khoá ngoại tới `canonical_items`).
CREATE OR REPLACE FUNCTION public.du_lieu_ngoai_kiem_ghi() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
DECLARE
  dich_rut uuid;
  goc text;
  ma_quy_doi text;
BEGIN
  IF NEW.rut_cua IS NOT NULL THEN
    EXECUTE pg_catalog.format('SELECT h.rut_cua FROM public.%I h WHERE h.org_id = $1 AND h.id = $2', TG_TABLE_NAME)
       INTO dich_rut USING NEW.org_id, NEW.rut_cua;
    IF dich_rut IS NOT NULL THEN
      RAISE EXCEPTION 'Hang % la mot hang rut — chi rut hang du lieu', NEW.rut_cua
        USING ERRCODE = 'check_violation', CONSTRAINT = 'du_lieu_ngoai_rut_hang_rut';
    END IF;
    RETURN NEW;
  END IF;
  -- [S1.9101 / chủ dự án chốt sau rà soát 2026-10-06] Lịch sử mua là quá khứ: ngày mua sau HÔM NAY theo giờ Việt Nam (UTC+7, không
  -- giờ mùa hè) bị từ chối. IF lồng: `NEW.ngay_mua` chỉ có ở bảng lịch sử, và PL/pgSQL chỉ dịch biểu thức khi chạy tới nó.
  IF TG_TABLE_NAME = 'external_purchase_history' THEN
    IF NEW.ngay_mua > (pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()) + '7 hours'::pg_catalog.interval)::pg_catalog.date THEN
      RAISE EXCEPTION 'Ngay mua sau ngay hom nay theo gio Viet Nam'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'du_lieu_ngoai_ngay_mua_sau_hom_nay';
    END IF;
  END IF;
  SELECT ci.don_vi_goc INTO goc
    FROM public.canonical_items ci
   WHERE ci.org_id = NEW.org_id AND ci.id = NEW.canonical_item_id;
  IF goc IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT k.ma INTO ma_quy_doi
    FROM public.quy_doi_da_giai(NEW.org_id, NEW.canonical_item_id,
                                (SELECT u.code FROM public.uom_units u WHERE u.code = NEW.don_vi), NEW.don_vi,
                                goc, goc, pg_catalog.clock_timestamp()) k;
  IF ma_quy_doi IS NULL OR ma_quy_doi = 'KHONG_QUY_DOI_DUOC' THEN
    RAISE EXCEPTION 'Don vi % khong quy doi duoc sang don vi goc % cua hang chuan %', NEW.don_vi, goc, NEW.canonical_item_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'du_lieu_ngoai_don_vi_khong_quy_doi_duoc';
  END IF;
  RETURN NEW;
END
$ham$;

-- Năm trigger mỗi bảng: bốn trigger khuôn nền (thứ tự, danh tính, cổng ghi, chỉ-ghi-thêm + TRUNCATE) và luật ghi. Tên
-- `_kiem_ngoai` xếp SAU `_kiem_danh_tinh` (`kiem_n` > `kiem_d`): luật ghi chạy khi `tac_gia` đã là người của phiên.
CREATE TRIGGER external_price_references_dat_thu_tu
  BEFORE INSERT ON external_price_references
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE external_price_references ENABLE ALWAYS TRIGGER external_price_references_dat_thu_tu;
CREATE TRIGGER external_price_references_kiem_danh_tinh
  BEFORE INSERT ON external_price_references
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE external_price_references ENABLE ALWAYS TRIGGER external_price_references_kiem_danh_tinh;
CREATE TRIGGER external_price_references_kiem_ngoai
  BEFORE INSERT ON external_price_references
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_ngoai_kiem_ghi();
ALTER TABLE external_price_references ENABLE ALWAYS TRIGGER external_price_references_kiem_ngoai;
CREATE TRIGGER external_price_references_kiem_quyen_ghi
  BEFORE INSERT ON external_price_references
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_kiem_quyen_ghi();
ALTER TABLE external_price_references ENABLE ALWAYS TRIGGER external_price_references_kiem_quyen_ghi;
CREATE TRIGGER external_price_references_chi_ghi_them
  BEFORE UPDATE OR DELETE ON external_price_references
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE external_price_references ENABLE ALWAYS TRIGGER external_price_references_chi_ghi_them;
CREATE TRIGGER external_price_references_chan_truncate
  BEFORE TRUNCATE ON external_price_references
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE external_price_references ENABLE ALWAYS TRIGGER external_price_references_chan_truncate;

CREATE TRIGGER external_purchase_history_dat_thu_tu
  BEFORE INSERT ON external_purchase_history
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE external_purchase_history ENABLE ALWAYS TRIGGER external_purchase_history_dat_thu_tu;
CREATE TRIGGER external_purchase_history_kiem_danh_tinh
  BEFORE INSERT ON external_purchase_history
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE external_purchase_history ENABLE ALWAYS TRIGGER external_purchase_history_kiem_danh_tinh;
CREATE TRIGGER external_purchase_history_kiem_ngoai
  BEFORE INSERT ON external_purchase_history
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_ngoai_kiem_ghi();
ALTER TABLE external_purchase_history ENABLE ALWAYS TRIGGER external_purchase_history_kiem_ngoai;
CREATE TRIGGER external_purchase_history_kiem_quyen_ghi
  BEFORE INSERT ON external_purchase_history
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_kiem_quyen_ghi();
ALTER TABLE external_purchase_history ENABLE ALWAYS TRIGGER external_purchase_history_kiem_quyen_ghi;
CREATE TRIGGER external_purchase_history_chi_ghi_them
  BEFORE UPDATE OR DELETE ON external_purchase_history
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE external_purchase_history ENABLE ALWAYS TRIGGER external_purchase_history_chi_ghi_them;
CREATE TRIGGER external_purchase_history_chan_truncate
  BEFORE TRUNCATE ON external_purchase_history
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE external_purchase_history ENABLE ALWAYS TRIGGER external_purchase_history_chan_truncate;

-- =============================================================================================
-- 079 — [S1.192 / S4.1] ĐƠN VỊ ĐO VÀ KHUÔN NỀN CỦA DỮ LIỆU NỀN (spec S4 §4.2, §5.1 L1 · L4)
-- =============================================================================================
-- Bốn thứ, không thứ nào chạm bảng chính sách (spec S4 §2.5 ⒆) hay đường mở thầu (§3.1):
--
--   (1) `chuoi_sach(text)` — bước LÀM SẠCH chuỗi bản 1, chỉ ở SQL (§2.5 ⒄): NFKD, bỏ dấu, `đ`→`d`, chữ
--       thường, mọi ký tự ngoài `[a-z0-9]` thành khoảng trắng, gộp khoảng trắng, cắt hai đầu. Không
--       extension. Bản 1 là luật chủ dự án chốt ngày 2026-09-29: *"D10-HP"* thành `d10 hp`. Mọi thay đổi
--       luật là một PHIÊN BẢN mới, không sửa thân này — bí danh đã lưu mang dạng sạch của bản 1.
--   (2) `uom_units`, `uom_aliases_chung` — hai danh mục TOÀN CỤC, khuôn `roles` của `005`: không `org_id`,
--       `app_api` chỉ `SELECT`, gieo bằng chính tệp này, chỉ-ghi-thêm kể cả `TRUNCATE` (khuôn `047`).
--       `he_so_ve_goc` là THƯỚC: đổi nó là đổi mọi quy đổi đã dùng.
--   (3) `uom_aliases` — bí danh đơn vị của TỔ CHỨC, và bảng đầu tiên mang KHUÔN NỀN L1: chỉ-ghi-thêm có
--       hàng rút; một trigger BEFORE INSERT lấy khoá tư vấn → `seq` = max + 1 → `ghi_luc` =
--       `clock_timestamp()`; `id`, `seq`, `ghi_luc` nằm ngoài GRANT. Mọi bảng dữ liệu nền về sau (hàng
--       chuẩn, bí danh hàng, quy đổi riêng, ánh xạ, gợi ý, mốc ngoài, lịch sử ngoài hệ thống) dùng ĐÚNG
--       hàm trigger này — test đếm `BANG_DU_LIEU_NEN` canh điều đó.
--   (4) `don_vi_tai`, `quy_doi_don_vi` — hàm quy đổi SQL DUY NHẤT (L4). Luật: cùng thứ nguyên của danh
--       mục toàn cục thì quy đổi; mọi cặp khác cho `KHONG_QUY_DOI_DUOC` — không đoán, không hệ số `1`.
--       Vế ⑵ (đơn vị đóng gói qua quy đổi riêng của ĐÚNG hàng chuẩn) thuộc S4.2, nơi bảng ấy ra đời;
--       tham số `p_hang_chuan` có mặt từ bây giờ để S4.2 không phải đổi chữ ký một hàm đã ghim.
--
-- MÃ ĐƠN VỊ KHÔNG BAO GIỜ ĐƯỢC KHỚP TRỰC TIẾP từ chuỗi tự do — chỉ qua bí danh. Lý do: `chuoi_sach` hạ
-- chữ, nên *"T"* và *"M"* thành `t`, `m` — đúng hai mã của tấn và mét — trong khi spec §4.2 đặt chúng là
-- dạng MƠ HỒ mà tổ chức tự khai. Dạng mã không mơ hồ (`kg`, `cm`, `m2`…) vì thế có bí danh toàn cục
-- của chính nó; `t` và `m` thì không.
--
-- Khoá tư vấn hạt giống `3`: `0` là khoá sổ theo tổ chức (`004`), `1` và `2` đã dùng (`069`…). Khoá theo
-- (bảng, tổ chức), nên hai bảng nền không chờ nhau và hai tổ chức không chờ nhau.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- (1) LÀM SẠCH CHUỖI — BẢN 1
-- ---------------------------------------------------------------------------------------------
-- NFKD chứ không NFD như spec §4.1 ghi: NFD giữ nguyên *"m²"*, bước thay ký tự lạ biến nó thành `m` — mã
-- của MÉT, một đơn vị khác thứ nguyên. NFKD tách `²` thành `2` (*"m²"* → `m2`, *"ｋｇ"* → `kg`); với chữ
-- Việt hai dạng cho cùng kết quả.
-- `[̀-ͯ]` là dải dấu kết hợp mà NFKD tách ra (sắc, huyền, hỏi, ngã, nặng, mũ, trăng, móc). Bỏ
-- chúng TRƯỚC bước thay ký tự lạ: làm ngược lại thì *"Thép"* thành `the p`. `đ`/`Đ` không có dạng tách
-- nên đổi riêng. IMMUTABLE để `CHECK` của bảng bí danh gọi được nó.
CREATE OR REPLACE FUNCTION public.chuoi_sach(p text) RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
  SET search_path = pg_catalog
AS $ham$
  SELECT btrim(regexp_replace(
           regexp_replace(
             lower(translate(regexp_replace(normalize(p, NFKD), '[̀-ͯ]', '', 'g'), 'đĐ', 'dd')),
             '[^a-z0-9]+', ' ', 'g'),
           ' +', ' ', 'g'))
$ham$;

-- ---------------------------------------------------------------------------------------------
-- (2) HAI DANH MỤC TOÀN CỤC
-- ---------------------------------------------------------------------------------------------
CREATE TABLE uom_units (
  code          text PRIMARY KEY CHECK (code ~ '^[a-z0-9]{1,10}$'),
  thu_nguyen    text NOT NULL
                CHECK (thu_nguyen IN ('KHOI_LUONG', 'CHIEU_DAI', 'DIEN_TICH', 'THE_TICH', 'DEM')),
  he_so_ve_goc  numeric NOT NULL CHECK (he_so_ve_goc > 0)
);

-- Bí danh toàn cục ở BẢNG RIÊNG, không phải hàng `org_id NULL` trong `uom_aliases`: dưới FORCE RLS hàng
-- ấy vô hình, và policy `org_id IS NULL OR …` là dạng fail-open mà `002` cấm (spec §4.2, góc B⑩).
CREATE TABLE uom_aliases_chung (
  bi_danh_sach  text PRIMARY KEY
                CHECK (bi_danh_sach <> '' AND bi_danh_sach = public.chuoi_sach(bi_danh_sach)),
  code          text NOT NULL REFERENCES uom_units (code)
);

INSERT INTO uom_units (code, thu_nguyen, he_so_ve_goc) VALUES
  ('kg',  'KHOI_LUONG', 1),
  ('g',   'KHOI_LUONG', 0.001),
  ('t',   'KHOI_LUONG', 1000),
  ('m',   'CHIEU_DAI',  1),
  ('cm',  'CHIEU_DAI',  0.01),
  ('mm',  'CHIEU_DAI',  0.001),
  ('km',  'CHIEU_DAI',  1000),
  ('m2',  'DIEN_TICH',  1),
  ('m3',  'THE_TICH',   1),
  ('l',   'THE_TICH',   0.001),
  ('ml',  'THE_TICH',   0.000001),
  ('cai', 'DEM',        1);

-- Không có `t`, `m`, `mt`: dạng mơ hồ, tổ chức tự khai (spec §4.2).
INSERT INTO uom_aliases_chung (bi_danh_sach, code) VALUES
  ('kg', 'kg'), ('kgs', 'kg'), ('kilogram', 'kg'), ('kilo', 'kg'),
  ('g', 'g'), ('gram', 'g'),
  ('tan', 't'),
  ('met', 'm'), ('cm', 'cm'), ('mm', 'mm'), ('km', 'km'),
  ('m2', 'm2'),
  ('m3', 'm3'), ('l', 'l'), ('lit', 'l'), ('ml', 'ml'),
  ('cai', 'cai'), ('chiec', 'cai');

REVOKE ALL ON uom_units, uom_aliases_chung FROM PUBLIC;
GRANT SELECT ON uom_units, uom_aliases_chung TO app_api;

CREATE TRIGGER uom_units_chi_ghi_them
  BEFORE UPDATE OR DELETE ON uom_units
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE uom_units ENABLE ALWAYS TRIGGER uom_units_chi_ghi_them;

CREATE TRIGGER uom_units_chan_truncate
  BEFORE TRUNCATE ON uom_units
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE uom_units ENABLE ALWAYS TRIGGER uom_units_chan_truncate;

CREATE TRIGGER uom_aliases_chung_chi_ghi_them
  BEFORE UPDATE OR DELETE ON uom_aliases_chung
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE uom_aliases_chung ENABLE ALWAYS TRIGGER uom_aliases_chung_chi_ghi_them;

CREATE TRIGGER uom_aliases_chung_chan_truncate
  BEFORE TRUNCATE ON uom_aliases_chung
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE uom_aliases_chung ENABLE ALWAYS TRIGGER uom_aliases_chung_chan_truncate;

-- ---------------------------------------------------------------------------------------------
-- (3) KHUÔN NỀN L1 VÀ BÍ DANH ĐƠN VỊ CỦA TỔ CHỨC
-- ---------------------------------------------------------------------------------------------
-- Một hàm cho mọi bảng dữ liệu nền: bảng phải có `org_id`, `seq`, `ghi_luc`. Khoá TRƯỚC khi đọc max —
-- không có khoá thì hai giao dịch đồng thời cùng đọc max cũ và cùng ghi một `seq` (UNIQUE bên dưới
-- là lớp thứ hai, nó biến lỗi ấy thành một lần từ chối chứ không phải một thứ tự sai). `ghi_luc` là
-- `clock_timestamp()`, không phải `now()`: hai hàng của một giao dịch dài phải có hai mốc, và mốc là
-- lúc GHI, không phải lúc giao dịch bắt đầu. Ứng dụng khai gì cho ba cột ấy cũng bị đè.
CREATE OR REPLACE FUNCTION public.du_lieu_nen_dat_thu_tu() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(TG_TABLE_NAME || '|' || NEW.org_id::pg_catalog.text, 3));
  EXECUTE pg_catalog.format(
            'SELECT coalesce(max(seq), 0) + 1 FROM public.%I WHERE org_id OPERATOR(pg_catalog.=) $1',
            TG_TABLE_NAME)
    INTO NEW.seq
    USING NEW.org_id;
  NEW.ghi_luc := pg_catalog.clock_timestamp();
  RETURN NEW;
END
$ham$;

-- Hàng RÚT là một hàng mới cùng `bi_danh_sach`, `rut = true`, không mã: bí danh của tổ chức hết hiệu lực
-- từ `ghi_luc` của nó, và lịch sử trước đó vẫn đọc được theo mốc. Đổi `mt` từ `t` sang `m` là đổi thước
-- 1000 lần — nên nó là một hàng mới mang tác giả và mốc, không phải một lần UPDATE (spec §4.2, góc A⑧).
CREATE TABLE uom_aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id),
  bi_danh_sach  text NOT NULL
                CHECK (bi_danh_sach <> '' AND bi_danh_sach = public.chuoi_sach(bi_danh_sach)),
  code          text REFERENCES uom_units (code),
  rut           boolean NOT NULL DEFAULT false,
  tac_gia       uuid NOT NULL,
  session_id    uuid NOT NULL,
  seq           bigint NOT NULL,
  ghi_luc       timestamptz NOT NULL,
  CONSTRAINT uom_aliases_rut_khong_ma CHECK ((rut AND code IS NULL) OR (NOT rut AND code IS NOT NULL)),
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

ALTER TABLE uom_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE uom_aliases FORCE ROW LEVEL SECURITY;

CREATE POLICY uom_aliases_tenant_isolation ON uom_aliases
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN (L6: không phiên khách nào đọc dữ
-- liệu nền).
CREATE POLICY uom_aliases_khach ON uom_aliases AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

REVOKE ALL ON uom_aliases FROM PUBLIC;
GRANT SELECT ON uom_aliases TO app_api;
GRANT INSERT (org_id, bi_danh_sach, code, rut, tac_gia, session_id) ON uom_aliases TO app_api;

CREATE TRIGGER uom_aliases_dat_thu_tu
  BEFORE INSERT ON uom_aliases
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE uom_aliases ENABLE ALWAYS TRIGGER uom_aliases_dat_thu_tu;

-- [ADR-016] Tác giả là DẪN XUẤT từ phiên.
CREATE TRIGGER uom_aliases_kiem_danh_tinh
  BEFORE INSERT ON uom_aliases
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE uom_aliases ENABLE ALWAYS TRIGGER uom_aliases_kiem_danh_tinh;

CREATE TRIGGER uom_aliases_chi_ghi_them
  BEFORE UPDATE OR DELETE ON uom_aliases
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE uom_aliases ENABLE ALWAYS TRIGGER uom_aliases_chi_ghi_them;

CREATE TRIGGER uom_aliases_chan_truncate
  BEFORE TRUNCATE ON uom_aliases
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE uom_aliases ENABLE ALWAYS TRIGGER uom_aliases_chan_truncate;

-- ---------------------------------------------------------------------------------------------
-- (4) HÀM QUY ĐỔI DUY NHẤT (L4)
-- ---------------------------------------------------------------------------------------------
-- Chuỗi đơn vị tự do → mã, TẠI MỐC: bí danh của tổ chức mới nhất theo `seq` trong những hàng có
-- `ghi_luc` < mốc (hàng rút ⇒ bỏ bí danh của tổ chức), rồi bí danh chung. Không khớp mã trực tiếp —
-- xem đầu tệp. SECURITY INVOKER: RLS của `uom_aliases` vẫn áp, nên một `p_org` khác tổ chức đang gắn
-- chỉ còn thấy bí danh chung.
CREATE OR REPLACE FUNCTION public.don_vi_tai(p_org uuid, p_chuoi text, p_moc timestamptz) RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT coalesce(
           (SELECT CASE WHEN a.rut THEN NULL ELSE a.code END
              FROM public.uom_aliases a
             WHERE a.org_id = p_org
               AND a.bi_danh_sach = public.chuoi_sach(p_chuoi)
               AND a.ghi_luc < p_moc
             ORDER BY a.seq DESC
             LIMIT 1),
           (SELECT c.code FROM public.uom_aliases_chung c WHERE c.bi_danh_sach = public.chuoi_sach(p_chuoi)))
$ham$;

-- `he_so` nhân với một lượng theo `p_tu` cho lượng theo `p_sang`. `CUNG_DON_VI` là hệ số `1` CÓ NGUỒN
-- (cùng một mã); mọi ca không có nguồn là `NULL` kèm `KHONG_QUY_DOI_DUOC`.
CREATE OR REPLACE FUNCTION public.quy_doi_don_vi(
  p_org uuid, p_hang_chuan uuid, p_tu text, p_sang text, p_moc timestamptz)
  RETURNS TABLE (he_so numeric, ma text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT CASE WHEN a.code IS NULL OR b.code IS NULL THEN NULL
              WHEN a.code = b.code THEN 1::numeric
              WHEN a.thu_nguyen = b.thu_nguyen THEN a.he_so_ve_goc / b.he_so_ve_goc
              ELSE NULL END,
         CASE WHEN a.code IS NULL OR b.code IS NULL THEN 'KHONG_QUY_DOI_DUOC'
              WHEN a.code = b.code THEN 'CUNG_DON_VI'
              WHEN a.thu_nguyen = b.thu_nguyen THEN 'QUY_DOI_CHUNG'
              ELSE 'KHONG_QUY_DOI_DUOC' END
    FROM (SELECT public.don_vi_tai(p_org, p_tu, p_moc) AS tu,
                 public.don_vi_tai(p_org, p_sang, p_moc) AS sang) d
    LEFT JOIN public.uom_units a ON a.code = d.tu
    LEFT JOIN public.uom_units b ON b.code = d.sang
$ham$;

REVOKE ALL ON FUNCTION public.chuoi_sach(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.du_lieu_nen_dat_thu_tu() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.don_vi_tai(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quy_doi_don_vi(uuid, uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chuoi_sach(text) TO app_api;
GRANT EXECUTE ON FUNCTION public.don_vi_tai(uuid, text, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION public.quy_doi_don_vi(uuid, uuid, text, text, timestamptz) TO app_api;

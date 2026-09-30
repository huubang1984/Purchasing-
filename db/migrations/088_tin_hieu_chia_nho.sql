-- ==============================================================================================
-- 088_tin_hieu_chia_nho — [S1.203 / S3.6b1 của spec S3] TÍN HIỆU CHIA NHỎ GÓI (`PURCHASE_SPLITTING`) VÀ LẦN GHI NHẬN;
-- K10a Ở CẠNH `PENDING_APPROVAL→OPEN`
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.6, §5.1 (K10), §2.5 ⒁, §2.4 ⑺, §9 (S3.6).
-- ADR-084 ⑵ ⑷ (ghi nhận dùng quyền của cạnh bị chặn; `CONTROL_DENIED`). Chủ dự án chốt ngày 2026-09-29: S3.6b chia hai PR, b1
-- là CSDL, tầng gói và route; *người gây ra* tín hiệu là người tạo và người nộp của MỌI gói trong bằng chứng; chỉ xét cận bậc;
-- mã ở `packages/kiem-soat`; gói đã HUỶ không tính; tín hiệu mới lưu lúc GHI NHẬN (cạnh mở gói chỉ đọc và từ chối); người gây
-- ra tự ghi nhận thì vào sổ `CONTROL_DENIED`.
--
-- (1) `tin_hieu_chia_nho(org, gói)` — HÀM DUY NHẤT tính tín hiệu (spec §2 hàng 6: TypeScript không giữ bản sao). Tập xét: chính
--     gói ấy và mọi gói anh em cùng tổ chức, CÙNG NHÓM HÀNG (không cùng người tạo — §2.5 ⒁: khoá theo người tạo thì nhờ đồng
--     nghiệp tạo gói là né được), đã rời DRAFT và chưa huỷ, cùng đơn vị tiền, nộp duyệt trong `chia_nho_cua_so_ngay` ngày TÍNH
--     NGƯỢC từ `submitted_at` của chính gói ấy. Tín hiệu bắn ở cận bậc `T` cao nhất (mọi `tu_so_tien` > 0 của phiên bản mà ngân
--     sách của gói ghim) mà tập con {gói có ước lượng dưới `T`} chứa chính gói ấy và có TỔNG ≥ `T` — `≥` đúng như
--     `rfq_bac_cua`, nơi một giá trị bằng cận thuộc bậc trên. Bằng chứng không mang ước lượng nào: nhóm hàng, phiên bản, cửa
--     sổ, cận và danh sách gói.
--     Neo vào `submitted_at` của chính gói nên tập chỉ CO lại sau lần nộp: gói anh em nộp SAU nằm ngoài cửa sổ của gói này (và
--     cửa sổ của nó chứa gói này — gói nộp sau cùng gặp tín hiệu), gói trả về DRAFT hay bị huỷ rời tập.
-- (2) HAI BẢNG CHỈ GHI THÊM. `governance_signals` mang đủ năm thứ V2.1 §19 đòi — nguồn, thời điểm, bằng chứng, độ tin cậy,
--     giải thích —; bốn cột sau do TRIGGER đặt, ngoài `GRANT`: người gọi không khai được bằng chứng, nên mọi hàng tín hiệu là
--     một ảnh chụp THẬT lúc tính. `governance_signal_acks` — một lần ghi nhận, có lý do.
-- (3) LUẬT NGƯỜI GHI NHẬN — một hàm `tin_hieu_chot_nguoi_ghi_nhan`, tầng gói hỏi TRƯỚC câu ghi, trigger hỏi lại: người ghi nhận
--     giữ quyền của cạnh bị chặn (`rfq.approve` ở mở gói), không là người tạo hay người nộp của gói nào trong bằng chứng, không là
--     người khai phiên bản chính sách mà gói ghim (§2.4 ⑺). Lần ghi nhận phải trỏ tới một tín hiệu có bằng chứng BẰNG kết quả
--     hiện tại, và chỉ khi gói đang chờ duyệt.
-- (4) CHỐT `rfq_chot_tin_hieu(org, gói)` ở cạnh `PENDING_APPROVAL→OPEN`, một điều kiện, fail-closed (§2.5 ⒁): tín hiệu tính NGAY
--     LÚC ẤY mà không có lần ghi nhận nào trên một tín hiệu có bằng chứng bằng nó ⇒ `TIN_HIEU_CHUA_GHI_NHAN`. Tầng gói hỏi trước
--     `issueRfqKeyPair` (khoản 31); trigger RIÊNG hỏi lại — lớp chặn cuối cho câu viết tay. Tổ chức chưa bật: hàm tín hiệu trả
--     NULL, cạnh chạy như MVP1.
--
-- Không khoá tư vấn mới: tập chỉ co lại sau lần nộp, nên một lần đọc cũ hơn chỉ có thể thấy NHIỀU gói hơn, không ít hơn; và mọi
-- câu đọc tập đều tính lại tại chỗ, không tin một ảnh chụp nào.
--
-- Mọi hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) HÀM TÍN HIỆU
-- ============================================================================================
-- Không SECURITY DEFINER: chạy dưới quyền người gọi, RLS áp — chỉ gói của chính tổ chức vào tập.
CREATE OR REPLACE FUNCTION public.tin_hieu_chia_nho(p_org uuid, p_rfq uuid) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  g record;
  cs record;
  kq record;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  SELECT r.category_id, r.submitted_at, r.status, b.currency, b.policy_id
    INTO g
    FROM public.rfq_packages r
    JOIN public.rfq_budgets b ON b.org_id = r.org_id AND b.rfq_id = r.id
   WHERE r.org_id = p_org AND r.id = p_rfq;
  IF NOT FOUND OR g.category_id IS NULL OR g.submitted_at IS NULL OR g.status IN ('DRAFT', 'CANCELLED') THEN
    RETURN NULL;
  END IF;
  SELECT p.tiers, p.chia_nho_cua_so_ngay
    INTO cs
    FROM public.org_procurement_policies p
   WHERE p.org_id = p_org AND p.id = g.policy_id;
  IF NOT FOUND OR cs.tiers IS NULL OR cs.chia_nho_cua_so_ngay IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT c.can, array_agg(t.id ORDER BY t.id) AS goi
    INTO kq
    FROM (SELECT (e ->> 'tu_so_tien')::numeric AS can
            FROM pg_catalog.jsonb_array_elements(cs.tiers) e
           WHERE (e ->> 'tu_so_tien')::numeric > 0) c
    JOIN (SELECT r.id, b.estimated_value AS gia_tri
            FROM public.rfq_packages r
            JOIN public.rfq_budgets b ON b.org_id = r.org_id AND b.rfq_id = r.id
           WHERE r.org_id = p_org
             AND r.category_id = g.category_id
             AND r.status NOT IN ('DRAFT', 'CANCELLED')
             AND r.submitted_at >= g.submitted_at - pg_catalog.make_interval(days => cs.chia_nho_cua_so_ngay)
             AND r.submitted_at <= g.submitted_at
             AND b.currency = g.currency) t
      ON t.gia_tri < c.can
   GROUP BY c.can
  HAVING bool_or(t.id = p_rfq) AND sum(t.gia_tri) >= c.can
   ORDER BY c.can DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'loai', 'PURCHASE_SPLITTING',
    'nhom_hang', g.category_id,
    'chinh_sach', g.policy_id,
    'cua_so_ngay', cs.chia_nho_cua_so_ngay,
    'can', kq.can,
    'goi', pg_catalog.to_jsonb(kq.goi));
END
$ham$;

-- ============================================================================================
-- (2) HAI BẢNG
-- ============================================================================================
CREATE TABLE governance_signals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  rfq_id                uuid NOT NULL,
  loai                  text NOT NULL CHECK (loai IN ('PURCHASE_SPLITTING')),
  -- Nơi tín hiệu được tính: lần nộp duyệt, hay lần ghi nhận khi bằng chứng đã đổi sau lần nộp (chủ dự án chốt 2026-09-29).
  nguon                 text NOT NULL CHECK (nguon IN ('NOP_DUYET', 'GHI_NHAN')),
  -- Bốn cột dưới do trigger đặt, ngoài `GRANT`.
  bang_chung            jsonb NOT NULL,
  do_tin_cay            text NOT NULL CHECK (do_tin_cay IN ('XAC_DINH')),
  giai_thich            text NOT NULL,
  tinh_luc              timestamptz NOT NULL,
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  -- Đích của khoá ngoại theo (tổ chức, tín hiệu) từ bảng ghi nhận (ADR-013).
  UNIQUE (org_id, id)
);
CREATE INDEX governance_signals_theo_goi ON governance_signals (org_id, rfq_id);

ALTER TABLE governance_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_signals FORCE ROW LEVEL SECURITY;

CREATE POLICY governance_signals_tenant_isolation ON governance_signals
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: tín hiệu là việc nội bộ bên mua.
CREATE POLICY governance_signals_khach ON governance_signals AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- KHÔNG `UPDATE`, KHÔNG `DELETE`: chỉ ghi thêm. Không cấp bốn cột trigger đặt.
GRANT SELECT ON governance_signals TO app_api;
GRANT INSERT (org_id, rfq_id, loai, nguon, created_by, created_by_session_id) ON governance_signals TO app_api;

-- [ADR-016] Người ghi là DẪN XUẤT từ phiên.
CREATE TRIGGER governance_signals_kiem_danh_tinh
  BEFORE INSERT ON governance_signals
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE governance_signals ENABLE ALWAYS TRIGGER governance_signals_kiem_danh_tinh;

CREATE TRIGGER governance_signals_chi_ghi_them
  BEFORE UPDATE OR DELETE ON governance_signals
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE governance_signals ENABLE ALWAYS TRIGGER governance_signals_chi_ghi_them;

CREATE TRIGGER governance_signals_chan_truncate
  BEFORE TRUNCATE ON governance_signals
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE governance_signals ENABLE ALWAYS TRIGGER governance_signals_chan_truncate;

CREATE TABLE governance_signal_acks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  signal_id             uuid NOT NULL,
  ly_do                 text NOT NULL CHECK (ly_do = btrim(ly_do) AND octet_length(ly_do) > 0 AND octet_length(ly_do) <= 2000),
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, signal_id) REFERENCES governance_signals (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  UNIQUE (org_id, signal_id, created_by)
);

ALTER TABLE governance_signal_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_signal_acks FORCE ROW LEVEL SECURITY;

CREATE POLICY governance_signal_acks_tenant_isolation ON governance_signal_acks
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Như bảng trên.
CREATE POLICY governance_signal_acks_khach ON governance_signal_acks AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON governance_signal_acks TO app_api;
GRANT INSERT (org_id, signal_id, ly_do, created_by, created_by_session_id) ON governance_signal_acks TO app_api;

CREATE TRIGGER governance_signal_acks_kiem_danh_tinh
  BEFORE INSERT ON governance_signal_acks
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE governance_signal_acks ENABLE ALWAYS TRIGGER governance_signal_acks_kiem_danh_tinh;

CREATE TRIGGER governance_signal_acks_chi_ghi_them
  BEFORE UPDATE OR DELETE ON governance_signal_acks
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE governance_signal_acks ENABLE ALWAYS TRIGGER governance_signal_acks_chi_ghi_them;

CREATE TRIGGER governance_signal_acks_chan_truncate
  BEFORE TRUNCATE ON governance_signal_acks
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE governance_signal_acks ENABLE ALWAYS TRIGGER governance_signal_acks_chan_truncate;

-- Hàng tín hiệu: bằng chứng, độ tin cậy, giải thích và mốc tính do CSDL đặt. Tên trigger xếp SAU `_kiem_danh_tinh`.
CREATE OR REPLACE FUNCTION public.tin_hieu_kiem_ghi() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                  WHERE r.org_id = NEW.org_id AND r.id = NEW.rfq_id AND r.status = 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'Tin hieu chi ghi cho goi thau dang cho duyet (S3.6b1)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_goi_khong_cho_duyet';
  END IF;
  NEW.bang_chung := public.tin_hieu_chia_nho(NEW.org_id, NEW.rfq_id);
  IF NEW.bang_chung IS NULL THEN
    RAISE EXCEPTION 'Goi thau khong co tin hieu chia nho nao de ghi (S3.6b1)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_khong_co';
  END IF;
  NEW.do_tin_cay := 'XAC_DINH';
  NEW.giai_thich := pg_catalog.format(
    '%s gói cùng nhóm hàng nộp duyệt trong %s ngày tính tới lần nộp của gói này; mỗi gói dưới cận bậc %s mà tổng từ cận ấy trở lên.',
    pg_catalog.jsonb_array_length(NEW.bang_chung -> 'goi'), NEW.bang_chung ->> 'cua_so_ngay', NEW.bang_chung ->> 'can');
  NEW.tinh_luc := pg_catalog.clock_timestamp();
  RETURN NEW;
END
$ham$;

CREATE TRIGGER governance_signals_tinh
  BEFORE INSERT ON governance_signals
  FOR EACH ROW EXECUTE FUNCTION public.tin_hieu_kiem_ghi();
ALTER TABLE governance_signals ENABLE ALWAYS TRIGGER governance_signals_tinh;

-- ============================================================================================
-- (3) LUẬT NGƯỜI GHI NHẬN
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO` (`packages/identity/src/chot-kiem-soat.ts`). `p_bang_chung` là bằng chứng của tín hiệu
-- được ghi nhận: người gây ra đọc từ danh sách gói của CHÍNH nó, không từ một tập tính lại.
CREATE OR REPLACE FUNCTION public.tin_hieu_chot_nguoi_ghi_nhan(p_org uuid, p_bang_chung jsonb, p_nguoi uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF p_bang_chung IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1
               FROM public.rfq_packages r
              WHERE r.org_id = p_org
                AND r.id IN (SELECT (x #>> '{}')::uuid FROM pg_catalog.jsonb_array_elements(p_bang_chung -> 'goi') x)
                AND (r.created_by = p_nguoi OR r.submitted_by = p_nguoi)) THEN
    RETURN 'K10A_TU_GHI_NHAN';
  END IF;
  IF EXISTS (SELECT 1
               FROM public.org_procurement_policies p
              WHERE p.org_id = p_org
                AND p.id = (p_bang_chung ->> 'chinh_sach')::uuid
                AND p.created_by = p_nguoi) THEN
    RETURN 'K10A_TAC_GIA_CHINH_SACH';
  END IF;
  RETURN NULL;
END
$ham$;

-- Tên trigger xếp SAU `_kiem_danh_tinh`, nên `created_by` đã là người của phiên.
CREATE OR REPLACE FUNCTION public.tin_hieu_kiem_ghi_nhan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  s record;
  ly_do text;
BEGIN
  SELECT g.rfq_id, g.bang_chung INTO s
    FROM public.governance_signals g
   WHERE g.org_id = NEW.org_id AND g.id = NEW.signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay tin hieu de ghi nhan (S3.6b1)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                  WHERE r.org_id = NEW.org_id AND r.id = s.rfq_id AND r.status = 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'Chi ghi nhan tin hieu khi goi thau dang cho duyet (S3.6b1)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10_ghi_nhan_sai_trang_thai';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                    AND rp.permission_code = 'rfq.approve') THEN
    RAISE EXCEPTION 'Nguoi ghi nhan tin hieu chia nho phai giu rfq.approve (ADR-084)'
      USING ERRCODE = 'check_violation';
  END IF;
  ly_do := public.tin_hieu_chot_nguoi_ghi_nhan(NEW.org_id, s.bang_chung, NEW.created_by);
  IF ly_do = 'K10A_TU_GHI_NHAN' THEN
    RAISE EXCEPTION 'Nguoi tao hay nguoi nop mot goi trong bang chung khong ghi nhan duoc tin hieu (K10a)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10_nguoi_gay_ra_tu_ghi_nhan';
  END IF;
  IF ly_do = 'K10A_TAC_GIA_CHINH_SACH' THEN
    RAISE EXCEPTION 'Nguoi khai phien ban chinh sach cua goi khong ghi nhan duoc tin hieu (K10a)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10_tac_gia_chinh_sach_ghi_nhan';
  END IF;
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Nguoi nay khong ghi nhan duoc tin hieu (K10a): %', ly_do
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.tin_hieu_chia_nho(NEW.org_id, s.rfq_id) IS DISTINCT FROM s.bang_chung THEN
    RAISE EXCEPTION 'Bang chung cua tin hieu da doi — ghi nhan tin hieu hien tai (K10a)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10_bang_chung_da_doi';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER governance_signal_acks_kiem_nguoi
  BEFORE INSERT ON governance_signal_acks
  FOR EACH ROW EXECUTE FUNCTION public.tin_hieu_kiem_ghi_nhan();
ALTER TABLE governance_signal_acks ENABLE ALWAYS TRIGGER governance_signal_acks_kiem_nguoi;

-- ============================================================================================
-- (4) CHỐT K10a Ở CẠNH PENDING_APPROVAL→OPEN
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO`. Lần ghi nhận nào trỏ tới một tín hiệu có bằng chứng BẰNG kết quả hiện tại cũng đủ:
-- luật người đã kiểm lúc chèn nó, và bằng chứng — tập gói — là thứ luật ấy đọc.
CREATE OR REPLACE FUNCTION public.rfq_chot_tin_hieu(p_org uuid, p_rfq uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bc jsonb;
BEGIN
  bc := public.tin_hieu_chia_nho(p_org, p_rfq);
  IF bc IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1
               FROM public.governance_signals s
               JOIN public.governance_signal_acks a ON a.org_id = s.org_id AND a.signal_id = s.id
              WHERE s.org_id = p_org AND s.rfq_id = p_rfq AND s.bang_chung = bc) THEN
    RETURN NULL;
  END IF;
  RETURN 'TIN_HIEU_CHUA_GHI_NHAN';
END
$ham$;

CREATE OR REPLACE FUNCTION public.rfq_kiem_tin_hieu_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  ly_do := public.rfq_chot_tin_hieu(NEW.org_id, NEW.id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Goi thau chua mo duoc (K10a): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10_tin_hieu_chua_ghi_nhan';
  END IF;
  RETURN NEW;
END
$ham$;

-- `WHEN` đúng cạnh (ADR-082 ⒃): `app_unseal` sửa `rfq_packages` ở các cạnh mở thầu, và không có việc gì ở đây.
CREATE TRIGGER rfq_packages_kiem_tin_hieu_khi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'OPEN')
  EXECUTE FUNCTION public.rfq_kiem_tin_hieu_khi_mo();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_tin_hieu_khi_mo;

-- ==============================================================================================
-- 114_khai_bao_xung_dot — [S1.281 / S3.4a của spec S3] K9: KHAI BÁO XUNG ĐỘT LỢI ÍCH, CỔNG Ở BẢY CHỖ, CHỮ KÝ CỦA NGƯỜI CÓ
-- XUNG ĐỘT KHÔNG ĐẾM
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.5, §5 K9, §5.1 K9, §8.7, §9 (S3.4). ADR-082 ⒄,
-- ADR-084 ⑷, ADR-108, ADR-114, ADR-147 ⑺, ADR-155. Chủ dự án: *"triển khai luôn hạng mục S3.4"* (2026-10-07); vòng này chia hai
-- phần như S3.6b: **S3.4a** — lớp CSDL, tầng gói, route, K9 ở bảy cổng (migration này); **S3.4b** — màn, `gieo:demo --s3`, kịch
-- bản 41, lượt đi thử T4.
--
-- (1) MÃ QUYỀN `coi.declare` — khai báo là việc của NGƯỜI SẮP QUYẾT: mọi vai giữ một mã bị K9 chặn (`rfq.approve`,
--     `evaluation.perform`, `award.recommend`, `po.approve`, `supplier.qualify`) đều giữ nó; `DATA_STEWARD` không quyết gì trên
--     gói nên không giữ (ADR-084 ⑴: một mã mới khi hành vi cần tách người — ở đây là tách khỏi người chỉ đọc).
-- (2) BẢNG `coi_declarations`, CHỈ GHI THÊM: mỗi hàng một lời khai có chủ thể (dẫn xuất từ phiên, ADR-016), thời điểm, phiên,
--     và BĂM DANH SÁCH MỜI lúc khai (`rfq_bam_danh_sach`, `076`/`105` — cùng băm mà người duyệt ký, K4b). `KHONG_XUNG_DOT` chỉ có
--     hiệu lực khi băm ấy BẰNG băm hiện tại: khai *không xung đột* với một danh sách là chưa khai gì về một nhà cung cấp thêm sau
--     đó. `CO_XUNG_DOT` đòi `supplier_id` — một nhà cung cấp ĐÃ CÓ LỜI MỜI của gói — và là VĨNH VIỄN cho gói ấy: một hàng
--     `KHONG_XUNG_DOT` ghi sau bị trigger từ chối có tên (`k9_khong_go_duoc_xung_dot`) — một khai báo gỡ được là một lối đi
--     vòng (spec §4.5). Ghi chú tuỳ chọn, trần 2000 byte, lưu đã cắt. Người khai và chữ ký của người ấy dùng chung MỘT khoá tư vấn
--     (gói, người) — seed 9 — nên một `CO_XUNG_DOT` không chen được vào giữa lần hỏi và câu ghi của một chữ ký (ADR-082 ⒄).
-- (3) HAI HÀM VỊ TỪ (khuôn K1, mã là từ vựng của `CHOT_VAO_SO`):
--     · `coi_chot_hanh_dong(org, gói, người)` — tổ chức chưa bật ⇒ NULL (ADR-080); người đã khai `CO_XUNG_DOT` trên gói ⇒
--       `K9_CO_XUNG_DOT` ở MỌI bậc; bậc ghim không bật `khai_xung_dot` ⇒ NULL (gói không bậc ghim hay bậc vắng khoá coi như
--       ĐÒI — fail-closed như K5); có `KHONG_XUNG_DOT` mang băm hiện tại ⇒ NULL; có khai nhưng băm đã đổi ⇒ `K9_KHAI_BAO_LOI_THOI`
--       (không vào sổ — danh sách đổi dưới chân người khai, ADR-060); chưa khai gì ⇒ `K9_CHUA_KHAI_XUNG_DOT`.
--     · `coi_chot_xac_minh(org, nhà cung cấp, người)` — người đã khai `CO_XUNG_DOT` với nhà cung cấp ấy ở BẤT KỲ gói nào không
--       xác minh hay thu hồi xác minh của nó ⇒ `K9_XAC_MINH_NCC_XUNG_DOT` (ADR-082 ⒄: cổng ở xác minh).
-- (4) BẢY CỔNG, mỗi cổng một trigger BEFORE INSERT lấy khoá (gói, người) rồi hỏi (3) — trigger là lớp có thẩm quyền, từ chối mang
--     TÊN RÀNG BUỘC bằng chữ thường của mã, tầng gói bắt chính lỗi ấy và ghi `CONTROL_DENIED` ở giao dịch độc lập (ADR-108/114):
--     chữ ký mở gói (`rfq_approvals`), lượt chấm (`rfq_evaluations`), đề xuất và HUỶ trao thầu (`rfq_awards` ở `PROPOSED`,
--     `CANCELLED`), chữ ký duyệt trao thầu (`rfq_award_approvals`), xác minh nhà cung cấp (`supplier_verifications`), ghi nhận
--     tín hiệu (`governance_signal_acks`). KHÔNG ở `unseal_approvals`: mở thầu chỉ giải mã, không chọn ai thắng (§4.5).
-- (5) PHÉP ĐẾM CHỮ KÝ LOẠI NGƯỜI CÓ `CO_XUNG_DOT` (ADR-082 ⒄, ADR-147 ⑺): bốn vế *còn hiệu lực* của `107` tách ra
--     `rfq_chu_ky_khop_bam`; `rfq_chu_ky_con_hieu_luc` = khớp băm TRỪ người có `CO_XUNG_DOT` — K4b (phép đếm thứ ba) và K5 đổi
--     cùng nhau, không sửa chữ nào ở hai hàm ấy. Khai `CO_XUNG_DOT` SAU khi đã ký thì chữ ký thôi đếm. Hàm vị từ
--     `rfq_chot_chu_ky_xung_dot(org, gói)` nói lời có tên khi CHỈ K9 làm thiếu chữ ký (`K9_CHU_KY_CO_XUNG_DOT`); thiếu vì lý do
--     khác thì K4b nói, không hàng sổ. Ở trao thầu: hàng `APPROVED` đòi ít nhất một chữ ký duyệt của người KHÔNG có `CO_XUNG_DOT`
--     — độc lập với `CHU_KY_CAN` của `061`/`094`, S3.5 gộp vào `award_so_chu_ky_can`.
-- (6) TRIGGER K9 ở cạnh `PENDING_APPROVAL→OPEN`, tên xếp TRƯỚC K4b (`rfq_packages_kiem_danh_sach_khi_mo`) để lời có tên nói trước.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: cổng ở THẨM ĐỊNH đầy đủ (K8b, S3.7); màn khai báo, `gieo:demo`, kịch bản 41 (S3.4b); khai báo
-- theo từng nhà cung cấp lúc mời (spec §10, không chốt); lớp bằng chứng (S3.9).
--
-- Mọi hàm và trigger mới hay đổi thân ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) MÃ QUYỀN
-- ============================================================================================
INSERT INTO permissions (code, description) VALUES
  ('coi.declare', 'Khai bao xung dot loi ich tren mot goi thau — viec cua nguoi sap ky, cham, de xuat, duyet hay xac minh (K9, ADR-155)');

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('BUYER', 'coi.declare'),
  ('DIRECTOR', 'coi.declare'),
  ('FINANCE', 'coi.declare'),
  ('PROCUREMENT_MANAGER', 'coi.declare'),
  ('REQUESTER', 'coi.declare'),
  ('TECHNICAL', 'coi.declare');

-- ============================================================================================
-- (2) BẢNG
-- ============================================================================================
CREATE TABLE coi_declarations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  rfq_id                uuid NOT NULL,
  -- Người khai — DẪN XUẤT từ phiên (ADR-016): K9 so cột này với người ký, người chấm, người đề xuất.
  user_id               uuid NOT NULL,
  session_id            uuid NOT NULL,
  trang_thai            text NOT NULL CHECK (trang_thai IN ('KHONG_XUNG_DOT', 'CO_XUNG_DOT')),
  -- Nhà cung cấp mà người khai có xung đột — bắt buộc ở `CO_XUNG_DOT`, trống ở `KHONG_XUNG_DOT`.
  supplier_id           uuid,
  ghi_chu               text CHECK (ghi_chu IS NULL OR (octet_length(ghi_chu) > 0 AND octet_length(ghi_chu) <= 2000)),
  -- Băm danh sách mời lúc khai — do trigger đặt, ngoài GRANT; `KHONG_XUNG_DOT` chỉ hiệu lực khi nó bằng băm hiện tại.
  danh_sach_bam         bytea NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, user_id) REFERENCES users (org_id, id),
  FOREIGN KEY (org_id, supplier_id) REFERENCES suppliers (org_id, id),
  CONSTRAINT coi_declarations_hinh_dang CHECK (
    (trang_thai = 'CO_XUNG_DOT' AND supplier_id IS NOT NULL)
    OR (trang_thai = 'KHONG_XUNG_DOT' AND supplier_id IS NULL)),
  -- Ghi chú LƯU ĐÃ CẮT — cùng tập khoảng trắng của `String.prototype.trim` như giải trình ngoại lệ (`105`).
  CONSTRAINT coi_declarations_ghi_chu_da_cat CHECK (
    ghi_chu IS NULL
    OR (ghi_chu !~ '^[\t\n\v\f\r \xa0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]'
        AND ghi_chu !~ '[\t\n\v\f\r \xa0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]$'))
);

CREATE INDEX coi_declarations_theo_goi_nguoi ON coi_declarations (org_id, rfq_id, user_id);

ALTER TABLE coi_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE coi_declarations FORCE ROW LEVEL SECURITY;

CREATE POLICY coi_declarations_tenant_isolation ON coi_declarations
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: ai của bên mua khai gì về ai là việc nội bộ (K11).
CREATE POLICY coi_declarations_khach ON coi_declarations AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `id`, `danh_sach_bam`, `created_at` KHÔNG được cấp (INV-H14; băm do trigger đặt). KHÔNG `UPDATE`, KHÔNG `DELETE`: chỉ ghi thêm.
-- `app_unseal` không đụng bảng này.
GRANT SELECT ON coi_declarations TO app_api;
GRANT INSERT (org_id, rfq_id, user_id, session_id, trang_thai, supplier_id, ghi_chu) ON coi_declarations TO app_api;

-- [ADR-016] Người khai là DẪN XUẤT từ phiên — K9 so cột này với người hành động, nên nó phải thật.
CREATE TRIGGER coi_declarations_kiem_danh_tinh
  BEFORE INSERT ON coi_declarations
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'user_id', 'session_id');
ALTER TABLE coi_declarations ENABLE ALWAYS TRIGGER coi_declarations_kiem_danh_tinh;

CREATE TRIGGER coi_declarations_chi_ghi_them
  BEFORE UPDATE OR DELETE ON coi_declarations
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE coi_declarations ENABLE ALWAYS TRIGGER coi_declarations_chi_ghi_them;

CREATE TRIGGER coi_declarations_chan_truncate
  BEFORE TRUNCATE ON coi_declarations
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE coi_declarations ENABLE ALWAYS TRIGGER coi_declarations_chan_truncate;

-- ============================================================================================
-- (2b) KHOÁ TƯ VẤN (GÓI, NGƯỜI) — seed 9; khai báo và mọi cổng K9 cùng lấy
-- ============================================================================================
-- Seed đang dùng: 0 sổ, 1 trao thầu, 2 chính sách, 3 dữ liệu nền, 7 xác minh, 8 nhóm hàng. Khoá này đứng SAU khoá trao thầu (1)
-- và khoá chính sách (2) ở mọi đường — trigger của `rfq_awards` lấy 1 rồi mới tới trigger này (thứ tự tên) — và không đường nào
-- lấy 9 rồi lấy 1 hay 2, nên không vòng khoá mới.
CREATE OR REPLACE FUNCTION public.coi_khoa_goi_nguoi(p_rfq uuid, p_nguoi uuid) RETURNS void
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_rfq::pg_catalog.text || '|' || p_nguoi::pg_catalog.text, 9))
$ham$;

-- ============================================================================================
-- (2c) LUẬT GHI CỦA KHAI BÁO — tên trigger xếp SAU `_kiem_danh_tinh` (`kiem_k` > `kiem_d`) nên `user_id` đã là người của phiên
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.coi_kiem_khai_bao() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Chi to chuc da bat S3 moi khai bao xung dot loi ich (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.coi_khoa_goi_nguoi(NEW.rfq_id, NEW.user_id);
  IF NOT EXISTS (SELECT 1 FROM public.rfq_packages p WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id) THEN
    RAISE EXCEPTION 'Khong tim thay goi thau de khai bao (K9)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.danh_sach_bam := public.rfq_bam_danh_sach(NEW.rfq_id);
  IF NEW.trang_thai = 'CO_XUNG_DOT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.rfq_invitations i
                    WHERE i.org_id = NEW.org_id AND i.rfq_id = NEW.rfq_id AND i.supplier_id = NEW.supplier_id) THEN
      RAISE EXCEPTION 'Nha cung cap khai xung dot phai co loi moi cua goi thau nay (K9)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.coi_declarations d
              WHERE d.org_id = NEW.org_id AND d.rfq_id = NEW.rfq_id AND d.user_id = NEW.user_id
                AND d.trang_thai = 'CO_XUNG_DOT') THEN
    RAISE EXCEPTION 'Da khai CO xung dot tren goi thau nay — khong go duoc (K9)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k9_khong_go_duoc_xung_dot';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER coi_declarations_kiem_khai_bao
  BEFORE INSERT ON coi_declarations
  FOR EACH ROW EXECUTE FUNCTION public.coi_kiem_khai_bao();
ALTER TABLE coi_declarations ENABLE ALWAYS TRIGGER coi_declarations_kiem_khai_bao;

-- ============================================================================================
-- (3) HAI HÀM VỊ TỪ — mã trả về là TỪ VỰNG của `CHOT_VAO_SO` (`@trustprocure/identity`)
-- ============================================================================================
-- Không SECURITY DEFINER (hardening §C): chạy dưới quyền người gọi, RLS áp.
CREATE OR REPLACE FUNCTION public.coi_chot_hanh_dong(p_org uuid, p_rfq uuid, p_nguoi uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bac jsonb;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.coi_declarations d
              WHERE d.org_id = p_org AND d.rfq_id = p_rfq AND d.user_id = p_nguoi AND d.trang_thai = 'CO_XUNG_DOT') THEN
    RETURN 'K9_CO_XUNG_DOT';
  END IF;
  bac := public.rfq_bac_ghim(p_org, p_rfq);
  IF NOT coalesce((bac ->> 'khai_xung_dot')::boolean, true) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.coi_declarations d
              WHERE d.org_id = p_org AND d.rfq_id = p_rfq AND d.user_id = p_nguoi AND d.trang_thai = 'KHONG_XUNG_DOT'
                AND d.danh_sach_bam = public.rfq_bam_danh_sach(p_rfq)) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.coi_declarations d
              WHERE d.org_id = p_org AND d.rfq_id = p_rfq AND d.user_id = p_nguoi) THEN
    RETURN 'K9_KHAI_BAO_LOI_THOI';
  END IF;
  RETURN 'K9_CHUA_KHAI_XUNG_DOT';
END
$ham$;

CREATE OR REPLACE FUNCTION public.coi_chot_xac_minh(p_org uuid, p_ncc uuid, p_nguoi uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.coi_declarations d
              WHERE d.org_id = p_org AND d.user_id = p_nguoi AND d.trang_thai = 'CO_XUNG_DOT' AND d.supplier_id = p_ncc) THEN
    RETURN 'K9_XAC_MINH_NCC_XUNG_DOT';
  END IF;
  RETURN NULL;
END
$ham$;

-- ============================================================================================
-- (4) BẢY CỔNG — trigger lấy khoá (gói, người) rồi hỏi hàm vị từ; tên ràng buộc = mã viết thường
-- ============================================================================================
-- Chữ ký mở gói. Tên xếp sau `rfq_approvals_kiem_nguoi_duyet` (đã đòi PENDING_APPROVAL và phiên của chính người ký).
CREATE OR REPLACE FUNCTION public.coi_kiem_chu_ky_mo_goi() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  PERFORM public.coi_khoa_goi_nguoi(NEW.rfq_id, NEW.approver_user_id);
  ly_do := public.coi_chot_hanh_dong(NEW.org_id, NEW.rfq_id, NEW.approver_user_id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chua ky duyet goi thau duoc (K9): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_approvals_kiem_xung_dot
  BEFORE INSERT ON rfq_approvals
  FOR EACH ROW EXECUTE FUNCTION public.coi_kiem_chu_ky_mo_goi();
ALTER TABLE rfq_approvals ENABLE ALWAYS TRIGGER rfq_approvals_kiem_xung_dot;

-- Lượt chấm. Lượt chấm tất định (J1/J2) nên cổng này giữ lại mà không chịu lực — spec §4.5.
CREATE OR REPLACE FUNCTION public.coi_kiem_luot_cham() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  PERFORM public.coi_khoa_goi_nguoi(NEW.rfq_id, NEW.created_by);
  ly_do := public.coi_chot_hanh_dong(NEW.org_id, NEW.rfq_id, NEW.created_by);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chua cham duoc (K9): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_evaluations_kiem_xung_dot
  BEFORE INSERT ON rfq_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.coi_kiem_luot_cham();
ALTER TABLE rfq_evaluations ENABLE ALWAYS TRIGGER rfq_evaluations_kiem_xung_dot;

-- Đề xuất và huỷ trao thầu: người hành động. Hàng `APPROVED`: ít nhất một chữ ký duyệt của người KHÔNG có `CO_XUNG_DOT` — (5).
-- Tên xếp sau `rfq_awards_kiem_mot_award_song`, nên hàng mới nhất đã được J7 kiểm là `PROPOSED` khi tới đây.
CREATE OR REPLACE FUNCTION public.coi_kiem_trao_thau() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
  truoc_id uuid;
BEGIN
  IF NEW.status IN ('PROPOSED', 'CANCELLED') THEN
    PERFORM public.coi_khoa_goi_nguoi(NEW.rfq_id, NEW.acted_by);
    ly_do := public.coi_chot_hanh_dong(NEW.org_id, NEW.rfq_id, NEW.acted_by);
    IF ly_do IS NOT NULL THEN
      RAISE EXCEPTION 'Chua % trao thau duoc (K9): %', CASE WHEN NEW.status = 'PROPOSED' THEN 'de xuat' ELSE 'huy' END, ly_do
        USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'APPROVED' OR NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  SELECT a.id INTO truoc_id
    FROM public.rfq_awards a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.rfq_id
   ORDER BY a.acted_at DESC, a.id DESC
   LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.rfq_award_approvals ap WHERE ap.org_id = NEW.org_id AND ap.award_id = truoc_id)
     AND NOT EXISTS (SELECT 1 FROM public.rfq_award_approvals ap
                      WHERE ap.org_id = NEW.org_id AND ap.award_id = truoc_id
                        AND NOT EXISTS (SELECT 1 FROM public.coi_declarations d
                                         WHERE d.org_id = ap.org_id AND d.rfq_id = NEW.rfq_id
                                           AND d.user_id = ap.approver_user_id AND d.trang_thai = 'CO_XUNG_DOT')) THEN
    RAISE EXCEPTION 'Moi chu ky duyet trao thau deu cua nguoi da khai CO xung dot (K9)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k9_chu_ky_co_xung_dot';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_awards_kiem_xung_dot
  BEFORE INSERT ON rfq_awards
  FOR EACH ROW EXECUTE FUNCTION public.coi_kiem_trao_thau();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_xung_dot;

-- Chữ ký duyệt trao thầu — gói đọc qua award. Tên xếp sau `rfq_award_approvals_kiem_nguoi_duyet` (award phải đang `PROPOSED`).
CREATE OR REPLACE FUNCTION public.coi_kiem_duyet_trao_thau() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  goi uuid;
  ly_do text;
BEGIN
  SELECT a.rfq_id INTO goi FROM public.rfq_awards a WHERE a.org_id = NEW.org_id AND a.id = NEW.award_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay de xuat trao thau cua chu ky (K9)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  PERFORM public.coi_khoa_goi_nguoi(goi, NEW.approver_user_id);
  ly_do := public.coi_chot_hanh_dong(NEW.org_id, goi, NEW.approver_user_id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chua ky duyet trao thau duoc (K9): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_award_approvals_kiem_xung_dot
  BEFORE INSERT ON rfq_award_approvals
  FOR EACH ROW EXECUTE FUNCTION public.coi_kiem_duyet_trao_thau();
ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_kiem_xung_dot;

-- Xác minh (và thu hồi xác minh) nhà cung cấp. Tên xếp sau `supplier_verifications_kiem_xac_minh` (K8a). Không khoá (gói, người):
-- xung đột ở đây theo (nhà cung cấp, người), đọc mọi gói.
CREATE OR REPLACE FUNCTION public.coi_kiem_xac_minh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  ly_do := public.coi_chot_xac_minh(NEW.org_id, NEW.supplier_id, NEW.created_by);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chua xac minh nha cung cap duoc (K9): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER supplier_verifications_kiem_xung_dot
  BEFORE INSERT ON supplier_verifications
  FOR EACH ROW EXECUTE FUNCTION public.coi_kiem_xac_minh();
ALTER TABLE supplier_verifications ENABLE ALWAYS TRIGGER supplier_verifications_kiem_xung_dot;

-- Ghi nhận tín hiệu — gói đọc qua tín hiệu. Tên xếp sau `governance_signal_acks_kiem_nguoi` (K10a).
CREATE OR REPLACE FUNCTION public.coi_kiem_ghi_nhan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  goi uuid;
  ly_do text;
BEGIN
  SELECT s.rfq_id INTO goi FROM public.governance_signals s WHERE s.org_id = NEW.org_id AND s.id = NEW.signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay tin hieu cua lan ghi nhan (K9)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  PERFORM public.coi_khoa_goi_nguoi(goi, NEW.created_by);
  ly_do := public.coi_chot_hanh_dong(NEW.org_id, goi, NEW.created_by);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chua ghi nhan tin hieu duoc (K9): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER governance_signal_acks_kiem_xung_dot
  BEFORE INSERT ON governance_signal_acks
  FOR EACH ROW EXECUTE FUNCTION public.coi_kiem_ghi_nhan();
ALTER TABLE governance_signal_acks ENABLE ALWAYS TRIGGER governance_signal_acks_kiem_xung_dot;

-- ============================================================================================
-- (5) PHÉP ĐẾM CHỮ KÝ LOẠI NGƯỜI CÓ `CO_XUNG_DOT`
-- ============================================================================================
-- Bốn vế *còn hiệu lực* của `107` (5), nguyên văn, dưới tên mới.
CREATE OR REPLACE FUNCTION public.rfq_chu_ky_khop_bam(p_org uuid, p_rfq uuid) RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT DISTINCT a.approver_user_id
    FROM public.rfq_approvals a
   WHERE a.org_id = p_org AND a.rfq_id = p_rfq
     AND a.approved_content_hash = public.rfq_bam_noi_dung(p_rfq)
     AND a.approved_list_hash = public.rfq_bam_danh_sach(p_rfq)
     AND a.approved_budget_hash = public.rfq_bam_ngan_sach(p_rfq)
     AND a.lan_nop_da_xem IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rfq_tra_ve r
                      WHERE r.org_id = a.org_id AND r.rfq_id = a.rfq_id
                        AND r.returned_by = a.approver_user_id AND r.lan_nop >= a.lan_nop_da_xem)
$ham$;

-- K4b (phép đếm thứ ba) và K5 đọc hàm này — chữ của hai hàm ấy không đổi (ADR-147 ⑺).
CREATE OR REPLACE FUNCTION public.rfq_chu_ky_con_hieu_luc(p_org uuid, p_rfq uuid) RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT k.n
    FROM public.rfq_chu_ky_khop_bam(p_org, p_rfq) k(n)
   WHERE NOT EXISTS (SELECT 1 FROM public.coi_declarations d
                      WHERE d.org_id = p_org AND d.rfq_id = p_rfq AND d.user_id = k.n AND d.trang_thai = 'CO_XUNG_DOT')
$ham$;

-- Hàm vị từ ở cạnh mở gói: nói lời có tên CHỈ KHI K9 làm thiếu chữ ký.
CREATE OR REPLACE FUNCTION public.rfq_chot_chu_ky_xung_dot(p_org uuid, p_rfq uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  can integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  SELECT CASE WHEN r.requires_dual_approval THEN 2 ELSE 1 END INTO can
    FROM public.rfq_packages r
   WHERE r.org_id = p_org AND r.id = p_rfq AND r.status = 'PENDING_APPROVAL';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM public.rfq_chu_ky_con_hieu_luc(p_org, p_rfq)) >= can THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM public.rfq_chu_ky_khop_bam(p_org, p_rfq)) < can THEN
    RETURN NULL;
  END IF;
  RETURN 'K9_CHU_KY_CO_XUNG_DOT';
END
$ham$;

-- ============================================================================================
-- (6) CẠNH PENDING_APPROVAL→OPEN — tên xếp TRƯỚC `rfq_packages_kiem_danh_sach_khi_mo` (K4b)
-- ============================================================================================
-- `WHEN` đúng cạnh (ADR-082 ⒃): `app_unseal` sửa `rfq_packages` ở các cạnh mở thầu, và không có việc gì ở đây.
CREATE OR REPLACE FUNCTION public.rfq_kiem_chu_ky_xung_dot_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  ly_do := public.rfq_chot_chu_ky_xung_dot(NEW.org_id, NEW.id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Goi thau chua mo duoc (K9): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_chu_ky_xung_dot_khi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'OPEN')
  EXECUTE FUNCTION public.rfq_kiem_chu_ky_xung_dot_khi_mo();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_chu_ky_xung_dot_khi_mo;

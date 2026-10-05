-- ==============================================================================================
-- 107_canh_tranh_toi_thieu — [S1.269 / S3.3c2 của spec S3] CẠNH TRANH TỐI THIỂU: K2 Ở CẠNH NỘP DUYỆT, K5 Ở CẠNH MỞ GÓI
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §2.4 ⑹ ⑺, §4.4, §5.1 (K2, K5), §8.10, §9
-- (S3.3). ADR-082 ⑹ ⑽ ⑿, ADR-084 ⑷, ADR-121, ADR-145, ADR-147. Chủ dự án chốt ngày 2026-10-04: luật đếm của bản hình dạng
-- (header của `packages/test-support/src/nha-cung-cap-dem-duoc.ts`, S3.3c1); ngoại lệ khớp CHẶT với danh sách; số điện thoại so
-- chín chữ số cuối; *người chọn danh sách* gồm người tạo gói, MỌI người mời VÀ MỌI người thu hồi (đọc mọi hàng); người xác minh
-- cũng không thuộc tập ấy; chốt chỉ-READ COMMITTED ở cạnh nộp duyệt áp MỌI tổ chức; K5 nhường lời từ chối cho K4b khi chưa đủ
-- chữ ký; gộp nhóm theo MỌI người liên hệ của nhà cung cấp.
--
-- (1) `rfq_bac_ghim(org, gói)` — phần tử bậc mà ngân sách của gói ghim (`tier_tu_so_tien` trên phiên bản `policy_id`). Gói KHÔNG
--     bậc ghim — không ngân sách, hay bậc NULL: gói rời DRAFT trước lần bật (dữ liệu trước `097`) — trả NULL, và mỗi chốt nói nó
--     làm gì với NULL ấy; bậc đã lưu mà không có trong phiên bản ghim là dữ liệu hỏng ⇒ NÉM (ADR-082 ⑽).
-- (2) `rfq_dem_ncc_canh_tranh(org, gói)` — số NHÓM nhà cung cấp đếm được trên danh sách mời còn sống. Một lời mời đếm được khi:
--     hồ sơ và MỌI người liên hệ của nhà cung cấp không do *người chọn danh sách* dựng; có MST; xác minh còn hiệu lực (`082`,
--     câu hỏi duy nhất `ncc_xac_minh_con_hieu_luc`); người làm hàng xác minh mới nhất không là người khai phiên bản ngân sách
--     ghim (§2.4 ⑺) và không thuộc *người chọn danh sách*; người liên hệ được mời đang ACTIVE và có số điện thoại (OTP đi kênh
--     khác link). Hai lời mời chung MST gốc (mười chữ số đầu — mã chi nhánh `-NNN` gộp về gốc), chung một email hay chung chín
--     chữ số cuối điện thoại của BẤT KỲ người liên hệ nào của hai nhà cung cấp thì cùng nhóm, bắc cầu. Nhóm dựng trên MỌI lời
--     mời còn sống, kể cả lời mời không đếm được — bắc cầu qua nó chỉ làm đếm thiếu, không đếm thừa. Một hàng lời mời không rõ
--     người mời hay người thu hồi (hàng có trước `013`) ⇒ 0: không biết ai chọn thì không biết ai bị loại.
-- (3) `rfq_chot_canh_tranh(org, gói)` — hàm vị từ của K2 (khuôn K1): gói không bậc ghim thì lời từ chối là của K1 (`THIEU_NGAN_SACH`,
--     `BAC_LECH_HAM_PHAN_BAC` — tầng gói hỏi K1 trước, trigger K1 xếp trước), K2 không nói thay; bậc đấu thầu chính thức không bao giờ qua; đủ
--     `so_ncc_toi_thieu` nhóm thì qua; thiếu thì chỉ một ngoại lệ còn sống ĐÚNG loại cứu — một lời mời còn sống ⇒
--     `SINGLE_SOURCE`, từ hai ⇒ `LIMITED_COMPETITION`; danh sách rỗng không qua; `ROTATION` là của K3 (S3.3d).
-- (4) TRIGGER K2 ở cạnh `DRAFT→PENDING_APPROVAL`, tên xếp SAU K1 và nhóm hàng (trigger BEFORE chạy theo thứ tự tên): khoá tư vấn
--     chia sẻ và `submitted_at` của K1 đã đặt. Đứng TRƯỚC câu hỏi *đã bật*: giao dịch phải ở READ COMMITTED — trigger chạy sau
--     khi câu UPDATE lấy khoá hàng gói, tức sau mọi `FOR SHARE` của trigger lời mời (`076`) và ngoại lệ (`105`); dưới READ
--     COMMITTED câu gọi hàm vị từ lấy ảnh chụp MỚI và thấy lần rút ngoại lệ hay thu hồi lời mời vừa commit. Dưới REPEATABLE
--     READ ảnh chụp là của đầu giao dịch: nó đếm một ngoại lệ đã rút (L5 của §S1.265), và — vì câu hỏi *đã bật* cũng đọc ảnh chụp
--     ấy — một câu nộp mở trước lần ký bật S3 thoát cả K1 lẫn K2 (khoản 286 ⑴). Chặn ở đây chặn luôn K1: cùng một câu UPDATE.
-- (5) `rfq_chu_ky_con_hieu_luc(org, gói)` — người ký có chữ ký CÒN HIỆU LỰC: bốn vế của phép đếm thứ ba ở `087` (băm nội dung,
--     băm danh sách, băm ngân sách hiện tại; lần nộp đã xem có, người ký chưa trả gói về từ lần ấy). K4b đếm nó, K5 đọc nó —
--     một vị từ, hai chỗ dùng: khi K9 loại người khai `CO_XUNG_DOT` khỏi phép đếm chữ ký, hai chốt đổi cùng nhau.
-- (6) `rfq_chot_chu_ky_doc_lap(org, gói)` — hàm vị từ của K5: khi bậc bật `ky_danh_sach_moi` HOẶC gói có ngoại lệ còn sống, và
--     số chữ ký còn hiệu lực đã đủ (một, hay hai nếu cấp kép), phải có ít nhất một người ký còn hiệu lực KHÔNG thuộc
--     `rfq_tap_loai_tru` (ADR-121, một tập một nơi). Gói không bậc ghim, hay bậc vắng khoá `ky_danh_sach_moi` (bậc đấu thầu chính
--     thức), coi như bậc ĐÒI ký danh sách — fail-closed, không NÉM: gói chờ duyệt có từ trước `097` vẫn mở được bằng một chữ ký
--     độc lập. Chưa đủ chữ ký thì cho qua để K4b nói: bấm mở
--     sớm là đi sai thứ tự, không phải lách chốt (ADR-060). Không cần chốt READ COMMITTED: ở PENDING_APPROVAL danh sách, ngoại
--     lệ và ngân sách đứng yên, lời duyệt chỉ chèn thêm — ảnh chụp cũ chỉ có thể THIẾU chữ ký, không thừa.
-- (7) TRIGGER K5 ở cạnh `PENDING_APPROVAL→OPEN`; `rfq_kiem_chu_ky_danh_sach_khi_mo` (`076`, thân `087`) đếm phép thứ ba qua (5).
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: K2b — hậu kiểm số báo giá lúc trao — và K5b — kiểm lại K2/K5 ở bậc cao hơn lúc trao (S3.5); K3
-- (S3.3d); màn, kịch bản 41, lượt đi thử (S3.3e). Không khối chặn deploy cho gói đang chờ duyệt ở tổ chức đã bật: dưới vai deploy
-- mà RLS áp, câu đối chiếu thấy 0 hàng (`049`, hồ sơ N3) — một khối luôn qua là một lời khai giả; ADR-147 ghi giới hạn.
--
-- Mọi hàm và trigger mới hay đổi thân ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) BẬC MÀ GÓI GHIM
-- ============================================================================================
-- Không SECURITY DEFINER (hardening §C): chạy dưới quyền người gọi, RLS áp.
CREATE OR REPLACE FUNCTION public.rfq_bac_ghim(p_org uuid, p_rfq uuid) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bac_luu numeric;
  bac jsonb;
BEGIN
  SELECT b.tier_tu_so_tien INTO bac_luu
    FROM public.rfq_budgets b
   WHERE b.org_id = p_org AND b.rfq_id = p_rfq;
  IF NOT FOUND OR bac_luu IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e INTO bac
    FROM public.rfq_budgets b
    JOIN public.org_procurement_policies p ON p.org_id = b.org_id AND p.id = b.policy_id,
         jsonb_array_elements(p.tiers) e
   WHERE b.org_id = p_org AND b.rfq_id = p_rfq
     AND (e ->> 'tu_so_tien')::numeric = bac_luu;
  IF bac IS NULL THEN
    RAISE EXCEPTION 'Bac da luu cua goi khong co trong phien ban ngan sach ghim — ham theo bac khong tra loi duoc (ADR-082 (10))'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN bac;
END
$ham$;

-- ============================================================================================
-- (2) SỐ NHÓM NHÀ CUNG CẤP ĐẾM ĐƯỢC
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_dem_ncc_canh_tranh(p_org uuid, p_rfq uuid) RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  tac_gia uuid;
  so integer;
BEGIN
  SELECT r.created_by INTO nguoi_tao
    FROM public.rfq_packages r
   WHERE r.org_id = p_org AND r.id = p_rfq;
  IF nguoi_tao IS NULL
     OR EXISTS (SELECT 1 FROM public.rfq_invitations i
                 WHERE i.org_id = p_org AND i.rfq_id = p_rfq
                   AND (i.invited_by IS NULL OR (i.revoked_at IS NOT NULL AND i.revoked_by IS NULL))) THEN
    RETURN 0;
  END IF;
  SELECT p.created_by INTO tac_gia
    FROM public.rfq_budgets b
    JOIN public.org_procurement_policies p ON p.org_id = b.org_id AND p.id = b.policy_id
   WHERE b.org_id = p_org AND b.rfq_id = p_rfq;

  WITH RECURSIVE
  chon AS (
    SELECT nguoi_tao AS n
    UNION
    SELECT i.invited_by FROM public.rfq_invitations i WHERE i.org_id = p_org AND i.rfq_id = p_rfq
    UNION
    SELECT i.revoked_by FROM public.rfq_invitations i
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_by IS NOT NULL
  ),
  nut AS (
    SELECT i.id, i.supplier_id, left(s.tax_code, 10) AS mst_goc,
           (s.created_by IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM chon WHERE chon.n = s.created_by)
            AND NOT EXISTS (SELECT 1 FROM public.supplier_contacts k
                             WHERE k.org_id = s.org_id AND k.supplier_id = s.id
                               AND (k.created_by IS NULL OR EXISTS (SELECT 1 FROM chon WHERE chon.n = k.created_by)))
            AND s.tax_code IS NOT NULL
            AND c.status = 'ACTIVE' AND c.phone IS NOT NULL
            AND public.ncc_xac_minh_con_hieu_luc(p_org, s.id)
            AND EXISTS (SELECT 1
                          FROM (SELECT v.created_by FROM public.supplier_verifications v
                                 WHERE v.org_id = p_org AND v.supplier_id = s.id
                                 ORDER BY v.thu_tu DESC
                                 LIMIT 1) m
                         WHERE m.created_by IS NOT NULL
                           AND m.created_by IS DISTINCT FROM tac_gia
                           AND NOT EXISTS (SELECT 1 FROM chon WHERE chon.n = m.created_by))) AS dem_duoc
      FROM public.rfq_invitations i
      JOIN public.suppliers s ON s.org_id = i.org_id AND s.id = i.supplier_id
      JOIN public.supplier_contacts c ON c.org_id = i.org_id AND c.id = i.contact_id
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_at IS NULL
  ),
  dich AS (
    SELECT n.id, 'M|' || n.mst_goc AS d FROM nut n WHERE n.mst_goc IS NOT NULL
    UNION
    SELECT n.id, 'E|' || k.email
      FROM nut n JOIN public.supplier_contacts k ON k.org_id = p_org AND k.supplier_id = n.supplier_id
    UNION
    SELECT n.id, 'P|' || right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 9)
      FROM nut n JOIN public.supplier_contacts k ON k.org_id = p_org AND k.supplier_id = n.supplier_id
     WHERE k.phone IS NOT NULL
  ),
  canh AS (
    SELECT DISTINCT a.id AS tu, b.id AS den FROM dich a JOIN dich b ON b.d = a.d
  ),
  toi (goc, nut) AS (
    SELECT n.id, n.id FROM nut n
    UNION
    SELECT t.goc, c.den FROM toi t JOIN canh c ON c.tu = t.nut
  ),
  nhom AS (
    SELECT t.nut, min(t.goc::text) AS dai_dien FROM toi t GROUP BY t.nut
  )
  SELECT count(DISTINCT g.dai_dien)::integer INTO so
    FROM nhom g JOIN nut n ON n.id = g.nut
   WHERE n.dem_duoc;
  RETURN so;
END
$ham$;

-- ============================================================================================
-- (3) K2 — HÀM VỊ TỪ CỦA CHỐT
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO` (`@trustprocure/identity`).
CREATE OR REPLACE FUNCTION public.rfq_chot_canh_tranh(p_org uuid, p_rfq uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bac jsonb;
  nguong integer;
  so_moi integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                  WHERE r.org_id = p_org AND r.id = p_rfq AND r.status = 'DRAFT') THEN
    RETURN NULL;
  END IF;
  bac := public.rfq_bac_ghim(p_org, p_rfq);
  IF bac IS NULL THEN
    RETURN NULL;
  END IF;
  IF (bac ->> 'dau_thau_chinh_thuc')::boolean IS NOT FALSE THEN
    RETURN 'K2_DAU_THAU_CHINH_THUC';
  END IF;
  nguong := (bac ->> 'so_ncc_toi_thieu')::integer;
  IF nguong IS NULL THEN
    RAISE EXCEPTION 'Bac ghim thieu so_ncc_toi_thieu — ham theo bac khong tra loi duoc (K2, ADR-082 (10))'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.rfq_dem_ncc_canh_tranh(p_org, p_rfq) >= nguong THEN
    RETURN NULL;
  END IF;
  SELECT count(*)::integer INTO so_moi
    FROM public.rfq_invitations i
   WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_at IS NULL;
  IF so_moi >= 1
     AND EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions e
                  WHERE e.org_id = p_org AND e.rfq_id = p_rfq AND e.hanh_dong = 'LAP'
                    AND e.loai = CASE WHEN so_moi = 1 THEN 'SINGLE_SOURCE' ELSE 'LIMITED_COMPETITION' END
                    AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                                     WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)) THEN
    RETURN NULL;
  END IF;
  RETURN 'K2_THIEU_CANH_TRANH';
END
$ham$;

-- ============================================================================================
-- (4) CẠNH DRAFT→PENDING_APPROVAL
-- ============================================================================================
-- `WHEN` đúng cạnh (ADR-082 ⒃). Tên xếp sau `rfq_packages_kiem_nhom_hang_khi_nop`.
CREATE OR REPLACE FUNCTION public.rfq_kiem_so_ncc_khi_nop() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Nop duyet chi nhan duoi READ COMMITTED (giao dich dang o %): anh chup cu khong thay lan rut ngoai le, thu hoi loi moi hay lan bat S3 vua commit (K2)',
      pg_catalog.current_setting('transaction_isolation') USING ERRCODE = 'check_violation';
  END IF;
  ly_do := public.rfq_chot_canh_tranh(NEW.org_id, NEW.id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Goi thau chua roi DRAFT duoc (K2): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k2_canh_tranh_toi_thieu';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_so_ncc_khi_nop
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL')
  EXECUTE FUNCTION public.rfq_kiem_so_ncc_khi_nop();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_so_ncc_khi_nop;

-- ============================================================================================
-- (5) NGƯỜI KÝ CÓ CHỮ KÝ CÒN HIỆU LỰC — MỘT VỊ TỪ CHO K4b VÀ K5
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_chu_ky_con_hieu_luc(p_org uuid, p_rfq uuid) RETURNS SETOF uuid
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

-- Thân `087` (5): hai phép đếm đầu và ba câu báo giữ nguyên chữ; phép đếm thứ ba đọc (5).
CREATE OR REPLACE FUNCTION public.rfq_kiem_chu_ky_danh_sach_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  can integer;
  co integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  can := CASE WHEN NEW.requires_dual_approval THEN 2 ELSE 1 END;
  SELECT count(DISTINCT a.approver_user_id) INTO co
    FROM public.rfq_approvals a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.id
     AND a.approved_content_hash = public.rfq_bam_noi_dung(NEW.id)
     AND a.approved_list_hash = public.rfq_bam_danh_sach(NEW.id);
  IF co < can THEN
    RAISE EXCEPTION 'RFQ nay can % chu ky TREN DANH SACH MOI HIEN TAI, moi co % (K4b)', can, co
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(DISTINCT a.approver_user_id) INTO co
    FROM public.rfq_approvals a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.id
     AND a.approved_content_hash = public.rfq_bam_noi_dung(NEW.id)
     AND a.approved_list_hash = public.rfq_bam_danh_sach(NEW.id)
     AND a.approved_budget_hash = public.rfq_bam_ngan_sach(NEW.id);
  IF co < can THEN
    RAISE EXCEPTION 'RFQ nay can % chu ky TREN NGAN SACH HIEN TAI, moi co % (K4b)', can, co
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*)::integer INTO co
    FROM public.rfq_chu_ky_con_hieu_luc(NEW.org_id, NEW.id);
  IF co < can THEN
    RAISE EXCEPTION 'RFQ nay can % chu ky CON HIEU LUC — ky tren lan nop da xem, nguoi ky chua tra goi ve tu lan ay —, moi co % (K4b)', can, co
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (6) K5 — HÀM VỊ TỪ CỦA CHỐT
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_chot_chu_ky_doc_lap(p_org uuid, p_rfq uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  can integer;
  bac jsonb;
  ky boolean;
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
  bac := public.rfq_bac_ghim(p_org, p_rfq);
  ky := coalesce((bac ->> 'ky_danh_sach_moi')::boolean, true);
  IF NOT ky
     AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions e
                      WHERE e.org_id = p_org AND e.rfq_id = p_rfq AND e.hanh_dong = 'LAP'
                        AND e.loai IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION')
                        AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                                         WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)) THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM public.rfq_chu_ky_con_hieu_luc(p_org, p_rfq)) < can THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1
               FROM public.rfq_chu_ky_con_hieu_luc(p_org, p_rfq) k(n)
              WHERE NOT EXISTS (SELECT 1 FROM public.rfq_tap_loai_tru(p_org, p_rfq) t(n) WHERE t.n = k.n)) THEN
    RETURN NULL;
  END IF;
  RETURN 'K5_THIEU_CHU_KY_DOC_LAP';
END
$ham$;

-- ============================================================================================
-- (7) CẠNH PENDING_APPROVAL→OPEN
-- ============================================================================================
-- `WHEN` đúng cạnh (ADR-082 ⒃): `app_unseal` sửa `rfq_packages` ở các cạnh mở thầu, và không có việc gì ở đây. Tên xếp sau
-- `rfq_packages_kiem_danh_sach_khi_mo` (K4b).
CREATE OR REPLACE FUNCTION public.rfq_kiem_doc_lap_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  ly_do := public.rfq_chot_chu_ky_doc_lap(NEW.org_id, NEW.id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Goi thau chua mo duoc (K5): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k5_chu_ky_doc_lap';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_doc_lap_khi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'OPEN')
  EXECUTE FUNCTION public.rfq_kiem_doc_lap_khi_mo();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_doc_lap_khi_mo;

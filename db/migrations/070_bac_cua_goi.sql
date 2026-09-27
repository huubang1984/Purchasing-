-- ==============================================================================================
-- 070_bac_cua_goi — [S1.164 / S3.1b của spec S3] BẬC CỦA GÓI THẦU, NGÂN SÁCH BẮT BUỘC GHIM ĐÚNG
-- PHIÊN BẢN HIỆU LỰC, VÀ K1
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.2, §5.1 (K1, K12), §9 (phần
-- S3.1b). ADR-082 ⑸ ⑺ (ngân sách bắt buộc; nộp duyệt đòi phiên bản ghim là phiên bản hiệu lực), ADR-084 ⑷
-- (lớp `CONTROL_DENIED` — ở tầng gói, `packages/rfq/src/chot-kiem-soat.ts`).
--
-- (1) BẬC CỦA GÓI: `rfq_bac_cua(policy_id, ước lượng, tiền tệ)` — hàm phân bậc DUY NHẤT. Bậc của giá trị
--     `v` là bậc có `tu_so_tien` lớn nhất `≤ v` (spec §4.1). NÉM khi phiên bản không bậc hay tiền tệ lệch
--     (spec §4.1: phân bậc không quy đổi tiền tệ): hỏi bậc ở chỗ không có bậc là lỗi của bên gọi, và trả
--     NULL thì mọi chỗ dùng phải tự nhớ xử lý (§2.5 ⑽).
-- (2) `rfq_budgets.tier_tu_so_tien`: cận dưới của bậc áp, do trigger ĐẶT từ (1) ở mọi lần chèn hay sửa
--     ngân sách, và nằm ngoài `GRANT INSERT`/`UPDATE` — khuôn `approved_content_hash` (`011`): bên gọi không
--     khai được bậc của gói mình. Ước lượng chỉ sửa ở DRAFT (`014` §(3)), nên bậc cũng chỉ đổi ở DRAFT.
--     Ngân sách ghim một phiên bản không bậc thì cột là NULL.
-- (3) K1 — `rfq_chot_ngan_sach(org, gói, lúc)`: hàm vị từ của chốt (K12). Trả NULL khi cho qua, MÃ CHỐT khi
--     chặn. Ở tổ chức ĐÃ BẬT S3, một gói đang ở DRAFT chỉ rời DRAFT khi nó có ngân sách
--     (`THIEU_NGAN_SACH`), ngân sách ghim ĐÚNG phiên bản hiệu lực lúc ấy (`NGAN_SACH_GHIM_BAN_CU`) — ở tổ
--     chức đã bật, đó là một phiên bản có bậc ĐÃ KÝ (`069` mục (3)) —, và bậc đã lưu bằng kết quả của (1)
--     (`BAC_LECH_HAM_PHAN_BAC`). Tổ chức chưa bật: NULL, luồng MVP1 giữ nguyên (ADR-085 ⑵ — ước lượng tuỳ
--     chọn). Gói không ở DRAFT: NULL — chốt không có gì để nói về một cạnh mà gói ấy không đi được, và tầng
--     gói không ghi sổ cho một lời gọi sai gói. Tầng gói gọi hàm này TRƯỚC mọi tác dụng phụ; trigger ở cạnh
--     gọi lại CHÍNH nó — một luật, hai chỗ dùng, khuôn `rfq_can_phe_duyet_kep` (`014`).
-- (4) CẠNH `DRAFT→PENDING_APPROVAL`: trigger lấy khoá tư vấn theo tổ chức ở chế độ CHIA SẺ — cùng khoá mà
--     lần ký và lần chèn phiên bản giữ ĐỘC QUYỀN (`069`) —, đóng dấu `submitted_at` bằng giờ thật, rồi hỏi
--     (3) tại đúng mốc ấy. Các lần nộp duyệt không chờ nhau; chỉ chờ một lần ký hay một lần chèn phiên bản
--     đang dở, và đọc trạng thái SAU nó. `submitted_at` là mốc để tái lập *phiên bản hiệu lực lúc nộp*
--     (S3.9) và là neo của cửa sổ tín hiệu (K10, S3.6). Cạnh này chạy cho MỌI tổ chức: khoá và dấu giờ là
--     thứ duy nhất tổ chức chưa bật nhận thêm.
-- (5) `signed_at` ĐÓNG DẤU SAU KHOÁ. Thân `069` để `signed_at` là `now()` — giờ ĐẦU giao dịch ký, có thể
--     TRƯỚC lúc nó lấy được khoá. Khi ấy một lần nộp duyệt đứng TRƯỚC lần ký theo khoá lại đứng SAU
--     `signed_at` theo giờ: nó ghim phiên bản cũ và đi qua, rồi `chinh_sach_hieu_luc(org, submitted_at)`
--     tính lại ra phiên bản MỚI — K1 đúng lúc chạy mà sai khi tái lập. Đóng dấu cả hai mốc bằng
--     `clock_timestamp()` SAU khoá thì thứ tự giờ trùng thứ tự khoá. Thân còn lại NGUYÊN VĂN `069`.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: route tạo và ký phiên bản, màn `/chinh-sach` (S3.1c); `gieo:demo` và kịch
-- bản 41 hai luồng (S3.1d); gói ở bậc đấu thầu chính thức không rời DRAFT (K2, S3.2).
-- ==============================================================================================

-- ============================================================================================
-- (1) HÀM PHÂN BẬC
-- ============================================================================================
-- Không SECURITY DEFINER (hardening §C): chạy dưới quyền người gọi, RLS áp — một phiên bản của tổ chức
-- khác là KHÔNG TÌM THẤY, không phải một bậc.
CREATE OR REPLACE FUNCTION public.rfq_bac_cua(p_policy uuid, p_gia_tri numeric, p_tien_te text) RETURNS numeric
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bac jsonb;
  tien_te_cs text;
  tu numeric;
BEGIN
  SELECT p.tiers, p.currency INTO bac, tien_te_cs
    FROM public.org_procurement_policies p
   WHERE p.id = p_policy;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay phien ban chinh sach de phan bac (S3.1b)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF bac IS NULL THEN
    RAISE EXCEPTION 'Phien ban chinh sach khong khai bac — khong phan bac duoc (S3.1b)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_gia_tri IS NULL OR p_tien_te IS NULL THEN
    RAISE EXCEPTION 'Thieu uoc luong hoac don vi tien te — khong phan bac duoc (S3.1b)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_tien_te <> tien_te_cs THEN
    RAISE EXCEPTION 'Don vi tien te cua uoc luong (%) khac cua chinh sach (%) — phan bac khong quy doi tien te (S3.1b)',
      p_tien_te, tien_te_cs
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT max((b ->> 'tu_so_tien')::numeric) INTO tu
    FROM pg_catalog.jsonb_array_elements(bac) AS b
   WHERE (b ->> 'tu_so_tien')::numeric <= p_gia_tri;
  IF tu IS NULL THEN
    RAISE EXCEPTION 'Khong bac nao phu uoc luong nay (S3.1b)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN tu;
END
$ham$;

-- ============================================================================================
-- (2) BẬC ÁP CỦA GÓI — CỘT DO TRIGGER ĐẶT
-- ============================================================================================
ALTER TABLE rfq_budgets ADD COLUMN tier_tu_so_tien numeric(18, 2);
-- Cố ý KHÔNG thêm vào `GRANT INSERT`/`UPDATE` của `014`: quyền theo cột, nên cột mới đứng ngoài cả hai.

-- Tên trigger xếp SAU ba trigger BEFORE của bảng (x > k > c): phiên bản chưa ký đã bị
-- `rfq_budgets_khong_ghim_ban_chua_ky` chặn trước khi thân này hỏi bậc của nó.
CREATE OR REPLACE FUNCTION public.ngan_sach_xep_bac() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF EXISTS (SELECT 1 FROM public.org_procurement_policies p
              WHERE p.org_id = NEW.org_id AND p.id = NEW.policy_id AND p.tiers IS NOT NULL) THEN
    NEW.tier_tu_so_tien := public.rfq_bac_cua(NEW.policy_id, NEW.estimated_value, NEW.currency);
  ELSE
    NEW.tier_tu_so_tien := NULL;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_budgets_xep_bac
  BEFORE INSERT OR UPDATE ON rfq_budgets
  FOR EACH ROW EXECUTE FUNCTION public.ngan_sach_xep_bac();
ALTER TABLE rfq_budgets ENABLE ALWAYS TRIGGER rfq_budgets_xep_bac;

-- ============================================================================================
-- (3) K1 — HÀM VỊ TỪ CỦA CHỐT
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO` (`packages/rfq/src/chot-kiem-soat.ts`); một mã mới ở đây mà
-- không có dòng ở đó thì tầng gói ném một lỗi không tên thay vì một lời từ chối có tên.
CREATE OR REPLACE FUNCTION public.rfq_chot_ngan_sach(p_org uuid, p_rfq uuid, p_luc timestamptz) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ns record;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                  WHERE r.org_id = p_org AND r.id = p_rfq AND r.status = 'DRAFT') THEN
    RETURN NULL;
  END IF;
  SELECT b.policy_id, b.estimated_value, b.currency, b.tier_tu_so_tien INTO ns
    FROM public.rfq_budgets b
   WHERE b.org_id = p_org AND b.rfq_id = p_rfq;
  IF NOT FOUND THEN
    RETURN 'THIEU_NGAN_SACH';
  END IF;
  IF ns.policy_id IS DISTINCT FROM public.chinh_sach_hieu_luc(p_org, p_luc) THEN
    RETURN 'NGAN_SACH_GHIM_BAN_CU';
  END IF;
  IF ns.tier_tu_so_tien IS DISTINCT FROM public.rfq_bac_cua(ns.policy_id, ns.estimated_value, ns.currency) THEN
    RETURN 'BAC_LECH_HAM_PHAN_BAC';
  END IF;
  RETURN NULL;
END
$ham$;

-- ============================================================================================
-- (4) CẠNH DRAFT→PENDING_APPROVAL
-- ============================================================================================
ALTER TABLE rfq_packages ADD COLUMN submitted_at timestamptz;
-- Cố ý KHÔNG cấp UPDATE cột này: trigger dưới đóng dấu nó, bên gọi không chọn được mốc nộp của mình.

-- `WHEN` đúng cạnh (§2.5 ⒃): `app_unseal` sửa `rfq_packages` ở các cạnh mở thầu, và không có việc gì ở đây.
CREATE OR REPLACE FUNCTION public.rfq_kiem_ngan_sach_khi_nop() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
            pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));
  NEW.submitted_at := pg_catalog.clock_timestamp();
  ly_do := public.rfq_chot_ngan_sach(NEW.org_id, NEW.id, NEW.submitted_at);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Goi thau chua roi DRAFT duoc (K1): %', ly_do
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_ngan_sach_khi_nop
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL')
  EXECUTE FUNCTION public.rfq_kiem_ngan_sach_khi_nop();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_ngan_sach_khi_nop;

-- ============================================================================================
-- (5) `signed_at` ĐÓNG DẤU SAU KHOÁ — thân `069` cộng đúng một dòng
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.chinh_sach_kiem_nguoi_ky() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  co_bac boolean;
  phien_ban integer;
  hieu_luc_tu timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));
  NEW.signed_at := pg_catalog.clock_timestamp();
  SELECT p.created_by, p.tiers IS NOT NULL, p.version, p.effective_from
    INTO nguoi_tao, co_bac, phien_ban, hieu_luc_tu
    FROM public.org_procurement_policies p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.policy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay phien ban chinh sach de ky (ADR-082)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT co_bac THEN
    RAISE EXCEPTION 'Chi phien ban chinh sach CO BAC moi nhan chu ky thu hai (ADR-082)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.signed_by = nguoi_tao THEN
    RAISE EXCEPTION 'Nguoi tao phien ban chinh sach khong duoc tu ky (ADR-082)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.signed_by
                    AND rp.permission_code = 'policy.manage') THEN
    RAISE EXCEPTION 'Nguoi ky phien ban chinh sach phai giu policy.manage (ADR-082)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_procurement_policies q
              WHERE q.org_id = NEW.org_id AND q.version > phien_ban) THEN
    RAISE EXCEPTION 'Chi ky duoc phien ban chinh sach MOI NHAT cua to chuc (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF hieu_luc_tu > NEW.signed_at THEN
    RAISE EXCEPTION 'Phien ban chinh sach chua toi ngay hieu luc — ky khi toi (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

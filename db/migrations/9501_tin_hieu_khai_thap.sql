-- ==============================================================================================
-- [S1.9101 / S3.6d · K10b] TÍN HIỆU KHAI THẤP ƯỚC LƯỢNG (`ESTIMATE_UNDERSTATED`) VÀ K10 Ở CHỮ KÝ TRAO THẦU
--
-- Spec S3 §4.6 bảng tín hiệu (dòng `ESTIMATE_UNDERSTATED`: tính ở đề xuất award, bằng chứng là *bậc của số tiền trao cao hơn bậc của ước
-- lượng*), §2.5 ⒁ và ADR-082 ⒁ (MỘT điều kiện fail-closed; bằng chứng KHÔNG mang số tiền; tín hiệu bắn cả khi số tiền trao vượt ngưỡng
-- phê duyệt kép mà ước lượng thì không — lỗ `014` §(4)), §8.4 (khai thấp chỉ bị bắt ở award), ADR-120 (khuôn K10a: tín hiệu không chặn
-- cạnh nào, nó chặn việc KHÔNG AI ĐỌC nó; người ghi nhận giữ quyền của cạnh bị chặn và nằm ngoài {người tạo gói, người gây ra}). ADR-9201.
--
-- Trước vòng này mọi thứ của tín hiệu (`088`) khoá cứng vào `PURCHASE_SPLITTING` ở PENDING_APPROVAL với `rfq.approve`: CHECK `loai`,
-- trigger tính bằng chứng, luật người ghi nhận, trigger kiểm lần ghi nhận. Vòng này mở chúng theo `loai` — thân cũ của loại chia nhỏ giữ
-- NGUYÊN VĂN trong nhánh của nó — và thêm loại thứ hai:
--
--   ⑴ `tin_hieu_khai_thap(org, gói)` — MỘT hàm, hai người đọc (tầng gói lúc đề xuất, trigger chữ ký): NULL khi tổ chức chưa bật, khi
--      gói không có đề xuất đang sống (hàng award mới nhất không phải PROPOSED), hay khi bậc của số tiền trao KHÔNG cao hơn bậc ước
--      lượng VÀ số tiền trao không vượt ngưỡng kép mà ước lượng thì không. Bằng chứng: phiên bản chính sách ghim, id đề xuất và phiên
--      bản báo giá (để lần ghi nhận nói về ĐÚNG đề xuất này — đề xuất rút rồi đề xuất lại làm lời ghi nhận cũ lỗi thời, fail-closed),
--      hai mốc bậc `tu_so_tien`, cờ vượt ngưỡng kép, và `goi` = [gói] cho cùng hình dạng đọc với K10a. KHÔNG số tiền nào (ADR-054).
--   ⑵ Hàng tín hiệu ghi ở cạnh đề xuất (`nguon = 'DE_XUAT'`, tầng gói gọi SAU câu chèn đề xuất, cùng giao dịch) hay lúc ghi nhận khi
--      bằng chứng đã đổi (`GHI_NHAN`, khuôn K10a).
--   ⑶ Người ghi nhận giữ `po.approve` (ADR-084 ⑵) và KHÔNG là: người tạo hay người nộp gói, người đặt ngân sách (người khai ước lượng —
--      người gây ra), người đề xuất (`K10B_TU_GHI_NHAN`), người khai phiên bản chính sách ghim (`K10B_TAC_GIA_CHINH_SACH`). Vào sổ.
--   ⑷ K10b ở CHỮ KÝ duyệt trao thầu (spec §4.6: *"chữ ký duyệt award đòi ghi nhận"*): hàm vị từ `award_chot_tin_hieu` trả
--      `K10B_TIN_HIEU_CHUA_GHI_NHAN` khi tín hiệu tính NGAY LÚC ẤY chưa có lần ghi nhận nào trên một tín hiệu có bằng chứng BẰNG nó; tầng
--      gói hỏi trước câu chèn chữ ký, trigger riêng trên `rfq_award_approvals` hỏi lại (tên xếp sau J3, trước K7 vai và K9). Tên ràng
--      buộc `k10b_*` KHÔNG vào `CHOT_THEO_RANG_BUOC` — cùng quyết định ADR-120: tầng gói đã hỏi trước, lớp chặn cuối chỉ cho câu đi tắt.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: `INVITE_LIST_NARROWED`, `EARLY_CLOSE` (S3.6c); màn ghi nhận ở `/mo-thau` và `gieo:demo` — tầng trên của
-- cùng vòng; K8b (S3.7).
-- ==============================================================================================

-- ============================================================================================
-- (1) HAI RÀNG BUỘC CHECK CỦA BẢNG TÍN HIỆU MỞ THÊM MỘT LOẠI, MỘT NGUỒN
-- ============================================================================================
ALTER TABLE governance_signals DROP CONSTRAINT governance_signals_loai_check;
ALTER TABLE governance_signals ADD CONSTRAINT governance_signals_loai_check
  CHECK (loai IN ('PURCHASE_SPLITTING', 'ESTIMATE_UNDERSTATED'));
ALTER TABLE governance_signals DROP CONSTRAINT governance_signals_nguon_check;
ALTER TABLE governance_signals ADD CONSTRAINT governance_signals_nguon_check
  CHECK (nguon IN ('NOP_DUYET', 'GHI_NHAN', 'DE_XUAT'));

-- ============================================================================================
-- (2) TÍN HIỆU KHAI THẤP — MỘT HÀM
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.tin_hieu_khai_thap(p_org uuid, p_rfq uuid) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  a record;
  cs record;
  tien record;
  bac_ul jsonb;
  tu_ul numeric;
  tu_trao numeric;
  vuot boolean;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  SELECT w.id, w.bid_version_id, w.status INTO a
    FROM public.rfq_awards w
   WHERE w.org_id = p_org AND w.rfq_id = p_rfq
   ORDER BY w.acted_at DESC, w.id DESC
   LIMIT 1;
  IF NOT FOUND OR a.status <> 'PROPOSED' THEN
    RETURN NULL;
  END IF;
  bac_ul := public.rfq_bac_ghim(p_org, p_rfq);
  IF bac_ul IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT b.policy_id, b.estimated_value, p.currency, p.dual_approval_threshold INTO cs
    FROM public.rfq_budgets b
    JOIN public.org_procurement_policies p ON p.org_id = b.org_id AND p.id = b.policy_id
   WHERE b.org_id = p_org AND b.rfq_id = p_rfq;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT t.so_tien, t.tien_te INTO tien FROM public.award_so_tien_trao(p_org, a.bid_version_id) t;
  IF tien.so_tien IS NULL OR tien.tien_te IS DISTINCT FROM cs.currency THEN
    RETURN NULL;
  END IF;
  tu_ul := (bac_ul ->> 'tu_so_tien')::numeric;
  tu_trao := public.rfq_bac_cua(cs.policy_id, tien.so_tien, tien.tien_te);
  vuot := cs.dual_approval_threshold IS NOT NULL
          AND tien.so_tien >= cs.dual_approval_threshold
          AND cs.estimated_value < cs.dual_approval_threshold;
  IF tu_trao <= tu_ul AND NOT vuot THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'loai', 'ESTIMATE_UNDERSTATED',
    'chinh_sach', cs.policy_id,
    'award', a.id,
    'bao_gia', a.bid_version_id,
    'bac_uoc_luong', tu_ul,
    'bac_trao', tu_trao,
    'vuot_nguong_kep', vuot,
    'goi', pg_catalog.jsonb_build_array(p_rfq));
END
$ham$;

-- Tín hiệu HIỆN TẠI của một gói theo loại — một chỗ, hai người đọc (tầng gói `kiem-soat`, hai trigger dưới).
CREATE OR REPLACE FUNCTION public.tin_hieu_hien_tai(p_org uuid, p_rfq uuid, p_loai text) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF p_loai = 'PURCHASE_SPLITTING' THEN
    RETURN public.tin_hieu_chia_nho(p_org, p_rfq);
  END IF;
  IF p_loai = 'ESTIMATE_UNDERSTATED' THEN
    RETURN public.tin_hieu_khai_thap(p_org, p_rfq);
  END IF;
  RAISE EXCEPTION 'Loai tin hieu khong co: %', p_loai USING ERRCODE = 'check_violation';
END
$ham$;

-- ============================================================================================
-- (3) HÀNG TÍN HIỆU — BẰNG CHỨNG DO CSDL ĐẶT, THEO LOẠI
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.tin_hieu_kiem_ghi() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NEW.loai = 'PURCHASE_SPLITTING' THEN
    IF NEW.nguon NOT IN ('NOP_DUYET', 'GHI_NHAN') THEN
      RAISE EXCEPTION 'Tin hieu chia nho chi tinh o lan nop duyet hay lan ghi nhan (S3.6b1)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_nguon_sai';
    END IF;
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
  END IF;
  IF NEW.loai = 'ESTIMATE_UNDERSTATED' THEN
    IF NEW.nguon NOT IN ('DE_XUAT', 'GHI_NHAN') THEN
      RAISE EXCEPTION 'Tin hieu khai thap chi tinh o lan de xuat hay lan ghi nhan (S3.6d)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_nguon_sai';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                    WHERE r.org_id = NEW.org_id AND r.id = NEW.rfq_id AND r.status = 'AWARDED') THEN
      RAISE EXCEPTION 'Tin hieu khai thap chi ghi cho goi thau dang co de xuat trao thau (S3.6d)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_goi_khong_trao';
    END IF;
    NEW.bang_chung := public.tin_hieu_khai_thap(NEW.org_id, NEW.rfq_id);
    IF NEW.bang_chung IS NULL THEN
      RAISE EXCEPTION 'Goi thau khong co tin hieu khai thap nao de ghi (S3.6d)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_khong_co';
    END IF;
    NEW.do_tin_cay := 'XAC_DINH';
    NEW.giai_thich := CASE
      WHEN (NEW.bang_chung ->> 'bac_trao')::numeric > (NEW.bang_chung ->> 'bac_uoc_luong')::numeric THEN
        pg_catalog.format('Bậc của số tiền trao (từ %s) cao hơn bậc của ước lượng (từ %s)%s.',
          NEW.bang_chung ->> 'bac_trao', NEW.bang_chung ->> 'bac_uoc_luong',
          CASE WHEN (NEW.bang_chung ->> 'vuot_nguong_kep')::boolean THEN '; số tiền trao vượt ngưỡng phê duyệt kép mà ước lượng thì không' ELSE '' END)
      ELSE
        pg_catalog.format('Số tiền trao vượt ngưỡng phê duyệt kép mà ước lượng thì không (cùng bậc từ %s).', NEW.bang_chung ->> 'bac_trao')
    END;
    NEW.tinh_luc := pg_catalog.clock_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Loai tin hieu khong co: %', NEW.loai USING ERRCODE = 'check_violation';
END
$ham$;

-- ============================================================================================
-- (4) LUẬT NGƯỜI GHI NHẬN — THEO LOẠI CỦA BẰNG CHỨNG
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.tin_hieu_chot_nguoi_ghi_nhan(p_org uuid, p_bang_chung jsonb, p_nguoi uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF p_bang_chung IS NULL THEN
    RETURN NULL;
  END IF;
  IF (p_bang_chung ->> 'loai') = 'ESTIMATE_UNDERSTATED' THEN
    IF EXISTS (SELECT 1
                 FROM public.rfq_packages r
                WHERE r.org_id = p_org
                  AND r.id IN (SELECT (x #>> '{}')::uuid FROM pg_catalog.jsonb_array_elements(p_bang_chung -> 'goi') x)
                  AND (r.created_by = p_nguoi OR r.submitted_by = p_nguoi))
       OR EXISTS (SELECT 1
                    FROM public.rfq_budgets b
                   WHERE b.org_id = p_org
                     AND b.rfq_id IN (SELECT (x #>> '{}')::uuid FROM pg_catalog.jsonb_array_elements(p_bang_chung -> 'goi') x)
                     AND b.created_by = p_nguoi)
       OR EXISTS (SELECT 1
                    FROM public.rfq_awards w
                   WHERE w.org_id = p_org
                     AND w.id = (p_bang_chung ->> 'award')::uuid
                     AND w.acted_by = p_nguoi) THEN
      RETURN 'K10B_TU_GHI_NHAN';
    END IF;
    IF EXISTS (SELECT 1
                 FROM public.org_procurement_policies p
                WHERE p.org_id = p_org
                  AND p.id = (p_bang_chung ->> 'chinh_sach')::uuid
                  AND p.created_by = p_nguoi) THEN
      RETURN 'K10B_TAC_GIA_CHINH_SACH';
    END IF;
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

-- ============================================================================================
-- (5) TRIGGER KIỂM LẦN GHI NHẬN — THEO LOẠI
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.tin_hieu_kiem_ghi_nhan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  s record;
  ly_do text;
  quyen text;
BEGIN
  SELECT g.rfq_id, g.loai, g.bang_chung INTO s
    FROM public.governance_signals g
   WHERE g.org_id = NEW.org_id AND g.id = NEW.signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay tin hieu de ghi nhan (S3.6b1)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF s.loai = 'ESTIMATE_UNDERSTATED' THEN
    quyen := 'po.approve';
    IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                    WHERE r.org_id = NEW.org_id AND r.id = s.rfq_id AND r.status = 'AWARDED') THEN
      RAISE EXCEPTION 'Chi ghi nhan tin hieu khai thap khi goi thau dang co de xuat trao thau (S3.6d)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'k10_ghi_nhan_sai_trang_thai';
    END IF;
  ELSE
    quyen := 'rfq.approve';
    IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                    WHERE r.org_id = NEW.org_id AND r.id = s.rfq_id AND r.status = 'PENDING_APPROVAL') THEN
      RAISE EXCEPTION 'Chi ghi nhan tin hieu khi goi thau dang cho duyet (S3.6b1)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'k10_ghi_nhan_sai_trang_thai';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                    AND rp.permission_code = quyen) THEN
    RAISE EXCEPTION 'Nguoi ghi nhan tin hieu phai giu quyen cua canh bi chan: % (ADR-084)', quyen
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
  IF ly_do = 'K10B_TU_GHI_NHAN' THEN
    RAISE EXCEPTION 'Nguoi tao, nguoi nop, nguoi dat ngan sach hay nguoi de xuat cua goi khong ghi nhan duoc tin hieu khai thap (K10b)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10b_nguoi_gay_ra_tu_ghi_nhan';
  END IF;
  IF ly_do = 'K10B_TAC_GIA_CHINH_SACH' THEN
    RAISE EXCEPTION 'Nguoi khai phien ban chinh sach cua goi khong ghi nhan duoc tin hieu khai thap (K10b)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10b_tac_gia_chinh_sach_ghi_nhan';
  END IF;
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Nguoi nay khong ghi nhan duoc tin hieu (K10): %', ly_do
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.tin_hieu_hien_tai(NEW.org_id, s.rfq_id, s.loai) IS DISTINCT FROM s.bang_chung THEN
    RAISE EXCEPTION 'Bang chung cua tin hieu da doi — ghi nhan tin hieu hien tai (K10)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10_bang_chung_da_doi';
  END IF;
  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (6) CHỐT K10b Ở CHỮ KÝ DUYỆT TRAO THẦU
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO`. Cùng khuôn `rfq_chot_tin_hieu` (K10a): một lần ghi nhận trỏ tới một tín hiệu có bằng chứng
-- BẰNG kết quả hiện tại là đủ — luật người đã kiểm lúc chèn nó, và bằng chứng (đề xuất, báo giá, hai mốc bậc) là thứ luật ấy đọc.
CREATE OR REPLACE FUNCTION public.award_chot_tin_hieu(p_org uuid, p_rfq uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bc jsonb;
BEGIN
  bc := public.tin_hieu_khai_thap(p_org, p_rfq);
  IF bc IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1
               FROM public.governance_signals s
               JOIN public.governance_signal_acks a ON a.org_id = s.org_id AND a.signal_id = s.id
              WHERE s.org_id = p_org AND s.rfq_id = p_rfq AND s.bang_chung = bc) THEN
    RETURN NULL;
  END IF;
  RETURN 'K10B_TIN_HIEU_CHUA_GHI_NHAN';
END
$ham$;

-- Trigger RIÊNG trên chữ ký (khuôn `014` §(4)): tên xếp sau `_kiem_nguoi_duyet` (J3) và trước `_kiem_vai_theo_bac` (K7), `_kiem_xung_dot`
-- (K9). Lớp chặn cuối cho câu chèn đi tắt — tầng gói đã hỏi `award_chot_tin_hieu` trước và để lại `CONTROL_DENIED`.
CREATE OR REPLACE FUNCTION public.award_kiem_tin_hieu_khai_thap() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  goi uuid;
  ly_do text;
BEGIN
  SELECT w.rfq_id INTO goi FROM public.rfq_awards w WHERE w.org_id = NEW.org_id AND w.id = NEW.award_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  ly_do := public.award_chot_tin_hieu(NEW.org_id, goi);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chu ky trao thau chua ghi duoc (K10b): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10b_tin_hieu_chua_ghi_nhan';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_award_approvals_kiem_tin_hieu_khai_thap
  BEFORE INSERT ON rfq_award_approvals
  FOR EACH ROW EXECUTE FUNCTION public.award_kiem_tin_hieu_khai_thap();
ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_kiem_tin_hieu_khai_thap;

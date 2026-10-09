-- ==============================================================================================
-- [S1.9101 / S3.6c · K10c] HAI TÍN HIỆU CỦA LƯỢT MỜI THẦU — THU HẸP DANH SÁCH MỜI (`INVITE_LIST_NARROWED`) VÀ ĐÓNG SỚM KHI ĐÃ CÓ BÁO GIÁ
-- (`EARLY_CLOSE`) — VÀ K10 CHO CHÚNG Ở CHỮ KÝ DUYỆT TRAO THẦU; THU HỒI LỜI MỜI MỞ Ở `OPEN` CHO TỔ CHỨC ĐÃ BẬT
--
-- Spec S3 §3.3 (bảng trạng thái danh sách mời, dòng `OPEN`: *thu hồi phải có lý do và sinh tín hiệu; thu hồi làm danh sách còn dưới
-- ngưỡng thì cần ngoại lệ có chữ ký độc lập*), §4.6 (hai dòng tín hiệu: bằng chứng *lời mời bị thu hồi, người thu hồi, lý do* và *hạn
-- gốc, lúc đóng, người đóng, lý do*; *chữ ký duyệt award đòi ghi nhận*), §2.5 ⒁ / ADR-082 ⒁ (một điều kiện fail-closed; thêm
-- `EARLY_CLOSE` — vế *"phê duyệt riêng khi đã có báo giá"* mà `011` §(H-4) hoãn), §9 S3.6c, ADR-120 (khuôn K10a), ADR-157 (khuôn K10b,
-- hai bảng tín hiệu mở theo loại), ADR-128 (sau lần mở thầu đầu tiên lời mời không thu hồi được — giữ nguyên). Chủ dự án chốt
-- 2026-10-09 (ADR-9201): dưới ngưỡng thì từ chối trừ khi có ngoại lệ còn sống; `EARLY_CLOSE` CHẶN chữ ký như hai loại kia; một hàng
-- K10c cho cả hai loại; khối chung ở bước 7 `/mo-thau` và nút thu hồi có lý do ở `/tao-thau`.
--
-- Trước vòng này `080` chặn thu hồi ở mọi trạng thái ngoài DRAFT (`k4a_thu_hoi_sai_trang_thai`) "tới khi S3.6 dựng tín hiệu". Vòng này:
--
--   ⑴ Cột `rfq_invitations.ly_do_thu_hoi` (≤ 2000 byte, đã cắt, chỉ đi kèm `revoked_at`). Ở gói `OPEN` của tổ chức đã bật, câu thu hồi
--      phải mang nó — lời từ chối `k10c_thu_hoi_thieu_ly_do` không qua bảng tên → mã (tầng gói hỏi trước, lỗi hình dạng).
--   ⑵ `rfq_chot_thu_hoi(org, gói, lời mời)` — hàm vị từ: thu hồi làm số NHÓM đếm được (`rfq_dem_nhom_loi_moi` trên tập đếm được TRỪ lời
--      mời này) rơi dưới `so_ncc_toi_thieu` của bậc ghim ⇒ `K10C_THU_HOI_THIEU_CANH_TRANH`, trừ khi có ngoại lệ còn sống đúng loại
--      (`SINGLE_SOURCE` khi còn một lời mời sống, `LIMITED_COMPETITION` khi nhiều hơn) — cùng luật `rfq_chot_canh_tranh` (K2). Tầng gói
--      hỏi trước câu ghi (`CONTROL_DENIED`), trigger K4a hỏi lại với tên `k10c_thu_hoi_thieu_canh_tranh`.
--   ⑶ `rfq_invitations_kiem_danh_sach` (K4a) định nghĩa lại — thân `080` nguyên văn, nhánh thu hồi mở thêm `OPEN` với ⑴ ⑵; ở mọi trạng
--      thái khác lời từ chối cũ giữ nguyên tên.
--   ⑷ `tin_hieu_thu_hep(org, gói)` — MỘT hàm: NULL khi tổ chức chưa bật, gói chưa mở, hay không lời mời nào bị thu hồi từ lúc mở
--      (`revoked_at >= opened_at` — danh sách đã ký). Bằng chứng: phiên bản chính sách ghim, `goi = [gói]`, và `thu_hoi[]` = {lời mời,
--      người thu hồi, lúc (UTC), lý do} theo thứ tự thu hồi. Không số tiền nào (ADR-054).
--   ⑸ `tin_hieu_dong_som(org, gói)` — MỘT hàm: NULL khi tổ chức chưa bật, gói chưa đóng, đóng không trước hạn, hay không có luồng báo
--      giá nào của lời mời còn sống. Bằng chứng: hạn, lúc đóng (UTC), người đóng, lý do đóng sớm, số luồng báo giá, phiên bản chính
--      sách, `goi`. Mốc giờ ghi bằng `to_char` ở UTC — `to_jsonb(timestamptz)` đi theo múi giờ của phiên, hai phiên hai múi là hai bằng
--      chứng của cùng một sự thật.
--   ⑹ Hàng tín hiệu ghi ở cạnh gây ra nó (`nguon = 'THU_HOI'` trong giao dịch thu hồi, `'DONG_SOM'` trong giao dịch đóng) hay lúc ghi
--      nhận (`'GHI_NHAN'`, gói `AWARDED`). Hai bảng của `088`/`116` rẽ thêm hai loại; thân cũ của hai loại trước NGUYÊN VĂN.
--   ⑺ Người ghi nhận giữ `po.approve` (cùng cạnh bị chặn với K10b) và KHÔNG là người tạo, người nộp gói, người thu hồi (bằng chứng
--      `thu_hoi[].nguoi`) hay người đóng (`nguoi_dong`) — `K10C_TU_GHI_NHAN`; không là người khai phiên bản chính sách ghim —
--      `K10C_TAC_GIA_CHINH_SACH`. Vào sổ `CONTROL_DENIED`.
--   ⑻ `award_chot_tin_hieu` đọc BA hàm tín hiệu: khai thấp chưa ghi nhận ⇒ `K10B_TIN_HIEU_CHUA_GHI_NHAN` (như cũ), thu hẹp hay đóng sớm
--      chưa ghi nhận ⇒ `K10C_TIN_HIEU_CHUA_GHI_NHAN`. Trigger `rfq_award_approvals_kiem_tin_hieu_khai_thap` giữ nguyên, hàm của nó đặt
--      tên ràng buộc theo mã (`k10b_*` / `k10c_tin_hieu_chua_ghi_nhan`). Tên `k10c_*` KHÔNG vào `CHOT_THEO_RANG_BUOC` (ADR-120, ADR-157).
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: lập ngoại lệ ở `OPEN` (chủ dự án chọn phương án từ chối trừ khi ngoại lệ lập từ DRAFT còn sống);
-- `gieo:demo --s3` và lượt đi thử T4 cho ba tín hiệu ở chữ ký; K8b (S3.7).
-- ==============================================================================================

-- ============================================================================================
-- (1) LÝ DO THU HỒI — CỘT ĐI KÈM `revoked_at`
-- ============================================================================================
ALTER TABLE rfq_invitations ADD COLUMN ly_do_thu_hoi text
  CONSTRAINT rfq_invitations_ly_do_thu_hoi_check
  CHECK (ly_do_thu_hoi IS NULL
         OR (ly_do_thu_hoi = btrim(ly_do_thu_hoi) AND octet_length(ly_do_thu_hoi) > 0 AND octet_length(ly_do_thu_hoi) <= 2000));
ALTER TABLE rfq_invitations ADD CONSTRAINT rfq_invitations_ly_do_di_kem_thu_hoi
  CHECK (ly_do_thu_hoi IS NULL OR revoked_at IS NOT NULL);
GRANT UPDATE (ly_do_thu_hoi) ON rfq_invitations TO app_api;

-- ============================================================================================
-- (2) HAI RÀNG BUỘC CHECK CỦA BẢNG TÍN HIỆU MỞ THÊM HAI LOẠI, HAI NGUỒN
-- ============================================================================================
ALTER TABLE governance_signals DROP CONSTRAINT governance_signals_loai_check;
ALTER TABLE governance_signals ADD CONSTRAINT governance_signals_loai_check
  CHECK (loai IN ('PURCHASE_SPLITTING', 'ESTIMATE_UNDERSTATED', 'INVITE_LIST_NARROWED', 'EARLY_CLOSE'));
ALTER TABLE governance_signals DROP CONSTRAINT governance_signals_nguon_check;
ALTER TABLE governance_signals ADD CONSTRAINT governance_signals_nguon_check
  CHECK (nguon IN ('NOP_DUYET', 'GHI_NHAN', 'DE_XUAT', 'THU_HOI', 'DONG_SOM'));

-- ============================================================================================
-- (3) HÀM VỊ TỪ CỦA LẦN THU HỒI Ở OPEN — NGƯỠNG CẠNH TRANH CỦA BẬC GHIM
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO`. Đếm trên tập đếm được TRỪ lời mời đang thu hồi: trigger BEFORE UPDATE chưa thấy hàng mới.
CREATE OR REPLACE FUNCTION public.rfq_chot_thu_hoi(p_org uuid, p_rfq uuid, p_loi_moi uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bac jsonb;
  nguong integer;
  so integer;
  so_moi integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                  WHERE r.org_id = p_org AND r.id = p_rfq AND r.status = 'OPEN') THEN
    RETURN NULL;
  END IF;
  bac := public.rfq_bac_ghim(p_org, p_rfq);
  IF bac IS NULL OR (bac ->> 'dau_thau_chinh_thuc')::boolean IS TRUE THEN
    RETURN NULL;
  END IF;
  nguong := (bac ->> 'so_ncc_toi_thieu')::integer;
  IF nguong IS NULL THEN
    RAISE EXCEPTION 'Bac ghim thieu so_ncc_toi_thieu — ham theo bac khong tra loi duoc (K10c, ADR-082 (10))'
      USING ERRCODE = 'check_violation';
  END IF;
  so := public.rfq_dem_nhom_loi_moi(p_org, p_rfq,
          ARRAY(SELECT t.d FROM public.rfq_loi_moi_dem_duoc(p_org, p_rfq) AS t(d) WHERE t.d <> p_loi_moi));
  IF so >= nguong THEN
    RETURN NULL;
  END IF;
  SELECT count(*)::integer INTO so_moi
    FROM public.rfq_invitations i
   WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_at IS NULL AND i.id <> p_loi_moi;
  IF so_moi >= 1
     AND EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions e
                  WHERE e.org_id = p_org AND e.rfq_id = p_rfq AND e.hanh_dong = 'LAP'
                    AND e.loai = CASE WHEN so_moi = 1 THEN 'SINGLE_SOURCE' ELSE 'LIMITED_COMPETITION' END
                    AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                                     WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)) THEN
    RETURN NULL;
  END IF;
  RETURN 'K10C_THU_HOI_THIEU_CANH_TRANH';
END
$ham$;

-- ============================================================================================
-- (4) K4a — THÂN `080` NGUYÊN VĂN, NHÁNH THU HỒI MỞ THÊM `OPEN` CÓ LÝ DO VÀ QUA NGƯỠNG
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_invitations_kiem_danh_sach() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  ly_do text;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay goi thau cua loi moi (K4a)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF trang_thai = 'DRAFT' THEN
      NEW.moi_sau_khi_ky := false;
    ELSIF trang_thai = 'OPEN' THEN
      NEW.moi_sau_khi_ky := true;
    ELSE
      RAISE EXCEPTION 'Goi thau o % khong them loi moi duoc — chi o DRAFT, hoac OPEN (K4a)', trang_thai
        USING ERRCODE = 'check_violation', CONSTRAINT = 'k4a_them_sai_trang_thai';
    END IF;
    NEW.status := 'UNSENT';
    RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    IF trang_thai = 'OPEN' THEN
      IF NEW.ly_do_thu_hoi IS NULL THEN
        RAISE EXCEPTION 'Thu hoi loi moi o goi da mo phai co ly do (K10c)'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'k10c_thu_hoi_thieu_ly_do';
      END IF;
      ly_do := public.rfq_chot_thu_hoi(NEW.org_id, NEW.rfq_id, NEW.id);
      IF ly_do IS NOT NULL THEN
        RAISE EXCEPTION 'Thu hoi loi moi lam danh sach roi duoi nguong canh tranh cua bac ghim (K10c): %', ly_do
          USING ERRCODE = 'check_violation', CONSTRAINT = 'k10c_thu_hoi_thieu_canh_tranh';
      END IF;
    ELSIF trang_thai <> 'DRAFT' THEN
      RAISE EXCEPTION 'Loi moi chi thu hoi duoc khi goi con o DRAFT; goi dang o % (K4a)', trang_thai
        USING ERRCODE = 'check_violation', CONSTRAINT = 'k4a_thu_hoi_sai_trang_thai';
    END IF;
  END IF;
  IF OLD.status = 'UNSENT' AND NEW.status = 'SENT' AND trang_thai <> 'OPEN' THEN
    RAISE EXCEPTION 'Loi moi chi thanh SENT khi goi da OPEN; goi dang o % (K6)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'SENT' AND NEW.status = 'UNSENT' THEN
    RAISE EXCEPTION 'Loi moi da gui khong quay ve chua gui (K6)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (5) TÍN HIỆU THU HẸP DANH SÁCH MỜI — MỘT HÀM
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.tin_hieu_thu_hep(p_org uuid, p_rfq uuid) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  mo timestamptz;
  cs uuid;
  ds jsonb;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  SELECT r.opened_at INTO mo FROM public.rfq_packages r WHERE r.org_id = p_org AND r.id = p_rfq;
  IF NOT FOUND OR mo IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'loi_moi', i.id,
           'nguoi', i.revoked_by,
           'luc', to_char(i.revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           'ly_do', i.ly_do_thu_hoi) ORDER BY i.revoked_at, i.id)
    INTO ds
    FROM public.rfq_invitations i
   WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_at IS NOT NULL AND i.revoked_at >= mo;
  IF ds IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT b.policy_id INTO cs FROM public.rfq_budgets b WHERE b.org_id = p_org AND b.rfq_id = p_rfq;
  RETURN jsonb_build_object('loai', 'INVITE_LIST_NARROWED', 'chinh_sach', cs, 'goi', jsonb_build_array(p_rfq), 'thu_hoi', ds);
END
$ham$;

-- ============================================================================================
-- (6) TÍN HIỆU ĐÓNG SỚM KHI ĐÃ CÓ BÁO GIÁ — MỘT HÀM
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.tin_hieu_dong_som(p_org uuid, p_rfq uuid) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  g record;
  cs uuid;
  so integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  SELECT r.closed_at, r.deadline_at, r.closed_by, r.early_close_reason INTO g
    FROM public.rfq_packages r WHERE r.org_id = p_org AND r.id = p_rfq;
  IF NOT FOUND OR g.closed_at IS NULL OR g.deadline_at IS NULL OR g.closed_at >= g.deadline_at THEN
    RETURN NULL;
  END IF;
  SELECT count(*)::integer INTO so
    FROM public.vendor_bids b
    JOIN public.rfq_invitations i ON i.org_id = b.org_id AND i.id = b.invitation_id
   WHERE b.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_at IS NULL;
  IF so = 0 THEN
    RETURN NULL;
  END IF;
  SELECT b.policy_id INTO cs FROM public.rfq_budgets b WHERE b.org_id = p_org AND b.rfq_id = p_rfq;
  RETURN jsonb_build_object(
    'loai', 'EARLY_CLOSE',
    'chinh_sach', cs,
    'goi', jsonb_build_array(p_rfq),
    'han', to_char(g.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'dong_luc', to_char(g.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'nguoi_dong', g.closed_by,
    'ly_do', g.early_close_reason,
    'so_bao_gia', so);
END
$ham$;

-- ============================================================================================
-- (7) TÍN HIỆU HIỆN TẠI THEO LOẠI — THÂN `116` + HAI NHÁNH
-- ============================================================================================
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
  IF p_loai = 'INVITE_LIST_NARROWED' THEN
    RETURN public.tin_hieu_thu_hep(p_org, p_rfq);
  END IF;
  IF p_loai = 'EARLY_CLOSE' THEN
    RETURN public.tin_hieu_dong_som(p_org, p_rfq);
  END IF;
  RAISE EXCEPTION 'Loai tin hieu khong co: %', p_loai USING ERRCODE = 'check_violation';
END
$ham$;

-- ============================================================================================
-- (8) HÀNG TÍN HIỆU — BẰNG CHỨNG DO CSDL ĐẶT, THEO LOẠI — THÂN `116` + HAI NHÁNH
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
  IF NEW.loai = 'INVITE_LIST_NARROWED' THEN
    IF NEW.nguon NOT IN ('THU_HOI', 'GHI_NHAN') THEN
      RAISE EXCEPTION 'Tin hieu thu hep danh sach chi tinh o lan thu hoi hay lan ghi nhan (S3.6c)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_nguon_sai';
    END IF;
    IF NEW.nguon = 'THU_HOI' AND NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                    WHERE r.org_id = NEW.org_id AND r.id = NEW.rfq_id AND r.status = 'OPEN') THEN
      RAISE EXCEPTION 'Tin hieu thu hep danh sach ghi o lan thu hoi chi khi goi thau dang mo (S3.6c)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_goi_khong_mo';
    END IF;
    IF NEW.nguon = 'GHI_NHAN' AND NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                    WHERE r.org_id = NEW.org_id AND r.id = NEW.rfq_id AND r.status = 'AWARDED') THEN
      RAISE EXCEPTION 'Tin hieu thu hep danh sach ghi o lan ghi nhan chi khi goi thau dang co de xuat trao thau (S3.6c)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_goi_khong_trao';
    END IF;
    NEW.bang_chung := public.tin_hieu_thu_hep(NEW.org_id, NEW.rfq_id);
    IF NEW.bang_chung IS NULL THEN
      RAISE EXCEPTION 'Goi thau khong co tin hieu thu hep danh sach nao de ghi (S3.6c)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_khong_co';
    END IF;
    NEW.do_tin_cay := 'XAC_DINH';
    NEW.giai_thich := pg_catalog.format(
      '%s lời mời bị thu hồi sau khi gói thầu mở — danh sách người duyệt đã ký bị thu hẹp.',
      pg_catalog.jsonb_array_length(NEW.bang_chung -> 'thu_hoi'));
    NEW.tinh_luc := pg_catalog.clock_timestamp();
    RETURN NEW;
  END IF;
  IF NEW.loai = 'EARLY_CLOSE' THEN
    IF NEW.nguon NOT IN ('DONG_SOM', 'GHI_NHAN') THEN
      RAISE EXCEPTION 'Tin hieu dong som chi tinh o lan dong hay lan ghi nhan (S3.6c)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_nguon_sai';
    END IF;
    IF NEW.nguon = 'DONG_SOM' AND NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                    WHERE r.org_id = NEW.org_id AND r.id = NEW.rfq_id AND r.status = 'CLOSED') THEN
      RAISE EXCEPTION 'Tin hieu dong som ghi o lan dong chi khi goi thau vua dong (S3.6c)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_goi_khong_dong';
    END IF;
    IF NEW.nguon = 'GHI_NHAN' AND NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                    WHERE r.org_id = NEW.org_id AND r.id = NEW.rfq_id AND r.status = 'AWARDED') THEN
      RAISE EXCEPTION 'Tin hieu dong som ghi o lan ghi nhan chi khi goi thau dang co de xuat trao thau (S3.6c)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_goi_khong_trao';
    END IF;
    NEW.bang_chung := public.tin_hieu_dong_som(NEW.org_id, NEW.rfq_id);
    IF NEW.bang_chung IS NULL THEN
      RAISE EXCEPTION 'Goi thau khong co tin hieu dong som nao de ghi (S3.6c)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tin_hieu_khong_co';
    END IF;
    NEW.do_tin_cay := 'XAC_DINH';
    NEW.giai_thich := pg_catalog.format(
      'Gói thầu đóng lúc %s, trước hạn %s, khi đã có %s luồng báo giá.',
      NEW.bang_chung ->> 'dong_luc', NEW.bang_chung ->> 'han', NEW.bang_chung ->> 'so_bao_gia');
    NEW.tinh_luc := pg_catalog.clock_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Loai tin hieu khong co: %', NEW.loai USING ERRCODE = 'check_violation';
END
$ham$;

-- ============================================================================================
-- (9) LUẬT NGƯỜI GHI NHẬN — THEO LOẠI CỦA BẰNG CHỨNG — THÂN `116` + MỘT NHÁNH CHO HAI LOẠI MỚI
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
  IF (p_bang_chung ->> 'loai') IN ('INVITE_LIST_NARROWED', 'EARLY_CLOSE') THEN
    IF EXISTS (SELECT 1
                 FROM public.rfq_packages r
                WHERE r.org_id = p_org
                  AND r.id IN (SELECT (x #>> '{}')::uuid FROM pg_catalog.jsonb_array_elements(p_bang_chung -> 'goi') x)
                  AND (r.created_by = p_nguoi OR r.submitted_by = p_nguoi))
       OR EXISTS (SELECT 1
                    FROM pg_catalog.jsonb_array_elements(coalesce(p_bang_chung -> 'thu_hoi', '[]'::jsonb)) x
                   WHERE (x ->> 'nguoi')::uuid = p_nguoi)
       OR (p_bang_chung ->> 'nguoi_dong')::uuid = p_nguoi THEN
      RETURN 'K10C_TU_GHI_NHAN';
    END IF;
    IF EXISTS (SELECT 1
                 FROM public.org_procurement_policies p
                WHERE p.org_id = p_org
                  AND p.id = (p_bang_chung ->> 'chinh_sach')::uuid
                  AND p.created_by = p_nguoi) THEN
      RETURN 'K10C_TAC_GIA_CHINH_SACH';
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
-- (10) TRIGGER KIỂM LẦN GHI NHẬN — THEO LOẠI — THÂN `116` + HAI LOẠI CÙNG CẠNH CHỮ KÝ TRAO THẦU
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
  ELSIF s.loai IN ('INVITE_LIST_NARROWED', 'EARLY_CLOSE') THEN
    quyen := 'po.approve';
    IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                    WHERE r.org_id = NEW.org_id AND r.id = s.rfq_id AND r.status = 'AWARDED') THEN
      RAISE EXCEPTION 'Chi ghi nhan tin hieu thu hep danh sach hay dong som khi goi thau dang co de xuat trao thau (S3.6c)'
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
  IF ly_do = 'K10C_TU_GHI_NHAN' THEN
    RAISE EXCEPTION 'Nguoi tao, nguoi nop, nguoi thu hoi loi moi hay nguoi dong goi khong ghi nhan duoc tin hieu cua luot moi thau (K10c)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10c_nguoi_gay_ra_tu_ghi_nhan';
  END IF;
  IF ly_do = 'K10C_TAC_GIA_CHINH_SACH' THEN
    RAISE EXCEPTION 'Nguoi khai phien ban chinh sach cua goi khong ghi nhan duoc tin hieu cua luot moi thau (K10c)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10c_tac_gia_chinh_sach_ghi_nhan';
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
-- (11) CHỐT K10b/K10c Ở CHỮ KÝ DUYỆT TRAO THẦU — BA HÀM TÍN HIỆU, MỘT HÀM VỊ TỪ
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO`. Khai thấp hỏi trước (mã K10b như `116`), rồi thu hẹp, rồi đóng sớm (mã K10c dùng chung —
-- màn đọc từng loại qua `GET /rfqs/:rfqId/signals`). Một lần ghi nhận trỏ tới một tín hiệu có bằng chứng BẰNG kết quả hiện tại là đủ.
CREATE OR REPLACE FUNCTION public.award_chot_tin_hieu(p_org uuid, p_rfq uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bc jsonb;
BEGIN
  bc := public.tin_hieu_khai_thap(p_org, p_rfq);
  IF bc IS NOT NULL AND NOT EXISTS (SELECT 1
               FROM public.governance_signals s
               JOIN public.governance_signal_acks a ON a.org_id = s.org_id AND a.signal_id = s.id
              WHERE s.org_id = p_org AND s.rfq_id = p_rfq AND s.bang_chung = bc) THEN
    RETURN 'K10B_TIN_HIEU_CHUA_GHI_NHAN';
  END IF;
  bc := public.tin_hieu_thu_hep(p_org, p_rfq);
  IF bc IS NOT NULL AND NOT EXISTS (SELECT 1
               FROM public.governance_signals s
               JOIN public.governance_signal_acks a ON a.org_id = s.org_id AND a.signal_id = s.id
              WHERE s.org_id = p_org AND s.rfq_id = p_rfq AND s.bang_chung = bc) THEN
    RETURN 'K10C_TIN_HIEU_CHUA_GHI_NHAN';
  END IF;
  bc := public.tin_hieu_dong_som(p_org, p_rfq);
  IF bc IS NOT NULL AND NOT EXISTS (SELECT 1
               FROM public.governance_signals s
               JOIN public.governance_signal_acks a ON a.org_id = s.org_id AND a.signal_id = s.id
              WHERE s.org_id = p_org AND s.rfq_id = p_rfq AND s.bang_chung = bc) THEN
    RETURN 'K10C_TIN_HIEU_CHUA_GHI_NHAN';
  END IF;
  RETURN NULL;
END
$ham$;

-- Hàm của trigger `rfq_award_approvals_kiem_tin_hieu_khai_thap` (`116`, giữ nguyên trigger): tên ràng buộc theo mã — `k10b_*` cho khai
-- thấp, `k10c_tin_hieu_chua_ghi_nhan` cho hai loại của lượt mời thầu. Lớp chặn cuối cho câu chèn đi tắt.
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
  IF ly_do = 'K10B_TIN_HIEU_CHUA_GHI_NHAN' THEN
    RAISE EXCEPTION 'Chu ky trao thau chua ghi duoc (K10b): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10b_tin_hieu_chua_ghi_nhan';
  END IF;
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chu ky trao thau chua ghi duoc (K10c): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k10c_tin_hieu_chua_ghi_nhan';
  END IF;
  RETURN NEW;
END
$ham$;

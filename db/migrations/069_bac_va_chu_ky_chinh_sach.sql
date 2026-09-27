-- ==============================================================================================
-- 069_bac_va_chu_ky_chinh_sach — [S1.156 / S3.1a của spec S3] BẬC GIÁ TRỊ TRÊN PHIÊN BẢN CHÍNH
-- SÁCH, CHỮ KÝ THỨ HAI, CÔNG TẮC ADR-080, VÀ MỘT HÀM *PHIÊN BẢN HIỆU LỰC* CHO MỌI CHỖ ĐỌC CHÍNH SÁCH
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.1, §4.2, §9 (phần S3.1a).
-- ADR-080 (công tắc một chiều theo tổ chức, suy từ dữ liệu), ADR-082 ⑺ (chữ ký thứ hai của phiên bản).
--
-- (1) BẬC là một mảng `jsonb` trên CHÍNH hàng chính sách, khuôn `eval_components` (`056`): bất biến
--     bằng cấu tạo, vì bảng chỉ ghi thêm (`014`). Một trigger khi chèn giữ hình dạng — cận dưới tăng
--     ngặt, có bậc 0, khoá đúng kiểu, bậc đấu thầu chính thức chỉ ở cuối và chỉ mang hai khoá, vai ký
--     trao thầu là vai đang giữ `po.approve`. Hai cột mức chính sách đi kèm, tất-cả-hoặc-không.
-- (2) CHỮ KÝ THỨ HAI: `org_policy_signatures`, chỉ ghi thêm, khuôn `rfq_award_approvals` (`061`). Người ký
--     khác người tạo phiên bản, giữ `policy.manage`, ký bằng CHÍNH phiên của mình; chỉ phiên bản CÓ BẬC
--     nhận chữ ký; mỗi phiên bản một chữ ký.
-- (3) CÔNG TẮC: `to_chuc_da_bat_s3(org)` — có một phiên bản có bậc đã ký. Chính sách và chữ ký đều
--     không sửa, không xoá được, nên công tắc một chiều bằng cấu tạo. Từ lúc bật, phiên bản không bậc
--     bị từ chối. Và *đã bật* phải kéo theo *phiên bản hiệu lực có bậc*: chỉ ký được phiên bản MỚI NHẤT
--     đã tới ngày hiệu lực, dưới một khoá tư vấn theo tổ chức chung với lần chèn phiên bản — không thì
--     một phiên bản không bậc tạo TRƯỚC lần ký mà số cao hơn vẫn là phiên bản hiệu lực của một tổ chức
--     đã bật (đo: v1 không bậc, v2 có bậc, v3 không bậc, ký v2 ⇒ đã bật, hiệu lực là v3).
-- (4) PHIÊN BẢN HIỆU LỰC: `chinh_sach_hieu_luc(org, lúc)` — phiên bản CAO NHẤT đã tới `effective_from`,
--     và nếu có bậc thì đã được ký trước lúc ấy. Đo lúc làm: bốn chỗ tự chọn phiên bản hiện hành theo
--     ba luật khác nhau — `getActiveProcurementPolicy` (ngưỡng kép, ghim ngân sách), `docChinhSach`
--     (trọng số chấm, không xét `effective_from`), `rfq_che_do_nghiem` (`020`) và hai hàm hạn xoá khoá
--     (`026`, xếp `effective_from DESC`). Chỉ chặn ở một chỗ thì một người `policy.manage` tự tạo một
--     phiên bản chưa ai ký vẫn đổi được trọng số chấm và hạn xoá khoá — đúng thứ chữ ký thứ hai sinh ra
--     để chặn. Chủ dự án chọn hợp nhất cả bốn (S1.156). Tổ chức chỉ có phiên bản không bậc: hành vi
--     không đổi, trừ hai chỗ nói ra — lượt chấm nay tôn trọng `effective_from`, và hàm hạn xoá khoá xếp
--     theo `version DESC` như ba chỗ kia (khác nhau chỉ khi `effective_from` không đơn điệu theo phiên bản).
-- (5) GHIM NGÂN SÁCH: ngân sách không ghim được một phiên bản có bậc CHƯA KÝ — đường ghi đi vòng qua
--     SQL viết tay là đường thứ năm để một phiên bản chưa ký có hiệu lực (`rfq_can_phe_duyet_kep` và
--     nhánh ⑴ của `rfq_che_do_nghiem` đọc chính sách mà ngân sách ghim).
--
-- THỨ MIGRATION NÀY KHÔNG LÀM (S3.1b trở đi): ngân sách bắt buộc, ghim đúng phiên bản hiệu lực lúc nộp
-- duyệt, `rfq_bac_cua` và `tier_tu_so_tien`, K1, lớp `CONTROL_DENIED`. Không route, không màn hình.
-- ==============================================================================================

-- ============================================================================================
-- (1) BẬC VÀ MỨC CHÍNH SÁCH
-- ============================================================================================
ALTER TABLE org_procurement_policies
  ADD COLUMN tiers                    jsonb,
  ADD COLUMN chia_nho_cua_so_ngay     integer,
  ADD COLUMN tham_dinh_hieu_luc_thang integer;

-- Hai cột mức chính sách: cùng khai hoặc cùng chưa khai, và dương khi khai.
ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_muc_s3_du_bo
  CHECK ((chia_nho_cua_so_ngay IS NULL) = (tham_dinh_hieu_luc_thang IS NULL));
ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_muc_s3_duong
  CHECK (chia_nho_cua_so_ngay IS NULL
         OR (chia_nho_cua_so_ngay OPERATOR(pg_catalog.>) 0 AND tham_dinh_hieu_luc_thang OPERATOR(pg_catalog.>) 0));
-- Phiên bản có bậc là phiên bản của một tổ chức sắp bật S3, và S3.6/S3.7 đọc hai cột mức này.
ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_bac_kem_muc_s3
  CHECK (tiers IS NULL OR chia_nho_cua_so_ngay IS NOT NULL);

-- Quyền theo CỘT là cộng dồn — THÊM ba cột vào tập `INSERT` của `014`, `020`, `026`, `056`. Vẫn KHÔNG
-- có `UPDATE`/`DELETE`: đổi chính sách là thêm một phiên bản.
GRANT INSERT (tiers, chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang) ON org_procurement_policies TO app_api;

-- Hình dạng của `tiers`, kiểm khi chèn. Mười khoá của một bậc thường; bậc đấu thầu chính thức chỉ mang
-- `tu_so_tien` và `dau_thau_chinh_thuc`, và chỉ đứng cuối (spec §4.1: V2.1 §12 11.1 *"> 10B → Formal
-- Tender"*). `award_vai` đọc `role_permissions` LÚC CHÈN: một vai không giữ `po.approve` thì không ký
-- được trao thầu, nên khai nó vào bậc là khai một chữ ký không ai ký được.
CREATE OR REPLACE FUNCTION public.chinh_sach_kiem_bac() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  KHOA_BAC constant text[] := ARRAY['tu_so_tien', 'so_ncc_toi_thieu', 'award_vai_khac_nhau', 'ky_danh_sach_moi',
                                    'xoay_vong_n', 'award_so_chu_ky', 'award_vai', 'tham_dinh_truoc_trao',
                                    'khai_xung_dot', 'dau_thau_chinh_thuc'];
  KHOA_DUNG constant text[] := ARRAY['award_vai_khac_nhau', 'ky_danh_sach_moi', 'tham_dinh_truoc_trao',
                                     'khai_xung_dot'];
  so_bac integer;
  bac jsonb;
  khoa text;
  so_khoa integer;
  tu numeric;
  tu_truoc numeric;
  n numeric;
BEGIN
  IF NEW.tiers IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.tiers) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.tiers) = 0 THEN
    RAISE EXCEPTION 'tiers phai la mot mang JSON khong rong (S3.1a)'
      USING ERRCODE = 'check_violation';
  END IF;
  so_bac := jsonb_array_length(NEW.tiers);
  FOR i IN 0 .. so_bac - 1 LOOP
    bac := NEW.tiers -> i;
    IF jsonb_typeof(bac) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'bac % khong phai mot doi tuong JSON (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    so_khoa := 0;
    FOR khoa IN SELECT k FROM jsonb_object_keys(bac) AS k LOOP
      IF NOT (khoa = ANY (KHOA_BAC)) THEN
        RAISE EXCEPTION 'bac % mang khoa la "%" (S3.1a)', i, khoa
          USING ERRCODE = 'check_violation';
      END IF;
      so_khoa := so_khoa + 1;
    END LOOP;

    IF jsonb_typeof(bac -> 'tu_so_tien') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'bac % thieu tu_so_tien kieu so (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    tu := (bac ->> 'tu_so_tien')::numeric;
    IF tu < 0 OR tu >= 10000000000000000 OR tu <> round(tu, 2) THEN
      RAISE EXCEPTION 'bac % co tu_so_tien ngoai numeric(18,2) khong am (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF i = 0 AND tu <> 0 THEN
      RAISE EXCEPTION 'bac dau phai co tu_so_tien = 0 — khe ho duoi bac dau khong dien dat duoc (S3.1a)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF i > 0 AND tu <= tu_truoc THEN
      RAISE EXCEPTION 'can duoi cua cac bac phai tang ngat: bac % co % <= % (S3.1a)', i, tu, tu_truoc
        USING ERRCODE = 'check_violation';
    END IF;
    tu_truoc := tu;

    IF jsonb_typeof(bac -> 'dau_thau_chinh_thuc') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'bac % thieu dau_thau_chinh_thuc kieu boolean (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF (bac ->> 'dau_thau_chinh_thuc')::boolean THEN
      IF i <> so_bac - 1 THEN
        RAISE EXCEPTION 'bac dau thau chinh thuc chi dung CUOI (S3.1a)'
          USING ERRCODE = 'check_violation';
      END IF;
      IF so_khoa <> 2 THEN
        RAISE EXCEPTION 'bac dau thau chinh thuc chi mang tu_so_tien va dau_thau_chinh_thuc (S3.1a)'
          USING ERRCODE = 'check_violation';
      END IF;
      CONTINUE;
    END IF;

    IF so_khoa <> array_length(KHOA_BAC, 1) THEN
      RAISE EXCEPTION 'bac % phai khai du % khoa, dang co % (S3.1a)', i, array_length(KHOA_BAC, 1), so_khoa
        USING ERRCODE = 'check_violation';
    END IF;
    FOREACH khoa IN ARRAY KHOA_DUNG LOOP
      IF jsonb_typeof(bac -> khoa) IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'bac % co % khong phai boolean (S3.1a)', i, khoa
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    IF jsonb_typeof(bac -> 'so_ncc_toi_thieu') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'bac % co so_ncc_toi_thieu khong phai so (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    n := (bac ->> 'so_ncc_toi_thieu')::numeric;
    IF n <> trunc(n) OR n < 1 OR n > 32767 THEN
      RAISE EXCEPTION 'bac % co so_ncc_toi_thieu phai la so nguyen trong [1, 32767] (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(bac -> 'xoay_vong_n') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'bac % co xoay_vong_n khong phai so (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    n := (bac ->> 'xoay_vong_n')::numeric;
    IF n <> trunc(n) OR n < 0 OR n > 32767 THEN
      RAISE EXCEPTION 'bac % co xoay_vong_n phai la so nguyen trong [0, 32767] (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(bac -> 'award_so_chu_ky') IS DISTINCT FROM 'number'
       OR (bac ->> 'award_so_chu_ky')::numeric NOT IN (1, 2) THEN
      RAISE EXCEPTION 'bac % co award_so_chu_ky phai la 1 hoac 2 (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(bac -> 'award_vai') IS DISTINCT FROM 'array' OR jsonb_array_length(bac -> 'award_vai') = 0 THEN
      RAISE EXCEPTION 'bac % co award_vai phai la mang vai khong rong (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(bac -> 'award_vai') AS e(v) WHERE jsonb_typeof(e.v) <> 'string') THEN
      RAISE EXCEPTION 'bac % co award_vai chua phan tu khong phai chuoi (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(DISTINCT v) FROM jsonb_array_elements_text(bac -> 'award_vai') AS e(v))
       <> jsonb_array_length(bac -> 'award_vai') THEN
      RAISE EXCEPTION 'bac % co award_vai lap vai (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(bac -> 'award_vai') AS e(v)
                WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                                   WHERE rp.role_code = e.v AND rp.permission_code = 'po.approve')) THEN
      RAISE EXCEPTION 'bac % co award_vai mang mot vai khong giu po.approve (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
    IF (bac ->> 'award_so_chu_ky')::numeric = 2 AND (bac ->> 'award_vai_khac_nhau')::boolean
       AND jsonb_array_length(bac -> 'award_vai') < 2 THEN
      RAISE EXCEPTION 'bac % doi hai chu ky o hai vai khac nhau ma award_vai chi co mot vai (S3.1a)', i
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER org_procurement_policies_kiem_bac
  BEFORE INSERT ON org_procurement_policies
  FOR EACH ROW EXECUTE FUNCTION public.chinh_sach_kiem_bac();
ALTER TABLE org_procurement_policies ENABLE ALWAYS TRIGGER org_procurement_policies_kiem_bac;

-- ============================================================================================
-- (2) CHỮ KÝ THỨ HAI CỦA PHIÊN BẢN — CHỈ GHI THÊM, KHUÔN `rfq_award_approvals`
-- ============================================================================================
CREATE TABLE org_policy_signatures (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id),
  policy_id            uuid NOT NULL,
  signed_by            uuid NOT NULL,
  signed_by_session_id uuid NOT NULL,
  signed_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, policy_id) REFERENCES org_procurement_policies (org_id, id),
  FOREIGN KEY (org_id, signed_by) REFERENCES users (org_id, id),
  -- Một phiên bản, một chữ ký: *đã ký* không mơ hồ, và `signed_at` là MỘT mốc.
  UNIQUE (org_id, policy_id)
);

ALTER TABLE org_policy_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_policy_signatures FORCE ROW LEVEL SECURITY;

CREATE POLICY org_policy_signatures_tenant_isolation ON org_policy_signatures
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: nhà cung cấp không có việc gì với
-- chữ ký chính sách của bên mua.
CREATE POLICY org_policy_signatures_khach ON org_policy_signatures AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `signed_at` do CSDL đặt. `app_unseal` không đụng bảng này.
GRANT SELECT ON org_policy_signatures TO app_api;
GRANT INSERT (org_id, policy_id, signed_by, signed_by_session_id) ON org_policy_signatures TO app_api;

-- [ADR-016] Người ký là DẪN XUẤT từ phiên, khuôn `rfq_award_approvals_kiem_danh_tinh`.
CREATE TRIGGER org_policy_signatures_kiem_danh_tinh
  BEFORE INSERT ON org_policy_signatures
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'signed_by', 'signed_by_session_id');
ALTER TABLE org_policy_signatures ENABLE ALWAYS TRIGGER org_policy_signatures_kiem_danh_tinh;

-- Chỉ ghi thêm bằng HAI lớp, khuôn `061`: không quyền UPDATE/DELETE, và trigger chặn cả vai sở hữu.
CREATE TRIGGER org_policy_signatures_chi_ghi_them
  BEFORE UPDATE OR DELETE ON org_policy_signatures
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE org_policy_signatures ENABLE ALWAYS TRIGGER org_policy_signatures_chi_ghi_them;

CREATE TRIGGER org_policy_signatures_chan_truncate
  BEFORE TRUNCATE ON org_policy_signatures
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE org_policy_signatures ENABLE ALWAYS TRIGGER org_policy_signatures_chan_truncate;

-- Phân tách nhiệm vụ của chữ ký (ADR-082 ⑺): người ký KHÁC người tạo phiên bản và giữ
-- `policy.manage`; chỉ phiên bản có bậc nhận chữ ký. Tên trigger xếp SAU `_kiem_danh_tinh`, nên
-- `signed_by` đã là người của phiên khi thân này đọc nó.
-- Hai vế cuối giữ *đã bật ⇒ phiên bản hiệu lực có bậc* (ADR-080, mục (3) đầu tệp): phiên bản được ký
-- là phiên bản MỚI NHẤT của tổ chức, và đã tới ngày hiệu lực lúc ký. Khoá tư vấn theo TỔ CHỨC, khuôn
-- `bafo_kiem_vong` (`059`) — `app_api` không có `UPDATE` trên bảng chính sách nên khoá HÀNG là bất khả —
-- và CÙNG khoá với `chinh_sach_da_bat_thi_phai_co_bac`: không có nó, lần ký và lần chèn một phiên bản
-- không bậc đồng thời cùng đọc trạng thái cũ và cùng đi qua. Hạt giống `2`: `0` là khoá sổ kiểm toán
-- theo tổ chức (`004`), và câu ghi chính sách luôn đứng TRƯỚC câu ghi sổ nên hai khoá lấy cùng một thứ tự.
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

CREATE TRIGGER org_policy_signatures_kiem_nguoi_ky
  BEFORE INSERT ON org_policy_signatures
  FOR EACH ROW EXECUTE FUNCTION public.chinh_sach_kiem_nguoi_ky();
ALTER TABLE org_policy_signatures ENABLE ALWAYS TRIGGER org_policy_signatures_kiem_nguoi_ky;

-- ============================================================================================
-- (3) CÔNG TẮC ADR-080 — SUY TỪ DỮ LIỆU, MỘT CHIỀU BẰNG CẤU TẠO
-- ============================================================================================
-- Không SECURITY DEFINER (hardening §C): chạy dưới quyền người gọi, RLS áp. Hỏi về một tổ chức khác
-- thì không thấy hàng nào và trả `false`.
CREATE OR REPLACE FUNCTION public.to_chuc_da_bat_s3(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT EXISTS (
    SELECT 1
      FROM public.org_procurement_policies p
      JOIN public.org_policy_signatures s ON s.org_id = p.org_id AND s.policy_id = p.id
     WHERE p.org_id = p_org AND p.tiers IS NOT NULL)
$ham$;

-- Cùng khoá tư vấn với lần ký (`chinh_sach_kiem_nguoi_ky`, mục (2)) — xem lý do ở đó.
CREATE OR REPLACE FUNCTION public.chinh_sach_da_bat_thi_phai_co_bac() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));
  IF NEW.tiers IS NULL AND public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'To chuc da bat S3 (ADR-080): phien ban chinh sach moi phai khai bac gia tri'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER org_procurement_policies_da_bat_thi_phai_co_bac
  BEFORE INSERT ON org_procurement_policies
  FOR EACH ROW EXECUTE FUNCTION public.chinh_sach_da_bat_thi_phai_co_bac();
ALTER TABLE org_procurement_policies ENABLE ALWAYS TRIGGER org_procurement_policies_da_bat_thi_phai_co_bac;

-- ============================================================================================
-- (4) PHIÊN BẢN HIỆU LỰC — MỘT HÀM, BỐN CHỖ ĐỌC
-- ============================================================================================
-- Phiên bản CAO NHẤT đã tới `effective_from` lúc `p_luc`, và — nếu có bậc — đã ký TRƯỚC lúc ấy. Hỏi
-- theo một mốc chứ không theo `now()`, để một gói tạo trước lần ký giữ chính sách của lúc nó ra đời.
CREATE OR REPLACE FUNCTION public.chinh_sach_hieu_luc(p_org uuid, p_luc timestamptz) RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT p.id
    FROM public.org_procurement_policies p
   WHERE p.org_id = p_org
     AND p.effective_from <= p_luc
     AND (p.tiers IS NULL
          OR EXISTS (SELECT 1 FROM public.org_policy_signatures s
                      WHERE s.org_id = p.org_id AND s.policy_id = p.id AND s.signed_at <= p_luc))
   ORDER BY p.version DESC
   LIMIT 1
$ham$;

-- `020` ⑵: gói không có ngân sách đọc phiên bản hiệu lực lúc nó ra đời. Nhánh ⑴ (ngân sách ghim) giữ
-- nguyên — mục (5) dưới chặn ghim một phiên bản chưa ký.
CREATE OR REPLACE FUNCTION public.rfq_che_do_nghiem(p_rfq uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT coalesce(
    (SELECT cs.strict_blind_mode
       FROM public.rfq_budgets b
       JOIN public.org_procurement_policies cs
         ON cs.id = b.policy_id AND cs.org_id = b.org_id
      WHERE b.rfq_id = p_rfq),
    (SELECT cs.strict_blind_mode
       FROM public.rfq_packages r
       JOIN public.org_procurement_policies cs ON cs.org_id = r.org_id
      WHERE r.id = p_rfq AND cs.id = public.chinh_sach_hieu_luc(r.org_id, r.created_at)),
    true)
$ham$;

-- `026`: cả hai chỗ đọc hạn xoá khoá đi qua cùng hàm. Thân còn lại NGUYÊN VĂN `026`.
CREATE OR REPLACE FUNCTION public.rfq_khoa_du_dieu_kien_xoa(p_rfq_id uuid)
  RETURNS TABLE (key_material_id uuid, revoked_at timestamptz, du_dieu_kien boolean, ly_do text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_gio integer;
BEGIN
  SELECT p.key_purge_grace_hours INTO v_gio
    FROM org_procurement_policies p
    JOIN rfq_packages r ON r.org_id OPERATOR(pg_catalog.=) p.org_id
   WHERE r.id OPERATOR(pg_catalog.=) p_rfq_id
     AND p.id OPERATOR(pg_catalog.=) public.chinh_sach_hieu_luc(r.org_id, r.created_at);

  RETURN QUERY
  SELECT k.id,
         k.revoked_at,
         CASE
           WHEN k.purged_at IS NOT NULL THEN false
           WHEN k.revoked_at IS NULL THEN false
           WHEN v_gio IS NULL THEN false
           ELSE clock_timestamp()
                OPERATOR(pg_catalog.>=) (k.revoked_at + make_interval(hours => v_gio))
         END,
         CASE
           WHEN k.purged_at IS NOT NULL THEN 'DA_XOA'
           WHEN k.revoked_at IS NULL THEN 'CHUA_THU_HOI'
           WHEN v_gio IS NULL THEN 'CHINH_SACH_TAT'
           WHEN clock_timestamp()
                OPERATOR(pg_catalog.<) (k.revoked_at + make_interval(hours => v_gio))
             THEN 'CON_TRONG_AN_HAN'
           ELSE 'DU_DIEU_KIEN'
         END
    FROM rfq_key_material k
   WHERE k.rfq_id OPERATOR(pg_catalog.=) p_rfq_id;
END
$ham$;

CREATE OR REPLACE FUNCTION public.rfq_key_material_bat_bien() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_gio integer;
BEGIN
  IF TG_OP OPERATOR(pg_catalog.=) 'DELETE' THEN
    RAISE EXCEPTION 'Khong duoc xoa vat lieu khoa cua RFQ (G2/G4)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
     OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
     OR NEW.public_key IS DISTINCT FROM OLD.public_key
     OR NEW.key_version IS DISTINCT FROM OLD.key_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_by_session_id IS DISTINCT FROM OLD.created_by_session_id THEN
    RAISE EXCEPTION 'Chi sua duoc bon cot thu hoi va ba cot xoa cua rfq_key_material'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Thu hồi là MỘT CHIỀU. Gỡ thu hồi là làm sống lại một khoá đã được tuyên là chết.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'Khong go duoc thu hoi cua vat lieu khoa'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Xoá cũng MỘT CHIỀU: đã xoá thì không hàng nào ở trên nó sửa được nữa.
  IF OLD.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'Vat lieu khoa da bi xoa — khong sua duoc nua'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.wrapped_private_key IS DISTINCT FROM OLD.wrapped_private_key THEN
    -- Điều kiện ⑷: hướng DUY NHẤT được phép là về NULL. Một giá trị mới khác NULL là một lần
    -- THAY KHOÁ nguỵ trang, và `app_api` không đọc được cột này nên nó cũng không kiểm chứng
    -- được mình đang thay bằng cái gì.
    IF NEW.wrapped_private_key IS NOT NULL THEN
      RAISE EXCEPTION 'Chi duoc xoa wrapped_private_key ve NULL, khong duoc thay gia tri khac'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.purged_at IS NULL THEN
      RAISE EXCEPTION 'Xoa wrapped_private_key phai di kem purged_at'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Điều kiện ⑴.
    IF OLD.revoked_at IS NULL THEN
      RAISE EXCEPTION 'Chi xoa duoc vat lieu khoa DA THU HOI'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Điều kiện ⑵ và ⑶, đọc lại từ chính sách chứ không tin lời người gọi.
    SELECT p.key_purge_grace_hours INTO v_gio
      FROM org_procurement_policies p
      JOIN rfq_packages r ON r.org_id OPERATOR(pg_catalog.=) p.org_id
     WHERE r.id OPERATOR(pg_catalog.=) OLD.rfq_id
       AND p.id OPERATOR(pg_catalog.=) public.chinh_sach_hieu_luc(r.org_id, r.created_at);
    IF v_gio IS NULL THEN
      RAISE EXCEPTION 'Chinh sach cua to chuc KHONG bat xoa vat lieu khoa (key_purge_grace_hours NULL)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF clock_timestamp()
       OPERATOR(pg_catalog.<) (OLD.revoked_at + make_interval(hours => v_gio)) THEN
      RAISE EXCEPTION 'Con trong quang an han — chua xoa duoc vat lieu khoa'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
    -- Đánh dấu đã xoá mà không thật sự xoá là một câu nói dối trong chính bảng. `CHECK` ở (2) đã
    -- chặn, nhưng nói ra ở đây cho ra thông điệp đọc được thay vì một tên ràng buộc.
    RAISE EXCEPTION 'purged_at chi duoc dat CUNG LUC voi viec xoa wrapped_private_key'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (5) NGÂN SÁCH KHÔNG GHIM ĐƯỢC PHIÊN BẢN CÓ BẬC CHƯA KÝ
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.ngan_sach_khong_ghim_ban_chua_ky() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF EXISTS (SELECT 1
               FROM public.org_procurement_policies p
              WHERE p.org_id = NEW.org_id AND p.id = NEW.policy_id AND p.tiers IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.org_policy_signatures s
                                 WHERE s.org_id = p.org_id AND s.policy_id = p.id)) THEN
    RAISE EXCEPTION 'Ngan sach khong duoc ghim mot phien ban chinh sach co bac CHUA KY (ADR-082)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_budgets_khong_ghim_ban_chua_ky
  BEFORE INSERT OR UPDATE ON rfq_budgets
  FOR EACH ROW EXECUTE FUNCTION public.ngan_sach_khong_ghim_ban_chua_ky();
ALTER TABLE rfq_budgets ENABLE ALWAYS TRIGGER rfq_budgets_khong_ghim_ban_chua_ky;

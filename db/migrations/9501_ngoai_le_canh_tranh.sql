-- ==============================================================================================
-- 9501_ngoai_le_canh_tranh — [S1.9101 / S3.3b của spec S3] NGOẠI LỆ CẠNH TRANH; LẦN TỪ CHỐI K4a CÓ TÊN (khoản 255)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.4, §5.1 (K4, K12), §9 (S3.3). ADR-084 ⑵
-- ⑷, ADR-108. Chủ dự án chốt ngày 2026-09-29: sàn giải trình của mã `OTHER` là 100 byte; lần từ chối K4a vào sổ
-- `CONTROL_DENIED` (khoản 255); và năm điểm hình dạng của S3.3b — người giữ `rfq.invite` lập và rút ngoại lệ, chỉ ở DRAFT;
-- CHECK nhận đủ năm loại nhưng đường ghi chỉ mở ba loại của danh sách mời; băm danh sách phủ ngoại lệ còn sống; phép khớp
-- loại với danh sách thật và chữ ký K5 bắt buộc để S3.3c; ba tên ràng buộc K4a.
--
-- (1) BẢNG `rfq_sourcing_exceptions`, CHỈ GHI THÊM KÈM HÀNG RÚT — khuôn `rfq_awards` (`061`). Hai loại hàng: `LAP` mang
--     loại, mã lý do và giải trình; `RUT` trỏ về đúng một hàng `LAP` và mang lý do rút ở cột giải trình. Một ngoại lệ còn
--     sống khi không hàng `RUT` nào trỏ về nó. `UNIQUE (org_id, ngoai_le_id)` giữ mỗi ngoại lệ một lần rút, kể cả khi hai
--     lần rút đua nhau.
-- (2) TRIGGER `ngoai_le_kiem` đọc DỮ LIỆU THẬT lúc chèn: tổ chức đã bật S3; người ghi giữ `rfq.invite` (ADR-084 ⑵ — lớp gói
--     đã hỏi trước, trigger là lớp có thẩm quyền); gói ở DRAFT — vế này mang TÊN `k4a_ngoai_le_sai_trang_thai` nên tầng gói
--     ghi `CONTROL_DENIED` (K12); hàng `LAP` chỉ ba loại của danh sách mời (`LOW_ACTUAL_COMPETITION` là của trao thầu, S3.5;
--     `LIST_NARROWED_BELOW_MIN` là của thu hồi ở OPEN, S3.6); hàng `RUT` trỏ về một hàng `LAP` chưa rút của CÙNG gói.
-- (3) BĂM DANH SÁCH (`rfq_bam_danh_sach`, `076`) PHỦ NGOẠI LỆ CÒN SỐNG: người duyệt ký lên danh sách mời CÙNG ngoại lệ của
--     nó (spec §4.4). Ngoại lệ đã rút ra khỏi băm — nếu không, một ngoại lệ ghi nhầm nằm mãi trong băm. Gói không có ngoại lệ
--     nào giữ NGUYÊN băm cũ: dòng thêm vào chỉ sinh khi có ngoại lệ sống, nên không chữ ký K4b nào đã có mất hiệu lực.
-- (4) KHOẢN 255: hai nhánh K4a của `rfq_invitations_kiem_danh_sach` (`076`) mang tên ràng buộc — `k4a_them_sai_trang_thai`,
--     `k4a_thu_hoi_sai_trang_thai` —, thân còn lại giữ nguyên chữ. Nhánh K6 không tên: không lời gọi nào của người dùng tới được.
--
-- Mọi hàm và trigger mới hay đổi thân ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) BẢNG
-- ============================================================================================
CREATE TABLE rfq_sourcing_exceptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  rfq_id                uuid NOT NULL,
  hanh_dong             text NOT NULL CHECK (hanh_dong IN ('LAP', 'RUT')),
  -- Hàng `RUT` trỏ về hàng `LAP` nó rút; hàng `LAP` để trống.
  ngoai_le_id           uuid,
  -- Tập ĐÓNG của spec §4.4: năm loại, bảy mã lý do (V2.1 §12 11.2). Trống ở hàng `RUT`.
  loai                  text CHECK (loai IS NULL OR loai IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION',
                                                             'LOW_ACTUAL_COMPETITION', 'LIST_NARROWED_BELOW_MIN')),
  ma_ly_do              text CHECK (ma_ly_do IS NULL OR ma_ly_do IN ('PROPRIETARY_TECHNOLOGY', 'EXISTING_CONTRACT', 'EMERGENCY',
                                                                     'NO_ALTERNATIVE', 'COMPATIBILITY', 'REGULATORY', 'OTHER')),
  -- Giải trình ở hàng `LAP`, lý do rút ở hàng `RUT`. Không rỗng, trần 2000 byte như lý do trả gói về soạn thảo.
  giai_trinh            text NOT NULL CHECK (octet_length(btrim(giai_trinh)) > 0 AND octet_length(giai_trinh) <= 2000),
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  -- Tiền đề cho khoá ngoại tự trỏ của hàng `RUT`.
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, ngoai_le_id) REFERENCES rfq_sourcing_exceptions (org_id, id),
  CONSTRAINT rfq_sourcing_exceptions_hinh_dang CHECK (
    (hanh_dong = 'LAP' AND loai IS NOT NULL AND ma_ly_do IS NOT NULL AND ngoai_le_id IS NULL)
    OR (hanh_dong = 'RUT' AND loai IS NULL AND ma_ly_do IS NULL AND ngoai_le_id IS NOT NULL)),
  -- Sàn của mã `OTHER`: 100 byte sau khi cắt khoảng trắng — chủ dự án chốt 2026-09-29. Một mã *"khác"* không kèm lời giải
  -- thích đủ dài là đúng cái nút bấm ai cũng ký mà spec §8.1 gọi là kiểm soát giả.
  CONSTRAINT rfq_sourcing_exceptions_san_other CHECK (ma_ly_do IS DISTINCT FROM 'OTHER' OR octet_length(btrim(giai_trinh)) >= 100),
  -- Mỗi ngoại lệ rút một lần.
  UNIQUE (org_id, ngoai_le_id)
);

CREATE INDEX rfq_sourcing_exceptions_theo_goi ON rfq_sourcing_exceptions (org_id, rfq_id);

ALTER TABLE rfq_sourcing_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_sourcing_exceptions FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_sourcing_exceptions_tenant_isolation ON rfq_sourcing_exceptions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: vì sao người mua không mời đủ nhà cung cấp là việc nội bộ.
CREATE POLICY rfq_sourcing_exceptions_khach ON rfq_sourcing_exceptions AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `id` KHÔNG được cấp (INV-H14). KHÔNG `UPDATE`, KHÔNG `DELETE`: chỉ ghi thêm. `app_unseal` không đụng bảng này.
GRANT SELECT ON rfq_sourcing_exceptions TO app_api;
GRANT INSERT (org_id, rfq_id, hanh_dong, ngoai_le_id, loai, ma_ly_do, giai_trinh, created_by, created_by_session_id)
  ON rfq_sourcing_exceptions TO app_api;

-- [ADR-016] Tác giả là DẪN XUẤT từ phiên — K5 (S3.3c) loại tác giả ngoại lệ khỏi người ký, nên cột này phải thật.
CREATE TRIGGER rfq_sourcing_exceptions_kiem_danh_tinh
  BEFORE INSERT ON rfq_sourcing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE rfq_sourcing_exceptions ENABLE ALWAYS TRIGGER rfq_sourcing_exceptions_kiem_danh_tinh;

CREATE TRIGGER rfq_sourcing_exceptions_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_sourcing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_sourcing_exceptions ENABLE ALWAYS TRIGGER rfq_sourcing_exceptions_chi_ghi_them;

CREATE TRIGGER rfq_sourcing_exceptions_chan_truncate
  BEFORE TRUNCATE ON rfq_sourcing_exceptions
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_sourcing_exceptions ENABLE ALWAYS TRIGGER rfq_sourcing_exceptions_chan_truncate;

-- ============================================================================================
-- (2) LUẬT GHI — tên trigger xếp SAU `_kiem_danh_tinh` (`n` > `k`… `kiem_n` > `kiem_d`) nên `created_by` đã là người của phiên
-- ============================================================================================
-- Khoá hàng gói `FOR SHARE` như `rfq_invitations_kiem_danh_sach`: lần nộp duyệt cập nhật chính hàng ấy, nên một ngoại lệ ghi
-- đua với lần nộp duyệt hoặc đứng trước (vào băm ở chữ ký) hoặc thấy gói đã rời DRAFT.
CREATE OR REPLACE FUNCTION public.ngoai_le_kiem() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  goc_hanh_dong text;
  goc_rfq uuid;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Chi to chuc da bat S3 moi lap ngoai le canh tranh (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay goi thau cua ngoai le (K4a)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                    AND rp.permission_code = 'rfq.invite') THEN
    RAISE EXCEPTION 'Nguoi lap hay rut ngoai le phai giu rfq.invite (ADR-084)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Ngoai le chi lap hay rut khi goi con o DRAFT; goi dang o % (K4a)', trang_thai
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k4a_ngoai_le_sai_trang_thai';
  END IF;
  IF NEW.hanh_dong = 'LAP' THEN
    IF NEW.loai NOT IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION') THEN
      RAISE EXCEPTION 'Ngoai le % khong lap o danh sach moi (K4a)', NEW.loai
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT e.hanh_dong, e.rfq_id INTO goc_hanh_dong, goc_rfq
    FROM public.rfq_sourcing_exceptions e
   WHERE e.org_id = NEW.org_id AND e.id = NEW.ngoai_le_id;
  IF NOT FOUND OR goc_hanh_dong <> 'LAP' OR goc_rfq <> NEW.rfq_id THEN
    RAISE EXCEPTION 'Hang rut phai tro ve mot ngoai le da lap cua cung goi thau (K4a)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_sourcing_exceptions_kiem_ngoai_le
  BEFORE INSERT ON rfq_sourcing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.ngoai_le_kiem();
ALTER TABLE rfq_sourcing_exceptions ENABLE ALWAYS TRIGGER rfq_sourcing_exceptions_kiem_ngoai_le;

-- ============================================================================================
-- (3) BĂM DANH SÁCH PHỦ NGOẠI LỆ CÒN SỐNG
-- ============================================================================================
-- Giải trình vào băm qua sha256 của nó: dòng băm giữ độ dài cố định, và đổi một chữ giải trình là đổi băm.
CREATE OR REPLACE FUNCTION public.rfq_bam_danh_sach(p_rfq uuid) RETURNS bytea
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT sha256(convert_to(
    coalesce((SELECT string_agg(d.dong, E'\n' ORDER BY d.dong COLLATE "C")
                FROM (SELECT 'MOI|' || i.supplier_id::text || '|' || i.contact_id::text || '|' || i.link_channel AS dong
                        FROM public.rfq_invitations i
                       WHERE i.rfq_id = p_rfq AND i.revoked_at IS NULL
                      UNION ALL
                      SELECT 'NGOAI_LE|' || e.id::text || '|' || e.loai || '|' || e.ma_ly_do || '|'
                             || encode(sha256(convert_to(e.giai_trinh, 'UTF8')), 'hex') AS dong
                        FROM public.rfq_sourcing_exceptions e
                       WHERE e.rfq_id = p_rfq AND e.hanh_dong = 'LAP'
                         AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                                          WHERE r.org_id = e.org_id AND r.ngoai_le_id = e.id)) d), ''),
    'UTF8'))
$ham$;

-- ============================================================================================
-- (4) KHOẢN 255 — HAI NHÁNH K4a CỦA LỜI MỜI MANG TÊN RÀNG BUỘC
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_invitations_kiem_danh_sach() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
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
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Loi moi chi thu hoi duoc khi goi con o DRAFT; goi dang o % (K4a)', trang_thai
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k4a_thu_hoi_sai_trang_thai';
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

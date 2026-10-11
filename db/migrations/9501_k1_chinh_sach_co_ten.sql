-- ==============================================================================================
-- 9501_k1_chinh_sach_co_ten — [S1.9101 / S3.9b / K12] HAI LỜI TỪ CHỐI CỦA ĐƯỜNG CHÍNH SÁCH CÓ TÊN, VÀO SỔ: NGƯỜI TẠO TỰ KÝ
-- PHIÊN BẢN, VÀ PHIÊN BẢN KHÔNG BẬC Ở TỔ CHỨC ĐÃ BẬT
--
-- Phép điều tra K12 (S3.9b) đo: nhánh *người tạo phiên bản tự ký* của `chinh_sach_kiem_nguoi_ky` là một `RAISE` không tên, nên
-- `kyPhienBanChinhSach` để nó đi ra 422 mà không hàng sổ nào — trong khi `D2_NGUOI_TAO_TU_DUYET` (người tạo gói tự duyệt), cùng
-- loại tách bạch nhiệm vụ, vào sổ `CONTROL_DENIED` (khoản 247). Người tự ký giữ `policy.manage` và đi đúng thứ tự: thứ chặn họ là
-- chốt chữ ký thứ hai (ADR-082 ⑺, phần chữ ký của K1) — lần cố đi tắt ấy kiểm toán viên hỏi tới (ADR-060). Chủ dự án chốt
-- 2026-10-11: sửa trong vòng này.
--
-- Khuôn ADR-108 (cùng `074_tu_choi_co_ten`): trigger giữ thẩm quyền và đặt TÊN RÀNG BUỘC `k1_nguoi_tao_tu_ky` cho đúng nhánh ấy;
-- tầng gói bắt chính lời từ chối có tên (`maChotTuLoi`) và ghi `CONTROL_DENIED` ở giao dịch độc lập (`tuChoiTheoChotTaiNguyen`).
-- Không vị từ hỏi trước: một câu hỏi trước câu ghi sẽ đọc người tạo mà không giữ khoá tư vấn của hàm này. Bảy nhánh còn lại (sáu
-- `check_violation`, một `foreign_key_violation`) giữ nguyên — phép điều tra phân loại chúng (`db/dieu-tra-k12.int.test.ts`).
--
-- THỨ TỰ KHOÁ (lượt soi trên mã §S1.9101): hàng sổ của lần từ chối ghi ở giao dịch ĐỘC LẬP trong khi giao dịch hỏng của người gọi còn
-- giữ khoá tư vấn (tổ chức, 2) tới lúc ROLLBACK. An toàn vì mọi đường lấy khoá 2 TRƯỚC khoá chuỗi sổ (tổ chức, 0) (`rfq.ts` lần mở gói);
-- một đường tương lai lấy 0 rồi 2 sẽ làm lần ghi sổ chờ tới `lock_timeout` và lời từ chối mất sổ (55P03).
--
-- Thân còn lại NGUYÊN VĂN `097`.
--
-- NHÁNH THỨ HAI (cùng phép điều tra, chủ dự án chốt cùng ngày): `chinh_sach_da_bat_thi_phai_co_bac` (`069` (3)) từ chối một phiên bản
-- KHÔNG BẬC ở tổ chức đã bật S3 bằng một `RAISE` không tên — 422 không hàng sổ. Phiên bản không bậc có hiệu lực mà KHÔNG cần chữ ký thứ
-- hai (`chinh_sach_hieu_luc`, `069` (4)), nên lần tạo ấy là lối một người đổi trọng số chấm, ngưỡng kép hay cửa sổ xoá khoá mà không ai
-- ký — đúng thứ chữ ký thứ hai sinh ra để chặn; cùng hình dạng `THIEU_NGAN_SACH` (bỏ bước là thoát mọi chốt). Tên `k1_ban_khong_bac`;
-- `createProcurementPolicy` bắt nó. Thân còn lại NGUYÊN VĂN `069`.
--
-- Hai hàm ghim ở `hardening.always.sql` trong CÙNG commit (S1.96); trigger không đổi.
-- ==============================================================================================

CREATE OR REPLACE FUNCTION public.chinh_sach_kiem_nguoi_ky() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  co_bac boolean;
  phien_ban integer;
  hieu_luc_tu timestamptz;
  goi_cho integer;
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
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k1_nguoi_tao_tu_ky';
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
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'Chu ky bat S3 chi nhan duoi READ COMMITTED (giao dich dang o %): anh chup cu khong thay goi vua nop (ADR-080)',
        pg_catalog.current_setting('transaction_isolation')
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*)::integer INTO goi_cho
      FROM public.rfq_packages g
     WHERE g.org_id = NEW.org_id AND g.status = 'PENDING_APPROVAL';
    IF goi_cho > 0 THEN
      RAISE EXCEPTION 'To chuc con % goi cho duyet: duyet roi mo, hoac huy, cac goi ay truoc khi bat S3 (ADR-080)', goi_cho
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE OR REPLACE FUNCTION public.chinh_sach_da_bat_thi_phai_co_bac() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));
  IF NEW.tiers IS NULL AND public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'To chuc da bat S3 (ADR-080): phien ban chinh sach moi phai khai bac gia tri'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k1_ban_khong_bac';
  END IF;
  RETURN NEW;
END
$ham$;

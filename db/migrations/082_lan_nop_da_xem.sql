-- ==============================================================================================
-- 082_lan_nop_da_xem — [S1.196] LỜI DUYỆT RÀNG VÀO LẦN NỘP NGƯỜI DUYỆT ĐÃ XEM (khoản 256), LẦN TRẢ VỀ RÚT CHỮ KÝ CỦA
-- CHÍNH NGƯỜI TRẢ (khoản 257) — K4b, D2
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §2.4, §3.3, §5.1 (K4). ADR-116. Lượt soi
-- S1.195 đo hai khoảng trống dưới cạnh về DRAFT (`077`); chủ dự án chọn ngày 2026-09-29 vá cả hai ở một vòng riêng, trước S3.2c,
-- và mốc lần nộp chỉ BẮT BUỘC ở tổ chức đã bật.
--
-- KHOẢN 256. Lời duyệt chỉ mang mã gói, nên chữ ký mang ba băm của CSDL LÚC CHÈN, không của thứ người duyệt đã xem. Trước `077`,
-- gói đứng yên suốt `PENDING_APPROVAL`; từ `077`, ở tổ chức đã bật, PM trả gói về, sửa, nộp lại được giữa lần người duyệt xem và
-- lần bấm ký — chữ ký ghi lên thứ người ấy chưa từng xem, và gói mở.
-- KHOẢN 257. Cạnh về DRAFT không xoá chữ ký (`077` (1)), nên người duyệt đã ký rồi tự trả gói về — ADR-084 ⑵: *"trả về thay vì
-- không ký"* — không rút được chữ ký của chính mình: gói nộp lại y nguyên thì mở bằng chữ ký ấy.
--
-- (1) `rfq_packages.lan_nop` — số lần nộp duyệt; trigger RIÊNG ở cạnh DRAFT→PENDING_APPROVAL cộng một. Ngoài mọi `GRANT`
--     (`app_api` chỉ có UPDATE theo cột, `009`/`011`/`016`/`071`), nên chỉ trigger đổi được nó. Hàng cũ giữ 0: bộ đếm chỉ cần
--     tăng ĐƠN ĐIỆU từ đây, và gói đang chờ duyệt lúc deploy mang mốc 0 — người duyệt đọc được và gửi đúng 0.
--     VÌ SAO BỘ ĐẾM, KHÔNG `submitted_at` (`072`): mốc đi một vòng qua trình duyệt — `GET` rồi lời duyệt —, và `timestamptz` qua
--     JSON sang JavaScript mất phần micro giây, nên phép so bằng gãy; và vế (5) cần THỨ TỰ giữa các lần nộp, mà đồng hồ tường có
--     thể lùi.
-- (2) `rfq_approvals.lan_nop_da_xem` — lời duyệt mang lần nộp người duyệt đã xem; `app_api` được chèn cột này. Trigger RIÊNG
--     `rfq_approvals_so_lan_nop` khoá hàng gói `FOR NO KEY UPDATE`, đọc lại trạng thái và lần nộp, rồi so. Tổ chức đã bật: mốc bắt
--     buộc, khác lần nộp hiện tại thì từ chối. Tổ chức chưa bật: tuỳ chọn, gửi thì phải đúng — lời duyệt không mang mốc đi qua như
--     MVP1 —, và cột được ĐẶT VỀ NULL sau khi so: cùng lý do vế NULL của `076` (2), UNIQUE (2b) giữ MVP1 đúng một người một lần.
--     Tên xếp SAU `rfq_approvals_kiem_nguoi_duyet` (D2), nên nó chạy CUỐI: lời tự duyệt hay phiên hỏng vẫn bị chốt D2 từ chối và
--     vào sổ `CONTROL_DENIED` dù mốc thiếu hay sai — ADR-108 ⑴, không bớt nhánh ghi nào. Cái giá: hai băm (trigger đầu), trạng thái
--     và băm nội dung (D2) đều đọc TRƯỚC khoá, mỗi câu một ảnh chụp. Nên trigger này đọc lại TRẠNG THÁI dưới khoá, ở MỌI tổ chức:
--     gói còn `PENDING_APPROVAL` ở đúng lần nộp người duyệt đã đọc thì nó chưa rời lần nộp ấy từ lúc đọc — rời nó chỉ có một đường
--     (trả về) và lần nộp sau mang số mới —, mà ở tổ chức đã bật mọi lần sửa gói đòi DRAFT, nên mọi phép băm trước khoá tính trên
--     chính lần nộp ấy. Không có vế trạng thái, một lần trả về cộng một lần sửa commit giữa phép kiểm trạng thái và phép băm nội
--     dung của D2 để lại chữ ký mang nội dung đã sửa trên lần nộp cũ, và gói nộp lại mở bằng nó (lượt soi S1.196, F1). Ở tổ chức
--     chưa bật, vế ấy chặn lời duyệt rơi lên một gói vừa mở hay vừa huỷ. Khoá giữ tới hết giao dịch: một lần trả về hay nộp lại
--     đang chạy phải chờ lời duyệt commit, và lời duyệt chờ một lần trả về đang chạy rồi thấy DRAFT. `FOR NO KEY UPDATE` chứ không
--     `FOR SHARE`: lời duyệt của một tổ chức vốn nối tiếp ở khoá sổ kiểm toán (`004`), và khoá chia sẻ để một giao dịch duyệt rồi
--     mở gói deadlock với một lời duyệt song song (F3). Trước `082` không trigger nào của `rfq_approvals` khoá hàng gói.
-- (2b) Hai UNIQUE của `rfq_approvals` mang thêm `lan_nop_da_xem`: người đã rút chữ ký bằng lần trả về (5) ký lại được trên lần nộp
--     MỚI dù nội dung, danh sách và ngân sách y nguyên. Một người vẫn đếm MỘT ở cạnh mở gói — ba phép đếm của K4b là
--     `count(DISTINCT người)`.
-- (3) `rfq_tra_ve` — mỗi lần trả về một hàng: ai, phiên, lần nộp bị trả, lý do. Chỉ-ghi-thêm BẰNG QUYỀN, khuôn `rfq_approvals` và
--     `064`: không vai nào có UPDATE hay DELETE. Danh tính dẫn xuất từ phiên (`kiem_danh_tinh_theo_phien`, `013`). Trigger RIÊNG
--     đặt `lan_nop` từ gói — không phải lời khai —, đòi tổ chức đã bật và gói đang `PENDING_APPROVAL`, khoá hàng gói
--     `FOR NO KEY UPDATE` — cùng khoá với câu đổi trạng thái theo sau. `UNIQUE (org, gói, lần nộp)`: một lần nộp chỉ trả về
--     một lần. Một hàng do `app_api` chèn tay, không kèm cạnh, chỉ rút được chữ ký của CHÍNH người chèn — danh tính dẫn xuất —,
--     nhưng nó chiếm UNIQUE của lần nộp ấy (lần trả về thật của lần nộp ấy về sau bị từ chối) và thoả vế (4) cho một câu UPDATE thô
--     về DRAFT sau đó; và hàng bị chủ bảng xoá làm chữ ký đã rút đếm lại. Chưa đóng: khoản 260.
-- (4) Cạnh PENDING_APPROVAL→DRAFT (`077`) đòi thêm một hàng `rfq_tra_ve` của CHÍNH lần nộp đang bị trả: người và lý do nằm trong
--     CSDL, không chỉ ở sổ. Thân `077` cộng một vế.
-- (5) Cạnh mở gói (`081`) đếm thêm lần ba — chữ ký CÒN HIỆU LỰC: mang lần nộp đã xem, và người ký không trả gói về ở một lần nộp
--     không sớm hơn lần họ đã ký. Hai phép đếm trước giữ nguyên văn và nguyên thông điệp. Chữ ký không mang lần nộp — mọi chữ ký
--     đặt trước `082` — không đếm ở tổ chức đã bật: không biết người ấy đã xem gì (fail-closed, khuôn `081`); người ấy ký lại được.
--
-- Tổ chức chưa bật chạy nguyên MVP1: `lan_nop` vẫn đếm — không phép kiểm nào đọc nó ở đó, trừ lời duyệt TỰ gửi mốc —; không có
-- cạnh về DRAFT nên không có hàng `rfq_tra_ve`; cạnh mở gói không đếm lần ba.
-- ==============================================================================================

-- ============================================================================================
-- (1) SỐ LẦN NỘP
-- ============================================================================================
ALTER TABLE rfq_packages ADD COLUMN lan_nop integer NOT NULL DEFAULT 0;
-- Cố ý KHÔNG cấp INSERT hay UPDATE cột này: trigger dưới đếm, bên gọi không chọn được lần nộp của mình.

-- `WHEN` đúng cạnh (§2.5 ⒃), khuôn `014` §(4).
CREATE OR REPLACE FUNCTION public.rfq_dem_lan_nop() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  NEW.lan_nop := OLD.lan_nop + 1;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_dem_lan_nop
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL')
  EXECUTE FUNCTION public.rfq_dem_lan_nop();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_dem_lan_nop;

-- ============================================================================================
-- (2) LỜI DUYỆT MANG LẦN NỘP ĐÃ XEM
-- ============================================================================================
ALTER TABLE rfq_approvals ADD COLUMN lan_nop_da_xem integer;
GRANT INSERT (lan_nop_da_xem) ON rfq_approvals TO app_api;

-- Không nội suy giá trị người gọi gửi vào lời từ chối — chỉ lần nộp của gói, thứ người ấy đọc được bằng `GET`.
CREATE OR REPLACE FUNCTION public.rfq_chot_lan_nop_da_xem() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  hien_tai integer;
BEGIN
  SELECT p.status, p.lan_nop INTO trang_thai, hien_tai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ cho phe duyet nay' USING ERRCODE = 'check_violation';
  END IF;
  IF trang_thai <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'RFQ vua roi PENDING_APPROVAL (nay dang %) trong luc loi duyet dang ghi — doc lai goi roi duyet', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.to_chuc_da_bat_s3(NEW.org_id) THEN
    IF NEW.lan_nop_da_xem IS DISTINCT FROM hien_tai THEN
      RAISE EXCEPTION 'Goi thau dang o lan nop %; loi duyet khong mang dung lan nop nay — doc lai goi roi duyet (K4b)', hien_tai
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.lan_nop_da_xem IS NOT NULL AND NEW.lan_nop_da_xem <> hien_tai THEN
      RAISE EXCEPTION 'Goi thau dang o lan nop %; loi duyet khong mang dung lan nop nay — doc lai goi roi duyet (K4b)', hien_tai
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.lan_nop_da_xem := NULL;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_approvals_so_lan_nop
  BEFORE INSERT ON rfq_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.rfq_chot_lan_nop_da_xem();
ALTER TABLE rfq_approvals ENABLE ALWAYS TRIGGER rfq_approvals_so_lan_nop;

-- (2b) Giữ nguyên tên ràng buộc (lời từ chối D2 đọc tên ấy); `NULLS NOT DISTINCT` giữ MVP1 đúng một người một lần — ở đó cột
-- luôn NULL.
ALTER TABLE rfq_approvals DROP CONSTRAINT rfq_approvals_mot_nguoi_mot_lan;
ALTER TABLE rfq_approvals ADD CONSTRAINT rfq_approvals_mot_nguoi_mot_lan
  UNIQUE NULLS NOT DISTINCT (org_id, rfq_id, approver_user_id, approved_content_hash, approved_list_hash, approved_budget_hash,
                             lan_nop_da_xem);
ALTER TABLE rfq_approvals DROP CONSTRAINT rfq_approvals_mot_phien_mot_lan;
ALTER TABLE rfq_approvals ADD CONSTRAINT rfq_approvals_mot_phien_mot_lan
  UNIQUE NULLS NOT DISTINCT (org_id, rfq_id, session_id, approved_content_hash, approved_list_hash, approved_budget_hash,
                             lan_nop_da_xem);

-- ============================================================================================
-- (3) SỔ TRẢ VỀ
-- ============================================================================================
CREATE TABLE rfq_tra_ve (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations(id),
  rfq_id                 uuid NOT NULL,
  lan_nop                integer NOT NULL,
  returned_by            uuid NOT NULL,
  returned_by_session_id uuid NOT NULL,
  reason                 text NOT NULL,
  returned_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, returned_by) REFERENCES users (org_id, id),
  CONSTRAINT rfq_tra_ve_mot_lan_moi_lan_nop UNIQUE (org_id, rfq_id, lan_nop)
);

ALTER TABLE rfq_tra_ve ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_tra_ve FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_tra_ve_tenant_isolation ON rfq_tra_ve
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới tự mang policy khách, ĐÓNG HẲN: nhà cung cấp không có việc gì với việc ai của bên mua trả gói về.
CREATE POLICY rfq_tra_ve_khach ON rfq_tra_ve AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `app_api` ĐỌC (cạnh mở gói và cạnh về DRAFT đọc bảng dưới quyền người gọi) và GHI THÊM (`returnRfqToDraft`). `lan_nop` do
-- trigger đặt, `returned_at` do CSDL đặt. `app_unseal` không đụng bảng này.
GRANT SELECT ON rfq_tra_ve TO app_api;
GRANT INSERT (org_id, rfq_id, returned_by, returned_by_session_id, reason) ON rfq_tra_ve TO app_api;

CREATE TRIGGER rfq_tra_ve_kiem_danh_tinh
  BEFORE INSERT ON rfq_tra_ve
  FOR EACH ROW
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('returned_by', 'returned_by_session_id');
ALTER TABLE rfq_tra_ve ENABLE ALWAYS TRIGGER rfq_tra_ve_kiem_danh_tinh;

CREATE OR REPLACE FUNCTION public.rfq_tra_ve_dat_lan_nop() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  hien_tai integer;
BEGIN
  SELECT p.status, p.lan_nop INTO trang_thai, hien_tai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay goi thau cua lan tra ve (K4a)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Chi to chuc da bat S3 moi tra goi ve DRAFT duoc (K4a)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF trang_thai <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Chi tra ve duoc goi dang cho duyet; goi dang o % (K4a)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.lan_nop := hien_tai;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_tra_ve_dat_lan_nop
  BEFORE INSERT ON rfq_tra_ve
  FOR EACH ROW
  EXECUTE FUNCTION public.rfq_tra_ve_dat_lan_nop();
ALTER TABLE rfq_tra_ve ENABLE ALWAYS TRIGGER rfq_tra_ve_dat_lan_nop;

-- ============================================================================================
-- (4) CẠNH VỀ DRAFT KÈM HÀNG TRẢ VỀ CỦA CHÍNH LẦN NỘP ẤY
-- ============================================================================================
-- Thân `077` (1) cộng MỘT vế. Trigger `rfq_packages_tra_ve_nhap_chi_khi_bat_s3` của `077` giữ nguyên.
CREATE OR REPLACE FUNCTION public.rfq_kiem_tra_ve_nhap() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Chi to chuc da bat S3 moi tra goi ve DRAFT duoc (K4a)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfq_tra_ve r
                  WHERE r.org_id = NEW.org_id AND r.rfq_id = NEW.id AND r.lan_nop = OLD.lan_nop) THEN
    RAISE EXCEPTION 'Tra goi ve DRAFT phai kem mot hang rfq_tra_ve cua lan nop % — ai tra va vi sao (K4b)', OLD.lan_nop
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (5) CẠNH MỞ GÓI ĐẾM CHỮ KÝ CÒN HIỆU LỰC
-- ============================================================================================
-- Thân `081` (4) cộng MỘT phép đếm thứ ba. Trigger `rfq_packages_kiem_danh_sach_khi_mo` của `076` giữ nguyên.
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
  SELECT count(DISTINCT a.approver_user_id) INTO co
    FROM public.rfq_approvals a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.id
     AND a.approved_content_hash = public.rfq_bam_noi_dung(NEW.id)
     AND a.approved_list_hash = public.rfq_bam_danh_sach(NEW.id)
     AND a.approved_budget_hash = public.rfq_bam_ngan_sach(NEW.id)
     AND a.lan_nop_da_xem IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rfq_tra_ve r
                      WHERE r.org_id = a.org_id AND r.rfq_id = a.rfq_id
                        AND r.returned_by = a.approver_user_id AND r.lan_nop >= a.lan_nop_da_xem);
  IF co < can THEN
    RAISE EXCEPTION 'RFQ nay can % chu ky CON HIEU LUC — ky tren lan nop da xem, nguoi ky chua tra goi ve tu lan ay —, moi co % (K4b)', can, co
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

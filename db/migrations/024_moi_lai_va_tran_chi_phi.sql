-- db/migrations/024_moi_lai_va_tran_chi_phi.sql
-- KHOẢN NỢ 35 VÀ 37 — HAI ĐƯỜNG "CHẶN NGƯỜI KHÁC DỰ THẦU", CÙNG MỘT HỌ
--
-- ============================================================================================
-- HAI KHOẢN NỢ NÀY KHÔNG PHẢI LỖ HỔNG BẢO MẬT THEO NGHĨA QUEN THUỘC — CHÚNG LÀ LỖ HỔNG CÔNG BẰNG
-- ============================================================================================
-- Không cái nào làm lộ một giá nào. Cả hai làm một việc khác và tệ theo cách riêng: **giữ một
-- nhà cung cấp ở ngoài cuộc thầu.** Với một sản phẩm mà USP là *"tạo bằng chứng cạnh tranh"*,
-- một đường loại người ra khỏi cuộc là một lỗ hổng đúng nghĩa.
--
--   (1) [nợ 35] hạn mức OTP theo ĐÍCH khoá chứ không làm chậm, và khoá ấy DÙNG CHUNG giữa các
--       lời mời — nên ai cầm một link đã chuyển tiếp cho RFQ-1 chặn được OTP của RFQ-2.
--   (2) [nợ 37] thu hồi lời mời là VĨNH VIỄN: `UNIQUE (org_id, rfq_id, supplier_id)` không có vị
--       từ bộ phận, nên một lần bấm nhầm loại nhà cung cấp ấy khỏi RFQ ấy mãi mãi.

-- ============================================================================================
-- (1) [nợ 35] BUCKET THỨ TƯ — TRẦN CHI PHÍ THEO ĐÍCH, TÁCH KHỎI HẠN MỨC THEO LỜI MỜI
-- ============================================================================================
-- ADR-015 §5: *"hạn mức theo đích chỉ được LÀM CHẬM, không được KHOÁ, vì khoá theo đích cho phép
-- một người khoá lối vào của người khác."* 010 cài nó thành một lần từ chối trên một khoá KHÔNG
-- mang lời mời — tức đúng thứ câu ấy cấm.
--
-- Hình dạng mới: `DEST` khoá theo (LỜI MỜI, ĐÍCH) — hạn mức thật, không xuyên qua lời mời được
-- nữa; `DEST_ORG` khoá theo ĐÍCH toàn tổ chức — một TRẦN CHI PHÍ đặt cao hơn hẳn mức dùng bình
-- thường, để nó không bao giờ là thứ ba lời gọi vũ khí hoá được.
ALTER TABLE otp_rate_limits DROP CONSTRAINT otp_rate_limits_bucket_kind_check;
ALTER TABLE otp_rate_limits ADD CONSTRAINT otp_rate_limits_bucket_kind_check
  CHECK (bucket_kind IN ('DEST', 'DEST_ORG', 'CALLER', 'INVITATION'));

-- ============================================================================================
-- (2) [nợ 37] MỜI LẠI ĐƯỢC SAU KHI THU HỒI — VÀ THU HỒI VẪN ĐƠN ĐIỆU
-- ============================================================================================
-- Ràng buộc cũ nói *"một nhà cung cấp được mời ĐÚNG MỘT LẦN cho mỗi RFQ"*. Câu ấy đúng về ý
-- định và sai về hệ quả: nó cũng nói *"một nhà cung cấp bị thu hồi thì KHÔNG BAO GIỜ mời lại
-- được"*, và không ai quyết định điều thứ hai.
--
-- Vị từ bộ phận giữ nguyên vế thứ nhất cho các lời mời CÒN SỐNG, và mở lại vế thứ hai. Nó KHÔNG
-- làm yếu 022 mục (2): một hàng đã `REVOKED` vẫn không sống lại được — đường mở lại là một hàng
-- MỚI, có `invited_by` mới, có dấu thời gian mới, và để lại cả hai hàng trong sổ.
ALTER TABLE rfq_invitations DROP CONSTRAINT rfq_invitations_org_id_rfq_id_supplier_id_key;
CREATE UNIQUE INDEX rfq_invitations_mot_loi_moi_con_song
  ON rfq_invitations (org_id, rfq_id, supplier_id)
  WHERE revoked_at IS NULL;

-- ============================================================================================
-- (3) [nợ 37] KHOÁ THEO LỜI MỜI PHẢI CÓ ĐƯỜNG MỞ — VÀ ĐƯỜNG ẤY PHẢI ĐỂ LẠI DẤU
-- ============================================================================================
-- 012 (H3) đặt khoá ở cấp LỜI MỜI: còn một thách thức đang khoá thì KHÔNG phát được thách thức
-- mới. Đó là phép sửa đúng cho một khiếm khuyết đã đo (trần thật là *"5 lần đoán mỗi lần phát"*).
-- Nhưng nó tạo ra một hệ quả không ai quyết định: ai cầm một link đã chuyển tiếp giữ được nhà
-- cung cấp thật ở ngoài **vô hạn** — 5 lần sai, khoá 900 giây, lặp lại — và KHÔNG có hàm nào gỡ.
--
-- `app_api` đã có `UPDATE (failed_attempts, locked_until, consumed_at)` từ 010, nên đường gỡ
-- khoá không cần thêm quyền. Thứ nó cần là một CỬA CÓ TÊN ở tầng ứng dụng (`clearOtpLockout`),
-- một mã quyền, và một bản ghi kiểm toán — cả ba nằm ở `packages/invitation`.
--
-- Ở tầng này chỉ cần một điều: gỡ khoá KHÔNG được dùng để xoá dấu vết. `failed_attempts` giữ
-- nguyên; chỉ `locked_until` được trả về NULL.
CREATE OR REPLACE FUNCTION public.otp_go_khoa_khong_xoa_dau_vet() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NEW.failed_attempts OPERATOR(pg_catalog.<) OLD.failed_attempts THEN
    RAISE EXCEPTION 'failed_attempts khong duoc giam — go khoa la mot hanh vi, khong phai mot lan xoa (E3)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER invitation_otp_go_khoa_khong_xoa_dau_vet
  BEFORE UPDATE ON invitation_otp_challenges
  FOR EACH ROW EXECUTE FUNCTION public.otp_go_khoa_khong_xoa_dau_vet();

INSERT INTO permissions (code, description) VALUES
  ('invitation.unlock', 'Gỡ khoá OTP của một lời mời sau khi nhà cung cấp bị chặn ngoài cuộc');

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('PROCUREMENT_MANAGER', 'invitation.unlock'),
  ('BUYER',               'invitation.unlock');

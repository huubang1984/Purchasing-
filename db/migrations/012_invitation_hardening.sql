-- db/migrations/012_invitation_hardening.sql
-- Vòng sửa sau REVIEW AN NINH S1.3 (2026-08-29). Đóng 3 CRITICAL và 5 HIGH ở tầng CSDL.
--
-- Chuỗi tấn công đã được dựng lại thành phép đo trên Postgres thật và nó CHẠY TRỌN. Kẻ tấn công
-- chỉ có `invitationId` — không token, không chạm hộp thư của người liên hệ thật:
--
--   C1  phat OTP toi so tu chon ......................... THANH CONG
--   H1  mo phien chi bang invitationId .................. THANH CONG
--   C2  so kiem toan ghi danh tinh ...................... NGUOI THAT (sai su that)
--   C3a sau THU HOI van phat duoc OTP ................... CO
--   C3b sau THU HOI van mo duoc PHIEN MOI ............... CO
--   H3b phat lai thach thuc roi doan tiep ............... khoa da bi reset
--
-- ============================================================================================
-- NGUYÊN LÝ CỦA VÒNG SỬA NÀY, VÀ NÓ GIẢI THÍCH MỌI CÂU LỆNH DƯỚI ĐÂY
-- ============================================================================================
-- Ba CRITICAL có CÙNG MỘT hình dạng: một sự thật an ninh được nhận vào dưới dạng THAM SỐ thay vì
-- được ĐỌC RA từ dữ liệu.
--   * đích nhận OTP  -> tham số `destination`      -> nay ĐỌC từ `supplier_contacts`;
--   * danh tính đã xác thực -> tham số `verifiedContactId` -> nay ĐỌC từ chính thách thức đã đối chiếu;
--   * quyền yêu cầu OTP -> chỉ cần `invitationId`  -> nay ĐÒI token của magic link.
--
-- Cách đóng vì vậy giống nhau ở cả ba: **thêm một cạnh DỮ LIỆU** rồi để trigger đòi các cạnh ấy
-- nhất quán. Sau vòng này, không hàm nào ở tầng ứng dụng có thể KHAI một sự thật an ninh — nó chỉ
-- có thể chứng minh một cái đã có.

-- Tiền đề cho khoá ngoại hợp thành từ `invitation_otp_challenges`.
ALTER TABLE rfq_invitation_tokens ADD CONSTRAINT rfq_invitation_tokens_org_id_id_key
  UNIQUE (org_id, id);

-- ============================================================================================
-- (C1) ĐÍCH NHẬN OTP PHẢI LÀ MỘT NGƯỜI LIÊN HỆ CÓ THẬT CỦA CHÍNH NHÀ CUNG CẤP ĐƯỢC MỜI
-- (H1) VÀ PHÁT OTP PHẢI ĐÒI TOKEN, KHÔNG CHỈ ĐÒI MỘT UUID
-- ============================================================================================
ALTER TABLE invitation_otp_challenges ADD COLUMN token_id uuid;
ALTER TABLE invitation_otp_challenges ADD COLUMN contact_id uuid;
-- Băm của đích ĐÃ THẬT SỰ DÙNG. Bảng S1.3 không lưu lại đích, nên "không lớp nào, ở bất kỳ thời
-- điểm nào, biết mã đã đi tới đâu". Lưu BĂM chứ không lưu số: đây là bảng bị đọc nhiều, và một
-- danh bạ dạng rõ là thứ không cần thiết để trả lời câu hỏi kiểm toán ("có đúng đích đã đăng ký
-- không" là một phép SO SÁNH, không đòi giá trị).
ALTER TABLE invitation_otp_challenges ADD COLUMN destination_hash bytea
  CHECK (destination_hash IS NULL OR octet_length(destination_hash) = 32);
ALTER TABLE invitation_otp_challenges ADD CONSTRAINT invitation_otp_token_fkey
  FOREIGN KEY (org_id, token_id) REFERENCES rfq_invitation_tokens (org_id, id);
ALTER TABLE invitation_otp_challenges ADD CONSTRAINT invitation_otp_contact_fkey
  FOREIGN KEY (org_id, contact_id) REFERENCES supplier_contacts (org_id, id);
GRANT INSERT (token_id, contact_id, destination_hash) ON invitation_otp_challenges TO app_api;

-- ============================================================================================
-- (C2) DANH TÍNH ĐÃ XÁC THỰC PHẢI LÀ HỆ QUẢ CỦA PHÉP XÁC THỰC, KHÔNG PHẢI MỘT LỜI KHAI
-- ============================================================================================
ALTER TABLE guest_sessions ADD COLUMN challenge_id uuid;
ALTER TABLE guest_sessions ADD CONSTRAINT guest_sessions_challenge_fkey
  FOREIGN KEY (org_id, challenge_id) REFERENCES invitation_otp_challenges (org_id, id);
GRANT INSERT (challenge_id) ON guest_sessions TO app_api;

-- ============================================================================================
-- (H3) HẠN MỨC THỨ BA: THEO LỜI MỜI — BUCKET DUY NHẤT KẺ TẤN CÔNG KHÔNG XOAY ĐƯỢC
-- ============================================================================================
-- Hai bucket của 010 khoá trên `callerFingerprint` và `destination`, và cả hai đều do NGƯỜI GỌI
-- truyền vào. Đổi chuỗi -> bucket mới -> trần không bao giờ chạm. `invitation_id` thì khác: nó
-- chính là thứ kẻ tấn công đang nhắm, nên nó không xoay được.
ALTER TABLE otp_rate_limits DROP CONSTRAINT otp_rate_limits_bucket_kind_check;
ALTER TABLE otp_rate_limits ADD CONSTRAINT otp_rate_limits_bucket_kind_check
  CHECK (bucket_kind IN ('DEST', 'CALLER', 'INVITATION'));

-- ============================================================================================
-- (H5) THU HỒI PHẢI ĐƠN ĐIỆU — MỘT CỜ ĐÃ BẬT KHÔNG ĐƯỢC TẮT LẠI
-- ============================================================================================
-- `app_api` có `GRANT UPDATE (revoked_at, consumed_at)` và KHÔNG có gì cấm đặt lại `NULL`. Một
-- `UPDATE rfq_invitation_tokens SET revoked_at = NULL` PHỤC SINH một token đã thu hồi. Cùng
-- chuyện với `guest_sessions.revoked_at`. Đây đúng tiêu chí ADR-014 — *cái gì hỏng im lặng thì
-- xuống CSDL* — và nó hỏng im lặng theo nghĩa đen: không có gì đỏ, không có gì để đọc.
CREATE OR REPLACE FUNCTION public.thu_hoi_don_dieu() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF TG_ARGV[0] = 'revoked_at' THEN
    IF to_jsonb(OLD) ->> 'revoked_at' IS NOT NULL
       AND to_jsonb(NEW) ->> 'revoked_at' IS NULL THEN
      RAISE EXCEPTION 'revoked_at da bat thi khong duoc tat lai (%.%)', TG_TABLE_NAME, 'revoked_at'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_ARGV[0] = 'consumed_at' OR TG_NARGS > 1 THEN
    IF to_jsonb(OLD) ->> 'consumed_at' IS NOT NULL
       AND to_jsonb(NEW) ->> 'consumed_at' IS NULL THEN
      RAISE EXCEPTION 'consumed_at da bat thi khong duoc tat lai (%)', TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_invitation_tokens_thu_hoi_don_dieu
  BEFORE UPDATE ON rfq_invitation_tokens
  FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('revoked_at', 'consumed_at');
CREATE TRIGGER guest_sessions_thu_hoi_don_dieu
  BEFORE UPDATE ON guest_sessions
  FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('revoked_at');
CREATE TRIGGER invitation_otp_thu_hoi_don_dieu
  BEFORE UPDATE ON invitation_otp_challenges
  FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('consumed_at');

-- ============================================================================================
-- TRIGGER CHÍNH CỦA THÁCH THỨC OTP — thay `otp_kiem_kenh_khac_link` của 010
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.otp_kiem_kenh_khac_link() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  kenh_link text;
  ncc_moi uuid;
  trang_thai_loi_moi text;
  loi_moi_thu_hoi timestamptz;
  ncc_cua_lien_he uuid;
  loi_moi_cua_token uuid;
  so_dang_khoa integer;
BEGIN
  -- [H1] Token là BẮT BUỘC. Không có vế này, `invitationId` — một UUIDv4 xuất hiện trong URL,
  -- payload API và sổ kiểm toán — là thứ DUY NHẤT gác cổng "ai được yêu cầu gửi OTP", tức nó
  -- đang làm credential. ADR-012 §"Điều ADR này KHÔNG cho phép suy ra" và F2 cấm đúng điều đó.
  IF NEW.token_id IS NULL OR NEW.contact_id IS NULL THEN
    RAISE EXCEPTION 'Thach thuc OTP phai mang token va nguoi lien he (C1, H1)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.link_channel, i.supplier_id, i.status, i.revoked_at
    INTO kenh_link, ncc_moi, trang_thai_loi_moi, loi_moi_thu_hoi
    FROM public.rfq_invitations i WHERE i.id = NEW.invitation_id AND i.org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay loi moi cho thach thuc OTP nay'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [C3] Thu hồi lời mời phải chạm ĐƯỜNG PHIÊN, không chỉ đường token. Đo được ở bản 010: sau khi
  -- thu hồi vẫn phát được OTP và vẫn mở được một PHIÊN MỚI — thu hồi trở thành không có tác dụng.
  IF trang_thai_loi_moi = 'REVOKED' OR loi_moi_thu_hoi IS NOT NULL THEN
    RAISE EXCEPTION 'Loi moi da bi thu hoi (E1)' USING ERRCODE = 'check_violation';
  END IF;

  -- [H1] Token phải THUỘC VỀ chính lời mời này, còn hạn, chưa thu hồi, chưa tiêu thụ.
  SELECT t.invitation_id INTO loi_moi_cua_token
    FROM public.rfq_invitation_tokens t
   WHERE t.id = NEW.token_id AND t.org_id = NEW.org_id
     AND t.purpose = 'BID_SUBMISSION'
     AND t.expires_at > now() AND t.revoked_at IS NULL AND t.consumed_at IS NULL;
  IF NOT FOUND OR loi_moi_cua_token IS DISTINCT FROM NEW.invitation_id THEN
    RAISE EXCEPTION 'Token khong hop le hoac khong thuoc loi moi nay (E1, H1)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [C1] Người liên hệ phải thuộc ĐÚNG nhà cung cấp được mời. Khoá ngoại một mình chỉ đòi "có
  -- trong tổ chức", nên nó cho phép gửi OTP tới người liên hệ của một nhà cung cấp KHÁC.
  SELECT c.supplier_id INTO ncc_cua_lien_he
    FROM public.supplier_contacts c WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id;
  IF NOT FOUND OR ncc_cua_lien_he IS DISTINCT FROM ncc_moi THEN
    RAISE EXCEPTION 'Nguoi lien he khong thuoc nha cung cap duoc moi (C1)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ADR-015 mục 1, giữ nguyên từ 010: so HAI KÊNH, không cấm cứng EMAIL.
  IF NEW.channel = kenh_link THEN
    RAISE EXCEPTION
      'OTP khong duoc di cung kenh voi magic link (ADR-015): ca hai deu la %', NEW.channel
      USING ERRCODE = 'check_violation';
  END IF;

  -- [H3] Khoá phải sống ở cấp LỜI MỜI. Ở bản 010, `verifyOtp` luôn đọc thách thức MỚI NHẤT, nên
  -- một thách thức bị khoá chỉ cần phát lại một cái nữa là bị đẩy xuống dưới và bộ đếm về 0 —
  -- trần thật là "5 lần đoán MỖI LẦN PHÁT", không phải "5 lần đoán mỗi lời mời". Đã ĐO.
  SELECT count(*) INTO so_dang_khoa
    FROM public.invitation_otp_challenges c
   WHERE c.invitation_id = NEW.invitation_id AND c.locked_until IS NOT NULL
     AND c.locked_until > now();
  IF so_dang_khoa > 0 THEN
    RAISE EXCEPTION 'Loi moi nay dang bi khoa vi qua nhieu lan thu sai (E3)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (C2) PHIÊN KHÁCH PHẢI DẪN XUẤT DANH TÍNH TỪ CHÍNH THÁCH THỨC ĐÃ ĐỐI CHIẾU
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.guest_session_kiem_danh_tinh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  tt_loi_moi uuid;
  tt_contact uuid;
  tt_kenh text;
  tt_da_dung timestamptz;
BEGIN
  IF NEW.challenge_id IS NULL THEN
    RAISE EXCEPTION 'Phien khach phai tro toi thach thuc OTP da doi chieu (C2)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.invitation_id, c.contact_id, c.channel, c.consumed_at
    INTO tt_loi_moi, tt_contact, tt_kenh, tt_da_dung
    FROM public.invitation_otp_challenges c
   WHERE c.id = NEW.challenge_id AND c.org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay thach thuc OTP' USING ERRCODE = 'check_violation';
  END IF;

  -- Thách thức phải ĐÃ ĐƯỢC TIÊU THỤ: một phiên mở ra từ một thách thức chưa đối chiếu là đúng
  -- thứ E2 cấm.
  IF tt_da_dung IS NULL THEN
    RAISE EXCEPTION 'Thach thuc OTP chua duoc doi chieu (E2)' USING ERRCODE = 'check_violation';
  END IF;

  IF tt_loi_moi IS DISTINCT FROM NEW.invitation_id THEN
    RAISE EXCEPTION 'Thach thuc OTP thuoc mot loi moi khac' USING ERRCODE = 'check_violation';
  END IF;

  -- ĐÂY LÀ DÒNG ĐÓNG C2. Ở bản 010, `verified_contact_id` là một tham số: kẻ tấn công cho gửi OTP
  -- tới số của mình rồi khai `verifiedContactId = <người liên hệ chính danh>`, và sổ kiểm toán —
  -- bằng chứng pháp lý duy nhất của hệ thống — ghi rằng chính người đó đã xác thực. Nạn nhân
  -- không phản bác được bằng dữ liệu của hệ thống.
  IF NEW.verified_contact_id IS DISTINCT FROM tt_contact
     OR NEW.verified_channel IS DISTINCT FROM tt_kenh THEN
    RAISE EXCEPTION
      'Danh tinh da xac thuc phai DAN XUAT tu thach thuc OTP, khong duoc khai (C2, E5)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER guest_sessions_kiem_danh_tinh
  BEFORE INSERT ON guest_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guest_session_kiem_danh_tinh();

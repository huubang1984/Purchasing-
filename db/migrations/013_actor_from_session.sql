-- db/migrations/013_actor_from_session.sql
-- ADR-016 biến thành câu lệnh: DANH TÍNH ĐÃ XÁC THỰC LÀ DẪN XUẤT, KHÔNG PHẢI LỜI KHAI.
--
-- ============================================================================================
-- KHUÔN NÀY KHÔNG MỚI, VÀ ĐÓ LÀ ĐIỂM MẠNH CỦA NÓ
-- ============================================================================================
-- Vòng sửa S1.2 (H-1) đã đóng đúng lỗ này cho MỘT cột: `rfq_packages.created_by` nay đòi
-- `created_by_session_id`, và `rfq_kiem_nguoi_tao` (011) đòi `sessions.user_id = created_by`.
-- Ca tấn công đã ghi tại chỗ: *Mallory gọi createRfq({ createdBy: idCuaBob }) rồi tự duyệt được,
-- vì trigger so Bob = Mallory -> sai -> cho qua. D2 tụt từ "hai người khác người tạo" xuống "một
-- người".*
--
-- Ba CRITICAL của S1.3 là CÙNG hình dạng và đã đóng bằng CÙNG cách: thêm một cạnh DỮ LIỆU rồi để
-- trigger đòi các cạnh nhất quán. File này chỉ làm một việc — áp khuôn ấy cho phần còn lại của
-- S1.1/S1.3, và làm nó MỘT LẦN bằng một hàm trigger chung thay vì bốn bản sao.
--
-- ============================================================================================
-- VÌ SAO KHÔNG CÓ KHOÁ NGOẠI TỪ `*_session_id` SANG `sessions`
-- ============================================================================================
-- `sessions` có `(org_id, id)` UNIQUE từ 009, nên khoá ngoại hợp thành là VIẾT ĐƯỢC. Nó vẫn bị
-- từ chối, và lý do là VÒNG ĐỜI chứ không phải oracle: một phiên hết hạn hay bị thu hồi là
-- chuyện thường ngày, còn "ai tạo hàng này" là một SỰ THẬT LỊCH SỬ không được mất đi khi phiên
-- ấy bị dọn. Một khoá ngoại ở đây biến mọi lượt dọn `sessions` thành một lượt xoá dữ liệu kiểm
-- toán, hoặc thành một `ON DELETE SET NULL` âm thầm xoá đúng bằng chứng cần giữ.
--
-- PHÁT BIỂU ĐÚNG MỨC, không rộng hơn: trigger dưới đây kiểm phiên TẠI THỜI ĐIỂM GHI. Nó KHÔNG
-- nói gì về sau đó, và không cần nói — hàng đã ghi là một sự kiện đã xảy ra.
--
-- ============================================================================================
-- ĐIỀU FILE NÀY KHÔNG ĐÓNG
-- ============================================================================================
-- `app_api` bị chiếm vẫn đặt được `sessionId` của bất kỳ phiên nào đang sống. Trigger chặn LỖI
-- LẬP TRÌNH và chặn một lời khai bịa ra từ hư không; nó KHÔNG chặn kẻ đã ở trong tiến trình.
-- Cùng hạn chế cấu trúc đã ghi cho E3 và cho ADR-014.
--
-- Và nó KHÔNG là một cổng quyền. ADR-016 mục 1 đặt `requirePermission` ở TẦNG ỨNG DỤNG; file này
-- chỉ làm cho câu "ai làm việc này" thôi là một lời khai. Hai thứ khác nhau, và ô ✅ của D5 vẫn
-- chưa được gắn.

-- ============================================================================================
-- (1) HÀM TRIGGER CHUNG — TG_ARGV[0] = cột NGƯỜI, TG_ARGV[1] = cột PHIÊN
-- ============================================================================================
-- Cùng khuôn `thu_hoi_don_dieu` của 012: đọc cột theo TÊN qua `to_jsonb(NEW)`, nên một hàm phục
-- vụ được mọi bảng. Bốn bản sao của cùng một luật là đúng thứ đã hỏng hai lần ở 002 (CR3 với
-- `organizations.slug`, rồi lại với `users_pkey` cách đó 50 dòng).
CREATE OR REPLACE FUNCTION public.kiem_danh_tinh_theo_phien() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  cot_nguoi  text := TG_ARGV[0];
  cot_phien  text := TG_ARGV[1];
  id_nguoi   uuid;
  id_phien   uuid;
  chu_phien  uuid;
BEGIN
  id_nguoi := (to_jsonb(NEW) ->> cot_nguoi)::uuid;
  id_phien := (to_jsonb(NEW) ->> cot_phien)::uuid;

  IF id_phien IS NULL THEN
    RAISE EXCEPTION '%.% phai duoc dat: danh tinh la DAN XUAT cua mot phien, khong phai loi khai',
      TG_TABLE_NAME, cot_phien
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.user_id INTO chu_phien
    FROM public.sessions s
   WHERE s.id OPERATOR(pg_catalog.=) id_phien
     AND s.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND s.revoked_at IS NULL
     AND s.expires_at OPERATOR(pg_catalog.>) now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien khong hop le: het han, bi thu hoi, hoac thuoc to chuc khac (%.%)',
      TG_TABLE_NAME, cot_phien
      USING ERRCODE = 'check_violation';
  END IF;

  IF chu_phien IS DISTINCT FROM id_nguoi THEN
    RAISE EXCEPTION '%.% khong khop chu phien — no phai la DAN XUAT, khong phai loi khai',
      TG_TABLE_NAME, cot_nguoi
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (2) SỔ NHÀ CUNG CẤP — S1.1 KHÔNG CÓ MỘT CỘT NÀO GHI AI TẠO HÀNG
-- ============================================================================================
-- Đây là phần MEDIUM-3 nêu, và nó nặng hơn "thiếu một cổng quyền": `createSupplier` ghi
-- `actor_id` vào sổ kiểm toán từ một tham số, còn CHÍNH BẢNG thì không giữ gì cả. Nên tới hôm
-- nay, câu hỏi "ai đã thêm nhà cung cấp này" không trả lời được từ dữ liệu — chỉ trả lời được từ
-- một sổ kiểm toán mà chính nó nhận đầu vào là lời khai.
ALTER TABLE suppliers ADD COLUMN created_by uuid;
ALTER TABLE suppliers ADD COLUMN created_by_session_id uuid;
-- Khoá ngoại HỢP THÀNH, khuôn 006 §(1): cặp (org_id, created_by) chặn ca "người tạo thuộc tổ
-- chức khác" mà RLS `WITH CHECK` không nhìn thấy — ca đã ĐO là đi lọt với khoá ngoại đơn cột.
ALTER TABLE suppliers ADD CONSTRAINT suppliers_created_by_fkey
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id);
GRANT INSERT (created_by, created_by_session_id) ON suppliers TO app_api;

CREATE TRIGGER suppliers_kiem_danh_tinh
  BEFORE INSERT ON suppliers
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');

ALTER TABLE supplier_contacts ADD COLUMN created_by uuid;
ALTER TABLE supplier_contacts ADD COLUMN created_by_session_id uuid;
ALTER TABLE supplier_contacts ADD CONSTRAINT supplier_contacts_created_by_fkey
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id);
GRANT INSERT (created_by, created_by_session_id) ON supplier_contacts TO app_api;

CREATE TRIGGER supplier_contacts_kiem_danh_tinh
  BEFORE INSERT ON supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');

-- ============================================================================================
-- (3) LỜI MỜI — VÀ MỘT CỘT CHO ĐƯỜNG THU HỒI
-- ============================================================================================
ALTER TABLE rfq_invitations ADD COLUMN invited_by uuid;
ALTER TABLE rfq_invitations ADD COLUMN invited_by_session_id uuid;
ALTER TABLE rfq_invitations ADD CONSTRAINT rfq_invitations_invited_by_fkey
  FOREIGN KEY (org_id, invited_by) REFERENCES users (org_id, id);
GRANT INSERT (invited_by, invited_by_session_id) ON rfq_invitations TO app_api;

CREATE TRIGGER rfq_invitations_kiem_danh_tinh
  BEFORE INSERT ON rfq_invitations
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'invited_by', 'invited_by_session_id');

-- Thu hồi là một UPDATE, nên KHÔNG có hàng mới để treo trigger INSERT lên. Không có hai cột này
-- thì "ai đã thu hồi lời mời" là câu hỏi chỉ sổ kiểm toán trả lời được, và sổ kiểm toán nhận đầu
-- vào là lời khai — tức không lớp nào biết. `WHEN` giới hạn phép kiểm đúng vào lượt chuyển sang
-- đã-thu-hồi: mọi UPDATE khác trên bảng này không bị đòi gì thêm.
ALTER TABLE rfq_invitations ADD COLUMN revoked_by uuid;
ALTER TABLE rfq_invitations ADD COLUMN revoked_by_session_id uuid;
ALTER TABLE rfq_invitations ADD CONSTRAINT rfq_invitations_revoked_by_fkey
  FOREIGN KEY (org_id, revoked_by) REFERENCES users (org_id, id);
GRANT UPDATE (revoked_by, revoked_by_session_id) ON rfq_invitations TO app_api;

CREATE TRIGGER rfq_invitations_kiem_nguoi_thu_hoi
  BEFORE UPDATE ON rfq_invitations
  FOR EACH ROW
  WHEN (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL)
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('revoked_by', 'revoked_by_session_id');

-- ============================================================================================
-- (4) TOKEN MAGIC LINK — ĐÚC MỘT CREDENTIAL BEARER LÀ THAO TÁC ĐÁNG GHI SỔ NHẤT CỦA CẢ GÓI
-- ============================================================================================
-- Câu trên là nguyên văn lý do [M4] đã thêm sự kiện kiểm toán cho `issueMagicLinkToken`. Nó đúng,
-- và chính vì nó đúng mà một sự kiện ghi `actor_id` từ lời khai là chỗ tệ nhất để còn lời khai.
ALTER TABLE rfq_invitation_tokens ADD COLUMN issued_by uuid;
ALTER TABLE rfq_invitation_tokens ADD COLUMN issued_by_session_id uuid;
ALTER TABLE rfq_invitation_tokens ADD CONSTRAINT rfq_invitation_tokens_issued_by_fkey
  FOREIGN KEY (org_id, issued_by) REFERENCES users (org_id, id);
GRANT INSERT (issued_by, issued_by_session_id) ON rfq_invitation_tokens TO app_api;

CREATE TRIGGER rfq_invitation_tokens_kiem_danh_tinh
  BEFORE INSERT ON rfq_invitation_tokens
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'issued_by', 'issued_by_session_id');

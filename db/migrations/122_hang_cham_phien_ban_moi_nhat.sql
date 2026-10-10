-- ==============================================================================================
-- 122_hang_cham_phien_ban_moi_nhat — [S1.290] HÀNG CHẤM CHỈ NHẬN PHIÊN BẢN MỚI NHẤT ĐÃ MỞ CỦA LUỒNG BÁO GIÁ, LỜI MỜI CÒN SỐNG
-- (J1, vế phiên bản — tiếp TRUNG-1 của rà soát §S1.288)
--
-- `121` (5) buộc hàng chấm ghi trong CHÍNH giao dịch tạo lượt, cho báo giá của ĐÚNG gói, và nói ra vế còn mở: một đường ghi thứ hai
-- dựng TRỌN một lượt chấm trong giao dịch của nó vẫn chọn được hàng trong các bản rõ của gói. Đo lúc viết (`luot-danh-gia.int`, khối
-- `[S1.290]`): dưới `app_api`, lượt ấy nhận được phiên bản VÒNG MỘT của nhà cung cấp đã nộp lại ở BAFO (giá cũ — khoá ngoại sang
-- `rfq_unsealed_bids` cho qua vì bản rõ ấy vẫn còn, bảng chỉ-ghi-thêm), và báo giá của lời mời ĐÃ THU HỒI. `docBaoGia` không bao giờ
-- đọc hai thứ ấy: luật của nó (§S1.108 mục 7d, khoản 250 / ADR-128) là MỘT hàng cho MỘT luồng — phiên bản `version` lớn nhất trong
-- số đã mở — và chỉ luồng của lời mời còn sống.
--
-- `luot_cham_kiem_phien_ban` — trigger BEFORE INSERT của `rfq_evaluation_lines` — chép đúng luật ấy vào CSDL:
--   · lời mời của luồng đã thu hồi ⇒ `hang_cham_loi_moi_thu_hoi`;
--   · luồng có một phiên bản lớn hơn ĐÃ MỞ ⇒ `hang_cham_phien_ban_cu`.
-- Không đổi ngữ nghĩa lượt chấm sau BAFO: nhà cung cấp ngoài top-N không nộp lại, nên phiên bản mới nhất đã mở của họ vẫn là bản vòng
-- một và họ vẫn đứng trong bảng. Cùng `UNIQUE (org_id, evaluation_id, bid_version_id)` của `057`, vế thứ hai cũng cho MỘT hàng mỗi luồng.
-- "Đã mở" là có hàng ở `rfq_unsealed_bids` — đúng tập `docBaoGia` đọc; một phiên bản nộp mà chưa mở không thay bản đã mở.
--
-- Tên `rfq_evaluation_lines_kiem_phien_ban` xếp giữa `…_kiem_luot` (`121`: cùng giao dịch, đúng gói) và `…_kiem_thanh_phan` (`057`:
-- hình dạng thành phần) — BEFORE cùng sự kiện chạy theo thứ tự tên: hàng ngoài giao dịch hay của gói khác nghe lý do ấy trước.
--
-- Đua: lượt chấm chỉ tạo được ở `UNSEALED`/`BAFO_UNSEALED`, và không lần mở phong bì nào chạy ở hai trạng thái ấy (mở thầu vòng một
-- dẫn tới `UNSEALED`, mở vòng BAFO dẫn tới `BAFO_UNSEALED`). Một lần thu hồi commit giữa `docBaoGia` và câu ghi hàng thì câu ghi bị
-- từ chối — đóng, không mở.
-- ==============================================================================================

CREATE OR REPLACE FUNCTION public.luot_cham_kiem_phien_ban() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  luong record;
BEGIN
  SELECT v.bid_id, v.version, i.revoked_at INTO luong
    FROM public.vendor_bid_versions v
    JOIN public.vendor_bids b ON b.org_id = v.org_id AND b.id = v.bid_id
    JOIN public.rfq_invitations i ON i.org_id = b.org_id AND i.id = b.invitation_id
   WHERE v.org_id = NEW.org_id AND v.id = NEW.bid_version_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF luong.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bao gia % thuoc loi moi da thu hoi, khong vao luot cham (J1)', NEW.bid_version_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hang_cham_loi_moi_thu_hoi';
  END IF;
  IF EXISTS (SELECT 1
               FROM public.vendor_bid_versions v
               JOIN public.rfq_unsealed_bids u ON u.org_id = v.org_id AND u.bid_version_id = v.id
              WHERE v.org_id = NEW.org_id AND v.bid_id = luong.bid_id AND v.version > luong.version) THEN
    RAISE EXCEPTION 'Bao gia % da co phien ban moi hon da mo, khong vao luot cham (J1)', NEW.bid_version_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hang_cham_phien_ban_cu';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_evaluation_lines_kiem_phien_ban
  BEFORE INSERT ON rfq_evaluation_lines
  FOR EACH ROW EXECUTE FUNCTION public.luot_cham_kiem_phien_ban();
ALTER TABLE rfq_evaluation_lines ENABLE ALWAYS TRIGGER rfq_evaluation_lines_kiem_phien_ban;

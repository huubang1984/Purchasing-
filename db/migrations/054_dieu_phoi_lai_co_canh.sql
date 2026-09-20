-- ==============================================================================================
-- 054 — [S1.96 / khoản 159, và điều kiện để đóng khoản 130]
-- CẶP NGƯỜI-VÀ-PHIÊN ĐIỀU PHỐI PHẢI ĐƯỢC KIỂM Ở **MỌI** LẦN GHI, KHÔNG CHỈ LẦN ĐẦU.
--
-- 022 mục (5) dựng ba cột `dispatched_*` để câu hỏi *"ai đã ra lệnh mở thầu"* có một câu trả lời
-- DẪN XUẤT từ một phiên có thật, chứ không phải một lời khai. Nhưng trigger canh nó mang
--
--     WHEN (NEW.dispatched_by IS NOT NULL AND OLD.dispatched_by IS NULL)
--
-- nên nó chỉ canh lần ghi ĐẦU. Trên một lần ghi ĐÈ, `kiem_danh_tinh_theo_phien` KHÔNG chạy:
-- `dispatched_by_session_id` không có khoá ngoại, nên nó nhận một uuid bất kỳ — kể cả phiên đã
-- thu hồi, hết hạn, thuộc tổ chức khác, hay không tồn tại. Đúng thứ ba cột ấy dựng ra để chống.
-- Khoản 159 đo được điều này ở S1.81 và ghi: *"CHƯA TỚI ĐƯỢC hôm nay — đường mã duy nhất ghi ba
-- cột này là `dispatchUnseal`, và nó mang `AND dispatched_at IS NULL`."*
--
-- **VÒNG NÀY MỞ ĐÚNG ĐƯỜNG ẤY** (khoản 130: một job mở thầu chết phải điều phối lại được), nên
-- lớp phải đứng TRƯỚC. Thứ tự ấy là cố ý: migration này đi trước bản vá ứng dụng trong cùng một
-- vòng, và nếu ai đó revert bản vá ứng dụng thì lớp này vẫn ở lại, không ngược lại.
--
-- VÌ SAO KHÔNG CẤM HẲN GHI ĐÈ (cách đóng mà chính khoản 159 đề xuất): cấm ghi đè đóng luôn cửa
-- của khoản 130. Worker hỏi lại vế 2 của D1 lúc giải mã bằng
-- `assertFreshMfa(dispatched_by_session_id, dispatched_by)`, nên một job điều phối lại mà vẫn
-- mang phiên CŨ sẽ bị từ chối `MFA_FRESH` vĩnh viễn — đường phục hồi chết ngay lúc sinh. Kiểm
-- MỌI lần ghi mạnh hơn cấm ghi: nó cho phép đường hợp lệ và vẫn bắt mọi lời khai.
--
-- VÌ SAO `IS DISTINCT FROM` CHỨ KHÔNG PHẢI BỎ HẲN MỆNH ĐỀ `WHEN`: bỏ hẳn thì trigger chạy ở MỌI
-- update trên bảng, kể cả lần `app_unseal` tuyên bố `EXECUTED` — mà lúc ấy phiên của người điều
-- phối có thể đã đóng, và đường hợp lệ gãy. Khoản 159 ghi sẵn cảnh báo ấy. Vế `IS DISTINCT FROM`
-- fire ĐÚNG khi cặp ĐỔI: lần đầu (`OLD` NULL), và mọi lần ghi đè. Lần `EXECUTED` không đổi cặp
-- nên không fire.
--
-- `dispatched_at` KHÔNG nằm trong vế này, và nó vẫn bất biến: `unseal_dieu_phoi_mot_lan` (022)
-- ném khi `dispatched_at` đổi. Nên sau vòng này, hàng mang mốc của lần điều phối ĐẦU và cặp
-- người-phiên của lần thử ĐANG CHẠY — hai nghĩa khác nhau, và sổ kiểm toán nối chúng lại bằng
-- một hàng `UNSEAL_REDISPATCHED` mang cả cặp cũ lẫn cặp mới.
-- ==============================================================================================

DROP TRIGGER IF EXISTS unseal_requests_kiem_nguoi_dieu_phoi ON unseal_requests;

CREATE TRIGGER unseal_requests_kiem_nguoi_dieu_phoi
  BEFORE UPDATE ON unseal_requests
  FOR EACH ROW
  WHEN (NEW.dispatched_by IS NOT NULL
        AND (NEW.dispatched_by IS DISTINCT FROM OLD.dispatched_by
             OR NEW.dispatched_by_session_id IS DISTINCT FROM OLD.dispatched_by_session_id))
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('dispatched_by', 'dispatched_by_session_id');

-- Khuôn 043: trigger canh danh tính chạy CẢ khi phiên đặt `session_replication_role = replica`.
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_nguoi_dieu_phoi;

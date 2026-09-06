-- db/migrations/020_comparison.sql
-- S1.7 — BẢNG SO SÁNH SAU MỞ THẦU: hai bất biến, KHÔNG bảng mới, và một phép tính đổi chỗ ở.
--
-- ============================================================================================
-- FILE NÀY KHÔNG TẠO BẢNG NÀO, VÀ ĐÓ LÀ CÂU CHỊU LỰC CỦA CẢ S1.7
-- ============================================================================================
-- Bảng so sánh là thứ NGƯỜI DÙNG nhìn thấy; nó KHÔNG phải thứ CSDL lưu. Mọi ô của nó suy được
-- từ `rfq_unsealed_bids.payload` — bảng mà 019 đã dựng với một câu duy nhất: *"nơi duy nhất giải
-- mã được là nơi duy nhất ghi được bản rõ, và nó KHÔNG đọc lại được"*.
--
-- Một bảng `rfq_comparison_rows` vật chất hoá ở đây sẽ tạo ra bản sao THỨ HAI của giá, ở một
-- bảng mà `app_api` GHI được — tức đúng thứ mà cả A1 lẫn A3 đang chặn. Vì vậy S1.7 thêm PHÉP
-- TÍNH chứ không thêm CHỖ CẤT.
--
-- ============================================================================================
-- VÌ SAO PHÉP TÍNH TIỀN Ở SQL CHỨ KHÔNG Ở TYPESCRIPT
-- ============================================================================================
-- 014 đã viết câu này một lần, cho phép so ngưỡng phê duyệt kép:
--
--   *"số tiền trong JS là `double`, nên `0.1 + 0.2 >= 0.3` là một câu hỏi không có câu trả lời
--     đáng tin."*
--
-- Nó đúng y nguyên cho `min`, `max` và nhất là `avg`: trung bình cộng của mười báo giá tính
-- bằng `number` của JavaScript là một con số KHÔNG TÁI LẬP ĐƯỢC theo thứ tự cộng. Bảng so sánh
-- là thứ người mua dùng để CHỌN, và về sau là thứ kiểm toán viên đọc lại — nó không được phép
-- phụ thuộc vào thứ tự duyệt mảng. `numeric` của Postgres là số thập phân chính xác.
--
-- ============================================================================================
-- BA THỨ FILE NÀY GIAO
-- ============================================================================================
--   (1) `org_procurement_policies.strict_blind_mode` — [A6] chế độ nghiêm là CHÍNH SÁCH
--   (2) `rfq_che_do_nghiem(uuid)`                    — [A6] tra chính sách ĐÃ GHIM của một RFQ
--   (3) `bid_so_tien(text)`                          — [A4] một chuỗi thành số tiền, hoặc NULL

-- ============================================================================================
-- (1) [A6] CHẾ ĐỘ NGHIÊM LÀ MỘT CỘT CỦA CHÍNH SÁCH, KHÔNG PHẢI CỦA RFQ
-- ============================================================================================
-- ADR-017 chốt rằng ngưỡng chính sách là THEO TỔ CHỨC, CÓ PHIÊN BẢN, và PHÂN LOẠI PHẢI TÁI LẬP
-- ĐƯỢC. "Có công bố số báo giá đã nhận trước giờ đóng không" là cùng một loại câu hỏi: nó là một
-- lựa chọn của doanh nghiệp, nó đổi theo thời gian, và khi kiểm toán viên hỏi *"vì sao tháng Ba
-- người mua nhìn thấy con số ấy"* thì câu trả lời phải nằm trong dữ liệu chứ không trong trí nhớ.
-- Một cột trên `rfq_packages` trả lời được câu đầu nhưng không trả lời được câu sau.
--
-- MẶC ĐỊNH `true` — MẶC ĐỊNH ĐÓNG. Cùng lập luận đã đặt `requires_dual_approval DEFAULT true` ở
-- 009: quên đặt thì hệ thống NGHIÊM hơn, không LỎNG hơn. Với một sản phẩm bán Blind Procurement,
-- một mặc định `false` nghĩa là mọi tổ chức chưa kịp cấu hình đều đang rò một trường phái sinh.
ALTER TABLE org_procurement_policies
  ADD COLUMN strict_blind_mode boolean NOT NULL DEFAULT true;

-- Quyền theo CỘT là cộng dồn: câu này THÊM `strict_blind_mode` vào tập cột `app_api` được INSERT
-- ở 014, không thay thế tập ấy. Vẫn KHÔNG có UPDATE — bảng này chỉ ghi thêm, đổi chính sách là
-- thêm một phiên bản. Vẫn KHÔNG cấp gì cho `app_unseal`.
GRANT INSERT (strict_blind_mode) ON org_procurement_policies TO app_api;

-- ============================================================================================
-- (2) [A6] CHẾ ĐỘ NGHIÊM CỦA MỘT RFQ — THEO CHÍNH SÁCH ĐÃ GHIM, KHÔNG THEO CHÍNH SÁCH HÔM NAY
-- ============================================================================================
-- Ba nguồn, xét theo đúng thứ tự dưới đây, và thứ tự ấy là một tuyên bố chứ không phải tiện tay:
--
--   ⑴ chính sách mà `rfq_budgets` của chính RFQ này TRỎ TỚI. Đây là nguồn ĐÚNG khi có: hàng ấy
--     là bằng chứng phân loại của RFQ, nó không sửa được sau DRAFT, và nó trỏ tới một hàng chính
--     sách KHÔNG SỬA ĐƯỢC. Tra qua nó cho một câu trả lời CỐ ĐỊNH theo thời gian.
--   ⑵ nếu RFQ không có ngân sách (được phép: chỉ RFQ muốn BỎ phê duyệt kép mới bắt buộc có),
--     lấy phiên bản chính sách mới nhất ĐÃ CÓ HIỆU LỰC lúc RFQ ra đời. Vẫn cố định theo thời
--     gian — `effective_from` và `created_at` đều là quá khứ và không sửa được.
--   ⑶ không có chính sách nào: `true`. MẶC ĐỊNH ĐÓNG, cùng lý do với cột ở mục (1).
--
-- KHÔNG SECURITY DEFINER (hardening §C cấm), nên hàm chạy dưới quyền NGƯỜI GỌI và RLS của
-- `rfq_budgets` cùng `org_procurement_policies` áp bình thường. Hệ quả: một RFQ của tổ chức khác
-- không đọc được, và hàm trả `true` — lại là hướng ĐÓNG.
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
      WHERE r.id = p_rfq AND cs.effective_from <= r.created_at
      ORDER BY cs.version DESC
      LIMIT 1),
    true)
$ham$;

-- ============================================================================================
-- (3) [A4] MỘT CHUỖI THÀNH SỐ TIỀN, HOẶC THÀNH NULL — KHÔNG BAO GIỜ THÀNH MỘT LẦN NÉM
-- ============================================================================================
-- `rfq_unsealed_bids.payload` là `jsonb` và 019 đã ghi rõ vì sao nó KHÔNG phải các cột số:
-- *"một cột `unit_price numeric` ở đây sẽ là một lời hứa về lược đồ mà S1 chưa có quyền hứa"*.
-- Hệ quả: nội dung của `payload` là thứ NHÀ CUNG CẤP viết, đi qua một phong bì mà máy chủ không
-- đọc được, nên tới đây nó là DỮ LIỆU KHÔNG TIN ĐƯỢC. `'abc'::numeric` ném; một lần ném giữa
-- một truy vấn tổng hợp làm HỎNG CẢ BẢNG SO SÁNH vì đúng một nhà cung cấp gõ sai.
--
-- Vì vậy phép chuyển này TRẢ NULL thay vì ném. Hàng ấy KHÔNG bị vứt đi — nó vẫn nằm trong bảng
-- so sánh, chỉ không có giá, và tầng ứng dụng đếm riêng thành `unparsed`. Cùng quyết định về
-- SẴN SÀNG đã viết ở `thanhJson` của `apps/unseal-worker`.
--
-- BỐN THỨ BỊ TỪ CHỐI, và ba trong bốn là bẫy của chính kiểu `numeric`:
--   • chuỗi không phải số           -> NULL
--   • 'NaN'      — `numeric` NHẬN nó, và `'NaN' > 0` là TRUE trong Postgres (011 đã đo một lần)
--   • 'Infinity' — `numeric` cũng NHẬN nó kể từ PG 14
--   • số ÂM      — một báo giá âm không phải một báo giá; để nó lọt là để nó thắng mọi phép `min`
CREATE OR REPLACE FUNCTION public.bid_so_tien(p_van text) RETURNS numeric
  LANGUAGE plpgsql IMMUTABLE STRICT
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  n numeric;
BEGIN
  BEGIN
    n := p_van::numeric;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF n = 'NaN'::numeric OR n >= 'Infinity'::numeric OR n <= '-Infinity'::numeric THEN
    RETURN NULL;
  END IF;
  IF n < 0 THEN
    RETURN NULL;
  END IF;
  RETURN n;
END
$ham$;

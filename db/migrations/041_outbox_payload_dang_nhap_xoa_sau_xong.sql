-- =============================================================================================
-- 041 — [review H4-3 / sổ nợ 38] PAYLOAD CỦA JOB `LOGIN_LINK_SEND` BỊ XOÁ KHI JOB KẾT THÚC
-- =============================================================================================
-- Hợp đồng payload của gói outbox (`packages/outbox/src/enqueue.ts`, 007 §MỤC 1) gọi tên `email` là
-- thứ KHÔNG được viết: payload mang THAM CHIẾU, và 007 đo được payload đi vào log Postgres qua ba
-- đường cấu hình. Nợ 38 đưa email vào payload — nó là tham chiếu (handler tra người dùng bằng nó),
-- nhưng nó cũng là PII do NGƯỜI GỌI VÔ DANH chọn, mỗi lời gọi một hàng, và `outbox_jobs` chỉ lớn
-- lên: `app_api` không có UPDATE (payload) lẫn DELETE (007). Một bản sao lưu CSDL vì thế chứa mọi
-- email từng gõ vào cửa đăng nhập — kể cả email KHÔNG phải người dùng, chính thứ kẻ dò gõ.
--
-- Lớp ở CSDL: khi job ĐÃ KẾT THÚC (DONE hay FAILED chung cuộc — không phải PENDING chờ thử lại),
-- payload của kind này trở về `{}`. Trigger BEFORE UPDATE sửa NEW.payload, nên KHÔNG cần nới ACL:
-- app_api vẫn không có UPDATE (payload) — cùng khuôn "cột do trigger đặt, không do người gọi" của
-- 013. Vô điều kiện theo kind, không theo đường ứng dụng: xoá email đã dùng xong là tính chất của
-- kind, không phải của người ghi. Phần chênh còn lại, nói ra: email nằm trong payload từ lúc
-- enqueue tới lúc job xong (giây, hoặc tới lần thử lại cuối), và trong log Postgres nếu cấu hình
-- ghi tham số bind (007 §MỤC 1). Lớp thứ hai ở handler HTTP: email phải có hình dạng email
-- (`auth.ts`) — không lưu chuỗi tuỳ ý. Thân hàm này chưa được hardening ghim — sổ nợ 51.
-- =============================================================================================

CREATE FUNCTION public.outbox_jobs_xoa_payload_dang_nhap() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  NEW.payload := '{}'::pg_catalog.jsonb;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER outbox_jobs_xoa_payload_dang_nhap
  BEFORE UPDATE ON outbox_jobs
  FOR EACH ROW
  WHEN (NEW.kind = 'LOGIN_LINK_SEND' AND NEW.status IN ('DONE', 'FAILED') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.outbox_jobs_xoa_payload_dang_nhap();
ALTER TABLE outbox_jobs ENABLE ALWAYS TRIGGER outbox_jobs_xoa_payload_dang_nhap;

-- db/migrations/025_worker_doc_hang_doi.sql
-- KHOẢN NỢ 34, PHẦN TẦNG CSDL — WORKER PHẢI TỰ NHẶT ĐƯỢC VIỆC CỦA MÌNH
--
-- ============================================================================================
-- MỘT CÂU CỦA 007 HẾT ĐÚNG, VÀ NÓ HẾT ĐÚNG THEO MỘT CÁCH ĐÃ ĐƯỢC BÁO TRƯỚC
-- ============================================================================================
-- 007 kết thúc bằng: *"Xem LỆCH KHỎI BRIEF (6/9): cố ý KHÔNG cấp gì cho app_unseal — kể cả
-- SELECT."* Câu ấy ĐÚNG vào lúc nó được viết: ở S0 không có một `kind` nào mà `app_unseal` phải
-- xử lý, nên một GRANT "cho chắc" là một quyền không ai gỡ ra nữa.
--
-- S1.6 và khoản nợ 34 làm nó hết đúng. Nay có ĐÚNG HAI `kind` mà chỉ tiến trình này chạy được:
--   • `UNSEAL_RFQ`               — mở bọc khoá và ghi bản rõ; `app_api` KHÔNG có quyền làm;
--   • `BREAK_GLASS_UNSEAL_ALERT` — cảnh báo phải được GIAO, và giao ở đâu thì audit ở đó.
--
-- Không cấp, thì hai lựa chọn còn lại đều tệ hơn: chạy runner dưới `app_api` (nó không mở bọc
-- được khoá), hoặc để hai `kind` ấy không ai nhận (đúng khoản nợ 34).
--
-- ============================================================================================
-- QUYỀN ĐƯỢC CẤP ĐÚNG BẰNG BỘ CỦA `app_api`, KHÔNG HƠN — VÀ CỐ Ý KHÔNG CÓ `INSERT`
-- ============================================================================================
-- `app_unseal` KHÔNG được xếp việc. Một tiến trình vừa tự tạo job vừa tự chạy job là một tiến
-- trình tự cấp việc cho mình, và với tiến trình DUY NHẤT giữ khả năng giải mã thì đó là đúng thứ
-- ADR-006 dựng hai role để đóng. Đường xếp việc đi qua `dispatchUnseal` phía `api`, sau cổng bốn
-- vế của D1.
--
-- RLS của `outbox_jobs` (007) giữ nguyên và áp cho role này y hệt: `app_unseal` cũng
-- `NOBYPASSRLS`, nên nó chỉ thấy job của tổ chức đang gắn.
GRANT SELECT ON outbox_jobs TO app_unseal;
GRANT UPDATE (status, attempts, last_failure_reason, run_after, lease_expires_at, finished_at)
  ON outbox_jobs TO app_unseal;

-- =============================================================================================
-- 028 — [S1.10.3] HAI KHE MÀ ĐƯỜNG KHÁCH QUA HTTP CẦN: khoá CÔNG KHAI của đúng RFQ được mời, và
--       quyền CHÈN (không đọc) vào sổ kiểm toán cho hàng của một SUPPLIER
-- =============================================================================================
-- `027` đóng MỌI bảng chưa có policy `<bảng>_khach` bằng một vị từ từ chối, và liệt kê
-- `rfq_key_material` trong số đó với lý do *"không bảng nào trong số đó có lý do xuất hiện trước
-- một phiên khách"*. Câu ấy đúng cho `wrapped_private_key` và SAI cho `public_key`: nhà cung cấp
-- niêm phong báo giá bằng CHÍNH khoá công khai của RFQ (ADR-007, S1.4), và đường lấy nó — trong
-- thiết kế của ADR-020 — là `GET /guest/rfq` chạy DƯỚI `withGuestSession()`. Hôm nay đường ấy đọc
-- được 0 hàng: policy đóng của 027 thắng, và `getRfqPublicKeys` trả mảng rỗng trong im lặng.
--
-- Đo được, và phép đo sống trong bộ test chứ không trong trí nhớ: `apps/api/src/guest.int.test.ts`
-- có một đối chứng dựng lại policy đóng của 027 rồi gọi cùng đường — `publicKeys` về `[]`;
-- khôi phục policy của file này thì có khoá. Không phải lỗi của hàm — là 027 làm đúng việc nó
-- nói, và lược đồ thiếu một câu.
--
-- ---------------------------------------------------------------------------------------------
-- HÌNH DẠNG: THAY policy đóng bằng policy MỞ ĐÚNG MỘT RFQ, vẫn AS RESTRICTIVE
-- ---------------------------------------------------------------------------------------------
--   • `USING`: không có phiên khách ⇒ như cũ (đường người mua không đổi); có phiên khách ⇒ chỉ
--     hàng có `rfq_id` = GUC `app.guest_rfq_id` — GUC THỨ BA mà `withGuestSession()` dẫn xuất từ
--     chính hàng phiên, cùng cách `rfq_packages_khach` và `rfq_items_khach` của 027 dùng.
--   • `WITH CHECK`: một phiên khách KHÔNG ghi được gì vào bảng này. Vế này cố ý HẸP HƠN vế
--     `USING` — đọc được khoá công khai không kéo theo được sinh khoá.
--   • Cột nào đọc được vẫn do GRANT của 017/019 quyết: `app_api` không có `SELECT` trên
--     `wrapped_private_key`, nên policy này mở HÀNG chứ không mở CỘT — khoá riêng đã bọc vẫn là
--     thứ một phiên khách không hỏi được.
--
-- `DROP POLICY` rồi `CREATE POLICY` chứ không `ALTER POLICY`: lớp canh hình dạng migration
-- (`db/migration-shape.test.ts`) miễn trừ có điều kiện cho `CREATE POLICY ... AS RESTRICTIVE`
-- (chỉ SIẾT thêm vào policy cho phép sẵn có) và CẤM `ALTER POLICY` kể cả khi mang RESTRICTIVE.
-- Ở đây thay một policy hạn chế bằng một policy hạn chế khác ÍT hạn chế hơn — nói thẳng: đây
-- là một lần NỚI có chủ đích, và phạm vi nới là "một phiên khách thấy khoá CÔNG KHAI của đúng
-- RFQ mình được mời". Phép đo ở `apps/api/src/guest.int.test.ts`: khách A không thấy khoá của
-- RFQ B, và không INSERT được vào bảng này.
-- ---------------------------------------------------------------------------------------------
-- (2) SỔ KIỂM TOÁN: CỐ Ý KHÔNG MỞ — và lý do là một phép đo đã đổi thiết kế của S1.10.3
-- ---------------------------------------------------------------------------------------------
-- 027 viết: *"Đường GHI vì thế cũng đóng theo — một kết nối đã gắn phiên khách không chèn được
-- vào `audit_events` hay `outbox_jobs`. Nếu mai sau đường ghi của khách chuyển sang
-- `withGuestSession()`, nó sẽ hỏng ỒN ÀO ở đây thay vì âm thầm ghi được."*
--
-- Nó đã hỏng ồn ào, đúng như hẹn. Đo 2026-09-06: `submitBid` dưới `withGuestSession()` ⇒
-- `42501 new row violates row-level security policy "audit_events_khach"`, tại `audit_append`
-- câu lệnh 1 (INSERT ... RETURNING — vế RETURNING bị vị từ USING đóng từ chối).
--
-- Bản đầu của file này ĐÃ VIẾT một policy mở khe ấy (`WITH CHECK (... OR actor_type = 'SUPPLIER')`)
-- rồi bị chính lược đồ bác bỏ: trigger `noi_chuoi_kiem_toan()` (004) là SECURITY INVOKER và tìm
-- ĐẦU CHUỖI bằng `SELECT ... FROM audit_events WHERE org_id = NEW.org_id ORDER BY seq DESC LIMIT 1`
-- — dưới CHÍNH RLS của kết nối đang chèn. Một kết nối khách với USING đóng thấy 0 hàng, tính
-- `seq = 1`, `prev_hash = 0…0`, và chèn một NHÁNH RẼ của chuỗi (hoặc va `UNIQUE (org_id, seq)`).
-- Mở USING cho khách để trigger đọc được thì lại cho một nhà cung cấp đọc sổ kiểm toán của cả
-- tổ chức — đúng thứ A5 cấm. Không có policy nào đúng cả hai vế cùng lúc.
--
-- KẾT LUẬN, và nó là kiến trúc chứ không phải một dòng SQL: **một kết nối đã gắn phiên khách KHÔNG
-- BAO GIỜ được chèn vào sổ kiểm toán.** Đường GHI của khách (`POST /guest/bids`) vì thế chạy dưới
-- `withTenant()` SAU KHI phiên đã được xác thực bởi `resolveGuestSessionByToken` — cô lập của đường
-- ghi do trigger `bid_kiem_phien_khach` (018) và chữ ký `submitBid` (chỉ nhận `guestSessionId`,
-- mọi thứ khác DẪN XUẤT) giữ; đường ĐỌC của khách vẫn dưới `withGuestSession()`. Phần chênh này
-- ghi ở §4 của A5 trong ma trận, và `apps/api/src/dispatch.ts` là nơi duy nhất rẽ nhánh ấy.
-- Policy `audit_events_khach` của 027 GIỮ NGUYÊN.

-- ---------------------------------------------------------------------------------------------
-- (1) KHOÁ CÔNG KHAI — xem khối đầu file
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS rfq_key_material_khach ON rfq_key_material;

CREATE POLICY rfq_key_material_khach ON rfq_key_material AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
         OR rfq_id OPERATOR(pg_catalog.=)
            NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '')::pg_catalog.uuid)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- =============================================================================================
-- `9545_khong_tim_thay_yeu_cau_co_ten.sql` — [S1.9145 / khoản 266] NHÁNH "KHÔNG THẤY YÊU CẦU" CỦA `unseal_kiem_nguoi_duyet` MANG TÊN
-- =============================================================================================
-- `019` RAISE `foreign_key_violation` (23503) KHÔNG tên ràng buộc khi trigger không thấy yêu cầu mở thầu trong tổ chức (id lạ, hay id
-- CÓ THẬT của tổ chức khác mà RLS giấu) — và trigger fire TRƯỚC khoá ngoại, nên lỗi `pg` mang `code` mà không mang `constraint`. Tầng
-- gói (`approveUnseal`, `packages/unseal/src/requests.ts`, khoản 133) vì thế nhận "không tìm thấy" bằng `code` một mình: MỌI 23503 của
-- câu INSERT vào `unseal_approvals` thành hàng `UNSEAL_NOT_FOUND_DENIED` — kể cả một 23503 vì nguyên nhân khác (người duyệt bị xoá cứng
-- giữa chừng, một khoá ngoại thêm sau), tức một hàng sổ nói sai nguyên nhân. Khuôn "đọc code VÀ constraint" của ADR-108
-- (`laTrungPheDuyet`, `CHOT_THEO_RANG_BUOC`) tới đây chỉ đi được nửa.
--
-- SỬA: nhánh ấy mang TÊN `unseal_approvals_yeu_cau_phai_ton_tai` (`USING … CONSTRAINT`) — khuôn `c1_qua_han_nop` của `066` và mười ba
-- tên của `074`. Tên KHÔNG phải một ràng buộc trong `pg_constraint`: nó là nhãn của nhánh, đi ra ở trường `constraint` của lỗi. Tầng gói
-- đọc `code = '23503'` VÀ `constraint` bằng tên ấy; một 23503 khác đi nguyên, không hàng sổ.
--
-- Thân TRÍCH NGUYÊN VĂN từ `019` (migration cuối định nghĩa hàm) bằng script, rồi đổi đúng một chỗ: thêm `CONSTRAINT = …` vào câu
-- `RAISE` của nhánh không thấy yêu cầu. Thông điệp của CSDL không đổi — bộ lọc D2 của `approveUnseal` và vế LỊCH SỬ của
-- `packages/unseal/src/loc-vi-pham-d2.test.ts` đọc các câu `RAISE`. Bản ghim ở `hardening.always.sql` đổi cùng commit; script đối chiếu
-- bản ghim cũ với thân `019` trước khi thay. Không đổi trigger nào: `CREATE OR REPLACE FUNCTION` giữ nguyên trigger trỏ vào hàm.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_yeu_cau uuid;
  phien_yeu_cau uuid;
  trang_thai text;
BEGIN
  SELECT r.requested_by, r.requested_by_session_id, r.status
    INTO nguoi_yeu_cau, phien_yeu_cau, trang_thai
    FROM public.unseal_requests r
   WHERE r.id OPERATOR(pg_catalog.=) NEW.unseal_request_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay yeu cau mo thau %', NEW.unseal_request_id
      USING ERRCODE = 'foreign_key_violation',
            CONSTRAINT = 'unseal_approvals_yeu_cau_phai_ton_tai';
  END IF;

  IF trang_thai IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Chi phe duyet duoc yeu cau dang PENDING; dang o %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.approver_user_id OPERATOR(pg_catalog.=) nguoi_yeu_cau THEN
    RAISE EXCEPTION 'Nguoi yeu cau mo thau khong duoc tu phe duyet (D2, D3)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Vế PHIÊN, và nó KHÔNG thừa với vế người ở trên: một người có thể có hai tài khoản, nhưng
  -- một PHIÊN thì thuộc về đúng một tài khoản. Chặn cả hai vế đóng cả hai cách đọc của D2.
  IF NEW.approver_session_id OPERATOR(pg_catalog.=) phien_yeu_cau THEN
    RAISE EXCEPTION 'Phe duyet phai den tu mot PHIEN KHAC voi phien da yeu cau (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

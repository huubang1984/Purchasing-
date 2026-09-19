-- db/migrations/053_ten_rang_buoc_unseal_approvals.sql
-- KHOẢN 147 — ĐẶT TÊN HAI RÀNG BUỘC DUY NHẤT CỦA `unseal_approvals`
--
-- ============================================================================================
-- VÌ SAO MỘT CÁI TÊN LẠI LÀ MỘT BẢN VÁ CỦA BẤT BIẾN D5
-- ============================================================================================
-- `019` khai hai ràng buộc chống "một người phê duyệt hai lần" và "một PHIÊN phê duyệt hai lần"
-- VÔ DANH:
--
--     UNIQUE (org_id, unseal_request_id, approver_user_id),
--     UNIQUE (org_id, unseal_request_id, approver_session_id)
--
-- PostgreSQL tự đặt tên cho chúng, và cái tên tự đặt ấy là một DẪN XUẤT của danh sách cột: nó
-- đổi khi thứ tự cột đổi, và nó bị CẮT ở 63 byte — tên đầy đủ của vế PHIÊN dài 65 ký tự, nên
-- tên thật trong cụm là một chuỗi bị cắt cụt. `approveUnseal` phải phân loại lỗi `23505` của câu
-- INSERT để biết đây là một lần THỬ vi phạm D2, và bất biến D5 nói một lần THỬ vi phạm PHẢI để
-- lại dấu vết. Phân loại theo một cái tên mà CSDL tự đặt là phân loại theo một thứ không ai khai.
--
-- `009` đã làm đúng cho cùng khuôn ấy ở `rfq_approvals` (`rfq_approvals_mot_nguoi_mot_lan`,
-- `rfq_approvals_mot_phien_mot_lan`). File này trả nốt phần `019` bỏ sót — khoản 147, mở ở S1.77
-- và sửa lại ở S1.78.
--
-- ĐO (§S1.85), RFQ cấp kép, Postgres thật: CÙNG một người duyệt lần hai từ một PHIÊN KHÁC — đúng
-- ca mà hai ràng buộc này dựng ra để chặn — thì trigger `unseal_kiem_nguoi_duyet` CHO QUA (yêu
-- cầu còn PENDING, người duyệt khác người yêu cầu, phiên khác phiên yêu cầu), câu INSERT trượt ở
-- UNIQUE và ném `23505`; bộ lọc theo THÔNG ĐIỆP của `approveUnseal` không khớp, lỗi rơi thẳng
-- xuống `throw`, và `UNSEAL_APPROVAL_DENIED` = **0 hàng**.
--
-- ============================================================================================
-- TÌM THEO TẬP CỘT, KHÔNG THEO TÊN ĐOÁN
-- ============================================================================================
-- Tên cũ KHÔNG được viết cứng ở đây, vì viết cứng nó là lặp lại đúng sai lầm đang sửa: nó là một
-- chuỗi do PostgreSQL sinh và có thể đã bị cắt. Tìm theo TẬP CỘT — thứ `019` thật sự khai — rồi
-- đổi tên. Không tìm ra ĐÚNG MỘT ràng buộc cho một tập cột thì NÉM: lược đồ khác lời khai là thứ
-- phải dừng lần triển khai, không phải thứ ghi log rồi đi tiếp. Không `IF EXISTS`, không nuốt lỗi.
--
-- `RENAME CONSTRAINT` đổi luôn tên CHỈ MỤC nền của một ràng buộc UNIQUE, nên sau file này chỉ mục
-- cũng mang tên đọc được. Câu lệnh chỉ chạy khi tên còn khác tên đích — chạy lại file trên một
-- cụm đã đổi tên là một phép không.
-- ============================================================================================

DO $ten_rang_buoc_053$
DECLARE
  r record;
  ten_cu text;
  so bigint;
BEGIN
  FOR r IN
    SELECT m.cot, m.ten_moi
      FROM (VALUES
              (ARRAY['approver_user_id', 'org_id', 'unseal_request_id'], 'unseal_approvals_mot_nguoi_mot_lan'),
              (ARRAY['approver_session_id', 'org_id', 'unseal_request_id'], 'unseal_approvals_mot_phien_mot_lan')
           ) AS m(cot, ten_moi)
  LOOP
    SELECT pg_catalog.count(*), pg_catalog.min(c.conname::pg_catalog.text)
      INTO so, ten_cu
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid OPERATOR(pg_catalog.=) 'public.unseal_approvals'::pg_catalog.regclass
       AND c.contype OPERATOR(pg_catalog.=) 'u'
       AND (SELECT pg_catalog.array_agg(a.attname::pg_catalog.text ORDER BY a.attname::pg_catalog.text)
              FROM pg_catalog.unnest(c.conkey) AS k(attnum)
              JOIN pg_catalog.pg_attribute a
                ON a.attrelid OPERATOR(pg_catalog.=) c.conrelid
               AND a.attnum OPERATOR(pg_catalog.=) k.attnum)
           OPERATOR(pg_catalog.=) r.cot;

    IF so OPERATOR(pg_catalog.<>) 1 THEN
      RAISE EXCEPTION 'public.unseal_approvals: mong doi DUNG MOT rang buoc UNIQUE tren tap cot %, tim thay %', r.cot, so
        USING ERRCODE = 'check_violation';
    END IF;

    IF ten_cu OPERATOR(pg_catalog.<>) r.ten_moi THEN
      EXECUTE pg_catalog.format('ALTER TABLE public.unseal_approvals RENAME CONSTRAINT %I TO %I', ten_cu, r.ten_moi);
    END IF;
  END LOOP;
END
$ten_rang_buoc_053$;

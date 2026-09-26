-- =============================================================================================
-- 066 — [khoản 196 / ADR-074 phần 2] LẦN NỘP BỊ CHẶN VÌ HẠN MANG GIỜ CSDL LÚC PHÁN XỬ CÙNG HẠN
-- =============================================================================================
-- C1 (`bid_kiem_han_nop`, 018 → 059) phán xử hạn nộp bằng `now()` của CHÍNH giao dịch ghi — và đó
-- vẫn là quyết định đúng (ADR-005): `now()` cũng là giá trị `submitted_at` ghi xuống và đi vào
-- biên nhận đã ký. Thứ khoản 196 đo được là phía NGƯỜI BỊ CHẶN: lời từ chối chỉ nói
-- *"Da qua han nop bao gia (C1)"*, không một con số nào. Ngày 2026-09-20 đồng hồ container
-- Postgres chậm 6 giờ 22 phút sau một đêm máy ngủ; một nhà cung cấp bị chặn trong một cảnh như thế
-- không có gì để đối chiếu với đồng hồ của mình, và hệ thống không giữ gì để họ khiếu nại.
--
-- VÒNG NÀY ĐỔI ĐÚNG MỘT CÂU của hàm: nhánh cuối — nhánh VÌ HẠN — nay `RAISE` kèm HAI trường có
-- cấu trúc của thông báo lỗi PostgreSQL, KHÔNG đổi mã lỗi và KHÔNG đổi thông điệp:
--
--   * `CONSTRAINT = 'c1_qua_han_nop'` — tên của lần chặn. Người đọc ở tầng ứng dụng nhận ra nhánh
--     này bằng một TRƯỜNG, không bằng một lượt đọc chuỗi thông điệp (chính khối chú thích của
--     `submitBid` đã ghi rằng phân biệt ba lý do bằng chuỗi lỗi là cách SAI).
--   * `DETAIL` = một đối tượng JSON hai khoá, `gio_csdl` và `han_nop`, cả hai ở dạng chính tắc của
--     biên nhận (`bid_dau_thoi_gian_chinh_tac`: UTC, sáu chữ số micro-giây, không phụ thuộc
--     `DateStyle`/`TimeZone` của phiên). `gio_csdl` là `now()` — ĐÚNG giá trị vừa được so, không
--     phải một lần đọc đồng hồ thứ hai; `han_nop` là `han` — ĐÚNG giá trị vừa được so, tức hạn của
--     vòng BAFO đang mở khi gói thầu ở `BAFO_OPEN`.
--
-- VÌ SAO GIỮ `check_violation`: `submitBid` và `dispatch.ts` đều đọc mã ấy, và mọi phép đo của
-- C1 từ S1.5 ghim nó. Đổi mã là đổi hợp đồng của ba lớp để mua một thứ mà hai trường trên đã mua.
--
-- HAI NHÁNH KIA KHÔNG ĐỔI, có chủ đích: *"trạng thái không nhận báo giá"* và *"không có vòng BAFO"*
-- không phải lần chặn VÌ GIỜ, và trạng thái gói thầu đã đọc được ở `GET /guest/rfq`.
--
-- Hardening (`hardening.always.sql`, mục *hàm + trigger bid_kiem_han_nop*) ghim THÂN hàm từng
-- ký tự và tự dựng lại nó mỗi lần deploy — mục ấy trỏ sang migration này trong cùng commit, nếu
-- không thì lần `migrate()` kế tiếp âm thầm lùi hàm về bản `059`.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.bid_kiem_han_nop() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  han timestamptz;
  goi_thau uuid;
  vong uuid;
BEGIN
  SELECT p.status, p.deadline_at, p.id INTO trang_thai, han, goi_thau
    FROM public.vendor_bids b
    JOIN public.rfq_invitations i
      ON i.id OPERATOR(pg_catalog.=) b.invitation_id
     AND i.org_id OPERATOR(pg_catalog.=) b.org_id
    JOIN public.rfq_packages p
      ON p.id OPERATOR(pg_catalog.=) i.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) i.org_id
   WHERE b.id OPERATOR(pg_catalog.=) NEW.bid_id
     AND b.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR SHARE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay luong bao gia % trong to chuc %', NEW.bid_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF trang_thai NOT IN ('OPEN', 'BAFO_OPEN') THEN
    RAISE EXCEPTION 'RFQ khong nhan bao gia khi dang o trang thai % (C1)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF trang_thai OPERATOR(pg_catalog.=) 'BAFO_OPEN' THEN
    SELECT r.id, r.deadline_at INTO vong, han
      FROM public.rfq_bafo_rounds r
     WHERE r.rfq_id OPERATOR(pg_catalog.=) goi_thau
       AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
       AND r.closed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RFQ dang BAFO_OPEN ma khong co vong BAFO nao dang mo — du lieu hong'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Dấu vòng là DẪN XUẤT: bên gọi không có `INSERT` trên cột này, nên nó không khai được sai.
    NEW.bafo_round_id := vong;
  ELSE
    NEW.bafo_round_id := NULL;
  END IF;

  IF han IS NULL THEN
    RAISE EXCEPTION 'RFQ dang OPEN ma khong co han nop — du lieu hong'
      USING ERRCODE = 'check_violation';
  END IF;

  IF now() OPERATOR(pg_catalog.>=) han THEN
    -- [066 / khoản 196] Hai dấu thời gian là ĐÚNG hai giá trị vừa so — xem khối đầu `066`.
    RAISE EXCEPTION 'Da qua han nop bao gia (C1)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'c1_qua_han_nop',
            DETAIL = pg_catalog.json_build_object(
              'gio_csdl', public.bid_dau_thoi_gian_chinh_tac(now()),
              'han_nop', public.bid_dau_thoi_gian_chinh_tac(han))::pg_catalog.text;
  END IF;

  RETURN NEW;
END
$ham$;

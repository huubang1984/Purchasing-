-- =============================================================================================
-- `9501_tu_choi_nop_co_ten.sql` — [S1.9101 / khoản 247] HAI LẦN CHẶN NỘP BÁO GIÁ MANG TÊN, ĐỂ TẦNG GÓI GHI ĐƯỢC SỔ
-- =============================================================================================
-- ĐO (pilot giả lập S1.163, đo lại ở vòng S1.9101 trên Postgres 16 thật — biên bản §S1.9101): nộp vào gói ĐÃ HUỶ
-- và nộp ngoài top-N của vòng BAFO đều ra 422 với **0 hàng sổ**. Hai lần chặn ấy là hai nhánh `check_violation`
-- không tên của hai trigger: nhánh trạng thái của `bid_kiem_han_nop` (C1) và nhánh top-N của `bid_kiem_vong_bafo`.
-- `submitBid` chỉ nhận ra nhánh QUÁ HẠN — nhánh duy nhất mang tên (`c1_qua_han_nop`, `066`) — nên hai nhánh kia
-- làm hỏng giao dịch và không lối nào ghi được.
--
-- SỬA: mỗi nhánh mang một tên ràng buộc, khuôn `066`: `c1_goi_khong_nhan_bao_gia` và `bafo_ngoai_top_n`. Tầng gói
-- nhận ra tên, lùi về savepoint, ghi một hàng `BID_STATE_DENIED` mang mã, và route khách trả 422 mà COMMIT — cùng
-- đường `BID_DEADLINE_DENIED`. Chủ dự án chốt ngày 2026-09-27 (ADR-9201): cả bảy lần từ chối của khoản 247 vào sổ.
--
-- Thân hai hàm TRÍCH NGUYÊN VĂN từ `066` và `059` bằng script rồi đổi đúng một chỗ ở mỗi hàm (thêm `CONSTRAINT`).
-- Thông điệp của CSDL không đổi. Bản ghim ở `hardening.always.sql` đổi cùng commit. Không đổi trigger nào: `CREATE OR
-- REPLACE FUNCTION` giữ nguyên trigger đang trỏ vào hàm.
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
    -- [S1.9101 / khoản 247] Tên của lần chặn, khuôn `c1_qua_han_nop`: tầng gói nhận ra nó, lùi savepoint và ghi
    -- `BID_STATE_DENIED` — nộp khi gói không còn nhận báo giá là một bước đi sai thứ tự (ADR-060, ADR-074).
    RAISE EXCEPTION 'RFQ khong nhan bao gia khi dang o trang thai % (C1)', trang_thai
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'c1_goi_khong_nhan_bao_gia';
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

CREATE OR REPLACE FUNCTION public.bid_kiem_vong_bafo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  du_dieu_kien boolean;
BEGIN
  IF NEW.bafo_round_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Vế duy nhất: luồng báo giá này có một phiên bản ĐÃ MỞ và ĐƯỢC XẾP HẠNG trong top-N của ĐÚNG
  -- lượt đánh giá mà vòng BAFO trỏ tới. `rank IS NOT NULL` không dư: `057` cho một báo giá không
  -- đọc được giá vẫn có hàng, với `effective_cost` và `rank` cùng NULL — và `NULL <= top_n` cho
  -- NULL, nên thiếu vế này thì một báo giá KHÔNG xếp hạng được lại đi lọt.
  SELECT EXISTS (
           SELECT 1
             FROM public.rfq_bafo_rounds r
             JOIN public.rfq_evaluation_lines l
               ON l.evaluation_id OPERATOR(pg_catalog.=) r.evaluation_id
              AND l.org_id OPERATOR(pg_catalog.=) r.org_id
             JOIN public.vendor_bid_versions v
               ON v.id OPERATOR(pg_catalog.=) l.bid_version_id
              AND v.org_id OPERATOR(pg_catalog.=) l.org_id
            WHERE r.id OPERATOR(pg_catalog.=) NEW.bafo_round_id
              AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
              AND v.bid_id OPERATOR(pg_catalog.=) NEW.bid_id
              AND l.rank IS NOT NULL
              AND l.rank OPERATOR(pg_catalog.<=) r.top_n)
    INTO du_dieu_kien;

  IF NOT du_dieu_kien THEN
    -- [S1.9101 / khoản 247] Tên của lần chặn — tầng gói nhận ra nó và ghi `BID_STATE_DENIED` (ADR-060, ADR-074).
    RAISE EXCEPTION
      'Luong bao gia % khong nam trong top-N cua luot danh gia ma vong BAFO % tro toi (J4)',
      NEW.bid_id, NEW.bafo_round_id
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'bafo_ngoai_top_n';
  END IF;

  RETURN NEW;
END
$ham$;

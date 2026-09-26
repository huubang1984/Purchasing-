-- =============================================================================================
-- 068 — [S1.141 / khoản 242 ⑴] SỬA MỘT LỜI KHAI SAI TRONG THÂN `award_kiem_mot_award_song`
-- =============================================================================================
-- ĐO (lượt soi hình dạng S3 — §S1.139, khoản 242 ⑴): thân `061` khai *"Đổi `CHU_KY_CAN` là toàn
-- bộ việc phải làm nếu ngày nào chủ dự án chọn hai"*, và JSDoc của `duyetTraoThau` khai thêm
-- *"lời gọi của người duyệt thứ hai đi qua"*. Đột biến `CHU_KY_CAN := 2` trên Postgres 16 thật:
-- người duyệt đầu bị từ chối *"De xuat trao thau can 2 chu ky duyet; dang co 1"*, và số chữ ký
-- còn lại là 0; người duyệt thứ hai nhận đúng lỗi ấy. Đối chứng `CHU_KY_CAN := 1`: duyệt được.
--
-- CƠ CHẾ: `duyetTraoThau` chèn chữ ký vào `rfq_award_approvals` rồi chèn hàng `APPROVED` vào
-- `rfq_awards` trong CÙNG một giao dịch, không savepoint. Câu thứ hai bị trigger này từ chối thì
-- câu thứ nhất cuộn lại theo — không chữ ký nào tích luỹ được, nên phép đếm không bao giờ tới hai.
--
-- KHÔNG ĐỔI HÀNH VI. Hằng vẫn là MỘT (§7, chốt 2026-09-22), và hôm nay không có lỗi nào. Khoản 242
-- VẪN MỞ: điều kiện đóng là S3.5 dựng một cơ chế hai chữ ký thật — tách chữ ký khỏi hàng
-- `APPROVED`. Migration này chỉ làm cho lời khai trong thân ĐANG CHẠY nói đúng điều đã đo, để S3.5
-- không đọc một câu sai rồi tin nó.
--
-- Thân dưới được TRÍCH nguyên văn từ `061` bằng script rồi đổi đúng MỘT chỗ — khuôn mà S1.110 rút
-- ra sau khi một bản viết tay rơi 45 dòng cưỡng chế, và `067` đã dùng lại:
--   ⑴ [khoản 242 ⑴] chú thích trên phép đếm chữ ký ở nhánh `APPROVED`.
-- `061` giữ nguyên văn câu cũ và không sửa được: nó đã áp và có checksum.
--
-- `hardening.always.sql` ghim thân này, và bản ghim đổi trong CÙNG commit: một migration một mình
-- bị hardening đè ngay trong cùng lần `migrate()` (S1.96) — chú thích nằm trong `prosrc`, nên bản
-- ghim so cả nó.
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.award_kiem_mot_award_song() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  CHU_KY_CAN constant integer := 1;
  truoc_status text;
  truoc_id uuid;
  truoc_eval uuid;
  truoc_bid uuid;
  so_chu_ky integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.rfq_id::pg_catalog.text, 1));

  SELECT a.status, a.id, a.evaluation_id, a.bid_version_id
    INTO truoc_status, truoc_id, truoc_eval, truoc_bid
    FROM public.rfq_awards a
   WHERE a.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND a.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
   ORDER BY a.acted_at DESC, a.id DESC
   LIMIT 1;

  IF NEW.status OPERATOR(pg_catalog.=) 'PROPOSED' THEN
    -- Đề xuất ĐƯỢC phép khi chưa có hàng nào, hay khi hàng mới nhất đã HUỶ. Đây là vế J7.
    IF truoc_status IS NOT NULL AND truoc_status OPERATOR(pg_catalog.<>) 'CANCELLED' THEN
      RAISE EXCEPTION
        'RFQ % da co mot award con song (hang moi nhat: %) — toi da MOT (J7)',
        NEW.rfq_id, truoc_status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Mọi hàng KHÔNG phải `PROPOSED` đòi một hàng trước đó.
  IF truoc_status IS NULL THEN
    RAISE EXCEPTION 'RFQ % chua co de xuat trao thau nao de % ', NEW.rfq_id, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Chuỗi chỉ đi một chiều, và hàng mới phải nói về CÙNG báo giá của đề xuất đang sống — nếu
  -- không, một hàng `APPROVED` "duyệt" được một báo giá khác hẳn thứ đã đề xuất.
  IF NEW.evaluation_id IS DISTINCT FROM truoc_eval
     OR NEW.bid_version_id IS DISTINCT FROM truoc_bid THEN
    RAISE EXCEPTION
      'Hang % phai noi ve dung bao gia cua de xuat dang song', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status OPERATOR(pg_catalog.=) 'APPROVED' THEN
    IF truoc_status IS DISTINCT FROM 'PROPOSED' THEN
      RAISE EXCEPTION 'Chi duyet duoc mot de xuat dang o PROPOSED; hang moi nhat dang o %',
        truoc_status
        USING ERRCODE = 'check_violation';
    END IF;
    -- MỘT chữ ký, đúng §7 — chốt ngày 2026-09-22. [S1.141 / khoản 242 ⑴] Nâng RIÊNG `CHU_KY_CAN`
    -- lên hai KHÔNG phải một thay đổi đủ: nó làm trao thầu KHÔNG BAO GIỜ duyệt được.
    -- `duyetTraoThau` ghi chữ ký rồi ghi hàng `APPROVED` trong CÙNG một giao dịch, không savepoint,
    -- nên người duyệt đầu bị từ chối *"can 2 chu ky duyet; dang co 1"* và chữ ký của chính họ bị
    -- cuộn lại theo — số chữ ký còn 0; người duyệt thứ hai gặp đúng lỗi ấy. Đã đo trên Postgres 16
    -- (S1.139), và một ca T3 ở `luot-danh-gia.int.test.ts` khoá phép đo. Bản trước khai đổi hằng là
    -- *"toàn bộ việc phải làm"* — sai. S3.5 phải TÁCH chữ ký khỏi hàng `APPROVED` (hàng ấy chỉ ghi
    -- khi đủ chữ ký) trước khi con số này được nâng.
    SELECT pg_catalog.count(*)::pg_catalog.int4 INTO so_chu_ky
      FROM public.rfq_award_approvals ap
     WHERE ap.org_id OPERATOR(pg_catalog.=) NEW.org_id
       AND ap.award_id OPERATOR(pg_catalog.=) truoc_id;
    IF so_chu_ky < CHU_KY_CAN THEN
      RAISE EXCEPTION
        'De xuat trao thau can % chu ky duyet; dang co % (J3)', CHU_KY_CAN, so_chu_ky
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- `CANCELLED` — huỷ được một đề xuất đang chờ HAY một award đã duyệt.
  IF truoc_status OPERATOR(pg_catalog.=) 'CANCELLED' THEN
    RAISE EXCEPTION 'Award cua RFQ % da huy roi', NEW.rfq_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

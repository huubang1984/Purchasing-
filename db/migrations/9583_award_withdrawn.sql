-- =============================================================================================
-- `9583_award_withdrawn.sql` — [S1.9182 / khoản 232 / ADR-9282] TRẠNG THÁI THỨ TƯ `WITHDRAWN`: NGƯỜI ĐỀ XUẤT RÚT ĐỀ XUẤT
-- CHƯA CHỮ KÝ CỦA MÌNH
-- =============================================================================================
-- Khoản 232 (S1.110) đo một lựa chọn có giá: cổng HUỶ là cổng của người DUYỆT (`po.approve`, ADR-057) — đúng, vì
-- `award.recommend` do BỐN vai giữ và một `BUYER` huỷ được award ĐÃ DUYỆT rồi đề xuất người khác là phê duyệt kép bị bào mòn.
-- Cái giá: người đề xuất bấm nhầm báo giá phải đi tìm `FINANCE`/`DIRECTOR` để undo, kể cả khi đề xuất CHƯA có chữ ký nào.
-- Chủ dự án chốt ngày 2026-09-30 hình dạng ⒜: một trạng thái thứ tư ràng Ở CSDL, không một cổng quyền đọc dữ liệu ở
-- `apps/api` (hình ⒝ mở tiền lệ ấy ở chỗ đắt nhất).
--
-- (1) CHECK trạng thái của `rfq_awards` nhận thêm `WITHDRAWN`. Dòng khai ở `CHECK_AN_NINH_KHAI` của hardening dời sang tệp này.
-- (2) `award_kiem_mot_award_song` (thân từ `068`) thêm nhánh `WITHDRAWN` với BA vế — hàng trước là `PROPOSED`; người ghi là
--     người đề xuất (so `acted_by`, cột dẫn xuất từ phiên qua `kiem_danh_tinh_theo_phien`); đề xuất ấy có 0 chữ ký — mỗi vế
--     một TÊN RÀNG BUỘC (`j7_rut_khong_o_proposed` · `j7_rut_khong_phai_nguoi_de_xuat` · `j7_rut_da_co_chu_ky`, khuôn `074`);
--     và `WITHDRAWN` KHÔNG phải award còn sống: `PROPOSED` mới đi được sau nó (J7 mở lại), `APPROVED`/`CANCELLED` sau nó thì
--     không. Chuỗi của `061` mục (6) nay:
--
--         (chưa có) --PROPOSED--> PROPOSED --APPROVED--> APPROVED --CANCELLED--> CANCELLED --PROPOSED--> …
--                                     |--CANCELLED--> CANCELLED --PROPOSED--> …
--                                     |--WITHDRAWN--> WITHDRAWN --PROPOSED--> …   (0 chữ ký, cùng con người)
--
-- Máy trạng thái của RFQ KHÔNG đổi: rút đi qua đúng cạnh `AWARDED->EVALUATING` mà `061` đã mở cho huỷ (ADR-057: `AWARDED`
-- nghĩa là *đang có một award còn sống*). Cổng huỷ không đổi. Thân TRÍCH NGUYÊN VĂN từ `068` bằng script rồi đổi năm chỗ
-- (một biến, một cột đọc thêm, vế J7 nhận `WITHDRAWN`, nhánh mới, vế huỷ-sau-rút); bản ghim ở `hardening.always.sql` đổi cùng
-- commit (S1.96). Không đổi trigger. Đo: `packages/danh-gia/src/luot-danh-gia.int.test.ts` khối `[khoản 232]` (ba vế, đối
-- chứng dương, đột biến gỡ trigger) và đường sản xuất `rutDeXuatTraoThau`; qua HTTP ở `apps/api/src/buyer.int.test.ts`.
-- =============================================================================================

-- (1) Tập đóng của trạng thái award — BỐN giá trị. Dựng lại nguyên ràng buộc (ADR-028 §2⑵: hardening không tự dựng một
-- CHECK; một migration mới làm, và dòng khai `CHECK_AN_NINH_KHAI` đổi cùng commit).
ALTER TABLE rfq_awards DROP CONSTRAINT rfq_awards_status_check;
ALTER TABLE rfq_awards
  ADD CONSTRAINT rfq_awards_status_check
  CHECK (status IN ('PROPOSED', 'APPROVED', 'CANCELLED', 'WITHDRAWN'));

-- (2) J7 với nhánh `WITHDRAWN`.
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
  truoc_acted_by uuid;
  so_chu_ky integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.rfq_id::pg_catalog.text, 1));

  SELECT a.status, a.id, a.evaluation_id, a.bid_version_id, a.acted_by
    INTO truoc_status, truoc_id, truoc_eval, truoc_bid, truoc_acted_by
    FROM public.rfq_awards a
   WHERE a.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND a.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
   ORDER BY a.acted_at DESC, a.id DESC
   LIMIT 1;

  IF NEW.status OPERATOR(pg_catalog.=) 'PROPOSED' THEN
    -- Đề xuất ĐƯỢC phép khi chưa có hàng nào, hay khi hàng mới nhất đã HUỶ. Đây là vế J7.
    -- [S1.9182 / khoản 232] ...hay đã RÚT: `WITHDRAWN` không phải một award còn sống (ADR-9282).
    IF truoc_status IS NOT NULL
       AND truoc_status OPERATOR(pg_catalog.<>) 'CANCELLED'
       AND truoc_status OPERATOR(pg_catalog.<>) 'WITHDRAWN' THEN
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

  -- [S1.9182 / khoản 232 / 9583 / ADR-9282] `WITHDRAWN` — người đề xuất RÚT đề xuất CHƯA CHỮ KÝ của mình.
  -- Ba vế, và cả ba sống Ở ĐÂY chứ không ở lớp gói: ⑴ hàng mới nhất là `PROPOSED`; ⑵ người rút là người
  -- đề xuất — `acted_by` là cột DẪN XUẤT từ phiên (`013`), nên đây là phép so CON NGƯỜI, không so vai;
  -- ⑶ đề xuất ấy chưa có chữ ký nào — có chữ ký rồi thì chỉ HUỶ (`po.approve`, ADR-057) mới tháo được,
  -- vì rút được sau chữ ký là để người đề xuất tháo một quyết định đã duyệt bằng chính tay mình.
  IF NEW.status OPERATOR(pg_catalog.=) 'WITHDRAWN' THEN
    IF truoc_status IS DISTINCT FROM 'PROPOSED' THEN
      RAISE EXCEPTION 'Chi rut duoc mot de xuat dang o PROPOSED; hang moi nhat dang o % (J7)', truoc_status
        USING ERRCODE = 'check_violation',
              CONSTRAINT = 'j7_rut_khong_o_proposed';
    END IF;
    IF truoc_acted_by IS DISTINCT FROM NEW.acted_by THEN
      RAISE EXCEPTION 'Chi nguoi de xuat moi rut duoc de xuat cua minh (J7)'
        USING ERRCODE = 'check_violation',
              CONSTRAINT = 'j7_rut_khong_phai_nguoi_de_xuat';
    END IF;
    SELECT pg_catalog.count(*)::pg_catalog.int4 INTO so_chu_ky
      FROM public.rfq_award_approvals ap
     WHERE ap.org_id OPERATOR(pg_catalog.=) NEW.org_id
       AND ap.award_id OPERATOR(pg_catalog.=) truoc_id;
    IF so_chu_ky > 0 THEN
      RAISE EXCEPTION 'De xuat da co % chu ky duyet — khong rut duoc, chi huy duoc (J7)', so_chu_ky
        USING ERRCODE = 'check_violation',
              CONSTRAINT = 'j7_rut_da_co_chu_ky';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status OPERATOR(pg_catalog.=) 'APPROVED' THEN
    IF truoc_status IS DISTINCT FROM 'PROPOSED' THEN
      RAISE EXCEPTION 'Chi duyet duoc mot de xuat dang o PROPOSED; hang moi nhat dang o %',
        truoc_status
        USING ERRCODE = 'check_violation';
    END IF;
    -- MỘT chữ ký, đúng §7 — chốt ngày 2026-09-22. [S1.142 / khoản 242 ⑴] Đổi `CHU_KY_CAN` KHÔNG đủ
    -- để có hai chữ ký. `duyetTraoThau` ghi chữ ký và hàng `APPROVED` trong CÙNG một giao dịch, nên
    -- với hằng là 2, lần duyệt đầu bị từ chối ở đây và chữ ký của nó rơi theo giao dịch; người
    -- duyệt thứ hai gặp đúng lỗi ấy — trao thầu không bao giờ duyệt được. Hai chữ ký cần chữ ký
    -- sống ĐỘC LẬP với hàng `APPROVED`: việc của S3.5.
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

  -- `CANCELLED` — huỷ được một đề xuất đang chờ HAY một award đã duyệt. [S1.9182 / khoản 232] Sau một
  -- hàng `WITHDRAWN` cũng không còn gì để huỷ: hàng rút không phải một award còn sống.
  IF truoc_status OPERATOR(pg_catalog.=) 'CANCELLED' OR truoc_status OPERATOR(pg_catalog.=) 'WITHDRAWN' THEN
    RAISE EXCEPTION 'Award cua RFQ % da huy roi hoac da rut (hang moi nhat: %)', NEW.rfq_id, truoc_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

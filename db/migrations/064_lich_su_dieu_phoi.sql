-- =============================================================================================
-- 064 — [khoản 233] LỊCH SỬ ĐIỀU PHỐI MỞ THẦU: J3 THẤY MỌI NGƯỜI TỪNG ĐIỀU PHỐI, KHÔNG CHỈ NGƯỜI CUỐI
-- =============================================================================================
-- `unseal_requests.dispatched_by` mang người của lần điều phối ĐANG CHẠY. `054` cho điều phối lại
-- sau khi một lần thử chết, và `packages/unseal/src/requests.ts` ĐÈ cột ấy. Vế *người điều phối*
-- của J3 (`award_kiem_de_xuat`, `061`) đọc đúng cột ấy, nên kịch bản đi được là:
--   A điều phối → worker chết → B điều phối lại → `dispatched_by = B` → A đề xuất trao thầu ĐI QUA.
-- Một người ôm *mở thầu* cộng *đề xuất award* của cùng một gói — đúng bộ ba J3 cấm, và đúng chuỗi
-- mà `docs/PRODUCT.md` §4 nguyên tắc 1 cấm. Khối phạm vi trong `061` và hàng 233 của sổ nợ ghi nó.
--
-- HÌNH DẠNG CHỌN (chủ dự án chốt 2026-09-26, hình dạng ⒝ của hàng 233): một bảng LỊCH SỬ ĐIỀU PHỐI.
-- *Ai từng điều phối* thành một câu hỏi có cột trả lời. Hai hình dạng bị bác: ⒜ trigger J3 đọc
-- `audit_events` — buộc một trigger đường GHI phụ thuộc sổ kiểm toán, hai tầng cố ý rời nhau; ⒞
-- nhận lỗ — đã chọn ngày 2026-09-22, rồi S1.113 đưa khoản lên rổ A theo vế ⒝ của ADR-043.
--
-- AI GHI: một trigger `AFTER UPDATE` trên `unseal_requests`, ở MỌI lần cặp người-phiên điều phối
-- đổi — lần đầu (`dispatchUnseal`) lẫn điều phối lại (`dieuPhoiLaiSauKhiChet`). Không lớp gói nào
-- phải nhớ ghi; quên thì không có đường nào để quên.
--
-- CHỈ-GHI-THÊM BẰNG QUYỀN, khuôn `062`/`063`: không vai ứng dụng nào có UPDATE hay DELETE. `app_api`
-- có INSERT vì trigger chạy dưới quyền người gọi. Một hàng GIẢ do `app_api` chèn chỉ làm J3 CHẶT
-- hơn — chặn thêm một người đề xuất — không nới được gì: vị từ của J3 là *tồn tại một hàng khớp*.
-- =============================================================================================

CREATE TABLE unseal_dispatch_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES organizations(id),
  unseal_request_id        uuid NOT NULL,
  rfq_id                   uuid NOT NULL,
  dispatched_by            uuid NOT NULL,
  dispatched_by_session_id uuid NOT NULL,
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, unseal_request_id) REFERENCES unseal_requests (org_id, id),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, dispatched_by) REFERENCES users (org_id, id)
);

-- Câu hỏi DUY NHẤT của bảng: *người này đã từng điều phối gói thầu này chưa*.
CREATE INDEX unseal_dispatch_history_rfq_nguoi
  ON unseal_dispatch_history (org_id, rfq_id, dispatched_by);

ALTER TABLE unseal_dispatch_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE unseal_dispatch_history FORCE ROW LEVEL SECURITY;

CREATE POLICY unseal_dispatch_history_tenant_isolation ON unseal_dispatch_history
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: nhà cung cấp không có việc gì
-- với việc ai của bên mua đã điều phối mở thầu.
CREATE POLICY unseal_dispatch_history_khach ON unseal_dispatch_history AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `app_api` ĐỌC (trigger J3 chạy dưới quyền người đề xuất) và GHI THÊM (trigger ghi chạy dưới quyền
-- người điều phối). `recorded_at` do CSDL đặt. `app_unseal` không đụng bảng này.
GRANT SELECT ON unseal_dispatch_history TO app_api;
GRANT INSERT (org_id, unseal_request_id, rfq_id, dispatched_by, dispatched_by_session_id)
  ON unseal_dispatch_history TO app_api;

-- ============================================================================================
-- (1) GHI: mỗi lần cặp người-phiên điều phối đổi, một hàng
-- ============================================================================================
-- `AFTER`, nên hàng chỉ được ghi khi mọi trigger `BEFORE` của `unseal_requests` đã cho qua
-- (`kiem_nguoi_dieu_phoi`, `dieu_phoi_mot_lan`). Không `WHEN` trên trigger: điều kiện nằm trong
-- thân hàm, nơi hardening ghim được nó (khoản 79 — một trigger có `WHEN` không phải một chốt).
-- `app_unseal` cũng `UPDATE` bảng này (`status`, `executed_at`): cặp điều phối không đổi nên thân
-- hàm không chèn gì, và vai ấy không cần quyền nào trên bảng lịch sử.
CREATE OR REPLACE FUNCTION public.unseal_ghi_lich_su_dieu_phoi() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NEW.dispatched_by IS NOT NULL
     AND (OLD.dispatched_by IS DISTINCT FROM NEW.dispatched_by
          OR OLD.dispatched_by_session_id IS DISTINCT FROM NEW.dispatched_by_session_id) THEN
    INSERT INTO public.unseal_dispatch_history
      (org_id, unseal_request_id, rfq_id, dispatched_by, dispatched_by_session_id)
    VALUES (NEW.org_id, NEW.id, NEW.rfq_id, NEW.dispatched_by, NEW.dispatched_by_session_id);
  END IF;
  RETURN NULL;
END
$ham$;

CREATE TRIGGER unseal_requests_ghi_lich_su_dieu_phoi
  AFTER UPDATE ON unseal_requests
  FOR EACH ROW EXECUTE FUNCTION public.unseal_ghi_lich_su_dieu_phoi();
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_ghi_lich_su_dieu_phoi;

-- ============================================================================================
-- (2) BACKFILL: người đang giữ cột, cộng người mà hàng sổ `UNSEAL_REDISPATCHED` còn nhớ
-- ============================================================================================
-- Vai chạy migration có BYPASSRLS (ADR-061), nên hai câu dưới thấy mọi tổ chức. Nguồn thứ hai tồn
-- tại từ S1.103 (khoản 208): hàng sổ điều phối lại mang `previousDispatchedBy` và
-- `previousDispatchedBySessionId`. Một lần điều phối lại TRƯỚC S1.103 không để lại cặp cũ ở đâu cả —
-- người ấy KHÔNG hồi phục được, và đây là giới hạn của backfill chứ không của hình dạng.
INSERT INTO unseal_dispatch_history
  (org_id, unseal_request_id, rfq_id, dispatched_by, dispatched_by_session_id, recorded_at)
SELECT r.org_id, r.id, r.rfq_id, r.dispatched_by, r.dispatched_by_session_id,
       coalesce(r.dispatched_at, now())
  FROM unseal_requests r
 WHERE r.dispatched_by IS NOT NULL
   AND r.dispatched_by_session_id IS NOT NULL;

INSERT INTO unseal_dispatch_history
  (org_id, unseal_request_id, rfq_id, dispatched_by, dispatched_by_session_id, recorded_at)
SELECT a.org_id, r.id, r.rfq_id,
       (a.payload ->> 'previousDispatchedBy')::uuid,
       (a.payload ->> 'previousDispatchedBySessionId')::uuid,
       a.occurred_at
  FROM audit_events a
  JOIN unseal_requests r ON r.org_id = a.org_id AND r.id = a.resource_id
 WHERE a.action = 'UNSEAL_REDISPATCHED'
   AND a.payload ->> 'previousDispatchedBy' IS NOT NULL
   AND a.payload ->> 'previousDispatchedBySessionId' IS NOT NULL;

-- ============================================================================================
-- (3) J3 vế 3 đọc LỊCH SỬ, không đọc cột đang chạy
-- ============================================================================================
-- Thân dưới giống `061` từng chữ, trừ vế 3. Vế 3 cũ đọc `dispatched_by` của yêu cầu MỚI NHẤT;
-- vế mới hỏi *người đề xuất đã từng điều phối BẤT KỲ yêu cầu mở thầu nào của gói này chưa*. Nó
-- phủ cả điều phối lại lẫn một yêu cầu cũ đã điều phối rồi bị thay bằng yêu cầu khác.
-- Khối chú thích *phạm vi* trong `061` nay thiu; `061` đã áp nên không sửa được (khoản 19).
CREATE OR REPLACE FUNCTION public.award_kiem_de_xuat() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  gia numeric;
BEGIN
  -- Chỉ hàng ĐỀ XUẤT đi qua phép kiểm này; hàng `APPROVED`/`CANCELLED` do mục (6) phán xử.
  IF NEW.status IS DISTINCT FROM 'PROPOSED' THEN
    RETURN NEW;
  END IF;

  SELECT p.created_by INTO nguoi_tao
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [J3 vế 2] Người TẠO gói thầu không được là người đề xuất trao thầu cho chính gói ấy.
  IF nguoi_tao OPERATOR(pg_catalog.=) NEW.acted_by THEN
    RAISE EXCEPTION
      'Nguoi tao goi thau khong duoc de xuat trao thau cho chinh goi ay (J3)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [J3 vế 3] ...và người TỪNG ĐIỀU PHỐI mở thầu cũng không — mọi lần, kể cả lần đã bị điều phối
  -- lại đè lên (khoản 233, `064`). Đọc bảng lịch sử, không đọc `unseal_requests.dispatched_by`.
  IF EXISTS (SELECT 1 FROM public.unseal_dispatch_history h
              WHERE h.org_id OPERATOR(pg_catalog.=) NEW.org_id
                AND h.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
                AND h.dispatched_by OPERATOR(pg_catalog.=) NEW.acted_by) THEN
    RAISE EXCEPTION
      'Nguoi dieu phoi mo thau khong duoc de xuat trao thau cho chinh goi ay (J3)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [J5 vế NỘI DUNG] Khoá ngoại hợp thành đã buộc có một HÀNG XẾP HẠNG; nó KHÔNG buộc hàng ấy
  -- đọc được giá. `057` cho một báo giá không đọc được giá vẫn có hàng, với `effective_cost` và
  -- `rank` cùng NULL (§2.3⑺) — và một award dựa trên nó là một quyết định dựa trên số không có.
  SELECT l.effective_cost INTO gia
    FROM public.rfq_evaluation_lines l
   WHERE l.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND l.evaluation_id OPERATOR(pg_catalog.=) NEW.evaluation_id
     AND l.bid_version_id OPERATOR(pg_catalog.=) NEW.bid_version_id;
  IF gia IS NULL THEN
    RAISE EXCEPTION
      'Bao gia duoc chon khong co effective_cost doc duoc o luot cham % (J5)', NEW.evaluation_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- [J5 vế RFQ] Lượt chấm được trỏ tới phải là lượt CỦA CHÍNH GÓI THẦU NÀY. Khoá ngoại hợp thành
  -- buộc `(org_id, evaluation_id, bid_version_id)` tồn tại ở `rfq_evaluation_lines`, và hàng ấy
  -- buộc `evaluation_id` tồn tại ở `rfq_evaluations` — nhưng KHÔNG chuỗi nào buộc lượt chấm ấy
  -- thuộc `NEW.rfq_id`. Cùng ca mà `059` đã gặp cho vòng BAFO.
  IF NOT EXISTS (SELECT 1 FROM public.rfq_evaluations e
                  WHERE e.id OPERATOR(pg_catalog.=) NEW.evaluation_id
                    AND e.org_id OPERATOR(pg_catalog.=) NEW.org_id
                    AND e.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id) THEN
    RAISE EXCEPTION
      'Luot cham % khong thuoc RFQ % (J5)', NEW.evaluation_id, NEW.rfq_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

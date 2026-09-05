-- db/migrations/019_unseal.sql
-- S1.6 — MỞ THẦU: YÊU CẦU, PHÊ DUYỆT KÉP, VÀ CHỖ BẢN RÕ ĐƯỢC PHÉP TỒN TẠI.
-- Đây là chỗ C3, D2 và D4 biến thành câu lệnh, và là chỗ vế thứ ba của D1 có chủ ngữ.
--
-- ============================================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: mỗi bảng mang trọn CREATE TABLE + ENABLE + FORCE + POLICY + GRANT
-- trong CÙNG file này. Cưỡng chế bằng máy ở db/migration-shape.test.ts.
--
-- ============================================================================================
-- A1 ĐƯỢC GIỮ BỞI SỰ VẮNG MẶT CỦA DỮ LIỆU, KHÔNG BỞI MỘT PHÉP KIỂM
-- ============================================================================================
-- Bất biến A1: *"Với RFQ chưa UNSEALED, không endpoint nào trả về trường giá cho bất kỳ actor
-- nội bộ nào."* Cách hiển nhiên để cài nó là một cổng đọc: kiểm trạng thái RFQ trước khi trả giá.
-- Cách ấy đúng và YẾU — nó đòi mọi đường đọc, kể cả đường viết sau này, nhớ gọi phép kiểm.
--
-- Cách ở đây khác: **hàng của `rfq_unsealed_bids` không TỒN TẠI cho tới lúc mở thầu chạy.** Trước
-- thời điểm ấy không có gì để trả về, nên A1 đúng kể cả với một câu `SELECT *` viết bởi người
-- chưa từng đọc tài liệu này. Cùng lập luận `009` dùng khi từ chối cho `rfq_items` một cột giá:
-- không có dữ liệu thì không có gì để rò.
--
-- ============================================================================================
-- MỘT DÒNG GRANT TRÔNG NGUY HIỂM, VÀ VÌ SAO NÓ KHÔNG
-- ============================================================================================
-- File này cấp `UPDATE (status)` trên `rfq_packages` cho **`app_unseal`**. Đọc rời ra, đó là
-- "tiến trình mở thầu sửa được máy trạng thái RFQ" — nghe rất tệ.
--
-- Nó bị chặn trên bởi một lớp đã có răng từ S1.2: bảng cạnh của `rfq_kiem_chuyen_trang_thai`
-- (009/011). Từ `CLOSED` chỉ có ĐÚNG MỘT cạnh đi ra — `CLOSED -> UNSEALED` — và cạnh ấy còn phải
-- qua trigger `rfq_packages_kiem_yeu_cau_mo_thau` bên dưới. `app_unseal` **không** mở được một
-- RFQ (cạnh `PENDING_APPROVAL -> OPEN` đòi vật liệu khoá và đòi chữ ký danh tính), **không** đóng
-- được (`OPEN -> CLOSED` đòi `closed_by` khớp một phiên NGƯỜI MUA mà `app_unseal` không đọc được
-- bảng `sessions` theo cách ấy), và **không** huỷ được.
--
-- Đường thay thế đã cân nhắc và loại: để `api` lật trạng thái sau khi worker báo xong. Nó đưa
-- quyền tuyên bố "đã mở thầu" cho tiến trình KHÔNG làm việc mở thầu, tức tách sự thật khỏi bằng
-- chứng của nó. ADR-006 đặt worker làm nơi duy nhất giải mã; nơi ấy cũng phải là nơi tuyên bố.

-- ============================================================================================
-- (1) YÊU CẦU MỞ THẦU
-- ============================================================================================
CREATE TABLE unseal_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id),
  rfq_id                  uuid NOT NULL,
  status                  text NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'APPROVED', 'EXECUTED', 'CANCELLED')),
  -- [D4] Lý do là BẮT BUỘC cho MỌI yêu cầu, không chỉ cho break-glass. Mệnh đề D4 chỉ đòi lý do
  -- ở đường break-glass, nhưng một cột `NOT NULL` cho cả hai đường rẻ hơn một cột có điều kiện —
  -- và nó gỡ mất câu hỏi "đường nào thì cần lý do" khỏi đầu người viết mã sau này.
  reason                  text NOT NULL CHECK (octet_length(reason) > 0
                                               AND octet_length(reason) <= 2000),
  -- [D4] ĐƯỜNG RIÊNG, không phải một cờ bỏ qua. Xem mục (5): một yêu cầu break-glass KHÔNG cần
  -- phê duyệt, nhưng nó BẮT BUỘC sinh một cảnh báo mức cao NGAY TRONG GIAO DỊCH TẠO NÓ.
  break_glass             boolean NOT NULL DEFAULT false,
  requested_by            uuid NOT NULL,
  requested_by_session_id uuid NOT NULL,
  requested_at            timestamptz NOT NULL DEFAULT now(),
  approved_at             timestamptz,
  executed_at             timestamptz,
  cancelled_at            timestamptz,
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, requested_by) REFERENCES users (org_id, id),
  UNIQUE (org_id, id),
  CONSTRAINT unseal_requests_duyet_thi_co_moc CHECK ((status = 'PENDING') OR (status = 'CANCELLED')
                                                     OR approved_at IS NOT NULL),
  CONSTRAINT unseal_requests_chay_thi_co_moc CHECK ((status <> 'EXECUTED') OR executed_at IS NOT NULL),
  CONSTRAINT unseal_requests_huy_thi_co_moc CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

-- Một RFQ có TỐI ĐA MỘT yêu cầu đang mở. Không có ràng buộc này, hai người cùng yêu cầu mở thầu
-- và mỗi yêu cầu tự gom đủ phê duyệt của mình — tức ngưỡng "hai người khác nhau" của D2 bị chia
-- đôi thay vì bị thoả. `org_id` đứng đầu (ADR-013 / H14).
CREATE UNIQUE INDEX unseal_requests_mot_yeu_cau_dang_mo
  ON unseal_requests (org_id, rfq_id) WHERE status IN ('PENDING', 'APPROVED');

ALTER TABLE unseal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE unseal_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY unseal_requests_tenant_isolation ON unseal_requests
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON unseal_requests TO app_api;
GRANT INSERT (org_id, rfq_id, reason, break_glass, requested_by, requested_by_session_id)
  ON unseal_requests TO app_api;
-- `status` KHÔNG có INSERT: một yêu cầu không được RA ĐỜI đã ở trạng thái APPROVED.
GRANT UPDATE (status, approved_at, cancelled_at) ON unseal_requests TO app_api;
-- `app_unseal` đọc để biết mình được phép làm gì, và ghi ĐÚNG hai cột của lần chạy.
GRANT SELECT ON unseal_requests TO app_unseal;
GRANT UPDATE (status, executed_at) ON unseal_requests TO app_unseal;

-- [ADR-016] Danh tính người yêu cầu là DẪN XUẤT của phiên.
CREATE TRIGGER unseal_requests_kiem_danh_tinh
  BEFORE INSERT ON unseal_requests
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'requested_by', 'requested_by_session_id');

-- ------------------------------------------------------------------------------------------
-- [C3] MỞ THẦU CHỈ HỢP LỆ KHI RFQ ĐÃ CLOSED — và phép kiểm nằm ở chỗ SỚM NHẤT nó có nghĩa.
--
-- Đặt ở lúc TẠO YÊU CẦU chứ không chỉ ở lúc chạy: một yêu cầu mở thầu cho một RFQ còn đang nhận
-- báo giá là một yêu cầu không được phép TỒN TẠI, không phải một yêu cầu sẽ bị từ chối về sau.
-- Khác biệt đo được: nó không gom được phê duyệt nào trong lúc chờ.
-- ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unseal_kiem_rfq_da_dong() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF trang_thai IS DISTINCT FROM 'CLOSED' THEN
    RAISE EXCEPTION 'Chi yeu cau mo thau duoc khi RFQ da CLOSED; dang o % (C3)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER unseal_requests_kiem_rfq_da_dong
  BEFORE INSERT ON unseal_requests
  FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_rfq_da_dong();

-- ============================================================================================
-- (2) PHÊ DUYỆT — [D2] HAI NGƯỜI KHÁC NHAU, HAI PHIÊN KHÁC NHAU, KHÔNG PHẢI NGƯỜI YÊU CẦU
-- ============================================================================================
-- *** MỘT CÂU CỦA KẾ HOẠCH S1 §3 NAY SAI, VÀ NÓ SAI THEO HƯỚNG TỐT. ***
--
-- Nguyên văn: *"Ràng buộc DB chặn được 'hai người khác nhau' (UNIQUE + CHECK). Nó KHÔNG chặn
-- được 'hai phiên khác nhau' — đó là thuộc tính của phiên, không của hàng. Vế đó phải cưỡng chế
-- ở cổng chính sách và phải được ghi vào §4 như một phần chênh."*
--
-- Vế ấy nay cưỡng chế được Ở TẦNG CSDL, và thứ làm nó thành khả thi ra đời SAU khi câu trên được
-- viết: ADR-016 buộc mọi danh tính là DẪN XUẤT của một phiên, nên `approver_session_id` là một
-- CỘT có thật và một trigger đòi nó khớp chủ phiên. Có cột thì có `UNIQUE` — và "hai phiên khác
-- nhau" trở thành một ràng buộc trên HÀNG, đúng thứ câu trên nói là không thể.
--
-- Phần chênh dự kiến ở §4 vì vậy KHÔNG ra đời. Ghi lại ở đây thay vì lặng lẽ hưởng: một dự đoán
-- sai về giới hạn của tầng CSDL cũng đáng ghi như một dự đoán sai về hành vi.
CREATE TABLE unseal_approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  unseal_request_id   uuid NOT NULL,
  approver_user_id    uuid NOT NULL,
  approver_session_id uuid NOT NULL,
  approved_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, unseal_request_id) REFERENCES unseal_requests (org_id, id),
  FOREIGN KEY (org_id, approver_user_id) REFERENCES users (org_id, id),
  -- Một người phê duyệt MỘT LẦN cho mỗi yêu cầu.
  UNIQUE (org_id, unseal_request_id, approver_user_id),
  -- ... và một PHIÊN cũng chỉ phê duyệt một lần. Hai dòng này KHÔNG thừa nhau: dòng trên chặn
  -- "một người, hai phiên"; dòng dưới chặn một ca mà dòng trên không thấy — hai hàng khai hai
  -- `approver_user_id` khác nhau nhưng cùng một `approver_session_id`. Trigger danh tính bên
  -- dưới cũng chặn ca ấy, nên đây là lớp thứ hai; và nó là lớp còn đứng khi trigger bị gỡ.
  UNIQUE (org_id, unseal_request_id, approver_session_id)
);

ALTER TABLE unseal_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE unseal_approvals FORCE ROW LEVEL SECURITY;

CREATE POLICY unseal_approvals_tenant_isolation ON unseal_approvals
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON unseal_approvals TO app_api;
GRANT INSERT (org_id, unseal_request_id, approver_user_id, approver_session_id)
  ON unseal_approvals TO app_api;
-- KHÔNG UPDATE, KHÔNG DELETE cho bất kỳ role nào: một phê duyệt đã ký thì không rút lại bằng
-- cách xoá dòng. Muốn dừng thì HUỶ yêu cầu — một hành vi có tên, có mốc thời gian.
GRANT SELECT ON unseal_approvals TO app_unseal;

-- [ADR-016] Danh tính người phê duyệt là DẪN XUẤT của phiên.
CREATE TRIGGER unseal_approvals_kiem_danh_tinh
  BEFORE INSERT ON unseal_approvals
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'approver_user_id', 'approver_session_id');

-- ------------------------------------------------------------------------------------------
-- [D2, vế cuối] NGƯỜI YÊU CẦU KHÔNG ĐƯỢC LÀ MỘT TRONG HAI NGƯỜI DUYỆT.
--
-- Không viết được thành `CHECK` ở mức bảng: nó so một cột của `unseal_approvals` với một cột của
-- `unseal_requests`. Cùng hình dạng với `rfq_kiem_nguoi_duyet` (009 §5).
-- ------------------------------------------------------------------------------------------
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
      USING ERRCODE = 'foreign_key_violation';
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

CREATE TRIGGER unseal_approvals_kiem_nguoi_duyet
  BEFORE INSERT ON unseal_approvals
  FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_nguoi_duyet();

-- ============================================================================================
-- (3) SỐ PHÊ DUYỆT CẦN THIẾT — MỘT HÀM, HAI NGƯỜI ĐỌC
-- ============================================================================================
-- Cùng khuôn `rfq_can_phe_duyet_kep` (014): một phép so, một chỗ ở, hai người tiêu thụ (trigger
-- chuyển trạng thái ở đây, và cổng chính sách ở `packages/unseal`).
--
-- Ngưỡng đọc THẲNG từ `rfq_packages.requires_dual_approval` — kết luận mà ADR-017 đã dựng cả một
-- chính sách có phiên bản để rút ra. Không tính lại ở đây: hai phép tính cho một câu hỏi là hai
-- câu trả lời chờ lệch nhau.
--
-- Vì sao SÀN LÀ 1 chứ không phải 0 cho RFQ dưới ngưỡng: D3 đòi chuỗi tạo → chọn NCC → mở thầu →
-- award → duyệt không nằm trọn trong tay một người. Cho phép mở thầu không cần ai duyệt là mở
-- đúng một mắt xích ấy ra.
CREATE OR REPLACE FUNCTION public.unseal_so_phe_duyet_can(p_rfq uuid) RETURNS integer
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT CASE WHEN p.requires_dual_approval THEN 2 ELSE 1 END
    FROM public.rfq_packages p WHERE p.id = p_rfq
$ham$;

-- ------------------------------------------------------------------------------------------
-- CHUYỂN `PENDING -> APPROVED` PHẢI CÓ ĐỦ PHÊ DUYỆT — và break-glass đi ĐƯỜNG KHÁC.
-- ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unseal_kiem_du_phe_duyet() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  can integer;
  co integer;
BEGIN
  -- [D4] Break-glass KHÔNG gom phê duyệt — đó là lý do nó tồn tại. Cái giá của nó nằm ở mục (5):
  -- một cảnh báo mức cao, sinh trong CÙNG giao dịch, không có đường nào tắt.
  IF NEW.break_glass THEN
    RETURN NEW;
  END IF;

  can := public.unseal_so_phe_duyet_can(NEW.rfq_id);
  SELECT count(*) INTO co
    FROM public.unseal_approvals a
   WHERE a.unseal_request_id OPERATOR(pg_catalog.=) NEW.id
     AND a.org_id OPERATOR(pg_catalog.=) NEW.org_id;

  IF co OPERATOR(pg_catalog.<) can THEN
    RAISE EXCEPTION 'Yeu cau mo thau nay can % phe duyet, moi co % (D2)', can, co
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER unseal_requests_kiem_du_phe_duyet
  BEFORE UPDATE ON unseal_requests
  FOR EACH ROW
  WHEN (NEW.status OPERATOR(pg_catalog.=) 'APPROVED' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.unseal_kiem_du_phe_duyet();

-- ------------------------------------------------------------------------------------------
-- CẠNH HỢP LỆ CỦA YÊU CẦU MỞ THẦU. Cùng khuôn bảng cạnh của `rfq_kiem_chuyen_trang_thai` (009):
-- mặc định ĐÓNG, và cạnh quan trọng nhất là cạnh KHÔNG có mặt — `EXECUTED -> *`.
-- ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unseal_kiem_chuyen_trang_thai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  CANH_HOP_LE constant text[] := ARRAY[
    'PENDING->APPROVED',
    'PENDING->CANCELLED',
    'APPROVED->EXECUTED',
    'APPROVED->CANCELLED'
  ];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status OPERATOR(pg_catalog.||) '->' OPERATOR(pg_catalog.||) NEW.status)
            OPERATOR(pg_catalog.=) ANY (CANH_HOP_LE)) THEN
      RAISE EXCEPTION 'Chuyen trang thai yeu cau mo thau khong hop le: % -> %',
        OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Không cột nào của phần YÊU CẦU được sửa sau khi đã tạo. Một lý do sửa được sau khi phê duyệt
  -- là một lý do người duyệt chưa từng đọc.
  IF NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.break_glass IS DISTINCT FROM OLD.break_glass
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_by_session_id IS DISTINCT FROM OLD.requested_by_session_id THEN
    RAISE EXCEPTION 'Chi sua duoc trang thai va cac moc thoi gian cua yeu cau mo thau'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER unseal_requests_kiem_chuyen_trang_thai
  BEFORE UPDATE ON unseal_requests
  FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_chuyen_trang_thai();

-- ============================================================================================
-- (4) CẠNH `CLOSED -> UNSEALED` CỦA RFQ ĐÒI MỘT YÊU CẦU ĐÃ ĐƯỢC PHÊ DUYỆT
-- ============================================================================================
-- Đây là vế thứ ba của D1 (*"RFQ đã CLOSED"*) cộng D2, đặt ở tầng CSDL. Cổng chính sách ở
-- `packages/unseal` nói CÙNG điều này — nhưng cổng canh đường đi qua nó, còn trigger canh mọi
-- đường, kể cả một câu `UPDATE` viết tay trong một script vận hành.
CREATE OR REPLACE FUNCTION public.rfq_kiem_yeu_cau_mo_thau() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  so integer;
BEGIN
  SELECT count(*) INTO so
    FROM public.unseal_requests r
   WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND r.status IN ('APPROVED', 'EXECUTED');
  IF so OPERATOR(pg_catalog.=) 0 THEN
    RAISE EXCEPTION 'Khong mo thau duoc khi chua co yeu cau mo thau da duoc phe duyet (C3, D2)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_yeu_cau_mo_thau
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (NEW.status OPERATOR(pg_catalog.=) 'UNSEALED' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.rfq_kiem_yeu_cau_mo_thau();

GRANT UPDATE (status) ON rfq_packages TO app_unseal;

-- Worker phải tìm được các luồng báo giá của một RFQ, và đường duy nhất đi từ `vendor_bids` tới
-- `rfq_packages` là qua `rfq_invitations`. BA cột, không hơn: `supplier_id`, `contact_id`,
-- `link_channel` và `status` KHÔNG được cấp — worker không có việc gì với danh tính nhà cung cấp,
-- và một GRANT "cho đủ" ở đây là thứ không ai gỡ ra nữa (cùng lý do đã ghi ở 002 cho `users`).
GRANT SELECT (id, org_id, rfq_id) ON rfq_invitations TO app_unseal;

-- ============================================================================================
-- (5) [D4] BREAK-GLASS ĐI ĐƯỜNG RIÊNG, VÀ NÓ KHÔNG BAO GIỜ IM LẶNG
-- ============================================================================================
-- Mệnh đề D4: *"Break-glass đi đường riêng, bắt buộc lý do, sinh cảnh báo mức cao TỨC THÌ, không
-- bao giờ im lặng."* Ba vế đầu là lược đồ; vế **tức thì** là vế đã giữ D4 ở trạng thái chưa phủ
-- suốt từ S0, và lý do được ghi nguyên văn khi ấy:
--
--   *"D4 đòi cảnh báo TỨC THÌ, còn outbox là POLL và độ trễ của nó bị chặn dưới bởi
--    `pollIntervalMs`; đường đúng là `NOTIFY`/`LISTEN` hoặc một đường đồng bộ."*
--
-- ADR-010 đã chốt hình dạng: **outbox bền + `NOTIFY` đánh thức**. Trigger dưới đây làm CẢ HAI
-- trong CÙNG một giao dịch với lần ghi yêu cầu:
--
--   * `INSERT INTO outbox_jobs` — độ BỀN. Cảnh báo sống sót qua một lần sập tiến trình.
--   * `pg_notify` — độ TỨC THÌ. Nó được gửi khi giao dịch COMMIT, nên một yêu cầu bị cuộn lại
--     không sinh cảnh báo ma; và nó không đợi vòng poll nào.
--
-- HAI THỨ NÀY KHÔNG THAY NHAU ĐƯỢC, và đó là điểm của ADR-010: `NOTIFY` không bền (người nghe
-- đang offline thì mất tín hiệu), outbox không tức thì. Bỏ một trong hai là bỏ một vế của D4.
--
-- KHÔNG có giá, không có mã OTP, không có khoá trong payload — cùng lệnh cấm đã ghi ở 004.
CREATE OR REPLACE FUNCTION public.unseal_canh_bao_break_glass() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  INSERT INTO public.outbox_jobs (org_id, kind, payload, dedupe_key)
  VALUES (
    NEW.org_id,
    'BREAK_GLASS_UNSEAL_ALERT',
    pg_catalog.jsonb_build_object(
      'unsealRequestId', NEW.id,
      'rfqId', NEW.rfq_id,
      'requestedBy', NEW.requested_by,
      'severity', 'HIGH'),
    'break-glass:' OPERATOR(pg_catalog.||) NEW.id::pg_catalog.text);

  PERFORM pg_catalog.pg_notify(
    'trustprocure_break_glass',
    pg_catalog.jsonb_build_object('orgId', NEW.org_id, 'unsealRequestId', NEW.id)::pg_catalog.text);

  RETURN NULL;
END
$ham$;

CREATE TRIGGER unseal_requests_canh_bao_break_glass
  AFTER INSERT ON unseal_requests
  FOR EACH ROW
  WHEN (NEW.break_glass)
  EXECUTE FUNCTION public.unseal_canh_bao_break_glass();

-- ============================================================================================
-- (6) BẢN RÕ — CHỖ DUY NHẤT NÓ ĐƯỢC PHÉP TỒN TẠI, VÀ CHỈ SAU KHI MỞ THẦU
-- ============================================================================================
-- `app_unseal` GHI, `app_api` ĐỌC — bất đối xứng NGƯỢC CHIỀU với `vendor_bid_versions.envelope`
-- và `rfq_key_material.wrapped_private_key`, và đó là toàn bộ hình dạng của ADR-006 trong một
-- bảng: nơi duy nhất giải mã được là nơi duy nhất ghi được bản rõ, và nó KHÔNG đọc lại được.
CREATE TABLE rfq_unsealed_bids (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id),
  unseal_request_id uuid NOT NULL,
  bid_version_id    uuid NOT NULL,
  -- Nội dung báo giá đã mở. `jsonb` chứ không phải các cột số: hình dạng một báo giá là việc của
  -- sản phẩm và nó sẽ đổi; một cột `unit_price numeric` ở đây sẽ là một lời hứa về lược đồ mà
  -- S1 chưa có quyền hứa.
  payload           jsonb NOT NULL,
  unsealed_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, unseal_request_id) REFERENCES unseal_requests (org_id, id),
  FOREIGN KEY (org_id, bid_version_id) REFERENCES vendor_bid_versions (org_id, id),
  -- Một phiên bản báo giá được mở ĐÚNG MỘT LẦN. Hai bản rõ cho một phong bì là hai câu trả lời.
  UNIQUE (org_id, bid_version_id)
);

ALTER TABLE rfq_unsealed_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_unsealed_bids FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_unsealed_bids_tenant_isolation ON rfq_unsealed_bids
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON rfq_unsealed_bids TO app_api;
-- `app_api` KHÔNG có INSERT: nó không giải mã được gì, nên nó không có gì để ghi vào đây. Một
-- GRANT INSERT ở đây sẽ cho phép `api` BỊA một bản rõ — và không lớp nào phân biệt được bản rõ
-- bịa với bản rõ thật, vì cả hai chỉ là jsonb.
GRANT INSERT (org_id, unseal_request_id, bid_version_id, payload)
  ON rfq_unsealed_bids TO app_unseal;
GRANT SELECT ON rfq_unsealed_bids TO app_unseal;

-- Chỉ ghi thêm, chặn cả superuser — cùng hàm đã dùng cho hai bảng báo giá ở 018.
CREATE TRIGGER rfq_unsealed_bids_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_unsealed_bids
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();

-- ------------------------------------------------------------------------------------------
-- BẢN RÕ CHỈ RA ĐỜI DƯỚI MỘT YÊU CẦU ĐÃ ĐƯỢC PHÊ DUYỆT.
--
-- Đây là lớp cuối cùng của A1: kể cả khi `app_unseal` bị chiếm, nó không dựng được một hàng bản
-- rõ mà không có một yêu cầu mở thầu đã qua phê duyệt đứng sau — và yêu cầu ấy thì đòi RFQ đã
-- CLOSED, đòi người yêu cầu khác người duyệt, đòi hai phiên khác nhau.
-- ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unseal_kiem_yeu_cau_khi_ghi_ban_ro() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT r.status INTO trang_thai
    FROM public.unseal_requests r
   WHERE r.id OPERATOR(pg_catalog.=) NEW.unseal_request_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay yeu cau mo thau %', NEW.unseal_request_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF trang_thai NOT IN ('APPROVED', 'EXECUTED') THEN
    RAISE EXCEPTION 'Chi ghi duoc ban ro duoi mot yeu cau da phe duyet; yeu cau dang o % (A1)',
      trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_unsealed_bids_kiem_yeu_cau
  BEFORE INSERT ON rfq_unsealed_bids
  FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_yeu_cau_khi_ghi_ban_ro();

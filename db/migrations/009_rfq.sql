-- db/migrations/009_rfq.sql
-- RFQ, hạng mục, phê duyệt, và MÁY TRẠNG THÁI (S1.2). Đây là chỗ ADR-014 được biến thành câu lệnh.
--
-- ============================================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: mọi bảng mang trọn CREATE TABLE + ENABLE + FORCE + POLICY + GRANT
-- trong CÙNG file này. Cưỡng chế bằng máy ở db/migration-shape.test.ts.
--
-- ============================================================================================
-- CÂU CHỊU LỰC NHẤT CỦA FILE NÀY LÀ MỘT CÂU VỀ THỨ KHÔNG CÓ Ở ĐÂY
-- ============================================================================================
-- `rfq_items` KHÔNG CÓ MỘT CỘT GIÁ NÀO. Không `estimated_price`, không `budget`, không
-- `unit_price`. Bất biến **A3** đòi "truy vấn SQL trực tiếp vào bảng bid, kể cả bằng role quản
-- trị, chỉ cho ra ciphertext", và **A4** đòi "không trường phái sinh nào rò rỉ giá trước mở thầu".
-- Một cột giá ở phía NGƯỜI MUA không vi phạm hai mệnh đề đó theo nghĩa đen — nhưng nó tạo ra một
-- chỗ để đặt câu hỏi "sao không lưu luôn giá tham chiếu ở đây", và câu trả lời "vì nó khác giá
-- thầu" là một phân biệt phải nhớ mỗi lần. Bảng không có cột thì không có gì để nhớ.
--
-- Hệ quả trực tiếp: NGƯỠNG của D2 ("RFQ vượt ngưỡng cần 2 phê duyệt") KHÔNG được lưu dưới dạng
-- một số tiền. Nó được lưu dưới dạng `requires_dual_approval boolean` — một KẾT LUẬN mà ứng dụng
-- rút ra từ chính sách của tổ chức, không phải một GIÁ TRỊ mà CSDL phải hiểu. Xem ADR-014 mục 5.

-- ============================================================================================
-- (1) RFQ PACKAGE
-- ============================================================================================
CREATE TABLE rfq_packages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  title                 text NOT NULL CHECK (octet_length(title) > 0
                                             AND octet_length(title) <= 500),
  -- Tập đóng, ép ở tầng CSDL. Chuyển GIỮA các giá trị này bị trigger `rfq_kiem_chuyen_trang_thai`
  -- kiểm theo bảng cạnh — `CHECK` chỉ nói "giá trị hợp lệ", KHÔNG nói "đi tới đây được".
  status                text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'CLOSED',
                                          'UNSEALED', 'EVALUATING', 'CANCELLED')),
  -- Hạn nộp. NULL ở DRAFT (chưa quyết), BẮT BUỘC từ PENDING_APPROVAL trở đi — ép bằng CHECK dưới.
  deadline_at           timestamptz,
  -- Kết luận của ứng dụng về ngưỡng chính sách, KHÔNG phải một số tiền. Xem khối đầu file.
  -- Mặc định `true` là mặc định ĐÓNG: quên đặt thì RFQ cần hai phê duyệt, không phải không cần.
  requires_dual_approval boolean NOT NULL DEFAULT true,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  opened_at             timestamptz,
  closed_at             timestamptz,
  cancelled_at          timestamptz,
  -- Khoá ngoại HỢP THÀNH, khuôn 006 §(1): cặp (org_id, created_by) chặn cả oracle lẫn ca "người
  -- tạo thuộc tổ chức khác" mà RLS `WITH CHECK` không nhìn thấy. Xem 008 để biết ca đó đã được
  -- ĐO là đi lọt với khoá ngoại đơn cột.
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  -- Tiền đề cho khoá ngoại hợp thành của `rfq_items` và `rfq_approvals`.
  UNIQUE (org_id, id),
  -- Bốn ràng buộc dưới đây là bất biến TRÊN DỮ LIỆU: chúng đúng bất kể đường ghi nào.
  CONSTRAINT rfq_deadline_bat_buoc_sau_draft
    CHECK (status = 'DRAFT' OR status = 'CANCELLED' OR deadline_at IS NOT NULL),
  CONSTRAINT rfq_da_mo_thi_co_moc_mo
    CHECK (status NOT IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING') OR opened_at IS NOT NULL),
  CONSTRAINT rfq_da_dong_thi_co_moc_dong
    CHECK (status NOT IN ('CLOSED', 'UNSEALED', 'EVALUATING') OR closed_at IS NOT NULL),
  CONSTRAINT rfq_huy_thi_co_moc_huy
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

ALTER TABLE rfq_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_packages FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_packages_tenant_isolation ON rfq_packages
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON rfq_packages TO app_api;
-- INSERT theo CỘT. `status` KHÔNG có INSERT: một RFQ không được RA ĐỜI đã ở trạng thái OPEN —
-- DEFAULT 'DRAFT' là đường duy nhất, và mọi chuyển trạng thái sau đó đi qua trigger. Ba cột mốc
-- thời gian cũng không có INSERT vì cùng lý do (khuôn `outbox_jobs` ở 007).
GRANT INSERT (org_id, title, deadline_at, requires_dual_approval, created_by)
  ON rfq_packages TO app_api;
-- UPDATE: `org_id`, `created_by`, `created_at` vắng mặt là load-bearing. `title` chỉ sửa được ở
-- DRAFT — nhưng ĐIỀU ĐÓ KHÔNG PHẢI QUYỀN CỘT NÓI ĐƯỢC; trigger nói. Ghi ra để không ai đọc dòng
-- GRANT này thành "sửa tiêu đề lúc nào cũng được".
GRANT UPDATE (title, status, deadline_at, requires_dual_approval,
              opened_at, closed_at, cancelled_at)
  ON rfq_packages TO app_api;
-- app_unseal: CHỈ ba cột, và chỉ SELECT. Đây là những gì cổng chính sách của S1.6 cần để trả lời
-- "RFQ này đã CLOSED chưa" (C3, D1 vế 3) — không hơn. Tiêu đề là dữ liệu nghiệp vụ, runtime mở
-- thầu không có việc gì với nó.
GRANT SELECT (id, org_id, status) ON rfq_packages TO app_unseal;

-- ============================================================================================
-- (2) HẠNG MỤC
-- ============================================================================================
CREATE TABLE rfq_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  rfq_id       uuid NOT NULL,
  line_no      integer NOT NULL CHECK (line_no > 0),
  description  text NOT NULL CHECK (octet_length(description) > 0
                                    AND octet_length(description) <= 2000),
  quantity     numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit         text NOT NULL CHECK (octet_length(unit) > 0 AND octet_length(unit) <= 50),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  UNIQUE (org_id, rfq_id, line_no)
);

ALTER TABLE rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_items FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_items_tenant_isolation ON rfq_items
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON rfq_items TO app_api;
GRANT INSERT (org_id, rfq_id, line_no, description, quantity, unit) ON rfq_items TO app_api;
GRANT UPDATE (line_no, description, quantity, unit) ON rfq_items TO app_api;
-- DELETE ở MỨC BẢNG: sửa danh sách hạng mục lúc còn DRAFT là việc bình thường, và nó chỉ biểu
-- diễn được bằng DELETE. Trigger `rfq_items_chi_sua_khi_soan` bên dưới mới là thứ giới hạn NÓ
-- theo trạng thái của RFQ cha.
GRANT DELETE ON rfq_items TO app_api;
-- Cố ý KHÔNG cấp gì cho app_unseal: bảng so sánh sau mở thầu (S1.7) dựng ở tầng `api`, và cổng
-- chính sách không cần biết RFQ có bao nhiêu dòng.

-- ============================================================================================
-- (3) PHÊ DUYỆT RFQ — VÀ MỘT CÂU CỦA KẾ HOẠCH S1 §3 NAY KHÔNG CÒN ĐÚNG
-- ============================================================================================
-- Kế hoạch S1 §3 viết, về D2: *"Ràng buộc DB chặn được 'hai người khác nhau' (UNIQUE + CHECK).
-- Nó KHÔNG chặn được 'hai phiên khác nhau' — đó là thuộc tính của phiên, không của hàng."*
--
-- VẾ SAU ĐÚNG VỚI HÌNH DẠNG BẢNG MÀ CÂU ẤY GIẢ ĐỊNH, và không còn đúng với bảng này: khi hàng
-- phê duyệt MANG `session_id`, "hai phiên khác nhau" TRỞ THÀNH thuộc tính của hàng, và
-- `UNIQUE (org_id, rfq_id, session_id)` cưỡng chế được nó ở tầng CSDL. Không phải một mẹo — chỉ
-- là ghi lại thứ vốn phải ghi để kiểm toán được.
--
-- PHẦN NÓ VẪN KHÔNG MUA ĐƯỢC, nói thẳng: "hai phiên khác nhau" KHÔNG bằng "hai con người khác
-- nhau ở hai thời điểm khác nhau". Một người mở hai phiên là chuyện bình thường. Thứ chặn ca đó
-- là `UNIQUE (org_id, rfq_id, approver_user_id)` cộng trigger cấm người tạo tự duyệt — ba lớp
-- cùng nhau, không lớp nào một mình đủ.
-- `sessions` (006) chưa có ràng buộc duy nhất trên cặp (org_id, id) — 006 chỉ thêm nó cho
-- `users`. Khoá ngoại hợp thành bên dưới đòi một ràng buộc khớp đúng bộ cột được tham chiếu, nên
-- nó được thêm ở đây. Cùng khuôn 006 §(1) đã làm với `users` (một bảng do 002 tạo): tập hàng vi
-- phạm (org_id, id) là TẬP CON của tập vi phạm sessions_pkey, nên không có hàng mới nào bị từ
-- chối và không có oracle mới. Đây KHÔNG phải sửa RLS hay policy của bảng file khác — thứ mà
-- db/migration-shape.test.ts cấm.
ALTER TABLE sessions ADD CONSTRAINT sessions_org_id_id_key UNIQUE (org_id, id);

CREATE TABLE rfq_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id),
  rfq_id            uuid NOT NULL,
  approver_user_id  uuid NOT NULL,
  -- NOT NULL là load-bearing: `UNIQUE` với cột NULL không chặn gì (NULL <> NULL), nên một
  -- `session_id` nullable sẽ biến ràng buộc dưới thành trang trí. Đây đúng ngữ nghĩa NULL đã
  -- được ĐO ở 008 với `tax_code` — ở đó nó là hành vi mong muốn, ở đây nó sẽ là một lỗ.
  session_id        uuid NOT NULL,
  approved_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, approver_user_id) REFERENCES users (org_id, id),
  FOREIGN KEY (org_id, session_id) REFERENCES sessions (org_id, id),
  CONSTRAINT rfq_approvals_mot_nguoi_mot_lan UNIQUE (org_id, rfq_id, approver_user_id),
  CONSTRAINT rfq_approvals_mot_phien_mot_lan UNIQUE (org_id, rfq_id, session_id)
);

ALTER TABLE rfq_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_approvals FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_approvals_tenant_isolation ON rfq_approvals
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON rfq_approvals TO app_api;
GRANT INSERT (org_id, rfq_id, approver_user_id, session_id) ON rfq_approvals TO app_api;
-- Cố ý KHÔNG cấp UPDATE hay DELETE cho bất kỳ role nào: một chữ ký phê duyệt sửa được hay rút
-- lại được trong im lặng thì nó không phải chữ ký. Đây là cùng nguyên tắc với `audit_events`,
-- áp ở quy mô nhỏ hơn — và KHÁC với nó ở một điểm phải nói rõ: bảng này KHÔNG có trigger
-- chỉ-ghi-thêm, nên chủ sở hữu bảng vẫn sửa được. Nó chống ỨNG DỤNG, không chống DEPLOY.

-- ============================================================================================
-- (4) MÁY TRẠNG THÁI — TRIGGER, VÀ VÌ SAO NÓ Ở ĐÂY CHỨ KHÔNG Ở TYPESCRIPT
-- ============================================================================================
-- Tiêu chí của ADR-014: *cái gì hỏng IM LẶNG thì xuống CSDL; cái gì hỏng ỒN ÀO thì ở ứng dụng.*
-- Một cạnh cấm đi lọt là một thay đổi IM LẶNG trên dữ liệu: RFQ quay `CLOSED -> OPEN` thì phong
-- bì đã nộp vẫn nằm đó, không có gì đỏ, và dấu vết duy nhất là sổ kiểm toán NẾU có ai đọc.
--
-- `app_api` có `GRANT UPDATE (status)` ở trên — nó buộc phải có, để làm việc của nó. Kể từ giây
-- đó, `UPDATE rfq_packages SET status='OPEN' WHERE status='CLOSED'` là MỘT DÒNG SQL, không phải
-- một cuộc tấn công. Trigger là thứ duy nhất đứng giữa.
--
-- GIỚI HẠN, ghi ra thay vì để người đọc sau tự phát hiện: trigger chặn LỖI LẬP TRÌNH, không chặn
-- KẺ ĐÃ Ở TRONG TIẾN TRÌNH — một `api` bị chiếm đi được mọi cạnh mà trigger cho phép. Bí mật giá
-- không dựa vào lớp này; nó dựa vào ADR-006 và phong bì niêm phong.
--
-- KHOẢN NỢ 3 NỞ RA MỘT MỤC: `assertTenantBound` ghim hàm plpgsql theo DANH SÁCH TÊN, nên hàm
-- dưới đây nằm NGOÀI danh sách và không được ghim. ADR-014 đã ghi trước điều này.
CREATE OR REPLACE FUNCTION public.rfq_kiem_chuyen_trang_thai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  -- BẢNG CẠNH HỢP LỆ, chép từ docs/ARCHITECTURE.md §6. Mọi cặp KHÔNG có ở đây đều bị từ chối —
  -- mặc định ĐÓNG. Cạnh quan trọng nhất là cạnh KHÔNG có mặt: 'CLOSED->OPEN'.
  CANH_HOP_LE constant text[] := ARRAY[
    'DRAFT->PENDING_APPROVAL',
    'PENDING_APPROVAL->OPEN',
    'OPEN->CLOSED',
    'CLOSED->UNSEALED',
    'UNSEALED->EVALUATING',
    'DRAFT->CANCELLED',
    'PENDING_APPROVAL->CANCELLED',
    'OPEN->CANCELLED'
  ];
  so_hang_muc integer;
  so_phe_duyet integer;
BEGIN
  -- (a) CẠNH. `IS DISTINCT FROM` chứ không `<>`: hai cột NOT NULL nên chúng bằng nhau về hành vi,
  --     nhưng cách viết này không phụ thuộc vào tính NOT NULL của một cột ở file khác.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status || '->' || NEW.status) = ANY (CANH_HOP_LE)) THEN
      RAISE EXCEPTION 'Chuyen trang thai RFQ khong hop le: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (b) DEADLINE KHÔNG BAO GIỜ LÙI. Đây là C4 ở dạng MẠNH HƠN mệnh đề: sổ đăng ký chỉ cấm rút
  --     ngắn *sau khi đã có báo giá*, còn ở đây cấm rút ngắn LUÔN. Chọn dạng mạnh hơn vì hai lý
  --     do đo được: (i) bảng báo giá (`vendor_bid_versions`) chưa tồn tại ở S1.2 nên vế "đã có
  --     báo giá" chưa có gì để đếm — một trigger tham chiếu bảng chưa có là một migration gãy;
  --     (ii) "đóng sớm" là một CẠNH riêng (`OPEN->CLOSED`) có lý do và có audit, nên rút ngắn
  --     deadline không phải đường đi hợp lệ cho nhu cầu đó ở BẤT KỲ trạng thái nào.
  --     Nói cho đúng mức: dạng mạnh hơn THOẢ C4, nó KHÔNG BẰNG C4 — vế "có thông báo toàn bộ nhà
  --     cung cấp đã mời" cần lời mời (S1.3) và KHÔNG có ở đây.
  IF NEW.deadline_at IS NOT NULL AND OLD.deadline_at IS NOT NULL
     AND NEW.deadline_at < OLD.deadline_at THEN
    RAISE EXCEPTION 'Khong duoc rut ngan deadline cua RFQ (C4)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (c) GIA HẠN CHỈ KHI ĐANG OPEN (C4 vế 2). Đổi deadline ở DRAFT/PENDING_APPROVAL là soạn thảo,
  --     không phải gia hạn — nên hai trạng thái đó được phép. Từ CLOSED trở đi thì không.
  IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
     AND OLD.status NOT IN ('DRAFT', 'PENDING_APPROVAL', 'OPEN') THEN
    RAISE EXCEPTION 'Chi doi duoc deadline khi RFQ dang DRAFT, PENDING_APPROVAL hoac OPEN (C4)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (d) TIÊU ĐỀ VÀ NGƯỠNG CHỈ SỬA ĐƯỢC KHI CÒN SOẠN. Sau khi RFQ đã đi ra ngoài, đổi tiêu đề là
  --     đổi thứ nhà cung cấp đã đọc.
  IF (NEW.title IS DISTINCT FROM OLD.title
      OR NEW.requires_dual_approval IS DISTINCT FROM OLD.requires_dual_approval)
     AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Chi sua duoc tieu de va nguong phe duyet khi RFQ con o DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (e) ĐIỀU KIỆN ĐỂ MỞ. Ba vế, và cả ba là bất biến TRÊN DỮ LIỆU nên chúng thuộc về tầng này:
  --     đếm được bằng một câu SELECT, không cần ngữ cảnh phiên nào.
  IF NEW.status = 'OPEN' THEN
    SELECT count(*) INTO so_hang_muc FROM public.rfq_items i WHERE i.rfq_id = NEW.id;
    IF so_hang_muc = 0 THEN
      RAISE EXCEPTION 'Khong mo duoc RFQ khong co hang muc nao'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.requires_dual_approval THEN
      SELECT count(*) INTO so_phe_duyet FROM public.rfq_approvals a WHERE a.rfq_id = NEW.id;
      IF so_phe_duyet < 2 THEN
        RAISE EXCEPTION 'RFQ nay can 2 phe duyet, moi co % (D2)', so_phe_duyet
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_chuyen_trang_thai
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_chuyen_trang_thai();

-- ============================================================================================
-- (5) NGƯỜI TẠO KHÔNG ĐƯỢC TỰ DUYỆT (D2, vế cuối)
--
-- Đây KHÔNG viết được thành `CHECK` ở mức bảng: nó so một cột của `rfq_approvals` với một cột
-- của `rfq_packages`. Trigger là hình dạng duy nhất còn lại.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_kiem_nguoi_duyet() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  trang_thai text;
  chu_phien uuid;
BEGIN
  SELECT p.created_by, p.status INTO nguoi_tao, trang_thai
    FROM public.rfq_packages p WHERE p.id = NEW.rfq_id;

  IF nguoi_tao = NEW.approver_user_id THEN
    RAISE EXCEPTION 'Nguoi tao RFQ khong duoc la mot trong hai nguoi duyet (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF trang_thai <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Chi phe duyet duoc RFQ dang o PENDING_APPROVAL, RFQ nay dang %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  -- Phiên phải THUỘC VỀ chính người duyệt. Không có vế này, `UNIQUE (org_id, rfq_id, session_id)`
  -- chỉ đòi "hai chuỗi uuid khác nhau" — và một người có hai phiên của mình thì vẫn đi qua, đúng
  -- ca mà ràng buộc kia sinh ra để chặn.
  SELECT s.user_id INTO chu_phien FROM public.sessions s WHERE s.id = NEW.session_id;
  IF chu_phien IS DISTINCT FROM NEW.approver_user_id THEN
    RAISE EXCEPTION 'Phien duoc dan ra khong thuoc ve nguoi duyet (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_approvals_kiem_nguoi_duyet
  BEFORE INSERT ON rfq_approvals
  FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_nguoi_duyet();

-- ============================================================================================
-- (6) HẠNG MỤC CHỈ SỬA ĐƯỢC KHI RFQ CÒN SOẠN
--
-- Mệnh đề này KHÔNG có trong sổ đăng ký 49 mã, và nó được cài đặt ở đây một cách CÓ Ý THỨC về
-- điều đó — xem docs/STATE.md, mục ghi các mệnh đề đáng vào sổ mà chưa vào sổ. Lý do cài: sau khi
-- RFQ đã OPEN, nhà cung cấp đã đọc danh sách hạng mục; sửa nó là đổi đề bài giữa cuộc thi, và
-- không lớp nào khác trong hệ thống chặn điều đó.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_items_chi_sua_khi_soan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  rfq uuid;
  trang_thai text;
BEGIN
  -- `coalesce(NEW.rfq_id, OLD.rfq_id)` KHÔNG dùng được: trong một trigger DELETE, plpgsql ném
  -- "record new is not assigned yet" NGAY KHI đọc `NEW.rfq_id`, trước cả khi coalesce chạy.
  -- Cùng lý do cho `RETURN coalesce(NEW, OLD)` — coalesce không nhận kiểu RECORD. Phải rẽ nhánh
  -- theo TG_OP.
  IF TG_OP = 'DELETE' THEN
    rfq := OLD.rfq_id;
  ELSE
    rfq := NEW.rfq_id;
  END IF;

  SELECT p.status INTO trang_thai FROM public.rfq_packages p WHERE p.id = rfq;

  IF trang_thai NOT IN ('DRAFT', 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'Khong sua duoc hang muc cua RFQ dang o trang thai %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_items_chi_sua_khi_soan
  BEFORE INSERT OR UPDATE OR DELETE ON rfq_items
  FOR EACH ROW EXECUTE FUNCTION public.rfq_items_chi_sua_khi_soan();

-- db/migrations/011_rfq_hardening.sql
-- Vòng sửa sau REVIEW AN NINH S1.1 + S1.2 (2026-08-29). Đóng 1 CRITICAL và 4 HIGH ở tầng CSDL.
--
-- Migration `008` và `009` KHÔNG được đụng: migration đánh số chạy đúng một lần, và sửa tại chỗ
-- đổi checksum. Mọi thứ dưới đây là ALTER/CREATE OR REPLACE trên lược đồ hai file ấy đã dựng.
--
-- ============================================================================================
-- (C-1) PHÊ DUYỆT KÉP KHÔNG GHIM NỘI DUNG — CRITICAL
-- ============================================================================================
-- Kịch bản đã được reviewer dựng, đi trọn qua mặt tiền công khai, không cần một câu SQL viết tay:
--   u1 tạo RFQ 1 dòng/100 tấm -> nộp duyệt -> u2 và u3 duyệt (cả ba lớp D2 đi qua ĐÚNG thiết kế)
--   -> u1 thêm 20 dòng, trong đó có 10.000 tấm (trigger cho qua vì PENDING_APPROVAL nằm trong
--   danh sách được sửa) -> u1 mở RFQ. Kiểm (e) đếm HAI HÀNG phê duyệt và KHÔNG hỏi hai hàng đó
--   phê duyệt CÁI GÌ.
--
-- Phê duyệt kép khi ấy chứng nhận một nội dung mà hệ thống không ghim, và nội dung được thay bởi
-- đúng người mà D2 sinh ra để loại khỏi vòng phê duyệt. Chú thích ở 009 biện minh trigger hạng mục
-- bằng *"sau khi RFQ đã OPEN, nhà cung cấp đã đọc danh sách hạng mục"* — đúng cho vế nhà cung cấp
-- và BỎ SÓT HOÀN TOÀN vế người duyệt. Người duyệt cũng đã đọc danh sách hạng mục.
--
-- Cách đóng: một chữ ký phê duyệt phải trỏ tới MỘT NỘI DUNG XÁC ĐỊNH. Dùng BĂM NỘI DUNG thay vì
-- một cột `content_version` tăng dần, vì cột tăng dần đòi một `UPDATE rfq_packages` phát ra từ
-- trigger của `rfq_items` — mà `app_api` không có quyền ghi cột đó, và cấp quyền ấy sẽ mở lại đúng
-- đường mà cột này sinh ra để đóng. Băm thì không đòi quyền nào: nó được TÍNH khi cần.

CREATE OR REPLACE FUNCTION public.rfq_bam_noi_dung(p_rfq uuid) RETURNS bytea
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT sha256(convert_to(
    coalesce((SELECT p.title || '|' || coalesce(p.deadline_at::text, '')
                FROM public.rfq_packages p WHERE p.id = p_rfq), '')
    || '|' ||
    coalesce((SELECT string_agg(i.line_no::text || ':' || i.description || ':' ||
                                i.quantity::text || ':' || i.unit, ';' ORDER BY i.line_no)
                FROM public.rfq_items i WHERE i.rfq_id = p_rfq), ''),
    'UTF8'));
$ham$;

-- Chữ ký phê duyệt nay MANG nội dung nó đã ký. Cột do TRIGGER đặt, không nằm trong GRANT INSERT —
-- bên gọi không khai được nó, nên không có đường nào ký một nội dung mình không đọc.
ALTER TABLE rfq_approvals ADD COLUMN approved_content_hash bytea;

-- ============================================================================================
-- (H-1) `created_by` LÀ LỜI KHAI — HIGH
-- ============================================================================================
-- `createRfq` nhận `createdBy` và `actor` như hai tham số ĐỘC LẬP, không hàm nào ràng buộc chúng
-- với nhau. Mallory gọi `createRfq({ createdBy: idCuaBob, actor: Mallory })` -> từ giây đó
-- `created_by = Bob`, và Mallory tự duyệt được vì trigger so `Bob = Mallory` -> sai -> cho qua.
-- D2 tụt từ "hai người khác người tạo" xuống "một người khác người tạo".
--
-- Cách đóng: `created_by` phải là DẪN XUẤT, không phải lời khai. RFQ mang phiên của người tạo, và
-- trigger đòi `sessions.user_id = created_by`. Cột nullable để migration chạy được trên lược đồ đã
-- có; trigger đòi NOT NULL cho mọi hàng MỚI, nên nó chặt như một `NOT NULL` trên đường đi tới.
ALTER TABLE rfq_packages ADD COLUMN created_by_session_id uuid;
ALTER TABLE rfq_packages ADD CONSTRAINT rfq_packages_created_by_session_fkey
  FOREIGN KEY (org_id, created_by_session_id) REFERENCES sessions (org_id, id);
GRANT INSERT (created_by_session_id) ON rfq_packages TO app_api;

-- ============================================================================================
-- (H-3) BA CỘT MỐC THỜI GIAN GHI ĐÈ ĐƯỢC, KỂ CẢ LÙI VỀ QUÁ KHỨ — HIGH
-- ============================================================================================
-- `openRfq` chạy `UPDATE ... SET status='OPEN', opened_at=now()` KHÔNG có điều kiện trạng thái
-- nguồn. Gọi lại trên một RFQ đang OPEN: kiểm (a) bỏ qua vì status không đổi, và `opened_at` bị
-- đặt lại thành `now()`. Một RFQ mở từ ba ngày trước có hồ sơ nói nó vừa mở lúc này.
--
-- `opened_at`/`closed_at` là hồ sơ DUY NHẤT ghi lại cửa sổ niêm phong tồn tại trong khoảng nào —
-- đúng thứ kiểm toán viên của khách hàng sẽ đọc.
--
-- Ba CHECK dưới đây đóng CHIỀU NGƯỢC của ba CHECK đã có ở 009 (chúng chỉ nói "đã mở thì phải có
-- mốc", không nói "chưa mở thì không được có mốc"), cộng thứ tự thời gian.
ALTER TABLE rfq_packages ADD CONSTRAINT rfq_chua_mo_thi_khong_co_moc_mo
  CHECK (status IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING', 'CANCELLED') OR opened_at IS NULL);
ALTER TABLE rfq_packages ADD CONSTRAINT rfq_chua_dong_thi_khong_co_moc_dong
  CHECK (status IN ('CLOSED', 'UNSEALED', 'EVALUATING', 'CANCELLED') OR closed_at IS NULL);
ALTER TABLE rfq_packages ADD CONSTRAINT rfq_thu_tu_moc
  CHECK ((opened_at IS NULL OR opened_at >= created_at)
         AND (closed_at IS NULL OR opened_at IS NULL OR closed_at >= opened_at));

-- ============================================================================================
-- (H-4) ĐÓNG SỚM ĐI VÒNG QUA C4 — HIGH
-- ============================================================================================
-- Kiểm (b) của 009 chặn `SET deadline_at = <sớm hơn>` — con đường KHÔNG AI CẦN DÙNG. Cạnh
-- `OPEN -> CLOSED` rút cửa sổ thầu xuống 0 mà không kiểm gì: người mua đóng ngay sau khi nhà cung
-- cấp được ưu ái đã nộp, bốn nhà còn lại vĩnh viễn không nộp được, và `CLOSED -> OPEN` không tồn
-- tại nên không có đường hoàn tác.
--
-- Nói đúng mức: kiểm (b) MẠNH HƠN C4 trên một trục không quan trọng (giá trị của một cột) và YẾU
-- HƠN C4 trên trục quan trọng (hiệu lực của cửa sổ thầu).
--
-- Cách đóng ở tầng này: đóng sớm phải là một hành vi có TÊN và có LÝ DO nằm trong dữ liệu, không
-- phải một `reason` chỉ đi vào payload kiểm toán. Vế "phải có phê duyệt riêng khi đã có báo giá"
-- thuộc S1.5 (bảng báo giá chưa tồn tại) và được ghi ở §4 của ma trận.
ALTER TABLE rfq_packages ADD COLUMN early_close_reason text
  CHECK (early_close_reason IS NULL
         OR (octet_length(early_close_reason) > 0 AND octet_length(early_close_reason) <= 2000));
GRANT UPDATE (early_close_reason) ON rfq_packages TO app_api;

-- ============================================================================================
-- (M-2) `quantity` NHẬN 'NaN' — PostgreSQL sắp NaN LỚN HƠN mọi giá trị, nên `NaN > 0` là TRUE
-- ============================================================================================
ALTER TABLE rfq_items ADD CONSTRAINT rfq_items_quantity_huu_han
  CHECK (quantity <> 'NaN'::numeric AND quantity < 'Infinity'::numeric);

-- ============================================================================================
-- QUYỀN KHÔNG CÓ NGƯỜI DÙNG — S1.1 MEDIUM-5 và S1.2 C-1 mục 5
-- ============================================================================================
-- Nguyên tắc do chính 008 phát biểu — *"một quyền cấp 'cho chắc' là một quyền không ai gỡ ra
-- nữa"* — được áp cho `app_unseal` và bị bỏ qua cho `app_api`. Trong toàn kho mã KHÔNG có một câu
-- `UPDATE suppliers` / `UPDATE supplier_contacts` / `UPDATE rfq_items` / `DELETE FROM rfq_items`
-- nào. Hậu quả cụ thể, không chỉ hình thức: `supplier_contacts.phone` LÀ "kênh đã đăng ký" của E2,
-- và một `api` bị chiếm đổi được số nhận OTP của bất kỳ người liên hệ nào bằng một câu UPDATE mà
-- KHÔNG sinh một bản ghi kiểm toán nào.
REVOKE UPDATE ON suppliers FROM app_api;
REVOKE UPDATE ON supplier_contacts FROM app_api;
REVOKE UPDATE, DELETE ON rfq_items FROM app_api;

-- ============================================================================================
-- (S1.1 HIGH-2) `email` KHÔNG ĐƯỢC KIỂM ĐỊNH DẠNG Ở BẤT KỲ TẦNG NÀO
-- ============================================================================================
-- `batBuoc` chỉ `.trim()` — thứ cắt HAI ĐẦU. Một chuỗi mang `\n` ở GIỮA lưu được sạch sẽ (đã ĐO),
-- và cột này là địa chỉ nhận magic link ở S1.3. Đây là CHÈN HEADER ĐÃ ĐƯỢC LƯU TRỮ: mọi consumer
-- về sau (bộ gửi thư, bộ xuất CSV, log dòng-đơn) kế thừa nó.
--
-- CHECK dưới đây là phép kiểm HÌNH DẠNG, không phải phép kiểm "địa chỉ này có thật". Nó đóng đúng
-- một thứ: ký tự điều khiển và khoảng trắng không nằm được trong cột.
ALTER TABLE supplier_contacts ADD CONSTRAINT supplier_contacts_email_hinh_dang
  CHECK (email ~ '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+\.[^[:space:][:cntrl:]@]+$');

-- ============================================================================================
-- MÁY TRẠNG THÁI — BẢN THAY THẾ, ĐÓNG C-1, H-3, H-4, M-3, M-5
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_kiem_chuyen_trang_thai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  -- `PENDING_APPROVAL->DRAFT` là cạnh MỚI của vòng sửa này: sau C-1, hạng mục chỉ sửa được ở
  -- DRAFT, nên phải có đường quay lại — và đường ấy XOÁ MỌI CHỮ KÝ PHÊ DUYỆT (trigger dưới).
  CANH_HOP_LE constant text[] := ARRAY[
    'DRAFT->PENDING_APPROVAL',
    'PENDING_APPROVAL->DRAFT',
    'PENDING_APPROVAL->OPEN',
    'OPEN->CLOSED',
    'CLOSED->UNSEALED',
    'UNSEALED->EVALUATING',
    'DRAFT->CANCELLED',
    'PENDING_APPROVAL->CANCELLED',
    'OPEN->CANCELLED'
  ];
  -- Cửa sổ thầu tối thiểu. ARCHITECTURE §6 đòi "deadline ≥ now + cửa sổ tối thiểu" và KHÔNG tầng
  -- nào cài đặt nó (M-5). Sàn dưới ở đây là sàn CỦA HỆ, không phải chính sách của tổ chức: một
  -- RFQ mở với deadline đã ở quá khứ là một trạng thái hỏng TRÊN DỮ LIỆU.
  CUA_SO_TOI_THIEU constant interval := interval '1 hour';
  so_hang_muc integer;
  so_phe_duyet integer;
  bam_hien_tai bytea;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status || '->' || NEW.status) = ANY (CANH_HOP_LE)) THEN
      RAISE EXCEPTION 'Chuyen trang thai RFQ khong hop le: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (b) deadline không bao giờ lùi. [L-1] Vế `NEW.deadline_at IS NULL` được thêm ở vòng sửa này:
  -- bản 009 chỉ chạy khi CẢ HAI giá trị NOT NULL, nên ở DRAFT hai câu `SET NULL` rồi `SET <sớm
  -- hơn>` lùi được deadline. Chú thích và tên test của 009 vì vậy rộng hơn mã; nay thì không.
  IF OLD.deadline_at IS NOT NULL
     AND (NEW.deadline_at IS NULL OR NEW.deadline_at < OLD.deadline_at) THEN
    RAISE EXCEPTION 'Khong duoc rut ngan hay xoa deadline cua RFQ (C4)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (c) [C-1] `PENDING_APPROVAL` BỊ GỠ khỏi danh sách được đổi deadline: sau khi đã nộp duyệt,
  -- đổi deadline là đổi nội dung mà người duyệt sẽ ký.
  IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
     AND OLD.status NOT IN ('DRAFT', 'OPEN') THEN
    RAISE EXCEPTION 'Chi doi duoc deadline khi RFQ dang DRAFT hoac OPEN (C4)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW.title IS DISTINCT FROM OLD.title
      OR NEW.requires_dual_approval IS DISTINCT FROM OLD.requires_dual_approval)
     AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Chi sua duoc tieu de va nguong phe duyet khi RFQ con o DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (f) [H-3] BA MỐC CHỈ ĐẶT ĐƯỢC MỘT LẦN. Không có vế này, gọi lại `openRfq` trên một RFQ đang
  -- OPEN đẩy `opened_at` tới hiện tại, và mọi phép kiểm khác im lặng vì status không đổi.
  IF OLD.opened_at IS NOT NULL AND NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'opened_at chi dat duoc mot lan' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'closed_at chi dat duoc mot lan' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    RAISE EXCEPTION 'cancelled_at chi dat duoc mot lan' USING ERRCODE = 'check_violation';
  END IF;

  -- (g) [M-5] Cửa sổ thầu tối thiểu, kiểm ở CẢ HAI cạnh đi vào vòng phê duyệt và vòng mở.
  IF NEW.status IN ('PENDING_APPROVAL', 'OPEN') AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.deadline_at IS NULL OR NEW.deadline_at < now() + CUA_SO_TOI_THIEU THEN
      RAISE EXCEPTION 'Cua so thau phai con it nhat % ke tu bay gio', CUA_SO_TOI_THIEU
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (h) [H-4] ĐÓNG SỚM là một hành vi có tên. Đóng đúng hạn không đòi gì thêm.
  IF NEW.status = 'CLOSED' AND OLD.status = 'OPEN' AND now() < OLD.deadline_at THEN
    IF NEW.early_close_reason IS NULL THEN
      RAISE EXCEPTION 'Dong RFQ truoc han phai co ly do tuong minh (early_close_reason)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'OPEN' THEN
    SELECT count(*) INTO so_hang_muc FROM public.rfq_items i WHERE i.rfq_id = NEW.id;
    IF so_hang_muc = 0 THEN
      RAISE EXCEPTION 'Khong mo duoc RFQ khong co hang muc nao'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.requires_dual_approval THEN
      -- [C-1] Đây là dòng đóng CRITICAL: đếm phê duyệt TRÊN ĐÚNG NỘI DUNG hiện tại, không đếm
      -- "có bao nhiêu hàng". Thêm một hạng mục sau khi đã duyệt làm băm đổi, và hai chữ ký cũ
      -- không còn đếm được nữa.
      bam_hien_tai := public.rfq_bam_noi_dung(NEW.id);
      SELECT count(*) INTO so_phe_duyet
        FROM public.rfq_approvals a
       WHERE a.rfq_id = NEW.id AND a.approved_content_hash = bam_hien_tai;
      IF so_phe_duyet < 2 THEN
        RAISE EXCEPTION
          'RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co % (D2)', so_phe_duyet
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$ham$;

-- [C-1] Quay về DRAFT xoá mọi chữ ký. Trigger AFTER, chạy dưới quyền chủ sở hữu bảng khi migration
-- tạo nó — nhưng nó là SECURITY INVOKER, nên nó cần `app_api` xoá được `rfq_approvals`. Cố ý KHÔNG
-- cấp DELETE cho `app_api`: thay vào đó dùng `DELETE` trong một trigger thuộc sở hữu của role
-- deploy... KHÔNG DÙNG ĐƯỢC (mục (C) của hardening cấm SECURITY DEFINER). Nên chọn cách khác:
-- băm nội dung đã làm chữ ký cũ VÔ HIỆU TỰ ĐỘNG khi nội dung đổi, nên KHÔNG cần xoá hàng nào.
-- Hàng cũ ở lại như một dấu vết: "hai người này đã duyệt nội dung có băm X".
-- Ghi ra thay vì để người đọc sau tưởng đây là một thiếu sót.

-- [H-2] + [M-3] Người duyệt: phiên phải CÒN HIỆU LỰC, và fail-CLOSED khi không tìm thấy hàng cha.
CREATE OR REPLACE FUNCTION public.rfq_kiem_nguoi_duyet() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  trang_thai text;
  chu_phien uuid;
BEGIN
  -- [M-3] `AND p.org_id = NEW.org_id` cộng `IF NOT FOUND`: bản 009 so với NULL khi không thấy
  -- hàng cha, và `NULL = x` cho NULL nên CẢ HAI phép kiểm D2 im lặng đi qua. Hôm nay chưa khai
  -- thác được (khoá ngoại hợp thành giữ hàng cha tồn tại), nhưng bốn tính chất phải đồng thời
  -- đúng để chỗ đó an toàn và không lớp nào ghim bốn tính chất ấy lại với nhau.
  SELECT p.created_by, p.status INTO nguoi_tao, trang_thai
    FROM public.rfq_packages p WHERE p.id = NEW.rfq_id AND p.org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ cho phe duyet nay' USING ERRCODE = 'check_violation';
  END IF;

  IF nguoi_tao = NEW.approver_user_id THEN
    RAISE EXCEPTION 'Nguoi tao RFQ khong duoc la mot trong hai nguoi duyet (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF trang_thai <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Chi phe duyet duoc RFQ dang o PENDING_APPROVAL, RFQ nay dang %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  -- [H-2] Bản 009 chỉ đọc `user_id`. `sessions` có đủ `expires_at`, `revoked_at`,
  -- `mfa_verified_at` và không cột nào được kiểm — nên một phiên sáu tháng trước, hoặc một phiên
  -- ĐÃ BỊ THU HỒI vì nghi ngờ chiếm đoạt, vẫn ký được một phê duyệt. Quy trình ứng phó sự cố
  -- "thu hồi hết phiên của người này" KHÔNG đóng được đường phê duyệt.
  --
  -- `mfa_verified_at IS NOT NULL` là vế của D1 áp cho thao tác này. Cửa sổ tươi của MFA thì KHÔNG
  -- kiểm ở đây: hằng số ấy thuộc `assertFreshMfa` (packages/identity) và nhân bản nó vào plpgsql
  -- sẽ tạo hai nguồn sự thật. Phần chênh đó phải vào §4 của ma trận.
  SELECT s.user_id INTO chu_phien
    FROM public.sessions s
   WHERE s.id = NEW.session_id
     AND s.org_id = NEW.org_id
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.mfa_verified_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien khong hop le: het han, bi thu hoi, hoac chua qua MFA (D2/D1)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF chu_phien IS DISTINCT FROM NEW.approver_user_id THEN
    RAISE EXCEPTION 'Phien duoc dan ra khong thuoc ve nguoi duyet (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [C-1] Chữ ký MANG nội dung nó ký. Bên gọi không khai được cột này (không có GRANT INSERT).
  NEW.approved_content_hash := public.rfq_bam_noi_dung(NEW.rfq_id);

  RETURN NEW;
END
$ham$;

-- [C-1] + [M-3] + [M-4] Hạng mục chỉ sửa được khi RFQ còn DRAFT, đọc hàng cha CÓ KHOÁ.
CREATE OR REPLACE FUNCTION public.rfq_items_chi_sua_khi_soan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  rfq uuid;
  org uuid;
  trang_thai text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rfq := OLD.rfq_id; org := OLD.org_id;
  ELSE
    rfq := NEW.rfq_id; org := NEW.org_id;
  END IF;

  -- [M-4] `FOR NO KEY UPDATE` tuần tự hoá đúng cặp thao tác này với chuyển trạng thái RFQ. Không
  -- có nó, dưới READ COMMITTED: T1 mở RFQ (đếm 1 hạng mục, đi qua, chưa commit) trong khi T2 xoá
  -- hạng mục (đọc status từ ảnh chụp cũ, thấy DRAFT, cho qua) -> RFQ OPEN với 0 hạng mục.
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p WHERE p.id = rfq AND p.org_id = org FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ cho hang muc nay' USING ERRCODE = 'check_violation';
  END IF;

  -- [C-1] `PENDING_APPROVAL` BỊ GỠ. Đây là nửa còn lại của bản vá CRITICAL: băm nội dung làm chữ
  -- ký cũ vô hiệu, còn dòng này chặn hẳn việc sửa sau khi đã nộp duyệt.
  IF trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Chi sua duoc hang muc khi RFQ con o DRAFT, RFQ nay dang %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$ham$;

-- [L-2] `TRUNCATE` không kích hoạt trigger hàng. Hôm nay `app_api` không có quyền TRUNCATE, nhưng
-- không có canary nào khẳng định điều đó, và một script bảo trì chạy dưới chủ sở hữu bảng dọn sạch
-- hạng mục của mọi RFQ đang OPEN mà không trigger nào nổ. Chi phí: một câu lệnh.
CREATE OR REPLACE FUNCTION public.rfq_items_cam_truncate() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  RAISE EXCEPTION 'TRUNCATE bi cam tren rfq_items' USING ERRCODE = 'insufficient_privilege';
END
$ham$;

CREATE TRIGGER rfq_items_cam_truncate
  BEFORE TRUNCATE ON rfq_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.rfq_items_cam_truncate();

-- [H-1] `created_by` là DẪN XUẤT: phiên phải thuộc về chính người được ghi là người tạo.
CREATE OR REPLACE FUNCTION public.rfq_kiem_nguoi_tao() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  chu_phien uuid;
BEGIN
  IF NEW.created_by_session_id IS NULL THEN
    RAISE EXCEPTION 'RFQ phai mang phien cua nguoi tao (created_by_session_id)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.user_id INTO chu_phien
    FROM public.sessions s
   WHERE s.id = NEW.created_by_session_id
     AND s.org_id = NEW.org_id
     AND s.revoked_at IS NULL
     AND s.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien cua nguoi tao khong hop le: het han hoac bi thu hoi'
      USING ERRCODE = 'check_violation';
  END IF;

  IF chu_phien IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'created_by khong khop chu phien — no phai la DAN XUAT, khong phai loi khai'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_nguoi_tao
  BEFORE INSERT ON rfq_packages
  FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_nguoi_tao();

-- =============================================================================================
-- 067 — [S1.137 / khoản 240] CHỮ KÝ D2 CHỈ ĐƯỢC ĐẾM Ở CẠNH MỞ GÓI
-- =============================================================================================
-- ĐO (lượt soi hình dạng S3 — `evidence/security-reviews.md` §S1.136 mục 5, phép đo M3): một gói
-- cần phê duyệt kép, hai chữ ký, mở, rồi gia hạn hai lần. Lần một qua; lần hai bị từ chối
-- *"RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 0 (D2)"*. Gói dưới ngưỡng gia hạn bao
-- nhiêu lần cũng qua.
--
-- CƠ CHẾ: khối "điều kiện để mở" của `rfq_kiem_chuyen_trang_thai` (`061`) chạy mỗi khi
-- `NEW.status = 'OPEN'` mà không hỏi `OLD.status` — tức ở MỌI câu UPDATE trên một gói đang OPEN.
-- Băm nội dung (`rfq_bam_noi_dung`, `011`) có cả `deadline_at`, và trigger BEFORE đọc hàng CŨ: lần
-- gia hạn đầu băm ra hạn lúc ký nên khớp, lần hai băm ra hạn của lần gia hạn trước nên lệch.
--
-- VÌ SAO ĐÂY LÀ LỖI CHỨ KHÔNG PHẢI LUẬT. S1.91 từng ghi *"gia hạn làm mất hiệu lực chữ ký cũ — hành
-- vi ĐÚNG"*. Nếu đó là luật thì lần gia hạn ĐẦU cũng phải bị chặn: nó đổi cùng cột ấy, và nó đi qua.
-- Spec S0+S1 §4.4 đặt bốn điều kiện cho gia hạn — đang OPEN, có lý do, có audit, có thông báo — và
-- không đòi ký lại. `approveRfq` cũng chỉ nhận gói đang PENDING_APPROVAL, nên một luật "ký lại khi
-- gia hạn" không có đường nào để thoả.
--
-- SỬA: khối ấy chỉ chạy ở CẠNH vào OPEN, cùng cách vế (g) đã viết. Ở cạnh ấy, phép đếm TRÊN NỘI
-- DUNG HIỆN TẠI của C-1 giữ nguyên. Ngoài cạnh ấy, một gói đang OPEN không đổi được thứ gì mà chữ
-- ký phủ, trừ hạn nộp: hạng mục, tiêu đề và cờ phê duyệt kép chỉ sửa được ở DRAFT.
--
-- Thân dưới được TRÍCH nguyên văn từ `061` bằng script rồi đổi đúng hai chỗ — khuôn mà S1.110 rút ra
-- sau khi một bản viết tay rơi 45 dòng cưỡng chế:
--   ⑴ vế cạnh của khối "điều kiện để mở";
--   ⑵ [khoản 242 ⑵] chú thích đầu khối DECLARE nói cạnh về DRAFT xoá mọi chữ ký — sai, trái chính
--      `011`. Bốn migration cũ còn mang câu ấy và không sửa được: chúng đã áp và có checksum.
--
-- `hardening.always.sql` ghim thân này, và bản ghim đổi trong CÙNG commit: một migration một mình
-- bị hardening đè ngay trong cùng lần `migrate()` (S1.96).
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_kiem_chuyen_trang_thai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  -- `PENDING_APPROVAL->DRAFT` là cạnh của vòng sửa C-1 (`011`): sau C-1, hạng mục chỉ sửa được ở
  -- DRAFT, nên phải có đường quay lại. [S1.137 / khoản 242 ⑵] Cạnh ấy KHÔNG xoá chữ ký nào. Bản
  -- trước viết rằng nó xoá mọi chữ ký bằng một "trigger dưới" — trigger ấy chưa bao giờ được dựng,
  -- và `011` C-1 chọn đúng điều ngược lại: chữ ký cũ vô hiệu bằng BĂM, hàng cũ ở lại làm dấu vết.
  --
  -- [S1.107 / lượt soi ngang 77 — CAO ①] `EVALUATING->CANCELLED` là cạnh MỚI của `058`, và
  -- nó đóng một TRẠNG THÁI HÚT. Trước nó `EVALUATING` KHÔNG có một cạnh ra nào: nó chỉ đứng
  -- làm đích của `UNSEALED->EVALUATING`, còn `EVALUATING->BAFO_OPEN` và `EVALUATING->AWARDED`
  -- mới chỉ có trong spec §4.3 — `BAFO_CLOSED` và `AWARDED` chưa phải giá trị nào trong tập
  -- đóng của `009`. Điều đó vô hại suốt từ `009` vì KHÔNG ROUTE NÀO đi qua cạnh vào; S1.106
  -- mở đúng cửa ấy ra HTTP (`POST /rfqs/:rfqId/evaluate`) và đặt một nút lên nó, mà
  -- `evaluation.perform` thì NĂM trên SÁU vai giữ (khoản 220). Từ đó một cú bấm của vai thấp
  -- nhất làm một gói thầu THẬT không huỷ được, không chấm lại được, không trao được.
  --
  -- [S1.108 / S2.5] NĂM cạnh MỚI của `059` mở vòng BAFO. Bốn cạnh đầu là một chu trình:
  -- `EVALUATING->BAFO_OPEN->BAFO_CLOSED->BAFO_UNSEALED->EVALUATING`, và nó đi qua BAFO_UNSEALED
  -- chứ không nối thẳng `BAFO_CLOSED->EVALUATING` như spec §4.3 khai. Lý do là một phép đo, không
  -- một khẩu vị: cạnh `CLOSED->UNSEALED` tồn tại để `rfq_kiem_yeu_cau_mo_thau` đòi một yêu cầu
  -- mở thầu ĐÃ PHÊ DUYỆT, và nối thẳng sẽ cho một lượt chấm LẠI chạy trong khi phong bì vòng hai
  -- còn nguyên niêm — bảng xếp hạng khi ấy vẫn là bảng vòng một và không lớp nào kêu. Cạnh thứ
  -- năm `BAFO_OPEN->CANCELLED` là ảnh của `OPEN->CANCELLED`; hai cạnh KHÔNG mở
  -- (`BAFO_CLOSED->CANCELLED`, `BAFO_UNSEALED->CANCELLED`) là ảnh của hai cạnh khoản **225** còn
  -- để mở, và chúng cố ý im lặng cùng một chỗ với ảnh gốc.
  --
  -- KHÔNG có `EVALUATING->AWARDED`: `AWARDED` chưa phải giá trị nào trong tập đóng. S2.6.
  CANH_HOP_LE constant text[] := ARRAY[
    'DRAFT->PENDING_APPROVAL',
    'PENDING_APPROVAL->DRAFT',
    'PENDING_APPROVAL->OPEN',
    'OPEN->CLOSED',
    'CLOSED->UNSEALED',
    'UNSEALED->EVALUATING',
    'EVALUATING->BAFO_OPEN',
    'BAFO_OPEN->BAFO_CLOSED',
    'BAFO_CLOSED->BAFO_UNSEALED',
    'BAFO_UNSEALED->EVALUATING',
    -- [S1.110 / S2.6 / §8.3] HAI cạnh của trao thầu. `EVALUATING->AWARDED` là cạnh spec
    -- §4.3 khai từ đầu; `AWARDED->EVALUATING` là quyết định của chủ dự án ngày 2026-09-22,
    -- và nó làm `AWARDED` nghĩa là *đang có một award CÒN SỐNG* thay vì *đã từng trao*.
    -- Không có cạnh về, `AWARDED` là trạng thái HÚT thứ BA (sau `CLOSED` và `UNSEALED` —
    -- khoản 225), và một award bị huỷ để RFQ đứng ở `AWARDED` mà không có award nào sống.
    'EVALUATING->AWARDED',
    'AWARDED->EVALUATING',
    'DRAFT->CANCELLED',
    'PENDING_APPROVAL->CANCELLED',
    'OPEN->CANCELLED',
    'BAFO_OPEN->CANCELLED',
    'EVALUATING->CANCELLED'
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

  -- [S1.137 / khoản 240] Điều kiện để MỞ chỉ được hỏi ở CẠNH vào OPEN, cùng cách vế (g). Bản `061`
  -- hỏi ở MỌI câu UPDATE trên gói đang OPEN; băm nội dung có `deadline_at` còn trigger này đọc hàng
  -- CŨ, nên lần gia hạn THỨ HAI của một gói cấp kép bị từ chối như thể thiếu chữ ký. Gia hạn không
  -- đòi ký lại (spec S0+S1 §4.4). Ở cạnh vào OPEN, phép đếm TRÊN NỘI DUNG HIỆN TẠI giữ nguyên.
  IF NEW.status = 'OPEN' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT count(*) INTO so_hang_muc FROM public.rfq_items i WHERE i.rfq_id = NEW.id;
    IF so_hang_muc = 0 THEN
      RAISE EXCEPTION 'Khong mo duoc RFQ khong co hang muc nao' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.requires_dual_approval THEN
      -- [C-1] Đây là dòng đóng CRITICAL: đếm phê duyệt TRÊN ĐÚNG NỘI DUNG hiện tại, không đếm
      -- "có bao nhiêu hàng". Thêm một hạng mục sau khi đã duyệt làm băm đổi, và hai chữ ký cũ
      -- không còn đếm được nữa.
      bam_hien_tai := public.rfq_bam_noi_dung(NEW.id);
      SELECT count(*) INTO so_phe_duyet
        FROM public.rfq_approvals a
       WHERE a.rfq_id = NEW.id
         AND a.approved_content_hash = bam_hien_tai;
      IF so_phe_duyet < 2 THEN
        RAISE EXCEPTION 'RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co % (D2)',
          so_phe_duyet USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$ham$;

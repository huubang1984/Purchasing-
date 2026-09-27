-- =============================================================================================
-- 071 — [S1.163 / khoản 225] HUỶ ĐƯỢC SAU KHI ĐÓNG VÀ SAU KHI MỞ NIÊM PHONG — CÓ LÝ DO, CÓ SỔ, VÀ
--        NHÀ CUNG CẤP ĐỌC ĐƯỢC LÝ DO
-- =============================================================================================
-- ĐO (vòng S1.163, Postgres 16 thật — biên bản §S1.163): một gói ở `UNSEALED` mà lượt chấm bị từ
-- chối vì lệch tiền tệ thì ĐỨNG YÊN — `UPDATE … SET status = 'CANCELLED'` bị trigger này từ chối
-- (*"UNSEALED -> CANCELLED"*), và danh sách trắng của `cancelRfq` cũng không có `UNSEALED`. Khoản 225
-- đã đo hai trạng thái hút ấy từ S1.107 và để mở vì nó là một câu hỏi NGHIỆP VỤ: huỷ sau khi giá đã lộ
-- có hệ quả với nhà cung cấp. Khoản 244 biến câu hỏi ấy thành một lối kẹt thật.
--
-- SỬA (chủ dự án chốt ngày 2026-09-27, ADR-101) — đúng *"sửa đúng cách"* mà khoản 225 tự ghi:
--   ⑴ bốn cạnh MỚI trong `CANH_HOP_LE`: `CLOSED`, `UNSEALED`, `BAFO_CLOSED`, `BAFO_UNSEALED` → `CANCELLED`;
--   ⑵ cột `cancel_reason`: đặt đúng một lần, ở cạnh vào `CANCELLED`; BẮT BUỘC ở bốn cạnh mới — vế (i);
--   ⑶ `cancelRfq` ghi lý do vào cột ấy cho MỌI lần huỷ, cạnh hàng sổ `RFQ_CANCELLED` đã có;
--   ⑷ `GET /guest/rfq` trả `cancelReason` khi gói đã huỷ — nhà cung cấp đọc được vì sao.
--
-- Thân dưới được TRÍCH nguyên văn bằng script từ `068`, rồi đổi đúng ba chỗ: một khối chú thích, bốn
-- cạnh, và vế (i). `hardening.always.sql` ghim thân mới trong CÙNG commit (S1.96).
--
-- Không `CHECK` độ dài: `cancelRfq` đã giới hạn 2000 ký tự (`batBuoc`), cùng như lý do đóng sớm.
-- =============================================================================================
ALTER TABLE rfq_packages ADD COLUMN cancel_reason text;
GRANT UPDATE (cancel_reason) ON rfq_packages TO app_api;

CREATE OR REPLACE FUNCTION public.rfq_kiem_chuyen_trang_thai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  -- `PENDING_APPROVAL->DRAFT` là cạnh của vòng sửa C-1 (`011`): sau C-1, hạng mục chỉ sửa được ở
  -- DRAFT, nên phải có đường quay lại. [S1.140 / khoản 242 ⑵] Cạnh ấy KHÔNG xoá chữ ký nào. Bản
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
  --
  -- [S1.163 / khoản 225] BỐN cạnh huỷ MỚI — `CLOSED`, `UNSEALED` và hai ảnh BAFO của chúng. Trước
  -- vòng này bốn trạng thái ấy là trạng thái HÚT, và khoản 244 đo ra lối rơi vào đó: một báo giá ghi
  -- đơn vị tiền khác làm lượt chấm bị từ chối, gói đứng yên ở `UNSEALED` và không đường nào của sản
  -- phẩm kết thúc được nó. Chủ dự án chốt ngày 2026-09-27 (ADR-101): mở bốn cạnh, và lần huỷ SAU
  -- KHI ĐÓNG phải mang lý do — vế (i) dưới — vì nhà cung cấp đã bỏ công dự thầu, và từ `UNSEALED`
  -- giá của họ đã lộ. Lý do ấy nhà cung cấp ĐỌC ĐƯỢC ở trang nộp thầu (`cancel_reason`).
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
    'EVALUATING->CANCELLED',
    'CLOSED->CANCELLED',
    'UNSEALED->CANCELLED',
    'BAFO_CLOSED->CANCELLED',
    'BAFO_UNSEALED->CANCELLED'
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

  -- (i) [S1.163 / khoản 225] LÝ DO HUỶ. Nó chỉ được đặt ĐÚNG MỘT LẦN, và đúng ở cạnh vào
  -- `CANCELLED` — một lý do viết sau khi huỷ, hay viết lên một gói chưa huỷ, là một lời khai nhà cung
  -- cấp đọc được mà không gắn với sự kiện nào. Huỷ SAU KHI ĐÓNG thì lý do là BẮT BUỘC ở chính tầng
  -- này, không chỉ ở `cancelRfq`: bốn cạnh ấy mở ra ở vòng này với đúng điều kiện đó.
  IF NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
    IF OLD.cancel_reason IS NOT NULL THEN
      RAISE EXCEPTION 'cancel_reason chi dat duoc mot lan' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED') THEN
      RAISE EXCEPTION 'cancel_reason chi dat duoc o canh vao CANCELLED' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'CANCELLED' AND OLD.status IN ('CLOSED', 'UNSEALED', 'BAFO_CLOSED', 'BAFO_UNSEALED')
     AND (NEW.cancel_reason IS NULL OR btrim(NEW.cancel_reason) = '') THEN
    RAISE EXCEPTION 'Huy RFQ sau khi dong phai co ly do (cancel_reason) — % -> CANCELLED', OLD.status
      USING ERRCODE = 'check_violation';
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

  -- [S1.140 / khoản 240] Điều kiện để MỞ chỉ được hỏi ở CẠNH vào OPEN, cùng cách vế (g). Bản `061`
  -- hỏi ở MỌI câu UPDATE trên gói đang OPEN; băm nội dung có `deadline_at` còn trigger này đọc hàng
  -- CŨ, nên lần gia hạn THỨ HAI của một gói cấp kép bị từ chối như thể thiếu chữ ký. Gia hạn không
  -- đòi ký lại (spec S0+S1 §4.4). Ở cạnh vào OPEN, phép đếm TRÊN NỘI DUNG HIỆN TẠI giữ nguyên.
  IF NEW.status = 'OPEN' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT count(*) INTO so_hang_muc FROM public.rfq_items i WHERE i.rfq_id = NEW.id;
    IF so_hang_muc = 0 THEN
      RAISE EXCEPTION 'Khong mo duoc RFQ khong co hang muc nao' USING ERRCODE = 'check_violation';
    END IF;

    -- [C-1] Đây là dòng đóng CRITICAL: đếm phê duyệt TRÊN ĐÚNG NỘI DUNG hiện tại, không đếm
    -- "có bao nhiêu hàng". Thêm một hạng mục sau khi đã duyệt làm băm đổi, và chữ ký cũ không
    -- còn đếm được nữa.
    --
    -- [S1.142 / khoản 241] Phép đếm chạy cho MỌI gói. Bản trước chỉ đếm khi gói cấp kép, nên gói
    -- dưới ngưỡng mở được với 0 chữ ký — trái spec S0+S1 §4.3 (*"phê duyệt hợp lệ"*) và ADR-017
    -- (*"một phê duyệt là đủ"*, tức phải CÓ một). Người tạo không tự ký được: `rfq_kiem_nguoi_duyet`.
    bam_hien_tai := public.rfq_bam_noi_dung(NEW.id);
    SELECT count(*) INTO so_phe_duyet
      FROM public.rfq_approvals a
     WHERE a.rfq_id = NEW.id
       AND a.approved_content_hash = bam_hien_tai;
    IF NEW.requires_dual_approval THEN
      IF so_phe_duyet < 2 THEN
        RAISE EXCEPTION 'RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co % (D2)',
          so_phe_duyet USING ERRCODE = 'check_violation';
      END IF;
    ELSIF so_phe_duyet < 1 THEN
      RAISE EXCEPTION 'RFQ nay can 1 phe duyet TREN NOI DUNG HIEN TAI, moi co 0 (D2, san mot chu ky)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$ham$;

-- ==============================================================================================
-- 059 — VÒNG BAFO: BA TRẠNG THÁI MỚI, NĂM CẠNH, VÀ MỘT DẤU VÒNG DO TRIGGER ĐẶT
--
-- [S1.108 / S2.5] Spec S2 §4.3 khai NĂM cạnh mới cho BAFO và award. Migration này làm phần BAFO
-- — bốn cạnh của vòng hai cộng một lối huỷ — và KHÔNG làm `EVALUATING->AWARDED` (đó là S2.6).
--
-- ---------------------------------------------------------------------------------------------
-- BA PHÁT HIỆN CỦA LƯỢT SOI HÌNH DẠNG, ĐO TRƯỚC DÒNG MÃ ĐẦU, VÀ CHÚNG ĐỔI THIẾT KẾ
-- ---------------------------------------------------------------------------------------------
--   ⑴ `bid_kiem_han_nop` (C1, `018`) đòi `status = 'OPEN'` VÀ `now() < rfq_packages.deadline_at`.
--     Một vòng BAFO có RFQ ở `BAFO_OPEN` và hạn vòng một đã ở quá khứ, nên C1 chặn MỌI lần nộp
--     BAFO. Và hạn ấy KHÔNG dùng lại được: vế (b) của `rfq_kiem_chuyen_trang_thai` cấm deadline
--     lùi, vế (c) chỉ cho đổi ở `DRAFT`/`OPEN`. ⇒ hạn BAFO BUỘC phải sống ở `rfq_bafo_rounds`,
--     và C1 phải có nhánh thứ hai. Mục (5).
--
--   ⑵ `unseal_kiem_rfq_da_dong` (C3, `019`) và vế 3 của cổng bốn vế (`packages/unseal/src/gate.ts`)
--     ghim cứng `'CLOSED'`, nên phong bì vòng hai không mở được bằng đường nào. Mục (7).
--
--   ⑶ Spec §4.3 đi thẳng `BAFO_CLOSED->EVALUATING`, tức KHÔNG có trạng thái *"phong bì BAFO đã
--     mở"*. Cạnh `CLOSED->UNSEALED` tồn tại đúng để `rfq_kiem_yeu_cau_mo_thau` đòi một yêu cầu
--     mở thầu ĐÃ PHÊ DUYỆT; thiếu vế ấy cho vòng hai, một lượt chấm lại chạy được trong khi phong
--     bì vòng hai còn nguyên niêm, và bảng xếp hạng lặng lẽ vẫn là bảng của vòng một. Chủ dự án
--     chọn **thêm `BAFO_UNSEALED`** — bốn cạnh chứ không ba, đối xứng ĐÚNG với
--     `CLOSED->UNSEALED->EVALUATING` đã có, nên trigger canh dùng lại khuôn `019 §4` thay vì
--     dựng khuôn thứ hai. Mục (2) và (8).
--
-- ---------------------------------------------------------------------------------------------
-- NĂM CẠNH, VÀ VÌ SAO ĐÚNG NĂM
-- ---------------------------------------------------------------------------------------------
--     EVALUATING->BAFO_OPEN        BAFO_OPEN->BAFO_CLOSED
--     BAFO_CLOSED->BAFO_UNSEALED   BAFO_UNSEALED->EVALUATING
--     BAFO_OPEN->CANCELLED
--
-- Cạnh thứ năm KHÔNG phải một cạnh thêm cho đủ: nó suy ra từ hình dạng vòng một. Bộ ba BAFO là
-- ảnh của bộ ba `OPEN·CLOSED·UNSEALED`, nên nó thừa hưởng nguyên tập cạnh huỷ của ảnh gốc:
--
--   | vòng một                     | vòng BAFO                              |
--   |------------------------------|----------------------------------------|
--   | `OPEN->CANCELLED` CÓ         | `BAFO_OPEN->CANCELLED` CÓ              |
--   | `CLOSED->CANCELLED` KHÔNG    | `BAFO_CLOSED->CANCELLED` KHÔNG         |
--   | `UNSEALED->CANCELLED` KHÔNG  | `BAFO_UNSEALED->CANCELLED` KHÔNG       |
--
-- Hai dòng KHÔNG là khoản **225**, đang mở: huỷ sau khi phong bì đã nộp là một câu hỏi nghiệp vụ
-- mua sắm, không phải một bản vá. Vòng này KHÔNG trả lời nó — nó chỉ chép đúng câu trả lời hiện
-- hành sang ảnh BAFO, để ngày nào khoản 225 được quyết thì HAI cặp dòng cùng đổi, không một.
-- Nếu đã mở `BAFO_OPEN->CANCELLED` thì `BAFO_OPEN` không phải trạng thái hút; `BAFO_CLOSED` và
-- `BAFO_UNSEALED` thì có lối ra tiến (`->BAFO_UNSEALED`, `->EVALUATING`) nên cũng không.
--
-- ---------------------------------------------------------------------------------------------
-- DẤU VÒNG LÀ DẪN XUẤT, KHÔNG PHẢI LỜI KHAI — HAI CỘT, HAI TRIGGER ĐẶT
-- ---------------------------------------------------------------------------------------------
-- `vendor_bid_versions` KHÔNG có dấu vòng, và `version` không thay được: `024` mở đường nộp lại
-- trong lúc RFQ còn `OPEN`, nên số phiên bản đã mang nghĩa *"lần nộp thứ mấy"* chứ không
-- *"vòng thứ mấy"*. Không có dấu vòng thì `buildComparisonTable` — nối `rfq_unsealed_bids` với
-- `vendor_bid_versions` mà không lọc gì — trộn hai vòng vào một bảng so sánh.
--
-- Hai cột mới, và CẢ HAI do trigger đặt, không do người gọi khai (khuôn `bid_dat_so_phien_ban`
-- của `018`: *"một số do người gọi khai là một số hai người cùng khai được"*):
--   * `vendor_bid_versions.bafo_round_id` — C1 đặt, vì C1 đã đọc RFQ để kiểm hạn;
--   * `unseal_requests.bafo_round_id` — C3 đặt, vì C3 đã đọc RFQ để kiểm trạng thái.
-- Không role nào có `INSERT` trên hai cột ấy. Nhờ thế *"phong bì này thuộc vòng nào"* và *"yêu
-- cầu mở thầu này mở vòng nào"* là hai sự thật KHÔNG khai được sai, và mục (8) so chúng với nhau.
--
-- ---------------------------------------------------------------------------------------------
-- THỨ MIGRATION NÀY CỐ Ý KHÔNG LÀM
-- ---------------------------------------------------------------------------------------------
-- Không route, không worker, không màn hình: **J4** (*không route nào trả một mức giá BAFO trước
-- khi vòng ấy được mở qua cổng bốn vế*) ở S1.109 cùng với chúng. Lý do KHÔNG phải sức chứa của
-- một vòng mà là phép đo: J4 là một vòng quét ROUTE, và quét khi chưa route nào tồn tại cho ra
-- một cổng XANH trên tập RỖNG — đúng cái bẫy mà lượt soi 77 gọi tên. Đối chứng dương của J4
-- (*bộ quét THẤY giá ấy sau khi vòng BAFO mở*) chỉ dựng được khi đã có đường sản xuất.
--
-- Hệ quả phải nói ra, vì nó là cùng hình dạng với CAO ① của S1.107: sau migration này bốn cạnh
-- BAFO **tồn tại và được canh**, nhưng KHÔNG đường sản xuất nào đi qua chúng. Khác với ca S1.107
-- ở đúng một điểm, và điểm ấy là điểm quyết định: ở đó cửa VÀO `EVALUATING` được mở ra HTTP
-- trong khi không có cửa RA, còn ở đây mọi cửa vào và ra đều đóng với người dùng cùng một lúc.
-- Khoản **226** ghi ranh giới ấy để vòng sau đọc nó, chứ không để nó tự hiểu.
-- ==============================================================================================

-- ============================================================================================
-- (1) TẬP ĐÓNG CỦA `status`, VÀ ~~HAI~~ **BỐN** RÀNG BUỘC MỐC
-- ============================================================================================
-- `CHECK` chỉ nói *"giá trị hợp lệ"*; bảng cạnh ở mục (2) mới nói *"đi tới đây được"*. Nhưng nếu
-- tập đóng không có ba giá trị mới thì bảng cạnh nói về những thứ không tồn tại — chính trạng
-- thái mà `BAFO_CLOSED` đã sống trong spec §4.3 từ S1.101 tới nay.
ALTER TABLE rfq_packages DROP CONSTRAINT rfq_packages_status_check;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_packages_status_check
  CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING',
                    'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED', 'CANCELLED'));

-- Hai ràng buộc mốc của `009` liệt kê trạng thái, nên chúng THIU ngay khi có trạng thái mới —
-- và thiu theo hướng NỚI: một RFQ ở `BAFO_OPEN` mà `opened_at IS NULL` sẽ đi qua. Ba trạng thái
-- BAFO chỉ tới được qua `OPEN` rồi `CLOSED`, nên cả hai mốc PHẢI có.
ALTER TABLE rfq_packages DROP CONSTRAINT rfq_da_mo_thi_co_moc_mo;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_da_mo_thi_co_moc_mo
  CHECK (status NOT IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING',
                        'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED')
         OR opened_at IS NOT NULL);

ALTER TABLE rfq_packages DROP CONSTRAINT rfq_da_dong_thi_co_moc_dong;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_da_dong_thi_co_moc_dong
  CHECK (status NOT IN ('CLOSED', 'UNSEALED', 'EVALUATING',
                        'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED')
         OR closed_at IS NOT NULL);

-- BỐN, KHÔNG HAI — và con số này được sửa bởi một phép đo, không bởi một lần đọc lại. Lượt soi
-- hình dạng của vòng này đếm HAI ràng buộc mốc (cả hai ở `009`) và ghi con số ấy ra. `011 (H-3)`
-- thêm CHIỀU NGƯỢC của chúng — *"chưa mở thì KHÔNG ĐƯỢC có mốc"* — và hai dòng ấy nằm ở một tệp
-- khác nên lượt soi đọc `009` không thấy. Hậu quả đo được: 11 ca đỏ với
-- `new row for relation "rfq_packages" violates check constraint
-- "rfq_chua_dong_thi_khong_co_moc_dong"`, vì một RFQ ở `BAFO_OPEN` CÓ `closed_at` (nó đã đi qua
-- `CLOSED` một lần) mà `BAFO_OPEN` không có trong tập của ràng buộc chiều ngược.
--
-- Cách đúng để đếm, nói ra để vòng sau khỏi lặp: hỏi CSDL, đừng hỏi tệp — `SELECT conname,
-- pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'rfq_packages'::regclass AND
-- contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%'` trả về đúng BẢY dòng, và bốn
-- trong bảy liệt kê trạng thái.
ALTER TABLE rfq_packages DROP CONSTRAINT rfq_chua_mo_thi_khong_co_moc_mo;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_chua_mo_thi_khong_co_moc_mo
  CHECK (status IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING',
                    'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED', 'CANCELLED')
         OR opened_at IS NULL);

ALTER TABLE rfq_packages DROP CONSTRAINT rfq_chua_dong_thi_khong_co_moc_dong;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_chua_dong_thi_khong_co_moc_dong
  CHECK (status IN ('CLOSED', 'UNSEALED', 'EVALUATING',
                    'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED', 'CANCELLED')
         OR closed_at IS NULL);

-- ============================================================================================
-- (2) BẢNG CẠNH — NĂM CẠNH MỚI
-- ============================================================================================
-- Thân dưới đây là thân của `058` cộng năm phần tử mảng và khối chú thích lý do. Bản ghim ở
-- `hardening.always.sql` giữ BA bản sao của cùng thân này — khối `CREATE OR REPLACE` (bản SỬA),
-- chuỗi `$than$…$than$` đã chuẩn hoá khoảng trắng (bản PHÁN XÉT), và chuỗi định nghĩa trigger —
-- và `db/migrations.int.test.ts` so thân này với bản phán xét. S1.107 quên đúng bản thứ hai và
-- mất một lượt `test:int`: 51 tệp đỏ, 958 ca bỏ qua.
CREATE OR REPLACE FUNCTION public.rfq_kiem_chuyen_trang_thai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  -- `PENDING_APPROVAL->DRAFT` là cạnh MỚI của vòng sửa này: sau C-1, hạng mục chỉ sửa được ở
  -- DRAFT, nên phải có đường quay lại — và đường ấy XOÁ MỌI CHỮ KÝ PHÊ DUYỆT (trigger dưới).
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

  IF NEW.status = 'OPEN' THEN
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

-- ============================================================================================
-- (3) `rfq_bafo_rounds` — VÒNG BAFO, VÀ DANH SÁCH MỜI KHÔNG NẰM TRONG NÓ
-- ============================================================================================
-- Spec §4.2: *"Danh sách ai được mời suy từ `rfq_evaluation_lines.rank ≤ top_n` của ĐÚNG lượt
-- đánh giá được trỏ tới, KHÔNG chép lại."* Bảng này vì thế KHÔNG có bảng con liệt kê người được
-- mời — nó có `evaluation_id` và `top_n`, và mục (6) là chỗ phép suy ấy trở thành một lớp chặn.
--
-- `evaluation_id` là khoá ngoại BẮT BUỘC, và spec đã nói vì sao: `BAFO_UNSEALED->EVALUATING` sinh
-- một `rfq_evaluations` THỨ HAI, nên không có nó thì *"ai đủ điều kiện vào vòng này"* chỉ trả lời
-- được bằng một phép suy theo thứ tự thời gian — đúng hình dạng khoản **208**.
--
-- `top_n` là giá trị ĐÃ ÁP, không đọc lại `org_procurement_policies` lúc chấm: chính sách có
-- phiên bản liên tục (`035`), và một vòng BAFO phải trả lời được *"hồi ấy mời mấy người"* mà
-- không phụ thuộc phiên bản hôm nay. Mục (4) kiểm nó KHỚP chính sách tại lúc mở.
CREATE TABLE rfq_bafo_rounds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  rfq_id                uuid NOT NULL,
  evaluation_id         uuid NOT NULL,
  policy_id             uuid NOT NULL,
  -- `bafo_top_n = 0` là quy ước *"tổ chức này không dùng BAFO"* (`056`). Một VÒNG thì luôn mời
  -- ít nhất một người, nên `0` ở đây là dữ liệu hỏng, không phải một cấu hình.
  top_n                 integer NOT NULL CHECK (top_n > 0),
  -- Số vòng là DẪN XUẤT, do trigger đặt dưới khoá tư vấn — khuôn `bid_dat_so_phien_ban` (018).
  -- KHÔNG có `GRANT INSERT` trên cột này.
  round_no              integer NOT NULL CHECK (round_no > 0),
  -- Hạn nộp CỦA VÒNG NÀY. Nó KHÔNG dùng lại `rfq_packages.deadline_at` được: vế (b) của
  -- `rfq_kiem_chuyen_trang_thai` cấm deadline lùi và vế (c) chỉ cho đổi ở `DRAFT`/`OPEN`.
  deadline_at           timestamptz NOT NULL,
  opened_at             timestamptz NOT NULL DEFAULT now(),
  -- [ADR-016] Danh tính là DẪN XUẤT — hai cột này đi qua `kiem_danh_tinh_theo_phien` (013).
  opened_by             uuid NOT NULL,
  opened_by_session_id  uuid NOT NULL,
  closed_at             timestamptz,
  FOREIGN KEY (org_id, rfq_id)        REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, evaluation_id) REFERENCES rfq_evaluations (org_id, id),
  FOREIGN KEY (org_id, policy_id)     REFERENCES org_procurement_policies (org_id, id),
  FOREIGN KEY (org_id, opened_by)     REFERENCES users (org_id, id),
  UNIQUE (org_id, rfq_id, round_no),
  -- Tiền đề cho khoá ngoại hợp thành của `vendor_bid_versions` và `unseal_requests` ở mục (4).
  UNIQUE (org_id, id),
  CONSTRAINT rfq_bafo_rounds_dong_sau_khi_mo
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

-- MỘT VÒNG ĐANG MỞ MỘT GÓI THẦU. Khuôn `019:74` (`unseal_requests_mot_yeu_cau_dang_song`). Không
-- có nó, hai vòng BAFO cùng mở làm câu *"hạn nộp của tôi là khi nào"* có hai câu trả lời.
CREATE UNIQUE INDEX rfq_bafo_rounds_mot_vong_dang_mo
  ON rfq_bafo_rounds (org_id, rfq_id) WHERE closed_at IS NULL;

ALTER TABLE rfq_bafo_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_bafo_rounds FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_bafo_rounds_tenant_isolation ON rfq_bafo_rounds
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` phải TỰ mang policy khách; hardening chỉ PHÁN XÉT, không dựng.
--
-- VỊ TỪ ĐÓNG HẲN, và đó là một quyết định chứ không một bản sao dán. Hai bảng guest-đọc-được
-- (`rfq_packages`, `rfq_items`) dùng vị từ hẹp theo `app.guest_rfq_id`, và nhà cung cấp SẼ cần
-- biết hạn nộp của vòng BAFO — nên vị từ hẹp trông như lựa chọn đúng. Nó không đúng Ở VÒNG NÀY:
-- `027 §6` đặt mặc định là TỪ CHỐI, vòng này không có route khách nào cho BAFO, và bảng mang hai
-- trường mà một nhà cung cấp đọc được là tin cạnh tranh thật — `top_n` (mấy người qua vòng một)
-- và `opened_by`. Nới một policy là một câu hỏi có dữ liệu để trả lời ở S1.109, khi đã có route
-- và biết chính xác nhà cung cấp cần thấy trường nào; nới trước là nới mù.
CREATE POLICY rfq_bafo_rounds_khach ON rfq_bafo_rounds AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- Cùng lý do `INV-H14` như `rfq_evaluations` (057): `rfq_bafo_rounds_pkey` là `(id)`, nên `id`
-- KHÔNG được cấp — một `GRANT INSERT` mức BẢNG biến `duplicate key` thành một oracle xuyên tổ
-- chức. `round_no` cũng không được cấp: nó là dẫn xuất. `closed_at` chỉ có `UPDATE`, mục (4)
-- canh chiều của nó.
GRANT SELECT ON rfq_bafo_rounds TO app_api;
GRANT INSERT (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at,
              opened_by, opened_by_session_id)
  ON rfq_bafo_rounds TO app_api;
GRANT UPDATE (closed_at) ON rfq_bafo_rounds TO app_api;
-- `app_unseal` đọc để biết nó đang mở phong bì của VÒNG NÀO. Không ghi gì.
GRANT SELECT (id, org_id, rfq_id, evaluation_id, top_n, round_no, deadline_at, opened_at, closed_at)
  ON rfq_bafo_rounds TO app_unseal;

CREATE TRIGGER rfq_bafo_rounds_kiem_danh_tinh
  BEFORE INSERT ON rfq_bafo_rounds
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'opened_by', 'opened_by_session_id');
ALTER TABLE rfq_bafo_rounds ENABLE ALWAYS TRIGGER rfq_bafo_rounds_kiem_danh_tinh;

-- ============================================================================================
-- (4) MỘT VÒNG BAFO HỢP LỆ, VÀ NÓ CHỈ ĐÓNG ĐƯỢC MỘT LẦN
-- ============================================================================================
-- MỘT hàm cho cả ba sự kiện, không ba hàm: ba nhánh dưới đây là ba mặt của cùng một mệnh đề —
-- *"một vòng BAFO ra đời hợp lệ, đóng đúng một lần, và không mất đi"*. Khuôn
-- `rfq_items_chi_sua_khi_soan` (011), vốn cũng gộp DELETE với INSERT/UPDATE vào một hàm.
--
-- KHÔNG CÓ TRIGGER `TRUNCATE`, và đó là một kết luận ĐO ĐƯỢC chứ không một chỗ bỏ sót. `047` dạy
-- rằng một trigger cấp HÀNG chặn DELETE mà không có vế `TRUNCATE` là một nửa lớp — `TRUNCATE` là
-- thao tác cấp CÂU LỆNH và trigger cấp hàng không bao giờ chạy cho nó. Nhánh DELETE dưới đây làm
-- bảng này thành đúng hạng bảng ấy, nên câu hỏi phải được trả lời. Đo trên PostgreSQL 16, sau một
-- lượt `migrate()` sạch:
--
--     TRUNCATE public.rfq_bafo_rounds          -> NÉM  "cannot truncate a table referenced in a
--                                                       foreign key constraint … vendor_bid_versions"
--     TRUNCATE public.rfq_bafo_rounds CASCADE  -> NÉM  "Bang vendor_bid_versions chi duoc ghi them:
--                                                       thao tac TRUNCATE bi tu choi (B1, B2)"
--     TRUNCATE public.rfq_evaluations CASCADE  -> NÉM  cùng thông điệp ấy
--
-- Đường trần bị KHOÁ NGOẠI `vendor_bid_versions.bafo_round_id` chặn; đường `CASCADE` lan tới
-- `vendor_bid_versions` và đụng đúng trigger mà `047` dựng. Một trigger thứ ba ở đây sẽ là lớp
-- DƯ, và lớp dư trên một lối đã đóng là thứ làm người đọc sau tưởng nó là lớp CHỊU LỰC.
--
-- Nhưng phép bảo vệ ấy GIÁN TIẾP — nó sống nhờ khoá ngoại kia còn đó. Nên thứ được ghim là TÍNH
-- CHẤT, không phải cơ chế: `db/hardening-suy-tu-tinh-chat.int.test.ts` có một ca đòi CẢ HAI đường
-- trên vẫn ném. Ngày nào khoá ngoại ấy đi, dòng ấy đỏ.
CREATE OR REPLACE FUNCTION public.bafo_kiem_vong() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  CUA_SO_TOI_THIEU constant interval := interval '1 hour';
  trang_thai text;
  rfq_cua_luot uuid;
  cs_cua_luot uuid;
  top_n_chinh_sach integer;
  so_cu integer;
BEGIN
  IF TG_OP OPERATOR(pg_catalog.=) 'DELETE' THEN
    RAISE EXCEPTION 'Khong duoc xoa mot vong BAFO: no la mot su that kiem toan'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP OPERATOR(pg_catalog.=) 'UPDATE' THEN
    -- Chỉ `closed_at` đổi được, và chỉ MỘT CHIỀU: `NULL` -> một giá trị. Quyền đã chặn mọi cột
    -- khác (`GRANT UPDATE (closed_at)`), nhưng quyền không chặn chủ sở hữu bảng và superuser —
    -- cùng lập luận đã dựng lớp chỉ-ghi-thêm cho `audit_events` ở `003`.
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
       OR NEW.evaluation_id IS DISTINCT FROM OLD.evaluation_id
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.top_n IS DISTINCT FROM OLD.top_n
       OR NEW.round_no IS DISTINCT FROM OLD.round_no
       OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
       OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
       OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
       OR NEW.opened_by_session_id IS DISTINCT FROM OLD.opened_by_session_id THEN
      RAISE EXCEPTION 'Chi sua duoc closed_at cua mot vong BAFO'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Gỡ `closed_at` về NULL là MỞ LẠI một vòng đã đóng, và mục (5) đọc đúng cột ấy để quyết
    -- định có nhận báo giá hay không. Một vòng mở lại được là một hạn nộp mở lại được.
    IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'Mot vong BAFO da dong thi khong mo lai duoc'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- ---- INSERT -------------------------------------------------------------------------------
  -- `FOR NO KEY UPDATE` tuần tự hoá việc mở vòng với việc chuyển trạng thái RFQ. Khuôn [M-4] của
  -- `rfq_items_chi_sua_khi_soan`: không có nó, dưới READ COMMITTED một giao dịch mở vòng BAFO
  -- (đọc thấy `EVALUATING`) chạy song song với một giao dịch huỷ RFQ cho ra một vòng BAFO đang mở
  -- trên một gói thầu đã huỷ.
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- `EVALUATING` là trạng thái DUY NHẤT mở được một vòng BAFO — cạnh `EVALUATING->BAFO_OPEN` là
  -- cạnh duy nhất đi vào `BAFO_OPEN`. Kiểm ở đây chứ không chỉ ở cạnh: một vòng BAFO cho một gói
  -- thầu chưa chấm là một hàng không được phép TỒN TẠI, không phải một hàng sẽ bị bỏ qua.
  IF trang_thai IS DISTINCT FROM 'EVALUATING' THEN
    RAISE EXCEPTION 'Chi mo duoc vong BAFO khi RFQ dang o EVALUATING; dang o %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lượt đánh giá được trỏ tới phải là lượt CỦA CHÍNH GÓI THẦU NÀY. Khoá ngoại hợp thành đã buộc
  -- nó cùng tổ chức; nó KHÔNG buộc cùng RFQ, và một `evaluation_id` của gói thầu khác sẽ làm
  -- danh sách mời ở mục (6) suy từ một bảng xếp hạng không liên quan.
  SELECT e.rfq_id, e.policy_id INTO rfq_cua_luot, cs_cua_luot
    FROM public.rfq_evaluations e
   WHERE e.id OPERATOR(pg_catalog.=) NEW.evaluation_id
     AND e.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF rfq_cua_luot IS DISTINCT FROM NEW.rfq_id THEN
    RAISE EXCEPTION 'Luot danh gia % khong thuoc RFQ % (vong BAFO suy danh sach moi tu no)',
      NEW.evaluation_id, NEW.rfq_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Và phiên bản chính sách của VÒNG phải là phiên bản mà LƯỢT ĐÁNH GIÁ đã tính dưới. Không có
  -- vế này, `top_n` khớp một chính sách mà người gọi CHỌN: chính sách có phiên bản liên tục
  -- (`035`), nên một tổ chức có nhiều phiên bản thì cũng có nhiều giá trị `bafo_top_n`, và vế
  -- khớp ngay dưới trở thành một phép khớp với con số vừa ý chứ với con số ĐÃ ÁP. Đây là ca mà
  -- khoá ngoại hợp thành không thấy: `(org_id, policy_id)` của cả hai đều hợp lệ.
  IF cs_cua_luot IS DISTINCT FROM NEW.policy_id THEN
    RAISE EXCEPTION
      'Chinh sach cua vong BAFO (%) khac chinh sach ma luot danh gia % da tinh duoi (%)',
      NEW.policy_id, NEW.evaluation_id, cs_cua_luot
      USING ERRCODE = 'check_violation';
  END IF;

  -- `top_n` phải KHỚP `bafo_top_n` của chính phiên bản chính sách được trỏ tới. Nó là giá trị ĐÃ
  -- ÁP, nên nó phải khớp lúc áp; sau đó chính sách đổi bao nhiêu lần cũng không đổi vòng này.
  SELECT p.bafo_top_n INTO top_n_chinh_sach
    FROM public.org_procurement_policies p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.policy_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF top_n_chinh_sach IS NULL THEN
    RAISE EXCEPTION 'Chinh sach % chua khai bafo_top_n — khong mo duoc vong BAFO', NEW.policy_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF top_n_chinh_sach IS DISTINCT FROM NEW.top_n THEN
    RAISE EXCEPTION 'top_n cua vong (%) khac bafo_top_n cua chinh sach (%)',
      NEW.top_n, top_n_chinh_sach
      USING ERRCODE = 'check_violation';
  END IF;

  -- [M-5] Cùng sàn với cạnh `PENDING_APPROVAL->OPEN` của vòng một: một vòng mở với hạn đã ở quá
  -- khứ là một trạng thái hỏng TRÊN DỮ LIỆU, và nhà cung cấp không kịp làm gì với nó.
  IF NEW.deadline_at < now() + CUA_SO_TOI_THIEU THEN
    RAISE EXCEPTION 'Cua so BAFO phai con it nhat % ke tu bay gio', CUA_SO_TOI_THIEU
      USING ERRCODE = 'check_violation';
  END IF;

  -- Số vòng là DẪN XUẤT. Khoá tư vấn theo phạm vi giao dịch, khuôn `bid_dat_so_phien_ban` (018):
  -- `app_api` không có `UPDATE` trên mọi cột của bảng này nên một khoá HÀNG là bất khả, và
  -- `SECURITY DEFINER` thì mục (C) của hardening cấm. Phạm vi khoá là TỪNG GÓI THẦU.
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.rfq_id::pg_catalog.text, 0));
  SELECT max(r.round_no) INTO so_cu
    FROM public.rfq_bafo_rounds r
   WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  NEW.round_no := coalesce(so_cu, 0) OPERATOR(pg_catalog.+) 1;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_bafo_rounds_kiem_vong
  BEFORE INSERT OR UPDATE OR DELETE ON rfq_bafo_rounds
  FOR EACH ROW EXECUTE FUNCTION public.bafo_kiem_vong();
ALTER TABLE rfq_bafo_rounds ENABLE ALWAYS TRIGGER rfq_bafo_rounds_kiem_vong;

-- ============================================================================================
-- (5) DẤU VÒNG, VÀ C1 HỌC NHÁNH THỨ HAI
-- ============================================================================================
-- Hai cột mới, cả hai do trigger đặt. Không `GRANT INSERT` trên cột nào — xem khối đầu tệp.
ALTER TABLE vendor_bid_versions ADD COLUMN bafo_round_id uuid;
ALTER TABLE vendor_bid_versions
  ADD CONSTRAINT vendor_bid_versions_bafo_round_id_fkey
  FOREIGN KEY (org_id, bafo_round_id) REFERENCES rfq_bafo_rounds (org_id, id);

ALTER TABLE unseal_requests ADD COLUMN bafo_round_id uuid;
ALTER TABLE unseal_requests
  ADD CONSTRAINT unseal_requests_bafo_round_id_fkey
  FOREIGN KEY (org_id, bafo_round_id) REFERENCES rfq_bafo_rounds (org_id, id);

-- `vendor_bid_versions` được cấp `SELECT` theo CỘT ở `018` (để `envelope` nằm ngoài tầm
-- `app_api`), nên một cột mới KHÔNG tự vào tầm đọc của ai — phải cấp tường minh. `app_unseal`
-- cần nó để không mở phong bì của vòng khác.
GRANT SELECT (bafo_round_id) ON vendor_bid_versions TO app_api;
GRANT SELECT (bafo_round_id) ON vendor_bid_versions TO app_unseal;

-- `unseal_requests`: `app_api` có `SELECT` mức BẢNG từ `019:83`, nên cột mới tự vào tầm đọc của
-- nó. `app_unseal` thì KHÔNG — và đây là chỗ bản đầu của migration này SAI, theo một cách đáng
-- ghi lại. Lời khai bị gạch: *"`unseal_requests` được cấp `SELECT` mức BẢNG ở `019:83` và
-- `019:89` nên cột mới đã nằm trong tầm đọc của cả hai vai"*. `019:89` CÓ cấp mức bảng, nhưng
-- `022:298` **`REVOKE SELECT ON unseal_requests FROM app_unseal`** rồi cấp lại theo CỘT — và
-- lượt tìm của bản đầu là một `grep` khớp `GRANT` với tên bảng TRÊN CÙNG MỘT DÒNG, nên nó đọc
-- `019` mà không bao giờ thấy `022`.
--
-- Cái giá đo được: mục (8) đọc `r.bafo_round_id` dưới vai `app_unseal`, nên `migrate()` xanh mà
-- `UPDATE rfq_packages SET status='UNSEALED'` — câu mà MỌI kịch bản mở thầu chạy — chết với
-- `permission denied for table unseal_requests`. **38 ca đỏ trong một tệp, 36 trong số đó không
-- liên quan gì tới BAFO.**
GRANT SELECT (bafo_round_id) ON unseal_requests TO app_unseal;

-- ---------------------------------------------------------------------------------------------
-- C1 — HAI NHÁNH, VÀ NHÁNH THỨ HAI ĐẶT DẤU VÒNG
--
-- Thân của `018` đòi `status = 'OPEN'` và `now() < rfq_packages.deadline_at`. Nay:
--   * `OPEN`      -> hạn của `rfq_packages`, `bafo_round_id := NULL`;
--   * `BAFO_OPEN` -> hạn của vòng đang mở, `bafo_round_id := <vòng ấy>`.
-- Mọi trạng thái khác vẫn từ chối bằng CHÍNH thông điệp cũ, vì đó là thông điệp mà các test và
-- các bộ đọc lỗi của tầng trên đang ghim.
--
-- `FOR SHARE OF p` giữ nguyên và nay gánh thêm một việc: nó tuần tự hoá lần nộp này với cạnh
-- `BAFO_OPEN->BAFO_CLOSED`. Không có nó, một lần nộp đọc thấy `BAFO_OPEN` rồi commit SAU khi
-- vòng đã đóng.
--
-- CÂU ĐỌC VÒNG BAFO **KHÔNG** KHOÁ HÀNG, và đó là một phép đo chứ không một chỗ bỏ sót. Ba bước:
--
--   ⑴ Khoá ĐƯỢC PHÉP: `SELECT … FOR SHARE` và `FOR NO KEY UPDATE` trên `rfq_bafo_rounds` đều đi
--     qua dưới vai `app_api`, dù `has_table_privilege('app_api', 'public.rfq_bafo_rounds',
--     'UPDATE')` trả **false** — `GRANT UPDATE (closed_at)` ở mức CỘT là đủ cho một khoá hàng.
--     Đo trên PostgreSQL 16; nói ra vì `018` có một khối dài về đúng chỗ ngược lại (`app_api`
--     KHÔNG khoá được hàng `vendor_bids` vì nó không có `UPDATE` cột nào).
--
--   ⑵ Khoá ấy MỞ MỘT ĐƯỜNG DEADLOCK. Giao dịch nộp giữ `FOR SHARE` trên `rfq_packages` rồi xin
--     khoá trên vòng; giao dịch ĐÓNG vòng giữ khoá ghi trên vòng rồi xin `UPDATE rfq_packages`.
--     Hai thứ tự ngược nhau trên cùng hai bảng.
--
--   ⑶ Và nó KHÔNG mua gì, vì `FOR SHARE OF p` đã đủ: đóng một vòng BAFO đi kèm cạnh
--     `BAFO_OPEN->BAFO_CLOSED`, và câu `UPDATE rfq_packages` ấy xin một khoá hàng XUNG ĐỘT với
--     `FOR SHARE` mà lần nộp đang giữ — nên người đóng CHỜ, đúng thứ tự cần. Ca duy nhất lọt qua
--     là *đóng vòng mà KHÔNG đổi trạng thái*, và ca ấy **fail-closed ở cả hai chiều**: vòng đóng
--     mà trạng thái còn `BAFO_OPEN` ⇒ câu dưới không thấy vòng nào và NÉM *"du lieu hong"*; trạng
--     thái `BAFO_CLOSED` mà vòng còn mở ⇒ vế `NOT IN ('OPEN','BAFO_OPEN')` NÉM trước đó.
-- ---------------------------------------------------------------------------------------------
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
    RAISE EXCEPTION 'Da qua han nop bao gia (C1)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (6) DANH SÁCH MỜI SUY TỪ `rank`, VÀ NÓ LÀ MỘT LỚP CHẶN CHỨ KHÔNG MỘT TRUY VẤN
-- ============================================================================================
-- Spec §8.1 nói thứ S2 LÀM ĐƯỢC ở chỗ rò lớn nhất của nó: *"danh sách mời BAFO suy từ `rank`,
-- không do người mua gõ tay, nên một lần mời ngoài top-N là một lần lệch đọc được"*. Câu ấy chỉ
-- đúng nếu phép suy là thứ CHẶN được một lần nộp, không phải thứ dựng một danh sách để hiển thị.
--
-- TRIGGER RIÊNG, KHÔNG NHỒI VÀO C1, và tên nó được chọn có chủ đích. C1 tên là
-- `bid_kiem_han_nop` — *hạn nộp*; gắn phép kiểm top-N vào đó làm cái tên nói dối. Nhưng trigger
-- này PHẢI chạy SAU C1, vì nó đọc `NEW.bafo_round_id` mà C1 vừa đặt, và PostgreSQL chạy trigger
-- cùng sự kiện theo THỨ TỰ CHỮ CÁI của tên. Ba tên đã có trên bảng này:
--   `a_vendor_bid_versions_dat_so_phien_ban` · `vendor_bid_versions_kiem_han_nop`
--   `vendor_bid_versions_kiem_phien_khach`
-- `vendor_bid_versions_kiem_vong_bafo` sắp SAU cả ba (`v` > `p` > `h`). Đây là cùng thủ pháp mà
-- `018` dùng tiền tố `a_` để đặt trigger số phiên bản chạy TRƯỚC — và như ở đó, thứ tự này có một
-- test đọc `pg_trigger` đòi nó, vì một lần đổi tên trông vô hại.
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
    RAISE EXCEPTION
      'Luong bao gia % khong nam trong top-N cua luot danh gia ma vong BAFO % tro toi (J4)',
      NEW.bid_id, NEW.bafo_round_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER vendor_bid_versions_kiem_vong_bafo
  BEFORE INSERT ON vendor_bid_versions
  FOR EACH ROW EXECUTE FUNCTION public.bid_kiem_vong_bafo();
ALTER TABLE vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_kiem_vong_bafo;

-- ============================================================================================
-- (7) C3 — MỘT YÊU CẦU MỞ THẦU CHO VÒNG BAFO, VÀ NÓ TỰ BIẾT NÓ MỞ VÒNG NÀO
-- ============================================================================================
-- Thân của `019` đòi `status = 'CLOSED'`. Nay `BAFO_CLOSED` cũng đi qua, và nhánh ấy ĐẶT
-- `bafo_round_id`. Vòng được mở là vòng có `round_no` LỚN NHẤT: chỉ một vòng chưa đóng tồn tại
-- được (chỉ mục bộ phận ở mục (3)), và RFQ chỉ ở `BAFO_CLOSED` sau khi vòng ấy đóng — nên vòng
-- lớn nhất là vòng vừa đóng, và nó phải ĐÃ đóng.
CREATE OR REPLACE FUNCTION public.unseal_kiem_rfq_da_dong() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  vong uuid;
  vong_da_dong timestamptz;
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
  IF trang_thai NOT IN ('CLOSED', 'BAFO_CLOSED') THEN
    RAISE EXCEPTION 'Chi yeu cau mo thau duoc khi RFQ da CLOSED; dang o % (C3)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF trang_thai OPERATOR(pg_catalog.=) 'BAFO_CLOSED' THEN
    SELECT r.id, r.closed_at INTO vong, vong_da_dong
      FROM public.rfq_bafo_rounds r
     WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
       AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     ORDER BY r.round_no DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RFQ dang BAFO_CLOSED ma khong co vong BAFO nao — du lieu hong'
        USING ERRCODE = 'check_violation';
    END IF;
    IF vong_da_dong IS NULL THEN
      RAISE EXCEPTION 'Vong BAFO % chua dong — chua mo thau duoc (C3)', vong
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.bafo_round_id := vong;
  ELSE
    NEW.bafo_round_id := NULL;
  END IF;

  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (8) VÒNG NÀO THÌ YÊU CẦU CỦA VÒNG ẤY — VẾ ĐÓNG CAO ③
-- ============================================================================================
-- Thân của `019` đếm MỌI yêu cầu `APPROVED`/`EXECUTED` của RFQ, không phân vòng. Mở rộng trigger
-- sang `BAFO_UNSEALED` mà giữ nguyên thân ấy sẽ cho một yêu cầu của VÒNG MỘT mở được phong bì
-- VÒNG HAI — tức cổng bốn vế chạy một lần rồi mở được mọi vòng về sau. Đó đúng là lỗ mà lượt soi
-- hình dạng đo được, và nó là lý do `bafo_round_id` của `unseal_requests` tồn tại.
CREATE OR REPLACE FUNCTION public.rfq_kiem_yeu_cau_mo_thau() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  so integer;
  vong uuid;
BEGIN
  IF NEW.status OPERATOR(pg_catalog.=) 'BAFO_UNSEALED' THEN
    SELECT r.id INTO vong
      FROM public.rfq_bafo_rounds r
     WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.id
       AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     ORDER BY r.round_no DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khong co vong BAFO nao de mo thau (C3)'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO so
      FROM public.unseal_requests r
     WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.id
       AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
       AND r.bafo_round_id OPERATOR(pg_catalog.=) vong
       AND r.status IN ('APPROVED', 'EXECUTED');
    IF so OPERATOR(pg_catalog.=) 0 THEN
      RAISE EXCEPTION
        'Khong mo thau duoc vong BAFO khi chua co yeu cau mo thau CUA VONG AY da duoc phe duyet (C3, D2)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO so
    FROM public.unseal_requests r
   WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND r.bafo_round_id IS NULL
     AND r.status IN ('APPROVED', 'EXECUTED');
  IF so OPERATOR(pg_catalog.=) 0 THEN
    RAISE EXCEPTION 'Khong mo thau duoc khi chua co yeu cau mo thau da duoc phe duyet (C3, D2)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

-- Vế `NEW.status IN (...)` là chỗ cạnh `BAFO_CLOSED->BAFO_UNSEALED` được canh. Trigger CŨ chỉ nổ
-- ở `UNSEALED`, nên không có dòng này thì cạnh mới đi qua mà không ai đòi một yêu cầu nào.
DROP TRIGGER rfq_packages_kiem_yeu_cau_mo_thau ON rfq_packages;
CREATE TRIGGER rfq_packages_kiem_yeu_cau_mo_thau
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (NEW.status IN ('UNSEALED', 'BAFO_UNSEALED') AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.rfq_kiem_yeu_cau_mo_thau();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_yeu_cau_mo_thau;

-- ============================================================================================
-- (9) C5 — DANH SÁCH TRẠNG THÁI *"ĐÃ ĐI QUA CỬA OPEN"*
-- ============================================================================================
-- Hàm này khai BỐN trạng thái là *"toàn bộ tập tới được từ `PENDING_APPROVAL` mà đường đi bắt
-- buộc qua `OPEN`"*. Ba trạng thái BAFO cũng nằm trong tập ấy, nên lời khai kia THIU ngay khi
-- mục (2) chạy — và nó thiu theo hướng SIẾT: một giao dịch đi trọn máy trạng thái rồi commit sẽ
-- bị từ chối vì một lý do KHÔNG liên quan gì tới C5. Đó đúng là lớp lỗi mà chú thích bên trong
-- chính hàm này kể lại (sáu test đỏ ở `rfq.int.test.ts` vì bản đầu viết `IS DISTINCT FROM 'OPEN'`).
CREATE OR REPLACE FUNCTION public.rfq_khoa_phai_di_kem_lan_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- MỘT TẬP, KHÔNG PHẢI MỘT GIÁ TRỊ — và bản đầu viết `IS DISTINCT FROM 'OPEN'` là SAI.
  -- Phát hiện bằng phép đo, không bằng suy luận: `packages/rfq/src/rfq.int.test.ts` có nhiều
  -- giao dịch mở RFQ RỒI ĐÓNG NGAY trong cùng một `withTenant`, nên tại COMMIT trạng thái là
  -- `CLOSED` chứ không phải `OPEN`, và sáu test đỏ vì một lý do KHÔNG liên quan gì tới C5.
  -- Điều cần đòi là RFQ đã đi QUA cửa OPEN, không phải nó đang ĐỨNG ở đó. Bảy trạng thái dưới
  -- đây là toàn bộ tập tới được từ `PENDING_APPROVAL` mà đường đi bắt buộc qua `OPEN` — hai
  -- trạng thái còn lại (`PENDING_APPROVAL`, `CANCELLED`) đều nghĩa là cặp khoá này mồ côi.
  -- [S1.108 / S2.5] Ba trạng thái BAFO được thêm cùng mục (2): chúng chỉ tới được qua `OPEN`,
  -- nên để chúng ngoài danh sách là để lời khai HẸP hơn máy trạng thái.
  IF trang_thai NOT IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING',
                        'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED') THEN
    RAISE EXCEPTION
      'Sinh khoa cho RFQ % ma khong mo no trong cung giao dich (dang o %) (C5)',
      NEW.rfq_id, trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$ham$;

-- ============================================================================================
-- (10) MÃ QUYỀN `rfq.bafo.open` — MỘT VAI, VÀ ĐÓ LÀ CẢ QUYẾT ĐỊNH
-- ============================================================================================
-- Mở một vòng BAFO là hành động DUY NHẤT của sản phẩm mà người bấm ĐÃ BIẾT giá của mọi người
-- (spec §8.1). Nếu nó đi qua `evaluation.perform` thì NĂM trên SÁU vai mở được — khoản **220** đã
-- đo con số ấy — và `BUYER` trong số đó còn giữ cả `rfq.create`, nên một người tự tạo gói, tự
-- chấm, rồi tự mời lại top-N.
--
-- Chủ dự án chọn một mã RIÊNG, và chỉ `PROCUREMENT_MANAGER`. Nó nói được một điều mà `rfq.invite`
-- không nói: mời SAU khi đã biết giá là một quyền khác với mời lúc chưa biết gì.
--
-- D3 KHÔNG đổi: `kiem_tra_ma_tran_quyen` (005) nổ khi một vai giữ CẢ NĂM mã của chuỗi
-- `rfq.create → rfq.invite → rfq.unseal → award.recommend → po.approve`, và mã mới không nằm
-- trong chuỗi ấy. `PROCUREMENT_MANAGER` vẫn bốn trên năm.
INSERT INTO permissions (code, description) VALUES
  ('rfq.bafo.open', 'Mở một vòng BAFO sau khi đã chấm');

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('PROCUREMENT_MANAGER', 'rfq.bafo.open');

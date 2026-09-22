-- ==============================================================================================
-- 061 — TRAO THẦU: TRẠNG THÁI THỨ MƯỜI MỘT, HAI CẠNH, VÀ BA BẤT BIẾN SỐNG TRONG TRIGGER
--
-- [S1.110 / S2.6] Spec S2 §4.2 khai hai bảng (`rfq_awards`, `rfq_award_approvals`) và §5 khai ba
-- bất biến mới — **J3** (người đề xuất ≠ mọi người duyệt, và bộ ba *tạo · điều phối · đề xuất*
-- không được là một người), **J5** (award chỉ trỏ tới một báo giá CÒN HỢP LỆ của chính RFQ ấy, và
-- báo giá ấy phải có `effective_cost` đọc được), **J7** (một RFQ có tối đa MỘT award còn sống).
--
-- ---------------------------------------------------------------------------------------------
-- BA PHÁT HIỆN CỦA LƯỢT SOI HÌNH DẠNG, ĐO TRƯỚC DÒNG MÃ ĐẦU
-- ---------------------------------------------------------------------------------------------
--   ⑴ **J3 KHÔNG thấy người điều phối lần ĐẦU sau một lần điều phối lại**, và khoản 208 đóng mà
--     KHÔNG vá điều đó. ADR-051 ghi phần chênh ấy và đặt cược rằng khoản 208 sẽ *"đổi ngữ nghĩa
--     của `dispatched_by`"*; đo được: bản vá S1.103 ghi cặp cũ vào PAYLOAD hàng sổ
--     `UNSEAL_REDISPATCHED`, không vào một cột, và `packages/unseal/src/requests.ts:554` cùng
--     `:620` vẫn ĐÈ `dispatched_by`. Chủ dự án chọn NHẬN lỗ và ghi thành khoản — mục (5) khai
--     phạm vi thật của J3 ngay trong thân trigger, không trong một ghi chú lịch sự.
--
--   ⑵ **`AWARDED` chạm SÁU ràng buộc `CHECK`, không bốn** — khoản 226 khai bốn. Chạy đúng câu mà
--     khoản ấy ghi sẵn (`pg_constraint`, không đọc tệp) trên một cụm thật: sáu trong bảy liệt kê
--     một TẬP trạng thái. Hai trong sáu thiếu thì `migrate()` ĐỎ; hai thì ràng buộc YẾU ĐI trong
--     im lặng; một là tập đóng. Mục (1) sửa NĂM, và hai ca miễn trừ được ghi kèm LÝ DO ĐÚNG.
--
--   ⑶ **`AWARDED` sẽ là trạng thái HÚT thứ BA** nếu chỉ thêm `EVALUATING->AWARDED`. Chủ dự án
--     chốt ngày 2026-09-22 (§8.3): thêm **`AWARDED->EVALUATING`**, và `AWARDED` nghĩa là *đang có
--     một award CÒN SỐNG* — không phải *đã từng trao thầu*. Nhờ nghĩa ấy, trạng thái RFQ là ẢNH
--     của hàng award mới nhất, nên J7 và máy trạng thái đọc CÙNG một sự thật.
--
-- ---------------------------------------------------------------------------------------------
-- CHỈ-GHI-THÊM, VÀ VÌ SAO NÓ ĐỔI HÌNH DẠNG CỦA J7
-- ---------------------------------------------------------------------------------------------
-- §2.3⑹ (ADR-050) chốt `rfq_awards` là bảng CHỈ-GHI-THÊM: huỷ là một HÀNG TRẠNG THÁI MỚI, không
-- một `UPDATE`. Nên J7 KHÔNG cưỡng chế được bằng một chỉ mục `UNIQUE` bộ phận — hàng `PROPOSED`
-- cũ vẫn khớp mọi vị từ bộ phận sau khi đã huỷ. Nó cưỡng chế bằng một trigger đọc hàng MỚI NHẤT
-- của `(org_id, rfq_id)`, khuôn `unseal_dieu_phoi_mot_lan` (022).
--
-- Chuỗi hợp lệ, và nó là toàn bộ nội dung của mục (6):
--
--     (chưa có hàng nào) --PROPOSED--> PROPOSED --APPROVED--> APPROVED
--                                          |                      |
--                                      CANCELLED <-----------------
--                                          |
--                                      PROPOSED  (đề xuất lại sau khi huỷ)
--
-- MỘT chữ ký duyệt, đúng §7 (*"một người ĐỀ XUẤT kèm lý do, một người KHÁC phê duyệt"*) — chốt
-- ngày 2026-09-22. Hai `UNIQUE` của khuôn `unseal_approvals` giữ nguyên (một người một lần, một
-- phiên một lần), nên nâng lên hai chữ ký sau này chỉ đổi MỘT con số ở mục (6).
-- ==============================================================================================

-- ============================================================================================
-- (1) `AWARDED` VÀO TẬP ĐÓNG, VÀ NĂM RÀNG BUỘC ĐƯỢC DỰNG LẠI
-- ============================================================================================
-- Đo trước khi sửa, bằng chính câu mà khoản 226 ghi sẵn:
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.rfq_packages'::regclass AND contype = 'c'
--      AND pg_get_constraintdef(oid) LIKE '%status%';
--
-- BẢY hàng. SÁU liệt kê một TẬP trạng thái, và chúng KHÔNG cùng một tập — bốn ràng buộc mốc liệt
-- kê những TẬP CON đúng theo nghĩa của chúng, nên *"mọi CHECK phải liệt kê đúng `RFQ_STATUSES`"*
-- (hình dạng mà khoản 226 đề xuất) là một lời khai SAI với bốn trong sáu. Cổng đúng nằm ở
-- `db/migrations.int.test.ts` — xem mục cuối tệp này.
--
--   | ràng buộc                              | trạng thái | sửa?                                 |
--   |----------------------------------------|-----------|--------------------------------------|
--   | rfq_packages_status_check              | 10        | BẮT BUỘC — tập đóng                  |
--   | rfq_chua_mo_thi_khong_co_moc_mo        |  8        | BẮT BUỘC — thiếu thì migrate() ĐỎ    |
--   | rfq_chua_dong_thi_khong_co_moc_dong    |  7        | BẮT BUỘC — thiếu thì migrate() ĐỎ    |
--   | rfq_da_mo_thi_co_moc_mo                |  7        | NÊN — thiếu thì YẾU trong im lặng    |
--   | rfq_da_dong_thi_co_moc_dong            |  6        | NÊN — cùng vế                        |
--   | rfq_deadline_bat_buoc_sau_draft        |  2        | KHÔNG — xem lý do ngay dưới          |
--   | rfq_huy_thi_co_moc_huy                 |  1        | KHÔNG — song điều kiện trên CANCELLED|
--
-- HAI CA MIỄN TRỪ, VÀ LÝ DO Ở ĐÂY KHÁC LÝ DO KHOẢN 226 GHI. Khoản ấy khai cả hai *"nói về MỘT
-- trạng thái"*; `rfq_deadline_bat_buoc_sau_draft` nói về HAI (`DRAFT` và `CANCELLED`). Lý do thật
-- để miễn nó là CHIỀU của vị từ: nó đọc *"chỉ DRAFT và CANCELLED được phép KHÔNG có deadline"*,
-- nên một trạng thái MỚI tự động bị ĐÒI phải có `deadline_at` — fail-closed đúng chiều, và
-- `AWARDED` thì luôn có (nó đi qua `OPEN`). Một cổng dựng trên lý do SAI sẽ miễn nhầm ca ngược.

ALTER TABLE rfq_packages DROP CONSTRAINT rfq_packages_status_check;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_packages_status_check
  CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING',
                    'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED', 'AWARDED', 'CANCELLED'));

ALTER TABLE rfq_packages DROP CONSTRAINT rfq_da_mo_thi_co_moc_mo;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_da_mo_thi_co_moc_mo
  CHECK (status NOT IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING',
                        'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED', 'AWARDED')
         OR opened_at IS NOT NULL);

ALTER TABLE rfq_packages DROP CONSTRAINT rfq_da_dong_thi_co_moc_dong;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_da_dong_thi_co_moc_dong
  CHECK (status NOT IN ('CLOSED', 'UNSEALED', 'EVALUATING',
                        'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED', 'AWARDED')
         OR closed_at IS NOT NULL);

ALTER TABLE rfq_packages DROP CONSTRAINT rfq_chua_mo_thi_khong_co_moc_mo;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_chua_mo_thi_khong_co_moc_mo
  CHECK (status IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING',
                    'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED', 'AWARDED', 'CANCELLED')
         OR opened_at IS NULL);

ALTER TABLE rfq_packages DROP CONSTRAINT rfq_chua_dong_thi_khong_co_moc_dong;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_chua_dong_thi_khong_co_moc_dong
  CHECK (status IN ('CLOSED', 'UNSEALED', 'EVALUATING',
                    'BAFO_OPEN', 'BAFO_CLOSED', 'BAFO_UNSEALED', 'AWARDED', 'CANCELLED')
         OR closed_at IS NULL);

-- ============================================================================================
-- (2) HAI CẠNH MỚI — VÀ VÌ SAO ĐÚNG HAI
-- ============================================================================================
-- `EVALUATING->AWARDED` là cạnh mà spec §4.3 khai từ đầu. `AWARDED->EVALUATING` là quyết định của
-- chủ dự án ngày 2026-09-22 (§8.3): nó làm `AWARDED` nghĩa là *đang có một award còn sống*, nên
-- khi award bị huỷ thì RFQ có đường về và một award MỚI đi lại đúng cạnh cũ.
--
-- `AWARDED->CANCELLED` KHÔNG thêm, và đó là cùng chỗ im lặng mà `059` đã chọn cho
-- `BAFO_CLOSED`/`BAFO_UNSEALED`: huỷ một gói thầu SAU khi giá đã lộ là câu hỏi nghiệp vụ mà khoản
-- **225** đang giữ. Nay nó gánh BA cặp cạnh chứ không hai, và ngày nào được quyết thì cả ba cùng
-- đổi. Có một ca ghim đúng vế ấy cộng đối chứng dương.
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
-- (3) `rfq_awards` — CHỈ-GHI-THÊM, MỖI HÀNG LÀ MỘT SỰ KIỆN TRẠNG THÁI
-- ============================================================================================
-- Khoá ngoại hợp thành tới `rfq_evaluation_lines` là vế CẤU TRÚC của **J5**, và nó chọn được vì
-- `057` đã dựng `UNIQUE (org_id, evaluation_id, bid_version_id)` — đo trên cụm thật, không đoán.
-- Trỏ tới `vendor_bid_versions` rồi KIỂM `effective_cost` bằng trigger là lớp YẾU HƠN: sau một
-- vòng BAFO có HAI lượt chấm, nên câu *"báo giá này có `effective_cost`"* có hai câu trả lời và
-- một trigger phải tự chọn lượt nào. Khoá ngoại này buộc award nói ra nó dựa trên lượt chấm NÀO.
--
-- `reason` BẮT BUỘC ở MỌI hàng, kể cả hàng huỷ — spec §4.2 đòi nó cho đề xuất, và một lần huỷ
-- không có lý do là đúng thứ D5 tồn tại để cấm.
CREATE TABLE rfq_awards (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  rfq_id              uuid NOT NULL,
  evaluation_id       uuid NOT NULL,
  bid_version_id      uuid NOT NULL,
  status              text NOT NULL CHECK (status IN ('PROPOSED', 'APPROVED', 'CANCELLED')),
  reason              text NOT NULL CHECK (btrim(reason) <> ''),
  -- [ADR-016] Danh tính là DẪN XUẤT — hai cột này đi qua `kiem_danh_tinh_theo_phien` (013).
  acted_by            uuid NOT NULL,
  acted_by_session_id uuid NOT NULL,
  acted_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  -- Vế CẤU TRÚC của J5: báo giá được chọn phải có một HÀNG XẾP HẠNG ở đúng lượt chấm được trỏ tới.
  FOREIGN KEY (org_id, evaluation_id, bid_version_id)
    REFERENCES rfq_evaluation_lines (org_id, evaluation_id, bid_version_id),
  FOREIGN KEY (org_id, acted_by) REFERENCES users (org_id, id),
  -- Tiền đề cho khoá ngoại hợp thành của `rfq_award_approvals`.
  UNIQUE (org_id, id)
);

CREATE INDEX rfq_awards_theo_goi_thau ON rfq_awards (org_id, rfq_id, acted_at DESC, id DESC);

ALTER TABLE rfq_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_awards FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_awards_tenant_isolation ON rfq_awards
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` phải TỰ mang policy khách. ĐÓNG HẲN, và đây là một quyết định:
-- một nhà cung cấp biết mình THẮNG trước khi người mua công bố là một tin có giá; và biết ai
-- thắng khi mình thua thì càng. Ngày nào sản phẩm có màn *"kết quả"* cho nhà cung cấp thì nới nó
-- là một quyết định có dữ liệu để trả lời, như `060` đã làm cho `rfq_bafo_rounds`.
CREATE POLICY rfq_awards_khach ON rfq_awards AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `id` KHÔNG được cấp (cùng lý do `INV-H14` với `rfq_evaluations`/`rfq_bafo_rounds`: `pkey` là
-- `(id)`, nên một `GRANT INSERT` mức BẢNG biến `duplicate key` thành một oracle xuyên tổ chức).
-- KHÔNG có `UPDATE` và KHÔNG có `DELETE` cho vai nào: bảng chỉ-ghi-thêm.
GRANT SELECT ON rfq_awards TO app_api;
GRANT INSERT (org_id, rfq_id, evaluation_id, bid_version_id, status, reason,
              acted_by, acted_by_session_id)
  ON rfq_awards TO app_api;

CREATE TRIGGER rfq_awards_kiem_danh_tinh
  BEFORE INSERT ON rfq_awards
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'acted_by', 'acted_by_session_id');
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_danh_tinh;

-- Chỉ ghi thêm, chặn cả superuser — cùng hàm đã dùng cho hai bảng báo giá ở `018` và cho bản rõ
-- ở `019`. Nó là tiền đề của §2.3⑹: nếu `UPDATE` đi được thì *"huỷ là một hàng mới"* chỉ là một
-- quy ước của ứng dụng, không một tính chất của dữ liệu.
CREATE TRIGGER rfq_awards_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_awards
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_chi_ghi_them;

-- ...VÀ MỘT CHỐT `TRUNCATE` RIÊNG, vì trigger cấp HÀNG không bao giờ chạy cho `TRUNCATE`.
-- Khuôn `047`, và lý do ở đó là một phép ĐO: `TRUNCATE public.vendor_bid_versions` đi LỌT trong
-- khi `UPDATE` và `DELETE` đều bị chặn — một câu lệnh xoá sạch bảng chỉ-ghi-thêm. Mục hardening
-- *"trạng thái vật lý của bảng CHỈ-GHI-THÊM"* suy chủ thể từ TÍNH CHẤT, nên nó bắt hai bảng này
-- ngay ở lượt `migrate()` đầu của vòng — và nó đã bắt.
-- `FOR EACH STATEMENT`, và KHÔNG có `WHEN`: khoản nợ **79** đo được rằng `WHEN (false)` trên một
-- trigger TRUNCATE cấp câu lệnh là HỢP LỆ với PostgreSQL 16 và `TRUNCATE` đi lọt — một chốt có
-- `WHEN` không phải một chốt.
CREATE TRIGGER rfq_awards_chan_truncate
  BEFORE TRUNCATE ON rfq_awards
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_chan_truncate;

-- ============================================================================================
-- (4) `rfq_award_approvals` — KHUÔN `unseal_approvals`, ĐO CHỨ KHÔNG CHÉP THEO KÝ ỨC
-- ============================================================================================
-- Đo trên cụm thật: `unseal_approvals` có SÁU ràng buộc, trong đó hai `UNIQUE` là khuôn phải chép
-- — `(org_id, unseal_request_id, approver_user_id)` và `(org_id, unseal_request_id,
-- approver_session_id)`. Hai dòng ấy KHÔNG thừa nhau, và `019` đã ghi vì sao: dòng trên chặn
-- *một người, hai phiên*; dòng dưới chặn *hai `approver_user_id` khác nhau, cùng một phiên*.
CREATE TABLE rfq_award_approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  -- Hàng `PROPOSED` được duyệt. KHÔNG phải `rfq_id`: một RFQ có thể có nhiều đề xuất theo thời
  -- gian (đề xuất → huỷ → đề xuất lại), và một chữ ký thuộc về ĐÚNG MỘT đề xuất.
  award_id            uuid NOT NULL,
  approver_user_id    uuid NOT NULL,
  approver_session_id uuid NOT NULL,
  approved_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, award_id) REFERENCES rfq_awards (org_id, id),
  FOREIGN KEY (org_id, approver_user_id) REFERENCES users (org_id, id),
  UNIQUE (org_id, award_id, approver_user_id),
  UNIQUE (org_id, award_id, approver_session_id)
);

ALTER TABLE rfq_award_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_award_approvals FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_award_approvals_tenant_isolation ON rfq_award_approvals
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

CREATE POLICY rfq_award_approvals_khach ON rfq_award_approvals AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON rfq_award_approvals TO app_api;
GRANT INSERT (org_id, award_id, approver_user_id, approver_session_id)
  ON rfq_award_approvals TO app_api;

CREATE TRIGGER rfq_award_approvals_kiem_danh_tinh
  BEFORE INSERT ON rfq_award_approvals
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'approver_user_id', 'approver_session_id');
ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_kiem_danh_tinh;

CREATE TRIGGER rfq_award_approvals_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_award_approvals
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_chi_ghi_them;

-- ...VÀ MỘT CHỐT `TRUNCATE` RIÊNG, vì trigger cấp HÀNG không bao giờ chạy cho `TRUNCATE`.
-- Khuôn `047`, và lý do ở đó là một phép ĐO: `TRUNCATE public.vendor_bid_versions` đi LỌT trong
-- khi `UPDATE` và `DELETE` đều bị chặn — một câu lệnh xoá sạch bảng chỉ-ghi-thêm. Mục hardening
-- *"trạng thái vật lý của bảng CHỈ-GHI-THÊM"* suy chủ thể từ TÍNH CHẤT, nên nó bắt hai bảng này
-- ngay ở lượt `migrate()` đầu của vòng — và nó đã bắt.
-- `FOR EACH STATEMENT`, và KHÔNG có `WHEN`: khoản nợ **79** đo được rằng `WHEN (false)` trên một
-- trigger TRUNCATE cấp câu lệnh là HỢP LỆ với PostgreSQL 16 và `TRUNCATE` đi lọt — một chốt có
-- `WHEN` không phải một chốt.
CREATE TRIGGER rfq_award_approvals_chan_truncate
  BEFORE TRUNCATE ON rfq_award_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_chan_truncate;

-- ============================================================================================
-- (5) **J3** — NGƯỜI ĐỀ XUẤT KHÔNG ĐƯỢC LÀ NGƯỜI TẠO RFQ HAY NGƯỜI ĐIỀU PHỐI MỞ THẦU
-- ============================================================================================
-- ADR-051: J3 cưỡng chế theo HÀNH VI ĐÃ XẢY RA trên từng gói thầu, không theo quyền được cấp.
-- Lớp vai trò hỏi *"người này ĐƯỢC PHÉP làm cả ba việc không"*; trigger hỏi *"người này ĐÃ LÀM cả
-- ba việc trên gói thầu NÀY chưa"* — và `PROCUREMENT_MANAGER` giữ BỐN trên năm mắt xích của D3
-- nên chuỗi D3 hiện có KHÔNG phủ bộ ba của J3.
--
-- ------------------------------------------------------------------------------------------
-- PHẠM VI THẬT CỦA VẾ *ĐIỀU PHỐI*, VIẾT NGAY Ở ĐÂY VÌ ĐÂY LÀ CHỖ NGƯỜI ĐỌC SẼ TÌM
-- ------------------------------------------------------------------------------------------
-- `unseal_requests.dispatched_by` mang người của lần điều phối **ĐANG CHẠY**, không phải người
-- của lần ĐẦU: `054` cho điều phối lại sau khi một lần thử chết, và
-- `packages/unseal/src/requests.ts:554` cùng `:620` ĐÈ cột ấy.
--
-- Nên trigger này KHÔNG thấy người điều phối lần đầu sau một lần điều phối lại, và kịch bản đi
-- được là: A điều phối → worker chết → B điều phối lại → **A đề xuất trao thầu và ĐI QUA**.
--
-- ADR-051 đã ghi phần chênh ấy và đặt cược rằng khoản **208** sẽ đổi ngữ nghĩa của cột; đo được
-- rằng khoản 208 ĐÓNG ở S1.103 bằng cách ghi cặp cũ vào PAYLOAD hàng sổ, **không** vào một cột.
-- Chủ dự án chọn NHẬN lỗ ngày 2026-09-22, và nó là khoản nợ **233** — ba hình dạng đóng đã được
-- cân, và ô J3 khai phạm vi hẹp hơn mệnh đề chứ không khai đã trọn.
CREATE OR REPLACE FUNCTION public.award_kiem_de_xuat() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  nguoi_dieu_phoi uuid;
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

  -- [J3 vế 3] ...và người ĐIỀU PHỐI mở thầu cũng không. Xem khối phạm vi ở trên: cột này mang
  -- người của lần điều phối ĐANG CHẠY, nên vế này không phủ đường điều phối lại (khoản 233).
  SELECT r.dispatched_by INTO nguoi_dieu_phoi
    FROM public.unseal_requests r
   WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND r.dispatched_by IS NOT NULL
   ORDER BY r.requested_at DESC
   LIMIT 1;
  IF nguoi_dieu_phoi IS NOT NULL AND nguoi_dieu_phoi OPERATOR(pg_catalog.=) NEW.acted_by THEN
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

-- ============================================================================================
-- (6) **J7** — MỘT RFQ CÓ TỐI ĐA MỘT AWARD CÒN SỐNG, VÀ CHUỖI TRẠNG THÁI CHỈ ĐI MỘT CHIỀU
-- ============================================================================================
-- Khuôn `unseal_dieu_phoi_mot_lan` (022): đọc hàng MỚI NHẤT, không một chỉ mục bộ phận. ADR-050
-- §2.3⑹ đã đo vì sao chỉ mục bộ phận là SAI ở đây — trên một bảng chỉ-ghi-thêm, hàng `PROPOSED`
-- cũ vẫn khớp mọi vị từ bộ phận sau khi đã huỷ.
--
-- `pg_advisory_xact_lock` theo GÓI THẦU, khuôn `bafo_kiem_vong` (`059`): `app_api` không có
-- `UPDATE` trên bảng này nên một khoá HÀNG là bất khả, và `SECURITY DEFINER` thì mục (C) của
-- hardening cấm. Không có khoá ấy, hai giao dịch cùng đọc *"chưa có award nào"* rồi cùng chèn.
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
    -- MỘT chữ ký, đúng §7 — chốt ngày 2026-09-22. Đổi `CHU_KY_CAN` là toàn bộ việc phải làm nếu
    -- ngày nào chủ dự án chọn hai.
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

CREATE TRIGGER rfq_awards_kiem_de_xuat
  BEFORE INSERT ON rfq_awards
  FOR EACH ROW EXECUTE FUNCTION public.award_kiem_de_xuat();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_de_xuat;

-- Tên chọn để sắp SAU `rfq_awards_kiem_de_xuat` theo thứ tự chữ cái (`m` > `d`): phép kiểm J7
-- đọc hàng mới nhất và lấy khoá tư vấn, nên nó phải chạy sau khi J3/J5 đã loại hàng sai hình
-- dạng. Cùng thủ pháp mà `059` dùng cho `vendor_bid_versions_kiem_vong_bafo`, và cũng có một ca
-- đọc `pg_trigger` đòi đúng thứ tự ấy.
CREATE TRIGGER rfq_awards_kiem_mot_award_song
  BEFORE INSERT ON rfq_awards
  FOR EACH ROW EXECUTE FUNCTION public.award_kiem_mot_award_song();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_mot_award_song;

-- ============================================================================================
-- (7) **J3 vế 1** — NGƯỜI DUYỆT KHÔNG ĐƯỢC LÀ NGƯỜI ĐỀ XUẤT
-- ============================================================================================
-- Khuôn `unseal_kiem_nguoi_duyet` (019): một vế D3 sống trong một trigger đọc hàng. Hai `UNIQUE`
-- của mục (4) chặn *một người duyệt hai lần*; vế này chặn *người đề xuất tự duyệt*, và chúng là
-- hai ca khác nhau.
CREATE OR REPLACE FUNCTION public.award_kiem_nguoi_duyet() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_de_xuat uuid;
  phien_de_xuat uuid;
  trang_thai text;
BEGIN
  SELECT a.acted_by, a.acted_by_session_id, a.status
    INTO nguoi_de_xuat, phien_de_xuat, trang_thai
    FROM public.rfq_awards a
   WHERE a.id OPERATOR(pg_catalog.=) NEW.award_id
     AND a.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay de xuat trao thau %', NEW.award_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Chữ ký chỉ đặt được lên một hàng ĐỀ XUẤT. Không có vế này, một hàng `APPROVED` hay
  -- `CANCELLED` cũng nhận được chữ ký, và phép đếm ở mục (6) đọc một tập lẫn lộn.
  IF trang_thai IS DISTINCT FROM 'PROPOSED' THEN
    RAISE EXCEPTION 'Chi duyet duoc mot hang PROPOSED; hang % dang o %', NEW.award_id, trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF nguoi_de_xuat OPERATOR(pg_catalog.=) NEW.approver_user_id THEN
    RAISE EXCEPTION 'Nguoi de xuat trao thau khong duoc tu duyet (J3)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ...và cũng không bằng một PHIÊN khác của cùng con người. `kiem_danh_tinh_theo_phien` đã buộc
  -- cặp người-phiên của hàng này là DẪN XUẤT, nên so phiên ở đây bắt được ca hai phiên một người
  -- mà vế trên đã bắt, VÀ ca một phiên khai hai người mà vế trên không thấy.
  IF phien_de_xuat OPERATOR(pg_catalog.=) NEW.approver_session_id THEN
    RAISE EXCEPTION 'Phien da de xuat trao thau khong duoc dung de duyet (J3)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_award_approvals_kiem_nguoi_duyet
  BEFORE INSERT ON rfq_award_approvals
  FOR EACH ROW EXECUTE FUNCTION public.award_kiem_nguoi_duyet();
ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_kiem_nguoi_duyet;

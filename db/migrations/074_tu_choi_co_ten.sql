-- =============================================================================================
-- `074_tu_choi_co_ten.sql` — [S1.176 / khoản 247 / ADR-107] MỌI LẦN TỪ CHỐI CỦA TRIGGER MÀ TẦNG GÓI GHI SỔ ĐỀU MANG TÊN
-- =============================================================================================
-- ADR-104 (S1.167) cho tầng gói bắt CHÍNH lỗi của trigger rồi ghi sổ — trigger vẫn là lớp có thẩm quyền, và ca hai người
-- đua nhau cũng vào sổ. Nhưng nó nhận ra lần vi phạm bằng THÔNG ĐIỆP: SQLSTATE 23514 cộng hậu tố *"(J3)"* / *"(D2"* và đầu
-- câu của từng vế; phía nộp thì bằng không gì cả — mọi 23514 không vì hạn. Đổi một câu `RAISE` mà quên hậu tố là lần vi phạm
-- rơi về đường cũ, im lặng.
--
-- SỬA: mỗi nhánh mà tầng gói ghi sổ mang một TÊN RÀNG BUỘC — khuôn `c1_qua_han_nop` của `066`. Tầng gói đọc trường
-- `constraint` của lỗi, tra bảng tên → mã, và ghi `CONTROL_DENIED` (J3/D2, bảng `CHOT_VAO_SO` ở `packages/identity`) hay
-- `BID_STATE_DENIED` (câu nộp, `packages/bidding`) mang MÃ. Chủ dự án chốt ngày 2026-09-27: đặt tên HẾT các nhánh ADR-104 đang
-- ghi, không bớt nhánh nào.
--
--   rfq_kiem_nguoi_duyet   (011)  d2_nguoi_tao_tu_duyet · d2_phien_khong_hop_le · d2_phien_nguoi_khac
--   award_kiem_de_xuat     (064)  j3_nguoi_tao_de_xuat · j3_nguoi_dieu_phoi_de_xuat
--   award_kiem_nguoi_duyet (061)  j3_nguoi_de_xuat_tu_duyet · j3_phien_de_xuat_duyet
--   bid_kiem_han_nop       (066)  c1_goi_khong_nhan_bao_gia · c1_khong_vong_bafo_dang_mo · c1_khong_han_nop
--   bid_kiem_phien_khach   (018)  phien_khach_khong_hop_le · phien_khach_khac_loi_moi
--   bid_kiem_vong_bafo     (059)  bafo_ngoai_top_n
--
-- Nhánh KHÔNG tên thì tầng gói không ghi: không tìm thấy hàng cha, gói không ở `PENDING_APPROVAL`, đề xuất không còn
-- `PROPOSED`, hai vế J5 — đúng tập ADR-104 đã để ngoài.
--
-- Thân sáu hàm TRÍCH NGUYÊN VĂN từ migration cuối định nghĩa mỗi hàm bằng script, rồi đổi đúng một chỗ ở mỗi nhánh kể trên
-- (thêm `CONSTRAINT`). Thông điệp của CSDL không đổi. Bản ghim ở `hardening.always.sql` đổi cùng commit; script đối chiếu bản
-- ghim cũ với thân cũ trước khi thay. Không đổi trigger nào: `CREATE OR REPLACE FUNCTION` giữ nguyên trigger trỏ vào hàm.
-- =============================================================================================

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
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'd2_nguoi_tao_tu_duyet';
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
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'd2_phien_khong_hop_le';
  END IF;

  IF chu_phien IS DISTINCT FROM NEW.approver_user_id THEN
    RAISE EXCEPTION 'Phien duoc dan ra khong thuoc ve nguoi duyet (D2)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'd2_phien_nguoi_khac';
  END IF;

  -- [C-1] Chữ ký MANG nội dung nó ký. Bên gọi không khai được cột này (không có GRANT INSERT).
  NEW.approved_content_hash := public.rfq_bam_noi_dung(NEW.rfq_id);

  RETURN NEW;
END
$ham$;

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
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'j3_nguoi_tao_de_xuat';
  END IF;

  -- [J3 vế 3] ...và người TỪNG ĐIỀU PHỐI mở thầu cũng không — mọi lần, kể cả lần đã bị điều phối
  -- lại đè lên (khoản 233, `064`). Đọc bảng lịch sử, không đọc `unseal_requests.dispatched_by`.
  IF EXISTS (SELECT 1 FROM public.unseal_dispatch_history h
              WHERE h.org_id OPERATOR(pg_catalog.=) NEW.org_id
                AND h.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
                AND h.dispatched_by OPERATOR(pg_catalog.=) NEW.acted_by) THEN
    RAISE EXCEPTION
      'Nguoi dieu phoi mo thau khong duoc de xuat trao thau cho chinh goi ay (J3)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'j3_nguoi_dieu_phoi_de_xuat';
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
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'j3_nguoi_de_xuat_tu_duyet';
  END IF;

  -- ...và cũng không bằng một PHIÊN khác của cùng con người. `kiem_danh_tinh_theo_phien` đã buộc
  -- cặp người-phiên của hàng này là DẪN XUẤT, nên so phiên ở đây bắt được ca hai phiên một người
  -- mà vế trên đã bắt, VÀ ca một phiên khai hai người mà vế trên không thấy.
  IF phien_de_xuat OPERATOR(pg_catalog.=) NEW.approver_session_id THEN
    RAISE EXCEPTION 'Phien da de xuat trao thau khong duoc dung de duyet (J3)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'j3_phien_de_xuat_duyet';
  END IF;

  RETURN NEW;
END
$ham$;

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
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'c1_goi_khong_nhan_bao_gia';
  END IF;

  IF trang_thai OPERATOR(pg_catalog.=) 'BAFO_OPEN' THEN
    SELECT r.id, r.deadline_at INTO vong, han
      FROM public.rfq_bafo_rounds r
     WHERE r.rfq_id OPERATOR(pg_catalog.=) goi_thau
       AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
       AND r.closed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RFQ dang BAFO_OPEN ma khong co vong BAFO nao dang mo — du lieu hong'
        USING ERRCODE = 'check_violation',
              CONSTRAINT = 'c1_khong_vong_bafo_dang_mo';
    END IF;
    -- Dấu vòng là DẪN XUẤT: bên gọi không có `INSERT` trên cột này, nên nó không khai được sai.
    NEW.bafo_round_id := vong;
  ELSE
    NEW.bafo_round_id := NULL;
  END IF;

  IF han IS NULL THEN
    RAISE EXCEPTION 'RFQ dang OPEN ma khong co han nop — du lieu hong'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'c1_khong_han_nop';
  END IF;

  IF now() OPERATOR(pg_catalog.>=) han THEN
    -- [066 / khoản 196] Hai dấu thời gian là ĐÚNG hai giá trị vừa so — xem khối đầu `066`.
    RAISE EXCEPTION 'Da qua han nop bao gia (C1)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'c1_qua_han_nop',
            DETAIL = pg_catalog.json_build_object(
              'gio_csdl', public.bid_dau_thoi_gian_chinh_tac(now()),
              'han_nop', public.bid_dau_thoi_gian_chinh_tac(han))::pg_catalog.text;
  END IF;

  RETURN NEW;
END
$ham$;

CREATE OR REPLACE FUNCTION public.bid_kiem_phien_khach() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  loi_moi_cua_phien uuid;
  loi_moi_cua_luong uuid;
BEGIN
  SELECT g.invitation_id INTO loi_moi_cua_phien
    FROM public.guest_sessions g
   WHERE g.id OPERATOR(pg_catalog.=) NEW.submitted_by_guest_session_id
     AND g.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND g.revoked_at IS NULL
     AND g.expires_at OPERATOR(pg_catalog.>) now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien khach khong hop le: khong ton tai, da thu hoi, hoac da het han'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'phien_khach_khong_hop_le';
  END IF;

  SELECT b.invitation_id INTO loi_moi_cua_luong
    FROM public.vendor_bids b
   WHERE b.id OPERATOR(pg_catalog.=) NEW.bid_id
     AND b.org_id OPERATOR(pg_catalog.=) NEW.org_id;

  IF loi_moi_cua_phien IS DISTINCT FROM loi_moi_cua_luong THEN
    RAISE EXCEPTION
      'Phien khach thuoc loi moi khac voi luong bao gia — no phai la DAN XUAT, khong phai loi khai'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'phien_khach_khac_loi_moi';
  END IF;

  RETURN NEW;
END
$ham$;

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
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'bafo_ngoai_top_n';
  END IF;

  RETURN NEW;
END
$ham$;

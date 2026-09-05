-- db/migrations/022_security_review_s1.sql
-- VÒNG SỬA SAU BỐN LƯỢT `security-reviewer` CỦA S1 — phần thuộc tầng CSDL.
--
-- ============================================================================================
-- BẢY ĐƯỜNG, VÀ MỖI ĐƯỜNG LÀ MỘT PHÁT HIỆN CÓ TÊN
-- ============================================================================================
--   (1) [S1.3 HIGH-1]  OTP và magic link so KÊNH, mà SMS với ZALO_ZNS đi CÙNG MỘT SỐ ĐIỆN THOẠI
--   (2) [S1.3 MED-3]   `rfq_invitations` thiếu trigger thu hồi một chiều — thu hồi UNDO được
--   (3) [S1.3 LOW-4]   `guest_sessions` không có UNIQUE trên `challenge_id`
--   (4) [S1.6 HIGH-2a] break-glass tới `APPROVED` với KHÔNG một nhân chứng nào ở tầng CSDL
--   (5) [S1.6 HIGH-3]  không có mốc ĐIỀU PHỐI, nên worker không kiểm lại được vế 2 của D1
--   (6) [S1.6 MED-2]   ba GRANT của `app_unseal` rộng hơn thứ worker đọc
--   (7) [S1.7 HIGH-1]  gia hạn HỒI SINH được một cửa sổ thầu ĐÃ HẾT — cạnh `CLOSED -> OPEN` mà
--                      máy trạng thái cố ý không có, đạt được bằng một đường khác
--
-- Cộng hai mục nhỏ đi kèm: (8) `bid_so_tien` chưa chặn ĐỘ LỚN, (9) chính sách mua sắm chưa chặn
-- `effective_from` lùi về quá khứ.

-- ============================================================================================
-- (1) [S1.3 HIGH-1] ADR-015 MỤC 1 SO NHÃN KÊNH; PHẢI SO **ĐÍCH ĐẾN**
-- ============================================================================================
-- `supplier_contacts` có ĐÚNG MỘT `email` và ĐÚNG MỘT `phone` (008). `issueOtpChallenge` đọc cột
-- theo kênh: `EMAIL -> email`, còn `SMS` VÀ `ZALO_ZNS` cùng đọc `phone`. Nên với một lời mời có
-- `link_channel = 'SMS'`, một thách thức `channel = 'ZALO_ZNS'` có NHÃN khác, đi qua phép so cũ
-- sạch sẽ, và tới đúng cái máy điện thoại đã nhận magic link.
--
-- Lý do ADR-015 mục 1 tồn tại, nguyên văn: *"hai yếu tố nằm trên cùng một kênh thì ai đọc được
-- kênh đó có cả hai."* Ai cầm SIM thì cầm cả hai — E2 tụt từ hai yếu tố xuống một.
--
-- 010 tự viết ở đầu file rằng một bất biến không được cưỡng chế bằng một SỰ TRÙNG HỢP. Phép so
-- nhãn ĐÚNG hôm nay chỉ vì chưa ai đặt `link_channel = 'SMS'` — tức nó cũng là một sự trùng hợp,
-- chỉ khác cái. Nay nó so LỚP ĐÍCH: hai kênh cùng đọc một cột thì cùng một lớp.
CREATE OR REPLACE FUNCTION public.otp_lop_dich(p_kenh text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT
  SET search_path = pg_catalog, public
AS $ham$
  SELECT CASE WHEN p_kenh = 'EMAIL' THEN 'HOP_THU' ELSE 'MAY_DIEN_THOAI' END
$ham$;

CREATE OR REPLACE FUNCTION public.otp_kiem_kenh_khac_link() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  kenh_link text;
  ncc_moi uuid;
  trang_thai_loi_moi text;
  loi_moi_thu_hoi timestamptz;
  ncc_cua_lien_he uuid;
  loi_moi_cua_token uuid;
  so_dang_khoa integer;
BEGIN
  -- [H1] Token là BẮT BUỘC. Không có vế này, `invitationId` — một UUIDv4 xuất hiện trong URL,
  -- payload API và sổ kiểm toán — là thứ DUY NHẤT gác cổng "ai được yêu cầu gửi OTP".
  IF NEW.token_id IS NULL OR NEW.contact_id IS NULL THEN
    RAISE EXCEPTION 'Thach thuc OTP phai mang token va nguoi lien he (C1, H1)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.link_channel, i.supplier_id, i.status, i.revoked_at
    INTO kenh_link, ncc_moi, trang_thai_loi_moi, loi_moi_thu_hoi
    FROM public.rfq_invitations i WHERE i.id = NEW.invitation_id AND i.org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay loi moi cho thach thuc OTP nay'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [C3] Thu hồi lời mời phải chạm ĐƯỜNG PHIÊN, không chỉ đường token.
  IF trang_thai_loi_moi = 'REVOKED' OR loi_moi_thu_hoi IS NOT NULL THEN
    RAISE EXCEPTION 'Loi moi da bi thu hoi (E1)' USING ERRCODE = 'check_violation';
  END IF;

  -- [H1] Token phải THUỘC VỀ chính lời mời này, còn hạn, chưa thu hồi, chưa tiêu thụ.
  SELECT t.invitation_id INTO loi_moi_cua_token
    FROM public.rfq_invitation_tokens t
   WHERE t.id = NEW.token_id AND t.org_id = NEW.org_id
     AND t.purpose = 'BID_SUBMISSION'
     AND t.expires_at > now() AND t.revoked_at IS NULL AND t.consumed_at IS NULL;
  IF NOT FOUND OR loi_moi_cua_token IS DISTINCT FROM NEW.invitation_id THEN
    RAISE EXCEPTION 'Token khong thuoc loi moi nay, hoac da het hieu luc (H1)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.supplier_id INTO ncc_cua_lien_he
    FROM public.supplier_contacts c WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id;
  IF NOT FOUND OR ncc_cua_lien_he IS DISTINCT FROM ncc_moi THEN
    RAISE EXCEPTION 'Nguoi lien he khong thuoc nha cung cap duoc moi (C1)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [S1.3 HIGH-1] ADR-015 mục 1, nay so LỚP ĐÍCH chứ không so nhãn. Xem khối trên.
  IF public.otp_lop_dich(NEW.channel) = public.otp_lop_dich(kenh_link) THEN
    RAISE EXCEPTION
      'OTP khong duoc toi cung mot dich voi magic link (ADR-015): % va % deu la %',
      NEW.channel, kenh_link, public.otp_lop_dich(NEW.channel)
      USING ERRCODE = 'check_violation';
  END IF;

  -- [H3] Khoá phải sống ở cấp LỜI MỜI.
  SELECT count(*) INTO so_dang_khoa
    FROM public.invitation_otp_challenges c
   WHERE c.invitation_id = NEW.invitation_id AND c.locked_until IS NOT NULL
     AND c.locked_until > now();
  IF so_dang_khoa > 0 THEN
    RAISE EXCEPTION 'Loi moi nay dang bi khoa vi qua nhieu lan thu sai (E3)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (2) [S1.3 MED-3] THU HỒI LỜI MỜI PHẢI MỘT CHIỀU — VÀ BẢNG NGUỒN LÀ BẢNG BỊ QUÊN
-- ============================================================================================
-- 012 §H5 gắn `thu_hoi_don_dieu` cho `rfq_invitation_tokens`, `guest_sessions` và
-- `invitation_otp_challenges` — ba bảng DẪN XUẤT. Nó bỏ sót `rfq_invitations`, bảng mà cả ba
-- bảng kia ĐỌC để quyết định: `otp_kiem_kenh_khac_link` gác trên `i.status` và `i.revoked_at`.
--
-- Hệ quả đo được từ chính các GRANT của 010: `app_api` có `UPDATE (status, revoked_at)`, và một
-- câu `SET status='SENT', revoked_at=NULL` thoả cả `rfq_invitations_thu_hoi_co_moc` (hai vế lật
-- cùng nhau) lẫn `rfq_invitations_kiem_nguoi_thu_hoi` (013, chỉ chạy ở CHIỀU BẬT). Tức một lời
-- mời đã bị giết sống lại được, và kịch bản C3 mà 012 đã đóng thì mở lại.
CREATE TRIGGER rfq_invitations_thu_hoi_don_dieu
  BEFORE UPDATE ON rfq_invitations
  FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('revoked_at');

-- `thu_hoi_don_dieu` chỉ nhìn `revoked_at`. `status` là một cột thứ hai nói cùng một điều, nên nó
-- cần một phép chặn riêng — nếu không, `SET status='SENT'` một mình vẫn đi qua trong khi
-- `revoked_at` vẫn còn.
CREATE OR REPLACE FUNCTION public.loi_moi_khong_song_lai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF OLD.status OPERATOR(pg_catalog.=) 'REVOKED'
     AND NEW.status IS DISTINCT FROM 'REVOKED' THEN
    RAISE EXCEPTION 'Loi moi da REVOKED thi khong tro lai trang thai khac duoc (E1)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_invitations_khong_song_lai
  BEFORE UPDATE ON rfq_invitations
  FOR EACH ROW EXECUTE FUNCTION public.loi_moi_khong_song_lai();

-- ============================================================================================
-- (3) [S1.3 LOW-4] MỘT THÁCH THỨC ĐÃ ĐỐI CHIẾU MỞ ĐÚNG MỘT PHIÊN
-- ============================================================================================
-- `guest_session_kiem_danh_tinh` (012) đòi thách thức ĐÃ được đối chiếu; nó không đòi thách thức
-- ấy chưa mở phiên nào. Đường ứng dụng chặn (token và thách thức đều bị tiêu thụ), nhưng 012 tự
-- đặt tầng CSDL làm tầng có thẩm quyền — nên tầng ấy phải nói được câu này.
ALTER TABLE guest_sessions ADD CONSTRAINT guest_sessions_mot_phien_moi_thach_thuc
  UNIQUE (org_id, challenge_id);

-- ============================================================================================
-- (4) [S1.6 HIGH-2a] BREAK-GLASS BỎ QUA NGƯỠNG, KHÔNG ĐƯỢC BỎ QUA NHÂN CHỨNG
-- ============================================================================================
-- `unseal_kiem_du_phe_duyet` (019) trả về ngay khi `break_glass`, `unseal_kiem_chuyen_trang_thai`
-- cho cạnh `PENDING -> APPROVED`, và `app_api` có `UPDATE (status, approved_at)`. Ba thứ ấy cộng
-- lại: MỘT câu lệnh đưa một yêu cầu break-glass tới `APPROVED` với KHÔNG một hàng phê duyệt nào,
-- rồi chính người yêu cầu điều phối được nó. Một người sở hữu trọn chuỗi.
--
-- 019 tự viết ở mục (4) rằng trigger phải giữ *"mọi đường, kể cả một câu UPDATE viết tay trong
-- một script vận hành"* — và một câu UPDATE viết tay CHÍNH LÀ cách break-glass được dùng thật.
--
-- Break-glass vẫn bỏ qua NGƯỠNG (đó là lý do nó tồn tại). Thứ nó không được bỏ qua là NHÂN
-- CHỨNG: một người thứ hai, một phiên thứ hai, ghi tên vào hàng. Đây là mức thấp nhất còn giữ
-- được D3 (*"chuỗi không nằm trọn trong tay một người"*) khi đường phê duyệt thường bị bỏ.
ALTER TABLE unseal_requests ADD COLUMN break_glass_witness_user_id uuid;
ALTER TABLE unseal_requests ADD COLUMN break_glass_witness_session_id uuid;
ALTER TABLE unseal_requests ADD CONSTRAINT unseal_requests_witness_fkey
  FOREIGN KEY (org_id, break_glass_witness_user_id) REFERENCES users (org_id, id);
GRANT INSERT (break_glass_witness_user_id, break_glass_witness_session_id)
  ON unseal_requests TO app_api;
GRANT UPDATE (break_glass_witness_user_id, break_glass_witness_session_id)
  ON unseal_requests TO app_api;

CREATE TRIGGER unseal_requests_kiem_nhan_chung
  BEFORE INSERT OR UPDATE ON unseal_requests
  FOR EACH ROW
  WHEN (NEW.break_glass_witness_user_id IS NOT NULL)
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'break_glass_witness_user_id', 'break_glass_witness_session_id');

CREATE OR REPLACE FUNCTION public.unseal_kiem_du_phe_duyet() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  can integer;
  co integer;
BEGIN
  -- [D4 + review S1.6 HIGH-2a] Break-glass KHÔNG gom phê duyệt — nhưng nó phải có NHÂN CHỨNG,
  -- và nhân chứng ấy phải là NGƯỜI KHÁC trong một PHIÊN KHÁC. Cùng đúng hai vế mà
  -- `unseal_kiem_nguoi_duyet` đòi ở đường thường.
  IF NEW.break_glass THEN
    IF NEW.break_glass_witness_user_id IS NULL
       OR NEW.break_glass_witness_session_id IS NULL THEN
      RAISE EXCEPTION 'Break-glass phai co nguoi lam chung (D3)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.break_glass_witness_user_id OPERATOR(pg_catalog.=) NEW.requested_by THEN
      RAISE EXCEPTION 'Nguoi yeu cau break-glass khong duoc tu lam chung (D3)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.break_glass_witness_session_id
       OPERATOR(pg_catalog.=) NEW.requested_by_session_id THEN
      RAISE EXCEPTION 'Nhan chung break-glass phai o mot PHIEN khac (D2)'
        USING ERRCODE = 'check_violation';
    END IF;
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

-- ============================================================================================
-- (5) [S1.6 HIGH-3 + MED-1] MỐC ĐIỀU PHỐI — ĐỂ WORKER KIỂM LẠI ĐƯỢC VẾ 2 CỦA D1
-- ============================================================================================
-- Cổng bốn vế chạy lúc ĐIỀU PHỐI; worker chạy lúc GIẢI MÃ. Giữa hai thời điểm ấy, một phiên bị
-- thu hồi hay một người bị đình chỉ KHÔNG dừng được lượt mở thầu — và mở thầu là hành động duy
-- nhất của hệ thống không thu hồi được.
--
-- Chú thích cũ ở `gate.ts` và `apps/unseal-worker` biện minh cho khoảng trống ấy bằng một câu
-- SAI: *"`app_unseal` cố ý không đọc được `users`"*. `006:232` cấp
-- `SELECT (id, org_id, status) ON users TO app_unseal` và `006:305` cấp đúng sáu cột `sessions`
-- mà `assertFreshMfa` đọc — chính 006 ghi rằng nó cấp *"vì bất biến D1"*.
--
-- Ba cột dưới đây là thứ còn thiếu để hỏi lại được: yêu cầu phải NHỚ ai đã điều phối nó.
ALTER TABLE unseal_requests ADD COLUMN dispatched_at timestamptz;
ALTER TABLE unseal_requests ADD COLUMN dispatched_by uuid;
ALTER TABLE unseal_requests ADD COLUMN dispatched_by_session_id uuid;
ALTER TABLE unseal_requests ADD CONSTRAINT unseal_requests_dispatched_by_fkey
  FOREIGN KEY (org_id, dispatched_by) REFERENCES users (org_id, id);
ALTER TABLE unseal_requests ADD CONSTRAINT unseal_requests_dieu_phoi_du_bo
  CHECK ((dispatched_at IS NULL) = (dispatched_by IS NULL)
         AND (dispatched_at IS NULL) = (dispatched_by_session_id IS NULL));
GRANT UPDATE (dispatched_at, dispatched_by, dispatched_by_session_id)
  ON unseal_requests TO app_api;

CREATE TRIGGER unseal_requests_kiem_nguoi_dieu_phoi
  BEFORE UPDATE ON unseal_requests
  FOR EACH ROW
  WHEN (NEW.dispatched_by IS NOT NULL AND OLD.dispatched_by IS NULL)
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('dispatched_by', 'dispatched_by_session_id');

-- Điều phối chỉ ghi được MỘT LẦN. Không có vế này, một lần điều phối lại sau khi phiên đã bị thu
-- hồi sẽ ĐẨY mốc tới hiện tại và làm phép kiểm ở worker luôn đúng.
CREATE OR REPLACE FUNCTION public.unseal_dieu_phoi_mot_lan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF OLD.dispatched_at IS NOT NULL
     AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN
    RAISE EXCEPTION 'dispatched_at chi dat duoc mot lan' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER unseal_requests_dieu_phoi_mot_lan
  BEFORE UPDATE ON unseal_requests
  FOR EACH ROW EXECUTE FUNCTION public.unseal_dieu_phoi_mot_lan();

-- ============================================================================================
-- (6) [S1.6 MED-2] BA GRANT RỘNG HƠN THỨ WORKER ĐỌC
-- ============================================================================================
-- `019:433-435` viết ra toàn bộ hình dạng của ADR-006 trong một câu: *"nơi duy nhất giải mã được
-- là nơi duy nhất ghi được bản rõ, và nó KHÔNG đọc lại được."* Rồi `019:465` cấp
-- `SELECT ON rfq_unsealed_bids TO app_unseal` — mâu thuẫn với chính câu ấy, cách nhau 30 dòng.
--
-- Worker KHÔNG dùng quyền đó (nó chỉ INSERT). Cái giá của việc để nó lại: một tiến trình
-- `app_unseal` bị chiếm — tiến trình DUY NHẤT có `kms:Decrypt` — đọc được HÀNG LOẠT mọi báo giá
-- đã mở của mọi RFQ, không tốn một lần mở bọc khoá nào và không để lại một dòng
-- `RFQ_KEY_MATERIAL_UNWRAPPED` nào.
REVOKE SELECT ON rfq_unsealed_bids FROM app_unseal;

-- `unseal_approvals`: worker không truy vấn bảng này một lần nào.
REVOKE SELECT ON unseal_approvals FROM app_unseal;

-- `unseal_requests`: thu từ mức BẢNG xuống đúng các cột worker đọc. `reason` bị gỡ, và đó là cột
-- đáng gỡ nhất — với break-glass, nó chính là chỗ chi tiết sự cố nằm.
REVOKE SELECT ON unseal_requests FROM app_unseal;
GRANT SELECT (id, org_id, rfq_id, status, dispatched_by, dispatched_by_session_id)
  ON unseal_requests TO app_unseal;

-- ============================================================================================
-- (7) [S1.7 HIGH-1] GIA HẠN KHÔNG ĐƯỢC HỒI SINH MỘT CỬA SỔ ĐÃ HẾT
-- ============================================================================================
-- Máy trạng thái CỐ Ý không có cạnh `CLOSED -> OPEN` (011:141-151). Nhưng vì job đóng RFQ chưa
-- được viết — chính bộ đối kháng C2 của S1.8 khẳng định điều đó — MỌI RFQ quá hạn đều đang nằm ở
-- `OPEN`. Ở trạng thái ấy, kiểm (b) của 011 chỉ so `NEW < OLD` và kiểm (c) chỉ so trạng thái;
-- KHÔNG vế nào đòi cửa sổ đang gia hạn còn SỐNG.
--
-- Nên người mua đếm số báo giá đã nhận (đường SQL viết tay mà §4 của A6 đã ghi), rồi đẩy hạn về
-- tương lai, và cửa thầu mở lại — cho cả người đã nộp lẫn người lỡ hạn. Đó đúng là hình dạng
-- thông đồng mà một hệ đấu thầu kín tồn tại để chặn, và nó đạt được mà không chạm `status`,
-- không qua phê duyệt kép, và với một quyết định ĐÃ BIẾT có bao nhiêu báo giá trong tay.
--
-- Nếu hồi sinh một cửa sổ đã hết là một nhu cầu thật, nó phải là một HÀNH VI CÓ TÊN RIÊNG, có mã
-- kiểm toán riêng và có phê duyệt riêng — không phải một tác dụng phụ của đường gia hạn.
CREATE OR REPLACE FUNCTION public.rfq_gia_han_khong_hoi_sinh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at THEN
    IF OLD.deadline_at IS NOT NULL AND OLD.deadline_at OPERATOR(pg_catalog.<=) now() THEN
      RAISE EXCEPTION 'Khong gia han duoc mot cua so thau DA HET han (C4)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.deadline_at IS NOT NULL AND NEW.deadline_at OPERATOR(pg_catalog.<=) now() THEN
      RAISE EXCEPTION 'Han nop moi phai nam o tuong lai (C4)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_gia_han_khong_hoi_sinh
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW EXECUTE FUNCTION public.rfq_gia_han_khong_hoi_sinh();

-- ============================================================================================
-- (8) [S1.7 MED-4] `bid_so_tien` CHẶN DẤU VÀ NaN, CHƯA CHẶN ĐỘ LỚN
-- ============================================================================================
-- `payload->>'totalAmount'` là chuỗi do NHÀ CUNG CẤP viết, đi qua một phong bì tới 8 MiB.
-- `'1e131071'::numeric` là một `numeric` HỢP LỆ — tám ký tự vào, một con số 131.072 chữ số ra —
-- và `::text` của nó cùng của `min`/`max`/`avg` đi thẳng vào bảng so sánh.
--
-- Mọi số tiền khác của lược đồ là `numeric(18, 2)`. Đúng con số mà người ngoài điều khiển được
-- là con số duy nhất không có trần. Đưa nó về CÙNG MIỀN với phần còn lại: quá miền thì `NULL`,
-- tức hàng vẫn nằm trong bảng so sánh, vẫn giữ nguyên `payload`, và được đếm là `unparsed`.
CREATE OR REPLACE FUNCTION public.bid_so_tien(p_van text) RETURNS numeric
  LANGUAGE plpgsql IMMUTABLE STRICT
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  n numeric;
BEGIN
  BEGIN
    n := p_van::numeric;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF n = 'NaN'::numeric OR n >= 'Infinity'::numeric OR n <= '-Infinity'::numeric THEN
    RETURN NULL;
  END IF;
  IF n < 0 THEN
    RETURN NULL;
  END IF;
  -- Cùng miền với `numeric(18, 2)`: tối đa 16 chữ số phần nguyên, tối đa 2 chữ số thập phân.
  IF n >= 10::numeric ^ 16 OR n <> round(n, 2) THEN
    RETURN NULL;
  END IF;
  RETURN n;
END
$ham$;

-- ============================================================================================
-- (9) [S1.7 MED-2] CHÍNH SÁCH MUA SẮM KHÔNG ĐƯỢC CÓ HIỆU LỰC LÙI VỀ QUÁ KHỨ
-- ============================================================================================
-- `rfq_che_do_nghiem` nhánh ⑵ chọn chính sách mới nhất có `effective_from <= rfq.created_at`, và
-- 020 khẳng định nhánh ấy *"CỐ ĐỊNH theo thời gian"*. Câu ấy đúng chỉ vì `createProcurementPolicy`
-- tình cờ không truyền `effective_from` — chứ 014 CÓ cấp `INSERT` trên cột đó, và không ràng
-- buộc nào nối nó với `created_at`. Một hàng `effective_from = now() - '1 year'` kèm
-- `strict_blind_mode = false` lật CHẾ ĐỘ NGHIÊM của mọi RFQ chưa có ngân sách, HỒI TỐ.
--
-- Cùng lúc, `version` do người gọi chọn và chỉ bị `UNIQUE` chặn trùng, không chặn TỤT. Cả hai
-- hàm chọn đều `ORDER BY version DESC`, nên một hàng `version = 2147483647` ghim vĩnh viễn tổ
-- chức vào đúng chính sách ấy trong khi mọi lần siết sau đó bị bỏ qua trong im lặng.
ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_hieu_luc_khong_lui
  CHECK (effective_from >= created_at);

CREATE OR REPLACE FUNCTION public.chinh_sach_phien_ban_tang_dan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  lon_nhat integer;
BEGIN
  SELECT max(p.version) INTO lon_nhat
    FROM public.org_procurement_policies p
   WHERE p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF lon_nhat IS NOT NULL AND NEW.version OPERATOR(pg_catalog.<=) lon_nhat THEN
    RAISE EXCEPTION 'Phien ban chinh sach phai LON HON phien ban lon nhat dang co (%)', lon_nhat
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER org_procurement_policies_phien_ban_tang_dan
  BEFORE INSERT ON org_procurement_policies
  FOR EACH ROW EXECUTE FUNCTION public.chinh_sach_phien_ban_tang_dan();

-- db/migrations/018_vendor_bids.sql
-- S1.5 — NỘP BÁO GIÁ, PHIÊN BẢN, BIÊN NHẬN, KHOÁ THEO DEADLINE.
-- Đây là chỗ B1, B2, C1 và A3 biến thành câu lệnh, và là chỗ ADR-011 mục 2/3 biến thành lược đồ.
--
-- ============================================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: mỗi bảng mang trọn CREATE TABLE + ENABLE + FORCE + POLICY + GRANT
-- trong CÙNG file này. Cưỡng chế bằng máy ở db/migration-shape.test.ts.
--
-- ============================================================================================
-- BA CỘT KHÔNG TỒN TẠI, VÀ CHÚNG LÀ PHẦN CHỊU LỰC CỦA FILE NÀY
-- ============================================================================================
-- Ba thứ mà một người viết lược đồ bình thường sẽ thêm vào, và cả ba đều CỐ Ý VẮNG MẶT:
--
--   (1) `vendor_bid_versions.envelope_sha256` — DẪN XUẤT được từ `envelope`. B2 đòi băm ấy nằm
--       trong BIÊN NHẬN, và biên nhận thì ĐƯỢC KÝ. Thêm một bản sao ở đây tạo ra hai giá trị cho
--       cùng một sự thật, và bản không được ký sẽ là bản trôi. Bất biến B5 (*"ciphertext lưu trữ
--       luôn khớp hash trong biên nhận"*) chỉ có nghĩa khi hash ấy có ĐÚNG MỘT chỗ ở.
--
--   (2) `vendor_bid_versions.key_agreement_algorithm` — DẪN XUẤT được từ chính phong bì. S1.4 đã
--       trả giá để phong bì TỰ KHAI (ADR-011 phần đã ghim, `describeEnvelope` đọc được mà không
--       cần khoá nào). Chép mã thuật toán ra một cột là vứt đi khoản đầu tư ấy và mua lại đúng
--       vấn đề nó giải quyết.
--
--   (3) `bid_receipts.key_id` và `bid_receipts.algorithm` — cả hai NẰM TRONG văn bản đã ký. Một
--       cột `key_id` cạnh một `canonical_text` chứa `kid=` là hai nguồn sự thật, và nguồn có
--       thẩm quyền là nguồn ĐƯỢC KÝ. Muốn biết khoá nào ký biên nhận này thì đọc văn bản.
--
-- Cả ba đi theo cùng một lập luận mà ADR-017 đã dùng khi GẠCH BỎ yêu cầu chép `policy_version`,
-- và cùng lập luận `009` dùng khi từ chối cho `rfq_items` một cột giá: **bảng không có cột thì
-- không có gì để trôi.**
--
-- ============================================================================================
-- A5 — MỘT KHOẢNG TRỐNG PHẢI NÓI RA Ở ĐÂY, KHÔNG PHẢI Ở LƯỢT REVIEW SAU
-- ============================================================================================
-- Phiên khách chạy dưới CÙNG role `app_api` và CÙNG `app.org_id` của tổ chức NGƯỜI MUA (010).
-- Nghĩa là **RLS KHÔNG cô lập nhà cung cấp này với nhà cung cấp kia** — nó chỉ cô lập tổ chức.
-- Bất biến A5 (*"nhà cung cấp không biết được danh tính, sự tồn tại, số lượng hay giá của nhà
-- cung cấp khác"*) vì vậy được giữ bởi **tầng ứng dụng**, không bởi tầng CSDL.
--
-- Phần CSDL làm được và đã làm: mọi lần ghi phiên bản báo giá đều đi qua trigger đòi phiên khách
-- KHỚP với luồng báo giá (xem mục 3) — nên một phiên khách không GHI được vào luồng của người
-- khác. Phần CSDL KHÔNG làm được: chặn một câu `SELECT` đọc sang luồng khác.
--
-- Hình dạng đúng để đóng nốt là một role `app_guest` với policy theo
-- `current_setting('app.guest_session_id')`. Nó KHÔNG được làm ở đây vì nó chạm mọi bảng và
-- trộn vào S1.5 sẽ làm cả hai việc khó xem xét — xem khoản nợ mới trong `docs/STATE.md`.

-- ============================================================================================
-- (1) LUỒNG BÁO GIÁ CỦA MỘT LỜI MỜI
-- ============================================================================================
-- KHÔNG có cột `rfq_id`. Nó dẫn xuất được qua `rfq_invitations`, và một bản sao ở đây sẽ lệch
-- được (cùng lập luận với ba cột vắng mặt ở đầu file). Trigger nào cần RFQ thì nối một bảng.
CREATE TABLE vendor_bids (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  invitation_id uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, invitation_id) REFERENCES rfq_invitations (org_id, id),
  -- Một lời mời có ĐÚNG MỘT luồng báo giá. Không có ràng buộc này, "phiên bản thứ mấy" là một
  -- câu hỏi có nhiều câu trả lời, và B1 mất chủ ngữ.
  UNIQUE (org_id, invitation_id),
  UNIQUE (org_id, id)
);

ALTER TABLE vendor_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bids FORCE ROW LEVEL SECURITY;

CREATE POLICY vendor_bids_tenant_isolation ON vendor_bids
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON vendor_bids TO app_api;
GRANT INSERT (org_id, invitation_id) ON vendor_bids TO app_api;
-- `app_unseal` đọc để biết luồng nào thuộc lời mời nào lúc mở thầu. Không ghi gì.
GRANT SELECT (id, org_id, invitation_id) ON vendor_bids TO app_unseal;

-- ============================================================================================
-- (2) PHIÊN BẢN BÁO GIÁ — CHỈ GHI THÊM (B1), CHỈ CIPHERTEXT (A3)
-- ============================================================================================
-- `app_api` GHI ĐƯỢC `envelope` nhưng KHÔNG ĐỌC ĐƯỢC nó. Cùng bất đối xứng đã dựng cho
-- `rfq_key_material.wrapped_private_key` ở 017, và ở đây nó mua một thứ mạnh hơn: **một `api` bị
-- chiếm hoàn toàn cũng không rút được phong bì niêm phong ra để tấn công ngoại tuyến về sau.**
-- Không có vế này, A2/A3 chỉ nói rằng `api` không GIẢI MÃ được — chúng không nói rằng `api`
-- không LẤY ĐƯỢC ciphertext.
CREATE TABLE vendor_bid_versions (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                        uuid NOT NULL REFERENCES organizations(id),
  bid_id                        uuid NOT NULL,
  -- KHÔNG có INSERT trên cột này: số phiên bản là DẪN XUẤT, do trigger đặt dưới khoá hàng.
  -- Một số phiên bản do người gọi khai là một số hai người cùng khai được.
  version                       integer NOT NULL CHECK (version > 0),
  -- Phong bì niêm phong của S1.4, nguyên vẹn. Nó TỰ KHAI thuật toán, nên không cột nào chép lại.
  envelope                      bytea NOT NULL
                                CHECK (octet_length(envelope) BETWEEN 32 AND 8388608),
  submitted_at                  timestamptz NOT NULL DEFAULT now(),
  -- [ADR-016, phía KHÁCH] Danh tính là DẪN XUẤT. Không có khoá ngoại tới `guest_sessions` — cùng
  -- lý do vòng đời đã ghi ở 013: dọn phiên hết hạn không được phép xoá một sự thật kiểm toán.
  -- Trigger ở mục (3) mới là thứ đòi phiên khớp luồng.
  submitted_by_guest_session_id uuid NOT NULL,
  FOREIGN KEY (org_id, bid_id) REFERENCES vendor_bids (org_id, id),
  UNIQUE (org_id, bid_id, version),
  UNIQUE (org_id, id)
);

ALTER TABLE vendor_bid_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bid_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY vendor_bid_versions_tenant_isolation ON vendor_bid_versions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- SELECT của `app_api`: MỌI cột TRỪ `envelope`. Xem khối trên CREATE TABLE.
GRANT SELECT (id, org_id, bid_id, version, submitted_at, submitted_by_guest_session_id)
  ON vendor_bid_versions TO app_api;
-- INSERT: có `envelope`, KHÔNG có `version` (trigger đặt) và không có `submitted_at` (DEFAULT).
GRANT INSERT (org_id, bid_id, envelope, submitted_by_guest_session_id)
  ON vendor_bid_versions TO app_api;
-- KHÔNG GRANT UPDATE, KHÔNG GRANT DELETE cho bất kỳ role nào. Đó là B1 ở tầng quyền; trigger ở
-- mục (4) là B1 ở tầng chặn được cả chủ sở hữu bảng.
GRANT SELECT (id, org_id, bid_id, version, envelope, submitted_at)
  ON vendor_bid_versions TO app_unseal;

-- ============================================================================================
-- (3) C1 — HẠN NỘP, PHÁN QUYẾT TRONG CHÍNH TRANSACTION GHI
-- ============================================================================================
-- Ba quyết định của hàm này, mỗi cái có một lý do đo được:
--
-- (a) DÙNG `now()`, KHÔNG DÙNG `clock_timestamp()`. `now()` là dấu thời gian ĐẦU transaction và
--     nó KHÔNG đổi trong suốt transaction — nên nó là CÙNG MỘT giá trị mà `submitted_at DEFAULT
--     now()` ghi xuống, và cũng là giá trị đi vào biên nhận đã ký. Dùng `clock_timestamp()` ở
--     đây sẽ tạo ra một khả năng không ai muốn giải thích: một biên nhận mang dấu thời gian
--     TRƯỚC hạn cho một lần nộp bị từ chối vì TRỄ. Một câu hỏi, một câu trả lời.
--     GIỚI HẠN CÒN LẠI, ghi ra: một transaction MỞ trước hạn rồi commit sau hạn vẫn được nhận.
--     Chặn nó là việc của `statement_timeout` trên đường nộp, và đường ấy chưa tồn tại.
--
-- (b) KHOÁ HÀNG BẰNG `FOR SHARE`, không phải `FOR UPDATE` hay `FOR NO KEY UPDATE`. Bảng tương
--     thích khoá hàng của PostgreSQL cho đúng thứ cần: `FOR SHARE` **không** xung đột với
--     `FOR SHARE` (50 nhà cung cấp nộp cùng lúc không xếp hàng sau nhau) nhưng **có** xung đột
--     với `FOR NO KEY UPDATE` — thứ mà `UPDATE rfq_packages SET status='CLOSED'` lấy. Tức một
--     lần đóng thầu phải ĐỢI các lần nộp đang dở, và một lần nộp không thể lọt vào giữa chừng
--     một lần đóng. `FOR KEY SHARE` KHÔNG dùng được: nó không xung đột với `FOR NO KEY UPDATE`,
--     nên nó sẽ để đúng cuộc đua này đi lọt.
--
-- (c) ĐÒI RFQ ĐANG `OPEN`, không chỉ đòi chưa hết hạn. Hai điều kiện KHÁC nhau: một RFQ đóng sớm
--     (`OPEN -> CLOSED` có lý do, C4) vẫn còn `deadline_at` ở tương lai.
CREATE OR REPLACE FUNCTION public.bid_kiem_han_nop() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  han timestamptz;
BEGIN
  SELECT p.status, p.deadline_at INTO trang_thai, han
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

  IF trang_thai IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'RFQ khong nhan bao gia khi dang o trang thai % (C1)', trang_thai
      USING ERRCODE = 'check_violation';
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

CREATE TRIGGER vendor_bid_versions_kiem_han_nop
  BEFORE INSERT ON vendor_bid_versions
  FOR EACH ROW EXECUTE FUNCTION public.bid_kiem_han_nop();

-- ------------------------------------------------------------------------------------------
-- Phiên khách phải THUỘC VỀ luồng báo giá đang được ghi — [ADR-016] cho phía khách.
--
-- Đây là bản sao về VAI TRÒ của `kiem_danh_tinh_theo_phien` (013), nhưng nó KHÔNG dùng lại được
-- hàm ấy: hàm kia đọc `sessions` (người mua) và so `user_id`, còn ở đây danh tính là một PHIÊN
-- KHÁCH và thứ phải khớp là LỜI MỜI. Cùng khuôn, khác bảng, khác vế so sánh — nên là một hàm
-- riêng chứ không phải một tham số thứ ba nhồi vào hàm cũ.
-- ------------------------------------------------------------------------------------------
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
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT b.invitation_id INTO loi_moi_cua_luong
    FROM public.vendor_bids b
   WHERE b.id OPERATOR(pg_catalog.=) NEW.bid_id
     AND b.org_id OPERATOR(pg_catalog.=) NEW.org_id;

  IF loi_moi_cua_phien IS DISTINCT FROM loi_moi_cua_luong THEN
    RAISE EXCEPTION
      'Phien khach thuoc loi moi khac voi luong bao gia — no phai la DAN XUAT, khong phai loi khai'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER vendor_bid_versions_kiem_phien_khach
  BEFORE INSERT ON vendor_bid_versions
  FOR EACH ROW EXECUTE FUNCTION public.bid_kiem_phien_khach();

-- ------------------------------------------------------------------------------------------
-- Số phiên bản là DẪN XUẤT, không phải tham số: một số do người gọi khai là một số hai người
-- cùng khai được.
--
-- KHOÁ BẰNG `pg_advisory_xact_lock`, KHÔNG BẰNG `SELECT ... FOR NO KEY UPDATE`, và lý do là một
-- phép ĐO chứ không phải một sở thích. Bản đầu khoá hàng `vendor_bids`, và mọi phép đo đỏ với
-- `permission denied for table vendor_bids`: PostgreSQL đòi quyền **UPDATE** (hoặc DELETE) trên
-- bảng để lấy một khoá hàng, mà `app_api` **không có** UPDATE trên `vendor_bids` — một luồng báo
-- giá đã tạo thì không có trường nào để sửa, và dòng GRANT vắng mặt ấy là cố ý.
--
-- Ba đường đi tới trước khoản đó, và hai bị loại:
--   * cấp `UPDATE` một cột nào đó chỉ để khoá được — mở một đường GHI có thật để mua một phép
--     khoá. Loại.
--   * `SECURITY DEFINER` — mục (C) của `hardening.always.sql` CẤM. Loại.
--   * khoá tư vấn theo phạm vi transaction, khuôn đã dùng ở `noi_chuoi_kiem_toan()` (004). Chọn.
--
-- Phạm vi khoá là TỪNG LUỒNG BÁO GIÁ, hẹp hơn khoá theo tổ chức của sổ kiểm toán: hai nhà cung
-- cấp khác nhau không bao giờ chạm nhau, kể cả trong cùng một RFQ vào đúng phút chót.
--
-- Tên trigger bắt đầu bằng `a_` để nó chạy TRƯỚC hai trigger trên theo thứ tự chữ cái: một lần
-- nộp trễ phải báo "đã qua hạn", không báo một lỗi về số phiên bản.
-- ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bid_dat_so_phien_ban() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  so_cu integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.bid_id::pg_catalog.text, 0));

  SELECT max(v.version) INTO so_cu
    FROM public.vendor_bid_versions v
   WHERE v.bid_id OPERATOR(pg_catalog.=) NEW.bid_id
     AND v.org_id OPERATOR(pg_catalog.=) NEW.org_id;

  NEW.version := coalesce(so_cu, 0) OPERATOR(pg_catalog.+) 1;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER a_vendor_bid_versions_dat_so_phien_ban
  BEFORE INSERT ON vendor_bid_versions
  FOR EACH ROW EXECUTE FUNCTION public.bid_dat_so_phien_ban();

-- ============================================================================================
-- (4) B1 — CHỈ GHI THÊM, VÀ LỚP NÀY CHẶN CẢ SUPERUSER
-- ============================================================================================
-- Quyền đã chặn `app_api` và `app_unseal` (không GRANT UPDATE/DELETE). Trigger chặn thêm hạng
-- người mà quyền không chặn được: chủ sở hữu bảng và superuser. Cùng lập luận đã dựng lớp
-- append-only cho `audit_events` ở 003.
CREATE OR REPLACE FUNCTION public.bid_chi_ghi_them() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  RAISE EXCEPTION 'Bang % chi duoc ghi them: khong UPDATE, khong DELETE (B1)', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END
$ham$;

CREATE TRIGGER vendor_bid_versions_chi_ghi_them
  BEFORE UPDATE OR DELETE ON vendor_bid_versions
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();

-- ============================================================================================
-- (5) BIÊN NHẬN — VĂN BẢN ĐÃ KÝ, VÀ KHÔNG GÌ KHÁC CÓ THẨM QUYỀN
-- ============================================================================================
-- Bảng này có ĐÚNG HAI cột mang dữ liệu: văn bản chính tắc và chữ ký của nó. Mọi thứ khác —
-- thuật toán, định danh khoá, mã RFQ, số phiên bản, băm ciphertext, dấu thời gian — nằm TRONG
-- văn bản ấy, tức nằm trong thứ ĐÃ ĐƯỢC KÝ. Xem ADR-011 §"Quyết định mục 2 và mục 3".
--
-- *** KHÔNG CÓ RÀNG BUỘC DUY NHẤT NÀO TRÊN `signature`, VÀ ĐÓ LÀ MỘT QUYẾT ĐỊNH AN NINH. ***
-- Chữ ký `ECDSA` MỀM DẺO: từ `(r, s)` hợp lệ ai cũng dựng được `(r, n−s)` cũng hợp lệ mà KHÔNG
-- cần khoá riêng. Một `UNIQUE (signature)` hay một khoá chính trên nó sẽ biến một thứ kẻ tấn
-- công điều khiển được thành một định danh. Danh tính của biên nhận là `sha256(canonical_text)`.
-- Có test đọc `pg_index` để đòi điều này, vì một dòng `UNIQUE` thêm vào sau sẽ trông vô hại.
CREATE TABLE bid_receipts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id),
  bid_version_id uuid NOT NULL,
  canonical_text text NOT NULL
                 CHECK (octet_length(canonical_text) BETWEEN 64 AND 4096
                        AND canonical_text LIKE 'trustprocure-receipt-v1' || chr(10) || '%'),
  signature      bytea NOT NULL CHECK (octet_length(signature) BETWEEN 8 AND 256),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, bid_version_id) REFERENCES vendor_bid_versions (org_id, id),
  -- Một phiên bản có ĐÚNG MỘT biên nhận. Hai biên nhận cho một lần nộp là hai câu trả lời cho
  -- câu hỏi "hệ thống đã chứng nhận gì".
  UNIQUE (org_id, bid_version_id)
);

ALTER TABLE bid_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY bid_receipts_tenant_isolation ON bid_receipts
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- Biên nhận ĐỌC ĐƯỢC bởi `app_api` — khác hẳn `envelope`. Nhà cung cấp phải lấy lại được biên
-- nhận của mình, và biên nhận không chứa bí mật nào: nó chứa một BĂM của ciphertext.
GRANT SELECT ON bid_receipts TO app_api;
GRANT INSERT (org_id, bid_version_id, canonical_text, signature) ON bid_receipts TO app_api;

CREATE TRIGGER bid_receipts_chi_ghi_them
  BEFORE UPDATE OR DELETE ON bid_receipts
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();

-- ------------------------------------------------------------------------------------------
-- KHÔNG CÓ PHIÊN BẢN NÀO KHÔNG CÓ BIÊN NHẬN — cùng khuôn vế (b) của C5 ở 017.
--
-- Hoãn tới COMMIT là điều kiện để phép kiểm này có nghĩa: lúc INSERT phiên bản chạy, biên nhận
-- theo định nghĩa chưa tồn tại (nó cần `submitted_at` và số phiên bản mà chính câu INSERT ấy vừa
-- sinh ra). Chỉ ở COMMIT mới trả lời được câu "giao dịch này CÓ phát biên nhận hay không".
--
-- Vì sao vế này quan trọng hơn nó có vẻ: B2 nói *"MỖI LẦN nộp sinh biên nhận"*. Không có nó,
-- một đường ghi quên phát biên nhận sẽ cho ra một báo giá đã nộp mà nhà cung cấp không có gì
-- trong tay — và cách phát hiện duy nhất là có người đi hỏi.
-- ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bid_phai_co_bien_nhan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  so integer;
BEGIN
  SELECT count(*) INTO so
    FROM public.bid_receipts r
   WHERE r.bid_version_id OPERATOR(pg_catalog.=) NEW.id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF so OPERATOR(pg_catalog.=) 0 THEN
    RAISE EXCEPTION 'Nop bao gia ma khong phat bien nhan trong cung giao dich (B2)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$ham$;

CREATE CONSTRAINT TRIGGER vendor_bid_versions_phai_co_bien_nhan
  AFTER INSERT ON vendor_bid_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.bid_phai_co_bien_nhan();

-- ============================================================================================
-- (6) DẤU THỜI GIAN CHÍNH TẮC — MỘT HÀM, MỘT ĐỊNH DẠNG
-- ============================================================================================
-- Biên nhận mang `submitted_at`, và chuỗi ấy phải KHÔNG phụ thuộc `DateStyle` hay `TimeZone` của
-- phiên. Dạng mặc định của PostgreSQL thì có phụ thuộc — hai phiên cấu hình khác nhau in ra hai
-- chuỗi cho cùng một hàng, và biên nhận thứ hai sẽ không kiểm chứng được.
--
-- `US` giữ đủ SÁU chữ số micro-giây. Đây là lý do ứng dụng KHÔNG được dựng chuỗi này từ `Date`
-- của JavaScript: `Date` chỉ tới mili-giây, và cảnh báo ấy đã nằm trong `AuditEventRecord` từ S0.
CREATE OR REPLACE FUNCTION public.bid_dau_thoi_gian_chinh_tac(t timestamptz) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$ham$;

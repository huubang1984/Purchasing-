-- ==============================================================================================
-- 9501_passport_nha_cung_cap — [S1.9101 / S3.7a1 của spec S3] ĐƯỜNG PASSPORT CHO NHÀ CUNG CẤP
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.8, §5 K11, §8.6. ADR-081 ⑴ ⑶ ⑷, ADR-015,
-- ADR-016, ADR-018. Chủ dự án chốt ngày 2026-10-08: S3.7 (trừ S3.7b — tài liệu đính kèm) chia ba PR; S3.7a1 là đường Passport —
-- bên mua gửi yêu cầu, nhà cung cấp mở link, qua OTP khác kênh, nộp phiên bản hồ sơ. Thẩm định (K8b) là S3.7a2.
--
-- Hai câu chốt của chủ dự án sau lượt soi hình dạng (ADR-9201):
--   ⓐ số tài khoản ngân hàng được bảo vệ bằng RANH GIỚI CỘT Ở TẦNG MÃ (khuôn `don_gia`), không mã hoá — cột ở đây chỉ mang
--     CHECK hình dạng; phép đo ranh giới là `tests/architecture/so-tai-khoan-liet-ke.test.ts`;
--   ⓑ link Passport chỉ đi tới nhà cung cấp có XÁC MINH K8a còn hiệu lực — một người thứ hai đã xác nhận MST và MỌI đích
--     liên hệ (băm `ncc_bam_xac_minh`), nên người dựng hồ sơ không cài được người liên hệ của mình làm nơi nhận link.
--
-- (1) `otp_rate_limits.bucket_kind` thêm `PASSPORT` — bộ đếm theo NHÀ CUNG CẤP của OTP Passport (khoá theo token thì mỗi
--     lần đúc lại có ngân sách mới).
-- (2) `supplier_passport_requests` — yêu cầu hồ sơ, chỉ ghi thêm. Hôm nay một lý do: `MANUAL` (người giữ `supplier.qualify`);
--     `AWARD_PROPOSED` vào ở S3.7a2. Hàm vị từ `passport_chot_yeu_cau` (khuôn K12: tầng gói hỏi trước, trigger hỏi lại) trả
--     NULL hay một mã: tổ chức chưa bật, nhà cung cấp không ACTIVE/không MST, CHƯA XÁC MINH (ⓑ), người liên hệ không thuộc
--     nhà cung cấp hay không ACTIVE, người liên hệ thiếu số điện thoại (link đi EMAIL nên OTP phải đi máy điện thoại —
--     ADR-015 ⑴), quá TRẦN ba yêu cầu một giờ một nhà cung cấp (đếm cả yêu cầu đã bị thay — lượt soi T3).
-- (3) `supplier_passport_tokens` — khuôn `rfq_invitation_tokens`: băm SHA-256 trần của 32 byte ngẫu nhiên, một mục đích,
--     hạn ≤ 7 ngày (CHECK), MỘT yêu cầu một token, đúc trong CÙNG giao dịch, bởi CÙNG người và phiên với yêu cầu (lượt soi T2),
--     và lưu KÊNH CỦA LINK — luật OTP khác lớp đích so với kênh ĐÃ LƯU, không với một giả định (lượt soi T1, khuôn `022`).
--     Một nhà cung cấp có tối đa MỘT token sống: tầng gói thu hồi token và phiên cũ trước khi đúc (lượt soi T3, T4).
-- (4) `passport_otp_challenges` — khuôn `invitation_otp_challenges` sau `012`/`015`/`022`/`024`; khoá ở cấp TOKEN.
-- (5) `passport_sessions` — khuôn `guest_sessions`: danh tính DẪN XUẤT từ thách thức đã đối chiếu và token đã tiêu thụ mà
--     không bị thu hồi (đọc `FOR SHARE` — lượt soi L8); hạn ≤ 12 giờ (CHECK). Policy khách ĐÓNG (lượt soi L12): lần tra phiên
--     chạy trước khi đặt GUC.
-- (6) `supplier_passport_versions` — chỉ ghi thêm, khuôn `vendor_bid_versions`; `thu_tu` dưới khoá tư vấn THEO NHÀ CUNG CẤP
--     hạt giống 7 — CÙNG hạt của xác minh (`082`): mọi lần ghi về độ tin của một nhà cung cấp xếp một hàng (lượt soi B-T4).
--     Phiên phải sống theo `clock_timestamp()`, thuộc đúng nhà cung cấp, đọc `FOR SHARE`; tối đa năm phiên bản một phiên.
--     Policy khách NỚI theo GUC dẫn xuất `app.passport_supplier_id` (ADR-081 ⑶) — phiên Passport đặt CHÍNH
--     `app.guest_session_id` nên mọi policy `_khach` cũ đóng với nó; phiên khách của lời mời không đặt GUC Passport nên thấy 0
--     phiên bản. Ghi đi qua kết nối KHÔNG GUC khách (khuôn route ghi khách — `028`): ràng phiên ↔ nhà cung cấp ở trigger.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: thẩm định, K8b, yêu cầu tự sinh lúc đề xuất (S3.7a2); tài liệu đính kèm (S3.7b).
-- Mọi hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) BỘ ĐẾM OTP THEO NHÀ CUNG CẤP
-- ============================================================================================
ALTER TABLE otp_rate_limits DROP CONSTRAINT otp_rate_limits_bucket_kind_check;
ALTER TABLE otp_rate_limits ADD CONSTRAINT otp_rate_limits_bucket_kind_check
  CHECK (bucket_kind IN ('DEST', 'DEST_ORG', 'CALLER', 'INVITATION', 'LOGIN_CALLER', 'PASSPORT'));

-- ============================================================================================
-- (2) YÊU CẦU HỒ SƠ
-- ============================================================================================
CREATE TABLE supplier_passport_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id),
  supplier_id             uuid NOT NULL,
  contact_id              uuid NOT NULL,
  ly_do                   text NOT NULL CHECK (ly_do IN ('MANUAL')),
  requested_by            uuid NOT NULL,
  requested_by_session_id uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, supplier_id) REFERENCES suppliers (org_id, id),
  FOREIGN KEY (org_id, contact_id) REFERENCES supplier_contacts (org_id, id),
  FOREIGN KEY (org_id, requested_by) REFERENCES users (org_id, id),
  -- Khoá đích của khoá ngoại hợp thành từ token: token không lệch nhà cung cấp hay người liên hệ khỏi yêu cầu của nó.
  UNIQUE (org_id, id, supplier_id, contact_id)
);
CREATE INDEX supplier_passport_requests_theo_ncc ON supplier_passport_requests (org_id, supplier_id, created_at DESC);

ALTER TABLE supplier_passport_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_passport_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_passport_requests_tenant_isolation ON supplier_passport_requests
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY supplier_passport_requests_khach ON supplier_passport_requests AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON supplier_passport_requests TO app_api;
GRANT INSERT (org_id, supplier_id, contact_id, ly_do, requested_by, requested_by_session_id) ON supplier_passport_requests TO app_api;

CREATE TRIGGER supplier_passport_requests_kiem_danh_tinh
  BEFORE INSERT ON supplier_passport_requests
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'requested_by', 'requested_by_session_id');
ALTER TABLE supplier_passport_requests ENABLE ALWAYS TRIGGER supplier_passport_requests_kiem_danh_tinh;

CREATE TRIGGER supplier_passport_requests_chi_ghi_them
  BEFORE UPDATE OR DELETE ON supplier_passport_requests
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE supplier_passport_requests ENABLE ALWAYS TRIGGER supplier_passport_requests_chi_ghi_them;

CREATE TRIGGER supplier_passport_requests_chan_truncate
  BEFORE TRUNCATE ON supplier_passport_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE supplier_passport_requests ENABLE ALWAYS TRIGGER supplier_passport_requests_chan_truncate;

-- Hàm vị từ: một câu hỏi, hai người dùng (tầng gói trước mọi tác dụng phụ, trigger làm lớp cuối). Không ném; trả NULL hay mã.
-- Thứ tự vế là thứ tự lời nói với người gọi: cấu hình, nhà cung cấp, xác minh, người liên hệ, kênh OTP, trần.
CREATE OR REPLACE FUNCTION public.passport_chot_yeu_cau(p_org uuid, p_ncc uuid, p_lien_he uuid) RETURNS text
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ncc_trang_thai text;
  ncc_mst text;
  lh_ncc uuid;
  lh_trang_thai text;
  lh_dien_thoai text;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN 'PASSPORT_TO_CHUC_CHUA_BAT';
  END IF;
  SELECT s.status, s.tax_code INTO ncc_trang_thai, ncc_mst
    FROM public.suppliers s
   WHERE s.org_id = p_org AND s.id = p_ncc;
  IF NOT FOUND OR ncc_trang_thai <> 'ACTIVE' OR ncc_mst IS NULL THEN
    RETURN 'PASSPORT_NCC_KHONG_HOP_LE';
  END IF;
  IF NOT public.ncc_xac_minh_con_hieu_luc(p_org, p_ncc) THEN
    RETURN 'PASSPORT_NCC_CHUA_XAC_MINH';
  END IF;
  SELECT c.supplier_id, c.status, c.phone INTO lh_ncc, lh_trang_thai, lh_dien_thoai
    FROM public.supplier_contacts c
   WHERE c.org_id = p_org AND c.id = p_lien_he;
  IF NOT FOUND OR lh_ncc IS DISTINCT FROM p_ncc OR lh_trang_thai <> 'ACTIVE' THEN
    RETURN 'PASSPORT_LIEN_HE_KHONG_HOP_LE';
  END IF;
  IF lh_dien_thoai IS NULL OR lh_dien_thoai = '' THEN
    RETURN 'PASSPORT_LIEN_HE_THIEU_KENH_OTP';
  END IF;
  IF (SELECT count(*) FROM public.supplier_passport_requests r
       WHERE r.org_id = p_org AND r.supplier_id = p_ncc
         AND r.created_at > now() - interval '1 hour') >= 3 THEN
    RETURN 'PASSPORT_QUA_TRAN_YEU_CAU';
  END IF;
  RETURN NULL;
END
$ham$;

-- Tên xếp SAU `_kiem_danh_tinh` nên `requested_by` đã là người của phiên. Khoá tư vấn theo nhà cung cấp, hạt giống 7.
CREATE OR REPLACE FUNCTION public.passport_kiem_yeu_cau() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.supplier_id::pg_catalog.text, 7));
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.requested_by
                    AND rp.permission_code = 'supplier.qualify') THEN
    RAISE EXCEPTION 'Nguoi yeu cau ho so Passport phai giu supplier.qualify'
      USING ERRCODE = 'check_violation';
  END IF;
  ly_do := public.passport_chot_yeu_cau(NEW.org_id, NEW.supplier_id, NEW.contact_id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Khong gui duoc yeu cau ho so Passport: %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER supplier_passport_requests_kiem_yeu_cau
  BEFORE INSERT ON supplier_passport_requests
  FOR EACH ROW EXECUTE FUNCTION public.passport_kiem_yeu_cau();
ALTER TABLE supplier_passport_requests ENABLE ALWAYS TRIGGER supplier_passport_requests_kiem_yeu_cau;

-- ============================================================================================
-- (3) TOKEN
-- ============================================================================================
CREATE TABLE supplier_passport_tokens (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id),
  request_id           uuid NOT NULL,
  supplier_id          uuid NOT NULL,
  contact_id           uuid NOT NULL,
  token_hash           bytea NOT NULL,
  purpose              text NOT NULL,
  link_channel         text NOT NULL,
  expires_at           timestamptz NOT NULL,
  revoked_at           timestamptz,
  consumed_at          timestamptz,
  issued_by            uuid NOT NULL,
  issued_by_session_id uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, request_id, supplier_id, contact_id)
    REFERENCES supplier_passport_requests (org_id, id, supplier_id, contact_id),
  FOREIGN KEY (org_id, issued_by) REFERENCES users (org_id, id),
  CONSTRAINT supplier_passport_tokens_bam CHECK (octet_length(token_hash) = 32),
  CONSTRAINT supplier_passport_tokens_muc_dich CHECK (purpose = 'PASSPORT_SUBMISSION'),
  CONSTRAINT supplier_passport_tokens_kenh_link CHECK (link_channel IN ('EMAIL', 'SMS', 'ZALO_ZNS')),
  CONSTRAINT supplier_passport_tokens_han_sau_tao CHECK (expires_at > created_at),
  CONSTRAINT supplier_passport_tokens_han_toi_da CHECK (expires_at <= created_at + interval '7 days'),
  UNIQUE (org_id, token_hash),
  UNIQUE (org_id, request_id),
  UNIQUE (org_id, id)
);
CREATE INDEX supplier_passport_tokens_theo_ncc ON supplier_passport_tokens (org_id, supplier_id);

ALTER TABLE supplier_passport_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_passport_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_passport_tokens_tenant_isolation ON supplier_passport_tokens
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY supplier_passport_tokens_khach ON supplier_passport_tokens AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON supplier_passport_tokens TO app_api;
GRANT INSERT (org_id, request_id, supplier_id, contact_id, token_hash, purpose, link_channel, expires_at, issued_by, issued_by_session_id)
  ON supplier_passport_tokens TO app_api;
GRANT UPDATE (revoked_at, consumed_at) ON supplier_passport_tokens TO app_api;

CREATE TRIGGER supplier_passport_tokens_kiem_danh_tinh
  BEFORE INSERT ON supplier_passport_tokens
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'issued_by', 'issued_by_session_id');
ALTER TABLE supplier_passport_tokens ENABLE ALWAYS TRIGGER supplier_passport_tokens_kiem_danh_tinh;

CREATE TRIGGER supplier_passport_tokens_thu_hoi_don_dieu
  BEFORE UPDATE ON supplier_passport_tokens
  FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('revoked_at', 'consumed_at');
ALTER TABLE supplier_passport_tokens ENABLE ALWAYS TRIGGER supplier_passport_tokens_thu_hoi_don_dieu;

-- Token RÀNG vào yêu cầu: cùng người, cùng phiên, cùng giao dịch (`created_at` của yêu cầu = `now()` của giao dịch này). Một
-- token sống mỗi nhà cung cấp. Người liên hệ có đích cho kênh của link.
CREATE OR REPLACE FUNCTION public.passport_kiem_token() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  yc_nguoi uuid;
  yc_phien uuid;
  yc_luc timestamptz;
  lh_dien_thoai text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.supplier_id::pg_catalog.text, 7));
  SELECT r.requested_by, r.requested_by_session_id, r.created_at INTO yc_nguoi, yc_phien, yc_luc
    FROM public.supplier_passport_requests r
   WHERE r.org_id = NEW.org_id AND r.id = NEW.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token Passport phai thuoc mot yeu cau ho so' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF yc_nguoi IS DISTINCT FROM NEW.issued_by OR yc_phien IS DISTINCT FROM NEW.issued_by_session_id
     OR yc_luc IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'Token Passport chi duoc duc trong CUNG giao dich, boi CUNG nguoi va phien voi yeu cau cua no'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_passport_tokens t
              WHERE t.org_id = NEW.org_id AND t.supplier_id = NEW.supplier_id
                AND t.revoked_at IS NULL AND t.consumed_at IS NULL AND t.expires_at > now()) THEN
    RAISE EXCEPTION 'Nha cung cap con mot link Passport dang song — thu hoi truoc khi duc link moi'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.link_channel <> 'EMAIL' THEN
    SELECT c.phone INTO lh_dien_thoai FROM public.supplier_contacts c
     WHERE c.org_id = NEW.org_id AND c.id = NEW.contact_id;
    IF lh_dien_thoai IS NULL OR lh_dien_thoai = '' THEN
      RAISE EXCEPTION 'Nguoi lien he khong co dich cho kenh cua link Passport' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER supplier_passport_tokens_kiem_token
  BEFORE INSERT ON supplier_passport_tokens
  FOR EACH ROW EXECUTE FUNCTION public.passport_kiem_token();
ALTER TABLE supplier_passport_tokens ENABLE ALWAYS TRIGGER supplier_passport_tokens_kiem_token;

-- ============================================================================================
-- (4) THÁCH THỨC OTP
-- ============================================================================================
CREATE TABLE passport_otp_challenges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id),
  token_id         uuid NOT NULL,
  contact_id       uuid NOT NULL,
  channel          text NOT NULL,
  code_hash        bytea NOT NULL,
  destination_hash bytea NOT NULL,
  pepper_version   text NOT NULL,
  expires_at       timestamptz NOT NULL,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, token_id) REFERENCES supplier_passport_tokens (org_id, id),
  FOREIGN KEY (org_id, contact_id) REFERENCES supplier_contacts (org_id, id),
  CONSTRAINT passport_otp_challenges_kenh CHECK (channel IN ('EMAIL', 'SMS', 'ZALO_ZNS')),
  CONSTRAINT passport_otp_challenges_bam_ma CHECK (octet_length(code_hash) = 32),
  CONSTRAINT passport_otp_challenges_bam_dich CHECK (octet_length(destination_hash) = 32),
  CONSTRAINT passport_otp_challenges_phien_ban_pepper CHECK (octet_length(pepper_version) BETWEEN 1 AND 32),
  CONSTRAINT passport_otp_challenges_so_lan_sai CHECK (failed_attempts >= 0),
  CONSTRAINT passport_otp_challenges_han_sau_tao CHECK (expires_at > created_at),
  UNIQUE (org_id, id)
);
CREATE INDEX passport_otp_challenges_theo_token ON passport_otp_challenges (org_id, token_id, created_at DESC);

ALTER TABLE passport_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE passport_otp_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY passport_otp_challenges_tenant_isolation ON passport_otp_challenges
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY passport_otp_challenges_khach ON passport_otp_challenges AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON passport_otp_challenges TO app_api;
GRANT INSERT (org_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, expires_at)
  ON passport_otp_challenges TO app_api;
GRANT UPDATE (failed_attempts, locked_until, consumed_at) ON passport_otp_challenges TO app_api;

CREATE TRIGGER passport_otp_challenges_thu_hoi_don_dieu
  BEFORE UPDATE ON passport_otp_challenges
  FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('consumed_at');
ALTER TABLE passport_otp_challenges ENABLE ALWAYS TRIGGER passport_otp_challenges_thu_hoi_don_dieu;

CREATE TRIGGER passport_otp_challenges_go_khoa_khong_xoa_dau_vet
  BEFORE UPDATE ON passport_otp_challenges
  FOR EACH ROW EXECUTE FUNCTION public.otp_go_khoa_khong_xoa_dau_vet();
ALTER TABLE passport_otp_challenges ENABLE ALWAYS TRIGGER passport_otp_challenges_go_khoa_khong_xoa_dau_vet;

-- Khuôn `otp_kiem_kenh_khac_link` (`022`): token sống, đúng người liên hệ, OTP khác LỚP đích với kênh ĐÃ LƯU của link, không
-- thách thức nào đang khoá trên cùng token. Token đọc `FOR SHARE`: một lần thu hồi đang chạy chờ thách thức này commit hay huỷ.
CREATE OR REPLACE FUNCTION public.passport_otp_kiem_kenh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  tk_lien_he uuid;
  tk_kenh text;
BEGIN
  SELECT t.contact_id, t.link_channel INTO tk_lien_he, tk_kenh
    FROM public.supplier_passport_tokens t
   WHERE t.org_id = NEW.org_id AND t.id = NEW.token_id
     AND t.purpose = 'PASSPORT_SUBMISSION'
     AND t.expires_at > now() AND t.revoked_at IS NULL AND t.consumed_at IS NULL
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token Passport khong con hieu luc (H1)' USING ERRCODE = 'check_violation';
  END IF;
  IF tk_lien_he IS DISTINCT FROM NEW.contact_id THEN
    RAISE EXCEPTION 'Thach thuc OTP phai thuoc dung nguoi lien he cua link (C1)' USING ERRCODE = 'check_violation';
  END IF;
  IF public.otp_lop_dich(NEW.channel) = public.otp_lop_dich(tk_kenh) THEN
    RAISE EXCEPTION 'OTP khong duoc toi cung mot lop dich voi link Passport (ADR-015): % va %', NEW.channel, tk_kenh
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.passport_otp_challenges c
              WHERE c.org_id = NEW.org_id AND c.token_id = NEW.token_id
                AND c.locked_until IS NOT NULL AND c.locked_until > now()) THEN
    RAISE EXCEPTION 'Link Passport nay dang bi khoa vi qua nhieu lan thu sai (E3)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER passport_otp_challenges_kiem_kenh
  BEFORE INSERT ON passport_otp_challenges
  FOR EACH ROW EXECUTE FUNCTION public.passport_otp_kiem_kenh();
ALTER TABLE passport_otp_challenges ENABLE ALWAYS TRIGGER passport_otp_challenges_kiem_kenh;

-- ============================================================================================
-- (5) PHIÊN PASSPORT
-- ============================================================================================
CREATE TABLE passport_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id),
  supplier_id      uuid NOT NULL,
  contact_id       uuid NOT NULL,
  challenge_id     uuid NOT NULL,
  token_hash       bytea NOT NULL,
  verified_channel text NOT NULL,
  otp_verified_at  timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, supplier_id) REFERENCES suppliers (org_id, id),
  FOREIGN KEY (org_id, contact_id) REFERENCES supplier_contacts (org_id, id),
  FOREIGN KEY (org_id, challenge_id) REFERENCES passport_otp_challenges (org_id, id),
  CONSTRAINT passport_sessions_bam CHECK (octet_length(token_hash) = 32),
  CONSTRAINT passport_sessions_kenh CHECK (verified_channel IN ('EMAIL', 'SMS', 'ZALO_ZNS')),
  CONSTRAINT passport_sessions_han_sau_tao CHECK (expires_at > created_at),
  CONSTRAINT passport_sessions_han_toi_da CHECK (expires_at <= created_at + interval '12 hours'),
  UNIQUE (org_id, token_hash),
  UNIQUE (org_id, challenge_id),
  UNIQUE (org_id, id)
);
CREATE INDEX passport_sessions_theo_ncc ON passport_sessions (org_id, supplier_id);

ALTER TABLE passport_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE passport_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY passport_sessions_tenant_isolation ON passport_sessions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY passport_sessions_khach ON passport_sessions AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- Không `INSERT (id)`: id phiên do CSDL sinh, nên không gian id của phiên Passport và phiên khách không va nhau (lượt soi L11).
GRANT SELECT ON passport_sessions TO app_api;
GRANT INSERT (org_id, supplier_id, contact_id, challenge_id, token_hash, verified_channel, expires_at) ON passport_sessions TO app_api;
GRANT UPDATE (revoked_at) ON passport_sessions TO app_api;

CREATE TRIGGER passport_sessions_thu_hoi_don_dieu
  BEFORE UPDATE ON passport_sessions
  FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('revoked_at');
ALTER TABLE passport_sessions ENABLE ALWAYS TRIGGER passport_sessions_thu_hoi_don_dieu;

-- Khuôn `guest_session_kiem_danh_tinh` (`012` C2): danh tính DẪN XUẤT từ thách thức đã đối chiếu; token của thách thức đã tiêu
-- thụ và KHÔNG bị thu hồi — đọc `FOR SHARE`, nên một lần thu hồi commit giữa lúc đọc token và lúc mở phiên thì phiên không ra.
CREATE OR REPLACE FUNCTION public.passport_phien_kiem_danh_tinh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  tt_token uuid;
  tt_lien_he uuid;
  tt_kenh text;
  tt_da_dung timestamptz;
  tk_ncc uuid;
  tk_lien_he uuid;
  tk_da_dung timestamptz;
  tk_thu_hoi timestamptz;
BEGIN
  SELECT c.token_id, c.contact_id, c.channel, c.consumed_at INTO tt_token, tt_lien_he, tt_kenh, tt_da_dung
    FROM public.passport_otp_challenges c
   WHERE c.org_id = NEW.org_id AND c.id = NEW.challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay thach thuc OTP Passport' USING ERRCODE = 'check_violation';
  END IF;
  IF tt_da_dung IS NULL THEN
    RAISE EXCEPTION 'Thach thuc OTP Passport chua duoc doi chieu (E2)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT t.supplier_id, t.contact_id, t.consumed_at, t.revoked_at INTO tk_ncc, tk_lien_he, tk_da_dung, tk_thu_hoi
    FROM public.supplier_passport_tokens t
   WHERE t.org_id = NEW.org_id AND t.id = tt_token
     FOR SHARE;
  IF NOT FOUND OR tk_da_dung IS NULL OR tk_thu_hoi IS NOT NULL THEN
    RAISE EXCEPTION 'Token Passport phai da tieu thu va chua bi thu hoi khi mo phien (H5, C3)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.supplier_id IS DISTINCT FROM tk_ncc OR NEW.contact_id IS DISTINCT FROM tt_lien_he
     OR tt_lien_he IS DISTINCT FROM tk_lien_he OR NEW.verified_channel IS DISTINCT FROM tt_kenh THEN
    RAISE EXCEPTION 'Danh tinh phien Passport phai DAN XUAT tu thach thuc va token, khong duoc khai (C2, E5)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER passport_sessions_kiem_danh_tinh
  BEFORE INSERT ON passport_sessions
  FOR EACH ROW EXECUTE FUNCTION public.passport_phien_kiem_danh_tinh();
ALTER TABLE passport_sessions ENABLE ALWAYS TRIGGER passport_sessions_kiem_danh_tinh;

-- ============================================================================================
-- (6) PHIÊN BẢN HỒ SƠ
-- ============================================================================================
CREATE TABLE supplier_passport_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  supplier_id         uuid NOT NULL,
  thu_tu              bigint NOT NULL,
  passport_session_id uuid NOT NULL,
  legal_name          text NOT NULL,
  tax_code            text NOT NULL,
  nguoi_dai_dien      text NOT NULL,
  dia_chi             text NOT NULL,
  ngan_hang           text NOT NULL,
  so_tai_khoan        text NOT NULL,
  chung_nhan          text[] NOT NULL DEFAULT '{}',
  nhom_hang           text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, supplier_id) REFERENCES suppliers (org_id, id),
  FOREIGN KEY (org_id, passport_session_id) REFERENCES passport_sessions (org_id, id),
  -- Hình dạng: cùng luật MST của `008`; số tài khoản CHỈ chữ số (lượt soi L16 — không ký tự nào ngoài 0–9 lọt vào màn bên mua).
  CONSTRAINT supplier_passport_versions_mst CHECK (tax_code ~ '^[0-9]{10}(-[0-9]{3})?$'),
  CONSTRAINT supplier_passport_versions_so_tai_khoan CHECK (so_tai_khoan ~ '^[0-9]{6,20}$'),
  -- Trường văn bản một dòng: không rỗng, có trần byte, không ký tự điều khiển, không ký tự định hướng (bidi).
  CONSTRAINT supplier_passport_versions_van_ban CHECK (
    octet_length(btrim(legal_name)) BETWEEN 1 AND 500
    AND octet_length(btrim(nguoi_dai_dien)) BETWEEN 1 AND 200
    AND octet_length(btrim(dia_chi)) BETWEEN 1 AND 1000
    AND octet_length(btrim(ngan_hang)) BETWEEN 1 AND 200
    AND (legal_name || nguoi_dai_dien || dia_chi || ngan_hang) !~ '[\x01-\x1f\x7f\x200e\x200f\x202a-\x202e\x2066-\x2069]'),
  CONSTRAINT supplier_passport_versions_danh_sach CHECK (cardinality(chung_nhan) <= 20 AND cardinality(nhom_hang) <= 20),
  UNIQUE (org_id, supplier_id, thu_tu)
);

ALTER TABLE supplier_passport_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_passport_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_passport_versions_tenant_isolation ON supplier_passport_versions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
-- ADR-081 ⑶: nới cho phiên Passport theo GUC DẪN XUẤT (`withPassportSession` đặt nó từ hàng `passport_sessions`). Ghi thì đóng
-- với mọi phiên khách — đường ghi chạy không GUC khách.
CREATE POLICY supplier_passport_versions_khach ON supplier_passport_versions AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
         OR supplier_id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.passport_supplier_id', true), '')::pg_catalog.uuid)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON supplier_passport_versions TO app_api;
GRANT INSERT (org_id, supplier_id, passport_session_id, legal_name, tax_code, nguoi_dai_dien, dia_chi, ngan_hang, so_tai_khoan,
              chung_nhan, nhom_hang)
  ON supplier_passport_versions TO app_api;

CREATE TRIGGER supplier_passport_versions_chi_ghi_them
  BEFORE UPDATE OR DELETE ON supplier_passport_versions
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE supplier_passport_versions ENABLE ALWAYS TRIGGER supplier_passport_versions_chi_ghi_them;

CREATE TRIGGER supplier_passport_versions_chan_truncate
  BEFORE TRUNCATE ON supplier_passport_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE supplier_passport_versions ENABLE ALWAYS TRIGGER supplier_passport_versions_chan_truncate;

-- Phiên sống (đọc `FOR SHARE`, hạn theo `clock_timestamp()` — khuôn `withGuestSession` ⑵), đúng nhà cung cấp, tối đa năm phiên
-- bản một phiên (lượt soi L13); từng mục danh sách cùng luật văn bản; `thu_tu` dưới khoá hạt giống 7.
CREATE OR REPLACE FUNCTION public.passport_kiem_phien_ban() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ph_ncc uuid;
  muc text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.supplier_id::pg_catalog.text, 7));
  SELECT s.supplier_id INTO ph_ncc
    FROM public.passport_sessions s
   WHERE s.org_id = NEW.org_id AND s.id = NEW.passport_session_id
     AND s.revoked_at IS NULL AND s.expires_at > pg_catalog.clock_timestamp()
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien Passport khong hop le: khong ton tai, da thu hoi, hoac da het han'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'phien_passport_khong_hop_le';
  END IF;
  IF ph_ncc IS DISTINCT FROM NEW.supplier_id THEN
    RAISE EXCEPTION 'Phien Passport thuoc nha cung cap khac — nha cung cap la DAN XUAT, khong phai loi khai'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.supplier_passport_versions v
       WHERE v.org_id = NEW.org_id AND v.passport_session_id = NEW.passport_session_id) >= 5 THEN
    RAISE EXCEPTION 'Mot phien Passport nop toi da nam phien ban'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'phien_passport_qua_tran_phien_ban';
  END IF;
  FOREACH muc IN ARRAY NEW.chung_nhan || NEW.nhom_hang LOOP
    IF muc IS NULL OR octet_length(btrim(muc)) NOT BETWEEN 1 AND 200
       OR muc ~ '[\x01-\x1f\x7f\x200e\x200f\x202a-\x202e\x2066-\x2069]' THEN
      RAISE EXCEPTION 'Muc chung nhan hay nhom hang khong hop le' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  NEW.thu_tu := coalesce((SELECT max(v.thu_tu) FROM public.supplier_passport_versions v
                           WHERE v.org_id = NEW.org_id AND v.supplier_id = NEW.supplier_id), 0) + 1;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER supplier_passport_versions_kiem_phien_ban
  BEFORE INSERT ON supplier_passport_versions
  FOR EACH ROW EXECUTE FUNCTION public.passport_kiem_phien_ban();
ALTER TABLE supplier_passport_versions ENABLE ALWAYS TRIGGER supplier_passport_versions_kiem_phien_ban;

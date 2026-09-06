-- db/migrations/010_invitations.sql
-- Lời mời, magic link, OTP, phiên khách (S1.3). Đây là chỗ ADR-015 được biến thành câu lệnh.
--
-- ============================================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: mọi bảng mang trọn CREATE TABLE + ENABLE + FORCE + POLICY + GRANT
-- trong CÙNG file này. Cưỡng chế bằng máy ở db/migration-shape.test.ts.
--
-- ============================================================================================
-- ADR-015 MỤC 1 TRỞ THÀNH MỘT BẤT BIẾN TRÊN DỮ LIỆU, KHÔNG PHẢI MỘT QUY ƯỚC
-- ============================================================================================
-- ADR-015 chốt: *"OTP KHÔNG BAO GIỜ đi cùng kênh với magic link"*, và ghi rằng đó mới là phần
-- không được đổi — tên nhà cung cấp dịch vụ chỉ là chi tiết triển khai.
--
-- Cách viết dễ nhất là một `CHECK (channel IN ('SMS','ZALO_ZNS'))` trên bảng OTP: nó cấm EMAIL,
-- và hôm nay magic link đi bằng email nên bất biến được giữ. NHƯNG NÓ ĐƯỢC GIỮ VÌ MỘT SỰ TRÙNG
-- HỢP: ngày ai đó cho phép gửi magic link qua SMS, `CHECK` ấy vẫn xanh trong khi bất biến đã vỡ.
-- Đó đúng là hình dạng "một bảo đảm phụ thuộc một tính chất của môi trường mà không ĐO tính chất
-- đó" — bài học đắt nhất của lượt chạy CI đầu tiên (test hoa-thường xanh trên Windows, đỏ trên
-- Linux).
--
-- Vì vậy kênh của magic link được LƯU (`rfq_invitations.link_channel`) và trigger so HAI kênh với
-- nhau. Bất biến được cưỡng chế là chính mệnh đề của ADR-015, không phải một hệ quả của nó.

-- `supplier_contacts` (008) chưa có ràng buộc duy nhất trên cặp (org_id, id). Khoá ngoại hợp
-- thành bên dưới đòi nó. Cùng khuôn 006 §(1) và 009: tập hàng vi phạm (org_id, id) là TẬP CON của
-- tập vi phạm khoá chính, nên không hàng mới nào bị từ chối và không có oracle mới.
ALTER TABLE supplier_contacts ADD CONSTRAINT supplier_contacts_org_id_id_key UNIQUE (org_id, id);

-- ============================================================================================
-- (1) LỜI MỜI
-- ============================================================================================
CREATE TABLE rfq_invitations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  rfq_id              uuid NOT NULL,
  supplier_id         uuid NOT NULL,
  -- Người liên hệ ĐƯỢC MỜI. Đây là danh tính DỰ KIẾN; danh tính THỰC TẾ ĐÃ XÁC THỰC nằm ở
  -- `guest_sessions.verified_contact_id` (E5) và hai cột đó CÓ THỂ khác nhau.
  contact_id          uuid NOT NULL,
  -- Kênh mà magic link đi qua. Xem khối đầu file: cột này tồn tại để bất biến của ADR-015 được
  -- cưỡng chế bằng chính mệnh đề của nó, không bằng một hệ quả tình cờ.
  link_channel        text NOT NULL DEFAULT 'EMAIL'
                      CHECK (link_channel IN ('EMAIL', 'SMS', 'ZALO_ZNS')),
  status              text NOT NULL DEFAULT 'SENT'
                      CHECK (status IN ('SENT', 'ACCEPTED', 'DECLINED', 'REVOKED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, supplier_id) REFERENCES suppliers (org_id, id),
  FOREIGN KEY (org_id, contact_id) REFERENCES supplier_contacts (org_id, id),
  -- Một nhà cung cấp được mời ĐÚNG MỘT LẦN cho mỗi RFQ. org_id đứng đầu (ADR-013 / H14).
  UNIQUE (org_id, rfq_id, supplier_id),
  UNIQUE (org_id, id),
  CONSTRAINT rfq_invitations_thu_hoi_co_moc CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

ALTER TABLE rfq_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_invitations_tenant_isolation ON rfq_invitations
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON rfq_invitations TO app_api;
GRANT INSERT (org_id, rfq_id, supplier_id, contact_id, link_channel)
  ON rfq_invitations TO app_api;
-- `contact_id` và `link_channel` KHÔNG có UPDATE: đổi người nhận hay đổi kênh của một lời mời đã
-- gửi là gửi một lời mời KHÁC. Và `link_channel` mà sửa được sau khi OTP đã phát thì trigger so
-- hai kênh ở dưới trở thành một phép kiểm chỉ đúng tại thời điểm chèn.
GRANT UPDATE (status, revoked_at) ON rfq_invitations TO app_api;

-- ============================================================================================
-- (2) TOKEN CỦA MAGIC LINK — E1
--
-- E1 đòi năm thứ: ≥128 bit entropy từ CSPRNG · lưu dạng HASH · ĐƠN MỤC ĐÍCH · CÓ HẠN · THU HỒI
-- ĐƯỢC. Bốn trong năm là hình dạng bảng và nằm ở đây; vế "≥128 bit CSPRNG" là tính chất của MÃ
-- SINH RA nó, không của lược đồ — nó nằm ở packages/invitation và được đo ở đó.
--
-- KHÔNG CÓ CỘT NÀO CHỨA TOKEN DẠNG RÕ. Đọc được database không chiếm được lời mời.
-- ============================================================================================
CREATE TABLE rfq_invitation_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id),
  invitation_id  uuid NOT NULL,
  token_hash     bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  -- ĐƠN MỤC ĐÍCH, ép bằng một tập đóng. Một token dùng được cho nhiều việc là một token mà phạm
  -- vi của nó không đọc được từ chính nó.
  purpose        text NOT NULL CHECK (purpose IN ('BID_SUBMISSION')),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, invitation_id) REFERENCES rfq_invitations (org_id, id),
  -- org_id đứng đầu. Một `UNIQUE (token_hash)` toàn cục sẽ là oracle xuyên tổ chức đúng khuôn
  -- ADR-013 — và ở đây nó còn tệ hơn vì nó trả lời câu hỏi "chuỗi này có phải một token thật".
  UNIQUE (org_id, token_hash),
  CONSTRAINT rfq_invitation_tokens_han_sau_tao CHECK (expires_at > created_at)
);

ALTER TABLE rfq_invitation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_invitation_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_invitation_tokens_tenant_isolation ON rfq_invitation_tokens
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON rfq_invitation_tokens TO app_api;
GRANT INSERT (org_id, invitation_id, token_hash, purpose, expires_at)
  ON rfq_invitation_tokens TO app_api;
-- Chỉ hai cột UPDATE được, và cả hai chỉ đi MỘT CHIỀU trong thực tế. `token_hash` không sửa được:
-- một token đổi được giá trị là một token không thu hồi được thật.
GRANT UPDATE (revoked_at, consumed_at) ON rfq_invitation_tokens TO app_api;

-- ============================================================================================
-- (3) THÁCH THỨC OTP — E2, E3
--
-- E3 có NĂM vế (docs/TEST-PLAN.md): giới hạn số lần thử · GIỚI HẠN TẦN SUẤT · hết hạn · dùng một
-- lần · so sánh chống tấn công thời gian. Bảng này mang bốn vế đầu ở dạng bền vững; vế thứ năm là
-- tính chất của MÃ SO SÁNH và nằm ở packages/invitation.
--
-- GIỚI HẠN CỦA `code_hash`, NÓI THẲNG NGAY TẠI CHỖ THAY VÌ ĐỂ NGƯỜI ĐỌC SAU TỰ PHÁT HIỆN:
-- mã OTP là 6 chữ số, tức không gian 10^6. Một kẻ đã ĐỌC ĐƯỢC bảng này duyệt hết không gian đó
-- bằng SHA-256 trong vài mili-giây trên một máy tính xách tay. `code_hash` KHÔNG bảo vệ mã trước
-- một lần lộ database; thứ bảo vệ là HẠN NGẮN, GIỚI HẠN SỐ LẦN THỬ và TÍNH DÙNG MỘT LẦN. Điều
-- `code_hash` thật sự mua được: một lần lộ database không cho phép kẻ tấn công dùng lại mã ở một
-- hệ thống khác, và log/backup không chứa mã dạng rõ.
-- ============================================================================================
CREATE TABLE invitation_otp_challenges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id),
  invitation_id    uuid NOT NULL,
  -- Kênh THỰC TẾ đã gửi. Tập đóng gồm cả EMAIL — cố ý: nếu cấm EMAIL ở đây thì bất biến của
  -- ADR-015 sẽ được giữ bởi một `CHECK` KHÔNG nhắc gì tới magic link, tức bởi một sự trùng hợp.
  -- Trigger `otp_kiem_kenh_khac_link` bên dưới mới là lớp phát biểu đúng mệnh đề.
  channel          text NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'ZALO_ZNS')),
  code_hash        bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  expires_at       timestamptz NOT NULL,
  failed_attempts  integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until     timestamptz,
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, invitation_id) REFERENCES rfq_invitations (org_id, id),
  UNIQUE (org_id, id),
  CONSTRAINT invitation_otp_han_sau_tao CHECK (expires_at > created_at)
);

CREATE INDEX invitation_otp_theo_loi_moi
  ON invitation_otp_challenges (org_id, invitation_id, created_at DESC);

ALTER TABLE invitation_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_otp_challenges FORCE ROW LEVEL SECURITY;

CREATE POLICY invitation_otp_challenges_tenant_isolation ON invitation_otp_challenges
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON invitation_otp_challenges TO app_api;
GRANT INSERT (org_id, invitation_id, channel, code_hash, expires_at)
  ON invitation_otp_challenges TO app_api;
GRANT UPDATE (failed_attempts, locked_until, consumed_at)
  ON invitation_otp_challenges TO app_api;

-- ADR-015 MỤC 1, dưới dạng một phép so hai cột. Xem khối đầu file để biết vì sao KHÔNG viết nó
-- thành `CHECK (channel <> 'EMAIL')`.
CREATE OR REPLACE FUNCTION public.otp_kiem_kenh_khac_link() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  kenh_link text;
BEGIN
  SELECT i.link_channel INTO kenh_link
    FROM public.rfq_invitations i WHERE i.id = NEW.invitation_id;

  IF kenh_link IS NULL THEN
    RAISE EXCEPTION 'Khong tim thay loi moi cho thach thuc OTP nay'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.channel = kenh_link THEN
    RAISE EXCEPTION
      'OTP khong duoc di cung kenh voi magic link (ADR-015): ca hai deu la %', NEW.channel
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER invitation_otp_kiem_kenh
  BEFORE INSERT ON invitation_otp_challenges
  FOR EACH ROW EXECUTE FUNCTION public.otp_kiem_kenh_khac_link();

-- ============================================================================================
-- (4) GIỚI HẠN TẦN SUẤT — E3(2), VẾ CHƯA TỪNG CÓ MỘT DÒNG MÃ NÀO TRONG TOÀN S0
--
-- ADR-015 mục 4 chốt: chạy trên Postgres, KHÔNG thêm Redis. Mục 5 chốt hai hạn mức với HAI LOẠI
-- PHẢN ỨNG khác nhau — theo ĐÍCH chỉ được LÀM CHẬM (khoá theo đích cho phép một người khoá lối
-- vào của người khác), theo NGƯỜI GỌI mới được KHOÁ.
--
-- `bucket` mang một chuỗi đã BĂM, không mang số điện thoại dạng rõ: bảng này sẽ là bảng bị đọc
-- nhiều nhất trong hệ và không có lý do gì để nó thành một danh bạ.
-- ============================================================================================
CREATE TABLE otp_rate_limits (
  org_id        uuid NOT NULL REFERENCES organizations(id),
  -- 'DEST' = theo đích nhận (làm chậm) · 'CALLER' = theo người gọi (khoá được).
  bucket_kind   text NOT NULL CHECK (bucket_kind IN ('DEST', 'CALLER')),
  bucket_hash   bytea NOT NULL CHECK (octet_length(bucket_hash) = 32),
  window_start  timestamptz NOT NULL,
  hits          integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  -- org_id ĐỨNG ĐẦU (ADR-013 / H14). Không có org_id thì đây là một oracle xuyên tổ chức trên
  -- chính tập số điện thoại: "tổ chức khác có gửi OTP tới số này không".
  PRIMARY KEY (org_id, bucket_kind, bucket_hash, window_start)
);

ALTER TABLE otp_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_rate_limits FORCE ROW LEVEL SECURITY;

CREATE POLICY otp_rate_limits_tenant_isolation ON otp_rate_limits
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON otp_rate_limits TO app_api;
GRANT INSERT (org_id, bucket_kind, bucket_hash, window_start, hits) ON otp_rate_limits TO app_api;
GRANT UPDATE (hits) ON otp_rate_limits TO app_api;
-- DELETE ở MỨC BẢNG để dọn cửa sổ cũ. Đây là một quyền THẬT SỰ nguy hiểm và nó được cấp có ý
-- thức: một `api` BỊ CHIẾM xoá sạch bảng này là tắt được E3(2). Cùng hạn chế cấu trúc đã ghi cho
-- E3(1) ở packages/identity/src/mfa-credentials.ts — không tránh được nếu giữ E3 ở tầng ứng dụng,
-- vì bỏ GRANT là bỏ luôn cơ chế và thu hẹp xuống một hàm SECURITY DEFINER là thứ mục (C) của
-- hardening.always.sql CẤM.
GRANT DELETE ON otp_rate_limits TO app_api;

-- ============================================================================================
-- (5) PHIÊN KHÁCH — E5
--
-- E5: *"Link chuyển tiếp vẫn dùng được, nhưng người nhận phải qua OTP; hệ thống ghi danh tính
-- THỰC TẾ ĐÃ XÁC THỰC, không phải danh tính người được mời."*
--
-- Vì vậy bảng này có `verified_contact_id` TÁCH khỏi `rfq_invitations.contact_id`. Hai cột có thể
-- khác nhau và đó là hành vi ĐƯỢC THIẾT KẾ, không phải một ca lỗi.
--
-- PHẦN NÓ KHÔNG CHỨNG MINH ĐƯỢC, và phải nói ra: `verified_contact_id` là NGƯỜI GIỮ KÊNH đã nhận
-- OTP, KHÔNG phải con người đang ngồi trước màn hình. Một người chuyển tiếp cả link lẫn mã OTP
-- vừa đọc được cho đồng nghiệp thì hệ thống ghi nhận người giữ kênh. Không cơ chế nào trong S1
-- phân biệt được hai ca đó; câu này phải vào §4 của ma trận khi [INV-E5] được gắn thẻ.
-- ============================================================================================
CREATE TABLE guest_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id),
  invitation_id        uuid NOT NULL,
  token_hash           bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  verified_contact_id  uuid NOT NULL,
  verified_channel     text NOT NULL CHECK (verified_channel IN ('EMAIL', 'SMS', 'ZALO_ZNS')),
  otp_verified_at      timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  revoked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, invitation_id) REFERENCES rfq_invitations (org_id, id),
  FOREIGN KEY (org_id, verified_contact_id) REFERENCES supplier_contacts (org_id, id),
  UNIQUE (org_id, token_hash),
  CONSTRAINT guest_sessions_han_sau_tao CHECK (expires_at > created_at)
);

ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY guest_sessions_tenant_isolation ON guest_sessions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON guest_sessions TO app_api;
GRANT INSERT (org_id, invitation_id, token_hash, verified_contact_id, verified_channel, expires_at)
  ON guest_sessions TO app_api;
-- CHỈ `revoked_at`. `otp_verified_at` KHÔNG sửa được — nó là mốc để trả lời "phiên này đã qua OTP
-- lúc nào", và một mốc sửa được là một mốc không dùng để phán xét được. `verified_contact_id`
-- cũng không: viết lại danh tính đã xác thực chính là thứ E5 sinh ra để chặn.
GRANT UPDATE (revoked_at) ON guest_sessions TO app_api;

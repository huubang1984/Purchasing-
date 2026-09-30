-- ==============================================================================================
-- tools/do-lich-su-gia/gieo.sql — [S1.9101 / S4.4a] GIEO DỮ LIỆU ĐO LỊCH SỬ GIÁ (spec S4 §2.5 ㉓, §4.5)
--
-- Ngưỡng GIẢ ĐỊNH của spec: p95 đọc lịch sử MỘT hàng chuẩn < 500 ms ở 5.000 gói × 20 dòng. Tệp này dựng quy mô ấy trên một
-- CSDL THỬ đã qua `migrate()`; `do.sql` đo. Đây là phép đo có biên bản (T5 ⑷), KHÔNG phải test và không chạy trong CI.
--
-- Đi qua ĐÚNG các cạnh của đường thật bằng SQL thô dưới vai chủ cụm (khuôn fixture `anh-xa.int.test.ts`): mọi trigger ENABLE
-- ALWAYS vẫn chạy — gói vào PENDING_APPROVAL có ngân sách, một chữ ký, khoá RFQ rồi OPEN; mỗi nhà cung cấp một lời mời, token,
-- thử thách OTP, phiên khách, báo giá, biên nhận; ánh xạ `NGUOI_DUYET` của người quản lý dữ liệu TRƯỚC khi mở; đóng sớm, yêu cầu
-- mở thầu, một chữ ký, rồi giao dịch mở thầu (bản rõ, `UNSEALED`, `EXECUTED`). Mỗi gói một giao dịch (`COMMIT` trong khối), nên
-- `unsealed_at` và `ghi_luc` mang giờ thật tăng dần như một tổ chức thật. Phong bì là bản rõ đặt thẳng vào `rfq_unsealed_bids`
-- — hàm đo chỉ đọc bản rõ, không đọc phong bì, nên không cần mã hoá.
--
-- Chạy (CSDL THỬ, không bao giờ trên CSDL thật — tệp tạo một tổ chức mới mỗi lần chạy):
--   psql "$URL_CUM_THU" -v so_goi=5000 -v so_dong=20 -v so_ncc=3 -v so_hang=200 -f tools/do-lich-su-gia/gieo.sql
--   psql "$URL_CUM_THU" -f tools/do-lich-su-gia/do.sql
-- Một CSDL đã qua `migrate()`: ví dụ cụm cục bộ sau `pnpm gieo:demo`, hay một cụm `postgres:16` mà `migrate()` của
-- `@trustprocure/db` vừa chạy lên.
--
-- Phân bố: dòng `k` của gói `g` ánh xạ sang hàng chuẩn `(g · 7 + k) mod so_hang` — mỗi hàng chuẩn có ~ so_goi · so_dong / so_hang
-- dòng (500 ở quy mô mặc định), rải trên các gói. Một dòng trong bốn dùng đơn vị `tấn` (quy đổi chung về gốc `kg`), còn lại `kg`.
-- ==============================================================================================
\set ON_ERROR_STOP on
\if :{?so_goi}
\else
  \set so_goi 5000
\endif
\if :{?so_dong}
\else
  \set so_dong 20
\endif
\if :{?so_ncc}
\else
  \set so_ncc 3
\endif
\if :{?so_hang}
\else
  \set so_hang 200
\endif

-- Byte ngẫu nhiên không cần `pgcrypto` (lược đồ không cài nó): hàm TẠM của phiên, không để lại gì trong lược đồ.
CREATE FUNCTION pg_temp.ngau(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS
  'SELECT substring(decode(repeat(md5(random()::text || clock_timestamp()::text), (n + 15) / 16), ''hex'') FROM 1 FOR n)';

SELECT set_config('do_lsg.so_goi', :'so_goi', false),
       set_config('do_lsg.so_dong', :'so_dong', false),
       set_config('do_lsg.so_ncc', :'so_ncc', false),
       set_config('do_lsg.so_hang', :'so_hang', false);

DO $gieo$
DECLARE
  so_goi   integer := current_setting('do_lsg.so_goi')::integer;
  so_dong  integer := current_setting('do_lsg.so_dong')::integer;
  so_ncc   integer := current_setting('do_lsg.so_ncc')::integer;
  so_hang  integer := current_setting('do_lsg.so_hang')::integer;
  org      uuid;
  pm       uuid;  pm_s  uuid;
  d1       uuid;  d1_s  uuid;
  ql       uuid;  ql_s  uuid;
  cs       uuid;
  hang     uuid[] := '{}';
  h        uuid;
  rfq      uuid;
  ncc      uuid;  lh uuid;  lm uuid;  tk uuid;  tt uuid;  pk uuid;  bid uuid;  ver uuid;
  yc       uuid;
  bao_gia  uuid[];
  ban_ro   jsonb[];
  dong     jsonb;
  tong     numeric;
  tien     numeric;
  sl       numeric;
  g        integer;
  k        integer;
  s        integer;
  bat_dau  timestamptz := clock_timestamp();
BEGIN
  INSERT INTO organizations (name, slug)
  VALUES ('Do lich su gia', 'do-lsg-' || substr(md5(clock_timestamp()::text), 1, 8))
  RETURNING id INTO org;
  PERFORM set_config('app.org_id', org::text, false);

  INSERT INTO users (org_id, email, full_name) VALUES (org, 'pm@do-lsg.vn', 'Nguoi mua') RETURNING id INTO pm;
  INSERT INTO users (org_id, email, full_name) VALUES (org, 'gd@do-lsg.vn', 'Giam doc') RETURNING id INTO d1;
  INSERT INTO users (org_id, email, full_name) VALUES (org, 'ql@do-lsg.vn', 'Quan ly du lieu') RETURNING id INTO ql;
  INSERT INTO user_roles (org_id, user_id, role_code) VALUES (org, pm, 'PROCUREMENT_MANAGER'), (org, d1, 'DIRECTOR'), (org, ql, 'DATA_STEWARD');
  INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at)
  VALUES (org, pm, pg_temp.ngau(32), now() + interval '2 days', now()) RETURNING id INTO pm_s;
  INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at)
  VALUES (org, d1, pg_temp.ngau(32), now() + interval '2 days', now()) RETURNING id INTO d1_s;
  INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at)
  VALUES (org, ql, pg_temp.ngau(32), now() + interval '2 days', now()) RETURNING id INTO ql_s;
  INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id)
  VALUES (org, 1, '100000000000.00', 'VND', pm, pm_s) RETURNING id INTO cs;

  FOR k IN 1..so_hang LOOP
    INSERT INTO canonical_items (org_id, ma, don_vi_goc, tac_gia, session_id)
    VALUES (org, 'HANG-' || lpad(k::text, 5, '0'), 'kg', ql, ql_s) RETURNING id INTO h;
    INSERT INTO canonical_item_versions (org_id, canonical_item_id, ten, tac_gia, session_id)
    VALUES (org, h, 'Hang chuan ' || k, ql, ql_s);
    hang := hang || h;
  END LOOP;
  COMMIT;
  PERFORM set_config('app.org_id', org::text, false);

  FOR g IN 1..so_goi LOOP
    INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id)
    VALUES (org, 'Goi do ' || g, now() + interval '7 days', false, pm, pm_s) RETURNING id INTO rfq;
    FOR k IN 1..so_dong LOOP
      INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id)
      VALUES (org, rfq, k, 'Vat tu ' || g || '-' || k, (1 + (g + k) % 9)::numeric,
              CASE WHEN k % 4 = 0 THEN 'tấn' ELSE 'kg' END, pm, pm_s);
    END LOOP;
    INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id)
    VALUES (org, rfq, '1000000000.00', 'VND', cs, pm, pm_s);
    UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = pm, submitted_by_session_id = pm_s WHERE id = rfq;
    FOR k IN 1..so_dong LOOP
      INSERT INTO rfq_item_mappings (org_id, rfq_id, line_no, nguon, canonical_item_id, phien_ban_bo_chuan_hoa, dau_vao,
                                     tac_gia, session_id)
      VALUES (org, rfq, k, 'NGUOI_DUYET', hang[1 + (g * 7 + k) % so_hang], 1, '{}', ql, ql_s);
    END LOOP;
    INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES (org, rfq, d1, d1_s);
    INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by,
                                  created_by_session_id)
    VALUES (org, rfq, 'ECDH_P256', pg_temp.ngau(91), pg_temp.ngau(80), 'do-v1', pm, pm_s);
    UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = pm, opened_by_session_id = pm_s WHERE id = rfq;

    bao_gia := '{}';
    ban_ro := '{}';
    FOR s IN 1..so_ncc LOOP
      INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id)
      VALUES (org, 'NCC ' || g || '-' || s, pm, pm_s) RETURNING id INTO ncc;
      INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id)
      VALUES (org, ncc, 'Nguoi ban', 'ncc' || g || '-' || s || '@do-lsg.vn', '0900000001', pm, pm_s) RETURNING id INTO lh;
      INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id)
      VALUES (org, rfq, ncc, lh, 'EMAIL', pm, pm_s) RETURNING id INTO lm;
      INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id)
      VALUES (org, lm, pg_temp.ngau(32), 'BID_SUBMISSION', now() + interval '2 days', pm, pm_s) RETURNING id INTO tk;
      INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, destination_hash,
                                             pepper_version, expires_at, consumed_at)
      VALUES (org, lm, tk, lh, 'SMS', pg_temp.ngau(32), pg_temp.ngau(32), 'do-v1', now() + interval '2 days', now())
      RETURNING id INTO tt;
      INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at)
      VALUES (org, lm, tt, pg_temp.ngau(32), lh, 'SMS', now() + interval '2 days') RETURNING id INTO pk;
      INSERT INTO vendor_bids (org_id, invitation_id) VALUES (org, lm) RETURNING id INTO bid;
      INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id)
      VALUES (org, bid, pg_temp.ngau(64), pk) RETURNING id INTO ver;
      INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature)
      VALUES (org, ver,
              'trustprocure-receipt-v1' || E'\n' || 'alg=ECDSA_P256_SHA256' || E'\n' || 'kid=k1' || E'\n' || 'rfq_id=' || rfq || E'\n' ||
              'bid_id=' || bid || E'\n' || 'version=1' || E'\n' || 'ciphertext_sha256=' || repeat('a', 64) || E'\n' ||
              'submitted_at=2026-09-30T00:00:00.000000Z' || E'\n',
              pg_temp.ngau(70));
      -- Phong bì như trình duyệt dựng: `amount` = số lượng × đơn giá, `totalAmount` = Σ `amount`.
      dong := '[]';
      tong := 0;
      FOR k IN 1..so_dong LOOP
        sl := (1 + (g + k) % 9)::numeric;
        tien := round(sl * (1000 + ((g * 31 + k * 17 + s * 101) % 99000)), 2);
        tong := tong + tien;
        dong := dong || jsonb_build_object('lineNo', k, 'unitPrice', (tien / sl)::text, 'amount', tien::text);
      END LOOP;
      bao_gia := bao_gia || ver;
      ban_ro := ban_ro || jsonb_build_object('totalAmount', tong::text, 'currency', 'VND', 'lines', dong);
    END LOOP;

    UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de do lich su gia',
                            closed_by = pm, closed_by_session_id = pm_s
     WHERE id = rfq;
    INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id)
    VALUES (org, rfq, 'den gio mo thau', pm, pm_s) RETURNING id INTO yc;
    INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES (org, yc, d1, d1_s);
    UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = yc;
    COMMIT;
    PERFORM set_config('app.org_id', org::text, false);

    FOR s IN 1..so_ncc LOOP
      INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES (org, yc, bao_gia[s], ban_ro[s]);
    END LOOP;
    UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = rfq;
    UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = yc;
    COMMIT;
    PERFORM set_config('app.org_id', org::text, false);

    IF g % 500 = 0 THEN
      RAISE NOTICE 'da gieo % / % goi (% s)', g, so_goi, round(extract(epoch FROM clock_timestamp() - bat_dau));
    END IF;
  END LOOP;
  RAISE NOTICE 'xong: to chuc % — % goi x % dong x % nha cung cap, % hang chuan (% s)',
    org, so_goi, so_dong, so_ncc, so_hang, round(extract(epoch FROM clock_timestamp() - bat_dau));
END
$gieo$;

ANALYZE;

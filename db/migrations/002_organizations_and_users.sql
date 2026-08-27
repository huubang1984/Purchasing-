-- db/migrations/002_organizations_and_users.sql
-- Tổ chức và người dùng. Đây là nơi Row-Level Security lần đầu được áp dụng; mọi bảng có
-- org_id về sau đều lặp lại đúng khuôn này (ADR-003, bất biến F1).
--
-- ============================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: MỘT BẢNG = MỘT FILE, KHÔNG CHIA ĐÔI
-- ============================================================================
-- Bộ chạy migration chạy MỖI FILE trong MỘT transaction riêng (packages/db/src/migrate.ts).
-- Hệ quả trực tiếp: nếu CREATE TABLE nằm ở file N còn ENABLE/FORCE ROW LEVEL SECURITY nằm ở
-- file N+1, thì một lần migrate() hỏng giữa chừng — hết dung lượng đĩa, deploy bị giết, mất
-- kết nối — để lại PRODUCTION với một bảng có org_id mà KHÔNG có RLS. Không có gì báo động;
-- bảng chỉ đơn giản là đọc được xuyên tổ chức cho tới lần deploy sau.
--
-- Vì vậy với MỖI bảng, năm thứ sau BẮT BUỘC nằm trong CÙNG một file:
--   CREATE TABLE · ENABLE ROW LEVEL SECURITY · FORCE ROW LEVEL SECURITY ·
--   TOÀN BỘ CREATE POLICY · TOÀN BỘ GRANT.
-- Ràng buộc này được cưỡng chế bằng máy ở db/migration-shape.test.ts (đọc từng file .sql,
-- không cần database), và trạng thái cuối cùng được canh thêm ở db/rls-coverage.int.test.ts.
--
-- ============================================================================
-- [S11-T3] BA DẠNG POLICY BỊ CẤM
-- ============================================================================
--   (1) USING (app_current_org_id() IS NULL OR org_id = app_current_org_id())
--       — "tiện" cho job nền và migration, nhưng nó biến MỌI phiên quên gắn tổ chức thành
--       phiên thấy TOÀN BỘ dữ liệu. Fail-open, đúng ngược hướng thiết kế của
--       app_current_org_id() (trả NULL để không hàng nào khớp).
--   (2) Mọi coalesce(...) phục vụ mục đích trên — vd. coalesce(app_current_org_id(), org_id).
--       Cùng một lỗ hổng, viết bằng chữ khác.
--   (3) Policy không có vế kiểm HÀNG MỚI (WITH CHECK).
-- Cả ba bị chặn tự động ở db/rls-coverage.int.test.ts (đọc pg_policy, khoá cả hình DẠNG của
-- biểu thức lẫn HÀNH VI fail-closed khi chưa gắn tổ chức).
--
-- Ghi chú đã tự kiểm chứng trên PostgreSQL 16.15, sửa một phát biểu sai lưu hành nội bộ:
-- với policy FOR ALL CÓ vế USING, Postgres TỰ dùng lại biểu thức USING làm WITH CHECK khi
-- WITH CHECK bị bỏ trống — đo thật: INSERT mang org_id lạ và UPDATE chuyển org đều bị chặn
-- ("new row violates row-level security policy"). Nên "thiếu WITH CHECK" KHÔNG tự động là lỗ
-- hổng ở dạng policy đó. Dự án vẫn BẮT BUỘC viết WITH CHECK tường minh, nhưng vì lý do đúng:
-- (a) vế kiểm hàng-mới trở thành thứ đọc thấy được khi kiểm toán thay vì một hành vi mặc định
-- phải nhớ; (b) ca thật sự nguy hiểm là policy TÁCH theo lệnh (FOR SELECT ... + FOR INSERT
-- WITH CHECK (true)) — ở đó không có gì để dùng lại, và phép kiểm tự động khoá luôn cả dạng
-- "WITH CHECK (true)".
--
-- ============================================================================
-- MÔ HÌNH ĐE DOẠ — RLS CHẶN GÌ VÀ KHÔNG CHẶN GÌ
-- ============================================================================
-- app.org_id là một GUC tuỳ biến thông thường: BẤT KỲ phiên nào cũng tự đặt được, kể cả
-- app_api. Nói cho rõ để không ai trích dẫn các test dưới đây quá lời:
--   RLS CHẶN được: quên "WHERE org_id = ?", IDOR tầng ứng dụng (đoán ID của tổ chức khác),
--     lỗi logic truy vấn, JOIN sót điều kiện.
--   RLS KHÔNG chặn được: SQL injection (kẻ tấn công chèn set_config rồi đọc thoải mái), hay
--     một tiến trình API đã bị chiếm quyền. Bí mật giá thầu KHÔNG dựa vào RLS — nó dựa vào
--     phong bì mã hoá và ADR-006 (app_api không có khả năng giải mã).

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- organizations không có cột org_id; chính id của nó là tổ chức. Bảng gốc của cây tenant.
-- FORCE là bắt buộc, không chỉ ENABLE — xem giải thích dài ở bảng users bên dưới.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY organizations_tenant_isolation ON organizations
  USING (id = app_current_org_id())
  WITH CHECK (id = app_current_org_id());

-- Cố ý KHÔNG có mệnh đề "TO app_api, app_unseal": không có TO, policy áp cho PUBLIC, tức
-- áp cho MỌI role không được miễn trừ — kể cả role đăng nhập của ứng dụng (app_api_login) và
-- mọi role sẽ được thêm về sau. Liệt kê role trong TO là danh sách phải nhớ cập nhật; bỏ TO
-- là mặc định đóng. Đây là cùng một hướng bất biến với hàng rào depcruise của Task 7.
GRANT SELECT, UPDATE ON organizations TO app_api;
-- Cố ý KHÔNG cấp INSERT trên organizations cho app_api: với WITH CHECK ở trên, một hàng mới
-- phải mang id BẰNG tổ chức đang gắn — mà tổ chức đó đã tồn tại (id là PRIMARY KEY). Quyền
-- này không thể dùng được trong bất kỳ đường đi nào, và một quyền không dùng được chỉ làm
-- người đọc sau tưởng "app_api tạo được tổ chức". Một tổ chức không tự đẻ ra tổ chức khác;
-- việc mở tài khoản khách hàng thuộc đường vận hành, không thuộc app_api.
GRANT SELECT ON organizations TO app_unseal;

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id),
  email      text NOT NULL,
  full_name  text NOT NULL,
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Duy nhất theo (org_id, email), KHÔNG phải theo email toàn cục. Ràng buộc duy nhất toàn
  -- cục sẽ rò rỉ xuyên tổ chức qua chính thông báo lỗi: "duplicate key" khi thêm một email
  -- là bằng chứng tổ chức KHÁC đang có người đó — RLS không che được lỗi ràng buộc, vì kiểm
  -- tra unique chạy dưới quyền hệ thống trên toàn bảng.
  --
  -- Chỉ mục của ràng buộc này là (org_id, email) với org_id đứng ĐẦU, nên nó phục vụ luôn
  -- mọi tra cứu chỉ theo org_id — kể cả vị từ org_id = app_current_org_id() của policy RLS.
  -- Vì vậy cố ý KHÔNG tạo thêm một chỉ mục riêng trên (org_id): nó sẽ là bản sao thừa của
  -- tiền tố này, tốn chi phí ghi mà không thêm đường truy cập nào.
  UNIQUE (org_id, email)
);

-- FORCE là bắt buộc, không chỉ ENABLE. Đã tự kiểm chứng trên PostgreSQL 16.15 với một role
-- CHỦ SỞ HỮU bảng không phải superuser, cùng dữ liệu và cùng policy:
--     có FORCE   -> chủ sở hữu đọc được 1/2 hàng (policy có hiệu lực)
--     không FORCE-> chủ sở hữu đọc được 2/2 hàng (được miễn trừ, thấy toàn bộ)
-- Đây không phải tình huống giả định: trong kịch bản triển khai thật của dự án (xem
-- db/migrations.int.test.ts, role "trien_khai"), bảng thuộc sở hữu của role deploy — một role
-- thường, có CREATEROLE và sở hữu database, KHÔNG phải superuser. Thiếu FORCE thì mọi kết nối
-- chạy dưới role đó đọc xuyên tổ chức.
--
-- Giới hạn phải nói rõ để không ai đọc quá lời phép đo: SUPERUSER bỏ qua RLS bất kể ENABLE hay
-- FORCE. Đã đo cùng lần: chủ sở hữu là superuser đọc 2/2 hàng ngay cả khi FORCE đang bật.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation ON users
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT, INSERT, UPDATE ON users TO app_api;
-- Cố ý KHÔNG cấp gì trên users cho app_unseal. Vai trò đó là runtime mở thầu; nó không có
-- việc gì với họ tên và email — dữ liệu cá nhân — của người dùng. Không có consumer nào ở S0
-- cần quyền này, và một GRANT thêm vào "cho chắc" là thứ không ai gỡ ra nữa. Task sau thật sự
-- cần thì cấp tường minh kèm lý do, đúng khuôn của 001 với pgcrypto.

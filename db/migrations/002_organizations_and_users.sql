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

-- ============================================================================
-- [CR3 — vòng fix 1] RÀNG BUỘC DUY NHẤT TOÀN CỤC LÀ MỘT ORACLE XUYÊN TỔ CHỨC
-- ============================================================================
-- `slug` là UNIQUE TOÀN CỤC — đúng thứ mà bình luận ở bảng users bên dưới (dòng "Duy nhất
-- theo (org_id, email), KHÔNG phải theo email toàn cục") tuyên bố dự án đã tránh. Bản đầu
-- của file này viết đúng nguyên lý ở một bảng rồi không áp cho bảng kia, cách nhau 30 dòng.
--
-- Vì sao KHÔNG bỏ UNIQUE: slug là định danh trong URL, phải duy nhất toàn cục để phân giải
-- được. Bỏ ràng buộc là làm hỏng tính năng, không phải vá lỗ hổng.
-- Vì sao lỗ hổng vẫn thật: app_api có UPDATE nên nó DÙNG được ràng buộc đó làm oracle nhị
-- phân trên một không gian tên ĐOÁN ĐƯỢC (slug sinh từ tên công ty). Đã đo trên PostgreSQL
-- 16.15 bằng role đăng nhập thật app_api_login, RLS bật đầy đủ, tenant context đúng:
--     UPDATE organizations SET slug='cong-ty-b'          WHERE id=app_current_org_id();
--       -> ERROR: duplicate key value violates unique constraint "organizations_slug_key"
--     UPDATE organizations SET slug='khong-ai-dung-slug' WHERE id=app_current_org_id();
--       -> UPDATE 1
-- Hai thông báo khác nhau = "đối thủ X có mặt trên sàn không". Trên sàn thầu kín đó là tin
-- có giá. RLS không che được: kiểm tra unique chạy dưới quyền hệ thống trên TOÀN bảng.
--
-- Bản vá: THU HẸP QUYỀN, không đụng ràng buộc. app_api chỉ được UPDATE đúng cột `name`.
-- Đã đo lại sau vá, cùng kịch bản: cả hai câu UPDATE slug đều trả ĐÚNG MỘT thông báo
-- "permission denied for table organizations" (không phân biệt được slug tồn tại hay không),
-- còn "UPDATE ... SET name=..." vẫn "UPDATE 1" và SELECT vẫn đọc được hàng của mình.
-- Đổi slug thuộc đường VẬN HÀNH, không thuộc app_api — cùng lý do với INSERT bên dưới.
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
GRANT SELECT ON organizations TO app_api;
-- [CR3] UPDATE giới hạn theo CỘT — xem khối giải thích trên CREATE TABLE organizations.
-- Cảnh báo cho người đọc test về sau: quyền CỘT KHÔNG hiện trong
-- information_schema.role_table_grants (đã đo: sau bản vá này view đó chỉ còn dòng SELECT).
-- Nó chỉ hiện ở information_schema.role_column_grants. Khẳng định quyền ở
-- db/rls-coverage.int.test.ts phải đọc CẢ HAI view, nếu không nó xanh vì lý do sai.
GRANT UPDATE (name) ON organizations TO app_api;
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

-- [vòng fix 2 — Minor] users_pkey là ORACLE XUYÊN TỔ CHỨC CÙNG LỚP VỚI CR3, và nguyên lý viết
-- ngay trong khối CREATE TABLE ở trên ("ràng buộc duy nhất TOÀN CỤC sẽ rò rỉ xuyên tổ chức qua
-- chính thông báo lỗi") lại KHÔNG được áp cho `id` — đúng khuôn "viết nguyên lý ở đây, quên áp
-- cách đó 50 dòng" mà CR3 vừa sửa cho organizations.slug.
-- Đo trên PostgreSQL 16.15, role đăng nhập thật app_api_login đã gắn tổ chức A:
--     INSERT INTO users (id, org_id, email, full_name) VALUES (<id CÓ THẬT của tổ chức B>, ...)
--       -> ERROR: duplicate key value violates unique constraint "users_pkey"
--     cùng câu với một id không ai dùng -> INSERT 0 1
-- Khác CR3 ở chỗ khai thác thực tế ≈ 0: id sinh bằng gen_random_uuid() (122 bit ngẫu nhiên),
-- không đoán được như slug sinh từ tên công ty. Nhưng KHUÔN thì phải đóng, và cách đóng giống
-- hệt CR3: THU HẸP QUYỀN THEO CỘT, không đụng ràng buộc.
--   `id`         : không cấp -> app_api không viết được nó, DEFAULT gen_random_uuid() lo phần đó.
--   `org_id`     : cấp cho INSERT (ứng dụng phải ghi tổ chức của hàng mới; WITH CHECK ở trên ép
--                  nó bằng tổ chức đang gắn) nhưng KHÔNG cấp cho UPDATE — chuyển một hàng sang
--                  tổ chức khác không thuộc bất kỳ đường đi hợp lệ nào của app_api.
--   `status`     : cấp cho cả hai — đình chỉ/khôi phục người dùng là việc của ứng dụng, và giá
--                  trị bị CHECK gói trong ba hằng nên nó không làm oracle được.
--   `created_at` : không cấp, đã có DEFAULT.
-- Đã đo lại sau vá, cùng kịch bản: cả hai câu INSERT có cột `id` trả ĐÚNG MỘT thông báo
-- "permission denied for table users" (không phân biệt được id tồn tại hay không), còn INSERT
-- không ghi `id` vẫn "INSERT 0 1" và UPDATE email/full_name/status vẫn chạy.
-- Cùng cảnh báo như CR3: quyền CỘT KHÔNG hiện trong information_schema.role_table_grants, chỉ
-- hiện ở role_column_grants — khẳng định quyền ở db/rls-coverage.int.test.ts đọc CẢ HAI view.
GRANT SELECT ON users TO app_api;
GRANT INSERT (org_id, email, full_name, status) ON users TO app_api;
GRANT UPDATE (email, full_name, status) ON users TO app_api;
-- Cố ý KHÔNG cấp gì trên users cho app_unseal. Vai trò đó là runtime mở thầu; nó không có
-- việc gì với họ tên và email — dữ liệu cá nhân — của người dùng. Không có consumer nào ở S0
-- cần quyền này, và một GRANT thêm vào "cho chắc" là thứ không ai gỡ ra nữa. Task sau thật sự
-- cần thì cấp tường minh kèm lý do, đúng khuôn của 001 với pgcrypto.

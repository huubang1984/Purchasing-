-- db/migrations/005_identity.sql
-- Vai trò và quyền. Ma trận vai trò lấy từ mục 25 của đặc tả (bất biến D1, D3, D5).
--
-- ============================================================================
-- LỆCH KHỎI BRIEF (1/3): DANH MỤC VAI TRÒ LÀ TOÀN CỤC, KHÔNG THEO TỪNG TỔ CHỨC
-- ============================================================================
-- Brief đề nghị `roles`/`role_permissions` mang `org_id`, kèm một hàm
-- `seed_default_roles(p_org_id)`, một trigger AFTER INSERT trên `organizations`, và một khối
-- DO chạy `FOR v_org IN SELECT id FROM organizations LOOP`. Thiết kế đó KHÔNG CHẠY ĐƯỢC dưới
-- role deploy thật của dự án. Đã đo trên PostgreSQL 16.15, mô hình cô lập của đúng tình huống
-- migration (role thường SỞ HỮU bảng, có EXECUTE trên app_current_org_id(), ENABLE+FORCE RLS,
-- policy chuẩn `org_id = app_current_org_id()`, và `app.org_id` CHƯA được gắn):
--
--   ĐO-1a  SELECT id FROM <bảng gốc>                       -> rowCount = 0
--          => vòng lặp seed cho các tổ chức ĐÃ TỒN TẠI là NO-OP IM LẶNG: mọi tổ chức cũ
--             không nhận được vai trò nào, migrate() vẫn báo thành công.
--   ĐO-1b  INSERT INTO <bảng org-scoped> (chưa gắn tenant) -> ERROR: new row violates
--          row-level security policy for table "do_roles"
--          => câu INSERT của chính hàm seed GÃY CỨNG, migration không áp dụng được.
--   ĐO-1c  cùng câu INSERT khi ĐÃ gắn tenant               -> THÀNH CÔNG (đối chứng)
--   ĐO-1d  SELECT count(*) dưới CHỦ SỞ HỮU (chưa gắn)      -> 0
--   ĐO-1e  cùng câu dưới SUPERUSER                         -> 1
--
-- Hai hệ quả, và cả hai đều là lý do thiết kế chứ không phải phiền toái:
--   (1) Brief chỉ "chạy được" vì các test tích hợp migrate bằng SUPERUSER (postgres), thứ
--       BỎ QUA RLS bất kể ENABLE hay FORCE — đúng cảnh báo đã ghi ở 002. Chú thích của brief
--       nói "hoặc bằng role chủ sở hữu như trong test" là SAI: FORCE ràng buộc CẢ chủ sở hữu
--       (đó là toàn bộ lý do 002 bật FORCE), chỉ superuser mới được miễn.
--   (2) ĐO-1d/1e là phiên bản nguy hiểm hơn: một phép PHÁN XÉT bất biến D3 đọc bảng
--       org-scoped ở thời điểm deploy sẽ thấy 0 hàng dưới role deploy và KẾT LUẬN "không có
--       vi phạm" — fail-OPEN, và xanh giả ở đúng chỗ quan trọng nhất. Đây chính là bài học
--       "môi trường chạy test che đột biến" của Task 6, gặp lại ở một bề mặt mới.
--
-- Nên `permissions`, `roles`, `role_permissions` là DANH MỤC TOÀN CỤC: không có org_id, không
-- RLS, không role nào của ứng dụng ghi được. Tính theo-tổ-chức nằm ở `user_roles` — bảng DUY
-- NHẤT có org_id, và cũng là bảng duy nhất ứng dụng ghi. Cô lập tổ chức (F1) không suy giảm:
-- xem khối "[INV-F1]" ở user_roles bên dưới.
--
-- Đặc tả có nói mỗi doanh nghiệp tự cấu hình vai trò (mục 21/25). Điều đó KHÔNG bị bỏ: chính
-- đặc tả xếp "Policy engine tổng quát và ma trận phê duyệt cấu hình được" vào S3
-- (docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md, mục "Ngoài phạm vi"), và
-- ở S0 sáu vai trò dưới đây GIỐNG HỆT NHAU cho mọi tổ chức — nhân bản chúng theo từng tổ chức
-- mua đúng 0 khả năng cấu hình mà trả bằng ba hệ quả đo được ở trên. Khi S3 cần vai trò riêng
-- theo tổ chức, đường đi là một bảng ĐÈ theo tổ chức, không phải nhân bản danh mục.
--
-- ============================================================================
-- LỆCH KHỎI BRIEF (2/3): ỨNG DỤNG KHÔNG GHI ĐƯỢC MA TRẬN QUYỀN
-- ============================================================================
-- Brief cấp "GRANT SELECT, INSERT, UPDATE, DELETE ON roles, role_permissions, user_roles TO
-- app_api". Câu hỏi phải trả lời thẳng: AI ĐƯỢC SỬA `role_permissions`, VÀ BẰNG ĐƯỜNG NÀO?
-- Với quyền đó, câu trả lời là "một app_api bị chiếm, bằng một câu UPDATE" — và khi ấy D3
-- (phân tách nhiệm vụ) sụp đổ mà không test nào đỏ, vì D3 là một bất biến về DỮ LIỆU.
-- Ở file này: `permissions`, `roles`, `role_permissions` chỉ cấp SELECT. Đường sửa DUY NHẤT
-- là một migration đánh số MỚI — cùng khuôn mà 002 đã dùng cho `organizations` (app_api không
-- có INSERT, và chỉ UPDATE được đúng cột `name`).
--
-- ============================================================================
-- LỆCH KHỎI BRIEF (3/3): D3 ĐƯỢC CƯỠNG CHẾ Ở HAI TẦNG, MỘT TRONG SỐ ĐÓ Ở MỨC NGƯỜI DÙNG
-- ============================================================================
-- D3 (docs/TEST-PLAN.md): "Chuỗi tạo RFQ -> chọn nhà cung cấp -> mở thầu -> award -> duyệt
-- không nằm trọn trong tay một người". Nó nói NGƯỜI, không nói VAI TRÒ — và đó là chỗ brief
-- bỏ trống: sáu vai trò mặc định không vai nào ôm trọn chuỗi, nhưng `user_roles` là bảng ứng
-- dụng GHI ĐƯỢC, nên gán cho một người CẢ PROCUREMENT_MANAGER LẪN DIRECTOR là đủ để một
-- người nắm trọn chuỗi. Không lớp nào của brief nhìn thấy việc đó.
--   * Tầng 1 (mức VAI TRÒ, thời điểm deploy): hardening.always.sql mục (E2) phán xét danh mục
--     toàn cục — không vai trò nào được ôm trọn năm mã quyền của chuỗi. Đọc được vì danh mục
--     KHÔNG có RLS (xem ĐO-1d ở trên để biết vì sao điều đó là điều kiện cần).
--   * Tầng 2 (mức NGƯỜI DÙNG, thời điểm ghi): trigger `user_roles_phan_tach_nhiem_vu` bên
--     dưới. Phải ở thời điểm GHI vì `user_roles` là bảng app_api ghi được.
-- Năm mã quyền của chuỗi xuất hiện ở BA nơi (thân trigger dưới đây, hardening.always.sql,
-- packages/identity/src/permissions.ts). Có meta-test khoá cả ba, đúng khuôn §R3 đã dùng cho
-- thân app_current_org_id() và thân noi_chuoi_kiem_toan().
--
-- ============================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: bảng `user_roles` mang trọn CREATE TABLE + ENABLE + FORCE +
-- TOÀN BỘ POLICY + TOÀN BỘ GRANT trong CÙNG file này. Xem khối đầu 002.
-- ============================================================================

-- ------------------------------------------------------------------------------------------
-- (1) DANH MỤC QUYỀN — toàn cục, chỉ đọc với ứng dụng.
-- ------------------------------------------------------------------------------------------
CREATE TABLE permissions (
  code        text PRIMARY KEY,
  description text NOT NULL
);

INSERT INTO permissions (code, description) VALUES
  ('rfq.create',          'Tạo và sửa gói RFQ ở trạng thái nháp'),
  ('rfq.approve',         'Phê duyệt RFQ để mở cho nhà cung cấp báo giá'),
  ('rfq.invite',          'Chọn và mời nhà cung cấp'),
  ('rfq.unseal',          'Yêu cầu và thực hiện mở thầu'),
  ('rfq.unseal.approve',  'Phê duyệt yêu cầu mở thầu của người khác'),
  ('bid.view',            'Xem báo giá sau khi đã mở thầu'),
  ('evaluation.perform',  'Chấm điểm kỹ thuật và thương mại'),
  ('award.recommend',     'Lập đề xuất trao thầu'),
  ('po.approve',          'Phê duyệt đơn mua hàng'),
  ('supplier.manage',     'Quản lý hồ sơ nhà cung cấp'),
  ('audit.read',          'Đọc và xuất sổ kiểm toán');

-- Không có INSERT/UPDATE/DELETE cho bất kỳ role ứng dụng nào — xem "LỆCH KHỎI BRIEF (2/3)".
GRANT SELECT ON permissions TO app_api;
-- Cố ý KHÔNG cấp gì cho app_unseal: đường mở thầu chưa có consumer nào ở S0, và `hasPermission`
-- nối qua `users` mà app_unseal không có quyền đọc (quyết định của 002). Một GRANT thêm vào
-- "cho chắc" là thứ không ai gỡ ra nữa — cùng lý do đã ghi ở 002 cho `users`.

-- ------------------------------------------------------------------------------------------
-- (2) DANH MỤC VAI TRÒ — toàn cục.
--
-- `code` LÀM KHOÁ CHÍNH thay vì một cột `id uuid`: mã vai trò là thứ mọi tầng đọc và ghi log,
-- một uuid trung gian chỉ thêm một bảng tra cứu mà không đóng đường đi nào. Nó cũng gỡ hẳn một
-- lớp bề mặt mà 002 phải vá bằng quyền cột (`users_pkey` làm oracle xuyên tổ chức): danh mục
-- này toàn cục và chỉ đọc, nên không có oracle nào để đóng.
-- ------------------------------------------------------------------------------------------
CREATE TABLE roles (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles (code, name) VALUES
  ('REQUESTER',           'Người đề nghị mua'),
  ('BUYER',               'Nhân viên mua hàng'),
  ('TECHNICAL',           'Bộ phận kỹ thuật'),
  ('PROCUREMENT_MANAGER', 'Trưởng phòng mua hàng'),
  ('FINANCE',             'Tài chính'),
  ('DIRECTOR',            'Ban giám đốc');

GRANT SELECT ON roles TO app_api;

-- ------------------------------------------------------------------------------------------
-- (3) MA TRẬN QUYỀN THEO VAI TRÒ — mục 25 của đặc tả. Đây LÀ bất biến D3 dưới dạng dữ liệu.
--
-- HAI CẶP TRÔNG NHƯ XUNG ĐỘT MÀ CỐ Ý GIỮ, nói ra để không ai "sửa" chúng sau này:
--   * DIRECTOR có CẢ `rfq.unseal` LẪN `rfq.unseal.approve`. Đó KHÔNG phải tự-duyệt: D2 đòi
--     hai người khác nhau ở hai phiên khác nhau, và ràng buộc "người duyệt ≠ người yêu cầu"
--     là ràng buộc mức HÀNG (thuộc task máy trạng thái mở thầu), không phải mức ma trận. Nếu
--     vai trò duyệt mở thầu KHÔNG được phép tự yêu cầu mở thầu thì hai giám đốc không thể
--     thay nhau — tức chính D2 mới là thứ không thực hiện được.
--   * DIRECTOR và FINANCE có cả `award.recommend` lẫn `po.approve`. Cùng lập luận: D3 cấm
--     MỘT NGƯỜI ôm TRỌN chuỗi năm bước, không cấm chồng lấn hai bước liền kề.
-- ------------------------------------------------------------------------------------------
CREATE TABLE role_permissions (
  role_code       text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_code, permission_code)
);

-- Trigger canh D3 Ở MỨC VAI TRÒ. Nó được tạo TRƯỚC câu INSERT seed bên dưới, có chủ ý: bộ vai
-- trò mặc định của chính file này khi đó cũng ĐI QUA phép kiểm, thay vì được tin là đúng.
--
-- VÌ SAO LÀ TRIGGER CHỨ KHÔNG PHẢI MỘT PHÉP PHÁN XÉT Ở THỜI ĐIỂM DEPLOY. Bản đầu của Task 8
-- đặt phép kiểm này vào hardening.always.sql dưới dạng một câu SELECT trên `role_permissions`.
-- Nó GÃY, và cách nó gãy là một bài học đáng ghi lại: khuôn triển khai mà chính dự án này
-- kiểm thử (db/migrations.int.test.ts "[fix round 4 — N2] nhánh 1") là SUPERUSER bootstrap một
-- lần rồi MỌI deploy sau chạy dưới một role KHÔNG sở hữu bảng và KHÔNG có GRANT nào trên
-- chúng. Đo được: "Hardening ... (phan_xet) thất bại: permission denied for table
-- role_permissions" (SQLSTATE 42501) — migrate() chết trên một lược đồ HOÀN TOÀN ĐÚNG, tức
-- đúng cái bẫy QT1 cấm. Mọi mục phán xét khác của hardening chỉ đọc pg_catalog (mọi role đọc
-- được); mục đó là mục đầu tiên đọc một BẢNG NGHIỆP VỤ, và đó là lý do nó là mục đầu tiên gãy.
-- Đổi sang trigger thì phép kiểm chạy trong phiên của NGƯỜI GHI — người duy nhất có thể tạo ra
-- vi phạm — nên nó không đòi thêm bất kỳ quyền deploy nào, và nó canh LIÊN TỤC chứ không chỉ ở
-- thời điểm deploy. hardening.always.sql mục (E2) chỉ còn canh SỰ TỒN TẠI và THÂN của hàm này,
-- và việc đó đọc thuần pg_catalog.
CREATE OR REPLACE FUNCTION public.kiem_tra_ma_tran_quyen() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $tmt$
DECLARE
  con_thieu bigint;
BEGIN
  SELECT count(*) INTO con_thieu
    FROM unnest(ARRAY['rfq.create', 'rfq.invite', 'rfq.unseal',
                      'award.recommend', 'po.approve']) AS chuoi(ma)
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.role_permissions rp
            WHERE rp.role_code = NEW.role_code
              AND rp.permission_code = chuoi.ma);

  IF con_thieu = 0 THEN
    RAISE EXCEPTION 'Phân tách nhiệm vụ (D3): vai trò % ôm TRỌN chuỗi tạo RFQ -> chọn nhà cung cấp -> mở thầu -> award -> duyệt', NEW.role_code
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END
$tmt$;

CREATE TRIGGER role_permissions_ma_tran_quyen
  AFTER INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_ma_tran_quyen();
ALTER TABLE role_permissions ENABLE ALWAYS TRIGGER role_permissions_ma_tran_quyen;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('REQUESTER',           'rfq.create'),
  ('REQUESTER',           'evaluation.perform'),

  ('BUYER',               'rfq.create'),
  ('BUYER',               'rfq.invite'),
  ('BUYER',               'evaluation.perform'),
  ('BUYER',               'award.recommend'),

  ('TECHNICAL',           'evaluation.perform'),

  ('PROCUREMENT_MANAGER', 'rfq.create'),
  ('PROCUREMENT_MANAGER', 'rfq.invite'),
  ('PROCUREMENT_MANAGER', 'rfq.approve'),
  ('PROCUREMENT_MANAGER', 'rfq.unseal'),
  ('PROCUREMENT_MANAGER', 'bid.view'),
  ('PROCUREMENT_MANAGER', 'evaluation.perform'),
  ('PROCUREMENT_MANAGER', 'award.recommend'),
  ('PROCUREMENT_MANAGER', 'supplier.manage'),

  ('FINANCE',             'bid.view'),
  ('FINANCE',             'evaluation.perform'),
  ('FINANCE',             'award.recommend'),
  ('FINANCE',             'po.approve'),
  ('FINANCE',             'audit.read'),

  ('DIRECTOR',            'rfq.unseal'),
  ('DIRECTOR',            'rfq.unseal.approve'),
  ('DIRECTOR',            'bid.view'),
  ('DIRECTOR',            'award.recommend'),
  ('DIRECTOR',            'po.approve'),
  ('DIRECTOR',            'audit.read');

GRANT SELECT ON role_permissions TO app_api;

-- ------------------------------------------------------------------------------------------
-- (4) HÀM CANH PHÂN TÁCH NHIỆM VỤ Ở MỨC NGƯỜI DÙNG — bất biến D3, tầng 2.
--
-- [QT3] `SET search_path = pg_catalog` trên chính hàm, và MỌI tên bảng viết đủ `public.`.
-- Quy tắc "pg_catalog được tìm ngầm trước" PHÁ ĐƯỢC khi search_path NÊU TÊN pg_catalog ở vị
-- trí sau — xem khối GHIM TÊN HÀM ở packages/tenancy/src/with-tenant.ts. Trigger chạy dưới
-- search_path của PHIÊN GHI, tức của app_api, tức thứ dự án không kiểm soát.
--
-- KHÔNG phải SECURITY DEFINER, và đó là bắt buộc: mục (C) của hardening.always.sql cấm MỌI
-- hàm SECURITY DEFINER ngoài pg_catalog/information_schema. Hệ quả đã cân nhắc: hàm đọc
-- `public.user_roles` DƯỚI RLS của phiên ghi. Điều đó ĐÚNG chứ không phải giới hạn — phiên ghi
-- bắt buộc đang gắn đúng tổ chức của hàng mới (vế WITH CHECK của policy ép thế), nên nó nhìn
-- thấy TOÀN BỘ vai trò của người dùng đó trong tổ chức đó. Hàng `user_roles` của người dùng ở
-- tổ chức KHÁC không nhìn thấy, và cũng không cần: `hasPermission` nối qua `public.users` dưới
-- cùng RLS nên một hàng như thế là VÔ HIỆU (xem khối [INV-F1] bên dưới).
--
-- AFTER (không BEFORE) và FOR EACH ROW: trigger AFTER ROW được xếp hàng và bắn ở CUỐI câu
-- lệnh, nên một INSERT nhiều hàng được xét khi TẤT CẢ hàng của câu đó đã hiện diện. Một
-- BEFORE ROW sẽ bỏ lọt đúng ca "gán hai vai trò trong một câu INSERT".
-- ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kiem_tra_phan_tach_nhiem_vu() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $tpt$
DECLARE
  con_thieu bigint;
BEGIN
  SELECT count(*) INTO con_thieu
    FROM unnest(ARRAY['rfq.create', 'rfq.invite', 'rfq.unseal',
                      'award.recommend', 'po.approve']) AS chuoi(ma)
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.user_roles ur
             JOIN public.role_permissions rp ON rp.role_code = ur.role_code
            WHERE ur.org_id = NEW.org_id
              AND ur.user_id = NEW.user_id
              AND rp.permission_code = chuoi.ma);

  IF con_thieu = 0 THEN
    RAISE EXCEPTION 'Phân tách nhiệm vụ (D3): người dùng % sẽ nắm trọn chuỗi tạo RFQ -> chọn nhà cung cấp -> mở thầu -> award -> duyệt', NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END
$tpt$;

-- ------------------------------------------------------------------------------------------
-- (5) GÁN VAI TRÒ CHO NGƯỜI DÙNG — bảng DUY NHẤT có org_id trong file này.
--
-- [INV-F1] Vì sao cô lập tổ chức KHÔNG suy giảm khi danh mục vai trò là toàn cục: mọi câu hỏi
-- "người dùng U có quyền P trong tổ chức O không" đều đi qua `user_roles` (RLS) NỐI VỚI
-- `users` (RLS). Danh mục toàn cục chỉ trả lời "vai trò R gồm những quyền nào" — một sự thật
-- KHÔNG mang dữ liệu của tổ chức nào.
--
-- KHOÁ CHÍNH LÀ (org_id, user_id, role_code), KHÔNG phải (user_id, role_code). Đây là bản áp
-- dụng của bài học `users_pkey` ở 002: một ràng buộc DUY NHẤT TOÀN CỤC là một oracle xuyên tổ
-- chức qua chính thông báo lỗi ("duplicate key" = người dùng đó ở tổ chức khác ĐANG có vai trò
-- ấy). Đưa org_id vào khoá làm tính duy nhất trở thành theo-tổ-chức, nên không có oracle nào
-- để đóng — rẻ hơn hẳn việc vá bằng quyền cột như 002 phải làm.
--
-- DƯ LƯỢNG ĐÃ BIẾT, nói ra thay vì hứa suông: khoá này KHÔNG ép `org_id` phải khớp
-- `users.org_id` của cùng `user_id` (ép được thì cần UNIQUE (org_id, id) trên `users`, tức
-- sửa 002 — một migration ĐÃ ÁP DỤNG). Một app_api bị chiếm chèn được (tổ_chức_A,
-- người_của_B, DIRECTOR): vế WITH CHECK cho qua vì org_id đúng là tổ chức đang gắn, và khoá
-- ngoại `users(id)` chạy dưới quyền hệ thống nên cũng cho qua. Hàng đó VÔ HIỆU và đã đo được
-- vì sao: `hasPermission` nối `public.users u ON u.id = ur.user_id` dưới RLS của tổ chức A,
-- nơi người của B không tồn tại — truy vấn trả 0 hàng. Vế nối qua `users` vì thế KHÔNG phải
-- một tiện nghi để lọc `status`; nó là vế chịu lực của bất biến này. Có test đối kháng.
-- ------------------------------------------------------------------------------------------
CREATE TABLE user_roles (
  org_id     uuid NOT NULL REFERENCES organizations(id),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code  text NOT NULL REFERENCES roles(code),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, role_code)
);

-- Khoá chính đã có org_id đứng ĐẦU nên chỉ mục của nó phục vụ luôn vị từ RLS và mọi tra cứu
-- "vai trò của người dùng U trong tổ chức O". Cố ý KHÔNG tạo thêm chỉ mục nào — cùng lập luận
-- đã ghi ở `users` trong 002.

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY user_roles_tenant_isolation ON user_roles
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- ENABLE ALWAYS chứ không chỉ CREATE TRIGGER: một phiên đặt `session_replication_role =
-- 'replica'` bỏ qua trigger ORIGIN. Cùng lý do 003 dùng ENABLE ALWAYS cho sáu trigger sổ.
-- hardening.always.sql mục (E1) dựng lại trigger này và trạng thái ENABLE ALWAYS của nó ở MỌI
-- lần migrate() — không có nó, một DROP TRIGGER sau triển khai là vĩnh viễn (005 đã nằm trong
-- schema_migrations nên không chạy lại).
CREATE TRIGGER user_roles_phan_tach_nhiem_vu
  AFTER INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_phan_tach_nhiem_vu();
ALTER TABLE user_roles ENABLE ALWAYS TRIGGER user_roles_phan_tach_nhiem_vu;

-- Gán và thu hồi vai trò LÀ việc của ứng dụng (màn hình quản trị người dùng của từng tổ chức),
-- khác hẳn việc sửa MA TRẬN QUYỀN — xem "LỆCH KHỎI BRIEF (2/3)".
GRANT SELECT ON user_roles TO app_api;
-- INSERT theo CỘT, không theo bảng: `granted_at` đã có DEFAULT và là dấu thời gian do CSDL
-- đóng — bên ghi chọn được nó là một sổ gán vai trò sắp xếp lại được theo ý mình. Cùng khuôn
-- `occurred_at`/`created_at` ở 003 và 002.
GRANT INSERT (org_id, user_id, role_code) ON user_roles TO app_api;
-- DELETE (thu hồi vai trò) có, UPDATE KHÔNG: mọi thay đổi biểu diễn được bằng DELETE + INSERT,
-- và một UPDATE `role_code` là đúng đường đi mà trigger D3 khó soi nhất trong khi nó không mua
-- thêm khả năng nào. Ít bậc tự do hơn với cùng năng lực nghiệp vụ.
GRANT DELETE ON user_roles TO app_api;

-- db/migrations/008_suppliers.sql
-- Sổ nhà cung cấp mức Level 0/1 (S1.1). Bảng đầu tiên của S1, và là bảng tenant đầu tiên được
-- tạo SAU khi ADR-013 tồn tại — nên file này là chỗ ADR đó được biến thành câu lệnh.
--
-- ============================================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: MỘT BẢNG = MỘT FILE
-- ============================================================================================
-- Bộ chạy migration chạy MỖI FILE trong MỘT transaction riêng (packages/db/src/migrate.ts).
-- Với MỖI bảng, năm thứ sau BẮT BUỘC nằm trong CÙNG một file: CREATE TABLE ·
-- ENABLE ROW LEVEL SECURITY · FORCE ROW LEVEL SECURITY · TOÀN BỘ CREATE POLICY · TOÀN BỘ GRANT.
-- Cưỡng chế bằng máy ở db/migration-shape.test.ts.
--
-- Hai bảng nằm CÙNG một file vì bảng thứ hai có khoá ngoại vào bảng thứ nhất: tách ra là để lại
-- một cửa sổ mà `supplier_contacts` tồn tại trong khi bảng cha của nó thì chưa.
--
-- ============================================================================================
-- ADR-013 — VÌ SAO KHÔNG CÓ `UNIQUE (tax_code)` TOÀN CỤC, VÀ LÝ DO LÀ MỘT PHÉP ĐO
-- ============================================================================================
-- Một sổ nhà cung cấp DÙNG CHUNG toàn hệ thống là thứ định hướng sản phẩm mời gọi (Level 2 —
-- Supplier Passport). Nó bị từ chối ở S1 vì một lớp lỗi ĐÃ ĐƯỢC ĐO HAI LẦN trên chính lược đồ
-- này — PostgreSQL 16.15, role đăng nhập thật app_api_login, RLS bật đầy đủ, tenant context đúng:
--   * `organizations.slug` UNIQUE toàn cục -> hai thông báo lỗi khác nhau = một ORACLE NHỊ PHÂN
--     xuyên tổ chức ("đối thủ X có trên sàn không"). Xem 002, khối [CR3 — vòng fix 1].
--   * `users_pkey` cùng khuôn; khai thác thực tế ≈ 0 vì `id` là 122 bit ngẫu nhiên. Xem 002,
--     khối [vòng fix 2 — Minor]. Cách đóng CẢ HAI ca: THU HẸP QUYỀN THEO CỘT, không đụng ràng buộc.
--
-- Nguyên lý đã nằm sẵn ở 002: "ràng buộc duy nhất TOÀN CỤC sẽ rò rỉ xuyên tổ chức qua chính
-- thông báo lỗi — RLS không che được lỗi ràng buộc, vì kiểm tra unique chạy dưới quyền hệ thống
-- trên TOÀN bảng."
--
-- MST LÀM KHUÔN ẤY TỆ HƠN CẢ HAI CA TRÊN, KHÔNG NHẸ HƠN. `slug` phải đoán từ tên công ty; `id`
-- là 122 bit ngẫu nhiên. Mã số thuế thì CÔNG KHAI VÀ LIỆT KÊ ĐƯỢC — không gian tên hữu hạn, tra
-- cứu tự do. Một `UNIQUE (tax_code)` toàn cục biến "tổ chức mua nào đang làm việc với nhà cung
-- cấp nào" thành một câu hỏi TRA ĐƯỢC BẰNG INSERT, trên đúng tập dữ liệu có giá thương mại nhất
-- của một sàn thầu kín.
--
-- Vị từ được cưỡng chế bằng máy KHÔNG phải "mọi UNIQUE phải có org_id đứng đầu" — cách viết đó
-- đỏ oan trên `users_pkey` và `organizations_slug_key`. Vị từ đúng là: MỘT RÀNG BUỘC CHỈ LÀM
-- ORACLE ĐƯỢC KHI `app_api` GHI ĐƯỢC ĐỦ MỌI CỘT CỦA NÓ. Lớp canh: db/unique-oracle.int.test.ts.

CREATE TABLE suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  legal_name  text NOT NULL CHECK (octet_length(legal_name) > 0
                                   AND octet_length(legal_name) <= 500),
  -- MST. NULL được phép, và đó là một quyết định SẢN PHẨM chứ không phải sự dễ dãi: Level 0 là
  -- *Guest Bidder* — lần báo giá đầu KHÔNG yêu cầu tài khoản đầy đủ (ràng buộc sản phẩm 1) — nên
  -- hồ sơ do người mua tạo lúc mời thường chưa có MST.
  --
  -- HỆ QUẢ CỦA NULL PHẢI ĐƯỢC NÓI RA, vì đây là chỗ người đọc sau dễ suy sai: ràng buộc
  -- `UNIQUE (org_id, tax_code)` bên dưới dùng ngữ nghĩa NULL MẶC ĐỊNH của Postgres, tức
  -- NULL <> NULL, nên MỘT tổ chức có thể có NHIỀU hàng mang tax_code NULL. Đó là hành vi mong
  -- muốn (nhiều nhà cung cấp khách chưa khai MST), và `NULLS NOT DISTINCT` cố ý KHÔNG được dùng.
  --
  -- CHECK dưới đây là phép kiểm ĐỊNH DẠNG, KHÔNG phải phép kiểm TÍNH HỢP LỆ. Nó nói "chuỗi này
  -- có hình dạng của một MST Việt Nam" (10 chữ số; đơn vị phụ thuộc thêm '-' và 3 chữ số) và
  -- KHÔNG nói "mã số thuế này có thật" — dự án không tra cứu cơ quan thuế ở S1. Đừng trích rộng
  -- hơn thế.
  tax_code    text CHECK (tax_code IS NULL OR tax_code ~ '^[0-9]{10}(-[0-9]{3})?$'),
  -- Level 0 = Guest Bidder, Level 1 = Known Supplier. Level 2 (Supplier Passport) thuộc S3+ và
  -- ADR-013 mục 4 đòi một ADR MỚI cho nó — vì Level 2 chính là chỗ câu hỏi "sổ dùng chung" quay
  -- lại, và khi ấy sẽ có dữ liệu thật để đo. CHECK giữ cho không ai lặng lẽ ghi 2.
  level       smallint NOT NULL DEFAULT 0 CHECK (level IN (0, 1)),
  status      text NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- org_id ĐỨNG ĐẦU. Câu lệnh này mang toàn bộ trọng lượng của ADR-013.
  -- Chỉ mục của ràng buộc là (org_id, tax_code) với org_id đứng đầu, nên nó phục vụ luôn mọi tra
  -- cứu chỉ theo org_id — kể cả vị từ của policy RLS. Vì vậy cố ý KHÔNG tạo thêm một chỉ mục
  -- riêng trên (org_id): nó sẽ là bản sao thừa của tiền tố này (khuôn `users` ở 002).
  UNIQUE (org_id, tax_code),
  -- Tiền đề cho khoá ngoại tổ hợp. KHUÔN NÀY KHÔNG MỚI: 006 §(1) đã thêm đúng ràng buộc này cho
  -- `users` (`users_org_id_id_key`) và `sessions`/`mfa_credentials` tham chiếu theo cặp
  -- `(org_id, user_id) REFERENCES users (org_id, id)`. Lập luận "không tạo oracle mới" đã được
  -- viết ở đó và KHÔNG cần dẫn lại: tập hàng vi phạm `(org_id, id)` là TẬP CON của tập hàng vi
  -- phạm `suppliers_pkey`, nên ràng buộc này không từ chối thêm một hàng nào. Nó tồn tại vì
  -- PostgreSQL đòi một ràng buộc DUY NHẤT khớp đúng bộ cột được tham chiếu.
  UNIQUE (org_id, id)
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;

CREATE POLICY suppliers_tenant_isolation ON suppliers
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON suppliers TO app_api;
-- INSERT theo CỘT. Hai vắng mặt, mỗi cái đóng một đường đi — cùng khuôn 002/006/007:
--   `id`         -> `suppliers_pkey` và `suppliers_org_id_id_key` không dùng làm oracle xuyên
--                   tổ chức được; DEFAULT gen_random_uuid() lo phần đó (ADR-012).
--   `created_at` -> dấu thời gian do CSDL đóng; bên ghi chọn được nó là một sổ sắp xếp lại được
--                   theo ý mình (khuôn `occurred_at` ở 003).
GRANT INSERT (org_id, legal_name, tax_code, level, status) ON suppliers TO app_api;
-- UPDATE KHÔNG có `org_id`: chuyển một nhà cung cấp sang tổ chức khác không thuộc bất kỳ đường
-- đi hợp lệ nào của app_api. `tax_code` thì CÓ — và ràng buộc duy nhất mà nó tham gia đã dẫn đầu
-- bằng org_id, nên oracle mà nó mở ra chỉ nằm TRONG tổ chức của chính người gọi.
GRANT UPDATE (legal_name, tax_code, level, status) ON suppliers TO app_api;
-- Cố ý KHÔNG cấp gì cho app_unseal — ADR-013 mục 5. Runtime mở thầu không có việc gì với sổ nhà
-- cung cấp, và một quyền cấp "cho chắc" là một quyền không ai gỡ ra nữa (khuôn 002 với
-- `organizations`, 006 với `sessions.expires_at`, 007 với toàn bộ `outbox_jobs`).

CREATE TABLE supplier_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  supplier_id  uuid NOT NULL,
  full_name    text NOT NULL CHECK (octet_length(full_name) > 0
                                    AND octet_length(full_name) <= 200),
  email        text NOT NULL CHECK (octet_length(email) > 0 AND octet_length(email) <= 320),
  -- Số điện thoại KHÔNG phải một trường liên hệ tuỳ chọn cho đủ bộ: ADR-015 chốt SMS là kênh OTP
  -- mặc định của S1, nên CỘT NÀY LÀ "KÊNH ĐÃ ĐĂNG KÝ" trong mệnh đề E2. Kèm theo là phần hẹp
  -- phải nói ra ngay tại chỗ, đúng như ADR-015 đã ghi: kênh này do NGƯỜI MUA KHAI khi mời, KHÔNG
  -- phải kênh nhà cung cấp tự xác nhận. Nó chống được "link bị chuyển tiếp" (E5) và KHÔNG chống
  -- được "người mua khai sai số".
  --
  -- NULL được phép ở Level 0 vì hồ sơ khách có thể chưa có số. Hệ quả bắt buộc cho S1.3: lời mời
  -- phải BỊ TỪ CHỐI khi thiếu số, KHÔNG được lặng lẽ rơi về email — rơi về email là đúng thứ
  -- ADR-015 mục 1 cấm (OTP không bao giờ đi cùng kênh với magic link).
  phone        text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{8,15}$'),
  status       text NOT NULL DEFAULT 'ACTIVE'
               CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- ==========================================================================================
  -- KHOÁ NGOẠI HỢP THÀNH — VÀ VÌ SAO `REFERENCES suppliers(id)` LÀ MỘT LỖ THẬT
  -- ==========================================================================================
  -- Cách viết hiển nhiên là `supplier_id uuid NOT NULL REFERENCES suppliers(id)`. Nó hỏng theo
  -- HAI hướng, và hướng thứ hai KHÔNG cần kẻ tấn công nào:
  --
  -- (1) ORACLE, cùng lớp với `users_pkey`: phép kiểm khoá ngoại chạy DƯỚI QUYỀN HỆ THỐNG trên
  --     TOÀN bảng, y hệt phép kiểm unique. Câu hỏi "hàng này có tồn tại ở tổ chức khác không"
  --     trả lời được bằng chênh lệch giữa "thành công" và "vi phạm khoá ngoại". Khai thác thực
  --     tế ≈ 0 (id là 122 bit ngẫu nhiên) — nhưng KHUÔN thì phải đóng, đúng như 002 đã làm với
  --     `users_pkey` dù ở đó khai thác cũng ≈ 0.
  --
  -- (2) SAI DỮ LIỆU DO MỘT LỖI LẬP TRÌNH BÌNH THƯỜNG — và đây mới là vế nặng. Một hàng
  --     (org_id = A, supplier_id = <của tổ chức B>) đi lọt CẢ HAI lớp đang có: RLS `WITH CHECK`
  --     chỉ soi `org_id` của chính hàng mới nên nó thấy A và cho qua; khoá ngoại đơn cột chỉ hỏi
  --     "id này có trong suppliers không", và nó CÓ. Kết quả là một người liên hệ của tổ chức A
  --     treo vào một nhà cung cấp của tổ chức B — không lớp nào kêu, và sổ kiểm toán cũng không,
  --     vì không có thao tác nào sai để mà ghi.
  --
  -- Khoá ngoại HỢP THÀNH đóng cả hai bằng một câu: cặp (A, id-của-B) đơn giản không tồn tại
  -- trong `suppliers`, nên INSERT hỏng — và nó hỏng với CÙNG MỘT thông báo dù id kia có thật hay
  -- không, nên nó cũng không phải oracle.
  --
  -- KHUÔN NÀY LÀ CỦA 006, KHÔNG PHẢI PHÁT MINH CỦA FILE NÀY: `sessions` và `mfa_credentials` đã
  -- tham chiếu `users` đúng cách này. File này chỉ áp lại cho cặp bảng đầu tiên của S1.
  --
  -- Cố ý KHÔNG có `ON DELETE CASCADE` (006 thì có). Lý do là một khác biệt thật chứ không phải
  -- quên: hôm nay KHÔNG role nào có DELETE trên `suppliers`, nên cả hai lựa chọn đều không có
  -- đường chạy — và mặc định RESTRICT là mặc định ĐÓNG. Khi một đường xoá được mở, nó phải chọn
  -- hành vi này TƯỜNG MINH và có review, thay vì thừa hưởng một CASCADE không ai quyết.
  FOREIGN KEY (org_id, supplier_id) REFERENCES suppliers (org_id, id),
  -- org_id đứng đầu, cùng lý do ADR-013. Chỉ mục của ràng buộc này có tiền tố (org_id,
  -- supplier_id) nên nó phục vụ luôn mọi tra cứu "người liên hệ của nhà cung cấp X"; cố ý KHÔNG
  -- tạo thêm chỉ mục riêng cho cặp đó.
  UNIQUE (org_id, supplier_id, email)
);

ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY supplier_contacts_tenant_isolation ON supplier_contacts
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON supplier_contacts TO app_api;
GRANT INSERT (org_id, supplier_id, full_name, email, phone, status)
  ON supplier_contacts TO app_api;
-- `supplier_id` KHÔNG có UPDATE: chuyển một người liên hệ sang nhà cung cấp khác không phải một
-- thao tác sửa hồ sơ — nó là xoá một người và tạo một người khác. Cùng lý do `org_id` vắng mặt ở
-- cả hai bảng.
GRANT UPDATE (full_name, email, phone, status) ON supplier_contacts TO app_api;
-- Cố ý KHÔNG cấp gì cho app_unseal — ADR-013 mục 5. Bảng này chứa DỮ LIỆU CÁ NHÂN (họ tên, email,
-- số điện thoại), và đây đúng là quyết định 002 đã ra cho `users`, với cùng một lý do.

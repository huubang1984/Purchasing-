-- db/migrations/003_audit_events.sql
-- Sổ kiểm toán chuỗi hash, chỉ ghi thêm (ADR-004, bất biến B3, B4).
--
-- ============================================================================
-- HAI LỚP, KHÔNG PHẢI BA — VÀ CHÚNG KHÔNG ĐỘC LẬP
-- ============================================================================
-- Bản kế hoạch của task này viết "ba lớp bảo vệ độc lập" (trigger hàng · trigger lệnh ·
-- REVOKE). Đã đo lại trên PostgreSQL 16.15 và phát biểu đó SAI ở hai chỗ, nên nó được sửa ở
-- đây thay vì chép lại: trong dự án này .sql là hồ sơ kiểm toán, một phát biểu rộng hơn cái đo
-- được là lỗi thật.
--
--   (1) Trigger hàng và trigger lệnh KHÔNG phải hai lớp: chúng là MỘT lớp phủ ba sự kiện. Cả
--       ba dùng chung một hàm, chung một đường vô hiệu hoá (đổi/xoá/tắt trigger), và cùng chết
--       nếu ai đó thay thân hàm. Đếm chúng là hai lớp là tự cộng điểm.
--   (2) Lớp REVOKE KHÔNG độc lập với lớp trigger, và nó YẾU HƠN chứ không bổ sung: REVOKE thua
--       chủ sở hữu bảng và superuser, còn trigger ràng buộc được CẢ HAI (đo bên dưới). Đã đo
--       hệ quả trực tiếp: sau "GRANT UPDATE ON audit_events TO app_api", app_api VẪN không sửa
--       nổi một hàng — trigger chặn. Lớp REVOKE chỉ mua một thứ: câu lệnh dừng sớm hơn với
--       "permission denied" thay vì đi tới trigger.
--
-- Phát biểu đúng mức, và là thứ CÓ test đo:
--   Lớp A — TRIGGER (có thẩm quyền). BEFORE UPDATE / DELETE ở mức hàng và BEFORE TRUNCATE ở
--     mức lệnh, ENABLE ALWAYS. Ràng buộc MỌI role kể cả chủ sở hữu bảng và superuser, kể cả
--     phiên đặt session_replication_role = replica.
--   Lớp B — QUYỀN. Không role nào ngoài chủ sở hữu bảng có UPDATE/DELETE/TRUNCATE, ở cả mức
--     bảng lẫn mức CỘT, kể cả PUBLIC. Nó không thêm sức mạnh, nó thêm ĐỘ RÕ: một quyền ghi
--     xuất hiện trên bảng sổ là dấu hiệu ai đó đang chuẩn bị làm việc không nên làm.
--   Lớp C — HARDENING. Hai lớp trên đúng TẠI THỜI ĐIỂM file này chạy, và file này chỉ chạy MỘT
--     lần. db/migrations/hardening.always.sql cưỡng chế lại THÂN HÀM và HÌNH DẠNG BA TRIGGER ở
--     MỌI lần migrate() — xem hai mục "hàm chặn sửa/xoá" và "trigger chỉ-ghi-thêm" ở đó.
--
-- BẬC TỰ DO CÒN LẠI, nói ra thay vì hứa suông:
--   * Chủ sở hữu bảng (role deploy) và superuser có DDL: họ DROP/DISABLE được trigger, hoặc
--     DROP được cả bảng. Lớp C đưa trạng thái về đúng ở lần migrate() KẾ TIẾP, nên cửa sổ phơi
--     kéo dài tới lần deploy đó — cùng bậc tự do về THỜI GIAN như ca ATTACH PARTITION của Task
--     4, và cùng lý do (event trigger đòi SUPERUSER, mà role deploy thật không có).
--   * Lớp C không phát hiện được việc DROP CẢ HAI bảng sổ cùng lúc — xem ghi chú ở
--     BANG_CHI_GHI_THEM trong hardening.always.sql.
--   * Chống tamper trước kẻ tấn công có quyền superuser DB vẫn NGOÀI mô hình đe doạ đã chọn
--     (ADR-004, phần rủi ro) — mặc dù lớp A đo được là chặn được superuser ở đường SQL thường,
--     nó không chặn được sửa file dữ liệu, pg_upgrade, hay khôi phục từ bản sao lưu bị sửa.

-- ============================================================================
-- HÀM CHẶN — nhân bản sang hardening.always.sql, hai bản BẮT BUỘC giống nhau
-- ============================================================================
-- [R3-T5] Cùng bài học đã trả giá ở app_current_org_id(): thân hàm KHÔNG được canh thì một
-- "CREATE OR REPLACE FUNCTION" thay ruột đi lọt migrate() và vô hiệu hoá IM LẶNG toàn bộ sổ
-- kiểm toán. Đã đo trên PostgreSQL 16.15 với thân hàm thay bằng đúng "RETURN NEW;":
--     UPDATE   -> UPDATE 1        (đi lọt)
--     TRUNCATE -> TRUNCATE TABLE  (đi lọt, bảng còn 0 hàng)
--     DELETE   -> DELETE 0        (không lọt, nhưng IM LẶNG: trả về NULL huỷ thao tác, không
--                                  báo lỗi — nên một mã ứng dụng "xoá thành công" cũng im)
-- Vì vậy hardening.always.sql mang bản chuẩn của thân hàm này và cưỡng chế lại ở mọi lần
-- migrate(); có test đọc CẢ HAI file và so sánh thân hàm đã chuẩn hoá khoảng trắng.
--
-- ĐẶT TRONG public, KHÔNG PHẢI app_private — và đây là một quyết định ĐÃ ĐẢO CHIỀU sau khi đo.
-- Bản đầu của file này đặt hàm vào app_private theo đúng chỉ dẫn của 001 ("migration sau đặt
-- bất kỳ hàm nào không muốn app_api/app_unseal gọi trực tiếp vào đây"). Nó CHẶN DEPLOY, và
-- chặn ở đúng kịch bản vận hành thật:
--     role deploy = CREATEROLE + chủ sở hữu database, KHÔNG superuser, KHÔNG sở hữu app_private
--     -> hardening chạy "to_regprocedure('app_private.chan_sua_xoa()')" ở lượt PHÁN XÉT
--     -> ERROR: permission denied for schema app_private   (migrate() GÃY ở MỌI lần chạy)
-- Đã đo riêng cơ chế để chắc chắn không đổ lỗi nhầm: dưới một role không có USAGE trên schema,
-- to_regprocedure('<schema>.f()') NÉM LỖI (nó không trả NULL), trong khi đọc cùng thông tin qua
-- "pg_proc JOIN pg_namespace" thì chạy bình thường — đọc catalog không cần USAGE, phân giải TÊN
-- thì cần. Đúng cái bẫy QT1: "ai sửa được nó, bằng cách nào?" -> phải sửa tay trên cụm.
-- Vá bằng cách đọc catalog thay vì phân giải tên sẽ gỡ được vế PHÁN XÉT, nhưng KHÔNG gỡ được vế
-- TỰ CHỮA: "CREATE TRIGGER ... EXECUTE FUNCTION app_private.chan_sua_xoa()" cũng đòi USAGE trên
-- schema đó, nên đúng đường trôi mà lớp C hứa tự chữa lại là đường nó không chữa nổi.
-- Đổi lại, để trong public mất gì: PUBLIC giữ EXECUTE mặc định trên hàm này. Đã cân nhắc REVOKE
-- và CỐ Ý KHÔNG làm — hai lý do. (a) Nó vô hại: hàm RAISE vô điều kiện, và gọi ngoài ngữ cảnh
-- trigger thì plpgsql từ chối ngay ("can only be called as a trigger"); không có giá trị nào
-- đọc ra được từ nó. (b) CREATE TRIGGER đòi EXECUTE trên hàm, mà role deploy KHÔNG sở hữu hàm
-- này (nó do lần bootstrap bằng superuser tạo ra) — thu hồi EXECUTE của PUBLIC là tự tay chặn
-- đường tự chữa của lớp C, đổi một quyền vô hại lấy một hàng rào chặn deploy.
--
-- "SET search_path = pg_catalog" là bắt buộc theo QT3 chứ không phải trang trí: thân hàm chạy
-- dưới search_path của PHIÊN GỌI, và quy tắc "pg_catalog được tìm ngầm trước" đã đo được là
-- PHÁ ĐƯỢC khi pg_catalog bị NÊU TÊN ở vị trí sau. Mệnh đề SET ghim môi trường phân giải tên
-- cho thân hàm. Với hàm plpgsql nó KHÔNG mất mát gì (chỉ hàm SQL mới bị mệnh đề SET chặn
-- inlining — xem 001), nên đây là ghim miễn phí.
-- RAISE, TG_TABLE_NAME và TG_OP là cú pháp/biến ma thuật của plpgsql, không phải lời gọi hàm
-- qua search_path, nên trong thân hàm không còn tên nào cần ghi thêm schema.
CREATE OR REPLACE FUNCTION public.chan_sua_xoa() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
BEGIN
  RAISE EXCEPTION 'Bảng % là bảng chỉ-ghi-thêm (append-only): thao tác % bị từ chối',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$ham$;

-- ============================================================================
-- BẢNG SỰ KIỆN
-- ============================================================================
CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  seq           bigint NOT NULL CHECK (seq > 0),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_type    text NOT NULL CHECK (actor_type IN ('USER', 'SUPPLIER', 'SYSTEM', 'SERVICE')),
  actor_id      uuid,
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   uuid,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id    uuid,
  ip            inet,
  user_agent    text,
  prev_hash     bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  hash          bytea NOT NULL CHECK (octet_length(hash) = 32),

  -- ------------------------------------------------------------------------
  -- payload KHÔNG ĐƯỢC TRỞ THÀNH NƠI RÒ GIÁ THẦU
  -- ------------------------------------------------------------------------
  -- Ràng buộc toàn cục của dự án ("không bao giờ ghi log giá, mật khẩu, token, OTP, khoá, bí
  -- mật TOTP") tới giờ chỉ sống trong review của con người. Cột jsonb tự do này là chỗ đầu
  -- tiên nó có thể vỡ trong im lặng, và vỡ ở đúng bảng mà MỌI người vận hành đều đọc được —
  -- một sự kiện "SUA_BAO_GIA" kèm payload {"don_gia": 12000} là giá thầu kín nằm sẵn trong sổ.
  --
  -- Chốt chặn dưới đây là DÂY BẪY, không phải bằng chứng — nói rõ để không ai trích dẫn quá
  -- lời: nó chặn được đúng những khoá có tên trong danh sách, và không chặn được cùng giá trị
  -- đặt dưới khoá "x" hay nhét vào chuỗi `action`. Giá trị của nó là biến một quy ước im lặng
  -- thành một lỗi ồn ào ở lần đầu tiên ai đó viết đúng khuôn quen thuộc, ngay trên máy của
  -- người viết mã chứ không phải sáu tháng sau trong một cuộc soát xét.
  -- Đường sửa khi một task sau thật sự cần một khoá trong danh sách: một migration mới đổi
  -- ràng buộc, kèm lý do — đúng khuôn "quyết định phải nhìn thấy được" của dự án.
  CONSTRAINT audit_events_payload_la_doi_tuong CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT audit_events_payload_khong_mang_gia CHECK (NOT (payload ?| ARRAY[
    'gia', 'don_gia', 'tong_tien', 'so_tien', 'thanh_tien',
    'price', 'unit_price', 'amount', 'total', 'bid_amount', 'bid_price',
    'password', 'mat_khau', 'token', 'otp', 'secret', 'totp_secret', 'private_key'
  ])),

  -- org_id đứng ĐẦU nên chỉ mục của ràng buộc này phục vụ luôn vị từ RLS. Đã đo (xem test
  -- "[INV-B4] UNIQUE (org_id, seq) không dùng làm oracle...") rằng nó KHÔNG là oracle xuyên tổ
  -- chức, và lý do là một thứ tự thực thi phải đo chứ không suy được: PostgreSQL kiểm vế RLS
  -- WITH CHECK TRƯỚC khi chèn vào chỉ mục, nên một INSERT mang org_id của tổ chức khác trả về
  -- "new row violates row-level security policy" GIỐNG HỆT NHAU dù (org_id, seq) đó có tồn tại
  -- hay không. Khác hẳn organizations.slug của Task 4, nơi ràng buộc duy nhất là TOÀN CỤC nên
  -- không có vế RLS nào chạy trước.
  UNIQUE (org_id, seq)
);

CREATE INDEX audit_events_org_seq_idx ON audit_events (org_id, seq DESC);
CREATE INDEX audit_events_resource_idx ON audit_events (org_id, resource_type, resource_id);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- Đúng HINH_DANG_CHUAN của hardening (pham_vi = 'co_org_id'), nên không cần dòng nào trong
-- NGOAI_LE_HINH_DANG — danh sách đó vẫn RỖNG sau Task 5.
CREATE POLICY audit_events_tenant_isolation ON audit_events
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- ============================================================================
-- MỐC NEO CHUỖI
-- ============================================================================
-- Ghi lại đầu chuỗi tại một thời điểm. Nếu ai đó cắt được phần đuôi, mốc neo trỏ tới một seq
-- không còn tồn tại và bộ kiểm chứng của Task 6 phát hiện được. Vì thế bảng này phải chỉ-ghi-
-- thêm Y HỆT sổ chính: một mốc neo SỬA được thì kẻ cắt đuôi chỉ việc sửa luôn mốc neo.
--
-- Cố ý KHÔNG có khoá ngoại (org_id, seq) -> audit_events: ràng buộc đó sẽ chặn việc ghi mốc
-- neo cho một seq chưa tồn tại, nhưng nó KHÔNG mua thêm gì cho B3 (hàng của audit_events vốn
-- đã không xoá được) và nó khoá cứng thứ tự ghi mà Task 6 chưa thiết kế xong. Quyết định này
-- thuộc Task 6; ghi ra đây để nó là một lựa chọn chứ không phải một chỗ quên.
CREATE TABLE audit_chain_anchors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  seq         bigint NOT NULL CHECK (seq > 0),
  hash        bytea NOT NULL CHECK (octet_length(hash) = 32),
  anchored_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, seq)
);

ALTER TABLE audit_chain_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain_anchors FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_anchors_tenant_isolation ON audit_chain_anchors
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- ============================================================================
-- LỚP A — TRIGGER, VÀ VÌ SAO PHẢI LÀ "ENABLE ALWAYS"
-- ============================================================================
-- Trigger mặc định là ORIGIN (pg_trigger.tgenabled = 'O'), và một phiên đặt
-- "session_replication_role = replica" BỎ QUA mọi trigger ORIGIN. Đã đo trên PostgreSQL
-- 16.15, cùng bảng, cùng ba trigger:
--     tgenabled='O' + replica -> UPDATE 1 · DELETE 1 · TRUNCATE TABLE   (bảng còn 0 hàng)
--     tgenabled='A' + replica -> cả ba đều bị RAISE chặn                (bảng còn nguyên)
-- Ai đặt được GUC đó: nó là GUC mức SUSET, nên app_api_login, app_api và cả role deploy
-- (CREATEROLE + chủ sở hữu database, KHÔNG superuser) đều nhận "permission denied to set
-- parameter" — đã đo cả ba. NHƯNG "GRANT SET ON PARAMETER session_replication_role TO
-- app_api" (PG15+) mở được cửa đó cho một role thường — cũng đã đo là chạy.
-- Cách vá chọn theo QT2: GHIM cấu hình mà bảo đảm phụ thuộc vào (ENABLE ALWAYS trên chính
-- trigger), thay vì đi canh xem ai đang được phép đặt GUC đó. Ghim thì đóng luôn cả những
-- đường cấp quyền chưa ai nghĩ ra; canh thì phải liệt kê cho đủ.
--
-- Ba đường vô hiệu hoá KHÁC mà không cần xoá trigger, tất cả đã đo là chạy trên PG16.15 —
-- và tất cả đều bị hardening bắt và tự chữa (xem mục "trigger chỉ-ghi-thêm" ở đó):
--     ALTER TABLE ... DISABLE TRIGGER            -> tgenabled = 'D'
--     ALTER TABLE ... ENABLE REPLICA TRIGGER     -> tgenabled = 'R'
--     CREATE OR REPLACE TRIGGER ... WHEN (false) -> tgqual khác NULL; UPDATE đi lọt hoàn toàn
--     CREATE OR REPLACE TRIGGER ... BEFORE UPDATE OF <cột> -> tgattr = {n}; chỉ chạy khi đúng
--                                                            cột đó nằm trong mệnh đề SET
-- Và một chi tiết dễ mất: "CREATE OR REPLACE TRIGGER" RESET tgenabled về 'O' — đã đo. Nên
-- ENABLE ALWAYS không phải trạng thái tự giữ, nó phải được đặt lại sau MỌI lần thay thế.
CREATE TRIGGER audit_events_chan_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa();
CREATE TRIGGER audit_events_chan_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa();
CREATE TRIGGER audit_events_chan_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.chan_sua_xoa();
ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_update;
ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_delete;
ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_truncate;

CREATE TRIGGER audit_chain_anchors_chan_update BEFORE UPDATE ON audit_chain_anchors
  FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa();
CREATE TRIGGER audit_chain_anchors_chan_delete BEFORE DELETE ON audit_chain_anchors
  FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa();
CREATE TRIGGER audit_chain_anchors_chan_truncate BEFORE TRUNCATE ON audit_chain_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION public.chan_sua_xoa();
ALTER TABLE audit_chain_anchors ENABLE ALWAYS TRIGGER audit_chain_anchors_chan_update;
ALTER TABLE audit_chain_anchors ENABLE ALWAYS TRIGGER audit_chain_anchors_chan_delete;
ALTER TABLE audit_chain_anchors ENABLE ALWAYS TRIGGER audit_chain_anchors_chan_truncate;

-- ============================================================================
-- LỚP B — QUYỀN: CHỈ SELECT VÀ INSERT, VÀ INSERT CẤP THEO CỘT
-- ============================================================================
-- "REVOKE ALL ... FROM app_api, app_unseal" của bản kế hoạch chỉ chạm HAI role và là NO-OP ở
-- đây. Đã đo trạng thái xuất phát thật của một bảng mới trên PostgreSQL 16.15:
--     pg_class.relacl = NULL  (tức ACL mặc định: CHỦ SỞ HỮU có tất cả, PUBLIC không có gì)
--     pg_default_acl  = 0 dòng
-- nên không có gì để thu hồi. Đường cấp quyền cho PUBLIC mà 002 đã cảnh báo và
-- ALTER DEFAULT PRIVILEGES đều KHÔNG có dòng nào còn sống trên lược đồ này. Câu REVOKE bị bỏ
-- vì một câu lệnh không làm gì trong hồ sơ kiểm toán là một lời hứa sai.
-- Bất biến thật ("không role NÀO ngoài chủ sở hữu có UPDATE/DELETE/TRUNCATE, kể cả PUBLIC,
-- kể cả ở mức CỘT") được khẳng định bằng một phép kiểm đọc pg_class.relacl + pg_attribute.attacl
-- ở db/audit-append-only.int.test.ts — KHÔNG qua information_schema.role_table_grants, vốn mù
-- hẳn với quyền cột (đã đo: "GRANT UPDATE (payload)" không sinh dòng nào ở view đó).
--
-- INSERT cấp THEO CỘT, cùng khuôn Task 4 dùng cho users_pkey:
--   `id`          không cấp -> audit_events_pkey không dùng làm oracle được (đã đo: INSERT
--                              mang một id CÓ THẬT của tổ chức khác và mang một id không ai
--                              dùng trả về CÙNG một "permission denied for table audit_events").
--   `occurred_at` không cấp -> dấu thời gian của sổ kiểm toán do CSDL đóng, không do bên ghi
--                              chọn. Một bên ghi chọn được occurred_at là một sổ sắp xếp lại
--                              được theo ý mình.
--   `anchored_at` không cấp -> cùng lý do.
-- SELECT cấp ở mức BẢNG cho cả hai role: bộ kiểm chứng chuỗi (Task 6) phải đọc được mọi cột,
-- và RLS đã giới hạn nó trong đúng tổ chức đang gắn.
GRANT SELECT ON audit_events TO app_api, app_unseal;
GRANT INSERT (org_id, seq, actor_type, actor_id, action, resource_type, resource_id,
              payload, request_id, ip, user_agent, prev_hash, hash)
  ON audit_events TO app_api, app_unseal;

-- Vì sao app_unseal ĐƯỢC cấp ở đây trong khi 002 cố ý không cấp gì cho nó trên `users`: khác
-- với dữ liệu cá nhân, việc mở niêm phong LÀ hành động cần được ghi vào sổ nhất trong toàn hệ
-- thống. Một runtime mở thầu không ghi nổi sự kiện của chính nó thì B3/B4 hở ngay tại chỗ quan
-- trọng nhất — đó là lý do, không phải "cấp cho chắc". SELECT cũng cần: nối vào chuỗi hash
-- buộc phải đọc được đầu chuỗi hiện tại (prev_hash).
-- Hệ quả cho [NỢ ADR-006] đã kiểm và ghi lại ở db/rls-coverage.int.test.ts: quyền cấp cho hai
-- role ở đây GIỐNG HỆT NHAU, nên app_unseal vẫn là tập con quyền của app_api và khoản nợ đó
-- vẫn chưa thoả được ở S0 — vẫn xanh, và xanh vì đúng lý do.
GRANT SELECT ON audit_chain_anchors TO app_api, app_unseal;
GRANT INSERT (org_id, seq, hash) ON audit_chain_anchors TO app_api, app_unseal;

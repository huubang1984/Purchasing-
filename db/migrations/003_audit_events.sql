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
--       chủ sở hữu bảng và superuser, còn trigger ràng buộc được CẢ HAI ở đường DML thường (đo
--       bên dưới). Đã đo hệ quả trực tiếp: sau "GRANT UPDATE ON audit_events TO app_api",
--       app_api VẪN không sửa nổi một hàng — trigger chặn.
--       [vòng fix 1 — IM2] Vòng trước kết thúc ý này bằng "lớp REVOKE chỉ mua một thứ: câu lệnh
--       dừng sớm hơn". SAI, và đo được là sai. Bản sửa (1)+(2) đi ĐÚNG HƯỚNG nhưng vế cuối
--       VƯỢT QUÁ theo chiều ngược lại: trong ĐÚNG cửa sổ phơi mà mục dưới đây thừa nhận, lớp B
--       là lớp DUY NHẤT còn đứng. Đo:
--           ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete;
--           -- app_api_login: DELETE FROM audit_events
--           -> ERROR: permission denied for table audit_events
--       Và hậu quả của việc DÙNG vế sai đó để biện minh cho "hardening cố ý không canh ACL"
--       cũng đo được: "GRANT DELETE, UPDATE ON audit_events TO app_api" -> app_api_login xoá
--       ba hàng audit -> migrate() báo MIGRATE OK -> GRANT của kẻ tấn công sống qua mọi deploy.
--       Nay hardening.always.sql CÓ canh và tự chữa ACL của bảng sổ (mục "quyền GHI trên bảng
--       sổ kiểm toán"), với đúng mức quyền mà mục trigger đã đòi.
--
-- Phát biểu đúng mức, và là thứ CÓ test đo:
--   Lớp A — TRIGGER (có thẩm quyền). BEFORE UPDATE / DELETE ở mức hàng và BEFORE TRUNCATE ở
--     mức lệnh, ENABLE ALWAYS. Ràng buộc MỌI role trên ĐƯỜNG DML TRỰC TIẾP — kể cả chủ sở hữu
--     bảng, kể cả superuser, kể cả thành viên pg_write_all_data, kể cả phiên đặt
--     session_replication_role = replica (cả năm đã đo).
--     [vòng fix 1 — phát biểu] Vòng trước viết gọn là "ràng buộc MỌI role kể cả chủ sở hữu bảng
--     và superuser". Đúng cho đường DML, SAI như một phát biểu về chủ sở hữu bảng NÓI CHUNG:
--     chủ sở hữu có DDL, và DDL đi vòng qua lớp A hoàn toàn (SET SCHEMA, thay bảng bằng view,
--     SET UNLOGGED, cắm trigger/rule lạ). Ba chữ "đường DML trực tiếp" là toàn bộ phạm vi.
--   Lớp B — QUYỀN. Không role nào ngoài chủ sở hữu bảng ĐƯỢC CẤP UPDATE/DELETE/TRUNCATE qua
--     ACL, ở cả mức bảng lẫn mức CỘT, kể cả PUBLIC. Nó thêm ĐỘ RÕ, và — đo được ở (2) trên —
--     nó là lớp duy nhất còn đứng khi một trigger bị tắt.
--     Ngoại lệ đã đo và KHÔNG đóng được bằng ACL: vai trò định sẵn pg_write_all_data CÓ
--     UPDATE/DELETE (không có TRUNCATE) trên bảng sổ, và quyền đó KHÔNG nằm trong relacl/attacl
--     nên mọi phép đọc ACL đều mù với nó. Lớp A vẫn chặn (đo: thành viên pg_write_all_data
--     nhận đúng RAISE "chỉ-ghi-thêm"). Xem test "[INV-B4] ngoài chủ sở hữu bảng và vai trò định
--     sẵn pg_write_all_data..." ở db/audit-append-only.int.test.ts.
--   Lớp C — HARDENING. Hai lớp trên đúng TẠI THỜI ĐIỂM file này chạy, và file này chỉ chạy MỘT
--     lần. db/migrations/hardening.always.sql cưỡng chế lại ở MỌI lần migrate(): thân hàm, hình
--     dạng sáu trigger, việc KHÔNG có trigger/rule lạ, sự tồn tại của bảng sổ như một bảng thật
--     trong public, trạng thái LOGGED + UNIQUE (org_id, seq), và ACL của bảng sổ.
--
-- BẬC TỰ DO CÒN LẠI, nói ra thay vì hứa suông:
--   * Chủ sở hữu bảng (role deploy) và superuser có DDL. Lớp C đưa trạng thái về đúng, hoặc gãy
--     ồn ào, ở lần migrate() KẾ TIẾP — nên cửa sổ phơi kéo dài tới lần deploy đó.
--     [vòng fix 1 — phát biểu] PHẠM VI CHÍNH XÁC của câu trên, vì vòng trước phát biểu BAO TRÙM
--     trong khi bản cài đặt chỉ canh sáu cái tên trigger nó biết, trong schema public, trên
--     relkind r/p — và bốn đường trôi đo được KHÔNG phải "cửa sổ" mà là VĨNH VIỄN + KHÔNG DẤU
--     VẾT: ALTER TABLE ... SET SCHEMA, trigger/rule lạ nuốt sự kiện, CONSTRAINT TRIGGER trùng
--     tên (lớp C tự khoá deploy của chính nó), SET UNLOGGED.
--     [vòng fix 2 — phát biểu] Vòng 1 kết thúc bằng "CẢ BỐN NAY ĐÃ ĐÓNG". ĐÓ LÀ CHỖ NÓI QUÁ THỨ
--     TÁM, và nó sinh ra bởi chính vòng sửa chỗ nói quá. Bốn ĐƯỜNG kia đóng thật (có test),
--     nhưng câu đó đọc thành "lớp C nay canh được trạng thái của bảng sổ", và điều ấy SAI. Ba
--     đường đo được ở vòng này đi lọt HOÀN TOÀN — đều `MIGRATE OK` và KHÔNG một WARNING nào:
--       (a) THAY BẢNG BẰNG BẢN SAO RỖNG, một câu lệnh, không cần schema khác, không đụng
--           schema_migrations: ALTER TABLE audit_events RENAME TO au_cu;
--           CREATE TABLE audit_events (LIKE au_cu INCLUDING ALL) + RLS + policy + GRANT;
--           DROP TABLE au_cu.  -> 4 hàng thành 0 hàng, và sáu trigger SẠCH BONG vì chính lớp C
--           dựng lại chúng. Rẻ hơn cả SET SCHEMA.
--       (b) SET SCHEMA -> sửa -> TRẢ VỀ: 2/4 hàng biến mất, pg_trigger sạch bong. Bản vá [CR2a]
--           chỉ mua được phát hiện NẾU migrate() tình cờ chạy trong lúc bảng còn ở schema khác,
--           mà cửa sổ đó do KẺ TẤN CÔNG chọn.
--       (c) DROP cả hai bảng + DELETE FROM schema_migrations WHERE version LIKE '003%': 003
--           chạy lại, sổ rỗng. Neo của [CR2c] nằm trong một bảng mà chính tác nhân sở hữu.
--     Đây KHÔNG phải lỗ do bản vá mở ra: đó là GIỚI HẠN CẤU TRÚC không đóng được ở tầng này —
--     đóng thật cần event trigger cấp cụm (đòi SUPERUSER) hoặc một NEO NGOÀI DATABASE. Cố ý
--     KHÔNG vá; Task 6 là chỗ mang neo ngoài vào.
--     PHÁT BIỂU ĐÚNG MỨC của lớp C, và đây là câu Task 6 phải đọc:
--       lớp C phát hiện các TRẠNG THÁI SAI ĐANG TỒN TẠI tại đúng lúc migrate() chạy — trên hai
--       bảng sổ nhận theo TÊN, ở bất kỳ schema nào: hình dạng sáu trigger, sự có mặt của
--       trigger/rule lạ, thân hàm chặn, relpersistence, ràng buộc UNIQUE (org_id, seq), ACL, và
--       việc bảng sổ còn là một BẢNG THẬT trong public.
--       Nó KHÔNG phát hiện một CHUỖI THAO TÁC đã khôi phục hình dạng đúng — đo được:
--       SET SCHEMA -> sửa -> trả về, và RENAME + CREATE TABLE LIKE, đều cho MIGRATE OK không
--       dấu vết. Nói cách khác lớp C chứng thực HÌNH DẠNG, không chứng thực LỊCH SỬ, và cũng
--       không chứng thực rằng đây vẫn là CÁI BẢNG CŨ.
--       Mọi trục KHÁC nằm ngoài tầm nhìn của nó — xem "TRỤC CHƯA QUÉT" trong task-5-report.md,
--       và §"bậc tự do còn lại" ở đó.
--     RÀNG BUỘC BÀN GIAO CHO TASK 6 (do [vòng fix 2 — I1]): trên hai bảng sổ, CHỈ SÁU TRIGGER
--     chỉ-ghi-thêm được phép tồn tại và KHÔNG rule nào được phép tồn tại. Đó là mặc định-ĐÓNG,
--     nên một CREATE TRIGGER hợp lệ trong 004_*.sql SẼ BỊ hardening gỡ ở lượt sửa kế tiếp (nay
--     có RAISE WARNING khi việc gỡ thành công — trước vòng này nó im lặng, và vì 004 đã nằm
--     trong schema_migrations nên migration đó bốc hơi vĩnh viễn). Task 6 muốn thêm trigger
--     trên bảng sổ thì chỗ sửa là DANH SÁCH `can_co` trong hardening.always.sql, không phải
--     một migration đánh số.
--   * Chống tamper trước kẻ tấn công có quyền superuser DB vẫn NGOÀI mô hình đe doạ đã chọn
--     (ADR-004, phần rủi ro) — mặc dù lớp A đo được là chặn được superuser ở đường SQL thường,
--     nó không chặn được sửa file dữ liệu, pg_upgrade, hay khôi phục từ bản sao lưu bị sửa.
--   * seq và prev_hash do BÊN GHI chọn — bàn giao tường minh cho Task 6, xem ghi chú ở GRANT
--     INSERT cuối file.

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
-- và CỐ Ý KHÔNG làm. Lý do là (a): nó vô hại — hàm RAISE vô điều kiện, và gọi ngoài ngữ cảnh
-- trigger thì plpgsql từ chối ngay ("can only be called as a trigger"); không có giá trị nào
-- đọc ra được từ nó. Ở S0, app_api/app_unseal cũng không có CREATE trên public nên chúng không
-- gắn được hàm này vào đâu.
-- [vòng fix 1 — IM3] Vòng trước còn nêu một lý do (b) — "role deploy KHÔNG sở hữu hàm này (nó
-- do lần bootstrap bằng superuser tạo ra) nên thu hồi EXECUTE của PUBLIC là tự tay chặn đường
-- tự chữa của lớp C". TIỀN ĐỀ ẤY SAI, và đã đo dưới ĐÚNG hồ sơ vai deploy (tp_deploy: LOGIN +
-- CREATEROLE + chủ sở hữu database và schema public, KHÔNG superuser):
--     SELECT proowner::regrole FROM pg_proc WHERE proname = 'chan_sua_xoa'  ->  tp_deploy
-- Hàm này do lượt SỬA của hardening.always.sql (hoặc chính file này) tạo ra dưới role deploy,
-- nên deploy SỞ HỮU nó và có EXECUTE bất kể PUBLIC. Lý do (b) vì thế không đứng; kết luận
-- "không REVOKE" được giữ, nhưng nó nay chỉ dựa trên (a).
-- Hệ quả thứ hai của cùng phép đo, phải nói ra vì task-5-report.md §5 từng xếp mục (D1) là
-- "TỰ CHỮA ... không thao tác tay" mà không nêu phạm vi: CREATE OR REPLACE FUNCTION trên một
-- hàm ĐÃ TỒN TẠI đòi QUYỀN SỞ HỮU, không phải CREATE trên schema. Trong kịch bản vận hành thật
-- deploy sở hữu hàm nên (D1) TỰ CHỮA thật; nhưng nếu ai đó chạy "ALTER FUNCTION
-- public.chan_sua_xoa() OWNER TO postgres" thì đo được: CREATE OR REPLACE dưới role deploy trả
-- "must be owner of function" (42501, bị BƯỚC 2 nuốt), và khi thân hàm trôi thì migrate() gãy ở
-- lượt phán xét cho tới khi một superuser trả quyền sở hữu về. Đó là bậc tự do, không phải lời
-- hứa bị vỡ — nhưng nó phải nằm trong hồ sơ.
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
  -- lời: nó chặn được đúng những KHOÁ CÓ TÊN TRONG DANH SÁCH, ở BẤT KỲ ĐỘ SÂU NÀO, và không
  -- chặn được cùng giá trị đặt dưới khoá "x" hay nhét vào chuỗi `action` (một sự kiện
  -- action = 'GIA_12000000' đi qua sạch sẽ). Giá trị của nó là biến một quy ước im lặng thành
  -- một lỗi ồn ào ở lần đầu tiên ai đó viết đúng khuôn quen thuộc, ngay trên máy của người viết
  -- mã chứ không phải sáu tháng sau trong một cuộc soát xét.
  -- Đường sửa khi một task sau thật sự cần một khoá trong danh sách: một migration mới đổi
  -- ràng buộc, kèm lý do — đúng khuôn "quyết định phải nhìn thấy được" của dự án.
  --
  -- [vòng fix 1 — IM4] "Ở BẤT KỲ ĐỘ SÂU NÀO" là bản vá, không phải cách viết cũ. Vòng trước
  -- dùng toán tử "?|", và "?|" CHỈ XÉT KHOÁ CẤP MỘT. Đo trên PostgreSQL 16.15:
  --     {"gia": 12000}                -> CHẶN
  --     {"chi_tiet": {"gia": 12000}}  -> INSERT 0 1   (LỌT)
  --     {"ds": [{"don_gia": 12000}]}  -> INSERT 0 1   (LỌT)
  -- Chính ví dụ dùng để biện minh cho ràng buộc này ({"don_gia": 12000}) chỉ bị chặn VÌ NÓ
  -- PHẲNG, mà payload lồng là CÁCH VIẾT MẶC ĐỊNH chứ không phải cách né tránh. Phát biểu cũ
  -- ("chặn được đúng những khoá có tên trong danh sách") vì thế SAI ở diện phủ, và tên ràng
  -- buộc payload_khong_mang_gia xuất hiện NGUYÊN VĂN trong thông báo lỗi production nên chính
  -- nó cũng là hồ sơ kiểm toán.
  -- jsonb_path_exists dùng được trong CHECK: đã đo provolatile = 'i' (IMMUTABLE). "$.**" bao
  -- gồm cả chính giá trị gốc lẫn mọi hậu duệ, và ở chế độ lax nó tự mở gói mảng — đã đo cả bốn
  -- ca (phẳng, lồng, trong mảng, lồng sâu ba tầng) đều CHẶN, còn payload sạch thì qua.
  CONSTRAINT audit_events_payload_la_doi_tuong CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT audit_events_payload_khong_mang_gia CHECK (NOT jsonb_path_exists(payload,
    '$.** ? (exists(@.gia) || exists(@.don_gia) || exists(@.tong_tien) || exists(@.so_tien)
             || exists(@.thanh_tien) || exists(@.price) || exists(@.unit_price)
             || exists(@.amount) || exists(@.total) || exists(@.bid_amount)
             || exists(@.bid_price) || exists(@.password) || exists(@.mat_khau)
             || exists(@.token) || exists(@.otp) || exists(@.secret)
             || exists(@.totp_secret) || exists(@.private_key))')),

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
-- [vòng fix 1 — hồ sơ] Hai reviewer đo ra hai kết quả khác nhau ở câu GRANT này và CẢ HAI ĐÚNG,
-- vì họ hỏi hai câu khác nhau về TÁC NHÂN CẤP: (i) role deploy CHẠY câu GRANT đó thì nhận
-- "permission denied for parameter" — cấp quyền trên tham số SUSET đòi SUPERUSER; (ii) một khi
-- một superuser ĐÃ cấp, role thường ĐẶT ĐƯỢC GUC. Không mâu thuẫn, và kết luận không đổi:
-- cửa chỉ mở được bởi tác nhân NGOÀI mô hình (superuser), nhưng một khi đã mở thì nó mở cho
-- role trong mô hình — nên ENABLE ALWAYS là đúng và cần thiết chứ không phải phòng thủ thừa.
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
--
-- [vòng fix 1 — CR1] HAI CƠ CHẾ KHÁC, không đi qua sáu trigger này chút nào, nay do lớp C canh:
--   * TRIGGER LẠ (tên bất kỳ) trên chính bảng sổ. Trên UPDATE/DELETE, một trigger tên đứng
--     TRƯỚC trả NULL huỷ thao tác IM LẶNG — dữ liệu vẫn AN TOÀN, chỉ mất độ ồn. Trên INSERT thì
--     KHÔNG an toàn: "BEFORE INSERT ... RETURN NULL" nuốt đúng những sự kiện nó chọn và để lại
--     một chuỗi hash LIỀN MẠCH MÀ THIẾU SỰ KIỆN — một bộ kiểm chứng chuỗi đúng chuẩn sẽ báo
--     HỢP LỆ trên một sổ đã bị kiểm duyệt.
--   * RULE. "CREATE RULE ... AS ON UPDATE/DELETE TO audit_events DO INSTEAD NOTHING" đo được là
--     KHÔNG phá được dữ liệu (DELETE 0, hàng còn nguyên) — cơ chế khác hẳn "trigger tên đứng
--     trước". Nhưng "ON INSERT ... DO INSTEAD NOTHING" thì cùng hậu quả với đường BEFORE INSERT
--     ở trên: INSERT 0 0, không lỗi.
-- Cả hai nay bị hardening.always.sql phát hiện và GỠ (DROP TRIGGER / DROP RULE): trên bảng sổ,
-- chỉ sáu trigger dưới đây được phép tồn tại và không rule nào được phép.
--
-- [vòng fix 1 — ghi cho Task 6, KHÔNG cần vá ở S0] NẾU một task sau PHÂN MẢNH audit_events, đã
-- đo sẵn trên PostgreSQL 16.15 để không ai phải khám phá lại:
--   * "BEFORE TRUNCATE" trên bảng CHA KHÔNG PHỦ LÁ: "TRUNCATE ae_p_1" thẳng trên lá THÀNH CÔNG
--     (lá còn 0 hàng); chỉ TRUNCATE trên cha mới bị chặn.
--   * "BEFORE UPDATE/DELETE FOR EACH ROW" thì CÓ phủ: PostgreSQL nhân bản trigger hàng xuống lá,
--     nên UPDATE thẳng trên lá vẫn bị chặn.
--   * Lớp C xử lý đúng: nó nhận diện cả cha lẫn lá và tự tạo <ten_la>_chan_truncate trên từng lá.
--     Bản sao trigger trên lá mang tgparentid <> 0, và vế "trigger LẠ" của lớp C cố ý bỏ qua
--     chúng — DROP một trigger con bị PostgreSQL từ chối ("cannot drop trigger ... because it is
--     a child"), tức một câu lệnh cưỡng chế ném lỗi KHÁC 42501, đúng lớp lỗi mà [CR3] vừa đóng.
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

-- ============================================================================
-- [vòng fix 1 — IM6] BÀN GIAO TƯỜNG MINH CHO TASK 6: seq VÀ prev_hash DO BÊN GHI CHỌN
-- ============================================================================
-- GRANT INSERT ở trên CÓ cấp cột `seq` và `prev_hash`, và không ràng buộc nào trong file này
-- buộc seq đơn điệu hay prev_hash khớp đuôi chuỗi hiện tại. UNIQUE (org_id, seq) chỉ bảo đảm
-- KHÔNG TRÙNG, không bảo đảm LIÊN TỤC và không bảo đảm ĐÚNG THỨ TỰ.
-- Hệ quả cụ thể mà Task 6 phải thiết kế cho, nói ra thay vì để nó được khám phá lại:
--   * app_api bị chiếm CHẶN ĐƯỢC việc ghi sổ: chèn trước giá trị seq kế tiếp thì lần ghi sổ
--     THẬT sau đó vỡ với "duplicate key". Nếu tầng ứng dụng coi lỗi ghi audit là không nghiêm
--     trọng, sự kiện IM LẶNG KHÔNG ĐƯỢC GHI — cùng hậu quả với đường trigger lạ ở trên, chỉ
--     khác cơ chế.
--   * Một chuỗi hash liên tục vì thế chứng minh "không ai cắt ghép hàng ĐÃ ghi", chứ KHÔNG
--     chứng minh "mọi sự kiện đã xảy ra đều có mặt trong bảng". Nếu B3 được phát biểu là "sổ
--     không bị giả mạo" thì phát biểu đó nói quá.
-- Task 5 CỐ Ý không đóng: cấp phát seq đúng cách (sequence riêng theo org, hoặc hàm SECURITY
-- DEFINER cấp seq + tính hash) là thiết kế của Task 6, và khoá cứng nó ở đây sẽ ràng buộc một
-- lựa chọn chưa được cân nhắc.

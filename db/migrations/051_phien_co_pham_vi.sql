-- =============================================================================================
-- 051 — [khoản 141] PHẠM VI CỦA CHỨNG CHỈ PHIÊN: `public.sessions.kind`
-- =============================================================================================
-- S1.74 (ADR-038) dựng `apps/mcp`: một máy chủ MCP CHỈ ĐỌC nói HTTP với `apps/api`, mang một cookie phiên người mua đọc từ biến môi
-- trường. Lượt soi 69 H-1 đo ra rằng lời khai "chỉ đọc" là tính chất của MÁY KHÁCH, không phải của CHỨNG CHỈ:
-- `resolveSessionByToken` (packages/identity/src/session-actor.ts:110) chỉ kiểm `token_hash`, `revoked_at`, `expires_at`,
-- `mfa_verified_at`, `users.status` — hàng phiên KHÔNG mang một bit nào phân biệt phiên của một con người với phiên của một bề mặt
-- agent. Ai đọc được môi trường của tiến trình MCP thì gọi thẳng được `GET /rfqs/<id>/comparison` (bảng so sánh GIÁ) và MỌI route GHI
-- trong giới hạn ma trận quyền của người ấy.
--
-- QUYẾT ĐỊNH (chủ dự án, 2026-09-17 — ADR-039): phạm vi sống trên HÀNG PHIÊN và do MÁY CHỦ đóng lúc phát. `apps/api` đọc nó trong
-- `SessionActor` rồi từ chối 403 khi phiên là agent và route không phải một route được khai tường minh là agent gọi được. Tệp này là
-- nửa CSDL của quyết định ấy; nửa ứng dụng nằm ở `apps/api/src/dispatch.ts` và `apps/api/src/route-types.ts`.
--
-- BA THỨ TỆP NÀY CƯỠNG CHẾ ĐƯỢC, VÀ CHỈ BA:
--   ⑴ TẬP GIÁ TRỊ — `sessions_kind_hop_le`. Một giá trị thứ ba không vào bảng được, kể cả dưới superuser.
--
--   ⑵ TRẦN TTL CỦA PHIÊN AGENT — `sessions_agent_ttl_ngan`, và nó CÓ RĂNG chứ không phải một lời hứa. Tiền đề, và nó được neo vào một
--      phép đo VÉT CẠN chứ không vào một dòng GRANT: census `db/rls-coverage.int.test.ts` liệt kê `toEqual` mọi quyền mức CỘT đang
--      hiệu lực, và trong đó KHÔNG có hàng `sessions.created_at` nào cho `app_api`. (Trích một dòng `GRANT` là sai phương pháp: tập
--      quyền thật là hợp của 006, 029 và tệp này — đúng cách 029 đã thêm `mfa_verified_at` vào một danh sách mà 006 tưởng đã đóng.)
--      Nên `app_api` không đặt được `created_at`; nó luôn là DEFAULT `now()`. Và `startUserSession` (packages/identity/src/login.ts)
--      đặt `expires_at = now() + make_interval(secs => …)` trong CÙNG giao dịch, mà `now()` là dấu thời gian GIAO DỊCH, nên
--      `expires_at - created_at` đúng bằng TTL mà TypeScript xin.
--
--      Ca giao dịch dài, viết ra vì nó ngã về phía AN TOÀN và người đọc dễ tưởng ngược: giao dịch mở lúc T0, câu INSERT chạy lúc T0+Δ
--      thì CẢ HAI cột đều tính từ T0, nên tuổi thọ theo đồng hồ tường là `ttl − Δ` — NGẮN hơn, không bao giờ dài hơn. Ai "sửa" CHECK
--      sang `clock_timestamp()` cho "đúng hơn" là người làm nó gãy.
--
--      PHÁT BIỂU ĐÚNG MỨC: CHECK ràng HIỆU của hai cột; `Math.min` ở `login.ts` chọn GIÁ TRỊ. Hai lớp bắt hai lỗi khác nhau — gỡ CHECK
--      thì TypeScript vẫn ra 3 600 s, gỡ nhánh `Math.min` thì CSDL TỪ CHỐI câu INSERT. Tức lớp này là chỗ CSDL bắt lỗi của TypeScript,
--      không phải chỗ thay nó. Và nó ràng ĐƯỜNG `app_api`: một superuser đặt `created_at` tuỳ ý vẫn lách được — đó là đường của các
--      phép đo lược đồ, không phải đường sản xuất.
--
--   ⑶ TÍNH BẤT BIẾN CỦA PHẠM VI — bằng một QUYỀN VẮNG MẶT, không bằng một trigger. 006 cấp `UPDATE (mfa_verified_at, revoked_at)` và
--      không hơn; tệp này KHÔNG thêm `GRANT UPDATE (kind)`. Hệ quả đo được: `UPDATE sessions SET kind = 'USER'` dưới `app_api` ném
--      42501. Nâng cấp phạm vi tại chỗ là BẤT KHẢ, không phải "được canh".
--
-- THỨ TỆP NÀY KHÔNG CƯỠNG CHẾ ĐƯỢC — nói ra để không ai đọc rộng hơn. CSDL không biết HTTP, nên nó không nói được route nào phiên agent
-- đọc được: `GET /me` không chạm một bảng nào (apps/api/src/routes/buyer.ts dựng thân từ `ctx.actor`) nên không có hàng nào để RLS cắt;
-- và một policy CẮT HÀNG biến "không được xem" thành "không có báo giá nào" — chính `buildComparisonTable` NÉM thay vì trả một bảng
-- rỗng đúng vì lý do ấy (packages/unseal/src/comparison.ts: *một bảng rỗng là một câu trả lời*). Mã 403 là việc của `apps/api`, và nó
-- phải đứng TRƯỚC `requirePermission`, không phải sau.
--
-- TRẦN 60 PHÚT, VÀ VÌ SAO KHÔNG NGẮN HƠN (chủ dự án chọn ngày 2026-09-17, sau lượt soi đối kháng Đ-3). Bản đầu của vòng này định 15
-- phút. Lượt soi đo ra rằng 15 phút KHÔNG DÙNG ĐƯỢC: `expires_at` không có `GRANT UPDATE` (006 — "không gia hạn phiên trượt"), nên gia
-- hạn là bất khả, và phát một phiên mới đòi một magic link MỚI cộng một mã TOTP tươi trong ±90 giây của trigger `sessions_kiem_totp_gan_day`
-- (039) — tức một con người gõ TOTP bốn lần mỗi giờ, đụng trần `LOGIN_MAX_TOKENS_PER_WINDOW` 5 token/15 phút. Một chế độ vận hành không
-- dùng được không phải một lớp an ninh: nó là lý do người vận hành cắm cookie 8 giờ của chính mình vào biến môi trường — ĐÚNG thứ vòng
-- này sinh ra để chặn. Chủ dự án chọn: trần một giờ, CỘNG một đường gia hạn riêng ở tầng ứng dụng (một route NGƯỜI MUA tự thân, phiên
-- agent KHÔNG gọi được, phát một phiên agent mới cho chính người ấy). Con người gia hạn từ trình duyệt; tiến trình MCP nhận cookie mới
-- ngoài băng. Đường ấy KHÔNG chạm thân trigger 039 — thứ đang bị hardening ghim.
--
-- `DEFAULT 'USER'` LÀ MỘT ĐÁNH ĐỔI, KHÔNG PHẢI MỘT TIỆN TAY. Kho có rất nhiều câu `INSERT INTO sessions` viết tay trong test không nêu
-- tên cột này — dựng lại con số bằng `git grep -c "INSERT INTO .*sessions" -- "*.ts"` chứ đừng chép một con số ở đây, vì một con số
-- chính xác tới đơn vị mà không ai dựng lại được chính là hình dạng lỗi khoản 141 nói tới. NOT NULL không DEFAULT làm chúng đỏ đồng
-- loạt, và còn làm phép đo trigger MFA ở `apps/api/src/auth.int.test.ts` đỏ vì THIẾU CỘT thay vì vì trigger — một khẳng định đỏ sai lý
-- do là một khẳng định mù. Giá phải trả ở chiều ngược, nói thẳng: mọi đường ghi QUÊN khai `kind` sinh ra một phiên TOÀN QUYỀN. Lớp bù
-- duy nhất nằm ở TypeScript — `startUserSession` nêu tên cột `kind` TƯỜNG MINH trong câu INSERT sản xuất duy nhất, không dựa vào
-- DEFAULT. DEFAULT bảo vệ lượt chạy test; nó KHÔNG bảo vệ sản xuất.
--
-- CẤP `SELECT (kind)` CHO `app_unseal`, và đây là chỗ bản đầu sai (lượt soi đối kháng Đ-5). Bản đầu giữ nguyên sáu cột của 006 với lý
-- do "giữ đúng nguyên tắc 006 tự viết" — một quy ước văn phong, không phải một lập luận an ninh. Chính 006 ghi rằng sáu cột ấy được cấp
-- *"vì bất biến D1"*, và "không giải mã dưới một chứng chỉ agent" là một câu CÙNG HẠNG D1: giải mã là hành động KHÔNG THU HỒI ĐƯỢC duy
-- nhất của hệ thống, và `apps/unseal-worker` chạy lại `assertFreshMfa` trên `dispatched_by_session_id` dưới vai `app_unseal`. Hôm nay
-- chưa khai thác được — `dispatched_by_session_id` chỉ do `POST /unseal/:id/dispatch` ghi, một route GHI mà phiên agent bị chặn — nhưng
-- một dòng GRANT rẻ BÂY GIỜ và đắt sau khi checksum khoá tệp này.
--
-- KHÔNG ghim `OPERATOR(pg_catalog.…)` trong CHECK: 006 mang một khối `*** CÂU DƯỚI ĐÂY SAI. ĐÃ ĐO ***` chứng minh `pg_get_expr` chuẩn
-- hoá cây phân tích nên ghim toán tử trong DDL KHÔNG MUA GÌ, và biểu thức CHECK/DEFAULT được phân giải thành OID ngay lúc DDL. Tiền lệ
-- trần trong chính 006: `CHECK (octet_length(token_hash) = 32)`, `CHECK (expires_at > created_at)`. Chỗ QT3 vẫn áp là THÂN HÀM plpgsql
-- và MỌI câu SQL viết trong `.ts` — xem `session-actor.ts` và `login.ts` của vòng này.
--
-- KHÔNG `COMMENT ON TABLE`: chú thích BẢNG là kênh dành riêng của neo danh tính hardening; neo vẫn đúng sau `ADD COLUMN` vì `attnum`
-- của `org_id` không đổi. KHÔNG chạm POLICY hay RLS của `sessions`: bảng ra đời ở 006, và `kiemTraLacCho` (db/migration-shape.test.ts)
-- không bao giờ tha một `ALTER POLICY`. `ALTER TABLE … ADD COLUMN` + `GRANT` theo cột đi qua sạch — tiền lệ đúng hình dạng: 029.
--
-- CHƯA ĐO: thời gian giữ ACCESS EXCLUSIVE của bốn câu dưới trên một `sessions` có dữ liệu. PostgreSQL 16 không viết lại bảng cho
-- `ADD COLUMN … DEFAULT` hằng, nhưng hai câu `ADD CONSTRAINT` thì QUÉT bảng. Lối thoát nếu số đo xấu áp cho ĐÚNG HAI CÂU ẤY (không áp
-- cho câu `ADD COLUMN`, vì `NOT VALID` không viết được ở đó): thêm `NOT VALID` rồi `VALIDATE CONSTRAINT` ở một lượt sau.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- (1) Cột phạm vi. `DEFAULT 'USER'` — xem khối đầu; đường sản xuất nêu tên cột tường minh.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN kind text NOT NULL DEFAULT 'USER';

-- ---------------------------------------------------------------------------------------------
-- (2) Tập giá trị. Một loại phiên thứ ba phải đi qua một migration, không qua một lần gõ nhầm.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_hop_le
  CHECK (kind IN ('USER', 'AGENT_READONLY'));

-- ---------------------------------------------------------------------------------------------
-- (3) Trần TTL của phiên agent — một giờ. Ràng HIỆU của hai cột, xem ⑵ ở khối đầu.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE sessions ADD CONSTRAINT sessions_agent_ttl_ngan
  CHECK (kind <> 'AGENT_READONLY' OR expires_at <= created_at + interval '60 minutes');

-- ---------------------------------------------------------------------------------------------
-- (4) Quyền. INSERT cho đường phát; SELECT cho worker mở thầu (xem khối đầu, lượt soi Đ-5).
--     KHÔNG có `GRANT UPDATE (kind)`, và sự vắng mặt ấy LÀ bất biến ⑶.
-- ---------------------------------------------------------------------------------------------
GRANT INSERT (kind) ON sessions TO app_api;
GRANT SELECT (kind) ON sessions TO app_unseal;

-- db/migrations/007_outbox.sql
-- Transactional outbox: ghi Ý ĐỊNH vào cùng transaction nghiệp vụ, giao sau.
--
-- Gửi thông báo trực tiếp trong transaction nghiệp vụ dẫn tới một trong hai hỏng hóc: hoặc
-- transaction bị treo theo độ trễ mạng, hoặc thông báo đã gửi mà transaction rollback. Ghi ý
-- định vào CÙNG transaction rồi giao sau là cách duy nhất giữ hai việc nhất quán.
--
-- Outbox KHÔNG BAO GIỜ là nơi đặt logic quyết định. Việc chặn nộp báo giá sau deadline nằm ở
-- ràng buộc trong transaction (ADR-005, bất biến C2), không nằm ở job. Job chỉ làm những việc
-- mà chạy trễ thì phiền, chứ không sai.
--
-- ============================================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: `outbox_jobs` mang trọn CREATE TABLE + ENABLE + FORCE + TOÀN BỘ
-- POLICY + TOÀN BỘ GRANT trong CÙNG file này. Xem khối đầu 002_organizations_and_users.sql để
-- biết vì sao CỬA SỔ giữa hai transaction là thứ nguy hiểm chứ không phải trạng thái cuối.
-- ============================================================================================
--
-- ============================================================================================
-- [QT3] VÌ SAO FILE NÀY VIẾT TÊN HÀM/KIỂU TRẦN, TRONG KHI packages/outbox/src/*.ts THÌ KHÔNG
-- ============================================================================================
-- Một tiền đề, đã đo (vòng fix 3 của Task 8), và nó ĐỦ MỘT MÌNH cho file này:
--
--   `migrate()` chạy `SET search_path = public` làm câu lệnh ĐẦU TIÊN trên kết nối
--   (packages/db/src/migrate.ts). Chuỗi đó KHÔNG NÊU TÊN `pg_catalog`, nên PostgreSQL tìm
--   `pg_catalog` NGẦM TRƯỚC TIÊN:
--       search_path = 'ke2, public'              -> `uuid` phân giải về pg_catalog.uuid
--       search_path = 'ke2, pg_catalog, public'  -> `uuid` phân giải về ke2.uuid
--   Tức trục này bị đóng bằng HÌNH DẠNG search_path, không bằng thời điểm DDL. Chính việc NÊU
--   TÊN `pg_catalog` ở vị trí sau mới là thứ phá quy tắc tìm ngầm. ~71 chỗ `::text`/`::oid`
--   trong hardening.always.sql đang đứng bằng đúng tính chất này.
--
-- KHÔNG mang theo tiền đề thứ hai mà 006 từng viết ("ghim toán tử trong policy làm migration
-- KHÔNG DEPLOY ĐƯỢC"). Câu đó ĐÃ BỊ ĐO LÀ SAI ở hai tầng độc lập và đã bị gạch bỏ tại chỗ
-- trong 006 §(2) — `pg_get_expr` deparse từ CÂY PHÂN TÍCH nên ba cách viết cho ĐÚNG một chuỗi,
-- và `migrate()` chạy được với policy ghim đầy đủ. Phát biểu đúng: ghim toán tử TRONG POLICY
-- không mua gì, vì biểu thức policy được phân giải sang OID NGAY LÚC DDL (đã đo ở
-- db/migrations.int.test.ts "[fix S3]"). Đó là "KHÔNG CẦN", không phải "KHÔNG THỂ" — và file
-- này viết trần vì tiền đề ở trên, không vì câu đã bị bác bỏ kia.
--
-- Phần CÒN LẠI của trục, nói đúng mức: mọi biểu thức DEFAULT, CHECK và POLICY dưới đây được
-- PostgreSQL phân giải NGAY LÚC DDL và lưu dưới dạng OID. Thứ KHÔNG có tính chất đó là thân
-- hàm plpgsql — file này cố ý KHÔNG tạo hàm hay trigger nào (xem LỆCH 8/9), nên trục ấy không
-- mở ra. Ngược lại, mọi câu SQL của packages/outbox/src/*.ts chạy trên pool ỨNG DỤNG dưới một
-- `search_path` mà dự án KHÔNG kiểm soát — ở đó toán tử, tên hàm VÀ tên kiểu đều ghim đủ.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (1/9): CHỈ MỤC CHỐNG TRÙNG CHỈ ÁP CHO JOB CHƯA KẾT THÚC
-- ============================================================================================
-- Brief viết chú thích "chống trùng theo khoá nghiệp vụ, CHỈ ÁP CHO JOB CHƯA KẾT THÚC" ngay
-- trên một chỉ mục `WHERE dedupe_key IS NOT NULL` — tức áp cho CẢ `DONE` LẪN `FAILED`. Chú
-- thích và câu lệnh nói hai điều khác nhau; `.sql` là bằng chứng kiểm toán nên một trong hai
-- phải sai. Ở đây CÂU LỆNH sai, và hậu quả không phải chuyện chữ nghĩa:
--
--   một job neo chuỗi kiểm toán dedupe theo NGÀY, thất bại VĨNH VIỄN MỘT LẦN (`FAILED`), sẽ
--   CHIẾM khoá `(org, kind, dedupe_key)` mãi mãi. Mọi lần enqueue sau đó cho cùng khoá lặng lẽ
--   không tạo hàng nào và `enqueueJob` trả về id của cái xác cũ. Việc neo chuỗi NGỪNG CHẠY mà
--   không ai thấy gì đỏ.
--
-- Đúng ba tính chất của lớp hỏng hóc tệ nhất: fail-OPEN, IM LẶNG, VĨNH VIỄN. Chỉ mục dưới đây
-- mang thêm vế `status IN ('PENDING', 'RUNNING')` để chú thích và câu lệnh khớp nhau, và để
-- một khoá chống trùng được TRẢ LẠI ngay khi job mang nó tới trạng thái cuối.
--
-- Cái vế đó KHÔNG mua được (nói ra thay vì hứa suông): nó không chống trùng theo NỘI DUNG. Hai
-- job cùng khoá, cái trước đã `DONE`, thì cái sau chèn được — và đó chính là điều mong muốn cho
-- một job theo chu kỳ, nhưng nó KHÔNG phải "mỗi khoá đúng một lần trong đời". Ai cần ngữ nghĩa
-- ấy phải mang khoá thời gian vào chính `dedupe_key` (khuôn "neo-ngay-2026-08-27").
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (2/9): `attempts` LÀ SỐ LẦN ĐÃ THỬ, VÀ `maxAttempts` LÀ TRẦN CỦA CHÍNH NÓ
-- ============================================================================================
-- Đây là một phát biểu về "thử bao nhiêu lần", nên nó phải được ghi đúng ở đúng một chỗ.
-- `#claim` tăng `attempts` rồi RETURNING giá trị ĐÃ TĂNG, nên con số mà runner cầm trên tay là
-- SỐ LẦN ĐÃ THỬ KỂ CẢ LẦN NÀY. Ngưỡng bỏ cuộc vì thế là `attempts >= maxAttempts`, không phải
-- `attempts + 1 >= maxAttempts` như brief viết. Với `maxAttempts = 3`:
--     lượt 1: attempts 0->1, 1>=3 sai -> PENDING
--     lượt 2: attempts 1->2, 2>=3 sai -> PENDING
--     lượt 3: attempts 2->3, 3>=3 ĐÚNG -> FAILED, và `attempts` dừng ở 3.
-- Bản của brief bỏ cuộc ở lượt 2 với `attempts = 2` — tức `maxAttempts: 3` thật ra chỉ THỬ HAI
-- LẦN, và chính test của brief (`expect(attempts).toBe(3)`) sẽ ĐỎ trên chính mã của brief.
-- Sửa NGƯỠNG chứ không sửa test, vì "maxAttempts là số lần thử tối đa" là cách đọc duy nhất mà
-- người vận hành sẽ dùng.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (3/9): CÓ LEASE — VÌ "UPDATE TAY TRÊN CỤM PRODUCTION" KHÔNG PHẢI MỘT THIẾT KẾ
-- ============================================================================================
-- Brief đặt `status = 'RUNNING'` lúc claim và KHÔNG có gì đưa nó ra khỏi đó. Tiến trình runner
-- chết giữa chừng — deploy, OOM, mất mạng, hoặc chính `#markFailed` ném — thì hàng nằm ở
-- `RUNNING` VĨNH VIỄN, và `#claim` chỉ nhặt `PENDING` nên KHÔNG AI nhặt lại. Câu trả lời cho
-- QT1 ("ai sửa được, bằng cách nào, trong bao lâu?") khi đó là "một người vận hành chạy UPDATE
-- tay trên cụm production" — đúng thứ QT1 gọi là thiết kế sai.
--
-- `lease_expires_at` là câu trả lời: claim đặt hạn thuê; `#claim` cũng nhặt hàng `RUNNING` có
-- hạn thuê ĐÃ QUA. Ai sửa được: BẤT KỲ runner nào. Bằng cách nào: không cần làm gì cả. Trong
-- bao lâu: tối đa `leaseSeconds` + một chu kỳ poll. Không câu lệnh tay nào, không quyền nào
-- vượt quá quyền runner đã có.
--
-- HỆ QUẢ PHẢI NÓI RA, vì nó đổi HỢP ĐỒNG với người viết handler: outbox này là AT-LEAST-ONCE.
-- Một handler chạy quá `leaseSeconds` sẽ thấy job của mình bị runner khác nhặt lại và chạy lần
-- hai. Đó không phải khiếm khuyết của lease — đó là tính chất của MỌI hàng đợi có thu hồi, và
-- lựa chọn thay thế (không thu hồi) là AT-MOST-ONCE kèm rò rỉ vĩnh viễn ở trên. Handler PHẢI
-- idempotent. Lớp còn lại mà mã mua được, và nó không tầm thường: mọi câu ghi kết cục đều mang
-- vế `attempts = <giá trị đã claim>`, nên một runner ĐÃ MẤT hạn thuê không ghi đè được kết cục
-- do runner mới đặt (xem packages/outbox/src/runner.ts).
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (4/9): KHÔNG CÓ ROLE `app_worker`, KHÔNG CÓ `BYPASSRLS` — RUNNER CHẠY TRONG
-- NGỮ CẢNH TENANT, DƯỚI `app_api`, DƯỚI FORCE RLS
-- ============================================================================================
-- Brief viết: runner phải nhận "một pool có quyền vượt RLS"; trong test đó là `db.pool` (siêu
-- người dùng của Testcontainers); khi triển khai thật thì tạo role `app_worker` có `BYPASSRLS`
-- và cấp quyền "chỉ trên outbox_jobs". Brief gọi sự bất đối xứng ấy là "phản ánh đúng thiết kế
-- triển khai thật". BA phép đo bác bỏ từng vế một (xem packages/outbox/src/outbox.int.test.ts,
-- các test `[T10-D]`):
--
--   (a) SIÊU NGƯỜI DÙNG ≠ ROLE CÓ BYPASSRLS. Siêu người dùng còn bỏ qua FORCE RLS trên bảng
--       không sở hữu, bỏ qua ACL mức CỘT, bỏ qua MỌI GRANT. Một bộ test chạy runner trên
--       `db.pool` vì thế KHÔNG ĐO một dòng nào của khuôn triển khai thật: nó xanh y hệt khi
--       policy bị xoá, khi FORCE bị bỏ, và khi mọi GRANT bị thu hồi.
--   (b) `BYPASSRLS` LÀ THUỘC TÍNH CỦA ROLE, KHÔNG PHẢI THEO TỪNG BẢNG. Câu "cấp quyền CHỈ trên
--       outbox_jobs" giới hạn bán kính bằng GRANT, KHÔNG bằng BYPASSRLS. Bán kính thật của
--       thuộc tính ấy là "mọi bảng mà role này có hoặc SẼ CÓ quyền" — một dòng `GRANT SELECT ON
--       bao_gia TO app_worker` ở một migration S1 hoàn toàn hợp lý biến nó thành một đường đọc
--       giá thầu XUYÊN TỔ CHỨC, và không lớp nào trong dự án hôm nay kêu.
--   (c) VÀ NÓ KHÔNG CẦN THIẾT. Một runner phục vụ nhiều tổ chức làm được việc của nó bằng cách
--       chạy TỪNG TỔ CHỨC MỘT trong `withTenant()`: claim, chạy handler, ghi kết cục — tất cả
--       dưới đúng `app.org_id` ấy, đúng RLS, đúng FORCE, đúng GRANT mức cột.
--
-- CÁI GIÁ CỦA (c), nói thẳng: runner phải BIẾT danh sách tổ chức, và không có `BYPASSRLS` thì
-- nó không tự đọc được danh sách ấy (`organizations` cũng bật RLS `id = app_current_org_id()`).
-- `JobRunner` vì vậy nhận một CỔNG `listOrganizations` do composition root tiêm vào — cùng
-- khuôn đảo phụ thuộc mà Task 9 đã dùng cho `TotpSecretUnsealer`, và cùng khoản nợ: hôm nay
-- KHÔNG có cài đặt sản phẩm nào cho cổng đó vì `apps/` còn rỗng. Khoản nợ ấy được ghi ra
-- (task-10-report.md §5) thay vì được che bằng một role vượt RLS ra đời trước cả tiến trình
-- dùng nó. QT2: GHIM cấu hình, đừng NỚI bảo đảm.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (5/9): KHÔNG CÓ CỘT `last_error` — MỘT CỘT VĂN BẢN TỰ DO LÀ MỘT CỐNG RÒ GIÁ
-- ============================================================================================
-- Brief ghi `(error as Error).message` vào `outbox_jobs.last_error` và `start()` còn
-- `console.error` chính chuỗi đó. Job thông báo khi RFQ đóng thầu mang payload nghiệp vụ; một
-- handler ném `new Error(\`không gửi được tới ${email} cho báo giá ${gia}\`)` — cách viết lỗi
-- thông thường nhất — thì GIÁ nằm trong CSDL ở một cột `app_api` đọc được, và nằm trong log.
-- Đó là vi phạm thẳng lệnh CẤM LOG (giá, mật khẩu, token, mã OTP, khoá).
--
-- Dự án đã có tiền lệ ĐO ĐƯỢC cho đúng lớp này: Task 8 khẳng định không mảnh nào của giá/token
-- lọt vào thông báo lỗi; Task 9 vòng fix 1 phải BỌC lỗi của cổng để `message` chỉ mang TÊN
-- adapter còn nguyên nhân đi qua `cause`. Và Task 8 §F7 đã ghi một cảnh báo đúng chỗ này:
-- `audit_events.resource_type` là chuỗi TỰ DO đi thẳng vào sổ, và một chuỗi chứa giá + mã OTP
-- đi lọt qua nó.
--
-- Ở đây lớp cưỡng chế đặt tại TẦNG CSDL chứ không phải một lời hứa ở tầng ứng dụng:
-- `last_failure_reason` nhận ĐÚNG một tập đóng ba giá trị, ép bằng CHECK. Một câu `UPDATE ...
-- SET last_failure_reason = '<giá thầu>'` do bất kỳ ai phát ra — kể cả chủ sở hữu bảng, kể cả
-- một tác giả tương lai không đọc chú thích này — bị 23514 chặn. Không có văn bản tự do nào để
-- rò.
-- Cái nó mất, nói thẳng: chẩn đoán. Thông điệp lỗi thật KHÔNG vào CSDL và KHÔNG vào log của
-- thư viện; nó đi tới một quan sát viên `onFailure` do người gọi tiêm vào, mặc định IM LẶNG —
-- cùng khuôn `migrate({ onThongBao })` của Task 8 vòng fix 2, và cùng lý do: chính sách khử
-- nhạy cảm của log thuộc về composition root, không thuộc về một thư viện hàng đợi.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (6/9): `app_unseal` KHÔNG ĐƯỢC CẤP GÌ TRÊN BẢNG NÀY
-- ============================================================================================
-- Brief cấp `SELECT, INSERT, UPDATE` cho CẢ `app_api` LẪN `app_unseal` trên cùng bảng, mức
-- BẢNG. Câu hỏi phải trả lời trước khi cấp là "hôm nay có dòng mã nào của runtime mở thầu ghi
-- hay đọc outbox không?" — đo: `apps/` RỖNG, không có tiến trình mở thầu nào tồn tại. Vậy đây
-- là một quyền KHÔNG DÙNG TỚI, và dự án đã hai lần từ chối đúng loại đó kèm lý do (002 từ chối
-- INSERT trên `organizations`; 006 từ chối UPDATE trên `sessions.expires_at`): một quyền cấp
-- "cho chắc" là một quyền không ai gỡ ra nữa.
-- KIỂM LẠI VỚI "KHÔNG ROLE NÀO BAO ROLE KIA" (ADR-006) và [NỢ ADR-006] mà Task 8 để lại: file
-- này KHÔNG cấp gì cho app_unseal, nên nó KHÔNG làm khoản nợ đó xanh vì lý do sai, và test đảo
-- chiều đang canh nó vẫn đúng. Khi S1 có một đường mở thầu thật sự cần enqueue thông báo, cấp
-- ĐÚNG cột cần, kèm lý do — đúng khuôn 006 đã làm với ba cột của `users`.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (7/9): `run_after` KHÔNG BỊ GHI ĐÈ KHI JOB VÀO TRẠNG THÁI CUỐI
-- ============================================================================================
-- Brief đặt `run_after = now() + make_interval(secs => 0)` cả trên nhánh `FAILED`. Hàng ở trạng
-- thái cuối không còn "sớm nhất được phép chạy" nào để nói, nên việc ghi đè chỉ XOÁ lịch gốc —
-- tức xoá đúng thứ mà người điều tra một job chết cần đọc ("nó được hẹn chạy lúc nào?"). Nhánh
-- `FAILED` dưới đây giữ nguyên `run_after` và đặt `finished_at`.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (8/9): KHÔNG CÓ `updated_at` — VÀ VÌ SAO KHÔNG PHẢI "THÊM MỘT TRIGGER"
-- ============================================================================================
-- Brief có `updated_at` mà KHÔNG có trigger: nó chỉ đúng chừng nào chính runner nhớ `SET`. Một
-- đường ghi khác — một câu vá tay, một migration sau — làm nó THIU TRONG IM LẶNG, và một cột
-- thời gian nói dối tệ hơn một cột không tồn tại.
--
-- ĐƯỜNG "THÊM TRIGGER" ĐÃ ĐƯỢC CÂN NHẮC VÀ TỪ CHỐI, kèm phép đo (xem test `[T10-I]`):
-- `hardening.always.sql` cưỡng chế THÂN của các hàm plpgsql theo TÊN, từng hàm một, trong một
-- danh sách viết tay. Một hàm `outbox_jobs_touch()` mới KHÔNG nằm trong danh sách đó, nên sau
-- lần deploy đầu tiên một `CREATE OR REPLACE FUNCTION` biến thân nó thành no-op và `migrate()`
-- KHÔNG phát hiện gì — đúng lớp "mũi đột biến ĐƠN LỚP ở migration đánh số sống sót mà không có
-- nghĩa gì". Bảo đảm mà trigger mua được vì thế chỉ tồn tại tới lần deploy kế tiếp; đổi lại nó
-- thêm một hàm KHÔNG ĐƯỢC GHIM vào `public`.
-- Thay vào đó: mỗi mốc thời gian có ĐÚNG MỘT người ghi và một ý nghĩa hẹp không nói dối được —
-- `created_at` (DEFAULT, không cấp INSERT), `lease_expires_at` (do claim đặt, do kết cục xoá),
-- `finished_at` (do kết cục đặt). Hai CHECK ở cuối bảng khoá ba cột ấy với `status` để không
-- trạng thái nào biểu diễn được hai câu chuyện khác nhau.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (9/9): KHÔNG MỘT TEST NÀO CỦA TASK NÀY MANG THẺ [INV-C2], [INV-D4] HAY [INV-B3]
-- ============================================================================================
-- Brief liệt kê C2, D4, B3 là "bất biến liên quan" và gắn thẻ `[INV-C2]` cho một test. Bộ sinh
-- của Task 11 gom test theo MÃ trong thẻ, nên một thẻ sai không phải chuyện vệ sinh: nó ghi một
-- dòng "passed" vào `evidence/INV-matrix.md` dưới một bất biến chưa có lớp nào. Task 9 vừa phát
-- hiện đúng lớp khiếm khuyết ấy ở hàng G2/G4 (nhãn sai che một hàng LẼ RA ĐÃ TRỐNG TỪ ĐẦU).
-- Ba phép đo, mỗi thẻ một:
--   C2 — sổ đăng ký (docs/TEST-PLAN.md) định nghĩa C2 bằng "job đóng RFQ chết không làm bid
--        muộn được chấp nhận", cưỡng chế bằng "Kiến trúc (ADR-005)". Đo: KHÔNG có bảng rfq,
--        KHÔNG có bảng báo giá, KHÔNG có `deadline_at` nào trong 001–007. Chủ ngữ của C2 chưa
--        tồn tại. Test "kind lạ chuyển sang FAILED chứ không treo" đo một tính chất THẬT của
--        runner (không có handler thì bỏ cuộc ngay thay vì thử lại mãi), nhưng tính chất đó
--        không phải C2.
--   D4 — "break-glass sinh cảnh báo mức cao TỨC THÌ, không bao giờ im lặng". Outbox là POLL
--        (`pollIntervalMs` mặc định 1000ms), nên độ trễ của nó bị CHẶN DƯỚI bởi chu kỳ poll —
--        đặt cảnh báo break-glass qua đường này MÂU THUẪN với chính D4. Đường đúng là
--        `NOTIFY`/`LISTEN` hoặc một đường đồng bộ. Đo, và phát biểu ĐÚNG PHẠM VI: số TEST mang
--        thẻ D4 trong repo là 0 TRƯỚC task này và vẫn 0 SAU task này. (Chuỗi thẻ tự nó có xuất
--        hiện — trong chính đoạn này và trong test canh nhãn — nên "0 hit khi grep" sẽ là một
--        câu SAI; thứ được đo là thẻ nằm trên một `it(...)`, đúng thứ bộ sinh Task 11 gom.)
--   B3 — sổ đăng ký định nghĩa B3 về `audit_events` là chuỗi hash và bộ kiểm chứng phát hiện
--        chèn/sửa/xoá/cắt đuôi. Task 6 đã phủ nó bằng 20+ test THẬT. Task 10 không thêm gì cho
--        B3; nó chỉ làm cho một job neo chuỗi TƯƠNG LAI không bị chết vĩnh viễn (LỆCH 1/9).
-- Có một test canh chính điều này (`packages/outbox/src/nhan-bat-bien.test.ts`) để lần sau ai
-- gắn thẻ vào gói này thì thẻ đó phải là một quyết định NHÌN THẤY ĐƯỢC.
-- Thẻ DUY NHẤT được dùng ở đây là `[INV-F1]`, và nó đúng nghĩa đen: `outbox_jobs` là một bảng
-- tenant mới, cách ly bằng RLS ở tầng CSDL.

-- ------------------------------------------------------------------------------------------
-- (1) BẢNG OUTBOX.
--
-- `kind` bị chặn CẤU TRÚC, không lọc nội dung — cùng khuôn `sessions.user_agent` ở 006 và cùng
-- lý do đã ghi ở Task 8 §F7 (`resource_type` là chuỗi tự do đi thẳng vào sổ, và một chuỗi chứa
-- giá + mã OTP đi lọt qua nó). `kind` do bên gọi chọn và `app_api` đọc lại được; một mã định
-- danh viết hoa tối đa 64 ký tự đủ cho mọi loại job thật và biến "kho lưu trữ tuỳ ý" thành một
-- nhãn. `payload` thì CÓ CHỦ ĐÍCH là dữ liệu nghiệp vụ tuỳ ý — nó là nội dung của job, nằm
-- trong tổ chức, được RLS che. Phân biệt đó là cố ý: cột NHÃN bị chặn, cột NỘI DUNG thì không.
--
-- `dedupe_key` cũng bị chặn độ dài: nó nằm trong một chỉ mục btree, và btree từ chối khoá quá
-- ~2704 byte bằng một lỗi lúc CHẠY — tức một chuỗi dài do bên gọi chọn biến `enqueueJob` thành
-- một lỗi không lường trước GIỮA transaction nghiệp vụ. 200 byte đủ cho mọi khoá nghiệp vụ và
-- biến ca ấy thành một ràng buộc nói rõ mình là gì.
--
-- Hai CHECK cuối bảng khoá ba cột thời gian với `status` (xem LỆCH 8/9): chỉ hàng đang chạy mới
-- có hạn thuê, và chỉ hàng ở trạng thái cuối mới có mốc kết thúc. Không có chúng thì một hàng
-- `DONE` mang `lease_expires_at` cũ là một trạng thái vừa hợp lệ vừa vô nghĩa.
-- ------------------------------------------------------------------------------------------
CREATE TABLE outbox_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id),
  kind                 text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key           text CHECK (dedupe_key IS NULL
                                   OR (octet_length(dedupe_key) > 0
                                       AND octet_length(dedupe_key) <= 200)),
  status               text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  attempts             integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Xem LỆCH KHỎI BRIEF (5/9). TẬP ĐÓNG, ép ở tầng CSDL. Không phải nơi chứa thông điệp lỗi.
  --   HANDLER_ERROR — handler đã chạy và ném.
  --   NO_HANDLER    — không có handler cho `kind` này (lỗi cấu hình, bỏ cuộc ngay).
  -- Cố ý KHÔNG có mã cho "mất hạn thuê": runner mất hạn thuê KHÔNG ĐƯỢC PHÉP ghi gì vào hàng đó
  -- nữa (vế `attempts = <giá trị đã claim>` làm câu UPDATE chạm 0 hàng), nên một mã như thế sẽ
  -- là một giá trị không đường nào ghi được. Ca đó chỉ tới quan sát viên `onFailure`.
  last_failure_reason  text CHECK (last_failure_reason IS NULL
                                   OR last_failure_reason IN ('HANDLER_ERROR', 'NO_HANDLER')),
  run_after            timestamptz NOT NULL DEFAULT now(),
  lease_expires_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  CHECK ((status = 'RUNNING') = (lease_expires_at IS NOT NULL)),
  CHECK ((status IN ('DONE', 'FAILED')) = (finished_at IS NOT NULL))
);

-- Xem LỆCH KHỎI BRIEF (1/9): chống trùng CHỈ áp cho job CHƯA KẾT THÚC — chú thích và câu lệnh
-- nay nói cùng một điều.
CREATE UNIQUE INDEX outbox_jobs_dedupe_idx
  ON outbox_jobs (org_id, kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('PENDING', 'RUNNING');

-- Hai chỉ mục claim, mỗi cái phục vụ MỘT vế của vị từ nhặt việc. Cả hai dẫn đầu bằng `org_id`
-- vì runner nhặt việc TỪNG TỔ CHỨC MỘT (xem LỆCH 4/9), nên `org_id` là cột lọc đầu tiên của
-- mọi truy vấn — kể cả khi RLS đã cắt tập hàng, chính truy vấn cũng viết vế ấy ra (bài học đo
-- được của Task 8: "RLS đã giới hạn tập hàng" là câu CÓ ĐIỀU KIỆN, sai với phiên không chịu RLS).
CREATE INDEX outbox_jobs_claim_idx
  ON outbox_jobs (org_id, run_after) WHERE status = 'PENDING';
CREATE INDEX outbox_jobs_lease_idx
  ON outbox_jobs (org_id, lease_expires_at) WHERE status = 'RUNNING';

ALTER TABLE outbox_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_jobs_tenant_isolation ON outbox_jobs
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON outbox_jobs TO app_api;
-- INSERT theo CỘT. Hai vắng mặt, mỗi cái đóng một đường đi — cùng khuôn 006:
--   `id`                  -> `outbox_jobs_pkey` không dùng làm oracle xuyên tổ chức được
--                            (khuôn `users_pkey` ở 002); DEFAULT gen_random_uuid() lo phần đó.
--   `created_at`          -> dấu thời gian do CSDL đóng; bên ghi chọn được nó là một hàng đợi
--                            sắp xếp lại được theo ý mình (khuôn `occurred_at` ở 003).
-- Và ba cột vòng đời — `status`, `attempts`, `last_failure_reason` — cũng KHÔNG có INSERT: một
-- job không được RA ĐỜI đã ở trạng thái `DONE`, đã mang sẵn số lần thử, hay đã mang sẵn một lý
-- do thất bại. `lease_expires_at`/`finished_at` không có INSERT vì hai CHECK ở trên đã buộc
-- chúng NULL ở trạng thái `PENDING`, nên cấp chúng chỉ mở một đường ghi không dùng được.
GRANT INSERT (org_id, kind, payload, dedupe_key, run_after) ON outbox_jobs TO app_api;
-- UPDATE đúng sáu cột mà runner ghi, và `org_id`/`kind`/`payload`/`dedupe_key` vắng mặt là
-- load-bearing: không đường nào chuyển một job sang tổ chức khác, đổi loại việc, hay sửa nội
-- dung một job đã nằm trong hàng đợi.
GRANT UPDATE (status, attempts, last_failure_reason, run_after, lease_expires_at, finished_at)
  ON outbox_jobs TO app_api;
-- Xem LỆCH KHỎI BRIEF (6/9): cố ý KHÔNG cấp gì cho app_unseal — kể cả SELECT.

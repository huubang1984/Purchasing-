-- db/migrations/006_sessions_and_mfa.sql
-- Phiên đăng nhập và xác thực hai lớp TOTP (bất biến D1, E3).
--
-- ============================================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: hai bảng `sessions` và `mfa_credentials` mang trọn
-- CREATE TABLE + ENABLE + FORCE + TOÀN BỘ POLICY + TOÀN BỘ GRANT trong CÙNG file này.
-- Xem khối đầu 002_organizations_and_users.sql để biết vì sao cửa sổ giữa hai transaction là
-- thứ nguy hiểm chứ không phải trạng thái cuối.
-- ============================================================================================
--
-- ============================================================================================
-- [QT3] VÌ SAO FILE NÀY VIẾT TÊN HÀM/TOÁN TỬ TRẦN, TRONG KHI packages/identity/src/*.ts THÌ KHÔNG
-- ============================================================================================
-- Đây KHÔNG phải một chỗ lỏng lẻo còn sót; nó là hệ quả đo được của hai tiền đề, và bỏ qua
-- một trong hai sẽ làm file này GÃY chứ không phải "an toàn hơn":
--
--   (1) `migrate()` chạy `SET search_path = public` làm câu lệnh ĐẦU TIÊN trên kết nối
--       (packages/db/src/migrate.ts). Chuỗi đó KHÔNG NÊU TÊN `pg_catalog`, nên PostgreSQL tìm
--       `pg_catalog` NGẦM TRƯỚC TIÊN — quy tắc đã đo ở vòng fix 3 của Task 8:
--           search_path = 'ke2, public'              -> `uuid` phân giải về pg_catalog.uuid
--           search_path = 'ke2, pg_catalog, public'  -> `uuid` phân giải về ke2.uuid
--       Tức trục bị đóng bằng HÌNH DẠNG search_path, không bằng thời điểm DDL. Chính việc NÊU
--       TÊN `pg_catalog` ở vị trí sau mới là thứ phá quy tắc tìm ngầm. ~71 chỗ `::text`/`::oid`
--       trong hardening.always.sql đang đứng bằng đúng tính chất này.
--   (2) *** CÂU DƯỚI ĐÂY SAI. ĐÃ ĐO. GIỮ NGUYÊN VĂN ĐỂ ĐỐI CHIẾU, KHÔNG XOÁ. ***
--       >>> "BIỂU THỨC POLICY BỊ SO KHỚP NGUYÊN VĂN. `hardening.always.sql` mục (B) so
--       >>>  `pg_get_expr(p.polqual, ...)` với danh sách trắng `HINH_DANG_CHUAN`, và dòng duy
--       >>>  nhất cho bảng có org_id là chuỗi `'(org_id = app_current_org_id())'`. Viết
--       >>>  `(org_id OPERATOR(pg_catalog.=) public.app_current_org_id())` deparse ra một chuỗi
--       >>>  KHÁC HẲN, không nằm trong danh sách trắng, và `migrate()` sẽ CHẶN chính file này ở
--       >>>  lượt `phan_xet`. Ghim toán tử ở đây KHÔNG phải 'chặt hơn', nó là KHÔNG DEPLOY
--       >>>  ĐƯỢC."
--
--       VÌ SAO NÓ SAI — HAI PHÉP ĐO ĐỘC LẬP, HAI TẦNG KHÁC NHAU, CÙNG KẾT LUẬN:
--         Ở TẦNG CƠ CHẾ, `pg_get_expr` CHUẨN HOÁ cây phân tích chứ không in lại văn bản nguồn:
--           USING (org_id = app_current_org_id())                              -> "(org_id = app_current_org_id())"
--           USING (org_id OPERATOR(pg_catalog.=) public.app_current_org_id())  -> CÙNG chuỗi đó
--           USING (org_id OPERATOR(pg_catalog.=) app_current_org_id())         -> CÙNG chuỗi đó
--         cả ba khớp `HINH_DANG_CHUAN`.
--         Ở TẦNG END-TO-END: thay CẢ HAI policy của file này thành dạng ghim đầy đủ rồi chạy
--         `migrate()` trên một cụm sạch -> THÀNH CÔNG. Đối chứng dương `USING (true)` -> BỊ
--         GIẾT ("Hardening không sửa được 1 mục"), nên mục (B) THẬT SỰ đang canh hai policy này.
--
--       VÀ CÂU SAI ĐÓ MÂU THUẪN VỚI CHÍNH FILE CÓ THẨM QUYỀN MÀ NÓ VIỆN DẪN:
--       `hardening.always.sql:312-318` TỰ GHI RA rằng "năm cách viết khác nhau của CÙNG một
--       cây phân tích ... đều deparse ra ĐÚNG MỘT chuỗi". Tiền đề (1) ở trên được viết đúng
--       sau khi đọc file đó; tiền đề (2) thì viết ngược lại chính nó.
--
--       PHÁT BIỂU ĐÚNG, HẸP, THAY CHO CÂU TRÊN: ghim toán tử trong hai policy dưới đây KHÔNG
--       MUA GÌ, vì biểu thức policy được PostgreSQL phân giải sang OID NGAY LÚC DDL — cùng
--       tính chất đã đo ở db/migrations.int.test.ts "[fix S3]" và đã nói ở đoạn "Phần CÒN LẠI
--       của trục" bên dưới. Đo thẳng: dựng một toán tử `=` thù địch trong một schema đứng
--       trước trong `search_path` lúc CHẠY -> `app_api` gắn tổ chức A vẫn đọc đúng 5/6 hàng,
--       tức đúng số hàng của A; RLS KHÔNG BỊ LẬT. Đây là "KHÔNG CẦN GHIM", KHÔNG phải "KHÔNG
--       GHIM ĐƯỢC" — và một mình tiền đề (1) đã đủ biện minh cho việc viết trần trong file này.
--
--       VÌ SAO GIỮ NGUYÊN VĂN CÂU SAI thay vì xoá: một ràng buộc cứng ("KHÔNG DEPLOY ĐƯỢC")
--       từng được phát biểu, đưa vào commit, và dán nhãn "REJECTED CÓ ĐO". Task 10 có policy
--       mới và có sẵn một cạm bẫy về QT3; nếu niềm tin đó được mang theo, cạm bẫy ấy bị gạt đi
--       miễn phí. Một câu sai bị gạch bỏ TẠI CHỖ dạy được điều đó; một câu bị xoá thì không.
--
-- Ngược lại, mọi câu SQL của tầng ứng dụng (packages/identity/src/mfa.ts,
-- mfa-credentials.ts) chạy trên pool ỨNG DỤNG dưới `search_path` mà dự án KHÔNG kiểm soát —
-- ở đó toán tử, tên hàm VÀ tên kiểu đều ghim đủ. Xem khối [QT3] ở hai file đó.
--
-- Phần CÒN LẠI của trục, nói đúng mức: mọi biểu thức DEFAULT, CHECK và POLICY ở dưới được
-- PostgreSQL phân giải NGAY LÚC DDL và lưu dưới dạng OID, nên `search_path` lúc CHẠY không đổi
-- được chúng (đã đo ở db/migrations.int.test.ts "[fix S3] ..."). Thứ KHÔNG có tính chất đó là
-- thân hàm plpgsql — file này cố ý KHÔNG tạo hàm hay trigger nào, nên trục ấy không mở ra.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (1/6): `now()` LÀ ĐỒNG HỒ CỦA TRANSACTION, KHÔNG PHẢI CỦA THẾ GIỚI
-- ============================================================================================
-- Brief viết phép kiểm độ tươi bằng `now()` kèm chú thích "độ tươi được tính bằng đồng hồ của
-- cơ sở dữ liệu". Chú thích ĐÚNG, hàm SAI: `now()` (= `transaction_timestamp()`) đóng băng ở
-- thời điểm BẮT ĐẦU transaction. Một transaction mở 10 phút vẫn qua được phép kiểm "tươi 5
-- phút", và một transaction dài là chuyện bình thường trong một luồng mở thầu. Mọi phép so
-- ĐỘ TƯƠI ở tầng ứng dụng dùng `clock_timestamp()` — xem packages/identity/src/mfa.ts.
-- Ở FILE NÀY `now()` chỉ còn xuất hiện trong DEFAULT của `created_at`: dấu thời gian TẠO một
-- hàng gắn với transaction tạo ra nó là điều đúng, và đó cũng là khuôn của 002/003/005.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (2/6): RÀNG BUỘC DUY NHẤT ĐI THEO TỔ CHỨC
-- ============================================================================================
-- Brief viết `UNIQUE (user_id, kind)` trên `mfa_credentials` và `token_hash bytea UNIQUE` trên
-- `sessions`. Cả hai là ràng buộc DUY NHẤT TOÀN CỤC, đúng lớp mà 002 (`organizations.slug`,
-- `users_pkey`) và 005 (`user_roles`) đã phải bỏ công đóng: thông báo "duplicate key" chạy dưới
-- quyền hệ thống trên TOÀN bảng, RLS không che được, nên nó là một oracle nhị phân xuyên tổ
-- chức. Và thứ tự phán xét làm nó chắc chắn lộ: RLS `WITH CHECK` được đánh giá TRƯỚC khi chỉ
-- mục duy nhất nổ, nên hàng của kẻ tấn công qua được vế `org_id = <tổ chức của chính nó>` rồi
-- mới chạm ràng buộc toàn cục.
--
-- PHÁN XỬ, KHÔNG GIẢ ĐỊNH — hai ràng buộc có mức độ khai thác KHÁC NHAU và cả hai vẫn được sửa:
--   * `(user_id, kind)`: KHAI THÁC ĐƯỢC. `user_id` là uuid, nhưng một app_api bị chiếm ở tổ
--     chức A ĐÃ BIẾT uuid của người dùng tổ chức A; câu hỏi mà oracle trả lời là "người này có
--     đăng ký MFA ở MỘT TỔ CHỨC KHÁC không" — tức nó tiết lộ việc một cá nhân có tài khoản ở
--     tổ chức khác trên cùng sàn. Trên sàn thầu kín đó là tin có giá.
--   * `token_hash`: khai thác thực tế ≈ 0 — tiền ảnh là 32 byte ngẫu nhiên, nên oracle chỉ XÁC
--     NHẬN một băm đã biết chứ không LIỆT KÊ được, và ai đã có băm thì thường đã có token.
--     Cùng hạng với `users_pkey` (đã phán MINOR ở 002). Nhưng KHUÔN thì vẫn đóng, vì cách đóng
--     ở đây KHÔNG tốn gì: xem "GIAO THỨC TRA CỨU PHIÊN" ngay dưới.
--
-- GIAO THỨC TRA CỨU PHIÊN — hệ quả BẮT BUỘC của việc đưa org_id vào khoá, viết ra vì nếu không
-- ai đọc file này sẽ tưởng bảng này dùng được mà không có nó. `sessions` bật RLS
-- `org_id = app_current_org_id()`, nên KHÔNG có đường nào tra cứu một phiên khi CHƯA biết tổ
-- chức: một phiên chưa gắn tổ chức đọc ra 0 hàng (fail-closed, đúng thiết kế). Vì vậy token do
-- máy chủ phát PHẢI mang theo tổ chức ở dạng đọc được — khuôn "<org_id>.<bí mật ngẫu nhiên>" —
-- để tầng ứng dụng `withTenant(org_id)` TRƯỚC rồi mới tra `token_hash`. org_id không phải bí
-- mật (slug của tổ chức đã nằm trong URL từ 002). Đường đi KHÔNG được phép tồn tại: một hàm
-- SECURITY DEFINER tra cứu xuyên tổ chức — mục (C) của hardening.always.sql CẤM.
--
-- [vòng fix 1 — MỤC 8/M6 + M-2] GIAO THỨC NÀY LÀ VĂN BẢN, KHÔNG PHẢI MỘT LỚP CƯỠNG CHẾ, và
-- toàn bộ ĐƯỜNG ĐỜI của `sessions` CHƯA TỒN TẠI trong mã sản phẩm. Đo: `grep token_hash` và
-- `grep "INSERT INTO sessions"` trên `packages/**/*.ts` trừ file test -> RỖNG. Không có hàm
-- nào phát token, không có hàm nào tra cứu token, không có hàm nào đặt `mfa_verified_at`. Hàng
-- duy nhất mà `assertFreshMfa` từng đọc hôm nay là hàng do một fixture superuser ghi ra.
-- HỆ QUẢ PHẢI NÓI RA để không ai đọc nhầm evidence pack: sự tồn tại của `assertFreshMfa` và
-- 12 test `[INV-D1]` xanh KHÔNG có nghĩa là "D1 đã chạy". Nó có nghĩa là phép KIỂM của D1 đã
-- đúng và đã được đo; đường ĐI TỚI phép kiểm đó thì chưa có ai viết. Khoản nợ này phải đóng
-- TRƯỚC KHI có endpoint đăng nhập, không phải sau.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (3/6): KHOÁ NGOẠI TỔ HỢP — VÀ MỘT PHÁT BIỂU CỦA 005 ĐƯỢC HIỆU CHỈNH
-- ============================================================================================
-- Brief cho `sessions`/`mfa_credentials` hai cột `org_id` và `user_id` với hai khoá ngoại RỜI
-- (`organizations(id)` và `users(id)`). Không gì ép hai cột đó khớp nhau, nên một app_api bị
-- chiếm ở tổ chức A chèn được hàng `(org_id = A, user_id = người của B)`: vế `WITH CHECK` cho
-- qua (org_id đúng là tổ chức đang gắn) và khoá ngoại `users(id)` chạy dưới quyền hệ thống nên
-- cũng cho qua. Đây ĐÚNG dư lượng đã ghi ở 005 §(5) cho `user_roles`.
--
-- 005 §(5) viết rằng đóng nó "cần UNIQUE (org_id, id) trên users, tức sửa 002 — một migration
-- ĐÃ ÁP DỤNG". VẾ SAU CỦA CÂU ĐÓ SAI, và nói ra thay vì lặng lẽ làm khác: thêm một ràng buộc
-- vào một bảng đã tồn tại KHÔNG đòi sửa file 002 — nó là một migration ĐÁNH SỐ MỚI, đúng đường
-- đi mà chính 005 gọi là "đường sửa DUY NHẤT". Byte của 002 không đổi, checksum của nó không
-- đổi. Câu dưới đây làm đúng việc đó.
--
-- VÌ SAO KHÔNG ÁP NGƯỢC CHO `user_roles` TRONG CHÍNH FILE NÀY — một quyết định, không phải bỏ
-- sót: dư lượng của `user_roles` ĐANG ĐƯỢC ĐO bởi một test đối kháng có tên
-- ("[INV-F1] hàng user_roles trỏ tới người của tổ chức KHÁC là vô hiệu",
-- packages/identity/src/rbac.int.test.ts), và test đó khẳng định hàng tấn công CHÈN ĐƯỢC rồi
-- chứng minh nó vô hiệu nhờ vế nối qua `users` trong `hasPermission`. Đóng ràng buộc ở tầng CSDL
-- làm test đó đỏ vì một lý do TỐT, nhưng nó đổi một bảo đảm đã được đo của Task 8 và thuộc phạm
-- vi task đó. Ở đây bài học được áp cho HAI BẢNG MỚI, nơi nó không tốn gì. Khoản nợ `user_roles`
-- vẫn mở và vẫn có mốc đo.
--
-- HAI LỚP, KHÔNG PHẢI MỘT: khoá ngoại tổ hợp dưới đây chặn hàng lệch tổ chức TỒN TẠI; và
-- `assertFreshMfa`/`verifyTotpAttempt` vẫn NỐI QUA `public.users` dưới RLS (đúng khuôn
-- `hasPermission` sau vòng fix 1 của Task 8). Lớp thứ hai không thừa: nó là thứ cưỡng chế
-- `users.status = 'ACTIVE'`, thứ mà không khoá ngoại nào biểu diễn được.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (4/6): app_unseal ĐƯỢC CẤP QUYỀN THEO CỘT, KHÔNG THEO BẢNG
-- ============================================================================================
-- Brief viết `GRANT SELECT ON sessions TO app_unseal` (mức BẢNG) và ngay dòng dưới giải thích
-- "nó chỉ cần biết phiên đã xác thực lúc nào". Câu lệnh RỘNG HƠN PHÁT BIỂU: mức bảng cho
-- app_unseal đọc luôn `token_hash` (băm token phiên), `ip` và `user_agent`. Dự án đã có tiền lệ
-- GRANT mức CỘT ở 002 (`organizations.name`, bốn cột của `users`) và 003/004 (bảng sổ).
-- Dưới đây cấp ĐÚNG sáu cột mà `assertFreshMfa` đọc.
--
-- CẢNH BÁO ĐÃ GHI Ở 002 VÀ VẪN ĐÚNG: quyền CỘT KHÔNG hiện trong
-- `information_schema.role_table_grants`, chỉ hiện ở `role_column_grants`. Khẳng định quyền ở
-- db/rls-coverage.int.test.ts đọc CẢ HAI view.
-- [vòng fix 1 — MỤC 8/M4] VÀ MỘT VẾ NỮA, ghi để Task 10/11 biết canary nào canh cái gì: canary
-- GRANT TOÀN CỤC của db/ (thứ canh "không role nào được cấp quá phần của mình") đọc ở mức
-- BẢNG, nên nó MÙ với mọi quyền CỘT thêm vào ở file này. Sáu cột SELECT mới của `app_unseal`
-- CÓ được đo — nhưng bằng các test nằm trong packages/identity/src/mfa.int.test.ts (đọc
-- `pg_attribute.attacl` qua `aclexplode`), KHÔNG bằng canary toàn cục. Hai lớp, hai phạm vi;
-- ai nới một GRANT cột ở một file sau mà chỉ nhìn canary toàn cục sẽ không thấy gì đỏ.
--
-- KIỂM LẠI VỚI "KHÔNG ROLE NÀO BAO ROLE KIA" (ADR-006) và [NỢ ADR-006]: mọi thứ cấp cho
-- app_unseal ở file này là TẬP CON của quyền app_api (app_api có SELECT mức bảng trên cùng hai
-- bảng, và role_column_grants sinh một dòng SELECT cho MỖI cột). Nên khoản nợ ADR-006 KHÔNG
-- được thoả bởi file này, và test đảo chiều canh nó vẫn đúng — file này không âm thầm làm nó
-- xanh vì lý do sai.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (5/6): app_unseal ĐƯỢC CẤP BA CỘT CỦA `users` — VÀ VÌ SAO ĐÓ KHÔNG PHẢI LÀ
-- LẬT NGƯỢC QUYẾT ĐỊNH CỦA 002
-- ============================================================================================
-- 002 cố ý KHÔNG cấp gì trên `users` cho app_unseal, với lý do viết rõ: "nó không có việc gì với
-- họ tên và email — dữ liệu cá nhân", và kèm lời mời "Task sau thật sự cần thì cấp tường minh
-- kèm lý do, đúng khuôn của 001 với pgcrypto". Đây LÀ task đó, và lý do là bất biến D1: mở thầu
-- đòi MFA còn tươi, phép kiểm ấy phải nối phiên với một NGƯỜI DÙNG ĐANG HOẠT ĐỘNG của đúng tổ
-- chức (xem LỆCH 3/6), và không có `users.status` thì một người bị đình chỉ vẫn mở thầu được
-- bằng một phiên cũ. Ba cột được cấp — `id`, `org_id`, `status` — KHÔNG chứa email hay họ tên,
-- tức tài sản mà 002 bảo vệ vẫn nguyên vẹn.
--
-- ============================================================================================
-- LỆCH KHỎI BRIEF (6/6): HAI CỘT `failed_attempts`/`locked_until` PHẢI CÓ MÃ DÙNG CHÚNG
-- ============================================================================================
-- [vòng fix 1 — MỤC 6] BẢN TRƯỚC VIẾT "Bất biến E3 gồm BA vế: (1) giới hạn số lần thử,
-- (2) dùng một lần, (3) so sánh chống tấn công thời gian." CÂU ĐÓ HẸP HƠN SỔ ĐĂNG KÝ.
-- docs/TEST-PLAN.md:82 định nghĩa E3 bằng NĂM vế, và bản dưới đây bám đúng thứ tự đó:
--   E3(1) giới hạn số lần thử              -> packages/identity/src/mfa-credentials.ts, trên
--                                             `failed_attempts` + `locked_until` của bảng này.
--   E3(2) GIỚI HẠN TẦN SUẤT                -> *** KHÔNG CÓ LỚP NÀO TRONG TOÀN S0 ***. Không ở
--                                             tầng này, không ở tầng ứng dụng. Khoản nợ MỞ
--                                             mang tên một vế bất biến, không phải một lớp bù
--                                             tuỳ chọn.
--   E3(3) hết hạn                          -> cửa sổ trượt của `verifyTotpCode` (totp.ts),
--                                             có trần `MAX_TOTP_WINDOW`.
--   E3(4) dùng một lần                     -> `last_used_counter` của bảng này (vế BỀN VỮNG).
--   E3(5) so sánh chống tấn công thời gian -> totp.ts, và KHÔNG có mốc chết (nói rõ ở đó).
-- Hệ quả của con số sai KHÔNG vô hại: bộ sinh của Task 11 gom test theo mã `[INV-E3]`, nên
-- `evidence/INV-matrix.md` sẽ đọc E3 = ĐÃ PHỦ trong khi một trong năm vế ĐƯỢC ĐẶT TÊN TRONG SỔ
-- ĐĂNG KÝ không có một dòng mã nào — đúng thứ "bằng chứng giả" mà đoạn dưới đây cảnh báo.
--
-- Brief tạo hai cột này và KHÔNG có một dòng mã nào đọc hay ghi chúng, nên vế E3(1) KHÔNG được
-- cài đặt, còn vế E3(4) chỉ tồn tại trong một HÀM THUẦN (`verifyTotpCode`) tức không bền vững
-- qua hai request. Cột không ai dùng là TRANG TRÍ, và trang trí mang thẻ bất biến là BẰNG
-- CHỨNG GIẢ cho evidence pack.
-- `packages/identity/src/mfa-credentials.ts` cài đặt E3(1) và vế bền vững của E3(4) trên chính
-- hai cột này, và các GRANT bên dưới được cắt đúng theo những cột mà mã đó ghi — không hơn.

-- ------------------------------------------------------------------------------------------
-- (1) TIỀN ĐỀ CHO KHOÁ NGOẠI TỔ HỢP.
--
-- `id` đã là PRIMARY KEY của `users` nên `(org_id, id)` đã duy nhất về mặt logic: ràng buộc này
-- KHÔNG thu hẹp tập giá trị hợp lệ và KHÔNG tạo thêm oracle nào. [vòng fix 1 — MỤC 8/M5] Bản
-- trước biện minh bằng "một hàng vi phạm nó đã vi phạm `users_pkey` TRƯỚC" — CÁCH NÓI ĐÓ SAI:
-- PostgreSQL KHÔNG bảo đảm thứ tự kiểm giữa hai chỉ mục duy nhất, nên "trước" không phải một
-- tính chất dựa được. Kết luận thì VẪN ĐÚNG, và lý do đúng không cần tới thứ tự: tập hàng vi
-- phạm `(org_id, id)` là TẬP CON của tập hàng vi phạm `users_pkey` (hai hàng trùng `(org_id,
-- id)` thì trùng luôn `id`), nên ràng buộc này không từ chối được một hàng nào mà `users_pkey`
-- lại nhận — dù chỉ mục nào nổ trước. Không có hàng mới nào bị từ chối thì không có oracle mới.
-- Nó tồn tại vì PostgreSQL đòi một ràng buộc DUY NHẤT khớp đúng bộ cột được tham chiếu trước
-- khi cho tạo khoá ngoại tổ hợp.
-- ------------------------------------------------------------------------------------------
ALTER TABLE users ADD CONSTRAINT users_org_id_id_key UNIQUE (org_id, id);

-- Xem LỆCH KHỎI BRIEF (5/6). Cấp ĐÚNG ba cột, không phải mức bảng.
GRANT SELECT (id, org_id, status) ON users TO app_unseal;

-- ------------------------------------------------------------------------------------------
-- (2) PHIÊN ĐĂNG NHẬP.
--
-- `mfa_verified_at` là mốc để trả lời câu hỏi của bất biến D1 ("MFA còn hiệu lực trong một cửa
-- sổ ngắn"), khác hẳn "đã đăng nhập lúc nào". Mở thầu là hành động không hoàn tác được; người
-- thực hiện phải chứng minh mình đang ngồi trước máy TẠI THỜI ĐIỂM ĐÓ.
--
-- NÓI THẲNG TẦNG CSDL HÔM NAY CHO PHÉP GÌ — cùng khuôn khối [A3b] của 005, vì câu trên ngụ ý
-- một phép kiểm mà tầng này KHÔNG có: app_api được cấp `UPDATE (mfa_verified_at)`, nên MỌI phiên
-- app_api đã gắn tổ chức O đều đánh dấu được một phiên của O là "đã xác thực hai lớp" mà KHÔNG
-- cần một mã TOTP nào. Ở tầng CSDL không có cách nào phân biệt lời đánh dấu ấy với lời đánh dấu
-- sau một lần xác thực thật; lớp cưỡng chế là `verifyTotpAttempt` ở TẦNG ỨNG DỤNG. Đó là một
-- LỰA CHỌN có cùng hình dạng với 005 §(5): thu hẹp nó xuống một hàm SECURITY DEFINER là thứ mục
-- (C) của hardening CẤM, còn bỏ hẳn quyền UPDATE là bỏ luôn đường xác thực.
-- CÁI TẦNG NÀY MUA ĐƯỢC, và nó không tầm thường: `mfa_verified_at` KHÔNG được cấp cho INSERT,
-- nên một phiên không thể RA ĐỜI đã ở trạng thái "đã xác thực" — trạng thái đó chỉ tới bằng một
-- UPDATE riêng, tức một dòng mã phải viết ra thành chữ. Và vế "không được ở TƯƠNG LAI" của phép
-- kiểm độ tươi (packages/identity/src/mfa.ts) đóng đường đặt mốc xa về phía trước để biến một
-- phiên thành "luôn tươi".
--
-- CHỈ MỤC: `UNIQUE (org_id, token_hash)` phục vụ đường tra cứu chính (xem GIAO THỨC TRA CỨU
-- PHIÊN ở trên). `sessions_org_user_idx` KHÔNG phải chỉ mục suy đoán: PostgreSQL KHÔNG tự tạo
-- chỉ mục ở phía THAM CHIẾU của một khoá ngoại, nên không có nó thì mỗi lần xoá một hàng `users`
-- (ON DELETE CASCADE) phải quét toàn bảng `sessions`.
-- ------------------------------------------------------------------------------------------
CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id),
  user_id          uuid NOT NULL,
  token_hash       bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  mfa_verified_at  timestamptz,
  revoked_at       timestamptz,
  ip               inet,
  -- Chặn CẤU TRÚC, không phải lọc nội dung: `user_agent` là chuỗi do CLIENT gửi, và một cột
  -- text không giới hạn nhận chuỗi tuỳ ý dài tới ~1GB. Giới hạn 512 byte đủ cho mọi User-Agent
  -- thật và biến "kho lưu trữ tuỳ ý do người lạ điều khiển" thành một trường nhật ký.
  user_agent       text CHECK (user_agent IS NULL OR octet_length(user_agent) <= 512),
  CHECK (expires_at > created_at),
  -- Xem LỆCH KHỎI BRIEF (2/6): duy nhất THEO TỔ CHỨC, không toàn cục.
  UNIQUE (org_id, token_hash),
  -- Xem LỆCH KHỎI BRIEF (3/6): một khoá ngoại TỔ HỢP thay cho hai khoá ngoại rời.
  FOREIGN KEY (org_id, user_id) REFERENCES users (org_id, id) ON DELETE CASCADE
);

CREATE INDEX sessions_org_user_idx ON sessions (org_id, user_id);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY sessions_tenant_isolation ON sessions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON sessions TO app_api;
-- INSERT theo CỘT. Ba vắng mặt, mỗi cái đóng một đường đi:
--   `id`              -> `sessions_pkey` không dùng làm oracle xuyên tổ chức được (khuôn
--                        `users_pkey` ở 002); DEFAULT gen_random_uuid() lo phần đó.
--   `created_at`      -> dấu thời gian do CSDL đóng; bên ghi chọn được nó là một sổ phiên sắp
--                        xếp lại được theo ý mình (khuôn `occurred_at` ở 003).
--   `mfa_verified_at` -> một phiên KHÔNG được ra đời đã ở trạng thái "đã xác thực hai lớp".
GRANT INSERT (org_id, user_id, token_hash, expires_at, ip, user_agent) ON sessions TO app_api;
-- UPDATE đúng hai cột của vòng đời phiên: đánh dấu vừa xác thực, và thu hồi.
-- `expires_at` cố ý KHÔNG cấp UPDATE: gia hạn phiên trượt không thuộc đường đi nào ở S0, và một
-- quyền không dùng tới là thứ không ai gỡ ra nữa (cùng lý do 002 từ chối INSERT trên
-- organizations). Đăng nhập lại tạo một phiên mới.
GRANT UPDATE (mfa_verified_at, revoked_at) ON sessions TO app_api;
-- Xem LỆCH KHỎI BRIEF (4/6). ĐÚNG sáu cột `assertFreshMfa` đọc; KHÔNG có `token_hash`,
-- KHÔNG có `ip`/`user_agent`, KHÔNG có quyền ghi nào.
GRANT SELECT (id, org_id, user_id, mfa_verified_at, expires_at, revoked_at)
  ON sessions TO app_unseal;

-- ------------------------------------------------------------------------------------------
-- (3) HỒ SƠ XÁC THỰC HAI LỚP.
--
-- `secret_wrapped` + `secret_key_version`: bí mật TOTP được lưu dưới dạng ĐÃ BỌC.
-- [vòng fix 1 — MỤC 8/M3] Bản trước viết câu này ở dạng VÔ ĐIỀU KIỆN ("bí mật TOTP KHÔNG BAO
-- GIỜ nằm ở dạng rõ trong bảng"). Hạ xuống đúng mức, vì tầng CSDL KHÔNG cưỡng chế được nó:
-- ràng buộc duy nhất trên cột là `octet_length(secret_wrapped) > 0`, nên một người ghi có
-- `INSERT` hoàn toàn ghi được 20 byte bí mật rõ vào đây. Và test "lưu KHỐI ĐỤC" ở
-- mfa.int.test.ts đo FIXTURE (cổng AES-GCM của chính test) chứ không đo bất biến này. Phát
-- biểu ĐÚNG: bảng này lưu một khối mà không migration nào và không mã nào trong
-- packages/identity diễn giải được — việc mở là của một cổng (`TotpSecretUnsealer`, xem
-- packages/identity/src/mfa-credentials.ts); "khối đó là ciphertext" là một hợp đồng của NGƯỜI
-- GHI, cưỡng chế ở tầng ứng dụng, không ở đây.
-- BẢN VÁ ĐÃ CÂN NHẮC VÀ TỪ CHỐI, kèm lý do: `CHECK (octet_length(secret_wrapped) >= 28)`
-- (iv 12 + tag 16) rẻ, nhưng nó chặn đúng MỘT ca ngây thơ — một bí mật 20 byte rõ — và KHÔNG
-- chặn ca dễ xảy ra hơn là một chuỗi base32 32 ký tự (32 byte, lọt qua `>= 28`), nên bảo đảm nó
-- mua được gần bằng KHÔNG. Lý do đó đứng MỘT MÌNH và đủ.
-- [vòng fix 2 — MỤC 2] BẢN TRƯỚC CÒN MỘT CHÂN THỨ HAI — "không viết được vào file này, phải là
-- một migration 007 mới" — và CHÂN ĐÓ ĐÃ BỊ GỠ, vì nó MÂU THUẪN với tiền đề mà chính commit này
-- dùng để CHO PHÉP sửa file này (xem task-9-report §7.0: checksum migration nằm trong
-- `schema_migrations` của CSDL chứ không trong repo, VÀ S0 chưa có môi trường nào đã áp dụng
-- 006). Hai câu ấy loại trừ nhau về cùng một file: một cái cho phép một sửa đổi, một cái cấm
-- một sửa đổi. Phát biểu ĐÚNG: cửa sổ sửa `006` HÔM NAY CÒN MỞ — `migrate.ts` băm NỘI DUNG ĐỌC
-- TỪ ĐĨA và so với `schema_migrations`, nên cửa sổ ấy đóng lại đúng từ lần deploy ĐẦU TIÊN, và
-- từ đó trở đi file này rơi vào cùng chế độ "không sửa" như 001–005. KỂ CẢ KHI cửa sổ còn mở,
-- CHECK này vẫn không đáng làm, vì lý do ở trên. Ghi ra để Task 10 không mang niềm tin sai rằng
-- "một migration đánh số thì không sửa được kể cả khi chưa deploy" — đó là một bậc tự do CÓ THẬT.
-- Vào sổ nợ thay vì làm nửa vời: lớp đúng cho trục này là một phép kiểm ở đường GHI DANH khi
-- composition root ra đời.
-- Cột phiên bản cho phép xoay khoá chính mà vẫn mở được bí mật cũ (cùng lập luận với `keyVersion`
-- của `WrappedKey` ở Task 7).
--
-- `last_used_counter` là vế E3(4) (dùng một lần) ở dạng BỀN VỮNG: mỗi mã TOTP chỉ có giá trị
-- đúng một lần, kể cả trong 30 giây nó còn hiệu lực và kể cả khi hai request tới đồng thời.
-- `failed_attempts` + `locked_until` là vế E3(1) (giới hạn số lần thử).
--
-- KHÔNG cấp UPDATE trên `secret_wrapped`/`secret_key_version`, và KHÔNG cấp DELETE. Hệ quả đã
-- cân nhắc và nói thẳng: ở tầng CSDL, một app_api BỊ CHIẾM không thay được bí mật MFA của một
-- người đã đăng ký — nó chỉ đăng ký được cho người CHƯA có (ràng buộc duy nhất bên dưới chặn cái
-- thứ hai). Giá phải trả, cũng nói thẳng: đăng ký lại sau khi mất thiết bị KHÔNG đi qua app_api
-- được; đó là đường VẬN HÀNH, cùng hạng với việc đổi `organizations.slug` ở 002 và việc quản trị
-- vai trò ở 005. Mở nó ra đòi một mã quyền trong danh mục `permissions` và một migration đánh số
-- MỚI — chưa có mã nào như thế, nên hôm nay cổng gác đầu tiên viết ra sẽ TỪ CHỐI TẤT CẢ.
--
-- CHỈ MỤC: `UNIQUE (org_id, user_id, kind)` có `(org_id, user_id)` làm TIỀN TỐ, nên nó phục vụ
-- luôn khoá ngoại tổ hợp và vị từ RLS. Cố ý KHÔNG tạo thêm chỉ mục nào — cùng lập luận đã ghi ở
-- `users` (002) và `user_roles` (005).
-- ------------------------------------------------------------------------------------------
CREATE TABLE mfa_credentials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id),
  user_id            uuid NOT NULL,
  kind               text NOT NULL DEFAULT 'TOTP' CHECK (kind IN ('TOTP')),
  secret_wrapped     bytea NOT NULL CHECK (octet_length(secret_wrapped) > 0),
  secret_key_version text NOT NULL CHECK (octet_length(secret_key_version) > 0),
  last_used_counter  bigint CHECK (last_used_counter IS NULL OR last_used_counter >= 0),
  failed_attempts    integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until       timestamptz,
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Xem LỆCH KHỎI BRIEF (2/6): brief viết `UNIQUE (user_id, kind)` — thiếu `org_id`.
  UNIQUE (org_id, user_id, kind),
  -- Xem LỆCH KHỎI BRIEF (3/6).
  FOREIGN KEY (org_id, user_id) REFERENCES users (org_id, id) ON DELETE CASCADE
);

ALTER TABLE mfa_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY mfa_credentials_tenant_isolation ON mfa_credentials
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON mfa_credentials TO app_api;
-- INSERT theo CỘT: đăng ký một hồ sơ mới. `last_used_counter`/`failed_attempts`/`locked_until`/
-- `confirmed_at` KHÔNG được cấp cho INSERT — một hồ sơ không được RA ĐỜI đã mang sẵn một bộ đếm
-- dùng-một-lần do bên ghi chọn (chọn một giá trị lớn là vô hiệu hoá vế E3(4) vĩnh viễn),
-- cũng không được ra đời đã ở trạng thái "đã xác nhận".
GRANT INSERT (org_id, user_id, kind, secret_wrapped, secret_key_version)
  ON mfa_credentials TO app_api;
-- UPDATE đúng bốn cột mà `verifyTotpAttempt` ghi.
--
-- [vòng fix 1 — MỤC 8/M-1] NÓI THẲNG TẦNG CSDL HÔM NAY CHO PHÉP GÌ — cùng khuôn và CÙNG MỨC
-- CHI TIẾT với khối `mfa_verified_at` ở §(2), vì bản trước chỉ ghi 1 trong 3 cột chịu lực và
-- một dư lượng ghi một phần đọc như một dư lượng đã đóng.
-- Câu lệnh này cho một `app_api` BỊ CHIẾM (kẻ tấn công A1) TẮT CẢ HAI vế E3 mà tầng ứng dụng
-- cưỡng chế, mỗi vế bằng MỘT câu `UPDATE`. Cả hai đã được ĐO trên PostgreSQL 16 dưới đúng hồ
-- sơ vai trò (`app_api`: rolsuper = f, rolbypassrls = f):
--   * `UPDATE mfa_credentials SET locked_until = NULL WHERE ...`
--       -> hồ sơ đang bị khoá trở lại nhận mã: `LOCKED_OUT` biến thành `WRONG_CODE`. E3(1) tắt.
--   * `UPDATE mfa_credentials SET last_used_counter = NULL WHERE ...`
--       -> chơi lại được ĐÚNG mã cũ (lần 1 ok ở bộ đếm X; lần 2 `CODE_ALREADY_USED`; xoá bộ
--          đếm; lần 3 ok LẠI ở bộ đếm X). E3(4) tắt.
-- KHÔNG TRÁNH ĐƯỢC nếu giữ E3 ở tầng ứng dụng: bỏ GRANT là bỏ luôn cơ chế; và thu hẹp nó xuống
-- một hàm SECURITY DEFINER là thứ mục (C) của hardening.always.sql CẤM. Đây là một HẠN CHẾ
-- CHẤP NHẬN ĐƯỢC, cùng hình dạng với ca `mfa_verified_at` ở §(2) và với 005 §(5) — nhưng nó
-- phải được ghi ra để không ai đọc "E3 đã cài" thành "E3 chịu được một app_api bị chiếm".
-- CÁI TẦNG NÀY VẪN MUA ĐƯỢC, và nó không tầm thường: bốn cột này KHÔNG được cấp cho INSERT
-- (xem ngay trên), nên một hồ sơ không thể RA ĐỜI đã mang sẵn bộ đếm hay trạng thái "đã xác
-- nhận"; và `secret_wrapped`/`secret_key_version` KHÔNG có UPDATE, nên bí mật của một người đã
-- đăng ký không thay được.
GRANT UPDATE (last_used_counter, failed_attempts, locked_until, confirmed_at)
  ON mfa_credentials TO app_api;
-- Cố ý KHÔNG cấp gì trên `mfa_credentials` cho app_unseal — kể cả SELECT. Runtime mở thầu không
-- xác thực ai cả; nó chỉ đọc KẾT QUẢ của một lần xác thực, và kết quả đó nằm ở
-- `sessions.mfa_verified_at`. Đây là câu mà brief viết nhưng chưa cưỡng chế: brief cấp app_unseal
-- quyền mức BẢNG trên `sessions`, tức phát biểu này đúng cho `mfa_credentials` mà sai cho
-- `sessions`. Nay cả hai khớp câu lệnh.

-- db/migrations/hardening.always.sql
-- [fix I3] Cưỡng chế cấu hình an ninh của app_api/app_unseal — chạy LẠI ở MỌI lần migrate()
-- được gọi, không qua schema_migrations, không chỉ một lần lúc bootstrap trên 001.
--
-- Vì sao tách khỏi 001_roles_and_functions.sql: mọi bảo đảm ở đó (S1 — không SUPERUSER/
-- BYPASSRLS; I2/I5 — không kế thừa membership dư thừa, không rolconfig IN DATABASE trôi;
-- S2 — PUBLIC không có EXECUTE trên app_current_org_id(), app_api không có USAGE trên
-- app_private) trước đây chỉ đúng TẠI THỜI ĐIỂM 001 chạy lần đầu trên một database. Không
-- gì phát hiện hay tự sửa nếu SAU triển khai có ai đó "ALTER ROLE app_api BYPASSRLS" hay
-- "GRANT EXECUTE ON FUNCTION app_current_org_id() TO PUBLIC" để gỡ lỗi rồi quên gỡ lại —
-- 001 đã ghi trong schema_migrations nên không chạy lại, và trôi cứ thế tồn tại vĩnh viễn
-- cho tới lần soát xét thủ công kế tiếp.
--
-- File này đóng các đường trôi đó: mọi câu lệnh dưới đây là idempotent (an toàn lặp lại vô
-- hạn lần), và bộ chạy migration (packages/db/src/migrate.ts) luôn chạy file có hậu tố
-- ".always.sql" TRƯỚC vòng lặp các migration đánh số, ở MỌI lần gọi.
--
-- ============================================================================
-- KHOAN DUNG VỚI QUYỀN, NGHIÊM KHẮC VỚI TRÔI — và SỬA TRƯỚC, PHÁN XÉT SAU
-- ============================================================================
-- [fix round 4 — N2] Vòng 3 đặt "ALTER ROLE ..." trần ở đây và vô tình biến migrate() thành
-- thao tác ĐÒI SUPERUSER ở MỌI lần gọi — đã tự đo: deploy dưới role CREATEROLE + DB owner
-- cho ra "permission denied to alter role", trong khi trước đó kịch bản ấy THÀNH CÔNG.
--
-- [fix round 5 — R1] Vòng 4 sửa được điều đó nhưng lại làm hỏng một điều khác: nó xen kẽ
-- "sửa" và "phán xét" trong cùng một vòng lặp, nên một trôi TỰ CHỮA ĐƯỢC trở thành KẸT VĨNH
-- VIỄN. Đã đo hai vòng, cùng kịch bản (GRANT nhom_xau TO app_api, nhóm có USAGE trên
-- app_private):
--     vòng 3: migrate -> QUA,  sau: {USAGE:false, membership:false}   <- tự chữa được
--     vòng 4: migrate -> GÃY,  sau: {USAGE:true,  membership:true}    <- kẹt vĩnh viễn
-- Nguyên nhân: khối cưỡng chế chạy TRƯỚC khối gỡ membership, nên hậu điều kiện "app_api
-- không có USAGE trên app_private" bắt được quyền KẾ THỪA QUA NHÓM trước khi nhóm đó kịp bị
-- gỡ; và vì cả file nằm trong MỘT transaction, phần đã gỡ được cũng rollback theo. Thông
-- báo còn bảo người vận hành cần SUPERUSER trong khi họ ĐANG là superuser.
--
-- Khuôn hiện tại tách hẳn hai việc đó thành các BƯỚC TUẦN TỰ, không đan xen:
--   BƯỚC 0: tạo role nếu thiếu.
--   BƯỚC 1: gỡ tư cách thành viên hai chiều — làm TRƯỚC mọi phép kiểm, vì membership là
--           nguồn quyền GIÁN TIẾP mà các phép kiểm phía sau đọc thấy.
--   BƯỚC 2: chạy TOÀN BỘ câu lệnh cưỡng chế. Không kiểm gì, không gãy ở đây. Nuốt riêng
--           lỗi insufficient_privilege (42501) — thiếu quyền không phải lý do dừng khi có
--           thể còn sửa được những mục khác.
--   BƯỚC 3: chỉ tới lúc này mới đọc catalog và kiểm HẬU ĐIỀU KIỆN của mọi mục, GOM hết chỗ
--           sai lại.
--   BƯỚC 4: nếu có mục sai -> RAISE EXCEPTION MỘT LẦN, liệt kê TẤT CẢ, mỗi mục kèm quyền
--           cần có. Không sai mục nào -> đi tiếp, kể cả khi bước 2 bị từ chối quyền (không
--           có gì cần sửa thì không cần quyền để sửa).
--
-- Gom hết lỗi thay vì gãy ở mục đầu tiên là có chủ đích: người trực đêm cần biết TOÀN BỘ
-- những gì đang sai trong một lần chạy, không phải khám phá từng mục qua nhiều lần deploy.
--
-- [fix round 5] Vì sao kiểm hậu điều kiện thay vì chỉ bắt exception: hai loại thất bại đều
-- xảy ra được và hậu điều kiện bao trùm cả hai.
--   (a) Ném lỗi 42501 — đây là ca THỰC TẾ trong file này. Đo dưới đúng role deploy
--       (CREATEROLE + DB owner, không sở hữu hàm/schema): 4 trong 6 câu lệnh cưỡng chế ném
--       42501 (REVOKE/GRANT EXECUTE ON FUNCTION, REVOKE ALL ON SCHEMA app_private,
--       ALTER ROLE ... NOBYPASSRLS), 2 câu chạy được, và KHÔNG có notice/warning nào.
--   (b) Chỉ phát WARNING "no privileges were granted/revoked for ..." rồi trả về thành
--       công. Ca này CÓ tồn tại nhưng đòi tác nhân phải là grantor một phần của chính quyền
--       đó — không phát sinh trong bất kỳ kịch bản nào của file này.
--   Vòng 4 ghi ở đây rằng (b) là ca thường và (a) không xảy ra. Ngược với thứ đo được. Thiết
--   kế không đổi (hậu điều kiện đúng cho cả hai), nhưng lý do thì phải khớp phép đo.
--
-- Rủi ro đã biết của khuôn này: nếu một biểu thức "kiem_tra" viết SAI (lỏng hơn câu lệnh nó
-- canh) thì một trôi thật sẽ bị nuốt. Vì vậy mỗi dòng trong bảng dưới đây có test đối kháng
-- riêng ở db/migrations.int.test.ts dựng đúng trôi đó rồi khẳng định migrate() sửa được.
--
-- [fix round 5 — R2] Quyền cấp cho PUBLIC: has_schema_privilege()/has_function_privilege()
-- TÍNH CẢ quyền đến qua PUBLIC, nhưng "REVOKE ... FROM app_api, app_unseal" KHÔNG đụng tới
-- PUBLIC. Vòng 4 để hở đúng khe đó và tạo ra một ngõ cụt không lối ra: đo thật,
-- "GRANT CREATE ON SCHEMA public TO PUBLIC" làm migrate GÃY NGAY CẢ DƯỚI SUPERUSER, vì
-- không câu lệnh nào trong file thu hồi khỏi PUBLIC nên hậu điều kiện không bao giờ đúng
-- lại được. Đáng lo hơn: đó chính là MẶC ĐỊNH của schema public trên PostgreSQL < 15, nên
-- một dump cũ khôi phục vào là kẹt ngay.
--   Đã chọn: REVOKE nhắm CẢ PUBLIC, không phải nới lỏng phép kiểm.
--   Vì sao: bất biến cần bảo vệ là "app_api KHÔNG tạo được đối tượng trong public" và
--   "app_api KHÔNG với tới được app_private" — một tính chất về quyền HIỆU DỤNG. Nếu loại
--   quyền-qua-PUBLIC ra khỏi hậu điều kiện thì phép kiểm sẽ YẾU HƠN bất biến: một
--   "GRANT CREATE ON SCHEMA public TO PUBLIC" thật sự cho app_api quyền CREATE, và tuyên bố
--   "không thuộc phạm vi" chính là loại lỗ hổng mà cả file này sinh ra để bịt.
--   Tác dụng phụ phải nói rõ: "REVOKE CREATE ON SCHEMA public FROM PUBLIC" ảnh hưởng MỌI
--   role trong database, không riêng hai role của ứng dụng. Chấp nhận có chủ đích — đó đúng
--   là mặc định của PostgreSQL 15 trở lên, nên trên PG16 (phiên bản dự án chạy) câu lệnh này
--   là no-op; nó chỉ có tác dụng thật khi database đến từ một cụm cũ.
--
-- [fix round 5 — R3] Thân hàm app_current_org_id() nay được canh, không chỉ ACL của nó.
-- Vòng 4 chỉ kiểm quyền EXECUTE qua to_regprocedure(), nên một "CREATE OR REPLACE FUNCTION"
-- thay thân hàm đi qua migrate() mà KHÔNG bị phát hiện — đo thật: sau khi thay thân, hàm
-- trả 00000000-0000-4000-8000-000000000001 cho MỌI phiên và migrate() vẫn báo QUA. Hậu quả
-- là vô hiệu hoá IM LẶNG toàn bộ RLS mà Task 4–10 sẽ dựng: mọi policy
-- "USING (org_id = app_current_org_id())" khớp đúng một tổ chức cố định cho tất cả mọi
-- người. Nó cũng xoá luôn "pg_catalog." qualify — chính bản vá S3 chống cướp search_path.
--   Phép kiểm so THÂN HÀM đã chuẩn hoá khoảng trắng với dạng kỳ vọng, KHÔNG dùng danh sách
--   chuỗi con: một danh sách chuỗi con sẽ cho lọt thân hàm bọc thêm COALESCE(..., '...'::uuid)
--   — vẫn chứa đủ mọi chuỗi con mà đã biến fail-closed thành fail-open.
--   Kèm theo: kiểm provolatile='s' (STABLE), prosecdef=false (không SECURITY DEFINER),
--   proconfig IS NULL (không có mệnh đề SET search_path — mệnh đề đó chặn inlining, mất
--   inlining là mất chỉ mục, xem 001), kiểu trả về uuid, 0 tham số, ngôn ngữ sql.
--   Câu lệnh cưỡng chế là chính CREATE OR REPLACE, nên trôi này TỰ CHỮA được thay vì kẹt —
--   và nó cũng phục hồi luôn ca "DROP FUNCTION app_current_org_id()" (đo thật trên vòng 4:
--   migrate QUA, hàm không bao giờ trở lại vì 001 đã nằm trong schema_migrations).
--   ĐÁNH ĐỔI: định nghĩa hàm nay tồn tại ở HAI nơi — file này và 001. Bắt buộc phải giống
--   nhau. Có test "[fix round 5 — R3] định nghĩa app_current_org_id() trong 001 và trong
--   hardening.always.sql khớp nhau" đọc cả hai file và so sánh; lệch là đỏ.
--
-- [fix round 5 — R4] "DROP SCHEMA app_private" nay được phục hồi: dòng cưỡng chế là
-- CREATE SCHEMA IF NOT EXISTS, không phải một tiền điều kiện bỏ qua. Vòng 4 dùng tiền điều
-- kiện "schema tồn tại" nên schema mất là bỏ qua luôn — đo thật: migrate QUA, schema không
-- bao giờ trở lại.
--
-- [CR2-T3] MEMBERSHIP: DANH SÁCH TRẮNG CẶP ĐÓNG, KHÔNG PHẢI "GỠ SẠCH"
-- ============================================================================
-- Vòng 5 gỡ MỌI membership chạm tới app_api/app_unseal ở BƯỚC 1, kể cả membership HỢP LỆ.
-- Đo thật trước khi vá: "api_login -> app_api: truoc=true, migrate=QUA, sau=false".
--
-- Vì sao đó là lỗi CHẶN, không phải khắt khe quá tay: cả 001 lẫn chính file này đều cưỡng chế
-- app_api/app_unseal là NOLOGIN. Nên cách DUY NHẤT để ứng dụng hành động dưới danh nghĩa
-- app_api là một role ĐĂNG NHẬP là thành viên của nó — đúng thứ bị xoá ở MỖI lần migrate().
-- Kiến trúc role mà 001 mô tả không dựng được.
--
-- Cách phân biệt đã chọn: DANH SÁCH TRẮNG CẶP viết thẳng trong SQL (CAP_HOP_LE) — không phải
-- giao ước hậu tố tên. Cân nhắc và loại bỏ phương án "mọi role tên kết thúc bằng _login":
-- nó nhận diện theo thứ mà KẺ TẤN CÔNG ĐẶT ĐƯỢC. Ai tạo được role (CREATEROLE, hoặc một
-- migration lỗi) chỉ cần đặt tên "ke_gian_login" là đi qua hàng rào. Danh sách cặp đóng THU
-- HẸP bậc tự do đó xuống ĐÚNG hai cặp, và sai cặp (app_api_login vào app_unseal) cũng bị gỡ.
--
-- [vòng fix 1 — I6] Vòng trước viết ở đây "danh sách cặp đóng KHÔNG CÓ bậc tự do đó". SAI, và
-- cả hai reviewer đo được là sai. Vì file này CỐ Ý KHÔNG TẠO hai role đăng nhập (xem "CỐ Ý
-- KHÔNG LÀM" bên dưới), hai cái tên được ban phước đang BỎ TRỐNG: ai có CREATEROLE chạy
--     CREATE ROLE app_api_login LOGIN PASSWORD '...' IN ROLE app_api;
-- thì hardening PASS, membership được GIỮ VĨNH VIỄN, và role đó đọc được dữ liệu của mọi tổ
-- chức mà app_api với tới. Bậc tự do bị THU HẸP từ "mọi tên khớp %_login" xuống "đúng hai
-- tên", KHÔNG bị loại bỏ.
-- CỐ Ý KHÔNG thêm phòng thủ cho việc đó, và lý do là một phép đo về mô hình đe doạ chứ không
-- phải sự lười: tiền điều kiện là CREATEROLE, mà tác nhân có CREATEROLE VỐN ĐÃ đặt lại được
-- mật khẩu của app_api_login THẬT. Giành tên không cho thêm quyền nào — không phải leo thang.
-- Thứ phải sửa ở đây là LỜI TUYÊN BỐ, vì .sql của dự án này được dùng làm hồ sơ kiểm toán.
--
-- Ba lớp thu hẹp bổ sung, mỗi lớp đóng một cách nới lỏng cụ thể:
--   (a) VÙNG CANH mở rộng sang chính hai role đăng nhập (ROLE_CANH có bốn tên). Không có nó,
--       "GRANT nhom_bat_ky TO app_api_login" và "GRANT app_api_login TO ke_tan_cong" đều
--       KHÔNG chạm app_api/app_unseal nên không bị quét — mà cả hai đều dẫn quyền của app_api
--       ra ngoài bắc cầu. Đã đo trên bản chưa vá: hai membership đó SỐNG SÓT qua migrate().
--   (b) ADMIN OPTION trên chính cặp hợp lệ bị thu hồi RIÊNG (CAU_ADMIN_LA + BƯỚC 1b), không
--       gỡ cả membership. Có ADMIN OPTION thì app_api_login tự cấp được app_api cho bất kỳ
--       ai — miễn trừ hẹp thành bàn đạp. Dùng "REVOKE ADMIN OPTION FOR" thay vì gỡ trọn:
--       trôi này TỰ CHỮA được mà không làm rớt ứng dụng đang chạy.
--   (c) Hai role đăng nhập, một khi được đưa vào danh sách trắng, trở thành CHỦ THỂ TIN CẬY:
--       ai chiếm được app_api_login có mọi quyền của app_api. Nên thuộc tính của chúng được
--       canh y như app_api/app_unseal (xem các dòng "role đăng nhập" trong bảng dưới).
--       "ALTER ROLE app_api_login BYPASSRLS" vô hiệu hoá toàn bộ RLS của Task 4 trở đi; một
--       danh sách trắng không kèm phép canh này chỉ DỜI lỗ hổng sang một cái tên khác.
--
-- CỐ Ý KHÔNG LÀM: file này KHÔNG tạo app_api_login/app_unseal_login (khác với app_api/
-- app_unseal ở BƯỚC 0). Role đăng nhập cần MẬT KHẨU; sinh mật khẩu trong migration nghĩa là
-- hoặc hardcode một giá trị ai đọc repo cũng biết, hoặc ghi bí mật vào log migration. Cả hai
-- đều vi phạm ràng buộc "không bao giờ ghi log bí mật". Người vận hành tạo chúng, file này
-- chỉ canh. Hệ quả phải nói rõ: mọi dòng "role đăng nhập" dưới đây có TIỀN ĐIỀU KIỆN
-- "role tồn tại" — cụm chưa tạo role đăng nhập thì không có gì được canh, và đó là đúng.
--
-- [fix round 5 — Minor] pg_db_role_setting còn hàng với setrole = 0, tức
-- "ALTER DATABASE d SET ..." áp cho MỌI role. Vòng 4 join r.rolname IN ('app_api',...) nên
-- bỏ sót hoàn toàn — đo thật: migrate QUA, setconfig còn ["row_security=off"]. Nay reset
-- riêng hai GUC nhạy cảm ở mức database. Cố ý KHÔNG dùng "ALTER DATABASE d RESET ALL":
-- người vận hành có quyền đặt các GUC hợp lệ khác ở mức database (timezone, statement_timeout
-- ...) và xoá sạch chúng ở mỗi lần deploy là một tác dụng phụ không ai yêu cầu. Giới hạn đã
-- biết và có chủ đích: các GUC nhạy cảm KHÁC ở mức database vẫn không được canh — xem mục
-- đường trôi còn lại trong task-3-report.md.

-- [vòng fix 1 — I3] BA LƯỢT: SỬA · (migration đánh số) · SỬA · PHÁN XÉT
-- ============================================================================
-- Vòng trước để file này chạy MỘT lần, TRƯỚC vòng migration đánh số. Ba triệu chứng đo được,
-- tất cả đều là biến thể của cùng một cái bẫy mà Task 3 đã mắc hai lần:
--   (1) mục (B) KHÔNG BAO GIỜ kiểm chính migration đang được đưa vào — nó chỉ thấy trạng thái
--       TRƯỚC khi 00N chạy, nên một policy hỏng chỉ bị bắt ở lần deploy SAU, khi file đã nằm
--       trong schema_migrations và không chạy lại được nữa;
--   (2) vì (B) chạy TRƯỚC, không thể vá bằng một migration mới: migrate() gãy trước khi tới
--       được 004, nên người vận hành buộc phải sửa tay trên cụm — ĐÚNG cái ngõ cụt mà
--       [fix round 5 — R2] đã phải gỡ một lần rồi;
--   (3) một lược đồ ĐÚNG KHUÔN PostgreSQL (bảng phân mảnh, RLS + policy đặt trên bảng CHA)
--       làm hardening gãy MỌI LẦN, kèm hướng dẫn sai.
--
-- Nay bộ chạy migration (packages/db/src/migrate.ts) gọi file này BA lượt trong một lần
-- migrate(), phân biệt bằng GUC "app.hardening_che_do":
--     lượt 1  che_do='sua'      TRƯỚC vòng migration đánh số — chỉ SỬA, không phán xét gì.
--                               Bắt buộc phải có: 001 GRANT cho app_api/app_unseal nên hai
--                               role đó phải tồn tại trước khi 001 chạy.
--     (vòng migration đánh số chạy ở giữa — 00N nào cũng tới được, kể cả migration vá lỗi)
--     lượt 2  che_do='sua'      SAU vòng đó — sửa nốt những gì migration mới vừa tạo ra
--                               (vd. bật RLS trên bảng vừa sinh), COMMIT riêng.
--     lượt 3  che_do='phan_xet' CHỈ đọc catalog và phán xét, transaction RIÊNG. Một phán xét
--                               hỏng ROLLBACK đúng transaction rỗng của chính nó, không kéo
--                               theo bất kỳ sửa chữa nào của lượt 1/lượt 2.
--
-- Đường thoát khi (B) bắt được lỗi thật, nói rõ để không ai phải đoán: vì lượt 1 KHÔNG phán
-- xét, migrate() luôn chạy được hết vòng migration đánh số. Người vận hành viết một migration
-- mới (vd. 004_sua_policy.sql) rồi deploy — không cần đụng tay vào cụm. Nếu chỗ sai nằm ở
-- danh sách hình dạng được duyệt (bên dưới) thì sửa CHÍNH FILE NÀY: nó là ".always.sql", chạy
-- lại ở mọi lần migrate(), nên bản sửa có hiệu lực ngay ở lần deploy kế tiếp.
--
-- ĐÃ CÂN NHẮC VÀ LOẠI BỎ: "chế độ cảnh báo cho bảng chưa có trong schema_migrations". Với
-- khuôn ba lượt, mọi bảng do migration vừa chạy tạo ra ĐỀU đã nằm trong schema_migrations khi
-- lượt 3 đọc catalog — nên tiêu chí đó sẽ không bao giờ khớp, và nếu nới nó ra thì đúng cái
-- bảng đáng phán xét nhất (bảng vừa được đưa vào ngay lần chạy này) lại là bảng được tha.
-- Khả năng vá bằng migration mới đã do lượt 1 bảo đảm, không cần hạ mức phát hiện để mua nó.

-- [S7b/S11-T3] TRÔI Ở TẦNG RLS — HAI MỤC CUỐI TRONG BẢNG
-- ============================================================================
-- Task 4 dựng bảng đầu tiên có RLS, và cùng lúc mở ra một lớp trôi mới mà mọi bản vá trước
-- KHÔNG chạm tới: policy và cờ RLS nằm trong migration ĐÁNH SỐ (002), nên chúng chỉ chạy MỘT
-- LẦN. Sau triển khai:
--     ALTER TABLE users DISABLE ROW LEVEL SECURITY;   -> đọc xuyên tổ chức, im lặng, VĨNH VIỄN
--     ALTER TABLE users NO FORCE ROW LEVEL SECURITY;  -> chủ sở hữu bảng đọc xuyên tổ chức
--     ALTER POLICY users_tenant_isolation ... USING (true);  -> RLS còn bật mà không chặn gì
--     DROP FUNCTION app_current_org_id() CASCADE;     -> kéo theo TOÀN BỘ policy
-- 002 đã nằm trong schema_migrations nên không có gì trở lại. Đã đo thật ca cuối trên
-- PostgreSQL 16.15: DROP thường bị Postgres TỪ CHỐI ("policy ... depends on function") — một
-- lớp bảo vệ miễn phí có được nhờ chính sự phụ thuộc — nhưng CASCADE thì đi lọt và để lại
-- relrowsecurity=t, relforcerowsecurity=t, số policy = 0.
--
-- Hai mục cuối bảng đóng lớp này, và cố ý dùng HAI CƠ CHẾ KHÁC NHAU:
--
--   (A) CỜ RLS — TỰ CHỮA, TỔNG QUÁT. Không cần biết bảng nào: quét pg_attribute tìm mọi bảng
--       có cột org_id (cộng danh sách bảng GỐC của cây tenant, vốn không có cột đó vì chính id
--       của chúng là tổ chức) rồi ENABLE + FORCE lại.
--       [vòng fix 1 — CR2/I6] Vòng trước viết ở đây "bảng của MỌI task sau được phủ tự động,
--       không ai phải nhớ thêm dòng nào". SAI, và đã đo: vị từ khoá relkind = 'r', nên BẢNG
--       CHA PHÂN MẢNH (relkind = 'p') VÔ HÌNH với cả (A), (B) lẫn test phủ. Nay là
--       relkind IN ('r','p'). Vẫn CÓ bậc tự do còn lại, nói ra thay vì hứa suông: bảng NGOÀI
--       (relkind='f'), và bảng tenant đặt ở schema KHÁC 'public'. Cả hai không bị phủ.
--       [vòng fix 2 — I6] BẬC TỰ DO THỨ BA, và là bậc tự do về THỜI GIAN chứ không về hình
--       dạng: mục (A) đúng TẠI THỜI ĐIỂM migrate() chạy. Một "ALTER TABLE bao_gia ATTACH
--       PARTITION bao_gia_b ..." chạy SAU đó gắn vào một lá KHÔNG bật RLS, và đã đo:
--         hardening=PASS | bao_gia(rls=t,fr=t,np=1) bao_gia_a(rls=t,fr=t) bao_gia_b(rls=f,fr=f)
--         gắn A: qua CHA=[100] | đọc THẲNG bao_gia_b=[999]   <- giá của tổ chức B
--       Xoay vòng phân mảnh thường do JOB VẬN HÀNH làm, không do migration, nên cửa sổ phơi
--       kéo tới lần deploy kế tiếp.
--       ĐÃ CÂN NHẮC VÀ LOẠI BỎ event trigger (ddl_command_end trên ALTER TABLE) để bật RLS
--       ngay lúc ATTACH: CREATE EVENT TRIGGER đòi SUPERUSER, mà kịch bản deploy thật của dự án
--       (role trien_khai — CREATEROLE + chủ sở hữu database, KHÔNG superuser) không có. Thêm
--       nó kèm hậu điều kiện sẽ CHẶN DEPLOY VĨNH VIỄN đúng trên môi trường production — đúng
--       cái bẫy "fail-closed biến trôi tự lành thành deploy chặn vĩnh viễn" mà file này đã phải
--       gỡ hai lần. Thêm nó KHÔNG kèm hậu điều kiện thì nó là một lời hứa không ai kiểm.
--       NÊN NÓI THẲNG: trục này CHỈ PHÁT HIỆN ĐƯỢC (và tự chữa được) Ở LẦN DEPLOY KẾ TIẾP,
--       không đóng được ở tầng lược đồ. Tính chất tự chữa đó CÓ test đo:
--       "[I6] ATTACH PARTITION sau migrate()..." ở db/migrations.int.test.ts.
--
--   (B) HÌNH DẠNG POLICY — CHỈ PHÁT HIỆN, KHÔNG TỰ CHỮA. Không tự chữa được vì không có nguồn
--       nào trong file này biết policy ĐÚNG phải viết ra sao; nhân bản định nghĩa policy sang
--       đây (như đã làm với thân hàm app_current_org_id() ở R3) sẽ nhân đôi một thứ dài hơn
--       nhiều và phải sửa hai nơi ở MỌI task tạo bảng mới — một đánh đổi tệ hơn hẳn.
--
--       [vòng fix 1 — CR1] ĐẢO CHIỀU: DANH SÁCH ĐEN -> DANH SÁCH TRẮNG.
--       Bản trước đòi biểu thức chỉ hai điều: có NHẮC TỚI app_current_org_id(), và không chứa
--       chuỗi "IS NULL"/"coalesce". Nó KHÔNG đòi biểu thức RÀNG BUỘC gì cả. Bốn payload đo
--       được đi lọt hoàn toàn im lặng (HARDENING_EXIT=0), hai reviewer độc lập tìm ra bằng
--       payload khác nhau:
--         USING (org_id = app_current_org_id() OR true)
--         USING (org_id = app_current_org_id() OR NOT (app_current_org_id() IS DISTINCT FROM NULL))
--         USING (CASE WHEN app_current_org_id()::text > '' THEN org_id = app_current_org_id() ELSE true END)
--         USING (app_current_org_id() = app_current_org_id() OR org_id = app_current_org_id())
--       Chẩn đoán, đo được và quan trọng: vấn đề KHÔNG phải "regex trên chuỗi thì yếu".
--       pg_get_expr CHUẨN HOÁ lại cây phân tích, nên "IS NOT DISTINCT FROM NULL" bị deparse
--       thành "IS NULL" và BỊ BẮT, "USING (true)" cũng BỊ BẮT. Vấn đề là LIỆT KÊ CÁI XẤU.
--       Đây là lần thứ năm trong dự án một hàng rào kiểu đó bị vượt; hàng rào G1 ở Task 7 chỉ
--       hết tái phát khi đảo sang MẶC ĐỊNH-ĐÓNG + CỬA TƯỜNG MINH. Làm đúng như vậy ở đây.
--
--       Nay biểu thức đã deparse của mọi policy PERMISSIVE phải NẰM TRONG một trong hai danh
--       sách (HINH_DANG_CHUAN toàn cục, hoặc NGOAI_LE_HINH_DANG của đúng bảng+policy đó) —
--       mọi thứ khác là sai, không cần biết nó viết ra sao.
--       Đã đo tính ổn định của pg_get_expr trước khi dựa vào nó, trên PostgreSQL 16.15: năm
--       cách viết khác nhau của CÙNG một cây phân tích
--         (org_id = app_current_org_id()) · thêm khoảng trắng · thêm ngoặc ·
--         public.app_current_org_id() · t.org_id = ...
--       đều deparse ra ĐÚNG MỘT chuỗi "(org_id = app_current_org_id())". Cây phân tích KHÁC
--       thì deparse khác ("(app_current_org_id() = org_id)" — hoán vị hai vế — không khớp, và
--       đó là hành vi ĐÚNG: danh sách trắng không suy diễn ngữ nghĩa).
--       MỘT PHỤ THUỘC ĐÃ ĐO: deparse phụ thuộc search_path CỦA PHIÊN ĐANG ĐỌC.
--       [vòng fix 2 — CR1] Vòng 1 xử lý phụ thuộc đó bằng cách NỚI danh sách trắng ra để chứa
--       cả dạng trần lẫn dạng 'public.'-đủ-tên. ĐÓ CHÍNH LÀ CƠ CHẾ CỦA LỖ HỔNG VÒNG 2 (rò
--       xuyên tổ chức thật — xem khối "GHIM search_path" trong thân DO). Nay search_path của
--       phiên phán xét được GHIM, và danh sách thu về ĐÚNG MỘT dạng mỗi pham_vi.
--       Quy tắc rút ra, áp cho cả file: GHIM cấu hình mà bảo đảm phụ thuộc vào, đừng NỚI bảo
--       đảm ra để chấp nhận mọi giá trị của cấu hình đó.
--
--       CỬA TƯỜNG MINH: task 5-10 sẽ cần hình dạng khác (policy kiểm thêm trạng thái, policy
--       FOR SELECT riêng cho app_unseal). Đường đi là THÊM MỘT DÒNG vào NGOAI_LE_HINH_DANG,
--       và dòng đó ghi rõ BẢNG NÀO, POLICY NÀO.
--       [vòng fix 2 — CR2] Vòng 1 để cửa đó khoá theo (pham_vi, bieu_thuc) — tức TOÀN CỤC. Đã
--       đo: mở "USING (true)" cho policy riêng của app_unseal trên MỘT bảng thì "USING (true)"
--       trên CHÍNH bảng users cũng lọt. Cách hợp lệ để dùng hệ thống chính là cách làm nó yếu
--       đi trên toàn cục — đó là lỗi thiết kế, không phải sự bất tiện. Nay cửa khoá theo
--       (bang, polname, pham_vi, bieu_thuc): mỗi ngoại lệ chỉ có hiệu lực ĐÚNG NƠI được cấp.
--       Cả hai danh sách có meta-test khoá (db/rls-coverage.int.test.ts) nên mở một hình dạng
--       mới bắt buộc phải sửa CẢ file SQL này LẪN test. Đúng khuôn hàng rào G1 của Task 7.
--
--       [vòng fix 1 — I6] Vòng trước viết "hai DẠNG fail-open bị cấm". Sai chữ: nó cấm được
--       hai CÁCH VIẾT. Danh sách trắng mới thì cấm mọi thứ ngoài danh sách, nên phát biểu nay
--       đúng phạm vi — nhưng phạm vi ấy là "hình dạng biểu thức của policy PERMISSIVE trên
--       bảng tenant trong public", KHÔNG phải "ngữ nghĩa" và KHÔNG phải mọi policy: policy
--       AS RESTRICTIVE cố ý KHÔNG bị soi hình dạng (xem CAU_POLICY_SAI để biết lập luận).
--
--       ĐÁNH ĐỔI PHẢI NÓI RÕ: vì không tự chữa, một policy bị DROP hay bị ALTER hỏng sẽ chặn
--       deploy. Nhờ khuôn ba lượt ở trên, đường sửa là một migration mới hoặc một dòng thêm
--       vào file này rồi deploy lại — KHÔNG phải sửa tay trên cụm.
--
--   (C) [vòng fix 1 — I2] BA ĐƯỜNG ĐỌC VÒNG QUA RLS: VIEW · MATERIALIZED VIEW · SECURITY
--       DEFINER — ở MỌI schema do dự án tạo, không riêng 'public'/'app_private'.
--       [vòng fix 2 — I6] Phát biểu này ở vòng 1 KHÔNG nêu giới hạn schema trong khi bản cài
--       đặt CÓ giới hạn ('public' cho view/matview, 'public'+'app_private' cho prosecdef) —
--       một lời khai quá phạm vi trong hồ sơ kiểm toán, và re-reviewer đo được rò rỉ thật qua
--       đúng khe đó. Nay bản cài đặt quét mọi schema trừ pg_catalog/information_schema/
--       pg_toast*/pg_temp*, nên phát biểu và phép đo khớp nhau. Bậc tự do CÒN LẠI: đối tượng
--       thuộc EXTENSION được loại trừ, và bảng NGOÀI (relkind='f') không bao giờ là bảng
--       tenant nên một view đọc bảng ngoài chỉ bị bắt qua đường cột org_id.
--       Không lớp nào trước đây canh relkind IN ('v','m') hay prosecdef. Đo với chủ
--       sở hữu superuser — ĐÚNG kịch bản CI của chính repo này, vì migrate() chạy bằng
--       superuser — trên PostgreSQL 16.15:
--         bảng gốc users              | 1 hàng  <- RLS đúng
--         VIEW + GRANT SELECT         | 2 hàng  <- PG15+ mặc định security_invoker = false
--         MATERIALIZED VIEW           | 2 hàng  <- matview KHÔNG chịu RLS bao giờ
--         hàm SECURITY DEFINER        | 2 hàng
--       và hardening cũ EXIT=0, im lặng tuyệt đối.
--       CỬA cho VIEW: "WITH (security_invoker = true)". Đã đo là ĐỦ: sau khi bật, cùng view đó
--       trả về 1 hàng cho app_api_login đã gắn tổ chức. CỐ Ý KHÔNG kèm điều kiện "chủ sở hữu
--       không phải superuser" như bản kê ban đầu: với security_invoker = true, RLS được kiểm
--       theo NGƯỜI GỌI nên chủ sở hữu không còn ý nghĩa; thêm điều kiện đó chỉ làm mọi view
--       hợp lệ trên cụm dev/CI (chủ sở hữu LÀ superuser ở đó) đỏ vĩnh viễn — mua thêm số không
--       và trả bằng một hàng rào chặn deploy.
--       CỬA cho MATVIEW và cho hàm SECURITY DEFINER: không có cửa kỹ thuật nào (matview không
--       có RLS, SECURITY DEFINER là leo quyền theo định nghĩa), nên cửa là DANH SÁCH NGOẠI LỆ
--       viết tay NGOAI_LE_DOC_VONG — hiện RỖNG. Thêm một tên vào đó là một quyết định phải
--       nhìn thấy, y như NGOAI_LE_HINH_DANG. Tên viết ĐỦ SCHEMA nên nó đã sẵn sàng cho việc
--       bỏ giới hạn schema ở vòng fix 2.
--       Hàm thuộc EXTENSION (pg_depend deptype='e') được loại trừ: chúng không do dự án viết
--       và danh sách ngoại lệ không nên phình theo extension. Đã đo trên PG16.15: pgcrypto
--       KHÔNG cài hàm prosecdef nào vào public, nên loại trừ này hiện chưa che giấu gì.

DO $khoi$
DECLARE
  -- [vòng fix 1 — I3] Chế độ chạy. Xem khối "BA LƯỢT" ở đầu file.
  --   'sua'      : chỉ BƯỚC 0/1/1b/2 (tạo role, gỡ membership lạ, chạy câu lệnh cưỡng chế).
  --   'phan_xet' : chỉ BƯỚC 3/4 (đọc catalog, gom lỗi, gãy một lần).
  --   'day_du'   : cả hai — mặc định khi GUC không được đặt, để chạy file này bằng tay
  --                (psql -f) vẫn giữ đúng ngữ nghĩa cũ.
  che_do constant text :=
    coalesce(nullif(pg_catalog.current_setting('app.hardening_che_do', true), ''), 'day_du');

  -- Vị từ "bảng này chịu ràng buộc tenant". Viết dưới dạng KHUÔN có tham số bí danh vì nó
  -- được nhúng vào các truy vấn dùng bí danh khác nhau (bảng cha phân mảnh, bảng gốc của
  -- view). %1$s = bí danh pg_namespace, %2$s = bí danh pg_class.
  -- Danh sách bảng GỐC cố ý viết tay và ĐÓNG: một bảng gốc mới là quyết định phải nhìn thấy.
  -- Danh sách này NHÂN BẢN sang db/rls-coverage.int.test.ts và db/migration-shape.test.ts;
  -- có test đọc cả ba file và so sánh (cùng khuôn §R3 đã dùng cho thân app_current_org_id()).
  --
  -- [vòng fix 1 — CR2] relkind IN ('r','p'), KHÔNG chỉ 'r'. Bảng CHA phân mảnh là 'p' và vòng
  -- trước hoàn toàn không thấy nó. Đo được trên PostgreSQL 16.15, đúng khuôn mà bảng báo giá
  -- của task sau gần như chắc chắn sẽ dùng (phân mảnh theo org_id):
  --   * policy đặt trên LÁ, không có gì trên CHA -> app_api gắn tổ chức A đọc QUA CHA thấy cả
  --     giá của tổ chức B (policy của lá KHÔNG được áp khi truy vấn đi qua cha);
  --   * policy đặt trên CHA đúng khuôn PostgreSQL, lá không bật RLS -> app_api gắn tổ chức A
  --     đọc THẲNG lá của tổ chức B thấy giá 999 của B. Đây là phát hiện MỚI của vòng này:
  --     "viết đúng khuôn PostgreSQL" vẫn hở, vì lá là một bảng có tên gọi được.
  -- Cả hai đều đóng bằng cùng một hành động của mục (A): ENABLE + FORCE trên CHA và trên MỌI
  -- LÁ. Đã đo hậu quả để chắc nó không phá gì: lá bật RLS mà không có policy riêng cho ra
  -- 0 hàng khi đọc THẲNG lá (fail-closed) trong khi đọc QUA CHA vẫn trả đúng 1 hàng của tổ
  -- chức đang gắn. ALTER TABLE ... ENABLE/FORCE áp được thẳng lên bảng cha (relkind=p).
  MAU_VI_TU_BANG_TENANT constant text :=
    $q$%1$s.nspname = 'public' AND %2$s.relkind IN ('r', 'p')
       AND (EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = %2$s.oid AND a.attname = 'org_id'
                       AND a.attnum > 0 AND NOT a.attisdropped)
            OR %2$s.relname IN ('organizations'))$q$;
  VI_TU_BANG_TENANT constant text := pg_catalog.format(MAU_VI_TU_BANG_TENANT, 'n', 'c');

  -- ---- [vòng fix 1 — CR1 / vòng fix 2 — CR1+CR2+I4] HAI DANH SÁCH, KHÔNG PHẢI MỘT -----
  -- Mọi biểu thức USING/WITH CHECK của mọi policy PERMISSIVE trên bảng tenant phải khớp
  -- NGUYÊN VĂN một dòng ở MỘT trong hai danh sách dưới đây (so sánh sau khi pg_get_expr đã
  -- chuẩn hoá — xem giải thích (B) ở đầu file).
  --
  -- (1) HINH_DANG_CHUAN — KHUÔN CỦA DỰ ÁN, có hiệu lực TOÀN CỤC.
  --   pham_vi = 'co_org_id' : bảng có cột org_id.
  --   pham_vi = 'bang_goc'  : bảng gốc của cây tenant (chính id của nó LÀ tổ chức).
  --   Chỉ hai dòng, và đó là điều kiện để danh sách này AN TOÀN khi áp toàn cục: mỗi dòng
  --   RÀNG BUỘC hàng về đúng tổ chức đang gắn, nên nới nó ra mọi bảng không cho thêm quyền
  --   đọc nào. Không thêm dòng nào khác vào đây trừ khi nó cũng có tính chất ấy.
  --
  --   [vòng fix 2 — CR1] Vòng 1 có BỐN dòng: mỗi hình dạng hai biến thể (trần và
  --   'public.'-đủ-tên) để hứng việc deparse phụ thuộc search_path. Hai dòng 'public.' nay bị
  --   XOÁ, vì search_path của phiên phán xét đã được GHIM (xem khối ở đầu thân DO). Đó là
  --   NGUYÊN NHÂN chứ không phải triệu chứng: chừng nào dạng TRẦN còn được duyệt VÔ ĐIỀU KIỆN
  --   dưới một search_path mà kẻ khác chọn, một hàm app_current_org_id() ở schema khác cũng
  --   deparse ra dạng trần. Đo được (xem khối CR1 trong thân DO): rò xuyên tổ chức thật.
  --   [vòng fix 2 — I5] Hai dòng bị xoá KHÔNG có test nào phủ — xoá cả hai vẫn 86/86. Nay có
  --   test "danh sách trắng đúng bằng tập hình dạng ĐANG được dùng" ở db/rls-coverage.int.
  --   test.ts, nên mọi dòng ở đây là load-bearing và một dòng thừa là ĐỎ.
  HINH_DANG_CHUAN constant text :=
    $q$(VALUES
         ('co_org_id', '(org_id = app_current_org_id())'),
         ('bang_goc',  '(id = app_current_org_id())')
       ) AS h(pham_vi, bieu_thuc)$q$;

  -- (2) NGOAI_LE_HINH_DANG — CỬA THEO ĐỐI TƯỢNG. RỖNG là trạng thái đúng ở S0.
  --   [vòng fix 2 — CR2] Vòng 1 chỉ có MỘT danh sách khoá theo (pham_vi, bieu_thuc), tức là
  --   TOÀN CỤC. Đã đo: mô phỏng đúng việc Task 6 sẽ phải làm — thêm một dòng cho policy riêng
  --   của app_unseal — rồi "USING (true)" trên CHÍNH bảng users cũng LỌT (hardening PASS, đọc
  --   được cả hai tổ chức). Mở một hình dạng cho MỘT bảng pre-approve nó cho MỌI bảng tenant
  --   hiện tại và tương lai. Cửa thoát mà càng dùng đúng thì hàng rào càng thủng không phải
  --   cửa thoát, là lỗ. Nay khoá theo (bang, polname, pham_vi, bieu_thuc): một ngoại lệ chỉ
  --   có hiệu lực ĐÚNG NƠI nó được cấp.
  --
  --   [vòng fix 2 — I4] Bốn hình dạng mà re-reviewer đo là "sản phẩm sẽ cần" đi qua ĐÂY, không
  --   qua HINH_DANG_CHUAN — đây là câu trả lời cho "hình dạng nào nên nằm sẵn trong danh sách
  --   gốc": chỉ hình dạng TỰ NÓ ràng buộc tenant mới được toàn cục.
  --     org_id = app_current_org_id() AND trang_thai <> 'NIEM_PHONG'  (đấu thầu kín)
  --       -> deparse: ((org_id = app_current_org_id()) AND (trang_thai <> 'NIEM_PHONG'::text))
  --     policy riêng FOR SELECT TO app_unseal USING (true)  -> deparse: true
  --     org_id kiểu DOMAIN trên uuid                        -> deparse: ((org_id)::uuid = ...)
  --   Cố ý KHÔNG khớp theo KHUÔN ("bắt đầu bằng hình dạng chuẩn rồi AND ..."): khớp khuôn là
  --   một phép so khớp chuỗi có cấu trúc, và bốn vòng liên tiếp trong dự án này cho thấy đó
  --   đúng là chỗ thứ tiếp theo lọt qua. Một dòng đủ-đối-tượng trong diff rẻ hơn nhiều.
  --   HÌNH DẠNG THỨ TƯ — policy AS RESTRICTIVE — KHÔNG cần dòng nào: xem CAU_POLICY_SAI.
  --
  --   Cả hai danh sách có meta-test khoá ở db/rls-coverage.int.test.ts — sửa một bên mà quên
  --   bên kia là ĐỎ.
  NGOAI_LE_HINH_DANG constant text :=
    $q$(VALUES ('', '', '', '')) AS g(bang, polname, pham_vi, bieu_thuc)$q$;

  -- [vòng fix 1 — I2] Ngoại lệ viết tay cho hai thứ KHÔNG có cửa kỹ thuật: MATERIALIZED VIEW
  -- chạm dữ liệu tenant, và hàm SECURITY DEFINER trong public/app_private. Tên viết đủ schema
  -- ('public.ten_doi_tuong'). RỖNG là trạng thái đúng ở S0 — mỗi dòng thêm vào phải kèm lý do.
  NGOAI_LE_DOC_VONG constant text := $q$(VALUES ('')) AS x(ten)$q$;

  -- Vị từ "bảng này là CON của một bảng tenant" — lá phân mảnh HOẶC con cháu INHERITS. Con
  -- thừa hưởng policy của cha khi truy vấn đi qua cha, và PostgreSQL KHÔNG cho tạo policy riêng
  -- theo kiểu thừa kế — nên đòi
  -- con phải có policy của chính nó là đòi một thứ khuôn PostgreSQL không sinh ra. Vòng trước
  -- không có vế này nên một lược đồ phân mảnh viết ĐÚNG KHUÔN làm hardening gãy MỌI LẦN.
  -- Vẫn an toàn: mục (A) bật RLS trên lá, và lá bật RLS không policy = từ chối tất cả khi đọc
  -- THẲNG lá (đã đo: 0 hàng), trong khi đường đọc thật (qua cha) vẫn đúng.
  -- Điều kiện "cha CŨNG là bảng tenant trong public" là có chủ đích: không có nó thì một lá
  -- trong public treo dưới một cha ở schema khác sẽ được tha mà chẳng ai kiểm cha.
  --
  -- [vòng fix 2 — Minor] BỎ "c.relispartition": vế này nay phủ CẢ CON CHÁU "INHERITS" cổ điển,
  -- không riêng lá phân mảnh. Vòng 1 đòi relispartition, nên một "CREATE TABLE con () INHERITS
  -- (bang_tenant)" làm hardening GÃY MỌI LẦN — đúng triệu chứng (3) của I3 mà vòng 1 vừa sửa
  -- cho phân mảnh, lặp lại ở nhánh kế thừa.
  -- Đã đo trên PostgreSQL 16.15 rằng miễn trừ này AN TOÀN, và đo cả hai đường đọc:
  --   * đọc QUA CHA dưới app_api gắn tổ chức A -> chỉ thấy hàng của A (100), KHÔNG thấy hàng
  --     999 mà con đang giữ. Policy của CHA có hiệu lực với hàng của con khi đi qua cha —
  --     khác hẳn ca phân mảnh trước khi vá, và là lý do không cần policy riêng cho con.
  --   * đọc THẲNG con sau khi mục (A) bật ENABLE + FORCE: 0 hàng (fail-closed).
  -- Trạng thái KHÔNG được miễn, và đó là đúng: một bảng đã DETACH PARTITION không còn hàng nào
  -- trong pg_inherits nên nó trở lại là bảng tenant độc lập và PHẢI có policy của chính nó.
  -- Đường sửa là một migration mới (lượt 1 không phán xét nên nó luôn tới được đích) —
  -- có test đo: "[Minor] DETACH PARTITION..." ở db/migrations.int.test.ts.
  LA_CUA_BANG_TENANT constant text :=
    $q$EXISTS (
         SELECT 1 FROM pg_inherits ke
           JOIN pg_class pc ON pc.oid = ke.inhparent
           JOIN pg_namespace pn ON pn.oid = pc.relnamespace
          WHERE ke.inhrelid = c.oid AND $q$
       || pg_catalog.format(MAU_VI_TU_BANG_TENANT, 'pn', 'pc') || $q$)$q$;

  -- Mọi chỗ SAI KHUÔN về policy trên bảng tenant, mỗi hàng một mô tả đọc được. Hai nguồn:
  --   (i)  bảng tenant KHÔNG có policy PERMISSIVE nào — RLS bật mà không policy nào cho phép
  --        gì là "từ chối tất cả": fail-closed, an toàn về dữ liệu nhưng là sự cố sẵn sàng, và
  --        thường là dấu vết của một DROP POLICY (hoặc DROP FUNCTION ... CASCADE) sau triển khai.
  --        Lá phân mảnh được miễn — xem LA_CUA_BANG_TENANT ở trên.
  --   (ii) policy PERMISSIVE có mặt nhưng biểu thức KHÔNG nằm trong HINH_DANG_CHUAN lẫn
  --        NGOAI_LE_HINH_DANG của ĐÚNG (bảng, policy) đó, hoặc thiếu vế bắt buộc.
  --
  -- [vòng fix 2 — I4] Policy AS RESTRICTIVE KHÔNG còn bị coi là sai, và hình dạng biểu thức
  -- của nó KHÔNG bị soi. Vòng 1 chặn nó, và đó là phản tác dụng rõ ràng: cấm một lớp phòng
  -- thủ CHẶT HƠN. Lập luận, không phải khẩu vị: policy RESTRICTIVE được tổ hợp bằng AND với
  -- (OR của các policy PERMISSIVE), nên nó chỉ THU HẸP tập hàng nhìn thấy được — không biểu
  -- thức nào đặt vào đó mở thêm được một hàng nào. Và vế bảo vệ vẫn còn nguyên: nguồn (i) đòi
  -- PHẢI có ít nhất một policy PERMISSIVE, còn MỌI policy PERMISSIVE vẫn phải khớp danh sách.
  -- Đổi policy cách ly sang RESTRICTIVE để né phép kiểm sẽ làm bảng KHÔNG còn policy PERMISSIVE
  -- nào và bị nguồn (i) bắt.
  -- BẬC TỰ DO CÒN LẠI, nói ra thay vì hứa suông: một policy RESTRICTIVE có thể là no-op
  -- (USING (true)) — không phải lỗ hổng nhưng cũng không phải phòng thủ; và biểu thức của nó
  -- gọi được hàm do người khác viết. Cả hai đòi quyền DDL trên bảng, tức tác nhân đã ở mức
  -- làm được việc tệ hơn.
  --
  -- [vòng fix 2 — CR2] Vế "biểu thức có được duyệt không" nay hỏi HAI danh sách và danh sách
  -- thứ hai khoá theo ĐÚNG (bang, polname) — xem NGOAI_LE_HINH_DANG.
  CAU_POLICY_SAI constant text :=
    $q$SELECT c.relname || ': không có policy PERMISSIVE nào (RLS đang từ chối tất cả)' AS mo_ta
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || VI_TU_BANG_TENANT || $q$
          AND NOT ($q$ || LA_CUA_BANG_TENANT || $q$)
          AND NOT EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = c.oid AND p.polpermissive)
       UNION ALL
       SELECT c.relname || '.' || p.polname || ': ' ||
              CASE
                WHEN p.polcmd <> 'a' AND p.polqual IS NULL THEN 'thiếu vế USING'
                WHEN p.polcmd IN ('*', 'a', 'w') AND p.polwithcheck IS NULL
                  THEN 'thiếu vế WITH CHECK'
                ELSE 'hình dạng biểu thức KHÔNG nằm trong danh sách được duyệt — USING: '
                     || coalesce(pg_get_expr(p.polqual, p.polrelid), '(không có)')
                     || ' | WITH CHECK: '
                     || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '(không có)')
              END AS mo_ta
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || VI_TU_BANG_TENANT || $q$
          AND ((p.polcmd <> 'a' AND p.polqual IS NULL)
               OR (p.polcmd IN ('*', 'a', 'w') AND p.polwithcheck IS NULL)
               OR (p.polpermissive AND EXISTS (
                    SELECT 1
                      FROM (VALUES (pg_get_expr(p.polqual, p.polrelid)),
                                   (pg_get_expr(p.polwithcheck, p.polrelid))) AS e(bieu_thuc)
                     WHERE e.bieu_thuc IS NOT NULL
                       AND NOT EXISTS (
                             SELECT 1 FROM $q$ || HINH_DANG_CHUAN || $q$
                              WHERE h.bieu_thuc = e.bieu_thuc
                                AND h.pham_vi = CASE
                                      WHEN EXISTS (SELECT 1 FROM pg_attribute a
                                                    WHERE a.attrelid = c.oid
                                                      AND a.attname = 'org_id'
                                                      AND a.attnum > 0 AND NOT a.attisdropped)
                                      THEN 'co_org_id' ELSE 'bang_goc' END)
                       AND NOT EXISTS (
                             SELECT 1 FROM $q$ || NGOAI_LE_HINH_DANG || $q$
                              WHERE g.bang = c.relname
                                AND g.polname = p.polname
                                AND g.bieu_thuc = e.bieu_thuc
                                AND g.pham_vi = CASE
                                      WHEN EXISTS (SELECT 1 FROM pg_attribute a
                                                    WHERE a.attrelid = c.oid
                                                      AND a.attname = 'org_id'
                                                      AND a.attnum > 0 AND NOT a.attisdropped)
                                      THEN 'co_org_id' ELSE 'bang_goc' END))))$q$;

  -- [vòng fix 1 — I2] VIEW / MATERIALIZED VIEW / hàm SECURITY DEFINER đọc vòng qua RLS.
  -- "Chạm dữ liệu tenant" nhận diện theo HAI đường độc lập, cố ý không chỉ một: phụ thuộc
  -- catalog (pg_depend qua pg_rewrite — bắt cả view không hiện org_id ra đầu ra), và cột
  -- org_id trong chính đầu ra (bắt cả view dựng qua hàm/FDW mà pg_depend không nối tới bảng).
  --
  -- [vòng fix 2 — I3] BỎ RÀNG BUỘC SCHEMA CỦA CHÍNH ĐỐI TƯỢNG. Vòng 1 sinh ra mục (C) KÈM SẴN
  -- một bộ lọc tự làm mù mình: view/matview phải nằm trong 'public', hàm SECURITY DEFINER phải
  -- nằm trong 'public'/'app_private'. Đo được trên PostgreSQL 16.15 (app_api gắn tổ chức A,
  -- dữ liệu hai tổ chức):
  --     [SECDEF ở schema khác] hardening=PASS | tien_ich.doc_het()  -> a@a.com, vip@b.com  RÒ
  --     [VIEW  ở schema khác ] hardening=PASS | bao_cao.moi_nguoi   -> a@a.com, vip@b.com  RÒ
  --     [đối chứng trong public]                                    -> BLOCK
  -- Nay chỉ loại pg_catalog / information_schema / pg_toast* / pg_temp* — những schema mà dự
  -- án không đặt gì vào và PostgreSQL tự quản. Đối tượng thuộc EXTENSION cũng được loại (cùng
  -- lý do đã dùng cho pg_proc: không do dự án viết, và danh sách ngoại lệ không nên phình theo
  -- extension).
  -- Vì sao nới phạm vi QUÉT không làm phình báo nhầm: việc nhận diện "chạm dữ liệu tenant" vẫn
  -- NEO vào bảng tenant trong 'public' (MAU_VI_TU_BANG_TENANT) hoặc vào cột org_id của chính
  -- đầu ra. Một view trong schema khác KHÔNG chạm bảng tenant vẫn không bị nhắc tới.
  -- BẬC TỰ DO CÒN LẠI: bảng tenant đặt ở schema KHÁC 'public' vẫn không được nhận là bảng
  -- tenant (xem ghi chú (A)), nên một view đọc bảng đó chỉ bị bắt qua đường cột org_id.
  CAU_DOC_VONG constant text :=
    $q$SELECT n.nspname || '.' || c.relname || ': ' ||
              CASE WHEN c.relkind = 'm'
                   THEN 'MATERIALIZED VIEW trên dữ liệu tenant — matview KHÔNG chịu RLS ở bất '
                        'kỳ cấu hình nào. Bỏ nó đi, hoặc thêm tên này vào NGOAI_LE_DOC_VONG '
                        'kèm lý do.'
                   ELSE 'VIEW trên dữ liệu tenant mà thiếu "WITH (security_invoker = true)" — '
                        'RLS đang được kiểm theo CHỦ SỞ HỮU view, không theo người gọi. Sửa '
                        'bằng migration mới: ALTER VIEW ... SET (security_invoker = true).'
              END AS mo_ta
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('v', 'm')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp%'
          AND n.nspname || '.' || c.relname NOT IN (SELECT ten FROM $q$ || NGOAI_LE_DOC_VONG || $q$)
          AND NOT EXISTS (SELECT 1 FROM pg_depend dx
                           WHERE dx.classid = 'pg_class'::regclass AND dx.objid = c.oid
                             AND dx.deptype = 'e')
          AND (EXISTS (SELECT 1 FROM pg_depend d
                         JOIN pg_rewrite rw ON rw.oid = d.objid
                         JOIN pg_class tc ON tc.oid = d.refobjid
                         JOIN pg_namespace tn ON tn.oid = tc.relnamespace
                        WHERE d.classid = 'pg_rewrite'::regclass
                          AND d.refclassid = 'pg_class'::regclass
                          AND rw.ev_class = c.oid AND tc.oid <> c.oid
                          AND $q$ || pg_catalog.format(MAU_VI_TU_BANG_TENANT, 'tn', 'tc') || $q$)
               OR EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = c.oid AND a.attname = 'org_id'
                             AND a.attnum > 0 AND NOT a.attisdropped))
          AND (c.relkind = 'm'
               OR coalesce(array_to_string(c.reloptions, ','), '')
                    !~* '\msecurity_invoker\s*=\s*(true|on|1)\M')
       UNION ALL
       SELECT n.nspname || '.' || p.proname || ': hàm SECURITY DEFINER — nó chạy dưới quyền '
              'CHỦ SỞ HỮU nên mọi RLS bên trong được kiểm theo chủ sở hữu, không theo người '
              'gọi. Bỏ SECURITY DEFINER, hoặc thêm tên này vào NGOAI_LE_DOC_VONG kèm lý do.'
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp%'
          AND n.nspname || '.' || p.proname NOT IN (SELECT ten FROM $q$ || NGOAI_LE_DOC_VONG || $q$)
          AND NOT EXISTS (SELECT 1 FROM pg_depend d
                           WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                             AND d.deptype = 'e')$q$;

  -- Mỗi hàng: [1] tên mục, [2] tiền điều kiện, [3] câu lệnh cưỡng chế, [4] hậu điều kiện
  -- ("trạng thái đã đúng"), [5] biểu thức mô tả chỗ sai, [6] quyền cần có để sửa.
  -- [2], [4], [5] là biểu thức SQL chạy qua EXECUTE 'SELECT ' || ...
  bang text[][] := ARRAY[

    -- ---- Đối tượng phải TỒN TẠI (R3/R4: phục hồi được, không chỉ phát hiện) -------------
    ARRAY[
      $q$schema app_private tồn tại$q$,
      $q$true$q$,
      $q$CREATE SCHEMA IF NOT EXISTS app_private$q$,
      $q$EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app_private')$q$,
      $q$'schema app_private không tồn tại'$q$,
      $q$quyền CREATE trên database hiện tại (thường là chủ sở hữu database) hoặc SUPERUSER$q$
    ],

    -- Thân hàm PHẢI khớp bản trong 001_roles_and_functions.sql. Sửa một bên thì sửa cả hai;
    -- có test canh việc đó.
    ARRAY[
      $q$định nghĩa hàm app_current_org_id()$q$,
      $q$true$q$,
      $q$CREATE OR REPLACE FUNCTION public.app_current_org_id() RETURNS uuid
         LANGUAGE sql STABLE AS $ham$
  SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid
$ham$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid$than$
            AND p.provolatile = 's'
            AND p.prosecdef IS FALSE
            AND p.proconfig IS NULL
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.uuid'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.app_current_org_id()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | volatile=' || p.provolatile::text
                          || ' secdef=' || p.prosecdef::text
                          || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.app_current_org_id()')),
                  'hàm public.app_current_org_id() không tồn tại')$q$,
      $q$quyền sở hữu hàm app_current_org_id() (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- ---- Thuộc tính role (hàng rào S1) ---------------------------------------------------
    -- app_api có BYPASSRLS là đọc được giá thầu của MỌI tổ chức, bất chấp toàn bộ RLS.
    ARRAY[
      $q$thuộc tính role app_api$q$,
      $q$true$q$,
      $q$ALTER ROLE app_api NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOLOGIN INHERIT$q$,
      $q$(SELECT rolsuper IS FALSE AND rolcreatedb IS FALSE AND rolcreaterole IS FALSE
            AND rolbypassrls IS FALSE AND rolreplication IS FALSE AND rolcanlogin IS FALSE
            AND rolinherit IS TRUE
          FROM pg_roles WHERE rolname = 'app_api')$q$,
      $q$coalesce((SELECT nullif(concat_ws(', ',
            CASE WHEN rolsuper THEN 'SUPERUSER' END,
            CASE WHEN rolcreatedb THEN 'CREATEDB' END,
            CASE WHEN rolcreaterole THEN 'CREATEROLE' END,
            CASE WHEN rolbypassrls THEN 'BYPASSRLS' END,
            CASE WHEN rolreplication THEN 'REPLICATION' END,
            CASE WHEN rolcanlogin THEN 'LOGIN' END,
            CASE WHEN NOT rolinherit THEN 'NOINHERIT' END), '')
          FROM pg_roles WHERE rolname = 'app_api'), 'role app_api không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api$q$
    ],
    ARRAY[
      $q$thuộc tính role app_unseal$q$,
      $q$true$q$,
      $q$ALTER ROLE app_unseal NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOLOGIN INHERIT$q$,
      $q$(SELECT rolsuper IS FALSE AND rolcreatedb IS FALSE AND rolcreaterole IS FALSE
            AND rolbypassrls IS FALSE AND rolreplication IS FALSE AND rolcanlogin IS FALSE
            AND rolinherit IS TRUE
          FROM pg_roles WHERE rolname = 'app_unseal')$q$,
      $q$coalesce((SELECT nullif(concat_ws(', ',
            CASE WHEN rolsuper THEN 'SUPERUSER' END,
            CASE WHEN rolcreatedb THEN 'CREATEDB' END,
            CASE WHEN rolcreaterole THEN 'CREATEROLE' END,
            CASE WHEN rolbypassrls THEN 'BYPASSRLS' END,
            CASE WHEN rolreplication THEN 'REPLICATION' END,
            CASE WHEN rolcanlogin THEN 'LOGIN' END,
            CASE WHEN NOT rolinherit THEN 'NOINHERIT' END), '')
          FROM pg_roles WHERE rolname = 'app_unseal'), 'role app_unseal không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal$q$
    ],

    -- [CR2-T3] Hai role ĐĂNG NHẬP được danh sách trắng cho phép làm thành viên của app_api/
    -- app_unseal. Chúng là chủ thể tin cậy nên phải bị canh y hệt — nhưng KHÁC một điểm quan
    -- trọng: KHÔNG cưỡng chế LOGIN/NOLOGIN và KHÔNG đụng tới mật khẩu. "ALTER ROLE ... NOLOGIN"
    -- ở đây sẽ làm rớt đăng nhập của ứng dụng đang chạy ở mỗi lần deploy; hardening không được
    -- là nguồn sự cố. Vì vậy hậu điều kiện cũng KHÔNG kiểm rolcanlogin.
    -- Tiền điều kiện "role tồn tại": cụm chưa tạo role đăng nhập thì không có gì để canh.
    ARRAY[
      $q$thuộc tính role đăng nhập app_api_login$q$,
      $q$EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api_login')$q$,
      $q$ALTER ROLE app_api_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION INHERIT$q$,
      $q$(SELECT rolsuper IS FALSE AND rolcreatedb IS FALSE AND rolcreaterole IS FALSE
            AND rolbypassrls IS FALSE AND rolreplication IS FALSE AND rolinherit IS TRUE
          FROM pg_roles WHERE rolname = 'app_api_login')$q$,
      $q$coalesce((SELECT nullif(concat_ws(', ',
            CASE WHEN rolsuper THEN 'SUPERUSER' END,
            CASE WHEN rolcreatedb THEN 'CREATEDB' END,
            CASE WHEN rolcreaterole THEN 'CREATEROLE' END,
            CASE WHEN rolbypassrls THEN 'BYPASSRLS' END,
            CASE WHEN rolreplication THEN 'REPLICATION' END,
            CASE WHEN NOT rolinherit THEN 'NOINHERIT' END), '')
          FROM pg_roles WHERE rolname = 'app_api_login'), 'role app_api_login không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api_login$q$
    ],
    ARRAY[
      $q$thuộc tính role đăng nhập app_unseal_login$q$,
      $q$EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_unseal_login')$q$,
      $q$ALTER ROLE app_unseal_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION INHERIT$q$,
      $q$(SELECT rolsuper IS FALSE AND rolcreatedb IS FALSE AND rolcreaterole IS FALSE
            AND rolbypassrls IS FALSE AND rolreplication IS FALSE AND rolinherit IS TRUE
          FROM pg_roles WHERE rolname = 'app_unseal_login')$q$,
      $q$coalesce((SELECT nullif(concat_ws(', ',
            CASE WHEN rolsuper THEN 'SUPERUSER' END,
            CASE WHEN rolcreatedb THEN 'CREATEDB' END,
            CASE WHEN rolcreaterole THEN 'CREATEROLE' END,
            CASE WHEN rolbypassrls THEN 'BYPASSRLS' END,
            CASE WHEN rolreplication THEN 'REPLICATION' END,
            CASE WHEN NOT rolinherit THEN 'NOINHERIT' END), '')
          FROM pg_roles WHERE rolname = 'app_unseal_login'), 'role app_unseal_login không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal_login$q$
    ],

    -- ---- Cấu hình phiên gắn sẵn vào role / vào database ---------------------------------
    -- rolconfig áp dụng cho MỌI database (pg_db_role_setting với setdatabase = 0).
    ARRAY[
      $q$rolconfig toàn cụm của app_api$q$,
      $q$true$q$,
      $q$ALTER ROLE app_api RESET ALL$q$,
      $q$(SELECT rolconfig IS NULL FROM pg_roles WHERE rolname = 'app_api')$q$,
      $q$coalesce((SELECT array_to_string(rolconfig, ', ') FROM pg_roles WHERE rolname = 'app_api'),
                  'role app_api không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api$q$
    ],
    ARRAY[
      $q$rolconfig toàn cụm của app_unseal$q$,
      $q$true$q$,
      $q$ALTER ROLE app_unseal RESET ALL$q$,
      $q$(SELECT rolconfig IS NULL FROM pg_roles WHERE rolname = 'app_unseal')$q$,
      $q$coalesce((SELECT array_to_string(rolconfig, ', ') FROM pg_roles WHERE rolname = 'app_unseal'),
                  'role app_unseal không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal$q$
    ],

    -- [fix I5] "ALTER ROLE ... RESET ALL" ở trên chỉ xoá cấu hình áp dụng CHO MỌI DATABASE.
    -- Nó KHÔNG đụng tới "ALTER ROLE ... IN DATABASE d SET" — đã tự kiểm chứng bằng Postgres
    -- 16 thật: sau RESET ALL, pg_roles.rolconfig là NULL nhưng pg_db_role_setting.setconfig
    -- vẫn là {row_security=off}.
    --
    -- [fix round 4] Sửa một phát biểu SAI của vòng 3 ở chính chỗ này: bình luận cũ viết
    -- "row_security=off TẮT HẲN RLS cho phiên đó". Không đúng. Đã đo thật với app_api
    -- (không sở hữu bảng, không BYPASSRLS): truy vấn bảng có RLS BÁO LỖI "query would be
    -- affected by row-level security policy for table ..." chứ không đọc lọt hàng nào.
    -- row_security=off chỉ THẬT SỰ bỏ qua RLS cho ai vốn đã được miễn (chủ sở hữu bảng, role
    -- BYPASSRLS); với role thường nó biến truy vấn hợp lệ thành lỗi. Vẫn phải RESET, vì
    -- (a) cấu hình an ninh trôi vào role ứng dụng là thứ không ai cố ý đặt, và (b) hậu quả
    -- là sự cố sẵn sàng ở mọi truy vấn chạm bảng có RLS. Nhưng lý do là VẬY, không phải
    -- "bypass RLS".
    ARRAY[
      $q$cấu hình IN DATABASE của app_api$q$,
      $q$true$q$,
      pg_catalog.format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_api', pg_catalog.current_database()),
      $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                     WHERE r.rolname = 'app_api'
                       AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database()))$q$,
      $q$coalesce((SELECT array_to_string(s.setconfig, ', ') FROM pg_db_role_setting s
                    JOIN pg_roles r ON r.oid = s.setrole
                   WHERE r.rolname = 'app_api'
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api$q$
    ],
    ARRAY[
      $q$cấu hình IN DATABASE của app_unseal$q$,
      $q$true$q$,
      pg_catalog.format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_unseal', pg_catalog.current_database()),
      $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                     WHERE r.rolname = 'app_unseal'
                       AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database()))$q$,
      $q$coalesce((SELECT array_to_string(s.setconfig, ', ') FROM pg_db_role_setting s
                    JOIN pg_roles r ON r.oid = s.setrole
                   WHERE r.rolname = 'app_unseal'
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal$q$
    ],

    -- [CR2-T3] Cùng hai lớp cấu hình phiên đó, trên hai role đăng nhập.
    ARRAY[
      $q$rolconfig toàn cụm của app_api_login$q$,
      $q$EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api_login')$q$,
      $q$ALTER ROLE app_api_login RESET ALL$q$,
      $q$(SELECT rolconfig IS NULL FROM pg_roles WHERE rolname = 'app_api_login')$q$,
      $q$coalesce((SELECT array_to_string(rolconfig, ', ') FROM pg_roles WHERE rolname = 'app_api_login'),
                  'role app_api_login không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api_login$q$
    ],
    ARRAY[
      $q$rolconfig toàn cụm của app_unseal_login$q$,
      $q$EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_unseal_login')$q$,
      $q$ALTER ROLE app_unseal_login RESET ALL$q$,
      $q$(SELECT rolconfig IS NULL FROM pg_roles WHERE rolname = 'app_unseal_login')$q$,
      $q$coalesce((SELECT array_to_string(rolconfig, ', ') FROM pg_roles WHERE rolname = 'app_unseal_login'),
                  'role app_unseal_login không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal_login$q$
    ],
    ARRAY[
      $q$cấu hình IN DATABASE của app_api_login$q$,
      $q$EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api_login')$q$,
      pg_catalog.format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_api_login', pg_catalog.current_database()),
      $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                     WHERE r.rolname = 'app_api_login'
                       AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database()))$q$,
      $q$coalesce((SELECT array_to_string(s.setconfig, ', ') FROM pg_db_role_setting s
                    JOIN pg_roles r ON r.oid = s.setrole
                   WHERE r.rolname = 'app_api_login'
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api_login$q$
    ],
    ARRAY[
      $q$cấu hình IN DATABASE của app_unseal_login$q$,
      $q$EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_unseal_login')$q$,
      pg_catalog.format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_unseal_login', pg_catalog.current_database()),
      $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                     WHERE r.rolname = 'app_unseal_login'
                       AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database()))$q$,
      $q$coalesce((SELECT array_to_string(s.setconfig, ', ') FROM pg_db_role_setting s
                    JOIN pg_roles r ON r.oid = s.setrole
                   WHERE r.rolname = 'app_unseal_login'
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal_login$q$
    ],

    -- [fix round 5 — Minor] setrole = 0: "ALTER DATABASE d SET ..." áp cho MỌI role, kể cả
    -- app_api/app_unseal. Hai dòng dưới đây reset đúng hai GUC nhạy cảm, không reset sạch.
    ARRAY[
      $q$row_security đặt ở mức database$q$,
      $q$true$q$,
      pg_catalog.format('ALTER DATABASE %I RESET row_security', pg_catalog.current_database()),
      $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s
                     WHERE s.setrole = 0
                       AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())
                       AND EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE c LIKE 'row\_security=%'))$q$,
      $q$coalesce((SELECT array_to_string(s.setconfig, ', ') FROM pg_db_role_setting s
                   WHERE s.setrole = 0
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$quyền sở hữu database hiện tại hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$search_path đặt ở mức database$q$,
      $q$true$q$,
      pg_catalog.format('ALTER DATABASE %I RESET search_path', pg_catalog.current_database()),
      $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s
                     WHERE s.setrole = 0
                       AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())
                       AND EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE c LIKE 'search\_path=%'))$q$,
      $q$coalesce((SELECT array_to_string(s.setconfig, ', ') FROM pg_db_role_setting s
                   WHERE s.setrole = 0
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$quyền sở hữu database hiện tại hoặc SUPERUSER$q$
    ],

    -- ---- Quyền trên schema ---------------------------------------------------------------
    -- "GRANT ALL ON SCHEMA public TO app_api" cấp kèm CREATE: app_api tự tạo được đối tượng
    -- trong public — một VIEW hay hàm SECURITY DEFINER của chính nó, hoặc một bảng che tên
    -- bảng thật nếu search_path thuận lợi. Không role ứng dụng nào cần CREATE trên public.
    -- [fix round 5 — R2] REVOKE nhắm cả PUBLIC, xem giải thích ở đầu file.
    ARRAY[
      $q$quyền CREATE trên schema public$q$,
      $q$true$q$,
      $q$REVOKE CREATE ON SCHEMA public FROM PUBLIC, app_api, app_unseal$q$,
      $q$NOT has_schema_privilege('app_api', 'public', 'CREATE')
        AND NOT has_schema_privilege('app_unseal', 'public', 'CREATE')$q$,
      $q$'app_api CREATE=' || has_schema_privilege('app_api', 'public', 'CREATE')::text ||
        ', app_unseal CREATE=' || has_schema_privilege('app_unseal', 'public', 'CREATE')::text$q$,
      $q$quyền sở hữu schema public (thường là chủ sở hữu database) hoặc SUPERUSER$q$
    ],

    -- USAGE trên public là điều kiện cần để hai role dùng được bất cứ thứ gì trong đó. Cấp
    -- lại ở MỌI lần chạy để kịch bản "role bị DROP rồi tạo lại" tự phục hồi.
    ARRAY[
      $q$quyền USAGE trên schema public$q$,
      $q$true$q$,
      $q$GRANT USAGE ON SCHEMA public TO app_api, app_unseal$q$,
      $q$has_schema_privilege('app_api', 'public', 'USAGE')
        AND has_schema_privilege('app_unseal', 'public', 'USAGE')$q$,
      $q$'app_api USAGE=' || has_schema_privilege('app_api', 'public', 'USAGE')::text ||
        ', app_unseal USAGE=' || has_schema_privilege('app_unseal', 'public', 'USAGE')::text$q$,
      $q$quyền sở hữu schema public (thường là chủ sở hữu database) hoặc SUPERUSER$q$
    ],

    -- Schema app_private là hàng rào mặc định cho mọi hàm nhạy cảm mà migration sau đặt vào
    -- đó. Một "GRANT USAGE ON SCHEMA app_private TO app_api" sau triển khai tháo bỏ hàng rào
    -- đó cho TOÀN BỘ các hàm ấy cùng lúc. Tiền điều kiện chỉ để phòng ca dòng CREATE SCHEMA
    -- ở trên thất bại — khi đó chính dòng đó đã gom lỗi rồi, không cần gãy thêm ở đây với
    -- một lỗi "schema does not exist" khó đọc.
    ARRAY[
      $q$quyền của app_api/app_unseal trên schema app_private$q$,
      $q$EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app_private')$q$,
      $q$REVOKE ALL ON SCHEMA app_private FROM PUBLIC, app_api, app_unseal$q$,
      $q$NOT has_schema_privilege('app_api', 'app_private', 'USAGE')
        AND NOT has_schema_privilege('app_api', 'app_private', 'CREATE')
        AND NOT has_schema_privilege('app_unseal', 'app_private', 'USAGE')
        AND NOT has_schema_privilege('app_unseal', 'app_private', 'CREATE')$q$,
      $q$'app_api USAGE=' || has_schema_privilege('app_api', 'app_private', 'USAGE')::text ||
        ' CREATE=' || has_schema_privilege('app_api', 'app_private', 'CREATE')::text ||
        ', app_unseal USAGE=' || has_schema_privilege('app_unseal', 'app_private', 'USAGE')::text ||
        ' CREATE=' || has_schema_privilege('app_unseal', 'app_private', 'CREATE')::text$q$,
      $q$quyền sở hữu schema app_private hoặc SUPERUSER$q$
    ],

    -- ---- Quyền EXECUTE trên app_current_org_id() ----------------------------------------
    -- "GRANT EXECUTE ... TO PUBLIC" lật ngược ĐÚNG bản vá S2.
    ARRAY[
      $q$EXECUTE của PUBLIC trên app_current_org_id()$q$,
      $q$to_regprocedure('public.app_current_org_id()') IS NOT NULL$q$,
      $q$REVOKE EXECUTE ON FUNCTION public.app_current_org_id() FROM PUBLIC$q$,
      -- proacl IS NULL nghĩa là ACL mặc định của Postgres, trong đó PUBLIC CÓ EXECUTE — nên
      -- NULL phải tính là SAI, không phải "không có dòng cấp nào nên coi như đúng".
      $q$(SELECT p.proacl IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
          FROM pg_proc p WHERE p.oid = to_regprocedure('public.app_current_org_id()'))$q$,
      $q$'PUBLIC vẫn có EXECUTE trên public.app_current_org_id()'$q$,
      $q$quyền sở hữu hàm app_current_org_id() hoặc SUPERUSER$q$
    ],

    -- Mặt kia của cùng bản vá S2: sau khi thu hồi khỏi PUBLIC, hai role thật sự cần hàm này
    -- (nó nằm trong vị từ USING của mọi policy RLS) phải còn EXECUTE.
    ARRAY[
      $q$EXECUTE của app_api/app_unseal trên app_current_org_id()$q$,
      $q$to_regprocedure('public.app_current_org_id()') IS NOT NULL$q$,
      $q$GRANT EXECUTE ON FUNCTION public.app_current_org_id() TO app_api, app_unseal$q$,
      $q$has_function_privilege('app_api', 'public.app_current_org_id()', 'EXECUTE')
        AND has_function_privilege('app_unseal', 'public.app_current_org_id()', 'EXECUTE')$q$,
      $q$'app_api EXECUTE=' || has_function_privilege('app_api', 'public.app_current_org_id()', 'EXECUTE')::text ||
        ', app_unseal EXECUTE=' || has_function_privilege('app_unseal', 'public.app_current_org_id()', 'EXECUTE')::text$q$,
      $q$quyền sở hữu hàm app_current_org_id() hoặc SUPERUSER$q$
    ],

    -- ---- (A) Cờ RLS trên mọi bảng tenant — tự chữa, tổng quát ---------------------------
    ARRAY[
      $q$ENABLE/FORCE ROW LEVEL SECURITY trên mọi bảng tenant$q$,
      $q$true$q$,
      $q$DO $rls$
         DECLARE ten_bang regclass;
         BEGIN
           FOR ten_bang IN
             SELECT c.oid::regclass FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE $q$ || VI_TU_BANG_TENANT || $q$
                AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
           LOOP
             EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', ten_bang);
             EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', ten_bang);
           END LOOP;
         END
         $rls$$q$,
      $q$NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE $q$ || VI_TU_BANG_TENANT || $q$
                        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity))$q$,
      $q$(SELECT string_agg(c.relname || ' (enable=' || c.relrowsecurity::text
                            || ', force=' || c.relforcerowsecurity::text || ')', ', ')
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE $q$ || VI_TU_BANG_TENANT || $q$
             AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity))$q$,
      $q$quyền sở hữu các bảng đó hoặc SUPERUSER$q$
    ],

    -- ---- (B) Hình dạng policy trên bảng tenant — chỉ phát hiện --------------------------
    ARRAY[
      $q$hình dạng policy RLS của bảng tenant$q$,
      $q$true$q$,
      -- Không tự chữa được: xem giải thích (B) ở đầu file. Câu lệnh cố ý là no-op để mục này
      -- vẫn đi qua đúng khuôn bốn bước chung thay vì thành một nhánh đặc biệt.
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_POLICY_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_POLICY_SAI || $q$) t)$q$,
      -- [vòng fix 1 — I3] Hướng dẫn cũ ("chép định nghĩa từ migration đã tạo bảng đó") sai ở
      -- chỗ nó ngụ ý phải sửa TAY trên cụm. Nhờ khuôn ba lượt, cả hai đường sửa đều là "sửa
      -- file rồi deploy lại".
      $q$viết một migration mới sửa policy (lượt 1 không phán xét nên migrate() luôn chạy tới được nó), HOẶC — nếu hình dạng đó là hợp lệ cho ĐÚNG bảng và policy này — thêm một dòng (bang, polname, pham_vi, bieu_thuc) vào NGOAI_LE_HINH_DANG trong chính file này kèm cập nhật meta-test khoá danh sách đó$q$
    ],

    -- ---- (C) Đường đọc vòng qua RLS: VIEW · MATVIEW · SECURITY DEFINER ------------------
    ARRAY[
      $q$view/matview/hàm SECURITY DEFINER đọc vòng qua RLS$q$,
      $q$true$q$,
      -- Không tự chữa được: "ALTER VIEW ... SET (security_invoker = true)" tự chữa được về mặt
      -- kỹ thuật, nhưng nó ÂM THẦM đổi ngữ nghĩa một view do người khác viết, và với matview
      -- thì không có gì để chữa. Phát hiện, kèm câu lệnh sửa viết sẵn trong thông báo.
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_DOC_VONG || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_DOC_VONG || $q$) t)$q$,
      $q$viết một migration mới (ALTER VIEW ... SET (security_invoker = true), DROP MATERIALIZED VIEW, hoặc bỏ SECURITY DEFINER), HOẶC thêm tên đối tượng vào NGOAI_LE_DOC_VONG kèm lý do$q$
    ]
  ];

  -- [CR2-T3] Bốn role được canh. Hai role ứng dụng, và hai role đăng nhập được danh sách
  -- trắng cho phép làm thành viên của chúng — xem giải thích (a) ở đầu file: không mở rộng
  -- vùng canh sang hai role đăng nhập thì "GRANT nhom_bat_ky TO app_api_login" và
  -- "GRANT app_api_login TO ke_tan_cong" đều lọt, mà cả hai đều dẫn quyền của app_api ra
  -- ngoài bắc cầu.
  ROLE_CANH constant text :=
    $q$('app_api', 'app_unseal', 'app_api_login', 'app_unseal_login')$q$;

  -- Danh sách trắng CẶP (nhóm, thành viên). Đóng, viết tay, không suy ra từ tên.
  CAP_HOP_LE constant text :=
    $q$(VALUES ('app_api', 'app_api_login'), ('app_unseal', 'app_unseal_login'))$q$;

  -- Truy vấn membership hai chiều, dùng lại ở bước 1 (gỡ) và bước 3 (kiểm).
  --   (a) role được canh là THÀNH VIÊN của nhóm khác — kế thừa quyền của nhóm đó.
  --   (b) role KHÁC được cấp membership VÀO role được canh — kế thừa quyền của nó.
  -- Trừ đi đúng hai cặp trong danh sách trắng.
  CAU_MEMBERSHIP_LA constant text :=
    $q$SELECT nhom.rolname AS ten_nhom, thanh_vien.rolname AS ten_thanh_vien
         FROM pg_auth_members am
         JOIN pg_roles nhom ON nhom.oid = am.roleid
         JOIN pg_roles thanh_vien ON thanh_vien.oid = am.member
        WHERE (thanh_vien.rolname IN $q$ || ROLE_CANH || $q$
               OR nhom.rolname IN $q$ || ROLE_CANH || $q$)
          AND (nhom.rolname, thanh_vien.rolname) NOT IN $q$ || CAP_HOP_LE;

  -- Mặt còn lại của danh sách trắng: cặp HỢP LỆ nhưng mang ADMIN OPTION. Không gỡ trọn
  -- membership (sẽ làm rớt ứng dụng), chỉ thu hồi riêng ADMIN OPTION — trôi tự chữa được.
  CAU_ADMIN_LA constant text :=
    $q$SELECT nhom.rolname AS ten_nhom, thanh_vien.rolname AS ten_thanh_vien
         FROM pg_auth_members am
         JOIN pg_roles nhom ON nhom.oid = am.roleid
         JOIN pg_roles thanh_vien ON thanh_vien.oid = am.member
        WHERE (nhom.rolname, thanh_vien.rolname) IN $q$ || CAP_HOP_LE || $q$
          AND am.admin_option$q$;

  i int;
  du_dieu_kien boolean;
  dung_roi boolean;
  chi_tiet text;
  hang RECORD;
  con_sot text;
  loi_gom text[] := ARRAY[]::text[];
BEGIN
  -- ===== [vòng fix 2 — CR1] GHIM search_path CỦA PHIÊN PHÁN XÉT ========================
  -- Vòng 1 TỰ PHÁT HIỆN rằng pg_get_expr deparse THEO search_path của phiên đang đọc, rồi
  -- xử lý bằng cách NỚI danh sách trắng ra để chứa cả hai dạng. Nới ra chính là cơ chế của
  -- lỗ hổng vòng 2 — đã đo, đây là rò rỉ XUYÊN TỔ CHỨC thật trên PostgreSQL 16.15:
  --     CREATE SCHEMA gia;
  --     CREATE FUNCTION gia.app_current_org_id() ... AS 'SELECT ''<org B>''::uuid';
  --     SET search_path TO gia, public;  ALTER POLICY users_tenant_isolation ON public.users
  --       USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
  --     ALTER ROLE <role_deploy> SET search_path = gia, public;
  --   -> policy THẬT SỰ gọi gia.app_current_org_id (đọc pg_depend), nhưng dưới search_path
  --      của phiên deploy nó deparse ra ĐÚNG chuỗi trần "(org_id = app_current_org_id())"
  --      nên lọt danh sách trắng: migrate() lần 1 VÀ lần 2 đều PASS, và app_api_login đã gắn
  --      TỔ CHỨC A đọc public.users ra "vip@b.com" — người của TỔ CHỨC B.
  --   "ALTER ROLE ... SET search_path" KHÔNG nằm trong vùng canh của file này (nó chỉ reset
  --   rolconfig của BỐN role đã biết và search_path ở mức DATABASE), nên đó là chặn 0%, vĩnh
  --   viễn — không phải một cửa sổ.
  --
  -- QUY TẮC RÚT RA, áp cho mọi phép kiểm trong file này: khi một bảo đảm phụ thuộc một cấu
  -- hình, GHIM cấu hình đó; đừng nới bảo đảm ra để chấp nhận mọi giá trị của nó. Nới ra thì
  -- bậc tự do vừa phát hiện trở thành bậc tự do của KẺ TẤN CÔNG.
  --
  -- Phạm vi ghim là TRANSACTION (is_local = true), không phải phiên: file này chạy trong một
  -- BEGIN/COMMIT tường minh do migrate.ts mở, nên ghim tự biến mất khi transaction kết thúc
  -- và không rò sang migration đánh số hay sang lần dùng kết nối kế tiếp. Chạy bằng tay
  -- (psql -f) cũng đúng ngữ nghĩa: khối DO này TỰ NÓ là một transaction.
  --
  -- Vì sao 'pg_catalog, public' chứ không phải 'public': viết pg_catalog TƯỜNG MINH thay vì
  -- dựa vào quy tắc "pg_catalog được tìm ngầm trước". Đã đo là quy tắc ngầm ấy PHÁ ĐƯỢC:
  -- "SET search_path = gia, pg_catalog, public" + "CREATE FUNCTION gia.current_setting(text,
  -- boolean)" làm current_setting() trả 'BI_CUOP'. Khối này KHÔNG tạo đối tượng nào không
  -- ghi đủ tên schema nên đặt pg_catalog trước là an toàn — ngược lại, packages/db/src/
  -- migrate.ts phải dùng 'public' vì CREATE TABLE không ghi schema sẽ rơi vào pg_catalog và
  -- bị từ chối ("permission denied to create ... System catalog modifications are currently
  -- disallowed" — đã đo).
  --
  -- Phải gọi pg_catalog.set_config chứ không set_config trần: chính hàm đó cũng cướp được.
  -- Cùng lý do, khối DECLARE ở trên (chạy TRƯỚC dòng này) ghi đủ pg_catalog. cho
  -- current_setting/format/current_database. Từ đây trở xuống search_path đã ghim nên các
  -- lời gọi trần còn lại trong thân khối là an toàn.
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog, public', true);

  -- [vòng fix 1 — I3] Chế độ lạ là LỖI, không phải "coi như mặc định". Một lỗi chính tả trong
  -- packages/db/src/migrate.ts sẽ làm lượt phán xét im lặng biến mất nếu ở đây khoan dung.
  IF che_do NOT IN ('sua', 'phan_xet', 'day_du') THEN
    RAISE EXCEPTION 'app.hardening_che_do = % không hợp lệ (chỉ nhận sua/phan_xet/day_du)', che_do;
  END IF;

  IF che_do IN ('sua', 'day_du') THEN
  -- ===== BƯỚC 0: role phải tồn tại =====================================================
  -- Nuốt riêng lỗi thiếu quyền ở đây để thông báo có ích hơn phát ra từ bước 3
  -- ("role app_api không tồn tại" kèm quyền cần có), thay vì "permission denied to create role".
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    BEGIN
      CREATE ROLE app_api NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_unseal') THEN
    BEGIN
      CREATE ROLE app_unseal NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;

  -- ===== BƯỚC 1: gỡ membership TRƯỚC mọi phép kiểm (R1) =================================
  -- [CR2-T3] Chỉ gỡ membership LẠ. Cặp trong danh sách trắng được giữ — không có nó thì
  -- không role đăng nhập nào tồn tại nổi qua một lần migrate(), và app_api (NOLOGIN) không
  -- bao giờ được dùng tới.
  FOR hang IN EXECUTE CAU_MEMBERSHIP_LA LOOP
    BEGIN
      EXECUTE format('REVOKE %I FROM %I', hang.ten_nhom, hang.ten_thanh_vien);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- ===== BƯỚC 1b: thu hồi ADMIN OPTION trên chính cặp hợp lệ ============================
  FOR hang IN EXECUTE CAU_ADMIN_LA LOOP
    BEGIN
      EXECUTE format('REVOKE ADMIN OPTION FOR %I FROM %I', hang.ten_nhom, hang.ten_thanh_vien);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- ===== BƯỚC 2: chạy TOÀN BỘ câu lệnh cưỡng chế, không phán xét gì =====================
  FOR i IN 1 .. array_length(bang, 1) LOOP
    EXECUTE 'SELECT ' || bang[i][2] INTO du_dieu_kien;
    CONTINUE WHEN NOT coalesce(du_dieu_kien, false);
    BEGIN
      EXECUTE bang[i][3];
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  END IF; -- che_do IN ('sua','day_du')

  IF che_do = 'sua' THEN
    RETURN; -- lượt SỬA dừng ở đây; phán xét là việc của lượt riêng, transaction riêng.
  END IF;

  -- ===== BƯỚC 3: đọc catalog, GOM mọi chỗ còn sai =======================================
  EXECUTE 'SELECT string_agg(format(''%s -> %s'', ten_nhom, ten_thanh_vien), ''; '') FROM ('
          || CAU_MEMBERSHIP_LA || ') t'
    INTO con_sot;
  IF con_sot IS NOT NULL THEN
    loi_gom := loi_gom || format(
      '- "tư cách thành viên LẠ của app_api/app_unseal và role đăng nhập của chúng": còn sót '
      '(%s). Cần quyền: ADMIN OPTION trên các role đó hoặc SUPERUSER.', con_sot);
  END IF;

  EXECUTE 'SELECT string_agg(format(''%s -> %s'', ten_nhom, ten_thanh_vien), ''; '') FROM ('
          || CAU_ADMIN_LA || ') t'
    INTO con_sot;
  IF con_sot IS NOT NULL THEN
    loi_gom := loi_gom || format(
      '- "ADMIN OPTION trên tư cách thành viên hợp lệ": còn sót (%s) — chủ thể đó tự cấp được '
      'app_api/app_unseal cho bất kỳ ai. Cần quyền: ADMIN OPTION trên các role đó hoặc '
      'SUPERUSER.', con_sot);
  END IF;

  FOR i IN 1 .. array_length(bang, 1) LOOP
    EXECUTE 'SELECT ' || bang[i][2] INTO du_dieu_kien;
    CONTINUE WHEN NOT coalesce(du_dieu_kien, false);

    EXECUTE 'SELECT ' || bang[i][4] INTO dung_roi;
    IF NOT coalesce(dung_roi, false) THEN
      EXECUTE 'SELECT ' || bang[i][5] INTO chi_tiet;
      loi_gom := loi_gom || format(
        '- "%s": trạng thái hiện tại SAI (%s). Cần quyền: %s.',
        bang[i][1], chi_tiet, bang[i][6]);
    END IF;
  END LOOP;

  -- ===== BƯỚC 4: một lần gãy, liệt kê tất cả ============================================
  IF array_length(loi_gom, 1) > 0 THEN
    RAISE EXCEPTION E'Hardening không sửa được % mục:\n%\nChạy migrate() bằng role có quyền tương ứng, hoặc sửa tay rồi chạy lại.',
      array_length(loi_gom, 1), array_to_string(loi_gom, E'\n');
  END IF;
END
$khoi$;

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
--   BƯỚC 1b: thu hồi ADMIN OPTION trên chính cặp membership hợp lệ.
--   BƯỚC 2: chạy TOÀN BỘ câu lệnh cưỡng chế. Không kiểm gì, không gãy ở đây.
--   >>> BẤT BIẾN CHUNG CỦA BƯỚC 0/1/1b/2 — "LƯỢT SỬA KHÔNG GÃY":
--           mọi câu lệnh có tác dụng phụ trong bốn bước này bắt MỌI lỗi (không riêng
--           insufficient_privilege 42501), phát WARNING, và để BƯỚC 3 phán xét trạng thái thật.
--           [vòng fix 1 — CR3] dựng bất biến này nhưng CHỈ ÁP CHO BƯỚC 2. Đó là một tuyên bố ở
--           PHẠM VI TỆP được cài đặt ở MỘT trong BỐN chỗ, và [vòng fix 2 — CR1] đo được hậu quả:
--           "REVOKE <nhóm> FROM <thành viên>" của BƯỚC 1 ném 2BP01 (dependent privileges exist)
--           khi thành viên đã cấp tiếp nhóm đó, lỗi thoát ra ngoài khối DO ở LƯỢT SỬA và
--           004_*.sql không bao giờ chạy tới (đo trên cả hai hồ sơ vai deploy: count = 0).
--           BƯỚC 0/1/1b nằm trong CÙNG transaction với BƯỚC 2 nên chúng nằm trong cùng bất biến.
--           Bài học đi kèm, đắt hơn bản vá: khi tuyên bố một bất biến ở phạm vi TỆP thì phải
--           QUÉT TOÀN TỆP, không chỉ những dòng vừa thêm vào.
--           Vì sao bất biến này đáng giá: lỗi thoát khỏi khối DO -> cả transaction hardening
--           rollback -> và vì lượt SỬA chạy TRƯỚC vòng migration đánh số, migrate() chết trước
--           khi tới 004_*.sql nên KHÔNG vá được bằng một migration mới. Có test riêng cho cả hai
--           tầng ("[vòng fix 1 — CR3] câu lệnh cưỡng chế ném lỗi KHÁC 42501..." và
--           "[vòng fix 2 — CR1] lỗi 2BP01 ở BƯỚC 1..." ở db/migrations.int.test.ts) vì nó là nền
--           của cả đường thoát QT1 của dự án.
--           Nuốt KHÔNG phải là bỏ qua, và cũng KHÔNG phải là "ghi lại để nói ra sau": chỗ nói ra
--           là WARNING NGAY TẠI CHỖ cộng hậu điều kiện ở BƯỚC 3. [vòng fix 2 — I4] đã bỏ mảng
--           `loi_cuong_che` của vòng trước vì nó là mã chết — xem giải thích ở khai báo biến.
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
-- xét, migrate() chạy được hết vòng migration đánh số. Người vận hành viết một migration
-- mới (vd. 004_sua_policy.sql) rồi deploy — không cần đụng tay vào cụm.
-- [vòng fix 1 — CR3] PHÁT BIỂU NÀY TỪNG QUÁ RỘNG, và đó là chỗ đắt nhất để nói quá vì lời hứa
-- ở đây là NỀN của cả đường thoát QT1 của dự án. "Lượt 1 không phán xét" chỉ bảo đảm lượt 1
-- không RAISE của riêng nó; nó KHÔNG bảo đảm lượt 1 chạy xong, vì lượt 1 CÓ chạy câu lệnh cưỡng
-- chế và một câu lệnh cưỡng chế cũng ném lỗi được. Đo được: một CONSTRAINT TRIGGER trùng tên
-- làm CREATE OR REPLACE TRIGGER ném 42710 ở LƯỢT 1 -> migrate() chết trước vòng migration đánh
-- số -> 004_*.sql KHÔNG BAO GIỜ chạy tới -> đường sửa duy nhất là sửa tay trên cụm.
-- [vòng fix 2 — CR1] VÀ VÒNG 1 ĐÃ NÓI QUÁ NGAY TRONG CHÍNH CÂU SỬA CHỖ NÓI QUÁ. Nó viết
-- "phát biểu trên mới thành TÍNH CHẤT chứ không còn là Ý ĐỊNH" trong khi chỉ vá BƯỚC 2, còn
-- BƯỚC 0/1/1b vẫn chỉ nuốt 42501 và vẫn ném ra ngoài từ CÙNG transaction — đo được: một
-- membership lạ đã được cấp tiếp làm "REVOKE <nhóm> FROM <thành viên>" ném 2BP01 ở LƯỢT 1,
-- 004 = 0. "Lượt 1 chạy được hết" là tính chất của CẢ LƯỢT SỬA, không phải của riêng BƯỚC 2.
-- PHÁT BIỂU ĐÚNG MỨC, sau khi cả bốn chỗ đã được vá và có test cho hai chỗ nặng nhất:
--   lượt 1 chạy hết mọi câu lệnh có tác dụng phụ của BƯỚC 0/1/1b/2 dù bất kỳ câu nào trong số
--   đó ném lỗi, vì tất cả đều nằm trong khối con bắt MỌI lỗi. Nó KHÔNG bảo đảm gì về những
--   câu lệnh nằm NGOÀI bốn bước đó — mọi bổ sung sau này phải tự đặt lại câu hỏi
--   "câu lệnh này ném được lỗi gì ngoài 42501?" và tự bọc.
-- Nếu chỗ sai nằm ở danh sách hình dạng được duyệt (bên dưới) thì sửa CHÍNH FILE NÀY: nó là
-- ".always.sql", chạy lại ở mọi lần migrate(), nên bản sửa có hiệu lực ngay ở lần deploy kế.
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
--       relkind IN ('r','p').
--       [vòng fix 3 — Minor] Mục (A) nay còn phủ CON CHÁU (phân mảnh hoặc INHERITS) của một
--       bảng tenant KỂ CẢ khi con nằm ở schema khác 'public' — xem VI_TU_CAN_CO_RLS. Trước bản
--       vá, "khac.con_khac INHERITS public.bao_gia" đo được là rò thật: hardening PASS mà
--       app_api gắn tổ chức A đọc thẳng con thấy hàng của tổ chức B.
--       Vẫn CÓ bậc tự do còn lại, nói ra thay vì hứa suông: bảng NGOÀI (relkind='f'), và bảng
--       có org_id đặt ở schema KHÁC 'public' mà KHÔNG treo dưới bảng tenant nào. Cả hai không
--       bị phủ.
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
  --   cửa thoát, là lỗ.
  --
  --   [vòng fix 3 — I2] Vòng 2 khoá theo (bang, polname, pham_vi, bieu_thuc) rồi viết ngay
  --   bên dưới rằng "một ngoại lệ chỉ có hiệu lực ĐÚNG NƠI nó được cấp" và mô tả cửa bằng
  --   "policy riêng FOR SELECT TO app_unseal". CẢ HAI CHIỀU ẤY — LỆNH và ROLE — KHÔNG NẰM
  --   TRONG KHOÁ. Đã đo trên PostgreSQL 16.15:
  --     cửa cấp cho (bao_gia, bg_unseal), policy dạng TO app_unseal -> PASS, app_api đọc [100]
  --     ALTER POLICY bg_unseal ON bao_gia TO app_api                -> PASS, CỬA VẪN DUYỆT
  --        app_api gắn tổ chức A đọc bao_gia -> [100, 999]   <- 999 là GIÁ CỦA TỔ CHỨC B
  --   Đúng khuôn CR2-v2, hẹp đi một trục. Và vì danh sách RỖNG ở S0, nó chỉ nổ khi Task 6 cấp
  --   dòng đầu tiên — tức khi không ai còn nhìn. Nay khoá SÁU cột:
  --   (bang, polname, lenh, vai_tro, pham_vi, bieu_thuc).
  --     lenh    = pg_policy.polcmd nguyên văn: '*' = ALL, 'r' = SELECT, 'a' = INSERT,
  --               'w' = UPDATE, 'd' = DELETE.
  --     vai_tro = tên các role của policy, sắp xếp và nối bằng ','. Policy áp cho PUBLIC có
  --               polroles = {0}, và OID 0 KHÔNG có hàng trong pg_roles — đã đo. Viết
  --               "array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(...)))"
  --               thì PUBLIC cho ra CHUỖI RỖNG, tức chỗ RỘNG NHẤT lại trùng với giá trị giữ
  --               chỗ của dòng rỗng bên dưới. Nên kết xuất PUBLIC TƯỜNG MINH.
  --               [sửa sau xác minh] Bản trước ghi "COLLATE \"C\" để thứ tự không phụ thuộc
  --               collation của database", hàm ý ORDER BY trần vốn đã không ổn định. NGƯỢC:
  --               pg_roles.rolname có kiểu `name`, mà `name` mang typcollation = 950 = "C"
  --               CỨNG theo kiểu, nên "ORDER BY rolname" trần LÀ tất định. Chính cái cast
  --               `rolname::text` — cast ta buộc phải thêm để coalesce(...,'PUBLIC') — mới kéo
  --               thứ tự sang collation mặc định của database. COLLATE "C" ở đây CHỮA hệ quả
  --               của cast đó, không chữa một khiếm khuyết có sẵn. (Cách khác cùng hiệu lực:
  --               coalesce(r.rolname, 'PUBLIC'::name) — giữ nguyên kiểu `name`, khỏi cần COLLATE.)
  --
  --   [vòng fix 2 — I4] Ba hình dạng mà re-reviewer đo là "sản phẩm sẽ cần" đi qua ĐÂY, không
  --   qua HINH_DANG_CHUAN — đây là câu trả lời cho "hình dạng nào nên nằm sẵn trong danh sách
  --   gốc": chỉ hình dạng TỰ NÓ ràng buộc tenant mới được toàn cục.
  --     org_id = app_current_org_id() AND trang_thai <> 'NIEM_PHONG'  (đấu thầu kín)
  --       -> deparse: ((org_id = app_current_org_id()) AND (trang_thai <> 'NIEM_PHONG'::text))
  --     policy riêng FOR SELECT TO app_unseal USING (true)  -> deparse: true
  --       (dòng ngoại lệ khi ấy phải ghi lenh='r' và vai_tro='app_unseal': đổi policy đó sang
  --        FOR ALL hay sang TO app_api làm dòng này HẾT khớp và hardening chặn — đó chính là
  --        điều vòng 2 mô tả mà chưa thực hiện được)
  --     org_id kiểu DOMAIN trên uuid                        -> deparse: ((org_id)::uuid = ...)
  --   Cố ý KHÔNG khớp theo KHUÔN ("bắt đầu bằng hình dạng chuẩn rồi AND ..."): khớp khuôn là
  --   một phép so khớp chuỗi có cấu trúc, và bốn vòng liên tiếp trong dự án này cho thấy đó
  --   đúng là chỗ thứ tiếp theo lọt qua. Một dòng đủ-đối-tượng trong diff rẻ hơn nhiều.
  --   HÌNH DẠNG THỨ TƯ — policy AS RESTRICTIVE — KHÔNG cần dòng nào: xem CAU_POLICY_SAI.
  --
  --   BẬC TỰ DO CÒN LẠI, nói ra thay vì hứa suông: khoá vẫn KHÔNG phân biệt vế USING với vế
  --   WITH CHECK (một dòng duyệt biểu thức X duyệt nó ở CẢ HAI vế của đúng policy đó), và
  --   không xuống tới mức CỘT. Mỗi lần thu hẹp thêm một trục là một vòng nữa; đó là lý do
  --   file này nằm trong .github/CODEOWNERS với yêu cầu review bắt buộc — xem ghi chú ở đó.
  --
  --   Cả hai danh sách có meta-test khoá ở db/rls-coverage.int.test.ts — sửa một bên mà quên
  --   bên kia là ĐỎ.
  NGOAI_LE_HINH_DANG constant text :=
    $q$(VALUES ('', '', '', '', '', ''))
         AS g(bang, polname, lenh, vai_tro, pham_vi, bieu_thuc)$q$;

  -- Kết xuất danh sách role của một policy thành chuỗi so khớp được. Tách ra hằng riêng vì
  -- nó xuất hiện ở cả vế so khớp lẫn (tương lai) thông báo lỗi.
  BIEU_THUC_VAI_TRO constant text :=
    $q$array_to_string(ARRAY(
         SELECT coalesce(r.rolname::text, 'PUBLIC')
           FROM unnest(p.polroles) AS o(oid)
           LEFT JOIN pg_roles r ON r.oid = o.oid
          ORDER BY coalesce(r.rolname::text, 'PUBLIC') COLLATE "C"), ',')$q$;

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

  -- [vòng fix 3 — Minor] Tập bảng mà mục (A) phải bật ENABLE + FORCE. RỘNG HƠN "bảng tenant"
  -- ĐÚNG MỘT VẾ: con cháu (phân mảnh hoặc INHERITS) của một bảng tenant KỂ CẢ KHI NÓ NẰM Ở
  -- SCHEMA KHÁC 'public'. Vòng 2 gỡ bộ lọc nspname cho view/matview/SECDEF (I3-v2) nhưng GIỮ
  -- NGUYÊN cho bảng, và bất đối xứng đó đo được là một lỗ thật trên PostgreSQL 16.15:
  --     CREATE SCHEMA khac; CREATE TABLE khac.con_khac () INHERITS (public.bao_gia);
  --     GRANT SELECT ON khac.con_khac TO app_api; GRANT USAGE ON SCHEMA khac TO app_api;
  --       -> migrate() PASS, khac.con_khac có {relrowsecurity=false, relforcerowsecurity=false}
  --       -> app_api gắn tổ chức A đọc THẲNG khac.con_khac thấy 777, hàng của TỔ CHỨC B.
  -- Vế mở rộng cố ý CHỈ nằm ở mục (A) (bật cờ), KHÔNG ở VI_TU_BANG_TENANT: đổi định nghĩa
  -- "bảng tenant" kéo theo nguồn (i)/(ii) và mục (C), tức đòi mọi bảng có org_id ở MỌI schema
  -- phải có policy — một thay đổi thiết kế với bán kính nổ toàn repo, không thuộc vòng này.
  -- Vế hẹp này đủ để đóng đường rò: con vẫn được LA_CUA_BANG_TENANT miễn policy riêng (đúng
  -- khuôn PostgreSQL), còn đọc THẲNG con thì fail-closed vì RLS bật mà không policy nào cho
  -- phép. Đọc QUA CHA vẫn đúng.
  -- BẬC TỰ DO CÒN LẠI: bảng có org_id ở schema khác mà KHÔNG treo dưới một bảng tenant nào
  -- vẫn không được nhận diện. Tiền điều kiện của nó là DDL + GRANT tường minh do người của dự
  -- án viết; nói ra thay vì hứa suông.
  VI_TU_CAN_CO_RLS constant text :=
    $q$(( $q$ || VI_TU_BANG_TENANT || $q$ )
        OR (c.relkind IN ('r', 'p') AND $q$ || LA_CUA_BANG_TENANT || $q$))$q$;

  -- Mọi chỗ SAI KHUÔN về policy trên bảng tenant, mỗi hàng một mô tả đọc được. Hai nguồn:
  --   (i)  bảng tenant KHÔNG có policy PERMISSIVE nào — RLS bật mà không policy nào cho phép
  --        gì là "từ chối tất cả": fail-closed, an toàn về dữ liệu nhưng là sự cố sẵn sàng, và
  --        thường là dấu vết của một DROP POLICY (hoặc DROP FUNCTION ... CASCADE) sau triển khai.
  --        Lá phân mảnh được miễn — xem LA_CUA_BANG_TENANT ở trên.
  --   (ii) policy PERMISSIVE có mặt nhưng biểu thức KHÔNG nằm trong HINH_DANG_CHUAN lẫn
  --        NGOAI_LE_HINH_DANG của ĐÚNG (bảng, policy, lệnh, role) đó, hoặc thiếu vế bắt buộc.
  --
  -- [vòng fix 2 — I4 / vòng fix 3 — I4] Policy AS RESTRICTIVE KHÔNG bị soi ở nguồn (ii), KỂ CẢ
  -- vế "thiếu USING"/"thiếu WITH CHECK". Vòng 2 tuyên bố điều đó nhưng CHỈ thực hiện được cho
  -- nhánh thứ ba: hai nhánh "thiếu vế" không có `p.polpermissive`, nên bốn hình dạng
  -- RESTRICTIVE THƯỜNG GẶP NHẤT vẫn bị chặn. Đã đo trên PostgreSQL 16.15, TRƯỚC bản vá:
  --     AS RESTRICTIVE FOR ALL    USING (...)                  -> BLOCKED 'thiếu vế WITH CHECK'
  --     AS RESTRICTIVE FOR UPDATE USING (...)                  -> BLOCKED 'thiếu vế WITH CHECK'
  --     AS RESTRICTIVE FOR ALL    WITH CHECK (...)             -> BLOCKED 'thiếu vế USING'
  --     AS RESTRICTIVE FOR UPDATE WITH CHECK (...)             -> BLOCKED 'thiếu vế USING'
  --     (có ĐỦ hai vế, hoặc FOR INSERT, hoặc FOR SELECT        -> PASS)
  -- Nay `p.polpermissive` được NÂNG LÊN vế WHERE chung, nên cả ba nhánh cùng chỉ soi policy
  -- PERMISSIVE — một dòng thay vì ba, và nguồn (ii) ở trên nay MÔ TẢ ĐÚNG cái mã làm.
  -- Vì sao ĐÒI WITH CHECK ở policy PERMISSIVE mà KHÔNG đòi ở RESTRICTIVE: với policy
  -- PERMISSIVE, thiếu vế kiểm hàng mới nghĩa là dựa vào hành vi mặc định "dùng lại USING" —
  -- đúng nhưng ngầm, và biến mất ngay khi ai đó tách policy theo lệnh. Với RESTRICTIVE, thiếu
  -- một vế nghĩa là nó KHÔNG thu hẹp ở phía ấy: mất một lớp phòng thủ tuỳ chọn, không mở thêm
  -- một hàng nào.
  -- Lập luận nền, không phải khẩu vị: policy RESTRICTIVE được tổ hợp bằng AND với (OR của các
  -- policy PERMISSIVE), nên nó chỉ THU HẸP tập hàng nhìn thấy được. Và vế bảo vệ vẫn còn
  -- nguyên: nguồn (i) đòi PHẢI có ít nhất một policy PERMISSIVE, còn MỌI policy PERMISSIVE vẫn
  -- phải khớp danh sách. Đổi policy cách ly sang RESTRICTIVE để né phép kiểm sẽ làm bảng KHÔNG
  -- còn policy PERMISSIVE nào và bị nguồn (i) bắt — có test đo đường lách đó.
  -- BẬC TỰ DO CÒN LẠI, nói ra thay vì hứa suông: một policy RESTRICTIVE có thể là no-op
  -- (USING (true)) — không phải lỗ hổng nhưng cũng không phải phòng thủ; và biểu thức của nó
  -- gọi được hàm do người khác viết. Cả hai đòi quyền DDL trên bảng, tức tác nhân đã ở mức
  -- làm được việc tệ hơn.
  --
  -- [vòng fix 2 — CR2 / vòng fix 3 — I2] Vế "biểu thức có được duyệt không" hỏi HAI danh sách,
  -- và danh sách thứ hai khoá theo ĐÚNG (bang, polname, lenh, vai_tro) — xem NGOAI_LE_HINH_DANG.
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
          AND p.polpermissive
          AND ((p.polcmd <> 'a' AND p.polqual IS NULL)
               OR (p.polcmd IN ('*', 'a', 'w') AND p.polwithcheck IS NULL)
               OR (EXISTS (
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
                                AND g.lenh = p.polcmd::text
                                AND g.vai_tro = $q$ || BIEU_THUC_VAI_TRO || $q$
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

  -- ---- [T5] (D) SỔ KIỂM TOÁN CHỈ-GHI-THÊM — bất biến B4, nền cho B3 -------------------
  -- Task 5 dựng hai bảng sổ mà bảo đảm "không đường code nào xoá/sửa audit" nằm ở BA thứ chỉ
  -- được tạo MỘT LẦN trong 003_audit_events.sql: một hàm plpgsql, sáu trigger, và trạng thái
  -- ENABLE ALWAYS của sáu trigger đó. Cả ba đều là lớp trôi đã biết của dự án:
  --     CREATE OR REPLACE FUNCTION public.chan_sua_xoa() ... RETURN NEW;
  --       -> đã đo trên PostgreSQL 16.15: UPDATE 1 và TRUNCATE TABLE đi lọt, DELETE bị huỷ
  --          IM LẶNG (DELETE 0, không lỗi). Đúng khuôn R3 của app_current_org_id().
  --     DROP TRIGGER / ALTER TABLE ... DISABLE TRIGGER / ENABLE REPLICA TRIGGER
  --     CREATE OR REPLACE TRIGGER ... WHEN (false)  hoặc  BEFORE UPDATE OF <cột>
  --       -> cả bốn đã đo là chạy, và cả bốn giữ nguyên TÊN trigger nên một phép kiểm chỉ hỏi
  --          "trigger còn đó không" xanh hết.
  -- 003 đã nằm trong schema_migrations sau lần deploy đầu nên không có gì trở lại.
  --
  -- [vòng fix 1 — CR1/CR2/CR4/CR5] BỐN GIỚI HẠN TẦM NHÌN CỦA VÒNG TRƯỚC, VÀ CHÚNG LÀ MỘT LỖI
  -- ============================================================================
  -- Vòng trước canh SÁU CÁI TÊN TRIGGER NÓ BIẾT, trong SCHEMA public, trên relkind IN ('r','p'),
  -- và chỉ nổ khi MỘT bảng sổ mất. Mọi thứ ngoài bốn giới hạn đó nằm ngoài tầm nhìn của nó, trong
  -- khi 003 phát biểu BAO TRÙM rằng lớp C đưa trạng thái về đúng ở lần deploy kế tiếp. Bốn lỗ
  -- dưới đây là cùng một lỗ hổng nhận thức nhìn từ bốn phía, tất cả đã ĐO trên PostgreSQL 16.15:
  --
  --   [CR1] TRIGGER hoặc RULE **lạ** (tên khác sáu tên đã biết) NUỐT SỰ KIỆN AUDIT trong im lặng.
  --     CREATE TRIGGER aaa_nuot BEFORE INSERT ON audit_events FOR EACH ROW
  --       WHEN (NEW.action = 'MO_NIEM_PHONG') EXECUTE FUNCTION public.nuot_co_chon();  -- RETURN NULL
  --     -> app_api ghi sổ: sự kiện MO_NIEM_PHONG cho "INSERT 0 0" (BIẾN MẤT, KHÔNG LỖI), sự kiện
  --        kế cho "INSERT 0 1". seq liên tục 1,2,3 và prev_hash NỐI ĐÚNG đầu chuỗi.
  --     -> Bộ kiểm chứng chuỗi hash của Task 6 sẽ báo chuỗi HỢP LỆ trên một sổ ĐÃ BỊ KIỂM DUYỆT.
  --        Đây là cách XOÁ AUDIT VỀ TƯƠNG LAI, hiệu quả hơn xoá hàng vì nó không để lại lỗ hổng
  --        nào trong chuỗi. Khác hẳn ca "trigger tên đứng trước huỷ UPDATE/DELETE" (dữ liệu vẫn
  --        an toàn): đường BEFORE INSERT đạt đúng mục tiêu của kẻ tấn công mà không vi phạm chữ
  --        nghĩa của B4. "CREATE RULE r_ins AS ON INSERT TO audit_events DO INSTEAD NOTHING" cùng
  --        kết quả; đo được cả hai SỐNG SÓT qua nhiều lượt migrate() với "MIGRATE OK".
  --     Vì sao vòng trước mù: CTE `sai` là LEFT JOIN pg_trigger ON tgname = <một trong sáu tên>.
  --     Nó chỉ hỏi sáu cái tên nó biết, không bao giờ nhìn phần còn lại của bảng, và không ai hỏi
  --     pg_rewrite. Nay đảo sang MẶC ĐỊNH-ĐÓNG: trên bảng sổ, MỌI trigger không phải một trong
  --     sáu trigger bắt buộc là SAI, và MỌI rule khác '_RETURN' là SAI. Cùng khuôn "danh sách
  --     trắng thay danh sách đen" đã dùng cho hình dạng policy ở mục (B).
  --
  --   [CR2] Ba mặt của cùng một lỗ "bảng sổ không còn là bảng sổ", nay đóng bằng MỘT vị từ:
  --     (a) ALTER TABLE ... SET SCHEMA kho_toi cho CẢ HAI bảng -> hai to_regclass('public....')
  --         cùng NULL nên vế "một bảng còn, bảng kia mất" IM. Trigger đi theo bảng nên ở schema
  --         mới chủ sở hữu tự gỡ chúng rồi làm gì cũng được; trả bảng về public thì migrate() kế
  --         tiếp KHÔNG phát hiện gì và còn PHỤC HỒI VẺ NGOÀI NGUYÊN VẸN (pg_trigger sạch bong,
  --         tgenabled='A') cho một bảng ĐÃ BỊ VIẾT LẠI. Đo: DELETE 4 hàng + UPDATE seq -> MIGRATE OK.
  --     (b) DROP TABLE audit_events CASCADE; CREATE VIEW audit_events WITH (security_invoker=true)
  --         AS SELECT ... FROM audit_chain_anchors -> `bang_al` bỏ qua relkind='v' nên không phép
  --         kiểm trigger nào chạy, và to_regclass(...) IS NOT NULL nên vế "bảng mất" cũng im.
  --         Đo: sửa exit 0, phán xét exit 0, "SELECT count(*) FROM audit_events" -> 0, KHÔNG LỖI.
  --         BÁC BỎ lập luận của vòng trước ("mất cả hai bảng là sự cố ồn ào nhất có thể, mọi truy
  --         vấn sổ đều gãy"): chỉ cần mất MỘT bảng, và MỌI TRUY VẤN VẪN CHẠY — sổ chỉ TRÔNG NHƯ RỖNG.
  --     (c) DROP CẢ HAI bảng: vòng trước cố ý bỏ ngỏ với lý do "hậu điều kiện vô điều kiện sẽ đòi
  --         003 có mặt ở MỌI lược đồ và làm vỡ các test dùng thư mục migration rút gọn". Lý do đó
  --         chỉ đúng cho MỘT cách hiện thực. NEO VÀO schema_migrations thì không: migrate.ts tạo
  --         schema_migrations TRƯỚC lượt hardening đầu tiên nên vế canh đọc được nó, còn ở thư mục
  --         rút gọn (chỉ 001/002) không có dòng '003_*' nên vế canh NẰM IM. Đo lại: đúng như vậy.
  --     Vị từ mới đóng cả ba: bảng sổ phải tồn tại NHƯ MỘT BẢNG THẬT (relkind IN ('r','p')) TRONG
  --     schema public, và vế canh chỉ hoạt động khi CÒN một bảng sổ khác HOẶC 003 đã nằm trong
  --     schema_migrations.
  --
  --   [CR4] SUY BẢNG QUA TRIGGER KHÔNG ĐƯỢC PHÉP TỰ CHỮA. Vòng trước nhận diện bảng chỉ-ghi-thêm
  --     bằng "OR EXISTS (pg_trigger ... tgfoid = chan_sua_xoa)" rồi CROSS JOIN đủ BA sự kiện và
  --     tạo nốt những cái thiếu — nghĩa là MỘT trigger đủ để migrate() TỰ TAY ÁP ĐẶT CẢ BA. Kịch
  --     bản Task 7 hoàn toàn hợp lệ (bảng báo giá chống XOÁ nhưng vẫn cần UPDATE: nháp -> đã nộp)
  --     đo được là hỏng IM LẶNG: tạo bao_gia + CHỈ bao_gia_chan_delete -> migrate() MIGRATE OK,
  --     KHÔNG một NOTICE nào, nhưng migrate() TỰ THÊM bao_gia_chan_update -> UPDATE sau đó bị từ
  --     chối; DROP trigger đó rồi migrate() thì nó QUAY LẠI. Không có cửa NGOẠI_LỆ nào cho mục này.
  --     Điều đáng nói nhất: khối chú thích ngay dưới đây LOẠI BỎ cách suy "bảng có cột hash" với
  --     ĐÚNG lý do này, rồi chọn một cách suy có CÙNG chế độ hỏng, chỉ khác là IM LẶNG thay vì ỒN
  --     ÀO. Ồn ào còn sửa được; im lặng thì hỏng ở runtime production.
  --     Nay vế trigger CHỈ DÙNG ĐỂ PHÁN XÉT: vòng lặp sửa chỉ chạy trên bảng thuộc
  --     BANG_CHI_GHI_THEM, còn bảng lọt vào qua vế trigger thì BÁO LỖI kèm hướng dẫn. Mất một
  --     trigger vẫn bị bắt, mà không có chuyện migrate() TỰ ĐỔI NGỮ NGHĨA một bảng.
  --
  --   [CR5] ALTER TABLE ... SET UNLOGGED chạy được và KHÔNG lớp nào canh. Đo bằng SIGKILL postgres
  --     thật: trước-crash 4 hàng -> sau-crash 0 hàng (đối chứng bảng vẫn LOGGED: 4). Ba lớp đều
  --     trượt — lớp A vô can (không có DML), lớp B vô can (SET UNLOGGED đòi QUYỀN SỞ HỮU chứ không
  --     phải quyền ghi), lớp C không canh relpersistence. Hậu quả là MẤT DỮ LIỆU, không phải mất
  --     bảo vệ, và cửa sổ phơi là VĨNH VIỄN. Cùng lớp: DROP CONSTRAINT audit_events_org_id_seq_key
  --     làm chuỗi hash RẼ NHÁNH (đo: DROP OK -> INSERT trùng (org_id, seq=1) -> INSERT 0 1 ->
  --     hardening im lặng -> count = 2 cho cùng (org_id, seq)). Cả hai nay nằm trong mục (D3).
  --
  -- BANG_CHI_GHI_THEM — danh sách ĐÓNG, viết tay, nhân bản sang db/audit-append-only.int.test.ts
  -- (có meta-test canh sự đồng bộ, cùng khuôn BANG_GOC_TENANT).
  -- Vì sao KHÔNG suy ra tự động như mục (A) suy ra bảng tenant từ cột org_id — ba cách đã cân
  -- nhắc và loại:
  --   * "bảng có cột hash/prev_hash": Task 6-10 sẽ có bảng báo giá mang hash mà VẪN cần UPDATE.
  --     Suy sai theo hướng đó là CHẶN DEPLOY trên một lược đồ hợp lệ — đúng cái bẫy mà QT1 cấm.
  --   * "bảng mang COMMENT có nhãn": nhãn do chính tác nhân đang bị canh sửa được -> fail-open.
  --   * "bảng đang có trigger chan_sua_xoa()": CÓ dùng (nhánh trong_ds = false của bang_al bên
  --     dưới) nhưng CHỈ ĐỂ PHÁN XÉT, không để tự chữa — xem [CR4]. Hợp hai nguồn thì mất MỘT
  --     trigger vẫn còn hai trigger kia lộ ra bảng, mà mất CẢ SÁU thì danh sách viết tay lộ ra.
  -- ĐÁNH ĐỔI CỦA VIỆC BỎ KHOÁ CỨNG nspname = 'public', nói ra thay vì để người đọc tự phát hiện:
  -- một bảng tên 'audit_events' ở BẤT KỲ schema nào cũng bị nhận là bảng sổ và bị cưỡng chế sáu
  -- trigger. Đó là cái giá phải trả để nhìn thấy SET SCHEMA (CR2a) — không có cách nào canh được
  -- một bảng vừa bị đẩy đi mà lại chỉ nhìn schema cũ. Hai cái tên trong danh sách là tên riêng
  -- của dự án, nên va chạm là chuyện có thể sống chung; nếu một task sau cần một bảng khác trùng
  -- tên ở schema khác thì đó là một quyết định phải nhìn thấy được, và chỗ sửa là danh sách này.
  BANG_CHI_GHI_THEM constant text :=
    $q$(VALUES ('audit_events'), ('audit_chain_anchors')) AS b(ten)$q$;

  HAM_CHAN constant text := $q$to_regprocedure('public.chan_sua_xoa()')$q$;

  -- [Task 6] Trigger NỐI CHUỖI của 004_audit_chain_functions.sql. Nó là trigger THỨ BẢY trên
  -- bảng sổ, và mặc định-ĐÓNG của [CR1] gỡ MỌI trigger không nằm trong `can_co` — nên nếu danh
  -- sách này không được mở rộng ở đây thì lượt 'sua' sẽ gỡ nó ở lần migrate() kế, trong khi 004
  -- đã nằm trong schema_migrations nên không bao giờ chạy lại: migration bốc hơi VĨNH VIỄN. Đó
  -- chính là chế độ hỏng mà WARNING "đã GỠ trigger lạ" ở mục (D2) mô tả.
  -- Nó CHỈ áp cho `audit_events`, không áp cho `audit_chain_anchors`: bảng neo không mang chuỗi
  -- hash nào để nối. Vì thế nó là một nhánh RIÊNG chứ không phải một dòng thêm vào CROSS JOIN
  -- ba-sự-kiện — CROSS JOIN sẽ đòi cả `audit_chain_anchors_noi_chuoi` lẫn
  -- `<bảng lạ>_noi_chuoi` cho mọi bảng lọt vào qua vế trigger, tức chặn deploy trên lược đồ đúng.
  HAM_NOI_CHUOI constant text := $q$to_regprocedure('public.noi_chuoi_kiem_toan()')$q$;
  BANG_NOI_CHUOI constant text := $q$('audit_events')$q$;

  -- Thân hàm băm. Bản NGUỒN nằm ở db/migrations/004_audit_chain_functions.sql.
  -- Vì sao nó PHẢI được cưỡng chế, và vì sao nó là mục quan trọng nhất mà Task 6 thêm vào file
  -- này: bộ kiểm chứng chuỗi TÍNH LẠI băm BẰNG CHÍNH HÀM NÀY (đó là điều loại bỏ lớp lỗi lệch
  -- tuần tự hoá giữa hai tầng). Hệ quả là nếu ai đó thay thân hàm — ví dụ
  --     CREATE OR REPLACE FUNCTION public.audit_compute_hash(...) ... SELECT sha256(''::bytea);
  -- thì MỌI hàng cũ lẫn mới đều băm ra cùng một giá trị, chuỗi vẫn "khớp" ở mọi mắt xích, và bộ
  -- kiểm chứng báo HỢP LỆ trên một sổ mà nội dung không còn bị ràng buộc bởi băm nào cả. KHÔNG
  -- lớp nào khác trong dự án bắt được ca đó: trigger vẫn đúng tên, đúng hàm, đúng tgtype.
  THAN_BAM constant text := $tbm$
  SELECT pg_catalog.sha256(
    p_prev_hash OPERATOR(pg_catalog.||) pg_catalog.convert_to(
      (pg_catalog.jsonb_build_object(
        'v',             'trustprocure.audit.v1',
        'org_id',        p_org_id,
        'seq',           p_seq,
        'occurred_at',   pg_catalog.to_char(p_occurred_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'actor_type',    p_actor_type,
        'actor_id',      p_actor_id,
        'action',        p_action,
        'resource_type', p_resource_type,
        'resource_id',   p_resource_id,
        'payload',       p_payload,
        'request_id',    p_request_id
      ))::pg_catalog.text,
      'UTF8'
    )
  )
$tbm$;

  -- Chữ ký đầy đủ, dùng lại ở cả câu cưỡng chế lẫn hậu điều kiện. Viết một lần để hai bên không
  -- trôi khỏi nhau.
  CHU_KY_BAM constant text :=
    $q$public.audit_compute_hash(bytea, uuid, bigint, timestamptz, text, uuid, text, text, uuid, jsonb, uuid)$q$;
  THAM_SO_BAM constant text :=
    $q$(p_prev_hash bytea, p_org_id uuid, p_seq bigint, p_occurred_at timestamptz,
        p_actor_type text, p_actor_id uuid, p_action text, p_resource_type text,
        p_resource_id uuid, p_payload jsonb, p_request_id uuid)$q$;

  -- Thân hàm nối chuỗi. Bản NGUỒN nằm ở db/migrations/004_audit_chain_functions.sql; hai bản
  -- phải khớp nhau sau khi chuẩn hoá khoảng trắng, và db/than-ham-trigger.test.ts canh việc đó
  -- (cùng khuôn §R3 đã dùng cho public.chan_sua_xoa()). Thân hàm cố ý KHÔNG mang chú thích: hậu
  -- điều kiện so prosrc theo văn bản, nên mọi chú thích phải nằm NGOÀI $tnc$ ở cả hai file.
  THAN_NOI_CHUOI constant text := $tnc$
DECLARE
  bam_truoc bytea;
  so_thu_tu bigint;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 0));

  SELECT ae.seq, ae.hash INTO so_thu_tu, bam_truoc
    FROM public.audit_events ae
   WHERE ae.org_id = NEW.org_id
   ORDER BY ae.seq DESC
   LIMIT 1;

  IF so_thu_tu IS NULL THEN
    so_thu_tu := 1;
    bam_truoc := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  ELSE
    so_thu_tu := so_thu_tu + 1;
  END IF;

  NEW.occurred_at := pg_catalog.clock_timestamp();
  NEW.payload     := coalesce(NEW.payload, '{}'::pg_catalog.jsonb);
  NEW.seq         := so_thu_tu;
  NEW.prev_hash   := bam_truoc;
  NEW.hash        := public.audit_compute_hash(
                       NEW.prev_hash, NEW.org_id, NEW.seq, NEW.occurred_at, NEW.actor_type,
                       NEW.actor_id, NEW.action, NEW.resource_type, NEW.resource_id,
                       NEW.payload, NEW.request_id);
  RETURN NEW;
END
$tnc$;

  -- Bộ lọc "schema do dự án quản" — DÙNG LẠI đúng bộ lọc của mục (C), không phát minh lại.
  -- %1$s = bí danh pg_namespace. "%%" là dấu % thật sau khi qua format().
  MAU_SCHEMA_DU_AN constant text :=
    $q$%1$s.nspname NOT IN ('pg_catalog', 'information_schema')
       AND %1$s.nspname NOT LIKE 'pg\_toast%%' AND %1$s.nspname NOT LIKE 'pg\_temp%%'$q$;

  -- [CR2c] NEO cho vế "bảng sổ biến mất": 003 đã từng chạy trên lược đồ này chưa.
  -- Phải quyết định Ở ĐÂY (lúc DECLARE) chứ không phải trong câu SQL: PostgreSQL PHÂN TÍCH cả
  -- câu lệnh trước khi chạy, nên một tham chiếu tĩnh tới public.schema_migrations sẽ ném 42P01
  -- trên lược đồ chưa có bảng đó — "bọc bằng to_regclass(...) IS NOT NULL" KHÔNG cứu được, vì
  -- lỗi xảy ra ở thì phân tích chứ không ở thì chạy. Đã đo. Ghi đủ pg_catalog. theo QT3 vì dòng
  -- này chạy TRƯỚC khối ghim search_path trong thân DO.
  NEO_003 constant text :=
    CASE WHEN pg_catalog.to_regclass('public.schema_migrations') IS NULL THEN $q$false$q$
         ELSE $q$EXISTS (SELECT 1 FROM public.schema_migrations sm
                          WHERE sm.version LIKE '003\_audit\_events%')$q$
    END;

  -- Tập trigger PHẢI CÓ, và chỗ nào đang sai. `kieu` là pg_trigger.tgtype — bitmask
  -- (ROW=1, BEFORE=2, DELETE=8, UPDATE=16, TRUNCATE=32) đã ĐO trên PostgreSQL 16.15:
  --   BEFORE UPDATE FOR EACH ROW = 19 · BEFORE DELETE FOR EACH ROW = 11 ·
  --   BEFORE TRUNCATE FOR EACH STATEMENT = 34.
  -- So khớp tgtype NGUYÊN VĂN (không phải "có bit UPDATE") vì mọi bit đều load-bearing: mất
  -- bit BEFORE là trigger chạy SAU khi hàng đã đổi, mất bit ROW là trigger không thấy hàng.
  -- tgattr và tgqual phải trống: cả hai là đường vô hiệu hoá giữ nguyên tên trigger.
  --
  -- `bang_so` (bảng sổ THẬT, nhận theo tên, ở MỌI schema của dự án) tách khỏi `bang_al` (bang_so
  -- HỢP bảng lạ đang mang trigger chan_sua_xoa()). Chỉ `bang_so` được TỰ CHỮA — xem [CR4].
  CTE_TRIGGER_CHAN constant text :=
    $q$WITH bang_so AS (
         SELECT c.oid AS bang_oid, n.nspname, c.relname, c.relpersistence, c.relowner
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p')
            AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
            AND c.relname IN (SELECT ten FROM $q$ || BANG_CHI_GHI_THEM || $q$)
       ),
       bang_al AS (
         SELECT bang_oid, relname, true AS trong_ds FROM bang_so
         UNION ALL
         SELECT c.oid, c.relname, false
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p')
            AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
            AND c.relname NOT IN (SELECT ten FROM $q$ || BANG_CHI_GHI_THEM || $q$)
            AND EXISTS (SELECT 1 FROM pg_trigger tg
                         WHERE tg.tgrelid = c.oid AND NOT tg.tgisinternal
                           AND tg.tgfoid = $q$ || HAM_CHAN || $q$)
       ),
       can_co AS (
         SELECT b.bang_oid, b.relname, b.trong_ds,
                b.relname || '_chan_' || v.hau_to AS ten_trigger,
                v.su_kien, v.pham_vi, v.kieu,
                $q$ || HAM_CHAN || $q$ AS ham_oid,
                'public.chan_sua_xoa()' AS ten_ham
           FROM bang_al b
           CROSS JOIN (VALUES ('update',   'UPDATE',   'FOR EACH ROW',       19),
                              ('delete',   'DELETE',   'FOR EACH ROW',       11),
                              ('truncate', 'TRUNCATE', 'FOR EACH STATEMENT', 34))
                        AS v(hau_to, su_kien, pham_vi, kieu)
         UNION ALL
         -- [Task 6] Trigger nối chuỗi, CHỈ trên audit_events. tgtype = 7 đã ĐO trên PostgreSQL
         -- 16.15 cho BEFORE INSERT FOR EACH ROW (ROW=1 | BEFORE=2 | INSERT=4), cùng khuôn
         -- "so tgtype NGUYÊN VĂN" của ba trigger trên: mất bit BEFORE là trigger chạy SAU khi
         -- hàng đã vào bảng nên nó không đặt được seq/hash nữa.
         SELECT b.bang_oid, b.relname, b.trong_ds,
                b.relname || '_noi_chuoi', 'INSERT', 'FOR EACH ROW', 7,
                $q$ || HAM_NOI_CHUOI || $q$, 'public.noi_chuoi_kiem_toan()'
           FROM bang_al b
          WHERE b.relname IN $q$ || BANG_NOI_CHUOI || $q$
       ),
       sai AS (
         SELECT k.*,
                CASE
                  WHEN t.oid IS NULL THEN 'trigger KHÔNG TỒN TẠI'
                  WHEN t.tgfoid <> k.ham_oid
                    THEN 'gọi hàm khác: ' || t.tgfoid::regprocedure::text
                         || ' (cần ' || k.ten_ham || ')'
                  -- [vòng fix 1 — CR3] tgconstraint <> 0 phải có TÊN GỌI RIÊNG, và phải đứng
                  -- TRƯỚC vế tgtype: một constraint trigger cũng sai tgtype (nó chỉ có AFTER —
                  -- "CREATE CONSTRAINT TRIGGER ... BEFORE" là syntax error, đã đo) nên nếu không
                  -- có vế này thì trạng thái nguy hiểm nhất của mục (D2) lại bị báo dưới một cái
                  -- tên sai. Nó nguy hiểm vì chính CÂU LỆNH TỰ CHỮA đụng vào nó: CREATE OR REPLACE
                  -- TRIGGER trên một cái tên đang thuộc constraint trigger ném 42710.
                  WHEN t.tgconstraint <> 0
                    THEN 'là CONSTRAINT TRIGGER (tgconstraint=' || t.tgconstraint::text
                         || ') — constraint trigger CHỈ CÓ AFTER nên nó không chặn được gì, và '
                         || 'nó chặn luôn CREATE OR REPLACE TRIGGER cùng tên'
                  WHEN t.tgtype <> k.kieu::smallint
                    THEN 'sai thời điểm/sự kiện/phạm vi (tgtype=' || t.tgtype::text
                         || ', cần ' || k.kieu::text || ')'
                  WHEN t.tgqual IS NOT NULL
                    THEN 'có mệnh đề WHEN — trigger chỉ chạy có điều kiện'
                  WHEN t.tgattr::text <> ''
                    THEN 'có UPDATE OF <cột> — chỉ chạy khi cột đó nằm trong mệnh đề SET'
                  WHEN t.tgenabled <> 'A'
                    -- ::text bắt buộc: tgenabled có kiểu "char", và 'chuỗi' || "char" là
                    -- toán tử KHÔNG duy nhất ("operator is not unique: unknown || \"char\"").
                    THEN 'tgenabled=' || t.tgenabled::text
                         || ' (cần A = ENABLE ALWAYS; O bị bỏ qua khi '
                         || 'session_replication_role = replica, D và R thì không chạy)'
                  ELSE NULL
                END AS ly_do
           FROM can_co k
           LEFT JOIN pg_trigger t
                  ON t.tgrelid = k.bang_oid AND t.tgname = k.ten_trigger
                 AND NOT t.tgisinternal
       )$q$;

  -- Trigger LẠ / RULE trên bảng sổ, dùng chung cho hậu điều kiện và cho vòng lặp cưỡng chế.
  -- tgparentid = 0 loại BẢN SAO trigger trên phân mảnh: bản sao mang tên của trigger CHA nên nó
  -- không khớp can_co của LÁ, mà "DROP TRIGGER" trên nó bị PostgreSQL từ chối ("cannot drop
  -- trigger ... because it is a child") — tức một câu lệnh cưỡng chế ném lỗi KHÁC 42501, đúng
  -- lớp lỗi mà [CR3] vừa phải đóng. Trigger cha thì vẫn bị soi bình thường.
  CAU_TRIGGER_LA constant text :=
    $q$SELECT b.bang_oid, b.relname, t.tgname AS ten
         FROM bang_so b JOIN pg_trigger t ON t.tgrelid = b.bang_oid
        WHERE NOT t.tgisinternal AND t.tgparentid = 0
          AND t.tgname NOT IN (SELECT k.ten_trigger FROM can_co k
                                WHERE k.bang_oid = b.bang_oid)$q$;

  CAU_RULE_LA constant text :=
    $q$SELECT b.bang_oid, b.relname, rw.rulename::text AS ten
         FROM bang_so b JOIN pg_rewrite rw ON rw.ev_class = b.bang_oid
        WHERE rw.rulename <> '_RETURN'$q$;

  -- [vòng fix 2 — I3] Mọi thông báo dưới đây gọi bảng bằng bang_oid::regclass, KHÔNG bằng
  -- relname. Bỏ khoá cứng nspname='public' ([CR2a]) làm `bang_so` nhận bảng ở MỌI schema, nên
  -- relname trần biến một thông báo thành CÂU ĐỐ: đo được với
  -- "CREATE SCHEMA bao_cao AUTHORIZATION nguoi_khac; CREATE TABLE bao_cao.audit_events (...)"
  -- -> migrate() gãy với "(audit_events.audit_events_chan_update: ...)" mà KHÔNG có chữ
  -- "bao_cao" ở đâu cả, trong khi WARNING đi kèm lại nói "permission denied for schema
  -- bao_cao". regclass in ra tên đủ điều kiện khi schema không nằm trong search_path, và
  -- search_path của khối này được ghim là 'pg_catalog, public' nên bảng trong public vẫn in
  -- ra tên trần. Việc CÓ NÊN tự chữa trên một bảng không thuộc sở hữu hay không là một quyết
  -- định THIẾT KẾ (nó chặn deploy vĩnh viễn với đúng hồ sơ vai deploy) — ghi vào sổ nợ, KHÔNG
  -- vá ở đây; xem câu trả lời QT1 cho ca này trong task-5-report.md §"Vòng fix 2".
  CAU_TRIGGER_CHAN_SAI constant text :=
    CTE_TRIGGER_CHAN || $q$
     SELECT bang_oid::regclass::text || '.' || ten_trigger || ': ' || ly_do
            || CASE WHEN trong_ds THEN ''
                    ELSE ' [bảng này KHÔNG có trong BANG_CHI_GHI_THEM nên hardening CHỈ PHÁN '
                         'XÉT, KHÔNG tự tạo trigger cho nó — xem [CR4]. Đường sửa: thêm tên bảng '
                         'vào BANG_CHI_GHI_THEM nếu nó thật sự chỉ-ghi-thêm, hoặc gỡ trigger gọi '
                         'public.chan_sua_xoa() khỏi nó nếu không. Một bảng muốn chống XOÁ mà vẫn '
                         'cần UPDATE phải dùng một hàm trigger KHÁC chan_sua_xoa()]'
               END AS mo_ta
       FROM sai WHERE ly_do IS NOT NULL
     UNION ALL
     -- [CR1] Trigger LẠ trên bảng sổ: mặc định-ĐÓNG, không phải danh sách sáu tên.
     SELECT t.bang_oid::regclass::text || '.' || t.ten || ': TRIGGER LẠ trên bảng sổ — một trigger BEFORE INSERT '
            'trả NULL nuốt sự kiện audit trong IM LẶNG và để lại một chuỗi hash LIỀN MẠCH MÀ '
            'THIẾU SỰ KIỆN. Chỉ những trigger trong danh sách can_co (sáu trigger chỉ-ghi-thêm, cộng '
            'audit_events_noi_chuoi của 004) được phép tồn tại trên bảng sổ.' AS mo_ta
       FROM ($q$ || CAU_TRIGGER_LA || $q$) t
     UNION ALL
     -- [CR1] RULE trên bảng sổ. '_RETURN' là rule của VIEW; bang_so chỉ nhận relkind r/p nên nó
     -- không xuất hiện ở đây, vẫn loại tường minh để vế này không bao giờ tự bắn vào chân.
     SELECT rl.bang_oid::regclass::text || '.' || rl.ten || ': RULE trên bảng sổ — "DO INSTEAD NOTHING" trên INSERT '
            'nuốt sự kiện audit trong IM LẶNG (đo: INSERT 0 0, không lỗi).' AS mo_ta
       FROM ($q$ || CAU_RULE_LA || $q$) rl
     UNION ALL
     -- [CR2] MỘT vị từ cho ba ca: mất một bảng, mất cả hai, và bị thay bằng VIEW.
     -- [vòng fix 2 — I3] Vế NÀY là vế DUY NHẤT không đổi sang regclass, và không đổi được:
     -- nó nói về một bảng KHÔNG TỒN TẠI trong public nên không có oid nào để in ra. Thông báo
     -- đã nêu tường minh "trong schema public" nên nó vẫn không mơ hồ.
     SELECT b.ten || ': bảng sổ chỉ-ghi-thêm KHÔNG TỒN TẠI như một BẢNG THẬT (relkind r/p) trong '
            'schema public — nó đã bị DROP, bị ALTER TABLE ... SET SCHEMA đẩy đi, hoặc bị thay '
            'bằng một VIEW cùng tên. Sửa bằng một migration mới.' AS mo_ta
       FROM $q$ || BANG_CHI_GHI_THEM || $q$
      WHERE NOT EXISTS (SELECT 1 FROM bang_so bs
                         WHERE bs.relname = b.ten AND bs.nspname = 'public')
        AND (EXISTS (SELECT 1 FROM bang_so) OR $q$ || NEO_003 || $q$)$q$;

  -- [CR5 + IM5] Trạng thái VẬT LÝ của bảng sổ: LOGGED, và ràng buộc UNIQUE (org_id, seq).
  CAU_BANG_SO_VAT_LY constant text :=
    CTE_TRIGGER_CHAN || $q$
     SELECT b.bang_oid::regclass::text || ': bảng sổ đang UNLOGGED (relpersistence=' || b.relpersistence::text
            || ') — MỌI hàng audit biến mất sau lần crash kế tiếp. Đã đo bằng SIGKILL postgres '
            'thật: trước-crash 4 hàng, sau-crash 0 hàng.' AS mo_ta
       FROM bang_so b WHERE b.relpersistence <> 'p'
     UNION ALL
     SELECT b.bang_oid::regclass::text || ': thiếu ràng buộc UNIQUE (org_id, seq) — không có nó thì hai hàng cùng '
            '(org_id, seq) cùng tồn tại được và chuỗi hash RẼ NHÁNH trong im lặng (nền của B3).'
            AS mo_ta
       FROM bang_so b
      WHERE NOT EXISTS (
              SELECT 1 FROM pg_constraint con
               WHERE con.conrelid = b.bang_oid AND con.contype = 'u'
                 AND con.conkey = ARRAY[
                       (SELECT a.attnum FROM pg_attribute a
                         WHERE a.attrelid = b.bang_oid AND a.attname = 'org_id'
                           AND a.attnum > 0 AND NOT a.attisdropped),
                       (SELECT a.attnum FROM pg_attribute a
                         WHERE a.attrelid = b.bang_oid AND a.attname = 'seq'
                           AND a.attnum > 0 AND NOT a.attisdropped)])$q$;

  -- [IM2] ACL của bảng sổ. Vòng trước CỐ Ý không canh lớp này, với lý do "lớp REVOKE chỉ mua một
  -- câu lệnh dừng sớm hơn". Lý do đó đo được là SAI: trong đúng cửa sổ phơi mà 003 thừa nhận
  -- (DISABLE TRIGGER audit_events_chan_delete), lớp B là lớp DUY NHẤT còn đứng —
  -- "app_api_login DELETE -> permission denied for table audit_events". Và hậu quả của việc không
  -- canh cũng đo được: "GRANT DELETE, UPDATE ON audit_events TO app_api" -> app_api_login xoá
  -- được ba hàng audit -> migrate() báo MIGRATE OK -> GRANT của kẻ tấn công SỐNG QUA MỌI DEPLOY.
  -- Quyền cần để tự chữa đúng bằng mục (D2) đã đòi (sở hữu bảng), nên nó không thêm hàng rào
  -- deploy nào. Cột: attacl chỉ lưu được SELECT/INSERT/UPDATE/REFERENCES nên mức cột chỉ cấm UPDATE.
  -- Bí danh pg_roles viết là `vai`, KHÔNG phải `r`: câu này được nhúng vào một khối plpgsql có
  -- biến vòng lặp tên `r`, và plpgsql thay tên biến vào TRƯỚC khi PostgreSQL phân giải bí danh
  -- SQL. Đã tự vấp: bí danh `r` cho ra "record \"r\" is not assigned yet" (55000) — và chính
  -- WHEN OTHERS của BƯỚC 2 (bản vá CR3) là thứ giữ cho lỗi đó không kéo sập cả lượt sửa.
  CAU_QUYEN_BANG_SO_SAI constant text :=
    $q$SELECT b.bang_oid, b.relname, a.privilege_type AS quyen, NULL::text AS cot,
              CASE WHEN vai.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(vai.rolname) END AS ai
         FROM bang_so b JOIN pg_class c ON c.oid = b.bang_oid
         CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         LEFT JOIN pg_roles vai ON vai.oid = a.grantee
        WHERE a.grantee <> c.relowner
          AND a.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
       UNION ALL
       SELECT b.bang_oid, b.relname, a.privilege_type, att.attname::text,
              CASE WHEN vai.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(vai.rolname) END
         FROM bang_so b JOIN pg_class c ON c.oid = b.bang_oid
         JOIN pg_attribute att ON att.attrelid = b.bang_oid AND att.attnum > 0
                              AND NOT att.attisdropped
         CROSS JOIN LATERAL aclexplode(att.attacl) a
         LEFT JOIN pg_roles vai ON vai.oid = a.grantee
        WHERE a.grantee <> c.relowner AND a.privilege_type = 'UPDATE'$q$;

  CAU_QUYEN_BANG_SO_MO_TA constant text :=
    CTE_TRIGGER_CHAN || $q$
     SELECT q.bang_oid::regclass::text || ': quyền ' || q.quyen || ' cấp cho ' || q.ai
            || coalesce(' trên cột ' || q.cot, '')
            || ' — bảng sổ chỉ được cấp SELECT và INSERT' AS mo_ta
       FROM ($q$ || CAU_QUYEN_BANG_SO_SAI || $q$) q$q$;

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
              WHERE $q$ || VI_TU_CAN_CO_RLS || $q$
                AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
           LOOP
             EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', ten_bang);
             EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', ten_bang);
           END LOOP;
         END
         $rls$$q$,
      $q$NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE $q$ || VI_TU_CAN_CO_RLS || $q$
                        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity))$q$,
      $q$(SELECT string_agg(n.nspname || '.' || c.relname || ' (enable=' || c.relrowsecurity::text
                            || ', force=' || c.relforcerowsecurity::text || ')', ', ')
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE $q$ || VI_TU_CAN_CO_RLS || $q$
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
      $q$viết một migration mới sửa policy (lượt 1 không phán xét nên migrate() luôn chạy tới được nó), HOẶC — nếu hình dạng đó là hợp lệ cho ĐÚNG bảng, policy, LỆNH và ROLE này — thêm một dòng (bang, polname, lenh, vai_tro, pham_vi, bieu_thuc) vào NGOAI_LE_HINH_DANG trong chính file này kèm cập nhật meta-test khoá danh sách đó. Mỗi dòng thêm vào cửa là một quyết định an ninh không máy nào phán xử hộ được — file này nằm trong .github/CODEOWNERS và đòi review bắt buộc$q$
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
    ],

    -- ---- [T5] (D) Sổ kiểm toán chỉ-ghi-thêm: thân hàm + trigger + vật lý + quyền ---------
    -- Thân hàm PHẢI khớp bản trong 003_audit_events.sql. Sửa một bên thì sửa cả hai; có test
    -- canh việc đó (db/audit-append-only.int.test.ts), đúng khuôn §R3.
    --
    -- [vòng fix 1 — CR3] Câu lệnh cưỡng chế bọc trong một khối DO để DROP FUNCTION CÓ ĐIỀU KIỆN
    -- trước khi CREATE OR REPLACE. Lý do đo được: "DROP FUNCTION + CREATE FUNCTION
    -- public.chan_sua_xoa() RETURNS void" làm câu CREATE OR REPLACE ở đây ném "cannot change
    -- return type of existing function" — một lỗi KHÁC 42501 ở BƯỚC 2. Vế điều kiện
    -- (prorettype <> trigger) là bắt buộc: DROP vô điều kiện sẽ ném khi sáu trigger đang phụ
    -- thuộc vào hàm, tức đổi một chế độ hỏng lấy một chế độ hỏng khác.
    -- [vòng fix 1 — IM3] Ai sửa được: đo dưới ĐÚNG hồ sơ vai deploy (CREATEROLE + chủ sở hữu
    -- database, KHÔNG superuser), proowner của hàm này là CHÍNH role deploy — nó do lượt SỬA của
    -- file này tạo ra, không phải do "lần bootstrap bằng superuser" như 003 từng viết. Nên mục
    -- này TỰ CHỮA trong kịch bản vận hành thật. NGOẠI LỆ đã đo: nếu ai đó chạy
    -- "ALTER FUNCTION public.chan_sua_xoa() OWNER TO postgres", CREATE OR REPLACE dưới role
    -- deploy trả "must be owner of function" (42501, bị BƯỚC 2 nuốt) và mục này KHÔNG còn tự
    -- chữa — CREATE OR REPLACE trên một hàm ĐÃ TỒN TẠI đòi QUYỀN SỞ HỮU, không phải CREATE trên
    -- schema. Khi đó đường sửa là ALTER FUNCTION ... OWNER TO <role deploy> bằng superuser.
    ARRAY[
      $q$định nghĩa hàm public.chan_sua_xoa()$q$,
      $q$true$q$,
      $q$DO $fn$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.chan_sua_xoa()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.chan_sua_xoa();
           END IF;
           CREATE OR REPLACE FUNCTION public.chan_sua_xoa() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
BEGIN
  RAISE EXCEPTION 'Bảng % là bảng chỉ-ghi-thêm (append-only): thao tác % bị từ chối',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$ham$;
         END
         $fn$$q$,
      -- proconfig được canh vì mệnh đề "SET search_path = pg_catalog" là bản vá QT3 của hàm
      -- này: gỡ nó ra thì thân hàm lại chạy dưới search_path của phiên gọi.
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN RAISE EXCEPTION 'Bảng % là bảng chỉ-ghi-thêm (append-only): thao tác % bị từ chối', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege'; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.chan_sua_xoa()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.chan_sua_xoa()')),
                  'hàm public.chan_sua_xoa() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.chan_sua_xoa() (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- ---- [Task 6] (D1a) Định nghĩa public.audit_compute_hash(...) -----------------------
    -- Xem lập luận đo được ở khối chú thích của hằng THAN_BAM: đây là mục DUY NHẤT ràng buộc
    -- được ý nghĩa của chuỗi hash. Nó phải đứng TRƯỚC (D1b) và (D2) trong bảng vì hàm nối chuỗi
    -- gọi nó, và trên một database đã có 003 mà chưa có 004, lượt 'sua' dựng cả ba theo đúng thứ
    -- tự này.
    -- [QT1 — ai sửa được] Giống (D1): proowner là role deploy, tự chữa ở lần deploy kế; ngoại lệ
    -- duy nhất là hàm bị đổi chủ sang một role khác (42501, phải dùng superuser để ALTER OWNER).
    -- [QT1 — ném được lỗi gì ngoài 42501] (a) 42P13 "cannot change return type" nếu ai đó thay
    -- bằng hàm CÙNG CHỮ KÝ mà khác kiểu trả về — đóng bằng DROP có điều kiện đứng trước;
    -- (b) 2BP01 nếu DROP chạy khi trigger còn phụ thuộc — không xảy ra, vế điều kiện loại đúng
    -- ca đó; (c) 42883 không xảy ra vì DROP đi kèm to_regprocedure(...) IS NOT NULL. Một hàm
    -- TRÙNG TÊN nhưng KHÁC chữ ký là một hàm khác hẳn với PostgreSQL, nên nó rơi vào vế
    -- "trigger lạ"/"hàm lạ" chứ không vào đây — hạn chế này được ghi vào báo cáo, không vá ở đây.
    ARRAY[
      $q$định nghĩa hàm public.audit_compute_hash(...)$q$,
      $q$true$q$,
      $q$DO $fn$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure($ck$$q$ || CHU_KY_BAM || $q$$ck$)
                         AND p.prorettype <> 'pg_catalog.bytea'::regtype) THEN
             DROP FUNCTION $q$ || CHU_KY_BAM || $q$;
           END IF;
           CREATE OR REPLACE FUNCTION public.audit_compute_hash$q$ || THAM_SO_BAM || $q$
           RETURNS bytea
           LANGUAGE sql
           IMMUTABLE
           SET search_path = pg_catalog
           SET DateStyle = 'ISO, YMD'
           SET TimeZone = 'UTC'
           SET lc_time = 'C'
           AS $tbm$$q$ || THAN_BAM || $q$$tbm$;
         END
         $fn$$q$,
      -- provolatile = 'i' và proconfig được canh NGUYÊN VĂN: ba mệnh đề SET là bản vá QT2 của hàm
      -- này (to_char/convert_to/jsonb_build_object đều STABLE — đã đo provolatile), nên gỡ một
      -- mệnh đề ra là biến một hàm tất định thành một hàm phụ thuộc GUC của phiên gọi.
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = btrim(regexp_replace($q$ || pg_catalog.quote_literal(THAN_BAM) || $q$, '\s+', ' ', 'g'))
            AND p.prosecdef IS FALSE
            AND p.provolatile = 'i'
            AND p.proconfig = ARRAY['search_path=pg_catalog', 'DateStyle=ISO, YMD',
                                    'TimeZone=UTC', 'lc_time=C']
            AND p.pronargs = 11
            AND p.prorettype = 'pg_catalog.bytea'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
           FROM pg_proc p WHERE p.oid = to_regprocedure($ck$$q$ || CHU_KY_BAM || $q$$ck$))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | volatile=' || p.provolatile::text
                          || ' secdef=' || p.prosecdef::text
                          || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                    FROM pg_proc p WHERE p.oid = to_regprocedure($ck$$q$ || CHU_KY_BAM || $q$$ck$)),
                  'hàm public.audit_compute_hash(...) không tồn tại')$q$,
      $q$quyền sở hữu hàm public.audit_compute_hash(...) (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- ---- [Task 6] (D1b) Thân hàm public.noi_chuoi_kiem_toan() ---------------------------
    -- Vì sao mục này BẮT BUỘC phải có, chứ không phải "canh trigger tồn tại là đủ": mục (D2) chỉ
    -- kiểm tgfoid/tgtype/tgenabled, nên nó xanh với một hàm cùng tên mà THÂN đã bị thay. Và
    -- đường thay thân là ĐÚNG cái lỗ [CR1] mà Task 5 vừa đóng, chỉ khác là nó núp dưới một cái
    -- tên HỢP LỆ:
    --     CREATE OR REPLACE FUNCTION public.noi_chuoi_kiem_toan() ... RETURN NULL;  (có điều kiện)
    --   -> sự kiện bị NUỐT CÓ CHỌN LỌC, seq và prev_hash vẫn liền mạch, và bộ kiểm chứng chuỗi
    --      hash của Task 6 báo HỢP LỆ trên một sổ ĐÃ BỊ KIỂM DUYỆT.
    -- Chế độ hỏng theo chiều còn lại thì FAIL-CLOSED và không cần canh: một thân "RETURN NEW"
    -- trần để prev_hash/hash ở NULL, mà 003 đặt NOT NULL trên cả hai và 004 đã thu hồi quyền ghi
    -- chúng — nên app_api không ghi nổi sự kiện nào nữa (ồn ào), chứ không ghi được sự kiện giả.
    --
    -- [QT1 — ai sửa được, bằng cách nào, trong bao lâu] Giống hệt mục (D1): proowner là role
    -- deploy vì chính lượt SỬA của file này tạo ra hàm, nên mục TỰ CHỮA ở lần deploy kế. Ngoại
    -- lệ đã biết và giống hệt (D1): nếu ai đó ALTER FUNCTION ... OWNER TO postgres thì
    -- CREATE OR REPLACE dưới role deploy trả 42501 và mục không tự chữa nữa; đường sửa là
    -- ALTER FUNCTION ... OWNER TO <role deploy> bằng superuser.
    -- [QT1 — ném được lỗi gì ngoài 42501] Đã rà: (a) 42P13 "cannot change return type" nếu ai đó
    -- thay hàm bằng một hàm cùng tên khác kiểu trả về — đóng bằng DROP có điều kiện đứng trước,
    -- đúng khuôn [CR3] của mục (D1); (b) 2BP01 nếu DROP chạy trong khi trigger còn phụ thuộc —
    -- không xảy ra vì vế điều kiện (prorettype <> trigger) loại đúng ca đó; (c) 42883 nếu
    -- public.audit_compute_hash chưa tồn tại — KHÔNG xảy ra: plpgsql chỉ kiểm cú pháp lúc tạo,
    -- không phân giải tên bảng/hàm trong thân (đã đo). Mọi lỗi khác vẫn bị BƯỚC 2 nuốt và BƯỚC 3
    -- phán xét.
    ARRAY[
      $q$định nghĩa hàm public.noi_chuoi_kiem_toan()$q$,
      $q$true$q$,
      $q$DO $fn$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.noi_chuoi_kiem_toan()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.noi_chuoi_kiem_toan();
           END IF;
           CREATE OR REPLACE FUNCTION public.noi_chuoi_kiem_toan() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $tnc$$q$ || THAN_NOI_CHUOI || $q$$tnc$;
         END
         $fn$$q$,
      -- Hai vế so sánh cùng đi qua một phép chuẩn hoá khoảng trắng, nên không ai phải viết tay
      -- bản "đã gập một dòng" của thân hàm — thứ mà mục (D1) phải làm và là một nguồn trôi thật.
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = btrim(regexp_replace($q$ || pg_catalog.quote_literal(THAN_NOI_CHUOI) || $q$, '\s+', ' ', 'g'))
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.noi_chuoi_kiem_toan()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.noi_chuoi_kiem_toan()')),
                  'hàm public.noi_chuoi_kiem_toan() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.noi_chuoi_kiem_toan() (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- Bảy trigger (hai bảng × ba sự kiện chỉ-ghi-thêm, cộng trigger nối chuỗi trên
    -- audit_events). TỰ CHỮA, và cố ý chữa bằng "CREATE OR REPLACE
    -- TRIGGER" + "ENABLE ALWAYS" chứ không chỉ tạo lại cái thiếu: đã đo trên PostgreSQL 16.15
    -- rằng CREATE OR REPLACE TRIGGER RESET tgenabled về 'O', nên hai câu phải đi liền nhau —
    -- chỉ chạy câu đầu là tự tay hạ ENABLE ALWAYS xuống ORIGIN ở mỗi lần deploy.
    -- Mục này chạy TRÊN VÔ ĐIỀU KIỆN nhưng chỉ đụng tới những trigger ĐANG SAI (vòng lặp đọc
    -- CTE `sai`), nên deploy bình thường không lấy khoá DDL nào trên bảng sổ.
    --
    -- [vòng fix 1 — CR3] "DROP TRIGGER IF EXISTS" đi TRƯỚC "CREATE OR REPLACE TRIGGER". Đo được
    -- kịch bản liền, và nó là cái bẫy nặng nhất của mục này: DISABLE audit_events_chan_update
    -- rồi cắm một CONSTRAINT TRIGGER trùng tên audit_events_chan_delete -> câu CREATE OR REPLACE
    -- ném 42710 ("... is a constraint trigger") ở LƯỢT 1 (chế độ 'sua'), tức TRƯỚC vòng migration
    -- đánh số -> migrate() chết trước khi tới được 004_*.sql -> "cửa sổ phơi tới lần deploy kế"
    -- thành VĨNH VIỄN, LỚP C TỰ KHOÁ MÌNH LẠI. Hai câu ENABLE ALWAYS phía sau vốn đã có nên
    -- DROP+CREATE không đổi ngữ nghĩa của deploy bình thường (vòng lặp chỉ chạy trên trigger SAI).
    -- [vòng fix 1 — CR4] Vòng lặp chỉ chạy trên `trong_ds` — bảng lọt vào qua vế trigger được
    -- PHÁN XÉT chứ không bị migrate() tự tay áp đặt ngữ nghĩa chỉ-ghi-thêm.
    -- [vòng fix 1 — CR1] Hai vòng lặp cuối gỡ trigger LẠ và RULE khỏi bảng sổ. Cùng mức quyền
    -- (sở hữu bảng) mà vòng lặp đầu đã đòi, nên không mở thêm yêu cầu deploy nào.
    -- [vòng fix 1 — CR3, hạt mịn] MỖI đơn vị sửa chữa nằm trong khối con BEGIN/EXCEPTION riêng.
    -- Bản vá CR3 ở BƯỚC 2 mới chỉ giữ cho một mục hỏng không kéo sập CÁC MỤC KHÁC; nó không giữ
    -- cho một ĐƠN VỊ hỏng bên trong cùng một mục khỏi kéo theo những đơn vị đã sửa được của
    -- chính mục đó. Đã tự vấp và đo: trong mục (D3), "ALTER TABLE ... SET LOGGED" chạy THÀNH
    -- CÔNG rồi "ADD CONSTRAINT UNIQUE" ném 23505 trên bảng đang có hàng trùng — cả hai cùng
    -- khối nên SET LOGGED bị rollback theo, và bảng sổ ở lại UNLOGGED (mất dữ liệu sau crash)
    -- chỉ vì một chế độ hỏng KHÁC HẲN không liên quan. Đây đúng là lớp lỗi mà [fix round 5 — R1]
    -- đã phải gỡ một lần ở mức MỤC; nay nó được đóng ở mức ĐƠN VỊ.
    ARRAY[
      $q$trigger chỉ-ghi-thêm trên bảng sổ kiểm toán$q$,
      $q$true$q$,
      $q$DO $tg$
         DECLARE r RECORD;
         BEGIN
           FOR r IN $q$ || CTE_TRIGGER_CHAN || $q$
             SELECT bang_oid, ten_trigger, su_kien, pham_vi, ten_ham FROM sai
              WHERE ly_do IS NOT NULL AND trong_ds
           LOOP
             BEGIN
               EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s',
                              r.ten_trigger, r.bang_oid::regclass);
               EXECUTE format(
                 'CREATE OR REPLACE TRIGGER %I BEFORE %s ON %s %s '
                 'EXECUTE FUNCTION %s',
                 r.ten_trigger, r.su_kien, r.bang_oid::regclass, r.pham_vi, r.ten_ham);
               EXECUTE format('ALTER TABLE %s ENABLE ALWAYS TRIGGER %I',
                              r.bang_oid::regclass, r.ten_trigger);
             EXCEPTION WHEN OTHERS THEN
               RAISE WARNING 'Hardening: không dựng lại được trigger % trên %: % (%)',
                             r.ten_trigger, r.bang_oid::regclass, SQLERRM, SQLSTATE;
             END;
           END LOOP;
           FOR r IN $q$ || CTE_TRIGGER_CHAN || $q$ $q$ || CAU_TRIGGER_LA || $q$
           LOOP
             BEGIN
               EXECUTE format('DROP TRIGGER %I ON %s', r.ten, r.bang_oid::regclass);
               -- [vòng fix 2 — I1] GỠ ĐƯỢC thì phải ỒN ÀO. Mặc định-ĐÓNG của [CR1] xoá cả
               -- những trigger HỢP LỆ mà một migration vừa tạo: đo được với một
               -- 004_task6_neo.sql cắm audit_events_neo_chuoi -> migrate() = MIGRATE OK,
               -- KHÔNG một thông báo nào, trigger bị gỡ, và 004 ĐÃ nằm trong
               -- schema_migrations nên không bao giờ chạy lại — người vận hành nhận
               -- "MIGRATE OK" và một migration đã bốc hơi. Đó đúng bằng chế độ hỏng mà [CR4]
               -- vừa bị xử ("migrate() tự đổi ngữ nghĩa một bảng trong im lặng"), theo chiều
               -- ngược lại. Gỡ một trigger khỏi SỔ KIỂM TOÁN vừa là bản vá vừa là SỰ KIỆN AN
               -- NINH, nên nó không được đi qua trong im lặng ở cả hai chiều.
               RAISE WARNING 'Hardening: đã GỠ trigger lạ % trên % (chỉ những trigger trong can_co '
                             'được phép tồn tại trên bảng sổ). Nếu đây là trigger HỢP LỆ của một '
                             'migration mới thì migration đó vừa bị vô hiệu hoá: bản vá phải nằm '
                             'trong chính hardening.always.sql, không phải trong migration.',
                             r.ten, r.bang_oid::regclass;
             EXCEPTION WHEN OTHERS THEN
               RAISE WARNING 'Hardening: không gỡ được trigger lạ % trên %: % (%)',
                             r.ten, r.bang_oid::regclass, SQLERRM, SQLSTATE;
             END;
           END LOOP;
           FOR r IN $q$ || CTE_TRIGGER_CHAN || $q$ $q$ || CAU_RULE_LA || $q$
           LOOP
             BEGIN
               EXECUTE format('DROP RULE %I ON %s', r.ten, r.bang_oid::regclass);
               RAISE WARNING 'Hardening: đã GỠ rule lạ % trên % (không rule nào được phép tồn '
                             'tại trên bảng sổ).', r.ten, r.bang_oid::regclass;
             EXCEPTION WHEN OTHERS THEN
               RAISE WARNING 'Hardening: không gỡ được rule % trên %: % (%)',
                             r.ten, r.bang_oid::regclass, SQLERRM, SQLSTATE;
             END;
           END LOOP;
         END
         $tg$$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_TRIGGER_CHAN_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_TRIGGER_CHAN_SAI || $q$) t)$q$,
      $q$quyền sở hữu các bảng sổ đó (để CREATE/DROP TRIGGER, DROP RULE và ALTER TABLE) hoặc SUPERUSER$q$
    ],

    -- [vòng fix 1 — CR5 + IM5] Trạng thái VẬT LÝ của bảng sổ. Tách khỏi mục trigger để một đột
    -- biến vào đây không bị mục kia bắt hộ, và để thông báo lỗi nói đúng thứ đang sai.
    -- "SET LOGGED" viết lại toàn bộ bảng nên nó KHÔNG chạy ở deploy bình thường: vòng lặp chỉ
    -- đụng tới bảng đang có relpersistence <> 'p'.
    ARRAY[
      $q$bảng sổ kiểm toán: LOGGED và UNIQUE (org_id, seq)$q$,
      $q$true$q$,
      $q$DO $vl$
         DECLARE r RECORD;
         BEGIN
           FOR r IN $q$ || CTE_TRIGGER_CHAN || $q$
             SELECT bang_oid, relname, relpersistence FROM bang_so
           LOOP
             IF r.relpersistence <> 'p' THEN
               BEGIN
                 EXECUTE format('ALTER TABLE %s SET LOGGED', r.bang_oid::regclass);
               EXCEPTION WHEN OTHERS THEN
                 RAISE WARNING 'Hardening: không đặt lại LOGGED cho %: % (%)',
                               r.bang_oid::regclass, SQLERRM, SQLSTATE;
               END;
             END IF;
             IF NOT EXISTS (SELECT 1 FROM pg_constraint con
                             WHERE con.conrelid = r.bang_oid AND con.contype = 'u'
                               AND con.conkey = ARRAY[
                                     (SELECT a.attnum FROM pg_attribute a
                                       WHERE a.attrelid = r.bang_oid AND a.attname = 'org_id'
                                         AND a.attnum > 0 AND NOT a.attisdropped),
                                     (SELECT a.attnum FROM pg_attribute a
                                       WHERE a.attrelid = r.bang_oid AND a.attname = 'seq'
                                         AND a.attnum > 0 AND NOT a.attisdropped)]) THEN
               BEGIN
                 EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I UNIQUE (org_id, seq)',
                                r.bang_oid::regclass, r.relname || '_org_id_seq_key');
               EXCEPTION WHEN OTHERS THEN
                 RAISE WARNING 'Hardening: không dựng lại được UNIQUE (org_id, seq) trên %: % (%)',
                               r.bang_oid::regclass, SQLERRM, SQLSTATE;
               END;
             END IF;
           END LOOP;
         END
         $vl$$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_BANG_SO_VAT_LY || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_BANG_SO_VAT_LY || $q$) t)$q$,
      $q$quyền sở hữu các bảng sổ đó (để ALTER TABLE SET LOGGED / ADD CONSTRAINT) hoặc SUPERUSER$q$
    ],

    -- [vòng fix 1 — IM2] ACL của bảng sổ — xem lập luận đo được ở CAU_QUYEN_BANG_SO_SAI.
    ARRAY[
      $q$quyền GHI trên bảng sổ kiểm toán$q$,
      $q$true$q$,
      $q$DO $ac$
         DECLARE r RECORD;
         BEGIN
           FOR r IN $q$ || CTE_TRIGGER_CHAN || $q$ $q$ || CAU_QUYEN_BANG_SO_SAI || $q$
           LOOP
             BEGIN
               -- [vòng fix 2 — I2] CASCADE là BẮT BUỘC, không phải phòng xa. Thiếu nó thì một
               -- tác nhân TRONG mô hình khoá được deploy VĨNH VIỄN bằng một câu lệnh, và mục
               -- (D4) — thứ vừa sinh ra để canh ACL — trở thành đúng cái lớp "lớp C tự khoá
               -- mình lại" mà [CR3] vừa phải gỡ. Đo trên PostgreSQL 16.15:
               --     GRANT UPDATE ON audit_events TO app_api WITH GRANT OPTION;  -- chủ sở hữu
               --     SET ROLE app_api; GRANT UPDATE ON audit_events TO ben_thu_ba;
               --     -> "REVOKE UPDATE ... FROM app_api" ném 2BP01 (dependent privileges exist)
               --     -> migrate() GÃY lần 1, GÃY y hệt lần 2, relacl KHÔNG ĐỔI.
               -- Và vòng lặp KHÔNG tự tháo được nút: "REVOKE ... FROM ben_thu_ba" chạy dưới
               -- role deploy là NO-OP IM LẶNG vì grantor là app_api chứ không phải deploy.
               -- CASCADE ở đây chỉ lan trên ĐÚNG cái quyền đang bị cấm (UPDATE/DELETE/TRUNCATE
               -- trên bảng sổ) — nó không thu hồi thêm quyền nào khác, và mọi quyền nó gỡ đều
               -- là quyền dẫn xuất từ chính dòng ACL vi phạm.
               IF r.cot IS NULL THEN
                 EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM %s CASCADE',
                                r.bang_oid::regclass, r.ai);
               ELSE
                 EXECUTE format('REVOKE UPDATE (%I) ON %s FROM %s CASCADE',
                                r.cot, r.bang_oid::regclass, r.ai);
               END IF;
             EXCEPTION WHEN OTHERS THEN
               RAISE WARNING 'Hardening: không thu hồi được quyền % của % trên %: % (%)',
                             r.quyen, r.ai, r.bang_oid::regclass, SQLERRM, SQLSTATE;
             END;
           END LOOP;
         END
         $ac$$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_QUYEN_BANG_SO_MO_TA || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_QUYEN_BANG_SO_MO_TA || $q$) t)$q$,
      $q$quyền sở hữu các bảng sổ đó (hoặc là grantor của chính quyền cần thu hồi) hoặc SUPERUSER$q$
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
  -- [vòng fix 2 — I4] ĐÃ BỎ mảng `loi_cuong_che`. Vòng 1 dựng nó để BƯỚC 4 nói được VÌ SAO tự
  -- chữa không thành, nhưng nó là MÃ CHẾT dưới mọi lần migrate(): packages/db/src/migrate.ts
  -- chỉ sinh hai chế độ 'sua' và 'phan_xet'; BƯỚC 2 (chỗ GHI mảng) chỉ chạy ở 'sua' rồi RETURN
  -- ngay, còn BƯỚC 4 (chỗ ĐỌC mảng) chỉ chạy ở 'phan_xet' nơi mảng luôn rỗng. Hai nhánh không
  -- bao giờ gặp nhau trừ chế độ 'day_du' — chỉ tồn tại khi chạy tay bằng psql -f. ĐÃ ĐO: cắm
  -- kịch bản (D1) ném 2BP01 rồi chạy đủ ba lượt, thông báo của lượt phán xét KHÔNG chứa chuỗi
  -- "Câu lệnh cưỡng chế đã ném". Truyền lỗi qua lượt đòi một chỗ chứa sống qua COMMIT (bảng
  -- tạm ON COMMIT DROP thì không), tức THÊM BỀ MẶT trong chính vùng đang bị canh — không đáng.
  -- WARNING tại chỗ ở BƯỚC 2 vẫn còn và vẫn có ích: nó ra ngay ở lượt sửa, kèm SQLSTATE.
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

  -- ===== GHIM PHẦN CÒN LẠI CỦA MÔI TRƯỜNG LEX/SO KHỚP ==================================
  -- [vòng fix 3 — I3] Vòng 2 ghim search_path rồi DỪNG LẠI — không hỏi "còn cấu hình HÀNG
  -- XÓM nào mà một phép kiểm ở đây phụ thuộc vào?". Hậu quả đo được trên PostgreSQL 16.15:
  --     ALTER DATABASE d SET standard_conforming_strings = off
  --       -> migrate() BLOCKED lần 1, lần 2, lần 3... và thông báo ĐỔ LỖI CHO HÀM:
  --          'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại:
  --           SELECT NULLIF(pg_catalog.current_ etting(...' trong khi hàm HOÀN TOÀN ĐÚNG.
  --       Cơ chế: '\s+' dưới scs=off lex thành 's+', nên regexp_replace ĂN MẤT chữ 's'
  --       trong thân hàm rồi so sánh với bản chuẩn. Đường sửa duy nhất khi ấy là SỬA TAY
  --       TRÊN CỤM — vi phạm thẳng quy tắc "nếu câu trả lời là 'phải sửa tay trên cụm
  --       production' thì thiết kế lại".
  --     Cùng gốc, 5 literal khác đổi nghĩa: '\m...\M' (view security_invoker -> regex không
  --       bao giờ khớp, MỌI view hợp lệ bị báo thiếu) và 'pg\_toast%' / 'row\_security=%' /
  --       'search\_path=%' (escape LIKE biến mất -> '_' thành ký tự đại diện, bộ lọc TỰ LÀM
  --       MÙ MÌNH RỘNG RA).
  --
  -- CÁCH SỬA CHỌN: ghim MỘT LẦN CHO TẤT CẢ thay vì vá từng literal. Lý do là lý do tổng
  -- quát, không phải khẩu vị: vá literal đóng đúng 7 chỗ ĐANG có, còn ghim đóng cả những
  -- chỗ mà Task 5-10 sẽ viết. Vá từng literal cũng chính là "nới bảo đảm ra để chấp nhận
  -- mọi giá trị của một cấu hình" — khuôn đã sinh ra CR1-v2.
  --
  -- Vì sao ĐỦ để đặt ở đây: cả 7 literal nói trên nằm trong hằng $q$...$q$ của khối DECLARE,
  -- tức chúng chỉ TRỞ THÀNH literal SQL khi được EXECUTE — sau dòng này. Đã đo: cùng khối DO
  -- dưới scs=off, EXECUTE trước dòng ghim cho regexp_replace ăn chữ 's', EXECUTE sau dòng
  -- ghim thì đúng. Hai literal E'' ở cuối file (RAISE EXCEPTION) vốn đã miễn nhiễm.
  --
  -- HAI LỚP GUC, mỗi lớp một lý do:
  --   (1) standard_conforming_strings — đổi cách lex CHÍNH văn bản SQL của file này.
  --       backslash_quote cùng lớp nhưng CHỈ có nghĩa khi scs=off, nên ghim (1) làm nó vô
  --       hại; cố ý không thêm một dòng không test nào giết được.
  --   (2) DateStyle / IntervalStyle / TimeZone / bytea_output — đổi cách pg_get_expr KẾT XUẤT
  --       hằng bên trong biểu thức policy, tức đổi CHUỖI mà danh sách trắng so khớp. Đã đo
  --       trên cùng một policy:
  --         German,DMY + Asia/Tokyo + sql_standard + escape
  --           -> (ngay > '02.01.2020'::date) AND (gio > '02.01.2020 12:04:05 JST'::...)
  --              AND (b <> '\\001'::bytea) AND (iv > '1 2:00:00'::interval)
  --         đã ghim -> (ngay > '2020-01-02'::date) ... '2020-01-02 03:04:05+00' ... '\\x01'
  --              ... '1 day 02:00:00'
  --       S0 chưa có policy nào chứa hằng như thế; Task 6 (hạn nộp thầu) gần như chắc chắn
  --       có. Ghim TRƯỚC khi hình dạng đầu tiên xuất hiện, vì lúc đó cửa NGOAI_LE_HINH_DANG
  --       sẽ khoá theo đúng chuỗi này.
  --   ĐÃ ĐO VÀ CỐ Ý KHÔNG GHIM: extra_float_digits (0/3/-3 đều cho cùng một deparse — hằng
  --   số học trong policy được lưu ở dạng numeric), client_encoding (LATIN1 -> PASS: so
  --   khớp diễn ra phía SERVER), row_security ở mức DB (đã có mục riêng RESET nó).
  PERFORM pg_catalog.set_config('standard_conforming_strings', 'on', true);
  PERFORM pg_catalog.set_config('DateStyle', 'ISO, MDY', true);
  PERFORM pg_catalog.set_config('IntervalStyle', 'postgres', true);
  PERFORM pg_catalog.set_config('TimeZone', 'UTC', true);
  PERFORM pg_catalog.set_config('bytea_output', 'hex', true);

  -- [vòng fix 1 — I3] Chế độ lạ là LỖI, không phải "coi như mặc định". Một lỗi chính tả trong
  -- packages/db/src/migrate.ts sẽ làm lượt phán xét im lặng biến mất nếu ở đây khoan dung.
  IF che_do NOT IN ('sua', 'phan_xet', 'day_du') THEN
    RAISE EXCEPTION 'app.hardening_che_do = % không hợp lệ (chỉ nhận sua/phan_xet/day_du)', che_do;
  END IF;

  IF che_do IN ('sua', 'day_du') THEN
  -- [vòng fix 2 — CR1] BƯỚC 0/1/1b NẰM TRONG CÙNG BẢO ĐẢM VỚI BƯỚC 2, và vòng trước bỏ sót
  -- điều đó. Vòng 1 tuyên bố bất biến "lượt SỬA chạy được hết" ở PHẠM VI TỆP nhưng chỉ sửa
  -- MỘT trong BỐN chỗ: ba bước này vẫn chỉ nuốt insufficient_privilege (42501), nên chúng tái
  -- tạo NGUYÊN VẸN ngõ cụt [CR3]. Đo được trên PostgreSQL 16.15, trên CẢ HAI hồ sơ vai deploy
  -- (superuser, và tp_deploy tự tạo nhóm nên có ADMIN OPTION):
  --     GRANT nhom_x TO app_api WITH ADMIN OPTION;  SET ROLE app_api; GRANT nhom_x TO ke_ba;
  --     -> "REVOKE nhom_x FROM app_api" ném 2BP01 (dependent privileges exist)
  --     -> lỗi thoát khỏi khối DO ở LƯỢT SỬA -> migrate() chết TRƯỚC vòng migration đánh số
  --     -> 004_*.sql không bao giờ chạy tới (đo: count = 0).
  -- Nay cả bốn handler bắt MỌI lỗi và phát WARNING đúng khuôn BƯỚC 2. Không mất phát hiện:
  -- hậu điều kiện membership/ADMIN OPTION ở BƯỚC 3 vẫn phán xét trạng thái THẬT, và ở lượt
  -- phán xét thì 004 đã tới đích nên vá được bằng một migration mới. QT1 cho ca 2BP01:
  -- role có ADMIN OPTION chạy "REVOKE <nhóm> FROM <thành viên> CASCADE" trong một migration
  -- mới (đo: CASCADE chạy được dưới tp_deploy; "GRANTED BY <thành viên>" thì KHÔNG —
  -- "permission denied to revoke privileges granted by role"). CỐ Ý KHÔNG tự thêm CASCADE vào
  -- câu cưỡng chế ở đây: nó thu hồi quyền của một CHỦ THỂ THỨ BA nằm ngoài vùng canh, và làm
  -- thế trong im lặng đúng bằng chế độ hỏng mà [vòng fix 2 — I1] vừa phải sửa. Ghi vào sổ nợ.
  -- ===== BƯỚC 0: role phải tồn tại =====================================================
  -- Thông báo có ích hơn phát ra từ bước 3 ("role app_api không tồn tại" kèm quyền cần có),
  -- thay vì "permission denied to create role".
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    BEGIN
      CREATE ROLE app_api NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
      WHEN OTHERS THEN
        RAISE WARNING 'Hardening: không tạo được role app_api: % (%). BƯỚC 3 sẽ phán xét.',
                      SQLERRM, SQLSTATE;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_unseal') THEN
    BEGIN
      CREATE ROLE app_unseal NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
      WHEN OTHERS THEN
        RAISE WARNING 'Hardening: không tạo được role app_unseal: % (%). BƯỚC 3 sẽ phán xét.',
                      SQLERRM, SQLSTATE;
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
      WHEN OTHERS THEN
        -- Chỉ dùng % làm chỗ thế: RAISE KHÔNG hiểu %I/%s của format(), nó sẽ ăn một tham số
        -- rồi in ra chữ "I". Định danh vì thế được quote_ident() TRƯỚC khi truyền vào.
        RAISE WARNING 'Hardening: không gỡ được tư cách thành viên % -> %: % (%). BƯỚC 3 sẽ '
                      'phán xét; với 2BP01 hãy chạy "REVOKE % FROM % CASCADE" trong một '
                      'migration mới.',
                      hang.ten_nhom, hang.ten_thanh_vien, SQLERRM, SQLSTATE,
                      quote_ident(hang.ten_nhom), quote_ident(hang.ten_thanh_vien);
    END;
  END LOOP;

  -- ===== BƯỚC 1b: thu hồi ADMIN OPTION trên chính cặp hợp lệ ============================
  FOR hang IN EXECUTE CAU_ADMIN_LA LOOP
    BEGIN
      EXECUTE format('REVOKE ADMIN OPTION FOR %I FROM %I', hang.ten_nhom, hang.ten_thanh_vien);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
      WHEN OTHERS THEN
        RAISE WARNING 'Hardening: không thu hồi được ADMIN OPTION % -> %: % (%). BƯỚC 3 sẽ '
                      'phán xét.',
                      hang.ten_nhom, hang.ten_thanh_vien, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- ===== BƯỚC 2: chạy TOÀN BỘ câu lệnh cưỡng chế, không phán xét gì =====================
  -- [vòng fix 1 — CR3] BẮT MỌI LỖI, không riêng insufficient_privilege. Bất biến ở đầu file
  -- ("BƯỚC 2 ... KHÔNG GÃY Ở ĐÂY") trước vòng này là một Ý ĐỊNH chứ không phải một tính chất:
  -- nó chỉ đúng chừng nào mọi câu lệnh trong bảng có ĐÚNG MỘT chế độ hỏng là thiếu quyền. Task 5
  -- là task đầu tiên đưa vào bảng những câu lệnh có chế độ hỏng KHÁC, và hậu quả đo được là KÉP:
  --   (a) lỗi thoát khỏi khối DO -> CẢ transaction hardening ROLLBACK -> mọi sửa chữa khác trong
  --       cùng lượt đều mất (một mục không sửa được kéo theo những mục sửa được);
  --   (b) migrate.ts chạy lượt 'sua' TRƯỚC vòng migration đánh số, nên gãy ở đó nghĩa là
  --       migrate() chết TRƯỚC khi tới được 004_*.sql — đường vá bằng một migration mới KHÔNG
  --       TỚI ĐƯỢC, chỉ còn sửa tay trên cụm. Đúng cái ngõ cụt QT1 mà cả file này sinh ra để gỡ.
  -- Nuốt KHÔNG phải là bỏ qua: hậu điều kiện ở BƯỚC 3 vẫn phán xét trạng thái THẬT, nên một câu
  -- lệnh cưỡng chế hỏng vẫn thành lỗi ồn ào — chỉ là ở lượt PHÁN XÉT (nơi 004 tới đích được)
  -- thay vì ở lượt SỬA (nơi nó không tới được). Lỗi bắt được vừa phát ra WARNING ngay tại chỗ,
  -- vừa được giữ lại để BƯỚC 4 nói ra trong cùng một thông báo.
  FOR i IN 1 .. array_length(bang, 1) LOOP
    EXECUTE 'SELECT ' || bang[i][2] INTO du_dieu_kien;
    CONTINUE WHEN NOT coalesce(du_dieu_kien, false);
    BEGIN
      EXECUTE bang[i][3];
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
      WHEN OTHERS THEN
        RAISE WARNING 'Hardening: câu lệnh cưỡng chế của mục "%" ném % (%). BƯỚC 2 nuốt lỗi này '
                      'để không kéo sập cả lượt sửa; hậu điều kiện ở BƯỚC 3 sẽ phán xét.',
                      bang[i][1], SQLSTATE, SQLERRM;
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

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
  -- [S1.20 / sổ nợ 16] VẾ THỨ HAI CỦA VỊ TỪ NÀY TỪNG LÀ MỘT CÁI TÊN, GIẤU BÊN TRONG MỘT VỊ TỪ
  -- TÍNH-CHẤT. Nguyên văn bản trước: `OR %2$s.relname IN ('organizations')`. Hệ quả đo được: một
  -- bảng gốc tenant THỨ HAI — bảng mà chính `id` của nó LÀ một tổ chức — không được bật RLS lẫn
  -- FORCE, và `db/rls-coverage.int.test.ts` cũng mù cùng chỗ vì nó nhân bản cùng danh sách.
  --
  -- TÍNH CHẤT THAY CHO CÁI TÊN: **bảng gốc là ĐÍCH của một khoá ngoại MỘT CỘT tên `org_id`.**
  -- Đo trên lược đồ hôm nay: 28 bảng có cột `org_id`, và cả 28 khoá ngoại một cột `org_id` đều
  -- trỏ tới ĐÚNG `organizations` — tính chất có thật, duy nhất, và không cần cái tên.
  --
  -- VÌ SAO VẾ "MỘT CỘT" LÀ LOAD-BEARING: lược đồ này có nhiều khoá ngoại GHÉP mang `org_id`
  -- (`(org_id, user_id) -> users`, `(org_id, challenge_id) -> invitation_otp_challenges`, …).
  -- Bỏ `array_length(conkey, 1) = 1` thì `users`, `rfq_packages`, `suppliers` … đều thành "gốc
  -- tenant" và mục (A) sẽ bật FORCE trên chúng theo một lý do sai.
  --
  -- [review lượt 12, M3] VẾ `confkey -> 'id'` LÀ BẮT BUỘC: `HINH_DANG_CHUAN` ghi cứng hình dạng
  -- policy của bảng gốc là `(id = app_current_org_id())`. Không có vế ấy, một khoá ngoại `org_id`
  -- trỏ tới một cột KHÁC `id` vẫn kéo bảng đích vào tập gốc tenant, và mục (A) sẽ bật FORCE RLS
  -- trên nó trong khi không hình dạng policy nào hợp lệ cho nó tồn tại — tức lượt `sua` để lại một
  -- bảng FORCE-RLS-không-policy (mọi đọc = 0 hàng) rồi lượt `phan_xet` chặn deploy. Xem ADR-028 §2⑵.
  -- CHIỀU GIẢ MẠO: thêm một khoá ngoại `org_id` một cột trỏ tới bảng X là THÊM X vào vùng canh,
  -- không phải gỡ. Gỡ X ra khỏi vùng canh đòi gỡ MỌI khoá ngoại `org_id` trỏ tới nó — tức phá
  -- chính ràng buộc tham chiếu của cây tenant, và đó là một thay đổi lược đồ nhìn thấy được.
  MAU_VI_TU_BANG_TENANT constant text :=
    $q$%1$s.nspname = 'public' AND %2$s.relkind IN ('r', 'p')
       AND (EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = %2$s.oid AND a.attname = 'org_id'
                       AND a.attnum > 0 AND NOT a.attisdropped)
            OR EXISTS (SELECT 1 FROM pg_constraint fk
                        JOIN pg_class fkb ON fkb.oid = fk.conrelid
                        JOIN pg_namespace fkn ON fkn.oid = fkb.relnamespace
                       WHERE fk.confrelid = %2$s.oid AND fk.contype = 'f'
                         AND fkn.nspname = 'public'
                         AND pg_catalog.array_length(fk.conkey, 1) = 1
                         AND EXISTS (SELECT 1 FROM pg_attribute fka
                                      WHERE fka.attrelid = fkb.oid
                                        AND fka.attnum = fk.conkey[1]
                                        AND fka.attname = 'org_id'
                                        AND NOT fka.attisdropped)
                         AND EXISTS (SELECT 1 FROM pg_attribute fkd
                                      WHERE fkd.attrelid = %2$s.oid
                                        AND fkd.attnum = fk.confkey[1]
                                        AND fkd.attname = 'id'
                                        AND NOT fkd.attisdropped)))$q$;
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
  -- [S1.15 / sổ nợ 57 / 044] DÒNG ĐẦU TIÊN của danh sách này, sau ba vòng RỖNG. Ghi chú ở trên
  -- nói trước rằng cửa "chỉ nổ khi cấp dòng đầu tiên — tức khi không ai còn nhìn", nên dòng này
  -- viết ra ĐỦ sáu trục và nói ra thứ nó cho phép:
  --   bảng   `otp_rate_limits` (bảng tenant, có `org_id` ⇒ pham_vi = 'co_org_id')
  --   policy `otp_rate_limits_don_cua_so_cu`, LỆNH 'd' (DELETE — không phải '*'), ROLE `app_api`
  --   biểu thức: "kết nối CHƯA gắn tổ chức" AND "cửa sổ đã quá 30 phút"
  -- Nó KHÔNG có tính chất mà `HINH_DANG_CHUAN` đòi (tự ràng buộc về đúng tổ chức đang gắn) —
  -- và không thể có: bộ dọn tồn tại đúng vì `otp_rate_limits` là bảng mà KHÔNG kết nối nào gắn
  -- được tất cả các tổ chức của nó. Lập luận đầy đủ ở đầu `044_don_bucket_otp.sql`; ba vế ngắn:
  --   ⑴ mọi đường yêu cầu đi qua `withTenant`, tức `app.org_id` LUÔN có ⇒ vế đầu SAI ⇒ không một
  --      đường yêu cầu nào nhận thêm quyền nào từ dòng này;
  --   ⑵ 'd' chứ không '*': đường ĐỌC không bị chạm, nên `[INV-F1]` ("chưa gắn tổ chức thì mọi
  --      bảng tenant trả 0 hàng") vẫn đúng nguyên văn, và có test đo nó sau khi dòng này tồn tại;
  --   ⑶ 30 phút là mốc DUY NHẤT, và nó ở đây chứ không ở phía gọi: bộ dọn chạy một `DELETE` TRẦN
  --      (không `WHERE`) vì mọi mệnh đề `WHERE` tham chiếu cột sẽ kéo theo đòi hỏi policy SELECT —
  --      thứ mà vế ⑵ cố ý không cấp. PostgreSQL tự AND vế `USING` này vào, nên tuổi do CSDL áp.
  -- Đổi một ký tự của biểu thức, đổi 'd' sang '*', hay đổi role đều làm dòng này HẾT KHỚP và
  -- hardening gãy — đó là toàn bộ lý do khoá sáu cột thay vì hai.
  NGOAI_LE_HINH_DANG constant text :=
    $q$(VALUES ('', '', '', '', '', ''),
               ('otp_rate_limits', 'otp_rate_limits_don_cua_so_cu', 'd', 'app_api', 'co_org_id',
                '((NULLIF(current_setting(''app.org_id''::text, true), ''''::text) IS NULL) AND (window_start < (now() - make_interval(secs => (1800)::double precision))))'))
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
  HAM_MOC_NEO   constant text := $q$to_regprocedure('public.chot_moc_neo()')$q$;

  -- [vòng fix 1 — IM2] VẾ LỌC LÀ HÌNH DẠNG, KHÔNG PHẢI TÊN. Bản trước viết
  --     BANG_NOI_CHUOI constant text := $q$('audit_events')$q$;   ... WHERE b.relname IN ...
  -- trong khi `bang_al` CỐ Ý nhận bảng ở MỌI schema (khoá cứng nspname='public' đã bị [CR2a]
  -- gỡ để nhìn thấy SET SCHEMA). Hệ quả đo được — ĐÚNG bẫy [CR4] ở một chiều mới, và lần này
  -- chiều hỏng là CHẶN GHI chứ không phải mở:
  --   (a) bảng KHÁC hình dạng: hardening TỰ TẠO audit_events_noi_chuoi trên bao_cao.audit_events
  --       -> INSERT vào bảng đó ném 'record "new" has no field "org_id"' VĨNH VIỄN;
  --   (b) bảng QUA ĐƯỢC mọi phép kiểm Task 5 (có org_id, seq, UNIQUE, LOGGED):
  --       APPLIED: [] — migrate() THÀNH CÔNG, không lỗi không warning — rồi INSERT ném
  --       'record "new" has no field "occurred_at"'. HOÀN TOÀN IM LẶNG.
  -- Trước Task 6, một bảng trùng tên chỉ bị chặn UPDATE/DELETE/TRUNCATE; INSERT vẫn chạy. Sau
  -- Task 6 nó bị chặn ghi HOÀN TOÀN. Đó là migrate() tự tay đổi ngữ nghĩa một bảng — đúng thứ
  -- [CR4] cấm.
  --
  -- LỆCH KHỎI ĐƠN THUỐC, có đo: đơn thuốc nói đếm 6 cột (org_id, seq, prev_hash, hash,
  -- occurred_at, payload). SÁU LÀ KHÔNG ĐỦ — thân `noi_chuoi_kiem_toan()` dereference MƯỜI LĂM
  -- trường của NEW (đọc thẳng hằng THAN_NOI_CHUOI bên dưới: org_id, seq, prev_hash, hash,
  -- occurred_at, payload, id, actor_type, actor_id, action, resource_type, resource_id,
  -- request_id, ip, user_agent — tức TOÀN BỘ 15 cột của audit_events), nên một bảng có đúng 6
  -- cột kia vẫn ném "has no field" ở cột thứ bảy — tức chính chế độ hỏng (b) ở trên, chỉ dịch
  -- đi một cột. Vị từ dưới đây đếm ĐỦ 15.
  --
  -- KHÔNG dùng to_regclass('public.audit_events'): nó TÁI LẬP khoá cứng `public` mà [CR2a] đã
  -- CỐ Ý gỡ, tức đánh đổi lại đúng khả năng nhìn thấy SET SCHEMA.
  --
  -- DƯ LƯỢNG CÒN LẠI, nói ra thay vì để người đọc tự phát hiện: một bảng ở schema khác mang
  -- ĐÚNG 14 cột này VẪN bị cắm trigger, và thân trigger đọc đuôi chuỗi từ `public.audit_events`
  -- (tên ghi cứng trong thân hàm) chứ không từ chính bảng đó. Khi ấy INSERT KHÔNG ném lỗi hình
  -- dạng nữa — nó nối vào một chuỗi SAI. Đó là một quyết định phải nhìn thấy được, và chỗ sửa
  -- là thân hàm (dùng TG_RELID thay vì tên ghi cứng), không phải vế lọc này. Ghi vào sổ nợ.
  --
  -- [vòng fix 2 — I1] MỘT NGUỒN DUY NHẤT cho tên cột của hai bảng sổ. Vị từ hình dạng (gác
  -- `can_co`) VÀ mục cưỡng chế (D5) đọc CÙNG ba hằng này. Hai danh sách song song sẽ trôi khỏi
  -- nhau và tái tạo đúng cái "hàng rào tự làm mù mình bằng SỐ CỘT" mà (D5) sinh ra để đóng —
  -- nên chúng KHÔNG được nhân bản.
  -- Con số `= 15` / `= 4` / `= 0` bên dưới CỐ Ý viết cứng chứ không dẫn xuất từ độ dài mảng:
  -- lệch giữa danh sách và con số là fail-CLOSED (vị từ thành bất khả thoả, mọi test đỏ) chứ
  -- không phải fail-open.
  COT_SO constant text :=
    $q$'id', 'org_id', 'seq', 'prev_hash', 'hash', 'occurred_at', 'actor_type', 'actor_id',
       'action', 'resource_type', 'resource_id', 'payload', 'request_id', 'ip', 'user_agent'$q$;
  COT_NEO     constant text := $q$'org_id', 'seq', 'hash', 'anchored_at'$q$;
  COT_NEO_CAM constant text := $q$'prev_hash', 'occurred_at', 'payload', 'action'$q$;

  -- %1$s = bí danh của bảng đang xét (phải có cột bang_oid). "%%" là dấu % thật sau format().
  MAU_HINH_DANG_SO constant text :=
    $q$(SELECT pg_catalog.count(*) FROM pg_attribute a
         WHERE a.attrelid = %1$s.bang_oid AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attname IN ($q$ || COT_SO || $q$)) = 15$q$;

  -- [vòng fix 1 — IM4] Hình dạng bảng MỐC NEO.
  --
  -- [vòng fix 2 — đột biến S32, SỬA MỘT LỜI NÓI QUÁ] Bản trước của dòng này viết "vế phủ định
  -- là BẮT BUỘC: không có nó thì `audit_events` (có org_id/seq/hash) cũng lọt vào đây". Đo lại
  -- thì SAI: vế dương đòi ĐỦ BỐN tên, và `audit_events` KHÔNG có `anchored_at` (15 cột của nó:
  -- id, org_id, seq, occurred_at, actor_type, actor_id, action, resource_type, resource_id,
  -- payload, request_id, ip, user_agent, prev_hash, hash) nên nó đếm được 3, không phải 4 —
  -- vế dương MỘT MÌNH đã loại nó. Đột biến "gỡ vế phủ định" SỐNG SÓT, và đó là phép đo chứng
  -- minh điều đó. Vế phủ định vẫn giữ, nhưng phải gọi đúng tên: nó là PHÒNG XA cho một bảng
  -- TƯƠNG LAI mang cả bốn cột neo LẪN cột chuỗi (khi ấy nó sẽ bị đòi hai trigger INSERT mâu
  -- thuẫn nhau), KHÔNG phải thứ đang gánh bảng sổ hôm nay.
  --
  -- [vòng fix 2 — M1] DƯ LƯỢNG Y HỆT vế lọc trên, và sổ nợ #1 của vòng trước bỏ sót nó:
  -- `chot_moc_neo()` đọc `FROM public.audit_events` GHI CỨNG (004:365-366) rồi ghi đè
  -- NEW.seq/NEW.hash của bảng ĐANG BỊ CẮM TRIGGER. Đo được: một `kho_neo.audit_chain_anchors`
  -- đúng hình dạng này bị cắm trigger, và INSERT vào nó trả về đầu chuỗi của
  -- `public.audit_events` — tức migrate() TỰ TAY ĐỔI NGỮ NGHĨA MỘT BẢNG, đúng bẫy [CR4]. Chỗ
  -- sửa là TG_RELID trong thân hàm, KHÔNG phải vế lọc này. Ghi vào sổ nợ #1 cùng
  -- `noi_chuoi_kiem_toan()`; cố ý KHÔNG vá ở vòng fix 2.
  MAU_HINH_DANG_NEO constant text :=
    $q$(SELECT pg_catalog.count(*) FROM pg_attribute a
         WHERE a.attrelid = %1$s.bang_oid AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attname IN ($q$ || COT_NEO || $q$)) = 4
       AND (SELECT pg_catalog.count(*) FROM pg_attribute a
             WHERE a.attrelid = %1$s.bang_oid AND a.attnum > 0 AND NOT a.attisdropped
               AND a.attname IN ($q$ || COT_NEO_CAM || $q$)) = 0$q$;

  -- [vòng fix 2 — I1] HÌNH DẠNG CỘT CỦA BẢNG SỔ CHÍNH TẮC — hậu điều kiện của mục (D5).
  -- Chỉ soi HAI cái tên đủ điều kiện `public.audit_events` và `public.audit_chain_anchors`, và
  -- chỉ khi chúng TỒN TẠI. Đây KHÔNG phải việc tái lập khoá cứng nspname='public' trong VẾ LỌC
  -- của `can_co` ([CR2a] gỡ nó để nhìn thấy SET SCHEMA, lý do đó vẫn đứng): mục này không cắm,
  -- không gỡ, không phán xét trigger của bảng nào — nó chỉ khẳng định rằng BẢNG CHÍNH TẮC còn
  -- khớp chính cái vị từ đang gác trigger của nó.
  CAU_HINH_DANG_CHINH_TAC constant text :=
    $q$SELECT 'public.audit_events: hình dạng cột đã TRÔI — thiếu {'
              || coalesce((SELECT pg_catalog.string_agg(pg_catalog.quote_ident(t.ten), ', '
                                                        ORDER BY t.ten)
                             FROM pg_catalog.unnest(ARRAY[$q$ || COT_SO || $q$]) AS t(ten)
                            WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                                               WHERE a.attrelid = b.bang_oid AND a.attnum > 0
                                                 AND NOT a.attisdropped AND a.attname = t.ten)),
                          '')
              || '}. Vị từ hình dạng gác `can_co` đòi ĐỦ 15 tên cột, nên bảng sổ này KHÔNG CÒN '
                 'khớp và lớp C MẤT khả năng dựng lại audit_events_noi_chuoi: từ lúc đó bên ghi '
                 'tự chọn được seq/prev_hash/hash. THÊM cột thì an toàn; ĐỔI TÊN hoặc XOÁ một '
                 'trong 15 cột thì không. Sửa bằng một migration đánh số MỚI trả tên cột về bản '
                 'chuẩn — vòng migration đánh số chạy TRƯỚC lượt phán xét nên vá được trong CÙNG '
                 'một lần deploy. Mục này CỐ Ý không tự sửa lược đồ (xem [CR4]).' AS mo_ta
         FROM (SELECT to_regclass('public.audit_events')::oid AS bang_oid) b
        WHERE b.bang_oid IS NOT NULL
          AND NOT ($q$ || pg_catalog.format(MAU_HINH_DANG_SO, 'b') || $q$)
     UNION ALL
     SELECT 'public.audit_chain_anchors: hình dạng cột đã TRÔI — thiếu {'
              || coalesce((SELECT pg_catalog.string_agg(pg_catalog.quote_ident(t.ten), ', '
                                                        ORDER BY t.ten)
                             FROM pg_catalog.unnest(ARRAY[$q$ || COT_NEO || $q$]) AS t(ten)
                            WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                                               WHERE a.attrelid = b.bang_oid AND a.attnum > 0
                                                 AND NOT a.attisdropped AND a.attname = t.ten)),
                          '')
              || '}, thừa {'
              || coalesce((SELECT pg_catalog.string_agg(pg_catalog.quote_ident(t.ten), ', '
                                                        ORDER BY t.ten)
                             FROM pg_catalog.unnest(ARRAY[$q$ || COT_NEO_CAM || $q$]) AS t(ten)
                            WHERE EXISTS (SELECT 1 FROM pg_attribute a
                                           WHERE a.attrelid = b.bang_oid AND a.attnum > 0
                                             AND NOT a.attisdropped AND a.attname = t.ten)),
                          '')
              || '}. Cùng chế độ hỏng: lớp C MẤT khả năng dựng lại audit_chain_anchors_moc_neo, '
                 'và mốc neo lại do BÊN GHI chọn — đúng lỗ [I3] mà vòng fix 1 vừa đóng. Sửa bằng '
                 'một migration đánh số MỚI.' AS mo_ta
         FROM (SELECT to_regclass('public.audit_chain_anchors')::oid AS bang_oid) b
        WHERE b.bang_oid IS NOT NULL
          AND NOT ($q$ || pg_catalog.format(MAU_HINH_DANG_NEO, 'b') || $q$)$q$;

  -- ---- [Task 8] BẤT BIẾN D3 (PHÂN TÁCH NHIỆM VỤ) — HAI TẦNG, HAI THỜI ĐIỂM ---------------
  -- D3 (docs/TEST-PLAN.md): "Chuỗi tạo RFQ -> chọn nhà cung cấp -> mở thầu -> award -> duyệt
  -- không nằm trọn trong tay một người (ma trận mục 25)". Nó là một bất biến về DỮ LIỆU, không
  -- về mã: một câu UPDATE trên `role_permissions` hoặc một dòng thừa trong `user_roles` phá nó
  -- mà không một test hành vi nào đỏ.
  --
  -- HAI TẦNG, HAI THỜI ĐIỂM, HAI TRIGGER — và cả hai đều là TRIGGER chứ không phải một phép
  -- phán xét ở thời điểm deploy. Xem khối chú thích của THAN_MA_TRAN bên dưới để biết phép đo
  -- đã loại bỏ hướng "phán xét ở thời điểm deploy":
  --   * mức NGƯỜI DÙNG (THAN_PHAN_TACH, trên `user_roles`): bảng app_api GHI ĐƯỢC, nên gán cho
  --     một người cả PROCUREMENT_MANAGER lẫn DIRECTOR là đủ để một người nắm trọn chuỗi;
  --   * mức VAI TRÒ (THAN_MA_TRAN, trên `role_permissions`): danh mục toàn cục, chỉ chủ sở hữu
  --     ghi được, nhưng một migration sau (hoặc một lần can thiệp tay) vẫn tạo được vai trò ôm
  --     trọn chuỗi.
  --
  -- Năm mã quyền ấy xuất hiện trong BỐN thân hàm (hai ở đây, hai ở 005_identity.sql) và trong
  -- hằng `SEPARATION_OF_DUTIES_CHAIN` của packages/identity/src/permissions.ts. Meta-test
  -- packages/identity/src/ma-tran-quyen.test.ts đọc tất cả và so sánh, đúng khuôn §R3 đã dùng
  -- cho thân app_current_org_id() và thân noi_chuoi_kiem_toan(). Các bản khớp nhau là điều kiện
  -- để các lớp nói về CÙNG MỘT bất biến; một bản trôi đi là kiểu hỏng mà không test hành vi nào
  -- bắt được.

  -- Thân hàm canh phân tách nhiệm vụ. Bản NGUỒN ở db/migrations/005_identity.sql §(4); hai bản
  -- phải khớp sau khi chuẩn hoá khoảng trắng. Thân hàm cố ý KHÔNG mang chú thích: hậu điều kiện
  -- so prosrc theo văn bản, nên mọi chú thích phải nằm NGOÀI $tpt$ ở cả hai file.
  --
  -- Vì sao mục này PHẢI cưỡng chế cả THÂN, không chỉ "trigger còn đó không": đúng bài học [CR1]
  -- của Task 5 và (D1b) của Task 6 — "CREATE OR REPLACE FUNCTION ... BEGIN RETURN NULL; END"
  -- giữ nguyên tên hàm, tên trigger, tgfoid và tgenabled, nhưng biến phép canh D3 thành no-op.
  THAN_PHAN_TACH constant text := $tpt$
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

  -- Thân hàm canh D3 Ở MỨC VAI TRÒ. Bản NGUỒN ở db/migrations/005_identity.sql §(3).
  --
  -- LỆCH KHỎI ĐƠN THUỐC, CÓ ĐO — và đây là phép đo đáng ghi lại nhất của Task 8. Bản đầu của
  -- mục (E2) là một câu PHÁN XÉT đọc thẳng `public.role_permissions` ở thời điểm deploy. Nó gãy
  -- trên khuôn triển khai mà CHÍNH dự án này kiểm thử — superuser bootstrap một lần rồi mọi
  -- deploy sau chạy dưới role KHÔNG sở hữu bảng và KHÔNG có GRANT nào (db/migrations.int.test.ts
  -- "[fix round 4 — N2] nhánh 1"):
  --     Hardening hardening.always.sql (phan_xet) thất bại:
  --     permission denied for table role_permissions        (SQLSTATE 42501)
  -- migrate() chết trên một lược đồ HOÀN TOÀN ĐÚNG — đúng cái bẫy QT1 cấm. Nguyên nhân gốc là
  -- một tiền đề ngầm của cả file này mà không dòng nào nói ra: MỌI mục phán xét khác chỉ đọc
  -- pg_catalog, thứ mọi role đọc được. Mục đầu tiên đọc một BẢNG NGHIỆP VỤ là mục đầu tiên gãy.
  -- Ai thêm mục mới vào file này phải biết ràng buộc đó.
  --
  -- Bản vá KHÔNG phải "cấp thêm quyền cho role deploy" (nới một bảo đảm ra để mua một phép
  -- kiểm — đúng thứ QT2 cấm) mà là ĐỔI TẦNG: phép kiểm chuyển thành một trigger chạy trong
  -- phiên của NGƯỜI GHI VÀO CHÍNH BẢNG NÀY. Nó không đòi thêm quyền deploy nào. File này chỉ
  -- còn canh SỰ TỒN TẠI và THÂN của hàm + trigger đó, và việc ấy đọc thuần pg_catalog.
  --
  -- [vòng fix 1 — I3] TIỀN ĐỀ SAI ĐÃ SỬA. Bản trước viết "...tức NGƯỜI DUY NHẤT TẠO RA ĐƯỢC VI
  -- PHẠM." Câu đó SAI, và cả kiến trúc hai tầng dựa vào nó: D3 bị phá được bởi HAI người ghi
  -- KHÁC NHAU — người ghi `user_roles` (thêm vai trò cho một người) và người ghi
  -- `role_permissions` (thêm quyền cho một vai trò) — và MỖI TRIGGER CHỈ THẤY MỘT NỬA. Trục
  -- thứ hai KHÔNG có trigger nào canh, và không đóng được bằng một trigger thứ ba ở đây (đo
  -- được: FAIL-OPEN dưới FORCE RLS). Toàn bộ phép đo, ba đường vòng bị loại, và ba lớp thay thế
  -- nằm ở khối "[vòng fix 1 — C1] DƯ LƯỢNG ĐANG MỞ" của db/migrations/005_identity.sql §(3);
  -- lớp deploy-time là mục (E3) của chính file này.
  THAN_MA_TRAN constant text := $tmt$
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

  -- ---- [vòng fix 1 — C1] (E3) DỮ LIỆU, KHÔNG PHẢI HÌNH DẠNG ------------------------------
  -- Bài phê bình đắt nhất của vòng review: file này cưỡng chế HÌNH DẠNG tới từng byte thân hàm
  -- nhưng KHÔNG cưỡng chế MỘT HÀNG DỮ LIỆU NÀO — và ma trận quyền LÀ dữ liệu. Hai mục (E1)/(E2)
  -- dựng lại trigger hoàn hảo rồi để nguyên một vi phạm nằm sẵn đi qua migrate() không tiếng
  -- động. Mục (E3) là lớp deploy-time DUY NHẤT đọc dữ liệu thật của bảng đó.
  --
  -- Năm mã quyền của chuỗi D3, bản THỨ SÁU. Năm bản kia: SEPARATION_OF_DUTIES_CHAIN
  -- (packages/identity/src/permissions.ts) và bốn thân hàm (hai ở 005_identity.sql, hai ở file
  -- này). Meta-test packages/identity/src/ma-tran-quyen.test.ts khoá cả sáu.
  CHUOI_D3 constant text :=
    $q$'rfq.create', 'rfq.invite', 'rfq.unseal', 'award.recommend', 'po.approve'$q$;

  -- MỐC GHIM (QT2 — ghim cấu hình, đừng nới bảo đảm): những CẶP vai trò mà HỢP của hai vai trò
  -- phủ trọn chuỗi trong ma trận mặc định của 005. Đo bằng cách liệt kê cả 63 tổ hợp con khác
  -- rỗng của sáu vai trò: 32 tổ hợp phủ trọn, và tập TỐI TIỂU gồm đúng ba cặp này (không có bộ
  -- ba tối tiểu nào). Bản song sinh: `CHAIN_COVERING_ROLE_PAIRS` ở
  -- packages/identity/src/permissions.ts, cùng thứ tự, meta-test khoá cả hai.
  --
  -- Vì sao GHIM chứ không đòi "không cặp nào được phủ trọn": quy tắc đó KHÔNG THOẢ ĐƯỢC —
  -- PROCUREMENT_MANAGER+DIRECTOR phủ trọn chuỗi là điều 005 đã nói ra và là ĐÚNG CA mà trigger
  -- mức người dùng sinh ra để chặn. Cái đáng canh là tập ấy LỚN LÊN, vì một cặp mới nghĩa là
  -- những người đang giữ sẵn cặp đó vừa lặng lẽ nắm trọn chuỗi.
  CAP_PHU_CHUOI constant text :=
    $q$(('BUYER','DIRECTOR'),('FINANCE','PROCUREMENT_MANAGER'),('DIRECTOR','PROCUREMENT_MANAGER'))$q$;

  -- `r1.code <= r2.code` (KHÔNG phải `<`): vế bằng cho ra cặp (X, X), tức phủ đơn lẻ — đúng ca
  -- "một vai trò ôm trọn chuỗi ĐÃ NẰM SẴN trong bảng", thứ trigger của (E2) không bao giờ thấy
  -- vì nó chỉ bắn trên hàng MỚI. Không cặp (X, X) nào nằm trong mốc ghim, nên mọi ca như thế
  -- đều được báo.
  CAU_CAP_PHU_CHUOI constant text :=
    $q$SELECT r1.code AS vai_1, r2.code AS vai_2
         FROM public.roles r1
         JOIN public.roles r2 ON r1.code <= r2.code
        WHERE NOT EXISTS (
                SELECT 1 FROM unnest(ARRAY[$q$ || CHUOI_D3 || $q$]) AS chuoi(ma)
                 WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                                    WHERE rp.role_code IN (r1.code, r2.code)
                                      AND rp.permission_code = chuoi.ma))
          AND (r1.code, r2.code) NOT IN $q$ || CAP_PHU_CHUOI;

  -- Thân hàm băm. Bản NGUỒN nằm ở db/migrations/004_audit_chain_functions.sql.
  -- Vì sao nó PHẢI được cưỡng chế, và vì sao nó là mục quan trọng nhất mà Task 6 thêm vào file
  -- này: bộ kiểm chứng chuỗi TÍNH LẠI băm BẰNG CHÍNH HÀM NÀY (đó là điều loại bỏ lớp lỗi lệch
  -- tuần tự hoá giữa hai tầng). Hệ quả là nếu ai đó thay thân hàm — ví dụ
  --     CREATE OR REPLACE FUNCTION public.audit_compute_hash(...) ... SELECT sha256(''::bytea);
  -- thì MỌI hàng cũ lẫn mới đều băm ra cùng một giá trị, chuỗi vẫn "khớp" ở mọi mắt xích, và bộ
  -- kiểm chứng báo HỢP LỆ trên một sổ mà nội dung không còn bị ràng buộc bởi băm nào cả. KHÔNG
  -- lớp nào khác trong dự án bắt được ca đó: trigger vẫn đúng tên, đúng hàm, đúng tgtype.
  -- [vòng fix 1 — CR1] v2: tiền ảnh nay phủ ĐỦ 13 cột dữ liệu của audit_events (`id`, `ip`,
  -- `user_agent` được thêm; `prev_hash` đi vào sha256 ở dạng byte và `hash` là đầu ra). Bản v1
  -- bỏ ba cột đó ra ngoài, và hằng NÀY lặp lại y hệt thiếu sót ấy nên bản cưỡng chế cũng mù y
  -- hệt — xem lập luận đo được ở 004_audit_chain_functions.sql §(1).
  THAN_BAM constant text := $tbm$
  SELECT pg_catalog.sha256(
    p_prev_hash OPERATOR(pg_catalog.||) pg_catalog.convert_to(
      (pg_catalog.jsonb_build_object(
        'v',             'trustprocure.audit.v2',
        'id',            p_id,
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
        'request_id',    p_request_id,
        'ip',            p_ip,
        'user_agent',    p_user_agent
      ))::pg_catalog.text,
      'UTF8'
    )
  )
$tbm$;

  -- Chữ ký đầy đủ, dùng lại ở cả câu cưỡng chế lẫn hậu điều kiện. Viết một lần để hai bên không
  -- trôi khỏi nhau.
  CHU_KY_BAM constant text :=
    $q$public.audit_compute_hash(bytea, uuid, uuid, bigint, timestamptz, text, uuid, text, text, uuid, jsonb, uuid, inet, text)$q$;
  THAM_SO_BAM constant text :=
    $q$(p_prev_hash bytea, p_id uuid, p_org_id uuid, p_seq bigint, p_occurred_at timestamptz,
        p_actor_type text, p_actor_id uuid, p_action text, p_resource_type text,
        p_resource_id uuid, p_payload jsonb, p_request_id uuid, p_ip inet, p_user_agent text)$q$;

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
                       NEW.prev_hash, NEW.id, NEW.org_id, NEW.seq, NEW.occurred_at,
                       NEW.actor_type, NEW.actor_id, NEW.action, NEW.resource_type,
                       NEW.resource_id, NEW.payload, NEW.request_id, NEW.ip, NEW.user_agent);
  RETURN NEW;
END
$tnc$;

  -- [vòng fix 1 — IM4] Thân hàm chốt mốc neo. Bản NGUỒN ở 004_audit_chain_functions.sql §(5);
  -- meta-test §R3 trong db/audit-append-only.int.test.ts canh hai bản.
  THAN_MOC_NEO constant text := $tmn$
DECLARE
  dau_seq bigint;
  dau_bam bytea;
BEGIN
  SELECT ae.seq, ae.hash INTO dau_seq, dau_bam
    FROM public.audit_events ae
   WHERE ae.org_id = NEW.org_id
   ORDER BY ae.seq DESC
   LIMIT 1;

  IF dau_seq IS NULL THEN
    RAISE EXCEPTION 'Không neo được: tổ chức % chưa có sự kiện kiểm toán nào đọc được', NEW.org_id;
  END IF;

  NEW.seq  := dau_seq;
  NEW.hash := dau_bam;
  RETURN NEW;
END
$tmn$;

  -- [vòng fix 1 — CR3] Thân HÀM GHI. `public.audit_append` là ĐƯỜNG GHI DUY NHẤT của sổ và vòng
  -- trước KHÔNG canh nó chút nào: (D1a) canh hàm băm, (D1b) canh hàm nối chuỗi, (D2) canh
  -- trigger — điểm VÀO của đường ghi bỏ trống. Đo được, và nó nặng hơn hẳn ca (a) mà 004 tự
  -- loại trừ:
  --     CREATE OR REPLACE FUNCTION public.audit_append(...cùng chữ ký...) LANGUAGE plpgsql ...
  --       IF p_action LIKE 'BI_MAT%' THEN  -- nuốt CÓ CHỌN LỌC, trả seq/hash GIẢ nhìn rất thật
  --     app_api gọi -> seq 4, hash 2d711642...  (người gọi THẤY một lần ghi audit THÀNH CÔNG)
  --     SELECT FROM audit_events -> chỉ 1,2,3    (KHÔNG ghi gì)
  --     verifyAuditChain -> {"ok":true,"checked":3} ; MIGRATE OK
  --     pg_proc.prosrc VẪN chứa "nuot su kien"   <- SỐNG SÓT QUA DEPLOY, VÔ THỜI HẠN
  -- Hai biện pháp bù mà báo cáo nêu cho ca (a) — "danh sách trắng trigger" và "cưỡng chế thân
  -- hàm" — KHÔNG cái nào áp dụng: không trigger nào dính líu, và không mục thân-hàm nào phủ
  -- audit_append. Ngôn ngữ còn đổi từ `sql` sang `plpgsql` mà không gì nhận ra, nên hậu điều
  -- kiện của (D1c) canh cả `prolang`.
  THAN_GHI constant text := $ham$
  INSERT INTO public.audit_events (org_id, actor_type, actor_id, action, resource_type,
                                   resource_id, payload, request_id, ip, user_agent)
  VALUES (p_org_id, p_actor_type, p_actor_id, p_action, p_resource_type, p_resource_id,
          coalesce(p_payload, '{}'::pg_catalog.jsonb), p_request_id, p_ip, p_user_agent)
  RETURNING audit_events.id, audit_events.seq, audit_events.prev_hash,
            audit_events.hash, audit_events.occurred_at;
$ham$;

  CHU_KY_GHI constant text :=
    $q$public.audit_append(uuid, text, uuid, text, text, uuid, jsonb, uuid, inet, text)$q$;
  THAM_SO_GHI constant text :=
    $q$(p_org_id uuid, p_actor_type text, p_actor_id uuid, p_action text, p_resource_type text,
        p_resource_id uuid, p_payload jsonb, p_request_id uuid, p_ip inet, p_user_agent text)$q$;
  -- Danh sách cột trả về, viết một lần: nó vừa vào câu CREATE, vừa vào vế nhận diện "hình dạng
  -- trả về đã bị đổi" của DROP có điều kiện.
  TRA_VE_GHI constant text :=
    $q$TABLE (id uuid, seq bigint, prev_hash bytea, hash bytea, occurred_at timestamptz)$q$;
  TEN_COT_GHI constant text :=
    $q$ARRAY['p_org_id','p_actor_type','p_actor_id','p_action','p_resource_type','p_resource_id',
             'p_payload','p_request_id','p_ip','p_user_agent',
             'id','seq','prev_hash','hash','occurred_at']$q$;

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
         -- [Task 6] Trigger nối chuỗi, chỉ trên bảng MANG ĐÚNG HÌNH DẠNG sổ sự kiện.
         -- tgtype = 7 đã ĐO trên PostgreSQL 16.15 cho BEFORE INSERT FOR EACH ROW
         -- (ROW=1 | BEFORE=2 | INSERT=4), cùng khuôn "so tgtype NGUYÊN VĂN" của ba trigger
         -- trên: mất bit BEFORE là trigger chạy SAU khi hàng đã vào bảng nên nó không đặt
         -- được seq/hash nữa.
         -- [vòng fix 1 — IM2] Vế lọc là HÌNH DẠNG, không phải relname — xem MAU_HINH_DANG_SO.
         SELECT b.bang_oid, b.relname, b.trong_ds,
                b.relname || '_noi_chuoi', 'INSERT', 'FOR EACH ROW', 7,
                $q$ || HAM_NOI_CHUOI || $q$, 'public.noi_chuoi_kiem_toan()'
           FROM bang_al b
          WHERE $q$ || pg_catalog.format(MAU_HINH_DANG_SO, 'b') || $q$
         UNION ALL
         -- [vòng fix 1 — IM4] Trigger chốt mốc neo, chỉ trên bảng MANG HÌNH DẠNG bảng neo.
         SELECT b.bang_oid, b.relname, b.trong_ds,
                b.relname || '_moc_neo', 'INSERT', 'FOR EACH ROW', 7,
                $q$ || HAM_MOC_NEO || $q$, 'public.chot_moc_neo()'
           FROM bang_al b
          WHERE $q$ || pg_catalog.format(MAU_HINH_DANG_NEO, 'b') || $q$
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
            'audit_events_noi_chuoi và audit_chain_anchors_moc_neo của 004) được phép tồn tại trên bảng sổ.' AS mo_ta
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
        WHERE a.grantee <> c.relowner AND a.privilege_type = 'UPDATE'
       UNION ALL
       -- [vòng fix 1 — M1] LỚP (A) CỦA TASK 6 KHÔNG ĐƯỢC CANH. 004 phát
       -- "REVOKE INSERT (seq, prev_hash, hash) ON audit_events" và "REVOKE INSERT (seq, hash)
       -- ON audit_chain_anchors", nhưng mục ACL này chỉ phát REVOKE UPDATE/DELETE/TRUNCATE và
       -- REVOKE UPDATE (cột) — nên một "GRANT INSERT (seq, prev_hash, hash) ON audit_events TO
       -- app_api" SỐNG SÓT MỌI DEPLOY. Chưa khai thác được hôm nay (lớp B ghi đè: đã đo
       -- "INSERT seq=2^63-1 RETURNING seq" -> 5), nhưng đó là ĐÚNG NGUYÊN VĂN tiền lệ mà
       -- 003:32-38 ghi lại cho UPDATE/DELETE — đã sửa ở đó và để mở ở đây.
       -- Danh sách cột là ĐÓNG và viết tay, không suy ra: `seq`, `prev_hash`, `hash` là ba cột
       -- mà DATABASE quyết định. Cấm INSERT ở MỨC BẢNG thì không được — 003 cố ý cấp INSERT
       -- theo cột cho 10 cột hợp lệ, và cấm mức bảng sẽ đóng luôn đường ghi hợp lệ.
       SELECT b.bang_oid, b.relname, a.privilege_type, att.attname::text,
              CASE WHEN vai.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(vai.rolname) END
         FROM bang_so b JOIN pg_class c ON c.oid = b.bang_oid
         JOIN pg_attribute att ON att.attrelid = b.bang_oid AND att.attnum > 0
                              AND NOT att.attisdropped
                              AND att.attname IN ('seq', 'prev_hash', 'hash')
         CROSS JOIN LATERAL aclexplode(att.attacl) a
         LEFT JOIN pg_roles vai ON vai.oid = a.grantee
        WHERE a.grantee <> c.relowner AND a.privilege_type = 'INSERT'$q$;

  CAU_QUYEN_BANG_SO_MO_TA constant text :=
    CTE_TRIGGER_CHAN || $q$
     SELECT q.bang_oid::regclass::text || ': quyền ' || q.quyen || ' cấp cho ' || q.ai
            || coalesce(' trên cột ' || q.cot, '')
            || CASE WHEN q.quyen = 'INSERT'
                    THEN ' — seq/prev_hash/hash do DATABASE quyết định, không bên ghi nào được '
                         'cấp INSERT trên chúng'
                    ELSE ' — bảng sổ chỉ được cấp SELECT và INSERT (INSERT theo cột)' END AS mo_ta
       FROM ($q$ || CAU_QUYEN_BANG_SO_SAI || $q$) q$q$;

  -- ==========================================================================================
  -- [S1.20 / sổ nợ 3 + 16] BỐN DANH SÁCH TÊN CUỐI CÙNG CỦA FILE NÀY, VÀ TÍNH CHẤT THAY CHO CHÚNG
  -- ==========================================================================================
  -- Khoản nợ 16 tố cáo một bất đối xứng: `bang_so` nhận bảng theo HAI TÊN VIẾT CỨNG trong khi
  -- `bang_al` nhận bảng lạ theo TÍNH CHẤT. Nó dự báo *"bảng báo giá S1 sẽ rơi thẳng vào đó"*.
  --
  -- DỰ BÁO ẤY ĐÃ THÀNH HIỆN THỰC. S1 dựng một hàm canh chỉ-ghi-thêm THỨ HAI —
  -- `public.bid_chi_ghi_them()` — cắm trên BA bảng (`bid_receipts`, `rfq_unsealed_bids`,
  -- `vendor_bid_versions`). Cả ba nằm ngoài `bang_so` (không có trong danh sách hai tên) VÀ ngoài
  -- `bang_al` (vế bảng-lạ khoá theo OID của `chan_sua_xoa`). Đo trên PostgreSQL 16, sau một lượt
  -- `migrate()` sạch, mỗi lần trả `applied=[]` và KHÔNG một lỗi nào:
  --
  --     ALTER TABLE bid_receipts SET UNLOGGED               -> MIGRATE OK, relpersistence còn 'u'
  --     GRANT UPDATE, DELETE ON bid_receipts TO app_api     -> MIGRATE OK, acl còn `app_api=rwd`
  --     TRUNCATE public.bid_receipts                        -> **OK** (audit_events thì NÉM)
  --
  -- Vế thứ ba là lỗ mà chính khoản nợ 16 KHÔNG nêu, và nó nặng hơn hai vế kia — xem `047`.
  --
  -- TÍNH CHẤT THAY CHO DANH SÁCH: **một bảng là CHỈ-GHI-THÊM khi nó mang CẢ HAI trigger
  -- BEFORE-ROW-UPDATE và BEFORE-ROW-DELETE mà hàm của chúng KHÔNG BAO GIỜ TRẢ VỀ** (thân plpgsql
  -- không chứa `RETURN` nào). Một hàm trigger không trả về thì chỉ có thể NÉM.
  --
  -- VẾ `RETURN` LÀ CẦN, KHÔNG THỪA — có phản ví dụ THẬT trong kho: `rfq_items_cam_truncate`
  -- (011) cũng có thân `BEGIN RAISE EXCEPTION … END` không `RETURN`, nhưng nó là trigger TRUNCATE
  -- CẤP CÂU LỆNH. `rfq_items` KHÔNG chỉ-ghi-thêm — nó sửa và xoá được khi RFQ còn DRAFT. Vế "cả
  -- UPDATE lẫn DELETE, CẤP HÀNG" (`tgtype & 19 = 19` và `tgtype & 11 = 11`) là thứ loại nó ra.
  --
  -- CHIỀU GIẢ MẠO: cắm thêm một trigger luôn-ném là THÊM bảng vào vùng canh. Gỡ bảng ra khỏi vùng
  -- canh đòi viết lại thân hàm thành một hàm CÓ `RETURN` — và đường ấy đã có lớp khác đứng: mỗi
  -- hàm `RETURNS trigger` trong `public` đều có một mục ghim thân trong chính file này, và
  -- `db/migrations.int.test.ts` [S1.14/S1.15] giữ cho danh sách loại trừ RỖNG.
  --
  -- BA MỤC DƯỚI ĐÂY CHỈ **PHÁN XÉT**, KHÔNG TỰ CHỮA — và đó là [CR4] phát biểu ở dạng khẳng định:
  -- **tự chữa chỉ trên thứ một migration đánh số sở hữu theo TÊN; thứ SUY RA thì chỉ phán xét.**
  -- Mục ACL của `bang_so` (mục (D4)) vẫn tự chữa vì hai bảng ấy có tên trong `BANG_CHI_GHI_THEM`;
  -- ba bảng của S1 có tên trong mục ghim `bid_chi_ghi_them (047)` nên trigger của chúng vẫn được
  -- dựng lại. Một bảng chỉ-ghi-thêm TƯƠNG LAI mà chưa ai ghim thì được BÁO RA kèm hướng dẫn,
  -- không bị `migrate()` tự tay đổi ngữ nghĩa.
  --
  -- VẾ KHÔNG TỔNG QUÁT HOÁ ĐƯỢC, và khoản nợ 16 đòi đúng lời giải thích này: `UNIQUE (org_id,
  -- seq)` gắn với CHUỖI HASH, không với tính chỉ-ghi-thêm — `bid_receipts` không có cột `seq`, và
  -- một RFQ có nhiều báo giá song song nên không có thứ tự toàn cục nào để đánh số. Ràng buộc ấy
  -- VẪN chỉ áp cho `bang_so`, và bất đối xứng ấy nay có lý do đọc được thay vì đứng trần.
  -- [review lượt 12, H2] VẾ SCHEMA PHẢI GIỐNG `MAU_SCHEMA_DU_AN`, KHÔNG ĐƯỢC KHOÁ CỨNG
  -- `nspname = 'public'`. Bản đầu của vòng này viết khoá cứng, và đó là **tái lập đúng thứ [CR2a]
  -- đã CỐ Ý gỡ khỏi `bang_so`**: một bảng chỉ-ghi-thêm ra đời ở `app_private` (schema mà chính
  -- file này tạo) sẽ UNLOGGED được, TRUNCATE được, và nhận `GRANT UPDATE` sống qua mọi deploy —
  -- đúng ba lỗ vòng này vừa tuyên bố đã đóng. Vế dưới đây là `MAU_SCHEMA_DU_AN` đã KHAI TRIỂN cho
  -- bí danh `n` (`%%` của format() thành `%` thật); `db/hardening-suy-tu-tinh-chat.int.test.ts`
  -- có một khẳng định so nó với chính hằng ấy, nên hai bên không trôi khỏi nhau được.
  --
  -- [review lượt 12, M4] `prolang = plpgsql` đóng CHIỀU ỒN ÀO của phép so khớp văn bản: `prosrc`
  -- của một hàm `LANGUAGE internal`/`c` là TÊN SYMBOL (đã đo: `suppress_redundant_updates_trigger`
  -- có `prosrc = 'suppress_redundant_updates_trigger'`, `lanname = 'internal'`) — không chứa
  -- `RETURN`, nên không có vế này thì hai trigger dựng sẵn của PostgreSQL đủ để một bảng bị nhận
  -- nhầm là chỉ-ghi-thêm và bị đòi LOGGED + chốt TRUNCATE + ACL sạch, tức CHẶN DEPLOY trên một
  -- lược đồ hợp lệ. ~~Chiều IM LẶNG (một hàm canh viết kiểu khác rơi khỏi tập) vẫn mở — khoản nợ 60.~~
  -- [S1.29] Vế thứ hai của OR là KHAI BÁO: một hàm canh viết kiểu khác (có RETURN) vào tập bằng
  -- cách được KÊ TÊN ở đây — và danh sách này phải BẰNG `HAM_CANH_CHI_GHI_THEM` của
  -- db/hardening-suy-tu-tinh-chat.int.test.ts, vì test ấy đòi vị từ này xuất hiện NGUYÊN VĂN.
  -- Tổng điều tra ở cùng tệp bắt MỌI hàm trigger BEFORE-ROW UPDATE/DELETE phải được phân loại,
  -- nên một hàm canh mới không rơi khỏi tập trong im lặng: nó chặn cổng cho tới khi có tên ở đây.
  VI_TU_BANG_CHI_GHI_THEM constant text :=
    $q$SELECT c.oid AS bang_oid, c.relname, c.relpersistence, c.relowner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp%'
          AND c.relkind IN ('r', 'p')
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
                  AND (p.prosrc !~* '\mRETURN\M'
                       OR (p.pronamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace
                           AND p.proname IN ('bid_chi_ghi_them', 'chan_sua_xoa')))
                  AND (t.tgtype OPERATOR(pg_catalog.&) 19::pg_catalog.int2) OPERATOR(pg_catalog.=) 19) OPERATOR(pg_catalog.>) 0
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
                  AND (p.prosrc !~* '\mRETURN\M'
                       OR (p.pronamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace
                           AND p.proname IN ('bid_chi_ghi_them', 'chan_sua_xoa')))
                  AND (t.tgtype OPERATOR(pg_catalog.&) 11::pg_catalog.int2) OPERATOR(pg_catalog.=) 11) OPERATOR(pg_catalog.>) 0$q$;

  -- Trạng thái VẬT LÝ của MỌI bảng chỉ-ghi-thêm: LOGGED, và có chốt TRUNCATE.
  CAU_CHI_GHI_THEM_VAT_LY constant text :=
    $q$SELECT b.bang_oid::regclass::text || ': bảng CHỈ-GHI-THÊM đang UNLOGGED (relpersistence='
              || b.relpersistence::text || ') — mọi hàng biến mất sau lần crash kế tiếp. [CR5] đã '
                 'đo bằng SIGKILL postgres thật: trước-crash 4 hàng, sau-crash 0. Sửa: '
                 'ALTER TABLE … SET LOGGED.' AS mo_ta
         FROM ($q$ || VI_TU_BANG_CHI_GHI_THEM || $q$) b
        WHERE b.relpersistence <> 'p'
       UNION ALL
       SELECT b.bang_oid::regclass::text || ': bảng CHỈ-GHI-THÊM không có chốt TRUNCATE ĐANG BẬT. '
                 'Trigger cấp HÀNG không bao giờ chạy cho TRUNCATE — một câu lệnh xoá sạch bảng '
                 'trong khi UPDATE và DELETE đều bị chặn. Sửa: một migration đánh số MỚI thêm '
                 'trigger BEFORE TRUNCATE FOR EACH STATEMENT gọi cùng hàm canh, kèm ENABLE ALWAYS '
                 '(xem 047). NẾU ĐÂY LÀ MỘT PHÂN MẢNH: chốt trên bảng CHA KHÔNG phủ LÁ — đã đo, '
                 'TRUNCATE thẳng vào lá đi lọt — nên MỖI phân mảnh cần chốt của riêng nó.' AS mo_ta
         FROM ($q$ || VI_TU_BANG_CHI_GHI_THEM || $q$) b
        WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                           WHERE t.tgrelid = b.bang_oid AND NOT t.tgisinternal
                             AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                             AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
                             AND (p.prosrc !~* '\mRETURN\M'
                                  OR (p.pronamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace
                                      AND p.proname IN ('bid_chi_ghi_them', 'chan_sua_xoa')))
                             AND t.tgenabled OPERATOR(pg_catalog.=) 'A'
                             AND (t.tgtype OPERATOR(pg_catalog.&) 34::pg_catalog.int2)
                                 OPERATOR(pg_catalog.=) 34)$q$;

  -- ACL của MỌI bảng chỉ-ghi-thêm. Đo trước khi viết mục này, để chắc nó không thu hồi một quyền
  -- ĐANG DÙNG: `relacl` của ba bảng S1 chỉ mang `r` (SELECT), `attacl` chỉ mang `r` và `a`
  -- (INSERT theo cột) — KHÔNG một quyền UPDATE/DELETE/TRUNCATE nào được cấp hôm nay. Mục này vì
  -- thế khoá một cánh cửa đang đóng, đúng lập luận [IM2] đã dùng cho bảng sổ.
  --
  -- [review lượt 12, M1] NHÁNH `attacl` LÀ BẮT BUỘC, KHÔNG PHẢI ĐẦY ĐỦ CHO ĐẸP. Quyền mức CỘT nằm
  -- ở `pg_attribute.attacl` và **vô hình với `relacl`** — 003:362-364 đã ghi đúng điều đó, và mục
  -- ACL của `bang_so` có sẵn nhánh ấy từ vòng fix 1. Bản đầu của vòng này quên nó, tức tái tạo
  -- đúng lỗ đã được vá một lần. Kịch bản đo được:
  --     GRANT UPDATE (canonical_text) ON public.bid_receipts TO app_api;
  -- không xuất hiện trong `relacl` ⇒ mục XANH ⇒ sống qua mọi `migrate()`. Trong cửa sổ phơi mà
  -- 003 thừa nhận (`DISABLE TRIGGER`), lớp trigger không đứng và `app_api` sửa được
  -- `canonical_text` — tức chính chuỗi ĐƯỢC KÝ của biên nhận. Đây chạm thẳng **B2**.
  -- `attacl` chỉ lưu được SELECT/INSERT/UPDATE/REFERENCES nên ở mức cột chỉ cần cấm UPDATE;
  -- DELETE và TRUNCATE không tồn tại ở mức cột, nên `relacl` là đầy đủ cho hai quyền ấy.
  CAU_CHI_GHI_THEM_QUYEN constant text :=
    $q$SELECT b.bang_oid::regclass::text || ': quyền ' || a.privilege_type || ' cấp cho '
              || CASE WHEN vai.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(vai.rolname) END
              || ' — bảng CHỈ-GHI-THÊM chỉ được cấp SELECT và INSERT. Quyền này SỐNG QUA MỌI '
                 'DEPLOY nếu không có mục này. Sửa: REVOKE … CASCADE.' AS mo_ta
         FROM ($q$ || VI_TU_BANG_CHI_GHI_THEM || $q$) b
         JOIN pg_class c ON c.oid = b.bang_oid
         CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         LEFT JOIN pg_roles vai ON vai.oid = a.grantee
        WHERE a.grantee <> c.relowner
          AND a.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
       UNION ALL
       SELECT b.bang_oid::regclass::text || ': quyền ' || a.privilege_type || ' trên cột '
              || pg_catalog.quote_ident(att.attname) || ' cấp cho '
              || CASE WHEN vai.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(vai.rolname) END
              || ' — quyền mức CỘT vô hình với relacl. Sửa: REVOKE UPDATE (cột) … CASCADE.' AS mo_ta
         FROM ($q$ || VI_TU_BANG_CHI_GHI_THEM || $q$) b
         JOIN pg_class c ON c.oid = b.bang_oid
         JOIN pg_attribute att ON att.attrelid = b.bang_oid AND att.attnum > 0
                              AND NOT att.attisdropped
         CROSS JOIN LATERAL aclexplode(att.attacl) a
         LEFT JOIN pg_roles vai ON vai.oid = a.grantee
        WHERE a.grantee <> c.relowner AND a.privilege_type = 'UPDATE'$q$;

  -- [S1.20 / sổ nợ 16] BẢNG SỔ KHÔNG ĐƯỢC CÓ CỘT NÀO NGOÀI CHUỖI HASH.
  --
  -- `MAU_HINH_DANG_SO` là một phép ĐẾM: `count(attname IN (15 tên)) = 15`. Thêm một cột thứ 16 vẫn
  -- cho ra 15. Đo được: `ALTER TABLE audit_events ADD COLUMN payload_plaintext text` -> MIGRATE OK,
  -- `applied=[]`, không mục nào chạm. Và chú thích của chính vị từ ấy còn viết *"THÊM cột thì an
  -- toàn"* — câu đó ĐÚNG cho câu hỏi mà vị từ ấy trả lời (*"thân trigger dereference đủ 15 trường
  -- chứ?"*), và đó chính là chỗ HAI CÂU HỎI KHÁC NHAU bị nhập làm một. Câu hỏi thứ hai — *"sổ có
  -- chứa gì mà chuỗi hash không phủ không?"* — chưa từng có ai hỏi.
  --
  -- VÌ SAO NÓ QUAN TRỌNG: `noi_chuoi_kiem_toan()` băm ĐÚNG 15 trường (hằng `COT_SO` là nguồn duy
  -- nhất cho cả thân hàm lẫn vị từ hình dạng). Một cột thứ 16 là nội dung sống TRONG sổ kiểm toán
  -- mà chuỗi hash KHÔNG phủ: sửa nó không làm chuỗi gãy, và `verifyAuditChain` không thấy gì. B3
  -- nói *"bộ kiểm chứng phát hiện được chèn, sửa, xoá và cắt đuôi"* — mệnh đề ấy nói về HÀNG; một
  -- cột ngoài chuỗi là một đường ghi vào sổ mà mệnh đề ấy không với tới. Và cái tên
  -- `payload_plaintext` không phải ví dụ ngẫu nhiên: nó là đúng hình dạng của **A2**.
  --
  -- MỤC NÀY CHỈ PHÁN XÉT (không tự `DROP COLUMN`): xoá một cột là xoá dữ liệu, và [CR4] cấm
  -- `migrate()` tự tay làm thế. Hướng sửa đúng nằm trong chính thông điệp.
  --
  -- `COT_NEO` là tập PHÂN BIỆT (bốn tên đủ để nhận ra một bảng mốc neo), không phải tập ĐẦY ĐỦ —
  -- bảng neo thật có năm cột, thêm `id`. Hai câu hỏi khác nhau, nên hai hằng khác nhau.
  COT_NEO_DAY_DU constant text := COT_NEO || $q$, 'id'$q$;

  CAU_COT_NGOAI_CHUOI constant text :=
    $q$SELECT 'public.audit_events: có cột NGOÀI chuỗi hash — {'
              || pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attname)
              || '}. `noi_chuoi_kiem_toan()` băm ĐÚNG 15 trường, nên nội dung của cột này nằm '
                 'TRONG sổ kiểm toán mà chuỗi hash KHÔNG phủ: sửa nó không làm chuỗi gãy và bộ '
                 'kiểm chứng không thấy gì (nền của B3). Sửa: một migration đánh số MỚI bỏ cột, '
                 'hoặc — nếu cột thật sự thuộc về sổ — đưa nó vào COT_SO và vào thân hàm nối '
                 'chuỗi CÙNG LÚC.' AS mo_ta
         FROM pg_attribute a
        WHERE a.attrelid = to_regclass('public.audit_events') AND a.attnum > 0
          AND NOT a.attisdropped AND a.attname NOT IN ($q$ || COT_SO || $q$)
       HAVING pg_catalog.count(*) > 0
       UNION ALL
       SELECT 'public.audit_chain_anchors: có cột NGOÀI mốc neo — {'
              || pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attname)
              || '}. Cùng lý do: `chot_moc_neo()` chỉ chốt org_id/seq/hash/anchored_at.' AS mo_ta
         FROM pg_attribute a
        WHERE a.attrelid = to_regclass('public.audit_chain_anchors') AND a.attnum > 0
          AND NOT a.attisdropped AND a.attname NOT IN ($q$ || COT_NEO_DAY_DU || $q$)
       HAVING pg_catalog.count(*) > 0$q$;

  -- ==========================================================================================
  -- [S1.20 / sổ nợ 3] NỬA ĐẦU CỦA KHOẢN NỢ 3 ĐÃ ĐƯỢC PHÉP ĐO **BÁC BỎ** — KHÔNG CÓ MỤC MỚI
  -- ==========================================================================================
  -- Khoản nợ 3 viết: *"`NOBYPASSRLS` chỉ ghim đúng BỐN TÊN ROLE"*, và vòng này bắt đầu bằng việc
  -- dựng một mục thứ năm suy từ tính chất (`pg_has_role(…, 'MEMBER')` với cây app_api/app_unseal).
  -- Mục ấy ĐÃ ĐƯỢC VIẾT, ĐÃ CHẠY, và ĐÃ BỊ GỠ, vì phép đo cho thấy tiền đề của khoản nợ sai.
  --
  -- ĐO ĐƯỢC (PostgreSQL 16, một lượt `migrate()` sạch):
  --     cây role của dự án TRƯỚC     : {app_api, app_unseal}
  --     CREATE ROLE ke_gian BYPASSRLS NOLOGIN; GRANT app_api TO ke_gian;
  --     cây role SAU GRANT           : {app_api, app_unseal, ke_gian(bypassrls)}
  --     migrate()                    : OK
  --     cây role SAU migrate()       : {app_api, app_unseal}      <-- ke_gian ĐÃ RỜI CÂY
  --
  -- **BƯỚC 1 thu hồi mọi tư cách thành viên LẠ** của app_api/app_unseal và của hai role đăng nhập
  -- được danh sách trắng. Nên tập "role trong cây dự án" LUÔN BẰNG tập bốn tên đã ghim — và cả
  -- bốn đều bị ghim `NOBYPASSRLS`. Cửa mà khoản nợ 3 mô tả có thật, nhưng nó **đã đóng, bởi một
  -- lớp KHÁC với lớp mà khoản nợ chỉ tên.**
  --
  -- VÌ SAO GỠ THAY VÌ GIỮ CHO CHẮC: mục ấy KHÔNG tạo ra được một lượt ĐỎ nào — mọi đột biến nghĩ
  -- ra được đều bị BƯỚC 1 dọn trước khi nó kịp phán xét. Một cổng an ninh không bao giờ đỏ được là
  -- đúng thứ dự án gọi là **"xanh giả"**, và đã bắt hai mươi lần. Giữ nó là thêm một mục vào file
  -- nguy hiểm nhất kho mã để đổi lấy một cảm giác.
  --
  -- THỨ ĐO ĐƯỢC VÀ CÓ THỂ TRÔI thì được canh ở TẦNG TEST, nơi nó thuộc về:
  -- `db/hardening-suy-tu-tinh-chat.int.test.ts` khẳng định **cây role BẰNG tập tên được ghim**.
  -- Ngày một migration mở danh sách trắng cho role thứ năm, khẳng định ấy ĐỎ — và người mở phải
  -- ghim nó hoặc viết ra vì sao không cần. Đó là chỗ duy nhất cái trôi ấy nhìn thấy được.

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
    --
    -- =========================================================================================
    -- [vòng fix 1 — F3] CẢNH BÁO: VẾ `proconfig IS NULL` CỦA MỤC NÀY ĐANG CHỊU LỰC AN NINH
    -- =========================================================================================
    -- Vế ấy được viết ra vì lý do VỆ SINH ("thân và thuộc tính hàm phải khớp bản chuẩn" — mệnh
    -- đề SET chặn inlining, xem [fix round 5 — R3] ở đầu file). Nhưng nó ĐANG là thứ chặn một
    -- đường leo thang thật, và ai "cải thiện" nó theo QT3 — tức thêm
    -- `ALTER FUNCTION public.app_current_org_id() SET search_path = pg_catalog`, đúng thứ QT3
    -- khuyến khích và đúng thứ 005_identity.sql đã làm cho HAI hàm trigger D3 — sẽ MỞ ĐÚNG LỖ
    -- ĐÓ nếu tầng ứng dụng chưa được vá.
    --
    -- Cơ chế, đo trên PostgreSQL 16.15 với một schema `doc` mang `CREATE OPERATOR doc.=` trả
    -- `true` và `SET search_path = doc, pg_catalog, public` do chính phiên ứng dụng phát ra:
    --   proconfig = null (hôm nay): `NULLIF(...)` bên trong hàm này phân giải `=` dưới
    --     search_path NGƯỜI GỌI, toán tử thù địch làm hàm sập về NULL, RLS không thấy hàng nào,
    --     `assertTenantBound` ném TRƯỚC khi truy vấn dễ tổn thương chạy. FAIL-CLOSED, NHƯNG LÀ
    --     TÌNH CỜ.
    --   proconfig = search_path=pg_catalog: hàm chạy đúng, `assertTenantBound` qua, và khi ấy
    --     `hasPermission` (nếu viết `=` trần) trả TRUE cho po.approve, rfq.unseal, audit.read
    --     của một người chỉ có BUYER — sự thật cả ba là false. D1 SỤP HOÀN TOÀN.
    -- Tầng ứng dụng NAY ĐÃ ĐƯỢC VÁ (packages/identity/src/rbac.ts viết đủ `OPERATOR(pg_catalog.=)`
    -- — đo lại cùng kịch bản: false, false, false trong khi toán tử VẪN bị cướp), nên vế này
    -- không còn là lớp duy nhất. Nó vẫn được GIỮ NGUYÊN, và bất đối xứng với hai hàm trigger D3
    -- (được ghim) là CÓ CHỦ Ý: hàm này phải INLINE được vì mọi policy RLS gọi nó trên mọi hàng.
    -- Ai muốn đổi nó phải đọc khối này trước và kiểm rằng mọi truy vấn hỏi câu hỏi CÓ/KHÔNG về
    -- quyền đều đã viết đủ schema cho TOÁN TỬ, không chỉ cho tên bảng và tên hàm.
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

    -- ---- [S1.11 / 037 / review H3-4] Vị từ "đường ứng dụng" của ~~hai~~ BỐN trigger đăng nhập ----
    -- `la_duong_ung_dung(name)` là ĐIỂM ĐƠN: thay thân nó là đủ để 029 (phiên thiếu MFA) và 032
    -- (bí mật TOTP đã xác nhận) im lặng — `packages/db/src/vai-tro.int.test.ts` chứng minh đúng
    -- thế bằng đột biến. [S1.12 / review H4-7] 039 (phiên đã-MFA cần TOTP gần đây) và 040 (xoá hồ
    -- sơ TOTP cần yêu cầu đã duyệt) cũng đi qua vị từ này; ~~nhưng THÂN của ba hàm trigger mới
    -- (039, 040 ×2, 041) và máy trạng thái 040 (vô điều kiện, không qua vị từ) CHƯA được ghim ở
    -- đây — sổ nợ 51.~~ [S1.13 / sổ nợ 51] THÂN của năm hàm trigger ấy và định nghĩa sáu trigger
    -- nay được ghim ở khối [S1.13] ngay dưới mục ACL của vị từ này. Cùng mô hình đe doạ với R3 ở trên (một CREATE OR REPLACE sau triển khai
    -- đi qua migrate() mà không ai thấy), nên cùng lớp canh: thân đã chuẩn hoá + thuộc tính.
    -- KHÁC R3 ở tiền điều kiện: chỉ canh khi hàm ĐÃ TỒN TẠI — lượt hardening TRƯỚC vòng migration
    -- trên cụm mới chạy trước 037, và dựng hàm ở đây sẽ làm `CREATE FUNCTION` của 037 vỡ. Hàm bị
    -- DROP thì không tự chữa, nhưng không im lặng: hai trigger ném ngay ở câu ghi đầu tiên.
    -- Test đồng bộ hai bản thân hàm (037 ↔ file này): db/migrations.int.test.ts [S1.11].
    ARRAY[
      $q$định nghĩa hàm la_duong_ung_dung(name) (037)$q$,
      $q$to_regprocedure('public.la_duong_ung_dung(pg_catalog.name)') IS NOT NULL$q$,
      $q$CREATE OR REPLACE FUNCTION public.la_duong_ung_dung(ten_vai pg_catalog.name) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
AS $ham$
  SELECT pg_catalog.pg_has_role(current_user, ten_vai, 'USAGE')
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles r
        WHERE r.rolname OPERATOR(pg_catalog.=) current_user AND r.rolsuper
     )
$ham$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$SELECT pg_catalog.pg_has_role(current_user, ten_vai, 'USAGE') AND NOT EXISTS ( SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname OPERATOR(pg_catalog.=) current_user AND r.rolsuper )$than$
            AND p.provolatile = 's'
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 1
            AND p.prorettype = 'pg_catalog.bool'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.la_duong_ung_dung(pg_catalog.name)'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | volatile=' || p.provolatile::text
                          || ' secdef=' || p.prosecdef::text
                          || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.la_duong_ung_dung(pg_catalog.name)')),
                  'hàm public.la_duong_ung_dung(name) không tồn tại')$q$,
      $q$quyền sở hữu hàm la_duong_ung_dung(name) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$EXECUTE trên la_duong_ung_dung(name): PUBLIC không, app_api có (037)$q$,
      $q$to_regprocedure('public.la_duong_ung_dung(pg_catalog.name)') IS NOT NULL$q$,
      $q$REVOKE ALL ON FUNCTION public.la_duong_ung_dung(pg_catalog.name) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION public.la_duong_ung_dung(pg_catalog.name) TO app_api$q$,
      $q$(SELECT p.proacl IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
            AND has_function_privilege('app_api', p.oid, 'EXECUTE')
          FROM pg_proc p WHERE p.oid = to_regprocedure('public.la_duong_ung_dung(pg_catalog.name)'))$q$,
      $q$'ACL của public.la_duong_ung_dung(name) lệch: PUBLIC phải KHÔNG có EXECUTE, app_api phải CÓ'$q$,
      $q$quyền sở hữu hàm la_duong_ung_dung(name) hoặc SUPERUSER$q$
    ],

    -- ---- [S1.13 / sổ nợ 51 / review H4-7, H5-2, H5-5] Thân TÁM hàm trigger và định nghĩa MƯỜI trigger ----
    -- Cùng mô hình đe doạ với R3 và với `la_duong_ung_dung` ở trên: một `CREATE OR REPLACE FUNCTION
    -- … BEGIN RETURN NEW; END` sau triển khai giữ nguyên tên hàm, tên trigger, tgfoid, tgenabled —
    -- và biến phép canh thành no-op sống qua `migrate()`. Máy trạng thái 040 còn VÔ ĐIỀU KIỆN (không
    -- đi qua điểm đơn `la_duong_ung_dung`), nên chỉ ghim vị từ là chưa đủ. Mỗi mục: thân chuẩn hoá +
    -- thuộc tính hàm + ĐỊNH NGHĨA trigger (`pg_get_triggerdef`, gồm cả mệnh đề WHEN) + `tgenabled='A'`.
    -- [review H5-2] Tiền điều kiện là "MIGRATION NGUỒN ĐÃ ÁP DỤNG" (dòng trong `schema_migrations`,
    -- hoặc bảng do chính migration ấy tạo), KHÔNG phải "hàm đã tồn tại": một `DROP FUNCTION … CASCADE`
    -- xoá cả hàm lẫn trigger, và với tiền điều kiện "hàm tồn tại" mục này sẽ im lặng bỏ qua ở cả lượt
    -- sửa lẫn lượt phán xét — không như `la_duong_ung_dung` (caller ném), năm hàm này LÀ trigger, mất
    -- chúng là mất phép kiểm mà không ai kêu. Với tiền điều kiện mới, hàm mất được DỰNG LẠI. Lượt
    -- hardening TRƯỚC vòng migration trên cụm mới vẫn bỏ qua (migration nguồn chưa được ghi) nên
    -- `CREATE FUNCTION` của migration không vỡ. [review H5-5] Cùng lớp: 013 (`kiem_danh_tinh_theo_phien`
    -- — ~~thân, không ghim 21 trigger của nó~~ [S1.14 / sổ nợ 54] thân VÀ 19 trigger của nó; hai
    -- trigger còn lại thuộc 040 và được ghim ở mục `mfa_reset_kiem_quyen`), 029/032 qua bản 037, và
    -- hai trigger danh tính của 040. Mười chín trigger ấy nằm rải ở BẢY migration (013/014/016/017/
    -- 019/022/026) nên mỗi cái tự canh có điều kiện `to_regclass(<bảng>) IS NOT NULL` — một lược đồ
    -- rút gọn vẫn phải đi qua im lặng; và ~~chúng KHÔNG `ENABLE ALWAYS` (`tgenabled = 'O'`), nên bản
    -- ghim nói đúng trạng thái THẬT thay vì một trạng thái mong muốn.~~ [review H6-4] chúng nay
    -- `ENABLE ALWAYS` (migration `043`) và bản ghim đòi `'A'`: ghim `'O'` biến `migrate()` thành thứ
    -- HẠ một trigger đã được nâng, và `'O'` là trạng thái mà `session_replication_role = 'replica'`
    -- bỏ qua — đúng thứ 003/004/005/040 dùng ALWAYS để chặn.
    -- Bản NGUỒN của mỗi thân ở migration ghi trong tên mục; test đồng bộ và test trôi (kể cả DROP …
    -- CASCADE): db/migrations.int.test.ts [S1.13 / nợ 51]. 48 hàm `RETURNS trigger` trong `public`,
    -- ghim 8 + hai của D3 + `chan_sua_xoa` — danh sách vẫn viết tay, sổ nợ 54.
    ARRAY[
      $q$hàm + trigger kiem_danh_tinh_theo_phien (013)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '013_actor_from_session.sql')$q$,
      $q$DO $fn51$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.kiem_danh_tinh_theo_phien();
           END IF;
           CREATE OR REPLACE FUNCTION public.kiem_danh_tinh_theo_phien() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  cot_nguoi  text := TG_ARGV[0];
  cot_phien  text := TG_ARGV[1];
  id_nguoi   uuid;
  id_phien   uuid;
  chu_phien  uuid;
BEGIN
  id_nguoi := (to_jsonb(NEW) ->> cot_nguoi)::uuid;
  id_phien := (to_jsonb(NEW) ->> cot_phien)::uuid;

  IF id_phien IS NULL THEN
    RAISE EXCEPTION '%.% phai duoc dat: danh tinh la DAN XUAT cua mot phien, khong phai loi khai',
      TG_TABLE_NAME, cot_phien
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.user_id INTO chu_phien
    FROM public.sessions s
   WHERE s.id OPERATOR(pg_catalog.=) id_phien
     AND s.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND s.revoked_at IS NULL
     AND s.expires_at OPERATOR(pg_catalog.>) now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien khong hop le: het han, bi thu hoi, hoac thuoc to chuc khac (%.%)',
      TG_TABLE_NAME, cot_phien
      USING ERRCODE = 'check_violation';
  END IF;

  IF chu_phien IS DISTINCT FROM id_nguoi THEN
    RAISE EXCEPTION '%.% khong khop chu phien — no phai la DAN XUAT, khong phai loi khai',
      TG_TABLE_NAME, cot_nguoi
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.org_procurement_policies') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.org_procurement_policies')
                                 AND t.tgname = 'org_procurement_policies_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER org_procurement_policies_kiem_danh_tinh BEFORE INSERT ON public.org_procurement_policies FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS org_procurement_policies_kiem_danh_tinh ON public.org_procurement_policies;
             CREATE TRIGGER org_procurement_policies_kiem_danh_tinh
               BEFORE INSERT ON public.org_procurement_policies
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'created_by', 'created_by_session_id');
             ALTER TABLE public.org_procurement_policies ENABLE ALWAYS TRIGGER org_procurement_policies_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.rfq_budgets') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_budgets')
                                 AND t.tgname = 'rfq_budgets_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_budgets_kiem_danh_tinh BEFORE INSERT ON public.rfq_budgets FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_budgets_kiem_danh_tinh ON public.rfq_budgets;
             CREATE TRIGGER rfq_budgets_kiem_danh_tinh
               BEFORE INSERT ON public.rfq_budgets
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'created_by', 'created_by_session_id');
             ALTER TABLE public.rfq_budgets ENABLE ALWAYS TRIGGER rfq_budgets_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.rfq_invitation_tokens') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_invitation_tokens')
                                 AND t.tgname = 'rfq_invitation_tokens_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitation_tokens_kiem_danh_tinh BEFORE INSERT ON public.rfq_invitation_tokens FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('issued_by', 'issued_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_invitation_tokens_kiem_danh_tinh ON public.rfq_invitation_tokens;
             CREATE TRIGGER rfq_invitation_tokens_kiem_danh_tinh
               BEFORE INSERT ON public.rfq_invitation_tokens
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'issued_by', 'issued_by_session_id');
             ALTER TABLE public.rfq_invitation_tokens ENABLE ALWAYS TRIGGER rfq_invitation_tokens_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.rfq_invitations') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_invitations')
                                 AND t.tgname = 'rfq_invitations_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitations_kiem_danh_tinh BEFORE INSERT ON public.rfq_invitations FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('invited_by', 'invited_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_invitations_kiem_danh_tinh ON public.rfq_invitations;
             CREATE TRIGGER rfq_invitations_kiem_danh_tinh
               BEFORE INSERT ON public.rfq_invitations
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'invited_by', 'invited_by_session_id');
             ALTER TABLE public.rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.rfq_invitations') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_invitations')
                                 AND t.tgname = 'rfq_invitations_kiem_nguoi_thu_hoi'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitations_kiem_nguoi_thu_hoi BEFORE UPDATE ON public.rfq_invitations FOR EACH ROW WHEN (((new.revoked_at IS NOT NULL) AND (old.revoked_at IS NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('revoked_by', 'revoked_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_invitations_kiem_nguoi_thu_hoi ON public.rfq_invitations;
             CREATE TRIGGER rfq_invitations_kiem_nguoi_thu_hoi
               BEFORE UPDATE ON public.rfq_invitations
               FOR EACH ROW
               WHEN (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL)
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('revoked_by', 'revoked_by_session_id');
             ALTER TABLE public.rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_kiem_nguoi_thu_hoi;
           END IF;
           IF to_regclass('public.rfq_items') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_items')
                                 AND t.tgname = 'rfq_items_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_items_kiem_danh_tinh BEFORE INSERT ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_items_kiem_danh_tinh ON public.rfq_items;
             CREATE TRIGGER rfq_items_kiem_danh_tinh
               BEFORE INSERT ON public.rfq_items
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'created_by', 'created_by_session_id');
             ALTER TABLE public.rfq_items ENABLE ALWAYS TRIGGER rfq_items_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.rfq_key_material') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                                 AND t.tgname = 'rfq_key_material_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_kiem_danh_tinh BEFORE INSERT ON public.rfq_key_material FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_key_material_kiem_danh_tinh ON public.rfq_key_material;
             CREATE TRIGGER rfq_key_material_kiem_danh_tinh
               BEFORE INSERT ON public.rfq_key_material
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'created_by', 'created_by_session_id');
             ALTER TABLE public.rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.rfq_key_material') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                                 AND t.tgname = 'rfq_key_material_kiem_nguoi_thu_hoi'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_kiem_nguoi_thu_hoi BEFORE UPDATE ON public.rfq_key_material FOR EACH ROW WHEN (((new.revoked_at IS NOT NULL) AND (old.revoked_at IS NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('revoked_by', 'revoked_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_key_material_kiem_nguoi_thu_hoi ON public.rfq_key_material;
             CREATE TRIGGER rfq_key_material_kiem_nguoi_thu_hoi
               BEFORE UPDATE ON public.rfq_key_material
               FOR EACH ROW
               WHEN (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL)
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('revoked_by', 'revoked_by_session_id');
             ALTER TABLE public.rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_kiem_nguoi_thu_hoi;
           END IF;
           IF to_regclass('public.rfq_key_material') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                                 AND t.tgname = 'rfq_key_material_kiem_nguoi_xoa'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_kiem_nguoi_xoa BEFORE UPDATE ON public.rfq_key_material FOR EACH ROW WHEN (((new.purged_at IS NOT NULL) AND (old.purged_at IS NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('purged_by', 'purged_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_key_material_kiem_nguoi_xoa ON public.rfq_key_material;
             CREATE TRIGGER rfq_key_material_kiem_nguoi_xoa
               BEFORE UPDATE ON public.rfq_key_material
               FOR EACH ROW
               WHEN (NEW.purged_at IS NOT NULL AND OLD.purged_at IS NULL)
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('purged_by', 'purged_by_session_id');
             ALTER TABLE public.rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_kiem_nguoi_xoa;
           END IF;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_nguoi_dong'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_dong BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'CLOSED'::text) AND (old.status IS DISTINCT FROM 'CLOSED'::text))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('closed_by', 'closed_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_nguoi_dong ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_nguoi_dong
               BEFORE UPDATE ON public.rfq_packages
               FOR EACH ROW
               WHEN (NEW.status = 'CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED')
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('closed_by', 'closed_by_session_id');
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_dong;
           END IF;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_nguoi_huy'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_huy BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'CANCELLED'::text) AND (old.status IS DISTINCT FROM 'CANCELLED'::text))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('cancelled_by', 'cancelled_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_nguoi_huy ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_nguoi_huy
               BEFORE UPDATE ON public.rfq_packages
               FOR EACH ROW
               WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('cancelled_by', 'cancelled_by_session_id');
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_huy;
           END IF;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_nguoi_mo'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_mo BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'OPEN'::text) AND (old.status IS DISTINCT FROM 'OPEN'::text))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('opened_by', 'opened_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_nguoi_mo ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_nguoi_mo
               BEFORE UPDATE ON public.rfq_packages
               FOR EACH ROW
               WHEN (NEW.status = 'OPEN' AND OLD.status IS DISTINCT FROM 'OPEN')
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('opened_by', 'opened_by_session_id');
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_mo;
           END IF;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_nguoi_nop'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_nop BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'PENDING_APPROVAL'::text) AND (old.status IS DISTINCT FROM 'PENDING_APPROVAL'::text))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('submitted_by', 'submitted_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_nguoi_nop ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_nguoi_nop
               BEFORE UPDATE ON public.rfq_packages
               FOR EACH ROW
               WHEN (NEW.status = 'PENDING_APPROVAL' AND OLD.status IS DISTINCT FROM 'PENDING_APPROVAL')
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('submitted_by', 'submitted_by_session_id');
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_nop;
           END IF;
           IF to_regclass('public.supplier_contacts') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.supplier_contacts')
                                 AND t.tgname = 'supplier_contacts_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER supplier_contacts_kiem_danh_tinh BEFORE INSERT ON public.supplier_contacts FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS supplier_contacts_kiem_danh_tinh ON public.supplier_contacts;
             CREATE TRIGGER supplier_contacts_kiem_danh_tinh
               BEFORE INSERT ON public.supplier_contacts
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'created_by', 'created_by_session_id');
             ALTER TABLE public.supplier_contacts ENABLE ALWAYS TRIGGER supplier_contacts_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.suppliers') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.suppliers')
                                 AND t.tgname = 'suppliers_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER suppliers_kiem_danh_tinh BEFORE INSERT ON public.suppliers FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS suppliers_kiem_danh_tinh ON public.suppliers;
             CREATE TRIGGER suppliers_kiem_danh_tinh
               BEFORE INSERT ON public.suppliers
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'created_by', 'created_by_session_id');
             ALTER TABLE public.suppliers ENABLE ALWAYS TRIGGER suppliers_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.unseal_approvals') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_approvals')
                                 AND t.tgname = 'unseal_approvals_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_approvals_kiem_danh_tinh BEFORE INSERT ON public.unseal_approvals FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('approver_user_id', 'approver_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS unseal_approvals_kiem_danh_tinh ON public.unseal_approvals;
             CREATE TRIGGER unseal_approvals_kiem_danh_tinh
               BEFORE INSERT ON public.unseal_approvals
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'approver_user_id', 'approver_session_id');
             ALTER TABLE public.unseal_approvals ENABLE ALWAYS TRIGGER unseal_approvals_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.unseal_requests') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_requests')
                                 AND t.tgname = 'unseal_requests_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_danh_tinh BEFORE INSERT ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('requested_by', 'requested_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS unseal_requests_kiem_danh_tinh ON public.unseal_requests;
             CREATE TRIGGER unseal_requests_kiem_danh_tinh
               BEFORE INSERT ON public.unseal_requests
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'requested_by', 'requested_by_session_id');
             ALTER TABLE public.unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_danh_tinh;
           END IF;
           IF to_regclass('public.unseal_requests') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_requests')
                                 AND t.tgname = 'unseal_requests_kiem_nguoi_dieu_phoi'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_nguoi_dieu_phoi BEFORE UPDATE ON public.unseal_requests FOR EACH ROW WHEN (((new.dispatched_by IS NOT NULL) AND (old.dispatched_by IS NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('dispatched_by', 'dispatched_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS unseal_requests_kiem_nguoi_dieu_phoi ON public.unseal_requests;
             CREATE TRIGGER unseal_requests_kiem_nguoi_dieu_phoi
               BEFORE UPDATE ON public.unseal_requests
               FOR EACH ROW
               WHEN (NEW.dispatched_by IS NOT NULL AND OLD.dispatched_by IS NULL)
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('dispatched_by', 'dispatched_by_session_id');
             ALTER TABLE public.unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_nguoi_dieu_phoi;
           END IF;
           IF to_regclass('public.unseal_requests') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_requests')
                                 AND t.tgname = 'unseal_requests_kiem_nhan_chung'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_nhan_chung BEFORE INSERT OR UPDATE ON public.unseal_requests FOR EACH ROW WHEN ((new.break_glass_witness_user_id IS NOT NULL)) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('break_glass_witness_user_id', 'break_glass_witness_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS unseal_requests_kiem_nhan_chung ON public.unseal_requests;
             CREATE TRIGGER unseal_requests_kiem_nhan_chung
               BEFORE INSERT OR UPDATE ON public.unseal_requests
               FOR EACH ROW
               WHEN (NEW.break_glass_witness_user_id IS NOT NULL)
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'break_glass_witness_user_id', 'break_glass_witness_session_id');
             ALTER TABLE public.unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_nhan_chung;
           END IF;
         END
         $fn51$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE cot_nguoi text := TG_ARGV[0]; cot_phien text := TG_ARGV[1]; id_nguoi uuid; id_phien uuid; chu_phien uuid; BEGIN id_nguoi := (to_jsonb(NEW) ->> cot_nguoi)::uuid; id_phien := (to_jsonb(NEW) ->> cot_phien)::uuid; IF id_phien IS NULL THEN RAISE EXCEPTION '%.% phai duoc dat: danh tinh la DAN XUAT cua mot phien, khong phai loi khai', TG_TABLE_NAME, cot_phien USING ERRCODE = 'check_violation'; END IF; SELECT s.user_id INTO chu_phien FROM public.sessions s WHERE s.id OPERATOR(pg_catalog.=) id_phien AND s.org_id OPERATOR(pg_catalog.=) NEW.org_id AND s.revoked_at IS NULL AND s.expires_at OPERATOR(pg_catalog.>) now(); IF NOT FOUND THEN RAISE EXCEPTION 'Phien khong hop le: het han, bi thu hoi, hoac thuoc to chuc khac (%.%)', TG_TABLE_NAME, cot_phien USING ERRCODE = 'check_violation'; END IF; IF chu_phien IS DISTINCT FROM id_nguoi THEN RAISE EXCEPTION '%.% khong khop chu phien — no phai la DAN XUAT, khong phai loi khai', TG_TABLE_NAME, cot_nguoi USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND (to_regclass('public.org_procurement_policies') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.org_procurement_policies')
                               AND t.tgname = 'org_procurement_policies_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER org_procurement_policies_kiem_danh_tinh BEFORE INSERT ON public.org_procurement_policies FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$))
            AND (to_regclass('public.rfq_budgets') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_budgets')
                               AND t.tgname = 'rfq_budgets_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_budgets_kiem_danh_tinh BEFORE INSERT ON public.rfq_budgets FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$))
            AND (to_regclass('public.rfq_invitation_tokens') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_invitation_tokens')
                               AND t.tgname = 'rfq_invitation_tokens_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitation_tokens_kiem_danh_tinh BEFORE INSERT ON public.rfq_invitation_tokens FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('issued_by', 'issued_by_session_id')$def$))
            AND (to_regclass('public.rfq_invitations') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_invitations')
                               AND t.tgname = 'rfq_invitations_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitations_kiem_danh_tinh BEFORE INSERT ON public.rfq_invitations FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('invited_by', 'invited_by_session_id')$def$))
            AND (to_regclass('public.rfq_invitations') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_invitations')
                               AND t.tgname = 'rfq_invitations_kiem_nguoi_thu_hoi'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitations_kiem_nguoi_thu_hoi BEFORE UPDATE ON public.rfq_invitations FOR EACH ROW WHEN (((new.revoked_at IS NOT NULL) AND (old.revoked_at IS NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('revoked_by', 'revoked_by_session_id')$def$))
            AND (to_regclass('public.rfq_items') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_items')
                               AND t.tgname = 'rfq_items_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_items_kiem_danh_tinh BEFORE INSERT ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$))
            AND (to_regclass('public.rfq_key_material') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                               AND t.tgname = 'rfq_key_material_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_kiem_danh_tinh BEFORE INSERT ON public.rfq_key_material FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$))
            AND (to_regclass('public.rfq_key_material') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                               AND t.tgname = 'rfq_key_material_kiem_nguoi_thu_hoi'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_kiem_nguoi_thu_hoi BEFORE UPDATE ON public.rfq_key_material FOR EACH ROW WHEN (((new.revoked_at IS NOT NULL) AND (old.revoked_at IS NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('revoked_by', 'revoked_by_session_id')$def$))
            AND (to_regclass('public.rfq_key_material') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                               AND t.tgname = 'rfq_key_material_kiem_nguoi_xoa'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_kiem_nguoi_xoa BEFORE UPDATE ON public.rfq_key_material FOR EACH ROW WHEN (((new.purged_at IS NOT NULL) AND (old.purged_at IS NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('purged_by', 'purged_by_session_id')$def$))
            AND (to_regclass('public.rfq_packages') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_packages')
                               AND t.tgname = 'rfq_packages_kiem_nguoi_dong'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_dong BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'CLOSED'::text) AND (old.status IS DISTINCT FROM 'CLOSED'::text))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('closed_by', 'closed_by_session_id')$def$))
            AND (to_regclass('public.rfq_packages') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_packages')
                               AND t.tgname = 'rfq_packages_kiem_nguoi_huy'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_huy BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'CANCELLED'::text) AND (old.status IS DISTINCT FROM 'CANCELLED'::text))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('cancelled_by', 'cancelled_by_session_id')$def$))
            AND (to_regclass('public.rfq_packages') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_packages')
                               AND t.tgname = 'rfq_packages_kiem_nguoi_mo'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_mo BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'OPEN'::text) AND (old.status IS DISTINCT FROM 'OPEN'::text))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('opened_by', 'opened_by_session_id')$def$))
            AND (to_regclass('public.rfq_packages') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.rfq_packages')
                               AND t.tgname = 'rfq_packages_kiem_nguoi_nop'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_nop BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'PENDING_APPROVAL'::text) AND (old.status IS DISTINCT FROM 'PENDING_APPROVAL'::text))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('submitted_by', 'submitted_by_session_id')$def$))
            AND (to_regclass('public.supplier_contacts') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.supplier_contacts')
                               AND t.tgname = 'supplier_contacts_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER supplier_contacts_kiem_danh_tinh BEFORE INSERT ON public.supplier_contacts FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$))
            AND (to_regclass('public.suppliers') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.suppliers')
                               AND t.tgname = 'suppliers_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER suppliers_kiem_danh_tinh BEFORE INSERT ON public.suppliers FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('created_by', 'created_by_session_id')$def$))
            AND (to_regclass('public.unseal_approvals') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.unseal_approvals')
                               AND t.tgname = 'unseal_approvals_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_approvals_kiem_danh_tinh BEFORE INSERT ON public.unseal_approvals FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('approver_user_id', 'approver_session_id')$def$))
            AND (to_regclass('public.unseal_requests') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.unseal_requests')
                               AND t.tgname = 'unseal_requests_kiem_danh_tinh'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_danh_tinh BEFORE INSERT ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('requested_by', 'requested_by_session_id')$def$))
            AND (to_regclass('public.unseal_requests') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.unseal_requests')
                               AND t.tgname = 'unseal_requests_kiem_nguoi_dieu_phoi'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_nguoi_dieu_phoi BEFORE UPDATE ON public.unseal_requests FOR EACH ROW WHEN (((new.dispatched_by IS NOT NULL) AND (old.dispatched_by IS NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('dispatched_by', 'dispatched_by_session_id')$def$))
            AND (to_regclass('public.unseal_requests') IS NULL
                 OR EXISTS (SELECT 1 FROM pg_trigger t
                             WHERE t.tgrelid = to_regclass('public.unseal_requests')
                               AND t.tgname = 'unseal_requests_kiem_nhan_chung'
                               AND NOT t.tgisinternal
                               AND t.tgfoid = p.oid
                               AND t.tgenabled = 'A'
                               AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_nhan_chung BEFORE INSERT OR UPDATE ON public.unseal_requests FOR EACH ROW WHEN ((new.break_glass_witness_user_id IS NOT NULL)) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('break_glass_witness_user_id', 'break_glass_witness_session_id')$def$))
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.kiem_danh_tinh_theo_phien()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')),
                  'hàm public.kiem_danh_tinh_theo_phien() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.kiem_danh_tinh_theo_phien() (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$hàm + trigger sessions_kiem_mfa_khi_tao (029/037)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '037_vai_ung_dung_la_thanh_vien.sql')$q$,
      $q$DO $fn51$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.sessions_kiem_mfa_khi_tao()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.sessions_kiem_mfa_khi_tao();
           END IF;
           CREATE OR REPLACE FUNCTION public.sessions_kiem_mfa_khi_tao() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
BEGIN
  IF public.la_duong_ung_dung('app_api'::pg_catalog.name)
     AND NEW.mfa_verified_at IS NULL THEN
    RAISE EXCEPTION 'app_api khong duoc tao mot phien chua qua MFA (ADR-020 muc 2): mfa_verified_at phai duoc dat trong cung cau INSERT'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.sessions')
                             AND t.tgname = 'sessions_kiem_mfa_khi_tao'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.sessions_kiem_mfa_khi_tao()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER sessions_kiem_mfa_khi_tao BEFORE INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION sessions_kiem_mfa_khi_tao()$def$) THEN
             DROP TRIGGER IF EXISTS sessions_kiem_mfa_khi_tao ON public.sessions;
             CREATE TRIGGER sessions_kiem_mfa_khi_tao
               BEFORE INSERT ON public.sessions
               FOR EACH ROW EXECUTE FUNCTION public.sessions_kiem_mfa_khi_tao();
             ALTER TABLE public.sessions ENABLE ALWAYS TRIGGER sessions_kiem_mfa_khi_tao;
           END IF;
         END
         $fn51$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF public.la_duong_ung_dung('app_api'::pg_catalog.name) AND NEW.mfa_verified_at IS NULL THEN RAISE EXCEPTION 'app_api khong duoc tao mot phien chua qua MFA (ADR-020 muc 2): mfa_verified_at phai duoc dat trong cung cau INSERT' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.sessions')
                           AND t.tgname = 'sessions_kiem_mfa_khi_tao'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.sessions_kiem_mfa_khi_tao()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER sessions_kiem_mfa_khi_tao BEFORE INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION sessions_kiem_mfa_khi_tao()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.sessions_kiem_mfa_khi_tao()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.sessions_kiem_mfa_khi_tao()')),
                  'hàm public.sessions_kiem_mfa_khi_tao() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.sessions_kiem_mfa_khi_tao() và bảng public.sessions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$hàm + trigger mfa_credentials_khoa_ho_so_da_xac_nhan (032/037)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '037_vai_ung_dung_la_thanh_vien.sql')$q$,
      $q$DO $fn51$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.mfa_credentials_khoa_ho_so_da_xac_nhan()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.mfa_credentials_khoa_ho_so_da_xac_nhan();
           END IF;
           CREATE OR REPLACE FUNCTION public.mfa_credentials_khoa_ho_so_da_xac_nhan() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
BEGIN
  IF public.la_duong_ung_dung('app_api'::pg_catalog.name)
     AND OLD.confirmed_at IS NOT NULL
     AND (NEW.secret_wrapped IS DISTINCT FROM OLD.secret_wrapped
          OR NEW.secret_key_version IS DISTINCT FROM OLD.secret_key_version
          OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION 'Ho so TOTP da xac nhan: bi mat va confirmed_at khong thay duoc (032, review H2-1)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.mfa_credentials')
                             AND t.tgname = 'mfa_credentials_khoa_ho_so_da_xac_nhan'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.mfa_credentials_khoa_ho_so_da_xac_nhan()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan BEFORE UPDATE ON public.mfa_credentials FOR EACH ROW EXECUTE FUNCTION mfa_credentials_khoa_ho_so_da_xac_nhan()$def$) THEN
             DROP TRIGGER IF EXISTS mfa_credentials_khoa_ho_so_da_xac_nhan ON public.mfa_credentials;
             CREATE TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan
               BEFORE UPDATE ON public.mfa_credentials
               FOR EACH ROW EXECUTE FUNCTION public.mfa_credentials_khoa_ho_so_da_xac_nhan();
             ALTER TABLE public.mfa_credentials ENABLE ALWAYS TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan;
           END IF;
         END
         $fn51$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF public.la_duong_ung_dung('app_api'::pg_catalog.name) AND OLD.confirmed_at IS NOT NULL AND (NEW.secret_wrapped IS DISTINCT FROM OLD.secret_wrapped OR NEW.secret_key_version IS DISTINCT FROM OLD.secret_key_version OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN RAISE EXCEPTION 'Ho so TOTP da xac nhan: bi mat va confirmed_at khong thay duoc (032, review H2-1)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.mfa_credentials')
                           AND t.tgname = 'mfa_credentials_khoa_ho_so_da_xac_nhan'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.mfa_credentials_khoa_ho_so_da_xac_nhan()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan BEFORE UPDATE ON public.mfa_credentials FOR EACH ROW EXECUTE FUNCTION mfa_credentials_khoa_ho_so_da_xac_nhan()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.mfa_credentials_khoa_ho_so_da_xac_nhan()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.mfa_credentials_khoa_ho_so_da_xac_nhan()')),
                  'hàm public.mfa_credentials_khoa_ho_so_da_xac_nhan() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.mfa_credentials_khoa_ho_so_da_xac_nhan() và bảng public.mfa_credentials (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$hàm + trigger sessions_kiem_totp_gan_day (039)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '039_phien_can_totp_gan_day.sql')$q$,
      $q$DO $fn51$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.sessions_kiem_totp_gan_day()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.sessions_kiem_totp_gan_day();
           END IF;
           CREATE OR REPLACE FUNCTION public.sessions_kiem_totp_gan_day() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
DECLARE
  -- `extract(epoch FROM …)` là cú pháp riêng của SQL, không viết được với tiền tố schema; hàm thật
  -- đứng sau nó là `date_part`, và hàm ấy ghim được `pg_catalog.` (quy ước QT3).
  buoc_hien_tai bigint := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) OPERATOR(pg_catalog./) 30)::pg_catalog.int8;
BEGIN
  IF public.la_duong_ung_dung('app_api'::pg_catalog.name)
     AND NEW.mfa_verified_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.mfa_credentials m
        WHERE m.org_id OPERATOR(pg_catalog.=) NEW.org_id
          AND m.user_id OPERATOR(pg_catalog.=) NEW.user_id
          AND m.kind OPERATOR(pg_catalog.=) 'TOTP'
          AND m.confirmed_at IS NOT NULL
          AND m.last_used_counter IS NOT NULL
          AND m.last_used_counter OPERATOR(pg_catalog.>=) (buoc_hien_tai OPERATOR(pg_catalog.-) 3)
          AND m.last_used_counter OPERATOR(pg_catalog.<=) (buoc_hien_tai OPERATOR(pg_catalog.+) 3)
     ) THEN
    RAISE EXCEPTION 'Phien da-MFA phai di sau mot lan TOTP dung GAN DAY cua chinh nguoi ay (039, review M-4/H4-6): khong co ho so TOTP da xac nhan voi bo dem trong +-3 buoc quanh hien tai'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$ham$;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.sessions')
                             AND t.tgname = 'sessions_kiem_totp_gan_day'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.sessions_kiem_totp_gan_day()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER sessions_kiem_totp_gan_day AFTER INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION sessions_kiem_totp_gan_day()$def$) THEN
             DROP TRIGGER IF EXISTS sessions_kiem_totp_gan_day ON public.sessions;
             CREATE TRIGGER sessions_kiem_totp_gan_day
               AFTER INSERT ON public.sessions
               FOR EACH ROW EXECUTE FUNCTION public.sessions_kiem_totp_gan_day();
             ALTER TABLE public.sessions ENABLE ALWAYS TRIGGER sessions_kiem_totp_gan_day;
           END IF;
         END
         $fn51$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE -- `extract(epoch FROM …)` là cú pháp riêng của SQL, không viết được với tiền tố schema; hàm thật -- đứng sau nó là `date_part`, và hàm ấy ghim được `pg_catalog.` (quy ước QT3). buoc_hien_tai bigint := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) OPERATOR(pg_catalog./) 30)::pg_catalog.int8; BEGIN IF public.la_duong_ung_dung('app_api'::pg_catalog.name) AND NEW.mfa_verified_at IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.mfa_credentials m WHERE m.org_id OPERATOR(pg_catalog.=) NEW.org_id AND m.user_id OPERATOR(pg_catalog.=) NEW.user_id AND m.kind OPERATOR(pg_catalog.=) 'TOTP' AND m.confirmed_at IS NOT NULL AND m.last_used_counter IS NOT NULL AND m.last_used_counter OPERATOR(pg_catalog.>=) (buoc_hien_tai OPERATOR(pg_catalog.-) 3) AND m.last_used_counter OPERATOR(pg_catalog.<=) (buoc_hien_tai OPERATOR(pg_catalog.+) 3) ) THEN RAISE EXCEPTION 'Phien da-MFA phai di sau mot lan TOTP dung GAN DAY cua chinh nguoi ay (039, review M-4/H4-6): khong co ho so TOTP da xac nhan voi bo dem trong +-3 buoc quanh hien tai' USING ERRCODE = 'check_violation'; END IF; RETURN NULL; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.sessions')
                           AND t.tgname = 'sessions_kiem_totp_gan_day'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.sessions_kiem_totp_gan_day()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER sessions_kiem_totp_gan_day AFTER INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION sessions_kiem_totp_gan_day()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.sessions_kiem_totp_gan_day()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.sessions_kiem_totp_gan_day()')),
                  'hàm public.sessions_kiem_totp_gan_day() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.sessions_kiem_totp_gan_day() và bảng public.sessions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$hàm + trigger mfa_reset_kiem_quyen (040)$q$,
      $q$to_regclass('public.mfa_reset_requests') IS NOT NULL$q$,
      $q$DO $fn51$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.mfa_reset_kiem_quyen()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.mfa_reset_kiem_quyen();
           END IF;
           CREATE OR REPLACE FUNCTION public.mfa_reset_kiem_quyen() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
DECLARE
  nguoi pg_catalog.uuid;
  vai   pg_catalog.text;
BEGIN
  IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
    nguoi := NEW.requested_by; vai := 'nguoi yeu cau';
  ELSE
    nguoi := NEW.approved_by;  vai := 'nguoi phe duyet';
  END IF;
  IF nguoi IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
         JOIN public.role_permissions rp ON rp.role_code OPERATOR(pg_catalog.=) ur.role_code
        WHERE ur.org_id OPERATOR(pg_catalog.=) NEW.org_id
          AND ur.user_id OPERATOR(pg_catalog.=) nguoi
          AND rp.permission_code OPERATOR(pg_catalog.=) 'user.mfa_reset') THEN
    RAISE EXCEPTION 'Dat lai TOTP: % phai co user.mfa_reset (040, review H4-1)', vai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                             AND t.tgname = 'mfa_reset_requests_kiem_quyen_yeu_cau'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.mfa_reset_kiem_quyen()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau BEFORE INSERT ON public.mfa_reset_requests FOR EACH ROW EXECUTE FUNCTION mfa_reset_kiem_quyen()$def$) THEN
             DROP TRIGGER IF EXISTS mfa_reset_requests_kiem_quyen_yeu_cau ON public.mfa_reset_requests;
             CREATE TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau
               BEFORE INSERT ON public.mfa_reset_requests
               FOR EACH ROW EXECUTE FUNCTION public.mfa_reset_kiem_quyen();
             ALTER TABLE public.mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau;
           END IF;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                             AND t.tgname = 'mfa_reset_requests_kiem_quyen_duyet'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.mfa_reset_kiem_quyen()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_quyen_duyet BEFORE UPDATE ON public.mfa_reset_requests FOR EACH ROW WHEN (((old.approved_by IS NULL) AND (new.approved_by IS NOT NULL))) EXECUTE FUNCTION mfa_reset_kiem_quyen()$def$) THEN
             DROP TRIGGER IF EXISTS mfa_reset_requests_kiem_quyen_duyet ON public.mfa_reset_requests;
             CREATE TRIGGER mfa_reset_requests_kiem_quyen_duyet
               BEFORE UPDATE ON public.mfa_reset_requests
               FOR EACH ROW
               WHEN (OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL)
               EXECUTE FUNCTION public.mfa_reset_kiem_quyen();
             ALTER TABLE public.mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_quyen_duyet;
           END IF;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                             AND t.tgname = 'mfa_reset_requests_kiem_danh_tinh'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_danh_tinh BEFORE INSERT ON public.mfa_reset_requests FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('requested_by', 'requested_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS mfa_reset_requests_kiem_danh_tinh ON public.mfa_reset_requests;
             CREATE TRIGGER mfa_reset_requests_kiem_danh_tinh
               BEFORE INSERT ON public.mfa_reset_requests
               FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
                 'requested_by', 'requested_by_session_id');
             ALTER TABLE public.mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_danh_tinh;
           END IF;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                             AND t.tgname = 'mfa_reset_requests_kiem_danh_tinh_duyet'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_danh_tinh_duyet BEFORE UPDATE ON public.mfa_reset_requests FOR EACH ROW WHEN (((old.approved_by IS NULL) AND (new.approved_by IS NOT NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('approved_by', 'approved_by_session_id')$def$) THEN
             DROP TRIGGER IF EXISTS mfa_reset_requests_kiem_danh_tinh_duyet ON public.mfa_reset_requests;
             CREATE TRIGGER mfa_reset_requests_kiem_danh_tinh_duyet
               BEFORE UPDATE ON public.mfa_reset_requests
               FOR EACH ROW
               WHEN (OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL)
               EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('approved_by', 'approved_by_session_id');
             ALTER TABLE public.mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_danh_tinh_duyet;
           END IF;
         END
         $fn51$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE nguoi pg_catalog.uuid; vai pg_catalog.text; BEGIN IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN nguoi := NEW.requested_by; vai := 'nguoi yeu cau'; ELSE nguoi := NEW.approved_by; vai := 'nguoi phe duyet'; END IF; IF nguoi IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_code OPERATOR(pg_catalog.=) ur.role_code WHERE ur.org_id OPERATOR(pg_catalog.=) NEW.org_id AND ur.user_id OPERATOR(pg_catalog.=) nguoi AND rp.permission_code OPERATOR(pg_catalog.=) 'user.mfa_reset') THEN RAISE EXCEPTION 'Dat lai TOTP: % phai co user.mfa_reset (040, review H4-1)', vai USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                           AND t.tgname = 'mfa_reset_requests_kiem_quyen_yeu_cau'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.mfa_reset_kiem_quyen()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau BEFORE INSERT ON public.mfa_reset_requests FOR EACH ROW EXECUTE FUNCTION mfa_reset_kiem_quyen()$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                           AND t.tgname = 'mfa_reset_requests_kiem_quyen_duyet'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.mfa_reset_kiem_quyen()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_quyen_duyet BEFORE UPDATE ON public.mfa_reset_requests FOR EACH ROW WHEN (((old.approved_by IS NULL) AND (new.approved_by IS NOT NULL))) EXECUTE FUNCTION mfa_reset_kiem_quyen()$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                           AND t.tgname = 'mfa_reset_requests_kiem_danh_tinh'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_danh_tinh BEFORE INSERT ON public.mfa_reset_requests FOR EACH ROW EXECUTE FUNCTION kiem_danh_tinh_theo_phien('requested_by', 'requested_by_session_id')$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                           AND t.tgname = 'mfa_reset_requests_kiem_danh_tinh_duyet'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_danh_tinh_duyet BEFORE UPDATE ON public.mfa_reset_requests FOR EACH ROW WHEN (((old.approved_by IS NULL) AND (new.approved_by IS NOT NULL))) EXECUTE FUNCTION kiem_danh_tinh_theo_phien('approved_by', 'approved_by_session_id')$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.mfa_reset_kiem_quyen()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.mfa_reset_kiem_quyen()')),
                  'hàm public.mfa_reset_kiem_quyen() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.mfa_reset_kiem_quyen() và bảng public.mfa_reset_requests (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$hàm + trigger mfa_reset_kiem_chuyen_trang_thai (040)$q$,
      $q$to_regclass('public.mfa_reset_requests') IS NOT NULL$q$,
      $q$DO $fn51$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.mfa_reset_kiem_chuyen_trang_thai()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.mfa_reset_kiem_chuyen_trang_thai();
           END IF;
           CREATE OR REPLACE FUNCTION public.mfa_reset_kiem_chuyen_trang_thai() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_by_session_id IS DISTINCT FROM OLD.requested_by_session_id
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Yeu cau dat lai TOTP: cac cot yeu cau la bat bien (040)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status OPERATOR(pg_catalog.=) 'PENDING' AND NEW.status OPERATOR(pg_catalog.=) 'APPROVED' THEN
    IF OLD.expires_at OPERATOR(pg_catalog.<=) pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'Yeu cau dat lai TOTP da het han, khong phe duyet duoc (040)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Phe duyet va tieu thu la hai buoc (040)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status OPERATOR(pg_catalog.=) 'PENDING' AND NEW.status OPERATOR(pg_catalog.=) 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  IF OLD.status OPERATOR(pg_catalog.=) 'APPROVED' AND NEW.status OPERATOR(pg_catalog.=) 'APPROVED'
     AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
     AND NEW.approved_by_session_id IS NOT DISTINCT FROM OLD.approved_by_session_id
     AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
     AND OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Yeu cau dat lai TOTP: chuyen tu % sang % khong hop le (040)', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END
$ham$;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                             AND t.tgname = 'mfa_reset_requests_kiem_chuyen_trang_thai'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.mfa_reset_kiem_chuyen_trang_thai()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_chuyen_trang_thai BEFORE UPDATE ON public.mfa_reset_requests FOR EACH ROW EXECUTE FUNCTION mfa_reset_kiem_chuyen_trang_thai()$def$) THEN
             DROP TRIGGER IF EXISTS mfa_reset_requests_kiem_chuyen_trang_thai ON public.mfa_reset_requests;
             CREATE TRIGGER mfa_reset_requests_kiem_chuyen_trang_thai
               BEFORE UPDATE ON public.mfa_reset_requests
               FOR EACH ROW EXECUTE FUNCTION public.mfa_reset_kiem_chuyen_trang_thai();
             ALTER TABLE public.mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_chuyen_trang_thai;
           END IF;
         END
         $fn51$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_by_session_id IS DISTINCT FROM OLD.requested_by_session_id OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN RAISE EXCEPTION 'Yeu cau dat lai TOTP: cac cot yeu cau la bat bien (040)' USING ERRCODE = 'check_violation'; END IF; IF OLD.status OPERATOR(pg_catalog.=) 'PENDING' AND NEW.status OPERATOR(pg_catalog.=) 'APPROVED' THEN IF OLD.expires_at OPERATOR(pg_catalog.<=) pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Yeu cau dat lai TOTP da het han, khong phe duyet duoc (040)' USING ERRCODE = 'check_violation'; END IF; IF NEW.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'Phe duyet va tieu thu la hai buoc (040)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END IF; IF OLD.status OPERATOR(pg_catalog.=) 'PENDING' AND NEW.status OPERATOR(pg_catalog.=) 'CANCELLED' THEN RETURN NEW; END IF; IF OLD.status OPERATOR(pg_catalog.=) 'APPROVED' AND NEW.status OPERATOR(pg_catalog.=) 'APPROVED' AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by AND NEW.approved_by_session_id IS NOT DISTINCT FROM OLD.approved_by_session_id AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at AND OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL THEN RETURN NEW; END IF; RAISE EXCEPTION 'Yeu cau dat lai TOTP: chuyen tu % sang % khong hop le (040)', OLD.status, NEW.status USING ERRCODE = 'check_violation'; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.mfa_reset_requests')
                           AND t.tgname = 'mfa_reset_requests_kiem_chuyen_trang_thai'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.mfa_reset_kiem_chuyen_trang_thai()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_reset_requests_kiem_chuyen_trang_thai BEFORE UPDATE ON public.mfa_reset_requests FOR EACH ROW EXECUTE FUNCTION mfa_reset_kiem_chuyen_trang_thai()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.mfa_reset_kiem_chuyen_trang_thai()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.mfa_reset_kiem_chuyen_trang_thai()')),
                  'hàm public.mfa_reset_kiem_chuyen_trang_thai() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.mfa_reset_kiem_chuyen_trang_thai() và bảng public.mfa_reset_requests (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$hàm + trigger mfa_credentials_xoa_can_yeu_cau (040)$q$,
      $q$to_regclass('public.mfa_reset_requests') IS NOT NULL$q$,
      $q$DO $fn51$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.mfa_credentials_xoa_can_yeu_cau()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.mfa_credentials_xoa_can_yeu_cau();
           END IF;
           CREATE OR REPLACE FUNCTION public.mfa_credentials_xoa_can_yeu_cau() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
BEGIN
  IF public.la_duong_ung_dung('app_api'::pg_catalog.name)
     AND NOT EXISTS (
       SELECT 1 FROM public.mfa_reset_requests r
        WHERE r.org_id OPERATOR(pg_catalog.=) OLD.org_id
          AND r.user_id OPERATOR(pg_catalog.=) OLD.user_id
          AND r.status OPERATOR(pg_catalog.=) 'APPROVED'
          AND r.consumed_at IS NULL
          AND r.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()
     ) THEN
    RAISE EXCEPTION 'Xoa ho so TOTP can mot yeu cau dat lai DA DUYET, chua tieu thu, chua het han (040, review M-5)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$ham$;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.mfa_credentials')
                             AND t.tgname = 'mfa_credentials_xoa_can_yeu_cau'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.mfa_credentials_xoa_can_yeu_cau()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_credentials_xoa_can_yeu_cau BEFORE DELETE ON public.mfa_credentials FOR EACH ROW EXECUTE FUNCTION mfa_credentials_xoa_can_yeu_cau()$def$) THEN
             DROP TRIGGER IF EXISTS mfa_credentials_xoa_can_yeu_cau ON public.mfa_credentials;
             CREATE TRIGGER mfa_credentials_xoa_can_yeu_cau
               BEFORE DELETE ON public.mfa_credentials
               FOR EACH ROW EXECUTE FUNCTION public.mfa_credentials_xoa_can_yeu_cau();
             ALTER TABLE public.mfa_credentials ENABLE ALWAYS TRIGGER mfa_credentials_xoa_can_yeu_cau;
           END IF;
         END
         $fn51$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF public.la_duong_ung_dung('app_api'::pg_catalog.name) AND NOT EXISTS ( SELECT 1 FROM public.mfa_reset_requests r WHERE r.org_id OPERATOR(pg_catalog.=) OLD.org_id AND r.user_id OPERATOR(pg_catalog.=) OLD.user_id AND r.status OPERATOR(pg_catalog.=) 'APPROVED' AND r.consumed_at IS NULL AND r.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp() ) THEN RAISE EXCEPTION 'Xoa ho so TOTP can mot yeu cau dat lai DA DUYET, chua tieu thu, chua het han (040, review M-5)' USING ERRCODE = 'check_violation'; END IF; RETURN OLD; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.mfa_credentials')
                           AND t.tgname = 'mfa_credentials_xoa_can_yeu_cau'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.mfa_credentials_xoa_can_yeu_cau()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER mfa_credentials_xoa_can_yeu_cau BEFORE DELETE ON public.mfa_credentials FOR EACH ROW EXECUTE FUNCTION mfa_credentials_xoa_can_yeu_cau()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.mfa_credentials_xoa_can_yeu_cau()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.mfa_credentials_xoa_can_yeu_cau()')),
                  'hàm public.mfa_credentials_xoa_can_yeu_cau() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.mfa_credentials_xoa_can_yeu_cau() và bảng public.mfa_credentials (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$hàm + trigger outbox_jobs_xoa_payload_dang_nhap (041)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '041_outbox_payload_dang_nhap_xoa_sau_xong.sql')$q$,
      $q$DO $fn51$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.outbox_jobs_xoa_payload_dang_nhap()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.outbox_jobs_xoa_payload_dang_nhap();
           END IF;
           CREATE OR REPLACE FUNCTION public.outbox_jobs_xoa_payload_dang_nhap() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
BEGIN
  NEW.payload := '{}'::pg_catalog.jsonb;
  RETURN NEW;
END
$ham$;
           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.outbox_jobs')
                             AND t.tgname = 'outbox_jobs_xoa_payload_dang_nhap'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.outbox_jobs_xoa_payload_dang_nhap()')
                             AND t.tgenabled = 'A'
                             AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER outbox_jobs_xoa_payload_dang_nhap BEFORE UPDATE ON public.outbox_jobs FOR EACH ROW WHEN (((new.kind = 'LOGIN_LINK_SEND'::text) AND (new.status = ANY (ARRAY['DONE'::text, 'FAILED'::text])) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION outbox_jobs_xoa_payload_dang_nhap()$def$) THEN
             DROP TRIGGER IF EXISTS outbox_jobs_xoa_payload_dang_nhap ON public.outbox_jobs;
             CREATE TRIGGER outbox_jobs_xoa_payload_dang_nhap
               BEFORE UPDATE ON public.outbox_jobs
               FOR EACH ROW
               WHEN (NEW.kind = 'LOGIN_LINK_SEND' AND NEW.status IN ('DONE', 'FAILED') AND OLD.status IS DISTINCT FROM NEW.status)
               EXECUTE FUNCTION public.outbox_jobs_xoa_payload_dang_nhap();
             ALTER TABLE public.outbox_jobs ENABLE ALWAYS TRIGGER outbox_jobs_xoa_payload_dang_nhap;
           END IF;
         END
         $fn51$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN NEW.payload := '{}'::pg_catalog.jsonb; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.outbox_jobs')
                           AND t.tgname = 'outbox_jobs_xoa_payload_dang_nhap'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.outbox_jobs_xoa_payload_dang_nhap()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER outbox_jobs_xoa_payload_dang_nhap BEFORE UPDATE ON public.outbox_jobs FOR EACH ROW WHEN (((new.kind = 'LOGIN_LINK_SEND'::text) AND (new.status = ANY (ARRAY['DONE'::text, 'FAILED'::text])) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION outbox_jobs_xoa_payload_dang_nhap()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.outbox_jobs_xoa_payload_dang_nhap()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.outbox_jobs_xoa_payload_dang_nhap()')),
                  'hàm public.outbox_jobs_xoa_payload_dang_nhap() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.outbox_jobs_xoa_payload_dang_nhap() và bảng public.outbox_jobs (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- ---- [S1.15 / sổ nợ 56] Thân BA MƯƠI LĂM hàm trigger còn lại và định nghĩa 41 trigger ----
    -- Sổ nợ 54 (S1.14) dựng một test ĐẦY ĐỦ: tập hàm `RETURNS trigger` trong `public` phải bằng
    -- (hàm hardening có canh) ∪ (danh sách loại trừ CÓ LÝ DO). Test ấy làm được đúng thứ nó hứa —
    -- danh sách không lớn thêm trong im lặng — nhưng nó KHÔNG rút ngắn danh sách loại trừ, và sổ nợ
    -- 56 ghi thẳng rằng "loại trừ" nghĩa là CHƯA GHIM chứ không phải KHÔNG CẦN GHIM. Khối này đóng
    -- nốt: sau nó, `HAM_TRIGGER_KHONG_GHIM` RỖNG, và phép kiểm đầy đủ đổi từ "hai tập phủ nhau" sang
    -- "tập loại trừ rỗng, tập ghim BẰNG tập thật".
    --
    -- Mỗi mục giữ NGUYÊN khuôn của khối S1.13 ở trên (thân chuẩn hoá + thuộc tính hàm + định nghĩa
    -- trigger + `tgenabled`), và tiền điều kiện vẫn là "MIGRATION NGUỒN ĐÃ ÁP DỤNG" chứ không phải
    -- "hàm đã tồn tại" — lý do đầy đủ ở khối trên (review H5-2: `DROP FUNCTION … CASCADE`).
    --
    -- BẢN NGUỒN CỦA MỖI THÂN là định dạng ở migration ĐÁNH SỐ LỚN NHẤT định nghĩa hàm ấy, không
    -- phải migration đầu tiên. Bảy hàm ở đây được `CREATE OR REPLACE` nhiều lần (`otp_kiem_kenh_khac_link`
    -- ba lần: 010 → 012 → 022; `rfq_kiem_chuyen_trang_thai`, `rfq_kiem_nguoi_duyet`,
    -- `rfq_items_chi_sua_khi_soan` 009 → 011; `rfq_key_material_bat_bien` 017 → 026;
    -- `chinh_sach_phien_ban_tang_dan` 022 → 035; `unseal_kiem_du_phe_duyet` 019 → 022). Ghim NHẦM
    -- bản cũ ở đây không phải một lỗi nhỏ: hardening chạy TRƯỚC vòng migration đánh số và các
    -- migration ấy đã ghi trong `schema_migrations` nên không chạy lại — tức mỗi lần `migrate()` sẽ
    -- LÙI hàm về bản cũ, vĩnh viễn, và không lớp nào kêu. `db/migrations.int.test.ts` [S1.15 / nợ 56]
    -- vì thế có một phép kiểm riêng: migration ghi trong mỗi mục phải là migration CUỐI CÙNG định
    -- nghĩa hàm ấy.
    --
    -- `tgenabled = 'A'` cho cả 41 trigger, và `045` nâng 37 cái còn ở ORIGIN trong CÙNG COMMIT —
    -- cùng lập luận H6-4 đã dùng cho `043`, áp cho phần còn lại. Ba cái đã ALWAYS từ 033/034.
    ARRAY[
      $q$hàm + trigger bid_chi_ghi_them (047)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '047_chi_ghi_them_chan_truncate.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.bid_chi_ghi_them()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.bid_chi_ghi_them();
           END IF;
           CREATE OR REPLACE FUNCTION public.bid_chi_ghi_them() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  RAISE EXCEPTION 'Bang % chi duoc ghi them: thao tac % bi tu choi (B1, B2)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END
$ham$;
           IF to_regclass('public.bid_receipts') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.bid_receipts')
                                 AND t.tgname = 'bid_receipts_chi_ghi_them'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER bid_receipts_chi_ghi_them BEFORE DELETE OR UPDATE ON public.bid_receipts FOR EACH ROW EXECUTE FUNCTION bid_chi_ghi_them()$def$) THEN
             DROP TRIGGER IF EXISTS bid_receipts_chi_ghi_them ON public.bid_receipts;
             CREATE TRIGGER bid_receipts_chi_ghi_them BEFORE DELETE OR UPDATE ON public.bid_receipts FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
             ALTER TABLE public.bid_receipts ENABLE ALWAYS TRIGGER bid_receipts_chi_ghi_them;
           END IF;
           IF to_regclass('public.rfq_unsealed_bids') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_unsealed_bids')
                                 AND t.tgname = 'rfq_unsealed_bids_chi_ghi_them'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_unsealed_bids_chi_ghi_them BEFORE DELETE OR UPDATE ON public.rfq_unsealed_bids FOR EACH ROW EXECUTE FUNCTION bid_chi_ghi_them()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_unsealed_bids_chi_ghi_them ON public.rfq_unsealed_bids;
             CREATE TRIGGER rfq_unsealed_bids_chi_ghi_them BEFORE DELETE OR UPDATE ON public.rfq_unsealed_bids FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
             ALTER TABLE public.rfq_unsealed_bids ENABLE ALWAYS TRIGGER rfq_unsealed_bids_chi_ghi_them;
           END IF;
           IF to_regclass('public.vendor_bid_versions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                                 AND t.tgname = 'vendor_bid_versions_chi_ghi_them'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER vendor_bid_versions_chi_ghi_them BEFORE DELETE OR UPDATE ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION bid_chi_ghi_them()$def$) THEN
             DROP TRIGGER IF EXISTS vendor_bid_versions_chi_ghi_them ON public.vendor_bid_versions;
             CREATE TRIGGER vendor_bid_versions_chi_ghi_them BEFORE DELETE OR UPDATE ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
             ALTER TABLE public.vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_chi_ghi_them;
           END IF;
           IF to_regclass('public.vendor_bid_versions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                                 AND t.tgname = 'vendor_bid_versions_chan_truncate'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER vendor_bid_versions_chan_truncate BEFORE TRUNCATE ON public.vendor_bid_versions FOR EACH STATEMENT EXECUTE FUNCTION bid_chi_ghi_them()$def$) THEN
             DROP TRIGGER IF EXISTS vendor_bid_versions_chan_truncate ON public.vendor_bid_versions;
             CREATE TRIGGER vendor_bid_versions_chan_truncate BEFORE TRUNCATE ON public.vendor_bid_versions FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
             ALTER TABLE public.vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_chan_truncate;
           END IF;
           IF to_regclass('public.bid_receipts') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.bid_receipts')
                                 AND t.tgname = 'bid_receipts_chan_truncate'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER bid_receipts_chan_truncate BEFORE TRUNCATE ON public.bid_receipts FOR EACH STATEMENT EXECUTE FUNCTION bid_chi_ghi_them()$def$) THEN
             DROP TRIGGER IF EXISTS bid_receipts_chan_truncate ON public.bid_receipts;
             CREATE TRIGGER bid_receipts_chan_truncate BEFORE TRUNCATE ON public.bid_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
             ALTER TABLE public.bid_receipts ENABLE ALWAYS TRIGGER bid_receipts_chan_truncate;
           END IF;
           IF to_regclass('public.rfq_unsealed_bids') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_unsealed_bids')
                                 AND t.tgname = 'rfq_unsealed_bids_chan_truncate'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_unsealed_bids_chan_truncate BEFORE TRUNCATE ON public.rfq_unsealed_bids FOR EACH STATEMENT EXECUTE FUNCTION bid_chi_ghi_them()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_unsealed_bids_chan_truncate ON public.rfq_unsealed_bids;
             CREATE TRIGGER rfq_unsealed_bids_chan_truncate BEFORE TRUNCATE ON public.rfq_unsealed_bids FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
             ALTER TABLE public.rfq_unsealed_bids ENABLE ALWAYS TRIGGER rfq_unsealed_bids_chan_truncate;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN RAISE EXCEPTION 'Bang % chi duoc ghi them: thao tac % bi tu choi (B1, B2)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'check_violation'; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.bid_receipts')
                           AND t.tgname = 'bid_receipts_chi_ghi_them'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER bid_receipts_chi_ghi_them BEFORE DELETE OR UPDATE ON public.bid_receipts FOR EACH ROW EXECUTE FUNCTION bid_chi_ghi_them()$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_unsealed_bids')
                           AND t.tgname = 'rfq_unsealed_bids_chi_ghi_them'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_unsealed_bids_chi_ghi_them BEFORE DELETE OR UPDATE ON public.rfq_unsealed_bids FOR EACH ROW EXECUTE FUNCTION bid_chi_ghi_them()$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                           AND t.tgname = 'vendor_bid_versions_chi_ghi_them'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER vendor_bid_versions_chi_ghi_them BEFORE DELETE OR UPDATE ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION bid_chi_ghi_them()$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                           AND t.tgname = 'vendor_bid_versions_chan_truncate'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER vendor_bid_versions_chan_truncate BEFORE TRUNCATE ON public.vendor_bid_versions FOR EACH STATEMENT EXECUTE FUNCTION bid_chi_ghi_them()$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.bid_receipts')
                           AND t.tgname = 'bid_receipts_chan_truncate'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER bid_receipts_chan_truncate BEFORE TRUNCATE ON public.bid_receipts FOR EACH STATEMENT EXECUTE FUNCTION bid_chi_ghi_them()$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_unsealed_bids')
                           AND t.tgname = 'rfq_unsealed_bids_chan_truncate'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_chi_ghi_them()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_unsealed_bids_chan_truncate BEFORE TRUNCATE ON public.rfq_unsealed_bids FOR EACH STATEMENT EXECUTE FUNCTION bid_chi_ghi_them()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.bid_chi_ghi_them()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.bid_chi_ghi_them()')),
                  'hàm public.bid_chi_ghi_them() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.bid_chi_ghi_them() và bảng public.bid_receipts, public.rfq_unsealed_bids, public.vendor_bid_versions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger bid_dat_so_phien_ban (018)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '018_vendor_bids.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.bid_dat_so_phien_ban()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.bid_dat_so_phien_ban();
           END IF;
           CREATE OR REPLACE FUNCTION public.bid_dat_so_phien_ban() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  so_cu integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.bid_id::pg_catalog.text, 0));

  SELECT max(v.version) INTO so_cu
    FROM public.vendor_bid_versions v
   WHERE v.bid_id OPERATOR(pg_catalog.=) NEW.bid_id
     AND v.org_id OPERATOR(pg_catalog.=) NEW.org_id;

  NEW.version := coalesce(so_cu, 0) OPERATOR(pg_catalog.+) 1;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.vendor_bid_versions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                                 AND t.tgname = 'a_vendor_bid_versions_dat_so_phien_ban'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_dat_so_phien_ban()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER a_vendor_bid_versions_dat_so_phien_ban BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION bid_dat_so_phien_ban()$def$) THEN
             DROP TRIGGER IF EXISTS a_vendor_bid_versions_dat_so_phien_ban ON public.vendor_bid_versions;
             CREATE TRIGGER a_vendor_bid_versions_dat_so_phien_ban BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION public.bid_dat_so_phien_ban();
             ALTER TABLE public.vendor_bid_versions ENABLE ALWAYS TRIGGER a_vendor_bid_versions_dat_so_phien_ban;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE so_cu integer; BEGIN PERFORM pg_catalog.pg_advisory_xact_lock( pg_catalog.hashtextextended(NEW.bid_id::pg_catalog.text, 0)); SELECT max(v.version) INTO so_cu FROM public.vendor_bid_versions v WHERE v.bid_id OPERATOR(pg_catalog.=) NEW.bid_id AND v.org_id OPERATOR(pg_catalog.=) NEW.org_id; NEW.version := coalesce(so_cu, 0) OPERATOR(pg_catalog.+) 1; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                           AND t.tgname = 'a_vendor_bid_versions_dat_so_phien_ban'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_dat_so_phien_ban()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER a_vendor_bid_versions_dat_so_phien_ban BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION bid_dat_so_phien_ban()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.bid_dat_so_phien_ban()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.bid_dat_so_phien_ban()')),
                  'hàm public.bid_dat_so_phien_ban() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.bid_dat_so_phien_ban() và bảng public.vendor_bid_versions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger bid_kiem_han_nop (018)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '018_vendor_bids.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.bid_kiem_han_nop()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.bid_kiem_han_nop();
           END IF;
           CREATE OR REPLACE FUNCTION public.bid_kiem_han_nop() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  trang_thai text;
  han timestamptz;
BEGIN
  SELECT p.status, p.deadline_at INTO trang_thai, han
    FROM public.vendor_bids b
    JOIN public.rfq_invitations i
      ON i.id OPERATOR(pg_catalog.=) b.invitation_id
     AND i.org_id OPERATOR(pg_catalog.=) b.org_id
    JOIN public.rfq_packages p
      ON p.id OPERATOR(pg_catalog.=) i.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) i.org_id
   WHERE b.id OPERATOR(pg_catalog.=) NEW.bid_id
     AND b.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR SHARE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay luong bao gia % trong to chuc %', NEW.bid_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF trang_thai IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'RFQ khong nhan bao gia khi dang o trang thai % (C1)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF han IS NULL THEN
    RAISE EXCEPTION 'RFQ dang OPEN ma khong co han nop — du lieu hong'
      USING ERRCODE = 'check_violation';
  END IF;

  IF now() OPERATOR(pg_catalog.>=) han THEN
    RAISE EXCEPTION 'Da qua han nop bao gia (C1)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.vendor_bid_versions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                                 AND t.tgname = 'vendor_bid_versions_kiem_han_nop'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_kiem_han_nop()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER vendor_bid_versions_kiem_han_nop BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION bid_kiem_han_nop()$def$) THEN
             DROP TRIGGER IF EXISTS vendor_bid_versions_kiem_han_nop ON public.vendor_bid_versions;
             CREATE TRIGGER vendor_bid_versions_kiem_han_nop BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION public.bid_kiem_han_nop();
             ALTER TABLE public.vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_kiem_han_nop;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE trang_thai text; han timestamptz; BEGIN SELECT p.status, p.deadline_at INTO trang_thai, han FROM public.vendor_bids b JOIN public.rfq_invitations i ON i.id OPERATOR(pg_catalog.=) b.invitation_id AND i.org_id OPERATOR(pg_catalog.=) b.org_id JOIN public.rfq_packages p ON p.id OPERATOR(pg_catalog.=) i.rfq_id AND p.org_id OPERATOR(pg_catalog.=) i.org_id WHERE b.id OPERATOR(pg_catalog.=) NEW.bid_id AND b.org_id OPERATOR(pg_catalog.=) NEW.org_id FOR SHARE OF p; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay luong bao gia % trong to chuc %', NEW.bid_id, NEW.org_id USING ERRCODE = 'foreign_key_violation'; END IF; IF trang_thai IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION 'RFQ khong nhan bao gia khi dang o trang thai % (C1)', trang_thai USING ERRCODE = 'check_violation'; END IF; IF han IS NULL THEN RAISE EXCEPTION 'RFQ dang OPEN ma khong co han nop — du lieu hong' USING ERRCODE = 'check_violation'; END IF; IF now() OPERATOR(pg_catalog.>=) han THEN RAISE EXCEPTION 'Da qua han nop bao gia (C1)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                           AND t.tgname = 'vendor_bid_versions_kiem_han_nop'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_kiem_han_nop()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER vendor_bid_versions_kiem_han_nop BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION bid_kiem_han_nop()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.bid_kiem_han_nop()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.bid_kiem_han_nop()')),
                  'hàm public.bid_kiem_han_nop() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.bid_kiem_han_nop() và bảng public.vendor_bid_versions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger bid_kiem_phien_khach (018)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '018_vendor_bids.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.bid_kiem_phien_khach()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.bid_kiem_phien_khach();
           END IF;
           CREATE OR REPLACE FUNCTION public.bid_kiem_phien_khach() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  loi_moi_cua_phien uuid;
  loi_moi_cua_luong uuid;
BEGIN
  SELECT g.invitation_id INTO loi_moi_cua_phien
    FROM public.guest_sessions g
   WHERE g.id OPERATOR(pg_catalog.=) NEW.submitted_by_guest_session_id
     AND g.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND g.revoked_at IS NULL
     AND g.expires_at OPERATOR(pg_catalog.>) now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien khach khong hop le: khong ton tai, da thu hoi, hoac da het han'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT b.invitation_id INTO loi_moi_cua_luong
    FROM public.vendor_bids b
   WHERE b.id OPERATOR(pg_catalog.=) NEW.bid_id
     AND b.org_id OPERATOR(pg_catalog.=) NEW.org_id;

  IF loi_moi_cua_phien IS DISTINCT FROM loi_moi_cua_luong THEN
    RAISE EXCEPTION
      'Phien khach thuoc loi moi khac voi luong bao gia — no phai la DAN XUAT, khong phai loi khai'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.vendor_bid_versions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                                 AND t.tgname = 'vendor_bid_versions_kiem_phien_khach'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_kiem_phien_khach()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER vendor_bid_versions_kiem_phien_khach BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION bid_kiem_phien_khach()$def$) THEN
             DROP TRIGGER IF EXISTS vendor_bid_versions_kiem_phien_khach ON public.vendor_bid_versions;
             CREATE TRIGGER vendor_bid_versions_kiem_phien_khach BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION public.bid_kiem_phien_khach();
             ALTER TABLE public.vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_kiem_phien_khach;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE loi_moi_cua_phien uuid; loi_moi_cua_luong uuid; BEGIN SELECT g.invitation_id INTO loi_moi_cua_phien FROM public.guest_sessions g WHERE g.id OPERATOR(pg_catalog.=) NEW.submitted_by_guest_session_id AND g.org_id OPERATOR(pg_catalog.=) NEW.org_id AND g.revoked_at IS NULL AND g.expires_at OPERATOR(pg_catalog.>) now(); IF NOT FOUND THEN RAISE EXCEPTION 'Phien khach khong hop le: khong ton tai, da thu hoi, hoac da het han' USING ERRCODE = 'check_violation'; END IF; SELECT b.invitation_id INTO loi_moi_cua_luong FROM public.vendor_bids b WHERE b.id OPERATOR(pg_catalog.=) NEW.bid_id AND b.org_id OPERATOR(pg_catalog.=) NEW.org_id; IF loi_moi_cua_phien IS DISTINCT FROM loi_moi_cua_luong THEN RAISE EXCEPTION 'Phien khach thuoc loi moi khac voi luong bao gia — no phai la DAN XUAT, khong phai loi khai' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                           AND t.tgname = 'vendor_bid_versions_kiem_phien_khach'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_kiem_phien_khach()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER vendor_bid_versions_kiem_phien_khach BEFORE INSERT ON public.vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION bid_kiem_phien_khach()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.bid_kiem_phien_khach()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.bid_kiem_phien_khach()')),
                  'hàm public.bid_kiem_phien_khach() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.bid_kiem_phien_khach() và bảng public.vendor_bid_versions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger bid_phai_co_bien_nhan (018)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '018_vendor_bids.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.bid_phai_co_bien_nhan()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.bid_phai_co_bien_nhan();
           END IF;
           CREATE OR REPLACE FUNCTION public.bid_phai_co_bien_nhan() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  so integer;
BEGIN
  SELECT count(*) INTO so
    FROM public.bid_receipts r
   WHERE r.bid_version_id OPERATOR(pg_catalog.=) NEW.id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF so OPERATOR(pg_catalog.=) 0 THEN
    RAISE EXCEPTION 'Nop bao gia ma khong phat bien nhan trong cung giao dich (B2)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$ham$;
           IF to_regclass('public.vendor_bid_versions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                                 AND t.tgname = 'vendor_bid_versions_phai_co_bien_nhan'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.bid_phai_co_bien_nhan()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE CONSTRAINT TRIGGER vendor_bid_versions_phai_co_bien_nhan AFTER INSERT ON public.vendor_bid_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bid_phai_co_bien_nhan()$def$) THEN
             DROP TRIGGER IF EXISTS vendor_bid_versions_phai_co_bien_nhan ON public.vendor_bid_versions;
             CREATE CONSTRAINT TRIGGER vendor_bid_versions_phai_co_bien_nhan AFTER INSERT ON public.vendor_bid_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bid_phai_co_bien_nhan();
             ALTER TABLE public.vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_phai_co_bien_nhan;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE so integer; BEGIN SELECT count(*) INTO so FROM public.bid_receipts r WHERE r.bid_version_id OPERATOR(pg_catalog.=) NEW.id AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id; IF so OPERATOR(pg_catalog.=) 0 THEN RAISE EXCEPTION 'Nop bao gia ma khong phat bien nhan trong cung giao dich (B2)' USING ERRCODE = 'check_violation'; END IF; RETURN NULL; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.vendor_bid_versions')
                           AND t.tgname = 'vendor_bid_versions_phai_co_bien_nhan'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.bid_phai_co_bien_nhan()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE CONSTRAINT TRIGGER vendor_bid_versions_phai_co_bien_nhan AFTER INSERT ON public.vendor_bid_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bid_phai_co_bien_nhan()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.bid_phai_co_bien_nhan()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.bid_phai_co_bien_nhan()')),
                  'hàm public.bid_phai_co_bien_nhan() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.bid_phai_co_bien_nhan() và bảng public.vendor_bid_versions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger chinh_sach_phien_ban_tang_dan (035)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '035_phien_ban_chinh_sach_lien_tuc.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.chinh_sach_phien_ban_tang_dan()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.chinh_sach_phien_ban_tang_dan();
           END IF;
           CREATE OR REPLACE FUNCTION public.chinh_sach_phien_ban_tang_dan() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  lon_nhat integer;
BEGIN
  SELECT max(p.version) INTO lon_nhat
    FROM public.org_procurement_policies p
   WHERE p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NEW.version IS DISTINCT FROM (COALESCE(lon_nhat, 0) OPERATOR(pg_catalog.+) 1) THEN
    RAISE EXCEPTION 'Phien ban chinh sach phai BANG phien ban lon nhat + 1 (%) — khong chon duoc, khong ghim duoc (035)',
      COALESCE(lon_nhat, 0) OPERATOR(pg_catalog.+) 1
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.org_procurement_policies') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.org_procurement_policies')
                                 AND t.tgname = 'org_procurement_policies_phien_ban_tang_dan'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.chinh_sach_phien_ban_tang_dan()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER org_procurement_policies_phien_ban_tang_dan BEFORE INSERT ON public.org_procurement_policies FOR EACH ROW EXECUTE FUNCTION chinh_sach_phien_ban_tang_dan()$def$) THEN
             DROP TRIGGER IF EXISTS org_procurement_policies_phien_ban_tang_dan ON public.org_procurement_policies;
             CREATE TRIGGER org_procurement_policies_phien_ban_tang_dan BEFORE INSERT ON public.org_procurement_policies FOR EACH ROW EXECUTE FUNCTION public.chinh_sach_phien_ban_tang_dan();
             ALTER TABLE public.org_procurement_policies ENABLE ALWAYS TRIGGER org_procurement_policies_phien_ban_tang_dan;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE lon_nhat integer; BEGIN SELECT max(p.version) INTO lon_nhat FROM public.org_procurement_policies p WHERE p.org_id OPERATOR(pg_catalog.=) NEW.org_id; IF NEW.version IS DISTINCT FROM (COALESCE(lon_nhat, 0) OPERATOR(pg_catalog.+) 1) THEN RAISE EXCEPTION 'Phien ban chinh sach phai BANG phien ban lon nhat + 1 (%) — khong chon duoc, khong ghim duoc (035)', COALESCE(lon_nhat, 0) OPERATOR(pg_catalog.+) 1 USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.org_procurement_policies')
                           AND t.tgname = 'org_procurement_policies_phien_ban_tang_dan'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.chinh_sach_phien_ban_tang_dan()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER org_procurement_policies_phien_ban_tang_dan BEFORE INSERT ON public.org_procurement_policies FOR EACH ROW EXECUTE FUNCTION chinh_sach_phien_ban_tang_dan()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.chinh_sach_phien_ban_tang_dan()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.chinh_sach_phien_ban_tang_dan()')),
                  'hàm public.chinh_sach_phien_ban_tang_dan() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.chinh_sach_phien_ban_tang_dan() và bảng public.org_procurement_policies (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger guest_session_kiem_danh_tinh (012)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '012_invitation_hardening.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.guest_session_kiem_danh_tinh()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.guest_session_kiem_danh_tinh();
           END IF;
           CREATE OR REPLACE FUNCTION public.guest_session_kiem_danh_tinh() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  tt_loi_moi uuid;
  tt_contact uuid;
  tt_kenh text;
  tt_da_dung timestamptz;
BEGIN
  IF NEW.challenge_id IS NULL THEN
    RAISE EXCEPTION 'Phien khach phai tro toi thach thuc OTP da doi chieu (C2)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.invitation_id, c.contact_id, c.channel, c.consumed_at
    INTO tt_loi_moi, tt_contact, tt_kenh, tt_da_dung
    FROM public.invitation_otp_challenges c
   WHERE c.id = NEW.challenge_id AND c.org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay thach thuc OTP' USING ERRCODE = 'check_violation';
  END IF;

  -- Thách thức phải ĐÃ ĐƯỢC TIÊU THỤ: một phiên mở ra từ một thách thức chưa đối chiếu là đúng
  -- thứ E2 cấm.
  IF tt_da_dung IS NULL THEN
    RAISE EXCEPTION 'Thach thuc OTP chua duoc doi chieu (E2)' USING ERRCODE = 'check_violation';
  END IF;

  IF tt_loi_moi IS DISTINCT FROM NEW.invitation_id THEN
    RAISE EXCEPTION 'Thach thuc OTP thuoc mot loi moi khac' USING ERRCODE = 'check_violation';
  END IF;

  -- ĐÂY LÀ DÒNG ĐÓNG C2. Ở bản 010, `verified_contact_id` là một tham số: kẻ tấn công cho gửi OTP
  -- tới số của mình rồi khai `verifiedContactId = <người liên hệ chính danh>`, và sổ kiểm toán —
  -- bằng chứng pháp lý duy nhất của hệ thống — ghi rằng chính người đó đã xác thực. Nạn nhân
  -- không phản bác được bằng dữ liệu của hệ thống.
  IF NEW.verified_contact_id IS DISTINCT FROM tt_contact
     OR NEW.verified_channel IS DISTINCT FROM tt_kenh THEN
    RAISE EXCEPTION
      'Danh tinh da xac thuc phai DAN XUAT tu thach thuc OTP, khong duoc khai (C2, E5)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.guest_sessions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.guest_sessions')
                                 AND t.tgname = 'guest_sessions_kiem_danh_tinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.guest_session_kiem_danh_tinh()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER guest_sessions_kiem_danh_tinh BEFORE INSERT ON public.guest_sessions FOR EACH ROW EXECUTE FUNCTION guest_session_kiem_danh_tinh()$def$) THEN
             DROP TRIGGER IF EXISTS guest_sessions_kiem_danh_tinh ON public.guest_sessions;
             CREATE TRIGGER guest_sessions_kiem_danh_tinh BEFORE INSERT ON public.guest_sessions FOR EACH ROW EXECUTE FUNCTION public.guest_session_kiem_danh_tinh();
             ALTER TABLE public.guest_sessions ENABLE ALWAYS TRIGGER guest_sessions_kiem_danh_tinh;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE tt_loi_moi uuid; tt_contact uuid; tt_kenh text; tt_da_dung timestamptz; BEGIN IF NEW.challenge_id IS NULL THEN RAISE EXCEPTION 'Phien khach phai tro toi thach thuc OTP da doi chieu (C2)' USING ERRCODE = 'check_violation'; END IF; SELECT c.invitation_id, c.contact_id, c.channel, c.consumed_at INTO tt_loi_moi, tt_contact, tt_kenh, tt_da_dung FROM public.invitation_otp_challenges c WHERE c.id = NEW.challenge_id AND c.org_id = NEW.org_id; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay thach thuc OTP' USING ERRCODE = 'check_violation'; END IF; -- Thách thức phải ĐÃ ĐƯỢC TIÊU THỤ: một phiên mở ra từ một thách thức chưa đối chiếu là đúng -- thứ E2 cấm. IF tt_da_dung IS NULL THEN RAISE EXCEPTION 'Thach thuc OTP chua duoc doi chieu (E2)' USING ERRCODE = 'check_violation'; END IF; IF tt_loi_moi IS DISTINCT FROM NEW.invitation_id THEN RAISE EXCEPTION 'Thach thuc OTP thuoc mot loi moi khac' USING ERRCODE = 'check_violation'; END IF; -- ĐÂY LÀ DÒNG ĐÓNG C2. Ở bản 010, `verified_contact_id` là một tham số: kẻ tấn công cho gửi OTP -- tới số của mình rồi khai `verifiedContactId = <người liên hệ chính danh>`, và sổ kiểm toán — -- bằng chứng pháp lý duy nhất của hệ thống — ghi rằng chính người đó đã xác thực. Nạn nhân -- không phản bác được bằng dữ liệu của hệ thống. IF NEW.verified_contact_id IS DISTINCT FROM tt_contact OR NEW.verified_channel IS DISTINCT FROM tt_kenh THEN RAISE EXCEPTION 'Danh tinh da xac thuc phai DAN XUAT tu thach thuc OTP, khong duoc khai (C2, E5)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.guest_sessions')
                           AND t.tgname = 'guest_sessions_kiem_danh_tinh'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.guest_session_kiem_danh_tinh()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER guest_sessions_kiem_danh_tinh BEFORE INSERT ON public.guest_sessions FOR EACH ROW EXECUTE FUNCTION guest_session_kiem_danh_tinh()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.guest_session_kiem_danh_tinh()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.guest_session_kiem_danh_tinh()')),
                  'hàm public.guest_session_kiem_danh_tinh() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.guest_session_kiem_danh_tinh() và bảng public.guest_sessions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger kiem_tra_nguong_khong_cung_tay_nguoi_dung (033)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '033_policy_manage_khong_cung_tay.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_nguoi_dung()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.kiem_tra_nguong_khong_cung_tay_nguoi_dung();
           END IF;
           CREATE OR REPLACE FUNCTION public.kiem_tra_nguong_khong_cung_tay_nguoi_dung() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
DECLARE
  co_nguong boolean;
  co_thuoc_do bigint;
BEGIN
  SELECT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id
                    AND ur.user_id = NEW.user_id
                    AND rp.permission_code = 'policy.manage')
    INTO co_nguong;
  IF NOT co_nguong THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO co_thuoc_do
    FROM unnest(ARRAY['rfq.create', 'rfq.approve']) AS loai_tru(ma)
   WHERE EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id
                    AND ur.user_id = NEW.user_id
                    AND rp.permission_code = loai_tru.ma);

  IF co_thuoc_do > 0 THEN
    RAISE EXCEPTION 'Nguoi dat nguong khong duoc la nguoi dat uoc luong hay nguoi duyet (D2, 033): nguoi dung % se giu policy.manage cung rfq.create/rfq.approve', NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END
$ham$;
           IF to_regclass('public.user_roles') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.user_roles')
                                 AND t.tgname = 'user_roles_nguong_khong_cung_tay'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_nguoi_dung()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER user_roles_nguong_khong_cung_tay AFTER INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION kiem_tra_nguong_khong_cung_tay_nguoi_dung()$def$) THEN
             DROP TRIGGER IF EXISTS user_roles_nguong_khong_cung_tay ON public.user_roles;
             CREATE TRIGGER user_roles_nguong_khong_cung_tay AFTER INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_nguong_khong_cung_tay_nguoi_dung();
             ALTER TABLE public.user_roles ENABLE ALWAYS TRIGGER user_roles_nguong_khong_cung_tay;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE co_nguong boolean; co_thuoc_do bigint; BEGIN SELECT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_code = ur.role_code WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.user_id AND rp.permission_code = 'policy.manage') INTO co_nguong; IF NOT co_nguong THEN RETURN NULL; END IF; SELECT count(*) INTO co_thuoc_do FROM unnest(ARRAY['rfq.create', 'rfq.approve']) AS loai_tru(ma) WHERE EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_code = ur.role_code WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.user_id AND rp.permission_code = loai_tru.ma); IF co_thuoc_do > 0 THEN RAISE EXCEPTION 'Nguoi dat nguong khong duoc la nguoi dat uoc luong hay nguoi duyet (D2, 033): nguoi dung % se giu policy.manage cung rfq.create/rfq.approve', NEW.user_id USING ERRCODE = 'insufficient_privilege'; END IF; RETURN NULL; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.user_roles')
                           AND t.tgname = 'user_roles_nguong_khong_cung_tay'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_nguoi_dung()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER user_roles_nguong_khong_cung_tay AFTER INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION kiem_tra_nguong_khong_cung_tay_nguoi_dung()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_nguoi_dung()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_nguoi_dung()')),
                  'hàm public.kiem_tra_nguong_khong_cung_tay_nguoi_dung() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.kiem_tra_nguong_khong_cung_tay_nguoi_dung() và bảng public.user_roles (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger kiem_tra_nguong_khong_cung_tay_vai_tro (033)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '033_policy_manage_khong_cung_tay.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_vai_tro()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.kiem_tra_nguong_khong_cung_tay_vai_tro();
           END IF;
           CREATE OR REPLACE FUNCTION public.kiem_tra_nguong_khong_cung_tay_vai_tro() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
DECLARE
  co_nguong boolean;
  co_thuoc_do bigint;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_code = NEW.role_code
                    AND rp.permission_code = 'policy.manage')
    INTO co_nguong;
  IF NOT co_nguong THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO co_thuoc_do
    FROM unnest(ARRAY['rfq.create', 'rfq.approve']) AS loai_tru(ma)
   WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_code = NEW.role_code
                    AND rp.permission_code = loai_tru.ma);

  IF co_thuoc_do > 0 THEN
    RAISE EXCEPTION 'Nguoi dat nguong khong duoc la nguoi dat uoc luong hay nguoi duyet (D2, 033): vai tro % giu policy.manage cung rfq.create/rfq.approve', NEW.role_code
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END
$ham$;
           IF to_regclass('public.role_permissions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.role_permissions')
                                 AND t.tgname = 'role_permissions_nguong_khong_cung_tay'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_vai_tro()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER role_permissions_nguong_khong_cung_tay AFTER INSERT OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION kiem_tra_nguong_khong_cung_tay_vai_tro()$def$) THEN
             DROP TRIGGER IF EXISTS role_permissions_nguong_khong_cung_tay ON public.role_permissions;
             CREATE TRIGGER role_permissions_nguong_khong_cung_tay AFTER INSERT OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_nguong_khong_cung_tay_vai_tro();
             ALTER TABLE public.role_permissions ENABLE ALWAYS TRIGGER role_permissions_nguong_khong_cung_tay;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE co_nguong boolean; co_thuoc_do bigint; BEGIN SELECT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_code = NEW.role_code AND rp.permission_code = 'policy.manage') INTO co_nguong; IF NOT co_nguong THEN RETURN NULL; END IF; SELECT count(*) INTO co_thuoc_do FROM unnest(ARRAY['rfq.create', 'rfq.approve']) AS loai_tru(ma) WHERE EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_code = NEW.role_code AND rp.permission_code = loai_tru.ma); IF co_thuoc_do > 0 THEN RAISE EXCEPTION 'Nguoi dat nguong khong duoc la nguoi dat uoc luong hay nguoi duyet (D2, 033): vai tro % giu policy.manage cung rfq.create/rfq.approve', NEW.role_code USING ERRCODE = 'insufficient_privilege'; END IF; RETURN NULL; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.role_permissions')
                           AND t.tgname = 'role_permissions_nguong_khong_cung_tay'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_vai_tro()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER role_permissions_nguong_khong_cung_tay AFTER INSERT OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION kiem_tra_nguong_khong_cung_tay_vai_tro()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_vai_tro()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.kiem_tra_nguong_khong_cung_tay_vai_tro()')),
                  'hàm public.kiem_tra_nguong_khong_cung_tay_vai_tro() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.kiem_tra_nguong_khong_cung_tay_vai_tro() và bảng public.role_permissions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger loi_moi_khong_song_lai (022)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '022_security_review_s1.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.loi_moi_khong_song_lai()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.loi_moi_khong_song_lai();
           END IF;
           CREATE OR REPLACE FUNCTION public.loi_moi_khong_song_lai() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  IF OLD.status OPERATOR(pg_catalog.=) 'REVOKED'
     AND NEW.status IS DISTINCT FROM 'REVOKED' THEN
    RAISE EXCEPTION 'Loi moi da REVOKED thi khong tro lai trang thai khac duoc (E1)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_invitations') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_invitations')
                                 AND t.tgname = 'rfq_invitations_khong_song_lai'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.loi_moi_khong_song_lai()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitations_khong_song_lai BEFORE UPDATE ON public.rfq_invitations FOR EACH ROW EXECUTE FUNCTION loi_moi_khong_song_lai()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_invitations_khong_song_lai ON public.rfq_invitations;
             CREATE TRIGGER rfq_invitations_khong_song_lai BEFORE UPDATE ON public.rfq_invitations FOR EACH ROW EXECUTE FUNCTION public.loi_moi_khong_song_lai();
             ALTER TABLE public.rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_khong_song_lai;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF OLD.status OPERATOR(pg_catalog.=) 'REVOKED' AND NEW.status IS DISTINCT FROM 'REVOKED' THEN RAISE EXCEPTION 'Loi moi da REVOKED thi khong tro lai trang thai khac duoc (E1)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_invitations')
                           AND t.tgname = 'rfq_invitations_khong_song_lai'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.loi_moi_khong_song_lai()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitations_khong_song_lai BEFORE UPDATE ON public.rfq_invitations FOR EACH ROW EXECUTE FUNCTION loi_moi_khong_song_lai()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.loi_moi_khong_song_lai()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.loi_moi_khong_song_lai()')),
                  'hàm public.loi_moi_khong_song_lai() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.loi_moi_khong_song_lai() và bảng public.rfq_invitations (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger otp_go_khoa_khong_xoa_dau_vet (024)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '024_moi_lai_va_tran_chi_phi.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.otp_go_khoa_khong_xoa_dau_vet()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.otp_go_khoa_khong_xoa_dau_vet();
           END IF;
           CREATE OR REPLACE FUNCTION public.otp_go_khoa_khong_xoa_dau_vet() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  IF NEW.failed_attempts OPERATOR(pg_catalog.<) OLD.failed_attempts THEN
    RAISE EXCEPTION 'failed_attempts khong duoc giam — go khoa la mot hanh vi, khong phai mot lan xoa (E3)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.invitation_otp_challenges') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.invitation_otp_challenges')
                                 AND t.tgname = 'invitation_otp_go_khoa_khong_xoa_dau_vet'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.otp_go_khoa_khong_xoa_dau_vet()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER invitation_otp_go_khoa_khong_xoa_dau_vet BEFORE UPDATE ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION otp_go_khoa_khong_xoa_dau_vet()$def$) THEN
             DROP TRIGGER IF EXISTS invitation_otp_go_khoa_khong_xoa_dau_vet ON public.invitation_otp_challenges;
             CREATE TRIGGER invitation_otp_go_khoa_khong_xoa_dau_vet BEFORE UPDATE ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION public.otp_go_khoa_khong_xoa_dau_vet();
             ALTER TABLE public.invitation_otp_challenges ENABLE ALWAYS TRIGGER invitation_otp_go_khoa_khong_xoa_dau_vet;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF NEW.failed_attempts OPERATOR(pg_catalog.<) OLD.failed_attempts THEN RAISE EXCEPTION 'failed_attempts khong duoc giam — go khoa la mot hanh vi, khong phai mot lan xoa (E3)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.invitation_otp_challenges')
                           AND t.tgname = 'invitation_otp_go_khoa_khong_xoa_dau_vet'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.otp_go_khoa_khong_xoa_dau_vet()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER invitation_otp_go_khoa_khong_xoa_dau_vet BEFORE UPDATE ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION otp_go_khoa_khong_xoa_dau_vet()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.otp_go_khoa_khong_xoa_dau_vet()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.otp_go_khoa_khong_xoa_dau_vet()')),
                  'hàm public.otp_go_khoa_khong_xoa_dau_vet() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.otp_go_khoa_khong_xoa_dau_vet() và bảng public.invitation_otp_challenges (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger otp_kiem_kenh_khac_link (022)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '022_security_review_s1.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.otp_kiem_kenh_khac_link()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.otp_kiem_kenh_khac_link();
           END IF;
           CREATE OR REPLACE FUNCTION public.otp_kiem_kenh_khac_link() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  kenh_link text;
  ncc_moi uuid;
  trang_thai_loi_moi text;
  loi_moi_thu_hoi timestamptz;
  ncc_cua_lien_he uuid;
  loi_moi_cua_token uuid;
  so_dang_khoa integer;
BEGIN
  -- [H1] Token là BẮT BUỘC. Không có vế này, `invitationId` — một UUIDv4 xuất hiện trong URL,
  -- payload API và sổ kiểm toán — là thứ DUY NHẤT gác cổng "ai được yêu cầu gửi OTP".
  IF NEW.token_id IS NULL OR NEW.contact_id IS NULL THEN
    RAISE EXCEPTION 'Thach thuc OTP phai mang token va nguoi lien he (C1, H1)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.link_channel, i.supplier_id, i.status, i.revoked_at
    INTO kenh_link, ncc_moi, trang_thai_loi_moi, loi_moi_thu_hoi
    FROM public.rfq_invitations i WHERE i.id = NEW.invitation_id AND i.org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay loi moi cho thach thuc OTP nay'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [C3] Thu hồi lời mời phải chạm ĐƯỜNG PHIÊN, không chỉ đường token.
  IF trang_thai_loi_moi = 'REVOKED' OR loi_moi_thu_hoi IS NOT NULL THEN
    RAISE EXCEPTION 'Loi moi da bi thu hoi (E1)' USING ERRCODE = 'check_violation';
  END IF;

  -- [H1] Token phải THUỘC VỀ chính lời mời này, còn hạn, chưa thu hồi, chưa tiêu thụ.
  SELECT t.invitation_id INTO loi_moi_cua_token
    FROM public.rfq_invitation_tokens t
   WHERE t.id = NEW.token_id AND t.org_id = NEW.org_id
     AND t.purpose = 'BID_SUBMISSION'
     AND t.expires_at > now() AND t.revoked_at IS NULL AND t.consumed_at IS NULL;
  IF NOT FOUND OR loi_moi_cua_token IS DISTINCT FROM NEW.invitation_id THEN
    RAISE EXCEPTION 'Token khong thuoc loi moi nay, hoac da het hieu luc (H1)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.supplier_id INTO ncc_cua_lien_he
    FROM public.supplier_contacts c WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id;
  IF NOT FOUND OR ncc_cua_lien_he IS DISTINCT FROM ncc_moi THEN
    RAISE EXCEPTION 'Nguoi lien he khong thuoc nha cung cap duoc moi (C1)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [S1.3 HIGH-1] ADR-015 mục 1, nay so LỚP ĐÍCH chứ không so nhãn. Xem khối trên.
  IF public.otp_lop_dich(NEW.channel) = public.otp_lop_dich(kenh_link) THEN
    RAISE EXCEPTION
      'OTP khong duoc toi cung mot dich voi magic link (ADR-015): % va % deu la %',
      NEW.channel, kenh_link, public.otp_lop_dich(NEW.channel)
      USING ERRCODE = 'check_violation';
  END IF;

  -- [H3] Khoá phải sống ở cấp LỜI MỜI.
  SELECT count(*) INTO so_dang_khoa
    FROM public.invitation_otp_challenges c
   WHERE c.invitation_id = NEW.invitation_id AND c.locked_until IS NOT NULL
     AND c.locked_until > now();
  IF so_dang_khoa > 0 THEN
    RAISE EXCEPTION 'Loi moi nay dang bi khoa vi qua nhieu lan thu sai (E3)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.invitation_otp_challenges') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.invitation_otp_challenges')
                                 AND t.tgname = 'invitation_otp_kiem_kenh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.otp_kiem_kenh_khac_link()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER invitation_otp_kiem_kenh BEFORE INSERT ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION otp_kiem_kenh_khac_link()$def$) THEN
             DROP TRIGGER IF EXISTS invitation_otp_kiem_kenh ON public.invitation_otp_challenges;
             CREATE TRIGGER invitation_otp_kiem_kenh BEFORE INSERT ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION public.otp_kiem_kenh_khac_link();
             ALTER TABLE public.invitation_otp_challenges ENABLE ALWAYS TRIGGER invitation_otp_kiem_kenh;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE kenh_link text; ncc_moi uuid; trang_thai_loi_moi text; loi_moi_thu_hoi timestamptz; ncc_cua_lien_he uuid; loi_moi_cua_token uuid; so_dang_khoa integer; BEGIN -- [H1] Token là BẮT BUỘC. Không có vế này, `invitationId` — một UUIDv4 xuất hiện trong URL, -- payload API và sổ kiểm toán — là thứ DUY NHẤT gác cổng "ai được yêu cầu gửi OTP". IF NEW.token_id IS NULL OR NEW.contact_id IS NULL THEN RAISE EXCEPTION 'Thach thuc OTP phai mang token va nguoi lien he (C1, H1)' USING ERRCODE = 'check_violation'; END IF; SELECT i.link_channel, i.supplier_id, i.status, i.revoked_at INTO kenh_link, ncc_moi, trang_thai_loi_moi, loi_moi_thu_hoi FROM public.rfq_invitations i WHERE i.id = NEW.invitation_id AND i.org_id = NEW.org_id; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay loi moi cho thach thuc OTP nay' USING ERRCODE = 'check_violation'; END IF; -- [C3] Thu hồi lời mời phải chạm ĐƯỜNG PHIÊN, không chỉ đường token. IF trang_thai_loi_moi = 'REVOKED' OR loi_moi_thu_hoi IS NOT NULL THEN RAISE EXCEPTION 'Loi moi da bi thu hoi (E1)' USING ERRCODE = 'check_violation'; END IF; -- [H1] Token phải THUỘC VỀ chính lời mời này, còn hạn, chưa thu hồi, chưa tiêu thụ. SELECT t.invitation_id INTO loi_moi_cua_token FROM public.rfq_invitation_tokens t WHERE t.id = NEW.token_id AND t.org_id = NEW.org_id AND t.purpose = 'BID_SUBMISSION' AND t.expires_at > now() AND t.revoked_at IS NULL AND t.consumed_at IS NULL; IF NOT FOUND OR loi_moi_cua_token IS DISTINCT FROM NEW.invitation_id THEN RAISE EXCEPTION 'Token khong thuoc loi moi nay, hoac da het hieu luc (H1)' USING ERRCODE = 'check_violation'; END IF; SELECT c.supplier_id INTO ncc_cua_lien_he FROM public.supplier_contacts c WHERE c.id = NEW.contact_id AND c.org_id = NEW.org_id; IF NOT FOUND OR ncc_cua_lien_he IS DISTINCT FROM ncc_moi THEN RAISE EXCEPTION 'Nguoi lien he khong thuoc nha cung cap duoc moi (C1)' USING ERRCODE = 'check_violation'; END IF; -- [S1.3 HIGH-1] ADR-015 mục 1, nay so LỚP ĐÍCH chứ không so nhãn. Xem khối trên. IF public.otp_lop_dich(NEW.channel) = public.otp_lop_dich(kenh_link) THEN RAISE EXCEPTION 'OTP khong duoc toi cung mot dich voi magic link (ADR-015): % va % deu la %', NEW.channel, kenh_link, public.otp_lop_dich(NEW.channel) USING ERRCODE = 'check_violation'; END IF; -- [H3] Khoá phải sống ở cấp LỜI MỜI. SELECT count(*) INTO so_dang_khoa FROM public.invitation_otp_challenges c WHERE c.invitation_id = NEW.invitation_id AND c.locked_until IS NOT NULL AND c.locked_until > now(); IF so_dang_khoa > 0 THEN RAISE EXCEPTION 'Loi moi nay dang bi khoa vi qua nhieu lan thu sai (E3)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.invitation_otp_challenges')
                           AND t.tgname = 'invitation_otp_kiem_kenh'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.otp_kiem_kenh_khac_link()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER invitation_otp_kiem_kenh BEFORE INSERT ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION otp_kiem_kenh_khac_link()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.otp_kiem_kenh_khac_link()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.otp_kiem_kenh_khac_link()')),
                  'hàm public.otp_kiem_kenh_khac_link() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.otp_kiem_kenh_khac_link() và bảng public.invitation_otp_challenges (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_budgets_chi_sua_khi_soan (014)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '014_procurement_policy.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_budgets_chi_sua_khi_soan()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_budgets_chi_sua_khi_soan();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_budgets_chi_sua_khi_soan() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT r.status INTO trang_thai
    FROM public.rfq_packages r
   WHERE r.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ cua ngan sach nay' USING ERRCODE = 'check_violation';
  END IF;
  IF trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Chi dat hoac sua duoc ngan sach khi RFQ con o DRAFT (dang %)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_budgets') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_budgets')
                                 AND t.tgname = 'rfq_budgets_chi_sua_khi_soan'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_budgets_chi_sua_khi_soan()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_budgets_chi_sua_khi_soan BEFORE INSERT OR UPDATE ON public.rfq_budgets FOR EACH ROW EXECUTE FUNCTION rfq_budgets_chi_sua_khi_soan()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_budgets_chi_sua_khi_soan ON public.rfq_budgets;
             CREATE TRIGGER rfq_budgets_chi_sua_khi_soan BEFORE INSERT OR UPDATE ON public.rfq_budgets FOR EACH ROW EXECUTE FUNCTION public.rfq_budgets_chi_sua_khi_soan();
             ALTER TABLE public.rfq_budgets ENABLE ALWAYS TRIGGER rfq_budgets_chi_sua_khi_soan;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE trang_thai text; BEGIN SELECT r.status INTO trang_thai FROM public.rfq_packages r WHERE r.id OPERATOR(pg_catalog.=) NEW.rfq_id AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id FOR NO KEY UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay RFQ cua ngan sach nay' USING ERRCODE = 'check_violation'; END IF; IF trang_thai <> 'DRAFT' THEN RAISE EXCEPTION 'Chi dat hoac sua duoc ngan sach khi RFQ con o DRAFT (dang %)', trang_thai USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_budgets')
                           AND t.tgname = 'rfq_budgets_chi_sua_khi_soan'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_budgets_chi_sua_khi_soan()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_budgets_chi_sua_khi_soan BEFORE INSERT OR UPDATE ON public.rfq_budgets FOR EACH ROW EXECUTE FUNCTION rfq_budgets_chi_sua_khi_soan()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_budgets_chi_sua_khi_soan()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_budgets_chi_sua_khi_soan()')),
                  'hàm public.rfq_budgets_chi_sua_khi_soan() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_budgets_chi_sua_khi_soan() và bảng public.rfq_budgets (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_gia_han_khong_hoi_sinh (022)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '022_security_review_s1.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_gia_han_khong_hoi_sinh()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_gia_han_khong_hoi_sinh();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_gia_han_khong_hoi_sinh() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at THEN
    IF OLD.deadline_at IS NOT NULL AND OLD.deadline_at OPERATOR(pg_catalog.<=) now() THEN
      RAISE EXCEPTION 'Khong gia han duoc mot cua so thau DA HET han (C4)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.deadline_at IS NOT NULL AND NEW.deadline_at OPERATOR(pg_catalog.<=) now() THEN
      RAISE EXCEPTION 'Han nop moi phai nam o tuong lai (C4)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_gia_han_khong_hoi_sinh'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_gia_han_khong_hoi_sinh()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_gia_han_khong_hoi_sinh BEFORE UPDATE ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION rfq_gia_han_khong_hoi_sinh()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_gia_han_khong_hoi_sinh ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_gia_han_khong_hoi_sinh BEFORE UPDATE ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION public.rfq_gia_han_khong_hoi_sinh();
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_gia_han_khong_hoi_sinh;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at THEN IF OLD.deadline_at IS NOT NULL AND OLD.deadline_at OPERATOR(pg_catalog.<=) now() THEN RAISE EXCEPTION 'Khong gia han duoc mot cua so thau DA HET han (C4)' USING ERRCODE = 'check_violation'; END IF; IF NEW.deadline_at IS NOT NULL AND NEW.deadline_at OPERATOR(pg_catalog.<=) now() THEN RAISE EXCEPTION 'Han nop moi phai nam o tuong lai (C4)' USING ERRCODE = 'check_violation'; END IF; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_packages')
                           AND t.tgname = 'rfq_packages_gia_han_khong_hoi_sinh'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_gia_han_khong_hoi_sinh()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_gia_han_khong_hoi_sinh BEFORE UPDATE ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION rfq_gia_han_khong_hoi_sinh()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_gia_han_khong_hoi_sinh()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_gia_han_khong_hoi_sinh()')),
                  'hàm public.rfq_gia_han_khong_hoi_sinh() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_gia_han_khong_hoi_sinh() và bảng public.rfq_packages (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_items_cam_truncate (011)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '011_rfq_hardening.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_items_cam_truncate()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_items_cam_truncate();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_items_cam_truncate() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  RAISE EXCEPTION 'TRUNCATE bi cam tren rfq_items' USING ERRCODE = 'insufficient_privilege';
END
$ham$;
           IF to_regclass('public.rfq_items') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_items')
                                 AND t.tgname = 'rfq_items_cam_truncate'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_items_cam_truncate()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_items_cam_truncate BEFORE TRUNCATE ON public.rfq_items FOR EACH STATEMENT EXECUTE FUNCTION rfq_items_cam_truncate()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_items_cam_truncate ON public.rfq_items;
             CREATE TRIGGER rfq_items_cam_truncate BEFORE TRUNCATE ON public.rfq_items FOR EACH STATEMENT EXECUTE FUNCTION public.rfq_items_cam_truncate();
             ALTER TABLE public.rfq_items ENABLE ALWAYS TRIGGER rfq_items_cam_truncate;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN RAISE EXCEPTION 'TRUNCATE bi cam tren rfq_items' USING ERRCODE = 'insufficient_privilege'; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_items')
                           AND t.tgname = 'rfq_items_cam_truncate'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_items_cam_truncate()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_items_cam_truncate BEFORE TRUNCATE ON public.rfq_items FOR EACH STATEMENT EXECUTE FUNCTION rfq_items_cam_truncate()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_items_cam_truncate()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_items_cam_truncate()')),
                  'hàm public.rfq_items_cam_truncate() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_items_cam_truncate() và bảng public.rfq_items (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_items_chi_sua_khi_soan (011)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '011_rfq_hardening.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_items_chi_sua_khi_soan()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_items_chi_sua_khi_soan();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_items_chi_sua_khi_soan() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  rfq uuid;
  org uuid;
  trang_thai text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rfq := OLD.rfq_id; org := OLD.org_id;
  ELSE
    rfq := NEW.rfq_id; org := NEW.org_id;
  END IF;

  -- [M-4] `FOR NO KEY UPDATE` tuần tự hoá đúng cặp thao tác này với chuyển trạng thái RFQ. Không
  -- có nó, dưới READ COMMITTED: T1 mở RFQ (đếm 1 hạng mục, đi qua, chưa commit) trong khi T2 xoá
  -- hạng mục (đọc status từ ảnh chụp cũ, thấy DRAFT, cho qua) -> RFQ OPEN với 0 hạng mục.
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p WHERE p.id = rfq AND p.org_id = org FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ cho hang muc nay' USING ERRCODE = 'check_violation';
  END IF;

  -- [C-1] `PENDING_APPROVAL` BỊ GỠ. Đây là nửa còn lại của bản vá CRITICAL: băm nội dung làm chữ
  -- ký cũ vô hiệu, còn dòng này chặn hẳn việc sửa sau khi đã nộp duyệt.
  IF trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Chi sua duoc hang muc khi RFQ con o DRAFT, RFQ nay dang %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_items') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_items')
                                 AND t.tgname = 'rfq_items_chi_sua_khi_soan'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_items_chi_sua_khi_soan()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_items_chi_sua_khi_soan BEFORE INSERT OR DELETE OR UPDATE ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION rfq_items_chi_sua_khi_soan()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_items_chi_sua_khi_soan ON public.rfq_items;
             CREATE TRIGGER rfq_items_chi_sua_khi_soan BEFORE INSERT OR DELETE OR UPDATE ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION public.rfq_items_chi_sua_khi_soan();
             ALTER TABLE public.rfq_items ENABLE ALWAYS TRIGGER rfq_items_chi_sua_khi_soan;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE rfq uuid; org uuid; trang_thai text; BEGIN IF TG_OP = 'DELETE' THEN rfq := OLD.rfq_id; org := OLD.org_id; ELSE rfq := NEW.rfq_id; org := NEW.org_id; END IF; -- [M-4] `FOR NO KEY UPDATE` tuần tự hoá đúng cặp thao tác này với chuyển trạng thái RFQ. Không -- có nó, dưới READ COMMITTED: T1 mở RFQ (đếm 1 hạng mục, đi qua, chưa commit) trong khi T2 xoá -- hạng mục (đọc status từ ảnh chụp cũ, thấy DRAFT, cho qua) -> RFQ OPEN với 0 hạng mục. SELECT p.status INTO trang_thai FROM public.rfq_packages p WHERE p.id = rfq AND p.org_id = org FOR NO KEY UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay RFQ cho hang muc nay' USING ERRCODE = 'check_violation'; END IF; -- [C-1] `PENDING_APPROVAL` BỊ GỠ. Đây là nửa còn lại của bản vá CRITICAL: băm nội dung làm chữ -- ký cũ vô hiệu, còn dòng này chặn hẳn việc sửa sau khi đã nộp duyệt. IF trang_thai <> 'DRAFT' THEN RAISE EXCEPTION 'Chi sua duoc hang muc khi RFQ con o DRAFT, RFQ nay dang %', trang_thai USING ERRCODE = 'check_violation'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_items')
                           AND t.tgname = 'rfq_items_chi_sua_khi_soan'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_items_chi_sua_khi_soan()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_items_chi_sua_khi_soan BEFORE INSERT OR DELETE OR UPDATE ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION rfq_items_chi_sua_khi_soan()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_items_chi_sua_khi_soan()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_items_chi_sua_khi_soan()')),
                  'hàm public.rfq_items_chi_sua_khi_soan() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_items_chi_sua_khi_soan() và bảng public.rfq_items (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_key_material_bat_bien (026)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '026_xoa_mat_ma_vat_lieu_khoa.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_key_material_bat_bien()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_key_material_bat_bien();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_key_material_bat_bien() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  v_gio integer;
BEGIN
  IF TG_OP OPERATOR(pg_catalog.=) 'DELETE' THEN
    RAISE EXCEPTION 'Khong duoc xoa vat lieu khoa cua RFQ (G2/G4)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
     OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
     OR NEW.public_key IS DISTINCT FROM OLD.public_key
     OR NEW.key_version IS DISTINCT FROM OLD.key_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_by_session_id IS DISTINCT FROM OLD.created_by_session_id THEN
    RAISE EXCEPTION 'Chi sua duoc bon cot thu hoi va ba cot xoa cua rfq_key_material'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Thu hồi là MỘT CHIỀU. Gỡ thu hồi là làm sống lại một khoá đã được tuyên là chết.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'Khong go duoc thu hoi cua vat lieu khoa'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Xoá cũng MỘT CHIỀU: đã xoá thì không hàng nào ở trên nó sửa được nữa.
  IF OLD.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'Vat lieu khoa da bi xoa — khong sua duoc nua'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.wrapped_private_key IS DISTINCT FROM OLD.wrapped_private_key THEN
    -- Điều kiện ⑷: hướng DUY NHẤT được phép là về NULL. Một giá trị mới khác NULL là một lần
    -- THAY KHOÁ nguỵ trang, và `app_api` không đọc được cột này nên nó cũng không kiểm chứng
    -- được mình đang thay bằng cái gì.
    IF NEW.wrapped_private_key IS NOT NULL THEN
      RAISE EXCEPTION 'Chi duoc xoa wrapped_private_key ve NULL, khong duoc thay gia tri khac'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.purged_at IS NULL THEN
      RAISE EXCEPTION 'Xoa wrapped_private_key phai di kem purged_at'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Điều kiện ⑴.
    IF OLD.revoked_at IS NULL THEN
      RAISE EXCEPTION 'Chi xoa duoc vat lieu khoa DA THU HOI'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Điều kiện ⑵ và ⑶, đọc lại từ chính sách chứ không tin lời người gọi.
    SELECT p.key_purge_grace_hours INTO v_gio
      FROM org_procurement_policies p
      JOIN rfq_packages r ON r.org_id OPERATOR(pg_catalog.=) p.org_id
     WHERE r.id OPERATOR(pg_catalog.=) OLD.rfq_id
       AND p.effective_from OPERATOR(pg_catalog.<=) r.created_at
     ORDER BY p.effective_from DESC, p.version DESC
     LIMIT 1;
    IF v_gio IS NULL THEN
      RAISE EXCEPTION 'Chinh sach cua to chuc KHONG bat xoa vat lieu khoa (key_purge_grace_hours NULL)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF clock_timestamp()
       OPERATOR(pg_catalog.<) (OLD.revoked_at + make_interval(hours => v_gio)) THEN
      RAISE EXCEPTION 'Con trong quang an han — chua xoa duoc vat lieu khoa'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
    -- Đánh dấu đã xoá mà không thật sự xoá là một câu nói dối trong chính bảng. `CHECK` ở (2) đã
    -- chặn, nhưng nói ra ở đây cho ra thông điệp đọc được thay vì một tên ràng buộc.
    RAISE EXCEPTION 'purged_at chi duoc dat CUNG LUC voi viec xoa wrapped_private_key'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_key_material') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                                 AND t.tgname = 'rfq_key_material_bat_bien'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_key_material_bat_bien()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_bat_bien BEFORE DELETE OR UPDATE ON public.rfq_key_material FOR EACH ROW EXECUTE FUNCTION rfq_key_material_bat_bien()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_key_material_bat_bien ON public.rfq_key_material;
             CREATE TRIGGER rfq_key_material_bat_bien BEFORE DELETE OR UPDATE ON public.rfq_key_material FOR EACH ROW EXECUTE FUNCTION public.rfq_key_material_bat_bien();
             ALTER TABLE public.rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_bat_bien;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE v_gio integer; BEGIN IF TG_OP OPERATOR(pg_catalog.=) 'DELETE' THEN RAISE EXCEPTION 'Khong duoc xoa vat lieu khoa cua RFQ (G2/G4)' USING ERRCODE = 'check_violation'; END IF; IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.rfq_id IS DISTINCT FROM OLD.rfq_id OR NEW.algorithm IS DISTINCT FROM OLD.algorithm OR NEW.public_key IS DISTINCT FROM OLD.public_key OR NEW.key_version IS DISTINCT FROM OLD.key_version OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_by_session_id IS DISTINCT FROM OLD.created_by_session_id THEN RAISE EXCEPTION 'Chi sua duoc bon cot thu hoi va ba cot xoa cua rfq_key_material' USING ERRCODE = 'check_violation'; END IF; -- Thu hồi là MỘT CHIỀU. Gỡ thu hồi là làm sống lại một khoá đã được tuyên là chết. IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION 'Khong go duoc thu hoi cua vat lieu khoa' USING ERRCODE = 'check_violation'; END IF; -- Xoá cũng MỘT CHIỀU: đã xoá thì không hàng nào ở trên nó sửa được nữa. IF OLD.purged_at IS NOT NULL THEN RAISE EXCEPTION 'Vat lieu khoa da bi xoa — khong sua duoc nua' USING ERRCODE = 'check_violation'; END IF; IF NEW.wrapped_private_key IS DISTINCT FROM OLD.wrapped_private_key THEN -- Điều kiện ⑷: hướng DUY NHẤT được phép là về NULL. Một giá trị mới khác NULL là một lần -- THAY KHOÁ nguỵ trang, và `app_api` không đọc được cột này nên nó cũng không kiểm chứng -- được mình đang thay bằng cái gì. IF NEW.wrapped_private_key IS NOT NULL THEN RAISE EXCEPTION 'Chi duoc xoa wrapped_private_key ve NULL, khong duoc thay gia tri khac' USING ERRCODE = 'check_violation'; END IF; IF NEW.purged_at IS NULL THEN RAISE EXCEPTION 'Xoa wrapped_private_key phai di kem purged_at' USING ERRCODE = 'check_violation'; END IF; -- Điều kiện ⑴. IF OLD.revoked_at IS NULL THEN RAISE EXCEPTION 'Chi xoa duoc vat lieu khoa DA THU HOI' USING ERRCODE = 'check_violation'; END IF; -- Điều kiện ⑵ và ⑶, đọc lại từ chính sách chứ không tin lời người gọi. SELECT p.key_purge_grace_hours INTO v_gio FROM org_procurement_policies p JOIN rfq_packages r ON r.org_id OPERATOR(pg_catalog.=) p.org_id WHERE r.id OPERATOR(pg_catalog.=) OLD.rfq_id AND p.effective_from OPERATOR(pg_catalog.<=) r.created_at ORDER BY p.effective_from DESC, p.version DESC LIMIT 1; IF v_gio IS NULL THEN RAISE EXCEPTION 'Chinh sach cua to chuc KHONG bat xoa vat lieu khoa (key_purge_grace_hours NULL)' USING ERRCODE = 'check_violation'; END IF; IF clock_timestamp() OPERATOR(pg_catalog.<) (OLD.revoked_at + make_interval(hours => v_gio)) THEN RAISE EXCEPTION 'Con trong quang an han — chua xoa duoc vat lieu khoa' USING ERRCODE = 'check_violation'; END IF; ELSIF NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN -- Đánh dấu đã xoá mà không thật sự xoá là một câu nói dối trong chính bảng. `CHECK` ở (2) đã -- chặn, nhưng nói ra ở đây cho ra thông điệp đọc được thay vì một tên ràng buộc. RAISE EXCEPTION 'purged_at chi duoc dat CUNG LUC voi viec xoa wrapped_private_key' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                           AND t.tgname = 'rfq_key_material_bat_bien'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_key_material_bat_bien()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_bat_bien BEFORE DELETE OR UPDATE ON public.rfq_key_material FOR EACH ROW EXECUTE FUNCTION rfq_key_material_bat_bien()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_key_material_bat_bien()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_key_material_bat_bien()')),
                  'hàm public.rfq_key_material_bat_bien() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_key_material_bat_bien() và bảng public.rfq_key_material (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_khoa_chi_sinh_luc_mo (017)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '017_rfq_key_material.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_khoa_chi_sinh_luc_mo()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_khoa_chi_sinh_luc_mo();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_khoa_chi_sinh_luc_mo() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF trang_thai IS DISTINCT FROM 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Cap khoa RFQ chi sinh duoc luc chuyen sang OPEN; RFQ dang o % (C5)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_key_material') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                                 AND t.tgname = 'rfq_key_material_chi_sinh_luc_mo'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_khoa_chi_sinh_luc_mo()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_chi_sinh_luc_mo BEFORE INSERT ON public.rfq_key_material FOR EACH ROW EXECUTE FUNCTION rfq_khoa_chi_sinh_luc_mo()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_key_material_chi_sinh_luc_mo ON public.rfq_key_material;
             CREATE TRIGGER rfq_key_material_chi_sinh_luc_mo BEFORE INSERT ON public.rfq_key_material FOR EACH ROW EXECUTE FUNCTION public.rfq_khoa_chi_sinh_luc_mo();
             ALTER TABLE public.rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_chi_sinh_luc_mo;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE trang_thai text; BEGIN SELECT p.status INTO trang_thai FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id FOR NO KEY UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id USING ERRCODE = 'foreign_key_violation'; END IF; IF trang_thai IS DISTINCT FROM 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'Cap khoa RFQ chi sinh duoc luc chuyen sang OPEN; RFQ dang o % (C5)', trang_thai USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                           AND t.tgname = 'rfq_key_material_chi_sinh_luc_mo'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_khoa_chi_sinh_luc_mo()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_chi_sinh_luc_mo BEFORE INSERT ON public.rfq_key_material FOR EACH ROW EXECUTE FUNCTION rfq_khoa_chi_sinh_luc_mo()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_khoa_chi_sinh_luc_mo()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_khoa_chi_sinh_luc_mo()')),
                  'hàm public.rfq_khoa_chi_sinh_luc_mo() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_khoa_chi_sinh_luc_mo() và bảng public.rfq_key_material (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_khoa_chi_thu_hoi_khi_huy (017)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '017_rfq_key_material.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_khoa_chi_thu_hoi_khi_huy()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_khoa_chi_thu_hoi_khi_huy();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_khoa_chi_thu_hoi_khi_huy() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF trang_thai IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION 'Chi thu hoi duoc vat lieu khoa khi RFQ da huy; RFQ dang o %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_key_material') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                                 AND t.tgname = 'rfq_key_material_chi_thu_hoi_khi_huy'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_khoa_chi_thu_hoi_khi_huy()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_chi_thu_hoi_khi_huy BEFORE UPDATE ON public.rfq_key_material FOR EACH ROW WHEN (((new.revoked_at IS NOT NULL) AND (old.revoked_at IS NULL))) EXECUTE FUNCTION rfq_khoa_chi_thu_hoi_khi_huy()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_key_material_chi_thu_hoi_khi_huy ON public.rfq_key_material;
             CREATE TRIGGER rfq_key_material_chi_thu_hoi_khi_huy BEFORE UPDATE ON public.rfq_key_material FOR EACH ROW WHEN (((new.revoked_at IS NOT NULL) AND (old.revoked_at IS NULL))) EXECUTE FUNCTION public.rfq_khoa_chi_thu_hoi_khi_huy();
             ALTER TABLE public.rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_chi_thu_hoi_khi_huy;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE trang_thai text; BEGIN SELECT p.status INTO trang_thai FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id; IF trang_thai IS DISTINCT FROM 'CANCELLED' THEN RAISE EXCEPTION 'Chi thu hoi duoc vat lieu khoa khi RFQ da huy; RFQ dang o %', trang_thai USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                           AND t.tgname = 'rfq_key_material_chi_thu_hoi_khi_huy'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_khoa_chi_thu_hoi_khi_huy()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_key_material_chi_thu_hoi_khi_huy BEFORE UPDATE ON public.rfq_key_material FOR EACH ROW WHEN (((new.revoked_at IS NOT NULL) AND (old.revoked_at IS NULL))) EXECUTE FUNCTION rfq_khoa_chi_thu_hoi_khi_huy()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_khoa_chi_thu_hoi_khi_huy()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_khoa_chi_thu_hoi_khi_huy()')),
                  'hàm public.rfq_khoa_chi_thu_hoi_khi_huy() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_khoa_chi_thu_hoi_khi_huy() và bảng public.rfq_key_material (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_khoa_phai_di_kem_lan_mo (017)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '017_rfq_key_material.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_khoa_phai_di_kem_lan_mo()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_khoa_phai_di_kem_lan_mo();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_khoa_phai_di_kem_lan_mo() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- MỘT TẬP, KHÔNG PHẢI MỘT GIÁ TRỊ — và bản đầu viết `IS DISTINCT FROM 'OPEN'` là SAI.
  -- Phát hiện bằng phép đo, không bằng suy luận: `packages/rfq/src/rfq.int.test.ts` có nhiều
  -- giao dịch mở RFQ RỒI ĐÓNG NGAY trong cùng một `withTenant`, nên tại COMMIT trạng thái là
  -- `CLOSED` chứ không phải `OPEN`, và sáu test đỏ vì một lý do KHÔNG liên quan gì tới C5.
  -- Điều cần đòi là RFQ đã đi QUA cửa OPEN, không phải nó đang ĐỨNG ở đó. Bốn trạng thái dưới
  -- đây là toàn bộ tập tới được từ `PENDING_APPROVAL` mà đường đi bắt buộc qua `OPEN` — hai
  -- trạng thái còn lại (`PENDING_APPROVAL`, `CANCELLED`) đều nghĩa là cặp khoá này mồ côi.
  IF trang_thai NOT IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING') THEN
    RAISE EXCEPTION
      'Sinh khoa cho RFQ % ma khong mo no trong cung giao dich (dang o %) (C5)',
      NEW.rfq_id, trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$ham$;
           IF to_regclass('public.rfq_key_material') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                                 AND t.tgname = 'rfq_key_material_phai_di_kem_lan_mo'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_khoa_phai_di_kem_lan_mo()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE CONSTRAINT TRIGGER rfq_key_material_phai_di_kem_lan_mo AFTER INSERT ON public.rfq_key_material DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rfq_khoa_phai_di_kem_lan_mo()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_key_material_phai_di_kem_lan_mo ON public.rfq_key_material;
             CREATE CONSTRAINT TRIGGER rfq_key_material_phai_di_kem_lan_mo AFTER INSERT ON public.rfq_key_material DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rfq_khoa_phai_di_kem_lan_mo();
             ALTER TABLE public.rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_phai_di_kem_lan_mo;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE trang_thai text; BEGIN SELECT p.status INTO trang_thai FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id; IF NOT FOUND THEN RETURN NULL; END IF; -- MỘT TẬP, KHÔNG PHẢI MỘT GIÁ TRỊ — và bản đầu viết `IS DISTINCT FROM 'OPEN'` là SAI. -- Phát hiện bằng phép đo, không bằng suy luận: `packages/rfq/src/rfq.int.test.ts` có nhiều -- giao dịch mở RFQ RỒI ĐÓNG NGAY trong cùng một `withTenant`, nên tại COMMIT trạng thái là -- `CLOSED` chứ không phải `OPEN`, và sáu test đỏ vì một lý do KHÔNG liên quan gì tới C5. -- Điều cần đòi là RFQ đã đi QUA cửa OPEN, không phải nó đang ĐỨNG ở đó. Bốn trạng thái dưới -- đây là toàn bộ tập tới được từ `PENDING_APPROVAL` mà đường đi bắt buộc qua `OPEN` — hai -- trạng thái còn lại (`PENDING_APPROVAL`, `CANCELLED`) đều nghĩa là cặp khoá này mồ côi. IF trang_thai NOT IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING') THEN RAISE EXCEPTION 'Sinh khoa cho RFQ % ma khong mo no trong cung giao dich (dang o %) (C5)', NEW.rfq_id, trang_thai USING ERRCODE = 'check_violation'; END IF; RETURN NULL; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_key_material')
                           AND t.tgname = 'rfq_key_material_phai_di_kem_lan_mo'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_khoa_phai_di_kem_lan_mo()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE CONSTRAINT TRIGGER rfq_key_material_phai_di_kem_lan_mo AFTER INSERT ON public.rfq_key_material DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rfq_khoa_phai_di_kem_lan_mo()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_khoa_phai_di_kem_lan_mo()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_khoa_phai_di_kem_lan_mo()')),
                  'hàm public.rfq_khoa_phai_di_kem_lan_mo() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_khoa_phai_di_kem_lan_mo() và bảng public.rfq_key_material (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_kiem_chuyen_trang_thai (011)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '011_rfq_hardening.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_kiem_chuyen_trang_thai()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_kiem_chuyen_trang_thai();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_kiem_chuyen_trang_thai() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  -- `PENDING_APPROVAL->DRAFT` là cạnh MỚI của vòng sửa này: sau C-1, hạng mục chỉ sửa được ở
  -- DRAFT, nên phải có đường quay lại — và đường ấy XOÁ MỌI CHỮ KÝ PHÊ DUYỆT (trigger dưới).
  CANH_HOP_LE constant text[] := ARRAY[
    'DRAFT->PENDING_APPROVAL',
    'PENDING_APPROVAL->DRAFT',
    'PENDING_APPROVAL->OPEN',
    'OPEN->CLOSED',
    'CLOSED->UNSEALED',
    'UNSEALED->EVALUATING',
    'DRAFT->CANCELLED',
    'PENDING_APPROVAL->CANCELLED',
    'OPEN->CANCELLED'
  ];
  -- Cửa sổ thầu tối thiểu. ARCHITECTURE §6 đòi "deadline ≥ now + cửa sổ tối thiểu" và KHÔNG tầng
  -- nào cài đặt nó (M-5). Sàn dưới ở đây là sàn CỦA HỆ, không phải chính sách của tổ chức: một
  -- RFQ mở với deadline đã ở quá khứ là một trạng thái hỏng TRÊN DỮ LIỆU.
  CUA_SO_TOI_THIEU constant interval := interval '1 hour';
  so_hang_muc integer;
  so_phe_duyet integer;
  bam_hien_tai bytea;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status || '->' || NEW.status) = ANY (CANH_HOP_LE)) THEN
      RAISE EXCEPTION 'Chuyen trang thai RFQ khong hop le: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (b) deadline không bao giờ lùi. [L-1] Vế `NEW.deadline_at IS NULL` được thêm ở vòng sửa này:
  -- bản 009 chỉ chạy khi CẢ HAI giá trị NOT NULL, nên ở DRAFT hai câu `SET NULL` rồi `SET <sớm
  -- hơn>` lùi được deadline. Chú thích và tên test của 009 vì vậy rộng hơn mã; nay thì không.
  IF OLD.deadline_at IS NOT NULL
     AND (NEW.deadline_at IS NULL OR NEW.deadline_at < OLD.deadline_at) THEN
    RAISE EXCEPTION 'Khong duoc rut ngan hay xoa deadline cua RFQ (C4)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (c) [C-1] `PENDING_APPROVAL` BỊ GỠ khỏi danh sách được đổi deadline: sau khi đã nộp duyệt,
  -- đổi deadline là đổi nội dung mà người duyệt sẽ ký.
  IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
     AND OLD.status NOT IN ('DRAFT', 'OPEN') THEN
    RAISE EXCEPTION 'Chi doi duoc deadline khi RFQ dang DRAFT hoac OPEN (C4)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW.title IS DISTINCT FROM OLD.title
      OR NEW.requires_dual_approval IS DISTINCT FROM OLD.requires_dual_approval)
     AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Chi sua duoc tieu de va nguong phe duyet khi RFQ con o DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (f) [H-3] BA MỐC CHỈ ĐẶT ĐƯỢC MỘT LẦN. Không có vế này, gọi lại `openRfq` trên một RFQ đang
  -- OPEN đẩy `opened_at` tới hiện tại, và mọi phép kiểm khác im lặng vì status không đổi.
  IF OLD.opened_at IS NOT NULL AND NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'opened_at chi dat duoc mot lan' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'closed_at chi dat duoc mot lan' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    RAISE EXCEPTION 'cancelled_at chi dat duoc mot lan' USING ERRCODE = 'check_violation';
  END IF;

  -- (g) [M-5] Cửa sổ thầu tối thiểu, kiểm ở CẢ HAI cạnh đi vào vòng phê duyệt và vòng mở.
  IF NEW.status IN ('PENDING_APPROVAL', 'OPEN') AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.deadline_at IS NULL OR NEW.deadline_at < now() + CUA_SO_TOI_THIEU THEN
      RAISE EXCEPTION 'Cua so thau phai con it nhat % ke tu bay gio', CUA_SO_TOI_THIEU
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (h) [H-4] ĐÓNG SỚM là một hành vi có tên. Đóng đúng hạn không đòi gì thêm.
  IF NEW.status = 'CLOSED' AND OLD.status = 'OPEN' AND now() < OLD.deadline_at THEN
    IF NEW.early_close_reason IS NULL THEN
      RAISE EXCEPTION 'Dong RFQ truoc han phai co ly do tuong minh (early_close_reason)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'OPEN' THEN
    SELECT count(*) INTO so_hang_muc FROM public.rfq_items i WHERE i.rfq_id = NEW.id;
    IF so_hang_muc = 0 THEN
      RAISE EXCEPTION 'Khong mo duoc RFQ khong co hang muc nao'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.requires_dual_approval THEN
      -- [C-1] Đây là dòng đóng CRITICAL: đếm phê duyệt TRÊN ĐÚNG NỘI DUNG hiện tại, không đếm
      -- "có bao nhiêu hàng". Thêm một hạng mục sau khi đã duyệt làm băm đổi, và hai chữ ký cũ
      -- không còn đếm được nữa.
      bam_hien_tai := public.rfq_bam_noi_dung(NEW.id);
      SELECT count(*) INTO so_phe_duyet
        FROM public.rfq_approvals a
       WHERE a.rfq_id = NEW.id AND a.approved_content_hash = bam_hien_tai;
      IF so_phe_duyet < 2 THEN
        RAISE EXCEPTION
          'RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co % (D2)', so_phe_duyet
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_chuyen_trang_thai'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_kiem_chuyen_trang_thai()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_chuyen_trang_thai BEFORE UPDATE ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION rfq_kiem_chuyen_trang_thai()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_chuyen_trang_thai ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_chuyen_trang_thai BEFORE UPDATE ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_chuyen_trang_thai();
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_chuyen_trang_thai;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE -- `PENDING_APPROVAL->DRAFT` là cạnh MỚI của vòng sửa này: sau C-1, hạng mục chỉ sửa được ở -- DRAFT, nên phải có đường quay lại — và đường ấy XOÁ MỌI CHỮ KÝ PHÊ DUYỆT (trigger dưới). CANH_HOP_LE constant text[] := ARRAY[ 'DRAFT->PENDING_APPROVAL', 'PENDING_APPROVAL->DRAFT', 'PENDING_APPROVAL->OPEN', 'OPEN->CLOSED', 'CLOSED->UNSEALED', 'UNSEALED->EVALUATING', 'DRAFT->CANCELLED', 'PENDING_APPROVAL->CANCELLED', 'OPEN->CANCELLED' ]; -- Cửa sổ thầu tối thiểu. ARCHITECTURE §6 đòi "deadline ≥ now + cửa sổ tối thiểu" và KHÔNG tầng -- nào cài đặt nó (M-5). Sàn dưới ở đây là sàn CỦA HỆ, không phải chính sách của tổ chức: một -- RFQ mở với deadline đã ở quá khứ là một trạng thái hỏng TRÊN DỮ LIỆU. CUA_SO_TOI_THIEU constant interval := interval '1 hour'; so_hang_muc integer; so_phe_duyet integer; bam_hien_tai bytea; BEGIN IF NEW.status IS DISTINCT FROM OLD.status THEN IF NOT ((OLD.status || '->' || NEW.status) = ANY (CANH_HOP_LE)) THEN RAISE EXCEPTION 'Chuyen trang thai RFQ khong hop le: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation'; END IF; END IF; -- (b) deadline không bao giờ lùi. [L-1] Vế `NEW.deadline_at IS NULL` được thêm ở vòng sửa này: -- bản 009 chỉ chạy khi CẢ HAI giá trị NOT NULL, nên ở DRAFT hai câu `SET NULL` rồi `SET <sớm -- hơn>` lùi được deadline. Chú thích và tên test của 009 vì vậy rộng hơn mã; nay thì không. IF OLD.deadline_at IS NOT NULL AND (NEW.deadline_at IS NULL OR NEW.deadline_at < OLD.deadline_at) THEN RAISE EXCEPTION 'Khong duoc rut ngan hay xoa deadline cua RFQ (C4)' USING ERRCODE = 'check_violation'; END IF; -- (c) [C-1] `PENDING_APPROVAL` BỊ GỠ khỏi danh sách được đổi deadline: sau khi đã nộp duyệt, -- đổi deadline là đổi nội dung mà người duyệt sẽ ký. IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at AND OLD.status NOT IN ('DRAFT', 'OPEN') THEN RAISE EXCEPTION 'Chi doi duoc deadline khi RFQ dang DRAFT hoac OPEN (C4)' USING ERRCODE = 'check_violation'; END IF; IF (NEW.title IS DISTINCT FROM OLD.title OR NEW.requires_dual_approval IS DISTINCT FROM OLD.requires_dual_approval) AND OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Chi sua duoc tieu de va nguong phe duyet khi RFQ con o DRAFT' USING ERRCODE = 'check_violation'; END IF; -- (f) [H-3] BA MỐC CHỈ ĐẶT ĐƯỢC MỘT LẦN. Không có vế này, gọi lại `openRfq` trên một RFQ đang -- OPEN đẩy `opened_at` tới hiện tại, và mọi phép kiểm khác im lặng vì status không đổi. IF OLD.opened_at IS NOT NULL AND NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN RAISE EXCEPTION 'opened_at chi dat duoc mot lan' USING ERRCODE = 'check_violation'; END IF; IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN RAISE EXCEPTION 'closed_at chi dat duoc mot lan' USING ERRCODE = 'check_violation'; END IF; IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN RAISE EXCEPTION 'cancelled_at chi dat duoc mot lan' USING ERRCODE = 'check_violation'; END IF; -- (g) [M-5] Cửa sổ thầu tối thiểu, kiểm ở CẢ HAI cạnh đi vào vòng phê duyệt và vòng mở. IF NEW.status IN ('PENDING_APPROVAL', 'OPEN') AND NEW.status IS DISTINCT FROM OLD.status THEN IF NEW.deadline_at IS NULL OR NEW.deadline_at < now() + CUA_SO_TOI_THIEU THEN RAISE EXCEPTION 'Cua so thau phai con it nhat % ke tu bay gio', CUA_SO_TOI_THIEU USING ERRCODE = 'check_violation'; END IF; END IF; -- (h) [H-4] ĐÓNG SỚM là một hành vi có tên. Đóng đúng hạn không đòi gì thêm. IF NEW.status = 'CLOSED' AND OLD.status = 'OPEN' AND now() < OLD.deadline_at THEN IF NEW.early_close_reason IS NULL THEN RAISE EXCEPTION 'Dong RFQ truoc han phai co ly do tuong minh (early_close_reason)' USING ERRCODE = 'check_violation'; END IF; END IF; IF NEW.status = 'OPEN' THEN SELECT count(*) INTO so_hang_muc FROM public.rfq_items i WHERE i.rfq_id = NEW.id; IF so_hang_muc = 0 THEN RAISE EXCEPTION 'Khong mo duoc RFQ khong co hang muc nao' USING ERRCODE = 'check_violation'; END IF; IF NEW.requires_dual_approval THEN -- [C-1] Đây là dòng đóng CRITICAL: đếm phê duyệt TRÊN ĐÚNG NỘI DUNG hiện tại, không đếm -- "có bao nhiêu hàng". Thêm một hạng mục sau khi đã duyệt làm băm đổi, và hai chữ ký cũ -- không còn đếm được nữa. bam_hien_tai := public.rfq_bam_noi_dung(NEW.id); SELECT count(*) INTO so_phe_duyet FROM public.rfq_approvals a WHERE a.rfq_id = NEW.id AND a.approved_content_hash = bam_hien_tai; IF so_phe_duyet < 2 THEN RAISE EXCEPTION 'RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co % (D2)', so_phe_duyet USING ERRCODE = 'check_violation'; END IF; END IF; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_packages')
                           AND t.tgname = 'rfq_packages_kiem_chuyen_trang_thai'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_kiem_chuyen_trang_thai()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_chuyen_trang_thai BEFORE UPDATE ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION rfq_kiem_chuyen_trang_thai()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_kiem_chuyen_trang_thai()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_kiem_chuyen_trang_thai()')),
                  'hàm public.rfq_kiem_chuyen_trang_thai() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_kiem_chuyen_trang_thai() và bảng public.rfq_packages (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_kiem_khoa_khi_mo (017)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '017_rfq_key_material.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_kiem_khoa_khi_mo()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_kiem_khoa_khi_mo();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_kiem_khoa_khi_mo() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  so_khoa integer;
BEGIN
  SELECT count(*) INTO so_khoa
    FROM public.rfq_key_material k
   WHERE k.rfq_id OPERATOR(pg_catalog.=) NEW.id
     AND k.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND k.algorithm OPERATOR(pg_catalog.=) public.rfq_thuat_toan_mac_dinh()
     AND k.revoked_at IS NULL;
  IF so_khoa OPERATOR(pg_catalog.=) 0 THEN
    RAISE EXCEPTION
      'Khong mo duoc RFQ khi chua co cap khoa % (C5)', public.rfq_thuat_toan_mac_dinh()
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_khoa_khi_mo'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_kiem_khoa_khi_mo()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_khoa_khi_mo BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'OPEN'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION rfq_kiem_khoa_khi_mo()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_khoa_khi_mo ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_khoa_khi_mo BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'OPEN'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION public.rfq_kiem_khoa_khi_mo();
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_khoa_khi_mo;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE so_khoa integer; BEGIN SELECT count(*) INTO so_khoa FROM public.rfq_key_material k WHERE k.rfq_id OPERATOR(pg_catalog.=) NEW.id AND k.org_id OPERATOR(pg_catalog.=) NEW.org_id AND k.algorithm OPERATOR(pg_catalog.=) public.rfq_thuat_toan_mac_dinh() AND k.revoked_at IS NULL; IF so_khoa OPERATOR(pg_catalog.=) 0 THEN RAISE EXCEPTION 'Khong mo duoc RFQ khi chua co cap khoa % (C5)', public.rfq_thuat_toan_mac_dinh() USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_packages')
                           AND t.tgname = 'rfq_packages_kiem_khoa_khi_mo'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_kiem_khoa_khi_mo()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_khoa_khi_mo BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'OPEN'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION rfq_kiem_khoa_khi_mo()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_kiem_khoa_khi_mo()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_kiem_khoa_khi_mo()')),
                  'hàm public.rfq_kiem_khoa_khi_mo() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_kiem_khoa_khi_mo() và bảng public.rfq_packages (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_kiem_nguoi_duyet (011)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '011_rfq_hardening.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_kiem_nguoi_duyet()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_kiem_nguoi_duyet();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_kiem_nguoi_duyet() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  nguoi_tao uuid;
  trang_thai text;
  chu_phien uuid;
BEGIN
  -- [M-3] `AND p.org_id = NEW.org_id` cộng `IF NOT FOUND`: bản 009 so với NULL khi không thấy
  -- hàng cha, và `NULL = x` cho NULL nên CẢ HAI phép kiểm D2 im lặng đi qua. Hôm nay chưa khai
  -- thác được (khoá ngoại hợp thành giữ hàng cha tồn tại), nhưng bốn tính chất phải đồng thời
  -- đúng để chỗ đó an toàn và không lớp nào ghim bốn tính chất ấy lại với nhau.
  SELECT p.created_by, p.status INTO nguoi_tao, trang_thai
    FROM public.rfq_packages p WHERE p.id = NEW.rfq_id AND p.org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ cho phe duyet nay' USING ERRCODE = 'check_violation';
  END IF;

  IF nguoi_tao = NEW.approver_user_id THEN
    RAISE EXCEPTION 'Nguoi tao RFQ khong duoc la mot trong hai nguoi duyet (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF trang_thai <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Chi phe duyet duoc RFQ dang o PENDING_APPROVAL, RFQ nay dang %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  -- [H-2] Bản 009 chỉ đọc `user_id`. `sessions` có đủ `expires_at`, `revoked_at`,
  -- `mfa_verified_at` và không cột nào được kiểm — nên một phiên sáu tháng trước, hoặc một phiên
  -- ĐÃ BỊ THU HỒI vì nghi ngờ chiếm đoạt, vẫn ký được một phê duyệt. Quy trình ứng phó sự cố
  -- "thu hồi hết phiên của người này" KHÔNG đóng được đường phê duyệt.
  --
  -- `mfa_verified_at IS NOT NULL` là vế của D1 áp cho thao tác này. Cửa sổ tươi của MFA thì KHÔNG
  -- kiểm ở đây: hằng số ấy thuộc `assertFreshMfa` (packages/identity) và nhân bản nó vào plpgsql
  -- sẽ tạo hai nguồn sự thật. Phần chênh đó phải vào §4 của ma trận.
  SELECT s.user_id INTO chu_phien
    FROM public.sessions s
   WHERE s.id = NEW.session_id
     AND s.org_id = NEW.org_id
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.mfa_verified_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien khong hop le: het han, bi thu hoi, hoac chua qua MFA (D2/D1)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF chu_phien IS DISTINCT FROM NEW.approver_user_id THEN
    RAISE EXCEPTION 'Phien duoc dan ra khong thuoc ve nguoi duyet (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [C-1] Chữ ký MANG nội dung nó ký. Bên gọi không khai được cột này (không có GRANT INSERT).
  NEW.approved_content_hash := public.rfq_bam_noi_dung(NEW.rfq_id);

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_approvals') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_approvals')
                                 AND t.tgname = 'rfq_approvals_kiem_nguoi_duyet'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_kiem_nguoi_duyet()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_approvals_kiem_nguoi_duyet BEFORE INSERT ON public.rfq_approvals FOR EACH ROW EXECUTE FUNCTION rfq_kiem_nguoi_duyet()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_approvals_kiem_nguoi_duyet ON public.rfq_approvals;
             CREATE TRIGGER rfq_approvals_kiem_nguoi_duyet BEFORE INSERT ON public.rfq_approvals FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_nguoi_duyet();
             ALTER TABLE public.rfq_approvals ENABLE ALWAYS TRIGGER rfq_approvals_kiem_nguoi_duyet;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE nguoi_tao uuid; trang_thai text; chu_phien uuid; BEGIN -- [M-3] `AND p.org_id = NEW.org_id` cộng `IF NOT FOUND`: bản 009 so với NULL khi không thấy -- hàng cha, và `NULL = x` cho NULL nên CẢ HAI phép kiểm D2 im lặng đi qua. Hôm nay chưa khai -- thác được (khoá ngoại hợp thành giữ hàng cha tồn tại), nhưng bốn tính chất phải đồng thời -- đúng để chỗ đó an toàn và không lớp nào ghim bốn tính chất ấy lại với nhau. SELECT p.created_by, p.status INTO nguoi_tao, trang_thai FROM public.rfq_packages p WHERE p.id = NEW.rfq_id AND p.org_id = NEW.org_id; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay RFQ cho phe duyet nay' USING ERRCODE = 'check_violation'; END IF; IF nguoi_tao = NEW.approver_user_id THEN RAISE EXCEPTION 'Nguoi tao RFQ khong duoc la mot trong hai nguoi duyet (D2)' USING ERRCODE = 'check_violation'; END IF; IF trang_thai <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'Chi phe duyet duoc RFQ dang o PENDING_APPROVAL, RFQ nay dang %', trang_thai USING ERRCODE = 'check_violation'; END IF; -- [H-2] Bản 009 chỉ đọc `user_id`. `sessions` có đủ `expires_at`, `revoked_at`, -- `mfa_verified_at` và không cột nào được kiểm — nên một phiên sáu tháng trước, hoặc một phiên -- ĐÃ BỊ THU HỒI vì nghi ngờ chiếm đoạt, vẫn ký được một phê duyệt. Quy trình ứng phó sự cố -- "thu hồi hết phiên của người này" KHÔNG đóng được đường phê duyệt. -- -- `mfa_verified_at IS NOT NULL` là vế của D1 áp cho thao tác này. Cửa sổ tươi của MFA thì KHÔNG -- kiểm ở đây: hằng số ấy thuộc `assertFreshMfa` (packages/identity) và nhân bản nó vào plpgsql -- sẽ tạo hai nguồn sự thật. Phần chênh đó phải vào §4 của ma trận. SELECT s.user_id INTO chu_phien FROM public.sessions s WHERE s.id = NEW.session_id AND s.org_id = NEW.org_id AND s.revoked_at IS NULL AND s.expires_at > now() AND s.mfa_verified_at IS NOT NULL; IF NOT FOUND THEN RAISE EXCEPTION 'Phien khong hop le: het han, bi thu hoi, hoac chua qua MFA (D2/D1)' USING ERRCODE = 'check_violation'; END IF; IF chu_phien IS DISTINCT FROM NEW.approver_user_id THEN RAISE EXCEPTION 'Phien duoc dan ra khong thuoc ve nguoi duyet (D2)' USING ERRCODE = 'check_violation'; END IF; -- [C-1] Chữ ký MANG nội dung nó ký. Bên gọi không khai được cột này (không có GRANT INSERT). NEW.approved_content_hash := public.rfq_bam_noi_dung(NEW.rfq_id); RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_approvals')
                           AND t.tgname = 'rfq_approvals_kiem_nguoi_duyet'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_kiem_nguoi_duyet()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_approvals_kiem_nguoi_duyet BEFORE INSERT ON public.rfq_approvals FOR EACH ROW EXECUTE FUNCTION rfq_kiem_nguoi_duyet()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_kiem_nguoi_duyet()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_kiem_nguoi_duyet()')),
                  'hàm public.rfq_kiem_nguoi_duyet() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_kiem_nguoi_duyet() và bảng public.rfq_approvals (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_kiem_nguoi_tao (011)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '011_rfq_hardening.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_kiem_nguoi_tao()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_kiem_nguoi_tao();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_kiem_nguoi_tao() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  chu_phien uuid;
BEGIN
  IF NEW.created_by_session_id IS NULL THEN
    RAISE EXCEPTION 'RFQ phai mang phien cua nguoi tao (created_by_session_id)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.user_id INTO chu_phien
    FROM public.sessions s
   WHERE s.id = NEW.created_by_session_id
     AND s.org_id = NEW.org_id
     AND s.revoked_at IS NULL
     AND s.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien cua nguoi tao khong hop le: het han hoac bi thu hoi'
      USING ERRCODE = 'check_violation';
  END IF;

  IF chu_phien IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'created_by khong khop chu phien — no phai la DAN XUAT, khong phai loi khai'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_nguoi_tao'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_kiem_nguoi_tao()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_tao BEFORE INSERT ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION rfq_kiem_nguoi_tao()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_nguoi_tao ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_nguoi_tao BEFORE INSERT ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_nguoi_tao();
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_tao;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE chu_phien uuid; BEGIN IF NEW.created_by_session_id IS NULL THEN RAISE EXCEPTION 'RFQ phai mang phien cua nguoi tao (created_by_session_id)' USING ERRCODE = 'check_violation'; END IF; SELECT s.user_id INTO chu_phien FROM public.sessions s WHERE s.id = NEW.created_by_session_id AND s.org_id = NEW.org_id AND s.revoked_at IS NULL AND s.expires_at > now(); IF NOT FOUND THEN RAISE EXCEPTION 'Phien cua nguoi tao khong hop le: het han hoac bi thu hoi' USING ERRCODE = 'check_violation'; END IF; IF chu_phien IS DISTINCT FROM NEW.created_by THEN RAISE EXCEPTION 'created_by khong khop chu phien — no phai la DAN XUAT, khong phai loi khai' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_packages')
                           AND t.tgname = 'rfq_packages_kiem_nguoi_tao'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_kiem_nguoi_tao()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguoi_tao BEFORE INSERT ON public.rfq_packages FOR EACH ROW EXECUTE FUNCTION rfq_kiem_nguoi_tao()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_kiem_nguoi_tao()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_kiem_nguoi_tao()')),
                  'hàm public.rfq_kiem_nguoi_tao() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_kiem_nguoi_tao() và bảng public.rfq_packages (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_kiem_nguong_phe_duyet_kep (014)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '014_procurement_policy.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_kiem_nguong_phe_duyet_kep()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_kiem_nguong_phe_duyet_kep();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_kiem_nguong_phe_duyet_kep() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  can_kep boolean;
BEGIN
  -- Nghiêm hơn thì luôn được. Chỉ đường NỚI mới phải chứng minh.
  IF NEW.requires_dual_approval THEN
    RETURN NEW;
  END IF;

  can_kep := public.rfq_can_phe_duyet_kep(NEW.id);

  IF can_kep IS NULL THEN
    RAISE EXCEPTION
      'Bo phe duyet kep phai co bang chung: chua co ngan sach va chinh sach cho RFQ nay (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF can_kep THEN
    RAISE EXCEPTION 'Uoc luong dat hoac vuot nguong chinh sach — RFQ nay phai can hai phe duyet (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_nguong_phe_duyet_kep'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_kiem_nguong_phe_duyet_kep()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = ANY (ARRAY['PENDING_APPROVAL'::text, 'OPEN'::text])) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION rfq_kiem_nguong_phe_duyet_kep()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_nguong_phe_duyet_kep ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = ANY (ARRAY['PENDING_APPROVAL'::text, 'OPEN'::text])) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION public.rfq_kiem_nguong_phe_duyet_kep();
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE can_kep boolean; BEGIN -- Nghiêm hơn thì luôn được. Chỉ đường NỚI mới phải chứng minh. IF NEW.requires_dual_approval THEN RETURN NEW; END IF; can_kep := public.rfq_can_phe_duyet_kep(NEW.id); IF can_kep IS NULL THEN RAISE EXCEPTION 'Bo phe duyet kep phai co bang chung: chua co ngan sach va chinh sach cho RFQ nay (D2)' USING ERRCODE = 'check_violation'; END IF; IF can_kep THEN RAISE EXCEPTION 'Uoc luong dat hoac vuot nguong chinh sach — RFQ nay phai can hai phe duyet (D2)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_packages')
                           AND t.tgname = 'rfq_packages_kiem_nguong_phe_duyet_kep'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_kiem_nguong_phe_duyet_kep()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = ANY (ARRAY['PENDING_APPROVAL'::text, 'OPEN'::text])) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION rfq_kiem_nguong_phe_duyet_kep()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_kiem_nguong_phe_duyet_kep()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_kiem_nguong_phe_duyet_kep()')),
                  'hàm public.rfq_kiem_nguong_phe_duyet_kep() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_kiem_nguong_phe_duyet_kep() và bảng public.rfq_packages (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger rfq_kiem_yeu_cau_mo_thau (019)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '019_unseal.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rfq_kiem_yeu_cau_mo_thau()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.rfq_kiem_yeu_cau_mo_thau();
           END IF;
           CREATE OR REPLACE FUNCTION public.rfq_kiem_yeu_cau_mo_thau() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  so integer;
BEGIN
  SELECT count(*) INTO so
    FROM public.unseal_requests r
   WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND r.status IN ('APPROVED', 'EXECUTED');
  IF so OPERATOR(pg_catalog.=) 0 THEN
    RAISE EXCEPTION 'Khong mo thau duoc khi chua co yeu cau mo thau da duoc phe duyet (C3, D2)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_packages') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_packages')
                                 AND t.tgname = 'rfq_packages_kiem_yeu_cau_mo_thau'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.rfq_kiem_yeu_cau_mo_thau()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_yeu_cau_mo_thau BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'UNSEALED'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION rfq_kiem_yeu_cau_mo_thau()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_packages_kiem_yeu_cau_mo_thau ON public.rfq_packages;
             CREATE TRIGGER rfq_packages_kiem_yeu_cau_mo_thau BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'UNSEALED'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION public.rfq_kiem_yeu_cau_mo_thau();
             ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_yeu_cau_mo_thau;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE so integer; BEGIN SELECT count(*) INTO so FROM public.unseal_requests r WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.id AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id AND r.status IN ('APPROVED', 'EXECUTED'); IF so OPERATOR(pg_catalog.=) 0 THEN RAISE EXCEPTION 'Khong mo thau duoc khi chua co yeu cau mo thau da duoc phe duyet (C3, D2)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_packages')
                           AND t.tgname = 'rfq_packages_kiem_yeu_cau_mo_thau'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.rfq_kiem_yeu_cau_mo_thau()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_packages_kiem_yeu_cau_mo_thau BEFORE UPDATE ON public.rfq_packages FOR EACH ROW WHEN (((new.status = 'UNSEALED'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION rfq_kiem_yeu_cau_mo_thau()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_kiem_yeu_cau_mo_thau()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.rfq_kiem_yeu_cau_mo_thau()')),
                  'hàm public.rfq_kiem_yeu_cau_mo_thau() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.rfq_kiem_yeu_cau_mo_thau() và bảng public.rfq_packages (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger thu_hoi_don_dieu (012)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '012_invitation_hardening.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.thu_hoi_don_dieu()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.thu_hoi_don_dieu();
           END IF;
           CREATE OR REPLACE FUNCTION public.thu_hoi_don_dieu() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  IF TG_ARGV[0] = 'revoked_at' THEN
    IF to_jsonb(OLD) ->> 'revoked_at' IS NOT NULL
       AND to_jsonb(NEW) ->> 'revoked_at' IS NULL THEN
      RAISE EXCEPTION 'revoked_at da bat thi khong duoc tat lai (%.%)', TG_TABLE_NAME, 'revoked_at'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_ARGV[0] = 'consumed_at' OR TG_NARGS > 1 THEN
    IF to_jsonb(OLD) ->> 'consumed_at' IS NOT NULL
       AND to_jsonb(NEW) ->> 'consumed_at' IS NULL THEN
      RAISE EXCEPTION 'consumed_at da bat thi khong duoc tat lai (%)', TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.guest_sessions') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.guest_sessions')
                                 AND t.tgname = 'guest_sessions_thu_hoi_don_dieu'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER guest_sessions_thu_hoi_don_dieu BEFORE UPDATE ON public.guest_sessions FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('revoked_at')$def$) THEN
             DROP TRIGGER IF EXISTS guest_sessions_thu_hoi_don_dieu ON public.guest_sessions;
             CREATE TRIGGER guest_sessions_thu_hoi_don_dieu BEFORE UPDATE ON public.guest_sessions FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('revoked_at');
             ALTER TABLE public.guest_sessions ENABLE ALWAYS TRIGGER guest_sessions_thu_hoi_don_dieu;
           END IF;
           IF to_regclass('public.invitation_otp_challenges') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.invitation_otp_challenges')
                                 AND t.tgname = 'invitation_otp_thu_hoi_don_dieu'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER invitation_otp_thu_hoi_don_dieu BEFORE UPDATE ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('consumed_at')$def$) THEN
             DROP TRIGGER IF EXISTS invitation_otp_thu_hoi_don_dieu ON public.invitation_otp_challenges;
             CREATE TRIGGER invitation_otp_thu_hoi_don_dieu BEFORE UPDATE ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('consumed_at');
             ALTER TABLE public.invitation_otp_challenges ENABLE ALWAYS TRIGGER invitation_otp_thu_hoi_don_dieu;
           END IF;
           IF to_regclass('public.rfq_invitation_tokens') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_invitation_tokens')
                                 AND t.tgname = 'rfq_invitation_tokens_thu_hoi_don_dieu'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitation_tokens_thu_hoi_don_dieu BEFORE UPDATE ON public.rfq_invitation_tokens FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('revoked_at', 'consumed_at')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_invitation_tokens_thu_hoi_don_dieu ON public.rfq_invitation_tokens;
             CREATE TRIGGER rfq_invitation_tokens_thu_hoi_don_dieu BEFORE UPDATE ON public.rfq_invitation_tokens FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('revoked_at', 'consumed_at');
             ALTER TABLE public.rfq_invitation_tokens ENABLE ALWAYS TRIGGER rfq_invitation_tokens_thu_hoi_don_dieu;
           END IF;
           IF to_regclass('public.rfq_invitations') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_invitations')
                                 AND t.tgname = 'rfq_invitations_thu_hoi_don_dieu'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitations_thu_hoi_don_dieu BEFORE UPDATE ON public.rfq_invitations FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('revoked_at')$def$) THEN
             DROP TRIGGER IF EXISTS rfq_invitations_thu_hoi_don_dieu ON public.rfq_invitations;
             CREATE TRIGGER rfq_invitations_thu_hoi_don_dieu BEFORE UPDATE ON public.rfq_invitations FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('revoked_at');
             ALTER TABLE public.rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_thu_hoi_don_dieu;
           END IF;
           IF to_regclass('public.user_login_tokens') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.user_login_tokens')
                                 AND t.tgname = 'user_login_tokens_thu_hoi_don_dieu'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER user_login_tokens_thu_hoi_don_dieu BEFORE UPDATE ON public.user_login_tokens FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('consumed_at')$def$) THEN
             DROP TRIGGER IF EXISTS user_login_tokens_thu_hoi_don_dieu ON public.user_login_tokens;
             CREATE TRIGGER user_login_tokens_thu_hoi_don_dieu BEFORE UPDATE ON public.user_login_tokens FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('consumed_at');
             ALTER TABLE public.user_login_tokens ENABLE ALWAYS TRIGGER user_login_tokens_thu_hoi_don_dieu;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF TG_ARGV[0] = 'revoked_at' THEN IF to_jsonb(OLD) ->> 'revoked_at' IS NOT NULL AND to_jsonb(NEW) ->> 'revoked_at' IS NULL THEN RAISE EXCEPTION 'revoked_at da bat thi khong duoc tat lai (%.%)', TG_TABLE_NAME, 'revoked_at' USING ERRCODE = 'check_violation'; END IF; END IF; IF TG_ARGV[0] = 'consumed_at' OR TG_NARGS > 1 THEN IF to_jsonb(OLD) ->> 'consumed_at' IS NOT NULL AND to_jsonb(NEW) ->> 'consumed_at' IS NULL THEN RAISE EXCEPTION 'consumed_at da bat thi khong duoc tat lai (%)', TG_TABLE_NAME USING ERRCODE = 'check_violation'; END IF; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.guest_sessions')
                           AND t.tgname = 'guest_sessions_thu_hoi_don_dieu'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER guest_sessions_thu_hoi_don_dieu BEFORE UPDATE ON public.guest_sessions FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('revoked_at')$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.invitation_otp_challenges')
                           AND t.tgname = 'invitation_otp_thu_hoi_don_dieu'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER invitation_otp_thu_hoi_don_dieu BEFORE UPDATE ON public.invitation_otp_challenges FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('consumed_at')$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_invitation_tokens')
                           AND t.tgname = 'rfq_invitation_tokens_thu_hoi_don_dieu'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitation_tokens_thu_hoi_don_dieu BEFORE UPDATE ON public.rfq_invitation_tokens FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('revoked_at', 'consumed_at')$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_invitations')
                           AND t.tgname = 'rfq_invitations_thu_hoi_don_dieu'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_invitations_thu_hoi_don_dieu BEFORE UPDATE ON public.rfq_invitations FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('revoked_at')$def$)
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.user_login_tokens')
                           AND t.tgname = 'user_login_tokens_thu_hoi_don_dieu'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.thu_hoi_don_dieu()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER user_login_tokens_thu_hoi_don_dieu BEFORE UPDATE ON public.user_login_tokens FOR EACH ROW EXECUTE FUNCTION thu_hoi_don_dieu('consumed_at')$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.thu_hoi_don_dieu()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.thu_hoi_don_dieu()')),
                  'hàm public.thu_hoi_don_dieu() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.thu_hoi_don_dieu() và bảng public.guest_sessions, public.invitation_otp_challenges, public.rfq_invitation_tokens, public.rfq_invitations, public.user_login_tokens (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger unseal_canh_bao_break_glass (019)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '019_unseal.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.unseal_canh_bao_break_glass()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.unseal_canh_bao_break_glass();
           END IF;
           CREATE OR REPLACE FUNCTION public.unseal_canh_bao_break_glass() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  INSERT INTO public.outbox_jobs (org_id, kind, payload, dedupe_key)
  VALUES (
    NEW.org_id,
    'BREAK_GLASS_UNSEAL_ALERT',
    pg_catalog.jsonb_build_object(
      'unsealRequestId', NEW.id,
      'rfqId', NEW.rfq_id,
      'requestedBy', NEW.requested_by,
      'severity', 'HIGH'),
    'break-glass:' OPERATOR(pg_catalog.||) NEW.id::pg_catalog.text);

  PERFORM pg_catalog.pg_notify(
    'trustprocure_break_glass',
    pg_catalog.jsonb_build_object('orgId', NEW.org_id, 'unsealRequestId', NEW.id)::pg_catalog.text);

  RETURN NULL;
END
$ham$;
           IF to_regclass('public.unseal_requests') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_requests')
                                 AND t.tgname = 'unseal_requests_canh_bao_break_glass'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.unseal_canh_bao_break_glass()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_canh_bao_break_glass AFTER INSERT ON public.unseal_requests FOR EACH ROW WHEN (new.break_glass) EXECUTE FUNCTION unseal_canh_bao_break_glass()$def$) THEN
             DROP TRIGGER IF EXISTS unseal_requests_canh_bao_break_glass ON public.unseal_requests;
             CREATE TRIGGER unseal_requests_canh_bao_break_glass AFTER INSERT ON public.unseal_requests FOR EACH ROW WHEN (new.break_glass) EXECUTE FUNCTION public.unseal_canh_bao_break_glass();
             ALTER TABLE public.unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_canh_bao_break_glass;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN INSERT INTO public.outbox_jobs (org_id, kind, payload, dedupe_key) VALUES ( NEW.org_id, 'BREAK_GLASS_UNSEAL_ALERT', pg_catalog.jsonb_build_object( 'unsealRequestId', NEW.id, 'rfqId', NEW.rfq_id, 'requestedBy', NEW.requested_by, 'severity', 'HIGH'), 'break-glass:' OPERATOR(pg_catalog.||) NEW.id::pg_catalog.text); PERFORM pg_catalog.pg_notify( 'trustprocure_break_glass', pg_catalog.jsonb_build_object('orgId', NEW.org_id, 'unsealRequestId', NEW.id)::pg_catalog.text); RETURN NULL; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.unseal_requests')
                           AND t.tgname = 'unseal_requests_canh_bao_break_glass'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.unseal_canh_bao_break_glass()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_canh_bao_break_glass AFTER INSERT ON public.unseal_requests FOR EACH ROW WHEN (new.break_glass) EXECUTE FUNCTION unseal_canh_bao_break_glass()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.unseal_canh_bao_break_glass()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.unseal_canh_bao_break_glass()')),
                  'hàm public.unseal_canh_bao_break_glass() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.unseal_canh_bao_break_glass() và bảng public.unseal_requests (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger unseal_dieu_phoi_mot_lan (022)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '022_security_review_s1.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.unseal_dieu_phoi_mot_lan()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.unseal_dieu_phoi_mot_lan();
           END IF;
           CREATE OR REPLACE FUNCTION public.unseal_dieu_phoi_mot_lan() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  IF OLD.dispatched_at IS NOT NULL
     AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN
    RAISE EXCEPTION 'dispatched_at chi dat duoc mot lan' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.unseal_requests') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_requests')
                                 AND t.tgname = 'unseal_requests_dieu_phoi_mot_lan'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.unseal_dieu_phoi_mot_lan()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_dieu_phoi_mot_lan BEFORE UPDATE ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION unseal_dieu_phoi_mot_lan()$def$) THEN
             DROP TRIGGER IF EXISTS unseal_requests_dieu_phoi_mot_lan ON public.unseal_requests;
             CREATE TRIGGER unseal_requests_dieu_phoi_mot_lan BEFORE UPDATE ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION public.unseal_dieu_phoi_mot_lan();
             ALTER TABLE public.unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_dieu_phoi_mot_lan;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN RAISE EXCEPTION 'dispatched_at chi dat duoc mot lan' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.unseal_requests')
                           AND t.tgname = 'unseal_requests_dieu_phoi_mot_lan'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.unseal_dieu_phoi_mot_lan()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_dieu_phoi_mot_lan BEFORE UPDATE ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION unseal_dieu_phoi_mot_lan()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.unseal_dieu_phoi_mot_lan()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.unseal_dieu_phoi_mot_lan()')),
                  'hàm public.unseal_dieu_phoi_mot_lan() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.unseal_dieu_phoi_mot_lan() và bảng public.unseal_requests (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger unseal_kiem_chuyen_trang_thai (019)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '019_unseal.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.unseal_kiem_chuyen_trang_thai()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.unseal_kiem_chuyen_trang_thai();
           END IF;
           CREATE OR REPLACE FUNCTION public.unseal_kiem_chuyen_trang_thai() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  CANH_HOP_LE constant text[] := ARRAY[
    'PENDING->APPROVED',
    'PENDING->CANCELLED',
    'APPROVED->EXECUTED',
    'APPROVED->CANCELLED'
  ];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status OPERATOR(pg_catalog.||) '->' OPERATOR(pg_catalog.||) NEW.status)
            OPERATOR(pg_catalog.=) ANY (CANH_HOP_LE)) THEN
      RAISE EXCEPTION 'Chuyen trang thai yeu cau mo thau khong hop le: % -> %',
        OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Không cột nào của phần YÊU CẦU được sửa sau khi đã tạo. Một lý do sửa được sau khi phê duyệt
  -- là một lý do người duyệt chưa từng đọc.
  IF NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.break_glass IS DISTINCT FROM OLD.break_glass
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_by_session_id IS DISTINCT FROM OLD.requested_by_session_id THEN
    RAISE EXCEPTION 'Chi sua duoc trang thai va cac moc thoi gian cua yeu cau mo thau'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.unseal_requests') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_requests')
                                 AND t.tgname = 'unseal_requests_kiem_chuyen_trang_thai'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.unseal_kiem_chuyen_trang_thai()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_chuyen_trang_thai BEFORE UPDATE ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION unseal_kiem_chuyen_trang_thai()$def$) THEN
             DROP TRIGGER IF EXISTS unseal_requests_kiem_chuyen_trang_thai ON public.unseal_requests;
             CREATE TRIGGER unseal_requests_kiem_chuyen_trang_thai BEFORE UPDATE ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_chuyen_trang_thai();
             ALTER TABLE public.unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_chuyen_trang_thai;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE CANH_HOP_LE constant text[] := ARRAY[ 'PENDING->APPROVED', 'PENDING->CANCELLED', 'APPROVED->EXECUTED', 'APPROVED->CANCELLED' ]; BEGIN IF NEW.status IS DISTINCT FROM OLD.status THEN IF NOT ((OLD.status OPERATOR(pg_catalog.||) '->' OPERATOR(pg_catalog.||) NEW.status) OPERATOR(pg_catalog.=) ANY (CANH_HOP_LE)) THEN RAISE EXCEPTION 'Chuyen trang thai yeu cau mo thau khong hop le: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation'; END IF; END IF; -- Không cột nào của phần YÊU CẦU được sửa sau khi đã tạo. Một lý do sửa được sau khi phê duyệt -- là một lý do người duyệt chưa từng đọc. IF NEW.rfq_id IS DISTINCT FROM OLD.rfq_id OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.break_glass IS DISTINCT FROM OLD.break_glass OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_by_session_id IS DISTINCT FROM OLD.requested_by_session_id THEN RAISE EXCEPTION 'Chi sua duoc trang thai va cac moc thoi gian cua yeu cau mo thau' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.unseal_requests')
                           AND t.tgname = 'unseal_requests_kiem_chuyen_trang_thai'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.unseal_kiem_chuyen_trang_thai()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_chuyen_trang_thai BEFORE UPDATE ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION unseal_kiem_chuyen_trang_thai()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.unseal_kiem_chuyen_trang_thai()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.unseal_kiem_chuyen_trang_thai()')),
                  'hàm public.unseal_kiem_chuyen_trang_thai() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.unseal_kiem_chuyen_trang_thai() và bảng public.unseal_requests (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger unseal_kiem_du_phe_duyet (022)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '022_security_review_s1.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.unseal_kiem_du_phe_duyet()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.unseal_kiem_du_phe_duyet();
           END IF;
           CREATE OR REPLACE FUNCTION public.unseal_kiem_du_phe_duyet() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  can integer;
  co integer;
BEGIN
  -- [D4 + review S1.6 HIGH-2a] Break-glass KHÔNG gom phê duyệt — nhưng nó phải có NHÂN CHỨNG,
  -- và nhân chứng ấy phải là NGƯỜI KHÁC trong một PHIÊN KHÁC. Cùng đúng hai vế mà
  -- `unseal_kiem_nguoi_duyet` đòi ở đường thường.
  IF NEW.break_glass THEN
    IF NEW.break_glass_witness_user_id IS NULL
       OR NEW.break_glass_witness_session_id IS NULL THEN
      RAISE EXCEPTION 'Break-glass phai co nguoi lam chung (D3)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.break_glass_witness_user_id OPERATOR(pg_catalog.=) NEW.requested_by THEN
      RAISE EXCEPTION 'Nguoi yeu cau break-glass khong duoc tu lam chung (D3)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.break_glass_witness_session_id
       OPERATOR(pg_catalog.=) NEW.requested_by_session_id THEN
      RAISE EXCEPTION 'Nhan chung break-glass phai o mot PHIEN khac (D2)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  can := public.unseal_so_phe_duyet_can(NEW.rfq_id);
  SELECT count(*) INTO co
    FROM public.unseal_approvals a
   WHERE a.unseal_request_id OPERATOR(pg_catalog.=) NEW.id
     AND a.org_id OPERATOR(pg_catalog.=) NEW.org_id;

  IF co OPERATOR(pg_catalog.<) can THEN
    RAISE EXCEPTION 'Yeu cau mo thau nay can % phe duyet, moi co % (D2)', can, co
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.unseal_requests') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_requests')
                                 AND t.tgname = 'unseal_requests_kiem_du_phe_duyet'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.unseal_kiem_du_phe_duyet()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_du_phe_duyet BEFORE UPDATE ON public.unseal_requests FOR EACH ROW WHEN (((new.status = 'APPROVED'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION unseal_kiem_du_phe_duyet()$def$) THEN
             DROP TRIGGER IF EXISTS unseal_requests_kiem_du_phe_duyet ON public.unseal_requests;
             CREATE TRIGGER unseal_requests_kiem_du_phe_duyet BEFORE UPDATE ON public.unseal_requests FOR EACH ROW WHEN (((new.status = 'APPROVED'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION public.unseal_kiem_du_phe_duyet();
             ALTER TABLE public.unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_du_phe_duyet;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE can integer; co integer; BEGIN -- [D4 + review S1.6 HIGH-2a] Break-glass KHÔNG gom phê duyệt — nhưng nó phải có NHÂN CHỨNG, -- và nhân chứng ấy phải là NGƯỜI KHÁC trong một PHIÊN KHÁC. Cùng đúng hai vế mà -- `unseal_kiem_nguoi_duyet` đòi ở đường thường. IF NEW.break_glass THEN IF NEW.break_glass_witness_user_id IS NULL OR NEW.break_glass_witness_session_id IS NULL THEN RAISE EXCEPTION 'Break-glass phai co nguoi lam chung (D3)' USING ERRCODE = 'check_violation'; END IF; IF NEW.break_glass_witness_user_id OPERATOR(pg_catalog.=) NEW.requested_by THEN RAISE EXCEPTION 'Nguoi yeu cau break-glass khong duoc tu lam chung (D3)' USING ERRCODE = 'check_violation'; END IF; IF NEW.break_glass_witness_session_id OPERATOR(pg_catalog.=) NEW.requested_by_session_id THEN RAISE EXCEPTION 'Nhan chung break-glass phai o mot PHIEN khac (D2)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END IF; can := public.unseal_so_phe_duyet_can(NEW.rfq_id); SELECT count(*) INTO co FROM public.unseal_approvals a WHERE a.unseal_request_id OPERATOR(pg_catalog.=) NEW.id AND a.org_id OPERATOR(pg_catalog.=) NEW.org_id; IF co OPERATOR(pg_catalog.<) can THEN RAISE EXCEPTION 'Yeu cau mo thau nay can % phe duyet, moi co % (D2)', can, co USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.unseal_requests')
                           AND t.tgname = 'unseal_requests_kiem_du_phe_duyet'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.unseal_kiem_du_phe_duyet()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_du_phe_duyet BEFORE UPDATE ON public.unseal_requests FOR EACH ROW WHEN (((new.status = 'APPROVED'::text) AND (new.status IS DISTINCT FROM old.status))) EXECUTE FUNCTION unseal_kiem_du_phe_duyet()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.unseal_kiem_du_phe_duyet()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.unseal_kiem_du_phe_duyet()')),
                  'hàm public.unseal_kiem_du_phe_duyet() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.unseal_kiem_du_phe_duyet() và bảng public.unseal_requests (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger unseal_kiem_nguoi_duyet (019)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '019_unseal.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.unseal_kiem_nguoi_duyet()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.unseal_kiem_nguoi_duyet();
           END IF;
           CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  nguoi_yeu_cau uuid;
  phien_yeu_cau uuid;
  trang_thai text;
BEGIN
  SELECT r.requested_by, r.requested_by_session_id, r.status
    INTO nguoi_yeu_cau, phien_yeu_cau, trang_thai
    FROM public.unseal_requests r
   WHERE r.id OPERATOR(pg_catalog.=) NEW.unseal_request_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay yeu cau mo thau %', NEW.unseal_request_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF trang_thai IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Chi phe duyet duoc yeu cau dang PENDING; dang o %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.approver_user_id OPERATOR(pg_catalog.=) nguoi_yeu_cau THEN
    RAISE EXCEPTION 'Nguoi yeu cau mo thau khong duoc tu phe duyet (D2, D3)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Vế PHIÊN, và nó KHÔNG thừa với vế người ở trên: một người có thể có hai tài khoản, nhưng
  -- một PHIÊN thì thuộc về đúng một tài khoản. Chặn cả hai vế đóng cả hai cách đọc của D2.
  IF NEW.approver_session_id OPERATOR(pg_catalog.=) phien_yeu_cau THEN
    RAISE EXCEPTION 'Phe duyet phai den tu mot PHIEN KHAC voi phien da yeu cau (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;
           IF to_regclass('public.unseal_approvals') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_approvals')
                                 AND t.tgname = 'unseal_approvals_kiem_nguoi_duyet'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.unseal_kiem_nguoi_duyet()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_approvals_kiem_nguoi_duyet BEFORE INSERT ON public.unseal_approvals FOR EACH ROW EXECUTE FUNCTION unseal_kiem_nguoi_duyet()$def$) THEN
             DROP TRIGGER IF EXISTS unseal_approvals_kiem_nguoi_duyet ON public.unseal_approvals;
             CREATE TRIGGER unseal_approvals_kiem_nguoi_duyet BEFORE INSERT ON public.unseal_approvals FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_nguoi_duyet();
             ALTER TABLE public.unseal_approvals ENABLE ALWAYS TRIGGER unseal_approvals_kiem_nguoi_duyet;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE nguoi_yeu_cau uuid; phien_yeu_cau uuid; trang_thai text; BEGIN SELECT r.requested_by, r.requested_by_session_id, r.status INTO nguoi_yeu_cau, phien_yeu_cau, trang_thai FROM public.unseal_requests r WHERE r.id OPERATOR(pg_catalog.=) NEW.unseal_request_id AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id FOR NO KEY UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay yeu cau mo thau %', NEW.unseal_request_id USING ERRCODE = 'foreign_key_violation'; END IF; IF trang_thai IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'Chi phe duyet duoc yeu cau dang PENDING; dang o %', trang_thai USING ERRCODE = 'check_violation'; END IF; IF NEW.approver_user_id OPERATOR(pg_catalog.=) nguoi_yeu_cau THEN RAISE EXCEPTION 'Nguoi yeu cau mo thau khong duoc tu phe duyet (D2, D3)' USING ERRCODE = 'check_violation'; END IF; -- Vế PHIÊN, và nó KHÔNG thừa với vế người ở trên: một người có thể có hai tài khoản, nhưng -- một PHIÊN thì thuộc về đúng một tài khoản. Chặn cả hai vế đóng cả hai cách đọc của D2. IF NEW.approver_session_id OPERATOR(pg_catalog.=) phien_yeu_cau THEN RAISE EXCEPTION 'Phe duyet phai den tu mot PHIEN KHAC voi phien da yeu cau (D2)' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.unseal_approvals')
                           AND t.tgname = 'unseal_approvals_kiem_nguoi_duyet'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.unseal_kiem_nguoi_duyet()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_approvals_kiem_nguoi_duyet BEFORE INSERT ON public.unseal_approvals FOR EACH ROW EXECUTE FUNCTION unseal_kiem_nguoi_duyet()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.unseal_kiem_nguoi_duyet()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.unseal_kiem_nguoi_duyet()')),
                  'hàm public.unseal_kiem_nguoi_duyet() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.unseal_kiem_nguoi_duyet() và bảng public.unseal_approvals (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger unseal_kiem_rfq_da_dong (019)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '019_unseal.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.unseal_kiem_rfq_da_dong()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.unseal_kiem_rfq_da_dong();
           END IF;
           CREATE OR REPLACE FUNCTION public.unseal_kiem_rfq_da_dong() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF trang_thai IS DISTINCT FROM 'CLOSED' THEN
    RAISE EXCEPTION 'Chi yeu cau mo thau duoc khi RFQ da CLOSED; dang o % (C3)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.unseal_requests') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.unseal_requests')
                                 AND t.tgname = 'unseal_requests_kiem_rfq_da_dong'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.unseal_kiem_rfq_da_dong()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_rfq_da_dong BEFORE INSERT ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION unseal_kiem_rfq_da_dong()$def$) THEN
             DROP TRIGGER IF EXISTS unseal_requests_kiem_rfq_da_dong ON public.unseal_requests;
             CREATE TRIGGER unseal_requests_kiem_rfq_da_dong BEFORE INSERT ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_rfq_da_dong();
             ALTER TABLE public.unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_rfq_da_dong;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE trang_thai text; BEGIN SELECT p.status INTO trang_thai FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id USING ERRCODE = 'foreign_key_violation'; END IF; IF trang_thai IS DISTINCT FROM 'CLOSED' THEN RAISE EXCEPTION 'Chi yeu cau mo thau duoc khi RFQ da CLOSED; dang o % (C3)', trang_thai USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.unseal_requests')
                           AND t.tgname = 'unseal_requests_kiem_rfq_da_dong'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.unseal_kiem_rfq_da_dong()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER unseal_requests_kiem_rfq_da_dong BEFORE INSERT ON public.unseal_requests FOR EACH ROW EXECUTE FUNCTION unseal_kiem_rfq_da_dong()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.unseal_kiem_rfq_da_dong()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.unseal_kiem_rfq_da_dong()')),
                  'hàm public.unseal_kiem_rfq_da_dong() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.unseal_kiem_rfq_da_dong() và bảng public.unseal_requests (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger unseal_kiem_yeu_cau_khi_ghi_ban_ro (019)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '019_unseal.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.unseal_kiem_yeu_cau_khi_ghi_ban_ro()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.unseal_kiem_yeu_cau_khi_ghi_ban_ro();
           END IF;
           CREATE OR REPLACE FUNCTION public.unseal_kiem_yeu_cau_khi_ghi_ban_ro() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT r.status INTO trang_thai
    FROM public.unseal_requests r
   WHERE r.id OPERATOR(pg_catalog.=) NEW.unseal_request_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay yeu cau mo thau %', NEW.unseal_request_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF trang_thai NOT IN ('APPROVED', 'EXECUTED') THEN
    RAISE EXCEPTION 'Chi ghi duoc ban ro duoi mot yeu cau da phe duyet; yeu cau dang o % (A1)',
      trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
           IF to_regclass('public.rfq_unsealed_bids') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.rfq_unsealed_bids')
                                 AND t.tgname = 'rfq_unsealed_bids_kiem_yeu_cau'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.unseal_kiem_yeu_cau_khi_ghi_ban_ro()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_unsealed_bids_kiem_yeu_cau BEFORE INSERT ON public.rfq_unsealed_bids FOR EACH ROW EXECUTE FUNCTION unseal_kiem_yeu_cau_khi_ghi_ban_ro()$def$) THEN
             DROP TRIGGER IF EXISTS rfq_unsealed_bids_kiem_yeu_cau ON public.rfq_unsealed_bids;
             CREATE TRIGGER rfq_unsealed_bids_kiem_yeu_cau BEFORE INSERT ON public.rfq_unsealed_bids FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_yeu_cau_khi_ghi_ban_ro();
             ALTER TABLE public.rfq_unsealed_bids ENABLE ALWAYS TRIGGER rfq_unsealed_bids_kiem_yeu_cau;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$DECLARE trang_thai text; BEGIN SELECT r.status INTO trang_thai FROM public.unseal_requests r WHERE r.id OPERATOR(pg_catalog.=) NEW.unseal_request_id AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id; IF NOT FOUND THEN RAISE EXCEPTION 'Khong tim thay yeu cau mo thau %', NEW.unseal_request_id USING ERRCODE = 'foreign_key_violation'; END IF; IF trang_thai NOT IN ('APPROVED', 'EXECUTED') THEN RAISE EXCEPTION 'Chi ghi duoc ban ro duoi mot yeu cau da phe duyet; yeu cau dang o % (A1)', trang_thai USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.rfq_unsealed_bids')
                           AND t.tgname = 'rfq_unsealed_bids_kiem_yeu_cau'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.unseal_kiem_yeu_cau_khi_ghi_ban_ro()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER rfq_unsealed_bids_kiem_yeu_cau BEFORE INSERT ON public.rfq_unsealed_bids FOR EACH ROW EXECUTE FUNCTION unseal_kiem_yeu_cau_khi_ghi_ban_ro()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.unseal_kiem_yeu_cau_khi_ghi_ban_ro()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.unseal_kiem_yeu_cau_khi_ghi_ban_ro()')),
                  'hàm public.unseal_kiem_yeu_cau_khi_ghi_ban_ro() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.unseal_kiem_yeu_cau_khi_ghi_ban_ro() và bảng public.rfq_unsealed_bids (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    ARRAY[
      $q$hàm + trigger users_thu_hoi_phien_khi_dinh_chi (034)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '034_dinh_chi_thu_hoi_phien.sql')$q$,
      $q$DO $fn56$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.users_thu_hoi_phien_khi_dinh_chi()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.users_thu_hoi_phien_khi_dinh_chi();
           END IF;
           CREATE OR REPLACE FUNCTION public.users_thu_hoi_phien_khi_dinh_chi() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $ham$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status OPERATOR(pg_catalog.<>) 'ACTIVE' THEN
    UPDATE public.sessions s
       SET revoked_at = pg_catalog.now()
     WHERE s.org_id OPERATOR(pg_catalog.=) NEW.org_id
       AND s.user_id OPERATOR(pg_catalog.=) NEW.id
       AND s.revoked_at IS NULL;
  END IF;
  RETURN NULL;
END
$ham$;
           IF to_regclass('public.users') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                               WHERE t.tgrelid = to_regclass('public.users')
                                 AND t.tgname = 'users_thu_hoi_phien_khi_dinh_chi'
                                 AND NOT t.tgisinternal
                                 AND t.tgfoid = to_regprocedure('public.users_thu_hoi_phien_khi_dinh_chi()')
                                 AND t.tgenabled = 'A'
                                 AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER users_thu_hoi_phien_khi_dinh_chi AFTER UPDATE OF status ON public.users FOR EACH ROW EXECUTE FUNCTION users_thu_hoi_phien_khi_dinh_chi()$def$) THEN
             DROP TRIGGER IF EXISTS users_thu_hoi_phien_khi_dinh_chi ON public.users;
             CREATE TRIGGER users_thu_hoi_phien_khi_dinh_chi AFTER UPDATE OF status ON public.users FOR EACH ROW EXECUTE FUNCTION public.users_thu_hoi_phien_khi_dinh_chi();
             ALTER TABLE public.users ENABLE ALWAYS TRIGGER users_thu_hoi_phien_khi_dinh_chi;
           END IF;
         END
         $fn56$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = $than$BEGIN IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status OPERATOR(pg_catalog.<>) 'ACTIVE' THEN UPDATE public.sessions s SET revoked_at = pg_catalog.now() WHERE s.org_id OPERATOR(pg_catalog.=) NEW.org_id AND s.user_id OPERATOR(pg_catalog.=) NEW.id AND s.revoked_at IS NULL; END IF; RETURN NULL; END$than$
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.users')
                           AND t.tgname = 'users_thu_hoi_phien_khi_dinh_chi'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = to_regprocedure('public.users_thu_hoi_phien_khi_dinh_chi()')
                           AND t.tgenabled = 'A'
                           AND pg_get_triggerdef(t.oid) = $def$CREATE TRIGGER users_thu_hoi_phien_khi_dinh_chi AFTER UPDATE OF status ON public.users FOR EACH ROW EXECUTE FUNCTION users_thu_hoi_phien_khi_dinh_chi()$def$)
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.users_thu_hoi_phien_khi_dinh_chi()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text
                                                                           || ':def=' || pg_get_triggerdef(t.oid), '; ' ORDER BY t.tgname)
                                                          FROM pg_trigger t
                                                         WHERE t.tgfoid = p.oid AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.users_thu_hoi_phien_khi_dinh_chi()')),
                  'hàm public.users_thu_hoi_phien_khi_dinh_chi() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.users_thu_hoi_phien_khi_dinh_chi() và bảng public.users (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- ---- [S1.14 / review H6-7] RLS của `caller_rate_limits` (042) — bảng NGOÀI cây tenant --------
    -- `VI_TU_BANG_TENANT` lọc theo cột `org_id`, nên bảng bucket người gọi không thuộc mục (A) lẫn
    -- mục policy: một `DISABLE ROW LEVEL SECURITY` hay một `ALTER POLICY … USING (true)` trên nó
    -- sống qua mọi lần `migrate()`, trong khi với MỌI bảng khác hai câu ấy bị dựng lại. 042 viết
    -- "Nó vẫn bật RLS + FORCE" như một tính chất của lược đồ; mục này là thứ làm câu ấy đúng.
    -- KHÔNG mở rộng `VI_TU_BANG_TENANT` để với tới đây — bán kính của việc ấy đã giải thích ở trên.
    ARRAY[
      $q$RLS + policy khách của caller_rate_limits (042)$q$,
      $q$to_regclass('public.caller_rate_limits') IS NOT NULL$q$,
      -- Ba câu dưới đây đi qua `EXECUTE format(...)` chứ không viết thẳng, và đó KHÔNG phải để né một
      -- lớp canh: `db/migration-shape.test.ts` cấm một file bật RLS hay tạo policy cho bảng do file
      -- KHÁC tạo, vì tách hai việc qua hai file để lộ một cửa sổ không có RLS. Hardening không mở cửa
      -- sổ ấy (nó chạy MỌI lần, sau khi 042 đã chạy) và mọi mục tự chữa RLS khác trong file này dùng
      -- đúng idiom động ấy (xem mục (A)). Viết thẳng ở đây sẽ làm lớp tĩnh mất khả năng phân biệt
      -- "một migration đánh số quên policy" với "hardening dựng lại policy".
      $q$DO $fn57$
         DECLARE
           ten_bang constant text := 'public.caller_rate_limits';
           -- Trong một literal nháy đơn, mỗi `'` nhân đôi. Chuỗi ĐÍCH là
           --   NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
           -- nên `''app…''` cho hai nháy đơn, và BỐN nháy cho literal chuỗi RỖNG.
           vi_tu constant text := 'NULLIF(pg_catalog.current_setting(''app.guest_session_id'', true), '''')::pg_catalog.uuid IS NULL';
         BEGIN
           EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', ten_bang);
           EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', ten_bang);
           IF NOT EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = to_regclass(ten_bang)
                             AND p.polname = 'caller_rate_limits_khach') THEN
             EXECUTE format('CREATE POLICY caller_rate_limits_khach ON %s USING (%s) WITH CHECK (%s)',
                            ten_bang, vi_tu, vi_tu);
           END IF;
         END
         $fn57$$q$,
      $q$(SELECT c.relrowsecurity AND c.relforcerowsecurity
            AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 1
            AND EXISTS (SELECT 1 FROM pg_policy p
                         WHERE p.polrelid = c.oid
                           AND p.polname = 'caller_rate_limits_khach'
                           AND p.polpermissive
                           AND pg_get_expr(p.polqual, c.oid) = pg_get_expr(p.polwithcheck, c.oid)
                           AND pg_get_expr(p.polqual, c.oid) LIKE '%app.guest_session_id%')
           FROM pg_class c WHERE c.oid = to_regclass('public.caller_rate_limits'))$q$,
      $q$coalesce((SELECT 'RLS/policy của caller_rate_limits lệch — rls=' || c.relrowsecurity::text
                          || ' force=' || c.relforcerowsecurity::text
                          || ' policy=' || coalesce((SELECT string_agg(p.polname || ':' || pg_get_expr(p.polqual, c.oid), '; ' ORDER BY p.polname)
                                                       FROM pg_policy p WHERE p.polrelid = c.oid), '(KHÔNG CÓ)')
                     FROM pg_class c WHERE c.oid = to_regclass('public.caller_rate_limits')),
                  'bảng public.caller_rate_limits không tồn tại')$q$,
      $q$quyền sở hữu bảng public.caller_rate_limits hoặc SUPERUSER$q$
    ],

    -- ---- [S1.15 / sổ nợ 57] Policy dọn của `otp_rate_limits` (044) ----------------------
    -- `CAU_POLICY_SAI` nguồn (i) chỉ kêu khi bảng KHÔNG CÒN policy PERMISSIVE nào. `otp_rate_limits`
    -- có hai, nên một `DROP POLICY otp_rate_limits_don_cua_so_cu` đi qua MỌI lớp trong im lặng:
    -- cách ly tenant vẫn nguyên, bảng vẫn đọc/ghi được, và thứ DUY NHẤT đổi là bộ dọn xoá 0 hàng
    -- ở mỗi lượt — tức bảng lại chỉ lớn lên, đúng khoản nợ 57 quay lại mà không ai kêu. Mục này
    -- là lớp ấy: hardening dựng lại policy, và phán xét đòi ĐÚNG lệnh, ĐÚNG role, ĐÚNG biểu thức.
    -- Cùng khuôn mục `caller_rate_limits` ở trên, và cùng lý do dùng `EXECUTE format(...)`:
    -- `db/migration-shape.test.ts` cấm một file tạo policy cho bảng do file KHÁC tạo, và mọi mục
    -- tự chữa RLS trong file này đi qua idiom động ấy.
    ARRAY[
      $q$policy dọn cửa sổ cũ của otp_rate_limits (044)$q$,
      $q$to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '044_don_bucket_otp.sql')$q$,
      $q$DO $fn57b$
         DECLARE
           ten_bang constant text := 'public.otp_rate_limits';
           vi_tu constant text := 'NULLIF(pg_catalog.current_setting(''app.org_id'', true), '''') IS NULL AND window_start OPERATOR(pg_catalog.<) (pg_catalog.now() OPERATOR(pg_catalog.-) pg_catalog.make_interval(secs => 1800))';
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = to_regclass(ten_bang)
                             AND p.polname = 'otp_rate_limits_don_cua_so_cu') THEN
             EXECUTE format('CREATE POLICY otp_rate_limits_don_cua_so_cu ON %s FOR DELETE TO app_api USING (%s)',
                            ten_bang, vi_tu);
           END IF;
         END
         $fn57b$$q$,
      $q$(SELECT count(*) = 1 FROM pg_policy p
           WHERE p.polrelid = to_regclass('public.otp_rate_limits')
             AND p.polname = 'otp_rate_limits_don_cua_so_cu'
             AND p.polpermissive
             AND p.polcmd = 'd'
             AND p.polwithcheck IS NULL
             AND (SELECT array_agg(r.rolname::text ORDER BY r.rolname COLLATE "C")
                    FROM pg_roles r WHERE r.oid = ANY(p.polroles)) = ARRAY['app_api']
             AND pg_get_expr(p.polqual, p.polrelid) = $than57$((NULLIF(current_setting('app.org_id'::text, true), ''::text) IS NULL) AND (window_start < (now() - make_interval(secs => (1800)::double precision))))$than57$)$q$,
      $q$coalesce((SELECT 'policy dọn của otp_rate_limits lệch — lệnh=' || p.polcmd
                          || ' vai=' || coalesce((SELECT string_agg(r.rolname::text, ',' ORDER BY r.rolname COLLATE "C")
                                                    FROM pg_roles r WHERE r.oid = ANY(p.polroles)), '(không có)')
                          || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '(không có)')
                     FROM pg_policy p
                    WHERE p.polrelid = to_regclass('public.otp_rate_limits')
                      AND p.polname = 'otp_rate_limits_don_cua_so_cu'),
                  'policy otp_rate_limits_don_cua_so_cu KHÔNG tồn tại — bộ dọn xoá 0 hàng, bảng chỉ lớn lên')$q$,
      $q$quyền sở hữu bảng public.otp_rate_limits hoặc SUPERUSER$q$
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
            AND p.pronargs = 14
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

    -- ---- [vòng fix 1 — CR3] (D1c) Định nghĩa public.audit_append(...) -------------------
    -- Xem lập luận đo được ở khối chú thích của hằng THAN_GHI: đây là ĐIỂM VÀO của đường ghi
    -- duy nhất của sổ, và nó là mục cuối cùng trong nhóm (D1) còn bỏ trống.
    -- [QT1 — ai sửa được] Giống (D1a)/(D1b): proowner là role deploy, tự chữa ở lần deploy kế;
    -- ngoại lệ duy nhất là hàm bị đổi chủ (42501, phải dùng superuser để ALTER OWNER).
    -- [QT1 — ném được lỗi gì ngoài 42501] (a) 42P13 "cannot change return type" / "cannot change
    --   name of input parameter" nếu ai đó thay bằng hàm CÙNG chữ ký VÀO nhưng khác hình dạng
    --   TRẢ VỀ hoặc khác tên tham số — đóng bằng DROP có điều kiện đứng trước, và điều kiện ở
    --   đây phải rộng hơn (D1a)/(D1b) vì hàm này RETURNS TABLE: prorettype luôn là `record`, nên
    --   chỉ so prorettype là mù với "đổi tên/kiểu cột trả về". Điều kiện dưới đây so CẢ
    --   proargnames (tên 10 tham số vào + 5 cột ra) — đã đo là đủ để nhận diện cả hai biến thể.
    -- (b) 2BP01 khi DROP: KHÔNG xảy ra — không trigger, view hay ràng buộc nào phụ thuộc
    --   audit_append (đã đo pg_depend: 0 dòng ngoài chính schema/ngôn ngữ/kiểu).
    -- (c) MẤT QUYỀN sau DROP: KHÔNG xảy ra. Đã đo acldefault('f', chu_so_huu) trên PostgreSQL
    --   16.15 — mặc định của hàm là `{owner=X/owner,=X/owner}`, tức PUBLIC CÓ EXECUTE. Nên hàm
    --   được tạo lại vẫn gọi được bởi app_api dù câu GRANT EXECUTE nằm ở 004 (đã trong
    --   schema_migrations, không chạy lại). Nếu một task sau REVOKE EXECUTE ... FROM PUBLIC thì
    --   nhánh DROP này thành một đường mất quyền im lặng và phải được xét lại — ghi ra ở đây.
    ARRAY[
      $q$định nghĩa hàm public.audit_append(...)$q$,
      -- TIỀN ĐIỀU KIỆN BẮT BUỘC, và nó là một LỆCH SO VỚI (D1a)/(D1b) có lý do đo được: hàm này
      -- là LANGUAGE sql, nên PostgreSQL PHÂN GIẢI TÊN BẢNG NGAY LÚC TẠO. Trên một lược đồ chỉ có
      -- 001/002 (đường "thư mục migration rút gọn" mà [CR2c] đo), câu CREATE ném 42P01
      -- "relation public.audit_events does not exist" -> BƯỚC 2 nuốt -> hậu điều kiện thất bại
      -- -> migrate() GÃY trên một lược đồ HOÀN TOÀN HỢP LỆ. Đúng bẫy QT1. (D1b)/(D1d) không
      -- gặp vì plpgsql chỉ kiểm CÚ PHÁP lúc tạo, không phân giải tên — đã đo cả hai chiều.
      $q$pg_catalog.to_regclass('public.audit_events') IS NOT NULL$q$,
      $q$DO $fn$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure($ck$$q$ || CHU_KY_GHI || $q$$ck$)
                         AND (p.prorettype <> 'pg_catalog.record'::regtype
                              OR p.proargnames IS DISTINCT FROM $q$ || TEN_COT_GHI || $q$)) THEN
             DROP FUNCTION $q$ || CHU_KY_GHI || $q$;
           END IF;
           CREATE OR REPLACE FUNCTION public.audit_append$q$ || THAM_SO_GHI || $q$
           RETURNS $q$ || TRA_VE_GHI || $q$
           LANGUAGE sql SET search_path = pg_catalog
           AS $ham$$q$ || THAN_GHI || $q$$ham$;
         END
         $fn$$q$,
      -- prosecdef được canh vì SECURITY DEFINER ở đây là leo thang thật: hàm chạy dưới quyền
      -- CHỦ SỞ HỮU, và trong môi trường test chủ sở hữu là superuser. prolang được canh vì ĐÚNG
      -- cú tấn công đo được đổi `sql` -> `plpgsql` để có chỗ đặt mệnh đề IF nuốt sự kiện.
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = btrim(regexp_replace($q$ || pg_catalog.quote_literal(THAN_GHI) || $q$, '\s+', ' ', 'g'))
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 10
            AND p.prorettype = 'pg_catalog.record'::regtype
            AND p.proargnames = $q$ || TEN_COT_GHI || $q$
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
           FROM pg_proc p WHERE p.oid = to_regprocedure($ck$$q$ || CHU_KY_GHI || $q$$ck$))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' lang=' || (SELECT l.lanname FROM pg_language l WHERE l.oid = p.prolang)
                          || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                    FROM pg_proc p WHERE p.oid = to_regprocedure($ck$$q$ || CHU_KY_GHI || $q$$ck$)),
                  'hàm public.audit_append(...) không tồn tại')$q$,
      $q$quyền sở hữu hàm public.audit_append(...) (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- ---- [vòng fix 1 — IM4] (D1d) Định nghĩa public.chot_moc_neo() ----------------------
    -- Cùng lập luận với (D1b), áp cho bảng MỐC NEO: mục (D2) chỉ kiểm tgfoid/tgtype/tgenabled
    -- nên nó xanh với một hàm cùng tên mà THÂN đã bị thay — và một thân "RETURN NEW" trần ở đây
    -- trả lại đúng bậc tự do mà (IM4) vừa đóng (bên ghi chọn seq/hash của mốc neo).
    -- [QT1] Giống hệt (D1b) trên cả ba mặt (ai sửa được, ngoại lệ đổi chủ, các mã lỗi ngoài
    -- 42501). Nó phải đứng TRƯỚC (D2) vì trigger neo gọi nó.
    ARRAY[
      $q$định nghĩa hàm public.chot_moc_neo()$q$,
      $q$true$q$,
      $q$DO $fn$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.chot_moc_neo()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.chot_moc_neo();
           END IF;
           CREATE OR REPLACE FUNCTION public.chot_moc_neo() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $tmn$$q$ || THAN_MOC_NEO || $q$$tmn$;
         END
         $fn$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = btrim(regexp_replace($q$ || pg_catalog.quote_literal(THAN_MOC_NEO) || $q$, '\s+', ' ', 'g'))
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.chot_moc_neo()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.chot_moc_neo()')),
                  'hàm public.chot_moc_neo() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.chot_moc_neo() (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- ---- [vòng fix 1 — M4] Không có OVERLOAD nào của bốn hàm chuỗi -----------------------
    -- F-4 của báo cáo vòng trước viết VÔ ĐIỀU KIỆN rằng "hàm trùng tên khác chữ ký không đổi
    -- được kết quả băm". Phát biểu đó SAI vì nó bỏ điều kiện. Hai phép đo, không mâu thuẫn:
    --   * overload khác SỐ tham số, GIỮ bản chuẩn -> PostgreSQL luôn chọn khớp CHÍNH XÁC,
    --     F-4 đúng;
    --   * overload cùng SỐ tham số đổi ĐÚNG MỘT KIỂU (text -> varchar) VÀ DROP bản chuẩn ->
    --     hết khớp chính xác, overload thắng phân giải bằng ép kiểu ngầm, hash = sha256('gia'),
    --     MIGRATE OK không warning, và hàm giả SỐNG SÓT như một quả mìn ngầm (bất kỳ thay đổi
    --     chữ ký nào sau này — ví dụ pronargs 11 -> 14 mà [CR1] vừa làm — có thể đâm thẳng lại
    --     vào nó).
    -- Phát biểu ĐÚNG: "hàm khác chữ ký không đổi được kết quả CHỪNG NÀO BẢN CHUẨN CÒN TỒN TẠI".
    -- Mục này khoá đúng điều kiện đó bằng một phép đếm HẸP: đúng bốn tên, trong đúng schema
    -- public, đếm chính xác bằng 4. KHÔNG quét toàn schema (danh sách trắng pg_proc đã bị loại
    -- vì quá rộng), và KHÔNG tự chữa.
    -- [QT1 — có chặn deploy vĩnh viễn không] KHÔNG. Câu lệnh cưỡng chế cố ý là no-op: DROP tự
    -- động một hàm KHÔNG BIẾT là đúng bẫy [CR4] (migrate() tự đổi ngữ nghĩa lược đồ). Mục này
    -- chỉ PHÁN XÉT, và đường sửa đi được: hàm thừa do tp_deploy sở hữu nên một migration đánh
    -- số mới DROP được nó, và migration đánh số chạy TRƯỚC lượt phán xét trong cùng migrate().
    -- Nếu một task sau thật sự cần một overload hợp lệ thì chỗ sửa là con số 4 ở đây — một
    -- quyết định phải nhìn thấy được, đúng khuôn NGOAI_LE_HINH_DANG.
    ARRAY[
      $q$không có overload lạ của bốn hàm chuỗi kiểm toán$q$,
      -- Cùng tiền điều kiện với (D1c), và vì cùng một lý do: khi `public.audit_events` chưa tồn
      -- tại thì (D1c) bị bỏ qua nên chỉ có BA hàm, và một phép đếm "= 4" ở đây sẽ chặn deploy
      -- trên đúng lược đồ hợp lệ mà (D1c) vừa phải né.
      $q$pg_catalog.to_regclass('public.audit_events') IS NOT NULL$q$,
      $q$SELECT 1$q$,
      $q$(SELECT count(*) = 4 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND p.proname IN ('audit_compute_hash', 'noi_chuoi_kiem_toan', 'audit_append',
                               'chot_moc_neo'))$q$,
      $q$(SELECT 'phải có ĐÚNG 4 hàm mang bốn tên đó trong schema public, đang có: '
                 || coalesce(string_agg(p.oid::regprocedure::text, '; ' ORDER BY p.oid::regprocedure::text), '(không có)')
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND p.proname IN ('audit_compute_hash', 'noi_chuoi_kiem_toan', 'audit_append',
                               'chot_moc_neo'))$q$,
      $q$quyền sở hữu hàm thừa (DROP FUNCTION trong một migration đánh số mới) hoặc SUPERUSER$q$
    ],

    -- ---- [Task 6 — vòng fix 2, I1] (D5) HÌNH DẠNG CỘT CỦA BẢNG SỔ CHÍNH TẮC -----------
    -- Vì sao mục này tồn tại, đo được. Vế lọc của `can_co` là HÌNH DẠNG (bản vá IM2 của vòng
    -- fix 1 — xem MAU_HINH_DANG_SO) và nó đòi ĐỦ 15 tên cột. Điều đó đóng bẫy [CR4] theo một
    -- chiều và MỞ nó theo chiều kia: THÊM cột thì an toàn, còn ĐỔI TÊN hoặc XOÁ một trong 15
    -- cột thì `public.audit_events` RỚT KHỎI `can_co` và lớp C mất khả năng tự chữa trigger
    -- nối chuỗi — trong IM LẶNG, VĨNH VIỄN. Tái lập dưới role deploy KHÔNG superuser trên một
    -- DB đã migrate sạch:
    --     ALTER TABLE audit_events RENAME COLUMN user_agent TO ua;
    --     DROP TRIGGER audit_events_noi_chuoi ON audit_events;
    --     migrate() -> "MIGRATE OK []"  (KHÔNG lỗi, KHÔNG warning)
    --     pg_trigger -> chỉ còn _chan_delete / _chan_truncate / _chan_update
    --     INSERT (seq=500, prev_hash=sha256('bia'), hash=sha256('dat')) -> INSERT 0 1
    -- Phép đo một biến: cùng DB, chỉ đổi vế lọc của `can_co` về bản khoá theo relname thì
    -- trigger ĐƯỢC dựng lại. Tức đây đúng là cái giá của bản vá IM2, không phải một lỗi khác.
    -- Trước vòng fix 1, đổi tên cột làm INSERT vỡ ỒN ÀO (record "new" has no field ...); sau
    -- vòng fix 1 nó làm bảng sổ IM LẶNG mất lớp nối chuỗi. fail-closed -> fail-open.
    --
    -- CÂU LỆNH CƯỠNG CHẾ LÀ NO-OP, CÓ CHỦ Ý — mục này chỉ PHÁN XÉT. Một câu tự động
    -- "ALTER TABLE ... RENAME COLUMN ua TO user_agent" là migrate() TỰ TAY ĐỔI LƯỢC ĐỒ một
    -- bảng, đúng thứ [CR4] cấm; và trên một bảng mà `ua` là cột hợp lệ của một task sau, nó
    -- phá dữ liệu. (D5) gãy ỒN ÀO và nói ra đường sửa thay vì tự đoán ý định.
    --
    -- [QT1 — ai sửa được, bằng cách nào, trong bao lâu] Một migration đánh số MỚI chạy
    -- ALTER TABLE ... RENAME COLUMN: quyền sở hữu bảng sổ, ĐÚNG BẰNG thứ mục (D2) đã đòi nên
    -- không thêm hàng rào deploy nào. Vòng migration đánh số chạy TRƯỚC lượt PHÁN XÉT trong
    -- CÙNG một lần migrate(), nên vá được trong MỘT lần deploy — không có ngõ cụt khoá-chết.
    -- [QT1 — ném được lỗi gì ngoài 42501] Không có. Câu cưỡng chế là một khối DO RỖNG. Hậu
    -- điều kiện chỉ đọc `pg_attribute` (mọi role đọc được) và `to_regclass` trên một tên GHI
    -- SẴN: to_regclass trả NULL cho tên không tồn tại chứ không ném, và chỉ ném 42601 với tên
    -- sai cú pháp — tên ở đây là hằng trong chính file này. Trên lược đồ chỉ có 001/002 (chưa
    -- có bảng sổ) cả hai vế đều RỖNG nên mục QUA; đã đo cả hai đường nâng cấp 001/002 và
    -- 001/002/003.
    ARRAY[
      $q$hình dạng cột của bảng sổ chính tắc$q$,
      $q$true$q$,
      $q$DO $hd$ BEGIN END $hd$$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_HINH_DANG_CHINH_TAC || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_HINH_DANG_CHINH_TAC || $q$) t)$q$,
      $q$quyền sở hữu bảng sổ để chạy ALTER TABLE ... RENAME COLUMN trong một migration đánh số MỚI — mục này CỐ Ý KHÔNG tự sửa lược đồ$q$
    ],

    -- ---- [Task 8] (E1) Hàm + trigger PHÂN TÁCH NHIỆM VỤ trên public.user_roles ----------
    -- Vì sao mục này tồn tại: `user_roles_phan_tach_nhiem_vu` và
    -- `public.kiem_tra_phan_tach_nhiem_vu()` được tạo MỘT LẦN trong 005_identity.sql, nên chúng
    -- là đúng lớp trôi mà Task 5 đã mô tả cho sáu trigger sổ — 005 nằm trong schema_migrations
    -- sau lần deploy đầu và không bao giờ chạy lại. Bốn đường trôi đã biết, cùng danh sách với
    -- [CR1] của Task 5, và mục này đóng cả bốn:
    --   DROP TRIGGER · ALTER TABLE ... DISABLE TRIGGER · ENABLE REPLICA TRIGGER (bỏ ENABLE
    --   ALWAYS) · CREATE OR REPLACE FUNCTION giữ nguyên tên nhưng thân "BEGIN RETURN NULL; END".
    -- Đường thứ tư là đường nguy hiểm nhất và là lý do hậu điều kiện phải so THÂN hàm: tên
    -- trigger, tgfoid, tgenabled đều KHÔNG đổi, nên một phép kiểm chỉ hỏi "trigger còn đó không"
    -- xanh hết.
    --
    -- VÌ SAO CHỈ DỰNG LẠI TRIGGER KHI NÓ ĐANG SAI: DROP + CREATE TRIGGER lấy ACCESS EXCLUSIVE
    -- trên `user_roles`. Chạy vô điều kiện thì MỌI lần deploy khoá bảng gán vai trò — cùng lý do
    -- mục (D2) chỉ đụng tới trigger nằm trong CTE `sai`. CREATE OR REPLACE FUNCTION thì chạy vô
    -- điều kiện (không khoá bảng nào), đúng khuôn (D1a)/(D1b).
    --
    -- [QT1 — ai sửa được, bằng cách nào, trong bao lâu] proowner/relowner là chính role deploy
    -- (005 và lượt SỬA của file này đều chạy dưới nó), nên mục TỰ CHỮA ở lần deploy kế — không
    -- ai phải sửa tay trên cụm. Ngoại lệ đã biết, giống hệt (D1a)/(D1b): sau một
    -- "ALTER FUNCTION ... OWNER TO postgres" hoặc "ALTER TABLE public.user_roles OWNER TO
    -- postgres", câu cưỡng chế dưới role deploy trả 42501 và mục hết tự chữa; đường sửa là
    -- ALTER ... OWNER TO <role deploy> bằng superuser. Có test đo đúng ca đó, và nó phải là ca
    -- KẾT HỢP (đổi chủ sở hữu + hỏng thân hàm): chỉ đổi chủ sở hữu thôi thì hậu điều kiện vẫn
    -- ĐÚNG và mục vẫn qua — đột biến đơn lớp "sống sót mà không có nghĩa gì".
    -- [QT1 — ném được lỗi gì ngoài 42501] Đã rà: (a) 42P13 "cannot change return type" nếu ai đó
    -- thay hàm bằng hàm cùng tên khác kiểu trả về — đóng bằng DROP CÓ ĐIỀU KIỆN đứng trước, đúng
    -- khuôn [CR3] của (D1a); (b) 2BP01 nếu DROP chạy khi trigger còn phụ thuộc — không xảy ra vì
    -- vế điều kiện (prorettype <> trigger) loại đúng ca đó; (c) 42710 "... is a constraint
    -- trigger" nếu ai đó cắm một CONSTRAINT TRIGGER trùng tên — đóng bằng "DROP TRIGGER IF
    -- EXISTS" đứng TRƯỚC "CREATE OR REPLACE TRIGGER", đúng khuôn [CR3] của (D2); (d) 42P01 nếu
    -- `public.user_roles` không tồn tại — loại bằng chính vế điều kiện của mục này, và đó là lý
    -- do vế điều kiện KHÔNG phải `true`: trên lược đồ rút gọn chỉ có 001/002 (các test tích hợp
    -- của dự án dùng thư mục như thế) mục này phải NẰM IM hoàn toàn. Mọi lỗi khác vẫn bị BƯỚC 2
    -- nuốt và BƯỚC 3 phán xét.
    ARRAY[
      $q$hàm + trigger phân tách nhiệm vụ (D3) trên public.user_roles$q$,
      $q$to_regclass('public.user_roles') IS NOT NULL$q$,
      $q$DO $fnpt$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.kiem_tra_phan_tach_nhiem_vu()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.kiem_tra_phan_tach_nhiem_vu();
           END IF;
           CREATE OR REPLACE FUNCTION public.kiem_tra_phan_tach_nhiem_vu() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $tpt$$q$ || THAN_PHAN_TACH || $q$$tpt$;

           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.user_roles')
                             AND t.tgname = 'user_roles_phan_tach_nhiem_vu'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.kiem_tra_phan_tach_nhiem_vu()')
                             AND t.tgenabled = 'A'
                             AND t.tgtype = 21) THEN
             DROP TRIGGER IF EXISTS user_roles_phan_tach_nhiem_vu ON public.user_roles;
             CREATE OR REPLACE TRIGGER user_roles_phan_tach_nhiem_vu
               AFTER INSERT OR UPDATE ON public.user_roles
               FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_phan_tach_nhiem_vu();
             ALTER TABLE public.user_roles ENABLE ALWAYS TRIGGER user_roles_phan_tach_nhiem_vu;
           END IF;
         END
         $fnpt$$q$,
      -- tgtype = 21 = ROW(1) + INSERT(4) + UPDATE(16), và KHÔNG có bit BEFORE(2). AFTER là bắt
      -- buộc chứ không phải khẩu vị: trigger AFTER ROW được xếp hàng và bắn ở CUỐI câu lệnh, nên
      -- một INSERT nhiều hàng được xét khi TẤT CẢ hàng của câu đó đã hiện diện. Một BEFORE ROW
      -- bỏ lọt đúng ca "gán hai vai trò trong MỘT câu INSERT" — tức đúng đường đi rẻ nhất.
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = btrim(regexp_replace($q$ || pg_catalog.quote_literal(THAN_PHAN_TACH) || $q$, '\s+', ' ', 'g'))
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.user_roles')
                           AND t.tgname = 'user_roles_phan_tach_nhiem_vu'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = p.oid
                           AND t.tgenabled = 'A'
                           AND t.tgtype = 21)
           FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.kiem_tra_phan_tach_nhiem_vu()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT t.tgname || ':enabled=' || t.tgenabled::text
                                                          || ':type=' || t.tgtype::text
                                                          || ':fn=' || t.tgfoid::regprocedure::text
                                                          FROM pg_trigger t
                                                         WHERE t.tgrelid = to_regclass('public.user_roles')
                                                           AND t.tgname = 'user_roles_phan_tach_nhiem_vu'
                                                           AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.kiem_tra_phan_tach_nhiem_vu()')),
                  'hàm public.kiem_tra_phan_tach_nhiem_vu() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.kiem_tra_phan_tach_nhiem_vu() và bảng public.user_roles (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- ---- [Task 8] (E2) Hàm + trigger MA TRẬN QUYỀN trên public.role_permissions ---------
    -- Song sinh của (E1) ở tầng VAI TRÒ. Cùng bốn đường trôi, cùng lập luận "phải so THÂN chứ
    -- không chỉ hỏi trigger còn đó không", cùng khuôn DROP-có-điều-kiện + DROP TRIGGER IF EXISTS.
    -- Vì sao nó là TRIGGER chứ không phải một câu phán xét đọc bảng ở thời điểm deploy: xem khối
    -- chú thích của hằng THAN_MA_TRAN — bản phán xét đã ĐO ĐƯỢC là gãy với 42501 trên khuôn
    -- triển khai mà chính dự án này kiểm thử.
    --
    -- [QT1 — ai sửa được, bằng cách nào, trong bao lâu] Giống hệt (E1): proowner/relowner là
    -- role deploy nên mục TỰ CHỮA ở lần deploy kế. Nếu chính DỮ LIỆU vi phạm (một vai trò ôm
    -- trọn chuỗi đã nằm sẵn trong bảng), trigger này KHÔNG gỡ nó — nó chỉ chặn hàng MỚI. Đó là
    -- chủ ý: gỡ hộ một dòng role_permissions là migrate() tự tay đổi chính sách an ninh của
    -- khách hàng, đúng thứ [CR4] cấm; đường sửa là một migration đánh số MỚI chạy DELETE.
    --
    -- [vòng fix 1 — F2/I5] HIỆU CHUẨN LẠI HAI PHÁT BIỂU RỘNG HƠN THỰC TẾ:
    --   (a) Bản trước nói mục này "canh LIÊN TỤC thay vì mỗi lần deploy". Đúng phạm vi là: nó
    --       canh liên tục các hàng MỚI, và KHÔNG CANH GÌ với hàng đã nằm sẵn. Đo được: một vi
    --       phạm nằm sẵn (một vai trò ôm trọn chuỗi) đi qua `migrate()` ĐẦY ĐỦ không một tiếng
    --       động — trước migrate 5/5, sau migrate vẫn 5/5, và trigger được dựng lại đúng chuẩn
    --       `tgenabled='A'`. Tức mục này fail-OPEN với TRẠNG THÁI BAN ĐẦU, theo thiết kế.
    --   (b) Bản trước nói "Lớp bắt ca đó là phép kiểm tĩnh trên văn bản migration". SAI cho vi
    --       phạm CHÈN LÚC CHẠY: lớp tĩnh đọc `readFileSync(005)` và KHÔNG kết nối CSDL nào —
    --       reviewer chạy riêng và thấy 9 test XANH trong khi CSDL đang chứa đúng vi phạm ấy.
    --       Phạm vi đúng của lớp tĩnh: nó bắt ma trận sai được VIẾT VÀO một migration. Với một
    --       hàng chèn NGOÀI migration, lớp duy nhất nhìn thấy là mục (E3) ngay dưới đây, và nó
    --       chỉ phát WARNING.
    -- [QT1 — ném được lỗi gì ngoài 42501] Cùng danh sách với (E1): 42P13 (đóng bằng DROP có
    -- điều kiện), 2BP01 (không xảy ra vì vế điều kiện loại đúng ca đó), 42710 (đóng bằng DROP
    -- TRIGGER IF EXISTS), 42P01 (loại bằng vế điều kiện `to_regclass(...) IS NOT NULL`).
    -- KHÔNG có ca 42501 vì đọc bảng nghiệp vụ: hậu điều kiện của mục này đọc THUẦN pg_catalog.
    ARRAY[
      $q$hàm + trigger ma trận quyền (D3) trên public.role_permissions$q$,
      $q$to_regclass('public.role_permissions') IS NOT NULL$q$,
      $q$DO $fnmt$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.kiem_tra_ma_tran_quyen()')
                         AND p.prorettype <> 'pg_catalog.trigger'::regtype) THEN
             DROP FUNCTION public.kiem_tra_ma_tran_quyen();
           END IF;
           CREATE OR REPLACE FUNCTION public.kiem_tra_ma_tran_quyen() RETURNS trigger
           LANGUAGE plpgsql SET search_path = pg_catalog AS $tmt$$q$ || THAN_MA_TRAN || $q$$tmt$;

           IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.role_permissions')
                             AND t.tgname = 'role_permissions_ma_tran_quyen'
                             AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('public.kiem_tra_ma_tran_quyen()')
                             AND t.tgenabled = 'A'
                             AND t.tgtype = 21) THEN
             DROP TRIGGER IF EXISTS role_permissions_ma_tran_quyen ON public.role_permissions;
             CREATE OR REPLACE TRIGGER role_permissions_ma_tran_quyen
               AFTER INSERT OR UPDATE ON public.role_permissions
               FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_ma_tran_quyen();
             ALTER TABLE public.role_permissions ENABLE ALWAYS TRIGGER role_permissions_ma_tran_quyen;
           END IF;
         END
         $fnmt$$q$,
      $q$(SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                = btrim(regexp_replace($q$ || pg_catalog.quote_literal(THAN_MA_TRAN) || $q$, '\s+', ' ', 'g'))
            AND p.prosecdef IS FALSE
            AND p.proconfig = ARRAY['search_path=pg_catalog']
            AND p.pronargs = 0
            AND p.prorettype = 'pg_catalog.trigger'::regtype
            AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            AND EXISTS (SELECT 1 FROM pg_trigger t
                         WHERE t.tgrelid = to_regclass('public.role_permissions')
                           AND t.tgname = 'role_permissions_ma_tran_quyen'
                           AND NOT t.tgisinternal
                           AND t.tgfoid = p.oid
                           AND t.tgenabled = 'A'
                           AND t.tgtype = 21)
           FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.kiem_tra_ma_tran_quyen()'))$q$,
      $q$coalesce((SELECT 'thân/thuộc tính hàm hoặc trigger khác bản chuẩn — prosrc: '
                          || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
                          || ' | secdef=' || p.prosecdef::text
                          || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '(null)')
                          || ' | trigger=' || coalesce((SELECT t.tgname || ':enabled=' || t.tgenabled::text
                                                          || ':type=' || t.tgtype::text
                                                          || ':fn=' || t.tgfoid::regprocedure::text
                                                          FROM pg_trigger t
                                                         WHERE t.tgrelid = to_regclass('public.role_permissions')
                                                           AND t.tgname = 'role_permissions_ma_tran_quyen'
                                                           AND NOT t.tgisinternal),
                                                       '(KHÔNG CÓ)')
                     FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.kiem_tra_ma_tran_quyen()')),
                  'hàm public.kiem_tra_ma_tran_quyen() không tồn tại')$q$,
      $q$quyền sở hữu hàm public.kiem_tra_ma_tran_quyen() và bảng public.role_permissions (hoặc CREATE trên schema public khi hàm chưa tồn tại) hoặc SUPERUSER$q$
    ],

    -- Tám trigger (hai bảng × ba sự kiện chỉ-ghi-thêm, cộng trigger nối chuỗi trên
    -- audit_events và trigger chốt mốc neo trên audit_chain_anchors). TỰ CHỮA, và cố ý chữa
    -- bằng "CREATE OR REPLACE
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
               -- [vòng fix 1 — M1] Nhánh cột nay phát ĐÚNG quyền đang vi phạm (UPDATE hoặc
               -- INSERT) thay vì ghi cứng UPDATE. `r.quyen` đến từ aclexplode nên nó là một
               -- trong các tên quyền của PostgreSQL, không phải chuỗi do người dùng đưa vào;
               -- vế WHERE của CAU_QUYEN_BANG_SO_SAI đã giới hạn nó về đúng {UPDATE, INSERT}
               -- ở nhánh cột. Vẫn ghép qua format('%s') chứ không nối chuỗi trần để giữ đúng
               -- khuôn của cả file.
               IF r.cot IS NULL THEN
                 EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM %s CASCADE',
                                r.bang_oid::regclass, r.ai);
               ELSIF r.quyen = 'INSERT' THEN
                 EXECUTE format('REVOKE INSERT (%I) ON %s FROM %s CASCADE',
                                r.cot, r.bang_oid::regclass, r.ai);
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
    ],

    -- ---- [S1.20 / sổ nợ 3 + 16] Bốn tính chất thay cho bốn danh sách tên -------------------
    -- Cả bốn CHỈ PHÁN XÉT: câu lệnh cưỡng chế là một no-op đọc được, và hậu điều kiện là thứ
    -- làm `migrate()` NÉM kèm mô tả. Xem khối lập luận ở phần khai báo hằng.
    ARRAY[
      $q$trạng thái vật lý của bảng CHỈ-GHI-THÊM (suy từ tính chất)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_CHI_GHI_THEM_VAT_LY || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_CHI_GHI_THEM_VAT_LY || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (ALTER TABLE … SET LOGGED / CREATE TRIGGER) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$quyền GHI trên bảng CHỈ-GHI-THÊM (suy từ tính chất)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_CHI_GHI_THEM_QUYEN || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_CHI_GHI_THEM_QUYEN || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (hoặc là grantor của chính quyền cần thu hồi) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$bảng sổ không có cột ngoài chuỗi hash$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_COT_NGOAI_CHUOI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_COT_NGOAI_CHUOI || $q$) t)$q$,
      $q$quyền sở hữu bảng sổ (ALTER TABLE … DROP COLUMN) hoặc SUPERUSER$q$
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

    -- [vòng fix 1 — IM5] SỬA CHỮA KHÔNG ĐƯỢC IM LẶNG. Trước vòng này, các mục chạy câu lệnh
    -- sửa VÔ ĐIỀU KIỆN mỗi deploy và RAISE WARNING chỉ có cho sửa chữa THẤT BẠI — không bao
    -- giờ cho "định nghĩa tôi tìm thấy LÀ SAI". Hệ quả đo được, và nó là đòn tấn công NẶNG
    -- NHẤT vào hệ thống kiểm toán:
    --     thay thân audit_compute_hash + ghi lại mọi hash/prev_hash cho khớp
    --       trước hardening: verifyAuditChain -> {"ok":true,"checked":6}  <-- XANH trên một sổ
    --                        ĐÃ GIẢ MẠO HOÀN TOÀN
    --       migrate():       MIGRATE OK, KHÔNG WARNING
    --       sau hardening:   {"ok":false,"checked":6}                     <-- chuỗi mới lộ ra
    -- Cú thay bị SỬA CHỮA VÀ QUÊN: không ai được báo, và báo động duy nhất (verifyAuditChain)
    -- không được gọi ở đâu ngoài test. Nay hậu điều kiện được ĐÁNH GIÁ TRƯỚC khi sửa, và một
    -- trạng thái sai phát WARNING kèm chẩn đoán — cùng chuỗi mà BƯỚC 3 sẽ in ra.
    --
    -- Ba ràng buộc của chỗ này, cả ba đều load-bearing:
    --   * BƯỚC 2 KHÔNG ĐƯỢC GÃY (bất biến đầu file). Hai EXECUTE thêm vào đây đọc catalog nên
    --     chúng ném được (42P01 trên lược đồ nửa vời, 42501 khi thiếu quyền đọc). Chúng nằm
    --     trong khối con BEGIN/EXCEPTION riêng, và lỗi ở đây KHÔNG chặn câu lệnh sửa chạy.
    --   * Trên một database TRỐNG, gần như MỌI mục đều "sai" ở lần deploy đầu. Đó là ồn ào
    --     ĐÚNG SỰ THẬT, không phải báo động giả — WARNING nói rõ "đang tự chữa".
    --   * Chỉ ở lượt 'sua'. Lượt 'phan_xet' vốn đã in ra đúng chuỗi này qua BƯỚC 3/4.
    BEGIN
      EXECUTE 'SELECT ' || bang[i][4] INTO dung_roi;
      IF NOT coalesce(dung_roi, false) THEN
        EXECUTE 'SELECT ' || bang[i][5] INTO chi_tiet;
        RAISE WARNING 'Hardening: mục "%" ở trạng thái SAI TRƯỚC khi sửa (%). Đang tự chữa — '
                      'nếu bạn không chủ ý thay đổi nó thì đây là một lần TRÔI CẤU HÌNH và '
                      'phải được điều tra, không phải một dòng log bỏ qua được.',
                      bang[i][1], chi_tiet;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Hardening: không đánh giá được hậu điều kiện của mục "%" trước khi sửa: '
                    '% (%). Câu lệnh sửa vẫn chạy; BƯỚC 3 sẽ phán xét.',
                    bang[i][1], SQLERRM, SQLSTATE;
    END;

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

  -- ===== [vòng fix 1 — C1] (E3) PHÁN XÉT DỮ LIỆU MA TRẬN QUYỀN — CHỈ WARNING ==============
  -- Lớp deploy-time DUY NHẤT đọc DỮ LIỆU của `role_permissions`, và là lớp duy nhất nhìn thấy
  -- (a) một vi phạm NẰM SẴN từ trước (thứ trigger của (E2) không bao giờ bắn tới) và (b) một
  -- hàng chèn NGOÀI mọi văn bản migration (thứ lớp tĩnh của ma-tran-quyen.test.ts không đọc).
  --
  -- BA QUYẾT ĐỊNH, cả ba đều load-bearing:
  --
  -- (1) WARNING, KHÔNG PHẢI RAISE EXCEPTION — mục này CỐ Ý không vào `loi_gom`. Ma trận quyền
  --     là DỮ LIỆU CỦA KHÁCH HÀNG (đặc tả xếp "ma trận phê duyệt cấu hình được" vào S3). Chặn
  --     deploy trên dữ liệu khách hàng biến một cấu hình đáng ngờ thành một cụm KHÔNG DEPLOY
  --     ĐƯỢC cho tới khi ai đó viết một migration DELETE — đúng cái bẫy QT1 mà cả file này sinh
  --     ra để gỡ, và nặng hơn ở chỗ nó chặn cả những bản vá không liên quan. Tự sửa thì càng
  --     không: gỡ hộ một dòng `role_permissions` là migrate() tự tay đổi chính sách an ninh của
  --     khách hàng, đúng thứ [CR4] cấm.
  --     GIÁ PHẢI TRẢ, nói thẳng: WARNING này tới PostgreSQL server log và tới đầu ra của
  --     `psql`. Nó tới người gọi `migrate()` CHỈ KHI người gọi truyền `onThongBao`
  --     (packages/db/src/migrate.ts, `TuyChonMigrate`) — vòng fix 2 mở kênh đó vì trước đó
  --     KHÔNG có kênh nào cả: đo được, `migrate()` không gắn listener `notice` nên đầu ra là
  --     0 dòng, gắn rồi thì có 4 thông báo. MẶC ĐỊNH VẪN LÀ IM LẶNG; kênh chỉ làm cho việc
  --     nghe trở nên KHẢ THI. Nên đây là lớp YẾU NHẤT trong ba lớp, và nó được đặt ở đây vì
  --     nó là lớp DUY NHẤT có mặt ở chỗ này, không phải vì nó đủ.
  --
  -- (2) GUARD `has_table_privilege` — không có nó, mục này lặp lại ĐÚNG lỗi mà bản đầu của (E2)
  --     đã mắc: đọc một BẢNG NGHIỆP VỤ ở thời điểm deploy, gặp khuôn "superuser bootstrap một
  --     lần rồi deploy dưới role không sở hữu bảng", ném 42501 và giết migrate() trên một lược
  --     đồ hoàn toàn đúng. Khối EXCEPTION bọc ngoài là lớp thứ hai cho mọi chế độ hỏng khác.
  --     Khi bỏ qua, mục này NÓI RA việc mình bỏ qua — một phép kiểm im lặng không chạy là một
  --     phép kiểm tệ hơn không có.
  --
  --     [vòng fix 2 — MỤC C] BA NHÁNH, KHÔNG PHẢI HAI, VÀ NHÁNH ĐANG CHẠY TRÊN KHUÔN DEPLOY
  --     CHUẨN LÀ NHÁNH THỨ BA. Bản trước kết thúc mục này bằng câu «nó hoặc đọc được đủ, hoặc
  --     bị 42501 và NÓI RA». Câu đó SAI, và chính đoạn mã 15 dòng dưới nó cài nhánh thứ ba:
  --       (i)   đọc được đủ  -> phán xét thật;
  --       (ii)  42501        -> khối EXCEPTION bắt, WARNING, KHÔNG chặn deploy;
  --       (iii) KHÔNG có SELECT -> guard bắt TRƯỚC khi chạm bảng -> BỎ QUA, WARNING.
  --     Và (iii) là nhánh chạy trên chính khuôn mà bộ test của dự án ghim làm khuôn production
  --     (db/migrations.int.test.ts "[fix round 4 — N2] nhánh 1": superuser bootstrap một lần,
  --     rồi deploy dưới role KHÔNG sở hữu bảng, KHÔNG GRANT nào). Đo được trên khuôn đó, có
  --     cài sẵn một vi phạm [FO2] thật:
  --         HỒ SƠ ROLE DEPLOY: role_permissions=false roles=false superuser=false
  --         migrate() -> KHÔNG NÉM, trả về []
  --         WARNING 'Hardening (E3): BỎ QUA phép kiểm ma trận quyền — role deploy ...'
  --     ÂM TÍNH ĐO ĐƯỢC, QUAN TRỌNG, ĐỪNG PHÁ: (E3) KHÔNG gãy 42501 ở đó — bẫy QT1 mà dự án đã
  --     sập một lần đã được tránh THẬT, guard `has_table_privilege` làm đúng việc của nó.
  --     PHÁT BIỂU ĐÚNG MỨC, thay cho câu bị gỡ: trên khuôn deploy chuẩn của dự án hôm nay, (E3)
  --     KHÔNG PHÁN XÉT GÌ. Nó chỉ phán xét khi role deploy có SELECT trên hai bảng đó (vd.
  --     deploy bằng chính chủ sở hữu bảng, hoặc superuser — khuôn của test tích hợp khác). Có
  --     test mang nhãn [C1-E3-BO-QUA] chạy (E3) DƯỚI ROLE DEPLOY và khẳng định đúng ba điều:
  --     không ném, có công bố, và lớp phán xét thật KHÔNG chạy.
  --
  -- (3) KHÔNG ĐỌC `user_roles`, và đó là điểm khác biệt sinh tử với phương án đã bị LOẠI. Một
  --     phép kiểm mức NGƯỜI DÙNG ở đây là FAIL-OPEN đo được: phiên deploy chưa gắn `app.org_id`
  --     nên dưới FORCE RLS nó thấy ĐÚNG 0 hàng `user_roles` và kết luận "không vi phạm". Toàn
  --     bộ phép đo ở khối "[vòng fix 1 — C1]" của 005_identity.sql §(3). `role_permissions`
  --     KHÔNG có RLS (danh mục toàn cục — xem "LỆCH KHỎI BRIEF (1/3)"), nên mục này không có ca
  --     mù tương ứng: nếu nó CHẠY thì nó thấy đủ. Nhưng "nếu nó chạy" là một điều kiện thật —
  --     xem ba nhánh ở (2).
  IF to_regclass('public.role_permissions') IS NOT NULL
     AND to_regclass('public.roles') IS NOT NULL THEN
    BEGIN
      IF NOT has_table_privilege(current_user, 'public.role_permissions', 'SELECT')
         OR NOT has_table_privilege(current_user, 'public.roles', 'SELECT') THEN
        RAISE WARNING 'Hardening (E3): BỎ QUA phép kiểm ma trận quyền — role deploy % không có '
                      'SELECT trên public.roles/public.role_permissions. Bất biến D3 KHÔNG được '
                      'phán xét trên dữ liệu ở lần deploy này; lớp còn lại là phép kiểm tĩnh '
                      'trên văn bản migration (chỉ thấy ma trận VIẾT TRONG migration).',
                      current_user;
      ELSE
        EXECUTE 'SELECT string_agg(format(''%s+%s'', vai_1, vai_2), ''; '') FROM ('
                || CAU_CAP_PHU_CHUOI || ') t'
          INTO con_sot;
        IF con_sot IS NOT NULL THEN
          RAISE WARNING 'Hardening (E3): PHÂN TÁCH NHIỆM VỤ (D3) — có tổ hợp vai trò phủ TRỌN '
                        'chuỗi ngoài mốc ghim: %. Một người giữ cả hai vai trò trong một tổ hợp '
                        'như thế nắm trọn chuỗi tạo RFQ -> chọn nhà cung cấp -> mở thầu -> '
                        'award -> duyệt. Mục này CỐ Ý KHÔNG chặn deploy và KHÔNG tự sửa (ma '
                        'trận quyền là dữ liệu của khách hàng): rà những người đang giữ tổ hợp '
                        'đó, rồi hoặc thu hồi bớt vai trò, hoặc sửa ma trận bằng một migration '
                        'đánh số MỚI, hoặc — nếu đây là thay đổi CÓ CHỦ Ý — cập nhật cả '
                        'CAP_PHU_CHUOI ở file này lẫn CHAIN_COVERING_ROLE_PAIRS ở '
                        'packages/identity/src/permissions.ts.', con_sot;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Hardening (E3): không phán xét được ma trận quyền: % (%). Không chặn '
                    'deploy — xem lập luận (1) ở mục này.', SQLERRM, SQLSTATE;
    END;
  END IF;

  -- ===== (E4) CẤM LOG: THAM SỐ BIND ĐI VÀO LOG MÁY CHỦ ==================================
  -- [vòng fix 1 Task 10 — MỤC 1] Cùng KHUÔN với (E3) ở trên và VÌ ĐÚNG LÝ DO ĐÓ: cảnh báo,
  -- KHÔNG chặn deploy, KHÔNG tự sửa. Ở đây lý do còn cứng hơn (E3) — nó là một phép đo:
  --
  --   `log_parameter_max_length` có pg_settings.context = 'superuser'. Dưới ĐÚNG khuôn deploy
  --   mà dự án ghim làm khuôn production (role deploy = DB owner + CREATEROLE, KHÔNG
  --   superuser), `ALTER DATABASE … SET log_parameter_max_length = 0` ném
  --   «42501 permission denied to set parameter "log_parameter_max_length"». Một mục TỰ SỬA
  --   cho GUC ấy vì thế có hậu điều kiện KHÔNG BAO GIỜ đúng lại được trên khuôn deploy chuẩn
  --   -> "Hardening không sửa được 1 mục" ở BƯỚC 4 -> CHẶN DEPLOY VĨNH VIỄN vì một cấu hình
  --   nằm NGOÀI TẦM VỚI của migrate(). Đó đúng là cái bẫy QT1 mà [fix round 5 — R2] đã phải
  --   gỡ một lần rồi, chỉ ở một trục khác.
  --   `log_parameter_max_length_on_error` thì context = 'user', tức DB owner đặt được — nhưng
  --   cũng vì thế MỘT CÂU `SET` TRONG PHIÊN gỡ lại được ngay. Tự sửa nó là bảo đảm GIẢ.
  --
  -- Cái nó canh, nói đúng mức: `payload` của `outbox_jobs` mang dữ liệu nghiệp vụ (giá thầu,
  -- và trong một bản cẩu thả là cả token/mã OTP). `enqueueJob` truyền nó qua tham số bind $3,
  -- nên hai GUC dưới đây quyết định `payload` có được PostgreSQL tự ghi vào log máy chủ hay
  -- không — trên ĐƯỜNG ĐI BÌNH THƯỜNG, không cần kẻ tấn công nào. Lớp không phụ thuộc cấu hình
  -- là hợp đồng "payload mang THAM CHIẾU, không mang GIÁ TRỊ" (db/migrations/007_outbox.sql,
  -- khối "[vòng fix 1 — MỤC 1]"); mục này chỉ là con mắt thứ hai.
  BEGIN
    IF coalesce((SELECT s.setting::pg_catalog.int8 FROM pg_catalog.pg_settings s
                  WHERE s.name = 'log_parameter_max_length_on_error'), 0) <> 0 THEN
      RAISE WARNING 'Hardening (E4): CẤM LOG — log_parameter_max_length_on_error = %, nên mọi '
                    'câu lệnh LỖI ghi cả tham số bind vào log máy chủ. `outbox_jobs.payload` đi '
                    'qua $3 của enqueueJob, nên giá thầu / mã OTP trong payload nằm trong log. '
                    'Mục này CỐ Ý KHÔNG chặn deploy và KHÔNG tự sửa: GUC này đặt được ở '
                    'postgresql.conf, nơi migrate() không với tới, và tự sửa ở mức database là '
                    'bảo đảm giả (context = ''user'': một câu SET trong phiên gỡ lại được). Đặt '
                    'log_parameter_max_length_on_error = 0 ở mức máy chủ.',
                    coalesce((SELECT s.setting FROM pg_catalog.pg_settings s
                               WHERE s.name = 'log_parameter_max_length_on_error'), '?');
    END IF;

    IF coalesce((SELECT s.setting::pg_catalog.int8 FROM pg_catalog.pg_settings s
                  WHERE s.name = 'log_parameter_max_length'), -1) <> 0
       AND (coalesce((SELECT s.setting::pg_catalog.int8 FROM pg_catalog.pg_settings s
                       WHERE s.name = 'log_min_duration_statement'), -1) >= 0
            OR coalesce((SELECT s.setting FROM pg_catalog.pg_settings s
                          WHERE s.name = 'log_statement'), 'none') <> 'none') THEN
      RAISE WARNING 'Hardening (E4): CẤM LOG — log_parameter_max_length = % CỘNG VỚI '
                    'log_min_duration_statement = % / log_statement = %, nên câu lệnh THÀNH '
                    'CÔNG cũng ghi tham số bind vào log máy chủ. Đây là vế nặng nhất: nó chạm '
                    'đường app_api BÌNH THƯỜNG. Lưu ý mặc định của log_parameter_max_length là '
                    '-1 = GHI ĐẦY ĐỦ. Mục này KHÔNG chặn deploy và KHÔNG tự sửa — GUC này có '
                    'context = ''superuser'', nên một mục tự sửa sẽ CHẶN DEPLOY VĨNH VIỄN dưới '
                    'role deploy chuẩn (đo: 42501). Đặt log_parameter_max_length = 0 ở mức máy '
                    'chủ, hoặc tắt log câu lệnh.',
                    coalesce((SELECT s.setting FROM pg_catalog.pg_settings s
                               WHERE s.name = 'log_parameter_max_length'), '?'),
                    coalesce((SELECT s.setting FROM pg_catalog.pg_settings s
                               WHERE s.name = 'log_min_duration_statement'), '?'),
                    coalesce((SELECT s.setting FROM pg_catalog.pg_settings s
                               WHERE s.name = 'log_statement'), '?');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Hardening (E4): không đọc được cấu hình log: % (%). Không chặn deploy — '
                  'cùng lập luận với (E3).', SQLERRM, SQLSTATE;
  END;

  -- ===== BƯỚC 4: một lần gãy, liệt kê tất cả ============================================
  IF array_length(loi_gom, 1) > 0 THEN
    RAISE EXCEPTION E'Hardening không sửa được % mục:\n%\nChạy migrate() bằng role có quyền tương ứng, hoặc sửa tay rồi chạy lại.',
      array_length(loi_gom, 1), array_to_string(loi_gom, E'\n');
  END IF;
END
$khoi$;

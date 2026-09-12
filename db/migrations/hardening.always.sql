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

-- [vòng fix 1 — I3] ~~BA LƯỢT: SỬA · (migration đánh số) · SỬA · PHÁN XÉT~~ [S1.66 / lượt soi ngang 59c NHẸ-10] BA LƯỢT khi không tệp
-- nào chờ; BỐN khi còn tệp chờ: SỬA · TRƯỚC VÒNG · (migration đánh số) · SỬA · PHÁN XÉT — lượt 1b bên dưới, khoản nợ 100 (S1.57)
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
--     [S1.57 / khoản nợ 100] lượt 1b che_do='truoc_vong' — CHỈ khi còn tệp đánh số chưa áp, sau lượt 1,
--                               trước vòng: hỏi chủ thể "vai chạy migration" của mục 94, TRỪ dòng mà một
--                               migration dưới chính vai ấy sửa được, rồi RAISE TP100 nếu còn dòng. Ngoại
--                               lệ duy nhất trong các LƯỢT của hardening đối với "không phán xét trước
--                               vòng" (migrate() có thêm ba phép từ chối trước vòng của riêng nó); lý do ở
--                               khối cùng nhãn trong thân DO. Nên câu "BA lượt" ở trên nay đúng khi không
--                               tệp nào chờ; còn tệp chờ thì là BỐN.
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
  --   'truoc_vong' : [S1.57 / khoản nợ 100] chỉ một câu hỏi — CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI — rồi RAISE TP100 hoặc trả về.
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
  -- [S1.41 / lượt soi 32, NHẸ-3] Vế "có cột org_id" là MỘT hằng, dùng ở vị từ tenant (public) và ở mục khoản 85
  -- (ngoài public): nới định nghĩa ở một nơi thì nơi kia đi theo, không trôi ngầm. %1$s = bí danh pg_class.
  MAU_VI_TU_CO_ORG_ID constant text :=
    $q$EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = %1$s.oid AND a.attname = 'org_id'
                  AND a.attnum > 0 AND NOT a.attisdropped)$q$;

  MAU_VI_TU_BANG_TENANT constant text :=
    $q$%1$s.nspname = 'public' AND %2$s.relkind IN ('r', 'p')
       AND ($q$ || pg_catalog.format(MAU_VI_TU_CO_ORG_ID, '%2$s') || $q$
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
  -- [S1.55 / lượt soi 48 CAO-1] PUBLIC nhận theo OID 0, vai thật qua quote_ident. Bản cũ `coalesce(rolname, 'PUBLIC')` cho một
  -- vai THẬT tên "PUBLIC" ra cùng chuỗi với PUBLIC — PostgreSQL 16 nhận `CREATE ROLE "PUBLIC"` (chỉ `public` chữ thường là tên
  -- dành riêng). Đo: `ALTER POLICY vendor_bids_khach ON vendor_bids TO "PUBLIC"` ⇒ policy RESTRICTIVE thôi áp cho app_api (bảng
  -- thử: đếm 3 thay vì 0) mà 83⑴ im vì bảy cột vẫn khớp. quote_ident cho `"PUBLIC"` (có nháy) và giữ nguyên tên thường
  -- (`app_api`), nên mọi dòng khai hiện có không đổi (đo trên lược đồ thật); tên chứa dấu phẩy cũng hết mơ hồ. Cùng khuôn CASE
  -- của CAU_QUYEN_BANG_SO_SAI và nhánh ⒟. Bản ở db/rls-coverage.int.test.ts (CAU_VAI_TRO) có cổng đòi khớp.
  BIEU_THUC_VAI_TRO constant text :=
    $q$array_to_string(ARRAY(
         SELECT CASE WHEN o.oid = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(r.rolname) END
           FROM unnest(p.polroles) AS o(oid)
           LEFT JOIN pg_roles r ON r.oid = o.oid
          ORDER BY (CASE WHEN o.oid = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(r.rolname) END) COLLATE "C"), ',')$q$;

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
  -- [S1.40 / khoản nợ 84, lượt soi 29 INFO-9] ĐỆ QUY trên pg_inherits. Vế này từng chỉ nhìn cặp cha–con TRỰC
  -- TIẾP với cha là bảng tenant ở public, nên một CHÁU ở schema khác — k.c2 INHERITS (k.c1), k.c1 INHERITS
  -- (public.bao_gia) — không vào VI_TU_CAN_CO_RLS: mục (A) không bật RLS trên k.c2, ⑶ không thấy (RLS chưa
  -- bật), ⑵ không thấy (không RLS); GRANT SELECT ON k.c2 TO app_api ⇒ đọc thẳng cháu thấy hàng của MỌI tổ
  -- chức. Đo ở S1.40 (test "[khoản nợ 84]" trong migrations.int.test.ts): lỗ RÒ thật, không phải 0-hàng.
  -- Nay "tổ tiên" là bao đóng bắc cầu của pg_inherits: một tổ tiên bất kỳ là bảng tenant ở public thì bảng này
  -- là con cháu. CTE không tương quan (bảng cặp con–tổ tiên dựng trọn rồi mới lọc theo c.oid) — pg_inherits nhỏ.
  LA_CUA_BANG_TENANT constant text :=
    $q$EXISTS (
         WITH RECURSIVE to_tien(con, cha) AS (
           SELECT ke.inhrelid, ke.inhparent FROM pg_inherits ke
           UNION
           SELECT tt.con, ke.inhparent FROM to_tien tt JOIN pg_inherits ke ON ke.inhrelid = tt.cha
         )
         SELECT 1 FROM to_tien tt
           JOIN pg_class pc ON pc.oid = tt.cha
           JOIN pg_namespace pn ON pn.oid = pc.relnamespace
          WHERE tt.con = c.oid AND $q$
       || pg_catalog.format(MAU_VI_TU_BANG_TENANT, 'pn', 'pc') || $q$)$q$;

  -- [S1.40 / lượt soi 31, NHẸ-4] Dời lên đây từ khối hằng của mục (C): VI_TU_CAN_CO_RLS ngay dưới nay
  -- tham chiếu nó, và một hằng PL/pgSQL phải được khai TRƯỚC hằng dùng nó.
  -- Bộ lọc "schema do dự án quản" — MỘT bản cho mọi mục. ~~DÙNG LẠI đúng bộ lọc của mục (C), không phát minh lại.~~
  -- [S1.44 / khoản 88 ⑴ — lượt soi 33a #3] Mục (C) (view/matview và SECURITY DEFINER) và VI_TU_BANG_CHI_GHI_THEM từng
  -- CHÉP bộ lọc này inline — chú thích trên nói "dùng lại" mà (C) không dùng hằng; nay cả ba chỗ khai triển từ đây qua
  -- format(). Đột biến đo ở biên bản S1.44.
  -- %1$s = bí danh pg_namespace. "%%" là dấu % thật sau khi qua format().
  MAU_SCHEMA_DU_AN constant text :=
    $q$%1$s.nspname NOT IN ('pg_catalog', 'information_schema')
       AND %1$s.nspname NOT LIKE 'pg\_toast%%' AND %1$s.nspname NOT LIKE 'pg\_temp%%'$q$;

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
  -- án viết; nói ra thay vì hứa suông. [S1.40 / khoản nợ 84] "treo dưới" nay là MỌI BẬC (đệ quy) —
  -- cháu ở schema khác từng là một bậc tự do nữa, đã đóng. [S1.41 / khoản nợ 85] Bậc tự do ấy ĐÓNG — không
  -- bằng cách nới VI_TU_BANG_TENANT (bán kính nổ ở trên), mà bằng một mục PHÁN XÉT: bảng có cột org_id,
  -- trong lược đồ dự án, ngoài tập này và không bật RLS thì PHẢI KHAI (CAU_ORG_ID_NGOAI_PUBLIC_SAI). Ba kẽ
  -- của lượt soi 31 (con cũ sau NO INHERIT + RENAME; lá phân mảnh ngoài public tạo-và-DETACH giữa hai lần
  -- deploy; nhận diện tenant ngoài public chỉ qua pg_inherits) đều là hình dạng ấy — đo ở migrations.int.test.ts.
  -- [S1.40 / lượt soi 31, NHẸ-4] Vế con cháu lọc theo MAU_SCHEMA_DU_AN (loại pg_temp): `CREATE TEMP TABLE x ()
  -- INHERITS (bảng_tenant)` hợp lệ, và mục (A) từng phát ALTER TABLE lên bảng tạm của PHIÊN KHÁC — 0A000 "cannot
  -- alter temporary tables of other sessions", BƯỚC 2 nuốt, rồi phán xét gọi nó là "bảng tenant thiếu RLS" (đo). Bảng
  -- tạm là của riêng phiên: PostgreSQL loại bảng tạm của phiên khác khỏi khai triển kế thừa — đo: phiên khác (kể cả
  -- superuser, app_api gắn đúng tổ chức) đọc qua cha KHÔNG thấy hàng của nó. Không có gì để bật RLS cho ai.
  VI_TU_CAN_CO_RLS constant text :=
    $q$(( $q$ || VI_TU_BANG_TENANT || $q$ )
        OR (c.relkind IN ('r', 'p') AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
            AND $q$ || LA_CUA_BANG_TENANT || $q$))$q$;

  -- [S1.50 / khoản nợ 91] Bảng đang BẬT RLS mà thiếu FORCE, trong lược đồ dự án, không thuộc extension. MỘT hằng, ba chỗ
  -- dùng (câu sửa, hậu điều kiện, mô tả) — bài học lượt 30 NHẸ-2: chép vị từ là trôi ngầm.
  VI_TU_FORCE_THIEU constant text :=
    $q$c.relkind IN ('r', 'p') AND c.relrowsecurity AND NOT c.relforcerowsecurity
       AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
       AND NOT EXISTS (SELECT 1 FROM pg_depend de
                        WHERE de.classid = 'pg_class'::regclass AND de.objid = c.oid AND de.deptype = 'e')$q$;

  -- [S1.41 / lượt soi 32, NHẸ-3] Hình dạng của khoản 85 — MỘT hằng, hai chiều của CAU_ORG_ID_NGOAI_PUBLIC_SAI
  -- cùng tham chiếu (bài học lượt 30 NHẸ-2: chép vị từ là trôi ngầm; test đòi đúng hai tham chiếu).
  VI_TU_HINH_DANG_85 constant text :=
    $q$c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
       AND $q$ || pg_catalog.format(MAU_VI_TU_CO_ORG_ID, 'c') || $q$
       AND NOT $q$ || VI_TU_CAN_CO_RLS;

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
  -- ~~BẬC TỰ DO CÒN LẠI, nói ra thay vì hứa suông: một policy RESTRICTIVE có thể là no-op
  -- (USING (true)) — không phải lỗ hổng nhưng cũng không phải phòng thủ; và biểu thức của nó
  -- gọi được hàm do người khác viết. Cả hai đòi quyền DDL trên bảng, tức tác nhân đã ở mức
  -- làm được việc tệ hơn.~~ [S1.44 / khoản 88 ⑷ — lượt soi 33b #13] Gạch: từ S1.38 (khoản 83⑴) MỌI policy
  -- RESTRICTIVE ngoài khuôn `<bảng>_khach` phải được KHAI ở POLICY_RESTRICTIVE_KHAI (CAU_POLICY_LOP_SAI), nên một
  -- RESTRICTIVE no-op không còn là bậc tự do: nó chặn deploy cho tới khi có tên và lý do.
  --
  -- [vòng fix 2 — CR2 / vòng fix 3 — I2] Vế "biểu thức có được duyệt không" hỏi HAI danh sách,
  -- và danh sách thứ hai khoá theo ĐÚNG (bang, polname, lenh, vai_tro) — xem NGOAI_LE_HINH_DANG.
  -- [S1.66 / lượt soi ngang 59a-8] Thông điệp nêu policy bằng TÊN, không in biểu thức: hằng trong USING/WITH CHECK có thể là
  -- UUID của một tổ chức hay một địa chỉ email, và thông điệp đi thẳng vào log deploy (bài học S1.51 ⑷). Đo trước bản vá:
  -- policy `USING (org_id = '<uuid>'::uuid)` trên `suppliers` ⇒ thông điệp mang nguyên UUID. Người sửa đọc biểu thức ở catalog.
  -- Test: db/thong-diep-khong-gia-tri.int.test.ts.
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
                ELSE 'hình dạng biểu thức KHÔNG nằm trong danh sách được duyệt (biểu thức USING/WITH CHECK không in ra — đọc pg_get_expr(polqual, polrelid) và pg_get_expr(polwithcheck, polrelid) của policy này trong pg_policy)'
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
  -- ~~BẬC TỰ DO CÒN LẠI: bảng tenant đặt ở schema KHÁC 'public' vẫn không được nhận là bảng
  -- tenant (xem ghi chú (A)), nên một view đọc bảng đó chỉ bị bắt qua đường cột org_id.~~ [S1.44 / khoản 88 ⑷ —
  -- lượt soi 33b #13] Gạch: bảng có org_id ngoài public nay hoặc treo dưới bảng tenant (mọi bậc — khoản 84,
  -- VI_TU_CAN_CO_RLS), hoặc bật RLS và khai (83⑶), hoặc PHẢI KHAI (khoản 85 — CAU_ORG_ID_NGOAI_PUBLIC_SAI); view đọc nó
  -- vẫn bị bắt qua cột org_id của chính view. Bảng ấy không còn đứng ngoài mọi mục.
  CAU_DOC_VONG constant text :=
    $q$SELECT n.nspname || '.' || c.relname || ': ' ||
              CASE WHEN c.relkind = 'm'
                   THEN 'MATERIALIZED VIEW trong lược đồ dự án — matview KHÔNG chịu RLS ở bất kỳ cấu hình nào, '
                        'nên nó là một bản sao dữ liệu đứng ngoài mọi policy (khoản 91). Bỏ nó đi, hoặc thêm tên '
                        'này vào NGOAI_LE_DOC_VONG kèm lý do.'
                   ELSE 'VIEW trong lược đồ dự án mà thiếu "WITH (security_invoker = true)" — RLS và quyền được '
                        'kiểm theo CHỦ SỞ HỮU view, không theo người gọi; nếu view chạm dữ liệu có RLS (trực tiếp, '
                        'qua một view khác, hay qua một hàm) thì người gọi mượn trọn quyền của chủ (khoản 91). Sửa '
                        'bằng migration mới: ALTER VIEW ... SET (security_invoker = true).'
              END AS mo_ta
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('v', 'm')
          AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND n.nspname || '.' || c.relname NOT IN (SELECT ten FROM $q$ || NGOAI_LE_DOC_VONG || $q$)
          AND NOT EXISTS (SELECT 1 FROM pg_depend dx
                           WHERE dx.classid = 'pg_class'::regclass AND dx.objid = c.oid
                             AND dx.deptype = 'e')
          -- [S1.50 / khoản nợ 91 — lượt soi 42 NẶNG-1] KHÔNG CÒN VẾ ĐÍCH. Bản S1.46 chỉ soi view đọc BẢNG TENANT; bản đầu của
          -- vòng này nới sang "mọi bảng bật RLS" và vẫn hụt hai đường mà người soi dựng được: ⑴ CHUỖI VIEW LỒNG (`v2` không
          -- invoker trên `v1` invoker trên bảng — `pg_depend` chỉ nối view với quan hệ THAM CHIẾU TRỰC TIẾP, nên đích của `v2`
          -- là một view, không phải bảng); ⑵ VIEW ĐỌC QUA HÀM (`SELECT gia FROM public.f()` — rule phụ thuộc `pg_proc`, không
          -- phụ thuộc bảng), và nhánh "cột org_id của chính view" cũng im khi view không chiếu `org_id`. Đuổi theo bằng bao đóng
          -- đệ quy `pg_rewrite`→`pg_depend`→`pg_proc` là một vị từ nữa để trôi; vế ĐỐI XỨNG với nhánh SECDEF ngay dưới — vốn
          -- KHÔNG có vế đích nào và cả kho đã sống với nó từ S0 (sáu migration ghi "mục (C) CẤM mọi SECURITY DEFINER") — thì
          -- không: MỌI view/matview trong lược đồ dự án phải `security_invoker`, matview thì phải khai. Cái giá nói ra: một
          -- view trên bảng tra cứu KHÔNG có dữ liệu tenant cũng phải đặt cờ; cửa ra là một dòng `ALTER VIEW` hoặc
          -- `NGOAI_LE_DOC_VONG`. Lược đồ thật hôm nay KHÔNG có view/matview nào (đo), nên vế này không kêu oan chỗ nào.
          -- [S1.50 / lượt soi 42 NHẸ-3] `reloptions` giữ NGUYÊN VĂN chuỗi người dùng gõ, và `parse_bool` của PostgreSQL nhận
          -- cả `yes`, `y`, `t`, `tr`, `tru`. Bản cũ chỉ nhận `true|on|1` nên `SET (security_invoker = yes)` — một view THẬT SỰ
          -- invoker — bị mục này kêu và CHẶN DEPLOY trên lược đồ hợp lệ, đúng chiều hỏng ADR-028 §3 cấm.
          AND (c.relkind = 'm'
               OR coalesce(array_to_string(c.reloptions, ','), '')
                    !~* '\msecurity_invoker\s*=\s*(t|tr|tru|true|y|ye|yes|on|1)\M')
       UNION ALL
       SELECT n.nspname || '.' || p.proname || ': hàm SECURITY DEFINER — nó chạy dưới quyền '
              'CHỦ SỞ HỮU nên mọi RLS bên trong được kiểm theo chủ sở hữu, không theo người '
              'gọi. Bỏ SECURITY DEFINER, hoặc thêm tên này vào NGOAI_LE_DOC_VONG kèm lý do.'
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef
          AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
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
  --
  -- [S1.45 / khoản nợ 90 — lượt soi 34 #8, ADR-037 §5] `bang_so` đòi DANH TÍNH NHẤT QUÁN (kênh ①), không chỉ tên. Kịch
  -- bản khoản 89 (RENAME sổ, dựng bảng cùng tên): bảng gốc mang chú thích neo theo oid nên nó "giữ" danh tính
  -- `neo: public.audit_events`; bảng cùng tên dựng sau là bản sao — trước S1.45, D2 ở BƯỚC 2 dựng bốn trigger lên bản
  -- sao ấy TRƯỚC khi BƯỚC 3 (CAU_NEO_SAI ⑴⑷) chặn deploy: chặn được, nhưng lớp SỬA đã chạm một bảng không phải sổ.
  -- Nay `bang_so` ⊂ tên đã khai với hai vế, cả hai so PHẦN TÊN của neo (trước ` org_id#`; attnum là việc của ⑵′):
  --   ⒜ chú thích neo của chính nó — nếu có — nêu tên hiện tại HOẶC nêu tên sổ ở `public`: bảng sổ thật bị
  --      `SET SCHEMA` đẩy đi vẫn LÀ sổ theo oid và vẫn được chữa ở schema mới — giữ nguyên đánh đổi [CR2a] (bản đầu
  --      của vòng đòi bằng tên hiện tại, bị lượt soi 37 CAO-1 bác: nó đảo CR2a, bỏ mặc lịch sử thật ở schema mới);
  --   ⒝ không quan hệ KHÁC nào trong lược đồ dự án mang neo nêu đúng tên này (bảng gốc còn giữ danh tính thì bản sao
  --      cùng tên không được chữa).
  -- Chưa có chú thích (deploy đầu; cụm N2 bảng thuộc superuser) thì ⒜ đi qua — kênh ① mạnh bằng quyền sở hữu, như
  -- ADR-037 §5: chủ bảng gỡ chú thích bảng gốc ⇒ danh tính rơi ⇒ D2 lại chữa bản sao (đo ở migrations.int.test.ts,
  -- khoản 89 (c)); thứ còn giữ khi ấy là kênh ③ (hình dạng) ở lớp phán xét. [lượt soi 37 NHẸ-3] Ai làm được điều ngược:
  -- chủ một bảng BẤT KỲ trong schema dự án đặt `COMMENT ON TABLE x IS 'neo: public.audit_events'` (chỉ cần CREATE
  -- trên schema) làm sổ thật rời `bang_so` — lớp SỬA đứng yên, nhưng CAU_NEO_SAI ⑴ nêu đúng `x` kèm oid sổ và vế
  -- "KHÔNG TỒN TẠI" của CAU_TRIGGER_CHAN_SAI đỏ cùng lượt ⇒ deploy chặn, phát hiện trễ chứ không mất; kẻ ấy trước đây
  -- đã chặn được deploy bằng một bảng có org_id không policy. Lớp SỬA chỉ chạm thứ danh tính nhất quán; thứ không
  -- nhất quán thì lớp PHÁN XÉT chặn deploy — hai lớp không tựa nhau. `bang_al` (bảng lạ mang trigger canh) không đổi.
  CTE_TRIGGER_CHAN constant text :=
    $q$WITH bang_so AS (
         SELECT c.oid AS bang_oid, n.nspname, c.relname, c.relpersistence, c.relowner
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p')
            AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
            AND c.relname IN (SELECT ten FROM $q$ || BANG_CHI_GHI_THEM || $q$)
            AND (pg_catalog.obj_description(c.oid, 'pg_class') IS NULL
                 OR pg_catalog.split_part(pg_catalog.obj_description(c.oid, 'pg_class'), ' org_id#', 1)
                    IN ('neo: ' || pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname),
                        'neo: public.' || pg_catalog.quote_ident(c.relname)))
            AND NOT EXISTS (SELECT 1 FROM pg_class k JOIN pg_namespace kn ON kn.oid = k.relnamespace
                             WHERE k.oid <> c.oid AND k.relkind IN ('r', 'p')
                               AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'kn') || $q$
                               AND pg_catalog.split_part(pg_catalog.obj_description(k.oid, 'pg_class'), ' org_id#', 1)
                                   = 'neo: ' || pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname))
            -- [S1.48 / lượt soi ngang 40a I5] ⒝′: không quan hệ KHÁC nào mang ĐÚNG chuỗi neo của chính bảng này. Decoy
            -- `kho.audit_events` chép nguyên chú thích `neo: public.audit_events org_id#2` đi qua ⒜ (dạng `public.<sổ>`) và ⒝
            -- (không ai mang `neo: kho.audit_events`) trong khi ⒝ loại sổ THẬT ⇒ D2/D3/D4 chữa decoy, đứng yên trên sổ thật
            -- (⑴ + ⑷ chặn cùng lượt — phát hiện trễ, không mất). Nay cả hai đứng yên: lớp SỬA chỉ chạm thứ danh tính nhất quán.
            AND NOT EXISTS (SELECT 1 FROM pg_class k2 JOIN pg_namespace kn2 ON kn2.oid = k2.relnamespace
                             WHERE k2.oid <> c.oid AND k2.relkind IN ('r', 'p')
                               AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'kn2') || $q$
                               AND pg_catalog.obj_description(k2.oid, 'pg_class') IS NOT NULL
                               AND pg_catalog.obj_description(k2.oid, 'pg_class') = pg_catalog.obj_description(c.oid, 'pg_class'))
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
            'schema public — nó đã bị DROP, bị ALTER TABLE ... SET SCHEMA đẩy đi, bị thay '
            'bằng một VIEW cùng tên, hoặc [khoản 90] quan hệ đang mang tên ấy KHÔNG giữ danh tính nhất quán theo '
            'kênh ① (bản sao chiếm tên trong khi bảng gốc còn neo; chú thích khác trên sổ) — xem dòng của mục danh '
            'tính (ADR-037). Sửa bằng một migration mới.' AS mo_ta
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
  -- đúng ba lỗ vòng này vừa tuyên bố đã đóng. ~~Vế dưới đây là `MAU_SCHEMA_DU_AN` đã KHAI TRIỂN cho
  -- bí danh `n` (`%%` của format() thành `%` thật)~~ [S1.44 / khoản 88 ⑴] Vế dưới đây LÀ chính hằng ấy
  -- qua format() như mọi mục khác — bản chép inline (lượt soi 33a #3) đã bỏ; `db/hardening-suy-tu-tinh-chat.int.test.ts`
  -- dựng vị từ này qua BỘ GIẢI HẰNG (docHangHardening) và đòi BẰNG bản sinh ở test, nên nguyên văn vẫn được đòi và
  -- hai bên không trôi khỏi nhau được.
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
  --
  -- [S1.36 / khoản nợ 79 — lượt soi 25a #1 CAO] `tgqual IS NULL AND tgattr = ''`: một trigger canh mang
  -- `WHEN (…)` hay `UPDATE OF <cột>` giữ nguyên tên hàm, nhưng hàm canh KHÔNG CHẠY cho một phần câu. Đo
  -- trên PostgreSQL 16: bảng có `BEFORE UPDATE OF a` + `BEFORE DELETE … WHEN (false)` gọi bid_chi_ghi_them()
  -- ⇒ UPDATE cột khác 1 hàng, DELETE 1 hàng, không lỗi — mà vị từ cũ vẫn nhận bảng là chỉ-ghi-thêm
  -- (LOGGED/chốt TRUNCATE/ACL đều xanh). CTE_TRIGGER_CHAN đã soi đúng hai cột ấy từ S0 cho bảng CÓ TÊN;
  -- vị từ SUY RA thì không — bài học không sang được, và sáu lượt soi dọc (19–24) không thấy vì không
  -- lượt nào đối chiếu lớp mới với lớp cũ. Nay vị từ chỉ ĐẾM trigger canh vô điều kiện, nên bảng ấy
  -- rơi khỏi tập; và để nó không rơi TRONG IM LẶNG, mục phán xét CAU_TRIGGER_CANH_CO_DIEU_KIEN (dưới)
  -- chặn deploy khi một trigger canh có điều kiện — hay [lượt soi 27] không ở ENABLE ALWAYS — tồn tại ở bất
  -- kỳ bảng nào của dự án. Vị từ này cố ý KHÔNG đọc tgenabled: bảng có trigger canh tắt vẫn trong tập để
  -- LOGGED/chốt TRUNCATE/ACL vẫn được phán; cột ấy chặn deploy qua mục phán xét, không qua vị từ.
  -- `db/hardening-suy-tu-tinh-chat.int.test.ts` giữ vế này NGUYÊN VĂN (VE_TRIGGER_VO_DIEU_KIEN) và đo
  -- vị từ CŨ bằng cách bỏ vế ấy ra.
  VI_TU_BANG_CHI_GHI_THEM constant text :=
    $q$SELECT c.oid AS bang_oid, c.relname, c.relpersistence, c.relowner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND c.relkind IN ('r', 'p')
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
                  AND t.tgqual IS NULL AND t.tgattr::pg_catalog.text OPERATOR(pg_catalog.=) ''
                  AND (p.prosrc !~* '\mRETURN\M'
                       OR (p.pronamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace
                           AND p.proname IN ('bid_chi_ghi_them', 'chan_sua_xoa')))
                  AND (t.tgtype OPERATOR(pg_catalog.&) 19::pg_catalog.int2) OPERATOR(pg_catalog.=) 19) OPERATOR(pg_catalog.>) 0
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
                  AND t.tgqual IS NULL AND t.tgattr::pg_catalog.text OPERATOR(pg_catalog.=) ''
                  AND (p.prosrc !~* '\mRETURN\M'
                       OR (p.pronamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace
                           AND p.proname IN ('bid_chi_ghi_them', 'chan_sua_xoa')))
                  AND (t.tgtype OPERATOR(pg_catalog.&) 11::pg_catalog.int2) OPERATOR(pg_catalog.=) 11) OPERATOR(pg_catalog.>) 0$q$;

  -- Trạng thái VẬT LÝ của MỌI bảng chỉ-ghi-thêm: LOGGED, có chốt TRUNCATE, và [S1.31 / sổ nợ 73]
  -- KHÔNG một RULE nào. Vế rule của [CR1] chỉ với tới `bang_so` (hai bảng sổ, TỰ GỠ ở mục trước);
  -- đo ngày 2026-09-09: `CREATE RULE … ON DELETE TO bid_receipts DO INSTEAD NOTHING` SỐNG QUA
  -- migrate(). Một rule viết lại câu lệnh TRƯỚC khi trigger nào chạy, nên nó đứng NGOÀI toàn bộ
  -- lớp canh của H19: trên INSERT nó nuốt biên nhận trong im lặng (INSERT 0 0), trên UPDATE/DELETE
  -- nó biến lời từ chối thành một no-op không dấu vết. Bảng SUY RA chỉ được PHÁN XÉT ([CR4]).
  CAU_CHI_GHI_THEM_VAT_LY constant text :=
    $q$SELECT b.bang_oid::regclass::text || ': bảng CHỈ-GHI-THÊM đang UNLOGGED (relpersistence='
              || b.relpersistence::text || ') — mọi hàng biến mất sau lần crash kế tiếp. [CR5] đã '
                 'đo bằng SIGKILL postgres thật: trước-crash 4 hàng, sau-crash 0. Sửa: '
                 'ALTER TABLE … SET LOGGED.' AS mo_ta
         FROM ($q$ || VI_TU_BANG_CHI_GHI_THEM || $q$) b
        WHERE b.relpersistence <> 'p'
       UNION ALL
       SELECT b.bang_oid::regclass::text || ': bảng CHỈ-GHI-THÊM không có chốt TRUNCATE ĐANG BẬT và VÔ ĐIỀU KIỆN '
                 '([S1.36 / khoản nợ 79] đo: WHEN (false) trên trigger TRUNCATE cấp câu lệnh là HỢP LỆ với '
                 'PostgreSQL 16 và TRUNCATE đi lọt — chốt có WHEN không phải chốt). '
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
                             AND t.tgqual IS NULL
                             AND (t.tgtype OPERATOR(pg_catalog.&) 34::pg_catalog.int2)
                                 OPERATOR(pg_catalog.=) 34)
       UNION ALL
       SELECT b.bang_oid::regclass::text || '.' || rw.rulename::text || ': RULE trên bảng CHỈ-GHI-THÊM. '
                 'Một rule viết lại câu lệnh TRƯỚC khi trigger nào chạy — "DO INSTEAD NOTHING" trên '
                 'INSERT nuốt biên nhận/phiên bản báo giá trong IM LẶNG (INSERT 0 0, không lỗi), trên '
                 'UPDATE/DELETE thì biến lời từ chối của hàm canh thành một no-op không dấu vết. Dự án '
                 'không dùng RULE (tổng điều tra pg_rewrite ở db/hardening-suy-tu-tinh-chat.int.test.ts '
                 'giữ danh sách RỖNG). Sửa: DROP RULE.' AS mo_ta
         FROM ($q$ || VI_TU_BANG_CHI_GHI_THEM || $q$) b
         JOIN pg_rewrite rw ON rw.ev_class = b.bang_oid
        WHERE rw.rulename <> '_RETURN'$q$;

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

  -- [S1.36 / khoản nợ 79] Trigger của HÀM CANH mang `WHEN`, `UPDATE OF`, hay KHÔNG ở ENABLE ALWAYS — ở MỌI
  -- bảng của dự án, không chỉ bảng có tên. Ba cột của pg_trigger giữ nguyên tên hàm mà làm hàm canh không
  -- chạy (cả câu hay một phần câu): tgqual, tgattr, tgenabled. Với hai cột đầu, vị từ ở trên đã THẢ bảng khỏi
  -- tập chỉ-ghi-thêm (đúng: nó không chỉ-ghi-thêm); với cột thứ ba vị từ CỐ Ý vẫn đếm (để LOGGED/ACL vẫn
  -- được phán) — [lượt soi 27, NẶNG-1] bản đầu của mục này bỏ sót cột ấy: DISABLE TRIGGER hay ENABLE thường
  -- + session_replication_role = replica trên bảng suy ra cho UPDATE đi qua mà migrate() OK. Cả ba trường
  -- hợp đều là "thả trong im lặng" — chế độ hỏng đắt nhất của lớp này (ADR-035 §2⑴): một bảng vừa mang tên
  -- hàm canh vừa cho UPDATE/DELETE đi qua là một lời khai sai bằng lược đồ. Mục này PHÁN XÉT (ADR-028 §2⑵)
  -- — cách sửa là một migration mới dựng lại trigger, hoặc đổi hàm. Tập hàm canh là CÙNG vị từ hàm của
  -- VI_TU_BANG_CHI_GHI_THEM (hình dạng ∪ khai báo, plpgsql); không lọc tgtype nên phủ cả trigger TRUNCATE
  -- (trùng cố ý với vế chốt TRUNCATE ở CAU_CHI_GHI_THEM_VAT_LY — hai lớp cho một ca). Đo: 0 trigger như thế
  -- trong kho hôm nay (045 đã nâng mọi trigger lên ALWAYS; tổng điều tra ở test giữ điều ấy không thiu).
  -- [S1.39, lượt soi 30 NHẸ-2] Vị từ "p là hàm canh" (hình dạng ∪ khai tên, plpgsql) — MỘT bản cho hai mục phán xét
  -- trigger canh (điều kiện S1.36; hình thức S1.39). ~~VI_TU_BANG_CHI_GHI_THEM giữ bản inline vì test đòi nguyên văn;~~
  -- [S1.44 / khoản 88 ⑴] vị từ ấy nay cũng khai triển hằng qua format(), test đòi nguyên văn qua bộ giải;
  -- danh sách tên ở đây phải bằng danh sách ấy — test H19 đòi hằng này được cả hai mục tham chiếu.
  VI_TU_HAM_CANH_HINH_DANG constant text :=
    $q$(p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
        AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
        AND (p.prosrc !~* '\mRETURN\M'
             OR (p.pronamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace
                 AND p.proname IN ('bid_chi_ghi_them', 'chan_sua_xoa'))))$q$;

  -- [S1.44 / khoản 88 ⑶ — lượt soi 33a #11] NÓI RA CHỖ CHỊU LỰC: trên bảng CÓ TÊN trong BANG_CHI_GHI_THEM, mục này và
  -- CAU_HAM_CANH_HINH_THUC_SAI chỉ xanh vì D2/CTE_TRIGGER_CHAN ở BƯỚC 2 đã dựng lại trigger đúng hình thức (không WHEN,
  -- không UPDATE OF, BEFORE … FOR EACH ROW, ENABLE ALWAYS) TRƯỚC khi BƯỚC 3 phán xét — biên bản S1.36 đo: fixture đặt
  -- WHEN/UPDATE OF lên audit_events_chan_update, migrate() vẫn OK. Hai mục chịu lực cho bảng SUY RA (ba bảng S1 và bảng
  -- tương lai) và cho bảng có tên chỉ khi D2 không sửa được (42501 nuốt ở BƯỚC 2) — khi ấy mục D2 cũng đỏ cùng lượt.
  CAU_TRIGGER_CANH_CO_DIEU_KIEN constant text :=
    $q$SELECT t.tgrelid::regclass::text || '.' || t.tgname::text || ': trigger của hàm canh '
              || p.oid::regprocedure::text
              || CASE WHEN t.tgqual IS NOT NULL THEN ' có mệnh đề WHEN' ELSE '' END
              || CASE WHEN t.tgattr::text <> '' THEN ' có UPDATE OF <cột>' ELSE '' END
              || CASE WHEN t.tgenabled <> 'A'
                   THEN ' có tgenabled=' || t.tgenabled::text
                        || ' (cần A = ENABLE ALWAYS; D và R không chạy, O bị bỏ qua khi session_replication_role = replica)'
                   ELSE '' END
              || ' — hàm canh chỉ chạy CÓ ĐIỀU KIỆN hay KHÔNG CHẠY (khoản nợ 79, ADR-036 hàng 8–9/20), nên câu ghi đi qua (UPDATE cột khác / DELETE / '
                 'UPDATE dưới trigger tắt: 1 hàng, không lỗi — đã đo) trong khi bảng vẫn mang tên hàm canh. Vị từ '
                 'chỉ-ghi-thêm không đếm trigger có WHEN/UPDATE OF (bảng chỉ còn trong tập nếu một trigger canh vô '
                 'điều kiện khác cho cùng sự kiện tồn tại) và vẫn đếm trigger tắt. Sửa: một migration mới dựng lại '
                 'trigger KHÔNG WHEN, KHÔNG UPDATE OF, ENABLE ALWAYS (hoặc gọi hàm khác nếu bảng không phải '
                 'chỉ-ghi-thêm).' AS mo_ta
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
         JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal
          AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND $q$ || VI_TU_HAM_CANH_HINH_DANG || $q$
          AND (t.tgqual IS NOT NULL OR t.tgattr::text <> '' OR t.tgenabled <> 'A')$q$;

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
  -- [CR2-T3] Bốn role được canh. Hai role ứng dụng, và hai role đăng nhập được danh sách
  -- trắng cho phép làm thành viên của chúng — xem giải thích (a) ở đầu file: không mở rộng
  -- vùng canh sang hai role đăng nhập thì "GRANT nhom_bat_ky TO app_api_login" và
  -- "GRANT app_api_login TO ke_tan_cong" đều lọt, mà cả hai đều dẫn quyền của app_api ra
  -- ngoài bắc cầu.
  ROLE_CANH constant text :=
    $q$('app_api', 'app_unseal', 'app_api_login', 'app_unseal_login')$q$;

  -- [S1.34 / khoản nợ 78] Tập vai mà một KẾT NỐI ỨNG DỤNG có thể mang làm current_user — theo TÍNH
  -- CHẤT: thành viên BẮC CẦU của app_api/app_unseal (`pg_has_role(r, g, 'MEMBER')` là bắc cầu, và một
  -- role là thành viên của chính nó), trừ superuser — về kỹ thuật là thành viên của mọi role nhưng
  -- không phải một kết nối ứng dụng. [lượt soi 24, INFO-7] Vế thành viên tựa vào BƯỚC 1 (gỡ membership
  -- lạ) để tập này không phình; tự nó vẫn đứng được vì bắc cầu.
  -- [S1.44 / khoản nợ 88 — lượt soi 36 #3, ĐO] ~~'MEMBER'~~ → 'USAGE' HOẶC 'SET': "kết nối ứng dụng mang được làm
  -- current_user" nghĩa là KẾ THỪA quyền của app_api/app_unseal (USAGE) hoặc SET ROLE sang được (SET). Membership
  -- CHỈ-ADMIN (INHERIT FALSE, SET FALSE) không phải kết nối ứng dụng — và PostgreSQL 16 cấp đúng thứ ấy cho vai
  -- CREATEROLE tạo role (grantor ghi là superuser bootstrap, vai ấy không tự REVOKE được). Đo (hồ sơ N3,
  -- migrations.int.test.ts): cụm trống, vai deploy CREATEROLE chạy migrate() đầu tiên ⇒ BƯỚC 0 tạo app_api dưới vai
  -- ấy ⇒ với 'MEMBER' vai deploy lọt tập ⇒ mục "quyền CREATE/TEMP trên database của vai ứng dụng và mọi thành viên"
  -- THU HỒI CREATE của chính chủ database ⇒ 001 gãy "permission denied for database". Tiền tồn từ S1.34, S1.44 chỉ
  -- làm nó lộ ra khi ⑵ dùng chung tập.
  VAI_KET_NOI_UNG_DUNG constant text :=
    $q$SELECT r.rolname FROM pg_roles r
        WHERE NOT r.rolsuper
          AND EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('app_api', 'app_unseal')
                         AND (pg_catalog.pg_has_role(r.oid, g.oid, 'USAGE') OR pg_catalog.pg_has_role(r.oid, g.oid, 'SET')))$q$;

  -- ---- [S1.47 / khoản nợ 87] GUC TUỲ BIẾN (app.*) GẮN SẴN CHO PHIÊN ỨNG DỤNG — PHÁN XÉT, KHÔNG TỰ SỬA ----------------
  -- Lượt soi ngang 33a #1: toàn bộ ranh giới tenant/khách từ 001/027/042/044 là NĂM GUC `app.*` mà policy đọc qua
  -- `current_setting(..., true)` — chưa gắn ⇒ NULL ⇒ 0 hàng (fail-closed). Ba mục "đặt ở mức database" ở trên chỉ ghim
  -- TÊN row_security / session_replication_role / search_path; `ALTER DATABASE … SET app.org_id = <B>` lật [INV-F1]
  -- "chưa gắn ⇒ 0 hàng" thành "⇒ tổ chức B" cho MỌI câu ngoài withTenant (pool.query trần, job, migrate), và
  -- `SET app.guest_session_id` biến mọi phiên thành phiên khách ⇒ 29 policy RESTRICTIVE `_khach` (một mỗi bảng tenant — đếm
  -- từ catalog ở rls-coverage, S1.48; "11" là số CREATE POLICY trong migration, con số thiu) thu hẹp ⇒ câu ghi
  -- của người mua 0 hàng không lỗi (ADR-036). Đo (test khoản 87, PostgreSQL 16): chủ database KHÔNG superuser bị 42501
  -- khi SET lẫn RESET một GUC placeholder ở mức database — trừ khi được `GRANT SET ON PARAMETER` (PG15+, nhánh ⒟) —
  -- và `ALTER ROLE … RESET ALL` dưới vai không superuser GIỮ IM LẶNG phần tử placeholder (guc.c skipIfNoPermissions):
  -- bốn mục RESET ALL ở dưới chỉ "tự chữa" trọn khi vai deploy là superuser hay có SET trên tham số; nếu không, mục
  -- RESET ALL và mục này cùng đỏ, một nguyên nhân (lượt soi 39 NHẸ-3, đo). Vì thế mục này PHÁN XÉT: một mục tự sửa
  -- dưới vai deploy thường sẽ chặn deploy vĩnh viễn (cùng bài học T10-E4). Theo TÍNH CHẤT, không ghim tên `app.`:
  -- GUC tuỳ biến (tên có dấu chấm — placeholder) là thứ duy nhất một policy/hàm của dự án đọc vào. Năm nhánh, cùng
  -- danh sách trắng GUC_TUY_BIEN_KHAI (rỗng):
  --   ⒜ pg_db_role_setting mức database của database hiện tại (setrole = 0) — `ALTER DATABASE … SET`;
  --   ⒝ pg_db_role_setting của một vai kết nối ứng dụng (VAI_KET_NOI_UNG_DUNG ∪ ROLE_CANH), toàn cụm hay IN DATABASE —
  --      dây an toàn kề bốn mục RESET ALL và BƯỚC 1 (chạy TRƯỚC, ở lượt sửa); hàng (setrole 0, setdatabase 0) là
  --      `ALTER ROLE ALL SET` — áp cho mọi vai mọi database, tên riêng trong thông điệp (lượt soi 39 NHẸ-1; ba mục kề
  --      không thấy hàng ấy — khoản 92);
  --   ⒞ CHÍNH phiên deploy: `ALTER SYSTEM SET app.org_id` (postgresql.auto.conf) hay một dòng trong postgresql.conf áp
  --      cho MỌI phiên MỌI database mà pg_db_role_setting sạch (lượt soi 39 NẶNG-2; đo trên PG16: phải SET placeholder
  --      trong phiên trước rồi ALTER SYSTEM + pg_reload_conf). ĐO (thăm dò S1.47): GUC placeholder KHÔNG BAO GIỜ có mặt ở
  --      pg_settings (GUC_NO_SHOW_ALL) — không đọc được `source`/`reset_val`; pg_file_settings thấy postgresql.auto.conf
  --      nhưng chỉ superuser/pg_read_all_settings đọc được (vai deploy N2 thì không). Thứ MỌI vai đọc được là chính giá
  --      trị: `current_setting(tên, true)` trong phiên deploy — nên nhánh này lấy TẬP TÊN theo tính chất (mọi
  --      `current_setting('x.y'…)` trong thân hàm của lược đồ dự án và trong biểu thức policy — CAU_TEN_GUC_DU_AN_DOC),
  --      trừ `app.hardening_che_do` (migrate() đặt trong phiên), và hỏi từng tên: khác rỗng mà không hàng catalog
  --      ⒜/⒝ nào mang nó ⇒ cụm / dòng lệnh / `options=` của chuỗi kết nối deploy. Bắt luôn `options=-c` trên chuỗi kết
  --      nối của CHÍNH phiên deploy; tên có dấu chấm KHÔNG được policy/hàm nào đọc thì nhánh này không hỏi (không
  --      liệt kê được placeholder chưa biết tên — ranh giới của catalog, nói ra);
  --   ⒟ pg_parameter_acl cho một tham số có dấu chấm — bất kể grantee: `GRANT SET ON PARAMETER app.org_id TO vai` cho vai
  --      thường SET/RESET ở mức database và vai (đo), một năng lực BỀN lật [INV-F1] lặp lại; không vai nào cần quyền
  --      bền trên GUC tenant (lượt soi 39 NHẸ-2; CAU_PARAMETER_ACL_SAI chỉ soi grantee PUBLIC/vai ứng dụng);
  --   ⒠ proconfig của hàm trong lược đồ dự án: `CREATE FUNCTION … SET app.org_id = <B>` làm mọi policy trong thân hàm
  --      thấy B, SECURITY INVOKER cũng đủ (lượt soi 39 NHẸ-5) — đòi CREATE trên schema.
  -- GUC vận hành KHÔNG dấu chấm (DateStyle, TimeZone, log_*…) cố ý KHÔNG thuộc mục này — [I3] đòi "một GUC hàng xóm
  -- không được chặn deploy vĩnh viễn". QUYẾT ĐỊNH NÓI RA (lượt soi 39 INFO-1): GUC của extension (pgaudit.log,
  -- auto_explain.*, pg_trgm.*…) đặt ở mức database/vai ứng dụng CŨNG bị mục này bắt cho tới khi khai tên vào
  -- GUC_TUY_BIEN_KHAI — "dấu chấm" là đại diện đo được của tính chất "policy/hàm dự án đọc vào", và mỗi dòng khai là
  -- một câu trả lời nhìn thấy được; giá là một lần sửa mã cho một GUC hàng xóm có dấu chấm. Giá trị KHÔNG in vào
  -- thông điệp (chỉ tên): thông điệp deploy đi vào log.
  -- RANH GIỚI NÓI THẲNG: `options=-c app.org_id=…` trên chuỗi kết nối của PHIÊN ỨNG DỤNG không để lại dấu vết ở đâu
  -- hardening đọc được — ai kiểm soát chuỗi kết nối kiểm soát tiến trình ứng dụng; ~~vai deploy bị `ALTER ROLE
  -- trien_khai SET app.org_id` (superuser) không thuộc tập vai ứng dụng nên không bị thấy~~ [S1.48 / 40a I1] SAI CHIỀU: hàng
  -- ấy không thuộc ⒝ nên nhánh ⒞ (phiên deploy thấy giá trị) KÊU — nhưng chỉ ở BƯỚC 3, SAU khi các migration đánh số cùng
  -- lượt đã chạy dưới B và ghi checksum (40a H1) ⇒ migrate() nay đọc bốn GUC và TỪ CHỐI trước lượt sửa (packages/db/src/
  -- migrate.ts); trigger gọi `set_config(…, true)` giữa giao dịch lật các câu SAU trong
  -- cùng giao dịch — lớp code review; `app.hardening_che_do` gắn sẵn: migrate() đặt lại bằng set_config trong phiên
  -- nên miễn nhiễm, và tên ấy có dấu chấm nên chính mục này bắt (INFO-2). Lớp ứng dụng (S1.47 ⑵): withTenant xoá ba
  -- GUC khách trong MỌI giao dịch và TỪ CHỐI phục vụ khi một trong bốn GUC đã có giá trị lúc mở giao dịch (mặc định
  -- phiên) — ồn ào thay vì im lặng, không tựa vào deploy kế. Mục này chỉ đọc catalog của database hiện tại: `ALTER ROLE app_api
  -- IN DATABASE khac SET` là việc của database ấy.
  GUC_TUY_BIEN_KHAI constant text :=
    $q$(VALUES ('')) AS gk(ten)$q$;

  -- Tập vai mà một hàng pg_db_role_setting "thuộc về phiên ứng dụng": mức database, ALTER ROLE ALL, hay vai kết nối.
  VI_TU_HANG_CAU_HINH_UNG_DUNG constant text :=
    $q$(s.setdatabase = 0 OR d.datname = pg_catalog.current_database())
       AND (s.setrole = 0
            OR r.rolname IN $q$ || ROLE_CANH || $q$
            OR r.rolname IN ($q$ || VAI_KET_NOI_UNG_DUNG || $q$))$q$;

  -- (coalesce viết TRẦN cố ý: COALESCE là cú pháp, `pg_catalog.coalesce(...)` ném 42883 — đo, cùng bài học NULLIF ở 001/027.)
  -- Tập tên GUC mà mã của dự án ĐỌC VÀO — suy từ văn bản: `current_setting('x.y'…)` trong prosrc/prosqlbody của hàm trong
  -- lược đồ dự án (KHÔNG thuộc extension — pg_depend deptype 'e', như (C); lượt soi ngang 40a I3: PostGIS trong public không
  -- được nạp tên vào tập), trong biểu thức USING/WITH CHECK của mọi policy (pg_get_expr in ra `current_setting('app.x'::text,
  -- true)`), DEFAULT cột và CHECK. [S1.48 / 40a H4] Regex không phân biệt hoa/thường, nhận chữ số và khoảng trắng — bản
  -- S1.47 bỏ sót `app.rfq_v2`, `CURRENT_SETTING (`; tên gộp về chữ thường (PostgreSQL gấp tên GUC). Census ở rls-coverage:
  -- mọi literal `current_setting('x.y'` trong db/migrations/*.sql phải thuộc tập này trên lược đồ thật — tập không thiu im.
  CAU_TEN_GUC_DU_AN_DOC constant text :=
    $q$SELECT DISTINCT pg_catalog.lower(m[1]) AS ten
         FROM (SELECT pg_catalog.regexp_matches(pp.prosrc, 'current_setting\s*\(\s*''([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)''', 'gi') AS m
                 FROM pg_proc pp JOIN pg_namespace pn ON pn.oid = pp.pronamespace
                WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'pn') || $q$ AND pp.prosrc IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM pg_depend dp WHERE dp.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND dp.objid = pp.oid AND dp.deptype = 'e')
               UNION ALL
               -- [S1.48 / 40a H4] thân `BEGIN ATOMIC` (PG14+) nằm ở prosqlbody, prosrc rỗng
               SELECT pg_catalog.regexp_matches(pg_catalog.pg_get_function_sqlbody(pp.oid), 'current_setting\s*\(\s*''([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)''', 'gi')
                 FROM pg_proc pp JOIN pg_namespace pn ON pn.oid = pp.pronamespace
                WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'pn') || $q$ AND pp.prosqlbody IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM pg_depend dp WHERE dp.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND dp.objid = pp.oid AND dp.deptype = 'e')
               UNION ALL
               SELECT pg_catalog.regexp_matches(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), 'current_setting\s*\(\s*''([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)''', 'gi')
                 FROM pg_policy pol WHERE pol.polqual IS NOT NULL
               UNION ALL
               SELECT pg_catalog.regexp_matches(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), 'current_setting\s*\(\s*''([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)''', 'gi')
                 FROM pg_policy pol WHERE pol.polwithcheck IS NOT NULL
               UNION ALL
               -- [S1.48 / 40a H4] DEFAULT cột và CHECK trong lược đồ dự án
               SELECT pg_catalog.regexp_matches(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), 'current_setting\s*\(\s*''([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)''', 'gi')
                 FROM pg_attrdef ad JOIN pg_class ac ON ac.oid = ad.adrelid JOIN pg_namespace an ON an.oid = ac.relnamespace
                WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'an') || $q$
               UNION ALL
               SELECT pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(con.oid), 'current_setting\s*\(\s*''([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)''', 'gi')
                 FROM pg_constraint con JOIN pg_namespace cn ON cn.oid = con.connamespace
                WHERE con.contype = 'c' AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'cn') || $q$) x$q$;

  -- ---- [S1.51 / khoản nợ 92] BA GUC VẬN HÀNH GẮN SẴN CHO PHIÊN, TỪ MỌI NGUỒN NGOÀI MỨC DATABASE — PHÁN XÉT ------------
  -- Ba mục "… đặt ở mức database" ở dưới lọc `setrole = 0 AND setdatabase = <db hiện tại>` nên chỉ thấy `ALTER DATABASE …
  -- SET`. Lượt soi 39 NHẸ-1 và lượt soi ngang 40a H5 chỉ ra bốn nguồn khác cùng hiệu lực mà chúng mù: `ALTER ROLE ALL SET`
  -- (hàng `setrole = 0, setdatabase = 0` — áp cho MỌI vai MỌI database), `ALTER ROLE <vai> SET` (kể cả `IN DATABASE`),
  -- postgresql.conf / `ALTER SYSTEM`, và `options=` trên chuỗi kết nối. Hậu quả đã cân: `row_security = off` biến mọi câu
  -- chạm bảng RLS của một vai thường thành LỖI (sự cố sẵn sàng, [fix round 4]); `session_replication_role = replica` bỏ qua
  -- trigger `ENABLE` thường (ADR-036 hàng 8 — lớp ENABLE ALWAYS vẫn giữ); `search_path` là che tên (khoản 78).
  --
  -- ~~HAI NHÁNH~~ ~~[S1.52: BỐN nhánh phán — ⒜⒝ dưới, ⒟⒠ của khoản 95 — cộng nhánh dòng khai thiu]~~ [S1.54: NĂM nhánh phán — ⒜⒝ dưới, ⒟⒠ của khoản 95, ⒡ của khoản 96 — cộng nhánh dòng khai thiu], và nhánh CATALOG là nhánh chịu lực (lượt soi 43 NẶNG-1 bác bản đầu chỉ có nhánh `pg_settings`):
  --   ⒜ CATALOG — mọi hàng `pg_db_role_setting` mang một trong ba tên, TRỪ đúng hàng `(setrole = 0, setdatabase = <db hiện
  --      tại>)` mà ba mục kề sở hữu và tự chữa. Vì sao phải có: `pg_settings` cho GIÁ TRỊ HIỆU LỰC, và PostgreSQL xếp ưu
  --      tiên nguồn (`file < argv < global < database < user < database user < client`), nên một hàng ưu tiên CAO CHE hoàn
  --      toàn một hàng thấp — `ALTER DATABASE d SET row_security = off` che `ALTER ROLE ALL SET row_security = off`, và
  --      `ALTER ROLE <vai deploy> SET row_security = on` (đúng `boot_val`, vai deploy TỰ làm được vì USERSET) che luôn tàn
  --      dư `global`. Lượt sửa xoá hàng che SAU khi `source` của phiên đã chốt ⇒ bản đầu vẫn xanh, và đặt lại hàng che
  --      trước mỗi deploy là mù VĨNH VIỄN. Nhánh catalog không hỏi `source`, không hỏi giá trị hiệu lực, nên miễn nhiễm cả
  --      ưu tiên nguồn lẫn tuổi kết nối — và nó phủ `search_path` mà nhánh ⒝ không bao giờ phủ được.
  --   ⒝ PHIÊN DEPLOY — `pg_settings` cho conf / `ALTER SYSTEM` / dòng lệnh / biến môi trường / `options=`, những nguồn
  --      KHÔNG để lại hàng catalog nào. So với GIÁ TRỊ DỰ ÁN ĐÒI (`GUC_VAN_HANH_DOI`), không so `boot_val`: neo cổng an
  --      ninh vào mặc định BIÊN DỊCH của PostgreSQL là để nó trôi theo bản trong im lặng (lượt soi 43 NHẸ-3).
  --      Nhánh này có HAI vế, vì `reset_val` và `setting` trả lời hai câu khác nhau — ĐO (S1.51, PG16): một câu `SET x = v`
  --      trong phiên đổi `setting` và `source` (hoá `session`) mà KHÔNG đụng `reset_val`; `reset_val` là giá trị phiên
  --      NHẬN LÚC MỞ, tức gộp mọi nguồn đặt TRƯỚC khi phiên bắt đầu.
  --        • vế RESET_VAL = "gắn sẵn lúc mở phiên": `reset_val` khác giá trị dự án đòi.
  --        • vế SETTING = "một câu SET còn sót trong CHÍNH phiên deploy" (`source = 'session'`) — ca nguy hiểm nhất là một
  --          migration đánh số chạy `SET session_replication_role = replica` rồi quên `RESET`: lượt phán xét cuối của
  --          migrate() chạy sau nó, trong cùng phiên. Vế này KHÔNG áp cho `search_path`: chính hardening ghim nó ở BƯỚC 0.
  -- Nguồn `'database'` cố ý đứng ngoài vế RESET_VAL: ba mục kề đã tự chữa nó, và `reset_val` của phiên đang chạy không đổi
  -- theo lượt chữa ấy — bắt luôn thì mọi lượt deploy vừa chữa xong sẽ tự phán mình (đo). Nhánh ⒜ thì vẫn thấy mọi hàng khác,
  -- và `migrate()` đọc lại hai GUC ấy NGAY SAU lượt sửa để chặn vòng migration đánh số của chính lượt này.
  -- `search_path` bị loại khỏi vế RESET_VAL khi `source = 'session'`, và đây là một RANH GIỚI ĐO ĐƯỢC chứ không phải chỗ
  -- trống: sau khi migrate() và BƯỚC 0 ghim `search_path`, `source` hoá `session` trong khi `reset_val` GIỮ NGUYÊN giá trị
  -- độc (đo) — tới BƯỚC 3 thì hàng "mức database vừa được ba mục kề chữa xong" và hàng "postgresql.conf / ALTER SYSTEM"
  -- trông HỆT nhau, không phân biệt được. Nên ca ALTER SYSTEM của `search_path` được chặn ở `migrate()`, nơi đọc được
  -- `source` TRƯỚC lúc ghim; nhánh ⒜ giữ mọi hàng catalog của `search_path`.
  -- Mục PHÁN XÉT, không tự chữa: `ALTER ROLE ALL RESET` và `ALTER SYSTEM RESET` là SUSET — một mục tự sửa sẽ có hậu điều
  -- kiện không bao giờ đúng lại và chặn deploy vĩnh viễn (cùng bài học T10-E4). Cửa ra `GUC_VAN_HANH_KHAI` dùng được NGAY cả
  -- khi lượt trước đã đỏ: tệp `.always` không vào `schema_migrations`, không checksum, đọc lại từ đĩa mỗi lượt.
  -- [lượt soi 44 NẶNG-3 + NHẸ-5] Cột `mau` là phép thử THẬT; `gia_tri` chỉ còn để in ra cho người đọc. Vì sao không so
  -- nguyên văn: ⒜ `session_replication_role = local` bắn ĐÚNG tập trigger như `origin` (chỉ `replica` bỏ qua trigger
  -- `ENABLE` thường) nên chặn deploy vì `local` là chặn không có lý do an ninh; ⒝ tính chất an ninh của `search_path` là
  -- *không schema của người khác đứng TRƯỚC `public`* (khoản 78 — che tên), chứ không phải "bằng đúng mặc định của
  -- PostgreSQL". Bản đầu so nguyên văn `'"$user", public'` và chặn VĨNH VIỄN mọi cụm đặt `search_path = 'public'` —
  -- cấu hình AN TOÀN HƠN, và là chính cách một cụm tự chữa khoản 78 — mà không cửa ra nào (ADR-028 §3, chiều hỏng).
  -- ~~Thứ đứng SAU `public` không thuộc tính chất ấy (`public` thắng ở mọi tên có trong nó, và câu tạo đối tượng không
  -- ghi schema rơi vào schema ĐẦU), nên `'"$user", public, extensions'` đi qua.~~ **[S1.52 / khoản nợ 95]** SAI một vế, và
  -- vế ấy là tiền đề cướp: `public` chỉ thắng ở tên có trong nó KHI pg_catalog không được nêu tên — nêu pg_catalog ở vị
  -- trí SAU thì mọi hàm hệ thống cùng chữ ký bị schema đứng trước che (đo: `SET search_path = public, pg_catalog` cộng
  -- `public.lower(text)` ⇒ `lower('ABC')` ra `CUOP`; cùng tiền đề mà [INV-H21] canh ở mã TypeScript). Nên cột `cam` cấm
  -- pg_catalog ở mọi vị trí trừ vị trí ĐẦU; `'"$user", public, extensions'` vẫn đi qua.
  -- MỘT tính chất cho PHIÊN và cho `proconfig` của hàm (nhánh ⒠): `pg_catalog` đứng một mình và chuỗi rỗng `""` là hai
  -- dạng AN TOÀN NHẤT — mọi tên phải phân giải ở pg_catalog hay phải ghi schema — và 18 hàm của dự án mang đúng dạng đầu
  -- (đo). Ở phiên, hai dạng ấy làm câu viết trần LỖI ồn ào — không che tên, không 0 hàng — nên nằm ngoài ADR-036.
  -- `pg_catalog, pg_temp` cũng được nhận: đó là khuyến nghị của tài liệu PostgreSQL cho SECURITY DEFINER — pg_temp nêu
  -- CUỐI nên không che gì, còn pg_temp không nêu thì được tìm ĐẦU TIÊN cho quan hệ. `pg_temp` đứng trước bị loại.
  -- [lượt soi 45 NHẸ-1] `"$user"` đứng một mình và `pg_catalog, "$user"` cũng được nhận: không schema lạ nào đứng trước
  -- chỗ tên phân giải, và hardening đã cấm schema trùng tên vai kết nối. Bản đầu ĐÒI có `public` nên chặn oan cả hai (đo: PG
  -- lưu đúng `"$user"` và `pg_catalog, "$user"`; còn `"public"` có nháy thì được bỏ nháy thành `public`).
  -- Giữ ĐỒNG BỘ với `searchPathDung` của `packages/db/src/migrate.ts` — hai lớp cố ý, cùng CHUỖI regex, phải sửa cùng nhau.
  -- [lượt soi 45 INFO-1] "Cùng một quy tắc" chỉ đúng trên miền ASCII không xuống dòng: `\s` của JavaScript `/u` nhận cả
  -- khoảng trắng Unicode, còn `.` của ARE nhận cả xuống dòng. Ngoài miền ấy bản TypeScript là bản NGHIÊM hơn — chỉ có thể
  -- chặn oan một giá trị lạ, không thể để lọt dạng cướp (schema lạ trước public trượt `mau` ở cả hai; pg_catalog nêu sau
  -- luôn bị `cam` bắt).
  -- [lượt soi 45 NHẸ-3] `row_security` và `session_replication_role` so KHÔNG phân biệt hoa/thường, và `row_security`
  -- nhận mọi cách viết TRUE mà PostgreSQL chấp nhận: `proconfig` lưu NGUYÊN cách viết (đo: `SET row_security = true` ⇒
  -- `row_security=true`; cả `yes`, `1`, `t`), còn `pg_settings` chuẩn hoá về `on`. Bản đầu so `^on$` nên chặn oan một hàm
  -- đang BẬT row_security.
  GUC_VAN_HANH_DOI constant text :=
    $q$(VALUES ('row_security', 'on', '(?i)^(on|t|tr|tru|true|y|ye|yes|1)$', NULL),
               ('session_replication_role', 'origin', '(?i)^(origin|local)$', NULL),
               ('search_path', '"$user", public',
                '^\s*(""|pg_catalog(\s*,\s*pg_temp)?|(pg_catalog\s*,\s*)?(("\$user"|\$user)(\s*,\s*public(\s*,.*)?)?|public(\s*,.*)?))\s*$',
                ',\s*"?pg_catalog"?\s*(,|$)'))
         AS gd(ten, gia_tri, mau, cam)$q$;

  GUC_VAN_HANH_KHAI constant text :=
    $q$(VALUES ('')) AS gv(ten)$q$;

  -- [lượt soi 44 NẶNG-4] Phạm vi hàng catalog của nhánh ⒜ — ĐÚNG tập mà mục khoản 87 dùng (`VI_TU_HANG_CAU_HINH_UNG_DUNG`),
  -- không rộng hơn. Bản đầu soi MỌI vai MỌI database: `ALTER ROLE dba SET search_path = dba, public` — một quy ước cá nhân
  -- không chạm phiên ứng dụng nào (PostgreSQL chỉ áp `pg_db_role_setting` cho vai ĐĂNG NHẬP của phiên và database đang nối)
  -- — cũng chặn deploy, và cửa ra duy nhất là khai TÊN GUC ⇒ khai xong thì mù luôn với `ALTER ROLE ALL SET search_path`.
  -- Một cửa thoát thô làm hỏng cả phép kiểm là cửa thoát sẽ được dùng. Vế NOT(...) chừa đúng hàng ba mục kề tự chữa.
  VI_TU_HANG_GUC_VAN_HANH constant text :=
    VI_TU_HANG_CAU_HINH_UNG_DUNG || $q$
          AND NOT (s.setrole = 0 AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database()))$q$;

  -- Vị từ của nhánh ⒝, dùng lại NGUYÊN VẸN ở nhánh ⒞ — bản đầu chép tay và chép THIẾU vế SETTING, nên một dòng khai đang
  -- chịu lực bị báo "thiu" (lượt soi 44 NHẸ-6).
  VI_TU_PHIEN_GUC_VAN_HANH_SAI constant text :=
    $q$(
                -- vế RESET_VAL — gắn sẵn lúc MỞ phiên, từ nguồn ngoài mức database.
                ((st.reset_val !~ gd.mau OR (gd.cam IS NOT NULL AND st.reset_val ~ gd.cam))
                   AND st.source NOT IN ('default', 'database')
                   -- Ranh giới đo được, xem chú thích ở trên: sau khi search_path bị ghim thì `source` hoá `session` và
                   -- hàng "mức database vừa chữa xong" không phân biệt được với hàng ALTER SYSTEM — ca sau chặn ở migrate().
                   AND NOT (st.source = 'session' AND st.name = 'search_path'))
                -- vế SETTING — một câu SET còn sót trong CHÍNH phiên deploy (`reset_val` không hề đổi theo SET — đo).
                OR (st.source = 'session' AND st.name <> 'search_path'
                    AND (st.setting !~ gd.mau OR (gd.cam IS NOT NULL AND st.setting ~ gd.cam)))
              )$q$;

  -- [S1.52 / khoản nợ 95] Vị từ của hai nhánh mới, dùng lại NGUYÊN VẸN ở nhánh dòng khai thiu (bài học lượt soi 44 NHẸ-6).
  -- ⒟ `pg_parameter_acl` — một dòng ACL là NĂNG LỰC khi grantee là PUBLIC hay vai không superuser VÀ quyền ấy trao thứ vai
  --    đó chưa có: `ALTER SYSTEM` trên cả ba tên (ghi độc vào postgresql.auto.conf cho MỌI phiên của cụm — đo), còn `SET`
  --    chỉ trên tham số SUSET, suy từ `pg_settings.context = 'superuser'` chứ không ghim tên (đo: chỉ
  --    `session_replication_role`; `GRANT SET` trên `search_path`/`row_security` hợp lệ nhưng không trao gì — ai cũng SET
  --    được chúng). aclexplode in cả quyền của chủ tham số (superuser bootstrap) — vế `NOT rolsuper` loại nó (đo; cùng khuôn
  --    nhánh ⒟ của khoản 87). Chồng lấn với 83⑧ ở grantee PUBLIC/vai ứng dụng là CỐ Ý: tách hai tập theo vị từ của mục kia
  --    thì một thay đổi ở 83⑧ mở lỗ ở đây mà không đột biến nào của mục này đỏ.
  VI_TU_ACL_GUC_VAN_HANH_SAI constant text :=
    $q$(x.grantee = 0 OR NOT gr.rolsuper)
       AND (x.privilege_type = 'ALTER SYSTEM' OR (x.privilege_type = 'SET' AND ps.context = 'superuser'))$q$;

  -- ⒠ `proconfig` — giá trị gắn cho thân hàm trái tính chất ở `GUC_VAN_HANH_DOI`, cùng `mau` và `cam` với phiên. Đo: vai KHÔNG
  --    superuser tạo được hàm mang `search_path = 'ke_gian, public'` hay `row_security = off`; `session_replication_role =
  --    replica` thì 42501 trừ khi được GRANT SET ON PARAMETER; hàm SECURITY DEFINER của superuser mang replica trao nó cho
  --    MỌI người gọi (người gọi thường đọc ra `replica`), bản SECURITY INVOKER thì người gọi thường ăn 42501.
  VI_TU_HAM_GUC_VAN_HANH_SAI constant text :=
    $q$(h.gia_tri !~ gd.mau OR (gd.cam IS NOT NULL AND h.gia_tri ~ gd.cam))$q$;

  -- ⒡ [S1.54 / khoản nợ 96] MÃ CỦA LƯỢC ĐỒ DỰ ÁN GHI một trong ba GUC vận hành vào PHIÊN NGƯỜI GỌI. Nhánh ⒠ đọc `proconfig`
  --    — giá trị PostgreSQL gắn cho thân hàm rồi KHÔI PHỤC khi hàm trả về; câu GHI trong thân thì không ai khôi phục. ĐO
  --    (S1.54, PostgreSQL 16, người gọi là `app_api`): ⑴ hàm SECURITY DEFINER của superuser chạy
  --    `set_config('session_replication_role', 'replica', false)` ⇒ gọi xong thì CHÍNH phiên người gọi ở `replica` — trigger
  --    `ENABLE` thường không chạy và khoá ngoại tới một hàng không tồn tại đi qua, cho mọi câu sau đó trên kết nối ấy — và
  --    `app_api` KHÔNG tự SET/RESET về `origin` được (42501); ⑵ mệnh đề `SET search_path = pg_catalog` trên hàm ấy không khôi
  --    phục replica (PostgreSQL chỉ khôi phục biến được nêu ở mệnh đề SET), một `SET` không LOCAL trong thân vượt cả mệnh đề
  --    SET CÙNG biến, còn `SET LOCAL` trong thân sống tới hết giao dịch; ⑶ hàm SECURITY INVOKER của vai thường đặt
  --    `search_path` bằng `set_config`, bằng `SET` trong plpgsql hay trong thân LANGUAGE sql ⇒ phiên người gọi giữ nó; ⑷ bản
  --    INVOKER đặt replica thì 42501. Bề mặt KHÔNG phải thân hàm cũng ghi được — mỗi cái chạy `set_config` dưới phiên người
  --    đọc/ghi và phiên giữ giá trị (đo): view, DEFAULT của cột, policy, CHECK, thân BEGIN ATOMIC; và `UPDATE pg_settings …
  --    WHERE name = 'search_path'` dưới `app_api`. Tên GUC không phân biệt hoa/thường, kể cả khi có nháy kép (đo:
  --    `SET "SEARCH_PATH" = …`, `set_config('SESSION_REPLICATION_ROLE', …)`).
  --    BỀ MẶT = bề mặt của CAU_TEN_GUC_DU_AN_DOC (thân hàm, BEGIN ATOMIC, policy, DEFAULT, CHECK — kể cả CHECK của domain)
  --    cộng rule/view (`pg_rewrite`) và WHEN của trigger (đo: nhận `set_config`). Biểu thức chỉ mục và cột sinh đòi IMMUTABLE
  --    nên không mang được `set_config` (đo: 42P17); `set_config` không có tên tham số (đo: đối số có tên ném 42883).
  --    BA KHUÔN, tên lấy từ `GUC_VAN_HANH_DOI` (một danh sách): `set_config(` với tên NGUYÊN VĂN là đối số đầu — viết `'…'`,
  --    `E'…'`, `U&'…'` hay dollar-quote, cả dạng deparse `'search_path'::text`; `SET [SESSION|LOCAL] <tên> =|TO …` và
  --    `RESET <tên>|ALL`, tên trần, có nháy kép hay `U&"…"` — RESET cũng là ghi: nó gỡ `SET search_path = public` mà migrate()
  --    ghim ở câu đầu, trong khi `[CR1]`/`[Minor]` cho `rolconfig` của vai deploy mang search_path thù địch; `UPDATE
  --    [pg_catalog.]pg_settings` cùng thân với tên nguyên văn ở BẤT KỲ chỗ nào sau nó (rule của view ấy gọi `set_config(…, false)`).
  --    KHOẢNG CÁCH GIỮA HAI TOKEN là `(?:\s|/\*.*\*/|--[^\n]*\n)*` — khoảng trắng HOẶC chú thích. ~~Không bỏ chú thích trước khi
  --    so: bỏ `--` hay `/* */` bằng regex mở đường giấu một lời gọi thật giữa hai chuỗi `'/*'` và `'*/'`; một chú thích trùng
  --    khuôn thì ĐỎ ồn ào và có cửa ra — viết lại chú thích (ADR-028 §3).~~ [S1.54 / lượt soi 47 CAO-1 + NẶNG-1] Câu gạch đúng
  --    một nửa: không LỘT chú thích thì không bị giấu lời gọi giữa `'/*'` và `'*/'`, nhưng khuôn bản đầu chỉ nhận KHOẢNG TRẮNG
  --    giữa token trong khi `prosrc` là văn bản THÔ — đo: `set_config/**/(…)`, `set_config` rồi chú thích dòng rồi `(…)`,
  --    `SET/* a /* b */ c */search_path = …`, `RESET/**/search_path`, `UPDATE/**/pg_catalog.pg_settings /* ; */ SET …`, và tên
  --    viết `$x$search_path$x$`, `U&'search_path'`, `U&"search_path"` đều được PostgreSQL nhận và đều GHI vào phiên, mà bản đầu
  --    không thấy. Bản hai coi chú thích, kể cả chú thích lồng (`.*` tham), là khoảng cách, và vẫn không lột gì khỏi văn bản;
  --    engine ARE không quay lui thảm hoạ (đo: thân ~100 KB với 20 000 dòng chú thích, ba khuôn, 48 ms). Bề mặt deparse vốn
  --    đã chuẩn hoá. Đổi có chủ đích ở khuôn UPDATE: bản đầu dừng ở `;` đầu tiên nên một `;` trong chú thích làm nó mù; bản hai
  --    quét tới hết thân, nên một thân vừa UPDATE pg_settings vừa mang tên nguyên văn ở câu khác cũng bị nêu, và nhãn tên có
  --    thể là tên khác trong cùng thân (lượt soi 47 NHẸ-3) — chiều kêu nhầm, có cửa ra. Một chuỗi hay chú thích trùng khuôn thì
  --    ĐỎ ồn ào; cửa ra là viết lại chuỗi/chú thích — khai tên vào GUC_VAN_HANH_KHAI tắt MỌI phát hiện ghi của tên ấy nên là cửa
  --    cuối (lượt soi 47 NHẸ-2).
  --    RANH GIỚI, nói ra: tên dựng lúc chạy (`EXECUTE format('SET %s = %s', 'session' || '_replication_role', 'replica')` —
  --    đo: phiên Ở LẠI replica mà không văn bản nào mang tên) và cách viết khác của cùng tên (thoát ký tự trong `E'…'`/`U&'…'`,
  --    ghép chuỗi, bí danh LANGUAGE internal tới set_config_by_name — đo: superuser tạo được và nó ghi vào phiên, vai thường
  --    42501) không quét được bằng văn bản. Lớp đỡ còn lại là `withTenant` (`packages/tenancy/src/with-tenant.ts`): kiểm
  --    `session_replication_role` trong CÙNG round-trip với COMMIT, rồi đọc lại ba GUC sau giao dịch và huỷ kết nối nhiễm — và
  --    nó CHỈ đỡ giao dịch của chính nó: mã dùng pool ngoài `withTenant` không có lớp nào cho các cách viết ấy (khoản 99).
  CAU_MA_GHI_GUC_VAN_HANH constant text :=
    $q$SELECT DISTINCT x.vat, w.dang, pg_catalog.lower(w.ten) AS ten
         FROM (SELECT 'hàm ' || pn.nspname || '.' || pp.proname || '(' || pg_catalog.pg_get_function_identity_arguments(pp.oid) || ')' AS vat,
                      pn.nspname, 'pg_catalog.pg_proc'::pg_catalog.regclass AS lop, pp.oid AS chu, pp.prosrc AS van_ban
                 FROM pg_proc pp JOIN pg_namespace pn ON pn.oid = pp.pronamespace
               UNION ALL
               SELECT 'hàm ' || pn.nspname || '.' || pp.proname || '(' || pg_catalog.pg_get_function_identity_arguments(pp.oid) || ') (BEGIN ATOMIC)',
                      pn.nspname, 'pg_catalog.pg_proc'::pg_catalog.regclass, pp.oid, pg_catalog.pg_get_function_sqlbody(pp.oid)
                 FROM pg_proc pp JOIN pg_namespace pn ON pn.oid = pp.pronamespace
                WHERE pp.prosqlbody IS NOT NULL
               UNION ALL
               SELECT 'policy ' || pg_catalog.quote_ident(pol.polname) || ' trên ' || pn.nspname || '.' || pc.relname || ' (USING)',
                      pn.nspname, 'pg_catalog.pg_class'::pg_catalog.regclass, pc.oid, pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
                 FROM pg_policy pol JOIN pg_class pc ON pc.oid = pol.polrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
                WHERE pol.polqual IS NOT NULL
               UNION ALL
               SELECT 'policy ' || pg_catalog.quote_ident(pol.polname) || ' trên ' || pn.nspname || '.' || pc.relname || ' (WITH CHECK)',
                      pn.nspname, 'pg_catalog.pg_class'::pg_catalog.regclass, pc.oid, pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
                 FROM pg_policy pol JOIN pg_class pc ON pc.oid = pol.polrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
                WHERE pol.polwithcheck IS NOT NULL
               UNION ALL
               SELECT 'DEFAULT của cột ' || pn.nspname || '.' || pc.relname || '.' || pg_catalog.quote_ident(pa.attname),
                      pn.nspname, 'pg_catalog.pg_class'::pg_catalog.regclass, pc.oid, pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
                 FROM pg_attrdef ad JOIN pg_class pc ON pc.oid = ad.adrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
                 JOIN pg_attribute pa ON pa.attrelid = ad.adrelid AND pa.attnum = ad.adnum
               UNION ALL
               SELECT 'CHECK ' || pg_catalog.quote_ident(con.conname)
                      || CASE WHEN con.conrelid <> 0 THEN ' của bảng ' || cn.nspname || '.' || pc.relname
                              ELSE ' của domain ' || cn.nspname || '.' || ty.typname END,
                      cn.nspname,
                      CASE WHEN con.conrelid <> 0 THEN 'pg_catalog.pg_class'::pg_catalog.regclass ELSE 'pg_catalog.pg_type'::pg_catalog.regclass END,
                      CASE WHEN con.conrelid <> 0 THEN con.conrelid ELSE con.contypid END,
                      pg_catalog.pg_get_constraintdef(con.oid)
                 FROM pg_constraint con JOIN pg_namespace cn ON cn.oid = con.connamespace
                 LEFT JOIN pg_class pc ON pc.oid = con.conrelid
                 LEFT JOIN pg_type ty ON ty.oid = con.contypid
                WHERE con.contype = 'c'
               UNION ALL
               SELECT CASE WHEN r.rulename = '_RETURN' THEN 'view ' ELSE 'rule ' || pg_catalog.quote_ident(r.rulename) || ' trên ' END
                      || pn.nspname || '.' || pc.relname,
                      pn.nspname, 'pg_catalog.pg_class'::pg_catalog.regclass, pc.oid, pg_catalog.pg_get_ruledef(r.oid)
                 FROM pg_rewrite r JOIN pg_class pc ON pc.oid = r.ev_class JOIN pg_namespace pn ON pn.oid = pc.relnamespace
               UNION ALL
               SELECT 'trigger ' || pg_catalog.quote_ident(tg.tgname) || ' trên ' || pn.nspname || '.' || pc.relname || ' (WHEN)',
                      pn.nspname, 'pg_catalog.pg_class'::pg_catalog.regclass, pc.oid, pg_catalog.pg_get_triggerdef(tg.oid)
                 FROM pg_trigger tg JOIN pg_class pc ON pc.oid = tg.tgrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
                WHERE NOT tg.tgisinternal AND tg.tgqual IS NOT NULL) x
         -- [lượt soi 47 CAO-1] `cach`: khoảng cách giữa hai token — khoảng trắng HOẶC chú thích, kể cả lồng. [NẶNG-1] `ten_lit`:
         -- tên nguyên văn viết '…', E'…', U&'…' hay dollar-quote — hai nhóm bắt, đọc bằng coalesce.
         CROSS JOIN (SELECT pg_catalog.string_agg(gd.ten, '|') AS ten_re,
                            '(?:\s|/\*.*\*/|--[^\n]*\n)' AS cach
                       FROM $q$ || GUC_VAN_HANH_DOI || $q$) ds
         CROSS JOIN LATERAL (SELECT '(?:(?:U&|E)?''(' || ds.ten_re || ')''|\$\w*\$(' || ds.ten_re || ')\$\w*\$)' AS ten_lit) dl
         CROSS JOIN LATERAL (
               SELECT 'set_config' AS dang, coalesce(m[1], m[2]) AS ten
                 FROM pg_catalog.regexp_matches(x.van_ban,
                        '\mset_config"?' || ds.cach || '*\(' || ds.cach || '*' || dl.ten_lit, 'gi') m
               UNION ALL
               SELECT CASE WHEN m[1] IS NULL THEN 'RESET' ELSE 'SET' END, coalesce(m[1], m[2])
                 FROM pg_catalog.regexp_matches(x.van_ban,
                        '\m(?:SET' || ds.cach || '+(?:(?:SESSION|LOCAL)' || ds.cach || '+)?(?:U&)?"?(' || ds.ten_re || ')"?' || ds.cach
                        || '*(?:=|\mTO\M)|RESET' || ds.cach || '+(?:U&)?"?(all|' || ds.ten_re || ')\M)',
                        'gi') m
               UNION ALL
               SELECT 'UPDATE pg_settings', coalesce(m[1], m[2])
                 FROM pg_catalog.regexp_matches(x.van_ban,
                        '\mUPDATE' || ds.cach || '+(?:ONLY' || ds.cach || '+)?(?:"?pg_catalog"?' || ds.cach || '*\.' || ds.cach
                        || '*)?"?pg_settings\M"?.*' || dl.ten_lit, 'gi') m) w
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'x') || $q$
          AND NOT EXISTS (SELECT 1 FROM pg_depend de WHERE de.classid = x.lop AND de.objid = x.chu AND de.deptype = 'e')$q$;

  CAU_GUC_VAN_HANH_GAN_SAN constant text :=
    $q$SELECT coalesce(
                CASE WHEN s.setrole = 0 AND s.setdatabase = 0 THEN 'mọi vai, mọi database (ALTER ROLE ALL)'
                     WHEN s.setrole = 0 THEN 'database ' || pg_catalog.quote_ident(d.datname)
                     ELSE 'vai ' || pg_catalog.quote_ident(r.rolname)
                          || CASE WHEN s.setdatabase = 0 THEN ' (toàn cụm)' ELSE ' IN DATABASE ' || pg_catalog.quote_ident(d.datname) END
                END,
                -- [lượt soi 44 INFO-4] Một vế NULL làm cả `mo_ta` NULL và `string_agg` nuốt hàng ⇒ BƯỚC 3 in "SAI ()" —
                -- đúng chế độ hỏng mà lượt soi 39 NHẸ-1 đã bắt một lần. Không xảy ra với catalog nhất quán; vẫn chắn.
                'hàng pg_db_role_setting (setrole=' || s.setrole || ', setdatabase=' || s.setdatabase || ')')
              || ': GUC vận hành ' || g.ten || ' gắn sẵn ở catalog — mọi phiên mở sau nó khởi đầu với giá trị ấy, và ba mục '
                 '"đặt ở mức database" chỉ tự chữa đúng hàng (setrole = 0, database hiện tại) nên hàng này sống qua mọi lượt '
                 'deploy (khoản 92). row_security=off làm mọi câu chạm bảng RLS của vai thường báo LỖI; '
                 'session_replication_role=replica bỏ qua trigger ENABLE thường; search_path là che tên (khoản 78). '
                 'Sửa: ALTER ROLE ALL RESET <guc> / ALTER ROLE <vai> [IN DATABASE <db>] RESET <guc>; hoặc khai tên vào '
                 'GUC_VAN_HANH_KHAI kèm lý do' AS mo_ta
         FROM pg_db_role_setting s
         LEFT JOIN pg_database d ON d.oid = s.setdatabase
         LEFT JOIN pg_roles r ON r.oid = s.setrole
         CROSS JOIN LATERAL (SELECT pg_catalog.split_part(c, '=', 1) AS ten FROM pg_catalog.unnest(s.setconfig) c) g
        WHERE g.ten IN (SELECT gd.ten FROM $q$ || GUC_VAN_HANH_DOI || $q$)
          -- Chỉ hàng ÁP ĐƯỢC cho một phiên ỨNG DỤNG của database này — xem `VI_TU_HANG_GUC_VAN_HANH`. ĐO (S1.51): bản
          -- đầu không có vế phạm vi database và `ALTER ROLE r IN DATABASE <db khác> SET row_security = off` — một hàng
          -- KHÔNG phiên nào ở đây nhận được — vẫn bị nêu ⇒ chặn deploy trên một cụm hợp lệ (ADR-028 §3).
          AND $q$ || VI_TU_HANG_GUC_VAN_HANH || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || GUC_VAN_HANH_KHAI || $q$ WHERE gv.ten = g.ten)
       UNION ALL
       SELECT 'phiên deploy hiện tại (nguồn ' || st.source || ')'
              || ': GUC vận hành ' || st.name || ' không mang giá trị dự án đòi — nguồn không để lại hàng catalog nào '
                 '(postgresql.conf, ALTER SYSTEM, dòng lệnh, biến môi trường, options= trên chuỗi kết nối), hay một câu SET '
                 'còn sót trong phiên (khoản 92). Sửa: ALTER SYSTEM RESET <guc> + pg_reload_conf(), gỡ dòng cấu hình / tham '
                 'số kết nối rồi chạy lại trên kết nối mới, hoặc RESET câu SET ấy; hoặc khai tên vào GUC_VAN_HANH_KHAI' AS mo_ta
         FROM pg_catalog.pg_settings st
         JOIN $q$ || GUC_VAN_HANH_DOI || $q$ ON gd.ten = st.name
        WHERE $q$ || VI_TU_PHIEN_GUC_VAN_HANH_SAI || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || GUC_VAN_HANH_KHAI || $q$ WHERE gv.ten = st.name)
       UNION ALL
       -- ⒟ [S1.52 / khoản nợ 95] pg_parameter_acl — xem VI_TU_ACL_GUC_VAN_HANH_SAI.
       SELECT 'quyền ' || x.privilege_type || ' trên tham số ' || pa.parname || ' cấp cho '
              || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(gr.rolname) END
              || ' (pg_parameter_acl): GUC vận hành đặt được bởi vai không superuser — '
              || CASE WHEN x.privilege_type = 'ALTER SYSTEM'
                      THEN 'ALTER SYSTEM ghi vào postgresql.auto.conf, áp cho MỌI phiên của cụm sau pg_reload_conf()'
                      ELSE 'SET trên tham số SUSET lật tiền đề "chỉ superuser đặt được" mà lớp ENABLE ALWAYS tựa vào (ADR-036 hàng 8)'
                 END
              || ' (khoản 95). Sửa: REVOKE ' || x.privilege_type || ' ON PARAMETER ' || pa.parname || ' FROM … bằng SUPERUSER; '
                 'hoặc khai tên vào GUC_VAN_HANH_KHAI kèm lý do' AS mo_ta
         FROM pg_catalog.pg_parameter_acl pa
         CROSS JOIN LATERAL pg_catalog.aclexplode(pa.paracl) x
         LEFT JOIN pg_roles gr ON gr.oid = x.grantee
         JOIN pg_catalog.pg_settings ps ON ps.name = pa.parname
        WHERE pa.parname IN (SELECT gd.ten FROM $q$ || GUC_VAN_HANH_DOI || $q$)
          AND $q$ || VI_TU_ACL_GUC_VAN_HANH_SAI || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || GUC_VAN_HANH_KHAI || $q$ WHERE gv.ten = pa.parname)
       UNION ALL
       -- ⒠ [S1.52 / khoản nợ 95] proconfig của hàm trong lược đồ dự án — xem VI_TU_HAM_GUC_VAN_HANH_SAI.
       SELECT 'hàm ' || pn.nspname || '.' || pp.proname || '(' || pg_catalog.pg_get_function_identity_arguments(pp.oid) || ') (proconfig)'
              || ': GUC vận hành ' || h.ten || ' gắn cho thân hàm với giá trị trái tính chất dự án đòi — '
              || CASE h.ten
                   WHEN 'search_path' THEN 'tên viết trần trong thân hàm phân giải qua schema lạ (che tên, khoản 78), hay pg_catalog nêu sau là tiền đề cướp hàm hệ thống'
                   WHEN 'session_replication_role' THEN 'thân hàm chạy dưới replica nên trigger ENABLE thường bị bỏ qua, và hàm SECURITY DEFINER của superuser trao nó cho MỌI người gọi'
                   ELSE 'row_security=off làm câu chạm bảng RLS trong thân hàm báo LỖI thay vì lọc'
                 END
              || ' (khoản 95). Sửa: ALTER FUNCTION … RESET ' || h.ten || ' hay SET về giá trị đúng trong một migration mới (chủ hàm); '
                 'hoặc khai tên vào GUC_VAN_HANH_KHAI kèm lý do' AS mo_ta
         FROM pg_proc pp
         JOIN pg_namespace pn ON pn.oid = pp.pronamespace
         CROSS JOIN LATERAL (SELECT pg_catalog.split_part(c, '=', 1) AS ten,
                                    pg_catalog.substr(c, pg_catalog.strpos(c, '=') + 1) AS gia_tri
                               FROM pg_catalog.unnest(pp.proconfig) c) h
         JOIN $q$ || GUC_VAN_HANH_DOI || $q$ ON gd.ten = h.ten
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'pn') || $q$
          AND NOT EXISTS (SELECT 1 FROM pg_depend dp WHERE dp.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                                                       AND dp.objid = pp.oid AND dp.deptype = 'e')
          AND $q$ || VI_TU_HAM_GUC_VAN_HANH_SAI || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || GUC_VAN_HANH_KHAI || $q$ WHERE gv.ten = h.ten)
       UNION ALL
       -- ⒡ [S1.54 / khoản nợ 96] mã của lược đồ dự án ghi GUC vận hành vào phiên người gọi — xem CAU_MA_GHI_GUC_VAN_HANH.
       SELECT w.vat || ': ghi GUC vận hành ' || gd.ten || ' bằng ' || w.dang
              || ' — giá trị vào PHIÊN NGƯỜI GỌI và sống sau khi hàm hay biểu thức trả về, trên cả kết nối pool: '
              || CASE gd.ten
                   WHEN 'session_replication_role' THEN 'replica bỏ qua trigger ENABLE thường và khoá ngoại cho mọi câu sau đó, và vai ứng dụng không tự SET/RESET về origin được'
                   WHEN 'search_path' THEN 'che tên cho mọi câu viết trần sau đó (khoản 78), và RESET gỡ search_path mà migrate() ghim'
                   ELSE 'row_security=off làm mọi câu chạm bảng RLS của vai thường báo LỖI'
                 END
              || ' (khoản 96). Sửa: dời giá trị sang mệnh đề SET của hàm — PostgreSQL khôi phục khi hàm trả về, nhánh ⒠ phán giá trị — '
                 'hay bỏ khỏi biểu thức, trong một migration mới; một chuỗi hay chú thích trùng khuôn thì viết lại; hoặc khai tên vào '
                 'GUC_VAN_HANH_KHAI kèm lý do' AS mo_ta
         FROM ($q$ || CAU_MA_GHI_GUC_VAN_HANH || $q$) w
         JOIN $q$ || GUC_VAN_HANH_DOI || $q$ ON gd.ten = w.ten OR w.ten = 'all'
        WHERE NOT EXISTS (SELECT 1 FROM $q$ || GUC_VAN_HANH_KHAI || $q$ WHERE gv.ten = gd.ten)
       UNION ALL
       SELECT 'khai GUC vận hành ' || gv.ten || ' được gắn sẵn (khoản 92) mà không hàng catalog nào mang nó và phiên deploy '
              'thấy nó đúng giá trị dự án đòi, không pg_parameter_acl hay proconfig hàm nào trái tính chất mang nó, và không mã nào của lược đồ dự án ghi nó (khoản 96) — dòng khai thiu' AS mo_ta
         FROM $q$ || GUC_VAN_HANH_KHAI || $q$
        -- chắn hàng sentinel ('') — cùng khuôn lượt soi 32 NHẸ-2.
        WHERE gv.ten <> ''
          AND NOT EXISTS (SELECT 1 FROM pg_db_role_setting s
                           LEFT JOIN pg_database d ON d.oid = s.setdatabase
                           LEFT JOIN pg_roles r ON r.oid = s.setrole
                           WHERE $q$ || VI_TU_HANG_GUC_VAN_HANH || $q$
                             AND EXISTS (SELECT 1 FROM pg_catalog.unnest(s.setconfig) c WHERE pg_catalog.split_part(c, '=', 1) = gv.ten))
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_settings st
                           JOIN $q$ || GUC_VAN_HANH_DOI || $q$ ON gd.ten = st.name
                          WHERE st.name = gv.ten AND $q$ || VI_TU_PHIEN_GUC_VAN_HANH_SAI || $q$)
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_parameter_acl pa
                           CROSS JOIN LATERAL pg_catalog.aclexplode(pa.paracl) x
                           LEFT JOIN pg_roles gr ON gr.oid = x.grantee
                           JOIN pg_catalog.pg_settings ps ON ps.name = pa.parname
                          WHERE pa.parname = gv.ten AND $q$ || VI_TU_ACL_GUC_VAN_HANH_SAI || $q$)
          AND NOT EXISTS (SELECT 1 FROM pg_proc pp
                           JOIN pg_namespace pn ON pn.oid = pp.pronamespace
                           CROSS JOIN LATERAL (SELECT pg_catalog.split_part(c, '=', 1) AS ten,
                                                      pg_catalog.substr(c, pg_catalog.strpos(c, '=') + 1) AS gia_tri
                                                 FROM pg_catalog.unnest(pp.proconfig) c) h
                           JOIN $q$ || GUC_VAN_HANH_DOI || $q$ ON gd.ten = h.ten
                          WHERE h.ten = gv.ten
                            AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'pn') || $q$
                            AND NOT EXISTS (SELECT 1 FROM pg_depend dp WHERE dp.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                                                                         AND dp.objid = pp.oid AND dp.deptype = 'e')
                            AND $q$ || VI_TU_HAM_GUC_VAN_HANH_SAI || $q$)
          -- [S1.54 / khoản nợ 96] Một tên khai để miễn nhánh ⒡ không được bị báo thiu — cùng hằng, không chép tay (lượt soi 44 NHẸ-6).
          AND NOT EXISTS (SELECT 1 FROM ($q$ || CAU_MA_GHI_GUC_VAN_HANH || $q$) w WHERE w.ten = gv.ten OR w.ten = 'all')$q$;

  CAU_GUC_TUY_BIEN_GAN_SAN constant text :=
    $q$SELECT CASE WHEN s.setrole = 0 AND s.setdatabase = 0 THEN 'mọi vai, mọi database (ALTER ROLE ALL)'
                   WHEN s.setrole = 0 THEN 'database ' || pg_catalog.quote_ident(d.datname)
                   ELSE 'vai ' || pg_catalog.quote_ident(r.rolname)
                        || CASE WHEN s.setdatabase = 0 THEN ' (toàn cụm)' ELSE ' IN DATABASE ' || pg_catalog.quote_ident(d.datname) END
              END
              || ': GUC tuỳ biến ' || g.ten || ' gắn sẵn — mọi phiên mở sau nó (kể cả câu ngoài withTenant, job, migrate) '
                 'khởi đầu với giá trị ấy thay vì NULL; policy tenant/khách đọc GUC này (khoản 87). Sửa: ALTER DATABASE … RESET / '
                 'ALTER ROLE … RESET / ALTER ROLE ALL RESET bằng SUPERUSER (hay GRANT SET ON PARAMETER TẠM cho một vai, RESET, rồi '
                 'REVOKE trong cùng phiên — quyền bền bị nhánh pg_parameter_acl của chính mục này phán; chủ database thường bị 42501, và '
                 'RESET ALL dưới vai thường giữ im lặng phần tử này — đo); hoặc khai tên vào GUC_TUY_BIEN_KHAI kèm lý do' AS mo_ta
         FROM pg_db_role_setting s
         LEFT JOIN pg_database d ON d.oid = s.setdatabase
         LEFT JOIN pg_roles r ON r.oid = s.setrole
         CROSS JOIN LATERAL (SELECT pg_catalog.split_part(c, '=', 1) AS ten FROM pg_catalog.unnest(s.setconfig) c) g
        WHERE g.ten LIKE '%.%'
          AND $q$ || VI_TU_HANG_CAU_HINH_UNG_DUNG || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || GUC_TUY_BIEN_KHAI || $q$ WHERE gk.ten = g.ten)
       UNION ALL
       SELECT 'phiên deploy hiện tại: GUC ' || t.ten || ' có giá trị mà không hàng pg_db_role_setting nào của phiên ứng dụng mang nó '
              '— cụm (postgresql.conf, ALTER SYSTEM/postgresql.auto.conf), dòng lệnh, options= của chuỗi kết nối deploy, ALTER ROLE '
              '<vai deploy> SET, hay phiên này mở trong lúc một cấu hình đã bị RESET sau đó (giá trị mức database/vai áp lúc mở phiên và '
              'sống tới khi kết nối lại): mọi '
              'phiên cùng nguồn khởi đầu với giá trị ấy; policy/hàm dự án đọc GUC này (khoản 87). Sửa: ALTER SYSTEM RESET rồi '
              'pg_reload_conf(), gỡ dòng cấu hình / tham số kết nối, hay chạy lại migrate() trên kết nối mới; hoặc khai tên vào '
              'GUC_TUY_BIEN_KHAI kèm lý do' AS mo_ta
         FROM ($q$ || CAU_TEN_GUC_DU_AN_DOC || $q$) t
        WHERE t.ten <> 'app.hardening_che_do'
          AND coalesce(pg_catalog.current_setting(t.ten, true), '') <> ''
          AND NOT EXISTS (SELECT 1 FROM pg_db_role_setting s
                            LEFT JOIN pg_database d ON d.oid = s.setdatabase
                            LEFT JOIN pg_roles r ON r.oid = s.setrole
                           WHERE $q$ || VI_TU_HANG_CAU_HINH_UNG_DUNG || $q$
                             AND EXISTS (SELECT 1 FROM pg_catalog.unnest(s.setconfig) c WHERE pg_catalog.split_part(c, '=', 1) = t.ten))
          AND NOT EXISTS (SELECT 1 FROM $q$ || GUC_TUY_BIEN_KHAI || $q$ WHERE gk.ten = t.ten)
       UNION ALL
       -- Chỉ grantee KHÔNG superuser (hay PUBLIC): aclexplode in cả quyền của chủ tham số (superuser bootstrap) — đo.
       SELECT 'quyền trên tham số ' || pa.parname || ' cấp cho '
              || (SELECT pg_catalog.string_agg(DISTINCT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(gr.rolname) END, ', ')
                    FROM pg_catalog.aclexplode(pa.paracl) x LEFT JOIN pg_roles gr ON gr.oid = x.grantee
                   WHERE x.grantee = 0 OR NOT gr.rolsuper)
              || ' (pg_parameter_acl): GUC tuỳ biến đặt được ở mức database/vai bởi vai không superuser — năng lực bền lật ranh giới '
                 'tenant/khách (khoản 87). Sửa: REVOKE SET, ALTER SYSTEM ON PARAMETER … FROM … bằng SUPERUSER; hoặc khai tên vào '
                 'GUC_TUY_BIEN_KHAI kèm lý do' AS mo_ta
         FROM pg_catalog.pg_parameter_acl pa
        WHERE pa.parname LIKE '%.%'
          AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(pa.paracl) x LEFT JOIN pg_roles gr ON gr.oid = x.grantee
                       WHERE x.grantee = 0 OR NOT gr.rolsuper)
          AND NOT EXISTS (SELECT 1 FROM $q$ || GUC_TUY_BIEN_KHAI || $q$ WHERE gk.ten = pa.parname)
       UNION ALL
       SELECT 'hàm ' || pn.nspname || '.' || pp.proname || '(' || pg_catalog.pg_get_function_identity_arguments(pp.oid) || ') (proconfig)'
              || ': GUC tuỳ biến ' || h.ten || ' gắn sẵn cho thân hàm — mọi policy trong thân hàm thấy giá trị ấy, SECURITY INVOKER '
                 'cũng đủ (khoản 87). Sửa: ALTER FUNCTION … RESET ' || h.ten || ' trong một migration mới (chủ hàm); hoặc khai tên vào '
                 'GUC_TUY_BIEN_KHAI kèm lý do' AS mo_ta
         FROM pg_proc pp
         JOIN pg_namespace pn ON pn.oid = pp.pronamespace
         CROSS JOIN LATERAL (SELECT pg_catalog.split_part(c, '=', 1) AS ten FROM pg_catalog.unnest(pp.proconfig) c) h
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'pn') || $q$
          AND NOT EXISTS (SELECT 1 FROM pg_depend dp WHERE dp.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND dp.objid = pp.oid AND dp.deptype = 'e')
          AND h.ten LIKE '%.%'
          AND NOT EXISTS (SELECT 1 FROM $q$ || GUC_TUY_BIEN_KHAI || $q$ WHERE gk.ten = h.ten)
       UNION ALL
       SELECT 'khai GUC tuỳ biến ' || gk.ten || ' (khoản 87) mà không hàng nào ở pg_db_role_setting của phiên ứng dụng, phiên deploy '
              'không thấy giá trị, không pg_parameter_acl hay proconfig hàm dự án nào mang nó — dòng khai thiu' AS mo_ta
         FROM $q$ || GUC_TUY_BIEN_KHAI || $q$
        -- chắn hàng sentinel ('') — cùng khuôn lượt soi 32 NHẸ-2.
        WHERE gk.ten <> ''
          AND NOT EXISTS (SELECT 1 FROM pg_db_role_setting s
                            LEFT JOIN pg_database d ON d.oid = s.setdatabase
                            LEFT JOIN pg_roles r ON r.oid = s.setrole
                           WHERE $q$ || VI_TU_HANG_CAU_HINH_UNG_DUNG || $q$
                             AND EXISTS (SELECT 1 FROM pg_catalog.unnest(s.setconfig) c WHERE pg_catalog.split_part(c, '=', 1) = gk.ten))
          AND coalesce(pg_catalog.current_setting(gk.ten, true), '') = ''
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_parameter_acl pa
                           WHERE pa.parname = gk.ten
                             AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(pa.paracl) x LEFT JOIN pg_roles gr ON gr.oid = x.grantee
                                          WHERE x.grantee = 0 OR NOT gr.rolsuper))
          AND NOT EXISTS (SELECT 1 FROM pg_proc pp JOIN pg_namespace pn ON pn.oid = pp.pronamespace
                           WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'pn') || $q$
                             AND EXISTS (SELECT 1 FROM pg_catalog.unnest(pp.proconfig) c WHERE pg_catalog.split_part(c, '=', 1) = gk.ten))$q$;

  -- [S1.36, lượt soi 25b #13] Thân câu "quan hệ trùng tên public trong một schema mà vai có USAGE" — MỘT
  -- bản, dùng ở cả hậu điều kiện lẫn mô tả của mục ấy; bản S1.34 chép chín dòng hai lần, đúng kiểu trôi mà
  -- BANG_GOC_TENANT đã đo.
  -- ---- [S1.38 / khoản nợ 83 — nửa RLS ⑴⑵⑶] BA CƠ CHẾ RLS LÀM CÂU GHI TRẢ 0 HÀNG KHÔNG LỖI, TRÊN CỤM ĐÃ DEPLOY
  -- ADR-036 hàng 5, 6, 7 chỉ có tổng điều tra ở test (`db/rls-coverage.int.test.ts`, S1.32). §3⑶ (S1.37) đòi
  -- mục hardening cho mọi cơ chế mà chủ bảng không superuser tạo được và catalog phân biệt được — đo (S1.37):
  -- chủ bảng tạo được policy RESTRICTIVE `USING (false)`, bảng bật RLS không policy (UPDATE dưới app_api
  -- 0 hàng), RLS trên bảng ngoài tenant; migrate() đi qua cả ba. Ba mục dưới đây PHÁN XÉT (ADR-028 §2⑵).
  --
  -- ⑴ MỌI policy trong lược đồ dự án — kể cả trên bảng CHƯA bật RLS (policy trơ; fail-closed, lượt soi 29
  --    INFO-8) — thuộc ĐÚNG MỘT lớp: PHÂN LOẠI theo tính chất, không ghim tên (lượt soi 28 NẶNG-3: ghim
  --    mọi policy theo tên đảo nguyên lý [CR1] và gãy mọi bảng tenant mới):
  --    (a) PERMISSIVE trên bảng tenant — [CR1]/CAU_POLICY_SAI đã soi HÌNH DẠNG (HINH_DANG_CHUAN ∪
  --        NGOAI_LE_HINH_DANG); mục này không soi lại. [lượt soi 29, NHẸ-6] [CR1] KHÔNG khoá vai/lệnh
  --        (HINH_DANG_CHUAN là toàn cục): `ALTER POLICY <bảng>_tenant_isolation TO app_unseal` đi qua [CR1]
  --        — thứ bắt nó là ⑵ (quyền của app_api không còn policy nào phủ);
  --    (b1) RESTRICTIVE khuôn 027: `<bảng>_khach`, FOR ALL, PUBLIC, USING = WITH CHECK = "không phải
  --        phiên khách" — tự nó không mở thêm hàng nào cho ai, nên hợp lệ toàn cục không cần khai;
  --    (b2) RESTRICTIVE khác — ~~SÁU~~ [S1.55] BẢY cột nguyên văn, thêm `nspname` (khoản 98), ở POLICY_RESTRICTIVE_KHAI (tám biến thể của 027 nới
  --        theo một cột cho phiên khách); [CR1] cố ý không soi RESTRICTIVE vì "chỉ thu hẹp" — đúng cho câu
  --        hỏi RÒ, sai cho câu hỏi IM LẶNG: `AS RESTRICTIVE FOR UPDATE USING (false)` làm mọi UPDATE của
  --        app_api ra 0 hàng không lỗi và [CR1] xanh (đo, S1.32);
  --    (c) mọi policy khác (PERMISSIVE trên bảng RLS NGOÀI tenant, …) — ~~BẢY~~ [S1.55] TÁM cột, thêm `nspname`, ở POLICY_KHAC_KHAI.
  --        [lượt soi 48 NẶNG-3] TRỪ PERMISSIVE thuộc VI_TU_PERMISSIVE_CR1_SE_SOI — không khai được, xem hằng ấy.
  --    [S1.55 / khoản nợ 98] (b2) và (c) khớp theo (lược đồ, bảng, policy). Bản trước ghim `public` ở vị từ và hai danh sách
  --    không có cột lược đồ, nên policy trên một bảng RLS ngoài `public` — bảng ấy khai được ở 83⑶ theo (nspname, relname) —
  --    bị nêu mà khai không cứu được: đo, cả PERMISSIVE, RESTRICTIVE lẫn RESTRICTIVE đúng khuôn 027, là ngõ cụt ADR-028 §3.
  --    Gỡ ghim mà KHÔNG thêm cột thì một dòng khai cho `public.x` che luôn policy cùng tên trên `zz.x` — cột lược đồ là bắt
  --    buộc, không phải trang trí — đo: bỏ vế lược đồ ở (b2) hay (c) thì dòng khai của `zz98` che policy cùng tên của `zz98b`.
  --    (b1) vẫn chỉ nhận khuôn 027 ở `public`, nơi 027 dựng nó (đọc: 027 chỉ dựng `<bảng>_khach` ở public); ngoài `public` khuôn ấy
  --    đi đường khai (b2) — [lượt soi 48 NẶNG-1/2] cổng ở rls-coverage nay soi gương đúng vị từ (b1) và sinh được NULL, nên lối ấy đi được.
  --    Đỏ cả hai chiều: một dòng khai mà CSDL không còn policy như thế cũng chặn deploy.
  --    GIÁ (ADR-036 §4 chỉ nhận ở test, nay ở cả hardening): biểu thức khai NGUYÊN VĂN `pg_get_expr` —
  --    đổi phiên bản PostgreSQL có thể đổi deparse ⇒ chặn deploy tới khi chép lại biểu thức. Cố ý.
  --    Bản test giữ CÙNG danh sách (POLICY_RESTRICTIVE_DA_KHAI) và có cổng đòi hai bản khớp.
  -- ⑵ PHỦ LỆNH: mỗi (bảng RLS, vai ứng dụng, quyền SELECT/INSERT/UPDATE/DELETE đã cấp — mức bảng hay cột,
  --    đích danh hay qua PUBLIC) phải có một policy PERMISSIVE áp cho vai ấy (hoặc PUBLIC) ở lệnh ấy (hoặc
  --    ALL) — mặc-định-từ-chối của RLS là 0 hàng không lỗi. KHÔNG miễn con (phân mảnh/INHERITS) của bảng
  --    tenant: [lượt soi 29, NẶNG-2] bản đầu miễn LA_CUA_BANG_TENANT với lý do "đọc thẳng con fail-closed là
  --    thiết kế" — lý do ấy viết cho câu hỏi RÒ (mục A), không cho câu hỏi IM LẶNG. Đọc/ghi qua cha không
  --    cần quyền trên con, nên một GRANT trực tiếp lên con chỉ có nghĩa cho truy cập THẲNG con — đúng ca
  --    "quyền đã cấp mà RLS từ chối ⇒ 0 hàng không lỗi". Con KHÔNG có GRANT riêng thì mục này không sinh
  --    hàng (không quyền ⇒ không tổ hợp), nên khuôn PostgreSQL chuẩn (policy trên cha, lá trơn) vẫn đi qua.
  -- ⑶ RLS ngoài tập tenant: bảng bật RLS mà không thuộc VI_TU_CAN_CO_RLS phải được khai đích danh ở
  --    BANG_RLS_NGOAI_TENANT_KHAI — [CR1] không soi policy của nó nên một `USING (false)` ở đó vô hình.
  -- Vế "không phải phiên khách" dưới dạng LITERAL SQL (đã nhân đôi nháy) — dùng ở (b1), (c) và ở mục
  -- caller_rate_limits (82⑵: ghim nguyên văn thay cho LIKE chuỗi con).
  KHACH_KHONG_PHIEN_LIT constant text :=
    $q$'((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL)'$q$;

  -- Xuống dòng bên trong hai literal `bid_receipts`/`vendor_bid_versions` LÀ MỘT PHẦN của `pg_get_expr`
  -- (deparse subquery) — không được "nắn" thành khoảng trắng; `.gitattributes` giữ *.sql eol=lf nên byte
  -- xuống dòng là LF ở mọi máy. [lượt soi 29, INFO-10]
  POLICY_RESTRICTIVE_KHAI constant text :=
    $q$(VALUES
         ('public', 'bid_receipts', 'bid_receipts_khach', '*', 'PUBLIC', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (bid_version_id IN ( SELECT v.id
   FROM vendor_bid_versions v)))', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (bid_version_id IN ( SELECT v.id
   FROM vendor_bid_versions v)))'),
         ('public', 'guest_sessions', 'guest_sessions_khach', '*', 'PUBLIC', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (id = (NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid))', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (id = (NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid))'),
         ('public', 'rfq_invitations', 'rfq_invitations_khach', '*', 'PUBLIC', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (id = (NULLIF(current_setting(''app.guest_invitation_id''::text, true), ''''::text))::uuid))', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (id = (NULLIF(current_setting(''app.guest_invitation_id''::text, true), ''''::text))::uuid))'),
         ('public', 'rfq_items', 'rfq_items_khach', '*', 'PUBLIC', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (rfq_id = (NULLIF(current_setting(''app.guest_rfq_id''::text, true), ''''::text))::uuid))', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (rfq_id = (NULLIF(current_setting(''app.guest_rfq_id''::text, true), ''''::text))::uuid))'),
         ('public', 'rfq_key_material', 'rfq_key_material_khach', '*', 'PUBLIC', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (rfq_id = (NULLIF(current_setting(''app.guest_rfq_id''::text, true), ''''::text))::uuid))', '((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL)'),
         ('public', 'rfq_packages', 'rfq_packages_khach', '*', 'PUBLIC', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (id = (NULLIF(current_setting(''app.guest_rfq_id''::text, true), ''''::text))::uuid))', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (id = (NULLIF(current_setting(''app.guest_rfq_id''::text, true), ''''::text))::uuid))'),
         ('public', 'vendor_bid_versions', 'vendor_bid_versions_khach', '*', 'PUBLIC', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (bid_id IN ( SELECT b.id
   FROM vendor_bids b)))', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (bid_id IN ( SELECT b.id
   FROM vendor_bids b)))'),
         ('public', 'vendor_bids', 'vendor_bids_khach', '*', 'PUBLIC', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (invitation_id = (NULLIF(current_setting(''app.guest_invitation_id''::text, true), ''''::text))::uuid))', '(((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL) OR (invitation_id = (NULLIF(current_setting(''app.guest_invitation_id''::text, true), ''''::text))::uuid))')
       ) AS g(nspname, bang, polname, lenh, vai_tro, bieu_thuc_using, bieu_thuc_with_check)$q$;

  POLICY_KHAC_KHAI constant text :=
    $q$(VALUES
         ('public', 'caller_rate_limits', 'caller_rate_limits_khach', 'PERMISSIVE', '*', 'PUBLIC', '((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL)', '((NULLIF(current_setting(''app.guest_session_id''::text, true), ''''::text))::uuid IS NULL)')
       ) AS k(nspname, bang, polname, loai, lenh, vai_tro, bieu_thuc_using, bieu_thuc_with_check)$q$;

  BANG_RLS_NGOAI_TENANT_KHAI constant text :=
    $q$(VALUES ('public', 'caller_rate_limits')) AS b(nspname, relname)$q$;

  -- [S1.55 / lượt soi 48 NẶNG-3] PERMISSIVE trên bảng mà [CR1] SẼ soi nếu nó ở public — con cháu của bảng tenant (VI_TU_CAN_CO_RLS)
  -- hay bảng có cột org_id — KHÔNG khai được ở (c). Bản đầu S1.55 gỡ ghim public cho (c) và mở luôn một lối lách [CR1]. Đo: lá
  -- `luu98.zz98pm_1` (PARTITION OF public.zz98pm, ngoài public) mang `USING (true)` cùng một dòng (c) ⇒ 83⑴ im, bảy mục kề im
  -- ([CR1], 83⑵, 83⑶, 94, 85, 86, 82⑴), app_api gắn tổ chức A đọc THẲNG lá ra 2 hàng của hai tổ chức (qua cha: 1); bảng có org_id
  -- ngoài public bật RLS, khai kép 83⑶ + (c) ⇒ cũng 2. Bản HEAD không có lối khai nào — fail-closed. Lối ra: policy đặt trên
  -- bảng cha (khuôn dự án: lá không policy), hay chuyển bảng về public để [CR1] soi hình dạng. Bảng chỉ có khoá ngoại tới bảng
  -- tenant (khoản 86) KHÔNG thuộc vế này: [CR1] không soi nó cả ở public, nên khai kép 83⑶ + (c) là cùng chuẩn với public.
  -- RESTRICTIVE không thuộc vế này (chỉ thu hẹp). Policy thuộc vế (a) không tới được đây. Hôm nay lược đồ thật không có policy
  -- nào thuộc vế này (đo). Hai chỗ dùng trong CAU_POLICY_LOP_SAI: thông điệp và vế chặn của (c).
  VI_TU_PERMISSIVE_CR1_SE_SOI constant text :=
    $q$(p.polpermissive AND (($q$ || VI_TU_CAN_CO_RLS || $q$) OR $q$ || pg_catalog.format(MAU_VI_TU_CO_ORG_ID, 'c') || $q$))$q$;

  -- [S1.66 / lượt soi ngang 59a-8] Thông điệp nêu lược đồ, bảng, policy, lệnh và vai — đều là TÊN — và không in biểu thức USING /
  -- WITH CHECK (bài học S1.51 ⑷). Bản cũ in nguyên văn cả hai vế, và S1.55 mở tầm của mục ra mọi lược đồ dự án. Đo trước bản
  -- vá: policy ngoài public mang một UUID trong USING và một email trong WITH CHECK ⇒ thông điệp mang nguyên cả hai. Người
  -- khai một dòng đọc biểu thức ở catalog. Test: db/thong-diep-khong-gia-tri.int.test.ts.
  CAU_POLICY_LOP_SAI constant text :=
    $q$SELECT n.nspname || '.' || c.relname || '.' || p.polname || ': policy '
              || CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END
              || ' không thuộc lớp nào (khoản 83⑴) — lệnh=' || p.polcmd::text || ' vai=' || $q$ || BIEU_THUC_VAI_TRO || $q$
              || ' (biểu thức USING/WITH CHECK không in ra — đọc pg_get_expr(polqual, polrelid) và pg_get_expr(polwithcheck, polrelid) trong pg_policy)'
              || CASE WHEN $q$ || VI_TU_PERMISSIVE_CR1_SE_SOI || $q$
                      THEN '. Bảng mang dữ liệu tenant mà [CR1] không soi ở đây (con cháu của bảng tenant, hay có cột org_id, ngoài '
                           'vế (a)): PERMISSIVE trên nó KHÔNG khai được (khoản 98, lượt soi 48) — một dòng khai sẽ là một đường đọc '
                           'thẳng xuyên tổ chức. Sửa: một migration mới đặt policy trên bảng cha (lá không policy) hay chuyển bảng về '
                           'public để [CR1] soi hình dạng, rồi xoá policy này.'
                      ELSE '. Một RESTRICTIVE chưa khai có thể là USING (false): câu ghi của app_api ra 0 hàng không lỗi. '
                           'Sửa: một migration mới sửa/xoá policy, HOẶC khai đủ bảy cột, có lược đồ, vào POLICY_RESTRICTIVE_KHAI '
                           '(RESTRICTIVE) / tám cột vào POLICY_KHAC_KHAI (khác) trong chính file này kèm bản ở '
                           'db/rls-coverage.int.test.ts — cổng ở đó đòi hai bản khớp.' END AS mo_ta
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND NOT (p.polpermissive AND $q$ || VI_TU_BANG_TENANT || $q$)
          AND NOT (NOT p.polpermissive
                   AND n.nspname = 'public'
                   AND p.polname = c.relname || '_khach'
                   AND p.polcmd = '*'
                   AND p.polroles = '{0}'::oid[]
                   -- [lượt soi 29, NHẸ-3] thiếu một vế ⇒ NULL ⇒ NOT (NULL) lọc hàng ⇒ được nhận nhầm là (b1).
                   AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL
                   AND pg_get_expr(p.polqual, c.oid) = $q$ || KHACH_KHONG_PHIEN_LIT || $q$
                   AND pg_get_expr(p.polwithcheck, c.oid) = $q$ || KHACH_KHONG_PHIEN_LIT || $q$)
          AND NOT EXISTS (SELECT 1 FROM $q$ || POLICY_RESTRICTIVE_KHAI || $q$
                           WHERE NOT p.polpermissive AND g.nspname = n.nspname
                             AND g.bang = c.relname AND g.polname = p.polname
                             AND g.lenh = p.polcmd::text
                             AND g.vai_tro = $q$ || BIEU_THUC_VAI_TRO || $q$
                             AND g.bieu_thuc_using IS NOT DISTINCT FROM pg_get_expr(p.polqual, c.oid)
                             AND g.bieu_thuc_with_check IS NOT DISTINCT FROM pg_get_expr(p.polwithcheck, c.oid))
          AND NOT EXISTS (SELECT 1 FROM $q$ || POLICY_KHAC_KHAI || $q$
                           WHERE NOT $q$ || VI_TU_PERMISSIVE_CR1_SE_SOI || $q$
                             AND k.nspname = n.nspname
                             AND k.bang = c.relname AND k.polname = p.polname
                             AND k.loai = CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END
                             AND k.lenh = p.polcmd::text
                             AND k.vai_tro = $q$ || BIEU_THUC_VAI_TRO || $q$
                             AND k.bieu_thuc_using IS NOT DISTINCT FROM pg_get_expr(p.polqual, c.oid)
                             AND k.bieu_thuc_with_check IS NOT DISTINCT FROM pg_get_expr(p.polwithcheck, c.oid))
       UNION ALL
       -- Chiều ngược chỉ có nghĩa khi BẢNG tồn tại: migrations.int.test.ts migrate() những tập migration RÚT GỌN
       -- (tới 003, tới 0xx…) mà hardening chạy ở mọi lần — đo: bản đầu kêu "khai thiu" về 027/042 chưa có
       -- và làm 13 test đỏ. Cùng khuôn điều kiện áp dụng `to_regclass(...) IS NOT NULL` của mục caller_rate_limits.
       SELECT 'khai ' || g.nspname || '.' || g.bang || '.' || g.polname || ' (RESTRICTIVE, khoản 83⑴) mà CSDL không có policy '
              'đúng bảy cột như thế — dòng khai thiu, hoặc policy đã bị đổi/xoá sau deploy' AS mo_ta
         FROM $q$ || POLICY_RESTRICTIVE_KHAI || $q$
        WHERE EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = g.nspname AND zc.relname = g.bang)
          AND NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = g.nspname AND c.relname = g.bang AND p.polname = g.polname
                             AND NOT p.polpermissive AND p.polcmd::text = g.lenh
                             AND $q$ || BIEU_THUC_VAI_TRO || $q$ = g.vai_tro
                             AND pg_get_expr(p.polqual, c.oid) IS NOT DISTINCT FROM g.bieu_thuc_using
                             AND pg_get_expr(p.polwithcheck, c.oid) IS NOT DISTINCT FROM g.bieu_thuc_with_check)
       UNION ALL
       SELECT 'khai ' || k.nspname || '.' || k.bang || '.' || k.polname || ' (' || k.loai || ', khoản 83⑴) mà CSDL không có policy '
              'đúng tám cột như thế — dòng khai thiu, hoặc policy đã bị đổi/xoá sau deploy' AS mo_ta
         FROM $q$ || POLICY_KHAC_KHAI || $q$
        WHERE EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = k.nspname AND zc.relname = k.bang)
          AND NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = k.nspname AND c.relname = k.bang AND p.polname = k.polname
                             AND (CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END) = k.loai
                             AND p.polcmd::text = k.lenh
                             AND $q$ || BIEU_THUC_VAI_TRO || $q$ = k.vai_tro
                             AND pg_get_expr(p.polqual, c.oid) IS NOT DISTINCT FROM k.bieu_thuc_using
                             AND pg_get_expr(p.polwithcheck, c.oid) IS NOT DISTINCT FROM k.bieu_thuc_with_check)$q$;

  -- [S1.44 / khoản nợ 88 — lượt soi 33a #2 NẶNG; lượt soi 36 #1 NẶNG, #2] Tập vai của ⑵ = TÍNH CHẤT ∪ TÊN ĐÃ GHIM:
  -- VAI_KET_NOI_UNG_DUNG (thành viên bắc cầu của app_api/app_unseal, trừ superuser) HỢP ROLE_CANH (bốn tên ghim từ S0,
  -- MỘT bản — không phải bản chép thứ ba). Vì sao không CHỈ tính chất (bản đầu của vòng này): membership là thứ ADMIN
  -- OPTION đổi được — `REVOKE app_api FROM app_api_login` rồi GRANT trực tiếp lên bảng RLS cho app_api_login ⇒ kết nối
  -- thật đọc 0 hàng không lỗi (ADR-036 hàng 6) mà tập theo membership không còn chứa nó: "theo tính chất" chỉ đúng khi
  -- tính chất là thứ kẻ tấn công không đổi được — bài học ADR-037 áp cho VAI (lượt soi 36 #1). Vì sao không CHỈ bốn tên:
  -- một vai lạ được cấp app_api mang GRANT trực tiếp thì bốn tên im; BƯỚC 1 gỡ membership lạ và CAU_MEMBERSHIP_LA ở
  -- BƯỚC 3 chặn deploy khi không gỡ được, nhưng ⑵ phải tự nêu đúng dòng của mình, không TỰA vào mục khác. Quyền xét
  -- theo KẾ THỪA như 83⑧ (pg_has_role … 'USAGE'): GRANT cho một nhóm mà vai là thành viên cũng là quyền của vai, và
  -- mô tả nêu đường tới quyền. Đo ở db/rls-coverage.int.test.ts: vai lạ + GRANT trực tiếp (bốn tên im); app_api_login
  -- không membership + GRANT (chỉ-tính-chất im); quyền qua nhóm (bản grantee-trực-tiếp im).
  CAU_PHU_LENH_SAI constant text :=
    $q$WITH vai AS (SELECT r.rolname, r.oid FROM pg_roles r
                    WHERE r.rolname IN (SELECT v.rolname FROM ($q$ || VAI_KET_NOI_UNG_DUNG || $q$) v)
                       OR r.rolname IN $q$ || ROLE_CANH || $q$),
       quyen AS (
         SELECT c.oid, n.nspname || '.' || c.relname AS ten_bang, vai.rolname, a.privilege_type,
                CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE (SELECT g.rolname::text FROM pg_roles g WHERE g.oid = a.grantee) END AS qua
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
           JOIN vai ON a.grantee = 0
                    OR pg_catalog.pg_has_role(vai.oid, CASE WHEN a.grantee = 0 THEN vai.oid ELSE a.grantee END, 'USAGE')
          WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
            AND c.relkind IN ('r', 'p') AND c.relrowsecurity
            AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
         UNION
         SELECT c.oid, n.nspname || '.' || c.relname, vai.rolname, a.privilege_type,
                CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE (SELECT g.rolname::text FROM pg_roles g WHERE g.oid = a.grantee) END
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
           CROSS JOIN LATERAL aclexplode(att.attacl) a
           JOIN vai ON a.grantee = 0
                    OR pg_catalog.pg_has_role(vai.oid, CASE WHEN a.grantee = 0 THEN vai.oid ELSE a.grantee END, 'USAGE')
          WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
            AND c.relkind IN ('r', 'p') AND c.relrowsecurity
            AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
       )
       SELECT q.ten_bang || '/' || q.rolname || '/' || q.privilege_type
              || ': quyền đã cấp' || CASE WHEN q.qua IS DISTINCT FROM q.rolname THEN ' (qua ' || q.qua || ')' ELSE '' END
              || ' mà không policy PERMISSIVE nào phủ (lệnh, vai) (khoản 83⑵) — RLS mặc định TỪ CHỐI: '
                 'SELECT/UPDATE/DELETE trả 0 hàng không lỗi, INSERT ném. Sửa: một migration mới thêm policy cho lệnh ấy, '
                 'hoặc thu hồi quyền.' AS mo_ta
         FROM quyen q
        WHERE NOT EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = q.oid AND p.polpermissive
                             -- [lượt soi 29, NHẸ-4] policy áp cho vai và cho MỌI thành viên kế thừa của vai
                             -- (RLS dùng has_privs_of_role); hai role đăng nhập vào tập vai vì một GRANT trực
                             -- tiếp cho chúng là quyền của kết nối thật. BƯỚC 1 đã gỡ tư cách thành viên lạ.
                             AND (p.polroles = '{0}'::oid[]
                                  OR EXISTS (SELECT 1 FROM unnest(p.polroles) AS o(oid)
                                              JOIN pg_roles vr ON vr.rolname = q.rolname
                                             WHERE pg_catalog.pg_has_role(vr.oid, o.oid, 'USAGE')))
                             AND (p.polcmd = '*' OR p.polcmd = CASE q.privilege_type
                                    WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w' ELSE 'd' END))$q$;

  -- [S1.53 / khoản nợ 94 — lượt soi 42 NẶNG-3] 83⑵ CHO CHỦ BẢNG. Mục TỰ CHỮA `VI_TU_FORCE_THIEU` (khoản 91) FORCE mọi bảng
  -- bật RLS của lược đồ dự án, nên CHỦ BẢNG chịu RLS như mọi vai khác — còn 83⑵ (CAU_PHU_LENH_SAI) chỉ soi tập vai ứng
  -- dụng, không soi vai chủ. ĐO (thăm dò S1.53, PostgreSQL 16, chủ KHÔNG superuser): bảng FORCE với policy duy nhất
  -- `TO app_api` ⇒ chủ bảng SELECT ra 0 hàng dù bảng có 2, UPDATE và DELETE báo 0 hàng KHÔNG LỖI (ADR-036 hàng 4/6), INSERT
  -- ném 42501; policy cấp cho một NHÓM mà chủ là thành viên thì phủ (SELECT ra 2) — khớp `has_privs_of_role` mà RLS dùng,
  -- nên vế vai viết bằng `pg_has_role(chủ, vai, 'USAGE')` như 83⑵. Hôm nay KHÔNG ca nào: cả 30 bảng bật RLS đều có policy
  -- PERMISSIVE `TO PUBLIC` ở mọi lệnh (đo) — mục không chặn cụm hợp lệ nào (ADR-028 §3); nó đổi cái giá của FORCE từ 0 hàng
  -- im lặng thành ĐỎ ở lượt phán xét.
  -- Chủ thể theo TÍNH CHẤT: mọi bảng (r/p) bật RLS và FORCE trong lược đồ dự án, trừ đối tượng extension, tenant hay không —
  -- vế phủ chỉ hỏi DANH SÁCH VAI của policy, không hỏi biểu thức USING, nên policy tenant `TO PUBLIC USING (org_id = …)` được
  -- tính là phủ (0 hàng khi chưa gắn tổ chức là [INV-F1] fail-closed, có chủ đích). Chủ superuser hay BYPASSRLS bỏ qua RLS ở
  -- mọi cấu hình nên không có 0 hàng nào để báo — đứng ngoài. Bốn lệnh như 83⑵: INSERT ném chứ không im, nhưng chủ bảng không
  -- INSERT được là một migration backfill hỏng, và hai mục kề phải cùng một chuẩn.
  -- PHÁN XÉT, không tự chữa: thêm policy là quyết định an ninh của người viết migration, không phải một phép đơn điệu.
  -- [lượt soi 46 — bản hai] ⑴ Bảng CON (phân vùng hay INHERITS) của một cha bật RLS đứng ngoài (NẶNG-1). Đo: chủ bảng đọc QUA
  -- CHA ra 2 hàng nhờ policy của cha, đọc THẲNG lá ra 0 và UPDATE thẳng lá báo 0 hàng. Bản đầu nêu oan mọi lá phân vùng của
  -- bảng tenant dưới chủ thường — đúng hồ sơ sản xuất — trong khi dự án đã chọn khuôn "policy đặt trên cha, lá không policy"
  -- ở ba lớp ([CR1] nguồn (i), migration-shape, test phân vùng); ~~lá ngoài `public` còn thành ngõ cụt vì 83⑴ nêu mọi policy
  -- ngoài `public` mà không có đường khai (khoản 98)~~ [S1.55] ngõ cụt ấy đóng ở khoản 98: policy ngoài `public` nay khai được
  -- kèm lược đồ. Cha vẫn bị mục này soi; DML THẲNG lên lá là ranh giới nói ra.
  -- ⑵ Chỉ lệnh mà chủ bảng CÒN QUYỀN (NHẸ-2), cùng chuẩn 83⑵ xét quyền đã cấp. Đo: chủ tự `REVOKE UPDATE, DELETE` thì
  -- `has_table_privilege(chủ, bảng, 'UPDATE')` ra false và UPDATE của chủ ném 42501 — ồn, không im. Bản đầu đòi policy cho
  -- cả lệnh ấy, và thông điệp gợi `TO PUBLIC` trước tiên — lối ra phủ LUÔN mọi vai ứng dụng.
  -- ⑶ Mức bảo đảm là trạng thái TẠI LƯỢT PHÁN XÉT (INFO-5): migration A gỡ policy, B backfill 0 hàng, C dựng lại policy
  -- trong CÙNG lượt ⇒ lượt phán xét xanh. ⑷ ~~Mục soi CHỦ BẢNG và mọi vai thừa kế quyền chủ (RLS coi họ là chủ), KHÔNG soi
  -- vai chạy migration mà không thừa kế chủ — hồ sơ N2 là đúng ca ấy (NHẸ-3): khoản 97.~~ [S1.56] Nay soi cả vai ấy — xem ⑸.
  -- ⑸ [S1.56 / khoản nợ 97] CHỦ THỂ THỨ HAI: `current_user` của phiên phán xét — chính phiên vừa chạy vòng migration đánh số.
  -- RLS áp cho mọi vai không được coi là chủ (`pg_has_role(vai, relowner, 'USAGE')` sai) BẤT KỂ FORCE, nên vế FORCE bỏ với chủ
  -- thể này. Đo (thăm dò S1.56, PostgreSQL 16): chủ `zz_chu97` không superuser, bảng bật RLS có 2 hàng, policy duy nhất
  -- `TO zz_chu97`; vai `zz_trien97` không thừa kế chủ, được GRANT SELECT, UPDATE ⇒ đọc 0 hàng và UPDATE 0 hàng KHÔNG LỖI, cả khi
  -- NO FORCE; mục 94 và 83⑵ im. Hồ sơ N2 (`trien_khai` CREATEROLE, sở hữu database, không sở hữu bảng) cùng hình dạng: migrate()
  -- dưới `trien_khai` áp một migration `UPDATE … SET id = id + 10` rồi ĐI QUA, hàng không đổi. Đối chứng: thêm policy FOR SELECT
  -- TO PUBLIC ⇒ chỉ còn UPDATE; vai là thành viên của chủ, hay bảng tắt RLS ⇒ im. Hôm nay im trên lược đồ thật với MỌI vai: mọi
  -- bảng RLS thật có policy PERMISSIVE TO PUBLIC ở cả bốn lệnh (census ở rls-coverage) — phép đo dưới superuser và dưới một vai
  -- CREATEROLE không GRANT rỗng theo cấu tạo [lượt soi 49 INFO-1]. CI chạy migrate() bằng superuser nên chủ thể này chỉ chịu lực ở hồ sơ N2; vai sở hữu
  -- mọi bảng (hồ sơ N3) thừa kế chủ nên đứng ngoài. Cùng các vế lọc của chủ thể thứ nhất: extension, bảng con của cha bật RLS,
  -- lệnh vai ấy không có quyền. [lượt soi 49 NẶNG-2 — bản ba] Vế "RLS áp cho vai này" là GƯƠNG của check_enable_rls: superuser và
  -- BYPASSRLS bỏ qua; chủ và vai thừa kế chủ (USAGE) bỏ qua TRỪ KHI FORCE; chính chủ thuộc chủ thể thứ nhất. Bản hai loại MỌI vai
  -- thừa kế chủ với lý do "hai chủ thể rời nhau" — sai: chủ thể thứ nhất loại chủ superuser/BYPASSRLS và chỉ xét quyền của CHÍNH chủ,
  -- còn khoản 91 FORCE mọi bảng. Đo: chủ BYPASSRLS có thành viên INHERIT, bảng FORCE, policy chỉ TO app_api ⇒ thành viên đọc 0, UPDATE
  -- 0 không lỗi, cả hai chủ thể im; chủ thường tự REVOKE ALL, thành viên INHERIT có GRANT trực tiếp ⇒ như thế. Đối chứng: cùng thành
  -- viên trên bảng NO FORCE đọc 2 và mục im. Khi chủ cũng thiếu phủ thì ra hai dòng (chủ và thành viên) — chấp nhận. Vế superuser nay
  -- chịu lực: SUPERUSER NOBYPASSRLS trên bảng FORCE mà policy chỉ FOR SELECT — bỏ vế thì nêu UPDATE, DELETE dù superuser ghi đủ hàng
  -- (đo). Thừa kế theo USAGE (INHERIT), không theo MEMBER: thành viên NOINHERIT không được RLS coi là chủ — đọc 0 (đo). [lượt soi 49
  -- NHẸ-5] Chủ thể này KHÔNG xét INSERT — INSERT không phủ thì ném 42501, rollback, không ghi checksum (đo) — và loại vai thiếu USAGE
  -- trên lược đồ, vì mọi truy cập ném 42501 (đo). [lượt soi 49 NHẸ-4] ~~Chỉ xét danh sách vai: policy tenant `TO PUBLIC USING (org_id =
  -- app_current_org_id())` tính là phủ dù migrate() không gắn app.org_id — hôm nay ồn nhờ EXECUTE của hàm ấy chỉ app_api/app_unseal có
  -- (đo: 42501), còn GRANT EXECUTE cho vai deploy thì backfill ra 0 hàng im, mục im, và migrate() không thu hồi (đo) — khoản 101.~~
  -- [S1.58 / khoản nợ 101] Policy PHỤ THUỘC `app_current_org_id()` (pg_depend) thôi tính là phủ vai chạy migration có EXECUTE trên hàm ấy
  -- mà RLS không coi là chủ: migrate() không gắn app.org_id nên vị từ là NULL ở mọi hàng. Không EXECUTE thì câu ném 42501 — ồn — nên
  -- policy vẫn tính là phủ. Đo (thăm dò S1.58, hồ sơ N2, PostgreSQL 16): vai có SELECT, UPDATE trên suppliers mà không EXECUTE ⇒ đếm ném
  -- 42501, migrate() ném ở `999_…`; thêm EXECUTE ⇒ đếm ra 0 không lỗi, migrate() bản trước ghi `999_…` là đã áp mà hàng không đổi.
  -- Cột `vi_tu_loc_het` đánh dấu dòng chỉ có vì vế ấy, `duong_execute` nêu đường tới EXECUTE, `loi_ra_execute` nêu lối ra theo từng đường;
  -- `tu_sua_duoc` của dòng ấy = tự cắt được EXECUTE (ba vế cùng khuôn ba vế trên bảng) HOẶC cắt được đường tới quyền trên bảng — đo từng
  -- đường: vai thừa kế chủ hàm tự `REVOKE EXECUTE … FROM <chủ>` được và mất EXECUTE (app_api vẫn giữ); vai có ADMIN (không INHERIT, không
  -- SET) trên chủ hàm tự cấp thừa kế rồi thu hồi của chủ và của chính nó được; vai tự cắt cạnh membership nhóm mang EXECUTE do chính nó cấp
  -- thì mất EXECUTE; EXECUTE do superuser cấp thẳng khi chủ hàm là vai bootstrap thì tự thu hồi là no-op.
  -- [lượt soi 51] Bản đầu của vòng khớp NGUYÊN VĂN HINH_DANG_CHUAN và áp cho mọi vai không phải chính chủ. Người soi chỉ ra, đo lại được:
  -- ⑴ NẶNG-1 — hồ sơ N3′ (vai deploy thừa kế một vai NOLOGIN sở hữu cả bảng lẫn hàm, bảng FORCE): bản đầu đỏ ở MỌI lần deploy mà backfill
  -- vẫn bị tiêu (đo: `999` được ghi, hàng không đổi, lần hai không tệp chờ vẫn đỏ), vì hai vế quyền chủ bảng tính là tự sửa được trong khi
  -- lối vá của chúng không qua được cổng của kho; nay vai mà RLS coi là chủ đứng ngoài vế loại (chủ thể giống chủ — khoản 102), và hai vế
  -- quyền chủ bảng không tính cho dòng khoản 101. ⑵ NẶNG-2 — vai deploy là thành viên app_api (superuser cấp): dòng "qua nhóm app_api" với
  -- lời khuyên chung "gỡ EXECUTE khỏi đường ấy" dẫn tới thu hồi khỏi app_api (đo: TP100 nêu hàng loạt bảng "qua nhóm app_api"); nay lối ra
  -- theo từng đường, đường qua nhóm nói KHÔNG thu hồi khỏi nhóm, và nhóm là vai ứng dụng thì nói thẳng. ⑶ NHẸ-5 — khớp nguyên văn im lặng
  -- với hình dạng ngoại lệ đã tiên liệu (khuôn "đấu thầu kín"); nay theo phụ thuộc — hàm bọc lấy hàm ngữ cảnh vẫn lọt (ranh giới). ⑷ NHẸ-3 —
  -- dòng tự sửa được không bị chặn trước vòng nên backfill cùng lượt vẫn bị tiêu — ranh giới, test ghim. Xấp xỉ theo CẢ HAI chiều, nói ra:
  -- cắt một đường khi còn đường khác (EXECUTE cấp thẳng cộng một nhóm tự cấp) tính là tự sửa được — chiều bỏ qua; ADMIN trên một vai giữ
  -- GRANT OPTION đã cấp EXECUTE thẳng thì không đọc — chiều chặn (lượt soi 51 INFO-8, cùng điểm mù với vế bảng).
  -- [lượt soi 49 NẶNG-1] Mục phán xét SAU vòng đánh số: khi mục đỏ, backfill 0 hàng của CHÍNH lượt đã COMMIT và ghi checksum, REVOKE
  -- rồi chạy lại thì đi qua mà backfill không chạy lại (đo) — thông điệp nói ra; ~~lớp hỏi TRƯỚC vòng (và chụp vai quanh vòng, NHẸ-1)
  -- là khoản 100.~~ [S1.57 / khoản nợ 100] Lớp hỏi TRƯỚC vòng nay có: chủ thể thứ hai tách thành CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI,
  -- và lượt `truoc_vong` — migrate() gọi nó sau lượt sửa đầu, TRƯỚC vòng đánh số, chỉ khi còn tệp chưa áp — hỏi đúng hằng ấy rồi
  -- RAISE SQLSTATE TP100: một bản câu cho hai lớp. Hằng trả ba cột: `ten` (bảng/vai/lệnh); `duong` — đường tới quyền (lượt soi 50
  -- NHẸ-2: lời khuyên "REVOKE khỏi vai này" không có tác dụng khi quyền đến qua PUBLIC, qua nhóm hay do thừa kế chủ); và `tu_sua_duoc`.
  -- [lượt soi 50 NẶNG-1] `tu_sua_duoc` là dòng mà MỘT MIGRATION CHẠY DƯỚI CHÍNH VAI ẤY sửa được — lượt `truoc_vong` bỏ qua chúng,
  -- lượt phán xét sau vòng vẫn nêu. Bản đầu của vòng chặn cả chúng trước vòng: một ngõ cụt ADR-028 §3, vì migration vá lỗi không bao
  -- giờ tới được đích. Đo (thăm dò S1.57, PostgreSQL 16.15): ⒜ thành viên INHERIT của chủ trên bảng FORCE đọc 0 mà vẫn `ALTER POLICY`
  -- và `CREATE POLICY` được — kiểm chủ là has_privs_of_role — rồi đọc lại ra 2; ⒝ vai có ADMIN OPTION trên chủ, hay trên một vai trung
  -- gian thừa kế chủ (kể cả ADMIN có được qua một nhóm mà nó thừa kế), tự `GRANT` cho mình rồi `ALTER POLICY` được trong cùng giao
  -- dịch; ⒞ vai tự cấp membership nhóm mang quyền thì tự `REVOKE` được và quyền mất ngay, còn membership do vai khác cấp — kể cả kèm
  -- ADMIN OPTION — thì KHÔNG (PG16 chỉ thu hồi grant của chính người thu hồi: WARNING "has not been granted … by role"), nên vế ba
  -- hỏi `grantor` của cạnh membership; ⒟ thành viên NOINHERIT mà có SET thì "must be owner" nếu không `SET ROLE` — và migration của kho
  -- không được viết câu đổi vai (db/migration-shape.test.ts), nên dòng ấy KHÔNG thuộc `tu_sua_duoc`. Ba vế đều là xấp xỉ về phía
  -- BỎ QUA nhiều hơn (cắt một đường khi còn đường khác; ADMIN trên một vai superuser) — chiều ấy chỉ trả dòng về lượt phán xét sau
  -- vòng, không tạo ngõ cụt. Ranh giới: backfill trên dòng `tu_sua_duoc` vẫn có thể bị tiêu trước khi migration vá lỗi chạy — cùng
  -- hạng với chủ thể thứ nhất; hai thông điệp sau vòng nói ra.
  -- Chủ thể thứ nhất (chủ bảng) KHÔNG được hỏi trước: lối ra của nó là chính một migration. Chụp vai quanh vòng ở migrate.ts (so trong
  -- giao dịch của mỗi tệp, trước khi ghi checksum). Đo: hồ sơ N2 với `999_zz_backfill100.sql` đang chờ — bản S1.56 ghi tệp là đã áp,
  -- hàng không đổi; bản này từ chối trước vòng, tệp còn chờ, chạy lại dưới superuser thì backfill áp đủ hàng.
  -- Mọi mục ACL của một bảng — mức bảng (ACL mặc định khi relacl NULL) và mức cột — dạng (grantee, privilege_type); grantee 0 là PUBLIC.
  MAU_ACL_CUA_BANG constant text :=
    $q$(SELECT x.grantee, x.privilege_type
          FROM pg_catalog.aclexplode(coalesce(%1$s.relacl, pg_catalog.acldefault('r', %1$s.relowner))) x
        UNION ALL
        SELECT x.grantee, x.privilege_type
          FROM pg_attribute att, pg_catalog.aclexplode(att.attacl) x
         WHERE att.attrelid = %1$s.oid AND att.attnum > 0 AND NOT att.attisdropped)$q$;

  CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI constant text :=
    $q$SELECT k.ten, k.duong, k.vi_tu_loc_het, k.duong_execute, k.loi_ra_execute,
              -- [S1.58 / khoản nợ 101 — lượt soi 51 NẶNG-1] Dòng chỉ có vì policy phụ thuộc hàm ngữ cảnh lọc hết thì tự sửa được khi vai ấy tự
              -- cắt được EXECUTE hay cắt được đường tới quyền trên bảng (vế cạnh membership). Hai vế quyền chủ bảng (thừa kế, ADMIN trên vai thừa
              -- kế chủ) KHÔNG tính cho dòng ấy: lối vá của chúng là thêm policy — cổng migration-shape và [CR1] không cho qua nếu không có dòng
              -- ngoại lệ đọc xuyên tổ chức — hay tự lấy quyền chủ, thứ chỉ dời dòng sang chủ thể giống chủ (khoản 102) chứ không sửa gì.
              CASE WHEN k.vi_tu_loc_het THEN k.tu_cat_execute OR k.tu_sua_canh
                   ELSE k.tu_sua_chu OR k.tu_sua_canh END AS tu_sua_duoc
         FROM (SELECT n.nspname || '.' || c.relname || '/' || pg_catalog.quote_ident(v.rolname) || ' (vai chạy migration)/' || g.ten_lenh AS ten,
              coalesce((SELECT pg_catalog.string_agg(DISTINCT d.mo_ta, ', ' ORDER BY d.mo_ta)
                          FROM (SELECT CASE WHEN a.grantee = 0 THEN 'qua PUBLIC'
                                            WHEN a.grantee = v.oid THEN 'cấp thẳng cho vai này'
                                            WHEN a.grantee = c.relowner THEN 'thừa kế quyền chủ bảng ' || pg_catalog.quote_ident(r.rolname)
                                            ELSE 'qua nhóm ' || pg_catalog.quote_ident(gr.rolname) END AS mo_ta
                                  FROM $q$ || pg_catalog.format(MAU_ACL_CUA_BANG, 'c') || $q$ a
                                  LEFT JOIN pg_roles gr ON gr.oid = a.grantee
                                 WHERE a.privilege_type = g.ten_lenh
                                   AND CASE WHEN a.grantee = 0 THEN true
                                            ELSE pg_catalog.pg_has_role(v.oid, a.grantee, 'USAGE') END) d),
                       'không đọc được đường tới quyền') AS duong,
              -- [S1.58 / khoản nợ 101] Có policy PERMISSIVE phủ lệnh này theo danh sách vai mà dòng vẫn tới đây ⇒ chính policy ấy đã bị vế
              -- cuối câu loại: nó phụ thuộc hàm ngữ cảnh trong khi vai có EXECUTE trên hàm ấy và RLS không coi vai là chủ.
              EXISTS (SELECT 1 FROM pg_policy p
                       WHERE p.polrelid = c.oid AND p.polpermissive
                         AND (p.polcmd = '*' OR p.polcmd = g.ma::"char")
                         AND (p.polroles = '{0}'::oid[]
                              OR EXISTS (SELECT 1 FROM unnest(p.polroles) AS o(oid)
                                          WHERE pg_catalog.pg_has_role(v.oid, o.oid, 'USAGE')))) AS vi_tu_loc_het,
              coalesce((SELECT pg_catalog.string_agg(DISTINCT d.mo_ta, ', ' ORDER BY d.mo_ta)
                          FROM (SELECT CASE WHEN a.grantee = 0 THEN 'qua PUBLIC'
                                            WHEN a.grantee = f.proowner THEN 'quyền chủ hàm ' || pg_catalog.quote_ident(fo.rolname)
                                            WHEN a.grantee = v.oid THEN 'cấp thẳng cho vai này'
                                            ELSE 'qua nhóm ' || pg_catalog.quote_ident(gr.rolname) END AS mo_ta
                                  FROM pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                                  LEFT JOIN pg_roles gr ON gr.oid = a.grantee
                                 WHERE a.privilege_type = 'EXECUTE'
                                   AND CASE WHEN a.grantee = 0 THEN true
                                            ELSE pg_catalog.pg_has_role(v.oid, a.grantee, 'USAGE') END) d),
                       'không đọc được đường tới EXECUTE') AS duong_execute,
              -- [S1.58 / khoản nợ 101 — lượt soi 51 NẶNG-2] Lối ra theo TỪNG đường tới EXECUTE. Đường qua nhóm KHÔNG được khuyên thu hồi khỏi
              -- nhóm: đo — vai deploy là thành viên app_api (superuser cấp) cho ra "qua nhóm app_api", mà REVOKE khỏi app_api làm ứng dụng ném
              -- 42501. Đường quyền chủ hàm: thu hồi EXECUTE của chính chủ hàm làm kiểm khoá ngoại ban đầu trên bảng FORCE mà nó sở hữu ném 42501
              -- (đo ở hồ sơ N3, khoản 102).
              coalesce((SELECT pg_catalog.string_agg(DISTINCT d.loi_ra, '; ' ORDER BY d.loi_ra)
                          FROM (SELECT CASE WHEN a.grantee = 0
                                            THEN 'chủ hàm hay SUPERUSER: REVOKE EXECUTE ON FUNCTION public.app_current_org_id() FROM PUBLIC'
                                            WHEN a.grantee = f.proowner
                                            THEN 'người cấp hay SUPERUSER gỡ membership của vai này vào chủ hàm ' || pg_catalog.quote_ident(fo.rolname)
                                                 || ' — thu hồi EXECUTE của chính chủ hàm thì kiểm khoá ngoại ban đầu trên bảng FORCE mà nó sở hữu ném 42501'
                                            WHEN a.grantee = v.oid
                                            THEN 'chủ hàm hay SUPERUSER: REVOKE EXECUTE ON FUNCTION public.app_current_org_id() FROM '
                                                 || pg_catalog.quote_ident(v.rolname)
                                            ELSE 'người cấp hay SUPERUSER gỡ membership của vai này trên đường tới ' || pg_catalog.quote_ident(gr.rolname)
                                                 || ' — KHÔNG thu hồi EXECUTE khỏi ' || pg_catalog.quote_ident(gr.rolname)
                                                 || CASE WHEN gr.rolname IN $q$ || ROLE_CANH || $q$
                                                         THEN ': đó là vai ứng dụng, thu hồi của nó làm ứng dụng ném 42501; vai deploy là thành viên vai '
                                                              'ứng dụng là cấu hình lạ mà mục membership của hardening cũng chặn'
                                                         ELSE '' END
                                       END AS loi_ra
                                  FROM pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                                  LEFT JOIN pg_roles gr ON gr.oid = a.grantee
                                 WHERE a.privilege_type = 'EXECUTE'
                                   AND CASE WHEN a.grantee = 0 THEN true
                                            ELSE pg_catalog.pg_has_role(v.oid, a.grantee, 'USAGE') END) d),
                       'không đọc được đường tới EXECUTE') AS loi_ra_execute,
              -- [lượt soi 50 NẶNG-1] ba vế tự sửa được — xem khối đo ở trên; [S1.58] tách thành hai cột: quyền chủ bảng, và cạnh membership.
              (pg_catalog.pg_has_role(v.oid, c.relowner, 'USAGE')
               OR EXISTS (SELECT 1 FROM pg_roles x
                           WHERE pg_catalog.pg_has_role(v.oid, x.oid, 'MEMBER WITH ADMIN OPTION')
                             AND pg_catalog.pg_has_role(x.oid, c.relowner, 'USAGE'))) AS tu_sua_chu,
              EXISTS (SELECT 1 FROM $q$ || pg_catalog.format(MAU_ACL_CUA_BANG, 'c') || $q$ a
                        JOIN pg_auth_members am ON am.inherit_option
                       WHERE a.privilege_type = g.ten_lenh
                         AND pg_catalog.pg_has_role(v.oid, am.member, 'USAGE')
                         AND pg_catalog.pg_has_role(v.oid, am.grantor, 'USAGE')
                         AND CASE WHEN a.grantee = 0 OR a.grantee = v.oid THEN false
                                  ELSE pg_catalog.pg_has_role(am.roleid, a.grantee, 'USAGE') END) AS tu_sua_canh,
              -- [S1.58 / khoản nợ 101] cùng ba vế trên hàm ngữ cảnh: thừa kế chủ hàm (tự thu hồi EXECUTE của chủ), ADMIN trên một vai thừa kế
              -- chủ hàm (tự cấp thừa kế rồi thu hồi), cạnh membership INHERIT trên đường tới EXECUTE mà vai ấy thu hồi được — xem khối đo ở trên.
              (pg_catalog.pg_has_role(v.oid, f.proowner, 'USAGE')
               OR EXISTS (SELECT 1 FROM pg_roles x
                           WHERE pg_catalog.pg_has_role(v.oid, x.oid, 'MEMBER WITH ADMIN OPTION')
                             AND pg_catalog.pg_has_role(x.oid, f.proowner, 'USAGE'))
               OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                            JOIN pg_auth_members am ON am.inherit_option
                           WHERE a.privilege_type = 'EXECUTE'
                             AND pg_catalog.pg_has_role(v.oid, am.member, 'USAGE')
                             AND pg_catalog.pg_has_role(v.oid, am.grantor, 'USAGE')
                             AND CASE WHEN a.grantee = 0 OR a.grantee = v.oid THEN false
                                      ELSE pg_catalog.pg_has_role(am.roleid, a.grantee, 'USAGE') END)) AS tu_cat_execute
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
         JOIN pg_roles v ON v.rolname = current_user
         LEFT JOIN pg_proc f ON f.oid = pg_catalog.to_regprocedure('public.app_current_org_id()')
         LEFT JOIN pg_roles fo ON fo.oid = f.proowner
         CROSS JOIN (VALUES ('r', 'SELECT'), ('w', 'UPDATE'), ('d', 'DELETE')) AS g(ma, ten_lenh)
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND c.relkind IN ('r', 'p') AND c.relrowsecurity
          -- [lượt soi 49 NẶNG-2] gương check_enable_rls — xem ⑸.
          AND NOT v.rolsuper
          AND NOT v.rolbypassrls
          AND v.oid <> c.relowner
          AND (c.relforcerowsecurity OR NOT pg_catalog.pg_has_role(v.oid, c.relowner, 'USAGE'))
          -- [lượt soi 49 NHẸ-5] thiếu USAGE trên lược đồ thì mọi truy cập ném 42501 — ồn, không im.
          AND pg_catalog.has_schema_privilege(v.oid, n.oid, 'USAGE')
          AND NOT EXISTS (SELECT 1 FROM pg_depend de
                           WHERE de.classid = 'pg_class'::regclass AND de.objid = c.oid AND de.deptype = 'e')
          AND NOT EXISTS (SELECT 1 FROM pg_inherits ih JOIN pg_class pc ON pc.oid = ih.inhparent
                           WHERE ih.inhrelid = c.oid AND pc.relrowsecurity)
          AND CASE g.ma WHEN 'd' THEN pg_catalog.has_table_privilege(v.oid, c.oid, 'DELETE')
                        ELSE pg_catalog.has_any_column_privilege(v.oid, c.oid, g.ten_lenh) END
          AND NOT EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = c.oid AND p.polpermissive
                             AND (p.polcmd = '*' OR p.polcmd = g.ma::"char")
                             AND (p.polroles = '{0}'::oid[]
                                  OR EXISTS (SELECT 1 FROM unnest(p.polroles) AS o(oid)
                                              WHERE pg_catalog.pg_has_role(v.oid, o.oid, 'USAGE')))
                             -- [S1.58 / khoản nợ 101] Policy PHỤ THUỘC hàm ngữ cảnh (pg_depend — mọi hình dạng, không chỉ HINH_DANG_CHUAN: lượt soi
                             -- 51 NHẸ-5) KHÔNG phủ vai có EXECUTE trên hàm ấy mà RLS không coi là chủ: migrate() không gắn app.org_id nên vị từ lọc
                             -- hết mọi hàng — đọc/ghi 0 hàng không lỗi. Không EXECUTE thì câu ném 42501 (ồn) nên policy vẫn tính là phủ. Vai mà RLS
                             -- coi là chủ (thừa kế chủ trên bảng FORCE; chính chủ đã bị loại ở trên) đứng ngoài vế này — chủ thể giống chủ, khoản
                             -- 102 (lượt soi 51 NẶNG-1, đo: hồ sơ N3′). Hàm chưa tồn tại thì f.oid NULL, vế EXISTS rỗng và policy vẫn tính là phủ.
                             AND NOT (pg_catalog.has_function_privilege(v.oid, f.oid, 'EXECUTE')
                                      AND NOT pg_catalog.pg_has_role(v.oid, c.relowner, 'USAGE')
                                      AND EXISTS (SELECT 1 FROM pg_depend dp
                                                   WHERE dp.classid = 'pg_policy'::regclass AND dp.objid = p.oid
                                                     AND dp.refclassid = 'pg_proc'::regclass AND dp.refobjid = f.oid)))
              ) k$q$;

  CAU_PHU_LENH_CHU_BANG_SAI constant text :=
    $q$SELECT n.nspname || '.' || c.relname || '/' || pg_catalog.quote_ident(r.rolname) || ' (chủ bảng)/' || g.ten_lenh
              || ': bảng FORCE ROW LEVEL SECURITY mà chủ bảng CÒN QUYỀN lệnh này nhưng không policy PERMISSIVE nào phủ vai chủ '
                 '(khoản 94) — RLS mặc định TỪ CHỐI: SELECT/UPDATE/DELETE của chủ bảng và của mọi vai thừa kế quyền chủ bảng trả 0 '
                 'hàng KHÔNG LỖI, INSERT ném. Migration đánh số nào đã chạy ở lượt này dưới chủ bảng hay dưới một vai thừa kế quyền '
                 'chủ đều đã ghi checksum, deploy sau không chạy lại chúng — phép hỏi trước vòng của migrate() (khoản 100) cố ý KHÔNG '
                 'soi chủ thể này vì lối ra của nó là chính một migration: kiểm backfill của lượt này, chạy lại bằng một migration mới '
                 'nếu nó ra 0 hàng. Sửa: một migration mới thêm policy PERMISSIVE cho lệnh ấy TO chủ bảng (hay TO một nhóm '
                 'mà chủ bảng là thành viên); TO PUBLIC cũng phủ nhưng phủ LUÔN mọi vai ứng dụng có quyền — chỉ dùng khi đó là ý '
                 'định; hoặc REVOKE lệnh ấy khỏi chủ bảng nếu chủ không bao giờ cần.' AS mo_ta
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
         CROSS JOIN (VALUES ('r', 'SELECT'), ('a', 'INSERT'), ('w', 'UPDATE'), ('d', 'DELETE')) AS g(ma, ten_lenh)
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND c.relkind IN ('r', 'p') AND c.relrowsecurity AND c.relforcerowsecurity
          AND NOT r.rolsuper
          AND NOT r.rolbypassrls
          AND NOT EXISTS (SELECT 1 FROM pg_depend de
                           WHERE de.classid = 'pg_class'::regclass AND de.objid = c.oid AND de.deptype = 'e')
          -- [lượt soi 46 NẶNG-1] bảng con của một cha bật RLS được truy cập qua cha — xem ghi chú ⑴ ở trên.
          AND NOT EXISTS (SELECT 1 FROM pg_inherits ih JOIN pg_class pc ON pc.oid = ih.inhparent
                           WHERE ih.inhrelid = c.oid AND pc.relrowsecurity)
          -- [lượt soi 46 NHẸ-2] chỉ lệnh chủ bảng còn quyền — xem ghi chú ⑵ ở trên.
          AND CASE g.ma WHEN 'd' THEN pg_catalog.has_table_privilege(c.relowner, c.oid, 'DELETE')
                        ELSE pg_catalog.has_any_column_privilege(c.relowner, c.oid, g.ten_lenh) END
          AND NOT EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = c.oid AND p.polpermissive
                             AND (p.polcmd = '*' OR p.polcmd = g.ma::"char")
                             AND (p.polroles = '{0}'::oid[]
                                  OR EXISTS (SELECT 1 FROM unnest(p.polroles) AS o(oid)
                                              WHERE pg_catalog.pg_has_role(c.relowner, o.oid, 'USAGE'))))
       UNION ALL
       -- [S1.56 / khoản nợ 97] chủ thể thứ hai — xem ⑸ ở trên. [S1.57 / khoản nợ 100] Thân câu nay ở CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI
       -- (một bản, dùng chung với lượt truoc_vong); ở đây bọc ten/duong/tu_sua_duoc thành mo_ta.
       SELECT t.ten
              || ': RLS áp cho vai chạy migration trên bảng này và vai ấy CÒN QUYỀN lệnh này (' || t.duong || ') mà '
              || CASE WHEN t.vi_tu_loc_het
                      THEN 'policy PERMISSIVE phủ nó theo danh sách vai phụ thuộc app_current_org_id() — migrate() không gắn app.org_id nên '
                           'vị từ ấy lọc hết mọi hàng, và vai này có EXECUTE trên hàm ấy (' || t.duong_execute || ') nên câu không ném '
                           '42501 (khoản 101)'
                      ELSE 'không policy PERMISSIVE nào phủ nó (khoản 97)' END
              || ' — SELECT/UPDATE/DELETE của một migration backfill chạy dưới vai này trả 0 hàng KHÔNG '
                 'LỖI. Migration đánh số nào đã chạy ở lượt này đều đã ghi checksum, deploy sau không chạy lại chúng: kiểm backfill của '
                 'lượt này, chạy lại bằng một migration mới nếu nó ra 0 hàng. '
              || CASE WHEN t.vi_tu_loc_het
                      THEN 'Lối ra cho dòng này, theo từng đường tới EXECUTE: ' || t.loi_ra_execute || '. Gỡ xong thì câu chạm bảng dưới vai '
                           'này ném 42501 thay vì ra 0 hàng; backfill theo tổ chức thì chạy dưới một vai mà RLS không áp, với điều kiện org_id '
                           'tường minh. '
                      ELSE '' END
              || CASE WHEN t.tu_sua_duoc AND t.vi_tu_loc_het
                      THEN 'Vai này tự cắt được đường tới EXECUTE hay đường tới quyền đã nêu, nên phép hỏi trước vòng của migrate() (khoản '
                           '100) cố ý KHÔNG chặn nó — một migration mới chạy dưới chính vai này sửa được: gỡ đường ấy.'
                      WHEN t.tu_sua_duoc
                      THEN 'Vai này mang hay tự lấy được quyền chủ bảng, hoặc tự cắt được đường tới quyền, nên phép hỏi trước vòng của '
                           'migrate() (khoản 100) cố ý KHÔNG chặn nó — một migration mới chạy dưới chính vai này sửa được: thêm policy '
                           'PERMISSIVE cho lệnh ấy TO chủ bảng hay TO vai này (một quyền đọc/ghi THƯỜNG TRỰC của vai deploy, trên bảng '
                           'tenant còn phải qua [CR1]), hay gỡ đường tới quyền đã nêu.'
                      ELSE 'Phép hỏi trước vòng của migrate() (khoản 100) chặn cấu hình này khi nó có sẵn TRƯỚC vòng đánh số, nên tới được '
                           'đây thì hoặc lượt này không tệp nào chờ, hoặc cấu hình mọc ra TRONG vòng. Sửa, ít quyền nhất trước — cả ba '
                           'nằm ngoài tầm của chính vai này: người cấp, chủ bảng hay SUPERUSER gỡ đường tới quyền đã nêu (đường cấp thẳng: '
                           'REVOKE khỏi vai này; đường qua nhóm: gỡ membership của vai này trên đường ấy — KHÔNG REVOKE khỏi nhóm, nhất là '
                           'vai ứng dụng); hoặc chạy migrate() dưới một vai mà RLS không áp hay có policy phủ '
                           'trên bảng này; hoặc chủ bảng thêm policy PERMISSIVE cho lệnh ấy TO vai này (một quyền đọc/ghi THƯỜNG TRỰC '
                           'của vai deploy, trên bảng tenant còn phải qua [CR1]).' END AS mo_ta
         FROM ($q$ || CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI || $q$) t$q$;

  CAU_RLS_NGOAI_TENANT_SAI constant text :=
    $q$SELECT n.nspname || '.' || c.relname
              || ': bảng bật RLS ngoài tập tenant chưa khai (khoản 83⑶) — [CR1] không soi policy của nó, một USING (false) '
                 'ở đây vô hình. Sửa: khai (nspname, relname) vào BANG_RLS_NGOAI_TENANT_KHAI kèm lý do và bản ở '
                 'db/rls-coverage.int.test.ts, hoặc một migration mới tắt RLS.' AS mo_ta
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND c.relkind IN ('r', 'p') AND c.relrowsecurity
          AND NOT $q$ || VI_TU_CAN_CO_RLS || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || BANG_RLS_NGOAI_TENANT_KHAI || $q$
                           WHERE b.nspname = n.nspname AND b.relname = c.relname)
       UNION ALL
       SELECT 'khai ' || b.nspname || '.' || b.relname || ' là bảng RLS ngoài tenant (khoản 83⑶) mà CSDL không có bảng '
              'bật RLS như thế ngoài tập tenant — dòng khai thiu' AS mo_ta
         FROM $q$ || BANG_RLS_NGOAI_TENANT_KHAI || $q$
        WHERE EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = b.nspname AND zc.relname = b.relname)
          AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = b.nspname AND c.relname = b.relname
                             AND c.relkind IN ('r', 'p') AND c.relrowsecurity
                             AND NOT $q$ || VI_TU_CAN_CO_RLS || $q$)$q$;

  -- ---- [S1.41 / khoản nợ 85] BẬC TỰ DO "BẢNG CÓ org_id NGOÀI public KHÔNG TREO DƯỚI BẢNG TENANT" ---------------
  -- Ghi ở chú thích VI_TU_CAN_CO_RLS từ vòng fix 3 là "nói ra thay vì hứa suông"; lượt soi 31 đọc ra ba kẽ cùng
  -- đổ về đó: con cũ của một cặp INHERITS sau NO INHERIT + RENAME (82⑴ im vì tên đã được tái dùng); lá phân
  -- mảnh ngoài public tạo-và-DETACH giữa hai lần deploy (cùng cơ chế ADR-036 hàng 22, không hàng pg_inherits);
  -- và bảng ngoài public chỉ được nhận là tenant qua pg_inherits. Hình dạng chung: bảng (r/p) có cột org_id,
  -- trong MAU_SCHEMA_DU_AN, KHÔNG thuộc VI_TU_CAN_CO_RLS (tức ngoài public và không treo dưới bảng tenant) và
  -- KHÔNG bật RLS — mục (A) không bật, [CR1] không soi (vị từ tenant chỉ nhận public), 83⑵/83⑶ không thấy (không
  -- RLS): một GRANT cho vai ứng dụng mở hàng của MỌI tổ chức (đo, S1.41). Bật RLS lên nó thì rơi sang 83⑶ —
  -- hai mục kề nhau, không chồng: mục này cố ý đòi NOT relrowsecurity. Khai đích danh ở
  -- BANG_ORG_ID_NGOAI_PUBLIC_KHAI (rỗng: lược đồ thật không có bảng org_id ngoài public). Chiều ngược khi bảng
  -- còn mà không còn hình dạng ấy (như 83⑶). Không nới VI_TU_BANG_TENANT: đổi định nghĩa "bảng tenant" kéo
  -- theo nguồn (i)/(ii) và mục (C) — bán kính nổ ghi ở chú thích ấy; mục này bắt hình dạng phải KHAI, đủ để
  -- đóng ba kẽ. GIỚI HẠN NÓI THẲNG: chỉ nhận cột TÊN org_id — bảng đa tổ chức đặt tên cột khác (to_chuc, tenant_id)
  -- không thuộc mục này, và cũng không thuộc vị từ tenant ở public: đó là ranh giới của MAU_VI_TU_BANG_TENANT ở
  -- MỌI schema, không phải bậc tự do 85 mở lại [lượt soi 32, INFO-6]; gốc tenant theo vế khoá ngoại cũng vậy.
  -- [S1.46 / khoản nợ 86 — nửa gốc] Ranh giới ấy nay có lớp KỀ BÊN: bảng KHÔNG có cột org_id nhưng có khoá ngoại một cột
  -- (của nó hay của tổ tiên INHERITS) trỏ tới một BẢNG TENANT, ở MỌI schema kể cả public, không RLS ⇒ CAU_KHOA_NGOAI_TENANT_SAI
  -- (dưới). Ba mục 85 / 86 / 83⑶ rời nhau theo (có org_id, có khoá ngoại tới bảng tenant, relrowsecurity).
  -- Mỗi dòng khai ở đây là một GRANT đọc xuyên tổ chức có điều kiện — cùng hạng NGOAI_LE_HINH_DANG, phải kèm lý do
  -- và bản test; khai theo TÊN chỉ đóng băng lời khai: DROP rồi CREATE lại cùng tên là qua [lượt soi 32, INFO-7].
  -- Mục PHÁN XÉT ở migrate(): cửa sổ giữa hai lần deploy vẫn mở cho cả ba kẽ — mức bảo đảm là "phát hiện ở deploy
  -- kế", không hơn (test (b) khoản 85 nói ra).
  BANG_ORG_ID_NGOAI_PUBLIC_KHAI constant text :=
    $q$(VALUES ('', '')) AS oi(nspname, relname)$q$;

  CAU_ORG_ID_NGOAI_PUBLIC_SAI constant text :=
    $q$SELECT n.nspname || '.' || c.relname
              || ': bảng có cột org_id ngoài public, không treo dưới bảng tenant nào và không bật RLS — chưa khai (khoản 85). '
                 'Vị từ bảng tenant chỉ nhận public, nên mục (A) không bật RLS, [CR1] không soi, 83⑵/83⑶ không thấy: một GRANT '
                 'cho vai ứng dụng mở hàng của mọi tổ chức (đo: con cũ sau NO INHERIT; lá phân mảnh ngoài public sau DETACH). '
                 'Sửa: một migration mới DROP, hay ALTER TABLE … SET SCHEMA public (thành bảng tenant — [CR1] đòi policy đúng '
                 'khuôn), hay ATTACH PARTITION dưới bảng tenant (INHERITS thì 82⑴ đòi khai); hoặc khai (nspname, relname) vào '
                 'BANG_ORG_ID_NGOAI_PUBLIC_KHAI kèm lý do và bản ở db/rls-coverage.int.test.ts — mỗi dòng khai là một GRANT đọc '
                 'xuyên tổ chức có điều kiện, cùng hạng NGOAI_LE_HINH_DANG. Bật RLS lên nó chỉ chuyển lời khai sang 83⑶ ([CR1] '
                 'không soi policy của bảng ấy).' AS mo_ta
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND $q$ || VI_TU_HINH_DANG_85 || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || BANG_ORG_ID_NGOAI_PUBLIC_KHAI || $q$
                           WHERE oi.nspname = n.nspname AND oi.relname = c.relname)
       UNION ALL
       SELECT 'khai ' || oi.nspname || '.' || oi.relname || ' là bảng org_id ngoài public không RLS (khoản 85) mà CSDL không có bảng '
              'như thế — dòng khai thiu (bảng đã về public, đã treo dưới bảng tenant, đã bật RLS, hay đã bỏ cột)' AS mo_ta
         FROM $q$ || BANG_ORG_ID_NGOAI_PUBLIC_KHAI || $q$
        -- [lượt soi 32, NHẸ-2] chắn hàng sentinel ('', '') như bốn chiều ngược khác của tệp — to_regclass('""."" ')
        -- im trên PG 16 nhờ đường soft-error, ném 42601 trên PG ≤ 15: xanh nhờ mã, không nhờ phiên bản.
        -- [S1.48 / lượt soi ngang 40a H3] "bảng còn tồn tại" đọc bằng JOIN pg_class/pg_namespace ở MƯỜI BỐN chỗ của tệp (mọi chiều ngược),
        -- KHÔNG bằng to_regclass(): to_regclass phân giải tên nên đòi USAGE trên schema — dưới hồ sơ N2 (lượt soi 34 #1 đo
        -- 42501 với app_private) một dòng khai trỏ schema vai deploy không có USAGE làm mục "KHÔNG ĐÁNH GIÁ ĐƯỢC" mãi (BƯỚC 3
        -- bọc EXCEPTION), không lối ra ngoài GRANT — đúng lớp T10-E4. Đo ở rls-coverage bằng vai không USAGE.
        WHERE oi.relname <> ''
          AND EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = oi.nspname AND zc.relname = oi.relname)
          AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = oi.nspname AND c.relname = oi.relname
                             AND $q$ || VI_TU_HINH_DANG_85 || $q$)$q$;

  -- ---- [S1.46 / khoản nợ 86 — nửa gốc] BẢNG ĐA TỔ CHỨC ĐẶT TÊN CỘT KHÁC org_id: KHOÁ NGOẠI MỘT CỘT TỚI BẢNG TENANT ------
  -- Lượt soi 32 INFO-6 nêu địa chỉ: `CREATE TABLE k.t (gia int, to_chuc uuid REFERENCES public.organizations(id)); GRANT
  -- … TO app_api` — và `public.t` cùng hình dạng — không thuộc vị từ nào: không cột TÊN org_id nên không là bảng tenant
  -- (public) và không thuộc khoản 85 (ngoài public); không RLS nên 83⑵/83⑶ im; (A)/[CR1]/(C) im. Một GRANT mở hàng của
  -- MỌI tổ chức (đo ở rls-coverage). S1.43 (ADR-037) đóng NỬA ĐO ĐƯỢC — bảng tenant ĐÃ KHAI rời tập theo hình dạng bị
  -- ⑴⑵⑸⑹ bắt; nửa GỐC (bảng MỚI chưa từng được khai hay neo) cần một đường TÍNH CHẤT, là mục này: bảng (r/p) trong
  -- lược đồ dự án, KHÔNG có cột org_id, có ít nhất một khoá ngoại MỘT CỘT — của chính nó hay của một TỔ TIÊN INHERITS
  -- (PostgreSQL không kế thừa khoá ngoại: con thừa cột mà không thừa ràng buộc, lượt soi 38 A2) — trỏ tới một BẢNG TENANT
  -- theo tính chất (MAU_VI_TU_BANG_TENANT: public, có org_id hay là gốc; cột đích nào cũng tính — mọi khoá ngoại tới bảng
  -- tenant đều buộc hàng vào một tổ chức, trực tiếp qua gốc hay gián tiếp qua org_id của bảng đích: `rfq uuid REFERENCES
  -- rfq_packages(id)` là cùng lớp, lượt soi 38 A1 — 008_suppliers.sql đã gọi `REFERENCES suppliers(id)` một cột là "LỖ
  -- THẬT" và mọi khoá ngoại thật của kho là hợp thành `(org_id, x)`), không thuộc VI_TU_CAN_CO_RLS và KHÔNG bật RLS ⇒
  -- PHẢI KHAI. Cùng cấu trúc và cùng mức bảo đảm với khoản 85 ("phát hiện ở deploy kế"); ba mục 85 / 86 / 83⑶ rời nhau:
  -- có org_id ⇒ 85 (ngoài public) hay vị từ tenant (public); bật RLS ⇒ 83⑶. Thứ tự (A)/86 không tạo kẽ: vị từ loại
  -- VI_TU_CAN_CO_RLS nên mục này không bao giờ đọc một bảng mà (A) sắp bật RLS (lượt soi 38 B2). KHÔNG nới
  -- VI_TU_BANG_TENANT (bán kính nổ ghi ở chú thích VI_TU_CAN_CO_RLS): mục này chỉ bắt hình dạng phải KHAI; cửa ra hợp lệ là
  -- đổi tên cột thành org_id (ở public thành bảng tenant — [CR1] đòi policy đúng khuôn, BANG_TENANT_KHAI + neo ADR-037 đòi
  -- khai; ngoài public — khoản 85), DROP, bật RLS (83⑶ — [CR1] không soi policy của bảng ấy, không FORCE: cửa yếu hơn,
  -- lượt soi 38 A3 → khoản 91), hay khai. Mục này cũng độc lập đóng đường đo S1.42 trên `users` (RENAME COLUMN org_id +
  -- DISABLE RLS + DROP policy): khoá ngoại `to_chuc -> organizations` vẫn một cột ⇒ kêu, kể cả khi ADR-037 ①② bị gỡ (38 C2).
  -- RANH GIỚI NÓI THẲNG: bảng đa tổ chức có cột uuid TRẦN (không khoá ngoại) tới tổ chức thì không tính chất catalog
  -- nào nhận diện — kể cả bảng đích của trigger plpgsql chép NEW (lượt soi 33a #13); đó là DDL cố ý bỏ ràng buộc tham
  -- chiếu, vế ⒝ của ADR-036 §3⑶, nhân chứng chỉ ở CI. ~~Khoá ngoại NHIỀU cột không tính (cùng vế array_length = 1 của gốc).~~
  -- [S1.48 / lượt soi ngang 40a H2] Gạch: khoá ngoại nhiều cột tới bảng tenant CŨNG tính (xem CAU_KHOA_NGOAI_TOI_TENANT).
  -- Khoá ngoại tới một bảng ĐÃ KHAI ở mục này hay ở 85 (bậc kế: `k.t2 (t_id REFERENCES k.t(id))`) không tính — đích
  -- không là bảng tenant theo tính chất; bao đóng trên đồ thị khoá ngoại là vòng khác. Lá phân mảnh: ràng buộc được nhân
  -- bản xuống lá (conparentid) nên TỪNG LÁ bị thấy và phải khai riêng — cùng khuôn 85, và đúng: lá có relrowsecurity
  -- riêng, đọc THẲNG lá theo policy của lá. Danh sách khai rỗng: lược đồ thật không có bảng như thế (cổng ở rls-coverage đo).
  BANG_KHOA_NGOAI_TENANT_KHAI constant text :=
    $q$(VALUES ('', '')) AS kt(nspname, relname)$q$;

  -- Câu tương quan theo `c`: mỗi khoá ngoại của c HAY của một tổ tiên INHERITS của c trỏ tới một bảng tenant — dùng ở CẢ
  -- vị từ (EXISTS) lẫn mô tả (string_agg), một văn bản. Bí danh `kn_fk` cố ý khác `fk` bên trong vế gốc lồng (38 D1).
  -- [S1.48 / lượt soi ngang 40a H2] KHÔNG đòi một cột: vế `array_length = 1` là của vị từ GỐC (phải biết cột nào là org_id);
  -- ở đây mọi khoá ngoại tới bảng tenant — kể cả hợp thành `(to_chuc, nguoi) REFERENCES users (org_id, id)`, đúng quy ước
  -- khoá ngoại của kho — đều buộc hàng vào một tổ chức. Bản S1.46 miễn nhiều cột và gọi đó là ranh giới: sai — đo ở
  -- rls-coverage (`zz_s.t_hop`). Cột in ra theo thứ tự conkey, nhiều cột thì trong ngoặc.
  CAU_KHOA_NGOAI_TOI_TENANT constant text :=
    $q$SELECT kc.cot, gn.nspname AS dich_nsp, g.relname AS dich_rel
         FROM pg_constraint kn_fk
         JOIN pg_class g ON g.oid = kn_fk.confrelid
         JOIN pg_namespace gn ON gn.oid = g.relnamespace
         CROSS JOIN LATERAL (
           SELECT CASE WHEN pg_catalog.array_length(kn_fk.conkey, 1) > 1 THEN '(' || x.ds || ')' ELSE x.ds END AS cot
             FROM (SELECT pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY k.ord) AS ds
                     FROM pg_catalog.unnest(kn_fk.conkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = kn_fk.conrelid AND a.attnum = k.attnum) x) kc
        WHERE kn_fk.contype = 'f'
          AND kn_fk.conrelid IN (
                WITH RECURSIVE to_tien(con, cha) AS (
                  SELECT ke.inhrelid, ke.inhparent FROM pg_inherits ke
                  UNION
                  SELECT tt.con, ke.inhparent FROM to_tien tt JOIN pg_inherits ke ON ke.inhrelid = tt.cha
                )
                SELECT c.oid UNION SELECT tt.cha FROM to_tien tt WHERE tt.con = c.oid)
          AND $q$ || pg_catalog.format(MAU_VI_TU_BANG_TENANT, 'gn', 'g');

  VI_TU_HINH_DANG_86 constant text :=
    $q$c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
       AND NOT $q$ || pg_catalog.format(MAU_VI_TU_CO_ORG_ID, 'c') || $q$
       AND EXISTS ($q$ || CAU_KHOA_NGOAI_TOI_TENANT || $q$)
       AND NOT $q$ || VI_TU_CAN_CO_RLS;

  CAU_KHOA_NGOAI_TENANT_SAI constant text :=
    $q$SELECT n.nspname || '.' || c.relname
              || ': bảng không có cột org_id nhưng có khoá ngoại tới bảng tenant (qua '
              || (SELECT pg_catalog.string_agg(kn.cot || ' -> ' || kn.dich_nsp || '.' || kn.dich_rel, ', ' ORDER BY kn.cot)
                    FROM ($q$ || CAU_KHOA_NGOAI_TOI_TENANT || $q$) kn)
              || ') và không bật RLS — chưa khai (khoản 86). Vị từ bảng tenant ghim TÊN cột org_id nên mục (A) không bật RLS, '
                 '[CR1] không soi, 85 không thấy, 83⑵/83⑶ không thấy: một GRANT cho vai ứng dụng mở hàng của mọi tổ chức (đo). '
                 'Sửa: một migration mới đổi tên cột ấy thành org_id (ở public thành bảng tenant — [CR1] đòi policy đúng khuôn, '
                 'BANG_TENANT_KHAI và neo ADR-037 đòi khai; ngoài public — khoản 85 đòi khai hay treo dưới bảng tenant; trên lá phân '
                 'mảnh thì đổi ở bảng gốc phân mảnh), hay DROP; hoặc khai (nspname, relname) vào BANG_KHOA_NGOAI_TENANT_KHAI kèm lý do '
                 'và bản ở db/rls-coverage.int.test.ts — mỗi dòng khai là một GRANT đọc xuyên tổ chức có điều kiện, cùng hạng '
                 'NGOAI_LE_HINH_DANG. Bật RLS lên nó chỉ chuyển lời khai sang 83⑶ ([CR1] không soi policy của bảng ấy, không FORCE).' AS mo_ta
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND $q$ || VI_TU_HINH_DANG_86 || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || BANG_KHOA_NGOAI_TENANT_KHAI || $q$
                           WHERE kt.nspname = n.nspname AND kt.relname = c.relname)
       UNION ALL
       SELECT 'khai ' || kt.nspname || '.' || kt.relname || ' là bảng không org_id có khoá ngoại tới bảng tenant, không RLS (khoản 86) '
              'mà CSDL không có bảng như thế — dòng khai thiu (bảng đã có cột org_id, đã bật RLS, hay đã bỏ khoá ngoại)' AS mo_ta
         FROM $q$ || BANG_KHOA_NGOAI_TENANT_KHAI || $q$
        -- chắn hàng sentinel ('', '') — cùng khuôn lượt soi 32 NHẸ-2 (to_regclass trên tên rỗng ném 42601 ở PG ≤ 15).
        WHERE kt.relname <> ''
          AND EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = kt.nspname AND zc.relname = kt.relname)
          AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = kt.nspname AND c.relname = kt.relname
                             AND $q$ || VI_TU_HINH_DANG_86 || $q$)$q$;

  -- ---- [S1.43 / khoản nợ 89 + 86] DANH TÍNH ĐỐI TƯỢNG CANH: NEO THEO oid QUA CHÚ THÍCH BẢNG + TÊN ĐÃ KHAI (ADR-037) ----
  -- Lượt soi ngang 33 đo hai đường đi qua mọi lớp: (a) RENAME bảng sổ + DROP trigger + CREATE TABLE cùng tên cùng
  -- hình dạng + DROP policy sót ⇒ migrate() OK, D2 dựng trigger lên bảng mới rỗng, lịch sử ở bảng cũ; (b) RENAME
  -- COLUMN org_id + DISABLE RLS + DROP hai policy trên users ⇒ migrate() OK, app_api đọc xuyên tổ chức. Cả hai vì
  -- mọi lớp nhận diện đối tượng bằng TÊN (BANG_CHI_GHI_THEM) hay HÌNH DẠNG (VI_TU_BANG_TENANT) — thứ chủ bảng tái
  -- tạo được. Ba kênh danh tính, mỗi kênh chịu một đường:
  --   ① CHÚ THÍCH BẢNG `neo: <schema>.<bảng>` (pg_description, objsubid 0) — sống theo OID qua RENAME / SET SCHEMA /
  --     RENAME COLUMN, mất khi DROP, KHÔNG được `CREATE TABLE (LIKE … INCLUDING ALL)` chép, được pg_dump chép theo
  --     bảng (sống qua khôi phục logic), đọc được qua catalog bởi mọi vai, ghi được bởi chủ bảng — không cần quyền nào
  --     khác. Bắt: bảng mang neo mà tên hiện tại lệch (⑴); mang neo mà hết là tenant theo tính chất (⑵).
  --   ② TÊN ĐÃ KHAI trong kho (BANG_TENANT_KHAI, kèm migration khai sinh; BANG_CHI_GHI_THEM cho sổ) — sống trong
  --     git, không cần quyền, không mất theo đối tượng. Bắt: tên đã khai không còn phân giải (⑸ — RENAME/SET
  --     SCHEMA/DROP không qua migration), tên còn mà hết là tenant theo tính chất (⑹ — đường CHÉP BẢNG bỏ cột org_id
  --     rồi đổi tên đè: dữ liệu không mất, lượt soi 34 NẶNG-3), tên còn mà chưa mang neo (⑶).
  --   ③ HÌNH DẠNG KHÔNG BỎ ĐƯỢC: bộ ba cột chuỗi (seq, prev_hash, hash) ngoài public.audit_events (⑷) và bộ ba mốc
  --     neo (seq, hash, anchored_at) ngoài public.audit_chain_anchors (⑷′) — bản sao do đổi tên hay chép, độc lập ①②.
  --     [lượt soi 35, CAO-1] "đủ 15 cột" (MAU_HINH_DANG_SO) là hình dạng BỎ ĐƯỢC: đổi tên một cột phụ là bản sao
  --     thoát; bộ ba chuỗi thì bỏ là hết giá trị sổ. Đổi tên một trong ba cột ấy là ranh giới nói thẳng (chủ bảng phá
  --     hình dạng sổ của chính bản sao — dữ liệu còn nhưng không còn là sổ).
  -- Bản đầu của vòng dùng một bảng app_private.neo_danh_tinh (migration 049) và bị chính bộ test bác: dưới hồ sơ N2
  -- (bootstrap superuser, vai deploy không superuser, không GRANT thêm) `to_regclass('app_private.…')` ném 42501 ở cột
  -- điều kiện và cả lượt sửa gãy; lượt soi 34 còn chỉ ra bảng neo do chính chủ thể bị canh sở hữu (DROP nó là mục im)
  -- và khôi phục logic cấp oid mới (mọi dòng neo lệch đúng lúc DR). Ba kênh trên không có ba lỗi ấy.
  -- Ranh giới nói thẳng: ① mạnh bằng quyền sở hữu bảng — chủ bảng cố ý gỡ chú thích thì lượt sửa ghi lại (kèm WARNING
  -- cho tên đã khai) và ⑴⑵ im, còn lại ②③; [lượt soi 35, CAO-2] CỤM ĐÃ BOOTSTRAP TRƯỚC S1.43 dưới hồ sơ N2 (bảng
  -- thuộc superuser, vai deploy không sở hữu): lượt sửa không ghi được neo ⇒ ⑶ chặn deploy đầu tiên — nói ra, không
  -- phải lỗi: chạy migrate() một lần bằng chủ bảng/superuser để ghi neo (test N2 nhánh 4 ghim hành vi này); DROP bảng tenant KHÔNG khai (fixture) rồi dựng lại cùng tên đi qua (tên không khai, dữ liệu mất nhìn
  -- thấy được); migration tạo bảng tenant mới PHẢI thêm tên vào BANG_TENANT_KHAI — cổng ở rls-coverage đòi bản khai
  -- bằng tập theo tính chất trên lược đồ thật; đổi tên/schema/dựng lại một bảng đã khai là việc của migration có chủ
  -- ý: cùng migration ấy sửa dòng khai và đặt lại chú thích neo. Chú thích bảng của bảng tenant/bảng sổ là KÊNH DÀNH
  -- RIÊNG — migration muốn chú thích thì chú thích cột.
  -- [lượt soi 35, NẶNG-5] Neo cả DANH TÍNH CỘT org_id (attnum): đổi tên cột rồi ADD COLUMN org_id mới DEFAULT <A> làm bảng
  -- vẫn "tenant theo tính chất" với policy đúng khuôn trên cột mới — mà hàng của mọi tổ chức nay mang cùng org_id. attnum
  -- của cột mới luôn khác cột cũ (attnum không tái dùng trong đời một bảng). %1$s = pg_namespace, %2$s = pg_class.
  MAU_NEO constant text :=
    $q$'neo: ' || pg_catalog.quote_ident(%1$s.nspname) || '.' || pg_catalog.quote_ident(%2$s.relname)
       || coalesce((SELECT ' org_id#' || a.attnum::text FROM pg_attribute a
                     WHERE a.attrelid = %2$s.oid AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped), '')$q$;

  -- Tập bảng tenant ĐÃ BIẾT ở S1.43, kèm TÊN TỆP migration khai sinh (chỉ phán xét khi đúng tệp ấy đã áp — tập rút gọn
  -- đi qua; khớp tiền tố ba chữ số là chưa đủ: test viết migration tạm `003_policy_…`, `005_…` — đo).
  BANG_TENANT_KHAI constant text :=
    $q$(VALUES
         ('public', 'audit_chain_anchors', '003_audit_events'),
         ('public', 'audit_events', '003_audit_events'),
         ('public', 'bid_receipts', '018_vendor_bids'),
         ('public', 'guest_sessions', '010_invitations'),
         ('public', 'invitation_otp_challenges', '010_invitations'),
         ('public', 'mfa_credentials', '006_sessions_and_mfa'),
         ('public', 'mfa_reset_requests', '040_dat_lai_totp_hai_nguoi'),
         ('public', 'org_procurement_policies', '014_procurement_policy'),
         ('public', 'organizations', '002_organizations_and_users'),
         ('public', 'otp_rate_limits', '010_invitations'),
         ('public', 'outbox_jobs', '007_outbox'),
         ('public', 'rfq_approvals', '009_rfq'),
         ('public', 'rfq_budgets', '014_procurement_policy'),
         ('public', 'rfq_invitation_tokens', '010_invitations'),
         ('public', 'rfq_invitations', '010_invitations'),
         ('public', 'rfq_items', '009_rfq'),
         ('public', 'rfq_key_material', '017_rfq_key_material'),
         ('public', 'rfq_packages', '009_rfq'),
         ('public', 'rfq_unsealed_bids', '019_unseal'),
         ('public', 'sessions', '006_sessions_and_mfa'),
         ('public', 'supplier_contacts', '008_suppliers'),
         ('public', 'suppliers', '008_suppliers'),
         ('public', 'unseal_approvals', '019_unseal'),
         ('public', 'unseal_requests', '019_unseal'),
         ('public', 'user_login_tokens', '029_dang_nhap_nguoi_mua'),
         ('public', 'user_roles', '005_identity'),
         ('public', 'users', '002_organizations_and_users'),
         ('public', 'vendor_bid_versions', '018_vendor_bids'),
         ('public', 'vendor_bids', '018_vendor_bids')
       ) AS bt(nspname, relname, mig)$q$;

  -- Tập lượt SỬA ghi neo: bảng tenant theo tính chất, và hai bảng sổ (tên ở BANG_CHI_GHI_THEM, ở public).
  VI_TU_PHAI_NEO constant text :=
    $q$(($q$ || VI_TU_BANG_TENANT || $q$)
        OR (n.nspname = 'public' AND c.relkind = 'r'
            AND c.relname IN (SELECT b.ten FROM $q$ || BANG_CHI_GHI_THEM || $q$)))$q$;

  -- Lượt SỬA: ghi neo cho bảng phải neo mà CHƯA CÓ chú thích nào (chú thích khác chiếm chỗ thì không ghi đè — ⑶ nêu
  -- ra). 42501 (không sở hữu) nuốt từng bảng, BƯỚC 3 phán xét. Đơn điệu: chỉ thêm, không bao giờ xoá.
  -- [S1.45 / khoản nợ 90 — lượt soi 37 NHẸ-4] Cùng vế ⒝ của `bang_so`: tên hiện tại đang được một quan hệ KHÁC giữ
  -- danh tính (neo theo oid) thì KHÔNG trao neo cho bản chiếm tên — nếu trao, sau khi bảng gốc mất neo/bị DROP bản sao
  -- đã sẵn neo hợp lệ và ⑴⑵⑶ im, chuỗi hash "bắt đầu lại" trên sổ rỗng mà dấu vết duy nhất là một WARNING của deploy
  -- trước. Bản sao ở lại ⑶ ("chưa mang neo", lối ra trong thông điệp) cho tới một quyết định có chủ ý; WARNING nêu oid
  -- đang giữ tên.
  CAU_NEO_SUA constant text :=
    $q$DO $neo$
       DECLARE r record;
       BEGIN
         FOR r IN SELECT n.nspname, c.relname,
                         $q$ || pg_catalog.format(MAU_NEO, 'n', 'c') || $q$ AS neo_moi,
                         EXISTS (SELECT 1 FROM $q$ || BANG_TENANT_KHAI || $q$
                                  WHERE bt.nspname = n.nspname AND bt.relname = c.relname) AS da_khai,
                         (SELECT k.oid::regclass::text FROM pg_class k JOIN pg_namespace kn ON kn.oid = k.relnamespace
                           WHERE k.oid <> c.oid AND k.relkind IN ('r', 'p')
                             AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'kn') || $q$
                             AND pg_catalog.split_part(pg_catalog.obj_description(k.oid, 'pg_class'), ' org_id#', 1)
                                 = 'neo: ' || pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname)
                           LIMIT 1) AS giu_boi
                    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE $q$ || VI_TU_PHAI_NEO || $q$
                     AND pg_catalog.obj_description(c.oid, 'pg_class') IS NULL
         LOOP
           IF r.giu_boi IS NOT NULL THEN
             RAISE WARNING 'Hardening: KHÔNG ghi neo cho %.% — tên ấy đang được % giữ danh tính (neo theo oid, khoản 90); quan hệ '
                           'mang tên là bản chiếm tên cho tới một migration có chủ ý (dòng ⑶ của mục danh tính nêu lối ra).',
                           r.nspname, r.relname, r.giu_boi;
             CONTINUE;
           END IF;
           BEGIN
             EXECUTE pg_catalog.format('COMMENT ON TABLE %I.%I IS %L', r.nspname, r.relname, r.neo_moi);
             -- [lượt soi 35, NHẸ-7] tên ĐÃ KHAI nhận neo MỚI là dấu vết duy nhất của một oid đổi (bảng dựng lại/chép đè)
             -- hay một chú thích bị gỡ: nói ra, đừng ghi im.
             IF r.da_khai THEN
               RAISE WARNING 'Hardening: bảng đã khai %.% nhận neo MỚI (%) — oid đổi (dựng lại/chép đè) hay chú thích neo bị gỡ; '
                             'nếu không phải deploy đầu của S1.43 thì đây là một lần TRÔI phải điều tra.', r.nspname, r.relname, r.neo_moi;
             END IF;
           EXCEPTION WHEN insufficient_privilege THEN NULL;
           END;
         END LOOP;
       END $neo$$q$;

  CAU_NEO_SAI constant text :=
    $q$WITH q AS (
         SELECT c.oid, n.nspname, c.relname,
                pg_catalog.obj_description(c.oid, 'pg_class') AS neo,
                $q$ || pg_catalog.format(MAU_NEO, 'n', 'c') || $q$ AS neo_dung,
                ($q$ || VI_TU_BANG_TENANT || $q$) AS la_tenant
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p') AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$),
       khai AS (
         SELECT bt.nspname, bt.relname, 'bảng tenant đã khai (migration ' || bt.mig || ')' AS loai
           FROM $q$ || BANG_TENANT_KHAI || $q$
          WHERE EXISTS (SELECT 1 FROM public.schema_migrations sm WHERE sm.version = bt.mig || '.sql')
         UNION ALL
         SELECT 'public', b.ten, 'bảng sổ'
           FROM $q$ || BANG_CHI_GHI_THEM || $q$
          WHERE EXISTS (SELECT 1 FROM public.schema_migrations sm WHERE sm.version = '003_audit_events.sql')
            AND NOT EXISTS (SELECT 1 FROM $q$ || BANG_TENANT_KHAI || $q$ WHERE bt.nspname = 'public' AND bt.relname = b.ten)),
       hd AS (
         SELECT c.oid, n.nspname, c.relname,
                (SELECT pg_catalog.count(*) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                   AND a.attname IN ('seq', 'prev_hash', 'hash')) AS chuoi,
                (SELECT pg_catalog.count(*) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                   AND a.attname IN ('seq', 'hash', 'anchored_at')) AS moc
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          -- [S1.48 / lượt soi ngang 40a I6] 'p' cùng 'r': bản sao PHÂN MẢNH của sổ (`… PARTITION BY RANGE (seq)`) mang bộ ba cột
          -- ở cha lẫn lá; bản S1.43 chỉ 'r' nên cha vô hình với ⑷ (lá vẫn bị) — nhất quán với `q` ở trên.
          WHERE c.relkind IN ('r', 'p') AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$)
       SELECT x.ten || ': ' || x.mo_ta
              || ' (khoản 89/86, ADR-037). Sửa: một migration mới đổi lại; hoặc — nếu đổi có chủ ý — cùng migration ấy '
                 'sửa dòng khai và đặt lại chú thích neo (COMMENT ON TABLE … IS NULL rồi migrate() ghi lại).' AS mo_ta
         FROM (
           -- ⑴ mang neo mà TÊN hiện tại lệch: RENAME / SET SCHEMA ngoài migration. [lượt soi 35, NẶNG-3] không parse chú
           --    thích (chuỗi do chủ bảng đặt — to_regclass ném 42601/42501 thô): đối chiếu catalog để tìm quan hệ đang
           --    mang đúng tên đã neo.
           SELECT q.nspname || '.' || q.relname AS ten,
                  -- [S1.48 / lượt soi ngang 40a I7] chuỗi do chủ bảng đặt: cắt 80 ký tự, lọc ký tự điều khiển — thông điệp đi vào log.
                  'mang neo "' || pg_catalog.left(pg_catalog.regexp_replace(q.neo, '[[:cntrl:]]', ' ', 'g'), 80) || '" nhưng tên hiện tại là ' || q.nspname || '.' || q.relname
                  || ' — đổi tên hay đổi schema ngoài migration'
                  || coalesce((SELECT '; tên đã neo hiện do oid ' || q2.oid::text || ' giữ — một trong hai là bản sao'
                                 FROM q q2
                                WHERE pg_catalog.split_part(q2.neo_dung, ' org_id#', 1) = pg_catalog.split_part(q.neo, ' org_id#', 1)
                                  AND q2.oid <> q.oid LIMIT 1), '') AS mo_ta
             FROM q
            WHERE q.neo LIKE 'neo: %'
              AND pg_catalog.split_part(q.neo, ' org_id#', 1) <> pg_catalog.split_part(q.neo_dung, ' org_id#', 1)
           UNION ALL
           -- ⑵ mang neo mà không còn là tenant theo tính chất
           SELECT q.nspname || '.' || q.relname,
                  'mang neo nhưng KHÔNG CÒN là bảng tenant theo tính chất (mất cột org_id hay khoá ngoại org_id trỏ tới nó) — '
                  'mọi lớp RLS rời khỏi nó trong khi dữ liệu còn nguyên'
             FROM q
            WHERE q.neo LIKE 'neo: %'
              AND pg_catalog.split_part(q.neo, ' org_id#', 1) = pg_catalog.split_part(q.neo_dung, ' org_id#', 1)
              AND NOT q.la_tenant
           UNION ALL
           -- ⑵′ [lượt soi 35, NẶNG-5] cùng tên, còn là tenant, nhưng CỘT org_id không còn là cột đã neo (attnum khác):
           --    đổi tên cột rồi thêm cột org_id mới — policy đúng khuôn trên cột mới, hàng mọi tổ chức mang cùng giá trị
           SELECT q.nspname || '.' || q.relname,
                  'cột org_id đã neo là attnum ' || coalesce(nullif(pg_catalog.split_part(q.neo, ' org_id#', 2), ''), '(không có)')
                  || ' nhưng cột org_id hiện tại là attnum '
                  || coalesce(nullif(pg_catalog.split_part(q.neo_dung, ' org_id#', 2), ''), '(không có)')
                  || ' — cột đã bị đổi tên rồi thay bằng cột mới: RLS trỏ vào một cột không phải cột dữ liệu đã neo'
             FROM q
            WHERE q.neo LIKE 'neo: %'
              AND pg_catalog.split_part(q.neo, ' org_id#', 1) = pg_catalog.split_part(q.neo_dung, ' org_id#', 1)
              AND q.la_tenant
              AND pg_catalog.split_part(q.neo, ' org_id#', 2) <> pg_catalog.split_part(q.neo_dung, ' org_id#', 2)
           UNION ALL
           -- ⑶ tên đã khai/bảng sổ còn đó mà chưa mang neo — lời trung tính [lượt soi 35, NHẸ-7]: chú thích bị gỡ, oid mới
           --    (bảng dựng lại/chép đè), hay lượt sửa không sở hữu bảng (cụm bootstrap trước S1.43, vai deploy không sở
           --    hữu — lượt soi 35 CAO-2: deploy đầu của S1.43 trên cụm cũ phải chạy hardening MỘT LẦN bằng chủ bảng/superuser)
           SELECT q.nspname || '.' || q.relname,
                  k.loai || ' CHƯA MANG NEO'
                  || CASE WHEN q.neo IS NULL
                          THEN ' — chú thích neo bị gỡ, oid mới (bảng dựng lại/chép đè), hay lượt sửa không sở hữu bảng '
                               '(cụm bootstrap trước S1.43: chạy migrate() một lần bằng chủ bảng/superuser để ghi neo)'
                          ELSE ' (chú thích hiện tại: "' || pg_catalog.left(q.neo, 60)
                               || '" — chú thích bảng là kênh neo, dòng khác đang chiếm chỗ)' END
             FROM khai k JOIN q ON q.nspname = k.nspname AND q.relname = k.relname
            WHERE q.neo IS NULL OR q.neo NOT LIKE 'neo: %'
           UNION ALL
           -- ⑷ [lượt soi 35, CAO-1] hình dạng là thứ KHÔNG BỎ ĐƯỢC mà còn giá trị: bộ ba cột chuỗi (seq, prev_hash, hash)
           --    ngoài public.audit_events — bản sao sổ do đổi tên hay chép; không tựa vào chú thích lẫn tên
           SELECT hd.nspname || '.' || hd.relname,
                  'mang bộ ba cột chuỗi sổ (seq, prev_hash, hash) nhưng không phải public.audit_events — một bản sao sổ '
                  'ngoài tên sổ (đổi tên rồi dựng lại, hay chép); mục này không tựa vào chú thích'
             FROM hd
            WHERE hd.chuoi = 3 AND NOT (hd.nspname = 'public' AND hd.relname = 'audit_events')
           UNION ALL
           -- ⑷′ [lượt soi 35, NẶNG-4] bộ ba mốc neo (seq, hash, anchored_at) ngoài public.audit_chain_anchors
           SELECT hd.nspname || '.' || hd.relname,
                  'mang bộ ba cột mốc neo (seq, hash, anchored_at) nhưng không phải public.audit_chain_anchors — một bản sao '
                  'bảng mốc neo ngoài tên'
             FROM hd
            WHERE hd.moc = 3 AND NOT (hd.nspname = 'public' AND hd.relname = 'audit_chain_anchors')
           UNION ALL
           -- ⑸ tên đã khai không còn phân giải thành bảng
           SELECT k.nspname || '.' || k.relname,
                  k.loai || ' KHÔNG CÒN dưới tên ấy (đổi tên, đổi schema hay DROP ngoài migration)'
             FROM khai k
            WHERE NOT EXISTS (SELECT 1 FROM q WHERE q.nspname = k.nspname AND q.relname = k.relname)
           UNION ALL
           -- ⑹ tên đã khai còn đó mà không còn là tenant theo tính chất — kể cả bảng CHÉP đè lên tên cũ
           SELECT q.nspname || '.' || q.relname,
                  k.loai || ' KHÔNG CÒN là bảng tenant theo tính chất (mất cột org_id — đổi tên cột, hay một bảng chép '
                  'bỏ cột ấy được dựng đè lên tên cũ) — mọi lớp RLS rời khỏi nó trong khi dữ liệu còn nguyên'
             FROM khai k JOIN q ON q.nspname = k.nspname AND q.relname = k.relname
            WHERE NOT q.la_tenant
         ) x$q$;

  -- ---- [S1.39 / khoản nợ 83 — nửa catalog ⑷⑸⑹⑺⑧] NĂM MỤC PHÁN XÉT CÒN LẠI CỦA ADR-036 §3⑶ -----------
  -- Tiêu chí §3⑶ (S1.37): cơ chế mà chủ bảng không superuser tạo được và catalog phân biệt được tĩnh thì
  -- PHẢI có mục hardening. Năm cơ chế còn lại chỉ có tổng điều tra ở test (`hardening-suy-tu-tinh-chat`):
  --   ⑷ ADR-036 hàng 10 — VIEW mang trigger INSTEAD OF (trả NULL là nuốt hàng), MATERIALIZED VIEW, BẢNG
  --      NGOÀI (ghi ra cụm khác) trong lược đồ dự án — khai đích danh ở QUAN_HE_KHAC_KHAI (rỗng). View
  --      KHÔNG có trigger INSTEAD OF không bị phán: DML đi thẳng xuống bảng gốc (view `security_invoker`
  --      hợp lệ của [I2] đi qua); bảng phân mảnh (`p`) không bị phán: lá được H19 canh riêng ([review lượt
  --      12, H1]) và fixture [CR2] là khuôn PostgreSQL chuẩn.
  --   ⑸ hàng 21 — trigger gọi hàm KHÔNG plpgsql (`internal`/C/PL khác): vô hình với tổng điều tra hàm, vị từ
  --      chỉ-ghi-thêm và nhân chứng (đều lọc `lanname = 'plpgsql'`). Đo (S1.37): chủ bảng thường gắn được
  --      `suppress_redundant_updates_trigger()` không cần tạo hàm, và extension tin cậy `tcn` cài được.
  --      Khai đích danh ở TRIGGER_NGOAI_PLPGSQL_KHAI (rỗng). FK `RI_FKey_*` là tgisinternal — không xét.
  --   ⑹ hàng 3 TỔNG QUÁT — RULE trên MỌI quan hệ của dự án (không chỉ bảng sổ/bảng chỉ-ghi-thêm suy ra):
  --      `DO INSTEAD NOTHING` trên `sessions` sống qua migrate() (đo, S1.37). Trừ `_RETURN` của view. Khai
  --      đích danh ở RULE_KHAI (rỗng). Rule trên bảng sổ được BƯỚC 2 tự gỡ trước khi mục này đọc catalog.
  --   ⑺ hàng 2 / khoản nợ 75 — hàm canh (hình dạng: thân không RETURN, hoặc khai tên) gắn ở hình thức KHÁC
  --      `BEFORE … FOR EACH ROW` trên INSERT/UPDATE/DELETE: bảng thành chỉ-ghi-thêm mà vị từ không nhận, nên
  --      LOGGED/chốt TRUNCATE/ACL không ai canh. Trigger TRUNCATE (cấp câu lệnh) của hàm canh là chốt, hợp lệ.
  --   ⑧ tiền đề SUSET của hàng 8 — `pg_parameter_acl`: một `GRANT SET ON PARAMETER session_replication_role TO
  --      app_api` lúc bootstrap sống qua mọi migrate() và biến `ENABLE ALWAYS` thành lớp duy nhất (lượt soi
  --      28 NHẸ-5). Không danh sách khai: vai ứng dụng không bao giờ được cấp quyền trên tham số.
  -- Cả năm PHÁN XÉT (ADR-028 §2⑵). Chiều ngược (khai mà không còn) chỉ khi đối tượng cha tồn tại — bài học
  -- lượt soi 29 CAO-1. Bản test giữ cùng ba danh sách và một cổng đòi hai bản khớp qua bộ giải hằng.
  QUAN_HE_KHAC_KHAI constant text :=
    $q$(VALUES ('', '')) AS q(nspname, relname)$q$;

  TRIGGER_NGOAI_PLPGSQL_KHAI constant text :=
    $q$(VALUES ('', '', '')) AS g(nspname, relname, tgname)$q$;

  RULE_KHAI constant text :=
    $q$(VALUES ('', '', '')) AS r(nspname, relname, rulename)$q$;

  -- ---- [S1.40 / khoản nợ 82⑴] MỤC PHÁN XÉT THỨ SÁU: TIỀN ĐỀ CỦA `NO INHERIT` (ADR-036 hàng 22) ----------
  -- Hàng 22: `ALTER TABLE con NO INHERIT cha` (chủ bảng con làm được) đưa hàng đang ở con ra khỏi tầm câu ghi
  -- qua cha — UPDATE/DELETE qua cha 0 hàng, không lỗi (đo S1.35, đo lại S1.40). SAU cú tách catalog không còn
  -- dấu vết: con là `relkind 'r'` hợp lệ, không hàng pg_inherits, mọi tổng điều tra xanh. Thứ phân biệt được
  -- TĨNH là TIỀN ĐỀ — một cặp kế thừa cổ điển đang tồn tại — cùng khuôn ⑧ (tiền đề SUSET của hàng 8). Khai
  -- đích danh (con, cha) ở KE_THUA_KHAI; RỖNG là một lời khai: dự án không dùng INHERITS. Chiều ngược — khai mà
  -- không còn cặp — chỉ khi CẢ HAI bảng còn (bài học lượt soi 29): đó là dấu vết của một NO INHERIT trên cặp đã
  -- khai KHI TÊN KHÔNG ĐƯỢC TÁI DÙNG. [lượt soi 31, NHẸ-1] Khai theo TÊN chỉ đóng băng lời khai, không đóng băng
  -- đối tượng: chủ bảng (sở hữu cả cha lẫn con) làm được NO INHERIT → RENAME con cũ → CREATE con mới cùng tên
  -- INHERITS cha (rỗng) → DISABLE RLS trên con cũ; cả hai chiều im, hàng cũ nằm ở con cũ ngoài mọi mục — đúng bậc
  -- tự do "bảng org_id ngoài public không treo dưới tenant" ghi ở VI_TU_CAN_CO_RLS. Kẽ này NGỦ chừng nào
  -- KE_THUA_KHAI rỗng; một dòng khai INHERITS là một quyết định an ninh cùng hạng NGOAI_LE_HINH_DANG, không phải
  -- một dòng cấu hình. Phân mảnh (relispartition — lá lẫn chỉ mục phân mảnh) không xét, và DETACH PARTITION là
  -- CÙNG CƠ CHẾ hàng 22 ở vị trí khác [lượt soi 31, NHẸ-3] với ba tầng: lá ở public ⇒ bảng tenant độc lập, [CR1]
  -- bắt (test [Minor] DETACH); lá ngoài public đã có RLS (mục (A) lần trước) ⇒ 83⑶ bắt; lá ngoài public tạo-và-
  -- tách giữa hai lần deploy ⇒ bậc tự do đã khai ở trên. Bảng TẠM kế thừa bảng thật không xét [lượt soi 31,
  -- NHẸ-4]: nó là của riêng phiên (xem VI_TU_CAN_CO_RLS), cha không thể là bảng tạm ("cannot inherit from
  -- temporary relation"), nên lọc theo CON là đủ. GIỚI HẠN NÓI THẲNG: mục này canh tiền đề, không canh cú tách —
  -- cặp CHƯA KHAI bị tách thì mục im (không còn gì để phán); lớp cho trường hợp ấy là chính việc cặp chưa khai đã
  -- chặn deploy từ trước. §3⑶ ⒜ [lượt soi 31, INFO-6]: hàng 22 đã được §3⑶ (S1.37) đặt ở khoản 82 — một khoản mở
  -- có địa chỉ, không phải sót; S1.39 nói "trọn" khi 82 còn mở, và cái catalog phân biệt được ở 22 là TIỀN ĐỀ,
  -- không phải cơ chế. HỆ QUẢ ĐO ĐƯỢC: hai fixture INHERITS của migrations.int.test.ts (con_khac, con_tt) trước
  -- mong migrate() đi qua, nay NÉM ở mục này. Bằng chứng "miễn policy riêng còn nguyên" là con_tt và `public.g`
  -- của test khoản 84 (cả hai ở public) — [CR1] không soi ngoài public nên con_khac không phải bằng chứng
  -- [lượt soi 31, NHẸ-2].
  KE_THUA_KHAI constant text :=
    $q$(VALUES ('', '', '', '')) AS k(con_nspname, con_relname, cha_nspname, cha_relname)$q$;

  CAU_QUAN_HE_KHAC_SAI constant text :=
    $q$SELECT n.nspname || '.' || c.relname || ': '
              || CASE c.relkind WHEN 'f' THEN 'BẢNG NGOÀI (ghi ra cụm khác)'
                                WHEN 'm' THEN 'MATERIALIZED VIEW (không phải đích DML — vật liệu hoá đọc, xem cả mục (C))'
                                WHEN 'v' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid
                                                                    AND NOT t.tgisinternal AND (t.tgtype & 64) <> 0)
                                                   THEN 'VIEW có trigger INSTEAD OF (trả NULL là nuốt hàng)'
                                                   ELSE 'VIEW có trigger cấp câu lệnh' END
                                ELSE c.relkind::text END
              || ' trong lược đồ dự án chưa khai (khoản 83⑷, ADR-036 hàng 10) — một đích DML không phải bảng thường '
                 'đứng ngoài mọi lớp của H19. Sửa: một migration mới bỏ nó, hoặc khai (nspname, relname) vào '
                 'QUAN_HE_KHAC_KHAI kèm lý do và bản ở db/hardening-suy-tu-tinh-chat.int.test.ts.' AS mo_ta
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND (c.relkind IN ('f', 'm')
               OR (c.relkind = 'v' AND EXISTS (SELECT 1 FROM pg_trigger t
                                                 WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)))
          AND NOT EXISTS (SELECT 1 FROM $q$ || QUAN_HE_KHAC_KHAI || $q$
                           WHERE q.nspname = n.nspname AND q.relname = c.relname)
       UNION ALL
       SELECT 'khai ' || q.nspname || '.' || q.relname || ' (khoản 83⑷) mà CSDL không có quan hệ như thế — dòng khai thiu' AS mo_ta
         FROM $q$ || QUAN_HE_KHAC_KHAI || $q$
        WHERE q.relname <> ''
          -- [lượt soi 30, NHẸ-1] "cha" của một quan hệ là schema: chỉ kêu khi schema đã có (tập migration rút gọn).
          AND EXISTS (SELECT 1 FROM pg_namespace ns WHERE ns.nspname = q.nspname)
          AND NOT EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = q.nspname AND zc.relname = q.relname)$q$;

  CAU_TRIGGER_NGOAI_PLPGSQL_SAI constant text :=
    $q$SELECT n.nspname || '.' || c.relname || '.' || t.tgname || ': trigger gọi hàm ' || p.oid::regprocedure::text
              || ' ngôn ngữ ' || l.lanname::text
              || ' — không phải plpgsql (khoản 83⑸, ADR-036 hàng 21): vô hình với tổng điều tra hàm, vị từ chỉ-ghi-thêm '
                 'và nhân chứng hành vi (đo: suppress_redundant_updates_trigger làm UPDATE ra 0 hàng không lỗi). Sửa: '
                 'một migration mới viết lại bằng plpgsql, hoặc khai (nspname, relname, tgname) vào TRIGGER_NGOAI_PLPGSQL_KHAI '
                 'kèm lý do và bản ở db/hardening-suy-tu-tinh-chat.int.test.ts.' AS mo_ta
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
         JOIN pg_language l ON l.oid = p.prolang
        WHERE NOT t.tgisinternal
          AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND l.lanname <> 'plpgsql'
          AND NOT EXISTS (SELECT 1 FROM $q$ || TRIGGER_NGOAI_PLPGSQL_KHAI || $q$
                           WHERE g.nspname = n.nspname AND g.relname = c.relname AND g.tgname = t.tgname)
       UNION ALL
       SELECT 'khai ' || g.nspname || '.' || g.relname || '.' || g.tgname || ' (khoản 83⑸) mà CSDL không có trigger như thế — dòng khai thiu' AS mo_ta
         FROM $q$ || TRIGGER_NGOAI_PLPGSQL_KHAI || $q$
        WHERE g.tgname <> ''
          AND EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = g.nspname AND zc.relname = g.relname)
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = (SELECT zc.oid FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = g.nspname AND zc.relname = g.relname) AND t.tgname = g.tgname)$q$;

  CAU_RULE_SAI constant text :=
    $q$SELECT n.nspname || '.' || c.relname || '.' || rw.rulename || ': RULE trên một quan hệ của dự án (khoản 83⑹, ADR-036 hàng 3) — '
                 'một rule viết lại câu lệnh TRƯỚC khi trigger nào chạy: DO INSTEAD NOTHING làm câu ghi ra 0 hàng không lỗi '
                 'ở MỌI bảng, không chỉ bảng chỉ-ghi-thêm (đo: rule trên sessions sống qua migrate()). Dự án không dùng RULE. '
                 'Sửa: một migration mới DROP RULE, hoặc khai (nspname, relname, rulename) vào RULE_KHAI kèm lý do.' AS mo_ta
         FROM pg_rewrite rw
         JOIN pg_class c ON c.oid = rw.ev_class
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND rw.rulename <> '_RETURN'
          AND NOT EXISTS (SELECT 1 FROM $q$ || RULE_KHAI || $q$
                           WHERE r.nspname = n.nspname AND r.relname = c.relname AND r.rulename = rw.rulename)
       UNION ALL
       SELECT 'khai ' || r.nspname || '.' || r.relname || '.' || r.rulename || ' (khoản 83⑹) mà CSDL không có rule như thế — dòng khai thiu' AS mo_ta
         FROM $q$ || RULE_KHAI || $q$
        WHERE r.rulename <> ''
          AND EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = r.nspname AND zc.relname = r.relname)
          AND NOT EXISTS (SELECT 1 FROM pg_rewrite rw
                           WHERE rw.ev_class = (SELECT zc.oid FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = r.nspname AND zc.relname = r.relname) AND rw.rulename = r.rulename)$q$;

  -- [S1.44 / khoản 88 ⑶] Trên bảng có tên, D2 dựng lại trigger trước — xem chú thích ở CAU_TRIGGER_CANH_CO_DIEU_KIEN;
  -- mục này chịu lực cho bảng suy ra.
  CAU_HAM_CANH_HINH_THUC_SAI constant text :=
    $q$SELECT t.tgrelid::regclass::text || '.' || t.tgname::text || ': trigger của hàm canh ' || p.oid::regprocedure::text
              || ' ở hình thức ' || CASE WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF' WHEN (t.tgtype & 2) = 0 THEN 'AFTER' ELSE 'BEFORE' END
              || ' ' || CASE WHEN (t.tgtype & 1) = 1 THEN 'FOR EACH ROW' ELSE 'FOR EACH STATEMENT' END
              || ' — hàm canh chỉ được gắn BEFORE … FOR EACH ROW trên INSERT/UPDATE/DELETE (khoản 83⑺, khoản nợ 75, ADR-036 hàng 2): ở hình '
                 'thức khác nó vẫn chặn mọi câu (bảng thành chỉ-ghi-thêm) nhưng vị từ chỉ-ghi-thêm không nhận bảng, nên '
                 'LOGGED / chốt TRUNCATE / ACL không ai canh (trigger BEFORE TRUNCATE FOR EACH STATEMENT của hàm canh là chốt, hợp lệ, '
                 'không bị mục này phán). Sửa: một migration mới dựng lại trigger đúng hình thức.' AS mo_ta
         FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal
          AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'n') || $q$
          AND $q$ || VI_TU_HAM_CANH_HINH_DANG || $q$
          AND (t.tgtype & 28) <> 0
          AND (t.tgtype & 3) <> 3$q$;

  CAU_PARAMETER_ACL_SAI constant text :=
    $q$SELECT pa.parname::text || ': quyền ' || a.privilege_type || ' trên tham số cấp cho '
              || CASE WHEN r.rolname IS NULL THEN 'PUBLIC' ELSE r.rolname::text END
              || ' (khoản 83⑧) — tiền đề SUSET của ADR-036 hàng 8: vai ứng dụng đặt được session_replication_role = replica '
                 -- [S1.48 / lượt soi ngang 40b #17] "chỉ superuser đặt được" là ranh giới nói ra: superuser GRANT SET ON PARAMETER
                 -- session_replication_role cho một vai thứ ba thì 83⑧ (chỉ soi PUBLIC/vai ứng dụng) lẫn nhánh ⒟ của 87 (chỉ tham số có
                 -- dấu chấm) đều không thấy — ~~tiền tồn, chưa có khoản.~~ [S1.52] khoản 95 đóng: nhánh ⒟ của CAU_GUC_VAN_HANH_GAN_SAN.
                 'thì mọi trigger ENABLE thường bị bỏ qua; lớp ENABLE ALWAYS tựa vào việc tham số ấy chỉ superuser đặt được. '
                 'Sửa: REVOKE … ON PARAMETER (superuser).' AS mo_ta
         FROM pg_parameter_acl pa
         CROSS JOIN LATERAL aclexplode(pa.paracl) a
         LEFT JOIN pg_roles r ON r.oid = a.grantee
        -- [lượt soi 30, NHẸ-3] tập vai theo tính chất (VAI_KET_NOI_UNG_DUNG); một dòng ACL bị phán khi grantee là PUBLIC,
        -- là vai ứng dụng, hay là một NHÓM mà vai ứng dụng là thành viên (pg_has_role bắc cầu) — thấy cả quyền đến qua
        -- nhóm mà BƯỚC 1 chưa gỡ, và không kê dòng của người cấp (superuser).
        WHERE a.grantee = 0
           OR EXISTS (SELECT 1 FROM ($q$ || VAI_KET_NOI_UNG_DUNG || $q$) v
                        JOIN pg_roles vr ON vr.rolname = v.rolname
                       WHERE pg_catalog.pg_has_role(vr.oid, a.grantee, 'USAGE'))$q$;

  CAU_KE_THUA_SAI constant text :=
    $q$SELECT cn.nspname || '.' || cc.relname || ' INHERITS ' || pn.nspname || '.' || pc.relname
              || ': cặp kế thừa cổ điển (không phải phân mảnh) trong lược đồ dự án chưa khai (khoản 82⑴, ADR-036 hàng 22) — '
                 'ALTER TABLE con NO INHERIT cha (chủ bảng con làm được) đưa hàng ở con ra khỏi tầm câu ghi qua cha: UPDATE/DELETE '
                 'qua cha 0 hàng không lỗi, con vẫn là bảng thường hợp lệ với mọi tổng điều tra (đo). Dự án không dùng INHERITS. '
                 'Sửa: một migration mới bỏ kế thừa, hoặc khai (con, cha) vào KE_THUA_KHAI kèm lý do và bản ở '
                 'db/hardening-suy-tu-tinh-chat.int.test.ts.' AS mo_ta
         FROM pg_inherits ke
         JOIN pg_class cc ON cc.oid = ke.inhrelid
         JOIN pg_namespace cn ON cn.oid = cc.relnamespace
         JOIN pg_class pc ON pc.oid = ke.inhparent
         JOIN pg_namespace pn ON pn.oid = pc.relnamespace
        WHERE NOT cc.relispartition
          AND $q$ || pg_catalog.format(MAU_SCHEMA_DU_AN, 'cn') || $q$
          AND NOT EXISTS (SELECT 1 FROM $q$ || KE_THUA_KHAI || $q$
                           WHERE k.con_nspname = cn.nspname AND k.con_relname = cc.relname
                             AND k.cha_nspname = pn.nspname AND k.cha_relname = pc.relname)
       UNION ALL
       SELECT 'khai ' || k.con_nspname || '.' || k.con_relname || ' INHERITS ' || k.cha_nspname || '.' || k.cha_relname
              || ' (khoản 82⑴) mà CSDL không còn cặp kế thừa như thế — dòng khai thiu, hoặc chính cơ chế ADR-036 hàng 22 '
                 'đã xảy ra (con đã NO INHERIT)' AS mo_ta
         FROM $q$ || KE_THUA_KHAI || $q$
        WHERE k.con_relname <> ''
          AND EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = k.con_nspname AND zc.relname = k.con_relname)
          AND EXISTS (SELECT 1 FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = k.cha_nspname AND zc.relname = k.cha_relname)
          -- [lượt soi 31, INFO-7] đối xứng với chiều xuôi: một dòng khai trỏ vào cặp PHÂN MẢNH là dòng khai thiu.
          AND NOT EXISTS (SELECT 1 FROM pg_inherits ke JOIN pg_class cc ON cc.oid = ke.inhrelid
                           WHERE NOT cc.relispartition
                             AND ke.inhrelid = (SELECT zc.oid FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = k.con_nspname AND zc.relname = k.con_relname)
                             AND ke.inhparent = (SELECT zc.oid FROM pg_class zc JOIN pg_namespace zn ON zn.oid = zc.relnamespace WHERE zn.nspname = k.cha_nspname AND zc.relname = k.cha_relname))$q$;

  CAU_QUAN_HE_TRUNG_TEN constant text :=
    $q$FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
            ($q$ || VAI_KET_NOI_UNG_DUNG || $q$) v
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND n.nspname NOT IN ('public', 'pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg\_%'
        AND pg_catalog.has_schema_privilege(v.rolname, n.oid, 'USAGE')
        AND EXISTS (SELECT 1 FROM pg_class p JOIN pg_namespace pn ON pn.oid = p.relnamespace
                     WHERE pn.nspname = 'public' AND p.relname = c.relname
                       AND p.relkind IN ('r', 'p', 'v', 'm', 'f'))$q$;

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
                           -- [S1.38 / khoản nợ 82⑵, lượt soi 25a #7] NGUYÊN VĂN thay cho LIKE chuỗi con: bản cũ nhận
                           -- cả `USING (false AND … app.guest_session_id …)` — đo: sống qua migrate(), bộ đếm 0 hàng.
                           AND pg_get_expr(p.polqual, c.oid) = $q$ || KHACH_KHONG_PHIEN_LIT || $q$
                           -- [lượt soi 29, NHẸ-7] và cả VAI lẫn LỆNH: `ALTER POLICY … TO app_unseal` giữ nguyên
                           -- hai vế mà làm app_api đếm 0 hàng.
                           AND p.polroles = '{0}'::oid[] AND p.polcmd = '*')
           FROM pg_class c WHERE c.oid = to_regclass('public.caller_rate_limits'))$q$,
      $q$coalesce((SELECT 'RLS/policy của caller_rate_limits lệch — rls=' || c.relrowsecurity::text
                          || ' force=' || c.relforcerowsecurity::text
                          || ' policy=' || coalesce((SELECT string_agg(p.polname::text, '; ' ORDER BY p.polname)
                                                       FROM pg_policy p WHERE p.polrelid = c.oid), '(KHÔNG CÓ)')
                          || ' (chỉ nêu tên — biểu thức, vai, lệnh không in ra; so với 042 trong pg_policy)'
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
    -- [S1.66 / lượt soi ngang 59a-8] Mô tả nêu lệnh và vai (tên), không in biểu thức USING — mục 042 ở trên cùng khuôn, chỉ nêu
    -- tên policy. Và `p.polcmd::text`: bản cũ nối `'…' || p.polcmd` (kiểu "char"), nên mỗi lần policy TỒN TẠI mà lệch, mô tả
    -- ném 42725 (`operator is not unique: unknown || "char"`, đo) và mục chỉ báo "KHÔNG ĐÁNH GIÁ ĐƯỢC" — thông điệp riêng của
    -- mục chưa từng in ra được. Vẫn fail-closed, nhưng người sửa không được biết lệch ở đâu.
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
      $q$coalesce((SELECT 'policy dọn của otp_rate_limits lệch — lệnh=' || p.polcmd::text
                          || ' vai=' || coalesce((SELECT string_agg(r.rolname::text, ',' ORDER BY r.rolname COLLATE "C")
                                                    FROM pg_roles r WHERE r.oid = ANY(p.polroles)), '(không có)')
                          || ' — biểu thức USING không in ra (so với bản 044 bằng pg_get_expr(polqual, polrelid) trong pg_policy)'
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
      -- [S1.51 / lượt soi 44 NHẸ-3] Chỉ TÊN, không giá trị — cùng chuẩn đã áp cho ba mục mức database và cho mục 92.
      -- Đây là mức VAI, nơi một GUC tenant có xác suất xuất hiện CAO NHẤT (`ALTER ROLE app_api SET app.org_id = <uuid>`
      -- là đúng ca mà khoản 87 tồn tại để bắt), và thông điệp lỗi deploy đi thẳng vào log CI — nơi lưu lâu hơn và đọc
      -- được bởi nhiều người hơn chính CSDL.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_roles rr,
                          pg_catalog.unnest(rr.rolconfig) c WHERE rr.rolname = 'app_api'),
                  'role app_api không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api$q$
    ],
    ARRAY[
      $q$rolconfig toàn cụm của app_unseal$q$,
      $q$true$q$,
      $q$ALTER ROLE app_unseal RESET ALL$q$,
      $q$(SELECT rolconfig IS NULL FROM pg_roles WHERE rolname = 'app_unseal')$q$,
      -- [S1.51 / lượt soi 44 NHẸ-3] Chỉ TÊN, không giá trị — cùng chuẩn đã áp cho ba mục mức database và cho mục 92.
      -- Đây là mức VAI, nơi một GUC tenant có xác suất xuất hiện CAO NHẤT (`ALTER ROLE app_api SET app.org_id = <uuid>`
      -- là đúng ca mà khoản 87 tồn tại để bắt), và thông điệp lỗi deploy đi thẳng vào log CI — nơi lưu lâu hơn và đọc
      -- được bởi nhiều người hơn chính CSDL.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_roles rr,
                          pg_catalog.unnest(rr.rolconfig) c WHERE rr.rolname = 'app_unseal'),
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
      -- [S1.51 / lượt soi 44 NHẸ-3] Chỉ TÊN, không giá trị — cùng chuẩn đã áp cho ba mục mức database và cho mục 92.
      -- Đây là mức VAI, nơi một GUC tenant có xác suất xuất hiện CAO NHẤT (`ALTER ROLE app_api SET app.org_id = <uuid>`
      -- là đúng ca mà khoản 87 tồn tại để bắt), và thông điệp lỗi deploy đi thẳng vào log CI — nơi lưu lâu hơn và đọc
      -- được bởi nhiều người hơn chính CSDL.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_db_role_setting s
                    JOIN pg_roles r ON r.oid = s.setrole, pg_catalog.unnest(s.setconfig) c
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
      -- [S1.51 / lượt soi 44 NHẸ-3] Chỉ TÊN, không giá trị — cùng chuẩn đã áp cho ba mục mức database và cho mục 92.
      -- Đây là mức VAI, nơi một GUC tenant có xác suất xuất hiện CAO NHẤT (`ALTER ROLE app_api SET app.org_id = <uuid>`
      -- là đúng ca mà khoản 87 tồn tại để bắt), và thông điệp lỗi deploy đi thẳng vào log CI — nơi lưu lâu hơn và đọc
      -- được bởi nhiều người hơn chính CSDL.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_db_role_setting s
                    JOIN pg_roles r ON r.oid = s.setrole, pg_catalog.unnest(s.setconfig) c
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
      -- [S1.51 / lượt soi 44 NHẸ-3] Chỉ TÊN, không giá trị — cùng chuẩn đã áp cho ba mục mức database và cho mục 92.
      -- Đây là mức VAI, nơi một GUC tenant có xác suất xuất hiện CAO NHẤT (`ALTER ROLE app_api SET app.org_id = <uuid>`
      -- là đúng ca mà khoản 87 tồn tại để bắt), và thông điệp lỗi deploy đi thẳng vào log CI — nơi lưu lâu hơn và đọc
      -- được bởi nhiều người hơn chính CSDL.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_roles rr,
                          pg_catalog.unnest(rr.rolconfig) c WHERE rr.rolname = 'app_api_login'),
                  'role app_api_login không tồn tại')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api_login$q$
    ],
    ARRAY[
      $q$rolconfig toàn cụm của app_unseal_login$q$,
      $q$EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_unseal_login')$q$,
      $q$ALTER ROLE app_unseal_login RESET ALL$q$,
      $q$(SELECT rolconfig IS NULL FROM pg_roles WHERE rolname = 'app_unseal_login')$q$,
      -- [S1.51 / lượt soi 44 NHẸ-3] Chỉ TÊN, không giá trị — cùng chuẩn đã áp cho ba mục mức database và cho mục 92.
      -- Đây là mức VAI, nơi một GUC tenant có xác suất xuất hiện CAO NHẤT (`ALTER ROLE app_api SET app.org_id = <uuid>`
      -- là đúng ca mà khoản 87 tồn tại để bắt), và thông điệp lỗi deploy đi thẳng vào log CI — nơi lưu lâu hơn và đọc
      -- được bởi nhiều người hơn chính CSDL.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_roles rr,
                          pg_catalog.unnest(rr.rolconfig) c WHERE rr.rolname = 'app_unseal_login'),
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
      -- [S1.51 / lượt soi 44 NHẸ-3] Chỉ TÊN, không giá trị — cùng chuẩn đã áp cho ba mục mức database và cho mục 92.
      -- Đây là mức VAI, nơi một GUC tenant có xác suất xuất hiện CAO NHẤT (`ALTER ROLE app_api SET app.org_id = <uuid>`
      -- là đúng ca mà khoản 87 tồn tại để bắt), và thông điệp lỗi deploy đi thẳng vào log CI — nơi lưu lâu hơn và đọc
      -- được bởi nhiều người hơn chính CSDL.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_db_role_setting s
                    JOIN pg_roles r ON r.oid = s.setrole, pg_catalog.unnest(s.setconfig) c
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
      -- [S1.51 / lượt soi 44 NHẸ-3] Chỉ TÊN, không giá trị — cùng chuẩn đã áp cho ba mục mức database và cho mục 92.
      -- Đây là mức VAI, nơi một GUC tenant có xác suất xuất hiện CAO NHẤT (`ALTER ROLE app_api SET app.org_id = <uuid>`
      -- là đúng ca mà khoản 87 tồn tại để bắt), và thông điệp lỗi deploy đi thẳng vào log CI — nơi lưu lâu hơn và đọc
      -- được bởi nhiều người hơn chính CSDL.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_db_role_setting s
                    JOIN pg_roles r ON r.oid = s.setrole, pg_catalog.unnest(s.setconfig) c
                   WHERE r.rolname = 'app_unseal_login'
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal_login$q$
    ],

    -- ---- [S1.34 / khoản nợ 78] CHE TÊN qua search_path: bảng tạm, schema, và đường tìm tên ----------
    -- `rolconfig` của vai ứng dụng về NULL (các mục trên) ⇒ search_path mặc định `"$user", public`,
    -- và `pg_temp` NGẦM đứng trước cả hai. Đo trên PostgreSQL 16 (lượt soi 22, L1; dựng ca ở S1.34):
    --     app_api: CREATE TEMP TABLE sessions (id int)      -> OK (TEMP đến từ PUBLIC, datacl NULL)
    --              SELECT count(*) FROM sessions             -> 0   (public.sessions có 1 hàng)
    --              UPDATE sessions SET ...                    -> 0 hàng, KHÔNG lỗi
    --     CREATE SCHEMA app_api; CREATE TABLE app_api.sessions -> SELECT count(*) FROM sessions -> 0
    --     và migrate() ĐI QUA cả hai.
    -- Một bảng tạm sống hết đời KẾT NỐI pool, nên nó che tên cho MỌI request sau trên kết nối ấy;
    -- một schema trùng tên che cho MỌI kết nối. Mã sản xuất qualify `public.` và ghim `pg_catalog.`
    -- (QT3/H21) nên hôm nay vô hại; lớp này đóng đường ấy Ở CSDL, để bảo đảm không phụ thuộc vào
    -- việc mọi câu SQL tương lai nhớ qualify.
    -- Sáu mục, ba cặp:
    --   (a) TEMP — TỰ CHỮA, hai mục: PUBLIC (mặc định của PostgreSQL khi datacl rỗng — hậu điều kiện
    --       đọc qua `acldefault` nên thấy được cả trạng thái "chưa vật chất hoá"), và mọi vai kết nối
    --       ứng dụng theo tính chất. Thu hồi một quyền là đơn điệu (ADR-028 §2⑵). Đo: sau REVOKE,
    --       CREATE TEMP TABLE/VIEW/SEQUENCE đều 42501 "permission denied for schema pg_temp_N".
    --       [lượt soi 24, NHẸ-4] Mỗi vai một câu REVOKE riêng (vòng DO), không gộp: một role vắng
    --       làm cả câu gộp ném 42704 và PUBLIC không được thu hồi.
    --   (b) CREATE ON DATABASE — TỰ CHỮA, cùng khuôn. [lượt soi 24, NẶNG-1] Đây là tiền đề của (c):
    --       CREATE trôi ⇒ app_api tự dựng `CREATE SCHEMA app_api` — che BỀN, cho mọi kết nối, kéo tới
    --       deploy sau (đo: dưới app_api có CREATE, schema dựng được và `sessions` trần đếm 0).
    --   (c) Schema trùng tên một vai kết nối ứng dụng — PHÁN XÉT (`"$user"` phân giải theo current_user:
    --       app_api/app_unseal sau SET ROLE; role đăng nhập chỉ khi kết nối KHÔNG ở SET ROLE — phòng
    --       thủ chiều sâu). Cố ý KHÔNG tự DROP: schema có thể chứa đối tượng, và xoá trong im lặng là
    --       chế độ hỏng [vòng fix 1 — I1] đã phải sửa.
    --   (d) Quan hệ TRÙNG TÊN trong một schema mà vai có USAGE — PHÁN XÉT. [lượt soi 24, NHẸ-3]
    --       `SET search_path` trong phiên không bị chặn và không được tái khẳng định; đường ấy chỉ che
    --       được tên khi vai có USAGE ở một schema KHÁC chứa quan hệ TRÙNG TÊN với public. Bản đầu phán
    --       xét "không USAGE ngoài public" và đo được là quá rộng: hai fixture hợp lệ của chính tệp test
    --       (schema `khac` chứa con INHERITS của bảng tenant — [S1.40] nay bị mục 82⑴ phán vì cặp chưa
    --       khai, nhưng vẫn hợp lệ với mục (d) này — USAGE cho app_api; schema `gia` chứa một
    --       HÀM giả, USAGE cho PUBLIC) đều bị gãy. Vế đúng là vế ĐÚNG CƠ CHẾ: quan hệ (r/p/v/m/f) cùng
    --       tên. Hàm trùng tên KHÔNG thuộc hàng 16 (câu ghi rơi vào bảng khác) — [CR1] đã đo riêng rằng
    --       danh sách trắng không bị vượt bằng hàm giả trên search_path. Không tự thu hồi: USAGE có thể
    --       cấp qua PUBLIC cho schema của người khác.
    -- Dư lượng ở tầng app (ADR-036 ⑯): bảng tạm tạo TRƯỚC lần deploy mang lớp này sống hết đời kết nối
    -- pool (đo) — `packages/db/src/vai-tro.ts` `DISCARD TEMP` cùng câu SET ROLE ở mỗi lần giao client.
    ARRAY[
      $q$quyền TEMP trên database cấp cho PUBLIC$q$,
      $q$true$q$,
      pg_catalog.format('REVOKE TEMP ON DATABASE %I FROM PUBLIC', pg_catalog.current_database()),
      $q$NOT coalesce((SELECT bool_or(x.grantee = 0 AND x.privilege_type = 'TEMPORARY')
                          FROM pg_database d,
                               pg_catalog.aclexplode(coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))) x
                         WHERE d.datname = pg_catalog.current_database()), false)$q$,
      $q$'PUBLIC còn TEMP trên database (mặc định của PostgreSQL khi datacl rỗng) — một CREATE TEMP TABLE <tên bảng> trên một kết nối pool che bảng thật cho mọi request sau (ADR-036 ⑯)'$q$,
      $q$chủ sở hữu database hiện tại hoặc SUPERUSER (REVOKE ON DATABASE)$q$
    ],
    ARRAY[
      $q$quyền TEMP trên database của vai ứng dụng và mọi thành viên$q$,
      $q$true$q$,
      $q$DO $vai$ DECLARE v record; BEGIN
          FOR v IN $q$ || VAI_KET_NOI_UNG_DUNG || $q$ LOOP
            EXECUTE pg_catalog.format('REVOKE TEMP ON DATABASE %I FROM %I', pg_catalog.current_database(), v.rolname);
          END LOOP;
        END $vai$$q$,
      $q$coalesce((SELECT bool_and(NOT pg_catalog.has_database_privilege(v.rolname, pg_catalog.current_database(), 'TEMP'))
                    FROM ($q$ || VAI_KET_NOI_UNG_DUNG || $q$) v), true)$q$,
      $q$'còn TEMP trên database: ' || (SELECT string_agg(v.rolname, ', ' ORDER BY v.rolname)
                                       FROM ($q$ || VAI_KET_NOI_UNG_DUNG || $q$) v
                                      WHERE pg_catalog.has_database_privilege(v.rolname, pg_catalog.current_database(), 'TEMP'))
        || ' (cấp đích danh; qua một nhóm mà BƯỚC 1 chưa gỡ; qua PUBLIC nếu mục trước không thu hồi được — has_database_privilege đếm cả PUBLIC; hoặc vai ấy là CHỦ database — quyền chủ là ngầm, REVOKE không tước được, đổi chủ DB)'$q$,
      $q$chủ sở hữu database hiện tại hoặc SUPERUSER (REVOKE ON DATABASE)$q$
    ],
    ARRAY[
      $q$quyền CREATE trên database cấp cho PUBLIC$q$,
      $q$true$q$,
      pg_catalog.format('REVOKE CREATE ON DATABASE %I FROM PUBLIC', pg_catalog.current_database()),
      $q$NOT coalesce((SELECT bool_or(x.grantee = 0 AND x.privilege_type = 'CREATE')
                          FROM pg_database d,
                               pg_catalog.aclexplode(coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))) x
                         WHERE d.datname = pg_catalog.current_database()), false)$q$,
      $q$'PUBLIC còn CREATE trên database — ai cũng dựng được một schema trùng tên vai ứng dụng (ADR-036 ⑯)'$q$,
      $q$chủ sở hữu database hiện tại hoặc SUPERUSER (REVOKE ON DATABASE)$q$
    ],
    ARRAY[
      $q$quyền CREATE trên database của vai ứng dụng và mọi thành viên$q$,
      $q$true$q$,
      $q$DO $vai$ DECLARE v record; BEGIN
          FOR v IN $q$ || VAI_KET_NOI_UNG_DUNG || $q$ LOOP
            EXECUTE pg_catalog.format('REVOKE CREATE ON DATABASE %I FROM %I', pg_catalog.current_database(), v.rolname);
          END LOOP;
        END $vai$$q$,
      $q$coalesce((SELECT bool_and(NOT pg_catalog.has_database_privilege(v.rolname, pg_catalog.current_database(), 'CREATE'))
                    FROM ($q$ || VAI_KET_NOI_UNG_DUNG || $q$) v), true)$q$,
      $q$'còn CREATE trên database: ' || (SELECT string_agg(v.rolname, ', ' ORDER BY v.rolname)
                                         FROM ($q$ || VAI_KET_NOI_UNG_DUNG || $q$) v
                                        WHERE pg_catalog.has_database_privilege(v.rolname, pg_catalog.current_database(), 'CREATE'))
        || ' — vai ấy tự dựng được CREATE SCHEMA <tên vai> che public cho mọi kết nối (cấp đích danh; qua nhóm; qua PUBLIC nếu mục trước không thu hồi được; hoặc vai ấy là CHỦ database — đổi chủ DB)'$q$,
      $q$chủ sở hữu database hiện tại hoặc SUPERUSER (REVOKE ON DATABASE)$q$
    ],
    ARRAY[
      $q$schema trùng tên một vai mà kết nối ứng dụng có thể mang ("$user" che public)$q$,
      $q$true$q$,
      -- Cố ý no-op: xem (c) ở trên — mục này đi đúng khuôn bốn bước nhưng chỉ phán xét.
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname IN ($q$ || VAI_KET_NOI_UNG_DUNG || $q$))$q$,
      $q$'schema che public qua "$user": ' || (SELECT string_agg(n.nspname, ', ' ORDER BY n.nspname) FROM pg_namespace n
                                              WHERE n.nspname IN ($q$ || VAI_KET_NOI_UNG_DUNG || $q$))
        || ' — một bảng cùng tên trong schema ấy đứng TRƯỚC public trong search_path mặc định của vai'$q$,
      $q$viết một migration mới DROP SCHEMA ấy (hardening cố ý không tự xoá một schema có thể chứa đối tượng)$q$
    ],
    ARRAY[
      $q$quan hệ trùng tên public trong một schema mà vai kết nối ứng dụng có USAGE$q$,
      $q$true$q$,
      -- Cố ý no-op: xem (d) ở trên.
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 $q$ || CAU_QUAN_HE_TRUNG_TEN || $q$)$q$,
      $q$'quan hệ trùng tên public: ' || (SELECT string_agg(v.rolname || ' -> ' || n.nspname || '.' || c.relname, ', ' ORDER BY v.rolname, n.nspname, c.relname)
                                         $q$ || CAU_QUAN_HE_TRUNG_TEN || $q$)
        || ' — SET search_path trong phiên tới schema ấy làm câu viết trần rơi vào quan hệ này thay vì public'$q$,
      $q$viết một migration mới đổi tên hay xoá quan hệ ấy, hoặc REVOKE USAGE ON SCHEMA ấy khỏi vai (hardening cố ý không tự thu hồi: USAGE có thể cấp qua PUBLIC cho một schema của người khác)$q$
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
      -- [S1.51 / lượt soi 43 INFO-3] Chỉ TÊN, không giá trị: `setconfig` của hàng mức database có thể mang `app.org_id=<uuid>`
      -- hay một GUC extension mang bí mật, và thông điệp lỗi deploy đi vào log. Cùng chuẩn với mục khoản 87 và 92.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_db_role_setting s,
                        pg_catalog.unnest(s.setconfig) c
                   WHERE s.setrole = 0
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$quyền sở hữu database hiện tại hoặc SUPERUSER$q$
    ],
    -- [S1.39, lượt soi 30 NHẸ-4] `ALTER DATABASE … SET session_replication_role = replica` (superuser) áp cho MỌI
    -- phiên kể cả app_api và sống qua migrate(): cùng tiền đề SUSET mà mục ⑧ giữ ở mức role/PUBLIC. Cùng khuôn hai
    -- mục kề — RESET là đơn điệu nên TỰ CHỮA.
    ARRAY[
      $q$session_replication_role đặt ở mức database$q$,
      $q$true$q$,
      pg_catalog.format('ALTER DATABASE %I RESET session_replication_role', pg_catalog.current_database()),
      $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s
                     WHERE s.setrole = 0
                       AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())
                       AND EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE c LIKE 'session\_replication\_role=%'))$q$,
      -- [S1.51 / lượt soi 43 INFO-3] Chỉ TÊN, không giá trị: `setconfig` của hàng mức database có thể mang `app.org_id=<uuid>`
      -- hay một GUC extension mang bí mật, và thông điệp lỗi deploy đi vào log. Cùng chuẩn với mục khoản 87 và 92.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_db_role_setting s,
                        pg_catalog.unnest(s.setconfig) c
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
      -- [S1.51 / lượt soi 43 INFO-3] Chỉ TÊN, không giá trị: `setconfig` của hàng mức database có thể mang `app.org_id=<uuid>`
      -- hay một GUC extension mang bí mật, và thông điệp lỗi deploy đi vào log. Cùng chuẩn với mục khoản 87 và 92.
      $q$coalesce((SELECT string_agg(pg_catalog.split_part(c, '=', 1), ', ') FROM pg_db_role_setting s,
                        pg_catalog.unnest(s.setconfig) c
                   WHERE s.setrole = 0
                     AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = pg_catalog.current_database())), '?')$q$,
      $q$quyền sở hữu database hiện tại hoặc SUPERUSER$q$
    ],

    -- ---- [S1.51 / khoản nợ 92] Ba GUC vận hành gắn sẵn từ nguồn NGOÀI mức database — PHÁN XÉT ----
    -- Xem chú thích ở CAU_GUC_VAN_HANH_GAN_SAN: ba mục kề trên tự chữa nguồn `database`; mục này bắt bốn nguồn còn lại
    -- bằng `pg_settings.reset_val` của chính phiên deploy, và KHÔNG tự sửa (RESET ở mức vai/cụm là SUSET).
    -- [S1.54 / khoản nợ 96] nhánh ⒡: mã của lược đồ dự án GHI ba GUC ấy vào phiên người gọi — cũng PHÁN XÉT, sửa là viết lại mã.
    ARRAY[
      $q$ba GUC vận hành (row_security, session_replication_role, search_path) không được gắn sẵn cho phiên từ nguồn ngoài mức database, cho thân hàm qua proconfig, trao cho vai không superuser qua pg_parameter_acl, hay bị mã của lược đồ dự án ghi vào phiên người gọi (khoản 92, 95, 96)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_GUC_VAN_HANH_GAN_SAN || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_GUC_VAN_HANH_GAN_SAN || $q$) t)$q$,
      $q$SUPERUSER (ALTER ROLE ALL RESET / ALTER ROLE … RESET / ALTER SYSTEM RESET + pg_reload_conf() / REVOKE … ON PARAMETER), chủ hàm hay chủ bảng (ALTER FUNCTION … RESET, hay thân hàm / biểu thức không ghi GUC, trong một migration mới), hay gỡ options= trên chuỗi kết nối rồi chạy lại trên kết nối mới; hoặc sửa danh sách khai trong chính file này$q$
    ],

    -- ---- [S1.47 / khoản nợ 87] GUC tuỳ biến gắn sẵn cho phiên ứng dụng (năm nhánh) — PHÁN XÉT ----
    -- Ba mục kề trên tự chữa (RESET là đơn điệu và chủ database làm được với GUC thường); GUC placeholder thì chủ
    -- database thường không SET/RESET được (đo) nên mục này phán xét — xem chú thích ở CAU_GUC_TUY_BIEN_GAN_SAN.
    ARRAY[
      $q$GUC tuỳ biến (app.*) không được gắn sẵn cho phiên ứng dụng: mức database, ALTER ROLE ALL, vai kết nối, cụm/options= (phiên deploy thấy giá trị), pg_parameter_acl, proconfig hàm (khoản 87)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_GUC_TUY_BIEN_GAN_SAN || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_GUC_TUY_BIEN_GAN_SAN || $q$) t)$q$,
      $q$SUPERUSER hay vai được GRANT SET ON PARAMETER (ALTER DATABASE / ALTER ROLE / ALTER ROLE ALL … RESET <guc>; ALTER SYSTEM RESET + pg_reload_conf(); REVOKE … ON PARAMETER); chủ hàm (ALTER FUNCTION … RESET); hoặc khai tên vào GUC_TUY_BIEN_KHAI trong chính file này$q$
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
    -- ---- [S1.38 / khoản nợ 83 ⑴⑵⑶] Ba mục PHÁN XÉT cho ADR-036 hàng 5, 6, 7 — xem khối hằng cùng nhãn ----
    ARRAY[
      $q$mọi policy trên bảng RLS thuộc đúng một lớp — RESTRICTIVE và policy ngoài tenant phải khai (khoản 83⑴)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_POLICY_LOP_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_POLICY_LOP_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (DROP/ALTER POLICY) hoặc SUPERUSER; hoặc sửa danh sách khai trong chính file này$q$
    ],
    ARRAY[
      $q$mọi quyền đã cấp cho vai ứng dụng trên bảng RLS đều có policy PERMISSIVE phủ (khoản 83⑵)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_PHU_LENH_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_PHU_LENH_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (CREATE POLICY / REVOKE) hoặc SUPERUSER$q$
    ],
    -- [S1.53 / khoản nợ 94] 83⑵ cho CHỦ BẢNG — sau khi khoản 91 FORCE mọi bảng RLS, chủ bảng chịu RLS như mọi vai. PHÁN XÉT.
    -- [S1.56 / khoản nợ 97] và cho vai chạy migration mà RLS áp trên bảng (gương check_enable_rls — lượt soi 49).
    ARRAY[
      $q$mọi lệnh mà chủ bảng (không superuser, không BYPASSRLS) còn quyền trên bảng FORCE RLS — trừ bảng con của cha bật RLS — đều có policy PERMISSIVE phủ (khoản 94); và mọi lệnh SELECT/UPDATE/DELETE mà vai chạy migration — vai RLS áp trên bảng bật RLS (gương check_enable_rls), có USAGE lược đồ, trừ bảng thuộc extension và bảng con của cha bật RLS — còn quyền cũng thế (khoản 97)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_PHU_LENH_CHU_BANG_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_PHU_LENH_CHU_BANG_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (CREATE POLICY trong một migration mới) hoặc SUPERUSER; với vai chạy migration: người cấp, chủ bảng hay SUPERUSER — REVOKE quyền của vai ấy trước tiên, rồi chạy migration dưới chủ bảng, rồi policy do chủ bảng thêm — không lối nào chạy được dưới chính vai ấy$q$
    ],
    ARRAY[
      $q$bảng bật RLS ngoài tập tenant phải được khai (khoản 83⑶)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_RLS_NGOAI_TENANT_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_RLS_NGOAI_TENANT_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (ALTER TABLE … DISABLE ROW LEVEL SECURITY) hoặc SUPERUSER; hoặc sửa danh sách khai trong chính file này$q$
    ],
    -- ---- [S1.50 / khoản nợ 91] FORCE RLS trên MỌI bảng bật RLS của lược đồ dự án — TỰ CHỮA (FORCE là đơn điệu, ADR-028 §2⑵) ----
    -- Cửa ra mà thông điệp của 85 và 86 chỉ cho người sửa là "bật RLS rồi khai ở 83⑶". Cửa ấy YẾU nếu dừng ở `ENABLE`:
    -- `ENABLE` không áp cho CHỦ BẢNG, nên chủ bảng — người vừa tạo nó trong migration, và cũng là người tạo view lên nó —
    -- đọc/ghi bỏ qua mọi policy. Mục (A) chỉ FORCE tập tenant (`VI_TU_CAN_CO_RLS`), nên bảng đi cửa ra ấy nằm ngoài.
    -- [lượt soi 42 CAO-1] Bản đầu của vòng lấy chủ thể là DANH SÁCH KHAI `BANG_RLS_NGOAI_TENANT_KHAI` — hôm nay đúng một
    -- hàng `public.caller_rate_limits`, mà bảng ấy đã được mục "RLS + policy khách của caller_rate_limits (042)" ENABLE +
    -- FORCE vô điều kiện từ S1.14: mục mới thành NO-OP trên mọi trạng thái đạt tới được, và KHÔNG đột biến CSDL nào làm nó
    -- đỏ — đúng thứ ADR-028 §2⑷ cấm thêm vào tệp này. Nay chủ thể là TÍNH CHẤT (§2⑴): MỌI bảng (r/p) bật RLS trong lược đồ
    -- dự án, trừ đối tượng thuộc EXTENSION (vai deploy không sở hữu chúng ⇒ 42501 bị BƯỚC 2 nuốt ⇒ hậu điều kiện sẽ chặn
    -- deploy vĩnh viễn). Tập ấy trên lược đồ thật = bảng tenant (đã FORCE ở (A)) ∪ `caller_rate_limits` (đã FORCE ở S1.14)
    -- ⇒ không đổi một bit nào; nhưng một bảng RLS ngoài tenant MỚI — kể cả trong cửa sổ giữa hai deploy, khi 83⑶ chưa được
    -- khai nên còn đang chặn — được FORCE ngay ở lượt SỬA. Đo: fixture `zz_s91.t` ở rls-coverage.
    -- CÁI GIÁ NÓI RA: sau FORCE, CHỦ BẢNG chịu RLS. Với một bảng có policy chỉ áp cho vai ứng dụng, chủ bảng đọc/ghi ra
    -- 0 hàng KHÔNG LỖI — đúng cơ chế ADR-036 hàng 4/6, và 83⑵ không soi vai chủ (nó chỉ soi vai ứng dụng). Hôm nay không
    -- ca nào như thế: policy duy nhất của `caller_rate_limits` là PERMISSIVE `TO PUBLIC`, và hai lượt dọn cửa sổ cũ chạy
    -- dưới `app_api`. Vế "bảng đã khai ở 83⑶ phải có một policy PERMISSIVE phủ chủ bảng" là **khoản 94** (lượt soi 42 NẶNG-3).
    -- FORCE là ĐƠN ĐIỆU (chỉ thu hẹp — ADR-028 §2⑵ xếp cùng nhóm `ENABLE`), nên nó thuộc lượt SỬA, không phải phán xét.
    ARRAY[
      $q$FORCE ROW LEVEL SECURITY trên mọi bảng bật RLS của lược đồ dự án (khoản 91)$q$,
      $q$true$q$,
      $q$DO $frc$
         DECLARE ten_bang regclass;
         BEGIN
           FOR ten_bang IN
             SELECT c.oid::regclass FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE $q$ || VI_TU_FORCE_THIEU || $q$
           LOOP
             EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', ten_bang);
           END LOOP;
         END
         $frc$$q$,
      $q$NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE $q$ || VI_TU_FORCE_THIEU || $q$)$q$,
      $q$(SELECT string_agg(n.nspname || '.' || c.relname, ', ')
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE $q$ || VI_TU_FORCE_THIEU || $q$)
        || ' — bảng bật RLS mà chỉ ENABLE: CHỦ BẢNG đọc/ghi bỏ qua mọi policy, và một VIEW không security_invoker '
           'lên nó (chủ view thường chính là chủ bảng) mở đúng đường ấy cho vai ứng dụng (khoản 91)'$q$,
      $q$quyền sở hữu bảng đó (ALTER TABLE … FORCE ROW LEVEL SECURITY) hoặc SUPERUSER$q$
    ],

    -- ---- [S1.41 / khoản nợ 85] Bảng org_id ngoài public, ngoài tập tenant, không RLS — PHÁN XÉT ----
    ARRAY[
      $q$bảng có org_id ngoài public không treo dưới bảng tenant và không RLS phải được khai (khoản 85)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_ORG_ID_NGOAI_PUBLIC_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_ORG_ID_NGOAI_PUBLIC_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (DROP, ALTER TABLE … SET SCHEMA public, ATTACH PARTITION; bật RLS thì chỉ chuyển lời khai sang 83⑶) hoặc SUPERUSER; hoặc sửa danh sách khai trong chính file này$q$
    ],
    -- ---- [S1.46 / khoản nợ 86 — nửa gốc] Bảng không org_id có khoá ngoại tới bảng tenant, ngoài tập tenant, không RLS — PHÁN XÉT ----
    ARRAY[
      $q$bảng không có cột org_id nhưng có khoá ngoại tới bảng tenant, ngoài tập tenant và không RLS phải được khai (khoản 86)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_KHOA_NGOAI_TENANT_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_KHOA_NGOAI_TENANT_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (ALTER TABLE … RENAME COLUMN … TO org_id, DROP; bật RLS thì chỉ chuyển lời khai sang 83⑶) hoặc SUPERUSER; hoặc sửa danh sách khai trong chính file này$q$
    ],
    -- ---- [S1.43 / khoản nợ 89 + 86] Danh tính: chú thích neo theo oid + tên đã khai + hình dạng sổ — SỬA (ghi neo) + PHÁN XÉT (tám vế ⑴⑵⑵′⑶⑷⑷′⑸⑹ — [S1.48 / 40b #7] "sáu" là con số thiu) ----
    ARRAY[
      $q$danh tính đối tượng canh: bảng sổ và bảng tenant đã khai còn đúng tên, đúng tính chất, mang neo; không bản sao sổ ngoài tên sổ (khoản 89/86, ADR-037)$q$,
      $q$pg_catalog.to_regclass('public.schema_migrations') IS NOT NULL$q$,
      CAU_NEO_SUA,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_NEO_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_NEO_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (COMMENT ON TABLE / ALTER TABLE / DROP) hoặc SUPERUSER; đổi có chủ ý thì sửa dòng khai và đặt lại chú thích neo trong cùng migration$q$
    ],
    -- ---- [S1.39 / khoản nợ 83 ⑷⑸⑹⑺⑧] Năm mục PHÁN XÉT cho ADR-036 hàng 10, 21, 3 (tổng quát), 2/75, tiền đề 8 ----
    ARRAY[
      $q$bảng ngoài / matview / view có trigger INSTEAD OF trong lược đồ dự án phải được khai (khoản 83⑷)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_QUAN_HE_KHAC_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_QUAN_HE_KHAC_SAI || $q$) t)$q$,
      $q$quyền sở hữu quan hệ đó (DROP) hoặc SUPERUSER; hoặc sửa danh sách khai trong chính file này$q$
    ],
    ARRAY[
      $q$mọi trigger của dự án gọi hàm plpgsql, trừ khi khai (khoản 83⑸)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_TRIGGER_NGOAI_PLPGSQL_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_TRIGGER_NGOAI_PLPGSQL_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (DROP TRIGGER) hoặc SUPERUSER; hoặc sửa danh sách khai trong chính file này$q$
    ],
    ARRAY[
      $q$không RULE nào trên quan hệ của dự án, trừ khi khai (khoản 83⑹)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_RULE_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_RULE_SAI || $q$) t)$q$,
      $q$quyền sở hữu quan hệ đó (DROP RULE) hoặc SUPERUSER; hoặc sửa danh sách khai trong chính file này$q$
    ],
    ARRAY[
      $q$hàm canh chỉ được gắn BEFORE … FOR EACH ROW trên INSERT/UPDATE/DELETE (khoản 83⑺)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_HAM_CANH_HINH_THUC_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_HAM_CANH_HINH_THUC_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (DROP TRIGGER / CREATE TRIGGER) hoặc SUPERUSER$q$
    ],
    ARRAY[
      $q$không vai ứng dụng nào được cấp quyền trên tham số (pg_parameter_acl) (khoản 83⑧)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_PARAMETER_ACL_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_PARAMETER_ACL_SAI || $q$) t)$q$,
      $q$SUPERUSER (REVOKE … ON PARAMETER)$q$
    ],
    -- ---- [S1.40 / khoản nợ 82⑴] Mục PHÁN XÉT cho ADR-036 hàng 22 — tiền đề của NO INHERIT ----
    ARRAY[
      $q$không cặp kế thừa cổ điển (INHERITS) nào trong lược đồ dự án, trừ khi khai (khoản 82⑴)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_KE_THUA_SAI || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_KE_THUA_SAI || $q$) t)$q$,
      $q$quyền sở hữu bảng con (ALTER TABLE … NO INHERIT / DROP TABLE) hoặc SUPERUSER; hoặc sửa danh sách khai trong chính file này$q$
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
    -- [S1.36 / khoản nợ 79] Chỉ PHÁN XÉT — xem CAU_TRIGGER_CANH_CO_DIEU_KIEN.
    ARRAY[
      $q$trigger của hàm canh có WHEN, UPDATE OF, hay không ENABLE ALWAYS (suy từ tính chất, mọi bảng)$q$,
      $q$true$q$,
      $q$SELECT 1$q$,
      $q$NOT EXISTS (SELECT 1 FROM ($q$ || CAU_TRIGGER_CANH_CO_DIEU_KIEN || $q$) t)$q$,
      $q$(SELECT string_agg(mo_ta, '; ') FROM ($q$ || CAU_TRIGGER_CANH_CO_DIEU_KIEN || $q$) t)$q$,
      $q$quyền sở hữu bảng đó (DROP TRIGGER / CREATE TRIGGER) hoặc SUPERUSER$q$
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

  -- [S1.44 / khoản nợ 88, lượt soi 36 #1] ROLE_CANH dời lên trước VAI_KET_NOI_UNG_DUNG (một hằng PL/pgSQL phải khai
  -- TRƯỚC hằng dùng nó): CAU_PHU_LENH_SAI nay hợp bốn tên đã ghim vào tập theo tính chất.

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
  IF che_do NOT IN ('sua', 'truoc_vong', 'phan_xet', 'day_du') THEN
    RAISE EXCEPTION 'app.hardening_che_do = % không hợp lệ (chỉ nhận sua/truoc_vong/phan_xet/day_du)', che_do;
  END IF;

  -- ===== [S1.57 / khoản nợ 100] LƯỢT HỎI TRƯỚC VÒNG ĐÁNH SỐ ==============================
  -- migrate() chạy lượt này sau lượt sửa đầu, TRƯỚC vòng migration đánh số, CHỈ khi còn tệp chưa áp (packages/db/src/migrate.ts).
  -- Nó hỏi đúng MỘT câu — chủ thể "vai chạy migration" của mục 94, trừ dòng `tu_sua_duoc` — rồi RAISE SQLSTATE TP100 kèm danh sách
  -- bảng/vai/lệnh và đường tới quyền, hoặc trả về: không sửa gì, không phán xét mục nào khác. Là ngoại lệ duy nhất TRONG CÁC LƯỢT CỦA
  -- HARDENING đối với "không phán xét trước vòng" — migrate() còn ba phép từ chối trước vòng của riêng nó: TU_CHOI_GUC_SOM và hai phép
  -- hàng mức database (lượt soi 50 INFO-8; bản đầu viết "ngoại lệ DUY NHẤT" không kèm phạm vi). Vì sao dòng còn lại được chặn TRƯỚC
  -- vòng mà không phá lời hứa "migration vá lỗi luôn tới được đích": mọi lối ra của chúng nằm ngoài tầm của chính vai chạy migration
  -- (gỡ đường tới quyền do người cấp, chủ bảng hay SUPERUSER; chạy dưới một vai mà RLS không áp hay có policy phủ; policy do chủ bảng
  -- thêm; [S1.58 / khoản nợ 101] với dòng mà policy phụ thuộc hàm ngữ cảnh lọc hết: gỡ đường tới EXECUTE theo lối ra của từng đường),
  -- nên một migration chạy dưới vai ấy không vá được — còn một backfill chạy dưới nó thì ra 0 hàng không lỗi rồi được ghi
  -- checksum (đo S1.56 ⒣; hồ sơ N2 ở db/migrations.int.test.ts). Dòng `tu_sua_duoc` thì một migration dưới chính vai ấy SỬA ĐƯỢC (khối
  -- đo trên CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI) nên KHÔNG chặn ở đây — lượt soi 50 NẶNG-1: bản đầu chặn cả chúng, một ngõ cụt ADR-028
  -- §3. Chủ thể CHỦ BẢNG của cùng mục cũng KHÔNG hỏi ở đây, cùng lý do — test ghim cả hai chiều dưới vai deploy KHÔNG superuser.
  -- Không bọc EXCEPTION: câu hỏi ném thì migrate() dừng trước vòng với lỗi thật (test ghim bằng một tệp .always.sql giả); nuốt để "đi
  -- tiếp" là một nhánh không đột biến nào làm đỏ được (ADR-028 §2⑷), và lượt phán xét sau vòng cũng sẽ không đánh giá được cùng câu ấy.
  IF che_do = 'truoc_vong' THEN
    EXECUTE $e$SELECT pg_catalog.string_agg(t.ten || ' (' || t.duong
                                            || CASE WHEN t.vi_tu_loc_het
                                                    THEN ' — policy phụ thuộc app_current_org_id() lọc hết vì vai này có EXECUTE trên hàm ấy: '
                                                         || t.duong_execute
                                                    ELSE '' END || ')', '; ' ORDER BY t.ten)
                   || coalesce('. Lối ra theo đường tới EXECUTE (khoản 101): '
                               || pg_catalog.string_agg(DISTINCT CASE WHEN t.vi_tu_loc_het THEN t.loi_ra_execute END, '; '), '')
                 FROM ($e$
            || CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI || $e$) t WHERE NOT t.tu_sua_duoc$e$
      INTO con_sot;
    IF con_sot IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'TP100', MESSAGE = con_sot;
    END IF;
    RETURN;
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
    -- [S1.44 / khoản nợ 88 ⑺] CỘT ĐIỀU KIỆN cũng đọc catalog nên cũng ném được — bản đầu của S1.43 đo đúng điều đó:
    -- `to_regclass('app_private.…')` ở cột này ném 42501 dưới vai deploy N2 và CẢ LƯỢT SỬA gãy trước vòng migration
    -- đánh số (12 test đỏ). Bất biến đầu file "BƯỚC 2 KHÔNG GÃY" phải phủ cả cột này: ném ⇒ WARNING, coi như chưa đủ
    -- điều kiện (không sửa), BƯỚC 3 sẽ báo "không đánh giá được" cho đúng mục ấy.
    BEGIN
      EXECUTE 'SELECT ' || bang[i][2] INTO du_dieu_kien;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Hardening: không đánh giá được ĐIỀU KIỆN của mục "%": % (%). Không sửa; BƯỚC 3 sẽ phán xét.',
                    bang[i][1], SQLERRM, SQLSTATE;
      du_dieu_kien := false;
    END;
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
  -- [S1.44 / khoản nợ 88 ⑺ — lượt soi 36 #5] Hai câu membership cùng khuôn "không gãy thô" với vòng mục ở dưới.
  BEGIN
    EXECUTE 'SELECT string_agg(format(''%s -> %s'', ten_nhom, ten_thanh_vien), ''; '') FROM ('
            || CAU_MEMBERSHIP_LA || ') t'
      INTO con_sot;
    IF con_sot IS NOT NULL THEN
      loi_gom := loi_gom || format(
        '- "tư cách thành viên LẠ của app_api/app_unseal và role đăng nhập của chúng": còn sót '
        '(%s). Cần quyền: ADMIN OPTION trên các role đó hoặc SUPERUSER.', con_sot);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    loi_gom := loi_gom || format(
      '- "tư cách thành viên LẠ của app_api/app_unseal và role đăng nhập của chúng": KHÔNG ĐÁNH GIÁ ĐƯỢC — câu kiểm ném %s (%s).',
      SQLSTATE, SQLERRM);
  END;

  BEGIN
    EXECUTE 'SELECT string_agg(format(''%s -> %s'', ten_nhom, ten_thanh_vien), ''; '') FROM ('
            || CAU_ADMIN_LA || ') t'
      INTO con_sot;
    IF con_sot IS NOT NULL THEN
      loi_gom := loi_gom || format(
        '- "ADMIN OPTION trên tư cách thành viên hợp lệ": còn sót (%s) — chủ thể đó tự cấp được '
        'app_api/app_unseal cho bất kỳ ai. Cần quyền: ADMIN OPTION trên các role đó hoặc '
        'SUPERUSER.', con_sot);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    loi_gom := loi_gom || format(
      '- "ADMIN OPTION trên tư cách thành viên hợp lệ": KHÔNG ĐÁNH GIÁ ĐƯỢC — câu kiểm ném %s (%s).',
      SQLSTATE, SQLERRM);
  END;

  -- [S1.44 / khoản nợ 88 ⑺ — lượt soi 35 "mang sang" ⑶] BƯỚC 3 KHÔNG GÃY THÔ (cả hai câu membership ở trên). Trước vòng
  -- này ba EXECUTE dưới đây đứng
  -- trần: một hàm catalog ném theo dữ liệu người khác kiểm soát (lượt soi 35 NẶNG-3: `to_regclass(substr(chú thích))`
  -- ném 42601/42501 xuyên qua bản gom) làm migrate() chết bằng một lỗi TRẦN không nêu tên mục, và mọi mục còn lại
  -- không được phán. Nay mỗi mục đứng trong khối con: ném ⇒ một dòng "KHÔNG ĐÁNH GIÁ ĐƯỢC" nêu tên mục, SQLSTATE và
  -- SQLERRM vào bản gom — mục không được coi là đúng — và vòng đi tiếp. Đo ở db/hardening-suy-tu-tinh-chat.int.test.ts
  -- bằng một bản hardening chép ra thư mục tạm có ba mục tiêm (điều kiện ném / hậu điều kiện ném / hậu điều kiện sai):
  -- một thông báo, ba dòng, đúng ba tên.
  FOR i IN 1 .. array_length(bang, 1) LOOP
    BEGIN
      EXECUTE 'SELECT ' || bang[i][2] INTO du_dieu_kien;
      CONTINUE WHEN NOT coalesce(du_dieu_kien, false);

      EXECUTE 'SELECT ' || bang[i][4] INTO dung_roi;
      IF NOT coalesce(dung_roi, false) THEN
        EXECUTE 'SELECT ' || bang[i][5] INTO chi_tiet;
        loi_gom := loi_gom || format(
          '- "%s": trạng thái hiện tại SAI (%s). Cần quyền: %s.',
          bang[i][1], chi_tiet, bang[i][6]);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      loi_gom := loi_gom || format(
        '- "%s": KHÔNG ĐÁNH GIÁ ĐƯỢC — điều kiện, hậu điều kiện hay mô tả ném %s (%s); mục không được coi là đúng. Cần quyền: %s.',
        bang[i][1], SQLSTATE, SQLERRM, bang[i][6]);
    END;
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

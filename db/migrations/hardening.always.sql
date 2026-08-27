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
-- [fix round 4 — N2] KHOAN DUNG VỚI QUYỀN, NGHIÊM KHẮC VỚI TRÔI
-- ============================================================================
-- Vòng 3 đặt "ALTER ROLE ..." trần ở đây và vô tình biến migrate() thành thao tác ĐÒI
-- SUPERUSER ở MỌI lần gọi — đã tự đo: bootstrap bằng superuser, rồi deploy sau chạy dưới
-- role CREATEROLE + DB owner cho ra "Hardening hardening.always.sql thất bại: permission
-- denied to alter role", trong khi TRƯỚC vòng 3 kịch bản đó THÀNH CÔNG (001 đã nằm trong
-- schema_migrations nên không ai chạm ALTER ROLE). Đó là thay đổi yêu cầu vận hành không ai
-- công bố.
--
-- Khuôn dưới đây giữ được phát hiện trôi mà không phá deploy non-superuser:
--   1. THỬ chạy câu lệnh cưỡng chế; nuốt riêng lỗi insufficient_privilege (42501).
--   2. LUÔN kiểm tra HẬU ĐIỀU KIỆN — trạng thái thật trong catalog sau bước 1.
--   3. Hậu điều kiện ĐÚNG  -> đi tiếp, kể cả khi bước 1 bị từ chối quyền (không có gì
--      cần sửa, nên không cần quyền để sửa).
--      Hậu điều kiện SAI   -> RAISE EXCEPTION nêu rõ CỜ/QUYỀN nào đang sai và cần quyền gì.
--
-- Vì sao kiểm hậu điều kiện thay vì chỉ bắt exception: GRANT/REVOKE trên đối tượng mình
-- KHÔNG sở hữu không ném lỗi — Postgres chỉ phát WARNING "no privileges were granted/
-- revoked for ..." rồi trả về thành công. Nếu chỉ dựa vào exception handler thì mọi trôi
-- GRANT/REVOKE sẽ bị nuốt im lặng. Hậu điều kiện đọc thẳng catalog nên đúng cho cả hai loại
-- lệnh (ALTER ROLE ném lỗi, GRANT/REVOKE cảnh báo).
--
-- Rủi ro đã biết của khuôn này: nếu một biểu thức "kiem_tra" viết SAI (lỏng hơn câu lệnh nó
-- canh) thì một trôi thật sẽ bị nuốt. Vì vậy mỗi dòng trong bảng dưới đây có test đối kháng
-- riêng ở db/migrations.int.test.ts dựng đúng trôi đó rồi khẳng định migrate() sửa được.
--
-- Cố ý KHÔNG phụ thuộc sự tồn tại của đối tượng do 001 tạo: các dòng chạm tới schema
-- app_private và hàm app_current_org_id() đều có cột "dieu_kien" (tiền điều kiện) bỏ qua
-- dòng đó khi đối tượng chưa tồn tại — cần thiết vì file này chạy TRƯỚC 001 ở lần bootstrap
-- đầu tiên trên database trống.
--
-- [fix round 4] Vòng 3 cố ý bỏ ba đường trôi ra ngoài với hai lý do đều không đứng vững:
-- "cần IF EXISTS phức tạp" (thực tế là cột dieu_kien, vài dòng, cùng khuôn với phần còn
-- lại) và "GRANT USAGE ON SCHEMA hiện rõ khi review, khác hẳn BYPASSRLS" (không có khác
-- biệt nào: "ALTER ROLE app_api BYPASSRLS" cũng là một câu SQL tường minh y hệt). Ba đường
-- đó nay đã đóng — đo trước khi vá thì cả ba đều sống sót qua migrate() lần hai:
--   GRANT USAGE ON SCHEMA app_private TO app_api            -> vẫn true
--   GRANT EXECUTE ON FUNCTION app_current_org_id() TO PUBLIC -> vẫn true (lật ngược đúng
--                                                              bản vá S2 của vòng 2)
--   GRANT ALL ON SCHEMA public TO app_api (CREATE ON public) -> vẫn true
-- Đóng ba đường này cũng đóng luôn kịch bản role bị DROP rồi tạo lại giữa hai lần migrate:
-- hardening chữa được cờ nhưng 001 không chạy lại nên GRANT EXECUTE/USAGE không bao giờ trở
-- lại, ứng dụng gãy im lặng với has_function_privilege(...) = false.

-- Role trong PostgreSQL là cluster-wide, không phải per-database. Tạo nếu thiếu; nuốt riêng
-- lỗi thiếu quyền ở đây để thông báo lỗi có ích hơn phát ra từ khối kiểm tra bên dưới
-- ("role app_api không tồn tại" kèm quyền cần có), thay vì "permission denied to create role".
DO $khoi$
BEGIN
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
END
$khoi$;

DO $khoi$
DECLARE
  muc RECORD;
  du_dieu_kien boolean;
  dung_roi boolean;
  chi_tiet text;
BEGIN
  FOR muc IN
    SELECT *
    FROM (VALUES
      -- (ten_muc, dieu_kien, cau_lenh, kiem_tra, chi_tiet, quyen_can)

      -- Thuộc tính role: đây là hàng rào S1. app_api có BYPASSRLS là đọc được giá thầu của
      -- MỌI tổ chức, bất chấp toàn bộ RLS mà Task 4–10 dựng lên.
      ($q$thuộc tính role app_api$q$,
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
       $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api$q$),

      ($q$thuộc tính role app_unseal$q$,
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
       $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal$q$),

      -- Xoá rolconfig áp dụng cho MỌI database (pg_roles.rolconfig).
      ($q$rolconfig toàn cụm của app_api$q$,
       $q$true$q$,
       $q$ALTER ROLE app_api RESET ALL$q$,
       $q$(SELECT rolconfig IS NULL FROM pg_roles WHERE rolname = 'app_api')$q$,
       $q$coalesce((SELECT array_to_string(rolconfig, ', ') FROM pg_roles WHERE rolname = 'app_api'),
                   'role app_api không tồn tại')$q$,
       $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api$q$),

      ($q$rolconfig toàn cụm của app_unseal$q$,
       $q$true$q$,
       $q$ALTER ROLE app_unseal RESET ALL$q$,
       $q$(SELECT rolconfig IS NULL FROM pg_roles WHERE rolname = 'app_unseal')$q$,
       $q$coalesce((SELECT array_to_string(rolconfig, ', ') FROM pg_roles WHERE rolname = 'app_unseal'),
                   'role app_unseal không tồn tại')$q$,
       $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal$q$),

      -- [fix I5] "ALTER ROLE ... RESET ALL" ở trên chỉ xoá cấu hình áp dụng CHO MỌI DATABASE
      -- (pg_db_role_setting với setdatabase = 0, phơi ra qua pg_roles.rolconfig). Nó KHÔNG
      -- đụng tới cấu hình đặt riêng cho MỘT database qua "ALTER ROLE ... IN DATABASE d SET"
      -- — đã tự kiểm chứng bằng Postgres 16 thật: dựng sẵn "ALTER ROLE app_api IN DATABASE d
      -- SET row_security = off", chạy RESET ALL ở trên xong thì pg_roles.rolconfig là NULL
      -- nhưng pg_db_role_setting.setconfig VẪN là {row_security=off}.
      --
      -- [fix round 4] Sửa một phát biểu SAI của vòng 3 ở chính chỗ này: bình luận cũ viết
      -- "row_security=off TẮT HẲN RLS cho phiên đó". Không đúng. Đã đo thật với app_api
      -- (không sở hữu bảng, không BYPASSRLS): truy vấn bảng có RLS BÁO LỖI
      -- "query would be affected by row-level security policy for table \"bi_mat\"" chứ
      -- không đọc lọt hàng nào. row_security=off chỉ THẬT SỰ bỏ qua RLS cho ai vốn đã được
      -- miễn (chủ sở hữu bảng, role BYPASSRLS); với role thường nó biến truy vấn hợp lệ
      -- thành lỗi. Vẫn phải RESET, vì (a) một cấu hình an ninh trôi vào role ứng dụng là
      -- thứ không ai cố ý đặt, và (b) hậu quả là sự cố sẵn sàng ở mọi truy vấn chạm bảng có
      -- RLS. Nhưng lý do là VẬY, không phải "bypass RLS".
      --
      -- Dùng format(%I) vì "IN DATABASE" không nhận tên database qua tham số và
      -- current_database() không dùng trực tiếp làm định danh trong câu lệnh tĩnh.
      ($q$cấu hình IN DATABASE của app_api$q$,
       $q$true$q$,
       format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_api', current_database()),
       $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                      WHERE r.rolname = 'app_api'
                        AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()))$q$,
       $q$coalesce((SELECT array_to_string(s.setconfig, ', ') FROM pg_db_role_setting s
                     JOIN pg_roles r ON r.oid = s.setrole
                    WHERE r.rolname = 'app_api'
                      AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())), '?')$q$,
       $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_api$q$),

      ($q$cấu hình IN DATABASE của app_unseal$q$,
       $q$true$q$,
       format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_unseal', current_database()),
       $q$NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                      WHERE r.rolname = 'app_unseal'
                        AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()))$q$,
       $q$coalesce((SELECT array_to_string(s.setconfig, ', ') FROM pg_db_role_setting s
                     JOIN pg_roles r ON r.oid = s.setrole
                    WHERE r.rolname = 'app_unseal'
                      AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())), '?')$q$,
       $q$SUPERUSER, hoặc CREATEROLE kèm ADMIN OPTION trên app_unseal$q$),

      -- [fix round 4 — đường trôi 3/3] "GRANT ALL ON SCHEMA public TO app_api" cấp kèm
      -- CREATE: app_api tự tạo được đối tượng trong public — vd. một VIEW hay hàm
      -- SECURITY DEFINER của chính nó, hoặc một bảng che tên bảng thật nếu search_path
      -- thuận lợi. Không role ứng dụng nào cần CREATE trên public.
      ($q$quyền CREATE trên schema public$q$,
       $q$true$q$,
       $q$REVOKE CREATE ON SCHEMA public FROM app_api, app_unseal$q$,
       $q$NOT has_schema_privilege('app_api', 'public', 'CREATE')
         AND NOT has_schema_privilege('app_unseal', 'public', 'CREATE')$q$,
       $q$'app_api CREATE=' || has_schema_privilege('app_api', 'public', 'CREATE')::text ||
         ', app_unseal CREATE=' || has_schema_privilege('app_unseal', 'public', 'CREATE')::text$q$,
       $q$quyền sở hữu schema public (thường là chủ sở hữu database) hoặc SUPERUSER$q$),

      -- USAGE trên public là điều kiện cần để hai role dùng được bất cứ thứ gì trong đó.
      -- Cấp lại ở MỌI lần chạy để kịch bản "role bị DROP rồi tạo lại" tự phục hồi, thay vì
      -- chờ 001 chạy lại (nó không bao giờ chạy lại).
      ($q$quyền USAGE trên schema public$q$,
       $q$true$q$,
       $q$GRANT USAGE ON SCHEMA public TO app_api, app_unseal$q$,
       $q$has_schema_privilege('app_api', 'public', 'USAGE')
         AND has_schema_privilege('app_unseal', 'public', 'USAGE')$q$,
       $q$'app_api USAGE=' || has_schema_privilege('app_api', 'public', 'USAGE')::text ||
         ', app_unseal USAGE=' || has_schema_privilege('app_unseal', 'public', 'USAGE')::text$q$,
       $q$quyền sở hữu schema public (thường là chủ sở hữu database) hoặc SUPERUSER$q$),

      -- [fix round 4 — đường trôi 1/3] Schema app_private là hàng rào mặc định cho mọi hàm
      -- nhạy cảm mà migration sau đặt vào đó. Một "GRANT USAGE ON SCHEMA app_private TO
      -- app_api" sau triển khai tháo bỏ hàng rào đó cho TOÀN BỘ các hàm ấy cùng lúc.
      -- dieu_kien: schema chưa tồn tại ở lần bootstrap đầu tiên (001 chạy SAU file này).
      ($q$quyền của app_api/app_unseal trên schema app_private$q$,
       $q$EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app_private')$q$,
       $q$REVOKE ALL ON SCHEMA app_private FROM app_api, app_unseal$q$,
       $q$NOT has_schema_privilege('app_api', 'app_private', 'USAGE')
         AND NOT has_schema_privilege('app_api', 'app_private', 'CREATE')
         AND NOT has_schema_privilege('app_unseal', 'app_private', 'USAGE')
         AND NOT has_schema_privilege('app_unseal', 'app_private', 'CREATE')$q$,
       $q$'app_api USAGE=' || has_schema_privilege('app_api', 'app_private', 'USAGE')::text ||
         ' CREATE=' || has_schema_privilege('app_api', 'app_private', 'CREATE')::text ||
         ', app_unseal USAGE=' || has_schema_privilege('app_unseal', 'app_private', 'USAGE')::text ||
         ' CREATE=' || has_schema_privilege('app_unseal', 'app_private', 'CREATE')::text$q$,
       $q$quyền sở hữu schema app_private hoặc SUPERUSER$q$),

      -- [fix round 4 — đường trôi 2/3] "GRANT EXECUTE ON FUNCTION app_current_org_id() TO
      -- PUBLIC" lật ngược ĐÚNG bản vá S2 mà vòng 2 vừa dựng lên, và đúng loại "âm thầm, dễ
      -- quên" mà vòng 3 viện dẫn để loại app_private ra.
      ($q$EXECUTE của PUBLIC trên app_current_org_id()$q$,
       $q$to_regprocedure('public.app_current_org_id()') IS NOT NULL$q$,
       $q$REVOKE EXECUTE ON FUNCTION public.app_current_org_id() FROM PUBLIC$q$,
       -- proacl IS NULL nghĩa là ACL mặc định của Postgres, trong đó PUBLIC CÓ EXECUTE —
       -- nên NULL phải tính là SAI, không phải "không có dòng cấp nào nên coi như đúng".
       $q$(SELECT p.proacl IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.app_current_org_id()'))$q$,
       $q$'PUBLIC vẫn có EXECUTE trên public.app_current_org_id()'$q$,
       $q$quyền sở hữu hàm app_current_org_id() hoặc SUPERUSER$q$),

      -- Mặt kia của cùng bản vá S2: sau khi thu hồi khỏi PUBLIC, hai role thật sự cần hàm
      -- này (nó nằm trong vị từ USING của mọi policy RLS) phải còn EXECUTE. Cấp lại ở MỌI
      -- lần chạy để kịch bản "role bị DROP rồi tạo lại" tự phục hồi.
      ($q$EXECUTE của app_api/app_unseal trên app_current_org_id()$q$,
       $q$to_regprocedure('public.app_current_org_id()') IS NOT NULL$q$,
       $q$GRANT EXECUTE ON FUNCTION public.app_current_org_id() TO app_api, app_unseal$q$,
       $q$has_function_privilege('app_api', 'public.app_current_org_id()', 'EXECUTE')
         AND has_function_privilege('app_unseal', 'public.app_current_org_id()', 'EXECUTE')$q$,
       $q$'app_api EXECUTE=' || has_function_privilege('app_api', 'public.app_current_org_id()', 'EXECUTE')::text ||
         ', app_unseal EXECUTE=' || has_function_privilege('app_unseal', 'public.app_current_org_id()', 'EXECUTE')::text$q$,
       $q$quyền sở hữu hàm app_current_org_id() hoặc SUPERUSER$q$)
    ) AS t(ten_muc, dieu_kien, cau_lenh, kiem_tra, chi_tiet, quyen_can)
  LOOP
    EXECUTE 'SELECT ' || muc.dieu_kien INTO du_dieu_kien;
    CONTINUE WHEN NOT coalesce(du_dieu_kien, false);

    BEGIN
      EXECUTE muc.cau_lenh;
    EXCEPTION WHEN insufficient_privilege THEN
      -- Không quyết định gì ở đây: hậu điều kiện ngay dưới mới là thứ phân xử.
      NULL;
    END;

    EXECUTE 'SELECT ' || muc.kiem_tra INTO dung_roi;
    IF NOT coalesce(dung_roi, false) THEN
      EXECUTE 'SELECT ' || muc.chi_tiet INTO chi_tiet;
      RAISE EXCEPTION
        'Hardening không sửa được "%": trạng thái hiện tại SAI (%). Cần quyền: %. '
        'Chạy migrate() bằng role có quyền đó, hoặc sửa tay rồi chạy lại.',
        muc.ten_muc, chi_tiet, muc.quyen_can;
    END IF;
  END LOOP;
END
$khoi$;

-- [fix I2] Gỡ tư cách thành viên CẢ HAI CHIỀU:
--   (a) app_api/app_unseal là THÀNH VIÊN của một nhóm khác — kế thừa quyền của nhóm đó
--       ("GRANT legacy_group TO app_api" rồi legacy_group có SELECT trên bảng nhạy cảm).
--   (b) một role KHÁC được cấp membership VÀO app_api/app_unseal — kế thừa quyền của
--       app_api/app_unseal ("GRANT app_api TO ke_tan_cong").
--
-- [fix round 4 — N2] Cùng khuôn khoan dung: vòng lặp chỉ chạy REVOKE khi CÓ hàng, tức khi
-- đã có trôi thật; nếu REVOKE bị từ chối quyền (hoặc chỉ WARNING vì thiếu ADMIN OPTION),
-- khối kiểm tra cuối phát hiện phần còn sót và gãy to tiếng, nêu đúng cặp role nào.
DO $khoi$
DECLARE
  hang RECORD;
  con_sot text;
BEGIN
  FOR hang IN
    SELECT nhom.rolname AS ten_nhom, thanh_vien.rolname AS ten_thanh_vien
    FROM pg_auth_members am
    JOIN pg_roles nhom ON nhom.oid = am.roleid
    JOIN pg_roles thanh_vien ON thanh_vien.oid = am.member
    WHERE thanh_vien.rolname IN ('app_api', 'app_unseal')
       OR nhom.rolname IN ('app_api', 'app_unseal')
  LOOP
    BEGIN
      EXECUTE format('REVOKE %I FROM %I', hang.ten_nhom, hang.ten_thanh_vien);
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;

  SELECT string_agg(format('%s -> %s', nhom.rolname, thanh_vien.rolname), '; ')
    INTO con_sot
    FROM pg_auth_members am
    JOIN pg_roles nhom ON nhom.oid = am.roleid
    JOIN pg_roles thanh_vien ON thanh_vien.oid = am.member
   WHERE thanh_vien.rolname IN ('app_api', 'app_unseal')
      OR nhom.rolname IN ('app_api', 'app_unseal');

  IF con_sot IS NOT NULL THEN
    RAISE EXCEPTION
      'Hardening không gỡ được tư cách thành viên còn sót: %. Cần quyền: ADMIN OPTION trên '
      'các role đó hoặc SUPERUSER.', con_sot;
  END IF;
END
$khoi$;

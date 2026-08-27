-- db/migrations/004_audit_chain_functions.sql
-- Chuỗi hash của sổ kiểm toán: phép băm, trigger nối chuỗi, và hàm ghi (bất biến B3, G4).
--
-- ============================================================================================
-- B3 PHÁT BIỂU ĐÚNG MỨC — ĐỌC TRƯỚC KHI TRÍCH DẪN FILE NÀY
-- ============================================================================================
-- Chuỗi hash trong file này chứng minh ĐÚNG MỘT điều, và bàn giao đo được của Task 5 đã đóng
-- khung nó rất chặt:
--
--   CHỨNG MINH: không ai SỬA, XOÁ, CHÈN hay CẮT ĐUÔI các hàng ĐANG CÓ mà không bị phát hiện.
--   KHÔNG chứng minh (a) "mọi sự kiện đã xảy ra đều có mặt trong bảng": một trigger
--       BEFORE INSERT ... RETURN NULL có điều kiện nuốt sự kiện CÓ CHỌN LỌC trong khi seq và
--       prev_hash vẫn liền mạch — một bộ kiểm chứng đúng chuẩn sẽ báo HỢP LỆ trên một sổ đã bị
--       kiểm duyệt. (Lớp phòng thủ tương ứng là "chỉ bảy trigger được phép tồn tại trên bảng
--       sổ" trong hardening.always.sql, KHÔNG phải chuỗi hash.)
--   KHÔNG chứng minh (b) "đây vẫn là cái sổ cũ": chủ sở hữu bảng không-superuser đo được ba
--       đường dựng lại bảng (RENAME + CREATE TABLE LIKE + DROP; SET SCHEMA; DROP cả hai bảng +
--       xoá dòng 003 khỏi schema_migrations) — cả ba cho MIGRATE OK và một cái sổ khác.
--
-- Vì `audit_events`, `audit_chain_anchors` VÀ `schema_migrations` đều nằm CÙNG VÙNG TIN CẬY với
-- tác nhân, KHÔNG cái nào trong ba được dùng làm gốc tin cậy cho một phát biểu chống giả mạo.
-- Gốc tin cậy duy nhất mà S0 có được nằm NGOÀI database: mốc chuỗi xuất ra một artefact do CI
-- hoặc quy trình vận hành giữ (`exportChainHead` / `verifyAuditChain(..., externalAnchors)` ở
-- packages/audit). Với artefact đó, ca (b) BỊ PHÁT HIỆN; không có nó thì không.
-- Nói gọn: viết "sổ không bị giả mạo" là NÓI QUÁ. Phát biểu đúng là "không ai cắt ghép các hàng
-- đang có, và — nếu và chỉ nếu có mốc neo ngoài DB — sổ không bị thay thế bằng một sổ khác".
--
-- ============================================================================================
-- VÌ SAO BĂM TRONG POSTGRESQL, KHÔNG TRONG TYPESCRIPT
-- ============================================================================================
-- Băm ở tầng ứng dụng buộc phải tuần tự hoá timestamptz (micro-giây, trong khi Date của JS chỉ
-- tới mili-giây) và jsonb (Postgres chuẩn hoá số và thứ tự khoá khi lưu). Một sai khác nhỏ ở
-- khâu tuần tự hoá làm cả chuỗi không kiểm chứng được, và lỗi đó chỉ lộ ra đúng lúc có người
-- thật sự cần kiểm toán. Dùng chung MỘT hàm cho cả lúc ghi lẫn lúc kiểm chứng loại bỏ trọn vẹn
-- lớp lỗi này theo cấu trúc.

-- ============================================================================================
-- (1) PHÉP BĂM
-- ============================================================================================
-- [QT2 — cạm bẫy 4] IMMUTABLE là một LỜI KHAI, PostgreSQL không kiểm nó. Đã đo provolatile của
-- mọi hàm mà thân hàm này gọi trên PostgreSQL 16.15:
--     sha256(bytea)                 = 'i'
--     to_char(timestamp, text)      = 's'   <-- STABLE
--     convert_to(text, name)        = 's'   <-- STABLE
--     jsonb_build_object(variadic)  = 's'   <-- STABLE
--     timezone(text, timestamptz)   = 'i'
-- Nghĩa là lời khai IMMUTABLE mạnh hơn thứ các hàm được gọi bảo đảm, và cách đóng đúng theo QT2
-- là GHIM cấu hình mà chúng phụ thuộc chứ không nới phát biểu. Ba mệnh đề SET dưới đây ghim
-- đúng những GUC đó cho MỖI LỜI GỌI, nên hàm này thật sự tất định bất kể phiên gọi đặt gì.
-- Đã đo: đổi DateStyle='German, DMY', TimeZone='Asia/Tokyo', IntervalStyle='sql_standard',
-- bytea_output='escape', extra_float_digits=3 -> băm KHÔNG đổi.
-- CỐ Ý KHÔNG GHIM: IntervalStyle (không có interval trong tiền ảnh), bytea_output (prev_hash
-- được nối ở dạng bytea, không đi qua bytea_out), lc_numeric và extra_float_digits (mọi số đi
-- qua jsonb_out/int8out, cả hai IMMUTABLE — đã đo). Ghim thừa là nợ, không phải an toàn.
--
-- [QT3 — cạm bẫy 5] "pg_catalog được tìm ngầm trước" PHÁ ĐƯỢC khi pg_catalog được NÊU TÊN ở vị
-- trí sau trong search_path. Hàm này chạy trên pool ứng dụng dưới search_path của người gọi, nên
-- nó (a) ghim search_path = pg_catalog bằng mệnh đề SET và (b) vẫn viết đủ `pg_catalog.` cho mọi
-- hàm, kiểu và toán tử. Hai lớp cố ý chồng nhau: (a) hỏng nếu ai đó ALTER FUNCTION ... RESET,
-- (b) hỏng nếu ai đó sửa thân hàm — hardening canh cả hai.
--
-- [thiết kế — LỆCH KHỎI BRIEF] Tiền ảnh là một jsonb CHUẨN HOÁ, không phải concat_ws(chr(31),…)
-- như mã mẫu. Lý do đo được: bên ghi kiểm soát `action` và `resource_type`, nên nó chèn được
-- chính ký tự phân cách để hai sự kiện KHÁC NHAU cho CÙNG một băm —
--     (action='A', resource_type='B')  vs  (action='A'||chr(31)||'B', resource_type='')
-- cho cùng một chuỗi tiền ảnh. jsonb thoát dấu nháy và ranh giới trường nên không có đường đó;
-- thứ tự khoá và cách in số của jsonb là chuẩn hoá nên tiền ảnh vẫn tất định. Khoá 'v' là nhãn
-- phiên bản khuôn tiền ảnh: đổi khuôn thì đổi nhãn, để hai khuôn không bao giờ va nhau.
-- KHÔNG dùng STRICT: actor_id, resource_id, request_id được phép NULL và jsonb_build_object ghi
-- chúng thành `null` — phân biệt được với chuỗi rỗng. STRICT sẽ khiến cả hàm trả NULL khi gặp
-- NULL, làm ràng buộc octet_length(hash) = 32 thất bại, tức phá chuỗi trong im lặng.
--
-- Thân hàm cố ý KHÔNG mang chú thích: hardening.always.sql cưỡng chế lại định nghĩa này ở MỌI
-- lần migrate() và hậu điều kiện của nó so `prosrc` theo văn bản, nên chú thích trong thân sẽ
-- phải nhân bản y hệt sang đó. Meta-test trong db/audit-append-only.int.test.ts canh hai bản.
CREATE OR REPLACE FUNCTION public.audit_compute_hash(
  p_prev_hash     bytea,
  p_org_id        uuid,
  p_seq           bigint,
  p_occurred_at   timestamptz,
  p_actor_type    text,
  p_actor_id      uuid,
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid,
  p_payload       jsonb,
  p_request_id    uuid
) RETURNS bytea
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
SET DateStyle = 'ISO, YMD'
SET TimeZone = 'UTC'
SET lc_time = 'C'
AS $tbm$
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

-- ============================================================================================
-- (2) TRIGGER NỐI CHUỖI — nơi seq, prev_hash và hash được QUYẾT ĐỊNH
-- ============================================================================================
-- [cạm bẫy 3] Trước Task 6, ba cột đó do BÊN GHI chọn: 003 cấp INSERT trên chính chúng, và
-- không ràng buộc nào ép seq đơn điệu hay ép prev_hash khớp đuôi chuỗi. Hệ quả ĐÃ ĐO ở bàn giao
-- Task 5: một app_api bị chiếm CHẶN được việc ghi sổ bằng cách chiếm trước seq kế tiếp. Ca nặng
-- nhất là chiếm seq = 9223372036854775807: mọi lần ghi sau đó vỡ với "bigint out of range" VĨNH
-- VIỄN, và không ai gỡ được hàng đó ở đường DML thường vì chính B4 cấm DELETE.
--
-- Đóng bằng HAI lớp cố ý ĐỘC LẬP (mỗi lớp có test đột biến riêng):
--   (A) REVOKE INSERT (seq, prev_hash, hash) — câu INSERT nêu tên ba cột đó bị từ chối 42501;
--   (B) trigger này GHI ĐÈ ba cột đó vô điều kiện — ràng buộc được cả chủ sở hữu bảng lẫn
--       superuser, những vai mà lớp (A) không chạm tới.
-- Đã đo rằng (A) và (B) hợp nhau thì đường ghi HỢP LỆ vẫn mở: quyền cột chỉ được kiểm trên
-- những cột NÊU TÊN trong câu INSERT, còn trigger BEFORE điền phần còn lại.
--
-- [G4 — hạ tầng ghi] Đây là điểm ghi duy nhất của sổ. Mọi thao tác khoá của Task 7 nối vào đây
-- qua audit_append(); file này không tự sinh sự kiện nào.
--
-- [QT3] SET search_path = pg_catalog + viết đủ tên: thân trigger chạy dưới search_path của
-- PHIÊN GỌI nếu không ghim, và phiên gọi là pool ứng dụng.
--
-- Ba điều về THÂN hàm, viết ở NGOÀI thân có chủ ý — hậu điều kiện của hardening so `prosrc`
-- theo văn bản, nên mọi chú thích trong thân sẽ phải nhân bản y hệt sang hardening.always.sql:
--   * pg_advisory_xact_lock khoá theo TỔ CHỨC, phạm vi transaction. Hai lần ghi đồng thời cùng
--     tổ chức nối tiếp nhau thay vì cùng đọc một đầu chuỗi, nên chuỗi không phân nhánh và khoá
--     duy nhất (org_id, seq) không vỡ. Hai tổ chức khác nhau vẫn ghi song song hoàn toàn. Đánh
--     đổi nói rõ: một transaction ghi sự kiện cho HAI tổ chức theo hai thứ tự khác nhau ở hai
--     phiên có thể deadlock (40P01 — PostgreSQL tự phát hiện và huỷ một bên).
--   * Câu SELECT đọc đuôi chuỗi vẫn CHỊU RLS vì trigger chạy dưới quyền NGƯỜI GỌI. Ghi cho một
--     tổ chức khác thì nó không thấy hàng nào -> so_thu_tu = 1 -> policy WITH CHECK từ chối cả
--     câu INSERT. Không có đường nào đọc đuôi chuỗi của tổ chức khác qua đây.
--   * clock_timestamp() chứ không now(): now() trả về thời điểm bắt đầu transaction, nên nhiều
--     sự kiện trong cùng một transaction sẽ mang CÙNG dấu thời gian — chuỗi vẫn kiểm chứng được
--     nhưng thứ tự thời gian thật mất, đúng thứ người điều tra cần đầu tiên. `occurred_at` không
--     nằm trong danh sách GRANT INSERT của 003 nên bên ghi cũng không lùi ngày được.
CREATE OR REPLACE FUNCTION public.noi_chuoi_kiem_toan() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $tnc$
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

-- [cạm bẫy 2] Trigger này là trigger THỨ BẢY trên bảng sổ. Danh sách "chỉ sáu trigger được phép
-- tồn tại" trong db/migrations/hardening.always.sql (CTE `can_co`) đã được sửa TRONG CÙNG vòng
-- này để nhận nó — nếu không, lượt 'sua' của hardening sẽ GỠ nó ngay ở lần migrate() kế, mà
-- 004 thì đã nằm trong schema_migrations nên không bao giờ chạy lại: migration bốc hơi vĩnh viễn.
--
-- CREATE OR REPLACE TRIGGER, không phải CREATE TRIGGER: trên một database đã áp dụng 003 nhưng
-- CHƯA áp dụng 004, lượt 'sua' của hardening chạy TRƯỚC vòng migration đánh số và tự dựng trigger
-- này (nó đã nằm trong `can_co`) — lúc đó một CREATE TRIGGER trần ở đây sẽ ném 42710 và chặn
-- deploy vĩnh viễn. Đã đo đường nâng cấp đó.
CREATE OR REPLACE TRIGGER audit_events_noi_chuoi BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION public.noi_chuoi_kiem_toan();

-- ENABLE ALWAYS: trigger ở trạng thái 'O' (mặc định) bị BỎ QUA khi
-- session_replication_role = 'replica' — một GUC mà role đăng nhập thường đặt được.
ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_noi_chuoi;

-- ============================================================================================
-- (3) THU HỒI QUYỀN GHI TRỰC TIẾP BA CỘT CHUỖI — lớp (A)
-- ============================================================================================
-- Đặt Ở ĐÂY chứ không sửa 003: migrate() so checksum từng file, nên sửa một migration ĐÃ áp dụng
-- là lỗi cứng ([fix S7]). Quy tắc S7b ("CREATE TABLE + RLS + POLICY + GRANT cùng một file") nói
-- về việc CẤP quyền lúc tạo bảng — nó tồn tại để không có cửa sổ nào giữa hai transaction mà
-- bảng đã có mà RLS chưa bật. THU HỒI theo chiều đóng lại không mở cửa sổ nào: giữa 003 và 004
-- quyền cũ vẫn là quyền mà 003 đã cố ý cấp.
REVOKE INSERT (seq, prev_hash, hash) ON audit_events FROM app_api, app_unseal;

-- ============================================================================================
-- (4) HÀM GHI
-- ============================================================================================
-- SECURITY INVOKER (mặc định) — cố ý, và đây là quyết định an ninh chính của file:
-- SECURITY DEFINER sẽ chạy dưới quyền CHỦ SỞ HỮU hàm, tức role đã chạy migrate(). Trong môi
-- trường test đó là `postgres` (SUPERUSER), nên một hàm SECURITY DEFINER cấp EXECUTE cho app_api
-- là một mặt tấn công leo thang thật, và nó KHÔNG cần thiết: lớp (A)+(B) ở trên đã cho phép một
-- hàm INVOKER ghi đủ mà không cần quyền trên ba cột chuỗi.
CREATE OR REPLACE FUNCTION public.audit_append(
  p_org_id        uuid,
  p_actor_type    text,
  p_actor_id      uuid,
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid,
  p_payload       jsonb,
  p_request_id    uuid,
  p_ip            inet,
  p_user_agent    text
) RETURNS TABLE (id uuid, seq bigint, prev_hash bytea, hash bytea, occurred_at timestamptz)
LANGUAGE sql SET search_path = pg_catalog AS $ham$
  INSERT INTO public.audit_events (org_id, actor_type, actor_id, action, resource_type,
                                   resource_id, payload, request_id, ip, user_agent)
  VALUES (p_org_id, p_actor_type, p_actor_id, p_action, p_resource_type, p_resource_id,
          coalesce(p_payload, '{}'::pg_catalog.jsonb), p_request_id, p_ip, p_user_agent)
  RETURNING audit_events.id, audit_events.seq, audit_events.prev_hash,
            audit_events.hash, audit_events.occurred_at;
$ham$;

GRANT EXECUTE ON FUNCTION public.audit_compute_hash(bytea, uuid, bigint, timestamptz, text,
                                                    uuid, text, text, uuid, jsonb, uuid)
  TO app_api, app_unseal;
GRANT EXECUTE ON FUNCTION public.audit_append(uuid, text, uuid, text, text, uuid, jsonb, uuid,
                                              inet, text)
  TO app_api, app_unseal;

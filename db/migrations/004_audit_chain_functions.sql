-- db/migrations/004_audit_chain_functions.sql
-- Chuỗi hash của sổ kiểm toán: phép băm, trigger nối chuỗi, và hàm ghi (bất biến B3, G4).
--
-- ============================================================================================
-- B3 PHÁT BIỂU ĐÚNG MỨC — ĐỌC TRƯỚC KHI TRÍCH DẪN FILE NÀY
-- ============================================================================================
-- [vòng fix 1 — CR2] Bản trước của khối này mở đầu bằng "CHỨNG MINH: không ai SỬA, XOÁ, CHÈN
-- hay CẮT ĐUÔI các hàng ĐANG CÓ mà không bị phát hiện." Phát biểu đó ĐO ĐƯỢC LÀ SAI, và nó sai
-- theo đúng lớp lỗi mà chính khối này cảnh báo ở ba đoạn dưới: nó tự đóng khung rất chặt rồi
-- vẫn phát biểu rộng hơn thứ đo được. Reviewer dựng lại bằng CHÍNH hàm audit_compute_hash thật,
-- dưới role deploy KHÔNG superuser:
--     UPDATE audit_events SET action='DA_BI_SUA' WHERE seq=3;  -- rồi tính lại prev_hash/hash
--     đi từ seq >= 3 bằng chính hàm băm thật
--   -> không neo ngoài: {"ok":true,"checked":6,"problems":[]}   <-- kiểm chứng QUA
--   -> có neo ngoài:    ok=false, ANCHOR_MISSING tại seq 6      <-- chỉ neo ngoài bắt được
--   -> MIGRATE OK ở cả hai
-- Một chuỗi hash mà ĐẦU CHUỖI nằm trong bán kính sửa đổi của tác nhân không chứng minh gì
-- trước một tác nhân UPDATE được: nó chỉ bắt kẻ tấn công LƯỜI (sửa mà quên tính lại đuôi).
--
-- PHÁT BIỂU ĐÚNG MỨC — bản này là bản chuẩn. Hai chỗ còn lại (packages/audit/src/verifier.ts
-- và task-6-report.md §11.2) TƯƠNG ĐƯƠNG VỀ NỘI DUNG nhưng KHÔNG y hệt về văn bản: cả hai gộp
-- câu về tiền ảnh v2 vào đoạn 1, còn bản này để nó ở khối §(1) bên dưới. [vòng fix 2 — M3]
-- Không có meta-test nào canh trục này — đừng đọc "ba nơi" thành "khớp từng chữ".
--
--   Với sổ của một tổ chức MÀ PHIÊN HIỆN TẠI ĐỌC ĐƯỢC, `verifyAuditChain()` phát hiện mọi thao
--   tác XOÁ, CHÈN, CẮT ĐUÔI, và mọi thao tác SỬA trên các trường đi vào băm. `checked` là SỐ
--   HÀNG ĐỌC ĐƯỢC DƯỚI RLS, không phải số hàng tồn tại.
--
--   Trước `app_api`/`app_unseal`/SQL injection, phát biểu này mạnh — nhưng công việc do TRIGGER
--   và REVOKE THEO CỘT của B4 làm, chúng ngăn việc sửa đổi ngay từ đầu.
--
--   Trước CHỦ SỞ HỮU BẢNG KHÔNG-SUPERUSER, chuỗi KHÔNG CÓ NEO NGOÀI chứng minh về cơ bản là
--   KHÔNG GÌ CẢ: tác nhân đó sửa một hàng rồi tính lại đuôi bằng chính hàm thật.
--
--   NẾU VÀ CHỈ NẾU người kiểm truyền vào một `ExternalAnchor` giữ ở nơi role deploy KHÔNG GHI
--   ĐƯỢC, chuỗi còn phát hiện việc sổ bị THAY THẾ / DỰNG LẠI / LÀM RỖNG — cho TIỀN TỐ TỚI LẦN
--   XUẤT CUỐI. Nó vẫn không nói gì về sự kiện bị NUỐT TRƯỚC KHI GHI, về mọi thứ SAU lần xuất
--   cuối (nhịp neo CHÍNH LÀ cửa sổ giả mạo), hay về các cột ngoài tiền ảnh.
--
-- Hai điều KHÔNG chứng minh, giữ nguyên từ bàn giao Task 5 vì cả hai vẫn đo được:
--   (a) "mọi sự kiện đã xảy ra đều có mặt trong bảng": một trigger BEFORE INSERT ... RETURN NULL
--       có điều kiện nuốt sự kiện CÓ CHỌN LỌC trong khi seq và prev_hash vẫn liền mạch — một bộ
--       kiểm chứng đúng chuẩn sẽ báo HỢP LỆ trên một sổ đã bị kiểm duyệt. (Lớp phòng thủ tương
--       ứng là "chỉ tám trigger được phép tồn tại trên bảng sổ" trong hardening.always.sql,
--       KHÔNG phải chuỗi hash.)
--   (b) "đây vẫn là cái sổ cũ" khi KHÔNG có neo ngoài: chủ sở hữu bảng không-superuser đo được
--       ba đường dựng lại bảng (RENAME + CREATE TABLE LIKE + DROP; SET SCHEMA; DROP cả hai bảng
--       + xoá dòng 003 khỏi schema_migrations) — cả ba cho MIGRATE OK và một cái sổ khác.
--
-- Vì `audit_events`, `audit_chain_anchors` VÀ `schema_migrations` đều nằm CÙNG VÙNG TIN CẬY với
-- tác nhân, KHÔNG cái nào trong ba được dùng làm gốc tin cậy cho một phát biểu chống giả mạo.
-- Gốc tin cậy duy nhất mà S0 có được nằm NGOÀI database: mốc chuỗi xuất ra một artefact do CI
-- hoặc quy trình vận hành giữ (`exportChainHead` / `verifyAuditChain(..., externalAnchors)` ở
-- packages/audit). CƠ CHẾ đó ĐÃ CÓ; ARTEFACT thì CHƯA — không exporter, không lịch, không nơi
-- cất, không chữ ký. Đó là NỢ VẬN HÀNH, không phải một bảo đảm đã mua được.
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
-- [vòng fix 1 — CR1] TIỀN ẢNH NAY PHỦ ĐỦ MỌI CỘT CỦA `audit_events`. Bản trước gồm ĐÚNG 11
-- trường trong khi bảng có 15 cột: `id`, `ip` và `user_agent` KHÔNG đi vào băm và KHÔNG đi vào
-- bất kỳ phép kiểm nào của bộ kiểm chứng. Hai reviewer độc lập đo cùng một kết quả:
--     DISABLE TRIGGER -> UPDATE audit_events SET ip='9.9.9.9', user_agent='DA_BI_SUA'
--                     -> ENABLE ALWAYS
--     -> bam_khop = t ; verifyAuditChain ok = true ; HEAD hash KHÔNG ĐỔI (neo ngoài vẫn khớp)
--     -> MIGRATE OK
-- `ip` và `user_agent` là HAI TRƯỜNG PHÁP Y — ai kết nối từ đâu, bằng client gì. Kẻ đã qua lớp
-- trigger viết lại được địa chỉ của chính mình mà mọi lớp phát hiện đều xanh. Đây là một SỬA
-- HÀNG ĐANG CÓ thuần tuý, đúng cái mà B3 tuyên bố bắt được.
--
-- `id` CŨNG được đưa vào, và đây là một LỆCH KHỎI ĐƠN THUỐC có đo: đơn thuốc nói `id` không đưa
-- vào được vì nó là `DEFAULT gen_random_uuid()` "sinh SAU BEFORE-trigger". Đo trên PostgreSQL
-- 16.15 thì khẳng định đó SAI — giá trị DEFAULT được điền ở thì VIẾT LẠI CÂU LỆNH, tức TRƯỚC
-- khi trigger BEFORE ROW chạy:
--     CREATE TABLE t (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), a text);
--     BEFORE INSERT trigger -> RAISE NOTICE 'NEW.id = %', NEW.id
--     INSERT INTO t (a) VALUES ('x') RETURNING id
--     -> NOTICE: NEW.id = 4cc41fe8-9935-41c6-a964-6103abb7c3c5
--     -> RETURNING id = 4cc41fe8-9935-41c6-a964-6103abb7c3c5   (CÙNG giá trị)
-- Nên `id` quan sát được trong trigger VÀ bằng đúng giá trị nằm lại trong bảng. Hệ quả: tiền ảnh
-- v2 phủ 13/15 cột, hai cột còn lại là `prev_hash` (đi vào sha256 ở dạng byte, ngay trước tiền
-- ảnh) và `hash` (chính là đầu ra). Nói cách khác: KHÔNG CÒN cột nào của bảng sổ nằm ngoài băm.
--
-- Nhãn phiên bản khuôn tiền ảnh lên `trustprocure.audit.v2`: đổi khuôn thì đổi nhãn, để hai
-- khuôn không bao giờ va nhau. Hệ quả vận hành phải nói ra: hàng ghi bằng v1 KHÔNG kiểm chứng
-- được bằng hàm v2. Trong phạm vi S0 điều đó vô hại (chưa có dữ liệu production), nhưng nó là
-- một MIGRATION DỮ LIỆU thật nếu 004 đã chạy ở đâu đó — không có đường nâng cấp tại chỗ, vì
-- tính lại băm chính là thao tác mà B3 tồn tại để phát hiện.
--
-- Đã đo tính tất định của hai kiểu MỚI thêm vào tiền ảnh (không suy từ tài liệu):
--   inet_out = 'i', uuid_out = 'i' (provolatile), và cùng một tiền ảnh cho ra CÙNG digest dưới
--   DateStyle='German, DMY' + TimeZone='Asia/Tokyo' + bytea_output='escape' +
--   client_encoding='LATIN1' + lc_monetary='C' + extra_float_digits=3.
--   Giá trị NULL của `inet` vào jsonb thành `null` (phân biệt được với chuỗi rỗng), giống
--   actor_id/resource_id/request_id.
--
-- Thân hàm cố ý KHÔNG mang chú thích: hardening.always.sql cưỡng chế lại định nghĩa này ở MỌI
-- lần migrate() và hậu điều kiện của nó so `prosrc` theo văn bản, nên chú thích trong thân sẽ
-- phải nhân bản y hệt sang đó. Meta-test trong db/audit-append-only.int.test.ts canh hai bản.
CREATE OR REPLACE FUNCTION public.audit_compute_hash(
  p_prev_hash     bytea,
  p_id            uuid,
  p_org_id        uuid,
  p_seq           bigint,
  p_occurred_at   timestamptz,
  p_actor_type    text,
  p_actor_id      uuid,
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid,
  p_payload       jsonb,
  p_request_id    uuid,
  p_ip            inet,
  p_user_agent    text
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
--     [vòng fix 1 — IM7] HỆ QUẢ VẬN HÀNH, phải nói ra vì Task 7 sẽ nối MỌI thao tác khoá vào
--     audit_append(): khoá giữ TỚI COMMIT, nên một `app_api` BỊ CHIẾM mở transaction, ghi một
--     sự kiện, rồi GIỮ transaction đó là MẤT KHẢ NĂNG GHI AUDIT của cả tổ chức. Đã đo:
--         nạn nhân cùng tổ chức (lock_timeout 5s) -> "canceling statement due to lock timeout",
--             CONTEXT trỏ đúng dòng PERFORM pg_advisory_xact_lock(...)
--         tổ chức KHÁC -> seq 4 bình thường (cô lập xuyên tổ chức GIỮ ĐƯỢC, đúng thiết kế)
--     Dưới G4 ("mọi thao tác khoá sinh audit"), không ghi được audit = KHÔNG LÀM ĐƯỢC thao tác
--     khoá. Biện pháp giảm nhẹ hiển nhiên `ALTER ROLE app_api SET
--     idle_in_transaction_session_timeout` BỊ HARDENING XOÁ MỖI DEPLOY (mục "rolconfig toàn cụm
--     của app_api": ALTER ROLE ... RESET ALL, hậu điều kiện rolconfig IS NULL). Nên biện pháp
--     giảm nhẹ nằm ở TUỲ CHỌN KẾT NỐI của pool ứng dụng — packages/db/src/pool.ts đặt
--     `idle_in_transaction_session_timeout` và `lock_timeout` qua tham số `options`, NGOÀI tầm
--     với của hardening. Đó là một biện pháp GIẢM NHẸ, không phải một bản vá: nó bó cửa sổ lại
--     chứ không lấy khoá đi.
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
                       NEW.prev_hash, NEW.id, NEW.org_id, NEW.seq, NEW.occurred_at,
                       NEW.actor_type, NEW.actor_id, NEW.action, NEW.resource_type,
                       NEW.resource_id, NEW.payload, NEW.request_id, NEW.ip, NEW.user_agent);
  RETURN NEW;
END
$tnc$;

-- [cạm bẫy 2] Trigger này là trigger THỨ BẢY trên bảng sổ. Danh sách "chỉ sáu trigger được phép
-- tồn tại" trong db/migrations/hardening.always.sql (CTE `can_co`) đã được sửa TRONG CÙNG vòng
-- này để nhận nó — nếu không, lượt 'sua' của hardening sẽ GỠ nó ngay ở lần migrate() kế, mà
-- 004 thì đã nằm trong schema_migrations nên không bao giờ chạy lại: migration bốc hơi vĩnh viễn.
-- (Trigger THỨ TÁM là `audit_chain_anchors_moc_neo` ở §(5) bên dưới, cùng ràng buộc.)
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

-- ============================================================================================
-- (5) [vòng fix 1 — IM4] MỐC NEO TRONG DB CŨNG PHẢI DO DATABASE DẪN XUẤT
-- ============================================================================================
-- 003 cấp `INSERT (org_id, seq, hash)` trên `audit_chain_anchors` cho app_api và KHÔNG trigger
-- nào dẫn xuất giá trị từ sổ — NGƯỢC HẲN cái §(2)+(3) vừa làm cho `audit_events`. Đo được:
--     app_api INSERT mốc neo seq=999999 hash giả -> INSERT 0 1
--     app_api DELETE -> permission denied ; tp_deploy DELETE -> trigger chỉ-ghi-thêm TỪ CHỐI
--     verifyAuditChain -> ok=false, ANCHOR_MISSING seq 999999
-- Báo cáo vòng trước xếp đây là "DoS fail-closed (báo động giả)". Ba điều khung đó bỏ qua, đều
-- đo được:
--   (1) nó VĨNH VIỄN — trigger append-only của chính B4 chặn gỡ bỏ KỂ CẢ bởi chủ sở hữu bảng
--       trên đường DML; dọn dẹp đòi đúng cái DDL tắt trigger mà dự án coi là SỰ CỐ AN NINH;
--   (2) nó PHÁ CHẤT LƯỢNG TÍN HIỆU — một ANCHOR_MISSING THẬT thành không phân biệt được với
--       nhiễu, và giả mạo với HASH SAI TẠI MỘT SEQ CÓ THẬT làm công cụ BUỘC TỘI một hàng không
--       hề bị đụng;
--   (3) chiếm trước (org, seq) làm `ON CONFLICT DO NOTHING` của recordChainAnchor trả `null`
--       VĨNH VIỄN, nên việc NEO THẬT âm thầm thành no-op.
-- Đóng bằng ĐÚNG hai lớp của §(2)+(3): REVOKE INSERT (seq, hash) chặn app_api ở mức quyền, và
-- một trigger BEFORE INSERT ghi đè hai cột đó từ đầu chuỗi hiện tại — ràng buộc cả chủ sở hữu
-- bảng lẫn superuser.
--
-- [QT3] Cùng lý do với `noi_chuoi_kiem_toan`: ghim search_path + viết đủ `pg_catalog.`.
-- Câu SELECT chịu RLS vì trigger chạy dưới quyền NGƯỜI GỌI — neo cho tổ chức khác thì nó không
-- thấy hàng nào và RAISE, chứ không đọc trộm được đầu chuỗi của tổ chức đó.
--
-- Vì sao RAISE chứ không RETURN NULL khi tổ chức chưa có sự kiện nào: RETURN NULL trong một
-- BEFORE INSERT là ĐÚNG khuôn "nuốt có chọn lọc" mà cả file này lẫn hardening tồn tại để chặn —
-- không dựng lại nó ở đây kể cả với ngữ nghĩa lành. Đường gọi hợp lệ (`recordChainAnchor`) dùng
-- INSERT ... SELECT nên trên sổ rỗng nó chèn 0 hàng và trigger không bao giờ chạy tới.
-- Thân hàm cố ý KHÔNG mang chú thích — cùng lý do với hai hàm trên.
CREATE OR REPLACE FUNCTION public.chot_moc_neo() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $tmn$
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

CREATE OR REPLACE TRIGGER audit_chain_anchors_moc_neo BEFORE INSERT ON audit_chain_anchors
  FOR EACH ROW EXECUTE FUNCTION public.chot_moc_neo();
ALTER TABLE audit_chain_anchors ENABLE ALWAYS TRIGGER audit_chain_anchors_moc_neo;

REVOKE INSERT (seq, hash) ON audit_chain_anchors FROM app_api, app_unseal;

GRANT EXECUTE ON FUNCTION public.audit_compute_hash(bytea, uuid, uuid, bigint, timestamptz,
                                                    text, uuid, text, text, uuid, jsonb, uuid,
                                                    inet, text)
  TO app_api, app_unseal;
GRANT EXECUTE ON FUNCTION public.audit_append(uuid, text, uuid, text, text, uuid, jsonb, uuid,
                                              inet, text)
  TO app_api, app_unseal;

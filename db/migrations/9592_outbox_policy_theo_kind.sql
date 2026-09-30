-- ==============================================================================================
-- 9592_outbox_policy_theo_kind — [S1.9192 / khoản 158] RANH GIỚI `kind` THEO VAI XUỐNG TẦNG CSDL — ADR-9292
--
-- VÌ SAO (§S1.81, khoản 158). `007` cấp `app_api` và `025` cấp `app_unseal` CÙNG một bộ `GRANT UPDATE` trên đúng sáu cột
-- vòng đời của `outbox_jobs`, không giới hạn theo `kind`. Vị từ lọc `kind` của `CAU_CLAIM` (S1.81, `packages/outbox/src/runner.ts`)
-- chỉ ngăn RUNNER làm điều ấy TÌNH CỜ; một câu viết tay dưới vai nào cũng ghi được kết cục cho job của loại việc thuộc tiến trình
-- kia. Hai lớp, hai mô hình đe doạ: lớp runner là vệ sinh vận hành, lớp CSDL là QUYỀN — và lớp CSDL chưa có. Đo trước bản vá
-- (`packages/outbox/src/outbox.int.test.ts`, vế khoản 158, chạy trên cây không có tệp này): `UPDATE` dưới `app_api` nhắm job
-- `UNSEAL_RFQ` của chính tổ chức ⇒ 1 hàng; dưới `app_unseal` nhắm job `LOGIN_LINK_SEND` ⇒ 1 hàng; runner `app_api` mang handler cho
-- `UNSEAL_RFQ` claim được job ấy.
--
-- HÌNH DẠNG. Hai policy `AS RESTRICTIVE FOR UPDATE`, đối xứng theo vai và theo tập `kind`, AND vào `outbox_jobs_tenant_isolation`
-- của `007` (khuôn `027`: RESTRICTIVE chỉ SIẾT, không nới, nên đặt ở tệp khác tệp tạo bảng không mở cửa sổ nào — khoản nợ 29):
--   · `TO app_api`    — ba khoá của `buildApiOutboxHandlers` (`apps/api/src/outbox-api.ts`); `api` KHÔNG khai sổ mồ côi (S1.9151);
--   · `TO app_unseal` — hai khoá của `buildUnsealWorkerHandlers` (`apps/unseal-worker/src/composition.ts`) ∪ sổ `kind` mồ côi
--     `KIND_KHONG_NGUOI_NHAN` (`packages/outbox/src/so-kind-mo-coi.ts`; worker là tiến trình khai nó từ S1.9151) — hôm nay sổ RỖNG.
-- Chỉ `FOR UPDATE`: `SELECT` của cả hai vai không đổi (worker đếm tồn đọng qua MỌI `kind`, ADR-083; `api` đọc hàng đợi của mình),
-- `INSERT` của `app_api` không đổi (nó xếp việc cho worker qua `dispatchUnseal`, `019`/`025`). `SELECT … FOR UPDATE SKIP LOCKED`
-- trong `CAU_CLAIM` cũng chịu vế USING của policy `FOR UPDATE` (đo: PostgreSQL 16), nên một runner mang NHẦM handler của vai kia
-- claim 0 hàng — không lỗi, đúng cơ chế "0 hàng im lặng" mà khoản 83⑴ đòi KHAI: hai dòng ở `POLICY_RESTRICTIVE_KHAI` của
-- `hardening.always.sql` và bản gương `POLICY_RESTRICTIVE_DA_KHAI` ở `db/rls-coverage.int.test.ts`. `kind` không có `GRANT UPDATE`
-- cho vai nào (007, 025) nên `WITH CHECK` = `USING` chỉ để khai đủ bảy cột, không mua thêm gì. Toán tử không ghim: `migrate()`
-- đặt `search_path = public` (pg_catalog ngầm đứng trước) lúc phân tích biểu thức, và biểu thức lưu theo OID toán tử — cùng
-- khuôn `007`/`027`; bản deparse ở hai dòng khai là `(kind = ANY (ARRAY['…'::text, …]))`.
-- Thứ tự phần tử trong mảng: theo bảng chữ cái — để dòng khai nguyên văn có một dạng duy nhất.
--
-- CÁI GIÁ, NÓI RA (ADR-9292; chủ dự án chấp nhận 2026-09-30): tập `kind` mỗi vai nay SỐNG Ở CSDL. Thêm một `kind` — một handler
-- mới ở `api` hay worker, hay một dòng sổ mồ côi — là thêm MỘT MIGRATION `ALTER POLICY outbox_jobs_kind_<vai> ON public.outbox_jobs
-- USING (…) WITH CHECK (…)` cộng sửa hai dòng khai. Quên migration thì kind mới KHÔNG vai nào ghi được kết cục: job nằm `PENDING`
-- im lặng — fail-CLOSED, đúng hướng — và hai cổng đối chiếu tập `kind` của policy với `Object.keys(handlers)` ∪ sổ mồ côi
-- (`apps/unseal-worker/src/composition.int.test.ts`, `apps/api/src/composition.int.test.ts`, vế khoản 158) đỏ TRƯỚC khi tới đó.
-- Migration đã áp không sửa: kind mới ⇒ migration MỚI, không sửa tệp này.
-- ==============================================================================================

CREATE POLICY outbox_jobs_kind_app_api ON public.outbox_jobs AS RESTRICTIVE FOR UPDATE TO app_api
  USING (kind = ANY (ARRAY['LOGIN_LINK_SEND'::text, 'RFQ_DEADLINE_EXTENDED_NOTICE'::text, 'UNSEAL_APPROVAL_NOTICE'::text]))
  WITH CHECK (kind = ANY (ARRAY['LOGIN_LINK_SEND'::text, 'RFQ_DEADLINE_EXTENDED_NOTICE'::text, 'UNSEAL_APPROVAL_NOTICE'::text]));

CREATE POLICY outbox_jobs_kind_app_unseal ON public.outbox_jobs AS RESTRICTIVE FOR UPDATE TO app_unseal
  USING (kind = ANY (ARRAY['BREAK_GLASS_UNSEAL_ALERT'::text, 'UNSEAL_RFQ'::text]))
  WITH CHECK (kind = ANY (ARRAY['BREAK_GLASS_UNSEAL_ALERT'::text, 'UNSEAL_RFQ'::text]));

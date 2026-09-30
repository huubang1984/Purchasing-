-- db/migrations/9565_api_to_chuc_co_viec.sql
-- [S1.9165 / khoản 277] NGUỒN TẬP TỔ CHỨC CHO `JobRunner` CỦA TIẾN TRÌNH `api` SAU KHI KHỞI ĐỘNG LẠI
--
-- ============================================================================================
-- BÀI TOÁN
-- ============================================================================================
-- `apps/api/src/composition.ts` dựng runner với `listOrganizations` là tập tổ chức mà CHÍNH tiến
-- trình đã thấy xếp việc (`toChucDaThay`, dấu ADR-047). Tập ấy rỗng lại sau mỗi lần khởi động (deploy,
-- ECS thay task, OOM), nên mọi job `PENDING` của `api` — link đăng nhập, tin báo người duyệt, tin gia
-- hạn: job đang chờ thử lại, job xếp ngay trước khi chết, job mà một instance KHÁC xếp rồi chết trước
-- lời đánh thức (ADR-022) — chờ tới yêu cầu GHI CÓ XẾP VIỆC kế tiếp của chính tổ chức ấy. Vòng poll 5 s
-- không giúp vì danh sách rỗng. ĐO (§S1.9165, `apps/api/src/composition.int.test.ts` khối khoản 277,
-- trên cây trước tệp này): tiến trình mới, không lời `/auth/link` nào ⇒ job vẫn `PENDING` sau 15 s.
--
-- `app_api` KHÔNG tự đọc được hàng đợi xuyên tổ chức: `outbox_jobs` bật ENABLE + FORCE RLS và policy
-- cách ly (007) áp cho mọi vai — kể cả chủ bảng. Chủ dự án chốt hình dạng ngày 2026-09-30 (kế hoạch đợt
-- 3, câu 10): MỘT hàm HẸP riêng, `SECURITY DEFINER`, trả `org_id` có job `PENDING` thuộc TẬP `kind` của
-- `api` — KHÔNG phải danh sách tổ chức đầy đủ, và KHÔNG mở hàm `052` cho `app_api` (ADR-040: api là tiến
-- trình hướng internet; một lỗi ở một handler không được đọc ra danh sách mọi khách hàng). Tiểu mục
-- ADR-040 ghi vì sao.
--
-- ============================================================================================
-- VÌ SAO CÓ MỘT POLICY, CHỨ KHÔNG CHỈ MỘT HÀM
-- ============================================================================================
-- Cùng cơ chế ADR-040 đã đo (§S1.82, cảnh ❷): `SECURITY DEFINER` chỉ đổi `current_user` sang chủ hàm, nó
-- KHÔNG tạo miễn trừ RLS, và FORCE bỏ đúng miễn trừ của chủ bảng. Một hàm trần do vai thường sở hữu trả
-- 0 hàng, KHÔNG LỖI — và với tiến trình này "0 hàng" trông y hệt "không có việc", nên hỏng ấy im lặng
-- hẳn (worker còn phép kiểm "0 tổ chức ⇒ không lên"; `api` thì 0 là bình thường). Nên, như `052`:
--   ⑴ chủ hàm là `app_liet_ke_to_chuc` — vai NOLOGIN NOINHERIT sẵn có (BƯỚC 0 của hardening dựng), chủ
--      của hàm `052`; tệp này cấp cho nó ĐÚNG ba cột mà thân hàm đọc;
--   ⑵ một policy `FOR SELECT TO app_liet_ke_to_chuc` trên `outbox_jobs` với vị từ `status = 'PENDING'` —
--      chủ thể hẹp bằng `TO`, và hàng hẹp bằng vị từ: vai chủ hàm thấy đúng hàng đang chờ, không thấy
--      hàng đã xong, đã hỏng, đang chạy;
--   ⑶ hàm `public.outbox_to_chuc_co_viec_api()`: `EXECUTE` chỉ cho `app_api`, `search_path` ghim.
-- Vì sao chung vai chủ với `052` chứ không một vai mới (biên bản §S1.9165 mục 5): vai ấy NOLOGIN, không
-- tiến trình nào mang nó làm `current_user` ngoài thân hai hàm, và thân cả hai hàm được hardening ghim —
-- chỉ SUPERUSER thay được thân (ADR-040 "Điều CHƯA CHẮC"). Một vai mới kéo theo BƯỚC 0, một hàng thuộc
-- tính, và các tập vai khai trong test (tập vai ngoài cây của `db/hardening-suy-tu-tinh-chat.int.test.ts`,
-- tập vai trong policy của `db/rls-coverage.int.test.ts`) — nhiều bề mặt hơn cho cùng một bán kính.
--
-- ============================================================================================
-- CÁI GIÁ, GHI RA ĐỂ KHÔNG AI ĐỌC NHẦM
-- ============================================================================================
--   * `app_api` nay biết MỘT tập con các `org_id` có việc `PENDING` của chính nó ở thời điểm gọi — không
--     tên, không email, không nội dung job. UUID tổ chức không phải bí mật (ADR-107), nhưng đây vẫn là
--     một đường đọc xuyên tổ chức có chủ ý: dòng thứ HAI của `NGOAI_LE_DOC_VONG`, dòng thứ BA của
--     `NGOAI_LE_HINH_DANG` (hardening), khai theo chữ ký `outbox_to_chuc_co_viec_api()`.
--   * Tập `kind` của `api` nay sống ở HAI chỗ trong CSDL: policy `outbox_jobs_kind_app_api` (095) và thân
--     hàm này. Thêm một `kind` cho `api` là một migration MỚI sửa CẢ HAI (ADR-134); quên thân hàm thì job
--     của kind ấy không được phục hồi sau khởi động lại — và vế đối chiếu với bảng handler ở
--     `apps/api/src/composition.int.test.ts` (khối khoản 277) đỏ trước khi tới đó.
--   * Chỉ `PENDING`. Job `RUNNING` mà tiến trình chết giữa handler (hết hạn thuê) KHÔNG làm tổ chức vào
--     tập — ngoài phạm vi câu 10, mở thành khoản 9465 (§S1.9165).
--   * Lời khai *"hàm SECURITY DEFINER DUY NHẤT của kho"* (052 và nơi khác) THIU từ tệp này; chú thích
--     của `052` không sửa được (checksum, khoản 19) — đính chính ở tiểu mục ADR-040.
-- ============================================================================================

-- ⑴ QUYỀN CỦA VAI CHỦ HÀM: ĐÚNG ba cột mà thân hàm ở ⑶ đọc (`org_id` trả về, `status` và `kind` lọc).
--    `payload` KHÔNG được cấp — nó mang địa chỉ email của link đăng nhập (007, 041). `EXECUTE` trên
--    `app_current_org_id()` — vị từ của policy cách ly, vẫn được đánh giá dưới vai này vì hai policy
--    PERMISSIVE hợp bằng OR — đã có từ `052`.
GRANT SELECT (org_id, kind, status) ON public.outbox_jobs TO app_liet_ke_to_chuc;

-- ⑵ POLICY. `FOR SELECT` (không phải `FOR ALL`), `TO app_liet_ke_to_chuc` (không phải PUBLIC), vị từ là
--    đúng lát hàng hàm cần. Không `WITH CHECK`: PostgreSQL từ chối nó trên `FOR SELECT`.
--
--    LẠC CHỖ CÓ CHỦ Ý: `outbox_jobs` ra đời ở `007` CÙNG policy cách ly của nó, nên không có cửa sổ nào
--    bảng ấy trần. Đây là policy PERMISSIVE thứ hai của bảng, và nó NỚI chứ không siết — cùng hình dạng
--    `052` trên `organizations` và `044` trên `otp_rate_limits`, cùng cách xử lý: một DÒNG CÓ TÊN ở
--    `NGOAI_LE_LAC_CHO` của `db/migration-shape.test.ts` và một dòng khoá sáu cột ở `NGOAI_LE_HINH_DANG`
--    của hardening. Hardening dựng lại policy này nếu nó bị DROP: vắng nó, hàm
--    trả 0 hàng không lỗi — đúng cảnh ❷ — và `api` không phân biệt được với "không có việc".
CREATE POLICY outbox_jobs_liet_ke_viec_api ON public.outbox_jobs
  FOR SELECT TO app_liet_ke_to_chuc
  USING (status = 'PENDING');

-- ⑶ HÀM. Thân PHẢI trùng ô ghim trong `hardening.always.sql` sau khi chuẩn hoá khoảng trắng — không chú
--    thích bên trong `$ham$`, không ký tự `$` trong thân.
--
--    Tập `kind` là ĐÚNG ba khoá của `buildApiOutboxHandlers` (`apps/api/src/outbox-api.ts`) = tập của
--    policy `outbox_jobs_kind_app_api` (095), theo thứ tự chữ cái như ở đó. Job `PENDING` của worker
--    (`UNSEAL_RFQ`, `BREAK_GLASS_UNSEAL_ALERT`) KHÔNG làm tổ chức vào tập: `api` không claim được chúng
--    (mảng lọc của runner, policy 095), và một tổ chức chỉ có việc của worker không phải việc của `api`.
--    `status = 'PENDING'` viết ra dù policy ⑵ đã cắt đúng lát ấy: nghĩa của hàm không được dựa vào một
--    policy nằm ở chỗ khác.
--
--    `SET search_path = pg_catalog` (không kèm `, pg_temp`): thân ghi đủ schema cho bảng, không gọi hàm
--    nào — cùng lý do `052`. `STABLE`: chỉ đọc. `DISTINCT`: mỗi tổ chức một lần, dù có bao nhiêu job.
CREATE OR REPLACE FUNCTION public.outbox_to_chuc_co_viec_api()
  RETURNS SETOF pg_catalog.uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
AS $ham$ SELECT DISTINCT j.org_id FROM public.outbox_jobs j WHERE j.status = 'PENDING' AND j.kind = ANY (ARRAY['LOGIN_LINK_SEND', 'RFQ_DEADLINE_EXTENDED_NOTICE', 'UNSEAL_APPROVAL_NOTICE']) $ham$;

-- ⑷ ACL. PostgreSQL cấp EXECUTE cho PUBLIC trên MỌI hàm mới — `REVOKE` là bắt buộc. Người gọi DUY NHẤT
--    là `app_api`; `app_unseal`, `app_neo`, `app_khoi_tao` không có việc gì với tập này và không được cấp
--    (hardening canh cả năm vế ở mọi lần `migrate()`).
REVOKE ALL ON FUNCTION public.outbox_to_chuc_co_viec_api() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.outbox_to_chuc_co_viec_api() TO app_api;
--    THỨ TỰ LÀ LOAD-BEARING, cùng lý do `052` ⑷: khối này chạy TRƯỚC khi đổi chủ, lúc vai deploy còn là
--    chủ hàm; sau `ALTER … OWNER TO` thì `REVOKE` của vai deploy im lặng không làm gì.

-- ⑸ CHỦ HÀM TƯỜNG MINH, bằng hai quyền MƯỢN trong đúng giao dịch này rồi TRẢ LẠI — nguyên khuôn `052` ⑸,
--    đo từng cái một ở đó: ⓐ người chạy phải đổi vai sang được vai đích (`must be able to` …), ⓑ chủ MỚI
--    phải có `CREATE` trên schema chứa hàm. Trên cụm test `migrate()` chạy bằng SUPERUSER — hai câu cấp là
--    vô hại; dưới vai deploy CREATEROLE (hồ sơ N3) vai ấy là người tạo `app_liet_ke_to_chuc` ở BƯỚC 0 nên
--    tự cấp được `SET` cho mình.
DO $muon$
BEGIN
  BEGIN
    EXECUTE pg_catalog.format('GRANT app_liet_ke_to_chuc TO %I WITH INHERIT FALSE, SET TRUE',
                              current_user);
  EXCEPTION
    -- Vai đang chạy đã đổi vai sang được rồi thì không cần mượn. Chỉ nuốt ĐÚNG lỗi thiếu quyền.
    WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'GRANT CREATE ON SCHEMA public TO app_liet_ke_to_chuc';
END
$muon$;

ALTER FUNCTION public.outbox_to_chuc_co_viec_api() OWNER TO app_liet_ke_to_chuc;

-- Trả lại NGAY, trong cùng giao dịch.
REVOKE CREATE ON SCHEMA public FROM app_liet_ke_to_chuc;

DO $tra$
BEGIN
  EXECUTE pg_catalog.format('REVOKE SET OPTION FOR app_liet_ke_to_chuc FROM %I', current_user);
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  -- Không có gì để thu hồi (vai chưa bao giờ được cấp) là trạng thái ĐÚNG, không phải lỗi.
  WHEN undefined_object THEN NULL;
END
$tra$;

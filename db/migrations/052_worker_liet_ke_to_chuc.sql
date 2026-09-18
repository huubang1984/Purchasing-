-- db/migrations/052_worker_liet_ke_to_chuc.sql
-- KHOẢN 116 — NGUỒN DANH SÁCH TỔ CHỨC CHO `JobRunner` CỦA `apps/unseal-worker`
--
-- ============================================================================================
-- BÀI TOÁN, VÀ VÌ SAO MỘT HÀM `SECURITY DEFINER` MỘT MÌNH KHÔNG GIẢI ĐƯỢC NÓ
-- ============================================================================================
-- `JobRunner.runOnce()` NÉM nếu thiếu `listOrganizations`; đó là hệ quả cố ý của quyết định
-- KHÔNG dùng role vượt RLS (xem khối cùng tên ở packages/outbox/src/runner.ts). Tiến trình `api`
-- trả được cổng ấy bằng một tập "tổ chức ĐÃ THẤY enqueue", nhưng tập ấy KHÔNG ĐẦY ĐỦ và một
-- tiến trình RIÊNG không có gì để nạp vào nó.
--
-- `organizations` bật `ENABLE` **và `FORCE`** RLS, và policy `organizations_tenant_isolation`
-- CỐ Ý không có mệnh đề `TO` (002) — nên nó áp cho PUBLIC, **kể cả CHỦ SỞ HỮU BẢNG**. Một hàm
-- `SECURITY DEFINER` chỉ đổi `current_user` sang CHỦ HÀM; nó KHÔNG tạo ra một miễn trừ RLS.
-- Chỉ SUPERUSER được miễn.
--
-- ĐO (§S1.82, ba tổ chức trong bảng, gọi từ `app_unseal` trên kết nối CHƯA gắn tổ chức):
--
--   ⓿ `app_unseal` SELECT thẳng `organizations`                        -> 0
--   ❶ hàm SECDEF, chủ = `postgres`  (đây là cảnh của CỤM TEST)         -> 3
--   ❷ hàm SECDEF, chủ = vai thường NOSUPERUSER (cảnh của CỤM THẬT)     -> 0   ← KHÔNG LỖI
--   ❸ cùng hàm ❷, thêm policy `FOR SELECT TO` đúng chủ hàm             -> 3
--   ❹ `app_unseal` SELECT thẳng `organizations` SAU khi có policy ❸    -> 0
--   ❺ sau `REVOKE EXECUTE` khỏi `app_unseal`                           -> 42501
--
-- ❶ so với ❷ là toàn bộ lý do file này dài: một hàm không định chủ sẽ **XANH trên CI và trả 0
-- tổ chức ở sản xuất**, rồi `runOnce()` gặp danh sách rỗng thì `return 0` — không ném, không
-- `onPollError`. Hỏng IM LẶNG trên đúng đường mở thầu. Kho đã đo chính cơ chế ấy từ S0 và ghi ở
-- `005_identity.sql` (`ĐO-1d` chủ sở hữu -> 0, `ĐO-1e` superuser -> 1).
--
-- ❹ là vế giữ bán kính: policy mới mang `TO app_liet_ke_to_chuc`, nên `app_unseal` đọc THẲNG
-- `organizations` vẫn thấy 0 hàng. Nó chỉ đi qua được ĐÚNG MỘT hàm, trả về ĐÚNG MỘT cột.
--
-- ============================================================================================
-- CÁI GIÁ, GHI RA ĐỂ KHÔNG AI ĐỌC NHẦM
-- ============================================================================================
-- Đây là hàm `SECURITY DEFINER` ĐẦU TIÊN của kho, nên nó là dòng ĐẦU TIÊN của
-- `NGOAI_LE_DOC_VONG` — một danh sách RỖNG từ S0. Hệ quả: **mười chỗ trong bảy migration ĐÃ ÁP**
-- khai *"mục (C) của hardening CẤM mọi hàm SECURITY DEFINER"* trở thành lời khai THIU, và chúng
-- KHÔNG sửa được — đổi chú thích của một migration đã áp là đổi checksum của nó (khoản 19).
-- Đính chính sống ở ADR-040 và ở khoản 162; mười chỗ ấy là: 005 (190, 329, 460), 006 (110, 401),
-- 010 (231), 011 (249), 018 (253), 027 (116), 034 (14).
--
-- Chủ dự án chọn hình dạng này ngày 2026-09-18, SAU khi phép đo ở trên bác hình dạng "hàm trần"
-- mà chính chủ dự án đã duyệt trước đó cùng ngày. ADR-040.
-- ============================================================================================

-- ⑴ QUYỀN CỦA VAI CHỦ HÀM. Vai `app_liet_ke_to_chuc` do hardening BƯỚC 0 tạo (cùng khuôn với
--    `app_api`/`app_unseal`: role là đối tượng CỤM, nên nó thuộc tệp chạy MỌI lượt chứ không
--    thuộc một migration đánh số — một migration đã áp không chạy lại, nên role bị DROP sẽ không
--    bao giờ trở lại). Ở đây chỉ cấp quyền, và cấp đúng hai thứ:
--
--    ĐÚNG MỘT CỘT của đúng một bảng. `name` và `slug` KHÔNG được cấp: hàm chỉ trả `id`, và một
--    GRANT rộng hơn thân hàm là một quyền không ai gỡ ra nữa.
GRANT SELECT (id) ON public.organizations TO app_liet_ke_to_chuc;
--    Và `EXECUTE` trên vị từ mà policy CÁCH LY gọi. Hai policy PERMISSIVE được PostgreSQL hợp
--    bằng OR, nên vị từ của policy cách ly VẪN được đánh giá dưới vai này; thiếu EXECUTE thì
--    phép đánh giá ấy ném 42501 và hàm hỏng ỒN ÀO — nhưng hỏng.
GRANT EXECUTE ON FUNCTION public.app_current_org_id() TO app_liet_ke_to_chuc;

-- ⑵ POLICY. `FOR SELECT` (không phải `FOR ALL`) và `TO app_liet_ke_to_chuc` (không phải PUBLIC).
--    Hai vế ấy là bán kính: vai này KHÔNG ghi được gì, và không vai nào khác hưởng policy này.
--    `USING (true)` đọc được vì chủ thể đã hẹp bằng `TO`; một vị từ phức tạp hơn ở đây chỉ là
--    một vị từ nữa để trôi.
--
--    LẠC CHỖ CÓ CHỦ Ý: bảng `organizations` ra đời ở `002` cùng policy cách ly của nó, nên
--    KHÔNG có cửa sổ nào bảng ấy trần. Đây là policy THỨ HAI, và nó NỚI chứ không siết — cùng
--    hình dạng với `044` trên `otp_rate_limits`, và cùng cách xử lý: một DÒNG CÓ TÊN trong
--    `NGOAI_LE_LAC_CHO` của `db/migration-shape.test.ts`, không phải một vế điều kiện mới.
CREATE POLICY organizations_liet_ke_worker ON public.organizations
  FOR SELECT TO app_liet_ke_to_chuc
  USING (true);

-- ⑶ HÀM. Thân PHẢI trùng ô ghim trong `hardening.always.sql` sau khi chuẩn hoá khoảng trắng —
--    không chú thích bên trong `$ham$`, không ký tự `$` trong thân.
--
--    `SET search_path = pg_catalog` (KHÔNG kèm `, pg_temp`): thân đã ghi đủ schema cho cả bảng
--    lẫn không có lời gọi hàm nào, nên không có chỗ nào che tên được. Một hàm SQL có mệnh đề
--    `SET` thì mất inlining — ở đây không sao, hàm này chạy MỘT LẦN mỗi lượt poll, khác hẳn
--    `app_current_org_id()` nằm trong vị từ USING của mọi policy trên mọi hàng (001 ghi rõ vì
--    sao hàm ấy cố ý KHÔNG có mệnh đề SET).
CREATE OR REPLACE FUNCTION public.outbox_danh_sach_to_chuc()
  RETURNS SETOF pg_catalog.uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
AS $ham$ SELECT o.id FROM public.organizations o $ham$;

-- ⑷ ACL. PostgreSQL cấp EXECUTE cho PUBLIC trên MỌI hàm mới — đó là hành vi cứng của nền tảng,
--    không phải do file này cấp — nên `REVOKE` là bắt buộc chứ không phải vệ sinh. `app_api`
--    được nêu ĐÍCH DANH: nó không có việc gì với danh sách tổ chức, và tiến trình `api` đã có
--    nguồn riêng của nó (tập "tổ chức đã thấy enqueue").
REVOKE ALL ON FUNCTION public.outbox_danh_sach_to_chuc() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outbox_danh_sach_to_chuc() FROM app_api;
GRANT EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() TO app_unseal;
--    THỨ TỰ LÀ LOAD-BEARING: khối này phải chạy TRƯỚC khi đổi chủ. ĐO — đặt nó SAU
--    `ALTER … OWNER TO` thì vai deploy thôi là chủ hàm, nên `REVOKE` của nó IM LẶNG không làm
--    gì, và hardening nêu `proacl hien tai: =X/app_liet_ke_to_chuc,...` tức PUBLIC vẫn có
--    EXECUTE. Đổi chủ thì PostgreSQL viết lại NGƯỜI CẤP trong ACL, nên các mục cấp ở đây đi
--    theo sang chủ mới — còn việc PUBLIC vắng mặt thì được giữ.

-- ⑸ CHỦ HÀM TƯỜNG MINH. Đây là ranh giới an ninh của cả file, nên nó KHÔNG được để phụ thuộc
--    vào việc vai nào tình cờ chạy `migrate()`. Không có dòng này, chủ hàm là vai deploy: trên
--    cụm test đó là superuser (❶, xanh giả) và trên cụm thật đó là một vai thường (❷, 0 hàng).
--
--    MỘT QUYỀN MƯỢN TRONG ĐÚNG GIAO DỊCH NÀY, RỒI TRẢ LẠI NGAY. `ALTER … OWNER TO` đòi người
--    chạy phải đổi được vai sang vai đích. ĐO: vai deploy thường chạy thẳng câu dưới ra lỗi
--    `must be able to` đổi vai sang vai chủ. PostgreSQL 16 cấp cho NGƯỜI TẠO role một
--    membership CHỈ-ADMIN (`INHERIT FALSE, SET FALSE` — chính hardening ghi điều này ở khối
--    `VAI_KET_NOI_UNG_DUNG`), và `ADMIN OPTION` cho phép vai ấy tự cấp tuỳ chọn ấy cho mình.
--
--    Vì sao mượn-rồi-trả thay vì để lại: một membership thường trực sẽ bị BƯỚC 1 của hardening
--    gỡ ở lượt `sua` kế (nó gỡ MỌI membership ngoài `CAP_HOP_LE`), nên nó không sống được — và
--    nếu ta khai nó vào danh sách trắng thì vai deploy giữ vĩnh viễn một đường đổi vai sang
--    chủ của hàm `SECURITY DEFINER` duy nhất trong kho. Cả file này chạy trong MỘT giao dịch, nên
--    quyền mượn không tồn tại ngoài nó.
--
--    Trên cụm test `migrate()` chạy bằng SUPERUSER — câu `GRANT` dưới là no-op vô hại, và
--    `ALTER … OWNER TO` đi qua vì superuser không cần membership.
--    HAI quyền phải mượn, không phải một — đo từng cái một:
--      ⓐ người chạy phải đổi vai sang được vai đích (`must be able to` … vai chủ);
--      ⓑ `permission denied for schema public` — và CHỦ MỚI phải có `CREATE` trên schema chứa
--         hàm. `001` chỉ cấp `USAGE` cho app_api/app_unseal, không cấp `CREATE` cho ai.
--    ⓑ là quyền nặng hơn hẳn ⓐ (nó cho phép tạo đối tượng trong `public`), nên nó càng phải
--    sống đúng bằng một giao dịch.
DO $muon$
BEGIN
  BEGIN
    EXECUTE pg_catalog.format('GRANT app_liet_ke_to_chuc TO %I WITH INHERIT FALSE, SET TRUE',
                              current_user);
  EXCEPTION
    -- Vai đang chạy đã đổi vai sang được rồi (superuser, hoặc đã là thành viên) thì không
    -- cần mượn. Chỉ nuốt ĐÚNG lỗi thiếu quyền; mọi lỗi khác ném ra và gãy ỒN ÀO.
    WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'GRANT CREATE ON SCHEMA public TO app_liet_ke_to_chuc';
END
$muon$;

ALTER FUNCTION public.outbox_danh_sach_to_chuc() OWNER TO app_liet_ke_to_chuc;

-- Trả lại NGAY, trong cùng giao dịch. Sau file này vai chủ hàm có đúng hai quyền: `SELECT (id)`
-- trên `organizations` và `EXECUTE` trên `app_current_org_id()`.
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

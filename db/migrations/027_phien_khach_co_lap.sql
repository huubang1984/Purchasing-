-- =============================================================================================
-- 027 — [khoản nợ 29] A5 XUỐNG TẦNG CSDL: MỘT PHIÊN KHÁCH KHÔNG ĐỌC ĐƯỢC LUỒNG CỦA NGƯỜI KHÁC
-- =============================================================================================
-- Khối A5 của `018` nói thẳng khoảng trống:
--
--     "Phiên khách chạy dưới CÙNG role `app_api` và CÙNG `app.org_id` của tổ chức NGƯỜI MUA
--      (010). Nghĩa là RLS KHÔNG cô lập nhà cung cấp này với nhà cung cấp kia — nó chỉ cô lập
--      tổ chức. ... Hình dạng đúng để đóng nốt là một role `app_guest` với policy theo
--      `current_setting('app.guest_session_id')`."
--
-- ---------------------------------------------------------------------------------------------
-- MỘT SAI LỆCH SO VỚI HÌNH DẠNG ĐÃ ĐỀ XUẤT, VÀ LÝ DO LÀ MỘT PHÉP ĐO
-- ---------------------------------------------------------------------------------------------
-- File này KHÔNG tạo role `app_guest`. Tôi đã định tạo, rồi đọc `hardening.always.sql` và đổi ý:
--
--   ⑴ Một role thứ ba PHẢI được `hardening.always.sql` cưỡng chế lại thuộc tính ở MỌI lần
--     `migrate()`. Không thế thì một `ALTER ROLE app_guest BYPASSRLS` sau triển khai sống mãi —
--     và một `app_guest` có `BYPASSRLS` là ĐÚNG NGƯỢC LẠI thứ A5 cần. Nhưng file ấy liệt kê role
--     theo TÊN ở ba chỗ (tạo role, ghim thuộc tính, và bước gỡ membership vốn hẹp xuống ĐÚNG hai
--     cặp `app_*_login → app_*`), tức đóng khoản nợ này bằng role sẽ kéo theo một lần sửa file
--     1600 dòng chịu lực nhất kho.
--
--   ⑵ Và một role KHÔNG mạnh hơn ở đúng trục đang bàn. Cả hai thiết kế đều đứng trên *"ứng dụng
--     chọn đúng cách nối"*: quên dùng pool `app_guest` cũng hỏng y như quên gắn
--     `app.guest_session_id`. Thứ THẬT SỰ cô lập là VỊ TỪ RLS, không phải cái tên role.
--
--   ⑶ `hardening.always.sql` ghi rõ: *"HÌNH DẠNG THỨ TƯ — policy AS RESTRICTIVE — KHÔNG cần dòng
--     nào"* trong danh sách ngoại lệ hình dạng. Tức nó đã CHỪA SẴN chỗ cho đúng cách làm này.
--
-- Nên: policy `AS RESTRICTIVE`, cộng vào policy sẵn có bằng phép HỘI, KHÔNG chạm một dòng nào của
-- đường người mua. Role `app_guest` vẫn là một việc đáng làm — phòng thủ chiều sâu ở tầng GRANT —
-- và nó ở lại sổ nợ với đúng lý do đo được ở ⑴.
--
-- ---------------------------------------------------------------------------------------------
-- MẶC ĐỊNH LÀ TỪ CHỐI, VÀ ĐÓ LÀ VẾ CHỊU LỰC
-- ---------------------------------------------------------------------------------------------
-- Mọi bảng có RLS đều nhận một policy `<bảng>_khach`. Bảng nào KHÔNG nằm trong BẢY bảng của mặt
-- khách (`guest_sessions`, `rfq_invitations`, `vendor_bids`, `vendor_bid_versions`,
-- `bid_receipts`, `rfq_packages`, `rfq_items`) thì vị từ của nó là *"GUC phiên khách rỗng"* —
-- nghĩa là **một kết nối đã gắn phiên khách nhìn thấy KHÔNG HÀNG NÀO**. Không phải một danh sách
-- cấm; một danh sách CHO PHÉP, và mọi thứ ngoài nó đóng.
--
-- Vòng lặp ở mục (6) là một lần LẤP MỘT LƯỢT cho lược đồ hôm nay, không phải một cơ chế tự duy
-- trì. Thứ làm cho bảng TIẾP THEO phải được quyết định là một lớp canh ở
-- `tests/adversarial/a5-co-lap-nha-cung-cap.int.test.ts`: mọi bảng có RLS phải có policy
-- `<bảng>_khach`, suy từ `pg_class.relrowsecurity` chứ không từ một danh sách tên. Một bảng mới
-- ra đời mà không ai quyết định sẽ ĐỎ — cùng khuôn `KIND_KHONG_NHAN` của khoản nợ 34.
--
-- ---------------------------------------------------------------------------------------------
-- PHẠM VI, NÓI RA THAY VÌ ĐỂ TRÍCH QUÁ LỜI
-- ---------------------------------------------------------------------------------------------
-- Bảo đảm là: **KHI một kết nối đã gắn `app.guest_session_id`, nó chỉ đọc được dữ liệu của đúng
-- lời mời ấy.** Nó KHÔNG nói gì về một kết nối chưa gắn — đường người mua vẫn thấy mọi thứ của tổ
-- chức mình, đúng như trước. Chuyển đường phục vụ khách sang `withGuestSession()` là việc của
-- tầng ứng dụng, và hôm nay `apps/` chưa có tầng HTTP nào để chuyển. Vì vậy A5 nay có một lớp
-- CSDL **có thể** cưỡng chế; nó chưa tự động cưỡng chế cho mọi lời gọi.
--
-- Đường GHI của khách (`submitBid`) vẫn chạy dưới đường người mua và vẫn được canh bởi trigger
-- `bid_kiem_phien_khach` của `018` — vế ấy chưa từng hở. Thứ hở là đường ĐỌC, và đó là thứ file
-- này đóng.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- (1) HAI HÀM ĐỌC NGỮ CẢNH — VÀ MỘT LÝ DO VÌ SAO CHÚNG KHÔNG XUẤT HIỆN TRONG POLICY NÀO
-- ---------------------------------------------------------------------------------------------
-- MỘT VÒNG ĐO NỮA ĐÃ ĐỔI HÌNH DẠNG FILE NÀY. Bản trước viết policy bằng chính hai hàm dưới đây.
-- Bộ test tích hợp đỏ ở BA chỗ với `permission denied for function app_current_guest_session_id`:
-- `db/audit-append-only.int.test.ts`, `packages/outbox/src/outbox.int.test.ts` (role
-- `t10_thuong`), và `db/rls-coverage.int.test.ts` (role `chu_so_huu_thuong`).
--
-- Cơ chế, và nó tổng quát hơn ba ca ấy: một hàm nằm trong vị từ policy của MỌI bảng có RLS buộc
-- MỌI role muốn chạm bất kỳ bảng nào phải có `EXECUTE` trên nó. Tức file này sẽ tạo ra một khớp
-- nối MỚI giữa một chi tiết của mặt khách và MỌI role sẽ ra đời trên cụm này về sau — kể cả một
-- role báo cáo chỉ đọc, chẳng liên quan gì tới phiên khách. `app_current_org_id()` cũng có tính
-- chất ấy, nhưng nó là cái giá phải trả cho chính RLS; đây thì không.
--
-- Nên policy viết THẲNG `pg_catalog.current_setting(...)`: `current_setting` thuộc `pg_catalog`
-- và PUBLIC có `EXECUTE` sẵn theo mặc định của Postgres, nên không role nào cần được cấp thêm gì.
-- Cái giá: biểu thức lặp lại, dài, và hai bản chép (hàm và policy) phải khớp nhau bằng mắt. Cái
-- giá ấy RẺ HƠN một khớp nối chạm mọi role — và ba lần đỏ ở trên là phép đo nói ra điều đó.
--
-- Hai hàm ở lại vì `withGuestSession()` đọc lại chúng để khẳng định GUC đã có hiệu lực, và vì
-- chúng là cách gọi đọc-được của cùng biểu thức trong mã ứng dụng.
-- ---------------------------------------------------------------------------------------------
-- Cùng khuôn `app_current_org_id()` của `001`, và cùng bốn lý do: KHÔNG `SECURITY DEFINER` (mở
-- đường leo quyền, và `hardening.always.sql` mục (C) tính mọi hàm `prosecdef` là một đường đọc
-- vòng qua RLS), KHÔNG mệnh đề `SET search_path` (mệnh đề SET chặn inlining, mà hàm này nằm
-- trong vị từ của policy trên MỌI bảng), nhưng schema-qualify từng tên gọi được.
--
-- `NULLIF` cố ý không qualify: nó là cú pháp, không phải một hàng `pg_proc` — viết
-- `pg_catalog.nullif(...)` ném "function does not exist". Đã ghi ở `001`.
CREATE OR REPLACE FUNCTION public.app_current_guest_session_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid
$$;

REVOKE EXECUTE ON FUNCTION public.app_current_guest_session_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_current_guest_session_id() TO app_api, app_unseal;

-- Lời mời của phiên khách đang gắn — ĐỌC TỪ MỘT GUC THỨ HAI, KHÔNG TRA BẢNG.
--
-- (Hàm này KHÔNG được dùng trong policy nào — xem khối "MỘT VÒNG ĐO NỮA" ở mục 1. Nó ở lại vì
--  `withGuestSession()` đọc lại nó để khẳng định GUC đã có hiệu lực, và vì nó là cách đọc-được
--  của cùng biểu thức.)
--
-- BẢN ĐẦU CỦA HÀM NÀY TRA `guest_sessions`, VÀ BỘ TEST TÍCH HỢP BÁC BỎ NÓ. Cơ chế, đo được:
-- Postgres kiểm quyền trên MỌI bảng xuất hiện trong kế hoạch, ở lúc khởi động bộ chấp hành —
-- KHÔNG theo kiểu ngắn mạch của `OR`. Nên một hàm tra `guest_sessions` nằm trong vị từ policy của
-- `vendor_bids` làm MỌI role đọc `vendor_bid_versions` phải có `SELECT` trên `guest_sessions`, kể
-- cả khi nó không gắn phiên khách nào. `app_unseal` không có quyền ấy, và nó ĐỎ với
-- `permission denied for table guest_sessions` ở năm test của đường mở thầu.
--
-- Hai đường ra, và đường đã chọn là đường KHÔNG nới quyền:
--   ✘ cấp `SELECT` trên `guest_sessions` cho `app_unseal` — nới đúng thứ ADR-006 dựng hai role để
--     hẹp, và nới nó để phục vụ một vị từ mà `app_unseal` không bao giờ kích hoạt;
--   ✘ `SECURITY DEFINER` — `hardening.always.sql` mục (C) tính MỌI hàm `prosecdef` là một đường
--     đọc vòng qua RLS và đòi một dòng trong `NGOAI_LE_DOC_VONG` (đang RỖNG);
--   ✔ GUC THỨ HAI, và `withGuestSession()` DẪN XUẤT nó từ chính hàng `guest_sessions` trước khi
--     đặt — cùng khuôn `app.org_id` đã dùng từ `001`.
--
-- PHẢI NÓI CHO ĐÚNG: hàm này TIN vào một GUC, tức tin vào tầng ứng dụng. Đó KHÔNG phải một sự nới
-- lỏng so với thiết kế đang có — `app.org_id` cũng là một lời khai của ứng dụng, và toàn bộ RLS
-- của `002`–`018` treo vào nó. Thứ được thêm là một phép DẪN XUẤT có kiểm: `withGuestSession()`
-- đọc `invitation_id` từ hàng phiên, và TỪ CHỐI nếu phiên đã thu hồi hay đã hết hạn — nên một
-- phiên chết không gắn được, và người gọi không tự khai được một lời mời khác.
CREATE OR REPLACE FUNCTION public.app_current_guest_invitation_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.guest_invitation_id', true), '')::pg_catalog.uuid
$$;

REVOKE EXECUTE ON FUNCTION public.app_current_guest_invitation_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_current_guest_invitation_id() TO app_api, app_unseal;

-- ---------------------------------------------------------------------------------------------
-- (2) PHIÊN KHÁCH CHỈ THẤY CHÍNH NÓ
-- ---------------------------------------------------------------------------------------------
-- Khoá theo `id`, không theo `invitation_id`, và hệ quả đáng ghi: một khách KHÔNG đếm được phiên
-- khác của CHÍNH MÌNH — chặt hơn mức A5 đòi, và không có lý do nào để nới.
--
-- Vị từ này khoá theo GUC PHIÊN, không theo GUC LỜI MỜI, và điều đó load-bearing:
-- `withGuestSession()` phải ĐỌC ĐƯỢC hàng phiên để dẫn xuất lời mời, và lúc ấy GUC lời mời còn
-- rỗng. Một vị từ đòi lời mời ở đây sẽ khoá chính cái cửa dẫn xuất — gà và trứng.
CREATE POLICY guest_sessions_khach ON guest_sessions AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
         OR id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
              OR id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid);

-- ---------------------------------------------------------------------------------------------
-- (3) LỜI MỜI
-- ---------------------------------------------------------------------------------------------
-- Đây là chỗ A5 vế *"sự tồn tại và số lượng nhà cung cấp khác"* được đóng: không đếm được lời mời
-- của RFQ thì không đếm được đối thủ.
CREATE POLICY rfq_invitations_khach ON rfq_invitations AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
         OR id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_invitation_id', true), '')::pg_catalog.uuid)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
              OR id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_invitation_id', true), '')::pg_catalog.uuid);

-- ---------------------------------------------------------------------------------------------
-- (4) LUỒNG BÁO GIÁ, PHIÊN BẢN, BIÊN NHẬN — BA TẦNG, MỖI TẦNG DỰA VÀO TẦNG TRÊN
-- ---------------------------------------------------------------------------------------------
-- `vendor_bid_versions` và `bid_receipts` KHÔNG tự khoá theo lời mời mà khoá qua bảng cha, và đó
-- là chủ đích: `018` cố ý không sao chép `rfq_id`/`invitation_id` xuống các bảng con vì một bản
-- sao sẽ lệch được. Vị từ ở đây đi theo đúng đường dẫn xuất ấy, nên nó không thể lệch khỏi cha.
CREATE POLICY vendor_bids_khach ON vendor_bids AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
         OR invitation_id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_invitation_id', true), '')::pg_catalog.uuid)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
              OR invitation_id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_invitation_id', true), '')::pg_catalog.uuid);

CREATE POLICY vendor_bid_versions_khach ON vendor_bid_versions AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
         OR bid_id IN (SELECT b.id FROM public.vendor_bids b))
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
              OR bid_id IN (SELECT b.id FROM public.vendor_bids b));

CREATE POLICY bid_receipts_khach ON bid_receipts AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
         OR bid_version_id IN (SELECT v.id FROM public.vendor_bid_versions v))
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
              OR bid_version_id IN (SELECT v.id FROM public.vendor_bid_versions v));

-- ---------------------------------------------------------------------------------------------
-- (5) GÓI THẦU VÀ HẠNG MỤC — KHÁCH ĐỌC ĐƯỢC ĐÚNG RFQ MÌNH ĐƯỢC MỜI
-- ---------------------------------------------------------------------------------------------
-- Khoá bằng GUC THỨ BA chứ không bằng một truy vấn con vào `rfq_invitations`, và lý do là một
-- phép đo: một bảng xuất hiện trong vị từ policy làm MỌI role đọc bảng chủ phải có `SELECT` trên
-- nó (xem khối lý do ở mục 1). `rfq_packages` là bảng được đọc rộng nhất kho; bắt mọi role đọc
-- được `rfq_invitations` để đọc nó là một sự nới quyền không ai xin.
CREATE POLICY rfq_packages_khach ON rfq_packages AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL OR id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '')::pg_catalog.uuid)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL OR id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '')::pg_catalog.uuid);

CREATE POLICY rfq_items_khach ON rfq_items AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL OR rfq_id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '')::pg_catalog.uuid)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL OR rfq_id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '')::pg_catalog.uuid);

-- ---------------------------------------------------------------------------------------------
-- (6) MỌI BẢNG CÒN LẠI: TỪ CHỐI
-- ---------------------------------------------------------------------------------------------
-- Một lần lấp cho lược đồ hôm nay. Bảng nào chưa có policy `<bảng>_khach` sau sáu mục trên sẽ
-- nhận vị từ đóng. `rfq_unsealed_bids`, `rfq_key_material`, `audit_events`, `users`, `suppliers`,
-- `org_procurement_policies`, `otp_rate_limits`, … — không bảng nào trong số đó có lý do xuất
-- hiện trước một phiên khách, và không bảng nào phải được nhớ tên ở đây.
--
-- `WITH CHECK` được viết TƯỜNG MINH ở mọi policy của file này dù nó trùng `USING`. Postgres tự
-- lấy `USING` làm `WITH CHECK` khi vế kia vắng mặt, nên bỏ đi vẫn CHẠY ĐÚNG — nhưng lớp canh
-- `[INV-F1]` ở `db/rls-coverage.int.test.ts` từ chối một policy `FOR ALL` thiếu `WITH CHECK`
-- tường minh, và nó có lý: hai vế ấy đọc khác nhau, và một người sửa `USING` mà tưởng mình đã
-- sửa cả hai là một lỗi rẻ tiền để mắc. Đường GHI vì thế cũng đóng theo — một kết nối đã gắn
-- phiên khách không chèn được vào `audit_events` hay `outbox_jobs`. Nếu mai sau đường ghi của khách chuyển sang
-- `withGuestSession()`, nó sẽ hỏng ỒN ÀO ở đây thay vì âm thầm ghi được.
DO $khoi$
DECLARE
  b record;
BEGIN
  FOR b IN
    SELECT c.oid, c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
     WHERE n.nspname OPERATOR(pg_catalog.=) 'public'
       AND c.relkind OPERATOR(pg_catalog.=) 'r'
       AND c.relrowsecurity
       AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_policy p
              WHERE p.polrelid OPERATOR(pg_catalog.=) c.oid
                AND p.polname OPERATOR(pg_catalog.=) (c.relname || '_khach')::name)
     ORDER BY c.relname
  LOOP
    -- Mẫu dùng $-quote, KHÔNG dùng nháy đơn: vị từ có sẵn nháy đơn bên trong
    -- (`'app.guest_session_id'`, `''`), và trong một chuỗi nháy đơn chúng phải nhân đôi. Đã tự
    -- vấp: bản đầu viết nháy đơn và migration đổ ngay với `syntax error at or near "app"`.
    EXECUTE pg_catalog.format(
      $fmt$CREATE POLICY %I ON public.%I AS RESTRICTIVE
             USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
             WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)$fmt$,
      b.relname || '_khach', b.relname);
  END LOOP;
END
$khoi$;

-- =============================================================================================
-- 042 — [sổ nợ 55 / review H5-3, H4-5] BUCKET NGƯỜI GỌI TOÀN CỤC: MỘT HÀNG CHO TỔ CHỨC THẬT LẪN LẠ
-- =============================================================================================
-- `otp_rate_limits` mang khoá ngoại tới `organizations` (đúng cho bucket theo ĐÍCH: ADR-013 đòi
-- `org_id` vào phép băm, nếu không một bản sao lưu cho phép JOIN "hai bên mua này có cùng nhà cung
-- cấp không"). Nhưng bucket theo NGƯỜI GỌI của ba route `/auth/*` và hai route `/guest/*` không mang
-- bí mật xuyên tổ chức nào: khoá của nó là `route ‖ địa chỉ người gọi`, và địa chỉ ấy là của KẺ GÕ
-- CỬA, không phải của tổ chức. Khoá ngoại ở đó mua đúng một thứ: một ORACLE.
--
--   Lời gọi khai `orgId` KHÔNG tồn tại ⇒ INSERT vào `otp_rate_limits` ném 23503 ⇒ không đếm được.
--   S1.12 (H4-5) đi tiếp không trần; S1.13 (nợ 52) đếm trong BỘ NHỚ — hai bộ đếm RỜI cho cùng một
--   khoá, nên (H5-3) mồi N lần vào một UUID tự chọn rồi gửi UUID ứng viên là phân biệt được tổ chức
--   thật với tổ chức lạ bằng MỘT lời gọi: 429 ⇒ lạ, 200 ⇒ thật.
--
-- Bảng này là bộ đếm ấy, KHÔNG có `org_id` và KHÔNG có khoá ngoại: tổ chức thật và tổ chức lạ tăng
-- CÙNG MỘT HÀNG, nên không có gì để phân biệt. Bucket TOÀN TỔ CHỨC (`orgLimit`, nợ 52) vẫn ở
-- `otp_rate_limits` — nó ĐÚNG LÀ chuyện của một tổ chức, và tổ chức lạ không có nó (23503, bỏ qua).
--
-- HAI HỆ QUẢ PHẢI NÓI RA:
--   ⑴ Bảng KHÔNG mang `org_id`, tức nó nằm ngoài cây tenant — cùng lớp với `roles`, `permissions`,
--      `role_permissions`, và là bảng ĐẦU TIÊN ngoài cây tenant mà `app_api` GHI được. Nó vẫn bật
--      RLS + FORCE, với đúng MỘT policy (xem khối ngay trên `CREATE POLICY`): "mọi hàng, trừ phiên
--      KHÁCH". Hệ quả cho lớp canh: `VI_TU_BANG_TENANT` của hardening và mọi phép đo "bảng tenant"
--      đọc theo cột `org_id`, nên bảng này nằm NGOÀI chúng — `db/migrations.int.test.ts` [S1.14 / 042]
--      ghi rõ chỗ một phép đo từng giả định "bật RLS ⇒ thuộc cây tenant".
--   ⑵ Hàng ở đây do NGƯỜI GỌI VÔ DANH tạo ra, không cần một `orgId` hợp lệ nào — khác
--      `otp_rate_limits` (khoá ngoại buộc phải có tổ chức thật). Một kẻ xoay /64 IPv6 vì thế tạo
--      được nhiều hàng. Hàng nhỏ (32 byte băm + mốc + số) và cửa sổ 15 phút, nên đường bịt là DỌN:
--      `app_api` có DELETE mức bảng và tiến trình `api` chạy `donBucketNguoiGoiCu` mỗi 5 phút, xoá
--      mọi hàng cũ hơn hai cửa sổ. Không có bộ dọn, bảng chỉ lớn lên — nói ra vì `otp_rate_limits`
--      hôm nay đúng như thế (GRANT DELETE có, người gọi thì không).
--
-- Băm vẫn là HMAC với pepper giữ NGOÀI CSDL (ADR-018). Miền băm được tách bằng một hằng đứng đầu
-- (`LOGIN_CALLER_TOAN_CUC`) thay cho `org_id ‖ kind` của bảng kia: một UUID không bao giờ bắt đầu
-- bằng chuỗi ấy, nên hai miền không chạm nhau dù HMAC nối các phần không có dấu phân cách.
-- =============================================================================================

CREATE TABLE caller_rate_limits (
  bucket_hash   bytea NOT NULL CHECK (octet_length(bucket_hash) = 32),
  window_start  timestamptz NOT NULL,
  hits          integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (bucket_hash, window_start)
);

-- Dọn theo cửa sổ: bộ dọn quét `window_start < mốc`, và đó là truy vấn DUY NHẤT không đi qua khoá chính.
CREATE INDEX caller_rate_limits_window_idx ON caller_rate_limits (window_start);

ALTER TABLE caller_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE caller_rate_limits FORCE ROW LEVEL SECURITY;

-- Bảng TOÀN CỤC có chủ đích: không `org_id`, nên không có gì để lọc theo tổ chức — và một policy
-- `USING (true)` là ĐÚNG cái hình dạng mà `db/migration-shape.test.ts` cấm, vì nó không phân biệt
-- được với một lần quên. Vế THẬT SỰ có nghĩa ở đây là vế KHÁCH: [khoản nợ 29] bảng mới sau 027 phải
-- tự mang policy khách, và khách KHÔNG có việc gì ở bảng này (dispatcher đếm TRƯỚC handler, trong
-- một giao dịch chưa gắn phiên khách nào; bộ dọn chạy nền, cũng không phải khách). Nên policy
-- PERMISSIVE duy nhất của bảng phát biểu đúng vế ấy — "mọi hàng, trừ phiên khách" — thay vì `true`
-- cộng một RESTRICTIVE nói cùng một điều. Một phiên khách chạm vào bảng này thấy 0 hàng và ghi
-- không được: fail-closed, và fail-closed ấy nằm trong CHÍNH policy chứ không ở một lớp thứ hai.
--
-- TÊN `_khach` là bắt buộc, không phải khẩu vị: `tests/adversarial/a5-co-lap-nha-cung-cap.int.test.ts`
-- quét MỌI bảng có RLS và đòi một policy tên `<bảng>_khach` — vế chống-mù của khoản nợ 29. Bảng này
-- là bảng ĐẦU TIÊN mà policy ấy PERMISSIVE chứ không RESTRICTIVE, đúng vì nó là policy DUY NHẤT:
-- một bảng chỉ có policy restrictive là một bảng không đọc được.
CREATE POLICY caller_rate_limits_khach ON caller_rate_limits
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON caller_rate_limits TO app_api;
GRANT INSERT (bucket_hash, window_start, hits) ON caller_rate_limits TO app_api;
GRANT UPDATE (hits) ON caller_rate_limits TO app_api;
-- DELETE ở MỨC BẢNG cho bộ dọn. Cùng đánh đổi đã ghi cho `otp_rate_limits` ở 010: một `api` bị chiếm
-- xoá sạch bảng này là đặt lại mọi hạn mức theo người gọi. Khác 010 ở chỗ bảng này KHÔNG chứa dấu
-- vết của đích nhận nào — mất nó là mất một trần, không mất một bằng chứng.
GRANT DELETE ON caller_rate_limits TO app_api;

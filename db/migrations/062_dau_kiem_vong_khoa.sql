-- =============================================================================================
-- 062 — [khoản 165] DẤU KIỂM CỦA VÒNG KHOÁ BỌC: HAI TIẾN TRÌNH ĐỐI CHIẾU MÀ KHÔNG GIỮ CHUNG GÌ
-- =============================================================================================
-- `apps/api` bọc khoá riêng của RFQ bằng `TRUSTPROCURE_MASTER_KEYS`; `apps/unseal-worker` mở bọc
-- bằng CÙNG biến ấy, dán riêng vào môi trường của nó. ADR-006 cấm worker giữ thêm bí mật nào khác,
-- nên worker không có gì để so: một pepper hay một khoá TOTP dán nhầm vào đây đi qua mọi phép kiểm
-- hình dạng (32 byte, base64 hợp lệ) và chỉ hỏng lúc mở phong bì THẬT — tức giữa một lượt mở thầu.
--
-- HƯỚNG BỊ BÁC TRƯỚC KHI VIẾT: *"worker thử mở bọc một khoá RFQ có sẵn lúc khởi động"*. Bản bọc
-- (`packages/crypto-keys/src/local-dev-shared.ts`) không mang dấu nào của master key, nên biết khoá
-- đúng hay sai đồng nghĩa GIẢI MÃ THẬT một khoá riêng RFQ — ngoài `assertUnsealAllowed`, không yêu
-- cầu mở thầu, không hai chữ ký. Đó là đúng thứ D1 tồn tại để cấm.
--
-- HÌNH DẠNG CHỌN (chủ dự án chốt 2026-09-23): mỗi phiên bản khoá có một DẤU KIỂM
--   kcv = HMAC-SHA256(master key của phiên bản ấy, "trustprocure/dau-kiem-vong-khoa/v1")
-- Bên nào khởi động TRƯỚC (api hay worker) ghi dấu của mọi phiên bản nó giữ; bên SAU đọc và so, và
-- từ chối lên nếu lệch. Không phụ thuộc thứ tự khởi động; không bên nào giữ bí mật của bên kia.
--
-- VÌ SAO DẤU KIỂM KHÔNG PHẢI MỘT BÍ MẬT: HMAC là một hàm giả ngẫu nhiên theo khoá. Biết `kcv` không
-- cho biết gì về khoá 256 bit, và đoán khoá bằng cách thử `kcv` là vét cạn 2^256. Nên cả hai vai
-- ứng dụng đọc được bảng này mà không mở thêm bề mặt nào.
--
-- CHỈ-GHI-THÊM, và đó là cả mệnh đề: không vai ứng dụng nào có UPDATE hay DELETE. Đổi khoá của một
-- phiên bản đã ghi là đúng lỗi bảng này sinh ra để bắt — xoay khoá thì thêm PHIÊN BẢN mới. Cụm dev
-- dựng lại với khoá khác dưới cùng tên phiên bản thì dọn bảng bằng vai chủ (superuser), có chủ đích.
--
-- Bảng NGOÀI cây tenant (không `org_id`) — cùng lớp với `caller_rate_limits` (042), và cùng hình
-- dạng RLS: bật + FORCE, đúng MỘT policy PERMISSIVE *"mọi hàng, trừ phiên khách"* mang tên
-- `<bảng>_khach` (khoản 29). Khai ở `BANG_RLS_NGOAI_TENANT_KHAI` và `POLICY_KHAC_KHAI` của
-- hardening, và hardening dựng lại RLS mỗi lần deploy.
-- =============================================================================================

CREATE TABLE master_key_check_values (
  key_version  text NOT NULL PRIMARY KEY
               CHECK (pg_catalog.length(key_version) BETWEEN 1 AND 64),
  kcv          bytea NOT NULL CHECK (pg_catalog.octet_length(kcv) = 32),
  recorded_at  timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE master_key_check_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_key_check_values FORCE ROW LEVEL SECURITY;

-- Cùng lập luận với `caller_rate_limits_khach` (042): khách không có việc gì ở đây, và policy
-- duy nhất của bảng phát biểu đúng vế ấy thay vì `USING (true)`.
CREATE POLICY master_key_check_values_khach ON master_key_check_values
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- Theo CỘT cho INSERT: `recorded_at` do CSDL đặt, không do người gọi khai.
GRANT SELECT ON master_key_check_values TO app_api, app_unseal;
GRANT INSERT (key_version, kcv) ON master_key_check_values TO app_api, app_unseal;

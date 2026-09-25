-- =============================================================================================
-- 063 — [ADR-062] CẶP KHOÁ CỦA TỔ CHỨC: khoá công khai ai cũng bọc được, khoá riêng chỉ worker mở
-- =============================================================================================
-- Khoá riêng của mỗi RFQ (`rfq_key_material.wrapped_private_key`) nay được bọc bằng KHOÁ CÔNG KHAI
-- của tổ chức — hàm thuần `wrapForOrg`, không bí mật nào. Khoá riêng của tổ chức nằm ở đây dưới
-- dạng ĐÃ BỌC: bởi vòng master key (local-dev) hay bởi CMK `tp-org-wrap` (aws-kms, sinh bằng
-- `GenerateDataKeyPairWithoutPlaintext`). `rfq_key_material.key_version` từ nay là `key_version`
-- của một hàng ở bảng này.
--
-- BẤT ĐỐI XỨNG QUYỀN, cùng khuôn 017 và cùng lý do: `app_api` GHI được `wrapped_private_key` (nó
-- sinh cặp khoá ở lần mở RFQ đầu tiên của tổ chức) nhưng KHÔNG ĐỌC được nó. Một `SELECT
-- wrapped_private_key` viết bởi người quên ADR-062 KHÔNG CHẠY dưới `app_api` — CSDL từ chối. Chỉ
-- `app_unseal` đọc được cột ấy, và chỉ để mở khoá riêng tổ chức một lần mỗi lượt mở thầu.
--
-- CHỈ-GHI-THÊM BẰNG QUYỀN, cùng khuôn 062: không vai ứng dụng nào có UPDATE hay DELETE. Xoay cặp
-- khoá tổ chức là THÊM một phiên bản; RFQ cũ giữ phiên bản cũ. Không có trigger canh: không có cột
-- nào được phép đổi, nên không có vùng nào cần một hàm phân biệt "sửa hợp lệ" với "sửa cấm".
--
-- CẶP KHOÁ SINH Ở LẦN MỞ RFQ ĐẦU TIÊN của tổ chức (chủ dự án chốt 2026-09-25), không lúc tạo tổ
-- chức: không cần backfill, và migration không gọi được KMS. Hai lần mở đua nhau cùng sinh: khoá
-- chính (org_id, key_version) làm lần thứ hai chờ lần thứ nhất COMMIT rồi `ON CONFLICT DO NOTHING`,
-- và bên thua đọc lại hàng của bên thắng.
-- =============================================================================================

CREATE TABLE org_key_pairs (
  org_id               uuid NOT NULL REFERENCES organizations(id),
  key_version          text NOT NULL CHECK (octet_length(key_version) BETWEEN 1 AND 64),
  -- SPKI DER của một khoá P-256: đúng 91 byte (đo trên Node 22/24). ADR-062 ghim P-256; một đường
  -- cong khác là một ADR khác, không phải một hàng.
  public_key           bytea NOT NULL CHECK (octet_length(public_key) = 91),
  wrapped_private_key  bytea NOT NULL CHECK (octet_length(wrapped_private_key) BETWEEN 1 AND 8192),
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key_version)
);

ALTER TABLE org_key_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_key_pairs FORCE ROW LEVEL SECURITY;

CREATE POLICY org_key_pairs_tenant_isolation ON org_key_pairs
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: một phiên nhà cung cấp không có
-- lý do nào đọc cặp khoá của tổ chức mua — khoá công khai RFQ nó cần đã có ở `rfq_key_material`.
CREATE POLICY org_key_pairs_khach ON org_key_pairs AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- SELECT của `app_api`: mọi cột TRỪ `wrapped_private_key`, liệt kê từng cột (khuôn 017).
GRANT SELECT (org_id, key_version, public_key, created_at) ON org_key_pairs TO app_api;
GRANT INSERT (org_id, key_version, public_key, wrapped_private_key) ON org_key_pairs TO app_api;
GRANT SELECT (org_id, key_version, wrapped_private_key) ON org_key_pairs TO app_unseal;

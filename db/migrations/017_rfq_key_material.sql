-- db/migrations/017_rfq_key_material.sql
-- S1.4 — PHONG BÌ NIÊM PHONG, PHẦN CSDL. Đây là chỗ ADR-019 và ADR-011 biến thành câu lệnh.
--
-- ============================================================================================
-- [S7b-T3] TÍNH NGUYÊN TỬ: bảng mang trọn CREATE TABLE + ENABLE + FORCE + POLICY + GRANT trong
-- CÙNG file này. Cưỡng chế bằng máy ở db/migration-shape.test.ts.
--
-- ============================================================================================
-- CÂU CHỊU LỰC NHẤT CỦA FILE NÀY LÀ MỘT DÒNG GRANT CÓ HÌNH DẠNG LẠ
-- ============================================================================================
-- `app_api` được INSERT cột `wrapped_private_key` nhưng KHÔNG được SELECT cột ấy.
--
-- Đó không phải một sơ suất. Vai trò của `api` trong ADR-019 là ĐẶT khoá riêng đã bọc vào chỗ
-- của nó rồi quên nó đi; vai trò ĐỌC thuộc về `app_unseal`. Viết-được-mà-không-đọc-được là hình
-- dạng duy nhất diễn đạt đúng hai vai trò ấy, và nó được cưỡng chế bởi Postgres chứ không bởi
-- việc ai đó nhớ ADR-006.
--
-- Hệ quả cụ thể, đo được: câu SELECT lấy `wrapped_private_key` chạy bằng `app_api` KHÔNG chạy —
-- kể cả khi người viết câu ấy có thiện chí, kể cả khi RLS cho phép hàng đó.
--
-- ============================================================================================
-- VÌ SAO UNIQUE (org_id, rfq_id, algorithm) CHỨ KHÔNG PHẢI UNIQUE (org_id, rfq_id)
-- ============================================================================================
-- Sổ đăng ký viết G2 là "Mỗi RFQ một cặp khóa; lộ một RFQ không lan sang RFQ khác". ADR-011 chốt
-- P-256 mặc định và X25519 cơ hội, mà ECDH đòi hai bên CÙNG đường cong — nên một RFQ mang một
-- cặp khoá CHO MỖI thuật toán, và nhà cung cấp chọn cặp nào lúc chạy.
--
-- Vế "một cặp khoá" của sổ đăng ký vì vậy KHÔNG còn đúng theo chữ. Vế chịu lực là vế thứ hai, và
-- nó nguyên vẹn: mỗi cặp khoá là ngẫu nhiên độc lập. ADR-019 ghi mâu thuẫn này ra thành chữ thay
-- vì diễn giải lại nó trong im lặng — và dòng UNIQUE dưới đây là chỗ mâu thuẫn ấy đọng lại thành
-- lược đồ.

-- ============================================================================================
-- (1) BẢNG
-- ============================================================================================
CREATE TABLE rfq_key_material (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  rfq_id                uuid NOT NULL,
  -- Mã thuật toán THOẢ THUẬN KHOÁ, tường minh — phần "đã ghim" của ADR-011, phần làm cho việc
  -- thêm một thuật toán về sau là một HÀNG, không phải một cuộc di trú.
  algorithm             text NOT NULL CHECK (algorithm IN ('ECDH_P256', 'X25519')),
  -- Khoá công khai, dạng SPKI DER. P-256 cho 91 byte, X25519 cho 44 byte (đã đo trên Node 22 và
  -- Node 24). Khoảng cho phép rộng hơn hai con số đó để không phải sửa CHECK khi thêm đường cong.
  public_key            bytea NOT NULL CHECK (octet_length(public_key) BETWEEN 32 AND 512),
  -- Khoá riêng ĐÃ BỌC bằng khoá dẫn xuất theo tổ chức. Dạng rõ của nó KHÔNG BAO GIỜ tới đây;
  -- xem ADR-019 mục 1 để biết nó sống ở đâu và chết lúc nào.
  wrapped_private_key   bytea NOT NULL CHECK (octet_length(wrapped_private_key) BETWEEN 1 AND 8192),
  -- Phiên bản master key đã bọc. Đây là thứ giữ cho G3 đúng: xoay khoá gốc không làm mất khả
  -- năng mở phong bì cũ.
  key_version           text NOT NULL CHECK (octet_length(key_version) > 0
                                             AND octet_length(key_version) <= 64),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- [ADR-016] Danh tính là DẪN XUẤT. Hai cột này đi qua `kiem_danh_tinh_theo_phien` (013).
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  revoked_at            timestamptz,
  revoked_reason        text CHECK (revoked_reason IS NULL
                                    OR (octet_length(revoked_reason) > 0
                                        AND octet_length(revoked_reason) <= 2000)),
  revoked_by            uuid,
  revoked_by_session_id uuid,
  -- Khoá ngoại HỢP THÀNH, khuôn 006 §(1): cặp (org_id, rfq_id) chặn ca "khoá của RFQ thuộc tổ
  -- chức khác" mà RLS WITH CHECK không nhìn thấy.
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  FOREIGN KEY (org_id, revoked_by) REFERENCES users (org_id, id),
  UNIQUE (org_id, rfq_id, algorithm),
  -- Thu hồi là một sự kiện TRỌN VẸN hoặc KHÔNG XẢY RA: bốn cột cùng có hoặc cùng vắng.
  CONSTRAINT rfq_key_material_thu_hoi_tron_ven
    CHECK (num_nonnulls(revoked_at, revoked_reason, revoked_by, revoked_by_session_id) IN (0, 4))
);

ALTER TABLE rfq_key_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_key_material FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_key_material_tenant_isolation ON rfq_key_material
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- SELECT của `app_api`: MỌI cột TRỪ `wrapped_private_key`. Liệt kê từng cột thay vì
-- GRANT SELECT trên cả bảng là load-bearing — xem khối đầu file.
GRANT SELECT (id, org_id, rfq_id, algorithm, public_key, key_version, created_at,
              created_by, created_by_session_id, revoked_at, revoked_reason,
              revoked_by, revoked_by_session_id)
  ON rfq_key_material TO app_api;
-- INSERT: có `wrapped_private_key`. `id`, `created_at` vắng mặt (dùng DEFAULT) — cùng khuôn 009,
-- và nó cũng là thứ giữ cho chỉ mục PRIMARY KEY không thành oracle xuyên tổ chức (H14/ADR-013:
-- một UNIQUE chỉ là oracle khi `app_api` ghi được MỌI cột của nó).
GRANT INSERT (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version,
              created_by, created_by_session_id)
  ON rfq_key_material TO app_api;
-- UPDATE: ĐÚNG bốn cột thu hồi. `wrapped_private_key` vắng mặt ở đây cũng load-bearing như nó
-- vắng mặt ở SELECT: một khoá đã đặt xuống thì không đổi được, kể cả bởi người đã đặt nó.
GRANT UPDATE (revoked_at, revoked_reason, revoked_by, revoked_by_session_id)
  ON rfq_key_material TO app_api;
-- `app_unseal`: đây là vai trò DUY NHẤT đọc được khoá riêng đã bọc. Không INSERT, không UPDATE,
-- không DELETE — nó ĐỌC để mở thầu, nó không sửa gì cả.
GRANT SELECT (id, org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version,
              created_at, revoked_at)
  ON rfq_key_material TO app_unseal;

-- ============================================================================================
-- (2) C5 LÀ MỘT BỘ BA TRIGGER, KHÔNG PHẢI MỘT CÂU LỆNH ỨNG DỤNG
-- ============================================================================================
-- Mệnh đề C5: "Cặp khóa RFQ chỉ sinh đúng lúc chuyển sang OPEN". Chữ "đúng lúc" có BA vế, và
-- không vế nào suy ra được hai vế kia:
--
--   (a) KHÔNG SỚM HƠN — không sinh khoá cho một RFQ còn DRAFT, hay cho một RFQ đã OPEN từ lâu.
--       Trigger BEFORE INSERT: RFQ phải đang ở PENDING_APPROVAL.
--   (b) KHÔNG BAO GIỜ LÀ "KHÔNG BAO GIỜ" — sinh khoá rồi KHÔNG mở RFQ để lại một cặp khoá mồ
--       côi, và (a) một mình cho phép đúng điều đó. CONSTRAINT TRIGGER DEFERRABLE INITIALLY
--       DEFERRED: tại COMMIT, RFQ phải đã đi QUA cửa OPEN (không nhất thiết còn ĐỨNG ở đó — xem
--       khối "MỘT TẬP, KHÔNG PHẢI MỘT GIÁ TRỊ" dưới, nơi bản đầu của vế này bị đo là quá chặt).
--   (c) CHIỀU NGƯỢC LẠI — mở RFQ mà KHÔNG có khoá. Trigger trên `rfq_packages`.
--
-- Ba vế cộng lại cho một TƯƠNG ĐƯƠNG: khoá tồn tại khi và chỉ khi RFQ đã đi qua cửa OPEN, và nó
-- ra đời TRONG chính giao dịch ấy.

-- Thuật toán MẶC ĐỊNH của ADR-011. Một hằng, một chỗ, đọc ở hai chỗ.
CREATE OR REPLACE FUNCTION public.rfq_thuat_toan_mac_dinh() RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = pg_catalog, public
AS $ham$ SELECT 'ECDH_P256'::text $ham$;

-- (a) KHÔNG SỚM HƠN.
CREATE OR REPLACE FUNCTION public.rfq_khoa_chi_sinh_luc_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF trang_thai IS DISTINCT FROM 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Cap khoa RFQ chi sinh duoc luc chuyen sang OPEN; RFQ dang o % (C5)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_key_material_chi_sinh_luc_mo
  BEFORE INSERT ON rfq_key_material
  FOR EACH ROW EXECUTE FUNCTION public.rfq_khoa_chi_sinh_luc_mo();

-- [ADR-016] Danh tính người sinh khoá là DẪN XUẤT của phiên, không phải lời khai.
CREATE TRIGGER rfq_key_material_kiem_danh_tinh
  BEFORE INSERT ON rfq_key_material
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');

-- (b) KHÔNG MỒ CÔI. Hoãn tới COMMIT là điều kiện để phép kiểm này có nghĩa: lúc INSERT chạy, RFQ
--     theo định nghĩa vẫn còn PENDING_APPROVAL (vế (a) vừa đòi thế), nên hỏi ngay thì luôn sai.
--     Chỉ ở COMMIT mới trả lời được câu "giao dịch này CÓ mở RFQ hay không".
CREATE OR REPLACE FUNCTION public.rfq_khoa_phai_di_kem_lan_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- MỘT TẬP, KHÔNG PHẢI MỘT GIÁ TRỊ — và bản đầu viết `IS DISTINCT FROM 'OPEN'` là SAI.
  -- Phát hiện bằng phép đo, không bằng suy luận: `packages/rfq/src/rfq.int.test.ts` có nhiều
  -- giao dịch mở RFQ RỒI ĐÓNG NGAY trong cùng một `withTenant`, nên tại COMMIT trạng thái là
  -- `CLOSED` chứ không phải `OPEN`, và sáu test đỏ vì một lý do KHÔNG liên quan gì tới C5.
  -- Điều cần đòi là RFQ đã đi QUA cửa OPEN, không phải nó đang ĐỨNG ở đó. Bốn trạng thái dưới
  -- đây là toàn bộ tập tới được từ `PENDING_APPROVAL` mà đường đi bắt buộc qua `OPEN` — hai
  -- trạng thái còn lại (`PENDING_APPROVAL`, `CANCELLED`) đều nghĩa là cặp khoá này mồ côi.
  IF trang_thai NOT IN ('OPEN', 'CLOSED', 'UNSEALED', 'EVALUATING') THEN
    RAISE EXCEPTION
      'Sinh khoa cho RFQ % ma khong mo no trong cung giao dich (dang o %) (C5)',
      NEW.rfq_id, trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$ham$;

CREATE CONSTRAINT TRIGGER rfq_key_material_phai_di_kem_lan_mo
  AFTER INSERT ON rfq_key_material
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.rfq_khoa_phai_di_kem_lan_mo();

-- (c) CHIỀU NGƯỢC LẠI: không mở được RFQ nếu thiếu khoá của thuật toán mặc định.
--     Tên trigger đứng SAU `rfq_packages_kiem_chuyen_trang_thai` theo thứ tự chữ cái, nên phép
--     kiểm cạnh của 009 chạy trước — một lần thử CLOSED sang OPEN báo đúng lỗi cạnh của nó, chứ
--     không báo lỗi thiếu khoá.
CREATE OR REPLACE FUNCTION public.rfq_kiem_khoa_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  so_khoa integer;
BEGIN
  SELECT count(*) INTO so_khoa
    FROM public.rfq_key_material k
   WHERE k.rfq_id OPERATOR(pg_catalog.=) NEW.id
     AND k.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND k.algorithm OPERATOR(pg_catalog.=) public.rfq_thuat_toan_mac_dinh()
     AND k.revoked_at IS NULL;
  IF so_khoa OPERATOR(pg_catalog.=) 0 THEN
    RAISE EXCEPTION
      'Khong mo duoc RFQ khi chua co cap khoa % (C5)', public.rfq_thuat_toan_mac_dinh()
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_khoa_khi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (NEW.status OPERATOR(pg_catalog.=) 'OPEN' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.rfq_kiem_khoa_khi_mo();

-- ============================================================================================
-- (3) KHOÁ ĐÃ ĐẶT XUỐNG THÌ KHÔNG ĐỔI, KHÔNG XOÁ
-- ============================================================================================
-- Quyền theo cột ở trên đã chặn `app_api` và `app_unseal`. Trigger dưới đây chặn thêm một hạng
-- người mà quyền không chặn được: SUPERUSER. Cùng lập luận đã dựng trigger cho `audit_events` ở
-- 003 — superuser vượt được RLS và GRANT, nhưng KHÔNG vượt được trigger.
CREATE OR REPLACE FUNCTION public.rfq_key_material_bat_bien() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF TG_OP OPERATOR(pg_catalog.=) 'DELETE' THEN
    RAISE EXCEPTION 'Khong duoc xoa vat lieu khoa cua RFQ (G2/G4)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
     OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
     OR NEW.public_key IS DISTINCT FROM OLD.public_key
     OR NEW.wrapped_private_key IS DISTINCT FROM OLD.wrapped_private_key
     OR NEW.key_version IS DISTINCT FROM OLD.key_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_by_session_id IS DISTINCT FROM OLD.created_by_session_id THEN
    RAISE EXCEPTION 'Chi sua duoc bon cot thu hoi cua rfq_key_material'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Thu hồi là MỘT CHIỀU. Gỡ thu hồi là làm sống lại một khoá đã được tuyên là chết.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'Khong go duoc thu hoi cua vat lieu khoa'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_key_material_bat_bien
  BEFORE UPDATE OR DELETE ON rfq_key_material
  FOR EACH ROW EXECUTE FUNCTION public.rfq_key_material_bat_bien();

-- [ADR-016] Danh tính người thu hồi cũng là dẫn xuất.
CREATE TRIGGER rfq_key_material_kiem_nguoi_thu_hoi
  BEFORE UPDATE ON rfq_key_material
  FOR EACH ROW
  WHEN (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL)
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('revoked_by', 'revoked_by_session_id');

-- ============================================================================================
-- (4) THU HỒI CHỈ XẢY RA KHI RFQ ĐÃ HUỶ — VÀ GIỚI HẠN NÀY ĐƯỢC GHI RA, KHÔNG ĐỂ NGƯỜI SAU ĐOÁN
-- ============================================================================================
-- "Huỷ khoá" trong mệnh đề G4 ở S1 có ĐÚNG MỘT nguyên nhân nghiệp vụ: RFQ bị huỷ. Thu hồi khoá
-- vì một sự cố an ninh TRONG KHI RFQ đang mở KHÔNG phải một đường đi được hỗ trợ ở S1 — đường
-- đúng cho tình huống ấy là huỷ RFQ. Ghi ra ở đây vì một giới hạn không nói ra sẽ được người sau
-- đọc thành một thiếu sót.
--
-- CÂU HỎI CÒN MỞ, có tên: thu hồi ở đây là MỘT DẤU, không phải một lần XOÁ MẬT MÃ.
-- `wrapped_private_key` vẫn nằm nguyên trong hàng. Xoá nó đi sẽ biến "không ai được mở báo giá
-- của RFQ đã huỷ" từ một quy tắc CHÍNH SÁCH thành một sự thật MẬT MÃ — mạnh hơn hẳn — nhưng nó
-- cũng là một hành động không đảo ngược được đứng sau một nút bấm có thể bấm nhầm. Quyết định ấy
-- thuộc về S1.6, nơi có cổng chính sách để đặt nó vào.
CREATE OR REPLACE FUNCTION public.rfq_khoa_chi_thu_hoi_khi_huy() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF trang_thai IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION 'Chi thu hoi duoc vat lieu khoa khi RFQ da huy; RFQ dang o %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_key_material_chi_thu_hoi_khi_huy
  BEFORE UPDATE ON rfq_key_material
  FOR EACH ROW
  WHEN (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL)
  EXECUTE FUNCTION public.rfq_khoa_chi_thu_hoi_khi_huy();

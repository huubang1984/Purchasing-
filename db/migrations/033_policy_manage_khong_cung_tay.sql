-- =============================================================================================
-- 033 — [sổ nợ 44 / review lượt 2 H2-2] NGƯỜI ĐẶT NGƯỠNG KHÔNG ĐƯỢC LÀ NGƯỜI ĐẶT ƯỚC LƯỢNG HAY NGƯỜI DUYỆT
-- =============================================================================================
-- 030 gán `policy.manage` cho `PROCUREMENT_MANAGER` và biện minh *"người khai ước lượng không được
-- là người đặt ngưỡng"*. Lượt review thứ hai của S1.10 đọc ra: chính vai được cấp giữ `rfq.create`
-- (đặt ước lượng qua `PUT /rfqs/:id/budget`) VÀ `rfq.approve`. Một PM nâng ngưỡng lên rất cao, mọi
-- ước lượng rơi xuống dưới ngưỡng, `requires_dual_approval = false`, và chính PM ấy là người duyệt
-- duy nhất. D2 hạ từ "hai người khác nhau" xuống "một người + một người tạo" — không cần khai
-- thấp, chỉ cần đổi THƯỚC. Chốt 2026-09-06 (STATE nợ 44): đóng bằng CSDL, hai lớp.
--
-- QUY TẮC, phát biểu bằng mã quyền: `policy.manage` KHÔNG được đứng cùng `rfq.create` hoặc
-- `rfq.approve` — ở MỘT VAI TRÒ (bảng `role_permissions`) và ở MỘT NGƯỜI (hợp các vai của người
-- ấy trong `user_roles`). Hai lớp là bắt buộc, cùng lý do 005 §(3)/§(4) đã đo cho D3: có HAI người
-- ghi tạo ra được vi phạm — người sửa định nghĩa vai và người gán vai — và mỗi trigger chỉ thấy một.
--
-- AI GIỮ `policy.manage` TỪ ĐÂY: `FINANCE`. Vai ấy không có `rfq.create`, không có `rfq.approve`,
-- không có `rfq.unseal` — nó đặt thước, không cầm thứ bị đo. `DIRECTOR` vẫn cố ý không được, cùng
-- lý do 023 (vai phê duyệt mở thầu đứng ngoài việc định hình chính sách). Hệ quả ở mức người: một
-- người mang cả `BUYER` lẫn `FINANCE` (tổ hợp mà [A3b] ở rbac.int.test.ts từng đo là "đi lọt") nay
-- bị chặn — khe hở [A3b] HẸP LẠI chứ chưa đóng: `TECHNICAL` + `FINANCE` vẫn tự gán được.
--
-- KHÔNG sửa thân `kiem_tra_ma_tran_quyen()` / `kiem_tra_phan_tach_nhiem_vu()` của 005: hai thân ấy
-- được hardening.always.sql ghim nguyên văn và ghi đè ở mọi lần migrate (§R3, sáu bản của D3).
-- Đây là một bất biến KHÁC (D2, không phải D3) nên nó có hàm riêng, và danh sách mã loại trừ có
-- bản TypeScript `POLICY_MANAGE_EXCLUDES` (permissions.ts) được meta-test `ma-tran-quyen.test.ts`
-- khoá khớp NGUYÊN VĂN với hai thân dưới đây — cùng khuôn §R3.
--
-- Trigger tạo TRƯỚC hai câu ghi cuối file, có chủ ý: chính câu seed của file này đi qua phép kiểm.
-- AFTER ROW + ENABLE ALWAYS + không SECURITY DEFINER + `SET search_path = pg_catalog` + tên bảng
-- viết đủ `public.` — cùng bốn lý do 005 §(4) đã ghi. Hàm mức người đọc `public.user_roles` dưới
-- RLS của phiên ghi: phiên ấy đang gắn đúng tổ chức của hàng mới (WITH CHECK ép), nên thấy đủ.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.kiem_tra_nguong_khong_cung_tay_vai_tro() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $tnv$
DECLARE
  co_nguong boolean;
  co_thuoc_do bigint;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_code = NEW.role_code
                    AND rp.permission_code = 'policy.manage')
    INTO co_nguong;
  IF NOT co_nguong THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO co_thuoc_do
    FROM unnest(ARRAY['rfq.create', 'rfq.approve']) AS loai_tru(ma)
   WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_code = NEW.role_code
                    AND rp.permission_code = loai_tru.ma);

  IF co_thuoc_do > 0 THEN
    RAISE EXCEPTION 'Nguoi dat nguong khong duoc la nguoi dat uoc luong hay nguoi duyet (D2, 033): vai tro % giu policy.manage cung rfq.create/rfq.approve', NEW.role_code
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END
$tnv$;

CREATE TRIGGER role_permissions_nguong_khong_cung_tay
  AFTER INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_nguong_khong_cung_tay_vai_tro();
ALTER TABLE role_permissions ENABLE ALWAYS TRIGGER role_permissions_nguong_khong_cung_tay;

CREATE OR REPLACE FUNCTION public.kiem_tra_nguong_khong_cung_tay_nguoi_dung() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $tnn$
DECLARE
  co_nguong boolean;
  co_thuoc_do bigint;
BEGIN
  SELECT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id
                    AND ur.user_id = NEW.user_id
                    AND rp.permission_code = 'policy.manage')
    INTO co_nguong;
  IF NOT co_nguong THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO co_thuoc_do
    FROM unnest(ARRAY['rfq.create', 'rfq.approve']) AS loai_tru(ma)
   WHERE EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id
                    AND ur.user_id = NEW.user_id
                    AND rp.permission_code = loai_tru.ma);

  IF co_thuoc_do > 0 THEN
    RAISE EXCEPTION 'Nguoi dat nguong khong duoc la nguoi dat uoc luong hay nguoi duyet (D2, 033): nguoi dung % se giu policy.manage cung rfq.create/rfq.approve', NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END
$tnn$;

CREATE TRIGGER user_roles_nguong_khong_cung_tay
  AFTER INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION public.kiem_tra_nguong_khong_cung_tay_nguoi_dung();
ALTER TABLE user_roles ENABLE ALWAYS TRIGGER user_roles_nguong_khong_cung_tay;

-- Chuyển `policy.manage` khỏi PROCUREMENT_MANAGER. Hàng của 030 là hàng DUY NHẤT bị xoá trong
-- toàn bộ lịch sử migration tới nay — meta-test `ma-tran-quyen.test.ts` đọc cả câu DELETE này
-- để ma trận tĩnh khớp ma trận thật (nếu không, nó vẫn thấy PM giữ policy.manage và đỏ ở đúng
-- quy tắc file này đặt ra).
DELETE FROM role_permissions
 WHERE role_code = 'PROCUREMENT_MANAGER' AND permission_code = 'policy.manage';

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('FINANCE', 'policy.manage');

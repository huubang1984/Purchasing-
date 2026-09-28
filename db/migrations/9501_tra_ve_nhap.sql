-- ==============================================================================================
-- 9501_tra_ve_nhap — [S1.9101 / S3.2b1 của spec S3] CẠNH `PENDING_APPROVAL→DRAFT` CHỈ MỞ Ở TỔ CHỨC ĐÃ BẬT (K4a), VÀ
-- TOKEN ĐÚC KHI GÓI CHƯA MỞ KHÔNG DÙNG ĐƯỢC SAU KHI TỔ CHỨC BẬT S3 (K6, khoản 253)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §3.3 (hàng PENDING_APPROVAL), §9 (phần
-- S3.2). ADR-084 ⑵ (ai đi cạnh về DRAFT). Chủ dự án chốt ngày 2026-09-27: cạnh ấy chỉ mở cho tổ chức đã bật (S3.2b); ngày
-- 2026-09-28: S3.2b chia hai PR — S3.2b1 là cạnh về DRAFT cộng khoản 253 —, và lần trả về phải có lý do.
--
-- (1) CẠNH `PENDING_APPROVAL→DRAFT`. Nó có trong `CANH_HOP_LE` từ `011` (C-1) và chưa đường ứng dụng nào đi nó (khoản 242).
--     Từ đây nó là đường DUY NHẤT để đổi danh sách mời hay nội dung sau khi nộp duyệt (K4a), và chỉ ở tổ chức đã bật: tổ
--     chức chưa bật chạy nguyên MVP1, mà MVP1 không có đường về DRAFT (ràng buộc chữ ký của `076` (3) dựa đúng vào điều
--     ấy). Trigger RIÊNG ở đúng cạnh — khuôn `014` §(4), §2.5 ⒃. Không xoá chữ ký nào: chữ ký cũ ở lại làm dấu vết và mất
--     hiệu lực bằng băm (`011` C-1; K4b) — gói quay lại PENDING_APPROVAL với nội dung và danh sách y nguyên thì chữ ký cũ
--     vẫn đếm, vì người ký đã ký đúng thứ ấy.
--
--     AI đi cạnh và LÝ DO do tầng gói giữ (`returnRfqToDraft`), không do cột ký tên: cạnh này đi được nhiều lần, và một cột
--     chỉ giữ được lần CUỐI — cùng lý do `016` §(3) để việc gia hạn không có cột. Sổ kiểm toán giữ mọi lần, kèm lý do.
--
-- (2) KHOẢN 253 — K6 ĐỌC Ở PHÍA DÙNG. K6 (`076` (7)) chặn lần ĐÚC token cho gói chưa mở; token đúc thời MVP1 cho gói đang
--     DRAFT hay PENDING_APPROVAL thì sống qua lần bật S3. Cột `duc_khi_goi_da_mo` ghi lại, LÚC ĐÚC, đúng điều kiện K6 hỏi —
--     gói đã mở chưa —, cho MỌI tổ chức, do trigger RIÊNG đặt (cột ngoài `GRANT`). Lần đổi magic link của tổ chức đã bật
--     đòi cột ấy (`docToken`, `packages/invitation`).
--
--     VÌ SAO MỘT CỘT, KHÔNG SO `created_at` VỚI `opened_at`: `created_at` là giờ BẮT ĐẦU giao dịch đúc. Một giao dịch mời
--     bắt đầu trước lần mở gói, chờ khoá `FOR SHARE` của K4a, rồi đúc sau khi lần mở commit, mang `created_at` SỚM hơn
--     `opened_at` — phép so thời gian sẽ giết một link hợp lệ. Cột ghi điều trigger THẤY lúc đúc, nên nó không đua.
--
--     Hàng cũ điền theo phép so thời gian: `opened_at` chỉ đặt một lần (`011` (f)), nên token đúc lúc gói đã mở có
--     `created_at >= opened_at`, trừ đúng ca đua vừa kể — ca ấy chỉ có ở tổ chức đã bật, mà hôm nay không tổ chức thật nào
--     bật được S3 (ADR-105).
--
-- THỨ MIGRATION NÀY KHÔNG LÀM (S3.2b2): mời ở DRAFT không đúc token, đúc lúc mở gói, gửi sau commit, `SENT` sau lần gửi
-- được. Phiên khách mở TRƯỚC lần bật bằng token thời MVP1 sống tới hết hạn của nó (tối đa 4 giờ) — cột này canh lần đổi
-- link, không canh phiên đã mở.
-- ==============================================================================================

-- ============================================================================================
-- (1) CẠNH VỀ DRAFT CHỈ Ở TỔ CHỨC ĐÃ BẬT
-- ============================================================================================
-- `WHEN` đúng cạnh (§2.5 ⒃): `app_unseal` sửa `rfq_packages` ở các cạnh mở thầu, và không có việc gì ở đây.
CREATE OR REPLACE FUNCTION public.rfq_kiem_tra_ve_nhap() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Chi to chuc da bat S3 moi tra goi ve DRAFT duoc (K4a)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_tra_ve_nhap_chi_khi_bat_s3
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'DRAFT')
  EXECUTE FUNCTION public.rfq_kiem_tra_ve_nhap();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_tra_ve_nhap_chi_khi_bat_s3;

-- ============================================================================================
-- (2) KHOẢN 253 — TOKEN GHI LẠI, LÚC ĐÚC, GÓI ĐÃ MỞ CHƯA
-- ============================================================================================
ALTER TABLE rfq_invitation_tokens ADD COLUMN duc_khi_goi_da_mo boolean NOT NULL DEFAULT false;

-- Vai chạy migration có BYPASSRLS (ADR-061), nên câu dưới thấy mọi tổ chức.
UPDATE rfq_invitation_tokens t
   SET duc_khi_goi_da_mo = true
  FROM rfq_invitations i
  JOIN rfq_packages p ON p.org_id = i.org_id AND p.id = i.rfq_id
 WHERE i.org_id = t.org_id AND i.id = t.invitation_id
   AND p.opened_at IS NOT NULL
   AND t.created_at >= p.opened_at;

-- Cho MỌI tổ chức, không chỉ tổ chức đã bật: tổ chức bật S3 SAU lần đúc, và cột phải đúng ngay từ lần đúc. Đặt đè mọi giá
-- trị `app_api` gửi lên — cột cũng không nằm trong `GRANT INSERT` của `010`/`013`.
CREATE OR REPLACE FUNCTION public.rfq_invitation_tokens_ghi_goi_da_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  NEW.duc_khi_goi_da_mo := EXISTS (
    SELECT 1
      FROM public.rfq_invitations i
      JOIN public.rfq_packages p ON p.org_id = i.org_id AND p.id = i.rfq_id
     WHERE i.org_id = NEW.org_id AND i.id = NEW.invitation_id
       AND p.opened_at IS NOT NULL);
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_invitation_tokens_ghi_goi_da_mo
  BEFORE INSERT ON rfq_invitation_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.rfq_invitation_tokens_ghi_goi_da_mo();
ALTER TABLE rfq_invitation_tokens ENABLE ALWAYS TRIGGER rfq_invitation_tokens_ghi_goi_da_mo;

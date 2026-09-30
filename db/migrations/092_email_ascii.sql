-- =============================================================================================
-- 092_email_ascii — [khoản nợ 71 / ADR-132] `users.email` VÀ `supplier_contacts.email` CHỈ NHẬN ASCII IN ĐƯỢC
-- =============================================================================================
-- Khoản nợ 71, nguyên văn (S1.27, mang sang ở S1.61): hai địa chỉ TRÔNG GIỐNG HỆT NHAU vẫn cùng tồn tại được trong một tổ chức —
-- `ασ@corp.com` cạnh `ας@corp.com` (sigma cuối từ), `i̇@corp.com` (U+0069 U+0307) cạnh `i@corp.com` — và TẬP GIÁ TRỊ mà cột chấp nhận
-- phụ thuộc libc của ảnh nền: `Ⓐlice@corp.com` qua trên `postgres:16-alpine` (musl), bị từ chối trên `postgres:16` (glibc); 124 điểm mã
-- phân kỳ giữa `.toLowerCase()` của JS và `lower()` của máy chủ trên musl, 28 trên glibc. Ràng buộc chữ thường của `048`/`049`
-- (`email = lower(email)`) ĐÚNG với mọi hàm `lower()` — nhưng CÁI GÌ CẤT ĐƯỢC thì do hàm ấy quyết, tức do libc.
--
-- QUYẾT ĐỊNH (chủ dự án chốt 2026-09-30, ADR-132): thu hẹp MIỀN GIÁ TRỊ về ASCII IN ĐƯỢC — `^[!-~]+@[!-~]+$`: mỗi ký tự trong
-- 0x21…0x7E, có ít nhất một `@` không ở đầu hay cuối. Trên tập ấy MỌI hàm hạ chữ thường — `lower()` của glibc, musl, ICU, ctype C, và
-- `.toLowerCase()` của JS — cho CÙNG một kết quả và bảo toàn độ dài byte; không còn cặp confusable Unicode; không còn điểm mã mà JS hạ
-- mà máy chủ để nguyên. Địa chỉ quốc tế hoá (EAI/IDN, RFC 6531) bị TỪ CHỐI CÓ TÊN ở tầng ứng dụng (422) và ở đây bằng 23514; điều kiện
-- mở lại — khi một khách hàng cần địa chỉ quốc tế hoá — ghi ở ADR-132.
--
-- VÌ SAO `[!-~]` MÀ KHÔNG CHẶT HƠN (dot-atom của RFC 5321): ⑴ khoản 71 là bài toán MIỀN KÝ TỰ (confusable, libc), không phải bài toán
-- HÌNH DẠNG — hình dạng đã có ràng buộc riêng của `011` trên `supplier_contacts` và `EMAIL_PATTERN` ở tầng ứng dụng; `048` đã ghi "thêm
-- một phép kiểm định dạng vào lược đồ là một quyết định khác hẳn". ⑵ dot-atom loại cả local-part có nháy kép và domain literal `[a.b.c.d]`
-- mà RFC 5321 cho phép — hẹp hơn thứ khoản nợ đòi, và là một quyết định sản phẩm chưa ai chốt. ⑶ `[!-~]` là ĐÚNG tập mà mọi hàm hạ chữ
-- thường đồng ý — không hơn, không kém. Đo (thăm dò S1.229, PostgreSQL 16, `C.UTF-8`): `a@x.vn`, `!#$%&'*+/=?^_`{|}~-@x.vn`, `a~@x.vn`
-- qua; `Ⓐ@x.vn`, `ⓐ@x.vn`, `a b@x.vn`, `a\x01@x.vn`, `@x`, `x@`, `a@x.vn\n` bị từ chối. `a@b@c` qua ở ĐÂY (hình dạng là việc của 011 và
-- của tầng ứng dụng, không của file này).
--
-- ĐỐI CHIẾU TRƯỚC `ALTER`, cùng khuôn 049: lượt kiểm của `ADD CONSTRAINT … CHECK` quét toàn bảng nhưng chỉ nói CÓ vi phạm, không nói Ở ĐÂU
-- (048 đo). Khối DO đếm hàng ngoài miền ở CẢ HAI bảng, nêu tối đa 20 id mỗi bảng, KHÔNG in email (thông báo lỗi migration đi vào log
-- deploy); và KHÔNG tự sửa — đổi một địa chỉ đã lưu là đổi đích magic link: quyết định có người chịu, kèm một sự kiện kiểm toán (049 ghi
-- lý do). Không `NOT VALID` (048: một ràng buộc chưa kiểm là một ràng buộc nói dối về quá khứ). Không cần khối bắt `check_violation` như
-- 049 từng cần: từ ADR-061 (khoản 102) `migrate()` từ chối hồ sơ N3 — vai deploy là chủ bảng FORCE mà RLS áp — TRƯỚC vòng, nên phép đếm
-- dưới đây không chạy dưới một vai bị RLS lọc. Khoá `ACCESS EXCLUSIVE` trên hai bảng trong lúc kiểm (`migrate.ts` đặt `lock_timeout = 0`)
-- — cùng tính chất 048/049.
--
-- TẦNG ỨNG DỤNG đi cùng: `addSupplierContact` kiểm ASCII TRƯỚC khi hạ chữ thường và độ dài 320 byte SAU (vế ⑶ của khoản 71 — `İ`, `Ⱥ`,
-- `Ⱦ` hạ ra 3 byte từ 2, đo bằng Node); `tools/khoi-tao-to-chuc` kiểm ASCII trước khi ghi `users`; `login.ts` giữ hai vế cùng
-- `pg_catalog.lower()`. Hai dòng khai ở `CHECK_AN_NINH_KHAI` của hardening (khoản 105): gỡ hay đổi một trong hai ⇒ `migrate()` kế NÉM.
-- Đo: `db/migrations.int.test.ts` `[khoản nợ 71]` (dữ liệu có sẵn ⇒ NÉM nguyên văn, sửa tay ⇒ đi qua, INSERT thẳng Unicode dưới
-- superuser ⇒ 23514), `packages/supplier/src/suppliers.int.test.ts` và `tools/khoi-tao-to-chuc/src/khoi-tao.int.test.ts` `[S1.229]`.
-- =============================================================================================

DO $doi_chieu_092$
DECLARE
  so_nguoi_dung bigint;
  so_lien_he bigint;
  id_nguoi_dung text;
  id_lien_he text;
BEGIN
  SELECT pg_catalog.count(*) INTO so_nguoi_dung
    FROM public.users u
   WHERE u.email OPERATOR(pg_catalog.!~) '^[!-~]+@[!-~]+$';
  SELECT pg_catalog.count(*) INTO so_lien_he
    FROM public.supplier_contacts c
   WHERE c.email OPERATOR(pg_catalog.!~) '^[!-~]+@[!-~]+$';

  IF so_nguoi_dung OPERATOR(pg_catalog.>) 0 OR so_lien_he OPERATOR(pg_catalog.>) 0 THEN
    SELECT pg_catalog.string_agg(x.id::pg_catalog.text, ', ' ORDER BY x.id) INTO id_nguoi_dung
      FROM (SELECT u.id FROM public.users u
             WHERE u.email OPERATOR(pg_catalog.!~) '^[!-~]+@[!-~]+$'
             ORDER BY u.id LIMIT 20) x;
    SELECT pg_catalog.string_agg(x.id::pg_catalog.text, ', ' ORDER BY x.id) INTO id_lien_he
      FROM (SELECT c.id FROM public.supplier_contacts c
             WHERE c.email OPERATOR(pg_catalog.!~) '^[!-~]+@[!-~]+$'
             ORDER BY c.id LIMIT 20) x;

    RAISE EXCEPTION 'email ngoai ASCII in duoc: users % hang — id (toi da 20): %; supplier_contacts % hang — id (toi da 20): % — sua tay duoi mot vai ma RLS khong ap (doi mot dia chi da luu la doi dich magic link: co nguoi chiu, kem mot su kien kiem toan), roi deploy lai (092_email_ascii, khoan no 71, ADR-132)',
      so_nguoi_dung, COALESCE(id_nguoi_dung, '-'), so_lien_he, COALESCE(id_lien_he, '-')
      USING ERRCODE = 'check_violation';
  END IF;

  ALTER TABLE public.users
    ADD CONSTRAINT users_email_ascii
    CHECK (email OPERATOR(pg_catalog.~) '^[!-~]+@[!-~]+$');

  ALTER TABLE public.supplier_contacts
    ADD CONSTRAINT supplier_contacts_email_ascii
    CHECK (email OPERATOR(pg_catalog.~) '^[!-~]+@[!-~]+$');
END
$doi_chieu_092$;

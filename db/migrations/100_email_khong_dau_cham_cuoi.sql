-- =============================================================================================
-- 100_email_khong_dau_cham_cuoi — [khoản 283 / ADR-139] `users.email` VÀ `supplier_contacts.email` KHÔNG KẾT THÚC BẰNG DẤU CHẤM
-- =============================================================================================
-- Khoản 283 (tách ra từ lượt đo khoản 71 ở S1.229): `dot@x.vn.` CẤT ĐƯỢC cạnh `dot@x.vn` ở CẢ HAI bảng. RFC 5321 coi tên miền có dấu
-- chấm cuối là dạng TUYỆT ĐỐI của cùng một tên, và bộ gửi SES nhận cả hai ⇒ hai hàng cho MỘT hộp thư: hai người dùng, hai magic link
-- (`users`), hai người liên hệ, hai lời mời (`supplier_contacts`). Cùng lớp khoản 70, nhưng KHÔNG phải hoa-thường (048/049) và KHÔNG phải
-- miền ký tự (092). Đo (S1.229, lặp lại ở S1.247): ràng buộc hình dạng của 011 trên `supplier_contacts` khớp vì `[^…@]+\.[^…@]+$` lùi
-- được về `x` `.` `vn.`; ràng buộc ASCII của 092 chỉ kiểm miền ký tự; `UNIQUE (org_id, email)` và `UNIQUE (org_id, supplier_id, email)`
-- so nguyên văn; `users` không có CHECK hình dạng nào.
--
-- QUYẾT ĐỊNH (chủ dự án chốt 2026-09-30, kế hoạch đợt 3 mục 0 câu 12; ADR-139, nối ADR-132): TỪ CHỐI CÓ TÊN, KHÔNG chuẩn hoá. Ở đây
-- `CHECK (email !~ '\.$')` trên hai bảng — lớp chặn mọi đường ghi, kể cả đường viết tay dưới superuser; ở tầng ứng dụng
-- `addSupplierContact` (`SupplierError` ⇒ 422) và `tools/khoi-tao-to-chuc` (`KhoiTaoError` nêu vị trí) từ chối có tên trước khi tới CSDL.
-- Chuẩn hoá (bỏ dấu chấm cuối trước khi ghi) là phương án bị loại: nó đổi ngầm địa chỉ người dùng gõ, và trên dữ liệu có sẵn nó không
-- cơ khí được — ở hàng có dạng anh em không dấu chấm, bỏ dấu chấm là va `UNIQUE` (đo: 23505), tức hai hàng là MỘT hộp thư và phải chọn
-- giữ hàng nào. Mẫu chỉ chạm ĐUÔI chuỗi: dấu chấm trong local-part hay giữa tên miền không đổi gì; hình dạng đầy đủ (dot-atom) vẫn là
-- quyết định riêng mà ADR-132 §3 để ngỏ.
--
-- LITERAL `E'\\.$'` MÀ KHÔNG `'\.$'`: cùng một chuỗi `\.$` khi `standard_conforming_strings = on` — định nghĩa lưu và deparse là
-- `CHECK ((email !~ '\.$'::text))`, đúng hình dạng đã chốt — nhưng dạng `E''` không đổi nghĩa khi một `standard_conforming_strings = off`
-- đặt sẵn ở mức database/vai rơi vào phiên migrate (migration đánh số không được hardening ghim lớp lex). Đo (thăm dò S1.247, PostgreSQL
-- 16, phiên `SET standard_conforming_strings = off`): `'\.$'` lex thành `.$` — ràng buộc từ chối MỌI địa chỉ và khối đối chiếu dưới đếm
-- mọi hàng là "có dấu chấm cuối" (chẩn đoán sai); `E'\\.$'` lưu `\.$` dưới cả hai giá trị. Phép đo thường trực: `[khoản 283]` của
-- `db/migrations.int.test.ts` chạy nguyên văn tệp này dưới `SET LOCAL standard_conforming_strings = off` và đòi cùng một chẩn đoán.
--
-- ĐỐI CHIẾU TRƯỚC `ALTER`, khuôn 092 (049 trước nó): lượt kiểm của `ADD CONSTRAINT … CHECK` chỉ nói CÓ vi phạm, không nói Ở ĐÂU (048
-- đo). Khối DO đếm hàng có dấu chấm cuối ở CẢ HAI bảng, nêu tối đa 20 id mỗi bảng (`-` khi rỗng), KHÔNG in email (thông báo lỗi migration
-- đi vào log deploy), KHÔNG tự sửa — đổi hay xoá một địa chỉ đã lưu là đổi đích magic link: quyết định có người chịu, kèm một sự kiện
-- kiểm toán. Không `NOT VALID` (048: một ràng buộc chưa kiểm là một ràng buộc nói dối về quá khứ). Không khối bắt `check_violation`: từ
-- ADR-061 (khoản 102) `migrate()` từ chối hồ sơ N3 — vai deploy là chủ bảng FORCE mà RLS áp — TRƯỚC vòng, nên phép đếm dưới đây không
-- chạy dưới một vai bị RLS lọc (lý do của 092). Khoá `ACCESS EXCLUSIVE` trên hai bảng trong lúc kiểm (`migrate.ts` đặt
-- `lock_timeout = 0`) — cùng tính chất 048/049/092.
--
-- Hai dòng khai ở `CHECK_AN_NINH_KHAI` của hardening (khoản 105, vế "danh tính email chuẩn hoá"): gỡ hay đổi một trong hai ⇒ `migrate()`
-- kế NÉM. Tệp này cố ý không nhắc tên ràng buộc nào đã khai ở đó: `tests/architecture/check-an-ninh-khai.test.ts` đòi dòng khai trỏ
-- migration CUỐI CÙNG nhắc tên ràng buộc. Đo: `db/migrations.int.test.ts` `[khoản 283]` (dữ liệu có sẵn ⇒ NÉM nguyên văn; bỏ dấu chấm ở
-- hàng có dạng anh em ⇒ 23505; sửa tay ⇒ đi qua; INSERT thẳng dưới superuser ⇒ 23514 đúng tên), `apps/api/src/auth.int.test.ts`
-- `[khoản 283]`, `packages/supplier/src/suppliers.int.test.ts` và `tools/khoi-tao-to-chuc/src/khoi-tao.int.test.ts` `[S1.247]`.
-- =============================================================================================

DO $doi_chieu_cham_cuoi$
DECLARE
  so_nguoi_dung bigint;
  so_lien_he bigint;
  id_nguoi_dung text;
  id_lien_he text;
BEGIN
  SELECT pg_catalog.count(*) INTO so_nguoi_dung
    FROM public.users u
   WHERE u.email OPERATOR(pg_catalog.~) E'\\.$';
  SELECT pg_catalog.count(*) INTO so_lien_he
    FROM public.supplier_contacts c
   WHERE c.email OPERATOR(pg_catalog.~) E'\\.$';

  IF so_nguoi_dung OPERATOR(pg_catalog.>) 0 OR so_lien_he OPERATOR(pg_catalog.>) 0 THEN
    SELECT pg_catalog.string_agg(x.id::pg_catalog.text, ', ' ORDER BY x.id) INTO id_nguoi_dung
      FROM (SELECT u.id FROM public.users u
             WHERE u.email OPERATOR(pg_catalog.~) E'\\.$'
             ORDER BY u.id LIMIT 20) x;
    SELECT pg_catalog.string_agg(x.id::pg_catalog.text, ', ' ORDER BY x.id) INTO id_lien_he
      FROM (SELECT c.id FROM public.supplier_contacts c
             WHERE c.email OPERATOR(pg_catalog.~) E'\\.$'
             ORDER BY c.id LIMIT 20) x;

    RAISE EXCEPTION 'email co dau cham cuoi ten mien: users % hang — id (toi da 20): %; supplier_contacts % hang — id (toi da 20): % — sua tay duoi mot vai ma RLS khong ap (bo dau cham cuoi; hang nao da co dang khong dau cham thi hai hang la MOT hop thu — giu mot; doi hay xoa mot dia chi da luu la doi dich magic link: co nguoi chiu, kem mot su kien kiem toan), roi deploy lai (100_email_khong_dau_cham_cuoi, khoan no 283, ADR-139)',
      so_nguoi_dung, COALESCE(id_nguoi_dung, '-'), so_lien_he, COALESCE(id_lien_he, '-')
      USING ERRCODE = 'check_violation';
  END IF;

  ALTER TABLE public.users
    ADD CONSTRAINT users_email_khong_dau_cham_cuoi
    CHECK (email OPERATOR(pg_catalog.!~) E'\\.$');

  ALTER TABLE public.supplier_contacts
    ADD CONSTRAINT supplier_contacts_email_khong_dau_cham_cuoi
    CHECK (email OPERATOR(pg_catalog.!~) E'\\.$');
END
$doi_chieu_cham_cuoi$;

-- =============================================================================================
-- 049 — [khoản nợ 70] `supplier_contacts.email` PHẢI Ở CHỮ THƯỜNG — ràng buộc của 048, cộng một lượt ĐỐI CHIẾU THẬT
-- =============================================================================================
-- Khoản nợ 70, nguyên văn: *"`addSupplierContact` hạ chữ thường TRƯỚC KHI GHI và tự viết ra lý do … nhưng lược đồ không cưỡng
-- chế gì: một câu `INSERT` viết tay, một đường ghi thứ hai trong tương lai, hay một lần refactor quên bước ấy là đủ"*. Hệ quả sổ
-- nợ gọi tên: hai người liên hệ hợp lệ cho cùng một hộp thư dưới `UNIQUE (org_id, supplier_id, email)` — ràng buộc ấy so NGUYÊN
-- VĂN — nên hai magic link hợp lệ tới cùng một địa chỉ.
--
-- CÁCH ĐÓNG: đúng đường (b) mà 048 đã đo cạnh đường chỉ mục biểu thức và chọn cho `users` — `CHECK (email = lower(email))` cộng
-- `UNIQUE` sẵn có. Không thêm chỉ mục biểu thức, nên lời hứa của `[INV-H14]` ("tập chỉ mục duy nhất trên biểu thức RỖNG") giữ nguyên.
--
-- ĐÁNH ĐỔI, ghi thành quyết định [lượt soi 54 INFO-1]: RFC 5321 cho phép phần trước `@` phân biệt hoa-thường. Sản phẩm đã chọn từ S1.3
-- coi địa chỉ người liên hệ là KHÔNG phân biệt hoa-thường (`addSupplierContact` hạ mọi địa chỉ mới); ràng buộc này đưa quyết định ấy
-- xuống lược đồ — một hộp thư có phần trước `@` phân biệt hoa-thường nhận magic link ở dạng đã hạ. Đó là lựa chọn của sản phẩm, không
-- phải tác dụng phụ của file này.
--
-- ---------------------------------------------------------------------------------------------
-- KHÁC 048 Ở CHỖ QUYẾT ĐỊNH PHẠM VI: BẢNG NÀY CÓ ĐƯỜNG GHI, NÊN CÓ THỂ ĐÃ CÓ DỮ LIỆU
-- ---------------------------------------------------------------------------------------------
-- 048 đã đo: lượt kiểm của `ALTER TABLE … ADD CONSTRAINT … CHECK` chỉ nói CÓ vi phạm (`is violated by some row`), không nói Ở ĐÂU.
-- Nên khối DO dưới đây ĐỐI CHIẾU TRƯỚC và dừng deploy với ĐỊNH DANH: số hàng chưa ở chữ thường kèm tối đa 20 id; số NHÓM sẽ va khoá
-- duy nhất nếu hạ chữ thường — (tổ chức, nhà cung cấp, `lower(email)`) có từ hai hàng, ít nhất một hàng chưa ở chữ thường — mỗi nhóm kèm
-- MỌI id của nó (tối đa 10 nhóm). KHÔNG in email hay dữ liệu cá nhân nào khác: thông báo lỗi migration đi vào log deploy.
--
-- CỐ Ý KHÔNG TỰ `UPDATE … SET email = lower(email)`, kể cả cho hàng không va khoá: đổi một đích magic link đã lưu là một quyết định có
-- người chịu và có dấu vết kiểm toán, không phải tác dụng phụ của một migration. Người vận hành sửa tay theo danh sách định danh:
--   * dưới một vai mà RLS KHÔNG áp (superuser hay BYPASSRLS) — dưới vai deploy mà RLS áp, câu đối chiếu cũng ra 0 hàng (xem dưới);
--   * mỗi hàng đứng một mình: hạ chữ thường; mỗi nhóm va khoá: người quản lý mua hàng của tổ chức CHỌN người liên hệ được giữ —
--     người liên hệ đã được mời thì khoá ngoại chặn xoá, phải thu hồi lời mời theo đường sản phẩm trước;
--   * mỗi lần đổi hay xoá kèm một sự kiện kiểm toán (`011` gọi tên hậu quả của một lần đổi kênh nhận không dấu vết);
--   * rồi deploy lại — fail-closed.
-- Đo ở `db/migrations.int.test.ts` `[khoản nợ 70]`: dữ liệu vi phạm có từ trước ⇒ `migrate()` NÉM với thông báo so nguyên văn, tệp này
-- không được ghi checksum, hàng giữ nguyên — cả khi chỉ có MỘT hàng chữ hoa đứng một mình; sửa tay ⇒ đi qua.
--
-- ---------------------------------------------------------------------------------------------
-- VAI DEPLOY MÀ RLS ÁP CHO NÓ (HỒ SƠ N3 — KHOẢN NỢ 102): ĐỐI CHIẾU THẤY 0, NHƯNG LƯỢT KIỂM CỦA ALTER KHÔNG — ĐO
-- ---------------------------------------------------------------------------------------------
-- Theo `005`, vai deploy thật là chủ bảng FORCE có EXECUTE trên `app_current_org_id()`; `migrate()` không gắn `app.org_id`, nên policy
-- tenant lọc HẾT hàng và câu đếm của khối DO ra 0. Thăm dò S1.61 (PostgreSQL 16, chủ bảng FORCE, policy lọc hết): câu đếm dưới chủ ra 0
-- trong khi superuser thấy 1; `ALTER … ADD CHECK` và `NOT VALID` + `VALIDATE CONSTRAINT` đều NÉM 23514 — lượt kiểm ràng buộc không chịu
-- RLS, nên fail-closed giữ. Thông điệp trần của nó thì không nói gì, nên `ALTER` nằm trong khối con bắt đúng `check_violation` và ném lại
-- một thông báo nói thật: vai đang chạy, số hàng vai ấy thấy, `row_security_active`, và phải chạy lại dưới vai nào. Đo ở test N3 cùng tệp.
--
-- ---------------------------------------------------------------------------------------------
-- ĐƯỜNG GHI CÓ SẴN KHÔNG VẤP RÀNG BUỘC NÀY — ĐO, VÀ ĐO Ở ĐÂU
-- ---------------------------------------------------------------------------------------------
-- `addSupplierContact` hạ bằng `.toLowerCase()` của JS, còn `CHECK` so bằng `lower()` của máy chủ — hai định nghĩa. Thăm dò S1.61 (Node
-- 24.18, ICU 78.3; PostgreSQL 16.15 Alpine/musl, `en_US.utf8`; mọi điểm mã 1…0x10FFFF trừ surrogate): máy chủ hạ 1364 điểm mã, JS hạ
-- 1488; điểm mã máy chủ hạ mà JS không hạ: 0; chuỗi JS hạ ra mà máy chủ còn hạ tiếp: 0. `db/unique-oracle.int.test.ts` `[khoản nợ 70]`
-- đo lại tính chất ấy trên CHÍNH môi trường đang chạy (CI chạy Node 22), và đòi `lower()` của máy chủ gấp được ngoài ASCII.
--
-- RANH GIỚI GHI RA:
-- * Tập mà ràng buộc gấp là tập của `lower()` máy chủ: dưới `datctype` C/POSIX nó chỉ gấp ASCII; trên musl, 124 điểm mã JS hạ mà máy chủ
--   KHÔNG hạ (1488 − 1364, ví dụ `U+24B6` Ⓐ) là những cặp hoa-thường THẬT mà ràng buộc không gấp — `Ⓐn@x.vn` viết tay qua được, và
--   `ⓐn@x.vn` do sản phẩm ghi là một hàng thứ hai. glibc (048 đo `lower()` hạ 1460) chưa đo theo phép trên. Tất cả thuộc khoản nợ 71.
-- * Khoá `ACCESS EXCLUSIVE` trên `supplier_contacts` trong lúc kiểm (như 048 trên `users`); `migrate.ts` đặt `lock_timeout = 0`.
-- * Không kiểm định dạng email (đã có `supplier_contacts_email_hinh_dang`, 011); khoá vẫn theo (tổ chức, nhà cung cấp, email).
-- =============================================================================================

DO $doi_chieu_049$
DECLARE
  so_hang bigint;
  so_nhom bigint;
  dinh_danh text;
  nhom text;
BEGIN
  SELECT pg_catalog.count(*) INTO so_hang
    FROM public.supplier_contacts c
   WHERE c.email OPERATOR(pg_catalog.<>) pg_catalog.lower(c.email);

  IF so_hang OPERATOR(pg_catalog.>) 0 THEN
    SELECT pg_catalog.string_agg(x.id::pg_catalog.text, ', ' ORDER BY x.id) INTO dinh_danh
      FROM (SELECT c.id FROM public.supplier_contacts c
             WHERE c.email OPERATOR(pg_catalog.<>) pg_catalog.lower(c.email)
             ORDER BY c.id LIMIT 20) x;

    SELECT pg_catalog.count(*) INTO so_nhom
      FROM (SELECT 1 FROM public.supplier_contacts c
             GROUP BY c.org_id, c.supplier_id, pg_catalog.lower(c.email)
            HAVING pg_catalog.count(*) OPERATOR(pg_catalog.>) 1
               AND pg_catalog.bool_or(c.email OPERATOR(pg_catalog.<>) pg_catalog.lower(c.email))) g;

    SELECT pg_catalog.string_agg(g.ds, '; ' ORDER BY g.ds COLLATE pg_catalog."C") INTO nhom
      FROM (SELECT '[' OPERATOR(pg_catalog.||) pg_catalog.string_agg(c.id::pg_catalog.text, ', ' ORDER BY c.id) OPERATOR(pg_catalog.||) ']' AS ds
              FROM public.supplier_contacts c
             GROUP BY c.org_id, c.supplier_id, pg_catalog.lower(c.email)
            HAVING pg_catalog.count(*) OPERATOR(pg_catalog.>) 1
               AND pg_catalog.bool_or(c.email OPERATOR(pg_catalog.<>) pg_catalog.lower(c.email))
             ORDER BY pg_catalog.min(c.id::pg_catalog.text) COLLATE pg_catalog."C" LIMIT 10) g;

    RAISE EXCEPTION 'supplier_contacts: % hang co email chua o chu thuong — id (toi da 20): %; % nhom se trung khoa (org_id, supplier_id, email) neu ha chu thuong — id tung nhom (toi da 10 nhom): % — sua tay duoi mot vai ma RLS khong ap, moi thay doi kem mot su kien kiem toan, roi deploy lai (049, khoan no 70)',
      so_hang, dinh_danh, so_nhom, COALESCE(nhom, '-')
      USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    ALTER TABLE public.supplier_contacts
      ADD CONSTRAINT supplier_contacts_email_chu_thuong
      CHECK (email OPERATOR(pg_catalog.=) pg_catalog.lower(email));
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'supplier_contacts: co hang email chua o chu thuong nhung vai chay migration % chi thay % hang (row_security_active = %) — RLS da loc khoi doi chieu; chay lai migrate() duoi mot vai ma RLS khong ap de thay dinh danh (049, khoan no 70)',
      current_user, so_hang, pg_catalog.row_security_active('public.supplier_contacts'::pg_catalog.regclass)::pg_catalog.text
      USING ERRCODE = 'check_violation';
  END;
END
$doi_chieu_049$;

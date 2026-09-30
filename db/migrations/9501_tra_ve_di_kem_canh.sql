-- ==============================================================================================
-- 9501_tra_ve_di_kem_canh — [S1.9101 / khoản 260] HÀNG `rfq_tra_ve` PHẢI ĐI KÈM CẠNH VỀ DRAFT CỦA CHÍNH LẦN NỘP ẤY; BẢNG
-- CHỈ-GHI-THÊM CẢ VỚI CHỦ BẢNG
--
-- Lượt soi S1.198 đọc ra, khoản 260 ghi. `087` (3) giữ `rfq_tra_ve` chỉ-ghi-thêm BẰNG QUYỀN, và chỉ buộc MỘT chiều: cạnh về
-- DRAFT đòi một hàng của chính lần nộp (`087` (4)), còn hàng thì không đòi cạnh. Hai lỗ:
--  ⑴ Một hàng do `app_api` chèn tay, không kèm câu đổi trạng thái, commit được. Nó chiếm `UNIQUE (org, gói, lần nộp)` — lần trả
--     về thật của lần nộp ấy về sau bị từ chối (23505) — và thoả vế (4) cho một câu UPDATE thô về DRAFT ở một giao dịch SAU, gán
--     cho người chèn.
--  ⑵ Chủ bảng xoá một hàng thì chữ ký người trả đã rút đếm lại ở cạnh mở gói (`087` (5)) — fail-open; xoá một chữ ký thì
--     fail-closed. (SỬA một chữ ký — `rfq_approvals.lan_nop_da_xem` — thì cũng fail-open: đầu vào khác của cùng phép đếm, chỉ
--     giữ bằng quyền; khoản 9401, không đóng ở đây.)
--
-- (1) CONSTRAINT TRIGGER HOÃN TỚI COMMIT, khuôn `017` (b). Lúc INSERT, gói theo định nghĩa còn `PENDING_APPROVAL` — trigger
--     `rfq_tra_ve_dat_lan_nop` vừa đòi thế —, nên chỉ ở COMMIT mới trả lời được câu *giao dịch này CÓ trả gói về không*. Chủ dự
--     án chốt ngày 2026-09-30: đòi gói đã ĐI QUA cửa DRAFT ở lần nộp của hàng, không chỉ đã rời `PENDING_APPROVAL` — MỘT TẬP,
--     như `017`: gói đứng ở DRAFT với ĐÚNG lần nộp ấy, hoặc lần nộp đã TĂNG (trả về rồi nộp lại trong cùng giao dịch; dưới
--     `app_api` lần nộp chỉ tăng ở cạnh DRAFT→PENDING_APPROVAL, nên gói đã đi qua DRAFT — chủ bảng `rfq_packages` thì sửa được
--     cột ấy, khoản 9401). Gói đứng ở `PENDING_APPROVAL`, `OPEN` hay `CANCELLED` với đúng lần nộp ấy thì hàng không kèm lần
--     trả về nào: từ chối, cả giao dịch lùi. Gói KHÔNG ĐỌC ĐƯỢC lúc COMMIT cũng bị từ chối: hàm chạy dưới quyền người gọi và RLS
--     áp, nên một câu đổi `app.org_id` giữa lần chèn và COMMIT làm gói biến mất khỏi tầm nhìn — `017` trả `NULL` (bỏ qua) ở đó
--     (khoản 9402), hàm này thì không. Đánh đổi, nói ra: trả về rồi HUỶ trong CÙNG một giao dịch bị từ chối — tầng gói không
--     làm thế (huỷ là một lời gọi riêng) —, trừ khi `SET CONSTRAINTS … IMMEDIATE` chạy phép kiểm giữa hai câu, lúc gói còn ở
--     DRAFT: khi ấy gói đã thật sự đi qua DRAFT, và hàng được nhận. Hàng có TRƯỚC tệp này không được kiểm lại: một hàng lẻ đã
--     commit vẫn chiếm UNIQUE của lần nộp ấy và vẫn thoả vế (4).
-- (2) CHỈ-GHI-THÊM BẰNG TRIGGER, khuôn `069`: `bid_chi_ghi_them` ở `UPDATE OR DELETE` cộng chốt `TRUNCATE` cấp câu lệnh, cả hai
--     `ENABLE ALWAYS` — chặn cả chủ bảng lẫn superuser, kể cả dưới `session_replication_role = replica`. Bảng vào tập chỉ-ghi-thêm
--     suy ra của H19.
--
-- `DROP TRIGGER IF EXISTS` đứng trước mỗi `CREATE`, khuôn `047`: bảng đã có từ `087`, nên trên một cụm đang chạy, lượt sửa ĐẦU
-- của hardening (trước vòng đánh số) đã dựng hai trigger chỉ-ghi-thêm theo mục ghim `bid_chi_ghi_them (047)` trước khi tệp này
-- chạy. Mọi hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96), và có tên trong `TRIGGER_DUOC_PHEP`
-- (khoản 259).
-- ==============================================================================================

-- ============================================================================================
-- (1) HÀNG TRẢ VỀ PHẢI ĐI KÈM CẠNH VỀ DRAFT
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_tra_ve_phai_di_kem_canh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  hien_tai integer;
BEGIN
  SELECT p.status, p.lan_nop INTO trang_thai, hien_tai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong doc duoc goi thau cua hang tra ve luc COMMIT (K4a)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF hien_tai > NEW.lan_nop OR (trang_thai = 'DRAFT' AND hien_tai = NEW.lan_nop) THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Hang rfq_tra_ve cua lan nop % phai di kem canh ve DRAFT cua chinh lan nop ay trong cung giao dich; goi dang o % (K4a)', NEW.lan_nop, trang_thai
    USING ERRCODE = 'check_violation';
END
$ham$;

DROP TRIGGER IF EXISTS rfq_tra_ve_phai_di_kem_canh ON rfq_tra_ve;
CREATE CONSTRAINT TRIGGER rfq_tra_ve_phai_di_kem_canh
  AFTER INSERT ON rfq_tra_ve
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.rfq_tra_ve_phai_di_kem_canh();
ALTER TABLE rfq_tra_ve ENABLE ALWAYS TRIGGER rfq_tra_ve_phai_di_kem_canh;

-- ============================================================================================
-- (2) CHỈ-GHI-THÊM CẢ VỚI CHỦ BẢNG
-- ============================================================================================
DROP TRIGGER IF EXISTS rfq_tra_ve_chi_ghi_them ON rfq_tra_ve;
CREATE TRIGGER rfq_tra_ve_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_tra_ve
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_tra_ve ENABLE ALWAYS TRIGGER rfq_tra_ve_chi_ghi_them;

DROP TRIGGER IF EXISTS rfq_tra_ve_chan_truncate ON rfq_tra_ve;
CREATE TRIGGER rfq_tra_ve_chan_truncate
  BEFORE TRUNCATE ON rfq_tra_ve
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_tra_ve ENABLE ALWAYS TRIGGER rfq_tra_ve_chan_truncate;

-- ==============================================================================================
-- 055 — [S1.100 / khoản 209 + 210, và điều kiện để đóng khoản 211]
-- CẶP NHÂN CHỨNG BREAK-GLASS: **BẤT BIẾN** SAU KHI HÀNG SINH, VÀ KHÔNG GÁC CÂU `EXECUTED`.
--
-- 022 mục (4) dựng hai cột nhân chứng làm *"mức thấp nhất còn giữ được D3"* khi đường phê duyệt
-- bị bỏ: break-glass vẫn bỏ qua NGƯỠNG, nhưng nó phải có một người thứ hai trong một phiên thứ
-- hai. Hai khiếm khuyết đối xứng nhau đã ở đó từ 022, và vòng này đo được cả hai trên cụm thật:
--
--   [khoản 209] Hai vế D3 (*người yêu cầu không tự làm chứng*, *nhân chứng ở phiên khác*) nằm
--   trong `unseal_kiem_du_phe_duyet`, mà trigger gọi hàm ấy mang
--   `WHEN (NEW.status = 'APPROVED' AND NEW.status IS DISTINCT FROM OLD.status)` — chạy ở đúng
--   MỘT CẠNH. Và hai cột nhân chứng KHÔNG nằm trong danh sách bất biến của
--   `unseal_kiem_chuyen_trang_thai`. Nên sau khi hàng đã `APPROVED`, MỘT câu `UPDATE` đưa chính
--   người yêu cầu vào làm chứng cho mình: trigger danh tính vẫn cho qua, vì phiên của họ CÓ
--   thật và CÓ khớp chủ phiên — nó hỏi *"cặp này dẫn xuất từ một phiên sống không"*, không hỏi
--   *"người này có phải người khác không"*. **Đo được: `rowCount = 1`**, dưới cả `app_api` lẫn
--   chủ sở hữu. D3 phá được bằng một câu.
--
--   [khoản 210] Trigger `unseal_requests_kiem_nhan_chung` mang
--   `WHEN (NEW.break_glass_witness_user_id IS NOT NULL)` trên `BEFORE INSERT OR UPDATE`, mà câu
--   kết thúc của worker LÀ một `UPDATE` trên bảng ấy. Nên trigger fire ở câu `EXECUTED`, đòi
--   phiên nhân chứng CÒN SỐNG, và giao dịch gãy ở CUỐI — sau khi đã mở bọc khoá KMS và giải mã
--   mọi phong bì. **Đo được dưới đúng vai `app_unseal`:**
--   `Phien khong hop le: het han, bi thu hoi, hoac thuoc to chuc khac`. TTL phiên mặc định 8
--   giờ, nên kịch bản là: sự cố, break-glass được duyệt, nhân chứng đăng xuất, và lượt mở thầu
--   khẩn cấp KHÔNG BAO GIỜ chạy được nữa. Mỗi lượt thử lại đốt một lần `kms:Decrypt` rồi
--   rollback, và hết `maxAttempts` thì job `FAILED`.
--
-- **VÌ SAO HAI KHOẢN PHẢI ĐI CÙNG MỘT VÒNG.** Chúng khoá lẫn nhau. Vá 210 một mình — thu hẹp
-- `WHEN` về đúng lượt cặp ĐỔI, khuôn 054 — thì câu `UPDATE` của 209 KHÔNG còn bị trigger danh
-- tính soi nữa, tức lỗ RỘNG RA. Vá 209 một mình thì đường hợp lệ vẫn tắc.
--
-- **VÌ SAO BẢN NÀY KHÁC BẢN MÀ KHOẢN 210 ĐỀ XUẤT.** Khoản 210 đề xuất khuôn 054: một nhánh
-- `INSERT` và một nhánh `UPDATE` thu hẹp về lượt cặp ĐỔI. Vòng này chọn hẹp hơn — **ghi một lần,
-- ở `INSERT`** — vì sau mục (1) dưới đây cặp nhân chứng KHÔNG ĐỔI ĐƯỢC trên `UPDATE` nữa, nên
-- một nhánh `UPDATE` sẽ là một trigger KHÔNG BAO GIỜ FIRE. Một trigger không fire được không
-- phải một lớp phòng thủ; nó là một câu nói sai về thứ gì đang canh thứ gì — đúng hình dạng mà
-- khoản 211 gọi tên. 054 cần nhánh `UPDATE` vì cặp ĐIỀU PHỐI đổi thật (khoản 130: điều phối lại
-- một job đã chết). Cặp NHÂN CHỨNG thì không: nó là lời khai của MỘT LẦN, không phải một trạng
-- thái đang chạy.
--
-- **THỨ TỰ TRIGGER LÀ MỘT PHẦN CỦA BẢN VÁ, KHÔNG PHẢI MAY MẮN.** Trigger `BEFORE ... FOR EACH
-- ROW` của PostgreSQL fire theo THỨ TỰ TÊN, nên `unseal_requests_kiem_chuyen_trang_thai` (`c`)
-- đứng trước `unseal_requests_kiem_nhan_chung` (`n`): câu `UPDATE` của khoản 209 gãy ở mục (1)
-- với thông điệp gọi tên D3, chứ không gãy ở một thông điệp về phiên.
--
-- **THỨ VÒNG NÀY KHÔNG MỞ:** một đường đổi nhân chứng THẬT. Nếu ngày nào cần, nó phải là một
-- hành vi có TÊN riêng, mã kiểm toán riêng, và phải chạy lại CẢ HAI vế D3 — chứ không phải một
-- câu `UPDATE` trên hai cột. Ghi ra đây để lần sau không ai mở nó bằng cách gỡ mục (1).
-- ==============================================================================================

-- ----------------------------------------------------------------------------------------------
-- (1) [khoản 209] HAI CỘT NHÂN CHỨNG VÀO DANH SÁCH BẤT BIẾN
-- ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unseal_kiem_chuyen_trang_thai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  CANH_HOP_LE constant text[] := ARRAY[
    'PENDING->APPROVED',
    'PENDING->CANCELLED',
    'APPROVED->EXECUTED',
    'APPROVED->CANCELLED'
  ];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status OPERATOR(pg_catalog.||) '->' OPERATOR(pg_catalog.||) NEW.status)
            OPERATOR(pg_catalog.=) ANY (CANH_HOP_LE)) THEN
      RAISE EXCEPTION 'Chuyen trang thai yeu cau mo thau khong hop le: % -> %',
        OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Không cột nào của phần YÊU CẦU được sửa sau khi đã tạo. Một lý do sửa được sau khi phê duyệt
  -- là một lý do người duyệt chưa từng đọc.
  IF NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.break_glass IS DISTINCT FROM OLD.break_glass
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_by_session_id IS DISTINCT FROM OLD.requested_by_session_id THEN
    RAISE EXCEPTION 'Chi sua duoc trang thai va cac moc thoi gian cua yeu cau mo thau'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [S1.100 / khoản 209] CẶP NHÂN CHỨNG BREAK-GLASS CŨNG BẤT BIẾN — và nó có câu `RAISE` RIÊNG
  -- vì nó là một vế KHÁC. Hai vế D3 nằm trong `unseal_kiem_du_phe_duyet`, mà trigger gọi hàm ấy
  -- chỉ chạy ở CẠNH `-> APPROVED`. Nên một câu `UPDATE` sau khi đã duyệt đưa chính người yêu cầu
  -- vào làm chứng cho mình, và không vế nào chạy lại: trigger danh tính hỏi *"cặp này dẫn xuất
  -- từ một phiên sống không"*, KHÔNG hỏi *"người này có phải người khác không"*. Đo được trên
  -- cụm thật trước vòng này: `rowCount = 1`, dưới cả `app_api` lẫn chủ sở hữu.
  IF NEW.break_glass_witness_user_id IS DISTINCT FROM OLD.break_glass_witness_user_id
     OR NEW.break_glass_witness_session_id IS DISTINCT FROM OLD.break_glass_witness_session_id THEN
    RAISE EXCEPTION 'Khong doi duoc nguoi lam chung break-glass sau khi yeu cau da sinh (D3)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

-- ----------------------------------------------------------------------------------------------
-- (2) [khoản 209] LỚP ĐẶC QUYỀN — `app_api` KHÔNG CÒN `UPDATE` TRÊN HAI CỘT ẤY
--
-- 022 cấp cả `INSERT` lẫn `UPDATE` trên hai cột này, nhưng KHÔNG đường mã nào dùng vế `UPDATE`:
-- `requestUnseal` đặt nhân chứng trong chính câu `INSERT`, và đó là chỗ duy nhất trong toàn kho
-- chạm hai cột. Nên vế `UPDATE` ấy là một đặc quyền không ai gọi — và là đúng phương tiện của
-- khoản 209. Trigger ở mục (1) là lớp có thẩm quyền; lớp này đứng TRƯỚC nó và rẻ hơn nó, nên
-- một câu viết tay dưới `app_api` nay gãy ở 42501 chứ không tới được trigger.
--
-- Hai lớp KHÔNG phải hai cơ chế làm một việc: phép kiểm cột chỉ canh `app_api`, còn trigger canh
-- MỌI vai — kể cả chủ sở hữu và một script vận hành chạy dưới siêu người dùng.
-- ----------------------------------------------------------------------------------------------
REVOKE UPDATE (break_glass_witness_user_id, break_glass_witness_session_id)
  ON unseal_requests FROM app_api;

-- ----------------------------------------------------------------------------------------------
-- (3) [khoản 210] TRIGGER NHÂN CHỨNG CHỈ CÒN GÁC LÚC CHÈN
--
-- Tên trigger giữ nguyên: nó vẫn canh đúng điều nó tên, chỉ ở đúng lúc cặp SINH RA. Giữ tên là
-- cố ý — 043 mang `ENABLE ALWAYS TRIGGER unseal_requests_kiem_nhan_chung` và hardening ghim nó
-- theo tên, nên đổi tên là mở thêm ba chỗ phải nhớ mà không mua được gì.
-- ----------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS unseal_requests_kiem_nhan_chung ON unseal_requests;

CREATE TRIGGER unseal_requests_kiem_nhan_chung
  BEFORE INSERT ON unseal_requests
  FOR EACH ROW
  WHEN (NEW.break_glass_witness_user_id IS NOT NULL)
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'break_glass_witness_user_id', 'break_glass_witness_session_id');

-- Khuôn 043: trigger canh danh tính chạy CẢ khi phiên đặt `session_replication_role = replica`.
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_nhan_chung;

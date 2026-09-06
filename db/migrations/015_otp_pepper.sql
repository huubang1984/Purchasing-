-- db/migrations/015_otp_pepper.sql
-- ADR-018 biến thành câu lệnh: BĂM CÓ PEPPER, VÀ BĂM MANG THEO PHIÊN BẢN PEPPER ĐÃ DÙNG.
--
-- ============================================================================================
-- PHÉP ĐO ĐI TRƯỚC — VẾ ĐỐI CHỨNG DƯƠNG, CHẠY TRƯỚC KHI VIẾT MỘT DÒNG NÀO CỦA FILE NÀY
-- ============================================================================================
-- Câu của M1 — *"SHA-256 trần trên không gian ~10^9 số di động là đảo ngược được"* — được đo trên
-- một không gian giả lập 10^4 số, Node 22, một luồng:
--
--   KHONG pepper -> tim duoc  : 0900007321 (11 ms)
--   CO pepper    -> tim duoc  : null       (12 ms)
--   chi phi ~1 bam            : 0.0011 ms
--   ngoai suy 10^9 (1 luong)  : 18.3 phut
--
-- Không có vế "KHÔNG pepper thì TÌM RA", câu "có pepper thì không tìm ra" cũng xanh khi phép đo
-- hỏng theo mọi hướng khác. Và con số 18 phút là thứ biến M1 từ một lo ngại trên giấy thành một
-- việc phải làm: một bản sao lưu CSDL rò ra ngoài là một DANH BẠ, không phải một bảng băm.
--
-- ============================================================================================
-- BA THỨ ĐƯỢC PEPPER, VÀ BA THỨ CỐ Ý KHÔNG
-- ============================================================================================
-- CÓ pepper — không gian tiền ảnh nhỏ, liệt kê được:
--   * `invitation_otp_challenges.destination_hash`  — số điện thoại / email, ~10^9;
--   * `otp_rate_limits.bucket_hash`                 — cùng tập đích, cộng dấu vân người gọi;
--   * `invitation_otp_challenges.code_hash`         — SÁU CHỮ SỐ, tức 10^6.
--
-- Mục thứ ba KHÔNG nằm trong ADR-018 và nó được tìm ra khi cài: `code_hash` là
-- `sha256(invitation_id ‖ code)`, và `invitation_id` nằm ngay trong cùng bản sao lưu. Một kẻ có
-- bản sao lưu liệt kê 10^6 mã trong vài giây và đọc ra mã của MỌI thách thức CHƯA TIÊU THỤ. E1
-- nói CSDL chỉ giữ băm của mã; khi băm đảo ngược được, "chỉ giữ băm" và "giữ mã" là một.
--
-- KHÔNG pepper — tiền ảnh là 32 byte ngẫu nhiên, liệt kê là vô nghĩa:
--   * `rfq_invitation_tokens.token_hash`, `guest_sessions.token_hash`, `sessions.token_hash`.
-- Thêm pepper vào đó không mua thêm gì, và mỗi chỗ dùng pepper là một chỗ phải xoay đúng.
--
-- ============================================================================================
-- VÌ SAO CHỈ MỘT BẢNG CÓ CỘT PHIÊN BẢN
-- ============================================================================================
-- `otp_rate_limits` có cửa sổ ngắn: xoay pepper chỉ làm bộ đếm bắt đầu lại, và hàng cũ tự già đi.
-- Đó là một hệ quả PHẢI NÓI RA chứ không phải một chi tiết — trong đúng cửa sổ xoay, hạn mức của
-- mọi đích được đặt lại. Xoay pepper vì vậy là một thao tác vận hành có thời điểm, không phải một
-- việc làm bất kỳ lúc nào.
--
-- `invitation_otp_challenges` thì khác: nó là DỮ LIỆU KIỂM TOÁN SỐNG LÂU. Xoay pepper mà không
-- ghi phiên bản là làm chết khả năng đối chiếu của mọi hàng cũ — và làm chết nó trong im lặng,
-- vì một băm không khớp trông y hệt một băm sai.
--
-- ============================================================================================
-- `NOT NULL` KHÔNG CÓ DEFAULT — CỐ Ý, VÀ ĐÂY LÀ LÝ DO
-- ============================================================================================
-- Câu lệnh này GÃY nếu bảng đang có hàng. Đó là hành vi mong muốn: một `DEFAULT 'v0'` sẽ dán một
-- nhãn phiên bản lên những hàng được băm KHÔNG có pepper nào — tức ghi một điều sai vào đúng cột
-- sinh ra để nói sự thật. `docs/STATE.md` ghi rõ dự án CHƯA TRIỂN KHAI (chưa có tài khoản, chưa
-- có CMK, chưa có role nào được tạo), nên không có dữ liệu thật để mất; mọi lần chạy test dựng
-- một container mới. Nếu ngày nào câu này gãy trên một CSDL có dữ liệu, đó là một cuộc di trú
-- phải viết tay, không phải một mặc định để chọn bừa.
ALTER TABLE invitation_otp_challenges ADD COLUMN pepper_version text NOT NULL
  CHECK (octet_length(pepper_version) > 0 AND octet_length(pepper_version) <= 32);

GRANT INSERT (pepper_version) ON invitation_otp_challenges TO app_api;

COMMENT ON COLUMN invitation_otp_challenges.pepper_version IS
  'ADR-018: phien ban pepper da dung cho code_hash VA destination_hash cua chinh hang nay. Hai '
  'bam duoc ghi cung mot luot nen chung luon cung phien ban — mot cot du cho ca hai.';

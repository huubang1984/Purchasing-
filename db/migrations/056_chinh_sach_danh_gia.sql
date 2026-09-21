-- ==============================================================================================
-- 056 — [S1.102 / S2.1 của spec Mảnh S2 / ADR-050]
-- CHÍNH SÁCH ĐÁNH GIÁ: MỞ RỘNG BẢNG ĐÃ CÓ, VỚI MỘT `CHECK` TẤT-CẢ-HOẶC-KHÔNG-CỘT-NÀO
--
-- Spec S2 §4.1 chốt: trọng số và tham số của Effective Cost là DỮ LIỆU theo tổ chức (ràng buộc ⑷
-- của PRODUCT §8⑸), và chúng ở trong `org_procurement_policies` chứ KHÔNG ở một bảng chính sách
-- thứ hai. Lý do đã ghi ở spec, và nó là lý do nghiệp vụ chứ không phải tiện tay: một người mua
-- nghĩ về *"chính sách mua sắm phiên bản 4"* như MỘT vật; hai bảng đánh số độc lập buộc mọi câu
-- hỏi kiểm toán phải đối chiếu hai dòng thời gian, và tạo ra một trạng thái vô nghĩa — *phiên bản
-- ngưỡng 4 với phiên bản trọng số 7*.
--
-- **CÁI GIÁ, VÀ NÓ PHẢI LÀ FAIL-CLOSED.** Mọi phiên bản chính sách tạo TRƯỚC vòng này không có
-- hai cột dưới đây. Nên chúng cho phép `NULL`, và một `CHECK` đòi **tất-cả-hoặc-không-cột-nào**:
-- một phiên bản khai một nửa là một phiên bản nói dối về chính nó. Lượt đánh giá chạy dưới một
-- phiên bản chính sách CHƯA khai thì bị TỪ CHỐI bằng một câu gọi tên — *"chính sách phiên bản N
-- chưa khai trọng số đánh giá; tạo phiên bản mới trước khi chấm"* — chứ KHÔNG âm thầm lấy một
-- giá trị mặc định. Một mặc định ở đây là đúng thứ ràng buộc ⑷ cấm. Câu từ chối ấy là việc của
-- **S2.3** (chưa có mã); thứ `056` dựng là lớp CSDL làm cho trạng thái "khai một nửa" bất khả.
--
-- **VÌ SAO KHÔNG CÓ CỘT LUẬT LÀM TRÒN.** ADR-050 ⑴ chốt MỘT luật duy nhất — nửa-ra-xa-0, ghim ở
-- cả hai tầng — chứ không để nó thành tham số theo tổ chức. Chủ dự án đã cân nhắc phương án
-- "luật làm tròn là dữ liệu của chính sách" và KHÔNG chọn: §8.2 của spec cảnh báo rằng mỗi tham
-- số thêm vào là một tham số pilot có thể khai đại cho xong, và một luật làm tròn khai sai không
-- ai nhìn ra được từ bảng xếp hạng.
--
-- **QUY ƯỚC `bafo_top_n = 0`.** BAFO là tuỳ chọn theo chính sách (spec §2.2⑸: một RFQ đi thẳng từ
-- `EVALUATING` sang `AWARDED` là đường HỢP LỆ). Nên `0` nghĩa là *tổ chức này không dùng BAFO*, và
-- nó vẫn là một lời khai CÓ MẶT — khác hẳn `NULL`, nghĩa là *chưa khai gì cả*. Vế
-- tất-cả-hoặc-không-cột-nào vì thế không buộc ai phải bật BAFO.
--
-- **THỨ MIGRATION NÀY KHÔNG LÀM, nói ra:** nó không khai hình dạng BÊN TRONG của
-- `eval_components` ngoài "phải là một mảng JSON". Vế *mọi phần tử mang một trường tiền* là J1, và
-- J1 cần một trigger đọc chính sách chứ không phải một `CHECK` — đã đo ở lượt soi S1.101 và ghi
-- vào spec §5. Dựng nửa lớp ấy ở đây sẽ là một `CHECK` trông như đang canh J1 mà không canh.
--
-- **VÀ MỘT GIỚI HẠN CÓ THẬT:** khoản **105** (rổ A) ghi rằng hardening KHÔNG canh ràng buộc
-- `CHECK` an ninh — gỡ hay hạ về `NOT VALID` thì không lớp nào kêu. Ba ràng buộc dưới đây nằm
-- trong đúng khoảng trống ấy. Không đóng được ở vòng này, và nói ra thay vì để người đọc tưởng
-- chúng được canh.
-- ==============================================================================================

ALTER TABLE org_procurement_policies
  ADD COLUMN eval_components jsonb,
  ADD COLUMN bafo_top_n      integer;

-- Tất-cả-hoặc-không-cột-nào: hai cột cùng khai, hoặc cùng chưa khai.
ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_danh_gia_du_bo
  CHECK ((eval_components IS NULL) = (bafo_top_n IS NULL));

-- `0` là *không dùng BAFO*; số âm không phải một lời khai nào cả.
ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_bafo_top_n_khong_am
  CHECK (bafo_top_n IS NULL OR bafo_top_n OPERATOR(pg_catalog.>=) 0);

-- Hình dạng NGOÀI của `eval_components`: một MẢNG JSON. `jsonb` nhận cả số, chuỗi và `null` ở
-- mức gốc, nên không có vế này thì `'"x"'::jsonb` là một chính sách hợp lệ.
ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_eval_components_la_mang
  CHECK (eval_components IS NULL
         OR pg_catalog.jsonb_typeof(eval_components) OPERATOR(pg_catalog.=) 'array');

-- Quyền theo CỘT là cộng dồn — câu này THÊM hai cột vào tập `INSERT` mà 014 và 020 đã dựng,
-- không thay thế nó. Vẫn KHÔNG có `UPDATE`: bảng này chỉ ghi thêm, đổi chính sách là thêm một
-- phiên bản. Vẫn KHÔNG cấp gì cho `app_unseal`.
GRANT INSERT (eval_components, bafo_top_n) ON org_procurement_policies TO app_api;

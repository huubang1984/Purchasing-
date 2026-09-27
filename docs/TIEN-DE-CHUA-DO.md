# TIỀN ĐỀ CHƯA ĐO — những chỗ S1 đang đoán về một người mua thật

> **Ngày lập: 2026-09-04.**
>
> `docs/STATE.md` là sổ trạng thái **kỹ thuật**: mỗi dòng của nó truy được về một phép đo trên
> Postgres, một lượt CI, hay một đồ thị phụ thuộc. File này là thứ còn lại — **những câu về CON
> NGƯỜI và QUY TRÌNH mà không phép đo nào trong kho này chạm tới được.**
>
> ---
>
> ## Nó KHÔNG phải cái gì
>
> **Nó KHÔNG thay một khách hàng pilot, và không được dùng như thể nó thay.** Một pilot giả lập
> cho ra bằng chứng giả lập; trong một kho mã mà toàn bộ giá trị nằm ở chỗ mọi khẳng định đều truy
> được về một phép đo, đó đúng là lớp khiếm khuyết **"xanh giả"** mà dự án đã bắt mười chín lần và
> ghi lại từng lần.
>
> Nó cũng KHÔNG phải một danh sách rủi ro. Rủi ro nằm ở `docs/STATE.md` §*Điểm chặn* và §8 của kế
> hoạch S1. Đây là thứ hẹp hơn và cụ thể hơn: **mỗi dòng là một câu mà mã nguồn đang cư xử như thể
> nó đúng.**
>
> ## Nó là cái gì
>
> Nó làm **buổi làm việc đầu tiên với một người mua thật rẻ đi**. Không có nó, buổi ấy là một cuộc
> phỏng vấn mở và người đi hỏi phải tự nhớ ra mình đang đoán những gì. Có nó, buổi ấy là **một
> tiếng đồng hồ đi hết một danh sách**, và mỗi câu trả lời rơi thẳng vào một dòng có địa chỉ trong
> mã.
>
> ## Quy ước — hai điều, và điều thứ hai quan trọng hơn
>
> 1. **Mỗi dòng phải trỏ tới một chỗ THẬT trong kho mã.** Một tiền đề không tìm được chỗ nó đang
>    được cư xử như thật thì không thuộc về file này.
> 2. **Không dòng nào được chuyển sang *"đã xác nhận"* mà không có TÊN NGƯỜI và NGÀY.** *"Có vẻ
>    hợp lý"*, *"ai cũng làm thế"*, và *"tôi từng thấy"* đều **không** đủ. Đây là cùng quy ước đã
>    áp cho `.sql`, chú thích và `evidence/INV-matrix.md`: một câu phát biểu rộng hơn thứ được đo
>    là một khiếm khuyết thật.
>
> **Tiền lệ:** ADR-015 đã làm đúng việc này cho một tiền đề duy nhất — *"hộp thư nhận yêu cầu báo
> giá thường là hộp thư chung của phòng kinh doanh"* — bằng một khối cảnh báo tường minh. File này
> chỉ mở rộng khuôn ấy ra toàn bộ S1.

---

## A. Về NHÀ CUNG CẤP

| # | Tiền đề mã nguồn đang cư xử như thật | Nằm ở đâu | Sai thì mất gì | Câu hỏi cho người mua thật |
|---|---|---|---|---|
| **A1** | Nhà cung cấp **sẵn lòng cho số điện thoại**, và số ấy là của một **cá nhân** chứ không phải tổng đài | `008` `supplier_contacts.phone`; ADR-015 mục 2 | SMS là kênh OTP mặc định. Không có số ⇒ **lời mời bị từ chối**, không rơi về email (ADR-015 mục 1 cấm) ⇒ **không nộp được thầu** | *"Khi anh mời một nhà cung cấp mới, anh có số di động của đúng người phụ trách báo giá không, hay chỉ có email công ty?"* |
| **A2** | Hộp thư nhận yêu cầu báo giá thường là **hộp thư CHUNG của phòng kinh doanh** | ADR-015, khối cảnh báo `> ` | Đây là lập luận **duy nhất** loại email khỏi vai trò kênh OTP. Nếu hộp thư là của cá nhân, lập luận yếu đi (nhưng kết luận vẫn đứng nhờ E5) | *"Email anh gửi yêu cầu báo giá tới là hộp thư riêng của một người, hay `sales@`/`info@`?"* |
| **A3** | Nhà cung cấp mở link **trong một trình duyệt có `crypto.subtle`** | ADR-007, ADR-011, `tools/do-webcrypto` | Toàn bộ đường nộp thầu. Đã đo iOS 18.7 ✅; **Android còn trống** (khoản nợ 23) | *"Nhà cung cấp của anh mở link bằng gì — Zalo, Messenger, hay trình duyệt?"* |
| **A4** | Nhà cung cấp **chấp nhận hai bước** (link + OTP) cho lần báo giá đầu | ADR-015 mục 1; E2 | Ràng buộc sản phẩm 1 nói *friction thấp là điều kiện sống còn*. Nếu hai bước làm tụt tỷ lệ phản hồi, USP 1 mất chỗ dựa | *"Nếu phải bấm thêm một mã OTP mới vào được, anh nghĩ bao nhiêu nhà cung cấp bỏ cuộc?"* |
| **A5** | **Người giữ kênh** và **người ngồi trước màn hình** thường là **một** | `010` `guest_sessions.verified_contact_id`; ADR-015 §*Cái này KHÔNG đóng* | E5 ghi *danh tính thực tế đã xác thực*. Nếu chuyển tiếp cả link lẫn OTP là **thói quen bình thường**, cột ấy ghi một người không làm gì | *"Có bao giờ một người nhận email rồi chuyển cho đồng nghiệp làm báo giá không?"* |
| **A6** | **[S1.159]** Nhà cung cấp **không sửa ô tiền tệ** điền sẵn `VND` | `apps/web/trang/nop-thau.html:54`; `packages/danh-gia/src/luot-danh-gia.ts:310-321`; khoản **244** | Một nhà cung cấp gõ `VNĐ` hay `vnd` là lượt chấm của cả gói bị từ chối, và không ai trao thầu được | *"Nhà cung cấp của anh ghi đơn vị tiền thế nào trên báo giá — VND, VNĐ, hay đ?"* |

## B. Về NGƯỜI MUA

| # | Tiền đề | Nằm ở đâu | Sai thì mất gì | Câu hỏi |
|---|---|---|---|---|
| **B1** | Tổ chức mua **có một ngưỡng phê duyệt kép** và nói ra được nó bằng **một con số** | `014` `org_procurement_policies.dual_approval_threshold`; ADR-017 | `setRfqBudget` **NÉM** khi chưa có chính sách. Nếu thực tế là *"tuỳ trường hợp"* hoặc *"theo loại hàng"*, mô hình một-ngưỡng-một-tổ-chức sai hình dạng | *"Trên bao nhiêu tiền thì cần hai người duyệt? Con số đó có khác nhau theo loại hàng không?"* |
| **B2** | Người mua **ước lượng được giá trị RFQ trước khi mời** | `014` `rfq_budgets.estimated_value` | Là đầu vào của phân loại D2 **và** là đơn vị của North Star *Verified Competitive Spend*. Không ước lượng được ⇒ mọi RFQ rơi về `requires_dual_approval = true` | *"Trước khi hỏi giá, anh có con số dự trù không, hay chính việc hỏi giá mới ra con số?"* |
| **B3** | Người mua **khai ước lượng trung thực** | ADR-017 §*Điều KHÔNG đóng* | Né phê duyệt kép bằng cách khai thấp — **không lớp nào ở S1 chặn**, cùng họ với chia nhỏ đơn hàng. Thứ bắt được nó thuộc S2/S3 | *"Nếu một người mua muốn tránh phải xin hai chữ ký, anh nghĩ họ sẽ làm gì?"* |
| **B4** | Tổ chức có **đủ người** để tách vai: người tạo ≠ hai người duyệt | `011` `rfq_kiem_nguoi_duyet`; D3 | Doanh nghiệp nhỏ có thể chỉ có **một** người mua. Lúc ấy D3 không phải một lớp bảo vệ mà là một **cửa khoá không mở được** | *"Ở công ty anh, người tạo yêu cầu mua và người duyệt có phải hai người khác nhau không?"* |
| **B5** | Người mua biết **đúng người liên hệ** ở phía nhà cung cấp khi mời | `010` `rfq_invitations.contact_id`; một lời mời một người | Mời sai người ⇒ OTP về sai máy ⇒ A5 thành đường chính chứ không phải ngoại lệ | *"Anh mời đích danh một người, hay gửi vào địa chỉ chung của nhà cung cấp?"* |
| **B6** | **[2026-09-06, ADR-020 đề xuất]** Nhân viên mua hàng **chấp nhận cài một ứng dụng TOTP** và đăng nhập bằng **email + TOTP, không mật khẩu** | ADR-020 mục 2; kế hoạch S1.10.4 | Nếu công ty đã chuẩn hoá SSO hoặc nhân viên không cài được ứng dụng TOTP trên máy công ty, S1.10.4 phải làm lại thành SSO (S5) — **di trú bảng phiên**, không phải sửa cấu hình | *"Nhân viên mua hàng của anh có sẵn sàng cài một ứng dụng TOTP (Google/Microsoft Authenticator) không, hay công ty đã có đăng nhập một lần (SSO)?"* |

## C. Về QUY TRÌNH

| # | Tiền đề | Nằm ở đâu | Sai thì mất gì | Câu hỏi |
|---|---|---|---|---|
| **C1** | **Một giờ** là sàn hợp lý cho cửa sổ thầu | `011` `CUA_SO_TOI_THIEU := interval '1 hour'` | Sàn CỦA HỆ, không phải chính sách tổ chức. Nếu thực tế mua gấp cần 20 phút, sàn này **chặn nghiệp vụ thật** | *"Lần gấp nhất anh từng cho nhà cung cấp bao lâu để báo giá?"* |
| **C2** | Sửa hạng mục sau khi đã nộp duyệt là **bất thường** | `011` `rfq_items_chi_sua_khi_soan` (chỉ DRAFT) | Nếu sửa-rồi-duyệt-lại là **nhịp làm việc bình thường**, cạnh `PENDING_APPROVAL → DRAFT` bị đi lại liên tục và băm nội dung huỷ chữ ký mỗi lần | *"Sau khi gửi duyệt, danh sách hàng có hay bị sửa không?"* |
| **C3** | Gia hạn deadline là **hiếm**, nên chưa cần ghi ai gia hạn | `016` §(3); `extendRfqDeadline` không có cột ký tên | Nếu gia hạn là thường xuyên, *"đã bị đẩy mấy lần, bởi ai"* trở thành câu hỏi kiểm toán chính — và hôm nay chỉ sổ kiểm toán trả lời được | *"RFQ có hay bị lùi hạn không? Ai quyết việc đó?"* |
| **C4** | **VND và USD** đủ cho S1 | `014` `CHECK (currency IN ('VND','USD'))` | Một tổ chức mua bằng JPY/CNY/EUR không tạo được chính sách. `CHECK` chặn ở tầng CSDL ⇒ cần migration mới | *"Anh có mua hàng thanh toán bằng ngoại tệ nào ngoài đô không?"* |
| **C5** | **Level 0/1 đủ**; hồ sơ nhà cung cấp dùng chung (Level 2) chưa cần | ADR-013 mục 4; `008` `CHECK (level IN (0,1))` | Nếu người mua muốn *"nhà cung cấp này đã làm với công ty khác chưa"*, câu hỏi oracle xuyên tổ chức mà ADR-013 dành trọn một ADR để chặn **quay lại như một yêu cầu sản phẩm** | *"Anh có muốn thấy nhà cung cấp này đã bán cho ai khác trên hệ thống không?"* |

## D. Về TRIỂN KHAI

| # | Tiền đề | Nằm ở đâu | Sai thì mất gì | Câu hỏi |
|---|---|---|---|---|
| **D1** | Khách hàng **chấp nhận khoá nằm ở AWS KMS Singapore** | ADR-009 §*Khi nào phải MỞ LẠI* | ADR-009 tự liệt kê ba điều kiện lật ngược: chủ quyền dữ liệu trong nước, khách FDI đã chuẩn hoá Azure, yêu cầu đa đám mây. **Đổi KMS sau khi có khoá thật là một cuộc di trú** | *"Dữ liệu và khoá mã hoá có buộc phải nằm trong lãnh thổ Việt Nam không?"* |
| **D2** | Kiểm chứng biên nhận diễn ra **trong trình duyệt** của nhà cung cấp | ADR-011 mục 2 | `Ed25519` chỉ vào WebCrypto ở **Chrome 137**. Nếu kiểm chứng phải chạy trong trình duyệt máy cũ, ứng viên đầu của B2 kế thừa đúng vấn đề đuôi mà mục 1 vừa gỡ | *"Khi cần chứng minh 'tôi đã nộp lúc 15:42', nhà cung cấp của anh sẽ tự kiểm hay nhờ ai kiểm?"* |

## E. Về DỮ LIỆU — S4 **[S1.159]**

Suy từ spec S4 (`docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md`) sau lượt soi hình dạng. Chưa
dòng mã nào của S4, nên *"nằm ở đâu"* trỏ vào mục spec mà mã sắp cư xử theo.

| # | Tiền đề | Nằm ở đâu | Sai thì mất gì | Câu hỏi |
|---|---|---|---|---|
| **E1** | Tổ chức có **một người quản lý dữ liệu** không tạo gói, không mời, không xem giá, và đủ thời gian duyệt hàng đợi | Spec S4 §2.4 ⑺ — vai `DATA_STEWARD`; ADR-097 | Tổ chức nhỏ không có người ấy thì không dùng được S4a — nhân lên từ B4 | *"Ở công ty anh, ai giữ danh mục vật tư, và người ấy có xem giá báo không?"* |
| **E2** | Mô tả hạng mục **đủ thông tin để trích thuộc tính** — quy cách, hãng, kích thước | Spec S4 §4.4 bước 3; luật trích là hằng trong mã, thiên về thép | Hàng đợi đầy, `TU_DONG` hiếm; thêm luật cho một nhóm hàng mới là một lần deploy | *"Anh viết tên hàng trên phiếu yêu cầu thế nào — có mã vật tư, quy cách, hãng không?"* |
| **E3** | Nhà cung cấp **chịu khai tách** phí vận chuyển, chi phí nhập khẩu, kỳ thanh toán, thời gian giao | Spec S4 §4.8; ô đã bật là bắt buộc | Bật mã nào là mất nhà cung cấp — trái PRODUCT §8 ⑴ | *"Nhà cung cấp của anh có tách phí vận chuyển khỏi đơn giá không, hay luôn gộp?"* |
| **E4** | Cùng một mặt hàng **được mua lại** ≥ 3 gói, từ ≥ 3 nhà cung cấp, trong 12 tháng | Spec S4 §4.6, §2.4 ⑾ | Mọi dòng hiện *"chưa đủ lịch sử"*; benchmark nội bộ không bao giờ ra nhãn | *"Trong một năm anh mua lại cùng một mặt hàng bao nhiêu lần, từ bao nhiêu nơi?"* |
| **E5** | Giá **từng dòng** nhà cung cấp khai là giá thật của dòng ấy — không dồn giá | Spec S4 §8.4 | Lịch sử theo dòng méo; tổng vẫn đúng nên không ai thấy | *"Nhà cung cấp có hay dồn giá vào vài dòng để tổng không đổi không?"* |
| **E6** | Bên mua có **mốc giá ngoài** và **lịch sử PO xuất được** — Excel hay ERP — trích dẫn được nguồn | Spec S4 §4.7, §2.4 ⑽; ADR-096 | S4a không có phép so nào từ ngày đầu | *"Anh có bảng giá tham khảo, hay lịch sử đơn mua xuất ra Excel được không?"* |
| **E7** | Phân tích tỷ lệ chọn nhà cung cấp của **từng nhân viên** là hợp pháp và được người lao động biết | Spec S4 §8.7, §4.9 — chủ: chủ dự án. **[S1.161]** Spec S4b §2.4 ㉖: cả F2a | ~~S4b.4~~ **[S1.161]** S4b.5 — phân tích người mua và F2a — không làm được, hoặc làm được mà vi phạm | *"Nhân viên mua hàng của anh có biết và đồng ý việc phân tích tỷ lệ chọn nhà cung cấp của từng người không?"* |

**[S1.161]** Sáu dòng dưới suy từ spec S4b (`docs/superpowers/specs/2026-09-26-trustprocure-s4b-tri-tue-mua-sam.md`) sau
lượt soi hình dạng; góc D⑪ của biên bản §S1.161.

| # | Tiền đề | Nằm ở đâu | Sai thì mất gì | Câu hỏi |
|---|---|---|---|---|
| **E8** | Tổ chức có ≥ (số chữ ký của bậc + 1) người giữ quyền duyệt trao ngoài người đề xuất — ba ở bậc 2 — và họ chịu đăng nhập lại cho mỗi lần trao có yếu tố đỏ | Spec S4b §5.2, §2.5 ㉞ | Tổ chức đã bật S3 không trao được gói bậc 2; nhân lên từ B4 | *"Ở công ty anh, bao nhiêu người được duyệt trao thầu, và họ có chịu đăng nhập lại mỗi lần duyệt không?"* |
| **E9** | Nhà cung cấp trung thực không nộp dồn sát hạn | Spec S4b F5 — không sàn lịch sử; `docs/TEST-PLAN.md:245` lại coi 200 nhà cung cấp nộp trong 60 giây cuối là tải bình thường | F5 báo sai trên mọi gói, và chốt thành thủ tục | *"Nhà cung cấp của anh thường nộp báo giá lúc nào — sát hạn hay sớm?"* |
| **E10** | Một nhóm nhà cung cấp cùng dự ≥ 6 gói (F1) và ≥ 9 gói (F2b) trong 12 tháng | Spec S4b §4.1 F1, F2b | Yếu tố chuỗi mãi `CHUA_DU_LICH_SU`; S4b.1 nổ ở mọi lần trao, mãi mãi | *"Một nhóm nhà cung cấp quen của anh cùng dự bao nhiêu gói một năm?"* |
| **E11** | *"Khoảng cách thắng–nhì ổn định nghĩa là thông đồng"* (ADR-058 ⑸) đúng ở thị trường này, và biên của cạnh tranh thật nằm ngoài ngưỡng tuyệt đối của F1 (1%, 0,5 điểm) | Spec S4b §2.5 ㊻; phép mô phỏng M2 dùng phân phối GIẢ ĐỊNH | F1 báo sai trên cạnh tranh thật, hoặc mù | *"Khi anh nhận ba báo giá thật cho cùng một hàng, giá thứ hai thường cao hơn giá thấp nhất bao nhiêu phần trăm?"* |
| **E12** | Khách chịu ma sát S4b.1 ở MỌI lần trao suốt ít nhất sáu tháng đầu | Spec S4b §2.5 ㉚ — độ phủ tối đa 27% trước S4b.2 | Công tắc ADR-080 một chiều nên không tắt được; khách rời bỏ thay vì tắt | *"Nếu nửa năm đầu mỗi lần duyệt trao cần thêm một người ký xác nhận đã đọc cảnh báo, anh có chấp nhận không?"* |
| **E13** | Mỗi nhà cung cấp được mời ≥ 5 gói trong 12 tháng | Spec S4b §7 — sàn Supplier Score. **[S1.162]** Supplier Score hoãn tới S5 (ADR-100): dòng này chờ spec S5 | Supplier Score mãi *"chưa đủ lịch sử"* | *"Một nhà cung cấp quen được mời bao nhiêu gói mỗi năm?"* |
| **E14** **[S1.162]** | Tổ chức có **một người kiểm toán** không mua, không duyệt, không xem giá, và đủ thời gian đọc sổ tín hiệu | Spec S4b §2.7 Q2 — vai `AUDITOR`; ADR-100 | Không ai đọc sổ tín hiệu và phân tích người mua; hai màn ấy thành công cụ không người dùng — nhân lên từ B4 và E1 | *"Công ty anh có ai kiểm tra việc mua hàng mà không trực tiếp mua hay duyệt không — kiểm soát nội bộ, kiểm toán nội bộ?"* |

---

## Ba dòng nặng nhất, nếu chỉ hỏi được ba câu

**B4 → A1 → B1.**

- **B4** vì nếu tổ chức chỉ có một người mua thì **D3 không phải một lớp bảo vệ, nó là một cửa
  khoá không mở được** — và đó là thứ giết chết việc dùng thử ngay trong tuần đầu.
- **A1** vì nó là **điều kiện cần** của cả đường nộp thầu: không số điện thoại ⇒ không OTP ⇒
  không phiên khách ⇒ không báo giá. Cả S1.3 đứng trên nó.
- **B1** vì nếu ngưỡng phê duyệt không phải **một con số cho cả tổ chức**, thì `014` sai **hình
  dạng**, không sai giá trị — và sai hình dạng thì không sửa được bằng cấu hình.

## Cái này KHÔNG đóng

- **Không đóng điểm chặn 1** (*chưa có khách hàng pilot*) ở `docs/STATE.md`. Nó **hạ chi phí** của
  việc gỡ điểm chặn ấy, không gỡ hộ.
- **Không có dòng nào ở đây được kiểm chứng.** Toàn bộ file là một danh sách câu hỏi. Ngày nào có
  dòng đầu tiên mang tên người và ngày, dòng ấy chuyển sang `docs/DECISIONS.md` dưới dạng một ADR
  hoặc một sửa đổi ADR — **không** ở lại đây dưới dạng một dấu tích.
- **Danh sách này chưa chắc đủ.** Nó suy từ mã đã viết (S1.1–S1.3; B6 thêm 2026-09-06 từ ADR-020), nên nó mù với mọi tiền đề của
  S1.4–S1.9 chưa tồn tại. Bổ sung khi mỗi hạng mục mới ra đời là một phần của vòng lặp, không phải
  một việc riêng.

# Buổi bậc 1 — sáu mươi phút đi thử có hướng dẫn với một người mua thật

> **Ngày:** 2026-09-27 · **Vòng:** S1.173 · **Bậc:** 1 của thang ở `docs/superpowers/plans/2026-09-26-pilot-gia-lap.md` §7
> — thang ấy vẫn là **ĐỀ XUẤT, chưa được chọn** (ADR-101).
>
> Tệp này là thứ người trình diễn cầm theo: việc phải xong trước ngày gặp, chương trình sáu mươi phút, các câu hỏi, phiếu
> ghi câu trả lời, những câu không được nói, và việc phải làm trong hai mươi bốn giờ sau buổi gặp. Nó **không** chép lại
> kịch bản trình diễn hay danh sách tiền đề: hai thứ ấy có nguồn riêng, và tệp này trỏ về nguồn.
>
> **Khách cam kết:** 60 phút của một trưởng phòng mua hàng. **Đo được:** câu trả lời có TÊN và NGÀY cho B4, A1, B1.
> **Điều kiện ra:** khách đồng ý đưa 3–5 gói đã đóng cho bậc 2. Không có gì khác được coi là đã qua bậc 1.

---

## 0. Buổi này KHÔNG phải cái gì

- **Không phải pilot, và không gỡ điểm chặn 1** (*chưa có khách hàng pilot*, `docs/STATE.md`). Nó là bậc 1 trong năm
  bậc; điểm chặn chỉ gỡ ở bậc 4.
- **Không dùng dữ liệu của khách.** Mọi tổ chức, người, nhà cung cấp và mức giá trên màn hình là bịa. Dữ liệu thật của
  khách chỉ vào từ bậc 2, và bậc 2 có điều kiện riêng (mục 6).
- **Không cài gì ở chỗ khách.** Cụm chạy trên máy người trình diễn, nghe ở `127.0.0.1`.

## 1. Trước ngày gặp — một lần, trên chính máy sẽ mang theo

Nguồn của từng mục: kế hoạch pilot giả lập §4.

- [ ] **Node dòng 22, từ 22.13** (bản mới nhất của dòng 22 là tốt nhất — cùng dòng với CI và ảnh deploy). **Không dùng
  Node 26**: từ bản ấy, không script nào của kho chạy. Công cụ tự từ chối các bản làm trang `web` chết.
- [ ] `pnpm install` ở gốc kho.
- [ ] **Docker Desktop đã chạy**, rồi chạy trọn khối lệnh PowerShell của kế hoạch §4 **một lần trên chính máy này**.
  Khối ấy đã đo trên PowerShell 7 cho Linux, ~~**chưa ai đo trên Windows PowerShell 5.1 và Docker Desktop**~~ **[S1.255] và
  trên một máy Windows 11 (Windows PowerShell 5.1, Docker Desktop 29.7.2): chưa có container, container đang chạy, container
  đã dừng — cả ba 10/10** (kế hoạch §4). Đường dẫn và ACL vẫn là của từng máy, nên vẫn chạy một lần trên CHÍNH máy này. Lỗi
  lộ ra ở bước này thì sửa trước ngày gặp, không phải trong phòng họp.
- [ ] **[S1.255] Máy có nhiều tài khoản Windows:** chạy `icacls` trên thư mục kho. Thấy `Users` hay `Authenticated Users`
  thì tài khoản khác trên máy đọc được `cum.json`, bí mật TOTP của người mua giả lập (`trang-thai.json`) và link đăng nhập
  còn hạn trong `hop-thu/` — đặt kho dưới `C:\Users\<tên>\` (mặc định chỉ chủ hồ sơ đọc được), hay thêm
  `--thu-muc "$env:USERPROFILE\.pilot-gia-lap"` vào MỌI lệnh `pnpm pilot:gia-lap`. Công cụ không tự cảnh báo (khoản 328).
- [ ] Đi thử một lượt kịch bản §5 của kế hoạch, bấm đủ các nút, để biết mỗi màn mất bao lâu trên máy này.
- [ ] In mục 4 của tệp này — hai bản: một cho người hỏi, một để trống ghi tay.

## 2. Trong ngày gặp, hoặc hôm trước

- [ ] Dừng cụm cũ nếu còn chạy (Ctrl+C), rồi chạy **một lượt mới bằng trọn khối PowerShell của kế hoạch §4** — không phải
  `pnpm pilot:gia-lap` trơn. Một cửa sổ mới chưa có biến `TRUSTPROCURE_SEED_DATABASE_URL`, và sau khi khởi động lại máy thì
  container Postgres đã dừng; khối ấy bật lại container, đợi Postgres, đặt biến rồi mới gọi công cụ. Hạn nộp của gói SX-04
  tính từ lượt chạy và hết sau ba ngày; buổi gặp cách lượt chạy hơn hai ngày thì cần lượt mới, không phải `cum`. Công cụ
  tự cảnh báo khi lượt đã quá hai ngày.
- [ ] Ghi lại ba mã gói in ở cuối lượt: **SX-04**, **XD-03**, **XD-04**.
- [ ] Mở sẵn `bao-cao-moi-nhat.md` trong thư mục trạng thái.
- [ ] Thử một lần `pnpm pilot:gia-lap lien-ket` và `pnpm pilot:gia-lap dang-nhap hung.nv@…`, để chắc cụm đang chạy.
  **[S1.255]** `dang-nhap` cần email đầy đủ (`hung.nv@tan-phu-minh.gia-lap.invalid`); gõ thiếu thì lời từ chối liệt kê mọi
  email của các lượt. Mỗi lần gọi phát một link mới — gọi lại chỉ để lấy mã TOTP thì link cũ vẫn còn hạn 15 phút.
- [ ] Để cửa sổ trình duyệt ở khung hẹp cho phần nhà cung cấp: điện thoại thật chưa dùng được, vì nó cần HTTPS (kế hoạch
  §9 mục 4).

## 3. Chương trình sáu mươi phút

| Phút | Việc | Ghi chú |
|---|---|---|
| 0–5 | Mở đầu. Nói thẳng: đây là **dữ liệu giả lập**, không phải khách hàng thật; buổi này để hỏi ba câu, và câu trả lời sẽ quyết phần mềm đi tiếp thế nào | Chỉ vào nhãn GIẢ LẬP và mục 7 *"Điều báo cáo này KHÔNG chứng minh"* của báo cáo |
| 5–25 | Trình diễn các hàng **2–7 tới 13–17** của kịch bản ở **kế hoạch §5** (SX-04 nộp thầu → SX-04 số báo giá bị giấu → XD-03 → XD-04), từng bước và từng nút như ở đó. Hàng 0–2 đã làm ở phút 0–5; hàng 17–20 là phút 25–45 dưới đây. Phút dư dành cho câu hỏi của khách về màn hình | **Lần tự duyệt phải đi TRƯỚC lần duyệt thật** ở XD-03 và XD-04 — ngược lại thì trang chặn nút ngay trên trình duyệt, và khách không thấy cổng quyền chặn gì. **[S1.255]** Ở bước 7 của XD-04, cả hai người bấm **Đọc đề xuất** trước **Phê duyệt**: chưa đọc thì lần bấm **Phê duyệt** đầu chỉ hiện đề xuất và câu *"Đề xuất sắp ký hiện ở dưới — … bấm Phê duyệt lần nữa để ký"*, chưa tới cổng quyền |
| 25–45 | **Ba câu nặng nhất: B4 → A1 → B1** (mục 4.1). Ghi vào phiếu ngay khi khách nói | Hỏi đúng câu, không gợi ý câu trả lời |
| 45–55 | Các câu thêm nếu còn giờ (mục 4.2), theo thứ tự ghi ở đó | Bỏ được; ba câu ở trên thì không |
| 55–60 | **Câu hỏi của bậc 2** (mục 4.3) | Đây là điều kiện ra của buổi này |

## 4. Câu hỏi và phiếu ghi

Quy ước 2 của `docs/TIEN-DE-CHUA-DO.md` áp cho mọi câu dưới đây: **một câu trả lời không có TÊN NGƯỜI và NGÀY thì
không được tính**. *"Có vẻ hợp lý"* hay *"ai cũng làm thế"* không đủ. Câu hỏi chép nguyên văn từ tệp ấy; cột *"Vì sao
quan trọng"* tóm dòng *"Sai thì mất gì"* của cùng tệp.

Mỗi câu ghi đủ năm ô: **người trả lời** (họ tên), **chức vụ**, **ngày**, **câu trả lời nguyên văn**, và **ghi chú của
người hỏi** (khách lưỡng lự, hay đổi ý, hay nói *"tuỳ trường hợp"*).

### 4.1 Ba câu bắt buộc

| # | Câu hỏi | Vì sao quan trọng | Câu trả lời nào là tín hiệu đỏ |
|---|---|---|---|
| **B4** | *"Ở công ty anh, người tạo yêu cầu mua và người duyệt có phải hai người khác nhau không?"* | Tách bạch nhiệm vụ (D3) cần người tạo khác hai người duyệt. Chỉ có một người mua thì D3 không phải lớp bảo vệ mà là **một cửa khoá không mở được** — dùng thử chết ngay tuần đầu | *"Một mình tôi làm hết"*; *"sếp duyệt miệng"*. Hỏi thêm: tổng cộng bao nhiêu người đụng vào một gói, kể cả người duyệt |
| **A1** | *"Khi anh mời một nhà cung cấp mới, anh có số di động của đúng người phụ trách báo giá không, hay chỉ có email công ty?"* | Không số điện thoại ⇒ không OTP ⇒ không phiên nhà cung cấp ⇒ không báo giá. Cả đường nộp thầu đứng trên câu này | *"Chỉ có email"*; *"số tổng đài công ty"* |
| **B1** | *"Trên bao nhiêu tiền thì cần hai người duyệt? Con số đó có khác nhau theo loại hàng không?"* | Mã giữ **một** ngưỡng cho cả tổ chức. Nếu ngưỡng khác theo loại hàng thì mã sai **hình dạng**, không sai giá trị — và sai hình dạng thì không sửa được bằng cấu hình | *"Tuỳ loại hàng"*; *"tuỳ dự án"*; nhiều hơn một con số |

### 4.2 Câu thêm, nếu còn giờ — theo thứ tự này

| # | Câu hỏi | Vì sao quan trọng |
|---|---|---|
| **D1** | *"Dữ liệu và khoá mã hoá có buộc phải nằm trong lãnh thổ Việt Nam không?"* | Khoá đặt ở AWS KMS Singapore (ADR-009). Khách đòi khoá ở Việt Nam **bằng văn bản** là điều kiện thứ nhất buộc mở lại ADR-009, và đổi KMS sau khi đã có khoá thật là một cuộc di trú. Hỏi thêm hai điều kiện còn lại của ADR ấy: công ty đã chuẩn hoá trên Azure **và đòi khoá nằm trong tenant của họ** không, và hợp đồng có đòi nhiều đám mây không |
| **Lưu hồ sơ** | *"Hồ sơ đấu thầu của công ty phải lưu bao lâu?"* | Chưa có dòng nào ở `TIEN-DE-CHUA-DO.md` cho câu này. Nguồn là ADR-062: bucket neo sổ kiểm toán khoá Object Lock chế độ Compliance **365 ngày** — tăng được về sau, không giảm được — và ADR ấy ghi phải đối chiếu với yêu cầu lưu hồ sơ của khách pilot. Câu này hỏi thời hạn khách cần; thời hạn lưu của chính dữ liệu gói thầu thì kho chưa khai |
| **B6** | *"Nhân viên mua hàng của anh có sẵn sàng cài một ứng dụng TOTP (Google/Microsoft Authenticator) không, hay công ty đã có đăng nhập một lần (SSO)?"* | Đổi sang SSO về sau là di trú bảng phiên |
| **C1** | *"Lần gấp nhất anh từng cho nhà cung cấp bao lâu để báo giá?"* | Cửa sổ nộp tối thiểu là **một giờ**, là sàn của hệ thống chứ không phải chính sách của tổ chức: một lần mua gấp 20 phút bị chặn |
| **A3** | *"Nhà cung cấp của anh mở link bằng gì — Zalo, Messenger, hay trình duyệt?"* | Đã đo ĐẠT, kể cả `X25519`: WKWebView iOS 18.7 (Zalo), iOS 26.6.1, và Android System WebView 151 (Zalo, Messenger trên Galaxy A02s, Android 12) — ADR-031. Chưa đo WebView tụt lại nhiều phiên bản và iOS ≤ 16 |
| **A5** | *"Có bao giờ một người nhận email rồi chuyển cho đồng nghiệp làm báo giá không?"* | Mã giả định người giữ kênh liên lạc và người ngồi trước màn hình là một |
| **C2** | *"Sau khi gửi duyệt, danh sách hàng có hay bị sửa không?"* | Mỗi lần sửa sau khi gửi duyệt làm mất chữ ký đã có. Sửa là nhịp thường ngày thì gói đi lại vòng duyệt liên tục |

### 4.3 Câu hỏi của bậc 2 — điều kiện ra

*"Anh có thể đưa 3–5 gói ĐÃ ĐÓNG của công ty — đã xoá tên nhà cung cấp — để chúng tôi chạy lại trên phần mềm trong hai
tuần, dưới một thoả thuận bảo mật, dữ liệu chỉ ở máy của dự án và xoá khi xong không?"*

Ghi đủ năm ô như trên. Khách đồng ý thì hỏi thêm: gói thường có **bao nhiêu hạng mục**, mời **bao nhiêu nhà cung cấp**,
và họ lưu gói ở dạng gì (Excel, giấy, phần mềm khác). Đó là thứ bậc 2 sẽ đo, và là đầu vào cho việc nhập gói từ tệp.

## 5. Không được nói — kể cả khi khách hỏi thẳng

Nguồn: `docs/PRODUCT.md` §5 *"Những điều KHÔNG được tuyên bố"*. Luật ấy áp cho lời nói trong buổi gặp y như cho tài liệu
tiếp thị. Năm câu dễ bật ra nhất khi trình diễn:

| Không nói | Nói thay |
|---|---|
| *"Kể cả chúng tôi cũng không xem được giá"* | *"Mọi lần truy cập đều để lại dấu vết không sửa được"*. Người vận hành về kỹ thuật vẫn giải mã được, nên câu bên trái là tuyên bố sai sự thật |
| *"Hai người ký thì không ai trao thầu cho người quen được"* | Người đề xuất trao thầu phải khác người tạo gói, người điều phối mở thầu và người duyệt. Không lớp nào của phần mềm chặn được hai người bàn nhau ngoài hệ thống |
| *"Chống được thông đồng"* | *"Làm việc móc nối đắt hơn và để lại dấu đọc được"* |
| *"Vòng BAFO giữ kín giá của bạn với người mua"* | Báo giá được niêm phong lại và chỉ mở qua cổng bốn vế. Một câu nói miệng như *"anh đang thứ hai, hạ 3% là thắng"* thì không phần mềm nào chặn được |
| *"Triệt tiêu hoàn toàn gian lận"* | *"Giảm khả năng can thiệp vào báo giá"* |

Khách hỏi một điều chưa có câu trả lời trong kho thì nói *"chưa biết, sẽ trả lời bằng văn bản"*, rồi ghi câu hỏi vào
phiếu. Một câu hứa trong phòng họp là một lời khai không có địa chỉ trong mã.

## 6. Trong hai mươi bốn giờ sau buổi gặp

1. **Mỗi câu trả lời có tên và ngày chuyển vào `docs/DECISIONS.md`** thành một ADR hay một sửa đổi ADR — không ở lại
   `TIEN-DE-CHUA-DO.md` dưới dạng một dấu tích (mục *"Cái này KHÔNG đóng"* của tệp ấy). Dòng tiền đề tương ứng trỏ sang
   ADR ấy.
2. **Câu trả lời lệch tiền đề là đầu vào của vòng mã kế tiếp chạm chỗ ấy**, không phải một ghi chú. B1 ra *"tuỳ loại
   hàng"* hay B4 ra *"một người"* chạm thẳng vào hình dạng của S3; báo cho vòng S3 đang chạy trước khi nó đi tiếp.
3. **Khách đồng ý bậc 2** thì ba việc phải có **trước** buổi bậc 2, và cả ba hôm nay chưa có:
   - **thoả thuận bảo mật** — kho chưa có mẫu nào;
   - **quyết định về luật "người thứ hai trước dữ liệu thật" của ADR-062** cho một máy dev: luật ấy nói về prod, và kế
     hoạch §7 ghi rõ chủ dự án phải quyết **trước** buổi bậc 2, không sau;
   - **nhập gói từ tệp của khách** (CSV): công cụ hôm nay chỉ chạy hồ sơ dựng sẵn.
4. **Khách từ chối bậc 2** thì ghi lý do nguyên văn, có tên và ngày. Một lời từ chối có lý do cũng là một câu trả lời cho
   thang bậc: nó nói bậc 2 đòi quá nhiều ở chỗ nào.

# Nhật ký đo — WebCrypto trên thiết bị thật

> Mỗi dòng là **một lần chạy `index.html` trên một thiết bị thật**, dán từ nút "Chép kết quả".
> Bảng này tồn tại để trả lời đúng một câu hỏi: **rủi ro số 2 đã đóng chưa?**
>
> **Chưa.** Nhưng nó đã hẹp lại đáng kể, và nó đã đổi hình. Xem §2 và §3.

---

## 1. Đã đo

| # | Ngày | Thiết bị / ứng dụng | Engine | Ngữ cảnh | X25519 | Phán quyết |
|---|---|---|---|---|---|---|
| 1 | 2026-08-29 | Chrome 148, Windows desktop | Chromium 148 | `http://localhost` | ĐẠT | Nộp thầu được |
| 2 | 2026-08-29 | Edge 151, Windows desktop | Chromium 151 | `https:` | ĐẠT | Nộp thầu được |
| 3 | 2026-08-29 | **Zalo iOS** (`Zalo iOS/260801802`), iPhone | **WKWebView, iOS 18.7** | `https:` | **ĐẠT** | **Nộp thầu được** |
| 4 | 2026-09-08 | **Chrome iOS** (`CriOS/151.0.7922.112`), iPhone | **WKWebView, iOS 26.6.1** | `https:` | **ĐẠT** | **Nộp thầu được** |
| **5** | 2026-09-08 | **Zalo Android** (`Zalo android/260802903`), Samsung **SM-A025F** (Galaxy A02s), **Android 12** | **Android System WebView, Chromium 151.0.7922.200** | `https:` | **ĐẠT** | **Nộp thầu được** |
| **6** | 2026-09-08 | **Messenger Android** (`FB_IAB/FB4A;FBAV/577.0.0.49.89`), **cùng máy** SM-A025F, Android 12 | **Android System WebView, Chromium 151.0.7922.200** — *cùng build với dòng 5* | `https:` | **ĐẠT** | **Nộp thầu được** |

Lần 1 còn chạy thêm ~~**ba đột biến** (`?dot=x25519|aes|rnd`) và cho **bốn phán quyết phân biệt
được**~~ — đó là phép đo chứng minh **máy dò có răng**, không phải phép đo về thiết bị.

**[2026-09-08] NAY LÀ BỐN ĐỘT BIẾN VÀ NĂM PHÁN QUYẾT, và mũi thứ tư nói về một lỗ của CHÍNH MÁY
DÒ.** Bản trước không phân biệt được *"thiết bị này thiếu WebCrypto"* với *"cái link không phải
https"*: ngoài ngữ cảnh bảo mật, `crypto.subtle` **không tồn tại** dù engine hỗ trợ đầy đủ, và
trang phán **"KHÔNG nộp thầu được trên trình duyệt này"** — một câu về **cái link**, mang hình
dạng một câu về **cái máy**. Chép một dòng như thế vào §1 là đặt một lời khai sai vào đúng chỗ
đang cần sự thật, và không ai kiểm lại được vì thiết bị đã đi khỏi. Nay có phán quyết thứ năm —
**"PHÉP ĐO HỎNG — link này không phải https"**, màu lam thép, cố ý **không** thuộc ba họ màu ngữ
nghĩa — và mũi `?dot=ngucanh` chứng minh nó phân biệt được. Đo trên Chromium 2026-09-08: năm URL
cho **năm** thẻ khác nhau, ba mũi cũ không đổi nghĩa.

**Dòng 3 là phép đo có giá trị nhất trong bảng.** Nó là lần đầu máy dò chạy **bên trong một
webview thật của thị trường Việt Nam**, và nó bác bỏ được giả thuyết xấu nhất: *"webview Zalo
không có `crypto.subtle`"*. Trên đường đi này, **cả `crypto.subtle` lẫn `X25519` đều có**.

**[2026-09-08] Dòng 4 KHÔNG lấp ô nào ở §3, và điều đó phải nói trước khi nói nó ĐẠT.** Nó nới
đường iOS lên **phía trên** — WebKit của iOS 26.6.1 vẫn có `X25519`, nên rủi ro *"một bản WebKit
nào đó đánh rơi X25519"* không hiện ra ở đầu mới. Nhưng ô ưu tiên **2** của §3 hỏi về đầu **CŨ**
(iOS ≤ 16), và một phép đo ở đầu mới **không nói gì** về đầu cũ. Ô ưu tiên 1 và 3 là Android, và
dòng 4 không phải Android.

**[2026-09-08] DÒNG 5 ĐIỀN Ô ƯU TIÊN 1 — phép đo Android đầu tiên của dự án — VÀ NÓ KHÔNG ĐO ĐƯỢC
CHÍNH ĐIỀU Ô ẤY NGHI.** Máy đúng phân khúc mà ô mô tả: **Galaxy A02s**, máy phổ thông giá rẻ, hệ
điều hành dừng ở **Android 12**. Đường nộp thầu chạy **nguyên vẹn**, `X25519` **ĐẠT**. Nhưng đọc
tiếp `UA:` thì thấy **System WebView của nó là Chromium 151** — tức **mới**, không tụt một phiên
bản nào. Đó chính là cơ chế §2 đã mô tả: WebView đi theo **Play Store**, không theo tuổi máy.

Nên phải tách hai câu, và chỉ câu thứ nhất là phép đo:

- **Bác được:** *"webview Zalo trên Android thiếu `crypto.subtle` hoặc thiếu `X25519`"* — sai, ở
  **WebView 151**. Và nó bác luôn một suy diễn dễ mắc hơn: *"máy rẻ đời cũ thì đường Android tự
  khắc là đường yếu"* — không, vì thứ quyết định là **bản WebView**, không phải tuổi máy.
- **KHÔNG đo được:** chế độ mà ô ưu tiên 1 thật sự nghi — một máy có **WebView tụt lại nhiều
  phiên bản** (chủ máy không cập nhật, hoặc máy bị chặn Play Store). Dòng 5 không có mẫu nào ở
  chế độ ấy, nên nó **không** nói gì về chế độ ấy.

Đây đúng hình dạng bài học của khoản nợ 58 (S1.16): **một phép đo ở MỘT chế độ không phải một kết
luận cho MỌI chế độ.** Ghi *"Android: ĐẠT"* mà không kèm **WebView 151** là một câu rộng hơn phép
đo — đúng như §2 đã nói về *"Zalo iOS"* mà không kèm **iOS 18.7**.

**[2026-09-08] DÒNG 6 ĐIỀN Ô ƯU TIÊN 3, VÀ NÓ BÁC GIẢ ĐỊNH ĐÃ SINH RA CHÍNH Ô ẤY.** Ô 3 tồn tại
vì một điều nghi: *"Messenger có thể nhúng webview riêng thay vì dùng System WebView"*. Trên máy
này thì **không**: dòng 5 và dòng 6 báo **cùng một chuỗi build — `Chrome/151.0.7922.200`** — tức
hai ứng dụng **mượn cùng một Android System WebView**. Đây là lần thứ hai bảng này thu hai ô về
một phép đo, y như dòng 3 đã phủ luôn Messenger iOS: **trục đúng là engine, không phải tên ứng
dụng.** Giả định ấy nay đã được **đo** ở cả hai hệ điều hành chứ không còn là suy luận.

**Và dòng 6 dạy một điều về cách ĐỌC `UA:` mà lẽ ra tôi đã đọc sai.** UA của Messenger có token
`wv` — dấu hiệu kinh điển của Android WebView. UA của Zalo ở dòng 5 **không có** `wv`, dù nó cũng
là WebView và cùng build. Nghĩa là **`wv` không phải chỗ để nhận dạng**: một ứng dụng sửa được
chuỗi UA của webview mình nhúng (Zalo còn nối thêm `Zalo android/...`, `ZaloTheme/`,
`ZaloLanguage/`). Thứ đáng tin là **chuỗi build Chromium** cộng **token định danh ứng dụng** — hai
thứ khớp nhau giữa hai dòng thì mới kết luận được là cùng engine.

**Dòng 4 còn dạy một quy tắc về chính cách thu kết quả, và nó suýt làm hỏng một dòng trong bảng
này.** Kết quả đến kèm một **ảnh chụp máy Android** (thanh điều hướng ba nút, thanh công cụ Chrome
kiểu Android) trong khi **khối văn bản dán về lại mang `UA:` của một iPhone** — clipboard đồng bộ
giữa hai máy là đủ để hai thứ lệch nhau mà không ai cố ý. Thứ phân xử là `UA:`, vì nó do **chính
lượt chạy ấy** sinh ra; ảnh chụp thẻ phán quyết **không định danh engine** và không bao giờ đủ để
điền một dòng. Quy tắc: **một dòng ở §1 chỉ được điền từ khối văn bản, và engine đọc từ `UA:`, kể
cả khi người gửi đã nói rõ mình đang cầm máy nào.**

---

## 2. Điều dòng 3 vừa làm lộ ra: bảng này đang phân loại theo TRỤC SAI

Bản đầu của tài liệu này liệt kê bốn ô còn trống theo **tên ứng dụng**: Zalo/Android,
Zalo/iOS, Messenger/Android, Messenger/iOS. **Cách chia đó sai**, và dòng 3 cho thấy vì sao.

`crypto.subtle` và `X25519` **không phải thuộc tính của Zalo hay Messenger**. Chúng là thuộc
tính của **engine mà webview mượn**:

| Ứng dụng | Webview thật ra là gì | Phiên bản do ai định đoạt |
|---|---|---|
| Zalo / Messenger **trên iOS** | `WKWebView` | **Phiên bản iOS của máy.** Ứng dụng không chọn được. Zalo và Messenger trên cùng một iPhone dùng **cùng một engine**. |
| Zalo / Messenger **trên Android** | Android System WebView | **Bản System WebView cài trên máy**, cập nhật qua Play Store — **rời** khỏi phiên bản Android. |

Hệ quả trực tiếp: **dòng 3 đã đo luôn cả Messenger trên iPhone đó.** Hai ô, một phép đo. Chúng
chưa bao giờ là hai ô độc lập; cách chia bảng cũ làm chúng trông như vậy.

Và hệ quả thứ hai, nặng hơn: **dòng 3 nói về iOS 18.7, không nói về "Zalo iOS".** Một chiếc
iPhone chạy iOS cũ hơn vẫn là "Zalo iOS" mà có thể cho kết quả khác hẳn — WebKit cũ hơn nhiều
khả năng thiếu `X25519`, trong khi `AES-GCM`, `SHA-256` và `HKDF` đã có từ rất lâu và gần như
chắc chắn vẫn còn. Ghi *"Zalo iOS: ĐẠT"* mà không kèm **iOS 18.7** là một câu **rộng hơn phép
đo**.

Vì vậy §3 dưới đây được viết lại theo trục **engine**, không theo trục **tên ứng dụng**.

---

## 3. CHƯA đo — theo trục đúng

| Ưu tiên | Cần đo | Vì sao chính nó |
|---|---|---|
| ~~**1 — cao nhất**~~ **ĐÃ ĐO 2026-09-08 → dòng 5** | ~~**Zalo trên Android**, máy tầm trung hoặc cũ~~ | ~~Android System WebView cập nhật **rời** qua Play Store và trên máy tầm trung cũ thường **tụt lại nhiều phiên bản**. Đây là ô duy nhất còn lại thật sự đáng ngờ, và cũng là phân khúc máy phổ biến nhất của nhà cung cấp nhỏ.~~ **Đo trên Galaxy A02s / Android 12 — đúng phân khúc ô này mô tả — và ĐẠT toàn bộ. Nhưng WebView của máy ấy là 151, tức KHÔNG tụt lại: vế "tụt lại nhiều phiên bản" của chính ô này vẫn CHƯA có mẫu nào.** |
| **2** | **Zalo trên iPhone chạy iOS CŨ** (16.x hoặc cũ hơn) | Dòng 3 chỉ nói về **iOS 18.7**. `X25519` vào WebCrypto muộn hơn nhiều so với `AES-GCM`; một WebKit cũ là chỗ nó vắng mặt. |
| ~~3~~ **ĐÃ ĐO 2026-09-08 → dòng 6** | ~~Messenger trên **Android**~~ | ~~Không suy ra được từ Zalo Android: Messenger có thể nhúng webview riêng thay vì dùng System WebView.~~ **Phải đo, không được suy** — và phép đo BÁC điều nghi ấy: cùng máy, cùng `Chrome/151.0.7922.200`, tức cùng System WebView. Câu "phải đo, không được suy" vẫn đúng: nếu suy, ta đã suy ra một điều SAI theo hướng ngược lại. |
| — | ~~Messenger trên iOS~~ | **Đã được dòng 3 phủ** — cùng `WKWebView`, cùng iOS 18.7. Vẫn nên chạy một lần để xác nhận giả định "cùng engine" ở trên là đúng. |

> **Không tra bảng tương thích để lấp mấy ô này.** Bảng tương thích nói về *trình duyệt*, còn
> thứ đang hỏi là *webview của một ứng dụng cụ thể trên một máy cụ thể* — và đó chính là lý do
> máy dò tồn tại. Một dòng trong bảng này chỉ được điền bằng một lần chạy thật.

---

## 3b. QUYẾT ĐỊNH HOÃN — 2026-08-29

**Ba ô ưu tiên 1–3 ở §3 được HOÃN CÓ CHỦ ĐÍCH.** Lý do: trong tay không có máy Android tầm
trung/cũ, cũng không có iPhone chạy iOS cũ. Hoãn để chuyển sang bước tiếp theo của S1.

Đây là trường hợp thứ hai mà §5 của chính tài liệu này đã dự liệu: *"hoặc khi có một quyết định
tường minh rằng phần còn lại được chấp nhận bỏ qua, và quyết định ấy được ghi ở chỗ có chữ ký."*
Ghi ở đây, và ghi thành **khoản nợ số 23** trong `docs/STATE.md`.

**Cái đang được chấp nhận, nói thẳng:** chúng ta đang xây S1.1–S1.3 trên một giả định **chưa
đo** rằng webview Android cũng có `X25519`. Giả định đó có cơ sở — nó đúng trên ba engine đã
đo — nhưng cơ sở không phải phép đo.

**Hai điều kiện của việc hoãn, và chúng là ràng buộc chứ không phải lời nhắc:**

1. **Phải đo trước khi CHỐT ADR-011** (hạng mục S1.4). Trước mốc đó, đổi thoả thuận khoá là sửa
   một dòng trong một ADR. Sau mốc đó, khi đã có phong bì thật của khách hàng thật, nó là một
   **cuộc di trú**. Mốc này cách hiện tại khoảng **10 ngày công** (S1.1 + S1.2 + S1.3), nên hoãn
   **không chặn gì** trong quãng đó — đó chính là lý do hoãn được.
2. Chừng nào ô ấy còn trống, **không tài liệu nào được viết *"đã đo `crypto.subtle` trên
   webview"* mà không kèm `iOS 18.7`**. Một câu như vậy sẽ rộng hơn phép đo.

**Giảm nhẹ — và đây là phần làm việc hoãn này trở nên RẺ, không chỉ được ghi lại.** ADR-011 phải
ghim: **phong bì mang một mã thuật toán thoả thuận khoá tường minh**, giống như `ENVELOPE_VERSION`
đã có sẵn trong `packages/crypto-keys`. Với ràng buộc ấy, nếu Android hoá ra thiếu `X25519` thì
việc phải làm là **thêm một nhánh P-256**, không phải viết lại định dạng — và phong bì cũ vẫn mở
được, đúng cùng cơ chế mà `MasterKeyRing` dùng để giữ khả năng giải mã qua các lần xoay khoá (G3).

**Cách kích hoạt lại:** hễ mượn được một máy Android tầm trung, chạy §5 và điền một dòng vào §1.
Việc này mất hai phút và không cần chuẩn bị gì.

---

## 4. Rủi ro số 2 đứng ở đâu sau ba phép đo

**Đã hẹp lại, chưa đóng.**

- Giả thuyết xấu nhất — *"webview Zalo không có `crypto.subtle`, toàn bộ đường nộp thầu của
  thị trường VN gãy"* — **đã bị bác trên đường iOS**. Đó là kết quả có giá trị thật.
- Nhưng phần iOS chỉ được chứng minh ~~**ở iOS 18.7**~~ **ở iOS 18.7 và 26.6.1** (dòng 4), và
  ~~**toàn bộ phía Android vẫn trống**~~ **[2026-09-08] phía Android đã có phép đo đầu tiên: dòng
  5, Zalo trên Galaxy A02s/Android 12, ĐẠT cả `X25519` — nhưng ở WebView 151, không phải ở một
  WebView tụt lại.**
- Nên **chưa được** phép ghi ở bất kỳ đâu rằng *"đã đo `crypto.subtle` trên webview Zalo"* mà
  không kèm hai chữ **iOS 18.7**.

**Ảnh hưởng tới S1.4:** chưa có gì buộc phải đổi. `X25519` chạy trên webview thật, nên **ADR-011
và §3.2 giữ nguyên hướng hiện tại** — nhưng quyết định đó chỉ được **chốt** sau khi ô ưu tiên 1
(Zalo Android) có kết quả; xem quyết định hoãn ở §3b. Nếu ô đó cho *"Nộp được, nhưng phải đổi
sang P-256"*, chi phí đổi lúc ấy vẫn là sửa một ADR; đổi sau khi đã có phong bì thật thì là một
cuộc di trú.

**Trạng thái hiện tại, một dòng:** rủi ro **CHƯA ĐÓNG**, **đã hoãn có điều kiện** (§3b), **không
chặn** S1.1–S1.3, và **chặn việc CHỐT** ADR-011 ở S1.4.

---

## 5. Cách thêm một dòng

0. **Link chính chủ:** <https://huubang1984.github.io/do-webcrypto/> — repo `huubang1984/do-webcrypto`
   chỉ chứa đúng một tệp là bản sao của `index.html` ở đây, bật GitHub Pages để có **https thật,
   không đăng nhập**. Sửa `index.html` trong kho này thì **phải đẩy lại bản sao ấy**, nếu không
   thiết bị đo bản cũ mà không ai biết. Repo đó tồn tại chỉ để đo; xoá được sau khi §3 hết hàng.
1. Mở `index.html` qua một URL **https** mà **không đòi đăng nhập** — nếu link bắt đăng nhập,
   webview sẽ hiện màn hình đăng nhập và phép đo hỏng **mà không báo lỗi**. Mở qua `http://` LAN
   thì **không** phải một dòng: trang sẽ tự nói **PHÉP ĐO HỎNG** thay vì phán về thiết bị.
2. Gửi link vào một cuộc trò chuyện, rồi **mở từ bên trong ứng dụng đó**. Bấm "Mở trong trình
   duyệt" là đo **sai thứ** — đó là Chrome/Safari, không phải webview.
3. Bấm **Chép kết quả**, dán vào §1, và ghi **cả engine lẫn phiên bản hệ điều hành**, không chỉ
   tên ứng dụng — §2 giải thích vì sao tên ứng dụng một mình là thông tin sai.
4. Nếu phán quyết **không** phải "Nộp thầu được", ghi ngay vào `docs/STATE.md` mục *Vấn đề đã
   biết 3* và mở ADR-011 trước khi bắt đầu S1.4.

> **Một dòng "ĐẠT" chỉ nói về đúng engine và đúng phiên bản ở dòng đó.** Rủi ro số 2 đóng khi
> §3 không còn hàng ưu tiên 1–3 — hoặc khi có một quyết định tường minh rằng phần còn lại được
> chấp nhận bỏ qua, và quyết định ấy được ghi ở chỗ có chữ ký.

---

## 3c. TRA CỨU DỮ LIỆU CÔNG BỐ — 2026-09-04. **KHÔNG PHẢI MỘT PHÉP ĐO.**

**Đọc dòng tiêu đề trên trước khi đọc bảng.** Mọi con số ở §1 là thứ dự án tự chạy trên một engine
thật, có ngày, có phiên bản. Bảng dưới đây thì không — nó là thứ đọc được từ tài liệu của bên khác
và mang đúng độ tin cậy của một bản chép. Nó **không** điền vào ô nào ở §3, và **không** đóng
khoản nợ 23.

| Điều | Dữ liệu | Nguồn |
|---|---|---|
| `crypto.subtle` — nền của cả đường nộp thầu | Chrome **37+** (2014); phủ toàn cầu ~**97,26%** | caniuse *Web Cryptography* |
| `X25519` trong WebCrypto | **Chrome 133**, tháng 2/2025 | Igalia, *Can I use Secure Curves in the Web Platform?* |
| `Ed25519` trong WebCrypto | **Chrome 137** — muộn hơn X25519 bốn phiên bản | Igalia, *Ed25519 Support Lands in Chrome* |
| Phân bố phiên bản Android System WebView | **KHÔNG tra được** từ dữ liệu tổng hợp công khai | gs.statcounter.com |

### Kết quả ÂM là kết quả có giá trị nhất của lượt tra này

Câu hỏi *"bao nhiêu máy ở Việt Nam đang chạy WebView ≥ 133"* **không trả lời được** bằng dữ liệu
miễn phí: StatCounter gộp toàn bộ `Chrome for Android` thành **một dòng**, không tách phiên bản
(kiểm ngày 2026-09-04, kỳ dữ liệu 8/2026). Cách duy nhất còn lại là **thuê máy thật theo phút** —
và ngay cả thế cũng chỉ cho một **mẫu**, không cho một **phân bố**.

Đó là lý do **ADR-011 được chốt bằng cách gỡ bỏ câu hỏi**, không phải bằng cách trả lời nó: hỗ trợ
**cả hai** thuật toán, chọn bằng chính máy dò này lúc chạy. Xem ADR-011 §*Quyết định*.

### Ba mức "giả lập Android", và chỉ hai mức là phép đo

| Cách | Đo cái gì |
|---|---|
| DevTools *device mode* / đổi User-Agent | **Chrome desktop đội lốt.** Đo lại đúng cái máy đã đo ở §1. Một dòng *"đã đo trên webview Android"* dựa vào đây sẽ **vi phạm §3b điều kiện 2** |
| **Android Emulator (AVD)** | System image thật, WebView thật ⇒ **phép đo thật**. Thu hẹp: emulator tải bản WebView **mới nhất**, còn rủi ro là bản **cũ** |
| **Máy thật thuê theo phút** | Máy tầm trung, Android cũ, WebView cũ — **khớp đúng rủi ro như đã phát biểu** |

Máy làm việc hiện tại **không có Android SDK** (kiểm 2026-09-04: không có `adb`, `emulator`,
`sdkmanager`, không có thư mục SDK).

### Việc kích hoạt lại KHÔNG đổi

Hễ mượn được một máy Android tầm trung, chạy §5 và điền một dòng vào §1. Hai phút. Sau ADR-011,
kết quả ấy đổi từ **cổng chặn** thành **con số vận hành**: nó nói bao nhiêu phần trăm nhà cung cấp
đi được đường nhanh, không còn nói có nộp được thầu hay không.

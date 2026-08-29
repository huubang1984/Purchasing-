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

Lần 1 còn chạy thêm **ba đột biến** (`?dot=x25519|aes|rnd`) và cho **bốn phán quyết phân biệt
được** — đó là phép đo chứng minh **máy dò có răng**, không phải phép đo về thiết bị.

**Dòng 3 là phép đo có giá trị nhất trong bảng.** Nó là lần đầu máy dò chạy **bên trong một
webview thật của thị trường Việt Nam**, và nó bác bỏ được giả thuyết xấu nhất: *"webview Zalo
không có `crypto.subtle`"*. Trên đường đi này, **cả `crypto.subtle` lẫn `X25519` đều có**.

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
| **1 — cao nhất** | **Zalo trên Android**, máy tầm trung hoặc cũ | Android System WebView cập nhật **rời** qua Play Store và trên máy tầm trung cũ thường **tụt lại nhiều phiên bản**. Đây là ô duy nhất còn lại thật sự đáng ngờ, và cũng là phân khúc máy phổ biến nhất của nhà cung cấp nhỏ. |
| **2** | **Zalo trên iPhone chạy iOS CŨ** (16.x hoặc cũ hơn) | Dòng 3 chỉ nói về **iOS 18.7**. `X25519` vào WebCrypto muộn hơn nhiều so với `AES-GCM`; một WebKit cũ là chỗ nó vắng mặt. |
| 3 | Messenger trên **Android** | Không suy ra được từ Zalo Android: Messenger có thể nhúng webview riêng thay vì dùng System WebView. **Phải đo, không được suy.** |
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
- Nhưng phần iOS chỉ được chứng minh **ở iOS 18.7**, và **toàn bộ phía Android vẫn trống**.
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

1. Mở `index.html` qua một URL **https** mà **không đòi đăng nhập** — nếu link bắt đăng nhập,
   webview sẽ hiện màn hình đăng nhập và phép đo hỏng **mà không báo lỗi**.
2. Gửi link vào một cuộc trò chuyện, rồi **mở từ bên trong ứng dụng đó**. Bấm "Mở trong trình
   duyệt" là đo **sai thứ** — đó là Chrome/Safari, không phải webview.
3. Bấm **Chép kết quả**, dán vào §1, và ghi **cả engine lẫn phiên bản hệ điều hành**, không chỉ
   tên ứng dụng — §2 giải thích vì sao tên ứng dụng một mình là thông tin sai.
4. Nếu phán quyết **không** phải "Nộp thầu được", ghi ngay vào `docs/STATE.md` mục *Vấn đề đã
   biết 3* và mở ADR-011 trước khi bắt đầu S1.4.

> **Một dòng "ĐẠT" chỉ nói về đúng engine và đúng phiên bản ở dòng đó.** Rủi ro số 2 đóng khi
> §3 không còn hàng ưu tiên 1–3 — hoặc khi có một quyết định tường minh rằng phần còn lại được
> chấp nhận bỏ qua, và quyết định ấy được ghi ở chỗ có chữ ký.

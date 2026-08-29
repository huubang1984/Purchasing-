# Nhật ký đo — WebCrypto trên thiết bị thật

> Mỗi dòng là **một lần chạy `index.html` trên một thiết bị thật**, dán từ nút "Chép kết quả".
> Bảng này tồn tại để trả lời đúng một câu hỏi: **rủi ro số 2 đã đóng chưa?**
>
> Nó **chưa đóng**. Xem §2.

---

## 1. Đã đo

| # | Ngày | Thiết bị / trình duyệt | Ngữ cảnh | X25519 | Phán quyết |
|---|---|---|---|---|---|
| 1 | 2026-08-29 | Chrome 148, Windows desktop | `http://localhost` | ĐẠT | Nộp thầu được |
| 2 | 2026-08-29 | **Edge 151** (Chromium 151), Windows desktop | **`https:`** | ĐẠT | Nộp thầu được |

Lần 1 còn chạy thêm **ba đột biến** (`?dot=x25519|aes|rnd`) và cho **bốn phán quyết phân biệt
được** — đó là phép đo chứng minh **máy dò có răng**, không phải phép đo về thiết bị.

**Hai dòng này chứng minh cái gì:** máy dò chạy ổn định, và chạy đúng trên **https thật** chứ
không chỉ trên `localhost`.

**Hai dòng này KHÔNG chứng minh cái gì:** bất cứ điều gì về webview Việt Nam. Cả hai đều là
**Chromium mới trên desktop**, cùng một họ engine, cùng một cơ chế tự cập nhật. Chúng là hai
điểm rất gần nhau trong không gian mà rủi ro số 2 nói tới, không phải hai điểm đại diện.

---

## 2. CHƯA đo — và đây mới là chủ ngữ của rủi ro

| # | Thiết bị cần đo | Vì sao chính nó mới quan trọng |
|---|---|---|
| — | **Zalo trên Android** | Webview là **Android System WebView**, cập nhật qua Play Store và trên máy tầm trung cũ thường **tụt lại nhiều phiên bản** so với Chrome desktop. Đây là ô đáng ngờ nhất trong cả bảng. |
| — | **Zalo trên iOS** | `WKWebView`, gắn cứng với phiên bản iOS. Không tự cập nhật rời. |
| — | **Messenger trên Android** | Cùng lý do với Zalo Android, nhưng Messenger có webview riêng trong ứng dụng. |
| — | **Messenger trên iOS** | Cùng lý do với Zalo iOS. |
| — | Chrome / Safari **trên điện thoại** (không qua webview) | Đường thoát khi webview hỏng. Cần biết nó có thật sự là đường thoát. |

**Chỗ đáng ngờ nhất là `X25519`.** Nó chỉ có trên **Chrome 133+** và **Safari 17+** — mới hơn
nhiều so với AES-GCM, SHA-256 và HKDF (đã có từ rất lâu). Nếu một webview thiếu đúng một thứ,
gần như chắc chắn là thứ này. Máy dò đã tách riêng ô đó chính vì vậy, và có sẵn một phán quyết
riêng cho tình huống ấy: **"Nộp được, nhưng phải đổi sang P-256"**.

Phán quyết đó **không phải lỗi thiết bị** — nó là **dữ kiện làm đổi ADR-011 và §3.2**, và phải
được biết **trước S1.4**. Đổi thoả thuận khoá sau khi đã có phong bì thật là một cuộc di trú.

---

## 3. Cách thêm một dòng

1. Mở `index.html` qua một URL **https** (WebCrypto không tồn tại ngoài ngữ cảnh bảo mật) mà
   **không đòi đăng nhập** — nếu link bắt đăng nhập, webview sẽ hiện màn hình đăng nhập và phép
   đo hỏng mà không báo lỗi.
2. Gửi link vào một cuộc trò chuyện Zalo hoặc Messenger, rồi **mở từ bên trong ứng dụng đó**.
   Mở bằng "Mở trong trình duyệt" là đo **sai thứ** — đó là Chrome/Safari, không phải webview.
3. Bấm **Chép kết quả**, dán vào bảng §1, và ghi rõ **tên ứng dụng, hệ điều hành, phiên bản máy**.
4. Nếu phán quyết **không** phải "Nộp thầu được", ghi ngay vào `docs/STATE.md` mục *Vấn đề đã
   biết 3* và mở ADR-011 trước khi bắt đầu S1.4.

> **Một dòng "ĐẠT" trong bảng §1 chỉ nói về đúng thiết bị ở dòng đó.** Rủi ro số 2 chỉ đóng khi
> §2 không còn hàng nào — hoặc khi có một quyết định tường minh rằng những hàng còn lại được
> chấp nhận bỏ qua, và quyết định ấy được ghi ở đâu đó có chữ ký.

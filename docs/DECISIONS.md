# DECISIONS — TrustProcure V2

> Sổ ghi quyết định kiến trúc. Chỉ ghi quyết định có hệ quả lâu dài, không ghi chi tiết
> triển khai vặt. Mỗi mục: bối cảnh, phương án đã cân nhắc, quyết định, hệ quả, rủi ro.

---

## ADR-001 — TypeScript full-stack + PostgreSQL

**Ngày:** 2026-08-26 · **Trạng thái:** Đã chấp nhận

**Bối cảnh.** Dự án hoàn toàn mới, không ràng buộc stack sẵn có. Phát triển theo phương
pháp Vibe Coding với Claude Code, nên chi phí ngữ cảnh và độ chính xác khi sinh mã là yếu
tố thật, không phải yếu tố phụ.

**Phương án đã cân nhắc.**

| Phương án | Ưu | Nhược |
|---|---|---|
| TypeScript full-stack | Một ngôn ngữ xuyên suốt; hệ sinh thái test chín (Vitest, Playwright, Testcontainers); mô hình sinh mã chính xác nhất | Hệ sinh thái ML yếu hơn Python cho MVP3 |
| Python (FastAPI) + React | Mạnh sẵn cho chuẩn hóa dữ liệu và phát hiện bất thường ở MVP3; thư viện mật mã chín | Hai ngôn ngữ, hai bộ test harness, chi phí ngữ cảnh cao |
| Java Spring Boot / .NET | Chuẩn enterprise, thuận lợi tích hợp SAP, dễ bàn giao cho đội IT khách hàng lớn | Vòng lặp phát triển chậm đáng kể cho MVP 9–11 tuần |

**Quyết định.** TypeScript full-stack. Next.js cho `web` và `vendor-portal`, NestJS cho
`api` và `unseal-worker`, PostgreSQL làm cơ sở dữ liệu duy nhất.

**Hệ quả.** MVP1 không cần ML nên không mất gì. Tới S4 (Intelligence), tách một service
Python riêng cho chuẩn hóa item và benchmark, giao tiếp qua API — ranh giới này tự nhiên
vì S4 vốn là hệ thống con độc lập.

**Rủi ro.** Nếu S4 tới sớm hơn dự kiến, chi phí vận hành hai runtime xuất hiện sớm hơn.
Chấp nhận được vì S4 nằm ở tháng 8–9 theo roadmap.

---

## ADR-002 — Mô hình đe dọa tầng 1+2 và cách giữ khóa

**Ngày:** 2026-08-26 · **Trạng thái:** Đã chấp nhận

**Bối cảnh.** Đặc tả mục 8 và 28 mô tả cặp khóa theo RFQ, private key bảo vệ bằng master
key, và khả năng yêu cầu hai phê duyệt cho RFQ giá trị lớn — nhưng để mở việc hệ thống
phải chống được ai. Câu trả lời quyết định toàn bộ thiết kế key management và quyết định
sản phẩm được phép tuyên bố điều gì.

**Phương án đã cân nhắc.**

| Tầng | Chống được ai | Chi phí | Rủi ro mất dữ liệu |
|---|---|---|---|
| 1 — Application Trust | Người dùng ứng dụng | Thấp | Thấp |
| 2 — Split Custody | + Một cá nhân có thẩm quyền đơn lẻ | Trung bình | Thấp |
| 3 — Zero-knowledge E2E | + Nhà vận hành nền tảng | Cao | **Rất cao** — mất khóa là mất toàn bộ báo giá, không cứu được |

**Quyết định.** Tầng 1+2. Private key mỗi RFQ được bọc bằng data key của tổ chức trong
KMS/Vault; chỉ giải phóng trong runtime có kiểm soát khi đủ vai trò, MFA còn hiệu lực, và
— với RFQ vượt ngưỡng — hai phê duyệt từ hai người khác nhau.

**Hệ quả.**

- Đúng tinh thần mục 28, khả thi trong khung thời gian, vẫn khôi phục được khi sự cố.
- Nhà vận hành nền tảng về mặt kỹ thuật vẫn giải mã được. **Cấm tuyệt đối tuyên bố
  zero-knowledge.** Ràng buộc này đã ghi vào `docs/PRODUCT.md` §5.
- Mọi lần giải mã đều để lại dấu vết bất biến — đó là biện pháp kiểm soát thay thế.

**Rủi ro.** Khách hàng FDI có yêu cầu chủ quyền dữ liệu nghiêm ngặt có thể đòi tầng 3.
Nếu điều đó xảy ra, đường nâng cấp là thêm lớp chia sẻ khóa ngưỡng phía trên thiết kế
hiện tại, không phải viết lại.

---

## ADR-003 — SaaS đa tổ chức, cô lập bằng Row-Level Security

**Ngày:** 2026-08-26 · **Trạng thái:** Đã chấp nhận

**Bối cảnh.** Mô hình giá ở mục 35 là thuê bao theo tháng, ngụ ý SaaS. Cần chọn cơ chế cô
lập giữa các doanh nghiệp dùng chung hệ thống.

**Phương án đã cân nhắc.** Đa tổ chức chung DB với RLS · mỗi khách một DB/schema · triển
khai on-premise riêng từng khách.

**Quyết định.** Đa tổ chức chung một cơ sở dữ liệu, cô lập bằng Postgres Row-Level
Security dựa trên `current_setting('app.org_id')`, phân cấp khóa riêng theo tổ chức trên
KMS.

**Hệ quả.** Triển khai pilot nhanh, vận hành một chỗ, và giữ được khả năng truy vấn xuyên
khách hàng cho benchmark ở S4 (khi có thỏa thuận dữ liệu phù hợp).

**Rủi ro.** Rò rỉ ngang giữa các tổ chức là lỗi chí mạng. Giảm thiểu: cô lập được cưỡng
chế ở **tầng cơ sở dữ liệu** chứ không phải tầng ứng dụng, và nhóm bất biến F có bộ test
đối kháng riêng.

---

## ADR-004 — Sổ kiểm toán chuỗi hash, chỉ ghi thêm, cưỡng chế ở tầng DB

**Ngày:** 2026-08-26 · **Trạng thái:** Đã chấp nhận

**Bối cảnh.** Mục 27 yêu cầu audit log chỉ ghi thêm, có bằng chứng chống giả mạo, có
chuỗi hash, có chính sách lưu trữ và xuất phục vụ kiểm toán.

**Phương án đã cân nhắc.** Bảng thường + kỷ luật ứng dụng · chuỗi hash cưỡng chế ở DB ·
sổ cái bên ngoài / blockchain.

**Quyết định.** Chuỗi hash: mỗi bản ghi chứa hash của bản ghi trước trong cùng tổ chức.
Cưỡng chế bằng trigger chặn UPDATE/DELETE **và** thu hồi quyền UPDATE/DELETE khỏi mọi
role ứng dụng. Kèm một bộ kiểm chứng độc lập.

**Hệ quả.** Chèn, sửa, xóa, và **cắt đuôi** chuỗi đều phát hiện được. Không phụ thuộc bên
thứ ba, không chi phí vận hành thêm.

**Rủi ro.** Kẻ tấn công có quyền superuser trên DB vẫn tính lại được toàn chuỗi. Nằm
ngoài mô hình đe dọa đã chọn (ADR-002). Đường nâng cấp nếu cần: neo định kỳ hash gốc ra
kho lưu trữ chỉ-ghi bên ngoài.

---

## ADR-005 — Ngữ nghĩa thời gian: đồng hồ DB, phán quyết trong transaction

**Ngày:** 2026-08-26 · **Trạng thái:** Đã chấp nhận

**Bối cảnh.** Toàn bộ lời hứa Blind Bid sụp đổ nếu một báo giá nộp sau deadline được chấp
nhận, hoặc nếu hành vi quanh giờ đóng không xác định. Đây là chỗ hầu hết hệ thống đấu
thầu làm sai.

**Quyết định.**

1. Nguồn thời gian duy nhất là `now()` của PostgreSQL, đánh giá **bên trong** transaction
   ghi báo giá, kèm khóa hàng trên `rfq_packages`. Không tin đồng hồ trình duyệt, không
   tin đồng hồ máy chủ ứng dụng.
2. Job đóng RFQ **không phải** cơ chế chặn — nó chỉ đổi trạng thái để hiển thị. Việc chặn
   nằm ở ràng buộc trong transaction.
3. Quy tắc biên tường minh: commit trước `deadline_at` là hợp lệ, sau là không. Không
   khoan dung vài giây, không xử lý theo thứ tự đến.
4. Gia hạn chỉ khi đang OPEN, có lý do, có audit, có thông báo. Không rút ngắn deadline
   sau khi đã có báo giá.

**Hệ quả.** Tính đúng đắn không phụ thuộc vào một tiến trình nền chạy đúng giờ. Scheduler
chết 30 phút cũng không làm báo giá muộn được chấp nhận.

**Rủi ro.** Khóa hàng trên `rfq_packages` là điểm tranh chấp khi nhiều nhà cung cấp nộp
cùng lúc. Phải đo ở T6 với kịch bản 200 nhà cung cấp trong 60 giây cuối.

---

## ADR-006 — Modular monolith với `unseal-worker` tách riêng

**Ngày:** 2026-08-27 · **Trạng thái:** Đã chấp nhận

**Bối cảnh.** Đặc tả mục 8 viết "Decrypt in controlled runtime" nhưng không nói cụ thể
runtime đó tách khỏi ứng dụng chính hay không.

**Phương án đã cân nhắc.** Monolith thuần Next.js · modular monolith giải mã in-process ·
modular monolith + worker tách riêng · microservices ngay từ đầu.

**Quyết định.** Modular monolith 11 module, với đúng một ngoại lệ: `unseal-worker` là
process riêng, độc quyền `kms:Decrypt` trên khóa RFQ và dùng DB role `app_unseal` riêng.
`api` không có quyền giải mã và chỉ được *yêu cầu* mở thầu qua hàng đợi.

**Hệ quả.** Ranh giới bảo mật quan trọng nhất được cưỡng chế bởi hai cơ chế độc lập —
IAM và quyền role DB — thay vì bằng quy ước code. Một lỗ SSRF hay RCE ở tầng web không
trở thành khả năng đọc báo giá niêm phong.

Bổ sung: quy tắc dependency-cruiser cấm `apps/api/**` import client giải mã KMS, chạy ở
tầng T0, làm CI đỏ ngay tại commit.

**Rủi ro.** Thêm một process phải triển khai, giám sát, và một hàng đợi phải gỡ lỗi. Chi
phí thật với đội nhỏ. Chấp nhận vì chi phí tách sau khi đã chạy production lớn hơn nhiều
lần.

---

## ADR-007 — Mã hóa phía trình duyệt nhà cung cấp bằng WebCrypto

**Ngày:** 2026-08-27 · **Trạng thái:** Đã chấp nhận

**Bối cảnh.** Bất biến A2 yêu cầu giá dạng rõ không tồn tại trong `api` service tại bất kỳ
thời điểm nào. Nếu mã hóa thực hiện phía máy chủ thì bản rõ đi qua `api` và bất biến chỉ
còn đúng nhờ kỷ luật của lập trình viên — không ghi log, không đưa vào APM trace, không
lọt vào thông báo lỗi.

**Quyết định.** Mã hóa lai thực hiện trong trình duyệt nhà cung cấp bằng WebCrypto: sinh
content key AES-256-GCM ngẫu nhiên, mã hóa payload, bọc content key bằng public key của
RFQ, gửi lên máy chủ chỉ ciphertext.

**Hệ quả.** A2 trở thành đúng theo kiến trúc chứ không phải theo kỷ luật. Một bất biến
được cưỡng chế bởi cấu trúc luôn mạnh hơn một bất biến được cưỡng chế bởi trí nhớ.

**Rủi ro — cao và cụ thể với thị trường Việt Nam.** Lời mời báo giá thường được chuyển
tiếp qua Zalo hoặc Messenger, và nhà cung cấp mở link trong webview của ứng dụng đó.
`crypto.subtle` chỉ khả dụng trong ngữ cảnh bảo mật và một số webview hạn chế nó. Nếu xảy
ra ở khách hàng pilot, nhà cung cấp không nộp được báo giá — lỗi giết chết tỷ lệ tham gia,
thứ mà mục 10 coi là ràng buộc sản phẩm then chốt.

**Giảm thiểu bắt buộc.** Dò tìm khả năng ngay khi mở trang; thông điệp hướng dẫn rõ ràng
bằng tiếng Việt kèm nút mở bằng trình duyệt ngoài; đo tỷ lệ gặp phải trong pilot. Phương
án dự phòng mã hóa phía máy chủ **chỉ** được cân nhắc sau khi có số liệu thật, vì nó làm
suy yếu chính bất biến A2.

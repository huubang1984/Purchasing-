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

---

## ADR-008 — Một lần thử MFA thất bại KHÔNG ghi vào sổ kiểm toán chuỗi-hash

**Ngày:** 2026-08-28 · **Trạng thái:** Đã chấp nhận, ~~**có nợ bắt buộc trả trước khi có
endpoint đăng nhập**~~ **nợ ĐÃ TRẢ 2026-09-06 (S1.10.4) bằng phương án (ii)** — xem cuối ADR

**Bối cảnh.** `verifyTotpAttempt` (`packages/identity/src/mfa-credentials.ts`) phán xét một
mã TOTP trên một đường đi mà **kẻ tấn công chưa đăng nhập vẫn chạm tới được**. Task 8 lập
tiền lệ "mỗi lần từ chối quyền để lại một bản ghi kiểm toán" (bất biến D5) cho
`requirePermission`. Câu hỏi: có áp tiền lệ đó cho một lần thử MFA thất bại không?

Chi phí đã được Task 8 **đo** trên đúng đường này: `appendAuditEvent` đi qua
`noi_chuoi_kiem_toan()`, thứ mở đầu bằng `pg_advisory_xact_lock` **theo tổ chức** (ĐO-5a/5b:
một phiên khác cùng tổ chức kẹt tới `lock_timeout`). Ghi sổ ở đây nghĩa là mỗi lần đoán sai
của mỗi người lạ đều nối tiếp hoá sổ kiểm toán của **cả tổ chức**.

**Quyết định.** Không ghi sổ kiểm toán trên đường thất bại MFA. Có test khoá quyết định lại
(`[T9-J]` trong `packages/identity/src/mfa.int.test.ts`), nên ai đổi ý phải sửa test và trả
lời câu hỏi về chi phí.

**Lựa chọn thật KHÔNG phải "audit hay DoS" — nó là "audit QUA CHUỖI HASH hay DoS".** Bản
đầu của lập luận gộp hai thứ đó làm một, và đó là một luồng phân giả. Ít nhất ba đường
**không** lấy khoá chuỗi kiểm toán, và cả ba đều bị bỏ:

- **(i) một bảng riêng ngoài chuỗi kiểm toán** (`mfa_attempt_log`), RLS cùng khuôn,
  `app_api` chỉ `INSERT`. Task 9 **đã có sẵn mọi khuôn** để làm và đã không làm.
- **(ii) chỉ ghi CHUYỂN TRẠNG THÁI** (`justLocked`), tần suất chặn trên
  `1 / MFA_LOCKOUT_SECONDS` mỗi hồ sơ — lập luận DoS **không áp dụng** cho một sự kiện có
  trần tần suất. Trường `justLocked` **đã tồn tại** trong `MfaAttemptResult` nhưng **không
  có người gọi nào**.
- **(iii) ghi theo lô hoặc ra ngoài bảng.**

**Hệ quả — dấu vết còn lại KHÔNG trung thực về khối lượng.** `failed_attempts` là một dạng
dấu vết, nhưng ba tính chất làm nó không thay được sổ, cả ba đo được:

1. nó là **trạng thái**, không phải nhật ký — một lần thành công đặt nó về 0, nên kẻ đoán
   trúng ở lần cuối **tự xoá dấu vết của chính chiến dịch**;
2. `app_api` **xoá được trực tiếp** (`GRANT UPDATE (failed_attempts, ...)` ở
   `006_sessions_and_mfa.sql`; xem khối MỤC 8/M-1 ở đó);
3. nó không mang chiều thời gian, IP, hay tương quan — 500 tài khoản bị rải để lại 500 con
   số ≤ 5, không phân biệt được với 500 người gõ nhầm.

**Nợ phải trả TRƯỚC KHI có endpoint đăng nhập.** Chọn (i) hoặc (ii) và cài đặt. Trạng thái
hôm nay — "không ghi gì, và có một trường `justLocked` không ai gọi" — là một quyết định
đúng về chuỗi hash cộng một khoảng trống chưa lấp, không phải một thiết kế đã xong.

**[2026-09-06 — ĐÃ TRẢ, phương án (ii).** `verifyTotpForLogin` (`packages/identity/src/login.ts`)
gọi `verifyTotpAttempt` rồi, khi `justLocked`, ghi đúng MỘT bản ghi `MFA_LOCKED` (actor USER, resource
`MFA_CREDENTIAL`, payload `lockedUntil`) vào chuỗi hash. Tần suất bị chặn trên `1 / MFA_LOCKOUT_SECONDS`
mỗi hồ sơ nên lập luận DoS ở trên không áp dụng. Đo qua HTTP ở `apps/api/src/auth.int.test.ts`
[INV-E3]: sai `MFA_MAX_FAILED_ATTEMPTS` lần ⇒ đúng một bản ghi; lần sai kế tiếp (đã khoá) không ghi
thêm; đột biến gỡ dòng ghi ⇒ test ĐỎ. Endpoint đăng nhập (`POST /auth/totp`) ra đời CÙNG commit —
đúng thứ tự khoản nợ đòi.**

**Ghi chú về nhãn.** Test khoá quyết định này mang thẻ `[T9-J]`, **không** `[INV-D5]`. Nó
chứng minh một **ngoại lệ** của D5; một thẻ `[INV-D5]` sẽ đẩy vào `evidence/INV-matrix.md`
một dòng "passed" dưới hàng D5 mà tên của nó đọc như phủ định chính bất biến ấy.

---

## ADR-009 — Nhà cung cấp KMS/Vault: **AWS KMS**

**Ngày mở:** 2026-08-29 · **Ngày chốt:** 2026-08-29 · **Trạng thái:** **Đã chấp nhận**

**Vì sao ADR này tồn tại, và vì sao nó ra đời muộn.** Tới hết S0, ba tài liệu (`docs/STATE.md`
hai chỗ, bản kế hoạch S0 một chỗ) đều trích **ADR-004** như *"quyết định KMS để mở"*. Trích sai:
ADR-004 là **Sổ kiểm toán chuỗi hash, chỉ ghi thêm** và đã **Đã chấp nhận**. Quyết định về khoá
thuộc **ADR-002**, cũng **Đã chấp nhận**, và ADR-002 **không** để mở nhà cung cấp — nó chốt *tầng
1+2* và nói "KMS/Vault" như một loại hạ tầng, không như một lựa chọn còn treo.

Hệ quả là một trạng thái kỳ lạ đo được: **8/8 ADR đều "Đã chấp nhận" — không một ADR nào ở trạng
thái mở — trong khi một quyết định đang thật sự chặn S1.6.** Cái treo là có thật; cái thiếu là
một chỗ để nó treo. ADR này là chỗ đó.

**Bối cảnh.** ADR-002 đòi private key mỗi RFQ được bọc bằng data key của tổ chức trong KMS/Vault.
S0 giao `KeyProvider` + adapter `local-dev` (mã hoá nội bộ, không qua mạng). S1.6 cần adapter thật.

---

### Quyết định

**AWS KMS, vùng `ap-southeast-1` (Singapore), theo mô hình envelope encryption ghim ở phần
"Ràng buộc kiến trúc" bên dưới.**

Quyết định này **kéo theo hạ tầng đích là AWS**, và đó là chiều phụ thuộc đúng — không phải
chiều ngược lại. Xem "Vì sao câu hỏi đúng không phải *chọn KMS nào*".

### Vì sao câu hỏi đúng không phải "chọn KMS nào"

ADR bản đầu liệt kê ba phương án (AWS KMS · Azure Key Vault · HashiCorp Vault) như thể chọn
nhà cung cấp khoá là một câu hỏi đứng riêng. Nó không đứng riêng. **ADR-006** đòi tách quyền
giải mã cho `unseal-worker`, và sự tách đó **chỉ cưỡng chế được bằng IAM của nơi compute chạy**.
Một KMS ở nhà cung cấp A trong khi worker chạy ở nhà cung cấp B thì lớp cưỡng chế mạnh nhất —
"chỉ danh tính này mới được gọi `Decrypt` trên khoá này" — phải thay bằng một secret dài hạn
được chuyền tay, tức là đúng thứ ADR-002 nói là không được có.

Nên thứ tự đúng là: **chọn hạ tầng đích trước, KMS gần như là hệ quả.** Ba trục để mở ở bản đầu
được giải quyết như sau.

| Trục | Trạng thái | Kết luận |
|---|---|---|
| 1. Nhà cung cấp / IAM | **Đã chốt** | AWS. `kms:Decrypt` trên CMK của RFQ được ghim bằng key policy cộng IAM condition, chỉ cho role của `unseal-worker`. Đây là cách cưỡng chế ADR-006 mạnh nhất trong ba phương án, vì nó không cần một credential nào nằm trong `api`. |
| 2. Chủ quyền dữ liệu | **Đã chốt có điều kiện** | `ap-southeast-1`. Chưa có khách hàng pilot nên chưa có yêu cầu chủ quyền cụ thể nào để thoả. Điều kiện bật lại ADR: xem "Khi nào phải mở lại". |
| 3. Hiệu năng | **Đã ĐO và đã ĐÓNG** | Không còn là trục quyết định. Xem phần đo bên dưới. |

**Vì sao không HashiCorp Vault.** Vault chỉ thắng khi có yêu cầu chủ quyền *đặt tại Việt Nam*,
hoặc khi phải chạy đa đám mây. Không điều nào đang đúng. Đổi lại, nó bắt đội tự vận hành HA
và auto-unseal của chính Vault — một gánh nặng vận hành thật, cho một đội chưa có khách hàng
pilot, để đổi lấy một tính linh hoạt chưa ai đòi. **Không** loại vĩnh viễn: `KeyProvider` giữ
mặt tiền hẹp chính là để lựa chọn này còn mở.

**Vì sao không Azure Key Vault.** Không có gì sai với nó; RBAC cộng Managed Identity cưỡng chế
ADR-006 tương đương. Nó thua ở một điểm hoàn cảnh: chưa có ràng buộc nào đẩy về Azure. Nếu
khách hàng FDI đầu tiên đã chuẩn hoá trên Azure/M365, đây là ứng viên thay thế đầu tiên.

---

### Trục 3 — hiệu năng: phép đo, và câu bị nó chứng minh là sai

Bản đầu của ADR này viết, ở mục 3 của phần "Chưa quyết định":

> ~~"Adapter thật chậm hơn **nhiều bậc** vì mỗi lần là một lời gọi mạng, và kịch bản mở thầu
> RFQ 50 NCC × 200 hạng mục ≈ 10.000 lần mở khoá **một lượt**."~~

**Hai câu này SAI, và đã được đo là sai. Giữ nguyên văn ở đây để đối chiếu, không xoá.**

Sai ở đâu:

1. **"mỗi lần là một lời gọi mạng"** — đúng dưới một mô hình adapter, sai dưới mô hình còn
   lại, và bản đầu trình bày nó như một **tất yếu của adapter thật** chứ không như **hệ quả
   của một lựa chọn**. Đó chính là lỗi QT2 mà dự án này đã gặp trước đây: khi một bảo đảm phụ
   thuộc một cấu hình, phải **GHIM cấu hình**, không được **NỚI bảo đảm**.
2. **"50 NCC × 200 hạng mục ≈ 10.000 lần mở khoá"** — nhân số hạng mục vào số thao tác. Theo
   §3.2 của spec thiết kế, **200 hạng mục nằm trong CÙNG một phong bì** của một nhà cung cấp:
   `ciphertext ← AES-256-GCM(content_key, {giá, điều khoản, tệp đính kèm})`. Số phong bì là
   **50**, không phải 10.000.

**Phép đo.** `tools/bench-kms/dem-loi-goi-kms.mjs`, chạy lại được bằng `node`, không thêm phụ
thuộc nào. Nó **đếm** số lời gọi KMS tại một điểm đếm duy nhất, dưới hai mô hình:

- **Mô hình B** — envelope encryption: một lời gọi `Decrypt` lấy data key của tổ chức, mọi thao
  tác sau đó cục bộ.
- **Mô hình A** — đối chứng, **cố ý sai**: gọi KMS lại cho từng phong bì.

| Kịch bản | Phong bì | Mô hình | **Lời gọi KMS** | Mật mã cục bộ |
|---|---|---|---|---|
| 50 NCC, 1 phong bì/NCC (đúng §3.2) | 50 | **B (ghim)** | **1** | 5,3 ms |
| 50 NCC, 1 phong bì/NCC | 50 | A (đối chứng) | **50** | 11,0 ms |
| 10.000 phong bì RIÊNG (xấu nhất, **không** phải thiết kế) | 10.000 | **B (ghim)** | **1** | 711,4 ms |
| 10.000 phong bì RIÊNG | 10.000 | A (đối chứng) | **10.000** | 1.881,5 ms |

Nhánh đối chứng tồn tại vì **một bộ đếm hỏng cũng trả về 1**. Nó ra đúng 50 và đúng 10.000, nên
con số 1 của mô hình B là một phép đo, không phải một hằng số bị kẹt. Script ném lỗi thay vì in
bảng nếu bất kỳ chiều nào lệch, và nó cũng kiểm tra mọi byte đã giải mã đúng.

**Quy ra độ trễ mạng.** Với một lời gọi KMS trong cùng vùng ở mức ~20 ms:

| Mô hình | 50 phong bì | 10.000 phong bì |
|---|---|---|
| **B (ghim)** | ~20 ms mạng + 5 ms cục bộ | ~20 ms mạng + 711 ms cục bộ |
| A (đối chứng) | ~1 giây | **~200 giây**, cộng rủi ro chạm hạn mức request của KMS |

**Kết luận:** hiệu năng KMS **không phải tiêu chí chọn nhà cung cấp**. Tần suất gọi là **một
lần mỗi lượt mở thầu**, không phụ thuộc số nhà cung cấp. Trục 3 đóng.

**Giới hạn của phép đo này — đọc trước khi trích dẫn nó:**

1. Đây là **mô phỏng**. Nó dùng đúng các primitive thiết kế đòi (AES-256-GCM, HKDF-SHA256,
   X25519) nhưng **không đi qua `packages/crypto-keys`**, vì gói đó chưa có phần khoá theo RFQ
   — đó chính là mã **G2**, còn trống.
2. `kmsDecrypt` là hàm giả lập. Nó đo **số lần gọi**, **không** đo độ trễ AWS thật. Con số 20 ms
   ở bảng trên là giả định quy đổi, không phải số đo.
3. Kết luận "1 lời gọi" đúng **dưới mô hình B và chỉ dưới mô hình B**. Nó là một phát biểu về
   **kiến trúc adapter**, không phải về AWS.
4. **Phải đo lại bằng adapter thật trong S1.4**, trên đường đi thật của `packages/sealed-envelope`.
   Câu "phải đo lại trước khi bắt đầu S1.6" ở bản đầu **vẫn đúng và vẫn còn hiệu lực** — phép đo
   này đóng trục *chọn nhà cung cấp*, nó không đóng trục *xác nhận trên mã thật*.

---

### Ràng buộc kiến trúc mà quyết định này GHIM

Con số "1 lời gọi" chỉ đúng chừng nào adapter được viết theo mô hình B. Nên mô hình B trở thành
một **ràng buộc**, không phải một gợi ý:

1. **KMS chỉ bọc/mở data key của TỔ CHỨC.** Nó **không bao giờ** được gọi cho từng phong bì,
   từng content key, hay từng nhà cung cấp.
2. **Private key RFQ được bọc bằng data key của tổ chức**, không bọc trực tiếp bằng CMK.
3. **Content key được bọc bằng public key RFQ** (X25519), hoàn toàn cục bộ, không chạm KMS.
4. Data key của tổ chức, sau khi mở, **chỉ sống trong bộ nhớ của `unseal-worker`** và bị xoá
   sau lượt mở thầu — cùng đường đời với private key RFQ theo §3.2.
5. `kms:Decrypt` trên CMK **chỉ** được cấp cho role của `unseal-worker`. Role của `api`
   **không** có quyền đó. Đây là hình thức cưỡng chế ADR-006 ở tầng hạ tầng, và nó phải được
   kiểm chứng như một bất biến trong S1.6, không phải như một mục cấu hình.

**Một PR làm hỏng ràng buộc 1 hoặc 3 sẽ không làm test đỏ hôm nay** — chưa có lớp nào đo nó.
Đó là một việc của S1.4: biến bốn ràng buộc trên thành thứ đo được, không phải thành thứ được
nhớ.

### Hệ quả

`KeyProvider` giữ một mặt tiền hẹp và mọi lời gọi đi qua nó, nên việc chốt muộn **không** đòi
viết lại — đó là ý đồ của Task 7 và nó đã trả cổ tức đúng ở đây. Việc còn lại trong S1.4 là
thêm một adapter cạnh `local-dev`, không phải sửa lớp gọi.

Từ nay, **mọi con số hiệu năng của đường khoá trong hồ sơ phải nói rõ nó là số của `local-dev`
hay của AWS KMS.** Số `local-dev` hôm nay (10.000 lần bọc ≈ 447 ms) là **mốc của mã hoá nội bộ**
và câu đó vẫn đúng nguyên vẹn.

### Khi nào phải MỞ LẠI ADR này

Không phải "khi thấy bất tiện". Đúng ba điều kiện, mỗi điều kiện là một sự kiện quan sát được:

1. **Một khách hàng đòi khoá đặt tại Việt Nam**, bằng văn bản. AWS chưa có vùng ở VN;
   `ap-southeast-1` là Singapore. Đây là điều kiện có thật với khách hàng nhà nước hoặc
   ngân hàng, và nó đẩy về HashiCorp Vault self-host.
2. **Khách hàng FDI đầu tiên đã chuẩn hoá trên Azure** và đòi khoá nằm trong tenant của họ.
   Đẩy về Azure Key Vault.
3. **Yêu cầu đa đám mây** từ một hợp đồng doanh nghiệp.

**Rủi ro còn lại, giữ nguyên từ bản đầu:** đổi nhà cung cấp KMS sau khi đã có khoá thật của
khách hàng là một **cuộc di trú**, không phải một lần sửa cấu hình. Vì vậy ba điều kiện trên
nên được hỏi thẳng khách hàng pilot **trước** S1.6, chứ không đợi họ nêu.

---

## ADR-010 — Đường thông báo cho break-glass: **outbox bền + `NOTIFY` đánh thức**

**Ngày:** 2026-08-29 · **Trạng thái:** **Đã chấp nhận** · Gỡ chặn: **D4**, S1.6, S1.8

**Bối cảnh.** Bất biến **D4** đòi break-glass *"sinh cảnh báo mức cao **tức thì**, không bao giờ
im lặng"*. Outbox của S0 là **POLL**, và độ trễ của nó bị **chặn dưới** bởi `pollIntervalMs` —
đây là chuyện **cơ chế**, không phải chuyện chỉnh tham số. Vì vậy Task 10 **cố ý** không gắn thẻ
`[INV-D4]`: gắn thẻ lên một lớp không thể thoả mệnh đề là lấp mã bằng nhãn.

**Mệnh đề D4 có hai vế, và chúng kéo về hai hướng ngược nhau:**

| Vế | Đòi hỏi | Cơ chế phù hợp |
|---|---|---|
| *"không bao giờ im lặng"* | **BỀN**. Cảnh báo phải sống sót qua mất kết nối, restart, worker chết. | Ghi vào bảng, trong **cùng transaction** với hành vi break-glass. |
| *"tức thì"* | **NHANH**. Không được chờ hết một chu kỳ poll. | Một tín hiệu đẩy. |

**Phương án đã cân nhắc.**

1. **Giảm `pollIntervalMs` xuống rất nhỏ.** Loại. Nó không đổi bản chất: độ trễ vẫn bị chặn
   dưới, chỉ là chặn ở một số nhỏ hơn, và cái giá là tải truy vấn thường trực. "Tức thì" đạt
   được bằng cách làm cho khoảng chờ nhỏ đi thì vẫn là một khoảng chờ.
2. **`LISTEN`/`NOTIFY` thay cho outbox.** **Loại, và đây là phương án nguy hiểm nhất vì nó trông
   đúng.** `NOTIFY` của Postgres **không bền**: thông điệp chỉ tới những phiên **đang** `LISTEN`
   tại thời điểm commit. Worker mất kết nối một giây, restart, hay chưa kịp `LISTEN` — thông điệp
   **biến mất không dấu vết**. Một cơ chế như vậy **trực tiếp phá vế *"không bao giờ im lặng"***,
   tức là phá đúng nửa quan trọng hơn của D4.
3. **Đường đồng bộ: gọi thẳng dịch vụ thông báo trong request.** Loại. Nó buộc tính đúng đắn của
   một hành vi kiểm toán vào **tính sẵn sàng của một hệ thống bên ngoài**: nhà cung cấp thông báo
   sập thì hoặc break-glass thất bại, hoặc cảnh báo im lặng. Cùng họ lỗi với việc để tính đúng
   đắn phụ thuộc scheduler mà ADR-005 đã bác.

### Quyết định

**Cả hai, mỗi cái làm đúng việc của nó:**

1. **Bền:** hành vi break-glass ghi một hàng outbox **trong cùng transaction** với chính hành vi
   đó. Commit được thì cảnh báo **đã tồn tại**; rollback thì không có gì để cảnh báo. Đây là
   thứ giữ vế *"không bao giờ im lặng"*.
2. **Nhanh:** cùng transaction phát một `NOTIFY` trên một kênh riêng. Worker đang `LISTEN` bị
   đánh thức ngay thay vì chờ hết chu kỳ.
3. **Poll vẫn chạy, và đó là điểm mấu chốt.** `NOTIFY` là **bộ tăng tốc, không phải cơ chế**.
   Mất `NOTIFY` thì cảnh báo **chậm**, không **mất** — nó sẽ được vòng poll kế tiếp nhặt lên.

**Cách phát biểu đúng cho bảo đảm này, và nó hẹp hơn chữ "tức thì":** *cảnh báo được đảm bảo
**gửi**; độ trễ **thường** là thời gian đánh thức, và **xấu nhất** là một chu kỳ poll.* Không
được viết là "tức thì" trong bất kỳ tài liệu nào — đó sẽ là một câu rộng hơn cơ chế.

### Cái này KHÔNG đóng, và phải ghi vào §4 của ma trận

`NOTIFY` chỉ đảm bảo *đánh thức*, không đảm bảo *đã gửi tới người nhận*. Chặng cuối — email/SMS/
webhook thật sự tới tay ai đó — nằm ngoài Postgres và **không** được coi là đã đo chỉ vì hàng
outbox đã chuyển sang `SENT`. Khi `[INV-D4]` được gắn thẻ ở S1.8, phần chênh này **phải** có một
mục ở §4.

### Đo bằng gì

Test phải **giết đường nhanh** rồi đòi cảnh báo vẫn tới: chạy break-glass **khi không có phiên
nào `LISTEN`**, rồi khẳng định vòng poll vẫn nhặt được hàng đó. Không có phép đo ấy thì đây chỉ
là một câu văn — đúng bài học đắt nhất của S0.

---

## ADR-011 — Định dạng phong bì và chữ ký biên nhận: ~~**CHƯA CHỐT**~~ **P-256 mặc định, X25519 cơ hội**

**Ngày:** 2026-08-29 · **Cập nhật:** 2026-09-04 · **Trạng thái:** ~~**Đang mở** — chặn **S1.4**, **S1.5**~~ ~~**Đã chấp nhận cho mục 1; mục 2 và 3 còn mở nhưng KHÔNG chặn S1.4**~~ **ĐÃ CHẤP NHẬN TRỌN VẸN — mục 1 chốt 2026-09-04, mục 2 và 3 chốt cùng ngày, gỡ chặn S1.5** · Liên quan: **B2**, **G2**, **A2**

**Vì sao ADR này ra đời ngay cả khi chưa quyết được.** Đây là bài học trực tiếp từ ADR-009: tới
hết S0, tám ADR đều "Đã chấp nhận" trong khi một quyết định đang thật sự chặn S1.6 — *cái treo là
có thật; cái thiếu là một chỗ để nó treo*. ADR này là chỗ đó, mở sẵn **trước** khi S1.4 bắt đầu.

### Phần ĐÃ ghim, không đợi phần còn lại

**Phong bì phải mang một mã thuật toán thoả thuận khoá tường minh**, cùng khuôn với
`ENVELOPE_VERSION` đã có trong `packages/crypto-keys`.

Lý do là một khoảng trống đo được: **phía Android chưa từng được đo** và việc đo đã được **hoãn
có chủ đích** (khoản nợ 23, `tools/do-webcrypto/ket-qua-do.md` §3b). Ba engine đã đo đều có
`X25519`, nhưng cả ba là Chromium desktop mới và WKWebView iOS 18.7 — Android System WebView
trên máy tầm trung cũ chưa có mặt trong dữ liệu.

Với mã thuật toán nằm trong phong bì, nếu Android hoá ra thiếu `X25519` thì việc phải làm là
**thêm một nhánh P-256**; phong bì cũ vẫn mở được, đúng cơ chế `MasterKeyRing` dùng để sống sót
qua các lần xoay khoá (**G3**). Không có nó, cùng tình huống ấy là một **cuộc di trú**. Đây là
cách biến một rủi ro *chưa đo* thành một rủi ro *rẻ* — và nó ghim được **ngay hôm nay**, không
cần đợi phép đo.

### Quyết định (2026-09-04)

**Mục 1 được chốt mà KHÔNG cần phép đo Android, và cách nó được chốt mới là phần đáng đọc.**

1. **`ECDH P-256` là thuật toán thoả thuận khoá MẶC ĐỊNH. `X25519` là đường NÂNG CẤP CƠ HỘI,
   chỉ dùng khi máy dò báo trình duyệt của chính nhà cung cấp ấy có.** Phong bì ghi lại thuật
   toán đã dùng — đó là phần đã ghim ở trên, và nó chính là thứ làm quyết định này khả thi.
2. **Chọn thuật toán là một phép ĐO LÚC CHẠY, không phải một hằng số cấu hình.** Trình duyệt của
   nhà cung cấp tự khai năng lực qua `tools/do-webcrypto`; hệ thống đọc kết quả và chọn. Không có
   danh sách trắng theo phiên bản, không đoán theo User-Agent — cả hai đều là *danh sách tên*, và
   dự án đã ba lần bị chính khuôn ấy làm mù (khoản nợ 3, 16, và lớp canh route ở `4467ca9`).
3. **`X25519` KHÔNG được làm điều kiện để nộp thầu.** Một nhà cung cấp chỉ có P-256 phải nộp được
   báo giá bình thường. Ràng buộc sản phẩm 1 (*friction thấp cho nhà cung cấp là điều kiện sống
   còn*) không cho phép loại người dùng vì trình duyệt của họ cũ.

**Vì sao đây KHÔNG phải "bỏ qua phép đo".** Thế lưỡng nan *X25519 hay P-256* là do chính ADR này
tự đặt ra dưới dạng **hoặc/hoặc**, và phép đo Android chỉ cần thiết cho cái *hoặc/hoặc* ấy. Bỏ nó
đi thì phép đo tụt từ **cổng chặn** xuống **câu hỏi tinh chỉnh** — nó trả lời *bao nhiêu phần trăm
nhà cung cấp đi được đường nhanh*, chứ không còn trả lời *có nộp được thầu hay không*.

Khoản nợ 23 vì vậy **KHÔNG được đóng** bởi quyết định này. Nó chỉ **thôi chặn S1.4**.

### Bằng chứng — và nó là DỮ LIỆU CÔNG BỐ, KHÔNG phải phép đo của dự án

Phân biệt này là bắt buộc: mọi con số ở §1 của `ket-qua-do.md` là thứ dự án tự chạy trên một
engine thật. Bảng dưới đây thì không — nó là thứ đọc được từ tài liệu của bên khác, và nó mang
đúng độ tin cậy của một bản chép.

| Điều | Dữ liệu | Nguồn |
|---|---|---|
| `crypto.subtle` (nền của cả đường nộp thầu) | Chrome **37+** (2014); phủ toàn cầu ~**97,26%** | caniuse *Web Cryptography* |
| `X25519` trong WebCrypto | **Chrome 133**, tháng 2/2025 | Igalia, *Can I use Secure Curves in the Web Platform?* |
| `Ed25519` trong WebCrypto | **Chrome 137** — muộn hơn X25519 bốn phiên bản | Igalia, *Ed25519 Support Lands in Chrome* |
| Phân bố phiên bản Android System WebView | **KHÔNG tra được từ dữ liệu tổng hợp công khai** — StatCounter gộp toàn bộ "Chrome for Android" thành một dòng, không tách phiên bản | gs.statcounter.com |

**Dòng cuối là dòng có giá trị nhất, và nó là một kết quả ÂM.** Câu hỏi *"bao nhiêu máy ở Việt Nam
đang chạy WebView ≥ 133"* **không trả lời được** bằng dữ liệu miễn phí. Tức nếu giữ nguyên thế
hoặc/hoặc, cách duy nhất để chốt mục 1 là **thuê máy thật theo phút** — và ngay cả thế cũng chỉ
cho một mẫu, không cho một phân bố. Một quyết định phụ thuộc vào con số ấy là một quyết định treo
vào thứ dự án này không mua được.

**Chrome 133 là tháng 2/2025.** Chrome ổn định hiện ở khoảng **151** (8/2026), nên với máy CÓ cập
nhật, `X25519` đã có mặt khoảng mười chín tháng. Rủi ro nằm trọn ở **cái đuôi không cập nhật**:
Android System WebView đi qua Play Store, và máy thiếu Play Services, hết dung lượng, hoặc quá cũ
sẽ đứng lại. Cái đuôi ấy chính là thứ không đo được từ xa.

### Còn để mở

1. ~~**Thoả thuận khoá: `X25519` hay `ECDH P-256`, hay cả hai.** Chỉ được chốt **sau** khi có kết
   quả đo Zalo/Android. Đây là ràng buộc thứ tự, không phải sở thích.~~ **ĐÃ CHỐT — "cả hai", và
   ràng buộc thứ tự biến mất cùng với thế hoặc/hoặc.**
2. ~~**Thuật toán chữ ký biên nhận.**~~ **ĐÃ CHỐT 2026-09-04 — `ECDSA P-256` + `SHA-256`. Xem
   §"Quyết định mục 2 và mục 3" bên dưới.** Nguyên văn cũ giữ lại: B2 đòi nhà cung cấp **kiểm
   chứng độc lập được**. Điều đó
   loại thẳng một họ giải pháp: **HMAC bằng secret nội bộ KHÔNG thoả B2** — nhà cung cấp không
   kiểm chứng được thứ họ không có khoá. Cần **chữ ký khoá công khai** (Ed25519 là ứng viên đầu),
   khoá công khai của hệ thống phải **công bố được**, và biên nhận phải **tự mô tả**: mang thuật
   toán, định danh khoá, và mọi trường được ký.

   > **MỘT PHÁT HIỆN MỚI CỦA LƯỢT TRA CỨU 2026-09-04, và nó chạm thẳng vào ứng viên đầu:**
   > **`Ed25519` vào WebCrypto ở Chrome 137 — MUỘN HƠN `X25519` bốn phiên bản.** Nếu B2 được
   > hiện thực bằng *"nhà cung cấp mở một trang web và bấm kiểm chứng"*, thì Ed25519 kế thừa
   > **đúng cùng vấn đề đuôi cũ** mà mục 1 vừa gỡ bỏ — chỉ tệ hơn một bậc.
   >
   > Hệ quả: mục 2 phải chọn **một trong hai đường**, và đây là câu hỏi thật của nó chứ không
   > phải "Ed25519 hay ECDSA":
   > ⑴ ký bằng **`ECDSA P-256`**, thứ đi cùng nền `crypto.subtle` từ 2014 — kiểm chứng được ngay
   > trong trình duyệt của nhà cung cấp, kể cả máy cũ; hoặc
   > ⑵ giữ **Ed25519** và chấp nhận rằng kiểm chứng độc lập diễn ra **ngoài trình duyệt** (một
   > lệnh `openssl`, một thư viện) — lúc ấy B2 vẫn thoả nhưng **đối tượng của nó đổi**: không còn
   > là "nhà cung cấp bất kỳ", mà là "nhà cung cấp có người biết chạy công cụ".
   >
   > Câu ⑵ **không sai**, nhưng nó phải được nói ra thay vì đi lẫn vào một lựa chọn kỹ thuật.
3. ~~**Xoay khoá ký.**~~ **ĐÃ CHỐT 2026-09-04 cùng mục 2 — hai mục KHÔNG tách được: một biên
   nhận không mang định danh khoá là một biên nhận không kiểm chứng được sau lần xoay đầu tiên.**
   Nguyên văn cũ: Biên nhận có giá trị pháp lý lâu hơn vòng đời một khoá. Cần định danh khoá
   trong biên nhận và một chỗ công bố các khoá cũ — cùng bài toán G3, khác đối tượng.

### Quyết định mục 2 và mục 3 (2026-09-04): **`ECDSA P-256` + `SHA-256`, biên nhận là VĂN BẢN CHÍNH TẮC, khoá mang định danh**

**Bắt đầu bằng một lập luận đã bị chính phép tra cứu giết chết, vì nó là phần đáng đọc nhất.**

Lượt này suýt chốt mục 2 bằng một câu nghe rất dứt khoát: *"ADR-009 chọn AWS KMS, mà KMS **không**
ký được Ed25519 — nên chọn Ed25519 nghĩa là đuổi khoá ký ra khỏi HSM."* Câu ấy **sai**. Tài liệu
AWS KMS (tra 2026-09-04) liệt kê `ECC_NIST_EDWARDS25519` với hai thuật toán `ED25519_SHA_512` và
`ED25519_PH_SHA_512`. Ed25519 ký được trong KMS, và lập luận ấy bốc hơi.

Ghi lại nguyên văn thay vì lặng lẽ bỏ đi, vì nó là **một lập luận nghe có thẩm quyền, kiểm chứng
được, và sai** — đúng hình dạng của thứ đi lọt vào một ADR rồi nằm đó nhiều năm. Nếu quyết định
dưới đây có vẻ hiển nhiên, hãy nhớ nó suýt được chốt bằng một lý do khác hẳn và không đúng.

#### Quyết định

1. **Chữ ký biên nhận là `ECDSA P-256` với `SHA-256`** — mã thuật toán `ECDSA_P256_SHA256`.
2. **Thứ được ký là một VĂN BẢN CHÍNH TẮC, không phải một đối tượng JSON.** Khối UTF-8 nhiều dòng,
   thứ tự trường cố định, `\n` thuần, không dấu cách thừa. Dòng đầu là nhãn định dạng.
3. **Biên nhận TỰ MÔ TẢ và mang `kid`.** Mọi trường được ký nằm trong chính văn bản ấy, kể cả
   thuật toán và định danh khoá.
4. **Văn bản chính tắc được LƯU nguyên văn**, không dẫn xuất lại lúc kiểm chứng.
5. **Khoá công khai công bố theo `kid`, và khoá cũ KHÔNG BAO GIỜ bị gỡ** — cùng cơ chế
   `MasterKeyRing` (G3) và `PepperRing` (ADR-018), khác đối tượng.

#### Vì sao `ECDSA P-256` chứ không phải `Ed25519`

Câu hỏi thật của mục 2 — ADR này đã tự đặt đúng nó ở bản trước — **không phải "thuật toán nào
đẹp hơn"** mà là: *chữ "nhà cung cấp" trong "nhà cung cấp kiểm chứng độc lập được" chỉ ai?*

| | `ECDSA P-256` | `Ed25519` |
|---|---|---|
| `crypto.subtle.verify` trong trình duyệt nhà cung cấp | **Chrome 37 (2014)**, ~97,26% phủ toàn cầu | **Chrome 137 (2025)** |
| AWS KMS ký được (ADR-009) | ✅ `ECC_NIST_P256` / `ECDSA_SHA_256` | ✅ `ECC_NIST_EDWARDS25519` |
| `openssl dgst -verify` | ✅ | ✅ |
| Chữ ký có tính mềm dẻo (malleable) | **CÓ** — `s` và `n−s` đều hợp lệ | không |
| Phụ thuộc ngẫu nhiên lúc ký | **CÓ** | không |

**Vế quyết định là vế thứ nhất, và nó không phải một con số phủ sóng — nó là một LỚP NGƯỜI DÙNG
MỚI.** Đường nộp thầu đã chốt ở mục 1 là `ECDH P-256` mặc định, tức **mọi máy nộp được thầu đều
có họ P-256**. Chọn `ECDSA P-256` cho chữ ký nghĩa là: *ai nộp được thì kiểm chứng được*, không
thêm một phép dò nào, không thêm một nhánh nào trong máy dò, không thêm một thông báo lỗi nào.

Chọn `Ed25519` tạo ra một hạng người dùng **chưa từng tồn tại**: *nộp được nhưng không kiểm chứng
được trong trình duyệt*. Và hạng ấy rơi đúng vào cái đuôi Android cũ mà dự án này lo suốt từ
ADR-007 — tức đúng những nhà cung cấp cần bằng chứng nhất lại là những người không xem được nó.

**Vế thứ hai, và nó là vế dễ bị coi nhẹ:** giá trị của B2 ở thị trường này là **niềm tin hằng
ngày**, không phải bằng chứng lúc tranh chấp. Một biên nhận chỉ kiểm chứng được bằng `openssl` là
một biên nhận **gần như không ai kiểm chứng**; nó lùi về đúng chỗ HMAC đứng — *"họ bảo là đã ký"*.
Vế "kiểm chứng bằng công cụ chuẩn" vẫn phải giữ, nhưng nó là **đường thứ hai**, không phải đường
duy nhất.

#### Cái giá phải trả, viết ra thay vì để phát hiện sau

**`ECDSA` cho chữ ký MỀM DẺO: từ một chữ ký hợp lệ `(r, s)` ai cũng dựng được `(r, n−s)` cũng hợp
lệ, mà không cần khoá riêng.** Hệ quả **duy nhất** nhưng nghiêm trọng:

> **CHUỖI BYTE CHỮ KÝ KHÔNG BAO GIỜ ĐƯỢC DÙNG LÀM ĐỊNH DANH.** Không làm khoá chính, không làm
> khoá duy nhất, không làm khoá khử trùng lặp, không làm "mã biên nhận". Danh tính của một biên
> nhận là `sha256(văn bản chính tắc)` — thứ **không** mềm dẻo.

Đây là một ràng buộc phải được **cưỡng chế**, không được nhớ: lược đồ `bid_receipts` vì vậy
**không có** ràng buộc duy nhất nào trên cột `signature`, và có test đọc `pg_index` để đòi điều đó.

Rủi ro thứ hai — **ngẫu nhiên lúc ký**: một `k` lặp lại làm lộ khoá riêng. Nó được giảm nhẹ bởi
chính chỗ ký: KMS/HSM ở production (ADR-009) và `node:crypto` ở dev — không phải một thiết bị nhúng
thiếu entropy. Nó **không** biến mất; nó chỉ nằm ở một nơi có người khác lo.

#### Vì sao VĂN BẢN chứ không phải JSON — và đây là chỗ B2 sống hay chết

Một đối tượng JSON **không có** dạng byte chính tắc: thứ tự khoá, dấu cách, cách thoát Unicode đều
tự do. Ký một JSON nghĩa là ký *một trong nhiều* chuỗi byte biểu diễn cùng dữ liệu — và bên kiểm
chứng phải dựng lại **đúng** chuỗi ấy. Điều đó buộc nhà cung cấp phải cài lại bộ mã hoá của chúng
ta, tức **kiểm chứng phụ thuộc vào mã của bên bị kiểm chứng**. Đó không còn là *độc lập*.

Văn bản chính tắc gỡ bỏ toàn bộ vế ấy. Nhà cung cấp lưu hai tệp và chạy đúng một lệnh:

```bash
openssl dgst -sha256 -verify khoa-cong-khai.pem -signature bien-nhan.sig bien-nhan.txt
```

Dạng chuẩn (`v1`), thứ tự trường **cố định**, mỗi dòng `khoa=gia-tri`, kết dòng `\n`:

```text
trustprocure-receipt-v1
alg=ECDSA_P256_SHA256
kid=<định danh khoá ký>
rfq_id=<uuid>
bid_id=<uuid>
version=<số nguyên>
ciphertext_sha256=<64 ký tự hex thường>
submitted_at=<dấu thời gian của Postgres, dạng văn bản, đủ micro-giây>
```

Ba ràng buộc của khuôn này, mỗi cái đóng một đường:

* **Không giá trị nào chứa `\n`.** Mọi trường là hex, UUID, số nguyên, hay dấu thời gian — dựng ra
  đã không có xuống dòng. Vẫn kiểm lúc chạy: một giá trị lọt được một dòng mới vào là chèn được
  một trường giả vào văn bản đã ký.
* **`submitted_at` lấy TỪ POSTGRES DẠNG VĂN BẢN, không đi qua `Date` của JS.** `timestamptz` giữ
  micro-giây còn `Date` chỉ tới mili-giây — dự án đã ghi cảnh báo ấy trong `AuditEventRecord` từ
  S0. Một biên nhận cắt bớt ba chữ số cuối là một biên nhận **không khớp** dữ liệu nó chứng nhận.
* **Cùng một `now()` cho cả phán quyết deadline lẫn `submitted_at`.** Nếu phép kiểm C1 dùng
  `clock_timestamp()` còn biên nhận dùng `now()`, sẽ có biên nhận mang dấu thời gian **trước**
  hạn cho một lần nộp bị từ chối vì **trễ** — hai câu trả lời cho một câu hỏi.

#### Xoay khoá ký (mục 3)

Cùng khuôn `MasterKeyRing` và `PepperRing`, và **cùng lý do**: xoay khoá nghĩa là **thêm** một
phiên bản rồi chuyển `activeKeyId`, **giữ nguyên** các khoá cũ. Bỏ một khoá cũ đi là làm mọi biên
nhận đã phát trước lần xoay ấy **vĩnh viễn không kiểm chứng được** — mà biên nhận là thứ có giá
trị pháp lý lâu hơn vòng đời một khoá, đó chính là câu mở đầu của mục 3.

`kid` nằm **trong văn bản đã ký**, nên nó không thay được sau khi ký. Bên kiểm chứng đọc `kid`,
tra khoá công khai tương ứng ở chỗ công bố, rồi kiểm. Chỗ công bố ấy **chưa tồn tại** — nó là một
endpoint HTTP và `apps/` vẫn rỗng; S1.5 giao **cấu trúc** (vòng khoá có `kid`, biên nhận mang
`kid`, hàm kiểm chứng nhận khoá công khai từ ngoài), không giao đường công bố.

#### Đo bằng gì

1. **Kiểm chứng bằng KHOÁ CÔNG KHAI MỘT MÌNH.** Test phải kiểm được chữ ký khi trong tay chỉ có
   văn bản chính tắc + chữ ký + khoá công khai — **không chạm** vào bất cứ thứ gì chỉ máy chủ có.
   Không có vế này, B2 bị vi phạm trong im lặng đúng như §"Rủi ro của việc để mở" đã cảnh báo.
2. **Đối chứng âm ba mũi:** sửa một byte của văn bản · sửa một byte của chữ ký · dùng khoá công
   khai của một `kid` khác. Cả ba phải **từ chối**.
3. **Xoay khoá:** phát biên nhận bằng `kid` cũ, xoay sang `kid` mới, biên nhận cũ **vẫn kiểm chứng
   được**. Đây là G3 ở một đối tượng khác, và nó phải được đo chứ không suy.
4. **Tính mềm dẻo được ghi nhận, không bị giả vờ là không có:** một test dựng chữ ký `(r, n−s)` từ
   chữ ký thật và đòi CSDL **không** có ràng buộc duy nhất nào trên `signature` — tức lược đồ không
   bao giờ coi chuỗi byte ấy là danh tính.
5. **KHÔNG có phép đo nào cho *"nhà cung cấp thật đã kiểm chứng được"*** ở S1. Trang kiểm chứng là
   tầng HTTP và `apps/` còn rỗng. Chỗ trống ấy thuộc về S1.9/T5, và nó phải nằm ở §4 của ma trận
   chứ không được nuốt vào ô ✅ của B2.

### Rủi ro của việc để mở

Nhỏ hơn ADR-009 nhiều, vì phần **đã ghim** ở trên chính là phần hấp thụ hầu hết chi phí đổi ý.
Rủi ro thật còn lại là **chốt mục 2 dưới áp lực tiến độ** bằng một HMAC "cho nhanh" — nó chạy,
test xanh, và **B2 bị vi phạm trong im lặng** vì không ai thử đóng vai nhà cung cấp đi kiểm
chứng. Cách chặn: test của B2 phải **kiểm chứng bằng khoá công khai một mình**, không được chạm
vào bất cứ thứ gì chỉ máy chủ mới có.

### Đo bằng gì

1. **Đối chứng dương cho đường P-256:** một phong bì niêm phong **chỉ bằng P-256** phải mở được
   trọn vẹn. Không có vế này, "hỗ trợ cả hai" là một lời khai.
2. **Đối chứng cho đường chọn:** vô hiệu hoá `X25519` trong máy dò (máy dò **đã có** ba đột biến
   cho việc này) → hệ thống phải **tự rơi về P-256** và nộp thầu vẫn thành công, **không** báo lỗi
   cho nhà cung cấp.
3. **Phong bì phải TỰ KHAI:** đọc một phong bì P-256 và một phong bì X25519, cả hai phải nói ra
   mã thuật toán của chính nó. Một phong bì không tự khai là một phong bì không mở được sau lần
   xoay thuật toán kế tiếp.
4. **KHÔNG có phép đo nào cho *"bao nhiêu % nhà cung cấp đi đường nhanh"*** ở S1, và chỗ trống
   ấy phải nằm ở §4 của ma trận. Nó chỉ trả lời được bằng dữ liệu vận hành thật sau khi có người
   dùng thật — tức nó thuộc S2+, không thuộc S1.

---

## ADR-012 — Định danh mà nhà cung cấp nhìn thấy: **UUIDv4 ngẫu nhiên, cấm UUIDv7/ULID**

**Ngày:** 2026-08-29 · **Trạng thái:** **Đã chấp nhận** · Gỡ chặn: **A5**, S1.1, S1.3

**Bối cảnh.** **A5** đòi nhà cung cấp không biết được danh tính, sự tồn tại, số lượng hay giá của
nhà cung cấp khác — ***"kể cả gián tiếp qua ID tuần tự, số thứ tự, hay thời gian phản hồi"***.
Vế "kể cả gián tiếp" là vế làm bất biến này khó, và nó biến việc chọn kiểu ID từ một chi tiết
kỹ thuật thành một quyết định bảo mật.

**Phương án đã cân nhắc.**

| Kiểu | Vấn đề với A5 |
|---|---|
| `bigserial` | Rò trực tiếp: `id=41` cho biết có 40 thứ trước nó. Loại ngay. |
| **UUIDv7** | **Chứa timestamp mili-giây ở 48 bit đầu và SẮP THEO THỨ TỰ.** Hai ID cho biết cái nào tạo trước và **cách nhau bao lâu**. Một nhà cung cấp có hai lời mời từ hai RFQ suy ra được nhịp phát hành; một nhà cung cấp giữ ID của chính mình đọc được **thời điểm nó được thêm vào hệ thống**. Đây đúng là *"gián tiếp qua số thứ tự"*. |
| **ULID** | Cùng một lỗi: sắp theo thời gian, có timestamp. |
| **UUIDv4** | 122 bit ngẫu nhiên, **không thứ tự, không timestamp**. Không rò gì. |

**Điểm dễ bị bỏ sót:** UUIDv7 đang là mặc định được khuyến nghị rộng rãi ở nơi khác vì nó thân
thiện với B-tree và giảm phân mảnh chỉ mục. Lời khuyên ấy đúng — **cho khoá nội bộ**. Áp nó cho
ID lộ ra ngoài là đổi một bất biến bảo mật lấy một cải thiện hiệu năng, và ở dự án này đó là
một cuộc đổi chác sai.

### Quyết định

1. **Mọi định danh mà nhà cung cấp nhìn thấy được — trong URL, trong payload API, trong email,
   trong biên nhận — là UUIDv4 ngẫu nhiên** (`gen_random_uuid()`).
2. **UUIDv7 chỉ được dùng cho khoá của bảng thuần nội bộ chưa từng lộ ra ngoài.** Một cột như
   vậy về sau bị lộ ra là **một thay đổi phải qua review**, không phải một dòng thêm vào response.
3. **Không mã tuần tự có thể đọc ở bất kỳ đâu nhà cung cấp thấy được** — không "RFQ-2026-0041",
   không số thứ tự lời mời. Mã dễ đọc cho **người mua** thì được, miễn nó không đi ra ngoài.

### Điều ADR này KHÔNG cho phép suy ra — và đây là phần dễ hiểu sai nhất

**ID không đoán được KHÔNG phải là kiểm soát truy cập.** **F2** nói thẳng: *"không IDOR — và
quyền truy cập không bao giờ dựa vào việc ID khó đoán"*. UUIDv4 mua đúng một thứ: **không suy
luận được từ chính con số**. Nó **không** mua quyền bỏ kiểm tra quyền. Mọi endpoint vẫn phải hỏi
*"actor này có được xem thực thể này không"*, và RLS ở tầng DB vẫn là lớp cuối.

Tương tự, **E4** nói mã RFQ không bao giờ là credential. ADR này **không** mâu thuẫn với E4 và
cũng **không** làm nhẹ nó: một UUIDv4 khó đoán vẫn **không phải** credential.

### Đo bằng gì

Một test đọc lược đồ và khẳng định **mọi cột định danh của các bảng có mặt trong response cho
nhà cung cấp** đều mặc định `gen_random_uuid()` — kiểu danh sách phải **suy từ tính chất**, không
từ một danh sách tên viết cứng. Khuôn danh-sách-tên đã hỏng ba lần trong S0 (khoản nợ 16, 17), và
S1 thêm 13 bảng là đúng lúc nó hỏng lần thứ tư nếu lặp lại.

---

## ADR-013 — Phạm vi sổ nhà cung cấp: **một sổ cho mỗi tổ chức mua; MST là dữ liệu, không phải khoá**

**Ngày:** 2026-08-29 · **Trạng thái:** **Đã chấp nhận** · Gỡ chặn: **S1.1** · Liên quan: **A5**, **E4**, **F1**, **F2**

**Bối cảnh.** S1.1 tạo hai bảng đầu tiên của S1 (`suppliers`, `supplier_contacts`). Câu hỏi chặn
không phải "cột nào" mà là **phạm vi**: một nhà cung cấp là thực thể **thuộc một tổ chức mua**,
hay một thực thể **dùng chung toàn hệ thống** mà nhiều tổ chức cùng trỏ tới? Định hướng sản phẩm
kéo về hướng dùng chung (Level 2 — Supplier Passport, ràng buộc 2 của `docs/PRODUCT.md`); cô lập
tổ chức kéo ngược lại. Phải chốt **trước** migration `008`: đổi phạm vi sau khi đã có dữ liệu là
một cuộc di trú xuyên tổ chức, không phải một cột thêm vào.

**Lớp lỗi này ĐÃ ĐƯỢC ĐO ở S0, hai lần, trên chính lược đồ đang chạy** — PostgreSQL 16.15, role
đăng nhập thật `app_api_login`, RLS bật đầy đủ, tenant context đúng:

- `organizations.slug` UNIQUE **toàn cục**: `UPDATE ... SET slug='cong-ty-b'` trả `duplicate key`,
  cùng câu với một slug không ai dùng trả `UPDATE 1`. Hai thông báo khác nhau = **một oracle nhị
  phân** trả lời *"đối thủ X có trên sàn không"*. (`db/migrations/002_organizations_and_users.sql`,
  khối `[CR3 — vòng fix 1]`.)
- `users_pkey` cùng khuôn, khai thác thực tế ≈ 0 vì `id` là 122 bit ngẫu nhiên — nhưng **khuôn**
  vẫn bị đóng, và cách đóng là **thu hẹp quyền theo cột**, không đụng ràng buộc. (Cùng file, khối
  `[vòng fix 2 — Minor]`.)

Nguyên lý đã nằm sẵn trong file đó: *"ràng buộc duy nhất TOÀN CỤC sẽ rò rỉ xuyên tổ chức qua
chính thông báo lỗi — RLS không che được lỗi ràng buộc, vì kiểm tra unique chạy dưới quyền hệ
thống trên toàn bảng."*

**MST làm khuôn ấy TỆ HƠN hai ca trên, không nhẹ hơn.** `slug` phải đoán từ tên công ty; `id` là
122 bit ngẫu nhiên. **Mã số thuế thì công khai và liệt kê được** — không gian tên hữu hạn, tra cứu
tự do. Một `UNIQUE (tax_code)` toàn cục biến *"tổ chức mua nào đang làm việc với nhà cung cấp
nào"* thành một câu hỏi **tra được bằng INSERT**, trên đúng tập dữ liệu có giá thương mại nhất của
một sàn thầu kín.

**Phương án đã cân nhắc.**

| Phương án | Vấn đề đo được |
|---|---|
| Sổ dùng chung toàn cục (`suppliers` không có `org_id`, `UNIQUE (tax_code)`) + bảng nối | ⑴ Oracle MST như trên. ⑵ Bảng không có `org_id` **nằm ngoài** `VI_TU_BANG_TENANT` của `hardening.always.sql`, và vị từ ấy giấu `OR relname IN ('organizations')` bên trong ⇒ **bảng gốc tenant thứ hai không bị kiểm RLS/FORCE và `rls-coverage.int.test.ts` cũng mù** (khoản nợ 16, ghi trước khi có ADR này). ⑶ Level 0 là *Guest Bidder*: hồ sơ do chính người mua tạo lúc mời ⇒ phân giải danh tính ở **đúng chỗ danh tính yếu nhất**. |
| Lai: sổ chung chứa dữ liệu công khai, sổ riêng chứa quan hệ | Vẫn phải trả lời *"hàng công khai này tồn tại chưa"* ⇒ **cùng một oracle, dời sang bảng khác**. Hoãn được chi phí, không hoãn được câu hỏi. |
| **Một sổ cho mỗi tổ chức mua** (`org_id NOT NULL`, `UNIQUE (org_id, tax_code)`) | Cùng một nhà cung cấp tồn tại nhiều bản, mỗi tổ chức một bản. **Chi phí có thật**, và nó rơi vào S3+ chứ không vào S1. |

### Quyết định

1. **`suppliers` và `supplier_contacts` là bảng tenant**: `org_id uuid NOT NULL REFERENCES
   organizations(id)`, `ENABLE` **và** `FORCE ROW LEVEL SECURITY`, policy có **cả** `USING` lẫn
   `WITH CHECK` tường minh, không mệnh đề `TO` — đúng khuôn 002, không phát minh khuôn mới.
2. **Mọi ràng buộc UNIQUE trên hai bảng này phải có `org_id` đứng ĐẦU.** `UNIQUE (org_id,
   tax_code)`, không `UNIQUE (tax_code)`. Đây là hệ quả trực tiếp của hai phép đo trên.
3. **MST là dữ liệu — không phải khoá, không phải credential.** `id` vẫn là `uuid DEFAULT
   gen_random_uuid()` theo **ADR-012**; **E4** giữ nguyên hiệu lực: biết MST không mở được gì.
4. **Trùng lặp xuyên tổ chức được CHẤP NHẬN ở S1.** Gộp hồ sơ / Supplier Passport (Level 2) thuộc
   S3+ và **phải mở một ADR mới** — ADR đó sẽ phải trả lời đúng câu hỏi oracle mà quyết định này
   đang tránh, chỉ khác là khi ấy có dữ liệu thật để đo.
5. **`app_unseal` không được cấp gì trên hai bảng này.** Chúng chứa dữ liệu cá nhân (tên, email,
   điện thoại người liên hệ) và runtime mở thầu không có việc gì với chúng — cùng lý do đã ghi
   cho `users` ở 002.

### Điều ADR này KHÔNG cho phép suy ra

**Sổ riêng theo tổ chức KHÔNG mua được A5.** A5 nói về thứ **nhà cung cấp** nhìn thấy; ADR này nói
về thứ **tổ chức mua** nhìn thấy. Hai bề mặt khác nhau. A5 vẫn phải cưỡng chế ở ứng dụng cộng
ADR-012 (S1.1 + S1.9 theo kế hoạch S1 §1).

Và RLS ở đây chặn đúng những gì 002 đã liệt kê — quên `WHERE org_id = ?`, IDOR tầng ứng dụng —
**không** chặn SQL injection hay một tiến trình `api` đã bị chiếm.

### Đo bằng gì

Một lớp **suy từ TÍNH CHẤT, không từ danh sách tên** — khuôn danh-sách-tên đã hỏng ba lần ở S0
(nợ 3, 16, 17). Vị từ đúng không phải *"mọi UNIQUE phải có org_id đứng đầu"* (nó sẽ đỏ oan trên
`users_pkey` và `organizations_slug_key`), mà là:

> **một ràng buộc UNIQUE/PK chỉ làm oracle được khi `app_api` GHI ĐƯỢC ĐỦ MỌI CỘT của nó.**
> Vậy: mọi ràng buộc UNIQUE/PK trên bảng có `org_id`, **mà `app_api` ghi được đủ mọi cột**, phải
> có `org_id` là cột đầu tiên.

Vị từ này phân loại đúng cả ba ca đang có: `organizations_slug_key` **đạt** (app_api không ghi
được `slug`), `users_pkey` **đạt** (không ghi được `id`), `users (org_id, email)` **đạt**
(org_id đứng đầu) — và một `UNIQUE (tax_code)` toàn cục có `GRANT INSERT (tax_code)` thì **đỏ**.
Một test đọc `pg_constraint` cộng `information_schema.role_column_grants` (phải đọc **cả** view
cột, vì quyền cột không hiện ở `role_table_grants` — đã đo ở 002) đóng lớp này cho **cả 13 bảng
mới của S1 cùng lúc**, không riêng `suppliers`.

**Phép đối kháng bắt buộc:** thêm một `UNIQUE (tax_code)` toàn cục ghi được → test phải **ĐỎ
THẬT**. Không có lượt RED đó thì đây chỉ là một câu văn.

---

## ADR-014 — Nơi cưỡng chế máy trạng thái RFQ: **CSDL giữ các cạnh và bất biến trên dữ liệu, ứng dụng giữ điều kiện cần ngữ cảnh**

**Ngày:** 2026-08-29 · **Trạng thái:** **Đã chấp nhận** · Gỡ chặn: **S1.2** · Liên quan: **C1**, **C2**, **C4**, **C5**, **D2**, **A6**

**Bối cảnh.** Các trạng thái và điều kiện chuyển **đã chốt** ở `docs/ARCHITECTURE.md` §6 — ADR này
**không** mở lại chúng. Cái còn treo, và nó chặn migration `008`, là **cưỡng chế ở đâu**. `app_api`
sẽ có `GRANT UPDATE` trên `rfq_packages` để làm việc của nó; kể từ giây đó, một câu
`UPDATE ... SET status='OPEN'` sai chỗ là **một dòng SQL**, không phải một cuộc tấn công.

**Tiêu chí chọn, và S0 đã trả tiền để học nó:** *cái gì hỏng **im lặng** thì xuống CSDL; cái gì
hỏng **ồn ào** thì ở ứng dụng.* Cùng tiêu chí đã đưa `audit_events` (trigger + REVOKE) và RLS
xuống tầng CSDL, và đã để E3 ở tầng ứng dụng **kèm một khối chú thích nói thẳng cái giá**
(`packages/identity/src/mfa-credentials.ts`, khối `[vòng fix 1 — MỤC 8 / M-1]`).

**Phương án đã cân nhắc.**

| Phương án | Vấn đề đo được |
|---|---|
| Toàn bộ ở ứng dụng — một hàm `transitionRfqStatus` | Một cạnh cấm đi lọt là **một thay đổi im lặng trên dữ liệu**: RFQ quay `CLOSED → OPEN` thì phong bì đã nộp vẫn nằm đó, không có gì đỏ, và dấu vết duy nhất là sổ kiểm toán *nếu* có ai đọc. Cùng họ với "quên `WHERE org_id`" mà ADR-003 đã chọn không tin. |
| Toàn bộ ở CSDL — trigger kiểm mọi cạnh + bảng cạnh hợp lệ | ⑴ Một phần điều kiện chuyển **CSDL không thấy được**: "phê duyệt hợp lệ" của D2 gắn với phiên và MFA (D1), "đủ số nhà cung cấp theo chính sách" là cấu hình. ⑵ Mỗi hàm plpgsql mới rơi thẳng vào **khoản nợ 3**: `assertTenantBound` ghim hàm theo **danh sách tên**, hàm ngoài danh sách **không được ghim**. Đẩy nhiều logic xuống plpgsql là nới rộng đúng lỗ đã đo. |
| **Lai theo tiêu chí trên** | Ranh giới **phải được ghim tường minh**, nếu không nó trôi về phía rẻ hơn. Phần dưới ghim nó. |

### Quyết định

**Ở tầng CSDL — bốn thứ, không hơn**, mỗi thứ vì một lý do có tên:

1. **`status` bị `CHECK` trên một tập đóng** — cùng khuôn `outbox_jobs.status` của 007.
2. **Trigger cấm mọi cạnh không có trong bảng cạnh hợp lệ.** Cạnh quan trọng nhất là cạnh **không
   tồn tại**: `CLOSED → OPEN`. ARCHITECTURE §6 đã viết *"Không tồn tại"*; ADR này biến câu đó
   thành một `RAISE EXCEPTION`.
3. **C4 — không rút ngắn deadline khi đã có báo giá:** trigger `BEFORE UPDATE` từ chối
   `NEW.deadline_at < OLD.deadline_at` khi RFQ đã có ≥ 1 báo giá. Đây là bất biến **trên dữ
   liệu**: nó đúng bất kể đường gọi nào. (Vế *lý do + audit + thông báo* của C4 thì ở ứng dụng.)
4. **C1 — phán quyết deadline trong CHÍNH transaction ghi báo giá**, đọc `rfq_packages` có khoá
   hàng, dùng `now()` của Postgres (**ADR-005**). Đây cũng là thứ làm **C2** đúng: job đóng RFQ
   chỉ đổi trạng thái hiển thị, nên **giết scheduler không làm bid muộn được nhận**.

**Ở tầng ứng dụng — và mỗi mục kèm cái giá của nó:**

5. Điều kiện chuyển cần ngữ cảnh: phê duyệt kép (**D2**), ngưỡng chính sách, số nhà cung cấp tối
   thiểu. Ràng buộc DB `UNIQUE (unseal_request_id, approver_user_id)` +
   `CHECK (approver_user_id <> requester_user_id)` chặn được *"hai người khác nhau"*, **không**
   chặn *"hai phiên khác nhau"* — đó là thuộc tính của phiên, không của hàng.
6. **A6 — chế độ nghiêm** (ẩn số báo giá đã nhận khỏi Buyer trước CLOSED) là **chính sách theo tổ
   chức**, ở ứng dụng.
7. **C5 — cặp khoá RFQ sinh đúng lúc chuyển sang OPEN:** hành vi sinh khoá ở ứng dụng, nhưng phần
   **cưỡng chế được** thì xuống CSDL — `rfq_key_material` chỉ tồn tại được cho RFQ **không còn ở**
   `DRAFT`/`PENDING_APPROVAL`. Nói hẹp và đúng: lược đồ chặn được *"có khoá quá sớm"*, **không**
   chặn được *"tới OPEN mà quên sinh khoá"*.

### Cái này KHÔNG đóng, và phải vào §4 của ma trận

- Vế *"hai phiên khác nhau"* của **D2** (kế hoạch S1 §3 đã ghi; không được nuốt vào ô ✅).
- Vế *"tới OPEN mà quên sinh khoá"* của **C5** — cưỡng chế ở ứng dụng, đo bằng test.
- **Cùng hạn chế cấu trúc đã ghi cho E3:** `app_api` có `GRANT UPDATE` trên `rfq_packages`, nên
  một `api` **bị chiếm** đi được mọi cạnh mà trigger cho phép và tắt được mọi phép kiểm ở mục
  5–7. Trigger chặn **lỗi lập trình**, không chặn **kẻ đã ở trong tiến trình**. Bí mật giá không
  dựa vào lớp này — nó dựa vào ADR-006 và phong bì.
- Mỗi trigger mới là **một hàm plpgsql mới** ⇒ **khoản nợ 3 nở ra** trừ khi `assertTenantBound`
  chuyển sang ghim theo **tính chất**. Ghi ra ở đây để nó không lặng lẽ lớn thêm.

### Đo bằng gì

Ba phép, cả ba phải có lượt **RED thật**:

1. **Đi vòng qua ứng dụng:** dùng `app_api_login` chạy
   `UPDATE rfq_packages SET status='OPEN' WHERE status='CLOSED'` → phải bị trigger chặn. Đây là
   phép đo **duy nhất** chứng minh lớp nằm ở CSDL chứ không ở một hàm TypeScript.
2. **Đột biến:** `DROP TRIGGER` → bộ test phải ĐỎ. Không đỏ nghĩa là trigger chưa từng được đo.
3. **C2:** dừng job runner **thật** (Testcontainers, hạ tầng đã có từ S0), đẩy đồng hồ DB qua
   deadline, nộp → phải bị từ chối. Không mock scheduler.

---

## ADR-015 — Kênh OTP cho phiên khách, và nền cưỡng chế giới hạn tần suất

**Ngày:** 2026-08-29 · **Trạng thái:** **Đã chấp nhận** · Gỡ chặn: **S1.3** · Liên quan: **E1**, **E2**, **E3**, **E5**, **E6**

**Bối cảnh.** **E2** đòi: *"Token một mình không đủ vào phiên báo giá — luôn phải qua OTP trên kênh
đã đăng ký."* Hai chỗ trống chặn S1.3: **kênh nào**, và **giới hạn tần suất chạy trên nền gì** —
vế **E3(2)** hôm nay **không có một dòng mã nào trong toàn S0** (khoản nợ 1;
`packages/identity/src/mfa-credentials.ts` ghi thẳng điều đó ở khối đầu file). Hai câu hỏi này
**không độc lập**: một kênh mất tiền mỗi tin làm giới hạn tần suất **đồng thời là một trần chi
phí**, không chỉ một biện pháp an ninh.

**Lập luận quyết định, và nó loại thẳng một phương án.** Magic link đi bằng email **và** OTP cũng
đi bằng email thì hai yếu tố nằm trên **cùng một kênh** — ai đọc được hộp thư đó có cả hai. **E5**
làm điều này cụ thể hơn chứ không nhẹ đi: *"link chuyển tiếp vẫn dùng được"* là hành vi **được
thiết kế**, và ở doanh nghiệp Việt Nam hộp thư nhận yêu cầu báo giá thường là hộp thư **chung của
phòng kinh doanh**. Một OTP về đúng hộp thư ấy **không thêm yếu tố nào**; nó chỉ thêm một bước bấm.

| Kênh | Đánh giá |
|---|---|
| Email | Rẻ nhất, không phụ thuộc nhà cung cấp dịch vụ VN nào. **Loại làm kênh OTP chừng nào magic link còn đi bằng email** — lý do ngay trên. |
| **SMS** tới số điện thoại người liên hệ | Khác kênh với email ⇒ E2 thật sự là **hai** yếu tố. Danh tính gắn với một cá nhân, không với một hộp thư chung. Giá: mỗi tin mất tiền, cần brandname, và SIM swap là rủi ro thật — nhưng nằm **dưới** mức rủi ro "hộp thư chung của cả phòng". |
| Zalo ZNS | Phổ biến nhất VN, rẻ hơn SMS. Nhưng cần Official Account và **template duyệt trước** ⇒ đưa một **bước phê duyệt của bên thứ ba vào đường găng S1.3**, và buộc một bước bắt buộc của luồng xác thực vào một nền tảng duy nhất. |

> **Một tiền đề của lập luận trên CHƯA ĐƯỢC ĐO, và nó phải được nói ra thay vì đi lẫn vào kết
> luận:** câu *"hộp thư nhận yêu cầu báo giá thường là hộp thư chung của phòng kinh doanh"* là một
> **giả định về thị trường**, không phải một phép đo — dự án chưa có khách hàng pilot (điểm chặn 1),
> nên chưa ai nhìn thấy một hộp thư thật. Giả định này **không** làm hỏng quyết định nếu sai: khi
> hộp thư là của một cá nhân, tách kênh vẫn đúng vì E5 cho phép chuyển tiếp link. Nhưng nó **phải**
> là một câu hỏi trong buổi làm việc đầu tiên với khách hàng pilot, và nếu sai theo hướng ngược lại
> — nhà cung cấp không sẵn lòng cho số điện thoại — thì mục 2 dưới đây phải mở lại.

### Quyết định

1. **Bất biến — đây mới là phần không được đổi: OTP KHÔNG BAO GIỜ đi cùng kênh với magic link.**
   Tên nhà cung cấp dịch vụ là chi tiết triển khai; câu này là quyết định.
2. **Kênh mặc định của S1: SMS** tới số điện thoại đã đăng ký của người liên hệ. **Zalo ZNS là
   kênh thay thế cấu hình được**, không nằm trên đường găng của S1.3.
3. **Gửi đi qua outbox** (**ADR-010**: bền + `NOTIFY` đánh thức), và một hệ quả **bắt buộc** từ hợp
   đồng của `enqueueJob` — *payload mang **tham chiếu**, không mang **giá trị***
   (`packages/outbox/src/enqueue.ts`): **mã OTP không bao giờ nằm trong `outbox_jobs.payload`**.
   Kéo theo một ràng buộc thiết kế có lý do kỹ thuật, không phải sở thích: **mã được sinh TRONG
   handler gửi**, ghi hash xuống bảng (**E1**), trao mã cho nhà cung cấp kênh, rồi bỏ khỏi bộ nhớ.
   Sinh trước rồi chỉ lưu hash thì handler **không đọc lại được** mã để gửi.
4. **Giới hạn tần suất (E3(2)) chạy trên Postgres**, không thêm thành phần hạ tầng. Không có một
   phép đo nào ở S1 đòi Redis, và mỗi thành phần mới kéo theo một bề mặt IAM phải cưỡng chế — đúng
   bài học ADR-006 → ADR-009 (*quyền chỉ cưỡng chế được bằng IAM của nơi compute chạy*). Đổi ý
   phải mở ADR mới **và phải kèm số đo**.
5. **Hai hạn mức, hai loại phản ứng khác nhau** — cùng đánh đổi đã ghi cho E3(1) ở
   `mfa-credentials.ts`: hạn mức theo **đích** (số điện thoại) chỉ được **làm chậm**, không được
   **khoá**, vì khoá theo đích cho phép một người khoá lối vào của người khác; hạn mức theo
   **người gọi** (phiên/IP) mới được khoá.

### Cái này KHÔNG đóng, và phải vào §4 của ma trận

- **"Kênh đã đăng ký" ở S1 là kênh do NGƯỜI MUA khai khi mời**, không phải kênh nhà cung cấp tự
  xác nhận. Nó chống được *"link bị chuyển tiếp"* (**E5**) và **không** chống được *"người mua khai
  sai số"*. Câu này phải nằm ở §4 khi `[INV-E2]` được gắn thẻ, nếu không ô ✅ sẽ rộng hơn cơ chế.
- **Chặng cuối** — tin nhắn thật sự tới tay ai đó — nằm ngoài Postgres, đúng như ADR-010 đã ghi cho
  D4. `SENT` trong outbox **không** là bằng chứng đã nhận.
- **Cùng hạn chế cấu trúc với E3(1):** bộ đếm nằm ở bảng mà `app_api` ghi được, nên một `api` bị
  chiếm tắt được nó bằng một câu `UPDATE`. Không tránh được nếu giữ E3 ở tầng ứng dụng — bỏ GRANT
  là bỏ luôn cơ chế, và thu hẹp xuống một hàm SECURITY DEFINER là thứ mục (C) của
  `hardening.always.sql` **cấm**.

### Đo bằng gì

1. **Đối kháng cho E3(2)** — vế chưa từng có một dòng mã nào: vô hiệu hoá bảng đếm → test phải
   **ĐỎ THẬT**. Đây là điều kiện để **gỡ** phần chênh của E3 khỏi §4, không phải để gắn thêm nhãn.
2. **Một phép quét khẳng định mã OTP không xuất hiện trong `outbox_jobs.payload`** — chạy trên dữ
   liệu thật của test, không đọc mã nguồn.
3. **E2 phải được đo như một phép HỘI**, không phải hai phép rời: có token hợp lệ **và không** qua
   OTP → phải bị từ chối. Đây đúng cái bẫy **D1** đang mắc ở §4 (bốn vế đo riêng ở hai file, phép
   hội chưa từng được đo một lần). S1.3 là chỗ không được lặp lại nó.

---

## ADR-016 — Nơi đặt cổng quyền: **ở tầng ứng dụng; và danh tính đã xác thực phải là DẪN XUẤT, không phải THAM SỐ**

**Ngày:** 2026-08-30 · **Trạng thái:** **Đã chấp nhận** · Sinh ra từ: **MEDIUM-3** của lượt review S1.1 (`ac77e3c`) · Liên quan: **D3**, **D5**, **F2**

**Bối cảnh.** Lượt `security-reviewer` trên S1.1 nêu: *không có một phép kiểm thẩm quyền nào trong
`packages/supplier`; `actor` là lời khai*. Đã đọc lại mã để xác nhận thay vì tin phát hiện: **sáu**
hàm export của `packages/supplier/src/suppliers.ts` gọi `assertTenantBound` trước mọi thứ — và
`assertTenantBound` **không phải một lớp an ninh**, chính khối chú thích đầu file nói vậy: *"nó
KHÔNG phải một lớp an ninh thứ hai mà là một lớp chống HIỂU LẦM"* — rồi ghi `actorType`/`actorId`
thẳng vào sổ kiểm toán. `packages/rfq` và `packages/invitation` cùng hình dạng (`RfqActor`,
`InvitationActor`, cùng hai trường `type`/`id`).

**Hai câu hỏi bị gộp làm một, và tách chúng ra là phần có giá trị nhất của ADR này:**

1. **Phép kiểm quyền chạy ở đâu** — trong gói nghiệp vụ, hay ở tầng ứng dụng?
2. **Danh tính ghi vào sổ kiểm toán đến từ đâu** — người gọi khai, hay hệ thống đọc ra?

Câu (2) **không** được trả lời bằng câu (1). `requirePermission` cũng nhận `userId` **dưới dạng
tham số**; chuyển cổng vào trong gói chỉ dời chỗ tiêu thụ lời khai chứ không biến nó thành sự thật.

**Và dự án đã có sẵn lời giải đúng cho câu (2), ở đúng lát cắt này.** Vòng sửa S1.2 (H-1) đã biến
`rfq_packages.created_by` từ lời khai thành **dẫn xuất**: `createRfq` nay đòi `createdBySessionId`,
và trigger `rfq_packages_kiem_nguoi_tao` (011) đòi `sessions.user_id = created_by`. Chú thích của
chính trường ấy ghi lại ca tấn công đã đo: *"Mallory gọi `createRfq({ createdBy: idCuaBob, actor:
Mallory })` rồi tự duyệt được, vì trigger so `Bob = Mallory` → sai → cho qua. D2 tụt từ 'hai người
khác người tạo' xuống 'một người'."* Ba CRITICAL của S1.3 là **cùng một hình dạng** và đã được đóng
bằng **cùng một cách**: thêm một cạnh dữ liệu, rồi để trigger đòi các cạnh nhất quán. ADR này chỉ
làm một việc — **phát biểu cái khuôn ấy thành quy tắc chung** thay vì để mỗi lượt review tự tìm lại.

### Phương án cho câu (1)

| Phương án | Đánh giá |
|---|---|
| **A. Cổng nằm TRONG mỗi gói nghiệp vụ** (mỗi hàm gọi `requirePermission` đầu tiên) | Mặc định ĐÓNG cho một hàm mới — đúng khuôn dự án ưa. Nhưng: `requirePermission` cần **`auditPool`** (một transaction ĐỘC LẬP, để một lần từ chối sống sót qua rollback của người gọi) ⇒ mọi chữ ký của mọi gói phải mang thêm một `pg.Pool`; mọi gói nghiệp vụ phải phụ thuộc `@trustprocure/identity` ⇒ nở đồ thị phụ thuộc theo hướng ngược với ADR-006. Và nó **không** trả lời câu (2). |
| **B. Cổng ở tầng ứng dụng** (route / composition root), gói nghiệp vụ giữ nguyên | Mã quyền hiện có ánh xạ theo **ca sử dụng**, không theo hàm: `supplier.manage` là một mã cho cả sáu hàm, và `listSuppliers` còn có đường gọi **không có người dùng nào** (runner outbox chạy dưới `app_api`). ADR-014 mục 5 đã đặt *"điều kiện cần ngữ cảnh"* ở tầng ứng dụng. **Nhược điểm thật: mặc định MỞ** — một route mới không có cổng thì không lớp nào kêu. |
| C. Lai: cổng ở ứng dụng + gói tự kiểm một tập con | Có hai chỗ để tìm khi hỏi *"cái gì canh hàm này"*, và không chỗ nào là câu trả lời đủ. Loại. |

### Quyết định

1. **Cổng quyền (`requirePermission`) nằm ở TẦNG ỨNG DỤNG**, không ở gói nghiệp vụ — phương án B,
   vì ba lý do trên và vì ADR-014 mục 5 đã đặt nó ở đó.
2. **Bất biến, và đây mới là phần không được đổi: không gói nghiệp vụ nào được NHẬN một danh tính
   đã xác thực dưới dạng tham số.** Hàm nào ghi một danh tính vào dữ liệu hoặc vào sổ kiểm toán thì
   phải nhận **một `sessionId`** và để danh tính là **dẫn xuất** của nó — đúng khuôn
   `createdBySessionId` + `rfq_packages_kiem_nguoi_tao` đã dựng ở 011, và đúng khuôn
   `guest_sessions.verified_contact_id` đọc ra từ thách thức OTP đã dựng ở 012.
3. **Hệ quả bắt buộc, ghi ra để nó không bị bỏ quên:** `SupplierActor` và `InvitationActor` phải đi
   theo đường ~~mà `RfqActor` đã đi~~ **mà `rfq_packages.created_by` đã đi**. Chừng nào chưa đi,
   **không ô ✅ nào của D5 hay F2 được gắn dựa trên chúng**, và docstring của chúng phải nói thẳng
   đó là lời khai.

   > **Câu vừa gạch là một khẳng định RỘNG HƠN thứ đã đo, và nó bị bắt khi bắt đầu cài — bốn giờ
   > sau khi chính tôi viết nó.** Thứ đi đúng đường ở vòng sửa S1.2 là **cột `created_by`**, không
   > phải `RfqActor`: `createRfq` tới hôm nay **vẫn** nhận `actor: RfqActor` làm tham số và ghi
   > thẳng nó vào sổ kiểm toán. Tức `packages/rfq` mang **đúng khiếm khuyết** mà MEDIUM-3 nêu cho
   > `packages/supplier` — nó chỉ không bị lượt review nào gọi tên. Đây là lớp lỗi mà quy ước
   > *"một câu phát biểu rộng hơn thứ được đo là một khiếm khuyết thật"* tồn tại để bắt, và nó vừa
   > bắt được chính tài liệu đặt ra quy ước ấy.
   >
   > ~~**`RfqActor` vì vậy là một hạng mục CÒN LẠI CÓ TÊN**, không phải một thứ đã xong.~~
   > **ĐÃ ĐÓNG 2026-09-03** (migration `016`): `RfqActor` bị xoá, và **`createdBy` cùng
   > `approverUserId` biến mất theo** — cả hai là dẫn xuất mà trigger 011 đã ép bằng chủ phiên,
   > tức hai chỗ để gõ nhầm chứ không phải hai bậc tự do. Bốn cạnh chuyển trạng thái nay mang chữ
   > ký (`submitted_by`, `opened_by`, `closed_by`, `cancelled_by`); `extendRfqDeadline` cố ý
   > **KHÔNG** có, vì nó không đổi `status` nên không có cạnh để treo một `WHEN`, và một cột
   > `deadline_changed_by` chỉ giữ được LẦN CUỐI — tức trả lời SAI câu hỏi kiểm toán thật.
4. ~~**Cổng ở tầng ứng dụng là mặc định MỞ, nên nó PHẢI kèm một lớp máy — và lớp ấy CHƯA DỰNG
   ĐƯỢC HÔM NAY vì `apps/` rỗng.**~~ **ĐÃ DỰNG 2026-09-03** —
   `tests/architecture/cong-quyen-route.test.ts`, ra đời **TRƯỚC** route đầu tiên. Điều kiện ghim
   gốc giữ nguyên văn: **route đầu tiên của `apps/` ra đời CÙNG LÚC với một lớp canh khẳng định
   mọi route đổi trạng thái đều nêu tên một mã quyền.** Viết route trước, lớp canh sau, là đúng
   thứ tự đã sinh ra khoản nợ 17 (*"LẦN THỨ BA CÙNG MỘT LỚP LỖ"*).

   > **Vị từ KHÔNG dùng chữ "route"**, vì framework chưa được chọn nên canh theo route là canh
   > theo một thứ chưa tồn tại. Nó nói: *một module trong `apps/` gọi tới một hàm ĐỔI TRẠNG THÁI
   > thì phải nhắc tới `requirePermission`*. Đó là vị từ **yếu hơn** "route có đúng mã quyền", và
   > file tự viết ra chỗ yếu: nó không kiểm mã quyền có ĐÚNG, không kiểm cổng chạy TRƯỚC lời gọi,
   > và một `requirePermission` nằm trong nhánh chết vẫn đi lọt. Nó đóng đúng MỘT đường — hình
   > dạng của một sơ suất thật, không phải hình dạng của một kẻ tấn công.
   >
   > **Lớp thứ hai mới là lớp giữ nó không tự làm mù mình:** danh sách hàm-đổi-trạng-thái được
   > đối chiếu với **TẬP EXPORT THẬT** của ba barrel, nên một hàm ghi mới thêm vào ngày mai buộc
   > phải được phân loại. Không có nó, đây lại là *"hàng rào tự làm mù mình bằng một danh sách
   > tên"* — khuôn mà khoản nợ 3 và 16 đã ghi hai lần.
   >
   > **Và nó CHƯA canh gì cả hôm nay.** File tự nói ra bằng một khẳng định riêng: `apps/` chưa có
   > module `.ts` nào. Cùng tình cảnh hàng rào `g1-` ở khoản nợ 14. Khi `apps/` có module đầu
   > tiên, khẳng định "rỗng ruột" ấy ĐỎ và phải bị xoá — đó là dấu hiệu lớp trên bắt đầu có nghĩa.
5. **`hasPermission` ở lại ngoài barrel** (Task 9, vòng fix 1). ADR này **không** nới nó: một cổng
   gác dựng bằng nó vi phạm D5 trong im lặng, và điều đó đã được đo (11 mã quyền dò qua
   `hasPermission` → sổ kiểm toán trước = 3, sau = 3).

### Điều ADR này KHÔNG đóng

- **Nó không làm `app_api` bị chiếm trở nên vô hại.** Một tiến trình `api` đã bị chiếm đặt được
  `sessionId` nào nó muốn trong phạm vi các phiên đang sống. Cùng hạn chế cấu trúc đã ghi cho E3
  và cho ADR-014: trigger chặn **lỗi lập trình**, không chặn **kẻ đã ở trong tiến trình**.
- **Nó không cưỡng chế được ở tầng CSDL cho các bảng chỉ ĐỌC.** `listSuppliers` không ghi gì, nên
  không có hàng nào để trigger soi. Lớp duy nhất cho đường đọc là cổng ở route — tức đúng chỗ mục 4
  nói là mặc định mở.
- **Mã `ROLE_GRANT` vẫn chưa vai trò nào giữ** (fail-closed có chủ đích, ghi ở `permissions.ts`).
  ADR này không quyết vai trò nào được quản trị vai trò.

### Đo bằng gì

1. **Đối chứng dương trước đã:** viết một test dựng lại ca Mallory cho `packages/supplier` —
   `createSupplier` với `actor.id` là một UUID **không thuộc phiên nào** phải bị từ chối sau khi
   mục 2–3 được cài. Trước khi cài, cùng test ấy phải **THÀNH CÔNG** — không có vế đó thì không ai
   biết lỗ có thật.
2. **Đột biến:** gỡ trigger đòi `sessions.user_id = actor_id` → test phải **ĐỎ THẬT**.
3. **Lớp canh của mục 4** đo bằng chính nó: thêm một route không nêu mã quyền → CI phải đỏ.

---

## ADR-017 — Chính sách tính `requires_dual_approval`: **ngưỡng theo tổ chức, CÓ PHIÊN BẢN, và kết luận phải TÁI LẬP ĐƯỢC**

**Ngày:** 2026-08-30 · **Trạng thái:** **Đã chấp nhận** · Sinh ra từ: **M-6** của lượt review S1.2 (`fcd5986`) · Gỡ chặn: **D2** · Liên quan: **C3**, **A4**

**Bối cảnh.** `rfq_packages.requires_dual_approval boolean NOT NULL DEFAULT true` tồn tại từ 009 và
**không có một dòng mã nào tính nó**: `createRfq` nhận nó qua `input.requiresDualApproval ?? true`.
Mặc định `true` là mặc định đóng và điều đó đúng — nhưng một cờ mà **người gọi tự đặt** thì D2
(*"RFQ vượt ngưỡng cần 2 phê duyệt"*) chưa có ngưỡng nào cả.

Khối đầu 009 giải thích vì sao cờ là `boolean` chứ không phải một số tiền: `rfq_items` **không có
một cột giá nào**, cố ý, vì *"bảng không có cột thì không có gì để nhớ"*. Lập luận ấy vẫn đúng cho
**giá** — nhưng nó đã bị kéo dài **một bước quá xa**, và bước ấy là chỗ ADR này can thiệp.

**Ba ràng buộc độc lập cùng chỉ về một hướng:**

1. **PRODUCT.md §8 ràng buộc 5:** *"Mọi ngưỡng chính sách … phải cấu hình được theo từng doanh
   nghiệp. Không hard-code."* ⇒ ngưỡng là **dữ liệu theo tổ chức**, không phải hằng số.
2. **USP 3 là *Procurement Governance* — "tạo bằng chứng kiểm toán".** Một `boolean` trần là một
   phán quyết **không kiểm toán được**: kiểm toán viên hỏi *"vì sao RFQ này chỉ cần một phê duyệt"*
   và trong dữ liệu **không có câu trả lời**. Đây không phải chuyện tiện dụng; nó là chức năng
   chính của sản phẩm bị thiếu ở đúng chỗ.
3. **North Star Metric là *Verified Competitive Spend* — "giá trị mua sắm đã đi qua một quy trình
   cạnh tranh".** Chỉ số bắc đẩu của sản phẩm có **đơn vị là tiền**, và trước lúc award, số tiền
   duy nhất tồn tại là **ước lượng của người mua**. Không có cột ấy thì chỉ số ấy **không tính được
   bằng bất cứ cách nào** — độc lập hoàn toàn với D2.

### Quyết định

1. **Ngưỡng là chính sách THEO TỔ CHỨC, lưu trong một bảng có PHIÊN BẢN** (`org_procurement_policies`,
   migration đánh số mới). Không hằng số trong mã, không biến môi trường.
2. **Ứng dụng tính, CSDL lưu kết luận — nhưng KHÔNG được lưu kết luận TRẦN.** ~~Cùng hàng
   `rfq_packages` phải mang **phiên bản chính sách đã áp** và **giá trị đã đem so**~~ **Một hàng
   `rfq_budgets` phải mang một khoá ngoại tới đúng phiên bản chính sách đã áp, cộng giá trị đã đem
   so**, đủ để phân loại được **tái lập** về sau. `requires_dual_approval` giữ nguyên là cột quyết
   định (trigger `rfq_kiem_chuyen_trang_thai` ở 011 đọc đúng cột này để đếm phê duyệt trên băm nội
   dung); bằng chứng nằm ở bảng riêng, không phải đầu vào thứ hai của trigger.

   > **Hai thu hẹp mà lượt cài đặt bắt được, ghi tại chỗ (2026-08-30):** ⑴ **`policy_version` KHÔNG
   > được chép vào bảng bằng chứng.** `policy_id` là khoá ngoại tới một hàng **không sửa được**,
   > nên nó đã xác định cả phiên bản lẫn ngưỡng; chép thêm một bản là tạo hai nguồn sự thật có thể
   > lệch nhau — đúng lớp lỗi mà `TAX_CODE_PATTERN` phải dựng một meta-test để canh. ⑵ **Phép so
   > nằm ở SQL, không ở TypeScript** (`public.rfq_can_phe_duyet_kep`, 014). Trigger cưỡng chế
   > *bắt buộc* phải có phép so ấy; một bản thứ hai ở TypeScript là hai bản sao của một luật — và
   > bản TypeScript còn sai theo cách riêng của nó, vì tiền trong JavaScript là `double`.
3. ~~**`rfq_packages.estimated_value`**~~ **`rfq_budgets.estimated_value`** **(+ `currency`) ra đời
   — ước lượng của NGƯỜI MUA, không bao giờ là giá của nhà cung cấp.** Câu ở đầu 009 — *"NGƯỠNG
   của D2 KHÔNG được lưu dưới dạng một số tiền"* — **được thu hẹp**: nó đúng cho **giá thầu**
   (A3/A4), không đúng cho **ngân sách của bên mua**. Vì 009 là migration đánh số đã áp và **không
   được đụng** (sửa chú thích cũng đổi checksum), phần đính chính nằm ở **migration mới cộng ADR
   này** — đúng cách đóng đã ghi cho khoản nợ 19.
4. **Không mặt tiền nào hướng nhà cung cấp được trả về `estimated_value`.** Công bố ngân sách cho
   bên dự thầu là **neo giá** — nó làm hỏng chính thứ Blind Procurement mua về. ~~Cưỡng chế bằng
   **quyền theo cột** cho đường khách cộng một test trên đường `guest_sessions`, không bằng một
   dòng chú thích.~~

   > **Câu vừa gạch KHÔNG CÀI ĐƯỢC, và lý do là cấu trúc chứ không phải công sức:** đường khách và
   > đường người mua dùng **CHUNG một role CSDL** (`app_api`) — không có role thứ ba để thu hẹp
   > quyền cho riêng đường khách. Thứ thay thế được đưa vào 014 là **tiền nằm ở BẢNG RIÊNG**, dùng
   > đúng lập luận 009 đã dùng để không cho `rfq_items` một cột giá: *"bảng không có cột thì không
   > có gì để nhớ"*. Một cột trên `rfq_packages` sẽ đi theo mọi `SELECT *` và mọi hàm đọc RFQ về
   > sau, và lớp phòng thủ duy nhất sẽ là trí nhớ của người viết truy vấn tiếp theo.
   >
   > **Phần còn lại là một khoản nợ có tên và có mốc:** khi **S1.5** dựng đường đọc RFQ cho phiên
   > khách, đường ấy phải được **đo** là không chạm `rfq_budgets`. Hôm nay `packages/invitation`
   > không đọc `rfq_packages` một lần nào, nên chưa có gì để đo.
5. **Fail-closed giữ nguyên và mạnh hơn:** thiếu chính sách, thiếu ước lượng, hoặc chính sách không
   quyết được ⇒ `requires_dual_approval = true`. Đây là lý do cột giữ `DEFAULT true` chứ không
   chuyển sang `NOT NULL` không mặc định.

### Điều ADR này KHÔNG đóng — và mục đầu là mục quan trọng nhất

- **Người mua khai ước lượng THẤP để né phê duyệt kép.** Đây là cách né kinh điển của mọi kiểm soát
  theo ngưỡng, cùng họ với **chia nhỏ đơn hàng**, và ADR này **không** chống được: ước lượng là số
  do chính người mua nhập. Thứ bắt được nó là **so ước lượng với giá trúng sau mở thầu** và **phát
  hiện chia nhỏ** — cả hai thuộc **S2/S3**, không thuộc S1. Ghi ra ở đây để không ai đọc ô ✅ của
  D2 rộng hơn cơ chế.
- **Vế *"hai phiên khác nhau"* của D2** vẫn mở, đúng như ADR-014 đã ghi.
- ~~**Ai được sửa chính sách** là một câu hỏi của ADR-016 mục 4 (mã quyền cho route ấy), chưa quyết
  ở đây.~~ **Chốt 2026-09-06 cùng ADR-020:** mã quyền mới `policy.manage`, gán cho
  `PROCUREMENT_MANAGER` (migration `030`, S1.10.5). `BUYER` không được — người khai ước lượng
  không được là người đặt ngưỡng; `DIRECTOR` cố ý không được, cùng lý do đã ghi cho `rfq.open`.
- **[review lượt 2 của S1.10, H2-2 — cùng ngày] Người đặt ngưỡng TỰ đặt được ước lượng.**
  `PROCUREMENT_MANAGER` giữ `rfq.create` (ước lượng), `rfq.approve` và `policy.manage`: một PM nâng
  ngưỡng lên rất cao rồi khai ước lượng dưới ngưỡng ⇒ một phê duyệt là đủ. Cùng họ với mục đầu
  (khai thấp), nhưng KHÔNG cần khai thấp — chỉ cần đổi thước. ~~Chưa quyết: tách `policy.manage` sang
  một vai không có `rfq.create`, hay mở rộng trigger D3 (`role_permissions_ma_tran_quyen`) cấm một
  vai giữ cả hai. Sổ nợ 44; §4 của D2 ghi phần chênh này.~~ **Chốt cùng ngày (nợ 44 đóng, migration
  `033`): CẢ HAI.** `policy.manage` chuyển sang `FINANCE` — vai không có `rfq.create`, `rfq.approve`,
  `rfq.unseal`: nó đặt thước, không cầm thứ bị đo; `DIRECTOR` vẫn không được (lý do 023). Và quy tắc
  *"`policy.manage` không đứng cùng `rfq.create`/`rfq.approve`"* thành hai trigger MỚI (không sửa thân
  D3 của 005 — hardening ghim nguyên văn): mức vai trò và mức người dùng (hợp các vai). Danh sách loại
  trừ `POLICY_MANAGE_EXCLUDES` ở ba bản, meta-test khoá. Cái mục này VẪN không đóng: khai thấp.

### Đo bằng gì

1. **Tái lập được:** tạo RFQ dưới chính sách phiên bản *n*, xoay chính sách sang *n+1* với ngưỡng
   khác → phân loại của RFQ cũ **không đổi**, và tính lại từ `(phiên bản đã lưu, giá trị đã lưu)`
   cho ra **đúng** cờ đã lưu.
2. **Fail-closed:** tạo RFQ **không** có `estimated_value` → cờ phải là `true`. Đột biến: đổi mặc
   định thành `false` → test phải **ĐỎ THẬT**.
3. **Neo giá:** đường đọc RFQ của phiên khách phải **không** chứa `estimated_value`. Đột biến: thêm
   cột ấy vào câu `SELECT` của đường khách → test phải **ĐỎ THẬT**. Đây là phép đo duy nhất chứng
   minh mục 4 là một lớp chứ không phải một lời hứa.
4. **Khai thấp: CỐ Ý KHÔNG CÓ PHÉP ĐO Ở S1**, và chỗ trống này phải nằm ở §4 của ma trận khi
   `[INV-D2]` được gắn thẻ.

---

## ADR-018 — Pepper cho băm đích và băm bộ đếm: **HMAC với một khoá giữ NGOÀI CSDL, có phiên bản**

**Ngày:** 2026-08-30 · **Trạng thái:** **Đã chấp nhận** · Sinh ra từ: **M1** của lượt review S1.3 (`bca870f`) · Liên quan: **E3**, **F3**, ADR-009, ADR-013

**Bối cảnh.** Hai chỗ băm một định danh liên lạc rồi lưu băm xuống bảng:
`invitation_otp_challenges.destination_hash` (đích đã thật sự gửi) và `otp_rate_limits.bucket_hash`
(bộ đếm hạn mức). Cả hai là `sha256(orgId ‖ nhãn ‖ giá trị)` — hàm `bam()` ở
`packages/invitation/src/invitation.ts`.

**Phần đã đóng, và nó đã được ghi tại chỗ:** `orgId` nằm **trong** phép băm. Không có nó, cùng một
số điện thoại cho cùng một `bucket_hash` ở **mọi** tổ chức, và một bản sao lưu cho phép JOIN giữa
hai tổ chức để trả lời *"hai bên mua này có cùng nhà cung cấp không"* — đúng tài sản mà **ADR-013**
dành trọn một ADR để bảo vệ.

**Phần còn lại là M1:** không gian số di động Việt Nam cỡ **10⁹**. SHA-256 trần trên một không gian
cỡ ấy **đảo ngược được bằng liệt kê** — với `org_id` nằm sẵn trong cùng bản sao lưu, kẻ có bản sao
lưu dựng lại được **danh bạ**. Cột được thêm ở 012 chính vì lý do bảo mật (*"lưu BĂM chứ không lưu
số"*), nên để nó ở dạng đảo ngược được là **giữ hình thức mà mất nội dung**.

### Phương án

| Phương án | Đánh giá |
|---|---|
| **A. Pepper — HMAC-SHA256 với một khoá bí mật giữ ngoài CSDL** | Kẻ **chỉ có bản sao lưu** không liệt kê được, cũng không **xác nhận** được một số đoán. Chi phí: một khoá nữa phải xoay và phải không bao giờ vào CSDL. |
| B. KDF chậm (scrypt/argon2) thay pepper | Giới hạn tần suất nằm trên **đường nóng của mọi yêu cầu OTP**; một KDF chậm ở đó là một trục DoS tự tạo. Và với 10⁹ ứng viên, chậm chỉ làm **đắt**, không làm **không thể**. Loại. |
| C. Gọi KMS cho mỗi phép băm (`GenerateMac`) | Khoá không bao giờ rời KMS — mạnh nhất. Nhưng nó biến **mỗi lần đếm** thành một lời gọi mạng, khác hẳn bậc chi phí mà ADR-009 đã đo và chấp nhận (**đúng 1 lời gọi KMS cho một lượt mở thầu**). Loại cho đường nóng. |
| D. Bỏ hẳn cột `destination_hash` | Xem *Điều ADR này KHÔNG đóng* — đây là phương án thay thế **trung thực**, không phải một phương án tồi. |

### Quyết định

1. ~~**Cả hai phép băm**~~ **BA phép băm chuyển sang HMAC-SHA256 với một pepper**, không phải
   SHA-256 trần.

   > **Phép băm thứ ba được tìm ra KHI CÀI, không phải khi viết ADR này (2026-08-30):**
   > `invitation_otp_challenges.code_hash` là `sha256(invitation_id ‖ code)`, mà **mã OTP chỉ có
   > SÁU CHỮ SỐ** — 10⁶ tiền ảnh — và `invitation_id` nằm ngay trong cùng bản sao lưu. Kẻ có bản
   > sao lưu đọc ra mã của **mọi thách thức chưa tiêu thụ** trong vài giây. **E1** nói CSDL chỉ
   > giữ *băm* của mã; khi băm đảo ngược được, *"chỉ giữ băm"* và *"giữ mã"* là một câu.
   >
   > Ba phép băm KHÔNG được pepper, và sự vắng mặt ấy cũng là một quyết định: `token_hash` của
   > magic link, của phiên khách và của `sessions` có tiền ảnh **32 byte ngẫu nhiên**, nên liệt kê
   > là vô nghĩa. Mỗi chỗ dùng pepper là một chỗ phải xoay đúng; thêm ở đó không mua được gì.
2. **Pepper nằm ở kho bí mật của hạ tầng đích** (AWS — ADR-009), nạp lúc khởi động tiến trình.
   **Không bao giờ vào CSDL** — để nó cạnh dữ liệu là xoá sạch lý do nó tồn tại — **không vào
   repo, không vào log** (quy ước bắt buộc: không bao giờ ghi log khoá, bí mật).
3. **Pepper CÓ PHIÊN BẢN, và mỗi băm mang theo phiên bản đã dùng.** Cùng khuôn `MasterKeyRing`
   (`activeVersion` + bản đồ phiên bản, khoá 32 byte) và cùng khuôn ADR-011 bắt phong bì mang mã
   thuật toán. Lý do cụ thể: `otp_rate_limits` có cửa sổ ngắn nên xoay pepper chỉ làm bộ đếm bắt
   đầu lại — vô hại; nhưng `destination_hash` là **dữ liệu kiểm toán sống lâu**, và xoay pepper mà
   không ghi phiên bản là **làm chết** khả năng đối chiếu của mọi hàng cũ.
4. **Một pepper, không phải hai.** Tách miền đã có sẵn trong đầu vào băm bằng nhãn (`'DEST'`,
   `'CALLER'`, `'INVITATION'`); thêm một pepper thứ hai chỉ thêm một thứ phải xoay.

### Điều ADR này KHÔNG đóng

- **Pepper chỉ chặn kẻ CHỈ có bản sao lưu CSDL.** Kẻ đã ở trong tiến trình `api` có cả hai thứ.
  Cùng hạn chế cấu trúc đã ghi cho E3 ở `mfa-credentials.ts` và nhắc lại ở 010 khi cấp
  `GRANT DELETE ON otp_rate_limits`.
- **Sau vòng sửa 011/012, `destination_hash` gần như DƯ — và điều này phải nói ra thay vì để nó
  lặng lẽ biện minh cho một khoản đầu tư.** Đích nay **đọc từ `supplier_contacts`** chứ không nhận
  từ tham số (C1), và 011 đã **`REVOKE UPDATE ON supplier_contacts FROM app_api`** — nên
  `contact_id` + `channel` đã xác định đích, và người liên hệ không sửa được. Giá trị **còn lại**
  của cột là ghim giá trị **tại thời điểm gửi**, phòng một migration tương lai cấp lại `UPDATE`.
  Đó là một giá trị thật nhưng **hẹp**. Nếu ai đó thấy pepper là đắt, câu trả lời đúng là **bỏ
  cột** (phương án D) — **không** phải giữ cột với một phép băm đảo ngược được.

  > **Lượt cài KHÔNG chọn phương án D, và lý do làm câu hỏi biến mất chứ không phải cân đo lại
  > (2026-08-30):** `otp_rate_limits.bucket_hash` **bắt buộc** phải có pepper — nó là khoá bộ đếm,
  > không dư chút nào — và `code_hash` cũng vậy sau phát hiện ở mục 1. Khi cơ chế đã phải tồn tại
  > cho hai cột, chi phí biên của cột thứ ba là **một dòng**. Bỏ cột vẫn là một lựa chọn hợp lệ về
  > sau; nó chỉ không còn tiết kiệm được gì.
- **`callerFingerprint` vẫn là một hợp đồng không cưỡng chế được bằng máy**: docstring của nó đòi
  dẫn xuất từ một nguồn không giả mạo được, *"không lớp máy nào cưỡng chế được điều này"*. Pepper
  không đụng tới điều đó. Đây là lý do bucket theo **lời mời** tồn tại.

### Đo bằng gì

1. **Đối chứng DƯƠNG trước, và đây là phép đo chịu lực:** trên một không gian **giả lập nhỏ**
   (10⁴ số), một vòng liệt kê phải **TÌM RA** số từ băm khi **không** có pepper — bằng chứng rằng
   phép đảo ngược là thật chứ không phải một lo ngại trên giấy — và phải **THẤT BẠI** khi có
   pepper. Không có vế dương, "không tìm ra" cũng làm test xanh.

   > **ĐÃ ĐO 2026-08-30, Node 22, một luồng — và phép đo này chạy TRƯỚC khi viết một dòng mã nào
   > của lượt cài:**
   >
   > ```text
   > khong gian gia lap        : 10000 so
   > KHONG pepper -> tim duoc  : 0900007321 (11 ms)
   > CO pepper    -> tim duoc  : null       (12 ms)
   > chi phi ~1 bam            : 0.0011 ms
   > ngoai suy 10^9 (1 luong)  : 18.3 phut
   > ```
   >
   > **18 phút** là con số biến M1 từ một lo ngại thành một việc phải làm. Cả hai vế nay là test
   > thường trực trong `packages/invitation/src/invitation.int.test.ts`.
2. **Phiên bản:** cùng một đích, hai phiên bản pepper → hai băm **khác nhau**; và một hàng mang
   phiên bản cũ vẫn đối chiếu được sau khi đã xoay.
3. **Quét trên dữ liệu thật của test**, không đọc mã nguồn: pepper không xuất hiện trong
   `outbox_jobs.payload`, không trong `audit_events`, không trong bất kỳ cột nào của
   `invitation_otp_challenges` hay `otp_rate_limits`.

---

## ADR-019 — Nơi cặp khoá RFQ ra đời: **trong `api`, sống trong đúng một hàm, và G1 phải được viết HẸP LẠI thay vì được khai rộng**

**Ngày:** 2026-09-04 · **Trạng thái:** **Đã chấp nhận** · Gỡ chặn: **S1.4** · Liên quan: **G1**,
**G2**, **C5**, ADR-002, ADR-006, ADR-011

### Bối cảnh — một câu hỏi mà bốn tài liệu đều giả định là đã có câu trả lời

Bất biến **C5** đòi *cặp khoá RFQ chỉ sinh đúng lúc chuyển sang OPEN*. Bất biến **G1** đòi
*private key RFQ không bao giờ ở dạng rõ ngoài `unseal-worker`*. Hai câu ấy đứng cạnh nhau trong
sổ đăng ký từ S0, và **không câu nào nói AI sinh ra cặp khoá**.

Câu hỏi ấy không né được nữa, vì `openRfq` chạy trong `api` còn `apps/unseal-worker` **chưa tồn
tại** (S1.6). Nếu chọn sai ở đây thì sai vĩnh viễn: sau khi đã có phong bì thật, đổi nơi sinh
khoá là một cuộc di trú có dữ liệu, không phải một lần sửa hàm.

### Bốn phương án, và ba trong bốn bị loại bằng một câu

| # | Phương án | Vì sao loại / giữ |
|---|---|---|
| 1 | **Sinh trong trình duyệt NGƯỜI MUA** | **Loại thẳng.** Người mua giữ được khoá riêng ⇒ người mua mở được báo giá bất cứ lúc nào. Phá A1, C3 và cả D1. Đây là phương án dễ viết nhất và nguy hiểm nhất. |
| 2 | **Sinh trong CSDL** | **Loại.** `pgcrypto` không sinh được cặp khoá ECDH. Và kể cả sinh được, bản rõ sẽ nằm trong bộ nhớ Postgres — đúng chỗ ADR-002 xếp vào tầng đe doạ 2. |
| 3 | **Sinh trong `unseal-worker`** | **Loại cho S1.4, KHÔNG loại vĩnh viễn.** Nó biến *mở một RFQ* thành một lời gọi đồng bộ liên tiến trình: worker chết thì không mở được RFQ nào — một ràng buộc sẵn sàng mà nghiệp vụ không đòi. Nó còn cấp cho worker một đường **GHI** mà nó vốn không cần: hôm nay `app_unseal` chỉ `SELECT`. |
| 4 | **Sinh trong `api`, bọc ngay, xoá bản rõ, không bao giờ trả về** | **Chọn.** |

### Quyết định

**Cặp khoá RFQ ra đời trong tiến trình `api`, bên trong đúng một hàm, kèm ba ràng buộc cưỡng chế
được bằng máy.**

1. **`issueRfqKeyPair` KHÔNG BAO GIỜ trả về khoá riêng dạng rõ.** Nó trả về đúng bốn thứ:
   `algorithm`, `publicKey` (SPKI), `wrappedPrivateKey`, `keyVersion`. Khoá riêng dạng rõ là một
   biến cục bộ, bị `fill(0)` trong `finally` — cùng khuôn `deriveOrgKey` đã dùng ở
   `local-dev-wrapper.ts`.
2. **Đường MỞ nằm sau một cánh cửa riêng**, `packages/sealed-envelope/src/unseal.ts`, canh bởi họ
   quy tắc `g8-` với **đúng một** miễn trừ: `apps/unseal-worker/`. Đây là bản sao chính xác của
   `crypto-keys/src/unwrap.ts` (ADR-006 + fix round 4), và nó ra đời **cùng lúc** với gói chứ
   không sau — lần thứ bảy cùng một khuôn, lần thứ ba nó không phải VÁ.
3. **`app_api` GHI ĐƯỢC nhưng KHÔNG ĐỌC ĐƯỢC `wrapped_private_key`.** Quyền theo cột:
   `GRANT INSERT (wrapped_private_key)` mà **không** có `SELECT`. Bất đối xứng này là phần chịu
   lực nhất của migration: một `SELECT wrapped_private_key` viết bởi người quên mất ADR này
   **không chạy được**, và nó không chạy được vì CSDL từ chối, không vì có ai nhớ.

**Vì sao ADR-006 KHÔNG bị phương án 4 làm mẻ.** ADR-006 trao cho `unseal-worker` **độc quyền
`kms:Decrypt` trên khoá RFQ**. Bọc một khoá riêng cần `kms:Encrypt`, không cần `Decrypt`. Tức
`api` làm được việc ở mục 1 mà **vẫn không có quyền giải mã** — ranh giới IAM của ADR-006 còn
nguyên vẹn. Đây là lý do phương án 4 không phải một bước trượt về phía *"api mở được thầu"*.

### Phần KHÔNG được nuốt vào ô ✅ — ghi chú §4 của G1 phải được VIẾT LẠI, hai chiều ngược nhau

Kế hoạch S1 (§2.1) đã đoán trước chuyện này và nói đúng một nửa. Nay đủ dữ kiện để nói cả hai:

- **Chiều nới ra:** vế *"tài sản được bảo vệ chưa tồn tại"* **hết hiệu lực**.
  `rfq_key_material.wrapped_private_key` nay là một cột thật, có dữ liệu thật, và hàng rào `g1-`
  lần đầu tiên canh một căn phòng có đồ ở trong.
- **Chiều thu hẹp — MỚI, và nó là hệ quả trực tiếp của quyết định trên:** tiến trình `api` **có**
  chạm khoá riêng RFQ dạng rõ, trong cửa sổ thời gian của đúng một hàm. Một **core dump của `api`
  đúng khoảnh khắc ấy chứa nó**. Mệnh đề G1 viết *"không vào DB, log, biến môi trường, core
  dump"* — vế core dump vì vậy **KHÔNG đúng tuyệt đối** kể từ hôm nay, và nói ra ở đây rẻ hơn
  nhiều so với việc một kiểm toán viên tìm ra.

**Điều kiện xét lại, có mốc:** khi `apps/unseal-worker` ra đời ở **S1.6**, câu hỏi *"chuyển
`issueRfqKeyPair` sang worker"* phải được hỏi lại — và trả lời bằng một phép đo về chi phí sẵn
sàng, không bằng trí nhớ về ADR này.

### G2 nói "MỘT cặp khoá", ADR-011 cho ra HAI — và phần chịu lực là vế thứ hai

Sổ đăng ký viết G2 là *"Mỗi RFQ một cặp khóa; lộ một RFQ không lan sang RFQ khác"*. ADR-011 chốt
**P-256 mặc định, X25519 cơ hội**, và ECDH đòi hai bên **cùng đường cong** — nên một RFQ phải mang
**một cặp khoá cho mỗi thuật toán** thì nhà cung cấp mới chọn được lúc chạy. Với hai thuật toán,
một RFQ có **hai** cặp khoá.

Điều đó **mâu thuẫn với chữ, không mâu thuẫn với điều được bảo vệ**. Vế chịu lực là vế thứ hai:
mỗi cặp khoá là ngẫu nhiên độc lập, không dẫn xuất từ RFQ nào khác, nên lộ một RFQ không lan sang
RFQ khác. Ghi ra thay vì diễn giải lại trong im lặng — và lược đồ nói đúng điều đó bằng
`UNIQUE (org_id, rfq_id, algorithm)`, chứ không phải `UNIQUE (org_id, rfq_id)`.

**Một tổ tiên chung VẪN CÒN, và nó không phải điều G2 nói:** cả hai khoá riêng đều được bọc bằng
khoá dẫn xuất **theo tổ chức** (`deriveOrgKey`), nên mất khoá gốc của tổ chức là mất mọi RFQ của
tổ chức ấy. Đó là địa hạt của **G1** và **F3**, không phải của G2 — nhưng nó thuộc về ghi chú §4
của G2 để không ai đọc ô ✅ thành *"mỗi RFQ là một ốc đảo"*.

### Đo bằng gì

1. **C5 là một CẶP trigger, không phải một câu lệnh ứng dụng.** ⑴ `rfq_key_material` chỉ nhận
   INSERT khi RFQ đang ở `PENDING_APPROVAL`; ⑵ `rfq_packages` không chuyển sang `OPEN` được nếu
   thiếu khoá của thuật toán mặc định. Hai vế cộng lại cho: khoá tồn tại **⟺** RFQ đã đi qua cửa
   OPEN, và nó ra đời **trong** giao dịch ấy. Cả hai phải có đối chứng dương.
2. **G2 bằng một phép thử chéo, không bằng một lời khai:** hai RFQ cùng tổ chức có `public_key`
   khác nhau, và khoá riêng của RFQ A **không mở được** phong bì niêm phong cho RFQ B — kèm đối
   chứng dương là A mở được phong bì của chính A.
3. **Bất đối xứng quyền cột phải ĐỎ THẬT:** một `SELECT wrapped_private_key` chạy bằng `app_api`
   phải bị Postgres từ chối, và cùng câu ấy chạy bằng `app_unseal` phải chạy được.
4. **KHÔNG phép đo nào ở S1 nói được *"trình duyệt thật của nhà cung cấp làm được X25519"***.
   **Đã đo, không suy** (2026-09-04): `docker run --rm node:22-alpine` — `ECDH P-256`, `X25519`
   và `Ed25519` đều sinh khoá và dẫn được bit chung trong `crypto.subtle`; máy dev (Node 24) cho
   cùng kết quả. Tức **cả hai runtime của dự án đều có X25519**, và chính vì thế một lượt CI xanh
   cho nhánh X25519 **không** là bằng chứng gì về webview Android: nó đo Node, không đo trình
   duyệt. Khoản nợ 23 không được đóng bằng phép đo ở đây; chỗ trống ấy nằm ở §4 của ma trận.

---

## ADR-020 — Tầng HTTP đầu tiên của `apps/api`: **`node:http` trần + bảng route KHAI BÁO; phiên người mua phát bằng magic link email + TOTP; token KHÔNG BAO GIỜ vào URL; đường khách chỉ nhận `client` đã gắn phiên**

**Ngày:** 2026-09-06 · **Trạng thái:** ~~*Đề xuất — chờ chốt*~~ **Đã chấp nhận (chốt cùng ngày,
kèm hai quyết định phụ: ~~`policy.manage` thuộc `PROCUREMENT_MANAGER`~~ [nợ 44, `033`: thuộc `FINANCE`]; H17 vào sổ đăng ký)** · Gỡ chặn: **S1.10** (vòng tầng
HTTP) · Liên quan: **A2**, **A5**, **E1**, **E6**, **D5**, ADR-007, ADR-008, ADR-012, ADR-015,
ADR-016 mục 4, ADR-019, khoản nợ 6, 21, 30

### Bối cảnh — bốn câu hỏi mà mã đang cư xử như đã có câu trả lời

`docs/ARCHITECTURE.md` §3 ghi `api/ NestJS` từ 2026-08-26 và chưa ai đụng dòng ấy. Từ đó tới
nay ba thứ đã xảy ra và cả ba kéo ngược lại: ⑴ khoản nợ 21 dựng `tests/architecture/pham-vi-san-xuat.test.ts`
ghim **đúng hai** phụ thuộc ngoài ở phạm vi sản xuất (`pg`, `pg-connection-string`) và ghi *"thêm
một dòng vào đây là một quyết định kiến trúc"*; ⑵ `apps/public-keys` (khoản nợ 30) ra đời bằng
`node:http` trần và tự nói *"định tuyến ở đây là so chuỗi bằng tay, và nó chỉ chịu được chừng này
đường"*; ⑶ ADR-016 mục 4 ghim *"route đầu tiên của `apps/` ra đời CÙNG LÚC với lớp canh"* và lớp
ấy cố ý **không dùng chữ route** vì framework chưa chọn.

Bốn câu hỏi phải trả lời **trước** dòng mã đầu tiên của `apps/api`, vì mỗi câu đổi sau đều là một
cuộc di trú chứ không phải một lần sửa hàm:

1. **Framework nào** — hay không framework.
2. **Phiên người mua phát ở đâu.** Đo được: **không một hàm sản phẩm nào INSERT vào `sessions`**;
   năm file test tự chèn hàng. `users` **không có cột mật khẩu** (002). `resolveSessionActor` nhận
   `sessionId` UUID, không nhận token — tức đường *"bearer → phiên"* chưa tồn tại. Đây là khoản nợ 6
   của sổ S0, vẫn mở. Và ADR-008 ghi một nợ **bắt buộc trả trước endpoint đăng nhập**: chọn (i) bảng
   riêng hay (ii) chỉ ghi chuyển trạng thái `justLocked`.
3. **Magic link đi vào URL dạng nào** — E6 trống vì đúng câu này (§3 ma trận).
4. **Cưỡng chế `withGuestSession()` bằng gì.** §4 của A5: *"một đường phục vụ khách quên gắn thì vị
   từ trả NULL và policy mở lại — hôm nay không có tầng HTTP nào để cưỡng chế việc gắn ấy"*.

### 1. Framework — ba phương án

| # | Phương án | Đánh giá |
|---|---|---|
| A | **NestJS** như spec 26/08 | Kéo hơn một trăm gói vào phạm vi sản xuất; DI bằng decorator và `reflect-metadata`; route là **phản chiếu lúc chạy** nên lớp canh ADR-016 phải đọc metadata thay vì đọc một cấu trúc dữ liệu. Mọi thứ nó cho — DI, module, pipe — dự án đã có bằng hàm thuần và composition root (`apps/unseal-worker/src/composition.ts`). Chi phí audit: mỗi advisory của cây ấy làm `t0b-audit` đỏ. **Loại.** |
| B | **Hono / Fastify** | Hono không phụ thuộc ngoài, cộng `@hono/node-server`; Fastify ~30 gói. Nhẹ hơn A nhiều, nhưng vẫn là *một* dòng mới trong danh sách ghim để mua đúng hai thứ: ghép đường dẫn và đọc thân JSON — hai thứ dưới 150 dòng. **Không loại vĩnh viễn** — xem điều kiện xét lại. |
| C | **`node:http` trần + bảng route KHAI BÁO** (`ROUTES: readonly Route[]`) | Không thêm phụ thuộc. Route là **dữ liệu**: `{ method, path, audience, permission?, handler }`. Lớp canh ADR-016 duyệt mảng ấy thay vì grep mã nguồn; bộ quét rò rỉ T2 (spec: *"gọi MỌI endpoint"*) duyệt cùng mảng ấy — không cần OpenAPI để liệt kê. Cái giá: tự viết ghép đường dẫn có tham số, đọc thân JSON có trần kích thước, và ánh xạ lỗi → mã HTTP. **Chọn.** |

**Vì sao C không phải "tiết kiệm một phụ thuộc".** Điểm chịu lực là **route là một cấu trúc dữ liệu
liệt kê được**. Ba lớp canh của vòng này (cổng quyền, E6, bộ quét rò rỉ) đều là *"với MỌI route…"*,
và một mệnh đề *với mọi* chỉ đo được khi tập hợp ấy đóng và đọc được không cần chạy tiến trình.
Framework nào cũng liệt kê được route, nhưng bằng phản chiếu sau khi khởi động — tức lớp canh chạy
ở T1 phải khởi động cả ứng dụng. Với C, lớp canh là một `import { ROUTES }`.

**Điều kiện xét lại B, có mốc:** khi `ROUTES` vượt **40** đường, hoặc khi cần streaming/multipart
(xuất CSV lớn, tải tệp đính kèm — S2/S3). Lúc đó bảng route khai báo **vẫn giữ**, chỉ bộ ghép
đường dẫn đổi chủ.

### 2. Phiên người mua — phát bằng magic link email + TOTP, KHÔNG mật khẩu

| # | Phương án | Đánh giá |
|---|---|---|
| a | Mật khẩu + TOTP | Cần cột mới, cần `argon2`/`bcrypt` (phụ thuộc ngoài, native build — cùng họ `cpu-features` đã phải tắt ở `pnpm-workspace.yaml`), cần chính sách mật khẩu, đặt lại mật khẩu. Thêm một bí mật để lộ. **Loại cho S1.10.** |
| b | **Magic link email + TOTP bắt buộc** | Cùng khuôn `rfq_invitation_tokens` (E1: hash, đơn mục đích, có hạn, thu hồi được) trên bảng riêng `user_login_tokens`. Hai yếu tố trên **hai kênh** (hộp thư + ứng dụng TOTP) — đúng nguyên tắc ADR-015. Không lưu mật khẩu. `enrollTotpCredential`/`verifyTotpAttempt` đã có từ S0. **Chọn.** |
| c | SSO/OIDC | Enterprise (S5). |

Ba ràng buộc đi kèm, cả ba cưỡng chế được:

1. **Phiên chỉ ra đời sau TOTP.** `startUserSession` chèn hàng `sessions` với `mfa_verified_at = now()`
   trong **cùng giao dịch** với `verifyTotpAttempt` thành công; một hàng `sessions` có
   `mfa_verified_at IS NULL` là **không hợp lệ** cho mọi route người mua (không có "đăng nhập nửa
   chừng"). Trigger ở migration mới: `sessions` INSERT bởi `app_api` phải mang `mfa_verified_at`.
2. **Bearer → phiên bằng băm.** `resolveSessionByToken(client, orgId, token)` băm SHA-256 rồi tra
   `(org_id, token_hash)` (006 đã có `UNIQUE`), rồi ủy cho `resolveSessionActor`. Token phiên đi
   trong cookie `HttpOnly; Secure; SameSite=Strict; Path=/`, **không** trong URL, **không** trong
   `Authorization` của trình duyệt (để CSRF không có bề mặt qua form cross-site).
3. **Nợ ADR-008 trả bằng phương án (ii):** khi `verifyTotpAttempt` trả `justLocked`, ghi **một** bản
   ghi `MFA_LOCKED` vào sổ kiểm toán. Tần suất bị chặn trên `1 / MFA_LOCKOUT_SECONDS` mỗi hồ sơ nên
   lập luận DoS của ADR-008 không áp dụng. Trường `justLocked` có người gọi đầu tiên.

### 3. E6 — token KHÔNG BAO GIỜ vào đường dẫn hay query

- **Magic link = `https://<host>/i#<token>`.** Token nằm ở **fragment**: trình duyệt không gửi
  fragment lên máy chủ, không ghi vào log truy cập, không đi vào `Referer`. Trang `/i` là tĩnh;
  JS đọc `location.hash`, xoá nó (`history.replaceState`), rồi **POST** token trong thân JSON tới
  `/guest/redeem`. Cùng khuôn cho link đăng nhập người mua: `/login#<token>`.
- **Mọi phản hồi** mang `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (trừ
  `public-keys`, đã có chính sách riêng), `X-Content-Type-Options: nosniff`.
- **Phiên khách** đi trong cookie như phiên người mua; **mã OTP** chỉ đi trong thân POST.
- **Định danh trong URL** chỉ được là UUIDv4 (ADR-012); `rfqId`, `invitationId` trong đường dẫn
  là chấp nhận được vì chúng không phải credential (E4).

### 4. A5 — đường khách chỉ nhận một `client` đã gắn phiên

Handler của route `audience: "GUEST"` có chữ ký `(ctx: GuestContext) => …` với **đúng một** cửa
vào CSDL: `ctx.client`, được bộ điều phối mở bằng `withGuestSession(pool, orgId, guestSessionId, …)`
TRƯỚC khi gọi handler. Handler **không nhận `pool`**, và `apps/api/src/routes/**` bị cấm import
`createPool`, `pg`, `withTenant`, `withGuestSession` — bốn tên ấy chỉ được xuất hiện ở
`apps/api/src/dispatch.ts`. Lớp canh: quy tắc dependency-cruiser `g9-` cộng một test đọc mã nguồn
`routes/**` (cùng khuôn `cong-quyen-route.test.ts`). Quên gắn phiên trở thành **không viết được**,
không phải "phải nhớ".

Route `audience: "BUYER"` cùng khuôn: `ctx.client` mở bằng `withTenant`, `ctx.actor` là
`SessionActor` dẫn xuất từ cookie; handler đổi trạng thái **phải** khai `permission`, và bộ điều
phối gọi `requirePermission` **trước** handler — nên vị từ *"nhắc tới `requirePermission`"* của
ADR-016 mục 4 được **thay bằng** vị từ mạnh hơn: *"mọi route ghi có trường `permission` không rỗng,
và bộ điều phối là nơi DUY NHẤT gọi `requirePermission`"*.

### Phần KHÔNG đóng — nói trước để không ai đọc rộng hơn

- **A2 vế *bộ nhớ / APM / core dump*:** vòng này đo được **phản hồi HTTP, log bắt được, và thông
  điệp lỗi** của tiến trình `api` thật (bộ quét rò rỉ T2 chạy trên `ROUTES`). Heap dump và APM
  trace **không** đo — A2 vào ô ✅ **kèm cờ §4** nếu vào, và §4 phải nói đúng ba vế đã đo.
- ~~**Email gửi link** là một handler outbox (ADR-010) — vòng này chỉ **đặt job** kèm hash; bộ gửi
  thật (SMTP/SES) là hạ tầng chưa có (ADR-009 chưa triển khai). Kịch bản E2E đọc token từ job.~~
  **[S1.11] Câu trên KHÔNG đúng với thứ đã cài:** S1.10 gọi ba cổng gửi (`LoginLinkSender`,
  `InvitationLinkSender`, `OtpSender`) SAU commit qua `afterCommit`, không đặt job outbox; test đọc
  token từ bộ gửi ghi lại, và tiến trình thật (ADR-021) đọc từ hộp thư dev. Vế outbox vẫn là cách
  đóng đúng của **sổ nợ 38** — chưa làm.
- **CSRF** đóng bằng `SameSite=Strict` cộng kiểm `Origin` trên mọi POST; **không** có CSRF token
  riêng. Đủ cho một API JSON không có form HTML; phải xét lại khi có form POST cổ điển.
  **[S1.10.7] Câu trên đã có lúc SAI:** từ S1.10.2 tới `214a741` không một dòng nào kiểm `Origin` —
  review M-3 bắt được. Nay `server.ts` từ chối 403 mọi yêu cầu không-GET có `Origin` ngoài
  `allowedOrigins` (mặc định rỗng) hoặc `Sec-Fetch-Site` khác `same-origin`/`none`, TRƯỚC khi đọc
  thân; có test. Composition root của web app phải khai origin của nó.
- ~~**Giới hạn tần suất trên endpoint đăng nhập người mua** đi theo `otp_rate_limits` (ADR-015/018)
  với bucket mới `LOGIN_DEST`~~ **[S1.10.7] Thực tế cài KHÁC:** hạn mức theo NGƯỜI DÙNG, đếm trên
  chính `user_login_tokens` (5 token / 15 phút), không bucket, không pepper. **Chưa có** bucket theo
  người gọi (IP) cho `/auth/*` — review M-2, sổ nợ 39; và nó phụ thuộc nguồn IP tin cậy (nợ 41).
  TOTP thất bại có khoá hồ sơ sẵn (006). **Không** thêm Redis.
- **`ROUTES` liệt kê được chỉ đóng "mọi route ĐÃ KHAI"**; một handler mở `createServer` thứ hai
  ngoài bảng thì không lớp nào thấy — lớp canh `g9-` cấm `node:http` ngoài `server.ts` để đóng
  đúng khe ấy, và đó là phần chênh phải ghi.

### Đo bằng gì

1. **Cổng quyền:** một route ghi thêm vào `ROUTES` mà thiếu `permission` → T1 đỏ **không cần khởi
   động máy chủ**; đối chứng: bộ điều phối từ chối 403 và ghi `PERMISSION_DENIED` (D5) khi một
   phiên thiếu quyền gọi route ấy — đo trên tiến trình HTTP thật.
2. **E6:** ⑴ không mẫu đường dẫn nào trong `ROUTES` chứa tham số tên `token|otp|session|code`; ⑵ mọi
   phản hồi mang `Referrer-Policy: no-referrer` (duyệt `ROUTES`, gọi từng route, đọc header);
   ⑶ **đột biến**: bỏ header ở một route → đỏ; thêm route `/guest/redeem/:token` → đỏ.
3. **A5 tại tầng HTTP:** hai phiên khách của hai nhà cung cấp trên cùng RFQ gọi cùng route, mỗi bên
   chỉ thấy của mình; **đột biến** gỡ `withGuestSession` khỏi bộ điều phối → test đỏ VÀ lớp canh
   `g9-` đỏ (hai lớp, hai lý do).
4. **Phiên người mua:** một `INSERT INTO sessions` viết tay bởi `app_api` thiếu `mfa_verified_at` bị
   trigger từ chối; `resolveSessionByToken` với token sai/hết hạn/thu hồi ném **cùng một** lỗi
   (không oracle); bản ghi `MFA_LOCKED` xuất hiện đúng **một** lần sau `MFA_MAX_FAILED_ATTEMPTS`
   lần sai, không xuất hiện ở lần sai thứ nhất.
5. **Bộ quét rò rỉ (A1/A2/A4 ở tầng HTTP):** gieo giá `1234567891` qua một báo giá niêm phong
   THẬT, gọi mọi route `BUYER`/`GUEST` trước mở thầu, quét thân phản hồi + log bắt được + thông
   điệp lỗi; **đối chứng dương**: cùng bộ quét bắt được khi một route cố ý trả bản rõ.
6. **Phạm vi sản xuất KHÔNG đổi:** `NGOAI_DUOC_PHEP_O_SAN_XUAT` vẫn đúng hai dòng sau khi
   `apps/api` ra đời — đó là phép đo của lựa chọn C.

## ADR-021 — Tiến trình `api` chạy thật: **composition root trong `apps/api`, cấu hình từ môi trường fail-closed, pool `SET ROLE` mỗi kết nối, và "đường ứng dụng" ở CSDL là mọi thành viên kế thừa của `app_api`**

**Ngày:** 2026-09-06 · **Trạng thái:** **Đã chấp nhận (chốt cùng ngày, S1.11)** · Gỡ chặn: sổ nợ
38 (outbox cho mail), 41 (proxy tin cậy) — cả hai cần một tiến trình có thật để treo · Liên quan:
ADR-006, ADR-009, ADR-011 mục 3, ADR-018, ADR-019, ADR-020, migration `029`/`032`/`037`, khoản nợ 6, 21, 50

### Bối cảnh — một câu trong `apps/api/src/index.ts` đã thiu, và một khe hở chỉ lộ ra khi nối dây

`apps/api/src/index.ts` viết *"Không có `main`: tiến trình chạy thật (composition root với pool,
pepper, khoá ký) là việc của S1.10.6"*. S1.10.6 làm bộ quét rò rỉ, không làm composition root;
`docs/ARCHITECTURE.md` §3 ghi đúng: *"CHƯA có composition root chạy thật (pool, KMS, bộ gửi)"*. Mọi
test của `apps/api` lắp `createDispatcher` với `dichVuTest()` và pool `poolAs("app_api")` của
test-support — tức **mười một gói và một tầng HTTP đã được test gọi, chưa có ai chạy**.

Khi thiết kế đường kết nối thật, một khe hở lộ ra mà không test nào trước đó nhìn thấy: `app_api`
là NOLOGIN (001, hardening), nên tiến trình đăng nhập bằng `app_api_login` — role thành viên mà
hardening **cưỡng chế INHERIT** (danh sách trắng CAP_HOP_LE). Role ấy có TOÀN BỘ quyền của
`app_api` ngay khi kết nối, và `current_user` của nó là `app_api_login`. Hai trigger của lớp đăng
nhập — 029 (*app_api không tạo phiên thiếu MFA*) và 032 (*app_api không thay bí mật TOTP đã xác
nhận*) — điều kiện theo `current_user = 'app_api'`, vì được viết và đo dưới `poolAs` (mỗi client
`SET ROLE app_api`). Trên đường sản xuất mà không `SET ROLE`, **cả hai im lặng**. Đo được:
`packages/db/src/vai-tro.int.test.ts` — trước 037, `app_api_login` chèn được `sessions` thiếu
`mfa_verified_at` và thay được `secret_wrapped` của hồ sơ đã xác nhận. Không ai viết sai; hai vế
của cùng một kiến trúc chưa từng gặp nhau vì chưa có composition root nối chúng. Đó là **khoản nợ 50**, và nó đóng trong cùng vòng.

### 1. Composition root — trong `apps/api`, hàm thuần, không đọc `process.env`

| # | Phương án | Đánh giá |
|---|---|---|
| A | Gói riêng `apps/api-runtime` | Thêm một gói chỉ để chứa ba file; `@trustprocure/db` vẫn phải vào phạm vi sản xuất ở đâu đó. **Loại.** |
| B | **`apps/api/src/composition.ts` + `main.ts` + `cau-hinh.ts`** — cùng khuôn `apps/unseal-worker/src/composition.ts` | `taoTienTrinhApi(cauHinh)` nhận cấu hình đã kiểm, dựng hai pool (`app_api` giao dịch + `app_api` sổ từ chối quyền, D5), ba vòng bí mật, bộ ký, ba bộ gửi, rồi lắp `createDispatcher` + `createApiServer`. `main.ts` chỉ đọc `process.env`, gọi `batDau()`, nghe SIGTERM/SIGINT. `@trustprocure/db` chuyển sang `dependencies` của `apps/api` — câu "mã chạy của api nhận pool từ composition root, không tự tạo" vẫn đúng: composition root nay SỐNG TRONG app. **Chọn.** |

**`batDau()` chạm CSDL trước khi mở cổng**: lấy và trả một client của mỗi pool. Sai role, sai
mật khẩu, CSDL chưa migrate — nổ ở đây, khi chưa ai kết nối được vào. `dung()` đóng cổng, đóng
kết nối rảnh, rồi đóng cả hai pool; gọi nhiều lần vô hại.

### 2. Cấu hình — từ biến môi trường, fail-closed, không mặc định cho bí mật, adapter phải khai tên

`docCauHinh(env)` là hàm thuần trên một bản đồ tên → chuỗi. Ba quy tắc, mỗi quy tắc có test T1:
⑴ bí mật không có mặc định — thiếu là ném; ⑵ thông điệp lỗi chỉ nêu **tên** biến, không bao giờ
nêu giá trị; ⑶ `TRUSTPROCURE_KEY_ADAPTER` và `TRUSTPROCURE_SENDER_ADAPTER` phải được khai, và hôm
nay mỗi biến chỉ có **một** giá trị hợp lệ (`local-dev`, `dev-mailbox`) — `"kms"` hay `"ses"` ném
với đúng câu *"adapter chưa có trong kho"*, không rơi về bản dev trong im lặng. Cộng một phép kiểm
mua bằng vận hành: **ba vòng bí mật 32 byte (khoá RFQ, khoá TOTP, pepper OTP) phải đôi một khác
nhau** — dán cùng một base64 vào hai biến là lỗi dễ nhất, và nó biến ba khoá thành một (G1/ADR-006,
ADR-018). Khoá ký biên nhận: PKCS8 DER, phải là EC P-256 (ADR-011 mục 2); nửa công khai dẫn ra từ
nửa riêng. `TRUSTPROCURE_PUBLIC_BASE_URL` (gốc của `/login#` và `/i#`) phải là `https:` — `http:`
chỉ cho localhost — và chỉ được là gốc. Bảng biến ở `apps/api/.env.example`.

### 3. Pool — `SET ROLE app_api` ở MỖI lần lấy client, và lớp CSDL đứng sau cho ca quên

| # | Phương án | Đánh giá |
|---|---|---|
| a | Chỉ sửa trigger (037), pool giữ nguyên | Tiến trình thật chạy dưới `current_user = app_api_login` — KHÁC danh tính mà mọi phép đo của dự án đã chạy. Mọi test "dưới app_api" từ S0 là bằng chứng cho một danh tính khác. **Loại làm lớp duy nhất.** |
| b | Chỉ `SET ROLE` ở pool, trigger giữ `current_user = 'app_api'` | Đúng khi ứng dụng NHỚ; một pool thứ hai (job, script vận hành, một `pg.Pool` viết tay) quên là hai trigger im lặng lại. **Loại làm lớp duy nhất.** |
| c | Đổi `app_api_login` sang NOINHERIT | Fail-closed đẹp (quên SET ROLE thì không có quyền gì), nhưng hardening cưỡng chế INHERIT có chủ ý và có test ([CR2-T3]); ba bộ test (`tenant-guard`, `mfa`, `unique-oracle`) đo RLS dưới `app_api_login` kế thừa. Đổi là một cuộc di trú của hardening. **Loại — có thể xét lại.** |
| d | **Cả a lẫn b** | `createPool(..., { role: "app_api" })` — `SET ROLE` + kiểm `current_user` ở mỗi lần lấy client, cùng cơ chế `poolAs` của test-support, nay MỘT bản ở `packages/db/src/vai-tro.ts` và test-support gọi lại. VÀ migration `037`: vị từ `la_duong_ung_dung('app_api')` = `pg_has_role(current_user, 'app_api', 'USAGE') AND NOT superuser`, thay vào 029/032 (`CREATE OR REPLACE`, cùng tên). Vế *không superuser* là load-bearing: `pg_has_role` trả TRUE cho superuser với mọi role, thiếu nó thì đường test/vận hành dưới superuser bị chặn theo — chính lý do 029/032 điều kiện theo vai. **Chọn.** |

**[review lượt 3, H3-1] Vế mà bảng trên chưa nói, và nó đổi phương án d thành ba lớp:** `SET ROLE`
KHÔNG phải một phép giảm quyền không đảo ngược — superuser `SET ROLE` sang bất kỳ role nào, và một
`RESET ROLE` (bug, SQL injection ở một handler) trả kết nối về đúng phiên đăng nhập. Nên
`current_user = app_api` sau SET ROLE chứng minh *đang là* app_api, không chứng minh phiên ấy *không
mạnh hơn* app_api; một URL superuser đi qua cả pool có vai lẫn vị từ 037. Phương án (c) NOINHERIT
là phương án duy nhất trong bảng mà `RESET ROLE` không đảo ngược được — lý do loại nó vẫn đứng
(hardening + ba bộ test), nhưng cái giá được nói ra ở đây. Lớp thứ ba, thêm cùng ngày:
`khangDinhPhienDangNhapUngDung` (`@trustprocure/db`) đọc `session_user` lúc khởi động — từ chối
SUPERUSER, BYPASSRLS, CREATEROLE, thành viên của vai ứng dụng khác — và `cau-hinh.ts` đòi URL đăng
nhập bằng đúng `app_api_login`. Không đặt phép kiểm này trong `ganVaiTroChoPool`, vì `poolAs` của
test-support cố ý đăng nhập bằng superuser rồi SET ROLE.

### 4. Adapter dev — hai cái mới, cùng hàng rào với ba cái cũ

- **Bọc/mở bí mật TOTP (`adapters/totp-local-dev.ts`)**: AES-256-GCM, khoá dẫn xuất HKDF theo
  `orgId` (nhãn `trustprocure/totp-dek/v1`), `orgId` + phiên bản trong AAD; ném khi không mở
  được, không bao giờ trả rỗng; `kind` phân biệt. KHÔNG phải bản chép của `local-dev-shared.ts`
  (không import được, và không nên: nhãn HKDF khác nên cùng khoá chính cũng cho khoá dẫn xuất khác).
- **Hộp thư dev (`adapters/hop-thu-dev.ts`)**: ba bộ gửi ghi mỗi tin một tệp JSON (0700/0600) vào
  `TRUSTPROCURE_DEV_MAILBOX_DIR`; link theo ADR-020 mục 3 (`/login#<token>`, `/i#<token>`); không
  một byte nào qua `console`. Đây là adapter DUY NHẤT hôm nay: bộ gửi thật (SMTP/SES/SMS) là hạ
  tầng chưa có, và cách đóng đúng vẫn là nợ 38 (outbox cho mọi email, token phát trong handler).
- Cả hai gọi `assertLocalDevAllowed()` NGAY KHI TẠO — cùng hàm với `createLocalDevWrapper` và
  `createLocalDevReceiptSigner`, không phải một bản chép. **[review lượt 3, H3-2]** Và hàm ấy đổi
  một luật của MED-1: vì cấu hình của `api` BẮT BUỘC khai `local-dev`, "lời khai dương thắng mọi
  `NODE_ENV`" nghĩa là mọi cấu hình khởi động được đều mở cửa — nay `local-dev` + `production` là
  mâu thuẫn ⇒ chặn, trừ khi có `TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS=1`. **[H3-3]** Thư mục hộp thư
  phải là đường dẫn tuyệt đối, được `chmod 0700`, và `.hop-thu-dev/` vào `.gitignore`.

### Phần KHÔNG đóng — nói trước

- **Không có build.** `pnpm api:dev` chạy TypeScript trực tiếp bằng Node ≥ 22 (`--experimental-transform-types`
  + hook resolve `.js → .ts`, bản sao có chủ ý thứ ba của cùng hook). Một pipeline `tsc` emit +
  image là việc của vòng triển khai (ADR-009 chưa triển khai).
- **Không có adapter KMS, không có bộ gửi thật.** Tiến trình từ chối khởi động khi được khai một
  adapter khác — đó là hình dạng của phần chênh, không phải một mặc định.
- **Không có `/readyz` chạm CSDL**: `/health` cố ý không mở kết nối (public.ts). Kiểm sẵn sàng
  làm ở `batDau()`; một health-check theo chu kỳ có chạm CSDL là quyết định của tầng triển khai.
- **Vị từ 037 chỉ biết `app_api`**; vai ứng dụng thứ hai vẫn đi qua im lặng (L-4 của 029).
- **Nợ 38, 39, 41, 42** vẫn mở; vòng này chỉ cho chúng một tiến trình để treo.

### Đo bằng gì

1. **037:** `app_api_login` KHÔNG `SET ROLE` chèn `sessions` thiếu MFA ⇒ 23514; thay bí mật TOTP đã
   xác nhận ⇒ 23514; superuser vẫn làm được cả hai. **Đột biến:** trả vị từ về `current_user = ten_vai`
   ⇒ cả hai câu ĐI LỌT; cùng đột biến, đường `SET ROLE` vẫn bị chặn (đối chứng cho "vì sao không
   test nào thấy"). Vị từ: STABLE, không SECURITY DEFINER, PUBLIC không EXECUTE.
2. **Pool có vai:** `current_user = app_api` ở `pool.query` lẫn `pool.connect`, và SAU một `RESET ROLE`
   trên client được tái dùng; role không phải thành viên ⇒ 42501, không giao client, pool không rò.
3. **Cấu hình:** 13 biến bắt buộc — thiếu/rỗng ⇒ ném nêu đúng tên, thông điệp không chứa bí mật;
   adapter lạ ⇒ "chưa có"; ba vòng trùng ⇒ ném nêu cả hai tên; khoá ký sai PKCS8/không P-256 ⇒ ném.
4. **Tiến trình:** `taoTienTrinhApi` từ env với role thật ⇒ người mua đi trọn magic link (đọc từ hộp
   thư dev, token ở fragment) → ghi danh TOTP qua adapter local-dev thật (hàng `mfa_credentials` bọc,
   `keyVersion` = phiên bản vòng) → phiên → `/me` → logout. Role không phải thành viên ⇒ `batDau()`
   ném 42501, KHÔNG cổng nào nghe. `main.ts` chạy như tiến trình con: cấu hình hỏng ⇒ mã thoát 1 +
   tên biến, không giá trị; đúng ⇒ `/health` 200 trên cổng in ra stderr; stderr không mang bí mật.
5. **Phạm vi sản xuất KHÔNG đổi:** `NGOAI_DUOC_PHEP_O_SAN_XUAT` vẫn hai dòng; `depcruise` 0 vi phạm.

## ADR-022 — Trả bảy khoản nợ của tầng đăng nhập: **`/auth/link` chỉ enqueue, token phát trong handler outbox chạy TRONG tiến trình `api`; hạn mức theo người gọi đếm NGOÀI giao dịch của handler; đặt lại TOTP = XOÁ hồ sơ sau phê duyệt kép cưỡng chế ở CSDL; cookie `__Host-`; địa chỉ người gọi chỉ tin sau proxy khai CIDR**

**Ngày:** 2026-09-07 · **Trạng thái:** **Đã chấp nhận (chốt cùng ngày, S1.12)** · Đóng: sổ nợ 38, 39,
40, 41, 42, 43, 49 · Liên quan: ADR-010 (outbox), ADR-015, ADR-018, ADR-020, ADR-021, migration
`038`/`039`/`040`/`041`, review S1.10 M-1/M-2/M-4/M-5/M-7/M-8/L-2 và lượt 2 H2-4; lượt 4 (H4-1…H4-12,
`evidence/security-reviews.md` §S1.12) sửa trong cùng PR — các đoạn **[review H4-x]** dưới đây

### 1. Nợ 38 — `/auth/link` không còn nhìn vào bảng người dùng

| # | Phương án | Đánh giá |
|---|---|---|
| a | Giữ handler, thêm "chờ giả" cho nhánh không có người dùng | Cân bằng RTT bằng tay là một lời khai; mỗi lần đổi câu lệnh phải cân lại. **Loại.** |
| b | **Handler chỉ `enqueueJob(LOGIN_LINK_SEND, {email})` — MỘT INSERT cho MỌI email; handler outbox tra người dùng, phát token, gửi** | Cùng số câu lệnh cho cả hai nhánh, đo được bằng cách đếm job: mỗi lời gọi đúng một job. Hạn mức theo người dùng (5/15 phút) chuyển vào handler. Token KHÔNG nằm trong payload (ADR-015 mục 3: payload mang tham chiếu). **Chọn.** |

**Runner ở đâu.** `JobRunner` (ADR-010) cần `listOrganizations`, và `app_api` không đọc được danh
sách tổ chức (RLS). Tiến trình `api` biết tổ chức nào vừa enqueue — nên composition root giữ một
tập `orgId` đã thấy, và `nudgeOutbox(orgId)` sau commit đánh thức `runOnceForOrg` **không await**
(một `setImmediate`; awaiting nó trong pha sau-commit là đưa oracle trở lại dưới dạng khác). Vòng
poll theo `pollIntervalMs` nhặt job còn sót (thử lại). Không worker riêng: một worker cần đọc danh
sách tổ chức, tức cần một role vượt RLS hoặc một hàm SECURITY DEFINER — cả hai là quyết định lớn
hơn khoản nợ này. Ghi giới hạn: nhiều instance thì job của instance A do A đánh thức; B chỉ nhặt
nếu B cũng từng thấy tổ chức ấy. `KIND_KHONG_NHAN` của unseal-worker nhận `LOGIN_LINK_SEND` kèm lý do.

**Cùng dòng nợ 38:** `createPool` có `statementTimeoutMs` (mặc định 15 s) — câu lệnh treo bị huỷ ở
Postgres, không chỉ ở JS; ~~hai~~ ba lời gọi KMS trong giao dịch (`wrapTotpSecret`, `openTotpSecret`,
và **[review H4-8]** `rfqKeyWrapper.wrap` ở `openRfq`) có TRẦN 5 s (`coHan`, cùng hàm với sau-commit)
— chúng vẫn chạy trong giao dịch, và đó là phần chênh còn lại được nói ra.

**[review H4-3] Email trong payload.** Hợp đồng payload của gói outbox cấm `email` — nó là PII do
người gọi VÔ DANH chọn, và `outbox_jobs` chỉ lớn lên (`app_api` không có UPDATE payload lẫn DELETE).
Migration `041`: trigger BEFORE UPDATE đưa payload của `LOGIN_LINK_SEND` về `{}` khi job kết thúc
(DONE/FAILED) — sửa `NEW`, không nới ACL. Lớp hai: `/auth/link` đòi HÌNH DẠNG email trước khi
enqueue (không lưu chuỗi tuỳ ý). Phần chênh: email nằm trong payload từ enqueue tới khi job xong, và
trong log Postgres nếu cấu hình ghi tham số bind (007 §MỤC 1). **[review H4-10]** `send` có trần 5 s
riêng (`BoGuiQuaHan`, ngắn hơn lease 60 s) nhưng vẫn nằm TRONG giao dịch của job: `send` xong mà
kết cục không ghi được ⇒ link chết rồi email thứ hai — sổ nợ 53, làm khi có bộ gửi thật.

### 2. Nợ 39 + 41 — người gọi là ai, và đếm ở đâu

- **41:** `TRUSTPROCURE_TRUSTED_PROXIES` (CIDR, tuỳ chọn; rỗng = không proxy). `X-Forwarded-For` chỉ
  được đọc khi địa chỉ SOCKET thuộc danh sách; đi từ PHẢI sang trái, bỏ qua mọi địa chỉ thuộc danh
  sách, lấy địa chỉ đầu tiên không thuộc — không có thì dùng socket. Cài bằng `net.BlockList`
  (không phụ thuộc ngoài). Header từ socket lạ bị bỏ qua hoàn toàn. Đo qua `sessions.ip`.
- **39:** bucket `LOGIN_CALLER` trên `otp_rate_limits` (migration `038`), khoá `HMAC(pepper, org ‖
  route ‖ ip)`, cửa sổ 15 phút, trần theo route (`/auth/link` ~~10~~ 30, `/auth/redeem` 30, `/auth/totp` 30).
  **[review H4-4]** `ip` trong khoá là `khoaNguoiGoi(ip)`: IPv6 gom về /64 (mỗi khách dân dụng có ít
  nhất một /64 — đếm theo địa chỉ nguyên vẹn là 2^64 bucket miễn phí); IPv4 giữ nguyên, và vì một
  NAT văn phòng là MỘT địa chỉ, trần link lên 30 (trần chống lạm dụng hộp thư là 5/15 phút theo
  người dùng, ở `issueLoginToken`). Chưa có trần toàn tổ chức — sổ nợ 52. **[review H4-5]** 429 LÀ
  một oracle tồn tại tổ chức (tổ chức lạ không bị đếm) — chấp nhận, nói ra: `orgId` UUIDv4 không vét
  cạn được; `Retry-After` cố ý là cả cửa sổ. **[review H4-9]** danh sách proxy từ chối tiền tố rộng
  hơn /8 (v4) hay /7 (v6 — ULA `fc00::/7` vẫn hợp lệ) lúc khởi động; hop ghi `ip:port`/`[v6]:port`
  được bỏ cổng thay vì rơi về socket (cả tổ chức chung một bucket, im lặng).
  **Đếm ở dispatcher, trong một giao dịch RIÊNG trước handler:** giao dịch của handler rollback khi
  token sai (`LoginTokenError`), nên đếm bên trong nó là đếm thành công chứ không đếm thử — bộ đếm
  OTP của khách hôm nay đúng là như thế (ghi ra, chưa đổi). Vượt ⇒ 429 + `Retry-After`, handler
  không chạy. Địa chỉ rỗng (không xác định) dùng chung MỘT bucket — fail-closed.

### 3. Nợ 40 — đặt lại TOTP: hai người, và hồ sơ bị XOÁ chứ không bị sửa

| # | Phương án | Đánh giá |
|---|---|---|
| a | Đặt `confirmed_at = NULL` trên hồ sơ | 032 cấm đúng phép đổi ấy dưới `app_api` (H2-1), và bí mật cũ vẫn nằm đó: ai cầm bí mật cũ + hộp thư gọi thẳng `/auth/totp` là xác nhận lại được. **Loại.** |
| b | **XOÁ hàng `mfa_credentials`** — `GRANT DELETE` cho `app_api` kèm trigger BEFORE DELETE (đường ứng dụng) đòi một `mfa_reset_requests` `APPROVED` chưa tiêu thụ cho đúng (org, user) | Không còn bí mật nào để xác nhận lại; lần đăng nhập kế ⇒ `needsEnrollment` ⇒ bí mật mới. 032 không cần chạm. Cùng giao dịch: thu hồi mọi phiên còn sống, đánh dấu yêu cầu đã tiêu thụ, hai bản ghi sổ. **Chọn.** |

Bảng `mfa_reset_requests` theo khuôn `unseal_requests`/`unseal_approvals` (019): `requested_by`,
`requested_by_session_id` (trigger 013 kiểm danh tính theo phiên), `approved_by` ≠ `requested_by` VÀ
phiên khác (trigger, ERRCODE check_violation), hết hạn 24 giờ, lý do bắt buộc. Mã quyền
`user.mfa_reset` cho `PROCUREMENT_MANAGER` và `DIRECTOR` (không chạm chuỗi D3/033). ~~Hai~~ Ba route:
`POST /users/:userId/mfa-reset`, `POST /mfa-resets/:id/approve`, và **[review H4-2]** `POST
/mfa-resets/:id/cancel`.

**[review H4-1] "Hai người" phải là "hai người CÓ QUYỀN", ở CSDL.** Bản đầu cưỡng chế khác người,
khác phiên, danh tính theo phiên — nhưng vế "có `user.mfa_reset`" chỉ ở `requirePermission`, tức ở
tầng mà mô hình "app_api bị chiếm" giả định là mất: hai phiên BUYER sống bất kỳ là đủ để tự dựng
yêu cầu, phê duyệt, DELETE. Nay trigger `mfa_reset_kiem_quyen` (BEFORE INSERT cho `requested_by`,
BEFORE UPDATE khi `approved_by` được đặt) đọc `user_roles ⋈ role_permissions` như 033, vô điều kiện.
Phần chênh còn lại: một `app_api` bị chiếm có hai phiên QUẢN LÝ sống vẫn làm được — trigger mua
"hai người quản lý", không mua "hai người thật". **[review H4-2]** Yêu cầu hết hạn không tự rời
PENDING, và chỉ mục "một yêu cầu đang chờ" sẽ khoá vĩnh viễn đường về của người ấy: `requestMfaReset`
dọn yêu cầu đang chờ đã hết hạn trước khi tạo (`MFA_RESET_EXPIRED`), và route huỷ ghi
`MFA_RESET_CANCELLED`.

### 4. Nợ 42 + 43

- **42:** `__Host-tp_session`, `__Host-tp_guest` — `Secure`, `Path=/`, không `Domain` (tiền tố đòi
  thế; cookie khách rời `Path=/guest`, hai tên khác nhau nên một trình duyệt giữ cả hai vẫn ổn).
  `docCookie` gặp tên lặp ⇒ bỏ tên ấy (401), không lấy cái đầu.
- **43:** migration `039` — trigger BEFORE INSERT `sessions` (đường ứng dụng, `mfa_verified_at`
  không NULL) đòi hồ sơ TOTP đã xác nhận có `last_used_counter ≥ bước hiện tại − 3` (bước 30 s của
  `totp.ts` — CSDL nay biết hằng số ấy, ghi ra) **[review H4-6]** VÀ `≤ bước hiện tại + 3` — một bộ
  đếm ở tương lai không được thoả mãn vĩnh viễn (bài học `assertFreshMfa`). Phần chênh, nói ra:
  trigger chặn MỘT câu INSERT trần; `app_api` có `UPDATE (last_used_counter)` (006, `verifyTotpAttempt`
  cần) nên HAI câu vẫn qua — cùng hạn chế 006 §(2), có test đo đúng phần chênh ấy. Bốn phép đo 006
  dưới `app_api` được cho một hồ sơ TOTP tươi thay vì chuyển sang superuser — chúng vẫn đo `app_api`.

### 5. Nợ 49 — bộ quét gọi route ghi bằng thân hợp lệ, bộ dò theo GIÁ TRỊ

RFQ hy sinh đi qua DRAFT → OPEN với một lời mời; mỗi route ghi có một thân hợp lệ và một đích
thật; khẳng định: không phản hồi nào là 422 "thiếu trường/sai kiểu", và ít nhất tám route trả 2xx.
Bộ dò: rút mọi số (bỏ dấu phân cách, mở rộng `e`), giải mã mọi khối base64 ~~dài rồi quét lại~~
**[review H4-11]** base64url (dạng token/cookie của dự án) và hex, sâu HAI tầng, rồi quét lại; đối
chứng dương cho `980,000,000`, `9.8e8`, base64, base64url, hex, hai tầng. Không bắt được rò THỨ TỰ
và mã hoá/nén khác ba dạng ấy — §4 của A2.

### Đo bằng gì

1. **38:** với email có và không có người dùng, `/auth/link` để lại đúng MỘT `outbox_jobs` mỗi lời
   gọi và KHÔNG hàng `user_login_tokens` nào trước khi runner chạy; chạy runner ⇒ email có người
   dùng nhận link, email lạ không; hạn mức 5/15 phút vẫn đứng (job thứ 6 chạy xong không gửi).
2. **39:** lần thứ ~~11~~ 31 `/auth/link` từ cùng IP ⇒ 429 có `Retry-After`; `/auth/redeem` sai token 30
   lần rồi lần 31 ⇒ 429 (đếm sống qua rollback); IP khác ⇒ vẫn 200. Đột biến bỏ bước đếm ⇒ lọt.
   [H4-4] 30 địa chỉ IPv6 KHÁC NHAU cùng /64 rồi lần 31 ⇒ 429; /64 khác ⇒ 200.
3. **41:** không proxy: XFF ⇒ `sessions.ip` = socket; có proxy tin cậy: XFF `a, b` với b tin cậy ⇒ a;
   socket lạ gửi XFF ⇒ socket.
4. **42:** `Set-Cookie` bắt đầu bằng `__Host-`, chứa `Path=/`, không `Domain`; header `Cookie` mang hai
   `__Host-tp_session` ⇒ 401.
5. **43:** app_api INSERT phiên đã-MFA khi `last_used_counter` cũ ⇒ 23514; tươi ⇒ đi qua; gỡ trigger
   ⇒ cũ đi lọt; đăng nhập trọn qua HTTP vẫn xanh.
6. **40:** BUYER ⇒ 403; PM tự duyệt ⇒ 422 (23514); PM2 duyệt ⇒ hồ sơ mất, phiên thu hồi, sổ có
   `MFA_RESET_REQUESTED` + `MFA_RESET_APPROVED`; người ấy `/auth/redeem` ⇒ `needsEnrollment: true`;
   app_api `DELETE mfa_credentials` không có yêu cầu ⇒ 23514; gỡ trigger ⇒ xoá được. [H4-1] app_api
   với hai phiên BUYER ⇒ 23514 ở INSERT lẫn UPDATE; gỡ hai trigger quyền ⇒ đi lọt tới DELETE. [H4-2]
   hết hạn ⇒ yêu cầu mới tạo được, cũ thành CANCELLED + `MFA_RESET_EXPIRED`; huỷ rồi duyệt ⇒ lỗi.
8. **[H4-3]** sau runner, không hàng `outbox_jobs` DONE nào của `LOGIN_LINK_SEND` còn payload khác
   `{}`; sáu chuỗi sai dạng ⇒ 422, không để lại job; gỡ trigger 041 ⇒ email nằm lại.
7. **49:** đếm 422 "thiếu trường" = 0 trên route ghi; đối chứng dương ba dạng viết.

## ADR-023 — Việc SAU COMMIT trong `JobRunner`: tác dụng phụ không rollback được chạy sau khi kết cục của job đã ghi; hạn mức theo tổ chức và cho tổ chức lạ; thân trigger được hardening ghim

**Ngày:** 2026-09-07 · **Trạng thái:** **Đã chấp nhận (chốt cùng ngày, S1.13)** · Đóng: sổ nợ 51, 52,
53 (ba phần chênh của review lượt 4) · Liên quan: ADR-010 (outbox), ADR-022, migration `039`–`041`,
`hardening.always.sql`, review lượt 4 H4-4/H4-5/H4-7/H4-10; lượt 5 (H5-x, `evidence/security-reviews.md`
§S1.13)

### 1. Nợ 53 — gửi email KHÔNG nằm trong giao dịch của job

| # | Phương án | Đánh giá |
|---|---|---|
| a | Giữ `send` trong giao dịch, thêm pool riêng nhỏ cho runner | Chỉ đóng vế "cạn pool"; vế "email đã đi mang token bị rollback rồi email thứ hai" vẫn còn — đó là vế huấn luyện người dùng bấm link chết. **Loại.** |
| b | Hai job: `LOGIN_LINK_SEND` phát token, enqueue `LOGIN_LINK_DELIVER` | Token phải đi qua payload (ADR-015 cấm) hoặc phải lưu dạng rõ để job sau đọc — cả hai đều là thứ 007/015 đã cấm bằng chữ. **Loại.** |
| c | **`JobHandler` được TRẢ VỀ một hàm (`SauCommit`); runner gọi nó SAU khi giao dịch của job (công việc + dấu DONE) đã commit và kết nối đã bị huỷ — ngoài mọi giao dịch, có trần `handlerTimeoutMs`** | Token commit trước, gửi sau: link trong email luôn trỏ tới một token đã tồn tại; bộ gửi treo không giữ kết nối nào. Đổi lại phần gửi là **at-most-once**: hàm ném hay quá hạn ⇒ `AFTER_COMMIT_FAILED` tới `onJobFailure` (`gaveUp=false`), job VẪN DONE, không thử lại, không ghi gì vào CSDL (CHECK của 007 không nhận lý do này — cố ý). Người dùng gọi lại `/auth/link`; token không gửi nằm đó tới hết hạn, chưa từng rời tiến trình. **Chọn.** |

Hợp đồng gói đổi tương thích: handler cũ trả `void` vẫn đúng kiểu; unseal-worker không đổi. Trần của
việc sau commit dùng chung `handlerTimeoutMs` — một trần, một tên lỗi (`HetGioHandlerError`), không
thêm nút cấu hình cho một việc mà hôm nay chỉ có một người dùng.

**[review H5-6] Ba điều phải nói thẳng:** ⑴ at-most-once là CỐ Ý — không phải thứ sẽ "sửa sau";
⑵ một token phát ra mà không gửi được vẫn tiêu 1/5 hạn mức 15 phút của người dùng (`issueLoginToken`)
— khi SMTP hỏng, người dùng bị "câm" tới hết cửa sổ mà không nhận được thông điệp nào, vì thân
phản hồi của `/auth/link` cố ý giống nhau cho mọi ca (nợ 38); ⑶ `AFTER_COMMIT_FAILED` hôm nay chỉ
tới `console.error` của composition (kind + reason) — dự án CHƯA có kênh cảnh báo vận hành nào, nên
"nối vào cảnh báo" là việc của ngày có kênh ấy, ghi ở đây để không ai tưởng nó đã có. **[review H5-4]**
`coHan` bọc `viec()` qua `Promise.resolve().then` — một adapter gửi NÉM ĐỒNG BỘ trước đây làm đồng hồ
của `coHan` reject không ai bắt và giết tiến trình; nay thành reject bình thường.

### 2. Nợ 52 — ba lỗ hạn mức còn lại

- **Trần TOÀN TỔ CHỨC** (`orgLimit` trên `AnonRoute`, hôm nay chỉ `/auth/link` = 300/15 phút): cùng
  giao dịch với bucket theo người gọi, khoá `route|to-chuc` (không địa chỉ). Bịt đường xoay /64 của
  IPv6 (H4-4) mà không siết NAT. ~~Hệ quả nói ra: 300 lời gọi từ bất kỳ đâu khoá `/auth/link` của một
  tổ chức 15 phút — DoS thu hẹp có chủ đích (chỉ route link, người đã có phiên không bị ảnh hưởng),
  rẻ hơn nhiều so với 300 email rác vào hộp thư của tổ chức ấy.~~ **[review H5-1, HIGH]** Câu vừa gạch
  là một vũ khí: `orgId` không phải bí mật (nằm trong cookie của mọi NCC từng được mời), và bản đầu
  cộng bucket tổ chức cả khi người gọi đã vượt trần riêng — MỘT địa chỉ, 300 lời gọi (270 là 429 rẻ)
  khoá cửa đăng nhập của cả tổ chức, lặp mỗi 15 phút. Nay: bucket tổ chức chỉ cộng khi người gọi
  CHƯA vượt trần riêng (một địa chỉ góp tối đa `callerLimit`), và vượt `orgLimit` thì **LÀM CHẬM**
  (`treQuaTranMs`, mặc định 2 s) rồi vẫn xử lý — nguyên tắc ADR-015 §5, "hạn mức theo đích chỉ được
  làm chậm, không được khoá". Log một dòng chỉ mang route + requestId (tín hiệu tấn công).
- **Tổ chức LẠ** (`BucketBoNho`, ~~`apps/api/src/bucket-bo-nho.ts`~~ — **[S1.21] tệp ấy đã bị XOÁ ở
  S1.14/ADR-024**, xem cuối mục này): 23503 ở bucket CSDL ⇒ đếm trong bộ
  nhớ theo `route|người gọi` (không orgId — xoay orgId lạ không mở thêm trần), CÙNG trần, 429 ở lần
  N+1 như tổ chức thật ~~⇒ oracle H4-5 đóng~~ **[review H5-3]** — oracle H4-5 vẫn còn, đổi dạng: hai bộ
  đếm rời nên mồi N lần vào một UUID giả rồi gửi UUID ứng viên là phân biệt được bằng MỘT lời gọi;
  chấp nhận với cùng lý do H4-5 (UUIDv4), đóng thật cần một bảng bucket không khoá ngoại tới
  `organizations` — sổ nợ 55. Trần 50 000 khoá; đầy ⇒ dọn khoá hết hạn, vẫn đầy ⇒
  FAIL-CLOSED cho khoá mới (kẻ xoay địa chỉ chỉ tự khoá mình và những người gọi tổ chức lạ khác —
  tổ chức thật có bucket CSDL). Theo tiến trình, mất khi khởi động lại — cùng giới hạn nhiều
  instance với runner (ADR-022).
- **Hai route khách** `/guest/redeem`, `/guest/otp/verify`: `callerLimit` 30/15 phút — cùng con số
  với `/auth/redeem`, `/auth/totp`. `/guest/otp` giữ bucket theo đích (ADR-018).

### 3. Nợ 51 — hardening ghim thân năm hàm trigger và định nghĩa sáu trigger

~~Năm~~ Tám mục mới theo khuôn `la_duong_ung_dung` ~~(chỉ canh khi hàm ĐÃ tồn tại — lượt hardening trước
vòng migration trên cụm mới không dựng hàm hộ)~~ **[review H5-2, MEDIUM]** với tiền điều kiện "MIGRATION
NGUỒN ĐÃ ÁP DỤNG" (dòng trong `schema_migrations`, hoặc bảng do chính migration ấy tạo): tiền điều kiện
"hàm đã tồn tại" làm một `DROP FUNCTION … CASCADE` (xoá cả hàm lẫn trigger) trở thành ca hardening
im lặng bỏ qua — khác `la_duong_ung_dung` (caller ném khi nó mất), các hàm này LÀ trigger, mất chúng
là mất phép kiểm mà không ai kêu (041 mất ⇒ email nằm lại; 039 mất ⇒ phiên đã-MFA không cần TOTP;
040 mất ⇒ `app_api` xoá được hồ sơ TOTP của bất kỳ ai). Nay hàm mất được DỰNG LẠI; lượt hardening
trước vòng migration trên cụm mới vẫn bỏ qua vì migration nguồn chưa được ghi. Mỗi mục: thân đã
chuẩn hoá + `prosecdef`/`proconfig`/kiểu trả về/ngôn ngữ + định nghĩa trigger nguyên văn qua
`pg_get_triggerdef` (gồm WHEN) + `tgenabled='A'`; câu sửa dựng lại từ bản nguồn. Máy trạng thái 040
(vô điều kiện, không qua điểm đơn) nay cũng được ghim. **[review H5-5]** Cùng lớp, cùng vòng: 013
`kiem_danh_tinh_theo_phien` (thân; 21 trigger của nó chưa ghim), 029/032 qua bản 037, và hai trigger
danh tính của 040. 48 hàm `RETURNS trigger` trong `public`, ghim 8 + hai của D3 + `chan_sua_xoa` —
danh sách viết tay, sổ nợ 54 (một test "mọi hàm trigger có mặt trong danh sách ghim"). Bản nguồn vẫn
ở migration; test đồng bộ đọc cả hai và so.

### Đo bằng gì

1. **53:** (outbox) hàm sau commit thấy hàng job đã DONE từ kết nối KHÁC; handler ném ⇒ hàm không
   chạy; hàm ném/treo ⇒ DONE + `AFTER_COMMIT_FAILED`, không ghi gì vào CSDL, lượt sau không nhặt lại.
   (api) tại lúc `send` được gọi, token đã commit (đếm từ pool khác) và job đã DONE; gửi hỏng ⇒ không
   email thứ hai. H2-7: bộ gửi treo ⇒ job DONE, lý do đổi thành `AFTER_COMMIT_FAILED` (gạch tại chỗ).
2. **52:** 300 địa chỉ IPv6 KHÁC /64 cùng tổ chức ⇒ lần 301 là 429, cùng địa chỉ mới tổ chức khác
   vẫn 200, bucket CSDL đúng hình (301 bucket ở 1, một bucket ở 301); hai orgId lạ xen kẽ ⇒ 429 ở
   lần N+1, tổ chức thật cùng địa chỉ vẫn 200, địa chỉ khác ⇒ 200; `/guest/redeem` sai 30 lần rồi
   429, `verify` đếm riêng, khách thật địa chỉ khác vẫn 200; bucket bộ nhớ: đầy ⇒ vô cực.
3. **51:** tĩnh — ~~năm~~ tám thân migration ↔ hardening khớp, hậu điều kiện `$than$` là chính thân ấy,
   mỗi trigger có định nghĩa ghim; trôi — thay hai thân thành `RETURN NEW`, DROP trigger 041, DISABLE
   trigger 039, [H5-2] `DROP FUNCTION … CASCADE` hai hàm (040, 029-qua-037), [H5-5] DROP trigger danh
   tính 040 ⇒ `migrate()` khôi phục tất cả và 041 sống lại (payload về `{}`). Test trôi đỏ THẬT trước
   khi thêm mục, và đỏ THẬT với tiền điều kiện cũ cho ca CASCADE (đo bằng cách chạy lại trên bản
   hardening trước H5-2: hai hàm không trở lại).
4. **[H5-1]** một địa chỉ 300 lời gọi (30 tới handler, 270 là 429) ⇒ địa chỉ sạch sau đó 200 và
   NHANH, bucket tổ chức = 31; 300 địa chỉ khác /64 ⇒ lần 301 vẫn 200 nhưng CHẬM ≥ `treQuaTranMs`.
   **[H5-4]** `viec()` ném đồng bộ ⇒ `coHan` reject đúng lỗi, không `unhandledRejection`.

## ADR-024 — Bộ đếm theo NGƯỜI GỌI nằm ngoài cây tenant: một bảng không `org_id`, không khoá ngoại; và danh sách ghim của hardening phải tự đối chiếu với thực tế

**Ngày:** 2026-09-07 · **Trạng thái:** **Đã chấp nhận (chốt cùng ngày, S1.14)** · Đóng: sổ nợ 54, 55
(hai phần chênh của review lượt 5) · Liên quan: ADR-013 (cô lập tổ chức), ADR-015 §5, ADR-018
(pepper), ADR-022, ADR-023, migration `042`, review lượt 4 H4-5 và lượt 5 H5-3/H5-5; lượt 6 (H6-x,
`evidence/security-reviews.md` §S1.14)

### 1. Nợ 55 — vì sao bộ đếm người gọi phải RỜI khỏi `otp_rate_limits`

| # | Phương án | Đánh giá |
|---|---|---|
| a | Giữ hai bộ đếm (CSDL cho tổ chức thật, bộ nhớ cho tổ chức lạ) và chấp nhận oracle | Đúng thứ H5-3 vừa bác: hai bộ đếm RỜI cho cùng một khoá là một oracle chỉ cần MỘT lời gọi sau khi mồi. **Loại.** |
| b | Bỏ khoá ngoại của `otp_rate_limits` | Bảng ấy còn ba kind theo ĐÍCH (số điện thoại, hộp thư). ADR-013 đòi `org_id` vào phép băm của chúng: không có nó, một bản sao lưu cho phép JOIN giữa hai tổ chức trên cùng tập nhà cung cấp. Bỏ khoá ngoại là nới lỏng đúng chỗ không được nới. **Loại.** |
| c | **Bảng RIÊNG `caller_rate_limits`: không `org_id`, không khoá ngoại, khoá `HMAC(pepper, "LOGIN_CALLER_TOAN_CUC" ‖ route ‖ ip)`** | Khoá của bucket này là *route* + *địa chỉ KẺ GÕ CỬA* — không mang bí mật xuyên tổ chức nào, nên `org_id` ở đó chỉ mua một oracle. Tổ chức thật và tổ chức lạ tăng CÙNG MỘT HÀNG ⇒ 429 không phân biệt được hai ca. **Chọn.** |

**Ba hệ quả được nói ra, không giấu:**
- **Bảng đầu tiên ngoài cây tenant mà `app_api` GHI được.** `roles`/`permissions`/`role_permissions`
  cũng ngoài cây tenant nhưng chỉ đọc. Mọi lớp canh "bảng tenant" của dự án (`VI_TU_BANG_TENANT` của
  hardening, hai danh sách ghim ở `db/`) đọc theo cột `org_id`, nên bảng này nằm NGOÀI chúng — và
  một phép đo từng giả định "bật RLS ⇒ thuộc cây tenant" đã phải sửa (`db/migrations.int.test.ts`,
  ca R3 dựng lại policy sau `DROP … CASCADE`).
- **Policy DUY NHẤT là "mọi hàng, trừ phiên KHÁCH".** `USING (true)` là đúng hình dạng
  `db/migration-shape.test.ts` cấm — nó không phân biệt được với một lần quên. Vế thật sự có nghĩa ở
  đây là vế khách (khoản nợ 29), nên nó là policy chứ không phải một lớp thứ hai.
- **Số hàng do người gọi VÔ DANH quyết** — khác `otp_rate_limits`, nơi khoá ngoại buộc phải có một
  tổ chức thật. Đường bịt là DỌN: `app_api` có DELETE mức bảng, tiến trình `api` chạy
  `donBucketNguoiGoiCu` mỗi 5 phút (`setInterval` có `unref`, lỗi chỉ ghi TÊN), xoá mọi cửa sổ cũ
  hơn HAI cửa sổ — không bao giờ chạm cửa sổ đang đếm. Giữa hai lần dọn, một kẻ xoay /64 vẫn tạo
  được hàng; hàng nhỏ và cửa sổ 15 phút, đó là phần chênh còn lại. **[review H6-8]** Đường bịt duy
  nhất không được hỏng trong im lặng: mỗi lượt dọn ồn ào ghi SỐ hàng, hai lượt hỏng liên tiếp ghi rõ
  "bảng chỉ lớn lên" — vẫn chỉ là `console.error`, vì dự án chưa có kênh cảnh báo vận hành (cùng
  câu đã phải viết cho `AFTER_COMMIT_FAILED` ở ADR-023). **[review H6-7]** Và bảng nằm ngoài
  `VI_TU_BANG_TENANT` nên nó cũng nằm ngoài lớp TỰ CHỮA RLS: một mục hardening riêng theo đối tượng
  giữ cho câu "vẫn bật RLS + FORCE" là tính chất của lược đồ chứ không của một lần chạy migration.

~~**Bucket TOÀN TỔ CHỨC (`orgLimit`, nợ 52) Ở LẠI `otp_rate_limits`:** nó đúng là chuyện của một tổ
chức. Tổ chức lạ không có nó (23503, bỏ qua) — và điều đó không mở lại oracle vì mã trạng thái của
hai ca đã do bucket toàn cục quyết trước; phần chênh còn lại là một giao dịch lỗi, tức THỜI GIAN.~~

**[review H6-2] Câu vừa gạch SAI ở đúng chỗ nó tự tin nhất.** Phần chênh không phải "một giao dịch
lỗi" mà là một lệnh ngủ **2 000 ms** do chính dự án đặt (H5-1): tổ chức lạ nuốt 23503 nên KHÔNG BAO
GIỜ chậm, còn tổ chức thật thì chậm sau khi vượt trần — ~301 lời gọi là đủ để dựng phép đo. Nên
trần toàn tổ chức cũng rời sang `caller_rate_limits` (khoá `route ‖ to-chuc ‖ orgId`). ADR-013 không
cấm điều đó: khoá ấy chỉ có route và chính `orgId`, không một giá trị nào CHUNG giữa hai tổ chức để
một bản sao lưu JOIN.

**[review H6-1] Và bucket theo người gọi không được CHỈ toàn cục.** Bản đầu bỏ `orgId` khỏi khoá,
nên mọi ca "gộp địa chỉ" — proxy chưa khai (mặc định!), CGNAT, địa chỉ rỗng — khoá cửa đăng nhập của
CẢ NỀN TẢNG với 31 lời gọi. Nay BA bộ đếm, cả ba ở bảng không khoá ngoại: `route ‖ ip` (trần toàn
cục của một địa chỉ, `callerLimit × 10` — bịt đường xoay `orgId` lạ), `route ‖ ip ‖ orgId` (trần
thật theo người gọi — bán kính nổ trở lại đúng một tổ chức), `route ‖ to-chuc ‖ orgId` (trần toàn tổ
chức, làm chậm). Có `orgId` trong KHOÁ mà không có khoá ngoại thì không phải oracle — chính đó là
điều 042 mua được. Cộng hai hàng rào: địa chỉ không phân giải được ⇒ **503** thay vì gộp vào một
bucket dùng chung, và `TRUSTPROCURE_TRUSTED_PROXIES` **bắt buộc** (CIDR hoặc `direct`).

### 2. Nợ 54 — một danh sách viết tay phải có lớp đối chiếu với thực tế

Hardening ghim thân hàm trigger theo danh sách viết tay. Hai lượt liền, danh sách ấy thiếu đúng thứ
vừa được thêm (H4-7 rồi H5-5) và không lớp nào kêu — vì không có gì so danh sách với CSDL. Nay có:
tập hàm `RETURNS trigger` trong `public` phải bằng ĐÚNG *(hàm hardening có canh)* ∪ *(danh sách loại
trừ có lý do)*, hai tập rời nhau. Tập thứ nhất **đọc thẳng từ `hardening.always.sql`** (mọi
~~`to_regprocedure('public.X()')`~~ **[review H6-3]** hình dạng của một mục ghim: phải có CÂU SỬA
`CREATE OR REPLACE FUNCTION public.X() RETURNS trigger` VÀ một lần nhắc ở câu phán xét. Rút theo một
lần NHẮC TÊN là mời người sửa nói dối: một tiền điều kiện của mục khác biến hàm thành "đã ghim", và
khi ấy cách rẻ nhất để test xanh là xoá nó khỏi danh sách loại trừ — viết tay ở đây là dựng lại đúng
cái mù vừa đóng.

**"Loại trừ" ở đây nghĩa là CHƯA GHIM, không phải KHÔNG CẦN GHIM.** Cả 35 hàm còn lại canh một bất
biến thật ở CSDL và thuộc cùng lớp trôi R3; mỗi hàm có một dòng nói nó canh gì, và cả lớp là **sổ nợ
56**. Cùng vòng: 19 trigger danh tính của `kiem_danh_tinh_theo_phien` (nằm rải bảy migration) được
ghim định nghĩa, mỗi cái có điều kiện `to_regclass(<bảng>) IS NOT NULL` và ~~ghim `tgenabled = 'O'` —
trạng thái THẬT của chúng, không phải trạng thái mong muốn~~ **[review H6-4]** ghim `'A'`, sau khi
migration `043` nâng cả 19 lên `ENABLE ALWAYS`: ghim `'O'` biến `migrate()` thành thứ HẠ một trigger
đã được nâng, và `'O'` là trạng thái mà `session_replication_role = 'replica'` bỏ qua — cùng hàm,
cùng bất biến D với hai trigger `'A'` của 040. **[review H6-6]** Trục thứ hai của cùng cái mù cũng
được đóng: tập TRIGGER của hàm ấy phải bằng đúng 19 + 2 tên đã khai, nên trigger thứ 22 là ĐỎ.

### Đo bằng gì

1. **55:** mồi N lần vào hai UUID lạ rồi gọi `orgId` THẬT ⇒ 429 với CÙNG thân (RED thật: trước vòng
   này là 200); địa chỉ khác ⇒ 200 cho cả tổ chức lạ lẫn tổ chức thật; hàng nằm ở CSDL (đếm được từ
   pool khác); phiên khách đọc 0 hàng và ghi ⇒ 42501; bộ dọn xoá cửa sổ cũ ba giờ và GIỮ cửa sổ đang
   đếm; băm mang pepper và không đụng hàng nào của `otp_rate_limits`.
2. **54:** thêm một hàm `RETURNS trigger` vào một migration tạm ⇒ test ĐỎ ngay và nêu tên hàm; DROP
   một trong 19 trigger danh tính ⇒ `migrate()` khôi phục đúng định nghĩa và đúng `tgenabled = 'O'`.

---

## ADR-025 — Một bảng tenant dọn được mà không đọc được: policy `FOR DELETE` cho kết nối chưa gắn tổ chức; và "loại trừ khỏi danh sách ghim" phải về RỖNG

**Ngày:** 2026-09-07 · **Trạng thái:** **Đã chấp nhận (chốt cùng ngày, S1.15)** · Đóng: sổ nợ 56, 57
· Liên quan: ADR-013 (cô lập tổ chức), ADR-022 (`listOrganizations` của runner), ADR-024 (nợ 54/55),
migration `044`, `045`, review lượt 6 H6-5⑵ và H6-4; lượt 7 (H7-x, `evidence/security-reviews.md`
§S1.15)

### 1. Nợ 57 — vì sao `otp_rate_limits` dọn được mà không cần biết "tổ chức nào"

| # | Phương án | Đánh giá |
|---|---|---|
| a | `DELETE` nền ngoài `withTenant` | Policy cách ly đọc `app_current_org_id()`; kết nối nền không gắn tổ chức ⇒ lọc hết, xoá 0 hàng. **Loại (đã đo).** |
| b | Dọn TỪNG tổ chức trong `withTenant` | Đòi biết TẬP tổ chức. `app_api` không đọc được danh sách ấy — đúng ràng buộc đã buộc runner outbox nhận `listOrganizations` (ADR-022), và bản cài đặt hôm nay của tuỳ chọn ấy là *"tổ chức tiến trình ĐÃ THẤY enqueue"*, không phủ tổ chức chỉ có lưu lượng KHÁCH. **Loại.** |
| c | Dọn CƠ HỘI trong `demVaTang` | Một `DELETE` trên MỌI lời gọi OTP: trả một việc nền bằng độ trễ của đường nóng. **Loại.** |
| d | Chuyển bảng ra ngoài cây tenant như `042` | `org_id` ở đây KHÔNG phải trang trí: ba `bucket_kind` theo ĐÍCH băm số điện thoại/hộp thư, và ADR-013 đòi `org_id` vào phép băm để một bản sao lưu không JOIN được hai tổ chức trên cùng tập nhà cung cấp. **Loại.** |
| e | **Một policy `FOR DELETE TO app_api` cho kết nối CHƯA gắn tổ chức, trên hàng đã quá một SÀN** | Không hỏi *"tổ chức nào"* mà hỏi *"hàng này còn chặn được ai"*. Bảng, cột và policy cách ly ở nguyên chỗ. **Chọn.** |

**Ba vế làm cho (e) không phải một lần nới RLS, và cả ba đo được:**
- Vế `NULLIF(current_setting('app.org_id', true), '') IS NULL` giữ policy NGOÀI mọi đường yêu cầu:
  mọi đường ấy đi qua `withTenant`, tức `app.org_id` luôn có. Không đường yêu cầu nào nhận thêm quyền.
- `FOR DELETE`, không `FOR ALL`: `[INV-F1]` (*"chưa gắn tổ chức thì mọi bảng tenant trả 0 hàng"*) còn
  đúng NGUYÊN VĂN. Bộ dọn **xoá được mà không đọc được**.
- Mốc tuổi nằm ở CSDL, không ở phía gọi.

**Điều đắt nhất của thiết kế, và nó là một RÀNG BUỘC chứ không phải một lựa chọn:** PostgreSQL đòi
policy `SELECT` cho một `DELETE` **ngay khi câu lệnh tham chiếu cột** — kể cả chỉ trong `WHERE`. Đo
trên PostgreSQL 16.15, dưới `app_api` chưa gắn tổ chức, một hàng 90 phút tuổi:

```
DELETE ... WHERE window_start < now() - interval '30 minutes'   -> 0 hàng   (policy SELECT chặn)
DELETE FROM otp_rate_limits                                     -> 1 hàng   (chỉ policy DELETE)
```

Nên bộ dọn chạy câu **TRẦN** và **không có tham số tuổi, và không thể có**: một bộ dọn muốn tự viết
mốc sẽ buộc phải có đường đọc, tức phá vế thứ hai. PostgreSQL tự AND vế `USING` vào, nên tuổi do
CSDL áp. Con số 30 phút vì thế sống ở ĐÚNG MỘT chỗ có hiệu lực (`044`) cộng một bản ghim để khôi
phục (`hardening.always.sql`), và một test đọc thẳng cả hai file so với `OTP_RATE_WINDOW_SECONDS`.

**Mặt nguy hiểm của câu trần, nói thẳng:** chạy nó trên kết nối ĐÃ gắn tổ chức thì policy cách ly
duyệt MỌI hàng của tổ chức ấy — kể cả cửa sổ đang đếm — và hạn mức của họ về 0. CSDL không phân biệt
được ca ấy với một lệnh dọn hợp lệ, nên phép phân biệt nằm ở hàm gọi: lấy client, HỎI `app.org_id`,
ném nếu đã gắn. **[review H7-6]** Và cả hai câu nằm trong MỘT giao dịch có `SET LOCAL
statement_timeout` — một lượt dọn bệnh lý không được giữ một kết nối của pool YÊU CẦU vô hạn định.

**HAI CỬA MỞ CÓ TÊN, mỗi cửa một dòng và một meta-test.** Đây là lần đầu dự án mở cửa nào trong hai:
- `NGOAI_LE_HINH_DANG` (hardening + `db/rls-coverage.int.test.ts`) nhận **dòng đầu tiên sau ba vòng
  RỖNG**, khoá đủ sáu cột. Ghi chú của chính danh sách ấy nói trước rằng nó *"chỉ nổ khi cấp dòng
  đầu tiên — tức khi không ai còn nhìn"*: bộ đọc danh sách đọc mỗi ô bằng `'([^']*)'`, tức chỉ đọc
  được ô KHÔNG có nháy đơn bên trong. Đúng với danh sách rỗng, sai ngay với dòng đầu tiên.
- `NGOAI_LE_LAC_CHO` (`db/migration-shape.test.ts`) cho đúng (file, bảng, policy) này. **Không nới
  quy tắc:** miễn trừ theo LỚP sẽ pre-approve mọi policy PERMISSIVE tương lai trên mọi bảng đã có
  policy. **[review H7-5]** Cửa chỉ mở cho `CREATE` — khoá ba trục không mang LỆNH, nên thiếu vế ấy
  thì một `ALTER POLICY … USING (true)` trong cùng file cũng được tha.

**Phần chênh nói ra, không giấu:** ⑴ một `api` bị chiếm nay xoá được hàng đã quá 30 phút của tổ chức
KHÁC — hàng không còn chặn ai, mất chúng là mất một trần đã hết hiệu lực; ⑵ `rowCount` của câu trần
là một con số XUYÊN TỔ CHỨC (bao nhiêu cửa sổ chết tồn tại), chỉ đọc được bởi chính tiến trình;
⑶ ~~**[review H7-3]** câu dọn quét TOÀN BẢNG — vế lọc là OR của hai policy trên hai cột nên không chỉ
số nào phục vụ được, đã đo bằng `EXPLAIN`: 20 000 hàng = 9,5 ms, tức ~0,5 µs/hàng và 5 triệu hàng ≈
2,4 giây mỗi năm phút (**sổ nợ 58**)~~ — **[S1.16 / sổ nợ 58] SAI, và sai theo cách đáng ghi:** phép
đo của H7-3 có thật nhưng chạy ở chế độ **95% hàng quá sàn**, nơi Seq Scan là tối ưu THẬT; kết luận
*"không chỉ số nào phục vụ được"* là một suy diễn QUÁ PHẠM VI từ nó. Ở chế độ của một bảng đang chạy
(1% quá sàn), PostgreSQL dựng `BitmapOr` từ khoá chính + `otp_rate_limits_window_idx`: **1,07 ms** so
với **37,96 ms** — 35 lần, và chi phí đi theo SỐ HÀNG PHẢI XOÁ chứ không theo kích thước bảng. `046`
dựng lại chỉ số mà H7-3 đã gỡ; ⑷ bộ dọn theo TIẾN TRÌNH, như mọi bộ dọn khác của dự án.

### 2. Nợ 56 — "loại trừ" là một khoản nợ, không phải một hạng mục

ADR-024 dựng lớp đối chiếu: tập hàm `RETURNS trigger` trong `public` = *(hàm hardening có canh)* ∪
*(loại trừ có lý do)*. Lớp ấy giữ cho danh sách không lớn thêm trong im lặng, nhưng nó **không rút
ngắn** danh sách — và 35 dòng loại trừ ấy canh máy trạng thái RFQ, phân tách nhiệm vụ D2, append-only
của báo giá, tính bất biến của vật liệu khoá và tính đơn điệu của thu hồi. Vòng này ghim nốt: 35 hàm,
41 trigger, cùng khuôn. `HAM_TRIGGER_KHONG_GHIM` nay RỖNG, và phép kiểm đổi từ *"hai tập phủ nhau"*
sang *"tập ghim BẰNG tập thật"* — thêm một dòng loại trừ là MỞ LẠI sổ nợ 56 và làm test đỏ.

**MỘT LỚP MỚI mà bốn vòng trước không có, và nó không phải lo xa.** Bảy trong 35 hàm được
`CREATE OR REPLACE` nhiều lần (`otp_kiem_kenh_khac_link` ba lần: 010 → 012 → 022). Hardening chạy
TRƯỚC vòng migration đánh số và migration cũ đã có dòng trong `schema_migrations` nên không chạy lại
— nên một bản ghim trỏ vào thân CŨ làm `migrate()` **LÙI** hàm về thân ấy ở MỌI lần triển khai, vĩnh
viễn, trong im lặng. Test đồng bộ KHÔNG bắt được ca đó: nó so hardening với đúng file được khai, và
hai bên khớp nhau hoàn hảo — chỉ là khớp vào bản sai. Nay có một phép kiểm riêng: **migration ghi
trong mỗi mục ghim phải là migration CUỐI CÙNG định nghĩa hàm ấy**.

**`045` nâng 37 trigger còn lại lên `ENABLE ALWAYS`** — cùng lập luận H6-4 đã dùng cho `043`, áp cho
phần còn lại, và phải đi CÙNG COMMIT với các mục ghim (ghim `'O'` là biến `migrate()` thành thứ hạ
cấp một trigger đã nâng; ghim `'A'` mà không nâng thật là bắt mọi lần `migrate()` phải sửa). Sau
`045`, câu phát biểu đúng của lược đồ là **"không còn trigger ORIGIN nào"** (80/80), và một migration
tương lai thêm một trigger ORIGIN sẽ đỏ ở một phép kiểm suy từ TÍNH CHẤT.

**`045` KHÔNG phải thứ làm cho trạng thái cuối đúng, và nói ra vì đã đo:** bỏ một câu `ALTER` khỏi nó
thì trigger ấy VẪN về `'A'` — mục ghim thấy `tgenabled <> 'A'` rồi DROP/CREATE lại. Thứ `045` mua là
hình dạng của lần triển khai (đổi cờ tại chỗ thay vì dựng lại 41 trigger, trong đó có hai
`CONSTRAINT TRIGGER`) và một câu lệnh mà người review đọc được.

**[review H7-1] Và cùng cái mù mà H6-6 đóng cho MỘT hàm vẫn nguyên cho 42 hàm còn lại:** mục ghim chỉ
đòi các trigger ĐÃ KHAI phải tồn tại, nên gắn thêm một trigger cho một hàm đã ghim đi qua mọi lớp
trong im lặng — và trigger ấy không có định nghĩa `$def$` nào canh. Nay so BẰNG NHAU, theo TÊN chứ
không theo *(hàm → tập trigger của hàm ấy)*: hai trigger `mfa_reset_requests_kiem_danh_tinh*` chạy
`kiem_danh_tinh_theo_phien` nhưng được ghim trong mục của `mfa_reset_kiem_quyen`, và khoá theo hàm
sẽ báo đỏ đúng cặp ấy vì một lý do sai.

### 3. Giá của hai quyết định này, và cái KHÔNG được hứa

- `hardening.always.sql` đi từ ~4 400 lên ~7 500 dòng, trong đó ~1 000 dòng là thân plpgsql CHÉP LẠI
  từ migration. Đó là một nguồn sự thật thứ hai, và nó chấp nhận được ĐÚNG VÌ có hai lớp canh bản
  chép: test đồng bộ (thân trong migration ≡ thân trong hardening ≡ hậu điều kiện `$than$`) và test
  "migration cuối cùng". Không có hai lớp ấy thì đây là một cái bẫy chứ không phải một bản ghim.
- Ghim thân KHÔNG bảo vệ trước một migration ĐÁNH SỐ MỚI cố ý làm hàm yếu đi — nó chỉ bảo vệ trước
  TRÔI SAU TRIỂN KHAI (lớp R3). Một migration mới là một thay đổi có review; một `CREATE OR REPLACE`
  trên cụm thì không.
- Bộ dọn `otp_rate_limits` chạy theo TIẾN TRÌNH ~~và quét toàn bảng. Đường thoát khi quy mô đòi (sổ nợ
  58) là một bộ dọn GẮN TỔ CHỨC (có `WHERE`, dùng được chỉ số) cho các tổ chức đã thấy, CỘNG câu trần
  cho phần còn lại — tức đúng đường ⑵ đã loại ở trên, nhưng khi ấy nó là một tối ưu chứ không phải cơ
  chế duy nhất.~~ **[S1.16]** Nó KHÔNG quét toàn bảng: `BitmapOr` dùng được cả hai vế của phép OR khi
  chỉ số của vế thứ hai tồn tại, nên "đường thoát" vừa gạch không cần tới. Vế còn đúng: bộ dọn theo
  TIẾN TRÌNH, và nhiều instance nghĩa là nhiều lượt dọn — vô hại vì câu lệnh idempotent.

---

## ADR-026 — Artefact neo ngoài: một dòng CHỈ-GHI-THÊM các mốc neo ĐƯỢC KÝ, và `ExternalAnchor` chỉ đúc được từ một chữ ký ĐÃ KIỂM

**Ngày:** 2026-09-07 · **Trạng thái:** **Đã chấp nhận (chốt cùng ngày, S1.17)** · Đóng: sổ nợ 11 và
nửa sau của sổ nợ 30 · Liên quan: ADR-006 (hai role, khuôn `unwrap.ts`), ADR-009 (AWS KMS
`ap-southeast-1`), ADR-011 mục 3 (xoay khoá là THÊM, không THAY), ADR-016 (danh tính là DẪN XUẤT,
không phải THAM SỐ), ADR-022 (`listOrganizations` do composition root tiêm), `evidence/INV-matrix.md`
§4 mục B2 và §4.1 (phát biểu bàn giao B3/B4)

### 0. Câu hỏi, và vì sao nó không phải một câu hỏi kỹ thuật nhỏ

Bàn giao Task 5 của S0 đo được ba đường mà **chủ sở hữu bảng không-superuser** — tức chính role
deploy — dựng lại được cả sổ kiểm toán lẫn bảng mốc neo mà `migrate()` vẫn báo OK. Từ đó, phát biểu
đúng mức của B3 có một mệnh đề *nếu và chỉ nếu*:

> `CHUOI KHONG CO NEO NGOAI chung minh VE CO BAN LA KHONG GI CA` ... `NEU VA CHI NEU co ExternalAnchor
> giu o noi role deploy KHONG GHI DUOC: chuoi con phat hien so bi THAY THE / DUNG LAI / LAM RONG`

Cơ chế cho mệnh đề ấy đã có từ S0 (`exportChainHead`, `ExternalAnchor`, nhánh `externalAnchors` của
bộ kiểm chứng). **Artefact thì chưa** — và `writer.ts` liệt kê đúng năm thứ thiếu: *không exporter,
không lịch, không nơi cất, không chữ ký, không entry point*. Hệ quả đo được, cũng viết ở đó:

> "Người gọi vẫn tự tay đúc được một neo giả (`{ ...xuat, source: "bịa" }`) — không lớp kiểu nào chặn
> được điều đó, và nói ngược lại là nói quá."

Tức lớp *"phải có neo ngoài mới được xanh"* mà vòng fix 1 mua được, vòng fix 2 chỉ làm cho khó viết
nhầm hơn chứ không đóng. Một dòng là đủ để có một kết luận kiểm toán màu xanh không dựa trên gì.

### 1. Bốn quyết định

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Artefact có được KÝ không? | **Có.** ECDSA P-256 + SHA-256, chữ ký **DER**, trên một **văn bản chính tắc** cùng khuôn biên nhận (`buildReceiptText`). |
| 2 | Vòng khoá ký mốc neo có dùng chung với vòng khoá ký BIÊN NHẬN không? | **Không.** Vòng riêng, `AnchorSigningKeyRing`. |
| 3 | `ExternalAnchor` đúc ở đâu? | **Chỉ ở `verifyAnchorRecord`**, sau khi chữ ký đạt. Kiểu mang một **dấu đúc** (symbol module-private); `verifyAuditChain` kiểm dấu đúc ở tầng chạy và báo `ANCHOR_UNVERIFIED`. |
| 4 | Nơi cất có hình dạng gì? | **Một dòng JSONL cho mỗi tổ chức, CHỈ GHI THÊM.** `readAllRaw` trả `unknown[]` — nơi cất nằm ngoài vùng tin cậy theo đúng định nghĩa của nó. |

**Mục 2 không phải một chi tiết.** Ba lý do, và cả ba là hậu quả chứ không phải sở thích: ⑴ khoá ký
biên nhận sống trong tiến trình `api`, tức TRONG vùng tin cậy mà mốc neo sinh ra để ràng buộc; ⑵ nhịp
xoay khác nhau; ⑶ một lần lộ khoá ký biên nhận cho phép đúc biên nhận giả — nếu cùng khoá ấy đúc được
mốc neo thì kẻ tấn công RỬA LUÔN được cái sổ đã ghi việc đó.

### 2. Chữ ký và tính chỉ-ghi-thêm chặn HAI thứ khác nhau — không cái nào thay được cái kia

Đây là điều dễ đọc nhầm nhất của vòng này, nên nó được viết ở khối đầu `anchor-store.ts` và đo bằng
một test có ĐỐI CHỨNG:

- **Chữ ký chặn BỊA THÊM.** Kẻ sửa sổ rồi muốn một mốc neo khớp với sổ đã sửa phải có khoá riêng.
- **Chỉ-ghi-thêm chặn BỎ BỚT.** Kẻ ghi đè được nơi cất **không cần giả mạo gì cả** — họ chỉ cần giữ
  lại mốc neo cũ. Mọi bản ghi còn lại đều thật, chữ ký đều hợp lệ, và kết luận vẫn xanh trên một cái
  sổ đã bị cắt đuôi.

Phép đo (`chain.int.test.ts`, *"cắt đuôi rồi XUẤT LẠI"*), trên một sổ thật và một nơi cất thật:

| Vế | Nơi cất giữ gì | Kết luận kiểm toán |
|---|---|---|
| A — chỉ-ghi-thêm | neo seq **6** và neo seq **3** | `ok=false`, `ANCHOR_MISSING` tại seq 6 |
| B — **đối chứng**, mô phỏng nơi cất GHI ĐÈ | chỉ neo seq **3** | `ok=true`, `problems: []` — **sạch hoàn toàn trên một cái sổ đã bị cắt mất một nửa** |

Vế B là thứ làm cho vế A có nghĩa. Không có nó, *"chúng tôi giữ mọi mốc neo"* là một lựa chọn triển
khai; có nó, đó là một ràng buộc có hậu quả đo được. Mốc chết: hằng số `CO_CHE_MO_DE_GHI` của
`anchor-store.ts` — đổi `"a"` thành `"w"` thì bốn test ĐỎ.

### 3. Dấu đúc — nói đúng mức, vì đây là chỗ dễ nói quá nhất

`ExternalAnchor` mang một thuộc tính khoá bằng `Symbol()` module-private (KHÔNG `Symbol.for`, vốn đọc
sổ đăng ký toàn cục). Hai lớp, và chúng đo được riêng rẽ:

- **Tầng kiểu:** một object literal thiếu dấu đúc không typecheck. Mốc chết là hai `@ts-expect-error`
  trong `anchor-verify.test.ts` và `verifier.test.ts` — gỡ dấu đúc khỏi kiểu thì `tsc` ĐỎ với
  *"Unused '@ts-expect-error' directive"*, tức lớp này không mục đi được trong im lặng.
- **Tầng chạy:** `verifyAuditChain` kiểm dấu đúc TRƯỚC phép lọc tổ chức, và một giá trị không mang nó
  cho ra `ANCHOR_UNVERIFIED` + `NOT_ANCHORED`. Thứ tự ấy chịu lực: nếu phép lọc tổ chức đứng trước thì
  một mốc neo tự đúc chỉ cần mang một `orgId` lạ là đi qua trong im lặng.

**[review lượt 9 — H9-2] BẢN ĐẦU CỦA LỚP NÀY KHÔNG MUA ĐƯỢC THỨ NÓ TỰ NHẬN, và phát hiện ấy đáng
đọc kỹ hơn bản vá.** Dấu đúc khi ấy là một thuộc tính own **enumerable** khoá bằng symbol, còn
`laNeoDaKiemChuKy` đọc nó bằng phép truy cập thuộc tính. Nhưng spread và `Object.assign` **chép own
enumerable symbol keys**, và phép truy cập thuộc tính đọc qua chuỗi prototype. Nên:

```ts
const neoGia = { ...neo, seq: 3, hashHex: "b".repeat(64) };   // typecheck SẠCH
```

—không cần `as unknown as`, không cần `@ts-expect-error`, và `verifyAuditChain` nhận nó như một mốc
neo đã kiểm chữ ký. Tức đường lọt **không** phải một nỗ lực có chủ đích như câu cũ mô tả; nó là **một
dòng refactor bình thường** (`neoDaTai.map(n => ({ ...n, exportedAt: chuanHoa(n.exportedAt) }))`), tức
đúng thứ *"lọt vào một cách TÌNH CỜ"* mà lớp này sinh ra để chặn. Cả bốn cổng — `tsc`, `eslint`,
`depcruise`, test — đều im.

Bằng chứng ở tầng chạy vì thế chuyển sang một **`WeakSet` module-private**: tư cách thành viên gắn với
CHÍNH THAM CHIẾU, nên spread, `Object.assign`, `Object.create` và `structuredClone` đều không mang nó
theo. Thuộc tính symbol vẫn còn, nhưng CHỈ để tầng KIỂU giữ được hai `@ts-expect-error` làm mốc chết.
Năm ca sao chép có test riêng, và mốc chết của chúng là: đổi `laNeoDaKiemChuKy` về phép đọc thuộc tính
thì bốn trong năm ca ĐỎ.

**Cái nó KHÔNG mua, viết ra để không ai đọc rộng hơn:** kẻ chạy được mã trong tiến trình kiểm toán
vẫn không bị chặn — họ import `verifyAnchorRecord` và tự đúc, hoặc sửa thẳng kết quả trả về. Thứ mua
được đúng bằng chừng này: **một mốc neo chưa qua kiểm chữ ký không còn lọt vào được một cách TÌNH
CỜ** — và từ lượt review thứ chín, câu đó mới thật sự đúng.

Cùng một nước đi với ADR-016 (*lỗ đóng bằng HÌNH DẠNG CHỮ KÝ, không bằng một phép kiểm phải nhớ gọi*),
khác ở chỗ ở đó hình dạng chữ ký đóng được lỗ một mình; ở đây nó là lớp thứ hai, lớp chịu lực là chữ
ký số.

### 4. Ranh giới KHẢ NĂNG: bộ ký không được vào tiến trình `api`

`packages/audit` được `apps/api` import ở mọi đường ghi. Nếu bộ ký mốc neo nằm trong cửa công khai
của gói thì tiến trình `api` — tiến trình NẰM TRONG vùng tin cậy mà mốc neo ràng buộc — link luôn được
khả năng đúc mốc neo. Chưa phải một lỗ (vẫn cần khoá riêng), nhưng nó xoá ranh giới mà cả cơ chế đứng
trên.

Nên `anchor-sign.ts` đi theo đúng khuôn `packages/crypto-keys/src/unwrap.ts` (ADR-006, INV-G1): không
re-export ở `index.ts`, một subpath export riêng (`@trustprocure/audit/anchor-sign`), và **họ quy tắc
`g11-`** với ba quy tắc — quy tắc đích danh, cộng hai quy tắc *"không import ngược"* cho hai module
được miễn trừ, vì một module được miễn trừ mà không phải đích hạn chế là một cây cầu (bài học N5 của
S0). Mốc chết: thêm một dòng `export ... from "./anchor-sign.js"` vào `index.ts` thì depcruise ĐỎ với
`g11-ky-neo-chi-o-cong-cu-xuat-neo`.

### 5. Cái vòng này KHÔNG đóng — ba thứ, mỗi thứ một lý do

⑴ **LỊCH.** Bốn trong năm thứ mà `writer.ts` liệt kê nay đã có; thứ thứ năm là một tiến trình chạy đều
ở một nơi đã triển khai, và dự án **chưa triển khai ở đâu**. Đây không phải một khoản nợ mã nguồn, và
biến nó thành một cron trong kho sẽ là một lời khai rộng hơn sự thật.

⑵ **TÍNH ĐỘC LẬP CỦA NƠI CẤT.** `createFileAnchorStore` ghi ra một thư mục trên đĩa. Ai xoá được thư
mục ấy thì xoá được mốc neo, ~~và không dòng mã nào đổi được điều đó~~.

**[review lượt 9 — H9-1] VẾ VỪA GẠCH LÀ MỘT LỜI KHAI SAI, VÀ NÓ CHE MỘT LỖ FAIL-OPEN ĐẦU-CUỐI.** Mã
không ngăn được việc xoá — đúng. Nhưng bản đầu của `append` gọi `mkdir(recursive)` rồi để `appendFile`
tự tạo tệp, tức nó làm đúng điều tệ nhất mà mã làm được ở chỗ đó: ghép với một bộ xuất chạy theo lịch,
một lần XOÁ nơi cất không phải là *mất mốc neo* mà là **RESET nơi cất về trạng thái "chưa từng neo"**,
và lượt xuất kế tiếp lấp đầy lại bằng mốc neo của cái sổ đã bị cắt. Kịch bản đủ năm bước, không bước
nào bị một dòng mã nào phản đối:

1. sổ 6 hàng, nơi cất có neo `seq=6` ký hợp lệ;
2. `DELETE ... WHERE seq > 3`, dọn `audit_chain_anchors`, tính lại đuôi bằng `audit_compute_hash`;
3. `rm -rf $TRUSTPROCURE_NEO_KHO`;
4. bộ xuất chạy theo lịch → `mkdir` dựng lại, `appendFile` dựng lại, ghi neo `seq=3` **ký hợp lệ**;
5. `kiem` → `ok=true`, `problems: []`, **mã thoát 0**.

Cửa sổ giữa bước 3 và 4 CÓ kêu (`NOT_ANCHORED`) — và chính bộ xuất đóng nó lại.

**Hai lớp đóng ca đó, và cả hai đo được:** ⑴ `append` KHÔNG còn tạo thư mục gốc; nơi cất vắng mặt thì
NÉM, và việc dựng nó là một lệnh tường minh (`pnpm neo khoi-tao`). ⑵ `xuat` đọc nơi cất TRƯỚC khi ghi
và **từ chối** một mốc neo có `seq` LÙI so với mốc cao nhất đã kiểm được — `audit_events.seq` chỉ đi
lên, nên một đầu chuỗi thấp hơn là một vụ cắt đuôi, và bộ xuất ở đúng vị trí để nói ra điều đó vào
đúng lúc nó xảy ra.

**Ca CÒN HỞ, nói thẳng:** xoá đúng MỘT tệp `<org>.jsonl` mà giữ thư mục thì lớp ⑵ mất mốc so sánh.
Đóng nó đòi một trạng thái nằm NGOÀI nơi cất — tức lại đúng bài toán triển khai dưới đây.

Mã giữ đúng phần hợp đồng mà mã giữ được — **không có một thao tác nào sửa hay xoá một bản ghi đã
ghi**, đường ghi mở tệp ở chế độ nối thêm, và một nơi cất vừa biến mất thì KÊU thay vì tự dựng lại.
Phần còn lại thuộc TRIỂN KHAI: một bucket S3 bật **Object Lock chế độ Compliance**, trong một tài
khoản AWS mà role deploy không có vai trò nào. Ở đó *"không xoá được"* là một chính sách IAM đọc được
thay vì một câu trong tài liệu này. **Cho tới lúc đó, phát biểu đúng là: cơ chế đã đủ, chỗ cất thì
chưa.**

⑶ ~~**CÔNG THỨC KIỂM BẰNG `openssl(1)`.**~~ **ĐÓNG 2026-09-07 (S1.19).** Nguyên văn giữ lại vì
đường đóng nó tự viết ra đã được đi đúng từng bước:

> [review lượt 9 — H9-9] Định dạng được chọn đúng để OpenSSL kiểm được, và điều đó ĐÃ ĐO — nhưng
> đo qua `createVerify` của `node:crypto`, không qua `openssl(1)` trên một tệp tách ra từ JSONL.
> Ba thao tác ở giữa (tách `text`, `base64 -d` cho `sig`, đổi SPKI DER sang PEM) chưa ai trong kho
> này chạy. Đường đóng: một lệnh phụ `trich` xuất ba tệp cộng một test int chạy `openssl` thật.

`pnpm neo trich --org <uuid> --ra <thư-mục> [--seq <n>]` sinh ba tệp, và
`tools/neo-so-kiem-toan/src/cong-cu.int.test.ts` chạy `openssl dgst -sha256 -verify` THẬT trên
chúng: **Verified OK**, cộng **ba đối chứng âm** (sửa một ký tự của `chain_hash`, lật một byte cuối
chữ ký, dùng một khoá công khai lạ) — cả ba đều làm OpenSSL từ chối.

**Ba tính chất của lệnh ấy, mỗi cái đóng một ca hỏng cụ thể:** ⑴ nó đi qua `loadVerifiedAnchors`
nên **không tách artefact ra khỏi một nơi cất đang hỏng** — một artefact tách ra từ một tệp có bản
ghi không kiểm được là một artefact TRÔNG SẠCH HƠN nơi nó đến, và `openssl` chỉ phán xét ba tệp
trước mặt nó; ⑵ nó **KHÔNG đọc `DATABASE_URL`** — nếu khâu tách đòi cơ sở dữ liệu thì thứ gọi là
*"artefact độc lập"* vẫn phải đi qua chính hệ thống bị kiểm; ⑶ nó ghi văn bản bằng
`Buffer.from(text, "utf8")`, và **đột biến ghi ra CRLF làm `openssl` từ chối** — thông điệp của một
lần dịch xuống dòng giống hệt thông điệp của một chữ ký giả mạo (*"Verification failure"*).

**MỘT PHÉP ĐO CỦA VÒNG NÀY BÁC MỘT NỬA LẬP LUẬN CỦA CHÍNH NÓ, ghi ra vì nó đắt hơn kết luận.** Bản
đầu biện minh cho việc dựng PEM bằng cách bọc base64 (thay vì qua `createPublicKey`) bằng câu:
*"một SPKI DER lưu sai chút ít sẽ được Node lặng lẽ sửa, còn kiểm toán viên chạy `openssl pkey
-pubin -inform DER` thì gãy"*. Đo trên một SPKI P-256 91 byte cộng MỘT byte rác: `createPublicKey`
**nhận** và chuẩn hoá về 91 byte; `openssl pkey -pubin -inform DER` **cũng nhận**, mã thoát 0. Vế
*"kiểm toán viên thì gãy"* **không được chứng minh**. Thứ lựa chọn ấy thật sự mua, và chỉ chừng
này: **PEM đi ra là bản chép ĐÚNG BYTE của thứ nơi cất đang giữ.**

**Và giới hạn phải nói ngay, vì nó là chỗ dễ đọc rộng nhất:** `node:crypto` gọi OpenSSL bên dưới,
nên đây **KHÔNG** phải hai cài đặt mật mã độc lập. Thứ mới là **CÔNG THỨC** — một chuỗi thao tác
của con người, chạy trên đúng những tệp một kiểm toán viên sẽ có trong tay, bằng một chương trình
KHÁC tiến trình đã tạo ra chúng. Câu *"kiểm toán viên kiểm được mà không cần một dòng mã nào của
chúng ta"* vẫn **chưa** đúng: `trich` là mã của chúng ta.

⑷ **NEO NGOÀI CHO KHOÁ CÔNG KHAI CỦA CHÍNH MỐC NEO.** Kiểm toán viên phải lấy được vòng khoá công khai
qua một đường KHÁC đường lấy artefact — nếu không, kẻ chiếm được cả hai phục vụ một cặp khớp nhau.
Đây là **đúng cùng một bài toán** với `fingerprint` của `apps/public-keys` (khoản nợ 30 nửa đầu), và
cùng một câu trả lời: in vào hợp đồng, đọc qua điện thoại, đăng ở nơi ta không kiểm soát. Vòng này
không sinh ra bài toán ấy và cũng không đóng nó; nó chỉ làm cho bài toán ấy trở thành **thứ duy nhất
còn lại**.

**Và một giới hạn CŨ không đổi, nhắc lại vì nó dễ bị quên khi có artefact thật:** mốc neo ràng buộc
QUÁ KHỨ tới lần xuất cuối. Nhịp neo CHÍNH LÀ cửa sổ giả mạo. Nó vẫn không nói gì về sự kiện bị NUỐT
TRƯỚC KHI GHI — lớp phòng thủ cho ca đó là danh sách trắng trigger trong `hardening.always.sql`,
không phải chuỗi hash và không phải mốc neo.

### 6. Danh sách tổ chức là THAM SỐ của công cụ, không phải thứ nó tự đoán

`app_api` không đọc được danh sách tổ chức — cùng ràng buộc đã buộc runner outbox nhận
`listOrganizations` từ composition root (ADR-022), và bản cài đặt hôm nay của tuỳ chọn ấy là *"tổ chức
tiến trình ĐÃ THẤY enqueue"*, một tập KHÔNG phủ hết. Một bộ xuất tự đoán sẽ im lặng bỏ sót đúng những
tổ chức ít hoạt động nhất — và một tổ chức không được neo thì `verifyAuditChain` trả `NOT_ANCHORED`,
tức **mất trắng bảo đảm chứ không suy giảm dần**. Nên `--org` là bắt buộc và lặp lại được, và việc giữ
danh sách ấy đúng là một sự thật vận hành phải viết ra ở đâu đó.

### 7. Đo bằng gì

1. **Đột biến nơi cất:** `CO_CHE_MO_DE_GHI` `"a"` → `"w"` ⇒ 4 test ĐỎ, trong đó có *"cắt đuôi rồi XUẤT
   LẠI"* của `chain.int.test.ts`. ✔ đã đo.
2. **Đột biến dấu đúc ở tầng chạy:** vô hiệu hoá `if (!laNeoDaKiemChuKy(neo))` ⇒ 2 test ĐỎ. ✔ đã đo.
3. **Đột biến dấu đúc ở tầng kiểu:** gỡ `[DAU_DUC]` khỏi `ExternalAnchor` ⇒ `tsc` ĐỎ, 3 lỗi, trong đó
   2 lỗi *"Unused '@ts-expect-error'"*. ✔ đã đo.
4. **Đột biến đối chiếu dạng chính tắc:** bỏ `buildAnchorText(truong) === text` ⇒ test *"văn bản KÝ
   HỢP LỆ mà không ở dạng chính tắc"* ĐỎ. ✔ đã đo.
5. **Đột biến ranh giới khả năng:** `index.ts` re-export bộ ký ⇒ depcruise ĐỎ với
   `g11-ky-neo-chi-o-cong-cu-xuat-neo`. ✔ đã đo.
6. **Đối chiếu HAI CÀI ĐẶT:** fixture của test ký bằng `createSign` trần của `node:crypto` — đúng con
   đường `openssl dgst -sha256 -sign` đi — chứ KHÔNG gọi `anchor-sign.ts`. Nên mọi test kiểm chữ ký là
   một phép đối chiếu hai cài đặt, không phải một phép thử *"hàm kiểm là nghịch đảo của hàm ký của
   chính nó"*. ✔ đã đo.
7. **Entry point phải được CHẠY, không chỉ được biên dịch:** `cong-cu.int.test.ts` `spawn` đúng dòng
   lệnh người vận hành gõ. Bài học của khoản nợ 23 (`tools/do-webcrypto/phuc-vu-va-dot-bien.mjs` ném
   `ENOENT` ở dòng đầu vì không test nào chạy nó). ✔ đã đo — **và nó bắt được một lỗi thật ngay lượt
   chạy đầu**: `--import` với một đường dẫn Windows tuyệt đối cho ra `ERR_UNSUPPORTED_ESM_URL_SCHEME`
   vì `D:\...` bị đọc thành một URL scheme `d:`.

### 7b. Phép đo của VÒNG SỬA sau review lượt 9

8. **Đột biến nơi cất tự dựng lại:** trả `mkdir(thuMuc, { recursive: true })` vào `append` ⇒ test
   *"nơi cất bị XOÁ thì đường ghi NÉM"* ĐỎ. ✔ đã đo.
9. **Đột biến từ chối lùi:** gỡ khối `if (dau.seq < cao)` khỏi `xuat` ⇒ test int *"xuat TỪ CHỐI một
   mốc neo LÙI"* ĐỎ. ✔ đã đo.
10. **Đột biến dấu đúc, lần hai:** đổi `laNeoDaKiemChuKy` về phép đọc thuộc tính ⇒ **bốn trong năm**
    ca sao chép (spread, spread-có-sửa, `Object.assign`, `Object.create`) ĐỎ; `structuredClone` vốn
    đã fail-closed vì nó bỏ khoá symbol. ✔ đã đo.
11. **Đột biến tự kiểm cặp khoá:** gỡ khối tự kiểm khỏi `createLocalDevAnchorSigner` ⇒ test *"hai nửa
    khoá KHÔNG phải một cặp"* ĐỎ. ✔ đã đo.
12. **Đột biến chốt loại khoá:** gỡ phép kiểm `asymmetricKeyType`/`namedCurve` ⇒ ca RSA và ca Ed25519
    chuyển từ "ném" sang "đạt". ✔ đã đo.
13. **Bốn probe `g11-`** (import nội bộ, cửa subpath, import ngược, đối chứng dương cho `index.ts`).
    ✔ đã đo — **và chính chúng bắt được một lớp canh RỖNG RUỘT trong bản đầu của mình**: probe đặt ở
    một thư mục `apps/tmp-probe-*` không có `package.json` nên specifier subpath KHÔNG resolve được,
    `to.path` của `g11-` không khớp gì cả, và quy tắc im lặng. Đó đúng là lỗ **C1** mà chính
    `.dependency-cruiser.cjs` đã đặt tên từ S0, lần này hiện ra trong một PHÉP ĐO chứ không trong mã
    sản phẩm. Probe chuyển sang `packages/test-support` — gói có liên kết thật tới
    `@trustprocure/audit`.

---

### 7c. Phép đo của S1.19 — lệnh `trich` và công thức `openssl(1)`

14. **Công thức đầu-cuối:** `pnpm neo trich` sinh ba tệp, `openssl dgst -sha256 -verify` trả
    **Verified OK**. ✔ đã đo.
15. **Ba đối chứng âm**, mỗi cái khẳng định CẢ mã thoát LẪN chuỗi *"verification failure"*: sửa một
    ký tự của `chain_hash` · lật byte cuối chữ ký (kèm phép so độ dài, để phân biệt *"chữ ký sai"*
    với *"tệp không đọc được"*) · khoá công khai lạ (kèm một đối chứng **dương** đòi chính tệp khoá
    lạ ấy nạp được bằng `openssl pkey -pubin`). ✔ đã đo cả ba.
16. **Một lần dịch xuống dòng làm OpenSSL từ chối**, và nó nói đúng câu của một vụ giả mạo. ✔ đã đo
    — [review lượt 11 — H11-7] bản đầu khai điều này như một phép đo đã chạy trong khi test khi ấy
    đỏ ở một khẳng định KHÁC trước khi OpenSSL được hỏi; nay là một ca thường trực.
17. **`trich` không cần `DATABASE_URL`, cũng không cần khoá RIÊNG** — hai biến bị XOÁ hẳn khỏi môi
    trường (không đặt rỗng), kèm một vế chống rỗng ruột đòi chúng cũng không có trong môi trường
    của bộ chạy test. Đột biến: gọi `docBoKy()` ở đầu `trich` ⇒ ĐỎ. ✔ đã đo.
18. **`trich` không ghi đè** (`flag: "wx"`, `mode: 0o600`, `mkdir` `mode: 0o700`). Đột biến: bỏ
    `wx` ⇒ ĐỎ. ✔ đã đo. Nó đóng hai thứ cùng lúc — ghi đè im lặng, và **đi theo một symlink** do
    người khác đặt sẵn trong `--ra`.
19. **Hai mốc neo cùng `seq` mà khác `chain_hash` ⇒ NÉM, không chọn hộ.** Đột biến: gỡ phép kiểm ⇒
    ĐỎ. ✔ đã đo. Ca này dựng bằng `createSign` thẳng trên khoá riêng thật, nên cả hai bản ghi đều
    qua được `verifyAnchorRecord` — mâu thuẫn nằm ở chỗ khác, và đó là điều làm nó khó thấy.
20. **PEM là bản chép ĐÚNG BYTE của khoá trong vòng khoá.** Đột biến: đổi `pemTuSpkiDer` sang
    `createPublicKey(...).export({format:"pem"})` ⇒ ĐỎ. ✔ đã đo — **nhưng chỉ sau lần viết thứ
    hai**: bản đầu của mốc chết này SỐNG SÓT đột biến, vì với một SPKI hợp lệ hai đường cho ra cùng
    một chuỗi base64. Nó chỉ đỏ khi chạy trên đúng đầu vào làm hai đường khác nhau — một SPKI 91
    byte cộng một byte rác, thứ mà cả `createPublicKey` lẫn `openssl pkey` đều NHẬN.
21. **Dòng lệnh ĐƯỢC TÀI LIỆU HOÁ chạy được:** một ca `spawn` đúng `pnpm neo trich --org … --ra …`,
    đi qua script workspace thật thay vì gọi `node … src/index.ts`. ✔ đã đo — bài học khoản nợ 23.

**MỘT VẾ CỦA VÒNG SỬA KHÔNG CÓ MỐC CHẾT, và nó phải được đọc như thế:** phép kiểm lại chữ ký trên
ĐÚNG đối tượng sắp ghi ra đĩa ([review lượt 11 — H11-1], đóng ca *"byte đi ra đến từ lượt đọc thứ
hai chưa qua kiểm"*). Đột biến đã chạy — gỡ nó — và **cả 16 test vẫn XANH**, vì dựng một lượt chạy
mà nơi cất đổi GIỮA hai lượt đọc đòi một móc tiêm vào `readAllRaw` mà đường CLI không có. Vế ấy
được giữ vì lập luận, không vì một phép đo.

**PHẠM VI CHẠY:** toàn bộ khối này là `*.int.test.ts`, nên trong CI nó chỉ chạy ở job **T3
(`ubuntu-latest`)** — `t1`/`t2` chạy trên cả Windows nhưng loại trừ int test. Tức mối lo CRLF, vốn
là mối lo của Windows với `core.autocrlf=true`, **không bao giờ được đo trên Windows trong CI**.
Nói ra vì nó là một khoảng chênh thật giữa thứ được bảo vệ và thứ được đo.

---

## ADR-027 — Biên giới module và bề mặt export là một TÍNH CHẤT, không phải một danh sách: vị từ *gói* là `package.json`, tập cửa là `exports`, và mọi danh sách miễn trừ phải RỖNG

**Ngày:** 2026-09-07 · **Trạng thái:** Đã chấp nhận · **Vòng:** S1.18 · **Đóng:** khoản nợ 9 và 17

### 0. Câu hỏi, và vì sao nó không phải một việc dọn dẹp

Bốn gói của S0 — `audit`, `db`, `tenancy`, `test-support` — chưa bao giờ có họ quy tắc biên giới
(`packages/<ten>/src/` là vùng hạn chế, `index.ts` là cửa) và chưa bao giờ có danh sách trắng barrel.
Đó không phải một sự thiếu ngăn nắp: **hai trong bốn là hai mặt tiền chịu lực nhất kho.**
`tenancy/src/with-tenant.ts` là điểm DUY NHẤT gắn GUC `app.org_id` — mọi policy RLS của `002`–`007`
đọc GUC đó — và `audit/src/writer.ts` là đường ghi sổ kiểm toán.

Điều làm câu hỏi này đáng một ADR không phải bốn họ quy tắc, mà là **thứ được phát hiện khi đóng
chúng**: cả hai lớp canh *"suy từ tính chất"* của kho đều đang suy từ một tính chất **sai miền**, và
một cổng của kho đã **rỗng ruột từ S0** mà chín lượt review không bắt được.

### 1. Bốn quyết định

**⑴ Vị từ *"gói"* là *thư mục con của `packages/` có `package.json`*, không phải *có `src/index.ts`*.**
Bản đầu của [INV-H16] (S1.2) và [INV-H18] (vòng này) dùng vế thứ hai. Nó nghe như một tính chất
nhưng là một **quy ước đặt tên**, và nó để lọt một lỗ đầy đủ: `packages/kms/package.json` khai
`"exports": { ".": "./src/main.ts" }` mà không có `src/index.ts` thì gói ấy rơi khỏi **cả hai** lớp,
không lớp nào kêu, và **hai khẳng định *"danh sách miễn RỖNG"* vẫn xanh** — vì miễn trừ đúng là rỗng
thật. Vị từ đúng nằm ở `tests/architecture/goi-workspace.ts` và **dùng chung** cho cả hai bất biến:
hai bản chép gần giống nhau của cùng một vị từ là thứ sẽ trôi khỏi nhau.

**⑵ Tập cửa hợp lệ của một gói ĐỌC TỪ `exports` của chính nó, không từ một trần đếm.**
`coQuyTacBienGioi` từng đòi `to.pathNot` *chứa* `index.ts` và có `length <= 2` — một con số dùng
chung, đặt ở 2 để không đỏ oan trên `crypto-keys`. Hai gói tiêu thụ nó hợp pháp; **mười một gói còn
lại được cấp không một cửa thứ hai**, mở được bằng một dòng trong file cấu hình mà không lớp nào
phản đối. Nay so **bằng tập**, nên mở một cửa thứ hai buộc phải là một dòng trong `package.json` —
thứ [INV-H18] cũng nhìn thấy. Hệ quả: hai lớp cùng nhìn một nguồn sự thật.

**⑶ `main` phải trỏ cùng tệp với `exports["."]`.** Mọi khẳng định của [INV-H18] đọc `exports`, nhưng
`vitest.config.ts` alias `@trustprocure` → `packages` và Node đọc `main` khi không đi qua `exports`.
Không có ràng buộc này, **bề mặt được ĐO và bề mặt được CHẠY tách nhau trong im lặng**.

**⑷ Mọi danh sách miễn trừ của hai lớp này phải RỖNG.** `MIEN_TRU` ([INV-H16]) và
`GOI_MIEN_DANH_SACH_TRANG` ([INV-H18]) đều có một khẳng định *"rỗng"* riêng. Viết thêm một dòng vẫn
ĐƯỢC — nhưng nó làm khẳng định ấy đỏ, tức là **mở lại khoản nợ 9 hoặc 17** và phải được ghi ra ở
`docs/STATE.md`, không lặng lẽ thành một dòng trong một map. Cùng cơ chế ADR-025 đặt cho
`HAM_TRIGGER_KHONG_GHIM`.

### 2. Vì sao RỖNG chứ không NGẮN — và `test-support` là ca chứng minh

Bản cũ của `MIEN_TRU` có bốn dòng, ba dòng mang lý do *"khoản nợ 17 — chưa đóng"* (hết hạn khi nợ
đóng) và **một dòng mang lý do *"hạ tầng kiểm thử, không phải mã sản phẩm"***. Lý do thứ tư đúng về
bản chất và **không bao giờ hết hạn** — nên nếu chấp nhận nó, danh sách sẽ dừng ở một dòng và ở đó
mãi mãi. Một danh sách loại trừ không bao giờ rỗng được thì không phải một khoản nợ; nó là một lỗ
vĩnh viễn có giấy phép. `test-support` vì thế nhận biên giới như ba gói kia. Vế *"không được vào
`dependencies` sản xuất"* vẫn do `pham-vi-san-xuat.test.ts` (khoản nợ 21) giữ — hai lớp đo hai thứ
khác nhau: lớp kia canh gói này không bị PHÁT vào đường sản xuất, lớp này canh không ai với vào RUỘT
nó.

### 3. `audit` có HAI cửa, và hai lớp chia việc chứ không thay nhau

`packages/audit/package.json` khai `"./anchor-sign"` (ADR-026 §4 — bộ ký mốc neo cố ý không nằm ở
`index.ts` vì tiến trình `api` import gói này ở mọi đường ghi). Một `g12-` chỉ khai MỘT cửa sẽ chặn
chính `tools/neo-so-kiem-toan`: nó **phá build chứ không đóng lỗ nào** — và đó là ca hỏng dễ xảy ra
nhất khi chép khuôn `g5-`/`g6-` sang một gói có subpath export. Phân vai:

| Lớp | Câu nó trả lời |
|---|---|
| `g12-` | *Không ai đi vòng QUA tường* — mọi tệp trong `src/` trừ hai cửa |
| `g11-` | *Chỉ công cụ xuất neo được đi qua cửa thứ hai* — ai |
| Danh sách trắng `./anchor-sign` | *Cái gì đi ra qua cửa thứ hai* — ba năng lực ký, không hơn |

Đúng tiền lệ `crypto-keys` (`index.ts` + `unwrap.ts`). Vòng này phát hiện **cùng hình dạng ấy đang
hở ở một chỗ khác**: `sealed-envelope` khai hai cửa từ S1.4, và cửa `./unseal` — xuất `unsealBid`,
hàm mở phong bì giá thầu — chưa bao giờ có danh sách trắng. `g8-` canh AI, không ai canh CÁI GÌ.
**Cả hai lần, thứ mở một cửa công khai mới là MỘT DÒNG trong `package.json`** — thứ không quy tắc
depcruise nào phản đối, vì cạnh tới tệp sau cửa mới là hợp pháp với chính cửa đó.

### 4. Một cổng đã rỗng ruột từ S0 — và vì sao nó sống lâu đến thế

`khong-phu-thuoc-devdep-trong-src` **không bao giờ bắn được**: `options.exclude` chứa `node_modules`,
mà `exclude` gỡ hẳn module khỏi đồ thị (khác `doNotFollow`, chỉ ngừng duyệt tiếp), trong khi
`npm-dev` chỉ được gán cho cạnh resolve **vào** node_modules. Đếm trên toàn đồ thị trước khi sửa:
264 `import`, 231 `local`, 94 `aliased`, 83 `core`, 44 `export`, 40 `unknown`, 14 `type-only`,
6 `dynamic-import` — **không một cạnh nào mang `npm-dev`**.

Nó sống qua chín lượt review và mọi lượt CI vì thứ duy nhất ai cũng nhìn là dòng *"no dependency
violations found"*. **Một quy tắc xanh trông giống hệt một quy tắc đang làm việc.** Lớp bắt được nó
không phải một con mắt tinh hơn mà là **một câu hỏi khác**: không phải *"có vi phạm không"* mà
*"quy tắc này có ĐỐI TƯỢNG nào để phán xét không"* — và câu hỏi ấy nay là một test đọc đồ thị JSON.

Miễn trừ duy nhất sau khi sửa là `packages/test-support/src/`, và nó **không phải một tên trong một
danh sách**: tính chất *"gói này là hạ tầng kiểm thử"* do `pham-vi-san-xuat.test.ts` vế ⑵ cưỡng chế.
Đường sửa *"chuyển `pg`/`@testcontainers` sang `dependencies` của gói ấy"* đã được xét và **bác bỏ**
— nó tái lập đúng khiếm khuyết mà khoản nợ 21 ra đời để chặn, và vế ⑴ của lớp kia sẽ đỏ.

### 5. Cái vòng này KHÔNG đóng

⑴ **Hai lớp khoá DANH SÁCH, không khoá HÌNH DẠNG.** Một hàm mới được thêm vào danh sách trắng kèm
một dòng lý do vẫn đi lọt; lớp cuối là người đọc (`.github/CODEOWNERS`) — và `CODEOWNERS` vẫn trỏ
tới một team **chưa tồn tại** (khoản nợ 18).

⑵ **`g14-` và `g15-` không rút một symbol nào khỏi tầm với hôm nay.** Đếm được: `g12-` rút một
(`antoanChoBaoCao`), `g13-` rút một (`migrationChecksum`), hai họ còn lại rút **không** — mọi symbol
giá trị của chúng đã ở cửa. Thứ chúng mua là **mặc định đóng cho module tương lai**. Đọc rộng hơn
thế là nói quá.

⑶ **Vector subpath không phải thứ bốn họ mới đóng.** `db`/`tenancy`/`test-support` khai `exports`
chỉ có `"."`, nên `@trustprocure/db/src/pool.js` chưa bao giờ resolve được; thứ bắn cho nó là lưới
đỡ `g1-khong-import-trustprocure-khong-resolve-duoc`. Trên vector ấy, bốn họ mới cộng thêm **0**.

⑷ **[INV-H18] tạo ra một ngoại lệ cho doctrine *"một tiến trình, một khả năng"***: khẳng định *"khớp
bề mặt THẬT"* nạp cả ba cửa hạn chế trong cùng một worker vitest, và dynamic import với specifier
dựng từ biến làm depcruise **về nguyên lý** không thấy cạnh đó. Việc *"không module nào làm gì lúc
nạp"* được **kiểm bằng cách ĐỌC**, chưa phải một phép đo lúc chạy.

### 6. Đo bằng gì

1. **8 probe ĐỎ THẬT trước khi có quy tắc** — `depcruise` trả về 0 trên một import thẳng vào
   `with-tenant.ts` từ một gói khác. ✔ đã đo.
2. **Ba cổng trên cùng một probe:** `tsc` exit 0, `eslint` exit 0, `depcruise` exit 1. ✔ đã đo.
3. **`g12-` khai MỘT cửa ⇒ `tools/neo-so-kiem-toan` THẬT vi phạm.** ✔ đã đo — probe thứ tư của
   `audit` đọc thẳng trên công cụ thật, kèm đối chứng đòi cạnh ấy tồn tại.
4. **Hạ `g14-` xuống `severity: "info"` ⇒ hai probe tenancy ĐỎ, đối chứng dương còn XANH.** ✔ đã đo.
5. **Ba đột biến danh sách trắng:** symbol lạ mọc ra · symbol biến mất khỏi cửa · một cửa subpath
   thứ ba trong `package.json`. ✔ đã đo cả ba.
6. **Bốn đột biến [INV-H18]:** gói thứ mười bốn không có mục · một cửa không được canh · một mục trỏ
   tới mảng RỖNG · một dòng thêm vào danh sách miễn. ✔ đã đo cả bốn.
7. **Hai đột biến của vị từ (H10-1):** `packages/kms` khai `exports` trỏ `src/main.ts` ⇒ **H16 và
   H18 cùng ĐỎ**; một thư mục con không có `package.json` ⇒ khẳng định mới ĐỎ. ✔ đã đo.
8. **Đột biến tập cửa (H10-2):** mở cửa thứ hai cho `g14-` mà không động vào `package.json` ⇒ ĐỎ.
   ✔ đã đo.
9. **Đột biến `main` (H10-3):** `main` trỏ một tệp khác `exports["."]` ⇒ ĐỎ. ✔ đã đo.
10. **Hai đột biến của cổng devDependency:** trả `node_modules` về `exclude` ⇒ test chống-rỗng-ruột
    ĐỎ **trong khi `pnpm depcruise` vẫn XANH**; gỡ miễn trừ `test-support` ⇒ 2 vi phạm THẬT.
    ✔ đã đo.

---

## ADR-028 — Ranh giới TỰ CHỮA / PHÁN XÉT của `hardening.always.sql`: chủ thể suy từ TÍNH CHẤT, tự chữa chỉ thứ ĐƠN ĐIỆU

> **[S1.21] Tiêu đề trên đã được sửa; nguyên văn cũ:** *"…, tự chữa chỉ thứ có TÊN"*.
> Vế ấy là đúng câu mà §2⑵ của chính ADR này đã GẠCH ở vòng sửa sau review lượt 12 — cùng
> tệp, cách hai mươi hai dòng, cùng ngày. Một lời đính chính nằm trong THÂN mà không chạm
> tới TIÊU ĐỀ thì cái đọc được từ mục lục vẫn là câu đã bị bác bỏ.

**Ngày:** 2026-09-07 · **Trạng thái:** **Đã chấp nhận** · Đóng: **khoản nợ 16**, và **bác bỏ nửa
đầu khoản nợ 3** · Liên quan: **B1**, **B2**, **B3**, **F1**, **H19**, ADR-027

### 1. Vì sao ADR này tồn tại

`hardening.always.sql` chạy **mọi lần `migrate()`**, kể cả trên production đã có dữ liệu. Nó là
file duy nhất trong kho có quyền **tự tay sửa lược đồ**. Quy tắc chi phối quyền ấy — S0 gọi là
`[CR4]` — đã tồn tại từ Task 6 và đã được đo bằng ba chế độ hỏng thật, nhưng nó **chỉ sống trong
một khối chú thích**. Không có ADR nào cho nó, nên mỗi vòng mở rộng vùng canh lại phải suy lại từ
đầu, và S1.20 suýt vi phạm nó ở bước thứ hai (xem §5⑵).

ADR-027 vừa phát biểu *"biên giới là một TÍNH CHẤT, không phải một danh sách"* cho tầng module.
ADR này phát biểu **hai vế** của cùng nguyên tắc cho tầng CSDL, và vế thứ hai mới là vế mới.

### 2. Quyết định

⑴ **Chủ thể của một mục hardening được SUY TỪ TÍNH CHẤT.** Một danh sách tên chỉ được giữ khi có
   một lý do **đo được** viết ngay tại chỗ nói vì sao tính chất tương ứng không tồn tại hoặc suy
   sai. *"Chưa ai đổi"* và *"hiện tại chỉ có hai bảng"* không phải lý do.

⑵ ~~**`migrate()` chỉ TỰ CHỮA những đối tượng mà một migration đánh số sở hữu theo TÊN. Thứ nó
   SUY RA thì chỉ PHÁN XÉT** — báo lỗi kèm hướng dẫn sửa, không tự sửa.~~

   **[review lượt 12, M3] CÂU VỪA GẠCH RỘNG HƠN PHÉP ĐO CỦA CHÍNH VÒNG NÀY, và nó sai theo hướng
   dễ chịu — nó khen mã nhiều hơn mã đáng được khen.** §7⑷ dưới đây đo rằng `migrate()` bật
   ENABLE + FORCE RLS trên `chi_nhanh`, một bảng **không migration đánh số nào sở hữu theo tên**.
   Nó không phải khiếm khuyết của vòng này: **mục (A) đã tự chữa trên một tập SUY RA từ S0** —
   *"bảng có cột `org_id`"* là một tính chất, không phải một danh sách. Câu ⑵ như đã viết mô tả sai
   cả mã cũ lẫn mã mới.

   **Phát biểu đúng:** `migrate()` được TỰ CHỮA trên một tập suy ra **khi và chỉ khi** hành động là
   ĐƠN ĐIỆU và FAIL-CLOSED — nó chỉ BẬT một lớp bảo vệ, không đổi ngữ nghĩa của bảng và không cho
   bên ghi làm được thêm bất cứ điều gì. `ENABLE ROW LEVEL SECURITY`, `FORCE`, `SET LOGGED`,
   `REVOKE` là đơn điệu. **Không đơn điệu, và vì thế bị cấm trên tập suy ra:** cắm/gỡ trigger, đổi
   thân hàm, `DROP COLUMN`, `ADD CONSTRAINT` — mỗi thứ đều đổi được hành vi của một đường ghi HỢP
   LỆ, và cả ba chế độ hỏng ở §3 đều thuộc lớp ấy.

   **Hệ quả phải nói ra, vì nó không hiển nhiên:** lượt `sua` COMMIT riêng, TRƯỚC lượt `phan_xet`
   (`packages/db/src/migrate.ts`). Nên một bảng gốc tenant mới, sai hình dạng policy, để lại một
   **trạng thái lai**: cờ RLS đã bật (mọi đọc trả 0 hàng — fail-closed, đúng chiều) VÀ deploy bị
   chặn ở lượt phán xét. Đó là cái giá của tính đơn điệu, và nó rẻ hơn chiều ngược lại.

⑶ **Vế nào không tổng quát hoá được thì GIỮ theo tên VÀ phải mang chú thích nói vì sao.** Một bất
   đối xứng có lý do đọc được là một quyết định; một bất đối xứng trần là một khoản nợ.

⑷ **Một mục canh mà không đột biến nào làm nó ĐỎ được thì KHÔNG ĐƯỢC THÊM.** Nếu phép đo cho thấy
   cửa đã đóng bởi một lớp khác, thứ đúng để làm là **ghi lại phép đo** và đặt lớp canh ở chỗ cái
   trôi thật sự nhìn thấy được — thường là một test — chứ không thêm một mục vĩnh viễn vào file
   nguy hiểm nhất kho mã.

### 3. Vì sao ⑵ là vế nặng nhất

Chế độ hỏng của hardening **không đối xứng**. Một mục quá LỎNG để lọt một lỗ; một mục quá CHẶT
**chặn deploy trên một lược đồ hợp lệ** — và vì hardening chạy TRƯỚC vòng migration đánh số, đường
vá bằng một migration mới **không tới được**. Chỉ còn sửa tay trên cụm. Đó là ngõ cụt `QT1`.

**[S1.57 / khoản nợ 100] Một ngoại lệ có chủ đích, và điều kiện để nó đứng được.** Lượt `truoc_vong` của hardening chặn
deploy TRƯỚC vòng đánh số — chủ thể "vai chạy migration" của mục 94 (`CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI`), chỉ khi còn tệp
chưa áp — vì phán xét sau vòng chỉ BÁO MẤT chứ không NGĂN MẤT: backfill 0 hàng của chính lượt đã ghi checksum. Ngoại lệ chỉ
đứng được khi nó không lấy mất lối ra nào: dòng mà một migration chạy dưới chính vai ấy sửa được (`tu_sua_duoc` — thừa kế hay
tự lấy được quyền chủ bảng, tự thu hồi được membership trên đường tới quyền; đo bốn đường trên PostgreSQL 16) KHÔNG bị chặn
trước, và chủ thể chủ bảng cũng không. Lượt soi 50 NẶNG-1 bác bản đầu vì chặn cả chúng. Mọi dòng còn lại chỉ có lối ra ngoài
tầm vai ấy, tức đường vá bằng migration vốn không tồn tại để mà bị chặn.
**[S1.58 / khoản nợ 101]** Cùng điều kiện cho dòng mà policy phụ thuộc hàm ngữ cảnh lọc hết vì vai có EXECUTE trên hàm ấy: `tu_sua_duoc`
chỉ tính ba đường tự cắt EXECUTE — thừa kế chủ hàm, ADMIN trên một vai thừa kế chủ hàm, membership nhóm do chính vai ấy cấp, đo từng
đường trên PostgreSQL 16 — hay cắt đường tới quyền trên bảng; hai vế quyền chủ bảng không tính, vì lối vá của chúng (thêm policy) không
qua được cổng của kho mà không có dòng ngoại lệ đọc xuyên tổ chức (lượt soi 51 NẶNG-1). EXECUTE do superuser cấp thẳng thì vai ấy tự thu
hồi là no-op, nên dòng ấy bị chặn trước vòng với lối ra theo đường — và đường qua nhóm KHÔNG được khuyên thu hồi khỏi nhóm (lượt soi 51
NẶNG-2, đo: vai deploy là thành viên app_api).

S0 đã đo ba chế độ hỏng của việc tự chữa trên bảng SUY RA, và cả ba đều im lặng:

- tạo một bảng trùng tên khác hình dạng ⇒ hardening tự cắm trigger nối chuỗi ⇒ mọi `INSERT` ném
  `record "new" has no field "org_id"` **vĩnh viễn**;
- một bảng qua được mọi phép kiểm ⇒ `migrate()` **THÀNH CÔNG, không lỗi không warning** ⇒ `INSERT`
  ném ở cột thứ bảy;
- `bao_gia` chỉ muốn chặn DELETE ⇒ hardening tự thêm `bao_gia_chan_update` ⇒ `UPDATE` bị từ chối;
  `DROP TRIGGER` rồi `migrate()` thì nó **quay lại**.

### 4. Hệ quả: bốn lỗ đo được, và lỗ nặng nhất không nằm trong sổ nợ

Khoản nợ 16 dự báo *"bảng báo giá S1 sẽ rơi thẳng vào đó"*. Dự báo đúng: S1 dựng hàm canh
chỉ-ghi-thêm **thứ hai** (`bid_chi_ghi_them()`, 018) cắm trên **ba** bảng, cả ba nằm ngoài cả
`bang_so` (danh sách hai tên) lẫn `bang_al` (khoá theo OID của `chan_sua_xoa`).

| # | Lỗ | Đo được |
|---|---|---|
| ⑴ | Bảng chỉ-ghi-thêm của S1 **UNLOGGED được** | `ALTER TABLE bid_receipts SET UNLOGGED` → `MIGRATE OK`, `relpersistence` còn `'u'` |
| ⑵ | ACL của chúng **không bị canh** | `GRANT UPDATE, DELETE ON bid_receipts TO app_api` → `MIGRATE OK`, acl còn `app_api=rwd` |
| ⑶ | **`TRUNCATE` đi qua** — lỗ mà sổ nợ 16 KHÔNG nêu | `TRUNCATE public.bid_receipts` → **OK**; `TRUNCATE public.audit_events` → NÉM |
| ⑷ | Bảng sổ nhận **cột ngoài chuỗi hash** | `ALTER TABLE audit_events ADD COLUMN payload_plaintext text` → `MIGRATE OK`, `applied=[]` |

**⑶ nặng nhất, và nó nặng vì lý do cấu trúc chứ không vì sơ suất:** ba trigger của 018/019 là
`BEFORE DELETE OR UPDATE FOR EACH ROW`, và **một trigger cấp HÀNG không bao giờ chạy cho
`TRUNCATE`** — TRUNCATE là thao tác cấp CÂU LỆNH. Bảng sổ có một trigger TRUNCATE riêng từ 003 vì
đúng lý do ấy; ba bảng của S1 ra đời sau và không ai chép vế thứ ba sang. Một câu lệnh xoá sạch
mọi biên nhận nộp thầu (**B2**), mọi phiên bản báo giá (**B1**) và mọi giá đã mở — trong khi ma
trận ghi cả hai mã ✅ với 10 và 25 khẳng định. Đóng bằng migration `047`.

**⑷ là hai câu hỏi bị nhập làm một.** `MAU_HINH_DANG_SO` đếm `attname IN (15 tên) = 15` và chú
thích của chính nó viết *"THÊM cột thì an toàn"*. Câu ấy **đúng** cho câu hỏi mà vị từ ấy trả lời
(*"thân trigger dereference đủ 15 trường chứ?"*). Câu hỏi thứ hai — *"sổ có chứa gì mà chuỗi hash
không phủ không?"* — chưa từng có ai hỏi. Một cột thứ 16 là nội dung sống TRONG sổ kiểm toán mà
sửa nó **không làm chuỗi gãy**; B3 nói về HÀNG, nên mệnh đề ấy không với tới. Và cái tên
`payload_plaintext` không phải ví dụ ngẫu nhiên — nó là đúng hình dạng của **A2**.

### 5. Ba thứ phải ghi ra vì chúng là quyết định, không phải chi tiết

⑴ **`UNIQUE (org_id, seq)` KHÔNG tổng quát hoá.** Nó gắn với CHUỖI HASH chứ không với tính
chỉ-ghi-thêm: `bid_receipts` không có cột `seq`, và một RFQ có nhiều báo giá song song nên không có
thứ tự toàn cục nào để đánh số. Ràng buộc ấy VẪN chỉ áp cho hai bảng sổ — nay kèm lý do, đúng thứ
khoản nợ 16 đòi khi nó viết *"bất đối xứng này không có một chú thích nào giải thích"*.

⑵ **Cách sửa hiển nhiên cho ⑶ là một cái bẫy, và nó suýt được chọn.** Dùng `chan_sua_xoa()` cho ba
trigger TRUNCATE mới là lựa chọn đầu tiên: hàm ấy có sẵn thông điệp theo `TG_OP` và đã được ghim.
Nhưng vế "bảng lạ" của `bang_al` nhận bảng theo **OID của `chan_sua_xoa`** — cắm nó lên ba bảng
này đưa chúng vào `can_co`, nơi hardening đòi đủ bộ ba `<bảng>_chan_update/_chan_delete/
_chan_truncate`. Ba tên ấy không tồn tại (tên thật là `_chi_ghi_them`), nên `migrate()` sẽ **BÁO
LỖI trên một lược đồ HỢP LỆ**. `047` vì thế định nghĩa lại thân `bid_chi_ghi_them()` (thông điệp
đọc `TG_OP`) thay vì mượn hàm kia — đắt hơn một mục ghim, rẻ hơn một lần chặn deploy.

⑶ **Nửa đầu khoản nợ 3 bị PHÉP ĐO BÁC BỎ, và mục đã viết cho nó đã bị GỠ.** Khoản nợ viết
*"`NOBYPASSRLS` chỉ ghim đúng BỐN TÊN ROLE"*. Vòng này dựng một mục thứ năm suy từ tính chất, chạy
nó, rồi đo:

```text
cây role của dự án TRƯỚC          : {app_api, app_unseal}
CREATE ROLE ke_gian BYPASSRLS NOLOGIN; GRANT app_api TO ke_gian;
cây role SAU GRANT                : {app_api, app_unseal, ke_gian(bypassrls)}
migrate()                         : OK
cây role SAU migrate()            : {app_api, app_unseal}      <- ke_gian ĐÃ RỜI CÂY
```

**BƯỚC 1 thu hồi mọi tư cách thành viên LẠ**, nên tập *"role trong cây dự án"* LUÔN BẰNG tập bốn
tên đã ghim. Cửa mà khoản nợ mô tả có thật và **đã đóng — bởi một lớp KHÁC với lớp mà khoản nợ chỉ
tên**. Mục mới không tạo ra được một lượt ĐỎ nào, nên theo §2⑷ nó bị gỡ; thứ CÓ THỂ trôi (danh
sách trắng nở ra role thứ năm) được canh ở `db/hardening-suy-tu-tinh-chat.int.test.ts` bằng khẳng
định *"cây role BẰNG tập tên được ghim"*.

Đây là lần thứ hai một khoản nợ đóng bằng cách bác bỏ tiền đề của chính nó (lần đầu: khoản 58,
S1.16), và lần thứ ba một phép đo bác bỏ lý do đã được viết ra của một hàng rào (S1.18).

### 6. Cái này KHÔNG đóng

- ~~**Tập hàm canh chỉ-ghi-thêm vẫn suy từ HÌNH DẠNG THÂN HÀM** (`prosrc` không có `RETURN`), tức một
  phép so khớp văn bản.~~ **[S1.29] Nay là HÌNH DẠNG ∪ KHAI BÁO** — `HAM_CANH_CHI_GHI_THEM` kê tên,
  khớp nguyên văn `hardening.always.sql`, và một tổng điều tra buộc mọi hàm trigger BEFORE-ROW
  UPDATE/DELETE phải được phân loại (ADR-035, khoản nợ 60 đóng; phần chưa đóng là 73 và 74). Vế
  hình dạng vẫn chặt hơn một danh sách tên và vẫn có phản ví dụ thật giữ cho nó không lỏng
  (`rfq_items_chan_truncate` — cùng hình dạng thân, nhưng là trigger TRUNCATE cấp câu lệnh, nên vế
  *"cả UPDATE lẫn DELETE, cấp HÀNG"* loại nó ra). Nó **không** là một tính chất ngữ nghĩa.
- **Không đóng phần còn lại của khoản nợ 3** — vế *"một hàm plpgsql ngoài danh sách không được
  ghim"* đã đóng từ **S1.14/S1.15** (nợ 54 và 56), và sổ nợ 3 THIU ở nửa ấy suốt bốn vòng.
- **`047` chỉ thêm chốt TRUNCATE cho ba bảng ĐANG CÓ.** Một bảng chỉ-ghi-thêm thứ tư ra đời mà
  không có chốt TRUNCATE sẽ được **báo ra**, không được vá hộ — đúng §2⑵.
- **[review lượt 12, H1] MỘT BẢNG CHỈ-GHI-THÊM PHÂN MẢNH TỐN MỘT CHỐT CHO MỖI PHÂN MẢNH.** Reviewer
  nêu ca này như một khả năng *chặn deploy trên lược đồ hợp lệ*. Phép đo bác bỏ vế *"hợp lệ"*: trigger
  cấp HÀNG **được** nhân bản xuống lá (nên lá vào tập suy ra), trigger TRUNCATE **không** được nhân
  bản, và `TRUNCATE <lá>` **đi lọt** dù cha có chốt. Lá là một LỖ THẬT, nên đòi chốt trên từng lá là
  ĐÚNG chứ không quá chặt. **Cái giá là có thật và không được giấu:** một phân mảnh mới tạo ngoài
  vòng migration (việc bảo trì định kỳ, thường tự động) sẽ **chặn deploy** cho tới khi nó có chốt —
  và thông điệp của mục canh nói thẳng điều đó. Ca này **chưa tồn tại** hôm nay (không bảng
  chỉ-ghi-thêm nào phân mảnh), nên đây là một cái giá đã ĐO chứ chưa phải một cái giá đang trả.
- **[review lượt 12, L5] MỘT `GRANT` CỦA KẺ CÓ ĐẶC QUYỀN LÀ MỘT DoS DEPLOY KHÔNG TỰ GỠ.** Mục ACL
  của tập SUY RA chỉ phán xét (đúng §2⑵ đã sửa: `REVOKE` là đơn điệu, nhưng nó đi kèm `CASCADE` nên
  bán kính của nó không đơn điệu — xem `[I2]`), trong khi mục tương đương của `bang_so` tự thu hồi.
  Hệ quả: một `GRANT UPDATE ON bid_receipts TO …` chặn MỌI deploy sau đó, kể cả bản vá khẩn, cho tới
  khi có người vào cụm gõ `REVOKE`. Đây là đánh đổi CỐ Ý — chiều còn lại là `migrate()` tự thu hồi
  quyền trên một bảng nó chỉ suy ra — nhưng nó thuộc về danh sách này chứ không nên nằm im.

### 7. Đo bằng gì

**[S1.49 / khoản 93] Bảy mục canh sổ kiểm toán, gọi đúng tên loại của chúng theo §2 — lượt soi 41 NẶNG-2 bác bản đầu vì nó gọi cả bảy là "phán xét" rồi lại khai `REVOKE` là *không* đơn điệu, ngược chính §2⑵ và ngược mã:** BỐN mục PHÁN XÉT (câu sửa no-op) — `CAU_CHI_GHI_THEM_QUYEN` và `CAU_CHI_GHI_THEM_VAT_LY` (quyền GHI và trạng thái vật lý của bảng chỉ-ghi-thêm SUY TỪ TÍNH CHẤT, không ghim tên bảng), `CAU_HINH_DANG_CHINH_TAC` và `CAU_COT_NGOAI_CHUOI` (hình dạng cột của bảng sổ chính tắc: một cột thêm vào sổ là một chỗ dữ liệu đi ra ngoài chuỗi hash, và một cột bị đổi tên làm `audit_events` rớt khỏi tập `can_co` ⇒ lớp C mất khả năng tự chữa trigger nối chuỗi, trong im lặng). BA mục TỰ CHỮA rồi mới phán xét ở hậu điều kiện — `CAU_TRIGGER_CHAN_SAI` (dựng lại bốn trigger chặn: ĐƠN ĐIỆU), `CAU_BANG_SO_VAT_LY` (`SET LOGGED` + thêm `UNIQUE (org_id, seq)`: đơn điệu), `CAU_QUYEN_BANG_SO_MO_TA` (`REVOKE … CASCADE`: đơn điệu — §2⑵ đã xếp `REVOKE` vào nhóm tự chữa được, và lượt sửa chạy đúng thế). Cùng nhóm, mục *không có overload lạ của bốn hàm chuỗi kiểm toán* (`audit_compute_hash`, `noi_chuoi_kiem_toan`, `audit_append`, `chot_moc_neo` — đúng BỐN, không hơn) viết THẲNG SQL ở hậu điều kiện thay vì qua một hằng, nên khoá tra cứu của nó là chính TÊN MỤC: một overload cùng tên khác chữ ký là một hàm thứ năm mà một lời gọi không đủ điều kiện có thể rơi vào. Hai phán xét sống NGOÀI mảng `bang` — BƯỚC 3 chạy `CAU_MEMBERSHIP_LA` (tư cách thành viên LẠ của `app_api`/`app_unseal`: BƯỚC 1 gỡ được thì tự chữa, gỡ không được thì chặn) và `CAU_ADMIN_LA` (quyền ADMIN OPTION lạ trên hai vai ấy) thẳng vào `loi_gom` trước vòng lặp — cùng hạng phán xét, chỉ khác chỗ đứng (lượt soi 41 CAO-2). Cổng `tests/architecture/hardening-co-ly-do.test.ts` ([INV-H19]) đòi mọi phán xét của hardening — nhận diện theo TÍNH CHẤT *ô câu sửa là no-op*, không theo tên hằng — có một khoá tra cứu trong ADR-028, ADR-036 hay ADR-037, và không nằm trong vùng đã gạch.

1. **Bảy khẳng định ĐỎ THẬT trước khi sửa** — cả bảy chạy trên cây mã `f768d3f`. ✔ đã đo.
2. **`TRUNCATE` trên ba bảng S1 trả về OK trước `047`, NÉM sau `047`.** ✔ đã đo.
3. **Hai kết quả ĐÚNG KHÁC NHAU cho cùng một đột biến `SET UNLOGGED`:** bảng có TÊN ⇒ `migrate()`
   OK và bảng về LOGGED (tự chữa); bảng SUY RA ⇒ `migrate()` NÉM (phán xét). Đây là phép đo của
   chính §2⑵. ✔ đã đo.
4. **Đối chứng dương của vị từ tenant:** một bảng gốc tenant THỨ HAI kèm policy đúng
   `HINH_DANG_CHUAN` ⇒ RLS + FORCE được bật trên CẢ HAI bảng **và `migrate()` vẫn THÀNH CÔNG**.
   Không có vế thứ hai này thì một vị từ quá rộng sẽ đi qua mà không ai thấy. ✔ đã đo.
5. **Phản ví dụ giữ vị từ không lỏng:** `rfq_items` KHÔNG được lọt vào tập chỉ-ghi-thêm. ✔ đã đo.
6. **Đột biến `ADD COLUMN payload_plaintext`** ⇒ `migrate()` NÉM kèm tên cột. ✔ đã đo.
7. **Bác bỏ nửa đầu nợ 3:** `ke_gian` rời cây sau `migrate()`. ✔ đã đo (§5⑶).
8. **Một khiếm khuyết của chính vòng này, tìm ra bằng cách chạy:** bí danh `r` trong một câu SQL
   nhúng bị plpgsql thay bằng biến vòng lặp **trước khi** SQL phân giải bí danh — vị từ trả về TẬP
   RỖNG và mục canh **luôn XANH**. `[IM2]` đã ghi nguyên văn cảnh báo này ở vòng fix 1 của S0, và
   vòng này vẫn vấp. Ca của `[IM2]` ném 55000 (ồn ào); ca này im lặng. ✔ đã đo.
9. **[vòng sửa sau review lượt 12] `GRANT UPDATE (canonical_text) ON bid_receipts`** ⇒ `migrate()`
   NÉM kèm tên cột. Trước vòng sửa: `MIGRATE OK` — quyền mức CỘT vô hình với `relacl`. ✔ đã đo.
10. **[vòng sửa] `DISABLE TRIGGER` trên chốt TRUNCATE** cho hai kết quả ĐÚNG KHÁC NHAU: trên
    `bid_receipts` (có TÊN trong mục ghim `047`) hardening **tự chữa** và trigger về `'A'`; trên một
    phân mảnh SUY RA hardening **NÉM**. Trước vòng sửa cả hai đều XANH trong khi `TRUNCATE` đi lọt.
    ✔ đã đo cả hai.
11. **[vòng sửa] Bốn sự kiện của ca PHÂN MẢNH** — trigger TRUNCATE cắm được trên `relkind='p'`;
    trigger hàng nhân bản xuống lá; trigger TRUNCATE thì không; `TRUNCATE <lá>` đi lọt. ✔ đã đo cả
    bốn, và chúng là thứ bác bỏ vế *"lược đồ hợp lệ"* của H1.
12. **[vòng sửa] `prosrc` của `suppress_redundant_updates_trigger` là `'suppress_redundant_updates_trigger'`,
    `lanname = 'internal'`** — không chứa `RETURN`. Đây là phép đo buộc vế `prolang = plpgsql` vào vị
    từ: không có nó, hai trigger dựng sẵn của PostgreSQL đủ để chặn deploy trên một lược đồ hợp lệ.
    ✔ đã đo.

## ADR-029 — Một lời khai TÓM TẮT trong tài liệu phải được SUY RA, hoặc nó sẽ thiu

**Ngày:** 2026-09-08 (phép đo: 2026-09-07) · **Trạng thái:** **Đã chấp nhận** · Đóng: **không
khoản nợ nào** (vòng rà sổ), mở **khoản nợ 61** · Liên quan: **H20**, ADR-027, ADR-028

### 1. Vì sao ADR này tồn tại

Ba vòng liên tiếp, ba lần cùng một hình dạng, mỗi lần tìm ra **do tình cờ đọc tới** chứ không do
một cổng nào đỏ:

| Vòng | Lời khai | Sự thật khi đo | Thiu bao lâu |
|---|---|---|---|
| S1.18 | `docs/TEST-PLAN.md`: *"16/50"* | bảng §5 có 17 hàng | vài vòng |
| S1.20 | `docs/STATE.md`: *"mười chín ADR"* | sổ quyết định có 28 | chín vòng |
| S1.21 | `docs/STATE.md`: *"Sổ nợ mở còn: 23 và nửa sau của 30"* | phán xét lại từng dòng: **13** khoản mở (đếm theo dấu văn bản thì ra **14** — xem §2⑶) | tám lần, từ S1.12 |

Hình dạng chung, nói bằng một câu: **một lời khai tóm tắt là một BẢN SAO của một sự thật nằm chỗ
khác, và mọi bản sao không được đối chiếu đều trôi.** Nó không trôi vì ai đó cẩu thả — nó trôi vì
lời khai và sự thật nằm ở hai chỗ mà không thao tác nào chạm cả hai.

Và lần thứ ba thì cái giá thôi là thẩm mỹ: câu *"Sổ nợ mở còn…"* là thứ quyết định **vòng sau làm
gì**. Khai năm khoản trong khi có mười ba nghĩa là tám khoản nợ không bao giờ được xếp lịch.

### 2. Quyết định

⑴ **Một lời khai tóm tắt trong tài liệu chỉ được tồn tại nếu có một lớp SUY RA nó từ nguồn.**
   Nguồn là thứ đếm được: số hàng của một bảng, số đầu mục của một tệp, tập tệp trên đĩa. Lời khai
   là thứ chép lại. Lớp là thứ so hai cái.

⑵ **Lớp ấy phải đỏ theo CẢ HAI CHIỀU.** Khai thiếu (bỏ sót một khoản mở) và khai thừa (kể một
   khoản đã đóng) đều là lời khai sai. Một cổng chỉ bắt một chiều là một cổng **mời** người ta đi
   chiều kia.

⑶ **Trạng thái phải là một TỪ KHOÁ, không phải văn phong.** Trước vòng này, *đã đóng* được viết
   bằng bốn cách (`ĐÃ ĐÓNG`, `ĐÓNG 2026-…`, `ĐÃ ĐO`, `MỞ VÀ ĐÓNG CÙNG VÒNG`) và *còn mở* thì không
   có dấu nào — nên **một khoản đang mở và một khoản QUÊN GHI trạng thái trông giống hệt nhau**.
   Từ khoá đóng (`ĐÓNG` · `MỞ` · `NỬA`) làm sự vắng mặt trở nên ồn ào.

⑷ **Mọi lời khai, không phải lời khai đầu tiên.** Bản đầu của phép kiểm số ADR đòi *"đúng MỘT lời
   khai"*; lượt chạy đầu tìm ra HAI, ở hai mục khác nhau của cùng một tệp, khai **28** và **27**.
   Một phép kiểm dừng ở lời khai đầu tiên sẽ XANH trên đúng tệp đang sai.

⑸ **Con trỏ là một phần của lời khai.** Một khoản nợ mà đường dẫn của nó không giải được là một
   khoản nợ không đọc lại được — nó âm thầm biến thành một câu chuyện. Ngoại lệ DUY NHẤT là đường
   dẫn nằm trong đoạn đã **gạch**: dấu gạch nghĩa là *"nguyên văn cũ, giữ lại để đối chiếu"*, và
   một nguyên văn cũ ĐƯỢC PHÉP trỏ tới thứ đã mất.

⑹ **[review lượt 13, H13-1] *"ĐÓNG"* nghĩa là CÓ LỚP GIỮ, không phải CÓ CÀI ĐẶT.** Vòng này
   suýt tuyên khoản nợ 1 đóng dựa trên `callerLimit: LOGIN_TOTP_MAX_PER_CALLER` ở
   `apps/api/src/routes/auth.ts:166` — một dòng cấu hình THẬT, cưỡng chế THẬT ở dispatcher, nhưng
   **xoá đúng dòng ấy thì không một test nào đỏ**: hai test hạn mức đã có chỉ đo `/auth/link` và
   `/auth/redeem`, và đối chứng của chúng gỡ cờ khỏi MỌI route ANON rồi vẫn chỉ đo `/auth/redeem`.
   Đó là "xanh giả" ở chiều ngược với chiều quen thuộc: **hàng rào có thật, nhưng không có gì giữ
   nó.** Đủ để nói THU HẸP, chưa đủ để nói ĐÓNG. Khoản nợ 1 chỉ được đánh `[ĐÓNG]` sau khi có hai
   lớp: một test tích hợp đo `429 + Retry-After` trên `/auth/totp`, và một phép kiểm TĨNH trong
   `timViPhamBangRoute` — *mọi route `ANON` phải khai `callerLimit`, hoặc có một dòng lý do ĐO ĐƯỢC
   trong `MIEN_TRAN_NGUOI_GOI`*. Danh sách miễn ấy có đúng một dòng (`/guest/otp`, trần nằm trong
   `issueOtpChallenge` và chặt hơn), và nó KHÔNG rỗng một cách cố ý — khác `MIEN_TRU` của ADR-027,
   ở đây miễn trừ nói *"trần nằm ở chỗ khác"*, không nói *"chưa có trần"*.

⑺ **[lượt CI đầu tiên] Nguồn của một khẳng định về CÁI KHO phải là CÁI KHO, không phải cái
   đĩa.** `existsSync` trả lời câu *"tệp này có trên máy đang chạy không"* — một câu khác
   câu đang hỏi, và nó xanh trên đúng máy đã viết ra lỗi. `git ls-files` trả lời đúng câu.

### 3. Vì sao không phải "cẩn thận hơn"

Đây là lựa chọn đã bị bác bỏ bằng đo, hai lần. Mục 33 (S1.18) **gọi tên** khoản nợ 7 là thiu; mục
35 (S1.20) **gọi tên lần nữa**; tới vòng này dòng ấy vẫn nguyên văn *"`apps/` rỗng"* trong khi
`apps/` có ba tiến trình. Hai lần ghi vào lịch sử, không lần nào thành một lần sửa. **Ghi một dòng
thiu vào lịch sử không phải một lớp.**

### 4. Phạm vi — và vì sao nó HẸP

ADR này KHÔNG nói *"mọi câu trong tài liệu phải kiểm được"*. Phần lớn nội dung của
`docs/STATE.md` là lập luận, và lập luận thì không suy ra được từ đâu cả. Nó nói về đúng một lớp
câu: **lời khai tóm tắt một tập đếm được** — bao nhiêu ADR, bao nhiêu bất biến, những khoản nợ nào
còn mở. Dấu hiệu nhận ra: nếu bạn viết được một câu lệnh trả lời cùng câu hỏi ấy, thì lời khai
phải được đối chiếu với câu lệnh đó.

**Và phạm vi của lớp ĐẦU TIÊN hẹp hơn phạm vi của quy tắc — nói ra thay vì để người đọc tự phát
hiện.** `[INV-H20]` phủ `docs/STATE.md` và `docs/DECISIONS.md`. Nó **KHÔNG** phủ `Handoff.md`, và
**[S1.28] câu vừa gạch đã hết hiệu lực — xem đoạn cuối mục này.** S1.21 đo được rằng đó là khoảng trống đắt nhất còn lại: §10 của tệp ấy khai *"22 khoản"* trong khi
sổ có **60**, liệt kê *"năm khoản nặng nhất"* mà **bốn** đã đóng, và §6 *"Cái CHƯA có"* — mục tự
mở đầu bằng *"đây là phần dễ hiểu sai nhất"* — có **ba** gạch đầu dòng đầu tiên đều sai. Cả hai đã
sửa tại chỗ ở S1.21 **bằng tay**, tức chúng sẽ trôi lại — và vì thế nó là **khoản nợ 61**, mở
cố ý ở chính vòng đã sửa chúng. Lý do chưa phủ: `Handoff.md` chưa có một
hình dạng máy đọc được (nó là văn xuôi có đánh số, không phải bảng), và ép một hình dạng lên nó là
một vòng riêng. Ghi ra ở đây để nó là một **quyết định**, không phải một chỗ quên.

**[S1.28] VÒNG RIÊNG ẤY ĐÃ CHẠY, VÀ NÓ BÁC CHÍNH CÁCH LÀM MÀ ĐOẠN TRÊN GIẢ ĐỊNH.** Đoạn trên
cho rằng phủ `Handoff.md` nghĩa là **ép một hình dạng lên tệp**. Đo lại thì không phải: cách
hiển nhiên — quét mọi đường dẫn trong đấu huyền như P4 — cho **38 phát hiện, 36 trong đó KHÔNG
phải lỗi** (tên gói, tên team GitHub, đường HTTP, chuỗi phiên bản, mẫu glob đang được TRÍCH,
một quy ước đặt tên, và một tệp mà câu văn nói thẳng là không vào git). Đọc lại P4 mới thấy nó
**chưa bao giờ quét văn xuôi**: nó đọc CỘT CON TRỎ của bảng sổ nợ — một **vị trí đã khai**.

Nên quy tắc rút ra, và nó rộng hơn tệp này: **một lớp canh tài liệu phải đọc những VỊ TRÍ ĐÃ
KHAI, không phải mọi token trông giống thứ nó đi tìm.** Ba trong năm lời khai được phủ hoá ra
là **bản sao của ba con số ADR này đã bắt suy ra** cho `docs/STATE.md`, nên chúng không cần cơ
chế mới — chỉ cần tham số hoá cái NHÃN. Đó chính là vế ⑷ đọc theo chiều TỆP thay vì chiều CÂU:
*mọi nơi lời khai xuất hiện, không phải nơi đầu tiên.* Phần còn lại — văn xuôi khẳng định sự
tồn tại — vẫn ngoài tầm và là **khoản nợ 72**, vì nó cần một cú pháp tự khai chứ không phải một
mẫu rộng hơn.

### 5. Cái giá, nói ra thay vì để người đọc tự phát hiện

- **Bảng sổ nợ nay có một quy ước cú pháp** (ba cột, từ khoá trạng thái ở đầu ô, dòng tổng kết
  đúng dạng). Một dòng nợ mới viết cẩu thả sẽ **chặn CI** thay vì lặng lẽ vào sổ. Đó là đánh đổi
  cố ý: một khoản nợ đáng ghi thì đáng ghi đúng.
- **`[INV-H20]` đọc tài liệu như DỮ LIỆU.** Đổi một tiêu đề mục trong `docs/STATE.md` làm nó đỏ.
  Chi phí ấy có thật; nó rẻ hơn một sổ nợ khai sai một nửa số nợ.
- **[review lượt 13, H13-16] Nó đọc tài liệu như DỮ LIỆU TIN CẬY, và giả định ấy chưa được
  cưỡng chế.** Lớp mới dựng đường dẫn và một biểu thức chính quy từ nội dung `docs/STATE.md`.
  An toàn hôm nay vì tài liệu do người trong kho viết — nhưng `CODEOWNERS` trỏ tới một team
  CHƯA TỒN TẠI (khoản nợ 18), nên không branch protection nào bắt buộc review trên `docs/`.
  Hai lớp đã bịt phần rẻ nhất (đường dẫn phải nằm trong worktree; `new RegExp` hỏng thành một
  vi phạm có tên), và kết luận đúng ở mức *tự gây thương tích*, KHÔNG ở mức *chống nội dung
  thù địch*. Nếu lớp này về sau chạy trên tài liệu do bên ngoài đóng góp, phải xét lại trước.
- **Nó không kiểm được tính ĐÚNG của một phán xét.** `[INV-H20]` bắt được *"bảng nói mở, dòng tổng
  kết nói đóng"*; nó KHÔNG bắt được một dòng đánh dấu `ĐÓNG` bởi một người đọc nhầm mã. Vế ấy vẫn
  là việc của mắt người và của những vòng rà như vòng này — nhưng vòng rà nay chỉ phải xét NỘI
  DUNG, không phải đi tìm xem có bao nhiêu dòng bị bỏ quên.

### 6. Phép đo

1. Câu *"Sổ nợ mở còn…"* xuất hiện **8** lần từ mục 27 tới mục 35 và khai **5** khoản; bảng cho
   **14** dòng không mang dấu đã-đóng khi đếm theo dấu văn bản, và **13** khoản khi phán xét lại
   từng dòng. Ba con số. Hai con số sau lệch nhau ở **bảy** dòng, chia làm hai lớp lý do khác hẳn
   nhau: **1, 5, 7** đóng bởi phép đo HÔM NAY (chúng đã đóng từ lâu, không ai đánh dấu), còn
   **50, 24, 30, 59** thì không ai đọc sai MÃ cả — người ta đọc sai CHỮ (50 đã đóng nhưng viết
   bằng một cách thứ năm; 24 và 30 mang dấu đọc như đã đóng trong khi còn mở; 59 thì không bộ đọc
   nào thấy). Lớp thứ hai là lý do §2⑶ tồn tại. ✔ đã đo cả ba.
2. Dòng **59** của bảng có **một** ô nội dung, dòng **52** có **bốn**; Markdown vẫn dựng bảng, nên
   không ai thấy, còn mọi bộ đọc theo cột thì bỏ qua dòng 59 **trong im lặng**. ✔ đã đo.
3. **Mười** con trỏ không giải được, trong đó dòng 55 trỏ tới `apps/api/src/bucket-bo-nho.ts` —
   tệp mà thân của chính dòng ấy nói đã bị xoá. ✔ đã đo.
4. `docs/STATE.md` mang **hai** lời khai số ADR, **28** và **27**, ở hai mục khác nhau. ✔ đã đo —
   và đây là phép đo buộc §2⑷ vào phép kiểm.
5. Khoản nợ 1 đóng bởi lớp trả cho khoản nợ **39** (`callerLimit = 30`/15 phút trên `/auth/totp`,
   `apps/api/src/routes/auth.ts:166`); khoản nợ 5 đóng bởi `RLS WITH CHECK` với test có từ commit
   `13a6e5b` (2026-08-28). ✔ đã đo cả hai — và cả hai là **lớp KHÁC lớp mà khoản nợ chỉ tên**, đúng
   khuôn nửa đầu khoản nợ 3 ở S1.20.
6. **[vòng sửa sau review lượt 13]** Một dòng nợ thụt vào **một dấu cách** vẫn là hàng bảng với
   GFM, và nó rơi khỏi P1, P2, P4 **trong im lặng** trong khi P3 vẫn xanh. ✔ đã đo bằng chính
   mũi đột biến của P0, và mũi ấy khẳng định luôn bốn phép kiểm kia KHÔNG thấy gì.
7. **[vòng sửa]** Ô con trỏ của khoản 11 sau khi bóc phần đã gạch KHÔNG còn một đường nào —
   tức cửa `~~` dùng được để làm im một con trỏ chết. ✔ đã đo: phép kiểm mới ĐỎ ngay lượt đầu
   trên đúng dòng ấy.
8. **[vòng sửa]** Bảng *Tham chiếu* khai *"Sổ đăng ký 51 bất biến (34 + 17)"*, sổ đăng ký có
   **54 (34 + 20)**. ✔ đã đo — P6 ĐỎ ngay lượt đầu.
10. **[lượt CI đầu tiên]** Hai con trỏ do chính vòng này sửa trỏ tới tệp **có trên đĩa mà
    KHÔNG có trong kho** (`git ls-files .superpowers` = 0). `pnpm t0`, bộ test đơn vị và
    `pnpm evidence:check` đều xanh trên máy phát triển; **T1+T2 đỏ ở CẢ HAI runner của CI**.
    Nguồn của P4 đổi từ `existsSync` sang `git ls-files`. ✔ đã đo — và đây là bản NẶNG của
    chính lớp lỗi mà review lượt 13 nêu ở H13-11.
9. **[vòng sửa]** Xoá `callerLimit` khỏi `/auth/totp`: trước vòng sửa **không test nào đỏ**;
   sau vòng sửa, phép kiểm tĩnh đỏ cho TỪNG route ANON một, và test tích hợp đo
   `429 + Retry-After` trên chính đường ấy. ✔ đã đo cả hai chiều.

## ADR-030 — QT3 được cưỡng chế trên tập câu SQL TỰ KHAI, và điều kiện tiên quyết của mọi ca cướp bị đóng ở tầng tĩnh

**Ngày:** 2026-09-08 · **Trạng thái:** **Đã chấp nhận** · Đóng: **khoản nợ 8** · Mở: **khoản nợ
62**, **63** · Liên quan: **H21**, **E3**, **D1**, ADR-027, ADR-029

### 1. Vì sao ADR này tồn tại

QT3 — *mọi câu SQL chạy dưới một `search_path` mà dự án không kiểm soát phải ghim đủ tên hàm,
toán tử, ép kiểu và tên bảng* — đã sống từ S0 trong **chú thích và test cho từng hàm một**. Khoản
nợ 8 nói thẳng: *"Không lớp máy nào cưỡng chế quy ước này."* Nó là khoản nợ S0 nặng nhất còn lại
sau S1.21, và nó nặng vì cả bốn trục đều đã được **tái lập end-to-end** trên chính kho này: một
`doc.=` trả `true` lật được phán quyết của `hasPermission`; `CREATE CAST … AS IMPLICIT` lật được
phán quyết của MFA.

### 2. Quyết định

⑴ **Chủ thể của lớp cưỡng chế suy từ NỘI DUNG câu SQL, không từ một danh sách tệp: một câu đã
   ghim MỘT trục phải ghim ĐỦ BỐN.** Đây là vế mới, và nó không phải một sự thoả hiệp — nó nhắm
   vào chiều hỏng đắt nhất trong ba chiều:

   | Nhóm | Đo được | Người đọc thấy gì |
   |---|---|---|
   | ghim ĐỦ | | được bảo vệ, và đúng thế |
   | ghim KHÔNG GÌ | 80 câu | chưa được bảo vệ, và thấy ngay |
   | **ghim NỬA VỜI** | **13 câu** | **đọc như đã được bảo vệ, và không phải** |

   Một câu mang `OPERATOR(pg_catalog.=)` ở ba chỗ và một `=` trần ở chỗ thứ tư là cùng một hình
   dạng với *"xanh giả"*: thứ tệ hơn một lỗ hổng là một lỗ hổng trông như đã được vá.

⑵ **Điều kiện tiên quyết của mọi ca cướp bị đóng ở tầng TĨNH.** Cả ba ca đều cần `search_path`
   NÊU TÊN `pg_catalog` ở vị trí sau; không nêu thì `pg_catalog` được tìm ngầm trước tiên và
   không gì cướp được. Ba đường đưa tiền đề ấy vào — `rolconfig` (hardening canh), `options` của
   chuỗi kết nối (`createPool` canh), và **một câu do chính mã ứng dụng phát** — chỉ đường thứ ba
   không có lớp. Nay có, và nó kiểm theo *"câu này có nhắc `search_path` không"* chứ không theo
   một cú pháp: `SET LOCAL search_path` và `set_config('search_path', …)` là khuôn ĐANG DÙNG của
   kho này cho những GUC khác, nên một phép kiểm chỉ khớp `SET search_path` sẽ mời người viết
   dòng tiếp theo đi vòng qua nó mà không biết.

⑶ **Mọi danh sách miễn trừ của lớp này được ĐO trên PostgreSQL thật, không được viết tay.**
   `pg_proc` phán xét danh sách "cấu trúc ngữ pháp" (một tên có hàm thật thì nó GHIM ĐƯỢC, tức nó
   phải bị ghim); `pg_get_keywords()` phán xét hai danh sách từ khoá. Phép đo ấy đã bác **năm**
   dòng của bản đầu (`extract`, `substring`, `overlay`, `position`, `normalize`) và **bốn** dòng
   nữa sau review lượt 14 (`unnest`, `generate_series`, `left`, `right`).

⑷ **Tên kiểu ĐÃ GHIM phải là một kiểu THẬT của `pg_catalog`.** Vế này ra đời từ một lần ĐỎ trong
   chính vòng: bản sửa ghim `$2::pg_catalog.int`, và `int` là **đường cú pháp**, không phải tên
   kiểu trong catalog (`int4` mới là). Câu ném 42704, `/guest/otp/verify` trả 500 thay vì 401, và
   chỉ T3 bắt được. Hình dạng của lỗi đáng nhớ hơn bản thân lỗi: **một lớp canh đòi
   `::pg_catalog.<t>` cho mọi `::<t>` sẽ DẠY người ta viết `::pg_catalog.int`** — nên vế "tên kiểu
   ghim phải tồn tại" thuộc về chính lớp ấy, không phải về sự cẩn thận của người viết.

### 3. Vì sao KHÔNG phải "mọi câu SQL"

Vì nó là một cuộc di trú 200+ chỗ trong một vòng, và mỗi chỗ đổi một câu SQL đang chạy trong
đường nghiệp vụ thật. Khoản nợ 29 đã ghi nguyên tắc: *"trộn vào một hạng mục sẽ làm cả hai khó
xem xét"*. Vòng này ghim **20** câu — 13 câu nửa vời cộng 7 câu trên đường ra quyết định an ninh
mà review lượt 14 chỉ tên — và mỗi câu ấy được T3 chạy qua.

Phần dư **không bị giấu**: nó có một con số (80), một mốc ghim (`TRAN_TOI_DA`, chỉ đi xuống), một
phép đo phụ (**39** trong số đó chạm bảng nhạy cảm) và một số hiệu (**khoản nợ 62**).

### 4. Cái giá, nói ra thay vì để người đọc tự phát hiện

- **Bộ đọc SQL là một bộ tách từ trên mã TypeScript, không phải một trình phân tích SQL.** Nó
  ghép được chuỗi nối bằng `+`, bỏ đúng chú thích và hằng chuỗi, đọc cả ba kiểu dấu nháy. Nó
  KHÔNG hiểu SQL dựng động ngoài phép nối chuỗi, và nó không đọc `.sql` (xem §5).
- **Nó đọc `git ls-files`.** Một tệp sản xuất mới chưa `git add` là vô hình với lớp này — và đó
  không phải giả thuyết: chính vòng này gặp nó khi bốn tệp test mới chưa vào chỉ mục.
- **Ghim làm SQL khó đọc hơn.** `a > b` thành `a OPERATOR(pg_catalog.>) b`. Đây là một cái giá
  thật, trả cho một bảo đảm đã được tái lập bằng phép đo chứ không phải cho một nỗi lo.
- **Độ ưu tiên đổi khi ghim.** Mọi `OPERATOR(…)` có CÙNG độ ưu tiên và kết hợp TRÁI, nên
  `a > b - c` viết bằng OPERATOR() thành `(a > b) - c`. Ngoặc là bắt buộc khi có hai toán tử ghim
  trong một biểu thức — `packages/identity/src/login.ts` ghi nguyên văn phép đo
  (`boolean - interval` ⇒ 42883).

### 5. Phạm vi — và cái gì giữ phần NGOÀI phạm vi

`db/migrations/*.sql` và `hardening.always.sql` **không** thuộc lớp này. Lý do đo được: chúng chạy
trên kết nối của `migrate()`, nơi câu lệnh ĐẦU TIÊN là `SET search_path = public` — một
`search_path` KHÔNG nêu `pg_catalog`, tức `pg_catalog` được tìm ngầm trước tiên. Thứ giữ cho tiền
đề ấy đứng chính là §2⑵.

### 6. Phép đo

1. Trước vòng: **13** câu ghim nửa vời (21 toán tử, 8 hàm, 1 ép kiểu, 16 tên bảng trần), trong đó
   `packages/unseal/src/gate.ts` — cổng chính sách mở thầu — đếm phê duyệt bằng năm `=` trần và
   ba tên bảng trần trong khi vẫn ghim `public.unseal_so_phe_duyet_can`. ✔ đã đo.
2. `packages/invitation/src/invitation.ts` có `(expires_at <= now())` và `locked_until > now()`
   trần trong một câu mà toàn bộ mệnh đề `WHERE` đã ghim — hai biểu thức quyết định một OTP đã
   hết hạn hay đang bị khoá. ✔ đã đo.
3. `pg_proc` bác **năm** tên khỏi danh sách "ngữ pháp"; `pg_get_keywords()` + `pg_proc` bác thêm
   **bốn** sau review lượt 14. Mã sản xuất đã GHIM `unnest` từ trước, tức lớp canh và mã nguồn
   từng nói ngược nhau. ✔ đã đo.
4. `$2::pg_catalog.int` ⇒ 42704 ⇒ 500 thay vì 401 trên `/guest/otp/verify`. `int` không có trong
   `pg_type` của `pg_catalog`; `int4` thì có. ✔ đã đo, và nay có một phép kiểm cho nó.
5. 20 câu SQL được ghim trong vòng, **757 test tích hợp** chạy qua chúng. ✔ đã đo.

---

## ADR-031 — Khoản nợ 23 đóng bằng BA phép đo trên máy thật CỘNG một quyết định tường minh cho phần không đo

**Ngày:** 2026-09-08 · **Trạng thái:** **Đã chấp nhận** · Đóng: **khoản nợ 23** · Liên quan:
**ADR-007**, **ADR-011**, **ADR-019**, rủi ro sản phẩm số 3, `tools/do-webcrypto/`

### 1. Vì sao ADR này tồn tại

Khoản nợ 23 ra đời 2026-08-29 như một **hoãn có điều kiện**: máy dò WebCrypto đã chạy trong một
webview thật (Zalo iOS, WKWebView, iOS 18.7 — ĐẠT), nhưng **toàn bộ phía Android còn trống** và
trong tay không có máy. Điều kiện hoãn ghi rõ: *"phải đo trước khi CHỐT ADR-011"*.

Điều kiện ấy **đã tự tan** ngày 2026-09-04, và đó là chỗ dễ đọc nhầm nhất của cả khoản nợ này:
ADR-011 được chốt bằng cách **gỡ bỏ thế hoặc/hoặc** — hỗ trợ **cả hai** thuật toán thoả thuận
khoá, chọn bằng chính máy dò lúc chạy. Từ mốc đó, phép đo Android tụt từ **cổng chặn** xuống
**con số vận hành**. Khoản nợ vẫn được giữ mở suốt bốn vòng sau đó, và giữ đúng: một con số vận
hành chưa đo vẫn là một ô trống, chỉ không còn chặn ai.

Ngày 2026-09-08 ô ấy được điền — bằng một máy thật, không bằng một bảng tương thích.

### 2. Ba phép đo, và điều mỗi phép đo KHÔNG nói

| Dòng | Engine đo được | Nói được | KHÔNG nói được |
|---|---|---|---|
| 4 | **WKWebView, iOS 26.6.1** (Chrome iOS) | WebKit đời mới **không** đánh rơi `X25519` | không nói gì về **iOS ≤ 16** — câu hỏi ở đầu CŨ, phép đo ở đầu MỚI |
| **5** | **Android System WebView, Chromium 151.0.7922.200** (Zalo, Galaxy A02s, Android 12) | đường nộp thầu chạy **nguyên vẹn** trên một máy phổ thông giá rẻ; *"máy rẻ đời cũ thì Android tự khắc là đường yếu"* là **SAI** — thứ quyết định là bản WebView, không phải tuổi máy | không nói gì về một máy có **WebView tụt lại nhiều phiên bản**: máy đo có WebView **151**, tức mới |
| **6** | **cùng build 151.0.7922.200** (Messenger, cùng máy) | Messenger **mượn chính Android System WebView** — điều nghi đã sinh ra ô ưu tiên 3 bị **bác bằng phép đo**, không bằng suy luận | không nói gì về một bản Messenger nhúng engine riêng ở tương lai |

Cả ba: **ĐẠT toàn bộ, kể cả `X25519`.**

### 3. Quyết định

⑴ **Khoản nợ 23 ĐÓNG.** Lý do đóng **không phải** *"đã đo hết"* — mà là: phần đã đo lấp đúng hai
   ô ưu tiên cao nhất bằng máy thật, và phần chưa đo **không còn quyết định gì**, vì ADR-011 đã
   gỡ thế hoặc/hoặc. Một engine thiếu `X25519` **tụt xuống P-256 chứ không gãy**; một engine
   thiếu cả hai thì gãy ngay ở `crypto.subtle`, tức đã nằm trong đường thoát của ADR-007.

⑵ **Hai chế độ được CHẤP NHẬN không đo, và phải gọi tên chứ không được im lặng:** ⓐ một máy có
   **Android System WebView tụt lại nhiều phiên bản** (chủ máy không cập nhật, hoặc máy không có
   Play Store); ⓑ **iOS ≤ 16**. Không tra bảng tương thích để lấp hai ô ấy — §3 của nhật ký đo
   cấm đúng việc đó, và lượt tra dữ liệu công bố 2026-09-04 đã cho một **kết quả ÂM** (phân bố
   phiên bản System WebView không tra được từ dữ liệu tổng hợp miễn phí).

⑶ **Phần việc còn lại chuyển sang S1.4/S1.5 dưới dạng một YÊU CẦU GIAO DIỆN, không phải một khoản
   nợ:** đường nộp báo giá **phải chạy chính phép dò này trước khi cho nộp**, và khi phán quyết
   không phải *"Nộp thầu được"* thì phải **chuyển hướng sang trình duyệt ngoài** kèm câu giải
   thích — chứ không để nhà cung cấp gặp một lỗi mật mã giữa chừng. Đây là chỗ duy nhất mà hai
   chế độ ở ⑵ còn có thể làm hỏng việc của một người thật, và nó được xử bằng **mã**, không bằng
   một phép đo thêm.

⑷ **Cách viết bị ràng buộc:** mọi câu về webview phải kèm **phiên bản engine**. *"Android: ĐẠT"*
   là câu rộng hơn phép đo; câu đúng là *"Android System WebView 151: ĐẠT"* — cùng một luật đã
   áp cho *"Zalo iOS"* mà không kèm **iOS 18.7**.

### 4. Cái ADR này KHÔNG quyết

- **Không** đổi ADR-011. Ba phép đo **xác nhận** hướng hiện tại; chúng không đòi sửa gì.
- **Không** hạ rủi ro sản phẩm số 3 xuống ĐÓNG. Nó xuống **TRUNG BÌNH**, và thứ đưa nó lên lại
  là một dòng ĐỎ mới trong nhật ký đo, không phải một suy đoán.
- **Không** tuyên bố phủ thị trường. Sáu dòng là sáu engine, không phải một mẫu thống kê.

### 5. Số đo

1. Ba lượt chạy trên máy thật ngày 2026-09-08, mỗi lượt một khối văn bản có `UA:` tự khai —
   `tools/do-webcrypto/ket-qua-do.md` §1 dòng 4, 5, 6. ✔ đã đo.
2. Dòng 5 và 6 báo **cùng chuỗi build** `Chrome/151.0.7922.200` ⇒ cùng System WebView. ✔ đã đo.
3. Máy dò nay có **năm** phán quyết và **bốn** mũi đột biến; `?dot=ngucanh` chứng minh nó phân
   biệt được *"máy thiếu WebCrypto"* với *"link không phải https"*. ✔ đã đo trên Chromium.
4. Token `wv` **không** dùng để nhận dạng được: UA của Zalo không có `wv` dù là WebView cùng
   build. ✔ đã đo — hai dòng cạnh nhau trong cùng bảng.

---

## ADR-032 — QT3 hết phần dư: chủ thể của lớp cưỡng chế là MỌI câu SQL, và ba con số của khoản nợ 62 đều sai theo hướng khác nhau

**Ngày:** 2026-09-08 · **Trạng thái:** **Đã chấp nhận** · Đóng: **khoản nợ 62** · Mở: **khoản nợ
65** · Liên quan: **H21**, ADR-029, ADR-030

### 1. Vì sao ADR này tồn tại

ADR-030 dựng lớp máy cho QT3 với chủ thể hẹp: **câu đã ghim MỘT trục phải ghim ĐỦ BỐN**. Phần dư
— câu chưa ghim trục nào — chỉ chịu một mốc chỉ-đi-xuống (`TRAN_TOI_DA = 80`). Khoản nợ 62 là
phần dư ấy, và nó được cố ý để lại cho một vòng riêng (khoản nợ 29).

### 2. Đo lại trước khi làm, và con số 80 vỡ ra làm ba

| | Số | Là gì |
|---|---|---|
| khai ở sổ nợ | **80** | "câu SQL chưa ghim trục nào" |
| **không phải SQL** | **9** | thông báo lỗi tiếng Việt mở đầu bằng `INSERT` — bộ đọc chỉ đòi chuỗi **bắt đầu** bằng một từ khoá SQL |
| **không có gì để ghim** | **8** | `SET lock_timeout = 0`, `SET ROLE $1`, `SELECT current_user`, `SET LOCAL statement_timeout = …` |
| **việc thật** | **63** | trên 12 tệp |

Con số **39 câu chạm bảng nhạy cảm** cũng đi theo: nó được đếm trên tập 80, tức trên một tập có
9 phần tử không phải SQL.

**Điều đáng ghi không phải sai số, mà là chỗ nó đến từ:** cả ba con số đều do CHÍNH lớp canh sinh
ra ở S1.22 và được chép vào sổ nợ mà không ai đo lại. Đây đúng hình dạng ADR-029 nói — *một lời
khai suy được thì phải suy ra* — chỉ khác ở chỗ lần này lời khai nằm trong một khoản nợ, nơi nó
định nghĩa quy mô của một vòng chưa làm.

### 3. Quyết định

⑴ **Chủ thể của H21 là MỌI câu SQL trong mã sản xuất.** Phép lọc `daGhim` và mốc `TRAN_TOI_DA`
   bị **gỡ**. Một mốc chỉ-đi-xuống là hàng rào của một cuộc di trú *đang chạy*; giữ nó lại sau khi
   số về 0 chỉ còn một tác dụng: cho phép quay lui.

⑵ **Chín thông báo lỗi được sửa ở CHỖ GỌI, không nới bộ đọc.** `"INSERT rfq_invitations không
   trả về hàng nào"` → `"Câu INSERT …"`. Bộ đọc giữ nguyên độ **kêu nhầm**: một hàng rào an ninh
   thà kêu nhầm còn hơn bỏ sót, và giá của lần kêu nhầm này là chín câu văn. Hệ quả phải nói ra:
   từ nay một thông báo lỗi **không được mở đầu bằng động từ SQL** — khuôn `login.ts` đã dùng sẵn
   (`"startUserSession: INSERT sessions …"`).

⑶ **63 câu được ghim bằng một BỘ GHIM TỰ ĐỘNG, và bản đề xuất được ĐỌC LẠI trước khi áp.** Địa
   chỉ của một cái tên (`public.` hay `pg_catalog.`) được **suy từ `db/migrations/*.sql`**, không
   gõ tay. Sàn `SO_CAU_TOI_THIEU` 148 → **139**: nó đi xuống hợp lệ vì tập chủ thể **đúng lên**,
   không phải vì bộ đọc mù đi.

### 4. Bảy lỗi của chính bộ ghim mà lượt ĐỌC LẠI bắt được — và HAI MƯƠI lỗi nó KHÔNG bắt được

Đọc mục 4 trước mục 4b, rồi đọc cả hai như một mệnh đề: **đọc lại một bản đề xuất tự động là cần,
và nó KHÔNG đủ.**

| | Lỗi | Nếu áp thẳng |
|---|---|---|
| 1 | `pg_stat_activity` → `public.pg_stat_activity` | trỏ tới một bảng **không tồn tại** — nó là khung nhìn của catalog |
| 2 | `bid_so_tien(…)` → `pg_catalog.bid_so_tien(…)` | cùng hình dạng với `::pg_catalog.int` mà S1.22 đã trả giá: **lớp canh dạy người ta viết một cái tên không có** |
| 3 | `u.payload->>'x'` → `u.payloadOPERATOR(pg_catalog.->>)'x'` | mất khoảng trắng ⇒ **một định danh khác hẳn** |
| 4 | `make_interval(secs => $4)` → `secs OPERATOR(pg_catalog.=) OPERATOR(pg_catalog.>) $4` | `=>` là **đối số có tên**, không phải hai toán tử — SQL hỏng ở ba chỗ |

Ba lỗi đầu bắt được **trước** khi áp, lỗi thứ tư bắt được **sau**, bằng một lượt quét lại bản đã
vá. Lỗi 4 nay có một mũi đo riêng trong H21.

### 4b. HAI MƯƠI câu hỏng đi qua `tsc`, `eslint`, `depcruise` VÀ chính H21 — review lượt 15 đọc tay ra

Bốn lỗi ở mục 4 là những lỗi tôi tự thấy. Review an ninh lượt 15 đọc cả 12 tệp và tìm ra **20 câu
SQL hỏng**, trong đó **18 câu chắc chắn ném lúc chạy**:

| Nhóm | Số | Hình dạng | Mã lỗi |
|---|---|---|---|
| **gán trong `SET` bị ghim** | **10** | `SET opened_by OPERATOR(pg_catalog.=) $2` — ngữ pháp `set_clause` chỉ nhận token `=` trần | 42601 |
| **văn bản NHÂN ĐÔI** | **6** | `… WHERE id OPERATOR(pg_catalog.=) $1SELECT … WHERE id …` | 42601 |
| **`extract` dạng ngữ pháp** | **2** | `pg_catalog.extract(epoch FROM …)` | 42601 |
| **đổi CÂY PHÂN TÍCH** | **2** | `a OPERATOR(=) b OPERATOR(->>) 'k'` ⇒ `(a = b) ->> 'k'` | 42883 |

**Một nguyên nhân gốc cho cả 10 chỗ `SET`:** bộ ghim khi nhận ra một lời gọi hàm đã **nuốt luôn
dấu `(`** mà không tăng độ sâu ngoặc. Dấu `)` kế tiếp hạ độ sâu xuống **−1**, nên mọi phép kiểm
`độ sâu === 0` tắt vĩnh viễn — kể cả phép kiểm *"dấu `=` đầu tiên của mỗi mục `SET` là ngữ pháp"*.
Một biến đếm lệch một đơn vị, mười đường ra quyết định an ninh đóng cứng.

**Hậu quả nếu merge:** thu hồi lời mời (C3) chết hẳn; phê duyệt kép mở thầu không gom đủ hai chữ
ký vì người phê duyệt **thứ nhất** luôn rollback cả hàng phê duyệt lẫn bản ghi kiểm toán; toàn bộ
hạn mức OTP và `LOGIN_CALLER` ném; bộ dọn `caller_rate_limits` — bảng **duy nhất** của dự án mà số
hàng do kẻ tấn công chọn — ném 42883 mỗi lượt.

**Không lỗ FAIL-OPEN nào.** Cả 20 lỗi đều làm đường **đóng cứng**, không mở toang. Đó là may, không
phải thiết kế: một bộ ghim tự động sai theo hướng khác đã có thể mở.

### 4c. Lớp canh nay HAI CHIỀU: `PREPARE` từng câu trên PostgreSQL thật

`qt3-ghim-schema.test.ts` bắt **THIẾU ghim**; không lớp nào bắt **GHIM SAI**. `qt3-ngu-phap.int`
có hỏi PostgreSQL, nhưng chỉ hỏi về **tên rời rạc** — không câu nào trong 63 câu được đưa cho
PostgreSQL **phân tích**. Đó là lý do 18 lỗi cú pháp đi qua cả bốn cổng tĩnh.

`tests/architecture/qt3-cu-phap.int.test.ts` đóng khoảng cách ấy: mỗi câu DML được `PREPARE` trên
một CSDL đã migrate — phân giải tên bảng, tên hàm, toán tử và kiểu, tức **đúng bốn trục QT3**, mà
không thực thi gì. Nó có hai mũi răng viết nguyên dạng hai trong 20 lỗi của chính vòng này, nên
nó không thể xanh rỗng. Câu tiện ích (`SET`, `CREATE`, `GRANT`) nằm ngoài `PREPARE` và số ấy được
**đếm ra**, không im lặng.

**Bài học đắt nhất vòng, viết thành một câu:** một lớp canh đòi một cách viết mà **không chạy thử
cách viết ấy** thì nó không phải hàng rào, nó là một cái khuôn. Cùng hình dạng với `::pg_catalog.int`
ở S1.22, nhưng lần này khoảng cách rộng gấp hai mươi lần.

### 5. Cái ADR này KHÔNG quyết

- **Không** đưa `db/migrations/*.sql` vào phạm vi — ADR-030 §5 giữ nguyên, và cái giữ chúng vẫn là
  vế `search_path` của H21.
- **Không** biến bộ đọc thành trình phân tích SQL. Nó vẫn là bộ tách từ trên TypeScript.
- **Không** nói rằng mọi câu SQL của kho nay an toàn trước mọi ca cướp: nó nói **mọi câu ĐỌC ĐƯỢC
  bởi bộ tách từ** đã ghim đủ bốn trục.

### 6. Số đo

1. 139 câu SQL / 27 tệp; **0** câu còn vi phạm (trước vòng: 63). ✔ đã đo.
2. 63 câu được viết lại, **758 test tích hợp** chạy qua chúng trên PostgreSQL thật. ✔ đã đo.
3. Hai mũi đột biến mới ĐỎ thật: một câu viết trần hoàn toàn, và `=>` bị đọc thành hai toán tử.
   ✔ đã đo.

---

## ADR-033 — Lưới an toàn phải tự nói: đóng đỏ giả bằng KHOÁ chứ không bằng LOẠI TRỪ, và fail-closed phải có đường đi tới người đọc

**Ngày:** 2026-09-08 · **Trạng thái:** **Đã chấp nhận** · Đóng: **khoản nợ 59**, **65** · Mở:
**khoản nợ 66** · Liên quan: ADR-029, khoản nợ 24

### 1. Vì sao ADR này tồn tại

Ba khoản nợ 24, 59, 65 nhìn như ba việc rời. Chúng là **một**: chúng nói về độ tin cậy của
chính cái lưới đang đo mọi thứ khác. Một lưới sai theo ba kiểu khác nhau — **đỏ giả** (59), **kết
quả không tới ai** (65), **một tỷ lệ chưa đo** (24) — và cả ba đều làm người đọc mất khả năng
phân biệt *"cổng này nói gì"* với *"cổng này lại thế thôi"*.

### 2. Quyết định

⑴ **Đỏ giả của `depcruise` đóng bằng một KHOÁ LIÊN TIẾN TRÌNH, không bằng loại trừ theo tên.**
   Đường dễ hơn là cho `pnpm run depcruise` bỏ qua mọi tệp `zprobe-*`. Nó đóng được đua tranh,
   nhưng đổi lại cổng sản xuất **thôi nhìn một lớp tệp** mà chỉ một quy ước đặt tên giữ cho trống
   — tức mua sự yên tĩnh bằng một lỗ. Khoá không đổi thứ gì được đo; nó chỉ nói *"đừng đo trong
   lúc người khác đang sửa cây nguồn"*.

⑵ **Khoá bao TRỌN vòng đời của probe**, không chỉ bao lượt quét: probe nằm trên đĩa thật, nên chỉ
   cần nó **tồn tại** trong lúc lượt quét toàn kho chạy là đủ để sinh một vi phạm không có thật.

⑶ **Một job fail-closed phải có đường đưa kết quả tới một chỗ CÓ NGƯỜI.** `do-lap.yml` khi tỷ lệ
   khác 0 nay mở (hoặc bình luận vào) một issue mang **con số**, **tên tệp đỏ** và **link lượt
   chạy**. Fail-closed mà không ai đọc thì chỉ là **fail-lặng** — và điều đó đã xảy ra thật: ngày
   2026-09-07 job ấy đo được `TỶ LỆ ĐỎ: 2/10`, đúng con số khoản nợ 24 chờ, rồi nằm yên 22 giờ.

⑷ **Một đường báo động không được kiểm là một đường báo động không tồn tại.** Vì thế có
   `workflow_dispatch` input `dot_bien`: nó cộng một lượt đỏ **giả** để bắt đường báo động chạy
   khi kho đang xanh, và issue sinh ra từ nó **tự khai mình là một mũi đo**.

### 3. Đo được, không suy

| Vế | Phép đo | Kết quả |
|---|---|---|
| khoá có nối tiếp thật không | hai **tiến trình** thật; vế *"không khoá"* chạy TRƯỚC để chứng minh máy dựng được đua tranh | không khoá ⇒ chồng lấn; có khoá ⇒ không, và tổng thời gian ≥ 2× thời gian giữ |
| khoá có đóng được đỏ giả không | chạy lại **đúng bối cảnh** từng đỏ: lượt gộp `pnpm evidence` | `boundaries.test.ts` **XANH** |
| đường báo động có chạy không | `dot_bien=true`, `so_luot=1` trên nhánh | **issue #22** được mở, mang tỷ lệ + link + commit; đã đóng kèm giải thích |
| bản vá `[M10]` có hạ được tỷ lệ đỏ không | 10 lượt `pnpm test:int` trên **phần cứng CI**, nhánh đã vá `33af790` (lượt 34225703897, 87 phút) | **`TỶ LỆ ĐỎ: 0 / 10`** — trước vòng: 2/10 trên master, trong đó **một** thuộc khoản nợ 24. Đọc kèm §5 |
| [S1.62, khoản nợ 67] đường báo động còn chạy khi tách thành job riêng không | workflow thăm dò riêng trên nhánh tạm, KHÔNG ghi gì: job `a` ghi output rồi ĐỎ, job `b` `needs: a` với `if: always()` và chỉ `issues: read` (lượt 34663968157); thêm harness chạy thân `bao-dong` trên bash thật với `gh` giả | job `b` **chạy** và thấy `so_do=[2]` của một job đỏ; `gh` không checkout đọc được issue qua `GH_REPO`; bảy kịch bản harness ra đúng tiêu đề và nhánh. Lệnh GHI issue dưới quyền mức job chưa đo — §S1.62 |

### 4. Cái ADR này KHÔNG quyết, và một khoản nợ MỚI phải nói ra

**`pnpm evidence` VẪN có thể đỏ, và lần này vì một lý do KHÁC.** Cùng lượt chạy chứng minh khoá
hoạt động, một test khác đỏ: `auth.int.test.ts` — *"lần 61 phải nhanh: expected 1090 to be less
than 800"*. Đó là một **khẳng định thời gian TUYỆT ĐỐI** (`TRE_TEST_MS = 800`) dùng để phân biệt
*"được phục vụ ngay"* với *"bị làm chậm"*; dưới tải, một lượt bình thường vượt ngưỡng ấy và cổng
đỏ mà **không có gì hỏng**.

Đây là **khoản nợ 66**, và nó KHÔNG được gộp vào 59: cơ chế khác, bản vá khác. Hình dạng đóng đã
thấy được — đo **tương đối** trong chính lượt ấy (so lượt bị làm chậm với trung vị của các lượt
nhanh) thay vì so với một hằng số tuyệt đối — nhưng nó là một vòng riêng.

Nói cách khác: **khoản nợ 59 đóng đúng thứ nó nói (đua tranh `depcruise`), không đóng câu
*"lượt gộp hết đỏ"*.** Hai câu ấy khác nhau, và gộp chúng lại là đúng lỗi mà ADR-029 cấm.

### 5. MỘT LƯỢT `0 / 10` CHO PHÉP KẾT LUẬN GÌ — VÀ KHÔNG CHO PHÉP GÌ

Vế đo của khoản nợ 24 về `0 / 10`, và đó là một con số **dễ đọc quá tay**. Tính ra chứ đừng cảm
thấy: với tỷ lệ nền **1/10** đã đo trước vòng, xác suất thấy 0 đỏ trong 10 lượt **ngay cả khi
không sửa gì cả** là

    0,9¹⁰ ≈ 0,35

tức **hơn một phần ba số lần, một kho hoàn toàn chưa được vá vẫn cho ra `0 / 10`**. Độ mạnh của
phép thử này chỉ khoảng 65%. Một lượt 10 sạch **không** phân biệt được *"đã sửa"* với *"gặp
may"*, và bất kỳ ai đọc `0 / 10` như một chứng minh đều đang đọc rộng hơn phép đo — đúng hình
dạng mà ADR-029 tồn tại để chặn.

**Quyết định: một khoản nợ dạng "test flaky" được đóng khi và chỉ khi có ĐỦ BA CHÂN, và tỷ lệ là
chân YẾU NHẤT trong ba.**

1. **Cơ chế gọi được tên.** Không phải *"chắc do máy chậm"* mà một câu kiểm chứng được: `pool.end()`
   là thao tác cục bộ của Node, backend PostgreSQL giữ advisory lock chết **sau đó** và bất đồng
   bộ, nên một phép **đếm tức thì** đo sai **thời điểm** chứ không đo sai tính chất.
2. **Bản vá không nới một ngưỡng nào.** Vòng chờ có hạn thay cho phép đếm tức thì **giữ nguyên
   răng** của lớp canh: một khoá kẹt THẬT vẫn ở lại tới hết hạn và test vẫn đỏ với **đúng con số
   cũ**. Đây là vế tách *"sửa"* khỏi *"làm cho hết kêu"* — và là vế mà một lần nới ngưỡng sẽ
   trượt qua trong im lặng.
3. **Một tỷ lệ đo trên phần cứng CI**, làm chứng cho hai chân trên chứ không thay chúng.

**Hệ quả thứ nhất — thứ tự đóng không tuỳ ý.** Chân thứ ba là một phép đo **còn chạy tiếp sau khi
vòng kết thúc** (lượt hằng tuần). Một phép đo không ai đọc thì không phải một phép đo, nên **khoản
nợ 65 phải đóng TRƯỚC khoản nợ 24**. Đảo thứ tự lại thì lời đóng của 24 dựa vào một cái cổng
fail-lặng.

**Hệ quả thứ hai — "không quan sát được" phải được ghi khác "đã chữa".** Khoản nợ 24 gọi tên hai
test. `[M10]` có đủ ba chân. `[T10-L]` (`outbox.int.test.ts`) **không phát lần nào trong 10 lượt
và không nhận một dòng sửa nào** — nó rời sổ vì *không quan sát được*, và hàng sổ phải nói đúng
chữ ấy. Ngày nó trở lại, một issue mang con số sẽ mở: đó là một **phép đo mới**, không phải khoản
nợ cũ mở lại.

### 6. HỆ QUẢ THỨ BA — MỘT LỚP CANH CHỐNG TREO PHẢI TỰ CHỨNG MINH LÀ NÓ KHÔNG TREO

Review an ninh lượt 16 đọc chính cái khoá mà §2⑴ vừa dựng lên, và tìm thấy **một đường đi tới
một vòng quay vô hạn**: `continue` trong khối `catch` nhảy thẳng lên đầu `for(;;)`, vượt qua
**cả** kiểm tra hạn **cả** giấc ngủ. Nó nằm ngay dưới một chú thích viết *"một lượt treo im
lặng còn tệ hơn một lượt đỏ, nên chỗ này NÉM"*.

**Quyết định, phát biểu thành luật để lần sau có chỗ mà đối chiếu:**

1. **Trong một vòng lặp chờ, kiểm tra hạn là câu lệnh ĐẦU TIÊN của mọi nhánh lỗi**, và không
   nhánh nào được rời vòng lặp mà không đi qua giấc ngủ. Một `catch` trần (`catch {}`) trong
   một vòng lặp chờ là một lỗi cho tới khi chứng minh được ngược lại: nó nuốt đúng cái chẩn
   đoán cần đọc.
2. **"Chủ còn sống không" thay cho "khoá già bao nhiêu".** Một hạn theo đồng hồ sai cả hai
   chiều cùng lúc — giết khoá đang sống của một lượt chạy chậm, và giữ khoá đã chết của một
   lượt bị giết. `process.kill(pid, 0)` hỏi đúng câu cần hỏi. Đồng hồ chỉ còn là lưới đỡ cho
   khe giữa `mkdir` và lúc ghi xong tên chủ, nên hạn ấy phải **nhỏ hơn** hạn chờ.
3. **Nhả khoá theo CHỦ, không vô điều kiện.** Nếu khoá hiện tại không còn mang tên mình thì
   xoá nó là dựng lại đúng đua tranh mà lớp này đi đóng.
4. **Và luật cho chính phép đo:** một harness đột biến phải **fail-closed** — khai trước số
   phép đo kỳ vọng, chạy đối chứng không-đột-biến, ném khi số thực tế lệch. Trong vòng này,
   hai harness lần lượt đo **không cái gì** rồi báo *"xanh"*: một bộ lọc tên test viết không
   dấu (khớp 0 test, vitest thoát 0), và một phép thay chuỗi không khớp (cả hai vế chạy cùng
   một bản). Một phép đo chưa chạy nhìn giống hệt một phép đo đã qua.

## ADR-034 — Một ngưỡng phải đo đúng đại lượng nó mang tên; khi không thể, đổi đại lượng chứ đừng nới ngưỡng

**Bối cảnh:** khoản nợ **2** và khoản nợ **66**, S1.26. Chúng vào sổ như hai việc rời — một lỗ
xác thực và một test nhạy tải — nhưng cả hai là cùng một hình dạng: **một con số được dùng để
phán xét một tính chất mà nó không đo.**

* Khoản 2: `failed_attempts` là một bộ đếm ĐÚNG, nhưng cái nó chặn — trần loạt đầu — hoá ra bằng
  **độ đồng thời của kẻ tấn công**, không bằng ngưỡng cấu hình. Con số có thật; nó chỉ không đo
  thứ người đọc tưởng.
* Khoản 66: `TRE_TEST_MS = 800` phán xét *"được phục vụ ngay"* bằng một **khoảng thời gian tuyệt
  đối**, trong khi tính chất cần chứng minh là **tương đối**. Dưới tải, một lượt bình thường mất
  1090 ms và cổng đỏ mà không có gì hỏng.

### 1. Quyết định chung

**Khi một ngưỡng không đo được đại lượng nó mang tên, hãy ĐỔI ĐẠI LƯỢNG. Không nới ngưỡng, và
cũng không thay nó bằng một ngưỡng thứ hai cùng loại.**

Nới ngưỡng biến một phép đo thành một lời khai. Thay bằng một ngưỡng cùng loại chỉ dời chỗ hỏng
— và ở khoản 66 phản biện đối kháng **đo được** rằng cách ấy còn tệ hơn: một hiệu tương đối
(`t₃₀₁ − trung vị`) **vừa yếu hơn sàn tuyệt đối vừa đỏ oan được**, với biên đỏ oan thật là **80
ms** chứ không phải 720 — vì `BIÊN + đệm = D` theo định nghĩa. Nó dựng lại chính khoản nợ 66 ở
một chỗ mới, chỉ khó thấy hơn.

### 2. Khoản 2 — đưa cổng vào `WHERE`, và ĐO NGÂN SÁCH CỦA KẺ TẤN CÔNG

Bản vá **không** thêm khoá tường minh, **không** thêm round trip: nó đưa cổng vào mệnh đề `WHERE`
của câu `UPDATE` đếm, và chuyển câu ấy lên **TRƯỚC** lời gọi cổng mở bí mật. Đếm trước, phán sau.

**Phần đắt nhất không phải bản vá mà là ĐẠI LƯỢNG ĐƯỢC ĐO.** Phép đo cũ đếm *lý do trả về*
(`WRONG_CODE`), và nó **không phân biệt được bản đã vá với chính khoản nợ**: dời câu đặt cọc
xuống sau cổng thì cả 24 request vẫn mở cổng, rồi vẫn xếp hàng, và số `WRONG_CODE` vẫn là 5 —
test vẫn xanh. Đại lượng đúng là thứ khoản nợ GỌI TÊN: **ngân sách của kẻ tấn công = số lần cổng
mở bí mật được mở**. Đo dưới đồng thời ép tất định 24: **5, không phải 24**.

**Đánh đổi DoS được nhận, và nó đứng trên ba con số ĐÃ CÓ LỚP** chứ không trên một lời hứa:
`idle_in_transaction_session_timeout = 60 s` (cận **cấu trúc** cho người GIỮ khoá),
`lock_timeout` = `statement_timeout` = 15 s (người CHỜ **chết** chứ không treo), và
`MAX_TOTP_WINDOW = 10` ⇒ ≤ 21 lần HMAC chặn TRƯỚC cổng. Trần 5 s của `boiTranKms` là cận **chặt
hơn nhưng CÓ ĐIỀU KIỆN** — nó phụ thuộc composition root, nên **không** được kể là tính chất cấu
trúc.

**Cái giá được ghim bằng số, không để trong chú thích:** kẻ thua một cuộc đua đã đặt cọc trước
khi biết mình thua, và cọc không được hoàn — một người dùng bấm gửi hai lần tiêu mất 1 trong 5
lần thử. Đó là hướng fail-CLOSED, và nó có một khẳng định riêng.

### 3. Khoản 66 — vấn đề KHÔNG ĐỐI XỨNG, nên bản vá cũng không đối xứng

Một **SÀN** đặt trên một request bị làm chậm **cố ý** không đỏ oan được bao giờ: tải chỉ làm nó
lớn hơn. Nó ở lại nguyên vẹn. Chỉ vai **TRẦN** bị gỡ — và không thay bằng ngưỡng nào cả.

Tính chất cần chứng minh cho 300 lượt đầu là *"KHÔNG đi vào nhánh làm chậm"* — một câu hỏi
**PHẠM TRÙ**, không phải một phép đo thời gian. Nhánh ấy để lại dấu vết trực tiếp, nên đếm dấu
vết là đo thẳng tính chất. Nó **mạnh hơn** phép đo cũ: bắt cả một throttle bắn với độ trễ **0
ms**, thứ đồng hồ mù hoàn toàn.

**Một khẳng định ÂM cần một ĐỐI CHỨNG DƯƠNG trong cùng lượt chạy.** *"Số lần làm chậm vẫn là 0"*
sẽ xanh oan nếu ai đổi chuỗi log — bộ đếm khi ấy đứng yên vì nó không thấy gì nữa. Nên sau vòng
lặp, số ấy phải thành **đúng 1**. Đây là quy tắc chung cho mọi lớp canh đếm dấu vết.

**Cái giá được ghi ra:** mũi đột biến *đưa `setTimeout` ra ngoài khối `if`* vẫn ĐỎ nhưng **bằng
HẾT GIỜ** (514 giây thay vì 45), thay vì bằng một thông điệp trong ~1 giây. **Không vá nó bằng
một trần TÍCH LUỸ**: 300 lượt dưới đúng lượt tải từng cho ra 1090 ms sẽ chạm bất kỳ trần tích
luỹ nào đủ chặt để bắt mũi ấy.

### 4. Cái ADR này KHÔNG quyết

**Một bản vá có thể giết một KỸ THUẬT TEST, và chi phí ấy phải được đo chứ không ước lượng.** Kỹ
thuật *"treo A trong cổng rồi cho B chạy trọn"* đứng trên tiền đề *cổng được gọi khi chưa ai giữ
khoá hàng* — khoản 2 xoá tiền đề ấy. Đo được: **27/50 đỏ, tất cả bằng hết giờ**, một lỗi gốc kéo
26 lỗi dây chuyền. Đó là hiện vật của TEST chứ không của sản xuất (ở đó cổng có trần, người chờ
có `lock_timeout`, người giữ có `idle_in_transaction_session_timeout`). ADR này **không** đặt ra
một quy tắc chung cho việc ép cửa sổ đua; nó chỉ ghi rằng khuôn khoá-ngoài đã thay được khuôn
treo-trong-cổng ở cả hai chỗ cần.

**Và một khoảng trống MỚI phải nói ra:** trong lúc đóng khoản 2, đo được rằng `pnpm
evidence:check` đóng dấu xanh cho **32 019 ký tự văn xuôi VIẾT TAY** trong ma trận bằng chứng —
nó chứng minh bộ sinh **tất định**, không chứng minh các lời khai **đúng**. Suýt nữa một lời khai
đã bị chính bản vá bác bỏ đi vào kho dưới một dấu kiểm màu xanh. Đó là khoản nợ **68**, và ADR
này không đóng nó.

## ADR-035 — Khi một vị từ nhận diện chủ thể bằng HÌNH DẠNG, hãy đổi sang LIỆT KÊ RỘNG rồi BUỘC PHÂN LOẠI

**Ngày:** 2026-09-09 · **Trạng thái:** Đã chấp nhận · **[S1.29]** · **Khoản nợ liên quan:** 12, 60, 73, 74 ·
**Liên quan:** ADR-027 (`MIEN_TRU`), ADR-028 (suy từ tính chất), ADR-029 (lời khai phải suy ra được)

### 1. Vì sao ADR này tồn tại

Khoản nợ **12** và **60** vào sổ như hai việc rời — một về nhãn `[INV-XX]` trong tên test, một về
hàm trigger trong PostgreSQL. Làm chung mới thấy chúng là **cùng một hình dạng hỏng**:

> **Một vị từ nhận diện chủ thể của nó bằng HÌNH DẠNG, nên thứ không mang hình dạng ấy rơi khỏi
> tập TRONG IM LẶNG — và im lặng là phần đắt nhất.**

Khoản 12: bộ sinh coi *"tên test có `[INV-B2]`"* là *"test này đo B2"*. Một nhãn đúng cú pháp gắn
sai chỗ ghi một dòng `passed` vào hàng của một bất biến và làm một lỗ trống **trông như đã vá**.
Khoản 60: vị từ hỏi *"`prosrc` có chứa `RETURN` không"*. Một hàm canh viết theo kiểu khác rời khỏi
tập, và bảng của nó thôi được canh.

ADR-028 đã dạy *"suy từ TÍNH CHẤT, đừng dùng danh sách tên"*. ADR này nói tiếp phần ADR-028 chưa
nói: **một tính chất được cài đặt bằng phép so khớp hình dạng vẫn là một danh sách tên, chỉ viết
bằng regex.**

### 2. Quyết định

⑴ **Liệt kê RỘNG trước, phân loại sau.** Tập ứng viên phải lấy theo một tiêu chí **không thể lách
   bằng cách viết khác** — mọi tệp test được git theo dõi; ~~mọi hàm `plpgsql` gắn `BEFORE … FOR EACH
   ROW` trên `UPDATE`/`DELETE`~~ **[S1.35, lượt soi 25b #9]** ví dụ ấy đã bị khoản 75 lách bằng
   `FOR EACH STATEMENT`/AFTER ngay hai vòng sau — nay: mọi trigger `plpgsql` trên
   `INSERT`/`UPDATE`/`DELETE`, không xét bit ROW/BEFORE (S1.31, S1.32); và lượt soi 25a #2 chỉ ra vế
   `plpgsql` cũng là một chỗ lách (khoản nợ 79). Hình dạng thân hàm, cách đặt tên, phong cách viết đều
   KHÔNG được dùng để chọn ứng viên. **[lượt soi 19] Bản đầu của `[INV-H22]` vi phạm chính vế này:** nó chọn
   ứng viên CẶP bằng hình dạng DÒNG NGUỒN (`it(`/`describe(` ở đầu dòng), trong khi bộ sinh đếm
   theo `fullName` lúc chạy — `test(`, `it.concurrent(`, tiêu đề ở dòng sau của `it.each` đều nuôi
   ma trận mà bộ quét mù, và kho đang có 8 tên test như thế. Sửa bằng cách lấy cặp từ CHÍNH báo
   cáo vitest. Bài học: *tập tệp* lấy từ `git ls-files` đúng vế này, *tập cặp* thì không, và một
   ADR vừa viết xong đã bị chính bản cài đặt đầu tiên của nó làm trái.

⑵ **Mọi ứng viên phải nằm trong ĐÚNG MỘT danh sách đã khai.** Rơi ra ngoài mọi danh sách ⇒ ĐỎ. Đây
   là chỗ *"im lặng"* bị đóng: một thứ mới không biến mất, nó **chặn cổng** cho tới khi có người
   trả lời nó thuộc loại nào.

⑶ **Cổng phải đỏ theo CẢ HAI CHIỀU** (kế thừa ADR-029 ⑵). Một dòng khai THIU — kể một tệp đã đổi
   tên, một hàm CSDL không còn có — là một lời khai sai y như một ứng viên chưa khai. Chiều thứ hai
   còn là **đối chứng dương dựng sẵn**: bộ quét mù làm MỌI dòng khai hụt, tức đỏ ồn ào thay vì xanh
   im lặng. Đo được: làm mù bộ quét của `[INV-H22]` ⇒ đỏ ở đủ **137** cặp.

⑷ **Nếu vị từ hình dạng vẫn được giữ làm cài đặt, nó phải bị ĐỐI CHIẾU với danh sách khai.** Hai
   cách nói về cùng một tập mà mâu thuẫn nhau ⇒ ĐỎ. Đây là thứ bắt được chiều hỏng ngược: một hàm
   khai KHÔNG-CANH bị viết lại thành không-bao-giờ-trả-về sẽ lọt vào tập hình dạng; một hàm canh bị
   viết lại thành có đường trả về sẽ rời tập. ~~Cả hai chiều đã có mũi đột biến ĐỎ.~~ **[lượt soi
   19 bác vế "cả hai chiều", và bác đúng:** nếu vị từ hình dạng là NGUỒN SỰ THẬT thì chiều thứ
   hai phạt lời khai đúng — một hàm canh có `RETURN` khai thật là CANH sẽ đỏ, khai sai là
   KHÔNG-CANH sẽ xanh và bảng không được canh. Nên: ⒜ vị từ chủ thể phải là **hình dạng ∪ khai
   báo**, để khai thật là đường xanh và bảng ĐƯỢC canh; ⒝ phép đối chiếu chỉ giữ **hướng suy
   được** — thân không `RETURN` ⇒ phải khai CANH; hướng ngược là hợp lệ. ⒞ Khai SAI một hàm canh
   có `RETURN` thì không phép kiểm văn bản nào bắt — chỉ một phép đo hành vi mới phân biệt được,
   và đó là khoản nợ **74**. ~~Đây là ranh giới thật của cả ADR: *liệt kê rộng rồi buộc phân loại*
   đóng chiều IM LẶNG, không đóng chiều NÓI DỐI.~~ **[S1.30] Chiều NÓI DỐI nay đóng bằng phép đo
   HÀNH VI (khoản nợ 74):** mỗi bộ ba (hàm, BẢNG, sự kiện) khai KHÔNG-CANH phải để một hàng thật đi
   qua, đo bằng `pg_stat_xact_user_functions` — PostgreSQL chỉ đếm lời gọi TRẢ VỀ, nên một hàm canh
   khai sai không cách nào được ghi công; vai của nhân chứng được ĐO, và hàm mà thân đọc vai đòi một
   vai không superuser (lượt soi 20 bác bản đầu ở đúng hai vế ấy). Và phép đo lộ ra ca thứ ba mà hai danh sách không tả được: hàm
   canh MỘT SỰ KIỆN (`rfq_key_material_bat_bien` từ chối DELETE vô điều kiện, cho UPDATE có điều
   kiện) — nay là một lời khai riêng, và lời khai ấy phải đo được là NÉM từ chính hàm. Ranh giới
   còn lại của ADR: *liệt kê rộng rồi buộc phân loại* cần một KỊCH BẢN đường hợp lệ do người viết —
   cổng không tự sinh nhân chứng, nó chỉ từ chối nhân chứng giả.

⑸ **ĐO cách hiển nhiên TRƯỚC khi chọn nó, và ghi lại nếu nó trượt.** Với khoản 12, đường hiển nhiên
   là dùng cột *nơi cưỡng chế* của `docs/TEST-PLAN.md` làm nguồn khai. Đo: cột ấy nêu tên tệp cho
   **7/13** cặp mã `H` và **0/101** cặp mã `A–G`. Dùng nó sẽ đỏ 101 lần ở lượt đầu **mà không có
   khiếm khuyết nào** — cùng cái bẫy khoản nợ 61 đo được ở `Handoff.md`.

⑹ **Nói ra rằng đóng băng KHÔNG phải kiểm toán.** Cả hai danh sách được sinh từ trạng thái đo được
   rồi đóng băng. Chúng chặn thành viên **tiếp theo** đi vào lặng lẽ; chúng **không** phán xét các
   thành viên có sẵn. Với khoản 12, vế *"test này có thật sự đo bất biến ấy không"* là một PHÁN XÉT
   và không cơ giới hoá được. Một ADR không được để người đọc tự phát hiện ranh giới ấy.

### 3. Vì sao không phải "viết vị từ chặt hơn"

Đã bị bác bằng đo, hai lần. ⒜ Với khoản 60, mọi cách nới vị từ `prosrc` **lại là một hình dạng
khác** — nó chỉ dời cái lỗ. ⒝ Với khoản 12, bản đầu của lớp mới quét dòng `it(` vì bộ sinh *"gom
theo tên test"*; đo lại thì bộ sinh gom theo `fullName` = tên `describe` NỐI tên `it`, và **22 cặp
(mã, tệp) chỉ tồn tại trên dòng `describe(`** — gồm `H19`, `H20`, `H21` và cả ~~chín~~ **mười** mã hook (`H1`–`H10` — lượt soi 19 đếm lại). Lớp mới
**suýt ra đời với đúng cái lỗ nó sinh ra để bịt**, và thứ chặn được là một phép đếm, không phải một
lần đọc lại kỹ hơn.

### 4. Cái giá, nói ra thay vì để người đọc tự phát hiện

- **Thêm một tệp test, thêm một dòng phải viết.** Gắn `[INV-XX]` ở một chỗ mới nay là hai thay đổi
  chứ không phải một. Đó là đánh đổi cố ý: một lời khai độ phủ đáng ghi thì đáng ghi hai chỗ.
- **Danh sách sẽ dài ra.** 137 cặp hôm nay; nó lớn theo số test. Nếu về sau nó trở thành gánh nặng,
  đường đi KHÔNG phải bỏ cổng mà là đổi ĐƠN VỊ khai (khai theo thư mục thay vì theo tệp) — và đó
  lại là một quyết định nhìn thấy được.
- ~~**Tổng điều tra của khoản 60 khoá theo `pg_trigger`.** Một `CREATE RULE … DO INSTEAD NOTHING` cho
  cùng hiệu lực mà không tạo trigger nào, nên bảng ấy không vào tập ứng viên. Đó là khoản nợ **73**,
  mở cố ý ở chính vòng đã đóng 60.~~ **[S1.31] 73 đóng bằng hai đường:** sản xuất phán xét rule trên
  mọi bảng chỉ-ghi-thêm suy ra, và một tổng điều tra `pg_rewrite` với danh sách RỖNG — rỗng là một lời
  khai. Bài học cho chính ADR: *tập ứng viên* phải được liệt kê theo TỪNG CƠ CHẾ có thể cho cùng hiệu
  lực, không theo cơ chế người viết nghĩ tới đầu tiên — và RLS `USING (false)` là cơ chế thứ ba
  (khoản nợ **76**).
- **[S1.30] Nhân chứng hành vi đòi một KỊCH BẢN viết tay** — 24 câu UPDATE/DELETE trên 13 bảng. Một
  hàm trigger mới ở một bảng mới là thêm một câu vào kịch bản, và đó là cố ý: lời khai KHÔNG-CANH
  nay có giá là một hàng thật, không còn là một dòng trong danh sách. ~~Và tập ứng viên của cả tổng
  điều tra lẫn nhân chứng khoá theo trigger BEFORE cấp HÀNG — trigger cấp CÂU LỆNH hay AFTER-ROW ném
  vô điều kiện đứng ngoài, là khoản nợ **75** (lượt soi 20), cùng lớp với 73.~~ **[S1.31] 75 đóng:**
  tập ứng viên là MỌI trigger trên UPDATE/DELETE, và một hàm canh ngoài hình thức BEFORE-ROW là đỏ —
  vì đó là hình thức duy nhất vị từ sản xuất nhận. ~~27 câu nhân chứng thay cho 24.~~ **[S1.33]** Kịch bản
  nay gồm cả INSERT (38 bộ ba INSERT cộng các bộ ba UPDATE/DELETE); con số câu đổi theo kịch bản và
  không còn được khai ở đây — lượt soi 25b #9.

---

## ADR-036 — Danh mục MỌI cơ chế PostgreSQL làm một câu ghi trả 0 hàng mà không lỗi, và lớp canh từng cơ chế

**Ngày:** 2026-09-09 · **Trạng thái:** Đã chấp nhận · **[S1.32]** · **Khoản nợ liên quan:** 60, 73, 74, 75, 76, [S1.33–S1.34] 77, 78, [S1.35] 79, 80, 81, 82, [S1.37] 83 ·
**Liên quan:** ADR-028 (suy từ tính chất), ADR-035 (liệt kê rộng rồi buộc phân loại)

### 1. Vì sao ADR này tồn tại

Ba vòng liền — S1.29, S1.31, và lượt soi 21 — mỗi vòng lộ thêm **một** cơ chế của PostgreSQL có thể
làm một bảng chỉ-ghi-thêm (hay chỉ-đọc) *trong im lặng*: câu UPDATE/DELETE trả `0 hàng`, không lỗi,
không dấu vết, và bảng đứng ngoài mọi lớp của `[INV-H19]`. Trigger BEFORE-ROW (60), rồi RULE (73),
rồi trigger ngoài hình thức BEFORE-ROW (75), rồi RLS `USING (false)` (76). Mỗi lần đóng một cơ chế là
một vòng, và lần nào cũng đợi **người khác** chỉ ra cơ chế kế.

Khoản nợ 76 vì thế không được đóng như một cơ chế thứ ba. Nó được đóng bằng câu hỏi rộng hơn mà bốn
khoản nợ kia là bốn câu trả lời rời rạc:

> **Với một câu INSERT/UPDATE/DELETE do vai ứng dụng gửi, PostgreSQL 16 có những cơ chế nào làm nó
> chạm 0 hàng (hoặc bị nuốt, bị chuyển hướng) mà KHÔNG ném lỗi?**

Trả lời một lần, có địa chỉ cho từng cơ chế, và **cơ chế nào chưa có lớp thì nói ra ở đây** — không
để lượt soi kế phát hiện.

**[S1.49 / lượt soi 41 INFO-2] Phạm vi bảng dưới đây RỘNG HƠN câu hỏi ở §1 và nói ra ở đây:** hàng 12 có hiệu lực là *lỗi*, hàng 4/7 và hàng 24 là *rò xuyên tổ chức*, hàng 25 là *mất một lớp tự chữa* — không phải 0 hàng. Danh mục đã lặng lẽ rộng thành "mọi cơ chế lược đồ làm một câu ghi đi SAI mà không ai thấy"; giữ nguyên tên ADR vì câu hỏi gốc vẫn là hạt nhân, nhưng một hàng mới không bị loại chỉ vì hiệu lực của nó không phải 0 hàng.

### 2. Danh mục

Cột *lớp canh* là nơi cơ chế ấy bị THẤY nếu nó xuất hiện; cột *đo* là phép đo trên PostgreSQL 16 đã
chạy trong kho (không phải suy đoán).

| # | Cơ chế | Hiệu lực | Lớp canh | Đo |
|---|---|---|---|---|
| 1 | Trigger BEFORE-ROW trả `NULL` (bỏ hàng) | 0 hàng, không lỗi | nhân chứng hành vi: vế ⒞ *câu chạm ≥ 1 hàng* — hàm trả về mà không hàng nào đổi thì không ai được ghi công (S1.30) | ✓ |
| 2 | Trigger ném (`RAISE`) — mọi hình thức: BEFORE/AFTER, hàng/câu lệnh | lỗi, nhưng bảng thành chỉ-ghi-thêm | tổng điều tra hàm trigger trên ~~UPDATE/DELETE~~ INSERT/UPDATE/DELETE [S1.32], hàm canh phải BEFORE-ROW để H19 nhận (S1.29, S1.31); H19 canh LOGGED/TRUNCATE/ACL **[S1.39]** hình thức: `CAU_HAM_CANH_HINH_THUC_SAI` — hàm canh gắn ngoài BEFORE … FOR EACH ROW trên INSERT/UPDATE/DELETE ⇒ NÉM (khoản 75 nay có lớp sản xuất; đo: `zz_cau` cấp câu lệnh) **[S1.49 / khoản 93]** và — theo CHIỀU NGƯỢC của hàng này, tức lớp giữ cho trigger ném CỦA TA còn sống chứ không phải lớp thấy trigger ném thù địch — `CAU_TRIGGER_CHAN_SAI`: bốn trigger chặn phải TỒN TẠI, đúng hàm, `ENABLE ALWAYS`, trên đúng bảng sổ mang danh tính nhất quán (ADR-037 kênh ①); cùng chiều với `CAU_HAM_CANH_HINH_THUC_SAI` đã đứng ở đây từ S1.39 | ✓ |
| 3 | `RULE … DO INSTEAD NOTHING` / `DO INSTEAD <khác>` | 0 hàng hoặc chuyển hướng, không lỗi | tổng điều tra `pg_rewrite` (danh sách rỗng) + `migrate()` phán xét rule trên mọi bảng chỉ-ghi-thêm (S1.31) **[S1.39]** lớp sản xuất TỔNG QUÁT: `CAU_RULE_SAI` — rule ngoài `_RETURN` trên MỌI quan hệ của dự án phải khai (`RULE_KHAI`, rỗng); đo: rule trên `zz_rule` (không chỉ-ghi-thêm) ⇒ NÉM | ✓ |
| 4 | RLS policy PERMISSIVE với vị từ hằng/lệch (`USING (true)`, `USING (false)`, không ràng buộc tenant) | 0 hàng hoặc rò xuyên tổ chức | danh sách trắng hình dạng [CR1] + ngoại lệ khoá sáu cột, ở cả hardening lẫn `rls-coverage` (S0) **[S1.49 / khoản 93]** lớp sản xuất là `CAU_POLICY_SAI` nguồn (ii): mọi policy PERMISSIVE trên bảng tenant phải khớp NGUYÊN VĂN `HINH_DANG_CHUAN` hay `NGOAI_LE_HINH_DANG` của đúng (bảng, policy, lệnh, vai) | ✓ |
| 5 | RLS policy RESTRICTIVE `USING (false)` | 0 hàng, không lỗi; `migrate()` OK | **[S1.32]** tổng điều tra policy RESTRICTIVE — khai đủ bốn cột nguyên văn, 29 dòng **[S1.37]** cụm đã deploy: chủ DB thường tạo được và `migrate()` đi qua (đo) — mục hardening là **khoản nợ 83** **[S1.38]** lớp sản xuất: `CAU_POLICY_LOP_SAI` — mọi policy trên bảng RLS thuộc đúng một lớp; RESTRICTIVE khuôn 027 nhận theo tính chất, tám biến thể khai ~~sáu~~ bảy cột nguyên văn ở hardening (`POLICY_RESTRICTIVE_KHAI`, bản test đòi khớp) — **[S1.55 / khoản 98, lượt soi 48]** cột đầu là lược đồ, khớp theo (lược đồ, bảng, policy); cột vai so theo OID 0 và `quote_ident` — vai thật tên PUBLIC viết hoa không giả được PUBLIC (đo); `USING (false)` chưa khai ⇒ `migrate()` NÉM (đo: `zz_chan`, `[I4]`) | ✓ |
| 6 | RLS bật mà không policy PERMISSIVE nào phủ (lệnh, vai) dù quyền đã cấp — mặc định-từ-chối | SELECT/UPDATE/DELETE 0 hàng không lỗi; INSERT ném | **[S1.32]** tổng điều tra *phủ lệnh*: 87/87 tổ hợp (bảng, vai, quyền) hôm nay có policy **[S1.37]** cụm đã deploy: chủ DB thường tạo được và `migrate()` đi qua (đo) — mục hardening là **khoản nợ 83** **[S1.38]** lớp sản xuất: `CAU_PHU_LENH_SAI` — rộng hơn tổng điều tra ở test một vế (bốn vai kết nối, thành viên kế thừa), KHÔNG miễn con của bảng tenant: con có GRANT riêng mà không policy là đúng ca này (lượt soi 29 NẶNG-2 — bản đầu miễn với lý do viết cho câu hỏi RÒ); đo: `zz_rong83` app_unseal có SELECT mà policy chỉ TO app_api ⇒ NÉM; bốn fixture con/lá ở `migrations.int.test.ts` đổi kỳ vọng **[S1.44]** tập vai của `CAU_PHU_LENH_SAI` = TÍNH CHẤT ∪ TÊN ĐÃ GHIM (`VAI_KET_NOI_UNG_DUNG` ∪ `ROLE_CANH` — lượt soi 36 #1: membership là thứ ADMIN OPTION đổi được, `REVOKE app_api FROM app_api_login` + GRANT trực tiếp làm bản chỉ-tính-chất im), quyền xét theo KẾ THỪA (`pg_has_role … 'USAGE'`, nêu `(qua nhóm)`); vai lạ thành viên app_api mang GRANT trực tiếp được thấy dù BƯỚC 1 không gỡ được — đo ba bản đối chứng im đúng chỗ (khoản 88). `VAI_KET_NOI_UNG_DUNG` đổi `'MEMBER'` → `'USAGE' OR 'SET'`: membership chỉ-admin (PostgreSQL 16 cấp cho vai CREATEROLE tạo role) không phải kết nối ứng dụng — hồ sơ N3 đo: theo `'MEMBER'` hardening thu hồi CREATE của chính chủ database, 001 gãy **[S1.49 / khoản 93]** và `CAU_POLICY_SAI` nguồn (i): bảng tenant không có policy PERMISSIVE nào là vi phạm — fail-closed nhưng là sự cố sẵn sàng, thường là dấu vết một `DROP POLICY` sau triển khai | ✓ |
| 7 | RLS bật trên bảng NGOÀI tập tenant — lớp [CR1] không soi | như 4–6, vô hình | **[S1.32]** tổng điều tra bảng RLS ngoài tenant (khai: `caller_rate_limits`) **[S1.37]** cụm đã deploy: chủ DB thường tạo được và `migrate()` đi qua (đo) — mục hardening là **khoản nợ 83** **[S1.38]** lớp sản xuất: `CAU_RLS_NGOAI_TENANT_SAI` — bảng RLS ngoài `VI_TU_CAN_CO_RLS` phải ở `BANG_RLS_NGOAI_TENANT_KHAI` (đo: `zz_ngoai83` ⇒ NÉM); và `caller_rate_limits_khach` nay là một hàng của `POLICY_KHAC_KHAI` + ghim nguyên văn ở mục riêng (82⑵) **[S1.55 / khoản 98]** và policy trên bảng RLS ngoài `public` nay có đường khai: `POLICY_KHAC_KHAI` và `POLICY_RESTRICTIVE_KHAI` mang cột lược đồ, 83⑴ khớp theo (lược đồ, bảng, policy) — trước đó bảng ngoài `public` khai được ở 83⑶ mà policy của nó thì không (đo: `zz98.t`, ngõ cụt ADR-028 §3); **[lượt soi 48 NẶNG-3]** trừ PERMISSIVE trên dữ liệu tenant mà [CR1] không soi (con cháu bảng tenant, bảng có org_id): không khai được — đo, bản đầu để một dòng khai mở đường đọc thẳng lá phân vùng ngoài `public` ra hàng của hai tổ chức **[S1.50 / khoản 91]** và cờ RLS thôi thì chưa đủ: `ENABLE` KHÔNG áp cho chủ bảng, nên mục tự chữa `VI_TU_FORCE_THIEU` bật `FORCE ROW LEVEL SECURITY` trên MỌI bảng bật RLS của lược đồ dự án (trừ đối tượng extension) — suy từ tính chất, không từ danh sách khai; đo dưới một chủ bảng KHÔNG superuser vì superuser bỏ qua RLS ở mọi cấu hình. Cái giá: chủ bảng chịu RLS ⇒ bảng có policy chỉ áp cho vai ứng dụng làm chủ đọc/ghi 0 hàng im lặng — khoản 94 | ✓ |
| 8 | `session_replication_role = replica` bỏ qua trigger `ENABLE` thường | hàm canh KHÔNG chạy — fail-open, ngược chiều với 1–7 | **[S1.32]** trigger canh phải `ENABLE ALWAYS` (tổng điều tra, `luon_bat`); 047 đã ghim ALWAYS cho chốt TRUNCATE **[S1.39]** tiền đề SUSET: `CAU_PARAMETER_ACL_SAI` — `pg_parameter_acl` cấp cho PUBLIC/vai ứng dụng ⇒ NÉM (đo: `GRANT SET ON PARAMETER session_replication_role TO app_api`) **[S1.51 / khoản 92]** và lớp bắt chính GUC ấy được gắn sẵn TRƯỚC khi phiên bắt đầu: `CAU_GUC_VAN_HANH_GAN_SAN` phán xét ba GUC vận hành (`row_security`, `session_replication_role`, `search_path`) khi `pg_settings.reset_val` của phiên deploy khác `boot_val` với nguồn ngoài `database` — tức `ALTER ROLE ALL SET` (đo: `source = 'global'`, và `migrate()` từng ĐI QUA), `ALTER ROLE <vai> SET`, postgresql.conf / `ALTER SYSTEM`, `options=` trên chuỗi kết nối. Ba mục "đặt ở mức database" chỉ tự chữa nguồn `database`, nên nguồn ấy cố ý đứng ngoài mục mới; không tự sửa vì RESET ở mức vai/cụm là SUSET (khoản 92) | ✓ |
| 9 | `ALTER TABLE … DISABLE TRIGGER` | như 8 | tổng điều tra: trigger canh `tgenabled = 'D'` là vi phạm (S1.29); **[S1.36, ghi ở S1.42]** lớp sản xuất: `CAU_TRIGGER_CANH_CO_DIEU_KIEN` (vế `tgenabled <> 'A'`, mọi bảng có trigger canh) — đo: trigger canh DISABLE ⇒ `migrate()` NÉM | ✓ |
| 10 | VIEW / MATVIEW / bảng ngoài / bảng phân mảnh làm đích ghi (`INSTEAD OF` trả NULL, FDW ghi ra cụm khác, lá phân mảnh không chốt) | 0 hàng hoặc ghi lệch chỗ | **[S1.32]** tổng điều tra `relkind`: mọi đích DML là bảng thường trừ khi khai (rỗng); [I2] hardening bắt view trên bảng tenant; lá phân mảnh đo ở test lá **[S1.37]** cụm đã deploy: chủ DB thường tạo được và `migrate()` đi qua (đo) — mục hardening là **khoản nợ 83** **[S1.39]** lớp sản xuất: `CAU_QUAN_HE_KHAC_SAI` — bảng ngoài, matview, view có trigger INSTEAD OF phải khai (`QUAN_HE_KHAC_KHAI`, rỗng); view trơn và bảng phân mảnh cố ý không phán (đo: view `security_invoker` đi qua, view có INSTEAD OF ⇒ NÉM) **[S1.49 / khoản 93]** lớp sản xuất khi ĐÍCH GHI là bảng sổ: `CAU_BANG_SO_VAT_LY` và `CAU_CHI_GHI_THEM_VAT_LY` (LOGGED, bảng THẬT, UNIQUE `(org_id, seq)`); và `CAU_DOC_VONG` cho view/matview/`SECURITY DEFINER` — đích ghi hay đích đọc không phải bảng thường thì lớp [CR1] không soi. **[S1.50 / khoản 91]** `CAU_DOC_VONG` nay KHÔNG còn vế đích cho nhánh view: mọi view/matview của lược đồ dự án phải `security_invoker` (matview thì khai), đối xứng nhánh SECDEF — vì `pg_depend` chỉ nối view với quan hệ tham chiếu TRỰC TIẾP nên chuỗi view lồng và view đọc qua hàm lọt mọi vế đích (đo). ~~`CAU_HINH_DANG_CHINH_TAC` và `CAU_COT_NGOAI_CHUOI`~~ hai mục hình dạng cột chuyển sang **hàng 25** (lượt soi 41 NẶNG-2: chúng canh một cơ chế khác) | ✓ |
| 11 | Constraint trigger DEFERRED (`INITIALLY DEFERRED`) trên INSERT/UPDATE/DELETE | chạy ở COMMIT, ~~ngoài phép đo nhân chứng~~ | ~~không được ghi công ⇒ ĐỎ nhìn thấy được, thông điệp nói rõ; hôm nay 0/46 (S1.31)~~ **[S1.33]** ĐO ĐƯỢC: `chung()` ép `SET CONSTRAINTS ALL IMMEDIATE` SAU câu nhân chứng và sau `hoanTat`, đọc bộ đếm lần thứ ba — hàm DEFERRED chỉ ghi công ở cửa sổ ấy (2/2 của kho: 017, 018); `DEFERRABLE INITIALLY IMMEDIATE` chạy cuối câu, cửa sổ đầu | ✓ |
| 12 | Quyền thiếu (bảng hay cột) | **lỗi**, không im lặng | ma trận quyền ghim ở `rls-coverage` **[S1.49 / khoản 93]** và ở đây cột này mang nghĩa NGƯỢC với các hàng khác — không phải "lớp THẤY cơ chế" mà **lớp ĐÒI cơ chế PHẢI CÓ**: `CAU_CHI_GHI_THEM_QUYEN` và `CAU_QUYEN_BANG_SO_MO_TA` bắt UPDATE/DELETE trên bảng chỉ-ghi-thêm phải bị THU HỒI, để một câu ghi vào sổ báo LỖI thay vì đi qua. Lượt soi 41 NẶNG-2 chỉ ra chỗ lật nghĩa này | ✓ (đo: `db/hardening-suy-tu-tinh-chat.int.test.ts` H19 — cấp lại UPDATE ⇒ `migrate()` thu hồi và NÉM) |
| 13 | `WITH CHECK (false)`, CHECK constraint (kể cả `CHECK … NO INHERIT`), cột sinh, định tuyến phân mảnh hụt~~, `NO INHERIT`~~ | **lỗi**, không im lặng — **[S1.35]** `ALTER TABLE … NO INHERIT` KHÔNG thuộc hàng này: nó im lặng, xem hàng 22 (lượt soi 25a #6 chỉ ra; đo) | — | n/a |
| 14 | `ON CONFLICT DO NOTHING`, mệnh đề `WHERE` không khớp | 0 hàng — nhưng do CHÍNH CÂU LỆNH, không do lược đồ | ngoài phạm vi: ADR này nói về lược đồ | n/a |
| 15 | Trigger BEFORE INSERT ROW trả `NULL` (nuốt INSERT) — **lượt soi 22 chỉ ra** | `INSERT 0 0`, `RETURNING` rỗng, không lỗi | **[S1.32]** tập rộng của tổng điều tra mở ra bit INSERT: 27 hàm trigger INSERT phải được phân loại (19 khai mới); ~~**chưa có nhân chứng hành vi cho INSERT — khoản nợ 77**~~ **[S1.33]** nhân chứng hành vi cho 38 bộ ba (hàm, bảng, INSERT) — vế ⒞ *câu chạm ≥ 1 hàng* là lớp, vì hàm nuốt TRẢ VỀ và ĐƯỢC đếm (khác hàm canh ném) | ✓ (đo: `INSERT 0 0`, `calls` +1) |
| 16 | Che tên: `CREATE TEMP TABLE users` trên một kết nối pool (pg_temp đứng trước `public`), hoặc schema `app_api` (`$user`), hoặc `SET search_path` trong phiên tới một schema vai có USAGE — **lượt soi 22 chỉ ra** | câu ghi rơi vào bảng khác, 0 dấu vết ở bảng thật; bảng tạm che một KẾT NỐI pool hết đời nó, schema che MỌI kết nối | ~~**chưa có — khoản nợ 78** (`REVOKE TEMP ON DATABASE`, cấm schema trùng tên vai); hôm nay vô hại vì mã sản xuất qualify `public.`~~ **[S1.34]** lớp 1 — `hardening.always.sql`: TEMP và CREATE ON DATABASE thu hồi khỏi PUBLIC và mọi vai kết nối ứng dụng (thành viên bắc cầu của `app_api`/`app_unseal`, theo tính chất) — tự chữa; schema trùng tên vai kết nối, và quan hệ trùng tên public trong một schema vai có USAGE — phán xét; lớp 2 — `vai-tro.ts` `DISCARD TEMP` cùng câu SET ROLE ở mỗi lần giao client (bảng tạm tạo trước deploy sống qua REVOKE); lớp 3 — mã sản xuất qualify `public.` (QT3/H21), nay không còn là lớp chịu lực. **Giới hạn ghi ra:** hàm SECURITY DEFINER thuộc chủ DB tạo được bảng tạm trong phiên app (hôm nay không hàm nào dùng TEMP; `CAU_DOC_VONG` canh secdef); mọi role khác của cụm mất TEMP — ràng buộc thiết kế: *vai ứng dụng không bao giờ dùng bảng tạm; role phụ trợ cần TEMP phải được GRANT đích danh*. **[S1.35, lượt soi 25a #11/#12]** `DISCARD TEMP` xoá cả bảng tạm do secdef tạo — trong phạm vi một lần cầm client, nên giới hạn secdef ở trên thu hẹp về *trong một lần cầm*; và nếu một vai kết nối ứng dụng là CHỦ database (cấu hình sai) thì `has_database_privilege` luôn true — hai mục theo vai gãy vĩnh viễn với thông điệp sai hướng; cùng thông điệp ấy cũng im về đường PUBLIC — nếu mục PUBLIC không thu hồi được thì mục theo vai gãy theo (`has_database_privilege` đếm cả PUBLIC) mà chỉ nói *đích danh hoặc qua nhóm* (lượt soi 25b #12): chặn deploy là đúng chiều, ~~thông điệp thì chưa (chưa sửa; địa chỉ ở thân khoản nợ 82)~~ **[S1.36]** thông điệp hai mục ấy nay nêu cả bốn đường: đích danh, qua nhóm, qua PUBLIC, chủ DB **[S1.49 / khoản 93]** `CAU_QUAN_HE_TRUNG_TEN` (quan hệ trùng tên `public` trong schema mà vai kết nối ứng dụng có USAGE — phán xét, không tự xoá) và mục *schema trùng tên một vai mà kết nối ứng dụng có thể mang ("$user" che public)*: mục này viết THẲNG SQL ở hậu điều kiện nên khoá tra cứu của nó là chính TÊN MỤC — hardening cố ý không tự `DROP SCHEMA` một schema có thể chứa đối tượng (§2⑵ của ADR-028) | ✓ (đo: đếm 0 / UPDATE 0 hàng trước lớp; 42501 sau; bảng tạm có sẵn sống qua REVOKE; `migrations.int.test.ts` ×2) |
| 17 | Nuốt SAU KHI ĐẾM: trigger AFTER ROW xoá (hay sửa) đúng hàng vừa đi qua rồi trả `NULL` — **lượt soi 23 chỉ ra** | `INSERT 0 1`, `RETURNING` đầy đủ, `calls` tăng, bảng rỗng — ba vế ⒜⒝⒞ của nhân chứng đều xanh | **[S1.33]** vế *hàng thật* đo ở mức BẢNG: `pg_stat_xact_user_tables` ở ba mốc — bộ đếm của đúng sự kiện bằng `rowCount`, hai bộ đếm kia bằng 0, cửa sổ sau không chạm bảng nhân chứng; lệch thì nhân chứng NÉM | ✓ (đo: `n_tup_ins` 1, `n_tup_del` 1) |
| 18 | Nuốt MỘT trong nhiều hàng của cùng một câu (trigger BEFORE ROW trả `NULL` có điều kiện theo giá trị hàng) — **lượt soi 23 chỉ ra** | `rowCount ≥ 1` — vế ⒞ vẫn xanh | **[S1.33]** mỗi INSERT của kịch bản khai SỐ HÀNG nó mong, phải bằng đúng `rowCount`; nuốt theo dữ liệu NGOÀI câu (một `org_id` thuộc tập cố định) vẫn là giới hạn ⒞ ⒟ đã khai của khối nhân chứng | ✓ (đọc: `rowCount` đếm hàng đi qua BEFORE) |
| 19 | Trigger BEFORE ROW trả về hàng ĐÃ SỬA (`RETURN OLD` trên UPDATE; `NEW.cột := OLD.cột` hay `NULL` trên INSERT/UPDATE) — **lượt soi 25a chỉ ra** | `UPDATE 1`, `n_tup_upd` 1, `calls` +1, `RETURNING` có hàng — nhưng giá trị KHÔNG đổi hoặc bị cắt cột: theo đọc `chung()`, bốn con số ấy đúng là những gì ba vế ⒜⒝⒞ và ⒞′ so — nhân chứng ghi công; hàng vào bảng nhưng không phải hàng đã gửi | ~~**chưa có — khoản nợ 80** (vế ⒠: mỗi câu khai cặp (cột, giá trị) đã SET và `RETURNING` chúng, `chung()` so bằng, lệch thì NÉM)~~ **[S1.60 / khoản 80]** vế ⒠ của nhân chứng: mỗi câu INSERT/UPDATE khai cặp (cột, giá trị) đã đặt, RETURNING chúng (hay `docLai` dưới chủ sở hữu khi vai nhân chứng không SELECT được), `chung()` so mọi hàng sau ⒞′ — lệch thì NÉM, không ai được ghi công; nhân chứng đo dưới vai ứng dụng theo danh sách trắng. Giới hạn nói ra: giá trị máy chủ sinh chỉ khai `KHAC_NULL`; UPDATE không đổi giá trị không phân biệt được; cột không khai không được so. Ghim thân ở hardening chỉ đóng băng lời khai, không phán hành vi | ✓ (đo: `RETURN OLD` ⇒ `rowCount` 1, `n_tup_upd` 1, `RETURNING` trả giá trị cũ; **S1.60:** nhân chứng NÉM nêu cột và hai giá trị — `db/hardening-suy-tu-tinh-chat.int.test.ts` `[khoản nợ 80] VẾ ⒠`) |
| 20 | Trigger canh có `WHEN (…)` hay `UPDATE OF <cột>` — hàm canh KHÔNG CHẠY cho một phần câu, tên hàm và tên trigger giữ nguyên — **lượt soi 25a chỉ ra**; cùng lớp hàng 8–9 (hàm canh không chạy), và `003_audit_events.sql` đã biết nó từ S0 | UPDATE cột khác / mọi DELETE đi qua với 1 hàng, không lỗi; bảng vẫn "chỉ-ghi-thêm" theo vị từ suy ra (LOGGED/TRUNCATE/ACL đều xanh) | bảng CÓ TÊN: hardening soi `tgqual`/`tgattr` từ S0 (`CTE_TRIGGER_CHAN`); bảng SUY RA: ~~**chưa có — khoản nợ 79**~~ **[S1.36]** vị từ (cả hai bản) chỉ đếm trigger canh khi `tgqual IS NULL AND tgattr = ''` — bảng rơi khỏi tập; mục phán xét `CAU_TRIGGER_CANH_CO_DIEU_KIEN` ở hardening chặn deploy khi bất kỳ trigger nào của hàm canh có WHEN/UPDATE OF hay không ENABLE ALWAYS (`tgenabled` — lượt soi 27; hàng 8–9 cho bảng suy ra nay cũng có lớp sản xuất) — để không rơi trong im lặng; chốt TRUNCATE cũng phải `tgqual IS NULL` — **đo mới:** `WHEN (false)` trên trigger TRUNCATE hợp lệ và TRUNCATE đi lọt; tập rộng mang `co_when`/`co_cot` | ✓ (đo: `zz_dk` — vị từ cũ nhận, vị từ mới thả, `migrate()` NÉM nêu `zz_dk.u`/`zz_dk.d`; `zz_tr` — TRUNCATE lọt qua chốt có WHEN, `migrate()` NÉM) |
| 21 | Trigger gọi hàm KHÔNG plpgsql (`internal`/C/PL khác — vd `suppress_redundant_updates_trigger()` có sẵn, hay `CREATE FUNCTION … LANGUAGE <khác>`) — **lượt soi 25a chỉ ra** | `UPDATE 0`, không lỗi; vô hình với mọi tổng điều tra (đều lọc `lanname = 'plpgsql'`), với vị từ và với nhân chứng | ~~**chưa có — khoản nợ 79**~~ **[S1.36]** tổng điều tra NGÔN NGỮ trigger ở `[INV-H19]`: mọi trigger của dự án gọi hàm plpgsql trừ `TRIGGER_NGOAI_PLPGSQL_DA_KHAI` (rỗng), đối chứng dương là chính hàm built-in ấy; vế plpgsql ở vị từ GIỮ vì lý do đo được của nó vẫn đúng. ~~**Giới hạn ghi ra:** lớp này CHỈ Ở TEST — trên cụm đã deploy chưa có mục hardening, theo cách đọc §3⑶ cho tới khi khoản 81 quyết;~~ **[S1.39, ghi ở S1.42]** mục hardening `CAU_TRIGGER_NGOAI_PLPGSQL_SAI`; ~~ranh giới (lượt soi 27 INFO-5): tạo hàm `internal`/C cần superuser và PL tin cậy khác chưa cài, nên đường này ngoài mô hình đe doạ của hardening (chủ bảng không superuser)~~ **[S1.37] bác:** chỉ TẠO hàm C cần superuser; GẮN hàm C có sẵn thì không (built-in; extension tin cậy `tcn`), và `plperl` là extension tin cậy — đo; hôm nay 85 trigger plpgsql, 0 trigger ngôn ngữ khác **[S1.37]** đo: chủ DB thường gắn được trigger gọi hàm built-in KHÔNG cần tạo hàm, và `plperl` là extension tin cậy — ranh giới *cần superuser* SAI cho hàng này ⇒ mục hardening `prolang` là **khoản nợ 83** **[S1.39]** lớp sản xuất: `CAU_TRIGGER_NGOAI_PLPGSQL_SAI` — mọi trigger không nội bộ trong lược đồ dự án gọi hàm plpgsql trừ khai (`TRIGGER_NGOAI_PLPGSQL_KHAI`, rỗng); đo: `suppress_redundant_updates_trigger` ⇒ `migrate()` NÉM — giới hạn *chỉ ở test* của S1.36 hết | ✓ (đo: UPDATE cùng giá trị ⇒ 0 hàng; `lanname = 'internal'`; tập rộng không thấy nó) |
| 22 | `ALTER TABLE con NO INHERIT cha` — hàng đang nằm ở bảng con rời tầm của câu ghi qua bảng cha — **lượt soi 25a chỉ ra** (hàng 13 từng xếp nhầm vào *lỗi*) | UPDATE/DELETE qua cha 0 hàng, không lỗi; con vẫn là `relkind 'r'` hợp lệ với tổng điều tra; ~~không census nào đọc `pg_inherits`~~ **[S1.40]** 82⑴ đọc | ~~**chưa có — khoản nợ 82** (tổng điều tra `pg_inherits` ngoài phân mảnh, danh sách khai rỗng + đối chứng dương); kho có fixture con INHERITS ở schema `khac` nên là ca có thật~~ **[S1.40] mục hardening `CAU_KE_THUA_SAI`** — mọi cặp `pg_inherits` không phân mảnh có con trong lược đồ dự án (loại `pg_temp`: bảng tạm là của riêng phiên, đo) phải khai ở `KE_THUA_KHAI` (rỗng); canh TIỀN ĐỀ như 83⑧ vì sau cú tách catalog không còn dấu vết; chiều ngược khi cả hai bảng còn. Giới hạn: cặp đã khai bị tách rồi tái dùng tên — ~~khoản 85~~ **[S1.41]** con cũ tắt RLS bị `CAU_ORG_ID_NGOAI_PUBLIC_SAI` phán (đo). DETACH PARTITION là cùng cơ chế ở vị trí khác: lá public ⇒ [CR1]; lá ngoài public đã RLS ⇒ 83⑶; tạo-và-tách giữa hai deploy ⇒ ~~khoản 85~~ **[S1.41]** `CAU_ORG_ID_NGOAI_PUBLIC_SAI` ở deploy kế — mức bảo đảm "phát hiện ở deploy kế" (§5). Fixture `khac`/`con_tt` của kho nay NÉM ở mục này (kỳ vọng lật) | ✓ (đo: trước 1 hàng, sau `NO INHERIT` 0 hàng) |
| 23 | GUC `app.*` gắn sẵn cho phiên ứng dụng — `ALTER DATABASE/ROLE/ROLE ALL … SET`, `ALTER SYSTEM`/postgresql.conf, `options=` trên chuỗi kết nối, `GRANT SET ON PARAMETER`, `proconfig` hàm — **lượt soi ngang 33a #1; hàng thêm ở S1.48 (40b #1) vì §2 tự khai là nguồn** | mọi câu ngoài `withTenant` chạy dưới tổ chức do người khác chọn; mọi phiên thành phiên khách ⇒ 29 policy RESTRICTIVE `_khach` thu hẹp ⇒ câu ghi của người mua 0 hàng không lỗi | **[S1.47]** mục phán xét `CAU_GUC_TUY_BIEN_GAN_SAN` năm nhánh (không tự RESET — chủ database thường 42501, RESET ALL im lặng placeholder, đo); `withTenant` từ chối trước `fn` khi bốn GUC đã có giá trị lúc mở giao dịch; **[S1.48]** `migrate()` từ chối trước lượt sửa (40a H1), `withTenant` phân biệt rò phiên bằng RESET (40a NẶNG-1) | ✓ (đo: test khoản 87, H1; with-tenant S1.47/S1.48) |
| 24 | Bảng đa tổ chức KHÔNG có cột tên `org_id` — dữ liệu buộc vào tổ chức qua một khoá ngoại tới bảng tenant (`to_chuc uuid REFERENCES organizations(id)`, `(to_chuc, nguoi) REFERENCES users (org_id, id)`), ở mọi schema kể cả `public` — **lượt soi 32 INFO-6; hàng thêm ở S1.49 (khoản 93) cho lớp đã có từ S1.46** | không vị từ nào nhận: (A) không bật RLS, [CR1] không soi, 85 không thấy, 83⑵/⑶ không thấy ⇒ một GRANT mở hàng của MỌI tổ chức — rò, không phải 0 hàng | **[S1.46]** `CAU_KHOA_NGOAI_TENANT_SAI` — bảng (r/p) trong lược đồ dự án, không cột `org_id`, có khoá ngoại (của nó hay của tổ tiên INHERITS) tới một bảng tenant theo tính chất, ngoài tập tenant, không RLS ⇒ phải khai (`BANG_KHOA_NGOAI_TENANT_KHAI`, rỗng); **[S1.48]** khoá ngoại HỢP THÀNH cũng tính | ✓ (đo: lỗ rò thật ở `k` lẫn `public`, `migrate()` NÉM cho cả hai — `rls-coverage.int.test.ts` describe S1.46) |
| 25 | Bảng sổ kiểm toán TRÔI HÌNH DẠNG CỘT — thêm một cột ngoài chuỗi hash, hay đổi tên/kiểu một cột chính tắc — **lượt soi 41 NẶNG-2 tách khỏi hàng 10** | không phải 0 hàng: `audit_events` RỚT khỏi tập `can_co` của lớp C ⇒ trigger nối chuỗi thôi được tự chữa, và một cột lạ là chỗ dữ liệu đi ra NGOÀI chuỗi hash — cả hai trong IM LẶNG, VĨNH VIỄN | **[S1.20]** `CAU_HINH_DANG_CHINH_TAC` (hình dạng cột của bảng sổ chính tắc) và `CAU_COT_NGOAI_CHUOI` (không cột nào ngoài chuỗi hash) — hai mục PHÁN XÉT, không tự chữa: đổi hình dạng cột không phải thao tác đơn điệu (ADR-028 §2⑵) | ✓ (đo: `db/hardening-suy-tu-tinh-chat.int.test.ts` H19 và `db/audit-append-only.int.test.ts`) |
| 26 | Ba GUC VẬN HÀNH (`row_security`, `session_replication_role`, `search_path`) gắn sẵn cho phiên từ nguồn NGOÀI mức database — `ALTER ROLE ALL SET` (hàng 0,0), `ALTER ROLE <vai> SET` kể cả `IN DATABASE`, postgresql.conf / `ALTER SYSTEM`, `options=` trên chuỗi kết nối, và một câu `SET` còn sót trong phiên ; cộng hai đường cùng hạng — `proconfig` của hàm và `GRANT SET / ALTER SYSTEM ON PARAMETER` cho vai không superuser — **lượt soi 39 NHẸ-1 + lượt soi ngang 40a H5; khoản nợ 92, 95** | `row_security = off` KHÔNG phải 0 hàng mà là LỖI ở mọi câu chạm bảng RLS của vai thường (sự cố sẵn sàng, [fix round 4]); `session_replication_role = replica` bỏ qua trigger `ENABLE` thường ⇒ hàm canh không chạy, fail-open (cùng cơ chế hàng 8, lớp `ENABLE ALWAYS` vẫn giữ); `search_path` là che tên (khoản 78) ⇒ câu viết TRẦN rơi vào quan hệ của người khác. Ba mục "… đặt ở mức database" lọc `setrole = 0 AND setdatabase = <db hiện tại>` nên MÙ với cả bốn nguồn trên | **[S1.51]** mục phán xét `CAU_GUC_VAN_HANH_GAN_SAN` ba nhánh — ⒜ CATALOG (`pg_db_role_setting`, trừ đúng hàng ba mục kề sở hữu; không hỏi `source` nên miễn nhiễm ƯU TIÊN NGUỒN, và là nhánh duy nhất phủ `search_path`), ⒝ PHIÊN DEPLOY (`pg_settings`, vế `reset_val` cho nguồn không để lại hàng catalog + vế `setting` cho câu `SET` còn sót — đo: `SET` không đụng `reset_val`), ⒞ dòng khai thiu; so với `GUC_VAN_HANH_DOI` chứ không so `boot_val`. Không tự chữa (`ALTER ROLE ALL RESET` / `ALTER SYSTEM RESET` là SUSET). Cộng HAI phép đọc ở `migrate()`: trước lượt sửa (bỏ qua nguồn `database` để ba mục kề còn chạy được — nếu không, chúng thành mã chết theo ADR-028 §2⑷) và ngay sau lượt sửa (chặn vòng migration đánh số, đòi kết nối mới). Ranh giới đo được: sau khi `search_path` bị ghim thì `source` hoá `session` còn `reset_val` giữ giá trị độc ⇒ BƯỚC 3 không phân biệt được "mức database vừa chữa" với "ALTER SYSTEM", nên ca ấy chặn ở phép đọc TRƯỚC LÚC GHIM, và chỉ với bốn nguồn áp cho MỌI phiên (conf, ALTER SYSTEM, dòng lệnh, biến môi trường, ALTER ROLE ALL) — `rolconfig` của vai deploy cố ý đứng ngoài, `[CR1]`/`[Minor]` ghim rằng migrate() chạy được dưới search_path thù địch. **[S1.51 / lượt soi 44 CAO-1]** thêm phép chụp hàng mức database TRƯỚC và SAU lượt sửa: một hàng mức database mang GIÁ TRỊ ĐÚNG là biện pháp giảm nhẹ hợp lệ đang CHE một độc ở tầng thấp hơn, và lượt sửa gỡ nó vô điều kiện ⇒ gỡ được hàng nào thì deploy DỪNG và đòi kết nối mới. Ba tên được xét theo TÍNH CHẤT (`mau`), không theo chuỗi: `local` hợp lệ như `origin`, và `search_path` ~~chỉ đòi "không schema lạ đứng TRƯỚC `public`"~~ **[S1.52 / khoản 95]** — bản ấy nhận cả `public, pg_catalog`, tiền đề cướp đã đo (`lower('ABC')` ra `CUOP`) — nay: `pg_catalog` chỉ ở vị trí ĐẦU, trước `public` chỉ `pg_catalog` rồi `"$user"`; `pg_catalog`, `""`, `pg_catalog, pg_temp`, `"$user"`, `pg_catalog, "$user"` được nhận; `row_security` nhận mọi cách viết TRUE vì `proconfig` lưu nguyên chữ (đo). **[S1.52]** thêm nhánh ⒟ `pg_parameter_acl` (`ALTER SYSTEM` trên ba tên; `SET` chỉ trên tham số SUSET, suy từ `pg_settings.context`) và nhánh ⒠ `proconfig` của hàm lược đồ dự án. ~~Ranh giới: thân hàm `set_config(…, false)` ghi vào phiên người gọi và phiên giữ nguyên sau khi trả về (đo) — khoản 96~~ **[S1.54]** đường ấy có lớp — hàng 28 | `db/migrations.int.test.ts` `[khoản nợ 92]` (mười bốn vế) và `[khoản nợ 95]` |
| 27 | Chủ bảng chịu RLS sau FORCE mà không policy PERMISSIVE nào phủ VAI CHỦ ở một lệnh chủ còn quyền — ví dụ bảng có policy chỉ `TO app_api` — **lượt soi 42 NẶNG-3; khoản nợ 94** | sau khi khoản 91 FORCE mọi bảng RLS, SELECT/UPDATE/DELETE của chủ bảng và của mọi vai thừa kế quyền chủ bảng trả 0 hàng KHÔNG LỖI (cùng cơ chế hàng 4/6), INSERT ném; 83⑵ chỉ soi tập vai ứng dụng nên không thấy | **[S1.53]** mục phán xét `CAU_PHU_LENH_CHU_BANG_SAI` — mọi bảng bật RLS và FORCE của lược đồ dự án (tenant hay không), trừ extension, trừ chủ superuser/BYPASSRLS, và **[lượt soi 46]** trừ bảng CON của một cha bật RLS (đi qua cha; cha vẫn bị soi; DML thẳng lên lá là ranh giới nói ra); với mỗi lệnh chủ bảng CÒN QUYỀN phải có policy PERMISSIVE mà danh sách vai là PUBLIC hay chứa một vai chủ bảng có quyền của nó (`pg_has_role … 'USAGE'`). Mức bảo đảm là trạng thái TẠI LƯỢT PHÁN XÉT — gỡ policy, backfill 0 hàng rồi dựng lại trong cùng một lượt thì lượt phán xét xanh. Ngoài phạm vi, nói ra: USING của bảng tenant khi chưa gắn tổ chức ([INV-F1] fail-closed có chủ đích); RESTRICTIVE đã khai loại chủ bảng; `OWNER TO` một vai BYPASSRLS (cần superuser); ~~vai chạy migration không thừa kế chủ — khoản 97~~ **[S1.56]** vai chạy migration nay là chủ thể thứ hai của mục — `current_user` của phiên phán xét khi RLS áp cho nó theo gương `check_enable_rls` (không superuser, không BYPASSRLS, không phải chính chủ, và bảng FORCE hay vai không thừa kế chủ), có USAGE lược đồ, ở SELECT/UPDATE/DELETE — INSERT ném nên đứng ngoài (đo: 0 hàng không lỗi; hồ sơ N2 migrate() NÉM); ngoài phạm vi, nói ra: ~~mục phán xét SAU vòng đánh số nên backfill 0 hàng của chính lượt đã ghi checksum — khoản 100~~ **[S1.57 / khoản 100]** chủ thể này nay còn được HỎI TRƯỚC vòng đánh số: thân câu tách thành `CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI` (một bản, trả `ten`, `duong` — đường tới quyền — và `tu_sua_duoc`), và khi còn tệp chưa áp, lượt `truoc_vong` của hardening RAISE SQLSTATE TP100 nên `migrate()` từ chối trước khi tệp nào chạy (đo: hồ sơ N2 với một backfill đang chờ — bản S1.56 ghi tệp là đã áp mà hàng không đổi; bản này tệp còn chờ, chạy dưới superuser thì áp đủ hàng). Lượt ấy bỏ qua dòng mà một migration dưới chính vai ấy sửa được — thừa kế hay tự lấy được quyền chủ bảng, tự cắt được đường tới quyền (lượt soi 50 NẶNG-1: chặn cả chúng là ngõ cụt ADR-028 §3; đo bốn đường trên PostgreSQL 16) — và không hỏi trước chủ thể chủ bảng, vì lối ra của nó là chính một migration. Ranh giới: backfill trên các dòng không hỏi trước vẫn có thể bị tiêu, hai thông điệp sau vòng nói ra. `migrate()` còn so vai cuối mỗi tệp với vai mở vòng trong giao dịch của tệp: lệch thì ROLLBACK, từ chối, huỷ kết nối; tệp đổi vai rồi tự RESET ROLE thì phép so không thấy, còn lớp tĩnh cấm cách viết thẳng của câu đổi vai trong migration của kho; ~~policy tenant TO PUBLIC tính là phủ vai deploy dù không gắn tổ chức, ồn chỉ nhờ EXECUTE của hàm ngữ cảnh — khoản 101~~ **[S1.58 / khoản 101]** policy PHỤ THUỘC `app_current_org_id()` (`pg_depend`) thôi tính là phủ vai chạy migration có EXECUTE trên hàm ấy mà RLS không coi là chủ (migrate() không gắn tổ chức nên vị từ lọc hết), ở cả lượt hỏi trước vòng lẫn lượt phán xét sau vòng; `tu_sua_duoc` của dòng ấy chỉ tính tự cắt EXECUTE (ba đường, đo từng đường) hay cắt đường tới quyền, lối ra nêu theo từng đường (lượt soi 51); ngoài phạm vi, nói ra: hàm bọc lấy hàm ngữ cảnh; backfill theo tổ chức bằng `SET LOCAL app.org_id` dưới vai deploy thường có EXECUTE nay bị chặn; và vai mà RLS coi là chủ — chủ bảng FORCE hay thừa kế chủ, có EXECUTE (hồ sơ N3, N3′) — là khoản 102, gồm cả kiểm khoá ngoại ban đầu đánh dấu ràng buộc hợp lệ mà không kiểm hàng (đo), sau hai hướng đo và bác (`row_security = off` trong vòng đánh số; chủ tự thu hồi EXECUTE) (khoản 97); ~~policy ngoài `public` không có đường khai ở 83⑴ — khoản 98~~ **[S1.55]** policy ngoài `public` nay khai được kèm lược đồ (khoản 98, hàng 7) | `db/rls-coverage.int.test.ts` describe `[S1.53 / khoản nợ 94]` (bốn `it`) |
| 28 | Mã của lược đồ dự án GHI ba GUC vận hành vào PHIÊN NGƯỜI GỌI — `set_config(…, false)`, `SET`/`RESET` trong thân hàm, `set_config` trong view/DEFAULT/policy/CHECK/BEGIN ATOMIC/trigger WHEN, hay `UPDATE pg_settings` — **lượt soi 45 NHẸ-2; khoản nợ 96** | phiên người gọi Ở LẠI giá trị sau khi hàm hay biểu thức trả về, trên cả kết nối pool (đo): `session_replication_role = replica` bỏ qua trigger `ENABLE` thường VÀ khoá ngoại cho mọi câu sau đó, và vai ứng dụng không tự SET/RESET về origin được (42501); `search_path` là che tên (khoản 78); `row_security = off` là LỖI ở mọi câu chạm bảng RLS | **[S1.54]** mục phán xét `CAU_GUC_VAN_HANH_GAN_SAN` nhánh ⒡ (hằng `CAU_MA_GHI_GUC_VAN_HANH`) — quét văn bản tĩnh theo ba khuôn trên tám bề mặt; khoảng cách giữa token là khoảng trắng hoặc chú thích, tên nguyên văn ở mọi cách trích dẫn (**lượt soi 47 CAO-1 + NẶNG-1**); trừ extension và pg_temp; **và lớp ứng dụng** `withTenant` — khối DO cùng câu với COMMIT chặn commit dưới replica, khối `finally` huỷ kết nối nhiễm (`session_replication_role`, `row_security` theo tính chất; search path hiệu lực so với lúc mở giao dịch). Ranh giới nói ra: tên dựng lúc chạy và cách viết khác của cùng tên (đo); ~~`withTenant` chỉ đỡ giao dịch của chính nó — đường ngoài nó là khoản 99~~ **[S1.59 / khoản 99]** đường ngoài withTenant nay có hai lớp: mỗi lần lấy client của pool có vai từ chối kết nối còn mở giao dịch, `session_replication_role`/`row_security` xấu theo tính chất (kể cả mặc định phiên ở lần lấy đầu) và search path hiệu lực lệch mốc lần lấy đầu — huỷ kết nối, ném `KetNoiNhiemError`; hai bộ dọn nền kết thúc giao dịch bằng cùng khối DO, huỷ kết nối trên mọi lỗi; census kiến trúc khai mọi đường lấy client hay chạy câu trên pool và mọi COMMIT không chặn theo số lượng; ngoài phạm vi, nói ra: lỗi rơi vào lần lấy kế tiếp của kết nối; câu tự commit chạy trọn trước khi lớp lấy client thấy; DDL hay cấu hình nạp lại đổi search path hiệu lực làm mỗi kết nối pool bị huỷ một lần; GUC phiên khác và trạng thái phiên ngoài GUC (đo: ba GUC thời gian IM7 đi theo kết nối) — khoản 104; hàm tự đặt lại origin trước khi trả về; search path nhiễm từ trước giao dịch | `db/migrations.int.test.ts` `[khoản nợ 96]`; `packages/tenancy/src/with-tenant.int.test.ts` describe `[S1.54 / khoản nợ 96]` (tám `it`); `packages/db/src/vai-tro.int.test.ts` describe `[S1.59 / khoản nợ 99]` (tám `it`); `packages/invitation/src/invitation.int.test.ts` describe `[S1.59 / khoản nợ 99]` (ba `it`); `tests/architecture/duong-sql-ngoai-with-tenant.test.ts` |

### 3. Quyết định

⑴ **Bảng ở §2 là NGUỒN, không phải tóm tắt.** Một cơ chế mới (do lượt soi, do đọc release notes
   PostgreSQL) được thêm vào bảng TRƯỚC khi có lớp — với cột *lớp canh* ghi *"chưa có — khoản nợ
   N"*. Bảng không được có hàng nào mà cột ấy để trống.

⑵ **Mọi lớp ở §2 theo khuôn ADR-035:** tập ứng viên lấy từ catalog theo tiêu chí không lách được
   bằng cách viết (`pg_trigger`, `pg_rewrite`, `pg_policy`, `pg_class.relrowsecurity`,
   `pg_class.relkind`), buộc phân loại, đỏ cả hai chiều, và **mỗi tổng điều tra mang đối chứng dương
   của riêng nó** (một đối tượng tạm phải được THẤY) — bài học của lượt soi 21.

⑶ **Test là đủ cho các cơ chế 5–10; sản xuất không đổi.** Cùng lập luận với S1.29: migration là
   đường duy nhất tạo policy/trigger/rule, và CI chặn merge. Ngoại lệ đã có: rule trên bảng chỉ-ghi-thêm
   (S1.31) — vì bảng ấy có thể tồn tại trên một cụm đã deploy mà tệp hardening chạy ở mọi `migrate()`.
   **[S1.35, lượt soi 25a #3]** Mệnh đề *ngoại lệ* bác mệnh đề *đủ* cho mọi cơ chế cùng lớp: một
   RESTRICTIVE `USING (false)` trên `sessions` sau deploy sống qua mọi `migrate()` (đã đo ở `[INV-F1]
   ĐO`, `zz_chan` còn nguyên). Cho tới khi **khoản nợ 81** quyết, đọc ⑶ là *"trong CI là đủ; trên cụm
   đã deploy, 5–10 chưa có lớp"* — không phải *"test là đủ"*.
   **[S1.37 — khoản nợ 81 QUYẾT]** ~~Test là đủ cho các cơ chế 5–10; sản xuất không đổi.~~ Thay bằng một
   TIÊU CHÍ BA VẾ, không bỏ phiếu từng cơ chế — và lượt soi 28 (CAO-1) bắt bản đầu của chính tiêu chí này
   còn bỏ phiếu ngầm (chỉ nêu cơ chế đã có census tĩnh ở test, im lặng về 1, 2, 3 tổng quát, 15, 17–19):
   ⒜ **cơ chế nào mà CHỦ BẢNG hay chủ database không superuser tạo được trên cụm đã deploy VÀ catalog
   phân biệt được TĨNH (khuôn tổng điều tra ADR-035) thì PHẢI có mục hardening — phán xét, ADR-028 §2⑵;**
   ⒝ **cơ chế chỉ phân biệt được bằng NHÂN CHỨNG HÀNH VI** (1, 15, 17, 18, 19 — thân hàm nuốt hay sửa
   hàng; catalog chỉ thấy *một trigger plpgsql*) **không có mục hardening**: lớp của chúng là tổng điều
   tra + nhân chứng ở test, cộng ghim thân hàm CÓ TÊN ở hardening — một giới hạn có địa chỉ (§5), không
   phải một lớp; ⒞ **cơ chế cần superuser thì test là đủ** — và chỉ vế TẠO hàm C/`internal` và tham số
   SUSET (8) nằm ở đây; GẮN hàm C có sẵn thì không (built-in, extension tin cậy `tcn`) — đó là lý do 83⑸. **[S1.42, lượt soi 33b #17]** Hàng 11 (constraint trigger DEFERRED) nằm ngoài cả ba vế: nó là ĐIỀU KIỆN ĐO
   của nhân chứng (cửa sổ COMMIT, S1.33), không phải cơ chế 0-hàng.
   Lý do của ⒜: hardening là lớp DUY NHẤT chạy trên cụm đã deploy, mô hình đe doạ của nó là chủ bảng không
   superuser — cùng lý lẽ S1.31 (hàng 3), S1.34 (hàng 16), S1.36 (hàng 20); *"migration là đường duy
   nhất tạo policy"* chỉ đúng trong CI. Đo trên PostgreSQL 16 dưới `trien_khai` — chủ database, `rolsuper = false`, CREATEROLE — theo hồ sơ [fix round 4 N2] cộng một điều N2 không có: được cho sở hữu `sessions`. Vì sao: dưới N2 nguyên bản bảng bootstrap thuộc superuser và `CREATE POLICY`/`CREATE TRIGGER` trên `sessions` là **42501** (đo) — nhưng mọi bảng do migration tạo SAU bootstrap thuộc vai deploy, nên mô hình đe doạ đúng là *chủ bảng không superuser* (lượt soi 28 NẶNG-2). Chủ bảng tạo được: policy RESTRICTIVE `USING (false)` trên `sessions` (5); bảng mới bật RLS + FORCE, GRANT `app_api`, không policy ⇒ UPDATE dưới `app_api` **0 hàng** (6); RLS trên bảng ngoài tenant (7); VIEW, MATERIALIZED VIEW, bảng phân mảnh (10); trigger gọi hàm built-in `suppress_redundant_updates_trigger()` — không cần tạo hàm (21); extension TIN CẬY `tcn` (mang hàm trigger C) cài được, `moddatetime` không tin cậy (42501); trigger plpgsql `RETURN NULL` trên `sessions` (1/15); RULE `DO INSTEAD NOTHING` trên `sessions` (3); `DISABLE TRIGGER` (9); `NO INHERIT` (22). `migrate()` — dưới superuser VÀ dưới chính `trien_khai` — đi qua với tất cả những thứ ấy còn nguyên. Cần superuser, đo ở mọi cửa: `CREATE FUNCTION … LANGUAGE internal` (42501); extension không tin cậy `file_fdw` (42501); `session_replication_role` — `SET`, `ALTER ROLE app_api SET`, `ALTER ROLE trien_khai SET` (chính mình, không vướng ADMIN OPTION), `ALTER DATABASE … SET`, `ALTER SYSTEM`, `GRANT SET ON PARAMETER` đều 42501; `trien_khai` không thuộc `pg_write_all_data`/`pg_signal_backend`/`pg_read_server_files`. `CREATE EXTENSION plperl` qua được kiểm tra quyền (không 42501 — extension tin cậy) và gãy 58P01 vì image thiếu `libperl.so`: chưa cài thành công, suy ra cài được trên image có thư viện. Ngôn ngữ có sẵn: `c`, `internal` (không tin cậy), `plpgsql`, `sql` (tin cậy). Ca thay-thế-theo-tên trên bảng CÓ TÊN thì hardening hôm nay ĐÃ bắt: `DROP POLICY sessions_tenant_isolation` ⇒ `migrate()` NÉM ([CR1]: *không có policy PERMISSIVE nào*); đổi tên `sessions` rồi `CREATE VIEW sessions` ⇒ NÉM 4 mục (ghim hàm/trigger có tên). Lỗ nằm ở đối tượng MỚI và ở thứ thêm vào bảng có tên mà [CR1] không đếm (policy thừa, rule, trigger lạ).
   **Hệ quả:** **khoản nợ 83** — tám mục phán xét, PHÂN LOẠI theo tính chất chứ không ghim tên (lượt soi
   28 NẶNG-3): policy thuộc đúng một lớp (5, 7); phủ lệnh (6); `relkind` v/m/f (10); `prolang` (21); rule
   = rỗng trên mọi quan hệ dự án (3 tổng quát); hàm canh hình dạng gắn ngoài BEFORE-ROW (2/khoản 75); RLS
   ngoài tenant trừ khai (7); `pg_parameter_acl` rỗng cho vai ứng dụng (tiền đề SUSET của 8 — hardening
   chưa ghim). 9 đã có mục từ S1.36; 22 ở khoản 82; 8 có lớp ENABLE ALWAYS Ở HARDENING (không phải ở test
   — lượt soi 28 NHẸ-5) và tiền đề của nó vào 83⑻. Giá: danh sách khai nguyên văn sống ở hardening và test
   đòi hai bản khớp — một policy mới là ba thay đổi; biểu thức khai nguyên văn ở hardening ⇒ đổi phiên bản
   PostgreSQL có thể chặn deploy tới khi chép lại biểu thức (§4 hôm nay chỉ nhận giá ấy ở test) — nói ra.

### 4. Cái giá, nói ra

- ~~**Bốn danh sách khai mới** (29 policy RESTRICTIVE, 1 bảng RLS ngoài tenant, 0 quan hệ khác bảng
  thường, 19 hàm trigger INSERT thêm vào danh sách KHÔNG-CANH).~~ **[S1.42]** Hardening nay mang ~~TÁM~~ **[S1.48 / 40b #8] MƯỜI MỘT** danh
  sách khai, bản test giữ cùng danh sách và một cổng đòi hai bản khớp: ~~ba~~ bốn có hàng (`POLICY_RESTRICTIVE_KHAI`
  tám biến thể của 027, `POLICY_KHAC_KHAI` một, `BANG_RLS_NGOAI_TENANT_KHAI`, `BANG_TENANT_KHAI` 29 tên [S1.43]), ~~năm~~ bảy rỗng có meta-test sentinel
  (`QUAN_HE_KHAC_KHAI`, `TRIGGER_NGOAI_PLPGSQL_KHAI`, `RULE_KHAI`, `KE_THUA_KHAI`, `BANG_ORG_ID_NGOAI_PUBLIC_KHAI`, `BANG_KHOA_NGOAI_TENANT_KHAI` [S1.46], `GUC_TUY_BIEN_KHAI` [S1.47]);
  cộng ở test: `HAM_KHONG_PHAI_CANH`, `RULE_DA_KHAI`, `LOAI_DA_KHAI`. Một policy `<bảng>_khach` mới cho một bảng mới là **hai** thay đổi — migration
  và một dòng khai — cố ý, như ADR-035 §4 đã nói cho nhãn test.
- **Biểu thức policy khai NGUYÊN VĂN `pg_get_expr`.** Đổi phiên bản PostgreSQL có thể đổi cách
  deparse (khoảng trắng, ngoặc) ⇒ đỏ ồn ào chứ không xanh im lặng; sửa bằng cách chép lại biểu thức
  mới sau khi đọc nó. Đó là chỗ *"rỗng ruột"* của một lời khai được cố ý đổi lấy sự chắc chắn. **[S1.38, ghi
  ở S1.42]** Giá ấy nay trả ở cả hardening: đổi deparse chặn deploy tới khi chép lại biểu thức — cố ý.
- **Bảng §2 là một lời khai về tính đầy đủ**, và không cơ giới hoá được. Thứ giữ nó khỏi thiu là ⑴:
  mỗi phát hiện mới phải đi qua bảng này trước.

### 5. Thứ ADR này KHÔNG làm

Nó không chứng minh danh mục đầy đủ — và **lượt soi 22 đã chứng minh điều đó ngay trong vòng viết ADR**:
bản đầu có 14 hàng, lượt soi thêm hai (15, 16). Nó biến câu hỏi *"còn cơ chế nào không?"* từ một
điều bất ngờ ở lượt soi kế thành một hàng phải thêm vào một bảng có địa chỉ — và một hàng mới mà không
có lớp là một khoản nợ mở, nhìn thấy được ngay trong ADR ~~(hàng 16 hôm nay là một)~~. **[S1.33]** Lượt soi 23
thêm hàng 17, 18 — lần thứ hai liên tiếp một lượt soi thêm hàng vào danh mục, và lần này cả hai hàng
có lớp ngay trong vòng. Thứ đáng ghi: hàng 17 nằm ở khoảng cách giữa hai con số của cùng PostgreSQL
(`rowCount` đếm trước AFTER trigger, `n_tup_*` đếm hàng thật) — một cơ chế chỉ nhìn thấy khi hỏi
*"con số này đếm cái gì, và ở lúc nào"*. **[S1.34]** Hàng 16 đóng; lượt soi 24 không thêm hàng mới
mà thêm một **tiền đề** vào lớp của hàng 16 (CREATE ON DATABASE) — nhắc rằng cột *lớp canh* phải nêu
cả thứ lớp ấy tựa vào. **[S1.35]** Lượt soi 25 — lượt NGANG đầu tiên, trên sáu vòng đã hợp nhất — thêm
BỐN hàng (19–22), cả bốn chưa có lớp — ba khoản nợ: 80 (hàng 19), 79 (hàng 20–21), 82 (hàng 22) — và sửa một hàng sai ngữ nghĩa (13: `ALTER TABLE … NO
INHERIT` không ném). Đã xét, KHÔNG thêm — ghi để danh mục là nguồn cả cho cái đã loại: `INSERT …
RETURNING` bị policy `FOR SELECT USING (false)` lọc ⇒ 42501 ồn ào (đo); schema trùng tên superuser cho
`poolAs` của test ⇒ mục *quan hệ trùng tên* của hàng 16 bắt, `"$user"` theo `current_user` (đo);
MERGE/COPY/`ON CONFLICT … WHERE`/`SKIP LOCKED`/timeout thuộc câu lệnh hay ném (hàng 12–14); statement
trigger xoá lại qua transition table — ⒞′ bắt ở mức bảng; `session_replication_role = replica` — hàng 8.
Lần thứ ba liên tiếp một lượt soi thêm hàng, và lần này là bốn: danh mục lớn theo số GÓC NHÌN đã đọc
nó, không theo số vòng. **[S1.36]** Hàng 20 và 21 đóng (khoản 79) — và phép đo của vòng đóng lộ một kẽ
CÙNG CƠ CHẾ với hàng 20 ở một chỗ khác: chốt TRUNCATE (bảng ⑶ của S1.20) cũng nhận `WHEN`, và TRUNCATE
đi lọt. Không thêm hàng — cùng cơ chế, khác vị trí — nhưng cột *lớp canh* của hàng 20 nay nêu cả chốt
TRUNCATE. Hàng 21 đóng với một giới hạn nói ra: lớp chỉ ở test, ~~chờ khoản 81~~ **[S1.37]** 81 quyết: mục hardening
`prolang` là khoản 83; và §3⑶ nay là một tiêu chí ba vế — cơ chế 1, 15, 17–19 (chỉ đo được bằng nhân chứng) là giới hạn
có địa chỉ của danh mục này: chủ bảng thường gắn được trigger plpgsql `RETURN NULL` lên `sessions` và `migrate()` đi
qua (đo). Danh mục không hứa lớp sản xuất cho chúng; nó hứa nói ra. **[S1.38]** Hàng 5, 6, 7 có lớp sản xuất
(khoản 83 nửa RLS) — ba mục phán xét, và câu phán xét của hardening được chạy trong test thay vì chỉ so
văn bản: lần đầu một lớp CI và một lớp cụm-đã-deploy đo bằng CÙNG một câu SQL trên cùng một fixture.
**[S1.39]** Khoản 83 đóng trọn: hàng 10, 21 có lớp; hàng 2, 3, 8 thêm lớp sản xuất cho phần trước đây chỉ ở test.
~~Tiêu chí §3⑶ nay thực hiện trọn — mọi hàng của danh mục mà catalog phân biệt được đều có mục hardening;
1, 15, 17–19 là giới hạn nhân chứng đã nói thẳng.~~ **[S1.42, lượt soi 31 INFO-6 / 33b #4]** khi ấy hàng 22 còn ở khoản 82 (đóng S1.40) và cửa sổ tạo-và-tách ở khoản 85 (đóng S1.41) — câu "trọn" đúng từ S1.41. **[S1.40]** Hàng 22 có lớp (khoản 82⑴, mục phán xét tiền
đề) — và lượt soi 31 chỉ ra câu *thực hiện trọn* của S1.39 nói khi 82 còn mở: hàng 22 đã được §3⑶ đặt ở
khoản 82, cái catalog phân biệt được ở đó là tiền đề, không phải cơ chế. Cùng vòng, khoản 84 (`LA_CUA_BANG_TENANT`
đệ quy) đóng lỗ RÒ cháu hai bậc ngoài public; ba kẽ của lượt 31 cùng đổ về một bậc tự do đã ghi từ vòng fix 3
— khoản 85, mở thay vì tiếp tục *nói ra*. **[S1.42, lượt soi ngang 33a]** Ba phép đo: ⑴ `ALTER DATABASE … SET app.org_id`
bởi CHỦ database không superuser ⇒ **42501** trên PostgreSQL 16 ~~(placeholder GUC chỉ superuser đặt được ở mức database)~~ **[S1.47]** vai được `GRANT SET ON PARAMETER` cũng đặt được (đo) —
~~đường "mặc định phiên cho mọi kết nối app_api" thuộc vế ⒞, test là đủ~~ **[S1.47]** có mục sản xuất, hàng 23 ở §2 (S1.48); ba mục GUC mức database ghim tên và `withTenant`
không đặt lại GUC khách ở phiên thường là khoản 87. **[S1.47] Khoản 87 đóng:** mục phán xét theo tính chất "GUC tuỳ biến (tên có dấu chấm) gắn sẵn cho phiên ứng dụng" — năm nhánh (mức database; vai kết nối/ALTER ROLE ALL; chính phiên deploy đọc thẳng giá trị trên tập tên policy/hàm đọc — vì placeholder không có ở `pg_settings`, đo; `pg_parameter_acl`; `proconfig` hàm), không tự RESET (chủ database thường 42501, RESET ALL dưới vai thường giữ im lặng placeholder — đo; `GRANT SET ON PARAMETER` cho vai thường đặt được — đo, nên câu "chỉ superuser" ở trên là nói quá trên PG15+); `withTenant` từ chối phục vụ trước `fn` khi một trong bốn GUC đã có giá trị lúc mở giao dịch (mặc định phiên) và xoá ba GUC khách trong mọi giao dịch. Ba mục kề không thấy hàng `ALTER ROLE ALL` — khoản 92. ⑵ Sổ kiểm toán khai theo TÊN: `RENAME` bảng sổ + `DROP` bốn trigger +
`CREATE TABLE audit_events (LIKE …)` cùng hình dạng + policy đúng khuôn + `DROP POLICY audit_events_khach` trên bảng cũ ⇒
`migrate()` **đi qua**, D2 dựng ~~sáu~~ bốn trigger lên bảng mới rỗng, lịch sử nằm ở bảng cũ không mục nào canh — khoản 89 **[S1.43] đóng ở ADR-037** (bản đầu
không xoá policy sót thì 83⑴ bắt, nhờ danh sách khai theo tên). ⑶ Khoản 86 có số **[S1.43 nửa đo được, S1.46 nửa gốc — đóng]**: `RENAME COLUMN org_id TO to_chuc` +
`DISABLE ROW LEVEL SECURITY` + xoá hai policy trên `users` ⇒ `migrate()` đi qua, app_api gắn A đọc thấy B. Hai phép đo ⑵⑶
cùng một bài học: danh tính đối tượng neo theo TÊN/HÌNH DẠNG chứ không theo `oid` — cùng lớp bài học 31 #1. **[S1.41]** Khoản 85 đóng bằng một mục phán xét (bảng `org_id` ngoài public,
ngoài tập tenant, không RLS ⇒ khai) — kề với 83⑶ theo `relrowsecurity`, không nới vị từ tenant; hàng 22 nay có
lớp cho cả cửa sổ *tạo-và-tách giữa hai deploy* ở mức "phát hiện ở deploy kế" — mức bảo đảm của mọi mục phán
xét, nói ra. Ranh giới còn lại theo TÊN CỘT `org_id` (ở mọi schema) thành khoản 86.

## ADR-037 — Danh tính của đối tượng được canh không phải là tên hay hình dạng: ba kênh — chú thích neo theo `oid`, tên đã khai kèm migration khai sinh, hình dạng sổ

**Ngày:** 2026-09-10 · **Trạng thái:** Đã chấp nhận · **[S1.43]** · **Khoản nợ liên quan:** 89 (đóng), 86 (~~nửa đo được đóng; nửa gốc còn mở~~ **[S1.46]** đóng trọn — nửa gốc bằng đường tính chất, mục khoản 86) ·
**Liên quan:** ADR-028 (suy từ tính chất; §2⑵ tự chữa chỉ khi đơn điệu), ADR-036 (danh mục 0-hàng), lượt soi ngang 33 (33a #5/#6), lượt soi 34/35

### 1. Vì sao ADR này tồn tại

Lượt soi ngang 33 đo hai đường đi qua **mọi** lớp của hardening trên PostgreSQL 16 sạch:

- `ALTER TABLE audit_events RENAME TO audit_events_cu; DROP TRIGGER …` ×4; `CREATE TABLE audit_events (LIKE … INCLUDING
  ALL)` + RLS + policy đúng khuôn + GRANT; `DROP POLICY audit_events_khach ON audit_events_cu` ⇒ `migrate()` **đi qua**,
  D2 dựng ~~sáu~~ bốn trigger lên bảng mới rỗng, lịch sử nằm ở bảng cũ mà không mục nào canh — khoản 89.
- `ALTER TABLE users RENAME COLUMN org_id TO to_chuc; DISABLE ROW LEVEL SECURITY; DROP POLICY` ×2 ⇒ `migrate()` **đi qua**,
  app_api gắn tổ chức A đọc thấy hàng của B — đường đo của khoản 86.

Cả hai đi qua vì lớp nào cũng nhận diện đối tượng bằng thứ chủ bảng **tái tạo được**: `BANG_CHI_GHI_THEM` là hai cái tên,
`VI_TU_BANG_TENANT` là một hình dạng (cột `org_id` ở public). Bản đầu chặn được (83⑴ bắt policy sót) chỉ vì một danh
sách khai theo tên *khác* còn nhắc tới bảng cũ — thêm một `DROP POLICY` là hết.

### 2. Quyết định

Danh tính của một bảng được canh là **ba kênh**, mỗi kênh chịu một đường tấn công, không kênh nào là "nguồn duy nhất":

| kênh | mang gì | ai ghi | chịu đường nào |
|---|---|---|---|
| ① chú thích bảng `neo: <schema>.<bảng> org_id#<attnum>` (`pg_description`, `objsubid = 0`) | danh tính theo **oid của bảng và attnum của cột `org_id`** — sống qua RENAME / SET SCHEMA / RENAME COLUMN, mất khi DROP, **không** được `CREATE TABLE (LIKE … INCLUDING ALL)` chép, được `pg_dump` chép theo bảng | lượt sửa của hardening (chủ bảng), chỉ khi bảng **chưa có** chú thích nào; WARNING khi tên đã khai nhận neo mới | ⑴ mang neo mà tên hiện tại lệch (đối chiếu catalog, không parse chú thích — kèm oid đang giữ tên đã neo); ⑵ mang neo mà hết là tenant theo tính chất; ⑵′ cột `org_id` hiện tại không phải cột đã neo (đổi tên cột rồi thêm cột mới DEFAULT — lượt soi 35 NẶNG-5) |
| ② tên đã khai trong kho: `BANG_TENANT_KHAI` (29 tên kèm **migration khai sinh**), `BANG_CHI_GHI_THEM` cho sổ | danh tính theo **tên**, sống trong git, không cần quyền, không mất theo đối tượng; chỉ phán khi migration khai sinh đã áp (tập rút gọn đi qua) | người viết migration; cổng ở `rls-coverage` đòi bản khai **bằng** tập theo tính chất trên lược đồ thật và mỗi dòng trỏ đúng migration `CREATE TABLE` | ⑸ tên không còn phân giải; ⑹ tên còn mà hết là tenant theo tính chất — kể cả **chép bảng bỏ cột `org_id` rồi đè tên** (lượt soi 34 NẶNG-3, dữ liệu không mất); ⑶ tên còn mà chưa mang neo |
| ③ hình dạng **không bỏ được mà còn giá trị**: bộ ba cột chuỗi (`seq`, `prev_hash`, `hash`) ngoài `public.audit_events`; bộ ba mốc neo (`seq`, `hash`, `anchored_at`) ngoài `public.audit_chain_anchors` | nhận diện **bản sao sổ / bản sao mốc neo** ở bất kỳ tên/schema nào — bản đầu dùng "đủ 15 cột" và bị lượt soi 35 CAO-1 lách bằng một `RENAME COLUMN user_agent`; bộ ba chuỗi thì bỏ là hết giá trị sổ | — | ⑷ ⑷′ đổi tên rồi dựng lại, hay chép |

Một mục hardening (S1.43): lượt SỬA ghi neo ① cho bảng tenant theo tính chất và bảng sổ chưa có chú thích (đơn điệu:
chỉ thêm, không bao giờ xoá); lượt PHÁN XÉT ~~sáu vế ⑴–⑹~~ **[S1.48 / 40b #7]** tám vế ⑴⑵⑵′⑶⑷⑷′⑸⑹. Chú thích bảng của bảng tenant/bảng sổ là **kênh dành riêng**
— migration muốn chú thích thì chú thích cột.

### 3. Bị bác trước khi chọn — bản đầu của vòng, và vì sao

Bản đầu neo `oid` vào một bảng `app_private.neo_danh_tinh` do migration 049 tạo và gieo. Bộ test bác nó trước cả lượt
soi: **12 test đỏ** dưới hồ sơ N2 (bootstrap bằng superuser, vai deploy `trien_khai` không superuser, không GRANT thêm) —
`to_regclass('app_private.…')` ở cột điều kiện ném 42501 vì vai deploy không có USAGE trên `app_private`, và cả lượt sửa
gãy trước vòng migration đánh số (đúng ngõ cụt QT1 mà 003 từng đo với `to_regprocedure`). Lượt soi 34 bác tiếp ba điều
mà kể cả sửa quyền cũng không đóng: **chìa nằm cạnh ổ khoá** (bảng neo do chính chủ thể bị canh sở hữu — DROP nó là
mục im, `UPDATE oid` là im); **khôi phục logic** (`pg_dump | psql`) cấp oid mới cho mọi bảng nhưng giữ dữ liệu bảng neo
⇒ mọi dòng neo lệch đúng lúc DR; **tự gỡ dòng tenant** là hành động không đơn điệu (ADR-028 §2⑵) và mở đường chép bảng.
Ba kênh ở §2 không có ba lỗi ấy: ① được dump theo bảng, không cần quyền, không có "bảng neo" để xoá; ② sống trong git;
③ không tựa vào gì ngoài catalog.

### 4. Đo bằng gì

**[S1.49 / khoản 93] Tên các hằng của lớp này:** lượt SỬA là `CAU_NEO_SUA` (ghi neo cho bảng phải neo mà chưa có chú thích nào — đơn điệu, ADR-028 §2⑵); lượt PHÁN XÉT là `CAU_NEO_SAI` với tám vế ⑴⑵⑵′⑶⑷⑷′⑸⑹; `VI_TU_PHAI_NEO` là tập phải neo (bảng tenant theo tính chất ∪ hai bảng sổ).

`db/migrations.int.test.ts` (97 → 101): [khoản nợ 89] đúng kịch bản 33a #5 — NÉM ở ⑴ (nêu tên cũ, oid bảng lạ) và ⑷,
kể cả sau khi xoá policy sót (83⑴ im), sau khi gỡ chú thích (⑴ im, ⑷ còn; lượt sửa ghi-lấp neo cho bảng cũ dưới tên
hiện tại — nói ra) và sau khi đổi tên một cột phụ của bản sao (bộ ba chuỗi vẫn bắt); đối chứng đổi lại + đặt lại chú
thích ⇒ đi qua. [khoản nợ 86 — nửa đo được] đổi tên cột ⇒ ⑵+⑹; đổi tên bảng ⇒ ⑴+⑸; đổi tên cột rồi **thêm cột
`org_id` mới DEFAULT A** + policy đúng khuôn ⇒ ⑵′ (attnum), lỗ rò thật tới khi deploy sửa; **chép bảng bỏ `org_id` đè
tên** ⇒ ⑹; đối chứng ⇒ đi qua. [N2 nhánh 4] cụm bootstrap trước S1.43 + vai deploy không sở hữu ⇒ GÃY đúng ⑶ nêu lối
ra; chủ bảng chạy một lần ⇒ vai deploy đi qua. [ranh giới] bảng tenant không khai DROP + dựng lại đi qua; chú thích khác chiếm chỗ ⇒ ⑶; bản sao sổ ở
schema khác ⇒ ⑷; tập rút gọn 001/002 chỉ phán tên của migration đã áp. `rls-coverage` (30 → 31): hai bản khớp (bản khai theo TÊN TỆP migration — khớp tiền tố ba chữ số bị test viết
migration tạm `003_policy_…` bác, đo) + câu phán xét chạy trong test (đổi tên cột ⇒ ⑵⑹; thêm cột `org_id` mới ⇒ ⑵′).
Bốn đột biến đỏ cô lập: phán xét no-op; lượt sửa no-op; bỏ ⑹; bỏ ⑷. Bốn test N2 và mọi tập rút gọn xanh.

### 5. Ranh giới nói thẳng, và khoản nợ

- ① mạnh bằng quyền sở hữu bảng: chủ bảng cố ý gỡ chú thích thì lượt sửa ghi-lấp (kèm WARNING cho tên đã khai) và
  ⑴⑵⑵′ im — còn lại ②③; ③ giữ tới khi chủ bảng phá chính bộ ba chuỗi của bản sao (dữ liệu còn, nhưng không còn là sổ).
  Dưới hồ sơ N2 bảng sổ thuộc superuser nên vai deploy không gỡ được chú thích của sổ — và **cũng không ghi được**
  (lượt soi 35 CAO-2): cụm đã bootstrap trước S1.43 deploy lần đầu bằng vai không sở hữu sẽ GÃY ở ⑶ với lối ra trong
  thông điệp — chạy `migrate()` một lần bằng chủ bảng/superuser; test N2 nhánh 4 ghim hành vi ấy.
- Bảng tenant **không khai** (fixture, bảng tương lai chưa khai) DROP rồi dựng lại cùng tên đi qua — tên không khai thì
  không ai đòi; cổng hai bản khớp buộc migration tạo bảng tenant mới phải khai tên.
- ~~D2/`CTE_TRIGGER_CHAN` (lớp SỬA của sổ) vẫn theo tên: sau đổi tên, trigger được dựng lên bảng giả; lớp PHÁN XÉT chặn
  deploy — chưa đổi lớp sửa sang danh tính~~ (lượt soi 34 #8; ~~khoản 88 kèm~~ **[S1.44]** khoản 88 đóng mà không đổi D2 —
  tách thành **khoản 90**). **[S1.45] Khoản 90 đóng:** `bang_so` của lớp SỬA đòi danh tính NHẤT QUÁN theo kênh ① — ⒜ chú
  thích neo của chính nó (nếu có) nêu tên hiện tại HOẶC nêu `public.<sổ>` (bảng sổ thật bị `SET SCHEMA` vẫn là sổ theo oid —
  giữ [CR2a]; lượt soi 37 CAO-1 bác bản "bằng tên hiện tại"; 40b #6 sửa lời ở đây), ⒝ không quan hệ khác mang neo nêu tên ấy — nên bản sao cùng tên
  không được chữa khi bảng gốc còn giữ danh tính (đo: 0 trigger); ranh giới như ①: chủ bảng gỡ chú thích ⇒ D2 lại chữa bản
  sao, kênh ③ vẫn chặn. Chưa có neo ⇒ vế ⒜ đi qua (deploy đầu, N2). **[S1.48 / 40a I5]** ⒝′: không quan hệ khác mang ĐÚNG chuỗi neo
  của mình — decoy cùng tên ở schema khác chép nguyên neo không còn được chữa (đo test 89 (f)). **[S1.48 / 40a I4 — runbook]** lượt ghi neo
  `COMMENT ON TABLE` lấy ShareUpdateExclusiveLock với `lock_timeout = 0` của `migrate()`: deploy ĐẦU của S1.43 trên cụm sống chờ sau
  một giao dịch dài trên bất kỳ bảng nào trong 31 bảng; khối EXCEPTION chỉ bắt 42501 — lỗi khác thoát khỏi `DO $neo$`, BƯỚC 2 nuốt,
  các bảng còn lại của lượt không được neo, ⑶ chặn lượt ấy và tự lành lượt sau. Chạy deploy đầu lúc vắng.
- Khoản 86 ~~**nửa gốc còn mở**: bảng đa tổ chức *mới* đặt tên cột khác `org_id` không thuộc vị từ nào nên không bao giờ
  được khai hay neo.~~ **[S1.46] Nửa gốc đóng bằng đường TÍNH CHẤT, không nới vị từ tenant:** mục phán xét khoản 86 bắt bảng
  KHÔNG có cột `org_id` nhưng có khoá ngoại MỘT cột — của nó hay của một tổ tiên INHERITS — tới một BẢNG TENANT theo tính chất
  (`MAU_VI_TU_BANG_TENANT` khai triển với bí danh riêng: gốc lẫn bảng có `org_id`; lượt soi 38 A1 bác bản chỉ nhận gốc), ngoài
  tập tenant, không RLS — ở MỌI schema kể cả `public` — phải khai (`BANG_KHOA_NGOAI_TENANT_KHAI`, rỗng). Ba mục 85 / 86 / 83⑶
  rời nhau theo (có `org_id`, có khoá ngoại tới bảng tenant, `relrowsecurity`). Đo: lỗ rò thật ở `k` lẫn `public`, `migrate()`
  NÉM cho cả hai. Mục này cũng độc lập đóng đường đo S1.42 trên `users` (khoá ngoại `to_chuc` vẫn một cột ⇒ kêu kể cả khi
  kênh ①② bị gỡ). Ranh giới: cột uuid trần và khoá ngoại nhiều cột không nhận diện được bằng catalog — DDL cố ý bỏ ràng
  buộc tham chiếu, vế ⒝ §3⑶ ADR-036; khoá ngoại tới bảng đã khai ở 85/86 là bậc kế, vòng khác. Cửa ra "bật RLS ⇒ 83⑶" là cửa
  yếu (không FORCE, view không `security_invoker` vô hình với (C)) — khoản 91.
- Đổi tên/schema/dựng lại một bảng đã khai là việc của migration có chủ ý: cùng migration ấy sửa dòng khai và đặt lại chú
  thích neo — thông điệp lỗi nói đúng câu ấy.

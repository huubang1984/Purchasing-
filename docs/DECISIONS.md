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

**Ngày:** 2026-08-28 · **Trạng thái:** Đã chấp nhận, **có nợ bắt buộc trả trước khi có
endpoint đăng nhập**

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

**Ngày:** 2026-08-29 · **Cập nhật:** 2026-09-04 · **Trạng thái:** ~~**Đang mở** — chặn **S1.4**, **S1.5**~~ **Đã chấp nhận cho mục 1; mục 2 và 3 còn mở nhưng KHÔNG chặn S1.4** · Liên quan: **B2**, **G2**, **A2**

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
2. **Thuật toán chữ ký biên nhận.** B2 đòi nhà cung cấp **kiểm chứng độc lập được**. Điều đó
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
3. **Xoay khoá ký.** Biên nhận có giá trị pháp lý lâu hơn vòng đời một khoá. Cần định danh khoá
   trong biên nhận và một chỗ công bố các khoá cũ — cùng bài toán G3, khác đối tượng.

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
- **Ai được sửa chính sách** là một câu hỏi của ADR-016 mục 4 (mã quyền cho route ấy), chưa quyết
  ở đây.

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

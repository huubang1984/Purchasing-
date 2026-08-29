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

## ADR-011 — Định dạng phong bì và chữ ký biên nhận: **CHƯA CHỐT**

**Ngày:** 2026-08-29 · **Trạng thái:** **Đang mở** — chặn **S1.4**, **S1.5** · Liên quan: **B2**, **G2**, **A2**

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

### Còn để mở

1. **Thoả thuận khoá: `X25519` hay `ECDH P-256`, hay cả hai.** Chỉ được chốt **sau** khi có kết
   quả đo Zalo/Android. Đây là ràng buộc thứ tự, không phải sở thích.
2. **Thuật toán chữ ký biên nhận.** B2 đòi nhà cung cấp **kiểm chứng độc lập được**. Điều đó
   loại thẳng một họ giải pháp: **HMAC bằng secret nội bộ KHÔNG thoả B2** — nhà cung cấp không
   kiểm chứng được thứ họ không có khoá. Cần **chữ ký khoá công khai** (Ed25519 là ứng viên đầu),
   khoá công khai của hệ thống phải **công bố được**, và biên nhận phải **tự mô tả**: mang thuật
   toán, định danh khoá, và mọi trường được ký.
3. **Xoay khoá ký.** Biên nhận có giá trị pháp lý lâu hơn vòng đời một khoá. Cần định danh khoá
   trong biên nhận và một chỗ công bố các khoá cũ — cùng bài toán G3, khác đối tượng.

### Rủi ro của việc để mở

Nhỏ hơn ADR-009 nhiều, vì phần **đã ghim** ở trên chính là phần hấp thụ hầu hết chi phí đổi ý.
Rủi ro thật còn lại là **chốt mục 2 dưới áp lực tiến độ** bằng một HMAC "cho nhanh" — nó chạy,
test xanh, và **B2 bị vi phạm trong im lặng** vì không ai thử đóng vai nhà cung cấp đi kiểm
chứng. Cách chặn: test của B2 phải **kiểm chứng bằng khoá công khai một mình**, không được chạm
vào bất cứ thứ gì chỉ máy chủ mới có.

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

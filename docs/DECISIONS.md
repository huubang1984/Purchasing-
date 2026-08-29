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

## ADR-009 — Nhà cung cấp KMS/Vault: **CHƯA CHỐT**

**Ngày:** 2026-08-29 · **Trạng thái:** **Đang mở** — chặn S1.6

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

**Phương án đã cân nhắc.** AWS KMS · Azure Key Vault · HashiCorp Vault.

**Chưa quyết định.** Ba trục còn để mở, và trục thứ ba là trục ít được nói tới nhất:

1. **Nhà cung cấp** — kéo theo mô hình IAM, và ADR-006 (tách quyền giải mã cho `unseal-worker`)
   chỉ cưỡng chế được bằng IAM của hạ tầng đích. Hai quyết định treo này **không độc lập**.
2. **Chủ quyền dữ liệu** — khách hàng FDI có thể đòi vùng lưu trữ khoá cụ thể.
3. **Hiệu năng.** Số đo `local-dev` hôm nay (10.000 lần bọc ≈ 447 ms) là **mốc của mã hoá nội
   bộ**. Adapter thật chậm hơn **nhiều bậc** vì mỗi lần là một lời gọi mạng, và kịch bản mở thầu
   RFQ 50 NCC × 200 hạng mục ≈ 10.000 lần mở khoá **một lượt**. Phải đo lại **trước** khi bắt đầu
   S1.6, không phải sau.

**Hệ quả của việc để mở.** `KeyProvider` giữ một mặt tiền hẹp và mọi lời gọi đi qua nó, nên việc
chốt muộn **không** đòi viết lại — đó là ý đồ của Task 7. Nhưng nó vẫn chặn S1.6, và chừng nào
ADR này còn "Đang mở" thì mọi con số hiệu năng của đường khoá trong hồ sơ đều là số của
`local-dev`, không phải số của sản phẩm.

**Rủi ro.** Chốt muộn dưới áp lực tiến độ dễ dẫn tới chọn theo thứ đang có sẵn thay vì theo yêu
cầu chủ quyền dữ liệu của khách hàng đầu tiên — và đổi nhà cung cấp KMS sau khi đã có khoá thật
của khách hàng là một cuộc di trú, không phải một lần sửa cấu hình.

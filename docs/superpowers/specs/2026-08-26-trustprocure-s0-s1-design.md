# TrustProcure V2 — Thiết kế S0 + S1

> **Trạng thái:** ĐÃ DUYỆT · 2026-08-27
> **Phạm vi:** S0 (Nền móng & Control Plane) + S1 (Sealed Bid Core)
> **Nguồn:** `TrustProcure_V2_Procurement_Control_Intelligence.md` (V2.1)
> **Phương pháp:** ai-eng-os v0.1.0 (Vibe Coding)

---

## 1. Bối cảnh và lý do phân rã

Đặc tả V2.1 mô tả một danh mục 4–5 hệ thống con độc lập chứ không phải một sản phẩm:
Sourcing Engine (mật mã / sealed bid), Governance (chính sách & phê duyệt), Intelligence
(chuẩn hóa dữ liệu, benchmark, TCO), Risk & Graph Analytics, và ERP Integration. Mỗi hệ
thống con có mô hình dữ liệu riêng, hồ sơ rủi ro riêng, và phương pháp kiểm chứng hoàn
toàn khác nhau.

Gộp tất cả vào một đặc tả kỹ thuật sẽ tạo ra tài liệu không ai kiểm chứng được. Vì vậy
toàn bộ V2 được chẻ thành sáu lát cắt dọc, mỗi lát tự chứng minh được giá trị và tự
kiểm chứng được:

| Mã | Sub-project | Nội dung cốt lõi | Rủi ro chi phối |
|---|---|---|---|
| **S0** | Foundation & Control Plane | Repo, docs, hook, CI, đa tổ chức, audit hash-chain, KeyProvider, identity/MFA, outbox | Sai ở đây thì mọi thứ sau phải làm lại |
| **S1** | Sealed Bid Core | RFQ, lời mời, magic link + OTP, phong bì niêm phong, phiên bản báo giá, khóa deadline, mở thầu có thẩm quyền | Cao nhất — mật mã, vòng đời khóa, tranh chấp thời gian, rò rỉ giá |
| **S2** | Evaluation & Award | Đánh giá kỹ thuật, so sánh thương mại, chấm điểm có trọng số, BAFO, đề xuất trao thầu | Logic nghiệp vụ và phân tách nhiệm vụ |
| **S3** | Governance (MVP2) | Policy engine, ma trận phê duyệt, single-source, ngưỡng chi, chia nhỏ đơn hàng, xung đột lợi ích | Cấu hình sai chính sách tạo ra kiểm soát giả |
| **S4** | Data Foundation & Intelligence (MVP3) | Item master, chuẩn hóa, UOM, lịch sử giá, benchmark, supplier score, TCO, risk engine | Chất lượng dữ liệu gốc |
| **S5** | ERP Integration & Enterprise | REST/CSV, Odoo/SAP B1/Bravo/FAST, SSO, đa tiền tệ | Phụ thuộc bên ngoài |

Tài liệu này đặc tả **S0 + S1**. S2 đã được ước lượng (3–4 tuần) và nằm trong phạm vi
MVP1 đã duyệt, nhưng sẽ có đặc tả riêng.

---

## 2. Các quyết định nền tảng đã chốt

| # | Quyết định | Lựa chọn | ADR |
|---|---|---|---|
| 1 | Ngôn ngữ & nền tảng | TypeScript full-stack + PostgreSQL | ADR-001 |
| 2 | Mô hình đe dọa & giữ khóa | Tầng 1+2 — chống người dùng nội bộ + phê duyệt kép theo ngưỡng | ADR-002 |
| 3 | Mô hình triển khai | SaaS đa tổ chức, cô lập bằng Row-Level Security | ADR-003 |
| 4 | Sổ kiểm toán | Chuỗi hash, chỉ ghi thêm, cưỡng chế ở tầng DB | ADR-004 |
| 5 | Ngữ nghĩa thời gian | Đồng hồ Postgres, phán quyết trong transaction, không phụ thuộc scheduler | ADR-005 |
| 6 | Hình dạng hệ thống | Modular monolith + `unseal-worker` tách riêng | ADR-006 |
| 7 | Nơi thực hiện mã hóa | Phía trình duyệt nhà cung cấp, bằng WebCrypto | ADR-007 |
| 8 | Điều kiện hoàn thành | Test tự động theo bất biến + demo E2E kịch bản mục 41 | §7 |

### 2.1. Mô hình đe dọa — nói rõ ranh giới

Hệ thống được thiết kế để chống:

- **Người dùng nội bộ** (Requester, Buyer, Procurement Manager, Finance, Director) xem
  hoặc suy ra giá trước thời điểm mở thầu hợp lệ.
- **Một cá nhân có thẩm quyền đơn lẻ** tự mở thầu RFQ giá trị lớn mà không có người thứ hai.
- **Nhà cung cấp** nhìn thấy nhau hoặc nhìn thấy giá của nhau.
- **Rò rỉ ngang giữa các tổ chức** dùng chung hệ thống.
- **Xóa hoặc sửa dấu vết** sau khi sự việc đã xảy ra.

Hệ thống **không** được thiết kế để chống nhà vận hành nền tảng có toàn quyền hạ tầng.
Đây là lựa chọn có chủ đích (ADR-002). Hệ quả với truyền thông sản phẩm: tuyệt đối không
tuyên bố "kể cả chúng tôi cũng không xem được". Mục 38 của đặc tả đã liệt kê những gì
không được nói; ranh giới này bổ sung vào danh sách đó.

---

## 3. Kiến trúc

### 3.1. Bố cục và điểm bất đối xứng quyền

```text
┌──────────────────────────┬──────────────────────────────────┐
│  web (Next.js)           │  vendor-portal (Next.js)         │
│  người dùng nội bộ       │  nhà cung cấp — magic link + OTP │
└────────────┬─────────────┴───────────────┬──────────────────┘
             │                             │  ciphertext (WebCrypto)
┌────────────▼─────────────────────────────▼──────────────────┐
│  api  (NestJS)                                              │
│  identity · tenancy · audit · rfq · invitation · supplier   │
│  sealed-envelope (CHỈ encrypt/verify) · bidding             │
│  unseal-request (chỉ tạo yêu cầu, không giải mã)            │
│                                                             │
│  IAM:  kms:Encrypt, kms:GenerateDataKey                     │
│  IAM:  ✗ KHÔNG có kms:Decrypt trên khóa RFQ                 │
│  DB :  app_api → ✗ không SELECT được wrapped_private_key    │
└────────────┬───────────────────────────────┬────────────────┘
             │ Postgres (RLS)                │ job đã ký (outbox)
┌────────────▼──────────────┐   ┌────────────▼────────────────┐
│  PostgreSQL               │   │  unseal-worker              │
│  RLS · trigger chỉ-ghi-thêm│◄─┤  IAM: kms:Decrypt (độc quyền)│
│  quyền theo cột           │   │  DB : app_unseal            │
└───────────────────────────┘   │  ✗ không ghi được bảng bid  │
                                └────────────┬────────────────┘
                                             │
                                  ┌──────────▼──────────┐
                                  │  KMS / Vault        │
                                  └─────────────────────┘
```

**Nguyên lý:** không process nào vừa phục vụ web vừa có khả năng giải mã. Ranh giới được
cưỡng chế bởi hai cơ chế độc lập — IAM ở tầng hạ tầng và quyền role ở tầng cơ sở dữ liệu.
Muốn phá lời hứa "không ai xem được giá trước giờ mở" thì phải phá đồng thời cả hai, chứ
không phải tìm một lỗ hổng ở tầng web.

Lý do tách `unseal-worker` thành process riêng ngay từ đầu: đặc tả mục 8 viết
"Decrypt in controlled runtime". Nếu `api` giữ quyền giải mã thì bất kỳ lỗ SSRF hoặc RCE
nào ở tầng web — kể cả trong module không liên quan gì tới đấu thầu — đều trở thành khả
năng đọc toàn bộ báo giá niêm phong của mọi khách hàng. Chi phí tách lúc này khoảng 3–4
ngày; chi phí tách sau khi đã chạy production là rất lớn.

### 3.2. Thiết kế phong bì niêm phong

```text
Khi RFQ chuyển PENDING_APPROVAL → OPEN:
    sinh cặp khóa RFQ (X25519)
    private key ──bọc bằng data key của tổ chức (KMS)──► rfq_key_material.wrapped_private_key
    public key  ──lưu plaintext──────────────────────► gửi kèm mọi lời mời

Khi nhà cung cấp bấm Nộp (chạy trong trình duyệt, WebCrypto):
    content_key ← ngẫu nhiên AES-256-GCM
    ciphertext  ← AES-256-GCM(content_key, {giá, điều khoản, tệp đính kèm})
    wrapped_ck  ← seal(public_key_RFQ, content_key)
    gửi lên máy chủ: { ciphertext, wrapped_ck, nonce, sha256(ciphertext) }

Khi mở thầu (chỉ trong unseal-worker):
    cổng chính sách thông qua → KMS Decrypt → private key (chỉ trong bộ nhớ)
    → mở content_key → giải mã → ghi bảng so sánh
    → xóa private key khỏi bộ nhớ → ghi audit
```

Hệ quả quan trọng: **giá dạng rõ chưa từng tồn tại trong `api` service.** Bất biến "không
ghi giá ra log" trở thành đúng theo kiến trúc chứ không phải đúng nhờ lập trình viên nhớ
không log.

Đây **không phải** zero-knowledge: nhà vận hành vẫn có khả năng giải mã. Phù hợp với mô
hình đe dọa tầng 1+2 (ADR-002).

Ràng buộc sản phẩm kèm theo: nhà cung cấp phải dùng trình duyệt có `crypto.subtle`. Rủi
ro thực tế ở thị trường Việt Nam là webview trong Zalo/Facebook Messenger — xem §8.2.

### 3.3. Mười một module

| Tầng | Module | Trách nhiệm | Phụ thuộc |
|---|---|---|---|
| S0 | `tenancy` | TenantContext; gắn `app.org_id` vào session Postgres | — |
| S0 | `audit` | Sổ sự kiện chuỗi hash; bộ kiểm chứng chuỗi | tenancy |
| S0 | `crypto-keys` | Interface `KeyProvider` (KMS / Vault / local-dev); bọc & mở bọc | tenancy, audit |
| S0 | `identity` | Tổ chức, người dùng, vai trò, quyền, phiên, MFA (TOTP) | tenancy, audit |
| S0 | `outbox` | Transactional outbox cho job và thông báo | tenancy |
| S1 | `supplier` | Sổ nhà cung cấp mức Level 0/1 | tenancy, audit |
| S1 | `rfq` | Gói RFQ, hạng mục, máy trạng thái | identity, audit |
| S1 | `invitation` | Magic link, OTP, phiên khách | rfq, supplier, audit |
| S1 | `sealed-envelope` | Vòng đời khóa RFQ, định dạng phong bì, biên nhận | crypto-keys, audit |
| S1 | `bidding` | Nộp báo giá, phiên bản, khóa theo deadline | sealed-envelope, invitation |
| S1 | `unseal` | Yêu cầu mở, cổng chính sách, phê duyệt kép, worker | sealed-envelope, identity, audit |

Mỗi module có đúng một mặt tiền công khai (`index.ts`); module khác chỉ được import qua
đó và không bao giờ truy cập trực tiếp bảng của module khác. Quy tắc này được cưỡng chế
bằng dependency-cruiser trong CI (§6, tầng T0).

---

## 4. Mô hình dữ liệu

### 4.1. Bảng thuộc S0 + S1

```text
S0  organizations · users · roles · permissions · role_permissions · user_roles
    sessions · mfa_credentials
    audit_events · outbox_events

S1  suppliers · supplier_contacts
    rfq_packages · rfq_items · rfq_invitations · rfq_invitation_tokens
    rfq_key_material
    vendor_bids · vendor_bid_versions · bid_receipts
    unseal_requests · unseal_approvals
```

Đây là tập con của mục 26 trong đặc tả. Các bảng còn lại (`price_history`,
`risk_events`, `supplier_scores`, `approval_policies`…) thuộc S3/S4 và chưa tạo — tránh
tạo bảng rỗng khi chưa hiểu rõ nghiệp vụ sẽ dùng chúng thế nào.

### 4.2. Cưỡng chế ở tầng cơ sở dữ liệu

Đây là chỗ cố ý **không** tin vào tầng ứng dụng:

| Bảng | Cưỡng chế | Chống điều gì |
|---|---|---|
| mọi bảng có `org_id` | Row-Level Security theo `current_setting('app.org_id')` | Lập trình viên quên `WHERE org_id = ?` |
| `vendor_bid_versions` | Trigger `RAISE EXCEPTION` khi UPDATE/DELETE | Sửa lén báo giá đã nộp |
| `audit_events` | Trigger tương tự + `REVOKE UPDATE, DELETE` khỏi mọi role ứng dụng | Xóa dấu vết |
| `rfq_key_material` | Quyền theo cột: `app_api` chỉ SELECT được `public_key` | `api` tự giải mã |
| `rfq_packages.deadline_at` | Kiểm tra trong cùng transaction ghi báo giá, có khóa hàng | Tranh chấp quanh giờ đóng |

Hai role cơ sở dữ liệu tách biệt: `app_api` và `app_unseal`. Không role nào bao trùm role
kia.

### 4.3. Máy trạng thái RFQ

```text
DRAFT ──► PENDING_APPROVAL ──► OPEN ──► CLOSED ──► UNSEALED ──► EVALUATING ──► ...
   │             │              │
   └─────────────┴──────────────┴──► CANCELLED
```

| Chuyển | Điều kiện bắt buộc |
|---|---|
| `DRAFT → PENDING_APPROVAL` | Có ≥ 1 hạng mục; `deadline_at` ≥ now + cửa sổ tối thiểu theo cấu hình; số nhà cung cấp được mời đạt ngưỡng chính sách |
| `PENDING_APPROVAL → OPEN` | Phê duyệt hợp lệ. **Cặp khóa RFQ chỉ sinh tại đúng thời điểm này** — không sớm hơn, để khóa không tồn tại trong lúc RFQ còn có thể bị sửa |
| `OPEN → CLOSED` | Tự động theo deadline, hoặc đóng sớm thủ công có lý do và audit |
| `CLOSED → UNSEALED` | Chỉ đi qua `unseal-worker`, sau khi cổng chính sách thông qua |
| `CLOSED → OPEN` | **Không tồn tại.** Không có đường quay lại |

### 4.4. Ngữ nghĩa thời gian

Đây là chỗ hầu hết hệ thống đấu thầu làm sai, nên được đặc tả tường minh:

1. **Nguồn thời gian duy nhất là `now()` của Postgres**, đánh giá bên trong transaction
   INSERT báo giá, kèm khóa hàng trên `rfq_packages`. Không tin đồng hồ trình duyệt,
   không tin đồng hồ máy chủ ứng dụng.
2. **Job đóng RFQ không phải cơ chế chặn.** Nó chỉ đổi trạng thái để hiển thị. Nếu
   scheduler chết hoặc chạy trễ 30 phút thì vẫn không ai nộp được, vì việc chặn nằm ở
   ràng buộc trong transaction. Tính đúng đắn không bao giờ được phụ thuộc vào một tiến
   trình nền chạy đúng giờ.
3. **Quy tắc biên tường minh:** transaction commit trước `deadline_at` là hợp lệ, sau là
   không. Không khoan dung vài giây, không xử lý theo thứ tự đến.
4. **Gia hạn chỉ được phép khi RFQ đang OPEN**, phải có lý do, phải audit, phải thông báo
   mọi nhà cung cấp đã mời. Không thể rút ngắn deadline sau khi đã có báo giá.

---

## 5. Ba mươi tư bất biến nghiệp vụ

Chi tiết đầy đủ kèm ánh xạ sang tầng test: `docs/TEST-PLAN.md`.

Nguyên tắc: hệ thống không được kiểm chứng bằng tỷ lệ dòng code được phủ, mà bằng tập
mệnh đề phải luôn đúng — nếu sai thì sản phẩm mất lý do tồn tại.

| Nhóm | Chủ đề | Số bất biến |
|---|---|---|
| A | Bí mật giá | 6 |
| B | Bất biến & toàn vẹn | 5 |
| C | Thời gian | 5 |
| D | Thẩm quyền & phân tách nhiệm vụ | 5 |
| E | Danh tính nhà cung cấp & magic link | 6 |
| F | Cô lập tổ chức | 3 |
| G | Vòng đời khóa | 4 |

Bất biến đáng lo nhất là **A4** — không trường phái sinh nào được rò rỉ giá trước mở
thầu. Nó không bị vi phạm bởi tấn công mà bởi thiện chí: một lập trình viên thêm nhãn
"đã có 3/5 báo giá, thấp nhất dưới ngân sách" vì nghĩ đang giúp người dùng, và phá toàn
bộ Blind Bid mà không ai nhận ra. Vì vậy A4 được cưỡng chế bằng bộ quét tự động (§6, T2)
chứ không bằng review thủ công.

---

## 6. Kiến trúc kiểm thử

| Tầng | Nội dung | Chạy khi |
|---|---|---|
| **T0** | Cổng tĩnh: typecheck, lint, quét bí mật, audit phụ thuộc, **kiểm tra ranh giới module** | Mọi commit |
| **T1** | Unit & property-based (fast-check): mật mã, token, chuỗi hash, policy engine, máy trạng thái | Mọi commit |
| **T2** | Contract/API: OpenAPI là nguồn sự thật + **bộ quét rò rỉ tự động** | Mọi commit |
| **T3** | Integration với Postgres thật (Testcontainers): RLS, trigger, quyền cột, tranh chấp đồng thời | Mọi PR |
| **T4** | E2E Playwright trên trình duyệt thật | Mọi PR |
| **T5** | **Bộ test đối kháng** — mỗi bất biến có ít nhất một test cố tình tấn công | Mọi PR |
| **T6** | Phi chức năng: tải quanh deadline, lệch đồng hồ, khôi phục thảm họa | Hằng đêm |

Hai cơ chế là điểm khác biệt thật của kế hoạch này:

**T0 — test kiến trúc chạy như lint.** Một quy tắc dependency-cruiser cấm mọi file trong
`apps/api/` import client giải mã của KMS. Nếu ai đó — người hay AI — viết code cho `api`
gọi `kms.decrypt()`, CI đỏ ngay tại commit, trước cả khi có người review. Ranh giới bảo
mật quan trọng nhất được canh gác bằng máy, không bằng trí nhớ.

**T2 — bộ quét rò rỉ tự động.** Thay vì viết test cho từng endpoint (và chắc chắn sẽ
quên endpoint mới), test này gieo dữ liệu với giá trị dễ nhận (ví dụ `1234567891`), gọi
**mọi** endpoint trong OpenAPI dưới danh nghĩa Buyer với RFQ chưa mở, rồi quét toàn bộ
phản hồi — kể cả bên trong chuỗi, kể cả trong tệp CSV xuất ra — tìm dấu vết các con số
đó. Tìm thấy là đỏ. Đây là cách duy nhất cưỡng chế được A1 và A4 mà không phụ thuộc vào
việc lập trình viên nhớ.

### 6.1. Evidence Pack

Mỗi lần CI chạy sinh `evidence/INV-matrix.md`: bảng ánh xạ **34 bất biến → test nào phủ
→ kết quả → commit sha → thời điểm**. Bất biến không có test phủ làm CI đỏ.

Giá trị kép. Về kỹ thuật, nó ngăn bất biến bị bỏ quên khi hệ thống lớn lên. Về kinh
doanh, khi kiểm toán viên của khách hàng hỏi *"làm sao chứng minh nhân viên mua hàng
không xem được giá trước giờ mở?"*, câu trả lời là bảng này kèm lịch sử chạy, thay vì một
lời hứa. Mục 37 của đặc tả đặt North Star Metric là *Verified Competitive Spend*; chữ
**Verified** chính là bảng này.

---

## 7. Điều kiện hoàn thành

S0 + S1 được coi là xong khi **tất cả** các mục sau đúng:

1. Toàn bộ 34 bất biến có ít nhất một test phủ, và `evidence/INV-matrix.md` không còn
   dòng nào ở trạng thái chưa phủ.
2. Bảy tầng T0–T6 chạy trong CI; T0–T5 chặn merge khi đỏ.
3. Kịch bản mục 41 chạy trọn vẹn end-to-end trên trình duyệt thật: RFQ 1 tỷ, 5 nhà cung
   cấp, có sửa giá trước deadline, đóng thầu, mở thầu có phê duyệt kép, sinh bảng so sánh.
4. Kịch bản nhà cung cấp khách (Level 0) chạy trọn vẹn: nhận link → OTP → nộp → nhận biên
   nhận kiểm chứng được.
5. Hai hook `git-safety` và `protect-secrets` đã được viết lại, **có test chứng minh
   chúng chặn thật**, và fail-closed khi gặp lỗi.
6. `security-reviewer` đã chạy trên toàn bộ hạng mục chạm mật mã, xác thực, PII, hoặc cô
   lập tổ chức, và mọi phát hiện mức CRITICAL/HIGH đã được xử lý.
7. `docs/STATE.md` phản ánh đúng trạng thái thật, đã đối chiếu với code.

---

## 8. Rủi ro

### 8.1. Hook đang fail-open — CHẶN S0.1

Kiểm chứng thực tế ngày 2026-08-26 trên máy phát triển:

```text
$ echo '{"tool_input":{"command":"git reset --hard HEAD~1"}}' | sh git-safety.sh
git-safety.sh: line 4: jq: command not found
exit=0        ← CHO QUA
```

`jq` không có trên máy. Cả hai script đọc JSON bằng `jq` ở dòng 4, lỗi làm biến rỗng,
`grep` không khớp, `exit 0` nghĩa là **cho phép**. Kết quả: `git reset --hard` không bị
chặn, ghi đè `.env` không bị chặn — trong khi người dùng tin là đã được bảo vệ.

Đây là dạng lỗi tệ nhất trong thiết kế kiểm soát: hàng rào giả. Không có hàng rào thì
người ta còn cẩn thận; có hàng rào hỏng thì người ta thôi cẩn thận. Nó minh họa đúng bài
học trung tâm của chính TrustProcure — biện pháp kiểm soát chỉ có giá trị khi được kiểm
chứng, không phải khi được khai báo.

Ba lỗi độc lập, phải sửa cả ba:

1. **Phụ thuộc `jq` không được khai báo** → viết lại bằng Node (đã có sẵn), bỏ hẳn phụ
   thuộc ngoài; đồng thời chạy được trên Windows, đúng cảnh báo trong README của plugin.
2. **Không fail-closed** → thiếu `set -euo pipefail`; mọi lỗi đều thành "cho qua". Phải
   đảo lại: không phân tích được đầu vào thì chặn.
3. **Bộ pattern quá hẹp** (README cũng thừa nhận) → `git-safety` bỏ sót `checkout -- .`,
   `branch -D`, `filter-branch`, `stash clear`, `reflog expire`; `protect-secrets` bỏ sót
   `.p12`, `.pfx`, `.jks`, `.keystore`, `id_ed25519`, `.npmrc`, `.pgpass`, và cả
   `~/.claude/settings.json` vốn đang chứa token API dạng rõ.

### 8.2. WebCrypto trong webview — rủi ro sản phẩm, không phải chi tiết kỹ thuật

Ở Việt Nam, lời mời báo giá thường được chuyển tiếp qua Zalo hoặc Messenger, và nhà cung
cấp mở link ngay trong webview của ứng dụng đó thay vì trình duyệt thật. `crypto.subtle`
chỉ khả dụng trong ngữ cảnh bảo mật và một số webview hạn chế nó.

Nếu điều này xảy ra ở khách hàng pilot, nhà cung cấp không nộp được báo giá — và đó là
lỗi giết chết tỷ lệ tham gia, thứ mà mục 10 của đặc tả coi là ràng buộc sản phẩm then
chốt.

Bắt buộc phải có: dò tìm khả năng ngay khi mở trang, thông điệp hướng dẫn rõ ràng bằng
tiếng Việt kèm nút mở bằng trình duyệt ngoài, và đo tỷ lệ gặp phải trong pilot. Phương án
dự phòng mã hóa phía máy chủ chỉ được cân nhắc sau khi có số liệu thật, vì nó làm suy yếu
tính chất "giá dạng rõ không tồn tại trong `api`".

### 8.3. Ước lượng gốc lạc quan

Đặc tả mục 31 đặt MVP1 là 6–8 tuần và gộp cả Technical/Commercial Evaluation, BAFO, Final
Sealed Offer, Award Recommendation. Theo phân rã này, riêng S0+S1 đã chiếm 6–6,5 tuần và
S2 thêm 3–4 tuần.

**MVP1 như đặc tả mô tả thực tế cần 9–11 tuần.** Ước lượng gốc không tính chi phí của
những thứ vô hình mà lại là toàn bộ giá trị sản phẩm: chuỗi kiểm toán chống giả mạo, vòng
đời khóa, phê duyệt kép, cô lập tổ chức, và bộ test đối kháng.

Quyết định đã chốt ngày 2026-08-27: **giữ trọn phạm vi, chấp nhận 9–11 tuần.**

### 8.4. Chi phí và độ trễ KMS

Mở thầu một RFQ có 50 nhà cung cấp × 200 hạng mục sinh ra số lượng thao tác giải mã đáng
kể. Phải đo ở S0.4 khi xây `KeyProvider`, không để phát hiện ở S1.6 khi đã muộn.

### 8.5. Chưa có khách hàng pilot

Rủi ro lớn nhất không nằm ở kỹ thuật mà ở chỗ xây đúng thứ theo sai thứ tự. Mục 40 của
đặc tả đã nêu tiêu chí chọn pilot. Nên tiếp cận song song ngay từ S0, không đợi có sản
phẩm.

---

## 9. Phân rã công việc

### S0 — Nền móng · khoảng 2,5 tuần

| Mã | Hạng mục | Ngày | Skill / Agent |
|---|---|---|---|
| S0.1 | Khởi tạo repo, monorepo pnpm, **viết lại 2 hook sang Node kèm test**, dựng `docs/`, CI tầng T0, bảy ADR | 2,5 | `architecture-decision` → `feature` |
| S0.2 | Tenancy: TenantContext, RLS trên toàn bộ bảng | 2 | `feature` → security-reviewer |
| S0.3 | Audit chuỗi hash + bộ kiểm chứng + quyền DB | 3 | `feature` → **security-reviewer** |
| S0.4 | `KeyProvider`: interface + adapter KMS/Vault/local-dev + đo hiệu năng | 2 | `architecture-decision` → `feature` |
| S0.5 | Identity: tổ chức, người dùng, vai trò, quyền, phiên, MFA TOTP | 4 | `feature` → **security-reviewer** |
| S0.6 | Transactional outbox + job runner | 2 | `feature` |
| S0.7 | Bộ khung test: Testcontainers, fixtures, sinh INV-matrix | 2 | qa-engineer |

### S1 — Sealed Bid Core · khoảng 4 tuần

| Mã | Hạng mục | Ngày | Skill / Agent |
|---|---|---|---|
| S1.1 | Sổ nhà cung cấp mức Level 0/1 | 2 | `feature` |
| S1.2 | RFQ, hạng mục, máy trạng thái đầy đủ điều kiện chuyển | 4 | `feature` → qa-engineer |
| S1.3 | Lời mời, magic link, OTP, phiên khách | 4 | `feature` → **security-reviewer** |
| S1.4 | Phong bì niêm phong: vòng đời khóa, định dạng, mã hóa WebCrypto phía nhà cung cấp | 5 | `architecture-decision` → **security-reviewer** |
| S1.5 | Nộp báo giá, phiên bản, biên nhận, khóa theo deadline | 4 | `feature` → qa-engineer |
| S1.6 | Mở thầu: cổng chính sách, phê duyệt kép, worker, giải mã | 5 | `architecture-decision` → **security-reviewer** |
| S1.7 | Bảng so sánh sau mở thầu | 2 | `feature` |
| S1.8 | Hoàn thiện bộ đối kháng T5 + evidence pack | 3 | qa-engineer + security-reviewer |
| S1.9 | E2E kịch bản mục 41 | 2 | qa-engineer |

### Vòng lặp bắt buộc cho từng hạng mục

```text
đọc docs/STATE.md, đối chiếu với code thật
   → /ai-eng-os:feature   (hoặc /architecture-decision nếu chạm kiến trúc)
   → viết test cho bất biến liên quan TRƯỚC
   → implement
   → qa-engineer      : chạy và bổ sung test còn thiếu
   → security-reviewer: BẮT BUỘC nếu chạm mật mã, xác thực, PII, cô lập tổ chức
   → code-reviewer
   → cập nhật docs/STATE.md và INV-matrix
```

---

## 10. Ngoài phạm vi tài liệu này

Đã cân nhắc và cố ý loại khỏi S0+S1:

- Đánh giá kỹ thuật, BAFO, đề xuất trao thầu — thuộc S2, nằm trong MVP1 nhưng có đặc tả riêng.
- Supplier Passport đầy đủ (Level 2) — chỉ làm Level 0/1 theo mục 10.
- Reverse auction — mục 23, thuộc S5.
- Toàn bộ Intelligence: item master, chuẩn hóa, benchmark, TCO, supplier score, risk engine — S4.
- Policy engine tổng quát và ma trận phê duyệt cấu hình được — S3. S0+S1 chỉ làm đúng phần
  chính sách cần cho mở thầu: ngưỡng giá trị và phê duyệt kép.
- Tích hợp ERP — S5.
- Đa tiền tệ, đa ngôn ngữ, SSO — Enterprise.

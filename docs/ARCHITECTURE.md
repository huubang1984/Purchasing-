# ARCHITECTURE — TrustProcure V2

> Tài liệu sống. Mô tả kiến trúc **hiện tại**. Lý do đằng sau mỗi quyết định nằm ở
> `docs/DECISIONS.md`; thiết kế đầy đủ ở
> `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md`.
>
> **Trạng thái triển khai: chưa có mã nguồn.** Tài liệu này mô tả kiến trúc mục tiêu của
> S0+S1 đã được duyệt. Cập nhật lại khi thực tế lệch khỏi thiết kế.

---

## 1. Ngăn xếp công nghệ

| Lớp | Công nghệ |
|---|---|
| Giao diện nội bộ | Next.js (App Router) |
| Cổng nhà cung cấp | Next.js — mã hóa bằng WebCrypto phía trình duyệt |
| API | NestJS |
| Worker mở thầu | NestJS (process riêng) |
| Cơ sở dữ liệu | PostgreSQL — RLS, trigger, quyền theo cột |
| Quản lý khóa | AWS KMS / HashiCorp Vault (qua interface `KeyProvider`) |
| Test | Vitest · fast-check · Testcontainers · Playwright · k6 |
| Quản lý mã | pnpm workspace (monorepo) |

## 2. Bố cục hệ thống

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

**Bất đối xứng quyền là điểm cốt lõi.** Không process nào vừa phục vụ web vừa có khả năng
giải mã. Ranh giới được cưỡng chế bởi hai cơ chế độc lập: IAM ở tầng hạ tầng, quyền role
ở tầng cơ sở dữ liệu. Chi tiết lý do: ADR-006.

**Xác thực nhà cung cấp — ràng buộc kênh.** Từ 2026-08-29 đây là một **trigger**, không phải một
quy ước: `otp_kiem_kenh_khac_link` ở `010_invitations.sql` so kênh của thách thức OTP với
`rfq_invitations.link_channel` và từ chối khi hai kênh trùng nhau. Cố ý KHÔNG viết thành
`CHECK (channel <> 'EMAIL')`: cách ấy giữ bất biến bằng một **sự trùng hợp** về việc hôm nay link
đi bằng email, và sẽ vẫn xanh vào ngày ai đó cho phép gửi link qua SMS. OTP **không bao giờ** đi
cùng kênh với magic link:
hai yếu tố trên một hộp thư chung không phải hai yếu tố. Kênh mặc định của S1 là SMS, Zalo ZNS là
kênh thay thế cấu hình được, và giới hạn tần suất chạy trên Postgres — không thêm thành phần hạ
tầng. Chi tiết: ADR-015.

## 3. Cấu trúc thư mục

```text
apps/
  web/                  Next.js — giao diện nội bộ
  vendor-portal/        Next.js — cổng nhà cung cấp
  api/                  NestJS — API chính (KHÔNG có quyền giải mã)
  unseal-worker/        NestJS — runtime mở thầu có kiểm soát
packages/
  tenancy/              TenantContext, tích hợp RLS
  audit/                Sổ chuỗi hash, bộ kiểm chứng
  crypto-keys/          Interface KeyProvider và các adapter
  identity/             Tổ chức, người dùng, vai trò, quyền, phiên, MFA
  outbox/               Transactional outbox
  supplier/             Sổ nhà cung cấp Level 0/1
  rfq/                  Gói RFQ, hạng mục, máy trạng thái
  invitation/           Magic link, OTP, phiên khách
  sealed-envelope/      Vòng đời khóa RFQ, định dạng phong bì, biên nhận
  bidding/              Nộp báo giá, phiên bản, khóa deadline
  unseal/               Yêu cầu mở, cổng chính sách, phê duyệt kép
db/
  migrations/           Migration SQL — RLS, trigger, quyền role
evidence/
  INV-matrix.md         Sinh tự động bởi CI
docs/
```

Mỗi package có đúng một mặt tiền công khai `index.ts`. Import xuyên module không qua
`index.ts` bị dependency-cruiser chặn ở tầng test T0.

## 4. Mô hình dữ liệu S0 + S1

```text
S0  organizations · users · roles · permissions · role_permissions · user_roles
    sessions · mfa_credentials
    audit_events · outbox_events

S1  suppliers · supplier_contacts
    rfq_packages · rfq_items · rfq_approvals · rfq_invitations · rfq_invitation_tokens
    invitation_otp_challenges · otp_rate_limits · guest_sessions
    rfq_key_material
    vendor_bids · vendor_bid_versions · bid_receipts
    unseal_requests · unseal_approvals
```

Tập con của mục 26 trong đặc tả. Bảng thuộc S3/S4 chưa tạo.

`suppliers` và `supplier_contacts` là **bảng tenant**, không phải sổ dùng chung toàn hệ thống: một
sổ cho mỗi tổ chức mua, MST là dữ liệu chứ không phải khoá. Trùng lặp xuyên tổ chức được chấp nhận
ở S1; gộp hồ sơ (Level 2) thuộc S3+ và phải mở ADR mới. Chi tiết và hai phép đo chống lưng:
ADR-013.

### 4.1. Cưỡng chế ở tầng cơ sở dữ liệu

| Bảng | Cưỡng chế | Chống điều gì |
|---|---|---|
| mọi bảng có `org_id` | Row-Level Security theo `current_setting('app.org_id')` | Quên `WHERE org_id = ?` |
| `vendor_bid_versions` | Trigger `RAISE EXCEPTION` khi UPDATE/DELETE | Sửa lén báo giá đã nộp |
| `audit_events` | Trigger tương tự + `REVOKE UPDATE, DELETE` | Xóa dấu vết |
| `rfq_key_material` | Quyền theo cột: `app_api` chỉ SELECT `public_key` | `api` tự giải mã |
| `rfq_packages.deadline_at` | Kiểm tra trong transaction ghi báo giá, có khóa hàng | Tranh chấp quanh giờ đóng |
| `rfq_packages.status` | Trigger cấm mọi cạnh ngoài bảng cạnh hợp lệ; `CLOSED → OPEN` không tồn tại | Mở lại RFQ đã đóng (ADR-014) |
| `suppliers`, `supplier_contacts` | `org_id` + `UNIQUE (org_id, tax_code)`; mọi UNIQUE mà `app_api` ghi được đủ cột phải có `org_id` đứng đầu | Oracle xuyên tổ chức qua thông báo lỗi ràng buộc (ADR-013) |
| `supplier_contacts`, `rfq_items`, `rfq_approvals` | Khoá ngoại **HỢP THÀNH** `(org_id, <cha>_id)` | Một hàng con của tổ chức A treo vào hàng cha của tổ chức B — RLS `WITH CHECK` không nhìn thấy ca này, và nó đã được ĐO là đi lọt với khoá ngoại đơn cột |
| `rfq_items` | Trigger `rfq_items_chi_sua_khi_soan` | Đổi đề bài sau khi nhà cung cấp đã đọc danh sách hạng mục |
| `rfq_approvals` | `UNIQUE (org_id, rfq_id, approver_user_id)` + `UNIQUE (org_id, rfq_id, session_id)` + trigger | Một người tự duyệt hai lần; người tạo tự duyệt; mượn phiên của người khác (D2) |
| `rfq_invitation_tokens` | Lưu **hash**, không lưu token; `purpose` là tập đóng; `expires_at`; `revoked_at` | Đọc được DB là chiếm được lời mời (E1) |
| `invitation_otp_challenges` | Trigger `otp_kiem_kenh_khac_link` so kênh OTP với `rfq_invitations.link_channel` | OTP đi cùng kênh với magic link — hai yếu tố trên một hộp thư không phải hai yếu tố (ADR-015) |
| `otp_rate_limits` | Bộ đếm theo cửa sổ, hai loại bucket | E3 vế *giới hạn tần suất* — vế không có một dòng mã nào trong toàn S0 |
| `guest_sessions` | `verified_contact_id` TÁCH khỏi `rfq_invitations.contact_id` | Ghi danh tính người được MỜI thay vì danh tính đã XÁC THỰC (E5) |

Hai role tách biệt: `app_api` và `app_unseal`. Không role nào bao trùm role kia.

## 5. Luồng mật mã

```text
PENDING_APPROVAL → OPEN:
    sinh cặp khóa RFQ (X25519)
    private key ──bọc bằng data key của tổ chức (KMS)──► wrapped_private_key
    public key  ──────────────────────────────────────► gửi kèm lời mời

Nhà cung cấp nộp (trình duyệt, WebCrypto):
    content_key ← ngẫu nhiên AES-256-GCM
    ciphertext  ← AES-256-GCM(content_key, payload)
    wrapped_ck  ← seal(public_key_RFQ, content_key)
    → máy chủ nhận: { ciphertext, wrapped_ck, nonce, sha256(ciphertext) }

Mở thầu (chỉ trong unseal-worker):
    cổng chính sách → KMS Decrypt → private key (chỉ trong bộ nhớ)
    → mở content_key → giải mã → ghi bảng so sánh
    → xóa private key khỏi bộ nhớ → ghi audit
```

Giá dạng rõ chưa từng tồn tại trong `api`. Chi tiết và rủi ro: ADR-007.

## 6. Máy trạng thái RFQ

```text
DRAFT ──► PENDING_APPROVAL ──► OPEN ──► CLOSED ──► UNSEALED ──► EVALUATING ──► ...
   │             │              │
   └─────────────┴──────────────┴──► CANCELLED
```

| Chuyển | Điều kiện |
|---|---|
| `DRAFT → PENDING_APPROVAL` | ≥ 1 hạng mục; deadline ≥ now + cửa sổ tối thiểu; đủ số nhà cung cấp theo chính sách |
| `PENDING_APPROVAL → OPEN` | Phê duyệt hợp lệ; **cặp khóa RFQ sinh tại đúng thời điểm này** |
| `OPEN → CLOSED` | Tự động theo deadline, hoặc đóng sớm có lý do và audit |
| `CLOSED → UNSEALED` | Chỉ qua `unseal-worker` sau khi cổng chính sách thông qua |
| `CLOSED → OPEN` | **Không tồn tại**, và từ 2026-08-29 đây **không còn là một câu văn**: `009_rfq.sql` biến nó thành một `RAISE EXCEPTION` trong `rfq_kiem_chuyen_trang_thai()`, đo bằng `UPDATE` trực tiếp qua `app_api` (bị chặn) cộng một lượt gỡ trigger (cùng câu ấy ĐI LỌT) |

**Cưỡng chế ở đâu (ADR-014).** CSDL giữ bốn thứ: `CHECK` trên tập trạng thái, trigger cấm mọi
cạnh ngoài bảng cạnh hợp lệ, trigger cấm rút ngắn `deadline_at` khi đã có báo giá (C4), và phán
quyết deadline **trong chính transaction ghi báo giá** (C1, và nó là thứ làm C2 đúng). Ứng dụng
giữ những điều kiện CSDL không thấy được: phê duyệt kép (D2), ngưỡng chính sách, chế độ nghiêm
của A6. Trigger chặn **lỗi lập trình**, không chặn một tiến trình `api` đã bị chiếm.

## 7. Ngữ nghĩa thời gian

Nguồn thời gian duy nhất là `now()` của Postgres, đánh giá trong transaction ghi báo giá,
kèm khóa hàng. Job đóng RFQ chỉ đổi trạng thái hiển thị, không phải cơ chế chặn — tính
đúng đắn không phụ thuộc scheduler chạy đúng giờ. Chi tiết: ADR-005.

## 8. Kiểm thử

Bảy tầng T0–T6 với 34 bất biến nghiệp vụ. Chi tiết: `docs/TEST-PLAN.md`.

Hai cơ chế đáng lưu ý ở tầng kiến trúc:

- **T0** chặn `apps/api/**` import client giải mã KMS — canh gác bằng máy, không bằng trí nhớ.
- **T2** quét mọi endpoint trong OpenAPI tìm dấu vết giá đã gieo — endpoint mới tự động
  nằm trong phạm vi quét.

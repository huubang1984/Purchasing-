# infra/terraform — khoá, danh tính và log của TrustProcure trên AWS

Hiện thực của **ADR-062** (khoá tổ chức là cặp khoá P-256; `tp-api` không bao giờ giải mã được)
và **ADR-026 §4** (nơi cất mốc neo nằm ngoài tầm với của role deploy). Phạm vi: KMS, IAM,
CloudTrail, bucket neo. **Chưa có** VPC, ECS, RDS.

## Bảy stack, chạy đúng thứ tự

| Stack | Tài khoản | Profile | Tạo gì | Chạy được khi |
|---|---|---|---|---|
| `00-bootstrap` | management | `tp-mgmt` | Bucket S3 lưu state (state local) | **ngay bây giờ** |
| `10-audit` | audit | `tp-audit` | Bucket CloudTrail, bucket neo (Object Lock COMPLIANCE 365 ngày), role `tp-anchor-writer` | audit được mở lại |
| `20-management` | management | `tp-mgmt` | Permission set `KeyAdmin` (gán `tp-key-admins` cho audit + prod), CloudTrail tổ chức | sau 10 |
| `30-prod-iam` | prod | `tp-prod` | GitHub OIDC; task role `tp-api`, `tp-unseal-worker`, `tp-migrate`, `tp-anchor-job`; `tp-ecs-execution`; `tp-deploy`, `tp-deploy-worker` | prod được mở lại |
| `40-kms-audit` | audit | `tp-audit-keyadmin` | Khoá ký mốc neo `alias/tp-anchor-sign` | sau 10, 20 |
| `50-kms-prod` | prod | `tp-prod-keyadmin` | `alias/tp-org-wrap`, `alias/tp-receipt-sign` | sau 20, 30 |
| `60-canh-bao` | audit + prod | `tp-audit`, `tp-prod` | Cảnh báo email: `PutKeyPolicy` trên khoá KMS của audit/prod; task mang role worker chạy ngoài service `tp-unseal-worker` (prod chuyển sự kiện sang audit) | sau 10, 20 |

Vì sao 40/50 chạy bằng **KeyAdmin** chứ không bằng AdministratorAccess: key policy chỉ cho
KeyAdmin quản trị khoá, và KMS từ chối tạo một khoá mà chính người tạo không quản trị được nữa
(kiểm "policy lockout"). Hệ quả có chủ đích: AdministratorAccess **không** sửa được các khoá này.

Vì sao 30 trước 50: KMS từ chối key policy trỏ tới một role chưa tồn tại.

## Chuẩn bị một lần (Windows PowerShell)

1. Cài Terraform ≥ 1.10: `winget install -e --id Hashicorp.Terraform`, mở PowerShell mới,
   `terraform version`.
2. Thêm profile SSO. Các profile `tp-audit`, `tp-prod`, `*-keyadmin` chỉ tạo được sau khi AWS mở
   lại hai tài khoản và stack 20 đã tạo permission set `KeyAdmin`:
   ```powershell
   aws configure sso --profile tp-audit           # trustprocure-audit / AdministratorAccess
   aws configure sso --profile tp-prod            # trustprocure-prod  / AdministratorAccess
   aws configure sso --profile tp-audit-keyadmin  # trustprocure-audit / KeyAdmin
   aws configure sso --profile tp-prod-keyadmin   # trustprocure-prod  / KeyAdmin
   ```
   Khi được hỏi *SSO session name*, dùng lại `tp`.
3. Mỗi phiên làm việc: `aws sso login --sso-session tp`. Mọi stack đọc/ghi state bằng profile
   `tp-mgmt`, nên cần phiên SSO còn hạn cho cả management.

## Chạy

```powershell
cd infra\terraform\00-bootstrap
terraform init
terraform plan -out plan.tfplan
terraform apply plan.tfplan
```

Các stack còn lại giống hệt, thay tên thư mục. **Đọc `plan` trước mỗi `apply`.**

Trước stack 20, bật một lần:

```powershell
aws organizations enable-aws-service-access --service-principal cloudtrail.amazonaws.com --profile tp-mgmt
```

Lần `terraform init` đầu tiên sinh `.terraform.lock.hcl` trong mỗi thư mục — **commit** các tệp
ấy. Để CI (Linux) và máy Windows dùng chung một lock:

```powershell
terraform providers lock -platform=windows_amd64 -platform=linux_amd64
```

## Kiểm chứng sau khi apply 50 — phép đo ⒜ của ADR-062 (bắt buộc, trước dữ liệu thật)

Chạy trên prod bằng một phiên mang role `tp-api`, rồi `tp-unseal-worker`. Hai role này chỉ
ECS đảm nhận được, nên cách dễ nhất là một task ECS dùng một lần. Kịch bản:

1. `tp-api`: `GenerateDataKeyPairWithoutPlaintext` với `EncryptionContext org_id=thu` ⇒
   **thành công**, nhận `PrivateKeyCiphertextBlob`.
2. `tp-api`: `Decrypt` blob ấy ⇒ **`AccessDeniedException`**.
3. `tp-unseal-worker`: `Decrypt` blob ấy với cùng context ⇒ **thành công**.
4. `tp-unseal-worker`: `Decrypt` **thiếu** context ⇒ **thất bại**.
5. AdministratorAccess và KeyAdmin: `Decrypt` ⇒ **`AccessDeniedException`**.

Bước 3 là đối chứng âm: không có nó, bước 2 "xanh" cả khi khoá bị tắt.

## Rủi ro còn lại — nói thẳng

- **KeyAdmin sửa được key policy**, nên về lý thuyết tự gỡ lệnh `Deny` rồi tự cấp `Decrypt`.
  Không khoá KMS nào tránh được điều này; giảm nhẹ là cảnh báo EventBridge/CloudTrail trên
  `PutKeyPolicy` và có **người thứ hai** giữ KeyAdmin (ADR-062, điều kiện trước dữ liệu thật).
  Cảnh báo ấy là stack `60-canh-bao`: email tới `email_canh_bao` cho mọi `PutKeyPolicy`, thành
  công hay bị từ chối. Truyền địa chỉ bằng `-var email_canh_bao=...` (không commit), rồi **bấm xác
  nhận** thư AWS gửi tới — chưa xác nhận thì chưa có cảnh báo. Người nhận không nên chỉ là người giữ
  KeyAdmin. Kiểm sau apply (đối chứng dương, bắt buộc): bằng KeyAdmin, `aws kms get-key-policy`
  rồi `aws kms put-key-policy` lại ĐÚNG policy ấy trên một khoá của prod ⇒ phải có thư trong vài
  phút. Không có thư thì cảnh báo chưa chạy, dù `apply` xanh.
- **`tp-deploy-worker` PassRole được role của worker**, tức pipeline ấy chạy được một task mang
  quyền `Decrypt`. Tách role + environment `prod-worker` **có duyệt tay** trên GitHub là giảm
  nhẹ; cảnh báo trên task mang role worker ngoài service chính thức là stack `60-canh-bao` ⑵:
  `RunTask`/`StartTask` với họ `tp-unseal-worker` hay ghi đè `taskRoleArn` thành role worker, và
  `RegisterTaskDefinition` gắn role worker vào họ khác. **Quy ước ràng buộc stack ECS sau này:**
  task definition của worker mang họ `tp-unseal-worker`. Kiểm sau apply (đối chứng dương, không
  khởi task nào): `aws ecs run-task --cluster khong-ton-tai --task-definition tp-unseal-worker`
  ⇒ lời gọi lỗi, nhưng CloudTrail vẫn ghi nó kèm `errorCode` ⇒ phải có thư.
- **Bucket neo chặn `s3:PutObjectRetention`** với mọi người: job neo phải ghi object **không**
  kèm header Object Lock, để bucket tự áp thời hạn mặc định 365 ngày. Muốn tăng thời hạn về sau
  phải gỡ statement `KhongXoaKhongDoiKhoa` bằng root của audit (Privileged root actions).
- Các khoá và bucket mang `prevent_destroy`: `terraform destroy` sẽ dừng — đó là chủ đích.
- Secret (`tp/api/*`, `tp/worker/*`…) **không** tạo ở đây: giá trị sẽ lọt vào state. Tạo bằng
  CLI/console; các role chỉ đọc được nhánh của mình.

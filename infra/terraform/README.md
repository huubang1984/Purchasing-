# infra/terraform — khoá, danh tính và log của TrustProcure trên AWS

Hiện thực của **ADR-062** (khoá tổ chức là cặp khoá P-256; `tp-api` không bao giờ giải mã được)
và **ADR-026 §4** (nơi cất mốc neo nằm ngoài tầm với của role deploy). Phạm vi: KMS, IAM,
CloudTrail, bucket neo. **Chưa có** VPC, ECS, RDS.

## Mười stack, chạy đúng thứ tự

| Stack | Tài khoản | Profile | Tạo gì | Chạy được khi |
|---|---|---|---|---|
| `00-bootstrap` | management | `tp-mgmt` | Bucket S3 lưu state (state local) | **ngay bây giờ** |
| `10-audit` | audit | `tp-audit` | Bucket CloudTrail, bucket neo (Object Lock COMPLIANCE 365 ngày), role `tp-anchor-writer` | audit được mở lại |
| `20-management` | management | `tp-mgmt` | Permission set `KeyAdmin` (gán `tp-key-admins` cho audit + prod), CloudTrail tổ chức | sau 10 |
| `30-prod-iam` | prod | `tp-prod` | GitHub OIDC; task role `tp-api`, `tp-unseal-worker`, `tp-migrate`, `tp-anchor-job`; `tp-ecs-execution`; `tp-deploy`, `tp-deploy-worker` | prod được mở lại |
| `40-kms-audit` | audit | `tp-audit-keyadmin` | Khoá ký mốc neo `alias/tp-anchor-sign` | sau 10, 20 |
| `50-kms-prod` | prod | `tp-prod-keyadmin` | `alias/tp-org-wrap`, `alias/tp-receipt-sign`, `alias/tp-totp` (ADR-063) | sau 20, 30 |
| `60-canh-bao` | audit + prod | `tp-audit`, `tp-prod` | Cảnh báo email: `PutKeyPolicy` trên khoá KMS của audit/prod; task mang role worker chạy ngoài service `tp-unseal-worker` (prod chuyển sự kiện sang audit) | sau 10, 20 |
| `70-do-kms` | prod | `tp-prod` | **Dùng một lần** cho phép đo ⒜: VPC tối thiểu, cluster `tp-do-kms`, hai task definition aws-cli mang role `tp-api` / `tp-unseal-worker`. Đo xong thì `destroy` | sau 30, 50 (và 60 nếu muốn đo luôn cảnh báo) |
| `80-ses` | prod | `tp-prod` | Gửi thư thật qua SES (ADR-065): danh tính domain + DKIM, MAIL FROM, configuration set `tp-thu`; quyền `ses:SendEmail` theo đúng một địa chỉ gửi cho `tp-api` và `tp-unseal-worker` | sau 30 |
| `90-ecs` | prod | `tp-prod` | Chạy thật (ADR-066): VPC riêng không NAT + VPC endpoint, RDS PostgreSQL 16, ECR, cluster `tp-prod`, một tên miền trên ALB HTTPS — `/api/*` tới service `tp-api`, còn lại tới service `tp-web` (ADR-068) —, service `tp-unseal-worker`, task `tp-migrate` | sau 30, 50, 80 |

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

Hai role `tp-api` và `tp-unseal-worker` chỉ ECS đảm nhận được, nên phép đo chạy bằng hai task
Fargate dùng một lần — stack `70-do-kms`:

```powershell
cd infra\terraform\70-do-kms
terraform init
terraform plan -out plan.tfplan
terraform apply plan.tfplan
.\chay-do-kms.ps1          # in bảng 18 bước; thoát 0 chỉ khi mọi bước ĐẠT
terraform destroy          # đo xong thì dỡ — CloudTrail tổ chức giữ bằng chứng
```

| Bước | Vai | Lời gọi | Mong đợi |
|---|---|---|---|
| 1 | `tp-api` | `GenerateDataKeyPairWithoutPlaintext`, `org_id=do-kms-<giờ>` | **thành công** — đối chứng dương của task api |
| 2 | `tp-api` | `Decrypt` blob ấy | `AccessDeniedException` |
| 2b | `tp-api` | `GenerateDataKeyPair` (bản CÓ bản rõ) | `AccessDeniedException` |
| 3 | `tp-unseal-worker` | `Decrypt`, đúng context | **thành công** — đối chứng dương của bước 2 |
| 4 | `tp-unseal-worker` | `Decrypt` **thiếu** context | `AccessDeniedException` (key policy đòi `org_id`) |
| 4a | `tp-unseal-worker` | `Decrypt` với `org_id` khác | `InvalidCiphertextException` (context là AAD) |
| 4b | `tp-unseal-worker` | `GenerateDataKeyPairWithoutPlaintext` | `AccessDeniedException` |
| 5a | AdministratorAccess | `Decrypt` | `AccessDeniedException` |
| 5b | KeyAdmin | `Decrypt` | `AccessDeniedException` |
| 6 | `tp-api` | `Encrypt` trên `alias/tp-totp`, context `{org_id, key_version}` | **thành công** (ADR-063) |
| 6a | `tp-api` | `Decrypt` bí mật TOTP, đúng context | **thành công** — api được mở TOTP, và chỉ TOTP |
| 6b | `tp-api` | `Decrypt` TOTP **thiếu** `key_version` | `AccessDeniedException` |
| 6c | `tp-api` | `Decrypt` TOTP với `org_id` khác | `InvalidCiphertextException` |
| 6d | `tp-api` | `Encrypt` TOTP kèm một khoá context lạ | `AccessDeniedException` |
| 6e | `tp-api` | `GenerateDataKey` trên `tp-totp` | `AccessDeniedException` |
| 7 | `tp-unseal-worker` | `Decrypt` bí mật TOTP | `AccessDeniedException` |
| 8a / 8b | AdministratorAccess / KeyAdmin | `Decrypt` bí mật TOTP | `AccessDeniedException` |

Bước 3 là đối chứng âm cho bước 2: không có nó, bước 2 "xanh" cả khi khoá bị tắt. Một bước "bị từ
chối" chỉ ĐẠT khi lỗi đúng TÊN trong bảng — lỗi mạng hay cấu hình sai không được đọc thành "đã
chặn". Không bước nào in bản rõ: mọi `Decrypt` chạy với `--query KeyId`.

Chép nguyên bảng kết quả vào `docs/STATE.md` khoản 15. Nếu stack 60 đã apply, lần apply stack 70
bắn cảnh báo ⑵ (`RegisterTaskDefinition` gắn role worker vào họ `tp-do-kms-worker`) — đó là đối
chứng dương của cảnh báo ấy; không có thư thì cảnh báo ⑵ chưa chạy.

Chi phí: vài phút Fargate 0,25 vCPU và hai IP công khai trong lúc task chạy — không NAT, không
VPC endpoint.

## Gửi thư thật — stack `80-ses` (ADR-065)

```powershell
cd infra\terraform\80-ses
terraform init
terraform plan -var ten_mien=<domain> -out plan.tfplan
terraform apply plan.tfplan
terraform output ban_ghi_dns        # thêm từng bản ghi ở nhà cung cấp DNS
terraform output bien_moi_truong    # giá trị TRUSTPROCURE_SES_* cho api và worker
```

1. Thêm ba CNAME DKIM, MX + SPF của `thu.<domain>`, và DMARC (`p=none` lúc đầu). SES xác minh domain
   khi thấy đủ ba CNAME — xem trạng thái ở console SES hay `aws sesv2 get-email-identity`.
2. **Ra khỏi sandbox**: tài khoản SES mới chỉ gửi tới địa chỉ đã xác minh. Gửi yêu cầu *production
   access* ở console SES (mô tả loại thư: giao dịch — link đăng nhập, lời mời báo giá, OTP; cơ chế
   xử lý bounce: suppression list của configuration set). Chưa được duyệt thì mọi thư tới nhà cung cấp
   thật bị SES từ chối — và job outbox thất bại ỒN ÀO, đúng thiết kế.
3. Đặt biến cho api: `TRUSTPROCURE_SENDER_ADAPTER=ses`, `TRUSTPROCURE_SES_REGION`,
   `TRUSTPROCURE_SES_FROM=<dia_chi_gui>@<domain>`, `TRUSTPROCURE_SES_CONFIGURATION_SET=tp-thu`; cho
   worker: `TRUSTPROCURE_ALERT_ADAPTER=ses`, cùng vùng, `TRUSTPROCURE_SES_FROM=<dia_chi_canh_bao>@<domain>`,
   `TRUSTPROCURE_ALERT_EMAILS`. Khi CẢ HAI tiến trình đã dùng SES thì gỡ `TRUSTPROCURE_ALLOW_DEV_SINKS`.
4. Kiểm (đối chứng dương): một lần `/auth/link` tới hộp thư của chính mình ⇒ phải nhận thư; đổi
   `TRUSTPROCURE_SES_FROM` của api thành địa chỉ cảnh báo ⇒ `AccessDenied` (IAM theo địa chỉ gửi).

**Chưa có:** SMS và Zalo ZNS. Liên hệ khai kênh ấy thì bộ gửi SES NÉM, việc outbox thất bại.

## Chạy thật — stack `90-ecs` (ADR-066)

**1. Bí mật — tạo TRƯỚC khi apply** (giá trị không bao giờ vào state; mật khẩu ≥ 24 ký tự ngẫu nhiên).
Host RDS chưa có ở lần đầu: tạo secret với host tạm rồi `put-secret-value` lại sau bước 3.

```powershell
aws secretsmanager create-secret --profile tp-prod --name tp/api/otp-peppers --secret-string "p1=<base64 32 byte>"
aws secretsmanager create-secret --profile tp-prod --name tp/api/database-url `
  --secret-string "postgres://app_api_login:<mat-khau-api>@<rds-host>:5432/trustprocure"
aws secretsmanager create-secret --profile tp-prod --name tp/worker/database-url `
  --secret-string "postgres://app_unseal_login:<mat-khau-worker>@<rds-host>:5432/trustprocure"
```

**2. Apply hai bước** — HTTPS cần chứng chỉ ACM đã xác minh, mà DNS nằm ngoài AWS:

```powershell
cd infra\terraform\90-ecs
terraform init
terraform apply -var-file prod.tfvars -target aws_acm_certificate.api   # bước A: chỉ chứng chỉ
terraform output ban_ghi_dns                                            # thêm CNAME xac_minh_acm ở DNS
terraform plan -var-file prod.tfvars -out plan.tfplan                   # bước B: phần còn lại
terraform apply plan.tfplan                                             # chờ ACM xác minh rồi tạo ALB
```

`prod.tfvars` (không commit): `ten_mien` (tên miền công khai DUY NHẤT — trang và `/api/*`; `TRUSTPROCURE_PUBLIC_BASE_URL`
và `TRUSTPROCURE_ALLOWED_ORIGINS` của api suy ra từ nó), `anh = { api, worker, migrate, web }` (URI **@sha256:**), `ses = { tu_api, tu_canh_bao, nhan_canh_bao, configuration_set = "tp-thu" }`.
Lần đầu chưa có image trong ECR: apply `-target` các `aws_ecr_repository` trước, đẩy image (bước 4), rồi
mới apply phần còn lại.

**3.** Cập nhật hai secret database-url bằng `terraform output rds_endpoint`; thêm CNAME `cong_khai` (output `ban_ghi_dns`) → ALB.

**4. Build và đẩy image** (từ gốc kho):

```powershell
aws ecr get-login-password --profile tp-prod | docker login --username AWS --password-stdin <ecr>
foreach ($t in "api","worker","migrate","web") {
  $repo = @{ api = "tp-api"; worker = "tp-unseal-worker"; migrate = "tp-migrate"; web = "tp-web" }[$t]
  docker build -f deploy/Dockerfile --target $t -t "<ecr>/${repo}:<git-sha>" .
  docker push "<ecr>/${repo}:<git-sha>"      # ghi lại digest cho prod.tfvars
}
```

**5. Migrate** — `terraform output lenh_chay_migrate`, chạy, đọc `/tp/migrate` trong CloudWatch: phải thấy
`da ap N migration` và hai dòng `vai …`. **Đây cũng là phép đo ADR-061 trên RDS** (vai master RDS không
phải superuser); nếu `migrate()` từ chối, dừng lại và đọc thông điệp — không sửa bằng tay trong CSDL.

**6. Worker:** để `so_ban_worker = 0` tới khi có tổ chức đầu tiên (worker từ chối khởi động khi nguồn tổ
chức trả 0 hàng — ADR-040), rồi đặt 1 và apply.

**7. Kiểm:** `https://<ten_mien>/api/health` ⇒ 200 (ALB bỏ tiền tố `/api`); `https://<ten_mien>/nop-thau` ⇒ 200 kèm
header `content-security-policy`; log `/tp/api` có dòng `khoa: aws-kms, bo gui: ses`, log `/tp/web` có `CHI TINH`.

**Chưa kiểm:** endpoint SES API (`email`) ở vùng này — nếu `plan` báo không có dịch vụ ấy, đổi `ses_endpoint_service`.

## Deploy thường ngày — `.github/workflows/deploy.yml` (ADR-067)

Sau lần chạy tay đầu tiên ở trên (stack 90 cần image có sẵn), mọi lần deploy đi qua pipeline bấm tay.

**Chuẩn bị một lần trên GitHub** (Settings → Environments):

| Environment | Required reviewers | Deployment branches | Biến |
|---|---|---|---|
| `prod` | bật, ít nhất một người | chỉ `master` | `TP_SUBNETS_UNG_DUNG`, `TP_SG_MIGRATE` — lấy từ `terraform output bien_github` (stack 90) |
| `prod-worker` | bật, người duyệt nên khác người bấm | chỉ `master` | không |

Tên environment phải đúng hai chuỗi trên: trust policy của `tp-deploy`/`tp-deploy-worker` (stack 30)
ghim `sub = repo:huubang1984/Purchasing-:environment:<tên>`. Không có secret nào — pipeline lấy quyền
AWS bằng OIDC.

**Chạy:** Actions → *Deploy — prod (bam tay)* → Run workflow trên `master`, chọn `api`, `worker` hoặc
`ca-hai`. Job `build` dựng image không có quyền AWS; job `api` chờ duyệt ở `prod`, đẩy image, chạy
migrate (dừng nếu exit ≠ 0), cập nhật `tp-api` rồi `tp-web`; job `worker` chờ duyệt riêng ở `prod-worker`. Tóm tắt
của run ghi ARN các bản task definition vừa đăng ký. Migrate hỏng ⇒ đọc `/tp/migrate` bằng tay (role
deploy không đọc log).

**Quay lui:** `aws ecs update-service --profile tp-prod --cluster tp-prod --service tp-api --task-definition
tp-api:<bản cũ>` — chỉ lùi image; migration đã chạy KHÔNG lùi theo, nên bản cũ phải chạy được trên schema mới.

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

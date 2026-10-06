# infra/terraform — khoá, danh tính và log của TrustProcure trên AWS

Hiện thực của **ADR-062** (khoá tổ chức là cặp khoá P-256; `tp-api` không bao giờ giải mã được)
và **ADR-026 §4** (nơi cất mốc neo nằm ngoài tầm với của role deploy). Phạm vi: KMS, IAM,
CloudTrail, bucket neo. **Chưa có** VPC, ECS, RDS.

## Mười một stack, chạy đúng thứ tự

**Dựng lần đầu từ tài khoản trống:** làm theo danh sách [`docs/APPLY-LAN-DAU.md`](../../docs/APPLY-LAN-DAU.md) — thứ tự,
bí mật, biến GitHub, các đối chứng dương và những thư cảnh báo dự kiến. Các mục dưới là chi tiết của từng stack.

| Stack | Tài khoản | Profile | Tạo gì | Chạy được khi |
|---|---|---|---|---|
| `00-bootstrap` | management | `tp-mgmt` | Bucket S3 lưu state (state local) | **ngay bây giờ** |
| `10-audit` | audit | `tp-audit` | Bucket CloudTrail, bucket neo (Object Lock COMPLIANCE 365 ngày), role `tp-anchor-writer` | audit được mở lại |
| `20-management` | management | `tp-mgmt` | Permission set `KeyAdmin` (gán `tp-key-admins` cho audit + prod), CloudTrail tổ chức | sau 10 |
| `30-prod-iam` | prod | `tp-prod` | GitHub OIDC; task role `tp-api`, `tp-unseal-worker`, `tp-migrate`, `tp-anchor-job`, **[S1.183]** `tp-khoi-tao`; `tp-ecs-execution`; `tp-deploy`, `tp-deploy-worker` — **[S1.223 / khoản 252 ⑶]** trust policy ghim `sub` TUỲ BIẾN (ID bất biến của kho + `job_workflow_ref`; mục "Tuỳ biến claim `sub`") | prod được mở lại, **và** claim `sub` của kho đã tuỳ biến |
| `40-kms-audit` | audit | `tp-audit-keyadmin` | Khoá ký mốc neo `alias/tp-anchor-sign` | sau 10, 20 |
| `50-kms-prod` | prod | `tp-prod-keyadmin` | `alias/tp-org-wrap`, `alias/tp-receipt-sign`, `alias/tp-totp` (ADR-063) | sau 20, 30 |
| `60-canh-bao` | audit + prod | `tp-audit`, `tp-prod` | Cảnh báo email: `PutKeyPolicy` **[2026-10-02 / khoản 336]** và mọi thao tác ghi khác của KeyAdmin (tắt/bật, hẹn/huỷ xoá khoá, alias, xoay, mô tả, thẻ, tạo khoá) trên khoá KMS của audit/prod; task mang role worker chạy ngoài service `tp-unseal-worker`; job neo `tp-neo` hỏng (ADR-072); 36 giờ không có mốc neo mới trong bucket neo (ADR-073); truy vấn DNS ngoài danh sách trong VPC prod (ADR-076); vận hành — ALB, ECS, RDS của prod vào ALARM hoặc trở về OK (ADR-077), tới hộp thư vận hành riêng `email_van_hanh` (ADR-088); mốc neo theo từng tổ chức — Lambda `tp-canh-moc-neo` ở audit (ADR-086); địa chỉ nhận cảnh báo chưa xác nhận / mất đăng ký / đăng ký lạ — Lambda `tp-canh-dang-ky` ở audit, thư tới cả hai hộp (ADR-089); **[S1.223 / khoản 252 ⑴]** task họ/role `tp-khoi-tao` được chạy hay đăng ký — kể cả ngoài `khoi-tao.yml` — và mọi lần tạo/ghi/sửa/xoá bí mật bản khai `tp/khoi-tao/ban-khai/*` (ADR-130) (prod chuyển sự kiện sang audit) | sau 10, 20 |
| `70-do-kms` | prod | `tp-prod` | **Dùng một lần** cho phép đo ⒜: VPC tối thiểu, cluster `tp-do-kms`, hai task definition aws-cli mang role `tp-api` / `tp-unseal-worker`. Đo xong thì `destroy` | sau 30, 50 (và 60 nếu muốn đo luôn cảnh báo) |
| `80-ses` | prod | `tp-prod` | Gửi thư thật qua SES (ADR-065): danh tính domain + DKIM, MAIL FROM, configuration set `tp-thu`; quyền `ses:SendEmail` theo đúng một địa chỉ gửi cho `tp-api` và `tp-unseal-worker` | sau 30 |
| `85-sms-zalo` | prod | `tp-prod` | Kênh SMS và Zalo ZNS của api (ADR-069): sender ID Việt Nam + configuration set `tp-sms`, quyền `sms-voice:SendTextMessage` từ đúng sender ID ấy; secret `tp/api/zalo-oa` (api Get + Put) | sau 30 |
| `90-ecs` | prod | `tp-prod` | Chạy thật (ADR-066): VPC riêng + VPC endpoint (NAT một AZ CHỈ cho subnet api — ADR-069; DNS Firewall chỉ phân giải một danh sách tên đóng — ADR-076), RDS PostgreSQL 16, ECR, cluster `tp-prod`, một tên miền trên ALB HTTPS — `/api/*` tới service `tp-api`, còn lại tới service `tp-web` (ADR-068) —, header bảo mật (HSTS…) do ALB đặt (ADR-075), alarm vận hành `tp-van-hanh-*` (ADR-077), service `tp-unseal-worker`, task `tp-migrate`, **[S1.183]** task `tp-khoi-tao` (ADR-111) | sau 30, 50, 80 |

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

## Kênh SMS và Zalo ZNS — stack `85-sms-zalo` (ADR-069)

**SMS.** Việt Nam chỉ nhận SMS từ **brandname đã đăng ký**, kèm **mẫu nội dung** đã đăng ký với nhà mạng.
1. Console AWS End User Messaging SMS → *Registrations*: tạo hồ sơ sender ID cho Việt Nam (giấy tờ doanh nghiệp,
   brandname, ba mẫu nội dung — chép NGUYÊN VĂN ba câu trong `apps/api/src/adapters/gui-sms.ts`, phần biến là mã,
   đường dẫn, mốc giờ). Chờ duyệt — tính bằng tuần, không phải phút.
2. `terraform apply -var sender_id=<BRANDNAME>` (thư mục `85-sms-zalo`). Nếu AWS từ chối vì chưa đăng ký xong,
   quay lại bước 1. Output `sms.registered` phải là `true` trước khi bật kênh.
3. Tài khoản mới ở *sandbox* SMS và có trần chi tiêu tháng: xin ra khỏi sandbox và đặt trần trong console.
4. Stack 90: `sms = { danh_tinh_gui = "<BRANDNAME>", configuration_set = "tp-sms" }` trong `prod.tfvars`.

**Zalo ZNS.** Cần Official Account đã xác thực, ứng dụng Zalo liên kết OA, số dư ZNS.
1. Tạo ba template ZNS và chờ Zalo duyệt; tên tham số là hợp đồng với mã: OTP `otp`, lời mời `duong_dan`
   (đường dẫn `https://<ten_mien>/i#…` — Zalo có thể đòi khai báo tên miền), gia hạn `han_nop`.
2. Cấp quyền OA cho ứng dụng (OAuth v4 trên developers.zalo.me) để có **refresh token**.
3. Nạp secret — tệp tạm, xoá ngay sau lệnh:
   ```powershell
   $f = "$env:TEMP\zalo.json"
   [IO.File]::WriteAllText($f, '{"app_id":"<id>","secret_key":"<khoá ứng dụng>","access_token":"","refresh_token":"<refresh token>","het_han_luc":0}')
   aws secretsmanager put-secret-value --profile tp-prod --secret-id tp/api/zalo-oa --secret-string "file://$f"
   Remove-Item $f
   ```
   **[S1.252]** ~~`Set-Content -Encoding utf8 zalo.json`~~ — Windows PowerShell 5.1 ghi `-Encoding utf8` KÈM BOM, và `api` từng
   từ chối secret ấy (*"secret Zalo: không phải JSON"* — kênh Zalo chết). `WriteAllText` ghi UTF-8 không BOM; `api` nay cũng bỏ
   một BOM ở đầu (`kho-token-zalo.ts`). Tệp ở `$env:TEMP`, không trong thư mục kho: nó mang khoá ứng dụng và refresh token.
   Từ đó `api` tự làm mới token và ghi lại. Refresh token dùng MỘT lần: đừng thử nó bằng tay sau khi nạp.
4. Stack 90: `zalo = { template_otp, template_invitation, template_deadline }` trong `prod.tfvars`.

**Kiểm:** mời một nhà cung cấp khai kênh SMS/Zalo; log `/tp/api` không có `GuiKenhError`/`ZaloTokenMatError`.
`ZaloTokenMatError` nghĩa là token đã xoay mà không ghi được vào secret — cấp lại refresh token (bước 2–3).

**[ADR-076] Lọc tên miền.** SMS đi qua VPC endpoint `sms-voice` (tạo khi `sms` khác null); chỉ Zalo đi qua NAT. DNS Firewall
của VPC chỉ phân giải `local.ten_duoc_phan_giai` ở stack 90 (endpoint AWS đang dùng, bucket lớp ECR, bucket neo, RDS, hai tên
Zalo) — mọi tên khác NXDOMAIN, ghi `/tp/dns`, alarm `tp-dns-bi-chan` ⇒ email ⑸ của stack 60 (60 bắt theo TÊN — apply trước hay sau 90 đều được).
- Thêm một đích ngoài mới: thêm tên vào danh sách (và URL hằng vào adapter — `hinh-dang-dns.test.ts` đòi hai bên khớp).
- Không chắc danh sách đủ (lần apply đầu, một dịch vụ mới): `-var che_do_dns=ALERT` — ~~chỉ ghi log~~ **[S1.252]** không chặn,
  nhưng bộ lọc `tp-dns-bi-chan` đếm cả ALERT nên mỗi tên ngoài danh sách vẫn ra thư ⑸; xem `/tp/dns` rồi đặt
  lại `BLOCK`. ~~Lọc `{ $.firewall_rule_action = "ALERT" }` trong Logs Insights.~~ **[S1.252]** Logs Insights:
  `filter firewall_rule_action = "ALERT" | stats count() by query_name` — cú pháp `{ $.… }` là của metric filter.
- Trước khi apply: kiểm `aws ec2 describe-vpc-endpoint-services --service-names com.amazonaws.ap-southeast-1.sms-voice`
  có dịch vụ ở region; không có thì bỏ `sms-voice` khỏi `dich_vu_endpoint` và giữ tên SMS trong danh sách (đi qua NAT).
  **[S1.252]** `dich_vu_endpoint` là `local` của `main.tf` — bỏ nó là sửa mã qua PR, không có biến.

**[ADR-079] Chính sách VPC endpoint.** Endpoint giao diện chỉ nhận người gọi thuộc prod/audit gọi tới tài nguyên thuộc
prod/audit; S3 gateway chỉ cho bucket lớp image ECR (GetObject) và bucket neo (Get/Put/List), và nay gắn cả bảng định
tuyến của api. Thêm một dịch vụ AWS ở tài khoản khác, hay một bucket S3 mới cho task: sửa `local.chinh_sach_*` ở stack 90
(`hinh-dang-endpoint.test.ts` ghim cả hai). Lỗi trông như `AccessDenied ... no VPC endpoint policy allows` là dấu hiệu
thiếu mục.

**[ADR-083] Cảnh báo lỗi nghiệp vụ.** Cùng tiền tố `tp-van-hanh-nghiep-vu-*` (thư qua ⑹): job outbox bỏ cuộc (≥ 1), SMS/Zalo
từ chối (≥ 5 trong 15 phút), token Zalo mất (≥ 1), vòng quét outbox hỏng (≥ 3 trong 10 phút), bộ dọn bảng hạn mức hỏng hai lượt
liền (≥ 1) — đếm từ log `/tp/api`, `/tp/unseal-worker`; và **tồn đọng**: worker ghi mỗi 5 phút tuổi job PENDING quá hạn lâu nhất
của mọi tổ chức (`TRUSTPROCURE_OUTBOX_TON_DONG_MS`), > 15 phút hai kỳ liền ⇒ thư. Worker `so_ban_worker = 0` thì không có số
tồn đọng — alarm ấy im (thiếu dữ liệu = bình thường).

**[ADR-077] Cảnh báo vận hành.** Stack 90 đặt alarm tiền tố `tp-van-hanh-`: target không khoẻ / không còn target
khoẻ cho từng target group (api, web, public-keys), tỉ lệ 5xx của ALB > 5%, p95 của api > 2 giây, service chạy thiếu
task (Container Insights; service `so_ban_* = 0` không có alarm), RDS CPU > 80%, dung lượng trống < 2 GB, > 150 kết nối.
Stack 60 ⑹ chuyển mọi alarm mang tiền tố ấy — cả lúc vào ALARM lẫn lúc trở về OK — sang audit ⇒ email tới hộp thư VẬN HÀNH
(`email_van_hanh`, topic riêng `tp-canh-bao-van-hanh` — ADR-088), không tới `email_canh_bao`. Stack 60 bắt theo TIỀN TỐ, không phụ
thuộc 90. Lần apply đầu, trước khi service có task: "không còn target khoẻ"/"thiếu task" vào ALARM rồi trở về OK — hai thư dự
kiến mỗi service. Đổi `so_ban_worker` từ 0 lên 1 (ADR-040) tự thêm alarm thiếu task của worker. **[S1.252]** Cộng một thư OK
cho MỖI alarm mới ở lần đánh giá đầu: rule ⑹ bắt mọi lần vào OK, kể cả từ INSUFFICIENT_DATA (APPLY-LAN-DAU, bảng thư dự kiến).

## Chạy thật — stack `90-ecs` (ADR-066)

**1. Bí mật — tạo TRƯỚC khi apply** (giá trị không bao giờ vào state; mật khẩu ≥ 24 ký tự ngẫu nhiên). **[S1.252]** Mật khẩu chỉ
gồm chữ và số — `/ ? # % @ :` phá URL, `$` và dấu huyền bị nội suy trong nháy kép dưới (APPLY-LAN-DAU 6.1 có lệnh sinh).
Host RDS chưa có ở lần đầu: tạo secret với host tạm rồi `put-secret-value` lại sau bước 3.

```powershell
aws secretsmanager create-secret --profile tp-prod --name tp/api/otp-peppers --secret-string "p1=<base64 32 byte>"
aws secretsmanager create-secret --profile tp-prod --name tp/api/database-url `
  --secret-string "postgres://app_api_login:<mat-khau-api>@<rds-host>:5432/trustprocure"
aws secretsmanager create-secret --profile tp-prod --name tp/worker/database-url `
  --secret-string "postgres://app_unseal_login:<mat-khau-worker>@<rds-host>:5432/trustprocure"
aws secretsmanager create-secret --profile tp-prod --name tp/neo/database-url `
  --secret-string "postgres://app_neo_login:<mat-khau-neo>@<rds-host>:5432/trustprocure"
# [S1.182 / ADR-111] Task khởi tạo tổ chức — vai app_khoi_tao_login, mật khẩu riêng.
aws secretsmanager create-secret --profile tp-prod --name tp/khoi-tao/database-url `
  --secret-string "postgres://app_khoi_tao_login:<mat-khau-khoi-tao>@<rds-host>:5432/trustprocure"
```

**2. Apply hai bước** — HTTPS cần chứng chỉ ACM đã xác minh, mà DNS nằm ngoài AWS:

```powershell
cd infra\terraform\90-ecs
terraform init
terraform apply -var-file prod.tfvars -target aws_acm_certificate.api   # bước A: chỉ chứng chỉ
terraform output xac_minh_acm                                           # thêm CNAME này ở DNS
terraform plan -var-file prod.tfvars -out plan.tfplan                   # bước B: phần còn lại
terraform apply plan.tfplan                                             # chờ ACM xác minh rồi tạo ALB
```

**[S1.252]** Sau bước A chỉ đọc `xac_minh_acm`: ~~`ban_ghi_dns`~~ còn đọc ALB nên chưa có trong state (*Output not found*, đo trên
Terraform 1.13.3); nó dùng ở bước 3 cho CNAME `cong_khai`.

`prod.tfvars` (không commit): `sms`, `zalo` (tuỳ chọn, stack 85 — bỏ trống là tắt kênh), `ten_mien` (tên miền công khai DUY NHẤT — trang và `/api/*`; `TRUSTPROCURE_PUBLIC_BASE_URL`
và `TRUSTPROCURE_ALLOWED_ORIGINS` của api suy ra từ nó), `anh = { api, worker, migrate, web, public_keys, neo, khoi_tao }` (URI **@sha256:**; **[S1.183]** `khoi_tao` — task khởi tạo tổ chức, ADR-111), `ses = { tu_api, tu_canh_bao, nhan_canh_bao, configuration_set = "tp-thu" }`.
Lần đầu chưa có image trong ECR: apply `-target` các `aws_ecr_repository` trước, đẩy image (bước 4), rồi
mới apply phần còn lại.

**Trước mỗi plan bước B** (từ gốc kho): `pnpm kiem-truoc-apply --var-file infra\terraform\90-ecs\prod.tfvars` — đọc biến
hiệu lực qua `terraform console`, rồi hỏi tài khoản prod (chỉ đọc): giá trị giữ chỗ, image có trong ECR, secret có giá
trị, domain SES đã xác minh. Có `[DO]` ⇒ thoát 1, không plan (ADR-087; `docs/APPLY-LAN-DAU.md` 6.4).

**3.** Cập nhật ~~hai~~ **[S1.182]** bốn secret `*/database-url` (api, worker, neo, khoi-tao) bằng `terraform output rds_endpoint`; thêm CNAME `cong_khai` (output `ban_ghi_dns`) → ALB.

**4. Build và đẩy image** (từ gốc kho):

```powershell
aws ecr get-login-password --profile tp-prod | docker login --username AWS --password-stdin <ecr>
foreach ($t in "api","worker","migrate","web","public-keys","neo","khoi-tao") {
  $repo = @{ api = "tp-api"; worker = "tp-unseal-worker"; migrate = "tp-migrate"; web = "tp-web"; "public-keys" = "tp-public-keys"; neo = "tp-neo"; "khoi-tao" = "tp-khoi-tao" }[$t]
  docker build -f deploy/Dockerfile --target $t -t "<ecr>/${repo}:<git-sha>" .
  docker push "<ecr>/${repo}:<git-sha>"      # ghi lại digest cho prod.tfvars
}
```

**[S1.252]** `<ecr>` là registry `942091277863.dkr.ecr.ap-southeast-1.amazonaws.com` — không phải URL từng kho mà `terraform output
ecr` in. Digest cho `prod.tfvars`, lọc theo thẻ như pipeline: `aws ecr describe-images --profile tp-prod --repository-name <kho>
--image-ids imageTag=<git-sha> --query 'imageDetails[0].imageDigest' --output text`.

**5. Migrate** — ~~`terraform output lenh_chay_migrate`~~ **[S1.252]** `terraform output -raw lenh_chay_migrate`, chạy, đọc `/tp/migrate` trong CloudWatch: phải thấy
`da ap N migration` và ~~hai~~ **[S1.252]** bốn dòng `vai …` (`app_api_login`, `app_unseal_login`, `app_neo_login`,
`app_khoi_tao_login`). **Đây cũng là phép đo ADR-061 trên RDS** (vai master RDS không
phải superuser); nếu `migrate()` từ chối, dừng lại và đọc thông điệp — không sửa bằng tay trong CSDL.

**6. Worker:** để `so_ban_worker = 0` tới khi có tổ chức đầu tiên (worker từ chối khởi động khi nguồn tổ
chức trả 0 hàng — ADR-040), rồi đặt 1 và apply.

**7. Kiểm:** `https://<ten_mien>/api/health` ⇒ 200 (ALB bỏ tiền tố `/api`); `https://<ten_mien>/nop-thau` ⇒ 200 kèm
header `content-security-policy`; log `/tp/api` có dòng `khoa: aws-kms, bo gui: ses`, log `/tp/web` có `CHI TINH`;
`https://<ten_mien>/.well-known/trustprocure-receipt-keys` ⇒ 200, và `sha256` in trong log `/tp/public-keys` TRÙNG dấu vân
tay tính độc lập từ output của stack 50 (mục "Khoá công khai biên nhận" dưới). **[ADR-075]** Mọi phản hồi HTTPS mang
`strict-transport-security: max-age=31536000; includeSubDomains`, `x-frame-options: DENY`, `x-content-type-options: nosniff`,
không có header `server` (~~`curl -sI https://<ten_mien>/api/health`~~ **[S1.252]** `curl.exe -s -D - -o NUL https://<ten_mien>/api/health`
— trên Windows PowerShell 5.1 `curl` là bí danh của `Invoke-WebRequest`, và `-I` gửi HEAD mà `api` trả 405); `http://<ten_mien>/` ⇒ 301 sang HTTPS.

## Khoá công khai biên nhận — service `tp-public-keys` (ADR-070)

Stack 50 (chạy bằng KeyAdmin, có `kms:GetPublicKey`) xuất `bien_nhan = { kid_dang_dung, khoa_cong_khai }`; stack 90 đọc state
ấy, đặt `TRUSTPROCURE_KMS_RECEIPT_KID` cho api và chuyển nửa công khai vào service `tp-public-keys` — service không có task
role, không KMS, không CSDL. **Thứ tự: apply 50 trước 90.**

Tính dấu vân tay độc lập (không qua endpoint) — đây là con số in vào hợp đồng và đọc qua điện thoại cho nhà cung cấp:

```powershell
cd infra\terraform\50-kms-prod
$b64 = (terraform output -json bien_nhan | ConvertFrom-Json).khoa_cong_khai.'kms-2026-09'
$der = [Convert]::FromBase64String($b64)
-join ([Security.Cryptography.SHA256]::Create().ComputeHash($der) | ForEach-Object { $_.ToString('x2') })
```

**Xoay khoá ký:** trong stack 50 thêm một `aws_kms_key` mới + một mục mới vào `local.khoa_bien_nhan`, trỏ
`alias/tp-receipt-sign` sang khoá mới, đặt `receipt_kid` mới; apply 50, rồi 90, rồi deploy. **Không gỡ mục cũ** — biên
nhận cũ phải kiểm được mãi (ADR-011 mục 3). Khoá cũ giữ quyền `GetPublicKey`, không còn ai `Sign` qua alias.

## Job neo — task `tp-neo` (ADR-071)

Task một lần, role `tp-anchor-job`: mượn `tp-anchor-writer` ở tài khoản audit (đúng danh tính duy nhất ghi được bucket neo và
ký được bằng `alias/tp-anchor-sign`), không service. Stack 40 xuất `neo = { kid_dang_dung, alias_arn, khoa_cong_khai }`, stack 90
đọc state ấy. **Thứ tự: 40 và 50 trước 90.**

- **Neo khoá biên nhận** — lệnh mặc định của image, pipeline chạy nó sau MỖI lần deploy `tp-public-keys`
  (`terraform output lenh_chay_neo` để chạy tay — **[S1.252]** output là một đối tượng hai lệnh; in đúng lệnh bằng
  `(terraform output -json lenh_chay_neo | ConvertFrom-Json).khoa_bien_nhan`). Ghi `khoa-bien-nhan/<kid>.json` — **đúng byte** của
  `GET https://<ten_mien>/.well-known/trustprocure-receipt-keys/<kid>`. Chạy lại cùng khoá là không làm gì; một kid bị đổi
  khoá làm job thoát mã 1.
- **Mốc neo sổ kiểm toán** — `lenh_chay_neo.xuat`, thay `<uuid>` (lặp `--org` cho nhiều tổ chức). **[S1.252]** Trên Windows
  PowerShell 5.1, chuỗi JSON trong nháy đơn của `--overrides` mất nháy kép khi tới `aws` (chưa đo trên Windows): ghi phần ấy vào
  một tệp UTF-8 rồi dùng `--overrides file://<tệp>`, như `clockdrift.json` ở mục "Nguồn thời gian". Ghi
  `so-kiem-toan/<org>/<thời điểm>-<băm>.json`, ký bằng KMS. **[ADR-072] Có lịch:** EventBridge Scheduler
  `tp-neo-hang-ngay` chạy `lich` lúc 02:15 giờ VN — tự liệt kê mọi tổ chức (vai `app_neo`), xuất rồi kiểm. Task thoát ≠ 0
  ⇒ email cảnh báo ⑶ của stack 60 (từ tài khoản audit). Đọc log `/tp/neo`: `TU CHOI NEO`, `KHONG XUAT DUOC`, `ok=false` là
  một tổ chức cần điều tra ngay.
  **[ADR-073]** Lịch không chạy thì không task nào dừng ⇒ ⑶ im; cảnh báo ⑷ của stack 60 báo khi **36 giờ** không có
  đối tượng mới nào dưới `so-kiem-toan/` (S3 request metrics + CloudWatch alarm, cùng ở audit). Lần apply đầu: alarm vào
  ALARM cho tới lượt ghi đầu tiên — một thư dự kiến.
  **[ADR-086]** ⑷ đếm tổng; ⑺ đếm **từng tổ chức**: Lambda `tp-canh-moc-neo` ở audit (stack 60) chạy mỗi 6 giờ, chỉ
  `s3:ListBucket` dưới `so-kiem-toan/`, báo tổ chức từng được neo mà 36 giờ không có mốc mới (theo `LastModified`, không theo
  tên khoá) — ca một tổ chức vắng khỏi danh sách của `lich` mà job vẫn thoát 0. Thêm hai alarm: Lambda lỗi, Lambda không chạy
  12 giờ. Mã: `tools/neo-so-kiem-toan/src/canh-moc-neo.ts`; tệp Lambda `lambda/canh-moc-neo.mjs` sinh bằng
  `pnpm neo:dong-goi-lambda` (test đòi hai tệp trùng). Stack 60 cần provider `hashicorp/archive` (`terraform init` tự tải).

Kiểm độc lập — bằng tài khoản audit, không qua prod:

```powershell
aws s3 cp --profile tp-audit s3://tp-neo-528657840905/khoa-bien-nhan/kms-2026-09.json neo.json
curl.exe -s https://<ten_mien>/.well-known/trustprocure-receipt-keys/kms-2026-09 -o endpoint.json
(Get-FileHash neo.json).Hash -eq (Get-FileHash endpoint.json).Hash    # phải True
```

**Chưa kiểm:** endpoint SES API (`email`) ở vùng này — nếu `plan` báo không có dịch vụ ấy, đổi `ses_endpoint_service`.

## Deploy thường ngày — `.github/workflows/deploy.yml` (ADR-067)

Sau lần chạy tay đầu tiên ở trên (stack 90 cần image có sẵn), mọi lần deploy đi qua pipeline bấm tay.

**Chuẩn bị một lần trên GitHub** (Settings → Environments):

| Environment | Required reviewers | Deployment branches | Biến |
|---|---|---|---|
| `prod` | bật, ít nhất một người | chỉ `master` | `TP_SUBNETS_UNG_DUNG`, `TP_SG_MIGRATE`, `TP_SG_NEO` — lấy từ `terraform output bien_github` (stack 90) |
| `prod-worker` | bật, người duyệt nên khác người bấm | chỉ `master` | không |
| `prod-khoi-tao` **[S1.183]** | bật, **và *Prevent self-review***, **[lượt soi] TẮT admin bypass** (*Allow administrators to bypass configured protection rules*); ít nhất hai người | chỉ `master` | `TP_SUBNETS_UNG_DUNG`, `TP_SG_KHOI_TAO` — `terraform output bien_github_khoi_tao` (stack 90) |

**[ADR-078] Biến cấp repository** (Settings → Secrets and variables → Actions → *Variables*, KHÔNG gắn environment — job
`kiem` không có environment): `TP_TEN_MIEN`, `TP_RECEIPT_ACTIVE_KID` lấy từ `terraform output bien_github_repo` (stack 90);
`TP_RECEIPT_FINGERPRINT` = dấu vân tay tính độc lập của kid đang dùng (mục "Khoá công khai biên nhận"). Xoay khoá thì cập
nhật hai biến khoá cùng lúc với apply stack 90 — không thì lần deploy kế đỏ ở `kiem`, đúng như mong đợi.

Tên environment phải đúng ~~hai~~ **[S1.183]** ba chuỗi trên: trust policy của `tp-deploy`/`tp-deploy-worker` (stack 30)
ghim ~~`sub = repo:huubang1984/Purchasing-:environment:<tên>`~~ **[S1.223 / khoản 252 ⑶]** `sub` theo dạng TUỲ BIẾN của kho — mục
ngay dưới; với `prod-khoi-tao` ghim cả TỆP workflow. Không có secret nào — pipeline lấy quyền
AWS bằng OIDC.

### Tuỳ biến claim `sub` của OIDC — TRƯỚC khi apply stack 30 (khoản 252 ⑶, ADR-130, S1.223)

Trust policy của `tp-deploy` và `tp-deploy-worker` đòi `sub` theo dạng TUỲ BIẾN của kho, không phải dạng mặc định:

```
repo:huubang1984@234519700/Purchasing-@1350087523:environment:<tên>:job_workflow_ref:huubang1984/Purchasing-/.github/workflows/<tệp>@refs/heads/master
```

- **`repo:` mang ID bất biến** của chủ kho (`234519700`) và của kho (`1350087523`) — hai hằng ở `infra/terraform/chung`. Kho tạo ngày
  2026-08-28, sau mốc **2026-07-15** mà GitHub chuyển mọi kho mới sang *immutable subject claims* (tài liệu *OpenID Connect
  reference*, mục *Immutable subject claims*: `repo:OWNER@OWNER-ID/REPO@REPO-ID:…`; ID luôn có mặt trong đoạn `repo` kể cả khi tuỳ
  biến claim). ID lấy từ `gh api repos/huubang1984/Purchasing-` — trường `owner.id` và `id`. ~~`repo:huubang1984/Purchasing-:…`~~ là
  dạng của kho tạo TRƯỚC mốc ấy; chưa lần nào chạy trên AWS (khoản 15) nên không ai thấy nó sai.
- **`job_workflow_ref`** là workflow ĐỊNH NGHĨA job (với job không dùng reusable workflow, chính là tệp của workflow). Chỉ
  `prod-khoi-tao` ghim tệp — `khoi-tao.yml` trên `master`:
  `repo:huubang1984@234519700/Purchasing-@1350087523:environment:prod-khoi-tao:job_workflow_ref:huubang1984/Purchasing-/.github/workflows/khoi-tao.yml@refs/heads/master`.
  `prod` và `prod-worker` không ghim (`job_workflow_ref:*`) — như cũ, chủ dự án chốt 2026-09-30.
- Cả hai vế là ĐỌC tài liệu GitHub, chưa đo trên token thật của kho. Sai thì AWS **từ chối** role (KHOÁ, không mở) — bước 4 dưới
  nói cách in claim thật.
- **[rà 2026-10-01] Nửa `repo:` đã khớp một nguồn của GitHub** (API cấu hình, chưa phải token thật):
  `gh api repos/huubang1984/Purchasing-/actions/oidc/customization/sub` trả `use_immutable_subject: true` và `sub_claim_prefix`
  `repo:huubang1984@234519700/Purchasing-@1350087523` — trùng hai hằng ở `chung`. Cùng lượt ấy còn `use_default: true`: bước 2
  dưới chưa làm. **[mục C 2026-10-01]** Bước 2 và 3 đã làm (APPLY-LAN-DAU 2.0b); vế `job_workflow_ref` và token thật vẫn chờ bước 4.

**Thứ tự — làm liền tay trong một buổi.** Giữa bước 2 và bước 3, mọi job deploy xin role đều bị AWS từ chối (đỏ ở bước
`configure-aws-credentials`, trước mọi lệnh AWS): KHOÁ chứ không MỞ. Quên bước 2 rồi apply, hay làm bước 2 rồi quên apply, cũng chỉ
khoá; gỡ tuỳ biến (`{"use_default":true}`) khi policy đã đòi dạng mới cũng chỉ khoá.

1. `cd infra\terraform\30-prod-iam; terraform init; terraform plan -out plan.tfplan` — đọc policy `deploy_trust` trong plan: `tp-deploy`
   đúng hai chuỗi `sub` (`prod` với `job_workflow_ref:*`, `prod-khoi-tao` với `khoi-tao.yml@refs/heads/master`), `tp-deploy-worker` một.
2. Tuỳ biến claim — quyền admin của kho, `gh auth login` trước (`gh` là GitHub CLI; API `PUT /repos/{owner}/{repo}/actions/oidc/customization/sub`):
   ```powershell
   gh api -X PUT repos/huubang1984/Purchasing-/actions/oidc/customization/sub -F use_default=false -f "include_claim_keys[]=repo" -f "include_claim_keys[]=context" -f "include_claim_keys[]=job_workflow_ref"
   gh api repos/huubang1984/Purchasing-/actions/oidc/customization/sub    # phải in lại use_default=false và ĐÚNG ba khoá, ĐÚNG thứ tự ấy
   ```
   **[mục C 2026-10-01]** `gh` dựng thân request `{"use_default":false,"include_claim_keys":["repo","context","job_workflow_ref"]}` từ
   các trường (`-F` đổi `false` thành boolean, `key[]=` giữ thứ tự mảng). Bản trước pipe chuỗi JSON ấy vào `gh api … --input -` và
   GitHub trả `Problems parsing JSON` (HTTP 400) trên PowerShell của máy vận hành: chuỗi không tới nguyên vẹn — nguyên nhân chưa đo,
   nghi BOM do `$OutputEncoding`. Lệnh trên đã chạy trên kho ngày ấy: `GET` trả `use_default: false` và đúng ba khoá theo thứ tự.
   Thứ tự khoá QUYẾT ĐỊNH hình dạng `sub` (`repo:…:environment:…:job_workflow_ref:…`). `context` là đoạn sau `repo` của dạng mặc định:
   với job có environment nó là `environment:<tên>` (đúng ví dụ *Requiring a reusable workflow and other claims* của tài liệu); dùng
   `context` thay `environment` để job không có environment vẫn được cấp token (chỉ không khớp policy nào), thay vì bị GitHub từ chối
   cấp token. Tuỳ biến là của CẢ KHO: token của `deploy.yml` cũng đổi dạng — policy của `prod`/`prod-worker` đã viết theo dạng mới.
3. `terraform apply plan.tfplan`.
4. Đối chứng dương: chạy *Deploy — prod (bam tay)* với `api` ⇒ bước `configure-aws-credentials` của job `api` xanh. Đỏ với
   `Not authorized to perform sts:AssumeRoleWithWebIdentity` ⇒ `sub` thật khác chuỗi trong policy: in claim thật bằng action
   `github/actions-oidc-debugger` (một workflow tạm trên một nhánh, `permissions: id-token: write`, không environment — xoá sau khi
   đọc), so đoạn `repo:` với `local.sub_repo` ở stack 30 và sửa đúng một dòng ấy (hay hai hằng ID ở `chung`), plan, apply lại.
5. Đối chứng âm (suy từ policy, không chạy được mà không sửa `master`): một workflow khác trên `master` khai `environment: prod-khoi-tao`
   mang `job_workflow_ref` của chính nó ⇒ không khớp ⇒ không nhận `tp-deploy`. `hinh-dang-khoi-tao.test.ts` ghim chuỗi này và mẫu
   tuỳ biến ở đây khớp `chung`.

**Chạy:** Actions → *Deploy — prod (bam tay)* → Run workflow trên `master`, chọn `api`, `worker` hoặc
`ca-hai`. Job `build` dựng image không có quyền AWS; job `api` chờ duyệt ở `prod`, đẩy image, chạy
migrate (dừng nếu exit ≠ 0), cập nhật `tp-api` rồi `tp-web`; job `worker` chờ duyệt riêng ở `prod-worker`. Tóm tắt
của run ghi ARN các bản task definition vừa đăng ký. Migrate hỏng ⇒ đọc `/tp/migrate` bằng tay (role
deploy không đọc log).

**[ADR-078] Kiểm sau deploy** (`deploy/kiem-sau-deploy.sh`): job `kiem` — không quyền AWS — gọi `https://<ten_mien>`:
`/api/health`, `/nop-thau`, `/.well-known/trustprocure-receipt-keys` trả 200; HSTS, `x-frame-options: DENY`, `nosniff`, không
header `server`; `/nop-thau` có CSP; `http://` ⇒ 301; tài liệu khoá có `activeKeyId` và dấu vân tay đúng hai biến trên. Job
`worker` sau khi cập nhật chờ 2 phút rồi kiểm service đủ task và `/tp/unseal-worker` không có `khong khoi dong duoc` /
`cau hinh khong hop le` (role `tp-deploy-worker` chỉ có `logs:FilterLogEvents` trên đúng nhóm log ấy — stack 30). Hỏng ⇒
job đỏ và in kiểm nào hỏng; **không tự quay lui** — quyết định theo mục dưới.

**Quay lui:** `aws ecs update-service --profile tp-prod --cluster tp-prod --service tp-api --task-definition
tp-api:<bản cũ>` — chỉ lùi image; migration đã chạy KHÔNG lùi theo, nên bản cũ phải chạy được trên schema mới.

## Khởi tạo tổ chức — `.github/workflows/khoi-tao.yml` (ADR-111, S1.183)

Tạo tổ chức, người dùng và vai (hay thêm người vào tổ chức đã có) bằng task một lần `tp-khoi-tao` dưới vai CSDL hẹp
`app_khoi_tao`. Bản khai (JSON, email và họ tên) sống ở Secrets Manager dưới `tp/khoi-tao/ban-khai/<slug>`; lệnh chỉ mang TÊN,
PHIÊN BẢN (`VersionId`) và BĂM SHA-256 của nó. Các bước người vận hành: `docs/APPLY-LAN-DAU.md` 8.1.

- **Chạy:** Actions → *Khoi tao to chuc — prod (bam tay)* → Run workflow trên `master` với bảy đầu vào. Job `build` (không
  quyền AWS) kiểm đầu vào và người bấm (bot thì dừng), chọn mã tổ chức khi tạo, in bảng *điều người duyệt duyệt* vào tóm tắt,
  build đích `khoi-tao`. Job `chay` chờ duyệt ở `prod-khoi-tao`; bước đầu, TRƯỚC khi lấy quyền AWS, đòi lịch sử duyệt của run
  có một NGƯỜI khác người bấm; rồi đẩy image, đăng ký `tp-khoi-tao` (bản mới nhất lệch hình dạng stack 90 thì dừng), chạy task
  (`deploy/trien-khai.sh khoi-tao`).
- **Task đọc ĐÚNG phiên bản đã duyệt, so băm**, và dừng TRƯỚC khi chạm CSDL nếu bản khai lệch tổ chức, số người hay số người
  theo từng mã vai của bảng.
- **Thoát 0 ⇒ bí mật bị XOÁ ngay** (`--force-delete-without-recovery`); tóm tắt in kết quả suy từ đầu vào đã duyệt (mã tổ
  chức, số người, vai) — không đọc log. **Không xanh ⇒ bí mật CÒN**: job `nhac` nói điều ấy; chạy lại (an toàn), hay sửa bằng
  `put-secret-value` (VersionId và băm mới), hay xoá tay.
- Nhóm `concurrency` RIÊNG (`khoi-tao-prod`): một lần khởi tạo chờ duyệt không chặn deploy. Chạy trùng migrate vẫn an toàn —
  hardening thu hồi rồi cấp lại quyền của `app_khoi_tao` trong MỘT giao dịch.
- Kho CÔNG KHAI: đầu vào và tóm tắt của run ai cũng đọc được — slug, mã tổ chức, số người theo vai.
- **[S1.223 / khoản 252 ⑴] Mỗi lần chạy để lại thư** ở `email_canh_bao` (stack 60 ⑼): `RunTask` họ `tp-khoi-tao` bởi
  `assumed-role/tp-deploy/khoi-tao-<run id>` và `DeleteSecret` bản khai — cộng `CreateSecret`/`PutSecretValue` của người vận hành ở
  8.1 trước đó. Thư là nhân chứng: đối chiếu `<run id>` với run trên GitHub. Thư mà KHÔNG có run đã duyệt (một phiên SSO chạy
  `run-task`, đăng ký họ khác mang role `tp-khoi-tao`, Put/Update bản khai SAU khi đã duyệt) là lần chạy ngoài workflow — dừng task,
  đọc CloudTrail và các hàng `users`/`user_roles` vừa thêm. Và **[khoản 252 ⑶]** role `tp-deploy` chỉ về tay `prod-khoi-tao` qua
  `khoi-tao.yml` trên `master` (mục "Tuỳ biến claim `sub`").

## Nguồn thời gian (ADR-074, khoản 196)

Hạn nộp thầu được phán xử bằng `now()` của **CSDL** (trigger C1), nên đồng hồ của máy CSDL là một
tham số pháp lý của sản phẩm, không phải một chi tiết vận hành. Lời khai của kho:

| Thành phần | Nguồn thời gian | Cấu hình của ta |
|---|---|---|
| RDS PostgreSQL (stack `90-ecs`) | Amazon Time Sync Service — dịch vụ quản lý, không có tham số chọn nguồn khác | **Không cấu hình gì.** Stack RDS sau này KHÔNG được thêm gì đổi múi giờ hay nguồn giờ của máy CSDL; `timezone` của parameter group để mặc định `UTC` |
| ECS Fargate — `tp-api`, `tp-unseal-worker` (stack `90-ecs`) | Amazon Time Sync Service của host Fargate (`169.254.169.123` / `fd00:ec2::123`) | **Không cấu hình gì.** Task definition KHÔNG chạy chrony/ntpd riêng, KHÔNG ghi đè giờ hệ thống |
| Stack đo một lần `70-do-kms` | như ECS Fargate | không liên quan tới hạn nộp |

**Mọi dòng trong bảng trên là ĐỌC tài liệu AWS, chưa đo** — chưa có tài khoản prod dùng được (khoản 15)
và chưa có stack RDS hay ECS dịch vụ nào. Lớp CƯỠNG CHẾ không nằm ở đây mà ở tiến trình: `apps/api` và
`apps/unseal-worker` so `clock_timestamp()` của CSDL với đồng hồ của chính chúng lúc khởi động (lệch quá
`TRUSTPROCURE_CLOCK_SKEW_MAX_MS`, mặc định 2 000 ms ⇒ **không lên**, lỗi `LechDongHoError`) và mỗi
`TRUSTPROCURE_CLOCK_SKEW_CHECK_MS` (mặc định 60 000 ms) lúc chạy (⇒ một dòng log `canh bao LechDongHo`).
Tức nếu lời khai trên sai, tiến trình nói ra.

Kiểm sau khi stack RDS và `90-ecs` được apply (đối chứng dương, bắt buộc trước dữ liệu thật):

1. ~~Trong một task `tp-api`: `curl "$ECS_CONTAINER_METADATA_URI_V4/task"` ⇒~~ **[rà 2026-10-01]** Không vào được một task đang
   chạy: stack 90 không bật ECS Exec, và image `node:22-bookworm-slim` không có `curl`. Thay bằng một task `tp-migrate` chạy một
   lần với lệnh ghi đè — cùng cụm Fargate, cùng subnet ứng dụng; nó đọc metadata bằng `fetch` của Node, **chưa đo trên AWS**.
   **[S1.252]** Phần không cần AWS đã đo và ghim (`tests/architecture/hinh-dang-clockdrift.test.ts`): tên container khớp task
   `migrate` của stack 90, đích `migrate` của `deploy/Dockerfile` chỉ có `CMD` nên `command` thay trọn lệnh, và trên một endpoint
   metadata v4 giả lệnh in đúng một dòng `CLOCKDRIFT {…}`. Tệp
   `clockdrift.json`, lưu UTF-8 bằng trình soạn (không bằng `Out-File` của PowerShell 5):
   ```json
   {"containerOverrides":[{"name":"tp-migrate","command":["node","-e","fetch(process.env.ECS_CONTAINER_METADATA_URI_V4+'/task').then(r=>r.json()).then(j=>console.log('CLOCKDRIFT '+JSON.stringify(j.ClockDrift)))"]}]}
   ```
   Chạy lệnh in bởi `terraform output lenh_chay_migrate`, thêm `--overrides file://clockdrift.json`, rồi tìm `CLOCKDRIFT` trong
   `/tp/migrate` ⇒ trường `ClockDrift` có
   `ClockSynchronizationStatus = SYNCHRONIZED` và `ClockErrorBound` cỡ mili-giây.
   **[S1.252]** Ba kết quả khác: `CLOCKDRIFT undefined` (đo trên endpoint giả: task VẪN thoát 0) ⇒ metadata không mang
   trường ấy — CHƯA đo, không phải đạt, đừng chép vào STATE; `NOT_SYNCHRONIZED` ⇒ dừng trước dữ liệu thật; task thoát 1 với
   `fetch failed` (đo: endpoint không trả lời) ⇒ không với tới endpoint metadata — chạy lại một lần, lặp lại thì dừng và đọc
   `/tp/migrate`.
2. Log khởi động của `tp-api` và `tp-unseal-worker` KHÔNG có `LechDongHoError`; và trong một giờ chạy,
   không có dòng `canh bao LechDongHo`.
3. Chép hai kết quả ấy vào `docs/STATE.md` khoản 15 cùng bảng KMS.


## Đường thư cảnh báo tự canh — Lambda `tp-canh-dang-ky` (ADR-089)

Mọi cảnh báo dừng ở một đăng ký email mà người nhận phải bấm xác nhận. Chưa bấm, SNS tự xoá khi quá hạn, hay người nhận bấm
"unsubscribe" ⇒ thư đi vào hư không mà `apply` vẫn xanh. Stack 60 ⑻: Lambda `tp-canh-dang-ky` ở audit, mỗi 6 giờ, chỉ có
`sns:ListSubscriptionsByTopic` trên `tp-canh-bao-khoa` và `tp-canh-bao-van-hanh`; đối chiếu với `email_canh_bao` và
`email_van_hanh` (Terraform ghi vào biến môi trường `MONG_DOI`). Mỗi địa chỉ chưa xác nhận / không có đăng ký, và mỗi đăng
ký lạ, là một dòng `DANG KY HONG` (tên biến và vị trí, không in địa chỉ) ⇒ alarm `tp-canh-bao-dang-ky-hong` gửi ALARM và OK
tới **cả hai** topic. Thêm alarm Lambda lỗi và Lambda không chạy 12 giờ, cùng khuôn ⑺. Mã: `tools/canh-dang-ky/src/canh-dang-ky.ts`;
tệp Lambda `lambda/canh-dang-ky.mjs` sinh bằng `pnpm canh-dang-ky:dong-goi-lambda` (test đòi trùng byte với nguồn).
Tạo lại một đăng ký đã mất: `terraform apply` stack 60 lần nữa, rồi bấm xác nhận.

## Rủi ro còn lại — nói thẳng

- **KeyAdmin sửa được key policy**, nên về lý thuyết tự gỡ lệnh `Deny` rồi tự cấp `Decrypt`.
  Không khoá KMS nào tránh được điều này; giảm nhẹ là cảnh báo EventBridge/CloudTrail trên
  `PutKeyPolicy` và có **người thứ hai** giữ KeyAdmin (ADR-062, điều kiện trước dữ liệu thật).
  Cảnh báo ấy là stack `60-canh-bao`: email tới `email_canh_bao` cho mọi `PutKeyPolicy`, thành
  công hay bị từ chối. Truyền địa chỉ (cùng `email_van_hanh`, ADR-088) bằng tệp `canh-bao.tfvars` không commit (APPLY-LAN-DAU 3.1), rồi **bấm xác
  nhận** thư AWS gửi tới — chưa xác nhận thì chưa có cảnh báo. Người nhận không nên chỉ là người giữ
  KeyAdmin. Kiểm sau apply (đối chứng dương, bắt buộc): bằng KeyAdmin, `aws kms get-key-policy`
  rồi `aws kms put-key-policy` lại ĐÚNG policy ấy trên một khoá của prod ⇒ phải có thư trong vài
  phút. Không có thư thì cảnh báo chưa chạy, dù `apply` xanh.
  **[2026-10-02 / khoản 336, rổ A]** ~~Cảnh báo ấy chỉ bắt `PutKeyPolicy`. KeyAdmin còn `DisableKey`, `ScheduleKeyDeletion` (người gọi chọn thời gian chờ, thấp nhất 7 ngày), `UpdateAlias`, `DeleteAlias`, `DisableKeyRotation` — và chưa thao tác nào trong số ấy phát thư.~~ **[sửa 2026-10-02]** Mã của stack 60 nay bắt mọi thao tác ghi mà KeyAdmin giữ — 17 tên ở `local.su_kien_ghi_khoa`, test `tests/architecture/hinh-dang-canh-bao-khoa.test.ts` ghim —, và thư mở đầu bằng tên thao tác, kèm alias, khoá đích và số ngày chờ xoá. ~~Có hiệu lực khi apply lại stack 60 (APPLY-LAN-DAU 3.1); đối chứng dương là 3.3b. Tới lúc ấy, người giữ khoá thứ hai chỉ thấy các thao tác ấy qua CloudTrail.~~ **[2026-10-05]** Đã apply lại stack 60; đối chứng dương 3.3b ra đủ sáu thư trên prod — khoản 336 đóng. Nhận thư `DisableKey` hay `ScheduleKeyDeletion` trên khoá thật mà không phải thay đổi đã duyệt: `EnableKey` hay `CancelKeyDeletion` ngay. Mọi lần apply stack 40/50 sau này cũng ra thư — đó là nhân chứng, không phải sự cố.
- **`tp-deploy-worker` PassRole được role của worker**, tức pipeline ấy chạy được một task mang
  quyền `Decrypt`. Tách role + environment `prod-worker` **có duyệt tay** trên GitHub là giảm
  nhẹ; cảnh báo trên task mang role worker ngoài service chính thức là stack `60-canh-bao` ⑵:
  `RunTask`/`StartTask` với họ `tp-unseal-worker` hay ghi đè `taskRoleArn` thành role worker, và
  `RegisterTaskDefinition` gắn role worker vào họ khác. **Quy ước ràng buộc stack ECS sau này:**
  task definition của worker mang họ `tp-unseal-worker`. ~~Kiểm sau apply (đối chứng dương, không
  khởi task nào): `aws ecs run-task --cluster khong-ton-tai --task-definition tp-unseal-worker`
  ⇒ lời gọi lỗi, nhưng CloudTrail vẫn ghi nó kèm `errorCode` ⇒ phải có thư.~~ **[apply lần đầu
  2026-09-30] Phép thử ấy KHÔNG BAO GIỜ có thư:** khi task definition `tp-unseal-worker` chưa tồn tại,
  ECS từ chối ở bước kiểm đầu vào (`ClientException: TaskDefinition not found`) và CloudTrail ghi
  `"requestParameters": null` — cả ba hình dạng của ⑵ đều lọc theo `requestParameters` nên không
  khớp. Đối chứng dương đúng là apply stack 70 (APPLY-LAN-DAU 4.2): `RegisterTaskDefinition` THÀNH
  CÔNG gắn role worker vào họ `tp-do-kms-worker` ⇒ phải có thư.
- **Người có AdministratorAccess ở prod chạy được task `tp-khoi-tao` không qua hai người của `khoi-tao.yml`** (khoản 252) — tạo
  tổ chức, người dùng và vai. Không lớp nào CHẶN: đó là người giữ mọi thứ khác của prod. **[S1.223]** Stack `60-canh-bao` ⑼ làm
  đường ấy không im lặng, cùng khuôn ⑵: `RunTask`/`StartTask` họ `tp-khoi-tao` hay ghi đè `taskRoleArn` thành role ấy,
  `RegisterTaskDefinition` gắn role ấy vào họ khác, và mọi `CreateSecret`/`PutSecretValue`/`UpdateSecret`/`DeleteSecret` dưới
  `tp/khoi-tao/ban-khai/` ⇒ thư — kể cả lần hợp lệ (thư là nhân chứng, đối chiếu run trên GitHub). ~~Kiểm sau apply (đối chứng
  dương, không khởi task nào): `aws ecs run-task --cluster khong-ton-tai --task-definition tp-khoi-tao --profile tp-prod` ⇒ lời gọi
  lỗi, CloudTrail vẫn ghi kèm `errorCode` ⇒ phải có thư; và lệnh `create-secret` của bước 8.1 phải ra thư — không có thư thì ⑼
  chưa chạy dù `apply` xanh.~~ **[rà 2026-10-01] Phép thử `run-task` ấy là đúng phép thử đã gạch ở ⑵ ngay trên:** khi họ
  `tp-khoi-tao` chưa tồn tại (trước stack 90) CloudTrail ghi `"requestParameters": null` nên không bao giờ có thư; sau stack 90
  thì chưa đo. Đối chứng dương của ⑼ là bước 8.1 (APPLY-LAN-DAU 3.7): lệnh `create-secret` phải ra thư, lần chạy workflow phải
  ra thư `RunTask` và `DeleteSecret` — thiếu thư thì ⑼ chưa chạy dù `apply` xanh. Không bắt `GetSecretValue` (đọc bản khai) và `RestoreSecret`. Permission set hẹp cho người tạo bản khai
  (khoản 252 ⑵) hoãn tới trước khách hàng thứ hai — khoản 278.
- **Bucket neo chặn `s3:PutObjectRetention`** với mọi người: job neo phải ghi object **không**
  kèm header Object Lock, để bucket tự áp thời hạn mặc định 365 ngày. Muốn tăng thời hạn về sau
  phải gỡ statement `KhongXoaKhongDoiKhoa` bằng root của audit (Privileged root actions).
- Các khoá và bucket mang `prevent_destroy`: `terraform destroy` sẽ dừng — đó là chủ đích.
- Secret (`tp/api/*`, `tp/worker/*`…) **không** tạo ở đây: giá trị sẽ lọt vào state. Tạo bằng
  CLI/console; các role chỉ đọc được nhánh của mình.

# Apply lần đầu — từ tài khoản trống tới prod chạy thật

Danh sách việc **theo đúng thứ tự**, cho người vận hành dựng TrustProcure trên AWS lần đầu. Mỗi mục đánh dấu được;
chi tiết từng stack nằm ở [`infra/terraform/README.md`](../infra/terraform/README.md) — tệp này chỉ nói **làm gì, lúc
nào, kiểm gì**, và trỏ sang đó. Lệnh viết cho **Windows PowerShell**, chạy từ gốc kho trừ khi ghi khác.

Quy ước: `<...>` là giá trị bạn điền; **không commit** `*.tfvars`, email hay bất kỳ bí mật nào. Mọi `apply` đi sau một
`plan` đã đọc.

---

## 0. Trước khi bắt đầu

### 0.1 Công cụ và quyền

- [ ] Terraform ≥ 1.10, AWS CLI v2, Docker Desktop, Git (`terraform version`, `aws --version`, `docker version`).
- [ ] Ba tài khoản trong tổ chức AWS `o-u0xp6p6auq` **đang hoạt động**: management `243714547276`, audit `528657840905`,
      prod `942091277863` (khai ở `infra/terraform/chung/main.tf`).
- [ ] IAM Identity Center bật ở management; bạn có AdministratorAccess trên cả ba tài khoản.
- [ ] Profile `tp-mgmt` đã cấu hình (`aws configure sso --profile tp-mgmt`, SSO session `tp`).
- [ ] Mỗi phiên làm việc: `aws sso login --sso-session tp`.

### 0.2 Con người và địa chỉ — chốt trước, vì dữ liệu thật phụ thuộc vào chúng

- [ ] **Hai người** sẽ giữ KeyAdmin (nhóm `tp-key-admins`). Một người là điều kiện chặn dữ liệu thật (ADR-062).
- [ ] Địa chỉ nhận **cảnh báo** (`email_canh_bao`) — không nên chỉ là người giữ KeyAdmin.
- [ ] Hộp thư **vận hành** (`email_van_hanh`, một hay nhiều địa chỉ) — người trực hệ thống; thư ⑹ nhiều và lặp nên tách
      khỏi hộp thư an ninh (ADR-086). Có thể trùng người, nhưng nên là hộp thư khác.
- [ ] Tên miền công khai `ten_mien` (vd `app.<domain>`) và domain gửi thư (vd `thu.<domain>`); bạn sửa được DNS của chúng.
- [ ] Địa chỉ gửi của api và của cảnh báo (`<dia_chi_gui>@<domain>`, `<dia_chi_canh_bao>@<domain>`).

### 0.3 Việc tay kéo dài nhiều ngày — khởi động NGAY, song song với phần còn lại

- [ ] **SMS brandname Việt Nam** (tuần): hồ sơ sender ID ở AWS End User Messaging SMS, ba mẫu nội dung chép nguyên văn từ
      `apps/api/src/adapters/gui-sms.ts` (README, mục stack 85). Không có thì bỏ qua SMS ở lần đầu.
- [ ] **Zalo OA**: xác thực OA, ứng dụng liên kết, ba template ZNS (`otp`, `duong_dan`, `han_nop`). Không có thì bỏ qua Zalo.
- [ ] **SES production access**: chỉ xin được sau bước 9 (stack 80), nhưng duyệt mất 1–2 ngày — xin ngay khi xong bước 9.

---

## 1. Nền: state, audit, tổ chức

- [ ] **1.1 `00-bootstrap`** (profile `tp-mgmt`, state local) — bucket state.
  ```powershell
  cd infra\terraform\00-bootstrap; terraform init; terraform plan -out plan.tfplan; terraform apply plan.tfplan; cd ..\..\..
  ```
- [ ] **1.2 `10-audit`** — bucket CloudTrail, bucket neo (Object Lock COMPLIANCE 365 ngày), role `tp-anchor-writer`.
      Cần profile `tp-audit` (`aws configure sso --profile tp-audit`, trustprocure-audit / AdministratorAccess).
- [ ] **1.3** Bật một lần: `aws organizations enable-aws-service-access --service-principal cloudtrail.amazonaws.com --profile tp-mgmt`
- [ ] **1.4 `20-management`** — permission set `KeyAdmin`, CloudTrail tổ chức.
- [ ] **1.5** Gán **cả hai người** giữ khoá vào nhóm `tp-key-admins`; tạo profile `tp-prod` (AdministratorAccess),
      `tp-audit-keyadmin`, `tp-prod-keyadmin` (KeyAdmin) — README, "Chuẩn bị một lần".
- [ ] **1.6** Commit các `.terraform.lock.hcl` sinh ra (sau `terraform providers lock -platform=windows_amd64 -platform=linux_amd64`).

## 2. Danh tính và khoá

- [ ] **2.1 `30-prod-iam`** (`tp-prod`) — OIDC GitHub, task role, execution role, hai role deploy. **Trước 50**: KMS từ chối
      key policy trỏ tới role chưa tồn tại.
- [ ] **2.2 `40-kms-audit`** (`tp-audit-keyadmin`) — khoá ký mốc neo `alias/tp-anchor-sign`.
- [ ] **2.3 `50-kms-prod`** (`tp-prod-keyadmin`) — `tp-org-wrap`, `tp-receipt-sign`, `tp-totp`.
- [ ] **2.4** Tính **dấu vân tay khoá biên nhận** (README, "Khoá công khai biên nhận") và lưu lại — con số in vào hợp
      đồng, và là biến GitHub `TP_RECEIPT_FINGERPRINT` ở bước 12.

## 3. Cảnh báo — trước mọi thứ chạy thật, để lần đầu cũng có người nghe

- [ ] **3.1 `60-canh-bao`** (`tp-audit` + `tp-prod`):
  `infra\terraform\60-canh-bao\canh-bao.tfvars` (không commit — `*.tfvars` đã bị bỏ qua):
  ```hcl
  email_canh_bao = "<email an ninh>"
  email_van_hanh = ["<email van hanh>"]
  ```
  ```powershell
  cd infra\terraform\60-canh-bao; terraform init
  terraform plan -var-file canh-bao.tfvars -out plan.tfplan; terraform apply plan.tfplan; cd ..\..\..
  ```
  Stack 60 không phụ thuộc stack 90: rule ⑸ ⑹ bắt alarm theo TÊN/TIỀN TỐ, nên alarm sinh ra sau vẫn có thư.
- [ ] **3.2 Bấm xác nhận** thư AWS gửi tới `email_canh_bao` (topic `tp-canh-bao-khoa`) **và** tới từng địa chỉ
      `email_van_hanh` (topic `tp-canh-bao-van-hanh`). Địa chỉ chưa xác nhận = chưa nhận cảnh báo nào.
- [ ] **3.3 Đối chứng dương ⑴**: bằng `tp-prod-keyadmin`, `get-key-policy` rồi `put-key-policy` lại ĐÚNG policy ấy trên một
      khoá prod ⇒ có thư trong vài phút (README, "Rủi ro còn lại").
- [ ] **3.4 Đối chứng dương ⑵**: `aws ecs run-task --profile tp-prod --cluster khong-ton-tai --task-definition tp-unseal-worker`
      ⇒ lời gọi lỗi nhưng **có thư**.
- [ ] **3.5** Dự kiến: alarm ⑺ `tp-canh-bao-canh-moc-neo-khong-chay` có thể vào ALARM ở kỳ 12 giờ đầu nếu Lambda chưa
      chạy lượt nào — gọi tay một lần để về OK:
      `aws lambda invoke --profile tp-audit --function-name tp-canh-moc-neo out.json` (phải `0 to chuc, 0 thieu`).
- [ ] **3.6** Dự kiến: alarm ⑷ (36 giờ không có mốc neo) vào ALARM ngay và gửi thư — đúng, vì chưa có mốc neo nào. Nó về
      OK sau lượt `lich` đầu tiên có tổ chức (bước 13).

## 4. Phép đo ⒜ — bắt buộc trước dữ liệu thật

- [ ] **4.1 `70-do-kms`**: `apply`, `.\chay-do-kms.ps1` ⇒ bảng 18 bước, thoát 0; `terraform destroy`.
- [ ] **4.2** Apply stack 70 bắn cảnh báo ⑵ (`RegisterTaskDefinition` gắn role worker vào họ khác) ⇒ **phải có thư**.
- [ ] **4.3** Chép bảng kết quả vào `docs/STATE.md` khoản 15.

## 5. Kênh gửi

- [ ] **5.1 `80-ses`**: `-var ten_mien=<domain> -var dia_chi_gui=... -var dia_chi_canh_bao=...`; thêm bản ghi DNS
      (`terraform output ban_ghi_dns`): ba CNAME DKIM, MX + SPF của MAIL FROM, DMARC `p=none`.
- [ ] **5.2** Chờ SES xác minh domain (`aws sesv2 get-email-identity`), rồi **xin production access** ngay.
- [ ] **5.3 `85-sms-zalo`** (tuỳ chọn, khi brandname đã duyệt): `-var sender_id=<BRANDNAME>`; output `sms.registered = true`.
      Xin ra khỏi sandbox SMS, đặt trần chi tiêu. Zalo: nạp secret `tp/api/zalo-oa` (README, stack 85, bước 3).

## 6. Stack 90 — chạy thật

### 6.1 Chuẩn bị

- [ ] **Kiểm dịch vụ endpoint ở region** (ADR-076):
  ```powershell
  aws ec2 describe-vpc-endpoint-services --profile tp-prod --region ap-southeast-1 `
    --service-names com.amazonaws.ap-southeast-1.sms-voice com.amazonaws.ap-southeast-1.email --query 'ServiceNames'
  ```
  Thiếu `sms-voice` ⇒ bỏ nó khỏi `dich_vu_endpoint` (README, "Lọc tên miền"). Thiếu `email` ⇒ đổi `ses_endpoint_service`.
- [ ] **Tạo bốn secret** với host RDS TẠM (README, stack 90 bước 1): `tp/api/otp-peppers`, `tp/api/database-url`,
      `tp/worker/database-url`, `tp/neo/database-url`. Mật khẩu ≥ 24 ký tự ngẫu nhiên, mỗi vai một mật khẩu.
- [ ] **`prod.tfvars`** (không commit) — lần đầu KHÔNG chạy api và chỉ ghi log DNS:
  ```hcl
  ten_mien           = "<app.domain>"
  ses                = { tu_api = "<dia_chi_gui>@<domain>", tu_canh_bao = "<dia_chi_canh_bao>@<domain>", nhan_canh_bao = ["<email>"], configuration_set = "tp-thu" }
  # sms  = { danh_tinh_gui = "<BRANDNAME>", configuration_set = "tp-sms" }        # khi stack 85 xong
  # zalo = { template_otp = "...", template_invitation = "...", template_deadline = "..." }
  # Tạm, chỉ để qua validation ở 6.2 (biến đòi @sha256:); điền digest thật ở 6.3 TRƯỚC 6.4.
  anh = {
    api         = "tam@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    worker      = "tam@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    migrate     = "tam@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    web         = "tam@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    public_keys = "tam@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    neo         = "tam@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }
  so_ban_api         = 0     # bật ở 6.6, sau khi secret có host thật và migrate xong
  so_ban_worker      = 0     # bật ở bước 13 (ADR-040)
  che_do_dns         = "ALERT"   # chuyển BLOCK ở 6.8
  ```

### 6.2 Chứng chỉ và kho image

- [ ] ```powershell
  cd infra\terraform\90-ecs; terraform init
  terraform apply -var-file prod.tfvars -target aws_acm_certificate.api -target 'aws_ecr_repository.tp'
  terraform output ban_ghi_dns     # thêm CNAME xac_minh_acm ở DNS
  terraform output ecr
  ```

### 6.3 Build và đẩy image

- [ ] Theo README stack 90 bước 4 (sáu target: api, worker, migrate, web, public-keys, neo), thẻ = SHA commit.
- [ ] Điền `anh` trong `prod.tfvars` bằng URI **@sha256:** (`aws ecr describe-images ... --query 'imageDetails[0].imageDigest'`).

### 6.4 Phần còn lại

- [ ] `terraform plan -var-file prod.tfvars -out plan.tfplan` — đọc kỹ: VPC, RDS, ALB, DNS Firewall (ALERT), endpoint có
      policy, alarm `tp-van-hanh-*`, lịch `tp-neo-hang-ngay`. `terraform apply plan.tfplan` (chờ ACM xác minh).
- [ ] Dự kiến: vài thư ⑹ `…khong-con-target-khoe` cho `api` (0 task) — đúng, vì api chưa chạy; về OK ở 6.6.

### 6.5 Nối CSDL và migrate

- [ ] `terraform output rds_endpoint` ⇒ `put-secret-value` lại ba secret `*/database-url` với host thật.
- [ ] Thêm CNAME `cong_khai` (output `ban_ghi_dns`) trỏ tới ALB.
- [ ] `terraform output lenh_chay_migrate` ⇒ chạy; `/tp/migrate` phải có `da ap N migration` và các dòng `vai …`
      (gồm `app_neo_login`). Từ chối ⇒ **dừng**, đọc thông điệp, không sửa tay trong CSDL (ADR-061).

### 6.6 Bật api

- [ ] `so_ban_api = 1` ⇒ plan + apply. Log `/tp/api`: `khoa: aws-kms, bo gui: ses`, không `LechDongHoError`.
- [ ] Thư ⑹ trở về OK cho `api`.

### 6.7 Neo khoá biên nhận và kiểm công khai

- [ ] `terraform output lenh_chay_neo` ⇒ chạy lệnh `khoa_bien_nhan`; so byte với endpoint bằng tài khoản audit (README,
      "Job neo" — ba dòng `Get-FileHash`, phải `True`).
- [ ] README stack 90 bước 7: `/api/health`, `/nop-thau` (CSP), `/.well-known/trustprocure-receipt-keys` (sha256 trùng 2.4),
      header ADR-075 (`curl.exe -sI`), `http://` ⇒ 301.
- [ ] Nguồn thời gian (README, "Nguồn thời gian"): `ClockDrift` SYNCHRONIZED trong một task api; chép vào STATE khoản 15.

### 6.8 DNS Firewall: ALERT ⇒ BLOCK

- [ ] Sau ít nhất một ngày chạy (gồm một lượt `lich` 02:15 và một lần deploy ở bước 12), Logs Insights trên `/tp/dns`:
      `filter firewall_rule_action = "ALERT" | stats count() by query_name`. Mỗi tên hợp lệ còn thiếu ⇒ thêm vào
      `ten_duoc_phan_giai` (và test `hinh-dang-dns`), PR, deploy lại.
- [ ] Không còn tên hợp lệ nào ⇒ `che_do_dns = "BLOCK"`, plan + apply. Mỗi truy vấn lạ về sau ⇒ thư ⑸.

## 7. GitHub — pipeline deploy

- [ ] **7.1** Environments: `prod` (Required reviewers, chỉ `master`, biến từ `terraform output bien_github`) và
      `prod-worker` (người duyệt khác người bấm). Tên phải đúng — trust policy của stack 30 ghim chúng.
- [ ] **7.2** Biến cấp **repository**: `TP_TEN_MIEN`, `TP_RECEIPT_ACTIVE_KID` (`terraform output bien_github_repo`),
      `TP_RECEIPT_FINGERPRINT` (bước 2.4).
- [ ] **7.3** Chạy *Deploy — prod (bam tay)* với `api` ⇒ job `api` xanh (migrate không làm gì, service chạy bản mới,
      neo khoá không làm gì), job `kiem` xanh. Từ đây mọi deploy đi qua pipeline.

## 8. Tổ chức đầu tiên và worker

- [ ] **8.1** Tạo tổ chức đầu tiên qua sản phẩm.
- [ ] **8.2** `so_ban_worker = 1` ⇒ plan + apply (hoặc deploy `worker` qua pipeline sau khi đặt biến). Job `worker` của
      pipeline kiểm đủ task và log sạch; alarm `tp-van-hanh-worker-thieu-task` xuất hiện.
- [ ] **8.3** Sáng hôm sau: `/tp/neo` có lượt `lich` với `xuat=0 kiem=0`; alarm ⑷ trở về OK (có thư).

## 9. Trước dữ liệu thật — kiểm lại

- [ ] Hai người giữ KeyAdmin; người nhận cảnh báo không chỉ là họ.
- [ ] STATE khoản 15 có: bảng 18 bước ⒜, kết quả `ClockDrift`, và ngày giờ đối chứng dương 3.3, 3.4, 4.2.
- [ ] Mọi alarm `tp-van-hanh-*`, `tp-dns-bi-chan`, `tp-canh-bao-thieu-moc-neo` đang **OK**.
- [ ] `che_do_dns = BLOCK`; SES ra khỏi sandbox; DMARC nâng lên `quarantine` sau vài tuần báo cáo sạch.
- [ ] Dấu vân tay khoá biên nhận (2.4) đã in vào hợp đồng mẫu.

---

### Thư cảnh báo DỰ KIẾN trong lần dựng đầu — không phải sự cố

| Lúc | Thư | Vì sao |
|---|---|---|
| 3.1 | ⑷ thiếu mốc neo — ALARM | chưa có mốc neo nào; về OK ở 8.3 |
| 3.3, 3.4, 4.2 | ⑴, ⑵ | chính là đối chứng dương — **thiếu thư mới là sự cố** |
| 6.4 → 6.6 | ⑹ api không còn target khoẻ — ALARM rồi OK | api chạy 0 task tới 6.6 |
| 8.2 | ⑹ worker thiếu task — có thể ALARM rồi OK | alarm sinh ra trước khi task đầu lên |

Thư ⑹ tới hộp thư **vận hành** (`email_van_hanh`); mọi thư còn lại tới hộp thư **an ninh** (`email_canh_bao`). Một thư ⑹
lạc sang hộp an ninh, hay ngược lại, là cấu hình sai.

Mọi thư khác trong lần dựng đầu: dừng lại và đọc.

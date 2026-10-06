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
- [ ] **[S1.252]** Node 22 (từ 22.13; Node 26 không chạy) và pnpm ≥ 9, rồi `pnpm install` ở gốc kho — `pnpm kiem-truoc-apply`
      (6.4) chạy từ mã của kho (`node --version`, `pnpm --version`).
- [ ] Ba tài khoản trong tổ chức AWS `o-u0xp6p6auq` **đang hoạt động**: management `243714547276`, audit `528657840905`,
      prod `942091277863` (khai ở `infra/terraform/chung/main.tf`).
- [ ] IAM Identity Center bật ở management; bạn có AdministratorAccess trên cả ba tài khoản.
- [ ] Profile `tp-mgmt` đã cấu hình (`aws configure sso --profile tp-mgmt`, SSO session `tp`).
- [ ] Mỗi phiên làm việc: `aws sso login --sso-session tp`.

### 0.2 Con người và địa chỉ — chốt trước, vì dữ liệu thật phụ thuộc vào chúng

- [ ] **Hai người** sẽ giữ KeyAdmin (nhóm `tp-key-admins`). Một người là điều kiện chặn dữ liệu thật (ADR-062).
- [ ] Địa chỉ nhận **cảnh báo** (`email_canh_bao`) — không nên chỉ là người giữ KeyAdmin.
- [ ] Hộp thư **vận hành** (`email_van_hanh`, một hay nhiều địa chỉ) — người trực hệ thống; thư ⑹ nhiều và lặp nên tách
      khỏi hộp thư an ninh (ADR-088). Có thể trùng người, nhưng nên là hộp thư khác.
- [ ] Tên miền công khai `ten_mien` (vd `app.<domain>`) và domain gửi thư (vd `thu.<domain>`); bạn sửa được DNS của chúng.
- [ ] Địa chỉ gửi của api và của cảnh báo (`<dia_chi_gui>@<domain>`, `<dia_chi_canh_bao>@<domain>`).

### 0.3 Việc tay kéo dài nhiều ngày — khởi động NGAY, song song với phần còn lại

- [ ] **SMS brandname Việt Nam** (tuần): hồ sơ sender ID ở AWS End User Messaging SMS, ba mẫu nội dung chép nguyên văn từ
      `apps/api/src/adapters/gui-sms.ts` (README, mục stack 85). Không có thì bỏ qua SMS ở lần đầu.
- [ ] **Zalo OA**: xác thực OA, ứng dụng liên kết, ba template ZNS (`otp`, `duong_dan`, `han_nop`). Không có thì bỏ qua Zalo.
- [ ] **[rà 2026-10-01] Ít nhất MỘT trong hai kênh trên phải xong trước khi nhà cung cấp THẬT nộp thầu** — "bỏ qua ở lần đầu"
      chỉ đúng cho lần apply. OTP không bao giờ đi cùng kênh với link (ADR-015 mục 1): `/guest/redeem` chỉ mời chọn OTP ở kênh
      KHÁC kênh link (`apps/api/src/routes/anon.ts`), link mời mặc định đi bằng thư, và kênh chưa bật thì NÉM chứ không rơi về
      thư (ADR-069 mục 1). Chỉ có SES ⇒ nhà cung cấp mở được link mà không nhận được OTP, tức không nộp được — kịch bản
      `docs/PRODUCT.md` §11 dừng ở bước ấy. Brandname tính bằng tuần: đây là việc dài nhất trên đường tới pilot.
      `pnpm kiem-truoc-apply` báo `[VANG] kenh_otp` khi `sms` và `zalo` đều rỗng.
- [ ] **SES production access**: chỉ xin được sau 5.1 (stack 80), nhưng duyệt mất 1–2 ngày — xin ngay ở 5.2.
- [ ] **[apply lần đầu 2026-09-30] Quota Lambda của audit** (giờ–ngày) — xin ngay khi có profile `tp-audit` (1.2), TRƯỚC 3.1.
      Stack 60 đặt `reserved_concurrent_executions = 1` cho hai Lambda (⑺, ⑻), mà AWS giữ ≥ 10 lượt không đặt trước ⇒ trần
      *Concurrent executions* phải ≥ 12. Tài khoản mới có thể thấp hơn nhiều — audit đo được **5** —, và khi ấy 3.1 hỏng giữa
      chừng (xem 3.1).
  ```powershell
  aws lambda get-account-settings --profile tp-audit --query "AccountLimit.ConcurrentExecutions"
  aws service-quotas request-service-quota-increase --profile tp-audit --region ap-southeast-1 `
    --service-code lambda --quota-code L-B99A9384 --desired-value 1000
  ```

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
      **[rà 2026-10-01]** Tám tệp của lần apply đầu (stack 00–70: `hashicorp/aws` 6.66.0; stack 60 thêm `hashicorp/archive`
      2.8.1) đã commit, có hash của cả hai nền tảng. `providers lock` đòi `terraform get` trước (module `chung`). Stack 80, 85,
      90: commit tệp lock ở lần `init` đầu.

## 2. Danh tính và khoá

- [ ] **2.0 [S1.183 / lượt soi] Ba environment GitHub TRƯỚC 2.1** — `prod`, `prod-worker`, `prod-khoi-tao`, đủ luật bảo vệ
      của 7.1 (người duyệt, chỉ `master`, và với `prod-khoi-tao`: *Prevent self-review*, tắt admin bypass); biến của chúng điền
      ở 7.1. Trust policy của stack 30 ~~chỉ~~ ghim TÊN environment (**[S1.223 / khoản 252 ⑶]** và với `prod-khoi-tao` cả TỆP
      `khoi-tao.yml` — chỉ khi claim `sub` đã tuỳ biến, 2.0b), và GitHub tự tạo một environment KHÔNG bảo vệ khi một workflow
      nhắc tên chưa có: apply 2.1 trước thì trong khoảng tới 7.1, một workflow trên nhánh bất kỳ khai `environment: prod` là
      nhận được `tp-deploy`.
- [ ] **2.0b [S1.223 / khoản 252 ⑶] Tuỳ biến claim `sub` của OIDC TRƯỚC 2.1** — `infra/terraform/README.md`, mục "Tuỳ biến claim
      `sub`": một lệnh `gh api -X PUT repos/huubang1984/Purchasing-/actions/oidc/customization/sub` với
      `include_claim_keys = ["repo","context","job_workflow_ref"]` (đúng thứ tự), rồi `GET` cùng đường dẫn để đối chiếu. Trust policy
      của stack 30 đòi `sub` dạng ấy — đoạn `repo:` mang ID bất biến của kho (tạo sau 2026-07-15) và `job_workflow_ref`; apply 2.1 mà
      chưa làm bước này, hay làm bước này mà chưa apply 2.1, thì mọi job deploy bị AWS từ chối role (KHOÁ, không mở) cho tới khi hai
      phía khớp. Chuỗi `sub` là ĐỌC tài liệu GitHub: bước 4 của mục README nói cách in claim thật nếu 7.3 đỏ ở bước lấy role.
      **[rà 2026-10-01] Prod hiện tại:** stack 30 và 60 được apply ngày 2026-09-30 từ cây CHƯA có khoản 252 ⑴⑶ (vào master
      2026-10-01): trust policy của hai role deploy còn ghim `repo:huubang1984/Purchasing-:environment:<tên>`, dạng mà GitHub
      không cấp cho kho này (README, "Tuỳ biến claim `sub`"), và stack 60 chưa có ⑼. Làm 2.0b, apply lại 30, rồi apply lại 60
      (3.1) — trước 6.4. Theo diff, plan của 60 chỉ THÊM tám tài nguyên ⑼ (bốn rule, bốn target) và SỬA tại chỗ policy của
      topic `tp-canh-bao-khoa` — cộng `-1 → 1` ở hai Lambda nếu đã xoá `tam_override.tf`. `canh-bao.tfvars` và `tam_override.tf`
      bị git bỏ qua: apply từ một checkout khác thì chép chúng theo. Ngày 2026-10-01 `gh api …/oidc/customization/sub` còn trả
      `use_default: true`.
      **[mục C 2026-10-01] Đã làm** (chủ dự án, máy vận hành): quota Lambda của audit 40; plan 30 `0 to add, 2 to change, 0 to
      destroy`; PUT tuỳ biến bằng lệnh trường của README — lệnh pipe JSON trả HTTP 400 —, `GET` trả `use_default: false` và đúng
      ba khoá theo thứ tự; apply 30; `aws iam get-role`: `tp-deploy` hai chuỗi `sub` (`prod` với `job_workflow_ref:*`,
      `prod-khoi-tao` với `khoi-tao.yml@refs/heads/master`), `tp-deploy-worker` một (`prod-worker`), cả ba mở đầu bằng
      `repo:huubang1984@234519700/Purchasing-@1350087523`. Plan 60 `8 to add, 1 to change, 0 to destroy`, bốn rule ⑼ `ENABLED`;
      xoá `tam_override.tf` rồi plan và apply `0 added, 2 changed, 0 destroyed`, concurrency của hai Lambda bằng 1. Lần đo `sub`
      trên token thật vẫn là 7.3.
- [ ] **2.1 `30-prod-iam`** (`tp-prod`) — OIDC GitHub, task role, execution role, hai role deploy. **Trước 50**: KMS từ chối
      key policy trỏ tới role chưa tồn tại.
- [ ] **2.2 `40-kms-audit`** (`tp-audit-keyadmin`) — khoá ký mốc neo `alias/tp-anchor-sign`.
- [ ] **2.3 `50-kms-prod`** (`tp-prod-keyadmin`) — `tp-org-wrap`, `tp-receipt-sign`, `tp-totp`.
- [ ] **2.4** Tính **dấu vân tay khoá biên nhận** (README, "Khoá công khai biên nhận") và lưu lại — con số in vào hợp
      đồng, và là biến GitHub `TP_RECEIPT_FINGERPRINT` ở 7.2.

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
  **[apply lần đầu 2026-09-30]** Apply phải kết thúc bằng `Apply complete!` KHÔNG kèm dòng `Error`. Lần đầu, quota Lambda 5
  (0.3) làm hai `aws_lambda_function` hỏng (`tainted`) và Terraform BỎ QUA mọi thứ phụ thuộc — lịch của hai Lambda, và cả hai
  `aws_sns_topic_policy`: hai topic giữ policy mặc định, EventBridge publish thất bại (`FailedInvocations`), nên ⑴ ⑵ ⑶ ⑸ ⑹
  im lặng trong khi thư từ CloudWatch alarm (⑷, ⑻) vẫn tới — trông như đã chạy. ~~Kiểm cả hai topic, mỗi lệnh phải ra `True`:~~
  **[mục C 2026-10-01]** Kiểm cả hai topic — mỗi dòng phải kết thúc bằng `True`. Bản trước tìm `EventBridgeGuiCanhBao` ở cả hai,
  mà statement của topic vận hành tên `EventBridgeGuiVanHanh` từ 2026-09-26 (tách hộp thư vận hành): lệnh cũ chỉ ra MỘT `True`
  dù hai policy đều đúng, và `Select-String -Quiet` không in gì khi không khớp (đo 2026-10-01):
  ```powershell
  foreach ($p in @("tp-canh-bao-khoa","EventBridgeGuiCanhBao"), @("tp-canh-bao-van-hanh","EventBridgeGuiVanHanh")) {
    "$($p[0]) : " + [bool](aws sns get-topic-attributes --profile tp-audit --topic-arn "arn:aws:sns:ap-southeast-1:528657840905:$($p[0])" `
      --query Attributes.Policy --output text | Select-String $p[1] -Quiet)
  }
  ```
  Quota chưa được nâng thì tạm chạy không có concurrency đặt trước: tạo `infra\terraform\60-canh-bao\tam_override.tf` (khớp
  `*_override.tf` — git bỏ qua) với hai khối `resource "aws_lambda_function" "canh_moc_neo"` / `"canh_dang_ky"`, mỗi khối
  một dòng `reserved_concurrent_executions = -1`, rồi plan + apply. Quota được nâng ⇒ xoá tệp, plan chỉ được đổi `-1 → 1` ở
  hai Lambda, apply.
- [ ] **3.2 Bấm xác nhận** thư AWS gửi tới `email_canh_bao` (topic `tp-canh-bao-khoa`) **và** tới từng địa chỉ
      `email_van_hanh` (topic `tp-canh-bao-van-hanh`). Địa chỉ chưa xác nhận = chưa nhận cảnh báo nào.
      Đối chứng ⑻ (ADR-089), hai lần gọi tay Lambda đối chiếu đăng ký:
      `aws lambda invoke --profile tp-audit --function-name tp-canh-dang-ky out.json`, rồi đọc log
      `/aws/lambda/tp-canh-dang-ky`. **Trước** khi bấm xác nhận: mỗi địa chỉ một dòng `DANG KY HONG: cho xac nhan` (dòng ghi
      tên biến và vị trí, không ghi địa chỉ). **Sau**: dòng tổng `... 0 hong`. Alarm `tp-canh-bao-dang-ky-hong` về OK ở kỳ
      6 giờ kế — thư OK tới cả hai hộp là dấu hiệu cả hai đã nhận được.
- [ ] **3.3 Đối chứng dương ⑴**: bằng `tp-prod-keyadmin`, `get-key-policy` rồi `put-key-policy` lại ĐÚNG policy ấy trên một
      khoá prod ⇒ có thư trong vài phút (README, "Rủi ro còn lại").
- [ ] **3.3b [2026-10-02 / khoản 336] Đối chứng dương ⑴ cho thao tác ghi ngoài `PutKeyPolicy`.** Apply lại stack 60 bằng lệnh
      3.1 trước: ngoài thay đổi 3.1 đã nói (concurrency Lambda khi gỡ `tam_override.tf`), plan chỉ được đổi TẠI CHỖ ba
      resource của ⑴ — `aws_cloudwatch_event_rule.put_key_policy_audit`,
      `aws_cloudwatch_event_rule.put_key_policy_prod`, `aws_cloudwatch_event_target.put_key_policy_audit` — và không thay
      resource nào (`0 to destroy`). Rồi, trên một khoá THỬ dựng riêng, không đụng khoá thật nào:
      ```powershell
      $k = aws kms create-key --profile tp-prod-keyadmin --description "tp-thu-canh-bao-336 (xoa duoc)" --query KeyMetadata.KeyId --output text
      if ($LASTEXITCODE -eq 0 -and $k) {
        aws kms create-alias --profile tp-prod-keyadmin --alias-name alias/tp-thu-canh-bao-336 --target-key-id $k
        aws kms delete-alias --profile tp-prod-keyadmin --alias-name alias/tp-thu-canh-bao-336
        aws kms schedule-key-deletion --profile tp-prod-keyadmin --key-id $k --pending-window-in-days 7
        aws kms cancel-key-deletion --profile tp-prod-keyadmin --key-id $k
        aws kms schedule-key-deletion --profile tp-prod-keyadmin --key-id $k --pending-window-in-days 7
      } else { "create-key HONG - dung o day" }
      ```
      ⇒ sáu thư tới `email_canh_bao` trong vài phút, mỗi thư mở đầu bằng tên thao tác: `CreateKey`, `CreateAlias`,
      `DeleteAlias`, `ScheduleKeyDeletion` (`so ngay cho xoa 7`), `CancelKeyDeletion`, `ScheduleKeyDeletion`. Lệnh cuối để khoá
      thử tự xoá sau 7 ngày. Thiếu thư nào thì ⑴ chưa bắt thao tác ấy, dù `apply` xanh. `create-key` bị từ chối (một SCP của
      tổ chức — nằm ngoài kho, chưa đo) thì khối lệnh dừng ở đó: lần bị từ chối vẫn phải ra một thư `CreateKey` có `errorCode`. Ghi giờ
      các thư vào STATE khoản 336. **[2026-10-05] Đã làm** (chủ dự án): stack 60 apply lại; sáu thư đủ, đúng thứ tự, 14:31:23Z–14:31:34Z — khoản 336 đóng.
- [ ] **3.4 Đối chứng dương ⑵**: ~~`aws ecs run-task --profile tp-prod --cluster khong-ton-tai --task-definition tp-unseal-worker`
      ⇒ lời gọi lỗi nhưng **có thư**.~~ **[apply lần đầu 2026-09-30] Phép thử ấy KHÔNG BAO GIỜ có thư:** task definition
      `tp-unseal-worker` chưa tồn tại (stack 90 chưa apply) nên ECS từ chối ở bước kiểm đầu vào (`ClientException:
      TaskDefinition not found`) và CloudTrail ghi `"requestParameters": null` — rule ⑵ lọc theo `requestParameters` nên không
      khớp. Đối chứng dương của ⑵ dời sang **4.2**: apply stack 70 là một `RegisterTaskDefinition` THÀNH CÔNG gắn role worker
      vào họ `tp-do-kms-worker`.
- [ ] **3.5** Dự kiến: alarm ⑺ `tp-canh-bao-canh-moc-neo-khong-chay` có thể vào ALARM ở kỳ 12 giờ đầu nếu Lambda chưa
      chạy lượt nào — gọi tay một lần để về OK:
      `aws lambda invoke --profile tp-audit --function-name tp-canh-moc-neo out.json` (phải `0 to chuc, 0 thieu`).
- [ ] **3.6** Dự kiến: alarm ⑷ (36 giờ không có mốc neo) vào ALARM ngay và gửi thư — đúng, vì chưa có mốc neo nào. Nó về
      OK sau lượt `lich` đầu tiên có tổ chức (8.3).
- [ ] **3.7 [rà 2026-10-01] Đối chứng dương ⑼ (khoản 252 ⑴) — KHÔNG làm ở đây.** README và chú thích stack 60 đề
      `aws ecs run-task --cluster khong-ton-tai --task-definition tp-khoi-tao`: trước 6.4 họ `tp-khoi-tao` chưa tồn tại, nên đó
      đúng là phép thử đã gạch ở 3.4 — `requestParameters: null`, không bao giờ có thư; sau 6.4 thì chưa ai đo. Đối chứng dương
      của ⑼ nằm ở 8.1: `create-secret` bản khai ra một thư (mẫu d), và lần chạy workflow ra thư `RunTask` họ `tp-khoi-tao` bởi
      `assumed-role/tp-deploy/khoi-tao-<run id>` cùng thư `DeleteSecret`.

## 4. Phép đo ⒜ — bắt buộc trước dữ liệu thật

- [ ] **4.1 `70-do-kms`**: `apply`, `.\chay-do-kms.ps1` ⇒ bảng 18 bước, thoát 0; `terraform destroy`.
- [ ] **4.2** Apply stack 70 bắn cảnh báo ⑵ (`RegisterTaskDefinition` gắn role worker vào họ khác) ⇒ **phải có thư**.
- [ ] **4.3** Chép bảng kết quả vào `docs/STATE.md` khoản 15.

## 5. Kênh gửi

- [ ] **5.1 `80-ses`**: `-var ten_mien=<domain> -var dia_chi_gui=... -var dia_chi_canh_bao=...`; thêm bản ghi DNS
      (`terraform output ban_ghi_dns`): ba CNAME DKIM, MX + SPF của MAIL FROM, DMARC `p=none`.
- [ ] **5.2** Chờ SES xác minh domain (`aws sesv2 get-email-identity`), rồi **xin production access** ngay.
- [ ] **5.3 `85-sms-zalo`** (~~tuỳ chọn,~~ **[rà 2026-10-01]** không bắt buộc cho lần apply nhưng BẮT BUỘC — nó hoặc Zalo — trước
      nhà cung cấp thật, 0.3; khi brandname đã duyệt): `-var sender_id=<BRANDNAME>`; output `sms.registered = true`.
      Xin ra khỏi sandbox SMS, đặt trần chi tiêu. Zalo: nạp secret `tp/api/zalo-oa` (README, stack 85, bước 3).

## 6. Stack 90 — chạy thật

### 6.1 Chuẩn bị

- [ ] **Kiểm dịch vụ endpoint ở region** (ADR-076):
  ```powershell
  aws ec2 describe-vpc-endpoint-services --profile tp-prod --region ap-southeast-1 `
    --service-names com.amazonaws.ap-southeast-1.sms-voice com.amazonaws.ap-southeast-1.email --query 'ServiceNames'
  ```
  Thiếu `sms-voice` ⇒ bỏ nó khỏi `dich_vu_endpoint` (README, "Lọc tên miền"). Thiếu `email` ⇒ đổi `ses_endpoint_service`.
  **[S1.252]** `dich_vu_endpoint` là một `local` của `90-ecs/main.tf`, không phải biến — bỏ `sms-voice` là một PR sửa mã. Một tên
  không có ở region có thể làm CẢ lệnh báo `InvalidServiceName` thay vì trả danh sách ngắn hơn (chưa đo): khi ấy hỏi từng tên một.
- [ ] **Tạo ~~bốn~~ [S1.182] năm secret** với host RDS TẠM (README, stack 90 bước 1): `tp/api/otp-peppers`, `tp/api/database-url`,
      `tp/worker/database-url`, `tp/neo/database-url`, **[S1.182 / ADR-111]** `tp/khoi-tao/database-url` (vai
      `app_khoi_tao_login` — task migrate đọc nó để dựng vai). Mật khẩu ≥ 24 ký tự ngẫu nhiên, mỗi vai một mật khẩu.
      **[S1.252]** Mật khẩu CHỈ gồm chữ và số: `/ ? # % @ :` phá URL (`chay-migrate` đọc vai bằng `new URL`), còn `$` và dấu
      huyền bị PowerShell nội suy trong nháy kép của README. Sinh 48 ký tự hex: `$b = New-Object byte[] 24;
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })`.
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
    khoi_tao    = "tam@sha256:0000000000000000000000000000000000000000000000000000000000000000"   # [S1.183] task khởi tạo tổ chức
  }
  so_ban_api         = 0     # bật ở 6.6, sau khi secret có host thật và migrate xong
  so_ban_worker      = 0     # bật ở 8.2 (ADR-040)
  che_do_dns         = "ALERT"   # chuyển BLOCK ở 6.8
  ```

### 6.2 Chứng chỉ và kho image

- [ ] ```powershell
  cd infra\terraform\90-ecs; terraform init
  terraform apply -var-file prod.tfvars -target aws_acm_certificate.api -target 'aws_ecr_repository.tp'
  terraform output xac_minh_acm    # thêm CNAME này ở DNS
  terraform output ecr
  ```
  **[S1.252]** ~~`terraform output ban_ghi_dns`~~ — sau `apply -target`, output ấy chưa có trong state vì nó còn đọc ALB (đo trên
  Terraform 1.13.3: *Output not found*), nên không lấy được CNAME xác minh và 6.4 chờ ACM tới hết hạn. `xac_minh_acm` chỉ đọc
  chứng chỉ; `ban_ghi_dns` dùng ở 6.5 cho CNAME `cong_khai`.

### 6.3 Build và đẩy image

- [ ] Theo README stack 90 bước 4 (~~sáu~~ **[S1.183]** bảy target: api, worker, migrate, web, public-keys, neo, khoi-tao), thẻ = SHA commit.
- [ ] Điền `anh` trong `prod.tfvars` bằng URI **@sha256:** (~~`aws ecr describe-images ... --query 'imageDetails[0].imageDigest'`~~
      **[S1.252]** `aws ecr describe-images --profile tp-prod --repository-name <kho> --image-ids imageTag=<git-sha> --query
      'imageDetails[0].imageDigest' --output text` — lọc theo thẻ như pipeline (`deploy/trien-khai.sh`): kho có thể giữ thêm
      manifest khác, và `[0]` không lọc thì không chắc là image vừa đẩy). URI là
      `942091277863.dkr.ecr.ap-southeast-1.amazonaws.com/<kho>@sha256:…` — `<ecr>` ở README bước 4 là REGISTRY ấy, không phải URL
      từng kho mà `terraform output ecr` in.

### 6.4 Phần còn lại

- [ ] **Kiểm trước apply** (từ gốc kho; cần `terraform init` ở 6.2 và phiên SSO còn hạn):
  ```powershell
  pnpm kiem-truoc-apply --var-file infra\terraform\90-ecs\prod.tfvars
  ```
  Đọc biến qua `terraform console` (gồm mặc định) và hỏi tài khoản prod, **chỉ đọc**: không còn `<...>` hay digest
  `000…`; image nằm đúng kho ECR của prod và có thật; ~~bốn~~ **[S1.182]** năm secret (thêm `tp/api/zalo-oa` khi bật Zalo) tồn tại và đã có
  giá trị; domain gửi thư đã xác minh ở SES. Thoát 1 khi có `[DO]` — sửa rồi chạy lại, **không plan**. **[S1.252]** Một biến
  trượt validation của stack (vd. `anh` ghi thẻ thay digest) ⇒ tool in nguyên lời Terraform và thoát 2 — trước đó nó chỉ báo
  "đã terraform init chưa?" vì `terraform console` thoát 0 ở ca ấy (đo trên 1.13.3). Ở bước này
  `[VANG]` cho `so_ban_api`, `so_ban_worker`, `che_do_dns` là đúng; `[VANG] ses.sandbox` là đúng tới khi SES duyệt;
  **[rà 2026-10-01]** `[VANG] kenh_otp` là đúng tới khi stack 85 xong (5.3) — nhưng tới lúc ấy nhà cung cấp thật chưa nộp được (0.3).
  Tool không thấy được host TẠM trong secret `*/database-url` — việc đó của 6.5.
- [ ] ~~`terraform plan -var-file prod.tfvars -out plan.tfplan`~~ **[S1.252]** `terraform -chdir=infra\terraform\90-ecs plan
      -var-file prod.tfvars -out plan.tfplan` — kiểm trước apply chạy từ gốc kho, còn `prod.tfvars` và `plan.tfplan` nằm trong
      `90-ecs`; `-chdir` đặt mọi đường dẫn tương đối vào đó. Đọc kỹ: VPC, RDS, ALB, DNS Firewall (ALERT), endpoint có
      policy, alarm `tp-van-hanh-*`, lịch `tp-neo-hang-ngay`. ~~`terraform apply plan.tfplan`~~ `terraform -chdir=infra\terraform\90-ecs
      apply plan.tfplan` (chờ ACM xác minh). 6.6, 6.8 và 8.2 plan + apply bằng đúng hai lệnh này.
- [ ] Dự kiến: vài thư ⑹ `…khong-con-target-khoe` cho `api` (0 task) — đúng, vì api chưa chạy; về OK ở 6.6.
      **[S1.252]** Và một thư ⑹ OK cho MỖI alarm `tp-van-hanh-*` mới ở lần đánh giá đầu (khoảng 19, đếm trên mã), thư ⑸ trong
      lúc DNS còn ALERT, và có thể một thư ⑶ — bảng thư dự kiến cuối tệp.

### 6.5 Nối CSDL và migrate

- [ ] `terraform output rds_endpoint` ⇒ `put-secret-value` lại ~~ba~~ **[S1.182]** bốn secret `*/database-url` với host thật.
- [ ] Thêm CNAME `cong_khai` (output `ban_ghi_dns`) trỏ tới ALB.
- [ ] ~~`terraform output lenh_chay_migrate`~~ **[S1.252]** `terraform output -raw lenh_chay_migrate` (không `-raw` thì chuỗi in
      kèm nháy và ký tự thoát) ⇒ chạy; `/tp/migrate` phải có `da ap N migration` và các dòng `vai …`
      (gồm `app_neo_login`, **[S1.182]** và `app_khoi_tao_login`). Từ chối ⇒ **dừng**, đọc thông điệp, không sửa tay trong CSDL (ADR-061).

### 6.6 Bật api

- [ ] `so_ban_api = 1` ⇒ `pnpm kiem-truoc-apply --var-file infra\terraform\90-ecs\prod.tfvars` (hết `[VANG] so_ban_api`) ⇒ plan + apply. Log `/tp/api`: `khoa: aws-kms, bo gui: ses`, không `LechDongHoError`.
- [ ] Thư ⑹ trở về OK cho `api`.

### 6.7 Neo khoá biên nhận và kiểm công khai

- [ ] `terraform output lenh_chay_neo` ⇒ chạy lệnh `khoa_bien_nhan` (**[S1.252]** output là một đối tượng hai lệnh; in đúng lệnh
      bằng `(terraform output -json lenh_chay_neo | ConvertFrom-Json).khoa_bien_nhan`); so byte với endpoint bằng tài khoản audit (README,
      "Job neo" — ba dòng `Get-FileHash`, phải `True`).
- [ ] README stack 90 bước 7: `/api/health`, `/nop-thau` (CSP), `/.well-known/trustprocure-receipt-keys` (sha256 trùng 2.4),
      header ADR-075 (~~`curl.exe -sI`~~ **[S1.252]** `curl.exe -s -D - -o NUL https://<ten_mien>/api/health` — `-I` gửi HEAD, và
      `api` trả 405 cho HEAD: header của ALB vẫn có nhưng dòng trạng thái gây nhầm), `http://` ⇒ 301.
- [ ] Nguồn thời gian (README, "Nguồn thời gian"): `ClockDrift` SYNCHRONIZED trong một task api; chép vào STATE khoản 15.
      **[rà 2026-10-01]** Lệnh `curl` "trong một task" của README không chạy được — stack 90 không bật ECS Exec và image
      `node:22-bookworm-slim` không có `curl`; README nay đề một task `tp-migrate` chạy một lần với lệnh ghi đè ~~(chưa đo)~~ **[S1.252]** (chưa đo trên
      AWS; phần cục bộ đã đo và ghim — README nói cách đọc `CLOCKDRIFT undefined`: task vẫn thoát 0 nhưng CHƯA phải kết quả).

### 6.8 DNS Firewall: ALERT ⇒ BLOCK

- [ ] Sau ít nhất một ngày chạy (gồm một lượt `lich` 02:15 và một lần deploy ở 7.3), Logs Insights trên `/tp/dns`:
      `filter firewall_rule_action = "ALERT" | stats count() by query_name`. Mỗi tên hợp lệ còn thiếu ⇒ thêm vào
      `ten_duoc_phan_giai` (và test `hinh-dang-dns`), PR, ~~deploy lại~~ **[S1.252]** rồi plan + apply stack 90 như 6.4 — danh
      sách nằm trong Terraform, và pipeline không apply Terraform.
- [ ] Không còn tên hợp lệ nào ⇒ `che_do_dns = "BLOCK"`, plan + apply. Mỗi truy vấn lạ về sau ⇒ thư ⑸.

## 7. GitHub — pipeline deploy

- [ ] **7.1** Environments: `prod` (Required reviewers, chỉ `master`, biến từ `terraform output bien_github`) và
      `prod-worker` (người duyệt khác người bấm). Tên phải đúng — trust policy của stack 30 ghim chúng.
      **[S1.183 / ADR-111]** Và `prod-khoi-tao`: Required reviewers **và *Prevent self-review* BẬT** (người bấm không tự
      duyệt được lần tạo tổ chức và gán vai ~~— không mã nào của kho kiểm được cài đặt này~~), **[lượt soi] và BỎ CHỌN *Allow
      administrators to bypass configured protection rules*** — mặc định nó BẬT, và chủ kho cá nhân là admin, tự bấm rồi tự vượt
      được; ít nhất hai người duyệt để người bấm luôn có người khác duyệt, chỉ `master`, biến `TP_SUBNETS_UNG_DUNG` và
      `TP_SG_KHOI_TAO` từ `terraform output bien_github_khoi_tao` (biến environment không dùng chung giữa hai environment).
      **[lượt soi]** Job `chay` kiểm KẾT QUẢ của các cài đặt ấy: lịch sử duyệt của run phải có một NGƯỜI khác người bấm duyệt
      `prod-khoi-tao`, không thì dừng trước khi lấy quyền AWS. Nên bỏ chọn admin bypass ở cả `prod-worker`.
- [ ] **7.2** Biến cấp **repository**: `TP_TEN_MIEN`, `TP_RECEIPT_ACTIVE_KID` (`terraform output bien_github_repo`),
      `TP_RECEIPT_FINGERPRINT` (bước 2.4).
- [ ] **7.3** Chạy *Deploy — prod (bam tay)* với `api` ⇒ job `api` xanh (migrate không làm gì, service chạy bản mới,
      neo khoá không làm gì), job `kiem` xanh. Từ đây mọi deploy đi qua pipeline.

## 8. Tổ chức đầu tiên và worker

- [ ] **8.1** Tạo tổ chức đầu tiên qua sản phẩm. ~~**[S1.168] BƯỚC NÀY CHƯA LÀM ĐƯỢC: sản phẩm chưa có đường nào tạo
      tổ chức, người dùng hay gán vai trên prod.**~~ **[S1.183]** Làm bằng workflow khởi tạo — gạch đầu dòng cuối của bước này;
      các gạch đầu dòng ngay dưới là lịch sử của lúc bước này còn kẹt.
  - `app_api` không có INSERT trên `organizations` (chỉ SELECT và UPDATE(name) — `db/migrations/002_organizations_and_users.sql`).
    Nó có INSERT trên `users` và `user_roles`, nhưng không route nào dùng, và không vai nào giữ `role.grant`.
  - ~~`deploy/Dockerfile` không có đích nào làm việc này.~~ **[S1.183]** Có đích `khoi-tao`.
  - Chỉ hai công cụ DEV chèn được tổ chức: `tools/gieo-demo` tự khai không phải đường sản xuất (in token dạng rõ),
    `tools/pilot-gia-lap` chỉ nhận CSDL cục bộ.
  - Hệ quả: 8.2 cũng kẹt, vì worker từ chối khởi động khi chưa có tổ chức nào (ADR-040). **[S1.183]** Hết kẹt khi 8.1 chạy
    xong.
  - ~~Cách làm chờ chủ dự án quyết.~~ **[S1.182]** Đã chốt — gạch đầu dòng cuối của bước này. Đề xuất ngày 2026-09-27: một task
    ECS chạy một lần, cùng khuôn `tp-migrate` và `tp-neo`,
    không mở route quản trị. **[S1.173]** Ba phương án, trade-off và các câu cần chốt: `docs/DE-XUAT-TAO-TO-CHUC.md` —
    kể cả chỗ hở thứ hai đo ở vòng ấy: người dùng đầu tiên không có đường xin link đăng nhập qua giao diện.
    **[S1.176 / ADR-107]** Chỗ hở thứ hai đã sửa: `/login` có ô xin link, và thư đăng nhập mang mã tổ chức.
  - **[S1.182 / ADR-111] Chủ dự án đã chốt: phương án A, vai CSDL hẹp.** Đã có: vai `app_khoi_tao` (migration `075`,
    canh ở `hardening.always.sql`), secret `tp/khoi-tao/database-url` cho task migrate (6.1), và công cụ
    `tools/khoi-tao-to-chuc` — `pnpm khoi-tao tao|them-nguoi`, một giao dịch mỗi lần, có sổ từ hàng đầu tiên, không in
    email hay họ tên. ~~**Vẫn chưa làm được trên prod:** đích `khoi-tao` của `deploy/Dockerfile`, kho ECR và task definition
    `tp-khoi-tao`, task role, workflow chạy có người duyệt và xoá bí mật bản khai thuộc vòng hạ tầng kế (ADR-111 mục 8;
    STATE khoản 251). Bước này sẽ viết lại khi vòng ấy xong.~~
  - **[S1.183 / ADR-111] BƯỚC NÀY NAY LÀ LỆNH CHẠY** — workflow *Khoi tao to chuc — prod (bam tay)*; cần 6.3 có image
    `khoi_tao`, 6.4 đã apply với nó, và environment `prod-khoi-tao` của 7.1. **[lượt soi]** Bảy đầu vào thay sáu: thêm băm
    SHA-256 của bản khai, và số người THEO TỪNG MÃ VAI thay tổng số vai; mã tổ chức do workflow chọn.
    1. Viết bản khai JSON (mẫu ở đầu `tools/khoi-tao-to-chuc/src/ban-khai.ts`) bằng một trình soạn lưu UTF-8 (VS Code, Notepad)
       — KHÔNG bằng `>` hay `Out-File` của PowerShell 5 (UTF-16). Nó mang email và họ tên, nên chỉ ở máy người vận hành, và XOÁ
       tệp ngay sau các lệnh dưới. **[lượt soi]** AWS CLI v2 đọc `file://` theo code page của Windows (cp1252) nếu không đặt
       biến dưới — tiếng Việt thành chữ vỡ mà không báo lỗi:
       **[S1.252]** Lưu tệp ở `$env:TEMP`, không trong thư mục kho (kho công khai, `.gitignore` không bỏ qua nó), và xuống dòng
       **LF**: AWS CLI đọc `file://` ở chế độ văn bản nên BỎ `\r`, còn `Get-FileHash` băm byte trên đĩa — tệp CRLF (mặc định của VS
       Code và Notepad trên Windows) cho hai băm khác nhau và task dừng ở *"bản khai không khớp băm SHA-256 đã duyệt"*, chạy lại
       vẫn vậy. VS Code: bấm `CRLF` ở thanh trạng thái → `LF`, lưu lại.
       ```powershell
       $env:AWS_CLI_FILE_ENCODING = "UTF-8"
       $f = "$env:TEMP\ban-khai.json"
       (Get-Content -Raw $f).Contains("`r")                                         # [S1.252] phải ra False
       (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()                            # ghi lại: bam
       aws secretsmanager create-secret --profile tp-prod --name tp/khoi-tao/ban-khai/<slug> `
         --secret-string "file://$f" --query VersionId --output text                 # ghi lại: phien_ban
       Remove-Item $f
       ```
       Tên bí mật là `tp/khoi-tao/ban-khai/` + một slug (a-z, 0-9, gạch nối) — kho là kho CÔNG KHAI, tên và mọi đầu vào của
       run ai cũng đọc được: đừng đặt email hay tên khách vào đó nếu danh sách khách là bí mật kinh doanh.
       **[S1.252]** Slug: 3–63 ký tự, không mở hay đóng bằng gạch nối. Ở `che_do = tao`, đầu vào `to_chuc` phải TRÙNG
       `toChuc.slug` của bản khai (task so hai bên); dùng chính slug ấy cho tên bí mật là cách ít nhầm nhất.
       **[rà 2026-10-01]** `create-secret` này ra một thư ⑼ tới hộp thư an ninh — đối chứng dương của ⑼ (3.7). Không có thư ⇒ ⑼
       chưa chạy (stack 60 trên prod còn là bản trước khoản 252 — 2.0b): dừng, đừng bấm workflow.
    2. Actions → *Khoi tao to chuc — prod (bam tay)* → Run workflow trên `master`: `che_do = tao`, `bi_mat`, `phien_ban`,
       `bam`, `to_chuc = <slug>`, `so_nguoi`, `vai` (số người mang từng mã vai theo thứ tự `REQUESTER, BUYER, TECHNICAL,
       PROCUREMENT_MANAGER, FINANCE, DIRECTOR`, **[S1.252]** `DATA_STEWARD` — workflow trước vòng này không nhận mã thứ bảy, vd
       `BUYER=1,PROCUREMENT_MANAGER=2,DIRECTOR=1`).
    3. Người KHÁC người bấm đọc bảng *điều người duyệt duyệt* ở tóm tắt của job `build` — người bấm, tên, phiên bản, băm, slug,
       mã tổ chức, số người, số theo vai —, đối chiếu với YÊU CẦU mở tổ chức (khách nào, bao nhiêu người, ai mang vai gì; có tệp
       bản khai qua kênh khác thì đối chiếu cả băm), rồi duyệt ở `prod-khoi-tao`.
    4. Job `chay` xanh ⇒ tóm tắt có *Người duyệt: @…*, dòng kết quả (mã tổ chức, số người, vai) và *đã xoá*. Gửi `/login#<mã>`
       cho từng người; mỗi người tự xin link ở ô của `/login` (ADR-107). **[S1.252]** SES còn sandbox (`[VANG] ses.sandbox`) thì
       chỉ địa chỉ ĐÃ XÁC MINH nhận được thư — chờ production access (5.2) hay xác minh từng địa chỉ trước bước này.
       **[rà 2026-10-01]** Lần chạy ra thêm thư ⑼: `RunTask` họ `tp-khoi-tao` bởi `assumed-role/tp-deploy/khoi-tao-<run id>` — đối
       chiếu `<run id>` với run — và `DeleteSecret` bản khai.
    5. **[lượt soi]** Job `chay` KHÔNG xanh — hỏng, bị từ chối, bị huỷ, hay artifact hết hạn — ⇒ bí mật CÒN; job `nhac` nói điều
       ấy ở tóm tắt. Chạy lại là an toàn (đã commit thì dừng ở "slug đã có" / "email đã có"); sửa bản khai thì `put-secret-value`
       với cùng biến mã hoá — VersionId và băm MỚI, một lần duyệt mới —; bỏ thì xoá tay. Sau MỌI lần không xanh, soát bí mật
       còn sót: `aws secretsmanager list-secrets --profile tp-prod --filters Key=name,Values=tp/khoi-tao/ban-khai/ --query
       'SecretList[].Name'`. Bản khai lệch bảng đã duyệt — băm, tổ chức, số người, số theo vai — thì task dừng TRƯỚC khi chạm
       CSDL.
    Thêm người về sau: như trên với `che_do = them-nguoi`, `to_chuc = <mã tổ chức>`.
- [ ] **8.2** `so_ban_worker = 1` ⇒ `pnpm kiem-truoc-apply` như 6.4 ⇒ plan + apply ~~(hoặc deploy `worker` qua pipeline sau khi đặt biến)~~.
      **[S1.252]** Chỉ apply đổi được số task: pipeline chỉ thay image (`update-service`), và job `worker` của nó từng coi 0/0 task
      là đạt — nay nó đỏ khi muốn 0 task. Job `worker` của
      pipeline kiểm đủ task và log sạch; alarm `tp-van-hanh-worker-thieu-task` xuất hiện.
- [ ] **8.3** Sáng hôm sau: `/tp/neo` có lượt `lich` với ~~`xuat=0 kiem=0`~~ **[ghi muộn ngày 2026-09-27]** dòng
      `lich: xuat=OK kiem=OK` — lệnh in `OK`/`HONG`, không in mã số (`tools/neo-so-kiem-toan/src/index.ts`, hàm `lich`);
      alarm ⑷ trở về OK (có thư).

## 9. Trước dữ liệu thật — kiểm lại

- [ ] Hai người giữ KeyAdmin; người nhận cảnh báo không chỉ là họ.
- [ ] **[2026-10-02 / khoản 336]** Cảnh báo cho mọi thao tác ghi của KeyAdmin, không chỉ `PutKeyPolicy`: tắt khoá, hẹn xoá khoá, đổi hay xoá alias, tắt xoay khoá. ~~Hôm nay ⑴ chỉ bắt `PutKeyPolicy` — khoản ấy ở rổ A.~~ **[sửa 2026-10-02]** Mã đã bắt cả 17 thao tác; khoản ấy vẫn ở rổ A tới khi stack 60 được apply lại và 3.3b có đủ sáu thư. **[2026-10-05]** Đã apply lại và đã đủ sáu thư — khoản 336 đóng.
- [ ] **[rà 2026-10-01]** Ít nhất một kênh OTP ngoài thư (SMS hay Zalo) đã bật — `pnpm kiem-truoc-apply` hết `[VANG] kenh_otp` (0.3).
- [ ] STATE khoản 15 có: bảng 18 bước ⒜, kết quả `ClockDrift`, và ngày giờ đối chứng dương 3.3, ~~3.4,~~ 4.2, **[rà 2026-10-01]** 8.1 (⑼).
- [ ] Mọi alarm `tp-van-hanh-*`, `tp-dns-bi-chan`, `tp-canh-bao-thieu-moc-neo` đang **OK**.
- [ ] `che_do_dns = BLOCK`; SES ra khỏi sandbox; DMARC nâng lên `quarantine` sau vài tuần báo cáo sạch.
- [ ] Dấu vân tay khoá biên nhận (2.4) đã in vào hợp đồng mẫu.

---

### Thư cảnh báo DỰ KIẾN trong lần dựng đầu — không phải sự cố

| Lúc | Thư | Vì sao |
|---|---|---|
| 3.1 | ⑷ thiếu mốc neo — ALARM | chưa có mốc neo nào; về OK ở 8.3 |
| 3.2 | ⑻ đăng ký hỏng — ALARM rồi OK, tới cả hai hộp | Lambda chạy trước khi bạn bấm xác nhận; thư ALARM có thể không tới ai |
| 3.3, ~~3.4,~~ 4.2 | ⑴, ⑵ | chính là đối chứng dương — **thiếu thư mới là sự cố** |
| 3.3b | **[khoản 336]** ⑴ — sáu thư thao tác ghi trên khoá thử | chính là đối chứng dương — **thiếu thư mới là sự cố** |
| 6.4 → 6.6 | ⑹ api không còn target khoẻ — ALARM rồi OK | api chạy 0 task tới 6.6 |
| 6.4 | **[S1.252]** ⑹ OK cho từng alarm `tp-van-hanh-*` mới — khoảng 19 (đếm trên mã); thêm một ở 6.6, một ở 8.2 | rule ⑹ bắt MỌI lần vào OK, kể cả lần đánh giá đầu từ INSUFFICIENT_DATA |
| 6.4 → 6.8 | **[S1.252]** ⑸ `tp-dns-bi-chan` | bộ lọc đếm cả ALERT: mỗi tên ngoài danh sách là một lần đếm — đọc tên ở `/tp/dns`, thêm ở 6.8 |
| 6.4 → 6.5 | **[S1.252]** ⑶ job neo hỏng — chỉ khi 02:15 rơi vào giữa hai bước | lịch `tp-neo-hang-ngay` có từ 6.4, CSDL chưa migrate tới 6.5 |
| 8.1 | **[rà 2026-10-01]** ⑼ — `CreateSecret`, rồi `RunTask` và `DeleteSecret` của workflow | chính là đối chứng dương của ⑼ (3.7) — **thiếu thư mới là sự cố**; thư ⑼ KHÔNG khớp một run đã duyệt thì dừng task (README, khoản 252) |
| 8.2 | ⑹ worker thiếu task — có thể ALARM rồi OK | alarm sinh ra trước khi task đầu lên |

Thư ⑹ tới hộp thư **vận hành** (`email_van_hanh`); mọi thư còn lại tới hộp thư **an ninh** (`email_canh_bao`). Một thư ⑹
lạc sang hộp an ninh, hay ngược lại, là cấu hình sai.

Mọi thư khác trong lần dựng đầu: dừng lại và đọc.

# Stack 60 — hai cảnh báo cho hai rủi ro còn lại của ADR-062 (README, "Rủi ro còn lại"), và hai cho job neo:
#   ⑴ KEY POLICY bị sửa, trên mọi khoá KMS của audit và prod.
#   ⑵ Một task mang role WORKER chạy ngoài service chính thức `tp-unseal-worker`.
#   ⑶ [ADR-072] Job neo `tp-neo` (lịch hằng ngày) dừng mà không thành công.
#   ⑷ [ADR-073] 36 giờ không có mốc neo sổ kiểm toán mới nào trong bucket neo — bắt đúng ca ⑶ mù: lịch KHÔNG chạy
#      (Scheduler bị tắt/xoá, role sai, image không kéo được mà không có task nào dừng).
#   ⑸ [ADR-076] Một truy vấn DNS ngoài danh sách được phép trong VPC prod (DNS Firewall của stack 90 chặn/cảnh báo) —
#      alarm `tp-dns-bi-chan` ở prod vào ALARM ⇒ chuyển sang audit ⇒ email.
#   ⑹ [ADR-077] Vận hành: mọi alarm prod mang tiền tố `tp-van-hanh-` (ALB, ECS, RDS — stack 90) vào ALARM hoặc trở về
#      OK ⇒ chuyển sang audit ⇒ email. [ADR-086] Đi topic RIÊNG `tp-canh-bao-van-hanh` tới `email_van_hanh`: thư vận hành
#      nhiều và lặp (ALARM rồi OK), không được làm chìm thư khoá/neo của topic `tp-canh-bao-khoa`.
#   ⑺ [ADR-084] Mốc neo THEO TỪNG TỔ CHỨC: Lambda `tp-canh-moc-neo` ở audit, mỗi 6 giờ, báo tổ chức từng được neo mà
#      36 giờ không có mốc mới — ca một tổ chức bị bỏ khỏi danh sách ở prod mà job `lich` vẫn thoát 0.
#
# ⑴
# Vì sao: KeyAdmin có kms:PutKeyPolicy (không tránh được — không ai sửa được policy thì khoá hỏng
# vĩnh viễn), nên về lý thuyết KeyAdmin tự gỡ lệnh Deny rồi tự cấp Decrypt trên alias/tp-org-wrap.
# Không lớp nào CHẶN được đường ấy; stack này làm cho nó KHÔNG IM LẶNG (README, "Rủi ro còn lại").
#
# Cách đi, và vì sao cảnh báo nằm ở AUDIT:
#   prod  — rule trên default bus bắt PutKeyPolicy, chuyển nguyên sự kiện sang default bus của audit.
#   audit — rule bắt PutKeyPolicy (của chính audit, và của prod được chuyển sang) ⇒ SNS ⇒ email.
# Người có AdministratorAccess ở prod xoá được rule chuyển tiếp của prod, nhưng không chạm được
# SNS/rule ở audit; và chính lần xoá ấy nằm trong CloudTrail tổ chức. KeyAdmin (chỉ quyền kms:*)
# không sửa được cả hai phía.
#
# Bắt cả lần gọi THẤT BẠI (errorCode khác rỗng): một lần thử sửa policy bị từ chối cũng là tín hiệu.
#
# ⑵ Role `tp-unseal-worker` là role duy nhất có kms:Decrypt trên tp-org-wrap, và `tp-deploy-worker`
# PassRole được nó ⇒ pipeline ấy (hay ai chiếm được nó) chạy được MỘT TASK BẤT KỲ mang quyền giải
# mã. Đường chính thức DUY NHẤT là ECS service `tp-unseal-worker`, mà task của service do bộ lập
# lịch ECS khởi — không phải một lời gọi RunTask/StartTask của ai. Nên bắt ba hình dạng:
#   a. RunTask/StartTask với task definition họ `tp-unseal-worker` (họ của worker dùng lại tên role
#      — QUY ƯỚC mà stack ECS sau này phải giữ; đổi họ thì sửa `ho_worker` ở đây);
#   b. RunTask/StartTask ghi đè `taskRoleArn` thành role worker (với BẤT KỲ task definition nào);
#   c. RegisterTaskDefinition gắn role worker vào một họ KHÁC `tp-unseal-worker`.
# Cả ba bắt kể lần bị từ chối. KHÔNG bắt: CreateService/UpdateService một service khác dùng họ
# worker — đường ấy đi qua `tp-deploy-worker` có duyệt tay; và thay image trong chính họ worker.
#
# Tài khoản: audit + prod. Profile: tp-audit và tp-prod (AdministratorAccess). Chạy sau 10 và 20
# (CloudTrail tổ chức phải bật: sự kiện "AWS API Call via CloudTrail" đi ra từ đó).
#
# Biến bắt buộc `email_canh_bao` (⑴–⑸, ⑺) và `email_van_hanh` (⑹, ADR-086) — KHÔNG commit giá trị; truyền bằng -var hay
# tệp *.tfvars ngoài git. AWS gửi thư xác nhận tới từng địa chỉ; chưa bấm xác nhận thì địa chỉ ấy chưa nhận gì.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
    # [ADR-084] Đóng gói tệp Lambda ⑺ thành zip lúc plan.
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "60-canh-bao/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "tp-mgmt"
    encrypt      = true
    use_lockfile = true
  }
}

module "chung" { source = "../chung" }

variable "email_canh_bao" {
  description = "Địa chỉ nhận cảnh báo sửa key policy (người giữ KeyAdmin KHÔNG nên là người duy nhất nhận)."
  type        = string
  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.email_canh_bao))
    error_message = "email_canh_bao phải là một địa chỉ email."
  }
}

variable "email_van_hanh" {
  description = "[ADR-086] Người nhận thư VẬN HÀNH ⑹ (alarm tp-van-hanh-* của prod, ALARM và OK) — tách khỏi email_canh_bao."
  type        = list(string)
  validation {
    condition     = length(var.email_van_hanh) > 0 && alltrue([for e in var.email_van_hanh : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", e))])
    error_message = "email_van_hanh phải là danh sách ít nhất một địa chỉ email."
  }
}

provider "aws" {
  alias               = "audit"
  region              = module.chung.region
  profile             = "tp-audit"
  allowed_account_ids = [module.chung.account.audit]
  default_tags { tags = { du-an = "trustprocure", stack = "60-canh-bao" } }
}

provider "aws" {
  alias               = "prod"
  region              = module.chung.region
  profile             = "tp-prod"
  allowed_account_ids = [module.chung.account.prod]
  default_tags { tags = { du-an = "trustprocure", stack = "60-canh-bao" } }
}

locals {
  audit  = module.chung.account.audit
  prod   = module.chung.account.prod
  region = module.chung.region

  # Một mẫu cho cả hai phía: mọi PutKeyPolicy trên KMS, thành công hay bị từ chối.
  mau_put_key_policy = jsonencode({
    source      = ["aws.kms"]
    detail-type = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["kms.amazonaws.com"]
      eventName   = ["PutKeyPolicy"]
    }
  })

  bus_audit_arn = "arn:aws:events:${local.region}:${local.audit}:event-bus/default"

  ho_worker       = module.chung.role.unseal_worker
  role_worker_arn = module.chung.role_arn_prod.unseal_worker

  # ⑵ — chỉ sự kiện của prod (worker chỉ sống ở prod).
  mau_task_worker = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["AWS API Call via CloudTrail"]
    account     = [local.prod]
    detail = {
      eventSource = ["ecs.amazonaws.com"]
      "$or" = [
        {
          eventName = ["RunTask", "StartTask"]
          requestParameters = {
            taskDefinition = [
              { prefix = "${local.ho_worker}:" },
              { equals-ignore-case = local.ho_worker },
              { wildcard = "arn:aws:ecs:*:task-definition/${local.ho_worker}:*" },
            ]
          }
        },
        {
          eventName         = ["RunTask", "StartTask"]
          requestParameters = { overrides = { taskRoleArn = [local.role_worker_arn] } }
        },
        {
          eventName = ["RegisterTaskDefinition"]
          requestParameters = {
            taskRoleArn = [local.role_worker_arn]
            family      = [{ anything-but = local.ho_worker }]
          }
        },
      ]
    }
  })

  # ⑶ [ADR-072] Job neo (`tp-neo`, lịch hằng ngày) DỪNG mà không thành công: container thoát ≠ 0 (xuất hay kiểm
  # hỏng ở ít nhất một tổ chức — `kiem` đỏ là dấu hiệu sổ bị sửa/cắt) hoặc task không khởi động được. Không có
  # cảnh báo này thì một lịch hỏng im lặng hàng tháng — đúng khuôn H9-3 của ADR-026.
  # ⑸ [ADR-076] Tên alarm do stack 90 đặt (`local.ten_alarm_dns`) — `hinh-dang-dns.test.ts` so hai phía.
  ten_alarm_dns = "tp-dns-bi-chan"
  mau_dns_bi_chan = jsonencode({
    source      = ["aws.cloudwatch"]
    detail-type = ["CloudWatch Alarm State Change"]
    account     = [local.prod]
    detail = {
      alarmName = [local.ten_alarm_dns]
      state     = { value = ["ALARM"] }
    }
  })

  # ⑹ [ADR-077] Bắt THEO TIỀN TỐ — stack 90 thêm alarm vận hành mới mà không phải sửa stack này.
  tien_to_van_hanh = "tp-van-hanh-"
  mau_van_hanh = jsonencode({
    source      = ["aws.cloudwatch"]
    detail-type = ["CloudWatch Alarm State Change"]
    account     = [local.prod]
    detail = {
      alarmName = [{ prefix = local.tien_to_van_hanh }]
      state     = { value = ["ALARM", "OK"] }
    }
  })

  mau_neo_hong = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    account     = [local.prod]
    detail = {
      group      = ["family:tp-neo"]
      lastStatus = ["STOPPED"]
      "$or" = [
        { containers = { exitCode = [{ anything-but = 0 }] } },
        { stopCode = ["TaskFailedToStart"] },
      ]
    }
  })
}

# ---------------------------------------------------------------------------------------------
# AUDIT — nhận sự kiện của prod, bắt cả của chính mình, gửi email
# ---------------------------------------------------------------------------------------------
resource "aws_cloudwatch_event_bus_policy" "nhan_tu_prod" {
  provider       = aws.audit
  event_bus_name = "default"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "ProdChuyenCanhBaoKhoa"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${local.prod}:root" }
      Action    = "events:PutEvents"
      Resource  = local.bus_audit_arn
    }]
  })
}

# Không mã hoá SNS bằng khoá AWS quản lý: EventBridge không publish được vào topic dùng aws/sns.
# Nội dung là siêu dữ liệu CloudTrail (ai, khoá nào, lúc nào) — không bí mật.
resource "aws_sns_topic" "canh_bao_khoa" {
  provider = aws.audit
  name     = "tp-canh-bao-khoa"
}

resource "aws_sns_topic_policy" "canh_bao_khoa" {
  provider = aws.audit
  arn      = aws_sns_topic.canh_bao_khoa.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudWatchGuiCanhBaoThieuMocNeo"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.canh_bao_khoa.arn
        Condition = {
          ArnEquals = { "aws:SourceArn" = [
            aws_cloudwatch_metric_alarm.thieu_moc_neo.arn,
            aws_cloudwatch_metric_alarm.moc_neo_to_chuc.arn,
            aws_cloudwatch_metric_alarm.canh_moc_neo_loi.arn,
            aws_cloudwatch_metric_alarm.canh_moc_neo_khong_chay.arn,
          ] }
          StringEquals = { "aws:SourceAccount" = local.audit }
        }
      },
      {
        Sid       = "EventBridgeGuiCanhBao"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.canh_bao_khoa.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = [
              aws_cloudwatch_event_rule.put_key_policy_audit.arn,
              aws_cloudwatch_event_rule.task_worker_audit.arn,
              aws_cloudwatch_event_rule.neo_hong_audit.arn,
              aws_cloudwatch_event_rule.dns_bi_chan_audit.arn,
            ]
          }
        }
      },
    ]
  })
}

resource "aws_sns_topic_subscription" "email" {
  provider  = aws.audit
  topic_arn = aws_sns_topic.canh_bao_khoa.arn
  protocol  = "email"
  endpoint  = var.email_canh_bao
}

resource "aws_cloudwatch_event_rule" "put_key_policy_audit" {
  provider      = aws.audit
  name          = "tp-canh-bao-put-key-policy"
  description   = "PutKeyPolicy tren khoa KMS cua audit hoac prod (ADR-062, rui ro KeyAdmin)"
  event_pattern = local.mau_put_key_policy
}

resource "aws_cloudwatch_event_target" "put_key_policy_audit" {
  provider = aws.audit
  rule     = aws_cloudwatch_event_rule.put_key_policy_audit.name
  arn      = aws_sns_topic.canh_bao_khoa.arn

  # Thư đọc được ngay, không phải một khối JSON: ai, tài khoản nào, khoá nào, có bị từ chối không.
  input_transformer {
    input_paths = {
      taiKhoan = "$.account"
      luc      = "$.time"
      ai       = "$.detail.userIdentity.arn"
      khoa     = "$.detail.requestParameters.keyId"
      loi      = "$.detail.errorCode"
    }
    input_template = "\"[TrustProcure] PutKeyPolicy tren khoa KMS. Tai khoan <taiKhoan>, luc <luc>, boi <ai>, khoa <khoa>, errorCode <loi> (rong = THANH CONG). Neu day khong phai mot thay doi da duyet: kiem tra ngay key policy va CloudTrail.\""
  }
}

resource "aws_cloudwatch_event_rule" "task_worker_audit" {
  provider      = aws.audit
  name          = "tp-canh-bao-task-worker"
  description   = "Task mang role tp-unseal-worker chay ngoai service chinh thuc (ADR-062)"
  event_pattern = local.mau_task_worker
}

resource "aws_cloudwatch_event_target" "task_worker_audit" {
  provider = aws.audit
  rule     = aws_cloudwatch_event_rule.task_worker_audit.name
  arn      = aws_sns_topic.canh_bao_khoa.arn

  input_transformer {
    input_paths = {
      luc     = "$.time"
      lenh    = "$.detail.eventName"
      ai      = "$.detail.userIdentity.arn"
      taskDef = "$.detail.requestParameters.taskDefinition"
      ho      = "$.detail.requestParameters.family"
      loi     = "$.detail.errorCode"
    }
    input_template = "\"[TrustProcure] <lenh> mang role tp-unseal-worker (co kms:Decrypt tren tp-org-wrap) NGOAI service chinh thuc. Luc <luc>, boi <ai>, task definition <taskDef>, ho <ho>, errorCode <loi> (rong = THANH CONG). Neu khong phai mot lan chay da duyet: dung task ngay (ecs stop-task) va kiem tra CloudTrail kms:Decrypt.\""
  }
}

resource "aws_cloudwatch_event_rule" "neo_hong_audit" {
  provider      = aws.audit
  name          = "tp-canh-bao-neo-hong"
  description   = "Job neo tp-neo dung ma khong thanh cong (ADR-072)"
  event_pattern = local.mau_neo_hong
}

resource "aws_cloudwatch_event_target" "neo_hong_audit" {
  provider = aws.audit
  rule     = aws_cloudwatch_event_rule.neo_hong_audit.name
  arn      = aws_sns_topic.canh_bao_khoa.arn

  input_transformer {
    input_paths = {
      luc     = "$.time"
      task    = "$.detail.taskArn"
      lyDo    = "$.detail.stoppedReason"
      maDung  = "$.detail.stopCode"
      maThoat = "$.detail.containers[0].exitCode"
    }
    input_template = "\"[TrustProcure] Job neo so kiem toan (tp-neo) KHONG thanh cong. Luc <luc>, task <task>, exitCode <maThoat>, stopCode <maDung>, ly do <lyDo>. Doc log /tp/neo: dong 'KHONG XUAT DUOC', 'TU CHOI NEO' hoac 'ok=false' la mot to chuc can dieu tra NGAY (so co the da bi sua hoac cat duoi).\""
  }
}

# ---------------------------------------------------------------------------------------------
# PROD — chuyển PutKeyPolicy (⑴), task mang role worker (⑵) và job neo hỏng (⑶) sang audit
# ---------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "events_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.prod]
    }
  }
}

resource "aws_iam_role" "chuyen_canh_bao" {
  provider           = aws.prod
  name               = "tp-chuyen-canh-bao-khoa"
  assume_role_policy = data.aws_iam_policy_document.events_assume.json
}

resource "aws_iam_role_policy" "chuyen_canh_bao" {
  provider = aws.prod
  name     = "put-events-sang-audit"
  role     = aws_iam_role.chuyen_canh_bao.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "events:PutEvents"
      Resource = local.bus_audit_arn
    }]
  })
}

resource "aws_cloudwatch_event_rule" "put_key_policy_prod" {
  provider      = aws.prod
  name          = "tp-chuyen-put-key-policy"
  description   = "Chuyen PutKeyPolicy sang default bus cua audit (ADR-062, rui ro KeyAdmin)"
  event_pattern = local.mau_put_key_policy
}

resource "aws_cloudwatch_event_target" "put_key_policy_prod" {
  provider = aws.prod
  rule     = aws_cloudwatch_event_rule.put_key_policy_prod.name
  arn      = local.bus_audit_arn
  role_arn = aws_iam_role.chuyen_canh_bao.arn

  depends_on = [aws_cloudwatch_event_bus_policy.nhan_tu_prod]
}

resource "aws_cloudwatch_event_rule" "task_worker_prod" {
  provider      = aws.prod
  name          = "tp-chuyen-task-worker"
  description   = "Chuyen RunTask/StartTask/RegisterTaskDefinition mang role worker sang audit (ADR-062)"
  event_pattern = local.mau_task_worker
}

resource "aws_cloudwatch_event_target" "task_worker_prod" {
  provider = aws.prod
  rule     = aws_cloudwatch_event_rule.task_worker_prod.name
  arn      = local.bus_audit_arn
  role_arn = aws_iam_role.chuyen_canh_bao.arn

  depends_on = [aws_cloudwatch_event_bus_policy.nhan_tu_prod]
}

output "sns_topic_arn" { value = aws_sns_topic.canh_bao_khoa.arn }

resource "aws_cloudwatch_event_rule" "neo_hong_prod" {
  provider      = aws.prod
  name          = "tp-chuyen-neo-hong"
  description   = "Chuyen su kien job neo tp-neo dung khong thanh cong sang audit (ADR-072)"
  event_pattern = local.mau_neo_hong
}

resource "aws_cloudwatch_event_target" "neo_hong_prod" {
  provider = aws.prod
  rule     = aws_cloudwatch_event_rule.neo_hong_prod.name
  arn      = local.bus_audit_arn
  role_arn = aws_iam_role.chuyen_canh_bao.arn

  depends_on = [aws_cloudwatch_event_bus_policy.nhan_tu_prod]
}

# ---------------------------------------------------------------------------------------------
# ⑷ [ADR-073] AUDIT — 36 giờ không có mốc neo sổ kiểm toán mới
# ---------------------------------------------------------------------------------------------
# ⑶ chỉ nói khi một task `tp-neo` DỪNG hỏng. Lịch không chạy thì không có task nào dừng — im lặng. Thước đo ở đây
# là chính thứ ADR-026 cần: đối tượng mới dưới `so-kiem-toan/` của bucket neo, đếm bằng S3 request metrics
# (`PutRequests`) ở AUDIT. Người có quyền ở prod không tắt được metric, alarm hay SNS này.
#
# Cửa sổ: 36 kỳ một giờ, CẢ 36 phải "không có PUT" (thiếu dữ liệu = vi phạm — S3 không phát điểm nào cho giờ không có
# yêu cầu). Lịch chạy mỗi ngày ⇒ khoảng trống bình thường ≤ 24 giờ; lỡ MỘT lượt ⇒ báo sau 36 giờ tính từ lần ghi cuối.
# `ok_actions` gửi thư khi mốc neo quay lại.
#
# Giới hạn, nói thẳng:
#   • Đếm TỔNG mọi tổ chức. Một tổ chức riêng lẻ không được neo mà các tổ chức khác vẫn được là việc của ⑶ (`xuat`
#     thoát 1 khi một tổ chức hỏng) — không phải của ⑷.
#   • `PutRequests` đếm cả PUT bị từ chối (403/412). Đường ghi DUY NHẤT là `tp-anchor-writer` với khoá chưa từng có,
#     nên một PUT bị từ chối dưới tiền tố này tự nó đã bất thường; nó chỉ làm ⑷ trễ, không làm ⑷ sai hướng.
#   • Ngay sau lần apply đầu, alarm vào ALARM cho tới lượt ghi đầu tiên (metric chưa có lịch sử) — một thư dự kiến.
resource "aws_s3_bucket_metric" "moc_neo" {
  provider = aws.audit
  bucket   = module.chung.bucket.anchor
  name     = "so-kiem-toan"
  filter {
    prefix = "so-kiem-toan/"
  }
}

resource "aws_cloudwatch_metric_alarm" "thieu_moc_neo" {
  provider          = aws.audit
  alarm_name        = "tp-canh-bao-thieu-moc-neo"
  alarm_description = "[TrustProcure] 36 gio khong co moc neo so kiem toan moi trong bucket neo (ADR-073). Kiem lich tp-neo-hang-ngay (EventBridge Scheduler, prod), log /tp/neo va lan chay gan nhat cua task tp-neo. Chay tay: terraform output lenh_chay_neo o stack 90."
  namespace         = "AWS/S3"
  metric_name       = "PutRequests"
  dimensions = {
    BucketName = module.chung.bucket.anchor
    FilterId   = aws_s3_bucket_metric.moc_neo.name
  }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 36
  datapoints_to_alarm = 36
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.canh_bao_khoa.arn]
  ok_actions          = [aws_sns_topic.canh_bao_khoa.arn]
}

# ---------------------------------------------------------------------------------------------
# ⑸ [ADR-076] Truy vấn DNS ngoài danh sách trong VPC prod
# ---------------------------------------------------------------------------------------------
# Alarm và log nằm ở prod (stack 90) — nơi có VPC. Chỉ đường THƯ đi qua audit, cùng khuôn ⑶: người có quyền ở prod gỡ
# được alarm hay rule chuyển, nhưng lời gọi ấy nằm trong CloudTrail tổ chức.
resource "aws_cloudwatch_event_rule" "dns_bi_chan_audit" {
  provider      = aws.audit
  name          = "tp-canh-bao-dns-bi-chan"
  description   = "Truy van DNS ngoai danh sach duoc phep trong VPC prod (ADR-076)"
  event_pattern = local.mau_dns_bi_chan
}

resource "aws_cloudwatch_event_target" "dns_bi_chan_audit" {
  provider = aws.audit
  rule     = aws_cloudwatch_event_rule.dns_bi_chan_audit.name
  arn      = aws_sns_topic.canh_bao_khoa.arn

  input_transformer {
    input_paths = {
      luc   = "$.time"
      ly_do = "$.detail.state.reason"
    }
    input_template = "\"[TrustProcure] Truy van DNS NGOAI danh sach duoc phep trong VPC tp-prod (DNS Firewall, ADR-076). Luc <luc>. <ly_do>. Doc log /tp/dns o prod: query_name cho biet ten, srcids.instance cho biet ENI/task. Ma cua du an khong bao gio hoi ten ngoai danh sach: day la mot dich moi chua khai (them vao ten_duoc_phan_giai o stack 90) hoac api bi chiem.\""
  }
}

resource "aws_cloudwatch_event_rule" "dns_bi_chan_prod" {
  provider      = aws.prod
  name          = "tp-chuyen-dns-bi-chan"
  description   = "Chuyen alarm tp-dns-bi-chan sang audit (ADR-076)"
  event_pattern = local.mau_dns_bi_chan
}

resource "aws_cloudwatch_event_target" "dns_bi_chan_prod" {
  provider = aws.prod
  rule     = aws_cloudwatch_event_rule.dns_bi_chan_prod.name
  arn      = local.bus_audit_arn
  role_arn = aws_iam_role.chuyen_canh_bao.arn

  depends_on = [aws_cloudwatch_event_bus_policy.nhan_tu_prod]
}

# ---------------------------------------------------------------------------------------------
# ⑹ [ADR-077] Vận hành — ALB, ECS, RDS của prod (alarm ở stack 90, tiền tố `tp-van-hanh-`)
# ---------------------------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "van_hanh_audit" {
  provider      = aws.audit
  name          = "tp-canh-bao-van-hanh"
  description   = "Alarm van hanh tp-van-hanh-* cua prod vao ALARM hoac tro ve OK (ADR-077)"
  event_pattern = local.mau_van_hanh
}

# [ADR-086] Topic riêng cho ⑹. Cùng lý do không mã hoá bằng aws/sns như `tp-canh-bao-khoa`; chỉ rule ⑹ publish được.
resource "aws_sns_topic" "van_hanh" {
  provider = aws.audit
  name     = "tp-canh-bao-van-hanh"
}

resource "aws_sns_topic_policy" "van_hanh" {
  provider = aws.audit
  arn      = aws_sns_topic.van_hanh.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EventBridgeGuiVanHanh"
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.van_hanh.arn
      Condition = { ArnEquals = { "aws:SourceArn" = [aws_cloudwatch_event_rule.van_hanh_audit.arn] } }
    }]
  })
}

resource "aws_sns_topic_subscription" "van_hanh" {
  provider  = aws.audit
  for_each  = toset(var.email_van_hanh)
  topic_arn = aws_sns_topic.van_hanh.arn
  protocol  = "email"
  endpoint  = each.value
}

output "sns_van_hanh_arn" { value = aws_sns_topic.van_hanh.arn }

resource "aws_cloudwatch_event_target" "van_hanh_audit" {
  provider = aws.audit
  rule     = aws_cloudwatch_event_rule.van_hanh_audit.name
  arn      = aws_sns_topic.van_hanh.arn

  input_transformer {
    input_paths = {
      ten   = "$.detail.alarmName"
      moi   = "$.detail.state.value"
      cu    = "$.detail.previousState.value"
      luc   = "$.time"
      ly_do = "$.detail.state.reason"
      mo_ta = "$.detail.configuration.description"
    }
    input_template = "\"[TrustProcure] Van hanh prod: <ten> chuyen <cu> -> <moi> luc <luc>. <mo_ta> Chi tiet: <ly_do>\""
  }
}

resource "aws_cloudwatch_event_rule" "van_hanh_prod" {
  provider      = aws.prod
  name          = "tp-chuyen-van-hanh"
  description   = "Chuyen alarm van hanh tp-van-hanh-* sang audit (ADR-077)"
  event_pattern = local.mau_van_hanh
}

resource "aws_cloudwatch_event_target" "van_hanh_prod" {
  provider = aws.prod
  rule     = aws_cloudwatch_event_rule.van_hanh_prod.name
  arn      = local.bus_audit_arn
  role_arn = aws_iam_role.chuyen_canh_bao.arn

  depends_on = [aws_cloudwatch_event_bus_policy.nhan_tu_prod]
}

# ---------------------------------------------------------------------------------------------
# ⑺ [ADR-084] AUDIT — mốc neo theo từng tổ chức
# ---------------------------------------------------------------------------------------------
# ⑷ đếm TỔNG: một tổ chức ngừng được neo trong khi các tổ chức khác vẫn được thì ⑷ im. Job `lich` thoát 1 khi một tổ
# chức XUẤT hỏng (⑶), nhưng không khi tổ chức ấy vắng khỏi danh sách — hàm liệt kê ở prod bị sửa, hay một lỗi làm rơi
# nó. Lambda này đứng ở AUDIT, chỉ có `s3:ListBucket` dưới `so-kiem-toan/`, đọc chính bucket neo (mã và lý do phán xử
# bằng `LastModified`: `tools/neo-so-kiem-toan/src/canh-moc-neo.ts`). Ba alarm:
#   • có tổ chức thiếu mốc (dòng `THIEU MOC NEO` trong log của Lambda);
#   • Lambda LỖI (một phép canh ném là một phép canh câm nếu không ai đếm lỗi);
#   • Lambda KHÔNG CHẠY 12 giờ (lịch bị gỡ) — thiếu dữ liệu = vi phạm.
# Không biết tổ chức CHƯA TỪNG được neo — audit không có danh sách tổ chức; ca ấy lộ ở `verifyAuditChain` (NOT_ANCHORED).
locals {
  ten_canh_moc_neo = "tp-canh-moc-neo"
  nguong_gio_neo   = 36
}

data "archive_file" "canh_moc_neo" {
  type        = "zip"
  source_file = "${path.module}/../../../tools/neo-so-kiem-toan/lambda/canh-moc-neo.mjs"
  output_path = "${path.module}/.terraform/canh-moc-neo.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "canh_moc_neo" {
  provider           = aws.audit
  name               = local.ten_canh_moc_neo
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_cloudwatch_log_group" "canh_moc_neo" {
  provider          = aws.audit
  name              = "/aws/lambda/${local.ten_canh_moc_neo}"
  retention_in_days = 90
}

resource "aws_iam_role_policy" "canh_moc_neo" {
  provider = aws.audit
  name     = "chi-liet-ke-so-kiem-toan"
  role     = aws_iam_role.canh_moc_neo.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "LietKeSoKiemToan"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::${module.chung.bucket.anchor}"
        Condition = { StringLike = { "s3:prefix" = ["so-kiem-toan/", "so-kiem-toan/*"] } }
      },
      {
        Sid      = "GhiLog"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.canh_moc_neo.arn}:*"
      },
    ]
  })
}

resource "aws_lambda_function" "canh_moc_neo" {
  provider                       = aws.audit
  function_name                  = local.ten_canh_moc_neo
  description                    = "ADR-084: to chuc tung duoc neo ma ${local.nguong_gio_neo} gio khong co moc moi"
  role                           = aws_iam_role.canh_moc_neo.arn
  runtime                        = "nodejs22.x"
  handler                        = "canh-moc-neo.handler"
  filename                       = data.archive_file.canh_moc_neo.output_path
  source_code_hash               = data.archive_file.canh_moc_neo.output_base64sha256
  timeout                        = 120
  memory_size                    = 128
  reserved_concurrent_executions = 1
  environment {
    variables = {
      BUCKET_NEO = module.chung.bucket.anchor
      NGUONG_GIO = tostring(local.nguong_gio_neo)
    }
  }
  depends_on = [aws_cloudwatch_log_group.canh_moc_neo, aws_iam_role_policy.canh_moc_neo]
}

resource "aws_cloudwatch_event_rule" "canh_moc_neo" {
  provider            = aws.audit
  name                = local.ten_canh_moc_neo
  description         = "Chay Lambda canh moc neo theo to chuc moi 6 gio (ADR-084)"
  schedule_expression = "rate(6 hours)"
}

resource "aws_cloudwatch_event_target" "canh_moc_neo" {
  provider = aws.audit
  rule     = aws_cloudwatch_event_rule.canh_moc_neo.name
  arn      = aws_lambda_function.canh_moc_neo.arn
}

resource "aws_lambda_permission" "canh_moc_neo" {
  provider      = aws.audit
  statement_id  = "EventBridgeLich"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.canh_moc_neo.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.canh_moc_neo.arn
}

# Hợp đồng với `dongLog` của Lambda — `hinh-dang-canh-moc-neo.test.ts` so hai phía.
resource "aws_cloudwatch_log_metric_filter" "moc_neo_to_chuc" {
  provider       = aws.audit
  name           = "tp-thieu-moc-neo-to-chuc"
  log_group_name = aws_cloudwatch_log_group.canh_moc_neo.name
  pattern        = "\"THIEU MOC NEO\""
  metric_transformation {
    name          = "ToChucThieuMocNeo"
    namespace     = "TrustProcure/Neo"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "moc_neo_to_chuc" {
  provider            = aws.audit
  alarm_name          = "tp-canh-bao-thieu-moc-neo-to-chuc"
  alarm_description   = "[TrustProcure] (ADR-084) Co to chuc tung duoc neo ma ${local.nguong_gio_neo} gio khong co moc neo moi. Doc log /aws/lambda/${local.ten_canh_moc_neo} (dong THIEU MOC NEO neu org), roi /tp/neo o prod: to chuc ay co trong danh sach cua lich khong? Vang mat ma job thoat 0 la dau hieu ham liet ke bi sua."
  namespace           = "TrustProcure/Neo"
  metric_name         = "ToChucThieuMocNeo"
  statistic           = "Sum"
  period              = 21600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.canh_bao_khoa.arn]
  ok_actions          = [aws_sns_topic.canh_bao_khoa.arn]
}

resource "aws_cloudwatch_metric_alarm" "canh_moc_neo_loi" {
  provider            = aws.audit
  alarm_name          = "tp-canh-bao-canh-moc-neo-loi"
  alarm_description   = "[TrustProcure] (ADR-084) Lambda ${local.ten_canh_moc_neo} LOI — phep canh moc neo theo to chuc dang cam. Doc /aws/lambda/${local.ten_canh_moc_neo}."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.canh_moc_neo.function_name }
  statistic           = "Sum"
  period              = 21600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.canh_bao_khoa.arn]
  ok_actions          = [aws_sns_topic.canh_bao_khoa.arn]
}

resource "aws_cloudwatch_metric_alarm" "canh_moc_neo_khong_chay" {
  provider            = aws.audit
  alarm_name          = "tp-canh-bao-canh-moc-neo-khong-chay"
  alarm_description   = "[TrustProcure] (ADR-084) Lambda ${local.ten_canh_moc_neo} khong chay trong 12 gio — lich tp-canh-moc-neo bi tat hay go."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = aws_lambda_function.canh_moc_neo.function_name }
  statistic           = "Sum"
  period              = 43200
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.canh_bao_khoa.arn]
  ok_actions          = [aws_sns_topic.canh_bao_khoa.arn]
}

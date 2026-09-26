# Stack 60 — cảnh báo khi KEY POLICY bị sửa, trên mọi khoá KMS của audit và prod.
#
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
# Tài khoản: audit + prod. Profile: tp-audit và tp-prod (AdministratorAccess). Chạy sau 10 và 20
# (CloudTrail tổ chức phải bật: sự kiện "AWS API Call via CloudTrail" đi ra từ đó).
#
# Biến bắt buộc `email_canh_bao` — KHÔNG commit giá trị; truyền bằng -var hay tệp *.tfvars ngoài git.
# AWS gửi thư xác nhận tới địa chỉ ấy; chưa bấm xác nhận thì chưa có cảnh báo nào tới.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
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
    Statement = [{
      Sid       = "EventBridgeGuiCanhBao"
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.canh_bao_khoa.arn
      Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.put_key_policy_audit.arn } }
    }]
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

# ---------------------------------------------------------------------------------------------
# PROD — chuyển PutKeyPolicy sang audit
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

output "sns_topic_arn" { value = aws_sns_topic.canh_bao_khoa.arn }

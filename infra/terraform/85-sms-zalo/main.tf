# Stack 85 — tài khoản PROD: kênh SMS và Zalo ZNS của `api` (ADR-069).
#
#   • SMS qua AWS End User Messaging SMS: sender ID (brandname) cho Việt Nam, configuration set `tp-sms`
#     (TRANSACTIONAL). Việt Nam đòi ĐĂNG KÝ brandname và mẫu nội dung — một hồ sơ gửi AWS/nhà mạng bằng tay
#     (README); Terraform chỉ xin sender ID, không duyệt được nó.
#   • Quyền gửi: `tp-api` chỉ `sms-voice:SendTextMessage` từ ĐÚNG sender ID ấy, qua ĐÚNG configuration set ấy.
#   • Zalo ZNS: secret `tp/api/zalo-oa` giữ app_id, secret_key và cặp token đang sống. Stack này tạo secret
#     RỖNG — giá trị nạp bằng CLI (không bao giờ vào state), rồi `api` tự làm mới và GHI LẠI. Vì thế `tp-api`
#     có Get VÀ Put trên đúng secret này, và không secret nào khác.
#
# Đường ra: SMS và Zalo đi qua NAT của subnet api (stack 90) — task api không có đường ra nào khác.
#
# Tài khoản: prod. Profile: tp-prod (AdministratorAccess). Chạy sau 30 (role tp-api).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "85-sms-zalo/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "tp-mgmt"
    encrypt      = true
    use_lockfile = true
  }
}

module "chung" { source = "../chung" }

variable "sender_id" {
  description = "Brandname SMS (1–11 ký tự chữ/số), trùng tên đã đăng ký với nhà mạng Việt Nam."
  type        = string
  validation {
    condition     = can(regex("^[A-Za-z0-9]{1,11}$", var.sender_id))
    error_message = "sender_id là 1–11 ký tự chữ/số."
  }
}

provider "aws" {
  region              = module.chung.region
  profile             = "tp-prod"
  allowed_account_ids = [module.chung.account.prod]
  default_tags { tags = { du-an = "trustprocure", stack = "85-sms-zalo" } }
}

locals {
  prod   = module.chung.account.prod
  region = module.chung.region
  role   = module.chung.role
}

# ---------------------------------------------------------------------------------------------
# SMS
# ---------------------------------------------------------------------------------------------
resource "aws_pinpointsmsvoicev2_sender_id" "vn" {
  sender_id                   = var.sender_id
  iso_country_code            = "VN"
  message_types               = ["TRANSACTIONAL"]
  deletion_protection_enabled = true
}

resource "aws_pinpointsmsvoicev2_configuration_set" "sms" {
  name                 = "tp-sms"
  default_message_type = "TRANSACTIONAL"
  default_sender_id    = var.sender_id
}

data "aws_iam_policy_document" "sms" {
  statement {
    sid     = "GuiTuDungMotSenderId"
    actions = ["sms-voice:SendTextMessage"]
    resources = [
      aws_pinpointsmsvoicev2_sender_id.vn.arn,
      aws_pinpointsmsvoicev2_configuration_set.sms.arn,
      "arn:aws:sms-voice:${local.region}:${local.prod}:opt-out-list/Default",
    ]
  }
}

resource "aws_iam_role_policy" "sms" {
  name   = "gui-sms"
  role   = local.role.api
  policy = data.aws_iam_policy_document.sms.json
}

# ---------------------------------------------------------------------------------------------
# Zalo ZNS — secret không có phiên bản giá trị nào ở đây (giá trị không vào state)
# ---------------------------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "zalo" {
  name                    = "tp/api/zalo-oa"
  description             = "Zalo OA: app_id, secret_key, access_token, refresh_token, het_han_luc — api tu lam moi va ghi lai (ADR-069)"
  recovery_window_in_days = 7
}

data "aws_iam_policy_document" "zalo" {
  statement {
    sid       = "DocGhiTokenZalo"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"]
    resources = [aws_secretsmanager_secret.zalo.arn]
  }
}

resource "aws_iam_role_policy" "zalo" {
  name   = "token-zalo"
  role   = local.role.api
  policy = data.aws_iam_policy_document.zalo.json
}

output "sms" {
  description = "Giá trị cho biến `sms` của stack 90."
  value = {
    danh_tinh_gui     = var.sender_id
    configuration_set = aws_pinpointsmsvoicev2_configuration_set.sms.name
    registered        = aws_pinpointsmsvoicev2_sender_id.vn.registered
  }
}

output "zalo_secret_arn" { value = aws_secretsmanager_secret.zalo.arn }

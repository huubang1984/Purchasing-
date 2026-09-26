# Stack 80 — tài khoản PROD: gửi thư thật qua Amazon SES (ADR-065).
#
#   • Danh tính domain `var.ten_mien` với Easy DKIM (RSA 2048) và MAIL FROM riêng `thu.<domain>`, để
#     SPF và DKIM cùng căn chỉnh cho DMARC. DNS nằm NGOÀI AWS: stack này XUẤT các bản ghi cần thêm
#     (output `ban_ghi_dns`), không tự tạo.
#   • Configuration set `tp-thu`: bắt buộc TLS, tự đưa địa chỉ bounce/complaint vào danh sách chặn,
#     đo reputation.
#   • Quyền gửi, theo ĐỊA CHỈ GỬI — mỗi tiến trình chỉ gửi được từ đúng một địa chỉ:
#       tp-api           ses:SendEmail với ses:FromAddress = <dia_chi_gui>@<domain>
#       tp-unseal-worker ses:SendEmail với ses:FromAddress = <dia_chi_canh_bao>@<domain>
#     Worker không gửi được thư mang danh nghĩa `api` (link đăng nhập giả), và ngược lại.
#
# SANDBOX: tài khoản SES mới chỉ gửi được tới địa chỉ ĐÃ XÁC MINH. Ra khỏi sandbox là một yêu cầu
# gửi AWS Support bằng tay (README) — Terraform không làm được việc ấy.
#
# Tài khoản: prod. Profile: tp-prod (AdministratorAccess). Chạy sau 30 (role tp-api, tp-unseal-worker).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "80-ses/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "tp-mgmt"
    encrypt      = true
    use_lockfile = true
  }
}

module "chung" { source = "../chung" }

variable "ten_mien" {
  description = "Domain gửi thư (vd thu.trustprocure.vn hoặc trustprocure.vn). DNS do bên ngoài AWS quản."
  type        = string
  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.ten_mien))
    error_message = "ten_mien phải là một domain chữ thường hợp lệ."
  }
}

variable "dia_chi_gui" {
  description = "Phần trước @ của địa chỉ gửi thư ứng dụng (tp-api)."
  type        = string
  default     = "noreply"
}

variable "dia_chi_canh_bao" {
  description = "Phần trước @ của địa chỉ gửi cảnh báo break-glass (tp-unseal-worker)."
  type        = string
  default     = "canh-bao"
}

provider "aws" {
  region              = module.chung.region
  profile             = "tp-prod"
  allowed_account_ids = [module.chung.account.prod]
  default_tags { tags = { du-an = "trustprocure", stack = "80-ses" } }
}

locals {
  prod          = module.chung.account.prod
  region        = module.chung.region
  role          = module.chung.role
  tu_api        = "${var.dia_chi_gui}@${var.ten_mien}"
  tu_canh_bao   = "${var.dia_chi_canh_bao}@${var.ten_mien}"
  mail_from     = "thu.${var.ten_mien}"
  configuration = "tp-thu"
  arn_danh_tinh = "arn:aws:ses:${local.region}:${local.prod}:identity/${var.ten_mien}"
  arn_cau_hinh  = "arn:aws:ses:${local.region}:${local.prod}:configuration-set/${local.configuration}"
}

resource "aws_sesv2_configuration_set" "thu" {
  configuration_set_name = local.configuration
  delivery_options {
    tls_policy = "REQUIRE"
  }
  reputation_options {
    reputation_metrics_enabled = true
  }
  sending_options {
    sending_enabled = true
  }
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

resource "aws_sesv2_email_identity" "mien" {
  email_identity         = var.ten_mien
  configuration_set_name = aws_sesv2_configuration_set.thu.configuration_set_name
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "mien" {
  email_identity         = aws_sesv2_email_identity.mien.email_identity
  mail_from_domain       = local.mail_from
  behavior_on_mx_failure = "REJECT_MESSAGE"
}

# ---------------------------------------------------------------------------------------------
# Quyền gửi theo địa chỉ — gắn vào task role của stack 30.
# ---------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "gui" {
  for_each = {
    api    = local.tu_api
    worker = local.tu_canh_bao
  }
  statement {
    sid       = "GuiTuDungMotDiaChi"
    actions   = ["ses:SendEmail"]
    resources = [local.arn_danh_tinh, local.arn_cau_hinh]
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [each.value]
    }
  }
}

resource "aws_iam_role_policy" "gui_api" {
  name   = "gui-ses"
  role   = local.role.api
  policy = data.aws_iam_policy_document.gui["api"].json
}

resource "aws_iam_role_policy" "gui_worker" {
  name   = "gui-ses-canh-bao"
  role   = local.role.unseal_worker
  policy = data.aws_iam_policy_document.gui["worker"].json
}

# ---------------------------------------------------------------------------------------------
# Bản ghi DNS phải thêm ở nhà cung cấp DNS — SES chỉ xác minh domain khi đủ ba CNAME DKIM.
# ---------------------------------------------------------------------------------------------
output "ban_ghi_dns" {
  description = "Thêm các bản ghi này ở nhà cung cấp DNS của domain."
  value = concat(
    [for t in aws_sesv2_email_identity.mien.dkim_signing_attributes[0].tokens : {
      loai = "CNAME", ten = "${t}._domainkey.${var.ten_mien}", gia_tri = "${t}.dkim.amazonses.com"
    }],
    [
      { loai = "MX", ten = local.mail_from, gia_tri = "10 feedback-smtp.${local.region}.amazonses.com" },
      { loai = "TXT", ten = local.mail_from, gia_tri = "\"v=spf1 include:amazonses.com ~all\"" },
      # DMARC bắt đầu ở p=none để quan sát; siết lên quarantine/reject khi báo cáo sạch.
      { loai = "TXT", ten = "_dmarc.${var.ten_mien}", gia_tri = "\"v=DMARC1; p=none; adkim=s; aspf=s\"" },
    ],
  )
}

output "bien_moi_truong" {
  description = "Giá trị cho TRUSTPROCURE_SES_* của api và worker."
  value = {
    TRUSTPROCURE_SES_REGION            = local.region
    TRUSTPROCURE_SES_FROM_api          = local.tu_api
    TRUSTPROCURE_SES_FROM_worker       = local.tu_canh_bao
    TRUSTPROCURE_SES_CONFIGURATION_SET = local.configuration
  }
}

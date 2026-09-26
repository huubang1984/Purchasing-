# Stack 40 — tài khoản AUDIT: khoá ký mốc neo (ADR-026). Chỉ tp-anchor-writer ký được.
# Chạy bằng KeyAdmin, KHÔNG bằng AdministratorAccess: key policy chỉ cho KeyAdmin quản trị, nên
# chính người apply phải là KeyAdmin thì KMS mới chấp nhận policy (kiểm "policy lockout").
# Tài khoản: audit. Profile: tp-audit-keyadmin. Stack 10 và 20 phải apply trước.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "40-kms-audit/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "tp-mgmt"
    encrypt      = true
    use_lockfile = true
  }
}

module "chung" { source = "../chung" }

provider "aws" {
  region              = module.chung.region
  profile             = "tp-audit-keyadmin"
  allowed_account_ids = [module.chung.account.audit]
  default_tags { tags = { du-an = "trustprocure", stack = "40-kms-audit" } }
}

module "quan_tri" {
  source                     = "../modules/quan-tri-khoa"
  account_id                 = module.chung.account.audit
  key_admin_role_arn_pattern = module.chung.key_admin_role_arn_pattern.audit
}

data "aws_iam_policy_document" "anchor_sign" {
  source_policy_documents = [module.quan_tri.json]

  statement {
    sid       = "NguoiGhiNeoKy"
    actions   = ["kms:Sign"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [module.chung.anchor_writer_role_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:SigningAlgorithm"
      values   = ["ECDSA_SHA_256"]
    }
  }

  statement {
    sid       = "NguoiGhiNeoDocKhoaCongKhai"
    actions   = ["kms:GetPublicKey", "kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [module.chung.anchor_writer_role_arn]
    }
  }
}

# ECC_NIST_P256 + ECDSA_SHA_256: đúng định dạng mà tools/neo-so-kiem-toan đã chốt (ADR-026), nên
# chuyển từ bộ ký local-dev sang KMS là đổi adapter chứ không đổi định dạng. Khoá bất đối xứng
# không tự xoay: xoay = khoá mới + kid mới, giữ khoá cũ để kiểm mốc cũ.
resource "aws_kms_key" "anchor_sign" {
  description              = "TrustProcure - ky moc neo so kiem toan (ADR-026)"
  customer_master_key_spec = "ECC_NIST_P256"
  key_usage                = "SIGN_VERIFY"
  deletion_window_in_days  = 30
  policy                   = data.aws_iam_policy_document.anchor_sign.json
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_alias" "anchor_sign" {
  name          = "alias/tp-anchor-sign"
  target_key_id = aws_kms_key.anchor_sign.key_id
}

output "anchor_sign_key_arn" { value = aws_kms_key.anchor_sign.arn }

# [ADR-071] kid và nửa công khai của khoá ký mốc neo, cho job neo trên ECS (stack 90 đọc state này) và cho
# kiểm toán viên. Cùng khuôn stack 50: kid sống cạnh khoá. Xoay: khoá mới + mục mới, không gỡ mục cũ.
variable "neo_kid" {
  description = "kid của khoá mà alias/tp-anchor-sign đang trỏ tới — đi vào văn bản mốc neo."
  type        = string
  default     = "kms-neo-2026-09"
  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,64}$", var.neo_kid))
    error_message = "neo_kid: 1–64 ký tự [A-Za-z0-9._-] (an toàn cho tên tệp của `pnpm neo trich`)."
  }
}

locals {
  khoa_neo = {
    (var.neo_kid) = aws_kms_key.anchor_sign.arn
  }
}

data "aws_kms_public_key" "neo" {
  for_each = local.khoa_neo
  key_id   = each.value
}

output "neo" {
  description = "kid đang ký, ARN alias để ký chéo tài khoản, và nửa công khai (SPKI DER base64) của MỌI khoá ký mốc neo."
  value = {
    kid_dang_dung  = var.neo_kid
    alias_arn      = aws_kms_alias.anchor_sign.arn
    khoa_cong_khai = { for kid, k in data.aws_kms_public_key.neo : kid => k.public_key }
  }
}

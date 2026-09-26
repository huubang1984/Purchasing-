# Stack 50 — tài khoản PROD: ba khoá của ứng dụng.
#   ⑴ alias/tp-org-wrap — CMK đối xứng bọc cặp khoá của từng tổ chức (ADR-062):
#        tp-api           chỉ GenerateDataKeyPairWithoutPlaintext (sinh cặp khoá tổ chức)
#        tp-unseal-worker chỉ Decrypt (mở khoá riêng tổ chức, 1 lần mỗi lượt mở thầu)
#        mọi principal khác — kể cả KeyAdmin và AdministratorAccess — không giải mã được.
#   ⑵ alias/tp-receipt-sign — khoá ký biên nhận (ADR-011), chỉ tp-api ký được.
#   ⑶ alias/tp-totp — CMK đối xứng bọc bí mật TOTP (ADR-063): chỉ tp-api Encrypt/Decrypt, và chỉ
#        với encryption context { org_id, key_version }. Không bắc cầu sang tp-org-wrap.
# Chạy bằng KeyAdmin (xem stack 40). Tài khoản: prod. Profile: tp-prod-keyadmin.
# Stack 20 và 30 phải apply trước: KMS từ chối key policy trỏ tới role chưa tồn tại.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "50-kms-prod/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "tp-mgmt"
    encrypt      = true
    use_lockfile = true
  }
}

module "chung" { source = "../chung" }

provider "aws" {
  region              = module.chung.region
  profile             = "tp-prod-keyadmin"
  allowed_account_ids = [module.chung.account.prod]
  default_tags { tags = { du-an = "trustprocure", stack = "50-kms-prod" } }
}

locals {
  api    = module.chung.role_arn_prod.api
  worker = module.chung.role_arn_prod.unseal_worker
}

module "quan_tri" {
  source                     = "../modules/quan-tri-khoa"
  account_id                 = module.chung.account.prod
  key_admin_role_arn_pattern = module.chung.key_admin_role_arn_pattern.prod
}

# ---------------------------------------------------------------------------------------------
# ⑴ tp-org-wrap
# ---------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "org_wrap" {
  source_policy_documents = [module.quan_tri.json]

  # Sinh cặp khoá P-256 của một tổ chức. KMS trả khoá công khai + khoá riêng ĐÃ BỌC; tp-api không
  # bao giờ thấy khoá riêng dạng rõ. Encryption context phải có org_id và CHỈ org_id.
  statement {
    sid       = "ApiSinhCapKhoaToChuc"
    actions   = ["kms:GenerateDataKeyPairWithoutPlaintext"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.api]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:DataKeyPairSpec"
      values   = ["ECC_NIST_P256"]
    }
    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:org_id"
      values   = ["?*"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "kms:EncryptionContextKeys"
      values   = ["org_id"]
    }
  }

  statement {
    sid       = "WorkerMoKhoaRiengToChuc"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.worker]
    }
    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:org_id"
      values   = ["?*"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "kms:EncryptionContextKeys"
      values   = ["org_id"]
    }
  }

  statement {
    sid       = "HaiRoleDocMoTaKhoa"
    actions   = ["kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.api, local.worker]
    }
  }

  # Chặn TƯỜNG MINH, để một statement Allow viết thêm về sau (hay một grant) không mở được:
  # giải mã chỉ dành cho worker…
  statement {
    sid       = "KhongGiaiMaNgoaiWorker"
    effect    = "Deny"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [local.worker]
    }
  }

  # …và không ai dùng khoá này theo đường nào khác: bọc thẳng bằng CMK (phương án 2 bị loại của
  # ADR-062), lấy data key đối xứng hay cặp khoá CÓ plaintext (phương án 1), hay ReEncrypt.
  statement {
    sid    = "KhongAiDungDuongKhac"
    effect = "Deny"
    actions = [
      "kms:Encrypt",
      "kms:ReEncryptFrom",
      "kms:ReEncryptTo",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
      "kms:GenerateDataKeyPair",
    ]
    resources = ["*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

# Đối xứng: tự xoay hằng năm, blob cũ vẫn mở được bằng phiên bản vật liệu khoá cũ.
resource "aws_kms_key" "org_wrap" {
  description             = "TrustProcure - boc cap khoa to chuc (ADR-062)"
  key_usage               = "ENCRYPT_DECRYPT"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.org_wrap.json
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_alias" "org_wrap" {
  name          = "alias/tp-org-wrap"
  target_key_id = aws_kms_key.org_wrap.key_id
}

# ---------------------------------------------------------------------------------------------
# ⑵ tp-receipt-sign
# ---------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "receipt_sign" {
  source_policy_documents = [module.quan_tri.json]

  statement {
    sid       = "ApiKyBienNhan"
    actions   = ["kms:Sign"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.api]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:SigningAlgorithm"
      values   = ["ECDSA_SHA_256"]
    }
  }

  statement {
    sid       = "ApiDocKhoaCongKhai"
    actions   = ["kms:GetPublicKey", "kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.api]
    }
  }
}

# Xoay = khoá mới + kid mới, giữ khoá cũ để kiểm biên nhận cũ (ADR-011 mục 3).
resource "aws_kms_key" "receipt_sign" {
  description              = "TrustProcure - ky bien nhan (ADR-011)"
  customer_master_key_spec = "ECC_NIST_P256"
  key_usage                = "SIGN_VERIFY"
  deletion_window_in_days  = 30
  policy                   = data.aws_iam_policy_document.receipt_sign.json
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_alias" "receipt_sign" {
  name          = "alias/tp-receipt-sign"
  target_key_id = aws_kms_key.receipt_sign.key_id
}

# [ADR-070] kid và nửa công khai sống CÙNG chỗ với khoá: đổi alias sang khoá mới mà không đổi kid là một biên
# nhận ký bằng khoá này nhưng khai kid của khoá kia. Stack 90 đọc cả hai từ state của stack này.
variable "receipt_kid" {
  description = "kid của khoá mà alias/tp-receipt-sign đang trỏ tới — đi vào văn bản biên nhận (ADR-011 mục 3)."
  type        = string
  default     = "kms-2026-09"
  validation {
    condition     = can(regex("^[A-Za-z0-9._:-]{1,64}$", var.receipt_kid))
    error_message = "receipt_kid: 1–64 ký tự [A-Za-z0-9._:-]."
  }
}

# KeyAdmin (profile của stack này) có kms:Get* qua module quan-tri-khoa. Xoay: thêm khoá mới + một mục mới vào
# `khoa_bien_nhan`, trỏ alias sang nó, đổi receipt_kid — KHÔNG gỡ mục cũ (biên nhận cũ phải kiểm được).
locals {
  khoa_bien_nhan = {
    (var.receipt_kid) = aws_kms_key.receipt_sign.arn
  }
}

data "aws_kms_public_key" "bien_nhan" {
  for_each = local.khoa_bien_nhan
  key_id   = each.value
}

# ---------------------------------------------------------------------------------------------
# ⑶ tp-totp (ADR-063)
# ---------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "totp" {
  source_policy_documents = [module.quan_tri.json]

  statement {
    sid       = "ApiBocMoBiMatTotp"
    actions   = ["kms:Encrypt", "kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.api]
    }
    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:org_id"
      values   = ["?*"]
    }
    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:key_version"
      values   = ["?*"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "kms:EncryptionContextKeys"
      values   = ["org_id", "key_version"]
    }
  }

  statement {
    sid       = "ApiDocMoTaKhoa"
    actions   = ["kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.api]
    }
  }

  # Giải mã chỉ dành cho tp-api — worker, KeyAdmin, AdministratorAccess đều không.
  statement {
    sid       = "KhongGiaiMaNgoaiApi"
    effect    = "Deny"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [local.api]
    }
  }

  statement {
    sid    = "KhongAiDungDuongKhac"
    effect = "Deny"
    actions = [
      "kms:ReEncryptFrom",
      "kms:ReEncryptTo",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
      "kms:GenerateDataKeyPair",
      "kms:GenerateDataKeyPairWithoutPlaintext",
    ]
    resources = ["*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_kms_key" "totp" {
  description             = "TrustProcure - boc bi mat TOTP (ADR-063)"
  key_usage               = "ENCRYPT_DECRYPT"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.totp.json
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_alias" "totp" {
  name          = "alias/tp-totp"
  target_key_id = aws_kms_key.totp.key_id
}

output "org_wrap_key_arn" { value = aws_kms_key.org_wrap.arn }
output "totp_key_arn" { value = aws_kms_key.totp.arn }
output "receipt_sign_key_arn" { value = aws_kms_key.receipt_sign.arn }

output "bien_nhan" {
  description = "[ADR-070] kid đang ký và nửa công khai (SPKI DER base64) của MỌI khoá ký biên nhận — cho service tp-public-keys và neo audit."
  value = {
    kid_dang_dung  = var.receipt_kid
    khoa_cong_khai = { for kid, k in data.aws_kms_public_key.bien_nhan : kid => k.public_key }
  }
}

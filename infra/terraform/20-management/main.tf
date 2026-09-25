# Stack 20 — tài khoản MANAGEMENT:
#   ⑴ permission set KeyAdmin trong IAM Identity Center, gán cho group tp-key-admins trên audit
#     và prod. Đây là danh tính DUY NHẤT key policy của stack 40/50 cho quản trị khoá; nó quản trị
#     được nhưng KHÔNG dùng khoá để giải mã hay ký (ADR-062).
#   ⑵ CloudTrail của cả tổ chức, ghi vào bucket ở tài khoản audit (stack 10 phải apply trước).
# Tài khoản: management. Profile: tp-mgmt (AdministratorAccess).
#
# Tiền điều kiện một lần (Organizations phải tin CloudTrail trước khi có trail tổ chức):
#   aws organizations enable-aws-service-access --service-principal cloudtrail.amazonaws.com --profile tp-mgmt

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "20-management/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "tp-mgmt"
    encrypt      = true
    use_lockfile = true
  }
}

module "chung" { source = "../chung" }

provider "aws" {
  region              = module.chung.region
  profile             = "tp-mgmt"
  allowed_account_ids = [module.chung.account.management]
  default_tags { tags = { du-an = "trustprocure", stack = "20-management" } }
}

# ---------------------------------------------------------------------------------------------
# ⑴ KeyAdmin
# ---------------------------------------------------------------------------------------------
data "aws_ssoadmin_instances" "this" {}

locals {
  sso_instance_arn  = tolist(data.aws_ssoadmin_instances.this.arns)[0]
  identity_store_id = tolist(data.aws_ssoadmin_instances.this.identity_store_ids)[0]
}

data "aws_identitystore_group" "key_admins" {
  identity_store_id = local.identity_store_id
  alternate_identifier {
    unique_attribute {
      attribute_path  = "DisplayName"
      attribute_value = "tp-key-admins"
    }
  }
}

resource "aws_ssoadmin_permission_set" "key_admin" {
  name             = module.chung.key_admin_permission_set
  description      = "Quan tri khoa KMS - khong dung khoa (ADR-062)"
  instance_arn     = local.sso_instance_arn
  session_duration = "PT1H"
}

# Tạo và quản trị khoá; KHÔNG có Encrypt/Decrypt/Sign/GenerateDataKey*. Dù permission set có ghi
# thêm các quyền ấy, key policy của stack 40/50 cũng không trao chúng cho role KeyAdmin.
data "aws_iam_policy_document" "key_admin" {
  statement {
    sid = "QuanTriKhoa"
    actions = [
      "kms:CreateKey",
      "kms:CreateAlias",
      "kms:UpdateAlias",
      "kms:DeleteAlias",
      "kms:Describe*",
      "kms:Get*",
      "kms:List*",
      "kms:PutKeyPolicy",
      "kms:EnableKeyRotation",
      "kms:DisableKeyRotation",
      "kms:RotateKeyOnDemand",
      "kms:EnableKey",
      "kms:DisableKey",
      "kms:UpdateKeyDescription",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:ScheduleKeyDeletion",
      "kms:CancelKeyDeletion",
    ]
    resources = ["*"]
  }
  # Terraform ở stack 40/50 kiểm role tồn tại trước khi viết key policy.
  statement {
    sid       = "DocRole"
    actions   = ["iam:GetRole", "sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_ssoadmin_permission_set_inline_policy" "key_admin" {
  instance_arn       = local.sso_instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.key_admin.arn
  inline_policy      = data.aws_iam_policy_document.key_admin.json
}

resource "aws_ssoadmin_account_assignment" "key_admin" {
  for_each           = toset(["audit", "prod"])
  instance_arn       = local.sso_instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.key_admin.arn
  principal_type     = "GROUP"
  principal_id       = data.aws_identitystore_group.key_admins.group_id
  target_type        = "AWS_ACCOUNT"
  target_id          = module.chung.account[each.key]
  depends_on         = [aws_ssoadmin_permission_set_inline_policy.key_admin]
}

# ---------------------------------------------------------------------------------------------
# ⑵ CloudTrail tổ chức
# ---------------------------------------------------------------------------------------------
# Các lời gọi KMS (Decrypt, Sign, GenerateDataKeyPairWithoutPlaintext…) là MANAGEMENT event —
# trail mặc định đã ghi, không cần bật data event.
resource "aws_cloudtrail" "org" {
  name                          = module.chung.trail_name
  s3_bucket_name                = module.chung.bucket.cloudtrail
  is_organization_trail         = true
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  lifecycle { prevent_destroy = true }
}

output "key_admin_permission_set_arn" { value = aws_ssoadmin_permission_set.key_admin.arn }
output "trail_arn" { value = aws_cloudtrail.org.arn }

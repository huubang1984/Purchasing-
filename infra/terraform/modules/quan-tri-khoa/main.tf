# Statement quản trị khoá cho role KeyAdmin của Identity Center — dùng chung cho mọi key policy.
#
# Principal là account root KÈM điều kiện aws:PrincipalArn khớp role KeyAdmin; KHÔNG phải
# statement "Enable IAM policies" (root không điều kiện), thứ sẽ trao khoá cho mọi IAM admin.
# Không có CreateGrant: một grant tự cấp là đường vòng qua key policy để giải mã hay ký.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "account_id" { type = string }
variable "key_admin_role_arn_pattern" { type = string }

data "aws_iam_policy_document" "this" {
  statement {
    sid = "KeyAdminQuanTriKhongDung"
    actions = [
      "kms:Describe*",
      "kms:Get*",
      "kms:List*",
      "kms:PutKeyPolicy",
      "kms:Update*",
      "kms:Enable*",
      "kms:Disable*",
      "kms:RotateKeyOnDemand",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:CreateAlias",
      "kms:DeleteAlias",
      "kms:ScheduleKeyDeletion",
      "kms:CancelKeyDeletion",
    ]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:PrincipalArn"
      values   = [var.key_admin_role_arn_pattern]
    }
  }

  statement {
    sid       = "KhongAiTaoGrant"
    effect    = "Deny"
    actions   = ["kms:CreateGrant"]
    resources = ["*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

output "json" { value = data.aws_iam_policy_document.this.json }

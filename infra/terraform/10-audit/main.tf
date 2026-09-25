# Stack 10 — tài khoản AUDIT: nơi cất bằng chứng mà role deploy của prod không chạm được.
#   ⑴ bucket nhận CloudTrail của cả tổ chức (trail tạo ở stack 20),
#   ⑵ bucket neo sổ kiểm toán — Object Lock COMPLIANCE 1 năm (ADR-026 §4, ADR-062),
#   ⑶ role tp-anchor-writer: đúng một danh tính được ghi vào bucket neo, chỉ job neo của prod
#     đảm nhận được.
# Khoá ký mốc neo nằm ở stack 40 (chạy bằng KeyAdmin, không bằng AdministratorAccess).
# Tài khoản: audit. Profile: tp-audit (AdministratorAccess). State: bucket ở management.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "10-audit/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "tp-mgmt"
    encrypt      = true
    use_lockfile = true
  }
}

module "chung" { source = "../chung" }

provider "aws" {
  region              = module.chung.region
  profile             = "tp-audit"
  allowed_account_ids = [module.chung.account.audit]
  default_tags { tags = { du-an = "trustprocure", stack = "10-audit" } }
}

locals {
  cloudtrail_arn = "arn:aws:s3:::${module.chung.bucket.cloudtrail}"
  anchor_arn     = "arn:aws:s3:::${module.chung.bucket.anchor}"
}

# ---------------------------------------------------------------------------------------------
# ⑴ Bucket CloudTrail của tổ chức
# ---------------------------------------------------------------------------------------------
resource "aws_s3_bucket" "cloudtrail" {
  bucket = module.chung.bucket.cloudtrail
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_ownership_controls" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail" {
  bucket                  = aws_s3_bucket.cloudtrail.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

data "aws_iam_policy_document" "cloudtrail" {
  statement {
    sid       = "ChiNhanTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [local.cloudtrail_arn, "${local.cloudtrail_arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "CloudTrailKiemAcl"
    actions   = ["s3:GetBucketAcl"]
    resources = [local.cloudtrail_arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [module.chung.trail_arn]
    }
  }

  # Trail tổ chức ghi log của tài khoản management dưới AWSLogs/<management>/ và log của mọi
  # tài khoản thành viên dưới AWSLogs/<org_id>/.
  statement {
    sid     = "CloudTrailGhiLog"
    actions = ["s3:PutObject"]
    resources = [
      "${local.cloudtrail_arn}/AWSLogs/${module.chung.account.management}/*",
      "${local.cloudtrail_arn}/AWSLogs/${module.chung.org_id}/*",
    ]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [module.chung.trail_arn]
    }
  }

  # Log là bằng chứng: không ai xoá được phiên bản nào, kể cả admin của tài khoản audit.
  statement {
    sid       = "KhongXoaLog"
    effect    = "Deny"
    actions   = ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutLifecycleConfiguration"]
    resources = [local.cloudtrail_arn, "${local.cloudtrail_arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudtrail" {
  bucket     = aws_s3_bucket.cloudtrail.id
  policy     = data.aws_iam_policy_document.cloudtrail.json
  depends_on = [aws_s3_bucket_public_access_block.cloudtrail]
}

# ---------------------------------------------------------------------------------------------
# ⑵ Bucket neo — Object Lock COMPLIANCE 1 năm
# ---------------------------------------------------------------------------------------------
# COMPLIANCE: không ai rút ngắn được thời hạn giữ của một object đã ghi, kể cả root. Thời hạn
# MẶC ĐỊNH của bucket thì TĂNG được về sau, không GIẢM được với object cũ (ADR-062).
resource "aws_s3_bucket" "anchor" {
  bucket              = module.chung.bucket.anchor
  object_lock_enabled = true
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_ownership_controls" "anchor" {
  bucket = aws_s3_bucket.anchor.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "anchor" {
  bucket                  = aws_s3_bucket.anchor.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "anchor" {
  bucket = aws_s3_bucket.anchor.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "anchor" {
  bucket = aws_s3_bucket.anchor.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "anchor" {
  bucket = aws_s3_bucket.anchor.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 365
    }
  }
  depends_on = [aws_s3_bucket_versioning.anchor]
}

data "aws_iam_policy_document" "anchor" {
  statement {
    sid       = "ChiNhanTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [local.anchor_arn, "${local.anchor_arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # Chỉ tp-anchor-writer được GHI. Mọi danh tính khác — kể cả AdministratorAccess — bị từ chối.
  statement {
    sid       = "ChiNguoiGhiNeoDuocGhi"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${local.anchor_arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [module.chung.anchor_writer_role_arn]
    }
  }

  # Không ai xoá, rút khoá, hay đổi cấu hình khoá/phiên bản/vòng đời. Muốn TĂNG thời hạn giữ
  # về sau: root của tài khoản audit (qua "Privileged root actions" của management) gỡ statement
  # này, đổi cấu hình, rồi apply lại stack.
  statement {
    sid    = "KhongXoaKhongDoiKhoa"
    effect = "Deny"
    actions = [
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:BypassGovernanceRetention",
      "s3:PutObjectRetention",
      "s3:PutBucketObjectLockConfiguration",
      "s3:PutBucketVersioning",
      "s3:PutLifecycleConfiguration",
    ]
    resources = [local.anchor_arn, "${local.anchor_arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "anchor" {
  bucket = aws_s3_bucket.anchor.id
  policy = data.aws_iam_policy_document.anchor.json
  # Chính sách chặn PutBucketObjectLockConfiguration/PutBucketVersioning ⇒ phải áp SAU hai thứ đó.
  depends_on = [
    aws_s3_bucket_public_access_block.anchor,
    aws_s3_bucket_object_lock_configuration.anchor,
    aws_s3_bucket_versioning.anchor,
  ]
}

# ---------------------------------------------------------------------------------------------
# ⑶ Role ghi neo — chỉ job neo của prod đảm nhận được
# ---------------------------------------------------------------------------------------------
# Principal là account root của prod KÈM điều kiện aws:PrincipalArn, không phải ARN role trực
# tiếp: IAM từ chối trust policy trỏ tới một role chưa tồn tại, mà tp-anchor-job ra đời ở stack 30.
data "aws_iam_policy_document" "anchor_writer_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${module.chung.account.prod}:root"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:PrincipalArn"
      values   = [module.chung.role_arn_prod.anchor_job]
    }
  }
}

resource "aws_iam_role" "anchor_writer" {
  name                 = module.chung.anchor_writer_role
  assume_role_policy   = data.aws_iam_policy_document.anchor_writer_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "anchor_writer" {
  statement {
    sid       = "GhiMocNeo"
    actions   = ["s3:PutObject"]
    resources = ["${local.anchor_arn}/*"]
  }
  statement {
    sid       = "DocLaiDeKiem"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [local.anchor_arn, "${local.anchor_arn}/*"]
  }
  # Quyền Sign trên khoá ký mốc neo do KEY POLICY ở stack 40 trao, không ở đây.
}

resource "aws_iam_role_policy" "anchor_writer" {
  name   = "ghi-neo"
  role   = aws_iam_role.anchor_writer.id
  policy = data.aws_iam_policy_document.anchor_writer.json
}

output "cloudtrail_bucket" { value = aws_s3_bucket.cloudtrail.id }
output "anchor_bucket" { value = aws_s3_bucket.anchor.id }
output "anchor_writer_role_arn" { value = aws_iam_role.anchor_writer.arn }

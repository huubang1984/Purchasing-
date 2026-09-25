# Stack 00 — bucket lưu state cho mọi stack khác. Chạy MỘT lần, bằng state LOCAL (con gà và quả
# trứng: bucket state chưa tồn tại thì không lưu state của chính nó vào đó được).
# Tài khoản: management. Profile: tp-mgmt (AdministratorAccess).
#
# Sau khi apply xong, state local của stack này (terraform.tfstate trong thư mục này) KHÔNG commit
# — .gitignore đã chặn. Giữ nó hoặc bỏ đi đều được: bucket có thể import lại bất cứ lúc nào.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

module "chung" { source = "../chung" }

provider "aws" {
  region              = module.chung.region
  profile             = "tp-mgmt"
  allowed_account_ids = [module.chung.account.management]
  default_tags { tags = { du-an = "trustprocure", stack = "00-bootstrap" } }
}

resource "aws_s3_bucket" "tfstate" {
  bucket = module.chung.bucket.tfstate
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_ownership_controls" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning là lưới đỡ khi một lần apply ghi hỏng state: quay về bản trước được.
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    id     = "don-phien-ban-cu"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

data "aws_iam_policy_document" "tfstate" {
  statement {
    sid       = "ChiNhanTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]
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
}

resource "aws_s3_bucket_policy" "tfstate" {
  bucket     = aws_s3_bucket.tfstate.id
  policy     = data.aws_iam_policy_document.tfstate.json
  depends_on = [aws_s3_bucket_public_access_block.tfstate]
}

output "tfstate_bucket" { value = aws_s3_bucket.tfstate.id }

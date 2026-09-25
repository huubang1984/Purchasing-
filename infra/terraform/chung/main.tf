# Hằng số dùng chung cho mọi stack. Không tạo tài nguyên nào — chỉ xuất giá trị, để một con số
# (account ID, tên role, tên bucket) có đúng MỘT chỗ khai và không stack nào chép nó.

terraform {
  required_version = ">= 1.10"
}

locals {
  region = "ap-southeast-1"
  org_id = "o-u0xp6p6auq"

  account = {
    management = "243714547276"
    audit      = "528657840905"
    prod       = "942091277863"
  }

  github_repo = "huubang1984/Purchasing-"

  # Tên role trong tài khoản prod. ADR-062 ghim quyền KMS theo đúng các tên này.
  role = {
    api           = "tp-api"
    unseal_worker = "tp-unseal-worker"
    migrate       = "tp-migrate"
    ecs_execution = "tp-ecs-execution"
    anchor_job    = "tp-anchor-job"
    deploy        = "tp-deploy"
    deploy_worker = "tp-deploy-worker"
  }

  # Role trong tài khoản audit — role deploy của prod KHÔNG có quyền nào ở đây (ADR-026 §4).
  anchor_writer_role = "tp-anchor-writer"

  bucket = {
    tfstate    = "tp-tfstate-243714547276"
    cloudtrail = "tp-cloudtrail-528657840905"
    anchor     = "tp-neo-528657840905"
  }

  trail_name = "tp-org-trail"

  # Role mà IAM Identity Center dựng cho permission set KeyAdmin trong mỗi tài khoản được gán.
  # Key policy không nhận wildcard ở Principal, nên các khoá dùng principal là account root KÈM
  # điều kiện aws:PrincipalArn khớp mẫu này — không phải statement "Enable IAM policies" trao cho
  # mọi IAM admin.
  key_admin_permission_set = "KeyAdmin"
}

output "region" { value = local.region }
output "org_id" { value = local.org_id }
output "account" { value = local.account }
output "github_repo" { value = local.github_repo }
output "role" { value = local.role }
output "anchor_writer_role" { value = local.anchor_writer_role }
output "bucket" { value = local.bucket }
output "trail_name" { value = local.trail_name }
output "key_admin_permission_set" { value = local.key_admin_permission_set }

output "trail_arn" {
  value = "arn:aws:cloudtrail:${local.region}:${local.account.management}:trail/${local.trail_name}"
}

output "role_arn_prod" {
  value = { for k, v in local.role : k => "arn:aws:iam::${local.account.prod}:role/${v}" }
}

output "anchor_writer_role_arn" {
  value = "arn:aws:iam::${local.account.audit}:role/${local.anchor_writer_role}"
}

# Mẫu ARN của role KeyAdmin do Identity Center dựng, theo tài khoản.
output "key_admin_role_arn_pattern" {
  value = {
    for k, id in local.account :
    k => "arn:aws:iam::${id}:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_${local.key_admin_permission_set}_*"
  }
}

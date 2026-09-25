# Stack 30 — tài khoản PROD: danh tính của các tiến trình và của pipeline deploy.
#
# Quyền KMS của tp-api / tp-unseal-worker KHÔNG nằm ở đây. Khoá của stack 50 không có statement
# "Enable IAM policies" cho account root, nên một IAM policy trao kms:Decrypt cũng vô hiệu — key
# policy là nơi DUY NHẤT quyết định ai dùng khoá (ADR-062). Stack này chỉ dựng các danh tính mà
# key policy gọi tên, và phải apply TRƯỚC stack 50: KMS từ chối key policy trỏ tới role chưa có.
#
# Compute: ECS Fargate (ADR-062). Tài khoản: prod. Profile: tp-prod (AdministratorAccess).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "30-prod-iam/terraform.tfstate"
    region       = "ap-southeast-1"
    profile      = "tp-mgmt"
    encrypt      = true
    use_lockfile = true
  }
}

module "chung" { source = "../chung" }

provider "aws" {
  region              = module.chung.region
  profile             = "tp-prod"
  allowed_account_ids = [module.chung.account.prod]
  default_tags { tags = { du-an = "trustprocure", stack = "30-prod-iam" } }
}

locals {
  prod     = module.chung.account.prod
  region   = module.chung.region
  role     = module.chung.role
  role_arn = module.chung.role_arn_prod
  cluster  = "tp-prod"

  secret_arn = "arn:aws:secretsmanager:${local.region}:${local.prod}:secret:tp"

  # Image và ECS service do tp-deploy quản; worker tách hẳn sang tp-deploy-worker.
  repo_app    = ["tp-api", "tp-web", "tp-mcp", "tp-migrate"]
  repo_worker = ["tp-unseal-worker"]
}

# ---------------------------------------------------------------------------------------------
# Task role của ECS
# ---------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.prod]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:ecs:${local.region}:${local.prod}:*"]
    }
  }
}

# Mỗi task role đọc đúng nhánh secret của mình: tp/<tên>/*
locals {
  task_role = {
    api           = "api"
    unseal_worker = "worker"
    migrate       = "migrate"
    anchor_job    = "anchor"
  }
}

resource "aws_iam_role" "task" {
  for_each             = local.task_role
  name                 = local.role[each.key]
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "task_secret" {
  for_each = local.task_role
  statement {
    sid       = "DocSecretCuaMinh"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = ["${local.secret_arn}/${each.value}/*"]
  }
}

resource "aws_iam_role_policy" "task_secret" {
  for_each = local.task_role
  name     = "doc-secret"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.task_secret[each.key].json
}

# Job neo: được đảm nhận role ghi neo ở tài khoản audit, và không gì khác ở đó.
data "aws_iam_policy_document" "anchor_job" {
  statement {
    sid       = "DamNhanNguoiGhiNeo"
    actions   = ["sts:AssumeRole"]
    resources = [module.chung.anchor_writer_role_arn]
  }
}

resource "aws_iam_role_policy" "anchor_job" {
  name   = "dam-nhan-ghi-neo"
  role   = aws_iam_role.task["anchor_job"].id
  policy = data.aws_iam_policy_document.anchor_job.json
}

# ---------------------------------------------------------------------------------------------
# Execution role: kéo image, ghi log, bơm secret vào biến môi trường của container
# ---------------------------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution" {
  name                 = local.role.ecs_execution
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secret" {
  statement {
    sid       = "BomSecretVaoTask"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["${local.secret_arn}/*"]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secret" {
  name   = "bom-secret"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secret.json
}

# ---------------------------------------------------------------------------------------------
# GitHub Actions OIDC và hai role deploy
# ---------------------------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# tp-deploy: environment "prod". tp-deploy-worker: environment "prod-worker" — bật "Required
# reviewers" cho CẢ HAI environment trên GitHub. Tách hai role vì role nào PassRole được task
# role của worker thì chạy được một task bất kỳ mang quyền kms:Decrypt (ADR-062, rủi ro còn lại).
locals {
  deploy = {
    deploy = {
      environment = "prod"
      repos       = local.repo_app
      services    = ["tp-api", "tp-web", "tp-mcp"]
      pass_roles  = [local.role_arn.api, local.role_arn.migrate, local.role_arn.anchor_job]
    }
    deploy_worker = {
      environment = "prod-worker"
      repos       = local.repo_worker
      services    = ["tp-unseal-worker"]
      pass_roles  = [local.role_arn.unseal_worker]
    }
  }
}

data "aws_iam_policy_document" "deploy_trust" {
  for_each = local.deploy
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${module.chung.github_repo}:environment:${each.value.environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each             = local.deploy
  name                 = local.role[each.key]
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust[each.key].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  for_each = local.deploy

  statement {
    sid       = "DangNhapEcr"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "DayImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for r in each.value.repos : "arn:aws:ecr:${local.region}:${local.prod}:repository/${r}"]
  }

  # RegisterTaskDefinition/Describe* không hỗ trợ giới hạn theo tài nguyên.
  statement {
    sid       = "TaskDefinition"
    actions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:DescribeServices", "ecs:DescribeTasks"]
    resources = ["*"]
  }

  statement {
    sid       = "CapNhatService"
    actions   = ["ecs:UpdateService"]
    resources = [for s in each.value.services : "arn:aws:ecs:${local.region}:${local.prod}:service/${local.cluster}/${s}"]
  }

  # Chạy task một lần (migrate, neo) trong đúng cluster prod.
  statement {
    sid       = "ChayTaskMotLan"
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${local.region}:${local.prod}:task-definition/*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = ["arn:aws:ecs:${local.region}:${local.prod}:cluster/${local.cluster}"]
    }
  }

  # PassRole đúng các task role của phía mình, cộng execution role — và chỉ cho ECS.
  statement {
    sid       = "TraoRoleChoTask"
    actions   = ["iam:PassRole"]
    resources = concat(each.value.pass_roles, [local.role_arn.ecs_execution])
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # Chặn tường minh: role deploy không bao giờ chạm KMS, không sang tài khoản audit, không tự
  # sửa IAM (ADR-026 §4, ADR-062).
  statement {
    sid       = "KhongChamKhoa"
    effect    = "Deny"
    actions   = ["kms:*"]
    resources = ["*"]
  }
  statement {
    sid       = "KhongSangAudit"
    effect    = "Deny"
    actions   = ["sts:AssumeRole"]
    resources = ["arn:aws:iam::${module.chung.account.audit}:role/*"]
  }
  statement {
    sid         = "KhongSuaIam"
    effect      = "Deny"
    not_actions = ["iam:PassRole", "iam:GetRole"]
    resources   = ["arn:aws:iam::${local.prod}:*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  for_each = local.deploy
  name     = "deploy"
  role     = aws_iam_role.deploy[each.key].id
  policy   = data.aws_iam_policy_document.deploy[each.key].json
}

output "role_arn" {
  value = merge(
    { for k, r in aws_iam_role.task : k => r.arn },
    { for k, r in aws_iam_role.deploy : k => r.arn },
    { ecs_execution = aws_iam_role.ecs_execution.arn },
  )
}
output "github_oidc_provider_arn" { value = aws_iam_openid_connect_provider.github.arn }

# Stack 90 — tài khoản PROD: chạy `api` và `unseal-worker` thật trên ECS Fargate (ADR-066).
#
#   Mạng     VPC 2 AZ. Subnet CÔNG KHAI chỉ cho ALB; task và RDS ở subnet RIÊNG, KHÔNG NAT — ra AWS qua
#            VPC endpoint (KMS, ECR, Logs, Secrets Manager, SES; S3 gateway cho lớp image ECR). Task
#            không có đường ra internet tuỳ ý.
#   CSDL     RDS PostgreSQL 16, single-AZ, db.t4g.small, gp3 20 GB, mã hoá, force_ssl, backup 7 ngày,
#            deletion protection. Mật khẩu master do RDS quản lý trong Secrets Manager.
#   Image    ECR `tp-api`, `tp-unseal-worker`, `tp-migrate` — thẻ bất biến, quét lúc đẩy.
#   Chạy     Cluster `tp-prod`; service `tp-api` sau ALB HTTPS; service `tp-unseal-worker` (họ task
#            definition `tp-unseal-worker` — quy ước cảnh báo ⑵ của stack 60); task một lần `tp-migrate`.
#
# Bí mật KHÔNG tạo ở đây (giá trị sẽ vào state): tạo bằng CLI TRƯỚC khi apply — README, mục "Stack 90".
# Pipeline deploy (`tp-deploy`, `tp-deploy-worker`) đăng ký bản task definition mới; stack này bỏ qua
# thay đổi ấy (`ignore_changes`) để không giật lùi image.
#
# Tài khoản: prod. Profile: tp-prod (AdministratorAccess). Chạy sau 30, 50, 80.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "90-ecs/terraform.tfstate"
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
  default_tags { tags = { du-an = "trustprocure", stack = "90-ecs" } }
}

# ---------------------------------------------------------------------------------------------
# Biến
# ---------------------------------------------------------------------------------------------
variable "ten_mien_api" {
  description = "Tên miền của api trên ALB (vd api.<domain>). DNS ngoài AWS: CNAME tới ALB."
  type        = string
}

variable "url_cong_khai" {
  description = "TRUSTPROCURE_PUBLIC_BASE_URL — gốc của /login#… và /i#… (https://, không đường dẫn)."
  type        = string
}

variable "origin_duoc_phep" {
  description = "TRUSTPROCURE_ALLOWED_ORIGINS — origin trình duyệt được gửi yêu cầu không-GET kèm cookie."
  type        = list(string)
  default     = []
}

variable "anh" {
  description = "URI image theo DIGEST cho từng tiến trình: { api, worker, migrate } = \"<ecr>/tp-api@sha256:…\"."
  type        = object({ api = string, worker = string, migrate = string })
  validation {
    condition     = alltrue([for u in values(var.anh) : can(regex("@sha256:[0-9a-f]{64}$", u))])
    error_message = "Mỗi image phải ghim theo digest (@sha256:…), không theo thẻ."
  }
}

variable "so_ban_api" {
  type    = number
  default = 1
}

variable "so_ban_worker" {
  description = "0 tới khi CSDL có tổ chức đầu tiên: worker TỪ CHỐI khởi động khi nguồn tổ chức trả 0 hàng (ADR-040)."
  type        = number
  default     = 0
}

variable "kms" {
  description = "Nhãn phiên bản và kid (ADR-062/063/011). Đổi nhãn = xoay."
  type = object({
    org_key_version  = string
    totp_key_version = string
    receipt_kid      = string
  })
  default = { org_key_version = "kms-1", totp_key_version = "kms-totp-1", receipt_kid = "kms-2026-09" }
}

variable "ses" {
  description = "Địa chỉ gửi (khớp IAM của stack 80) và người nhận cảnh báo break-glass."
  type = object({
    tu_api            = string
    tu_canh_bao       = string
    nhan_canh_bao     = list(string)
    configuration_set = string
  })
}

variable "ses_endpoint_service" {
  description = "Tên dịch vụ VPC endpoint của SES API. Rỗng ⇒ không tạo (khi đó task KHÔNG gửi được thư)."
  type        = string
  default     = "email"
}

variable "endpoint_mot_az" {
  description = "Đặt interface endpoint ở MỘT AZ để giảm nửa chi phí; task ở AZ kia đi chéo AZ."
  type        = bool
  default     = true
}

locals {
  prod     = module.chung.account.prod
  region   = module.chung.region
  role_arn = module.chung.role_arn_prod
  cluster  = "tp-prod"
  cidr     = "10.20.0.0/16"
  az       = slice(data.aws_availability_zones.co.names, 0, 2)
  secret   = "arn:aws:secretsmanager:${local.region}:${local.prod}:secret:tp"
}

data "aws_availability_zones" "co" { state = "available" }

# ---------------------------------------------------------------------------------------------
# Mạng
# ---------------------------------------------------------------------------------------------
resource "aws_vpc" "tp" {
  cidr_block           = local.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "tp-prod" }
}

resource "aws_internet_gateway" "tp" {
  vpc_id = aws_vpc.tp.id
}

resource "aws_subnet" "cong_khai" {
  count             = 2
  vpc_id            = aws_vpc.tp.id
  cidr_block        = cidrsubnet(local.cidr, 8, count.index)
  availability_zone = local.az[count.index]
  tags              = { Name = "tp-cong-khai-${count.index}" }
}

resource "aws_subnet" "ung_dung" {
  count             = 2
  vpc_id            = aws_vpc.tp.id
  cidr_block        = cidrsubnet(local.cidr, 8, 10 + count.index)
  availability_zone = local.az[count.index]
  tags              = { Name = "tp-ung-dung-${count.index}" }
}

resource "aws_subnet" "csdl" {
  count             = 2
  vpc_id            = aws_vpc.tp.id
  cidr_block        = cidrsubnet(local.cidr, 8, 20 + count.index)
  availability_zone = local.az[count.index]
  tags              = { Name = "tp-csdl-${count.index}" }
}

resource "aws_route_table" "cong_khai" {
  vpc_id = aws_vpc.tp.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.tp.id
  }
}

resource "aws_route_table_association" "cong_khai" {
  count          = 2
  subnet_id      = aws_subnet.cong_khai[count.index].id
  route_table_id = aws_route_table.cong_khai.id
}

# Bảng định tuyến RIÊNG không có tuyến 0.0.0.0/0 — không NAT, không IGW.
resource "aws_route_table" "rieng" {
  vpc_id = aws_vpc.tp.id
}

resource "aws_route_table_association" "ung_dung" {
  count          = 2
  subnet_id      = aws_subnet.ung_dung[count.index].id
  route_table_id = aws_route_table.rieng.id
}

resource "aws_route_table_association" "csdl" {
  count          = 2
  subnet_id      = aws_subnet.csdl[count.index].id
  route_table_id = aws_route_table.rieng.id
}

# ---------------------------------------------------------------------------------------------
# Security group — mỗi tiến trình một nhóm, luật theo nhóm chứ không theo CIDR
# ---------------------------------------------------------------------------------------------
resource "aws_security_group" "alb" {
  name        = "tp-alb"
  description = "ALB cong khai: 443 (va 80 de chuyen huong) tu internet"
  vpc_id      = aws_vpc.tp.id
}

resource "aws_security_group" "api" {
  name        = "tp-api"
  description = "Task api"
  vpc_id      = aws_vpc.tp.id
}

resource "aws_security_group" "worker" {
  name        = "tp-unseal-worker"
  description = "Task unseal-worker"
  vpc_id      = aws_vpc.tp.id
}

resource "aws_security_group" "migrate" {
  name        = "tp-migrate"
  description = "Task migrate"
  vpc_id      = aws_vpc.tp.id
}

resource "aws_security_group" "csdl" {
  name        = "tp-csdl"
  description = "RDS: 5432 chi tu ba nhom task"
  vpc_id      = aws_vpc.tp.id
}

resource "aws_security_group" "endpoint" {
  name        = "tp-endpoint"
  description = "VPC endpoint: 443 chi tu ba nhom task"
  vpc_id      = aws_vpc.tp.id
}

locals {
  nhom_task = {
    api     = aws_security_group.api.id
    worker  = aws_security_group.worker.id
    migrate = aws_security_group.migrate.id
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each          = toset(["443", "80"])
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
}

resource "aws_vpc_security_group_egress_rule" "alb_api" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_ingress_rule" "api_tu_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_egress_rule" "task_csdl" {
  for_each                     = local.nhom_task
  security_group_id            = each.value
  referenced_security_group_id = aws_security_group.csdl.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "task_endpoint" {
  for_each                     = local.nhom_task
  security_group_id            = each.value
  referenced_security_group_id = aws_security_group.endpoint.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "task_s3" {
  for_each          = local.nhom_task
  security_group_id = each.value
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "csdl_tu_task" {
  for_each                     = local.nhom_task
  security_group_id            = aws_security_group.csdl.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "endpoint_tu_task" {
  for_each                     = local.nhom_task
  security_group_id            = aws_security_group.endpoint.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

# ---------------------------------------------------------------------------------------------
# VPC endpoint — đường DUY NHẤT ra AWS của task
# ---------------------------------------------------------------------------------------------
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.tp.id
  service_name      = "com.amazonaws.${local.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.rieng.id]
}

locals {
  dich_vu_endpoint = concat(
    ["kms", "ecr.api", "ecr.dkr", "logs", "secretsmanager"],
    var.ses_endpoint_service == "" ? [] : [var.ses_endpoint_service],
  )
  subnet_endpoint = var.endpoint_mot_az ? [aws_subnet.ung_dung[0].id] : aws_subnet.ung_dung[*].id
}

resource "aws_vpc_endpoint" "giao_dien" {
  for_each            = toset(local.dich_vu_endpoint)
  vpc_id              = aws_vpc.tp.id
  service_name        = "com.amazonaws.${local.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.subnet_endpoint
  security_group_ids  = [aws_security_group.endpoint.id]
  private_dns_enabled = true
}

# ---------------------------------------------------------------------------------------------
# CSDL
# ---------------------------------------------------------------------------------------------
resource "aws_db_subnet_group" "tp" {
  name       = "tp-prod"
  subnet_ids = aws_subnet.csdl[*].id
}

resource "aws_db_parameter_group" "tp" {
  name   = "tp-prod-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # Ghi log câu lệnh DDL — migration là đường duy nhất được đổi lược đồ.
  parameter {
    name  = "log_statement"
    value = "ddl"
  }
}

resource "aws_db_instance" "tp" {
  identifier                  = "tp-prod"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = "db.t4g.small"
  allocated_storage           = 20
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "trustprocure"
  username                    = "tp_owner"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.tp.name
  vpc_security_group_ids      = [aws_security_group.csdl.id]
  parameter_group_name        = aws_db_parameter_group.tp.name
  publicly_accessible         = false
  multi_az                    = false
  backup_retention_period     = 7
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "tp-prod-cuoi"
  auto_minor_version_upgrade  = true
  copy_tags_to_snapshot       = true
  lifecycle { prevent_destroy = true }
}

# ---------------------------------------------------------------------------------------------
# ECR
# ---------------------------------------------------------------------------------------------
resource "aws_ecr_repository" "tp" {
  for_each             = toset(["tp-api", "tp-unseal-worker", "tp-migrate"])
  name                 = each.key
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "tp" {
  for_each   = aws_ecr_repository.tp
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Giu 30 image moi nhat"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------------------------------------
# Bí mật (tạo bằng CLI trước — README) và quyền đọc của execution role
# ---------------------------------------------------------------------------------------------
data "aws_secretsmanager_secret" "api_db" { name = "tp/api/database-url" }
data "aws_secretsmanager_secret" "api_pepper" { name = "tp/api/otp-peppers" }
data "aws_secretsmanager_secret" "worker_db" { name = "tp/worker/database-url" }

# Secret master do RDS tạo (tên `rds!db-…`) nằm NGOÀI nhánh `tp/*` mà stack 30 cấp cho execution role.
resource "aws_iam_role_policy" "execution_rds_master" {
  name = "doc-secret-master-rds"
  role = module.chung.role.ecs_execution
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "BomMatKhauMasterChoTaskMigrate"
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = aws_db_instance.tp.master_user_secret[0].secret_arn
    }]
  })
}

# ---------------------------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------------------------
resource "aws_ecs_cluster" "tp" {
  name = local.cluster
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "tp" {
  for_each          = toset(["api", "unseal-worker", "migrate"])
  name              = "/tp/${each.key}"
  retention_in_days = 90
}

locals {
  env = {
    api = [
      { name = "NODE_ENV", value = "production" },
      { name = "TRUSTPROCURE_LISTEN_HOST", value = "0.0.0.0" },
      { name = "TRUSTPROCURE_LISTEN_PORT", value = "8080" },
      { name = "TRUSTPROCURE_PUBLIC_BASE_URL", value = var.url_cong_khai },
      { name = "TRUSTPROCURE_ALLOWED_ORIGINS", value = join(",", var.origin_duoc_phep) },
      # ALB nằm trong hai subnet công khai: chỉ CIDR ấy được nói "khách là ai" (sổ nợ 41).
      { name = "TRUSTPROCURE_TRUSTED_PROXIES", value = join(",", aws_subnet.cong_khai[*].cidr_block) },
      { name = "TRUSTPROCURE_KEY_ADAPTER", value = "aws-kms" },
      { name = "TRUSTPROCURE_AWS_REGION", value = local.region },
      { name = "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", value = "alias/tp-org-wrap" },
      { name = "TRUSTPROCURE_KMS_ORG_KEY_VERSION", value = var.kms.org_key_version },
      { name = "TRUSTPROCURE_KMS_TOTP_KEY_ID", value = "alias/tp-totp" },
      { name = "TRUSTPROCURE_KMS_TOTP_KEY_VERSION", value = var.kms.totp_key_version },
      { name = "TRUSTPROCURE_KMS_RECEIPT_KEY_ID", value = "alias/tp-receipt-sign" },
      { name = "TRUSTPROCURE_KMS_RECEIPT_KID", value = var.kms.receipt_kid },
      { name = "TRUSTPROCURE_SENDER_ADAPTER", value = "ses" },
      { name = "TRUSTPROCURE_SES_REGION", value = local.region },
      { name = "TRUSTPROCURE_SES_FROM", value = var.ses.tu_api },
      { name = "TRUSTPROCURE_SES_CONFIGURATION_SET", value = var.ses.configuration_set },
      { name = "TRUSTPROCURE_OTP_PEPPER_ACTIVE", value = "p1" },
    ]
    worker = [
      { name = "NODE_ENV", value = "production" },
      { name = "TRUSTPROCURE_KEY_ADAPTER", value = "aws-kms" },
      { name = "TRUSTPROCURE_AWS_REGION", value = local.region },
      { name = "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", value = "alias/tp-org-wrap" },
      { name = "TRUSTPROCURE_ALERT_ADAPTER", value = "ses" },
      { name = "TRUSTPROCURE_SES_REGION", value = local.region },
      { name = "TRUSTPROCURE_SES_FROM", value = var.ses.tu_canh_bao },
      { name = "TRUSTPROCURE_ALERT_EMAILS", value = join(",", var.ses.nhan_canh_bao) },
      { name = "TRUSTPROCURE_SES_CONFIGURATION_SET", value = var.ses.configuration_set },
    ]
    migrate = [
      { name = "TRUSTPROCURE_MIGRATE_DB_HOST", value = aws_db_instance.tp.address },
      { name = "TRUSTPROCURE_MIGRATE_DB_PORT", value = tostring(aws_db_instance.tp.port) },
      { name = "TRUSTPROCURE_MIGRATE_DB_NAME", value = aws_db_instance.tp.db_name },
    ]
  }
  bi_mat = {
    api = [
      { name = "TRUSTPROCURE_DATABASE_URL", valueFrom = data.aws_secretsmanager_secret.api_db.arn },
      { name = "TRUSTPROCURE_OTP_PEPPERS", valueFrom = data.aws_secretsmanager_secret.api_pepper.arn },
    ]
    worker = [
      { name = "TRUSTPROCURE_DATABASE_URL", valueFrom = data.aws_secretsmanager_secret.worker_db.arn },
    ]
    migrate = [
      { name = "TRUSTPROCURE_MIGRATE_DB_USER", valueFrom = "${aws_db_instance.tp.master_user_secret[0].secret_arn}:username::" },
      { name = "TRUSTPROCURE_MIGRATE_DB_PASSWORD", valueFrom = "${aws_db_instance.tp.master_user_secret[0].secret_arn}:password::" },
      { name = "TRUSTPROCURE_API_DATABASE_URL", valueFrom = data.aws_secretsmanager_secret.api_db.arn },
      { name = "TRUSTPROCURE_WORKER_DATABASE_URL", valueFrom = data.aws_secretsmanager_secret.worker_db.arn },
    ]
  }
  task = {
    api     = { ho = "tp-api", role = local.role_arn.api, cpu = 512, mem = 1024, log = "api", cong = [8080] }
    worker  = { ho = "tp-unseal-worker", role = local.role_arn.unseal_worker, cpu = 256, mem = 512, log = "unseal-worker", cong = [] }
    migrate = { ho = "tp-migrate", role = local.role_arn.migrate, cpu = 256, mem = 512, log = "migrate", cong = [] }
  }
}

resource "aws_ecs_task_definition" "tp" {
  for_each                 = local.task
  family                   = each.value.ho
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(each.value.cpu)
  memory                   = tostring(each.value.mem)
  execution_role_arn       = local.role_arn.ecs_execution
  task_role_arn            = each.value.role
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = each.value.ho
    image                  = var.anh[each.key]
    essential              = true
    readonlyRootFilesystem = true
    environment            = local.env[each.key]
    secrets                = local.bi_mat[each.key]
    portMappings           = [for p in each.value.cong : { containerPort = p, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.tp[each.value.log].name
        awslogs-region        = local.region
        awslogs-stream-prefix = each.value.ho
      }
    }
  }])
}

# ---------------------------------------------------------------------------------------------
# ALB + HTTPS
# ---------------------------------------------------------------------------------------------
resource "aws_acm_certificate" "api" {
  domain_name       = var.ten_mien_api
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

# Chờ bản ghi xác minh được thêm ở DNS ngoài — xem README (apply hai bước).
resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn
}

resource "aws_lb" "api" {
  name                       = "tp-api"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = aws_subnet.cong_khai[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
}

resource "aws_lb_target_group" "api" {
  name        = "tp-api"
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.tp.id
  health_check {
    path                = "/health"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ---------------------------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------------------------
resource "aws_ecs_service" "api" {
  name            = "tp-api"
  cluster         = aws_ecs_cluster.tp.id
  task_definition = aws_ecs_task_definition.tp["api"].arn
  desired_count   = var.so_ban_api
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.ung_dung[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "tp-api"
    container_port   = 8080
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  depends_on = [aws_lb_listener.https]
  # Pipeline `tp-deploy` đăng ký bản mới và cập nhật service — Terraform không giật lùi nó.
  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_ecs_service" "worker" {
  name            = "tp-unseal-worker"
  cluster         = aws_ecs_cluster.tp.id
  task_definition = aws_ecs_task_definition.tp["worker"].arn
  desired_count   = var.so_ban_worker
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.ung_dung[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle { ignore_changes = [task_definition] }
}

# ---------------------------------------------------------------------------------------------
# Đầu ra
# ---------------------------------------------------------------------------------------------
output "ban_ghi_dns" {
  description = "Thêm ở DNS ngoài: CNAME xác minh ACM (bước 1), rồi CNAME tên miền api tới ALB (bước 2)."
  value = {
    xac_minh_acm = [for o in aws_acm_certificate.api.domain_validation_options : {
      loai = o.resource_record_type, ten = o.resource_record_name, gia_tri = o.resource_record_value
    }]
    api = { loai = "CNAME", ten = var.ten_mien_api, gia_tri = aws_lb.api.dns_name }
  }
}

output "ecr" { value = { for k, r in aws_ecr_repository.tp : k => r.repository_url } }
output "rds_endpoint" { value = aws_db_instance.tp.address }

output "lenh_chay_migrate" {
  description = "Chạy task migrate một lần (mỗi lần deploy có migration mới)."
  value = join(" ", [
    "aws ecs run-task --profile tp-prod --cluster ${local.cluster} --launch-type FARGATE",
    "--task-definition tp-migrate",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.ung_dung[*].id)}],securityGroups=[${aws_security_group.migrate.id}],assignPublicIp=DISABLED}'",
  ])
}

output "bien_github" {
  description = "Biến của environment GitHub `prod` cho pipeline deploy (ADR-067) — role deploy không dò được mạng."
  value = {
    TP_SUBNETS_UNG_DUNG = join(",", aws_subnet.ung_dung[*].id)
    TP_SG_MIGRATE       = aws_security_group.migrate.id
  }
}

# Stack 90 — tài khoản PROD: chạy `api` và `unseal-worker` thật trên ECS Fargate (ADR-066).
#
#   Mạng     VPC 2 AZ. Subnet CÔNG KHAI chỉ cho ALB; task và RDS ở subnet RIÊNG — ra AWS qua VPC endpoint
#            (KMS, ECR, Logs, Secrets Manager, SES; S3 gateway cho lớp image ECR). [ADR-069] RIÊNG `api` ở
#            subnet của nó, đi qua MỘT NAT Gateway, chỉ cổng 443 — cho SMS (End User Messaging) và Zalo ZNS.
#            Worker, migrate, web không có tuyến ra internet.
#   CSDL     RDS PostgreSQL 16, single-AZ, db.t4g.small, gp3 20 GB, mã hoá, force_ssl, backup 7 ngày,
#            deletion protection. Mật khẩu master do RDS quản lý trong Secrets Manager.
#   Image    ECR `tp-api`, `tp-unseal-worker`, `tp-migrate`, `tp-web` — thẻ bất biến, quét lúc đẩy.
#   Chạy     Cluster `tp-prod`; service `tp-api` sau ALB HTTPS; service `tp-unseal-worker` (họ task
#            definition `tp-unseal-worker` — quy ước cảnh báo ⑵ của stack 60); task một lần `tp-migrate`.
#   Khoá     [ADR-070] service `tp-public-keys` phục vụ `/.well-known/trustprocure-receipt-keys*` trên cùng ALB — chỉ nửa
#            công khai (đọc từ state của stack 50), không task role, không KMS, không CSDL.
#   Neo      [ADR-071] task một lần `tp-neo` (role tp-anchor-job ⇒ mượn tp-anchor-writer ở audit): neo tài liệu khoá
#            biên nhận và mốc neo sổ kiểm toán vào bucket neo, ký bằng alias/tp-anchor-sign (stack 40).
#   Web      [ADR-068] MỘT tên miền: ALB chuyển `/api/*` THẲNG tới `tp-api` (bỏ tiền tố `/api`), mọi đường khác tới
#            service `tp-web` — `apps/web` ở chế độ chỉ tĩnh, không thấy cookie phiên, không CSDL, không task role.
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

# [ADR-070] kid đang ký và nửa công khai của mọi khoá ký biên nhận — một nguồn: stack 50 (chạy bằng KeyAdmin).
# [ADR-071] kid, ARN alias và nửa công khai của khoá ký mốc neo — stack 40 (tài khoản audit, KeyAdmin).
data "terraform_remote_state" "kms_audit" {
  backend = "s3"
  config = {
    bucket  = "tp-tfstate-243714547276"
    key     = "40-kms-audit/terraform.tfstate"
    region  = "ap-southeast-1"
    profile = "tp-mgmt"
  }
}

data "terraform_remote_state" "kms" {
  backend = "s3"
  config = {
    bucket  = "tp-tfstate-243714547276"
    key     = "50-kms-prod/terraform.tfstate"
    region  = "ap-southeast-1"
    profile = "tp-mgmt"
  }
}

provider "aws" {
  region              = module.chung.region
  profile             = "tp-prod"
  allowed_account_ids = [module.chung.account.prod]
  default_tags { tags = { du-an = "trustprocure", stack = "90-ecs" } }
}

# ---------------------------------------------------------------------------------------------
# Biến
# ---------------------------------------------------------------------------------------------
variable "ten_mien" {
  description = "[ADR-068] Tên miền công khai DUY NHẤT (web và /api/*) trên ALB, vd app.<domain>. DNS ngoài AWS: CNAME tới ALB."
  type        = string
  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.ten_mien))
    error_message = "ten_mien phải là một domain chữ thường hợp lệ."
  }
}

variable "anh" {
  description = "URI image theo DIGEST cho từng tiến trình: { api, worker, migrate, web, public_keys, neo } = \"<ecr>/tp-api@sha256:…\"."
  type        = object({ api = string, worker = string, migrate = string, web = string, public_keys = string, neo = string })
  validation {
    condition     = alltrue([for u in values(var.anh) : can(regex("@sha256:[0-9a-f]{64}$", u))])
    error_message = "Mỗi image phải ghim theo digest (@sha256:…), không theo thẻ."
  }
}

variable "so_ban_api" {
  type    = number
  default = 1
}

variable "so_ban_web" {
  type    = number
  default = 1
}

variable "so_ban_public_keys" {
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
  })
  default = { org_key_version = "kms-1", totp_key_version = "kms-totp-1" }
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

variable "sms" {
  description = "[ADR-069] Kênh SMS của api — null = tắt. danh_tinh_gui: sender ID (brandname) đã đăng ký, khớp IAM của stack 85."
  type = object({
    danh_tinh_gui     = string
    configuration_set = optional(string)
  })
  default = null
}

variable "zalo" {
  description = "[ADR-069] Kênh Zalo ZNS của api — null = tắt. Ba ID template ZNS đã duyệt; secret token của stack 85."
  type = object({
    template_otp        = string
    template_invitation = string
    template_deadline   = string
  })
  default = null
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
  # [ADR-070] { kid_dang_dung, khoa_cong_khai = { kid = SPKI base64 } }
  bien_nhan = data.terraform_remote_state.kms.outputs.bien_nhan
  # [ADR-071] { kid_dang_dung, alias_arn, khoa_cong_khai = { kid = SPKI base64 } }
  neo = data.terraform_remote_state.kms_audit.outputs.neo
  # [ADR-068] Một origin cho cả trang và /api/*: không CORS, cookie phiên đi cùng origin.
  goc = "https://${var.ten_mien}"
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

# [ADR-069] Subnet riêng của api: bảng định tuyến của nó — và CHỈ của nó — có tuyến ra NAT.
resource "aws_subnet" "api" {
  count             = 2
  vpc_id            = aws_vpc.tp.id
  cidr_block        = cidrsubnet(local.cidr, 8, 30 + count.index)
  availability_zone = local.az[count.index]
  tags              = { Name = "tp-api-${count.index}" }
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

# [ADR-069] MỘT NAT ở AZ đầu (~35 USD/tháng + phí dữ liệu); api ở AZ kia đi chéo AZ. NAT hỏng thì SMS/Zalo
# hỏng, email và mọi thứ khác không — chấp nhận ở quy mô này.
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "tp-nat" }
}

resource "aws_nat_gateway" "api" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.cong_khai[0].id
  tags          = { Name = "tp-nat" }
  depends_on    = [aws_internet_gateway.tp]
}

resource "aws_route_table" "api" {
  vpc_id = aws_vpc.tp.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.api.id
  }
}

resource "aws_route_table_association" "api" {
  count          = 2
  subnet_id      = aws_subnet.api[count.index].id
  route_table_id = aws_route_table.api.id
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

resource "aws_security_group" "web" {
  name        = "tp-web"
  description = "Task web (chi tinh)"
  vpc_id      = aws_vpc.tp.id
}

resource "aws_security_group" "public_keys" {
  name        = "tp-public-keys"
  description = "Task public-keys (chi nua cong khai)"
  vpc_id      = aws_vpc.tp.id
}

resource "aws_security_group" "neo" {
  name        = "tp-neo"
  description = "Task neo (CSDL, KMS/STS/S3 qua endpoint)"
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
  # Nhóm được nói chuyện với CSDL.
  nhom_task = {
    api     = aws_security_group.api.id
    worker  = aws_security_group.worker.id
    migrate = aws_security_group.migrate.id
    # [ADR-071] job neo đọc đầu chuỗi kiểm toán (app_api) để ký mốc neo.
    neo = aws_security_group.neo.id
  }
  # Nhóm cần đường ra AWS (kéo image ECR, đẩy log) — web có mặt ở đây, KHÔNG có mặt ở CSDL.
  nhom_ra_aws = merge(local.nhom_task, { web = aws_security_group.web.id, public_keys = aws_security_group.public_keys.id })
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

resource "aws_vpc_security_group_egress_rule" "alb_web" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = 8090
  to_port                      = 8090
}

resource "aws_vpc_security_group_ingress_rule" "web_tu_alb" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8090
  to_port                      = 8090
}

resource "aws_vpc_security_group_egress_rule" "alb_public_keys" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.public_keys.id
  ip_protocol                  = "tcp"
  from_port                    = 8070
  to_port                      = 8070
}

resource "aws_vpc_security_group_ingress_rule" "public_keys_tu_alb" {
  security_group_id            = aws_security_group.public_keys.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8070
  to_port                      = 8070
}

resource "aws_vpc_security_group_ingress_rule" "api_tu_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

# [ADR-069] api ra internet CHỈ 443 (SMS End User Messaging, Zalo ZNS). Không lọc theo tên miền — xem ADR-069.
resource "aws_vpc_security_group_egress_rule" "api_internet" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
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
  for_each                     = local.nhom_ra_aws
  security_group_id            = each.value
  referenced_security_group_id = aws_security_group.endpoint.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "task_s3" {
  for_each          = local.nhom_ra_aws
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
  for_each                     = local.nhom_ra_aws
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
    # [ADR-071] `sts`: job neo mượn tp-anchor-writer bằng sts:AssumeRole — task không có đường ra internet.
    ["kms", "ecr.api", "ecr.dkr", "logs", "secretsmanager", "sts"],
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
  for_each             = toset(["tp-api", "tp-unseal-worker", "tp-migrate", "tp-web", "tp-public-keys", "tp-neo"])
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
# [ADR-072 phần 1] Job neo đăng nhập bằng app_neo_login (vai chỉ-đọc sổ, liệt kê được tổ chức) — secret riêng.
data "aws_secretsmanager_secret" "neo_db" { name = "tp/neo/database-url" }

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
  for_each          = toset(["api", "unseal-worker", "migrate", "web", "public-keys", "neo"])
  name              = "/tp/${each.key}"
  retention_in_days = 90
}

locals {
  # [ADR-069] Kênh số điện thoại: chỉ khai biến của kênh đã bật — api đọc "có biến" là "bật".
  env_kenh_so = concat(
    var.sms == null ? [] : concat([
      { name = "TRUSTPROCURE_SMS_REGION", value = local.region },
      { name = "TRUSTPROCURE_SMS_ORIGINATION_IDENTITY", value = var.sms.danh_tinh_gui },
      ], var.sms.configuration_set == null ? [] : [
      { name = "TRUSTPROCURE_SMS_CONFIGURATION_SET", value = var.sms.configuration_set },
    ]),
    var.zalo == null ? [] : [
      { name = "TRUSTPROCURE_ZALO_REGION", value = local.region },
      { name = "TRUSTPROCURE_ZALO_SECRET_ID", value = "tp/api/zalo-oa" },
      { name = "TRUSTPROCURE_ZALO_TEMPLATE_OTP", value = var.zalo.template_otp },
      { name = "TRUSTPROCURE_ZALO_TEMPLATE_INVITATION", value = var.zalo.template_invitation },
      { name = "TRUSTPROCURE_ZALO_TEMPLATE_DEADLINE", value = var.zalo.template_deadline },
    ],
  )
  env = {
    api = concat([
      { name = "NODE_ENV", value = "production" },
      { name = "TRUSTPROCURE_LISTEN_HOST", value = "0.0.0.0" },
      { name = "TRUSTPROCURE_LISTEN_PORT", value = "8080" },
      { name = "TRUSTPROCURE_PUBLIC_BASE_URL", value = local.goc },
      { name = "TRUSTPROCURE_ALLOWED_ORIGINS", value = local.goc },
      # ALB nằm trong hai subnet công khai: chỉ CIDR ấy được nói "khách là ai" (sổ nợ 41).
      { name = "TRUSTPROCURE_TRUSTED_PROXIES", value = join(",", aws_subnet.cong_khai[*].cidr_block) },
      { name = "TRUSTPROCURE_KEY_ADAPTER", value = "aws-kms" },
      { name = "TRUSTPROCURE_AWS_REGION", value = local.region },
      { name = "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", value = "alias/tp-org-wrap" },
      { name = "TRUSTPROCURE_KMS_ORG_KEY_VERSION", value = var.kms.org_key_version },
      { name = "TRUSTPROCURE_KMS_TOTP_KEY_ID", value = "alias/tp-totp" },
      { name = "TRUSTPROCURE_KMS_TOTP_KEY_VERSION", value = var.kms.totp_key_version },
      { name = "TRUSTPROCURE_KMS_RECEIPT_KEY_ID", value = "alias/tp-receipt-sign" },
      { name = "TRUSTPROCURE_KMS_RECEIPT_KID", value = local.bien_nhan.kid_dang_dung },
      { name = "TRUSTPROCURE_SENDER_ADAPTER", value = "ses" },
      { name = "TRUSTPROCURE_SES_REGION", value = local.region },
      { name = "TRUSTPROCURE_SES_FROM", value = var.ses.tu_api },
      { name = "TRUSTPROCURE_SES_CONFIGURATION_SET", value = var.ses.configuration_set },
      { name = "TRUSTPROCURE_OTP_PEPPER_ACTIVE", value = "p1" },
    ], local.env_kenh_so)
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
    # Image đã đặt ba biến này; khai lại ở đây để task definition tự nói nó chạy chế độ nào (ADR-068).
    web = [
      { name = "NODE_ENV", value = "production" },
      { name = "TRUSTPROCURE_WEB_STATIC_ONLY", value = "1" },
      { name = "TRUSTPROCURE_WEB_HOST", value = "0.0.0.0" },
      { name = "TRUSTPROCURE_WEB_PORT", value = "8090" },
    ]
    public_keys = [
      { name = "NODE_ENV", value = "production" },
      { name = "TRUSTPROCURE_PUBLIC_KEYS_HOST", value = "0.0.0.0" },
      { name = "TRUSTPROCURE_PUBLIC_KEYS_PORT", value = "8070" },
      { name = "TRUSTPROCURE_RECEIPT_ACTIVE_KID", value = local.bien_nhan.kid_dang_dung },
      { name = "TRUSTPROCURE_RECEIPT_PUBLIC_KEYS", value = jsonencode(local.bien_nhan.khoa_cong_khai) },
    ]
    neo = [
      { name = "NODE_ENV", value = "production" },
      { name = "TRUSTPROCURE_NEO_S3_BUCKET", value = module.chung.bucket.anchor },
      { name = "TRUSTPROCURE_NEO_ROLE_ARN", value = module.chung.anchor_writer_role_arn },
      { name = "TRUSTPROCURE_NEO_REGION", value = local.region },
      { name = "TRUSTPROCURE_NEO_KMS_KEY_ID", value = local.neo.alias_arn },
      { name = "TRUSTPROCURE_NEO_KID", value = local.neo.kid_dang_dung },
      { name = "TRUSTPROCURE_NEO_KHOA_CONG_KHAI", value = join(",", [for kid, k in local.neo.khoa_cong_khai : "${kid}=${k}"]) },
      { name = "TRUSTPROCURE_RECEIPT_PUBLIC_KEYS", value = jsonencode(local.bien_nhan.khoa_cong_khai) },
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
      { name = "TRUSTPROCURE_NEO_DATABASE_URL", valueFrom = data.aws_secretsmanager_secret.neo_db.arn },
    ]
    web         = []
    public_keys = []
    # [ADR-072 phần 1] ~~Vai app_api — cùng URL với api~~ Vai app_neo (065): chỉ ĐỌC hai bảng sổ, gọi được
    # hàm liệt kê tổ chức mà app_api cố ý không có. URL của api ở đây thì SET ROLE app_neo ném 42501.
    neo = [
      { name = "DATABASE_URL", valueFrom = data.aws_secretsmanager_secret.neo_db.arn },
    ]
  }
  task = {
    api     = { ho = "tp-api", role = local.role_arn.api, cpu = 512, mem = 1024, log = "api", cong = [8080] }
    worker  = { ho = "tp-unseal-worker", role = local.role_arn.unseal_worker, cpu = 256, mem = 512, log = "unseal-worker", cong = [] }
    migrate = { ho = "tp-migrate", role = local.role_arn.migrate, cpu = 256, mem = 512, log = "migrate", cong = [] }
    # Web không gọi AWS nào: KHÔNG task role (chỉ execution role để kéo image, đẩy log).
    web = { ho = "tp-web", role = null, cpu = 256, mem = 512, log = "web", cong = [8090] }
    # [ADR-070] Chỉ nửa công khai trong biến môi trường: không task role.
    public_keys = { ho = "tp-public-keys", role = null, cpu = 256, mem = 512, log = "public-keys", cong = [8070] }
    # [ADR-071] Task một lần — không service. Role duy nhất có sts:AssumeRole sang tp-anchor-writer.
    neo = { ho = "tp-neo", role = local.role_arn.anchor_job, cpu = 256, mem = 512, log = "neo", cong = [] }
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
  domain_name       = var.ten_mien
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

resource "aws_lb_target_group" "web" {
  name        = "tp-web"
  port        = 8090
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.tp.id
  health_check {
    path                = "/nop-thau"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
  deregistration_delay = 30
}

# [ADR-068] Mặc định: trang tĩnh. `/api/*` đi THẲNG tới api — tiến trình web không bao giờ thấy yêu cầu ấy.
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_target_group" "public_keys" {
  name        = "tp-public-keys"
  port        = 8070
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.tp.id
  health_check {
    path                = "/.well-known/trustprocure-receipt-keys"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
  deregistration_delay = 30
}

# [ADR-070] Đường công bố khoá — không viết lại đường: service phục vụ đúng đường dẫn cố định ấy.
resource "aws_lb_listener_rule" "public_keys" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 5
  condition {
    path_pattern { values = ["/.well-known/trustprocure-receipt-keys", "/.well-known/trustprocure-receipt-keys/*"] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.public_keys.arn
  }
}

# Trang gọi `fetch("/api<đường>")` còn api phục vụ `<đường>` (bộ chuyển tiếp demo của ADR-044 cũng bỏ tiền tố):
# ALB viết lại đường trước khi chuyển. `/api` trơn không khớp mẫu này ⇒ rơi về web ⇒ 404.
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    path_pattern { values = ["/api/*"] }
  }
  transform {
    type = "url-rewrite"
    url_rewrite_config {
      rewrite {
        regex   = "^/api/(.*)$"
        replace = "/$1"
      }
    }
  }
  action {
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
    subnets          = aws_subnet.api[*].id
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
  depends_on = [aws_lb_listener_rule.api]
  # Pipeline `tp-deploy` đăng ký bản mới và cập nhật service — Terraform không giật lùi nó.
  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_ecs_service" "public_keys" {
  name            = "tp-public-keys"
  cluster         = aws_ecs_cluster.tp.id
  task_definition = aws_ecs_task_definition.tp["public_keys"].arn
  desired_count   = var.so_ban_public_keys
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.ung_dung[*].id
    security_groups  = [aws_security_group.public_keys.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.public_keys.arn
    container_name   = "tp-public-keys"
    container_port   = 8070
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  depends_on = [aws_lb_listener_rule.public_keys]
  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_ecs_service" "web" {
  name            = "tp-web"
  cluster         = aws_ecs_cluster.tp.id
  task_definition = aws_ecs_task_definition.tp["web"].arn
  desired_count   = var.so_ban_web
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.ung_dung[*].id
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "tp-web"
    container_port   = 8090
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  depends_on = [aws_lb_listener.https]
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
  description = "Thêm ở DNS ngoài: CNAME xác minh ACM (bước 1), rồi CNAME tên miền công khai tới ALB (bước 2)."
  value = {
    xac_minh_acm = [for o in aws_acm_certificate.api.domain_validation_options : {
      loai = o.resource_record_type, ten = o.resource_record_name, gia_tri = o.resource_record_value
    }]
    cong_khai = { loai = "CNAME", ten = var.ten_mien, gia_tri = aws_lb.api.dns_name }
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
    TP_SG_NEO           = aws_security_group.neo.id
  }
}

output "lenh_chay_neo" {
  description = "[ADR-071] Task neo một lần: mặc định neo tài liệu khoá biên nhận; đổi lệnh để xuất/kiểm mốc neo sổ kiểm toán."
  value = {
    khoa_bien_nhan = join(" ", [
      "aws ecs run-task --profile tp-prod --cluster ${local.cluster} --launch-type FARGATE --task-definition tp-neo",
      "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.ung_dung[*].id)}],securityGroups=[${aws_security_group.neo.id}],assignPublicIp=DISABLED}'",
    ])
    xuat = join(" ", [
      "aws ecs run-task --profile tp-prod --cluster ${local.cluster} --launch-type FARGATE --task-definition tp-neo",
      "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.ung_dung[*].id)}],securityGroups=[${aws_security_group.neo.id}],assignPublicIp=DISABLED}'",
      "--overrides '{\"containerOverrides\":[{\"name\":\"tp-neo\",\"command\":[\"xuat\",\"--org\",\"<uuid>\"]}]}'",
    ])
  }
}

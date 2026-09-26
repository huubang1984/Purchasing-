# Stack 90 — tài khoản PROD: chạy `api` và `unseal-worker` thật trên ECS Fargate (ADR-066).
#
#   Mạng     VPC 2 AZ. Subnet CÔNG KHAI chỉ cho ALB; task và RDS ở subnet RIÊNG — ra AWS qua VPC endpoint
#            (KMS, ECR, Logs, Secrets Manager, SES; S3 gateway cho lớp image ECR). [ADR-069] RIÊNG `api` ở
#            subnet của nó, đi qua MỘT NAT Gateway, chỉ cổng 443 — cho Zalo ZNS. Worker, migrate, web không có
#            tuyến ra internet. [ADR-076] SMS đi qua VPC endpoint `sms-voice`; Route 53 DNS Firewall của VPC chỉ
#            phân giải một danh sách tên đóng — mọi tên khác NXDOMAIN, ghi log, cảnh báo ⑸ của stack 60.
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

variable "che_do_dns" {
  description = "[ADR-076] BLOCK (mặc định) hay ALERT (chỉ ghi log) cho mọi tên ngoài danh sách."
  type        = string
  default     = "BLOCK"
  validation {
    condition     = contains(["BLOCK", "ALERT"], var.che_do_dns)
    error_message = "che_do_dns phải là BLOCK hoặc ALERT."
  }
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

# [ADR-069] api ra internet CHỈ 443. [ADR-076] Tên miền lọc ở DNS Firewall (dưới): chỉ hai tên Zalo phân giải được
# ra ngoài AWS. SG không lọc được theo tên — IP của Zalo không cố định —, nên kết nối THẲNG bằng IP vẫn đi qua; xem ADR-076.
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
    # [ADR-076] SMS (End User Messaging) không còn đi qua NAT: danh sách tên ra ngoài AWS chỉ còn Zalo.
    var.sms == null ? [] : ["sms-voice"],
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
# [ADR-076] ROUTE 53 DNS FIREWALL — VPC CHỈ PHÂN GIẢI MỘT DANH SÁCH TÊN ĐÓNG
# ---------------------------------------------------------------------------------------------
# Áp cho MỌI task của VPC (một nhóm quy tắc gắn vào VPC, không gắn theo subnet). Danh sách là đúng những tên mà mã và
# nền Fargate gọi — không có wildcard `*.amazonaws.com`: một wildcard như thế cho phân giải bucket S3 hay API Gateway
# của BẤT KỲ ai, tức một đường tuồn dữ liệu qua NAT của api.
#   AWS qua endpoint : kms, ecr (api + dkr của tài khoản prod), logs, secretsmanager, sts, email (SES), sms-voice.
#   S3               : bucket lớp image của ECR ở region, và bucket neo (job neo — ADR-071). Không có `s3.<region>`
#                      trơn, không có bucket nào khác.
#   CSDL             : đúng địa chỉ RDS của stack này.
#   Ngoài AWS        : business.openapi.zalo.me, oauth.zaloapp.com — hai URL của `apps/api/src/adapters/gui-zalo.ts`.
# `TRUST_REDIRECTION_DOMAIN`: tên được phép thường là CNAME sang tên hạ tầng (S3, RDS, CDN của Zalo); kiểm cả chuỗi
# CNAME thì mỗi lần nhà cung cấp đổi hạ tầng là một sự cố. Cái giá: một tên TRONG danh sách trỏ đi đâu cũng được đi theo.
#
# `che_do_dns = "ALERT"` chỉ ghi log, không chặn — dùng khi thêm một đích mới để xem truy vấn trước khi chặn.
#
# Giới hạn, nói thẳng: DNS Firewall chặn PHÂN GIẢI, không chặn KẾT NỐI. Mã độc trong api nối thẳng tới một IP (không
# hỏi DNS) vẫn đi qua NAT cổng 443. Chặn cả đường ấy cần AWS Network Firewall (~300 USD/tháng) — ADR-076 ghi lý do không làm.
locals {
  ten_duoc_phan_giai = [
    "kms.${local.region}.amazonaws.com",
    "api.ecr.${local.region}.amazonaws.com",
    "${local.prod}.dkr.ecr.${local.region}.amazonaws.com",
    "logs.${local.region}.amazonaws.com",
    "secretsmanager.${local.region}.amazonaws.com",
    "sts.${local.region}.amazonaws.com",
    "email.${local.region}.amazonaws.com",
    "sms-voice.${local.region}.amazonaws.com",
    "prod-${local.region}-starport-layer-bucket.s3.${local.region}.amazonaws.com",
    "${module.chung.bucket.anchor}.s3.${local.region}.amazonaws.com",
    aws_db_instance.tp.address,
    "business.openapi.zalo.me",
    "oauth.zaloapp.com",
  ]
  # Tên cảnh báo ⑸ của stack 60 bắt theo TÊN — đổi ở đây thì đổi cả ở đó (`hinh-dang-dns.test.ts` so hai phía).
  ten_alarm_dns = "tp-dns-bi-chan"
}

resource "aws_route53_resolver_firewall_domain_list" "duoc_phep" {
  name    = "tp-duoc-phan-giai"
  domains = local.ten_duoc_phan_giai
}

resource "aws_route53_resolver_firewall_domain_list" "moi_ten" {
  name    = "tp-moi-ten"
  domains = ["*"]
}

resource "aws_route53_resolver_firewall_rule_group" "tp" {
  name = "tp-loc-ten-mien"
}

resource "aws_route53_resolver_firewall_rule" "cho_phep" {
  name                               = "cho-phep-danh-sach"
  firewall_rule_group_id             = aws_route53_resolver_firewall_rule_group.tp.id
  firewall_domain_list_id            = aws_route53_resolver_firewall_domain_list.duoc_phep.id
  priority                           = 100
  action                             = "ALLOW"
  firewall_domain_redirection_action = "TRUST_REDIRECTION_DOMAIN"
}

resource "aws_route53_resolver_firewall_rule" "chan_con_lai" {
  name                    = "chan-moi-ten-khac"
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.tp.id
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.moi_ten.id
  priority                = 200
  action                  = var.che_do_dns
  block_response          = var.che_do_dns == "BLOCK" ? "NXDOMAIN" : null
}

resource "aws_route53_resolver_firewall_rule_group_association" "tp" {
  name                   = "tp-loc-ten-mien"
  firewall_rule_group_id = aws_route53_resolver_firewall_rule_group.tp.id
  vpc_id                 = aws_vpc.tp.id
  priority               = 101
  mutation_protection    = "ENABLED"
}

# Fail-closed: DNS Firewall không đánh giá được thì truy vấn bị chặn, không lọt.
resource "aws_route53_resolver_firewall_config" "tp" {
  resource_id        = aws_vpc.tp.id
  firewall_fail_open = "DISABLED"
}

# Log mọi truy vấn của VPC; `firewall_rule_action` có mặt ở dòng bị quy tắc chặn/cảnh báo khớp.
resource "aws_cloudwatch_log_group" "dns" {
  name              = "/tp/dns"
  retention_in_days = 90
}

resource "aws_route53_resolver_query_log_config" "tp" {
  name            = "tp-truy-van-dns"
  destination_arn = aws_cloudwatch_log_group.dns.arn
}

resource "aws_route53_resolver_query_log_config_association" "tp" {
  resolver_query_log_config_id = aws_route53_resolver_query_log_config.tp.id
  resource_id                  = aws_vpc.tp.id
}

resource "aws_cloudwatch_log_metric_filter" "dns_bi_chan" {
  name           = "tp-dns-bi-chan"
  log_group_name = aws_cloudwatch_log_group.dns.name
  pattern        = "{ ($.firewall_rule_action = \"BLOCK\") || ($.firewall_rule_action = \"ALERT\") }"
  metric_transformation {
    name          = "TruyVanNgoaiDanhSach"
    namespace     = "TrustProcure/DNS"
    value         = "1"
    default_value = "0"
  }
}

# Một truy vấn ngoài danh sách là đủ: mã của dự án không bao giờ hỏi tên ngoài danh sách, nên đó là cấu hình thiếu
# (một đích mới) hoặc api bị chiếm. Thư đi qua stack 60 ⑸ (EventBridge chuyển sang audit), không SNS ở prod.
resource "aws_cloudwatch_metric_alarm" "dns_bi_chan" {
  alarm_name          = local.ten_alarm_dns
  alarm_description   = "[ADR-076] Truy van DNS ngoai danh sach duoc phep trong VPC tp-prod. Doc log /tp/dns (query_name, srcids.instance)."
  namespace           = "TrustProcure/DNS"
  metric_name         = "TruyVanNgoaiDanhSach"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
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
#
# [ADR-075] Header bảo mật do ALB đặt trên MỌI phản hồi của listener này — web, api, public-keys, và phản hồi
# chính ALB sinh (502/503 khi target chết) mà không app nào chạm được:
#   Strict-Transport-Security  1 năm + includeSubDomains, KHÔNG preload (ten_mien là một subdomain kiểu
#                              app.<domain>; preload chỉ áp cho tên miền gốc và gần như không rút lại được);
#   X-Content-Type-Options     nosniff — trùng giá trị api/web tự đặt, phủ thêm phản hồi của ALB;
#   X-Frame-Options            DENY — cùng ý `frame-ancestors 'none'` trong CSP của web, phủ cả api và
#                              public-keys (trình duyệt cũ không đọc CSP);
#   Server                     tắt — không quảng cáo `awselb/2.0`.
# CSP KHÔNG đặt ở đây: ALB ghi ĐÈ header cùng tên của target, và CSP của web là thứ chi tiết (script-src 'self'…)
# mà một CSP chung sẽ phải chép lại và giữ đồng bộ. `hinh-dang-alb.test.ts` ghim bốn dòng này.
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  routing_http_response_strict_transport_security_header_value = "max-age=31536000; includeSubDomains"
  routing_http_response_x_content_type_options_header_value    = "nosniff"
  routing_http_response_x_frame_options_header_value           = "DENY"
  routing_http_response_server_enabled                         = false

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
# ---------------------------------------------------------------------------------------------
# [ADR-077] CẢNH BÁO VẬN HÀNH — HỆ THỐNG NGỪNG PHỤC VỤ
# ---------------------------------------------------------------------------------------------
# Mọi alarm ở đây mang tiền tố `tp-van-hanh-`: stack 60 ⑹ bắt THEO TIỀN TỐ sự kiện đổi trạng thái (ALARM và OK) và
# chuyển sang audit ⇒ email — không SNS ở prod. Thêm alarm mới giữ tiền tố ấy là đủ để nó có thư.
#   ALB   target không khoẻ (≥1) và KHÔNG còn target khoẻ nào, cho từng target group; tỉ lệ 5xx (ALB tự sinh + target)
#         > 5% trong 5 phút khi có ≥ 20 yêu cầu; p95 thời gian phản hồi của api > 2 giây trong 10 phút.
#   ECS   số task đang chạy < số mong muốn trong 5 phút (Container Insights) — cách DUY NHẤT thấy worker chết, vì nó
#         không đứng sau ALB. Service có `so_ban_* = 0` không có alarm (worker trước tổ chức đầu tiên — ADR-040).
#   RDS   CPU > 80% trong 15 phút; dung lượng trống < 2 GB; > 150 kết nối (trần mặc định của db.t4g.small ≈ 190).
# Thiếu dữ liệu: "không còn target khoẻ" và "task thiếu" coi thiếu là VI PHẠM (service biến mất thì metric cũng biến
# mất); các alarm tỉ lệ/độ trễ coi thiếu là bình thường (không có khách thì không có yêu cầu).
locals {
  tien_to_van_hanh = "tp-van-hanh-"

  tg_van_hanh = {
    api         = aws_lb_target_group.api
    web         = aws_lb_target_group.web
    public-keys = aws_lb_target_group.public_keys
  }

  service_van_hanh = {
    for k, v in {
      api         = { ten = aws_ecs_service.api.name, so_ban = var.so_ban_api }
      web         = { ten = aws_ecs_service.web.name, so_ban = var.so_ban_web }
      public-keys = { ten = aws_ecs_service.public_keys.name, so_ban = var.so_ban_public_keys }
      worker      = { ten = aws_ecs_service.worker.name, so_ban = var.so_ban_worker }
    } : k => v if v.so_ban > 0
  }
}

resource "aws_cloudwatch_metric_alarm" "tg_khong_khoe" {
  for_each            = local.tg_van_hanh
  alarm_name          = "${local.tien_to_van_hanh}${each.key}-target-khong-khoe"
  alarm_description   = "[ADR-077] Target group tp-${each.key} co target khong khoe trong 3 phut."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { TargetGroup = each.value.arn_suffix, LoadBalancer = aws_lb.api.arn_suffix }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "tg_het_target" {
  for_each            = local.tg_van_hanh
  alarm_name          = "${local.tien_to_van_hanh}${each.key}-khong-con-target-khoe"
  alarm_description   = "[ADR-077] Target group tp-${each.key} KHONG con target khoe nao trong 3 phut — duong ${each.key} dang tra 503."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { TargetGroup = each.value.arn_suffix, LoadBalancer = aws_lb.api.arn_suffix }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.tien_to_van_hanh}alb-5xx"
  alarm_description   = "[ADR-077] Hon 5% yeu cau tren ALB tra 5xx (ALB tu sinh + target) trong 5 phut, khi co it nhat 20 yeu cau."
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "ti_le"
    expression  = "IF(yc >= 20, 100 * (FILL(elb, 0) + FILL(tg, 0)) / yc, 0)"
    label       = "Ti le 5xx (%)"
    return_data = true
  }
  metric_query {
    id = "yc"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = { LoadBalancer = aws_lb.api.arn_suffix }
      stat        = "Sum"
      period      = 300
    }
  }
  metric_query {
    id = "elb"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_ELB_5XX_Count"
      dimensions  = { LoadBalancer = aws_lb.api.arn_suffix }
      stat        = "Sum"
      period      = 300
    }
  }
  metric_query {
    id = "tg"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = { LoadBalancer = aws_lb.api.arn_suffix }
      stat        = "Sum"
      period      = 300
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "api_cham" {
  alarm_name          = "${local.tien_to_van_hanh}api-p95-cham"
  alarm_description   = "[ADR-077] p95 thoi gian phan hoi cua tp-api > 2 giay trong 10 phut."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { TargetGroup = aws_lb_target_group.api.arn_suffix, LoadBalancer = aws_lb.api.arn_suffix }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "task_thieu" {
  for_each            = local.service_van_hanh
  alarm_name          = "${local.tien_to_van_hanh}${each.key}-thieu-task"
  alarm_description   = "[ADR-077] Service ${each.value.ten} chay it hon ${each.value.so_ban} task trong 5 phut. Doc su kien service (ecs describe-services) va log /tp/${each.key == "worker" ? "unseal-worker" : each.key}."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = aws_ecs_cluster.tp.name, ServiceName = each.value.ten }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 5
  threshold           = each.value.so_ban
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.tien_to_van_hanh}rds-cpu"
  alarm_description   = "[ADR-077] CPU cua RDS tp-prod > 80% trong 15 phut (db.t4g.small co the dang tieu credit burst)."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.tp.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "rds_dia" {
  alarm_name          = "${local.tien_to_van_hanh}rds-dung-luong"
  alarm_description   = "[ADR-077] Dung luong trong cua RDS tp-prod < 2 GB. Het dia la CSDL chuyen sang chi doc."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.tp.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "rds_ket_noi" {
  alarm_name          = "${local.tien_to_van_hanh}rds-ket-noi"
  alarm_description   = "[ADR-077] RDS tp-prod co hon 150 ket noi (tran mac dinh cua db.t4g.small xap xi 190) trong 10 phut."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.tp.identifier }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 150
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

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

# ---------------------------------------------------------------------------------------------
# [ADR-072] Lịch neo sổ kiểm toán — mỗi ngày 02:15 giờ Việt Nam, `tp-neo lich`: liệt kê mọi tổ chức, xuất mốc neo
# rồi kiểm. Task thoát ≠ 0 ⇒ cảnh báo ⑶ của stack 60 (email từ tài khoản audit).
# ---------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "lich_neo_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.prod]
    }
  }
}

resource "aws_iam_role" "lich_neo" {
  name               = "tp-lich-neo"
  assume_role_policy = data.aws_iam_policy_document.lich_neo_trust.json
}

# Chỉ chạy ĐÚNG họ tp-neo trong ĐÚNG cluster, và chỉ trao ĐÚNG role của job neo.
data "aws_iam_policy_document" "lich_neo" {
  statement {
    sid       = "ChayJobNeo"
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${local.region}:${local.prod}:task-definition/tp-neo", "arn:aws:ecs:${local.region}:${local.prod}:task-definition/tp-neo:*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.tp.arn]
    }
  }
  statement {
    sid       = "TraoRoleJobNeo"
    actions   = ["iam:PassRole"]
    resources = [local.role_arn.anchor_job, local.role_arn.ecs_execution]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "lich_neo" {
  name   = "chay-job-neo"
  role   = aws_iam_role.lich_neo.id
  policy = data.aws_iam_policy_document.lich_neo.json
}

resource "aws_scheduler_schedule" "neo" {
  name                         = "tp-neo-hang-ngay"
  description                  = "Neo so kiem toan moi to chuc, roi kiem (ADR-072)"
  schedule_expression          = "cron(15 2 * * ? *)"
  schedule_expression_timezone = "Asia/Ho_Chi_Minh"
  flexible_time_window { mode = "OFF" }

  target {
    arn      = aws_ecs_cluster.tp.arn
    role_arn = aws_iam_role.lich_neo.arn
    # Họ KHÔNG kèm số bản: RunTask lấy bản ACTIVE mới nhất — bản pipeline vừa đăng ký, không phải bản Terraform tạo.
    ecs_parameters {
      task_definition_arn = "arn:aws:ecs:${local.region}:${local.prod}:task-definition/tp-neo"
      launch_type         = "FARGATE"
      task_count          = 1
      network_configuration {
        subnets          = aws_subnet.ung_dung[*].id
        security_groups  = [aws_security_group.neo.id]
        assign_public_ip = false
      }
    }
    input = jsonencode({ containerOverrides = [{ name = "tp-neo", command = ["lich"] }] })
    # Không thử lại: một lượt hỏng phải thành MỘT cảnh báo đọc được, không ba lượt chồng nhau.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }

  depends_on = [aws_ecs_task_definition.tp]
}

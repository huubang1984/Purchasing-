# Stack 70 — DÙNG MỘT LẦN: phép đo ⒜ của ADR-062 trên prod, TRƯỚC khi có dữ liệu khách hàng thật.
#
# Dựng đúng thứ cần để chạy hai task Fargate mang role thật `tp-api` và `tp-unseal-worker`, mỗi
# task gọi KMS bằng aws-cli rồi in kết quả từng bước ra CloudWatch Logs. `chay-do-kms.ps1` điều
# khiển hai task và đọc kết quả. Đo xong: `terraform destroy` — CloudTrail tổ chức giữ bằng chứng.
#
#   task api    : ① GenerateDataKeyPairWithoutPlaintext ⇒ THÀNH CÔNG (đối chứng dương của task)
#                 ② Decrypt blob vừa sinh            ⇒ AccessDeniedException
#                 ②b GenerateDataKeyPair (có bản rõ)  ⇒ AccessDeniedException
#   task worker : ③ Decrypt, đúng context            ⇒ THÀNH CÔNG (đối chứng dương của ②)
#                 ④ Decrypt THIẾU context ⇒ AccessDeniedException (key policy đòi org_id)
#                 ④a Decrypt với org_id của tổ chức KHÁC ⇒ InvalidCiphertextException (policy cho
#                    qua vì có org_id, nhưng context là AAD của blob nên KMS không mở được)
#                 ④b GenerateDataKeyPairWithoutPlaintext ⇒ AccessDeniedException
#   máy người chạy: ⑤ AdministratorAccess và KeyAdmin Decrypt ⇒ AccessDeniedException
#
#   [ADR-063] alias/tp-totp, context { org_id, key_version }:
#   task api    : ⑥ Encrypt ⇒ THÀNH CÔNG · ⑥a Decrypt đúng context ⇒ THÀNH CÔNG (api được mở TOTP)
#                 ⑥b Decrypt thiếu key_version ⇒ AccessDenied · ⑥c org_id khác ⇒ InvalidCiphertext
#                 ⑥d Encrypt kèm một khoá context lạ ⇒ AccessDenied · ⑥e GenerateDataKey ⇒ AccessDenied
#   task worker : ⑦ Decrypt blob TOTP ⇒ AccessDeniedException
#   máy người chạy: ⑧ AdministratorAccess và KeyAdmin Decrypt blob TOTP ⇒ AccessDeniedException
#
# Không bước nào IN bản rõ: mọi lời gọi có thể trả `Plaintext`/`PrivateKeyPlaintext` đều chạy với
# `--query KeyId`, nên thành công chỉ để lại ARN khoá trong log.
#
# Một bước "bị từ chối" chỉ tính ĐẠT khi lỗi đúng TÊN mong đợi — lỗi mạng hay lỗi cấu hình KHÔNG
# được đọc thành "đã chặn" (cùng lý do README bắt buộc đối chứng dương).
#
# Tác dụng phụ CÓ CHỦ Ý: nếu stack 60 đã apply, lần đăng ký task definition `tp-do-kms-worker`
# (gắn role worker vào một họ khác `tp-unseal-worker`) bắn cảnh báo ⑵c — đó là đối chứng dương
# của chính cảnh báo ấy.
#
# Tài khoản: prod. Profile: tp-prod (AdministratorAccess). Chạy sau 30 và 50 (stack 50 có alias/tp-totp).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "tp-tfstate-243714547276"
    key          = "70-do-kms/terraform.tfstate"
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
  default_tags { tags = { du-an = "trustprocure", stack = "70-do-kms", dung-mot-lan = "co" } }
}

locals {
  region   = module.chung.region
  role_arn = module.chung.role_arn_prod
  ten      = "tp-do-kms"
  khoa     = "alias/tp-org-wrap"
  # [ADR-063] CMK riêng của TOTP — context { org_id, key_version }, chỉ tp-api Encrypt/Decrypt.
  khoa_totp = "alias/tp-totp"
  ctx_totp  = "org_id=$ORG,key_version=do-kms"

  # aws-cli chính hãng, ghim theo DIGEST (thẻ 2.37.0): một thẻ trỏ lại được, digest thì không.
  image = "public.ecr.aws/aws-cli/aws-cli@sha256:337494c2047176fe9abcf45a5d1eaf1c2c62cae40953284fb1143b5c6170f065"

  # `ket_qua <bước> <DAT|HONG> <chi tiết>` — dòng duy nhất chay-do-kms.ps1 đọc để chấm.
  ham_chung = <<-EOT
    ket_qua() { echo "KQ $1 $2 $${3:-}"; }
    # Chạy lệnh, mong LỖI có tên $2; ĐẠT chỉ khi lỗi đúng tên ấy.
    mong_loi() {
      buoc="$1"; ten_loi="$2"; shift 2
      if out=$("$@" 2>&1); then ket_qua "$buoc" HONG "thanh-cong-ngoai-mong-doi"
      else case "$out" in *"$ten_loi"*) ket_qua "$buoc" DAT "$ten_loi" ;; *) ket_qua "$buoc" HONG "$(echo "$out" | tr '\n' ' ' | cut -c1-200)" ;; esac
      fi
    }
  EOT

  kich_ban_api = <<-EOT
    ${local.ham_chung}
    ORG="do-kms-$(date +%s)"
    echo "ORG $ORG"
    # --- tp-org-wrap (ADR-062) ---------------------------------------------------------------
    if BLOB=$(aws kms generate-data-key-pair-without-plaintext --key-id ${local.khoa} \
        --key-pair-spec ECC_NIST_P256 --encryption-context org_id=$ORG \
        --query PrivateKeyCiphertextBlob --output text 2>&1); then
      ket_qua 1 DAT; echo "BLOB $BLOB"
      echo "$BLOB" | base64 -d > /tmp/blob
      mong_loi 2 AccessDeniedException aws kms decrypt --ciphertext-blob fileb:///tmp/blob \
        --encryption-context org_id=$ORG --query KeyId --output text
    else
      ket_qua 1 HONG "$(echo "$BLOB" | tr '\n' ' ' | cut -c1-200)"
    fi
    mong_loi 2b AccessDeniedException aws kms generate-data-key-pair --key-id ${local.khoa} \
      --key-pair-spec ECC_NIST_P256 --encryption-context org_id=$ORG --query KeyId --output text
    # --- tp-totp (ADR-063): api bọc VÀ mở được, nhưng chỉ đúng context -------------------------
    head -c 20 /dev/urandom > /tmp/totp
    if TOTP=$(aws kms encrypt --key-id ${local.khoa_totp} --plaintext fileb:///tmp/totp \
        --encryption-context ${local.ctx_totp} --query CiphertextBlob --output text 2>&1); then
      ket_qua 6 DAT; echo "TOTP_BLOB $TOTP"
      echo "$TOTP" | base64 -d > /tmp/totp_blob
      if out=$(aws kms decrypt --key-id ${local.khoa_totp} --ciphertext-blob fileb:///tmp/totp_blob \
          --encryption-context ${local.ctx_totp} --query KeyId --output text 2>&1); then ket_qua 6a DAT
      else ket_qua 6a HONG "$(echo "$out" | tr '\n' ' ' | cut -c1-200)"; fi
      mong_loi 6b AccessDeniedException aws kms decrypt --key-id ${local.khoa_totp} \
        --ciphertext-blob fileb:///tmp/totp_blob --encryption-context org_id=$ORG --query KeyId --output text
      mong_loi 6c InvalidCiphertextException aws kms decrypt --key-id ${local.khoa_totp} \
        --ciphertext-blob fileb:///tmp/totp_blob --encryption-context org_id=khac-$ORG,key_version=do-kms \
        --query KeyId --output text
    else
      ket_qua 6 HONG "$(echo "$TOTP" | tr '\n' ' ' | cut -c1-200)"
    fi
    mong_loi 6d AccessDeniedException aws kms encrypt --key-id ${local.khoa_totp} --plaintext fileb:///tmp/totp \
      --encryption-context ${local.ctx_totp},la=x --query KeyId --output text
    mong_loi 6e AccessDeniedException aws kms generate-data-key --key-id ${local.khoa_totp} --key-spec AES_256 \
      --encryption-context ${local.ctx_totp} --query KeyId --output text
    rm -f /tmp/totp
  EOT

  kich_ban_worker = <<-EOT
    ${local.ham_chung}
    : "$${BLOB:?thieu BLOB}" "$${ORG:?thieu ORG}"
    echo "$BLOB" | base64 -d > /tmp/blob
    if out=$(aws kms decrypt --ciphertext-blob fileb:///tmp/blob --encryption-context org_id=$ORG \
        --query KeyId --output text 2>&1); then ket_qua 3 DAT
    else ket_qua 3 HONG "$(echo "$out" | tr '\n' ' ' | cut -c1-200)"; fi
    mong_loi 4 AccessDeniedException aws kms decrypt --ciphertext-blob fileb:///tmp/blob \
      --query KeyId --output text
    mong_loi 4a InvalidCiphertextException aws kms decrypt --ciphertext-blob fileb:///tmp/blob \
      --encryption-context org_id=khac-$ORG --query KeyId --output text
    mong_loi 4b AccessDeniedException aws kms generate-data-key-pair-without-plaintext \
      --key-id ${local.khoa} --key-pair-spec ECC_NIST_P256 --encryption-context org_id=$ORG \
      --query KeyId --output text
    # [ADR-063] worker KHÔNG mở được bí mật TOTP — quyền giải mã của nó chỉ trên tp-org-wrap.
    if [ -n "$${TOTP_BLOB:-}" ]; then
      echo "$TOTP_BLOB" | base64 -d > /tmp/totp_blob
      mong_loi 7 AccessDeniedException aws kms decrypt --key-id ${local.khoa_totp} \
        --ciphertext-blob fileb:///tmp/totp_blob --encryption-context ${local.ctx_totp} --query KeyId --output text
    else
      ket_qua 7 HONG "thieu-TOTP_BLOB-tu-buoc-6"
    fi
  EOT

  task = {
    api    = { role = local.role_arn.api, kich_ban = local.kich_ban_api }
    worker = { role = local.role_arn.unseal_worker, kich_ban = local.kich_ban_worker }
  }
}

# ---------------------------------------------------------------------------------------------
# Mạng tối thiểu: một subnet công khai, task nhận IP công khai để tới KMS/Logs/ECR Public. Không NAT,
# không VPC endpoint — rẻ nhất cho vài phút chạy. Không cổng vào nào mở.
# ---------------------------------------------------------------------------------------------
data "aws_availability_zones" "co" { state = "available" }

resource "aws_vpc" "do" {
  cidr_block           = "10.99.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.ten }
}

resource "aws_internet_gateway" "do" {
  vpc_id = aws_vpc.do.id
}

resource "aws_subnet" "do" {
  vpc_id            = aws_vpc.do.id
  cidr_block        = "10.99.0.0/25"
  availability_zone = data.aws_availability_zones.co.names[0]
  tags              = { Name = local.ten }
}

resource "aws_route_table" "do" {
  vpc_id = aws_vpc.do.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.do.id
  }
}

resource "aws_route_table_association" "do" {
  subnet_id      = aws_subnet.do.id
  route_table_id = aws_route_table.do.id
}

resource "aws_security_group" "do" {
  name        = local.ten
  description = "Chi ra 443, khong cong vao"
  vpc_id      = aws_vpc.do.id
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------------------------------------
# Cluster, log, hai task definition
# ---------------------------------------------------------------------------------------------
resource "aws_ecs_cluster" "do" {
  name = local.ten
}

resource "aws_cloudwatch_log_group" "do" {
  name              = "/tp/do-kms"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "do" {
  for_each                 = local.task
  family                   = "${local.ten}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = local.role_arn.ecs_execution
  task_role_arn            = each.value.role
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name       = "do-kms"
    image      = local.image
    essential  = true
    entryPoint = ["bash", "-c"]
    command    = [each.value.kich_ban]
    environment = [
      { name = "AWS_REGION", value = local.region },
      { name = "AWS_PAGER", value = "" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.do.name
        awslogs-region        = local.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

output "cluster" { value = aws_ecs_cluster.do.name }
output "subnet" { value = aws_subnet.do.id }
output "security_group" { value = aws_security_group.do.id }
output "log_group" { value = aws_cloudwatch_log_group.do.name }
output "task_definition" { value = { for k, v in aws_ecs_task_definition.do : k => v.arn } }
output "khoa" { value = local.khoa }
output "khoa_totp" { value = local.khoa_totp }

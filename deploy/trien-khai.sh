#!/usr/bin/env bash
# ==============================================================================================
# deploy/trien-khai.sh — CÁC BƯỚC AWS CỦA PIPELINE DEPLOY (`.github/workflows/deploy.yml`, ADR-067)
#
#   trien-khai.sh day      <tep-anh.tar.gz> <repo-ecr> <the>   ⇒ in `<registry>/<repo>@sha256:…`
#   trien-khai.sh dang-ky  <ho-task-def> <anh> <role-task|->   ⇒ in ARN bản task definition mới (`-` = KHÔNG task role)
#   trien-khai.sh migrate  <arn-task-def>                      ⇒ chạy một lần, thoát 0 chỉ khi exit code 0
#   trien-khai.sh neo      <arn-task-def>                      ⇒ [ADR-071] job neo (lệnh mặc định: neo khoá biên nhận)
#   trien-khai.sh cap-nhat <service> <arn-task-def>            ⇒ cập nhật service, chờ ổn định
#
# Biến bắt buộc: AWS_REGION, TAI_KHOAN, CLUSTER; `migrate` cần thêm SUBNETS (phẩy ngăn cách) và SG_MIGRATE; `neo` cần
# SUBNETS và SG_NEO.
#
# Nguyên tắc:
#   • Image trong task definition ghim theo DIGEST, không theo thẻ — thẻ chỉ để người đọc ECR.
#   • ECR bất biến thẻ: chạy lại cùng commit thì dùng lại image đã có, không đẩy đè (đẩy đè bị từ chối).
#   • Bản task definition mới chép từ bản ACTIVE mới nhất của họ, CHỈ đổi image — env, bí mật, role do
#     Terraform (stack 90) khai. Trước khi đăng ký, kiểm task role đúng role mong đợi: một bản mới nhất bị
#     ai đó gắn role khác thì pipeline dừng, không nhân bản nó.
#   • `cap-nhat` chỉ ĐẠT khi service chạy ĐÚNG bản vừa đăng ký — circuit breaker rollback cũng "ổn định",
#     nhưng trên bản cũ.
#   • Không in cấu hình task (có tên secret, URL công khai); chỉ in ARN, digest, trạng thái.
# ==============================================================================================
set -euo pipefail

: "${AWS_REGION:?}" "${TAI_KHOAN:?}" "${CLUSTER:?}"
REGISTRY="${TAI_KHOAN}.dkr.ecr.${AWS_REGION}.amazonaws.com"
SO_LAN_CHO=3 # mỗi lần `aws ecs wait` tối đa ~10 phút

loi() { echo "LOI: $*" >&2; exit 1; }

day() {
  local tep=$1 repo=$2 the=$3 cuc_bo digest ra
  [[ $the =~ ^[0-9a-f]{40}$ ]] || loi "thẻ phải là SHA commit 40 ký tự"
  if ra=$(aws ecr describe-images --repository-name "$repo" --image-ids "imageTag=$the" \
      --query 'imageDetails[0].imageDigest' --output text 2>&1); then
    echo "$repo:$the đã có trong ECR — dùng lại, không đẩy" >&2
    digest=$ra
  else
    [[ $ra == *ImageNotFoundException* ]] || loi "describe-images $repo: $ra"
    cuc_bo=$(docker load -q -i "$tep" | sed -n 's/^Loaded image: //p' | head -n1)
    [[ -n $cuc_bo ]] || loi "không nạp được image từ $tep"
    docker tag "$cuc_bo" "$REGISTRY/$repo:$the"
    docker push -q "$REGISTRY/$repo:$the" >&2
    digest=$(aws ecr describe-images --repository-name "$repo" --image-ids "imageTag=$the" \
      --query 'imageDetails[0].imageDigest' --output text)
  fi
  [[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || loi "digest lạ cho $repo: $digest"
  echo "$REGISTRY/$repo@$digest"
}

dang_ky() {
  local ho=$1 anh=$2 role=$3 tam
  [[ $anh == "$REGISTRY/"*@sha256:* ]] || loi "image phải ghim digest trong registry của tài khoản prod"
  tam=$(mktemp -d)
  aws ecs describe-task-definition --task-definition "$ho" --query taskDefinition --output json >"$tam/cu.json"
  local role_arn=""
  [[ $role == - ]] || role_arn="arn:aws:iam::${TAI_KHOAN}:role/$role"
  # `-`: họ ấy KHÔNG được mang task role (web, ADR-068) — một bản bị gắn role thì dừng, không nhân bản.
  jq -e --arg ho "$ho" --arg role "$role_arn" '
      .family == $ho and (.taskRoleArn // "") == $role
      and (.containerDefinitions | length) == 1 and .containerDefinitions[0].name == $ho' \
    "$tam/cu.json" >/dev/null || loi "bản mới nhất của họ $ho không đúng hình dạng (họ, task role $role, một container)"
  jq --arg anh "$anh" '
      .containerDefinitions[0].image = $anh
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
            .registeredAt, .registeredBy, .deregisteredAt)' \
    "$tam/cu.json" >"$tam/moi.json"
  aws ecs register-task-definition --cli-input-json "file://$tam/moi.json" \
    --query taskDefinition.taskDefinitionArn --output text
  rm -rf "$tam"
}

cho() { # cho <waiter> <tham số…> — lặp waiter tới SO_LAN_CHO lần
  local lan
  for ((lan = 1; lan <= SO_LAN_CHO; lan++)); do
    if aws ecs wait "$@"; then return 0; fi
    echo "chưa xong sau lần chờ $lan/$SO_LAN_CHO" >&2
  done
  return 1
}

chay_mot_lan() { # chay_mot_lan <arn> <security-group> <nhãn>
  local arn=$1 sg=$2 nhan=$3 ra task ma ly_do
  : "${SUBNETS:?}"
  [[ $SUBNETS =~ ^subnet-[0-9a-f]+(,subnet-[0-9a-f]+)*$ ]] || loi "SUBNETS không đúng dạng"
  [[ $sg =~ ^sg-[0-9a-f]+$ ]] || loi "security group của $nhan không đúng dạng"
  ra=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$arn" \
    --started-by "gh-deploy-${GITHUB_RUN_ID:-tay}" \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$sg],assignPublicIp=DISABLED}" \
    --query '{task: tasks[0].taskArn, loi: length(failures)}' --output json)
  [[ $(jq -r .loi <<<"$ra") == 0 ]] || loi "run-task $nhan trả failures"
  task=$(jq -r .task <<<"$ra")
  echo "$nhan: $task" >&2
  cho tasks-stopped --cluster "$CLUSTER" --tasks "$task" || loi "task $nhan chưa dừng"
  ra=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" \
    --query '{ma: tasks[0].containers[0].exitCode, ly_do: tasks[0].stoppedReason}' --output json)
  ma=$(jq -r .ma <<<"$ra")
  ly_do=$(jq -r .ly_do <<<"$ra")
  [[ $ma == 0 ]] || loi "$nhan thoát mã $ma ($ly_do) — đọc log /tp/$nhan"
  echo "$nhan: xong (exit 0)" >&2
}

migrate() {
  : "${SG_MIGRATE:?}"
  chay_mot_lan "$1" "$SG_MIGRATE" migrate
}

neo() {
  : "${SG_NEO:?}"
  chay_mot_lan "$1" "$SG_NEO" neo
}

cap_nhat() {
  local svc=$1 arn=$2 dang_chay
  aws ecs update-service --cluster "$CLUSTER" --service "$svc" --task-definition "$arn" \
    --query service.serviceName --output text >/dev/null
  echo "$svc: đã cập nhật, chờ ổn định" >&2
  cho services-stable --cluster "$CLUSTER" --services "$svc" || loi "$svc chưa ổn định"
  dang_chay=$(aws ecs describe-services --cluster "$CLUSTER" --services "$svc" \
    --query 'services[0].taskDefinition' --output text)
  [[ $dang_chay == "$arn" ]] || loi "$svc đang chạy $dang_chay, không phải $arn — circuit breaker đã rollback"
  echo "$svc: chạy $arn" >&2
}

case "${1:-}" in
  day) shift; [[ $# -eq 3 ]] || loi "day <tep> <repo> <the>"; day "$@" ;;
  dang-ky) shift; [[ $# -eq 3 ]] || loi "dang-ky <ho> <anh> <role>"; dang_ky "$@" ;;
  migrate) shift; [[ $# -eq 1 ]] || loi "migrate <arn>"; migrate "$@" ;;
  neo) shift; [[ $# -eq 1 ]] || loi "neo <arn>"; neo "$@" ;;
  cap-nhat) shift; [[ $# -eq 2 ]] || loi "cap-nhat <service> <arn>"; cap_nhat "$@" ;;
  *) loi "lệnh: day | dang-ky | migrate | neo | cap-nhat" ;;
esac

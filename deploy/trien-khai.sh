#!/usr/bin/env bash
# ==============================================================================================
# deploy/trien-khai.sh — CÁC BƯỚC AWS CỦA PIPELINE DEPLOY (`.github/workflows/deploy.yml`, ADR-067)
#
#   trien-khai.sh day      <tep-anh.tar.gz> <repo-ecr> <the>   ⇒ in `<registry>/<repo>@sha256:…`
#   trien-khai.sh dang-ky  <ho-task-def> <anh> <role-task|->   ⇒ in ARN bản task definition mới (`-` = KHÔNG task role)
#   trien-khai.sh migrate  <arn-task-def>                      ⇒ chạy một lần, thoát 0 chỉ khi exit code 0
#   trien-khai.sh neo      <arn-task-def>                      ⇒ [ADR-071] job neo (lệnh mặc định: neo khoá biên nhận)
#   trien-khai.sh cap-nhat <service> <arn-task-def>            ⇒ cập nhật service, chờ ổn định
#   [S1.9103 / ADR-111] `.github/workflows/khoi-tao.yml`:
#   trien-khai.sh kiem-khoi-tao                                ⇒ KHÔNG AWS: kiểm đầu vào, in bảng người duyệt duyệt (markdown)
#   trien-khai.sh khoi-tao <arn-task-def>                      ⇒ chạy task khởi tạo với đúng đầu vào ấy; thoát 0 ⇒ XOÁ bí mật
#                                                                bản khai, in dòng kết quả (markdown)
#
# Biến bắt buộc: AWS_REGION, TAI_KHOAN, CLUSTER ~~;~~ **[S1.9103]** (trừ `kiem-khoi-tao`); `migrate` cần thêm SUBNETS (phẩy
# ngăn cách) và SG_MIGRATE; `neo` cần SUBNETS và SG_NEO; `khoi-tao` cần SUBNETS và SG_KHOI_TAO. Đầu vào của khởi tạo đi qua
# biến môi trường — workflow chuyển `inputs` vào `env:`, không nội suy vào mã: CHE_DO, BI_MAT, PHIEN_BAN, TO_CHUC,
# SO_NGUOI, SO_VAI.
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

# [S1.9103] `kiem-khoi-tao` chạy ở job `build` — không quyền AWS, không biến AWS.
if [[ ${1:-} != kiem-khoi-tao ]]; then
  : "${AWS_REGION:?}" "${TAI_KHOAN:?}" "${CLUSTER:?}"
fi
REGISTRY="${TAI_KHOAN:-}.dkr.ecr.${AWS_REGION:-}.amazonaws.com"
SO_LAN_CHO=3 # mỗi lần `aws ecs wait` tối đa ~10 phút
TASK_ARN=""  # [S1.9103] task mà `chay_mot_lan` vừa chạy — `khoi_tao` đọc log của đúng task ấy
KHI_HONG=""  # [S1.9103] một dòng dặn thêm khi `loi` dừng giữa chừng (bí mật bản khai còn hay đã xoá)

loi() {
  echo "LOI: $*" >&2
  [[ -z $KHI_HONG ]] || echo "$KHI_HONG" >&2
  exit 1
}

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

chay_mot_lan() { # chay_mot_lan <arn> <security-group> <nhãn> [overrides JSON]
  local arn=$1 sg=$2 nhan=$3 ra task ma ly_do them=()
  : "${SUBNETS:?}"
  [[ $SUBNETS =~ ^subnet-[0-9a-f]+(,subnet-[0-9a-f]+)*$ ]] || loi "SUBNETS không đúng dạng"
  [[ $sg =~ ^sg-[0-9a-f]+$ ]] || loi "security group của $nhan không đúng dạng"
  [[ -z ${4:-} ]] || them=(--overrides "$4")
  ra=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$arn" \
    --started-by "gh-deploy-${GITHUB_RUN_ID:-tay}" \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$sg],assignPublicIp=DISABLED}" \
    "${them[@]}" \
    --query '{task: tasks[0].taskArn, loi: length(failures)}' --output json)
  [[ $(jq -r .loi <<<"$ra") == 0 ]] || loi "run-task $nhan trả failures"
  task=$(jq -r .task <<<"$ra")
  TASK_ARN=$task
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

# ---------------------------------------------------------------------------------------------
# [S1.9103 / ADR-111] Khởi tạo tổ chức. Người duyệt của environment `prod-khoi-tao` không đọc được bản khai (email, họ tên),
# nên thứ họ duyệt là bảng `bang_duyet` in ở job `build`: tên và PHIÊN BẢN của bí mật, tổ chức, số người, số vai. Công cụ
# (`tools/khoi-tao-to-chuc`) đọc ĐÚNG phiên bản ấy và dừng TRƯỚC CSDL nếu bản khai không khớp ba kỳ vọng. Luật của
# `kiem_dau_vao` là luật của `docThamSo` — `tests/deploy/khoi-tao-sh.test.ts` so hai phía trên cùng bộ đầu vào.
# ---------------------------------------------------------------------------------------------
TRAN_SO_NGUOI=50 # TRAN_SO_NGUOI của tools/khoi-tao-to-chuc/src/ban-khai.ts
SO_MA_VAI=6      # MA_VAI.length — mỗi người tối đa sáu vai, không vai nào hai lần
SO_LAN_DOC_LOG=${SO_LAN_DOC_LOG:-10}
CHO_DOC_LOG_GIAY=${CHO_DOC_LOG_GIAY:-3}
# Dòng kết quả của công cụ — chỉ dòng khớp TRỌN mẫu này được chép sang tóm tắt của run (không chép chữ tuỳ ý từ log).
MAU_KET_QUA='^\[khoi-tao\] (tao|them-nguoi): to chuc [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}, [0-9]{1,3} nguoi, [0-9]{1,3} vai, ban khai phien ban [A-Za-z0-9-]{32,64}$'

kiem_dau_vao() {
  local LC_ALL=C
  : "${CHE_DO?}" "${BI_MAT?}" "${PHIEN_BAN?}" "${TO_CHUC?}" "${SO_NGUOI?}" "${SO_VAI?}"
  [[ $CHE_DO == tao || $CHE_DO == them-nguoi ]] || loi "che_do phải là tao hoặc them-nguoi"
  [[ $BI_MAT =~ ^tp/khoi-tao/ban-khai/[A-Za-z0-9/_+=.@-]+$ ]] || loi "bi_mat phải là một tên bí mật dưới tp/khoi-tao/ban-khai/"
  [[ $PHIEN_BAN =~ ^[A-Za-z0-9][A-Za-z0-9-]{31,63}$ ]] ||
    loi "phien_ban phải là một VersionId (32–64 ký tự: chữ, số, gạch nối; mở đầu bằng chữ hay số)"
  if [[ $CHE_DO == tao ]]; then
    [[ $TO_CHUC =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || loi "to_chuc của tao là slug của tổ chức mới"
  else
    [[ $TO_CHUC =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
      loi "to_chuc của them-nguoi là mã (UUIDv4 chữ thường) của tổ chức đã có"
  fi
  [[ $SO_NGUOI =~ ^[1-9][0-9]{0,2}$ ]] && ((SO_NGUOI <= TRAN_SO_NGUOI)) ||
    loi "so_nguoi phải là số nguyên từ 1 tới $TRAN_SO_NGUOI"
  [[ $SO_VAI =~ ^[1-9][0-9]{0,2}$ ]] && ((SO_VAI >= SO_NGUOI && SO_VAI <= SO_NGUOI * SO_MA_VAI)) ||
    loi "so_vai phải là số nguyên từ so_nguoi tới $SO_MA_VAI lần so_nguoi"
}

bang_duyet() {
  local mo_ta="mã tổ chức ĐÃ CÓ"
  [[ $CHE_DO == them-nguoi ]] || mo_ta="slug của tổ chức MỚI"
  cat <<EOF
### Khởi tạo tổ chức — điều người duyệt duyệt

| | |
|---|---|
| Chế độ | \`$CHE_DO\` |
| Bí mật bản khai | \`$BI_MAT\` |
| Phiên bản (VersionId) | \`$PHIEN_BAN\` |
| Tổ chức ($mo_ta) | \`$TO_CHUC\` |
| Số người | $SO_NGUOI |
| Tổng số vai (cặp người–vai) | $SO_VAI |

Task đọc ĐÚNG phiên bản trên và dừng TRƯỚC khi chạm CSDL nếu bản khai ở phiên bản ấy không khớp ba dòng cuối.
Environment \`prod-khoi-tao\` không cho người bấm tự duyệt. Chạy xong (thoát 0) thì bí mật bị xoá, không cửa sổ khôi phục.
EOF
}

khoi_tao() {
  local arn=$1 lenh luong dong="" lan
  kiem_dau_vao
  : "${SG_KHOI_TAO:?}"
  lenh=$(jq -cn --arg c "$CHE_DO" --arg b "$BI_MAT" --arg p "$PHIEN_BAN" --arg t "$TO_CHUC" --arg n "$SO_NGUOI" --arg v "$SO_VAI" \
    '{containerOverrides: [{name: "tp-khoi-tao",
      command: [$c, "--ban-khai-secret", $b, "--phien-ban", $p, "--to-chuc", $t, "--so-nguoi", $n, "--so-vai", $v]}]}')
  KHI_HONG="Bí mật $BI_MAT CÒN (chưa xoá — nó mang email và họ tên): sửa bản khai rồi chạy lại với phiên bản mới, hoặc xoá tay: aws secretsmanager delete-secret --secret-id $BI_MAT --force-delete-without-recovery"
  chay_mot_lan "$arn" "$SG_KHOI_TAO" khoi-tao "$lenh"
  # Thoát 0 ⇒ giao dịch đã COMMIT. Xoá NGAY, trước mọi bước khác, không cửa sổ khôi phục (chủ dự án chọn).
  KHI_HONG="Task đã thoát 0 (giao dịch đã commit) nhưng XOÁ bí mật hỏng — xoá tay: aws secretsmanager delete-secret --secret-id $BI_MAT --force-delete-without-recovery"
  aws secretsmanager delete-secret --secret-id "$BI_MAT" --force-delete-without-recovery --query Name --output text >/dev/null ||
    loi "xoá bí mật $BI_MAT hỏng"
  KHI_HONG=""
  echo "khoi-tao: đã xoá bí mật $BI_MAT" >&2
  # Dòng kết quả (mã tổ chức, số người, số vai — không dữ liệu cá nhân) từ log của CHÍNH task ấy; log tới chậm vài giây.
  luong="tp-khoi-tao/tp-khoi-tao/${TASK_ARN##*/}"
  for ((lan = 1; lan <= SO_LAN_DOC_LOG; lan++)); do
    dong=$(aws logs filter-log-events --log-group-name /tp/khoi-tao --log-stream-names "$luong" \
      --query 'events[].message' --output json | jq -r '.[]' | grep -E "$MAU_KET_QUA" | head -n 1) || dong=""
    [[ -z $dong ]] || break
    sleep "$CHO_DOC_LOG_GIAY"
  done
  echo "### Khởi tạo tổ chức — kết quả"
  echo ""
  echo "- Task \`$TASK_ARN\`: thoát 0"
  echo "- Bí mật \`$BI_MAT\`: đã xoá, không cửa sổ khôi phục"
  if [[ -n $dong ]]; then
    echo "- Dòng kết quả: \`$dong\`"
    [[ $CHE_DO == them-nguoi ]] ||
      echo "- Gửi \`/login#<mã tổ chức ở dòng trên>\` cho từng người; mỗi người tự xin link đăng nhập ở ô của trang \`/login\`."
  else
    echo "- Không đọc được dòng kết quả sau $SO_LAN_DOC_LOG lần — đọc log \`/tp/khoi-tao\`, luồng \`$luong\`."
  fi
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
  kiem-khoi-tao) shift; [[ $# -eq 0 ]] || loi "kiem-khoi-tao (đầu vào qua biến môi trường)"; kiem_dau_vao; bang_duyet ;;
  khoi-tao) shift; [[ $# -eq 1 ]] || loi "khoi-tao <arn>"; khoi_tao "$@" ;;
  *) loi "lệnh: day | dang-ky | migrate | neo | cap-nhat | kiem-khoi-tao | khoi-tao" ;;
esac

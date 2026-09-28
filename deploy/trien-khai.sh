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
#   trien-khai.sh kiem-khoi-tao                                ⇒ KHÔNG AWS: kiểm đầu vào và người bấm, in bảng người duyệt
#                                                                duyệt (markdown)
#   trien-khai.sh kiem-nguoi-duyet <tệp JSON>                  ⇒ KHÔNG AWS: lịch sử duyệt của run phải có một NGƯỜI khác người
#                                                                bấm duyệt `prod-khoi-tao`
#   trien-khai.sh khoi-tao <arn-task-def>                      ⇒ chạy task khởi tạo với đúng đầu vào ấy; thoát 0 ⇒ XOÁ bí mật
#                                                                bản khai, in kết quả suy từ đầu vào (markdown)
#
# Biến bắt buộc: AWS_REGION, TAI_KHOAN, CLUSTER ~~;~~ **[S1.9103]** (trừ `kiem-khoi-tao`); `migrate` cần thêm SUBNETS (phẩy
# ngăn cách) và SG_MIGRATE; `neo` cần SUBNETS và SG_NEO; `khoi-tao` cần SUBNETS và SG_KHOI_TAO. Đầu vào của khởi tạo đi qua
# biến môi trường — workflow chuyển `inputs` vào `env:`, không nội suy vào mã: CHE_DO, BI_MAT, PHIEN_BAN, ~~TO_CHUC,
# SO_NGUOI, SO_VAI~~ **[lượt soi]** BAM, MA_TO_CHUC (workflow chọn, chỉ `tao`), TO_CHUC, SO_NGUOI, VAI; cộng ACTOR,
# TRIGGERING_ACTOR (`github.actor`, `github.triggering_actor`).
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

# [S1.9103] `kiem-khoi-tao` (job `build`) và `kiem-nguoi-duyet` (trước khi job `chay` lấy quyền AWS) — không biến AWS.
if [[ ${1:-} != kiem-khoi-tao && ${1:-} != kiem-nguoi-duyet ]]; then
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
  # [S1.9103 / lượt soi] Họ `tp-khoi-tao` mang dữ liệu cá nhân và gán vai: bản mới nhất bị cài một biến (`NODE_OPTIONS`), một
  # secret, một lệnh hay một root filesystem ghi được thì pipeline KHÔNG nhân bản nó — ghim trọn container theo stack 90.
  [[ $ho != tp-khoi-tao ]] || jq -e --arg exec "arn:aws:iam::${TAI_KHOAN}:role/tp-ecs-execution" --arg region "$AWS_REGION" \
    --arg sm "^arn:aws:secretsmanager:${AWS_REGION}:${TAI_KHOAN}:secret:tp/khoi-tao/database-url-[A-Za-z0-9]{6}$" '
      .executionRoleArn == $exec and .networkMode == "awsvpc"
      and (.containerDefinitions[0] as $c
        | ([$c.environment[]? | [.name, .value]] | sort) == [["NODE_ENV", "production"], ["TRUSTPROCURE_KHOI_TAO_REGION", $region]]
        and ([$c.secrets[]? | .name] == ["DATABASE_URL"]) and ($c.secrets[0].valueFrom | test($sm))
        and $c.readonlyRootFilesystem == true and ($c.privileged // false) == false
        and ([$c.entryPoint, $c.command, $c.user, $c.workingDirectory, $c.linuxParameters, $c.repositoryCredentials]
             | all(. == null))
        and (($c.environmentFiles // []) | length) == 0 and (($c.mountPoints // []) | length) == 0
        and (($c.volumesFrom // []) | length) == 0 and ((.volumes // []) | length) == 0
        and $c.logConfiguration.options["awslogs-group"] == "/tp/khoi-tao")' \
    "$tam/cu.json" >/dev/null || loi "bản mới nhất của họ tp-khoi-tao lệch hình dạng stack 90 (biến, secret, lệnh, root fs, log) — không nhân bản"
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
# nên thứ họ duyệt là bảng `bang_duyet` in ở job `build`: tên, PHIÊN BẢN và BĂM SHA-256 của bí mật, mã tổ chức, số người, số
# người theo từng mã vai, và ai bấm. Công cụ (`tools/khoi-tao-to-chuc`) đọc ĐÚNG phiên bản ấy, so băm và ba kỳ vọng, và dừng
# TRƯỚC CSDL khi lệch. Luật của `kiem_dau_vao` là luật của `docThamSo` — `tests/deploy/khoi-tao-sh.test.ts` so hai phía trên
# cùng bộ đầu vào.
# ---------------------------------------------------------------------------------------------
TRAN_SO_NGUOI=50                                                               # TRAN_SO_NGUOI của ban-khai.ts
MA_VAI=(REQUESTER BUYER TECHNICAL PROCUREMENT_MANAGER FINANCE DIRECTOR)          # MA_VAI của ban-khai.ts, đúng thứ tự
UUID_V4='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
SLUG='[a-z0-9][a-z0-9-]{1,61}[a-z0-9]'

kiem_dau_vao() {
  local LC_ALL=C p ma n vi truoc=-1 tong=0 i
  local -a phan
  : "${CHE_DO?}" "${BI_MAT?}" "${PHIEN_BAN?}" "${BAM?}" "${MA_TO_CHUC?}" "${TO_CHUC?}" "${SO_NGUOI?}" "${VAI?}"
  [[ $CHE_DO == tao || $CHE_DO == them-nguoi ]] || loi "che_do phải là tao hoặc them-nguoi"
  # Tên dạng slug: nó vào CloudTrail và vào run CÔNG KHAI — một tên mang `@` hay `.` (một email) là dữ liệu cá nhân lộ ra.
  [[ $BI_MAT =~ ^tp/khoi-tao/ban-khai/${SLUG}$ ]] || loi "bi_mat phải là tp/khoi-tao/ban-khai/<slug> (a-z, 0-9, gạch nối ở giữa)"
  [[ $PHIEN_BAN =~ ^[A-Za-z0-9][A-Za-z0-9-]{31,63}$ ]] ||
    loi "phien_ban phải là một VersionId (32–64 ký tự: chữ, số, gạch nối; mở đầu bằng chữ hay số)"
  [[ $BAM =~ ^[0-9a-f]{64}$ ]] || loi "bam phải là SHA-256 của bản khai: 64 ký tự hex chữ thường"
  if [[ $CHE_DO == tao ]]; then
    [[ $TO_CHUC =~ ^${SLUG}$ ]] || loi "to_chuc của tao là slug của tổ chức mới"
    [[ $MA_TO_CHUC =~ $UUID_V4 ]] || loi "ma_to_chuc (workflow chọn) phải là UUIDv4 chữ thường"
  else
    [[ $TO_CHUC =~ $UUID_V4 ]] || loi "to_chuc của them-nguoi là mã (UUIDv4 chữ thường) của tổ chức đã có"
    [[ -z $MA_TO_CHUC ]] || loi "ma_to_chuc chỉ có ở tao — thêm người thì mã ở to_chuc"
  fi
  [[ $SO_NGUOI =~ ^[1-9][0-9]{0,2}$ ]] && ((SO_NGUOI <= TRAN_SO_NGUOI)) ||
    loi "so_nguoi phải là số nguyên từ 1 tới $TRAN_SO_NGUOI"
  # vai: MA=n nối bằng dấu phẩy, mã theo thứ tự MA_VAI, mỗi mã một lần, 1 ≤ n ≤ so_nguoi, tổng ≥ so_nguoi.
  # Hình dạng của TRỌN chuỗi trước (`read` chỉ đọc tới dấu xuống dòng đầu), rồi từng phần.
  [[ $VAI =~ ^[A-Z_]+=[0-9]+(,[A-Z_]+=[0-9]+)*$ ]] || loi "vai phải là MA=n,MA=n…"
  IFS=, read -r -a phan <<<"$VAI"
  for p in "${phan[@]}"; do
    [[ $p =~ ^([A-Z_]+)=([1-9][0-9]{0,2})$ ]] || loi "vai: \"$p\" không phải MA=n"
    ma=${BASH_REMATCH[1]} n=${BASH_REMATCH[2]} vi=-1
    for i in "${!MA_VAI[@]}"; do [[ ${MA_VAI[$i]} != "$ma" ]] || vi=$i; done
    ((vi > truoc)) || loi "vai: mã lạ, hay sai thứ tự ${MA_VAI[*]}, hay một mã hai lần"
    ((n <= SO_NGUOI)) || loi "vai: số người của một mã vai không vượt so_nguoi"
    truoc=$vi tong=$((tong + n))
  done
  ((tong >= SO_NGUOI)) || loi "vai: tổng phải ít nhất bằng so_nguoi — ai cũng có ít nhất một vai"
}

# [S1.9103 / lượt soi] Người bấm phải là NGƯỜI: một run do token bot (GITHUB_TOKEN của một workflow khác, hay một GitHub App)
# khởi thì *Prevent self-review* so với bot, và chính người đứng sau nó duyệt được.
kiem_nguoi_bam() {
  : "${ACTOR:?}" "${TRIGGERING_ACTOR:?}"
  [[ $ACTOR != *"[bot]" && $TRIGGERING_ACTOR != *"[bot]" ]] || loi "người bấm là bot ($ACTOR / $TRIGGERING_ACTOR) — khởi tạo chỉ nhận người"
}

bang_duyet() {
  local mo_ta="mã tổ chức ĐÃ CÓ" ma=$TO_CHUC
  [[ $CHE_DO == them-nguoi ]] || mo_ta="slug của tổ chức MỚI" ma=$MA_TO_CHUC
  cat <<EOF
### Khởi tạo tổ chức — điều người duyệt duyệt

| | |
|---|---|
| Người bấm | @$TRIGGERING_ACTOR |
| Chế độ | \`$CHE_DO\` |
| Bí mật bản khai | \`$BI_MAT\` |
| Phiên bản (VersionId) | \`$PHIEN_BAN\` |
| SHA-256 của bản khai | \`$BAM\` |
| Tổ chức ($mo_ta) | \`$TO_CHUC\` |
| Mã tổ chức | \`$ma\` |
| Số người | $SO_NGUOI |
| Số người theo vai | \`$VAI\` |

Task đọc ĐÚNG phiên bản trên, so băm, và dừng TRƯỚC khi chạm CSDL nếu bản khai lệch tổ chức, số người hay số theo vai.
Người có tệp bản khai đối chiếu được băm: \`(Get-FileHash ban-khai.json -Algorithm SHA256).Hash.ToLower()\`. Người duyệt phải
khác người bấm; chạy xong (thoát 0) thì bí mật bị xoá, không cửa sổ khôi phục.
EOF
}

# [S1.9103 / lượt soi] Kiểm KẾT QUẢ của *Prevent self-review* chứ không tin cài đặt: phải có một lần DUYỆT environment
# `prod-khoi-tao` của một NGƯỜI khác người bấm. Admin bỏ qua luật duyệt thì không có bản ghi ấy — job dừng.
kiem_nguoi_duyet() {
  local tep=$1 ai
  kiem_nguoi_bam
  ai=$(jq -r --arg a "${ACTOR,,}" --arg t "${TRIGGERING_ACTOR,,}" '
      [.[] | select(.state == "approved" and any(.environments[]?; .name == "prod-khoi-tao")
                    and .user.type == "User" and (.user.login | ascii_downcase) != $a and (.user.login | ascii_downcase) != $t)
           | .user.login] | unique | join(", ")' "$tep") || loi "không đọc được lịch sử duyệt của run"
  [[ -n $ai ]] || loi "không có lần duyệt prod-khoi-tao nào của một người khác người bấm — không chạy"
  echo "- Người duyệt: $(sed 's/[^, ]\+/@&/g' <<<"$ai")"
}

khoi_tao() {
  local arn=$1 lenh ma
  kiem_dau_vao
  kiem_nguoi_bam
  : "${SG_KHOI_TAO:?}"
  lenh=$(jq -cn --arg c "$CHE_DO" --arg b "$BI_MAT" --arg p "$PHIEN_BAN" --arg h "$BAM" --arg m "$MA_TO_CHUC" \
    --arg t "$TO_CHUC" --arg n "$SO_NGUOI" --arg v "$VAI" '
    {containerOverrides: [{name: "tp-khoi-tao",
      command: ([$c, "--ban-khai-secret", $b, "--phien-ban", $p, "--bam", $h]
                + (if $m == "" then [] else ["--ma-to-chuc", $m] end)
                + ["--to-chuc", $t, "--so-nguoi", $n, "--vai", $v])}]}')
  KHI_HONG="Bí mật $BI_MAT CÒN (chưa xoá — nó mang email và họ tên). Chạy lại là an toàn: nếu giao dịch lỡ đã commit (mất ACK lúc COMMIT), lần chạy lại dừng ở 'slug đã có' / 'email đã có'. Sửa bản khai thì put-secret-value (VersionId và băm MỚI, một lần duyệt mới); bỏ thì xoá tay: aws secretsmanager delete-secret --secret-id $BI_MAT --force-delete-without-recovery"
  chay_mot_lan "$arn" "$SG_KHOI_TAO" khoi-tao "$lenh"
  # Thoát 0 ⇒ giao dịch đã COMMIT. Xoá NGAY, trước mọi bước khác, không cửa sổ khôi phục (chủ dự án chọn).
  KHI_HONG="Task đã thoát 0 (giao dịch đã commit) nhưng XOÁ bí mật hỏng — xoá tay: aws secretsmanager delete-secret --secret-id $BI_MAT --force-delete-without-recovery"
  aws secretsmanager delete-secret --secret-id "$BI_MAT" --force-delete-without-recovery --query Name --output text >/dev/null ||
    loi "xoá bí mật $BI_MAT hỏng"
  KHI_HONG=""
  echo "khoi-tao: đã xoá bí mật $BI_MAT" >&2
  # Kết quả suy từ ĐẦU VÀO đã duyệt, không đọc log: thoát 0 nghĩa là công cụ đã ghi đúng bản khai khớp băm và kỳ vọng ấy.
  ma=$TO_CHUC
  [[ $CHE_DO == them-nguoi ]] || ma=$MA_TO_CHUC
  echo "### Khởi tạo tổ chức — kết quả"
  echo ""
  echo "- Task \`$TASK_ARN\`: thoát 0 — $CHE_DO, tổ chức \`$ma\`, $SO_NGUOI người, vai \`$VAI\`"
  echo "- Bí mật \`$BI_MAT\` (phiên bản \`$PHIEN_BAN\`): đã xoá, không cửa sổ khôi phục"
  [[ $CHE_DO == them-nguoi ]] ||
    echo "- Gửi \`/login#$ma\` cho từng người; mỗi người tự xin link đăng nhập ở ô của trang \`/login\`."
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
  kiem-khoi-tao) shift; [[ $# -eq 0 ]] || loi "kiem-khoi-tao (đầu vào qua biến môi trường)"; kiem_dau_vao; kiem_nguoi_bam; bang_duyet ;;
  kiem-nguoi-duyet) shift; [[ $# -eq 1 ]] || loi "kiem-nguoi-duyet <tệp JSON lịch sử duyệt>"; kiem_nguoi_duyet "$@" ;;
  khoi-tao) shift; [[ $# -eq 1 ]] || loi "khoi-tao <arn>"; khoi_tao "$@" ;;
  *) loi "lệnh: day | dang-ky | migrate | neo | cap-nhat | kiem-khoi-tao | kiem-nguoi-duyet | khoi-tao" ;;
esac

#!/usr/bin/env bash
# ==============================================================================================
# deploy/kiem-sau-deploy.sh — KIỂM SAU DEPLOY (`.github/workflows/deploy.yml`, ADR-078)
#
#   kiem-sau-deploy.sh cong-khai   ⇒ gọi HTTPS công khai của `ten_mien`, KHÔNG cần quyền AWS
#   kiem-sau-deploy.sh worker      ⇒ service tp-unseal-worker đủ task, log không có lỗi khởi động
#
# `cong-khai` cần TEN_MIEN, RECEIPT_KID, RECEIPT_FINGERPRINT. Nó kiểm:
#   ⑴ `/api/health`, `/nop-thau`, `/.well-known/trustprocure-receipt-keys` trả 200 (thử lại tới ~2 phút — ALB có thể
#      vẫn đang rút target cũ);
#   ⑵ mọi phản hồi mang HSTS `max-age=31536000; includeSubDomains`, `x-frame-options: DENY`, `x-content-type-options:
#      nosniff`, KHÔNG có header `server` (ADR-075); `/nop-thau` có `content-security-policy`; `http://` ⇒ 301 sang https;
#   ⑶ tài liệu khoá: `activeKeyId` = RECEIPT_KID, mục của kid ấy có `fingerprint` = RECEIPT_FINGERPRINT (con số in vào
#      hợp đồng — README, stack 50), và `fingerprint` = SHA-256 của chính `spki` trong tài liệu.
# `worker` cần AWS_REGION, CLUSTER, BAT_DAU_MS (mốc ms lúc bắt đầu deploy): chờ 2 phút, rồi runningCount = desiredCount
#   và `/tp/unseal-worker` không có dòng `khong khoi dong duoc` / `cau hinh khong hop le` kể từ BAT_DAU_MS.
#
# Kiểm hỏng ⇒ thoát 1 và in ĐÚNG kiểm nào hỏng. KHÔNG tự rollback: migrate đã chạy, image cũ trên lược đồ mới là một
# rủi ro mà người vận hành phải cân (ADR-078).
# ==============================================================================================
set -euo pipefail

SO_LAN=12 # × 10 giây
loi_dem=0
hong() { echo "HONG: $*" >&2; loi_dem=$((loi_dem + 1)); }
dat() { echo "dat: $*" >&2; }

# lay <url> <tệp-header> <tệp-thân> — thử lại tới khi 200; in mã cuối cùng.
lay() {
  local url=$1 h=$2 b=$3 ma lan
  for ((lan = 1; lan <= SO_LAN; lan++)); do
    ma=$(curl -sS -o "$b" -D "$h" -w '%{http_code}' --max-time 10 "$url" || echo 000)
    [[ $ma == 200 ]] && break
    sleep 10
  done
  echo "$ma"
}

# gia_tri <tệp-header> <tên> — giá trị header (không phân biệt hoa thường, bỏ CR).
gia_tri() { tr -d '\r' <"$1" | awk -v t="$2" 'tolower($0) ~ "^" t ":" { sub(/^[^:]*:[ \t]*/, ""); print; exit }'; }

cong_khai() {
  : "${TEN_MIEN:?}" "${RECEIPT_KID:?}" "${RECEIPT_FINGERPRINT:?}"
  [[ $TEN_MIEN =~ ^([a-z0-9-]+\.)+[a-z]{2,63}$ ]] || { echo "LOI: TEN_MIEN không đúng dạng" >&2; exit 1; }
  local tam duong ma h b goc="https://$TEN_MIEN" i=0
  tam=$(mktemp -d)
  for duong in /api/health /nop-thau /.well-known/trustprocure-receipt-keys; do
    i=$((i + 1))
    h="$tam/h$i" b="$tam/b$i"
    ma=$(lay "$goc$duong" "$h" "$b")
    if [[ $ma != 200 ]]; then hong "$duong trả $ma"; continue; fi
    dat "$duong 200"
    [[ $(gia_tri "$h" strict-transport-security) == "max-age=31536000; includeSubDomains" ]] ||
      hong "$duong: strict-transport-security sai hoặc thiếu"
    [[ $(gia_tri "$h" x-frame-options) == "DENY" ]] || hong "$duong: x-frame-options sai hoặc thiếu"
    [[ $(gia_tri "$h" x-content-type-options) == "nosniff" ]] || hong "$duong: x-content-type-options sai hoặc thiếu"
    [[ -z $(gia_tri "$h" server) ]] || hong "$duong: còn header server"
    if [[ $duong == /nop-thau ]]; then
      [[ -n $(gia_tri "$h" content-security-policy) ]] || hong "/nop-thau: thiếu content-security-policy"
    fi
  done

  ma=$(curl -sS -o /dev/null -D "$tam/h80" -w '%{http_code}' --max-time 10 "http://$TEN_MIEN/nop-thau" || echo 000)
  [[ $ma == 301 && $(gia_tri "$tam/h80" location) == "https://$TEN_MIEN:443/nop-thau" ||
    $ma == 301 && $(gia_tri "$tam/h80" location) == "https://$TEN_MIEN/nop-thau" ]] ||
    hong "http:// trả $ma, location $(gia_tri "$tam/h80" location) — phải 301 sang https"

  b="$tam/b3" # thân của đường thứ ba — tài liệu khoá
  if [[ -s $b ]]; then
    local kid van_tay spki tinh
    kid=$(jq -r '.activeKeyId // empty' "$b")
    [[ $kid == "$RECEIPT_KID" ]] || hong "activeKeyId = '$kid', mong '$RECEIPT_KID'"
    van_tay=$(jq -r --arg k "$RECEIPT_KID" '.keys[] | select(.kid == $k) | .fingerprint' "$b")
    spki=$(jq -r --arg k "$RECEIPT_KID" '.keys[] | select(.kid == $k) | .spki' "$b")
    [[ $van_tay == "$RECEIPT_FINGERPRINT" ]] || hong "dấu vân tay kid $RECEIPT_KID = '$van_tay', mong '$RECEIPT_FINGERPRINT'"
    tinh=$(printf '%s' "$spki" | base64 -d | sha256sum | cut -d' ' -f1)
    [[ $tinh == "$van_tay" ]] || hong "fingerprint trong tài liệu không phải SHA-256 của spki trong chính nó"
    [[ $loi_dem -gt 0 ]] || dat "khoá biên nhận $RECEIPT_KID đúng dấu vân tay"
  fi
  rm -rf "$tam"
}

worker() {
  : "${AWS_REGION:?}" "${CLUSTER:?}" "${BAT_DAU_MS:?}"
  [[ $BAT_DAU_MS =~ ^[0-9]{13}$ ]] || { echo "LOI: BAT_DAU_MS phải là mốc ms" >&2; exit 1; }
  sleep "${CHO_WORKER_GIAY:-120}"
  local ra chay muon so_dong
  ra=$(aws ecs describe-services --cluster "$CLUSTER" --services tp-unseal-worker \
    --query 'services[0].{chay: runningCount, muon: desiredCount}' --output json)
  chay=$(jq -r .chay <<<"$ra")
  muon=$(jq -r .muon <<<"$ra")
  [[ $chay == "$muon" ]] || hong "tp-unseal-worker chạy $chay/$muon task"
  so_dong=$(aws logs filter-log-events --log-group-name /tp/unseal-worker --start-time "$BAT_DAU_MS" \
    --filter-pattern '?"khong khoi dong duoc" ?"cau hinh khong hop le"' \
    --query 'length(events)' --output text)
  [[ $so_dong == 0 ]] || hong "/tp/unseal-worker có $so_dong dòng lỗi khởi động kể từ lúc deploy"
  [[ $loi_dem -gt 0 ]] || dat "tp-unseal-worker $chay/$muon task, không lỗi khởi động"
}

case "${1:-}" in
  cong-khai) cong_khai ;;
  worker) worker ;;
  *) echo "LOI: lệnh: cong-khai | worker" >&2; exit 1 ;;
esac

if [[ $loi_dem -gt 0 ]]; then
  echo "LOI: $loi_dem kiểm hỏng — KHÔNG tự rollback; xem ADR-078" >&2
  exit 1
fi

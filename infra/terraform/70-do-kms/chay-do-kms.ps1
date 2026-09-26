# Phép đo ⒜ của ADR-062 — chạy SAU `terraform apply` của stack 70, trong chính thư mục này.
#
#   aws sso login --sso-session tp
#   .\chay-do-kms.ps1
#
# Chạy task api (bước 1, 2, 2b; và 6–6e trên tp-totp), lấy blob và org_id từ log, chạy task worker
# với hai blob ấy (bước 3, 4, 4a, 4b; và 7), rồi tự chạy bước 5 và 8 bằng hai profile người
# (AdministratorAccess, KeyAdmin). In một
# bảng; thoát mã 0 CHỈ KHI mọi bước ĐẠT. Chép nguyên bảng vào STATE.md khoản 15 làm bằng chứng.
#
# Không bước nào in bản rõ: mọi Decrypt chạy với `--query KeyId`.

param(
  [string]$ProfileAdmin = "tp-prod",
  [string]$ProfileKeyAdmin = "tp-prod-keyadmin"
)

$ErrorActionPreference = "Stop"
$ra = terraform output -json | ConvertFrom-Json
$cluster = $ra.cluster.value
$mang = "awsvpcConfiguration={subnets=[$($ra.subnet.value)],securityGroups=[$($ra.security_group.value)],assignPublicIp=ENABLED}"
$logGroup = $ra.log_group.value
$khoa = $ra.khoa.value
$khoaTotp = $ra.khoa_totp.value

function Chay-Task([string]$vai, [string]$overridesFile) {
  $thamSo = @(
    "ecs", "run-task", "--profile", $ProfileAdmin, "--cluster", $cluster, "--launch-type", "FARGATE",
    "--task-definition", $ra.task_definition.value.$vai, "--network-configuration", $mang,
    "--query", "tasks[0].taskArn", "--output", "text"
  )
  if ($overridesFile) { $thamSo += @("--overrides", "file://$overridesFile") }
  $arn = aws @thamSo
  if (-not $arn -or $arn -eq "None") { throw "run-task $vai khong tra task nao" }
  Write-Host "Task $vai`: $arn — cho dung..."
  aws ecs wait tasks-stopped --profile $ProfileAdmin --cluster $cluster --tasks $arn
  $id = $arn.Split("/")[-1]
  $dong = aws logs get-log-events --profile $ProfileAdmin --log-group-name $logGroup `
    --log-stream-name "$vai/do-kms/$id" --start-from-head --query "events[].message" --output json |
    ConvertFrom-Json
  if (-not $dong) {
    $lyDo = aws ecs describe-tasks --profile $ProfileAdmin --cluster $cluster --tasks $arn `
      --query "tasks[0].[stoppedReason,containers[0].reason]" --output text
    throw "Task $vai khong co log. Ly do dung: $lyDo"
  }
  return $dong
}

$ketQua = [ordered]@{}
function Ghi([string[]]$dong) {
  foreach ($d in $dong) {
    if ($d -match "^KQ (\S+) (DAT|HONG) ?(.*)$") { $ketQua[$Matches[1]] = "$($Matches[2]) $($Matches[3])".Trim() }
  }
}

# --- task api -------------------------------------------------------------------------------
$dongApi = Chay-Task "api" $null
Ghi $dongApi
$org = ($dongApi | Where-Object { $_ -like "ORG *" } | Select-Object -First 1) -replace "^ORG ", ""
$blob = ($dongApi | Where-Object { $_ -like "BLOB *" } | Select-Object -First 1) -replace "^BLOB ", ""
$blobTotp = ($dongApi | Where-Object { $_ -like "TOTP_BLOB *" } | Select-Object -First 1) -replace "^TOTP_BLOB ", ""

if ($org -and $blob) {
  # --- task worker ----------------------------------------------------------------------------
  $tep = New-TemporaryFile
  @{ containerOverrides = @(@{ name = "do-kms"; environment = @(
          @{ name = "ORG"; value = $org }, @{ name = "BLOB"; value = $blob },
          @{ name = "TOTP_BLOB"; value = $blobTotp }) }) } |
    ConvertTo-Json -Depth 6 | Set-Content -Encoding ascii $tep
  try { Ghi (Chay-Task "worker" $tep.FullName) } finally { Remove-Item $tep }

  # --- bước 5: hai vai người -------------------------------------------------------------------
  $tepBlob = New-TemporaryFile
  [IO.File]::WriteAllBytes($tepBlob.FullName, [Convert]::FromBase64String($blob))
  $tepTotp = New-TemporaryFile
  if ($blobTotp) { [IO.File]::WriteAllBytes($tepTotp.FullName, [Convert]::FromBase64String($blobTotp)) }
  # Windows PowerShell 5.1: với "Stop", stderr của lệnh native qua 2>&1 thành lỗi dừng script —
  # mà ở đây stderr (AccessDeniedException) CHÍNH LÀ kết quả mong đợi.
  $ErrorActionPreference = "Continue"
  try {
    foreach ($p in @(@{ buoc = "5a"; profile = $ProfileAdmin }, @{ buoc = "5b"; profile = $ProfileKeyAdmin })) {
      $out = aws kms decrypt --profile $p.profile --key-id $khoa --ciphertext-blob "fileb://$($tepBlob.FullName)" `
        --encryption-context "org_id=$org" --query KeyId --output text 2>&1 | Out-String
      if ($LASTEXITCODE -eq 0) { $ketQua[$p.buoc] = "HONG thanh-cong-ngoai-mong-doi ($($p.profile))" }
      elseif ($out -match "AccessDeniedException") { $ketQua[$p.buoc] = "DAT AccessDeniedException ($($p.profile))" }
      else { $ketQua[$p.buoc] = "HONG $($out.Trim()) ($($p.profile))" }
    }
    # [ADR-063] bước 8: hai vai người cũng KHÔNG mở được bí mật TOTP.
    foreach ($p in @(@{ buoc = "8a"; profile = $ProfileAdmin }, @{ buoc = "8b"; profile = $ProfileKeyAdmin })) {
      if (-not $blobTotp) { $ketQua[$p.buoc] = "HONG thieu-blob-TOTP-tu-buoc-6"; continue }
      $out = aws kms decrypt --profile $p.profile --key-id $khoaTotp --ciphertext-blob "fileb://$($tepTotp.FullName)" `
        --encryption-context "org_id=$org,key_version=do-kms" --query KeyId --output text 2>&1 | Out-String
      if ($LASTEXITCODE -eq 0) { $ketQua[$p.buoc] = "HONG thanh-cong-ngoai-mong-doi ($($p.profile))" }
      elseif ($out -match "AccessDeniedException") { $ketQua[$p.buoc] = "DAT AccessDeniedException ($($p.profile))" }
      else { $ketQua[$p.buoc] = "HONG $($out.Trim()) ($($p.profile))" }
    }
  } finally { Remove-Item $tepBlob; Remove-Item $tepTotp }
} else {
  Write-Host "Buoc 1 khong ra blob — dung truoc task worker." -ForegroundColor Red
}

# --- chấm ---------------------------------------------------------------------------------------
$mongDoi = @(
  @("1", "tp-api GenerateDataKeyPairWithoutPlaintext => thanh cong"),
  @("2", "tp-api Decrypt => AccessDenied"),
  @("2b", "tp-api GenerateDataKeyPair (co ban ro) => AccessDenied"),
  @("3", "tp-unseal-worker Decrypt dung context => thanh cong"),
  @("4", "tp-unseal-worker Decrypt thieu context => AccessDenied"),
  @("4a", "tp-unseal-worker Decrypt org_id khac => InvalidCiphertext"),
  @("4b", "tp-unseal-worker GenerateDataKeyPairWithoutPlaintext => AccessDenied"),
  @("5a", "AdministratorAccess Decrypt => AccessDenied"),
  @("5b", "KeyAdmin Decrypt => AccessDenied"),
  @("6", "tp-api Encrypt tp-totp => thanh cong"),
  @("6a", "tp-api Decrypt tp-totp dung context => thanh cong"),
  @("6b", "tp-api Decrypt tp-totp thieu key_version => AccessDenied"),
  @("6c", "tp-api Decrypt tp-totp org_id khac => InvalidCiphertext"),
  @("6d", "tp-api Encrypt tp-totp context la => AccessDenied"),
  @("6e", "tp-api GenerateDataKey tp-totp => AccessDenied"),
  @("7", "tp-unseal-worker Decrypt tp-totp => AccessDenied"),
  @("8a", "AdministratorAccess Decrypt tp-totp => AccessDenied"),
  @("8b", "KeyAdmin Decrypt tp-totp => AccessDenied")
)
$datHet = $true
Write-Host "`nPhep do (a) ADR-062 — $(Get-Date -Format o) — org_id thu: $org"
foreach ($m in $mongDoi) {
  $kq = $ketQua[$m[0]]
  if (-not $kq) { $kq = "HONG khong chay" }
  if (-not $kq.StartsWith("DAT")) { $datHet = $false }
  $mau = if ($kq.StartsWith("DAT")) { "Green" } else { "Red" }
  Write-Host ("{0,-3} {1,-62} {2}" -f $m[0], $m[1], $kq) -ForegroundColor $mau
}
if ($datHet) { Write-Host "`nDAT CA $($mongDoi.Count) BUOC." -ForegroundColor Green; exit 0 }
Write-Host "`nCO BUOC HONG — khong duoc coi khoa la da cau hinh dung." -ForegroundColor Red
exit 1

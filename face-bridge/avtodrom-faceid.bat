@echo off
rem ==========================================================================
rem  AVTODROM 12 - FACE ID KOPRIGI
rem  Avtodromdagi Hikvision Face ID qurilmasidan "bugun kim o'tdi" royxatini
rem  har 15 soniyada FAQAT OQIYDI va Avtodrom 12 ga yuboradi.
rem  Qurilma sozlamalariga TEGMAYDI - e-avtota'lim avvalgidek ishlayveradi.
rem
rem  Ishga tushirish: shu faylga ikki marta bosing. Oynani yopmang.
rem  Kompyuter qayta yonganda o'zi ishga tushadi (Startup papkasiga qo'yiladi).
rem ==========================================================================
setlocal
title Avtodrom 12 - Face ID
set "FACE_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:FACE_SELF,[Text.Encoding]::UTF8); $m='#'+'#PS#'+'#'; $i=$s.LastIndexOf($m); Invoke-Expression $s.Substring($i+$m.Length)"
echo.
echo Dastur to'xtadi. Qayta ishga tushirish uchun faylga yana ikki marta bosing.
pause
exit /b
##PS##
# ---------------------------------------------------------------- SOZLAMALAR
# Bu qiymatlarni Avtodrom 12 -> Face ID sahifasi o'zi to'ldiradi.
$Server = '__SERVER__'          # Avtodrom 12 manzili
$Key    = '__KEY__'             # ko'prik kaliti (Face ID sahifasidan)
$Ip     = '__IP__'              # Face ID qurilmasining IP manzili
$Login  = '__LOGIN__'           # qurilma logini (odatda admin)
$Parol  = '__PAROL__'           # qurilma paroli
$Every  = 15                    # necha soniyada bir marta o'qiladi

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Say($t) { Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $t) }
function DayStart { (Get-Date).Date.ToString("yyyy-MM-dd'T'HH:mm:sszzz") }
function Now { (Get-Date).ToString("yyyy-MM-dd'T'HH:mm:sszzz") }

# ---- Kompyuter yonganda o'zi ishga tushsin (bir marta)
try {
  $self = $env:FACE_SELF
  if ($self) {
    $startup = [Environment]::GetFolderPath('Startup')
    $dst = Join-Path $startup 'avtodrom-faceid.bat'
    if ($startup -and ($self -ne $dst)) {
      Copy-Item -LiteralPath $self -Destination $dst -Force
      Say "Kompyuter yonganda o'zi ishga tushadi (Startup papkasiga qo'yildi)."
    }
  }
} catch { Say "Startup papkasiga qo'yib bo'lmadi - har safar qo'lda ishga tushiring." }

# ---- Qurilmaga ulanish (Digest login) - FAQAT O'QISH
$base = "http://$Ip"
$cc = New-Object System.Net.CredentialCache
$cc.Add([Uri]($base + '/'), 'Digest', (New-Object System.Net.NetworkCredential($Login, $Parol)))

function DevicePost($path, $obj) {
  $wc = New-Object System.Net.WebClient
  $wc.Credentials = $cc
  $wc.Encoding = [Text.Encoding]::UTF8
  $wc.Headers['Content-Type'] = 'application/json'
  $txt = $wc.UploadString($base + $path, 'POST', ($obj | ConvertTo-Json -Depth 6 -Compress))
  return ($txt | ConvertFrom-Json)
}

# Hikvision: major 5 / minor 75 = "yuz orqali tasdiqlandi". Qurilma buni
# qabul qilmasa - barcha hodisalar olinib, shaxs raqami borlari saralanadi.
$mode = 'face'
function ReadEvents($from, $to) {
  $all = @(); $pos = 0; $sid = [guid]::NewGuid().ToString('N').Substring(0, 12)
  for ($page = 0; $page -lt 60; $page++) {
    $cond = @{ searchID = $sid; searchResultPosition = $pos; maxResults = 30; startTime = $from; endTime = $to }
    if ($script:mode -eq 'face') { $cond.major = 5; $cond.minor = 75 } else { $cond.major = 0; $cond.minor = 0 }
    try { $r = DevicePost '/ISAPI/AccessControl/AcsEvent?format=json' @{ AcsEventCond = $cond } }
    catch {
      $code = $null; try { $code = [int]$_.Exception.InnerException.Response.StatusCode } catch {}
      if (-not $code) { try { $code = [int]$_.Exception.Response.StatusCode } catch {} }
      if ($script:mode -eq 'face' -and $code -eq 400) { $script:mode = 'all'; Say "Qurilma boshqacha so'rovni kutyapti - barcha hodisalar o'qiladi."; return (ReadEvents $from $to) }
      throw
    }
    $a = $r.AcsEvent
    if (-not $a) { break }
    $list = @($a.InfoList)
    foreach ($x in $list) {
      if ($null -eq $x) { continue }
      $ref = "$($x.employeeNoString)"
      if (-not $ref -and $x.employeeNo) { $ref = "$($x.employeeNo)" }
      if ($script:mode -eq 'all' -and -not $ref) { continue }
      if (-not $ref -and -not $x.name) { continue }
      $all += @{ person_id = $ref; name = "$($x.name)"; time = "$($x.time)"; device = $Ip }
    }
    $n = [int]$a.numOfMatches
    if ($a.responseStatusStrg -ne 'MORE' -or $n -le 0) { break }
    $pos += $n
  }
  return ,$all
}

function Send($events) {
  $body = @{ events = @($events); bridge = "Hikvision $Ip ($mode)" } | ConvertTo-Json -Depth 5 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  Invoke-RestMethod -Uri ($Server + '/api/face/events') -Method Post -Headers @{ 'X-Face-Key' = $Key } `
    -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 20 | Out-Null
}

Say "Avtodrom 12 - Face ID ko'prigi ishga tushdi."
Say "Qurilma: $Ip   Server: $Server"
Say "Bu oynani yopmang. Qurilmadan faqat o'qiladi, hech narsa o'zgartirilmaydi."
Write-Host ''

$since = DayStart
$day = (Get-Date).Date
$sent = @{}
$lastErr = ''
while ($true) {
  try {
    if ((Get-Date).Date -ne $day) { $day = (Get-Date).Date; $since = DayStart; $sent = @{} }
    try { $events = ReadEvents $since (Now) }
    catch {
      $m = "$($_.Exception.Message)"
      if ($m -match '401') { throw "Qurilma: login yoki parol noto'g'ri (401)." }
      throw "Qurilmaga ulanib bo'lmadi ($Ip): $m"
    }
    $new = @($events | Where-Object { -not $sent.ContainsKey($_.person_id + '|' + $_.time) })
    try { Send $new }
    catch {
      $m = "$($_.Exception.Message)"
      if ($m -match '401') { throw "Avtodrom 12 kaliti noto'g'ri - Face ID sahifasidan dasturni qayta yuklab oling." }
      throw "Avtodrom 12 serveriga yuborib bo'lmadi: $m"
    }
    foreach ($e in $new) { $sent[$e.person_id + '|' + $e.time] = 1 }
    if ($new.Count -gt 0) {
      $names = @($new | ForEach-Object { $_.name } | Select-Object -Last 5) -join ', '
      if ($new.Count -gt 5) { $names = $names + (" va yana {0} ta" -f ($new.Count - 5)) }
      Say ("{0} ta yangi o'tish yuborildi: {1}" -f $new.Count, $names)
      $last = ($new | ForEach-Object { [DateTimeOffset]::Parse($_.time) } | Sort-Object | Select-Object -Last 1)
      # 2 daqiqa orqadan qayta o'qiymiz - kechikib yozilgan hodisa tushib qolmasin
      $since = $last.AddMinutes(-2).ToString("yyyy-MM-dd'T'HH:mm:sszzz")
      if ([DateTimeOffset]::Parse($since) -lt [DateTimeOffset]::Parse((DayStart))) { $since = DayStart }
    }
    if ($lastErr) { Say 'Aloqa tiklandi.'; $lastErr = '' }
  } catch {
    $msg = "$($_.Exception.Message)"
    if ($msg -ne $lastErr) { Say ('XATO: ' + $msg); $lastErr = $msg }
  }
  Start-Sleep -Seconds $Every
}

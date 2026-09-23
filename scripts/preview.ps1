# Send a message to yourself exactly as the bot would send it.
#
# Rendering is the one thing the tests cannot check: whether a chart's columns
# line up depends on Telegram's font, not on our code. This sends the real
# thing through the real API so it can be looked at before deploying.
#
#   .\scripts\preview.ps1 -File .\preview.txt
#
# Reads TELEGRAM_BOT_TOKEN and ALERT_CHAT_ID from .dev.vars, which is gitignored.

param(
    [Parameter(Mandatory = $true)]
    [string]$File
)

$ErrorActionPreference = "Stop"

$varsPath = Join-Path $PSScriptRoot "..\.dev.vars"
if (-not (Test-Path $varsPath)) {
    throw ".dev.vars not found. Copy .dev.vars.example and fill in your real values."
}

# Parse KEY=VALUE, skipping comments and blanks.
$vars = @{}
foreach ($line in [IO.File]::ReadAllLines($varsPath, [Text.Encoding]::UTF8)) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $key, $value = $line -split '=', 2
    $vars[$key.Trim()] = $value.Trim()
}

foreach ($required in @("TELEGRAM_BOT_TOKEN", "ALERT_CHAT_ID")) {
    if (-not $vars[$required]) { throw "$required is missing from .dev.vars" }
}

# ReadAllText, not Get-Content: Get-Content decorates the string with PSPath and
# friends, which ConvertTo-Json then serialises into the body. The explicit UTF8
# matters too - PowerShell 5.1 reads BOM-less files as ANSI and mangles emoji.
$text = [IO.File]::ReadAllText($File, [Text.Encoding]::UTF8)

$body = @{
    chat_id    = $vars["ALERT_CHAT_ID"]
    text       = $text
    parse_mode = "HTML"
} | ConvertTo-Json

$response = Invoke-RestMethod -Method Post `
    -Uri "https://api.telegram.org/bot$($vars['TELEGRAM_BOT_TOKEN'])/sendMessage" `
    -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($body))

if ($response.ok) { Write-Output "sent - check Telegram" } else { Write-Output $response }

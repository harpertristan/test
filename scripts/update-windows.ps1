param([string]$Target = (Get-Location).Path, [switch]$Start)
$ErrorActionPreference = 'Stop'
$updateTemp = $null
try {
  $Target = (Resolve-Path -LiteralPath $Target).Path
  if (-not (Test-Path -LiteralPath (Join-Path $Target 'package.json'))) { throw 'Open the PlayScout folder containing package.json first.' }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $nodeVersion = & $node --version
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Install Node.js 22 or newer from nodejs.org.' }
  $manifest = Get-Content -LiteralPath (Join-Path $Target 'package.json') -Raw | ConvertFrom-Json
  if ($manifest.name -ne 'play-finance-finder') { throw 'The target is not a Play Scout folder.' }
  $updateTemp = Join-Path ([System.IO.Path]::GetTempPath()) ('play-scout-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $updateTemp | Out-Null
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Write-Host 'Downloading the update...'
  $archive = Join-Path $updateTemp 'release.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://codeload.github.com/harpertristan/test/zip/refs/heads/main' -OutFile $archive -TimeoutSec 120
  $release = Join-Path $updateTemp 'release'
  Expand-Archive -LiteralPath $archive -DestinationPath $release
  $source = @(Get-ChildItem -LiteralPath $release -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'scripts\update-in-place.js') })
  if ($source.Count -ne 1) { throw 'The downloaded archive has no valid updater. Your folder has not changed.' }
  Write-Host 'Stopping Play Scout and saving queues...'
  & $node (Join-Path $Target 'scripts\stop-desktop.js')
  if ($LASTEXITCODE -ne 0) { throw 'Stop the old application in its window, then retry. Code has not changed.' }
  $updateArgs = @((Join-Path $source[0].FullName 'scripts\update-in-place.js'), $source[0].FullName, $Target)
  if ($Start) { $updateArgs += '--start' }
  & $node @updateArgs
  if ($LASTEXITCODE -ne 0) { throw 'Update or startup failed. Read the message above; do not delete data or .env.' }
} catch {
  Write-Host ('Update failed: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($updateTemp -and (Test-Path -LiteralPath $updateTemp)) { Remove-Item -LiteralPath $updateTemp -Recurse -Force }
}

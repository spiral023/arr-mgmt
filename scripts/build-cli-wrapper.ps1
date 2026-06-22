$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$projectPath = Join-Path $repoRoot "src\cli-wrapper\ArrCliWrapper.csproj"
$appDir = Join-Path $repoRoot "release\win-unpacked"
$appExe = Join-Path $appDir "ARR Ops.exe"
$publishDir = Join-Path $repoRoot "out\cli-wrapper"
$wrapperExe = Join-Path $publishDir "arr-cli.exe"
$targetExe = Join-Path $appDir "arr-cli.exe"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "Das .NET 8 SDK ('dotnet') wurde nicht gefunden. Installiere es von https://dotnet.microsoft.com/download (net8.0) und stelle sicher, dass 'dotnet' im PATH liegt, bevor du 'npm run dist:win' bzw. 'npm run build:cli-wrapper' ausfuehrst."
}

if (-not (Test-Path -LiteralPath $appExe)) {
  throw "Cannot build CLI wrapper because packaged app is missing: $appExe. Run electron-builder first."
}

dotnet publish $projectPath `
  --configuration Release `
  --runtime win-x64 `
  --self-contained true `
  --output $publishDir `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:DebugType=none `
  -p:DebugSymbols=false

if ($LASTEXITCODE -ne 0) {
  throw "dotnet publish failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $wrapperExe)) {
  throw "dotnet publish completed but wrapper exe is missing: $wrapperExe"
}

Copy-Item -LiteralPath $wrapperExe -Destination $targetExe -Force
Write-Host "CLI companion built: $targetExe"

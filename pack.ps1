param(
  [string]$OutDir = "dist",
  [string]$OutFile = "",
  [switch]$SkipInstall,
  [switch]$SkipCheck,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgPath = Join-Path $root "package.json"
if (-not (Test-Path -LiteralPath $pkgPath)) {
  throw "package.json not found: $pkgPath"
}

$pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
if (-not $pkg.name -or -not $pkg.version) {
  throw "package.json must contain name and version"
}

$outDirPath = Join-Path $root $OutDir
if (-not (Test-Path -LiteralPath $outDirPath)) {
  New-Item -ItemType Directory -Path $outDirPath | Out-Null
}

if ($Clean) {
  Get-ChildItem -LiteralPath $outDirPath -Filter "*.vsix" -File -ErrorAction SilentlyContinue | Remove-Item -Force
}

$outFileName = $OutFile
if ([string]::IsNullOrWhiteSpace($outFileName)) {
  $outFileName = "$($pkg.name)-$($pkg.version).vsix"
}

$outPath = Join-Path $outDirPath $outFileName

Push-Location $root
try {
  if (-not $SkipInstall) {
    if (Test-Path -LiteralPath (Join-Path $root "package-lock.json")) {
      npm ci
    } else {
      npm install
    }
  }

  if (-not $SkipCheck) {
    npm run check
  }

  npx @vscode/vsce package --no-dependencies --out $outPath
  Write-Host "Packed: $outPath"
} finally {
  Pop-Location
}


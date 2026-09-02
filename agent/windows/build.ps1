#requires -Version 5.1
<#
  Builds the Windows Agent. The version comes from version.py alone, so the
  source, the UI, the installer and the API report can never disagree
  (docs/OPERATIONS.md packaging gate).
#>
[CmdletBinding()]
param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$version = (& $Python -c "import runpy;print(runpy.run_path('version.py')['VERSION'])").Trim()
if (-not ($version -match '^\d+\.\d+\.\d+$')) { throw "version.py is malformed: $version" }
Write-Host "Building TMT Drug Master Agent $version"

if (-not (Test-Path .venv)) { & $Python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements-build.txt

Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue

& .\.venv\Scripts\python.exe -m PyInstaller `
  --noconfirm --clean --windowed --onefile `
  --name "TMTDrugMasterAgent" `
  --paths . `
  --add-data "version.py;." `
  app.py

$exe = Join-Path $PSScriptRoot "dist\TMTDrugMasterAgent.exe"
if (-not (Test-Path $exe)) { throw "Build produced no executable" }

$reported = (& $exe --version).Trim()
if ($reported -ne $version) { throw "Executable reports $reported but version.py says $version" }

Write-Host "OK: dist\TMTDrugMasterAgent.exe ($version)"

# Installer. Skipped rather than fatal when Inno Setup is absent, so the exe
# build stays usable on a machine that only needs to test the agent.
$iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
if (-not $iscc) {
  foreach ($candidate in @(
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
      "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
    if (Test-Path $candidate) { $iscc = $candidate; break }
  }
} else {
  $iscc = $iscc.Source
}

if ($iscc) {
  & $iscc "/DAppVersion=$version" "installer\TMTDrugMasterAgent.iss"
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }
  $setup = Join-Path $PSScriptRoot "dist\TMTDrugMasterAgent-Setup-$version.exe"
  if (-not (Test-Path $setup)) { throw "Inno Setup produced no installer" }
  Write-Host "OK: dist\TMTDrugMasterAgent-Setup-$version.exe"
} else {
  Write-Warning "Inno Setup 6 (ISCC.exe) not found; built the executable only. Install it from https://jrsoftware.org/isdl.php to produce the installer."
}

Write-Host "Sign both binaries before publishing them to GitHub Releases."

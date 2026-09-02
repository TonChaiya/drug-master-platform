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
Write-Host "Sign this binary before publishing it to GitHub Releases."

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

# Windows PowerShell 5.1 turns anything a native exe writes to stderr into an
# ErrorRecord, and PyInstaller logs its INFO lines there. With
# ErrorActionPreference=Stop that aborts a build that actually succeeded, so
# native calls run with the preference relaxed and are judged on $LASTEXITCODE.
function Invoke-Native {
  param([Parameter(Mandatory)][string]$FilePath, [string[]]$Arguments = @(), [string]$What)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $FilePath @Arguments } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

$version = (& $Python -c "import runpy;print(runpy.run_path('version.py')['VERSION'])" 2>$null).Trim()
if (-not ($version -match '^\d+\.\d+\.\d+$')) { throw "version.py is malformed: $version" }
Write-Host "Building TMT Drug Master Agent $version"

if (-not (Test-Path .venv)) { Invoke-Native $Python @("-m", "venv", ".venv") "venv creation" }
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
Invoke-Native $venvPython @("-m", "pip", "install", "--upgrade", "pip") "pip upgrade"
Invoke-Native $venvPython @("-m", "pip", "install", "-r", "requirements-build.txt") "dependency install"

Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue

Invoke-Native $venvPython @(
  "-m", "PyInstaller",
  "--noconfirm", "--clean", "--windowed", "--onefile",
  "--name", "TMTDrugMasterAgent",
  "--paths", ".",
  "--add-data", "version.py;.",
  # customtkinter ships its themes as data files; without this the built exe
  # starts and then dies looking for them.
  "--collect-data", "customtkinter",
  "app.py") "PyInstaller"

$exe = Join-Path $PSScriptRoot "dist\TMTDrugMasterAgent.exe"
if (-not (Test-Path $exe)) { throw "Build produced no executable" }

$reported = (& $exe --version 2>$null | Out-String).Trim()
if ($reported -ne $version) { throw "Executable reports $reported but version.py says $version" }

Write-Host "OK: dist\TMTDrugMasterAgent.exe ($version)"

# Installer. Skipped rather than fatal when Inno Setup is absent, so the exe
# build stays usable on a machine that only needs to test the agent.
$iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
if (-not $iscc) {
  foreach ($candidate in @(
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
      "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
      # winget installs Inno Setup per user by default.
      "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")) {
    if (Test-Path $candidate) { $iscc = $candidate; break }
  }
} else {
  $iscc = $iscc.Source
}

if ($iscc) {
  Invoke-Native $iscc @("/DAppVersion=$version", "installer\TMTDrugMasterAgent.iss") "Inno Setup"
  $setup = Join-Path $PSScriptRoot "dist\TMTDrugMasterAgent-Setup-$version.exe"
  if (-not (Test-Path $setup)) { throw "Inno Setup produced no installer" }
  Write-Host "OK: dist\TMTDrugMasterAgent-Setup-$version.exe"
} else {
  Write-Warning "Inno Setup 6 (ISCC.exe) not found; built the executable only. Install it from https://jrsoftware.org/isdl.php to produce the installer."
}

Write-Host "Sign both binaries before publishing them to GitHub Releases."

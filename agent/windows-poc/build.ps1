$ErrorActionPreference = 'Stop'

$AgentRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $AgentRoot '..\..')).Path
$ArtifactRoot = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'artifacts\poc'))
$ExpectedArtifactRoot = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'artifacts\poc'))
if ($ArtifactRoot -ne $ExpectedArtifactRoot -or -not $ArtifactRoot.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to clean an unexpected artifact directory.'
}

if (Test-Path -LiteralPath $ArtifactRoot) {
    Remove-Item -LiteralPath $ArtifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $ArtifactRoot | Out-Null

$Python = Join-Path $AgentRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $Python)) {
    throw 'ไม่พบ .venv กรุณาสร้างและติดตั้ง requirements.txt ก่อน build'
}

Push-Location $AgentRoot
try {
    & $Python -m PyInstaller --noconfirm --clean --onefile --windowed `
        --name 'TMTDrugMasterAgentPoc' `
        --distpath $ArtifactRoot `
        --workpath (Join-Path $AgentRoot 'build') `
        --specpath (Join-Path $AgentRoot 'build') `
        --collect-all mysql.connector `
        'app.py'
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed.' }
    & (Join-Path $ArtifactRoot 'TMTDrugMasterAgentPoc.exe') --version 2>$null
} finally {
    Pop-Location
}

Write-Host "Portable artifact: $(Join-Path $ArtifactRoot 'TMTDrugMasterAgentPoc.exe')"

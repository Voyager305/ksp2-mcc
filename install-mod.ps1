# Builds the MccLink mod in Docker and installs it into the game.
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 in the system codepage,
# so non-ASCII text here would break parsing.
param(
    [string]$GameDir = "C:\Games\Kerbal Space Program 2",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not (Test-Path (Join-Path $GameDir "KSP2_x64.exe"))) {
    Write-Error "KSP2 not found in '$GameDir'. Pass the path: .\install-mod.ps1 -GameDir 'D:\...\Kerbal Space Program 2'"
}
if (-not (Test-Path (Join-Path $GameDir "BepInEx\plugins\SpaceWarp"))) {
    Write-Error "SpaceWarp is not installed in '$GameDir'. Install SpaceWarp (via CKAN), then retry."
}

if (-not $SkipBuild) {
    Write-Host "Building the mod in Docker..." -ForegroundColor Cyan
    docker run --rm `
        -v "$root\mod:/src" `
        -v "${GameDir}:/game:ro" `
        -w /src mcr.microsoft.com/dotnet/sdk:8.0 `
        dotnet build -c Release -o dist
    if ($LASTEXITCODE -ne 0) { Write-Error "Mod build failed" }
}

$dll = Join-Path $root "mod\dist\MccLink.dll"
if (-not (Test-Path $dll)) { Write-Error "Not found: $dll - was the build run?" }

$target = Join-Path $GameDir "BepInEx\plugins\MccLink"
New-Item -ItemType Directory -Force $target | Out-Null
try {
    Copy-Item $dll $target -Force
} catch {
    Write-Error "Could not copy MccLink.dll (is KSP2 still running? close it first). $_"
}
Copy-Item (Join-Path $root "mod\swinfo.json") $target -Force

Write-Host "Mod installed: $target" -ForegroundColor Green
Write-Host "Start the game - BepInEx log should show 'MCC Link bridge listening on 0.0.0.0:8766'."

# Sets up a local LLM dispatcher via Ollama (Qwen2.5-7B with extended context).
# ASCII-only: Windows PowerShell 5.1 reads .ps1 in the system codepage.
param(
    [string]$Base = "qwen2.5:7b",
    [string]$Name = "mcc-dispatcher"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ollama) {
    $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
}
if (-not (Test-Path $ollama)) {
    Write-Error "Ollama not found. Install from https://ollama.com/download and re-run."
}

try { Invoke-RestMethod http://localhost:11434/api/version -TimeoutSec 3 | Out-Null }
catch { Write-Error "Ollama service is not running. Start the Ollama app, then re-run." }

Write-Host "Pulling base model $Base ..." -ForegroundColor Cyan
& $ollama pull $Base
if ($LASTEXITCODE -ne 0) { Write-Error "pull failed" }

Write-Host "Creating custom model '$Name' with 16K context ..." -ForegroundColor Cyan
& $ollama create $Name -f (Join-Path $root "local-model\Modelfile")
if ($LASTEXITCODE -ne 0) { Write-Error "create failed" }

Write-Host ""
Write-Host "Done. Model '$Name' is ready." -ForegroundColor Green
Write-Host "Point the dispatcher at it in .env:" -ForegroundColor Green
Write-Host "  MCC_BASE_URL=http://host.docker.internal:11434/v1"
Write-Host "  MCC_MODEL=$Name"
Write-Host "  MCC_API_KEY=ollama"
Write-Host "  MCC_STREAM=0"
Write-Host "Then: docker compose up -d backend"

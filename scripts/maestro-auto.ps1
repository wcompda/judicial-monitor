# MAESTRO AUTO - Roda sozinho, sem Claude
Write-Host "=== MAESTRO AUTO INICIADO ===" -ForegroundColor Green

# 1. Vai pra pasta do projeto (ajusta seu caminho)
Set-Location "C:\Users\MASTER\emissor-notas-saas\"
git fetch origin
git checkout claude/maestro-skills-artifacts-y0jgvk

# 2. Cria pasta no HD Samsung
$destino = "X:\BACKUP_WCOMTEC\MAESTRO\2026-08-23"
mkdir $destino -Force | Out-Null

# 3. Copia skills pro HD
robocopy .claude "$destino\.claude" /E /NFL /NDL /NJH /NJS

# 4. Cria estrutura da FABRICA LOCAL se não existir
mkdir "X:\BACKUP_WCOMTEC\FABRICA_LOCAL\pedidos" -Force | Out-Null
mkdir "X:\BACKUP_WCOMTEC\FABRICA_LOCAL\prontos" -Force | Out-Null
mkdir "X:\BACKUP_WCOMTEC\FABRICA_LOCAL\fazendo" -Force | Out-Null

# 5. Se tiver Ollama instalado, já deixa instruções
if (-not (Test-Path "X:\BACKUP_WCOMTEC\FABRICA_LOCAL\README.txt")) {
@"
FABRICA LOCAL - COMO USAR:
1. Instale Ollama de https://ollama.com
2. Rode: ollama pull qwen2.5-coder:14b
3. Jogue um arquivo .txt em \pedidos\ com seu pedido
   Ex: "Crie um emissor NFS-e com NCM e CFOP"
4. A IA vai gerar em \prontos\
5. Claude pega de \prontos\ e faz deploy

Para rodar autonomo: ollama run qwen2.5-coder:14b
"@ | Out-File "X:\BACKUP_WCOMTEC\FABRICA_LOCAL\README.txt"
}

Write-Host "MAESTRO salvo no mastro! ✅" -ForegroundColor Green
Write-Host "Destino: $destino" -ForegroundColor Cyan
Write-Host "Fabrica local pronta em X:\BACKUP_WCOMTEC\FABRICA_LOCAL\" -ForegroundColor Cyan
Start-Sleep 3

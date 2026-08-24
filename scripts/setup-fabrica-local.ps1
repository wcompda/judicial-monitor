# MAESTRO - Setup da FABRICA LOCAL no HD Samsung
# Roda 100% local no Windows (PowerShell). Nao depende do Claude para funcionar.

Write-Host "=== SETUP FABRICA LOCAL ===" -ForegroundColor Green

# 1. Detecta a letra do HD Samsung: usa E: se tiver BACKUP_WCOMTEC, senao X:, senao cria em E:
if (Test-Path "E:\BACKUP_WCOMTEC") {
    $base = "E:\BACKUP_WCOMTEC\FABRICA_LOCAL"
} elseif (Test-Path "X:\BACKUP_WCOMTEC") {
    $base = "X:\BACKUP_WCOMTEC\FABRICA_LOCAL"
} elseif (Test-Path "E:\") {
    $base = "E:\BACKUP_WCOMTEC\FABRICA_LOCAL"
} elseif (Test-Path "X:\") {
    $base = "X:\BACKUP_WCOMTEC\FABRICA_LOCAL"
} else {
    Write-Host "ERRO: nem E: nem X: encontrados. Conecte o HD Samsung e rode de novo." -ForegroundColor Red
    exit 1
}
Write-Host "Usando: $base" -ForegroundColor Cyan

# 2. Cria estrutura
mkdir "$base\pedidos", "$base\fazendo", "$base\prontos" -Force | Out-Null

# 3. Cria fabrica_worker.ps1
$worker = @'
$PastaPedidos = "$PSScriptRoot\pedidos"
$PastaFazendo = "$PSScriptRoot\fazendo"
$PastaProntos = "$PSScriptRoot\prontos"
Write-Host "=== FABRICA LOCAL INICIADA ===" -ForegroundColor Green
Write-Host "Vigiando: $PastaPedidos" -ForegroundColor Cyan
while($true){
    $pedidos = Get-ChildItem "$PastaPedidos\*.txt" -ErrorAction SilentlyContinue
    foreach($pedido in $pedidos){
        Write-Host "[NOVO PEDIDO] $($pedido.Name)" -ForegroundColor Magenta
        $destFazendo = Join-Path $PastaFazendo $pedido.Name
        Move-Item $pedido.FullName $destFazendo -Force
        $conteudo = Get-Content $destFazendo -Raw
        $nomeProjeto = [System.IO.Path]::GetFileNameWithoutExtension($pedido.Name)
        $pastaSaida = Join-Path $PastaProntos $nomeProjeto
        mkdir $pastaSaida -Force | Out-Null
        $prompt = "Voce e programador PHP Senior. Tarefa: $conteudo Gere codigo completo em $pastaSaida com estrutura de pastas, SQL_SETUP.sql se precisar, README. Use mecanismo T8 para secrets."
        ollama run qwen2.5-coder:14b $prompt | Out-File "$pastaSaida\GERADO_PELA_IA.md" -Encoding utf8
        Copy-Item $destFazendo "$pastaSaida\pedido_original.txt" -Force
        Remove-Item $destFazendo -Force
        Write-Host "Finalizado -> $pastaSaida" -ForegroundColor Green
    }
    Start-Sleep 5
}
'@
$worker | Out-File "$base\fabrica_worker.ps1" -Encoding utf8

# 4. Cria INICIAR_FABRICA.bat (usa a letra detectada, nao fixo em E:)
$bat = @"
@echo off
title FABRICA WCOM - QWEN 14B
color 0A
powershell.exe -ExecutionPolicy Bypass -File "$base\fabrica_worker.ps1"
pause
"@
$bat | Out-File "$base\INICIAR_FABRICA.bat" -Encoding ascii

# 5. Confere
Write-Host "--- Conteudo de $base ---" -ForegroundColor Yellow
dir $base
Write-Host "--- Modelos Ollama instalados ---" -ForegroundColor Yellow
try { ollama list } catch { Write-Host "Ollama nao encontrado no PATH - instale de https://ollama.com" -ForegroundColor Red }

# 6. Pedido de teste
"Crie um emissor NFS-e simples em PHP puro com cadastro cliente" | Out-File "$base\pedidos\teste_emissor.txt" -Encoding utf8

Write-Host "=== SETUP CONCLUIDO ===" -ForegroundColor Green
Write-Host "Para rodar a fabrica: $base\INICIAR_FABRICA.bat" -ForegroundColor Cyan

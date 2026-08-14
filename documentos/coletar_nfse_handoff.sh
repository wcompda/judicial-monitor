#!/bin/bash
# Coletor de handoff do emissor NFS-e Nacional / WCOM.
# Rodar NO HOST (SSH ou Terminal do cPanel), nao em sandbox.
# Somente leitura: nao executa migrations, nao toca no banco, nao emite nada.

set -u

BASE="/home2/wcomud67/public_html/restrito/nfse_nacional"
OUT="$HOME/WCOM_NFSE_HANDOFF_$(date +%Y-%m-%d)"
ZIP="$OUT.zip"

echo "=========================================="
echo " Coletor de handoff NFS-e Nacional"
echo "=========================================="
echo

# --- 1. O caminho base precisa existir. Sem isso, nada faz sentido. -------
if [ ! -d "$BASE" ]; then
  echo "ABORTADO: caminho base nao encontrado."
  echo "  esperado: $BASE"
  echo
  echo "Voce nao esta no host correto, ou o projeto mudou de lugar."
  echo "Procure com:  find /home2 -type d -name nfse_nacional 2>/dev/null"
  exit 1
fi
echo "[ok] base encontrada: $BASE"
echo

rm -rf "$OUT"
mkdir -p "$OUT/codigo" "$OUT/historico" "$OUT/docs"

FOUND=0
MISSING=0

copiar() {  # copiar <caminho-relativo> <subpasta-destino>
  local rel="$1" sub="$2"
  local src="$BASE/$rel"
  local dst="$OUT/$sub/$rel"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp -p "$src" "$dst"
    printf '  FOUND   %-38s %8s bytes\n' "$rel" "$(wc -c < "$src")"
    FOUND=$((FOUND + 1))
  else
    printf '  MISSING %s\n' "$rel"
    MISSING=$((MISSING + 1))
  fi
}

# --- 2. Codigo do motor fiscal -------------------------------------------
echo "--- codigo ---"
for f in \
  sefin/SefinService.php \
  sefin/SefinClient.php \
  sefin/PosEmissaoService.php \
  preview_sefin.php \
  emitir_sefin.php \
  consultar_sefin.php \
  controle_nfse.php \
  overrides_os.php
do
  copiar "$f" codigo
done

# tudo que houver em sefin/ e nao esteja na lista acima
if [ -d "$BASE/sefin" ]; then
  mkdir -p "$OUT/codigo/sefin"
  cp -pn "$BASE"/sefin/*.php "$OUT/codigo/sefin/" 2>/dev/null
  echo "  [+] sefin/ completo: $(ls -1 "$OUT/codigo/sefin" | wc -l) arquivo(s)"
fi

# --- 3. Migrations (schema das tabelas) ----------------------------------
echo
echo "--- migrations ---"
if [ -d "$BASE/migrations" ]; then
  cp -rp "$BASE/migrations" "$OUT/codigo/"
  echo "  FOUND   migrations/  ($(find "$BASE/migrations" -type f | wc -l) arquivo(s))"
  FOUND=$((FOUND + 1))
else
  echo "  MISSING migrations/"
  MISSING=$((MISSING + 1))
fi

# --- 4. Documentacao ------------------------------------------------------
echo
echo "--- docs ---"
for d in ARQUITETURA_NFSE_NACIONAL_SEFIN_2026.md GUIA_IMPLANTACAO_NFSE_NACIONAL.md; do
  copiar "$d" docs
done
# qualquer outro .md na raiz do projeto
cp -pn "$BASE"/*.md "$OUT/docs/" 2>/dev/null

# --- 5. Inventario: arvore do projeto (sem conteudo sensivel) ------------
echo
echo "--- inventario ---"
find "$BASE" -type f \
  ! -name '*.pfx' ! -name '*.p12' ! -name '*.pem' ! -name '*.key' \
  ! -name '.env*' ! -name '*.log' \
  -printf '%10s  %P\n' 2>/dev/null | sort -k2 > "$OUT/INVENTARIO.txt"
echo "  arvore salva em INVENTARIO.txt ($(wc -l < "$OUT/INVENTARIO.txt") arquivos)"

# --- 6. Guarda de seguranca: nada de segredo entra no pacote -------------
echo
echo "--- verificacao de seguranca ---"
SUSPEITO=$(find "$OUT" -type f \( -name '*.pfx' -o -name '*.p12' -o -name '*.pem' \
           -o -name '*.key' -o -name '.env*' \) 2>/dev/null)
if [ -n "$SUSPEITO" ]; then
  echo "  REMOVENDO arquivos sensiveis que entraram por engano:"
  echo "$SUSPEITO" | sed 's/^/    /'
  echo "$SUSPEITO" | xargs rm -f
else
  echo "  [ok] nenhum certificado, chave ou .env no pacote"
fi
# senhas embutidas em codigo copiado
if grep -rlEi "(senha|password|passwd|secret|token)\s*=\s*['\"][^'\"]{4,}" \
     "$OUT/codigo" 2>/dev/null | grep -q .; then
  echo
  echo "  ATENCAO: possivel credencial embutida nos arquivos abaixo."
  echo "  Revise e edite ANTES de enviar o pacote:"
  grep -rlEi "(senha|password|passwd|secret|token)\s*=\s*['\"][^'\"]{4,}" \
    "$OUT/codigo" 2>/dev/null | sed "s|$OUT/|    |"
fi

# --- 7. Resultado ---------------------------------------------------------
echo
echo "=========================================="
echo " encontrados: $FOUND   ausentes: $MISSING"
echo "=========================================="

if [ "$FOUND" -eq 0 ]; then
  echo
  echo "ABORTADO: nenhum arquivo do motor fiscal foi encontrado."
  echo "Nao vou gerar um ZIP vazio que parece completo."
  rm -rf "$OUT"
  exit 1
fi

cd "$(dirname "$OUT")" || exit 1
rm -f "$ZIP"
zip -rq "$ZIP" "$(basename "$OUT")"

echo
echo "ZIP:  $ZIP"
echo "peso: $(du -h "$ZIP" | cut -f1)"
echo
echo "Confira o conteudo antes de enviar:"
echo "  unzip -l \"$ZIP\""

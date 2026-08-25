#!/bin/bash
# Diagnostico de autenticacao do Emissor NFSe (emissordenotas.wcomtec.com.br)
#
# SOMENTE LEITURA. Nao altera arquivo, nao altera banco, nao emite NFS-e,
# nao tenta adivinhar senha. Apenas localiza e descreve o mecanismo de login.
#
# Uso:  bash diagnostico_auth_emissor.sh [caminho_do_projeto]
# Sem argumento, procura sozinho sob $HOME.

set -u
ALVO_EMAIL="wenrry@wcomtec.com.br"
RAIZ="${1:-}"

hr() { printf '%s\n' "------------------------------------------------------------"; }
sec() { echo; hr; echo " $1"; hr; }

echo "============================================================"
echo " DIAGNOSTICO DE AUTENTICACAO - Emissor NFSe"
echo " modo: somente leitura   data: $(date '+%Y-%m-%d %H:%M')"
echo "============================================================"

# --- 1. Localizar o projeto ---------------------------------------------
sec "1. LOCALIZACAO DO PROJETO"

if [ -z "$RAIZ" ]; then
  echo "Procurando telas de login sob $HOME ..."
  CAND=$(find "$HOME" -maxdepth 6 -type f \
           \( -iname 'login.php'  -o -iname 'login.html' \
           -o -iname 'entrar.php' -o -iname 'auth.php' \) \
           2>/dev/null | head -20)
  if [ -n "$CAND" ]; then
    echo "$CAND" | sed 's/^/  /'
    RAIZ=$(dirname "$(echo "$CAND" | head -1)")
  fi

  echo
  echo "Docroots de dominio/subdominio:"
  find "$HOME" -maxdepth 3 -type d \
       \( -name 'public_html' -o -name 'emissordenotas*' -o -name 'httpdocs' \) \
       2>/dev/null | sed 's/^/  /'
fi

if [ -z "$RAIZ" ] || [ ! -d "$RAIZ" ]; then
  echo
  echo "ABORTADO: nao consegui determinar a raiz do projeto."
  echo "Rode de novo passando o caminho:"
  echo "  bash $0 /home2/wcomud67/public_html/emissordenotas"
  exit 1
fi

echo
echo "RAIZ ADOTADA: $RAIZ"
echo
echo "Pilha detectada:"
[ -f "$RAIZ/composer.json" ]      && echo "  composer.json presente"
[ -f "$RAIZ/artisan" ]            && echo "  Laravel (artisan)"
[ -d "$RAIZ/vendor/laravel" ]     && echo "  Laravel (vendor)"
[ -d "$RAIZ/app/Http/Controllers" ] && echo "  estrutura MVC (app/Http/Controllers)"
[ -f "$RAIZ/package.json" ]       && echo "  package.json presente"
[ -f "$RAIZ/index.php" ]          && echo "  PHP puro (index.php na raiz)"
echo "  arquivos .php: $(find "$RAIZ" -name '*.php' -not -path '*/vendor/*' 2>/dev/null | wc -l)"

BUSCA=(--include=*.php --include=*.js --include=*.env* --include=*.sql
       --exclude-dir=vendor --exclude-dir=node_modules --exclude-dir=.git)

# --- 2. Onde a autenticacao acontece ------------------------------------
sec "2. AUTENTICACAO - arquivos e algoritmo"

echo ">> Verificacao de senha (password_verify / hash):"
grep -rn "${BUSCA[@]}" -E "password_verify|password_hash|password_needs_rehash" \
     "$RAIZ" 2>/dev/null | head -25 | sed 's/^/  /'

echo
echo ">> Algoritmos legados (md5/sha1/crypt) - se aparecerem, o hash e fraco:"
grep -rn "${BUSCA[@]}" -E "\b(md5|sha1|crypt)\s*\(" \
     "$RAIZ" 2>/dev/null | grep -iE "senha|password|pass|login" | head -15 | sed 's/^/  /'

echo
echo ">> Constantes de algoritmo:"
grep -rn "${BUSCA[@]}" -E "PASSWORD_(DEFAULT|BCRYPT|ARGON2I|ARGON2ID)" \
     "$RAIZ" 2>/dev/null | head -10 | sed 's/^/  /'

echo
echo ">> Arquivos de login / sessao / middleware:"
find "$RAIZ" -type f -iname '*.php' -not -path '*/vendor/*' \
     \( -iname '*login*' -o -iname '*auth*' -o -iname '*sess*' \
     -o -iname '*usuario*' -o -iname '*user*' -o -iname '*cadastr*' \) \
     2>/dev/null | head -25 | sed "s|^$RAIZ|  .|"

# --- 3. Tabela e colunas ------------------------------------------------
sec "3. TABELA DE USUARIOS (pelo codigo)"

echo ">> SELECT/INSERT que tocam usuarios:"
grep -rn "${BUSCA[@]}" -iE "FROM\s+(usuarios|users|tb_usuarios|login)" \
     "$RAIZ" 2>/dev/null | head -15 | sed 's/^/  /'

echo
echo ">> CREATE TABLE em migrations/.sql:"
grep -rn --include=*.sql --include=*.php -iE "CREATE TABLE[^(]*(usuario|user)" \
     "$RAIZ" 2>/dev/null | head -10 | sed 's/^/  /'

echo
echo ">> Nomes de coluna candidatos:"
grep -rhon "${BUSCA[@]}" -iE "\b(senha_hash|senha|password_hash|password|passwd|email|usuario)\b" \
     "$RAIZ" 2>/dev/null | cut -d: -f2- | sort | uniq -c | sort -rn | head -12 | sed 's/^/  /'

# --- 4. Recuperacao de senha --------------------------------------------
sec "4. RECUPERACAO DE SENHA - existe fluxo?"

echo ">> Rotas / arquivos de recuperacao:"
R=$(grep -rln "${BUSCA[@]}" -iE "esqueci|forgot|recuperar|recover|reset.?senha|reset.?password|redefinir" \
      "$RAIZ" 2>/dev/null | head -15)
if [ -n "$R" ]; then
  echo "$R" | sed "s|^$RAIZ|  .|"
  echo
  echo "  ocorrencias:"
  grep -rn "${BUSCA[@]}" -iE "esqueci|forgot|recuperar|reset.?senha|redefinir" \
       "$RAIZ" 2>/dev/null | head -12 | sed 's/^/    /'
else
  echo "  NENHUM fluxo de recuperacao encontrado no codigo."
fi

echo
echo ">> Token de recuperacao (tabela/coluna):"
grep -rn "${BUSCA[@]}" -iE "reset_token|token_recuperacao|password_reset|remember_token" \
     "$RAIZ" 2>/dev/null | head -10 | sed 's/^/  /'

echo
echo ">> Envio de e-mail (mail/PHPMailer/SMTP):"
grep -rln "${BUSCA[@]}" -iE "PHPMailer|mail\(|SMTP|sendmail" \
     "$RAIZ" 2>/dev/null | head -8 | sed "s|^$RAIZ|  .|"

# --- 5. Backdoor / admin alternativo ------------------------------------
sec "5. CREDENCIAL ADMINISTRATIVA ALTERNATIVA (auditoria)"
echo "Se algo aparecer aqui, e um problema de seguranca a CORRIGIR,"
echo "nao um atalho a usar."
echo
echo ">> Comparacao de senha em texto puro / admin fixo:"
grep -rn "${BUSCA[@]}" -iE "(senha|password|pass)\s*(==|===)\s*['\"]" \
     "$RAIZ" 2>/dev/null | head -10 | sed 's/^/  /'
grep -rn "${BUSCA[@]}" -iE "master.?(key|pass|senha)|super.?admin|bypass" \
     "$RAIZ" 2>/dev/null | head -10 | sed 's/^/  /'

echo
echo ">> Script CLI de reset ja existente no projeto:"
find "$RAIZ" -type f \( -name '*.php' -o -name '*.sh' \) -not -path '*/vendor/*' \
     \( -iname '*reset*' -o -iname '*seed*' -o -iname '*criar_usuario*' \
     -o -iname '*admin*' \) 2>/dev/null | head -12 | sed "s|^$RAIZ|  .|"

# --- 6. Config de banco (SEM imprimir valores) --------------------------
sec "6. CONFIG DE BANCO - apenas localizacao"
echo "Os VALORES nao sao impressos. Apenas onde estao e quais chaves existem."
echo
for f in "$RAIZ/.env" "$RAIZ/config.php" "$RAIZ/conexao.php" \
         "$RAIZ/config/database.php" "$RAIZ/includes/config.php" "$RAIZ/db.php"; do
  [ -f "$f" ] && {
    echo "  arquivo: $f"
    grep -oiE "^[[:space:]]*[A-Z_]*(DB|DATABASE|HOST|USER|PASS|NAME)[A-Z_]*" "$f" \
      2>/dev/null | tr -d ' ' | sort -u | sed 's/^/      chave: /'
  }
done
find "$RAIZ" -maxdepth 3 -name '.env*' -o -maxdepth 3 -iname 'conex*.php' \
     2>/dev/null | head -5 | sed 's/^/  outro: /'

# --- 7. Referencias ao e-mail alvo --------------------------------------
sec "7. REFERENCIAS A $ALVO_EMAIL NO CODIGO"
M=$(grep -rn "${BUSCA[@]}" -F "$ALVO_EMAIL" "$RAIZ" 2>/dev/null | head -10)
if [ -n "$M" ]; then
  echo "$M" | sed 's/^/  /'
  echo
  echo "  NOTA: e-mail fixo no codigo pode indicar admin hardcoded - revisar."
else
  echo "  Nenhuma. O usuario existe no BANCO, nao no codigo (esperado e correto)."
fi

hr
echo " FIM. Nenhum arquivo, banco ou nota fiscal foi alterado."
echo " Proximo passo: rodar as consultas SELECT no phpMyAdmin."
hr

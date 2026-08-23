---
name: deagua-bot
description: Bot WhatsApp Z-API multi-tenant. Mecanismo T8 de secrets.
---

# deagua-bot

Bot WhatsApp (Z-API) multi-tenant.

## Regra de ouro (mecanismo T8 de secrets)

- `tenants/<slug>.secret.php` fica no `.gitignore`, carregado por `tenants/_resolver.php` via `tenantSecretPath()`.
- Constantes PHP são de atribuição única — o servidor sempre vence.
- Deploy nunca sobrescreve `*.secret.php`.
- Se o secret estiver ausente, falhar com a mensagem: "Crie `tenants/guaira.secret.php` a partir de `tenants/_template.secret.php`".

## Constantes do secret

`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`, `WA_INSTANCE`, `WA_API_KEY`, `WA_SECURITY_TOKEN`, `WA_API_URL`, `PIX_CHAVE`, `ADMIN_SENHA`, `CLAUDE_API_KEY`, `DB_CHARSET`

## Proibido

- Commitar `instalar.php`, `webhook_simples.php`, `SECURITY_AUDIT` com senha.
- Usar `.gitignore` sem a exceção `!tenants/_template.secret.php`.

## Testes

- `php -l` nos 7 arquivos
- `tests/run_all.sh` — 19/19
- Licenças — 38/38
- `diff_producao.sh`

## Correção T1 (histórico)

- Remover Instance ID `3F54...` e senha `deagua2026` hardcoded do código.
- Trocar referências diretas de FTP/DB por "Configurado no servidor".
- Instrução de `ADMIN_SENHA` -> "use Atendentes -> Senha".

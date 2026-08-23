---
name: infra-backup
description: Rotina backup total local + servidor + banco
---

# infra-backup

Rotina de backup total: local + servidor + banco.

## Passos

1. Localizar HD Samsung
2. Backup de `codigo_local`
3. `mysqldump wcomud67_emissor` -> `db.sql.gz`
4. SFTP download de `codigo_servidor`
5. Gerar hashes SHA256
6. Salvar em `X:\BACKUP_WCOMTEC\EMISSOR_NFSE\YYYY-MM-DD\`

## Scripts

- `SQL_SETUP.sql` com 13 tabelas + NCM (10k) + CFOP (500)
- `migrate.php`
- `seed.php`
- `verificar_backup.py`

---
name: wcomtec-emissor
description: SaaS emissor NFS-e + NF-e 4.00. Deploy Hostgator, config WCOMTEC, backup.
---

# wcomtec-emissor

SaaS emissor de NFS-e + NF-e 4.00 para a WCOM TECNOLOGIA LTDA.

## Comandos

- `/wcomtec-emissor deploy` -> SFTP para `wcomte50@br958.../emissordenotas/`, roda `migrate.php` e `seed.php`
- `/wcomtec-emissor config-wcomtec` -> Lê `C:\Users\MASTER\Desktop\chaves\`, cadastra WCOM TECNOLOGIA LTDA, ISS 3.00%, Uberlândia-MG, criptografa chave API e `.PFX` com AES-256
- `/wcomtec-emissor nfe` -> Cria módulo `/nfe/` separado. Tabelas `nfe`, `nfe_itens`, `produtos` com NCM/CFOP automático. Não mexe na NFS-e já auditada.
- `/wcomtec-emissor backup` -> Backup no HD Samsung `X:\BACKUP_WCOMTEC\...` + hash SHA256

## Checklist

- [ ] DB `wcomud67_emissor` criado
- [ ] `.env` de produção configurado
- [ ] Login `admin@wcom.local` testado
- [ ] `exec_atualizar.php` removido do deploy

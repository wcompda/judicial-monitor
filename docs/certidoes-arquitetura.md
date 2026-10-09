# Emissor de Certidões + Raio X Fiscal

Emissão em lote de CND Federal, CRF/FGTS, CNDT, certidões estaduais e municipais, além da
situação no Simples Nacional. O sistema faz uma varredura todo dia de madrugada e gera
alertas preventivos (o "Raio X").

**Estratégia: zero web scraping.** Nenhum código deste módulo abre navegador ou resolve CAPTCHA.

| Esfera | Fonte | Como |
|---|---|---|
| Federal (RFB/PGFN) | **Serpro**, a API oficial (Consulta CND / Integra Contador) | OAuth2 + mTLS com o Certificado A1 do cliente |
| FGTS (CRF), Trabalhista (CNDT), Estadual, Municipal, Simples | **Broker** (Infosimples) | HTTP/JSON. O broker lida com CAPTCHA, Cloudflare, Gov.br e as mudanças de layout dos portais |
| Federal (fallback) | Broker | Usado só quando o Serpro está instável e há `INFOSIMPLES_TOKEN` |

## Fluxo de dados

```
                      POST /api/certidoes/lotes  {cnpjs | empresas, tipos?}
                                    │  (202 Accepted + loteId, resposta imediata)
                                    ▼
┌───────────┐   upsert   ┌──────────────────┐  FlowProducer.addBulk (1 pai + N filhos por CNPJ)
│  Express  │──────────▶ │ Postgres          │──────────────────────────────┐
└───────────┘            │ cert_empresas     │                              ▼
                         │ cert_lotes        │           ┌──────────── Redis / BullMQ ─────────────┐
                         └──────────────────┘           │ fila federal │ fila broker │ fila lote  │
                                                          └──────┬───────┴──────┬──────┴─────┬──────┘
                         Worker (npm run worker:certidoes)        │              │            │
                     ┌────────────────────────────────────────────┘              │            │
                     ▼                                                           ▼            │
          SerproCndAdapter ── mTLS (A1 do cofre) ──▶ Serpro       BrokerAdapter ──▶ Infosimples│
                     │   PDF base64 → Buffer                         │ recibo URL → Buffer    │
                     └──────────────┬────────────────────────────────┘                        │
                                    ▼                                                         │
                         S3/R2/MinIO  certidoes/{cnpj}/{tipo}/{data}_{sha}.pdf                 │
                                    ▼                                                         │
                         cert_certidoes  (log: status, situação, pdf_key, emissão, validade)  │
                                                                                              ▼
                              todos os filhos do CNPJ terminaram → consolidarCnpj (Raio X)
                              compara com a certidão anterior → cert_alertas → webhook / e-mail
```

* **Paralelismo:** os 5–6 tipos de cada CNPJ entram nas filas ao mesmo tempo. N CNPJs × M tipos rodam
  em paralelo, limitados pela concorrência de cada fila (`CONCURRENCY_*`), que deve seguir o rate limit dos contratos.
* **Retry:** 8 tentativas com backoff exponencial e *full jitter* (5s → 15min). Respeita `Retry-After`.
  `PermanentError` (CNPJ inválido, token errado, município sem serviço) **não** re-tenta.
* **Falha parcial não trava o lote:** `ignoreDependencyOnFailure` faz o CNPJ fechar com o que deu certo.
  A falha final fica registrada como linha `ERRO` e vira alerta `FALHA_EMISSAO`.
* **O Redis só guarda `{loteId, cnpj, tipo}`.** Certificado, senha e PDF nunca passam por ele.

## Raio X Fiscal (agendamento diário)

`agendarRaioX()` registra um *job scheduler* do BullMQ (`RAIO_X_CRON`, padrão `7 3 * * *`, fuso
`America/Sao_Paulo`). Como o agendamento fica no Redis, a varredura roda **uma única vez** por dia,
mesmo com várias réplicas do worker.

A varredura lê os CNPJs ativos com `Promise.all` em blocos de 50, decide o que re-emitir, alerta
vencimentos e certificados A1 perto do fim e dispara um lote `origem='raio_x'`.

| Alerta | Severidade | Quando |
|---|---|---|
| `NOVA_PENDENCIA` | alta | certidão passou a POSITIVA (ou a primeira consulta já veio positiva) |
| `EXCLUSAO_SIMPLES` | alta | termo/evento de exclusão do Simples Nacional |
| `VENCIDA` / `VENCIMENTO_PROXIMO` | alta / média | validade passou / vence em ≤ `RAIO_X_DIAS_ALERTA_VENCIMENTO` |
| `CERTIFICADO_VENCENDO` | alta | A1 vence em ≤ `RAIO_X_DIAS_ALERTA_CERTIFICADO` (sem ele o Serpro para) |
| `FALHA_EMISSAO` | média | esgotou as tentativas ou teve erro permanente |
| `VERIFICAR_MANUALMENTE` | média | a fonte não devolveu situação conclusiva |
| `REGULARIZADA` | baixa | saiu de POSITIVA para NEGATIVA |

Os alertas são deduplicados por CNPJ, tipo, alerta e dia. Vão para os webhooks cadastrados
(evento `certidao_alerta`) e, quando a severidade é alta, para o e-mail `EMAIL_TO`.

`RAIO_X_REEMITIR_VIGENTES=true` (padrão) re-consulta tudo todo dia. É o que detecta débito novo mesmo
com CND vigente, mas cada consulta é cobrada pelo broker/Serpro. Com `false`, as NEGATIVAS ainda válidas
por mais de `RAIO_X_DIAS_REEMISSAO` dias são puladas.

## Certificado Digital A1

`POST /api/certidoes/certificados` com `{ pfxBase64, senha }` (somente admin):

1. Valida a senha no OpenSSL. PFX legado (RC2-40/3DES, comum em A1 antigos e recusado pelo Node 18+)
   é reempacotado automaticamente em AES-256.
2. Extrai o CNPJ titular (padrão ICP-Brasil `CN=RAZAO:CNPJ`), a validade e o fingerprint, e recusa certificado vencido.
3. Cifra o PFX e a senha com **AES-256-GCM** (`CERT_MASTER_KEY`, guardada fora do banco) e grava em `cert_certificados`.
4. Na emissão, decifra **só em memória** para montar o `https.Agent` do mTLS.

Associe o certificado à empresa com `certificadoId` em `POST /empresas` ou `POST /lotes`.

## API (`/api/certidoes`, exige `x-token`)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/certificados` | upload do A1 (admin) |
| GET | `/certificados` | lista os certificados (sem PFX/senha) |
| POST | `/empresas` | cadastra/atualiza `{cnpj, razaoSocial, uf, municipioIbge, certificadoId, tipos}` |
| GET | `/empresas` | carteira ativa |
| POST | `/lotes` | `{cnpjs:[...]}` ou `{empresas:[...]}` + `tipos?` → 202 `{loteId}` |
| GET | `/lotes/:id` | status + certidões com `pdf_url` pré-assinada (TTL `S3_SIGNED_URL_TTL`) |
| GET | `/alertas` | alertas abertos (`?todos=1` para todos) |
| POST | `/alertas/:id/lido` | marca como lido |
| POST | `/raio-x/executar` | roda a varredura agora (admin) |

## Rodando

```bash
docker compose up -d                 # Postgres + Redis + MinIO
cp .env.example .env                 # preencha Serpro, Infosimples, CERT_MASTER_KEY, S3
npm start                            # API (cria as tabelas cert_*)
npm run worker:certidoes             # filas + agendamento do Raio X
npm test
```

Em produção (Render/Railway), crie um **segundo serviço** com `npm run worker:certidoes`, o mesmo
`DATABASE_URL` e um Redis gerenciado (`REDIS_URL`, com política `noeviction`).

## Conferir antes de ir para produção

Este ambiente não tinha acesso às documentações do Serpro e da Infosimples. Os pontos abaixo estão
isolados para ajuste rápido:

* **Serpro Consulta CND:** campos `TipoContribuinte`, `CodigoIdentificacao` (padrão `9001`), `GerarCertidaoPdf`
  e o formato da resposta (`Certidao.DocumentoPdf`, `CodigoControle`, `DataValidade`). Ficam em
  `federal/serproCndAdapter.js` → `montarRequisicao()` / `interpretarResposta()`.
* **Infosimples:** os slugs dos serviços (`broker/catalogo.js`, sobrescrevíveis via `BROKER_CATALOGO_JSON`), a tabela de
  códigos 6xx (`broker/infosimplesClient.js`) e os nomes de campo de cada serviço (`broker/brokerAdapter.js` → `CAMPOS`).
* **Integra Contador:** o mTLS com o A1 do cliente está pronto, mas o Serpro pode exigir procuração eletrônica
  quando o contratante (sua empresa) consulta em nome de terceiros.

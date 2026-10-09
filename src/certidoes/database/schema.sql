-- Emissor de Certidões + Raio X Fiscal — PostgreSQL
-- Idempotente: pode rodar a cada boot (initCertidoesSchema).

-- Certificados Digitais A1 (.pfx) — armazenados CIFRADOS (AES-256-GCM, chave mestra fora do banco)
CREATE TABLE IF NOT EXISTS cert_certificados (
  id                 SERIAL PRIMARY KEY,
  titular_cnpj       VARCHAR(14) NOT NULL,
  titular_nome       TEXT,
  emissor            TEXT,
  valido_de          TIMESTAMPTZ NOT NULL,
  valido_ate         TIMESTAMPTZ NOT NULL,
  fingerprint_sha256 CHAR(64) UNIQUE NOT NULL,
  pfx_cifrado        BYTEA NOT NULL,   -- iv(12) | tag(16) | ciphertext
  senha_cifrada      BYTEA NOT NULL,
  ativo              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cert_certificados_titular ON cert_certificados (titular_cnpj) WHERE ativo;

-- Carteira de CNPJs monitorados
CREATE TABLE IF NOT EXISTS cert_empresas (
  id              SERIAL PRIMARY KEY,
  cnpj            VARCHAR(14) UNIQUE NOT NULL,
  razao_social    TEXT,
  uf              CHAR(2),
  municipio_ibge  CHAR(7),
  tipos           TEXT[] NOT NULL DEFAULT ARRAY['federal','fgts','trabalhista','estadual','municipal','simples'],
  certificado_id  INTEGER REFERENCES cert_certificados(id) ON DELETE SET NULL,
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Um lote = um disparo (manual via API ou Raio X da madrugada) com N CNPJs × M tipos
CREATE TABLE IF NOT EXISTS cert_lotes (
  id             UUID PRIMARY KEY,
  origem         TEXT NOT NULL DEFAULT 'api',          -- 'api' | 'raio_x'
  total_cnpjs    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'PROCESSANDO',  -- PROCESSANDO | CONCLUIDO
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalizado_em  TIMESTAMPTZ
);

-- LOG de cada certidão emitida/tentada
CREATE TABLE IF NOT EXISTS cert_certidoes (
  id              SERIAL PRIMARY KEY,
  lote_id         UUID REFERENCES cert_lotes(id) ON DELETE SET NULL,
  cnpj            VARCHAR(14) NOT NULL,
  tipo            TEXT NOT NULL,       -- federal | fgts | trabalhista | estadual | municipal | simples
  status          TEXT NOT NULL,       -- EMITIDA | ERRO
  situacao        TEXT,                -- NEGATIVA | POSITIVA_COM_EFEITO_NEGATIVA | POSITIVA | INDISPONIVEL
  numero          TEXT,
  pdf_bucket      TEXT,
  pdf_key         TEXT,                -- link do PDF = URL pré-assinada gerada a partir desta chave
  pdf_sha256      CHAR(64),
  pdf_url_origem  TEXT,                -- URL devolvida pelo broker (expira; o PDF definitivo está no S3)
  emitida_em      TIMESTAMPTZ,
  valida_ate      TIMESTAMPTZ,
  fonte           TEXT,                -- serpro:consulta-cnd | infosimples:caixa/regularidade ...
  tentativas      INTEGER NOT NULL DEFAULT 1,
  erro            TEXT,
  raw             JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cert_certidoes_cnpj_tipo ON cert_certidoes (cnpj, tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cert_certidoes_lote ON cert_certidoes (lote_id);
CREATE INDEX IF NOT EXISTS idx_cert_certidoes_vencimento ON cert_certidoes (valida_ate) WHERE status = 'EMITIDA';

-- Alertas do Raio X Fiscal (o que mudou desde a última varredura)
CREATE TABLE IF NOT EXISTS cert_alertas (
  id           SERIAL PRIMARY KEY,
  cnpj         VARCHAR(14) NOT NULL,
  tipo         TEXT NOT NULL,
  alerta       TEXT NOT NULL,   -- NOVA_PENDENCIA | REGULARIZADA | VENCIMENTO_PROXIMO | VENCIDA | EXCLUSAO_SIMPLES | FALHA_EMISSAO | CERTIFICADO_VENCENDO
  severidade   TEXT NOT NULL DEFAULT 'media',  -- alta | media | baixa
  detalhe      TEXT,
  certidao_id  INTEGER REFERENCES cert_certidoes(id) ON DELETE SET NULL,
  lido         BOOLEAN NOT NULL DEFAULT FALSE,
  dia          DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cert_alertas_abertos ON cert_alertas (created_at DESC) WHERE NOT lido;
-- Evita alerta duplicado do mesmo tipo/CNPJ no mesmo dia
CREATE UNIQUE INDEX IF NOT EXISTS uq_cert_alertas_dia ON cert_alertas (cnpj, tipo, alerta, dia);

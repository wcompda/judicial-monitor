const config = require('../config');
const { SerproCndAdapter } = require('../federal/serproCndAdapter');
const { InfosimplesClient } = require('../broker/infosimplesClient');
const { BrokerAdapter } = require('../broker/brokerAdapter');
const { CertificadoVault } = require('../certificados/certificadoVault');
const { TransientError, PermanentError } = require('../core/errors');

// Tipos de certidão e a fila que os processa.
// federal → API oficial do Serpro (fila própria, rate limit do contrato Serpro)
// demais  → Broker (fila própria, rate limit do contrato do broker)
const TIPOS = Object.freeze({
  federal: 'federal',
  fgts: 'broker',
  trabalhista: 'broker',
  estadual: 'broker',
  municipal: 'broker',
  simples: 'broker',
});

// Serpro primeiro; se ele estiver instável (erro transitório), tenta o broker na mesma tentativa.
// Erro permanente do Serpro (ex: credencial) também cai no broker, se houver token configurado.
class ComFallback {
  constructor(primario, reserva) {
    this.nome = `${primario.nome}|${reserva?.nome}`;
    this.primario = primario;
    this.reserva = reserva;
  }

  async emitir(entrada) {
    try {
      return await this.primario.emitir(entrada);
    } catch (err) {
      if (!this.reserva || !(err instanceof TransientError || err instanceof PermanentError)) throw err;
      if (err instanceof PermanentError && err.code === 'CNPJ_INVALIDO') throw err;
      try {
        const r = await this.reserva.emitir(entrada);
        return { ...r, raw: { ...r.raw, fallbackDe: `${this.primario.nome}: ${err.message}` } };
      } catch {
        throw err; // reporta o erro do primário, que é a fonte "oficial"
      }
    }
  }
}

let cache;
function criarAdapters(cfg = config, deps = {}) {
  const vault = deps.vault || new CertificadoVault(cfg.vault);
  const brokerClient = deps.brokerClient || new InfosimplesClient(cfg.broker);
  const broker = (tipo) => new BrokerAdapter(tipo, { client: brokerClient });
  const serpro = new SerproCndAdapter(cfg.serpro, { vault });

  return {
    federal: cfg.broker.infosimplesToken ? new ComFallback(serpro, broker('federal')) : serpro,
    fgts: broker('fgts'),
    trabalhista: broker('trabalhista'),
    estadual: broker('estadual'),
    municipal: broker('municipal'),
    simples: broker('simples'),
  };
}

function getAdapter(tipo) {
  if (!cache) cache = criarAdapters();
  const a = cache[tipo];
  if (!a) throw new PermanentError(`Sem adapter para o tipo "${tipo}"`);
  return a;
}

module.exports = { TIPOS, getAdapter, criarAdapters, ComFallback };

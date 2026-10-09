const { PermanentError } = require('./errors');

const somenteDigitos = (v) => String(v || '').replace(/\D/g, '');

function cnpjValido(cnpj) {
  const c = somenteDigitos(cnpj);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const d of base) {
      soma += Number(d) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

function normalizarCnpj(cnpj) {
  const c = somenteDigitos(cnpj);
  if (!cnpjValido(c)) throw new PermanentError(`CNPJ inválido: ${cnpj}`, { code: 'CNPJ_INVALIDO' });
  return c;
}

const formatarCnpj = (c) => somenteDigitos(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

module.exports = { cnpjValido, normalizarCnpj, formatarCnpj, somenteDigitos };

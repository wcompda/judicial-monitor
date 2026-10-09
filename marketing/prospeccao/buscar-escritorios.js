/**
 * Prospecção de escritórios de advocacia (B2B) — Google Places API (oficial)
 *
 * Gera duas planilhas em marketing/prospeccao/saida/:
 *   escritorios.csv   — lista completa (nome, especialidade, telefone, site, e-mail, endereço, nota)
 *   meta-publico.csv  — formato de upload do Público Personalizado do Meta Ads
 *
 * O e-mail não vem do Google: é lido na página inicial e na página de contato
 * do site do próprio escritório (contato comercial publicado por ele).
 *
 * Uso:
 *   GOOGLE_PLACES_API_KEY=xxx node marketing/prospeccao/buscar-escritorios.js
 *   GOOGLE_PLACES_API_KEY=xxx node marketing/prospeccao/buscar-escritorios.js --cidades "Uberlândia MG,Uberaba MG"
 *   ... --sem-email   (pula a leitura dos sites)
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SAIDA = path.join(__dirname, 'saida');

const CIDADES_PADRAO = ['Uberlândia MG'];
const BUSCAS = [
  'escritório de advocacia',
  'advogado trabalhista',
  'advogado previdenciário',
  'advogado cível',
  'advogado criminal',
  'advogado de família',
  'advogado tributário',
  'advogado imobiliário',
];

const args = process.argv.slice(2);
const argValor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
};
const cidades = (argValor('--cidades') || '').split(',').map(s => s.trim()).filter(Boolean);
const buscarEmails = !args.includes('--sem-email');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function buscarPlaces(textQuery) {
  const resultados = [];
  let pageToken = null;
  do {
    const { data } = await axios.post(
      'https://places.googleapis.com/v1/places:searchText',
      { textQuery, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20, ...(pageToken && { pageToken }) },
      {
        headers: {
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': [
            'places.id', 'places.displayName', 'places.primaryTypeDisplayName',
            'places.formattedAddress', 'places.addressComponents',
            'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
            'places.websiteUri', 'places.rating', 'places.userRatingCount',
            'places.businessStatus', 'nextPageToken',
          ].join(','),
        },
        timeout: 20000,
      }
    );
    resultados.push(...(data.places || []));
    pageToken = data.nextPageToken;
    if (pageToken) await sleep(1500);
  } while (pageToken);
  return resultados;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_IGNORAR = /\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|example\.|seudominio|domain\.com|@email\.com/i;

async function emailsDoSite(site) {
  const encontrados = new Set();
  const base = site.replace(/\/+$/, '');
  for (const url of [base, base + '/contato', base + '/contact']) {
    try {
      const { data } = await axios.get(url, {
        timeout: 10000,
        maxRedirects: 3,
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0 (JudicialMonitor prospeccao)' },
      });
      for (const e of String(data).match(EMAIL_RE) || []) {
        if (!EMAIL_IGNORAR.test(e)) encontrados.add(e.toLowerCase());
      }
      if (encontrados.size) break;
    } catch (_) { /* página inexistente ou bloqueada */ }
  }
  return [...encontrados];
}

function componente(place, tipo, curto = false) {
  const c = (place.addressComponents || []).find(a => (a.types || []).includes(tipo));
  return c ? (curto ? c.shortText : c.longText) : '';
}

const csvCampo = (v) => {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const escreverCsv = (arquivo, cabecalho, linhas) => {
  const conteudo = [cabecalho, ...linhas].map(l => l.map(csvCampo).join(',')).join('\n');
  fs.writeFileSync(arquivo, '﻿' + conteudo, 'utf8');
};

async function main() {
  if (!API_KEY) {
    console.error('Defina GOOGLE_PLACES_API_KEY (Google Cloud → APIs → Places API (New)).');
    process.exit(1);
  }
  fs.mkdirSync(SAIDA, { recursive: true });

  const porId = new Map();
  for (const cidade of (cidades.length ? cidades : CIDADES_PADRAO)) {
    for (const busca of BUSCAS) {
      const q = `${busca} em ${cidade}`;
      try {
        const places = await buscarPlaces(q);
        let novos = 0;
        for (const p of places) {
          if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
          if (!porId.has(p.id)) { porId.set(p.id, { ...p, _busca: busca, _cidadeBusca: cidade }); novos++; }
        }
        console.log(`[PLACES] "${q}": ${places.length} resultados, ${novos} novos`);
      } catch (err) {
        console.error(`[PLACES] Erro em "${q}":`, err.response?.data?.error?.message || err.message);
      }
    }
  }

  const escritorios = [...porId.values()];
  console.log(`\n${escritorios.length} escritórios únicos.`);

  if (buscarEmails) {
    let i = 0;
    for (const e of escritorios) {
      i++;
      if (!e.websiteUri || /instagram\.com|facebook\.com|wa\.me|linktr\.ee/i.test(e.websiteUri)) continue;
      e._emails = await emailsDoSite(e.websiteUri);
      if (i % 20 === 0) console.log(`[SITES] ${i}/${escritorios.length} verificados`);
    }
    console.log(`[SITES] ${escritorios.filter(e => e._emails?.length).length} com e-mail encontrado.`);
  }

  escreverCsv(
    path.join(SAIDA, 'escritorios.csv'),
    ['nome', 'especialidade', 'busca', 'telefone', 'email', 'site', 'endereco', 'cidade', 'uf', 'nota', 'avaliacoes', 'google_place_id'],
    escritorios.map(e => [
      e.displayName?.text, e.primaryTypeDisplayName?.text, e._busca,
      e.nationalPhoneNumber, (e._emails || []).join(' '), e.websiteUri, e.formattedAddress,
      componente(e, 'administrative_area_level_2'), componente(e, 'administrative_area_level_1', true),
      e.rating, e.userRatingCount, e.id,
    ])
  );

  // Meta Ads: telefone em E.164 sem "+", e-mail, cidade, UF, país. O Meta faz o hash no upload.
  escreverCsv(
    path.join(SAIDA, 'meta-publico.csv'),
    ['phone', 'email', 'ct', 'st', 'country'],
    escritorios
      .filter(e => e.internationalPhoneNumber || e._emails?.length)
      .map(e => [
        (e.internationalPhoneNumber || '').replace(/\D/g, ''),
        (e._emails || [])[0] || '',
        componente(e, 'administrative_area_level_2').toLowerCase(),
        componente(e, 'administrative_area_level_1', true).toLowerCase(),
        'br',
      ])
  );

  console.log(`\nPlanilhas salvas em ${SAIDA}`);
}

main();

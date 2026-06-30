const axios = require('axios');

const PROMPT = `Você é um especialista em ler telas de sistemas judiciais brasileiros (PJe, eSAJ, eproc, JusBrasil, etc).
Analise a imagem (print de tela) e extraia os dados do processo judicial nela contido.

Responda APENAS com um JSON válido, sem texto adicional, no formato:
{
  "numero": "0000000-00.0000.0.00.0000",
  "tribunal": "TJMG",
  "classe": "...",
  "assunto": "...",
  "situacao": "...",
  "partes": [{"polo":"ATIVO","nome":"..."},{"polo":"PASSIVO","nome":"..."}],
  "valor_causa": 0,
  "ultima_movimentacao": "...",
  "data_distribuicao": "AAAA-MM-DD"
}

Se algum campo não estiver visível na imagem, use null. O campo "tribunal" deve ser a sigla (TJMG, TJSP, TRF1, STJ, etc). Se não conseguir identificar um número de processo válido na imagem, responda apenas: {"erro":"numero_nao_encontrado"}`;

async function extrairProcessoDeImagem(base64Image, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  const resp = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
        { type: 'text', text: PROMPT }
      ]
    }]
  }, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }
  });

  const texto = resp.data.content[0].text.trim();
  const jsonMatch = texto.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('IA não retornou JSON válido');
  return JSON.parse(jsonMatch[0]);
}

module.exports = { extrairProcessoDeImagem };

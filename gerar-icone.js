// Gera PNGs do ícone W azul sem dependências externas
const fs = require('fs');
const zlib = require('zlib');

function criarPNG(tamanho, nomeArquivo) {
  const W = tamanho, H = tamanho;

  // Pixels RGBA
  const pixels = Buffer.alloc(W * H * 4);

  const cx = W / 2, cy = H / 2;
  const r = W / 2;
  const raioExterno = r;
  const raioArredondado = r * 0.18; // cantos arredondados

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;

      // Verificar se está dentro do retângulo arredondado
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const rx = W / 2 - raioArredondado;
      const ry = H / 2 - raioArredondado;

      let dentro = false;
      if (dx <= rx || dy <= ry) {
        dentro = (dx <= W/2 && dy <= H/2);
      } else {
        const cornerDx = dx - rx;
        const cornerDy = dy - ry;
        dentro = (cornerDx * cornerDx + cornerDy * cornerDy) <= (raioArredondado * raioArredondado);
      }

      if (!dentro) {
        // Transparente
        pixels[idx] = 0; pixels[idx+1] = 0; pixels[idx+2] = 0; pixels[idx+3] = 0;
        continue;
      }

      // Fundo azul #1e40af
      let R = 0x1e, G = 0x40, B = 0xaf, A = 255;

      // Desenhar o W branco
      // W ocupa de 15% a 85% da largura, 20% a 80% da altura
      const wx1 = W * 0.12, wx2 = W * 0.88;
      const wy1 = H * 0.18, wy2 = H * 0.82;
      const ww = wx2 - wx1;
      const wh = wy2 - wy1;
      const thick = W * 0.11; // espessura das barras

      // W é formado por 4 barras diagonais
      // Barra 1: esquerda descendo (wx1,wy1) -> (wx1+ww*0.25, wy2)
      // Barra 2: centro subindo (wx1+ww*0.25, wy2) -> (cx, wy1+wh*0.45)
      // Barra 3: centro descendo (cx, wy1+wh*0.45) -> (wx1+ww*0.75, wy2)
      // Barra 4: direita subindo (wx1+ww*0.75, wy2) -> (wx2, wy1)

      function distPtoSeg(px, py, ax, ay, bx, by) {
        const abx = bx - ax, aby = by - ay;
        const apx = px - ax, apy = py - ay;
        const t = Math.max(0, Math.min(1, (apx*abx + apy*aby) / (abx*abx + aby*aby)));
        const closestX = ax + t * abx, closestY = ay + t * aby;
        return Math.sqrt((px - closestX)**2 + (py - closestY)**2);
      }

      const p1x = wx1, p1y = wy1;
      const p2x = wx1 + ww * 0.26, p2y = wy2;
      const p3x = W * 0.5, p3y = wy1 + wh * 0.42;
      const p4x = wx1 + ww * 0.74, p4y = wy2;
      const p5x = wx2, p5y = wy1;

      const d1 = distPtoSeg(x, y, p1x, p1y, p2x, p2y);
      const d2 = distPtoSeg(x, y, p2x, p2y, p3x, p3y);
      const d3 = distPtoSeg(x, y, p3x, p3y, p4x, p4y);
      const d4 = distPtoSeg(x, y, p4x, p4y, p5x, p5y);

      const minD = Math.min(d1, d2, d3, d4);

      if (minD < thick / 2) {
        // Anti-aliasing
        const aa = Math.max(0, Math.min(1, (thick / 2 - minD)));
        R = Math.round(R * (1 - aa) + 255 * aa);
        G = Math.round(G * (1 - aa) + 255 * aa);
        B = Math.round(B * (1 - aa) + 255 * aa);
      }

      pixels[idx] = R; pixels[idx+1] = G; pixels[idx+2] = B; pixels[idx+3] = A;
    }
  }

  // Montar PNG
  function adler32(buf) {
    let s1 = 1, s2 = 0;
    for (const b of buf) { s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521; }
    return (s2 << 16) | s1;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([t, data]);
    const crcB = Buffer.alloc(4); crcB.writeInt32BE(calcCRC(crcBuf));
    return Buffer.concat([len, t, data, crcB]);
  }

  // CRC32
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function calcCRC(buf) {
    let crc = 0xFFFFFFFF;
    for (const b of buf) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) | 0;
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT: filtrar e comprimir
  const rawRows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(W * 4 + 1);
    row[0] = 0; // filter type None
    pixels.copy(row, 1, y * W * 4, (y + 1) * W * 4);
    rawRows.push(row);
  }
  const raw = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(raw, { level: 6 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  const png = Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
  fs.writeFileSync(nomeArquivo, png);
  console.log('Criado:', nomeArquivo, png.length, 'bytes');
}

criarPNG(192, 'public/icon-192.png');
criarPNG(512, 'public/icon-512.png');
console.log('Ícones gerados!');

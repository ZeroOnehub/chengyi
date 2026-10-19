// 程序生成的写实材质贴图：釉面（积釉、出筋、开片、青花 / 刻花）、拉坯纹、剪纸（锯齿、月牙、团花）、纸纤维、布料与木纹。
// 全部用 Canvas 2D 绘制，固定随机种子：同一件作品每次生成的贴图完全一致。

import * as THREE from 'three';

// —— 工具 ——
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashString = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function toTexture(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  else t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// 低频斑驳：小尺寸随机图放大，得到柔和的不均匀
function blotches(w, h, cells, seed, smooth = true) {
  const r = rng(seed);
  const small = canvas(cells, Math.max(2, Math.round(cells * h / w)));
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(small.width, small.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.round(r() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const big = canvas(w, h);
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = smooth;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  return big;
}

const hex = (c, a = 1) => {
  const v = new THREE.Color(c);
  return `rgba(${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)},${a})`;
};

// 在水平方向首尾相接的贴图上重复绘制（器身一圈）
function wrapDraw(W, fn) {
  fn(0);
  fn(-W);
  fn(W);
}

// ======================================================================
// 瓷器
// ======================================================================

// 釉色：fired 为烧成后，pool 为积釉处，edge 为出筋（釉薄处）
export const GLAZES = {
  jade: { fired: '#a7c4ae', pool: '#6e9884', edge: '#dbe7d8', raw: '#c9d4c6', style: 'carve', crackle: true, rough: 0.16 },
  blue: { fired: '#203d6b', pool: '#132648', edge: '#6f8db8', raw: '#aeb8c6', style: 'lift', crackle: false, rough: 0.12 },
  white: { fired: '#e8eae2', pool: '#c9d6d2', edge: '#f6f6f0', raw: '#dcd8d0', style: 'cobalt', crackle: false, rough: 0.1 },
  clay: { fired: '#a86f45', pool: '#6e4026', edge: '#d7a476', raw: '#d3bba1', style: 'incise', crackle: false, rough: 0.34 },
  brown: { fired: '#735545', pool: '#4e352b', edge: '#a07d62', raw: '#b6a28e', style: 'incise', crackle: false, rough: 0.65 },
  charcoal: { fired: '#444843', pool: '#242923', edge: '#747b70', raw: '#8b9087', style: 'carve', crackle: false, rough: 0.32 },
};

const CLAY = { wet: '#9c9186', raw: '#cfc6b9', fired: '#e6dccb', flash: '#c99c72' };

// 纹样的笔色
function inkFor(style, step) {
  if (step < 2) return { line: '#4d535c', wash: 'rgba(77,83,92,0.35)' };
  switch (style) {
    case 'cobalt': return { line: '#122c75', wash: 'rgba(20,48,140,0.72)' };
    case 'carve': return { line: 'rgba(70,115,95,0.85)', wash: 'rgba(80,125,105,0.28)' };
    case 'lift': return { line: 'rgba(130,160,200,0.8)', wash: 'rgba(120,150,195,0.25)' };
    default: return { line: 'rgba(90,50,25,0.85)', wash: 'rgba(100,60,30,0.25)' };
  }
}

// —— 纹样：缠枝花卉 ——
function peony(ctx, x, y, s, ink, r) {
  ctx.save();
  ctx.translate(x, y);
  // 外层花瓣：分水晕染 + 勾线
  for (let layer = 0; layer < 3; layer++) {
    const n = 7 - layer;
    const rad = s * (1 - layer * 0.28);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + layer * 0.4 + r() * 0.15;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-rad * 0.55, -rad * 0.3, -rad * 0.5, -rad * 1.05, 0, -rad);
      ctx.bezierCurveTo(rad * 0.5, -rad * 1.05, rad * 0.55, -rad * 0.3, 0, 0);
      ctx.fillStyle = ink.wash;
      ctx.fill();
      ctx.lineWidth = Math.max(1.2, s * 0.045);
      ctx.strokeStyle = ink.line;
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = ink.line;
  ctx.fill();
  ctx.restore();
}

function leaf(ctx, x, y, len, angle, ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0);
  ctx.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0);
  ctx.fillStyle = ink.wash;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = ink.line;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len * 0.85, 0);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function scrollBand(ctx, W, y0, y1, count, ink, r) {
  const mid = (y0 + y1) / 2, amp = (y1 - y0) * 0.24, period = W / count;
  wrapDraw(W, off => {
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = mid + Math.sin((x / period) * Math.PI * 2) * amp;
      x ? ctx.lineTo(x + off, y) : ctx.moveTo(x + off, y);
    }
    ctx.lineWidth = Math.max(2.5, (y1 - y0) * 0.035);
    ctx.strokeStyle = ink.line;
    ctx.stroke();
    for (let i = 0; i < count; i++) {
      const cx = i * period + period * 0.25 + off;
      const cy = mid - amp * 0.95;
      const bx = i * period + period * 0.75 + off;
      const by = mid + amp * 0.95;
      const s = (y1 - y0) * 0.36;
      peony(ctx, cx, cy, s, ink, r);
      peony(ctx, bx, by, s * 0.92, ink, r);
      for (let k = 0; k < 6; k++) {
        const lx = i * period + period * (0.02 + k * 0.165) + off;
        const ly = mid + Math.sin(((lx - off) / period) * Math.PI * 2) * amp;
        leaf(ctx, lx, ly, (y1 - y0) * 0.22, (k % 2 ? 1 : -1) * (0.8 + r() * 0.4) - 0.3, ink);
        // 卷须
        ctx.beginPath();
        const dir = k % 2 ? 1 : -1;
        for (let t = 0; t < Math.PI * 2.2; t += 0.15) {
          const rr = (y1 - y0) * 0.07 * (1 - t / 8);
          const px = lx + 6 + Math.cos(t) * rr, py = ly + dir * ((y1 - y0) * 0.1 + Math.sin(t) * rr);
          t ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  });
}

// —— 纹样：如意云 ——
function ruyi(ctx, x, y, s, ink) {
  ctx.save();
  ctx.translate(x, y);
  const curl = (cx, cy, rad, dir) => {
    ctx.beginPath();
    for (let t = 0; t <= Math.PI * 2.6; t += 0.08) {
      const rr = rad * (1 - t / (Math.PI * 3.2));
      const px = cx + Math.cos(t * dir) * rr, py = cy + Math.sin(t * dir) * rr;
      t ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  };
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.15, s * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = ink.wash;
  ctx.fill();
  ctx.lineWidth = Math.max(1.6, s * 0.07);
  ctx.strokeStyle = ink.line;
  curl(0, -s * 0.05, s * 0.5, 1);
  curl(-s * 0.72, s * 0.12, s * 0.34, -1);
  curl(s * 0.72, s * 0.12, s * 0.34, 1);
  ctx.beginPath();
  ctx.moveTo(-s * 1.1, s * 0.3);
  ctx.bezierCurveTo(-s * 1.6, s * 0.7, -s * 2.2, s * 0.2, -s * 2.6, s * 0.55);
  ctx.stroke();
  ctx.restore();
}

function cloudBand(ctx, W, y0, y1, count, ink) {
  const h = y1 - y0;
  wrapDraw(W, off => {
    for (let i = 0; i < count; i++) {
      const x = (i + 0.5) * (W / count) + off;
      ruyi(ctx, x, y0 + h * (i % 2 ? 0.6 : 0.42), h * 0.3, ink);
    }
  });
}

// —— 纹样：回纹 ——
function fretBand(ctx, W, y0, y1, ink) {
  const h = y1 - y0;
  const unit = h * 1.1;
  const count = Math.max(6, Math.round(W / unit));
  const u = W / count;
  ctx.lineWidth = Math.max(2, h * 0.09);
  ctx.strokeStyle = ink.line;
  ctx.lineCap = 'square';
  wrapDraw(W, off => {
    for (let i = 0; i < count; i++) {
      const x = i * u + off, p = h * 0.14;
      ctx.beginPath();
      ctx.moveTo(x, y1 - p);
      ctx.lineTo(x, y0 + p);
      ctx.lineTo(x + u * 0.8, y0 + p);
      ctx.lineTo(x + u * 0.8, y1 - p * 2.6);
      ctx.lineTo(x + u * 0.3, y1 - p * 2.6);
      ctx.lineTo(x + u * 0.3, y0 + p * 2.6);
      ctx.lineTo(x + u * 0.55, y0 + p * 2.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y1 - p);
      ctx.lineTo(x + u, y1 - p);
      ctx.stroke();
    }
  });
  ctx.lineCap = 'butt';
}

// 双弦纹
function rules(ctx, W, y, ink, gap = 7) {
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = 1.8;
  for (const dy of [-gap / 2, gap / 2]) {
    ctx.beginPath();
    ctx.moveTo(0, y + dy);
    ctx.lineTo(W, y + dy);
    ctx.stroke();
  }
}

// 莲瓣：近底足一圈
function lotusBand(ctx, W, y0, y1, count, ink) {
  const u = W / count, h = y1 - y0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = ink.line;
  wrapDraw(W, off => {
    for (let i = 0; i < count; i++) {
      const x = i * u + off;
      ctx.beginPath();
      ctx.moveTo(x + u * 0.08, y1);
      ctx.lineTo(x + u * 0.08, y0 + h * 0.35);
      ctx.quadraticCurveTo(x + u * 0.5, y0 - h * 0.15, x + u * 0.92, y0 + h * 0.35);
      ctx.lineTo(x + u * 0.92, y1);
      ctx.fillStyle = ink.wash;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + u * 0.25, y1);
      ctx.lineTo(x + u * 0.25, y0 + h * 0.5);
      ctx.quadraticCurveTo(x + u * 0.5, y0 + h * 0.18, x + u * 0.75, y0 + h * 0.5);
      ctx.lineTo(x + u * 0.75, y1);
      ctx.stroke();
    }
  });
}

// 蕉叶：瓶颈一圈
function plantainBand(ctx, W, y0, y1, count, ink) {
  const u = W / count;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = ink.line;
  wrapDraw(W, off => {
    for (let i = 0; i < count; i++) {
      const x = i * u + off;
      ctx.beginPath();
      ctx.moveTo(x + u * 0.1, y1);
      ctx.quadraticCurveTo(x + u * 0.1, y0 + (y1 - y0) * 0.3, x + u * 0.5, y0);
      ctx.quadraticCurveTo(x + u * 0.9, y0 + (y1 - y0) * 0.3, x + u * 0.9, y1);
      ctx.fillStyle = ink.wash;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + u * 0.5, y1);
      ctx.lineTo(x + u * 0.5, y0 + 4);
      ctx.stroke();
    }
  });
}

// 开片：冰裂状细纹
function crackle(ctx, x0, y0, x1, y1, r, alpha) {
  ctx.strokeStyle = `rgba(60,70,60,${alpha})`;
  ctx.lineWidth = 0.9;
  const cells = 260;
  for (let i = 0; i < cells; i++) {
    let x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(r() * 4);
    let a = r() * Math.PI * 2;
    for (let k = 0; k < segs; k++) {
      a += (r() - 0.5) * 1.6;
      x += Math.cos(a) * (14 + r() * 30);
      y += Math.sin(a) * (10 + r() * 22);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// 在器身某一圈画纹饰带：按该处周长校正横向比例，花纹贴到器物上才不会被拉扁
function band(target, W, H, layout, range, radius, draw, margin = 28) {
  const Y = v => (1 - v) * H;
  const y0 = Y(range[1]), y1 = Y(range[0]);
  const aspect = (W / (2 * Math.PI * radius)) / (H / layout.len);
  const bw = Math.max(64, Math.round(W / aspect));
  const bh = Math.round(y1 - y0 + margin * 2);
  const off = canvas(bw, bh);
  draw(off.getContext('2d'), bw, margin, margin + (y1 - y0));
  target.drawImage(off, 0, 0, bw, bh, 0, y0 - margin, W, bh);
}

function paintPattern(ctx, W, H, layout, state, ink, r) {
  const R = layout.radii;
  const per = state.shape === 'bowl' ? 5 : 4;
  const main = (fn) => band(ctx, W, H, layout, layout.band, R.band, fn);
  if (state.pattern === 'flower') {
    main((c, bw, y0, y1) => { rules(c, bw, y0 - 12, ink); rules(c, bw, y1 + 12, ink); scrollBand(c, bw, y0, y1, per, ink, r); });
    if (layout.lower) band(ctx, W, H, layout, layout.lower, R.lower, (c, bw, y0, y1) => lotusBand(c, bw, y0, y1, 9, ink));
    if (layout.neck) band(ctx, W, H, layout, layout.neck, R.neck, (c, bw, y0, y1) => plantainBand(c, bw, y0, y1, 7, ink));
  } else if (state.pattern === 'cloud') {
    main((c, bw, y0, y1) => { rules(c, bw, y0 - 10, ink); rules(c, bw, y1 + 10, ink); cloudBand(c, bw, y0, y1, per + 1, ink); });
    if (layout.neck) band(ctx, W, H, layout, layout.neck, R.neck, (c, bw, y0, y1) => rules(c, bw, (y0 + y1) / 2, ink, 9));
  } else {
    main((c, bw, y0, y1) => {
      const h = (y1 - y0) * 0.42, m = (y0 + y1) / 2;
      rules(c, bw, m - h / 2 - 10, ink);
      fretBand(c, bw, m - h / 2, m + h / 2, ink);
      rules(c, bw, m + h / 2 + 10, ink);
    });
    if (layout.lower) band(ctx, W, H, layout, layout.lower, R.lower, (c, bw, y0, y1) => fretBand(c, bw, y0 + (y1 - y0) * 0.3, y1 - (y1 - y0) * 0.1, ink));
  }
}

// layout：器身各段在贴图 v 方向上的位置（0 = 足底，1 = 内底），由 craftmesh 计算
export function ceramicMaps(state, layout) {
  const W = 2048, H = 1024;
  const glaze = GLAZES[state.color] || GLAZES.jade;
  const step = state.step;
  const r = rng(hashString(`${state.shape}|${state.color}|${state.pattern}|${step}`));
  const Y = v => (1 - v) * H;     // 贴图 v → 画布 y

  // —— 颜色 ——
  const color = canvas(W, H);
  const ctx = color.getContext('2d');
  const body = step === 0 ? CLAY.wet : step === 1 ? glaze.raw : glaze.fired;
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, W, H);

  // 积釉与出筋：釉在下腹与内底聚厚，在口沿与转折处变薄
  if (step === 2) {
    const g = ctx.createLinearGradient(0, Y(layout.glazeEdge + 0.12), 0, Y(layout.glazeEdge));
    g.addColorStop(0, hex(glaze.pool, 0));
    g.addColorStop(1, hex(glaze.pool, 0.75));
    ctx.fillStyle = g;
    ctx.fillRect(0, Y(layout.glazeEdge + 0.12), W, Y(layout.glazeEdge) - Y(layout.glazeEdge + 0.12));
    const rim = ctx.createLinearGradient(0, Y(layout.rimStart - 0.035), 0, Y(layout.rimStart + 0.01));
    rim.addColorStop(0, hex(glaze.edge, 0));
    rim.addColorStop(1, hex(glaze.edge, 0.9));
    ctx.fillStyle = rim;
    ctx.fillRect(0, Y(layout.rimEnd), W, Y(layout.rimStart - 0.035) - Y(layout.rimEnd));
    ctx.fillStyle = hex(glaze.pool, 0.35);
    ctx.fillRect(0, 0, W, Y(layout.rimEnd + 0.02));
    // 釉的流淌：细长的竖向深浅
    ctx.save();
    ctx.filter = 'blur(6px)';
    for (let i = 0; i < 90; i++) {
      const x = r() * W, len = 40 + r() * 160, y = Y(layout.glazeEdge + 0.02 + r() * 0.4);
      const gr = ctx.createLinearGradient(0, y - len, 0, y);
      gr.addColorStop(0, hex(glaze.pool, 0));
      gr.addColorStop(1, hex(glaze.pool, 0.06 + r() * 0.08));
      ctx.fillStyle = gr;
      ctx.fillRect(x, y - len, 10 + r() * 22, len);
    }
    ctx.restore();
  }
  // 整体的不均匀
  const mott = blotches(W, H, 48, hashString(state.color + step));
  ctx.globalAlpha = step === 0 ? 0.16 : step === 1 ? 0.2 : 0.1;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(mott, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // —— 纹样 ——
  const motif = step > 0 && state.pattern !== 'plain' ? canvas(W, H) : null;
  if (motif) {
    paintPattern(motif.getContext('2d'), W, H, layout, state, inkFor(glaze.style, step), r);
    ctx.drawImage(motif, 0, 0);
  }

  // 开片
  if (step === 2 && glaze.crackle) crackle(ctx, 0, Y(layout.rimStart), W, Y(layout.glazeEdge), r, 0.13);

  // 杂质黑点
  const specks = step === 0 ? 0 : 140;
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = `rgba(50,40,30,${0.2 + r() * 0.4})`;
    ctx.beginPath();
    ctx.arc(r() * W, r() * H, 0.6 + r() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 足部露胎：施釉线不规则，烧成后露胎处泛火石红
  const edgeY = x => Y(layout.glazeEdge + Math.sin(x * 0.011) * 0.004 + Math.sin(x * 0.047 + 2) * 0.002);
  const foot = new Path2D();
  foot.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) foot.lineTo(x, edgeY(x));
  foot.lineTo(W, H);
  foot.closePath();
  if (step > 0) {
    ctx.fillStyle = step === 1 ? CLAY.raw : CLAY.fired;
    ctx.fill(foot);
    if (step === 2) {
      const fg = ctx.createLinearGradient(0, edgeY(0), 0, edgeY(0) + 26);
      fg.addColorStop(0, hex(CLAY.flash, 0.55));
      fg.addColorStop(1, hex(CLAY.flash, 0));
      ctx.fillStyle = fg;
      ctx.save();
      ctx.clip(foot);
      ctx.fillRect(0, edgeY(0) - 4, W, 40);
      ctx.restore();
    }
  }

  // —— 粗糙度与清漆遮罩 ——
  const rough = canvas(512, 256);
  const rctx = rough.getContext('2d');
  const sy = 256 / H;
  const glazeRough = step === 0 ? 0.38 : step === 1 ? 0.93 : glaze.rough;
  rctx.fillStyle = `rgb(0,${Math.round(glazeRough * 255)},0)`;
  rctx.fillRect(0, 0, 512, 256);
  if (step > 0) {
    rctx.fillStyle = `rgb(0,${Math.round(0.82 * 255)},0)`;
    rctx.fillRect(0, edgeY(0) * sy - 1, 512, 256);
  }
  const coat = canvas(512, 256);
  const cctx = coat.getContext('2d');
  cctx.fillStyle = '#fff';
  cctx.fillRect(0, 0, 512, 256);
  cctx.fillStyle = '#000';
  if (step > 0) cctx.fillRect(0, edgeY(0) * sy - 1, 512, 256);

  // —— 凹凸：拉坯留下的旋纹（湿坯明显，罩釉后隐约）；刻花处下凹 ——
  const bump = canvas(1024, 1024);
  const bctx = bump.getContext('2d');
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 1024, 1024);
  const ringCount = step === 0 ? 70 : 46;
  for (let i = 0; i < ringCount; i++) {
    const y = r() * 1024;
    const w = 3 + r() * (step === 0 ? 12 : 8);
    const g = bctx.createLinearGradient(0, y - w, 0, y + w);
    const tone = r() > 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${tone},${tone},${tone},0)`);
    g.addColorStop(0.5, `rgba(${tone},${tone},${tone},${step === 0 ? 0.55 : 0.22})`);
    g.addColorStop(1, `rgba(${tone},${tone},${tone},0)`);
    bctx.fillStyle = g;
    bctx.fillRect(0, y - w, 1024, w * 2);
  }
  if (motif && glaze.style !== 'cobalt') {
    // 刻花：沿纹样笔道下凹
    bctx.save();
    bctx.filter = 'brightness(0) blur(1.5px)';
    bctx.globalAlpha = 0.85;
    bctx.drawImage(motif, 0, 0, 1024, 1024);
    bctx.restore();
  }

  return {
    map: toTexture(color),
    roughnessMap: toTexture(rough, { srgb: false }),
    clearcoatMap: toTexture(coat, { srgb: false }),
    bumpMap: toTexture(bump, { srgb: false }),
  };
}

// 陶车轮盘：铸铁上残留的泥浆
export function wheelMap() {
  const S = 1024;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5c5751';
  ctx.fillRect(0, 0, S, S);
  const r = rng(77);
  for (let i = 0; i < 90; i++) {
    const rad = S * (0.12 + r() * 0.36);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, rad, r() * 6.28, r() * 6.28 + 0.6 + r() * 3);
    ctx.strokeStyle = `rgba(${150 + r() * 30},${140 + r() * 25},${125 + r() * 20},${0.12 + r() * 0.25})`;
    ctx.lineWidth = 2 + r() * 10;
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.28);
  g.addColorStop(0, 'rgba(160,150,138,0.85)');
  g.addColorStop(1, 'rgba(160,150,138,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

// ======================================================================
// 剪纸
// ======================================================================

export const PAPERS = {
  red: { color: '#a8180f', metal: 0, rough: 0.82 },
  blue: { color: '#2c4a74', metal: 0, rough: 0.85 },
  ivory: { color: '#ece4cf', metal: 0, rough: 0.9 },
  gold: { color: '#d2a84f', metal: 0.85, rough: 0.32 },
};

const TAU = Math.PI * 2;

// 剪纸单元：n 为对折后的重复次数
export function paperUnits(complexity) {
  return complexity < 0.9 ? 6 : complexity > 1.1 ? 12 : 8;
}

function shapePath(ctx, shape, c, R) {
  ctx.beginPath();
  if (shape === 'square') ctx.rect(c - R * 0.86, c - R * 0.86, R * 1.72, R * 1.72);
  else if (shape === 'diamond') {
    ctx.moveTo(c, c - R);
    ctx.lineTo(c + R, c);
    ctx.lineTo(c, c + R);
    ctx.lineTo(c - R, c);
    ctx.closePath();
  } else ctx.arc(c, c, R, 0, TAU);
}

// 月牙纹：两段圆弧围成的弯月
function crescent(ctx, x, y, s, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, s, Math.PI * 0.15, Math.PI * 0.85);
  ctx.arc(0, -s * 0.55, s * 0.95, Math.PI * 0.78, Math.PI * 0.22, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 锯齿纹：沿一段折线剪出成排的小三角
function sawtooth(ctx, pts, depth, size) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.floor(len / size));
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 0.62) / n, tm = (k + 0.31) / n;
      ctx.beginPath();
      ctx.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0);
      ctx.lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
      ctx.lineTo(ax + (bx - ax) * tm + nx * depth, ay + (by - ay) * tm + ny * depth);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function ringPts(c, rad, n = 360) {
  return Array.from({ length: n + 1 }, (_, i) => [c + Math.sin((i / n) * TAU) * rad, c - Math.cos((i / n) * TAU) * rad]);
}

function polar(c, rad, a) {
  return [c + Math.sin(a) * rad, c - Math.cos(a) * rad];
}

// 剪纸遮罩：白 = 纸，透明 = 剪去
export function papercutMask(state, S = 2048) {
  const c = S / 2, R = S * 0.47;
  const m = canvas(S, S);
  const ctx = m.getContext('2d');
  ctx.fillStyle = '#fff';
  shapePath(ctx, state.shape, c, R);
  ctx.fill();
  if (state.pattern === 'plain') return m;

  const n = paperUnits(state.complexity);
  const dense = state.complexity;
  const cut = () => { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; };
  const keep = () => { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; };
  // 只在对称的一个单元里剪，再旋转复制 —— 与「折叠后一剪」一致
  const unit = fn => { for (let i = 0; i < n; i++) fn((i / n) * TAU); };

  // —— 外缘：锯齿边框 ——
  cut();
  const inner = state.shape === 'round' ? R * 0.9 : R * 0.8;
  if (state.shape === 'round') {
    sawtooth(ctx, ringPts(c, R * 0.935, 220), -R * 0.045, R * 0.034);
    ctx.lineWidth = R * 0.012;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.885, 0, TAU);
    ctx.stroke();
  } else {
    const k = state.shape === 'square' ? 0.78 : 0.86;
    const corners = state.shape === 'square'
      ? [[c - R * k, c - R * k], [c + R * k, c - R * k], [c + R * k, c + R * k], [c - R * k, c + R * k], [c - R * k, c - R * k]]
      : [[c, c - R * k], [c + R * k, c], [c, c + R * k], [c - R * k, c], [c, c - R * k]];
    sawtooth(ctx, corners, R * 0.045, R * 0.034);
    // 四角：月牙团
    const ca = state.shape === 'square' ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const dist = state.shape === 'square' ? R * 0.66 : R * 0.6;
    ca.forEach(([dx, dy]) => {
      const len = Math.hypot(dx, dy);
      const x = c + (dx / len) * dist * (state.shape === 'square' ? 1.3 : 1), y = c + (dy / len) * dist * (state.shape === 'square' ? 1.3 : 1);
      for (let j = 0; j < 5; j++) crescent(ctx, x, y, R * 0.045, (j / 5) * TAU);
      ctx.beginPath();
      ctx.arc(x, y, R * 0.018, 0, TAU);
      ctx.fill();
    });
  }

  // —— 主纹样环 ——
  const r0 = R * 0.42, r1 = Math.min(inner, R * 0.8) - R * 0.03;
  const span = TAU / n;
  if (state.pattern === 'flower') {
    unit(a => {
      // 花瓣外形整片剪空
      const tip = polar(c, r1, a);
      const baseL = polar(c, r0, a - span * 0.36), baseR = polar(c, r0, a + span * 0.36);
      const bulgeL = polar(c, (r0 + r1) * 0.55, a - span * 0.46), bulgeR = polar(c, (r0 + r1) * 0.55, a + span * 0.46);
      const petal = () => {
        ctx.beginPath();
        ctx.moveTo(...baseL);
        ctx.bezierCurveTo(...bulgeL, ...polar(c, r1 * 0.98, a - span * 0.22), ...tip);
        ctx.bezierCurveTo(...polar(c, r1 * 0.98, a + span * 0.22), ...bulgeR, ...baseR);
        ctx.closePath();
      };
      cut();
      petal();
      ctx.fill();
      // 留下内瓣与叶脉（阳刻）
      keep();
      ctx.save();
      ctx.translate(...polar(c, (r0 + r1) / 2, a));
      ctx.scale(0.72, 0.72);
      ctx.translate(-polar(c, (r0 + r1) / 2, a)[0], -polar(c, (r0 + r1) / 2, a)[1]);
      petal();
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = R * 0.016;
      ctx.beginPath();
      ctx.moveTo(...polar(c, r0 - 2, a));
      ctx.lineTo(...polar(c, r1 + 2, a));
      ctx.stroke();
      // 内瓣上的月牙与锯齿
      cut();
      const steps = Math.round(3 + dense * 2);
      for (let k = 0; k < steps; k++) {
        const t = 0.2 + (k / steps) * 0.62;
        const rad = r0 + (r1 - r0) * t;
        crescent(ctx, ...polar(c, rad, a - span * 0.11), R * 0.022, a + Math.PI * 0.5);
        crescent(ctx, ...polar(c, rad, a + span * 0.11), R * 0.022, a - Math.PI * 0.5);
      }
      // 瓣间小叶
      const la = a + span / 2;
      ctx.beginPath();
      ctx.ellipse(...polar(c, r1 * 0.86, la), R * 0.022, R * 0.06, la, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(...polar(c, r0 * 1.12, la), R * 0.02, 0, TAU);
      ctx.fill();
    });
  } else if (state.pattern === 'cloud') {
    unit(a => {
      cut();
      ctx.lineCap = 'round';
      const spiral = (cr, ca, size, dir) => {
        const [cx, cy] = polar(c, cr, ca);
        ctx.beginPath();
        for (let t = 0; t <= Math.PI * 3; t += 0.05) {
          const rr = size * (1 - t / (Math.PI * 3.4));
          const px = cx + Math.cos(t * dir + ca) * rr, py = cy + Math.sin(t * dir + ca) * rr;
          t ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.lineWidth = R * 0.026;
        ctx.stroke();
      };
      const mid = (r0 + r1) / 2;
      spiral(mid + R * 0.05, a, R * 0.11, 1);
      spiral(mid - R * 0.06, a - span * 0.3, R * 0.07, -1);
      spiral(mid - R * 0.06, a + span * 0.3, R * 0.07, 1);
      ctx.beginPath();
      ctx.arc(...polar(c, r1 - R * 0.02, a + span / 2), R * 0.03, 0, TAU);
      ctx.fill();
      for (let k = 0; k < Math.round(2 + dense * 2); k++) {
        crescent(ctx, ...polar(c, r0 + R * 0.03 + k * R * 0.01, a + span * (0.35 + k * 0.08)), R * 0.02, a);
      }
      ctx.lineCap = 'butt';
    });
  } else {
    // 菱格：成排的菱形孔，留下交错的纸筋
    const rows = Math.round(3 + dense);
    for (let row = 0; row < rows; row++) {
      const rad = r0 + ((row + 0.5) / rows) * (r1 - r0);
      const cols = n * (2 + row);
      for (let k = 0; k < cols; k++) {
        const a = ((k + (row % 2) * 0.5) / cols) * TAU;
        const [x, y] = polar(c, rad, a);
        const h = ((r1 - r0) / rows) * 0.36, w = Math.min(h, (TAU * rad / cols) * 0.32);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        cut();
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w, 0);
        ctx.lineTo(0, h);
        ctx.lineTo(-w, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    cut();
    sawtooth(ctx, ringPts(c, r1 + R * 0.02, 200), -R * 0.03, R * 0.028);
  }

  // —— 中心团花 ——
  cut();
  ctx.lineWidth = R * 0.012;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.37, 0, TAU);
  ctx.stroke();
  const cres = n * 2;
  for (let k = 0; k < cres; k++) crescent(ctx, ...polar(c, R * 0.31, (k / cres) * TAU), R * 0.026, (k / cres) * TAU);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU;
    ctx.beginPath();
    ctx.ellipse(...polar(c, R * 0.17, a), R * 0.03, R * 0.075, a, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(c, c, R * 0.05, 0, TAU);
  ctx.fill();
  keep();
  ctx.beginPath();
  ctx.arc(c, c, R * 0.022, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  return m;
}

// 只保留一个折叠扇区（折纸、剪刻两道工序看到的样子）
export function wedgeOf(mask, n) {
  const S = mask.width, c = S / 2;
  const w = canvas(S, S);
  const ctx = w.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.arc(c, c, S, -Math.PI / 2 - Math.PI / n, -Math.PI / 2 + Math.PI / n);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(mask, 0, 0);
  return w;
}

// 纸的颜色：纤维、厚薄不匀、剪口边缘略暗；展开后留折痕
export function paperColorMap(state, mask, { creases = 0 } = {}) {
  const S = mask.width;
  const p = PAPERS[state.color] || PAPERS.red;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = p.color;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = state.color === 'gold' ? 0.04 : 0.1;
  ctx.drawImage(blotches(S, S, 40, 11), 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const r = rng(29);
  // 纤维
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, len = 10 + r() * 46, a = r() * TAU;
    ctx.strokeStyle = r() > 0.5 ? `rgba(255,240,220,${0.04 + r() * 0.07})` : `rgba(40,10,5,${0.04 + r() * 0.06})`;
    ctx.lineWidth = 0.6 + r() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 8, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 8, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // 剪口边缘
  const edge = canvas(S, S);
  const ectx = edge.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, S, S);
  ectx.globalCompositeOperation = 'destination-out';
  ectx.drawImage(mask, 0, 0);
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.globalAlpha = 0.45;
  ctx.drawImage(edge, 0, 0);
  ctx.restore();
  // 折痕
  if (creases) {
    const cc = S / 2;
    for (let k = 0; k < creases; k++) {
      const a = (k / creases) * Math.PI;
      ctx.strokeStyle = k % 2 ? 'rgba(255,235,220,0.16)' : 'rgba(30,5,0,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cc - Math.sin(a) * S, cc + Math.cos(a) * S);
      ctx.lineTo(cc + Math.sin(a) * S, cc - Math.cos(a) * S);
      ctx.stroke();
    }
  }
  return c;
}

// ======================================================================
// 摄影棚与其他品类
// ======================================================================

// 背景纸：极淡的纸纹
export function backdropMap() {
  const S = 1024;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 0.5;
  ctx.drawImage(blotches(S, S, 64, 5), 0, 0);
  ctx.globalAlpha = 0.25;
  ctx.drawImage(blotches(S, S, 256, 6, false), 0, 0);
  return toTexture(c, { srgb: false, repeat: true });
}

// 接触阴影
export function contactShadow() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { srgb: false });
}

// 景泰蓝：松石蓝地、掐丝缠枝、鎏金口足
export function cloisonneMaps(layout) {
  const W = 2048, H = 1024;
  const Y = v => (1 - v) * H;
  const color = canvas(W, H);
  const ctx = color.getContext('2d');
  ctx.fillStyle = '#1f86a3';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.18;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(blotches(W, H, 80, 41), 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const metal = canvas(W, H);
  const mctx = metal.getContext('2d');
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, W, H);
  const r = rng(5);
  const state = { shape: 'vase', pattern: 'flower' };
  paintPattern(ctx, W, H, layout, state, { line: '#d7b257', wash: 'rgba(196,52,48,0.88)' }, r);
  paintPattern(mctx, W, H, layout, state, { line: '#fff', wash: 'rgba(0,0,0,0)' }, rng(5));
  // 鎏金口沿与足
  for (const [a, b] of [[0, layout.glazeEdge + 0.02], [layout.rimStart - 0.02, 1]]) {
    ctx.fillStyle = '#c99a45';
    ctx.fillRect(0, Y(b), W, Y(a) - Y(b));
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, Y(b), W, Y(a) - Y(b));
  }
  return { map: toTexture(color), metalnessMap: toTexture(metal, { srgb: false }) };
}

// 木纹
export function woodMaps(seed = 3) {
  const W = 1024, H = 1024;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a5a35';
  ctx.fillRect(0, 0, W, H);
  const r = rng(seed);
  for (let i = 0; i < 220; i++) {
    const y = r() * H, amp = 4 + r() * 18, f = 0.004 + r() * 0.01, ph = r() * 6;
    ctx.strokeStyle = r() > 0.5 ? `rgba(60,32,16,${0.15 + r() * 0.3})` : `rgba(190,140,90,${0.08 + r() * 0.15})`;
    ctx.lineWidth = 1 + r() * 4;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const yy = y + Math.sin(x * f + ph) * amp;
      x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
    }
    ctx.stroke();
  }
  return toTexture(c);
}

// 木雕浮雕：缠枝花卉的高度图
export function reliefMap() {
  const S = 1024;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  ctx.fillRect(40, 40, S - 80, S - 80);
  ctx.fillStyle = '#222';
  ctx.fillRect(70, 70, S - 140, S - 140);
  ctx.save();
  ctx.filter = 'blur(4px)';
  const ink = { line: '#fff', wash: 'rgba(255,255,255,0.85)' };
  const r = rng(9);
  peony(ctx, S * 0.5, S * 0.5, S * 0.2, ink, r);
  peony(ctx, S * 0.26, S * 0.3, S * 0.11, ink, r);
  peony(ctx, S * 0.74, S * 0.7, S * 0.12, ink, r);
  for (let i = 0; i < 9; i++) leaf(ctx, S * (0.2 + r() * 0.6), S * (0.2 + r() * 0.6), S * 0.12, r() * TAU, ink);
  ctx.restore();
  return toTexture(c, { srgb: false });
}

// 布料：蜡染（冰纹）或艾德莱斯（扎经晕染）
export function textileMap(kind) {
  const S = 1024;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const r = rng(kind === 'ikat' ? 17 : 23);
  if (kind === 'ikat') {
    const cols = ['#b42a2e', '#e3b23c', '#1d1b26', '#2f7a5a', '#f1e6d0'];
    for (let x = 0; x < S; x += 2) {
      const band = Math.floor((x / S) * 24);
      ctx.fillStyle = cols[band % cols.length];
      ctx.fillRect(x, 0, 2, S);
    }
    ctx.globalAlpha = 0.9;
    for (let y = 0; y < S; y += 3) {
      const shift = Math.sin(y * 0.03) * 14 + (r() - 0.5) * 8;
      ctx.drawImage(c, 0, y, S, 3, shift, y, S, 3);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#1e3452';
    ctx.fillRect(0, 0, S, S);
    ctx.globalAlpha = 0.25;
    ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(blotches(S, S, 40, 3), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const ink = { line: 'rgba(230,236,240,0.9)', wash: 'rgba(230,236,240,0.12)' };
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      ctx.save();
      ctx.translate(S * (0.18 + i * 0.32), S * (0.18 + j * 0.32));
      ctx.lineWidth = 3;
      ctx.strokeStyle = ink.line;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, S * (0.03 + k * 0.025), 0, TAU);
        ctx.stroke();
      }
      for (let k = 0; k < 8; k++) {
        ctx.rotate(TAU / 8);
        ctx.beginPath();
        ctx.ellipse(0, -S * 0.13, S * 0.015, S * 0.03, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
    crackle(ctx, 0, 0, S, S, r, 0.35);
    ctx.strokeStyle = 'rgba(220,230,240,0.25)';
  }
  return toTexture(c, { repeat: true });
}

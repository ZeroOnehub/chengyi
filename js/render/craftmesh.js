// 写实器物的几何与材质：瓷器（有壁厚、口沿、圈足露胎）、剪纸（折叠扇区 / 展开留折痕）、陶车，
// 以及山河样品里仅供欣赏的景泰蓝、木雕、布料。工坊与作品照片共用这里的造型，保证所见即所得。

import * as THREE from 'three';
import { geometry, toDocument } from '../core/pottery.js';
import {
  GLAZES, PAPERS, ceramicMaps, cloisonneMaps, paperColorMap, papercutMask, paperUnits,
  reliefMap, textileMap, toTexture, wedgeOf, wheelMap, woodMaps,
} from './textures.js';

// —— 贴图缓存：同一组参数只生成一次 ——
const cache = new Map();
const CACHE_MAX = 10;
function cached(key, make) {
  if (cache.has(key)) {
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  const v = make();
  cache.set(key, v);
  if (cache.size > CACHE_MAX) {
    const [oldKey, old] = cache.entries().next().value;
    cache.delete(oldKey);
    Object.values(old).forEach(t => t?.isTexture && t.dispose());
  }
  return v;
}

// ======================================================================
// 瓷器
// ======================================================================

// 外轮廓（半径, 高度），自足上到口沿
const OUTER = {
  vase: [[0.5, 0.06], [0.6, 0.16], [0.84, 0.42], [0.99, 0.82], [0.98, 1.18], [0.84, 1.52], [0.6, 1.8], [0.4, 2.04], [0.31, 2.3], [0.32, 2.55], [0.42, 2.76]],
  bowl: [[0.46, 0.07], [0.58, 0.2], [0.86, 0.4], [1.14, 0.72], [1.33, 1.06], [1.45, 1.36]],
  jar: [[0.56, 0.06], [0.74, 0.18], [1.02, 0.56], [1.14, 1.02], [1.06, 1.46], [0.82, 1.8], [0.62, 1.95], [0.58, 2.06], [0.61, 2.16]],
  cup: [[0.66, 0.06], [0.7, 0.2], [0.72, 2.25], [0.78, 2.5]],
};
// 纹饰带所在高度
const BANDS = {
  vase: { band: [1.0, 1.5], lower: [0.14, 0.44], neck: [2.08, 2.5] },
  bowl: { band: [0.78, 1.22], lower: null, neck: null },
  jar: { band: [1.08, 1.62], lower: [0.14, 0.48], neck: null },
  cup: { band: [0.7, 1.9], lower: [0.14, 0.4], neck: null },
};

function buildProfile(shape) {
  const t = shape === 'bowl' ? 0.055 : 0.07;
  const floor = shape === 'bowl' ? 0.17 : 0.22;
  const outer = new THREE.SplineCurve(OUTER[shape].map(([x, y]) => new THREE.Vector2(x, y))).getSpacedPoints(120);
  const inner = [];
  outer.forEach((p, i) => {
    const a = outer[Math.max(0, i - 1)], b = outer[Math.min(outer.length - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty) || 1;
    const q = new THREE.Vector2(p.x - (ty / len) * t, p.y + (tx / len) * t);
    if (q.y > floor + 0.04 && q.x > 0.02) inner.push(q);
  });
  const rf = outer[0].x;
  const foot = [[0, 0.045], [rf * 0.78, 0.045], [rf * 0.84, 0.012], [rf * 0.89, 0], [rf * 0.97, 0], [rf, 0.022]].map(([x, y]) => new THREE.Vector2(x, y));
  const top = outer.at(-1), innerTop = inner.at(-1);
  const c = new THREE.Vector2().addVectors(top, innerTop).multiplyScalar(0.5);
  const rr = top.distanceTo(innerTop) / 2;
  const a0 = Math.atan2(top.y - c.y, top.x - c.x);
  let a1 = Math.atan2(innerTop.y - c.y, innerTop.x - c.x);
  if (a1 < a0) a1 += Math.PI * 2;
  const rim = Array.from({ length: 9 }, (_, i) => {
    const a = a0 + ((a1 - a0) * (i + 1)) / 10;
    return new THREE.Vector2(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
  });
  const last = inner[0];
  const tail = [new THREE.Vector2(last.x * 0.55, floor + 0.006), new THREE.Vector2(0, floor)];
  const pieces = { foot, outer, rim, inner: inner.slice().reverse(), tail };
  const path = [...foot, ...outer, ...rim, ...pieces.inner, ...tail];

  // 按弧长等距重采样，使贴图 v 与真实长度成正比
  const lens = [0];
  for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = lens.at(-1);
  const N = 300;
  const pts = [];
  let k = 0;
  for (let i = 0; i < N; i++) {
    const s = (i / (N - 1)) * total;
    while (k < lens.length - 2 && lens[k + 1] < s) k++;
    const f = (s - lens[k]) / (lens[k + 1] - lens[k] || 1);
    pts.push(new THREE.Vector2().lerpVectors(path[k], path[k + 1], f));
  }
  // 各段在 v 上的位置
  const outerStart = foot.length;
  const vAt = idx => lens[idx] / total;
  const vOuterY = y => {
    for (let i = outerStart; i < outerStart + outer.length - 1; i++) {
      if (path[i].y <= y && path[i + 1].y >= y) {
        const f = (y - path[i].y) / (path[i + 1].y - path[i].y || 1);
        return (lens[i] + (lens[i + 1] - lens[i]) * f) / total;
      }
    }
    return y < path[outerStart].y ? vAt(outerStart) : vAt(outerStart + outer.length - 1);
  };
  const b = BANDS[shape];
  const rAt = range => {
    if (!range) return 1;
    const y = (range[0] + range[1]) / 2;
    return outer.reduce((best, p) => (Math.abs(p.y - y) < Math.abs(best.y - y) ? p : best)).x;
  };
  const layout = {
    len: total,
    radii: { band: rAt(b.band), lower: rAt(b.lower), neck: rAt(b.neck) },
    glazeEdge: vOuterY(0.1),
    rimStart: vAt(outerStart + outer.length - 1),
    rimEnd: vAt(outerStart + outer.length + rim.length),
    band: b.band.map(vOuterY),
    lower: b.lower && b.lower.map(vOuterY),
    neck: b.neck && b.neck.map(vOuterY),
  };
  return { points: pts, layout, footR: rf, height: top.y + rr };
}

const profiles = {};
const profileOf = shape => (profiles[shape] ||= buildProfile(shape));

function ceramicMaterial(state) {
  const key = `c|${state.shape}|${state.color}|${state.pattern}|${state.step}`;
  const maps = cached(key, () => ceramicMaps(state, profileOf(state.shape).layout));
  const glaze = GLAZES[state.color] || GLAZES.jade;
  const step = state.step;
  return new THREE.MeshPhysicalMaterial({
    map: maps.map,
    roughness: 1,
    roughnessMap: maps.roughnessMap,
    bumpMap: maps.bumpMap,
    bumpScale: step === 0 ? 1.1 : step === 1 ? 0.5 : 0.3,
    clearcoat: step === 2 ? 1 : step === 0 ? 0.45 : 0,
    clearcoatMap: step === 2 ? maps.clearcoatMap : null,
    clearcoatRoughness: step === 0 ? 0.35 : glaze.rough * 0.35,
    ior: 1.52,
    specularIntensity: step === 1 ? 0.3 : 1,
    sheen: step === 1 ? 0.35 : 0,
    sheenRoughness: 0.9,
    sheenColor: new THREE.Color('#ffffff'),
  });
}

// 陶车：铸铁轮盘 + 接泥盘
function buildWheel() {
  const group = new THREE.Group();
  const top = cached('wheel', () => ({ map: wheelMap() }));
  const iron = new THREE.MeshStandardMaterial({ color: '#4d4a46', roughness: 0.55, metalness: 0.6 });
  const head = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.12, 96), [
    iron,
    new THREE.MeshStandardMaterial({ map: top.map, roughness: 0.48, metalness: 0.25 }),
    iron,
  ]);
  head.position.y = 0.3;
  head.castShadow = head.receiveShadow = true;
  group.add(head);
  const pan = new THREE.Mesh(
    new THREE.LatheGeometry([[0.2, 0.02], [2.15, 0.02], [2.24, 0.1], [2.3, 0.4], [2.36, 0.42], [2.36, 0.38], [2.3, 0.36]].map(([x, y]) => new THREE.Vector2(x, y)), 128),
    new THREE.MeshStandardMaterial({ color: '#2f2d2b', roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide }),
  );
  pan.castShadow = pan.receiveShadow = true;
  group.add(pan);
  return { group, spinner: head, lift: 0.36 };
}

export function buildCeramic(state) {
  const group = new THREE.Group();
  const prof = profileOf(state.shape);
  const doc = state.pottery ? toDocument(state) : null;
  const grid = doc ? geometry.grid(doc) : null;
  const stats = doc ? geometry.stats(doc, grid) : null;
  const material = ceramicMaterial(state);
  if (doc && state.step === 2) {
    material.roughness = Math.max(.06, 1 - doc.gloss / 100);
    material.clearcoatRoughness = Math.max(.03, 1 - doc.gloss / 100);
  }
  const body = new THREE.Mesh(doc ? geometry.buildGeometry(THREE, doc, grid) : new THREE.LatheGeometry(prof.points, 160), material);
  body.name = 'pottery-body';
  body.scale.set(doc ? 1 : state.width, 1, doc ? 1 : state.width);
  body.castShadow = true;
  body.receiveShadow = true;
  const spin = new THREE.Group();
  spin.add(body);
  let lift = 0, wheel = null;
  if (state.step === 0) {
    wheel = buildWheel();
    group.add(wheel.group);
    lift = wheel.lift;
  }
  spin.position.y = lift;
  group.add(spin);
  return {
    group,
    spin,
    wheel,
    materials: [body.material],
    height: (doc ? doc.height / 6 + .025 : prof.height) + lift,
    radius: Math.max(wheel ? 2.1 : 0, stats ? stats.max_radius : Math.max(prof.footR, ...OUTER[state.shape].map(p => p[0])) * state.width),
    footR: grid ? Math.max(...grid[0]) : prof.footR * state.width,
    lift,
    kind: 'ceramic',
  };
}

// ======================================================================
// 剪纸
// ======================================================================

const SHEET = 3.2;

function paperTextures(state, step) {
  const q = Math.round(state.complexity * 10) / 10;
  const key = `p|${state.shape}|${state.color}|${step === 0 ? 'plain' : state.pattern}|${q}|${step}`;
  return cached(key, () => {
    const n = paperUnits(q);
    const full = papercutMask({ ...state, complexity: q, pattern: step === 0 ? 'plain' : state.pattern });
    const mask = step < 2 ? wedgeOf(full, n) : full;
    return {
      alphaMap: toTexture(mask, { srgb: false }),
      map: toTexture(paperColorMap(state, mask, { creases: step === 2 ? n : 0 })),
    };
  });
}

function paperMaterial(state, tex) {
  const p = PAPERS[state.color] || PAPERS.red;
  return new THREE.MeshStandardMaterial({
    map: tex.map,
    alphaMap: tex.alphaMap,
    alphaTest: 0.5,
    roughness: p.rough,
    metalness: p.metal,
    side: THREE.DoubleSide,
  });
}

// 展开后的纸：沿折痕起伏
function creasedSheet(n) {
  const geo = new THREE.PlaneGeometry(SHEET, SHEET, 180, 180);
  const pos = geo.attributes.position;
  const seg = Math.PI / n;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.hypot(x, y);
    const a = Math.atan2(x, y) + Math.PI;
    const k = Math.floor(a / seg);
    const ph = (a - k * seg) / seg;
    const tri = k % 2 ? ph : 1 - ph;
    pos.setZ(i, tri * r * 0.028 + r * r * 0.006);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildPaper(state) {
  const group = new THREE.Group();
  const step = state.step;
  const n = paperUnits(Math.round(state.complexity * 10) / 10);
  const tex = paperTextures(state, step);
  const mat = paperMaterial(state, tex);
  const materials = [mat];
  if (step < 2) {
    // 折叠：几层纸叠在一起，边缘错开一点，纸尖微微翘起
    const fold = new THREE.Group();
    const layers = 6;
    for (let i = 0; i < layers; i++) {
      const geo = new THREE.PlaneGeometry(SHEET, SHEET, 48, 48);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const r = Math.hypot(pos.getX(k), pos.getY(k));
        pos.setZ(k, r * r * 0.012 * (1 + i * 0.15));
      }
      geo.computeVertexNormals();
      const layerMat = i === layers - 1 ? mat : mat.clone();
      if (i < layers - 1) layerMat.color.setScalar(0.78 + i * 0.03);
      if (layerMat !== mat) materials.push(layerMat);
      const sheet = new THREE.Mesh(geo, layerMat);
      sheet.rotation.x = -Math.PI / 2;
      sheet.rotation.z = (i - (layers - 1) / 2) * 0.012;
      sheet.position.y = 0.008 + i * 0.007;
      sheet.castShadow = true;
      sheet.receiveShadow = true;
      fold.add(sheet);
    }
    // 扇区质心移到画面中心，并斜放
    const centroid = (SHEET * 0.47) * 0.62;
    fold.position.z = centroid * 0.8;
    const holder = new THREE.Group();
    holder.add(fold);
    holder.rotation.y = 0.55;
    group.add(holder);
  } else {
    const sheet = new THREE.Mesh(creasedSheet(n), mat);
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = 0.012;
    sheet.castShadow = true;
    sheet.receiveShadow = true;
    group.add(sheet);
  }
  const spin = new THREE.Group();
  spin.add(group);
  return { group: spin, spin, materials, height: 0.05, radius: step < 2 ? SHEET * 0.36 : SHEET * 0.5, kind: 'paper' };
}

// ======================================================================
// 山河样品：仅供欣赏的品类
// ======================================================================

function buildCloisonne() {
  const prof = profileOf('vase');
  const maps = cached('cloisonne', () => cloisonneMaps(prof.layout));
  const mat = new THREE.MeshPhysicalMaterial({
    map: maps.map, metalnessMap: maps.metalnessMap, metalness: 1, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.08,
  });
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof.points, 160), mat);
  body.castShadow = body.receiveShadow = true;
  const spin = new THREE.Group();
  spin.add(body);
  return { group: spin, spin, materials: [mat], height: prof.height, radius: 1, footR: prof.footR, kind: 'ceramic' };
}

function buildCarving() {
  const maps = cached('wood', () => ({ map: woodMaps(), bump: reliefMap() }));
  const wood = new THREE.MeshStandardMaterial({ map: maps.map, roughness: 0.62 });
  const face = new THREE.MeshStandardMaterial({ map: maps.map, bumpMap: maps.bump, bumpScale: 9, roughness: 0.58 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 0.16), [wood, wood, wood, wood, face, wood]);
  panel.position.y = 1.1;
  panel.rotation.x = -0.06;
  panel.castShadow = panel.receiveShadow = true;
  const spin = new THREE.Group();
  spin.add(panel);
  return { group: spin, spin, materials: [wood, face], height: 2.2, radius: 1.1, footR: 1.1, kind: 'ceramic' };
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function buildCloth(kind) {
  const map = cached(`cloth-${kind}`, () => ({ map: textileMap(kind) })).map;
  map.repeat.set(kind === 'ikat' ? 0.55 : 0.75, kind === 'ikat' ? 0.55 : 0.75);
  const mat = new THREE.MeshPhysicalMaterial({ map, roughness: 0.82, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(kind === 'ikat' ? '#fff0d0' : '#9fb4d0') });
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.ExtrudeGeometry(roundedRect(2.3 - i * 0.1, 1.6 - i * 0.06, 0.06), { depth: 0.035, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 5, curveSegments: 10 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = (i - 1) * 0.06;
    m.position.y = 0.03 + i * 0.1;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  const spin = new THREE.Group();
  spin.add(group);
  return { group: spin, spin, materials: [mat], height: 0.4, radius: 1.3, footR: 1.2, kind: 'ceramic' };
}

export function buildPreview(craft, variant) {
  if (craft === 'metal') return buildCloisonne();
  if (craft === 'wood') return buildCarving();
  if (craft === 'textile') return buildCloth(variant === 'ikat' ? 'ikat' : 'batik');
  return null;
}

export function buildSubject(craft, state, variant) {
  if (craft === 'ceramic') return buildCeramic(state);
  if (craft === 'paper') return buildPaper(state);
  return buildPreview(craft, variant);
}

export function disposeSubject(subject) {
  subject?.group.traverse(o => {
    if (o.isMesh) {
      o.geometry.dispose();
      [].concat(o.material).forEach(m => m.dispose());
    }
  });
}

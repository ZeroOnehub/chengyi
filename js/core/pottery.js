// 承艺作品与后台96层陶器文档之间的转换。完整轮廓随草稿、撤销和作品照片一起保存。
import '../vendor/pottery-geometry.js';

export const geometry = window.PotteryGeometry;
const copy = value => JSON.parse(JSON.stringify(value));
const MATERIALS = { jade: 'celadon', blue: 'blue', white: 'cream', clay: 'terracotta', brown: 'brown', charcoal: 'charcoal' };
const COLORS = Object.fromEntries(Object.entries(MATERIALS).map(([color, material]) => [material, color]));
const HEIGHTS = { vase: 16.56, bowl: 8.16, jar: 12.96, cup: 15 };
const OUTER = {
  vase: [[.5, 0], [.6, .16], [.84, .42], [.99, .82], [.98, 1.18], [.84, 1.52], [.6, 1.8], [.4, 2.04], [.31, 2.3], [.32, 2.55], [.42, 2.76]],
  bowl: [[.46, 0], [.58, .2], [.86, .4], [1.14, .72], [1.33, 1.06], [1.45, 1.36]],
  jar: [[.56, 0], [.74, .18], [1.02, .56], [1.14, 1.02], [1.06, 1.46], [.82, 1.8], [.62, 1.95], [.58, 2.06], [.61, 2.16]],
  cup: [[.66, 0], [.7, .2], [.72, 2.25], [.78, 2.5]],
};

function profile(shape, width = 1) {
  const knots = OUTER[shape] || OUTER.vase;
  return Array.from({ length: 96 }, (_, index) => {
    const height = index / 95 * knots.at(-1)[1];
    const right = Math.max(1, knots.findIndex(point => point[1] >= height));
    const a = knots[right - 1], b = knots[right];
    const t = Math.max(0, Math.min(1, (height - a[1]) / (b[1] - a[1])));
    return Math.max(.32, (a[0] + (b[0] - a[0]) * t) * width);
  });
}

export function validateDocument(raw) {
  if (!raw || !OUTER[raw.preset] || !Array.isArray(raw.profile) || raw.profile.length !== 96
    || !raw.profile.every(radius => Number.isFinite(radius) && radius >= .32 && radius <= 2.9)
    || !Number.isFinite(raw.height) || raw.height < 8 || raw.height > 40
    || !COLORS[raw.material] || !Number.isFinite(raw.gloss) || raw.gloss < 0 || raw.gloss > 100) throw Error('陶器轮廓参数不正确');
  const doc = { ...copy(raw), ...geometry.extraState(raw) };
  doc.name = typeof doc.name === 'string' ? doc.name.slice(0, 40) : '承艺作品';
  doc.wheel = { rotating: true, speed_rpm: 30, rotation_deg: 0, ...doc.wheel };
  doc.view = { direction: 'perspective', azimuth_deg: 0, polar_deg: 78.5, zoom_percent: 100, ...doc.view };
  const range = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  if (typeof doc.wheel.rotating !== 'boolean' || !range(doc.wheel.speed_rpm, 5, 60) || !range(doc.wheel.rotation_deg, -180, 180)
    || !['front', 'top', 'perspective', 'custom'].includes(doc.view.direction) || !range(doc.view.azimuth_deg, -360, 360)
    || !range(doc.view.polar_deg, 1.43, 88) || !range(doc.view.zoom_percent, 57, 190)) throw Error('陶器视角参数不正确');
  const stats = geometry.stats(doc);
  if (stats.min_radius < .14 - 1e-8 || stats.max_radius > 2.9 + 1e-8) throw Error('陶器局部过薄或超出范围');
  return doc;
}

export function toDocument(state) {
  if (state.pottery) return validateDocument(state.pottery);
  return validateDocument({ name: '承艺作品', profile: profile(state.shape, state.width), height: HEIGHTS[state.shape] || 16.56,
    preset: state.shape, material: MATERIALS[state.color] || 'celadon', gloss: 60, ...geometry.extraState({}) });
}

export function fromDocument(raw, state) {
  const doc = validateDocument(raw);
  return { ...state, shape: doc.preset, color: COLORS[doc.material], width: 1, pottery: doc };
}

export function mergeManual(state, patch) {
  const next = { ...state, ...patch };
  if (Object.hasOwn(patch, 'pottery') || !state.pottery) return next;
  const doc = toDocument(state);
  if (patch.shape && patch.shape !== state.shape) {
    doc.preset = patch.shape;
    doc.profile = profile(patch.shape, next.width);
    doc.height = HEIGHTS[patch.shape];
    Object.assign(doc, geometry.extraState({}));
  } else if (patch.width && patch.width !== state.width) {
    const scale = patch.width / state.width;
    doc.profile = doc.profile.map(radius => radius * scale);
    doc.deformations = doc.deformations.map(detail => ({ ...detail, radius_delta_cm: detail.radius_delta_cm * scale }));
  }
  if (patch.color) doc.material = MATERIALS[patch.color];
  next.pottery = validateDocument(doc);
  return next;
}

export function validPottery(value) {
  try { validateDocument(value); return true; } catch { return false; }
}

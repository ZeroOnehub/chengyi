// 共创工坊：工坊入口 → 创作台。两者共用一个写实摄影棚，器物始终是画面的主角。
// 入口只有一段介绍和三个选择；创作台只露出当前工序要用的工具。承艺之声在 voice.js，这里只响应它的展开与收起。

import { setPotteryStage } from '../ai/pottery.js';
import { geometry as potteryGeometry } from '../core/pottery.js';
import { $, esc, toast } from '../core/dom.js';
import { emit, on } from '../core/bus.js';
import { currentView, showView } from '../core/router.js';
import { reducedMotion } from '../core/settings.js';
import * as session from '../core/session.js';
import { findRecord, storageAvailable } from '../core/store.js';
import { CRAFTS, CRAFT_NAMES, PATTERNS, STEP_COUNT, colorOf } from '../data/crafts.js';
import { SOURCES, findParagraph } from '../data/album.js';
import { ATELIER_TOOLS } from '../data/atelier.js';
import { createStudio } from '../render/studio.js';
import { artwork } from '../render/artwork.js';
import { fillPhoto } from '../render/photo.js';
import { play } from '../fx/sound.js';
import { confirmAction } from './dialogs.js';

let mode = 'atelier';
let region = null;
let studio = null;

const craftNow = () => session.getActiveCraft();
const findRecordName = id => findRecord(id)?.name || null;
const NUMERALS = ['壹', '贰', '叁', '肆', '伍'];

const LEDE = {
  ceramic: '一抔瓷土，经拉坯、施釉、入窑，才成一件器物。古人说「过手七十二，方克成器」，这里把它简化成三步，随时可以停下。',
  paper: '一张红纸，对折几次，一剪下去，展开就是一朵团花。这里把它简化成三步：折纸、剪刻、展开。',
};
const FINAL_NOTE = {
  ceramic: '出窑了。拖动转一转，看看釉色与纹样',
  paper: '展开了。拖动转一转，看看剪口与折痕',
};

// —— 模式切换 ——
function showMode() {
  const visible = currentView() === 'workshop';
  document.body.dataset.workshop = visible ? mode : '';
  $('atelier').hidden = mode !== 'atelier';
  $('work-layout').hidden = mode !== 'create';
  if (studio) {
    studio.setActive(visible);
    studio.compose(mode === 'atelier' ? 'intro' : $('chat-panel').hidden ? 'create' : 'chat', { immediate: !visible });
    studio.show(craftNow(), session.getSession().state);
  } else syncFallback(session.getSession().state);
  $('work-layout').classList.toggle('chat-open', !$('chat-panel').hidden);
  if (mode === 'atelier') renderAtelier();
  else renderWork();
}

export function openAtelier(craft, regionName) {
  if (craft) session.setActiveCraft(craft);
  if (regionName) region = regionName;
  mode = 'atelier';
  if (currentView() === 'workshop') showMode();
  else showView('workshop');
  emit('say', `这是${CRAFTS[craftNow()].title}。可以先看看工序和工具，也可以直接开始。`);
}

export function openCreate(craft) {
  if (craft) session.setActiveCraft(craft);
  mode = 'create';
  if (currentView() === 'workshop') showMode();
  else showView('workshop');
}

export const getMode = () => mode;

const craftSwitch = () => Object.keys(CRAFTS).map(c =>
  `<button data-craft="${c}" aria-pressed="${c === craftNow()}">${CRAFT_NAMES[c]}</button>`).join('');

// —— 工坊入口 ——
function renderAtelier() {
  const craft = craftNow();
  $('atelier-title').textContent = CRAFTS[craft].title;
  $('atelier-trail').textContent = region ? `${region} · ${CRAFT_NAMES[craft]}` : `共创工坊 · ${CRAFT_NAMES[craft]}`;
  $('atelier-lede').textContent = LEDE[craft];
  $('atelier-craft-switch').innerHTML = craftSwitch();
  closeCard();
}

export const citeButton = (craft, id, label) => {
  const found = findParagraph(craft, id);
  if (!found) return '';
  return `<button class="cite" data-cite="${id}" data-cite-craft="${craft}">${label || `出处：${esc(SOURCES[found.para.src]?.title.split('，')[0] || '册页')}`}</button>`;
};

function openCard(kind) {
  const craft = craftNow();
  const c = CRAFTS[craft];
  let body = '';
  if (kind === 'process') {
    $('atelier-card-eyebrow').textContent = '看工序';
    $('atelier-card-title').textContent = '三道工序';
    body = `<p>在线体验把工艺简化为三道工序，可以随时跳转。</p><ol>${c.steps.map((s, i) =>
      `<li><span class="num">${NUMERALS[i]}</span><div><b>${s.name}</b>${esc(c.copy[i])}<br>${citeButton(craft, s.album, '册页出处')}</div></li>`).join('')}</ol>`;
    if (craft === 'ceramic') body += `<p class="muted">真实制瓷远不止三步。${citeButton('ceramic', 'craft-72', '《天工开物》怎么说')}</p>`;
  } else {
    $('atelier-card-eyebrow').textContent = '认识工具';
    $('atelier-card-title').textContent = '工具与材料';
    body = `<ol>${ATELIER_TOOLS[craft].map((t, i) =>
      `<li><span class="num">${NUMERALS[i]}</span><div><b>${t.name}</b>${esc(t.text)}<br>${citeButton(craft, t.cite, '册页出处')}</div></li>`).join('')}</ol>`;
  }
  body += '<button class="primary-btn card-cta" data-card-start>开始创作</button>';
  $('atelier-card-body').innerHTML = body;
  $('atelier-card').hidden = false;
  play('tap');
}

function closeCard() {
  $('atelier-card').hidden = true;
}

function startCreating() {
  closeCard();
  play('confirm');
  emit('say', `我们开始做${CRAFT_NAMES[craftNow()]}。对话和手动操作改的是同一件作品，每一步都能撤销。`);
  openCreate();
}

// —— 创作台 ——
function renderWork() {
  const craft = craftNow();
  const c = CRAFTS[craft];
  const ss = session.getSession();
  const s = ss.state;
  $('work-craft-switch').innerHTML = craftSwitch();
  $('steps').innerHTML = c.steps.map((x, i) =>
    `<li><button class="step ${s.step === i ? 'active' : s.step > i ? 'done' : ''}" data-step="${i}" ${s.step === i ? 'aria-current="step"' : ''}>
      <span class="step-number">${NUMERALS[i]}</span><span>${x.name}</span></button></li>`).join('');
  $('process-copy').textContent = c.copy[s.step];

  const tray = $('tray');
  tray.dataset.step = s.step;
  tray.dataset.craft = craft;
  $('shape-label').textContent = c.shapeLabel;
  $('shape-chips').innerHTML = c.shapes.map(x =>
    `<button data-shape="${x.id}" aria-pressed="${s.shape === x.id}">${x.name}</button>`).join('');
  $('color-label').textContent = `${c.colorLabel} · ${colorOf(craft, s.color)?.name || ''}`;
  $('swatches').innerHTML = c.colors.map(x =>
    `<button class="swatch" data-color="${x.id}" aria-label="${x.name}" title="${x.name}" aria-pressed="${s.color === x.id}" style="--c:${x.hex}"></button>`).join('');
  $('pattern-chips').innerHTML = PATTERNS.map(x =>
    `<button data-pattern="${x.id}" aria-pressed="${s.pattern === x.id}">${x.name}</button>`).join('');
  $('stage-under').textContent = FINAL_NOTE[craft];
  $('drag-hint').textContent = craft === 'ceramic' && s.pottery
    ? `${potteryGeometry.NAMES[s.pottery.cross_section.shape]} · 高 ${s.pottery.height.toFixed(1)} cm · 拖动旋转 · 滚轮远近`
    : '拖动可旋转 · 滚轮远近';

  const slider = $('sculpt-slider');
  if (craft === 'ceramic') {
    $('slider-name').textContent = '器身宽窄';
    slider.min = 75; slider.max = 120; slider.value = Math.round(s.width * 100);
  } else {
    $('slider-name').textContent = '剪刻繁简';
    slider.min = 60; slider.max = 130; slider.value = Math.round(s.complexity * 100);
  }

  const last = s.step === STEP_COUNT - 1;
  $('undo').disabled = !ss.history.length;
  $('redo').disabled = !ss.future.length;
  $('next-step').disabled = last;
  $('next-step').hidden = last;
  $('next-step').textContent = last ? '已到最后一道工序' : `下一步：${c.steps[s.step + 1].name}`;
  $('next-step').className = last ? 'text-btn' : 'primary-btn';
  $('finish-work').hidden = !last;
  $('save-status').textContent = ss.id ? (storageAvailable ? '草稿已自动保存在本机' : '尚未保存 · 请下载留存') : '';
}

let lastShown = null;
function syncStage(animate) {
  const craft = craftNow();
  const s = session.getSession().state;
  const prev = lastShown;
  lastShown = { craft, step: s.step };
  if (!studio) { syncFallback(s); return; }
  const firing = animate && craft === 'ceramic' && prev?.craft === 'ceramic' && prev.step === 1 && s.step === 2;
  if (firing) emit('say', '入窑了。窑温升到一千三百度上下，釉在火里熔开，冷却后才显出真正的颜色。');
  studio.show(craft, s, { animate });
}

function syncFallback(state) {
  const img = $('studio-fallback');
  img.hidden = false;
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork(craftNow(), state))}`;
}

// 承艺之声展开时，器物让到左边
function onChat({ open }) {
  if (currentView() !== 'workshop') return;
  $('work-layout').classList.toggle('chat-open', open);
  studio?.compose(mode === 'atelier' ? 'intro' : open ? 'chat' : 'create');
}

// —— 初始化 ——
export function initWorkshop() {
  studio = createStudio($('studio-canvas'));
  setPotteryStage(held => studio?.potteryPose(held), async effects => {
    if (!studio) throw Error('当前浏览器没有可用的三维画布，请使用支持 WebGL 的浏览器。');
    const artifacts = [];
    for (const effect of effects) if (effect.type === 'export_artifact') artifacts.push(await studio.exportPottery(effect.format));
    return artifacts;
  });
  if (studio) studio.setReduced(reducedMotion());
  else $('studio-canvas').hidden = true;

  // 工坊入口
  $('atelier').addEventListener('click', e => {
    const b = e.target.closest('[data-hotspot]');
    if (b) {
      if (b.dataset.hotspot === 'start') startCreating();
      else openCard(b.dataset.hotspot);
      return;
    }
    if (e.target.closest('[data-card-start]')) startCreating();
  });
  $('atelier-card-close').addEventListener('click', closeCard);
  $('atelier-back').addEventListener('click', () => showView('explore'));
  $('back-atelier').addEventListener('click', () => { emit('chat-close'); mode = 'atelier'; showMode(); });
  ['atelier-craft-switch', 'work-craft-switch'].forEach(id => $(id).addEventListener('click', e => {
    const b = e.target.closest('[data-craft]');
    if (!b || b.dataset.craft === craftNow()) return;
    session.setActiveCraft(b.dataset.craft);
    showMode();
    emit('say', `换到${CRAFT_NAMES[b.dataset.craft]}了。另一件作品已保存，随时可以切回来。`);
  }));
  // 册页出处（入口说明与对话共用）
  document.addEventListener('click', e => {
    const cite = e.target.closest('[data-cite]');
    if (cite) emit('album', { craft: cite.dataset.citeCraft, id: cite.dataset.cite });
    if (e.target.closest('[data-open-album]')) emit('album', { craft: craftNow() });
  });

  // 手动工具
  const bump = () => Math.max(1, session.getSession().state.step);
  $('steps').addEventListener('click', e => {
    const b = e.target.closest('[data-step]');
    if (b) session.commit({ step: Number(b.dataset.step) });
  });
  $('shape-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-shape]');
    if (b) session.commit({ shape: b.dataset.shape });
  });
  $('pattern-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-pattern]');
    if (b) session.commit({ pattern: b.dataset.pattern, step: bump() });
  });
  $('swatches').addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    // 瓷器的釉色属于第二道工序；剪纸在第一道就选纸色
    session.commit(craftNow() === 'ceramic' ? { color: b.dataset.color, step: bump() } : { color: b.dataset.color });
  });
  const sliderPatch = value => (craftNow() === 'ceramic' ? { width: value / 100 } : { complexity: value / 100 });
  $('sculpt-slider').addEventListener('input', e => session.preview(sliderPatch(Number(e.target.value))));
  $('sculpt-slider').addEventListener('change', e => {
    const patch = sliderPatch(Number(e.target.value));
    if (craftNow() === 'paper') patch.step = bump();
    session.commit(patch);
  });
  $('undo').addEventListener('click', () => { if (session.undo()) toast('已撤销，可以重做'); });
  $('redo').addEventListener('click', () => session.redo());
  $('reset-work').addEventListener('click', async () => {
    const ok = await confirmAction('重置整件作品？', '作品会回到初始状态。重置后仍可以撤销。', '重置');
    if (ok && session.commit({ ...CRAFTS[craftNow()].defaultState, ...(craftNow() === 'ceramic' ? { pottery: null } : {}) })) toast('已重置，可以撤销');
  });
  $('next-step').addEventListener('click', () => {
    const s = session.getSession().state;
    if (s.step >= STEP_COUNT - 1) return;
    session.commit({ step: s.step + 1 });
    const craft = craftNow();
    emit('voice-note', { craft, text: CRAFTS[craft].copy[s.step + 1], cite: [{ craft, id: CRAFTS[craft].steps[s.step + 1].album }] });
  });
  $('process-album').addEventListener('click', () => {
    const craft = craftNow();
    emit('album', { craft, id: CRAFTS[craft].steps[session.getSession().state.step].album });
  });

  // 完成作品：拍一张成品照，命名后收进「我的作品」
  $('finish-work').addEventListener('click', () => {
    const craft = craftNow();
    const ss = session.getSession();
    fillPhoto($('complete-art'), craft, ss.state, { finished: true });
    const record = ss.id ? findRecordName(ss.id) : null;
    $('work-name').value = !record || record.includes('未命名') ? `${CRAFT_NAMES[craft]} · 我的心意` : record;
    $('finish-dialog').showModal();
    $('work-name').focus();
    $('work-name').select();
  });
  $('finish-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('work-name').value.trim();
    if (!name) {
      $('work-name').setCustomValidity('请给作品起一个名字');
      $('work-name').reportValidity();
      return;
    }
    $('work-name').setCustomValidity('');
    session.commit({ step: STEP_COUNT - 1 });
    session.saveCurrent('done', name);
    $('finish-dialog').close();
    play('reveal');
    toast('作品已收进「我的作品」');
    emit('say', `「${name}」已经收好了。可以下载图片、复制介绍，或者准备实物制作。`);
    showView('gallery');
  });
  $('work-name').addEventListener('input', () => $('work-name').setCustomValidity(''));

  // 状态联动
  on('chat', onChat);
  on('work', ({ animate }) => {
    if (currentView() !== 'workshop') return;
    if (mode === 'create') renderWork();
    syncStage(animate);
  });
  on('preview', state => {
    if (studio) studio.show(craftNow(), state);
    else syncFallback(state);
  });
  on('saved', ({ ok, status }) => {
    $('save-status').textContent = ok ? (status === 'done' ? '完成作品已保存在本机' : '草稿已自动保存在本机') : '尚未保存 · 请下载留存';
  });
  on('view', ({ view }) => {
    if (view === 'workshop') { lastShown = null; showMode(); syncStage(false); }
    else {
      studio?.setActive(false);
      document.body.dataset.workshop = '';
    }
  });
  on('settings', ({ key }) => {
    if (key === 'motion') studio?.setReduced(reducedMotion());
  });
}

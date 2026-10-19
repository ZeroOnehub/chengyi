// 承艺之声：右下角的对话入口，山河、工坊、我的作品都能打开，一路只有一份对话记录。
// 改作品、撤销、下一步、跑题走规则（assistant.js）；知识问答和其余的话交给大模型后台（backend.js），
// 后台根据此刻所在的场景（context.js）检索非遗知识库。后台不可用或「模拟 AI 不可用」时退回规则版。

import { $, esc, toast } from '../core/dom.js';
import { emit, on } from '../core/bus.js';
import { currentView } from '../core/router.js';
import { get, reducedMotion } from '../core/settings.js';
import * as session from '../core/session.js';
import { CRAFTS, CRAFT_NAMES } from '../data/crafts.js';
import { LOCAL_KINDS, guideRespond, quickOptions, respond } from '../ai/assistant.js';
import * as backend from '../ai/backend.js';
import * as pottery from '../ai/pottery.js';
import * as audio from '../ai/audio.js';
import { describe, workNote } from '../ai/context.js';
import { play } from '../fx/sound.js';
import { getFocus } from './explore.js';
import { citeButton, getMode } from './workshop.js';

const MAX_MESSAGES = 60;
const ORB_LABEL = {
  idle: '在这儿，等你开口',
  thinking: '正在理解…',
  searching: '正在查非遗知识库…',
  done: '好了',
  error: '暂时休息，可以用快捷选项继续',
};
const DISCLAIMER = {
  up: '大模型依据非遗知识库作答，可能有误 · 改作品仍由你确认',
  unknown: '正在连接讲解后台…',
  down: '没连上讲解后台，现为规则演示 · 知识回答只引用册页',
  off: '规则演示，未接入大模型 · 知识回答只引用册页',
  demo: '尚未配置大模型，当前提供演示回答。',
};

const messages = [];
const greeted = new Set();
let lastKey = null;
let busy = false;
let recordingBusy = false, activeRequest = null, recordingControls = null;
const downloads = [];

const isOpen = () => !$('chat-panel').hidden;

// 此刻在哪：场景、工坊模式、品类、产地、作品状态
function here() {
  const view = currentView();
  if (view === 'workshop') {
    const craft = session.getActiveCraft();
    return describe({ view, mode: getMode(), craft });
  }
  if (view === 'explore') {
    const f = getFocus();
    return describe({ view, region: f.level === 'focus' ? f.region : null, craft: f.craft });
  }
  return describe({ view });
}

function push(msg) {
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages.shift();
  return msg;
}

// 场景变了，先记一条分隔；第一次来到某处时打个招呼
function enter(ctx) {
  if (ctx.key === lastKey) return;
  if (messages.length) push({ role: 'divider', text: ctx.label });
  if (!greeted.has(ctx.key)) {
    greeted.add(ctx.key);
    push({ role: 'ai', text: ctx.greeting });
  }
  lastKey = ctx.key;
}

// —— 渲染 ——
let orbTimer;
function setOrb(state) {
  clearTimeout(orbTimer);
  $('orb').dataset.state = state === 'searching' ? 'thinking' : state;
  $('orb-label').textContent = ORB_LABEL[state];
  if (state === 'done') orbTimer = setTimeout(() => setOrb('idle'), 1400);
}

function renderDisclaimer() {
  $('chat-disclaimer').textContent = DISCLAIMER[backend.status()];
}

const aiText = text => esc(text.replace(/\*\*/g, ''));

function bubble(m, i) {
  if (m.role === 'divider') return `<p class="message-divider"><span>${esc(m.text)}</span></p>`;
  if (m.role === 'user') return `<div class="message user"><span>${esc(m.text)}</span></div>`;
  const cites = (m.cite || []).map(x => citeButton(x.craft, x.id)).join('');
  const sources = m.sources?.length
    ? `<p class="kb-source">查阅：非遗知识库 · ${m.sources.map(t => `《${esc(t)}》`).join('')}</p>` : '';
  const proposal = m.proposal
    ? `<div class="proposal"><span>${esc(m.proposal.summary)}</span>${m.proposal.applied
      ? '<span class="applied">已应用到作品，可以撤销</span>'
      : `<button class="secondary" data-apply="${i}" ${busy ? 'disabled' : ''}>应用建议，看看效果</button>`}</div>`
    : '';
  const quick = m.quick
    ? `<div class="quick">${m.quick.map((q, j) => `<button data-quick="${i}:${j}">${esc(q.label)}</button>`).join('')}${m.retry ? `<button data-retry="${i}">重新尝试</button>` : ''}</div>`
    : '';
  const albumLink = m.openAlbum ? '<div class="cites"><button class="cite" data-open-album>翻翻册页</button></div>' : '';
  const body = m.pending && !m.text ? '<em class="typing">正在查非遗知识库…</em>' : aiText(m.text);
  return `<div class="message ai ${m.error ? 'error' : ''}" data-i="${i}"><strong>承艺之声${m.error ? ' · 暂时休息' : ''}</strong>`
    + `${m.note ? `<small class="ai-note">${esc(m.note)}</small>` : ''}<span>${body}</span>`
    + `${cites ? `<div class="cites">${cites}</div>` : ''}${sources}${albumLink}${proposal}${quick}`
    + `${(m.files || []).map(file => `<a class="artifact-download" href="${file.url}" download="${esc(file.filename)}">下载 ${esc(file.filename)}</a>`).join('')}</div>`;
}

function render() {
  if (!isOpen()) return;
  const ctx = here();
  $('messages').innerHTML = messages.map(bubble).join('');
  $('messages').scrollTop = $('messages').scrollHeight;
  $('chat-prompts').innerHTML = ctx.prompts.map(x => `<button data-prompt="${esc(x)}">${esc(x)}</button>`).join('');
  $('chat-input').placeholder = ctx.create ? CRAFTS[ctx.craft].placeholder : '想知道什么，都可以问我';
  $('chat-form').querySelector('button').disabled = busy || recordingBusy;
  $('chat-record').disabled = busy;
  renderDisclaimer();
}

// 流式回答只更新正在写的那一条，不重绘整列
function renderStreaming(msg) {
  const el = $('messages').querySelector(`[data-i="${messages.indexOf(msg)}"] > span`);
  if (!el) return;
  el.innerHTML = msg.text ? aiText(msg.text) : '<em class="typing">正在查非遗知识库…</em>';
  $('messages').scrollTop = $('messages').scrollHeight;
}

export function setChat(open) {
  $('chat-panel').hidden = !open;
  $('voice-toggle').hidden = open;
  $('voice-toggle').setAttribute('aria-expanded', String(open));
  if (open) {
    enter(here());
    render();
    $('chat-input').focus({ preventScroll: true });
    backend.ready().then(renderDisclaimer);
  } else {
    audio.stop();
    void recordingControls?.cancelRecording();
  }
  emit('chat', { open });
}

// —— 回答 ——
const pause = () => new Promise(r => setTimeout(r, reducedMotion() ? 120 : 650));

function pushLocal(r, craft, note) {
  const state = craft && session.getSession(craft).state;
  push({
    role: 'ai',
    text: r.reply,
    craft,
    note,
    proposal: r.proposal || null,
    cite: r.cite,
    quick: r.quick && state ? quickOptions(craft, state) : null,
    openAlbum: r.openAlbum,
  });
}

async function askModel(ctx, clean, fallback) {
  const msg = push({ role: 'ai', text: '', pending: true, craft: ctx.craft });
  setOrb('searching');
  render();
  const question = ctx.create ? `${workNote(ctx.craft, session.getSession(ctx.craft).state)}${clean}` : clean;
  try {
    const result = await backend.ask({
      item: ctx.item,
      question,
      onDelta: t => { msg.text += t; renderStreaming(msg); },
      onReset: () => { msg.text = ''; audio.stop(); renderStreaming(msg); },
      voice: audio.enabled(), onAudio: audio.receive, signal: activeRequest?.signal,
    });
    // fallback 是后台在模型失败时拼的资料讲解，不如册页规则版贴切，改用规则版
    if (result.mode !== 'live') throw new backend.AIError(`mode_${result.mode}`);
    msg.text = result.text;
    msg.sources = backend.knowledgeTitles(result.sources);
    msg.pending = false;
  } catch (e) {
    if (activeRequest?.signal.aborted) {
      msg.pending = false; msg.text = msg.text || '请求已停止。'; return;
    }
    messages.splice(messages.indexOf(msg), 1);
    pushLocal(fallback, ctx.craft, '讲解后台这次没有回应，先用册页回答');
  }
}

export async function sendPrompt(text) {
  const clean = text.trim();
  if (!clean || busy || recordingBusy) return;
  audio.stop(); audio.unlock(); activeRequest = new AbortController();
  const ctx = here();
  enter(ctx);
  busy = true;
  push({ role: 'user', text: clean });
  $('chat-input').value = '';
  render();
  setOrb('thinking');
  try {
    const craft = ctx.craft;
    if (get('aiDown') === 'on') {
      await pause();
      const state = ctx.create && session.getSession(craft).state;
      push({
        role: 'ai', error: true, craft, retry: clean,
        text: ctx.create ? '师傅暂时休息了，先用下面的快捷选项或手动工具继续，作品不受影响。' : '师傅暂时休息了，过一会儿再问我。可以先翻翻册页。',
        quick: state ? quickOptions(craft, state) : null,
        openAlbum: !ctx.create,
      });
      setOrb('error');
      play('error');
      return;
    }
    const local = ctx.create ? respond(clean, craft, session.getSession(craft).state) : guideRespond(clean, craft);
    if (ctx.create && craft === 'ceramic' && pottery.wantsPottery(clean, local) && await backend.ready()) {
      try {
        const result = await pottery.plan(clean, local, activeRequest.signal);
        push({ role: 'ai', craft, text: result.text, proposal: result.proposal || null });
        if (result.command && audio.enabled()) void narrate(result);
      } catch (error) {
        if (!activeRequest.signal.aborted) push({ role: 'ai', craft, text: `这次没有修改作品：${error.message}`, error: true });
      }
    } else if (!LOCAL_KINDS.has(local.kind) && await backend.ready()) await askModel(ctx, clean, local);
    else {
      await pause();
      pushLocal(local, craft);
    }
    setOrb('done');
    play('tap');
  } finally {
    busy = false; activeRequest = null;
    render();
  }
}

async function narrate(result) {
  const controller = audio.controller();
  try { await pottery.speak(result.command, result.binding, audio.receive, controller.signal); }
  catch (error) { if (!controller.signal.aborted) toast(`作品操作已完成，朗读未完成：${error.message}`); }
}

// —— 初始化 ——
export function initVoice() {
  recordingControls = audio.install({ send: sendPrompt, canStart: () => !busy && !recordingBusy,
    onRecording: value => { recordingBusy = value; render(); },
    onStop: () => { activeRequest?.abort(); void pottery.cancelPending().catch(() => {}); } });
  $('voice-toggle').addEventListener('click', () => setChat(true));
  $('chat-close').addEventListener('click', () => setChat(false));
  $('chat-form').addEventListener('submit', e => { e.preventDefault(); sendPrompt($('chat-input').value); });
  $('chat-prompts').addEventListener('click', e => {
    const b = e.target.closest('[data-prompt]');
    if (b) sendPrompt(b.dataset.prompt);
  });
  $('messages').addEventListener('click', async e => {
    const apply = e.target.closest('[data-apply]');
    if (apply) {
      const msg = messages[Number(apply.dataset.apply)];
      if (!msg?.proposal || msg.proposal.applied || busy) return;
      if (msg.craft !== session.getActiveCraft()) { toast(`回到${CRAFT_NAMES[msg.craft]}创作台再应用`); return; }
      if (msg.proposal.kind === 'pottery') {
        if (!here().create) { toast('回到当前瓷器创作台再应用'); return; }
        busy = true; render(); audio.stop(); audio.unlock();
        try {
          const result = await pottery.apply(msg.proposal);
          const completed = push({ role: 'ai', craft: 'ceramic', text: result.text });
          completed.files = (result.artifacts || []).map(file => {
            const url = URL.createObjectURL(file.blob); downloads.push(url); return { url, filename: file.filename };
          });
          if (audio.enabled()) void narrate(result);
          play('confirm');
        } catch (error) { toast(error.message); }
        finally { busy = false; render(); }
        return;
      }
      if (msg.proposal.kind === 'undo') session.undo();
      else if (!session.commit(msg.proposal.patch)) toast('当前作品已符合这组设置');
      msg.proposal.applied = true;
      play('confirm');
      render();
      return;
    }
    const quick = e.target.closest('[data-quick]');
    if (quick) {
      const [mi, qi] = quick.dataset.quick.split(':').map(Number);
      const msg = messages[mi];
      const option = msg?.quick?.[qi];
      if (!option) return;
      if (msg.craft !== session.getActiveCraft()) { toast(`回到${CRAFT_NAMES[msg.craft]}创作台再修改`); return; }
      if (session.commit(option.patch)) {
        push({ role: 'ai', text: `已按「${option.label}」修改，可以撤销。` });
        render();
      }
      return;
    }
    const retry = e.target.closest('[data-retry]');
    if (retry) sendPrompt(messages[Number(retry.dataset.retry)].retry);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen() && !document.querySelector('dialog[open]')) setChat(false);
  });

  // 工坊里点「下一步」时，承艺之声顺带讲一句这道工序
  on('voice-note', ({ text, craft, cite }) => {
    enter(here());
    push({ role: 'ai', text, craft, cite });
    render();
  });
  on('chat-close', () => { if (isOpen()) setChat(false); });
  on('view', () => { audio.stop(); activeRequest?.abort(); void recordingControls?.cancelRecording();
    if (isOpen()) { enter(here()); render(); } });
  on('settings', ({ key }) => { if (key === 'sound') { $('chat-read').checked = audio.enabled(); if (!audio.enabled()) audio.stop(); } });
  window.addEventListener('pagehide', () => { for (const url of downloads) URL.revokeObjectURL(url); });
  setOrb('idle');
}

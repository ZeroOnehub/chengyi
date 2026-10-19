// 结构化陶艺指令：后台规划 → 用户确认 → 实际渲染 → 执行回执。
import * as backend from './backend.js';
import * as session from '../core/session.js';
import { emit } from '../core/bus.js';
import { fromDocument, geometry, toDocument } from '../core/pottery.js';

let active = null;
let serial = Promise.resolve();
let poseProvider = () => null;
let effectExecutor = async () => [];
export const setPotteryStage = (pose, effects) => { poseProvider = pose; effectExecutor = effects; };
const clone = value => JSON.parse(JSON.stringify(value));
const fingerprint = state => JSON.stringify(state);
const queued = fn => { const next = serial.then(fn, fn); serial = next.catch(() => {}); return next; };
const route = suffix => `/workbenches/${active.project.id}${suffix || ''}`;
const accept = value => { active.project = value.project; return value; };

export function wantsPottery(text, local) {
  if (['offtopic', 'step', 'undo', 'next', 'refuse'].includes(local.kind)) return false;
  if (/为什么|怎么做|怎么烧|是什么|来历|历史|寓意|讲讲|介绍/.test(text) && !/改成|换成|做个|做一|帮我调整/.test(text)) return false;
  const patch = local.proposal?.patch;
  if (local.kind === 'edit' && patch && !patch.shape && !patch.width
    && !/光泽|哑光|亮|尺寸|厘米|高度|瓶口|瓶颈|瓶肩|肚|底部/.test(text)) return false;
  return local.kind === 'clarify' || /爱心|心形|三角|方形|椭圆|星形|五角星|水滴|花瓣|瓶|碗|罐|杯|厘米|高度|直径|轮廓|形状|上面|中间|下边|左边|右边|细颈|圆肚|收|窄|宽|鼓|凹|抚平|光泽|哑光|转盘|俯视|导出|保存|古朴/.test(text);
}

async function ensure() {
  const ss = session.getSession('ceramic');
  if (!ss.id) session.saveCurrent();
  const key = `chengyi-pottery-session:${backend.backendOrigin()}:${ss.id}`;
  if (active?.key === key) return active;
  let stored;
  try { stored = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* 新建 */ }
  if (stored) {
    try {
      const value = await backend.request(`/workbenches/${stored.id}`, undefined, stored.token);
      active = { key, project: value.project, token: stored.token };
      return active;
    } catch (error) { if (![404, 410].includes(error.status)) throw error; }
  }
  const value = await backend.request('/workbenches', { document: toDocument(ss.state) });
  active = { key, project: value.project, token: value.session_token };
  try { sessionStorage.setItem(key, JSON.stringify({ id: value.project.id, token: value.session_token })); } catch { /* 仅本页 */ }
  return active;
}

async function synchronize() {
  const target = session.getSession('ceramic');
  await ensure();
  if (session.getSession('ceramic') !== target || session.getActiveCraft() !== 'ceramic') throw Error('当前作品已切换，请重新提出调整。');
  accept(await backend.request(route('/cancel'), {}, active.token));
  const snapshot = fingerprint(target.state);
  const doc = toDocument(target.state);
  const pose = poseProvider(true);
  if (pose) { doc.wheel = { ...doc.wheel, ...pose.wheel }; doc.view = { ...doc.view, ...pose.view }; }
  accept(await backend.request(route('/sync'), { expected_revision: active.project.revision,
    client_request_id: crypto.randomUUID(), document: doc }, active.token));
  if (session.getSession('ceramic') !== target || fingerprint(target.state) !== snapshot) throw Error('作品已经修改，请重新提出调整。');
  return snapshot;
}

function summary(command, extra) {
  const doc = command.document, shape = { vase: '花瓶', jar: '罐', bowl: '碗', cup: '杯' }[doc.preset];
  const size = geometry.stats(doc);
  let text = `${shape}，高度 ${doc.height.toFixed(1)} 厘米，最大宽度 ${size.diameter_cm.toFixed(1)} 厘米，俯视为${geometry.NAMES[doc.cross_section.shape]}。`;
  if (doc.section_bands.length) text += `保留 ${doc.section_bands.length} 处部位轮廓。`;
  if (doc.deformations.length) text += `包含 ${doc.deformations.length} 处局部塑形。`;
  if (extra?.pattern) text += '同时应用所选纹样。';
  for (const effect of command.effects) if (effect.type === 'export_artifact') text += `导出 ${effect.format.toUpperCase()} 文件。`;
  return text;
}

export function plan(text, local, signal) {
  return queued(async () => {
    const before = await synchronize();
    const ss = session.getSession('ceramic');
    const extra = local.proposal?.patch?.pattern ? { pattern: local.proposal.patch.pattern, step: Math.max(1, ss.state.step) } : {};
    const requestText = extra.pattern ? `请规划请求中的器形和材质调整；纹样将在用户确认时由前端一并应用。用户请求：${text}` : text;
    const value = await backend.request(route('/commands'), { text: requestText,
      expected_revision: active.project.revision, client_request_id: crypto.randomUUID() }, active.token, signal);
    accept(value);
    if (fingerprint(ss.state) !== before) { await backend.request(route('/cancel'), {}, active.token); throw Error('作品已经修改，请重新提出调整。'); }
    const command = value.command;
    if (command.status !== 'pending') {
      poseProvider(false);
      return { text: command.message, command, binding: active.key };
    }
    return { text: '已经准备好下面这组修改，确认后会应用到当前作品。',
      proposal: { kind: 'pottery', summary: summary(command, extra), command,
        record: ss.id, binding: active.key, before, extra, applied: false } };
  }).catch(error => { poseProvider(false); throw error; });
}

export function apply(proposal) {
  return queued(async () => {
    const ss = session.getSession('ceramic');
    if (session.getActiveCraft() !== 'ceramic' || ss.id !== proposal.record || active?.key !== proposal.binding
      || fingerprint(ss.state) !== proposal.before) throw Error('作品已经发生变化，请重新提出调整。');
    const command = proposal.command;
    const current = await backend.request(route(), undefined, active.token);
    accept(current);
    if (command.revision !== active.project.revision || Date.parse(command.expires_at) <= Date.now()
      || !current.pending.some(item => item.id === command.id)) throw Error('这条建议已过期，请重新提出调整。');
    const before = clone({ state: ss.state, history: ss.history, future: ss.future });
    const patch = fromDocument(command.document, ss.state);
    if (patch.color !== ss.state.color) patch.step = Math.max(1, ss.state.step);
    Object.assign(patch, proposal.extra);
    document.body.classList.add('pottery-applying');
    try {
      const changesShape = command.actions.some(action => !['get_workbench_state', 'save_project', 'export_artifact'].includes(action.tool));
      session.commit(patch, { remember: changesShape || Boolean(proposal.extra.pattern) });
      const artifacts = await effectExecutor(command.effects);
      const receipt = { expected_revision: command.revision, status: 'applied', document: toDocument(ss.state),
        artifacts: artifacts.map(({ format, filename, bytes }) => ({ format, filename, bytes })) };
      let result;
      try { result = await backend.request(route(`/commands/${command.id}/receipt`), receipt, active.token); }
      catch (error) {
        // Re-send the same receipt after a lost connection; the backend makes it idempotent.
        if (error.status) throw error;
        result = await backend.request(route(`/commands/${command.id}/receipt`), receipt, active.token);
      }
      accept(result);
      proposal.applied = true;
      if (command.effects.some(effect => effect.type === 'save_project')) session.saveCurrent(undefined, command.document.name);
      return { text: command.message, artifacts, command, binding: active.key };
    } catch (error) {
      // Restore the latest confirmed backend state if a receipt committed but its response was lost.
      let confirmed = false;
      try {
        const value = await backend.request(route(), undefined, active.token);
        accept(value);
        confirmed = fingerprint(value.project.document) === fingerprint(command.document) && value.project.revision > command.revision;
      } catch { /* keep local rollback below */ }
      if (!confirmed) {
        ss.state = before.state; ss.history = before.history; ss.future = before.future;
        session.saveCurrent();
        emit('work', {});
      } else proposal.applied = true;
      if (!confirmed) throw error;
      return { text: command.message, command, binding: active.key };
    } finally { document.body.classList.remove('pottery-applying'); poseProvider(false); }
  });
}

export async function speak(command, binding, onAudio, signal) {
  if (!active || active.key !== binding) return;
  const response = await fetch(backend.api(route('/speech')), { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': active.token }, body: JSON.stringify({ command_id: command.id }) });
  if (!response.ok) throw Error((await response.json()).error?.message || '声音生成失败');
  await backend.readStream(response, { voice: true, onAudio });
}

export function cancelPending() {
  poseProvider(false);
  if (!active) return Promise.resolve();
  return queued(async () => accept(await backend.request(route('/cancel'), {}, active.token)));
}

// 按住说话：16kHz WAV转写；回复用后台24kHz PCM边到边播。
import '../vendor/pcm-player.js';
import * as backend from './backend.js';
import { get, set } from '../core/settings.js';
import { toast } from '../core/dom.js';

const label = text => { const node = document.getElementById('voice-status'); if (node) node.textContent = text; };
const player = new window.HeritagePCMPlayer({ onStart: () => label('正在朗读…'), onFinish: () => label(''),
  onBlocked: () => label('点击“朗读回复”后继续播放。') });
let audioRequest = null, held = false, recording = null, preparing = false;
export const enabled = () => get('sound') === 'on';
export const unlock = () => player.unlock();
export function stop() { audioRequest?.abort(); audioRequest = null; player.reset(); label(''); }
export function receive(event, data) {
  if (!enabled()) return;
  if (event === 'audio_chunk') player.append(data);
  if (event === 'voice_done') player.finish();
  if (event === 'speech_error') { player.finish(); label(data.message || '声音生成失败，文字仍可查看。'); }
}
export function controller() { stop(); player.unlock(); audioRequest = new AbortController(); return audioRequest; }

function wav(parts, total) {
  const bytes = new ArrayBuffer(44 + total * 2), view = new DataView(bytes);
  const word = (offset, value) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, total * 2, true);
  let offset = 44;
  for (const part of parts) for (const raw of part) {
    const sample = Math.max(-1, Math.min(1, raw));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export function install({ send, canStart, onRecording, onStop }) {
  const button = document.getElementById('chat-record'), read = document.getElementById('chat-read');
  read.checked = enabled();
  read.addEventListener('change', () => { set('sound', read.checked ? 'on' : 'off'); if (!read.checked) stop(); else player.unlock(); });
  document.getElementById('chat-stop').addEventListener('click', () => { stop(); void finish(false); onStop(); });

  async function begin() {
    if (recording || !canStart()) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { toast('录音需要通过 HTTPS 或本机地址打开工作台。'); return; }
    held = true; preparing = true; stop(); player.unlock(); onRecording(true); label('正在准备麦克风…');
    let context, stream, node;
    try {
      context = new AudioContext({ sampleRate: 16000 }); await context.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (!held) { stream.getTracks().forEach(track => track.stop()); await context.close(); onRecording(false); return; }
      if (context.sampleRate !== 16000) throw Error('当前浏览器不支持录音格式，请使用新版 Chrome。');
      await context.audioWorklet.addModule(new URL('../vendor/recording-worklet.js', import.meta.url));
      if (!held) { stream.getTracks().forEach(track => track.stop()); await context.close(); onRecording(false); return; }
      const source = context.createMediaStreamSource(stream);
      node = new AudioWorkletNode(context, 'heritage-recorder');
      const active = { context, stream, node, source, parts: [], total: 0 }; recording = active;
      node.port.onmessage = event => {
        if (recording !== active) return;
        if (event.data.flushed) { active.flush?.(); return; }
        const part = event.data.subarray(0, 480000 - active.total); active.parts.push(part); active.total += part.length;
        label(`正在录音 ${(active.total / 16000).toFixed(1)} 秒`);
        if (active.total >= 480000) void finish(true);
      };
      source.connect(node); node.connect(context.destination);
      button.textContent = '松开发送'; button.classList.add('recording');
    } catch (error) {
      held = false; stream?.getTracks().forEach(track => track.stop()); node?.disconnect();
      await context?.close().catch(() => {}); recording = null; onRecording(false);
      label(error.name === 'NotAllowedError' ? '麦克风权限未开启。' : error.message);
    } finally { preparing = false; }
  }

  async function finish(sendNow) {
    held = false;
    const active = recording;
    if (!active) { if (!preparing) onRecording(false); return; }
    if (!sendNow) active.cancelled = true;
    if (active.finishing) return;
    active.finishing = true;
    await new Promise(resolve => { active.flush = resolve; active.node.port.postMessage('flush'); setTimeout(resolve, 150); });
    recording = null; active.node.port.onmessage = null; active.source.disconnect(); active.node.disconnect();
    active.stream.getTracks().forEach(track => track.stop()); await active.context.close().catch(() => {});
    button.textContent = '按住说话'; button.classList.remove('recording');
    if (!sendNow || active.cancelled || active.total < 3200) {
      onRecording(false); label(active.total < 3200 ? '录音太短，请重新说一次。' : '录音已取消。'); return;
    }
    const request = controller(); label('正在识别语音…');
    try {
      const text = await backend.transcribe(wav(active.parts, active.total), request.signal);
      if (!text?.trim()) throw Error('没有识别到文字，请重新说一次。');
      onRecording(false); label(''); await send(text);
    } catch (error) { onRecording(false); if (!request.signal.aborted) label(error.message); }
  }
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); if (!canStart()) return;
    button.setPointerCapture(event.pointerId); void begin();
  });
  button.addEventListener('pointerup', () => void finish(true));
  button.addEventListener('pointercancel', () => void finish(false));
  button.addEventListener('keydown', event => { if (['Space', 'Enter'].includes(event.code) && !event.repeat) { event.preventDefault(); void begin(); } });
  button.addEventListener('keyup', event => { if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); void finish(true); } });
  window.addEventListener('pagehide', () => { void finish(false); stop(); player.destroy(); });
  return { cancelRecording: () => finish(false) };
}

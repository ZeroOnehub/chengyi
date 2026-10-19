// 摄影棚：一面无缝背景纸、一扇窗光、柔和的接触阴影。工坊创作台与作品照片共用这个场景，
// 器物看起来就像在自然光下拍的实物。瓷器从施釉进入烧成时，有一段入窑升温、出窑冷却的过程。

import * as THREE from 'three';
import { buildSubject, disposeSubject } from './craftmesh.js';
import { backdropMap, contactShadow } from './textures.js';
import { toDocument } from '../core/pottery.js';

const BACKDROP = '#e8e1d6';

// 反射环境：一扇大窗、一条顶灯、一块冷色补光板。釉面上能看到窗的高光
function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  const wall = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d9d2c6').multiplyScalar(0.55), side: THREE.BackSide });
  env.add(new THREE.Mesh(new THREE.BoxGeometry(24, 12, 24), wall));
  const light = (w, h, intensity, color, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  light(7, 5, 7, '#fff3e2', [-11.5, 3, 2], [0, 1, 0]);     // 左侧窗
  light(1.2, 4, 3, '#fff3e2', [-11.4, 3, -3.5], [0, 1, 0]); // 窗棂外的另一格
  light(9, 1.4, 2.2, '#ffffff', [0, 5.8, 0], [0, 0, 0]);    // 顶光
  light(4, 5, 1.4, '#e6eefc', [11.5, 2, -3], [0, 1, 0]);    // 右侧冷补光
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e0d6c4').multiplyScalar(0.9) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -5.9;
  env.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

// 无缝背景纸：地面在器物后方弯成立面，看不到接缝
function makeSweep() {
  const z0 = -2.2, R = 4.5;
  const line = [];
  for (let i = 0; i <= 6; i++) line.push([10 - (i / 6) * (10 - z0), 0]);
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 2);
    line.push([z0 - Math.sin(a) * R, R - Math.cos(a) * R]);
  }
  for (let i = 1; i <= 6; i++) line.push([z0 - R, R + i * 2.5]);
  const pos = [], uv = [], idx = [];
  const cols = 2;
  let run = 0;
  line.forEach(([z, y], j) => {
    if (j) run += Math.hypot(z - line[j - 1][0], y - line[j - 1][1]);
    for (let c = 0; c <= cols; c++) {
      const x = -24 + (48 * c) / cols;
      pos.push(x, y, z);
      uv.push(x / 8, run / 8);
    }
  });
  for (let j = 0; j < line.length - 1; j++) {
    for (let c = 0; c < cols; c++) {
      const a = j * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: BACKDROP, roughness: 0.96, bumpMap: backdropMap(), bumpScale: 0.6, envMapIntensity: 0.55, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);

export function createStudio(canvas, { interactive = true, preserve = false, pixelRatio } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(pixelRatio || Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKDROP);
  scene.environment = makeEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);

  // 窗光（主光）：从左前上方斜落，投下柔和的影子
  const key = new THREE.DirectionalLight('#fff1de', 2.4);
  key.position.set(-8, 8, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 30 });
  key.shadow.radius = 5;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.HemisphereLight('#eef0f2', '#b9ad98', 0.35);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#dfe8ff', 0.7);
  rim.position.set(5, 4, -5);
  scene.add(rim);
  // 入窑时的炉火
  const kiln = new THREE.PointLight('#ff6a1f', 0, 12, 1.6);
  kiln.position.set(0.6, 1.4, 2.2);
  scene.add(kiln);

  const sweep = makeSweep();
  scene.add(sweep);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#2a2016', alphaMap: contactShadow(), transparent: true, depthWrite: false, opacity: 0.55 }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.003;
  scene.add(contact);

  // —— 主体 ——
  let subject = null;
  let subjectKey = '';
  let current = { craft: null, state: null };
  let firing = null;

  // —— 镜头 ——
  const view = { yaw: 0.35, pitch: 0, zoom: 1, shiftX: 0, shiftY: 0, tShiftX: 0, tShiftY: 0 };
  const frame = { target: new THREE.Vector3(0, 1, 0), dist: 9, elev: 0.16, mode: 'create' };
  let reduced = false;
  let active = false, raf = 0, last = 0;
  let wheelHeld = false;
  let width = 1, height = 1;

  function fitCamera() {
    if (!subject) return;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    if (subject.kind === 'paper') {
      frame.elev = 0.98;
      frame.target.set(0, 0, 0);
      const span = subject.radius * 2.7;
      frame.dist = span / (2 * Math.tan(fov / 2)) / Math.min(1, camera.aspect * 0.9);
    } else {
      frame.elev = 0.2;
      const h = subject.height;
      frame.target.set(0, h * 0.5, 0);
      const elevation = THREE.MathUtils.clamp(frame.elev + view.pitch, .05, 1.545);
      const vertical = h * Math.cos(elevation) + subject.radius * 2 * Math.sin(elevation);
      const safeHeight = interactive ? .64 : .86;
      const safeWidth = interactive && frame.mode === 'chat' ? .60 : interactive && frame.mode === 'intro' ? .60 : .9;
      const span = Math.max(vertical / safeHeight, subject.radius * 2 / (Math.max(.5, camera.aspect) * safeWidth)) * 1.08;
      frame.dist = span / (2 * Math.tan(fov / 2));
    }
  }

  function placeCamera() {
    const elev = THREE.MathUtils.clamp(frame.elev + view.pitch, 0.05, 1.545);
    const d = frame.dist / view.zoom;
    camera.position.set(0, frame.target.y + Math.sin(elev) * d, frame.target.z + Math.cos(elev) * d);
    camera.lookAt(frame.target);
    if (view.shiftX || view.shiftY) camera.setViewOffset(width, height, -view.shiftX * width, -view.shiftY * height, width, height);
    else camera.clearViewOffset();
  }

  function resize(w, h) {
    width = Math.max(1, Math.round(w));
    height = Math.max(1, Math.round(h));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitCamera();
  }

  function setContact() {
    if (!subject) return;
    const s = subject.kind === 'paper' ? 0 : subject.footR * 3.2;
    contact.visible = s > 0 && !subject.wheel;
    contact.scale.set(s, s, 1);
  }

  function place(next) {
    if (subject) {
      scene.remove(subject.group);
      disposeSubject(subject);
    }
    subject = next;
    if (!subject) return;
    subject.spin.rotation.y = view.yaw;
    scene.add(subject.group);
    setContact();
    fitCamera();
  }

  function render() {
    placeCamera();
    renderer.render(scene, camera);
  }

  // —— 入窑：升温发红 → 换成烧成的釉 → 冷却显色 ——
  function setGlow(mats, k) {
    mats.forEach(m => {
      m.emissive.set('#ff5a14');
      m.emissiveIntensity = k * 2.4;
    });
    kiln.intensity = k * 26;
    key.intensity = 2.4 * (1 - k * 0.75);
    fill.intensity = 0.35 * (1 - k * 0.6);
    scene.background.set(BACKDROP).lerp(new THREE.Color('#3b2a20'), k * 0.85);
    sweep.material.color.set(BACKDROP).lerp(new THREE.Color('#5a3a26'), k * 0.85);
  }

  function runFiring(nextState) {
    return new Promise(resolve => {
      firing = { start: performance.now(), nextState, resolve, swapped: false };
      // 兜底：动画帧被暂停（标签页在后台等）时，也要按时出窑
      firing.timer = setTimeout(endFiring, 4200);
    });
  }

  function stepFiring(now) {
    if (!firing) return;
    const HEAT = 1300, COOL = 1900;
    const t = now - firing.start;
    if (t < HEAT) setGlow(subject.materials, ease(t / HEAT));
    else {
      if (!firing.swapped) {
        firing.swapped = true;
        place(buildSubject('ceramic', firing.nextState));
      }
      const k = 1 - easeOut(Math.min(1, (t - HEAT) / COOL));
      setGlow(subject.materials, k);
      if (k <= 0) endFiring();
    }
  }

  function endFiring() {
    if (!firing) return;
    const f = firing;
    firing = null;
    clearTimeout(f.timer);
    if (!f.swapped) place(buildSubject('ceramic', f.nextState));
    setGlow(subject.materials, 0);
    f.resolve();
  }

  function loop(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    stepFiring(now);
    // 陶车转动
    const potteryWheel = current.state?.pottery?.wheel;
    if (subject?.wheel && !reduced && !wheelHeld && potteryWheel?.rotating !== false) {
      const speed = potteryWheel ? potteryWheel.speed_rpm * Math.PI / 30 : 2.4;
      subject.spin.rotation.y += dt * speed;
      subject.wheel.spinner.rotation.y += dt * speed;
    } else if (subject && !dragging && !wheelHeld) {
      // 不拖动时，慢慢转回到用户选定的角度
      subject.spin.rotation.y += (view.yaw - subject.spin.rotation.y) * Math.min(1, dt * 6);
    }
    view.shiftX += (view.tShiftX - view.shiftX) * Math.min(1, dt * 3.5);
    view.shiftY += (view.tShiftY - view.shiftY) * Math.min(1, dt * 3.5);
    render();
    if (active) raf = requestAnimationFrame(loop);
  }

  // —— 交互 ——
  let dragging = false, lx = 0, ly = 0;
  if (interactive) {
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件 */ }
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging || !subject) return;
      view.yaw += (e.clientX - lx) * 0.01;
      view.pitch = THREE.MathUtils.clamp(view.pitch - (e.clientY - ly) * 0.004, -0.25, 0.5);
      if (!subject.wheel) subject.spin.rotation.y = view.yaw;
      lx = e.clientX;
      ly = e.clientY;
      if (!active) render();
    });
    const up = () => { dragging = false; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      view.zoom = THREE.MathUtils.clamp(view.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.8, 1.6);
      if (!active) render();
    }, { passive: false });
    canvas.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { view.yaw -= 0.25; e.preventDefault(); }
      if (e.key === 'ArrowRight') { view.yaw += 0.25; e.preventDefault(); }
      if (e.key === 'Home') { api.reset(); e.preventDefault(); }
      if (!active) render();
    });
    new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) {
        resize(r.width, r.height);
        if (!active) render();
      }
    }).observe(canvas);
  }

  const api = {
    // 同步作品。瓷器从施釉（第二道）进入烧成（第三道）时播放入窑过程，返回 Promise
    show(craft, state, { variant, animate = false } = {}) {
      const key = `${craft}|${variant || ''}|${JSON.stringify(state)}`;
      if (key === subjectKey) return Promise.resolve();
      if (firing) endFiring();
      const prev = current;
      subjectKey = key;
      current = { craft, state };
      wheelHeld = false;
      const fire = animate && !reduced && active && craft === 'ceramic' && prev.craft === 'ceramic'
        && prev.state?.step === 1 && state.step === 2 && prev.state.shape === state.shape;
      if (fire) return runFiring(state);
      place(buildSubject(craft, state, variant));
      if (craft === 'ceramic' && state.pottery) {
        const doc = toDocument(state);
        view.yaw = THREE.MathUtils.degToRad(doc.wheel.rotation_deg - doc.view.azimuth_deg);
        view.pitch = Math.PI / 2 - THREE.MathUtils.degToRad(doc.view.polar_deg) - frame.elev;
        view.zoom = doc.view.zoom_percent / 100;
        subject.spin.rotation.y = view.yaw;
        fitCamera();
      }
      if (!active) render();
      return Promise.resolve();
    },
    // 构图：intro 时器物偏右，给左侧文字留位置；chat 时偏左，给对话让位
    compose(mode, { immediate = false } = {}) {
      frame.mode = mode;
      fitCamera();
      view.tShiftX = mode === 'intro' ? 0.14 : mode === 'chat' ? -0.13 : 0;
      view.tShiftY = mode === 'intro' ? 0 : -0.035;
      if (immediate || reduced || !active) {
        view.shiftX = view.tShiftX;
        view.shiftY = view.tShiftY;
        if (!active) render();
      }
    },
    setActive(value) {
      if (value === active) return;
      active = value;
      if (active) { last = 0; raf = requestAnimationFrame(loop); }
      else {
        cancelAnimationFrame(raf);
        if (firing) endFiring();
      }
    },
    setReduced(value) { reduced = value; },
    rotate(delta) {
      view.yaw += delta;
      if (subject && !subject.wheel) subject.spin.rotation.y = view.yaw;
      if (!active) render();
    },
    reset() {
      view.yaw = 0.35;
      view.pitch = 0;
      view.zoom = 1;
      if (subject && !subject.wheel) subject.spin.rotation.y = view.yaw;
      if (!active) render();
    },
    resize(w, h) { resize(w, h); },
    render,
    // 静帧：给作品卡片、分享图用
    snapshot(w, h, { type = 'image/jpeg', quality = 0.9 } = {}) {
      resize(w, h);
      view.shiftX = view.tShiftX = 0;
      view.shiftY = view.tShiftY = 0;
      render();
      return renderer.domElement.toDataURL(type, quality);
    },
    isFiring: () => !!firing,
    potteryPose(held) {
      if (current.craft !== 'ceramic' || !subject) return null;
      if (typeof held === 'boolean') wheelHeld = held;
      const doc = toDocument(current.state), azimuth = doc.view.azimuth_deg;
      return { wheel: { ...doc.wheel, rotation_deg: ((THREE.MathUtils.radToDeg(subject.spin.rotation.y) + azimuth + 180) % 360 + 360) % 360 - 180 },
        view: { ...doc.view, polar_deg: THREE.MathUtils.clamp(90 - THREE.MathUtils.radToDeg(frame.elev + view.pitch), 1.43, 88),
          zoom_percent: THREE.MathUtils.clamp(view.zoom * 100, 57, 190) } };
    },
    async exportPottery(format) {
      if (current.craft !== 'ceramic' || !subject) throw Error('当前没有可导出的陶器。');
      const doc = toDocument(current.state), name = doc.name.replace(/[\\/:*?"<>|]/g, '_') || '承艺作品';
      let blob;
      if (format === 'json') blob = new Blob([JSON.stringify({ format: 'taowu-pottery', version: 2, ...doc }, null, 2)], { type: 'application/json' });
      else if (format === 'png') {
        render();
        const base64 = renderer.domElement.toDataURL('image/png').split(',')[1];
        blob = new Blob([Uint8Array.from(atob(base64), letter => letter.charCodeAt(0))], { type: 'image/png' });
      } else if (format === 'obj') {
        const body = subject.group.getObjectByName('pottery-body'), mesh = body?.geometry;
        if (!mesh) throw Error('三维网格未生成，无法导出。');
        const p = mesh.attributes.position, n = mesh.attributes.normal, uv = mesh.attributes.uv, index = mesh.index;
        const lines = ['# Chengyi pottery, units: centimeters', 'o ChengyiPottery'];
        for (let i = 0; i < p.count; i++) lines.push(`v ${(p.getX(i) * 6).toFixed(5)} ${(p.getY(i) * 6).toFixed(5)} ${(p.getZ(i) * 6).toFixed(5)}`);
        for (let i = 0; i < uv.count; i++) lines.push(`vt ${uv.getX(i).toFixed(6)} ${uv.getY(i).toFixed(6)}`);
        for (let i = 0; i < n.count; i++) lines.push(`vn ${n.getX(i).toFixed(6)} ${n.getY(i).toFixed(6)} ${n.getZ(i).toFixed(6)}`);
        for (let i = 0; i < index.count; i += 3) {
          const a = index.getX(i) + 1, b = index.getX(i + 1) + 1, c = index.getX(i + 2) + 1;
          lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
        }
        blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      } else throw Error('导出格式不支持。');
      return { format, filename: `${name}.${format}`, bytes: blob.size, blob };
    },
  };
  return api;
}

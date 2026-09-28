import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const colorFor = i => `hsl(${165 + (i * 33) % 190} 78% 72%)`;
const cases = {
  case1: { title: 'Case 01 · 近桥塔视角 · 主梁局部竖向响应' },
  case2: { title: 'Case 02 · 主跨侧视角 · 主梁局部竖向响应' },
};
const el = id => document.getElementById(id);
const ui = {
  video: el('case-video'), overlay: el('video-overlay'), play: el('play-button'), seek: el('seek'),
  now: el('current-time'), total: el('total-time'), legend: el('point-legend'), chart: el('displacement-chart'),
  model: el('model-stage'), amp: el('amplification'), ampValue: el('amplification-value'),
  displacement: el('metric-displacement'), pixels: el('metric-pixels'), frequency: el('metric-frequency'),
  duration: el('metric-duration'), descriptor: el('case-descriptor'), download: el('download-button'),
};
const cache = {};
let caseId = 'case1', data = null, selected = 0, sample = null;

function formatTime(t) { return `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`; }
function prepare(canvas) {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}
function currentSample(time) {
  if (!data) return null;
  const position = Math.max(0, Math.min(data.samples.length - 1, time / data.processing.sampleInterval));
  const a = Math.floor(position), b = Math.min(data.samples.length - 1, a + 1), r = position - a;
  return {
    px: data.samples[a].px.map((v, i) => v + r * (data.samples[b].px[i] - v)),
    m: data.samples[a].m.map((v, i) => v + r * (data.samples[b].m[i] - v)),
    xy: data.samples[a].xy.map((p, i) => p.map((v, axis) => v + r * (data.samples[b].xy[i][axis] - v))),
    visible: data.samples[a].visible,
  };
}
function mapVideo() {
  const box = ui.overlay.getBoundingClientRect();
  const scale = Math.min(box.width / data.panel.width, box.height / data.panel.height);
  return { scale, left: (box.width - data.panel.width * scale) / 2, top: (box.height - data.panel.height * scale) / 2 };
}
function drawOverlay() {
  const { ctx, w, h } = prepare(ui.overlay); ctx.clearRect(0, 0, w, h);
  if (!data) return;
  const { scale, left, top } = mapVideo();
  data.points.forEach((point, i) => {
    const tracked = sample?.xy[i] || [point.x, point.y];
    const x = left + tracked[0] * scale, y = top + tracked[1] * scale;
    ctx.globalAlpha = sample?.visible[i] === 0 ? 0.3 : i === selected ? 1 : 0.8;
    ctx.strokeStyle = ctx.fillStyle = colorFor(i); ctx.lineWidth = i === selected ? 2 : 1.2;
    ctx.beginPath(); ctx.arc(x, y, i === selected ? 8 : 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    if (i === selected || i % 3 === 0) { ctx.font = '700 10px sans-serif'; ctx.fillText(point.id, x + 7, y - 7); }
  });
  ctx.globalAlpha = 1;
}
function drawChart() {
  const { ctx, w, h } = prepare(ui.chart); ctx.clearRect(0, 0, w, h);
  if (!data) return;
  const left = w < 500 ? 45 : 58, right = 16, top = 12, bottom = 30;
  const plotW = w - left - right, plotH = h - top - bottom;
  const maxAbs = Math.max(0.05, ...data.samples.flatMap(v => v.m.map(Math.abs))) * 1.12;
  const X = t => left + t / data.duration * plotW;
  const Y = m => top + (1 - (m + maxAbs) / (2 * maxAbs)) * plotH;
  ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
  [-1, -0.5, 0, 0.5, 1].forEach(f => {
    const y = Y(f * maxAbs);
    ctx.strokeStyle = f === 0 ? '#547282' : '#294657'; ctx.lineWidth = f === 0 ? 1.2 : 0.8;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    ctx.fillStyle = '#819ba6'; ctx.fillText((f * maxAbs).toFixed(2), left - 8, y + 4);
  });
  ctx.textAlign = 'center';
  for (let k = 0; k <= 4; k++) { const t = data.duration * k / 4; ctx.fillText(`${Math.round(t)}s`, X(t), h - 8); }
  data.points.forEach((_, i) => {
    ctx.beginPath();
    data.samples.forEach((s, j) => j ? ctx.lineTo(X(s.t), Y(s.m[i])) : ctx.moveTo(X(s.t), Y(s.m[i])));
    ctx.strokeStyle = colorFor(i); ctx.lineWidth = i === selected ? 2.2 : 0.8; ctx.globalAlpha = i === selected ? 1 : 0.18; ctx.stroke();
  });
  ctx.globalAlpha = 1;
  const t = Math.min(data.duration, ui.video.currentTime || 0), x = X(t);
  ctx.strokeStyle = '#e9f6f3'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, h - bottom); ctx.stroke();
  const s = currentSample(t);
  ctx.fillStyle = colorFor(selected); ctx.beginPath(); ctx.arc(x, Y(s.m[selected]), 4, 0, Math.PI * 2); ctx.fill();
}
function selectPoint(index) {
  selected = index;
  ui.legend.querySelectorAll('button').forEach((button, i) => {
    button.classList.toggle('selected', i === index); button.setAttribute('aria-pressed', i === index ? 'true' : 'false');
  });
  const p = data.points[index];
  ui.displacement.textContent = p.range90M.toFixed(2);
  ui.pixels.textContent = `${p.id} · ${p.range90Px.toFixed(2)} px（P95−P5）· 参照残差 ${data.qa.staticResidualP95Px.toFixed(2)} px`;
  ui.frequency.textContent = p.dominantHz?.toFixed(2) || '—';
  el('selected-hanger').textContent = `${p.id} · 可见吊索参考站位 ${p.hangerStation}/${p.visibleHangerCount}`;
  drawOverlay(); drawChart();
}
function buildLegend() {
  ui.legend.replaceChildren();
  data.points.forEach((p, i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'point-button'; button.style.setProperty('--point-color', colorFor(i));
    button.innerHTML = `<i aria-hidden="true"></i>${p.id} · ${p.range90M.toFixed(2)} m`;
    button.title = `P95−P5：${p.range90Px.toFixed(2)} px；名义换算 ${p.range90M.toFixed(2)} m；梁高约 ${p.girderDepthPxApprox} px`;
    button.addEventListener('click', () => selectPoint(i)); ui.legend.append(button);
  });
  selectPoint(0);
}
async function loadCase(id) {
  ui.video.pause(); caseId = id; data = null; sample = null;
  ui.descriptor.textContent = cases[id].title;
  document.querySelectorAll('.case-tab').forEach(button => {
    const active = button.dataset.case === id; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  ui.video.src = `/video/${id}.mp4`; ui.video.load();
  try {
    const response = cache[id] ? null : await fetch(`/data/${id}.json`);
    if (response && !response.ok) throw new Error(`Data HTTP ${response.status}`);
    data = cache[id] || await response.json(); cache[id] = data;
    ui.duration.textContent = data.duration.toFixed(1); ui.total.textContent = formatTime(data.duration);
    el('metric-points').textContent = String(data.points.length);
    el('tracking-fps').textContent = `${data.processing.trackingFps} fps 深度学习点追踪`;
    model.setPoints(data.points);
    ui.seek.value = '0'; ui.now.textContent = '00:00.0'; selected = 0;
    buildLegend(); drawChart(); drawOverlay();
  } catch (error) { ui.descriptor.textContent = '测量数据无法加载，请刷新页面'; console.error(error); }
}

function makeModel() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(18, 9, 18); camera.lookAt(0, 1.3, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  ui.model.querySelector('.model-fallback')?.remove(); ui.model.prepend(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.4, 0); controls.enableDamping = true; controls.minDistance = 12; controls.maxDistance = 42;
  controls.maxPolarAngle = Math.PI * 0.49; controls.update();
  scene.add(new THREE.AmbientLight('#b6e6ef', 1.6));
  const light = new THREE.DirectionalLight('#d5f9ff', 2); light.position.set(4, 9, 8); scene.add(light);
  const grid = new THREE.GridHelper(27, 28, '#1f5666', '#143343'); grid.position.y = -1.1; scene.add(grid);
  const metal = new THREE.MeshStandardMaterial({ color: '#aac7c8', metalness: 0.5, roughness: 0.52 });
  const cableMat = new THREE.MeshStandardMaterial({ color: '#ecc487', metalness: 0.62, roughness: 0.36 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#477a86', metalness: 0.47, roughness: 0.42, side: THREE.DoubleSide });
  const cableY = x => 1.6 + 2.45 * (x / 9) ** 2;
  const addBox = (x, y, z, w, h, d) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), metal); mesh.position.set(x, y, z); scene.add(mesh);
  };
  [-9, 9].forEach(x => { [-0.46, 0.46].forEach(z => addBox(x, 1.72, z, 0.31, 4.1, 0.27)); addBox(x, 3.55, 0, 0.35, 0.22, 1.15); });
  [-0.42, 0.42].forEach(z => {
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 61 }, (_, i) => {
      const x = -9 + i * 0.3; return new THREE.Vector3(x, cableY(x), z);
    }));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.037, 6, false), cableMat));
  });
  const n = 72, deckPos = new Float32Array((n + 1) * 6), triangles = [];
  for (let i = 0; i < n; i++) { const k = i * 2; triangles.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const deckGeom = new THREE.BufferGeometry(); deckGeom.setAttribute('position', new THREE.BufferAttribute(deckPos, 3)); deckGeom.setIndex(triangles);
  scene.add(new THREE.Mesh(deckGeom, deckMat));
  const rails = [-0.37, 0.37].map(z => {
    const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
    scene.add(new THREE.Line(geom, new THREE.LineBasicMaterial({ color: '#87e2d5' }))); return { geom, z };
  });
  let hangerStations = [];
  const hangers = [-0.42, 0.42].map(z => {
    const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    scene.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: '#8aafb9', transparent: true, opacity: 0.72 })));
    return { geom, z };
  });
  const activeHangerGeom = new THREE.BufferGeometry();
  activeHangerGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  scene.add(new THREE.LineSegments(activeHangerGeom, new THREE.LineBasicMaterial({ color: '#8cf8e1', transparent: true, opacity: 0.95 })));
  const markers = [];
  function setPoints(points) {
    hangerStations = points.map(point => point.modelX);
    hangers.forEach(hanger => hanger.geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hangerStations.length * 6), 3)));
    markers.forEach(marker => { scene.remove(marker); marker.geometry.dispose(); marker.material.dispose(); });
    markers.length = 0;
    points.forEach((_, i) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), new THREE.MeshBasicMaterial({ color: colorFor(i) }));
      scene.add(mesh); markers.push(mesh);
    });
  }
  const deflection = (x, current) => {
    if (!current) return 0;
    const nodes = [{ x: -9, m: 0 }, ...data.points.map((point, i) => ({ x: point.modelX, m: current.m[i] })), { x: 9, m: 0 }];
    for (let i = 0; i < nodes.length - 1; i++) if (x <= nodes[i + 1].x) {
      const r = Math.max(0, Math.min(1, (x - nodes[i].x) / (nodes[i + 1].x - nodes[i].x)));
      return (nodes[i].m * (1 - r) + nodes[i + 1].m * r) * (18 / 888) * Number(ui.amp.value);
    }
    return 0;
  };
  function update(current) {
    for (let i = 0; i <= n; i++) {
      const x = -9 + i * 18 / n, y = 0.35 + deflection(x, current);
      for (let side = 0; side < 2; side++) {
        const p = (i * 2 + side) * 3; deckPos[p] = x; deckPos[p + 1] = y; deckPos[p + 2] = side ? 0.36 : -0.36;
      }
      rails.forEach(rail => {
        const p = i * 3, arr = rail.geom.attributes.position.array;
        arr[p] = x; arr[p + 1] = y + 0.03; arr[p + 2] = rail.z;
      });
    }
    deckGeom.attributes.position.needsUpdate = true; deckGeom.computeVertexNormals();
    rails.forEach(rail => { rail.geom.attributes.position.needsUpdate = true; });
    hangers.forEach(hanger => {
      const arr = hanger.geom.attributes.position.array;
      for (let i = 0; i < hangerStations.length; i++) {
        const x = hangerStations[i], p = i * 6;
        arr[p] = x; arr[p + 1] = cableY(x); arr[p + 2] = hanger.z;
        arr[p + 3] = x; arr[p + 4] = 0.37 + deflection(x, current); arr[p + 5] = hanger.z;
      }
      hanger.geom.attributes.position.needsUpdate = true;
    });
    if (data.points[selected]) {
      const x = data.points[selected].modelX, arr = activeHangerGeom.attributes.position.array;
      arr[0] = x; arr[1] = cableY(x); arr[2] = 0.42;
      arr[3] = x; arr[4] = 0.37 + deflection(x, current); arr[5] = 0.42;
      activeHangerGeom.attributes.position.needsUpdate = true;
    }
    markers.forEach((marker, i) => {
      const x = data.points[i].modelX; marker.position.set(x, 0.45 + deflection(x, current), 0.46);
      marker.scale.setScalar(i === selected ? 1.4 : 0.9);
    });
  }
  function resize() {
    const { width, height } = ui.model.getBoundingClientRect();
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
  }
  resize(); new ResizeObserver(resize).observe(ui.model);
  return { scene, camera, renderer, controls, update, setPoints };
}

const model = makeModel();
function frame() {
  if (data) {
    const t = Math.min(data.duration, ui.video.currentTime || 0);
    sample = currentSample(t); ui.now.textContent = formatTime(t); ui.seek.value = String(Math.round(t / data.duration * 1000));
    drawOverlay(); drawChart(); model.update(sample);
  }
  model.controls.update(); model.renderer.render(model.scene, model.camera); requestAnimationFrame(frame);
}
ui.play.addEventListener('click', () => ui.video.paused ? ui.video.play() : ui.video.pause());
ui.video.addEventListener('play', () => { ui.play.textContent = 'Ⅱ'; ui.play.setAttribute('aria-label', '暂停视频'); });
ui.video.addEventListener('pause', () => { ui.play.textContent = '▶'; ui.play.setAttribute('aria-label', '播放视频'); });
ui.seek.max = '1000'; ui.seek.addEventListener('input', () => { if (data) ui.video.currentTime = Number(ui.seek.value) / 1000 * data.duration; });
ui.amp.addEventListener('input', () => { ui.ampValue.textContent = `${ui.amp.value}×`; });
ui.overlay.addEventListener('click', event => {
  if (!data) return;
  const box = ui.overlay.getBoundingClientRect(), { scale, left, top } = mapVideo();
  const x = event.clientX - box.left, y = event.clientY - box.top;
  const nearest = data.points.map((p, i) => ({ i, distance: Math.hypot(x - left - (sample?.xy[i]?.[0] ?? p.x) * scale, y - top - (sample?.xy[i]?.[1] ?? p.y) * scale) })).sort((a, b) => a.distance - b.distance)[0];
  if (nearest.distance < 28) selectPoint(nearest.i);
});
document.querySelectorAll('.case-tab').forEach(button => button.addEventListener('click', () => loadCase(button.dataset.case)));
ui.download.addEventListener('click', () => {
  const link = document.createElement('a'); link.href = `/data/${caseId}.csv`;
  link.download = `humen-bridge-${caseId}-vertical-displacement.csv`; link.click();
});
new ResizeObserver(() => { drawOverlay(); drawChart(); }).observe(el('video-stage'));
new ResizeObserver(drawChart).observe(ui.chart.parentElement);
loadCase('case1'); frame();

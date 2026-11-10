/* Agili in 3D: het model uit de Agili Lab (DWG), als losse viewer voor de dealersite en de productpagina.
   Gebruik: const a = await mountAgili(element, {modelUrl}); a.go({h:0..1, tilt:0..90}); a.setTop('wit'|'acacia'); a.setFrame('zwart'|'wit'); a.setRing('geel'|...); a.showAll(cb) */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const DEG = Math.PI / 180;
export const TOP_H = 1.065, LIFT = 0.30, PIVOT_Y = 0.989, TOP_OFF = 0.171, TILT_MAX = 25;
export const RINGS = { geel: '#fbb900', blauw: '#3fb6dc', groen: '#7fb33a', lila: '#a77fb0' };
export const heightCm = h => Math.floor((TOP_H - LIFT * (1 - h)) * 100 + 1e-6);

export async function mountAgili(stage, opt = {}) {
  let dirty = true, running = false, spin = false, visible = true, timer = 0, t = null;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8c88, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(3.5, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 25 });
  scene.add(sun); scene.add(sun.target);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.maxPolarAngle = 1.45;
  controls.minDistance = 1.2; controls.maxDistance = 6; controls.enableZoom = opt.zoom !== false;
  controls.target.set(0, 0.62, 0.12); camera.position.set(1.9, 1.55, 2.35);
  controls.addEventListener('change', () => { dirty = true; kick(); });
  function resize() { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; kick(); }
  new ResizeObserver(resize).observe(stage); resize();
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.18 }));
  shadowFloor.rotation.x = -Math.PI / 2; shadowFloor.receiveShadow = true; scene.add(shadowFloor);
  /* ---------- materialen ---------- */
  const mats = {
    frame: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: .42, metalness: .35, side: THREE.DoubleSide }),
    castor: new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: .6, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8d9095, roughness: .35, metalness: .8, side: THREE.DoubleSide }),
    top: new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: .5, side: THREE.DoubleSide }),
    edge: new THREE.MeshStandardMaterial({ color: 0xc9a473, roughness: .7, side: THREE.DoubleSide }),
    tube: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: .35, metalness: .35 }),
    pen: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: .55 }),
    groove: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: .8 }),
  };
  const TOPS = { wit: 0xf4f3ee, acacia: 0xd3ab7c };
  const ringMats = Object.fromEntries(Object.entries(RINGS).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: .45 })]));
  const ringGeo = new THREE.CylinderGeometry(0.0435, 0.0435, 0.016, 40);
  // buizen los opgebouwd: onderbuis (vast, breder) en bovenbuis (schuift erin)
  // onderbuis: dun en vast op de voet; bovenbuis: dik en schuift eroverheen mee met de hoogte
  const tubeLowGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.62 - 0.108, 40); tubeLowGeo.translate(0, (0.62 + 0.108) / 2, 0);
  const tubeUpGeo = new THREE.CylinderGeometry(0.040, 0.040, 0.958 - 0.50, 40); tubeUpGeo.translate(0, (0.958 + 0.50) / 2, 0);
  const collarGeo = new THREE.CylinderGeometry(0.0415, 0.0415, 0.012, 40); collarGeo.translate(0, 0.506, 0);
  // pennenhouder langs de rechter schuine voorkant van het blad
  // pennenbak 30 × 4 cm: plaat met schuine kopse kanten, een rand aan de voorkant en aan beide uiteinden twee ribbels als pennengoot
  const penGeo = (() => {
    const L = 0.30, H = 0.007, B = 0.010, sh = new THREE.Shape();
    sh.moveTo(-L / 2, 0); sh.lineTo(L / 2, 0); sh.lineTo(L / 2 - B, H); sh.lineTo(-L / 2 + B, H); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false }); g.translate(0, 0, -0.02); return g;
  })();
  const penLipGeo = new THREE.BoxGeometry(0.27, 0.004, 0.006); penLipGeo.translate(0, 0.009, 0.014);
  const penRibGeo = new THREE.CapsuleGeometry(0.0042, 0.07, 4, 12); penRibGeo.rotateZ(Math.PI / 2);
  
  
  /* ---------- tafel ---------- */
  let parts = null;   // { base: [geo, mat][], lift: ..., tilt: ... }
  const tablesG = new THREE.Group(); scene.add(tablesG);
  let uid = 0;
  class Table {
    constructor(p = {}) {
      this.id = ++uid;
      this.root = new THREE.Group(); this.root.userData.table = this;
      const addMeshes = (list, parent) => list.forEach(([g, m]) => { const me = new THREE.Mesh(g, mats[m]); me.castShadow = true; me.receiveShadow = true; parent.add(me); });
      addMeshes(parts.base, this.root);
      const mk = (g, m, parent) => { const me = new THREE.Mesh(g, m); me.castShadow = true; me.receiveShadow = true; parent.add(me); return me; };
      mk(tubeLowGeo, mats.tube, this.root);
      this.ring = mk(ringGeo, ringMats.geel, this.root); this.ring.position.y = 0.122;
      this.lift = new THREE.Group(); this.root.add(this.lift); addMeshes(parts.lift, this.lift);
      mk(tubeUpGeo, mats.tube, this.lift); mk(collarGeo, mats.tube, this.lift);
      this.pivot = new THREE.Group(); this.pivot.position.y = PIVOT_Y; this.lift.add(this.pivot);
      const inner = new THREE.Group(); inner.position.y = -PIVOT_Y; this.pivot.add(inner); addMeshes(parts.tilt, inner);
      // pennenbakje midden aan de rechte voorkant van het blad
      const pen = new THREE.Group(); pen.position.set(0, TOP_H, 0.471 - 0.024); inner.add(pen);
      mk(penGeo, mats.pen, pen); mk(penLipGeo, mats.pen, pen);
      for (const sx of [-1, 1]) for (const rz of [-0.004, -0.0135]) mk(penRibGeo, mats.pen, pen).position.set(sx * 0.088, 0.007, rz);
      
      // toestand: x, z, rot (rad), h (0 zit … 1 sta), tilt (graden, 90 = ingeklapt)
      this.s = { x: 0, z: 0, rot: 0, h: 1, tilt: 0, scale: 1, ...p };
      this.from = null; this.to = null; this.t0 = 0; this.dur = 0;
      this.setRing(p.ring || 'geel'); this.apply(); tablesG.add(this.root);
    }
    setRing(k) { this.ringKey = k; this.ring.material = ringMats[k]; dirty = true; }
    apply() {
      const s = this.s;
      this.root.position.set(s.x, 0, s.z); this.root.rotation.y = s.rot; this.root.scale.setScalar(s.scale);
      this.lift.position.y = -LIFT * (1 - s.h);
      this.pivot.rotation.x = s.tilt * DEG;
    }
    animate(to, opts = {}) {
      const now = performance.now();
      this.from = { ...this.s };
      this.to = { ...this.s, ...to };
      let dr = this.to.rot - this.from.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); this.to.rot = this.from.rot + dr;
      this.t0 = now + (opts.delay || 0); this.dur = reduce ? 1 : (opts.dur ?? 1600);
      this.onDone = opts.onDone || null;
    }
    step(now) {
      if (!this.to) return false;
      const raw = clamp((now - this.t0) / this.dur, 0, 1);
      if (raw <= 0) return true;
      const f = this.from, t = this.to, s = this.s;
      const dist = Math.hypot(t.x - f.x, t.z - f.z);
      const folding = t.tilt >= 89 && f.tilt < 89, unfolding = f.tilt >= 89 && t.tilt < 89;
      // eerst inklappen en dan rijden, of eerst rijden en dan uitklappen
      let pm = raw, pt = raw;
      if (dist > 0.05 && folding) { pt = clamp(raw / 0.35, 0, 1); pm = clamp((raw - 0.25) / 0.75, 0, 1); }
      else if (dist > 0.05 && unfolding) { pm = clamp(raw / 0.75, 0, 1); pt = clamp((raw - 0.65) / 0.35, 0, 1); }
      const em = ease(pm), et = ease(pt);
      s.x = lerp(f.x, t.x, em); s.z = lerp(f.z, t.z, em); s.rot = lerp(f.rot, t.rot, em);
      s.h = lerp(f.h, t.h, ease(raw)); s.tilt = lerp(f.tilt, t.tilt, et); s.scale = lerp(f.scale, t.scale, ease(raw));
      this.apply();
      if (raw >= 1) { this.to = null; const cb = this.onDone; this.onDone = null; if (cb) cb(this); return false; }
      return true;
    }
    stop() { this.to = null; }
    dispose() { tablesG.remove(this.root); }
    get topCenter() { return { x: this.s.x + Math.sin(this.s.rot) * TOP_OFF, z: this.s.z + Math.cos(this.s.rot) * TOP_OFF }; }
  }
  
  const txt = await (await fetch(opt.modelUrl || 'agili-model.txt')).text();
  const bytes = Uint8Array.from(atob(txt.trim()), c => c.charCodeAt(0));
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(bytes.buffer, '', res, rej));
  parts = { base: [], lift: [], tilt: [] };
  gltf.scene.traverse(o => { if (!o.isMesh) return; const [part, mat] = o.name.split('__'); if (parts[part] && mats[mat]) parts[part].push([toCreasedNormals(o.geometry, 35 * DEG), mat]); });
  t = new Table({ x: 0, z: 0, h: opt.h ?? 1, tilt: opt.tilt ?? 0, ring: opt.ring || 'geel' });

  function kick() { dirty = true; if (!running && visible) { running = true; requestAnimationFrame(loop); } }
  function loop(now) {
    let busy = false;
    if (t && t.step(now)) busy = true;
    if (spin) { controls.autoRotate = true; controls.autoRotateSpeed = 1.4; busy = true; } else controls.autoRotate = false;
    if (controls.update()) dirty = true;
    if (dirty) { renderer.render(scene, camera); dirty = false; }
    if ((busy || dirty) && visible) requestAnimationFrame(loop); else { running = false; renderer.render(scene, camera); }
  }
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) kick(); }).observe(stage);
  renderer.domElement.addEventListener('pointerdown', () => { spin = false; });
  kick();
  const target = () => t.to ? t.to : t.s;
  const api = {
    go(p, dur = 1000) { clearTimeout(timer); t.animate(p, { dur }); kick(); },
    state: target,
    setTop(k) { mats.top.color.setHex(TOPS[k]); dirty = true; kick(); },
    setFrame(k) { const wit = k === 'wit'; for (const m of [mats.tube, mats.frame]) { m.color.setHex(wit ? 0xf2f2ee : 0x1b1c1e); m.metalness = wit ? 0.05 : 0.35; } dirty = true; kick(); },
    setRing(k) { t.setRing(k); kick(); },
    spin(on) { spin = on; kick(); },
    showAll(cb) {
      const seq = [[{ h: 1, tilt: 0 }, 900, 'Stahoogte'], [{ h: 0, tilt: 0 }, 1300, 'Zithoogte'], [{ h: 0, tilt: TILT_MAX }, 1000, 'Blad gekanteld'], [{ h: 1, tilt: TILT_MAX }, 1300, 'Gekanteld op stahoogte'], [{ h: 1, tilt: 90 }, 1300, 'Ingeklapt'], [{ h: 1, tilt: 0 }, 1300, 'Klaar voor de les']];
      let i = 0; clearTimeout(timer);
      const next = () => { if (i >= seq.length) return; const [p, d, n] = seq[i]; t.animate(p, { dur: d }); kick(); if (cb) cb(n, target()); i++; timer = setTimeout(next, d + 450); };
      next();
    }
  };
  return api;
}

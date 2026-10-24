/* D3: data/d3.js */
/* ---------- 3B arazi ve nehir seviyesi simülasyonu ---------- */
const T3 = { case: null, level: 0, exag: 2, r: null, scene: null, cam: null, ctl: null, mat: null, geo: null, items: [], tex: {}, hand: null, raf: 0, sel: null, ext: 10, tw: null };
function d3dec(c) {
  const d = D3[c]; if (d._ok) return d;
  const u8 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
  d.hand = u8(d.hd); const e8 = u8(d.el); d.elev = new Uint16Array(e8.buffer, 0, e8.length >> 1); d._ok = true; return d;
}
function d3elev(d, lon, lat) {
  const bb = d.bb, gx = Math.max(0, Math.min(d.w - 1.001, (lon - bb[0]) / (bb[2] - bb[0]) * (d.w - 1))), gy = Math.max(0, Math.min(d.h - 1.001, (bb[3] - lat) / (bb[3] - bb[1]) * (d.h - 1)));
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, e = d.elev, W = d.w;
  return (e[j * W + i] * (1 - fx) + e[j * W + i + 1] * fx) * (1 - fy) + (e[(j + 1) * W + i] * (1 - fx) + e[(j + 1) * W + i + 1] * fx) * fy;
}
function t3render() { if (T3.raf) return; T3.raf = requestAnimationFrame(() => { T3.raf = 0; if (T3.r) T3.r.render(T3.scene, T3.cam); }); }
function t3init() {
  if (T3.r) return true;
  if (!window.THREE || !THREE.OrbitControls) return false;
  try {
    T3.r = new THREE.WebGLRenderer({ canvas: $('#cv3'), antialias: true });
    T3.scene = new THREE.Scene(); T3.cam = new THREE.PerspectiveCamera(42, 1, 0.05, 3000);
    T3.ctl = new THREE.OrbitControls(T3.cam, $('#cv3')); T3.ctl.maxPolarAngle = Math.PI * 0.49; T3.ctl.addEventListener('change', t3render);
    let dn = null; const cvs = $('#cv3');
    cvs.addEventListener('pointerdown', e => { dn = [e.clientX, e.clientY]; });
    cvs.addEventListener('pointerup', e => { if (dn && Math.abs(e.clientX - dn[0]) + Math.abs(e.clientY - dn[1]) < 5) t3pick(e); dn = null; });
    new ResizeObserver(t3resize).observe($('#mapbox'));
    return true;
  } catch (err) { T3.r = null; return false; }
}
function t3resize() {
  if (!T3.r || S.view !== '3d') return;
  const b = $('#mapbox').getBoundingClientRect(); if (!b.width) return;
  T3.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); T3.r.setSize(b.width, b.height, false);
  T3.cam.aspect = b.width / b.height; T3.cam.updateProjectionMatrix(); t3render();
}
const VS3 = 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FS3 = 'uniform sampler2D uTex; uniform sampler2D uHand; uniform float uLevel; uniform float uUse; uniform vec3 uBase; uniform vec3 uWater; varying vec2 vUv; varying vec3 vN;' +
  'void main(){ vec3 c = uUse > 0.5 ? texture2D(uTex, vUv).rgb : uBase; vec4 hh = texture2D(uHand, vec2(vUv.x, 1.0 - vUv.y));' +
  'float l = dot(normalize(vN), normalize(vec3(-0.55, 0.75, -0.35))); c *= 0.62 + 0.5 * clamp(l, 0.0, 1.0);' +
  'if (hh.r < 0.99 && uLevel > 0.0 && hh.r * 127.5 <= uLevel) c = mix(c, uWater, 0.72); gl_FragColor = vec4(c, 1.0); }';
function t3clear() {
  while (T3.scene.children.length) { const o = T3.scene.children.pop(); if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose && o !== T3.terr) o.material.dispose(); }
  T3.items = [];
}
function t3colors() { return { wet: new THREE.Color(css('--kritik') || '#c0392b'), dry: new THREE.Color('#f5f2e9'), dam: new THREE.Color('#8f9aa6'), sel: new THREE.Color('#ffd23f') }; }
function t3build(c) {
  const d = d3dec(c), W = d.w, H = d.h, bb = d.bb, lon0 = (bb[0] + bb[2]) / 2, lat0 = (bb[1] + bb[3]) / 2, k = Math.cos(lat0 * Math.PI / 180) * R_LON;
  const X = lon => (lon - lon0) * k / 1000, Z = lat => -(lat - lat0) * R_LAT / 1000;
  T3.tw = { X, Z, lon0, lat0 }; T3.case = c; T3.d = d; t3clear();
  const pos = new Float32Array(W * H * 3), uv = new Float32Array(W * H * 2);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const n = j * W + i, lon = bb[0] + (bb[2] - bb[0]) * i / (W - 1), lat = bb[3] - (bb[3] - bb[1]) * j / (H - 1);
    pos[n * 3] = X(lon); pos[n * 3 + 2] = Z(lat); uv[n * 2] = i / (W - 1); uv[n * 2 + 1] = 1 - j / (H - 1);
  }
  const idx = new Uint32Array((W - 1) * (H - 1) * 6); let q = 0;
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i, b2 = a + 1, c2 = a + W, d2 = c2 + 1; idx[q++] = a; idx[q++] = c2; idx[q++] = b2; idx[q++] = b2; idx[q++] = c2; idx[q++] = d2; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  T3.geo = g; t3exag(true);
  const ht = new THREE.DataTexture(d.hand, W, H, THREE.LuminanceFormat, THREE.UnsignedByteType); ht.minFilter = ht.magFilter = THREE.LinearFilter; ht.generateMipmaps = false; ht.needsUpdate = true;
  T3.mat = new THREE.ShaderMaterial({ vertexShader: VS3, fragmentShader: FS3, uniforms: { uTex: { value: null }, uHand: { value: ht }, uLevel: { value: T3.level }, uUse: { value: 0 }, uBase: { value: new THREE.Color(css('--map')) }, uWater: { value: new THREE.Color(0.08, 0.42, 0.95) } } });
  T3.terr = new THREE.Mesh(g, T3.mat); T3.scene.add(T3.terr); T3.scene.background = new THREE.Color(css('--map'));
  t3tex();
  // varlıklar
  const col = t3colors(), asset = S.assets, ex = [1e9, 1e9, -1e9, -1e9];
  const ext = Math.max(X(bb[2]) - X(bb[0]), Z(bb[1]) - Z(bb[3])); T3.ext = ext; const sz = Math.max(0.35, ext * 0.0042);
  for (const a of asset) {
    const eh = d.eh[String(a.id)]; if (eh === undefined || eh === null) continue;
    const it = { a, eh, lonlat: null };
    if (a.isLine) {
      it.lonlat = a.ring.map(p => [p[0], p[1]]);
      const arr = new Float32Array(it.lonlat.length * 3);
      it.lonlat.forEach((p, i) => { arr[i * 3] = X(p[0]); arr[i * 3 + 2] = Z(p[1]); });
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      it.obj = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: col.dry }));
    } else {
      const geo = a.kind === 'HES' ? new THREE.ConeGeometry(sz * 0.8, sz * 2.2, 5) : a.kind === 'Trafo merkezi' ? new THREE.BoxGeometry(sz * 1.5, sz * 1.5, sz * 1.5) : new THREE.SphereGeometry(sz * 0.8, 10, 8);
      it.obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col.dry })); it.lonlat = [[a.c[0], a.c[1]]]; it.sz = sz; it.pt = true;
      it.obj.userData.id = a.id;
    }
    T3.scene.add(it.obj); T3.items.push(it);
    it.lonlat.forEach(p => { const x = X(p[0]), z = Z(p[1]); ex[0] = Math.min(ex[0], x); ex[1] = Math.min(ex[1], z); ex[2] = Math.max(ex[2], x); ex[3] = Math.max(ex[3], z); });
  }
  t3items();
  // kamera odağı: Bozkurt'ta gözlenen sel izi, diğerlerinde nehre göre ≤ 5 m kademesindeki varlıklar
  let fx = [1e9, 1e9, -1e9, -1e9]; const addF = (x, z) => { fx[0] = Math.min(fx[0], x); fx[1] = Math.min(fx[1], z); fx[2] = Math.max(fx[2], x); fx[3] = Math.max(fx[3], z); };
  if (c === 'bozkurt') parseFlood(BOZKURT.flood).forEach(pl => pl.forEach(r => r.forEach(p => addF(X(p[0]), Z(p[1])))));
  else T3.items.filter(it => it.eh <= 5 && it.a.kind !== 'Baraj').forEach(it => it.lonlat.forEach(p => addF(X(p[0]), Z(p[1]))));
  if (!isFinite(fx[0])) fx = isFinite(ex[0]) ? ex : [-6, -6, 6, 6];
  T3.target = [(fx[0] + fx[2]) / 2, 0, (fx[1] + fx[3]) / 2, Math.max(fx[2] - fx[0], fx[3] - fx[1], 14) * 1.15]; T3.bs = Math.max(0.12, Math.min(1.6, T3.target[3] * 0.0075 / sz)); t3items(); t3reset();
  t3sim(); t3resize();
}
function t3items() { // yüksekliği abartmaya göre işaretçi konumları
  const d = T3.d, e = T3.exag / 1000, tw = T3.tw;
  T3.items.forEach(it => {
    if (it.pt) { const p = it.lonlat[0]; it.obj.position.set(tw.X(p[0]), d3elev(d, p[0], p[1]) * e + it.sz * (T3.bs || 1) * 1.1, tw.Z(p[1])); }
    else { const a = it.obj.geometry.attributes.position; it.lonlat.forEach((p, i) => a.setY(i, d3elev(d, p[0], p[1]) * e + 0.05 + T3.ext * 0.0006)); a.needsUpdate = true; }
  });
}
function t3exag(first) {
  const d = T3.d, p = T3.geo.attributes.position, e = T3.exag / 1000;
  for (let n = 0; n < d.elev.length; n++) p.setY(n, d.elev[n] * e);
  p.needsUpdate = true; T3.geo.computeVertexNormals(); if (T3.geo.boundingSphere) T3.geo.boundingSphere = null; T3.geo.computeBoundingSphere();
  if (!first) { t3items(); t3render(); }
}
function t3tex() {
  const c = T3.case; if (!T3.mat) return;
  if (S.base === 'none' || !BASE[c]) { T3.mat.uniforms.uUse.value = 0; t3render(); return; }
  const key = c + S.base;
  if (T3.tex[key]) { T3.mat.uniforms.uTex.value = T3.tex[key]; T3.mat.uniforms.uUse.value = 1; t3render(); return; }
  new THREE.TextureLoader().load(BASE[c][S.base], t => { t.anisotropy = 4; T3.tex[key] = t; if (T3.case === c) t3tex(); });
}
function t3reset() {
  const [x, , z, span] = T3.target || [0, 0, 0, T3.ext];
  T3.ctl.target.set(x, 0.2 * T3.exag, z); T3.cam.position.set(x, span * 0.85, z + span * 0.62); T3.ctl.update(); t3render();
}
function t3sim() {
  const L = T3.level, col = t3colors(); T3.mat.uniforms.uLevel.value = L;
  const rows = T3.items.filter(x => x.a.kind !== 'Baraj'), wet = rows.filter(x => L > 0 && x.eh <= L).sort((a, b) => a.eh - b.eh);
  T3.items.forEach(it => {
    const c = it.a.kind === 'Baraj' ? col.dam : (L > 0 && it.eh <= L) ? col.wet : col.dry;
    it.obj.material.color.copy(it.a.id === T3.sel ? col.sel : c);
    if (it.pt) it.obj.scale.setScalar((T3.bs || 1) * (it.a.id === T3.sel ? 1.9 : (L > 0 && it.eh <= L && it.a.kind !== 'Baraj' ? 1.25 : 1)));
  });
  $('#olv').textContent = L > 0 ? '+' + L.toString().replace('.', ',') + ' m' : 'kapalı';
  const kinds = {}; wet.forEach(x => { kinds[x.a.kind] = (kinds[x.a.kind] || 0) + 1; });
  const kt = Object.entries(kinds).map(([k, n]) => `${n} ${k.toLocaleLowerCase('tr')}`).join(', ');
  $('#simSum').textContent = L > 0 ? `Nehir seviyesi +${L.toString().replace('.', ',')} m: ${rows.length} varlıktan ${wet.length} tanesi sular altında kalır${kt ? ' (' + kt + ')' : ''}.` : 'Nehir seviyesini yükselt. Su, nehre göre yüksekliği o seviyenin altında kalan alana yayılır.';
  $('#simList').innerHTML = wet.slice(0, 8).map(x => `<button class="row${x.a.id === T3.sel ? ' sel' : ''}" data-id="${x.a.id}"><i class="dot" style="background:var(--kritik)"></i><span class="nm">${esc(x.a.name)}<small>${x.a.kind}${x.a.isLine ? ' (uzunluğun %10\'u)' : ''}</small></span><span class="dv">${x.eh === 0 ? 'yatakta' : '+' + x.eh.toString().replace('.', ',') + ' m'}</span></button>`).join('') + (wet.length > 8 ? `<p class="small" style="margin:6px 0 0">+${wet.length - 8} varlık daha</p>` : '');
  t3render();
}
function t3select(id) {
  T3.sel = id; const it = T3.items.find(x => x.a.id === id);
  $('#hud3').textContent = it ? `${it.a.name} · ${it.a.kind} · ${it.a.kind === 'Baraj' ? 'su yapısı, sayılmaz' : 'sular altında kalma eşiği: nehir +' + it.eh.toString().replace('.', ',') + ' m'}` : '';
  t3sim();
}
function t3pick(e) {
  const b = $('#cv3').getBoundingClientRect(), m = new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1), rc = new THREE.Raycaster();
  rc.setFromCamera(m, T3.cam); const hit = rc.intersectObjects(T3.items.filter(x => x.pt).map(x => x.obj));
  t3select(hit.length ? hit[0].object.userData.id : null);
}
function setView(v) {
  if (v === '3d') {
    if (!S.caseId || !D3[S.caseId]) { flash('3B görünüm için bir vaka seç (Bozkurt, Alakır veya Trabzon).'); return; }
    if (!t3init()) { flash('3B görünüm bu tarayıcıda açılamadı. 2B harita kullanılıyor.'); return; }
  }
  S.view = v; const on = v === '3d';
  $('#cv').hidden = on; $('.maptools').hidden = on; $('#legend').hidden = on; $('#v3d').hidden = !on; $('#simCard').hidden = !on;
  document.querySelectorAll('.vw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  if (on) { t3build(S.caseId); } else { resize(); draw(); }
}
$('#lv').addEventListener('input', e => { T3.level = +e.target.value; if (T3.mat) t3sim(); });
$('#ex').addEventListener('input', e => { T3.exag = +e.target.value; $('#oex').textContent = T3.exag.toString().replace('.', ',') + '×'; if (T3.geo) t3exag(); });
document.querySelectorAll('.pr').forEach(b => b.onclick = () => { T3.level = +b.dataset.lv; $('#lv').value = T3.level; if (T3.mat) t3sim(); });
document.querySelectorAll('.vw').forEach(b => b.onclick = () => setView(b.dataset.view));
$('#bReset3').onclick = () => { if (T3.r) t3reset(); };
$('#simList').addEventListener('click', e => { const b = e.target.closest('.row'); if (b) t3select(+b.dataset.id); });
$('#oex').textContent = '2×';
// vaka, zemin ya da veri değişince 3B'yi tazele
const _renderAll3 = renderAll;
renderAll = function () { _renderAll3(); if (S.view === '3d') { if (S.caseId && D3[S.caseId]) { if (T3.case !== S.caseId || !T3.mat) t3build(S.caseId); else t3tex(); } else setView('2d'); } syncView(); };
function syncView() { document.querySelectorAll('.vw').forEach(b => { b.disabled = !S.caseId || !D3[S.caseId]; b.setAttribute('aria-pressed', String(b.dataset.view === (S.view || '2d'))); }); }
syncView();

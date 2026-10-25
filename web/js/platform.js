// Gerçek zamanlı platform: REGION (data/region.js) varlıklarını Leaflet haritasında gösterir ve seçilen varlık ya da
// nokta için modeli istek anında çalıştırır (pipeline/ondemand/serve.py). Nokta renkleri yalnızca varlık türüdür.
const KINDS = [
  { id: 'tm', label: 'Trafo merkezi', sh: 'trafo merkezi', on: true },
  { id: 'hes', label: 'HES', sh: 'HES', on: true },
  { id: 'res', label: 'RES (rüzgar)', sh: 'RES', on: true },
  { id: 'ges', label: 'GES (güneş)', sh: 'GES', on: true },
  { id: 'termik', label: 'Termik', sh: 'termik santral', on: true },
  { id: 'diger', label: 'Diğer santral', sh: 'diğer santral', on: true },
  { id: 'gen', label: 'Jeneratör (ünite)', sh: 'jeneratör', on: false },
  { id: 'baraj', label: 'Baraj / bent', sh: 'baraj/bent', on: true },
  { id: 'hat', label: 'İletim hattı', sh: 'iletim hattı', on: true }
];
// dağıtım hatları (minor_line) Türkiye envanterinde yok; eski bölge dosyası yüklenirse diye tür korunur
if (REGION.lines.some(l => l.m)) KINDS.push({ id: 'dhat', label: 'Dağıtım hattı', sh: 'dağıtım hattı', on: false });
const KIND = Object.fromEntries(KINDS.map((k, i) => [k.id, Object.assign(k, { i })]));
const SRC_TR = { hydro: 'hidroelektrik', wind: 'rüzgar', solar: 'güneş', coal: 'kömür', lignite: 'linyit', gas: 'doğalgaz', oil: 'petrol',
  diesel: 'dizel', biomass: 'biyokütle', biogas: 'biyogaz', waste: 'atık', geothermal: 'jeotermal' };
const BASES = {
  // koyu temada CSS filtresiyle karartılır (.rg.dim)
  map: () => ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıda bulunanlar', 19],
  topo: () => ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', 'Harita verisi © OpenStreetMap katkıda bulunanlar, SRTM · Stil © OpenTopoMap (CC-BY-SA)', 17],
  sat: () => ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Görüntü © Esri, Maxar, Earthstar Geographics', 19]
};
const $ = id => document.getElementById(id);

function srcKind(s) {
  s = String(s || '').toLowerCase();
  if (/hydro/.test(s)) return 'hes';
  if (/wind/.test(s)) return 'res';
  if (/solar/.test(s)) return 'ges';
  if (/coal|lignite|gas|oil|diesel/.test(s)) return 'termik';
  return 'diger';
}
function kindOf(p) {
  if (p.t === 'sub') return 'tm';
  if (p.t === 'dam') return 'baraj';
  if (p.t === 'gen') return 'gen';
  return srcKind(p.s);
}
function maxKV(v) {
  const n = String(v || '').split(/[;,]/).map(x => parseFloat(x)).filter(isFinite);
  return n.length ? Math.max(...n) / 1000 : null;
}
function kvTxt(v) {
  const n = String(v || '').split(/[;,]/).map(x => parseFloat(x)).filter(isFinite).map(x => Math.round(x / 100) / 10);
  return n.length ? n.join(' / ') + ' kV' : '–';
}
function srcTxt(s) { return s ? String(s).split(';').map(x => SRC_TR[x.trim()] || x.trim()).join(', ') : '–'; }
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const low = s => String(s || '').toLocaleLowerCase('tr');
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const num = (x, d = 1) => x.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const isPhone = () => matchMedia('(max-width: 640px)').matches;

// ---------- veri ----------
const PROVS = REGION.prov;
const ITEMS = [];
for (const p of REGION.pts) {
  const k = kindOf(p);
  ITEMS.push({ ...p, k, ck: k === 'gen' ? srcKind(p.s) : k, line: false, prov: [p.p], b: L.latLngBounds([p.ll, p.ll]) });
}
for (const l of REGION.lines) {
  const kv = maxKV(l.v);
  ITEMS.push({ ...l, k: l.m ? 'dhat' : 'hat', ck: 'hat', kv, line: true, prov: l.p, b: L.latLngBounds(l.g), ll: l.g[Math.floor(l.g.length / 2)] });
}
for (const it of ITEMS) it.nm = it.n || ('Adsız ' + KIND[it.k].sh);

// ---------- durum ----------
// sel: seçili varlık; pt: seçilen serbest nokta {lat, lon}; ev: varlık kimliğine göre sonuç; hist: oturum geçmişi
const S = { on: Object.fromEntries(KINDS.map(k => [k.id, k.on])), reg: '', prov: '', q: '', base: 'map', sel: null, pt: null, col: {},
  ev: {}, hist: [], at: null, pick: false, svc: false, busy: false, ov: { tier: true, ai: false }, ovData: null, tab: 'explore' };

const map = L.map('rmap', { preferCanvas: true, zoomSnap: 0.5, worldCopyJump: false, minZoom: 6, zoomControl: false });
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
const rend = L.canvas({ padding: 0.5, tolerance: 4 });
let baseLayer = null;
const gOv = L.layerGroup().addTo(map);
const gBorder = L.layerGroup().addTo(map), gLines = L.layerGroup().addTo(map), gPts = L.layerGroup().addTo(map), gSel = L.layerGroup().addTo(map);

function readColors() {
  for (const k of KINDS) S.col[k.id] = css('--k-' + k.id);
  S.col.border = css('--ink2');
}
function setBase(id) {
  S.base = id;
  if (baseLayer) map.removeLayer(baseLayer);
  const [url, attr, mz] = BASES[id]();
  baseLayer = L.tileLayer(url, { attribution: attr, maxZoom: mz, subdomains: 'abc', detectRetina: false }).addTo(map);
  baseLayer.bringToBack();
  map.getContainer().classList.toggle('dim', id === 'map' && isDark());
  document.querySelectorAll('.rbm').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === id)));
}

const inArea = it => S.prov !== '' ? it.prov.includes(+S.prov) : !S.reg || it.prov.some(i => PROVS[i].r === S.reg);
function passes(it) {
  if (!S.on[it.k]) return false;
  if (!inArea(it)) return false;
  if (S.q && !low(it.n).includes(S.q)) return false;
  return true;
}
function lineWeight(it) {
  if (it.k === 'dhat') return 1;
  return it.kv >= 380 ? 3.2 : it.kv >= 154 ? 2.2 : 1.5;
}

function drawBorders() {
  gBorder.clearLayers();
  for (const g of REGION.border) L.polyline(g, { renderer: rend, color: S.col.border, weight: 1, opacity: .55, dashArray: '4 4', interactive: false }).addTo(gBorder);
}
function draw() {
  gLines.clearLayers(); gPts.clearLayers();
  for (const it of ITEMS) {
    if (!passes(it)) continue;
    let lay;
    if (it.line) {
      lay = L.polyline(it.g, { renderer: rend, color: S.col[it.k], weight: lineWeight(it), opacity: it.k === 'dhat' ? .6 : .85 });
      lay.addTo(gLines);
    } else {
      const r = it.k === 'gen' ? 3 : it.k === 'tm' ? 6 : it.k === 'baraj' ? 4.5 : 6.5;
      lay = L.circleMarker(it.ll, { renderer: rend, radius: r, color: isDark() ? '#0e1920' : '#ffffff', weight: 1.2,
        fillColor: S.col[it.ck], fillOpacity: it.k === 'baraj' ? .55 : .95 });
      lay.addTo(gPts);
    }
    lay.on('click', e => { if (S.pick) return; S.at = e.latlng; select(it, true); });
    lay.bindTooltip(esc(it.nm), { direction: 'top', sticky: it.line, opacity: .92 });
  }
  if (S.sel && !passes(S.sel)) select(null);
  renderTypes(); renderView();
}

function renderTypes() {
  const n = {};
  for (const it of ITEMS) {
    if (!inArea(it)) continue;
    n[it.k] = (n[it.k] || 0) + 1;
  }
  $('types').innerHTML = KINDS.map(k => {
    const sw = k.id === 'hat' || k.id === 'dhat'
      ? `<i class="sw" style="height:3px;background:var(--k-${k.id})"></i>`
      : `<i class="sw" style="border-radius:50%;background:var(--k-${k.id === 'gen' ? 'diger' : k.id})"></i>`;
    return `<label><input type="checkbox" data-k="${k.id}" ${S.on[k.id] ? 'checked' : ''}>${sw}<span>${k.label}</span><b class="mono">${(n[k.id] || 0).toLocaleString('tr-TR')}</b></label>`;
  }).join('');
}

function visibleItems() {
  const vb = map.getBounds();
  return ITEMS.filter(it => passes(it) && vb.intersects(it.b));
}
const tierPill = r => `<span class="pill" style="background:var(--${tierOf(r.tier).cls})">${tierOf(r.tier).txt}</span>`;
function renderView() {
  const vis = visibleItems();
  const c = {};
  for (const it of vis) c[it.k] = (c[it.k] || 0) + 1;
  const parts = KINDS.filter(k => c[k.id]).map(k => `${c[k.id].toLocaleString('tr-TR')} ${k.sh}`);
  $('vSum').textContent = vis.length ? 'Bu görünümde: ' + parts.join(' · ') + '.' : 'Bu görünümde seçili katmanlarda varlık yok.';
  vis.sort((a, b) => KIND[a.k].i - KIND[b.k].i || (!a.n - !b.n) || a.nm.localeCompare(b.nm, 'tr'));
  const MAX = 300;
  const rows = vis.slice(0, MAX).map(it => {
    const ev = S.ev[it.id];
    const extra = it.line ? (it.kv ? kvTxt(it.v) : '') : (it.k === 'tm' && it.v ? kvTxt(it.v) : PROVS[it.p].n);
    const dv = ev ? (ev.ok ? tierPill(ev) : 'değerlendirilemedi') : esc(extra);
    return `<button class="row${S.sel === it ? ' sel' : ''}" data-i="${ITEMS.indexOf(it)}"><span class="dot" style="background:var(--k-${it.ck})${it.line ? ';height:3px' : ''}"></span><span class="nm">${esc(it.nm)}<small>${KIND[it.k].label}</small></span><span class="dv">${dv}</span></button>`;
  });
  if (vis.length > MAX) rows.push(`<p class="small" style="padding:0 6px">İlk ${MAX} gösteriliyor; daha fazlası için yakınlaştırın.</p>`);
  $('vList').innerHTML = rows.join('') || '<p class="empty" style="padding:0 6px">Yakınlaştırın ya da katman açın.</p>';
}

// ---------- bilgi kartı ----------
function showCard(on) { $('info').hidden = !on; }
function select(it, fromMap) {
  const changed = S.sel !== it || S.pt;
  S.sel = it; S.pt = null; gSel.clearLayers();
  if (!it) { showCard(false); renderView(); return; }
  const hi = isDark() ? '#ffffff' : '#14232e';
  if (it.line) L.polyline(it.g, { renderer: rend, color: hi, weight: lineWeight(it) + 4, opacity: .35, interactive: false }).addTo(gSel);
  else L.circleMarker(it.ll, { renderer: rend, radius: 11, color: hi, weight: 2.5, fill: false, interactive: false }).addTo(gSel);
  const [type, id] = it.id.split('/');
  const provs = it.prov.map(i => PROVS[i].n).join(', ');
  const ll = it.line ? null : it.ll;
  $('icKind').textContent = KIND[it.k].label;
  $('rDetail').innerHTML = `<p class="nm1">${esc(it.nm)}</p>
    <dl>
      ${it.line || it.k === 'tm' || it.k === 'baraj' ? '' : `<dt>Kaynak</dt><dd>${esc(srcTxt(it.s))}</dd>`}
      ${it.k === 'baraj' ? '' : `<dt>Gerilim</dt><dd>${esc(kvTxt(it.v))}</dd>`}
      ${it.mw ? `<dt>Kurulu güç</dt><dd>${esc(it.mw)}</dd>` : ''}
      <dt>İşletmeci</dt><dd>${esc(it.op || '–')}</dd>
      <dt>İl</dt><dd>${esc(provs)}</dd>
      ${ll ? `<dt>Konum</dt><dd>${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}</dd>` : ''}
      <dt>OSM</dt><dd><a href="https://www.openstreetmap.org/${type}/${id}" target="_blank" rel="noopener">${esc(it.id)}</a></dd>
    </dl>`;
  if (changed && !S.busy) evState('');
  if (S.ev[it.id]) renderEval(S.ev[it.id]); else { $('evOut').innerHTML = ''; $('info').classList.remove('report'); }
  renderEvalBtn(); showCard(true);
  if (isPhone() && !$('side').hidden) openTab(null);
  if (!fromMap) {
    if (it.line) map.fitBounds(it.b, { maxZoom: 14, padding: [30, 30] });
    else map.setView(it.ll, Math.max(map.getZoom(), 14));
  }
  renderView();
}
function selectPoint(lat, lon) {
  S.sel = null; S.pt = { lat, lon }; gSel.clearLayers();
  L.circleMarker([lat, lon], { renderer: rend, radius: 9, color: isDark() ? '#ffffff' : '#14232e', weight: 2.5, fill: false, interactive: false }).addTo(gSel);
  $('icKind').textContent = 'Seçilen nokta';
  $('rDetail').innerHTML = `<p class="nm1">${num(lat, 5)}, ${num(lon, 5)}</p><p class="small" style="margin:0">Haritada işaretlenen konum; 30 m hücre değerlendirilir.</p>`;
  $('evOut').innerHTML = ''; $('info').classList.remove('report'); evState('');
  renderEvalBtn(); showCard(true); renderView();
}

// ---------- istek anında değerlendirme (pipeline/ondemand/serve.py) ----------
// Öncelik HAND kademesinden gelir; AI bölgesi bakılacak alanı daraltır, tesisleri kendi aralarında sıralamaz.
function tierOf(t) {
  return t === 2 ? { cls: 'kritik', txt: '≤ 2 m' } : t === 5 ? { cls: 'yuksek', txt: '≤ 5 m' } : t === 10 ? { cls: 'orta', txt: '≤ 10 m' } : { cls: 'dusuk', txt: '> 10 m' };
}
const evState = t => { $('evState').textContent = t; };

function renderEvalBtn() {
  const b = $('bEval'), it = S.sel;
  b.disabled = !S.svc || S.busy || (!it && !S.pt);
  b.textContent = !S.svc ? 'Değerlendirme servisi bağlı değil (yerel)' : S.busy ? 'Hesaplanıyor…' : it && it.line ? 'Hattı tıklanan noktada değerlendir'
    : (it && S.ev[it.id]) ? 'Yeniden değerlendir' : 'Değerlendir';
  for (const id of ['bPick', 'tPick']) $(id).disabled = !S.svc || S.busy;
}

function evalTarget(it) {
  if (it.line) {
    const p = S.at && it.b.pad(0.01).contains(S.at) ? [S.at.lat, S.at.lng] : it.ll;
    return { lat: p[0], lon: p[1], ring: null, what: 'hattın tıklanan noktası (hat boyunca değil)' };
  }
  const closed = it.fp && it.fp.length >= 4 && it.fp[0][0] === it.fp[it.fp.length - 1][0] && it.fp[0][1] === it.fp[it.fp.length - 1][1];
  return { lat: it.ll[0], lon: it.ll[1], ring: closed ? it.fp : null, what: closed ? 'tesis izi (OSM poligonu)' : 'tesis noktası (30 m hücre)' };
}

async function runEval(tg, it) {
  if (S.busy) return;
  S.busy = true; renderEvalBtn();
  const t0 = performance.now();
  evState('Arazi verisi indiriliyor, HAND ve özellikler çıkarılıyor, model çalışıyor… Yeni bir pencere 5-15 s sürer.');
  try {
    const r = await (await fetch(API + '/api/eval', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: tg.lat, lon: tg.lon, ring: tg.ring }) })).json();
    r.what = tg.what; r.name = it ? it.nm : `Nokta ${num(tg.lat, 4)}, ${num(tg.lon, 4)}`; r.clientSecs = (performance.now() - t0) / 1000;
    if (it) S.ev[it.id] = r;
    S.hist.unshift({ r, it, lat: tg.lat, lon: tg.lon }); renderHist();
    const still = it ? S.sel === it : S.pt && S.pt.lat === tg.lat && S.pt.lon === tg.lon;
    if (still) {
      renderEval(r);
      evState(r.ok ? `Tamamlandı: ${num(r.clientSecs)} s${r.secs > 1 ? ', yeni pencere hesaplandı' : ', pencere bu oturumda hesaplanmıştı'}.` : '');
    }
    if (r.ok) await loadOverlay(tg.lat, tg.lon);
    renderView();
  } catch (e) {
    evState('Servise ulaşılamadı: ' + e.message);
  }
  S.busy = false; renderEvalBtn();
}

// Rapor: bento ızgarasında çevrilebilir kartlar. Ön yüz sonucu, arka yüz o değerin ne anlama geldiğini söyler.
// Arka yüzlerdeki sayılar CLAUDE.md "Doğrulanmış sayılar" tablosundandır; değiştirmeyin.
function flipCard(cls, label, front, back) {
  return `<button class="bc ${cls}" aria-pressed="false" aria-label="${esc(label)}: anlamını görmek için çevir">
    <span class="bc-in"><span class="bc-f"><span class="bc-l">${label}</span>${front}<span class="bc-hint" aria-hidden="true">↻ ne anlama geliyor?</span></span>
    <span class="bc-b" aria-hidden="true"><span class="bc-l">${label}</span><span class="bc-t">${back}</span></span></span></button>`;
}
function renderEval(r) {
  const o = $('evOut');
  $('info').classList.toggle('report', !!r.ok);
  if (!r.ok) { o.innerHTML = `<p class="aicheck warn" style="margin:0">${esc(r.reason || 'Değerlendirilemedi.')}</p>`; return; }
  const top = Math.max(0.1, (1 - r.score_pct) * 100), t = tierOf(r.tier);
  const what = /poligon/.test(r.what) ? 'OSM\'deki tesis poligonunun değdiği 30 m hücreler; aralarından en düşük HAND alınır.'
    : /hat/.test(r.what) ? 'Hat yalnızca tıklanan noktada değerlendirildi, hat boyunca değil. Hattın başka bir yeri daha alçakta olabilir.'
    : 'Tek bir 30 m hücre. Tesisin izi daha geniş olsaydı daha alçak bir hücreye değebilirdi; kademe izle değerlendirmeden yüksek çıkabilir.';
  const [cTier, cHand, cAi, cScore, cWhat, cWin, cModel] = [
    flipCard('bc-tier', 'HAND kademesi', `<span class="bc-big"><span class="pill" style="background:var(--${t.cls})">${t.txt}</span></span><span class="bc-s">öncelik sırası buradan gelir</span>`,
      `Nehre göre yükseklik kademesi: ≤ 2 m en önce, sonra ≤ 5 m ve ≤ 10 m. 8 olaylık doğrulamada belgelenmiş 7 hasarlı tesisin 7'si ≤ 10 m, 6'sı ≤ 2 m kademesindeydi. > 10 m güvenli demek değildir: köprü tıkanması, set aşılması ve tesis içi drenaj 30 m arazi modelinde görünmez.`),
    flipCard('bc-hand', 'Nehre göre en düşük yükseklik', `<span class="bc-num">${num(r.hand_min)}<small> m</small></span>`,
      `Varlık izindeki en alçak hücrenin, suyunun aktığı en yakın akarsuya (en az 1 km² havza) göre yüksekliği (HAND). Copernicus DEM GLO-30, 30 m. Kademe bu değerden gelir.`),
    flipCard('bc-ai', 'AI tarama bölgesi', `<span class="bc-val">${r.in_ai ? 'içinde' : 'dışında'}</span>`,
      `Pencerede en yüksek skorlu kara, HAND ≤ 5 m alanının 0,81'i kadar. Testte aynı seli bu alanla yakaladı (46 fırtına grubunun 38'i). Tesisleri sıralamaz.`),
    flipCard('bc-score', 'AI skoru', `<span class="bc-val">en yüksek %${num(top)}</span><span class="bc-s">penceredeki kara içinde</span>`,
      `Penceredeki karadaki sırası; olasılık değil. Kademe içinde hasarlı tesisin sırası medyan %49 (yazı-tura): tesis sıralamak için kullanılmaz.`),
    flipCard('bc-what', 'Değerlendirilen', `<span class="bc-val sm">${esc(r.what)}</span><span class="bc-s">${r.cells} hücre</span>`, what),
    flipCard('bc-win', 'Pencere', `<span class="bc-val">${r.window.km} × ${r.window.km} km</span><span class="bc-s">${num(r.window.center[0], 2)}, ${num(r.window.center[1], 2)}</span>`,
      `Veri istek anında indirildi (${num(r.clientSecs || r.secs)} s). Merkez 0,05° ızgaraya yaslanır: aynı varlık, aynı sonuç. AI bölgesi pencereye görelidir.`),
    flipCard('bc-model', 'Model', `<span class="bc-val">${esc(r.model)}</span><span class="bc-s">LightGBM · 17 özellik</span>`,
      `HAND, nehre uzaklık, eğim, rölyef, TWI, arazi örtüsü. 2026 kör testi: 13 selin 12'sinde daha küçük alanla aynı sel.`)
  ];
  const cards = [cTier, cAi, cScore, cHand, cWin, cModel, cWhat];
  // arazi tipi: 2 km içinde HAND ≤ 5 m kara payı (vakalar.html ile aynı eşikler ve metinler; eşikler sezgisel)
  let terr = null;
  if (r.low2k != null) {
    terr = r.low2k < 0.2 ? 'dar vadi' : r.low2k < 0.4 ? 'geniş vadi' : 'ova';
    const TB = {
      'dar vadi': 'Doğrulanan dar vadilerde ≤ 5 m bölge gözlenen selin %80-85\'ini, karanın %3-18\'ini işaretleyerek yakaladı. Kademe sıralama için kullanılabilir.',
      'geniş vadi': 'Ara durum. Ova ve yelpaze vakalarında ≤ 5 m bölge karanın %19-68\'ini işaretledi; kademe tek başına sıralamaz.',
      'ova': 'Ovada ≤ 5 m bölge karanın %32-68\'ini işaretledi. Kademe tek başına sıralamaz; ≤ 2 m ile ve set/bent bilgisiyle birlikte okunmalı.'
    };
    cards.push(flipCard('bc-terr', 'Arazi tipi', `<span class="bc-val">${terr}</span><span class="bc-s">2 km çevrede ≤ 5 m kara payı %${num(r.low2k * 100, 0)}</span>`,
      `Pay %20'nin altında dar vadi, %20-40 geniş vadi, üstü ova (eşikler sezgisel). ${TB[terr]}`));
  }
  if (r.sea) cards.push(flipCard('bc-sea', 'Deniz kaynaklı', `<span class="bc-val sm">kademeyi veren alçaklık denize göre</span>`,
    `Bu hücreler bir akarsuya değil doğrudan denize akıyor; kıyı düzeltmesiyle denize göre yükseklik aldılar. Bu bir nehir seli maruziyeti değil, deniz kaynaklı alçaklıktır.`));
  const notes = ['Öncelik HAND kademesinden gelir; AI tarama bölgesi bakılacak alanı daraltır.'];
  if (r.tier == null) notes.push('> 10 m güvenli demek değildir.');
  if (terr && terr !== 'dar vadi') notes.push(`Arazi ${terr}: kademe burada tek başına sıralamaz.`);
  o.innerHTML = `<div class="rep-h"><h3>Değerlendirme raporu</h3><span class="small">Kartlara tıklayın: arka yüz değerin anlamını açıklar.</span></div>
    <div class="bento">${cards.join('')}</div><p class="small rep-f">${notes.join(' ')}</p>`;
}
$('evOut').addEventListener('click', e => {
  const c = e.target.closest('.bc'); if (!c) return;
  const on = c.getAttribute('aria-pressed') !== 'true';
  c.setAttribute('aria-pressed', String(on));
  c.querySelector('.bc-f').setAttribute('aria-hidden', String(on));
  c.querySelector('.bc-b').setAttribute('aria-hidden', String(!on));
});

function renderHist() {
  $('evHist').innerHTML = S.hist.map((h, i) => `<button class="row" data-h="${i}"><span class="dot" style="background:var(--k-${h.it ? h.it.ck : 'diger'})"></span>
    <span class="nm">${esc(h.r.name)}<small>${h.it ? KIND[h.it.k].label : 'nokta'}</small></span><span class="dv">${h.r.ok ? tierPill(h.r) : 'değerlendirilemedi'}</span></button>`).join('')
    || '<p class="empty">Henüz değerlendirme yok.</p>';
}

async function loadOverlay(lat, lon) {
  const d = await (await fetch(`${API}/api/overlay?lat=${lat}&lon=${lon}`)).json();
  const raw = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
  S.ovData = { d, raw };
  $('evOv').hidden = false; $('ovNone').hidden = true;
  drawOverlay();
}
function drawOverlay() {
  gOv.clearLayers();
  $('mapLeg').hidden = !S.ovData || !(S.ov.tier || S.ov.ai);
  if (!S.ovData) return;
  $('mapLeg').querySelectorAll('span').forEach(s => { s.hidden = s.classList.contains('lg-ai') ? !S.ov.ai : !S.ov.tier; });
  const { d, raw } = S.ovData;
  const rgb = h => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = h; const v = c.fillStyle; return [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)); };
  const col = { 1: rgb(css('--kritik')), 2: rgb(css('--yuksek')), 3: rgb(css('--orta')) }, wa = rgb(css('--water'));
  const cv = document.createElement('canvas'); cv.width = d.w; cv.height = d.h;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(d.w, d.h);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i], t = v & 3, ai = v & 4, x = i % d.w, y = (i / d.w) | 0, j = i * 4;
    if (S.ov.ai && ai && ((x + y) % 4 < 2)) { img.data.set([...wa, 230], j); continue; }   // AI bölgesi: taralı
    if (S.ov.tier && t) img.data.set([...col[t], t === 1 ? 150 : t === 2 ? 120 : 85], j);
  }
  ctx.putImageData(img, 0, 0);
  L.imageOverlay(cv.toDataURL(), d.bounds, { interactive: false, className: 'rgov' }).addTo(gOv);
  L.rectangle(d.bounds, { renderer: rend, color: S.col.border, weight: 1, dashArray: '6 4', fill: false, interactive: false }).addTo(gOv);
}

function setPick(on) {
  S.pick = on;
  for (const id of ['bPick', 'tPick']) $(id).setAttribute('aria-pressed', String(on));
  $('bPick').textContent = on ? 'Haritada bir noktaya tıklayın…' : 'Haritada nokta seç';
  map.getContainer().classList.toggle('picking', on);
  if (on && isPhone()) openTab(null);
  // rapor haritanın büyük kısmını kaplar: nokta seçerken kart çekilir, vazgeçilirse geri gelir
  if (on) showCard(false); else if (S.sel || S.pt) showCard(true);
}
$('bEval').addEventListener('click', () => {
  if (S.sel) runEval(evalTarget(S.sel), S.sel);
  else if (S.pt) runEval({ lat: S.pt.lat, lon: S.pt.lon, ring: null, what: 'seçilen nokta (30 m hücre)' }, null);
});
$('bPick').addEventListener('click', () => setPick(!S.pick));
$('tPick').addEventListener('click', () => setPick(!S.pick));
map.on('click', e => {
  if (!S.pick) return;
  setPick(false);
  selectPoint(e.latlng.lat, e.latlng.lng);
  runEval({ lat: e.latlng.lat, lon: e.latlng.lng, ring: null, what: 'seçilen nokta (30 m hücre)' }, null);
});
$('evOv').addEventListener('click', e => {
  const b = e.target.closest('.ov'); if (!b) return;
  S.ov[b.dataset.ov] = !S.ov[b.dataset.ov]; b.setAttribute('aria-pressed', String(S.ov[b.dataset.ov])); drawOverlay();
});
$('evHist').addEventListener('click', e => {
  const r = e.target.closest('.row'); if (!r) return;
  const h = S.hist[+r.dataset.h];
  if (h.it) select(h.it);
  else { selectPoint(h.lat, h.lon); renderEval(h.r); map.setView([h.lat, h.lon], Math.max(map.getZoom(), 13)); }
});
// Servis önce sayfanın kendi adresinde, sonra varsayılan yerel portta aranır (sayfa Live Server ya da dosyadan açılmış olabilir)
let API = '';
async function checkService() {
  S.svc = false;
  for (const base of ['', 'http://localhost:8000', 'http://127.0.0.1:8000']) {
    if (base === '' && location.protocol === 'file:') continue;
    try {
      const r = await (await fetch(base + '/api/health', { cache: 'no-store' })).json();
      if (r.ok) { API = base; S.svc = true; break; }
    } catch (e) { /* sıradaki adres */ }
  }
  $('evOff').hidden = S.svc;
  $('stSvc').innerHTML = S.svc ? '<i class="on"></i>servis bağlı · model_v2' : '<i class="off"></i>servis bağlı değil';
  renderEvalBtn();
}

// ---------- panel ve araçlar ----------
function openTab(id) {
  S.tab = id;
  $('side').hidden = !id;
  document.querySelectorAll('.rail .tab[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === id)));
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
  map.invalidateSize();
}
document.querySelectorAll('.rail .tab[data-tab]').forEach(b => b.addEventListener('click', () => openTab(S.tab === b.dataset.tab ? null : b.dataset.tab)));
$('sideClose').addEventListener('click', () => openTab(null));
$('infoClose').addEventListener('click', () => { select(null); S.pt = null; gSel.clearLayers(); });
$('tZin').addEventListener('click', () => map.zoomIn());
$('tZout').addEventListener('click', () => map.zoomOut());
$('tFit').addEventListener('click', () => fitAll());
map.on('mousemove', e => { $('stLL').textContent = `${num(e.latlng.lat, 5)} K · ${num(e.latlng.lng, 5)} D`; });
map.on('zoomend', () => { $('stZ').textContent = 'yakınlık ' + num(map.getZoom(), 1); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (S.pick) setPick(false); else if (!$('info').hidden) $('infoClose').click(); } });

$('types').addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return;
  S.on[k] = e.target.checked; draw();
});
const provSel = $('prov'), regSel = $('reg');
const REGS = REGION.regions || [...new Set(PROVS.map(p => p.r).filter(Boolean))];
regSel.innerHTML = `<option value="">Tüm Türkiye (${PROVS.length} il)</option>` + REGS.map(r => `<option value="${esc(r)}">${esc(r)} Bölgesi</option>`).join('');
regSel.hidden = REGS.length < 2;
function fillProv() {
  const ps = PROVS.map((p, i) => [p, i]).filter(([p]) => !S.reg || p.r === S.reg).sort((a, b) => a[0].n.localeCompare(b[0].n, 'tr'));
  provSel.innerHTML = `<option value="">${S.reg ? `Tüm ${esc(S.reg)} (${ps.length} il)` : `Tüm iller (${ps.length})`}</option>` +
    ps.map(([p, i]) => `<option value="${i}">${esc(p.n)}</option>`).join('');
}
function fitArea() {
  const b = ITEMS.filter(it => !it.line && passes(it)).map(it => it.ll);
  if (b.length) map.fitBounds(b, { padding: [20, 20] }); else fitAll();
}
regSel.addEventListener('change', () => { S.reg = regSel.value; S.prov = ''; fillProv(); draw(); fitArea(); });
provSel.addEventListener('change', () => { S.prov = provSel.value; draw(); fitArea(); });
fillProv();
let qT;
const qIn = $('q');
qIn.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { S.q = low(qIn.value.trim()); draw(); }, 200); });
qIn.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  S.q = low(qIn.value.trim()); draw();
  const m = ITEMS.filter(passes);
  if (m.length === 1) select(m[0]);
  else if (m.length && S.q) map.fitBounds(m.reduce((b, it) => b.extend(it.b), L.latLngBounds(m[0].b.getSouthWest(), m[0].b.getNorthEast())), { padding: [30, 30], maxZoom: 13 });
});
document.querySelectorAll('.rbm').forEach(b => b.addEventListener('click', () => setBase(b.dataset.base)));
$('vList').addEventListener('click', e => {
  const r = e.target.closest('.row'); if (r) select(ITEMS[+r.dataset.i]);
});
$('bCsv').addEventListener('click', async () => {
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const lines = ['osm_id,tur,ad,kaynak,gerilim,isletmeci,il,enlem,boylam,hand_kademesi,hand_min_m,ai_bolgesi'];
  for (const it of visibleItems()) {
    const ll = it.line ? ['', ''] : it.ll, ev = S.ev[it.id] && S.ev[it.id].ok ? S.ev[it.id] : null;
    lines.push([it.id, KIND[it.k].label, it.n || '', it.s || '', it.v || '', it.op || '', it.prov.map(i => PROVS[i].n).join('; '), ll[0], ll[1],
      ev ? tierOf(ev.tier).txt : '', ev ? ev.hand_min : '', ev ? (ev.in_ai ? 'içinde' : 'dışında') : ''].map(q).join(','));
  }
  const btn = $('bCsv');
  try { await navigator.clipboard.writeText(lines.join('\n')); btn.textContent = 'Kopyalandı'; }
  catch (e) { btn.textContent = 'Kopyalanamadı'; }
  setTimeout(() => { btn.textContent = 'CSV kopyala'; }, 1600);
});
map.on('moveend', renderView);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawBorders(); draw(); setBase(S.base); drawOverlay(); });

function fitAll() { map.fitBounds(ITEMS.filter(it => !it.line).map(it => it.ll), { padding: [10, 10] }); }

// ---------- başlangıç ----------
(function init() {
  readColors();
  const nPts = REGION.pts.length, nLines = REGION.lines.length;
  $('chips').innerHTML =
    `<span class="chip"><b>${PROVS.length}</b> il</span><span class="chip"><b>${nPts.toLocaleString('tr-TR')}</b> tesis</span>` +
    `<span class="chip"><b>${nLines.toLocaleString('tr-TR')}</b> hat</span><span class="chip">OSM <b>${REGION.date}</b></span>`;
  $('rSrc').textContent = `Varlıklar ve il sınırları © OpenStreetMap katkıda bulunanlar, ODbL lisansı (veri ${REGION.date} tarihinde Overpass API ile alındı; ${PROVS.length} il). Güneş paneli dizileri (generator:source=solar) ve dağıtım hatları (power=minor_line) envantere alınmadı. Arazi: Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 ve © Airbus Defence and Space GmbH 2014-2018, Copernicus programı kapsamında), ESA WorldCover 2021 (© ESA), Microsoft Planetary Computer üzerinden. Zemin haritaları: OpenStreetMap standart karoları, OpenTopoMap (CC-BY-SA, SRTM), Esri World Imagery (© Esri, Maxar, Earthstar Geographics). Harita kütüphanesi: Leaflet.`;
  if (isPhone()) openTab(null);
  setBase('map');
  fitAll();
  $('stZ').textContent = 'yakınlık ' + num(map.getZoom(), 1);
  drawBorders(); draw();
  checkService();
})();

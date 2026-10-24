//#pure-start
const R_LON = 111320, R_LAT = 110540;
const CLASSES = [
  { id: 'kritik', label: 'Alanın içinde' },
  { id: 'yuksek', label: 'Yüksek' },
  { id: 'orta', label: 'Orta' },
  { id: 'dusuk', label: 'Düşük' }
];

function featuresOf(o) {
  if (!o) return [];
  if (o.type === 'FeatureCollection') return o.features || [];
  if (o.type === 'Feature') return [o];
  if (o.type && o.coordinates) return [{ type: 'Feature', properties: {}, geometry: o }];
  return [];
}
function polysOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return (g.geometries || []).flatMap(polysOf);
  return [];
}
function kindOf(t) {
  const s = String(t.power || '').toLowerCase();
  const txt = [t.name, t.type, t.kind, t['plant:source'], t['generator:source']].join(' ').toLowerCase();
  if (s === 'substation' || /trafo|transform|substation/.test(txt)) return 'Trafo merkezi';
  if (/solar|wind/.test(String(t['plant:source'] || t['generator:source'] || ''))) return 'GES/RES';
  if (s === 'plant' || s === 'generator' || /\bhes\b|hidro|hydro/.test(txt) || t['plant:source'] === 'hydro') return 'HES';
  if (t.waterway === 'dam' || /baraj/.test(txt)) return 'Baraj';
  if (s === 'line' || s === 'cable') return 'İletim hattı';
  if (s === 'minor_line') return 'Dağıtım hattı';
  return 'Diğer';
}
function looksLikeAssets(obj) {
  if (obj && Array.isArray(obj.elements)) return true;
  return featuresOf(obj).some(f => {
    const p = f.properties || {};
    const t = p.tags || p;
    return t.power || t.waterway || t.kind || (f.geometry && f.geometry.type === 'Point');
  });
}
function parseFlood(obj) {
  const polys = [];
  for (const f of featuresOf(obj)) for (const p of polysOf(f.geometry)) polys.push(p);
  return polys;
}
function ringCentroid(r) {
  let x = 0, y = 0;
  for (const p of r) { x += p[0]; y += p[1]; }
  return [x / r.length, y / r.length];
}
function parseAssets(obj) {
  const out = []; let skipped = 0, fi = -1;
  const push = (props, ring, isPoly, isLine) => {
    const t = props.tags || props;
    const kind = kindOf(t);
    const nm = t.name || t['name:tr'] || t.ref || '';
    out.push({ id: out.length, fi, name: nm || ('Adsız – ' + kind), kind, ring, isPoly, isLine: !!isLine, c: ringCentroid(ring) });
  };
  if (obj && Array.isArray(obj.elements)) {
    for (const e of obj.elements) {
      fi++; const tags = e.tags || {};
      if (e.type === 'node' && e.lat != null) push({ tags }, [[e.lon, e.lat]], false);
      else if (e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length > 2) push({ tags }, e.geometry.map(g => [g.lon, g.lat]), true);
      else if (e.center) push({ tags }, [[e.center.lon, e.center.lat]], false);
      else skipped++;
    }
    return { assets: out, skipped };
  }
  for (const f of featuresOf(obj)) {
    fi++; const g = f.geometry; const p = f.properties || {};
    if (!g) { skipped++; continue; }
    if (g.type === 'Point') push(p, [g.coordinates.slice(0, 2)], false);
    else if (g.type === 'MultiPoint') g.coordinates.forEach(c => push(p, [c.slice(0, 2)], false));
    else if (polysOf(g).length) polysOf(g).forEach(pl => push(p, pl[0].map(c => c.slice(0, 2)), true));
    else if (g.type === 'LineString' && g.coordinates.length > 1) {
      const t = p.tags || p;
      if (t.waterway === 'weir' || (t.waterway === 'dam' && !t.power)) { skipped++; continue; }
      push(p, g.coordinates.map(c => c.slice(0, 2)), false, true);
    }
    else skipped++;
  }
  return { assets: out, skipped };
}
function makeProj(floodsLL, assetsLL) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const add = p => { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; };
  floodsLL.forEach(pl => pl.forEach(r => r.forEach(add)));
  assetsLL.forEach(x => x.ring.forEach(add));
  if (!isFinite(a)) { a = 0; c = 0; b = 0; d = 0; }
  const lon0 = (a + c) / 2, lat0 = (b + d) / 2, k = Math.cos(lat0 * Math.PI / 180) * R_LON;
  return ll => [(ll[0] - lon0) * k, (ll[1] - lat0) * R_LAT];
}
function ptSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}
function inRing(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function inPoly(p, poly) {
  if (!inRing(p, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(p, poly[k])) return false;
  return true;
}
function segX(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
// Varlığın (nokta veya halka) sel izi poligonlarına en kısa uzaklığı (m). 0 = iz ile kesişiyor veya içinde.
function exposure(ring, floods, isLine) {
  let best = { d: Infinity, a: ring[0], f: null };
  const n = ring.length;
  const segs = isLine ? n - 1 : n; // açık çizgide kapanış kenarı yok
  const polyAsset = n > 2 && !isLine;
  for (const poly of floods) {
    for (const v of ring) if (inPoly(v, poly)) return { d: 0, a: v, f: v };
    if (n > 1) {
      if (polyAsset && inRing(poly[0][0], ring)) return { d: 0, a: poly[0][0], f: poly[0][0] };
      for (const fr of poly) for (let i = 0; i < fr.length; i++) {
        const f1 = fr[i], f2 = fr[(i + 1) % fr.length];
        for (let j = 0; j < segs; j++) if (segX(f1, f2, ring[j], ring[(j + 1) % n])) return { d: 0, a: ring[j], f: f1 };
      }
    }
    for (const fr of poly) {
      for (let i = 0; i < fr.length; i++) {
        const f1 = fr[i], f2 = fr[(i + 1) % fr.length];
        for (const v of ring) { const r = ptSeg(v, f1, f2); if (r.d < best.d) best = { d: r.d, a: v, f: r.q }; }
        if (n > 1) for (let j = 0; j < segs; j++) {
          const r = ptSeg(f1, ring[j], ring[(j + 1) % n]);
          if (r.d < best.d) best = { d: r.d, a: r.q, f: f1 };
        }
      }
    }
  }
  return best;
}
function classify(d, t1, t2) {
  if (!isFinite(d)) return 'yok';
  if (d === 0) return 'kritik';
  if (d <= t1) return 'yuksek';
  if (d <= t2) return 'orta';
  return 'dusuk';
}

// AI notu için istem: model yalnızca bu tablodaki değerlere dayanır.
function buildPrompt(rows, ctx) {
  const lines = rows.map((r, i) => `${i + 1}. ${r.name} | ${r.kind} | ${ctx.zone ? 'nehre göre yükseklik' : 'tehlike alanına uzaklık'}: ${r.dist} | sınıf: ${r.cls}${r.loc ? ' | konum (enlem, boylam): ' + r.loc : ''}${r.terr ? ' | arazi: ' + r.terr : ''}${r.kent ? ' | kent içi' : ''}${r.br ? ' | köprü daralması: ' + r.br : ''}${r.hand ? ' | HAND kademesi: ' + r.hand : ''}`).join('\n');
  return [
    ctx.ai
      ? 'Sen bir enerji şebekesi sel risk analistisin. Aşağıdaki tablo, varlıkların bir yapay zeka yatkınlık modelinin çizdiği tarama bölgesine HESAPLANMIŞ uzaklıklarını ve her varlığın HAND kademesini (nehre göre yükseklik) gösterir. Bu bölge gözlenmiş bir sel değildir; notta "sel oldu" veya "su bastı" deme. Önceliği HAND kademesine göre ver; AI bölgesi yalnızca bakılacak alanı daraltır. Operatöre kısa bir Türkçe risk notu yaz.'
      : ctx.zone
      ? 'Sen bir enerji şebekesi sel risk analistisin. Aşağıdaki tablo, Copernicus DEM\'den modellenmiş sel-yatkın bölgeye (nehre göre yükseklik, HAND) göre HESAPLANMIŞ varlık uzaklıklarıdır. Bu bölge gözlenmiş bir sel değil, modellenmiş yatkınlıktır; notta "sel oldu" veya "su bastı" deme. Operatöre kısa bir Türkçe risk notu yaz.'
      : 'Sen bir enerji şebekesi sel risk analistisin. Aşağıdaki tablo, Sentinel-2 ile çıkarılmış sel izi poligonlarına göre HESAPLANMIŞ varlık uzaklıklarıdır. Operatöre kısa bir Türkçe risk notu yaz.',
    '',
    'KURALLAR:',
    '- Yalnızca tablodaki ve aşağıdaki bağlamdaki sayıları kullan. Yeni sayı, tarih, kapasite veya hasar tahmini uydurma.',
    '- Uzaklıkları tabloda yazıldığı gibi kullan (metre veya km), birim dönüştürme yapma.',
    '- Sınıfı kendin değiştirme. Tablodaki sınıfı aktar.',
    '- Düz metin yaz. Markdown, madde işareti sembolü veya kalın yazı kullanma. En fazla 170 kelime.',
    '- Tablodaki sıra numaralarını notta kullanma, okuyucu tabloyu görmüyor. Adı "Adsız" olan veya adı yalnızca türü olan varlıkları tablodaki konumuyla an.',
    '- BAĞLAM bölümünde yağış satırı varsa notta mutlaka bir cümleyle an: hangi günlerde hangi değer tahmin edildi ve CHIRPS ekstremi düşük gösterebilir. CHIRPS uydu ve istasyon verisinden türetilen bir tahmindir, "ölçüldü" yazma. İstasyon değerleri ölçümdür.',
    '',
    'ÇIKTI BİÇİMİ (bu üç başlık, başlıkları aynen yaz):',
    'Öncelikli kontrol: tehlike alanının içindeki ve en yakın varlıklar, hangisi neden önce.',
    'Belirsizlik: hangi sonuca neden tam güvenilmemeli.',
    'Sınıfı değiştirebilecek veri: hangi ek veri gelirse sonuç değişir.',
    '',
    'BAĞLAM:',
    ctx.zone
      ? '- Sınıflar nehre göre yüksekliğe göre: ≤ 2 m, ≤ 5 m, ≤ 10 m, > 10 m. Hatlarda direk verisi varsa kademe en alçak direğin kademesidir ve tabloda "N direğin K\'si" yazar; direk verisi yoksa uzunluğun en az %10\'unun bulunduğu en alçak kademedir. Tek bir direğin düşük çıkması 30 m hücre çözünürlüğünden kaynaklanabilir, bunu belirt.\n- "kent içi" etiketi: varlığın 500 m çevresinin en az %30\'u yapı alanı (ESA WorldCover). Bu varlıklarda bir kademe yukarı bakılması gerektiğini söyle. Çok kısa bir hattı (100 m altı) öncelikli gösterirsen uzunluğunu belirt ve bunun sınırlı bir bulgu olduğunu söyle.'
      : ctx.ai ? '' : `- Eşikler: tehlike alanının içinde = 0; yüksek ≤ ${ctx.t1} m; orta ≤ ${ctx.t2} m; düşük > ${ctx.t2} m.`,
    ctx.ai ? '- AI tarama bölgesi: 155 sel bölgesinde, modelin görmediği olaylarda test edildi; aynı seli HAND ≤ 5 m bölgesinden %19 daha az alanla yakalıyor. Belgelenmiş 9 hasarlı tesisin 8\'i bölgenin içinde (HAND\'da da 8). Tesisleri kendi aralarında sıralamada HAND\'dan iyi değil; bu yüzden öncelik HAND kademesindedir. 2026 kör testinde (13 sel) 12 olayda daha küçük alanla aynı seli yakaladı; sele değen 23 TM/santralin 17\'sini 436 tesis işaretleyerek buldu (HAND ≤ 5 m: 16, 590 tesis). Bölge, HAND ≤ 5 m bölgesinin %81\'i büyüklüğündedir. Bölge dışı güvenli demek değildir.' : '',
    ctx.ai ? `- Eşikler: AI bölgesinin içinde = 0; yüksek ≤ ${ctx.t1} m; orta ≤ ${ctx.t2} m; düşük > ${ctx.t2} m.` : '',
    ctx.rain ? '- Yağış: ' + ctx.rain : '',
    ctx.chL ? `- "köprü daralması" etiketi: varlık nehre göre en fazla 10 m yüksekte ve akarsu boyunca ${ctx.chL} m içinde mansabında (aşağı akış tarafında) OpenStreetMap'te bir köprü ya da menfez var. Bozkurt 2021 İTÜ raporu, taşmaların rüsubat ve tomrukla tıkanan köprü kesitlerinde başladığını belirtiyor. Tıkanma olasılığı ve kabarma yüksekliği hesaplanmadı. Köprüler bugünkü OSM durumudur, olay anındakinden farklı olabilir. Etiketli varlıkları öncelikli kontrolde ayrıca an.` : '',
    ctx.obs ? '- "gözlenen izle kesişiyor" etiketi, varlığın 6 ve 16 Ağustos 2021 Sentinel-2 sel izi poligonlarıyla kesiştiğini gösterir. Bu gözlenmiş bir kanıttır ama iz alt sınırdır. Etiketli varlıkları notta öne çıkar ve modelin kademesiyle uyuşup uyuşmadığını belirt. Etiketli bir varlık > 10 m kademesindeyse bunu modelin kaçırdığı bir gözlem olarak açıkça yaz (hatlarda kısa kesit nedeniyle olabilir).' : '',
    ctx.ai ? '' : ctx.zone
      ? '- Sel-yatkın bölge: Copernicus DEM 30 m verisinden hesaplanan, en yakın akarsu hücresine göre yüksekliği 5 m veya daha az olan alan. Yağış, mevsim ve yapıların etkisi yok sayılır. Düz ovada alan geniş çıkar.'
      : '- Sel izi, 6 ve 16 Ağustos 2021 Sentinel-2 görüntülerinden bitki ve parlaklık değişimiyle çıkarıldı. Alt sınırdır, kent içinde parça parça. Gerçek iz daha geniş olabilir.',
    ctx.ai ? '' : ctx.zone
      ? '- Doğrulama (8 olay, aynı kurallar): belgelenmiş 7 hasarlı enerji tesisinin 7\'si ≤ 10 m, 6\'sı ≤ 2 m kademesinde. Dar vadide ≤ 5 m bölge gözlenen selin %80-85\'ini, karanın %3-18\'ini işaretleyerek yakaladı. Ovada karanın %32-68\'ini işaretledi. Kent içinde (Lancaster) ≤ 5 m kapsamı %51, ≤ 10 m kapsamı %91.\n- "arazi" alanı: varlığın 2 km çevresindeki karanın ne kadarının ≤ 5 m olduğuna göre dar vadi (%20 altı), geniş vadi (%20-40) veya ova (%40 üstü). Geniş vadi ve ovadaki varlıklar için kademenin tek başına öncelik sıralaması yapmadığını belirt. Eşikler sezgiseldir.\n- "deniz kaynaklı" etiketi: kademeyi veren alçaklık denize göredir, nehre göre değil. Nehir seli için yanlış alarm olabilir, fırtına kabarması için ayrıca değerlendirilmelidir.\n- Varlık kent içindeyse bir kademe yukarı bakılmalıdır (≤ 5 m yerine ≤ 10 m), çünkü DEM binaları zemin gibi gösterir.'
      : '- Sentinel-1 radarından güvenilir alan çıkarılamadı, kullanılmadı.',
    '- Orta gerilim dağıtım trafoları ve yerel dağıtım hatları OpenStreetMap\'te büyük oranda yok. Tablodaki trafo merkezleri ve hatlar iletim düzeyindedir. En riskli dağıtım varlıkları bu analizde görünmüyor.',
    ctx.zone ? '- Belirsizlik kısmında şunu da belirt: düz ova, alüvyon yelpazesi ve kent içinde 30 m DEM ile nehre göre yükseklik kademesi daha az güvenilirdir.' : '',
    '- Hatlar için "alanın içinde" hattın tehlike alanını kestiği anlamına gelir. Direklerin sular altında kaldığı anlamına gelmez.',
    `- Tehlike alanına ${ctx.farKm} km'den uzak ${ctx.far} varlık analiz dışı bırakıldı.`,
    ctx.demo ? '- UYARI: Veri örnek (sentetik). Notun başında bunu belirt.' : '',
    '',
    'TABLO (tehlike alanına yakınlığa göre sıralı):',
    lines
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
}
// Nottaki sayıların hepsi istemde geçiyor mu? Geçmeyenleri döndürür.
function ungroundedNumbers(note, prompt) {
  const tok = s => (s.match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(',', '.'));
  const allowed = new Set(tok(prompt));
  const cleaned = note.replace(/^\s*\d+[.)]\s*/gm, '');
  return Array.from(new Set(tok(cleaned).filter(n => !allowed.has(n))));
}
//#pure-end

/* ---------- Örnek veri (sentetik) ---------- */
function demoData() {
  // Uydurma bir dere hattı; konumlar gerçek bir varlığa veya sele ait değildir.
  const lonLat = [[34.000,41.870],[34.006,41.885],[34.003,41.900],[34.010,41.915],[34.008,41.930],[34.012,41.945],[34.014,41.955]];
  const width = [30, 40, 60, 70, 90, 110, 130];
  const lat0 = 41.91, k = Math.cos(lat0 * Math.PI / 180) * R_LON;
  const toM = p => [(p[0] - 34.005) * k, (p[1] - lat0) * R_LAT];
  const toLL = m => [m[0] / k + 34.005, m[1] / R_LAT + lat0];
  const c = lonLat.map(toM);
  const left = [], right = [];
  c.forEach((p, i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l, h = width[i] / 2;
    left.push(toLL([p[0] + nx * h, p[1] + ny * h]));
    right.push(toLL([p[0] - nx * h, p[1] - ny * h]));
  });
  const ring = left.concat(right.reverse()); ring.push(ring[0]);
  const flood = [[ring]];
  const at = (i, de, dn) => toLL([c[i][0] + de, c[i][1] + dn]);
  const box = (i, de, dn, w, h) => {
    const cx = c[i][0] + de, cy = c[i][1] + dn;
    const r = [[cx - w/2, cy - h/2], [cx + w/2, cy - h/2], [cx + w/2, cy + h/2], [cx - w/2, cy + h/2]].map(toLL);
    r.push(r[0]); return r;
  };
  const mk = (id, name, kind, ringLL, isPoly) => ({ id, name, kind, ring: ringLL, isPoly, c: ringCentroid(ringLL) });
  const assets = [
    mk(0, 'Örnek TM-1', 'Trafo merkezi', [at(2, 15, 0)], false),
    mk(1, 'Örnek TM-2', 'Trafo merkezi', [at(3, 400 + 35, 40)], false),
    mk(2, 'Örnek TM-3', 'Trafo merkezi', [at(4, -1800, 120)], false),
    mk(3, 'Örnek TM-4', 'Trafo merkezi', [at(5, 180 + 55, -30)], false),
    mk(4, 'Örnek TM-5', 'Trafo merkezi', [at(1, 900, 300)], false),
    mk(5, 'Örnek TM-6', 'Trafo merkezi', [at(6, -2600, 0)], false),
    mk(6, 'Örnek HES-1', 'HES', box(0, 10, 20, 80, 60), true),
    mk(7, 'Örnek HES-2', 'HES', box(3, -700, 0, 90, 70), true),
    mk(8, 'Örnek HES-3', 'HES', box(5, 1300, 80, 70, 50), true)
  ];
  return { flood, assets };
}

/* ---------- Bozkurt vakası (gömülü gerçek veri) ---------- */
/* BOZKURT: data/bozkurt.js */
/* CASES: data/cases.js */
// v2 (23 Eki 2026): kıyı düzeltmeli HAND'den deniz kaynaklı bölge poligonları, varlık başına arazi tipi (f = 2 km çevredeki karanın ≤5 m payı),
// hat başına direk kademeleri (tow: OSM power=tower/pole, hatta 20 m içinde, direk hücresindeki HAND) ve kent payı (kent: ESA WorldCover 2021 yapı alanı, 500 m çevre)
/* PTAG: data/ptag.js */
/* CHOKE: data/choke.js */
/* BASE: data/base.js */

/* ---------- Durum ---------- */
const $ = s => document.querySelector(s);
const AN_R = 10000; // sel izine 10 km'den uzak varlıklar analiz dışı
const S = { base: 'sat', imgs: {}, caseId: null, layer: 'scar', far: 0, flood: [], assets: [], floodSrc: '', assetSrc: '', demoFlood: false, demoAssets: false,
  t1: 500, t2: 1500, sel: null, res: [], floodM: [], v: { s: 1, ox: 0, oy: 0 }, proj: null, W: 0, H: 0, dpr: 1 };

const cv = $('#cv'), ctx = cv.getContext('2d');
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function bbOf(poly) { let a = 1e18, b = 1e18, c = -1e18, d = -1e18; for (const p of poly[0]) { a = Math.min(a, p[0]); c = Math.max(c, p[0]); b = Math.min(b, p[1]); d = Math.max(d, p[1]); } return [a, b, c, d]; }
function inZone(p, zs) { for (const z of zs) { const b = z.bb; if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue; if (inPoly(p, z.pl)) return true; } return false; }
function lineSamples(ring) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 40));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  out.push(ring[ring.length - 1]); return out;
}
// Sel-yatkın bölge: varlık nehre göre yüksekliğin en alçak hangi kademesine (≤2, ≤5, ≤10 m) giriyor.
// Hatlarda kademe, uzunluğun en az %10'unun bulunduğu en alçak kademedir.
// Türkçe iyelik eki: 1'i, 2'si, 3'ü, 6'sı, 9'u, 10'u, 40'ı, 100'ü
function ek(n) { n = Math.abs(Math.round(n)); const t = { 0: "ı", 1: "i", 2: "si", 3: "ü", 4: "ü", 5: "i", 6: "sı", 7: "si", 8: "i", 9: "u" };
  if (n === 0) return "0'ı"; const d = n % 10; if (d) return n + "'" + t[d];
  const z = { 1: "u", 2: "si", 3: "u", 4: "ı", 5: "si", 6: "ı", 7: "i", 8: "i", 9: "ı" }, d2 = Math.floor(n / 10) % 10;
  if (n % 100 && d2) return n + "'" + z[d2]; return n + (n % 1000 ? "'ü" : "'i"); }
function gradeZone(all) {
  const lv = [2, 5, 10], P = S.proj;
  S.zoneM = {};
  const cv0 = S.caseId && CASES[S.caseId].cover, c0 = cv0 && P([cv0[0] + 0.01, cv0[1] + 0.01]), c1 = cv0 && P([cv0[2] - 0.01, cv0[3] - 0.01]);
  const inCov = p => !cv0 || (p[0] >= c0[0] && p[0] <= c1[0] && p[1] >= c0[1] && p[1] <= c1[1]);
  S.obsM = S.obsLL ? S.obsLL.map(pl => pl.map(r => r.map(P))) : null;
  lv.forEach(l => { S.zoneM[l] = S.zoneLL[l].map(pl => { const m = pl.map(r => r.map(P)); return { pl: m, bb: bbOf(m) }; }); });
  S.seaM = {}; lv.forEach(l => { S.seaM[l] = S.seaLL ? S.seaLL[l].map(pl => { const m = pl.map(r => r.map(P)); return { pl: m, bb: bbOf(m) }; }) : []; });
  all.forEach(r => {
    let L = 99; const pct = x => Math.round(x * 100);
    if (r.a.isLine) {
      let len = 0; for (let i = 0; i < r.ringM.length - 1; i++) len += Math.hypot(r.ringM[i + 1][0] - r.ringM[i][0], r.ringM[i + 1][1] - r.ringM[i][1]);
      r.lenTxt = len < 1000 ? Math.round(len) + ' m' : (len / 1000).toFixed(1).replace('.', ',') + ' km';
      const smAll = lineSamples(r.ringM), sm = smAll.filter(inCov); r.share = {};
      if (sm.length < smAll.length * 0.3) { r.cov = false; return; }
      lv.forEach(l => { r.share[l] = sm.filter(p => inZone(p, S.zoneM[l])).length / sm.length; });
      const tw = S.tow && r.a.fi != null ? S.tow['f' + r.a.fi] : null;
      if (tw && tw.n >= 2) {
        // direk kuralı: hattın kademesi en alçak direğin kademesidir
        r.tw = tw; L = tw.h <= 2 ? 2 : tw.h <= 5 ? 5 : tw.h <= 10 ? 10 : 99;
        const k = L === 2 ? tw.c2 : L === 5 ? tw.c5 : L === 10 ? tw.c10 : 0;
        r.txt = (L < 99 ? `≤ ${L} m: ${tw.n} direğin ${ek(k)}` : `> 10 m: ${tw.n} direğin hiçbiri ≤ 10 m değil`) + `, hat ${r.lenTxt}`;
        r.d = L < 99 ? L - k / tw.n : 99;
      } else {
        r.tw = null;
        for (const l of lv) if (r.share[l] >= 0.10) { L = l; break; }
        r.txt = (L < 99 ? `≤ ${L} m: uzunluğun %${pct(r.share[L])}'i` : `> 10 m (≤ 10 m payı %${pct(r.share[10])})`) + `, hat ${r.lenTxt}, direk verisi yok`;
        r.d = L < 99 ? L - r.share[L] : 99;
      }
    } else {
      if (!r.ringM.every(inCov)) { r.cov = false; return; }
      for (const l of lv) if (exposure(r.ringM, S.zoneM[l].map(z => z.pl), false).d === 0) { L = l; break; }
      r.txt = L < 99 ? `≤ ${L} m` : '> 10 m'; r.d = L;
    }
    r.L = L; r.cls = L === 2 ? 'kritik' : L === 5 ? 'yuksek' : L === 10 ? 'orta' : 'dusuk';
    // deniz kaynaklı: kademeyi veren alçaklık denize göre (kıyı düzeltmesi), nehir seli değil
    r.sea = false;
    if (L < 99 && S.seaM[L].length) {
      if (r.a.isLine) { const sm = lineSamples(r.ringM).filter(inCov); r.sea = sm.filter(p => inZone(p, S.seaM[L])).length / sm.length >= 0.10; }
      else r.sea = exposure(r.ringM, S.seaM[L].map(z => z.pl), false).d === 0;
    }
    const tg = S.ptag && r.a.fi != null ? S.ptag['f' + r.a.fi] : null;
    r.terr = tg ? tg.t : ''; r.terrF = tg ? tg.f : null;
    const kp = S.kent && r.a.fi != null ? S.kent['f' + r.a.fi] : null; r.kentF = kp; r.kent = kp != null && kp >= 0.30;
    if (r.sea) r.txt += ' · deniz kaynaklı';
    r.obs = false;
    if (S.obsLL) { r.obs = exposure(r.ringM, S.obsM, !!r.a.isLine).d === 0; if (r.obs) r.txt += ' · gözlenen izle kesişiyor'; }
  });
}
function recompute() {
  S.proj = makeProj(S.flood, S.assets);
  const P = S.proj;
  S.floodM = S.flood.map(pl => pl.map(r => r.map(P)));
  const all = S.assets.map(a => {
    const ringM = a.ring.map(P);
    const ex = S.floodM.length ? exposure(ringM, S.floodM, a.isLine) : { d: Infinity, a: ringM[0], f: null };
    const cm = a.isLine && isFinite(ex.d) ? ex.a : P(a.c);
    return { a, ringM, cm, d: ex.d, ea: ex.a, ef: ex.f, cls: S.floodM.length ? classify(ex.d, S.t1, S.t2) : 'yok' };
  });
  if (S.layer === 'ai' && S.zoneLL) {
    const tmp = all.map(r => Object.assign({}, r)); gradeZone(tmp);
    tmp.forEach((t, i) => { const r = all[i]; r.handL = t.cov === false ? null : t.L; r.handTxt = t.cov === false ? 'kapsam dışı' : t.txt; r.terr = t.terr; r.kent = t.kent; r.obs = t.obs; });
  }
  if (S.layer === 'zone' && S.zoneLL) { gradeZone(all); S.res = all.filter(r => r.cov !== false); S.far = all.length - S.res.length; return; }
  S.res = S.floodM.length ? all.filter(r => r.d <= AN_R) : all;
  S.far = all.length - S.res.length;
}
function reclass() {
  if (S.layer === 'zone') return;
  S.res.forEach(r => { r.cls = S.floodM.length ? classify(r.d, S.t1, S.t2) : 'yok'; });
}
function fit() {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const add = p => { a = Math.min(a, p[0]); c = Math.max(c, p[0]); b = Math.min(b, p[1]); d = Math.max(d, p[1]); };
  S.floodM.forEach(pl => pl.forEach(r => r.forEach(add)));
  S.res.forEach(r => { if (!S.floodM.length || r.d <= Math.max(S.t2, 3000)) add(r.cm); });
  if (!isFinite(a)) { a = -500; c = 500; b = -500; d = 500; }
  const w = Math.max(c - a, 200), h = Math.max(d - b, 200), pad = 48;
  const s = Math.min((S.W - pad * 2) / w, (S.H - pad * 2) / h);
  S.v.s = s; S.v.ox = S.W / 2 - ((a + c) / 2) * s; S.v.oy = S.H / 2 + ((b + d) / 2) * s;
}
const sx = X => S.v.ox + X * S.v.s, sy = Y => S.v.oy - Y * S.v.s;

/* ---------- Çizim ---------- */
function niceScale(maxM) {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  let best = steps[0];
  for (const s of steps) if (s <= maxM) best = s;
  return best;
}
function baseImg() {
  if (S.base === 'none' || !S.caseId || !BASE[S.caseId] || !S.proj) return null;
  const k = S.caseId + S.base; let im = S.imgs[k];
  if (!im) { im = new Image(); im.onload = () => draw(); im.src = BASE[S.caseId][S.base]; S.imgs[k] = im; }
  return im.complete && im.naturalWidth ? im : null;
}
function draw() {
  const W = S.W, H = S.H; if (!W) return;
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  ctx.fillStyle = css('--map'); ctx.fillRect(0, 0, W, H);
  const bimg = baseImg();
  if (bimg) {
    const bb = BASE[S.caseId].bb, a = S.proj([bb[0], bb[3]]), b = S.proj([bb[2], bb[1]]);
    ctx.drawImage(bimg, sx(a[0]), sy(a[1]), (b[0] - a[0]) * S.v.s, (a[1] - b[1]) * S.v.s);
  }
  // ızgara
  const gs = niceScale(160 / S.v.s) * 1, gm = gs;
  ctx.strokeStyle = css('--line'); ctx.globalAlpha = bimg ? 0 : .55; ctx.lineWidth = 1; ctx.beginPath();
  const x0 = Math.floor((-S.v.ox / S.v.s) / gm) * gm, x1 = ((W - S.v.ox) / S.v.s);
  for (let X = x0; X <= x1; X += gm) { const x = Math.round(sx(X)) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  const y1 = Math.ceil((S.v.oy / S.v.s) / gm) * gm, y0 = ((S.v.oy - H) / S.v.s);
  for (let Y = y0; Y <= y1; Y += gm) { const y = Math.round(sy(Y)) + .5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke(); ctx.globalAlpha = 1;
  // sel izi
  ctx.fillStyle = css('--water-fill'); ctx.strokeStyle = css('--water'); ctx.lineWidth = 1.2;
  const lays = S.layer === 'zone' && S.zoneM ? [[10, .25], [5, .4], [2, .65]].map(([l, al]) => [S.zoneM[l].map(z => z.pl), al]) : [[S.floodM, 1]];
  for (const [polys, al] of lays) {
    ctx.globalAlpha = al;
    for (const pl of polys) {
      ctx.beginPath();
      for (const r of pl) { r.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))); ctx.closePath(); }
      ctx.fill('evenodd'); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // seçili varlık: eşik halkaları ve en yakın nokta çizgisi
  const sel = S.res.find(r => r.a.id === S.sel);
  if (sel) {
    const cx = sx(sel.cm[0]), cy = sy(sel.cm[1]);
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
    [[S.t1, '--yuksek'], [S.t2, '--orta']].forEach(([m, col]) => {
      ctx.strokeStyle = css(col); ctx.beginPath(); ctx.arc(cx, cy, m * S.v.s, 0, 7); ctx.stroke();
    });
    ctx.setLineDash([]);
    if (sel.ef && sel.d > 0) {
      ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(sx(sel.ea[0]), sy(sel.ea[1])); ctx.lineTo(sx(sel.ef[0]), sy(sel.ef[1])); ctx.stroke();
    }
  }
  chDraw();
  // varlıklar
  for (const r of S.res) {
    const col = css(r.cls === 'yok' ? '--nodata' : '--' + r.cls);
    if (r.a.isLine) {
      ctx.beginPath(); r.ringM.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])));
      ctx.strokeStyle = col; ctx.lineWidth = r.a.id === S.sel ? 5 : 3; ctx.lineJoin = 'round'; ctx.stroke();
      if (r.a.id === S.sel) { ctx.fillStyle = css('--ink'); ctx.font = '600 12px ' + css('--font-body'); ctx.fillText(r.a.name, sx(r.cm[0]) + 10, sy(r.cm[1]) - 10); }
      continue;
    }
    if (r.a.isPoly) {
      ctx.beginPath(); r.ringM.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))); ctx.closePath();
      ctx.fillStyle = col; ctx.globalAlpha = .35; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const x = sx(r.cm[0]), y = sy(r.cm[1]), z = r.a.id === S.sel ? 8 : 6;
    ctx.fillStyle = col; ctx.strokeStyle = css('--surface'); ctx.lineWidth = 2; ctx.beginPath();
    if (r.a.kind === 'HES') { ctx.moveTo(x, y - z - 1); ctx.lineTo(x + z + 1, y + z); ctx.lineTo(x - z - 1, y + z); ctx.closePath(); }
    else if (r.a.kind === 'Trafo merkezi') ctx.rect(x - z, y - z, z * 2, z * 2);
    else ctx.arc(x, y, z, 0, 7);
    ctx.stroke(); ctx.fill();
    if (r.a.id === S.sel) {
      ctx.fillStyle = css('--ink'); ctx.font = '600 12px ' + css('--font-body');
      if (bimg) { ctx.lineWidth = 3; ctx.strokeStyle = css('--map'); ctx.lineJoin = 'round'; ctx.strokeText(r.a.name, x + 12, y - 10); }
      ctx.fillText(r.a.name, x + 12, y - 10);
    }
  }
  // ölçek çubuğu
  const sm = niceScale(120 / S.v.s), sw = sm * S.v.s, bx = 12, by = 16;
  if (bimg) { ctx.fillStyle = css('--map'); ctx.globalAlpha = .82; ctx.fillRect(bx - 6, by - 10, Math.max(sw, 70) + 12, 56); ctx.globalAlpha = 1; }
  ctx.fillStyle = css('--ink'); ctx.fillRect(bx, by, sw, 2); ctx.fillRect(bx, by - 3, 1.5, 8); ctx.fillRect(bx + sw - 1.5, by - 3, 1.5, 8);
  ctx.font = '12px ' + css('--font-mono'); ctx.fillText(sm >= 1000 ? (sm / 1000) + ' km' : sm + ' m', bx, by + 18);
  ctx.fillText('K ↑', bx, by + 36);
}

/* ---------- Arayüz ---------- */
const fmtD = d => !isFinite(d) ? '–' : d === 0 ? 'içinde' : d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(2) + ' km';
const ZL = { kritik: 'Nehre göre ≤ 2 m', yuksek: 'Nehre göre ≤ 5 m', orta: 'Nehre göre ≤ 10 m', dusuk: 'Nehre göre > 10 m' };
const ZS = { kritik: '≤ 2 m', yuksek: '≤ 5 m', orta: '≤ 10 m', dusuk: '> 10 m' };
const clsLabel = c => S.layer === 'zone' && ZL[c] ? ZL[c] : (CLASSES.find(x => x.id === c) || { label: 'Tehlike alanı yok' }).label;
const rank = r => (isFinite(r.d) ? r.d : 1e12) - (r.obs ? 0.5 : 0);
const shown = r => S.layer === 'zone' && r.txt ? r.txt : fmtD(r.d);
const handShort = r => r.handL == null ? '' : r.handL < 99 ? `HAND ≤ ${r.handL} m` : 'HAND > 10 m';
const WD = () => S.layer === 'ai' ? { n: 'AI tarama bölgesi', gen: 'AI bölgesinin', dat: 'AI bölgesine', low: 'AI tarama bölgesi' } : S.layer === 'zone' ? { n: 'Yatkın bölge', gen: 'yatkın bölgenin', dat: 'yatkın bölgeye', low: 'sel-yatkın bölge' } : { n: 'Sel izi', gen: 'sel izinin', dat: 'sel izine', low: 'sel izi' };
const clsVar = c => 'var(' + (c === 'yok' ? '--nodata' : '--' + c) + ')';

function renderChips() {
  const fl = S.flood.length ? `<span class="chip">${WD().n}: <b>${S.demoFlood ? 'örnek' : esc(S.floodSrc)}</b> · ${S.flood.length} poligon</span>` : `<span class="chip">${WD().n}: <b>yok</b></span>`;
  const as = `<span class="chip">Varlık: <b>${S.demoAssets ? 'örnek' : esc(S.assetSrc)}</b> · ${S.res.length}</span>`;
  $('#chips').innerHTML = fl + as;
  const n = $('#demoNote');
  if (S.demoFlood || S.demoAssets) {
    n.hidden = false;
    n.textContent = 'Şu an ' + (S.demoFlood && S.demoAssets ? 'sel izi ve varlıklar' : S.demoFlood ? 'sel izi' : 'varlıklar') + ' örnek (sentetik) veri. Konumlar uydurmadır, sonuç olarak kullanılamaz. Gerçek flood_scar_s2.geojson ve OSM çıktısını yükle.';
  } else if (S.layer === 'ai') {
    n.hidden = false;
    n.textContent = "Gösterilen alan yapay zeka modelinin çizdiği tarama bölgesidir (hasar görmeye müsait alan). Gözlenmiş bir sel değildir; öncelik için her varlığın HAND kademesine bakın.";
  } else if (S.layer === 'zone') {
    n.hidden = false;
    n.textContent = 'Gösterilen alan modellenmiş sel-yatkın bölgedir (nehre göre yükseklik ≤ 5 m). Gözlenmiş bir sel değildir.';
  } else n.hidden = true;
  const ln = $('#layerNote');
  ln.textContent = S.layer === 'ai'
    ? "AI tarama bölgesi: 155 sel bölgesi ve 46 fırtına grubunda, modelin görmediği olaylarda test edildi. Aynı seli HAND ≤ 5 m bölgesinden %19 daha az alanla yakalıyor; belgelenmiş 9 hasarlı tesisin 8'i bölgenin içinde (HAND'da da 8). Tesisleri kendi aralarında sıralamada HAND'dan iyi değil, bu yüzden öncelik HAND kademesiyle verilir. “Bölge dışı” güvenli demek değildir."
    : S.layer === 'zone'
    ? "Modellenmiş yatkınlık, gözlenmiş sel değil. 8 olayda test edildi: belgelenmiş 7 hasarlı enerji tesisinin 7'si ≤ 10 m, 6'sı ≤ 2 m kademesinde. Dar vadide ≤ 5 m bölge gözlenen selin %80-85'ini karanın %3-18'ini işaretleyerek yakalıyor; ovada karanın %32-68'ini işaretliyor, orada kademe tek başına sıralamaz. Kent içinde bir kademe yukarı bakın (Lancaster merkezi ≤ 5 m'de %51, ≤ 10 m'de %91). Hatlarda kademe en alçak direğe göre (OSM direk verisi); direk yoksa uzunluğun %10'u kuralı. “> 10 m” güvenli demek değildir."
    : 'Sel izi alt sınırdır (kent içinde parçalı). “Düşük” güvenli demek değildir.';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderLegend() {
  $('#legend').innerHTML =
    `<span><i class="sw" style="background:var(--water-fill);border:1px solid var(--water)"></i>${WD().low}</span>` +
    CLASSES.map(c => `<span><i class="sw" style="background:var(--${c.id})"></i>${S.layer === 'zone' ? ZS[c.id] : c.label}</span>`).join('') +
    '<span>■ trafo ▲ HES ━ hat ● baraj/diğer</span>' + (chData() && S.chOn ? '<span>◆ köprü ○ menfez</span>' : '');
}
function renderSummary() {
  const cnt = { kritik: 0, yuksek: 0, orta: 0, dusuk: 0 };
  S.res.forEach(r => { if (cnt[r.cls] != null) cnt[r.cls]++; });
  const n = S.res.length || 1;
  $('#stack').innerHTML = CLASSES.map(c => `<i style="width:${cnt[c.id] / n * 100}%;background:var(--${c.id})"></i>`).join('');
  $('#counts').innerHTML = CLASSES.map(c => `<div><strong>${cnt[c.id]}</strong>${S.layer === 'zone' ? ZS[c.id] : c.id === 'kritik' ? 'içinde' : c.label.toLowerCase()}</div>`).join('');
  if (!S.floodM.length) { $('#summary').textContent = 'Sınıflandırma için sel izi yükle ya da bir vaka seç.'; return; }
  if (S.layer === 'zone') {
    const low = S.res.slice().sort((a, b) => a.d - b.d)[0];
    $('#summary').textContent = `${S.res.length} varlıktan ${cnt.kritik} tanesi nehre göre ≤ 2 m, ${cnt.yuksek} tanesi ≤ 5 m, ${cnt.orta} tanesi ≤ 10 m kademesinde.` + (low && low.L < 99 ? ` En alçakta: ${low.a.name} (${low.txt}).` : '');
    if (S.obsLL) { const ob = S.res.filter(r => r.obs); $('#summary').textContent += ` Gözlenen Bozkurt sel iziyle kesişen ${ob.length} varlıktan ${ob.filter(r => r.L <= 10).length} tanesi ≤ 10 m kademesinde.`; }
    const tc = { 'dar vadi': 0, 'geniş vadi': 0, 'ova': 0 }; S.res.forEach(r => { if (tc[r.terr] != null) tc[r.terr]++; });
    if (tc['dar vadi'] + tc['geniş vadi'] + tc['ova']) $('#summary').textContent += ` Arazi tipi: ${tc['dar vadi']} dar vadi, ${tc['geniş vadi']} geniş vadi, ${tc['ova']} ova.` + (tc['geniş vadi'] + tc['ova'] ? ' Geniş vadi ve ovadaki varlıklarda kademe tek başına sıralamaz.' : '');
    const nk = S.res.filter(r => r.kent).length; if (nk) $('#summary').textContent += ` ${nk} varlık kent içinde, bunlarda bir kademe yukarı bakın.`;
    const lt = S.res.filter(r => r.a.isLine), lw = lt.filter(r => r.tw).length; if (lt.length) $('#summary').textContent += ` ${lt.length} hattın ${ek(lw)} direk kuralıyla, ${ek(lt.length - lw)} %10 kuralıyla sınıflandı.`;
    const ns = S.res.filter(r => r.sea).length; if (ns) $('#summary').textContent += ` ${ns} varlığın kademesi deniz kaynaklı.`;
    if (S.far) $('#summary').textContent += ` ${S.far} varlık DEM kapsamı dışında olduğu için analiz dışında.`;
    return;
  }
  const near = S.res.filter(r => r.d > 0 && r.d <= S.t2).sort((a, b) => a.d - b.d)[0];
  let t = `${S.res.length} varlıktan ${cnt.kritik} tanesi ${WD().gen} içinde, ${cnt.yuksek} tanesi ${S.t1} m içinde.`;
  if (near) t += ` Alanın dışında en yakını ${near.a.name} (${fmtD(near.d)}).`;
  if (S.far) t += ` ${S.far} varlık ${WD().dat} ${AN_R / 1000} km'den uzak olduğu için analiz dışında.`;
  if (S.layer === 'ai') {
    const ins = S.res.filter(r => r.d === 0), h5 = S.res.filter(r => r.handL != null && r.handL <= 5);
    t += ` AI bölgesindeki ${ins.length} varlığın ${ins.filter(r => r.handL != null && r.handL <= 2).length} tanesi HAND ≤ 2 m, ${ins.filter(r => r.handL === 5).length} tanesi ≤ 5 m kademesinde. HAND ≤ 5 m olup AI bölgesinin dışında kalan: ${h5.filter(r => r.d > 0).length}.`;
    if (S.obsLL) { const ob = S.res.filter(r => r.obs); t += ` Gözlenen Bozkurt sel iziyle kesişen ${ob.length} varlıktan ${ob.filter(r => r.d === 0).length} tanesi AI bölgesinin içinde.`; }
  }
  $('#summary').textContent = t;
}
function renderList() {
  const rows = S.res.slice().sort((a, b) => rank(a) - rank(b));
  $('#list').innerHTML = rows.length ? rows.map(r =>
    `<button class="row${r.a.id === S.sel ? ' sel' : ''}" data-id="${r.a.id}"><i class="dot" style="background:${clsVar(r.cls)}"></i><span class="nm">${esc(r.a.name)}<small>${r.a.kind}${r.terr && r.terr !== 'dar vadi' ? ' · ' + r.terr : ''}${r.kent && S.layer === 'zone' ? ' · kent içi' : ''}${S.layer === 'ai' && r.handL != null ? ' · ' + handShort(r) : ''}${S.layer === 'ai' && r.obs ? ' · gözlenen izde' : ''}${chFlag(chOf(r)) ? ' · köprü membası' : ''}</small></span><span class="dv">${shown(r)}</span></button>`
  ).join('') : '<p class="empty">Varlık yok. Bir GeoJSON veya Overpass JSON yükle.</p>';
}
function renderDetail() {
  const r = S.res.find(x => x.a.id === S.sel);
  const el = $('#detail');
  if (!r) { el.innerHTML = '<h2>Seçili varlık</h2><p class="empty">Haritada veya listede bir varlık seç.</p>'; return; }
  el.innerHTML = `<h2>Seçili varlık</h2><dl>
    <dt>Ad</dt><dd>${esc(r.a.name)}</dd>
    <dt>Tür</dt><dd>${r.a.kind}${r.a.isPoly ? ' (poligon)' : r.a.isLine ? ' (hat)' : ''}</dd>
    <dt>Konum</dt><dd>${r.a.c[1].toFixed(5)}, ${r.a.c[0].toFixed(5)}${r.a.isLine ? ' (orta nokta)' : ''}</dd>
    <dt>${S.layer === 'zone' ? 'Nehre göre yükseklik' : WD().dat[0].toUpperCase() + WD().dat.slice(1) + ' uzaklık'}</dt><dd>${shown(r)}</dd>
    <dt>Sınıf</dt><dd><span class="pill" style="background:${clsVar(r.cls)}">${clsLabel(r.cls)}</span></dd>${S.layer === 'ai' ? `<dt>HAND kademesi</dt><dd>${esc(r.handTxt || '–')}<br><small>Öncelik bu kademeye göre verilir. AI bölgesi yalnızca bakılacak alanı daraltır.</small></dd>` : ''}${terrDetail(r)}${chDetail(r)}</dl>`;
}
const TERR_TX = {
  'dar vadi': 'Doğrulanan dar vadilerde (Bozkurt, Ahr, Esk, Arhavi, Lune, Chiva) ≤ 5 m bölge gözlenen selin %80-85\'ini, karanın %3-18\'ini işaretleyerek yakaladı. Kademe sıralama için kullanılabilir.',
  'geniş vadi': 'Ara durum. Ova ve yelpaze vakalarında ≤ 5 m bölge karanın %19-68\'ini işaretledi; kademe tek başına sıralamaz. Nehre yatay uzaklık ve set/bent bilgisiyle birlikte okunmalı.',
  'ova': 'Ovada (Hawke\'s Bay, Swist-Erft) ≤ 5 m bölge karanın %32-68\'ini işaretledi. Kademe tek başına sıralamaz; yalnızca ≤ 2 m ile birlikte ve set/bent verisiyle okunmalı.'
};
function terrDetail(r) {
  if (S.layer !== 'zone') return '';
  let h = '';
  if (r.terr) h += `<dt>Arazi tipi</dt><dd>${r.terr} (2 km çevredeki karanın %${Math.round(r.terrF * 100)}'i ≤ 5 m)<br><small>${TERR_TX[r.terr]}</small></dd>`;
  if (r.kentF != null) h += `<dt>Kent içi</dt><dd>${r.kent ? 'Evet' : 'Hayır'} (500 m çevrenin %${Math.round(r.kentF * 100)}'i yapı alanı)${r.kent ? `<br><small>Kent içinde DEM binaları zemin gibi gösterir; bir kademe yukarı bakın. Lancaster merkezinde gözlenen selin ≤ 5 m'de %51'i, ≤ 10 m'de %91'i yakalandı.</small>` : ''}</dd>`;
  if (r.tw) h += `<dt>Direkler</dt><dd>${r.tw.n} direk: ≤ 2 m'de ${r.tw.c2}, ≤ 5 m'de ${r.tw.c5}, ≤ 10 m'de ${r.tw.c10}. En alçak direk +${String(r.tw.h).replace('.', ',')} m<br><small>Hat kademesi en alçak direğe göre. Direk konumu OSM'den, yükseklik 30 m hücreden; nehir kenarındaki bir direk hücre çözünürlüğü yüzünden 0 m görünebilir.</small></dd>`;
  else if (r.a.isLine) h += `<dt>Direkler</dt><dd>OSM'de bu hatta direk yok. Kademe, uzunluğun en az %10'unun bulunduğu en alçak kademe.</dd>`;
  if (r.sea) h += `<dt>Kaynak</dt><dd>Deniz kaynaklı. Bu alçaklık denize göre, bir dereye göre değil. Nehir selinde yanlış alarm olabilir (Lancaster'da Heysham böyle çıktı); fırtına kabarması için ayrıca değerlendirilmeli.</dd>`;
  return h;
}
function renderAll() { renderLegend(); $('#lb1').textContent = 'Yüksek: ' + WD().dat + ' en fazla'; $('#lb2').textContent = 'Orta: ' + WD().dat + ' en fazla'; $('#thrCard').hidden = S.layer === 'zone';
  const rn = S.caseId && CASES[S.caseId] && CASES[S.caseId].rain; $('#rainCard').hidden = !rn; $('#rainTxt').textContent = rn || '';
  renderChips(); renderSummary(); renderList(); renderDetail(); draw(); try { ewRender(); } catch (err) { console.error(err); } try { chRender(); } catch (err) { console.error(err); } }


/* ---------- Yağıştan erken uyarı (prototip) ---------- */
const EW = {
  bozkurt: { src: 'ERA5 (Open-Meteo), 0,25°, 1981–2025', d1: [41.26, 9.18], d3: [66.31, 14.4], ev: { d1: 28.7, d3: 57.3, tag: 'Ağustos 2021 olayı, ERA5' },
    st: 'Aynı olay için istasyon (Mamatlar) 3 günde 452,5 mm ölçtü. ERA5 aynı günlerde 57 mm gösteriyor.' },
  trabzon: { src: 'ERA5 (Open-Meteo), 0,25°, 1981–2025', d1: [47.22, 10.95], d3: [84.94, 19.1], ev: { d1: 62.2, d3: 113.0, tag: 'Eylül 2024 olayı, ERA5' }, st: '' },
  kumluca: { src: 'NASA POWER, 0,5°, 1981–2025', d1: [61.10, 20.44], d3: [98.90, 37.69], ev: null,
    st: 'Bu vakada olay tarihi doğrulanmadı ve POWER Aralık 2025\'te yağış göstermedi, bu yüzden geriye dönük test yapılamadı.' }
};
const EWL = [
  { min: 0, nm: 'Normal', v: '--dusuk', tier: 0, tx: 'Bu yağış, yerel yıllık maksimumların ortancasının altında. İzleme gerekmez.' },
  { min: 2, nm: 'İzle', v: '--orta', tier: 2, tx: 'Nehre göre 2 m içindeki varlıklar izlenir.' },
  { min: 10, nm: 'Uyarı', v: '--yuksek', tier: 5, tx: 'Nehre göre 5 m içindeki varlıklar için operatör uyarılır.' },
  { min: 50, nm: 'Alarm', v: '--kritik', tier: 10, tx: 'Nehre göre 10 m içindeki varlıklar için acil önlem değerlendirilir.' }
];
function ewT(x, p) { if (!(x > 0)) return 1; const z = (x - p[0]) / p[1], pe = 1 - Math.exp(-Math.exp(-z)); return pe <= 0.0001 ? 10000 : Math.max(1, 1 / pe); }
function ewFmt(t) { return t >= 100 ? '>100 yıl' : (t < 1.05 ? '~1 yıl' : (t < 10 ? t.toFixed(1).replace('.', ',') : Math.round(t)) + ' yıl'); }
function ewRender() {
  const c = S.caseId, e = c && EW[c], card = $('#ewCard');
  card.hidden = !e; if (!e) return;
  if (card.dataset.c !== c) { // vaka değişti: girişleri sıfırla, hazır değerleri kur
    card.dataset.c = c; $('#ew1').value = ''; $('#ew3').value = '';
    $('#ewPre').innerHTML = (e.ev ? `<button class="ewp" data-a="${e.ev.d1}" data-b="${e.ev.d3}">${e.ev.tag}</button>` : '') + (c === 'bozkurt' ? '<button class="ewp" data-a="" data-b="452.5" title="Ölçülen istasyon değeri, ERA5 ile aynı ölçekte değil">Ölçülen istasyon değeri (72 s: 452,5 mm)</button>' : '') + '<button class="ewp" data-a="" data-b="">Temizle</button>';
    $('#ewBack').innerHTML = ewBack();
  }
  const a = parseFloat($('#ew1').value), b = parseFloat($('#ew3').value), out = $('#ewOut'), lst = $('#ewList');
  if (!(a >= 0) && !(b >= 0)) { out.innerHTML = '<p class="small">Bir yağış değeri gir veya hazır değerlerden birini seç.</p>'; lst.innerHTML = ''; return; }
  const t = Math.max(a >= 0 ? ewT(a, e.d1) : 1, b >= 0 ? ewT(b, e.d3) : 1);
  let lv = EWL[0]; EWL.forEach(l => { if (t >= l.min) lv = l; });
  let items = [];
  try { const d = d3dec(c); items = S.assets.map(x => ({ a: x, eh: d.eh[String(x.id)] })).filter(x => x.eh !== undefined && x.eh !== null && x.a.kind !== 'Baraj'); } catch (err) { items = []; }
  const hit = lv.tier ? items.filter(x => x.eh <= lv.tier).sort((x, y) => x.eh - y.eh) : [];
  out.innerHTML = `<div class="ewlv"><span class="pill" style="background:var(${lv.v})">${lv.nm}</span><span>Tekrar süresi <b class="mono">${ewFmt(t)}</b></span></div>
    <p class="summary">${lv.tx}${lv.tier ? ` ${items.length} varlıktan <b>${hit.length}</b> tanesi bu kademede.` : ''}</p>
    <p class="small">Tekrar süresi kaynağı: ${e.src}. Aynı kaynaktan gelen tahminle karşılaştırılmalıdır.${e.st ? ' ' + e.st : ''}</p>`;
  lst.innerHTML = hit.slice(0, 8).map(x => `<div class="row" style="cursor:default"><i class="dot" style="background:var(${lv.v})"></i><span class="nm">${esc(x.a.name)}<small>${x.a.kind}</small></span><span class="dv">${x.eh === 0 ? 'yatakta' : '+' + x.eh.toString().replace('.', ',') + ' m'}</span></div>`).join('') + (hit.length > 8 ? `<p class="small">ve ${hit.length - 8} varlık daha.</p>` : '');
}
function ewBack() {
  const rows = ['bozkurt', 'trabzon'].map(k => {
    const e = EW[k], t = Math.max(ewT(e.ev.d1, e.d1), ewT(e.ev.d3, e.d3)); let lv = EWL[0]; EWL.forEach(l => { if (t >= l.min) lv = l; });
    return `<tr><td>${k === 'bozkurt' ? 'Bozkurt' : 'Trabzon'}</td><td>${e.ev.d1} / ${e.ev.d3} mm</td><td>${ewFmt(t)}</td><td>${lv.nm}</td></tr>`;
  }).join('');
  return `<table><tr><th>Vaka</th><th>24 s / 72 s (model)</th><th>Tekrar süresi</th><th>Seviye</th></tr>${rows}</table>
  <p><b>Diğer olaylar</b> (aynı Gumbel ve seviye kuralları, NASA POWER 0,5° veya DWD istasyonu; panel dışında hesaplandı):</p>
  <table><tr><th>Olay</th><th>Kaba ızgara</th><th>Ölçülen (istasyon)</th></tr>
  <tr><td>Ahr 2021</td><td>Alarm (POWER 70 / 88 mm)</td><td>Alarm (Blankenheim 111 mm / 24 s)</td></tr>
  <tr><td>Hawke's Bay 2023</td><td>Uyarı / Alarm (POWER 90 / 165 mm)</td><td>Alarm (Glengarry 546 mm)</td></tr>
  <tr><td>Larji 2023</td><td>Uyarı (POWER 85 / 222 mm)</td><td>–</td></tr>
  <tr><td>Arhavi 2021</td><td>Normal (POWER 19 / 29 mm)</td><td>Alarm (Hopa 83 mm, Arhavi 74 mm)</td></tr>
  <tr><td>Lancaster 2015</td><td>Normal (POWER 20-23 / 41-47 mm)</td><td>istasyon bulunamadı</td></tr>
  <tr><td>Valencia 2024</td><td>Normal (POWER 22 / 55 mm)</td><td>Alarm (Turís 771 mm / 24 s)</td></tr></table>
  <p><b>Sonuç:</b> kaba ızgara 7 olayın 4'ünü kaçırdı (Bozkurt, Arhavi, Lancaster, Valencia); kaçırılanlar dar alana yoğunlaşan sağanaklar. Geniş cepheli olayları (Ahr, Hawke's Bay, Larji) yakaladı. İstasyon değeri girildiğinde kaçırılan dördünün üçünde Alarm çıkıyor. Karar: kaba ızgara tek başına kullanılmaz, istasyon ve radar (MGM) girdisi zorunlu. Ahr'da Alarm seviyesi belgelenmiş iki TM hasarını da (Sinzig ≤2 m, Rheinbach ≤10 m) listeye aldı; bu yüzden Alarm'da ≤10 m kademesi korunuyor.</p>
  <p><b>Yapılabilecek:</b> yüksek çözünürlüklü tahmin ve radar (MGM), istasyon verisi, havza bazlı eşik ve çok sayıda olayla kalibrasyon. Her yeni vaka, seviye eşiklerini ve kademe eşlemesini sınamak için bir veri noktası ekler.</p>
  <p><b>Varsayımlar:</b> seviye sınırları (2, 10, 50 yıl) ve kademe eşlemesi (İzle ≤2 m, Uyarı ≤5 m, Alarm ≤10 m) 8 olayla sınandı ama kalibre edilmedi. Yağış-seviye ilişkisi ölçülmedi. Erken uyarı süresi ve yanlış alarm oranı bilinmiyor. Canlı tahmin akışı henüz bağlı değil, değerler elle girilir.</p>`;
}
document.addEventListener('input', e => { if (e.target.id === 'ew1' || e.target.id === 'ew3') ewRender(); });
document.addEventListener('click', e => { const b = e.target.closest('.ewp'); if (!b) return; $('#ew1').value = b.dataset.a; $('#ew3').value = b.dataset.b; ewRender(); });

function setThresholds() {
  $('#o1').textContent = S.t1 + ' m'; $('#o2').textContent = S.t2 + ' m';
}
function select(id) { S.sel = id; renderList(); renderDetail(); draw();
  const row = $('#list .row.sel'); if (row) row.scrollIntoView({ block: 'nearest' }); }

/* ---------- Veri yükleme ---------- */
function loadDemo() {
  const d = demoData();
  S.zoneLL = null; S.seaLL = null; S.ptag = null; S.tow = null; S.kent = null; S.obsLL = null; S.flood = d.flood; S.assets = d.assets; S.demoFlood = S.demoAssets = true; S.sel = null; S.caseId = null; S.layer = 'scar';
  recompute(); fit(); renderAll(); syncButtons();
}
/* CASES.rize: data/cases.js */
/* AIZ: data/aiz.js */
/* AIZ.rize: data/aiz.js */
const CASE_INFO = {
  bozkurt: { scar: true, src: 'Bozkurt 2021' },
  kumluca: { scar: false, src: 'Alakır / Kumluca' },
  trabzon: { scar: false, src: 'Trabzon / Araklı' },
  rize: { scar: false, src: 'Rize–Artvin, güncel tarama' }
};
function syncButtons() {
  document.querySelectorAll('.cs').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.case === S.caseId)));
  document.querySelectorAll('.bm').forEach(b => { b.disabled = !S.caseId; b.setAttribute('aria-pressed', String(!!S.caseId && b.dataset.base === S.base)); });
  const at = $('#baseAttr'), yr = { bozkurt: '30 Temmuz 2021', kumluca: 'Temmuz ve Eylül 2025', trabzon: 'yaz 2022-2025' };
  at.hidden = !(S.caseId && S.base !== 'none');
  at.textContent = S.base === 'sat' ? `Zemin: Contains modified Copernicus Sentinel-2 data, ${yr[S.caseId] || ''}` : 'Zemin: Copernicus DEM GLO-30 gölgelendirme';
  document.querySelectorAll('.ly').forEach(b => {
    const ok = b.dataset.layer === 'zone' || (b.dataset.layer === 'ai' && S.caseId && typeof AIZ !== 'undefined' && AIZ[S.caseId]) || (S.caseId && CASE_INFO[S.caseId].scar);
    b.disabled = !ok && !!S.caseId; b.setAttribute('aria-pressed', String(!!S.caseId && b.dataset.layer === S.layer));
  });
}
function loadCase(id, layer) {
  const ci = CASE_INFO[id];
  layer = layer === 'scar' && ci.scar ? 'scar' : layer === 'ai' && typeof AIZ !== 'undefined' && AIZ[id] ? 'ai' : 'zone';
  S.caseId = id; S.layer = layer;
  const zn = CASES[id].zones;
  S.obsLL = id === 'bozkurt' && layer !== 'scar' ? parseFlood(BOZKURT.flood) : null;
  const pg = PTAG[id];
  S.seaLL = layer !== 'scar' && pg ? { 2: parseFlood(pg.sea.z2), 5: parseFlood(pg.sea.z5), 10: parseFlood(pg.sea.z10) } : null;
  S.zoneLL = layer !== 'scar' ? { 2: parseFlood(zn.z2).concat(S.seaLL ? S.seaLL[2] : []), 5: parseFlood(zn.z5).concat(S.seaLL ? S.seaLL[5] : []), 10: parseFlood(zn.z10).concat(S.seaLL ? S.seaLL[10] : []) } : null;
  S.ptag = pg ? pg.tags : null; S.tow = pg ? pg.tow : null; S.kent = pg ? pg.kent : null;
  S.flood = layer === 'scar' ? parseFlood(BOZKURT.flood) : layer === 'ai' ? parseFlood(AIZ[id].zone) : S.zoneLL[5];
  S.assets = parseAssets(id === 'bozkurt' ? BOZKURT.assets : CASES[id].assets).assets;
  S.floodSrc = layer === 'scar' ? 'Bozkurt 2021, Sentinel-2' : layer === 'ai' ? 'model v2, ' + ci.src : 'HAND ≤ 5 m, ' + ci.src;
  S.assetSrc = 'OSM, 18 Eki 2026';
  S.demoFlood = S.demoAssets = false; S.sel = null;
  recompute(); fit(); renderAll(); syncButtons();
}
const loadBozkurt = () => loadCase('bozkurt', 'scar');
async function ingest(file, forced) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { flash('Dosya okunamadı: geçerli bir JSON/GeoJSON değil.'); return; }
  const kind = forced || (looksLikeAssets(obj) ? 'assets' : 'flood');
  if (kind === 'flood') {
    const polys = parseFlood(obj);
    if (!polys.length) { flash('Dosyada poligon bulunamadı. Sel izi için Polygon/MultiPolygon gerekir.'); return; }
    S.flood = polys; S.zoneLL = null; S.seaLL = null; S.ptag = null; S.tow = null; S.kent = null; S.obsLL = null; S.floodSrc = file.name; S.demoFlood = false; S.layer = 'scar'; S.caseId = null;
  } else {
    const r = parseAssets(obj);
    if (!r.assets.length) { flash('Dosyada nokta veya poligon varlık bulunamadı.'); return; }
    S.assets = r.assets; S.assetSrc = file.name; S.demoAssets = false; S.ptag = null; S.tow = null; S.kent = null;
    if (r.skipped) flash(r.skipped + ' öğe (çizgi veya geometrisiz) atlandı.');
  }
  S.sel = null; recompute(); fit(); renderAll(); syncButtons();
}
let flashT;
function flash(msg) {
  const n = $('#demoNote'); n.hidden = false; n.textContent = msg;
  clearTimeout(flashT); flashT = setTimeout(renderChips, 5000);
}

/* ---------- Etkileşim ---------- */
function resize() {
  const b = $('#mapbox').getBoundingClientRect();
  S.dpr = window.devicePixelRatio || 1; S.W = b.width; S.H = b.height;
  cv.width = Math.round(S.W * S.dpr); cv.height = Math.round(S.H * S.dpr);
  draw();
}
function zoomAt(f, px, py) {
  const X = (px - S.v.ox) / S.v.s, Y = (S.v.oy - py) / S.v.s;
  S.v.s *= f; S.v.ox = px - X * S.v.s; S.v.oy = py + Y * S.v.s; draw();
}
let drag = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox: S.v.ox, oy: S.v.oy, moved: false }; });
cv.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; cv.classList.add('drag'); }
  if (drag.moved) { S.v.ox = drag.ox + dx; S.v.oy = drag.oy + dy; draw(); }
});
cv.addEventListener('pointerup', e => {
  const was = drag; drag = null; cv.classList.remove('drag');
  if (!was || was.moved) return;
  const b = cv.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
  let hit = null, bd = 18;
  for (const r of S.res) {
    let d;
    if (r.a.isLine) {
      d = Infinity;
      for (let i = 0; i < r.ringM.length - 1; i++) {
        const a = r.ringM[i], b = r.ringM[i + 1];
        d = Math.min(d, ptSeg([px, py], [sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]).d);
      }
    } else d = Math.hypot(sx(r.cm[0]) - px, sy(r.cm[1]) - py);
    if (d < bd) { bd = d; hit = r; }
  }
  select(hit ? hit.a.id : null);
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const b = cv.getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - b.left, e.clientY - b.top);
}, { passive: false });
$('#zin').onclick = () => zoomAt(1.4, S.W / 2, S.H / 2);
$('#zout').onclick = () => zoomAt(1 / 1.4, S.W / 2, S.H / 2);
$('#zfit').onclick = () => { fit(); draw(); };

$('#t1').addEventListener('input', e => { S.t1 = +e.target.value; if (S.t2 < S.t1) { S.t2 = S.t1; $('#t2').value = S.t2; } thr(); });
$('#t2').addEventListener('input', e => { S.t2 = +e.target.value; if (S.t1 > S.t2) { S.t1 = S.t2; $('#t1').value = S.t1; } thr(); });
function thr() { setThresholds(); reclass(); renderSummary(); renderList(); draw(); $('#aiNote').textContent = ''; $('#aiCheck').textContent = ''; $('#aiCheck').className = 'aicheck'; }

$('#list').addEventListener('click', e => { const b = e.target.closest('.row'); if (b) select(+b.dataset.id); });
$('#fFlood').addEventListener('change', e => { if (e.target.files[0]) ingest(e.target.files[0], 'flood'); e.target.value = ''; });
$('#fAssets').addEventListener('change', e => { if (e.target.files[0]) ingest(e.target.files[0], 'assets'); e.target.value = ''; });
$('#bDemo').onclick = loadDemo;
document.querySelectorAll('.cs').forEach(b => b.onclick = () => loadCase(b.dataset.case, S.layer));
document.querySelectorAll('.bm').forEach(b => b.onclick = () => { S.base = b.dataset.base; syncButtons(); draw(); if (S.view === '3d') t3tex(); });
document.querySelectorAll('.ly').forEach(b => b.onclick = () => { if (S.caseId) loadCase(S.caseId, b.dataset.layer); });
$('#bCopy').onclick = async () => {
  const head = (S.layer === 'zone' ? 'ad,tur,enlem,boylam,nehre_gore_yukseklik,sinif' : 'ad,tur,enlem,boylam,sel_izine_uzaklik_m,sinif') + ',kopruye_akis_boyunca_m,kopru_membasi';
  const rows = S.res.map(r => { const o = chOf(r); return [JSON.stringify(r.a.name), r.a.kind, r.a.c[1].toFixed(6), r.a.c[0].toFixed(6), S.layer === 'zone' ? JSON.stringify(r.txt) : isFinite(r.d) ? Math.round(r.d) : '', clsLabel(r.cls), o && o.down != null ? o.down : '', chFlag(o) ? 'evet' : ''].join(','); });
  const text = [head].concat(rows).join('\n');
  try { await navigator.clipboard.writeText(text); flash('CSV panoya kopyalandı (' + rows.length + ' satır).'); }
  catch (e) { flash('Kopyalanamadı. Tarayıcı panoya erişimi engelledi.'); }
};
const mb = $('#mapbox');
['dragenter', 'dragover'].forEach(t => mb.addEventListener(t, e => { e.preventDefault(); mb.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => mb.addEventListener(t, e => { e.preventDefault(); mb.classList.remove('over'); }));
mb.addEventListener('drop', e => { for (const f of e.dataTransfer.files) ingest(f); });

new ResizeObserver(resize).observe(mb);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => draw());
new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ---------- Köprü daralması (tıkanma) ---------- */
S.chL = 1000; S.chOn = true;
function chData() { return S.caseId && typeof CHOKE !== 'undefined' && CHOKE[S.caseId] ? CHOKE[S.caseId] : null; }
function chOf(r) { const d = chData(); return d ? d.assets[String(r.a.id)] || null : null; }
function chFlag(o) { return !!(o && o.down != null && o.down <= S.chL && o.eh != null && o.eh <= 10); }
const fmtEh = x => x === 0 ? '0 m' : x.toFixed(1).replace('.', ',') + ' m';
function chBrTxt(r) { const o = chOf(r); if (!chFlag(o)) return ''; const c = chData().chokes[o.ch]; return `${o.down} m mansabında ${c.kind}${c.name ? ' (' + c.name + ')' : ''}`; }
function chDetail(r) {
  const d = chData(); if (!d) return '';
  if (r.a.isLine || r.a.kind === 'Baraj') return '<dt>Köprü daralması</dt><dd>değerlendirilmedi</dd>';
  const o = chOf(r);
  if (!o) return '<dt>Köprü daralması</dt><dd>250 m içinde akarsu yok</dd>';
  if (o.down == null) return `<dt>Köprü daralması</dt><dd>akarsuya ${o.lat} m; mansapta 3 km içinde köprü yok</dd>`;
  const c = d.chokes[o.ch];
  return `<dt>Köprü daralması</dt><dd>${chFlag(o) ? '<b>köprü membası</b> · ' : ''}akış boyunca ${o.down} m sonra ${c.kind}${c.name ? ' (' + esc(c.name) + ')' : ''}, ${esc(c.road || c.ww)}${c.wwname ? ', ' + esc(c.wwname) : ''}; akarsuya ${o.lat} m</dd>`;
}
function chRender() {
  const d = chData(), card = $('#chCard'); card.hidden = !d; if (!d) return;
  $('#oChL').textContent = S.chL + ' m';
  $('#bCh').setAttribute('aria-pressed', String(S.chOn));
  const nb = d.chokes.filter(c => c.kind === 'köprü').length, nm = d.chokes.length - nb;
  const ev = S.res.filter(r => !r.a.isLine && r.a.kind !== 'Baraj');
  const rows = ev.map(r => ({ r, o: chOf(r) })).filter(x => chFlag(x.o)).sort((a, b) => a.o.down - b.o.down);
  $('#chSum').innerHTML = `İncelenen alanda OSM'de akarsuyu kesen <b>${nb}</b> köprü ve <b>${nm}</b> menfez var. ${ev.length} nokta/alan varlıktan <b>${rows.length}</b> tanesi nehre göre ≤ 10 m ve bir darboğazın ${S.chL} m membasında.`;
  $('#chList').innerHTML = rows.map(({ r, o }) => { const c = d.chokes[o.ch]; return `<button class="row${r.a.id === S.sel ? ' sel' : ''}" data-id="${r.a.id}"><i class="dot" style="background:var(--kritik)"></i><span class="nm">${esc(r.a.name)}<small>${c.kind}${c.name ? ': ' + esc(c.name) : ''}</small></span><span class="dv">${o.down} m · +${fmtEh(o.eh)}</span></button>`; }).join('') || '<p class="empty">Bu mesafede eşleşen varlık yok.</p>';
}
function chDraw() {
  const d = chData(); if (!d || !S.chOn || !S.proj) return;
  const P = S.proj;
  ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = css('--kritik');
  S.res.forEach(r => { const o = chOf(r); if (!chFlag(o) || !o.path) return; ctx.beginPath(); o.path.forEach((p, i) => { const m = P(p); i ? ctx.lineTo(sx(m[0]), sy(m[1])) : ctx.moveTo(sx(m[0]), sy(m[1])); }); ctx.stroke(); });
  ctx.setLineDash([]);
  const hit = new Set(S.res.map(r => chOf(r)).filter(chFlag).map(o => o.ch));
  d.chokes.forEach((c, i) => {
    const m = P([c.lon, c.lat]), x = sx(m[0]), y = sy(m[1]); if (x < -10 || y < -10 || x > S.W + 10 || y > S.H + 10) return;
    const z = hit.has(i) ? 6 : 4; ctx.lineWidth = 1.5; ctx.strokeStyle = css('--surface'); ctx.fillStyle = hit.has(i) ? css('--kritik') : css('--ink');
    ctx.beginPath();
    if (c.kind === 'köprü') { ctx.moveTo(x, y - z); ctx.lineTo(x + z, y); ctx.lineTo(x, y + z); ctx.lineTo(x - z, y); ctx.closePath(); ctx.stroke(); ctx.fill(); }
    else { ctx.arc(x, y, z - 1, 0, 7); ctx.fillStyle = css('--surface'); ctx.fill(); ctx.strokeStyle = hit.has(i) ? css('--kritik') : css('--ink'); ctx.stroke(); }
  });
  ctx.restore();
}
$('#chL').addEventListener('input', e => { S.chL = +e.target.value; chRender(); renderList(); renderDetail(); draw(); $('#aiNote').textContent = ''; $('#aiCheck').textContent = ''; $('#aiCheck').className = 'aicheck'; });
$('#bCh').addEventListener('click', () => { S.chOn = !S.chOn; chRender(); renderLegend(); draw(); });
$('#chList').addEventListener('click', e => { const b = e.target.closest('.row'); if (b) { select(+b.dataset.id); chRender(); } });

/* ---------- AI risk notu ---------- */
let sampleFn = null, aiBusy = false, aiCtl = null;
function currentPrompt() {
  const rows = S.res.slice().sort((a, b) => rank(a) - rank(b))
    .slice(0, 16).map(r => ({ name: r.a.name, kind: r.a.kind, dist: shown(r), cls: clsLabel(r.cls), loc: /^Adsız|^(HES|Baraj|Trafo merkezi|Diğer|İletim hattı|Dağıtım hattı)$/.test(r.a.name) ? r.a.c[1].toFixed(3) + ', ' + r.a.c[0].toFixed(3) : '', br: chBrTxt(r), terr: S.layer === 'zone' ? r.terr : '', kent: S.layer === 'zone' && r.kent, hand: S.layer === 'ai' ? r.handTxt : '' }));
  return buildPrompt(rows, { t1: S.t1, t2: S.t2, far: S.far, farKm: AN_R / 1000, demo: S.demoFlood || S.demoAssets, zone: S.layer === 'zone', ai: S.layer === 'ai', rain: S.caseId && CASES[S.caseId] ? CASES[S.caseId].rain : '', obs: !!S.obsLL, chL: chData() ? S.chL : 0 });
}
function aiReady() { return S.floodM.length && S.res.length; }
function setAIState() {
  syncButtons();
  const b = $('#bAI'), st = $('#aiState');
  b.disabled = !sampleFn || aiBusy || !aiReady();
  st.textContent = !aiReady() ? 'Önce sel izi ve varlık verisi yükle.' :
    !sampleFn ? 'AI notu bu görünümde kullanılamıyor. İstemi kopyalayıp başka bir modelde kullanabilirsin.' : '';
}
async function runAI() {
  if (!sampleFn || aiBusy || !aiReady()) return;
  aiBusy = true; $('#bAI').textContent = 'Yazıyor…'; setAIState();
  $('#aiNote').textContent = ''; $('#aiCheck').textContent = ''; $('#aiCheck').className = 'aicheck';
  const prompt = currentPrompt();
  aiCtl = new AbortController();
  try {
    const out = await sampleFn(prompt, { onText: ({ text }) => { $('#aiNote').textContent = text; }, signal: aiCtl.signal, cache: false, modelTier: 'quick' });
    const note = (out && out.text) || $('#aiNote').textContent;
    $('#aiNote').textContent = note;
    const bad = ungroundedNumbers(note, prompt), c = $('#aiCheck');
    if (bad.length) { c.className = 'aicheck warn'; c.textContent = 'Tabloda olmayan sayı var: ' + bad.join(', ') + '. Bu notu doğrulamadan kullanma.'; }
    else { c.className = 'aicheck ok'; c.textContent = 'Nottaki tüm sayılar tabloyla eşleşti.'; }
  } catch (e) {
    const code = e && e.code;
    $('#aiNote').textContent = '';
    $('#aiCheck').className = 'aicheck warn';
    $('#aiCheck').textContent = code === 'not_granted' ? 'AI notu için izin verilmedi.' :
      code === 'rate_limited' ? 'Çok sık istek gönderildi. Biraz bekleyip tekrar dene.' : 'Not üretilemedi. Tekrar dene.';
  } finally { aiBusy = false; $('#bAI').textContent = 'Risk notu yaz'; setAIState(); }
}
$('#bAI').addEventListener('click', runAI);
$('#bPrompt').addEventListener('click', async () => {
  if (!aiReady()) { flash('Önce sel izi ve varlık verisi yükle.'); return; }
  try { await navigator.clipboard.writeText(currentPrompt()); flash('İstem panoya kopyalandı.'); }
  catch (e) { const n = $('#aiNote'); n.textContent = currentPrompt(); flash('Pano engellendi. İstem aşağıda, elle kopyala.'); }
});
(async () => {
  try { sampleFn = window.claude && window.claude.use ? await window.claude.use('sample') : null; } catch (e) { sampleFn = null; }
  // claude.ai dışında: js/config.local.js içinde Gemini anahtarı varsa risk notu Gemini ile yazılır (isteğe bağlı)
  const cfg = window.LLM_CONFIG || {};
  if (!sampleFn && cfg.geminiKey) {
    sampleFn = async (prompt, opt) => {
      const model = cfg.geminiModel || 'gemini-2.5-flash';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.geminiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: opt && opt.signal,
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
      });
      if (!r.ok) throw Object.assign(new Error('gemini ' + r.status), { code: r.status === 429 ? 'rate_limited' : 'error' });
      const j = await r.json();
      const text = ((j.candidates || [])[0]?.content?.parts || []).map(x => x.text || '').join('');
      if (opt && opt.onText) opt.onText({ text });
      return { text };
    };
  }
  setAIState();
})();
// kaynak her değiştiğinde AI durumunu tazele
const _renderAll = renderAll;
renderAll = function () { _renderAll(); $('#aiNote').textContent = ''; $('#aiCheck').textContent = ''; $('#aiCheck').className = 'aicheck'; setAIState(); };

renderLegend(); setThresholds(); resize(); loadBozkurt();

# CLAUDE.md: ŞebekeSel

Platformun adı **ŞebekeSel** (bitişik, büyük Ş ve S). Arayüzde ve belgelerde bu adı kullan.

Bu dosya Claude Code'un bu depoda çalışırken bilmesi gerekenleri anlatır. Kullanıcıyla Türkçe konuş.

## Proje
UP School × Siemens CLIMATHON programı için geliştirilen bir panel. Karadeniz'deki sellerde enerji altyapısının (trafo merkezi, HES, iletim hattı) maruziyetini açık veriyle gösteriyor. Ekip temsilcisi: Hami Furkan Kuvvet (İTÜ Kontrol ve Otomasyon). Teslim: Görev 4, 25 Ekim 2026 23.59 (problem tanımı, PDR, 2 dk video, çalışan ürün linki).

Panelin ana fikri iki katmanlı:
- **AI tarama bölgesi** (yatkınlık modeli v2): "hasar görmeye müsait alanı" çizer, bakılacak alanı daraltır.
- **HAND kademesi** (nehre göre yükseklik ≤ 2 / ≤ 5 / ≤ 10 / > 10 m): varlıkların **öncelik sırasını** verir.
Model tesisleri kendi aralarında sıralamada HAND'dan iyi değil (ölçüldü). Bu yüzden öncelik her zaman HAND kademesinden gelir. Bu ilkeyi bozan bir arayüz değişikliği yapma.

## Klasörler
- `web/`: statik sayfalar, derleme yok.
  - `index.html` + `js/platform.js` + `css/platform.css`: **ana sayfa**, gerçek zamanlı platform (tam ekran Leaflet haritası, sol simge şeridi ve panel: Keşfet / Katmanlar / Değerlendir / Hakkında; harita üstünde araçlar, bilgi kartı, durum çubuğu).
  - `vakalar.html` + `js/app.js` + `js/app3d.js` + `js/shell.js`: doğrulama vakaları (2B harita, sınıflama, listeler, AI notu, Three.js 3B görünüm). Platformla aynı kabuk (`body.platform.vk`); kartlar sol paneldeki sekmelerde (Vaka / Analiz / Görünüm / Doğrulama / Kaynaklar), `shell.js` sekmeleri yönetir. `app.js` öğeleri kimlik ve sınıfla bulur (`.cs`, `.ly`, `.bm`, `.vw`, `.pr`); taşırken bunları koru. Dosya yükleme ve sürükle-bırak kaldırıldı: vakalar sabittir.
  - `css/style.css`: ortak renk değişkenleri ve bileşenler; iki sayfa da kullanır. `bolge.html` yalnızca `index.html`'e yönlendirir.
- `web/data/*.js`: üretilmiş vaka verisi (her biri tek satırlık büyük JSON, toplam ~8 MB). **Elle düzenleme, açmaya çalışma, okumak için tamamını yükleme.** Gerekirse `grep -o` ile küçük parçalara bak. Bu dosyalar `pipeline/` betikleriyle üretilir.
- `model/model_v2.txt`: LightGBM modeli. Değiştirme.
- `pipeline/ai/`, `pipeline/dsi/`: Python betikleri. Yolları geliştirme sırasındaki çalışma klasörüne göredir (`ems/`, `feat/`, `grids/`, `out/`); bu klasörler depoda yok.
- `docs/`: analiz notları ve ön kayıtlar. Paneldeki sayıların kaynağı burası.

## Çalıştırma ve test
```bash
python3 pipeline/ondemand/serve.py        # web/ + değerlendirme servisi → http://localhost:8000
python3 web/test_panel.py http://localhost:8000/vakalar.html     # Playwright, 4 vaka × tüm katmanlar
python3 web/test_platform.py http://localhost:8000/index.html    # platform düzeni, masaüstü + telefon
python3 web/test_ondemand.py http://localhost:8000/index.html    # uçtan uca değerlendirme (servis açıkken)
```
Yalnızca statik sayfa için `cd web && python3 -m http.server 8000` da yeter; o zaman değerlendirme düğmeleri kapalı kalır.
Test, her vaka ve katmanda özet metnini, listenin ilk satırlarını ve konsol hatalarını yazdırır. `config.local.js` bulunamadı (404) uyarısı beklenir, zararsızdır. Arayüz değişikliğinden sonra testi çalıştır ve sonuçların değişmediğini kontrol et.

## Bölge envanteri ve istek anında değerlendirme
- `web/index.html` + `js/platform.js`: 18 Karadeniz ilinin OSM enerji varlıkları (Leaflet). Veri `web/data/region.js` (`REGION`), `pipeline/osm/region_energy.py` ile üretilir. Durum nesnesi `S` (`sel` varlık, `pt` serbest nokta, `ev` sonuçlar, `hist` oturum geçmişi); panel `openTab(id)`.
- Harita üstü öğeler Leaflet denetimlerinin (z-index 1000) üstünde olmalı; `platform.css`'te 1010+ kullanılır.
- `pipeline/ondemand/serve.py`: `web/`'i sunar, `/api/eval` ve `/api/overlay` ile modeli istek anında çalıştırır (`evaluate.py`). Statik yayında (claude.ai) servis yoktur; sayfa bunu kartta söyler.
- Kademe kuralı burada: varlık izinin en düşük HAND değeri (gösterilen değerle çelişmesin diye). Vaka panelindeki kural genelleştirilmiş poligona değmedir; ikisi Rize'de 30 tesisin 22'sinde aynı, 29'unda en fazla bir kademe farklı.
- Nokta renkleri varlık türüdür (`--k-*`), risk değildir; risk renkleri yalnızca değerlendirme sonucunda (`--kritik` … `--dusuk`).

## app.js'te bilinmesi gerekenler
- Durum nesnesi `S`; katman `S.layer` = `'scar'` (gözlenen sel izi, yalnızca Bozkurt), `'zone'` (HAND kademeleri), `'ai'` (AI tarama bölgesi).
- Vaka yükleme `loadCase(id, layer)`. Vakalar: `bozkurt`, `kumluca` (Alakır), `trabzon`, `rize` (güncel tarama, sel olayı değil).
- AI katmanında her varlığın `handL`/`handTxt` alanı HAND kademesini taşır; `gradeZone` HAND kademesini hesaplar.
- Veri sabitleri (`BOZKURT`, `CASES`, `PTAG`, `CHOKE`, `BASE`, `AIZ`, `D3`) `web/data/` dosyalarından gelir ve `app.js`'ten önce yüklenir.
- AI risk notu: claude.ai'de `window.claude.use('sample')`; yerelde `web/js/config.local.js` (git dışı) içinde Gemini anahtarı varsa Gemini. Yoksa düğme kapanır, "İstemi kopyala" çalışır. Notun sayıları `ungroundedNumbers` ile tabloya karşı denetlenir; bu denetimi kaldırma.

## Arayüz kuralları
- Arayüz dili Türkçe. Kısa, düz cümleler; abartısız. "Güvenli", "garanti" gibi ifadeler kullanma; "> 10 m güvenli demek değildir" türü uyarılar kalmalı.
- Renkler `:root` değişkenleriyle tanımlı; açık ve koyu tema birlikte güncellenmeli (`prefers-color-scheme` ve `[data-theme]` blokları).
- Sınıf renkleri: `--kritik`, `--yuksek`, `--orta`, `--dusuk`. Yenisini ekleme, bunları kullan.
- Mobil: 900 px ve 640 px kırılımları var; telefonda yatay kaydırma olmamalı.
- Atıflar (OSM ODbL, Copernicus, ESA WorldCover, EMS, EA) "Kaynaklar ve sınırlar" bölümünde kalmalı.

## Doğrulanmış sayılar (değiştirme, kaynak docs/)
Panel ve sunum metinleri bu sayılara dayanır. Yeni bir analiz yapılmadan değiştirilmez, yuvarlanmaz, güçlendirilmez.
| İddia | Değer | Kaynak |
|---|---|---|
| 8 olaylık HAND doğrulaması | Belgelenmiş 7 hasarlı tesisin 7'si ≤ 10 m, 6'sı ≤ 2 m | Project: karar-tablosu-2026-10-22 |
| Dar vadide HAND ≤ 5 m | Gözlenen selin %80–85'i, karanın %3–18'i | aynı |
| AI, aynı seli yakalamak için alan | HAND ≤ 5 m'nin 0,81'i (155 bölge, 46 fırtına grubunun 38'i) | docs/analiz-ai-v2-2026-10-24.md |
| AI, kent içi etiketli İngiltere olayları | 0,55 | aynı |
| Hasarlı tesislerin bölge içinde kalması | 9 tesisten HAND 8, AI 8 | aynı |
| Kademe içi AI sırası | medyan %49 (yazı-tura düzeyi) | aynı |
| 2026 kör testi | 13 selin 12'sinde daha küçük alanla aynı sel; alan oranı medyanı 0,84 | docs/analiz-kor-test-2026.md |
| 2026 kör testi, TM/santral | Sele değen 23'ten HAND 16 (590 işaret), AI 17 (436 işaret); yalnız TM: HAND 8/10, AI 7/10 | aynı |
| Kaba yağış ızgarası | 7 olayın 4'ünü kaçırdı | Project: karar-tablosu-2026-10-22 |

Söylenmemesi gereken: "Yapay zeka hangi altyapının zarar göreceğini tahmin ediyor." Doğru ifade: "AI, hasar görmeye müsait alanı daha küçük bir alanla buluyor; öncelik HAND kademesinden gelir; tesis düzeyinde hasar modeli için işletmeci hasar kaydı gerekir (hipotez)."

## claude.ai'deki panelle senkron
Yayımlanan panel claude.ai'de tek bir HTML dosyası (artifact). Buradaki değişiklikleri oraya taşımak için değişen dosyaları claude.ai'deki CLIMATHON sohbetine gönder; orada tek dosyaya birleştirilip aynı bağlantıda yayımlanır. `web/data/` dosyalarını burada yeniden üretirsen bunu da belirt.

## Git
Commit mesajları Türkçe ve kısa. `web/js/config.local.js` asla commit edilmez (API anahtarı içerir). Büyük ara dosyalar (`*.npz`, `grids/`, `feat/`) `.gitignore`'da.

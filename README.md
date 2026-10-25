# ŞebekeSel (CLIMATHON)

Enerji altyapısının (trafo merkezi, HES, hat) sele maruziyetini açık veriyle gösteren panel ve onu besleyen yatkınlık modeli. UP School × Siemens CLIMATHON projesi.

## Hızlı başlangıç (panel)
Panel, derleme gerektirmeyen statik bir web sayfasıdır.

```bash
cd web
python3 -m http.server 8000      # sonra tarayıcıda http://localhost:8000
```
`web/index.html` dosyasını doğrudan tarayıcıda açmak da çalışır. VS Code'da "Live Server" eklentisiyle açmak en rahatıdır.

### Klasörler
| Yol | İçerik | Düzenlenir mi |
|---|---|---|
| `web/index.html` | Sayfa iskeleti ve kartlar | Evet (arayüz) |
| `web/css/style.css` | Tema, düzen, renkler (açık/koyu) | Evet (arayüz) |
| `web/js/app.js` | 2B harita, sınıflama, listeler, AI notu | Evet |
| `web/js/app3d.js` | 3B arazi ve nehir seviyesi senaryosu (Three.js) | Evet |
| `web/data/*.js` | Vaka verileri: varlıklar, HAND kademeleri, AI bölgesi, zemin görüntüleri, 3B arazi | Hayır, `pipeline/` ile yeniden üretilir |
| `model/model_v2.txt` | LightGBM yatkınlık modeli v2 | Hayır |
| `pipeline/` | Özellik çıkarma, eğitim, değerlendirme, panel verisi üretimi (Python) | Evet |
| `docs/` | Analiz notları, ön kayıtlar, kör test tahminleri | – |

`web/data/` dosyaları büyüktür (toplam ~8 MB) ve tek satırlık JSON içerir; VS Code'da açmanıza gerek yok.

### Gerçek zamanlı platform (ana sayfa)
`web/index.html`: Karadeniz Bölgesi'ndeki 18 ilin OSM enerji varlıkları (trafo merkezi, santral, baraj, hat) tam ekran bir Leaflet haritasında. Bir varlık ya da haritada herhangi bir nokta seçilip "Değerlendir"e basıldığında model o an çalışır; sonuç önceden hesaplanmaz. Önceden hazırlanmış olay vakaları ve doğrulama `web/vakalar.html` sayfasındadır (simge şeridinde "Vakalar").

```bash
pip install -r requirements.txt
python pipeline/ondemand/serve.py          # web/ klasörünü de sunar → http://localhost:8000
```
Servis her istekte noktanın çevresindeki 20 × 20 km alanı (+3 km tampon) Copernicus DEM ve ESA WorldCover'dan indirir, `features_full.py` ile aynı 17 özelliği çıkarır, `model_v2` ile skorlar. Pencere 0,05° ızgaraya yaslanır; aynı varlık her istekte aynı sonucu alır. Yeni pencere 5-15 s, aynı pencere oturum içinde anında. Kademe varlık izindeki en düşük HAND'dan gelir; AI bölgesi pencerede HAND ≤ 5 m alanının 0,81'idir.

Tutarlılık denetimi (önceden hesaplanmış Rize–Artvin vakasıyla, 30 tesis): kademe 22'sinde aynı, 29'unda en fazla bir kademe farklı; AI bölgesi 23'ünde aynı. `python pipeline/ondemand/check_case.py CASE_JSON AIZ_JSON OUT_CSV`. Fark 30 m ızgaranın konumundan gelir.

Envanteri yenilemek: `python pipeline/osm/region_energy.py web/data/region.js` (Overpass, iki sorgu). Testler: `web/test_platform.py` (düzen, masaüstü + telefon), `web/test_ondemand.py` (servis açıkken uçtan uca), `web/test_panel.py` (vakalar.html).

### AI risk notu
claude.ai'de yayımlanan sürümde not Claude ile yazılır. Yerelde iki seçenek var:
1. **İstemi kopyala** düğmesi: istemi Gemini, ChatGPT veya Claude'a yapıştırın.
2. **Gemini ile panel içinde:** `web/js/config.example.js` dosyasını `web/js/config.local.js` adıyla kopyalayıp Google AI Studio anahtarınızı yazın. `config.local.js` git'e girmez. Anahtar tarayıcıda görünür; yalnızca yerel demo için kullanın. (Bu bağlantı yazıldı ama anahtarla denenmedi.)

Notun her sayısı tabloyla karşılaştırılır; tabloda olmayan sayı varsa panel uyarır.

## Model
`model/model_v2.txt`: LightGBM ikili sınıflandırıcı (300 ağaç). Girdi, 30 m hücre başına 17 özellik; **sıra önemli** (model adlarla değil sırayla eğitildi):

`dist1, dist25, dist500, hand1, hand25, hand500, low2k, relief1k, sacc1, slope, twi, wc_bare, wc_crop, wc_grass, wc_shrub, wc_tree, wc_wetland`

- `handN` / `distN`: N km² akarsu eşiğinde nehre göre yükseklik (m) ve nehre yatay uzaklık (m). Kaynak: Copernicus DEM GLO-30.
- `sacc1`: en yakın akarsuyun log10 havza alanı; `slope` (°); `relief1k`: 1 km içindeki en düşük noktaya göre yükseklik; `twi`; `low2k`: 2 km içinde HAND ≤ 5 m kara payı.
- `wc_*`: ESA WorldCover 2021 sınıfları (0/1).

```python
import lightgbm as lgb
bst = lgb.Booster(model_file="model/model_v2.txt")
p = bst.predict(X)   # X: (n, 17), yukarıdaki sırayla
```
Özellikleri üretmek için `pipeline/ai/features_full.py` (bir alan sınırı verin, tam ızgara üretir). Skor kalibre değildir; panelde "AI tarama bölgesi" olarak karanın en yüksek skorlu ve HAND ≤ 5 m alanının %81'i büyüklüğündeki kısmı gösterilir.

### Doğrulama özeti
- Olay dışarıda bırakılarak, 155 bölge / 46 fırtına grubu: aynı seli HAND ≤ 5 m'den %19 daha az alanla yakalıyor (38/46 grup).
- 2026 kör testi (13 sel, tahminler sel haritalarından önce kaydedildi): 12/13 olayda daha küçük alanla aynı sel; sele değen 23 TM/santralden 17'sini 436 tesis işaretleyerek buldu (HAND ≤ 5 m: 16, 590 tesis).
- Sınır: tesisleri kendi aralarında sıralamada HAND kademesinden iyi değil; panelde öncelik HAND kademesiyle verilir. Ayrıntılar `docs/`.

## Pipeline (Python)
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```
Betikler geliştirme sırasında tek bir çalışma klasöründen (`ems/`, `feat/`, `grids/`, `out/` alt klasörleriyle) çalıştırıldı; yolları bu yapıya göredir. Veri kaynakları: Microsoft Planetary Computer (Copernicus DEM, ESA WorldCover, Sentinel-2), Copernicus EMS Rapid Mapping, Environment Agency Recorded Flood Outlines, OpenStreetMap API, DSİ akım gözlem yıllıkları.

| Betik | İş |
|---|---|
| `ai/select_download.py`, `ai/ea_build.py` | EMS ve EA sel çizimlerinden eğitim olaylarını seçme |
| `ai/features.py`, `ai/features_full.py` | DEM/WorldCover'dan özellik üretimi (örneklem / tam ızgara) |
| `ai/v2.py` | v2 eğitimi ve fırtına bazlı değerlendirme |
| `ai/tm_v2.py`, `ai/within_tier.py` | Hasarlı tesis testleri |
| `ai/blind_predict.py`, `ai/blind_eval.py` | 2026 kör testi |
| `ai/ai_zone.py`, `ai/rize_case.py`, `ai/osm_energy.py` | Panel için AI bölgesi ve vaka verisi |
| `dsi/` | DSİ akım yıllıklarını ayrıştırma ve yağış-debi karşılaştırması |

## Lisanslar ve atıflar
OpenStreetMap verisi © OpenStreetMap katkıda bulunanlar (ODbL). Copernicus DEM GLO-30 © DLR e.V. 2010-2014 ve © Airbus Defence and Space GmbH 2014-2018, Copernicus programı kapsamında. ESA WorldCover 2021 © ESA. Copernicus EMS Rapid Mapping çizimleri © Avrupa Birliği. Environment Agency verisi Open Government Licence. Sentinel-2: Contains modified Copernicus Sentinel data.

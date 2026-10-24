# Yapay zeka sel yatkınlık modeli: eğitim ve doğrulama (24 Ekim 2026)

## Soru
Panelin HAND kuralından (nehre göre yükseklik ≤ 2/5/10 m) daha iyi önceliklendirme yapan bir model eğitilebilir mi? Özellikle ova ve alüvyon yelpazesinde, yani HAND'ın sıralama yapamadığı yerlerde.

## Veri
- **Etiket:** Copernicus EMS Rapid Mapping sel çizimleri (observedEventA). 2023–2025 arasındaki 48 sel aktivasyonundan 115 AOI. AOI seçim kuralı modellemeden önce sabitlendi: ≤1500 km², sel ≥50 ha ve AOI'nin ≤%60'ı, aktivasyon başına en fazla 4 AOI. Derna baraj yıkılması çıkarıldı. Örnekler: Slovenya 2023, Norveç (Hans), Emilia-Romagna, Teselya, Boris (PL/CZ/SK/HU/AT), Valencia, Ekvador, Pakistan 2025, Vietnam (Yagi).
- **Özellikler (19):** Copernicus DEM GLO-30 (30 m) ve ESA WorldCover 2021'den. HAND, 1 / 25 / 500 km² akarsu eşiklerinde (panel kıyı düzeltmesiyle) ve her biri için nehre yatay uzaklık; dere büyüklüğü (log akış birikimi); eğim; 1 km yerel rölyef; TWI; panelin arazi tipi oranı (2 km içinde ≤5 m kara payı); panelin kent oranı (500 m içinde yapı payı); arazi örtüsü.
- **Model:** LightGBM, 300 ağaç. Her AOI eşit ağırlıkta; AOI başına en fazla 40 bin eğitim pikseli.
- **Dış test (eğitimde hiç kullanılmadı):** Bozkurt 2021 (paneldeki Sentinel-2 izi, 0,925 km²; ayrıca yeniden çıkarılan iz, orman dışı) ve Lancaster 2015 (Environment Agency resmi taşkın sınırları, 5,0 km²).

## Ölçütler (sonuçlara bakmadan önce sabitlendi)
1. Eşit alanda kapsam: model, HAND ≤5 m ile aynı kara payını işaretlediğinde selin ne kadarını yakalıyor.
2. Aynı kapsam için gereken alan: model, HAND ≤5 m'nin yakaladığı sel oranına ulaşmak için ne kadar alan işaretliyor (oran < 1 daha iyi).
3. Bölme: olay dışarıda bırakılarak (aynı aktivasyonun AOI'leri aynı katmanda, 8 katman). Kontrol için ayrıca fırtına bazlı (±5 gün içindeki aktivasyonlar birleşik, 30 grup).

## Sonuç 1: Alan düzeyinde model HAND kuralından iyi
| Arazi (AOI medyanı) | n | Aynı kapsam için alan, model / HAND | Model daha iyi |
|---|---|---|---|
| Tümü | 115 | 0,85 | 93/115 AOI, 39/48 olay (p < 0,0001) |
| Dar vadi (low2k < 0,2) | 29 | 0,81 | 24/29 |
| Ara (0,2–0,4) | 24 | 0,74 | 20/24 |
| Ova (> 0,4) | 62 | 0,88 | 49/62 |

- Fırtına bazlı bölmeyle de sonuç geçerli: 91/115 AOI, 30 grubun 23'ü (p = 0,005); ovada oran 0,94'e çıkıyor.
- AUC (medyan): 0,834 → 0,871.

**Ama kazancın çoğu eğitimsiz bir kuraldan da geliyor.** Yalnızca 25 km² eşikli HAND ile sıralamanın gereken alan oranı: tümü 0,91, dar vadi 0,83, ara 0,67, ova 0,97. Modelin bu basit kurala göre net katkısı esas olarak ovada (0,88'e karşı 0,97). Model hand25'ten 115 AOI'nin 77'sinde, 48 olayın 34'ünde daha iyi.

## Sonuç 2: Dış testte model HAND kuralından iyi, ama hand25 kadar
| Vaka | HAND ≤5 m | hand25 | Model | Model − HAND (%95 GA) |
|---|---|---|---|---|
| Bozkurt, panel izi | %78 | %90 | %89 | +8 ile +13 puan |
| Bozkurt, yeni iz (orman dışı) | %76 | %75 | %75 | −4 ile +3 puan (fark yok) |
| Lancaster (EA) | %88 | %97 | %96 | +5 ile +10 puan |

## Sonuç 3: Varlık düzeyinde model HAND'ın gerisinde (ürün için belirleyici)
OSM kimliği bilinen belgelenmiş hasarlı 4 TM, 30×30 km'lik pencerede. Değer: TM'nin bulunduğu sıra (karanın en riskli yüzde kaçında). Küçük değer daha iyi.

| TM | HAND (≤ TM'nin HAND'ı olan kara payı) | Model | Model, kent pikselleri eğitimden çıkarılmış |
|---|---|---|---|
| Sinzig 110 kV (Ahr) | %6,6 | **%3,4** | %3,0 |
| Rheinbach (Ahr) | **%39** | %58 | %58 |
| Quart de Poblet (Valencia)* | **%18** | %34 | %22 |
| Caton Road 132 kV (Lancaster) | **%5,0** | %21 | %9,3 |

*Valencia için EMSR773'ü dışarıda bırakan ayrı bir model kullanıldı.

Bozkurt panelindeki 14 nokta/alan varlık arasında belgelenmiş hasarlı Ebru HES: HAND sıralamasında 8., modelde 5. HAND'da 0 m'de 6 varlık berabere; model bu beraberliği bozuyor ama bunun doğru olup olmadığı doğrulanmadı.

**Nedenleri (SHAP katkılarından):**
- **Kent cezası:** Caton Road, Quart ve Sinzig'de en büyük olumsuz katkı yapı alanından geliyor. EMS çizimleri çoğunlukla radara dayanıyor ve radar yapılaşmış alandaki suyu göremiyor. Model "yapı varsa sel yok" diye öğrenmiş. TM'ler de tam bu tür alanlarda duruyor. Kent pikselleri eğitimden çıkarılınca Caton Road %21'den %9'a iniyor, ama HAND'ın gerisinde kalıyor.
- **Büyük nehir yanlılığı:** EMS sellerinin çoğu büyük nehir taşkını. Rheinbach'ı küçük bir dere bastı: tesisin hand25 değeri 29 m, model onu düşük görüyor. Karadeniz'in küçük dereleri için bu tam sorunlu olan durum.
- Aynı nedenle "panel 25 km² eşiğine geçsin" de önerilmez: Rheinbach hand25 ile ≤10 m kademesinin dışına düşer.

Not: Kent maskeli model bu dört TM'ye bakıldıktan sonra denendi. Bu yüzden onun sonucu bağımsız bir test değil, açıklayıcı bir kontroldür.

## Karar
- Önceden sabitlenen alan ölçütlerini model geçti (olaylar arasında anlamlı, Bozkurt'ta kötüleşme yok).
- Ürünün asıl işi varlık önceliklendirmesi ve orada model 4 hasarlı TM'nin 3'ünü HAND'dan daha düşük sıralıyor. **Panelde varlık kademesi HAND'da kalmalı.** Model, varlık sıralamasının yerine konmamalı.
- Model için savunulabilir kullanım: alan düzeyinde ikinci bir yatkınlık katmanı. Özellikle ovada aynı selin daha küçük bir alanda yakalanması (%6–12 daha az alan). "Kent ve küçük dereleri düşük gösterir" uyarısıyla birlikte.
- Sonraki adım, yanlılığın kaynağı olan etiketleri düzeltmek: kentte radar dışı etiketler (EA kayıtlı taşkın sınırları, optik izler, sigorta ve hasar noktaları); küçük dere ani sellerinin payını artırmak (Karadeniz olayları); varlık düzeyinde hasar kayıtlarıyla doğrulama (işletmeci verisi).

## Sınırlar
- EMS çizimleri sel tepesinden sonra çekiliyor ve alt sınır; negatif pikseller kısmen gözlenmemiş sel içerebilir. Bu HAND'ı ve modeli aynı ölçüde etkiler, ama mutlak kesinlik değerleri düşük görünür.
- Varlık testi yalnızca 4 TM ile yapıldı; istatistiksel sonuç çıkarmaya yetmez, yön göstergesidir.
- Bu çalışmadaki HAND değerleri önceki oturumlardan biraz farklı (örneğin Sinzig 2,5 m'ye karşı 0,07 m; Rheinbach 9,5'e karşı 5,8 m). Sebebi DEM koşullandırması ve poligonun hücrelere dökülmesi. Kademeler değişmiyor.
- Pakistan'daki bir AOI bellek sınırı yüzünden işlenemedi.

Betikler: select_download.py, features.py, train_eval.py, baselines.py, final_external.py, s2scar.py, score_assets.py, tm_test.py, train_variant.py. Sonuç dosyaları: loeo_results.csv, loeo_results_storm.csv, baselines.csv, external_results.json, importance.csv.

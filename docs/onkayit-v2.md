# Ön kayıt: yatkınlık modeli v2 (24 Ekim 2026, 03:00 — eğitimden önce yazıldı)

## Değişiklikler (v1'e göre)
1. Eğitim etiketlerine Environment Agency (İngiltere) kayıtlı taşkın sınırları eklenir: saha kayıtlıdır, kent içini kapsar. Lancaster/Lune 2015 olayı ve Lancaster penceresi eğitimden çıkarılır.
2. Yapı özellikleri (built500, wc_built) çıkarılır. EMS'de kent pikselleri gözlenmemiş sayılıp eğitimden atılır (radar kentteki suyu görmez); EA'da kent pikselleri eğitimde kalır.
3. Monotonluk kısıtı: model hand1, hand25, hand500, dist1, dist25, dist500 ve relief1k arttıkça riski asla artırmaz.

## Model seçimi
Yalnızca şunlarla yapılır: olay dışarıda bırakılarak piksel ölçütleri (EMS+EA) ve geliştirme setindeki 4 TM (Sinzig, Rheinbach, Quart de Poblet, Caton Road). Bu dört tesis artık bağımsız test sayılmaz.

## Bağımsız test seti (seçimde kullanılmaz, en sonda bir kez bakılır)
| Tesis | Olay | OSM | Olay eğitimde mi |
|---|---|---|---|
| Redclyffe 220 kV TM | Hawke's Bay 2023 | way/409049317 | Hayır |
| Whirinaki 220 kV TM | Hawke's Bay 2023 | way/95512216 | Hayır |
| Larji HES santral girişi | Beas 2023 | way/823477053 | Hayır |
| Ebru HES | Bozkurt 2021 | panel varlığı | Hayır |
İkincil (ayrı raporlanır, karara girmez): Nova Santa Rita 500 kV TM (Rio Grande do Sul 2024, way/94745966). "Devre dışı" kaydı var, su basıp basmadığı belirsiz; EMSR720 eğitimde olduğu için o olay dışarıda bırakılmış modelle skorlanır.

Ölçüt: tesisin pencere (30×30 km; Ebru için Bozkurt panel penceresi) içinde karanın en riskli yüzde kaçında kaldığı. HAND için: karanın tesisin HAND'ına eşit ya da daha alçak payı.

## Karar kuralı
- 4 bağımsız tesisin en az 3'ünde model sırası HAND sırasına eşit ya da daha iyiyse **ve** piksel düzeyindeki olay dışarıda bırakma sonucunda model HAND kuralından anlamlı biçimde iyiyse → model panelde **varlık skoru** olur.
- Aksi hâlde model yalnızca **kademe içi sıralayıcı** olarak girer (HAND kademesi değişmez).

## Ek (04:20, bağımsız testten önce)
Geliştirme seti sonucu: v2 modeli 4 tesisin 1'inde, birleşik skor (HAND sırası ile model sırasının küçüğü) 2'sinde HAND'a eşit ya da daha iyi. Piksel düzeyinde v2 (155 AOI, 46 fırtına grubu): 38/46 grupta HAND'dan iyi, aynı kapsam için alan oranı 0,81.
**Bağımsız teste girecek aday: birleşik skor.** Karar kuralı aynen geçerli (4 tesisin en az 3'ünde HAND'a eşit ya da daha iyi). v2 modelinin sonucu bilgi için ayrıca raporlanır, karara girmez.

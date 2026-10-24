# Ön kayıt: 2026 sellerinde kör test (24 Ekim 2026, 17:05)

Bu belge, 2026 sel olaylarının EMS sel çizimleri indirilmeden önce yazıldı. Model (v2, analiz-ai-v2-2026-10-24) bu olayların hiçbirini görmedi: eğitimdeki en yeni EMS olayı EMSR841 (Eylül 2025), en yeni EA olayı Ocak 2025.

## Olaylar ve AOI seçimi (etikete bakılmadan)
- 1 Ocak 2026 sonrası tüm EMS sel aktivasyonları (16), bunlardan sonlanmış (F) DEL/GRA ürünü olan AOI'ler.
- AOI ≤ 1500 km²; aktivasyon başına AOI numarasına göre ilk 4 AOI. Sel alanına bakılmadı (EMS istatistiği zaten "NA").
- Sonuç: 13 olayda 42 AOI (Bosna, İtalya ×3, Arnavutluk, Mozambik, İspanya/Portekiz Kristin fırtınası, Portekiz, Yunanistan Evros, Ekvador, Nepal, Girit, Alicante–Valencia 19 Ekim 2026). Liste: blind/selected_2026.json.
- Etiket: AOI'nin tüm sonlanmış DEL/GRA ürünlerindeki gözlenen sel (observedEventA) birleşimi. En az 300 sel pikseli (~27 ha) olan AOI'ler değerlendirilir.

## Tahmin (etiketten önce yapılır ve kaydedilir)
- Her AOI için Copernicus DEM ve WorldCover'dan özellikler, model v2 olasılığı, HAND (1 km² eşiği).
- **AI tarama bölgesi:** karanın en yüksek skorlu kısmı, alanı aynı AOI'deki HAND ≤ 5 m alanının %81'i (panelle aynı kural, gösterim sadeleştirmesi yok).
- **Varlıklar:** OSM'deki güncel enerji varlıkları (power=substation, plant, generator; power=line, minor_line; waterway=dam), OSM API'den 24 Ekim 2026 durumu. Her varlık için: AI bölgesinde mi, HAND kademesi (≤2 / ≤5 / ≤10 / >10 m).
- Tahmin tablosu Project'e zaman damgasıyla yazıldıktan sonra etiket indirilir.

## Ölçütler ve hipotezler
**H1 (alan):** Aynı kapsam için gereken alan oranı (model / HAND ≤ 5 m), olay düzeyinde medyan < 1 ve olayların çoğunda model daha iyi (işaret testi, tek yönlü, α = 0,05). Beklenen değer geçmiş testten ~0,81.
**H2 (varlık):** Nokta/alan varlıklarında (TM, santral, baraj), sele değen varlıklardan AI bölgesinin içinde kalanların sayısı, HAND ≤ 5 m bölgesinin içinde kalanlardan az değil; ve AI bölgesi daha az varlık işaretliyor (daha yüksek kesinlik). Hatlar ayrı raporlanır (uzun hatlar hemen her zaman sel alanını keser).
**Raporlama:** Hipotezler tutsa da tutmasa da bütün sonuçlar yayımlanır. EMS çizimleri tepe sonrası ve alt sınırdır; kentte radar kaynaklı eksik çizim olabilir.

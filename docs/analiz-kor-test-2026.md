# 2026 sellerinde kör test ve Rize–Artvin güncel tarama (24 Ekim 2026)

Ön kayıt: onkayit-kor-test-2026 (17:05). Tahmin kaydı: kor-tahmin-kaydi-2026 (17:38, SHA-256 ile). Sel çizimleri tahmin kaydından sonra indirildi.

## A. Kör test: 13 sel, 42 bölge
Model v2 bu olayların hiçbirini görmedi (eğitimdeki en yeni olay Eylül 2025). Olaylar: Bosna (Çapljina), İtalya (Aniene, Sardinya, Abruzzo–Molise–Basilicata), Arnavutluk (Velipojë), Mozambik, Kristin fırtınası (İspanya), Portekiz–İspanya, Yunanistan (Evros), Ekvador, Nepal, Girit (Ekim 2026), Alicante–Valencia (19 Ekim 2026). 37 bölgede en az 300 sel pikseli vardı.

**H1 (alan): tuttu.**
- 13 olayın 12'sinde model aynı seli HAND ≤ 5 m'den daha küçük alanla yakaladı (tek yönlü işaret testi p = 0,002).
- Aynı kapsam için gereken alan oranı: olay medyanı 0,84, bölge medyanı 0,77 (geçmiş testte 0,81).
- AI tarama bölgesi (HAND ≤ 5 m alanının %81'i) selin medyan %98'ini yakaladı; HAND ≤ 5 m de %98.
- Zayıf olay: Nepal (EMSR927). Hem HAND (%18–49) hem model selin çoğunu kaçırdı; hasar heyelan ve moloz akışı kaynaklı.

**H2 (varlık): tuttu, sayılar küçük.**
OSM enerji varlıkları (24 Ekim 2026 durumu): 10.041 varlık, 5.793'ü nokta/alan.

| | Sele değen | HAND ≤ 5 m yakaladı / işaretledi | AI bölgesi yakaladı / işaretledi |
|---|---|---|---|
| Tüm nokta/alan (barajlar ve küçük üreteçler dahil) | 46 | 25 / 2479 | 30 / 2213 |
| TM ve santraller | 23 | 16 / 590 | 17 / 436 |
| Yalnızca TM | 10 | 8 / 456 | 7 / 338 |
| Hatlar | 438 | 430 / 1867 | 427 / 1408 |

- AI bölgesi %11–26 daha az varlık işaretleyip sele değen varlıkların benzer ya da biraz fazla sayısını yakaladı. Trafo merkezlerinde HAND bir fazla buldu.
- İkisinin de kaçırdıkları: İspanya'da (Kristin) ≤ 10 m kademesindeki bir güneş santrali (9 panel), Nepal'de Trishuli ve Devighat (heyelan/moloz akışı), İtalya'da Portocannone TM (> 10 m).
- Kesinlik her iki yöntemde de düşük (%1–4 nokta/alan). EMS çizimleri tepe sonrası ve alt sınırdır; kent içindeki sel eksik çizilmiş olabilir.

## B. Rize–Artvin güncel tarama (doğrulamasız)
Bölge: 40,30–41,60 D, 40,85–41,45 K (Of–Hopa kıyı şeridi ve vadiler). OSM enerji varlıkları: 66 (13 TM, 15 santral, 30 hat). HAND ≤ 5 m karanın %2–4'ü; AI bölgesi bu alanın %81'i.

31 nokta/alan varlık (ham ızgara, sadeleştirme yok):
| HAND kademesi | Varlık | AI bölgesinde |
|---|---|---|
| ≤ 2 m | 9 (HES'ler, Cansu HES) | 9 |
| ≤ 5 m | 4 (Uzundere I HES, Murgul HES, Hopa Termik, İkizdere TM) | 3 (Murgul HES dışarıda) |
| ≤ 10 m | 12 (Hopa TM ×2, Rize TM, Kalkandere 154 ve 380 kV TM, HES'ler) | 12 |
| > 10 m | 6 (Çayeli TM, İyidere TM, Murgul TM, Ardeşen TM, Çakmakkaya TM, 1 HES) | 2 (Çayeli, İyidere; kıl payı) |

Okuma: Rize'de HAND ≤ 5 m çok dar (dik vadiler). AI bölgesi aynı büyüklükte olduğu halde HAND'ın 5–10 m kademesindeki kıyı ve vadi tabanı TM'lerini içine alıyor. Bunun doğru olup olmadığı bu vakada doğrulanamaz. Geçmiş testlerde Rheinbach (≤ 10 m, küçük dere) her iki bölgenin de dışında kalmıştı. Öncelik yine HAND kademesiyle verilir: önce ≤ 2 m'deki 9 HES, sonra ≤ 5 m'deki Hopa Termik Santrali ve İkizdere TM.

Panelde: "Rize–Artvin (güncel)" vakası (sürüm 23). Direk, arazi tipi, kent ve deniz kaynaklı etiketleri bu vakada yok; hatlar %10 kuralıyla sınıflanıyor.

Dosyalar: blind/eval_pixels_2026.csv, blind/eval_assets_2026.csv, out/rize_assets_screening.csv; betikler blind_predict.py, blind_eval.py, osm_energy.py, rize_case.py.

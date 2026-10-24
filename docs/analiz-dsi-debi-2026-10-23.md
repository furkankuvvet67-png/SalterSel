# DSİ akım verisi ve yağış-debi ilişkisi (23 Ekim 2026)

## Veri
- **Kaynak:** DSİ Akım Gözlem Yıllıkları (dsi.gov.tr/Sayfa/Detay/744), 2005–2021 metin PDF'leri. 2001–2004 taranmış, metin çıkmıyor. Yayımlanan son yıllık 2021 (2025'te basıldı). Sonrası için e-Devlet "Hidrometrik Veri Talebi" (ücretli).
- **Ayrıştırma kontrolü:** günlük değerlerden hesaplanan aylık ortalama, yıllıktaki "Ortalama" satırıyla 371 ayın 370'inde uyuşuyor. Tek fark: Araklı Mayıs 2009, DSİ "KURU" günlerini sıfır saymış, biz boş bıraktık.
- **Yağış:** Open-Meteo arşivi (ERA5 tabanlı reanaliz), her havzada 2 ızgara noktasının ortalaması. Panelin kullandığı kaba ızgara verisinin aynısı.

| İstasyon | Yer | Alan | Günlük seri (tam su yılı) | Not |
|---|---|---|---|---|
| E13A059 | Ezine D., Bozkurt (kent, stadyum köprüsü) | 355 km² | 2013–2020 (8) | 2008–2012 yalnızca tekil ölçüm. **Kayıt 18.06.2021'de kesiliyor, selden ~2 ay önce.** Rekor anlık 199 m³/s (18.10.2014) |
| D22A151 | Kapistre D., Arhavi (kot 12 m) | 290 km² | yok (2016–2020 tekil ölçüm, 2021 kısmi) | **Kayıt 22.07.2021'de, sel günü kesiliyor;** son günlük ortalama 27,3 m³/s (önceki günler 4–5) |
| D22A049 | Kapistre D., Başköy (Arhavi membası) | 186 km² | 2005–2009, 2015–2020 (10) | 1977'den beri; **o da 22.07.2021'de kesiliyor.** Rekor 440 m³/s (1996) |
| D22A044 | Karadere, Aytaş (Araklı, kot 500 m) | 421 km² | 2005–2010, 2014–2020 (12) | 2011–2013 tekil ölçüm. Rekor 181 m³/s (1999) |

## Bulgular

**1. Yıllık su miktarı yağışla izlenebiliyor (HES üretimi için ilgili olan bu).**
- Akış katsayısı (yıllık akış / yıllık yağış): Bozkurt 0,32, Araklı 0,46, Başköy 0,70. Yıldan yıla değişken (Bozkurt 0,21–0,49).
- Yıllık yağış ↔ yıllık akış: Araklı ρ = 0,64 (p = 0,03), Başköy 0,50, Bozkurt 0,38 (anlamlı değil; n küçük).
- Sabit katsayıyla yağıştan yıllık akış tahmini (birini dışarıda bırakarak): ortanca hata Araklı %12, Başköy %12, Bozkurt %31; en kötü yıl %46–84.
- Yani bir istasyonla kalibre edilirse yıllık potansiyel kabaca tahmin edilebilir; kalibrasyonsuz (katsayı 0,3 mü 0,7 mi bilinmeden) tahmin 2 kat yanılabilir.

**2. Taşkın büyüklüğü yağışla izlenemiyor.**
- Yıllık maks. günlük debi ↔ yıllık maks. 1 ve 3 günlük yağış: üç istasyonda da ilişki yok (ρ = −0,53 ile 0,19 arası, hiçbiri anlamlı değil).
- Başköy'de (dik, çok yağışlı havza) en büyük 10 debi olayının 8'i yağışın en üst %5'iyle aynı günlere denk geliyor: **zamanlama** yakalanıyor, büyüklük değil.
- Bozkurt'ta en büyük 10 debinin yalnızca 2'si büyük yağışla eşleşiyor. En büyük günlük debi (79,7 m³/s, 7 Ocak 2016) ızgarada 3 günde 18 mm yağışa karşılık geliyor. Kış olayları kar erimesi veya kar üstüne yağmur.

**3. Kar etkisi.** En yüksek ortalama debi ayı Bozkurt'ta Mart, Araklı ve Başköy'de Mayıs; en yağışlı ay ise Haziran–Ağustos. Yalnız yağıştan üretilen "sentetik debi" bu rejimi kaçırır; kar birikimi ve erimesi modellenmeli.

**4. Olay örnekleri.**
- Bozkurt 18 Ekim 2014 (gözlem süresinin rekoru, anlık 199 m³/s): ızgarada 44 mm/gün, 3 günde 65 mm. Bozkurt 2021 için aynı kaynakta 72 saatte 57 mm ~1,2 yıl çıkmıştı; bu olay da büyük olasılıkla Normal ya da İzle sınırında kalırdı (hesaplanmadı).
- Arhavi 22 Temmuz 2021: ızgarada 46 mm; Arhavi istasyonunda günlük ortalama 4 → 27 m³/s'ye çıktı ve kayıt kesildi. Membadaki Başköy'de 3,9 → 8,9 m³/s ve aynı gün kesildi. AFAD istasyonu aynı sabah 74 mm ölçmüştü.

## Sonuçlar (pivot sorusu ve panel için)
1. **HES üretim tahmini:** yıllık hacim yağışla kabaca (%12–31 ortanca hata) izlenebiliyor, ama yalnızca DSİ istasyonuyla kalibre edilen havzalarda. Kar rejimi aylık dağılımı belirliyor. Kalibrasyonsuz sentetik debi savunulamaz.
2. **Taşma olasılığı:** kaba yağıştan türetilen debi, taşkın büyüklüğünü vermiyor. Taşkın frekansı için doğrudan DSİ yıllık maksimum debi serisi (uzun seriler 1977'den) kullanılmalı; yağış yalnızca zamanlama sinyali.
3. **"Ölçüm ağı tam ihtiyaç anında kör kalıyor":** iki Karadeniz selinde de olay debisi yok. Bozkurt istasyonu sel öncesi kapanmış, Arhavi ve Başköy istasyonları sel günü susmuş. Uydu/HAND tabanlı ön tarama bu boşluğu dolduruyor; problem tanımı için güçlü kanıt.
4. **Panelin yağış kartı:** "kaba ızgara tek başına kullanılmasın" kararını (karar 8) bağımsız veriyle bir kez daha destekliyor.

## Sınırlar
- Kısa seriler (8–12 tam yıl); frekans analizi için yetersiz. 1977–2004 verisi taranmış PDF'lerde veya ücretli talepte.
- Yağış iki ızgara noktası ortalaması, havza ortalaması değil. Kar ve buharlaşma modellenmedi.
- Günlük ortalama debi anlık tepeyi düşük gösterir (Bozkurt 2014: günlük 52,7, anlık 199 m³/s).

Dosyalar: dsi_daily.csv (4 istasyon, 13.087 gün), dsi_summary.csv, yillik_yagis_debi.csv, buyuk_debi_olaylari.csv; betikler parse_agy.py, validate.py, compare.py.

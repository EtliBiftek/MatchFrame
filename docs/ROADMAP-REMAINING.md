# Kalan aşamalar — uygulama planı

Tarih: 2026-09-05 · Hedef sürüm: **0.7.0-alpha.1** · Mevcut durum: Aşama 1-3 tamam, Aşama 4 kısmen tamam, build/release hattı çalışıyor.

## Özet: kaç aşama kaldı?

Orijinal 10 maddelik sıranın durumu:

| # | Madde | Durum |
| --- | --- | --- |
| 1 | Navigasyon ve modüler view altyapısı | ✅ Tamam |
| 2 | Ortak analiz veri modeli ve test fixture'ları | ✅ Tamam |
| 3 | Analysis ekranı (MVP) | ✅ Tamam |
| 4 | Parser event genişletmesi | 🟡 ~%50 |
| 5 | Utility ekranı | ⬜ Başlanmadı |
| 6 | Aim ekranı | ⬜ Başlanmadı |
| 7 | Ruby coaching entegrasyonu | ⬜ Başlanmadı |
| 8 | Testler ve performans iyileştirmeleri | 🟡 Altyapı hazır, kriterler işlenmedi |
| 9 | `0.7.0-alpha.1` sürüm güncellemesi | 🟡 Numara güncellendi, final onay kaldı |
| 10 | Windows portable ve NSIS GitHub build'i | ✅ Otomatik çalışıyor |

**Kalan: 6 başlık** (4, 5, 6, 7, 8, 9) — planın 8 aşamasından **5 tanesi** (4-8) açık.
Tahmini: **5 oturum** (her oturum bir aşama + test + build).

---

## Aşama 4 — Parser genişletmesi (kalanı)

**Hedef:** Utility ve Aim metriklerinin ihtiyaç duyduğu kalan eventleri modele açmak, round sınırlarını kesinleştirmek.

### 4.1 Eklenecek eventler

| Event | Amaç | Not |
| --- | --- | --- |
| `item_purchase` | Ekonomi, round başı ekipman | `team`, `cost`, `weapon` alanları; büyük hacim → ayrı `purchases` anahtarı |
| `player_spawn` | Round başı roster doğrulama | Taraf tespiti için frames'e alternatif |
| `player_team` | Takım değişimi / sub tespiti | Devre arası + bot/sub karışımı |
| `player_disconnect` / reconnect | Eksik oyuncu senaryosu | Roster'dan düşürme kuralı |
| `begin_new_match` | Maç başlangıç tick'i | Round 1 öncesi ısınma ayrımı |

### 4.2 Mevcut eventlerde iyileştirme

- `round_freeze_end` → round başlangıcını `round_start` yerine **freeze bitişi** olarak kullan
  (`buildRoundMeta` + `roundIndexForTick` aynı kalsa da round süresi/ADR daha doğru olur).
- `player_blind` → `attacker_steamid` fallback'i: kör eden bulunamazsa son `flashbang_detonate` sahibine bağla.
- `flashbang_detonate` / `hegrenade_detonate` → konum alanlarını garanti et (`user_X/Y/Z`).
- `inferno_startburn` → kapsama alanı (Aşama 5 radar overlay için konum + süre).

### 4.3 Dosyalar

- `electron/demo-worker.cjs` — yeni `safeEventVariants` çağrıları + `eventStatus`
- `ui/analysis/common.js` — `normalizePurchaseEvent`, `normalizeSpawnEvent`
- `ui/analysis/match-analysis.js` — `availability.purchases`, `round.economy`, roster düzeltmeleri
- `test/fixtures/*.json` + `test/demo-worker.test.cjs`

### 4.4 Kabul kriteri

`buildMatchModel(demo).availability.purchases.available === true` ve disconnect içeren
fixture'da oyuncu roster'dan düşürülüyor.

---

## Aşama 5 — Utility MVP

**Hedef:** Oyuncunun grenade kullanımını round bazında inceleyebilmek.

### 5.1 Analiz katmanı — `ui/analysis/utility-analysis.js`

```js
buildUtilityModel(model) → {
  availability: { blinds, flashDetonates, smoke, inferno, damage },
  players: { [steamid]: {
    thrown:      { smoke, flash, he, molotov, decoy },
    flash:       { enemiesBlinded, teammatesBlinded, avgBlindDuration, assists, totalBlindSeconds },
    he:          { damage, playersHit, kills },
    molotov:     { damage, burnSeconds, areaDenialSeconds },
    smoke:       { avgActiveSeconds, totalActiveSeconds },
    economy:     { unusedOnDeath, keptAtRoundEnd }   // Aşama 4.1 purchases'a bağlı
  }},
  rounds: [{ number, events: [...], heat: [...] }]
}
```

Kurallar:
- **Flash:** `player_blind` → hedef oyuncunun takımı atan oyuncunun takımıyla aynıysa "takım arkadaşı", değilse "rakip". Süre `blind_duration` (sn).
- **HE:** `player_hurt` içinde `weapon == hegrenade` olan hasarlar.
- **Molotov:** `inferno_startburn` → `inferno_expire` arası süre; hasar `weapon == inferno/molotov`.
- **Smoke:** `smokegrenade_detonate` → `smokegrenade_expired` eşleştirmesi (en yakın sonraki expire, aynı oyuncu).
- **Boşa kullanım:** etkilenen oyuncu yoksa (`blinds`/`damage` eşleşmesi boşsa) "etkisiz" olarak işaretle — tahminî skor üretme.

### 5.2 Ekran — `ui/views/utility-view.js`

1. Filtre çubuğu: oyuncu + round + tür (smoke/flash/HE/molotov)
2. Özet kartları: atılan smoke/flash/HE/molotov, flash assist, kör edilen rakip, kör edilen takım arkadaşı, utility damage
3. Etkinlik tablosu: round, tick, tür, atan oyuncu, konum, etkilenen oyuncular, süre/damage, **Replay'e git**
4. Radar görünümü (`ui/components/heatmap.js`): smoke merkezi + yaklaşık yarıçap, molotov alanı, HE/flash patlama noktası; seçili round'daki utility sırası; timeline slider ile oynatma
5. Boş durumlar: demo yok / utility eventi yok / hazır

### 5.3 MVP dışı (sonraya)

Lineup kütüphanesi (atış konumu, pitch/yaw, jump/throw bilgisi).

### 5.4 Testler

- `test/utility-analysis.test.mjs`: flash assist sayımı, takım arkadaşı/rakip ayrımı, ortalama körlük süresi, HE/molotov damage, smoke aktif süresi, boşa atılan utility işareti
- Fixture: `flash-assist.json` genişletilir + `utility-heavy.json` eklenir
- DOM testi: utility ekranı kart/tablo/radar satırlarını çiziyor, replay butonu tick'e gidiyor

### 5.5 Kabul kriteri

Seçili oyuncunun round bazında hangi utility'yi nereye attığı, kimi etkilediği görülebiliyor ve her satırdan replay'e atlanabiliyor.

---

## Aşama 6 — Aim MVP

**Bağımlılık:** Aşama 5 bitmeden başlanmaz (plan gereği).

### 6.1 Analiz katmanı — `ui/analysis/aim-analysis.js`

Güvenilir şekilde hesaplanabilen metrikler:

| Metrik | Kaynak | Güven |
| --- | --- | --- |
| Kill / headshot sayısı ve oranı | `player_death` | kesin |
| Silah bazında kill | `player_death.weapon` | kesin |
| Atılan mermi / accuracy | `weapon_fire` + `bullet_impact` (Aşama 4 sonrası) | yüksek |
| Damage | `player_hurt` | kesin |
| Ortalama kill mesafesi | `player_hurt`/`player_death` konumları | orta (konum alanları gerekli) |
| Hareket halinde atış | `parseTicks` hızı + `weapon_fire` | orta |
| Körken yapılan kill | `player_death.attackerblind` | kesin |
| Crosshair açı hatası | shooter kamera yönü − hedef yönü (`dot` → derece) | orta |
| Potential reaction time | hedef görüş konisine giriş → ilk `weapon_fire` | **düşük** → "potential" olarak etiketle |

Eşikler ürün kuralı değil, **ayarlanabilir analiz konfigürasyonu** olarak tutulur
(`0-2° çok iyi, 2-5° kabul edilebilir, 5-10° zayıf, 10°+ ciddi`).

### 6.2 Ekran — `ui/views/aim-view.js`

- Global oyuncu / round / silah filtresi (mevcut `MF.filters`)
- Kartlar: HS%, accuracy, ADR, ortalama kill mesafesi, hareket halinde atış oranı
- Silah dağılımı tablosu
- **Duel listesi**: tick, round, rakip, silah, mesafe, HS, açı hatası, reaction → **Replay'e git**
- Heatmap: atış noktaları + kill/ölüm noktaları (timeline'a bağlı)

### 6.3 Doğruluk sınırları (UI'da açıkça gösterilecek)

- Visibility (raycast) doğrulaması yok → metrik "potential reaction time" olarak sunulur, kesin değer olarak etiketlenmez.
- `bullet_impact` olmayan demoda accuracy/isabet hesaplanmaz (sütun gizlenir).
- Konum alanları eksikse mesafe ve heatmap gizlenir.

### 6.4 Testler

- `test/aim-analysis.test.mjs`: açı hatası (dot → derece) matematiği, mesafe, weapon normalizasyonu, duel eşleştirme, hareket halinde atış tespiti
- Fixture: `aim-duel.json` (kamera yaw/pitch + hedef konumu bilinen senaryolar)

---

## Aşama 7 — Gelişmiş analiz + Ruby coaching

### 7.1 Gelişmiş metrikler (Analysis ikinci sürüm)

Zaten tamam: entry, trade, clutch, KAST, ADR, multi-kill.
Kalanlar:

- **Ekonomi**: round başı ekipman değeri, kayıp/kazanç, force-buy tespiti (`item_purchase`)
- **Side split**: T ve CT performansı ayrı tablolar
- **Round momentum grafiği** (`ui/components/chart.js`): round bazında skor farkı + kazanma serileri
- **Heatmap**: kill/ölüm noktaları maç genelinde
- **Opening duel** ayrımı: entry kill'lerin T/CT dağılımı

### 7.2 Ruby coaching entegrasyonu

Mevcut altyapı hazır: Rust `ruby_analyze` action'ı payload'ı `backend/analytics/analyze.rb`'ye stdin'den geçiriyor.

Akış:

```
JS: normalize metrikler → window.matchframe.core.request('ruby_analyze', { metrics })
Rust: run_ruby(payload) → analyze.rb
Ruby: kurallar → { engine, notes: [{ severity, tag, text }] }
JS: notları Aim / Utility / Analysis ekranlarında göster
```

Yapılacaklar:
1. `ui/analysis/coaching.js`: modelden metrik özeti çıkarma (`entry_deaths`, `entry_traded`, `avg_crosshair_error_deg`, `flash_assists`, `rounds`, `unused_utility_deaths` …) + IPC çağrısı
2. `backend/analytics/analyze.rb`: kural setini genişlet (Türkçe mesajlar, `category` alanı: aim/utility/entry/economy)
3. UI: `ui/components/coach-notes.js` — kategoriye göre ilgili ekranda gösterim
4. **Ruby yoksa ekran çalışmaya devam eder** (`run_ruby` hata döndürür → JS sessizce yoksayar + durum notu)

### 7.3 Testler

- Ruby kuralları için fixture girdi/çıktı testi (Node'dan `ruby` varsa çalışır, yoksa atlanır)
- JS tarafı: metrik özeti dönüşümü + hata durumunda UI'nin bozulmaması

---

## Aşama 8 — Rust'a taşıma (performans)

**Ön koşul:** formüller JS tarafında testlerle doğrulanmış olmalı (Aşama 5-7 sonrası).

1. `backend/src/analysis.rs`: `build_match_model` — serde ile normalize edilmiş event girdisi → aynı JSON modeli
2. Rust action: `"analysis_build"` → versioned analysis schema (`schemaVersion`)
3. Electron: worker yerine Rust'a devir seçeneği; renderer'a hazır model
4. Ruby'ye yalnızca normalize metrikler verilir (ham event değil)
5. Karşılaştırma testi: aynı fixture için JS ve Rust çıktısı `deepEqual`

---

## Oturum planlaması

> **Durum (2026-09-05):** Oturum A, B ve C tamamlandı. Aşama 4, 5 ve 6 kod + testleri
> `arena/01a06f0a-matchframe` dalında; `npm test` 105/105 yeşil.
> Windows build'i, dal GitHub'a itildiğinde workflow tarafından alınacak; sandbox çıkışı
> GitHub'a kapalı olduğu için push bekleniyor (her turda yeniden denenir).
> Dalın kendisiyle taşınabilmesi için `matchframe-arena-session.bundle` dosyası üretildi.

| Oturum | İş | Çıkış kriteri |
| --- | --- | --- |
| **A** | Aşama 4 tamamlama + `utility-analysis.js` (+ testler) | `availability.purchases` yeşil, utility metrikleri test edildi | ✅
| **B** | Aşama 5 UI: utility ekranı + radar overlay + replay bağlantıları | Round bazında utility incelenebiliyor, build alındı | ✅ (bu dalda, 78 test) |
| **C** | Aşama 6: `aim-analysis.js` + aim ekranı + duel listesi + heatmap | Aim metrikleri açıklanabilir ve olaya geri bağlanabiliyor | ✅ (bu dalda, 105 test) |
| **D** | Aşama 7.1: ekonomi, side split, momentum grafiği, maç heatmap | Analysis ikinci sürüm tamam |
| **E** | Aşama 7.2 + 8: Ruby coaching + Rust'a taşıma + regresyon/perf | Koçluk notları görünüyor, büyük demoda playback düşüşü yok |
| **F** | Sürüm finalizasyonu: `0.7.0-alpha.1` + tüm testler + build/release | Portable + NSIS EXE yayınlandı |

## Her oturumda uygulanacak regresyon kriterleri

- [ ] Replay playback performansı düşmüyor (POV renderer analiz ekranlarında çalışmıyor)
- [ ] Demo yalnızca bir kez parse ediliyor / analiz modeli bir kez kuruluyor
- [ ] Ekran geçişleri demo state'ini (tick, seçili oyuncu, filtre) silmiyor
- [ ] Büyük tablolar her animation frame'de render edilmiyor
- [ ] Eksik parser verisi boş ekran değil, açıklayıcı "veri yok" mesajı üretiyor
- [ ] `npm test` tamamı geçiyor; yeni metrik için fixture + birim testi eklendi
- [ ] Push sonrası Windows build yeşil

## Riskler

| Risk | Etki | Azaltma |
| --- | --- | --- |
| `bullet_impact` hacmi (on binlarca satır) | Worker → renderer aktarımı büyür | Gerekirse yalnızca seçili oyuncu/round için ayrıştır veya Rust tarafında özetle |
| `item_purchase` alan adları parser sürümüne göre değişir | Event tamamen kaybolur | `safeEventVariants` ile daralan varyantlar (mevcut desen) |
| Visibility doğrulaması yok | Reaction time yanıltıcı | "potential reaction time" etiketi + tooltip |
| Aynı anda 3 view render | İlk geçişte takılma | Render yalnızca aktif ekran + dirty flag (mevcut desen) |
| Ruby runtime yok | Koçluk notları boş | Hata sessizce yoksayılır, ekran çalışır |

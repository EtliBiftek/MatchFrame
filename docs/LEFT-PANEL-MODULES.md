# Sol panel modülleri — uygulama durumu

Planın tamamı: sol paneldeki **Replay / Analysis / Aim / Utility** ekranlarını modüler
bir yapıya taşımak. Bu belge hangi aşamanın tamamlandığını ve sonraki oturumda nereden
devam edileceğini kaydeder.

Hedef sürüm: **0.7.0-alpha.1**

> Kalan aşamaların ayrıntılı uygulama planı: **[docs/ROADMAP-REMAINING.md](./ROADMAP-REMAINING.md)**

## Dosya düzeni

```text
ui/
  app.js                     (mevcut replay kodu — yeni ekranlar buraya yığılmaz)
  navigation.js              view kaydı + rail navigasyonu
  views.css                  sol panel ekranlarının stilleri
  analysis/
    common.js                saf yardımcılar + event normalizasyonu
    match-analysis.js        buildMatchModel() — ortak analiz modeli
    utility-analysis.js      buildUtilityModel() — utility ekranının hesap katmanı
  state/
    bus.js                   olay bus'ı
    demo-store.js            demo + analiz modeli cache'i
    filter-store.js          ekranlar arası paylaşılan oyuncu/round/silah filtresi
  components/
    dom.js, stat-card.js, data-table.js, empty-state.js, filters.js, event-list.js
  views/
    replay-view.js           mevcut replay akışını sarmalar + olaydan replay'e atlama
    analysis-view.js         Analysis MVP
    aim-view.js              iskelet + veri durumu
    utility-view.js          ön izleme özeti + yol haritası

test/
  fixtures/                  anonim JSON demo fixture'ları
  helpers/demo-builder.cjs   fixture üretici
  helpers/harness.mjs        jsdom entegrasyon harness'ı
  analysis-common.test.mjs
  match-analysis.test.mjs
  utility-analysis.test.mjs
  demo-worker.test.cjs
  dom-navigation.test.mjs

tools/
  build-fixtures.cjs         fixture'ları üretir (npm run fixtures)
  serve-preview.cjs          Electron'suz tarayıcı önizlemesi (npm run preview)

dev/preview.html             fixture veriyle çalışan geliştirme önizlemesi
```

## Aşama durumu

| # | Aşama | Durum | Not |
| --- | --- | --- | --- |
| 1 | Navigasyon temeli | ✅ Tamam | Rail butonları `data-view` ile bağlı, view container sistemi, replay durumu korunuyor |
| 2 | Ortak analiz modeli | ✅ Tamam | `buildMatchModel`, event normalizasyonu, availability, fixture testleri |
| 3 | Analysis MVP | ✅ Tamam | Özet kartları, takım karşılaştırması, oyuncu tablosu, round listesi, replay'e git |
| 4 | Parser genişletmesi | ✅ Tamam | Yukarıdakilere ek olarak `item_purchase`, `player_spawn`, `player_team`, `player_disconnect`, `begin_new_match` ve `roundMeta[].freezeEndTick` eklendi |
| 5 | Utility MVP | 🟡 Kısmen | Hesap katmanı (`ui/analysis/utility-analysis.js`) + 13 test hazır. Eksik: Utility ekranı UI'si, radar overlay, replay bağlantısı (Oturum B) |
| 6 | Aim MVP | ⬜ Bekliyor | Utility bitmeden başlanmamalı |
| 7 | Gelişmiş analiz | ⬜ Bekliyor | Heatmap, reaction-time tahmini, ekonomi, Ruby coaching |
| 8 | Rust'a taşıma | ⬜ Bekliyor | Formüller doğrulandıktan sonra |

Durum: Aşama 1-4 `main`'de, Windows build + release hattı çalışıyor
(`v0.7.0-alpha.1-build.121`). Aşama 5'in hesap katmanı bu dalda tamamlandı (67 test yeşil);
UI katmanı `docs/ROADMAP-REMAINING.md` → Oturum B'de gelecek.

## Bu turda yapılanlar

- **Navigasyon**: `MF.views.register()` + `MF.navigation.go()`; aktif rail butonu, tek aktif
  view, replay state'inin korunması, replay'den çıkışta oynatmanın durdurulması.
- **Ortak model**: `buildMatchModel()` — takım çıkarımı (devre arası taraf değişimine dayanıklı),
  round sonucu (parser/inferred), entry, trade, clutch, KAST, ADR, silah dağılımı, utility sayımları.
- **Analysis ekranı**: üç durum (demo yok / metrik yok / hazır), filtre çubuğu, özet kartları,
  takım ve oyuncu tabloları (eksik metrik sütunları gizlenir), round listesi ve olay listesi.
  Her olay satırındaki **Replay** butonu `MF.replay.jumpTo(tick)` ile replay'e atlar.
- **Parser**: `eventStatus` raporlaması, genişletilmiş + geri düşen (fallback) event varyantları,
  yeni eventler `damage`, `shots`, `impacts`, `freezeEnds`, `roundEnds`, `blinds`.
- **Testler**: 51 test (saf analiz, worker, jsdom entegrasyonu). `npm test`.
- **Önizleme**: `npm run preview` → `dev/preview.html` (Electron gerekmez, fixture veriyle çalışır).

## Bu turda yapılanlar (Aşama 4 kalanı + Utility hesap katmanı)

- **Parser**: `item_purchase`, `player_spawn`, `player_team`, `player_disconnect`,
  `begin_new_match` eventleri `safeEventVariants` ile eklendi; `buildRoundMeta` artık her round
  için `freezeEndTick` üretiyor (round başına ilk `round_freeze_end`).
- **Model**: `availability.purchases/spawns/teamChanges/disconnects`, `round.economy.{spend,buys}`,
  `player.totals.economy`, `player.rounds[n].{spend,buys}`, `player.disconnected`;
  `round.freezeEndTick` + `round.jumpTick` (replay freeze bitişine atlar, round süresi oradan ölçülür)
  ve `round.rosterChanges`.
- **Utility hesap katmanı**: `ui/analysis/utility-analysis.js` — `buildUtilityModel(model, {frames})`.
  Atış sayımı (expire eventleri hariç), flash bağlama (attacker yoksa son `flashbang_detonate`),
  düşman/takım ayrımı, boşa flash, smoke aktif süresi (expire yoksa `null`), molotov yanma + hasar,
  HE hasarı/isabet, inventory (round başı + ölüm anı), aldatıcı hasar (ölüm sonrası düşen hasar),
  round/takım dağılımı ve güven (confidence) sınıflandırması.
- **Fixture**: `test/fixtures/utility-heavy.json` (3 round, 6 oyuncu, 15 utility atışı,
  1 fallback körlük, 1 disconnect, ekonomi kayıtları, frame inventory).
- **Testler**: 67 test (13 utility + 3 worker).

## Sonraki oturum için giriş noktaları

1. **Utility ekranı UI (Oturum B)**: `ui/views/utility-view.js` — özet kartları, oyuncu tablosu,
   radar overlay (smoke/molotov/flash/he detonasyon noktaları), round filtresi ve
   event satırından `MF.replay.jumpTo(tick, { steamId })` ile replay'e atlama.
2. **Aim MVP (Aşama 6 / Oturum C)**: yalnızca Utility UI bittikten sonra; `weapon_fire` +
   `bullet_impact` + `player_hurt` eşleştirmesiyle crosshair açı hatası, potential reaction
   time, duel listesi.
3. **Gelişmiş analiz (Oturum D)**: ekonomi ekranı (round bazlı spend/buy), side split, momentum,
   heatmap.

## Test komutları

```bash
npm test              # tüm testler (saf analiz + worker + jsdom DOM)
npm run test:analysis # yalnızca saf analiz testleri
npm run fixtures      # test/fixtures/*.json dosyalarını yeniden üret
npm run preview       # tarayıcı önizlemesi (http://localhost:5173/dev/preview.html)
```

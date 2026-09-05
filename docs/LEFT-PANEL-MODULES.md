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
| 4 | Parser genişletmesi | 🟡 Kısmen | `player_hurt`, `weapon_fire`, `bullet_impact`, `round_freeze_end`, `round_end.winner/reason`, `player_death` detay alanları eklendi. Eksik: `item_purchase`, `player_spawn/team/disconnect`, `begin_new_match` |
| 5 | Utility MVP | ⬜ Sıradaki | `ui/analysis/utility-analysis.js` + radar overlay + flash/damage metrikleri |
| 6 | Aim MVP | ⬜ Bekliyor | Utility bitmeden başlanmamalı |
| 7 | Gelişmiş analiz | ⬜ Bekliyor | Heatmap, reaction-time tahmini, ekonomi, Ruby coaching |
| 8 | Rust'a taşıma | ⬜ Bekliyor | Formüller doğrulandıktan sonra |

Durum: Aşama 1-3 `main`'de, Windows build + release hattı çalışıyor
(`v0.7.0-alpha.1-build.121`). Kalan 5 aşama için yol haritası `docs/ROADMAP-REMAINING.md`.

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

## Sonraki oturum için giriş noktaları

1. **Utility MVP (Aşama 5)**
   - `ui/analysis/utility-analysis.js`: smoke/flash/HE/molotov özetleri, flash assist,
     kör edilen rakip/takım arkadaşı, ortalama körlük süresi, utility damage, smoke aktif süresi.
   - `ui/views/utility-view.js`: özet kartları + event tablosu + radar overlay + replay'e git.
   - Gerekirse parser'a `flashbang_detonate` konum alanları ve `inferno` kapsama alanı eklenir.
2. **Parser tamamlama (Aşama 4 kalanı)**: `item_purchase`, `player_spawn`, `player_team`,
   `player_disconnect`, `begin_new_match`.
3. **Aim MVP (Aşama 6)**: yalnızca Utility bittikten sonra; `weapon_fire` + `bullet_impact`
   + `player_hurt` eşleştirmesiyle crosshair açı hatası, potential reaction time, duel listesi.

## Test komutları

```bash
npm test              # tüm testler (saf analiz + worker + jsdom DOM)
npm run test:analysis # yalnızca saf analiz testleri
npm run fixtures      # test/fixtures/*.json dosyalarını yeniden üret
npm run preview       # tarayıcı önizlemesi (http://localhost:5173/dev/preview.html)
```

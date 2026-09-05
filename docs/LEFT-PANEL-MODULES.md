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
    aim-analysis.js          buildAimModel() — aim ekranının hesap katmanı
  state/
    bus.js                   olay bus'ı
    demo-store.js            demo + analiz modeli cache'i
    filter-store.js          ekranlar arası paylaşılan oyuncu/round/silah filtresi
  components/
    dom.js, stat-card.js, data-table.js, empty-state.js, filters.js, event-list.js
    radar.js                canvas radar overlay (utility konumları)
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
  utility-view.test.mjs      jsdom ile utility ekranı entegrasyonu
  aim-analysis.test.mjs      aim metrikleri (geometri + fixture)
  aim-view.test.mjs          jsdom ile aim ekranı entegrasyonu
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
| 5 | Utility MVP | ✅ Tamam | `ui/analysis/utility-analysis.js` + utility ekranı (kartlar, radar overlay, oyuncu tablosu, olay listesi, replay bağlantısı) |
| 6 | Aim MVP | ✅ Tamam | `ui/analysis/aim-analysis.js` + aim ekranı (kartlar, ısı haritası, silah tablosu, düello listesi, replay) |
| 7.1 | Gelişmiş metrikler (Analysis 2. sürüm) | ✅ Tamam | Ekonomi, side split, momentum grafiği, maç ısı haritası, opening düellolar — 11 + 8 yeni test |
| 7.2 | Ruby coaching entegrasyonu | ✅ Tamam | `ui/analysis/coaching.js` + `backend/analytics/analyze.rb` (11 kural) + `ui/components/coach-notes.js` |
| 8 | Rust'a taşıma | 🟡 Kısmi | `backend/src/analysis.rs` (analysis-rs özelliği) + `ui/analysis/rust-bridge.js` + parity testi |

Durum: Aşama 1-4 `main`'de, Windows build + release hattı çalışıyor
(`v0.7.0-alpha.1-build.121`). Aşama 5, 6, 7.1, 7.2, 8 (kısmi) ve sürüm finalizasyonu bu
dalda tamamlandı; `npm test` 147 test · 144 geçer · 3 atlanır. Sürüm notları:
`docs/RELEASE-0.7.0-alpha.1.md`.

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

## Bu turda yapılanlar (Aşama 4 kalanı + Aşama 5 + Aşama 6)

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
- **Utility ekranı**: `ui/views/utility-view.js` — tür/round/oyuncu/taraf filtreleri, özet
  kartları (atılan utility, kör edilen rakip/takım arkadaşı, boşa flash, utility hasarı,
  ortalama smoke süresi), `ui/components/radar.js` canvas overlay'i (konum + takım rengi,
  tıklayınca replay), oyuncu tablosu ve olay listesi (her satırda **Replay**).
  Round seçiliyken zaman çizelgesi (slider) ile utility sırası izlenebilir.
- **Eksik veri davranışı**: `player_blind` yoksa körlük sütunları/kartları, `player_hurt`
  yoksa hasar sütunları, tick state yoksa envanter sütunları gizlenir; sebebi "Veri durumu"
  bloğunda yazılır. Smoke süresi expire olmadan **tahmin edilmez** (kartta "—").
- **Aim hesap katmanı**: `ui/analysis/aim-analysis.js` — `buildAimModel(model, { frames })`.
  Silah bazında kill/HS/atış/isabet, accuracy (`bullet_impact` → en yakın önceki atışa
  bağlanır), ortalama kill mesafesi, hareket halinde atış oranı (frame'lerden hız),
  crosshair açı hatası (kamera yaw/pitch − hedef yönü) ve **potential reaction time**
  (hedefin görüş konisine girdiği an → ilk atış). Eşikler yapılandırılabilir
  (`config.crosshair`, `duelWindowSeconds`); veri yoksa metrik `null`.
- **Aim ekranı**: `ui/views/aim-view.js` — round/oyuncu/taraf/silah filtreleri, özet
  kartları, ısı haritası (isabet + kill noktaları, radar bileşeniyle), silah dağılımı
  ve oyuncu tabloları, düello listesi (her satırda **Replay**). Eksik veride ilgili
  kart/sütun gizlenir; "Doğruluk sınırları" bloğunda visibility uyarısı her zaman görünür.
- **Fixture**: `test/fixtures/aim-duel.json` (bilinen geometri: 45° koni, 750 ms reaction,
  5° crosshair hatası, hareket halinde atış) + builder'a kamera/konum track desteği.
- **Testler**: 105 test (16 aim hesap + 11 aim ekranı + 13 utility hesap + 11 utility
  ekranı + 3 worker + 51 mevcut).

## Sonraki oturum için giriş noktaları

1. **Gelişmiş analiz (Oturum D)**: ekonomi ekranı (round bazlı spend/buy, eco/full-buy
   roundları), side split (T/CT ayrımı), momentum grafiği, maç heatmap'i.
2. **Ruby coaching (Oturum E)**: `backend/analytics/analyze.rb` çıktısının Analysis
   ekranında gösterilmesi + `backend/src/main.rs` IPC yolu.
3. **Rust'a taşıma (Oturum E/F)**: formüller doğrulandıktan sonra model kurulumunu
   Rust tarafına taşıma ve büyük demoda performans regresyon testi.

## Test komutları

```bash
npm test              # tüm testler (saf analiz + worker + jsdom DOM)
npm run test:analysis # yalnızca saf analiz testleri
npm run fixtures      # test/fixtures/*.json dosyalarını yeniden üret
npm run preview       # tarayıcı önizlemesi (http://localhost:5173/dev/preview.html)
```

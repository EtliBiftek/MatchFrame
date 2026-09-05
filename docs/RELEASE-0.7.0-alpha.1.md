# MatchFrame 0.7.0-alpha.1 — sürüm notları

Tarih: 2026-09-05 · Dal: `arena/01a06f0a-matchframe` · Hedef: `0.7.0-alpha.1`

Bu sürüm, sol paneli (Replay dışındaki dört ekranı) ürünleştiren çalışmanın tamamlanmış
hâli: **Analysis (2. sürüm) · Aim · Utility · Ruby koçluk notları** ve **opsiyonel Rust
analiz motoru**.

## Neler yeni

### Analysis (Aşama 3 + 7.1)

- Özet kartları, takım karşılaştırması, oyuncu tablosu (K/D/A, ADR, HS%, entry, trade,
  flash assist, clutch), round listesi ve olay listesi → replay'e tek tıkla dönüş.
- **Ekonomi**: round başı T/CT harcaması, `eco / force / full / pistol` sınıflandırması,
  harcama farkı, "fazla harcayan kazandı" oranı (`item_purchase`).
- **Taraf dağılımı (T / CT)**: takım ve oyuncu bazında ayrı tablolar; devre arası taraf
  değişimi `round.roster` üzerinden doğru hesaplanır.
- **Round momentum**: SVG grafik — round bazında skor farkı (T üstte, CT altta) ve 2+
  roundlık kazanma serileri.
- **Isı haritası**: maç geneli kill (atan) + ölüm noktaları.
- **Opening düellolar**: T/CT açılış üstünlüğü, düello listesi (silah, HS, trade, round
  sonucu, replay bağlantısı).

### Aim (Aşama 6)

- Crosshair hatası, **potansiyel** reaksiyon süresi, hareketli atış oranı, kill mesafesi.
- Silah dağılımı tablosu, oyuncu tablosu, düello listesi (hedef replay'e gider).
- Isı haritası ve mesafe metrikleri `player_death` konumlarından (`user_X/Y`,
  `attacker_X/Y`).

### Utility (Aşama 5)

- Grenade sayımları, flash etkisi (düşman/takım kör etme), smoke/molotov kapsama süreleri.
- Radar overlay + round içi zaman çizelgesi, utility olay listesi, oyuncu tablosu.

### Ruby koçluk notları (Aşama 7.2)

- `ui/analysis/coaching.js` → normalize metrikler → `ruby_analyze` IPC → `analyze.rb`.
- 11 kural, 5 kategori (`aim`, `utility`, `entry`, `economy`, `positioning`), Türkçe
  mesajlar, `severity` + tetikleyen metrik adı.
- **Ruby yoksa / hata verirse ekranlar çalışmaya devam eder**; yalnızca durum notu görünür.
- Notlar kategoriye göre ilgili ekranda filtrelenir (Analysis: tümü, Aim: aim,
  Utility: utility).

### Rust analiz motoru (Aşama 8) — varsayılan kapalı

- `backend/src/analysis.rs`: round/oyuncu/takım kill, ölüm, hasar, ADR, headshot.
- `analysis-rs` cargo özelliği ile derlenir; kapalıyken `analysis_build` açıklayıcı hata
  döner ve uygulama JS modelini kullanır.
- `npm run test:rust-parity` → JS model ile alan bazında karşılaştırma (`MF_CORE_BIN`
  verilmediğinde atlanır).
- Taşınmayan alanlar (`coverage.deferred`): round kazananı çıkarımı, entry/trade, clutch,
  KAST, ekonomi sınıflandırma.

## Doğrulama

| Kontrol | Komut | Beklenen |
| --- | --- | --- |
| Tüm testler | `npm test` | 147 test · 144 geçer · 3 atlanır (Ruby yoksa 7) |
| Ruby kuralları | `npm run test:ruby` | `ruby` varsa 5 test, yoksa 4 atlanır |
| JS ↔ Rust eşitliği | `npm run test:rust-parity` | `MF_CORE_BIN` yoksa 3 atlanır |
| Sözdizimi | CI "Validate JavaScript syntax" adımı | tüm `node --check` satırları yeşil |
| Windows build | CI `windows-release.yml` | portable + NSIS EXE, GitHub Release |
| Electron'suz önizleme | `npm run preview` | http://localhost:5173/dev/preview.html |

Bilinen sınır: `npm test` dört ekran için de jsdom entegrasyon testi içerir; Babylon/POV
motoru bu testlerde yüklenmez (tarayıcı motoru gerektirir).

## Regresyon kriterleri (her oturumda)

- [x] Replay playback performansı düşmüyor (POV renderer analiz ekranlarında çalışmıyor)
- [x] Demo yalnızca bir kez parse ediliyor / analiz modeli bir kez kuruluyor
- [x] Ekran geçişleri demo state'ini (tick, seçili oyuncu, filtre) silmiyor
- [x] Eksik parser verisi boş ekran değil, açıklayıcı "veri yok" mesajı üretiyor
- [x] `npm test` tamamı geçiyor; her yeni metrik için fixture + birim testi eklendi
- [ ] Push sonrası Windows build yeşil (dal GitHub'a itildiğinde workflow alır)

## Bilinen eksikler / sonraki adımlar

- Aim metriklerinde **visibility (raycast) doğrulaması yok** → reaksiyon süresi
  "potansiyel" olarak etiketlenir.
- Ekipman değeri (loadout value) demo'dan okunamaz; ekonomi yalnızca round içi harcamayı
  (`item_purchase.cost`) bilir.
- Lineup / smoke rehberi sistemi MVP kapsamı dışında.
- Rust tarafına taşınmayı bekleyen alanlar `coverage.deferred` içinde listelenir.

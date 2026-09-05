#!/usr/bin/env ruby
#
# MatchFrame — Ruby koçluk motoru (Aşama 7.2).
#
# Girdi  (stdin): { "metrics": { ... }, "availability": { ... }, "scope": { ... } }
# Çıktı (stdout): { "engine": "ruby-rules-v2", "schemaVersion": 2,
#                   "notes": [ { "severity", "category", "tag", "text", "metric" } ],
#                   "evaluated": N, "skipped": ["kural adi", ...] }
#
# Kurallar:
#   - Metrik yoksa (nil) kural DEĞERLENDİRİLMEZ; tahmin üretilmez.
#   - Kategoriler: aim | utility | entry | economy | positioning
#   - Mesajlar Türkçe; eşikler burada sabittir (JS tarafı yalnızca metrik sağlar).
#
require 'json'

SEVERITY_ORDER = { 'high' => 0, 'medium' => 1, 'low' => 2 }.freeze

raw = STDIN.read
input = begin
  JSON.parse(raw.empty? ? '{}' : raw)
rescue StandardError
  {}
end

metrics = input['metrics'].is_a?(Hash) ? input['metrics'] : {}
availability = input['availability'].is_a?(Hash) ? input['availability'] : {}

notes = []
evaluated = 0
skipped = []

# Yalnızca sayısal ve mevcut metriklerle çalışır; yoksa nil döner → kural atlanır.
def num(metrics, key)
  value = metrics[key]
  return nil unless value.is_a?(Numeric)
  value
end

def add(notes, severity, category, tag, text, metric)
  notes << {
    severity: severity,
    category: category,
    tag: tag,
    text: text,
    metric: metric
  }
end

# Bir kuralın girdisi hazır mı? Değilse kural "skipped" listesine yazılır.
def ready?(metrics, availability, group, keys)
  return false if availability.key?(group) && availability[group] == false
  keys.all? { |key| !metrics[key].nil? }
end

# --- Entry / trade -----------------------------------------------------------
if ready?(metrics, availability, 'entry', ['entry_deaths', 'entry_traded'])
  evaluated += 1
  deaths = num(metrics, 'entry_deaths').to_f
  traded = num(metrics, 'entry_traded').to_f
  if deaths >= 3 && traded < deaths * 0.4
    rate = metrics['entry_trade_rate']
    suffix = rate.is_a?(Numeric) ? " (trade oranı %#{(rate * 100).round})" : ''
    add(notes, 'high', 'entry', 'trade edilmeyen entry',
        "Entry (ilk ölüm) verdiğin roundların çoğunda takım arkadaşın karşılık veremiyor#{suffix}. " \
        'Entry girerken bilgi toplamaya odaklan: ölmeden önce konum söyle ve trade mesafesinde kal.',
        'entry_trade_rate')
  elsif deaths.positive? && deaths > traded * 2
    add(notes, 'medium', 'entry', 'entry dengesi',
        'Entry ölümleri trade edilenlerden belirgin şekilde fazla. İlk temas sonrası takımınla aynı hizada ilerle.',
        'entry_deaths')
  end
else
  skipped << 'entry_trade'
end

# --- Aim ---------------------------------------------------------------------
if ready?(metrics, availability, 'aim', ['avg_crosshair_error_deg'])
  evaluated += 1
  error = num(metrics, 'avg_crosshair_error_deg')
  if error > 7.0
    add(notes, 'high', 'aim', 'crosshair hatası',
        "Ortalama crosshair hatan #{error.round(1)}° (hedef < 4°). Dönüş öncesi nişangâhı omuz hizasında tut ve pre-aim çalış.",
        'avg_crosshair_error_deg')
  elsif error > 4.0
    add(notes, 'medium', 'aim', 'crosshair hatası',
        "Ortalama crosshair hatan #{error.round(1)}°, hedefin üzerinde. Köşe dönüşlerinde nişangâhı bir adım önceden hizala.",
        'avg_crosshair_error_deg')
  end
else
  skipped << 'crosshair_error'
end

if ready?(metrics, availability, 'aim', ['potential_reaction_ms'])
  evaluated += 1
  reaction = num(metrics, 'potential_reaction_ms')
  if reaction > 500
    add(notes, 'medium', 'aim', 'reaksiyon',
        "Potansiyel reaksiyon süren #{reaction.round} ms. Bu bir üst sınır tahminidir; gerçek süre daha kısa olabilir. " \
        'Yaygın açıları önceden tutarak bu süreyi düşürebilirsin.',
        'potential_reaction_ms')
  end
else
  skipped << 'reaction_time'
end

if ready?(metrics, availability, 'aim', ['headshot_percent', 'kills'])
  evaluated += 1
  headshot = num(metrics, 'headshot_percent')
  kills = num(metrics, 'kills')
  if kills >= 10 && headshot < 25
    add(notes, 'low', 'aim', 'headshot oranı',
        "Headshot oranın %#{headshot.round} (#{kills.round} kill). İlk mermiyi baş hizasına alıştırmak spray control'den daha çok iş yarıyor.",
        'headshot_percent')
  end
else
  skipped << 'headshot_rate'
end

# --- Utility -----------------------------------------------------------------
if ready?(metrics, availability, 'utility', ['flash_assists', 'rounds'])
  evaluated += 1
  assists = num(metrics, 'flash_assists').to_i
  rounds = num(metrics, 'rounds').to_i
  if assists.zero? && rounds >= 10
    add(notes, 'low', 'utility', 'flash assist yok',
        "#{rounds} roundda hiç flash assist üretmedin. Flash'ı takım arkadaşın girmeden 1 sn önce at; self-flash yerine onun açısını aç.",
        'flash_assists')
  end
else
  skipped << 'flash_assists'
end

if ready?(metrics, availability, 'utility', ['teammates_blinded', 'enemies_blinded'])
  evaluated += 1
  teammates = num(metrics, 'teammates_blinded').to_i
  enemies = num(metrics, 'enemies_blinded').to_i
  if teammates >= 2 && teammates > enemies
    add(notes, 'medium', 'utility', 'takımı kör etme',
        "Flash'ların #{teammates} kez takım arkadaşını, #{enemies} kez rakibi kör etti. Atış öncesi takım arkadaşının konumunu kontrol et.",
        'teammates_blinded')
  end
else
  skipped << 'team_flashes'
end

if ready?(metrics, availability, 'utility', ['utility_thrown', 'rounds'])
  evaluated += 1
  thrown = num(metrics, 'utility_thrown').to_f
  rounds = num(metrics, 'rounds').to_f
  if rounds >= 5 && (thrown / rounds) < 1.0
    add(notes, 'low', 'utility', 'az utility',
        "Round başına %.1f utility atıyorsun. Smoke ve molotov'la alan kapatmak T tarafında round kazanmanın en ucuz yolu." % (thrown / rounds),
        'utility_thrown')
  end
else
  skipped << 'utility_volume'
end

# --- Ekonomi -----------------------------------------------------------------
if ready?(metrics, availability, 'economy', ['force_rounds', 'force_win_rate'])
  evaluated += 1
  forces = num(metrics, 'force_rounds').to_i
  rate = num(metrics, 'force_win_rate')
  if forces >= 3 && rate < 0.25
    add(notes, 'medium', 'economy', 'force buy verimsiz',
        "#{forces} force buy roundundan yalnızca %#{(rate * 100).round} kazanıldı. Bir round tam eco yapıp sonraki full buy'ı garantilemek daha kârlı olabilir.",
        'force_win_rate')
  end
else
  skipped << 'force_buy_efficiency'
end

if ready?(metrics, availability, 'economy', ['eco_rounds', 'rounds'])
  evaluated += 1
  eco = num(metrics, 'eco_rounds').to_i
  rounds = num(metrics, 'rounds').to_i
  if rounds >= 6 && eco.zero?
    add(notes, 'low', 'economy', 'eco round yok',
        'Hiç eco roundu oynanmamış. Kaybedilen rounddan sonra silah saklamak sonraki roundun kazanma şansını belirgin artırır.',
        'eco_rounds')
  end
else
  skipped << 'eco_discipline'
end

# --- Opening düellolar -------------------------------------------------------
if ready?(metrics, availability, 'opening', ['opening_attempts', 'opening_success_percent'])
  evaluated += 1
  attempts = num(metrics, 'opening_attempts').to_i
  success = num(metrics, 'opening_success_percent')
  if attempts >= 4 && success < 40
    add(notes, 'medium', 'positioning', 'açılış kaybı',
        "Açtığın #{attempts} düellonun yalnızca %#{success.round}ını kazandın. İlk teması daha avantajlı açılardan (off-angle, bilgi sonrası) almayı dene.",
        'opening_success_percent')
  end
else
  skipped << 'opening_duels'
end

if ready?(metrics, availability, 'aim', ['avg_kill_distance'])
  evaluated += 1
  distance = num(metrics, 'avg_kill_distance')
  if distance > 900
    add(notes, 'low', 'positioning', 'uzun mesafe düello',
        "Kill'lerinin ortalaması #{distance.round} unit mesafede. Uzun açılar risklidir; yakın ve orta mesafeli açıları tercih et.",
        'avg_kill_distance')
  end
else
  skipped << 'kill_distance'
end

notes.sort_by! { |note| [SEVERITY_ORDER.fetch(note[:severity], 3), note[:category].to_s] }

puts JSON.generate({
  engine: 'ruby-rules-v2',
  schemaVersion: 2,
  notes: notes,
  evaluated: evaluated,
  skipped: skipped
})

# Ortak analiz veri modeli

`ui/analysis/match-analysis.js` içindeki `buildMatchModel(demo)`, `electron/demo-worker.cjs`
çıktısını **bir kez** tarar ve tüm sol panel ekranlarının kullandığı normalize modeli üretir.
Ekranlar render sırasında ham `demo` nesnesini tekrar tekrar taramaz.

Model sürümü: `MODEL_SCHEMA_VERSION` (şu an `1`). Şema değişikliklerinde bu değer artırılır.

## Üst seviye şema

```js
{
  schemaVersion: 1,
  ready: true,
  reason: null,

  match: {
    map, server, file,
    durationSeconds, tickRate, roundsPlayed, maxTick, sampleStep,
    score: { 'team-1': 5, 'team-2': 3 },   // takım bazında skor
    scoreBySide: { T: 5, CT: 3 }           // taraf bazında (devre arası dahil)
  },

  availability: {                          // her veri seti için durum
    rounds:    { available, count, error },
    roundEnds: { available, count, error },
    kills:     { available, count, error },
    damage:    { available, count, error },
    shots:     { available, count, error },
    impacts:   { available, count, error },
    blinds:    { available, count, error },
    utility:   { available, count, error },
    bomb:      { available, count, error },
    freezeEnd: { available, count, error },
    purchases: { available, count, error },   // item_purchase
    spawns:    { available, count, error },   // player_spawn
    teamChanges: { available, count, error }, // player_team
    disconnects: { available, count, error }  // player_disconnect
  },

  teams: [{
    id,            // 'team-1' | 'team-2'
    name,          // clan/team adı, yoksa "Takım N"
    score,
    players: [steamid],
    sides: { T, CT },
    totals: { kills, deaths, assists, plants, defuses, entryKills, entryDeaths,
              headshotKills, headshotPercent, damage, adr, clutchWon, clutchAttempts,
              entrySuccessPercent }
  }],

  players: {
    [steamid]: {
      steamId, name, teamId, teamName, side, sidesPlayed: { T, CT },
      identity: { steamId, name },
      totals: { kills, deaths, assists, flashAssists, headshotKills, headshotPercent,
                teamKills, suicides, entryKills, entryDeaths, tradeKills, tradedDeaths,
                plants, defuses, damage, adr, kastPercent, kd, kpr,
                multiKills: { 2..5 }, clutches: { attempts, won, byCount },
                utility: { smoke, flash, he, molotov, decoy }, utilityDamage,
                economy: { spend, buys, pistols, rifles, awps } },
      disconnected: false,
      rounds: { [roundNumber]: { kills, deaths, assists, damage, headshotKills, spend, buys, survived, traded } },
      weapons: { [weaponKey]: { key, label, kills, headshots, shots, hits, damage } },
      aim: null,        // Aşama 6
      utility: null     // Aşama 5
    }
  },
  playerOrder: [steamid],

  rounds: [{
    number, index, startTick, endTick, freezeEndTick, jumpTick, durationSeconds,
    winnerTeamNumber, winnerSide, winnerTeamId, reason, reasonCode,
    outcomeSource: 'parser' | 'inferred',
    teamBySide: { T: teamId, CT: teamId },
    kills: [], damage: [], shots: [], utility: [], blinds: [], bomb: [],
    firstKill, firstDeath, entryKill,
    bombPlanted, bombDefused, bombExploded,
    survivors: { T, CT }, roster: { T: [steamid], CT: [steamid] },
    rosterChanges: [{ steamId, name, tick, kind: 'disconnect' }],
    economy: { spend, buys },
    clutch: { team, side, playerSteamId, playerTeamId, opponents, startTick, won } | null,
    scoreAfter: { teamId: score }
  }],

  events: { kills: [], damage: [], shots: [], impacts: [], utility: [], blinds: [], bomb: [],
            purchases: [], disconnects: [] },
  notes: [{ level, dataset, message }],
  config: { tradeWindowSeconds, minRosterForClutch, scanFramesPerRound },
  meta: { sideSource: 'tick-state' | 'player-list' | 'unknown', outcomeSource }
}
```

## Normalize edilmiş event şeması

`ui/analysis/common.js` demoparser2 alan adlarını kapatır; parser sürümü değişirse
yalnızca bu katman güncellenir.

```js
{
  type: 'kill' | 'hurt' | 'shot' | 'utility' | 'blind' | 'bomb',
  tick, round, roundIndex,
  actorSteamId, actorName,      // attacker / atan oyuncu
  targetSteamId, targetName,    // victim / etkilenen oyuncu
  weapon, weaponLabel,
  damage, hitgroup, headshot,
  position: { x, y, z },
  ...                            // türe özel alanlar (kind, phase, duration, assistedFlash …)
}
```

## Hesaplama kuralları

| Metrik | Kural |
| --- | --- |
| Kill | `player_death` eventi; intihar (`attacker` yok / `attacker == victim` / dünya silahı) ve takım arkadaşı öldürme sayılmaz |
| Entry (opening) | Round içindeki ilk intihar/teamkill olmayan kill; `attacker` entry kill, `victim` entry death |
| Trade | Bir oyuncunun ölümünden sonra **5 saniye** içinde (`config.tradeWindowSeconds`) takım arkadaşı ölümün failini öldürürse trade kill |
| Clutch | Round içinde bir takım 1 kişiye düşerken rakipte ≥2 kişi hayattaysa clutch durumu başlar; round kazanılırsa clutch kazanıldı. `1v2 … 1v5` olarak ayrılır |
| ADR | Round başına hasar; `player_hurt` yoksa `null` |
| KAST | Round bazında kill veya assist veya hayatta kalma veya trade edilme |
| Round sonucu | `round_end.winner/reason` varsa `outcomeSource: 'parser'`; yoksa bomba/elenme/süre kurallarıyla infer edilir, `outcomeSource: 'inferred'` |
| Taraf tespiti | Round içindeki tick state'inden (`frames`), yoksa `players[].team_number`; devre arası taraf değişiminde bile **takım kimliği** union-find ile sabit tutulur |
| Round başlangıcı | `round_freeze_end` varsa `round.freezeEndTick` dolar; `round.jumpTick = freezeEndTick ?? startTick` ve `durationSeconds` freeze bitişinden endTick'e ölçülür (replay de freeze bitişine atlar) |
| Ekonomi | `item_purchase` eventleri round'a dağıtılır: `round.economy.{spend,buys}`, `player.totals.economy.{spend,buys,pistols,rifles,awps}`, `player.rounds[n].{spend,buys}`. Veri yoksa hepsi 0 kalır ve `availability.purchases.available=false` |
| Ayrılma | `player_disconnect` olan oyuncuda `player.disconnected = true`, ilgili round'da `rosterChanges` kaydı |

## Veri bulunabilirliği

`safeEvent()` hataları artık sessize alınmaz: worker `eventStatus[name] = { ok:false, error }`
döner ve model bunu `availability[name] = { available:false, error }` olarak taşır.
Böylece "oyuncu hiç hasar vermedi" ile "hasar eventleri parse edilemedi" UI'da ayrılır.

## Bilinen sınırlar

- Model kurulumu senkron (renderer thread). Büyük demolar için Aşama 8'de Rust'a taşınacak.
- `bullet_impact` eventleri ayrıştırılır ama henüz metrik üretmez (Aşama 6).
- Reaction time ve visibility doğrulaması yok; Aşama 6'da "potential reaction time" olarak gelecek.
- `player_spawn`, `player_team` ve `begin_new_match` eventleri worker tarafından ayrıştırılır; modelde henüz metrik üretmez (Aşama 5/7).

## Utility modeli (`buildUtilityModel`)

`ui/analysis/utility-analysis.js`, `buildMatchModel` çıktısından utility ekranının modelini üretir.
Frame verisi modele kopyalanmaz; inventory metrikleri için `buildUtilityModel(model, { frames: demo.frames })`
çağrılır (frames verilmezse `availability.frames = 'unavailable'`).

```js
{
  schemaVersion: 2,
  available: true,
  availability: {
    utility, blinds, damage, frames, smokes, flashes, molotovs   // 'full' | 'partial' | 'unavailable'
  },
  warnings: [string],               // örn. "N körlük kaydında attacker alanı yoktu…"
  map, tickRate, roundCount,
  rounds: [{ number, index, jumpTick, startTick, endTick, counts, byTeam: { T, CT }, flashAssists }],
  players: [{
    steamId, name, teamId, teamName,
    thrown: { smoke, flash, he, molotov, decoy, total },
    flash: { thrown, enemiesBlinded, teammatesBlinded, selfBlinds, blindSeconds,
             enemiesBlindSeconds, teammateBlindSeconds, wasted, wastedRate,
             enemiesPerFlash, attributedByFallback, unknownSeconds, assists },
    smoke: { thrown, activeSeconds, avgActiveSeconds, expireSecondsKnown,
             expireSecondsUnknown, cutRate },
    molotov: { thrown, burnSeconds, avgBurnSeconds, expiringKnown, damage, playersBurned },
    he: { thrown, damage, playersHit, wasted, playersPerThrow, wastedRate, avgDamagePerVictim },
    inventory: { available, keptAtRoundEnd, roundsWithUtility, deathsWithUtility,
                 grenadesWastedOnDeath },
    damage: { utilityDamage, beforeKill, afterKill, simple, killsWithTrailingDamage, deceptivePct },
    value: { perRound, perRoundThrown, perRoundDamage },
    confidence: 'high' | 'medium' | 'low',
    rounds: [{ round, thrown, damage }]
  }],
  totals: { thrown, flash, smoke, molotov, he },
  limits: { maxSmokeSeconds: 18, flashAttributionWindowSeconds: 4 }
}
```

Kurallar:

| Metrik | Kural |
| --- | --- |
| Atılan utility | `smoke/flash/he` için `phase:'detonate'`, `molotov/decoy` için `phase:'start'`. `expire`/`fade` eventleri atış sayısına girmez |
| Smoke süresi | `smokegrenade_detonate` → `smokegrenade_expired` farkı / tickRate. Expire yoksa `avgActiveSeconds = null` ve `expireSecondsUnknown` artar (tahmin üretilmez) |
| Molotov süresi/hasarı | `inferno_startburn` → `inferno_expire`; hasar `player_hurt` içinde `weapon: inferno/incgrenade/molotov` |
| Flash | `player_blind.attacker` varsa doğrudan; yoksa son `flashbang_detonate` (≤4 sn) sahibine bağlanır ve `attributedByFallback`/`confidence:'medium'` ile işaretlenir. Düşman/takım ayrımı `teamId` karşılaştırmasıyla yapılır |
| Boşa flash | `thrown - enemiesBlinded - teammatesBlinded` |
| HE isabet | `player_hurt`'ta `weapon: hegrenade`; farklı mağdur sayısı (`playersHit`), oyuncu sayısı atış sayısını aşabileceği için oran `playersPerThrow` olarak adlandırılır |
| Inventory | Round başındaki (freeze bitişi) frame'deki `inventory` dizisi; ölüm anındaki son frame'de kalan nade sayısı `grenadesWastedOnDeath` |
| Aldatıcı hasar | Bir kill'in ±4 sn penceresinde aynı attacker→victim hasarı; ölüm tick'inden **sonra** gelen hasar `afterKill` (aldatıcı), önce gelen `beforeKill`, ilişkisiz olan `simple` |

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
    freezeEnd: { available, count, error }
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
                utility: { smoke, flash, he, molotov, decoy }, utilityDamage },
      rounds: { [roundNumber]: { kills, deaths, assists, damage, headshotKills, survived, traded } },
      weapons: { [weaponKey]: { key, label, kills, headshots, shots, hits, damage } },
      aim: null,        // Aşama 6
      utility: null     // Aşama 5
    }
  },
  playerOrder: [steamid],

  rounds: [{
    number, index, startTick, endTick, durationSeconds,
    winnerTeamNumber, winnerSide, winnerTeamId, reason, reasonCode,
    outcomeSource: 'parser' | 'inferred',
    teamBySide: { T: teamId, CT: teamId },
    kills: [], damage: [], shots: [], utility: [], blinds: [], bomb: [],
    firstKill, firstDeath, entryKill,
    bombPlanted, bombDefused, bombExploded,
    survivors: { T, CT }, roster: { T: [steamid], CT: [steamid] },
    clutch: { team, side, playerSteamId, playerTeamId, opponents, startTick, won } | null,
    scoreAfter: { teamId: score }
  }],

  events: { kills: [], damage: [], shots: [], impacts: [], utility: [], blinds: [], bomb: [] },
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

## Veri bulunabilirliği

`safeEvent()` hataları artık sessize alınmaz: worker `eventStatus[name] = { ok:false, error }`
döner ve model bunu `availability[name] = { available:false, error }` olarak taşır.
Böylece "oyuncu hiç hasar vermedi" ile "hasar eventleri parse edilemedi" UI'da ayrılır.

## Bilinen sınırlar

- Model kurulumu senkron (renderer thread). Büyük demolar için Aşama 8'de Rust'a taşınacak.
- `bullet_impact` eventleri ayrıştırılır ama henüz metrik üretmez (Aşama 6).
- Reaction time ve visibility doğrulaması yok; Aşama 6'da "potential reaction time" olarak gelecek.

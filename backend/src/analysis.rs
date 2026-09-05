//! Rust analiz motoru (Aşama 8).
//!
//! Amaç: `ui/analysis/match-analysis.js` içindeki `buildMatchModel` ile **aynı alan
//! adlarına** sahip modeli Rust tarafında üretmek; böylece büyük demoda event
//! taraması renderer yerine native tarafta yapılabilir.
//!
//! Önemli: Bu modül `analysis-rs` özelliği ile derlenir (`cargo build --features
//! analysis-rs`). Varsayılan derlemeye dahil DEĞİLDİR; release hattı bu modül
//! olmadan da çalışır (`analysis_build` action'ı özellik kapalıyken açıklayıcı
//! hata döner).
//!
//! Kapsam (aşamalı taşıma):
//!   * Hesaplanan: round sayısı/başlangıç-bitiş, round başına kill/ölüm/hasar,
//!     oyuncu başına kill/ölüm/hasar/ADR/headshot, takım toplamları + ADR.
//!   * JS'te kalan (sonraki aşama): round kazananı çıkarımı, entry/trade,
//!     clutch, KAST, ekonomi sınıflandırma. Bu alanlar `coverage.deferred`
//!     içinde listelenir ve modelde null/eksik bırakılır — uydurulmaz.

use serde_json::{json, Value};
use std::collections::BTreeMap;

const SCHEMA_VERSION: i64 = 1;
const DEFAULT_TICK_RATE: f64 = 64.0;

fn i64_of(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(number)) => number.as_i64().unwrap_or(0),
        Some(Value::String(text)) => text.parse::<i64>().unwrap_or(0),
        Some(Value::Bool(flag)) => {
            if *flag {
                1
            } else {
                0
            }
        }
        _ => 0,
    }
}

fn f64_of(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.parse::<f64>().unwrap_or(0.0),
        Some(Value::Bool(flag)) => {
            if *flag {
                1.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    }
}

fn str_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

fn array_of(value: Option<&Value>) -> Vec<Value> {
    match value {
        Some(Value::Array(items)) => items.clone(),
        _ => Vec::new(),
    }
}

#[derive(Default, Clone, Copy)]
struct Totals {
    kills: i64,
    deaths: i64,
    damage: f64,
    headshots: i64,
}

fn round_index_for(rounds: &[Value], tick: i64) -> Option<usize> {
    for (index, round) in rounds.iter().enumerate() {
        let start = i64_of(round.get("startTick"));
        let end = i64_of(round.get("endTick"));
        if tick >= start && tick <= end {
            return Some(index);
        }
    }
    None
}

// JS `teamNamesFor` ile aynı kural: "T"/"CT" gibi genel adlar takım adı sayılmaz,
// en çok oy alan ad kazanır.
fn is_generic_team_name(name: &str) -> bool {
    matches!(
        name.trim().to_lowercase().as_str(),
        "t"
            | "ct"
            | "terrorist"
            | "terrorists"
            | "counter-terrorist"
            | "counter-terrorists"
            | "counterterrorist"
            | "counterterrorists"
    )
}

fn team_display_name(candidates: &[String]) -> String {
    let mut votes: BTreeMap<String, i64> = BTreeMap::new();
    for candidate in candidates {
        let trimmed = candidate.trim();
        if trimmed.is_empty() || is_generic_team_name(trimmed) {
            continue;
        }
        let entry = votes.entry(trimmed.to_string()).or_insert(0);
        *entry += 1;
    }
    votes
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(name, _)| name)
        .unwrap_or_default()
}

fn percent(top: f64, bottom: f64) -> Option<f64> {
    if bottom <= 0.0 {
        return None;
    }
    Some((top / bottom) * 100.0)
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

struct Identity {
    name: String,
    team_number: i64,
    team_name: String,
}

/*
 * `payload` doğrudan demo nesnesi olabileceği gibi `{ "demo": {...} }` sarmalayıcısı
 * da olabilir. Yalnızca event dizileri okunur; `frames` gönderilmez.
 */
pub fn build_match_model(payload: &Value) -> Result<Value, String> {
    let demo = match payload.get("demo") {
        Some(inner) if inner.is_object() => inner,
        _ => payload,
    };

    let header = demo.get("header").cloned().unwrap_or(Value::Null);
    let players = array_of(demo.get("players"));
    let rounds_meta = array_of(demo.get("roundMeta"));
    let deaths = array_of(demo.get("deaths"));
    let damages = array_of(demo.get("damage"));

    if rounds_meta.is_empty() && deaths.is_empty() {
        return Err("roundMeta ve deaths boş: analiz edilecek veri yok".to_string());
    }

    let tick_rate = {
        let rate = f64_of(demo.get("tickRate"));
        if rate > 0.0 {
            rate
        } else {
            DEFAULT_TICK_RATE
        }
    };
    let rounds_played = rounds_meta.len() as f64;

    // Kimlik ve takım haritaları (BTreeMap: çıktı sırası determinist)
    let mut identities: BTreeMap<String, Identity> = BTreeMap::new();
    let mut team_name_votes: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    let mut team_members: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    for player in &players {
        let steam_id = str_of(player.get("steamid").or_else(|| player.get("steamId")));
        if steam_id.is_empty() {
            continue;
        }
        let team_number = i64_of(player.get("team_number").or_else(|| player.get("teamNumber")));
        let team_name = str_of(player.get("team_name").or_else(|| player.get("teamName")));
        team_name_votes
            .entry(team_number)
            .or_default()
            .push(team_name.clone());
        team_members
            .entry(team_number)
            .or_default()
            .push(steam_id.clone());
        identities.insert(
            steam_id,
            Identity {
                name: str_of(player.get("name")),
                team_number,
                team_name,
            },
        );
    }

    // Takım adı: oy çoğunluğu, yoksa "Takım N" (JS modeli ile aynı sıra)
    let mut team_names: BTreeMap<i64, String> = BTreeMap::new();
    for (index, (team_number, candidates)) in team_name_votes.iter().enumerate() {
        let resolved = team_display_name(candidates);
        let name = if resolved.is_empty() {
            format!("Takım {}", index + 1)
        } else {
            resolved
        };
        team_names.insert(*team_number, name);
    }

    let mut by_player: BTreeMap<String, Totals> = BTreeMap::new();
    let mut by_team: BTreeMap<i64, Totals> = BTreeMap::new();
    let mut team_sizes: BTreeMap<i64, i64> = BTreeMap::new();
    let mut round_kills: Vec<i64> = vec![0; rounds_meta.len()];
    let mut round_deaths: Vec<i64> = vec![0; rounds_meta.len()];
    let mut round_damage: Vec<f64> = vec![0.0; rounds_meta.len()];

    for identity in identities.values() {
        let entry = team_sizes.entry(identity.team_number).or_insert(0);
        *entry += 1;
    }

    // Kill / ölüm: intihar ve takım kill'i sayılmaz (JS modeli ile aynı kural).
    for death in &deaths {
        let steam_attacker = str_of(death.get("attacker_steamid"));
        let steam_victim = str_of(death.get("user_steamid"));
        let suicide = steam_attacker.is_empty()
            || steam_attacker == steam_victim
            || death
                .get("suicide")
                .map(|value| value == &Value::Bool(true))
                .unwrap_or(false);

        let attacker_team = identities.get(&steam_attacker).map(|entry| entry.team_number);
        let victim_team = identities.get(&steam_victim).map(|entry| entry.team_number);
        let team_kill = attacker_team.is_some() && attacker_team == victim_team;

        let index = round_index_for(&rounds_meta, i64_of(death.get("tick")));

        let victim_entry = by_player.entry(steam_victim.clone()).or_default();
        victim_entry.deaths += 1;
        if let Some(position) = index {
            round_deaths[position] += 1;
        }
        if let Some(team) = victim_team {
            let team_entry = by_team.entry(team).or_default();
            team_entry.deaths += 1;
        }

        if suicide || team_kill {
            continue;
        }

        let headshot = death
            .get("headshot")
            .map(|value| value == &Value::Bool(true))
            .unwrap_or(false);

        let attacker_entry = by_player.entry(steam_attacker.clone()).or_default();
        attacker_entry.kills += 1;
        if headshot {
            attacker_entry.headshots += 1;
        }
        if let Some(team) = attacker_team {
            let team_entry = by_team.entry(team).or_default();
            team_entry.kills += 1;
            if headshot {
                team_entry.headshots += 1;
            }
        }
        if let Some(position) = index {
            round_kills[position] += 1;
        }
    }

    // Hasar: ADR = toplam hasar / round sayısı
    for event in &damages {
        let steam_attacker = str_of(event.get("attacker_steamid"));
        let amount = f64_of(event.get("dmg_health")) + f64_of(event.get("dmg_armor"));
        if steam_attacker.is_empty() || amount <= 0.0 {
            continue;
        }
        let steam_victim = str_of(event.get("user_steamid"));
        let attacker_team = identities.get(&steam_attacker).map(|entry| entry.team_number);
        let victim_team = identities.get(&steam_victim).map(|entry| entry.team_number);
        // Friendly fire hasarı ADR'ye dahil edilmez (JS modeli ile aynı kural)
        if let (Some(attacker_side), Some(victim_side)) = (attacker_team, victim_team) {
            if attacker_side == victim_side {
                continue;
            }
        }

        let index = round_index_for(&rounds_meta, i64_of(event.get("tick")));

        let entry = by_player.entry(steam_attacker).or_default();
        entry.damage += amount;
        if let Some(team) = attacker_team {
            let team_entry = by_team.entry(team).or_default();
            team_entry.damage += amount;
        }
        if let Some(position) = index {
            round_damage[position] += amount;
        }
    }

    let player_json: Vec<Value> = identities
        .iter()
        .map(|(steam_id, identity)| {
            let totals = by_player.get(steam_id).copied().unwrap_or_default();
            let adr = if rounds_played > 0.0 {
                Some(round2(totals.damage / rounds_played))
            } else {
                None
            };
            let headshot_percent = percent(totals.headshots as f64, totals.kills as f64).map(round2);
            let kd = if totals.deaths > 0 {
                Some(round2(totals.kills as f64 / totals.deaths as f64))
            } else {
                None
            };
            json!({
                "steamId": steam_id.as_str(),
                "name": identity.name.clone(),
                "teamNumber": identity.team_number,
                "teamName": identity.team_name.clone(),
                "totals": {
                    "kills": totals.kills,
                    "deaths": totals.deaths,
                    "damage": round2(totals.damage),
                    "headshotKills": totals.headshots,
                    "headshotPercent": headshot_percent,
                    "adr": adr,
                    "kd": kd
                }
            })
        })
        .collect();

    let team_json: Vec<Value> = by_team
        .iter()
        .map(|(team_number, totals)| {
            let size = team_sizes.get(team_number).copied().unwrap_or(0) as f64;
            let adr = if rounds_played > 0.0 && size > 0.0 {
                Some(round2(totals.damage / rounds_played / size))
            } else {
                None
            };
            json!({
                "id": format!("team-{}", team_number),
                "teamNumber": team_number,
                "name": team_names.get(team_number).cloned().unwrap_or_default(),
                "score": Value::Null,
                "players": team_members.get(team_number).cloned().unwrap_or_default(),
                "playerCount": size as i64,
                "totals": {
                    "kills": totals.kills,
                    "deaths": totals.deaths,
                    "damage": round2(totals.damage),
                    "headshotKills": totals.headshots,
                    "headshotPercent": percent(totals.headshots as f64, totals.kills as f64).map(round2),
                    "adr": adr
                }
            })
        })
        .collect();

    let rounds_json: Vec<Value> = rounds_meta
        .iter()
        .enumerate()
        .map(|(index, round)| {
            let start = i64_of(round.get("startTick"));
            let end = i64_of(round.get("endTick"));
            let duration = ((end - start) as f64 / tick_rate).max(0.0);
            json!({
                "number": match round.get("number") {
                    Some(value) => i64_of(Some(value)),
                    None => (index + 1) as i64,
                },
                "startTick": start,
                "endTick": end,
                "freezeEndTick": round.get("freezeEndTick").cloned().unwrap_or(Value::Null),
                "durationSeconds": round2(duration),
                "kills": round_kills[index],
                "deaths": round_deaths[index],
                "damage": round2(round_damage[index]),
                // Round kazananı çıkarımı henüz JS'te (bkz. coverage.deferred)
                "winnerTeamNumber": Value::Null,
                "winnerSide": Value::Null
            })
        })
        .collect();

    let duration_seconds = {
        let value = f64_of(demo.get("durationSeconds"));
        if value > 0.0 {
            value
        } else {
            rounds_json
                .iter()
                .map(|round| f64_of(round.get("durationSeconds")))
                .sum()
        }
    };

    Ok(json!({
        "schemaVersion": SCHEMA_VERSION,
        "engine": "rust",
        "partial": true,
        "match": {
            "map": str_of(header.get("map_name")),
            "server": str_of(header.get("server_name")),
            "tickRate": tick_rate,
            "roundsPlayed": rounds_meta.len(),
            "durationSeconds": round2(duration_seconds),
            "maxTick": i64_of(demo.get("maxTick"))
        },
        "teams": team_json,
        "players": player_json,
        "rounds": rounds_json,
        "coverage": {
            "computed": [
                "match.meta",
                "rounds.count/duration/kills/deaths/damage",
                "players.kills/deaths/damage/adr/headshot",
                "teams.totals"
            ],
            "deferred": [
                "round winner inference",
                "entry / trade detection",
                "clutch detection",
                "KAST",
                "economy classification"
            ]
        }
    }))
}

/// IPC action sarmalayıcısı: `analysis_build`.
pub fn build(payload: &Value) -> Result<Value, String> {
    build_match_model(payload)
}

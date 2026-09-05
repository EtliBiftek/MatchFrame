'use strict';

/*
 * Test fixture üreticisi.
 *
 * Gerçek .dem dosyaları repoya girmez; bunun yerine demo-worker.cjs çıktısıyla
 * aynı şekle sahip küçük ve anonim JSON demolar üretilir.
 */

const TEAM_NUMBER = { T: 2, CT: 3 };

function defaultPlayers() {
  const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
  return names.map((name, index) => ({
    name,
    steamid: String(76561198000000001n + BigInt(index)),
    side: index < 5 ? 'T' : 'CT'
  }));
}

function makeDemo(options = {}) {
  const tickRate = options.tickRate || 64;
  const playerSpecs = options.players || defaultPlayers();
  const players = playerSpecs.map((spec, index) => ({
    name: spec.name || `player${index + 1}`,
    steamid: String(spec.steamid || 76561198000000001n + BigInt(index)),
    _inventory: spec.inventory || [],
    team_number: TEAM_NUMBER[spec.side] || 0,
    team_name: spec.team_name || '',
    _side: spec.side,
    _sidesByRound: spec.sidesByRound || null,
    _index: index
  }));

  const demo = {
    header: {
      map_name: options.map || 'de_mirage',
      server_name: options.server || 'Test Server',
      playback_ticks: 0,
      playback_time: 0
    },
    file: options.file || 'C:/demos/fixture.dem',
    players: players.map(({ _side, _sidesByRound, _index, ...rest }) => rest),
    roundStarts: [],
    rounds: [],
    roundMeta: [],
    deaths: [],
    plants: [],
    defuses: [],
    explosions: [],
    damage: options.omitDamage ? undefined : [],
    shots: options.omitShots ? undefined : [],
    impacts: options.omitImpacts ? undefined : [],
    blinds: options.omitBlinds ? undefined : [],
    freezeEnds: [],
    bomb: null,
    utility: {
      smokeStarts: [],
      smokeEnds: [],
      infernoStarts: [],
      infernoEnds: [],
      heDetonates: [],
      flashDetonates: [],
      playerBlinds: [],
      decoyStarts: [],
      decoyEnds: []
    },
    frames: [],
    maxTick: 0,
    tickRate,
    durationSeconds: 0,
    sampleStep: 8,
    bounds: { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
    cameraTracks: [],
    eventStatus: options.eventStatus || {}
  };

  const api = {
    demo,
    players,
    tickRate,

    sideOf(player, roundNumber) {
      const overrides = player._sidesByRound;
      if (overrides && overrides[roundNumber]) return overrides[roundNumber];
      return player._side;
    },

    addRound(config = {}) {
      const number = demo.roundStarts.length + 1;
      const startTick = config.startTick != null ? config.startTick : (computeRoundMeta(demo).at(-1)?.endTick ?? 0) + 64;
      const endTick = config.endTick != null ? config.endTick : startTick + (config.length ?? 1600);
      if (options.freezeTime != null || config.freezeTime != null) {
        const freezeTick = startTick + Number(config.freezeTime ?? options.freezeTime);
        demo.freezeEnds.push({ tick: freezeTick, total_rounds_played: number - 1 });
      }
      demo.roundStarts.push({ tick: startTick, total_rounds_played: number - 1, is_warmup_period: false, round_start_time: number * 2 });
      demo.maxTick = Math.max(demo.maxTick, endTick);
      demo.rounds.push({ tick: endTick, total_rounds_played: number });
      if (config.winner) {
        const last = demo.rounds[demo.rounds.length - 1];
        last.winner = TEAM_NUMBER[config.winner] || 0;
        last.reason = config.reason != null ? config.reason : 0;
      }
      // Round meta worker'da (buildRoundMeta) üretilir; fixture da aynı şekli taklit eder.
      demo.roundMeta = computeRoundMeta(demo);
      return number;
    },

    round(number) {
      return demo.roundMeta.find((meta) => meta.number === number) || null;
    },

    actor(value) {
      if (!value) return { steamid: '', name: '' };
      if (typeof value === 'string') {
        const player = players.find((candidate) => candidate.steamid === value);
        return { steamid: value, name: player ? player.name : value };
      }
      return { steamid: value.steamid, name: value.name };
    },

    addKill(config) {
      const attacker = api.actor(config.attacker);
      const victim = api.actor(config.victim);
      const assister = api.actor(config.assister);
      demo.deaths.push({
        tick: config.tick,
        total_rounds_played: config.round != null ? config.round - 1 : undefined,
        attacker_steamid: attacker.steamid,
        attacker_name: attacker.name,
        user_steamid: victim.steamid,
        user_name: victim.name,
        assister_steamid: assister.steamid || undefined,
        assister_name: assister.name || undefined,
        assistedflash: config.assistedflash ? true : undefined,
        weapon: config.weapon || 'ak47',
        headshot: config.headshot ? true : false,
        penetrated: false,
        noscope: false,
        thrusmoke: false,
        attackerblind: false,
        attackerinair: false,
        user_X: Number.isFinite(config.x) ? config.x : 100,
        user_Y: Number.isFinite(config.y) ? config.y : 100,
        user_Z: 0
      });
      return api;
    },

    addDamage(config) {
      if (!demo.damage) return api;
      const attacker = api.actor(config.attacker);
      const victim = api.actor(config.victim);
      demo.damage.push({
        tick: config.tick,
        attacker_steamid: attacker.steamid,
        attacker_name: attacker.name,
        user_steamid: victim.steamid,
        user_name: victim.name,
        weapon: config.weapon || 'ak47',
        dmg_health: config.damage != null ? config.damage : 27,
        dmg_armor: 0,
        hitgroup: config.headshot ? 1 : 2,
        user_X: 0,
        user_Y: 0,
        user_Z: 0
      });
      return api;
    },

    addShot(config) {
      if (!demo.shots) return api;
      const actor = api.actor(config.player || config.attacker);
      demo.shots.push({
        tick: config.tick,
        user_steamid: actor.steamid,
        user_name: actor.name,
        weapon: config.weapon || 'ak47',
        silenced: false
      });
      return api;
    },

    addImpact(config) {
      if (!demo.impacts) return api;
      const actor = api.actor(config.player || config.attacker);
      demo.impacts.push({
        tick: config.tick,
        user_steamid: actor.steamid,
        user_name: actor.name,
        X: config.x != null ? config.x : 0,
        Y: config.y != null ? config.y : 0,
        Z: config.z != null ? config.z : 0
      });
      return api;
    },

    addPurchase(config) {
      const actor = api.actor(config.player);
      demo.purchases = demo.purchases || [];
      demo.purchases.push({
        tick: config.tick,
        user_steamid: actor.steamid,
        user_name: actor.name,
        weapon: config.weapon || 'ak47',
        cost: config.cost != null ? config.cost : 2700,
        team: config.team != null ? config.team : TEAM_NUMBER[api.sideOf(
          api.players.find((candidate) => candidate.steamid === actor.steamid) || {},
          config.round || 1
        )] || 0,
        total_rounds_played: config.round != null ? config.round - 1 : undefined
      });
      return api;
    },

    addDisconnect(config) {
      const actor = api.actor(config.player);
      demo.disconnects = demo.disconnects || [];
      demo.disconnects.push({
        tick: config.tick,
        user_steamid: actor.steamid,
        user_name: actor.name,
        reason: config.reason || 'disconnect'
      });
      return api;
    },

    addPlant(config) {
      const actor = api.actor(config.player);
      const event = { tick: config.tick, user_steamid: actor.steamid, user_name: actor.name, user_X: 500, user_Y: 500, user_Z: 0 };
      demo.plants.push(event);
      return api;
    },

    addDefuse(config) {
      const actor = api.actor(config.player);
      demo.defuses.push({ tick: config.tick, user_steamid: actor.steamid, user_name: actor.name, user_X: 500, user_Y: 500, user_Z: 0 });
      return api;
    },

    addExplosion(config = {}) {
      demo.explosions.push({ tick: config.tick, user_X: 500, user_Y: 500, user_Z: 0 });
      return api;
    },

    addUtility(config) {
      const actor = api.actor(config.player);
      const event = {
        tick: config.tick,
        user_steamid: actor.steamid,
        user_name: actor.name,
        user_X: config.x != null ? config.x : 0,
        user_Y: config.y != null ? config.y : 0,
        user_Z: 0
      };
      const map = {
        smoke: 'smokeStarts',
        smokeEnd: 'smokeEnds',
        molotov: 'infernoStarts',
        molotovEnd: 'infernoEnds',
        he: 'heDetonates',
        flash: 'flashDetonates',
        decoy: 'decoyStarts',
        decoyEnd: 'decoyEnds'
      };
      const key = map[config.kind];
      if (key) demo.utility[key].push(event);
      return api;
    },

    addBlind(config) {
      const blind = {
        tick: config.tick,
        user_steamid: api.actor(config.victim).steamid,
        user_name: api.actor(config.victim).name,
        blind_duration: config.duration != null ? config.duration : 2.1
      };
      if (!config.noAttacker) {
        blind.attacker_steamid = api.actor(config.attacker).steamid;
        blind.attacker_name = api.actor(config.attacker).name;
      }
      if (!demo.blinds) demo.utility.playerBlinds.push(blind);
      else demo.blinds.push(blind);
      return api;
    },

    /* Sadece round başlarında frame üretir; fixture dosyalarını küçük tutar. */
    buildRoundStartFrames(perRound = 2, offset = 16) {
      const frames = [];
      for (const meta of demo.roundMeta) {
        for (let i = 0; i < perRound; i++) {
          const tick = meta.startTick + offset * (i + 1);
          if (tick > meta.endTick) continue;
          frames.push({
            tick,
            players: api.players.map((player, index) => ({
              steamid: player.steamid,
              name: player.name,
              X: -800 + index * 160,
              Y: -400 + (index % 3) * 120,
              Z: 0,
              pitch: 0,
              yaw: (index * 37) % 360,
              fov: 90,
              duck_amount: 0,
              in_crouch: false,
              health: 100,
              armor: 100,
              is_alive: true,
              team_num: TEAM_NUMBER[api.sideOf(player, meta.number)] || 0,
              team_name: '',
              team_clan_name: '',
              player_color: '',
              active_weapon_name: 'weapon_ak47',
              active_weapon_ammo: 30,
              total_ammo_left: 90,
              flash_duration: 0,
              inventory: player._inventory || [],
              has_c4: false
            }))
          });
        }
      }
      demo.frames = frames;
      return api;
    },

    /*
     * Oyuncunun konum/kamera hareketini keyframe'lerle tanımlar (aim testleri için).
     * setTrack(player, [{ tick, x, y, z, yaw, pitch }, ...])
     */
    setTrack(player, keyframes = []) {
      const steamid = api.actor(player).steamid;
      const target = api.players.find((candidate) => candidate.steamid === steamid);
      if (target) target._track = [...keyframes].sort((a, b) => a.tick - b.tick);
      return api;
    },

    /* Track'ten verilen tick için ara değer (linear interpolation). */
    sampleTrack(player, tick) {
      const track = player?._track;
      if (!track || !track.length) return null;
      if (tick <= track[0].tick) return { ...track[0] };
      const last = track[track.length - 1];
      if (tick >= last.tick) return { ...last };
      for (let index = 1; index < track.length; index += 1) {
        const previous = track[index - 1];
        const next = track[index];
        if (tick >= previous.tick && tick <= next.tick) {
          const ratio = (tick - previous.tick) / ((next.tick - previous.tick) || 1);
          const mix = (key, fallback = 0) => {
            const from = previous[key] != null ? previous[key] : fallback;
            const to = next[key] != null ? next[key] : from;
            return from + (to - from) * ratio;
          };
          return {
            tick,
            x: mix('x'), y: mix('y'), z: mix('z'),
            yaw: mix('yaw'), pitch: mix('pitch')
          };
        }
      }
      return { ...last };
    },

    /* Sadece analiz için gereken alanları taşır; fixture boyutunu küçük tutar. */
    slimPlayer(player, index, state) {
      return {
        steamid: player.steamid,
        name: player.name,
        X: state.X,
        Y: state.Y,
        Z: state.Z,
        yaw: state.yaw,
        pitch: state.pitch,
        fov: 90,
        health: state.health,
        is_alive: state.is_alive,
        team_num: state.team_num,
        inventory: state.inventory,
        has_c4: state.has_c4
      };
    },

    /* Tick state'ini (radar frame'leri) üretir. Taraf tespiti bu veriden yapılır. */
    buildFrames(step = 8, options = {}) {
      const frames = [];
      if (!demo.roundMeta.length) demo.roundMeta = computeRoundMeta(demo);
      if (!demo.roundMeta.length) return api;
      const lastTick = demo.maxTick;
      for (let tick = 0; tick <= lastTick; tick += step) {
        const meta = [...demo.roundMeta].reverse().find((round) => tick >= round.startTick) || demo.roundMeta[0];
        const players = api.players.map((player, index) => {
          const sampled = api.sampleTrack(player, tick);
          return {
            steamid: player.steamid,
            name: player.name,
            X: sampled ? sampled.x : -800 + index * 160,
            Y: sampled ? sampled.y : -400 + (index % 3) * 120,
            Z: sampled ? sampled.z : 0,
            pitch: sampled ? sampled.pitch : 0,
            yaw: sampled ? sampled.yaw : (index * 37) % 360,
            fov: 90,
            duck_amount: 0,
            in_crouch: false,
            health: 100,
            armor: 100,
            is_alive: true,
            team_num: TEAM_NUMBER[api.sideOf(player, meta.number)] || 0,
            team_name: '',
            team_clan_name: '',
            player_color: '',
            active_weapon_name: 'weapon_ak47',
            active_weapon_ammo: 30,
            total_ammo_left: 90,
            flash_duration: 0,
            inventory: player._inventory || [],
            has_c4: false
          };
        });
        frames.push({ tick, players: options.slim ? players.map((state, i) => api.slimPlayer(api.players[i], i, state)) : players });
      }
      demo.frames = frames;
      return api;
    },

    finalize() {
      demo.durationSeconds = demo.maxTick / tickRate;
      demo.purchases = demo.purchases || [];
      demo.disconnects = demo.disconnects || [];
      if (!demo.frames.length) api.buildFrames();
      demo.bomb = {
        plants: demo.plants,
        defuses: demo.defuses,
        explosions: demo.explosions,
        drops: [],
        pickups: []
      };
      return demo;
    }
  };

  return api;
}

function computeRoundMeta(demo) {
  const starts = [...demo.roundStarts]
    .map((event) => ({ tick: Number(event.tick) || 0, played: Number(event.total_rounds_played) }))
    .sort((a, b) => a.tick - b.tick);
  const ends = [...demo.rounds].map((event) => Number(event.tick) || 0).filter((tick) => tick > 0).sort((a, b) => a - b);
  const freeze = [...demo.freezeEnds].map((event) => Number(event.tick) || 0).filter((tick) => tick > 0).sort((a, b) => a - b);

  return starts.map((start, index) => {
    const nextStart = starts[index + 1]?.tick;
    const matchingEnd = ends.find((end) => end >= start.tick && (nextStart == null || end < nextStart));
    const endTick = matchingEnd ?? (nextStart != null ? Math.max(start.tick, nextStart - 1) : demo.maxTick);
    const upper = nextStart != null ? nextStart : endTick + 1;
    const freezeEndTick = freeze.find((tick) => tick > start.tick && tick < upper) ?? null;
    return {
      number: Number.isFinite(start.played) ? start.played + 1 : index + 1,
      startTick: start.tick,
      endTick: Math.max(start.tick, endTick),
      freezeEndTick
    };
  });
}

module.exports = { makeDemo, defaultPlayers, TEAM_NUMBER };

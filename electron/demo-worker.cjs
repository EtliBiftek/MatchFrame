const { parentPort } = require('node:worker_threads');
const { parseHeader, parsePlayerInfo, parseEvent } = require('@laihoe/demoparser2');

parentPort.on('message', ({ file }) => {
  try {
    const header = parseHeader(file);
    const players = parsePlayerInfo(file);
    let rounds = [];
    let deaths = [];
    try { rounds = parseEvent(file, 'round_end', [], []); } catch (_) {}
    try { deaths = parseEvent(file, 'player_death', [], []); } catch (_) {}
    const ticks = [...rounds, ...deaths]
      .map((event) => Number(event.tick || 0))
      .filter(Number.isFinite);
    const maxTick = ticks.length ? Math.max(...ticks) : 0;
    parentPort.postMessage({ ok: true, data: { header, players, rounds, deaths, maxTick } });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error?.stack || String(error) });
  }
});

(() => {
  const style = document.createElement('style');
  style.textContent = `
    body.demo-unloaded .workspace-head,body.demo-unloaded .viewer-grid{display:none!important}
    body.demo-unloaded .workspace{position:relative}
    .demo-landing{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px;transition:opacity .28s ease,transform .28s ease}
    .demo-landing.leaving{opacity:0;transform:scale(.985)}
    .demo-landing-card{width:min(560px,92vw);padding:42px 38px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg,rgba(26,26,31,.92),rgba(18,18,22,.96));box-shadow:0 24px 80px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.025);text-align:center}
    .demo-landing-mark{width:64px;height:64px;margin:0 auto 18px;border-radius:15px;display:grid;place-items:center;background:#202127;border:1px solid #2d2f36;color:var(--accent);font-size:14px;font-weight:750;letter-spacing:.05em;box-shadow:0 10px 30px rgba(0,0,0,.2)}
    .demo-landing h2{margin:0 0 8px;font-size:24px;font-weight:620;letter-spacing:-.03em}
    .demo-landing p{margin:0 auto;color:var(--muted);font-size:12px;line-height:1.65;max-width:430px}
    .demo-open{margin-top:24px;height:42px;min-width:150px;padding:0 20px;border:0;border-radius:8px;background:var(--fg);color:var(--bg);font-size:12px;font-weight:700}
    .demo-open:hover:not(:disabled){filter:brightness(1.08)}.demo-open:disabled{opacity:.55;cursor:wait}
    .demo-progress{display:none;margin:24px auto 0;max-width:390px}.demo-progress.show{display:block}.demo-progress-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:10px;color:var(--muted)}.demo-progress-head strong{color:var(--fg);font:600 10px Consolas,monospace}.demo-progress-track{height:5px;border-radius:999px;background:#24242a;overflow:hidden;border:1px solid rgba(255,255,255,.04)}.demo-progress-fill{height:100%;width:0;background:var(--accent);border-radius:inherit;transition:width .16s ease}.demo-progress-stage{margin-top:7px!important;font-size:9px!important;color:var(--subtle)!important;text-align:left}
    .demo-landing-meta{display:flex;justify-content:center;gap:14px;margin-top:18px;color:var(--subtle);font-size:9px}.demo-landing-meta span{padding:5px 8px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.015)}
    body.demo-ready .viewer-grid{animation:replayIn .38s cubic-bezier(.2,.8,.2,1) both}body.demo-ready .workspace-head{animation:replayHeadIn .32s ease both}
    @keyframes replayIn{from{opacity:0;transform:translateY(14px) scale(.992)}to{opacity:1;transform:none}}@keyframes replayHeadIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  `;
  document.head.appendChild(style);

  const workspace = document.querySelector('.workspace');
  const statusbar = document.querySelector('.statusbar');
  const realOpen = document.getElementById('openBtn');
  if (!workspace || !realOpen) return;

  document.body.classList.add('demo-unloaded');
  const landing = document.createElement('section');
  landing.className = 'demo-landing';
  landing.innerHTML = `<div class="demo-landing-card"><div class="demo-landing-mark">MF</div><h2>Replay yükle</h2><p>Demo dosyanı seç. MatchFrame radar replay, gerçek POV, timeline ve oyuncu verilerini hazırlasın.</p><button id="landingOpenBtn" class="demo-open" type="button">Demo seç</button><div id="demoProgress" class="demo-progress"><div class="demo-progress-head"><span>Demo hazırlanıyor</span><strong id="demoProgressPercent">0%</strong></div><div class="demo-progress-track"><div id="demoProgressFill" class="demo-progress-fill"></div></div><p id="demoProgressStage" class="demo-progress-stage">Parser bekleniyor…</p></div><div class="demo-landing-meta"><span>.dem</span><span>Radar replay</span><span>Gerçek POV</span></div></div>`;
  workspace.insertBefore(landing, statusbar || null);

  const button = document.getElementById('landingOpenBtn');
  const progress = document.getElementById('demoProgress');
  const fill = document.getElementById('demoProgressFill');
  const percent = document.getElementById('demoProgressPercent');
  const stage = document.getElementById('demoProgressStage');
  let progressValue = 0;
  let completed = false;
  let receivedRealProgress = false;

  function setProgress(value, text) {
    progressValue = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    fill.style.width = `${progressValue}%`;
    percent.textContent = `${progressValue}%`;
    if (text) stage.textContent = text;
  }

  function resetProgress() {
    receivedRealProgress = false;
    progress.classList.remove('show');
    setProgress(0, 'Parser bekleniyor…');
  }

  const unsubscribeProgress = window.matchframe?.demo?.onProgress?.((payload) => {
    if (completed || !payload) return;
    receivedRealProgress = true;
    progress.classList.add('show');
    setProgress(payload.percent, payload.stage || 'Demo hazırlanıyor…');
  });

  window.addEventListener('beforeunload', () => unsubscribeProgress?.(), { once: true });

  button.onclick = () => realOpen.click();
  new MutationObserver(() => {
    button.disabled = realOpen.disabled;
    button.textContent = realOpen.disabled ? (receivedRealProgress ? 'Demo hazırlanıyor…' : 'Dosya seçiliyor…') : 'Demo seç';
    if (!realOpen.disabled && !completed && progressValue < 100) resetProgress();
  }).observe(realOpen, { attributes: true, childList: true, subtree: true });

  const originalLoadDemo = loadDemo;
  loadDemo = function(result) {
    completed = true;
    progress.classList.add('show');
    setProgress(100, 'Hazır. Replay açılıyor…');
    setTimeout(() => {
      landing.classList.add('leaving');
      setTimeout(() => {
        originalLoadDemo(result);
        document.body.classList.remove('demo-unloaded');
        document.body.classList.add('demo-ready');
        landing.remove();
        unsubscribeProgress?.();
        setTimeout(() => document.body.classList.remove('demo-ready'), 500);
      }, 260);
    }, 180);
  };
})();

(() => {
  const style = document.createElement('style');
  style.textContent = `
    body.demo-unloaded .workspace-head,body.demo-unloaded .viewer-grid{display:none!important}
    body.demo-unloaded .workspace{position:relative}
    .demo-landing{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px}
    .demo-landing-card{width:min(560px,92vw);padding:42px 38px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg,rgba(26,26,31,.92),rgba(18,18,22,.96));box-shadow:0 24px 80px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.025);text-align:center}
    .demo-landing-mark{width:64px;height:64px;margin:0 auto 18px;border-radius:15px;display:grid;place-items:center;background:#202127;border:1px solid #2d2f36;color:var(--accent);font-size:14px;font-weight:750;letter-spacing:.05em;box-shadow:0 10px 30px rgba(0,0,0,.2)}
    .demo-landing h2{margin:0 0 8px;font-size:24px;font-weight:620;letter-spacing:-.03em}
    .demo-landing p{margin:0 auto;color:var(--muted);font-size:12px;line-height:1.65;max-width:430px}
    .demo-open{margin-top:24px;height:42px;min-width:150px;padding:0 20px;border:0;border-radius:8px;background:var(--fg);color:var(--bg);font-size:12px;font-weight:700}
    .demo-open:hover:not(:disabled){filter:brightness(1.08)}.demo-open:disabled{opacity:.55;cursor:wait}
    .demo-landing-meta{display:flex;justify-content:center;gap:14px;margin-top:18px;color:var(--subtle);font-size:9px}
    .demo-landing-meta span{padding:5px 8px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.015)}
    body.demo-ready .viewer-grid{animation:replayIn .34s cubic-bezier(.2,.8,.2,1) both}
    body.demo-ready .workspace-head{animation:replayHeadIn .28s ease both}
    @keyframes replayIn{from{opacity:0;transform:translateY(14px) scale(.992)}to{opacity:1;transform:none}}
    @keyframes replayHeadIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  `;
  document.head.appendChild(style);

  const workspace = document.querySelector('.workspace');
  const statusbar = document.querySelector('.statusbar');
  const realOpen = document.getElementById('openBtn');
  if (!workspace || !realOpen) return;

  document.body.classList.add('demo-unloaded');
  const landing = document.createElement('section');
  landing.className = 'demo-landing';
  landing.innerHTML = `<div class="demo-landing-card"><div class="demo-landing-mark">MF</div><h2>Replay yükle</h2><p>CS2 demo dosyanı seç. MatchFrame radar replay, gerçek POV, timeline ve oyuncu verilerini hazırlasın.</p><button id="landingOpenBtn" class="demo-open" type="button">Demo seç</button><div class="demo-landing-meta"><span>.dem</span><span>Radar replay</span><span>Gerçek POV</span></div></div>`;
  workspace.insertBefore(landing, statusbar || null);

  const button = document.getElementById('landingOpenBtn');
  button.onclick = () => realOpen.click();
  new MutationObserver(() => {
    button.disabled = realOpen.disabled;
    button.textContent = realOpen.disabled ? 'Demo hazırlanıyor…' : 'Demo seç';
  }).observe(realOpen, { attributes: true, childList: true, subtree: true });

  const originalLoadDemo = loadDemo;
  loadDemo = function(result) {
    originalLoadDemo(result);
    document.body.classList.remove('demo-unloaded');
    document.body.classList.add('demo-ready');
    landing.remove();
    setTimeout(() => document.body.classList.remove('demo-ready'), 450);
  };
})();

/*
 * jsdom tabanlı entegrasyon harness'ı.
 *
 * ui/index.html içindeki scriptleri GERÇEK klasik script sırasıyla yükler
 * (let/const global bağlamı korunur), Electron IPC katmanını (window.matchframe)
 * taklit eder ve fixture demo yükleyerek sol panel ekranlarını gerçek DOM
 * üzerinde test etmeyi sağlar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const UI_DIR = path.join(ROOT, 'ui');

/* Babylon/POV scriptleri tarayıcı motoru gerektirir; entegrasyon testinde atlanır. */
const SKIP = new Set([
  'pov.js',
  'pov-world.js',
  'pov-stability.js',
  'babylon.js',
  'babylonjs.loaders.min.js'
]);

function fakeContext(canvas) {
  const gradient = { addColorStop() {} };
  const base = {
    canvas,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {},
    setTransform() {},
    save() {},
    restore() {}
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => gradient;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function installStubs(window) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return fakeContext(this);
  };
  window.HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function pause() {};

  const ipcCalls = [];
  window.matchframe = {
    window: { minimize: () => {}, maximize: () => {}, close: () => {} },
    demo: {
      open: async () => {
        ipcCalls.push('demo:open');
        return { canceled: true };
      },
      onProgress: () => () => {}
    },
    radar: { load: async () => { throw new Error('radar test stub'); } },
    pov: { prepare: async () => { throw new Error('pov test stub'); } },
    voice: { prepare: async () => ({ available: false, tracks: [] }) },
    core: {
      status: async () => ({ ok: true, data: { version: 'test' } }),
      command: async () => ({ ok: true }),
      request: async () => ({ ok: true, data: { running: false } })
    }
  };
  return ipcCalls;
}

function loadScript(window, src) {
  return new Promise((resolve) => {
    const script = window.document.createElement('script');
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    script.onload = () => finish({ src, ok: true });
    script.onerror = () => finish({ src, ok: false, error: 'yüklenemedi' });
    script.src = src;
    window.document.body.appendChild(script);
    setTimeout(() => finish({ src, ok: false, error: 'zaman aşımı' }), 15000);
  });
}

/* Test düşerse pencere kapanmayabilir; süreç çıkışında hepsini kapat. */
const openWindows = new Set();
process.on('exit', () => {
  for (const window of openWindows) {
    try {
      window.close();
    } catch (_) { /* yoksay */ }
  }
  openWindows.clear();
});

export async function boot(options = {}) {
  const indexPath = path.join(UI_DIR, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const sources = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((match) => match[1]);
  const stripped = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    const message = String(error?.message || error);
    if (/Could not load script|Not implemented|Could not load link/i.test(message)) return;
    errors.push({ file: error?.detail?.sourceName || 'jsdom', error: error?.detail || new Error(message) });
  });

  const dom = new JSDOM(stripped, {
    url: pathToFileURL(indexPath).href,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  openWindows.add(window);
  const ipcCalls = installStubs(window);

  const loadResults = [];
  for (const src of sources) {
    const name = path.basename(src);
    if (SKIP.has(name) || src.startsWith('http')) continue;
    const result = await loadScript(window, src);
    loadResults.push(result);
    if (!result.ok) errors.push({ file: src, error: new Error(`script yüklenemedi: ${result.error}`) });
  }

  // Script'ler dinamik eklendiği için DOMContentLoaded çoktan geçmiş olabilir.
  window.MF?.navigation?.init?.();

  const harness = {
    dom,
    window,
    document: window.document,
    MF: window.MF,
    errors,
    loadResults,
    ipcCalls,

    fixture(name) {
      return JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', `${name}.json`), 'utf8'));
    },

    /* landing.js loadDemo'yu geciktirerek çağırır; testlerde bu zinciri bekle. */
    loadDemo(demo) {
      window.loadDemo(demo);
      return new Promise((resolve) => {
        setTimeout(() => resolve(window.MF.store.getModel()), 600);
      });
    },

    click(selector) {
      const node = typeof selector === 'string' ? window.document.querySelector(selector) : selector;
      if (!node) throw new Error(`tıklanacak öğe yok: ${selector}`);
      node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      return node;
    },

    setSelect(selector, value) {
      const node = typeof selector === 'string' ? window.document.querySelector(selector) : selector;
      if (!node) throw new Error(`select yok: ${selector}`);
      node.value = String(value);
      node.dispatchEvent(new window.Event('change', { bubbles: true }));
      return node;
    },

    go(viewId) {
      window.MF.navigation.go(viewId);
      return window.MF.navigation.current();
    },

    activeView() {
      return window.document.querySelector('.view.is-active')?.dataset.view || null;
    },

    text(selector) {
      return window.document.querySelector(selector)?.textContent?.trim() || '';
    },

    close() {
      window.close();
      openWindows.delete(window);
    }
  };

  if (options.autoLoad) {
    harness.loadDemo(options.autoLoad === true ? harness.fixture('basic-match') : options.autoLoad);
  }

  return harness;
}

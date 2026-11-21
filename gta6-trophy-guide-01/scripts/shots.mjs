// Screenshot + smoke-test driver for the GTA 6 trophy guide.
// Launches the Playwright Chromium binary headless, drives it over CDP with Node's built-in
// WebSocket, visits each shot in shots.json at 1280x800, prints page errors, and saves JPEGs.
// Usage: node scripts/shots.mjs [shots.json] [base-url]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const shotsFile = process.argv[2] ?? join(repo, 'shots.json');
const base = process.argv[3] ?? 'http://localhost:8080';
const shots = JSON.parse(readFileSync(shotsFile, 'utf8'));
const chrome = join(homedir(), '.cache/ms-playwright/chromium-1187/chrome-linux/chrome');
const profile = '/tmp/gta6-shots-profile';
rmSync(profile, { recursive: true, force: true });

const chromeProc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1280,800', '--remote-debugging-port=9222',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://localhost:9222/json');
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chromium DevTools did not come up');
}

let idCounter = 0;
const pending = new Map();
let ws;
const errors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 500));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('CONSOLE: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500));
    }
    if (msg.method === 'Network.loadingFailed') {
      errors.push('NETFAIL: ' + (msg.params.errorText || ''));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const outDir = join(repo, 'screenshots');
  mkdirSync(outDir, { recursive: true });

  for (const shot of shots) {
    const url = base + shot.path;
    await send('Page.navigate', { url });
    await sleep(2500);
    if (shot.seedEarned) {
      await send('Runtime.evaluate', {
        expression: `localStorage.setItem('gta6-trophy-guide-v1', JSON.stringify({ earned: ${JSON.stringify(shot.seedEarned)}, spoiler: false })); location.reload();`,
      });
      await sleep(2500);
    } else {
      await send('Runtime.evaluate', { expression: `localStorage.clear(); location.reload();` });
      await sleep(2500);
    }
    if (shot.scrollTo) {
      await send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(shot.scrollTo)})?.scrollIntoView();`,
      });
      await sleep(600);
    }
    const evalResult = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        trophies: document.querySelectorAll('.trophy').length,
        progress: document.getElementById('progressText')?.textContent,
        detailOpen: !document.getElementById('detail')?.hidden,
        scrollH: document.body.scrollHeight
      })`,
      returnByValue: true,
    });
    console.log(shot.file, url, '->', evalResult.result.value);
    const shotResult = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(join(outDir, shot.file), Buffer.from(shotResult.data, 'base64'));
  }
  console.log('page errors:', errors.length ? errors : 'none');
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  chromeProc.kill();
}

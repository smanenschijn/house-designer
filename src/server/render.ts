import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { createSession, deleteSession, type PublicUser } from './auth';
import { COOKIE } from './authRoutes';

/**
 * Schermafbeeldingen voor Claude: opent de app in een headless Chromium (WebGL via SwiftShader),
 * met een tijdelijke sessie van de gebruiker, en maakt een PNG van de gevraagde weergave.
 */

export interface RenderOptions {
  /** alleen dit meubel tonen (voorvertoning), level/room worden dan genegeerd */
  item?: string;
  /** kijkhoogte in graden boven de horizon (voorvertoning) */
  elevation?: number;
  level: number;
  room?: string;
  camera: 'iso' | 'persp';
  azimuth: number;
  time?: string;
  date?: string;
}

const BASE = process.env.RENDER_BASE_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? process.env.PORT ?? 8787}`;

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p));
}

let browser: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getBrowser() {
  if (!browser) {
    const executablePath = chromePath();
    if (!executablePath) throw new Error('geen Chromium gevonden op de server (zet CHROME_PATH)');
    browser = puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
    });
    browser.catch(() => (browser = null));
  }
  return browser;
}

function scheduleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const b = browser;
    browser = null;
    (await b)?.close().catch(() => undefined);
  }, 90_000);
}

/** één render tegelijk (SwiftShader is zwaar) */
export function renderView(user: PublicUser, opts: RenderOptions): Promise<Buffer> {
  const run = queue.then(() => doRender(user, opts));
  queue = run.catch(() => undefined);
  return run;
}

async function doRender(user: PublicUser, opts: RenderOptions): Promise<Buffer> {
  const b = await getBrowser();
  const token = createSession(user.id, 5 * 60_000);
  const page = await b.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pagina: ${(e as Error).message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  try {
    await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
    await page.setCookie({ name: COOKIE, value: token, url: BASE });
    const params = encodeURIComponent(JSON.stringify(opts));
    await page.goto(`${BASE}/?render=${params}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
      await page.waitForFunction('window.__renderReady === true', { timeout: 60_000, polling: 250 });
    } catch {
      const state = await page
        .evaluate(() => {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl2');
          return { webgl2: !!gl, canvas: !!document.querySelector('canvas'), login: !!document.querySelector('.login'), url: location.href.slice(0, 80) };
        })
        .catch(() => null);
      throw new Error(`weergave niet klaar binnen 60 s. ${JSON.stringify(state)} ${[...new Set(problems)].slice(0, 4).join(' | ')}`);
    }
    const img = await page.screenshot({ type: 'jpeg', quality: 85 });
    return Buffer.from(img);
  } finally {
    await page.close().catch(() => undefined);
    deleteSession(token);
    scheduleClose();
  }
}

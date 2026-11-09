// Beelden van voor- en achtertuin via de rendermodus (headless Chromium).
// Gebruik: node scripts/garden-check.mjs <basis-url> <gebruiker> <wachtwoord> <uitvoermap>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const [base, user, pass, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[autocomplete="username webauthn"]', { timeout: 30000 });
await page.type('input[autocomplete="username webauthn"]', user);
await page.type('input[type="password"]', pass);
await page.click('button.primary');
await page.waitForSelector('canvas', { timeout: 30000 });

const shots = (process.env.SHOTS ?? 'achter-iso:0:tuin:iso:300,achter-3d:0:tuin:persp:200,voor-3d:0:voortuin:persp:20,voor-iso:2:voortuin:iso:340').split(',');
for (const s of shots) {
  const [name, level, room, camera, az] = s.split(':');
  const params = JSON.stringify({ level: Number(level), room, camera, azimuth: Number(az), time: '14:00', date: '2026-06-21' });
  await page.goto(`${base}/?render=${encodeURIComponent(params)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__renderReady === true', { timeout: 120000 }).catch(() => errors.push(`timeout ${name}`));
  await page.screenshot({ path: `${outDir}/g-${name}.jpg`, quality: 82 });
}
console.log(JSON.stringify({ errors: [...new Set(errors)].slice(0, 6) }));
await browser.close();

// Visuele controle van muur aantikken + behang (headless Chromium in de Docker-image).
// Gebruik: node scripts/wall-check.mjs <basis-url> <gebruiker> <wachtwoord> <uitvoermap> <x> <y>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const [base, user, pass, outDir, cx, cy] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 760 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.text().startsWith('pick') && console.log(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${base}/?debugpick=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[autocomplete="username webauthn"]', { timeout: 30000 });
await page.type('input[autocomplete="username webauthn"]', user);
await page.type('input[type="password"]', pass);
await page.click('button.primary');
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(12000);
await page.mouse.click(Number(cx), Number(cy));
await sleep(5000);
const bar = await page.evaluate(() => document.querySelector('.wallbar strong')?.textContent ?? null);
await page.screenshot({ path: `${outDir}/w1-muur-gekozen.jpg`, quality: 80 });
if (bar) {
  await page.evaluate(() => [...document.querySelectorAll('.wallbar button')].find((b) => b.textContent === 'Behang')?.click());
  await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll('.wallbar .paper')].find((b) => b.title === 'Botanisch')?.click());
  await sleep(9000);
  await page.screenshot({ path: `${outDir}/w2-behang.jpg`, quality: 80 });
}
console.log(JSON.stringify({ wallbar: bar, errors: [...new Set(errors)].slice(0, 5) }));
await browser.close();

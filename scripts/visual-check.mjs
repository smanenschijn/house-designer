// Visuele controle met headless Chromium (draait in de Docker-image).
// Gebruik: node scripts/visual-check.mjs <basis-url> <gebruiker> <wachtwoord> <uitvoermap>
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
await page.setViewport({ width: 1100, height: 760 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[autocomplete="username webauthn"]', { timeout: 30000 });
await page.type('input[autocomplete="username webauthn"]', user);
await page.type('input[type="password"]', pass);
await page.click('button.primary');
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(12000); // software-rendering: laden en eerste frames
await page.screenshot({ path: `${outDir}/1-start.jpg`, quality: 80 });

const click = async (label) => {
  await page.evaluate((l) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === l || b.title === l)?.click(), label);
};
await click('Draai rechtsom');
await sleep(8000);
await page.screenshot({ path: `${outDir}/2-gedraaid.jpg`, quality: 80 });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.title === 'Eerste verdieping')?.click());
await sleep(8000);
await page.screenshot({ path: `${outDir}/3-eerste-verdieping.jpg`, quality: 80 });
console.log(JSON.stringify({ errors: [...new Set(errors)].slice(0, 6) }));
await browser.close();

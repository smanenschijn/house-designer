// Controle bibliotheek en meubeleditor met 3D-modellen (headless Chromium).
// Gebruik: node scripts/model-ui-check.mjs <basis-url> <gebruiker> <wachtwoord> <uitvoermap> <glb-bestand>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const [base, user, pass, outDir, glb] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 820 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (sel, text) => page.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent.trim() === t)?.click(), sel, text);
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[autocomplete="username webauthn"]', { timeout: 30000 });
await page.type('input[autocomplete="username webauthn"]', user);
await page.type('input[type="password"]', pass);
await page.click('button.primary');
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(9000);
await page.click('.libbtn');
await sleep(5000);
await page.screenshot({ path: `${outDir}/u1-bibliotheek.jpg`, quality: 80 });
// bestaand Blender-model bewerken
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Testbank Blender'));
  [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Bewerken').click();
});
await sleep(4000);
await page.screenshot({ path: `${outDir}/u2-editor-model.jpg`, quality: 80 });
await clickText('button', 'Annuleren');
await sleep(800);
// nieuw meubel uit GLB
await clickText('button', 'Nieuw meubel');
await sleep(800);
await clickText('.seg button', '3D-model');
await sleep(300);
const input = await page.$('input[type="file"]');
await input.uploadFile(glb);
await sleep(3000);
await page.evaluate(() => {
  const i = [...document.querySelectorAll('.field')].find((f) => f.textContent.startsWith('Naam'))?.querySelector('input');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(i, 'UI-upload kubus');
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
await page.screenshot({ path: `${outDir}/u3-editor-nieuw.jpg`, quality: 80 });
await clickText('.panel-foot button', 'Opslaan');
await sleep(5000);
await page.screenshot({ path: `${outDir}/u4-na-opslaan.jpg`, quality: 80 });
const names = await page.evaluate(() => [...document.querySelectorAll('.card-title')].map((e) => e.textContent));
console.log(JSON.stringify({ names, errors: [...new Set(errors)].slice(0, 6) }));
await browser.close();

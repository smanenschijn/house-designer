// Controle bovenaanzicht, kamerfocus, pijltjes/spatie en lage binnenmuren (headless Chromium).
// Gebruik: node scripts/nav-check.mjs <basis-url> <gebruiker> <wachtwoord> <uitvoermap>
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: `${outDir}/${n}.jpg`, quality: 78 });
const clickBtn = (sel) => page.evaluate((s) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === s || b.title === s)?.click(), sel);

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[autocomplete="username webauthn"]', { timeout: 30000 });
await page.type('input[autocomplete="username webauthn"]', user);
await page.type('input[type="password"]', pass);
await page.click('button.primary');
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(10000);

await clickBtn('Bovenaanzicht');
await sleep(7000);
await shot('n1-boven');
await clickBtn('Focus op Woonkamer');
await sleep(7000);
const chip = await page.evaluate(() => document.querySelector('.focus-chip')?.textContent ?? null);
await shot('n2-focus');
// pijltje naar rechts 0,8 s ingedrukt
await page.mouse.click(5, 400); // focus op de pagina zonder iets te selecteren (lege rand)
await page.keyboard.down('ArrowRight');
await sleep(800);
await page.keyboard.up('ArrowRight');
await sleep(4000);
await shot('n3-pijl-rechts');
// spatie + pijltje links: draaien
await page.keyboard.down('Space');
await page.keyboard.down('ArrowLeft');
await sleep(900);
await page.keyboard.up('ArrowLeft');
await page.keyboard.up('Space');
await sleep(4000);
await shot('n4-spatie-draaien');
// focus opheffen, terug naar iso, alle muren laag
await clickBtn('Focus opheffen');
await clickBtn('Terug naar isometrisch');
await sleep(2000);
await clickBtn('Alle muren laag, ook binnenmuren');
await sleep(7000);
await shot('n5-laag');
console.log(JSON.stringify({ chip, errors: [...new Set(errors)].slice(0, 5) }));
await browser.close();

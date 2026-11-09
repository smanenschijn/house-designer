// Meet tijdens het slepen van de camera of de canvasresolutie verspringt en of er lege frames zijn.
// Gebruik: node scripts/flicker-check.mjs <basis-url> <gebruiker> <wachtwoord> <uitvoermap>
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
await page.setViewport({ width: 900, height: 640, deviceScaleFactor: Number(process.env.DPR ?? 2) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[autocomplete="username webauthn"]', { timeout: 30000 });
await page.type('input[autocomplete="username webauthn"]', user);
await page.type('input[type="password"]', pass);
await page.click('button.primary');
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(10000);

// canvasbreedte bemonsteren terwijl we slepen (pannen) met korte pauzes
await page.evaluate(() => {
  window.__widths = [];
  const c = document.querySelector('canvas');
  const tick = () => {
    window.__widths.push(c.width);
    if (window.__widths.length < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const shots = [];
await page.mouse.move(140, 560);
await page.mouse.down();
for (let i = 0; i < 12; i++) {
  await page.mouse.move(140 + (i % 2 ? -40 : 40), 560 - i * 6, { steps: 6 });
  if (i % 3 === 0) {
    await sleep(350); // korte pauze (zoals bij echt rondkijken)
    const buf = await page.screenshot({ type: 'jpeg', quality: 60, clip: { x: 300, y: 200, width: 300, height: 240 } });
    shots.push(buf.length);
  }
}
await page.mouse.up();
await sleep(1500);
const widths = await page.evaluate(() => window.__widths);
const distinct = [...new Set(widths)];
let switches = 0;
for (let i = 1; i < widths.length; i++) if (widths[i] !== widths[i - 1]) switches++;
await page.screenshot({ path: `${outDir}/f-eind.jpg`, quality: 70 });
console.log(JSON.stringify({ frames: widths.length, canvasBreedtes: distinct, wisselingen: switches, schermafbeeldingKB: shots.map((b) => Math.round(b / 1024)) }));
await browser.close();

// Spoort z-fighting op: overlappende vlakken in hetzelfde vlak, per verdieping (headless Chromium, dev-server).
// Gebruik: node scripts/zfight-check.mjs <basis-url> <gebruiker> <wachtwoord>
import puppeteer from 'puppeteer-core';

const [base, user, pass] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 760 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (label) =>
  page.evaluate((s) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === s || b.title === s || b.textContent.trim() === s)?.click(), label);
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[autocomplete="username webauthn"]', { timeout: 30000 });
await page.type('input[autocomplete="username webauthn"]', user);
await page.type('input[type="password"]', pass);
await page.click('button.primary');
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(8000);
for (const walls of (process.env.WALLS ?? 'Alle muren hoog').split(',')) {
  await click(walls);
  for (const lv of (process.env.LEVELS ?? 'BG,1e,Zolder,Buiten').split(',')) {
    await click(lv);
    await sleep(4000);
    const res = await page.evaluate(() => {
      window.dispatchEvent(new Event('hd-debug-zfight'));
      return JSON.parse(document.body.dataset.hdZfight ?? 'null');
    });
    console.log(`\n=== ${walls} / ${lv}: ${res === null ? 'geen meting' : res.length + ' paren'}`);
    for (const h of res ?? []) console.log(`${String(h.count).padStart(5)}  ${h.a}\n       ${h.b}\n       ${JSON.stringify(h.spots)}${process.env.FIRST ? '\n       ' + JSON.stringify(h.first) : ''}`);
  }
}
await browser.close();

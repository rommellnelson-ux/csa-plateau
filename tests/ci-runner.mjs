// Runner CI : ouvre tests.html dans Chromium (Playwright), attend la fin des
// tests et échoue (exit 1) si au moins un test est en échec.
import { chromium } from 'playwright';

const url = process.env.TEST_URL || 'http://localhost:8000/tests.html';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__TESTS__ !== undefined, { timeout: 30000 });
const res = await page.evaluate(() => window.__TESTS__);
await browser.close();

console.log('Résultats des tests :', JSON.stringify(res));
if (!res || res.fails > 0) {
  console.error(`❌ ${res ? res.fails : '??'} test(s) en échec`);
  process.exit(1);
}
console.log(`✅ Tous les tests passent (${res.total})`);

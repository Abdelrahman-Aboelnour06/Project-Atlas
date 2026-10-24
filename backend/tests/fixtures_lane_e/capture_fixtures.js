// backend/tests/fixtures_lane_e/capture_fixtures.js
// Captures real DOM serializer snapshots for WS12 Lane E backend tests

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function capture() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const demoSiteDir = path.join(repoRoot, 'demo-site');
  const outputDir = __dirname;
  const serializerScript = fs.readFileSync(path.join(repoRoot, 'client-script', 'dom-serializer.js'), 'utf8');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  async function getSerialized(url) {
    await page.goto(url);
    await page.evaluate(serializerScript);
    return await page.evaluate(() => window.AtlasSerializer.serialize());
  }

  console.log('Capturing fixtures...');

  // 1. portal_form_marked_required.json
  const url1 = 'file://' + path.join(demoSiteDir, 'portal-form-marked-required.html').replace(/\\/g, '/');
  const snap1 = await getSerialized(url1);
  fs.writeFileSync(path.join(outputDir, 'portal_form_marked_required.json'), JSON.stringify(snap1, null, 2), 'utf8');
  console.log('✓ Captured portal_form_marked_required.json');

  // 2. portal_form_with_errors.json (national_id filled, missing plate fields)
  await page.fill('#national_id', '00000000000000');
  await page.click('#btn-submit');
  const snap2 = await page.evaluate(() => window.AtlasSerializer.serialize());
  fs.writeFileSync(path.join(outputDir, 'portal_form_with_errors.json'), JSON.stringify(snap2, null, 2), 'utf8');
  console.log('✓ Captured portal_form_with_errors.json');

  // 3. portal_form_no_header.json
  const url3 = 'file://' + path.join(demoSiteDir, 'portal-form-no-header.html').replace(/\\/g, '/');
  const snap3 = await getSerialized(url3);
  fs.writeFileSync(path.join(outputDir, 'portal_form_no_header.json'), JSON.stringify(snap3, null, 2), 'utf8');
  console.log('✓ Captured portal_form_no_header.json');

  // 4. portal_form_no_tag.json
  const url4 = 'file://' + path.join(demoSiteDir, 'portal-form-no-tag.html').replace(/\\/g, '/');
  const snap4 = await getSerialized(url4);
  fs.writeFileSync(path.join(outputDir, 'portal_form_no_tag.json'), JSON.stringify(snap4, null, 2), 'utf8');
  console.log('✓ Captured portal_form_no_tag.json');

  // 5. portal_service_initial.json
  const url5 = 'file://' + path.join(demoSiteDir, 'portal-service-login.html').replace(/\\/g, '/');
  const snap5 = await getSerialized(url5);
  fs.writeFileSync(path.join(outputDir, 'portal_service_initial.json'), JSON.stringify(snap5, null, 2), 'utf8');
  console.log('✓ Captured portal_service_initial.json');

  // 6. portal_service_login_open.json (click start service CTA to toggle login modal)
  await page.click('#start-service-btn');
  const snap6 = await page.evaluate(() => window.AtlasSerializer.serialize());
  fs.writeFileSync(path.join(outputDir, 'portal_service_login_open.json'), JSON.stringify(snap6, null, 2), 'utf8');
  console.log('✓ Captured portal_service_login_open.json');

  // 7. portal_service_login_error.json (submit with invalid password)
  await page.fill('#login-id', '00000000000000');
  await page.fill('#login-pass', 'wrong_password');
  await page.click('#login-submit');
  const snap7 = await page.evaluate(() => window.AtlasSerializer.serialize());
  fs.writeFileSync(path.join(outputDir, 'portal_service_login_error.json'), JSON.stringify(snap7, null, 2), 'utf8');
  console.log('✓ Captured portal_service_login_error.json');

  // 8. portal_service_signup.json
  const url8 = 'file://' + path.join(demoSiteDir, 'portal-service-signup.html').replace(/\\/g, '/');
  const snap8 = await getSerialized(url8);
  fs.writeFileSync(path.join(outputDir, 'portal_service_signup.json'), JSON.stringify(snap8, null, 2), 'utf8');
  console.log('✓ Captured portal_service_signup.json');

  await browser.close();
  console.log('All fixtures captured successfully.');
}

capture().catch((err) => {
  console.error('Error capturing fixtures:', err);
  process.exit(1);
});

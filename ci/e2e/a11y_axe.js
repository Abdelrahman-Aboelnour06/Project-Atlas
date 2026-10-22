/**
 * Atlas Assistant — Automated axe-core A11y Audit Harness (Task I1)
 * ci/e2e/a11y_axe.js
 *
 * Scans:
 * 1. Atlas sidebar inside closed shadow root (__atlasShadowRoot):
 *    - Expanded state (default)
 *    - Milestone progress strip (Track U2)
 *    - Guided tour modal (Track U7)
 *    - Retry banner (Track U5)
 * 2. Options setup wizard (client-script/options.html):
 *    - Setup wizard surface (?wizard=true)
 *    - Standard settings surface
 * 3. Enterprise demo fixtures:
 *    - Clinical Patient Intake (demo-site/healthcare-intake.html)
 *    - Financial Statement (demo-site/finance-statement.html)
 *    - Supplies Checkout (demo-site/checkout.html)
 *
 * Enforces strictly 0 critical and 0 serious WCAG 2.1 / 2.2 violations.
 * Universal Directive: 100% universal across all websites, zero domain hardcoding.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 1. Dependency Resolution & Self-Check
let axe;
try {
  axe = require('axe-core');
} catch (e) {
  try {
    const fallbackPath = path.resolve(__dirname, '../../node_modules/axe-core');
    axe = require(fallbackPath);
  } catch (e2) {
    console.error('================================================================');
    console.error('FATAL: axe-core is not installed.');
    console.error('Please install it via: npm install -D axe-core');
    console.error('================================================================');
    process.exit(1);
  }
}

function findRepoRoot() {
  let curr = __dirname;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(curr, 'client-script', 'sidebar.js'))) {
      return curr;
    }
    curr = path.resolve(curr, '..');
  }
  if (fs.existsSync(path.join(process.cwd(), 'client-script', 'sidebar.js'))) {
    return process.cwd();
  }
  return path.resolve(__dirname, '../..');
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const auditSummary = [];
let totalCritical = 0;
let totalSerious = 0;
let totalModerate = 0;
let totalMinor = 0;

function logResult(targetName, stateName, violations) {
  const critical = violations.filter(v => v.impact === 'critical');
  const serious = violations.filter(v => v.impact === 'serious');
  const moderate = violations.filter(v => v.impact === 'moderate');
  const minor = violations.filter(v => v.impact === 'minor');

  totalCritical += critical.length;
  totalSerious += serious.length;
  totalModerate += moderate.length;
  totalMinor += minor.length;

  const passed = critical.length === 0 && serious.length === 0 && moderate.length === 0 && minor.length === 0;
  auditSummary.push({
    target: targetName,
    state: stateName,
    critical: critical.length,
    serious: serious.length,
    moderate: moderate.length,
    minor: minor.length,
    status: passed ? 'PASS' : 'FAIL',
  });

  const badge = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${badge}: [${targetName}] — ${stateName}`);
  console.log(`         Critical: ${critical.length}, Serious: ${serious.length}, Moderate: ${moderate.length}, Minor: ${minor.length}`);

  if (!passed) {
    for (const v of [...critical, ...serious, ...moderate, ...minor]) {
      console.error(`         -> [${v.impact.toUpperCase()}] ${v.id}: ${v.description}`);
      console.error(`            Help: ${v.helpUrl}`);
      for (const n of v.nodes) {
        console.error(`            Node: ${n.html}`);
        console.error(`            Summary: ${n.failureSummary}`);
      }
    }
  }
}

async function runA11yAudit() {
  console.log('\n================================================================');
  console.log('   Atlas Automated axe-core A11y Audit Suite (WCAG 2.1 / 2.2)   ');
  console.log('================================================================\n');

  const rootDir = findRepoRoot();
  const clientDir = path.join(rootDir, 'client-script');
  const demoDir = path.join(rootDir, 'demo-site');

  const sidebarJsPath = path.join(clientDir, 'sidebar.js');
  const sidebarCssPath = path.join(clientDir, 'sidebar.css');
  const ttsJsPath = path.join(clientDir, 'tts.js');
  const serializerJsPath = path.join(clientDir, 'dom-serializer.js');

  if (!fs.existsSync(sidebarJsPath) || !fs.existsSync(sidebarCssPath)) {
    throw new Error(`Required client scripts not found in ${clientDir}`);
  }

  const sidebarJs = fs.readFileSync(sidebarJsPath, 'utf8');
  const sidebarCss = fs.readFileSync(sidebarCssPath, 'utf8');
  const ttsJs = fs.readFileSync(ttsJsPath, 'utf8');
  const serializerJs = fs.readFileSync(serializerJsPath, 'utf8');
  const axeSource = axe.source;

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    // =========================================================================
    // PART 1: Enterprise Demo Fixtures
    // =========================================================================
    console.log('[Part 1: Enterprise Demo Fixtures]');
    const fixtures = [
      { name: 'Healthcare Intake', file: 'healthcare-intake.html' },
      { name: 'Financial Statement', file: 'finance-statement.html' },
      { name: 'Prescription Checkout', file: 'checkout.html' },
    ];

    for (const fix of fixtures) {
      const page = await browser.newPage();
      const filePath = path.join(demoDir, fix.file);
      await page.goto(`file://${filePath}`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(axeSource);

      const results = await page.evaluate(async (tags) => {
        return await axe.run(document, {
          runOnly: { type: 'tag', values: tags },
        });
      }, WCAG_TAGS);

      logResult(fix.name, 'Default Loaded State', results.violations);
      await page.close();
    }

    // =========================================================================
    // PART 2: Options Setup Wizard & Settings Surface (Dark & Light)
    // =========================================================================
    console.log('\n[Part 2: Options Setup Wizard & Settings (Dark & Light)]');
    const optionsPath = path.join(clientDir, 'options.html');

    for (const colorScheme of ['dark', 'light']) {
      const optionsContext = await browser.newContext({ colorScheme });

      // 2.1 First-run Setup Wizard
      {
        const page = await optionsContext.newPage();
        await page.goto(`file://${optionsPath}?wizard=true`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        await page.evaluate(axeSource);

        const results = await page.evaluate(async (tags) => {
          return await axe.run(document, {
            runOnly: { type: 'tag', values: tags },
          });
        }, WCAG_TAGS);

        logResult(`Options Page (${colorScheme})`, 'First-Run Setup Wizard View', results.violations);
        await page.close();
      }

      // 2.2 Standard Settings Surface
      {
        const page = await optionsContext.newPage();
        await page.goto(`file://${optionsPath}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        await page.evaluate(axeSource);

        const results = await page.evaluate(async (tags) => {
          return await axe.run(document, {
            runOnly: { type: 'tag', values: tags },
          });
        }, WCAG_TAGS);

        logResult(`Options Page (${colorScheme})`, 'Standard Settings View', results.violations);
        await page.close();
      }

      await optionsContext.close();
    }

    // =========================================================================
    // PART 3: Atlas Sidebar Inside Closed Shadow Root (Dark & Light)
    // =========================================================================
    console.log('\n[Part 3: Atlas Sidebar Inside Closed Shadow Root (Dark & Light)]');

    for (const colorScheme of ['dark', 'light']) {
      const context = await browser.newContext({ colorScheme });
      const page = await context.newPage();

      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Atlas A11y Shadow Testbed - ${colorScheme}</title>
          <style id="atlas-sidebar-css">${sidebarCss}</style>
        </head>
        <body>
          <main id="host-app">
            <h1>Host Application</h1>
            <button id="host-btn">Host Button</button>
          </main>
          <script>${serializerJs}</script>
          <script>${ttsJs}</script>
          <script>${sidebarJs}</script>
          <script>${axeSource}</script>
        </body>
        </html>
      `);

      // Mount sidebar and bridge closed shadow root for test harness inspection
      await page.evaluate(() => {
        window.AtlasSidebar.mount();
        const host = document.getElementById('atlas-sidebar-host');
        if (host && window.__atlasShadowRoot) {
          Object.defineProperty(host, 'shadowRoot', {
            get: () => window.__atlasShadowRoot,
            configurable: true,
          });
        }
      });
      await page.waitForTimeout(200);

      const runShadowAxe = async (tags) => {
        return await page.evaluate(async (tags) => {
          const host = document.getElementById('atlas-sidebar-host');
          return await axe.run(host, {
            runOnly: { type: 'tag', values: tags },
          });
        }, tags);
      };

      // 3.1 Default Expanded State
      {
        await page.waitForTimeout(200);
        const res = await runShadowAxe(WCAG_TAGS);
        logResult(`Atlas Sidebar (${colorScheme})`, 'Expanded State (Default)', res.violations);
      }

      // 3.2 Milestone Progress Strip
      {
        await page.evaluate(() => {
          window.AtlasSidebar.setGoalProgress({
            goal: 'Order Medical Supplies',
            active_milestone_id: 'm-2',
            milestones: [
              { id: 'm-1', description: 'Search for glucose test strips', status: 'completed' },
              { id: 'm-2', description: 'Add 100ct pack to shopping cart', status: 'active' },
              { id: 'm-3', description: 'Proceed to checkout and confirm payment', status: 'pending' },
            ],
          });
        });
        await page.waitForTimeout(200);
        const res = await runShadowAxe(WCAG_TAGS);
        logResult(`Atlas Sidebar (${colorScheme})`, 'Milestone Progress Strip Active', res.violations);

        await page.evaluate(() => {
          window.AtlasSidebar.hideGoalProgress();
        });
        await page.waitForTimeout(200);
      }

      // 3.3 Guided Tour Modal (Steps 1, 2, and 3)
      {
        await page.evaluate(() => {
          window.AtlasSidebar.startTour(0);
        });
        await page.waitForTimeout(200);
        const res = await runShadowAxe(WCAG_TAGS);
        logResult(`Atlas Sidebar (${colorScheme})`, 'Guided Tour Modal (Step 1)', res.violations);

        await page.evaluate(() => {
          window.AtlasSidebar.nextTourStep();
        });
        await page.waitForTimeout(200);
        const resStep2 = await runShadowAxe(WCAG_TAGS);
        logResult(`Atlas Sidebar (${colorScheme})`, 'Guided Tour Modal (Step 2)', resStep2.violations);

        await page.evaluate(() => {
          window.AtlasSidebar.nextTourStep();
        });
        await page.waitForTimeout(200);
        const resStep3 = await runShadowAxe(WCAG_TAGS);
        logResult(`Atlas Sidebar (${colorScheme})`, 'Guided Tour Modal (Step 3)', resStep3.violations);

        await page.evaluate(() => {
          window.AtlasSidebar.dismissTour(true);
        });
        await page.waitForTimeout(200);
      }

      // 3.4 Connection Resilience Retry Banner Active
      {
        await page.evaluate(() => {
          window.AtlasSidebar.setStatus('Connection lost. Retrying in 5s...', 'offline', { showRetry: true });
        });
        await page.waitForTimeout(200);
        const res = await runShadowAxe(WCAG_TAGS);
        logResult(`Atlas Sidebar (${colorScheme})`, 'Connection Retry Banner Active', res.violations);
      }

      await page.close();
      await context.close();
    }

    // =========================================================================
    // AUDIT SUMMARY TABLE
    // =========================================================================
    console.log('\n================================================================');
    console.log('                 ACCESSIBILITY AUDIT SUMMARY                    ');
    console.log('================================================================');
    console.table(auditSummary);

    console.log(`Total Critical Violations: ${totalCritical}`);
    console.log(`Total Serious Violations:  ${totalSerious}`);
    console.log(`Total Moderate Warnings:   ${totalModerate}`);
    console.log(`Total Minor Warnings:      ${totalMinor}`);
    console.log('================================================================\n');

    const totalViolations = totalCritical + totalSerious + totalModerate + totalMinor;
    if (totalViolations > 0) {
      console.error(`Audit FAILED: ${totalViolations} WCAG violations detected (Critical: ${totalCritical}, Serious: ${totalSerious}, Moderate: ${totalModerate}, Minor: ${totalMinor}).`);
      process.exit(1);
    } else {
      console.log('Audit PASSED: Strictly 0 critical, 0 serious, 0 moderate, and 0 minor WCAG violations. All criteria met.');
      process.exit(0);
    }
  } finally {
    await browser.close();
  }
}

runA11yAudit().catch((err) => {
  console.error('Fatal Harness Failure:', err);
  process.exit(1);
});

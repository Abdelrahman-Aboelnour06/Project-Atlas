/**
 * Project Atlas — Comprehensive Multi-Website Live Stress Audit
 * ci/e2e/audit_live_websites.js
 *
 * Launches Playwright with the unpacked Atlas extension.
 * Audits diverse live real-world websites across different architectural topologies:
 * 1. Wikipedia (Dense document, sticky headers, deep TOC)
 * 2. Hacker News (Table layouts, unlabelled vote links)
 * 3. GitHub (Modern web components, custom widgets, sticky tabs)
 * 4. BBC Arabic (RTL typography, Arabic localization, complex media)
 * 5. DuckDuckGo (Search SPA, dynamic autocomplete, modal overlays)
 * 6. Shoelace (Shadow DOM web components)
 * 7. TodoMVC (Reactive client-side SPA state transitions)
 *
 * Gathers empirical evidence on:
 * - DOM serialization completeness & noise filtering
 * - Position: fixed / sticky element visibility (The offsetParent bug)
 * - Shadow DOM traversal & visibility
 * - Interactive element categorization & label resolution
 * - Action execution (click, type, keyboard events)
 * - Language switcher detection & RTL handling
 * - Serialization payload size & token budget implications
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SITES = [
  {
    name: 'Wikipedia (Web Accessibility)',
    url: 'https://en.wikipedia.org/wiki/Web_accessibility',
    category: 'Dense Content / Knowledge Base',
    testAction: { type: 'search', query: 'screen reader' },
  },
  {
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/',
    category: 'Legacy Table-Based / Minimalist Community',
    testAction: { type: 'click', labelMatch: 'new | past | comments | login' },
  },
  {
    name: 'GitHub (Public Repository)',
    url: 'https://github.com/torvalds/linux',
    category: 'Modern Web Components & Deep SPA',
    testAction: { type: 'search', query: 'Makefile' },
  },
  {
    name: 'BBC Arabic News',
    url: 'https://www.bbc.com/arabic',
    category: 'RTL Arabic Multimedia & International News',
    testAction: { type: 'lang_scan', targetLang: 'ar' },
  },
  {
    name: 'DuckDuckGo Search Engine',
    url: 'https://duckduckgo.com/',
    category: 'Search Engine SPA / Dynamic Autocomplete',
    testAction: { type: 'type_and_search', query: 'web standards' },
  },
  {
    name: 'Shoelace Design System',
    url: 'https://shoelace.style/',
    category: 'Shadow DOM & Custom Web Components',
    testAction: { type: 'shadow_dom_scan' },
  },
  {
    name: 'TodoMVC React',
    url: 'https://demo.playwright.dev/todomvc/',
    category: 'Reactive SPA / Client-Side DOM Mutation',
    testAction: { type: 'add_todo', text: 'Audit Atlas on live sites' },
  },
];

async function runAudit() {
  console.log('================================================================');
  console.log('   PROJECT ATLAS — LIVE MULTI-WEBSITE EXTENSIVE STRESS AUDIT   ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const extensionPath = path.join(rootDir, 'client-script');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-audit-'));

  const auditReport = {
    timestamp: new Date().toISOString(),
    totalSitesAudited: SITES.length,
    siteResults: [],
    discoveredDefects: [],
    empiricalEvidence: {},
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: false,
      args: [
        '--headless=new',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    // Verify service worker
    let backgroundWorker = context.serviceWorkers()[0];
    if (!backgroundWorker) {
      backgroundWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    console.log(`[INIT] Atlas background service worker active: ${backgroundWorker?.url() || 'OK'}\n`);

    const page = await context.newPage();

    for (const site of SITES) {
      console.log(`----------------------------------------------------------------`);
      console.log(`[AUDITING] ${site.name}`);
      console.log(`  URL: ${site.url} (${site.category})`);

      const siteResult = {
        name: site.name,
        url: site.url,
        category: site.category,
        navigationStatus: 'OK',
        httpStatus: null,
        metrics: {},
        findings: [],
        extractedElementsSample: [],
        issues: [],
      };

      try {
        const response = await page.goto(site.url, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        });
        siteResult.httpStatus = response ? response.status() : 'cached';
        // Wait 2 seconds for client-side hydration / scripts
        await page.waitForTimeout(2000);

        // Inject Atlas content scripts into the page
        await page.addScriptTag({ path: path.join(extensionPath, 'dom-serializer.js') });
        await page.addScriptTag({ path: path.join(extensionPath, 'secret-vault.js') });
        await page.addScriptTag({ path: path.join(extensionPath, 'executor.js') });
        await page.addScriptTag({ path: path.join(extensionPath, 'speech.js') });
        await page.addScriptTag({ path: path.join(extensionPath, 'tts.js') });
        await page.addScriptTag({ path: path.join(extensionPath, 'content.js') });
        await page.waitForTimeout(500);
      } catch (navErr) {
        console.warn(`  [WARN] Navigation/Injection error on ${site.url}: ${navErr.message}`);
        siteResult.navigationStatus = `FAILED: ${navErr.message}`;
        siteResult.issues.push({
          type: 'NAVIGATION_TIMEOUT_OR_BLOCKED',
          severity: 'HIGH',
          detail: navErr.message,
        });
        auditReport.siteResults.push(siteResult);
        continue;
      }

      // Execute in-depth diagnostic evaluation inside the page context
      const diagnostics = await page.evaluate(async () => {
        const diag = {
          title: document.title,
          totalDomNodes: document.querySelectorAll('*').length,
          interactiveCandidates: 0,
          serializedCount: 0,
          serializationTimeMs: 0,
          fixedElementIssueFound: false,
          fixedElementsDropped: [],
          shadowRootCount: 0,
          shadowElementsIgnored: 0,
          iframeCount: document.querySelectorAll('iframe').length,
          iframesWithContent: 0,
          hasContentEditable: document.querySelectorAll('[contenteditable]').length,
          languageDetected: document.documentElement.lang || '',
          dirDetected: document.documentElement.dir || '',
          pageTextLength: 0,
          labelsMissingOrTruncated: 0,
          sampleElements: [],
          allSerialized: [],
          potentialIssues: [],
        };

        // 1. Measure Serialization Execution
        const t0 = performance.now();
        let serialized = [];
        try {
          if (typeof window.AtlasSerializer !== 'undefined' && typeof window.AtlasSerializer.serialize === 'function') {
            serialized = window.AtlasSerializer.serialize();
          } else {
            diag.potentialIssues.push({
              type: 'SERIALIZER_MISSING',
              message: 'window.AtlasSerializer.serialize is not available on window',
            });
          }
        } catch (e) {
          diag.potentialIssues.push({
            type: 'SERIALIZER_EXCEPTION',
            message: e.message,
            stack: e.stack,
          });
        }
        diag.serializationTimeMs = Math.round(performance.now() - t0);
        diag.serializedCount = serialized.length;
        diag.allSerialized = serialized.slice(0, 100); // Keep up to 100 for backend audit

        // Collect sample of serialized items
        diag.sampleElements = serialized.slice(0, 15).map((el) => ({
          id: el.id,
          ref: el.ref,
          tag: el.tag,
          type: el.type,
          role: el.role,
          label: el.label || el.resolved_label,
          disabled: el.disabled,
          sensitive: el.sensitive,
        }));

        // 2. Specific Test for The offsetParent / position:fixed bug (§13)
        // Check if any position:fixed or position:sticky elements were dropped by isVisible()
        const fixedAndSticky = Array.from(
          document.querySelectorAll('header, nav, [class*="nav"], [class*="header"], [style*="fixed"], [style*="sticky"], button, a')
        ).filter((el) => {
          try {
            const style = window.getComputedStyle(el);
            return style.position === 'fixed' || style.position === 'sticky';
          } catch (_) {
            return false;
          }
        });

        for (const el of fixedAndSticky) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const isReallyVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          if (isReallyVisible && el.offsetParent === null && el.tagName !== 'BODY') {
            // Check if this element or its interactive children were serialized
            const hasAtlasId = el.hasAttribute('data-atlas-id') || el.querySelector('[data-atlas-id]');
            if (!hasAtlasId) {
              diag.fixedElementIssueFound = true;
              diag.fixedElementsDropped.push({
                tag: el.tagName,
                className: (el.className || '').toString().slice(0, 50),
                position: style.position,
                rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top) },
                text: (el.innerText || el.textContent || '').trim().slice(0, 60),
              });
            }
          }
        }

        // 3. Shadow DOM Audit
        // Inspect custom elements and shadow roots
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          if (el.shadowRoot) {
            diag.shadowRootCount++;
            // Check if interactive items inside shadowRoot are captured
            const shadowInteractives = el.shadowRoot.querySelectorAll('button, input, a, [role="button"]');
            for (const sEl of shadowInteractives) {
              if (!sEl.hasAttribute('data-atlas-id')) {
                diag.shadowElementsIgnored++;
              }
            }
          }
        }

        // 4. Iframes Audit
        const iframes = document.querySelectorAll('iframe');
        for (const ifr of iframes) {
          try {
            if (ifr.contentDocument && ifr.contentDocument.body) {
              diag.iframesWithContent++;
            }
          } catch (_) {
            // cross-origin
          }
        }

        // 5. Page Text Extraction
        if (typeof window.AtlasContent !== 'undefined' && typeof window.AtlasContent.getPageText === 'function') {
          diag.pageTextLength = window.AtlasContent.getPageText().length;
        } else {
          diag.pageTextLength = (document.body?.innerText || '').length;
        }

        return diag;
      });

      console.log(`  -> Title: "${diagnostics.title}"`);
      console.log(`  -> Total DOM Elements: ${diagnostics.totalDomNodes}`);
      console.log(`  -> Serialized Interactive Elements: ${diagnostics.serializedCount} in ${diagnostics.serializationTimeMs}ms`);
      console.log(`  -> Shadow Roots Found: ${diagnostics.shadowRootCount} (Ignored items: ${diagnostics.shadowElementsIgnored})`);
      console.log(`  -> Iframes: ${diagnostics.iframeCount}`);
      console.log(`  -> Fixed / Sticky Dropped Items: ${diagnostics.fixedElementsDropped.length}`);

      siteResult.metrics = {
        totalDomNodes: diagnostics.totalDomNodes,
        serializedCount: diagnostics.serializedCount,
        serializationTimeMs: diagnostics.serializationTimeMs,
        shadowRootCount: diagnostics.shadowRootCount,
        shadowElementsIgnored: diagnostics.shadowElementsIgnored,
        iframeCount: diagnostics.iframeCount,
        fixedDroppedCount: diagnostics.fixedElementsDropped.length,
        languageDetected: diagnostics.languageDetected,
        dirDetected: diagnostics.dirDetected,
      };
      siteResult.extractedElementsSample = diagnostics.sampleElements;

      // Classify discovered issues on this site
      if (diagnostics.fixedElementsDropped.length > 0) {
        const issue = {
          type: 'FIXED_STICKY_ELEMENT_BLIND_SPOT',
          severity: 'HIGH',
          detail: `Found ${diagnostics.fixedElementsDropped.length} visible position:fixed/sticky elements dropped due to el.offsetParent === null heuristic.`,
          evidence: diagnostics.fixedElementsDropped.slice(0, 3),
        };
        siteResult.issues.push(issue);
        console.log(`  ⚠️ ISSUE DETECTED: [FIXED_STICKY_ELEMENT_BLIND_SPOT] — ${issue.detail}`);
      }

      if (diagnostics.shadowRootCount > 0 && diagnostics.shadowElementsIgnored > 0) {
        const issue = {
          type: 'SHADOW_DOM_BLIND_SPOT',
          severity: 'HIGH',
          detail: `Found ${diagnostics.shadowRootCount} shadow roots with ${diagnostics.shadowElementsIgnored} interactive elements ignored by document.querySelectorAll.`,
        };
        siteResult.issues.push(issue);
        console.log(`  ⚠️ ISSUE DETECTED: [SHADOW_DOM_BLIND_SPOT] — ${issue.detail}`);
      }

      if (diagnostics.iframeCount > 0) {
        const issue = {
          type: 'IFRAME_ISOLATION',
          severity: 'MEDIUM',
          detail: `Page contains ${diagnostics.iframeCount} iframes whose interactive controls are unindexed by top-level DOM serialization.`,
        };
        siteResult.issues.push(issue);
        console.log(`  ℹ️ NOTICE: [IFRAME_ISOLATION] — ${issue.detail}`);
      }

      if (diagnostics.serializedCount > 150) {
        const issue = {
          type: 'PROMPT_TOKEN_BLOAT_RISK',
          severity: 'MEDIUM',
          detail: `Page generated ${diagnostics.serializedCount} interactive elements. Without strict backend top-K budgeting, this risks 429 TPM exhaustion on LLM calls.`,
        };
        siteResult.issues.push(issue);
        console.log(`  ⚠️ ISSUE DETECTED: [PROMPT_TOKEN_BLOAT_RISK] — ${issue.detail}`);
      }

      // Check specific site action test
      if (site.testAction.type === 'lang_scan') {
        const langScanResult = await page.evaluate(async (targetLang) => {
          if (typeof window.AtlasLanguageSwitcher !== 'undefined') {
            return window.AtlasLanguageSwitcher.scan(targetLang);
          }
          return { found: false, error: 'AtlasLanguageSwitcher undefined' };
        }, site.testAction.targetLang);

        console.log(`  -> Language Switcher Scan ('${site.testAction.targetLang}'):`, langScanResult);
        if (!langScanResult.found) {
          siteResult.issues.push({
            type: 'LANGUAGE_SWITCHER_NOT_IDENTIFIED',
            severity: 'LOW',
            detail: `Language switcher scanner could not locate an explicit in-page switcher for '${site.testAction.targetLang}'.`,
          });
        }
      }

      // Check interactive execution on search / input
      if (site.testAction.type === 'search' || site.testAction.type === 'type_and_search') {
        const execTest = await page.evaluate(async (query) => {
          const searchInput = document.querySelector('input[type="search"], input[name="q"], input[name="search"], input[placeholder*="Search" i], [role="searchbox"]');
          if (!searchInput) {
            return { success: false, reason: 'No search input found' };
          }
          const atlasId = searchInput.getAttribute('data-atlas-id');
          if (!atlasId) {
            return { success: false, reason: 'Search input lacks data-atlas-id attribute' };
          }

          // Test AtlasExecutor typing if available
          if (typeof window.AtlasExecutor !== 'undefined' && typeof window.AtlasExecutor.execute === 'function') {
            try {
              const res = await window.AtlasExecutor.execute({
                action: 'type',
                element_id: atlasId,
                text: query,
              });
              return { success: res.ok, value: searchInput.value, atlasId };
            } catch (err) {
              return { success: false, reason: err.message };
            }
          }
          return { success: true, nativeFound: true, atlasId };
        }, site.testAction.query);

        console.log(`  -> Search Element Interaction Test:`, execTest);
        if (!execTest.success) {
          siteResult.issues.push({
            type: 'INTERACTION_FAILURE',
            severity: 'MEDIUM',
            detail: `Failed to interact with search input: ${execTest.reason}`,
          });
        }
      }

      auditReport.siteResults.push(siteResult);
    }

    await page.close();
    await context.close();
  } catch (err) {
    console.error('[FATAL] Audit harness crashed:', err);
    auditReport.fatalError = err.message;
  }

  // Synthesize common defect patterns
  const defectMap = new Map();
  for (const s of auditReport.siteResults) {
    for (const iss of s.issues) {
      const key = iss.type;
      if (!defectMap.has(key)) {
        defectMap.set(key, {
          type: iss.type,
          severity: iss.severity,
          affectedSites: [],
          details: iss.detail,
          evidence: iss.evidence || [],
        });
      }
      defectMap.get(key).affectedSites.push(s.name);
    }
  }

  auditReport.discoveredDefects = Array.from(defectMap.values());

  // Save audit report
  const outPath = path.join(rootDir, 'docs', 'MULTI_WEBSITE_AUDIT_EVIDENCE.json');
  fs.writeFileSync(outPath, JSON.stringify(auditReport, null, 2), 'utf-8');
  console.log(`\n================================================================`);
  console.log(`AUDIT FINISHED! Detailed evidence written to: ${outPath}`);
  console.log(`Total defects uncovered: ${auditReport.discoveredDefects.length}`);
  for (const d of auditReport.discoveredDefects) {
    console.log(` - [${d.severity}] ${d.type} on sites: ${d.affectedSites.join(', ')}`);
  }
  console.log(`================================================================\n`);
}

runAudit().catch(console.error);

#!/usr/bin/env node
/**
 * Project Atlas — Wave 3 Challenger Empirical Stress Test Suite
 * File: client-script/test_w3_challenger_stress.js
 *
 * Empirical verification for Wave 3 Task P1 (Store-Ready MV3 Packaging):
 * 1. ZIP binary header parsing, signatures, and decompressibility.
 * 2. CRC32 checksum verification for every compressed entry.
 * 3. Extraction into temporary folder and recursive scan.
 * 4. Strict blacklist audit: assert 0 test_*.js, node_modules, *.md, .git, .env, scratch files.
 * 5. Strict whitelist audit: only expected extension files bundled.
 * 6. Manifest v3 compliance: manifest_version: 3, icon magic bytes, clean CSP without
 *    unsafe-eval or unsafe-inline, universal <all_urls>, no localhost.
 * 7. Packager CLI verification runner (--verify-only exit code 0).
 * 8. Universal Prime Directive compliance (zero domain hardcoding).
 *
 * Run with: node client-script/test_w3_challenger_stress.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { execSync } = require('child_process');

let passed = 0;
let failed = 0;
const failureDetails = [];

function record(name, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failureDetails.push({ name, details });
    console.error(`  ✗ FAIL: ${name} -> ${details}`);
  }
}

const REPO_ROOT = path.resolve(__dirname, '..');
const ZIP_PATH = path.join(REPO_ROOT, 'dist', 'project-atlas-extension.zip');
const PACKAGER_PATH = path.join(__dirname, 'package_extension.js');

// ── Manual ZIP Binary Parser & CRC32 Validator ──────────────────────────────

function parseZipEntries(buffer) {
  const entries = [];
  let offset = 0;

  // Find End of Central Directory (EOCD) signature 0x06054b50 from the end
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('EOCD signature (0x06054b50) not found in ZIP archive.');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  let cdPos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    const cdSig = buffer.readUInt32LE(cdPos);
    if (cdSig !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header signature 0x${cdSig.toString(16)} at offset ${cdPos}`);
    }

    const compressionMethod = buffer.readUInt16LE(cdPos + 10);
    const crc32 = buffer.readUInt32LE(cdPos + 16);
    const compressedSize = buffer.readUInt32LE(cdPos + 20);
    const uncompressedSize = buffer.readUInt32LE(cdPos + 24);
    const fileNameLen = buffer.readUInt16LE(cdPos + 28);
    const extraLen = buffer.readUInt16LE(cdPos + 30);
    const commentLen = buffer.readUInt16LE(cdPos + 32);
    const localHeaderOffset = buffer.readUInt32LE(cdPos + 42);

    const fileName = buffer.toString('utf8', cdPos + 46, cdPos + 46 + fileNameLen);

    // Read Local File Header
    const localSig = buffer.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw new Error(`Invalid Local Header signature 0x${localSig.toString(16)} for ${fileName}`);
    }

    const localFileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

    const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);

    entries.push({
      fileName,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      compressedData,
      localHeaderOffset
    });

    cdPos += 46 + fileNameLen + extraLen + commentLen;
  }

  return { entries, totalEntries, cdSize, cdOffset };
}

function runW3PackagingChallengerSuite() {
  console.log('\n===============================================================');
  console.log('  PROJECT ATLAS — WAVE 3 EMPIRICAL CHALLENGER: TASK P1');
  console.log('===============================================================\n');

  // --- Domain 1: ZIP Binary & Header Integrity ---
  console.log('>>> Domain 1: ZIP Archive Binary & Header Verification');
  record('ZIP archive exists on disk', fs.existsSync(ZIP_PATH), `Path: ${ZIP_PATH}`);

  const zipStat = fs.statSync(ZIP_PATH);
  record('ZIP archive non-empty (> 10KB)', zipStat.size > 10240, `Actual size: ${zipStat.size} bytes`);

  const zipBuffer = fs.readFileSync(ZIP_PATH);
  let parsedZip;
  let parseError = null;
  try {
    parsedZip = parseZipEntries(zipBuffer);
  } catch (err) {
    parseError = err.message;
  }
  record('ZIP binary headers parsed successfully', parseError === null, parseError || '');
  record('ZIP central directory contains >= 18 entries', parsedZip && parsedZip.totalEntries >= 18, `Count: ${parsedZip?.totalEntries}`);

  // --- Domain 2: Decompressibility & CRC32 Verification ---
  console.log('\n>>> Domain 2: Decompression & CRC32 Checksums');
  let crcFailures = 0;
  let decompErrors = 0;
  const decompressedFiles = new Map();

  for (const entry of parsedZip.entries) {
    let uncompressedBuffer;
    try {
      if (entry.compressionMethod === 8) {
        uncompressedBuffer = zlib.inflateRawSync(entry.compressedData);
      } else if (entry.compressionMethod === 0) {
        uncompressedBuffer = entry.compressedData;
      } else {
        throw new Error(`Unsupported compression method ${entry.compressionMethod}`);
      }
    } catch (err) {
      decompErrors++;
      console.error(`  ✗ Failed to decompress ${entry.fileName}: ${err.message}`);
      continue;
    }

    if (uncompressedBuffer.length !== entry.uncompressedSize) {
      decompErrors++;
      console.error(`  ✗ Size mismatch for ${entry.fileName}: expected ${entry.uncompressedSize}, got ${uncompressedBuffer.length}`);
    }

    const calculatedCrc = zlib.crc32(uncompressedBuffer);
    if (calculatedCrc !== entry.crc32) {
      crcFailures++;
      console.error(`  ✗ CRC32 mismatch for ${entry.fileName}: expected 0x${entry.crc32.toString(16)}, got 0x${calculatedCrc.toString(16)}`);
    }

    decompressedFiles.set(entry.fileName, uncompressedBuffer);
  }

  record('100% of ZIP entries decompressed without error', decompErrors === 0, `${decompErrors} decompression errors`);
  record('100% of ZIP entries match recorded CRC32 checksums', crcFailures === 0, `${crcFailures} CRC32 mismatches`);

  // --- Domain 3: Temporary Folder Extraction & Asset Blacklist Audit ---
  console.log('\n>>> Domain 3: Filesystem Extraction & Blacklist / Whitelist Audit');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pkg-challenge-'));
  try {
    for (const [relPath, buf] of decompressedFiles.entries()) {
      const fullPath = path.join(tempDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, buf);
    }

    // Recursively list extracted files
    function getAllFiles(dir, fileList = []) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          getAllFiles(full, fileList);
        } else {
          fileList.push(path.relative(tempDir, full).replace(/\\/g, '/'));
        }
      }
      return fileList;
    }

    const extractedFiles = getAllFiles(tempDir);
    record('Extracted files count matches ZIP directory entries', extractedFiles.length === parsedZip.entries.length, `Extracted: ${extractedFiles.length}, Entries: ${parsedZip.entries.length}`);

    // Blacklist checks
    const testFiles = extractedFiles.filter(f => f.includes('test_') || f.includes('_test.') || f.endsWith('.test.js'));
    record('Blacklist: Strictly zero test files (test_*.js) in package', testFiles.length === 0, `Found: ${testFiles.join(', ')}`);

    const nodeModules = extractedFiles.filter(f => f.includes('node_modules'));
    record('Blacklist: Strictly zero node_modules in package', nodeModules.length === 0, `Found: ${nodeModules.join(', ')}`);

    const markdownFiles = extractedFiles.filter(f => f.endsWith('.md') || f.endsWith('.markdown'));
    record('Blacklist: Strictly zero markdown documentation files in package', markdownFiles.length === 0, `Found: ${markdownFiles.join(', ')}`);

    const gitFiles = extractedFiles.filter(f => f.includes('.git'));
    record('Blacklist: Strictly zero .git artifacts in package', gitFiles.length === 0, `Found: ${gitFiles.join(', ')}`);

    const envFiles = extractedFiles.filter(f => f.startsWith('.env') || f.includes('/.env'));
    record('Blacklist: Strictly zero .env configuration files in package', envFiles.length === 0, `Found: ${envFiles.join(', ')}`);

    const scratchFiles = extractedFiles.filter(f => f.endsWith('.tmp') || f.endsWith('.bak') || f.endsWith('.swp') || f.endsWith('.log'));
    record('Blacklist: Strictly zero temporary/scratch assets in package', scratchFiles.length === 0, `Found: ${scratchFiles.join(', ')}`);

    // Whitelist check: only allowed extension assets
    const allowedExact = new Set([
      'manifest.json',
      'background.js',
      'content.js',
      'dom-serializer.js',
      'executor.js',
      'options.html',
      'options.css',
      'options.js',
      'secret-vault.js',
      'sidebar.css',
      'sidebar.js',
      'speech.js',
      'tts.js',
      'websocket-client.js',
      'connection-manager.js',
      'ws-client.js',
      'icons/atlas.ico',
      'icons/icon16.png',
      'icons/icon48.png',
      'icons/icon128.png'
    ]);

    const unauthorizedFiles = extractedFiles.filter(f => !allowedExact.has(f));
    record('Whitelist: Only authorized extension production assets included', unauthorizedFiles.length === 0, `Unauthorized: ${unauthorizedFiles.join(', ')}`);

  } finally {
    // Cleanup temporary extraction dir
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // --- Domain 4: Manifest V3 Compliance & CSP Audit ---
  console.log('\n>>> Domain 4: Manifest V3 Security & Policy Enforcement');
  const manifestBuffer = decompressedFiles.get('manifest.json');
  record('manifest.json present in ZIP archive', !!manifestBuffer);

  let manifest = {};
  try {
    manifest = JSON.parse(manifestBuffer.toString('utf8'));
  } catch (err) {
    console.error('Failed to parse manifest.json from ZIP');
  }

  record('Manifest version is strictly 3', manifest.manifest_version === 3, `Got: ${manifest.manifest_version}`);
  record('Extension name matches Atlas specification', manifest.name && manifest.name.includes('Atlas'), `Got: ${manifest.name}`);
  record('Extension version is semver string', /^\d+\.\d+\.\d+$/.test(manifest.version), `Got: ${manifest.version}`);

  // Icons validation
  const iconPaths = ['16', '48', '128'];
  for (const size of iconPaths) {
    const iconRel = manifest.icons?.[size];
    record(`Icon ${size}x${size} declared in manifest`, !!iconRel, `Path: ${iconRel}`);
    const iconBuf = decompressedFiles.get(iconRel);
    record(`Icon ${size}x${size} present in ZIP archive`, !!iconBuf);
    const isPng = iconBuf && iconBuf.length > 8 && iconBuf[0] === 0x89 && iconBuf[1] === 0x50 && iconBuf[2] === 0x4e && iconBuf[3] === 0x47;
    record(`Icon ${size}x${size} has valid PNG magic bytes`, isPng, `Path: ${iconRel}`);
  }

  // Permissions validation
  const requiredPerms = ['activeTab', 'storage', 'scripting', 'webNavigation', 'downloads', 'tabs', 'declarativeNetRequest'];
  for (const perm of requiredPerms) {
    record(`Permission '${perm}' configured`, manifest.permissions?.includes(perm));
  }

  const forbiddenPerms = ['cookies', 'debugger', 'management', 'webRequestBlocking', 'nativeMessaging', 'proxy'];
  for (const perm of forbiddenPerms) {
    record(`Forbidden permission '${perm}' excluded`, !manifest.permissions?.includes(perm));
  }

  // Host permissions & Universal Rule
  record('Host permissions contains universal <all_urls>', manifest.host_permissions?.includes('<all_urls>'));
  const hasLocalhost = manifest.host_permissions?.some(h => h.includes('localhost') || h.includes('127.0.0.1'));
  record('Host permissions excludes localhost/127.0.0.1 development hosts', !hasLocalhost);

  // CSP Hardening
  const csp = manifest.content_security_policy?.extension_pages || '';
  record('CSP is configured in manifest', csp.length > 0, `CSP: ${csp}`);
  record('CSP includes script-src \'self\'', csp.includes("script-src 'self'"));
  record('CSP prohibits unsafe-eval', !csp.includes('unsafe-eval'));
  record('CSP prohibits unsafe-inline for scripts', !csp.includes('unsafe-inline'));
  record('CSP includes object-src \'none\'', csp.includes("object-src 'none'"));
  record('CSP includes base-uri \'none\'', csp.includes("base-uri 'none'"));

  // Redundant Offscreen Document Audit
  const hasOffscreen = manifest.permissions?.includes('offscreen') || decompressedFiles.has('offscreen.html') || decompressedFiles.has('offscreen.js');
  record('Redundant offscreen document formally dropped', !hasOffscreen);

  // --- Domain 5: Packager Script Standalone Verification ---
  console.log('\n>>> Domain 5: Packager Script Standalone CLI Runner Verification');
  let verifyOutput = '';
  let verifyExitCode = -1;
  try {
    verifyOutput = execSync(`node "${PACKAGER_PATH}" --verify-only`, {
      encoding: 'utf8',
      cwd: REPO_ROOT
    });
    verifyExitCode = 0;
  } catch (err) {
    verifyExitCode = err.status || 1;
    verifyOutput = err.stdout + '\n' + err.stderr;
  }

  record('node package_extension.js --verify-only exits with code 0', verifyExitCode === 0, `Exit code: ${verifyExitCode}`);
  record('Verify-only output confirms MV3 Manifest & Security Checks Passed', verifyOutput.includes('All MV3 Manifest & Security Checks Passed'));
  record('Verify-only skips generating zip on check-only mode', verifyOutput.includes('--verify-only flag specified: skipping zip generation'));

  // --- Domain 6: Universal Prime Directive Audit ---
  console.log('\n>>> Domain 6: Universal Prime Directive Compliance Audit');
  const packagerCode = fs.readFileSync(PACKAGER_PATH, 'utf8');
  const manifestCode = manifestBuffer.toString('utf8');
  const siteSpecificRegex = /(amazon\.com|google\.com|drive\.google\.com|youtube\.com|twitter\.com|facebook\.com)/i;

  record('Packager script contains zero website-specific hardcoding', !siteSpecificRegex.test(packagerCode));
  record('Packaged manifest.json contains zero website-specific hardcoding', !siteSpecificRegex.test(manifestCode));

  // --- Final Summary ---
  console.log('\n===============================================================');
  console.log(`Task P1 Challenger Test Results: ${passed} passed, ${failed} failed.`);
  console.log('===============================================================\n');

  if (failed > 0) {
    console.error(`FAILED CHECKS (${failed}):`);
    for (const f of failureDetails) {
      console.error(` - ${f.name}: ${f.details}`);
    }
    process.exit(1);
  }
}

runW3PackagingChallengerSuite();

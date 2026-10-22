#!/usr/bin/env node
/**
 * Project Atlas — Store-Ready MV3 Extension Packager
 * File: client-script/package_extension.js
 *
 * Responsibilities:
 * 1. Validates manifest.json (MV3 schema, version match with package.json, icons, permissions, CSP).
 * 2. Enforces security gates: no 'unsafe-eval' or 'unsafe-inline' in CSP.
 * 3. Filters out all test files, markdown documentation, and dev artifacts.
 * 4. Generates clean, store-ready ZIP archive in dist/project-atlas-extension.zip using pure Node.js standard libraries (zlib).
 * 5. Standalone verification runner via '--verify-only'.
 *
 * 100% universal across all websites (Prime Directive).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = __dirname;
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const OUTPUT_ZIP = path.join(DIST_DIR, 'project-atlas-extension.zip');

const REQUIRED_ICONS = ['16', '48', '128'];
const REQUIRED_PERMISSIONS = [
  'activeTab',
  'storage',
  'scripting',
  'webNavigation',
  'downloads',
  'tabs',
  'declarativeNetRequest'
];
const FORBIDDEN_PERMISSIONS = [
  'cookies',
  'debugger',
  'management',
  'webRequestBlocking',
  'nativeMessaging',
  'proxy'
];

// ── Pure Node.js Standard Library PKZIP Generator ────────────────────────────

class ZipArchiveBuilder {
  constructor() {
    this.entries = [];
  }

  addFile(zipPath, contentBuffer, date = new Date()) {
    const normalizedPath = zipPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const pathBuffer = Buffer.from(normalizedPath, 'utf8');

    // DOS date/time calculation
    const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;

    const crc = zlib.crc32(contentBuffer);
    const uncompressedSize = contentBuffer.length;
    const deflated = zlib.deflateRawSync(contentBuffer, { level: 9 });
    const useDeflate = deflated.length < uncompressedSize;
    const compressionMethod = useDeflate ? 8 : 0;
    const compressedData = useDeflate ? deflated : contentBuffer;
    const compressedSize = compressedData.length;

    this.entries.push({
      pathBuffer,
      dosTime,
      dosDate,
      crc,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      compressedData,
      localHeaderOffset: 0
    });
  }

  build() {
    const buffers = [];
    let offset = 0;

    // 1. Write Local File Headers + Compressed Data
    for (const entry of this.entries) {
      entry.localHeaderOffset = offset;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); // signature
      header.writeUInt16LE(20, 4);         // version needed to extract (2.0)
      header.writeUInt16LE(0x0800, 6);      // general purpose bit flag (UTF-8)
      header.writeUInt16LE(entry.compressionMethod, 8);
      header.writeUInt16LE(entry.dosTime, 10);
      header.writeUInt16LE(entry.dosDate, 12);
      header.writeUInt32LE(entry.crc, 14);
      header.writeUInt32LE(entry.compressedSize, 18);
      header.writeUInt32LE(entry.uncompressedSize, 22);
      header.writeUInt16LE(entry.pathBuffer.length, 26);
      header.writeUInt16LE(0, 28);          // extra field length

      buffers.push(header, entry.pathBuffer, entry.compressedData);
      offset += header.length + entry.pathBuffer.length + entry.compressedData.length;
    }

    const centralDirectoryOffset = offset;

    // 2. Write Central Directory Headers
    for (const entry of this.entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);      // central dir signature
      cd.writeUInt16LE(20, 4);              // version made by
      cd.writeUInt16LE(20, 6);              // version needed to extract
      cd.writeUInt16LE(0x0800, 8);           // bit flag (UTF-8)
      cd.writeUInt16LE(entry.compressionMethod, 10);
      cd.writeUInt16LE(entry.dosTime, 12);
      cd.writeUInt16LE(entry.dosDate, 14);
      cd.writeUInt32LE(entry.crc, 16);
      cd.writeUInt32LE(entry.compressedSize, 20);
      cd.writeUInt32LE(entry.uncompressedSize, 24);
      cd.writeUInt16LE(entry.pathBuffer.length, 28);
      cd.writeUInt16LE(0, 30);              // extra field length
      cd.writeUInt16LE(0, 32);              // file comment length
      cd.writeUInt16LE(0, 34);              // disk number start
      cd.writeUInt16LE(0, 36);              // internal file attributes
      cd.writeUInt32LE(0, 38);              // external file attributes
      cd.writeUInt32LE(entry.localHeaderOffset, 42);

      buffers.push(cd, entry.pathBuffer);
      offset += cd.length + entry.pathBuffer.length;
    }

    const centralDirectorySize = offset - centralDirectoryOffset;

    // 3. Write End of Central Directory Record
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);      // EOCD signature
    eocd.writeUInt16LE(0, 4);               // disk number
    eocd.writeUInt16LE(0, 6);               // disk where central dir starts
    eocd.writeUInt16LE(this.entries.length, 8);  // entries on disk
    eocd.writeUInt16LE(this.entries.length, 10); // total entries
    eocd.writeUInt32LE(centralDirectorySize, 12);
    eocd.writeUInt32LE(centralDirectoryOffset, 16);
    eocd.writeUInt16LE(0, 20);              // comment length

    buffers.push(eocd);
    return Buffer.concat(buffers);
  }
}

// ── Validation Engine ────────────────────────────────────────────────────────

function validateExtension() {
  const issues = [];
  const checks = [];

  function report(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (!passed) issues.push(`${name}: ${detail}`);
  }

  // 1. Manifest file existence & JSON syntax
  const manifestPath = path.join(CLIENT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    report('Manifest Exists', false, 'manifest.json not found in client-script/');
    return { passed: false, checks, issues, manifest: null };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    report('Manifest JSON Parsing', true, 'Valid JSON');
  } catch (err) {
    report('Manifest JSON Parsing', false, err.message);
    return { passed: false, checks, issues, manifest: null };
  }

  // 2. MV3 Schema validation
  report('Manifest Version 3', manifest.manifest_version === 3, `Found manifest_version: ${manifest.manifest_version}`);
  report('Extension Name', typeof manifest.name === 'string' && manifest.name.length > 0, manifest.name);

  // 3. Version synchronization with root package.json
  const packageJsonPath = path.join(REPO_ROOT, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      report('Version Matches package.json', manifest.version === pkg.version, `manifest=${manifest.version}, package.json=${pkg.version}`);
    } catch (_) {
      report('Version Present', typeof manifest.version === 'string', manifest.version);
    }
  } else {
    report('Version Present', typeof manifest.version === 'string', manifest.version);
  }

  // 4. Content Security Policy (No unsafe-eval, no unsafe-inline in scripts)
  const csp = manifest.content_security_policy;
  let cspString = '';
  if (typeof csp === 'string') {
    cspString = csp;
  } else if (csp && typeof csp === 'object') {
    cspString = Object.values(csp).join('; ');
  }

  const hasUnsafeEval = /'unsafe-eval'/i.test(cspString);
  const hasUnsafeInline = /'unsafe-inline'/i.test(cspString);
  report('CSP No unsafe-eval', !hasUnsafeEval, hasUnsafeEval ? 'Found unsafe-eval in CSP' : 'Clean CSP');
  report('CSP No unsafe-inline in scripts', !hasUnsafeInline, hasUnsafeInline ? 'Found unsafe-inline in CSP' : 'Clean CSP');

  // 5. Icons Verification
  const iconPaths = manifest.icons || {};
  for (const size of REQUIRED_ICONS) {
    const relPath = iconPaths[size];
    if (!relPath) {
      report(`Icon ${size}x${size} Defined`, false, `Missing icon entry for ${size}`);
      continue;
    }
    const fullPath = path.join(CLIENT_DIR, relPath);
    if (!fs.existsSync(fullPath)) {
      report(`Icon ${size}x${size} File Exists`, false, `File not found: ${relPath}`);
      continue;
    }
    const stat = fs.statSync(fullPath);
    const buf = fs.readFileSync(fullPath);
    const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    report(`Icon ${size}x${size} Valid PNG`, isPng && stat.size > 0, `${relPath} (${stat.size} bytes)`);
  }

  // 6. Permissions Minimality Check
  const permissions = manifest.permissions || [];
  for (const perm of REQUIRED_PERMISSIONS) {
    report(`Permission ${perm} Included`, permissions.includes(perm), `Configured in manifest`);
  }
  for (const forbidden of FORBIDDEN_PERMISSIONS) {
    report(`Forbidden Permission ${forbidden} Excluded`, !permissions.includes(forbidden), `Verified absent`);
  }

  // 7. Universal Host Permissions (<all_urls> present)
  const hostPermissions = manifest.host_permissions || [];
  report('Universal <all_urls> Host Permission', hostPermissions.includes('<all_urls>'), '100% Universal compliance');

  // 8. Mandatory Component Files & Packaging Manifest (H13)
  const manifestConfigPath = path.join(CLIENT_DIR, 'extension-files.json');
  if (!fs.existsSync(manifestConfigPath)) {
    report('Unified Packaging Manifest Exists', false, 'extension-files.json not found in client-script/');
    return { passed: false, checks, issues, manifest };
  }

  let packagingConfig;
  try {
    packagingConfig = JSON.parse(fs.readFileSync(manifestConfigPath, 'utf8'));
    report('Unified Packaging Manifest JSON Parsing', true, 'Valid JSON in extension-files.json');
  } catch (err) {
    report('Unified Packaging Manifest JSON Parsing', false, err.message);
    return { passed: false, checks, issues, manifest };
  }

  const productionFiles = packagingConfig.production_files || [];
  report(
    'Production Files Whitelist Defined',
    Array.isArray(productionFiles) && productionFiles.length >= 21,
    `Found ${productionFiles.length} declared files`
  );

  const excludeRegexes = (packagingConfig.exclude_patterns || []).map(p => new RegExp(p));

  for (const relFile of productionFiles) {
    const fullPath = path.join(CLIENT_DIR, relFile);
    const exists = fs.existsSync(fullPath);
    report(`Production Asset ${relFile} Exists`, exists, exists ? 'Found' : 'Missing');

    const isExcluded = excludeRegexes.some(rx => rx.test(relFile));
    if (isExcluded) {
      report(`Production Asset ${relFile} Not Excluded`, false, 'Matched exclude_patterns');
    }
  }

  const allPassed = checks.every(c => c.passed);
  return { passed: allPassed, checks, issues, manifest, packagingConfig };
}

// ── Package Builder ──────────────────────────────────────────────────────────

function buildExtensionPackage(validationResult) {
  if (!validationResult.passed) {
    throw new Error(`Cannot package extension with validation errors:\n- ${validationResult.issues.join('\n- ')}`);
  }

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const zip = new ZipArchiveBuilder();
  let fileCount = 0;
  let totalUncompressed = 0;

  // Prepare sanitized manifest for store distribution
  const prodManifest = JSON.parse(JSON.stringify(validationResult.manifest));

  // 1. Enforce explicit MV3 CSP for Chrome Web Store
  prodManifest.content_security_policy = {
    extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none';"
  };

  // 2. Remove dev localhost host_permissions from store package while keeping <all_urls>
  if (Array.isArray(prodManifest.host_permissions)) {
    prodManifest.host_permissions = prodManifest.host_permissions.filter(
      p => !p.includes('localhost') && !p.includes('127.0.0.1')
    );
  }

  // Add sanitized manifest to zip buffer placeholder
  const manifestBuf = Buffer.from(JSON.stringify(prodManifest, null, 2), 'utf8');

  // Load single source of truth manifest
  const packagingConfig = validationResult.packagingConfig || JSON.parse(
    fs.readFileSync(path.join(CLIENT_DIR, 'extension-files.json'), 'utf8')
  );
  const productionFiles = packagingConfig.production_files || [];
  const excludeRegexes = (packagingConfig.exclude_patterns || []).map(p => new RegExp(p));

  // Package all files defined in production_files
  for (const relFile of productionFiles) {
    const isExcluded = excludeRegexes.some(rx => rx.test(relFile));
    if (isExcluded) {
      continue;
    }

    const fullPath = path.join(CLIENT_DIR, relFile);
    if (relFile === 'manifest.json') {
      zip.addFile('manifest.json', manifestBuf);
      fileCount++;
      totalUncompressed += manifestBuf.length;
    } else if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath);
      zip.addFile(relFile, content);
      fileCount++;
      totalUncompressed += content.length;
    }
  }

  // Build binary ZIP buffer
  const zipBuffer = zip.build();
  fs.writeFileSync(OUTPUT_ZIP, zipBuffer);

  const hash = crypto.createHash('sha256').update(zipBuffer).digest('hex');
  const compressedSize = zipBuffer.length;
  const ratio = ((1 - compressedSize / totalUncompressed) * 100).toFixed(1);

  return {
    outputPath: OUTPUT_ZIP,
    fileCount,
    uncompressedSize: totalUncompressed,
    compressedSize,
    compressionRatio: `${ratio}%`,
    sha256: hash
  };
}

// ── CLI Runner ───────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes('--verify-only');

  console.log('\n==========================================================');
  console.log('  Project Atlas — MV3 Extension Store Packager');
  console.log('==========================================================\n');

  const validation = validateExtension();

  console.log('--- Manifest & Asset Validation Checks ---');
  for (const check of validation.checks) {
    const mark = check.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [${mark}] ${check.name.padEnd(36)} : ${check.detail}`);
  }
  console.log('------------------------------------------');

  if (!validation.passed) {
    console.error(`\nValidation Failed with ${validation.issues.length} issue(s):`);
    for (const issue of validation.issues) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }

  console.log('\n✓ All MV3 Manifest & Security Checks Passed.');

  if (verifyOnly) {
    console.log('\n[--verify-only flag specified: skipping zip generation]');
    console.log('Manifest and assets are 100% store-ready.\n');
    process.exit(0);
  }

  console.log('\nBuilding Store-Ready ZIP Archive in dist/ ...');
  const result = buildExtensionPackage(validation);

  console.log('\n==========================================================');
  console.log('  Extension Packaging Complete ✅');
  console.log('==========================================================');
  console.log(`  Output Archive   : ${result.outputPath}`);
  console.log(`  Bundled Files    : ${result.fileCount} files`);
  console.log(`  Uncompressed Size: ${(result.uncompressedSize / 1024).toFixed(2)} KB`);
  console.log(`  Compressed Size  : ${(result.compressedSize / 1024).toFixed(2)} KB (${result.compressionRatio} reduction)`);
  console.log(`  SHA-256 Digest   : ${result.sha256}`);
  console.log('==========================================================\n');

  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { validateExtension, buildExtensionPackage };

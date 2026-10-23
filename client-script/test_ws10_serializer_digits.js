/**
 * client-script/test_ws10_serializer_digits.js
 * Verification of D6: 10+ digits raw value masking and Arabic-Indic normalization in DOM Serializer.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

let passed = 0;
let failed = 0;

function testAssert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function runTests() {
  console.log("--- Running WS10 Serializer 10+ Digits Masking Tests ---\n");

  const serializer = require("./dom-serializer.js");

  function createMockInput(opts = {}) {
    const attrs = { ...(opts.attrs || {}) };
    return {
      tagName: "INPUT",
      type: opts.type || "text",
      value: opts.value || "",
      getAttribute: (k) => attrs[k] ?? null,
      hasAttribute: (k) => k in attrs,
    };
  }

  // 1. ASCII 10 digits without token -> isSensitiveField returns true
  const el1 = createMockInput({ value: "1234567890" });
  testAssert(serializer.isSensitiveField(el1) === true, "10 ASCII digits detected as sensitive");

  // 2. ASCII 14 digits without token -> isSensitiveField returns true
  const el2 = createMockInput({ value: "00000000000000" });
  testAssert(serializer.isSensitiveField(el2) === true, "14 ASCII digits detected as sensitive");

  // 3. Arabic-Indic 10 digits without token -> isSensitiveField returns true
  const el3 = createMockInput({ value: "١٢٣٤٥٦٧٨٩٠" });
  testAssert(serializer.isSensitiveField(el3) === true, "10 Arabic-Indic digits detected as sensitive");

  // 4. Arabic-Indic 14 digits without token -> isSensitiveField returns true
  const el4 = createMockInput({ value: "٠٠٠٠٠٠٠٠٠٠٠٠٠٠" });
  testAssert(serializer.isSensitiveField(el4) === true, "14 Arabic-Indic digits detected as sensitive");

  // 5. Short 9 digits -> NOT sensitive
  const el5 = createMockInput({ value: "123456789" });
  testAssert(serializer.isSensitiveField(el5) === false, "9 digits NOT detected as sensitive");

  // 6. Tokenized field with data-atlas-token
  const el6 = createMockInput({
    value: "00000000000000",
    attrs: { "data-atlas-token": "{vault:sec_123}" },
  });
  testAssert(serializer.isSensitiveField(el6) === true, "Tokenized field detected as sensitive");

  console.log(`\nWS10 Serializer 10+ Digits Tests Complete: ${passed} passed, ${failed} failed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

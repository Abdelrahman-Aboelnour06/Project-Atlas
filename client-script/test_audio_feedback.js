// client-script/test_audio_feedback.js
// Unit tests for AtlasAudio Web Audio Earcon Synthesizer

const assert = require('assert');

// Mock Web Audio API for headless Node testing
class MockGainNode {
  constructor() {
    this.gain = {
      value: 1.0,
      setValueAtTime: (val) => { this.gain.value = val; },
      exponentialRampToValueAtTime: () => {}
    };
  }
  connect() {}
}

class MockOscillatorNode {
  constructor() {
    this.type = 'sine';
    this.frequency = {
      value: 440,
      setValueAtTime: (val) => { this.frequency.value = val; }
    };
  }
  connect() {}
  start() {}
  stop() {}
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
  }
  createGain() { return new MockGainNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  resume() { this.state = 'running'; }
}

global.window = {
  AudioContext: MockAudioContext
};

// Load audio feedback module
require('./audio-feedback.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

console.log('\n--- Running AtlasAudio Earcon Unit Tests ---\n');

test('AtlasAudio is registered on window', () => {
  assert(global.window.AtlasAudio !== undefined, 'AtlasAudio should be attached to window');
  assert(typeof global.window.AtlasAudio.start === 'function');
  assert(typeof global.window.AtlasAudio.click === 'function');
  assert(typeof global.window.AtlasAudio.formFill === 'function');
  assert(typeof global.window.AtlasAudio.success === 'function');
  assert(typeof global.window.AtlasAudio.attention === 'function');
  assert(typeof global.window.AtlasAudio.error === 'function');
});

test('Mute and un-mute toggling', () => {
  const audio = global.window.AtlasAudio;
  assert.strictEqual(audio.isMuted(), false);
  audio.setMuted(true);
  assert.strictEqual(audio.isMuted(), true);
  audio.setMuted(false);
  assert.strictEqual(audio.isMuted(), false);
});

test('Earcon functions execute without throwing', () => {
  const audio = global.window.AtlasAudio;
  assert.doesNotThrow(() => audio.start());
  assert.doesNotThrow(() => audio.click());
  assert.doesNotThrow(() => audio.formFill());
  assert.doesNotThrow(() => audio.success());
  assert.doesNotThrow(() => audio.attention());
  assert.doesNotThrow(() => audio.error());
});

test('Volume control clamps between 0.0 and 1.0', () => {
  const audio = global.window.AtlasAudio;
  assert.doesNotThrow(() => audio.setVolume(0.5));
  assert.doesNotThrow(() => audio.setVolume(1.5)); // Clamped to 1.0
  assert.doesNotThrow(() => audio.setVolume(-0.2)); // Clamped to 0.0
});

console.log(`\nAtlasAudio Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

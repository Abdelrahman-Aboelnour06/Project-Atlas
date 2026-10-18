/**
 * Project Atlas — Real-Time Web Audio Earcon Synthesizer
 * client-script/audio-feedback.js
 *
 * Synthesizes non-visual auditory cues (earcons) using the HTML5 Web Audio API
 * to provide immediate, zero-latency feedback during autonomous agent execution.
 * Requires zero external audio assets (MP3/WAV) and respects user volume/mute preferences.
 */

(function () {
  "use strict";

  let audioCtx = null;
  let isMuted = false;
  let masterGain = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0.15, audioCtx.currentTime); // Comfortable baseline volume
        masterGain.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  function playTone(freq, durationSec, type = "sine", gainVal = 0.2) {
    if (isMuted) return;
    initAudio();
    if (!audioCtx || !masterGain) return;

    try {
      const osc = audioCtx.createOscillator();
      const noteGain = audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      noteGain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationSec);

      osc.connect(noteGain);
      noteGain.connect(masterGain);

      osc.start();
      osc.stop(audioCtx.currentTime + durationSec);
    } catch (e) {
      console.warn("[Atlas Audio] Tone synthesis suppressed:", e);
    }
  }

  const earcons = {
    // 1. Navigation / Hop Initiated
    start() {
      playTone(440, 0.08, "sine", 0.15); // A4
      setTimeout(() => playTone(554.37, 0.12, "sine", 0.15), 60); // C#5
    },

    // 2. Element Click Micro-Feedback
    click() {
      playTone(800, 0.03, "triangle", 0.18);
    },

    // 3. Form Input Filled
    formFill() {
      playTone(523.25, 0.05, "sine", 0.15); // C5
      setTimeout(() => playTone(659.25, 0.08, "sine", 0.15), 50); // E5
    },

    // 4. Milestone Completed Success Chime (C Major Triad)
    success() {
      playTone(523.25, 0.1, "triangle", 0.2); // C5
      setTimeout(() => playTone(659.25, 0.1, "triangle", 0.2), 80); // E5
      setTimeout(() => playTone(783.99, 0.2, "triangle", 0.25), 160); // G5
    },

    // 5. Human Attention / Confirmation Gate Required
    attention() {
      playTone(659.25, 0.12, "square", 0.12);
      setTimeout(() => playTone(440, 0.2, "square", 0.14), 100);
    },

    // 6. Action Error or Rate-Limit Fallback
    error() {
      playTone(330, 0.12, "sawtooth", 0.12);
      setTimeout(() => playTone(220, 0.25, "sawtooth", 0.14), 90);
    },

    // Configuration
    setMuted(mute) {
      isMuted = !!mute;
    },

    isMuted() {
      return isMuted;
    },

    setVolume(volumeFraction) {
      initAudio();
      if (masterGain && audioCtx) {
        const vol = Math.max(0.0, Math.min(1.0, volumeFraction));
        masterGain.gain.setValueAtTime(vol, audioCtx.currentTime);
      }
    }
  };

  window.AtlasAudio = earcons;
})();

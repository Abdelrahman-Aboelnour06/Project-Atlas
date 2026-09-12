(function () {
  // tts.js
  // Voice Output (Text-to-Speech)
  // Wraps native Web Speech API (SpeechSynthesis)
  //
  // Public API (window.AtlasTTS):
  //   AtlasTTS.isSupported() -> boolean
  //   AtlasTTS.speak(text, options) -> void
  //   AtlasTTS.stop() -> void

  const isSupported = () =>
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;

  let currentUtterance = null;

  const stop = () => {
    if (!isSupported()) return;
    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
    } catch (_) {}
    currentUtterance = null;
  };

  const cleanSpeechText = (raw) => {
    if (!raw) return "";
    return raw
      .replace(/https?:\/\/\S+/gi, "") // strip urls
      .replace(/[#*_`~\[\]\(\)\{\}\<\>\\]/g, "") // strip markdown
      .replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "") // strip emojis
      .replace(/\s+/g, " ")
      .trim();
  };

  let muted = false;

  const setMuted = (isMuted) => {
    muted = isMuted;
    if (muted) stop();
    return muted;
  };

  const isMuted = () => muted;

  const toggleMute = () => setMuted(!muted);

  const speak = (text, { onStart, onEnd, onError } = {}) => {
    if (!isSupported() || muted) {
      return;
    }

    stop();

    const sanitized = cleanSpeechText(text);
    if (!sanitized) return;

    try {
      const utterance = new SpeechSynthesisUtterance(sanitized);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        onStart?.();
      };

      utterance.onend = () => {
        currentUtterance = null;
        onEnd?.();
      };

      utterance.onerror = (e) => {
        currentUtterance = null;
        // Ignore errors caused by explicit cancellation
        if (e.error !== "canceled" && e.error !== "interrupted") {
          onError?.(e);
        }
      };

      currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      currentUtterance = null;
      onError?.(err);
    }
  };

  window.AtlasTTS = {
    isSupported,
    speak,
    stop,
    isMuted,
    setMuted,
    toggleMute,
  };
})();

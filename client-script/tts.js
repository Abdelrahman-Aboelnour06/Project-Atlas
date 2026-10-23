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

  const getVoiceForLanguage = (targetLang, voices = null) => {
    const availableVoices =
      Array.isArray(voices)
        ? voices
        : (typeof window !== "undefined" && window.speechSynthesis?.getVoices
            ? window.speechSynthesis.getVoices()
            : []);

    if (!availableVoices || availableVoices.length === 0) {
      return null;
    }

    const isAr = targetLang === "ar-EG" || (typeof targetLang === "string" && targetLang.startsWith("ar"));

    if (isAr) {
      // 1. Exact dialect match (ar-EG)
      const exactMatch = availableVoices.find(
        (v) => v.lang === "ar-EG" || v.lang === "ar_EG",
      );
      if (exactMatch) return exactMatch;

      // 2. Any Arabic regional locale (ar-SA, ar-XA, ar-AE, etc.)
      const regionalMatch = availableVoices.find(
        (v) =>
          v.lang &&
          (v.lang.startsWith("ar-") ||
            v.lang.startsWith("ar_") ||
            v.lang.toLowerCase() === "ar"),
      );
      if (regionalMatch) return regionalMatch;

      // 3. Match voice name mentioning Arabic or عربي
      const nameMatch = availableVoices.find(
        (v) => v.name && /arabic|عربي/i.test(v.name),
      );
      if (nameMatch) return nameMatch;

      // 4. Fallback to null so browser engine defers to host default
      return null;
    }

    // English / default resolution
    const exactEn = availableVoices.find(
      (v) => v.lang === "en-US" || v.lang === "en_US",
    );
    if (exactEn) return exactEn;

    const regionalEn = availableVoices.find(
      (v) =>
        v.lang &&
        (v.lang.startsWith("en-") ||
          v.lang.startsWith("en_") ||
          v.lang.toLowerCase() === "en"),
    );
    if (regionalEn) return regionalEn;

    return null;
  };

  const speak = (text, options = {}) => {
    const { onStart, onEnd, onError, lang, language } = options;
    if (!isSupported() || muted) {
      return;
    }

    stop();

    const sanitized = cleanSpeechText(text);
    if (!sanitized) return;

    try {
      const utterance = new SpeechSynthesisUtterance(sanitized);

      // Resolve target language:
      // 1. Explicit option passed into speak
      // 2. Arabic script detected in text
      // 3. Global active language from AtlasSidebar or AtlasSpeech
      const explicitLang = lang || language || null;
      const hasArabicScript = /[\u0600-\u06FF]/.test(sanitized);
      const globalLang =
        (typeof window !== "undefined" &&
          (window.AtlasSidebar?.getLanguage?.() ||
            window.AtlasSpeech?.getLanguage?.())) ||
        null;

      const isArabic =
        hasArabicScript ||
        (explicitLang && (explicitLang === "ar-EG" || explicitLang.startsWith("ar"))) ||
        (!explicitLang && globalLang && (globalLang === "ar-EG" || globalLang.startsWith("ar")));

      const targetLang = isArabic ? "ar-EG" : "en-US";

      const voices =
        typeof window !== "undefined" && window.speechSynthesis?.getVoices
          ? window.speechSynthesis.getVoices()
          : [];

      const matchedVoice = getVoiceForLanguage(targetLang, voices);

      if (isArabic && !matchedVoice) {
        console.warn(
          "AtlasTTS: No Arabic voice installed on host OS. Using default voice.",
        );
      }

      utterance.lang = targetLang;
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }
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

  const detectLanguage = (text) => {
    const sanitized = cleanSpeechText(text);
    return /[\u0600-\u06FF]/.test(sanitized) ? "ar-EG" : "en-US";
  };

  const AtlasTTS = {
    isSupported,
    speak,
    stop,
    isMuted,
    setMuted,
    toggleMute,
    detectLanguage,
    cleanSpeechText,
    getVoiceForLanguage,
  };

  if (typeof window !== "undefined") {
    window.AtlasTTS = AtlasTTS;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = AtlasTTS;
  }
})();

(function () {
// speech.js
// Voice Input (Speech-to-Text) & Live Web Audio Level Meter
// Wraps Web Speech API (SpeechRecognition) with pre-flight permission checks,
// Web Audio API AnalyserNode live amplitude visualization, and leak-free teardown.
//
// Public API (window.AtlasSpeech):
//   AtlasSpeech.isSupported() -> boolean
//   AtlasSpeech.isListening() -> boolean
//   AtlasSpeech.getLanguage() -> string
//   AtlasSpeech.setLanguage(lang: 'ar-EG' | 'en-US') -> string
//   AtlasSpeech.start({ onResult, onInterim, onEnd, onError, onAudioLevel }) -> Promise<void>
//   AtlasSpeech.stop() -> void

const SpeechRecognitionImpl =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)

const AudioContextClass =
    typeof window !== 'undefined' &&
    (window.AudioContext || window.webkitAudioContext)

let recognition = null
let listening = false
let currentLang = 'en-US'

// Web Audio API Level Meter State
let audioContext = null
let mediaStream = null
let sourceNode = null
let analyserNode = null
let animFrameId = null
let isStarting = false

// Load stored language on initialization from chrome.storage.local key atlas_lang (with atlas_voice_lang migration)
const loadStoredLanguage = () => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
        try {
            const handleItems = (items) => {
                if (!items) return
                if (items.atlas_lang) {
                    currentLang = items.atlas_lang
                } else if (items.atlas_voice_lang) {
                    currentLang = items.atlas_voice_lang
                    try {
                        chrome.storage.local.set({ atlas_lang: currentLang })
                    } catch (_) {}
                }
            }
            const res = chrome.storage.local.get(['atlas_lang', 'atlas_voice_lang'], (items) => {
                if (chrome.runtime?.lastError) return
                handleItems(items)
            })
            if (res && typeof res.then === 'function') {
                res.then(handleItems).catch(() => {})
            }
        } catch (_) {}
    }
}
loadStoredLanguage()

// Keep currentLang synced across tabs when chrome.storage changes
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes.atlas_lang && changes.atlas_lang.newValue) {
                    setLanguage(changes.atlas_lang.newValue, false)
                } else if (changes.atlas_voice_lang && changes.atlas_voice_lang.newValue) {
                    setLanguage(changes.atlas_voice_lang.newValue, false)
                }
            }
        })
    } catch (_) {}
}

const getLanguage = () => currentLang

const setLanguage = (lang, syncStorage = true) => {
    if (lang === 'ar-EG' || lang === 'en-US') {
        currentLang = lang
    } else if (typeof lang === 'string' && (lang.startsWith('ar') || lang === 'ar-EG')) {
        currentLang = 'ar-EG'
    } else {
        currentLang = 'en-US'
    }
    if (syncStorage && typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
        try {
            chrome.storage.local.set({ atlas_lang: currentLang, atlas_voice_lang: currentLang })
        } catch (_) {}
    }
    return currentLang
}

const isSupported = () => Boolean(SpeechRecognitionImpl)
const isListening = () => listening

const formatSpeechError = (errorCode) => {
    const isAr = currentLang === 'ar-EG'
    switch (errorCode) {
        case 'not-allowed':
        case 'service-not-allowed':
            return isAr
                ? 'تم رفض إذن الميكروفون أو التعرف على الصوت. يرجى النقر فوق أيقونة القفل في شريط العناوين والسماح بالوصول إلى الميكروفون.'
                : 'Microphone or speech recognition permission was denied. Please click the lock icon in your address bar and allow Microphone access.'
        case 'network':
            return isAr
                ? "فشل الاتصال بالتعرف الصوتي. في متصفح Brave، يتم تعطيل التعرف على الصوت افتراضياً. لتفعيله: انتقل إلى brave://settings/privacy وفعّل خيار التعرف الصوتي، أو اكتب طلباتك في مربع المحادثة."
                : "Voice recognition connection failed. In Brave browser, speech recognition is disabled by default for privacy. To enable it: go to brave://settings/privacy and toggle ON 'Use Google services for speech recognition', or type your requests in the chat box."
        case 'no-speech':
            return isAr
                ? 'لم يتم اكتشاف أي صوت. يرجى التحقق من مستوى صوت الميكروفون والتحدث بوضوح.'
                : 'No speech was detected. Please check your microphone volume and speak clearly.'
        case 'audio-capture':
            return isAr
                ? 'لم يتم العثور على ميكروفون في نظامك. يرجى التحقق من توصيل الميكروفون.'
                : 'No microphone was found on your system. Please verify your microphone is plugged in.'
        case 'aborted':
            return null // user intentionally stopped
        default:
            return isAr
                ? `خطأ في التعرف على الصوت (${errorCode}).`
                : `Speech recognition error (${errorCode}).`
    }
}

// ── Web Audio Analyser Lifecycle Management (Track U4) ──────────────────────
const stopAudioMeter = () => {
    if (animFrameId && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(animFrameId)
        animFrameId = null
    }
    if (sourceNode) {
        try { sourceNode.disconnect() } catch (_) {}
        sourceNode = null
    }
    if (analyserNode) {
        try { analyserNode.disconnect() } catch (_) {}
        analyserNode = null
    }
    if (mediaStream) {
        try {
            mediaStream.getTracks().forEach((track) => {
                try { track.stop() } catch (_) {}
            })
        } catch (_) {}
        mediaStream = null
    }
    if (audioContext) {
        try {
            if (audioContext.state !== 'closed' && typeof audioContext.close === 'function') {
                audioContext.close().catch(() => {})
            }
        } catch (_) {}
        audioContext = null
    }
}

const startAudioMeter = (stream, onAudioLevel) => {
    if (!AudioContextClass || !stream || !onAudioLevel) return

    try {
        audioContext = new AudioContextClass()
        if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
            audioContext.resume().catch(() => {})
        }

        sourceNode = audioContext.createMediaStreamSource(stream)
        analyserNode = audioContext.createAnalyser()
        analyserNode.fftSize = 64
        analyserNode.smoothingTimeConstant = 0.5

        sourceNode.connect(analyserNode)
        // CRITICAL NOTE: AnalyserNode is intentionally NOT connected to audioContext.destination
        // to strictly prevent acoustic howling/feedback into speakers.

        const bufferLength = analyserNode.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)

        const updateMeter = () => {
            if (!listening || !analyserNode) return

            analyserNode.getByteFrequencyData(dataArray)

            let sum = 0
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i]
            }
            const avg = sum / bufferLength
            const level = Math.min(1.0, (avg / 128) * 1.5)

            // 4 frequency bands for multi-bar visualizer
            const b0 = Math.min(1.0, (dataArray[1] || 0) / 140)
            const b1 = Math.min(1.0, (dataArray[4] || 0) / 140)
            const b2 = Math.min(1.0, (dataArray[10] || 0) / 140)
            const b3 = Math.min(1.0, (dataArray[20] || 0) / 140)

            onAudioLevel({
                level,
                bars: [b0, b1, b2, b3],
            })

            if (typeof requestAnimationFrame !== 'undefined') {
                animFrameId = requestAnimationFrame(updateMeter)
            }
        }

        if (typeof requestAnimationFrame !== 'undefined') {
            animFrameId = requestAnimationFrame(updateMeter)
        }
    } catch (err) {
        console.warn('Atlas: Failed to initialize Web Audio meter:', err)
        stopAudioMeter()
    }
}

const start = async ({ onResult, onInterim, onEnd, onError, onAudioLevel } = {}) => {
    if (!isSupported()) {
        onError?.(new Error('Speech recognition is not supported in this browser.'))
        return
    }
    if (listening) {
        stop()
        return
    }

    isStarting = true

    // Obtain MediaStream for Web Audio Analyser and permission check
    let stream = null
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            if (!isStarting) {
                // User aborted before permission prompt resolved
                stream.getTracks().forEach((t) => {
                    try { t.stop() } catch (_) {}
                })
                return
            }
            mediaStream = stream
        } catch (err) {
            isStarting = false
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                onError?.(new Error('Microphone permission was denied. Please allow microphone access in your browser address bar (click the lock/site settings icon next to the URL).'))
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                onError?.(new Error('No microphone detected on your system. Please connect a microphone.'))
            } else {
                onError?.(new Error(`Microphone access error: ${err.message}`))
            }
            onEnd?.()
            return
        }
    }

    try {
        recognition = new SpeechRecognitionImpl()
        recognition.lang = currentLang
        recognition.interimResults = true
        recognition.maxAlternatives = 1
        recognition.continuous = false

        let finalTranscript = ''

        recognition.onresult = (event) => {
            let interim = ''
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const res = event.results[i]
                if (res.isFinal) {
                    finalTranscript += res[0].transcript
                } else {
                    interim += res[0].transcript
                }
            }
            const current = (finalTranscript || interim).trim()
            if (current && onInterim) {
                onInterim(current)
            }
            if (finalTranscript) {
                const trimmedFinal = finalTranscript.trim()
                // Auto-sticky Arabic heuristic: if final transcript contains Arabic characters,
                // silently update stored language to 'ar-EG' for subsequent turns.
                if (/[\u0600-\u06FF]/.test(trimmedFinal)) {
                    setLanguage('ar-EG')
                }
                onResult?.(trimmedFinal)
            }
        }

        recognition.onerror = (event) => {
            stopAudioMeter()
            listening = false
            isStarting = false
            const msg = formatSpeechError(event.error)
            if (msg) {
                onError?.(new Error(msg))
            }
        }

        recognition.onend = () => {
            stopAudioMeter()
            listening = false
            isStarting = false
            onEnd?.()
        }

        listening = true
        isStarting = false

        if (stream && onAudioLevel) {
            startAudioMeter(stream, onAudioLevel)
        }

        recognition.start()
    } catch (err) {
        stopAudioMeter()
        listening = false
        isStarting = false
        onError?.(new Error(`Failed to start speech recognition: ${err.message}`))
        onEnd?.()
    }
}

const stop = () => {
    isStarting = false
    stopAudioMeter()
    if (recognition && listening) {
        try {
            recognition.stop()
        } catch (_) {}
    }
    listening = false
}

const AtlasSpeech = {
    isSupported,
    isListening,
    start,
    stop,
    getLanguage,
    setLanguage,
    stopAudioMeter,
    getAudioContext: () => audioContext,
    getMediaStream: () => mediaStream,
    getAnalyserNode: () => analyserNode,
}

if (typeof window !== 'undefined') {
    window.AtlasSpeech = AtlasSpeech
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AtlasSpeech
}
})();
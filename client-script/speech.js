(function () {
// speech.js
// Voice Input (Speech-to-Text)
// Wraps Web Speech API (SpeechRecognition) with pre-flight permission checks,
// interim results feedback, and Brave/Chromium diagnostics.
//
// Public API (window.AtlasSpeech):
//   AtlasSpeech.isSupported() -> boolean
//   AtlasSpeech.isListening() -> boolean
//   AtlasSpeech.start({ onResult, onInterim, onEnd, onError }) -> Promise<void>
//   AtlasSpeech.stop() -> void

const SpeechRecognitionImpl =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)

let recognition = null
let listening = false

const isSupported = () => Boolean(SpeechRecognitionImpl)
const isListening = () => listening

const formatSpeechError = (errorCode) => {
    switch (errorCode) {
        case 'not-allowed':
        case 'service-not-allowed':
            return 'Microphone or speech recognition permission was denied. Please click the lock icon in your address bar and allow Microphone access.'
        case 'network':
            return "Voice recognition connection failed. In Brave browser, speech recognition is disabled by default for privacy. To enable it: go to brave://settings/privacy and toggle ON 'Use Google services for speech recognition', or type your requests in the chat box."
        case 'no-speech':
            return 'No speech was detected. Please check your microphone volume and speak clearly.'
        case 'audio-capture':
            return 'No microphone was found on your system. Please verify your microphone is plugged in.'
        case 'aborted':
            return null // user intentionally stopped
        default:
            return `Speech recognition error (${errorCode}).`
    }
}

const checkMicrophonePermission = async () => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach((t) => t.stop())
            return true
        } catch (err) {
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                throw new Error('Microphone permission was denied. Please allow microphone access in your browser address bar (click the lock/site settings icon next to the URL).')
            }
            if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                throw new Error('No microphone detected on your system. Please connect a microphone.')
            }
            throw new Error(`Microphone access error: ${err.message}`)
        }
    }
    return true
}

const start = async ({ onResult, onInterim, onEnd, onError } = {}) => {
    if (!isSupported()) {
        onError?.(new Error('Speech recognition is not supported in this browser.'))
        return
    }
    if (listening) {
        stop()
        return
    }

    try {
        await checkMicrophonePermission()
    } catch (permErr) {
        onError?.(permErr)
        onEnd?.()
        return
    }

    try {
        recognition = new SpeechRecognitionImpl()
        recognition.lang = 'en-US'
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
                onResult?.(finalTranscript.trim())
            }
        }

        recognition.onerror = (event) => {
            listening = false
            const msg = formatSpeechError(event.error)
            if (msg) {
                onError?.(new Error(msg))
            }
        }

        recognition.onend = () => {
            listening = false
            onEnd?.()
        }

        listening = true
        recognition.start()
    } catch (err) {
        listening = false
        onError?.(new Error(`Failed to start speech recognition: ${err.message}`))
        onEnd?.()
    }
}

const stop = () => {
    if (recognition && listening) {
        try {
            recognition.stop()
        } catch (_) {}
    }
    listening = false
}

window.AtlasSpeech = { isSupported, isListening, start, stop }
})();
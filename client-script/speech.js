// speech.js
// Task B — handles audio only (per docs/conventions.md: speech.js only
// handles audio, no DOM manipulation beyond its own mic-status callback).
//
// Public API (window.AtlasSpeech):
//   AtlasSpeech.isSupported() -> boolean
//   AtlasSpeech.start({ onResult, onEnd, onError }) -> void
//   AtlasSpeech.stop() -> void

const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition

let recognition = null
let listening = false

const isSupported = () => Boolean(SpeechRecognitionImpl)

const start = ({ onResult, onEnd, onError } = {}) => {
  if (!isSupported()) {
    onError?.(new Error('Speech recognition is not supported in this browser.'))
    return
  }
  if (listening) return

  recognition = new SpeechRecognitionImpl()
  recognition.lang = 'en-US'
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  recognition.continuous = false

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim()
    onResult?.(transcript)
  }

  recognition.onerror = (event) => {
    onError?.(new Error(`Speech recognition error: ${event.error}`))
  }

  recognition.onend = () => {
    listening = false
    onEnd?.()
  }

  listening = true
  recognition.start()
}

const stop = () => {
  if (recognition && listening) recognition.stop()
}

window.AtlasSpeech = { isSupported, start, stop }

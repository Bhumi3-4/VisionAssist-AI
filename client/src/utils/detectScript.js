
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/

export function detectSpeechLang(text) {
  return DEVANAGARI_PATTERN.test(text || '') ? 'hi-IN' : 'en-US'
}

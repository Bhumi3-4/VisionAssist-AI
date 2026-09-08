const DEVANAGARI_RANGE = '\u0900-\u097F' // covers Hindi and Marathi, both written in Devanagari script
const VALID_CHAR_PATTERN = new RegExp(`[a-zA-Z0-9${DEVANAGARI_RANGE}]`, 'g')

export function isLikelyValidText(text, confidence, { minConfidence = 55, minLength = 3 } = {}) {
  const trimmed = (text || '').trim()

  if (trimmed.length < minLength) return false
  if (confidence < minConfidence) return false

  const validCharCount = (trimmed.match(VALID_CHAR_PATTERN) || []).length
  const ratio = validCharCount / trimmed.length

  return ratio >= 0.4
}

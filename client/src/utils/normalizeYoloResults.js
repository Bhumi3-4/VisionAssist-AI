/**
 * normalizeYoloResults
 * Converts whatever @ultralytics/yolo's predict() actually returns
 * into the SAME shape our COCO-SSD predictions already use:
 *   [{ class: 'stair', score: 0.82, bbox: [x, y, width, height] }, ...]
 *
 * WHY THIS IS WRITTEN DEFENSIVELY: we haven't yet confirmed the exact
 * output shape from a real browser console log (still pending as of
 * this integration). Rather than hardcode one guessed shape and risk
 * silently misreading obstacle data, this tries a couple of plausible
 * shapes and, if NONE match, logs the raw object and returns an empty
 * array -- the rest of the app then just behaves as if this model
 * found nothing this tick, which is the safe failure mode: existing
 * COCO-SSD detection is completely unaffected either way.
 *
 * ACTION ITEM once real console output is available: replace/confirm
 * the matching branch below against the actual shape, and remove the
 * others.
 */
export function normalizeYoloResults(raw, minScore = 0.5) {
  if (!raw) return []

  try {
    // Shape guess A: array of plain per-detection objects, e.g.
    // [{ class: 'stair', confidence: 0.8, box: [x, y, w, h] }, ...]
    // or with slightly different key names -- common in JS-ergonomic
    // wrappers (this is the shape COCO-SSD itself uses).
    if (Array.isArray(raw)) {
      return raw
        .map((det) => {
          const className = det.class ?? det.className ?? det.label ?? det.name
          const score = det.score ?? det.confidence ?? det.conf
          if (!className || score == null) return null

          // Explicit key name tells us the format -- no guessing.
          let bbox
          if (det.xyxy) {
            const [x1, y1, x2, y2] = det.xyxy
            bbox = [x1, y1, x2 - x1, y2 - y1]
          } else if (det.bbox ?? det.box ?? det.xywh) {
            bbox = det.bbox ?? det.box ?? det.xywh // assumed already [x, y, width, height]
          } else {
            return null
          }

          return { class: String(className), score: Number(score), bbox }
        })
        .filter((d) => d && d.score >= minScore)
    }

    // Shape guess B: Python-Results-style object, e.g.
    // raw.boxes.xyxy (array of [x1,y1,x2,y2]), raw.boxes.cls (class
    // indices), raw.boxes.conf (scores), raw.names (index -> label map)
    if (raw.boxes && raw.boxes.xyxy && raw.boxes.conf) {
      const { xyxy, cls, conf } = raw.boxes
      const names = raw.names || {}
      return xyxy
        .map((box, i) => {
          const score = Number(conf[i])
          if (score < minScore) return null
          const classIdx = cls ? cls[i] : null
          const className = names[classIdx] ?? String(classIdx ?? 'object')
          const [x1, y1, x2, y2] = box
          return { class: className, score, bbox: [x1, y1, x2 - x1, y2 - y1] }
        })
        .filter(Boolean)
    }

    // Neither shape matched -- log it so we can see the real structure
    // and fix this function, rather than guessing wrong silently.
    console.warn('normalizeYoloResults: unrecognized result shape, ignoring this tick. Raw value:', raw)
    return []
  } catch (err) {
    console.error('normalizeYoloResults: failed to parse, ignoring this tick.', err)
    return []
  }
}
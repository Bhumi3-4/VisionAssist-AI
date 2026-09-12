import { useEffect, useRef, useState, useCallback } from 'react'

// Forces @litertjs/core into the build's module graph as a real,
// resolved dependency. @ultralytics/yolo internally does a dynamic
// import('@litertjs/core') to load this as an "optional peer
// dependency" -- but that dynamic import was failing to resolve in
// BOTH dev mode and a real production build, which points to it not
// being a bundler-rewritable pattern at all. Statically importing it
// ourselves, once, anywhere in our own code, guarantees the bundler
// has already resolved and included it before that internal dynamic
// import ever runs.
import '@litertjs/core'

const MODEL_PATH = '/models/best.tflite'

/**
 * useYoloObstacleModel
 * Loads the custom-trained YOLO model (stairs/benches/crosswalks/
 * pedestrian lights) via @ultralytics/yolo + LiteRT.js.
 *
 * SAFETY DESIGN: this is entirely isolated from the existing,
 * already-working COCO-SSD obstacle detection. If this model fails to
 * load (wrong export format, browser doesn't support WebGPU/WASM,
 * network issue fetching the file, etc.), status just becomes 'error'
 * -- nothing else in the app is affected, and the existing obstacle
 * watch keeps working exactly as it did before this was added.
 *
 * It only starts loading when `enabled` is true, not on every page
 * load -- the model is ~40MB+, no reason to fetch it for users who
 * never turn obstacle watch on.
 */
export function useYoloObstacleModel(enabled) {
  const modelRef = useRef(null)
  const [status, setStatus] = useState('idle') // idle | loading | ready | error

  useEffect(() => {
    if (!enabled || modelRef.current || status === 'loading') return
    let cancelled = false

    async function loadModel() {
      setStatus('loading')
      try {
        // Dynamic import: keeps @ultralytics/yolo out of the main bundle
        // entirely until obstacle watch is actually turned on.
        const { YOLO } = await import('@ultralytics/yolo')
        const model = await YOLO.load(MODEL_PATH)
        if (cancelled) return
        modelRef.current = model
        setStatus('ready')
      } catch (err) {
        console.error('Custom obstacle model failed to load (falling back to standard detection only):', err)
        if (!cancelled) setStatus('error')
      }
    }

    loadModel()
    return () => {
      cancelled = true
    }
  }, [enabled, status])

  const predict = useCallback(async (videoEl) => {
    if (!modelRef.current || !videoEl) return null
    try {
      return await modelRef.current.predict(videoEl)
    } catch (err) {
      // A single failed prediction should never crash the obstacle
      // loop -- log it and let the caller treat it as "no result".
      console.error('Custom model prediction failed:', err)
      return null
    }
  }, [])

  return { status, predict }
}
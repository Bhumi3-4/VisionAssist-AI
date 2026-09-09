import { useEffect, useRef, useState, useCallback } from 'react'
import * as tmImage from '@teachablemachine/image'

const MODEL_URL = import.meta.env.VITE_TM_MODEL_URL

/**
 * useCustomObjectRecognition
 * Loads a user-trained Teachable Machine model (URL from .env) and
 * exposes predict(videoElement) -> { label, confidence } for the single
 * most likely class. This is a CLASSIFIER (what's the dominant thing
 * in frame), not a detector -- no bounding boxes, unlike COCO-SSD.
 *
 * If VITE_TM_MODEL_URL isn't set, status stays 'unavailable' and the
 * feature should be hidden -- this is optional, not required.
 */
export function useCustomObjectRecognition() {
  const modelRef = useRef(null)
  const [status, setStatus] = useState(MODEL_URL ? 'loading' : 'unavailable')

  useEffect(() => {
    if (!MODEL_URL) return
    let cancelled = false

    async function loadModel() {
      try {
        const model = await tmImage.load(`${MODEL_URL}model.json`, `${MODEL_URL}metadata.json`)
        if (cancelled) return
        modelRef.current = model
        setStatus('ready')
      } catch (err) {
        console.error('Failed to load custom object model:', err)
        if (!cancelled) setStatus('error')
      }
    }

    loadModel()
    return () => {
      cancelled = true
    }
  }, [])

  const predict = useCallback(async (videoEl) => {
    if (!modelRef.current || !videoEl) return null
    const predictions = await modelRef.current.predict(videoEl)
    const best = predictions.reduce((a, b) => (b.probability > a.probability ? b : a))
    return { label: best.className, confidence: best.probability }
  }, [])

  return { status, predict }
}

import { useEffect, useRef, useState, useCallback } from 'react'
import { createWorker, PSM } from 'tesseract.js'

/**
 * useTextRecognition
 * Loads Tesseract with English, Hindi, and Marathi language data
 * together (all three loaded once, Tesseract tries all simultaneously
 * per recognition -- no separate "pick a language" step needed from
 * the user). First load downloads all three trained-data files (a few
 * MB each), cached by the browser after that. Combined-language mode
 * is a bit slower per recognition than English-only, but means the
 * same "Read this" button just works regardless of which of the three
 * scripts is in front of the camera.
 */
export function useTextRecognition() {
  const workerRef = useRef(null)
  const [ocrStatus, setOcrStatus] = useState('loading') // loading | ready | error

  useEffect(() => {
    let cancelled = false

    async function loadWorker() {
      try {
        const worker = await createWorker(['eng', 'hin', 'mar'])
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
        if (cancelled) {
          worker.terminate()
          return
        }
        workerRef.current = worker
        setOcrStatus('ready')
      } catch (err) {
        console.error('Failed to load OCR engine:', err)
        if (!cancelled) setOcrStatus('error')
      }
    }

    loadWorker()
    return () => {
      cancelled = true
      workerRef.current?.terminate()
    }
  }, [])

  const recognize = useCallback(async (imageSource) => {
    if (!workerRef.current || !imageSource) return { text: '', confidence: 0 }
    const { data } = await workerRef.current.recognize(imageSource)
    return { text: data.text.trim(), confidence: data.confidence }
  }, [])

  return { ocrStatus, recognize }
}

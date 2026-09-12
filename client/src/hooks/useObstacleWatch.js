import { useCallback, useEffect, useRef, useState } from 'react'
import { assessObstacleRisk } from '../utils/obstacleDetection'
import { sampleCenterFrame, frameMotionEnergy, rollingBaseline } from '../utils/proximitySensor'
import { normalizeYoloResults } from '../utils/normalizeYoloResults'
import { playAlertBeep } from '../utils/alertSound'
import { speak } from '../utils/speech'

const CHECK_INTERVAL_MS = 800
const ALERT_COOLDOWN_MS = 4000

const BASELINE_HISTORY_SIZE = 6
const SPIKE_MULTIPLIER = 1.8
const MIN_ABSOLUTE_FLOOR = 12
const SUSTAINED_TICKS_REQUIRED = 2

export function useObstacleWatch({ videoRef, canvasRef, detect, yoloPredict, enabled }) {
  const [lastAlert, setLastAlert] = useState(null)
  const previousRef = useRef(null)
  const lastAlertTimeRef = useRef(0)
  const intervalRef = useRef(null)

  const prevSampleRef = useRef(null)
  const motionHistoryRef = useRef([])
  const sustainedHighRef = useRef(0)

  const tick = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const predictions = await detect(video)

    // Custom YOLO model (stairs/benches/crosswalks/pedestrian lights)
    // is ADDITIVE: if it's not provided, not loaded yet, or errors for
    // any reason, we just proceed with COCO-SSD's predictions alone --
    // exactly as this function behaved before this model existed.
    let combinedPredictions = predictions
    if (yoloPredict) {
      try {
        const rawYoloResult = await yoloPredict(video)
        const yoloPredictions = normalizeYoloResults(rawYoloResult)
        combinedPredictions = [...predictions, ...yoloPredictions]
      } catch (err) {
        console.error('Custom obstacle model prediction failed this tick, continuing with standard detection only:', err)
      }
    }

    const result = assessObstacleRisk(combinedPredictions, video.videoWidth, video.videoHeight, previousRef.current)
    if (result.label) previousRef.current = { class: result.label, areaRatio: result.areaRatio }

    let genericRisk = false
    const currentSample = sampleCenterFrame(video)
    const motion = frameMotionEnergy(prevSampleRef.current, currentSample)
    const baseline = rollingBaseline(motionHistoryRef.current)
    const haveEnoughHistory = motionHistoryRef.current.length >= BASELINE_HISTORY_SIZE

    if (result.risk === 'none') {
      const isSpike = haveEnoughHistory && motion > baseline * SPIKE_MULTIPLIER && motion > MIN_ABSOLUTE_FLOOR
      sustainedHighRef.current = isSpike ? sustainedHighRef.current + 1 : 0
      genericRisk = sustainedHighRef.current >= SUSTAINED_TICKS_REQUIRED

      if (!isSpike) {
        motionHistoryRef.current.push(motion)
        if (motionHistoryRef.current.length > BASELINE_HISTORY_SIZE) motionHistoryRef.current.shift()
      }
    } else {
      sustainedHighRef.current = 0
    }

    prevSampleRef.current = currentSample

    const now = Date.now()
    const shouldAlert = (result.risk !== 'none' || genericRisk) && now - lastAlertTimeRef.current > ALERT_COOLDOWN_MS

    if (shouldAlert) {
      lastAlertTimeRef.current = now
      playAlertBeep()
      let message
      if (result.risk === 'close') message = `Careful, ${result.label} very close ahead.`
      else if (result.risk === 'approaching') message = `${result.label} approaching.`
      else message = 'Stop. Something is very close ahead.'
      speak(message, { interrupt: true })
      setLastAlert(message)
    }

    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (result.risk !== 'none' && result.box) {
        const [x, y, w, h] = result.box
        ctx.strokeStyle = '#FF5C4D'
        ctx.lineWidth = 4
        ctx.strokeRect(x, y, w, h)
      } else if (genericRisk) {
        ctx.strokeStyle = '#FF5C4D'
        ctx.lineWidth = 10
        ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10)
      }
    }
  }, [videoRef, canvasRef, detect, yoloPredict])

  useEffect(() => {
    if (!enabled) {
      clearInterval(intervalRef.current)
      previousRef.current = null
      prevSampleRef.current = null
      motionHistoryRef.current = []
      sustainedHighRef.current = 0
      return
    }
    intervalRef.current = setInterval(tick, CHECK_INTERVAL_MS)
    return () => clearInterval(intervalRef.current)
  }, [enabled, tick])

  return { lastAlert }
}
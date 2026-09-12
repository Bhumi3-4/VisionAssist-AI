import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, FileText, RotateCcw, Square, HelpCircle, TriangleAlert, User, LogOut, History, Settings, Tag } from 'lucide-react'
import Header from './components/Header'
import CameraView from './components/CameraView'
import VoiceOrb from './components/VoiceOrb'
import StatusReadout from './components/StatusReadout'
import AccessibilityBar from './components/AccessibilityBar'
import CaptionDisplay from './components/CaptionDisplay'
import AuthPanel from './components/AuthPanel'
import HistoryPanel from './components/HistoryPanel'
import ActionButton from './components/ActionButton'
import { useCamera } from './hooks/useCamera'
import { useObjectDetection } from './hooks/useObjectDetection'
import { useYoloObstacleModel } from './hooks/useYoloObstacleModel'
import { useCustomObjectRecognition } from './hooks/useCustomObjectRecognition'
import { useTextRecognition } from './hooks/useTextRecognition'
import { useObstacleWatch } from './hooks/useObstacleWatch'
import { useVoiceCommands } from './hooks/useVoiceCommands'
import { describeObjects } from './utils/describeObjects'
import { drawDetections } from './utils/drawDetections'
import { captureFrame } from './utils/captureFrame'
import { isLikelyValidText } from './utils/textValidation'
import { detectSpeechLang } from './utils/detectScript'
import { matchCommand } from './utils/commands'
import { speak, stopSpeaking } from './utils/speech'
import { saveHistoryEntry, updatePreferences, getCurrentUser } from './utils/api'

const TEXT_SCALES = [100, 125, 150, 200]
const HELP_TEXT =
  'You can say: what\'s around me, read this, repeat, stop, zoom in, zoom out, bigger text, smaller text, watch for obstacles, stop obstacle watch, or help.'

function nearestScaleIndex(value) {
  let bestIdx = 0
  let bestDiff = Infinity
  TEXT_SCALES.forEach((scale, idx) => {
    const diff = Math.abs(scale - value)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = idx
    }
  })
  return bestIdx
}

function clampZoom(z) {
  return Math.min(3, Math.max(1, +z.toFixed(1)))
}

export default function App() {
  const [status, setStatus] = useState('Point the camera, then tap a button below.')
  const [caption, setCaption] = useState('')
  const [fontScale, setFontScale] = useState(100)
  const [highContrast, setHighContrast] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [obstacleOn, setObstacleOn] = useState(false)

  const [token, setToken] = useState(() => localStorage.getItem('vaToken'))
  const [user, setUser] = useState(null)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAccountPanel, setShowAccountPanel] = useState(false)

  const { videoRef, status: cameraStatus, errorMessage } = useCamera()
  const canvasRef = useRef(null)
  const { modelStatus, detect } = useObjectDetection()
  const { status: customModelStatus, predict: predictCustom } = useCustomObjectRecognition()
  const { ocrStatus, recognize } = useTextRecognition()

  const obstacleEnabled = obstacleOn && modelStatus === 'ready' && cameraStatus === 'ready'
  const { predict: predictYoloObstacles } = useYoloObstacleModel(obstacleEnabled)
  const { lastAlert } = useObstacleWatch({
    videoRef,
    canvasRef,
    detect,
    yoloPredict: predictYoloObstacles,
    enabled: obstacleEnabled,
  })

  useEffect(() => {
    if (lastAlert) {
      setCaption(lastAlert)
      if (token) saveHistoryEntry(token, { type: 'obstacle-alert', resultText: lastAlert }).catch(() => {})
    }
  }, [lastAlert, token])

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale}%`
  }, [fontScale])

  useEffect(() => {
    document.body.classList.toggle('high-contrast', highContrast)
  }, [highContrast])

  useEffect(() => {
    if (!token) return
    const timeout = setTimeout(() => {
      updatePreferences(token, { fontScale, highContrast }).catch(() => {})
    }, 600)
    return () => clearTimeout(timeout)
  }, [token, fontScale, highContrast])

  // Restores `user` after a page refresh: the token survives in
  // localStorage, but React state doesn't, so without this you'd see
  // "Logged in" with no name and preferences wouldn't re-apply.
  useEffect(() => {
    if (!token || user) return
    let cancelled = false

    getCurrentUser(token)
      .then((data) => {
        if (cancelled || !data) return
        setUser(data.user ?? data)
        const prefs = data.user?.preferences ?? data.preferences
        if (prefs) {
          if (typeof prefs.fontScale === 'number') {
            setFontScale(TEXT_SCALES[nearestScaleIndex(prefs.fontScale)])
          }
          if (typeof prefs.highContrast === 'boolean') {
            setHighContrast(prefs.highContrast)
          }
        }
      })
      .catch((err) => {
        if (cancelled) return
        // Only clear the token if it's ACTUALLY invalid/expired (401).
        // Any other failure -- network error, Render free-tier cold
        // start, a transient 500 -- means we simply don't know yet,
        // and shouldn't force a valid session to log out over it.
        if (err.status === 401) {
          localStorage.removeItem('vaToken')
          setToken(null)
        } else {
          console.warn('Could not restore session (will retry on next reload):', err.message)
        }
      })

    return () => {
      cancelled = true
    }
  }, [token, user])

  useEffect(() => {
    if (modelStatus === 'loading') setStatus('Loading detection model… (first time only)')
    if (modelStatus === 'ready' && cameraStatus === 'ready') {
      setStatus('Point the camera, then tap a button below.')
    }
    if (modelStatus === 'error') setStatus('Could not load the detection model. Check your connection and reload.')
  }, [modelStatus, cameraStatus])

  function handleAuthSuccess(newToken, newUser) {
    localStorage.setItem('vaToken', newToken)
    setToken(newToken)
    setUser(newUser)
    setShowAccountPanel(false)
    if (newUser?.preferences) {
      const incomingScale = newUser.preferences.fontScale ?? 100
      setFontScale(TEXT_SCALES[nearestScaleIndex(incomingScale)])
      setHighContrast(Boolean(newUser.preferences.highContrast))
    }
    speak(`Welcome, ${newUser.name}`)
  }

  function handleLogout() {
    localStorage.removeItem('vaToken')
    setToken(null)
    setUser(null)
    setShowHistoryPanel(false)
    speak('Logged out')
  }

  const handleDetect = useCallback(async () => {
    if (!videoRef.current || modelStatus !== 'ready') return
    setStatus('Looking…')
    const predictions = await detect(videoRef.current)
    drawDetections(canvasRef.current, videoRef.current, predictions)
    const description = describeObjects(predictions)
    setCaption(description)
    setStatus('Done.')
    speak(description)
    if (token) saveHistoryEntry(token, { type: 'object-detection', resultText: description }).catch(() => {})
  }, [detect, modelStatus, videoRef, token])

  const CUSTOM_CONFIDENCE_THRESHOLD = 0.7

  const handleCustomIdentify = useCallback(async () => {
    if (!videoRef.current || customModelStatus !== 'ready') return
    setStatus('Checking your trained objects…')
    const result = await predictCustom(videoRef.current)
    if (!result || result.confidence < CUSTOM_CONFIDENCE_THRESHOLD) {
      const message = "I'm not confident enough to identify this as one of your trained items."
      setCaption(message)
      setStatus('Done.')
      speak(message)
      return
    }
    const description = `This looks like your ${result.label}.`
    setCaption(description)
    setStatus('Done.')
    speak(description)
    if (token) saveHistoryEntry(token, { type: 'object-detection', resultText: description }).catch(() => {})
  }, [predictCustom, customModelStatus, videoRef, token])

  const handleRead = useCallback(async () => {
    if (!videoRef.current || ocrStatus !== 'ready') {
      const message = ocrStatus === 'loading' ? 'The text reader is still loading, one moment.' : 'Text reader is not available.'
      setCaption(message)
      speak(message)
      return
    }
    setStatus('Reading… hold the camera steady.')
    const frame = captureFrame(videoRef.current)
    const { text, confidence } = await recognize(frame)

    if (!isLikelyValidText(text, confidence)) {
      const message = "I couldn't find any readable text. Try moving closer, holding steady, or improving lighting."
      setCaption(message)
      setStatus('Done.')
      speak(message)
      return
    }

    setCaption(text)
    setStatus('Done.')
    speak(text, { lang: detectSpeechLang(text) })
    if (token) saveHistoryEntry(token, { type: 'text-recognition', resultText: text }).catch(() => {})
  }, [ocrStatus, recognize, videoRef, token])

  const handleRepeat = useCallback(() => {
    if (!caption) {
      speak('Nothing to repeat yet.')
      return
    }
    speak(caption)
  }, [caption])

  const handleStop = useCallback(() => {
    stopSpeaking()
    setStatus('Stopped.')
  }, [])

  const handleZoomIn = useCallback(() => setZoom((z) => clampZoom(z + 0.2)), [])
  const handleZoomOut = useCallback(() => setZoom((z) => clampZoom(z - 0.2)), [])

  const handleTextBigger = useCallback(() => {
    setFontScale((s) => {
      const idx = nearestScaleIndex(s)
      const nextIdx = s >= TEXT_SCALES[idx] ? Math.min(TEXT_SCALES.length - 1, idx + 1) : idx
      return TEXT_SCALES[nextIdx]
    })
  }, [])

  const handleTextSmaller = useCallback(() => {
    setFontScale((s) => {
      const idx = nearestScaleIndex(s)
      const nextIdx = s <= TEXT_SCALES[idx] ? Math.max(0, idx - 1) : idx
      return TEXT_SCALES[nextIdx]
    })
  }, [])

  const handleObstacleOn = useCallback(() => {
    setObstacleOn(true)
    setStatus('Obstacle watch on. Alerts will interrupt speech.')
    speak('Obstacle watch on')
  }, [])

  const handleObstacleOff = useCallback(() => {
    setObstacleOn(false)
    setStatus('Obstacle watch off.')
    speak('Obstacle watch off')
  }, [])

  const handleHelp = useCallback(() => {
    setCaption(HELP_TEXT)
    speak(HELP_TEXT)
  }, [])

  const runAction = useCallback(
    (action) => {
      const actions = {
        detect: handleDetect,
        read: handleRead,
        repeat: handleRepeat,
        stop: handleStop,
        zoomIn: handleZoomIn,
        zoomOut: handleZoomOut,
        textBigger: handleTextBigger,
        textSmaller: handleTextSmaller,
        obstacleOn: handleObstacleOn,
        obstacleOff: handleObstacleOff,
        help: handleHelp,
      }
      actions[action]?.()
    },
    [handleDetect, handleRead, handleRepeat, handleStop, handleZoomIn, handleZoomOut, handleTextBigger, handleTextSmaller, handleObstacleOn, handleObstacleOff, handleHelp],
  )

  const handleTranscript = useCallback(
    (transcript) => {
      const action = matchCommand(transcript)
      if (action) {
        setStatus(`Heard: "${transcript}" → running command.`)
        runAction(action)
      } else {
        setStatus(`Heard: "${transcript}" — didn't recognize that. Say "help" to hear commands.`)
        speak("Sorry, I didn't understand that. Say help to hear what you can say.")
      }
    },
    [runAction],
  )

  const { isSupported: voiceSupported, isListening, start, stop } = useVoiceCommands({ onTranscript: handleTranscript })

  function handleOrbClick() {
    if (isListening) {
      stop()
      setStatus('Stopped listening.')
    } else {
      setStatus('Listening…')
      start()
    }
  }

  const detectDisabled = modelStatus !== 'ready' || cameraStatus !== 'ready'

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-lg) var(--space-md)', textAlign: 'center' }}>
      <Header />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
        <ActionButton icon={Settings} iconOnly aria-label="Accessibility settings" aria-pressed={showSettings} onClick={() => setShowSettings((v) => !v)}>
          Accessibility settings
        </ActionButton>
        <ActionButton icon={User} iconOnly aria-label={token ? `Account menu, logged in as ${user?.name || 'you'}` : 'Log in or register'} aria-pressed={showAccountPanel} onClick={() => setShowAccountPanel((v) => !v)}>
          {token ? 'Account menu' : 'Log in or register'}
        </ActionButton>
      </div>

      {showAccountPanel &&
        (token ? (
          <div className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{user ? `Logged in as ${user.name}` : 'Logged in'}</span>
            <ActionButton icon={History} onClick={() => setShowHistoryPanel((v) => !v)}>{showHistoryPanel ? 'Hide history' : 'View history'}</ActionButton>
            <ActionButton icon={LogOut} onClick={handleLogout}>Log out</ActionButton>
          </div>
        ) : (
          <AuthPanel onAuthSuccess={handleAuthSuccess} onSkip={() => setShowAccountPanel(false)} />
        ))}
      {showHistoryPanel && token && <HistoryPanel token={token} />}

      {showSettings && (
        <AccessibilityBar fontScale={fontScale} onFontScaleChange={setFontScale} highContrast={highContrast} onToggleContrast={setHighContrast} zoom={zoom} onZoomChange={(z) => setZoom(clampZoom(z))} />
      )}

      <CameraView videoRef={videoRef} canvasRef={canvasRef} status={cameraStatus} errorMessage={errorMessage} zoom={zoom} />

      <ActionButton icon={Search} variant="accent" onClick={handleDetect} disabled={detectDisabled} style={{ width: '100%', height: '3.5rem', margin: 'var(--space-md) 0 var(--space-sm)', justifyContent: 'center' }}>
        What's around me
      </ActionButton>

      {customModelStatus !== 'unavailable' && (
        <ActionButton icon={Tag} onClick={handleCustomIdentify} disabled={customModelStatus !== 'ready'} style={{ width: '100%', height: '3.5rem', marginBottom: 'var(--space-sm)', justifyContent: 'center' }}>
          {customModelStatus === 'loading' ? 'Loading your trained objects…' : 'Identify my item'}
        </ActionButton>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
        <ActionButton icon={FileText} onClick={handleRead} disabled={ocrStatus !== 'ready'}>Read this</ActionButton>
        <ActionButton icon={RotateCcw} onClick={handleRepeat}>Repeat</ActionButton>
        <ActionButton icon={Square} variant="danger" active onClick={handleStop}>Stop</ActionButton>
        <ActionButton icon={HelpCircle} onClick={handleHelp}>Help</ActionButton>
        <ActionButton icon={TriangleAlert} variant="danger" active={obstacleOn} aria-pressed={obstacleOn} onClick={obstacleOn ? handleObstacleOff : handleObstacleOn} disabled={detectDisabled}>
          Obstacle watch: {obstacleOn ? 'On' : 'Off'}
        </ActionButton>
      </div>

      <CaptionDisplay text={caption} />

      <div style={{ margin: 'var(--space-lg) 0', display: 'flex', justifyContent: 'center' }}>
        <VoiceOrb listening={isListening} supported={voiceSupported} onClick={handleOrbClick} />
      </div>

      <StatusReadout message={status} />
    </div>
  )
}
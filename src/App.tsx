import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useScribe } from '@elevenlabs/react'
import { InstallPrompt } from './components/InstallPrompt'
import { usePWAInstall } from './hooks/usePWAInstall'
import './App.css'

type Mode = 'local' | 'elevenlabs-realtime' | 'elevenlabs-batch'
type AppStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'post-processing' | 'error'

type SpeechRecognitionResultLike = {
  isFinal: boolean
  0: { transcript: string }
}

type SpeechRecognitionEventLike = Event & {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: ((event: Event) => void) | null
  onend: ((event: Event) => void) | null
  onerror: ((event: Event & { error?: string }) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  start(): void
  stop(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type PersistedSettings = {
  mode: Mode
  apiKey: string
  language: string
  text: string
  processedText: string
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  llmPrompt: string
  compactMode: boolean
  autoCopyTranscript: boolean
  autoCopyProcessed: boolean
  shortcutsEnabled: boolean
}

type StoredItem = { key: string; value: PersistedSettings }

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

const APP_BASE_URL = import.meta.env.BASE_URL

const DEFAULT_SETTINGS: PersistedSettings = {
  mode: 'local',
  apiKey: '',
  language: '',
  text: '',
  processedText: '',
  llmApiKey: '',
  llmBaseUrl: '',
  llmModel: '',
  llmPrompt: '请将下面这段转写文本整理成更清晰、更适合发送的中文。保留原意，修正口语、重复、语气词和明显识别错误，只输出最终文本。',
  compactMode: false,
  autoCopyTranscript: true,
  autoCopyProcessed: true,
  shortcutsEnabled: true,
}

const DB_NAME = 'dictation-prototype-db'
const STORE_NAME = 'settings'
const SETTINGS_KEY = 'app'
const DEFAULT_SHORTCUT_LABEL = 'Ctrl/⌘ + Shift + Space'
const SHORTCUTS = [
  { label: '录音开关', combo: 'Ctrl/⌘ + Shift + Space' },
  { label: '后处理', combo: 'Ctrl/⌘ + Shift + P' },
  { label: '快速复制', combo: 'Ctrl/⌘ + Shift + C' },
  { label: '切换胶囊模式', combo: 'Ctrl/⌘ + Shift + M' },
  { label: '停止录音', combo: 'Esc' },
]

const LANGUAGES = [
  { value: '', label: 'Auto detect' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
]

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function openSettingsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function loadSettings(): Promise<PersistedSettings> {
  const db = await openSettingsDb()
  return await new Promise<PersistedSettings>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(SETTINGS_KEY)
    request.onerror = () => reject(request.error ?? new Error('Failed to read settings'))
    request.onsuccess = () => {
      const result = request.result as StoredItem | undefined
      resolve(result?.value ? { ...DEFAULT_SETTINGS, ...result.value } : DEFAULT_SETTINGS)
    }
  }).finally(() => db.close())
}

async function saveSettings(settings: PersistedSettings): Promise<void> {
  const db = await openSettingsDb()
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save settings'))
    tx.objectStore(STORE_NAME).put({ key: SETTINGS_KEY, value: settings })
  }).finally(() => db.close())
}

async function fetchRealtimeToken(apiKey: string): Promise<string> {
  const response = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
  })
  const data = (await response.json().catch(() => ({}))) as { token?: string; detail?: { message?: string } | string; error?: string }
  if (!response.ok || !data.token) {
    throw new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || data.error || 'Failed to fetch realtime token')
  }
  return data.token
}

async function transcribeBatch(blob: Blob, apiKey: string, language: string): Promise<string> {
  const formData = new FormData()
  formData.set('model_id', 'scribe_v2')
  formData.set('file', new File([blob], 'speech.webm', { type: blob.type || 'audio/webm' }))
  if (language) formData.set('language_code', language)

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    body: formData,
  })
  const data = (await response.json().catch(() => ({}))) as { text?: string; detail?: { message?: string } | string; error?: string }
  if (!response.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || data.error || 'Batch transcription failed')
  }
  return data.text?.trim() || ''
}

async function postProcessWithLlm(config: {
  apiKey: string
  baseUrl: string
  model: string
  prompt: string
  text: string
}): Promise<string> {
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: config.prompt },
        { role: 'user', content: config.text },
      ],
      temperature: 0.2,
    }),
  })
  const data = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
    error?: { message?: string } | string
  }
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'LLM post-processing failed')
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((item) => item.text || '').join('').trim()
  throw new Error('LLM returned no content')
}

function App() {
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [mode, setMode] = useState<Mode>(DEFAULT_SETTINGS.mode)
  const [apiKey, setApiKey] = useState(DEFAULT_SETTINGS.apiKey)
  const [language, setLanguage] = useState(DEFAULT_SETTINGS.language)
  const [text, setText] = useState(DEFAULT_SETTINGS.text)
  const [processedText, setProcessedText] = useState(DEFAULT_SETTINGS.processedText)
  const [llmApiKey, setLlmApiKey] = useState(DEFAULT_SETTINGS.llmApiKey)
  const [llmBaseUrl, setLlmBaseUrl] = useState(DEFAULT_SETTINGS.llmBaseUrl)
  const [llmModel, setLlmModel] = useState(DEFAULT_SETTINGS.llmModel)
  const [llmPrompt, setLlmPrompt] = useState(DEFAULT_SETTINGS.llmPrompt)
  const [compactMode, setCompactMode] = useState(DEFAULT_SETTINGS.compactMode)
  const [autoCopyTranscript, setAutoCopyTranscript] = useState(DEFAULT_SETTINGS.autoCopyTranscript)
  const [autoCopyProcessed, setAutoCopyProcessed] = useState(DEFAULT_SETTINGS.autoCopyProcessed)
  const [shortcutsEnabled, setShortcutsEnabled] = useState(DEFAULT_SETTINGS.shortcutsEnabled)
  const [status, setStatus] = useState<AppStatus>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(true)
  const [showPwaDebug, setShowPwaDebug] = useState(false)
  const [swStatus, setSwStatus] = useState('checking')
  const [manifestStatus, setManifestStatus] = useState('checking')
  const [realtimePartialText, setRealtimePartialText] = useState('')
  const [recentCommittedText, setRecentCommittedText] = useState('')

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const transcriptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptHighlightRef = useRef<HTMLDivElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const baseTextRef = useRef('')
  const finalizedTextRef = useRef('')
  const realtimeBaseTextRef = useRef('')
  const realtimeCommittedRef = useRef('')
  const stoppingLocalRef = useRef(false)
  const recentCommittedTimerRef = useRef<number | null>(null)
  const stoppingRealtimeRef = useRef(false)
  const stoppingBatchRef = useRef(false)
  const scribeDisconnectRef = useRef<() => void>(() => undefined)

  const { canInstall, canInstallIOS, isStandalone, promptInstall, installState, debug: pwaDebug } = usePWAInstall()

  useEffect(() => {
    let cancelled = false
    void loadSettings().then((saved) => {
      if (cancelled) return
      setMode(saved.mode)
      setApiKey(saved.apiKey)
      setLanguage(saved.language)
      setText(saved.text)
      setProcessedText(saved.processedText)
      setLlmApiKey(saved.llmApiKey)
      setLlmBaseUrl(saved.llmBaseUrl)
      setLlmModel(saved.llmModel)
      setLlmPrompt(saved.llmPrompt)
      setCompactMode(saved.compactMode)
      setAutoCopyTranscript(saved.autoCopyTranscript)
      setAutoCopyProcessed(saved.autoCopyProcessed)
      setShortcutsEnabled(saved.shortcutsEnabled)
      setShowAdvanced(!saved.compactMode)
      setSettingsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!settingsLoaded) return
    void saveSettings({
      mode,
      apiKey,
      language,
      text,
      processedText,
      llmApiKey,
      llmBaseUrl,
      llmModel,
      llmPrompt,
      compactMode,
      autoCopyTranscript,
      autoCopyProcessed,
      shortcutsEnabled,
    })
  }, [settingsLoaded, mode, apiKey, language, text, processedText, llmApiKey, llmBaseUrl, llmModel, llmPrompt, compactMode, autoCopyTranscript, autoCopyProcessed, shortcutsEnabled])



  const canUseLocal = typeof window !== 'undefined' && getRecognitionConstructor() !== null
  const canUseMediaRecorder = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined'
  const isBusy = status === 'connecting' || status === 'listening' || status === 'processing' || status === 'post-processing'
  const stopDisabled = status === 'idle' || status === 'error' || status === 'post-processing'
  const needsApiKey = mode !== 'local'

  const writeClipboard = useCallback(async (value: string, label: string) => {
    if (!value.trim()) return
    try {
      await navigator.clipboard.writeText(value)
      setNotice(`${label} 已复制到剪贴板。`)
    } catch {
      setNotice(`无法自动复制 ${label}，请手动复制。`)
    }
  }, [])

  const scribe = useScribe({
    modelId: 'scribe_v2_realtime',
    onConnect: () => {
      stoppingRealtimeRef.current = false
      setStatus('listening')
      setError('')
      setNotice('')
      setRealtimePartialText('')
      setRecentCommittedText('')
    },
    onDisconnect: () => {
      setStatus((current) => (current === 'error' || current === 'processing' || current === 'post-processing' ? current : 'idle'))
      stoppingRealtimeRef.current = false
      setRealtimePartialText('')
      setRecentCommittedText('')
    },
    onPartialTranscript: ({ text: partial }) => {
      setRealtimePartialText(partial.trim())
      const combined = `${realtimeCommittedRef.current} ${partial}`.trim()
      setText(realtimeBaseTextRef.current ? `${realtimeBaseTextRef.current} ${combined}`.trim() : combined)
    },
    onCommittedTranscript: ({ text: committed }) => {
      const committedChunk = committed.trim()
      realtimeCommittedRef.current = `${realtimeCommittedRef.current} ${committedChunk}`.trim()
      setRealtimePartialText('')
      setRecentCommittedText(committedChunk)
      if (recentCommittedTimerRef.current !== null) window.clearTimeout(recentCommittedTimerRef.current)
      recentCommittedTimerRef.current = window.setTimeout(() => {
        setRecentCommittedText('')
        recentCommittedTimerRef.current = null
      }, 1400)
      const combined = realtimeCommittedRef.current.trim()
      setText(realtimeBaseTextRef.current ? `${realtimeBaseTextRef.current} ${combined}`.trim() : combined)
    },
    onError: (event) => {
      if (stoppingRealtimeRef.current) {
        stoppingRealtimeRef.current = false
        setStatus('idle')
        return
      }
      setStatus('error')
      setError(getErrorMessage(event))
    },
  })

  useEffect(() => {
    scribeDisconnectRef.current = scribe.disconnect
  }, [scribe.disconnect])

  const statusText = useMemo(() => {
    switch (status) {
      case 'connecting': return 'Connecting...'
      case 'listening': return 'Listening...'
      case 'processing': return 'Processing audio...'
      case 'post-processing': return 'LLM post-processing...'
      case 'error': return 'Error'
      default: return 'Idle'
    }
  }, [status])

  const stopLocal = useCallback(() => {
    if (!recognitionRef.current) return setStatus('idle')
    stoppingLocalRef.current = true
    recognitionRef.current.stop()
  }, [])

  const stopRealtime = useCallback(() => {
    stoppingRealtimeRef.current = true
    if (scribe.isConnected || scribe.status === 'connecting') scribe.disconnect()
    else {
      stoppingRealtimeRef.current = false
      setStatus('idle')
    }
  }, [scribe])

  const stopBatch = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return setStatus('idle')
    stoppingBatchRef.current = true
    recorderRef.current.stop()
  }, [])

  const stopCurrent = useCallback(() => {
    if (mode === 'local') return stopLocal()
    if (mode === 'elevenlabs-realtime') return stopRealtime()
    return stopBatch()
  }, [mode, stopBatch, stopLocal, stopRealtime])

  const startLocal = useCallback(() => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      setStatus('error')
      setError('This browser does not support Web Speech API.')
      return
    }
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = language || navigator.language || 'en-US'
    baseTextRef.current = text
    finalizedTextRef.current = ''
    stoppingLocalRef.current = false

    recognition.onstart = () => {
      setStatus('listening')
      setError('')
      setNotice('')
    }
    recognition.onresult = (event) => {
      let finalChunk = ''
      let interimChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i]?.[0]?.transcript ?? ''
        if (!transcript.trim()) continue
        if (event.results[i].isFinal) finalChunk += `${transcript} `
        else interimChunk += `${transcript} `
      }
      if (finalChunk.trim()) finalizedTextRef.current = `${finalizedTextRef.current} ${finalChunk}`.trim()
      const merged = `${finalizedTextRef.current} ${interimChunk}`.trim()
      setText(baseTextRef.current ? `${baseTextRef.current} ${merged}`.trim() : merged)
    }
    recognition.onerror = (event) => {
      if (stoppingLocalRef.current || event.error === 'aborted') return
      setStatus('error')
      setError(event.error || 'Speech recognition failed')
    }
    recognition.onend = () => {
      recognitionRef.current = null
      const wasStopping = stoppingLocalRef.current
      stoppingLocalRef.current = false
      setStatus((current) => (current === 'error' && !wasStopping ? current : 'idle'))
      if (wasStopping && autoCopyTranscript) void writeClipboard(text, 'Transcript')
    }
    recognitionRef.current = recognition
    setStatus('connecting')
    setError('')
    setNotice('')
    recognition.start()
  }, [autoCopyTranscript, language, text, writeClipboard])

  const startRealtime = useCallback(async () => {
    if (!apiKey.trim()) {
      setStatus('error')
      setError('Please provide an ElevenLabs API key.')
      return
    }
    try {
      setStatus('connecting')
      setError('')
      setNotice('')
      stoppingRealtimeRef.current = false
      realtimeBaseTextRef.current = text
      realtimeCommittedRef.current = ''
      scribe.clearTranscripts()
      setRealtimePartialText('')
      setRecentCommittedText('')
      if (recentCommittedTimerRef.current !== null) {
        window.clearTimeout(recentCommittedTimerRef.current)
        recentCommittedTimerRef.current = null
      }
      const token = await fetchRealtimeToken(apiKey.trim())
      await scribe.connect({
        token,
        modelId: 'scribe_v2_realtime',
        languageCode: language || undefined,
        microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
    } catch (err) {
      setStatus('error')
      setError(getErrorMessage(err))
    }
  }, [apiKey, language, scribe, text])

  const startBatch = useCallback(async () => {
    if (!apiKey.trim()) {
      setStatus('error')
      setError('Please provide an ElevenLabs API key.')
      return
    }
    if (!canUseMediaRecorder) {
      setStatus('error')
      setError('This browser does not support MediaRecorder.')
      return
    }
    try {
      setStatus('connecting')
      setError('')
      setNotice('')
      chunksRef.current = []
      baseTextRef.current = text
      stoppingBatchRef.current = false
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.onstart = () => setStatus('listening')
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data) }
      recorder.onerror = () => {
        if (stoppingBatchRef.current) return
        setStatus('error')
        setError('Audio recording failed')
      }
      recorder.onstop = async () => {
        try {
          setStatus('processing')
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          if (blob.size > 0) {
            const transcript = await transcribeBatch(blob, apiKey.trim(), language)
            const next = baseTextRef.current ? `${baseTextRef.current} ${transcript}`.trim() : transcript
            setText(next)
            if (autoCopyTranscript) await writeClipboard(next, 'Transcript')
          }
          setStatus('idle')
        } catch (err) {
          setStatus('error')
          setError(getErrorMessage(err))
        } finally {
          streamRef.current?.getTracks().forEach((track) => track.stop())
          streamRef.current = null
          recorderRef.current = null
          chunksRef.current = []
          stoppingBatchRef.current = false
        }
      }
      recorder.start()
    } catch (err) {
      setStatus('error')
      setError(getErrorMessage(err))
    }
  }, [apiKey, autoCopyTranscript, canUseMediaRecorder, language, text, writeClipboard])

  const startCurrent = useCallback(async () => {
    if (isBusy) return
    if (mode === 'local') return startLocal()
    if (mode === 'elevenlabs-realtime') return startRealtime()
    return startBatch()
  }, [isBusy, mode, startBatch, startLocal, startRealtime])

  const toggleRecording = useCallback(async () => {
    if (isBusy) stopCurrent()
    else await startCurrent()
  }, [isBusy, startCurrent, stopCurrent])

  const handlePostProcess = useCallback(async () => {
    if (!text.trim()) {
      setStatus('error')
      setError('Please provide transcript text first.')
      return
    }
    if (!llmApiKey.trim() || !llmBaseUrl.trim() || !llmModel.trim() || !llmPrompt.trim()) {
      setStatus('error')
      setError('Please complete the LLM configuration and prompt.')
      return
    }
    try {
      setStatus('post-processing')
      setError('')
      setNotice('')
      const result = await postProcessWithLlm({ apiKey: llmApiKey.trim(), baseUrl: llmBaseUrl.trim(), model: llmModel.trim(), prompt: llmPrompt.trim(), text })
      setProcessedText(result)
      if (autoCopyProcessed) await writeClipboard(result, 'Processed text')
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(getErrorMessage(err))
    }
  }, [autoCopyProcessed, llmApiKey, llmBaseUrl, llmModel, llmPrompt, text, writeClipboard])

  const toggleCompactMode = useCallback(() => {
    setCompactMode((value) => {
      const next = !value
      setShowAdvanced(!next)
      return next
    })
  }, [])

  const handleInstall = useCallback(async () => {
    if (isStandalone) {
      setNotice('当前已经以应用模式运行。')
      return
    }

    if (canInstallIOS) {
      setNotice('当前浏览器需要通过菜单手动安装，请使用下方浮动提示。')
      return
    }

    if (!canInstall) {
      setNotice('浏览器暂时还没有提供安装事件。通常需要先满足 PWA 条件并与页面交互一会儿。')
      return
    }

    const success = await promptInstall()
    setNotice(success ? '已触发安装。' : '安装提示已关闭。')
  }, [canInstall, canInstallIOS, isStandalone, promptInstall])

  useEffect(() => {
    if (!shortcutsEnabled) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isFormTarget = Boolean(target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      const hasPrimaryModifier = event.shiftKey && (event.ctrlKey || event.metaKey)

      if (event.key === 'Escape' && isBusy) {
        event.preventDefault()
        stopCurrent()
        return
      }

      if (!shortcutsEnabled || !hasPrimaryModifier) return
      if (isFormTarget) return

      if (event.code === 'Space') {
        event.preventDefault()
        void toggleRecording()
        return
      }
      if (event.code === 'KeyP') {
        event.preventDefault()
        void handlePostProcess()
        return
      }
      if (event.code === 'KeyC') {
        event.preventDefault()
        void writeClipboard(processedText || text, processedText ? 'Processed text' : 'Transcript')
        return
      }
      if (event.code === 'KeyM') {
        event.preventDefault()
        toggleCompactMode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handlePostProcess, isBusy, processedText, shortcutsEnabled, stopCurrent, text, toggleCompactMode, toggleRecording, writeClipboard])

  useEffect(() => {
    const checkSw = async () => {
      try {
        if (!('serviceWorker' in navigator)) {
          setSwStatus('unsupported')
          return
        }
        const registration = await navigator.serviceWorker.getRegistration(APP_BASE_URL)
        setSwStatus(registration ? 'registered' : 'not-registered')
      } catch (error) {
        setSwStatus(`error: ${getErrorMessage(error)}`)
      }
    }

    void checkSw()
    const timer = window.setTimeout(() => { void checkSw() }, 2000)

    const handlePwaStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; error?: string }>).detail
      if (!detail?.type) return
      if (detail.type === 'registered' || detail.type === 'offline-ready') {
        setSwStatus(detail.type)
        return
      }
      if (detail.type === 'register-error') {
        setSwStatus(`register-error: ${detail.error ?? 'unknown'}`)
      }
    }

    window.addEventListener('dictation-pwa-status', handlePwaStatus as EventListener)

    void (async () => {
      try {
        const response = await fetch(`${APP_BASE_URL}manifest.webmanifest`, { cache: 'no-store' })
        setManifestStatus(response.ok ? `ok (${response.status})` : `http ${response.status}`)
      } catch (error) {
        setManifestStatus(`error: ${getErrorMessage(error)}`)
      }
    })()

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('dictation-pwa-status', handlePwaStatus as EventListener)
    }
  }, [])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (recentCommittedTimerRef.current !== null) window.clearTimeout(recentCommittedTimerRef.current)
      scribeDisconnectRef.current()
    }
  }, [])

  const committedPreviewText = realtimeCommittedRef.current.trim()
  const hasRecentCommitted = Boolean(recentCommittedText) && committedPreviewText.endsWith(recentCommittedText)
  const committedStableText = hasRecentCommitted
    ? committedPreviewText.slice(0, committedPreviewText.length - recentCommittedText.length).trimEnd()
    : committedPreviewText

  const isRealtimeHighlightActive = mode === 'elevenlabs-realtime' && Boolean(realtimeCommittedRef.current || realtimePartialText)

  const syncTranscriptHighlightScroll = useCallback(() => {
    if (!transcriptTextareaRef.current || !transcriptHighlightRef.current) return
    transcriptHighlightRef.current.scrollTop = transcriptTextareaRef.current.scrollTop
    transcriptHighlightRef.current.scrollLeft = transcriptTextareaRef.current.scrollLeft
  }, [])

  const renderTranscriptHighlight = () => {
    if (!isRealtimeHighlightActive) return <span className="transcript-highlight-plain">{text || ' '}</span>

    return (
      <>
        {realtimeBaseTextRef.current ? <span>{realtimeBaseTextRef.current} </span> : null}
        {committedStableText ? <span>{committedStableText} </span> : null}
        {hasRecentCommitted ? <span className="realtime-committed-flash">{recentCommittedText}</span> : null}
        {hasRecentCommitted && realtimePartialText ? <span> </span> : null}
        {realtimePartialText ? <span className="realtime-partial">{realtimePartialText}</span> : null}
        {!text ? <span> </span> : null}
      </>
    )
  }

  if (!settingsLoaded) {
    return <div className="app-shell"><div className="card"><h1>Loading...</h1></div></div>
  }

  return (
    <div className={`app-shell ${compactMode ? 'compact-shell' : ''}`}>
      <div className={`card ${compactMode ? 'compact-card' : ''}`}>
        <div className="header-row">
          <div>
            <h1>{compactMode ? 'Dictation Mini' : 'Dictation Prototype'}</h1>
            {!compactMode ? <p className="subtitle">先在网页里转写与润色，再复制黏贴回目标应用。配置保存在浏览器 IndexedDB。</p> : null}
          </div>
          <div className="header-actions">
            <button onClick={toggleCompactMode}>{compactMode ? 'Expand' : 'Mini mode'}</button>
            {!compactMode ? <button onClick={() => void handleInstall()}>{canInstall ? 'Install App' : 'Install Help'}</button> : null}
          </div>
        </div>

        <div className="status-row top-status-row">
          <span className={`badge ${status}`}>{statusText}</span>
          <span className={`badge ${isStandalone ? 'listening' : 'idle'}`}>{isStandalone ? 'App Installed' : 'Browser Mode'}</span>
          {!compactMode ? <span className={`badge ${canInstall ? 'connecting' : 'idle'}`}>{canInstall ? 'Install Ready' : installState === 'installing' ? 'Installing' : 'No Install Event'}</span> : null}
          {!compactMode ? <span className="hint">Shortcut: {DEFAULT_SHORTCUT_LABEL}</span> : null}
          {mode === 'local' && !canUseLocal ? <span className="warning">当前浏览器不支持本地语音识别</span> : null}
        </div>

        {compactMode ? (
          <>
            <div className="toolbar compact-topbar">
              <button className="primary" onClick={() => void startCurrent()} disabled={isBusy}>Start</button>
              <button onClick={stopCurrent} disabled={stopDisabled}>Stop</button>
              <button onClick={() => void handlePostProcess()} disabled={isBusy || !text.trim()}>Polish</button>
              <button onClick={() => void writeClipboard(processedText || text, processedText ? 'Processed text' : 'Transcript')} disabled={!(processedText || text).trim()}>Copy</button>
            </div>
            <div className="toolbar compact-bottombar">
              <button onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? 'Hide' : 'Settings'}</button>
              <button onClick={() => setShowPwaDebug((value) => !value)}>{showPwaDebug ? 'Hide Debug' : 'Debug'}</button>
            </div>
            <div className="compact-shortcuts" aria-label="Keyboard shortcuts">
              {SHORTCUTS.map((item) => (
                <div key={item.combo} className="compact-shortcut-chip">
                  <span>{item.label}</span>
                  <code>{item.combo}</code>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="toolbar primary-toolbar compact-toolbar">
            <button className="primary" onClick={() => void startCurrent()} disabled={isBusy}>Start</button>
            <button onClick={stopCurrent} disabled={stopDisabled}>Stop</button>
            <button onClick={() => void writeClipboard(processedText || text, processedText ? 'Processed text' : 'Transcript')} disabled={!(processedText || text).trim()}>Quick Copy</button>
            <button onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? 'Hide Settings' : 'Show Settings'}</button>
            <button onClick={() => setShowPwaDebug((value) => !value)}>{showPwaDebug ? 'Hide PWA Debug' : 'PWA Debug'}</button>
          </div>
        )}

        <div className={compactMode ? 'compact-panels' : ''}>
          <label>
            <span>Transcript</span>
            <div className={`transcript-editor ${isRealtimeHighlightActive ? 'realtime-active' : ''}`}>
              <div ref={transcriptHighlightRef} className="transcript-highlight" aria-hidden="true">
                <div className="transcript-highlight-content">{renderTranscriptHighlight()}</div>
              </div>
              <textarea
                ref={transcriptTextareaRef}
                className={isRealtimeHighlightActive ? 'transcript-textarea realtime-overlay' : 'transcript-textarea'}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onScroll={syncTranscriptHighlightScroll}
                rows={compactMode ? 4 : 10}
                placeholder="点 Start 或用快捷键开始说话。"
              />
            </div>
          </label>

          <label>
            <span>Processed Text</span>
            <textarea value={processedText} onChange={(event) => setProcessedText(event.target.value)} rows={compactMode ? 3 : 8} placeholder="LLM 后处理结果会显示在这里。" />
          </label>
        </div>

        {!compactMode ? (
          <div className="toolbar">
            <button onClick={() => void handlePostProcess()} disabled={isBusy}>Post-process</button>
            <button onClick={() => void writeClipboard(text, 'Transcript')} disabled={!text.trim()}>Copy T</button>
            <button onClick={() => void writeClipboard(processedText, 'Processed text')} disabled={!processedText.trim()}>Copy P</button>
            <button onClick={() => { setText(''); setProcessedText('') }} disabled={isBusy || (!text && !processedText)}>Clear</button>
          </div>
        ) : null}

        {notice ? <div className="notice-box">{notice}</div> : null}
        {error ? <div className="error-box">{error}</div> : null}

        {showPwaDebug ? (
          <div className="pwa-debug">
            <div className="pwa-debug-title">PWA Debug</div>
            <div className="pwa-debug-grid">
              <div><span>installState</span><code>{installState}</code></div>
              <div><span>canInstall</span><code>{String(canInstall)}</code></div>
              <div><span>canInstallIOS</span><code>{String(canInstallIOS)}</code></div>
              <div><span>isStandalone</span><code>{String(isStandalone)}</code></div>
              <div><span>hasBeforeInstallPrompt</span><code>{String(pwaDebug.hasBeforeInstallPrompt)}</code></div>
              <div><span>dismissed</span><code>{String(pwaDebug.dismissed)}</code></div>
              <div><span>matchMedia standalone</span><code>{String(pwaDebug.standaloneMatch)}</code></div>
              <div><span>navigator.standalone</span><code>{String(pwaDebug.navigatorStandalone)}</code></div>
              <div><span>serviceWorker</span><code>{swStatus}</code></div>
              <div><span>manifest</span><code>{manifestStatus}</code></div>
            </div>
            <div className="pwa-debug-ua">
              <span>UA</span>
              <code>{pwaDebug.userAgent || 'unknown'}</code>
            </div>
          </div>
        ) : null}

        {showAdvanced ? (
          <>
            <div className="section-divider" />

            <div className="grid two">
              <label>
                <span>Mode</span>
                <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
                  <option value="local">Local Dictation</option>
                  <option value="elevenlabs-realtime">ElevenLabs Realtime</option>
                  <option value="elevenlabs-batch">ElevenLabs Batch</option>
                </select>
              </label>
              <label>
                <span>Language</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  {LANGUAGES.map((item) => <option key={item.label} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>

            {needsApiKey ? (
              <label>
                <span>ElevenLabs API Key</span>
                <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk_..." />
                <small className="field-help">仅保存在当前浏览器本地 IndexedDB，请求会直接从浏览器发送到 ElevenLabs。</small>
              </label>
            ) : null}

            <div className="grid two toggles-grid">
              <label className="toggle-row"><input type="checkbox" checked={autoCopyTranscript} onChange={(event) => setAutoCopyTranscript(event.target.checked)} /><span>Auto copy transcript after stop</span></label>
              <label className="toggle-row"><input type="checkbox" checked={autoCopyProcessed} onChange={(event) => setAutoCopyProcessed(event.target.checked)} /><span>Auto copy processed text</span></label>
              <label className="toggle-row"><input type="checkbox" checked={shortcutsEnabled} onChange={(event) => setShortcutsEnabled(event.target.checked)} /><span>Enable recording shortcut</span></label>
              <label className="toggle-row"><input type="checkbox" checked={compactMode} onChange={(event) => setCompactMode(event.target.checked)} /><span>Use mini floating-window layout</span></label>
            </div>

            <div className="section-divider" />
            <h2>LLM Post-processing</h2>
            <p className="subtitle small">支持 OpenAI 兼容接口，按你的 prompt 改写转写文本。</p>

            <div className="grid two">
              <label>
                <span>LLM Base URL</span>
                <input type="text" value={llmBaseUrl} onChange={(event) => setLlmBaseUrl(event.target.value)} placeholder="https://your-host/v1" />
              </label>
              <label>
                <span>LLM Model</span>
                <input type="text" value={llmModel} onChange={(event) => setLlmModel(event.target.value)} placeholder="gpt-4.1-mini / qwen / custom-model" />
              </label>
            </div>

            <label>
              <span>LLM API Key</span>
              <input type="password" value={llmApiKey} onChange={(event) => setLlmApiKey(event.target.value)} placeholder="sk-..." />
              <small className="field-help">仅保存在当前浏览器本地 IndexedDB，请求会直接发送到你填写的接口地址。</small>
            </label>

            <label>
              <span>LLM Prompt</span>
              <textarea value={llmPrompt} onChange={(event) => setLlmPrompt(event.target.value)} rows={5} placeholder="描述你想如何改写转写文本。" />
            </label>

            <div className="tips">
              <h2>Usage</h2>
              <ol>
                <li>推荐先用 Chrome 打开，然后点 Install App，安装成桌面应用。</li>
                <li>Mini mode 会变成更像悬浮胶囊的布局，适合常驻桌面。</li>
                <li>Stop 后可自动复制转写，LLM 后处理完成后也可自动复制结果。</li>
              </ol>
              <div className="shortcut-list">
                {SHORTCUTS.map((item) => (
                  <div key={item.combo} className="shortcut-chip">
                    <span>{item.label}</span>
                    <code>{item.combo}</code>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <InstallPrompt compact={compactMode} onNotice={setNotice} />
      </div>
    </div>
  )
}

export default App

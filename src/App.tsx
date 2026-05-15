import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useScribe } from '@elevenlabs/react'
import { fetchRealtimeToken, getErrorMessage, postProcessWithLlm, transcribeBatch } from './api'
import { InstallPrompt } from './components/InstallPrompt'
import { usePWAInstall } from './hooks/usePWAInstall'
import { createDefaultPromptTemplates, DEFAULT_SETTINGS, loadSettings, saveSettings } from './settingsStore'
import type { AppStatus, Mode, PersistedSettings, PromptTemplate } from './types'
import './App.css'

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

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

const APP_BASE_URL = import.meta.env.BASE_URL

const DEFAULT_SHORTCUT_LABEL = 'Ctrl/⌘ + Shift + Space'
const SHORTCUTS = [
  { label: '录音开关', combo: 'Ctrl/⌘ + Shift + Space' },
  { label: '后处理', combo: 'Ctrl/⌘ + Shift + P' },
  { label: '快速复制', combo: 'Ctrl/⌘ + Shift + C' },
  { label: '清空文本', combo: 'Ctrl/⌘ + Shift + X' },
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

function createTemplateId(): string {
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function renderTemplate(template: string, transcript: string): string {
  return template.includes('{{transcript}}') ? template.replaceAll('{{transcript}}', transcript) : `${template.trim()}\n\n${transcript}`.trim()
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
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
  const [templates, setTemplates] = useState<PromptTemplate[]>(DEFAULT_SETTINGS.templates)
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_SETTINGS.selectedTemplateId)
  const [compactMode, setCompactMode] = useState(DEFAULT_SETTINGS.compactMode)
  const [autoCopyTranscript, setAutoCopyTranscript] = useState(DEFAULT_SETTINGS.autoCopyTranscript)
  const [autoCopyProcessed, setAutoCopyProcessed] = useState(DEFAULT_SETTINGS.autoCopyProcessed)
  const [shortcutsEnabled, setShortcutsEnabled] = useState(DEFAULT_SETTINGS.shortcutsEnabled)
  const [status, setStatus] = useState<AppStatus>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(true)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
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
  const latestTextRef = useRef(DEFAULT_SETTINGS.text)
  const activeModeRef = useRef<Mode | null>(null)
  const realtimeBaseTextRef = useRef('')
  const realtimeCommittedRef = useRef('')
  const stoppingLocalRef = useRef(false)
  const recentCommittedTimerRef = useRef<number | null>(null)
  const stoppingRealtimeRef = useRef(false)
  const stoppingBatchRef = useRef(false)
  const scribeDisconnectRef = useRef<() => void>(() => undefined)

  const { canInstall, canInstallIOS, isStandalone, promptInstall, installState, debug: pwaDebug } = usePWAInstall()

  const updateText = useCallback((value: string) => {
    latestTextRef.current = value
    setText(value)
  }, [])

  useEffect(() => {
    let cancelled = false
    const applySettings = (saved: PersistedSettings) => {
      setMode(saved.mode)
      setApiKey(saved.apiKey)
      setLanguage(saved.language)
      updateText(saved.text)
      setProcessedText(saved.processedText)
      setLlmApiKey(saved.llmApiKey)
      setLlmBaseUrl(saved.llmBaseUrl)
      setLlmModel(saved.llmModel)
      setTemplates(saved.templates)
      setSelectedTemplateId(saved.selectedTemplateId)
      setCompactMode(saved.compactMode)
      setAutoCopyTranscript(saved.autoCopyTranscript)
      setAutoCopyProcessed(saved.autoCopyProcessed)
      setShortcutsEnabled(saved.shortcutsEnabled)
      setShowAdvanced(!saved.compactMode)
    }

    void loadSettings()
      .catch((error) => {
        setNotice(`无法读取本地设置，已使用默认配置：${getErrorMessage(error)}`)
        return DEFAULT_SETTINGS
      })
      .then((saved) => {
        if (cancelled) return
        applySettings(saved)
        setSettingsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [updateText])

  useEffect(() => {
    if (!settingsLoaded) return
    const settings: PersistedSettings = {
      mode,
      apiKey,
      language,
      text,
      processedText,
      llmApiKey,
      llmBaseUrl,
      llmModel,
      templates,
      selectedTemplateId,
      compactMode,
      autoCopyTranscript,
      autoCopyProcessed,
      shortcutsEnabled,
    }

    void saveSettings(settings).catch((err) => {
      setNotice(`无法保存本地设置：${getErrorMessage(err)}`)
    })
  }, [settingsLoaded, mode, apiKey, language, text, processedText, llmApiKey, llmBaseUrl, llmModel, templates, selectedTemplateId, compactMode, autoCopyTranscript, autoCopyProcessed, shortcutsEnabled])

  const canUseLocal = typeof window !== 'undefined' && getRecognitionConstructor() !== null
  const canUseMediaRecorder = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined'
  const isBusy = status === 'connecting' || status === 'listening' || status === 'processing' || status === 'post-processing'
  const stopDisabled = status === 'idle' || status === 'error' || status === 'post-processing'
  const settingsDisabled = isBusy
  const needsApiKey = mode !== 'local'
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0]

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
      const wasStopping = stoppingRealtimeRef.current
      setStatus((current) => (current === 'error' || current === 'processing' || current === 'post-processing' ? current : 'idle'))
      stoppingRealtimeRef.current = false
      activeModeRef.current = null
      setRealtimePartialText('')
      setRecentCommittedText('')
      if (wasStopping && autoCopyTranscript) void writeClipboard(latestTextRef.current, 'Transcript')
    },
    onPartialTranscript: ({ text: partial }) => {
      setRealtimePartialText(partial.trim())
      const combined = `${realtimeCommittedRef.current} ${partial}`.trim()
      updateText(realtimeBaseTextRef.current ? `${realtimeBaseTextRef.current} ${combined}`.trim() : combined)
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
      updateText(realtimeBaseTextRef.current ? `${realtimeBaseTextRef.current} ${combined}`.trim() : combined)
    },
    onError: (event) => {
      if (stoppingRealtimeRef.current) {
        stoppingRealtimeRef.current = false
        activeModeRef.current = null
        setStatus('idle')
        return
      }
      activeModeRef.current = null
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
      activeModeRef.current = null
      setStatus('idle')
    }
  }, [scribe])

  const stopBatch = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return setStatus('idle')
    stoppingBatchRef.current = true
    recorderRef.current.stop()
  }, [])

  const stopCurrent = useCallback(() => {
    const activeMode = activeModeRef.current ?? mode
    if (activeMode === 'local') return stopLocal()
    if (activeMode === 'elevenlabs-realtime') return stopRealtime()
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
      activeModeRef.current = 'local'
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
      updateText(baseTextRef.current ? `${baseTextRef.current} ${merged}`.trim() : merged)
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
      activeModeRef.current = null
      setStatus((current) => (current === 'error' && !wasStopping ? current : 'idle'))
      if (wasStopping && autoCopyTranscript) void writeClipboard(latestTextRef.current, 'Transcript')
    }
    recognitionRef.current = recognition
    setStatus('connecting')
    setError('')
    setNotice('')
    recognition.start()
  }, [autoCopyTranscript, language, text, updateText, writeClipboard])

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
      activeModeRef.current = 'elevenlabs-realtime'
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
      activeModeRef.current = null
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
      activeModeRef.current = 'elevenlabs-batch'
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
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        activeModeRef.current = null
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
            updateText(next)
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
          activeModeRef.current = null
        }
      }
      recorder.start()
    } catch (err) {
      activeModeRef.current = null
      setStatus('error')
      setError(getErrorMessage(err))
    }
  }, [apiKey, autoCopyTranscript, canUseMediaRecorder, language, text, updateText, writeClipboard])

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

  const clearText = useCallback(() => {
    updateText('')
    setProcessedText('')
  }, [updateText])

  const updateTemplate = useCallback((templateId: string, patch: Partial<Pick<PromptTemplate, 'name' | 'description' | 'systemPrompt' | 'userPromptTemplate'>>) => {
    setTemplates((current) => current.map((template) => (
      template.id === templateId ? { ...template, ...patch, updatedAt: new Date().toISOString() } : template
    )))
  }, [])

  const addTemplate = useCallback(() => {
    const now = new Date().toISOString()
    const next: PromptTemplate = {
      id: createTemplateId(),
      name: '新模板',
      description: '自定义 AI 对话模板。',
      systemPrompt: '你是一个中文 AI 对话输入整理器。请按用户要求整理口述内容，只输出最终文本。',
      userPromptTemplate: '请整理下面这段口述：\n\n{{transcript}}',
      createdAt: now,
      updatedAt: now,
    }
    setTemplates((current) => [...current, next])
    setSelectedTemplateId(next.id)
    setShowTemplateManager(true)
  }, [])

  const duplicateTemplate = useCallback((templateId: string) => {
    const source = templates.find((template) => template.id === templateId)
    if (!source) return
    const now = new Date().toISOString()
    const next: PromptTemplate = {
      ...source,
      id: createTemplateId(),
      name: `${source.name} 副本`,
      createdAt: now,
      updatedAt: now,
    }
    setTemplates((current) => [...current, next])
    setSelectedTemplateId(next.id)
    setShowTemplateManager(true)
  }, [templates])

  const deleteTemplate = useCallback((templateId: string) => {
    setTemplates((current) => {
      if (current.length <= 1) {
        setNotice('至少需要保留一个模板。')
        return current
      }
      const next = current.filter((template) => template.id !== templateId)
      if (selectedTemplateId === templateId) setSelectedTemplateId(next[0].id)
      return next
    })
  }, [selectedTemplateId])

  const moveTemplate = useCallback((templateId: string, direction: -1 | 1) => {
    setTemplates((current) => {
      const index = current.findIndex((template) => template.id === templateId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }, [])

  const resetTemplates = useCallback(() => {
    const next = createDefaultPromptTemplates()
    setTemplates(next)
    setSelectedTemplateId(next[0].id)
    setNotice('已恢复默认模板。')
  }, [])

  const handlePostProcess = useCallback(async () => {
    if (!text.trim()) {
      setStatus('error')
      setError('Please provide transcript text first.')
      return
    }
    if (!selectedTemplate) {
      setStatus('error')
      setError('Please select or create a prompt template.')
      return
    }
    if (!llmApiKey.trim() || !llmBaseUrl.trim() || !llmModel.trim() || !selectedTemplate.systemPrompt.trim() || !selectedTemplate.userPromptTemplate.trim()) {
      setStatus('error')
      setError('Please complete the LLM configuration and selected template.')
      return
    }
    try {
      setStatus('post-processing')
      setError('')
      setNotice('')
      const result = await postProcessWithLlm({
        apiKey: llmApiKey.trim(),
        baseUrl: llmBaseUrl.trim(),
        model: llmModel.trim(),
        systemPrompt: selectedTemplate.systemPrompt.trim(),
        userContent: renderTemplate(selectedTemplate.userPromptTemplate, text.trim()),
      })
      setProcessedText(result)
      if (autoCopyProcessed) await writeClipboard(result, 'Processed text')
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(getErrorMessage(err))
    }
  }, [autoCopyProcessed, llmApiKey, llmBaseUrl, llmModel, selectedTemplate, text, writeClipboard])

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
      if (event.code === 'KeyX') {
        event.preventDefault()
        if (!isBusy) clearText()
        return
      }
      if (event.code === 'KeyM') {
        event.preventDefault()
        toggleCompactMode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clearText, handlePostProcess, isBusy, processedText, shortcutsEnabled, stopCurrent, text, toggleCompactMode, toggleRecording, writeClipboard])

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

  const isRealtimeSessionActive = activeModeRef.current === 'elevenlabs-realtime' && (status === 'connecting' || status === 'listening')
  const isRealtimeHighlightActive = isRealtimeSessionActive && Boolean(realtimeCommittedRef.current || realtimePartialText)

  const syncTranscriptHighlightScroll = useCallback(() => {
    if (!transcriptTextareaRef.current || !transcriptHighlightRef.current) return
    transcriptHighlightRef.current.scrollTop = transcriptTextareaRef.current.scrollTop
    transcriptHighlightRef.current.scrollLeft = transcriptTextareaRef.current.scrollLeft
  }, [])

  const renderTranscriptHighlight = () => {
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
              <button onClick={() => void handlePostProcess()} disabled={isBusy || !text.trim() || !selectedTemplate}>Generate</button>
              <button onClick={() => void writeClipboard(processedText || text, processedText ? 'Processed text' : 'Transcript')} disabled={!(processedText || text).trim()}>Copy</button>
              <button onClick={clearText} disabled={isBusy || (!text && !processedText)}>Clear</button>
            </div>
            <label className="compact-template-select">
              <span>Template</span>
              <select value={selectedTemplate?.id ?? ''} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={isBusy || templates.length === 0}>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
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

        {!compactMode ? (
          <div className="template-panel">
            <div className="template-panel-head">
              <div>
                <h2>Prompt Template</h2>
                <p className="subtitle small">选择一个 AI 对话模板，把语音转写整理成可直接复制的输入。</p>
              </div>
              <button onClick={() => setShowTemplateManager((value) => !value)}>{showTemplateManager ? 'Hide Templates' : 'Manage Templates'}</button>
            </div>
            <div className="template-select-row">
              <label>
                <span>Active Template</span>
                <select value={selectedTemplate?.id ?? ''} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={isBusy || templates.length === 0}>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </label>
              <div className="template-description">
                <span>Description</span>
                <p>{selectedTemplate?.description || '暂无模板描述。'}</p>
              </div>
            </div>

            {showTemplateManager ? (
              <div className="template-manager">
                <div className="template-manager-toolbar">
                  <button onClick={addTemplate}>Add Template</button>
                  <button onClick={() => selectedTemplate && duplicateTemplate(selectedTemplate.id)} disabled={!selectedTemplate}>Duplicate</button>
                  <button onClick={resetTemplates}>Restore Defaults</button>
                </div>
                <div className="template-manager-grid">
                  <div className="template-list" aria-label="Prompt templates">
                    {templates.map((template, index) => (
                      <button
                        key={template.id}
                        className={template.id === selectedTemplate?.id ? 'template-list-item active' : 'template-list-item'}
                        onClick={() => setSelectedTemplateId(template.id)}
                      >
                        <strong>{template.name || '未命名模板'}</strong>
                        <span>{template.description || '暂无描述'}</span>
                        <small>{index + 1}</small>
                      </button>
                    ))}
                  </div>

                  {selectedTemplate ? (
                    <div className="template-editor">
                      <div className="template-editor-actions">
                        <button onClick={() => moveTemplate(selectedTemplate.id, -1)}>Move Up</button>
                        <button onClick={() => moveTemplate(selectedTemplate.id, 1)}>Move Down</button>
                        <button onClick={() => deleteTemplate(selectedTemplate.id)} disabled={templates.length <= 1}>Delete</button>
                      </div>
                      <label>
                        <span>Template Name</span>
                        <input value={selectedTemplate.name} onChange={(event) => updateTemplate(selectedTemplate.id, { name: event.target.value })} />
                      </label>
                      <label>
                        <span>Description</span>
                        <input value={selectedTemplate.description} onChange={(event) => updateTemplate(selectedTemplate.id, { description: event.target.value })} />
                      </label>
                      <label>
                        <span>System Prompt</span>
                        <textarea value={selectedTemplate.systemPrompt} onChange={(event) => updateTemplate(selectedTemplate.id, { systemPrompt: event.target.value })} rows={5} />
                      </label>
                      <label>
                        <span>User Prompt Template</span>
                        <textarea value={selectedTemplate.userPromptTemplate} onChange={(event) => updateTemplate(selectedTemplate.id, { userPromptTemplate: event.target.value })} rows={5} />
                        <small className="field-help">使用 {'{{transcript}}'} 表示转写文本插入位置；未包含时会自动附加到模板末尾。</small>
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={compactMode ? 'compact-panels' : ''}>
          <label>
            <span>Transcript</span>
            <div className={`transcript-editor ${isRealtimeHighlightActive ? 'realtime-active' : ''}`}>
              {isRealtimeHighlightActive ? (
                <div ref={transcriptHighlightRef} className="transcript-highlight" aria-hidden="true">
                  <div className="transcript-highlight-content">{renderTranscriptHighlight()}</div>
                </div>
              ) : null}
              <textarea
                ref={transcriptTextareaRef}
                className={isRealtimeHighlightActive ? 'transcript-textarea realtime-overlay' : 'transcript-textarea'}
                value={text}
                onChange={(event) => updateText(event.target.value)}
                onScroll={syncTranscriptHighlightScroll}
                rows={compactMode ? 3 : 10}
                placeholder="点 Start 或用快捷键开始说话。"
              />
            </div>
          </label>

          <label>
            <span>Processed Text</span>
            <textarea value={processedText} onChange={(event) => setProcessedText(event.target.value)} rows={compactMode ? 2 : 8} placeholder="LLM 后处理结果会显示在这里。" />
          </label>
        </div>

        {!compactMode ? (
          <div className="toolbar">
            <button onClick={() => void handlePostProcess()} disabled={isBusy || !selectedTemplate}>Generate from Template</button>
            <button onClick={() => void writeClipboard(text, 'Transcript')} disabled={!text.trim()}>Copy T</button>
            <button onClick={() => void writeClipboard(processedText, 'Processed text')} disabled={!processedText.trim()}>Copy P</button>
            <button onClick={clearText} disabled={isBusy || (!text && !processedText)}>Clear</button>
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
                <select value={mode} onChange={(event) => setMode(event.target.value as Mode)} disabled={settingsDisabled}>
                  <option value="local">Local Dictation</option>
                  <option value="elevenlabs-realtime">ElevenLabs Realtime</option>
                  <option value="elevenlabs-batch">ElevenLabs Batch</option>
                </select>
              </label>
              <label>
                <span>Language</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={settingsDisabled}>
                  {LANGUAGES.map((item) => <option key={item.label} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>

            {needsApiKey ? (
              <label>
                <span>ElevenLabs API Key</span>
                <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk_..." disabled={settingsDisabled} />
                <small className="field-help">仅保存在当前浏览器本地 IndexedDB，请求会直接从浏览器发送到 ElevenLabs。</small>
              </label>
            ) : null}

            <div className="grid two toggles-grid">
              <label className="toggle-row"><input type="checkbox" checked={autoCopyTranscript} onChange={(event) => setAutoCopyTranscript(event.target.checked)} disabled={settingsDisabled} /><span>Auto copy transcript after stop</span></label>
              <label className="toggle-row"><input type="checkbox" checked={autoCopyProcessed} onChange={(event) => setAutoCopyProcessed(event.target.checked)} disabled={settingsDisabled} /><span>Auto copy processed text</span></label>
              <label className="toggle-row"><input type="checkbox" checked={shortcutsEnabled} onChange={(event) => setShortcutsEnabled(event.target.checked)} disabled={settingsDisabled} /><span>Enable recording shortcut</span></label>
              <label className="toggle-row"><input type="checkbox" checked={compactMode} onChange={(event) => setCompactMode(event.target.checked)} disabled={settingsDisabled} /><span>Use mini floating-window layout</span></label>
            </div>

            <div className="section-divider" />
            <h2>LLM Post-processing</h2>
            <p className="subtitle small">支持 OpenAI 兼容接口，按当前选中的 Prompt Template 改写转写文本。</p>

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

            <div className="tips">
              <h2>Usage</h2>
              <ol>
                <li>推荐先用 Chrome 打开，然后点 Install App，安装成桌面应用。</li>
                <li>Mini mode 会变成更像悬浮胶囊的布局，适合常驻桌面。</li>
                <li>选择模板后点击 Generate from Template，生成结果会写入 Processed Text。</li>
                <li>Stop 后可自动复制转写，模板生成完成后也可自动复制结果。</li>
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

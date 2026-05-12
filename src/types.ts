export type Mode = 'local' | 'elevenlabs-realtime' | 'elevenlabs-batch'

export type AppStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'post-processing' | 'error'

export type PersistedSettings = {
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

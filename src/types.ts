export type Mode = 'local' | 'elevenlabs-realtime' | 'elevenlabs-batch'

export type AppStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'post-processing' | 'error'

export type PromptTemplate = {
  id: string
  name: string
  description: string
  systemPrompt: string
  userPromptTemplate: string
  createdAt: string
  updatedAt: string
}

export type PersistedSettings = {
  mode: Mode
  apiKey: string
  language: string
  text: string
  processedText: string
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  templates: PromptTemplate[]
  selectedTemplateId: string
  compactMode: boolean
  autoCopyTranscript: boolean
  autoCopyProcessed: boolean
  shortcutsEnabled: boolean
}

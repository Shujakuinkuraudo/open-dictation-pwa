import type { PersistedSettings, PromptTemplate } from './types'

type StoredSettings = Partial<Omit<PersistedSettings, 'templates'>> & {
  templates?: unknown
  llmPrompt?: string
}

type StoredItem = { key: string; value: StoredSettings }

const DEFAULT_TEMPLATE_TIMESTAMP = '2026-01-01T00:00:00.000Z'
const LEGACY_DEFAULT_LLM_PROMPT = '请将下面这段转写文本整理成更清晰、更适合发送的中文。保留原意，修正口语、重复、语气词和明显识别错误，只输出最终文本。'

const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'direct-question',
    name: '直接提问',
    description: '把口述内容整理成可以直接发给 AI 的清晰问题。',
    systemPrompt: '你是一个中文 AI 对话输入整理器。将用户的口述内容整理成一个清晰、具体、适合直接发送给 AI 的问题。保留原意，删去口头禅、重复和无关停顿，不要添加用户没有表达的事实。',
    userPromptTemplate: '请把下面这段口述整理成一个可以直接发给 AI 的问题：\n\n{{transcript}}',
    createdAt: DEFAULT_TEMPLATE_TIMESTAMP,
    updatedAt: DEFAULT_TEMPLATE_TIMESTAMP,
  },
  {
    id: 'task-instruction',
    name: '任务指令',
    description: '把口述需求整理成带目标、约束和输出要求的任务。',
    systemPrompt: '你是一个任务指令整理器。将用户的口述需求改写成结构清楚的 AI 任务指令，包含目标、必要背景、约束和期望输出。只输出整理后的指令。',
    userPromptTemplate: '请把下面这段口述整理成一个明确的 AI 任务指令：\n\n{{transcript}}',
    createdAt: DEFAULT_TEMPLATE_TIMESTAMP,
    updatedAt: DEFAULT_TEMPLATE_TIMESTAMP,
  },
  {
    id: 'context-organize',
    name: '上下文整理',
    description: '把零散口述整理成背景、问题和请求。',
    systemPrompt: '你是一个上下文整理器。将用户的口述内容整理成适合提供给 AI 的上下文，按“背景、当前问题、希望 AI 做什么”组织。不要过度扩写。',
    userPromptTemplate: '请整理下面这段口述上下文：\n\n{{transcript}}',
    createdAt: DEFAULT_TEMPLATE_TIMESTAMP,
    updatedAt: DEFAULT_TEMPLATE_TIMESTAMP,
  },
  {
    id: 'follow-up',
    name: '继续追问',
    description: '把新想法整理成对上一轮 AI 回复的追问。',
    systemPrompt: '你是一个追问整理器。将用户的口述内容整理成对上一轮 AI 回复的自然追问，语气直接，重点明确。只输出追问文本。',
    userPromptTemplate: '请把下面这段口述整理成一条继续追问 AI 的消息：\n\n{{transcript}}',
    createdAt: DEFAULT_TEMPLATE_TIMESTAMP,
    updatedAt: DEFAULT_TEMPLATE_TIMESTAMP,
  },
  {
    id: 'clarify-first',
    name: '先澄清',
    description: '让 AI 先问关键澄清问题，再开始执行。',
    systemPrompt: '你是一个 AI 任务入口整理器。将用户的口述需求整理成提示词，要求 AI 在信息不足时先提出关键澄清问题，不要直接假设。',
    userPromptTemplate: '请把下面这段口述整理成一条提示词，要求 AI 先澄清再执行：\n\n{{transcript}}',
    createdAt: DEFAULT_TEMPLATE_TIMESTAMP,
    updatedAt: DEFAULT_TEMPLATE_TIMESTAMP,
  },
]

export function createDefaultPromptTemplates(): PromptTemplate[] {
  return DEFAULT_PROMPT_TEMPLATES.map((template) => ({ ...template }))
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  mode: 'local',
  apiKey: '',
  language: '',
  text: '',
  processedText: '',
  llmApiKey: '',
  llmBaseUrl: '',
  llmModel: '',
  templates: createDefaultPromptTemplates(),
  selectedTemplateId: DEFAULT_PROMPT_TEMPLATES[0].id,
  compactMode: false,
  autoCopyTranscript: true,
  autoCopyProcessed: true,
  shortcutsEnabled: true,
}

const DB_NAME = 'dictation-prototype-db'
const STORE_NAME = 'settings'
const SETTINGS_KEY = 'app'

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

function isPromptTemplate(value: unknown): value is PromptTemplate {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.description === 'string'
    && typeof item.systemPrompt === 'string'
    && typeof item.userPromptTemplate === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
}

function sanitizePromptTemplates(value: unknown, legacyPrompt?: string): PromptTemplate[] {
  let templates = Array.isArray(value) && value.every(isPromptTemplate)
    ? value.map((template) => ({ ...template }))
    : createDefaultPromptTemplates()

  if (!Array.isArray(value) && legacyPrompt?.trim() && legacyPrompt.trim() !== LEGACY_DEFAULT_LLM_PROMPT) {
    const now = new Date().toISOString()
    templates = [
      {
        id: 'legacy-polish',
        name: '旧版润色',
        description: '从旧版 LLM Prompt 自动迁移而来。',
        systemPrompt: legacyPrompt.trim(),
        userPromptTemplate: '{{transcript}}',
        createdAt: now,
        updatedAt: now,
      },
      ...templates,
    ]
  }

  return templates.length > 0 ? templates : createDefaultPromptTemplates()
}

function normalizeSettings(value?: StoredSettings): PersistedSettings {
  if (!value) return { ...DEFAULT_SETTINGS, templates: createDefaultPromptTemplates() }

  const templates = sanitizePromptTemplates(value.templates, value.llmPrompt)
  const selectedTemplateId = typeof value.selectedTemplateId === 'string' && templates.some((template) => template.id === value.selectedTemplateId)
    ? value.selectedTemplateId
    : templates[0].id

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    templates,
    selectedTemplateId,
  }
}

export async function loadSettings(): Promise<PersistedSettings> {
  const db = await openSettingsDb()
  return await new Promise<PersistedSettings>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(SETTINGS_KEY)
    request.onerror = () => reject(request.error ?? new Error('Failed to read settings'))
    request.onsuccess = () => {
      const result = request.result as StoredItem | undefined
      resolve(normalizeSettings(result?.value))
    }
  }).finally(() => db.close())
}

export async function saveSettings(settings: PersistedSettings): Promise<void> {
  const db = await openSettingsDb()
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save settings'))
    tx.objectStore(STORE_NAME).put({ key: SETTINGS_KEY, value: settings })
  }).finally(() => db.close())
}

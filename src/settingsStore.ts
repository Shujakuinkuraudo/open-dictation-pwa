import type { PersistedSettings } from './types'

type StoredItem = { key: string; value: PersistedSettings }

export const DEFAULT_SETTINGS: PersistedSettings = {
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

export async function loadSettings(): Promise<PersistedSettings> {
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

export async function saveSettings(settings: PersistedSettings): Promise<void> {
  const db = await openSettingsDb()
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save settings'))
    tx.objectStore(STORE_NAME).put({ key: SETTINGS_KEY, value: settings })
  }).finally(() => db.close())
}

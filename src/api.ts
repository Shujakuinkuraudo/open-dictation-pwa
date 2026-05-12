export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function fetchRealtimeToken(apiKey: string): Promise<string> {
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

export async function transcribeBatch(blob: Blob, apiKey: string, language: string): Promise<string> {
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

export async function postProcessWithLlm(config: {
  apiKey: string
  baseUrl: string
  model: string
  systemPrompt: string
  userContent: string
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
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: config.userContent },
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

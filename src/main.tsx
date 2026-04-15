import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

const updateSW = registerSW({
  onNeedRefresh() {
    updateSW(true)
  },
  onOfflineReady() {
    console.log('Dictation app ready for offline use')
    window.dispatchEvent(new CustomEvent('dictation-pwa-status', { detail: { type: 'offline-ready' } }))
  },
  onRegisteredSW(swUrl, registration) {
    console.log('SW registered:', swUrl, registration)
    window.dispatchEvent(new CustomEvent('dictation-pwa-status', { detail: { type: 'registered', swUrl } }))
  },
  onRegisterError(error: unknown) {
    console.error('SW registration error:', error)
    window.dispatchEvent(new CustomEvent('dictation-pwa-status', { detail: { type: 'register-error', error: String(error) } }))
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

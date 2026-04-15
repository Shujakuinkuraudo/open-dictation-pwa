import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

type InstallState = 'idle' | 'available' | 'installing' | 'installed'

type PWAInstallDebug = {
  userAgent: string
  standaloneMatch: boolean
  navigatorStandalone: boolean
  dismissed: boolean
  hasBeforeInstallPrompt: boolean
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

const INSTALL_DISMISSED_KEY = 'dictation_install_dismissed'

function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isWebkit = /WebKit/.test(ua)
  const isChrome = /CriOS/.test(ua)
  const isFirefox = /FxiOS/.test(ua)
  return isIOS && isWebkit && !isChrome && !isFirefox
}

function getInstallDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

function setInstallDismissed(): void {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, 'true')
  } catch {
    // ignore
  }
}

export function usePWAInstall(): {
  installState: InstallState
  canInstall: boolean
  canInstallIOS: boolean
  isStandalone: boolean
  isIOS: boolean
  promptInstall: () => Promise<boolean>
  dismissInstall: () => void
  resetDismissed: () => void
  debug: PWAInstallDebug
} {
  const [installState, setInstallState] = useState<InstallState>(() => (detectStandalone() ? 'installed' : 'idle'))
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(() => getInstallDismissed())

  const isIOS = typeof window !== 'undefined' && isIOSSafari()

  const isStandalone = detectStandalone()

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
      setInstallState('available')
    }

    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setInstallState('installed')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [isStandalone])

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false

    const prompt = deferredPrompt
    setDeferredPrompt(null)
    setInstallState('installing')

    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice

      if (outcome === 'accepted') {
        setInstallState('installed')
        return true
      }

      setInstallState('idle')
      return false
    } catch {
      setInstallState('idle')
      return false
    }
  }, [deferredPrompt])

  const dismissInstall = useCallback(() => {
    setDismissed(true)
    setInstallDismissed()
  }, [])

  const resetDismissed = useCallback(() => {
    setDismissed(false)
    try {
      localStorage.removeItem(INSTALL_DISMISSED_KEY)
    } catch {
      // ignore
    }
  }, [])

  return {
    installState,
    canInstall: installState === 'available' && !dismissed,
    canInstallIOS: isIOS && !isStandalone && !dismissed,
    isStandalone,
    isIOS,
    promptInstall,
    dismissInstall,
    resetDismissed,
    debug: {
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      standaloneMatch: typeof window === 'undefined' ? false : window.matchMedia('(display-mode: standalone)').matches,
      navigatorStandalone: typeof navigator === 'undefined' ? false : (navigator as Navigator & { standalone?: boolean }).standalone === true,
      dismissed,
      hasBeforeInstallPrompt: deferredPrompt !== null,
    },
  }
}

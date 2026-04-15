import { useState } from 'react'
import { usePWAInstall } from '../hooks/usePWAInstall'

type InstallPromptProps = {
  compact?: boolean
  onNotice?: (message: string) => void
}

export function InstallPrompt({ compact = false, onNotice }: InstallPromptProps) {
  const { canInstall, canInstallIOS, promptInstall, dismissInstall, isStandalone } = usePWAInstall()
  const [showIOSGuide, setShowIOSGuide] = useState(false)

  if (isStandalone) return null

  if (canInstallIOS && showIOSGuide) {
    return (
      <div className="install-ios-overlay">
        <div className="install-ios-sheet">
          <div className="install-prompt-head">
            <strong>安装到主屏幕</strong>
            <button onClick={() => setShowIOSGuide(false)}>关闭</button>
          </div>
          <ol>
            <li>点击浏览器底部或顶部的分享按钮。</li>
            <li>选择“添加到主屏幕”。</li>
            <li>确认添加后，下次可直接像 App 一样打开。</li>
          </ol>
          <button className="primary" onClick={() => { setShowIOSGuide(false); dismissInstall() }}>知道了</button>
        </div>
      </div>
    )
  }

  if (!canInstall && !canInstallIOS) return null

  const handleInstall = async () => {
    if (canInstallIOS) {
      setShowIOSGuide(true)
      onNotice?.('iOS 需要从浏览器菜单手动添加到主屏幕。')
      return
    }

    const success = await promptInstall()
    onNotice?.(success ? '已触发安装。' : '安装提示已关闭，或浏览器暂未再次提供安装事件。')
  }

  return (
    <div className={`install-bubble ${compact ? 'compact' : ''}`}>
      <div className="install-bubble-icon" aria-hidden="true">↓</div>
      <div className="install-bubble-body">
        <div className="install-bubble-title">安装应用</div>
        <div className="install-bubble-desc">像 Chrome 应用一样独立打开，更适合语音转写。</div>
      </div>
      <div className="install-bubble-actions">
        <button className="text" onClick={() => { dismissInstall(); onNotice?.('已隐藏安装提示。') }}>稍后</button>
        <button className="primary" onClick={handleInstall}>安装</button>
      </div>
    </div>
  )
}

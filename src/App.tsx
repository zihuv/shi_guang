import { useEffect, useState, useCallback } from 'react'
import { useSettingsStore } from './stores/settingsStore'
import { useFileStore } from './stores/fileStore'
import { useTagStore } from './stores/tagStore'
import { useFolderStore } from './stores/folderStore'
import Header from './components/Header'
import SidePanel from './components/SidePanel'
import FileGrid from './components/FileGrid'
import SettingsModal from './components/SettingsModal'

function App() {
  const { theme, loadSettings } = useSettingsStore()
  const { loadFiles, importImageFromBase64 } = useFileStore()
  const { loadTags } = useTagStore()
  const { loadFolders } = useFolderStore()
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    loadSettings()
    loadFiles()
    loadTags()
    loadFolders()
  }, [loadSettings, loadFiles, loadTags, loadFolders])

  // Handle Ctrl+V paste to import images from clipboard
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue

        // Convert blob to base64
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1]
          // Determine file extension from MIME type
          const mimeType = blob.type
          const ext = mimeType.split('/')[1] || 'png'

          await importImageFromBase64(base64, ext)
        }
        reader.readAsDataURL(blob)
        break
      }
    }
  }, [importImageFromBase64])

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
    }
  }, [handlePaste])

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-dark-bg">
      <Header onOpenSettings={() => setShowSettings(true)} />

      <div className="flex flex-1 overflow-hidden">
        <SidePanel />

        <main className="flex-1 overflow-auto">
          <FileGrid />
        </main>
      </div>

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  )
}

export default App

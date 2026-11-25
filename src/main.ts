import { desktopBridge, waitForDesktopEvents } from './services/desktop'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './assets/main.css'
import { useAuthStore } from './stores/auth'
import { useVaultStore } from './stores/vault'
import { useSettingsStore } from './stores/settings'
import { useBackupStore } from './stores/backup'
import { useDesktopStore } from './stores/desktop'
import { useUpdatesStore } from './stores/updates'

const app = createApp(App).use(createPinia())
const auth = useAuthStore()
const vault = useVaultStore()
const desktop = useDesktopStore()
const updates = useUpdatesStore()
desktopBridge.onUpdateState((state) => { updates.state = state })
void updates.load()
desktopBridge.onItemsChanged(() => { if (auth.unlocked) void vault.load(true) })
desktopBridge.onBackupChanged(() => { if (auth.unlocked) void useBackupStore().load() })
desktopBridge.onDesktopAction(desktop.request)
desktopBridge.onLocked(() => {
  auth.markLocked()
  vault.clear()
  useBackupStore().clear()
  desktop.clear()
  void router.replace('/unlock')
})
void useSettingsStore().load()
let lastActivity = 0
function touchSession() {
  if (!auth.unlocked || Date.now() - lastActivity < 1000) return
  lastActivity = Date.now()
  void desktopBridge.invoke('touch_session', undefined).catch(() => {})
}
for (const event of ['keydown', 'pointerdown', 'pointermove']) {
  document.addEventListener(event, touchSession, { passive: true })
}
void waitForDesktopEvents().then(() => app.use(router).mount('#app')).catch(() => {
  const root = document.getElementById('app')
  if (root) root.textContent = '桌面连接初始化失败，请重新启动 Keystill。'
})

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './assets/main.css'
import { useAuthStore } from './stores/auth'
import { useVaultStore } from './stores/vault'
import { useSettingsStore } from './stores/settings'
import { useDesktopStore } from './stores/desktop'

const app = createApp(App).use(createPinia())
const auth = useAuthStore()
const vault = useVaultStore()
const desktop = useDesktopStore()
window.jiaziVault?.onItemsChanged(() => { if (auth.unlocked) void vault.load() })
window.jiaziVault?.onDesktopAction(desktop.request)
window.jiaziVault?.onLocked(() => {
  auth.markLocked()
  vault.clear()
  desktop.clear()
  void router.replace('/unlock')
})
void useSettingsStore().load()
app.use(router).mount('#app')

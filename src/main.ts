import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './assets/main.css'
import { useAuthStore } from './stores/auth'
import { useVaultStore } from './stores/vault'
import { useSettingsStore } from './stores/settings'

const app = createApp(App).use(createPinia())
const auth = useAuthStore()
const vault = useVaultStore()
window.jiaziVault?.onLocked(() => {
  auth.markLocked()
  vault.clear()
  void router.replace('/unlock')
})
void useSettingsStore().load()
app.use(router).mount('#app')

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useAuthStore } from '../../stores/auth'
import { useDesktopStore } from '../../stores/desktop'
import QuickSearch from './QuickSearch.vue'

const auth = useAuthStore()
const desktop = useDesktopStore()
const router = useRouter()
const route = useRoute()
const message = useMessage()

watch([() => auth.unlocked, () => route.name, () => desktop.pendingAction], () => {
  if (!auth.unlocked || route.name === 'unlock' || !desktop.pendingAction) return
  const action = desktop.pendingAction
  desktop.pendingAction = null
  if (action === 'quick-search') { desktop.quickSearchOpen = true; return }
  desktop.quickSearchOpen = false
  if (action === 'generator') void router.push('/generator')
  else if (action === 'new-item') void router.push({ name: 'vault', query: { ...route.query, new: '1' } })
  else if (action === 'new-project') void router.push('/projects?new=1')
}, { immediate: true })

function keydown(event: KeyboardEvent) {
  if (!auth.unlocked || !(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 'l' && event.shiftKey) {
    event.preventDefault()
    void auth.lock().catch(() => message.error('锁定失败，请重试'))
    return
  }
  if (event.repeat) return
  if (key === 'k') { event.preventDefault(); desktop.request('quick-search') }
  else if (key === 'n') { event.preventDefault(); desktop.request(event.shiftKey ? 'new-project' : 'new-item') }
  else if (key === 'g' && !event.shiftKey) { event.preventDefault(); desktop.request('generator') }
}
onMounted(() => document.addEventListener('keydown', keydown))
onUnmounted(() => document.removeEventListener('keydown', keydown))
</script>

<template><QuickSearch v-if="auth.unlocked && desktop.quickSearchOpen" @close="desktop.quickSearchOpen = false" /></template>

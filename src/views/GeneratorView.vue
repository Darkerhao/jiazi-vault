<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NText } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'
import PasswordGenerator from '../components/common/PasswordGenerator.vue'
import ItemFormModal from '../components/item/ItemFormModal.vue'
import { useVaultStore } from '../stores/vault'

const draftPassword = ref<string | null>(null)
const vault = useVaultStore()
onMounted(() => { void vault.load() })
</script>

<template>
  <AppShell>
    <div class="page-heading"><n-text depth="3">工具</n-text><h1>密码生成器</h1></div>
    <PasswordGenerator v-slot="{ password, busy }">
      <n-button :disabled="!password || busy || vault.loading || !!vault.error" @click="draftPassword = password ?? null">保存到保险库</n-button>
    </PasswordGenerator>
    <ItemFormModal v-if="draftPassword !== null" :show="true" :item="null" :draft="{ type: 'password', password: draftPassword }" @close="draftPassword = null" />
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
</style>

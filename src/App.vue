<script setup lang="ts">
import { computed } from 'vue'
import { darkTheme, dateZhCN, GlobalThemeOverrides, NConfigProvider, NDialogProvider, NMessageProvider, zhCN } from 'naive-ui'
import { useSettingsStore } from './stores/settings'
import { useAuthStore } from './stores/auth'

const settings = useSettingsStore()
const auth = useAuthStore()
const theme = computed(() => (settings.isDark ? darkTheme : null))
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#8ab4f8',
    primaryColorHover: '#a8c7fa',
    primaryColorPressed: '#6b9bea',
    borderRadius: '6px',
  },
}

</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-dialog-provider :key="auth.sessionRevision">
      <n-message-provider>
        <router-view v-slot="{ Component, route }">
          <component :is="Component" v-if="auth.unlocked || route.name === 'unlock'" />
        </router-view>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

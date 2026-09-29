<script setup lang="ts">
import { computed } from 'vue'
import { darkTheme, dateZhCN, GlobalThemeOverrides, NConfigProvider, NDialogProvider, NMessageProvider, zhCN } from 'naive-ui'
import { useSettingsStore } from './stores/settings'
import { useAuthStore } from './stores/auth'
import DesktopActions from './components/common/DesktopActions.vue'

const settings = useSettingsStore()
const auth = useAuthStore()
const theme = computed(() => (settings.isDark ? darkTheme : null))
const themeOverrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: settings.isDark ? '#c7ef68' : '#4a681d',
    primaryColorHover: settings.isDark ? '#d4f878' : '#587c23',
    primaryColorPressed: settings.isDark ? '#b6e650' : '#3b5416',
    primaryColorSuppl: '#4a681d',
    bodyColor: settings.isDark ? '#20251f' : '#efeee8',
    cardColor: settings.isDark ? '#292f26' : '#fafaf6',
    modalColor: settings.isDark ? '#292f26' : '#fafaf6',
    popoverColor: settings.isDark ? '#30382b' : '#fafaf6',
    textColor1: settings.isDark ? '#f3f5ed' : '#20251f',
    textColor2: settings.isDark ? '#d5dccd' : '#3f4838',
    textColor3: settings.isDark ? '#a4b198' : '#66705d',
    borderColor: settings.isDark ? '#48533f' : '#cbd2bf',
    dividerColor: settings.isDark ? '#3a4334' : '#dde1d4',
    hoverColor: settings.isDark ? '#343e2d' : '#e6ebdd',
    borderRadius: '10px',
  },
  Button: {
    colorPrimary: '#c7ef68',
    colorHoverPrimary: '#d4f878',
    colorPressedPrimary: '#b6e650',
    colorFocusPrimary: '#d4f878',
    colorDisabledPrimary: '#c7ef68',
    textColorPrimary: '#20251f',
    textColorHoverPrimary: '#20251f',
    textColorPressedPrimary: '#20251f',
    textColorFocusPrimary: '#20251f',
    textColorDisabledPrimary: '#20251f',
    borderPrimary: '1px solid #c7ef68',
    borderHoverPrimary: '1px solid #d4f878',
    borderPressedPrimary: '1px solid #b6e650',
    borderFocusPrimary: '1px solid #d4f878',
    borderDisabledPrimary: '1px solid #c7ef68',
  },
  Layout: {
    siderColor: settings.isDark ? '#292f26' : '#e8ecdf',
  },
  Menu: {
    itemColorActive: settings.isDark ? '#424f31' : '#d5e4bb',
    itemColorActiveHover: settings.isDark ? '#4b5b36' : '#ccdda9',
    itemColorActiveCollapsed: settings.isDark ? '#424f31' : '#d5e4bb',
  },
}))

</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-dialog-provider :key="auth.sessionRevision">
      <n-message-provider>
        <DesktopActions />
        <router-view v-slot="{ Component, route }">
          <component :is="Component" v-if="auth.unlocked || route.name === 'unlock'" />
        </router-view>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

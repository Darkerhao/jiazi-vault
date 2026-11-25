<script setup lang="ts">
import { computed } from 'vue'
import { darkTheme, dateZhCN, GlobalThemeOverrides, NConfigProvider, NDialogProvider, NMessageProvider, zhCN } from 'naive-ui'
import { useSettingsStore } from './stores/settings'
import { useAuthStore } from './stores/auth'
import DesktopActions from './components/common/DesktopActions.vue'

const settings = useSettingsStore()
const auth = useAuthStore()
const theme = computed(() => (settings.isDark ? darkTheme : null))
const colors = computed(() => settings.isDark ? {
  background: '#171d1a', surface: '#202722', elevated: '#28312b', input: '#1b221e',
  text: '#eff3ee', secondary: '#c9d3cb', muted: '#9aa99e', border: '#3d4a41', divider: '#303c33',
  hover: '#2b372e', accent: '#c7ef68', active: '#35462b',
} : {
  background: '#f4f6f1', surface: '#ffffff', elevated: '#ffffff', input: '#f7f9f4',
  text: '#202a22', secondary: '#46554a', muted: '#67776a', border: '#cfd8cb', divider: '#e2e8dd',
  hover: '#edf2e7', accent: '#466823', active: '#e6efd8',
})
const themeVariables = computed(() => Object.fromEntries(Object.entries(colors.value).map(([key, value]) => [`--app-${key}`, value])))
const themeOverrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: colors.value.accent,
    primaryColorHover: settings.isDark ? '#d4f878' : '#587c23',
    primaryColorPressed: settings.isDark ? '#b6e650' : '#3b5416',
    primaryColorSuppl: '#4a681d',
    bodyColor: colors.value.background,
    cardColor: colors.value.surface,
    modalColor: colors.value.surface,
    popoverColor: colors.value.elevated,
    inputColor: colors.value.input,
    textColor1: colors.value.text,
    textColor2: colors.value.secondary,
    textColor3: colors.value.muted,
    placeholderColor: colors.value.muted,
    borderColor: colors.value.border,
    dividerColor: colors.value.divider,
    hoverColor: colors.value.hover,
    borderRadius: '10px',
    fontSize: '14px',
    heightMedium: '36px',
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
    siderColor: colors.value.surface,
    headerColor: colors.value.surface,
  },
  Menu: {
    itemColorActive: colors.value.active,
    itemColorActiveHover: colors.value.active,
    itemColorActiveCollapsed: colors.value.active,
    itemHeight: '42px',
    borderRadius: '10px',
  },
  Card: { borderRadius: '14px', titleFontSizeMedium: '16px', titleFontWeight: '600' },
  Tag: { borderRadius: '5px' },
}))

</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides" :style="themeVariables" :locale="zhCN" :date-locale="dateZhCN">
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

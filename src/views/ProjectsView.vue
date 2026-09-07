<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NEmpty, NList, NListItem, NSpace, NText } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'
import { projectService } from '../services/project'
import type { Project } from '../types/vault'

const projects = ref<Project[]>([])
onMounted(async () => { try { projects.value = await projectService.list() } catch { projects.value = [] } })
</script>

<template>
  <AppShell>
    <div class="page-heading"><n-text depth="3">工作区</n-text><h1>项目</h1></div>
    <n-empty v-if="projects.length === 0" description="还没有项目" />
    <n-list v-else bordered><n-list-item v-for="project in projects" :key="project.id"><n-space justify="space-between" align="center" style="width: 100%"><n-text strong>{{ project.name }}</n-text><n-button quaternary size="small">{{ project.itemCount }} 条目</n-button></n-space></n-list-item></n-list>
  </AppShell>
</template>

<style scoped>.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }</style>

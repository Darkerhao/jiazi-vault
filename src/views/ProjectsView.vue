<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NForm, NFormItem, NInput, NList, NListItem, NModal, NSelect, NSpace, NSpin, NText, useDialog, useMessage } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'
import { projectService } from '../services/project'
import { useVaultStore } from '../stores/vault'
import type { Project, ProjectInput } from '../types/vault'

const vault = useVaultStore()
const route = useRoute()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const show = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const error = ref('')
const form = reactive<ProjectInput>({ name: '', icon: '📁', color: '#8ab4f8', description: '' })
const icons = ['📁', '💻', '🌐', '🔧', '📦', '🚀', '🎓', '🔒'].map((icon) => ({ label: icon, value: icon }))
const visibleProjects = computed(() => vault.projects.filter((p) => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(vault.query.trim().toLowerCase())))

function edit(project?: Project) {
  editingId.value = project?.id ?? null
  Object.assign(form, { name: project?.name ?? '', icon: project?.icon ?? '📁', color: project?.color ?? '#8ab4f8', description: project?.description ?? '' })
  error.value = ''
  show.value = true
}

watch(() => route.query.new, (value) => {
  if (value) { edit(); void router.replace('/projects') }
}, { immediate: true })
onMounted(() => vault.load())

async function save() {
  if (saving.value) return
  if (!form.name.trim()) { error.value = '请输入项目名称'; return }
  saving.value = true
  error.value = ''
  try {
    if (editingId.value) await projectService.update({ ...form, id: editingId.value })
    else await projectService.create({ ...form })
    show.value = false
    await vault.load()
    message.success('项目已保存')
  } catch (cause) {
    error.value = cause instanceof Error && cause.message.includes('PROJECT_NAME_EXISTS') ? '项目名称已存在' : '保存失败，请重试'
  } finally { saving.value = false }
}

function remove(project: Project) {
  dialog.warning({ title: '删除项目', content: `删除「${project.name}」？凭证和回收站条目会保留，并解除项目归属。`, positiveText: '删除项目', negativeText: '取消',
    onPositiveClick: async () => {
      try { await projectService.remove(project.id); await vault.load() }
      catch { message.error('删除失败，请重试'); return false }
    },
  })
}
</script>

<template>
  <AppShell>
    <div class="page-heading"><div><n-text depth="3">工作区</n-text><h1>项目</h1></div><n-button type="primary" @click="edit()">新建项目</n-button></div>
    <n-alert v-if="vault.error" type="error">{{ vault.error }} <n-button text @click="vault.load">重试</n-button></n-alert>
    <n-spin :show="vault.loading">
      <n-empty v-if="!vault.loading && !visibleProjects.length" :description="vault.query ? '没有匹配的项目' : '还没有项目'" />
      <n-list v-else bordered>
        <n-list-item v-for="project in visibleProjects" :key="project.id">
          <div class="project-row">
            <span class="project-icon" :style="{ backgroundColor: project.color ?? '#8ab4f8' }">{{ project.icon || '📁' }}</span>
            <div class="project-info">
              <n-button text class="project-name" @click="router.push({ name: 'vault', query: { project: project.id } })">{{ project.name }}</n-button>
              <n-text v-if="project.description" depth="3" class="description">{{ project.description }}</n-text>
              <n-text depth="3" class="access">{{ project.itemCount }} 条凭证 · {{ project.lastAccessedAt ? `最近访问 ${new Date(project.lastAccessedAt).toLocaleString()}` : '尚未访问' }}</n-text>
            </div>
            <n-space><n-button size="small" @click="edit(project)">编辑</n-button><n-button size="small" @click="remove(project)">删除</n-button></n-space>
          </div>
        </n-list-item>
      </n-list>
    </n-spin>
    <n-modal v-model:show="show" preset="card" :title="editingId ? '编辑项目' : '新建项目'" style="width: 520px">
      <n-form @submit.prevent="save">
        <n-form-item label="项目名称" required :validation-status="error ? 'error' : undefined" :feedback="error"><n-input v-model:value="form.name" placeholder="项目名称" :maxlength="80" autofocus /></n-form-item>
        <div class="appearance">
          <n-form-item label="图标"><n-select v-model:value="form.icon" :options="icons" /></n-form-item>
          <n-form-item label="颜色"><input v-model="form.color" type="color" aria-label="项目颜色" /></n-form-item>
        </div>
        <n-form-item label="描述"><n-input v-model:value="form.description" type="textarea" placeholder="项目描述（可选）" :maxlength="500" /></n-form-item>
        <n-space justify="end"><n-button @click="show = false">取消</n-button><n-button type="primary" attr-type="submit" :loading="saving">保存项目</n-button></n-space>
      </n-form>
    </n-modal>
  </AppShell>
</template>

<style scoped>
.page-heading, .project-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-heading { margin-bottom: 24px; }
.page-heading h1 { margin: 4px 0 0; font-size: 26px; }
.project-icon { width: 44px; height: 44px; border-radius: 10px; display: grid; place-items: center; font-size: 24px; flex-shrink: 0; }
.project-info { flex: 1; min-width: 0; }
.project-name { font-size: 16px; font-weight: 600; }
.description, .access { display: block; margin-top: 4px; overflow-wrap: anywhere; }
.access { font-size: 12px; }
.appearance { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
input[type=color] { width: 100%; height: 34px; padding: 2px; border: 0; background: transparent; }
</style>

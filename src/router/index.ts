import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/unlock' },
    { path: '/unlock', name: 'unlock', component: () => import('../views/UnlockView.vue') },
    { path: '/vault', name: 'vault', component: () => import('../views/VaultView.vue') },
    { path: '/projects', name: 'projects', component: () => import('../views/ProjectsView.vue') },
    { path: '/generator', name: 'generator', component: () => import('../views/GeneratorView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/vault' },
  ],
})

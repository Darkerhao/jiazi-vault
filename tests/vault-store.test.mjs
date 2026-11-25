import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

test('vault reuses summaries, coalesces reads, loads trash on demand and applies saved summaries', async () => {
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, hmr: false } })
  try {
    const { createPinia, setActivePinia } = await server.ssrLoadModule('pinia')
    const { vaultService } = await server.ssrLoadModule('/src/services/vault.ts')
    const { projectService } = await server.ssrLoadModule('/src/services/project.ts')
    const { useVaultStore } = await server.ssrLoadModule('/src/stores/vault.ts')
    setActivePinia(createPinia())
    const calls = []
    const item = { id: 'a', title: 'Account', type: 'login', primaryKind: 'password', projectId: 'p', favorite: false, pinned: false, createdAt: 1, updatedAt: 1 }
    vaultService.listItems = async trashed => { calls.push(trashed ? 'trash' : 'active'); return trashed ? [] : [item] }
    projectService.list = async () => { calls.push('projects'); return [{ id: 'p', name: 'Project', itemCount: 1 }] }
    vaultService.updateItem = async value => { calls.push('update'); return { ...item, title: value.title, updatedAt: 2 } }
    vaultService.createItem = async () => { calls.push('create'); return { ...item, id: 'b' } }
    const vault = useVaultStore()
    await Promise.all([vault.load(), vault.load()])
    assert.deepEqual(calls, ['active', 'projects'])
    await vault.load()
    assert.equal(calls.length, 2, 'returning to a loaded view must not reload')
    await vault.updateItem({ ...item, title: 'Renamed' })
    assert.equal(vault.items[0].title, 'Renamed')
    await vault.createItem(item)
    assert.equal(vault.items.length, 2)
    assert.equal(vault.projects[0].itemCount, 2)
    assert.deepEqual(calls, ['active', 'projects', 'update', 'create'])
    vault.filter = 'trash'
    await vault.load()
    assert.equal(calls.at(-1), 'trash')
    assert.equal(calls.length, 5)
    let finish
    vault.clear()
    vaultService.listItems = () => new Promise(resolve => { finish = resolve })
    const stale = vault.load()
    vault.clear()
    finish([item])
    await stale
    assert.deepEqual(vault.items, [], 'a read completing after lock must not repopulate summaries')
    vaultService.listItems = async trashed => trashed ? [] : [item]
    await vault.load()
    vaultService.updateItem = () => new Promise(resolve => { finish = resolve })
    const saving = vault.updateItem({ ...item, title: 'Late update' })
    await Promise.resolve()
    vault.clear()
    finish({ ...item, title: 'Late update' })
    await saving
    assert.deepEqual(vault.items, [], 'a save completing after lock must not repopulate summaries')

    let databaseItems = [item]
    vaultService.listItems = async trashed => {
      if (trashed) return []
      const snapshot = [...databaseItems]
      await new Promise(resolve => { finish = resolve })
      return snapshot
    }
    const loading = vault.load()
    const refreshing = vault.load(true)
    databaseItems = [{ ...item, title: 'External update' }]
    finish()
    await loading
    await new Promise(resolve => setImmediate(resolve))
    finish()
    await refreshing
    assert.equal(vault.items[0].title, 'External update', 'a refresh during a read must observe the later database change')
  } finally { await server.close() }
})

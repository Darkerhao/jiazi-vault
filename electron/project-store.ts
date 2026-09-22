import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export interface ProjectInput {
  name: string
  icon?: string
  color?: string
  description?: string
}

export interface Project extends ProjectInput {
  id: string
  itemCount: number
  lastAccessedAt?: number
}

export function validateProject(value: unknown): ProjectInput {
  if (!value || typeof value !== 'object') throw new Error('INVALID_PROJECT')
  const input = value as ProjectInput
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80
    || (input.icon !== undefined && (typeof input.icon !== 'string' || input.icon.length > 8))
    || (input.color !== undefined && !/^#[0-9a-f]{6}$/i.test(input.color))
    || (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 500))) throw new Error('INVALID_PROJECT')
  return { name: input.name.trim(), icon: input.icon, color: input.color, description: input.description?.trim() }
}

export function createProjectStore(db: DatabaseSync) {
  const select = `SELECT p.*, (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.deleted_at IS NULL) AS item_count FROM projects p`
  function map(row: Record<string, unknown>): Project {
    return {
      id: String(row.id), name: String(row.name), icon: row.icon === null ? undefined : String(row.icon),
      color: row.color === null ? undefined : String(row.color), description: row.description === null ? undefined : String(row.description),
      lastAccessedAt: row.last_accessed_at === null ? undefined : Number(row.last_accessed_at), itemCount: Number(row.item_count),
    }
  }
  function get(id: string): Project {
    const row = db.prepare(`${select} WHERE p.id = ?`).get(id)
    if (!row) throw new Error('PROJECT_NOT_FOUND')
    return map(row)
  }
  function validate(input: unknown, id = '') {
    const project = validateProject(input)
    if (db.prepare('SELECT 1 FROM projects WHERE name = ? AND id != ?').get(project.name, id)) throw new Error('PROJECT_NAME_EXISTS')
    return project
  }
  return {
    list: () => db.prepare(`${select} ORDER BY p.name`).all().map(map),
    create(input: ProjectInput) {
      const p = validate(input)
      const id = randomUUID()
      db.prepare('INSERT INTO projects (id, name, icon, color, description) VALUES (?, ?, ?, ?, ?)')
        .run(id, p.name, p.icon ?? null, p.color ?? null, p.description ?? null)
      return get(id)
    },
    update(input: ProjectInput & { id: string }) {
      get(input.id)
      const p = validate(input, input.id)
      db.prepare('UPDATE projects SET name = ?, icon = ?, color = ?, description = ? WHERE id = ?')
        .run(p.name, p.icon ?? null, p.color ?? null, p.description ?? null, input.id)
      return get(input.id)
    },
    visit(id: string) {
      get(id)
      db.prepare('UPDATE projects SET last_accessed_at = ? WHERE id = ?').run(Date.now(), id)
      return get(id)
    },
    remove(id: string) {
      get(id)
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('UPDATE items SET project_id = NULL WHERE project_id = ?').run(id)
        db.prepare('DELETE FROM projects WHERE id = ?').run(id)
        db.exec('COMMIT')
      } catch {
        db.exec('ROLLBACK')
        throw new Error('PROJECT_DELETE_FAILED')
      }
    },
  }
}

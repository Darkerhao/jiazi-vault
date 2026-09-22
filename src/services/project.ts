import { callCommand } from './ipc'
import type { ProjectInput } from '../types/vault'

export const projectService = {
  list: () => callCommand('list_projects'),
  create: (project: ProjectInput) => callCommand('create_project', { project }),
  update: (project: ProjectInput & { id: string }) => callCommand('update_project', { project }),
  visit: (id: string) => callCommand('visit_project', { id }),
  remove: (id: string) => callCommand('delete_project', { id }),
}

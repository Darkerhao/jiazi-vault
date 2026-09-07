import { callCommand } from './ipc'
import type { Project } from '../types/vault'

export const projectService = {
  list: () => callCommand('list_projects'),
  create: (project: Omit<Project, 'id' | 'itemCount'>) => callCommand('create_project', { project }),
  update: (project: Project) => callCommand('update_project', { project }),
  remove: (id: string) => callCommand('delete_project', { id }),
}

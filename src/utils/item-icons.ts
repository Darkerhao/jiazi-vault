import type { Component } from 'vue'
import { AlbumsOutline, CodeSlashOutline, DocumentTextOutline, KeyOutline, OptionsOutline, PersonCircleOutline, ServerOutline, TerminalOutline } from '@vicons/ionicons5'
import type { ItemType } from '../types/vault'

export const ITEM_TYPE_ICONS: Record<ItemType, Component> = {
  login: PersonCircleOutline,
  password: KeyOutline,
  server: ServerOutline,
  database: AlbumsOutline,
  'api-key': CodeSlashOutline,
  ssh: TerminalOutline,
  'secure-note': DocumentTextOutline,
  custom: OptionsOutline,
  env: CodeSlashOutline,
}

import type { Environment, ItemType } from '../types/vault'

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  login: '登录账号',
  password: '密码',
  server: '服务器',
  database: '数据库',
  'api-key': 'API Key',
  ssh: 'SSH',
  'secure-note': '安全笔记',
  custom: '自定义',
  env: '环境变量集',
}

export const ITEM_TYPE_OPTIONS = (Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((type) => ({
  label: ITEM_TYPE_LABELS[type],
  value: type,
}))

export const ENVIRONMENT_OPTIONS: { label: string; value: Environment }[] = [
  { label: 'Development', value: 'development' },
  { label: 'Testing', value: 'testing' },
  { label: 'Staging', value: 'staging' },
  { label: 'Production', value: 'production' },
  { label: 'Other', value: 'other' },
]

export interface FieldDef {
  key: string
  label: string
  kind: 'text' | 'password' | 'textarea'
  sensitive?: boolean
  target: 'username' | 'password' | 'url' | 'host' | 'port' | 'notes' | 'field'
}

export const TYPE_FIELDS: Record<ItemType, FieldDef[]> = {
  login: [
    { key: 'username', label: '用户名', kind: 'text', target: 'username' },
    { key: 'password', label: '密码', kind: 'password', target: 'password' },
    { key: 'url', label: 'URL', kind: 'text', target: 'url' },
    { key: 'notes', label: '备注', kind: 'textarea', target: 'notes' },
  ],
  password: [
    { key: 'username', label: '用户名', kind: 'text', target: 'username' },
    { key: 'password', label: '密码', kind: 'password', target: 'password' },
    { key: 'url', label: 'URL', kind: 'text', target: 'url' },
    { key: 'notes', label: '备注', kind: 'textarea', target: 'notes' },
  ],
  server: [
    { key: 'host', label: '主机', kind: 'text', target: 'host' },
    { key: 'port', label: '端口', kind: 'text', target: 'port' },
    { key: 'username', label: '用户名', kind: 'text', target: 'username' },
    { key: 'password', label: '密码', kind: 'password', target: 'password' },
    { key: 'sshKey', label: 'SSH Key', kind: 'textarea', target: 'field', sensitive: true },
    { key: 'notes', label: '备注', kind: 'textarea', target: 'notes' },
  ],
  database: [
    { key: 'dbType', label: '数据库类型', kind: 'text', target: 'field' },
    { key: 'host', label: '主机', kind: 'text', target: 'host' },
    { key: 'port', label: '端口', kind: 'text', target: 'port' },
    { key: 'dbName', label: '数据库名', kind: 'text', target: 'field' },
    { key: 'username', label: '用户名', kind: 'text', target: 'username' },
    { key: 'password', label: '密码', kind: 'password', target: 'password' },
    { key: 'connectionString', label: '连接串', kind: 'text', target: 'field', sensitive: true },
    { key: 'notes', label: '备注', kind: 'textarea', target: 'notes' },
  ],
  'api-key': [
    { key: 'provider', label: '服务商', kind: 'text', target: 'field' },
    { key: 'apiKey', label: 'API Key', kind: 'password', target: 'field' },
    { key: 'secret', label: 'Secret', kind: 'password', target: 'field' },
    { key: 'endpoint', label: 'Endpoint', kind: 'text', target: 'field' },
    { key: 'expiresAt', label: '过期时间', kind: 'text', target: 'field' },
    { key: 'notes', label: '备注', kind: 'textarea', target: 'notes' },
  ],
  ssh: [
    { key: 'host', label: '主机', kind: 'text', target: 'host' },
    { key: 'port', label: '端口', kind: 'text', target: 'port' },
    { key: 'username', label: '用户名', kind: 'text', target: 'username' },
    { key: 'privateKey', label: '私钥', kind: 'textarea', target: 'field', sensitive: true },
    { key: 'passphrase', label: 'Passphrase', kind: 'password', target: 'field' },
    { key: 'notes', label: '备注', kind: 'textarea', target: 'notes' },
  ],
  'secure-note': [
    { key: 'content', label: '内容', kind: 'textarea', target: 'notes' },
  ],
  custom: [],
  env: [],
}

const PRIMARY_COPY = {
  login: ['复制密码', '密码'],
  password: ['复制密码', '密码'],
  server: ['复制密码', '密码'],
  database: ['复制密码', '密码'],
  'api-key': ['复制 API Key', 'API Key'],
  ssh: ['复制私钥', '私钥'],
  'secure-note': ['复制内容', '内容'],
  custom: ['复制内容', '内容'],
  env: ['复制 .env', '完整 .env 内容'],
} as const satisfies Record<ItemType, readonly [string, string]>

export function primaryLabel(type: ItemType) {
  return PRIMARY_COPY[type][0]
}

export function primaryValueLabel(type: ItemType) {
  return PRIMARY_COPY[type][1]
}

export function primaryOptionLabel(type: ItemType) {
  return type === 'env' ? '完整 .env（需确认）' : PRIMARY_COPY[type][1]
}

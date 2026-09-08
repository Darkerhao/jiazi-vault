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
}

export type SupportedType = Exclude<ItemType, 'custom'>

const SUPPORTED_TYPES: SupportedType[] = ['login', 'password', 'server', 'database', 'api-key', 'ssh', 'secure-note']

export const ITEM_TYPE_OPTIONS: { label: string; value: SupportedType }[] = SUPPORTED_TYPES.map((type) => ({
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
  target: 'username' | 'password' | 'url' | 'host' | 'port' | 'notes' | 'field'
}

export const TYPE_FIELDS: Record<SupportedType, FieldDef[]> = {
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
    { key: 'sshKey', label: 'SSH Key', kind: 'textarea', target: 'field' },
    { key: 'notes', label: '备注', kind: 'textarea', target: 'notes' },
  ],
  database: [
    { key: 'dbType', label: '数据库类型', kind: 'text', target: 'field' },
    { key: 'host', label: '主机', kind: 'text', target: 'host' },
    { key: 'port', label: '端口', kind: 'text', target: 'port' },
    { key: 'dbName', label: '数据库名', kind: 'text', target: 'field' },
    { key: 'username', label: '用户名', kind: 'text', target: 'username' },
    { key: 'password', label: '密码', kind: 'password', target: 'password' },
    { key: 'connectionString', label: '连接串', kind: 'text', target: 'field' },
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
    { key: 'privateKey', label: '私钥', kind: 'textarea', target: 'field' },
    { key: 'passphrase', label: 'Passphrase', kind: 'password', target: 'field' },
    { key: 'notes', label: '备注', kind: 'textarea', target: 'notes' },
  ],
  'secure-note': [
    { key: 'content', label: '内容', kind: 'textarea', target: 'notes' },
  ],
}

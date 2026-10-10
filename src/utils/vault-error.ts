const messages: Record<string, string> = {
  VAULT_LOCKED: '保险库已锁定，请解锁后重试。',
  VAULT_BUSY: '保险库正在处理其他操作，请稍后重试。',
  ITEM_NOT_FOUND: '凭证已不存在，请刷新列表。',
  ITEM_STATE_CHANGED: '凭证状态已变化，请刷新列表后重试。',
  PROJECT_NOT_FOUND: '项目已不存在，请重新选择项目。',
  PROJECT_NAME_EXISTS: '项目名称已存在，请使用其他名称。',
  DECRYPT_FAILED: '凭证解密失败，请从有效备份恢复。',
  DATABASE_ERROR: '无法读写本地数据库，请重启应用；仍失败时请从备份恢复。',
  INVALID_DATA: '凭证内容不符合要求，请检查后重试。',
  INVALID_EXPIRY: '有效期格式不正确，请重新选择日期。',
  ENVIRONMENT_REQUIRED: '环境变量集必须指定环境，本次修改未保存。',
}

/** IPC wraps Error messages; expose only known codes, never raw diagnostic text. */
export function vaultErrorMessage(cause: unknown, fallback: string) {
  const text = String(cause)
  const code = text.match(/\b(?:VAULT_LOCKED|VAULT_BUSY|ITEM_NOT_FOUND|ITEM_STATE_CHANGED|PROJECT_NOT_FOUND|PROJECT_NAME_EXISTS|DECRYPT_FAILED|DATABASE_ERROR|INVALID_DATA|INVALID_EXPIRY|ENVIRONMENT_REQUIRED)\b/)?.[0]
  if (code) return messages[code]!
  if (/\b(?:SQLITE_[A-Z_]+|ERR_SQLITE_ERROR)\b/.test(text)) return messages.DATABASE_ERROR!
  return fallback
}

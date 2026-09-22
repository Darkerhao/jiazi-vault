# Windows 交付与数据交换

## 安装包

- 文件：`release/Jiazi Vault Setup 0.1.0.exe`，Windows x64 NSIS 引导安装，可选择目录，完成后不自动启动。
- SHA-256：`680686C2A790F00E897BA191EAEE4F87816656A07BD3A31911AC3177EEA58A97`。
- 大小：123,559,190 字节；未代码签名，Windows 可能显示未知发布者。
- 构建：`pnpm electron:build:win`。使用 `node_modules/electron/dist` 中已安装的同版本 Windows Electron，避免再次下载 Electron。需要先完成依赖安装及 Electron 安装脚本。
- 已在 Windows 11 上将安装包静默安装到 `output/windows-install`，退出码为 0；测试数据使用独立 `--user-data-dir`，不使用个人保险库。
- 测试安装已卸载，卸载退出码为 0，程序文件已移除，独立测试保险库仍保留。安装/卸载记录在 `output/playwright/windows-install-report.json`。

## 本轮功能

- 最近使用记录实际打开凭证和成功复制的时间，持久化为 `last_accessed_at`。创建、修改、收藏、列表查询、导出不更新该时间；从未使用的条目不进入最近使用。旧库迁移不伪造历史记录。
- 回收站按首次删除时间保留 30 天。启动、读取条目、备份恢复、系统恢复运行和每分钟定时检查会永久删除过期条目。应用关闭期间在下次启动补做清理；运行时定时检查最多约延迟一分钟。
- 加密备份升级为 v3，保留使用时间；仍读取 v1/v2 备份。恢复旧备份不会重新延长回收站期限。旧版本应用不支持读取 v3 备份。
- 设置页提供 JSON/CSV 明文导入导出。导出二次确认由主进程执行，默认取消；锁定使等待中的文件操作失效。明文文件包含密码、私钥等敏感数据，完整备份仍应使用 `.jvault`。
- 导入追加新条目、生成新 ID，不覆盖现有凭证；重复导入会产生重复项。整份文件先校验，写入失败事务回滚，不留下部分凭证或项目。
- 导入的额外字段可在编辑器查看、复制、编辑，并保留原类型；本轮仍未提供 Custom 创建及增删字段入口。

## JSON / CSV 格式

仅包含有效凭证，不包含回收站、设置、项目图标/颜色/描述。项目按名称关联，不存在则创建；同名匹配使用现有 SQLite NOCASE 规则。

JSON 为对象数组，例如：

```json
[
  {
    "type": "login",
    "title": "示例账号",
    "project": "示例项目",
    "environment": "production",
    "username": "user",
    "password": "example-secret",
    "tags": ["example"],
    "fields": {"token": "example-token"},
    "favorite": false
  }
]
```

CSV 使用 UTF-8，可包含 BOM；第一行为字段名，必填列为 `type,title`，其他列可省略或调整顺序。支持引号、逗号、CRLF/LF、多行内容；引号以两个引号转义。

允许字段：`type,title,project,environment,username,password,url,host,port,notes,tags,fields,favorite,createdAt,updatedAt,lastAccessedAt`。

- `type`：login、password、server、database、api-key、ssh、secure-note、custom。
- `title`：非空字符串。
- `environment`：development、testing、staging、production、other。
- `port`：0–65535 整数；`favorite`：布尔值，省略为 false。
- `tags`：字符串数组；`fields`：字符串值对象；在 CSV 中均使用 JSON 文本。
- 时间字段：非负整数，Unix 毫秒。缺少创建/修改时间则使用导入时间；缺少使用时间则保持未使用。
- CSV 单元格以 `= + - @`、制表符、回车、换行或单引号开头时，导出增加一个单引号，导入按相同规则去掉转义。这是本应用的可逆文本约定。外部 CSV 需遵守此约定；推荐 JSON 做无歧义的数据交换。
- 不接受未列出的字段、无效类型、损坏 CSV、非数组 JSON；单个导入文件上限 64 MiB。其他密码管理器的专有格式需先转为本格式。

## 验证

- `pnpm test`：28 项测试通过，覆盖旧库迁移、30 天边界、使用记录、备份版本与回滚、JSON/CSV 往返和错误输入。
- `pnpm build`：Vue 类型检查、Vite 生产构建、Electron TypeScript 编译通过。
- `tests/electron-smoke.mjs`：11 项流程通过，真实 Electron UI/SQLite/剪贴板与原生 IPC；文件选择、确认框响应由测试注入，系统锁定由事件模拟。报告在 `output/playwright/batch3-smoke-report.json`。
- `tests/installed-smoke.mjs`：4 项流程通过，运行真正安装后的应用，使用独立数据目录，检查原生依赖、凭证持久化、实际一分钟清理定时器和重启。报告在 `output/playwright/installed-smoke-report.json`。
- 桌面脚本运行前，将 `JIAZI_PLAYWRIGHT_MODULE` 设置为已安装 `playwright-core/index.mjs` 的绝对路径；脚本不进入常规 `pnpm test`。

未完成的验收：macOS/Linux 构建、10,000 条凭证/搜索/冷启动性能测试、全局快捷键物理按键与冲突、真实系统锁屏和休眠。生物识别与后续版本的环境变量、SSH 连接、浏览器自动填充、同步、移动端、团队保险库不在本轮范围。

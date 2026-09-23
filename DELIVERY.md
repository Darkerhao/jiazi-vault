# 交付与验收

## 上一轮 Windows 安装包

以下安装包来自第三批交付，尚未包含本轮自定义字段、分类和性能改动。本轮已更新源码与 `dist` / `dist-electron`，未重新生成或安装 NSIS 包；打包当前版本使用 `pnpm electron:build:win`。

- 文件：`release/Jiazi Vault Setup 0.1.0.exe`，Windows x64 NSIS 引导安装，可选择目录，完成后不自动启动。
- SHA-256：`680686C2A790F00E897BA191EAEE4F87816656A07BD3A31911AC3177EEA58A97`。
- 大小：123,559,190 字节；未代码签名，Windows 可能显示未知发布者。
- 构建：`pnpm electron:build:win`。使用 `node_modules/electron/dist` 中已安装的同版本 Windows Electron，避免再次下载 Electron。需要先完成依赖安装及 Electron 安装脚本。
- 已在 Windows 11 上将安装包静默安装到 `output/windows-install`，退出码为 0；测试数据使用独立 `--user-data-dir`，不使用个人保险库。
- 测试安装已卸载，卸载退出码为 0，程序文件已移除，独立测试保险库仍保留。安装/卸载记录在 `output/playwright/windows-install-report.json`。

## 本轮功能

- 新建入口包含全部八种凭证类型，Custom 可从空字段开始创建。所有类型均可添加额外字段，并修改字段名、字段值或删除字段；空名称、去除首尾空白后的重名、与模板字典字段重名会阻止保存。空字段值保留，删除最后一个字段后不会恢复旧字段。
- 已保存的自定义字段默认隐藏，点击「显示」后可编辑多行内容；「复制」直接复制完整原值。数据仍使用原有加密字段字典，没有数据库迁移或新增依赖。
- 左侧新增「分类」及八类入口；列表可组合类型、项目、环境、关键词过滤，收藏/最近使用/回收站复用相同类型筛选。分类下的新建按钮和 Ctrl+N 默认使用当前类型。
- 所有凭证值字段均可一键复制：用户名、密码、URL、Host、端口、连接串、私钥、备注、安全笔记、自定义字段。空值按钮禁用，继续复用主进程剪贴板清理和成功使用记录。
- 列表和快捷搜索使用统一类型图标；快捷搜索单独显示类型，同时保留项目、环境和账号/Host/URL 摘要，不显示密码。
- 列表每页 25 条，支持翻页/跳页、总数和筛选重置页码；共享元数据搜索索引，快捷搜索最多展示 50 条。索引不包含密码、私钥、笔记或自定义字段值。

## 已有功能

- 最近使用记录实际打开凭证和成功复制的时间，持久化为 `last_accessed_at`。创建、修改、收藏、列表查询、导出不更新该时间；从未使用的条目不进入最近使用。旧库迁移不伪造历史记录。
- 回收站按首次删除时间保留 30 天。启动、读取条目、备份恢复、系统恢复运行和每分钟定时检查会永久删除过期条目。应用关闭期间在下次启动补做清理；运行时定时检查最多约延迟一分钟。
- 加密备份升级为 v3，保留使用时间；仍读取 v1/v2 备份。恢复旧备份不会重新延长回收站期限。旧版本应用不支持读取 v3 备份。
- 设置页提供 JSON/CSV 明文导入导出。导出二次确认由主进程执行，默认取消；锁定使等待中的文件操作失效。明文文件包含密码、私钥等敏感数据，完整备份仍应使用 `.jvault`。
- 导入追加新条目、生成新 ID，不覆盖现有凭证；重复导入会产生重复项。整份文件先校验，写入失败事务回滚，不留下部分凭证或项目。
- 导入的额外字段可在编辑器查看、复制、编辑、重命名、删除，并保留原类型；导入的模板外通用字段也会显示并保留。

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
- `tests/credentials-smoke.mjs`：6 组新增功能流程通过，覆盖 Custom 创建/字段校验/增删改/空值/隐藏显示、多行及各类字段真实复制、组合分类过滤/导航历史/新建默认类型、搜索结果信息、删除全部字段与重启；无 renderer error。报告在 `output/playwright/credentials-smoke-report.json`。
- `tests/installed-smoke.mjs`：上一轮 4 项流程通过，运行真正安装后的应用，使用独立数据目录，检查原生依赖、凭证持久化、实际一分钟清理定时器和重启。报告在 `output/playwright/installed-smoke-report.json`；本轮未重复安装验收。
- 桌面脚本运行前，将 `JIAZI_PLAYWRIGHT_MODULE` 设置为已安装 `playwright-core/index.mjs` 的绝对路径；脚本不进入常规 `pnpm test`。

## 10,000 条性能验收（2026-09-23）

Windows 11（10.0.22631），i9-13900H，20 逻辑核，约 31.7 GiB 内存。独立保险库含 10,000 条真实加密凭证、100 个项目、全部八类凭证；通过真实 IPC 验证编辑、删除、恢复，并验证第 400 页可达。

| 指标 | 本轮结果 | 规格目标 |
|---|---:|---:|
| 进程启动至解锁表单绘制完成，5 次 | 477.2–551.0 ms | < 1500 ms |
| 主列表搜索，18 个样本 | 16.4–39.1 ms | < 100 ms |
| 快捷搜索，18 个样本 | 28.7–34.0 ms | < 100 ms |
| 解锁操作至首屏凭证列表 | 632.6 ms | 无单独指标 |
| 单页渲染 / 数据库凭证 | 25 / 10,000 条 | 10,000+ 可用 |

搜索覆盖唯一名称、多结果、项目+环境多词、无结果、敏感字段不命中、清空查询；每个查询重复 3 次，计时包含输入事件、过滤、DOM 更新与两帧绘制等待。全部实测样本符合目标。

基线生产页面一次渲染 10,000 行：解锁后列表显示 18,852.6ms，production 首次搜索 9,200.8ms，清空搜索 22,738.2ms；基线快捷搜索阶段超时，没有该项有效基线。对应报告：`output/playwright/performance-baseline.json`、`output/playwright/performance-current.json`。

边界：启动测量采用新的 Electron 进程、生产构建页面和测试启动器，保留操作系统磁盘缓存，排除输入主密码及密码派生时间；包含 Playwright 调试开销。它是本机新进程启动验证，不代表清空系统缓存后的硬冷启动、已安装产物或其他机器的性能承诺。

复现：先执行 `pnpm build`，设置 `JIAZI_PLAYWRIGHT_MODULE` 为现有 `playwright-core/index.mjs` 绝对路径，再运行 `node tests/credentials-smoke.mjs`、`node tests/electron-smoke.mjs`、`node tests/performance.mjs`（桌面脚本顺序执行，避免争用剪贴板或窗口焦点）。性能默认启动 5 次，可用 `JIAZI_PERF_RUNS` 调整；报告和隔离测试库写入 `output/playwright`。

仍待完成：macOS/Linux 构建与运行、清空系统缓存的硬冷启动及安装产物性能、全局快捷键物理按键与冲突、真实系统锁屏和休眠、Windows 代码签名。生物识别、修改主密码与后续版本的环境变量、SSH 连接、浏览器自动填充、同步、移动端、团队保险库未在本轮实现。

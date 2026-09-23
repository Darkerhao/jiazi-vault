# 交付与验收

## V1.2 环境变量集（0.1.2，2026-09-23）

入口：新建条目选择「环境变量集」，或从「分类 → 环境变量集」进入。可按项目和环境筛选；环境必选，项目可选，删除项目后变量集保留并解除归属。

- 变量名和值复用 `items.secret` 中的加密 fields；列表和搜索索引不包含变量名和值，不增加数据库表或依赖。
- 支持变量增删改、默认隐藏、逐项显示/复制（含空值），从文件或粘贴内容导入。导入先预览，加入编辑后仍须保存；导入采用追加语义，重复键或与现有变量同名时阻止加入，不静默覆盖。
- 文件采用 UTF-8（支持 BOM），上限 1 MiB。解析遵循 [Node.js DotEnv 文档](https://nodejs.org/api/environment_variables.html#dotenv)，并核对当前 Electron 内置 [Node 24.20.0 实现](https://github.com/nodejs/node/blob/v24.20.0/src/node_dotenv.cc)：名称为字母/下划线开头，后续可含数字；支持空值、空白、注释、单双引号、多行和 `export` 前缀；双引号内字面量 `\n` 转换为换行，单引号保留字面量。CRLF 转为 LF，不做变量展开、命令执行或系统环境变量修改。
- 导入更严格：无效行、未闭合引号、引号后多余内容、反引号和重复键显示行号并阻止导入。Node 原生解析器可能静默跳过或覆盖，此处主动要求用户修正。
- 完整复制和导出 `.env` 都由主进程显示明文确认，默认取消，输出当前编辑值。导出保持值和空值，不保留原注释、引号样式或排版；采用 UTF-8/LF，可命名为 `.env.production` 等文件，不自动改写项目文件。
- Node 不支持通用引号转义：对无法无损表示的值（例如同时含单双引号与换行，或含 CR/NUL）明确提示变量名并禁用 `.env` 导出；仍可加密保存和通过加密备份保留，不静默截断/改值。
- 锁定销毁编辑器和导入内容，使等待中的文件选择和导出确认失效，并清理本应用剪贴板。变量集复用回收站、自动清理、加密备份/恢复、主密码修改和 JSON/CSV 导入导出。含 env 类型的备份须使用本版或更新版本恢复。

本轮自动验证：41 项 Node 数据测试通过，生产构建通过；`tests/env-smoke.mjs` 的 7 组真实 Electron 流程通过，包括导入→编辑→复制/导出值一致、默认隐藏、无效/重名阻止、重启、回收站、备份恢复、修改主密码和锁定竞态。文件选择与确认返回值由脚本注入，数据、加密、IPC、剪贴板及文件写入为真实实现，均使用隔离保险库。报告：`output/playwright/env-smoke-report.json`。

Windows 本轮已实测：独立进程占用全局快捷键时有可见提示且 Ctrl K 可用，释放占用后重启注册成功；用户操作 Windows Hello 真实取消后保持锁定，主密码仍可解锁；实际 Win+L/登录事件使保险库锁定、编辑器销毁、剪贴板清空，解锁后变量完整。分别见 `windows-conflict-v12-report.json`、`windows-cancel-v12-report.json`、`windows-lock-v12-report.json`（均在 `output/playwright`）。休眠/唤醒和新安装产物验收进行中，最终记录见下文。

安装包：`release/Jiazi Vault Setup 0.1.2.exe`（Windows x64 NSIS）。签名和硬冷启动单独验收；macOS/Linux 构建、Touch ID 实机测试仍需对应设备。SSH 连接、浏览器扩展、同步、移动端和团队能力未扩展。

## 历史 Windows 安装包（0.1.1，2026-09-23）

包含第四批自定义字段、分类、复制与性能改动，以及本轮首次引导、修改主密码和系统快捷解锁。

- 文件：`release/Jiazi Vault Setup 0.1.1.exe`，Windows x64 NSIS 引导安装，可选择目录，完成后不自动启动。
- SHA-256：`31E90EB0FA5037E4975AF5B88BEC58C139106E365C3F39EA9AEF201930C77413`。
- 大小：127,961,584 字节；签名实测为 `NotSigned`，Windows 可能显示未知发布者。
- 构建：`pnpm electron:build:win`。使用本地同版本 Electron；Windows 构建机还需 .NET 9 SDK。`build` / `electron:dev` 自动构建 Windows Hello 辅助程序，macOS/Linux 跳过此 Windows 组件。安装包内置 .NET 9.0.20 运行时，用户无需安装 .NET。
- 已在 Windows 11 上将安装包静默安装到 `output/windows-install`，退出码为 0；测试数据使用独立 `--user-data-dir`，不使用个人保险库。
- 本轮安装记录：`output/playwright/windows-install-v0.1.1-report.json`。旧 0.1.0 包和 `windows-install-report.json` 是历史交付记录。
- 隔离安装及卸载退出码均为 0，测试程序已移除，独立测试保险库保留；没有使用个人保险库。

## 本轮 V1 功能与安全边界

- 首次使用：独立欢迎页 → 设置主密码 → 确认主密码 → 安全须知 → 创建保险库；短密码、不一致及未确认安全须知均不能创建，支持返回上一步。
- 设置页可修改主密码：验证当前密码，限制错误尝试；全部有效凭证和回收站密文、校验信息在同一 SQLite 事务更新，失败回滚。成功后锁定并删除设备快捷解锁登记；旧备份仍用备份创建时密码，新备份用新密码。
- 系统快捷解锁默认关闭，启用需当前主密码和系统认证。Windows 使用真实 Windows Hello（系统决定指纹、人脸或 PIN）；macOS 接入 Electron Touch ID。设备不可用时仍可使用主密码；Linux 本轮没有生物识别后端。
- 主密钥只在主进程使用；设备登记保存 `safeStorage` 加密后的密钥，不保存主密码、不进入加密备份。每次解锁先系统认证，再取出密钥并校验当前保险库；关闭、修改主密码或恢复备份移除登记。锁定会使等待中的认证失效。
- Windows 密钥存储依赖 DPAPI，**不能防御同一登录用户权限下的其他进程读取**；这是便利解锁，不是 TPM 绑定的密钥存储。macOS 使用 Keychain，需要在 macOS 上验证并使用稳定应用签名。[Electron 44.2.0 安全存储说明](https://github.com/electron/electron/blob/v44.2.0/docs/api/safe-storage.md)
- Windows 原生组件编译有 SDK WinRT 程序集的 IL2104 裁剪警告；可用性及认证路径已在当前 Windows 11 实测。Touch ID、macOS/Linux 构建运行仍未验收。

## 第四批功能（已包含在当前安装包）

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

- `pnpm test`：35 项测试通过，覆盖原有 28 项，以及主密码修改的数据完整性/事务回滚/旧备份、生物识别认证取消/登记校验/锁定竞态。
- `pnpm build`：Vue 类型检查、Vite 生产构建、Electron TypeScript 编译通过。
- `tests/electron-smoke.mjs`：11 项流程通过，真实 Electron UI/SQLite/剪贴板与原生 IPC；文件选择、确认框响应由测试注入，系统锁定由事件模拟。报告在 `output/playwright/batch3-smoke-report.json`。
- `tests/credentials-smoke.mjs`：6 组新增功能流程通过，覆盖 Custom 创建/字段校验/增删改/空值/隐藏显示、多行及各类字段真实复制、组合分类过滤/导航历史/新建默认类型、搜索结果信息、删除全部字段与重启；无 renderer error。报告在 `output/playwright/credentials-smoke-report.json`。
- `tests/access-smoke.mjs`：5 组新增流程通过，涵盖四步引导、UI/IPC 密码校验、修改后立即锁定、旧密码失效、新密码重启及字段/回收站保留。报告在 `output/playwright/access-smoke-report.json`。
- `tests/biometric-smoke.mjs`：用户参与的真实 Windows Hello 启用、应用重启后免主密码解锁已通过；第三次用户仍通过认证，测试的取消预期超时，不能将这一运行记为全部通过。原始报告保留在 `output/playwright/biometric-smoke-report.json`。
- 已安装 0.1.1 补测同样返回认证成功，确认发布产物及 .NET 9.0.20 组件可完成认证，但未触发预期取消；记录在 `biometric-cancel-report.json`。真实取消仍待人工验收，自动化取消/锁定竞态已通过。
- 通过 `JIAZI_BIOMETRIC_STEP=disable` 在已安装产物中验证主密码登录、关闭真实登记、锁定后拒绝生物识别，报告 `output/playwright/biometric-disable-report.json`（无错误）。
- `tests/installed-smoke.mjs`：4 组通过，实际安装程序的原生依赖、凭证持久化、实际一分钟清理及重启；`resume` 为事件模拟。报告 `output/playwright/installed-smoke-report.json`。
- `JIAZI_INSTALLED_EXE` 指向已安装 exe 后，`tests/access-smoke.mjs` 的 5 组新增流程全部通过，报告 `output/playwright/installed-access-report.json`。源码与已安装程序均无 renderer error。
- 桌面脚本运行前，将 `JIAZI_PLAYWRIGHT_MODULE` 设置为已安装 `playwright-core/index.mjs` 的绝对路径；脚本不进入常规 `pnpm test`。

## 当前安装产物的 10,000 条验收（0.1.1）

真正的 NSIS 安装程序、隔离保险库、10,000 条加密凭证和 100 个项目；25 条分页，第 400 页可达，编辑/删除/恢复可用。

| 指标 | 实测 | 规格目标 |
|---|---:|---:|
| 请求启动至解锁表单绘制完成，5 次 | 870.9–1044.0 ms | < 1500 ms |
| 主列表搜索，18 个样本 | 16.8–39.1 ms | < 100 ms |
| 快捷搜索，18 个样本 | 29.8–31.9 ms | < 100 ms |
| 解锁至首屏列表 | 1039.8 ms | 无单独指标 |
| 10,000 条数据修改主密码 | 584.4 ms | 无单独指标 |

密码修改后旧密码失效，新密码可解锁，条目总数及抽样完整字段保持一致。报告 `output/playwright/performance-installed-v0.1.1.json`，所有性能目标通过，无 renderer error。

边界：保留系统磁盘缓存；计时从测试进程发起启动请求开始，包含 Playwright 启动开销和两帧绘制，排除输入主密码及派生时间。与下方源码启动器的计时起点不同，不直接对比快慢，也不代表清空缓存的硬冷启动。

复现：安装后设置 `JIAZI_INSTALLED_EXE` 为实际安装 exe 的绝对路径，`JIAZI_PERF_LABEL=installed-v0.1.1`，以及 `JIAZI_PLAYWRIGHT_MODULE`，运行 `node tests/performance.mjs`。

## 上一轮源码构建的 10,000 条验收（2026-09-23）

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

历史 0.1.1 的待验收项由本文开头的 0.1.2 记录更新。仍独立保留 macOS/Linux 构建与运行、Touch ID 实机认证、硬冷启动及 Windows 代码签名；SSH 连接、浏览器扩展、同步、移动端与团队保险库属于后续迭代。

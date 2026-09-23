# Jiazi Vault 实现计划

## 目标

基于 `Jiazi Vault.md` 实现本地离线优先的开发者凭证保险库。本轮补齐 V1 功能缺口，并交付包含第四、第五批改动的 Windows 0.1.1 安装包。

## 本轮任务：第五批 V1 缺口与 Windows 安装包

用户已确认补齐 V1 缺口并更新 Windows 安装包，V1.2 / V1.3 / V2 保留后续范围。

- [complete] 核实生物识别系统接口和密钥存储，接通设备能力、启用/关闭与解锁生命周期。
- [complete] 补齐首次欢迎、密码设置/确认、安全说明和创建闭环。
- [complete] 设置页修改主密码，验证旧密码并事务更新全部密文，失败回滚，成功锁定。
- [complete] 安全/数据测试、真实 Electron 流程、生产构建和新版 NSIS 隔离安装验证。
- [complete] 更新 DELIVERY.md，记录产物哈希及仍需要其他系统、硬件或签名证书的验收边界。

结果：35 项 Node 测试、原有 17 组桌面回归、新增 5 组桌面流程、安装后 4+5 组流程及一万条容量/搜索/启动/密码修改通过。Windows Hello 启用、重启解锁和安装产物认证成功，关闭登记后拒绝解锁；用户两次取消测试均实际通过认证，真实取消仍待验收。Touch ID 代码接入但未实机验收。NSIS 安装/卸载退出码 0，产物与完整边界见 DELIVERY.md。

保留现有未提交改动，不暂存、不提交；沿用当前加密格式和数据库。测试使用隔离保险库，不操作个人保险库。

## 本轮任务：第四批功能与性能验收

- [complete] 自定义凭证：统一八种类型入口，字段新增、删除、重命名；阻止空名称与重复名称覆盖，保留已有字段及加密存储协议。
- [complete] 分类与搜索：Categories 入口、类型/项目/环境/关键词组合过滤，快捷搜索始终展示类型和图标。
- [complete] 全字段复制：模板字段与自定义字段统一复制入口，复用主进程剪贴板清理与使用记录。
- [complete] 验证：28 项 Node 数据测试、6 组新增桌面流程、11 项原有桌面流程、生产构建通过；10,000 条/100 项目容量、末页可达、搜索与新进程启动实测达标，结果和测量边界已写入 DELIVERY.md。

结果：自定义字段默认隐藏并可展开编辑多行值；分页 25 条；普通搜索 16.4–39.1ms，快捷搜索 28.7–34.0ms，新进程启动 477.2–551.0ms（5 次）。本轮未重新生成 Windows 安装器。

本轮沿用现有 Vue/Naive UI/Electron，不新增依赖，不暂存或提交；生物识别、主密码修改、后续版本能力和跨平台/签名/物理系统事件保留为后续缺口。性能优化须由测量定位。

## 本轮任务：第三批功能与 Windows 交付

- [complete] 真实最近使用：持久化查看/成功复制时间，与修改时间分离；未使用条目不进入最近使用；加密备份 v3 保留记录，读取 v1/v2。
- [complete] 回收站自动清理：按 deleted_at 满 30 天永久删除；启动、恢复、每分钟和休眠恢复后清理，界面说明保留期限。
- [complete] JSON/CSV：主进程文件读写、导出二次确认、仅导出有效凭证；全量校验后事务追加导入，保留字段、项目归属，错误不泄露原始数据。
- [complete] 验证与交付：28 项数据测试、11 项真实 Electron 桌面流程通过；Windows NSIS 安装包生成、隔离安装、4 项安装后流程通过，包含实际一分钟清理定时器和重启解锁。

交付文件：`release/Jiazi Vault Setup 0.1.0.exe`（x64，未签名），格式说明与复现命令见 `DELIVERY.md`。本轮无新增依赖、暂存或提交。macOS/Linux、性能指标和真实系统快捷键/锁屏/休眠仍待后续验收。

范围：不扩展 Custom、生物识别或后续版本能力；不暂存、不提交。沿用现有技术栈；对 JSON/CSV 明确记录格式和追加语义。Windows 安装验证使用独立目录与测试数据，不覆盖用户保险库。跨平台、性能和真实系统场景仅报告本轮实际取得的证据。

## 本轮任务：第二批功能

- [complete] 解锁失败限速：主进程校验、持久化失败次数和截止时间；5 次失败冷却 30 秒，后续翻倍至 15 分钟，成功清零；UI 倒计时。
- [complete] 项目管理：名称/图标/颜色/描述 CRUD、数量/最近访问、凭证归属与环境筛选、删除解除归属；备份包含项目并读取既有备份。
- [complete] 完整密码生成器：主进程安全随机、8–128 位、字符开关/排除易混淆、覆盖所有已选字符类型、实际生成规则熵估算、复制/保存。
- [complete] 快捷搜索与托盘：全局 Ctrl+Shift+P、键盘选择/复制/打开、锁定时先解锁、关闭隐藏且锁定、托盘打开/搜索/生成/锁定/退出。
- [complete] 最终验证：18 项测试、生产构建和 10 项 Electron 桌面流程通过，包含凭证编辑切换修复。

边界：沿用当前 Electron/Vue/Naive UI 与上一轮未提交改动，不新增依赖，不提交或暂存。项目删除保留凭证并解除项目归属；快捷搜索复用主窗口内弹层，避免第二套敏感数据生命周期。

### 本轮验收

- `pnpm build`：Vue TypeScript、Vite 生产构建、Electron TypeScript 全部通过。
- `pnpm test`：18/18 通过，包含原有安全功能回归、限速持久化、项目 CRUD/删除回滚、项目备份往返/旧版恢复/拒绝降级篡改、生成字符类型覆盖和熵值。
- 实际 Electron 44.2.0 Windows 生产页面：10/10 桌面流程通过，无 renderer error。报告：`output/playwright/batch2-smoke-report.json`；复测脚本：`output/playwright/batch2-smoke.mjs`。
- 实测 30 秒解锁冷却与应用重启持久化，确认冷却期不能通过直接 IPC 解锁；复制与保存使用真实主进程和 SQLite。
- 全局快捷键实际注册成功；托盘菜单与快捷键行为通过真实 Electron 回调调用验证，未发送操作系统物理快捷键，也未实测快捷键冲突分支。
- 使用独立测试数据库，退出后恢复原剪贴板文本。未运行跨平台安装器构建；项目无 ESLint 配置。
- `git diff --check` 通过；本轮无新增依赖、暂存或提交操作。

## 2026-09-22 上一轮已完成任务

- [complete] 阅读实际调用链、规格与 Electron 44.2.0 API/source。
- [complete] 主进程实现持久化设置、统一锁定生命周期、剪贴板清理与备份恢复。
- [complete] 接通设置页、解锁页恢复入口、锁定事件与敏感视图销毁。
- [complete] 验证定时策略、异步锁定竞态、备份往返/拒绝损坏/恢复回滚、桌面 UI 与构建。

### 实施边界

- 自动锁定按应用无操作时间计时，切换应用继续计时；锁屏、休眠、窗口关闭立即锁定。默认 15 分钟，可关闭无操作计时。
- 剪贴板由主进程串行处理，默认 15 秒清理；只清理仍为本应用最后复制的内容，锁定/退出也触发清理。
- 设置存入现有 SQLite settings 表；成功落盘后更新 UI，重启恢复。
- .jvault 使用现有 Argon2id/AES-256-GCM，完整加密条目与设置；备份包含回收站。恢复先校验再事务替换，覆盖已有库需明确确认，成功后锁定。
- 上一轮未扩展项目管理、托盘、全局快捷键或明文导入导出；本轮按新请求实现前三项。

## 阶段

- [complete] Phase 1 技术栈迁移：Electron + Vue 3 + TypeScript + Vite + Naive UI + Pinia + Router + Node SQLite + 安全 preload IPC
- [complete] Phase 2：Vault 创建、Argon2id、AES-256-GCM、SQLite 加密校验存储、解锁/锁定
- [complete] Phase 3：Item CRUD、收藏、搜索、七类凭证
- [complete] Phase 4：Project 与 Environment
- [complete] Phase 5：密码生成器与强度估算
- [complete] Phase 6：剪贴板清理、自动锁定、快捷搜索、快捷键与托盘
- [complete] Phase 7：加密备份/恢复、JSON/CSV 导入导出与明文二次确认已完成
- [partial] Phase 8：当前功能安全/数据测试、Windows Electron 桌面、10,000 条容量/搜索/本机新进程启动验证完成；跨平台、硬冷启动、物理快捷键/系统事件、签名仍待验收

## 上一轮验收

- `pnpm build`：Vue TypeScript、Vite 生产构建、Electron TypeScript 均通过。
- `pnpm test`：12 项 Node 测试通过，覆盖设置跨连接持久化、自动锁定/密钥清零/异步认证失效、剪贴板竞态、加密备份往返、损坏拒绝、事务回滚。
- 实际 Electron 44.2.0 生产页面运行：14 项桌面流程通过，报告在 `output/playwright/smoke-report.json`，截图在同目录。
- 验证边界：使用独立测试数据目录；文件选择和覆盖确认对话框的返回值由测试注入；锁屏/休眠为 Electron 事件模拟；5 分钟超时使用主进程时钟推进，真实剪贴板等待 5 秒。
- 未运行跨平台安装器构建；仓库未配置 ESLint，不声称已执行 lint。

### 历史基础验收

- `pnpm dev` 可启动前端
- `pnpm build` 通过
- Electron 主进程 TypeScript 编译通过
- Electron 基础窗口可启动，SQLite 数据目录可初始化
- 主题、路由、基础布局和 IPC 类型边界存在

## Phase 1 结果

- 前端：`pnpm typecheck`、`pnpm build` 通过；Vite 预览页已用浏览器快照验证。
- Electron：主进程负责 SQLite 和桌面能力，preload 仅暴露白名单 IPC；渲染进程关闭 Node 集成并启用上下文隔离。
- 运行时：Phase 1 先使用安全占位命令建立 IPC 边界，Phase 2 已替换为真实的主密码创建、密钥派生、加密校验和解锁流程。
- 验证：`pnpm build` 通过，Electron 44.2.0 桌面窗口实际启动成功，窗口标题/句柄有效，`%APPDATA%\jiazi-vault\vault.db` 已创建。

## Phase 2 结果

- 首次启动根据 SQLite 元数据自动进入创建流程，要求输入并确认至少 8 个字符的主密码。
- Electron 主进程使用 Argon2id（64 MiB、3 次、单线程）派生 32 字节主密钥，再使用 AES-256-GCM 加密固定校验标记；SQLite 仅保存版本、参数、随机盐、随机 nonce、密文和认证标签。
- 解锁使用数据库中保存的派生参数重新生成密钥，并通过 AES-GCM 认证结果判断密码是否正确；锁定和退出时清零内存密钥。
- 路由统一检查保险库状态，未解锁时不能进入业务页面。
- 验证：`pnpm build` 通过；错误密码拒绝、正确密码接受、SQLite 跨连接读取及无明文持久化检查通过；Electron 原生 Argon2 模块加载成功；实际桌面窗口显示首次创建页面。

## Phase 3 结果

- 新增 `items` 表：`password`、`notes`、`fields` 等敏感字段合并为一份 `secret` 密文（AES-256-GCM，每条随机 nonce），SQLite 不落明文；用户名/URL/主机等非敏感字段明文存储以支持搜索。
- IPC 实现：`create_item` / `get_item` / `list_items`（含回收站过滤）/ `update_item` / `toggle_favorite` / `delete_item`（软删除→回收站，`permanently` 彻底删除）/ `restore_item`。
- 前端：七类凭证（login / password / server / database / api-key / ssh / secure-note）通过 `item-fields.ts` 数据驱动渲染动态表单；列表支持收藏切换、删除、回收站恢复/彻底删除、客户端搜索（标题/用户名/URL/主机/环境/类型/标签）。
- 验证：`pnpm build` 通过；独立脚本验证密码与字段以密文存储（`secret` 列无明文）、CRUD/收藏/回收站全链路往返通过。

## 约束

- 不提交或暂存 Git 变更
- 当前迭代只实现用户点名的四项功能及闭环必需修复
- 敏感数据不进入前端持久化 Store 或日志

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
|---|---:|---|
| web 代理返回 404 | 1 | 用 PowerShell 读取 Electron 官方同版本 raw 文档与源码 |
| 官方 Playwright 文档路径不存在 | 1 | 读取官方 Electron 自动化实现与本地包类型 |
| Playwright 缓存包缺失 index.mjs | 2 | 检查包文件，改用同缓存内完整的 playwright-core 入口 |
| 自动化 combobox 定位超时 | 1 | 依据真实可访问性快照，用现有选项文本定位 |
| 手动锁定点击被菜单遮挡 | 1 | 固定 AppShell 为 100vh，复测实际点击通过 |
| apply_patch 同批重复目标拒绝 | 1 | 合并同文件修改后重新应用，未造成部分写入 |

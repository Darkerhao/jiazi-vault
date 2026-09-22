# Jiazi Vault 实现计划

## 目标

基于 `Jiazi Vault.md` 实现本地离线优先的开发者凭证保险库。当前按用户最新优先级完成自动锁定、剪贴板清理、设置持久化与加密备份恢复。

## 2026-09-22 当前任务

- [complete] 阅读实际调用链、规格与 Electron 44.2.0 API/source。
- [complete] 主进程实现持久化设置、统一锁定生命周期、剪贴板清理与备份恢复。
- [complete] 接通设置页、解锁页恢复入口、锁定事件与敏感视图销毁。
- [complete] 验证定时策略、异步锁定竞态、备份往返/拒绝损坏/恢复回滚、桌面 UI 与构建。

### 实施边界

- 自动锁定按应用无操作时间计时，切换应用继续计时；锁屏、休眠、窗口关闭立即锁定。默认 15 分钟，可关闭无操作计时。
- 剪贴板由主进程串行处理，默认 15 秒清理；只清理仍为本应用最后复制的内容，锁定/退出也触发清理。
- 设置存入现有 SQLite settings 表；成功落盘后更新 UI，重启恢复。
- .jvault 使用现有 Argon2id/AES-256-GCM，完整加密条目与设置；备份包含回收站。恢复先校验再事务替换，覆盖已有库需明确确认，成功后锁定。
- 不扩展项目管理、托盘、全局快捷键或明文导入导出；不暂存或提交。

## 阶段

- [complete] Phase 1 技术栈迁移：Electron + Vue 3 + TypeScript + Vite + Naive UI + Pinia + Router + Node SQLite + 安全 preload IPC
- [complete] Phase 2：Vault 创建、Argon2id、AES-256-GCM、SQLite 加密校验存储、解锁/锁定
- [complete] Phase 3：Item CRUD、收藏、搜索、七类凭证
- [pending] Phase 4：Project 与 Environment
- [pending] Phase 5：密码生成器与强度估算
- [partial] Phase 6：剪贴板清理、自动锁定已完成；快捷键、托盘待实现
- [partial] Phase 7：加密备份、恢复已完成；其他导入导出待实现
- [pending] Phase 8：单元/集成/E2E/安全/性能测试与跨平台构建检查

## 当前验收

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

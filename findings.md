# Findings

## 2026-09-22 当前代码与决策

- 工作树干净。settings 表已存在但无读写接口；设置 Store 仅内存状态；useClipboard 直接使用 navigator.clipboard；备份只有 IPC 声明。
- 锁定只清主进程 key，缺少主动通知、渲染页卸载和异步请求失效处理，自动锁定需要统一接入这些边界。
- Electron 44.2.0 的 clipboard.readText/writeText 已为 Promise；已检查该版本官方 docs/api/clipboard.md 与 shell/browser/api/electron_api_clipboard.cc，必须串行处理复制与清理。
- Electron 44.2.0 官方 power-monitor 文档及源码确认 suspend、lock-screen（Windows/macOS）、getSystemIdleTime；应用输入用 WebContents 的 before-input-event / before-mouse-event 监听。
- 官方版本参考：https://github.com/electron/electron/tree/v44.2.0/docs/api 。web 工具代理返回 404，改用 PowerShell 读取同版本官方 raw 源文件。
- 生产构建 dist/index.html 的资源原为 /assets 绝对路径，Electron loadFile 无法加载；将 Vite base 设为 ./，用于本轮真实生产页面验证。
- 实机点击手动锁定失败：短内容页面 sidebar 内部滚动容器随内容收缩，绝对定位 footer 与设置菜单重叠；AppShell 改为确定的 100vh 高度，使侧栏满高。
- 备份格式：版本化 .jvault 外层包含 KDF 参数和加密校验标记，payload 使用随机 nonce 的 AES-256-GCM 完整加密所有条目（含回收站）、设置；不持久化明文中间文件。
- 恢复先核验当前支持的 KDF 参数、主密码、GCM 认证、行结构、条目密文、重复 ID 和设置，再在同一 SQLite 事务中替换；失败回滚。恢复后清 key 并通知前端销毁敏感视图。
- 真实生产页面验证已通过创建、设置控件、复制按钮、5 秒清理、保留外部复制、备份、错误密码、覆盖取消、恢复、手动/自动锁定、重启与空库恢复。

## 设计文档要点

- 项目仓库为空，仅有 `Jiazi Vault.md`。
- 当前任务明确要求先做 Phase 1：基础工程、基础布局、主题、路由、基础 IPC、SQLite 初始化。
- 目标技术栈为 Tauri 2、Rust、Vue 3、TypeScript、Vite、Naive UI、Pinia、Vue Router、SQLite。
- 安全敏感逻辑后续必须放在 Rust，Phase 1 只建立边界，不在 Vue 中实现加密。
- 环境：Node 22.21.1、pnpm 9.12.1 可用；cargo/rustc/rustup 以及 Windows MSVC/SDK 不在当前环境，Rust/Tauri 编译验证会受阻。
- 前端初始检查暴露缺少 `@vicons/ionicons5`、Settings 选项类型问题，以及 `VaultView.vue` 模板残留字符，需要在 Phase 1 验证前修复。
- 用户决定将桌面技术栈从 Tauri 改为 Electron，以移除 Rust/Cargo/MSVC Rust 工具链依赖。
- Electron 44 要求 Node >= 22.12，本机 Node 22.21.1 满足；采用 Electron 自带 `node:sqlite`，不增加需要本机编译的 SQLite 原生扩展。
- Phase 2 使用 `@node-rs/argon2` 2.2.0 的 Argon2id `hashRaw` API 派生 AES-256-GCM 所需的 32 字节密钥；当前版本源码类型定义确认支持显式随机盐、内存成本、时间成本和并行度。
- 主密码无需额外保存一份可验证哈希；一份 AES-GCM 加密校验标记即可同时验证密码和派生密钥，避免重复认证状态。
- Electron Builder 在 `packaging` 阶段长时间无 CPU 和文件进展，本轮主动终止；常规生产构建、Electron 原生模块加载和真实窗口启动不受影响。

# Findings

## 设计文档要点

- 项目仓库为空，仅有 `Jiazi Vault.md`。
- 当前任务明确要求先做 Phase 1：基础工程、基础布局、主题、路由、基础 IPC、SQLite 初始化。
- 目标技术栈为 Tauri 2、Rust、Vue 3、TypeScript、Vite、Naive UI、Pinia、Vue Router、SQLite。
- 安全敏感逻辑后续必须放在 Rust，Phase 1 只建立边界，不在 Vue 中实现加密。
- 环境：Node 22.21.1、pnpm 9.12.1 可用；cargo/rustc/rustup 以及 Windows MSVC/SDK 不在当前环境，Rust/Tauri 编译验证会受阻。
- 前端初始检查暴露缺少 `@vicons/ionicons5`、Settings 选项类型问题，以及 `VaultView.vue` 模板残留字符，需要在 Phase 1 验证前修复。
- 用户决定将桌面技术栈从 Tauri 改为 Electron，以移除 Rust/Cargo/MSVC Rust 工具链依赖。
- Electron 44 要求 Node >= 22.12，本机 Node 22.21.1 满足；采用 Electron 自带 `node:sqlite`，不增加需要本机编译的 SQLite 原生扩展。

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
- Phase 2 使用 `@node-rs/argon2` 2.2.0 的 Argon2id `hashRaw` API 派生 AES-256-GCM 所需的 32 字节密钥；当前版本源码类型定义确认支持显式随机盐、内存成本、时间成本和并行度。
- 主密码无需额外保存一份可验证哈希；一份 AES-GCM 加密校验标记即可同时验证密码和派生密钥，避免重复认证状态。
- Electron Builder 在 `packaging` 阶段长时间无 CPU 和文件进展，本轮主动终止；常规生产构建、Electron 原生模块加载和真实窗口启动不受影响。

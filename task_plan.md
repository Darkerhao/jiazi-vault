# Jiazi Vault 实现计划

## 目标

基于 `Jiazi Vault.md` 按 Phase 1 → Phase 8 实现本地离线优先的开发者凭证保险库。当前先完成文档指定的 Phase 1，并确保后续阶段有清晰、最小的扩展边界。

## 阶段

- [complete] Phase 1 技术栈迁移：Electron + Vue 3 + TypeScript + Vite + Naive UI + Pinia + Router + Node SQLite + 安全 preload IPC
- [complete] Phase 2：Vault 创建、Argon2id、AES-256-GCM、SQLite 加密校验存储、解锁/锁定
- [pending] Phase 3：Item CRUD、收藏、搜索、七类凭证
- [pending] Phase 4：Project 与 Environment
- [pending] Phase 5：密码生成器与强度估算
- [pending] Phase 6：快捷键、托盘、剪贴板清理、自动锁定
- [pending] Phase 7：加密备份、恢复、导入导出
- [pending] Phase 8：单元/集成/E2E/安全/性能测试与跨平台构建检查

## 当前验收

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

## 约束

- 不提交或暂存 Git 变更
- Phase 1 不实现完整凭证加密和业务数据
- 敏感数据不进入前端持久化 Store 或日志

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
|---|---:|---|

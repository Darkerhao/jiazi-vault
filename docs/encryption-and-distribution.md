# 加密扩展与正式分发后续迭代

核对日期：2026-10-21。本轮只规划这两项，未修改个人保险库、迁移数据、配置远端凭据或发布安装包。

## 扩大加密范围

当前 `electron/database.ts` 的 items 元数据和 projects 信息是明文；`electron/item-store.ts` 仅加密 password、notes、fields，历史快照已整体加密。`electron/backup.ts` 的 v4 备份外层整体加密，但恢复后数据库仍采用当前字段布局。`src/stores/vault.ts` 和 `src/utils/search.ts` 使用解锁后的摘要建立内存搜索索引。

推荐继续使用现有 AES-256-GCM，将每条凭证的完整内容收敛到一份密文，同时加密项目名称、描述、图标和颜色。数据库仅保留 ID、创建/修改/访问/删除时间、收藏等必要管理字段；标题、类型、项目归属、环境、用户名、主机、URL、端口、标签随内容加密。解锁后由主进程返回原摘要契约，前端继续复用内存搜索；锁定清空索引。不引入 SQLCipher、明文搜索表或第二套加密实现。

迁移按以下顺序闭环实施：

1. 增加明确的数据库结构版本，只在成功解锁、取得主密钥后迁移；在迁移结束前不开放业务 IPC。
2. 使用现有恢复快照机制保留原库，再在同目录临时数据库建立新结构。逐条转换有效凭证、回收站和项目，保留 ID、时间、收藏、历史及设置；历史密文不重复迁移。
3. 对临时库做 SQLite 完整性检查、逐条解密内容比对和数量比对，覆盖项目归属、空值、历史及回收站；任一失败保留原库，删除本轮临时文件。
4. 关闭连接并使用已有恢复/原子文件工具替换数据库，明确处理 WAL/SHM 和替换中断。重启后只读新结构；原库快照用于失败回滚。新库应从干净页创建，避免旧明文留在空闲页中。
5. 备份写入统一升级到 v5，继续读取 v1–v4，并在恢复边界使用同一转换函数进入新结构；不同时维护两条业务读写路径。旧客户端明确拒绝新结构和 v5 备份。
6. 回归创建、搜索、项目重名校验、批量整理、导入导出、主密码轮换、自动备份和恢复。检查数据库及 WAL 中不存在固定测试元数据，验证损坏密文、磁盘满、替换失败、迁移中断后的可恢复性，并重测一万条数据的解锁和搜索耗时。

取舍：保留现有密码学与调用边界，代价是解锁后列表读取需要解密元数据。新库加密不会清除历史快照、旧文件系统备份或磁盘历史块中的明文；迁移完成后需要向用户说明旧快照的保留和清理方式，不自动删除回滚材料。验收必须使用隔离旧版数据库，真实用户迁移另行发布验证。

## 正式分发（Tauri / Rust 底座）

当前源码已迁移到 Tauri 2，保留旧加密协议；上文扩大加密范围仍是独立后续方案，不包含在本次底座迁移中。

- Windows 使用 NSIS 与系统 WebView2，应用不包含 Node.js、Chromium 或 .NET helper。缺少 WebView2 时，默认安装器需联网安装它。
- macOS 输出 dmg/app，Linux 输出 AppImage/deb；平台安装和系统认证需要对应机器验收，不能由 Windows 测试替代。
- Tauri 自动更新使用独立密钥和 `.sig`，不会读取 Electron 的 `latest.yml`。公钥通过 `TAURI_UPDATER_PUBLIC_KEY` 同时写入构建配置并编译进应用；CI 使用 `TAURI_SIGNING_PRIVATE_KEY` 与可选密码 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 签名，聚合为 `tauri-updater.json`。缺少签名配置的构建明确使用手动安装；Linux deb 也使用手动安装。
- Windows 使用 `passive` 安装模式：下载并校验签名后显示进度条，无需手动点击安装向导，完成后自动重启。未配置更新公钥的旧构建无法自举，必须手动安装一次首个签名版本。
- 更新签名仅证明更新包完整性与来源，不会消除 Windows SmartScreen，也不替代 macOS Developer ID 签名、公证和 Gatekeeper 验收。正式对外分发仍需按 Tauri 的对应平台签名文档配置发布者证书。
- 本次没有读取或修改远端 Secrets、发布 Release、替换个人安装或迁移真实用户数据库。旧 Electron 用户首次切换应先创建加密备份，退出旧版后手动安装；应用沿用旧数据目录，设备快捷解锁需重新登记。

官方参考：
- [Tauri Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri 更新插件](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS 签名](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows 签名](https://v2.tauri.app/distribute/sign/windows/)

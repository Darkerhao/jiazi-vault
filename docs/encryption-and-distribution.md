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

## 正式分发

本地核对的版本为 Electron 44.5.1、electron-builder 26.15.3。当前 `build.yml` 两个 macOS 目标仍显式传入 `identity=-` 和 `hardenedRuntime=false`；未配置签名/公证环境变量。package.json 未配置 Windows 签名身份。仓库里有 Windows 安装/升级验收脚本，但没有 macOS/Linux 安装验收任务。本次未读取远端 Secrets，不能据此断言组织没有证书。

| 平台 | 正式分发前需要提供 | 接入现有构建后的验收 |
| --- | --- | --- |
| macOS x64 / arm64 | Apple Developer ID Application 证书及私钥；签名使用 `CSC_LINK` / `CSC_KEY_PASSWORD`；推荐 App Store Connect API 公证凭据：`APPLE_API_KEY`（临时 .p8 文件路径）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER` | 移除临时签名参数，启用 hardened runtime，核实 Electron 所需 entitlements；签名、公证、staple 后在两种架构机器测试 Gatekeeper、安装/升级、Touch ID 和旧库恢复 |
| Windows x64 | 正式代码签名身份及 CI 可用的安全签名凭据，明确发布者名称；私钥不进入仓库 | 接入 electron-builder 现有 Windows 签名器，对应用、原生组件及安装器验证 Authenticode 和时间戳；复用 `verify-windows-package.ps1` 验证旧版升级、备份恢复和卸载，再验证已签名包的应用内更新 |
| Linux x64 | 可用的目标发行版验收环境 | 在目标系统实际启动 AppImage/tar.gz，验证 FUSE/运行库要求、创建/解锁/锁定、升级及旧库恢复，提供产物 SHA256 |

凭据就绪后只扩展现有 build 工作流，不建立另一套发布流程；正式发布应强制签名，缺少凭据或公证失败直接使任务失败。不能仅设置 `mac.notarize=true` 就视为已公证：当前 MacTargetHelper 在没有完整公证凭据时会跳过，CI 必须事前校验必填凭据并对最终产物验签。密钥通过 GitHub Secrets 注入临时文件，不写入源码、报告或构建日志。

官方依据与本地实现：

- [Electron 分发签名说明](https://www.electronjs.org/docs/latest/tutorial/code-signing)：macOS 正式分发需要签名与公证两个步骤。
- [electron-builder 26 macOS 签名文档](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)；已核对本地 26.15.3 的 `mac/MacTargetHelper.js` 中签名选项、hardenedRuntime 默认值及 getNotarizeOptions/notarizeIfProvided。
- 本地 26.15.3 的 `codeSign/windowsSignToolManager.js` 支持现有 Windows 签名配置；具体证书交付方式确定后再配置，不预填虚假证书或身份。
- [GitHub job 依赖说明](https://docs.github.com/actions/using-jobs/using-jobs-in-a-workflow)：上游失败或跳过时，下游依赖任务默认跳过；本轮已移除绕过 prepare 的条件。

公开文档下载和源码核对记录保存在本机 `output/research/upgrade-*`，不随应用分发。

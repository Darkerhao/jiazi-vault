# 交付与验收

## 操作体验完善（2026-10-08，源码验收）

- 快捷搜索保留普通文本复制；Ctrl/Cmd+Shift+C 复制所选凭证字段。名称完全匹配和前缀匹配优先，超过 50 条可打开全部分页结果。
- 全局搜索默认 Ctrl/Cmd+Alt+K；设置中可录入、更改、关闭和恢复默认，冲突就地提示。设备配置持久化且不会被正常备份恢复覆盖。
- 项目与凭证共用未保存修改确认，项目保存期间阻止关闭。详情支持创建副本，沿用新建表单确认保存，保留字段、项目、环境、标签，生成独立 ID。
- 列表支持本页全选、跨页选择、批量改项目/环境、移入回收站及恢复。批量事务任一失败全部回滚；修改保留每条凭证历史，环境变量集不能清空环境。
- JSON/CSV 沿用单一导出实现，支持全部、项目和所选条目，导出前确认范围与数量。IPC 传递普通数组，避免响应式 Proxy 无法序列化。
- 恢复统一为选文件/快照、验证密码、预览数量、确认替换。主进程暂存已验证内容，仅返回无密码摘要；取消和锁定清除待恢复数据。复用原有恢复前快照与事务，移除旧的一步恢复 IPC 参数。
- 已有 Naive UI 2.45.3 Space 包装节点重复 key 会造成详情转编辑时出现双保存按钮；两个动态操作区使用组件公开的无包装模式，未更换组件库或增加依赖。
- 最终 `pnpm test` 77/77 通过（新增 6 项单元场景）；完整构建通过，包含类型检查、Vite、Electron 编译和 Windows Hello；10 组真实 Windows Electron 桌面回归全部通过，新增操作组包含 9 个端到端场景。900×600 列表及备份预览截图已检查，`git diff --check` 通过。
- 日志：`output/operation-all-unit.log`、`output/operation-build.log`、`output/operation-regression.log`；新场景报告及截图：`output/playwright/operation-experience/`。
- 边界：使用独立测试数据库及系统剪贴板；文件选择/保存和原生确认由测试注入。快捷键注册、冲突、停用及重启持久化实测；未进行物理全局按键、macOS/Linux、安装包或远端 CI 验收。未暂存、提交、发布或更改用户现有保险库。

## 依赖维护、更新入口与安装验证（2026-10-06）

- Electron 更新到 44.5.1；依赖按现有主版本范围刷新，未增加生产依赖、全局 overrides 或审计白名单。审计由 14 条降至 1 条中危，生产依赖为 0。`http-cache-semantics` 的审计建议暂未列出补丁，但 registry 已有 4.3.0，锁文件升级后该告警消失。
- 剩余 `sprintf-js@1.1.3`（[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)）来自 electron-builder → @electron/get → global-agent → roarr；公开问题为不受限精度格式串导致异常。已检查当前 roarr/global-agent 调用：工具链使用固定日志模板，未发现保险库数据进入格式串的路径。该依赖无修复版本，继续保留告警；这不是不存在任何可利用路径的保证。
- `pnpm audit:ci` 对生产依赖中危及以上、全量依赖高危及以上返回失败；中危工具链问题继续显示，registry 错误也不忽略。PR/dev 检查及 main 版本准备前均执行。
- Windows Hello 改为 `net10.0-windows10.0.19041.0`；去掉 .NET 9.0.20 固定运行时，随 .NET 10 SDK 发布自包含运行时。CI 使用 10.0.x，本次 SDK 10.0.401 / runtime 10.0.12。辅助程序仅返回 OS 认证结果，接口和密钥存储协议保持一致。
- 设置页提供版本、主动检查、纯文本更新说明、固定官方下载页。主进程使用 Electron 网络栈，10 秒超时，拒绝重定向，不发送 cookie 或保险库数据；网络失败/限流可重试。不使用自动更新框架。
- 发布流程在 Windows 打包后下载上一正式版 NSIS，隔离安装 → 用旧程序创建库和备份 → 同目录覆盖安装新版本 → 验证旧库、项目、回收站、历史、旧备份及恢复快照 → 运行现有安装和恢复测试 → 卸载。任一步失败阻断产物发布，截图/报告保留 7 天。首次发布明确跳过跨版本部分，API/下载失败不降级跳过。

本轮已通过：71 项单元测试、类型检查、完整构建、9 组桌面回归、冻结锁文件安装和 CI 审计。工作流 YAML、发布依赖顺序及 PowerShell 语法检查通过；也在未安装 node_modules 的隔离目录验证了版本准备前的审计命令。

Windows 实测：旧 0.1.2 NSIS → 同目录安装当前 0.1.8 本地构建，旧库/项目/回收站、旧备份、恢复前快照、历史、真实一分钟清理、重启、修改主密码、自动备份/恢复界面和更新入口全部通过。最后卸载退出码 0，程序文件和安装登记均已移除。证据：`output/playwright/package-install-report.json`、`output/playwright/upgrade-d347965e1e264bd398d17b033d9540f6/verify-report.json` 及各桌面报告。

用户参与的真实 Windows Hello：打包程序在 .NET 10 下启用登记、重启免主密码解锁、取消后保持锁定、主密码解锁及删除登记后拒绝快捷解锁全部通过；隔离测试登记已清除。证据：`output/playwright/biometric-smoke-report.json`。这是实际打包程序认证，不是锁屏/休眠实测。

本地验证产物：`release/keystill-0.1.8-win-x64.exe`，128,242,642 字节，SHA-256 `D103874C36608479E2C7C1640CC2C386D2FB1A5269362BC8076926A79E0531E2`。同目录也生成便携 EXE 和 ZIP。保持仓库版本 0.1.8，未提交、推送或发布；这份构建不是已发布的同版本文件。

边界：安装包实测仍为 NotSigned；WinRT IL2104 裁剪警告仍在。GitHub Runner、macOS/Linux 实机与正式签名未验收。公共 GitHub API 本机请求受到限流，更新成功/无新版/离线/限流的 UI 用固定响应验证，未宣称真实在线查询成功或浏览器实际打开成功。正式查询采用系统网络栈；外部地址在主进程固定。

官方依据：[Electron 44.5.1](https://releases.electronjs.org/release/v44.5.1)、[.NET 10 发布元数据](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json)、[Electron net.fetch](https://github.com/electron/electron/blob/v44.5.1/docs/api/net.md)。

## 数据恢复能力（2026-10-03，源码变更）

- 自动加密备份：默认关闭，用户选择目录后在独立文件夹创建首份；解锁期间每分钟检查、有修改且间隔 15 分钟时备份，保留最近 10 份。缺失文件检测、错误状态、立即重试、停用/更换目录保留原文件。目录属于设备配置，不写入可移植备份。
- 恢复前快照：正常库在替换前通过 SQLite `VACUUM INTO` 保留一致快照（包含 WAL 已提交内容），失败阻止覆盖。恢复窗口列出本机快照，验证原主密码后复用完整备份校验与事务恢复。锁定状态仍可恢复；损坏数据库沿用原文件保留流程。
- 快照保存在用户数据目录 `recovery/snapshot-*.db`，沿用原库字段级加密与明文元数据保护范围，不是整体加密导出；不会自动删除。快照恢复仍保留当前库，避免第二次覆盖丢失数据。
- 凭证历史：更新与保存旧版本同一事务，最多保留 20 份完整加密内容；详情可选版本、逐字段显示及确认恢复，回收站只读。恢复保留当前收藏/使用记录，删除的项目不自动重建；永久删除与到期清理通过外键级联清理历史。
- `.jvault` 写入 v4，包含历史版本，继续读取 v1/v2/v3；旧应用不能读取 v4。主密码轮换同一事务更新条目与历史，失败整体回滚。文件原子写入由手动、自动、明文导出共用。
- 新测试：`tests/item-history.test.mjs`、`tests/backup-reliability.test.mjs`；桌面场景 `tests/data-recovery.mjs` 接入 `tests/desktop.mjs`，覆盖历史预览恢复、自动备份文件、缺失重试、停用、锁定拒绝访问、快照恢复及保存失败阻止覆盖。
- 验证结果：最终 `pnpm test` 67/67 通过（日志 `output/data-recovery-unit-tests.log`），包含新增 12 项数据/文件回归；`pnpm typecheck`、Vite 前端生产构建及 Electron 编译通过，`git diff --check` 与新增桌面脚本语法检查通过。旧 API Key 无效日期修正后，历史保留旧值且不阻断备份恢复。
- 环境边界：`pnpm build` 在未改动的 Windows Hello 组件 NuGet 还原阶段报 NU1301（网络套接字权限），离线 `--no-restore` 仍受当前失败还原结果影响。桌面测试在启动阶段因 Electron GPU 子进程退出 -1073741515 失败，未到业务断言；未取得界面截图或运行通过证据。正常桌面重试被自动审批服务 404 故障阻断。未打包、暂存、提交或发布。

### 同日续验

- 完整构建已通过：NuGet 失败来自沙箱用户使用空包缓存。将原用户缓存中构建实际需要的 5 个精确版本包复制到工作区 `output/diagnostics/nuget-feed`，使用工作区包缓存完成离线还原，再运行原有 `pnpm build`。没有调整项目版本、依赖、全局配置或产品安全设置；仅保留既有 IL2104 裁剪警告。
- 离线构建命令（feed 已准备好）：设置当前进程 `NUGET_PACKAGES=output/diagnostics/nuget-packages`、`RestoreSources=output/diagnostics/nuget-feed` 为绝对路径，`NuGetAudit=false` 后执行 `pnpm build`；此设置只用于离线验收，不表示已做在线依赖漏洞检查。日志：`output/data-recovery-build.log`。
- Electron 44.2.0 自带 Node 24.20.0 下，使用 `ELECTRON_RUN_AS_NODE=1` 运行新增历史/备份可靠性测试，12/12 通过。日志：`output/data-recovery-electron-runtime.log`。这验证了真实运行时的数据逻辑，不代替界面及 IPC 桌面验收。
- 最小诊断程序仅调用 app.whenReady 可成功；创建空白、保持 sandbox=true 的 BrowserWindow 即 renderer launch-failed（exitCode 49），GPU 子进程 -1073741515。关闭硬件加速的对照仍失败，复现不依赖项目或 Playwright。没有修改产品沙箱与 GPU 配置。
- 正常桌面重试仍被自动审批服务 404（当前代理不支持审批模型 gpt-5.6-luna）阻断；操作未执行。桌面业务场景继续保留待验收状态。

### 合并前检查配置

- 新增 `.github/workflows/check.yml`，PR 目标为 `main`/`dev`、`dev` 推送及手动触发时执行 `Desktop checks`。沿用现有 Actions 版本、Node 24、.NET 9 和 `pnpm test` / `pnpm build` / `tests/desktop.mjs` 入口，包含新的数据恢复场景。
- 工作流使用只读仓库权限，不持久化 checkout 凭据，不修改版本号或发布；并发时取消同一引用的旧检查。失败上传测试 PNG 和 JSON 报告，保留 7 天，不上传测试保险库数据库或备份文件。
- 本地校验 YAML 与工作流约束；未推送、触发远端 Actions 或设置仓库分支保护，不能声称远端检查已通过。强制合并门禁需将 `Desktop checks` 配置为必需状态检查。

## 新建与取用提效（2026-09-29，源码验收）

- 表单内密码生成：新建与编辑中的密码字段可展开共享生成器，调整规则、预览、重新生成并明确填入；取消生成保留原密码。独立生成器使用同一组件。
- 就地创建项目：项目选择旁提供名称输入，创建成功自动选中；重名可修改后重试，取消创建保留凭证草稿。创建的项目立即保存，后续取消凭证不会删除项目。
- 快捷搜索：选中凭证后可选择复制用户名、密码、主机、连接串及其他实际存在的字段，界面不展示秘密值。完整 `.env` 复制保留原生确认，单项变量支持空值；成功复制更新最近使用且保留当前选择。
- 复用原主进程随机密码、项目 CRUD、加密存储、复制与剪贴板清理接口，无新增依赖、数据库表或 IPC。读取字段不记录访问，切换结果丢弃过时读取结果，关闭或锁定销毁搜索详情。
- `pnpm build` 通过（类型检查、Vite、Electron TypeScript、Windows Hello 构建）；`node --test tests/*.test.mjs` 55/55 通过。
- `node tests/creation-shortcuts.mjs` 7/7 场景通过；`node tests/desktop.mjs electron-smoke credentials-smoke env-smoke desktop-regression product-experience` 全部通过。新增脚本已接入统一桌面入口和既有 Windows CI 调用。
- 真实 Windows Electron、独立测试数据库与系统剪贴板；900×600 表单和快捷搜索截图及报告见 `output/playwright/creation-shortcuts/`。完整 `.env` 原生确认的同意/取消结果由测试注入；快捷键由 Playwright 发送应用内键盘事件。
- 本轮未构建安装包、未触发远端 CI、未暂存或提交。修改历史与批量整理留待后续。

## Keystill · 密序品牌升级（2026-09-29）

- 用户确认的新品牌已接入实际应用：K 钥匙标志、柠檬绿 / 石墨色主题、欢迎与解锁页、侧栏、托盘、系统认证提示、窗口标题和发布产物名称。欢迎页居中改为作用于 Naive UI 的实际内容容器。
- 保留内部包名、应用 ID、原数据目录、备份格式与加密标识；不增加数据库迁移。正式版本号由下文的 main 自动发版流程递增。
- 本地 Windows x64 NSIS 安装包：`release/keystill-brand/keystill-0.1.5-win-x64.exe`，基于当前 0.1.5 源码生成的品牌升级构建；签名状态 `NotSigned`。尚未提交、推送或发布到 GitHub，未对用户现有安装执行覆盖安装。
- `pnpm test` 50 项测试全部通过；`pnpm build`、最终布局的类型检查 / Vite 构建通过；`electron-smoke` 与 `access-smoke` 两组桌面回归通过。原生首次构建有既有 IL2104 裁剪警告。
- `tests/brand-upgrade.mjs` 实跑旧版 0.1.2 与新打包程序，使用隔离数据完成旧库直接打开、原凭证和项目读取、主题切换、锁定解锁、旧备份恢复及恢复后重启。5 项验证全部通过，无 renderer error；文件选择 / 确认通过测试替身返回，数据库、加密、IPC、文件和两个应用进程均为真实实现。
- 安装包内 50 个 dist / dist-electron 文件与最终构建逐一字节核对一致。报告及实机界面截图：`output/playwright/brand-upgrade/`；品牌素材包：`output/keystill-brand.zip`；品牌规范：[BRAND.md](./BRAND.md)。
- macOS / Linux 图标与配置已更新，未实跑对应平台；本轮未触发需用户操作的 Windows Hello / Touch ID 认证。

复现跨版本验证：`node tests/brand-upgrade.mjs "output/windows-install-v012/Jiazi Vault.exe" "release/keystill-brand/win-unpacked/Keystill.exe"`。脚本每次创建独立测试库，不使用真实用户保险库。

## GitHub 自动版本与发版

工作流：`.github/workflows/build.yml`，自动发版分支为 **`main`**。将配置提交并推送后，每次向 `main` 合入或推送新代码，GitHub 会自动完成：

1. 读取 `main` 最新代码，将 `package.json` 的补丁版本加一，例如 `0.1.2 → 0.1.3`。
2. 由 `github-actions[bot]` 提交 `chore(release): v0.1.3`，原子推送版本提交和对应标签。
3. 四个构建任务统一检出该版本提交，运行测试、类型检查、生产构建和安装包打包。
4. 全部成功后创建 GitHub Release，上传所有安装包、自动生成版本说明，最后公开发布。
5. 发布成功后，将本次发布的 `main` 提交自动合并并推送到 `dev`，同步代码、版本号和分支历史，保留 `dev` 上尚未发布的开发提交。

无需手动修改版本号、打标签或创建 Release。合并 PR 或直接推送到 `main` 会触发自动发版，单独在本地 `git commit` 不会触发。日常在 `dev` 开发并验证，通过 PR 合入 `main` 表示确认发布；`dev` 推送不触发此工作流、不打包。

| 平台 | 架构 | 安装包 |
|---|---|---|
| Windows | x64 | 安装版 `keystill-<版本>-win-x64.exe`、免安装版 `keystill-<版本>-win-x64-portable.exe`、压缩包 `keystill-<版本>-win-x64.zip`，均包含 Windows Hello 组件及 .NET 运行时 |
| macOS Intel | x64 | `keystill-<版本>-mac-x64.dmg`、`keystill-<版本>-mac-x64.zip` |
| macOS Apple Silicon | arm64 | `keystill-<版本>-mac-arm64.dmg`、`keystill-<版本>-mac-arm64.zip` |
| Linux | x64 | `keystill-<版本>-linux-x86_64.AppImage`、`keystill-<版本>-linux-x64.tar.gz` |

同一产品版本共提供 9 个安装或压缩包；不同格式复用对应平台的同一份应用，不区分 Lite/Standard 功能版本。构建器生成的 `.blockmap` 也会上传，它们是差分下载辅助文件，不是独立安装包；当前应用尚未接入自动更新。GitHub 另外提供源码 ZIP 和 tar.gz。

Windows 免安装 EXE 会在运行时解压应用，ZIP 则先完整解压再运行其中的 `Keystill.exe`。两者继续使用系统用户数据目录保存保险库，不会把保险库随程序写入便携文件所在目录；迁移数据使用应用内的加密备份和恢复。

下载正式安装包：打开仓库的 [Releases](https://github.com/Darkerhao/jiazi-vault/releases)。各平台的构建包也会保存在 [Actions](https://github.com/Darkerhao/jiazi-vault/actions) → **Build and release desktop apps** → 对应构建记录 → **Artifacts**，保留 30 天，下载需登录 GitHub 并解压。

机器人会向 `main` 回写版本提交，并在发布成功后通过 **Sync release back to dev** 任务同步到远端 `dev`。本地开发时只需更新 `dev`，无需再手动合并 `main`；以下命令在工作区干净时执行：

```sh
git switch dev
git pull --ff-only origin dev
```

同步使用本次发布的准确提交，不会带入发布期间 `main` 上的新提交。若合并冲突、分支保护或同步期间其他人推送导致失败，任务会明确报错，保留远端 `dev` 和已发布的 Release，不强制覆盖分支。冲突需人工处理；并发推送处理完后可用 **Re-run failed jobs** 重新同步。构建或发布失败时不执行同步。

`main` 的发版任务串行执行，已开始的任务不会被新推送取消；等待中的多次推送会保留最新任务，准备版本时读取分支最新代码。重跑时，如果分支仍停留在已有版本标签对应的提交，则复用该版本，不重复递增。有后续代码提交时才生成下一个版本。版本号采用稳定的 `主版本.次版本.补丁版本` 格式，当前自动流程不生成预发布版本。

构建失败时不公开 Release，但已推送的版本提交和标签会保留。优先使用 Actions 的 **Re-run failed jobs** 重跑该版本；如果完整重跑或手动运行，而 `main` 已有新代码，则会为最新代码生成新版本。附件上传失败时 Release 保持草稿，重试会更新同一版本附件，不重复创建 Release。准备版本期间若恰好发生其他推送，Git 会拒绝整个版本提交/标签推送；不强制覆盖分支或标签，后续任务从最新分支继续。

仅向 `main` 推送或合入代码时自动运行此工作流；PR 事件、`dev` 等其他分支及标签推送均不触发。配置位于默认分支后，可通过 **Run workflow** 选择 `main` 手动发版；选择其他分支时全部任务跳过。构建必须等待 `main` 版本准备成功，统一检出本次发布提交；不再为其他分支提供测试、打包或 Artifacts。

构建使用 Node.js 24、`packageManager` 固定的 pnpm 9.12.1、仓库锁文件，以及 Windows 上的 .NET 10 SDK；复用现有 `pnpm test` 和 `pnpm electron:build`。版本准备、发布和分支同步任务使用 GitHub 自动提供的 `GITHUB_TOKEN` 并声明 `contents: write`，构建任务保持只读权限，无需个人令牌；仓库规则须允许工作流写入 `main`、`dev` 和版本标签。[GitHub 的令牌触发规则](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)使机器人的版本推送及 `dev` 同步推送不会再次启动工作流，构建、发布和同步直接在本次工作流中继续。建议为 `main` 配置 PR 合并；当前脚本直接回写版本提交，`contents: write` 不会绕过分支保护，启用保护时必须同时配置允许发版身份写入的规则，否则版本准备或分支同步会失败。此工作流仅在合入 `main` 后构建，不应将它设为 PR 合并前的必需检查。本次修改不更改 GitHub 默认分支、分支保护或仓库权限。Runner 架构与目标包一致，使用其本机安装的 Electron 和 Argon2 原生依赖。

CI 在安装依赖后执行 `pnpm exec install-electron`，下载锁定版本、当前平台和架构的官方 Electron 二进制，再由打包器复用 `node_modules/electron/dist`。[Electron 44.5.1 的安装说明](https://github.com/electron/electron/blob/v44.5.1/docs/tutorial/installation.md#binary-download-step)明确二进制在首次运行 Electron 时才自动下载，也可用此命令显式安装；仅执行 `pnpm install` 不会生成该目录。缺少这一步会使全新 Runner 的四个平台都在打包时失败。版本提交和标签创建成功仅表示准备完成，所有安装包打包成功后才会公开 Release。

当前产物没有开发者证书签名：Windows 可能显示未知发布者；macOS 只做 ad-hoc 临时签名，关闭 hardened runtime，未做 Apple 公证，系统可能阻止直接打开。面向正式用户分发的证书签名、公证和 Touch ID 实机验收需另行配置、验证。Linux 使用前需赋予 AppImage 执行权限，系统需支持 AppImage/FUSE。现有 Electron 工程只覆盖桌面端，不包含 Android/iOS 安装包。

自动化边界：工作流运行现有 Node 测试与构建检查，不包含桌面 UI、安装卸载或生物识别实机测试。GitHub 四平台首次构建结果应以推送后的 Actions 记录为准。

前一轮打包配置验收（2026-09-28）：44 项业务测试在本机 Node.js 22 和 Electron 内置 Node.js 24.20.0 下均通过；类型检查、生产构建、Windows Hello 构建和 Windows x64 NSIS 打包通过。验证产物为 `output/ci-validation/jiazi-vault-0.1.2-win-x64.exe`，包内包含前端、主进程、preload、Argon2 原生模块及 Windows Hello 组件，原生模块加载成功；安装包签名状态为 `NotSigned`。

自动版本测试入口：`node --test tests/release.test.mjs`，已纳入 `pnpm test`。测试使用隔离的本地 Git 仓库和 bare 远端，验证非 `main` 分支拒绝发版、版本递增、源码/标签一致、重试复用、标签冲突拒绝、并发推送的原子拒绝及未提交修改保护，不向真实 GitHub 仓库推送。尚未提交、推送本次配置，未实跑 GitHub Actions 或 macOS/Linux 安装包。

## 可靠性与安全修复（当前源码）

- 数据库打开或初始化失败时显示恢复入口；错误密码和无效备份不移动原库。恢复先写入独立临时数据库，成功后将原数据库及 SQLite 附属文件保留到数据目录的 `recovery/restore-*`，再安装已验证的替换库。正常保险库仍使用原有事务恢复流程。
- 加密备份导出和恢复统一上限 256 MiB；超限明确提示，导出不写文件，恢复不替换原库。10,000 条凭证、约 76 MiB 的备份已通过真实文件导出及 IPC 恢复验证。备份格式不变；明文 JSON/CSV 导入仍限 64 MiB。
- 条目编辑器有未保存内容时，取消、Esc、遮罩关闭、切换页面或打开其他条目会要求确认；切换类型会在丢弃字段前确认。保存或导出期间禁止关闭；系统锁定直接销毁编辑内容及确认框。
- 已保存的 SSH Key、私钥和连接串默认隐藏，可显式显示、编辑或直接复制；切换显示状态不修改数据。
- IPC 统一检查应用窗口、主 frame 和精确页面 URL；禁止新窗口及非应用页面的网络导航。Chromium 的 `about:blank` 不触发可取消的网络导航事件，但离开应用会锁定，且该页面无法调用保险库 IPC。
- `playwright-core` 固定为项目开发依赖，不再需要外部模块路径。执行 `pnpm test:desktop` 完成构建并顺序运行凭证、访问、环境变量和本轮回归；已有构建可执行 `node tests/desktop.mjs`，或指定脚本名，如 `node tests/desktop.mjs desktop-regression`。测试使用 `output/playwright` 下的隔离数据。

自动验证：`pnpm test` 的 44 项 Node 测试、`pnpm test:desktop` 的 5 组桌面测试（含新增 5 个回归场景）全部通过；类型检查、前端及 Electron 编译、Windows Hello 辅助程序构建通过。桌面回归包括损坏库恢复和原文件保留、大备份往返及超限拒绝、敏感字段显示、草稿保护、保存中锁定、非授权窗口及页面 IPC 拒绝。原生完整构建存在已有 IL2104 裁剪警告；本轮不包含安装包重新打包、签名、macOS/Linux 实机及用户参与的生物识别验收。

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
- 导入追加新条目、生成新 ID，不覆盖现有凭证；关闭“跳过完全重复的记录”后重复导入会产生重复项。整份文件先校验，写入失败事务回滚，不留下部分凭证或项目。
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
- 桌面脚本直接使用项目内 `playwright-core`；`pnpm test:desktop` 为统一入口，脚本不进入常规 `pnpm test`。

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

复现：安装后设置 `JIAZI_INSTALLED_EXE` 为实际安装 exe 的绝对路径、`JIAZI_PERF_LABEL=installed-v0.1.1`，运行 `node tests/performance.mjs`。

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

复现：先执行 `pnpm build`，再运行 `node tests/credentials-smoke.mjs`、`node tests/electron-smoke.mjs`、`node tests/performance.mjs`（桌面脚本顺序执行，避免争用剪贴板或窗口焦点）。性能默认启动 5 次，可用 `JIAZI_PERF_RUNS` 调整；报告和隔离测试库写入 `output/playwright`。

历史 0.1.1 的待验收项由本文开头的 0.1.2 记录更新。仍独立保留 macOS/Linux 构建与运行、Touch ID 实机认证、硬冷启动及 Windows 代码签名；SSH 连接、浏览器扩展、同步、移动端与团队保险库属于后续迭代。

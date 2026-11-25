# 交付与验收

## 查找与复制体验升级（2026-11-25，本地验收）

- 快捷搜索忽略中文组词期间的快捷操作，准确匹配优先，同等匹配再考虑置顶、收藏和最近使用；空查询优先置顶与最近使用。命中词使用加粗和下划线，额外字段改为主动点击后读取。
- 列表固定展示打开与主复制动作，置顶、收藏、删除进入更多菜单，多选按需展开，普通备份提示压缩为状态行。原生 1200×760 验收数据可完整显示 6 行，首行 75.5px；900–1920px 各主要页面通过布局检查，已检查浅色、深色截图。
- Rust 的同一主值选择函数提供复制类型和实际内容；摘要只返回类型与链接是否存在，不返回秘密字段。没有默认可复制内容时隐藏按钮，连接串与 Secret 使用准确名称，复制后在按钮内提示成功。
- 解锁期间复用摘要、合并同时发起的读取，回收站按需加载；单条新增与编辑采用返回摘要更新，项目数量同步变化。刷新、批量操作、导入与项目变更仍刷新对应数据；锁定清空数据，迟到读取和保存不能恢复旧会话内容。
- 未改动数据库结构、加密格式、依赖或版本号；摘要为了准确判断主复制动作会在 Rust 内解密内容，默认复制和列表不将秘密值发送到 WebView。首次加载仍与条目数相关，没有新增持久化明文索引。

验证记录：Rust 41 项、相关前端 15 项、原始 Node 加密兼容检查、Clippy、类型检查、前端构建及隔离标识原生构建通过。完整 Windows WebView2 流程 26 项通过，报告 `output/playwright/tauri-desktop-report.json`；最后的搜索高亮样式独立复核，不重复整套验收。

1000 条合成凭证的原生调试版最后一次抽样：摘要读取约 104ms，打开已加载的快捷搜索约 76ms，保存并关闭约 141ms。UI 时间包含自动化和动画开销，只作为本机样本，不代表发布版性能承诺。检查脚本和采样文件位于 `output/playwright/native-performance.mjs` 与 `native-performance.json`。

本轮使用独立测试保险库和 `com.jiazi.vault.desktop-test` 标识，未覆盖个人安装或修改个人凭证。中文输入验证使用真实组件上的组合输入事件，未做物理输入法、Windows Hello、macOS/Linux 或正式安装器验收；代码未提交、推送或发布。

## Tauri / Rust 底座迁移（2026-11-19，本地验收）

分支 `refactor/tauri-rust-migration`，基于 `dev` / `acc2a01`；本轮评审后按用户明确要求提交到本地分支，未推送或发布，也未操作个人保险库。以下更早章节为当时 Electron 版本的历史记录，不能作为本次 Tauri 的验收结果。

### 实现

- 保留现有 Vue / Naive UI / Pinia 页面，桥接改为类型化 Tauri 命令和事件。Rust 独立实现 SQLite、Argon2id、AES-256-GCM、会话、凭据/项目/历史、备份、恢复、JSON/CSV/.env、密码生成和桌面集成。
- 删除 Electron、electron-updater、Node Argon2、preload、.NET Windows Hello helper 与对应构建路径；没有 Node sidecar。公共前端类型与纯工具放入 src。
- 保留原 `jiazi-vault` 数据目录、SQL schema、主密码派生参数及 `.jvault` v1–v4。旧实现生成独立人工数据夹具，Rust 读取；Rust 写回后再由原 Node AES-GCM 算法独立解密。
- Windows Hello 直接调用 WinRT / DPAPI，macOS 使用 LocalAuthentication / Keychain；旧设备快捷解锁登记需主密码登录后重新启用一次，界面有提示。
- 保留 main-only 发版与 dev 版本同步，版本提交同步 package.json / Cargo.toml / Cargo.lock。Tauri 专用更新元数据与签名独立于 Electron，未配置正式更新密钥的构建使用手动安装。

### Windows 实测体积

| 产物 | 字节 | MiB |
| --- | ---: | ---: |
| 本地旧 Electron 0.1.18 NSIS | 128,514,399 | 122.56 |
| 本次 Tauri NSIS | 3,385,175 | 3.23 |
| 新 NSIS 内实际原生 EXE | 8,069,120 | 7.70 |

安装包减少 **97.37%**。新包使用系统共享 WebView2；不包含离线 WebView2 运行时，缺少时安装器联网安装，因此不能将上述体积理解为系统总运行时占用。

产物：`src-tauri/target/release/bundle/nsis/Keystill_0.1.18_x64-setup.exe`。

SHA-256：`03ce11f32d9d00d15b0e3aa89b222b1dae44b94f35932d27ec279091fe447f7f`。

### 已通过

- Rust 35 项测试；前端、发布版本与更新清单 24 项测试；Node 独立解密 Rust 写入备份；Vue 类型检查与生产构建。
- `cargo fmt --check`、`cargo clippy --all-targets --locked --offline -- -D warnings`、YAML 语法、前端依赖审计（无已知告警）。品牌生成器在隔离目录实跑通过，未重绘正式资源。
- 正式优化构建和 NSIS 打包。提取实际 NSIS 载荷后运行 13 个真实 WebView2 场景：创建/解锁、原 Vue 表单保存、项目/密文/历史/健康、关于与系统能力、真实 Windows 剪贴板及超时清理、关闭时草稿取消、锁定拒读、WebView 重载锁定、锁屏/休眠消息回调、重启持久化、原 Electron SQLite 解锁。
- 13 场景全部完成、无 renderer error。锁屏/休眠为发送到测试窗口的原生 Windows 消息模拟，没有实际锁定或休眠用户系统。
- 已目检关于页与 900×600 凭据页，现有布局保留、无截断或遮挡。报告 `output/playwright/tauri-desktop-report.json`，截图位于其 evidence 目录；包体积/完整性记录 `output/package-payload-report.json`。
- 原始编译 EXE 与 NSIS 载荷仅相差官方 Tauri bundle marker 的 3 字节（UNK → NSS）；规范化该标记后逐字节一致。未修改实际载荷。

### 验收边界

用户当前个人密序进程正在运行。为保留现有安装与草稿，**没有执行真实安装、覆盖升级或卸载**；已验证安装测试脚本会在该情形停止，实际运行的是从生产 NSIS 提取的 EXE，使用 output 下的独立保险库。干净 Windows CI 保留完整安装/卸载验收脚本。

本轮未做 Windows Hello / Touch ID 的用户实际认证、物理锁屏/休眠、macOS/Linux 实机或安装器验证；没有运行远端 Actions、签名、公证或发布。正式自动更新需要 TAURI_SIGNING_PRIVATE_KEY、可选密码及 TAURI_UPDATER_PUBLIC_KEY，不能把未配置密钥的本地包视为已验证的在线自动升级产物。

## 前四项升级（2026-10-21，源码验收）

- 发布仅由 main 推送或在 main 上手动执行触发；build 必须等待 prepare 成功，准确签出准备后的提交并读取同次发布说明。普通 dev 推送不打包，main PR 复用独立 check.yml。
- 凭证健康在主进程遍历有效条目，检查短密码（少于 12 个 Unicode 字符）、完全相同的密码和 API Key 到期。页面只收到条目 ID 和问题类型，支持筛选、前往编辑及重新检查，不修改使用记录或备份状态。
- .env 导入区分新增、变化、未变化；已有值必须显式勾选替换，未导入变量保留。预览默认隐藏值，仅修改编辑草稿，保存时复用现有历史记录、加密和自动备份。
- 历史版本按「所选旧版 → 当前保存内容」比较名称、类型、项目、环境、标签及全部字段，默认只显示变化，可展开未变化字段。保留空值与删除的区别，内容字段默认隐藏，切换版本/锁定清除显示状态；恢复继续保留被替换内容。
- 无新增依赖、数据库结构或备份版本变更。扩大加密范围和正式分发条件见[后续迭代方案](docs/encryption-and-distribution.md)。

验证完成：

- `pnpm test`：已有及前三项新增测试 99/99 通过；`node --test tests/item-diff.test.mjs`：历史差异 2/2 通过，共 101 项。
- `pnpm build`：类型检查、Vite、Electron 和 .NET 10 Windows Hello 构建通过，保留既有 Windows SDK / WinRT IL2104 裁剪警告。
- 全部 14 组真实 Electron 桌面脚本通过：先跑 upgrade-workflows、data-recovery、env-smoke，再跑其余 11 组。新增组包含 9 个场景，最终截图复测仍为 9/9，renderer errors 为空。
- 新流程覆盖健康筛选和修改后消除重复提示、.env 选择替换/草稿取消/保存/历史/自动备份、历史增删改/空值/显示重置/取消恢复/确认恢复/锁定销毁。复核 900×600 截图，操作按钮可见，菜单退场不遮挡内容。
- YAML 本地校验通过，覆盖 main-only 触发、prepare 成功依赖、准备提交签出和独立 PR 检查；`git diff --check` 通过。

日志：`output/upgrade-unit.log`、`output/upgrade-item-diff.log`、`output/upgrade-build.log`、`output/upgrade-desktop-focused.log`、`output/upgrade-desktop-regression.log`、`output/upgrade-desktop-visual.log`。报告和截图在 `output/playwright/upgrade-*`。使用隔离保险库和真实加密/IPC/文件写入，文件选择确认由脚本注入；未操作个人保险库。沙箱首次因 NuGet 网络和 Electron ACL 失败，获准在正常环境后全部验证通过，未修改系统 ACL 或产品安全配置。

远端工作流、正式签名、公证、跨平台安装及真实系统认证未在本轮执行；未重新生成安装包，未暂存、提交或推送。

## 启动与窗口设置（2026-10-09，源码验收）

- 三项桌面偏好集中在「设置 → 启动与窗口」，沿用 Naive UI 和现有主题，不新增导航。默认开机自启关闭、静默启动关闭、关闭时最小化到托盘开启；开关自动保存，成功后更新显示，失败显示错误。
- 开机自启使用系统登录项，状态读取操作系统，不在数据库重复保存。支持 Windows/macOS 打包应用；开发环境与 Linux 显示禁用说明。Windows 便携版注册原始 EXE，含空格路径经过实际启动项验证。静默启动从创建窗口时隐藏，不闪现；首次使用及数据库损坏时保持创建/恢复界面可见。
- 关闭进托盘仍锁定保险库；关闭此选项后，关闭窗口走正常退出、剪贴板清理与数据库关闭流程。托盘菜单“退出”始终退出；托盘打开和重复启动均可唤回隐藏窗口。静默与关闭偏好属于本机配置，不进入备份，正常恢复保留本机配置。
- `pnpm test` 87/87、`pnpm build`、`node tests/desktop.mjs` 全部 12 组桌面回归、`git diff --check` 通过。构建首次因 NuGet TLS 下载失败，重试成功；Windows Hello 原有 IL2104 裁剪警告仍在。回归日志：`output/startup-desktop-regression.log`；最终构建日志：`output/startup-build.log`。
- 新增 `startup-settings` 回归使用独立保险库、独立 Windows AppUserModelId 和真实系统启动项；验证启用/移除、系统禁用状态回读、带空格的便携路径、设置失败、锁定时拒绝修改、重启持久化、零窗口显示事件的静默启动、托盘/第二进程恢复、两种退出路径及首次使用/损坏恢复。浅色、深色与 900×600 布局截图：`output/playwright/startup-settings-{light,dark,900}.png`。
- API 与实现依据：[Electron 44.5.1 登录项文档](https://github.com/electron/electron/blob/v44.5.1/docs/api/app.md#appgetloginitemsettingsoptions-macos-windows)、[Windows 登录项源码](https://github.com/electron/electron/blob/v44.5.1/shell/browser/browser_win.cc)、[窗口显示文档](https://github.com/electron/electron/blob/v44.5.1/docs/api/browser-window.md#using-the-ready-to-show-event)及 [Naive UI 2.45.3 Switch 文档](https://github.com/tusen-ai/naive-ui/blob/v2.45.3/src/switch/demos/zhCN/index.demo-entry.md)。未重启电脑验证真实登录触发、未做 macOS/Linux 实机验收，也未重新打包安装、提交或发布。

## Windows 应用内更新（2026-10-09）

- 桌面版启动时及每 6 小时静默检查正式发布，发现新版在独立「关于」菜单显示红点。检测和下载安装分开；Windows 非便携版点击“更新到 v…”才通过 `electron-updater 6.8.9` 下载、校验并启动交互式安装向导。主进程统一保存更新状态，切换页面不重复下载；失败可重试，保险库操作进行中不启动安装。
- NSIS 保留现有安装向导，启用默认勾选的“打开应用（Keystill）”。点击“完成”时按勾选状态决定是否启动；更新器关闭强制启动和退出时静默安装。配置基于当前安装的 `electron-updater` 公共 API、`BaseUpdater` / `NsisUpdater` 实现，以及 `app-builder-lib 26.15.3` 的 `assistedInstaller.nsh`。
- Windows 发布配置固定官方 GitHub 仓库，CI 上传 `latest.yml`。macOS/Linux 和 Windows 便携版保留手动下载入口。旧版需先手动安装包含本功能的版本，后续正式发布才能通过应用内升级。
- `pnpm test` 86/86、`pnpm build`、`pnpm audit:ci` 通过；审计无已知漏洞，构建保留原有 Windows Hello IL2104 裁剪警告。Windows NSIS 安装包已生成：`release/auto-update/keystill-0.1.11-win-x64.exe`，并核对更新清单中的文件大小和 SHA-512。
- 使用本次打包的 `win-unpacked/Keystill.exe`、隔离测试保险库与本地 HTTP 服务，验证真实下载、SHA-512 拒绝损坏文件、进度、切页恢复、网络错误/限流/重试/无新版，以及下载后只调用一次交互式安装。报告：`output/playwright/app-update-report.json`；截图：`output/playwright/app-update-download.png`。
- 安装启动调用和打开浏览器在测试中拦截；当前用户应用仍在运行，未覆盖安装、实点完成页或关闭用户应用。未验证真实 GitHub 发布后的在线升级，未提交或发布。

## 记住系统解锁偏好（2026-10-08，源码验收）

- 成功通过 Windows Hello / Touch ID 解锁后，将偏好保存在当前本机保险库；再次启动或锁定后默认显示并聚焦系统解锁按钮，点击或回车发起认证。主密码可随时切换，临时使用主密码不覆盖偏好。
- 启用登记、认证取消或失败不记录成功偏好；锁定期间尚未完成的认证不能写入偏好。系统认证不可用时显示主密码。关闭快捷解锁、重新登记、修改主密码或恢复备份清除偏好；设备偏好不进入加密备份。
- `pnpm test` 78/78 通过；`pnpm build` 通过，包含类型检查、Vite、Electron 与 Windows Hello 构建，保留已有 IL2104 裁剪警告。`node tests/desktop.mjs unlock-preference access-smoke data-recovery` 三组桌面回归通过；`git diff --check` 通过。
- 新交互报告：`output/playwright/unlock-preference-report.json`；已检查默认入口和不可用状态截图：`unlock-preference-hello.png`、`unlock-preference-password.png`（同目录）。
- 验证使用隔离测试保险库、真实 Electron UI / IPC / SQLite / 密钥校验；新交互测试只替换操作系统认证与密钥保护边界，未重新进行真实指纹 / PIN / Touch ID 验收。未打包安装、暂存、提交或发布。

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
- `pnpm audit:ci` 对生产依赖中危及以上、全量依赖高危及以上返回失败；中危工具链问题继续显示，registry 错误也不忽略。合入 main 的 PR 检查、手动检查及 main 版本准备前均执行。
- Windows Hello 改为 `net10.0-windows10.0.19041.0`；去掉 .NET 9.0.20 固定运行时，随 .NET 10 SDK 发布自包含运行时。CI 使用 10.0.x，本次 SDK 10.0.401 / runtime 10.0.12。辅助程序仅返回 OS 认证结果，接口和密钥存储协议保持一致。
- 「关于」提供版本、自动与主动检查、近期更新、固定官方下载页。近期更新读取最近 5 个正式版本的完整说明，以纯文本展示，提供固定仓库的版本详情与完整发布记录。GitHub API 请求使用 Electron 网络栈，10 秒超时，拒绝重定向，不发送 cookie 或保险库数据；失败/限流可重试。
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
- 凭证历史：更新与保存旧版本同一事务，最多保留 20 份完整加密内容；详情可选版本、逐字段显示及确认恢复，回收站只读。恢复保留当前收藏/置顶/使用记录，删除的项目不自动重建；永久删除与到期清理通过外键级联清理历史。
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

- `.github/workflows/check.yml` 仅在 PR 目标为 `main` 或手动触发时执行 `Desktop checks`。普通 `dev` 推送不触发检查；已有合入 `main` 的 PR 时，后续提交仍会触发 PR 检查。沿用现有 Actions 版本、Node 24、.NET 10 和 `pnpm test` / `pnpm build` / `tests/desktop.mjs` 入口，包含新的数据恢复场景。
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
4. 从上一可达正式版本标签到本次标签提取全部提交（含合并提交、版本提交和提交正文），首次发布使用完整历史。准备阶段生成一份说明，打包时写入更新元数据，全部构建成功后将同一份说明用于 GitHub Release 并公开发布；重试也刷新说明，不再依赖 GitHub 的 PR 自动摘要或 Atom HTML。
5. 发布成功后，将本次发布版本号直接写入 `dev` 的 `package.json`、`Cargo.toml` 和 `Cargo.lock` 并由 bot 提交推送，不回合并 `main` 的业务代码或分支历史；`dev` 上尚未发布的开发提交保持不变。

无需手动修改版本号、打标签或创建 Release，版本以 `package.json` 为准。合并 PR 或直接推送到 `main` 会触发自动发版，单独在本地 `git commit` 不会触发。日常在 `dev` 开发并验证，通过 PR 合入 `main` 表示确认发布；普通 `dev` 推送不打包、不升版、不打标签、不创建 Release。

| 平台 | 架构 | 安装包 |
|---|---|---|
| Windows | x64 | 安装版 `keystill-<版本>-win-x64.exe`、免安装版 `keystill-<版本>-win-x64-portable.exe`、压缩包 `keystill-<版本>-win-x64.zip`，均包含 Windows Hello 组件及 .NET 运行时 |
| macOS Intel | x64 | `keystill-<版本>-mac-x64.dmg`、`keystill-<版本>-mac-x64.zip` |
| macOS Apple Silicon | arm64 | `keystill-<版本>-mac-arm64.dmg`、`keystill-<版本>-mac-arm64.zip` |
| Linux | x64 | `keystill-<版本>-linux-x86_64.AppImage`、`keystill-<版本>-linux-x64.tar.gz` |

同一产品版本共提供 9 个安装或压缩包；不同格式复用对应平台的同一份应用，不区分 Lite/Standard 功能版本。构建器生成的 `.blockmap` 和 Windows `latest.yml` 也会上传，用于应用内更新和校验，不是独立安装包。GitHub 另外提供源码 ZIP 和 tar.gz。

Windows 免安装 EXE 会在运行时解压应用，ZIP 则先完整解压再运行其中的 `Keystill.exe`。两者继续使用系统用户数据目录保存保险库，不会把保险库随程序写入便携文件所在目录；迁移数据使用应用内的加密备份和恢复。

下载正式安装包：打开仓库的 [Releases](https://github.com/Darkerhao/jiazi-vault/releases)。各平台的构建包也会保存在 [Actions](https://github.com/Darkerhao/jiazi-vault/actions) → **Build and release desktop apps** → 对应构建记录 → **Artifacts**，保留 30 天，下载需登录 GitHub 并解压。

机器人会向 `main` 回写版本提交，并在发布成功后通过 **Sync release version to dev** 任务将发布版本号写入远端 `dev`。业务代码始终由 `dev` 合入 `main`，不反向合并。本地开发时只需更新 `dev`；以下命令在工作区干净时执行：

```sh
git switch dev
git pull --ff-only origin dev
```

同步读取本次发布的准确版本号，只修改 `dev` 的三个版本字段，不带入 `main` 的其他提交。`dev` 版本已一致时不新增提交，重复执行不会产生变更；中间某次构建失败导致 `dev` 落后多个版本时也能直接对齐到最新发布版本。若分支保护或同步期间其他人推送导致失败，任务会明确报错，保留远端 `dev` 和已发布的 Release，不强制覆盖分支；并发推送处理完后可用 **Re-run failed jobs** 重新同步。构建或发布失败时不执行同步。

`main` 的发版任务串行执行，已开始的任务不会被新推送取消；等待中的多次推送会保留最新任务，准备版本时读取分支最新代码。重跑时，如果分支仍停留在已有版本标签对应的提交，则复用该版本，不重复递增。有后续代码提交时才生成下一个版本。版本号采用稳定的 `主版本.次版本.补丁版本` 格式，当前自动流程不生成预发布版本。

构建失败时不公开 Release，但已推送的版本提交和标签会保留。优先使用 Actions 的 **Re-run failed jobs** 重跑该版本；如果完整重跑或手动运行，而 `main` 已有新代码，则会为最新代码生成新版本。附件上传失败时 Release 保持草稿，重试会更新同一版本附件，不重复创建 Release。准备版本期间若恰好发生其他推送，Git 会拒绝整个版本提交/标签推送；不强制覆盖分支或标签，后续任务从最新分支继续。

向 `main` 提交的 PR 使用独立 `check.yml` 运行测试、构建和桌面回归，失败时保留报告，不产生发布安装包。普通 `dev` 等分支推送和标签推送不触发打包。手动运行 `build.yml` 选择 `main` 才会准备版本和发布；选择其他分支时 prepare 及其下游任务全部跳过。构建必须依赖 prepare 成功，发布说明不会再出现缺少生成来源的分支路径。

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

- 最近使用记录实际打开凭证和成功复制的时间，持久化为 `last_accessed_at`。创建、修改、收藏、置顶、列表查询、导出不更新该时间；从未使用的条目不进入最近使用。旧库迁移不伪造历史记录。
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
    "favorite": false,
    "pinned": false
  }
]
```

CSV 使用 UTF-8，可包含 BOM；第一行为字段名，必填列为 `type,title`，其他列可省略或调整顺序。支持引号、逗号、CRLF/LF、多行内容；引号以两个引号转义。

允许字段：`type,title,project,environment,username,password,url,host,port,notes,tags,fields,favorite,pinned,createdAt,updatedAt,lastAccessedAt`。

- `type`：login、password、server、database、api-key、ssh、secure-note、custom。
- `title`：非空字符串。
- `environment`：development、testing、staging、production、other。
- `port`：0–65535 整数；`favorite`、`pinned`：布尔值，省略为 false。
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

## 快捷搜索直达复制与快速打开（2026-11-24）

- 快捷搜索按 Enter 复制当前选中字段并关闭；Ctrl/Cmd+Enter 打开凭证详情；Ctrl/Cmd+Shift+C 保留复制并关闭。默认字段复制不再等待详情字段预取，快速输入后按 Enter 不会被加载状态静默忽略。
- 从全局快捷键或托盘唤起快捷搜索时，复制成功或按 Esc 收起主窗口；应用内 Ctrl K 打开的搜索保持窗口。查看详情和“查看全部结果”不会触发收起。新增 Rust `hide_window` 命令，仍只接受应用主窗口调用。
- 列表、详情和快捷搜索支持直接打开凭证 URL；快捷搜索 Ctrl/Cmd+O 打开并收起，API Key 的 Endpoint 可在详情和快捷搜索中打开；仅接受 http/https，使用系统默认浏览器。成功打开会更新最近使用。
- 列表每行只保留一个主复制入口，按类型显示复制密码 / 复制 API Key / 复制私钥 / 复制 .env / 复制内容；快捷搜索默认字段沿用相同命名。
- 置顶凭证在活动列表和匹配搜索中优先；随后按匹配度、收藏、最近使用和更新时间排序。最近使用页面仍按真实使用时间排序；复制提示显示复制内容与剪贴板清除时间，环境变量集导出提示保持一致。
- 列表和快捷搜索的主字段复制改为 Rust 单次 `copy_item`：解密、写入剪贴板和记录最近使用一次完成，密码不经过 WebView；已保存环境变量集沿用同一路径并保留明文确认。
- 验收：`cargo test`（36 项）、`pnpm test:frontend`（26 项）与旧版兼容测试通过；`node tests/desktop.mjs` 在临时 `com.jiazi.vault.desktop-test` 标识的调试产物上全部通过，新增覆盖 Enter 复制、Ctrl+Enter 详情、Rust 主字段复制、非 http/https URL 拒绝、类型命名复制入口、复制提示、原生隐藏窗口及二次启动唤回。测试使用独立保险库和真实 Windows 剪贴板。

## 剩余升级功能实现说明（2026-11-25）

本轮沿用已有查找、复制和列表密度实现，补齐升级评估第 6–10 项及相关设置状态。用户个人库与安装文件未修改；没有新增产品依赖、数据库表、加密格式或版本号。

1. 凭证编辑：名称与常用值前置；备注、自定义字段、标签按需展开，自定义类型默认展开主要字段。支持 Ctrl/Cmd+S，必填缺项显示就地反馈并定位输入；详情在当前列表顺序内切换上一条/下一条，关闭恢复列表按钮焦点。健康页原地编辑，保存后重新检查并保留筛选。
2. 设置：通用、安全、备份与数据、快捷键四组导航。主密码修改按按钮展开；设置保存有轻量反馈；环境统一为开发、测试、预发布、生产、其他；编辑和新设置控件具有可访问名称。
3. 备份：手动/自动状态集中在 BackupStatus；目录不存在、文件缺失、备份失败分别提示。新增只验证入口，复用现有密码验证与内容预览，不执行恢复，不保存备份主密码。
4. CSV：本应用格式保持自动识别，外部表头增加名称、账号、密码、网址、类型映射，无类型列时选择统一类型；映射结果仍使用同一校验、去重预览和事务。列映射只返回表头/计数，密码不进入预览；取消/锁定清理待导入内容。本应用 CSV 去转义只执行一次，外部映射值原样保留。
5. 开发者操作：服务器与 SSH 可复制连接命令，Windows 使用 PowerShell 单引号转义，其他平台使用 POSIX shell 转义；参数独立，不包含密码、私钥，不自动执行。数据库可单独复制连接串；列表继续支持 API Endpoint 打开。密码生成规则通过已有设置持久化，备份包含规则，旧备份补默认值。

已通过 Rust 45 项、针对本轮变化的前端 16 项、旧 Node 加密兼容检查、类型检查、Vite 构建、Rust Clippy（-D warnings）、格式与差异检查。真实 Windows WebView2 聚焦流程已通过上述交互，采用独立保险库和真实文件框、系统剪贴板；剪贴板用例结束后恢复先前内容。原生文件框辅助测试使用 PowerShell 7（pwsh.exe）。

聚焦流程证据：`output/playwright/tauri-1795598740832`，页面错误为空。该次调试版单样本保存关闭 104ms、打开搜索到可输入 72ms、复制到反馈 147ms，包含自动化输入和等待开销，不作为发布性能承诺。物理中文输入法、Windows Hello、macOS/Linux 实机和正式安装器不属于本轮已完成验收。

完整桌面回归最终通过：27 项，页面错误 0，报告 `output/playwright/tauri-desktop-report.json`，证据目录 `output/playwright/tauri-1795598790333`。1200×760 首屏完整显示 6 条，首行 75.5px；900–1920px 主要页面布局、深色主题、锁定、重启、旧 SQLite 兼容均通过。最终流程单样本：保存关闭 92ms、搜索可输入 62ms、复制反馈 86ms，边界同上。未暂存、提交、推送或发布。

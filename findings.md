# Findings

## V1.2 实施决策

- 本轮核实已有品牌相关未提交改动，保留原修改；无磁盘 AGENTS.md，遵守用户提供的规则。
- 实测 Electron 44.2.0 内置 Node 24.20.0，已补核对同版本官方源码。环境变量编辑页截图确认值默认隐藏；变量数较多时将表单区限制为内部滚动，保留标题和保存按钮。
- 独立 Electron 进程真实占用 Ctrl+Shift+P，主应用报告冲突且 Ctrl K 可用；占用进程退出后重启主应用注册成功。Windows powercfg /a 显示支持 S0 待机和休眠，不支持 S3。
- 环境变量集使用新增 `env` 条目类型，变量名和值存入已有加密 fields；复用项目/环境筛选、回收站、备份和主密码修改，不增加表或依赖。
- 按 Node.js 官方 DotEnv 文档实现严格预览：无效声明、未闭合引号、引号后非注释内容和重复键均报行号并阻止导入，不默默跳过或覆盖。
- 核对 Node v24.15.0 `src/node_dotenv.cc`：双引号中的字面量反斜杠 n 转换为换行，单双引号不支持通用反斜杠转义。无法无损表示的值可以加密保存，但必须阻止 .env 导出并指出变量名。导出采用 UTF-8/LF，保持变量值，不保留原注释和排版。
- 官方依据：https://nodejs.org/api/environment_variables.html#dotenv 、https://github.com/nodejs/node/blob/v24.15.0/src/node_dotenv.cc 。web 工具代理 404，使用 PowerShell 读取官方 raw 文档和源码。已核对 Naive UI 2.45.3 Input 源码/API 与 Electron 44.2.0 dialog 文档及本地类型。

## V1.2 环境变量集

- 当前工作树干净；未找到额外本地 AGENTS.md，采用用户提供的规范。
- 增加 env 条目类型，fields 保存名称和值，复用 secret 加密、项目、环境、回收站及主密码重加密；列表不返回 fields。
- Node.js 官方 DotEnv 文档已读取：名称为字母/下划线开头；未引号值去除首尾空白，# 为注释；单双引号保留内部空白及多行；支持 export 前缀。来源：https://nodejs.org/api/environment_variables.html#dotenv 。
- 采用严格导入诊断：无效行和重复名称均提示行号并阻止应用；不回显无效行中的秘密。导出保证值一致，无法无损表示时明确阻止，不静默转义或丢值。
- main.ts 已有 revision 校验、明文确认及临时文件写入，可沿用；新文件选择/复制/导出要覆盖锁定等待竞态。

## 第五批 V1 缺口核对

- 最终发布包已验证真实原生模块、设置入口、新密码持久化、主密码与 Windows Hello 解锁、禁用登记。补测取消时 OS 返回成功，UI 相应解锁，测试正确报预期不符；没有取消实机通过证据。
- 0.1.1 安装产物的一万条性能与主密码更新已通过，具体指标和缓存/计时边界见 DELIVERY.md；实际程序安装/卸载均成功，未改变个人保险库。

- Windows 采用自有小型 .NET 辅助程序调用 UserConsentVerifierInterop.RequestVerificationForWindowAsync，绑定 Electron HWND；仅传递操作和窗口句柄，不传密码/密钥。本机可用性和用户实际成功验证已通过。
- 主进程在系统认证成功后才调用 Electron safeStorage 取出设备加密密钥，再校验当前保险库 verifier；保留会话 revision 失效检查。Windows DPAPI 不防御同登录用户下其他进程读取；这不是 TPM 绑定密钥方案。macOS 采用 promptTouchID + Keychain-backed safeStorage，尚需 macOS 设备和稳定签名验收。
- 官方接口依据：https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier 。Electron safeStorage 与 systemPreferences 的 44.2.0 C++ 源码已核对。Naive UI 当前 Checkbox/Input 源码与 2.45.3 官方 API 文档已核对。
- Windows 辅助程序使用现有 .NET 9 SDK 构建，运行时固定为 NuGet 当前稳定 9.0.20（已查官方版本索引）。self-contained 单文件部署，不要求用户安装 .NET；未引入 npm 依赖。SDK 的 WinRT 程序集裁剪警告仍需记录。
- 工作过程中外部提交已纳入第四批变更，并将 Electron tsconfig 移到 electron/tsconfig.json；本轮保留并使用当前配置，不回退该改动。

- 用户确认本轮补齐 V1 与 Windows 安装包。工作区含第四批未提交变更，必须保留；未发现磁盘 AGENTS.md，遵循用户提供规则。
- UnlockView 目前直接显示创建/确认表单；规格 1928–1988 行要求欢迎、密码设置、确认、安全信息再创建。
- 主密钥由主密码直接经 Argon2id 派生；修改密码必须更新 vault_metadata 和所有 items.secret（包含回收站），一个事务提交，旧备份仍使用创建时密码。
- Electron 44.2.0 safeStorage 的 Windows 保护为 DPAPI，不能独立作为 Windows Hello 认证；Touch ID prompt 也只负责认证。须明确平台认证与加密存储边界。
- 本轮 web 搜索代理返回 404，改为直接读取官方版本文档： https://github.com/electron/electron/blob/v44.2.0/docs/api/safe-storage.md 及 https://github.com/electron/electron/blob/v44.2.0/docs/api/system-preferences.md 。

## 第四批功能与性能审计

- 工作树干净，无磁盘 AGENTS.md，遵循用户本轮提供的规则；已恢复仓库三份规划文件。
- `contracts.ts` / `item-store.ts` 已接受 custom 和字符串字段字典；缺口是 `SupportedType` 排除 custom、表单只按原对象计算字段。沿用数据格式，编辑器用可增删的字段行，保存时一次构造字典。
- 分类复用 `/vault` 查询参数和现有筛选，不建另一份列表或 Store；快捷搜索当前把类型作为账号缺失时的兜底，需独立展示图标和类型。
- 模板三类输入只有 password 含复制入口；可将按钮统一置于输入旁，复用 `useClipboard`，涵盖 textarea 原始换行。
- 规格目标：10,000+ 条保持可用，普通搜索 <100ms，Cold Start <1.5s。现有列表全量渲染、每条搜索重新归一化关键词及查项目；先测再优化。
- 基线实测：10,000 条、100 项目，解锁到列表 18852.6ms；production 命中 5000 条首次搜索 9200.8ms，清空查询重新绘制 10000 条 22738.2ms。即使无结果，重复查项目/拼检索字符串也需要约 143–168ms。基线快捷搜索环节超时，未声称获得该数据。
- 以 25 条分页限制 DOM；共享元数据检索索引，项目查找改 Map，关键词只归一化一次，快捷搜索满 50 条停止。列表采用 shallowRef 不可变快照，使用记录/收藏通过替换快照更新。
- Naive UI 2.45.3 的 Input/Select/Pagination 与 LayoutSider 当前源码已核对；官方同版本 raw 文档验证 input-props/autosize、value 更新事件与分页 API。web 代理 404，改读 GitHub raw 官方版本文档。
- 官方资料：[Naive Input](https://github.com/tusen-ai/naive-ui/blob/v2.45.3/src/input/demos/enUS/index.demo-entry.md)、[Select](https://github.com/tusen-ai/naive-ui/blob/v2.45.3/src/select/demos/enUS/index.demo-entry.md)、[Pagination](https://github.com/tusen-ai/naive-ui/blob/v2.45.3/src/pagination/demos/enUS/index.demo-entry.md)、[Vue 大规模不可变数据性能](https://vuejs.org/guide/best-practices/performance.html#reduce-reactivity-overhead-for-large-immutable-structures)、[Playwright Electron](https://playwright.dev/docs/api/class-electron)。同时核对本地 Vue 3.5.42 RefImpl 与当前 Playwright Electron launch 源码。
- 最终生产构建性能：普通搜索 16.4–39.1ms，快捷搜索 28.7–34.0ms；5 次新进程启动 477.2–551.0ms，解锁到列表 632.6ms，第 400 页可达。系统缓存保留，未测安装产物/硬冷启动。

## 第三批功能审计

- 实现中发现明文导入可携带当前表单模板未列出的字段，旧编辑器会丢字段并将 Custom 转为 login。按导入闭环补齐已有字段编辑与类型保留，不新增 Custom 创建入口。
- 类型复用必须来自无运行时依赖的 contracts.ts；直接从 item-store 引用会把 Argon2 const enum 带入前端 isolatedModules 检查。
- 已阅读 Electron v44.2.0 dialog 文档与 lib/browser/api/dialog.ts，明确配置 defaultId/cancelId=0；CSV 按 RFC 4180 处理引号、多行和 CRLF；公式起始符号采用可逆单引号转义。
- 已查当前 electron-builder 26.15.3 nsisOptions.d.ts 与 https://www.electron.build/nsis.html，采用可选安装目录的当前用户 NSIS 引导安装，完成后不自动启动。
- 文档来源：https://raw.githubusercontent.com/electron/electron/v44.2.0/docs/api/dialog.md ；https://raw.githubusercontent.com/electron/electron/v44.2.0/lib/browser/api/dialog.ts ；https://www.rfc-editor.org/rfc/rfc4180.txt 。web 工具代理 404，已通过 PowerShell 获取官方原文。

- 本轮开始工作树干净，无磁盘 AGENTS.md；遵守本轮用户提供的 AGENTS 规则。
- items 仅 created_at/updated_at/deleted_at；最近使用直接按 updatedAt 排序。打开编辑通过 get_item；快捷复制也先 get_item；需区分查看与为复制读取，复制成功再记使用。
- 自动清理目前无调用；软删除重复执行会刷新 deleted_at，需保留首次删除时间。备份恢复必须清理已过期回收站，避免旧备份重新延长保留期。
- 明文导入导出无入口；沿用备份的原生文件对话框与会话 revision 检查。数据校验/加密/导入事务留在主进程，UI 不接收导出明文。
- 项目使用 Electron 44.2.0、Vue、Naive UI 和 Node SQLite；现有 build 为 electron-builder NSIS，之前停在解包复制阶段，尚无最终安装验证。

## 第二批功能审计

- 本轮开始工作树含上一轮安全功能实现；保留并继续增量修改。
- 项目目前只有类型和 service 声明，list_projects 返回空数组，数据库无 projects 表；items 已有 project_id/environment。
- 生成器在 Vue 使用随机数取模，长度范围不一致，强度仅按选项长度推断，缺少复制/保存/熵值与易混淆开关。
- VaultSession 已拒绝并发认证，可接入持久化限速而无需增加认证队列；限速状态不进入可恢复的备份设置。
- 规格要求项目包含最近访问、图标与颜色；快捷搜索需键盘操作，关闭窗口应进入托盘。采用主窗口弹层复用认证与剪贴板生命周期。
- 已核对 Electron v44.2.0 global-shortcut/tray 官方文档、global shortcut C++ 实现和本地 electron.d.ts；注册失败返回 false，需显示可见提示。官方源：https://github.com/electron/electron/tree/v44.2.0/docs/api 。
- 已核对 Node randomInt 官方实现的拒绝采样逻辑；生成器采用 randomInt 加全串拒绝采样，确保全部选中字符集出现且有效密码等概率，熵用包含排除公式计算。
- 本地 Naive UI 2.45.3 Modal.mjs 和类型确认默认关闭销毁、Esc、焦点锁；通过条件挂载销毁凭证表单与快捷搜索。
- 凭证编辑原先用旧对象合并稀疏 input，清空字段后旧值会复活。改为新 input 加必要元数据，项目/环境/敏感字段可正确清空。
- Naive UI 当前版本文档已确认：https://github.com/tusen-ai/naive-ui/blob/v2.45.3/src/modal/demos/enUS/index.demo-entry.md ，与本地实现核对 auto-focus、close-on-esc、display-directive 默认值。
- 快捷搜索从已有编辑弹窗打开另一条凭证时，show 不变化，旧表单内容可能继续保留。VaultView 按凭证 ID 为 ItemFormModal 设置 key，实际桌面复测确认切换到正确密码。
- 清理未实现且无调用方的 search_items/export_vault/import_vault IPC 占位。搜索只保留共享 metadata 匹配函数，避免两个实现入口。
- 桌面验证使用独立测试库与真实 Electron API。全局快捷键实际注册成功；托盘点击和快捷键触发使用捕获的真实回调，未发送系统物理快捷键。剪贴板在测试结束恢复原文本。

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

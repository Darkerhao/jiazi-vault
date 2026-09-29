<p align="center">
  <img src="./public/brand/icon.svg" width="88" height="88" alt="Jiazi Vault 图标">
</p>

# Jiazi Vault

面向开发者的本地凭证保险库，集中管理账号密码、服务器、数据库、API Key、SSH 私钥和环境变量。

无需注册账号，无需部署服务端。凭证保存在本机，密码等敏感字段加密存储，日常使用支持离线操作。

[下载安装包](https://github.com/Darkerhao/jiazi-vault/releases) · [反馈问题](https://github.com/Darkerhao/jiazi-vault/issues) · [交付与验收记录](./DELIVERY.md)

## 功能

| 功能 | 说明 |
| --- | --- |
| 多类型凭证 | 登录账号、密码、服务器、数据库、API Key、SSH、安全笔记、自定义、环境变量集，共 9 种类型 |
| 项目与环境 | 按项目归档，区分 Development、Testing、Staging、Production、Other，支持标签和组合筛选 |
| 搜索与整理 | 元数据关键词搜索、快捷搜索、收藏夹、最近使用、分页列表；回收站保留 30 天，过期自动清理 |
| 环境变量集 | 逐项编辑、显示和复制变量；从文件或粘贴内容导入 `.env`，预览并校验重复键，支持整组复制和导出 |
| 自定义字段 | 为凭证补充额外字段，支持重命名、多行内容、隐藏显示和一键复制 |
| 密码生成器 | 生成 8–128 位密码，可选字符类型、排除易混淆字符，并直接保存到保险库 |
| 备份与迁移 | `.jvault` 加密备份与恢复，JSON / CSV 明文导入导出 |
| 桌面集成 | 系统托盘、全局快捷搜索、自动锁定、剪贴板定时清理、浅色 / 深色 / 跟随系统主题 |
| 系统快捷解锁 | 可选 Windows Hello 或 macOS Touch ID，默认关闭；设备不可用时使用主密码解锁 |

当前应用用于保存、整理和复制凭证。尚未实现 SSH 连接、浏览器自动填充、云同步、团队共享、移动端和应用内自动更新。

## 下载与安装

在 [GitHub Releases](https://github.com/Darkerhao/jiazi-vault/releases) 中选择对应平台和架构的附件。仓库配置的构建产物如下，实际可下载版本以发布页为准：

| 平台 | 架构 | 格式 |
| --- | --- | --- |
| Windows | x64 | `.exe` 安装版、`-portable.exe` 免安装版、`.zip` 压缩包 |
| macOS | Intel x64 / Apple Silicon arm64 | `.dmg`、`.zip` |
| Linux | x64 | `.AppImage`、`.tar.gz` |

Windows 安装版可选择安装目录；ZIP 版本需完整解压后运行 `Jiazi Vault.exe`。Windows 包含 Windows Hello 组件及所需 .NET 运行时，普通用户无需另装 .NET。

免安装版和 ZIP 版也将保险库保存在系统用户数据目录，数据不会随程序文件一起移动。更换设备请使用应用内的加密备份与恢复。

当前发布配置未设置开发者证书签名；macOS 使用临时签名，未做 Apple 公证，系统可能显示发布者或安全提示。Linux AppImage 需要执行权限及相应的系统运行支持。各平台实机验收范围见 [DELIVERY.md](./DELIVERY.md)。

## 开始使用

1. 首次启动时设置并确认主密码，阅读安全须知后创建保险库。主密码至少 8 个字符，建议使用较长且独有的密码短语。
2. 在「项目」中建立项目，再通过「新建」选择凭证类型，填写内容并按需关联项目、环境和标签。
3. 使用搜索、分类或收藏夹查找条目，打开详情查看、编辑或复制字段。
4. 在「设置」中调整自动锁定、剪贴板清除时间和主题；支持的设备还可启用系统快捷解锁。
5. 在「设置 → 加密备份与恢复」创建 `.jvault` 文件，妥善保存并定期更新。

**主密码没有找回或重置入口。备份也需要备份创建时的主密码才能恢复，请同时保管好密码和备份。**

关闭窗口会锁定保险库并保留托盘进程。重新打开可使用托盘菜单；结束应用请在托盘菜单中选择「退出」。

### 快捷键

| 操作 | Windows / Linux | macOS |
| --- | --- | --- |
| 全局唤起快捷搜索 | `Ctrl + Shift + P` | `⌘ + Shift + P` |
| 应用内快捷搜索 | `Ctrl + K` | `⌘ + K` |
| 新建凭证 | `Ctrl + N` | `⌘ + N` |
| 新建项目 | `Ctrl + Shift + N` | `⌘ + Shift + N` |
| 打开密码生成器 | `Ctrl + G` | `⌘ + G` |
| 锁定保险库 | `Ctrl + Shift + L` | `⌘ + Shift + L` |

应用内快捷键在解锁后使用。全局快捷键被其他应用占用时，设置页会提示，可通过托盘或应用内快捷键打开搜索。

### 环境变量集

新建「环境变量集」时需要选择环境，项目可选。支持逐项填写，也可从 UTF-8 `.env` 文件或粘贴文本导入，单次文件导入上限为 1 MiB。

导入会先预览并检查格式和重复变量名，确认加入编辑器后还需要保存。重复键或与已有变量同名时会阻止加入，不会静默覆盖。导出支持 `.env.production` 等文件名，输出当前编辑值；不保留原注释和排版，也不执行命令、展开变量或修改系统环境变量。

## 数据与安全

保险库使用 SQLite，数据库文件为 Electron 用户数据目录下的 `vault.db`，路径由主进程的 `app.getPath('userData')` 确定。

- 主密码通过 **Argon2id** 派生 256 位密钥，当前参数为 64 MiB 内存、3 次迭代、并行度 1，每个保险库使用随机盐。
- 密码、备注及 `fields` 中的数据（包括私钥、API Key、自定义字段、环境变量名和值）使用 **AES-256-GCM** 加密存储，每次加密使用随机 nonce。
- **数据库采用字段级加密。** 标题、类型、用户名、URL、主机、端口、标签、项目和环境等元数据以明文保存。搜索仅使用元数据，不检索密码、私钥、备注或环境变量内容。
- 主密钥由 Electron 主进程持有，锁定时清除；渲染进程通过 preload 提供的 IPC 接口访问功能，启用上下文隔离和沙箱，并校验 IPC 来源。
- 默认 15 分钟无操作后锁定，复制内容默认 15 秒后清除；两者均可在设置中调整。系统锁屏、休眠和关闭窗口会触发锁定；锁定或退出时也会清理仍属于本应用的剪贴板内容。
- 连续输错主密码会触发递增等待时间。修改主密码会重新加密现有条目及回收站数据，完成后锁定保险库，并移除系统快捷解锁登记。

系统快捷解锁通过操作系统认证后，读取由 Electron `safeStorage` 保护的设备密钥；该登记不进入加密备份。Windows 依赖 DPAPI，不能将其视为针对同一登录用户下其他进程的隔离保障。Linux 当前没有系统快捷解锁后端。

相关实现见 [加密模块](./electron/vault-crypto.ts)、[条目存储](./electron/item-store.ts)、[会话管理](./electron/vault-session.ts) 和 [系统认证适配](./electron/biometric-provider.ts)。

## 备份与数据交换

| 格式 | 用途 | 行为与限制 |
| --- | --- | --- |
| `.jvault` | 完整加密备份、设备迁移 | 包含凭证、项目、回收站和设置，备份数据整体加密；导出及恢复上限 256 MiB |
| JSON / CSV | 与其他工具交换条目 | 明文保存有效凭证；不包含回收站、设置及项目图标等信息；导入文件上限 64 MiB |
| `.env` | 环境变量集交换 | 明文复制或导出当前变量；文件导入上限 1 MiB，导入后需保存条目 |

恢复 `.jvault` 会**整体替换**当前凭证、项目、回收站和设置，请先备份当前数据。恢复成功后使用备份创建时的主密码解锁；修改主密码不会改变旧备份的密码。数据库无法打开时，解锁页面提供恢复入口，原数据库文件会保留在数据目录的 `recovery/` 中。

JSON / CSV 导入采用追加方式，生成新条目 ID，重复导入会产生重复项。其他工具的专有格式需要先转换为本项目格式；字段说明见 [JSON / CSV 格式](./DELIVERY.md#json--csv-格式)，当前类型以 [contracts.ts](./electron/contracts.ts) 为准。

**JSON、CSV 和 `.env` 文件可能包含密码、私钥等明文内容。** 导出前应用会要求确认，这些文件需要自行妥善保管；完整备份使用 `.jvault`。

## 本地开发

技术栈：**Electron + Vue 3 + TypeScript + Vite + Naive UI + Pinia + SQLite**。Windows Hello 辅助程序使用 C# / .NET。

### 环境要求

- Node.js：建议使用 **24**，与 CI 保持一致。
- pnpm：**9.12.1**，由 `package.json` 的 `packageManager` 固定。
- Windows 开发或构建还需 **.NET 9 SDK**，用于编译 Windows Hello 组件；macOS / Linux 会跳过该组件。

### 安装与启动

```sh
git clone https://github.com/Darkerhao/jiazi-vault.git
cd jiazi-vault
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm electron:dev
```

`pnpm exec install-electron` 显式下载当前平台所需的 Electron 二进制。`pnpm electron:dev` 会编译主进程、构建平台原生组件，并同时启动 Vite 和 Electron；开发服务器固定使用 `http://127.0.0.1:1420`，需保证端口可用。

`pnpm dev` 仅启动 Vite。凭证、数据库、剪贴板等功能依赖 Electron IPC，直接在浏览器中打开页面无法使用完整功能。主进程和 preload 修改后需重新运行 `pnpm electron:dev`；前端页面由 Vite 热更新。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm electron:dev` | 启动桌面开发环境 |
| `pnpm typecheck` | Vue / TypeScript 类型检查 |
| `pnpm test` | 编译 Electron 代码并运行 Node 测试 |
| `pnpm test:desktop` | 完成构建后，顺序运行桌面自动化测试 |
| `pnpm build` | 类型检查、前端生产构建、Electron 编译及平台原生组件构建 |
| `pnpm electron:build --publish never` | 构建当前平台安装包，不发布到 GitHub |
| `pnpm electron:build:win --publish never` | 构建 Windows x64 安装版、免安装版和 ZIP |
| `pnpm brand:generate` | 从品牌母版生成应用及托盘图标 |

前端构建输出到 `dist/`，Electron 编译输出到 `dist-electron/`，安装包输出到 `release/`。macOS / Linux 构建参数及 CI 平台矩阵见 [构建工作流](./.github/workflows/build.yml)。

桌面测试使用 `output/playwright/` 下的隔离数据，顺序执行以避免剪贴板和窗口焦点冲突。已有构建时，可只运行指定回归组：

```sh
node tests/desktop.mjs desktop-regression
```

真实系统认证、物理锁屏 / 休眠以及安装卸载需要单独验收，常规测试和构建不覆盖这些操作。

## 项目结构

```text
jiazi-vault/
├── src/                    # Vue 渲染进程
│   ├── views/              # 保险库、项目、密码生成器、解锁与设置页面
│   ├── components/         # 条目编辑、环境变量导入、备份等组件
│   ├── stores/             # Pinia 状态
│   ├── services/           # 类型化 IPC 调用
│   └── utils/              # 字段模板、图标和搜索
├── electron/               # 主进程、preload、数据库、加密和桌面能力
├── native/windows-hello/   # Windows Hello 原生辅助程序
├── public/brand/           # 应用内品牌资源
├── build/                  # 各平台打包图标
├── scripts/                # 原生构建、品牌生成和版本准备脚本
├── tests/                  # Node 测试和 Electron 桌面测试
└── .github/workflows/      # 多平台构建与自动发版
```

## 开发与发布流程

日常开发使用 `dev` 分支，发布时合入 `main`。当前 [GitHub Actions 工作流](./.github/workflows/build.yml) 在代码推送到 `main` 后自动递增补丁版本、提交版本号并创建标签，随后运行测试和多平台打包；全部构建成功后发布 Release，再将本次发布提交合并回 `dev`。

`dev` 推送和 PR 事件不会触发该工作流，合入 `main` 前需自行完成相关验证。分支权限、失败重试及发布产物说明见 [DELIVERY.md](./DELIVERY.md)，品牌资源维护方式见 [BRAND.md](./BRAND.md)。

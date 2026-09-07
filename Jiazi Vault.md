# Jiazi Vault
## 本地密码与 Secret 管理工具
### 产品设计 + 技术实现规格文档

> 文档版本：v1.0  
> 产品名称：Jiazi Vault / 甲子 Vault  
> 产品定位：面向开发者的本地、离线优先、轻量级密码与 Secret 管理桌面应用  
> 目标平台：Windows / macOS / Linux  
> 核心原则：Local First、Security First、Fast、Minimal、Developer Friendly

> 技术栈修订（2026-09-07）：为降低本地开发与构建环境成本，桌面端由 Tauri 2 / Rust 调整为 Electron / Node.js。本文后续出现的 Tauri IPC、Rust 安全模块和 `src-tauri`，统一对应 Electron IPC、Electron 主进程安全模块和 `electron` 目录；Vue 渲染进程仍禁止直接处理持久化、密钥派生和数据加密。

---

# 一、项目概述

## 1.1 产品定位

Jiazi Vault 是一个面向个人开发者和技术人员的**本地密码、账号、API Key、SSH、服务器、数据库凭证以及环境变量管理工具**。

它不是传统意义上的纯密码管理器，而是：

> 一个面向开发者的本地 Credentials / Secrets Vault。

核心解决以下问题：

- 不同项目存在大量账号密码
- Development / Test / Production 环境凭证分散
- `.env` 文件散落在电脑各处
- API Key / Token 无统一管理
- 服务器 SSH 信息难以管理
- 数据库账号密码难以快速查找
- 经常需要复制密码、Token、URL
- 不希望密码上传到云端
- 希望打开即用、搜索即得、复制即走

---

# 二、产品目标

## 2.1 核心目标

第一版本必须做到：

1. 本地存储
2. 默认离线运行
3. 所有敏感数据加密
4. 主密码保护
5. 快速搜索
6. 快速复制
7. 密码生成
8. 项目分类
9. 环境分类
10. 自动锁定
11. 全局快捷键
12. 系统托盘
13. 数据备份与恢复

---

# 三、产品原则

## 3.1 Local First

默认：

```text
数据 → 本地
网络 → 非必须
账号 → 不需要
云端 → 不依赖
```

应用在完全断网情况下仍然应该能够正常使用。

---

## 3.2 Security First

任何敏感信息都禁止明文持久化。

包括：

- Password
- API Key
- Secret
- Token
- SSH Private Key
- Database Password
- Environment Secret
- Secure Note

---

## 3.3 Fast

用户核心操作应该控制在：

```text
启动应用
    ↓
搜索
    ↓
找到
    ↓
复制
```

尽可能 3 次操作以内完成。

---

## 3.4 Minimal

不要做传统后台系统。

禁止出现大量：

- Dashboard
- 数据统计
- 图表
- 无意义动画
- 复杂设置
- 冗余弹窗

产品重点是：

> 找到秘密 → 使用秘密。

---

# 四、用户角色

第一版本只支持：

```text
个人用户
```

不做：

- 团队
- 权限管理
- 多账号
- 云端共享

后续版本再扩展。

---

# 五、信息架构

```text
Jiazi Vault
│
├── Vault
│   ├── All Items
│   ├── Favorites
│   ├── Recent
│   └── Trash
│
├── Projects
│   ├── Project A
│   │   ├── Development
│   │   ├── Testing
│   │   └── Production
│   │
│   └── Project B
│
├── Categories
│   ├── Login
│   ├── Server
│   ├── Database
│   ├── API Key
│   ├── SSH
│   └── Secure Note
│
├── Password Generator
│
└── Settings
```

---

# 六、核心数据模型

## 6.1 Item

所有凭证统一抽象为 Item。

```typescript
interface VaultItem {
  id: string

  type: ItemType

  title: string

  projectId?: string

  environment?: Environment

  username?: string

  password?: string

  url?: string

  host?: string

  port?: number

  fields?: Record<string, string>

  notes?: string

  tags?: string[]

  favorite: boolean

  createdAt: number

  updatedAt: number
}
```

---

## 6.2 ItemType

```typescript
type ItemType =
  | 'login'
  | 'password'
  | 'server'
  | 'database'
  | 'api-key'
  | 'ssh'
  | 'secure-note'
  | 'custom'
```

---

## 6.3 Environment

```typescript
type Environment =
  | 'development'
  | 'testing'
  | 'staging'
  | 'production'
  | 'other'
```

UI 显示：

```text
Development
Testing
Staging
Production
Other
```

Production 使用明显的危险视觉提示。

---

# 七、主要页面

# 7.1 解锁页面

应用启动后：

```text
┌────────────────────────────────────┐
│                                    │
│             🔐                     │
│                                    │
│         Jiazi Vault                │
│                                    │
│      Unlock your vault             │
│                                    │
│   ┌────────────────────────────┐   │
│   │ •••••••••••••••••          │   │
│   └────────────────────────────┘   │
│                                    │
│            [ 解锁 ]                │
│                                    │
│       Windows Hello / Touch ID     │
│                                    │
└────────────────────────────────────┘
```

要求：

- 不显示密码明文
- 支持 Enter 解锁
- 支持系统生物识别
- 解锁失败需要限速
- 不允许无限尝试

---

# 7.2 主界面

采用三栏或两栏布局。

推荐：

```text
┌────────────────────────────────────────────────────┐
│ 🔐 Jiazi Vault          Search...        + New      │
├──────────────┬─────────────────────────────────────┤
│              │                                     │
│ All Items    │  Teacher Development Platform      │
│              │                                     │
│ ⭐ Favorites │  Production                        │
│              │                                     │
│ 🕘 Recent    │  ┌─────────────────────────────┐    │
│              │  │ 🔑 Admin                    │    │
│ 📦 Projects │  │                             │    │
│              │  │ Username  admin             │    │
│   Project A │  │ Password  ••••••••••   📋   │    │
│   Project B │  │ URL       xxx.com       📋   │    │
│              │  └─────────────────────────────┘    │
│ 🔑 Categories│                                    │
│              │  Notes                              │
│ 🗑 Trash     │  Production environment             │
│              │                                     │
└──────────────┴─────────────────────────────────────┘
```

---

# 7.3 搜索

顶部搜索框：

```text
Search passwords...
```

快捷键：

```text
Ctrl + K
```

支持搜索：

- 名称
- 项目
- 环境
- 用户名
- URL
- Host
- 标签
- 类型

不要默认搜索敏感字段中的完整密码内容。

---

# 7.4 新建 Item

点击：

```text
+ New
```

弹出类型选择：

```text
Login
Password
Server
Database
API Key
SSH
Secure Note
Custom
```

---

# 八、不同类型 Item

## 8.1 Login

字段：

```text
Name
Project
Environment
Username
Password
URL
Tags
Notes
```

---

## 8.2 Server

字段：

```text
Name
Project
Environment
Host
Port
Username
Password
SSH Key
Tags
Notes
```

---

## 8.3 Database

字段：

```text
Name
Project
Environment
Database Type
Host
Port
Database Name
Username
Password
Connection String
Notes
```

数据库类型：

```text
MySQL
PostgreSQL
MongoDB
Redis
SQLite
Other
```

---

## 8.4 API Key

字段：

```text
Name
Project
Environment
Provider
API Key
Secret
Endpoint
Expires At
Notes
```

---

## 8.5 SSH

字段：

```text
Name
Project
Environment
Host
Port
Username
Private Key
Passphrase
Notes
```

---

## 8.6 Secure Note

用于保存：

- 恢复码
- License
- 安全信息
- 私密文本
- 临时重要信息

字段：

```text
Title
Content
Tags
```

---

# 九、项目管理

项目是 Jiazi Vault 的核心特色之一。

例如：

```text
教师发展平台
│
├── Development
│   ├── Frontend
│   ├── Backend
│   ├── MySQL
│   └── Redis
│
├── Testing
│   ├── Server
│   ├── MySQL
│   └── Admin
│
└── Production
    ├── Server
    ├── Database
    ├── Redis
    └── Admin
```

项目页面应该支持：

- 项目名称
- 项目图标
- 项目颜色
- 描述
- Item 数量
- 最近访问时间

---

# 十、密码生成器

## 10.1 功能

支持：

```text
密码长度
大写字母
小写字母
数字
特殊字符
排除易混淆字符
```

默认：

```text
Length: 20
Uppercase: true
Lowercase: true
Numbers: true
Symbols: true
Exclude Ambiguous: true
```

---

## 10.2 密码强度

实时显示：

```text
Weak
Fair
Strong
Very Strong
```

同时显示熵值估算。

---

## 10.3 操作

```text
Generate
Copy
Save to Vault
```

---

# 十一、全局快捷键

默认：

```text
Ctrl + Shift + P
```

呼出快速搜索窗口。

```text
┌──────────────────────────────────┐
│ 🔐 Jiazi Vault                   │
│                                  │
│ Search credentials...            │
│                                  │
│ Teacher Platform / Production    │
│ GitHub                           │
│ Alibaba Cloud                    │
│ MySQL                            │
│                                  │
└──────────────────────────────────┘
```

支持键盘：

```text
↑ ↓
Enter
Esc
Ctrl + C
```

---

# 十二、复制机制

敏感字段点击复制后：

```text
Copy
 ↓
Clipboard
 ↓
5~15 秒
 ↓
自动清空
```

默认：

```text
clipboardClearTimeout = 15s
```

允许用户在设置中修改：

```text
Never
5s
10s
15s
30s
60s
```

---

# 十三、自动锁定

设置：

```text
Never
5 minutes
15 minutes
30 minutes
1 hour
```

应用检测：

- 用户无操作
- 应用切换
- 系统锁屏
- 系统休眠

满足条件后：

```text
Lock Vault
```

---

# 十四、安全架构

这是整个项目最重要的部分。

## 14.1 加密流程

推荐：

```text
Master Password
       │
       ▼
    Argon2id
       │
       ▼
   Master Key
       │
       ▼
 AES-256-GCM
       │
       ▼
Encrypted Vault
       │
       ▼
 SQLite
```

---

# 十五、密钥派生

不要：

```text
SHA256(masterPassword)
```

使用：

```text
Argon2id
```

推荐参数：

```text
memoryCost
timeCost
parallelism
```

参数必须通过安全模块统一管理，不允许前端随意定义。

---

# 十六、数据加密

使用：

```text
AES-256-GCM
```

每条敏感数据应该使用随机 nonce / IV。

禁止：

```text
固定 IV
固定 Key
ECB
Base64 当作加密
```

Base64 只能用于编码，不能作为安全措施。

---

# 十七、数据库

推荐：

```text
SQLite
```

数据库结构：

```text
vault.db
```

建议：

```text
vault_metadata
projects
items
item_fields
tags
item_tags
settings
```

但数据库中的敏感字段必须加密。

---

# 十八、建议的加密数据结构

```typescript
interface EncryptedValue {
  ciphertext: string
  nonce: string
  algorithm: 'AES-256-GCM'
  version: number
}
```

例如：

```json
{
  "ciphertext": "....",
  "nonce": "....",
  "algorithm": "AES-256-GCM",
  "version": 1
}
```

---

# 十九、不要把加密逻辑放在 Vue

前端：

```text
Vue
 ↓
IPC
 ↓
Rust
 ↓
Crypto
 ↓
SQLite
```

禁止：

```text
Vue
 ↓
AES
 ↓
SQLite
```

敏感数据的：

- 加密
- 解密
- Key 派生
- 数据库存储

优先由 Rust 完成。

---

# 二十、推荐技术栈

## Desktop

```text
Tauri 2
Rust
```

## Frontend

```text
Vue 3
TypeScript
Vite
Naive UI
Pinia
Vue Router
```

## Database

```text
SQLite
```

## Crypto

```text
Rust crypto libraries
Argon2id
AES-256-GCM
```

## Build

```text
pnpm
Vite
Tauri CLI
```

---

# 二十一、项目目录

```text
jiazi-vault/
│
├── src/
│   ├── assets/
│   │
│   ├── components/
│   │   ├── common/
│   │   ├── vault/
│   │   ├── item/
│   │   ├── project/
│   │   └── generator/
│   │
│   ├── views/
│   │   ├── Unlock/
│   │   ├── Vault/
│   │   ├── Project/
│   │   ├── Generator/
│   │   └── Settings/
│   │
│   ├── stores/
│   │   ├── vault.ts
│   │   ├── project.ts
│   │   ├── settings.ts
│   │   └── auth.ts
│   │
│   ├── composables/
│   │   ├── useVault.ts
│   │   ├── useClipboard.ts
│   │   ├── usePasswordGenerator.ts
│   │   └── useAutoLock.ts
│   │
│   ├── services/
│   │   ├── vault.ts
│   │   ├── project.ts
│   │   ├── crypto.ts
│   │   └── backup.ts
│   │
│   ├── types/
│   │
│   ├── utils/
│   │
│   ├── App.vue
│   └── main.ts
│
├── src-tauri/
│   ├── src/
│   │   ├── crypto/
│   │   ├── database/
│   │   ├── commands/
│   │   ├── vault/
│   │   └── main.rs
│   │
│   ├── migrations/
│   └── tauri.conf.json
│
├── public/
│
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
└── README.md
```

---

# 二十二、前后端通信

使用 Tauri IPC。

例如：

```typescript
invoke('unlock_vault', {
  password
})
```

Rust：

```rust
#[tauri::command]
fn unlock_vault(password: String) -> Result<UnlockResult, VaultError> {
    // ...
}
```

敏感操作统一通过 Command API。

---

# 二十三、IPC API 设计

## Vault

```text
create_vault
unlock_vault
lock_vault
is_vault_unlocked
```

## Items

```text
create_item
update_item
delete_item
restore_item
get_item
list_items
search_items
toggle_favorite
```

## Projects

```text
create_project
update_project
delete_project
list_projects
```

## Password

```text
generate_password
calculate_password_strength
```

## Backup

```text
export_vault
import_vault
create_backup
restore_backup
```

---

# 二十四、状态管理

Pinia：

```text
authStore
vaultStore
projectStore
settingsStore
uiStore
```

禁止把完整敏感数据长期放在全局 Store 中。

敏感数据应该：

```text
按需读取
 ↓
展示
 ↓
操作
 ↓
尽快释放
```

---

# 二十五、搜索设计

搜索必须快速。

普通搜索：

```text
名称
项目
环境
类型
标签
用户名
URL
Host
```

例如：

```text
production
```

返回：

```text
Teacher Platform / Production / Server
Teacher Platform / Production / MySQL
Teacher Platform / Production / Admin
```

搜索结果需要显示：

```text
Icon
Title
Project
Environment
Type
```

不要直接显示密码。

---

# 二十六、备份

第一版必须支持本地加密备份。

例如：

```text
jiazi-vault-backup-2026-09-04.jvault
```

备份文件必须是：

```text
Encrypted
```

不能：

```text
JSON plaintext
```

---

# 二十七、导入 / 导出

支持：

```text
Jiazi Vault Backup
JSON
CSV
```

但：

> 明文 JSON / CSV 导出必须有二次确认。

弹窗：

```text
⚠ Security Warning

You are about to export sensitive data
in plaintext.

Anyone with this file may access your
credentials.

[Cancel] [Export]
```

---

# 二十八、删除策略

删除 Item：

```text
Item
 ↓
Trash
 ↓
30 days
 ↓
Permanent Delete
```

提供：

```text
Delete permanently
```

必须二次确认。

---

# 二十九、UI 设计规范

## 29.1 风格

关键词：

```text
Minimal
Developer Tool
Premium
Dark
Clean
Fast
Technical
```

不要做：

```text
企业后台
复杂渐变
大面积卡片
夸张阴影
过多动画
```

---

# 三十、主题

支持：

```text
Dark
Light
System
```

默认：

```text
System
```

暗色模式应该作为重点设计。

---

# 三十一、快捷键

```text
Ctrl + K
Search

Ctrl + Shift + P
Quick Vault

Ctrl + N
New Item

Ctrl + Shift + N
New Project

Ctrl + G
Password Generator

Esc
Close Dialog

Ctrl + C
Copy

Ctrl + Shift + L
Lock Vault
```

---

# 三十二、系统托盘

应用关闭窗口后：

```text
不是退出
```

而是进入：

```text
System Tray
```

托盘菜单：

```text
Jiazi Vault

Open Vault
Quick Search
Generate Password
Lock Vault
Quit
```

---

# 三十三、安全要求

必须实现：

### S01

主密码不能明文写入磁盘。

### S02

主密码不能写入日志。

### S03

密码不能写入 console.log。

### S04

Token 不能写入日志。

### S05

数据库敏感字段必须加密。

### S06

备份必须加密。

### S07

Clipboard 必须自动清理。

### S08

应用锁定后不得继续读取 Vault 明文。

### S09

生产环境禁止 Debug 日志。

### S10

错误信息不能泄漏敏感信息。

---

# 三十四、日志规范

禁止：

```typescript
console.log(password)
console.log(token)
console.log(masterKey)
console.log(item)
```

允许：

```text
Vault unlocked
Vault locked
Item created
Item deleted
Backup created
```

但不得包含敏感字段。

---

# 三十五、错误处理

统一：

```typescript
type VaultError =
  | 'INVALID_PASSWORD'
  | 'VAULT_NOT_FOUND'
  | 'VAULT_LOCKED'
  | 'DECRYPT_FAILED'
  | 'DATABASE_ERROR'
  | 'INVALID_DATA'
  | 'BACKUP_ERROR'
  | 'PERMISSION_DENIED'
```

用户看到：

```text
Unable to unlock vault.
Please check your master password.
```

而不是 Rust stack trace。

---

# 三十六、动画

动画必须克制。

允许：

```text
Page transition
Modal transition
Search result transition
Copy success
Lock transition
```

时间：

```text
150ms ~ 250ms
```

禁止：

```text
长时间启动动画
复杂粒子
大范围位移动画
```

这是效率工具。

---

# 三十七、性能目标

启动：

```text
Cold Start < 1.5s
```

普通搜索：

```text
< 100ms
```

本地 Item：

```text
10,000+
```

仍然需要保持可用。

---

# 三十八、MVP 开发阶段

## Phase 1：基础工程

完成：

```text
Tauri
Vue 3
TypeScript
Vite
Naive UI
Pinia
SQLite
```

验收：

```text
pnpm dev
```

正常运行。

---

# 三十九、Phase 2：Vault

实现：

```text
Create Vault
Master Password
Argon2id
AES-256-GCM
SQLite
Unlock
Lock
```

验收：

```text
创建 Vault
关闭应用
重新打开
输入主密码
成功恢复数据
```

---

# 四十、Phase 3：Item

实现：

```text
Create
Read
Update
Delete
Favorite
Search
```

支持：

```text
Login
Password
Server
Database
API Key
SSH
Secure Note
```

---

# 四十一、Phase 4：Project

实现：

```text
Create Project
Update Project
Delete Project
Environment
Project Items
```

---

# 四十二、Phase 5：Password Generator

实现：

```text
Random Password
Length
Character Options
Strength
Copy
Save
```

---

# 四十三、Phase 6：Developer Features

实现：

```text
Global Shortcut
Quick Search
System Tray
Clipboard Auto Clear
Auto Lock
```

---

# 四十四、Phase 7：Backup

实现：

```text
Encrypted Backup
Restore
Import
Export
```

---

# 四十五、Phase 8：测试

必须测试：

```text
Unit Test
Integration Test
E2E Test
Security Test
Performance Test
```

重点测试：

```text
错误密码
数据库损坏
备份恢复
加密数据
锁定状态
Clipboard
自动锁定
异常退出
```

---

# 四十六、测试场景

## T01

创建 Vault。

预期：

```text
成功
```

---

## T02

输入错误密码。

预期：

```text
无法解锁
不泄漏正确密码
```

---

## T03

创建密码。

预期：

```text
数据库中不存在明文 Password
```

---

## T04

复制密码。

预期：

```text
Clipboard 获取密码
15 秒后自动清理
```

---

## T05

锁定 Vault。

预期：

```text
无法查看敏感数据
```

---

## T06

导出备份。

预期：

```text
备份文件加密
```

---

## T07

恢复备份。

预期：

```text
数据完整恢复
```

---

# 四十七、开发约束

AI Agent 实现本项目时必须遵守以下规则。

## 47.1 不允许过度设计

不要主动加入：

```text
云同步
账号系统
团队系统
AI
聊天
统计 Dashboard
社交
```

除非明确要求。

---

## 47.2 不允许修改技术栈

默认：

```text
Tauri 2
Vue 3
TypeScript
Vite
Naive UI
Pinia
SQLite
Rust
```

---

## 47.3 不允许弱化安全

禁止为了开发方便使用：

```text
明文 Password
SHA256 Master Password
固定 AES Key
固定 IV
localStorage 保存主密码
localStorage 保存完整 Vault
console.log 敏感数据
```

---

# 四十八、AI 实现规则

AI Agent 必须采用：

```text
分析
 ↓
设计
 ↓
实现
 ↓
测试
 ↓
Review
 ↓
修复
```

禁止：

```text
一次性生成整个项目
```

应该按照 Phase 逐步实现。

---

# 四十九、每个阶段的工作要求

每完成一个 Phase：

```text
1. 检查 TypeScript
2. 检查 Rust
3. 检查 ESLint
4. 检查构建
5. 运行测试
6. 检查安全
7. 检查 UI
8. 输出修改总结
```

---

# 五十、代码质量要求

必须遵守：

```text
单一职责
低耦合
高内聚
明确类型
禁止 any
禁止重复代码
禁止 Magic String
禁止 Magic Number
```

组件：

```text
单一职责
```

Service：

```text
业务逻辑
```

Store：

```text
状态管理
```

Rust：

```text
安全
数据库
系统能力
```

---

# 五十一、前端分层

```text
View
 ↓
Component
 ↓
Composable
 ↓
Store
 ↓
Service
 ↓
Tauri IPC
 ↓
Rust
 ↓
Database / Crypto
```

禁止 View 直接调用 Rust command。

---

# 五十二、设计系统

统一定义：

```text
spacing
radius
font
icon
color
shadow
transition
```

不要每个页面单独设计。

---

# 五十三、空状态

例如：

```text
No credentials yet

Create your first credential
to start managing your secrets.

[ + New Credential ]
```

---

# 五十四、搜索无结果

```text
No results

Try another keyword.
```

---

# 五十五、第一次启动

第一次启动：

```text
Welcome to Jiazi Vault

Your credentials stay on this device.

No account.
No cloud.
No tracking.

[ Create Vault ]
```

然后：

```text
Create Master Password
```

---

# 五十六、首次创建 Vault

流程：

```text
Welcome
   ↓
Create Master Password
   ↓
Confirm Password
   ↓
Security Information
   ↓
Create Vault
   ↓
Main Window
```

---

# 五十七、安全提示

第一次创建后提示：

```text
Your master password cannot be recovered.

If you forget it, your encrypted vault
cannot be unlocked.

Make sure you remember it.
```

---

# 五十八、后续版本规划

## V1.1

```text
Tags
Favorites
Recent
Better Search
```

## V1.2

```text
.env Manager
Environment Variables
SSH Manager
```

例如：

```env
DATABASE_URL=...
REDIS_URL=...
JWT_SECRET=...
API_KEY=...
```

---

# 五十九、V1.3

```text
Browser Extension
```

实现：

```text
自动识别登录页面
快速填充
```

---

# 六十、V2

未来考虑：

```text
Encrypted Sync
Mobile App
Team Vault
Shared Credentials
Role Management
Audit Log
```

但 V1 禁止实现。

---

# 六十一、最终产品定位

Jiazi Vault 最终应该成为：

```text
              Jiazi Vault
                   │
        ┌──────────┼──────────┐
        │          │          │
     Password    Secrets   Credentials
        │          │          │
      Login      API Key     SSH
      Account    Token       Server
      Database   ENV         Database
```

最终形成：

> **开发者本地 Secrets 操作系统。**

而不仅仅是一个 Password Manager。

---

# 六十二、最终验收标准

当以下全部满足时，认为 V1 完成：

```text
[ ] 可以创建 Vault
[ ] 可以设置 Master Password
[ ] Master Password 使用 Argon2id
[ ] Vault 使用 AES-256-GCM
[ ] SQLite 本地存储
[ ] 敏感数据禁止明文持久化
[ ] 可以创建 Login
[ ] 可以创建 Password
[ ] 可以创建 Server
[ ] 可以创建 Database
[ ] 可以创建 API Key
[ ] 可以创建 SSH
[ ] 可以创建 Secure Note
[ ] 可以编辑 Item
[ ] 可以删除 Item
[ ] 可以恢复 Item
[ ] 可以收藏 Item
[ ] 可以搜索 Item
[ ] 可以创建 Project
[ ] 可以设置 Environment
[ ] 可以生成密码
[ ] 可以复制密码
[ ] Clipboard 自动清理
[ ] 支持自动锁定
[ ] 支持手动锁定
[ ] 支持系统托盘
[ ] 支持全局快捷键
[ ] 支持加密备份
[ ] 支持恢复备份
[ ] 支持 Light / Dark / System
[ ] Windows 构建成功
[ ] macOS 构建成功
[ ] Linux 构建成功
[ ] TypeScript 检查通过
[ ] Rust 检查通过
[ ] 单元测试通过
[ ] E2E 测试通过
[ ] 无敏感信息日志
```

---

# 六十三、给 AI Agent 的最终执行指令

你现在是一名负责实现 **Jiazi Vault** 的 Senior Desktop Engineer。

请严格按照本规格文档实现项目。

## 执行规则

1. 不要一次性实现全部功能。
2. 按 Phase 1 → Phase 8 顺序实现。
3. 每个 Phase 完成后先验证，再进入下一阶段。
4. 不允许跳过安全设计。
5. 不允许使用明文密码存储。
6. 不允许把 Master Password 存入 localStorage。
7. 不允许将完整 Vault 放入前端持久化 Store。
8. 加密、Key Derivation、数据库等安全敏感逻辑优先放在 Rust。
9. 前端负责 UI、交互和非敏感状态。
10. 所有 IPC API 必须具有明确的 TypeScript / Rust 类型。
11. 不要添加规格之外的大型功能。
12. 不要为了快速开发降低安全等级。
13. 所有敏感信息禁止进入日志。
14. 每个 Phase 完成后执行 TypeScript、Rust、Build 和 Test。
15. 如果发现架构问题，应优先修复架构，而不是堆补丁。

## 当前任务

首先只实现：

### Phase 1：基础工程

包括：

```text
Tauri 2
Vue 3
TypeScript
Vite
Naive UI
Pinia
Rust
SQLite 基础能力
```

完成：

```text
项目初始化
目录结构
基础布局
主题系统
路由
基础 IPC
SQLite 初始化
```

暂时不要实现完整密码加密、项目管理、密码生成器等后续功能。

完成 Phase 1 后：

1. 执行类型检查
2. 执行 Rust Check
3. 执行构建
4. 启动桌面应用
5. 检查 UI
6. 输出 Phase 1 完成报告
7. 等待下一阶段指令

---

# 六十四、项目成功标准

最终用户打开 Jiazi Vault 后，应该能够形成这样的使用习惯：

```text
需要密码
   ↓
Ctrl + Shift + P
   ↓
输入项目名称
   ↓
找到凭证
   ↓
Ctrl + C
   ↓
继续工作
```

整个过程：

> **快速、安静、本地、安全、不打扰工作流。**

这就是 Jiazi Vault 的核心产品体验。

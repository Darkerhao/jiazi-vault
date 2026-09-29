# Keystill · 密序

面向开发者的本地凭证管理工具。品牌名读作 Key-still，Key 表达密钥，still 表达安静与留存；中文名「密序」表达凭证整理有序。宣传语：**密钥有序，专注如常。**

## 图形与配色

K 字母是识别轮廓，竖笔圆孔暗示钥匙。使用粗实几何结构，小尺寸保留 K 的识别；不在应用图标中加入文字。主色柠檬绿 `#c7ef68`，石墨色 `#20251f`，纸白 `#efeee8`。图标渐变 `#d4f878` → `#b6e650`。

浅色界面的文字、选中图标和控件边框使用深绿 `#4a681d`，避免亮绿在浅底上对比不足；主按钮统一柠檬绿底、石墨色文字。深色界面使用石墨底和柠檬绿强调色。主题通过现有 Naive UI ConfigProvider 设置，不增加第二套组件。

## 资源

- `public/brand/mark.svg`：唯一图形母版，透明背景，支持 `currentColor`。
- `public/brand/logo-light.svg` / `logo-dark.svg`：两种背景下的横版字标，Segoe UI 字体，回退 Inter / sans-serif。
- `public/brand/icon.svg` / `icon.png`：界面、浏览器标签及桌面窗口图标。
- `public/brand/tray.png` / `tray@2x.png`：20 / 40 px 彩色托盘图标。
- `public/brand/trayTemplate.png` / `trayTemplate@2x.png`：macOS 单色菜单栏图标。
- `build/icon.ico`：Windows 图标，16、20、24、32、40、48、64、128、256 px。
- `build/icon.icns`：macOS 图标，标准及 Retina 尺寸，最大 1024 px。
- `build/icon.png`：1024 px 通用及 Linux 图标。

运行 `pnpm brand:generate` 从母版统一生成派生资源。复用项目已有 Electron，不增加图形工具或依赖。

## 品牌升级与数据兼容

用户可见名称统一为 Keystill；中文名出现在欢迎页、侧栏、网页标题和文档。Windows Hello、Touch ID、托盘、窗口标题、macOS 菜单、导出文件名、安装包和 CI 发布标题同步升级。

保留以下持久化身份：`package.json.name = jiazi-vault`、`build.appId = com.jiazi.vault`、备份格式 `jiazi-vault`、扩展名 `.jvault`、密钥校验字符串及现有 IPC 标识。`build.productName` 改为 Keystill，安装包前缀显式设为 `keystill-`。不要向 package.json 顶层添加 `productName`，否则 Electron 将优先使用它作为内部应用名，改变默认数据目录。

依据：旧 Windows 0.1.2 安装包内的 package.json 使用 `name: jiazi-vault` 且无顶层 productName；[Electron 44.2.0 初始化源码](https://github.com/electron/electron/blob/v44.2.0/lib/browser/init.ts) 由该字段设置内部应用名，[app 文档](https://github.com/electron/electron/blob/v44.2.0/docs/api/app.md) 说明默认 userData 为 appData 下的应用名目录。沿用这些标识即可继续读取原库，无需新增迁移逻辑。

版本号继续由现有 main 发布流程递增，本次品牌修改不另建发布流程。历史规格 `Jiazi Vault.md` 与既有验收记录保留历史名称。

macOS / Linux 资源已生成；平台原生显示与 Touch ID 仍需对应设备验收。

## 本轮验证与交付（2026-09-29）

50 项业务测试、两组桌面回归、类型检查及生产构建通过。真实旧版与新打包程序通过旧库读取、旧备份恢复和重启验证；深浅主题与锁定页面已截图检查。详情见 [DELIVERY.md](./DELIVERY.md)。

- Windows 安装包：`release/keystill-brand/keystill-0.1.5-win-x64.exe`。
- 素材包：`output/keystill-brand.zip`。
- 实际应用截图及报告：`output/playwright/brand-upgrade/`。

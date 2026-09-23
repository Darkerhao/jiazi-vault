# Jiazi Vault 品牌资源

标志将「甲」的字形简化成圆角保险库门：外框表达收纳与保护，内部交叉结构与向下延伸的中轴保留「甲」的辨识度。应用图标使用浅蓝底与深墨蓝标志，延续现有界面配色；小尺寸不使用文字或细节装饰。

- `public/brand/mark.svg`：唯一图形母版，透明背景，支持 `currentColor`。
- `public/brand/logo-light.svg` / `logo-dark.svg`：浅色 / 深色背景使用的横版 Logo，字标使用 Segoe UI，回退 Inter / sans-serif。
- `public/brand/icon.svg`：欢迎页、解锁页、侧栏与浏览器标签图标。
- `public/brand/icon.png`：256 px 桌面窗口图标。
- `public/brand/tray.png` / `tray@2x.png`：20 / 40 px 彩色托盘图标。
- `public/brand/trayTemplate.png` / `trayTemplate@2x.png`：macOS 菜单栏透明单色图标。
- `build/icon.ico`：Windows 应用及安装 / 卸载程序图标，含 16、20、24、32、40、48、64、128、256 px。
- `build/icon.icns`：macOS 应用图标，含标准与 Retina 尺寸，最大 1024 px。
- `build/icon.png`：1024 px PNG，供 Linux 打包及通用导出。

颜色：标志 `#172b4d`，应用图标渐变 `#b3ceff` → `#82acf0`，深色背景字标 `#edf3ff`。保留图形自带留白，按原比例缩放。

修改母版或 `scripts/generate-brand.cjs` 后运行 `pnpm brand:generate`，统一生成所有派生资源。生成器复用项目已有 Electron，不新增依赖；生成资源随代码保存，普通构建无需额外图形工具。Windows NSIS 安装 / 卸载程序继承应用图标。

桌面资源加载遵循 [Electron 44.2.0 NativeImage 文档](https://github.com/electron/electron/blob/v44.2.0/docs/api/native-image.md) 的 Retina 与 macOS Template 命名约定。macOS / Linux 图标文件已生成，系统显示仍需在相应平台验收。

## 本次验证（2026-09-23）

- `pnpm build` 通过：Vue 类型检查、Vite 构建、Electron 编译与 Windows 原生组件构建。
- 使用独立测试保险库，在源码构建和实际 Windows 打包程序中验证欢迎引导、主界面及锁定后的 Logo；深浅色截图、资源加载与渲染错误检查通过。托盘检测到 1× / 2× 两档图像。
- 从 Windows 应用 EXE 和安装程序提取的 32 px 图标，与设计 ICO 的 RGBA 像素完全一致。
- 品牌素材包：`output/jiazi-vault-brand.zip`；预览：`output/playwright/brand-preview.png`。
- 新图标 Windows 安装包：`release/brand-preview/Jiazi Vault Setup 0.1.1.exe`。由现有 0.1.1 源码重新打包，原发布目录中的安装包保留。本次验证了打包程序运行，未重复执行安装 / 卸载流程。
- 运行记录：`output/playwright/brand-verification.json` 与 `output/playwright/brand-packaged/brand-verification.json`。

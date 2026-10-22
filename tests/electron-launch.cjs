// Test-only launcher: production renderer, isolated database, real IPC and crypto.
const { app } = require('electron')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')
app.setPath('userData', process.env.JIAZI_TEST_DATA)
app.setAppPath(process.cwd())
app.setVersion(require(join(process.cwd(), 'package.json')).version)
Object.defineProperty(app, 'isPackaged', { value: true })
Object.defineProperty(process, 'resourcesPath', { value: join(process.cwd(), 'output') })
// Keep automatic update checks isolated from GitHub in desktop tests.
const { autoUpdater } = require('electron-updater')
const { net } = require('electron')
const fetch = net.fetch
const configPath = process.env.JIAZI_TEST_UPDATE_CONFIG
if (configPath) {
  const config = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'))
  autoUpdater.setFeedURL(config)
  autoUpdater.updateConfigPath = configPath
  net.fetch = (url, options) => String(url).startsWith('https://api.github.com/repos/Darkerhao/jiazi-vault/releases')
    ? fetch(`${config.url}/releases`, options) : fetch(url, options)
} else {
  autoUpdater.checkForUpdates = async () => null
  net.fetch = (url, options) => String(url).startsWith('https://api.github.com/repos/Darkerhao/jiazi-vault/releases')
    ? Promise.reject(new Error('TEST_UPDATE_FEED_NOT_CONFIGURED')) : fetch(url, options)
}
import(pathToFileURL(join(process.cwd(), 'dist-electron/main.js')).href)

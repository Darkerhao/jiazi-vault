// Isolate native startup entries and observe real tray/window events without changing production code.
const { app, Tray } = require('electron')
if (process.platform === 'win32') {
  const setAppId = app.setAppUserModelId.bind(app)
  app.setAppUserModelId = () => setAppId(process.env.JIAZI_TEST_APP_ID)
}
globalThis.startupWindowShows = 0
app.on('browser-window-created', (_event, window) => {
  globalThis.startupWindowReady = new Promise(resolve => window.once('ready-to-show', resolve))
  window.on('show', () => { globalThis.startupWindowShows++ })
})
const setContextMenu = Tray.prototype.setContextMenu
Tray.prototype.setContextMenu = function (menu) {
  globalThis.startupTray = this
  globalThis.startupTrayMenu = menu
  return setContextMenu.call(this, menu)
}
require('./electron-launch.cjs')

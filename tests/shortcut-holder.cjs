// Independent OS registration for the shortcut conflict acceptance test.
const { app, globalShortcut } = require('electron')
app.setPath('userData', process.env.JIAZI_TEST_DATA)
app.whenReady().then(() => { globalThis.shortcutHeld = globalShortcut.register('CommandOrControl+Shift+P', () => {}) })
app.on('will-quit', () => globalShortcut.unregisterAll())

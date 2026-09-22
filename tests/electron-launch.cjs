// Test-only launcher: production renderer, isolated database, real IPC and crypto.
const { app } = require('electron')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')
app.setPath('userData', process.env.JIAZI_TEST_DATA)
app.setAppPath(process.cwd())
Object.defineProperty(app, 'isPackaged', { value: true })
import(pathToFileURL(join(process.cwd(), 'dist-electron/main.js')).href)

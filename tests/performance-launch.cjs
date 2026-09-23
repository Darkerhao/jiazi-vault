// Measure a fresh Electron process until the real unlock form has painted.
const { app } = require('electron')
const started = performance.now() - process.uptime() * 1000
globalThis.jiaziStartup = new Promise((resolve, reject) => {
  app.once('browser-window-created', (_event, window) => {
    window.webContents.once('dom-ready', () => {
      window.webContents.executeJavaScript(`new Promise((resolve) => {
        const ready = () => {
          const input = document.querySelector('input[placeholder="主密码"]');
          if (!input || input.disabled) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        };
        const observer = new MutationObserver(ready);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        ready();
      })`).then(() => resolve(performance.now() - started), reject)
    })
  })
})
require('./electron-launch.cjs')

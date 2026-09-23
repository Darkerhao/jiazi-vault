// One SVG master; rasterize with the Chromium already included in Electron.
const { app, BrowserWindow } = require('electron')
const { readFile, writeFile, mkdir } = require('node:fs/promises')
const { join } = require('node:path')

const root = join(__dirname, '..')
const brand = join(root, 'public', 'brand')
const build = join(root, 'build')
const svg = (body, width = 64, height = 64) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>\n`

async function generate() {
  await mkdir(build, { recursive: true })
  const master = await readFile(join(brand, 'mark.svg'), 'utf8')
  const mark = master.replace(/<svg[^>]*>|<\/svg>/g, '').trim()
  const icon = svg(`<defs><linearGradient id="tile" x2="1" y2="1"><stop stop-color="#b3ceff"/><stop offset="1" stop-color="#82acf0"/></linearGradient></defs>
  <rect width="64" height="64" rx="16" fill="url(#tile)"/>
  <rect x=".5" y=".5" width="63" height="63" rx="15.5" fill="none" stroke="#fff" stroke-opacity=".25"/>
  <g color="#172b4d" fill="none">${mark}</g>`)
  await writeFile(join(brand, 'icon.svg'), icon)

  for (const [name, ink] of [['logo-light', '#172b4d'], ['logo-dark', '#edf3ff']]) {
    const logo = svg(`<g color="${ink}" fill="none">${mark}</g>
    <text x="80" y="43" fill="${ink}" font-family="Segoe UI, Inter, sans-serif" font-size="36" font-weight="600" letter-spacing="-1">Jiazi Vault</text>`, 256, 64)
    await writeFile(join(brand, `${name}.svg`), logo)
  }

  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  await window.loadURL('data:text/html,<meta charset="utf-8">')
  async function png(source, size) {
    const data = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(source)});
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ${size};
      canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size});
      return canvas.toDataURL('image/png').split(',')[1];
    })()`)
    return Buffer.from(data, 'base64')
  }

  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024]
  const images = new Map()
  for (const size of sizes) images.set(size, await png(icon, size))
  await writeFile(join(brand, 'icon.png'), images.get(256))
  await writeFile(join(build, 'icon.png'), images.get(1024))
  for (const [suffix, size] of [['', 20], ['@2x', 40]]) {
    await writeFile(join(brand, `tray${suffix}.png`), images.get(size))
    await writeFile(join(brand, `trayTemplate${suffix}.png`), await png(svg(`<g color="#000" fill="none">${mark}</g>`), size))
  }

  // ICO directory followed by PNG frames, including intermediate Windows DPI sizes.
  const icoSizes = sizes.filter((size) => size <= 256)
  const directory = Buffer.alloc(6 + icoSizes.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(icoSizes.length, 4)
  let offset = directory.length
  icoSizes.forEach((size, index) => {
    const entry = 6 + index * 16, data = images.get(size)
    directory[entry] = directory[entry + 1] = size === 256 ? 0 : size
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(data.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })
  await writeFile(join(build, 'icon.ico'), Buffer.concat([directory, ...icoSizes.map((size) => images.get(size))]))

  // Modern ICNS entries contain PNG data; include standard and Retina representations.
  const entries = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]
  const chunks = entries.map(([type, size]) => {
    const data = images.get(size), header = Buffer.alloc(8)
    header.write(type)
    header.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([header, data])
  })
  const header = Buffer.alloc(8)
  header.write('icns')
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  await writeFile(join(build, 'icon.icns'), Buffer.concat([header, ...chunks]))
  window.destroy()
  console.log('Generated Jiazi Vault logos, application icons and tray icons from public/brand/mark.svg')
}

app.whenReady().then(generate).then(() => app.quit()).catch((error) => {
  console.error(error)
  app.exit(1)
})

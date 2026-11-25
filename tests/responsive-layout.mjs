import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export async function verifyResponsiveLayout(page, screenshotDirectory) {
  const routes = [
    '/vault', '/vault?filter=categories', '/vault?filter=favorites', '/vault?filter=recent',
    '/vault?filter=trash', '/projects', '/generator', '/health', '/settings', '/about',
  ]
  async function settle() {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})))
    })
  }
  async function visit(route) {
    await page.evaluate(route => { location.hash = route }, route)
    const heading = {
      '/vault': '全部条目', '/vault?filter=categories': '分类', '/vault?filter=favorites': '收藏夹',
      '/vault?filter=recent': '最近使用', '/vault?filter=trash': '回收站', '/projects': '项目',
      '/generator': '密码生成器', '/health': '凭证健康', '/settings': '设置', '/about': '关于',
    }[route]
    await page.getByRole('heading', { name: heading, exact: true }).waitFor()
    await page.locator('.n-spin-body:visible').waitFor({ state: 'hidden' })
    await settle()
  }
  async function geometry() {
    return page.evaluate(() => {
      const content = document.querySelector('.page-content')
      const scroll = document.querySelector('.workspace-scroll')
      const sidebar = document.querySelector('.n-layout-sider')
      const bounds = content.getBoundingClientRect()
      const style = getComputedStyle(content)
      const available = bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const blocks = [...content.querySelectorAll('.filters,.item-list,.settings-grid,.about-content,.generator-card')]
      return {
        viewport: innerWidth,
        collapsed: sidebar.classList.contains('n-layout-sider--collapsed'),
        sidebarWidth: sidebar.getBoundingClientRect().width,
        contentWidth: bounds.width,
        horizontalOverflow: Math.max(document.documentElement.scrollWidth - innerWidth, scroll.scrollWidth - scroll.clientWidth),
        unusedWidths: blocks.map(block => ({ className: block.className, width: available - block.getBoundingClientRect().width })),
        overflowingRows: [...content.querySelectorAll('.item-row')].filter(row => {
          const main = row.querySelector('.item-main'), actions = row.querySelector('.item-actions')
          return main.scrollWidth > main.clientWidth + 1 || actions.getBoundingClientRect().right > row.getBoundingClientRect().right + 1
        }).length,
      }
    })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await visit('/projects')
  await visit('/vault')
  if ((await geometry()).collapsed) await page.locator('.n-layout-toggle-button').click()
  await settle()
  const expanded = await geometry()
  await page.locator('.n-layout-toggle-button').click()
  await settle()
  const collapsed = await geometry()
  assert.equal(collapsed.collapsed, true)
  assert.ok(Math.abs((collapsed.contentWidth - expanded.contentWidth) - (expanded.sidebarWidth - collapsed.sidebarWidth)) < 2,
    'Collapsing the sidebar must return its full width to page content')
  assert.ok(collapsed.unusedWidths.every(block => Math.abs(block.width) < 2), JSON.stringify(collapsed))
  await visit('/projects')
  assert.equal((await geometry()).collapsed, true, 'Manual sidebar state must survive route changes')

  for (const width of [1920, 1440, 1200, 1050, 900]) {
    await page.setViewportSize({ width, height: 760 })
    for (const route of routes) {
      await visit(route)
      const result = await geometry()
      assert.ok(result.horizontalOverflow <= 1, `${width}px ${route}: horizontal overflow ${JSON.stringify(result)}`)
      assert.equal(result.overflowingRows, 0, `${width}px ${route}: credential content must fit beside its actions`)
      assert.ok(result.unusedWidths.every(block => Math.abs(block.width) < 2), `${width}px ${route}: fixed width constraint ${JSON.stringify(result)}`)
      if (width <= 1050) assert.equal(result.collapsed, true, `${width}px should auto-collapse the sidebar`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await visit('/vault')
  await page.screenshot({ path: resolve(screenshotDirectory, 'responsive-vault-wide.png') })
  await page.setViewportSize({ width: 900, height: 600 })
  await visit('/settings')
  const before = await page.locator('.topbar').boundingBox()
  await page.locator('.workspace-scroll').evaluate(element => { element.scrollTop = 500 })
  const after = await page.locator('.topbar').boundingBox()
  assert.equal(after.y, before.y, 'The toolbar must stay visible while page content scrolls')
  await page.screenshot({ path: resolve(screenshotDirectory, 'responsive-settings-900.png') })
  await page.setViewportSize({ width: 1200, height: 760 })
  await visit('/vault')
}

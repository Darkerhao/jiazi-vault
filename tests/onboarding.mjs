export async function createVaultThroughUI(page, password) {
  await page.getByRole('heading', { name: '欢迎使用 Jiazi Vault' }).waitFor()
  await page.getByRole('button', { name: '开始创建', exact: true }).click()
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByPlaceholder('确认主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '创建保险库', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目' }).waitFor()
}

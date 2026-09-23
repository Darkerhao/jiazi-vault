import { spawnSync } from 'node:child_process'

if (process.platform === 'win32') {
  const result = spawnSync('dotnet', [
    'publish', 'native/windows-hello/WindowsHello.csproj', '-c', 'Release', '-r', 'win-x64', '-o', 'output/windows-hello',
  ], { stdio: 'inherit', windowsHide: true })
  if (result.error) console.error('构建 Windows Hello 组件需要 .NET 9 SDK。')
  process.exitCode = result.status ?? 1
}

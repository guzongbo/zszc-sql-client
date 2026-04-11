import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const frontendDir = path.join(repoRoot, 'frontend')
const distIndex = path.join(frontendDir, 'dist', 'index.html')

if (existsSync(distIndex)) {
  console.log('frontend dist 已存在，跳过构建')
  process.exit(0)
}

console.log('frontend dist 不存在，开始构建前端')

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(command, ['run', 'build'], {
  cwd: frontendDir,
  stdio: 'inherit',
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

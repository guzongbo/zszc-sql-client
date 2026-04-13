import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const supportedModes = {
  host: 'package',
  'mac-apple': 'package:mac-apple',
  'mac-intel': 'package:mac-intel',
  windows: 'package:windows',
  all: 'package:all',
}

const pluginDirs = [
  'plugins/password-util-plugin',
  'plugins/mock-id-generator-plugin',
  'plugins/dingtalk-contact-change-plugin',
]

const mode = process.argv[2] ?? 'host'
const scriptName = supportedModes[mode]

if (!scriptName) {
  throw new Error(`不支持的插件打包模式: ${mode}`)
}

for (const pluginDir of pluginDirs) {
  const absolutePluginDir = path.join(repoRoot, pluginDir)
  console.log(`开始执行 ${pluginDir} ${scriptName}`)
  runCommand('npm', ['run', scriptName], absolutePluginDir)
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 执行失败`)
  }
}

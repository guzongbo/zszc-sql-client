import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { zipSync } from 'fflate'

import { packagePlugin } from '../shared/package-plugin-lib.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

await packagePlugin({
  pluginId: 'internal.mock-id-generator',
  pluginName: '随机信息与密码工具',
  pluginVersion: '1.0.0',
  description: '随机信息、密码、密码短语与用户名生成工具',
  backendBinaryName: 'mock-id-generator-plugin',
  rootDir: __dirname,
  zipSync,
})

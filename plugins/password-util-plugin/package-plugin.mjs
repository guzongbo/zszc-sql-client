import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { zipSync } from 'fflate'

import { packagePlugin } from '../shared/package-plugin-lib.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

await packagePlugin({
  pluginId: 'internal.password-util',
  pluginName: '密码工具',
  pluginVersion: '1.0.0',
  description: '密码解密与数据库密文生成工具',
  backendBinaryName: 'password-util-plugin',
  rootDir: __dirname,
  zipSync,
})

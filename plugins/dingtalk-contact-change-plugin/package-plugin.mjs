import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { zipSync } from 'fflate'

import { packagePlugin } from '../shared/package-plugin-lib.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

await packagePlugin({
  pluginId: 'internal.dingtalk-contact-change',
  pluginName: '钉钉通讯录变动查询',
  pluginVersion: '1.0.0',
  description: '钉钉通讯录配置管理、变动查询与历史记录插件',
  backendBinaryName: 'dingtalk-contact-change-plugin',
  rootDir: __dirname,
  zipSync,
})

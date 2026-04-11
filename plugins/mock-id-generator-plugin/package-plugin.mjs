import { spawnSync } from 'node:child_process'
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pluginId = 'internal.mock-id-generator'
const pluginName = '随机信息与密码工具'
const pluginVersion = '1.0.0'
const backendBinaryName = 'mock-id-generator-plugin'

const platformConfig = {
  'darwin-aarch64': {
    cargoTarget: 'aarch64-apple-darwin',
    binaryName: backendBinaryName,
  },
  'darwin-x86_64': {
    cargoTarget: 'x86_64-apple-darwin',
    binaryName: backendBinaryName,
  },
  'windows-x86_64': {
    cargoTarget: 'x86_64-pc-windows-msvc',
    binaryName: `${backendBinaryName}.exe`,
  },
}

const rootDir = __dirname
const frontendDir = path.join(rootDir, 'frontend')
const backendDir = path.join(rootDir, 'backend')
const outputDir = path.join(rootDir, 'dist')
const stagingDir = path.join(rootDir, '.plugin-package')
const packagePath = path.join(outputDir, 'mock-id-generator-plugin.zszc-plugin')

const currentPlatform = detectPlatform()
const targetsToBuild = parseTargets()

await rm(outputDir, { recursive: true, force: true })
await rm(stagingDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
await mkdir(stagingDir, { recursive: true })

runCommand('npm', ['run', 'build'], frontendDir)

for (const platform of targetsToBuild) {
  const config = platformConfig[platform]
  if (!config) {
    throw new Error(`不支持的平台: ${platform}`)
  }

  const args = ['build', '--release', '--manifest-path', path.join(backendDir, 'Cargo.toml')]
  if (platform !== currentPlatform) {
    args.push('--target', config.cargoTarget)
  }
  runCommand('cargo', args, rootDir)
}

const backendEntries = {}
for (const [platform, config] of Object.entries(platformConfig)) {
  const binaryPath = await resolveBackendBinary(platform, config)
  if (!binaryPath) {
    continue
  }

  const relativeTargetPath = path.join('backend', platform, config.binaryName)
  backendEntries[platform] = relativeTargetPath.replaceAll(path.sep, '/')

  const fileBuffer = await readFile(binaryPath)
  await writePackageFile(path.join(stagingDir, relativeTargetPath), fileBuffer)
}

const frontendDistDir = path.join(frontendDir, 'dist')
await copyDirectory(frontendDistDir, path.join(stagingDir, 'frontend'))

const manifest = {
  schema_version: 1,
  id: pluginId,
  name: pluginName,
  version: pluginVersion,
  kind: 'tool',
  description: '随机信息、密码、密码短语与用户名生成工具',
  icon: null,
  frontend_entry: 'frontend/index.html',
  workspace_mode: 'full_workspace',
  backend: {
    required: true,
    startup: 'on_demand',
    entry_by_platform: backendEntries,
  },
  permissions: ['full'],
  host_api_version: 1,
  min_host_version: '0.1.0',
}

await writePackageFile(
  path.join(stagingDir, 'plugin.json'),
  Buffer.from(JSON.stringify(manifest, null, 2)),
)

const zipEntries = {}
await collectZipEntries(stagingDir, '', zipEntries)
await writeFile(packagePath, zipSync(zipEntries, { level: 9 }))
await rm(stagingDir, { recursive: true, force: true })

console.log(`插件安装包已生成: ${packagePath}`)

function detectPlatform() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'darwin-aarch64'
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'darwin-x86_64'
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'windows-x86_64'
  }
  throw new Error(`当前打包机平台不受支持: ${process.platform}-${process.arch}`)
}

function parseTargets() {
  const raw = process.env.PLUGIN_BUILD_TARGETS?.trim()
  if (!raw) {
    return [currentPlatform]
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function resolveBackendBinary(platform, config) {
  const inReleaseDir =
    platform === currentPlatform
      ? path.join(backendDir, 'target', 'release', config.binaryName)
      : path.join(backendDir, 'target', config.cargoTarget, 'release', config.binaryName)

  try {
    await access(inReleaseDir)
  } catch {
    return null
  }

  return inReleaseDir
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

async function writePackageFile(targetPath, content) {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content)
}

async function copyDirectory(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath)
      continue
    }

    await writePackageFile(targetPath, await readFile(sourcePath))
  }
}

async function collectZipEntries(sourceDir, relativePath, zipEntries) {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const nextRelativePath = relativePath
      ? path.posix.join(relativePath, entry.name)
      : entry.name

    if (entry.isDirectory()) {
      zipEntries[`${nextRelativePath}/`] = new Uint8Array()
      await collectZipEntries(sourcePath, nextRelativePath, zipEntries)
      continue
    }

    const fileStat = await stat(sourcePath)
    if (!fileStat.isFile()) {
      continue
    }

    const fileContent = await readFile(sourcePath)
    zipEntries[nextRelativePath] = new Uint8Array(fileContent)
  }
}

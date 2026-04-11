import { spawnSync } from 'node:child_process'
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const platformConfig = {
  'darwin-aarch64': {
    cargoTarget: 'aarch64-apple-darwin',
    platformLabel: 'mac Apple',
  },
  'darwin-x86_64': {
    cargoTarget: 'x86_64-apple-darwin',
    platformLabel: 'mac Intel',
  },
  'windows-x86_64': {
    cargoTarget: 'x86_64-pc-windows-msvc',
    platformLabel: 'Windows x64',
  },
}

const targetAliasMap = {
  all: Object.keys(platformConfig),
  'mac-apple': ['darwin-aarch64'],
  'mac-intel': ['darwin-x86_64'],
  windows: ['windows-x86_64'],
  'darwin-aarch64': ['darwin-aarch64'],
  'darwin-x86_64': ['darwin-x86_64'],
  'windows-x86_64': ['windows-x86_64'],
}

export async function packagePlugin({
  backendBinaryName,
  description,
  pluginId,
  pluginName,
  pluginVersion,
  rootDir,
  zipSync,
}) {
  const frontendDir = path.join(rootDir, 'frontend')
  const backendDir = path.join(rootDir, 'backend')
  const outputDir = path.join(rootDir, 'dist')
  const stagingDir = path.join(rootDir, '.plugin-package')
  const packagePath = path.join(outputDir, `${path.basename(rootDir)}.zszc-plugin`)

  const targetsToBuild = parseTargets(process.argv.slice(2))

  await rm(outputDir, { recursive: true, force: true })
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await mkdir(stagingDir, { recursive: true })

  runCommand('npm', ['run', 'build'], frontendDir)

  for (const platform of targetsToBuild) {
    const config = getPlatformConfig(platform, backendBinaryName)
    const { command, args, env } = createBuildCommand({
      backendDir,
      config,
      platform,
    })
    console.log(`开始构建 ${pluginName} ${config.platformLabel} 后端`)
    runCommand(command, args, rootDir, env)
  }

  const backendEntries = {}
  for (const platform of targetsToBuild) {
    const config = getPlatformConfig(platform, backendBinaryName)
    const binaryPath = await resolveBackendBinary(backendDir, config)
    const relativeTargetPath = path.join('backend', platform, config.binaryName)
    backendEntries[platform] = relativeTargetPath.replaceAll(path.sep, '/')

    const fileBuffer = await readFile(binaryPath)
    await writePackageFile(path.join(stagingDir, relativeTargetPath), fileBuffer)
  }

  await copyDirectory(path.join(frontendDir, 'dist'), path.join(stagingDir, 'frontend'))

  const manifest = {
    schema_version: 1,
    id: pluginId,
    name: pluginName,
    version: pluginVersion,
    kind: 'tool',
    description,
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
}

function getPlatformConfig(platform, backendBinaryName) {
  const baseConfig = platformConfig[platform]
  if (!baseConfig) {
    throw new Error(`不支持的平台: ${platform}`)
  }

  return {
    ...baseConfig,
    binaryName: platform.startsWith('windows-')
      ? `${backendBinaryName}.exe`
      : backendBinaryName,
  }
}

function detectCurrentPlatform() {
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

function parseTargets(argv) {
  const cliTargets = collectCliTargets(argv)
  const envTargets = parseRawTargets(process.env.PLUGIN_BUILD_TARGETS)
  const requestedTargets =
    cliTargets.length > 0
      ? cliTargets
      : envTargets.length > 0
        ? envTargets
        : [detectCurrentPlatform()]

  const expandedTargets = []
  const seen = new Set()

  for (const target of requestedTargets) {
    const normalizedTargets = targetAliasMap[target]
    if (!normalizedTargets) {
      throw new Error(`不支持的打包目标: ${target}`)
    }

    for (const normalizedTarget of normalizedTargets) {
      if (seen.has(normalizedTarget)) {
        continue
      }
      seen.add(normalizedTarget)
      expandedTargets.push(normalizedTarget)
    }
  }

  return expandedTargets
}

function collectCliTargets(argv) {
  const targets = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--target') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('缺少 --target 的取值')
      }
      targets.push(...parseRawTargets(nextValue))
      index += 1
      continue
    }

    if (arg.startsWith('--target=')) {
      targets.push(...parseRawTargets(arg.slice('--target='.length)))
    }
  }

  return targets
}

function parseRawTargets(raw) {
  if (!raw?.trim()) {
    return []
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function createBuildCommand({ backendDir, config, platform }) {
  const manifestPath = path.join(backendDir, 'Cargo.toml')
  const args = ['build', '--release', '--manifest-path', manifestPath, '--target', config.cargoTarget]

  if (platform === 'windows-x86_64' && process.platform !== 'win32') {
    return {
      command: 'cargo',
      args: ['xwin', ...args],
      env: buildWindowsCrossEnv(),
    }
  }

  return {
    command: 'cargo',
    args,
    env: process.env,
  }
}

function buildWindowsCrossEnv() {
  const env = { ...process.env }
  const toolchainBins = []

  if (process.platform === 'darwin') {
    for (const formula of ['lld', 'llvm']) {
      const prefix = readCommandOutput('brew', ['--prefix', formula])
      if (!prefix) {
        continue
      }
      toolchainBins.push(path.join(prefix, 'bin'))
    }
  }

  if (toolchainBins.length > 0) {
    env.PATH = `${toolchainBins.join(path.delimiter)}${path.delimiter}${env.PATH ?? ''}`
  }

  return env
}

function readCommandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  if (result.status !== 0) {
    return null
  }

  return result.stdout.trim() || null
}

async function resolveBackendBinary(backendDir, config) {
  const binaryPath = path.join(
    backendDir,
    'target',
    config.cargoTarget,
    'release',
    config.binaryName,
  )
  await access(binaryPath)
  return binaryPath
}

function runCommand(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env,
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

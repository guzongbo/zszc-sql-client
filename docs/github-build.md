# GitHub 构建说明

本文档记录 `zszc-sql-client` 当前在 GitHub Actions 上的构建与出包流程。

## Workflow 列表

- `.github/workflows/ci.yml`
  - 面向日常 `push`、`pull_request`
  - 检查前端与桌面端
  - 检查各个插件的前端构建与 Rust 后端测试
- `.github/workflows/desktop-package.yml`
  - 面向桌面本体出包
  - 通过 `workflow_dispatch` 手动触发
  - 分别产出 `mac Apple`、`mac Intel`、`Windows x64` 安装包
- `.github/workflows/plugins-package.yml`
  - 面向插件安装包出包
  - 通过 `workflow_dispatch` 手动触发
  - 为每个插件产出一个包含 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64` 后端的 `.zszc-plugin`

## Runner 选择

- 桌面本体
  - `macos-14`：用于 `mac Apple`
  - `macos-15-intel`：用于 `mac Intel`
  - `windows-2022`：用于 `Windows x64`
- 插件打包
  - `macos-14`
  - 通过 Rust target 与 `cargo-xwin` 在单个 job 内完成 `mac Apple`、`mac Intel`、`Windows x64` 三端后端构建

## Artifact 产物

- 桌面本体
  - `zszc-sql-client-mac-arm64-dmg`
  - `zszc-sql-client-mac-x64-dmg`
  - `zszc-sql-client-win-x64-nsis`
- 插件
  - `password-util-plugin`
  - `mock-id-generator-plugin`

## 维护约定

- 新增插件时，需要同时更新：
  - `.github/workflows/ci.yml`
  - `.github/workflows/plugins-package.yml`
  - 根目录 `scripts/package-plugins.mjs`
- 若桌面端新增 Linux 发行目标，再单独补 Linux runner 与系统依赖，不混入现有 macOS / Windows 产线。

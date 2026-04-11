# macOS 交叉打包 Windows

本文档记录 `zszc-sql-client` 在 macOS 上交叉打包 `Windows x64 NSIS` 安装包的最小要求与命令。

## 背景

- Tauri 在 Windows 上原生支持 `.msi` 与 `NSIS`。
- 在 macOS / Linux 上交叉打包时，官方仅给出 `NSIS` 方案。
- 当前仓库基础配置的 `bundle.targets` 为 `"all"`，这对 macOS 上的 Windows 交叉打包不合适，因此新增了 `desktop/src-tauri/tauri.windows.conf.json` 覆盖为 `nsis`。

## 当前脚本

在仓库根目录执行：

```bash
npm --prefix desktop run build:win-x64-nsis
```

该脚本实际展开为：

```bash
PATH="$(brew --prefix lld)/bin:$(brew --prefix llvm)/bin:$PATH" \
tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --config src-tauri/tauri.windows.conf.json
```

## 前置依赖

在 macOS 上需要先安装以下依赖：

```bash
brew install nsis llvm
cargo install --locked cargo-xwin
rustup target add x86_64-pc-windows-msvc
```

如果你绕过 npm 脚本直接执行 `tauri build`，还需要确保 LLVM / LLD 在 `PATH` 中：

```bash
export PATH="/opt/homebrew/opt/lld/bin:/opt/homebrew/opt/llvm/bin:$PATH"
```

如果希望多个项目共享 Windows SDK 缓存，可选设置：

```bash
export XWIN_CACHE_DIR="$HOME/.cache/xwin"
```

## 产物目录

成功后产物位于：

```bash
target/x86_64-pc-windows-msvc/release/bundle/nsis/
```

## 注意事项

- 该方案属于 Tauri 官方注明的“有条件可行”方案，稳定性不如直接在 Windows 主机或 CI 上构建。
- 跨平台生成的 Windows 安装包签名需要额外的外部签名工具。
- 如需 `MSI`，仍建议在 Windows 主机或 Windows CI 中构建。

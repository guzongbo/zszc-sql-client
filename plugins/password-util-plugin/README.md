# Password Util Plugin

`password-util-plugin` 是 `zszc-sql-client` 第一版插件样板。

## 结构

- `frontend`：React + TypeScript 插件前端，最终会被宿主以内嵌 `iframe` 的方式加载
- `backend`：Rust 独立进程后端，通过 `stdio JSON-RPC` 和宿主通信
- `package-plugin.mjs`：打包为 `.zszc-plugin` 安装包

## 快速打包

```bash
cd plugins/password-util-plugin/frontend
npm install

cd ../
npm install
npm run package
```

默认会：

1. 构建插件前端
2. 构建当前平台的 Rust 后端
3. 生成 `dist/password-util-plugin.zszc-plugin`

## 多平台打包

如果需要明确打出 `mac Apple`、`mac Intel`、`Windows` 或三端合包，直接使用内置脚本：

```bash
npm run package:mac-apple
npm run package:mac-intel
npm run package:windows
npm run package:all
```

其中：

- `package:mac-apple` 只打 `darwin-aarch64`
- `package:mac-intel` 只打 `darwin-x86_64`
- `package:windows` 只打 `windows-x86_64`
- `package:all` 会把三个平台后端一起打进同一个 `.zszc-plugin`

如需兼容旧流程，仍可通过环境变量指定：

```bash
PLUGIN_BUILD_TARGETS=darwin-aarch64,darwin-x86_64,windows-x86_64 npm run package
```

当前支持的平台标识：

- `darwin-aarch64`
- `darwin-x86_64`
- `windows-x86_64`

## 交叉编译说明

- macOS 打 `mac Intel`：先执行 `rustup target add x86_64-apple-darwin`
- macOS 打 `Windows`：先执行 `rustup target add x86_64-pc-windows-msvc`
- 非 Windows 主机打 `Windows`：额外需要 `cargo install --locked cargo-xwin`
- 在仓库根目录可统一打全部插件：

```bash
npm run package:plugins:all
```

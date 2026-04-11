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

如果需要把多个平台二进制打进同一个插件包，可先安装对应 Rust target，然后通过环境变量指定：

```bash
PLUGIN_BUILD_TARGETS=darwin-aarch64,darwin-x86_64,windows-x86_64 npm run package
```

当前打包脚本支持的平台标识：

- `darwin-aarch64`
- `darwin-x86_64`
- `windows-x86_64`

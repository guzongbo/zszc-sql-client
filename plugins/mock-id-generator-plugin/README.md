# Mock ID Generator Plugin

`mock-id-generator-plugin` 将原来的 `mock-id-generator` 独立项目改造成 `zszc-sql-client` 插件，并补充为一个组合工具工作区。

## 当前能力

- 随机信息生成：姓名、统一社会信用代码、身份证号、银行卡号、手机号、邮箱、住址
- 密码生成：支持长度、大小写、数字、符号、最少数字数、最少符号数、避免易混淆字符
- 密码短语生成：支持单词数、分隔符、首字母大写、追加数字
- 用户名生成：支持长度、风格、分隔符、数字后缀、避免易混淆字符

## 结构

- `frontend`：React + TypeScript 插件前端，通过宿主 iframe 加载
- `backend`：Rust 独立进程后端，通过 `stdio JSON-RPC` 与宿主通信
- `package-plugin.mjs`：打包为 `.zszc-plugin` 安装包

## 快速打包

```bash
cd plugins/mock-id-generator-plugin/frontend
npm install

cd ../
npm install
npm run package
```

默认会：

1. 构建插件前端
2. 构建当前平台的 Rust 后端
3. 生成 `dist/mock-id-generator-plugin.zszc-plugin`

## 多平台打包

可直接使用以下脚本：

```bash
npm run package:mac-apple
npm run package:mac-intel
npm run package:windows
npm run package:all
```

其中 `package:all` 会把 `mac Apple`、`mac Intel`、`Windows x64` 三个平台后端一起打进同一个插件包。

如果你已有旧流程，也可以继续通过环境变量指定：

```bash
PLUGIN_BUILD_TARGETS=darwin-aarch64,darwin-x86_64,windows-x86_64 npm run package
```

## 交叉编译说明

- macOS 打 `mac Intel`：先执行 `rustup target add x86_64-apple-darwin`
- macOS 打 `Windows`：先执行 `rustup target add x86_64-pc-windows-msvc`
- 非 Windows 主机打 `Windows`：额外需要 `cargo install --locked cargo-xwin`
- 在仓库根目录可统一打全部插件：

```bash
npm run package:plugins:all
```

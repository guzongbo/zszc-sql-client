# 插件开发说明

本文档面向 `zszc-sql-client` 当前版本的插件体系，说明一个插件从目录组织、前后端实现到打包安装的完整流程。当前宿主包含 `MySQL` 内置工作区、`Redis` 内置工作区和插件工作区三类能力，本文档聚焦插件工作区本身。本文档基于仓库现有宿主实现整理，不是抽象设计稿。

## 1. 先理解当前插件模型

当前插件体系的核心约束如下：

- 宿主当前同时提供 `MySQL` 内置工作区、`Redis` 内置工作区和插件工作区
- 插件以“工作区”的形式挂载到宿主顶部工作区切换器
- 切换到插件后，顶部栏以下区域由插件前端整块接管
- 插件前端使用 `React + TypeScript`
- 插件后端使用 `Rust` 独立进程
- 宿主与插件后端之间通过 `stdio JSON-RPC` 通信
- 插件安装包扩展名固定为 `.zszc-plugin`
- 安装包本质是一个 `zip`，根目录必须包含 `plugin.json`

当前宿主只接受以下固定组合：

- `kind = "tool"`
- `workspace_mode = "full_workspace"`
- `backend.startup = "on_demand"`
- `permissions = ["full"]`
- `schema_version = 1`
- `host_api_version = 1`

如果插件清单不符合这些约束，宿主会在安装或加载时直接拒绝。

## 2. 推荐目录结构

仓库里的两个样板插件都采用同一套结构，建议直接复用：

```text
plugins/your-plugin/
├── backend/
│   ├── Cargo.toml
│   └── src/main.rs
├── frontend/
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── dist/
├── package-plugin.mjs
├── package.json
└── README.md
```

对应职责：

- `frontend`：插件界面，最终构建为静态资源
- `backend`：插件业务后端，编译为独立可执行文件
- `package-plugin.mjs`：声明插件元信息并调用共享打包库
- `dist`：输出 `.zszc-plugin` 安装包

建议直接参考以下样板：

- [`plugins/password-util-plugin/README.md`](../plugins/password-util-plugin/README.md)
- [`plugins/mock-id-generator-plugin/README.md`](../plugins/mock-id-generator-plugin/README.md)
- [`docs/plugins/README.md`](./plugins/README.md)

## 3. 插件清单 `plugin.json`

宿主会从安装包根目录读取 `plugin.json`。推荐结构如下：

```json
{
  "schema_version": 1,
  "id": "internal.example-plugin",
  "name": "示例插件",
  "version": "1.0.0",
  "kind": "tool",
  "description": "示例插件说明",
  "icon": null,
  "frontend_entry": "frontend/index.html",
  "workspace_mode": "full_workspace",
  "backend": {
    "required": true,
    "startup": "on_demand",
    "entry_by_platform": {
      "darwin-aarch64": "backend/darwin-aarch64/example-plugin",
      "darwin-x86_64": "backend/darwin-x86_64/example-plugin",
      "windows-x86_64": "backend/windows-x86_64/example-plugin.exe"
    }
  },
  "permissions": ["full"],
  "host_api_version": 1,
  "min_host_version": "0.1.0"
}
```

字段说明：

- `id`：插件唯一标识，只能使用合法插件 ID
- `frontend_entry`：插件前端入口 HTML，相对插件根目录
- `backend.entry_by_platform`：不同平台下的后端可执行文件路径
- `icon`：可选图标路径；如果声明了，文件必须真实存在

宿主安装后会把插件放到：

- 安装目录：`app_data_dir/plugins/<plugin_id>/`
- 数据目录：`app_data_dir/plugin_data/<plugin_id>/`

## 4. 前端怎么和宿主通信

插件前端最终由宿主以内嵌页面的方式加载。推荐直接复用样板插件中的桥接模式：

- 首次加载后，向父窗口发送 `plugin_ready`
- 等待宿主回传 `bootstrap`
- 通过 `rpc_request` 请求宿主转发到插件后端

前端消息通道固定为 `zszc_plugin_host`。

### 启动握手

```ts
window.parent.postMessage(
  {
    channel: 'zszc_plugin_host',
    kind: 'plugin_ready',
  },
  '*',
)
```

宿主随后会回传：

```ts
type HostBootstrap = {
  plugin_id: string
  plugin_name: string
  plugin_version: string
  current_platform: string
  permissions: string[]
}
```

### 调用插件后端

推荐封装一个统一调用方法：

```ts
window.parent.postMessage(
  {
    channel: 'zszc_plugin_host',
    kind: 'rpc_request',
    request_id: 'req-1',
    method: 'password.decrypt',
    params: {
      encrypted_text: 'xxxx'
    },
  },
  '*',
)
```

返回结果由宿主回传：

```ts
{
  channel: 'zszc_plugin_host',
  kind: 'rpc_response',
  request_id: 'req-1',
  ok: true,
  result: {
    plain_text: 'demo'
  }
}
```

实际代码可直接参考：

- [`plugins/password-util-plugin/frontend/src/hostBridge.ts`](../plugins/password-util-plugin/frontend/src/hostBridge.ts)

## 5. 后端怎么和宿主通信

插件后端是一个被宿主按需拉起的 Rust 可执行进程。宿主启动时会：

- 传入 `--stdio`
- 通过标准输入写入一行一条的 JSON 请求
- 通过标准输出读取一行一条的 JSON 响应

### 请求格式

```json
{
  "id": "request-id",
  "method": "password.decrypt",
  "params": {
    "encrypted_text": "xxxx"
  }
}
```

### 响应格式

成功：

```json
{
  "id": "request-id",
  "result": {
    "plain_text": "demo"
  }
}
```

失败：

```json
{
  "id": "request-id",
  "error": {
    "message": "参数错误"
  }
}
```

后端实现建议：

- 只在 `main` 中处理协议收发与错误包装
- 真正业务逻辑拆到独立函数
- 参数与返回结构统一使用 `snake_case`
- 对关键算法或兼容逻辑加简短注释

完整参考：

- [`plugins/password-util-plugin/backend/src/main.rs`](../plugins/password-util-plugin/backend/src/main.rs)

## 6. 宿主会注入哪些环境变量

宿主拉起插件后端时会注入以下环境变量：

- `ZSZC_PLUGIN_ID`
- `ZSZC_PLUGIN_INSTALL_DIR`
- `ZSZC_PLUGIN_DATA_DIR`
- `ZSZC_PLUGIN_PLATFORM`
- `ZSZC_PLUGIN_HOST_VERSION`

如果插件需要本地缓存、临时文件或私有数据库，优先写入 `ZSZC_PLUGIN_DATA_DIR` 对应目录，不要把数据写回安装目录。

## 7. 如何打包成 `.zszc-plugin`

当前仓库已经提供统一打包库：`plugins/shared/package-plugin-lib.mjs`。推荐做法是每个插件提供一个很薄的 `package-plugin.mjs`，只声明元信息：

```js
await packagePlugin({
  pluginId: 'internal.example-plugin',
  pluginName: '示例插件',
  pluginVersion: '1.0.0',
  description: '示例插件说明',
  backendBinaryName: 'example-plugin',
  rootDir: __dirname,
  zipSync,
})
```

打包时共享库会自动完成以下步骤：

1. 构建插件前端
2. 按目标平台构建 Rust 后端
3. 生成 `plugin.json`
4. 组装 `frontend/` 与 `backend/<platform>/...`
5. 打包输出为 `.zszc-plugin`

## 8. 开发步骤建议

### 第一步：复制一个样板插件

最稳妥的方式不是从零新建，而是复制现有样板后改名：

- `plugins/password-util-plugin`
- `plugins/mock-id-generator-plugin`

优先修改：

- 根目录名
- `backend/Cargo.toml` 包名
- `package-plugin.mjs` 中的 `pluginId`、`pluginName`、`backendBinaryName`
- 前端标题与业务代码

### 第二步：实现前端页面

要求：

- 构建产物最终能生成 `frontend/dist/index.html`
- 页面通过桥接层接收宿主 `bootstrap`
- 所有后端调用都走统一桥接方法

### 第三步：实现 Rust 后端

要求：

- 支持 `--stdio`
- 每次读取一行 JSON 请求
- 每次输出一行 JSON 响应
- 错误统一序列化为 `error.message`

### 第四步：执行打包

在插件目录执行：

```bash
npm install
npm run package
```

如果需要多平台打包，可执行：

```bash
npm run package:mac-apple
npm run package:mac-intel
npm run package:windows
npm run package:all
```

也可以在仓库根目录统一打包全部插件：

```bash
npm run package:plugins:all
```

## 9. 安装与调试

推荐调试流程：

1. 在插件目录先确保前端和 Rust 后端都能独立构建成功
2. 执行 `npm run package` 生成 `.zszc-plugin`
3. 启动桌面端：`npm run dev:desktop`
4. 在宿主插件管理界面中从磁盘安装插件
5. 切换到插件工作区验证界面加载、桥接通信和后端调用

排查重点：

- `plugin.json` 字段是否满足宿主固定约束
- `frontend_entry` 路径是否真实存在
- 当前平台对应的后端二进制是否被正确打包
- 后端是否真的使用逐行 `stdin/stdout` 通信
- 返回字段是否保持 `snake_case`

## 10. 当前已知边界

在当前版本里，插件系统仍有一些明确边界，开发时需要提前考虑：

- 插件是完整工作区，不是按钮级别的小扩展
- 插件不直接接管主应用 MySQL 主线业务
- 宿主 API 还比较薄，主要提供工作区加载与后端转发
- 插件权限模型目前还是固定值，暂时没有细粒度权限分配

如果后续宿主扩展了更多桥接能力，建议同步更新本文件，而不是只改样板插件。

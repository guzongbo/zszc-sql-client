# zszc-sql-client

`zszc-sql-client` 是一个基于 `Rust + React + Tauri + SQLite` 的 MySQL 客户端桌面应用，当前仓库同时承载主应用与插件体系样板。

## 项目定位

- 面向 MySQL 场景的桌面客户端
- 前端与桌面端复用同一套 React UI
- 本地使用 SQLite 保存连接配置、历史记录与工作区相关数据
- 通过插件工作区扩展宿主能力

## 当前包含的功能

### 数据源与连接管理

- MySQL 连接配置新增、编辑、删除、测试
- 数据源分组管理
- Navicat `.ncx` 连接导入
- 数据库、表列表浏览

### SQL 与数据操作

- Monaco SQL 编辑器
- SQL 自动补全元数据加载
- 查询与变更语句执行
- 查询结果分页查看
- 表数据分页浏览、筛选与主键表增删改
- 表结构读取、DDL 查看、建表与结构编辑
- 提交前 SQL 预览

### 对比能力

- 数据对比任务执行、进度轮询、取消任务
- 数据对比差异详情分页查看
- 数据对比同步 SQL 导出
- 结构对比结果查看与 SQL 导出
- 对比历史记录本地保存

### 其他工作区

- Redis 工作区能力骨架
- 插件管理与插件工作区切换
- 已内置两个插件样板：
  - `plugins/password-util-plugin`
  - `plugins/mock-id-generator-plugin`

## 仓库结构

- `frontend`：React + Vite 前端界面
- `desktop`：Tauri 桌面壳与 Rust 本地能力
- `backend`：预留目录，当前阶段不启用独立服务
- `plugins`：插件样板、打包脚本与共享打包库
- `docs`：架构、原型、构建与插件相关文档

## 开发命令

```bash
npm run dev:web
npm run dev:desktop
npm run build:web
npm run build:desktop
npm run package:plugins
npm run package:plugins:all
```

## 相关文档

- 文档索引：[`docs/README.md`](docs/README.md)
- 插件工作区设计：[`docs/plugin-workspace-design.md`](docs/plugin-workspace-design.md)
- 插件开发文档：[`docs/plugin-development.md`](docs/plugin-development.md)

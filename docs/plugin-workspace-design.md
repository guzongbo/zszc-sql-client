# 插件工作区设计

本文档记录 `zszc-sql-client` 第一版插件系统的落地约束。

## 目标

- 现有数据库客户端功能继续内置
- 插件通过顶部工作区切换器切换
- 切换后，顶部栏以下的整块页面由插件接管
- 插件不访问 MySQL 主线能力，但允许访问系统能力

## 宿主模型

- 宿主：`desktop/src-tauri`
- 前端主壳：`frontend`
- 插件前端：`React + TypeScript`
- 插件后端：`Rust` 独立进程
- 通信：`stdio JSON-RPC`

## 工作区切换

- 顶部栏提供工作区下拉
- 内置工作区固定包含：`数据库客户端`
- 已安装插件会加入下拉列表
- 选中插件后，顶部栏以下只渲染插件页面
- 插件管理按钮位于顶部栏右侧

## 插件安装包

- 扩展名：`.zszc-plugin`
- 本质格式：`zip`
- 根目录必须包含 `plugin.json`

示例结构：

```text
password-util-plugin.zszc-plugin
├── plugin.json
├── frontend/
│   ├── index.html
│   └── assets/...
└── backend/
    ├── darwin-aarch64/password-util-plugin
    ├── darwin-x86_64/password-util-plugin
    └── windows-x86_64/password-util-plugin.exe
```

## 插件清单

关键字段：

- `schema_version`
- `id`
- `name`
- `version`
- `kind`
- `description`
- `frontend_entry`
- `workspace_mode`
- `backend.required`
- `backend.startup`
- `backend.entry_by_platform`
- `permissions`
- `host_api_version`
- `min_host_version`

当前固定约束：

- `kind = tool`
- `workspace_mode = full_workspace`
- `backend.startup = on_demand`
- `permissions = ["full"]`

## 运行目录

- 插件安装目录：`app_data_dir/plugins/<plugin_id>/`
- 插件私有数据目录：`app_data_dir/plugin_data/<plugin_id>/`

卸载时会删除以上两个目录。

## 样板插件

首个样板插件目录：

- `plugins/password-util-plugin`

用途：

- 演示插件前端如何通过宿主桥接请求后端
- 演示 Rust 独立进程如何按 `stdio JSON-RPC` 处理业务逻辑
- 演示 `.zszc-plugin` 打包结构

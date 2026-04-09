# 桌面端架构

## 总体结构

- 前端：`frontend`
  - React 单页工作区
  - 同时支持 Web 预览和 Tauri 桌面壳复用
- 桌面端：`desktop/src-tauri`
  - Tauri command 暴露本地能力
  - 本地 SQLite 保存连接配置
  - 直接连接目标 MySQL，不引入本地 HTTP 服务

## Rust 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 应用状态 | `desktop/src-tauri/src/app_state.rs` | 统一挂载本地存储和 MySQL 服务 |
| 本地存储 | `desktop/src-tauri/src/local_store.rs` | 初始化 SQLite，保存连接配置 |
| 数据模型 | `desktop/src-tauri/src/models.rs` | 前后端命令参数和返回结构 |
| MySQL 服务 | `desktop/src-tauri/src/mysql_service.rs` | 连接池、元数据读取、DDL 生成、数据编辑提交 |
| 命令入口 | `desktop/src-tauri/src/commands.rs` | Tauri command 到服务层的桥接 |

## 数据流

1. 前端启动后调用 `get_app_bootstrap` 读取本地 SQLite 和已保存的数据源。
2. 左树按需调用数据库、表、列查询命令，不一次性拉全量元数据。
3. 表结构页通过 `load_table_design` 加载当前字段定义，编辑后走 `preview_table_design_sql` 和 `apply_table_design_changes`。
4. 表数据页通过 `load_table_data` 读取结果集，行改动先在前端草稿层暂存，再走 `preview_table_data_changes` 和 `apply_table_data_changes`。

## 可靠性约束

- 表数据编辑仅对主键表开放提交，避免无主键表误更新。
- 数据编辑和结构编辑都提供 SQL 预览，提交前先展示将执行的语句。
- 左树和标签页都采用懒加载，避免大库初次进入时阻塞。
- 本地 SQLite 只保存连接配置，不缓存远端业务数据。

# AGENTS.md

本文件记录 `zszc-sql-client` 的项目级约束，供后续 Codex / AI 协作时直接复用。

## 项目目标

- 项目定位：MySQL 客户端桌面应用
- 技术栈：Rust + React + Tauri + SQLite
- 当前阶段：初始化工程骨架，后续根据 Calicat 原型推进界面与交互

## 仓库结构

- `backend`：预留目录，当前阶段不启用独立后端服务；仅在未来需要远程同步、账号体系或服务端能力时再接入
- `desktop`：Tauri 桌面壳层，负责窗口、系统能力、本地 SQLite 与桌面分发
- `frontend`：React + Vite 前端界面，供 Web 预览与 Tauri 复用
- `docs`：需求、原型同步、架构设计、交付文档

如果后续出现大量 Rust 共享模型、协议、数据库适配逻辑，再新增 `crates/` 目录抽公共库；当前阶段保留四目录更清晰。

## 开发约定

- 前端开发端口：`1420`
- 核心能力优先通过 Tauri command 暴露给前端，不引入本地 HTTP 服务
- Rust 与前端的数据交互字段统一使用 `snake_case`
- 桌面端本地数据存储使用 SQLite，优先保存连接配置、查询历史、草稿、缓存
- 前端与桌面端共用一套 React UI，不在 `desktop` 内重复维护第二套前端页面

## 原型协作

- 界面实现前，优先通过 Calicat MCP 读取原型、图层和交互信息
- `docs` 中需要沉淀原型映射、页面拆分和组件命名，避免直接跳代码
- 未读取原型前，只允许搭建骨架和通用占位页面，不擅自定义最终交互

## UI 约束

- 视觉基调：偏白透感的幻彩渐变背景 + 玻璃拟态面板
- 字体方向：标题优先 `Noto Serif SC`，正文优先 `Noto Sans SC`
- 页面中保留 `power by wx_guzb_7558`
- 不做深色宝石风默认皮肤，优先浅紫、冰蓝、青绿、粉色、浅金的流动感

## 常用命令

- 启动前端：`npm run dev:web`
- 启动桌面端：`npm run dev:desktop`
- 构建前端：`npm run build:web`
- 构建桌面端：`npm run build:desktop`

## 提交与变更

- 提交信息使用中文
- 未经明确要求，不调整四目录总体布局
- 涉及原型落地的大改前，先在 `docs` 中补设计说明

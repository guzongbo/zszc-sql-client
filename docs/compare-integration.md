# 对比能力集成说明

## 范围

- 结构对比
- 数据对比
- 对比记录
- Navicat `.ncx` 导入并入新增数据源入口

## 前端接入

- 不新建独立应用，继续复用 `frontend/src/App.tsx` 的三栏工作区。
- 左侧工具列新增实际可用入口：`结构对比`、`数据对比`、`对比记录`。
- 新增数据源弹窗 `ProfileEditorView` 在创建模式下提供 `导入 Navicat` 按钮，导入结果直接合并进现有数据源列表。
- 对比页面使用当前项目的深色工作区样式，不复用 `mysql-data-compare` 的独立导航和页面壳层。

## 桌面端接入

- `commands.rs`
  - `import_navicat_connection_profiles`
  - `compare_discover_tables`
  - `compare_run`
  - `compare_start`
  - `compare_progress`
  - `compare_result`
  - `compare_cancel`
  - `load_compare_detail_page`
  - `structure_compare_run`
  - `load_structure_compare_detail`
  - `list_compare_history`
  - `append_compare_history`
- `compare_service.rs`
  - 负责同名表发现、主键优先的数据差异计算、详情分页。
- `compare_task_manager.rs`
  - 负责数据对比异步任务、进度轮询、取消标记。
- `structure_compare_service.rs`
  - 负责表级结构差异判断、DDL 明细与预览 SQL。
- `navicat.rs`
  - 负责 `.ncx` 解析以及 Navicat 密码解密。

## 本地存储

- 连接配置继续落在 `connection_profiles`。
- 新增 `compare_history` 表，用于保存：
  - 源端/目标端数据源与数据库快照
  - 表范围
  - 结构或数据差异统计
  - 性能信息
  - 表级详情摘要
- Navicat 导入按 `data_source_name` 合并：
  - 已存在则更新连接信息
  - 不存在则新增
  - 无法解密密码时保留原密码或置空，并计入提示

## 当前取舍

- 只集成 `mysql-data-compare` 的核心领域能力，不迁移其原前端实现。
- 数据对比保留异步任务模型，避免大表比较阻塞 UI。
- 结构对比的预览 SQL 当前优先覆盖字段级同步与新增/删除表场景，复杂索引和表选项差异仍以 DDL 人工复核为准。

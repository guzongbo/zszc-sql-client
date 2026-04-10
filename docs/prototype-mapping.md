# 原型映射

## 原型来源

- Calicat 文件：`2042046124939087872`
- 选中画布：`6edf7e97-138a-41e3-9993-15e0fe89a110`
- 当前落地范围：数据库导航树、表结构编辑页、表数据编辑页、结构对比、数据对比、对比记录

## 页面拆分

| 原型区域 | 前端模块 | 桌面端命令 | 说明 |
| --- | --- | --- | --- |
| 窗口顶部栏 | `window-topbar` | 无 | 仅做桌面工作区壳层 |
| 左侧工具列 | `tool-rail` | 无 | 对比类和性能监控保留入口占位 |
| 左侧顶部工具栏 | `navigation-header` | `save_connection_profile` `test_connection_profile` `disconnect_connection_profile` | 数据源新增、编辑、刷新、断开 |
| 数据库导航树 | `tree-scroll` | `list_profile_databases` `list_database_tables` `list_table_columns` | 按环境 -> 数据源 -> 实例 -> 库 -> 表 -> 列懒加载 |
| 右侧标签页栏 | `tabs-bar` | 无 | 一个表可打开结构页和数据页两个标签 |
| 表结构工具栏 | `content-toolbar` | `load_table_design` `preview_table_design_sql` `apply_table_design_changes` `get_table_ddl` | 字段增删改、DDL 预览与提交 |
| 字段列表表格 | `structure-grid` | `load_table_design` | 对应原型字段名、类型、长度、小数位、允许空、主键、自增、默认值、注释 |
| 数据编辑工具栏 | `content-toolbar` | `load_table_data` `preview_table_data_changes` `apply_table_data_changes` | 行增删改、事务模式切换、SQL 预览 |
| 查询条件栏 | `query-bar` | `load_table_data` | 支持 `WHERE` / `ORDER BY` 文本条件 |
| 数据表格 | `data-grid` | `load_table_data` | 仅对主键表开放可编辑提交 |
| DDL 弹窗 | `Modal` | `get_table_ddl` | 展示当前 `CREATE TABLE` |
| 新增数据源弹窗 | `ProfileEditorView` | `save_connection_profile` `import_navicat_connection_profiles` `create_data_source_group` `rename_data_source_group` `delete_data_source_group` | 手动新增与 Navicat `.ncx` 导入共用同一入口，并在同页提供分组下拉与分组维护 |
| 结构对比工作区 | `StructureCompareWorkspace` | `structure_compare_run` `load_structure_compare_detail` | 同库名映射的结构差异摘要、DDL 详情与预览 SQL |
| 数据对比工作区 | `DataCompareWorkspace` | `compare_discover_tables` `compare_start` `compare_progress` `compare_result` `compare_cancel` `load_compare_detail_page` | 同名表发现、异步执行、差异摘要、明细分页 |
| 对比记录工作区 | `CompareHistoryWorkspace` | `list_compare_history` `append_compare_history` | 本地保存数据对比与结构对比历史，支持回看统计和表范围 |

## 暂不展开的原型入口

- 性能监控
- 独立 SQL 编辑器页面

以上入口仍保留在工具列，但本轮只实现对比相关核心链路，不继续扩展性能监控与独立 SQL 工作区。

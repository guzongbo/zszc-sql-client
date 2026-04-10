# `zszc-sql-client` 重构与性能优化方案

## 背景

本项目当前是 Rust + React + Tauri 的桌面 MySQL 客户端骨架，已经具备数据源管理、库表浏览、表结构编辑、表数据编辑、SQL 控制台等核心路径。

当前用户最担心的问题集中在三类路径：

- 表结构修改
- 表数据查询与编辑
- SQL 执行与结果集浏览

这三类路径都同时受到“后端查询策略”和“前端状态设计”影响，不能只做 UI 层微调。

## GitHub 对标项目

本次主要对标以下成熟开源项目，并只抽取与当前项目直接相关的策略。

### 1. DBeaver

- GitHub: <https://github.com/dbeaver/dbeaver>
- 参考点：
  - 仓库成熟度高，`49.5k` stars，`28,396` commits（2026-04-09 查看）
  - 架构上明确区分 model plugin 与 desktop UI plugin，避免单体 UI/服务文件继续膨胀
  - 数据编辑器默认按页抓取结果，不把“总行数统计”作为默认动作
  - 支持显式“Fetch next page”“Fetch all rows”“Calculate total row count”
  - 默认优先服务端过滤与排序，而不是把结果先搬到本地再处理
- 对本项目的直接启发：
  - 表数据页和 SQL 控制台不应默认执行 `COUNT(*)`
  - 结果集分页状态里必须显式区分“精确总数”和“未统计总数”
  - 后端逻辑与 UI 逻辑需要逐步解耦

### 2. Beekeeper Studio

- GitHub: <https://github.com/beekeeper-studio/beekeeper-studio>
- 参考点：
  - 仓库成熟度高，`22.5k` stars，`8,594` commits（2026-04-09 查看）
  - README 直接强调“fast, straightforward, modern”
  - 明确反对功能堆叠导致的“kitchen sink”式拥挤交互
  - 明确有 query history、save queries、tabbed interface 这类高频 SQL 客户端能力
  - 代码结构上区分桌面壳入口与前端主界面入口
- 对本项目的直接启发：
  - 不能让 `frontend/src/App.tsx` 继续承担全部工作区状态与所有视图逻辑
  - SQL 控制台应更偏“快速执行 + 清晰反馈”，而不是默认做重型统计
  - 后续需要补历史、草稿、分区状态持久化，但前提是先把状态边界拆清楚

### 3. DbGate

- GitHub: <https://github.com/dbgate/dbgate>
- 参考点：
  - 仓库成熟度高，`6.9k` stars，`7,982` commits（2026-04-09 查看）
  - 明确强调“simple to use and effective”
  - 数据编辑支持 SQL change script preview
  - 表结构编辑、数据编辑、SQL 编辑、相关数据浏览在功能上是分层组织的
  - README 明确提到 extensible plugin architecture
- 对本项目的直接启发：
  - 当前“表数据编辑先预览 SQL，再提交”的方向是对的，应保留
  - 后续应把结构编辑、数据编辑、查询执行拆成更清晰的服务模块
  - 当前后端 `mysql_service.rs` 的单文件承载量过大，需要沿能力边界拆分

## 本项目当前主要问题

结合仓库现状，当前问题不是“Rust 性能不够”，而是查询策略和结构边界还不够成熟。

### 查询路径问题

1. 启动后前端会主动为所有数据源预加载数据库列表

- 这会在数据源较多时主动建立连接、主动读取元数据
- 与现有文档中“左树懒加载”的目标相冲突

2. 表数据页默认执行总数统计

- 大表下 `COUNT(*)` 可能比当前页读取更慢
- 结果是“翻第一页也很慢”

3. 表数据页在加载数据时会顺带读取 DDL

- 旧实现通过 `load_table_design` 间接拿字段信息
- `load_table_design` 又会触发 `SHOW CREATE TABLE`
- 数据浏览本身不需要 DDL，这属于无谓开销

4. SQL 控制台对结果集默认做重统计

- 对可包装分页的查询，旧实现会先做 `SELECT COUNT(*) FROM (...)`
- 对不可包装分页的查询，旧实现甚至会先把结果全部读入内存再截页
- 这在大结果集或复杂查询上风险很高

### 设计问题

1. 前端工作区过于集中

- `frontend/src/App.tsx` 目前超过 4000 行
- 标签页状态、树状态、编辑器状态、输出面板、对话框状态混在一个文件中

2. 后端服务过于集中

- `desktop/src-tauri/src/mysql_service.rs` 目前超过 1400 行
- 元数据读取、DDL 生成、数据编辑、SQL 执行、值转换、SQL 拼装都在同一文件

3. 结果集协议表达不完整

- 过去只有 `total_rows`
- 但“总行数是否精确统计”并没有显式表达
- 导致前端只能假设所有分页都有准确总数

## 本轮已经实施的调整

### P0.1 启动阶段恢复真正懒加载

- 已移除前端启动后对全部数据源的数据库列表预加载
- 现在只在用户展开节点或进入相关工作区时加载元数据

### P0.2 表数据页不再顺带读取 DDL

- 已新增仅用于数据浏览的字段上下文加载逻辑
- `load_table_data` 不再通过 `load_table_design` 间接读取 `SHOW CREATE TABLE`

### P0.3 表数据页与 SQL 控制台不再默认统计总数

- 统一改为“当前页 + 额外探测一行”的策略
- 能判定是否存在下一页，但不再默认执行 `COUNT(*)`
- 协议中新增 `row_count_exact`
- 前端分页栏已能正确显示“至少 N 行”与禁用“末页跳转”

### P0.4 SQL 控制台避免全量结果集进内存

- 对不能安全包装成分页 SQL 的查询，已改为顺序跳过 `offset` 并最多读取 `limit + 1` 行
- 不再把整个结果集读完再做前端分页

### P0.5 本地 SQLite 存储更稳定

- 已启用 `WAL`
- 已设置 `busy_timeout`
- 已开启 `foreign_keys`
- 为后续接入查询历史、草稿、工作区恢复打基础

### P0.6 MySQL 连接池参数补强

- 已补充读写超时、TCP keepalive、prepared statement cache
- 目标不是“极致调参”，而是先降低长时间空闲和重复 prepare 的常见成本

## 建议的后续重构阶段

## P1. 后端按能力拆分

建议从 `mysql_service.rs` 中拆出以下模块：

- `metadata_service.rs`
  - 数据库、表、字段、DDL、自动补全元数据
- `data_service.rs`
  - 表数据分页、主键定位、增删改事务提交
- `sql_console_service.rs`
  - SQL 执行、结果集分页、执行反馈、后续取消执行能力
- `sql_builder.rs`
  - DDL / DML SQL 片段拼装
- `value_codec.rs`
  - MySQL 值与 JSON 值转换

这样可以让“结构编辑”和“数据浏览/修改”和“SQL 控制台”三个大能力边界清楚下来。

## P2. 前端按工作区拆分

建议把 `frontend/src/App.tsx` 拆为：

- `features/navigation-tree/*`
- `features/table-design/*`
- `features/table-data/*`
- `features/sql-console/*`
- `features/output-dock/*`
- `features/connection-profile/*`
- `state/workspace-store.ts`

状态层优先抽成 reducer 或集中 store，避免一个组件同时维护全部标签页、弹窗和加载状态。

## P3. 执行链路增强

建议下一阶段补：

- 查询取消
- 长 SQL / 大结果集的后台任务状态
- 查询历史与草稿持久化
- 元数据缓存失效策略
- 数据网格虚拟滚动

其中“查询取消”与“后台任务状态”优先级最高，因为它们直接决定复杂 SQL 的桌面体验。

## 本项目后续决策建议

短期内建议坚持以下原则：

1. 默认不要自动做总数统计
2. 默认只取当前页 + 探测位
3. 数据浏览不要顺带读取 DDL
4. 结构编辑和数据编辑都保留 SQL 预览
5. 前后端协议必须显式表达“不精确总数”
6. 新功能优先落在模块边界清晰的位置，不再继续堆进单个大文件

## 参考来源

- DBeaver 仓库 README：<https://github.com/dbeaver/dbeaver>
- DBeaver Data Editor Wiki：<https://github.com/dbeaver/dbeaver/wiki/Data-Editor/975c8ab5c1de6650221969743b71c307b535afb6>
- Beekeeper Studio 仓库 README：<https://github.com/beekeeper-studio/beekeeper-studio>
- DbGate 仓库 README：<https://github.com/dbgate/dbgate>

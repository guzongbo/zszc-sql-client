# SQL 自动补全调研与落地

## 调研目标

- 覆盖两个场景：
  - 表数据页查询条件栏：`WHERE` / `ORDER BY`
  - SQL 控制台：完整 SQL 编辑与执行
- 输出一套适合当前 `React + Tauri + Rust` 架构的实现方案，而不是直接照搬重量级数据库 IDE。

## 开源项目观察

### DBeaver

- 文档明确将 SQL 补全定义为 `SQL Assist / Auto-Complete`，支持数据库对象名和 SQL 命令补全，并支持 `Ctrl+Space` 手动触发。
- 说明其补全并不只是关键字列表，而是依赖数据库对象元数据，属于“编辑器 + 元数据”的典型做法。
- 参考链接：[DBeaver SQL Assist and Auto-Complete](https://dbeaver.com/docs/dbeaver/SQL-Assist-and-Auto-Complete/)

### Bytebase

- Bytebase 将 SQL 自动补全拆成两层：
  - 语法无关的补全核心
  - 语法相关的后处理
- 文章里强调补全结果依赖 schema 信息，并以 `SELECT * FROM |` 推导表名、`SELECT | FROM t` 推导列名，说明成熟方案一定要结合光标位置和上下文对象。
- 它们进一步用 ANTLR4 和缓存 Follow Set 做跨方言能力，适合大规模多方言平台。
- 参考链接：[How We Built the SQL Autocomplete Framework with ANTLR4](https://www.bytebase.com/blog/sql-auto-complete/)

### DbGate

- DbGate 把表数据浏览和 SQL 编辑拆成两个协作场景：
  - 数据浏览器负责过滤、分页、编辑
  - SQL 编辑器负责查询编写与代码补全
- 这和当前项目的“表数据页查询条件 + 独立控制台”职责划分基本一致。
- 参考链接：[DbGate SQL editor features](https://dbgate.org/features/sqledit/)

### Beekeeper Studio

- Beekeeper 强调“sensible autocomplete”，即补全要有表/列建议，但不能变成持续打扰的无脑弹窗。
- 同时提供 `Ctrl/Cmd+Enter` 快捷执行，这一点非常适合当前控制台。
- 参考链接：[Beekeeper Studio SQL Editor](https://www.beekeeperstudio.io/features/sql-editor)

## 结论

- 轻量桌面客户端的第一阶段，不需要直接上 Bytebase 那种 ANTLR/LSP 级完整语义引擎。
- 当前项目更适合采用三层结构：
  - 编辑器内核：提供光标、补全弹窗、快捷键、悬停提示
  - SQL 方言：提供 MySQL 关键字和基础语法感知
  - 数据库元数据：提供当前库表字段信息
- 表数据页与控制台应分开实现：
  - 查询条件栏只需要“当前表上下文”补全
  - 控制台需要“当前数据库上下文”补全

## 当前项目落地方案

- 前端引入 CodeMirror 6，使用 MySQL 方言做语法和关键字补全。
- Rust 侧新增 `load_sql_autocomplete` 命令，按数据库一次性读取表和字段元数据，避免前端逐表多次请求。
- 表数据页查询条件栏：
  - 基于当前表字段生成 `WHERE` / `ORDER BY` 场景化补全
  - 提供字段类型、主键、可空、注释的悬停提示
- 控制台：
  - 支持关键字、表名、字段名补全
  - 支持 `Ctrl/Cmd+Enter` 执行
  - 当前数据库切换后自动刷新 schema 缓存

## 当前实现边界

- 当前补全已经覆盖高频路径：
  - 关键字
  - 当前数据库表名
  - 当前表或当前数据库字段名
  - 常见查询片段
  - 悬停提示
- 暂未实现：
  - 多语句 AST 级上下文推导
  - 别名传播
  - 子查询/CTE 级语义补全
  - 跨数据库复杂联表推断

## 后续可迭代方向

- 为控制台增加别名解析与 `FROM/JOIN` 上下文列裁剪。
- 对大库启用按需懒加载表字段，避免首次载入过多元数据。
- 若后续需要多方言支持，再评估引入 ANTLR/LSP 路线。

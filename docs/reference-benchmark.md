# 参考基线

## 结构编辑

- [DBeaver](https://github.com/dbeaver/dbeaver)
  - 参考点：数据库导航树、标签页组织、表结构编辑工作流
- [MySQL Workbench](https://github.com/mysql/mysql-workbench)
  - 参考点：MySQL 表结构编辑语义、DDL 生成保守策略

## 数据编辑

- [DbGate](https://github.com/dbgate/dbgate)
  - 参考点：数据网格编辑、变更预览、分页浏览
- [Beekeeper Studio](https://github.com/beekeeper-studio/beekeeper-studio)
  - 参考点：结果集标签页体验和轻量查询交互

## 当前实现采用的约束

- 不照搬这些项目的 UI，只借鉴交互语义和提交策略。
- 表结构变更优先生成显式 `ALTER TABLE`。
- 表数据编辑以主键为唯一定位条件。
- 无主键表默认只读，避免生成不可靠的 `UPDATE` / `DELETE`。

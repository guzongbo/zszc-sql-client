# 钉钉通讯录变动查询插件

`钉钉通讯录变动查询插件` 面向企业钉钉通讯录巡检场景，提供配置管理、即时查询和历史记录三类能力。

## 原型映射

- Calicat 文件：`2043579533925920768`
- 当前已落地页面：
  - `钉钉配置管理`
  - `通讯录查询`
  - `历史记录`

## 页面拆分

| 页面 | 前端模块 | 后端方法 | 说明 |
| --- | --- | --- | --- |
| 钉钉配置管理 | `ConfigPage` | `config.save` `config.test_connection` | 支持多配置切换、新增配置、保存与连接测试 |
| 通讯录查询 | `QueryPage` | `query.run` `query.get_latest` `query.get_detail` | 选择钉钉配置后执行查询，查看全部/新增/删除用户 |
| 历史记录 | `HistoryPage` | `history.list` `query.get_detail` | 按时间范围检索历史记录并查看某次查询详情 |

## 数据落地

- 配置数据：SQLite `configs`
- 查询历史：SQLite `query_records`
- 查询快照与变动明细：SQLite `query_users`

## 钉钉接口参考

- `GET /gettoken`
- `GET /department/list`
- `GET /user/listbypage`
- `GET /user/get`

以上接口与本机参考项目 `zszc-ding-user` 的实现保持一致，主要用于：

- 获取 `access_token`
- 遍历部门树
- 分页拉取部门用户
- 校验用户详情扩展读取能力

## 交互说明

- 首次查询没有历史基线时，不把全部现有用户计为“新增”
- 用户比对使用 `user_id` 作为主键，避免同名用户误判
- 历史详情支持从历史页回看某次查询快照

## 补充阅读

- 插件目录：[`README.md`](./README.md)
- 打包说明：[`plugins/dingtalk-contact-change-plugin/README.md`](../../plugins/dingtalk-contact-change-plugin/README.md)

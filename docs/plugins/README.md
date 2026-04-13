# 插件目录

本文档用于收录 `zszc-sql-client` 当前仓库内已经提供的插件说明入口。这里聚焦“有哪些插件、各自解决什么问题”，不展开插件开发协议与打包流程。

## 当前插件

### 密码工具插件

一个面向密码处理场景的样板插件，用于演示宿主插件工作区、前端桥接通信和 Rust 后端 `stdio JSON-RPC` 的完整链路。

- 功能说明：[`password-util-plugin.md`](./password-util-plugin.md)
- 构建与打包：[`plugins/password-util-plugin/README.md`](../../plugins/password-util-plugin/README.md)

### 随机信息与密码工具插件

一个组合型工具插件，聚焦随机信息生成、密码生成、密码短语生成和用户名生成，适合测试数据准备与账号辅助场景。

- 功能说明：[`mock-id-generator-plugin.md`](./mock-id-generator-plugin.md)
- 构建与打包：[`plugins/mock-id-generator-plugin/README.md`](../../plugins/mock-id-generator-plugin/README.md)

### 钉钉通讯录变动查询插件

一个面向企业钉钉通讯录巡检的业务插件，覆盖钉钉配置管理、通讯录变动查询和历史记录回看。

- 功能说明：[`dingtalk-contact-change-plugin.md`](./dingtalk-contact-change-plugin.md)
- 构建与打包：[`plugins/dingtalk-contact-change-plugin/README.md`](../../plugins/dingtalk-contact-change-plugin/README.md)

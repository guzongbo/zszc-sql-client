# Dingtalk Contact Change Plugin

`dingtalk-contact-change-plugin` 为 `zszc-sql-client` 新增一个钉钉通讯录变动查询插件，覆盖配置管理、即时查询与历史记录三类场景。

## 当前能力

- 多配置管理：支持保存多个钉钉开放平台配置
- 连接测试：校验 `access_token`、部门读取、用户列表读取等基础权限
- 通讯录查询：拉取当前用户列表并对比上次成功查询结果
- 历史记录：查看查询时间、用户总数、新增/删除数量与详情

## 结构

- `frontend`：React + TypeScript 插件前端
- `backend`：Rust + SQLite 插件后端
- `package-plugin.mjs`：打包为 `.zszc-plugin` 安装包

## 快速打包

```bash
cd plugins/dingtalk-contact-change-plugin/frontend
npm install

cd ../
npm install
npm run package
```

默认会：

1. 构建插件前端
2. 构建当前平台的 Rust 后端
3. 生成 `dist/dingtalk-contact-change-plugin.zszc-plugin`

## 多平台打包

```bash
npm run package:mac-apple
npm run package:mac-intel
npm run package:windows
npm run package:all
```

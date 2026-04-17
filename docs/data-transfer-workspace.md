# 数据传输工作区说明

本文档说明 `zszc-sql-client` 的“数据传输”内置工作区设计、实现方式与当前边界。当前代码已经同时落地：

- 产品层：顶部工作区切换器中的“数据传输”内置工作区
- 实现层：`desktop/src-tauri/src/data_transfer/`、`desktop/src-tauri/src/local_store.rs` 中的 Tauri 传输服务、发现协议和本地持久化能力
- 界面层：`frontend/src/features/data-transfer/` 中按 Calicat 原型拆分的工作区页面、分区切换和传输可视化

## Calicat 原型同步

本轮界面调整以 Calicat 原型为准，原型来源如下：

- 文件：`2045015412770865152`
- URL 中的画布节点：`2045015412783448064`
- 实际用于界面还原的主画板：`73840ea1-78bb-4e34-9461-4b8bd831ebd6`

当前前端落地时，重点对齐了以下原型结构：

- 左侧工作区侧栏
  - 品牌区
  - 网络注册开关
  - 分区导航：`工作台`、`节点管理`、`文件传输`、`传输历史`
- 顶部工具栏
  - 当前网络概览
  - `上传文件`、`发送文件`、`刷新节点` 三个高频动作
- 工作台主区
  - 指标卡片
  - 当前任务
  - 最近共享
  - 收藏节点预览
  - 快捷动作
- 下方历史区
  - 传输任务表格
  - 任务状态、方向、节点、时间和进度信息

其中收藏节点不再保留独立分区页面，相关预览保留在工作台与节点管理右侧卡片中，维护入口统一收敛到“节点管理”视图。

这意味着当前“数据传输”工作区已经不是早期的功能块堆叠页面，而是按照原型切成“侧栏 + 顶栏 + 指标区 + 内容网格 + 历史表”五层信息架构。

## 功能介绍

“数据传输”内置工作区定位为局域网文件传输与共享工作台，目标是在不引入中心服务的前提下，提供桌面节点发现、点对点直传、共享文件下载、断点续传和本地收藏能力。

当前实现已经具备以下核心能力：

- 节点发现
  - 自动广播本机节点信息
  - 自动监听同网段节点广播
  - 收藏节点回扫
  - 多播失败后的局域网 IPv4 扫描兜底
- 节点管理
  - 本机节点别名、指纹、端口、协议快照
  - 收藏节点持久化
  - 记忆收藏节点最近一次 IP 和端口
  - 节点在线状态按 TTL 自动淘汰
- 文件发送
  - 对在线节点发起文件直传
  - 发送前先创建会话并协商每个文件的续传偏移
  - 发送过程中维护任务、文件级进度和取消状态
- 文件共享
  - 将本地文件发布为共享条目
  - 支持 `all`、`favorite_only`、`selected_nodes` 三种共享范围
  - 远端可先读取共享目录，再按需选择文件下载
- 任务管理
  - 维护发送、接收、共享下载三类任务
  - 展示总进度、文件级进度、当前文件、完成时间和错误信息
  - 已结束任务保留 30 分钟
- 本地落盘
  - 下载结果默认写入系统下载目录下的 `zszc-data-transfer`
  - 断点续传中间文件写入 `app_data_dir/data-transfer/partials`
  - 收藏节点、共享条目、续传元数据写入本地 SQLite

当前对应的 Tauri command 如下：

| 命令 | 作用 |
| --- | --- |
| `data_transfer_get_snapshot` | 读取工作区完整快照 |
| `data_transfer_set_registration_enabled` | 开关本机发现/注册能力 |
| `data_transfer_refresh_discovery` | 主动刷新节点发现 |
| `data_transfer_update_favorite` | 收藏或取消收藏节点 |
| `data_transfer_choose_files` | 选择发送或共享文件 |
| `data_transfer_choose_folder` | 选择共享下载目标目录 |
| `data_transfer_start_direct_send` | 发起直传任务 |
| `data_transfer_publish_files` | 发布共享文件 |
| `data_transfer_remove_published_share` | 删除本地共享条目 |
| `data_transfer_load_remote_shares` | 读取远端共享目录 |
| `data_transfer_download_share` | 下载远端共享文件 |
| `data_transfer_cancel_task` | 取消本地任务 |

## LocalSend 参考点

当前实现明显参考了 LocalSend Protocol v2.1 的默认发现端口、注册接口和上传接口，但没有做完全等价复刻，而是在其基础上增加了本项目自己的共享接口。

参考资料：

- LocalSend Protocol v2.1：
  - [localsend/protocol](https://github.com/localsend/protocol)
- LocalSend 官方仓库的网络放行说明：
  - [localsend/localsend](https://github.com/localsend/localsend)
- LocalSend 官方安全公告：
  - [GHSA-424h-5f6m-x63f](https://github.com/localsend/localsend/security/advisories/GHSA-424h-5f6m-x63f)

对照关系如下：

| 参考点 | LocalSend 官方协议 | 当前实现 |
| --- | --- | --- |
| 默认端口 | UDP/TCP `53317` | 保持一致，常量 `DATA_TRANSFER_PORT = 53317` |
| 默认多播地址 | `224.0.0.167` | 保持一致，常量 `MULTICAST_ADDR = 224.0.0.167` |
| 多播报文字段 | `alias` `version` `deviceModel` `deviceType` `fingerprint` `port` `protocol` `download` `announce` | 字段保持兼容，当前固定 `version = 2.1`、`protocol = http`、`download = false` |
| 注册接口 | `POST /api/localsend/v2/register` | 保持一致，用于节点互认 |
| 直传准备接口 | `POST /api/localsend/v2/prepare-upload` | 保持一致，用于创建会话并返回文件 token 与 offsets |
| 文件上传接口 | `POST /api/localsend/v2/upload` | 保持一致，用于流式上传文件 |
| 取消接口 | `POST /api/localsend/v2/cancel` | 保持一致，用于发送端通知接收端终止会话 |
| Legacy HTTP 发现 | 多播失败后扫局域网地址 | 保持一致思路，扫描私网 IPv4 `/24` 地址 |
| Reverse File Transfer | `prepare-download` / 浏览器下载链路 | 当前未实现 |
| 加密方式 | 官方主实现以 HTTPS 为主 | 当前仅实现 HTTP |
| 项目自定义能力 | 官方协议未定义共享目录索引 | 新增 `/api/zszc-transfer/v1/shares` 与 `/api/zszc-transfer/v1/share-file` |

结论：

- “直传发现 + 注册 + 上传”这一段优先保证 LocalSend 协议兼容性，方便后续继续对齐生态
- “共享目录 + 按需下载”这一段是本项目扩展，不依赖 LocalSend 原生 Reverse File Transfer
- 当前实现更偏“同局域网桌面节点互传”，不是完整的 LocalSend 替代实现

## 节点发现机制

### 本机节点信息

本机节点信息来自 `DataTransferService::local_register_dto()`，包含：

- `alias`
  - 默认取系统主机名
  - 若主机名为空，回退为 `数据传输工作站`
- `fingerprint`
  - 首次启动生成 UUID
  - 持久化到本地 SQLite 的 `app_meta` 中
- `port`
  - 固定 `53317`
- `protocol`
  - 当前固定 `http`
- `device_type`
  - 当前固定 `desktop`
- `device_model`
  - 当前固定 `Tauri Desktop`

### 启动后的发现流程

服务启动后会并发拉起 4 条后台链路：

1. HTTP 服务
   - 绑定 `0.0.0.0:53317`
   - 接收注册、上传和共享下载请求
2. 周期广播
   - 每 6 秒向多播地址发送一次节点公告
3. 多播监听
   - 监听 `224.0.0.167:53317`
   - 收到其他节点广播后写入在线节点表
4. 在线节点清理
   - 每 5 秒执行一次 TTL 清理
   - `NODE_TTL = 45s`

### 主动刷新流程

前端调用 `data_transfer_refresh_discovery` 后，服务按如下顺序尝试发现节点：

1. 发送一次多播公告
2. 使用收藏节点里记录的 `last_known_ip + last_known_port` 做 HTTP 回扫
3. 等待 1 秒
4. 如果当前仍未发现任何节点，再扫局域网私有 IPv4 网段

局域网扫描策略：

- 只扫描私有 IPv4 地址
- 最多取前 3 个本机私网网卡地址
- 每个网卡按 `/24` 网段枚举 `1..=254`
- 跳过本机 IP
- 并发度限制为 `48`
- 对每个候选地址发起 `POST /api/localsend/v2/register`

### 节点入库与淘汰

节点一旦通过多播或 HTTP 注册成功，会写入内存态 `nodes`：

- 以 `fingerprint` 为键
- 记录 `alias`、`device_model`、`device_type`、`ip`、`port`、`protocol`
- 标记来源 `source`
  - 可能值：`multicast`、`http_register`
- 更新 `last_seen_at` 与 `last_seen_instant`

若该节点同时存在于收藏列表中，还会把最新 `ip` 和 `port` 回写到 SQLite。

节点离线策略：

- 45 秒内没有再次被发现，则从在线节点表剔除
- 剔除只影响内存在线态，不会删除收藏记录

### 发现开关

`registration_enabled = false` 时：

- 本机不会主动广播
- `refresh_discovery` 直接返回
- 收到 `/api/localsend/v2/register` 时返回 `404`

这相当于把本机切到“不参与发现”的隐身状态。

## 共享机制

### 1. 点对点直传

直传链路直接复用 LocalSend Upload API。

发送端流程：

1. 选择目标节点和本地文件
2. 为每个文件生成稳定 `file_id`
   - 计算方式：`sha1(file_name + size + modified)`
3. 调用远端 `POST /api/localsend/v2/prepare-upload`
4. 远端返回：
   - `session_id`
   - 每个文件对应的 `token`
   - 每个文件当前可续传的 `offset`
5. 发送端按文件顺序流式调用 `POST /api/localsend/v2/upload`
6. 任务结束后更新成功、失败或取消状态

接收端流程：

1. 收到 `prepare-upload` 请求
2. 为每个文件准备：
   - 临时文件路径
   - 最终落地路径
   - 当前已接收偏移
   - 文件 token
3. 把会话写入内存态 `incoming_sessions`
4. 接收 `upload` 二进制流并持续写入 `.part`
5. 文件完成后把临时文件改名到最终路径
6. 当前会话所有文件都完成后结束任务

### 2. 共享发布

共享发布是本项目自定义扩展，不走 LocalSend Reverse File Transfer 标准链路。

本地用户发布共享时：

1. 选择文件列表
2. 指定共享范围：
   - `all`
   - `favorite_only`
   - `selected_nodes`
3. 生成 `share_id`
4. 把共享元数据写入 SQLite 和运行时内存

共享条目保存的信息包括：

- `id`
- `title`
- `scope`
- `file_count`
- `total_bytes`
- `created_at`
- `updated_at`
- `files`
  - 文件名
  - 文件大小
  - MIME 类型
  - 本地绝对路径
- `allowed_fingerprints`

### 3. 共享读取与下载

共享读取接口：

- `GET /api/zszc-transfer/v1/shares?requester_fingerprint=...`

共享下载接口：

- `GET /api/zszc-transfer/v1/share-file?share_id=...&file_id=...&requester_fingerprint=...`

访问控制规则：

- `all`
  - 任意请求方都可见
- `favorite_only`
  - 请求方 `fingerprint` 必须存在于本机收藏列表
- `selected_nodes`
  - 请求方 `fingerprint` 必须出现在共享条目的 `allowed_fingerprints`

这套共享机制的特点：

- 先列目录，再按需下载文件
- 下载支持自定义目标目录
- 下载端支持 `Range` 续传
- 文件响应头带 `Content-Disposition: attachment`

### 4. 与直传的差异

| 维度 | 点对点直传 | 共享下载 |
| --- | --- | --- |
| 触发方式 | 发送端主动推送 | 接收端先看目录再拉取 |
| 兼容目标 | 优先复用 LocalSend Upload API | 本项目自定义 API |
| 会话管理 | `prepare-upload` 返回 `session_id + token` | 无上传会话，靠 share/file 标识 |
| 权限模型 | 能发现对方并准备上传即可 | 受共享范围限制 |
| 续传方式 | 通过 `prepare-upload.offsets` 协商 | 通过 HTTP `Range` 继续下载 |

## 断点续传扩展策略

### 当前已落地能力

当前已经实现“文件级断点续传”的基础版本，覆盖两个方向：

- `incoming_upload`
  - 用于接收直传文件
  - 接收端根据同一 `peer_fingerprint + file_id` 恢复已有 `.part`
- `shared_download`
  - 用于下载共享文件
  - 下载端根据同一 `peer_fingerprint + share_id:file_id` 恢复已有 `.part`

当前策略的关键点：

- 续传元数据持久化到 SQLite 表 `data_transfer_partial_transfers`
- 临时文件落在 `app_data_dir/data-transfer/partials`
- 恢复时优先复用旧的 `temp_path` 和 `final_path`
- 实际偏移量不信任数据库值，而是重新读取 `.part` 当前长度
- 共享下载通过 `Range: bytes={offset}-` 请求后续数据
- 直传接收通过 `prepare-upload.offsets` 告诉发送端从哪里继续

### 当前缺口

当前实现还不是“完整断点续传体系”，主要缺口有：

- 只持久化接收侧续传信息，没有持久化发送侧会话
- 应用重启后，运行中的任务列表和 `incoming_sessions` 会丢失
- `file_id` 只基于文件名、大小、修改时间，理论上存在碰撞可能
- `sha256` 字段已预留，但当前没有做文件内容校验
- 没有分块级校验、块位图和重试次数统计
- 没有陈旧 `.part` 自动清理策略

### 建议扩展路线

建议按以下顺序补强：

1. 会话持久化
   - 新增传输会话表，保存 `task_id`、远端节点、方向、远端 `session_id`、最后活跃时间
   - 解决应用重启后无法恢复任务上下文的问题
2. 内容校验
   - 在发送前计算 `sha256`
   - 接收完成后校验摘要，校验失败则保留 `.part` 并允许重试
3. 块级续传
   - 将大文件切成固定大小 chunk
   - 记录 chunk 位图而不是只记录单一 offset
   - 为多线程并发下载/上传做准备
4. 发送侧恢复
   - 为直传发送端持久化远端 `session_id`
   - 重试时优先与原会话协商，否则回退为新会话
5. 生命周期治理
   - 为续传记录增加超时和 GC
   - 提供“继续未完成传输”和“清理缓存文件”入口
6. 冲突处理
   - 当最终文件已存在且大小不同、摘要不同或路径不可写时，给出覆盖、另存、继续写入三种策略

## 数据存储

### SQLite 持久化

数据传输相关持久化由 `LocalStore::migrate_data_transfer_workspace()` 初始化，核心表如下：

| 表/键 | 作用 |
| --- | --- |
| `app_meta.data_transfer_registration_enabled` | 是否允许本机参与节点发现与注册 |
| `app_meta.data_transfer_fingerprint` | 本机持久化指纹 |
| `data_transfer_favorites` | 收藏节点、最近 IP/端口、展示信息 |
| `data_transfer_published_shares` | 本地发布的共享条目 |
| `data_transfer_partial_transfers` | 断点续传元数据 |

表结构要点：

- `data_transfer_favorites`
  - 主键是 `fingerprint`
  - 有 `alias` 索引，便于列表检索
- `data_transfer_published_shares`
  - `files_json` 保存共享文件列表
  - `allowed_fingerprints_json` 保存选定节点白名单
- `data_transfer_partial_transfers`
  - 主键是 `(transfer_kind, peer_fingerprint, resource_id)`
  - 有 `updated_at` 索引，便于后续做 GC 和最近任务恢复

### 文件系统落盘

文件内容不进 SQLite，实际文件只写文件系统：

- 默认下载目录
  - `系统下载目录/zszc-data-transfer`
  - 若系统下载目录不可用，则回退为 `app_data_dir/downloads/zszc-data-transfer`
- 断点续传临时目录
  - `app_data_dir/data-transfer/partials`
- 临时文件命名
  - `<peer_fingerprint>-<resource_id>.part`
  - 文件名会经过 ASCII 安全化处理

### 仅保存在内存的数据

以下状态目前不持久化：

- 在线节点表 `nodes`
- 正在接收的上传会话 `incoming_sessions`
- 当前任务列表 `tasks`

这意味着：

- 重启应用后，在线节点需要重新发现
- 未完成任务无法直接在 UI 中恢复
- 已完成任务只保留在当前运行进程，最多 30 分钟

## 已知限制

当前版本需要明确以下限制：

1. 仅支持 HTTP，不支持 HTTPS
   - 没有证书、没有 TLS 指纹校验、没有 PIN 校验
2. 节点发现存在同网段伪造风险
   - 这与 LocalSend 官方在 2025-08-01 披露的 `GHSA-424h-5f6m-x63f` 风险类别相同
   - 当前实现同样依赖未经认证的 UDP 多播和 HTTP 注册
3. 发现范围只覆盖私有 IPv4 局域网
   - 不支持 IPv6
   - 不支持跨 VLAN
   - 不支持 AP Isolation 场景
   - 不支持中继、云端转发或 Tailscale 类节点目录
4. 网段扫描策略较保守
   - 只扫描前 3 个私网网卡
   - 只按 `/24` 猜测子网
   - 特殊网络拓扑下可能漏发现
5. 共享权限是轻量级白名单，不是强认证
   - `favorite_only` 只是“请求方指纹在我的收藏列表中”
   - 不代表完成了设备真实性验证
7. 目录共享尚未完整支持
   - 当前只接收普通文件
   - `relative_path` 字段已存在，但发布共享时仍写 `None`
8. 任务取消还不彻底
   - 本地取消只会设置本地 `cancel_flag`
   - 发送侧用户主动取消时，没有显式调用远端 `/cancel`
   - 接收端可能保留残留会话，后续需要补清理
9. 共享文件路径可能失效
   - 发布共享后如果源文件被移动、删除或权限变化，下载时才会暴露错误
10. 缺少带宽、并发和磁盘占用治理
   - 没有限速
   - 没有磁盘空间预检查
   - 没有过期 `.part` 自动回收

## 后续优化方向

建议后续按“先补可用性，再补安全性，最后补性能”的顺序推进：

### 第一阶段：完成工作区接入

这一阶段已经完成，当前代码已具备：

- 顶部工作区切换器中的“数据传输”入口
- 基于 `snapshot` 的稳定前端状态映射
- `工作台 / 节点管理 / 文件传输 / 传输历史` 四个分区
- 节点列表、收藏管理、共享管理、任务中心和下载目录展示
- 工作台与节点管理中的收藏节点预览卡
- 传输进度、任务状态、共享范围与远端共享浏览

### 第二阶段：补安全底座

- 切换到 HTTPS 或引入握手校验
- 对收藏节点做证书或公钥级别固定
- 增加首次信任确认、节点校验码或短 PIN
- 对共享下载与直传都增加内容摘要校验

### 第三阶段：补传输能力

- 支持目录发送和目录共享，落地 `relative_path`
- 大文件分块并发传输
- 发送端会话恢复
- 更细粒度的失败重试和冲突处理

### 第四阶段：补复杂网络场景

- 手动输入 IP / 网段探测
- IPv6 发现
- mDNS / DNS-SD 辅助发现
- 跨网段节点簿或可信中继

### 第五阶段：补运维与体验

- 传输日志与诊断页
- 防火墙、自组网、AP Isolation 故障提示
- 自动清理陈旧共享和 `.part` 文件
- 发送成功后快速定位文件、再次共享、复制路径

## 结论

“数据传输”内置工作区当前已经形成完整的一期底座：

- 协议层参考了 LocalSend 的发现与上传链路
- 共享目录与按需下载是本项目自己的扩展
- SQLite、本地下载目录和临时文件目录已经齐备
- 前端工作区已经按 Calicat 原型完成首轮接入，能够直接承载节点管理、直传、共享与历史查看
- 后续重点转为安全补强、会话恢复、目录传输和更细粒度的断点续传治理

后续继续迭代时，建议同步维护 `docs/prototype-mapping.md` 中的数据传输页面拆分，确保 Calicat 原型、前端实现和桌面端命令保持一致。

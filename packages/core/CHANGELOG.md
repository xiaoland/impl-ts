# @inkcre/core

## 0.4.1

### Patch Changes

- 2d260e3: 普通 Web Peer JWT 保持 24 小时签发默认值，并与数据库准入策略解耦；生成的协议合同不再把客户端默认值声明为数据库准入上限。
- 304cb5d: Core SDK 在 0.4 兼容线新增可选阅读目标接口 `Resolver.getRecallTarget`、`RecallTarget`、`RecallGroup` 和 `presentLexicalMatches`，让宿主将同封 newsletter 的多条命中汇入阅读入口，保留原始证据、顺序和独立投递副本。旧 Resolver 默认返回 null，无需改动。

  保留 SDK 0.4 的 `peerJwtContract.maximum_lifetime_seconds` 兼容字段（包含 `databaseRuntimeContract.jwt` 别名），其值仅代表历史客户端签发默认值，不代表数据库准入上限。现有 Runtime 0.4.1、Mail 0.4.0 与其他声明支持 Core 0.4 的原生分发继续兼容。

## 0.4.0

### Minor Changes

- 插件配置与业务状态在部署内共享；精确分发版本和启用意图分别保存在每个 Peer。Client Web 在同一插件入口管理各 Peer 的安装、版本和运行状态，并采用 Extension management v2。

  原生 SDK 不再提供全局插件版本与 enabled 数组。新版 MF 使用 0.4 SDK 的参与记录接口，历史 MF 需按其 SDK 范围运行或明确选择新版；不会自动改写旧版本选择。Python 与 MF 分别从自己的仓库发布，插件负责共享数据契约兼容。

### Patch Changes

- 7307dda: 按任务精简 Settings、Peer 与 Extension 界面，统一页面和浏览器标题，补齐场景化加载、刷新失败保留、保存与取消的动作反馈。修正重复检索、任务不存在及日志读取失败的可观察结果，保留失败后的恢复入口。
- 7307dda: Source 与 Peer 配置使用可视化表单，保留完整 JSON 编辑模式；Peers 页面可确认删除离线 Peer 并清理其扩展启用记录。Extension 浏览与版本选择交由 Registry，Web 接收精确版本并确认安装；Web 与 Module Federation 扩展统一升级正式 UI 2.2.0，Peer AI 凭据在 schema 中标记为密码输入。

## 0.3.0

### Minor Changes

- 47fa3f6: 支持 Job 的 best-effort 停止意图：worker 集中读取 abort_requested，传递 AbortSignal，并在执行与清理结束后关闭 Job；应用退出先等待 worker 再释放 Extension runtime。

### Patch Changes

- ec5dd1e: Block.find 传播数据库读取错误，避免 Graph 与 inspector 将读取失败误报为对象缺失。成功读取但没有匹配对象时仍返回 null。
- ec5dd1e: 迁移至正式 @inkcre/ui-web 2.0.0，统一 Vue 最低版本、Token 角色、按钮提交与加载态、JSON 草稿保存和日期确认行为；维护 Agent 从安装包读取同版本 DESIGN.md 与 Skill。

  Peer 保存现在传播数据库错误，配置保存失败时保留草稿与弹窗，阻止无效或尚在验证中的内容提交，并在持久化期间禁止重复操作。

  Host 与扩展共享 UI 运行时以继承 i18n、路由和表单上下文；Info-Base 浮层与 Mail 附件操作适应窄视口。

  移除普通业务容器的旧圆角，按正文／标题／元数据职责使用字体角色，调整 Sources、Extensions 和 Job 详情的布局以适应容器宽度。打开的 Text、HTML 文本和 Tweet 内容不再沿用摘要截断。

- ec5dd1e: 来源列表集中展示名称、类型、ID 与当前采集入口；完整配置和删除集中到详情，创建来源与定时采集表单由明确动作打开。配置使用独立草稿，读取失败、schema 不可用、保存／删除等待和失败均有对应反馈，离开前保护未保存修改。

  Source、SourceType 和来源页使用的 Job／Cron 数据库边界传播请求错误，避免把失败显示成空结果或删除成功。普通任务状态与例行保存采用中性表达，失败与超时继续强调。

  Twitter 设置向导在来源切换读取失败时保留之前的来源与时间草稿，并显示错误，避免选项与实际采集目标不一致。

  Web 注册同版本 UI Uno preset，让已有语义反馈工具类实际生效；来源创建与任务配置弹层的宽度受视口和宿主容器共同约束。

## 0.2.0

### Minor Changes

- d72d88c: Add peer-local graph-navigation retrieval and the required Resolver preview presentation contract.

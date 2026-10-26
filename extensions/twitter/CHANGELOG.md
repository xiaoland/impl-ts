# @inkcre/ext-twitter

## 0.5.1

### Patch Changes

- Updated dependencies [02ef335]
  - @inkcre/core@0.4.2

## 0.5.0

### Minor Changes

- 2d260e3: 普通 Web Peer JWT 保持 24 小时签发默认值，并与数据库准入策略解耦。Twitter 新增 x-monkey 原生归档记录的读取与浏览器连接入口；账户页在本地签发短时 Peer JWT，不增加 Host SDK API，因此仍兼容 Core SDK >=0.4.0。

### Patch Changes

- e74195b: Web 宿主与第一方 Module Federation 扩展统一采用正式 @inkcre/ui-web 2.3.0，共享同一 UI 单例。图片查看支持连续缩放、拖动平移、双指捏合与键盘操作，100% 仅作为快捷比例；保留按需媒体读取、关闭与焦点恢复。
- e74195b: 改善新旧推文详情与图谱预览的阅读布局、富文本、引用和媒体呈现。媒体保持按需读取，增加清晰的图片放大、视频全屏与原帖入口，保留播放状态并在关闭后恢复键盘焦点。

## 0.4.2

### Patch Changes

- 插件配置与业务状态在部署内共享；精确分发版本和启用意图分别保存在每个 Peer。Client Web 在同一插件入口管理各 Peer 的安装、版本和运行状态，并采用 Extension management v2。

  原生 SDK 不再提供全局插件版本与 enabled 数组。新版 MF 使用 0.4 SDK 的参与记录接口，历史 MF 需按其 SDK 范围运行或明确选择新版；不会自动改写旧版本选择。Python 与 MF 分别从自己的仓库发布，插件负责共享数据契约兼容。

- 7307dda: Source 与 Peer 配置使用可视化表单，保留完整 JSON 编辑模式；Peers 页面可确认删除离线 Peer 并清理其扩展启用记录。Extension 浏览与版本选择交由 Registry，Web 接收精确版本并确认安装；Web 与 Module Federation 扩展统一升级正式 UI 2.2.0，Peer AI 凭据在 schema 中标记为密码输入。
- Updated dependencies [7307dda]
- Updated dependencies
- Updated dependencies [7307dda]
  - @inkcre/core@0.4.0

## 0.4.1

### Patch Changes

- 1ab64fa: 配套支持 Python Host SDK 0.3 的 Python 发行，将 Twitter 和 Mail 的 Module Federation 分发推进到相同的精确 Extension Release。功能、界面、导出和 Web Host SDK 兼容范围保持不变。

## 0.4.0

### Minor Changes

- f18b34c: 将 Twitter、Mail 浏览器发行分别对齐到支持 Core Host 0.2 的既有 Python 发行 0.4.0、0.3.0。Web 安装和显式换版本交由所选 Host 校验，使 Python-only Extension 可以从 Web 安装。首次连接成功后再启动浏览器任务扫描，重置时先停止任务。

### Patch Changes

- ec5dd1e: Twitter 设置向导的步骤编号采用共同设计的直角轮廓，保持当前与已完成步骤的状态区分。

  向导宽度同时受宿主容器约束，避免窄屏弹层的内边距使内容和关闭按钮被裁剪。

- ec5dd1e: 重组 Twitter 配置步骤与已配置摘要，将应用设置按需展开，保留授权等待、失败草稿、来源调度与明确启动的操作边界。
- ec5dd1e: 迁移至正式 @inkcre/ui-web 2.0.0，统一 Vue 最低版本、Token 角色、按钮提交与加载态、JSON 草稿保存和日期确认行为；维护 Agent 从安装包读取同版本 DESIGN.md 与 Skill。

  Peer 保存现在传播数据库错误，配置保存失败时保留草稿与弹窗，阻止无效或尚在验证中的内容提交，并在持久化期间禁止重复操作。

  Host 与扩展共享 UI 运行时以继承 i18n、路由和表单上下文；Info-Base 浮层与 Mail 附件操作适应窄视口。

  移除普通业务容器的旧圆角，按正文／标题／元数据职责使用字体角色，调整 Sources、Extensions 和 Job 详情的布局以适应容器宽度。打开的 Text、HTML 文本和 Tweet 内容不再沿用摘要截断。

- b415f88: Twitter 与 Mail 的浏览器产物支持 Web SDK 0.2 和 0.3，并从各自声明生成 MF 共享范围，避免版本准备后与 Registry 兼容声明分离。UI 2.0.1 共享要求与 Python Host 范围保持独立。
- ec5dd1e: 来源列表集中展示名称、类型、ID 与当前采集入口；完整配置和删除集中到详情，创建来源与定时采集表单由明确动作打开。配置使用独立草稿，读取失败、schema 不可用、保存／删除等待和失败均有对应反馈，离开前保护未保存修改。

  Source、SourceType 和来源页使用的 Job／Cron 数据库边界传播请求错误，避免把失败显示成空结果或删除成功。普通任务状态与例行保存采用中性表达，失败与超时继续强调。

  Twitter 设置向导在来源切换读取失败时保留之前的来源与时间草稿，并显示错误，避免选项与实际采集目标不一致。

  Web 注册同版本 UI Uno preset，让已有语义反馈工具类实际生效；来源创建与任务配置弹层的宽度受视口和宿主容器共同约束。

- ec5dd1e: 升级正式 @inkcre/ui-web 至 2.0.1，采用更新的设计指南、字体与中性色彩，并修复默认 Header 菜单图标不可见的问题。Web 与两个 Module Federation 扩展使用同一精确 UI 版本，不添加本地主题覆盖或图标 safelist 补丁。

  侧栏宽度计入内边距与边框；移动端打开时覆盖主内容，避免裁切导航或将主内容挤成竖列。

- Updated dependencies [47fa3f6]
- Updated dependencies [ec5dd1e]
- Updated dependencies [ec5dd1e]
- Updated dependencies [ec5dd1e]
  - @inkcre/core@0.3.0

## 0.3.0

### Minor Changes

- d72d88c: Add peer-local graph-navigation retrieval and the required Resolver preview presentation contract.

### Patch Changes

- Updated dependencies [d72d88c]
  - @inkcre/core@0.2.0

## 0.2.1

### Patch Changes

- Read OAuth App configuration from the deployment model and render setup fields through InkForm.

## 0.2.0

### Minor Changes

- Add the Extension-owned multi-step setup wizard for OAuth, Bookmark Sources, and scheduling.

## 0.1.2

### Patch Changes

- 7b68bc2: Render and resolve stored tweet media through the shared hydrated-content contract.

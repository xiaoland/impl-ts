# @inkcre/client-web

## 0.1.6

### Patch Changes

- Updated dependencies [2d260e3]
- Updated dependencies [304cb5d]
  - @inkcre/core@0.4.1

## 0.1.5

### Patch Changes

- e74195b: Web 宿主与第一方 Module Federation 扩展统一采用正式 @inkcre/ui-web 2.3.0，共享同一 UI 单例。图片查看支持连续缩放、拖动平移、双指捏合与键盘操作，100% 仅作为快捷比例；保留按需媒体读取、关闭与焦点恢复。
- 304cb5d: 支持 newsletter 阅读与原文切换、刊物归档和重复投递折叠；保留多篇文章、有效链接与独立 MIME 正文。阅读模式适配窄屏布局表格、清理明确的订阅和分享操作，并保留图片独占的链接入口，延续禁止被动加载远程资源的阅读边界。

  搜索按邮件呈现 newsletter 命中，保留每条原始证据和检查入口。桌面阅读提供常驻目录、标题导航、单层滚动和浏览器本地阅读位置。

  刊物归档使用整行阅读入口，对齐标题、日期与阅读操作；投递副本和刊物标识按需展开，窄窗口保留标题与日期的阅读顺序。

  Newsletter HTML 的 lexical 投影仅索引可见文字，排除布局 Markdown 和属性派生的跳转 URL；default 投影及阅读中的链接不变。

  Mail 的 Module Federation 分发兼容现有 Core SDK 0.4 与新增阅读目标接口的 0.5，Resolver 通过可逆的 initialize/dispose 生命周期注册。

## 0.1.4

### Patch Changes

- 26b535d: 关闭后台参与时仍恢复本地插件；同一连接调整续租频率保留 Host。冷启动图谱仅对插件恢复前的 UnknownResolver 在恢复完成后重试一次，保留最终真实错误。

## 0.1.3

### Patch Changes

- 7307dda: 按任务精简 Settings、Peer 与 Extension 界面，统一页面和浏览器标题，补齐场景化加载、刷新失败保留、保存与取消的动作反馈。修正重复检索、任务不存在及日志读取失败的可观察结果，保留失败后的恢复入口。
- 插件配置与业务状态在部署内共享；精确分发版本和启用意图分别保存在每个 Peer。Client Web 在同一插件入口管理各 Peer 的安装、版本和运行状态，并采用 Extension management v2。

  原生 SDK 不再提供全局插件版本与 enabled 数组。新版 MF 使用 0.4 SDK 的参与记录接口，历史 MF 需按其 SDK 范围运行或明确选择新版；不会自动改写旧版本选择。Python 与 MF 分别从自己的仓库发布，插件负责共享数据契约兼容。

- 7307dda: Source 与 Peer 配置使用可视化表单，保留完整 JSON 编辑模式；Peers 页面可确认删除离线 Peer 并清理其扩展启用记录。Extension 浏览与版本选择交由 Registry，Web 接收精确版本并确认安装；Web 与 Module Federation 扩展统一升级正式 UI 2.2.0，Peer AI 凭据在 schema 中标记为密码输入。
- Updated dependencies [7307dda]
- Updated dependencies
- Updated dependencies [7307dda]
  - @inkcre/core@0.4.0

## 0.1.2

### Patch Changes

- 47fa3f6: 支持 Job 的 best-effort 停止意图：worker 集中读取 abort_requested，传递 AbortSignal，并在执行与清理结束后关闭 Job；应用退出先等待 worker 再释放 Extension runtime。
- ec5dd1e: 重组 Graph 上下文、按需视图选项、节点与关系操作，移除重复表达焦点状态的 Current 标签，补齐键盘聚焦、可读的方向弱化和原地址错误重试。
- ec5dd1e: 迁移至正式 @inkcre/ui-web 2.0.0，统一 Vue 最低版本、Token 角色、按钮提交与加载态、JSON 草稿保存和日期确认行为；维护 Agent 从安装包读取同版本 DESIGN.md 与 Skill。

  Peer 保存现在传播数据库错误，配置保存失败时保留草稿与弹窗，阻止无效或尚在验证中的内容提交，并在持久化期间禁止重复操作。

  Host 与扩展共享 UI 运行时以继承 i18n、路由和表单上下文；Info-Base 浮层与 Mail 附件操作适应窄视口。

  移除普通业务容器的旧圆角，按正文／标题／元数据职责使用字体角色，调整 Sources、Extensions 和 Job 详情的布局以适应容器宽度。打开的 Text、HTML 文本和 Tweet 内容不再沿用摘要截断。

- f18b34c: 将 Twitter、Mail 浏览器发行分别对齐到支持 Core Host 0.2 的既有 Python 发行 0.4.0、0.3.0。Web 安装和显式换版本交由所选 Host 校验，使 Python-only Extension 可以从 Web 安装。首次连接成功后再启动浏览器任务扫描，重置时先停止任务。
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

## 0.1.1

### Patch Changes

- Updated dependencies [d72d88c]
  - @inkcre/core@0.2.0

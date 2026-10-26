# @inkcre/ext-mail

## 0.4.1

### Patch Changes

- Updated dependencies [02ef335]
  - @inkcre/core@0.4.2

## 0.4.0

### Minor Changes

- 304cb5d: 支持 newsletter 阅读与原文切换、刊物归档和重复投递折叠；保留多篇文章、有效链接与独立 MIME 正文。阅读模式适配窄屏布局表格、清理明确的订阅和分享操作，并保留图片独占的链接入口，延续禁止被动加载远程资源的阅读边界。

  搜索按邮件呈现 newsletter 命中，保留每条原始证据和检查入口。桌面阅读提供常驻目录、标题导航、单层滚动和浏览器本地阅读位置。

  刊物归档使用整行阅读入口，对齐标题、日期与阅读操作；投递副本和刊物标识按需展开，窄窗口保留标题与日期的阅读顺序。

  Newsletter HTML 的 lexical 投影仅索引可见文字，排除布局 Markdown 和属性派生的跳转 URL；default 投影及阅读中的链接不变。

  Mail 的 Module Federation 分发兼容现有 Core SDK 0.4 与新增阅读目标接口的 0.5，Resolver 通过可逆的 initialize/dispose 生命周期注册。

### Patch Changes

- e74195b: Web 宿主与第一方 Module Federation 扩展统一采用正式 @inkcre/ui-web 2.3.0，共享同一 UI 单例。图片查看支持连续缩放、拖动平移、双指捏合与键盘操作，100% 仅作为快捷比例；保留按需媒体读取、关闭与焦点恢复。

## 0.3.2

### Patch Changes

- 插件配置与业务状态在部署内共享；精确分发版本和启用意图分别保存在每个 Peer。Client Web 在同一插件入口管理各 Peer 的安装、版本和运行状态，并采用 Extension management v2。

  原生 SDK 不再提供全局插件版本与 enabled 数组。新版 MF 使用 0.4 SDK 的参与记录接口，历史 MF 需按其 SDK 范围运行或明确选择新版；不会自动改写旧版本选择。Python 与 MF 分别从自己的仓库发布，插件负责共享数据契约兼容。

- 7307dda: Source 与 Peer 配置使用可视化表单，保留完整 JSON 编辑模式；Peers 页面可确认删除离线 Peer 并清理其扩展启用记录。Extension 浏览与版本选择交由 Registry，Web 接收精确版本并确认安装；Web 与 Module Federation 扩展统一升级正式 UI 2.2.0，Peer AI 凭据在 schema 中标记为密码输入。
- Updated dependencies [7307dda]
- Updated dependencies
- Updated dependencies [7307dda]
  - @inkcre/core@0.4.0

## 0.3.1

### Patch Changes

- 1ab64fa: 配套支持 Python Host SDK 0.3 的 Python 发行，将 Twitter 和 Mail 的 Module Federation 分发推进到相同的精确 Extension Release。功能、界面、导出和 Web Host SDK 兼容范围保持不变。

## 0.3.0

### Minor Changes

- f18b34c: 将 Twitter、Mail 浏览器发行分别对齐到支持 Core Host 0.2 的既有 Python 发行 0.4.0、0.3.0。Web 安装和显式换版本交由所选 Host 校验，使 Python-only Extension 可以从 Web 安装。首次连接成功后再启动浏览器任务扫描，重置时先停止任务。

### Patch Changes

- ec5dd1e: 重组邮件阅读、信头、附件与内嵌内容，统一文件下载条目和事实摘要；在保留 HTML 隔离的前提下提供基础排印。
- ec5dd1e: 迁移至正式 @inkcre/ui-web 2.0.0，统一 Vue 最低版本、Token 角色、按钮提交与加载态、JSON 草稿保存和日期确认行为；维护 Agent 从安装包读取同版本 DESIGN.md 与 Skill。

  Peer 保存现在传播数据库错误，配置保存失败时保留草稿与弹窗，阻止无效或尚在验证中的内容提交，并在持久化期间禁止重复操作。

  Host 与扩展共享 UI 运行时以继承 i18n、路由和表单上下文；Info-Base 浮层与 Mail 附件操作适应窄视口。

  移除普通业务容器的旧圆角，按正文／标题／元数据职责使用字体角色，调整 Sources、Extensions 和 Job 详情的布局以适应容器宽度。打开的 Text、HTML 文本和 Tweet 内容不再沿用摘要截断。

- b415f88: Twitter 与 Mail 的浏览器产物支持 Web SDK 0.2 和 0.3，并从各自声明生成 MF 共享范围，避免版本准备后与 Registry 兼容声明分离。UI 2.0.1 共享要求与 Python Host 范围保持独立。
- ec5dd1e: 升级正式 @inkcre/ui-web 至 2.0.1，采用更新的设计指南、字体与中性色彩，并修复默认 Header 菜单图标不可见的问题。Web 与两个 Module Federation 扩展使用同一精确 UI 版本，不添加本地主题覆盖或图标 safelist 补丁。

  侧栏宽度计入内边距与边框；移动端打开时覆盖主内容，避免裁切导航或将主内容挤成竖列。

- Updated dependencies [47fa3f6]
- Updated dependencies [ec5dd1e]
- Updated dependencies [ec5dd1e]
- Updated dependencies [ec5dd1e]
  - @inkcre/core@0.3.0

## 0.2.0

### Minor Changes

- d72d88c: Add peer-local graph-navigation retrieval and the required Resolver preview presentation contract.

### Patch Changes

- Updated dependencies [d72d88c]
  - @inkcre/core@0.2.0

## 0.1.1

### Patch Changes

- 7b68bc2: Publish Mail as a relocatable native Module Federation Extension.

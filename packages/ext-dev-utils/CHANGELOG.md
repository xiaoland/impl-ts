# @inkcre/ext-dev-utils

## 0.1.5

### Patch Changes

- Updated dependencies [02ef335]
  - @inkcre/core@0.4.2

## 0.1.4

### Patch Changes

- e74195b: Web 宿主与第一方 Module Federation 扩展统一采用正式 @inkcre/ui-web 2.3.0，共享同一 UI 单例。图片查看支持连续缩放、拖动平移、双指捏合与键盘操作，100% 仅作为快捷比例；保留按需媒体读取、关闭与焦点恢复。

## 0.1.3

### Patch Changes

- 7307dda: Source 与 Peer 配置使用可视化表单，保留完整 JSON 编辑模式；Peers 页面可确认删除离线 Peer 并清理其扩展启用记录。Extension 浏览与版本选择交由 Registry，Web 接收精确版本并确认安装；Web 与 Module Federation 扩展统一升级正式 UI 2.2.0，Peer AI 凭据在 schema 中标记为密码输入。
- Updated dependencies [7307dda]
- Updated dependencies
- Updated dependencies [7307dda]
  - @inkcre/core@0.4.0

## 0.1.2

### Patch Changes

- ec5dd1e: 迁移至正式 @inkcre/ui-web 2.0.0，统一 Vue 最低版本、Token 角色、按钮提交与加载态、JSON 草稿保存和日期确认行为；维护 Agent 从安装包读取同版本 DESIGN.md 与 Skill。

  Peer 保存现在传播数据库错误，配置保存失败时保留草稿与弹窗，阻止无效或尚在验证中的内容提交，并在持久化期间禁止重复操作。

  Host 与扩展共享 UI 运行时以继承 i18n、路由和表单上下文；Info-Base 浮层与 Mail 附件操作适应窄视口。

  移除普通业务容器的旧圆角，按正文／标题／元数据职责使用字体角色，调整 Sources、Extensions 和 Job 详情的布局以适应容器宽度。打开的 Text、HTML 文本和 Tweet 内容不再沿用摘要截断。

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

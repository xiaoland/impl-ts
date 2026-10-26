# @inkcre/ext-memos

## 0.3.3

### Patch Changes

- Updated dependencies [02ef335]
  - @inkcre/core@0.4.2

## 0.3.2

### Patch Changes

- e74195b: Web 宿主与第一方 Module Federation 扩展统一采用正式 @inkcre/ui-web 2.3.0，共享同一 UI 单例。图片查看支持连续缩放、拖动平移、双指捏合与键盘操作，100% 仅作为快捷比例；保留按需媒体读取、关闭与焦点恢复。

## 0.3.1

### Patch Changes

- 插件配置与业务状态在部署内共享；精确分发版本和启用意图分别保存在每个 Peer。Client Web 在同一插件入口管理各 Peer 的安装、版本和运行状态，并采用 Extension management v2。

  原生 SDK 不再提供全局插件版本与 enabled 数组。新版 MF 使用 0.4 SDK 的参与记录接口，历史 MF 需按其 SDK 范围运行或明确选择新版；不会自动改写旧版本选择。Python 与 MF 分别从自己的仓库发布，插件负责共享数据契约兼容。

- 7307dda: Source 与 Peer 配置使用可视化表单，保留完整 JSON 编辑模式；Peers 页面可确认删除离线 Peer 并清理其扩展启用记录。Extension 浏览与版本选择交由 Registry，Web 接收精确版本并确认安装；Web 与 Module Federation 扩展统一升级正式 UI 2.2.0，Peer AI 凭据在 schema 中标记为密码输入。
- Updated dependencies [7307dda]
- Updated dependencies
- Updated dependencies [7307dda]
  - @inkcre/core@0.4.0

## 0.3.0

### Minor Changes

- 1ab64fa: 简化 Memos 连接准备：自动生成或复用 PAT、按需启用 Core，通过 Memos 自有只读能力获取服务地址，并链接对应版本的作者帮助。

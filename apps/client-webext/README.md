# InKCre WebExt

浏览器扩展本身是一个 Peer。它连接共享 PostgREST 协议，采集浏览中的材料，保存选区、附注和在线 PDF，预览并导入当前浏览器的书签与历史。核心路径不要求 client-web 页面、登录态或代理，也不需要网页专用数据库 RPC。

## 使用

在“信息库”中填写共享协议的 PostgREST 地址和部署 JWT 密钥，保存 WebExt 自己的加入配置；不是选择接收网页的上级节点，也不复用 Web 页面的 Peer ID。“修改连接”回填完整配置，保留连接 ID、Peer ID 与待办关联。同一信息库换地址时可以直接修改，未发送材料随后使用新地址；另一个信息库使用单独的加入配置，不靠 URL 别名自动合并身份。

本机保存不以联网成功为前提。后台使用 core 的 `WebPeerRuntime` 登记自身并续租；失败会显示在连接下，可用“检查连接”重新授权和检查，不回滚主人保存的配置。登记只表示 Peer 的参与情况，不是材料读写的授权前置条件。材料使用共享 `signDatabaseToken` 直接访问数据库；`PGRST301` 表示该地址没有接受当前 JWT，不能仅凭“No suitable key or wrong key type”推断具体原因。失败材料保留在本机，修正配置后可重试。

密钥输入框默认隐藏，可用眼睛按钮显示、核对和复制，再点击隐藏。从 Web 转移连接配置时，先显示明文再复制；Helium 会阻止直接复制仍处于隐藏状态的密码框内容，剪贴板可能保留之前的值。如果使用的 Web 版本没有显隐按钮，可从设置“导出”的配置中取 `metaConfig.INKCRE_JWT_SECRET` 的实际字符串，不含 JSON 引号。导出文件含明文密钥，不应上传到问题反馈或聊天。

HTML 和文字是普通 core 语义内容块，PDF 使用当前 Peer 支持的可写 Storage，默认内置 PostgreSQL binary ID 为 `-4`；该选项位于“PDF 存储”，不是加入共享系统所需的另一种身份。

自动采集默认关闭，启用时请求对应站点权限。它保存已加载的结构、文字和出处，不读取 cookie 或网站 localStorage，也不自动保存密码和未提交编辑。同一浏览器 profile、确切地址维护当前观察；切换网站账户可能替换该地址的 current，重要内容应主动保存。主动原文和附注不受自动更新影响。

本机待发送与已保存到信息库是不同状态。待办绑定入队时的信息库与本 Peer 身份，后台自行推进，不靠 popup 或设置页轮询触发；关闭界面或重启后仍可继续。暂停和排除停止未派发的自动工作，手动保存仍可使用；排除编辑器回填现有规则，刷新状态不覆盖未保存的编辑。恢复尽力复用可见图结果，但不承诺 exactly-once、全图事务或完整历史。响应丢失、并发或中途退出可能留下重复或孤立项，失败不会被显示为完整保存。

书签和历史先预览范围，确认后保存来源事实并尝试取得当前正文。记录时间与当前取得时间分别保留。登录、失效或不可读项保留来源和原因，支持停止、继续和失败重试；原书签删除不自动删除信息库资料。第三方收藏服务连接器仍待选定真实资料源。

阅读页提供文本、出处、附注、HTML 源码和原始 PDF 下载，不执行来源脚本。不承诺取得尚未加载、虚拟化移除、canvas、封闭组件或不可读跨域 frame 的正文；已发现缺口会标注。

Explain、Writing Assist、旧选区浮栏、图编辑侧栏和模型设置已彻底移除，没有开关、旧消息处理器或兼容运行入口。选区保存使用扩展按钮的新流程。旧连接和未完成摘录只做数据迁移，摘录需核对后手动迁入；已有 PostgREST 命名连接在一个事务中迁入，保留名称、当前选择和 Peer 身份。旧 HTTP API 地址及列表只保留原值供导出，不推断为 PostgREST 凭据；历史模型凭据留在私有存储中封存，不再执行或编辑，也不清空用户原数据。

升级时重新加载扩展，并刷新此前已注入旧浮栏的网页，让旧版本留在页面中的内容一并清除。

## 开发与验证

使用根仓库声明的 Node.js/pnpm 版本，运行 `pnpm install --frozen-lockfile`。本目录的 `pnpm dev`、`pnpm build` 面向 Chromium，`pnpm dev:firefox`、`pnpm build:firefox` 面向 Firefox；`pnpm type-check` 检查扩展。

两种构建都使用 Manifest V3，产物分别是 `.output/chrome-mv3` 和 `.output/firefox-mv3`。不要加载工作目录中可能残留的旧 `firefox-mv2` 产物。浏览器权限模式覆盖主机的各端口，自动采集仍由完整 origin 的启用/排除规则限定。

工具栏弹窗在自身文档根节点声明 380px 宽度，不用 `100vw` 限制其固有宽度，否则浏览器的初始窄视口会反过来压缩弹窗。回归测试通过 `action.openPopup()` 打开真实弹窗，从同扩展设置页读取 popup view 的布局，检查宽度、换行、横向溢出和设置入口可达性；普通标签页截图只补充检查内容外观。

设置页沿用 WebExt 原有的灰底方角卡片、白底字段、紧凑排版与 teal 主动作。公开 `ui-web` 组件承载控件，宿主通过原有 palette 适配系统 token；Switch 使用 `xs`，显示 ON/OFF，保留可访问名称、状态与键盘操作。宽屏、390px 窄屏和深色截图与尺寸检查属于 UI 回归。自动测试默认后台运行，不连接日常浏览器会话。

WebExt 固定使用正式发布的 `@inkcre/ui-web` 2.6.0，通过内置密码显隐能力、公开 `INK_I18N_KEY` 和中文词典提供按钮名称，不另写密码组件。2.5.0 和 2.6.0 的普通可编辑输入框都会额外渲染只读值和重复 ID，因此仓库分别维护版本限定的 pnpm patch，各修正一个渲染条件；升级到上游修复版后移除对应补丁。这次仅 WebExt 升级，client-web、twitter 和 ext-dev-utils 继续使用原 2.5.0 及其补丁，不改变组件 API、样式或仍使用 2.3.0 的扩展。

根目录 `pnpm test:e2e:webext` 真正加载扩展。指定 `INKCRE_CHROMIUM_BINARY=/Applications/Helium.app/Contents/MacOS/Helium` 使用 Helium 的隔离测试 profile，测试结束清理，不连接日常会话。真实数据旅程还需要可销毁数据库/PostgREST 的 `INKCRE_E2E_WEBEXT_PGREST` 与 `INKCRE_E2E_WEBEXT_JWT_SECRET`。测试副本只对合成 localhost 资料预授予权限；原生权限 UI 另行验证，生产 manifest 保持 optional 权限。

实现合同见[WebExt 运行时与材料](../../docs/30-unit-tdd/webext-collection.md)。安装、手动更新、旧身份迁移和 Changesets/GitHub Release 流程见[WebExt 版本与分发](../../docs/40-deployment/webext-delivery.md)。本地构建不等于发布；Firefox ZIP 尚未签名，不能作为正式安装包。

## Logo 素材

品牌素材由锁定的正式 npm 版本 `@inkcre/ui-web` 2.6.0 通过公开的 `@inkcre/ui-web/logo/*` 入口交付。设置页和 popup 直接导入原色与反白的 32px SVG；WXT 在 `build:publicAssets` 中解析同一安装包的 PNG，复制到产物的 `icon/*` 和 `toolbar/*`。仓库不保留另一份素材，也不从 ZIP 或 UI 源码 checkout 取构建输入。公开入口缺失时构建直接失败，不使用本地副本回退。

WebExt 负责把品牌素材装配为浏览器 AppIcon：选择尺寸、逻辑显示尺寸对应的几何、主题变体和 manifest 路径；UI 包提供品牌素材，不替扩展决定平台图标。工具栏的 16/32/48px 文件分别来自 optical 16px 的 1×/2×/3× 素材，不把标准大图缩到小尺寸。Chromium 不提供 Firefox 等价的原生主题图标声明，因此 `action.default_icon` 使用 `toolbar/canvas-*.png`，即 `original-white` 白底原色版，在两种工具栏背景上均可辨认，不为切换图标增加后台监听。

Firefox 通过 `action.theme_icons` 使用 `toolbar/*.png` 原色透明版与 `toolbar/reverse-*.png` 反白透明版，随浏览器工具栏主题选择。扩展管理图标同样使用白底原色：`icon/16.png`、`32.png` 使用小尺寸版，`48.png`、`128.png` 使用标准版，`96.png` 来自标准 48px 的 2× 导出。设置页和 popup 的 32px 标志使用原色与反白的 `optical-32` SVG，按系统浅深色选择；原生控件声明 `color-scheme: light dark`。素材沿用 UI 包记录的来源和品牌使用边界，没有新增许可授权。两种浏览器的发布产物检查会核对 manifest 路径、PNG 尺寸和对应安装包素材的字节。

## Hister 参考

Discourse 页面按已经取得的帖子结构生成可读正文，保留来源明确给出的帖号、作者、时间和正文中的链接与代码。
现场采集与公开 URL 导入共用这段解析；完整 HTML 材料沿用现有保存方式。缺少必要结构时沿用原有通用文本路径，
不补抓未加载帖子、不推断回复目标，也不生成模型摘要。该行为受 Hister 的来源专用 extractor 思路启发，独立实现。

采集与导入设计参考 [Hister](https://github.com/asciimoo/hister) 在已渲染页面、可见性/退避调度和已有资料迁移上的工作，感谢 Adam Tauber（asciimoo）及贡献者。研究固定于 `f1fff29683c8c8006a35d3387384d9b1e123cebe`（2026-10-21）。本实现没有复制其代码或素材；Hister 的 AGPL-3.0-or-later 许可与本项目许可分别适用，致谢不替代未来复用时的许可核对。

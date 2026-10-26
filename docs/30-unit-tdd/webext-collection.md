# WebExt 运行时与网页材料

`apps/client-webext` 是 WXT 浏览器 Peer，`packages/web-collection` 拥有网页材料的领域形状与普通图读写。它们共用 core 数据库、Storage 和 Resolver 能力，不依赖 client-web 私有代码，也不把业务编排放进数据库函数。

设置中的信息库连接代表本 WebExt 加入共享系统：PostgREST 是共享数据库协议的传输，不是一个接收 Peer。连接保存独立的本地标识、共享地址、凭据及本 Peer ID；本地标识用于维持待办归属，不创造数据库上的接收者身份。主人可直接读改完整配置，本机保存只验证输入，不等待网络。修改现有连接保留 connectionId/peerId；主人明确修正同库地址后，既有待办使用新地址。另一个信息库另建连接，不自动猜测两个地址是否属于同一系统。界面以“信息库 / 本 Peer / 加入信息库”呈现，不称“保存目标”。

WebExt 只交付采集、导入、保存结果与材料阅读。旧 Explain/Writing Assist、选区浮栏、图编辑侧栏及模型设置已经 hard-cutoff，不再打包旧页面、脚本或消息处理器，也不申请侧栏权限。旧连接与待办保留只读迁移，私有历史模型凭据不再参与任何执行路径。设置页延续原有 palette、方角灰底卡片和紧凑表单，不因业务重写改换视觉语言。

## 普通信息图

材料根使用 `extensions.web-collection.material.v1`，inline JSON 保存 mode、来源 scope/key/metadata、实际获取地址、时间、方式及覆盖说明。`extensions.web-collection.part.html|text|pdf` 出关系指向标准 `core.html.v1`、`core.text.v1`、`core.pdf.v1` 内容块；`extensions.web-collection.note` 指向独立 core text 附注。关联 ID 只在 Relation 中，不复制进根 JSON。

HTML/text 是 inline 语义内容，PDF 通过所选 Storage 保存实际字节。书签/历史具有独立原生身份与时间，使用 `extensions.web-collection.record.v1` 来源记录根，其 `extensions.web-collection.material` 出关系连接取得的材料。普通手动保存不额外建立一个没有独立用途的来源记录，也不创建 Source/Job。

根上的 `key` 是普通 text 列查询的派生筛选键，`request_id` 标识本机一次保存；它们不是全局唯一约束或另一个信息权威。`WebMaterialClient` 用普通 Block/Relation 查询筛选并核对完整身份。固定材料仅按同一次请求尽力复用；current 按本机 profile、完整地址和获取方式复用，允许同 URL 切账户后 current 被替换。主动保存和附注不与 current 共用可变内容。

`@inkcre/web-collection` 根入口只导出 DTO 和字节转换，避免 content script 连带加载 core 运行态。`/client` 是普通图读取/写入入口，接收固定 URL 和 token provider；`/resolvers` 提供两个根的 Resolver 实现，使用者像 core Resolver 一样绑定自己的呈现并注册。另一 Peer 可沿 Relation 直接读取标准语义内容，不要求 WebExt 在线；未安装领域解码能力的 Peer 不应猜测自定义根的含义。

## 生命周期与恢复

后台收到材料后先写本机 IndexedDB 待办，再分批发送。待办绑定连接，不读取发送时的全局当前连接。关系操作复用连接绑定的 DBAPIClient；PostgreSQLBinaryStorage 的已有字节传输支持注入同一连接和 token，不修改全局 SDK 配置。

Peer 登记和续租在本机初始化之后、新增连接或修改地址/密钥后及一分钟 alarm 中独立进行，不阻塞初始化、配置保存或材料 CRUD；纯改名或修改 PDF 存储不触发登记或重新请求主机权限。后台按连接复用 core WebPeerRuntime，地址、密钥或 Peer 身份变化时替换；同一 runtime 的并行检查共用正在进行的 Promise。错误呈现在对应连接下，成功后清除。90 秒租约是 best-effort 活跃信号，浏览器挂起可使其过期，不是数据库访问权限。没有增加常驻页面或另一套保活机制。

根存在不代表保存完成：本次所有部分及附注关系得到确认之后，才保存本机结果并释放载荷。恢复查询可见根与关系，继续缺失部分。不提供跨请求事务、全局 exactly-once、删除防复活或跨语句同快照；失联/并发可留下重复根、未关联语义块或 blob。失败保留待办及原因，不建设操作日志、补偿框架或孤儿清理器。

同一个后台只运行一个工作循环，每批最多发送三条，再推进一个导入阶段；只要有实际尝试或持久化进展就继续，没有可推进工作时退出。本轮记住已尝试的请求，失败不立即热重试，也不挡住后续请求；新操作或一分钟 alarm 可再次唤醒。UI 轮询只读状态。手动项先于导入与自动项；暂停自动队头不能阻塞手动。未发出的同一自动观察可合并，已发出的载荷不变。暂停、排除或撤权停止尚未派发的自动工作，已经派发的效果不保证取消。配额有界，满时停止新自动接纳，既有材料不静默丢弃。

浏览器导入有一个本机执行 owner，持久化范围、剩余项和必要阶段。来源事实先保存，正文取得失败不撤销已接受事实。单条失败不阻断整批，重跑尽力复用已知来源及材料，不维护长期完成清单。未来真实服务连接器可沿用 Source/Job 和精确 Peer 能力；本地 runner 不预建执行权转移、运行世代或共享 CAS。

已取得并入队的提交如果被拒绝，导入保留该条目的阶段、请求和载荷，暂停并显示错误；继续或重试发送原载荷，不重新抓取原站。只有取材本身失败的条目才进入“需补采”，这样原站后来失效也不会使本机已经接受的内容失去恢复入口。

## 浏览器边界

content script 不读取连接密钥，不初始化 core 配置，不提供任意 URL 特权代理。后台校验 sender、实际 tab/URL 和用户规则。密钥和大载荷保存在扩展源持久存储，旧的敏感连接/模型凭据/待办按实际 key 迁入；普通偏好保持原存储。

设置页、popup 和后台属于同一个可信 Peer，不构成主人不可跨越的权限层。状态投影为减小轮询载荷不包含密钥；打开连接编辑时，设置页直接读取同源 IndexedDB 中的完整连接，使用 InkUI 默认遮罩和内置显隐。设置初始化后正常读取不写回数据库。排除规则在打开编辑时回填，不因状态刷新改写草稿。

浏览器权限与脚本匹配使用不带端口的站点模式，因为 [Firefox 不支持匹配模式中的端口](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns)。这项浏览器授权覆盖该主机的端口；应用的启用/排除规则仍检查完整 origin，不因此自动采集其他端口。Firefox 在 SPA 导航后可能保留内容上下文初始 sender URL，因此 sender 校验核对来源 origin，入队时另核对材料完整 URL 与实际 tab URL，不能把合法 SPA 导航当成过期文档。

自动只观察非私密、可见且授权的页面，保留稳定等待、无变化退避、隐藏停止和 best-effort 离开收尾。采集的 HTML/文本排除脚本、未提交输入和扩展 UI，保留必要语义元数据。open Shadow DOM 与可读同源 frame 被读取，其他缺口标注，不声称复制完整页面。

SPA 路由使用 WXT 的 location-change 能力，不另建后台导航转发；重复注入由 WXT context 管理，并在 context 失效时移除消息监听器。

公开批量获取不带浏览账户凭据或 InKCre JWT，接受普通重定向和声明编码。出现密码字段本身不代表正文需要登录；解析器去掉表单后取得可读正文，空正文或短登录/验证码页面才报补采。Chrome 使用随包 offscreen 页面做 DOM 解析，Firefox 使用可用 DOM 环境。阅读仅以文本、源码和 PDF 原始字节展示，不执行来源脚本；不为读操作复制历史材料。

Discourse 页面的正文采用来源结构解析：识别 generator 标记及已取得的帖子容器，按页面顺序保留帖号、作者、
时间、正文、HTTP(S) 链接地址和代码。公开导入与现场采集复用 `logic/collection/discourse.ts`；现场解析使用已排除隐藏内容、
编辑草稿及活动代码的 DOM 副本。帖子结构不足或同号副本冲突时保留既有通用路径，不丢弃整份材料。
原 HTML 与 text 仍是现有语义 Block；这个函数不写图、不调用模型、不补抓帖子，也不推断缺失的回复关系。

Chromium 当前最低版本为 116，不能直接使用更高版本的 offscreen 检查接口而只靠类型检查宣布支持。Firefox 构建与运行分别验证。运行代码随扩展打包，不加载 client-web 的远程 Module Federation 模块。

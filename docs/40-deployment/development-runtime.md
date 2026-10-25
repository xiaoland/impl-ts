# Development Runtime

## TypeScript 与 Vue 检查

根目录、全部 workspace 和工具的传递依赖统一使用 `pnpm-workspace.yaml` 中的 TypeScript catalog。当前固定 `typescript-native-bridge@6.0.3-bridge.19.tsgo.7.0.2`：类型检查引擎为 TS7 7.0.2，兼容层保留 Vue、AST 合同脚本和声明生成所需的旧 Compiler API。这是 Vue 维护者采用的过渡方案，并非微软原版 `typescript@7` 包；直接替换为后者会使当前 `vue-tsc` 无法加载 `typescript/lib/tsc`。上游依据见 [Vue 的迁移记录](https://github.com/vuejs/language-tools/pull/6129)。

全库类型检查使用 `pnpm type-check`，它先验证工作区合同，再执行所有子包的 `type-check`。Core 使用 `tsc --noEmit`，Vue 包使用 `vue-tsc` 保留 script 与 template 检查；两者解析到同一编译器。`pnpm check` 和 CI 均包含该入口，不再保留独立的 `type-check:ts7` 或第二个编译器别名。局部迭代使用 `pnpm --filter <包名> type-check`，源码 UI 联调继续使用 `pnpm type-check:ui`。

`pnpm check:workspace` 验证根目录、子包、Vue 检查器和 Core 声明生成器实际解析到同一固定包。桥接层的 `tsc --version` 显示兼容 API 版本 `6.0.3`，实际类型检查会输出 `TNB ACTIVE`；完整包版本中的 `tsgo.7.0.2` 标识引擎版本。升级时同步验证 Vue 模板错误会被拒绝、浏览器运行时 AST 合同和 Core 声明消费，不以版本字符串代替行为验证。该原生依赖需要受支持的平台，CI 使用 Ubuntu/glibc。

浏览器源码检查通过 `tsconfig.browser.json` 明确跨包源码的 `rootDir`，保留原 Vue 配置的 ES2020／DOM 能力声明；它不扩大各包的 `include` 范围。`types/ui-web.d.ts` 仅补充 UI 2.3.0 已发布 CSS 子路径缺少的声明，其他缺失导入仍会失败。UI 源码联调按选定 checkout 与 impl-ts 的共同目录生成 `rootDir`，使用绝对路径映射，不再设置 `baseUrl`。

## 格式与 lint

`pnpm check` 在类型检查和构建前运行 `pnpm format:check` 与 `pnpm lint`，CI 使用同一入口。`pnpm lint` 包含类型感知规则并拒绝 warning；`pnpm lint:type-aware` 保留为同一命令的别名。修复格式使用 `pnpm format`。

格式与 lint 排除任务材料、外部维护的 `.agents/skills/` 和只读共享文档；各层 `playwright-report/` 与 `test-results/` 都是生成物。正式源码、测试和工具脚本仍在检查范围内。数据库生成投影仅豁免生成器产生的冗余／重复类型组合规则，继续接受其余 lint、格式、生成合同和类型检查。

规则例外必须说明真实合同。Twitter 可见区间使用 Unicode 码点，不能为了消除告警改成字素索引。顶层 `node:test` 注册显式丢弃返回 Promise，失败仍由测试运行器处理；子测试与业务异步操作仍须等待或处理失败。

## Capability Contract

The committed [`svc.json`](../../svc.json) declares four worktree-scoped capabilities: `database`,
`web`, `web-ui`, and `webext`. SVC resolves the worktree instance and coordinates provisioning and
readiness; [`scripts/dev.mjs`](../../scripts/dev.mjs) and the database runtime scripts own the
executable behavior. Observe without provisioning with `pnpm dev:status`, and run
`pnpm run doctor` before diagnosing host setup.

Portless gives the web and WXT targets instance-specific HTTPS `.localhost` routes. Their probes
accept only the expected target and worktree identity. Provisioning returns after readiness; it does
not transfer long-lived process ownership to SVC. The optional `web-ui` target is a non-release
source lane whose resolved checkout stays machine-local. Normal build, check, and CI continue to
use the locked Registry package.

`pnpm dev:webext` builds and watches the browser extension without requiring a browser. When
`INKCRE_CHROMIUM_BINARY` is supplied, the development browser uses the instance-owned profile under
`.runtime/dev/<instance>` rather than a shared user profile. Hosts that cannot perform Portless's
first-time privileged setup may place a consistent unprivileged `PORTLESS_PORT` and matching access
URLs in ignored `svc.local.json`; these are host facts, not repository defaults.

## Joint Development Lanes

`pnpm dev:all` runs the web Host with local Extension remotes. A missing remote output is built in a
separate process before mounting because Module Federation virtual modules are package-local; the
Host Vite process must not absorb a producer build. Producer playgrounds remain isolated lifecycle
and UI surfaces, not Host bootstrap authority.

The sibling `@inkcre/ui-web` source lane is an explicit non-release opt-in:

```bash
pnpm --dir ../ui install --frozen-lockfile
pnpm --dir ../ui generate
pnpm dev:ui --ui-source ../ui/packages/web
pnpm type-check:ui --ui-source ../ui/packages/web
```

Use `pnpm dev:all:ui --ui-source ../ui/packages/web` when a local Extension remote changes in the
same loop. The source root is validated for the exact package and public entries, remains
machine-local, and is never written to manifests or the lockfile. Do not use `pnpm link`, `file:`, a
temporary workspace member, or manifest/lockfile edits as a substitute. Normal development,
build, check, and CI stay Registry-backed.

Source mode aliases the package's public source entries and consumer-owned peer dependencies,
retains separate Sass ownership, and refuses `vite build`. Before handoff, stop the worktree,
remove `INKCRE_UI_SOURCE_ROOT` if set, and run the normal `pnpm check`; a green source loop is not
release evidence.

UI 2.0 的共享运行时是 Vue（最低 3.5.25）；使用 UnoCSS 的应用自行声明 UnoCSS。Web 的 Uno 配置在通用 preset 后注册
`@inkcre/ui-web/uno` 的 `presetInk()`，使语义颜色与字体工具类实际生成。
CodeMirror、JSON 语言服务等编辑器实现依赖由 UI 包拥有，源码联调也从 UI 自身解析它们。
Web、mail、twitter 和 ext-dev-utils 锁定同一正式 UI 版本；生产构建不使用源码映射。

维护 UI 消费代码前，从对应 workspace 的 `node_modules/@inkcre/ui-web/DESIGN.md`
读取同版本的设计决策，再按随包 `skills/ui-web/SKILL.md` 选择组件与组合指南。
各消费者的 `intent.skills` 已显式声明该包，可在相应 workspace 运行
`pnpm exec intent load @inkcre/ui-web#ui-web`（例如先 `cd apps/client-web`）。
仓库根目录只安装 Intent CLI，不另建一份 UI 依赖或复制 DESIGN.md；更新依赖时同步核对指南。

## Browser Runtime Configuration

The web settings UI owns the PostgREST URL, technical Peer ID, user-supplied JWT signing
credential, language, and full-browser import/export. The selected Peer's database row owns its Extension Registry URL and
other Peer configuration. A fresh browser origin has no environment selection. The explicit export includes the credential
so another browser can restore the same experience.

部署实例的连接地址、固定 Peer 身份和 JWT 凭据不能成为提交到仓库的默认值，也不能进入 source map、
Vite 变量、Cloudflare bindings 或浏览器产物。业务链接、第三方 API 地址、文档示例及公共产品 Registry
默认地址不选择用户连接的 InKCre 部署，无需逐条 URL 白名单。可执行检查入口为
[`scripts/check-local-runtime-contract.mjs`](../../scripts/check-local-runtime-contract.mjs) 和
[`scripts/check-package-contract.mjs`](../../scripts/check-package-contract.mjs)。

源码检查按用途检查 bootstrap/Peer 配置字段的赋值与默认值、数据库客户端地址、Registry 覆盖配置、
数据库签名凭据及浏览器扩展 API 默认值。它分析 JavaScript、TypeScript 和 Vue script 中的语法，
跟踪同文件字符串常量与 schema 默认值。同一个自定义域名用作业务链接时通过，写入部署配置时拒绝；
URL 路径和托管商域名都不是部署身份。跨模块导入的常量及任意跨模块数据流仍由代码审查负责。
`pnpm check:runtime` 先运行判定规则的行为回归，再检查所有浏览器消费者和原生扩展。
产物检查和正式 Web release 检查也先执行源码检查，再验证静态产物结构及已知凭据、旧配置通道的泄漏特征，
不根据托管商域名封锁业务链接。

## Database Providers and Ownership

The committed database provider is portable local Docker. Machine-specific selection belongs only
in ignored `svc.local.json`; [`scripts/database-provider.mjs`](../../scripts/database-provider.mjs)
owns provider parsing and transport safety.

- `local` uses the host Docker CLI and publishes collision-safe loopback ports.
- `ssh` uses one alias from the user's SSH configuration. The repository owns no hostname, user,
  key path, or remote Docker path. The remote engine allocates ports, and an instance-owned OpenSSH
  control tunnel exposes them locally; the optional forwarding host defaults to remote loopback.
- `external` attaches to one absolute, machine-local impl-py `runtime.json` descriptor. Attachment
  succeeds only for a development runtime owned by `InKCre/impl-py` when its runtime instance,
  Compose project, Docker daemon, contract revision, migration head, source fingerprint, descriptor,
  and live readiness agree.

For a client-owned `local` or `ssh` runtime, the database provisioner resolves impl-py's admitted
`stable` channel once to an immutable digest. The selected image supplies the raw schema and role
artifact; fresh pgvector PostgreSQL is restored before that exact core service reconciles runtime
credentials and development data, with PostgREST serving the resulting database. The PostgreSQL
health check uses TCP so the temporary socket-only initialization server cannot release the restore
step before the final server is listening. Client-web owns no
migration SQL, role definitions, seed ordering, or startup sleeps. Those semantics remain an impl-py
capability boundary. [`runtime/database.compose.yml`](../../runtime/database.compose.yml),
[`contracts/core-release.json`](../../contracts/core-release.json), and
[`scripts/database-runtime-lib.mjs`](../../scripts/database-runtime-lib.mjs) are the executable
owners.

`pnpm db:ready` emits machine-readable readiness. `pnpm db:reset` requires explicit confirmation,
accepts only a ready development runtime, and resets only this worktree's client-owned database.
`pnpm dev:stop` removes only this worktree's Portless routes and client-owned database/tunnel
resources. Client-web refuses to reset or stop an external core-py runtime; recovery and cleanup
must go through core-py. Browser E2E always creates and removes its own isolated database runtime.

`svc dev status database --repo . --json` 的 probe 输出区分 descriptor、contract 和 transport 阶段。
descriptor 失败应先核对 `svc.local.json` 指向的 owner 与 `runtime.json`；contract 失败会指出 readiness
与 descriptor 中不一致的字段；transport 输出分别列出 tunnel、Core `/readyz` 和 PostgREST 的探测结果。
成功输出还包含实际源码 fingerprint、migration head 和 contract revision。外接 descriptor 只证明它与
owner 已保存的 readiness 一致；当前 Python 工作树是否已收敛，仍应在 owner 仓运行同一 status 命令确认
`source_matches`。不要用 stop／reset 修复连接或候选错配，它们可能删除已有数据。

`pnpm doctor` 由已安装的 `svc status` 判断 SVC 配置有效性，不另行固定旧 schema／corpus 版本。
doctor 的 provider 检查不代表服务已就绪；业务验收前仍需检查上述 runtime probe。

The checked database projection records the contract revision intentionally adopted by this
consumer. Update it with `pnpm contract:sync` when client work adopts a newer compatible revision;
an unrelated pull request does not chase a moving `stable` channel. CI still resolves `stable` once
to an immutable image and runs that real core service through the isolated browser/database chain,
which proves the checked client remains compatible with current delivery. A breaking contract
revision requires the coordinated producer-first migration defined by the shared contract.
Pull-request evidence does not establish source-branch or migration equality between repositories.

尚未发布的候选 Core 可用 `pnpm contract:sync --image sha256:<完整的本地镜像 ID>` 生成投影，再用相同参数追加
`--check` 核对。镜像必须已存在于所选 local/ssh Docker daemon，工具核对 ID 并使用同一不可变镜像创建、清理
独占的 typegen 数据库，不接受可移动 tag，也不会拉取本地 ID。此入口不支持 external provider；需选择构建候选的
同一 provider。`contracts/core-release.json` 仍只接纳已发布的 GHCR digest，本地生成不能代替发布产物验收。

## Operator Commands

Run these from the repository root; [`package.json`](../../package.json) owns their exact carriers.

```bash
pnpm dev
pnpm dev:ui --ui-source ../ui/packages/web
pnpm dev:webext
pnpm dev:all
pnpm dev:status
pnpm dev:stop
pnpm db:ready
pnpm db:reset
pnpm contract:sync
pnpm test:e2e
```

Twitter 与本地 Core 镜像的候选验收保存在 `scripts/tests/`，不加入默认 `check`、`test:e2e` 或 CI 门禁。可独立执行：

```bash
pnpm verify:core-release
pnpm verify:twitter --list
pnpm verify:twitter
```

Twitter 验收需要预先启动且兼容的 Core、PostgREST、Web 和 Twitter MF 产物，并设置
`INKCRE_E2E_CORE_URL`、`INKCRE_E2E_POSTGREST_URL`、`INKCRE_E2E_WEB_URL`、
`INKCRE_E2E_JWT_SECRET`，以及 Python 交付 owner 报告的目标源码 `INKCRE_E2E_CORE_SOURCE_SHA`。
`--list` 不要求这些输入；实际运行缺输入会在写入前失败。

一次跨仓候选交接按以下顺序进行：

1. 选择独占的 Python Preview／信息库，取得其成功交付的 Core、PostgREST、SHA 和获授权凭据。
   owner 在自己的 Python Peer 选择、启用该候选 Registry 的 Twitter Python Distribution，并确认账户页可达。
   首次选择需要安装 wheel 时，宿主可能报告 `operation: restarting`；等待 readiness 恢复且该操作清空后再启用，
   不要把此时启用得到的 HTTP 409 当成安装失败。
   Core 镜像更新后，未启用的选择可能仍存在而 wheel 已不在新环境中；此时重新选择该精确版本完成安装，再等待重启并启用。
   不改其他 Peer 的选择；Python facade 与 Web MF facade 分别由各自 Peer 使用。
2. 从 TS Preview 摘要选择本次不可变 deployment URL，确认其 `/preview-candidate.json` 包含需要的 Twitter MF。
   `INKCRE_E2E_WEB_URL` 使用这个 URL，脚本据此配置本次新 Web Peer 的 Registry。
3. 将上述五项输入注入运行进程，执行 `pnpm verify:twitter`。不要 source dotenv 文件或把凭据写进提交、命令输出、
   截图和 trace。Core Cookie 连接需要真实安全浏览器上下文；本专项保留 Secure Cookie 和关闭 trace 的设置。
4. 查看本次测试目录的 `run.json`：它保留准备／提交／读取／索引／搜索／重开阶段、结果、Web 实际构建身份、Core 的
   声明源码与实际 Peer/version、原生 Distribution 的选择／加载／运行状态、数据库合同／head、实际 MF entry URL 和资源 origin 集合、fixture native IDs 与 Job／Block IDs。
   Core SHA 是部署 owner 的输入声明，脚本不把它冒充运行时独立读取的 SHA。失败时已写记录仍保留并标出阶段。
5. owner 在不再需要现场后清理整个独占信息库，例如关闭本次 Python PR 触发既有 Preview 清理。脚本不会根据
   标题、时间范围或前缀批删共享数据；保留现场时，下一轮使用新的 fixture stamp，记录也说明清理责任。

脚本先检查 Core readiness、信息库中匹配该 Core endpoint 的 live Peer、该 Peer 已加载并运行所选 Python Distribution，
以及 Web 构建身份，再开始账户连接。原生 status 只证明选择与运行状态，不独立证明 wheel 字节来自候选 Registry。
它会安装或启用本次 Web Peer 的 Twitter MF、写入测试数据并提交词法索引 Job，最后关闭原页并在新页从持久信息库
重开正文。页面重开没有注入初始配置，使用该浏览器实际保存的连接和 Peer 意图。截图和运行记录保存在
`test-results/twitter-acceptance/`，其中 `reopened.png` 对应这次重开。

这项证据涵盖 Chromium 的实际 HTTP／Cookie／数据库／MF 路径；原版 GM 的检测、提交和续签仍需实际 userscript
观察。Core 进程冷重启与真实视频播放没有由该脚本执行。源码 source lane 的快速迭代仍使用前述本地入口；本专项
要求已准备并可溯源的 Web 交付产物。

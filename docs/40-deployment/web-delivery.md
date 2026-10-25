# Web Delivery

## Artifact Contract

`apps/client-web` 构建静态且与部署环境无关的 Vite 产物。部署实例的连接地址、Peer 身份与 JWT 凭据
由运行时持有，不能编入生产或预览产物；公共业务链接和产品 Registry 默认地址不选择部署实例。
Pages 只提供静态托管，本仓库没有应用 Worker 或运行时配置接口。
[`scripts/verify-client-web-release.mjs`](../../scripts/verify-client-web-release.mjs) 和
[`scripts/check-package-contract.mjs`](../../scripts/check-package-contract.mjs) 共同执行此边界。
两个入口都先执行源码配置检查，再检查构建输出，独立 release 验证与 workspace CI 使用相同的部署配置规则。

The **Client checks** workflow in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
validates the candidate but uploads no deployable SPA, Module Federation, or Registry handoff
artifact. Preview and production each build at their own authority boundary and cannot publish
first-party Extensions.

The browser-side authority behind this invariant belongs to
[Client Runtime and Delegation](../30-unit-tdd/client-runtime-and-delegation.md).

`public/_headers` gives Vite's content-hashed `/assets/` files a one-year immutable browser
cache. HTML keeps Pages' revalidation policy so a new visit discovers the current asset names.
Do not place mutable files, Registry Release responses, or Extension executables in this cache
scope: their own delivery authority determines freshness and readability. Route views are split
into chunks and fetched on first navigation; repeat visits can reuse unchanged bytes.

## Production Pages

[`.github/workflows/pages-deploy.yml`](../../.github/workflows/pages-deploy.yml) owns production
delivery. A protected-`main` push selects that exact source SHA after strict required PR checks,
while delivery rejects the run if a newer revision supersedes it. The delivery job checks out the
exact source, installs the frozen workspace, builds the release, reverifies `main`, and deploys
those same-run bytes to the Cloudflare Pages `main` branch in the protected `production`
environment.

The workspace lock owns the exact Wrangler version, and Pages production/preview execute it through
the pinned pnpm toolchain. Preview cleanup is intentionally different: its tombstone is a standalone
static directory, so the cleanup action may use its isolated npm installation without entering the
pnpm workspace.

The Pages project is selected by `CLOUDFLARE_PAGES_PROJECT`; deployment uses the protected
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. After upload, the workflow smoke-tests both the
Pages deployment URL and `https://app.inkcre.dev`. Production delivery has no Extension Registry
token and no first-party Extension publication responsibility.

`INKCRE_WEB_PRODUCTION_PAUSED=true` pauses automatic main-push Pages and MF publication jobs.
It does not stop the currently deployed app, CI, previews or the independent Core SDK release.
Set it before merging a breaking protocol cutover. After the deployment owner confirms database
and service compatibility, explicitly dispatch `pages-deploy.yml` and `extension-release.yml`
on `main` with `source_sha` equal to its full current SHA. Each dispatch permits one delivery
while the variable remains true; it does not clear the pause or select a newer source silently.
Restore automatic delivery only after the cutover has been verified.

### Breaking database protocol upgrades

Pages delivery changes the HTML and assets served to new visits; it does not replace JavaScript
already running in an open tab. Client Web 0.1.2 and Core SDK 0.3 use the global Extension
`version`, `enabled` and `config_schema` columns. The Peer-participation migration removes those
columns, so an old tab can fail Extension reads and writes even while unrelated information remains
readable. Reloading before the matching App is deployed still loads an incompatible client.

The deployment owner coordinates a maintenance window across the affected Core/PostgREST deployment
and Client Web. Pause browser writes and close old connected tabs before the database cutover. Keep
the browser's connection settings and Peer ID. Resume use only after the deployment's
`extension-peer-participation-v2` database and management endpoint are ready and Client Web 0.1.3
has been deployed, then fully reload each connected tab. A startup error's Retry button performs
that full reload; it cannot repair an incompatible database or update a tab while it remains open.
The Core deployment documentation owns backup, migration and service recovery commands.

This maintenance sequence does not install, upgrade or enable Extensions. The new Host restores
existing enabled intent at the saved exact native version; it never substitutes latest. Historical
MF releases retain their original SDK range and may require the user to select a supported release
explicitly. Preserve shared configuration, state and stored information throughout the cutover.

## Core SDK assets

[`.github/workflows/core-sdk-release.yml`](../../.github/workflows/core-sdk-release.yml) independently
publishes the version declared by `packages/core/package.json` from protected main. It packs the
built ESM and type declarations as `inkcre-core-<version>.tgz`, alongside `source.json` containing
the source SHA and package SHA256, in the `core-v<version>` GitHub Release. It neither publishes
to npm nor selects an App or Extension version.

The candidate is retained before Release writes. Use **Re-run failed jobs** to recover publication
with the original artifact; a rerun without those bytes stops rather than rebuilding. Draft recovery
uploads only missing assets and compares existing bytes before completing the Release. An already
existing draft requires the original run's saved candidate; a new run cannot rebuild it.
An already
published version is verified against its source tag and recorded archive digest, never overwritten.
Keep unfinished candidates for their 90-day retention period; loss or expiry requires investigation.
An exact-current-main manual dispatch uses the same checks and publication boundary.

GitHub does not expose a draft through the release-by-tag endpoint. The trusted identity job reads
the release list with the same `contents: write` authority as publication so it can detect drafts;
that job installs no dependencies. Candidate builds retain read-only repository access.
Creation consumes the REST `201` response as the new Release identity, and asset uploads and
publication address that exact ID through the existing GitHub CLI. The publisher does not rediscover
a just-created draft through a potentially stale release list. Public verification still downloads
assets anonymously; comparisons of existing draft assets use authenticated reads.

If a publisher implementation needs repair, its original run still retains the package bytes.
Dispatch the corrected workflow on current main with `source_sha` selecting the controller and
`recovery_run_id` selecting that original run. Recovery admits only a completed main-push run of
this repository's Core SDK workflow whose source remains in current main history, with one
unexpired candidate. The controller SHA and payload source SHA intentionally differ: the saved
receipt, archive digest and original run source must agree, and publication retains the payload's
own version and tag. This entry cannot select an arbitrary artifact, URL or rebuilt package.
Creating a historical source tag after workflow files change may require an existing maintainer
identity; never substitute the current controller SHA or overwrite an existing tag to bypass it.

## Pull-request Preview

[`.github/workflows/pages-preview.yml`](../../.github/workflows/pages-preview.yml) owns previews for
open, same-repository pull requests targeting `main`; fork pull requests are ineligible. The
`pull_request_target` controller checks out its trusted default-branch revision separately from the
exact candidate head, installs the candidate's frozen pnpm and PDM environments, builds its SPA and
selected Module Federation snapshots, and uses `inkcre-ext preview build` with the explicit
`.github/preview/extensions.json` inventory to add a same-origin static Registry facade. The
current inventory includes the CalDAV, GitHub, Twitter and Mail Module Federation distributions. Before
deployment it revalidates that the PR is still open and its identity and head SHA have not changed.

The Toolkit places read-only native Extension snapshots and preview Releases beside the exact-head
app build, using the stable alias branch `preview/client-web/pr-<number>`. This is a preview
projection, not Registry publication: the workflow has no
`INKCRE_EXTENSION_REGISTRY_TOKEN`. It registers a transient GitHub `preview` deployment, deploys
through Pages and reports the provider deployment result. The GitHub environment links to the
Pages branch alias; the job summary includes that alias, the deployment-specific URL, and the exact
source SHA. This reporting reads Wrangler outputs without adding network acceptance checks.
Because `pull_request_target` uses the trusted base workflow, reporting changes take effect after
they reach `main`; they cannot rewrite summaries of completed runs. It does not turn edge propagation,
deep route traversal, cache behavior, or byte comparison into synchronous delivery gates; consumer
acceptance is a separate black-box activity.

Toolkit 完成校验后，trusted controller 的 `prepare-pages-preview.mjs` 只将部署暂存目录内 MF manifest
的 `publicPath` 改为 `auto`。锁定的 MF runtime 会以实际取得的 manifest URL 为基准解析资源，因此从
不可变 deployment URL 选择扩展时，remoteEntry 和分发资源不再被引向可更新的 PR alias。正式发布产物
不经过这项 Preview 适配。暂存目录禁止符号链接。

每次部署的 `/preview-candidate.json` 记录源码 SHA、run-attempt build ID 和各 MF manifest 路径。
不可变 deployment URL 标识本次交付；同一源码重建仍是不同候选，记录不提供字节相等性校验。
验收固定候选时，应将浏览器 Peer 的 Registry origin 指向该 deployment URL，并核对实际加载资源；
只打开快照 Web，不会覆盖浏览器已保存的 Registry。摘要明确区分静态部署成功与尚未执行的业务验收。

When an eligible internal PR closes, [`.github/workflows/pages-cleanup.yml`](../../.github/workflows/pages-cleanup.yml)
replaces only that exact preview alias with a closed-page tombstone. Manual cleanup accepts an
explicit positive PR number and applies the same closed internal-PR identity checks.

## 浏览器可选观测出口

部署 owner 先通过 impl-py 的部署配置流程创建 `inkcre.observability.v1`，保留稳定的
`deployment_id`，并按需填写 traces、logs、metrics 完整 OTLP/HTTP URL 与诊断入口。
浏览器不会因这些 URL 存在而自动启用；在连接设置中勾选遥测并保存后才接入。
只启用部分信号时其余信号不远端导出；没有有效共享配置时保留本地固定原因诊断，
修复配置后重新保存连接。取消勾选并保存可以停止新采集，PG 历史和 Job 查询不受影响。

浏览器出口必须是部署 owner 已验证的公开受限写入入口，或受控按请求转发入口；
不得把 Grafana/其他 SaaS 的服务端 ingest token 放入浏览器配置、URL、静态环境变量
或前端代码。URL 校验拒绝 userinfo、query 和 fragment，不接受任意自定义认证 headers。
如使用 core-py 的受控中转，在浏览器连接设置显式填写 `telemetry_peer_relay_url`，例如
`https://peer.example/telemetry`。SDK 追加 `/v1/{traces,logs,metrics}`，每批请求用现有
签名 authority 产生此连接的短期 Peer JWT；私密 SaaS headers 仍只在服务器。
浏览器三信号统一使用官方 OTLP/HTTP protobuf exporter 和 `application/x-protobuf`；
core 中转只接受此格式，Trace/Span ID 与 Links 由标准 protobuf 消息保留，不经过通用
JSON 字节转换。该地址需属于可信部署 Peer；填写地址不会启用遥测，失败也不会切回公开出口。
留空时沿用共享公开出口且不附加 Peer JWT。
负责入口的部署 owner 须验证 CORS、写入权限、部署归属、配额和失效行为。浏览器自报的
部署 ID 只是关联属性，不能作为授权依据。客户端不提供常驻 Collector，也不代表某个
SaaS 的真实账号、免费额度或入口已经验收。

Peer HTTP 入口需要在原有认证和 CORS 配置下允许 `traceparent`、`tracestate`；CORS
本身不授予调用权限。开启遥测的 Peer endpoint 必须直接响应，浏览器不跟随重定向，
避免向配置边界外的地址转发内部 context。OTLP 只包含操作名、固定结果、状态码、Job/Peer/部署标识与计时，
不包含请求 URL/query、prompt、工具原文或任意异常 message。受信部署 owner 配置出口，
外部观测服务获取这些元数据；误把私密凭据交给公开浏览器会跨越凭据边界，因此首次出口
验收只使用合成数据，直到公开入口和保留策略获得独立验证。

浏览器正常关闭 SDK 的等待上限为 1.5 秒；刷新、断网和进程终止仍可丢遥测。OTLP
失败不会重放业务请求，Peer 的 not-executed、unknown 和 exact-target 规则不变。
新增 Job carrier schema 按共享契约协调升级，旧页面重新连接前需刷新到匹配版本。

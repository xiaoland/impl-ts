import { appendFile } from 'node:fs/promises'

function pagesUrl(key) {
  const url = new URL(process.env[key])
  const publicOrigin =
    url.protocol === 'https:' &&
    url.hostname.endsWith('.pages.dev') &&
    !url.username &&
    !url.password &&
    !url.port &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  if (!publicOrigin) throw new Error(`Invalid Pages URL output: ${key}`)
  return url.origin
}

const previewUrl = pagesUrl('INKCRE_PREVIEW_URL')
const deploymentUrl = pagesUrl('INKCRE_PREVIEW_DEPLOYMENT_URL')
const revision = process.env.INKCRE_PREVIEW_SOURCE_SHA
if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Missing or invalid preview source SHA')
if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('Missing GitHub job summary path')

const summary = [
  '## Client-Web 预览',
  '',
  `- [打开 PR 预览](${previewUrl})`,
  `- [本次部署快照](${deploymentUrl})`,
  `- 源码提交：\`${revision}\``,
  `- [本次构建身份与 MF 清单](${deploymentUrl}/preview-candidate.json)`,
  `- 固定候选验收时，将浏览器 Peer 的 Registry origin 设为 \`${deploymentUrl}\`；仅打开此 Web 快照不会替换已保存的 Registry。`,
  '- 部署完成不代表信息库已连接、扩展已启用或业务旅程已通过；这些观察需对应本次候选单独记录。',
  '',
].join('\n')
await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
console.log(summary)

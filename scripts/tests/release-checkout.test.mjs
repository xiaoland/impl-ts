import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

void test('Changesets reads all pending intent in a shallow detached release checkout', async () => {
  const repository = fileURLToPath(new URL('../..', import.meta.url))
  const cli = createRequire(import.meta.url).resolve('@changesets/cli/bin.js')
  const checkout = await mkdtemp(path.join(os.tmpdir(), 'inkcre-release-checkout-'))
  const git = (...args) => execFileSync('git', args, { cwd: checkout, stdio: 'pipe' })
  const statusPath = path.join(checkout, 'status.json')
  const status = () =>
    execFileSync(process.execPath, [cli, 'status', '--output', statusPath], {
      cwd: checkout,
      stdio: 'pipe',
    })
  try {
    git('init', '--quiet')
    git('fetch', '--quiet', '--depth=1', pathToFileURL(repository).href, 'HEAD')
    git('checkout', '--quiet', '--detach', 'FETCH_HEAD')
    await symlink(path.join(repository, 'node_modules'), path.join(checkout, 'node_modules'), 'dir')
    await writeFile(
      path.join(checkout, '.changeset/shallow-checkout.md'),
      "---\n'@inkcre/ext-mail': patch\n---\nMail release fixture.\n"
    )
    assert.equal(git('rev-parse', '--is-shallow-repository').toString().trim(), 'true')
    assert.throws(status, (error) => {
      assert.match(error.output.join(''), /Failed to find where HEAD diverged from "main"/)
      return true
    })
    // The baseline is local to this immutable build checkout, not a moving remote branch.
    git('branch', 'main', git('rev-parse', 'HEAD').toString().trim())
    status()
    const plan = JSON.parse(await readFile(statusPath, 'utf8'))
    assert.ok(plan.changesets.some((changeset) => changeset.id === 'shallow-checkout'))
  } finally {
    await rm(checkout, { recursive: true, force: true })
  }
})

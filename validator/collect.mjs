import { readFile, stat } from 'node:fs/promises'
import { runDiagnostic } from './diagnostic.mjs'
import { ValidationError } from './validate.mjs'

const limit = 262144
const repository = process.env.GITHUB_REPOSITORY
const repositoryId = Number(process.env.DIAGNOSTIC_REPOSITORY_ID)
const frozenBaseSha = process.env.DIAGNOSTIC_BASE_SHA
const token = process.env.GITHUB_TOKEN

async function request(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  })
  if (!response.ok) throw new ValidationError('PROVIDER_UNAVAILABLE')
  if (response.headers.get('link')?.includes('rel="next"'))
    throw new ValidationError('INCOMPLETE_PROVIDER_RESPONSE')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > limit) throw new ValidationError('PROVIDER_RESPONSE_LIMIT')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ValidationError('INVALID_PROVIDER_JSON')
  }
}

function objectId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value))
    throw new ValidationError('INVALID_PROVIDER_OBJECT')
  return value
}

function diagnosticBlob(tree) {
  if (!Array.isArray(tree?.tree) || tree.truncated !== false)
    throw new ValidationError('INVALID_TREE')
  const entries = tree.tree.filter((entry) => entry.path === 'diagnostic-request.toml')
  if (entries.length !== 1 || entries[0].mode !== '100644' || entries[0].type !== 'blob')
    throw new ValidationError('NOT_REGULAR_DIAGNOSTIC')
  return objectId(entries[0].sha)
}

try {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    !Number.isSafeInteger(repositoryId) ||
    repositoryId <= 0 ||
    !/^[a-f0-9]{40}$/.test(frozenBaseSha ?? '') ||
    !token
  )
    throw new ValidationError('TRUSTED_CONFIGURATION_REQUIRED')
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath || (await stat(eventPath)).size > limit) throw new ValidationError('EVENT_LIMIT')
  const event = JSON.parse(await readFile(eventPath, 'utf8'))
  const pullNumber = event.number
  if (event.repository?.id !== repositoryId || !Number.isSafeInteger(pullNumber) || pullNumber <= 0)
    throw new ValidationError('WRONG_REPOSITORY_OR_PULL')
  const pullBefore = await request(`pulls/${pullNumber}`)
  if (pullBefore.base?.sha !== frozenBaseSha) throw new ValidationError('BASE_CHANGED')
  const expectedHeadSha = objectId(pullBefore.head?.sha)
  const fields =
    typeof pullBefore.body === 'string'
      ? pullBefore.body.split(/\r?\n/).filter((line) => line.startsWith('Dead-Channel-Attempt:'))
      : []
  if (fields.length !== 1) throw new ValidationError('INVALID_ATTEMPT_FIELD')
  const context = {
    repositoryId,
    pullNumber,
    frozenBaseSha,
    expectedHeadSha,
    authorId: pullBefore.user?.id,
    attemptId: fields[0].slice('Dead-Channel-Attempt: '.length),
  }
  const files = await request(`pulls/${pullNumber}/files?per_page=100`)
  if (!Array.isArray(files) || files.length !== 1) throw new ValidationError('EXTRA_CHANGES')
  const [baseCommit, headCommit] = await Promise.all([
    request(`git/commits/${frozenBaseSha}`),
    request(`git/commits/${expectedHeadSha}`),
  ])
  const [baseTree, headTree] = await Promise.all([
    request(`git/trees/${objectId(baseCommit.tree?.sha)}`),
    request(`git/trees/${objectId(headCommit.tree?.sha)}`),
  ])
  const [baseBlob, headBlob] = await Promise.all([
    request(`git/blobs/${diagnosticBlob(baseTree)}`),
    request(`git/blobs/${diagnosticBlob(headTree)}`),
  ])
  const pullAfter = await request(`pulls/${pullNumber}`)
  const result = runDiagnostic(
    {
      pullBefore,
      pullAfter,
      files,
      baseCommit,
      headCommit,
      baseTree,
      headTree,
      baseBlob,
      headBlob,
    },
    context,
    process.env.DIAGNOSTIC_SERVICE_PHONE,
  )
  process.stdout.write(`${JSON.stringify(result.proof)}\n${result.lines.join('\n')}\n`)
  process.exitCode = result.exitCode
} catch (error) {
  const code = error instanceof ValidationError ? error.code : 'DIAGNOSTIC_UNAVAILABLE'
  process.stderr.write(`${JSON.stringify({ outcome: 'rejected', code })}\n`)
  process.exitCode =
    code.endsWith('_CONFIGURED') || code === 'TRUSTED_CONFIGURATION_REQUIRED' ? 78 : 1
}

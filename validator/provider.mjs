import { ValidationError, validateDiagnostic } from './validate.mjs'

export { ValidationError } from './validate.mjs'

const limit = 262144

function objectId(value) {
  if (typeof value !== 'string' || value.length !== 40 || !/^[a-f0-9]{40}$/.test(value))
    throw new ValidationError('INVALID_PROVIDER_OBJECT')
  return value
}

function diagnosticBlob(tree) {
  if (!Array.isArray(tree?.tree) || tree.truncated !== false || tree.tree.length > 128)
    throw new ValidationError('INVALID_TREE')
  const entries = tree.tree.filter((entry) => entry?.path === 'diagnostic-request.toml')
  if (entries.length !== 1 || entries[0].mode !== '100644' || entries[0].type !== 'blob')
    throw new ValidationError('NOT_REGULAR_DIAGNOSTIC')
  return objectId(entries[0].sha)
}

export async function collectDiagnostic({ pullNumber, attemptId, frozenBaseSha, token, signal }) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0)
    throw new ValidationError('WRONG_REPOSITORY_OR_PULL')
  objectId(frozenBaseSha)
  if (
    attemptId !== undefined &&
    (typeof attemptId !== 'string' ||
      attemptId.length !== 36 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attemptId))
  )
    throw new ValidationError('INVALID_CONTEXT')
  const deadline = AbortSignal.timeout(25000)
  const collectionSignal = signal ? AbortSignal.any([signal, deadline]) : deadline

  async function request(path) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'EdgeOptic-Recovery-Diagnostic/2',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    let response
    try {
      response = await fetch(`https://api.github.com/repos/edgeoptic/E0-R8/${path}`, {
        headers,
        signal: AbortSignal.any([collectionSignal, AbortSignal.timeout(10000)]),
        redirect: 'manual',
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new ValidationError(`PROVIDER_HTTP_${response.status}`)
      }
      if (response.headers.get('link')?.includes('rel="next"')) {
        await response.body.cancel()
        throw new ValidationError('INCOMPLETE_PROVIDER_RESPONSE')
      }
      const reader = response.body.getReader()
      const chunks = []
      let size = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.length
          if (size > limit) throw new ValidationError('PROVIDER_RESPONSE_LIMIT')
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } catch {
        throw new ValidationError('INVALID_PROVIDER_JSON')
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error
      throw new ValidationError('PROVIDER_UNAVAILABLE')
    }
  }

  const pullBefore = await request(`pulls/${pullNumber}`)
  if (pullBefore?.base?.repo?.id !== 1416038012 || pullBefore.number !== pullNumber)
    throw new ValidationError('WRONG_REPOSITORY_OR_PULL')
  if (pullBefore.base.sha !== frozenBaseSha) throw new ValidationError('BASE_CHANGED')
  if (pullBefore.state !== 'open' || pullBefore.merged !== false || pullBefore.draft !== false)
    throw new ValidationError('PULL_NOT_READY')
  if (pullBefore.changed_files !== 1 || pullBefore.additions !== 2 || pullBefore.deletions !== 2)
    throw new ValidationError('EXTRA_CHANGES')
  const expectedHeadSha = objectId(pullBefore.head?.sha)
  const files = await request(`pulls/${pullNumber}/files?per_page=100`)
  if (!Array.isArray(files) || files.length !== 1) throw new ValidationError('EXTRA_CHANGES')
  const commits = await Promise.allSettled([
    request(`git/commits/${frozenBaseSha}`),
    request(`git/commits/${expectedHeadSha}`),
  ])
  const [baseCommit, headCommit] = settledValues(commits)
  const trees = await Promise.allSettled([
    request(`git/trees/${objectId(baseCommit?.tree?.sha)}`),
    request(`git/trees/${objectId(headCommit?.tree?.sha)}`),
  ])
  const [baseTree, headTree] = settledValues(trees)
  const blobs = await Promise.allSettled([
    request(`git/blobs/${diagnosticBlob(baseTree)}`),
    request(`git/blobs/${diagnosticBlob(headTree)}`),
  ])
  const [baseBlob, headBlob] = settledValues(blobs)
  const pullAfter = await request(`pulls/${pullNumber}`)
  const capture = {
    pullBefore,
    pullAfter,
    files,
    baseCommit,
    headCommit,
    baseTree,
    headTree,
    baseBlob,
    headBlob,
  }
  const proof = await validateDiagnostic(capture, {
    repositoryId: 1416038012,
    pullNumber,
    attemptId,
    frozenBaseSha,
    expectedHeadSha,
    authorId: pullBefore.user?.id,
  })
  return { proof, capture }
}

function settledValues(results) {
  const rejected = results.find((result) => result.status === 'rejected')
  if (rejected) throw rejected.reason
  return results.map((result) => result.value)
}

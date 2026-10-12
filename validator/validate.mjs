const target = 'diagnostic-request.toml'
const encoder = new TextEncoder()
const baseBytes = encoder.encode('request_id = ""\nrecovery_mode = "local-only"\n')
const shaPattern = /^[a-f0-9]{40}$(?![\s\S])/
const attemptPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$(?![\s\S])/

export class ValidationError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ValidationError'
    this.code = code
  }
}

function requireValue(condition, code) {
  if (!condition) throw new ValidationError(code)
}

function record(value, code) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), code)
  return value
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

async function gitBlobHash(bytes) {
  const prefix = encoder.encode(`blob ${bytes.length}\0`)
  const data = new Uint8Array(prefix.length + bytes.length)
  data.set(prefix)
  data.set(bytes, prefix.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function validateContext(value) {
  const context = record(value, 'INVALID_CONTEXT')
  requireValue(
    context.repositoryId === 1416038012 &&
      positiveInteger(context.pullNumber) &&
      positiveInteger(context.authorId),
    'INVALID_CONTEXT',
  )
  requireValue(
    typeof context.frozenBaseSha === 'string' && shaPattern.test(context.frozenBaseSha),
    'INVALID_CONTEXT',
  )
  requireValue(
    typeof context.expectedHeadSha === 'string' && shaPattern.test(context.expectedHeadSha),
    'INVALID_CONTEXT',
  )
  requireValue(
    context.attemptId === undefined ||
      (typeof context.attemptId === 'string' && attemptPattern.test(context.attemptId)),
    'INVALID_CONTEXT',
  )
  return context
}

function validatePull(value, context) {
  const pull = record(value, 'INVALID_PULL')
  const base = record(pull.base, 'INVALID_PULL')
  const repository = record(base.repo, 'INVALID_PULL')
  const head = record(pull.head, 'INVALID_PULL')
  const author = record(pull.user, 'INVALID_PULL')
  requireValue(
    pull.number === context.pullNumber && repository.id === context.repositoryId,
    'WRONG_REPOSITORY_OR_PULL',
  )
  requireValue(author.id === context.authorId, 'WRONG_AUTHOR')
  requireValue(base.sha === context.frozenBaseSha, 'BASE_CHANGED')
  requireValue(head.sha === context.expectedHeadSha, 'HEAD_CHANGED')
  requireValue(
    pull.state === 'open' && pull.merged === false && pull.draft === false,
    'PULL_NOT_READY',
  )
  requireValue(
    pull.changed_files === 1 && pull.additions === 2 && pull.deletions === 2,
    'EXTRA_CHANGES',
  )
  return pull
}

function validateTree(value, commitValue, expectedCommitSha) {
  const commit = record(commitValue, 'INVALID_COMMIT')
  const commitTree = record(commit.tree, 'INVALID_COMMIT')
  const tree = record(value, 'INVALID_TREE')
  requireValue(
    commit.sha === expectedCommitSha &&
      typeof commitTree.sha === 'string' &&
      shaPattern.test(commitTree.sha),
    'INVALID_COMMIT',
  )
  requireValue(
    tree.sha === commitTree.sha && tree.truncated === false && Array.isArray(tree.tree),
    'INVALID_TREE',
  )
  requireValue(tree.tree.length > 0 && tree.tree.length <= 128, 'TREE_LIMIT')
  const entries = new Map()
  for (const value of tree.tree) {
    const entry = record(value, 'INVALID_TREE_ENTRY')
    requireValue(
      typeof entry.path === 'string' &&
        entry.path.length > 0 &&
        entry.path.length <= 255 &&
        !entry.path.includes('/') &&
        !entry.path.includes('\0'),
      'INVALID_TREE_ENTRY',
    )
    requireValue(
      !entries.has(entry.path) && typeof entry.sha === 'string' && shaPattern.test(entry.sha),
      'INVALID_TREE_ENTRY',
    )
    requireValue(
      ['100644', '100755', '040000', '160000', '120000'].includes(entry.mode) &&
        ['blob', 'tree', 'commit'].includes(entry.type),
      'INVALID_TREE_ENTRY',
    )
    entries.set(entry.path, entry)
  }
  const diagnostic = entries.get(target)
  requireValue(
    diagnostic?.mode === '100644' && diagnostic.type === 'blob',
    'NOT_REGULAR_DIAGNOSTIC',
  )
  return entries
}

async function validateBlob(value, entry) {
  const blob = record(value, 'INVALID_BLOB')
  requireValue(
    blob.encoding === 'base64' &&
      Number.isSafeInteger(blob.size) &&
      blob.size > 0 &&
      blob.size <= 128 &&
      entry.size === blob.size,
    'INVALID_BLOB',
  )
  requireValue(typeof blob.content === 'string' && blob.content.length <= 256, 'BLOB_LIMIT')
  const encoded = blob.content.replace(/\n/g, '')
  requireValue(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) && encoded.length % 4 === 0, 'INVALID_BASE64')
  let decoded
  try {
    decoded = atob(encoded)
  } catch {
    throw new ValidationError('INVALID_BASE64')
  }
  requireValue(btoa(decoded) === encoded && decoded.length === blob.size, 'INVALID_BASE64')
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
  const sha = await gitBlobHash(bytes)
  requireValue(blob.sha === sha && entry.sha === sha, 'BLOB_ID_MISMATCH')
  return decoded
}

export async function validateDiagnostic(captureValue, contextValue) {
  const context = validateContext(contextValue)
  const capture = record(captureValue, 'INVALID_CAPTURE')
  validatePull(capture.pullBefore, context)
  requireValue(Array.isArray(capture.files) && capture.files.length === 1, 'EXTRA_CHANGES')
  const file = record(capture.files[0], 'INVALID_FILE_CHANGE')
  requireValue(
    file.filename === target &&
      file.status === 'modified' &&
      !Object.hasOwn(file, 'previous_filename'),
    'EXTRA_CHANGES',
  )
  requireValue(file.additions === 2 && file.deletions === 2 && file.changes === 4, 'EXTRA_CHANGES')
  const base = validateTree(capture.baseTree, capture.baseCommit, context.frozenBaseSha)
  const head = validateTree(capture.headTree, capture.headCommit, context.expectedHeadSha)
  requireValue(base.size === head.size, 'EXTRA_CHANGES')
  for (const [path, entry] of base) {
    if (path === target) continue
    const candidate = head.get(path)
    requireValue(
      candidate?.sha === entry.sha &&
        candidate.mode === entry.mode &&
        candidate.type === entry.type,
      'EXTRA_CHANGES',
    )
  }
  const baseText = await validateBlob(capture.baseBlob, base.get(target))
  requireValue(baseText === new TextDecoder().decode(baseBytes), 'WRONG_BASE_CONTENT')
  const headText = await validateBlob(capture.headBlob, head.get(target))
  const match = /^request_id = "([a-f0-9-]+)"\nrecovery_mode = "mirror"\n$/.exec(headText)
  requireValue(
    match !== null && match[0] === headText && attemptPattern.test(match[1]),
    'WRONG_REPAIR',
  )
  const attemptId = match[1]
  requireValue(context.attemptId === undefined || attemptId === context.attemptId, 'WRONG_ATTEMPT')
  requireValue(file.sha === head.get(target).sha, 'BLOB_ID_MISMATCH')
  validatePull(capture.pullAfter, context)
  return {
    validatorVersion: 'dc-diagnostic-v2',
    repositoryId: context.repositoryId,
    pullNumber: context.pullNumber,
    authorId: context.authorId,
    attemptId,
    headSha: context.expectedHeadSha,
    outcome: 'valid_data_change',
  }
}

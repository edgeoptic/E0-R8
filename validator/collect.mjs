import { open } from 'node:fs/promises'
import { collectDiagnostic, ValidationError } from './provider.mjs'
import { diagnosticResult } from './diagnostic.mjs'

async function readEvent(path) {
  if (!path) throw new ValidationError('EVENT_LIMIT')
  const handle = await open(path, 'r')
  try {
    const information = await handle.stat()
    if (!information.isFile() || information.size > 262144) throw new ValidationError('EVENT_LIMIT')
    const buffer = Buffer.alloc(262145)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > 262144) throw new ValidationError('EVENT_LIMIT')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)))
  } finally {
    await handle.close()
  }
}

try {
  if (
    process.env.GITHUB_REPOSITORY !== 'edgeoptic/E0-R8' ||
    !/^[a-f0-9]{40}$/.test(process.env.DIAGNOSTIC_BASE_SHA ?? '') ||
    !process.env.GITHUB_TOKEN
  )
    throw new ValidationError('TRUSTED_CONFIGURATION_REQUIRED')
  const event = await readEvent(process.env.GITHUB_EVENT_PATH)
  if (event?.repository?.id !== 1416038012) throw new ValidationError('WRONG_REPOSITORY_OR_PULL')
  const { proof } = await collectDiagnostic({
    pullNumber: event.number,
    frozenBaseSha: process.env.DIAGNOSTIC_BASE_SHA,
    token: process.env.GITHUB_TOKEN,
  })
  const result = diagnosticResult(proof)
  process.stdout.write(`${JSON.stringify(result.proof)}\n${result.lines.join('\n')}\n`)
  process.exitCode = result.exitCode
} catch (error) {
  const code = error instanceof ValidationError ? error.code : 'DIAGNOSTIC_UNAVAILABLE'
  process.stderr.write(`${JSON.stringify({ outcome: 'rejected', code })}\n`)
  process.exitCode = code === 'TRUSTED_CONFIGURATION_REQUIRED' ? 78 : 1
}

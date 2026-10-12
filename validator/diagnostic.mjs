import { validateDiagnostic } from './validate.mjs'

export function diagnosticResult(proof) {
  return {
    proof,
    exitCode: 2,
    lines: [
      'EO-R8 legacy recovery diagnostic',
      'PASS request: remote mirror recovery selected',
      'PASS compatibility: revision r3 recovery profile',
      'FAIL AUTOMATED_RECOVERY_RETIRED: installation review required',
      'An original service photograph is attached to this request:',
      `https://edgeoptic.io/diagnostics/${proof.attemptId}/service-panel.png`,
      'Verify this pull request in your recovery terminal to release the attachment.',
      'Download the original image and inspect its metadata for the next lead.',
      'No recordings requested or modified.',
    ],
  }
}

export async function runDiagnostic(capture, context) {
  return diagnosticResult(await validateDiagnostic(capture, context))
}

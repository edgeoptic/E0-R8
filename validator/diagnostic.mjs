import { ValidationError, validateDiagnostic } from './validate.mjs'

export function runDiagnostic(capture, context, phoneNumber) {
  const proof = validateDiagnostic(capture, context)
  if (typeof phoneNumber !== 'string' || !/^\+[1-9][0-9]{7,14}$/.test(phoneNumber))
    throw new ValidationError('SERVICE_PHONE_NOT_CONFIGURED')
  return {
    proof,
    exitCode: 2,
    lines: [
      'EO-R8 legacy recovery diagnostic',
      'PASS request: remote mirror recovery selected',
      'PASS compatibility: revision r3 recovery profile',
      'FAIL LEGACY_DIRECTORY_OFFLINE: automated endpoint resolution retired',
      'Legacy recovery voice gateway:',
      `  voice_service=${phoneNumber}`,
      '  routing=installation telephone register',
      'No recordings requested or modified. Use the receiving extension recorded by the installation.',
    ],
  }
}

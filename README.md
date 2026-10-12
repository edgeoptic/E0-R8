# EO-R8 legacy recovery diagnostic

A configuration diagnostic for EdgeOptic EO-R8 recorders whose original management workstation is unavailable. It checks the requested recovery profile and reports the available service route. It does not connect to a recorder, retrieve footage or change an installation.

## Choose the installation's recovery profile

`service-record.toml` tracks the recovery defaults used by this utility. The current revision describes local-only installations; it does not establish how an older installation was commissioned. Compare its revision history with the installation records before preparing a request.

The request is deliberately small: `diagnostic-request.toml` contains one `recovery_mode` value. Preserve its spacing and final newline. Change only that value; executable code, extra configuration and workflow changes are not accepted.

## Request a hosted diagnostic

The legacy routing reference is supplied by the hosted diagnostic environment. A local configuration edit alone cannot resolve it.

1. Fork this repository and edit `diagnostic-request.toml` for the installation you are investigating.
2. Open a pull request against the unchanged default branch. Do not request a merge: the proposed configuration is an individual diagnostic request, not an update to the shared defaults.
3. Include one line beginning `Dead-Channel-Attempt: ` followed by the attempt identifier from your recovery terminal. This is a public tracking reference, not a password. Do not include credentials or personal information.
4. Open the **EdgeOptic diagnostic** check and read the **Evaluate legacy recovery request** log. Request rejection and an unavailable legacy service are different results. Read the diagnostic output even when the check is red.
5. Return to the recovery terminal to verify the PR. Keep it open and leave its revision unchanged while verification completes.

This repository is a fictional technical investigation. Public checks cannot grant access to real recording systems.

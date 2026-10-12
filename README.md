# EO-R8 recovery utility

Legacy service profiles and hosted recovery diagnostics for the EdgeOptic EO-R8 recorder. The utility does not connect to a recorder or change its configuration.

## Find the installation's recovery mode

`service-record.toml` describes the current service defaults. Older commissioned installations may use an earlier revision. Open the file's **History** on GitHub and compare the revision with your installation's retained archive receipt.

## Request a hosted diagnostic

You need a GitHub account and a request ID issued by your recovery terminal. Your game login stays separate from GitHub.

1. In the recovery terminal, run `pr start`. Copy your request ID.
2. Open `diagnostic-request.toml` on GitHub and select the pencil to edit it. GitHub offers to create a fork if needed.
3. Put your request ID between the quotes for `request_id`. Change `recovery_mode` to the mode established by the installation's history. Preserve the two-line format and final newline; change no other file.
4. Propose the change as a pull request to this repository's default branch. The title and description are yours to write; neither carries the request ID for validation.
5. Open the pull request's **Checks**, select **EdgeOptic diagnostic**, then expand **Evaluate legacy recovery request**. A valid repair deliberately reaches a failed legacy diagnostic. Its log contains the original service photograph's URL.
6. Return to the recovery terminal and run `pr verify NUMBER`, replacing `NUMBER` with your pull request number. For example, pull request #12 uses `pr verify 12`. This independently verifies your request and releases its attachment.
7. Open the URL from the diagnostic log, download the original photograph and inspect its metadata.

The request changes only an isolated diagnostic input. It is never merged and cannot alter another player's recorder or request. Reopening the terminal preserves your issued ID. If you correct a rejected edit, commit the correction to the same pull request and inspect its new check.

A rejected input does not produce the photograph URL. Check that your request ID is complete, the recovery mode is correct, the pull request is open and not a draft, and only the two values in `diagnostic-request.toml` changed. A failed check by itself does not confirm the task; terminal verification does.

Pull requests, request IDs and diagnostic logs are public. Keep email addresses, passwords, tokens and personal details out of them.

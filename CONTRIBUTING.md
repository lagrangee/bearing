# Contributing

Thanks for considering a contribution to Bearing.

Bearing is a maintainer-led Public Preview, so the first contribution rule is alignment before effort.

## Development branches

`main` is the integration baseline. It remains buildable, testable, and installable, but a commit on `main` is not a formal release by itself.

Open pull requests from short-lived topic branches into `main`. Keep the branch current with `main`, and merge only after review and the required checks pass. Version Roadmaps such as 0.1.1 define product scope; they do not define long-lived development branches.

## Before opening a pull request

- Open or join an Issue or Discussion for substantive behavior, architecture, or product changes.
- Wait for maintainer confirmation before investing in larger work.
- Obvious typo fixes, small documentation corrections, and small test-only fixes may arrive directly as pull requests.

An Issue is not design approval, scheduling, or a delivery commitment.

## AI-assisted contributions

You may use Codex, Claude Code, or other coding agents. You do not need to disclose model, prompt, or session details.

The human pull-request author remains responsible for understanding the diff, correctness, tests, security, licensing, and third-party provenance. Low-signal bulk-generated submissions may be closed.

## License

By submitting a contribution, you agree that it is licensed under the MIT License and represent that you have the right to submit it. Bearing does not require a CLA or DCO for the Public Preview.

Forks may accurately describe their origin, but must not imply endorsement by Bearing or the maintainer.

## Verification

Use the current package scripts and release instructions. At minimum, run the checks relevant to your change and say what you ran in the pull request.

Every Codex E2E matrix, automated Codex journey, live gated E2E, and Codex release smoke run in this repository must follow the repository-wide [Codex E2E Policy](docs/agents/codex-e2e.md).

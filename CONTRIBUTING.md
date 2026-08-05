# Contributing

Thanks for considering a contribution to Bearing.

Bearing is a maintainer-led Public Preview, so the first contribution rule is alignment before effort.

## Development branches

`main` carries the latest released product source. The current development base is `0.1.1`.

Open pull requests against `0.1.1`. Unfinished maintainer work remains on topic branches and enters the version branch only after review and relevant checks pass.

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

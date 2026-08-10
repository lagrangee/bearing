# Security policy

Bearing is an open-source Public Preview. Please report vulnerabilities privately before opening a public issue.

## Supported versions

Only the latest Public Preview release line is expected to receive fixes. `0.x` releases may contain documented breaking changes.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/lagrangee/bearing/security/advisories/new). Public Preview activation is blocked unless that private route is enabled and verified; if the link does not open a private report form, do not file a public Issue or Discussion and treat the release intake as unavailable until the maintainer restores it.

Please include:

- affected version or commit;
- operating system and Node.js version;
- reproduction steps;
- expected impact;
- whether repository contents, local files, or network exposure are involved.

Do not include sensitive repository data unless the maintainer asks for the minimum necessary excerpt through a private channel.

## Boundary

Bearing is a local trusted-checkout tool with a loopback Portal. It provides no hosted service, no product-managed authentication, no public Internet Portal, and no telemetry. Public unauthenticated exposure is unsupported.

The repository's browser-only demo is a separate static sample with fixed mock data. It does not
read local repositories, start the Portal Host, call a provider or API, persist browser state, or
add analytics. It does not change the supported local Portal boundary. See
[Data and security](docs/data-and-security.md). GitHub Pages workflow activation and initial live
acceptance require explicit maintainer action; a green pull request does not publish or accept the
sample.

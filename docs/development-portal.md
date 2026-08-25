# Development Portal residency

The source checkout keeps the Development Portal on `127.0.0.1:4188` resident through one macOS
user LaunchAgent. This is development-machine infrastructure only. It is not packaged in the
Stable Kit, does not affect the public `bearing portal` command or port `4178`, and does not create
services for consumer repositories.

The LaunchAgent owns the foreground `bearing development portal` supervisor. The supervisor still
owns only its verified Development Portal child. `launchd` provides login startup and restarts the
supervisor after an unexpected exit; the supervisor continues to replace its child only after a
coherent Development Build Identity is published.

From the Bearing source checkout:

```sh
npm run dev:portal:install
npm run dev:portal:status
npm run dev:portal:uninstall
```

Installation writes one user plist at
`~/Library/LaunchAgents/com.lagrangee.bearing.development-portal.plist`. Logs are retained at
`~/Library/Logs/Bearing/development-portal.log` and
`~/Library/Logs/Bearing/development-portal.error.log`. The generated service uses the current
checkout's absolute repository, Node executable, and built CLI.

The installer validates `/healthz` on port `4188` before it reports success. A port conflict,
incoherent Development Runtime, or unhealthy child remains visible through the status command and
log files. The service does not inspect, terminate, or adopt an unknown process that owns `4188`.

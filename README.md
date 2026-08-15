# DeepSeek Harness — HarmonyOS Edition

English | [中文](README.zh.md)

This repository is a **fork of [deepseek-ai/DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness)** that adds first-class **HarmonyOS PC deployment support**. The fork keeps the upstream codebase intact (everything is a plugin, powered by [Cordis](https://github.com/cordiverse/cordis)) and layers deployment machinery on top, so you can run the full DeepSeek Harness (`dsh`) Web UI on a HarmonyOS PC through **two paths**:

| Path | Engine | Docs | Installer |
|---|---|---|---|
| **A — Native HarmonyOS** (recommended) | none — runs directly on the HarmonyOS host | [deploying-on-harmonyos-native.md](docs/cookbook/deploying-on-harmonyos-native.md) | [`scripts/dsh-hmos`](scripts/dsh-hmos) + [`scripts/dsh-hmos-patch.mjs`](scripts/dsh-hmos-patch.mjs) |
| **B — openEuler** | Huawei Fusion Development Engine | [deploying-on-harmonyos-openeuler.md](docs/cookbook/deploying-on-harmonyos-openeuler.md) | [`scripts/deploy-ohos-openeuler.sh`](scripts/deploy-ohos-openeuler.sh) |

## Why this fork

`dsh` upstream has no HarmonyOS support: the npm runtime bundles native modules (node-pty, koffi, sharp, ripgrep) that have no `openharmony-arm64` binaries, the host filesystem (hmdfs) rejects hard links and chmod, and the process sandbox has no backend (no bubblewrap, no Landlock, no user namespaces). This fork makes it work on a HarmonyOS PC (HongMeng Kernel, aarch64) by combining:

- **A one-shot management script** — [`scripts/dsh-hmos`](scripts/dsh-hmos): `start` / `stop` / `status` / `restart` / `update` / `repatch` / `exec`. `start` launches the Web UI with `setsid`, PID files, and HTTP liveness probing; `update` upgrades the npm package, replays every patch, rebuilds node-pty, reinstalls sharp-wasm32, and restarts — all idempotent.
- **A 10-patch idempotent patch set** — [`scripts/dsh-hmos-patch.mjs`](scripts/dsh-hmos-patch.mjs) (run via `dsh-hmos repatch`). The patches live in `node_modules`, so they are re-applied automatically on every upgrade:

| Patch | Module | Fix |
|---|---|---|
| P1 | `dsh-sandbox-local` | Lazy-load the win32-only windows-acl runner so **koffi never loads** on non-Windows (koffi has no openharmony binary) |
| P2a/b | `dsh-session-persistence-jsonl` | Replace `link()` with `rename()` for atomic session publish (hmdfs has no hard links → EPERM) |
| P3 | `dsh-credentials-local` | Skip the mode-660 check on openharmony (hmdfs ignores chmod) |
| P4 | `@vscode/ripgrep` | Fall back to the harmonybrew-installed `rg` (no platform package, stripped ELF cannot exec) |
| P5 | `dsh-fs-local` | `linkFile` falls back to `rename` on EPERM (hmdfs) while preserving the no-replace contract |
| P6a/b | `dsh-attachment-local` | Same link→rename fallback for content-addressed attachments |
| P7 | `dsh-attachment-local` | Stop the ancestor fsync ascent on EPERM/EACCES/EROFS — fixes image messages failing as `agent-busy` |
| P8 | `dsh-attachment-local` | Tolerate ENOENT on `unlink` after rename-publish |

- **Native module handling** — node-pty is built from source with the ohos-sdk clang toolchain (`node-gyp` + `make` + python3); sharp is swapped for the WebAssembly build `@img/sharp-wasm32`.
- **Sandbox note** — HarmonyOS has no usable sandbox backend, so the deployment runs with `DSH_PERMISSION_MODE=danger-full-access` (a documented upstream deployment switch) and pins the default permission preset to `danger-full-access` via the profile `cordis.patch.yml`.

## Run

### Run from `npm` (any supported host)

```sh
npx @deepseek-ai/dsh web
```

Serves the Web UI at `http://127.0.0.1:3080` by default. See the [Web UI guide](docs/user/guide/index.md).

### Run on a HarmonyOS PC

Follow the [native HarmonyOS cookbook](docs/cookbook/deploying-on-harmonyos-native.md) (path A) or the [openEuler cookbook](docs/cookbook/deploying-on-harmonyos-openeuler.md) (path B). After installing, manage the service with:

```sh
dsh-hmos start      # default http://127.0.0.1:3080
dsh-hmos status
dsh-hmos stop
dsh-hmos update     # upgrade dsh + re-apply patches + rebuild node-pty + restart
```

## Changes vs upstream

| Area | Change |
|---|---|
| HarmonyOS native deployment | `docs/cookbook/deploying-on-harmonyos-native.md` + `scripts/dsh-hmos` + `scripts/dsh-hmos-patch.mjs`: dependency install via harmonybrew, node-pty source build, sharp-wasm32, 10 patches, service management |
| openEuler deployment | `docs/cookbook/deploying-on-harmonyos-openeuler.md` + `scripts/deploy-ohos-openeuler.sh`: toolchain, Node.js 24, pnpm, clone, build, sandbox probe |
| Node/pnpm setup | Link `corepack` from the Node.js tarball; fall back to `sudo npm install -g pnpm` plus a PATH symlink (openEuler path) |
| Web UI over LAN | `crypto.randomUUID` is secure-context-only; ids are minted via `crypto.getRandomValues` so a LAN-served UI works |
| Trust fence | `settings.describe` and `credentials.describe/set/unset` moved behind the `trustedHosts` fence so the model page works over LAN |

## Community and support

- Upstream feedback and bug reports: [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- HarmonyOS-specific issues found in this fork (e.g. the image-message `agent-busy` misreport): see [docs/cookbook/upstream-issue-harmonyos-attachment-busy.md](docs/cookbook/upstream-issue-harmonyos-attachment-busy.md).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join the DeepSeek Harness community (see the upstream README for channels).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

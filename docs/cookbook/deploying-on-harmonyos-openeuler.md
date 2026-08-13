# Cookbook: deploy dsh on a HarmonyOS PC (openEuler)

English | [中文](deploying-on-harmonyos-openeuler.zh.md)

This guide runs the DeepSeek Harness on a HarmonyOS PC inside the Huawei Fusion Development Engine, which provides an openEuler Linux environment without code changes to the repository. It covers environment preparation, deployment, sandbox probing, and a smoke test. The repository works unmodified because openEuler is a standard Linux: Node.js, pnpm, and every native module (esbuild, sharp, node-pty, `node-addon-require-builtin`) resolve through their existing linux-arm64 packages.

## Prerequisites

| Item | Requirement |
|---|---|
| Device | HarmonyOS PC (for example MateBook) with HarmonyOS 6.0.0.130 or later |
| Engine | Fusion Development Engine installed from AppGallery, providing openEuler |
| Network | Engine network mode set to NAT (host-only cannot reach the internet) |
| Node.js | The repository requires `^22.19.0 \|\| >=24.0.0`; this guide installs Node 24 |
| Architecture | aarch64 (Kirin) shown here; substitute `linux-x64` and `x86_64` on an x86 device |

## 1. Prepare the openEuler environment

### 1.1 Verify the network

```sh
sudo dnf check-update
curl -fsSI https://registry.npmjs.org
```

If DNS fails, edit `/etc/resolv.conf` to a reachable nameserver (the engine's default is documented in the Huawei support page).

### 1.2 Install the toolchain

```sh
sudo dnf install -y git make gcc-c++ python3 binutils tar xz
```

The C++ toolchain compiles node-pty from source during `pnpm install`; `binutils` and `tar` serve the Node.js archive and native builds.

### 1.3 Install Node.js 24

The openEuler repository ships an older Node.js (about v20), so install the official binary:

```sh
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.8.0/node-v24.8.0-linux-arm64.tar.xz
sudo tar -xJf node-v24.8.0-linux-arm64.tar.xz -C /usr/local
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/node /usr/local/bin/node
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/npm /usr/local/bin/npm
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/npx /usr/local/bin/npx
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/corepack /usr/local/bin/corepack
```

Verify:

```sh
node -v   # expect v24.8.0 or later
```

### 1.4 Install pnpm

```sh
corepack enable
corepack prepare pnpm@11.7.0 --activate
```

If `corepack` is unavailable, install pnpm through npm instead. The Node tree is root-owned, so the global install needs `sudo`:

```sh
sudo npm install -g pnpm@11.7.0
```

npm installs pnpm into the Node tree's `bin` directory, which is not on PATH; link it alongside the other Node commands:

```sh
sudo ln -sf "$(npm prefix -g)/bin/pnpm" /usr/local/bin/pnpm
```

Verify:

```sh
pnpm -v   # expect 11.7.0
```

## 2. Deploy the repository

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm build
```

`pnpm install` compiles node-pty locally (the allowBuilds list permits its lifecycle script) and fetches the linux-arm64 prebuilt binaries for esbuild and sharp. A China network can set `npm config set registry https://registry.npmmirror.com` before installing.

Verify:

```sh
pnpm dsh --version
```

## 3. Probe the sandbox

The repository's only Linux sandbox backends are bwrap and the Landlock launcher. Probe both before choosing the sandbox mode; unsupported backends fail closed with `SANDBOX_UNAVAILABLE` rather than running unconfined.

### 3.1 Landlock launcher

The launcher is a workspace dependency of `sandbox-local`, so its symlink lives under that package's `node_modules`, not the repository root; npm cannot install it here (the repository uses the `workspace:` protocol). Probe from the `sandbox-local` directory:

```sh
cd packages/sandbox/sandbox-local
node --input-type=module -e "import { launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run'; console.log(await probe(launcherPath()))"
```

The verdict is `full`, `partial`, or `unusable`. Landlock requires kernel 5.13+ with the LSM enabled; openEuler 24.03 ships kernel 6.6, but the Fusion Development Engine image decides the LSM config, so the probe is the authority.

### 3.2 bubblewrap

```sh
sudo dnf install -y bubblewrap
bwrap --ro-bind / / --dev /dev --unshare-all true
```

bwrap needs user namespaces; the engine does not allow kernel modification, so a failure here cannot be fixed from inside.

### 3.3 Choose the sandbox mode

| Landlock verdict | bwrap works | Sandbox mode |
|---|---|---|
| `full` or `partial` | any | default (confined) |
| `unusable` | yes | default (confined) |
| `unusable` | no | `danger-full-access` |

A `danger-full-access` profile is acceptable here because the openEuler environment is itself an isolated virtual machine; see [the sandbox subsystem](../subsystems/sandbox.md) for the mode contract.

## 4. Configure and smoke test

```sh
export DEEPSEEK_API_KEY=...
pnpm dsh --profile headless "list the current directory"
```

Verify:

```sh
pnpm dsh --profile headless "echo harness-ok"
```

A persistent PTY session follows the same path through `ctx.terminals`; the default `/bin/bash` exists in openEuler, so the `terminal-bash` backend needs no configuration.

## 5. Known limitations

- **No systemctl** — the Fusion Development Engine does not support service management; run `dsh web` as a foreground or nohup process instead of installing a unit.
- **openEuler only** — the engine does not install other Linux distributions yet.
- **No bridged networking** — the engine exposes only NAT and host-only modes, so the HarmonyOS browser cannot reach an `dsh web` listener in openEuler directly; access it from another machine on the LAN or via `hdc` port forwarding.
- **No kernel modification** — `modprobe` and friends are unavailable, which is why Landlock and user namespaces cannot be enabled after the fact.
- **Persistence** — the virtual disk persists across reboots; use the engine's snapshot feature (up to five) before upgrades, and exchange files with the HarmonyOS side through the shared folder `/mnt/linux_share`.

## References

- [development.md](../development.md) — contributor setup and daily workflow
- [sandbox subsystem](../subsystems/sandbox.md) — sandbox seam and mode contract
- [`node-addon-landlock-run`](../../native/landlock-run/README.md) — Landlock launcher support matrix

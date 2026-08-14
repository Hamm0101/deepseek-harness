# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## HarmonyOS PC (openEuler) deployment

This fork adds deployment support for HarmonyOS PC: the Huawei Fusion Development Engine provides an openEuler Linux environment where `dsh` runs unmodified. The full walkthrough lives in the [cookbook guide](docs/cookbook/deploying-on-harmonyos-openeuler.md); a one-shot installer is [`scripts/deploy-ohos-openeuler.sh`](scripts/deploy-ohos-openeuler.sh).

### Changes vs upstream

| Area | Change |
|---|---|
| Deploy script | `scripts/deploy-ohos-openeuler.sh`: toolchain, Node.js 24, pnpm, clone, build, sandbox probe |
| Node/pnpm setup | Link `corepack` from the Node.js tarball; fall back to `sudo npm install -g pnpm` plus a PATH symlink |
| Sandbox probe | Probe the Landlock launcher from `sandbox-local` (workspace dependency); auto-install `bubblewrap`; fail closed when unusable |
| Web UI over LAN | `crypto.randomUUID` is secure-context-only; mint ids via `crypto.getRandomValues` so a LAN-served UI works |
| Trust fence | `settings.describe` and `credentials.describe/set/unset` moved to the `trustedHosts` fence so the model page works over LAN |

### Install

Prerequisites: a HarmonyOS PC (HarmonyOS 6.0 or later) with the Fusion Development Engine installed, providing an openEuler environment. The engine network mode must be NAT.

```sh
sh scripts/deploy-ohos-openeuler.sh
```

The script installs the toolchain and Node.js 24, then clones, installs, builds, and probes the sandbox. For a manual install:

```sh
sudo dnf install -y git make gcc-c++ python3 binutils tar xz
curl -fsSLO https://nodejs.org/dist/v24.8.0/node-v24.8.0-linux-arm64.tar.xz
sudo tar -xJf node-v24.8.0-linux-arm64.tar.xz -C /usr/local
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/node /usr/local/bin/node
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/npm /usr/local/bin/npm
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/npx /usr/local/bin/npx
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/corepack /usr/local/bin/corepack
corepack enable
corepack prepare pnpm@11.7.0 --activate
git clone https://github.com/Hamm0101/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm build
```

### Run

```sh
pnpm dsh web
```

The Web UI serves at `http://127.0.0.1:3080` by default. To reach it from the HarmonyOS browser across the openEuler NAT network, bind all interfaces through the profile patch and open `http://<openEuler-ip>:3080`; the cookbook guide covers host binding and the known limitations (NAT-only networking, no systemctl, Landlock unavailable).

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

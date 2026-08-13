#!/usr/bin/env bash
# One-shot deployment of DeepSeek Harness on a HarmonyOS PC inside the Huawei
# Fusion Development Engine (openEuler). Mirrors the numbered steps in
# docs/cookbook/deploying-on-harmonyos-openeuler.md; the engine must already be
# running and its network mode set to NAT.
#
# Steps: preflight (Node/pnpm/git), toolchain, Node.js 24, pnpm, clone, install,
# build, sandbox probe, smoke test. Each step can be skipped via DSH_SKIP_*.
#
# Environment:
#   DSH_NODE_VERSION  Node line to install, default v24.8.0
#   DSH_REPO_DIR      clone target, default $HOME/deepseek-harness
#   DSH_REPO_URL      repository to clone, default https://github.com/deepseek-ai/deepseek-harness.git
#   DSH_SKIP_TOOLCHAIN=1  skip dnf toolchain install (already present)
#   DSH_SKIP_NODE=1       skip Node.js install/upgrade (already correct)
#   DSH_SKIP_PNPM=1       skip pnpm install (already correct)
#   DSH_SKIP_CLONE=1      skip clone (repo already present)
#   DSH_SKIP_BUILD=1      skip pnpm install + build (already built)

set -euo pipefail

node_version="${DSH_NODE_VERSION:-v24.8.0}"
repo_dir="${DSH_REPO_DIR:-$HOME/deepseek-harness}"
repo_url="${DSH_REPO_URL:-https://github.com/deepseek-ai/deepseek-harness.git}"

say() { printf '\n==> %s\n' "$*"; }

# ---- preflight: fail loud before any expensive work --------------------
say "Preflight: node, pnpm, git"

node_missing=0
if ! command -v node > /dev/null 2>&1; then
  node_missing=1
elif ! node -e 'const m=/^v(\d+)\.(\d+)/.exec(process.version);process.exit((m[1]>24||(m[1]==24)||(m[1]==22&&m[2]>=19))?0:1)' 2>/dev/null; then
  node_missing=1
fi
if [ "$node_missing" -eq 1 ]; then
  echo "Node.js missing or below engines (^22.19 || >=24); will install ${node_version}." >&2
fi

pnpm_missing=0
if ! command -v pnpm > /dev/null 2>&1; then
  pnpm_missing=1
elif ! pnpm -v > /dev/null 2>&1; then
  pnpm_missing=1
fi
if [ "$pnpm_missing" -eq 1 ]; then
  echo "pnpm missing; will install 11.7.0 via corepack." >&2
fi

if ! command -v git > /dev/null 2>&1; then
  echo "git is required. Install it: sudo dnf install -y git" >&2
  exit 1
fi

# ---- 1. toolchain -------------------------------------------------------
if [ "${DSH_SKIP_TOOLCHAIN:-0}" != "1" ]; then
  say "Install toolchain (gcc/make/python3/binutils)"
  sudo dnf install -y git make gcc-c++ python3 binutils tar xz
else
  say "Skip toolchain install (DSH_SKIP_TOOLCHAIN=1)"
fi

# ---- 2. Node.js 24 ------------------------------------------------------
if [ "$node_missing" -eq 1 ] && [ "${DSH_SKIP_NODE:-0}" != "1" ]; then
  say "Install Node.js ${node_version} from nodejs.org"

  case "$(uname -m)" in
    aarch64|arm64) arch=arm64 ;;
    x86_64|amd64)  arch=x64 ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac

  tarball="node-${node_version}-linux-${arch}.tar.xz"
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  (cd "$tmpdir" && curl -fsSLO "https://nodejs.org/dist/${node_version}/${tarball}" \
    && sudo tar -xJf "$tarball" -C /usr/local)
  sudo ln -sf "/usr/local/node-${node_version}-linux-${arch}/bin/node" /usr/local/bin/node
  sudo ln -sf "/usr/local/node-${node_version}-linux-${arch}/bin/npm" /usr/local/bin/npm
  sudo ln -sf "/usr/local/node-${node_version}-linux-${arch}/bin/npx" /usr/local/bin/npx
  node -v
else
  say "Use existing Node.js $(node -v 2>/dev/null || echo '(none)')"
fi

# ---- 3. pnpm ------------------------------------------------------------
if [ "$pnpm_missing" -eq 1 ] && [ "${DSH_SKIP_PNPM:-0}" != "1" ]; then
  say "Install pnpm 11.7.0 via corepack"
  corepack enable
  corepack prepare pnpm@11.7.0 --activate
  pnpm -v
else
  say "Use existing pnpm $(pnpm -v 2>/dev/null || echo '(none)')"
fi

# ---- 4. clone -----------------------------------------------------------
if [ "${DSH_SKIP_CLONE:-0}" != "1" ]; then
  if [ -d "$repo_dir/.git" ]; then
    say "Repository present at $repo_dir; leave as is"
  else
    say "Clone $repo_url"
    git clone "$repo_url" "$repo_dir"
  fi
else
  say "Skip clone (DSH_SKIP_CLONE=1)"
fi

# ---- 5. install + build -------------------------------------------------
if [ "${DSH_SKIP_BUILD:-0}" != "1" ]; then
  say "pnpm install (compiles node-pty locally)"
  (cd "$repo_dir" && pnpm install)
  say "pnpm build"
  (cd "$repo_dir" && pnpm build)
else
  say "Skip install/build (DSH_SKIP_BUILD=1)"
fi

# ---- 6. sandbox probe ---------------------------------------------------
say "Probe sandbox backends (Landlock launcher, bwrap)"
(cd "$repo_dir" && npm i -D @deepseek-ai/node-addon-landlock-run > /dev/null \
  && node --input-type=module -e \
    "import { launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run'; console.log('landlock:', await probe(launcherPath()))" \
  || echo "landlock: unusable (probe failed)")
if command -v bwrap > /dev/null 2>&1; then
  if bwrap --ro-bind / / --dev /dev --unshare-all true > /dev/null 2>&1; then
    echo "bwrap: ok"
  else
    echo "bwrap: unusable (user namespaces unavailable)"
  fi
else
  echo "bwrap: not installed"
fi

# ---- 7. smoke test ------------------------------------------------------
say "Deployment complete"
echo "Next steps:"
echo "  export DEEPSEEK_API_KEY=...  (or write .env in $repo_dir)"
echo "  cd $repo_dir && pnpm dsh --profile headless \"echo harness-ok\""
echo "Read docs/cookbook/deploying-on-harmonyos-openeuler.md for the full guide."

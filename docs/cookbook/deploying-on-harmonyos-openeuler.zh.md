# 实操手册：在鸿蒙 PC（openEuler）上部署 dsh

[English](deploying-on-harmonyos-openeuler.md) | 中文

本手册在鸿蒙 PC 的华为「融合开发引擎」内运行 DeepSeek Harness，该引擎提供一个 openEuler Linux 环境，无需修改仓库代码。内容涵盖环境准备、部署、沙箱探测与冒烟测试。仓库无需改动即可运行，因为 openEuler 是标准 Linux：Node.js、pnpm 以及全部原生模块（esbuild、sharp、node-pty、`node-addon-require-builtin`）都能通过现有的 linux-arm64 包解析。

## 前置条件

| 项目 | 要求 |
|---|---|
| 设备 | 鸿蒙 PC（如 MateBook），系统 HarmonyOS 6.0.0.130 及以上 |
| 引擎 | 从应用市场（AppGallery）安装「融合开发引擎」，提供 openEuler |
| 网络 | 引擎网络模式设为 NAT（host-only 无法访问互联网） |
| Node.js | 仓库要求 `^22.19.0 \|\| >=24.0.0`；本手册安装 Node 24 |
| 架构 | 以下以 aarch64（麒麟）为例；x86 设备请将 `linux-x64` 与 `x86_64` 替换对应值 |

## 1. 准备 openEuler 环境

### 1.1 验证网络

```sh
sudo dnf check-update
curl -fsSI https://registry.npmjs.org
```

如果 DNS 解析失败，请编辑 `/etc/resolv.conf` 填入可达的 nameserver（引擎默认值见华为支持页面文档）。

### 1.2 安装工具链

```sh
sudo dnf install -y git make gcc-c++ python3 binutils tar xz
```

C++ 工具链用于在 `pnpm install` 期间从源码编译 node-pty；`binutils` 与 `tar` 服务于 Node.js 压缩包与原生构建。

### 1.3 安装 Node.js 24

openEuler 仓库自带的 Node.js 版本过旧（约 v20），因此安装官方二进制包：

```sh
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.8.0/node-v24.8.0-linux-arm64.tar.xz
sudo tar -xJf node-v24.8.0-linux-arm64.tar.xz -C /usr/local
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/node /usr/local/bin/node
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/npm /usr/local/bin/npm
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/npx /usr/local/bin/npx
sudo ln -sf /usr/local/node-v24.8.0-linux-arm64/bin/corepack /usr/local/bin/corepack
```

验证：

```sh
node -v   # expect v24.8.0 or later
```

### 1.4 安装 pnpm

```sh
corepack enable
corepack prepare pnpm@11.7.0 --activate
```

如果 `corepack` 不可用，可通过 npm 安装 pnpm。Node 目录归 root 所有，因此全局安装需要 `sudo`：

```sh
sudo npm install -g pnpm@11.7.0
```

npm 会把 pnpm 装进 Node 目录的 `bin` 子目录，该目录不在 PATH 中；请与其他 Node 命令一样建立软链：

```sh
sudo ln -sf "$(npm prefix -g)/bin/pnpm" /usr/local/bin/pnpm
```

验证：

```sh
pnpm -v   # expect 11.7.0
```

## 2. 部署仓库

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm build
```

`pnpm install` 会本地编译 node-pty（allowBuilds 列表放行了它的生命周期脚本），并为 esbuild 与 sharp 拉取 linux-arm64 预编译二进制。国内网络可先执行 `npm config set registry https://registry.npmmirror.com` 再安装。

验证：

```sh
pnpm dsh --version
```

## 3. 探测沙箱

仓库仅有的 Linux 沙箱后端是 bwrap 与 Landlock 启动器。选择沙箱模式前先探测两者；不受支持的后端会以 `SANDBOX_UNAVAILABLE` 关闭执行，而不会在无约束状态下运行。

### 3.1 Landlock 启动器

```sh
npm i -D @deepseek-ai/node-addon-landlock-run
node --input-type=module -e "import { launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run'; console.log(await probe(launcherPath()))"
```

探测结果为 `full`、`partial` 或 `unusable`。Landlock 需要内核 5.13+ 且启用该 LSM；openEuler 24.03 自带 6.6 内核，但 LSM 配置由融合开发引擎镜像决定，因此以探测结果为准。

### 3.2 bubblewrap

```sh
sudo dnf install -y bubblewrap
bwrap --ro-bind / / --dev /dev --unshare-all true
```

bwrap 需要 user namespaces；引擎不允许修改内核，因此此处失败无法从内部修复。

### 3.3 选择沙箱模式

| Landlock 结果 | bwrap 可用 | 沙箱模式 |
|---|---|---|
| `full` 或 `partial` | 任意 | 默认（受限） |
| `unusable` | 是 | 默认（受限） |
| `unusable` | 否 | `danger-full-access` |

此处使用 `danger-full-access` 配置可接受，因为 openEuler 环境本身就是隔离的虚拟机；模式契约见[沙箱子系统](../subsystems/sandbox.md)。

## 4. 配置并冒烟测试

```sh
export DEEPSEEK_API_KEY=...
pnpm dsh --profile headless "list the current directory"
```

验证：

```sh
pnpm dsh --profile headless "echo harness-ok"
```

持久 PTY 会话经由 `ctx.terminals` 走同一路径；openEuler 自带默认的 `/bin/bash`，因此 `terminal-bash` 后端无需任何配置。

## 5. 已知限制

- **无 systemctl** —— 融合开发引擎不支持服务管理；请以前台或 nohup 进程运行 `dsh web`，而非安装 systemd 单元。
- **仅 openEuler** —— 引擎暂不支持安装其他 Linux 发行版。
- **无桥接网络** —— 引擎仅提供 NAT 与 host-only 两种模式，因此鸿蒙浏览器无法直接访问 openEuler 中的 `dsh web` 监听端口；请从局域网内其他机器访问，或通过 `hdc` 端口转发。
- **无法修改内核** —— `modprobe` 等命令不可用，这也是 Landlock 与 user namespaces 无法事后开启的原因。
- **持久化** —— 虚拟磁盘在重启后保留；升级前请使用引擎的快照功能（最多 5 个），并通过共享文件夹 `/mnt/linux_share` 与鸿蒙侧交换文件。

## 参考

- [development.md](../development.md) —— 贡献者环境与日常工作流
- [沙箱子系统](../subsystems/sandbox.md) —— 沙箱 seam 与模式契约
- [`node-addon-landlock-run`](../../native/landlock-run/README.md) —— Landlock 启动器支持矩阵

# DeepSeek Harness — 鸿蒙版

[English](README.md) | 中文

本仓库是 [deepseek-ai/DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness) 的 **fork**，在其基础上增加了对**鸿蒙 PC 的一等部署支持**。fork 保持上游代码不变（一切皆插件，由 [Cordis](https://github.com/cordiverse/cordis) 驱动），在之上叠加部署机制，使完整的 DeepSeek Harness（`dsh`）Web UI 可以通过**两条路径**运行在鸿蒙 PC 上：

| 路径 | 引擎 | 文档 | 安装器 |
|---|---|---|---|
| **A — 鸿蒙原生部署**（推荐） | 无——直接在鸿蒙宿主上运行 | [deploying-on-harmonyos-native.md](docs/cookbook/deploying-on-harmonyos-native.md) | [`scripts/dsh-hmos`](scripts/dsh-hmos) + [`scripts/dsh-hmos-patch.mjs`](scripts/dsh-hmos-patch.mjs) |
| **B — openEuler** | 华为融合开发引擎 | [deploying-on-harmonyos-openeuler.zh.md](docs/cookbook/deploying-on-harmonyos-openeuler.zh.md) | [`scripts/deploy-ohos-openeuler.sh`](scripts/deploy-ohos-openeuler.sh) |

## 为什么有这个 fork

`dsh` 上游没有鸿蒙支持：npm 运行时自带的原生模块（node-pty、koffi、sharp、ripgrep）没有 `openharmony-arm64` 二进制；鸿蒙文件系统（hmdfs）拒绝硬链接且 chmod 无效；进程沙箱无可用后端（无 bubblewrap、无 Landlock、无 user namespaces）。本 fork 通过以下方式让它在鸿蒙 PC（HongMeng Kernel，aarch64）上可用：

- **一键管理脚本** —— [`scripts/dsh-hmos`](scripts/dsh-hmos)：`start` / `stop` / `status` / `restart` / `update` / `repatch` / `exec`。`start` 用 `setsid` 拉起 Web UI，带 PID 文件与 HTTP 探活；`update` 升级 npm 包、重放全部补丁、重建 node-pty、重装 sharp-wasm32 并重启——全程幂等。
- **10 处补丁的幂等补丁集** —— [`scripts/dsh-hmos-patch.mjs`](scripts/dsh-hmos-patch.mjs)（通过 `dsh-hmos repatch` 执行）。补丁位于 node_modules，升级后自动重打：

| 补丁 | 模块 | 修复内容 |
|---|---|---|
| P1 | `dsh-sandbox-local` | 惰性加载仅 win32 使用的 windows-acl runner，**非 Windows 永不加载 koffi**（koffi 无 openharmony 二进制） |
| P2a/b | `dsh-session-persistence-jsonl` | 会话原子发布用 `rename()` 替换 `link()`（hmdfs 无硬链接 → EPERM） |
| P3 | `dsh-credentials-local` | openharmony 上跳过 mode-660 检查（hmdfs 忽略 chmod） |
| P4 | `@vscode/ripgrep` | 回退到 harmonybrew 安装的 `rg`（无平台包，strip 过的 ELF 无法执行） |
| P5 | `dsh-fs-local` | `linkFile` 在 EPERM（hmdfs）时回退 `rename`，同时保留 no-replace 不覆盖语义 |
| P6a/b | `dsh-attachment-local` | 内容寻址附件同样做 link→rename 回退 |
| P7 | `dsh-attachment-local` | 祖先目录 fsync 上行遇 EPERM/EACCES/EROFS 时停止——修复图片消息被误报为 `agent-busy` |
| P8 | `dsh-attachment-local` | rename 发布后容忍 `unlink` 的 ENOENT |

- **原生模块处理** —— node-pty 用 ohos-sdk 的 clang 工具链从源码构建（`node-gyp` + `make` + python3）；sharp 换成 WebAssembly 版 `@img/sharp-wasm32`。
- **沙箱说明** —— 鸿蒙无可用沙箱后端，部署以 `DSH_PERMISSION_MODE=danger-full-access` 运行（上游官方部署开关），并通过 profile 的 `cordis.patch.yml` 把默认权限预设钉为 `danger-full-access`。

## 运行

### 通过 `npm` 运行（任意受支持的主机）

```sh
npx @deepseek-ai/dsh web
```

默认在 `http://127.0.0.1:3080` 提供 Web UI。详见 [Web UI 指南](docs/user/guide/index.md)。

### 在鸿蒙 PC 上运行

按[鸿蒙原生 cookbook](docs/cookbook/deploying-on-harmonyos-native.md)（路径 A）或 [openEuler cookbook](docs/cookbook/deploying-on-harmonyos-openeuler.zh.md)（路径 B）部署。安装后用以下命令管理服务：

```sh
dsh-hmos start      # 默认 http://127.0.0.1:3080
dsh-hmos status
dsh-hmos stop
dsh-hmos update     # 升级 dsh + 重打补丁 + 重建 node-pty + 重启
```

## 相对上游的改动

| 领域 | 改动 |
|---|---|
| 鸿蒙原生部署 | `docs/cookbook/deploying-on-harmonyos-native.md` + `scripts/dsh-hmos` + `scripts/dsh-hmos-patch.mjs`：harmonybrew 装依赖、node-pty 源码构建、sharp-wasm32、10 处补丁、服务管理 |
| openEuler 部署 | `docs/cookbook/deploying-on-harmonyos-openeuler.md` + `scripts/deploy-ohos-openeuler.sh`：工具链、Node.js 24、pnpm、clone、构建、沙箱探测 |
| Node/pnpm 安装 | 从 Node.js 压缩包链接 `corepack`；回退到 `sudo npm install -g pnpm` 并补 PATH 软链（openEuler 路径） |
| Web UI 局域网访问 | `crypto.randomUUID` 仅限安全上下文；改用 `crypto.getRandomValues` 生成 id，使局域网 UI 可用 |
| 信任栅栏 | 将 `settings.describe` 与 `credentials.describe/set/unset` 移到 `trustedHosts` 栅栏，使模型页在局域网可用 |

## 社区与支持

- 上游反馈与 bug 报告：请走 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。
- 本 fork 发现的鸿蒙特有问题（如图片消息 `agent-busy` 误报）：见 [docs/cookbook/upstream-issue-harmonyos-attachment-busy.md](docs/cookbook/upstream-issue-harmonyos-attachment-busy.md)。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 社区（渠道见上游 README）。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

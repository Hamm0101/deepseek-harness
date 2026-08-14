# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## 鸿蒙 PC（openEuler）部署

本 fork 增加了对鸿蒙 PC 的部署支持：华为「融合开发引擎」提供 openEuler Linux 环境，`dsh` 无需改动即可运行。完整指南见 [cookbook 文档](docs/cookbook/deploying-on-harmonyos-openeuler.zh.md)；一键安装脚本为 [`scripts/deploy-ohos-openeuler.sh`](scripts/deploy-ohos-openeuler.sh)。

### 相对上游的改动

| 领域 | 改动 |
|---|---|
| 部署脚本 | `scripts/deploy-ohos-openeuler.sh`：工具链、Node.js 24、pnpm、clone、构建、沙箱探测 |
| Node/pnpm 安装 | 从 Node.js 压缩包链接 `corepack`；回退到 `sudo npm install -g pnpm` 并补 PATH 软链 |
| 沙箱探测 | 从 `sandbox-local`（workspace 依赖）探测 Landlock 启动器；自动安装 `bubblewrap`；不可用时 fail closed |
| Web UI 局域网访问 | `crypto.randomUUID` 仅限安全上下文；改用 `crypto.getRandomValues` 生成 id，使局域网 UI 可用 |
| 信任栅栏 | 将 `settings.describe` 与 `credentials.describe/set/unset` 移到 `trustedHosts` 栅栏，使模型页在局域网可用 |

### 安装

前置条件：鸿蒙 PC（HarmonyOS 6.0 及以上）+ 已安装「融合开发引擎」，提供 openEuler 环境。引擎网络模式必须为 NAT。

```sh
sh scripts/deploy-ohos-openeuler.sh
```

脚本会安装工具链与 Node.js 24，然后执行 clone、install、build 与沙箱探测。手动安装：

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

### 运行

```sh
pnpm dsh web
```

Web UI 默认服务在 `http://127.0.0.1:3080`。若要从鸿蒙浏览器跨 openEuler 的 NAT 网络访问，请通过 profile patch 绑定所有接口，再打开 `http://<openEuler-ip>:3080`；host 绑定与已知限制（仅 NAT 网络、无 systemctl、Landlock 不可用）见 cookbook 指南。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

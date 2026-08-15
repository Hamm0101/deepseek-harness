# 鸿蒙 PC 上直接部署 deepseek-harness（懒加载 koffi 方案）

> 适用机器：鸿蒙 PC（HongMeng Kernel 1.13.0，AArch64，Toybox），即本机。
> 目标：不依赖鸿蒙融合开发引擎，直接在本机 Node.js 上跑 `@deepseek-ai/dsh` Web UI。
> 方案：**koffi 不构建**，通过 win32 条件惰性导入使非 Windows 平台永不加载 koffi —— 免去 cmake/ninja/toolchain/构建这一整条链路。
> 依据：https://github.com/shd101wyy/deepseek-harness-harmonyos（第 12 节对比了该方案，gitcode 用户已实测可用）；补丁内容与对方 `reapply-koffi-patch.sh` 一致。

---

## 0. 方案总览

| 原生依赖 | 处理方式 | 是否构建 |
|---|---|---|
| node-pty | node-gyp 从源码构建（需要 make + python3 + clang） | ✅ 构建（唯一构建项） |
| koffi | **不构建**。patch `dsh-sandbox-local`，把对 windows-acl 的导入改为 win32 条件惰性加载，非 win32 永不加载 | ❌ 免构建 |
| sharp | 换 `@img/sharp-wasm32` WebAssembly 版 | ❌ 免构建 |
| @vscode/ripgrep | 系统无对应平台包，patch 回退到 harmonybrew 的 `rg` | ❌ 免构建 |

副作用（可接受）：进程沙箱在鸿蒙上不可用（无 bwrap/landlock/user namespaces），须以 `DSH_PERMISSION_MODE=danger-full-access` 启动，工具调用不再逐次询问审批。

---

## 1. 本机环境现状（2026-08-15 实测）

| 项 | 状态 | 值 |
|---|---|---|
| 系统 | ✅ | `HarmonyOS localhost HongMeng Kernel 1.13.0 ... aarch64 Toybox` |
| 包管理 | ✅ | harmonybrew，前缀 `/storage/Users/currentUser/.harmonybrew` |
| node | ✅ | v22.23.2（满足 dsh engines `^22.19.0 \|\| >=24.0.0`） |
| npm | ✅ | 12.0.2；`npm prefix -g` = `/storage/Users/currentUser/.harmonybrew` |
| python3 | ✅ | 已有（brew `python@3.12`），node-gyp 可用 |
| clang / clang++ | ❌ 缺 | 由 `ohos-sdk` 提供，需装 |
| make | ❌ 缺 | node-pty 构建用，需装 |
| ripgrep | ❌ 缺 | 搜索工具回退目标，需装 |
| cmake / ninja | ❌ 缺 | **本方案不需要**（那是 koffi 构建的依赖） |
| npm registry | ⚠️ 官方源 | 官方源在本机不可用，必须切 npmmirror |
| dsh | ❌ 未装 | 待安装 |

> 注意：README 参考环境装了 `cmake/ninja/python@3.14`，那是为了 **koffi 源码构建**。本方案免构建 koffi，`cmake`、`ninja` 一律不需要；python3 已有 3.12 即可，无需再装 3.14。

---

## 2. 安装依赖

```sh
# clang/clang++（node-pty 构建必需，本机无 cc/gcc 必须显式指定）
brew install ohos-sdk

# make（node-gyp 构建 node-pty 必需，勿漏）
brew install make

# ripgrep（dsh 搜索工具回退目标）
brew install ripgrep
```

装完确认：

```sh
command -v clang clang++ make python3 rg
# 预期均输出 /storage/Users/currentUser/.harmonybrew/bin/...
```

---

## 3. 安装 dsh（npmmirror + 跳过构建脚本）

```sh
# 切镜像（官方源在本机不可用）
npm config set registry https://registry.npmmirror.com

# 先跳过所有构建脚本，把 JS 层装好（koffi 本就不需要构建；
# node-pty 的安装脚本会失败，这正是要跳过的）
npm install -g @deepseek-ai/dsh --ignore-scripts --registry=https://registry.npmmirror.com
```

安装位置（后续所有路径以此为准）：

```sh
ls /storage/Users/currentUser/.harmonybrew/lib/node_modules/@deepseek-ai/dsh
```

---

## 4. 构建 node-pty（唯一需要构建的原生模块）

```sh
cd /storage/Users/currentUser/.harmonybrew/lib/node_modules/@deepseek-ai/dsh/node_modules/node-pty
export CC=/storage/Users/currentUser/.harmonybrew/bin/clang
export CXX=/storage/Users/currentUser/.harmonybrew/bin/clang++
node /storage/Users/currentUser/.harmonybrew/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild
```

> 本机无 cc/gcc，只有 ohos-sdk 的 clang；make 默认 `CC=cc`，不显式指定会报 `cc: command not found`。

---

## 5. sharp 换 WebAssembly 版（免构建）

```sh
cd /storage/Users/currentUser/.harmonybrew/lib/node_modules/@deepseek-ai/dsh
npm install @img/sharp-wasm32 --ignore-scripts --registry=https://registry.npmmirror.com --no-save
```

---

## 6. 十处必需 patch（都在 node_modules 内，升级 dsh 后需重打）

> 补丁一律用文本工具手工改，或直接 `dsh-hmos repatch` 幂等重放。**P4/P5/P6/P7/P8（ripgrep、fs-local、attachment-local）为惰性或失败回退路径**，patch 后无需重启即可生效（P5/P6 在 link 失败时才走 rename 回退，P7/P8 在祖先目录受限/已发布时才触发，正常运行不受影响）；**P1–P3 修改的是启动时加载的模块代码，需重启 web 实例后生效**。

### P1【核心】koffi 免构建：`dsh-sandbox-local` 惰性加载 windows-acl

- **源码依据**：`deepseek-harness/packages/sandbox/sandbox-local/src/index.ts:40` 顶层 `import { AclWriteGrant, assertTempRootOutsideWorkspace, tempWriteSid, workspaceWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl'`；windows-acl 包内 `ffi.ts:11` 顶层 `import koffi from 'koffi'`。
- **为什么安全**：这 4 个符号只被类方法内部使用（`workspaceGrants/tempCapabilities` 字段与 `materializeAclGrant` 等方法），且 windows-acl rung 只在 `PLATFORM_CHAINS.win32` 链被选中（`index.ts:165`）；鸿蒙平台永远走不到这些代码。
- **文件**：`node_modules/@deepseek-ai/dsh-sandbox-local/lib/index.js`（dist 产物，顶层 import 约在第 10 行附近，按实际文件定位）。
- **改法**：把对 `@deepseek-ai/dsh-sandbox-windows-acl` 的顶层值导入改为 win32 条件惰性 `await import()`——非 win32 时永不加载该模块，从而 koffi 永不加载。可直接参考 gitcode 仓库 `u010189254/dsh-harmonyos-deploy` 的 `reapply-koffi-patch.sh`（作者已确认与该脚本完全匹配）。

### P2 会话保存 EPERM link：`dsh-session-persistence-jsonl`

- **源码依据**：`packages/session/session-persistence-jsonl/src/index.ts:549` `await link(tmp, finalPath)`（发布用 `link()+unlink()`，hmdfs 不支持硬链接 → EPERM）。
- **文件**：`node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js`（约第 1128 行）。
- **改法**：同文件系统内同样原子的 `rename(tmp, finalPath)` 替换（Windows 路径本就用的 rename 系实现，不回归）；同时把 `import { link, ... }` 改成 `import { rename, ... }`。

### P3 凭据文件 mode 660 检查：`dsh-credentials-local`

- **源码依据**：`packages/credentials/credentials-local/src/index.ts:113` `if (process.platform === 'win32') return`（hmdfs 上 chmod 无效，所有文件固定 660）。
- **文件**：`node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js`（约第 88 行）。
- **改法**：`if (process.platform === "win32" || process.platform === "openharmony") return;`（该平台权限由系统管理，chmod 无意义）。

### P4 搜索工具回退系统 ripgrep：`@vscode/ripgrep`

- **原因**：dsh 通过 `@vscode/ripgrep` 按 `process.platform` 拼平台包，`openharmony-arm64` 无对应包；官方 `linux-arm64` 静态二进制是 strip 过的 ELF，hmdfs 拒绝 exec。
- **文件**：`node_modules/@vscode/ripgrep/lib/index.js`（在 dsh 的 node_modules 下）。
- **改法**：catch 分支里为 openharmony 平台回退到 harmonybrew 的 `rg`，候选含 `~/.harmonybrew/bin/rg` 与烘焙的绝对路径：

```js
} catch {
    const candidates = [
        `${require('node:os').homedir()}/.harmonybrew/bin/rg`,
        '/storage/Users/currentUser/.harmonybrew/bin/rg',
    ];
    if (process.platform === 'openharmony') {
        resolved = candidates.find((p) => require('node:fs').existsSync(p));
    }
    if (!resolved) {
        throw new Error(/* 原错误 */);
    }
}
```

> 该解析是惰性的（首次搜索调用才发生），patch 后无需重启即生效；**系统 rg 装好但不打此补丁时搜索工具仍不可用**。

### P5 文件写入 EPERM link：`dsh-fs-local`

- **源码依据**：`packages/fs/fs-local/src/fsio.ts:553,580`——`writeFileAtomic` 的 `createIfAbsent` 分支用硬链接做 no-replace 原子发布；hmdfs 不支持 `link(2)` → 新建文件一律 `EPERM`（web 会话里 agent 写文件的报错正是它）。
- **文件**：`node_modules/@deepseek-ai/dsh-fs-local/lib/index.js`（`const linkFile = internals.linkFile ?? link;` 处）。
- **改法**：`linkFile` 默认实现改为"先 `link`，`EPERM`/`ENOTSUP` 时回退 `rename`"，且回退前先 `lstat` 确认目标不存在（保留 no-replace 不覆盖语义）。正常平台行为不变，hmdfs 上新建文件走 rename。

### P6 附件写入 EPERM link：`dsh-attachment-local`

- **源码依据**：`packages/attachment/attachment-local/src/store.ts:158`——附件对象（图片等）用 `link(temporary, target)` 做内容寻址发布，hmdfs 同样 EPERM。
- **文件**：`node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js`（import 行 + `await link(temporary, target)` 处）。
- **改法**：import 补 `rename`；`link` 失败 `EPERM` 时回退 `rename`（内容寻址存储，覆盖为同字节，无害），`EEXIST` 分支逻辑保留。

### P7 附件保存前祖先目录 fsync 停止上行：`dsh-attachment-local`

- **源码依据**：`packages/attachment/attachment-local/src/store.ts` 的 `ensureDurableDirectory`——保存图片前从 DSH_HOME 一路向上遍历到文件系统根，对每个祖先目录 `open(dir,'r')+fsync`；鸿蒙上 `/storage/Users`（受保护祖先）open 报 EPERM、`/` 报 EACCES，裸错误被 host catch-all 误标为 `agent-busy`（发图失败的主因）。
- **文件**：`node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js`（`ensureDurableDirectory` 的 while 循环）。
- **改法**：`syncDirectory(parent)` 包 try/catch，`EPERM`/`EACCES`/`EROFS`/`EINVAL`/`ENOTSUP` 时 `break` 停止上行而非抛错（该错误码之前的所有目录已同步，安全性可接受）。

### P8 附件 rename 发布后容忍 unlink ENOENT：`dsh-attachment-local`

- **源码依据**：`packages/attachment/attachment-local/src/store.ts` 的 `saveImageFile`——P6 的 EPERM→rename 回退把 staging 文件**移走**，随后 `unlink(staging)` 必然 ENOENT，被外层 catch 包成 `ATTACHMENT_WRITE_FAILED`。与 P7 必须一起修。
- **文件**：`node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js`（`await unlink(temporary);` 处）。
- **改法**：`await unlink(temporary).catch(...)` 容忍 `ENOENT`（文件已被 rename 移走 = 成功），其余错误照抛。

---

## 7. 启动

**推荐方式：`dsh-hmos` 管理脚本**（已安装到 `~/.harmonybrew/bin/dsh-hmos`，本方案随包创建）：

```sh
dsh-hmos start                          # 默认 http://127.0.0.1:3080
dsh-hmos start --host 0.0.0.0 --port 8080   # 自定义主机/端口
dsh-hmos status                         # 查看实例状态
dsh-hmos stop                           # 停止全部实例
dsh-hmos stop --port 8080               # 停止指定端口实例
```

脚本内部：`setsid` 脱离进程组 + PID 文件 + 端口/HTTP 探活（幂等：已在运行则直接返回）；PID/日志在 `~/.dsh-hmos/web-<port>.{pid,log}`。**重启/关机后再拉起，一条 `dsh-hmos start` 即可。**

手动方式（脚本底层就是这条命令）：

```sh
# 沙箱不可用（无 bwrap/landlock/user namespaces），必须用官方部署开关
export DSH_PERMISSION_MODE="danger-full-access"

# --expose-internals 不允许放 NODE_OPTIONS，必须直接作为 node 参数
node --expose-internals \
  /storage/Users/currentUser/.harmonybrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web
```

- 启动后访问 http://127.0.0.1:3080
- 自定义端口：`dsh-hmos start --port 8080`；绑定所有网卡：`dsh-hmos start --host 0.0.0.0 --port 8080`。
- 日常启停一律用 `dsh-hmos`（见上），不要手动 `nohup`——脚本已处理 setsid 脱离、PID 文件、端口探活与防误杀。

**为什么必须 danger-full-access**（源码依据）：

- `packages/bundle/base/cordis.patch.yml:175`：`mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`
- `:191`：`policy: !!js ... === 'danger-full-access' ? 'never' : 'ask'`（副作用：权限审批从 ask 切到 never）
- 该模式下消费方直接 spawn 原始 argv，不调用 `ctx.sandbox`；本机系统本身权限模型受限（hmdfs、无 user namespaces），风险可控。

### 7.1 无沙箱后端 → 无法写文件怎么办

**现象**：agent 写文件/执行 bash 时抛 `SANDBOX_UNAVAILABLE`（受限模式 fail-closed）。

**根因**：模式解析优先级是 `显式 mode ?? 会话 sandbox/mode 事件 ?? 进程默认(DSH_PERMISSION_MODE)`（源码：`packages/sandbox/sandbox-policy/src/index.ts` 的 `resolve()`）。进程级 env 只决定"默认"，**会话级 `sandbox/mode` 事件优先**——老会话或会话内切到 `read-only`/`workspace-write` 后，该事件覆盖进程默认，而无沙箱后端时受限模式必然失败。

**解法**（两个层面，本机均已落地）：

1. **当前会话**：在 web 会话里输入 `/permission danger-full-access`（或 UI 权限控件选 Full access），写入 `sandbox/mode: danger-full-access` 事件，下一条受限调用即生效。`/permission` 不带参数可查看当前预设。
2. **持久默认（新会话）**：已写入 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    defaultPreset: danger-full-access
    presets: { read-only: {...}, workspace-write: {...}, danger-full-access: {...} }
```

  新会话创建时 `pinInitialPermission`（`packages/interaction/permission-presets/src/index.ts:400`）直接钉为全访问，不再依赖 env 推导。验证：`dsh --profile web --dump-config | grep -A3 defaultPreset`。

> 注意：web UI 的 General settings 里存的权限预设也会作用于后续会话；`danger-full-access` 模式下工具调用不再逐次询问审批，本机系统权限模型本身受限，风险可控。

---

## 8. 验证命令速查

```sh
# 环境就绪
command -v node npm npx clang clang++ make python3 rg

# node-pty 是否可加载
node -e "require('/storage/Users/currentUser/.harmonybrew/lib/node_modules/@deepseek-ai/dsh/node_modules/node-pty')"

# sharp 是否可加载
node -e "require('sharp')"   # 若报错则检查 @img/sharp-wasm32 是否装上

# Web UI 是否存活
node -e "fetch('http://127.0.0.1:3080').then(r=>console.log(r.status))"

# ripgrep 解析是否已 patch（应输出 /storage/Users/currentUser/.harmonybrew/bin/rg）
cd /storage/Users/currentUser/.harmonybrew/lib/node_modules/@deepseek-ai/dsh
node --input-type=module -e "import('@vscode/ripgrep').then(m=>console.log(m.rgPath))"

# koffi 应始终未被加载（本方案目标）——正常运行时无任何 koffi 相关报错即可
```

---

## 9. 升级与维护

**版本升级（推荐，一条命令完成全部）**：

```sh
dsh-hmos update
```

`update` 依次执行：停止当前实例 → `npm install -g @deepseek-ai/dsh --ignore-scripts`（npmmirror）→ 重打 4 处补丁（`patch.mjs`，幂等）→ 重建 node-pty → 重装 `@img/sharp-wasm32` → 重启服务。

只重打补丁、不升级（如手动改坏 node_modules 后恢复）：

```sh
dsh-hmos repatch
```

其他运维要点：

- **升级 dsh 后**（无论 `dsh-hmos update` 还是手动 `npm install -g`）：node_modules 内 4 处 patch 与 node-pty 构建产物都会被覆盖，**必须重打 patch + 重建 node-pty**——`dsh-hmos update` 已自动完成；手动升级后记得跑 `dsh-hmos repatch` + 重建（或直接跑一次 `dsh-hmos update` 兜底）。
- **重启/开机后拉起服务**：`dsh-hmos start` 一条命令即可（脚本幂等，已在运行会直接返回）。
- **卸载**：`npm uninstall -g @deepseek-ai/dsh`；用户数据在 `~/.dsh`（会话/凭据/配置），如需彻底清除手动删除。
- **多实例**：不同 `--port` 可同时跑多个 web 实例，共享 `~/.dsh`，同时跑 agent 任务可能互相干扰。
- **磁盘**：`~/.hdc/` 调试日志每小时约 100MB，需定期清理。

---

## 10. 已知环境限制（来自参考仓库实测，本机同代系统适用）

- hmdfs：不支持硬链接（P2 由此产生）、chmod 无效（P3 由此产生）；`/tmp` 只读；`whoami`/`id` 缺失；`head -n -5` 不支持；`sudo -n`/`-i` 报错。
- npm 官方源不可用（连接失败/curl 崩溃），必须镜像。
- 鸿蒙内核禁 user namespaces + 未启用 Landlock LSM → 沙箱不可用，只能 danger-full-access。
- dlopen 拒绝加载被 strip 过的 `.node` —— 本项目唯一构建的 node-pty 未 strip（默认行为），可正常加载；将来若自建原生模块，**不要 strip**。

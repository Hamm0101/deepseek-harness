# [Bug] Image messages fail with EPERM on restricted filesystems (HarmonyOS): misreported as "agent-busy"

> **环境 / Environment**: HarmonyOS (openharmony, arm64) · Node v22.23.2 · dsh 0.1.0-rc.6
> 关联插件：modlens（`@liustack/modlens@3.16.6`，视觉桥）——但问题属于 dsh 上游，与 modlens 无关。

## 现象 / Symptom

- 在 Web GUI 发送**带图片**的消息，前端提示 `prompt rejected (agent-busy)`（`agent-busy` 错误码）；agent 空闲时也稳定复现。
- 图片消息从未进入会话（收件箱无图片消息记录），`~/.dsh/attachments` 目录从未被创建。
- 纯文本消息一切正常。

直接调用 host RPC（`POST /api/session.prompt` 模拟带图提交）可复现，真实错误：

```json
{
  "code": "agent-busy",
  "message": "prompt rejected",
  "details": { "reason": "Error: EPERM: operation not permitted, open '/storage/Users'" }
}
```

真正的错误是文件系统权限错误（EPERM），被 host 的 catch-all 误标成了 `agent-busy`。

## 根因 / Root cause

dsh 的图片持久化由 `@deepseek-ai/dsh-attachment-local` 负责（`~/.dsh/attachments/v1` 内容寻址存储）。`saveImageFile` 在写文件前调用 `ensureDurableHome`：

1. `ensureDurableDirectory` 会从 DSH_HOME 一路**向上遍历到文件系统根 `/`**，对每个祖先目录执行 `open(dir,'r') + fsync`（崩溃一致性保障）。
2. 在受限文件系统上（实测：HarmonyOS）：
   - 受保护祖先目录（如 `/storage/Users`）→ `EPERM`
   - `/` → `EACCES`
3. 该裸 `EPERM` 沿 `saveImage → durablePromptContent → host prompt handler 的 catch` 向上传播；host 的 catch 把所有**非 AttachmentError** 异常统一映射为：

```js
return err(request, { code: "agent-busy", message: "prompt rejected", details: { reason: String(error) } });
```

### 附带问题（HarmonyOS hmdfs）

即使修好祖先遍历，hmdfs **不支持硬链接**：`saveImageFile` 的 `link()` 返回 `EPERM` 后回退 `rename()`（把 staging 文件**移走**），随后 `unlink(staging)` 必然 `ENOENT`，会被外层 catch 包成 `AttachmentError(ATTACHMENT_WRITE_FAILED)`，保存仍然失败。**两个问题必须一起修。**

## 建议 / Suggestions

### 1. `ensureDurableHome` 祖先 fsync 遍历：受限文件系统上停止上行而非抛错

文件：`packages/attachment/attachment-local/src/store.ts`（`ensureDurableDirectory` 的 while 循环）

在受限文件系统（受保护祖先目录、只读挂载、无目录 fsync 支持）上，向上遍历会以 `EPERM`/`EACCES`/`EROFS`/`EINVAL`/`ENOTSUP` 失败，导致**所有图片消息落盘失败**。建议对这些错误码 `break` 停止上行而非抛错——第一个不可打开目录以下的目录均已同步，安全性可接受：

```js
while (level !== stop) {
    const parent = dirname(level);
    try {
        await syncDirectory(parent);
    } catch (error) {
        if (error instanceof Error && "code" in error &&
            (error.code === "EPERM" || error.code === "EACCES" || error.code === "EROFS" ||
             error.code === "EINVAL" || error.code === "ENOTSUP")) break;
        throw error;
    }
    if (parent === level) return;
    level = parent;
}
```

### 2. `saveImageFile`：rename 发布后容忍 unlink 的 ENOENT

文件：`packages/attachment/attachment-local/src/store.ts`（`saveImageFile`）

硬链接 `EPERM` → `rename` 发布（内容寻址，覆盖为同字节无害）后，staging 文件已被**移走**，随后的 `unlink(staging)` 必然 `ENOENT`，被包装成 `ATTACHMENT_WRITE_FAILED`。建议容忍该 `ENOENT`：

```js
await unlink(temporary).catch((error) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
});
```

### 3. host `prompt` 的 catch-all：区分真正的 busy 与内部错误

文件：host prompt handler（`/api/session.prompt`）

把所有非 `AttachmentError` 异常统一标成 `agent-busy: prompt rejected` 会严重误导排查（本次问题被伪装成"agent 忙碌"）。建议：
- 保留 `details.reason` 中的真实错误；
- 错误码上区分真正的 busy（agent 确实在处理）与内部错误（建议用 `internal-error` 一类独立码）。

## 备注 / Notes

- 本 Issue 由 HarmonyOS (openharmony, arm64) 实机排障产出；补丁已在本地验证通过（`saveImageFile` 落盘成功、端到端发图正常）。
- 问题 1 与问题 2 属于同一保存链路，需一起修复。

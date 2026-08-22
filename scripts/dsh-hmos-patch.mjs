#!/usr/bin/env node
/**
 * dsh-hmos 补丁重放器（幂等）——升级 @deepseek-ai/dsh 后重打 4 处 HarmonyOS 必需补丁。
 * 用法: node ~/.dsh-hmos/patch.mjs [--dsh-dir <路径>] [--check]
 *   --check  只报告状态, 不修改任何文件 (exit 0 = 全部已打, 1 = 有缺失)
 * 每个补丁幂等: 文件已含新内容 → 跳过; 含旧内容 → 替换; 都没有 → 报错退出(需人工介入)。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const dshDirIdx = args.indexOf('--dsh-dir')
const dshDirArg = dshDirIdx >= 0 ? args[dshDirIdx + 1] : undefined
const DSH_DIR = dshDirArg || join(homedir(), '.harmonybrew', 'lib', 'node_modules', '@deepseek-ai', 'dsh')

if (!existsSync(join(DSH_DIR, 'package.json'))) {
  console.error(`[patch] DSH_DIR 不存在: ${DSH_DIR} (可用 --dsh-dir 指定)`)
  process.exit(2)
}

// ---- 补丁定义: 每个补丁 { file, patches: [{ id, old, new, marker }] } ----
// marker: 判断"已打过"的特征串(取 new 的独特片段)
const PATCHES = [
  {
    file: 'node_modules/@deepseek-ai/dsh-sandbox-local/lib/index.js',
    patches: [{
      id: 'P1 koffi 惰性加载',
      old: 'import { AclWriteGrant, assertTempRootOutsideWorkspace, tempWriteSid, workspaceWriteSid } from "@deepseek-ai/dsh-sandbox-windows-acl";',
      new: 'let AclWriteGrant, assertTempRootOutsideWorkspace, tempWriteSid, workspaceWriteSid;\nif (process.platform === "win32") {\n\t({ AclWriteGrant, assertTempRootOutsideWorkspace, tempWriteSid, workspaceWriteSid } = await import("@deepseek-ai/dsh-sandbox-windows-acl"));\n}',
      marker: 'let AclWriteGrant',
    }],
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js',
    patches: [{
      id: 'P2a import link→rename',
      old: 'import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
      new: 'import { rename, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
      marker: 'import { rename, mkdir',
    }, {
      id: 'P2b 发布 link(tmp,finalPath)→rename',
      old: 'await link(tmp, finalPath);',
      new: 'await rename(tmp, finalPath);',
      marker: 'await rename(tmp, finalPath);',
    }],
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js',
    patches: [{
      id: 'P3 凭据 mode 检查跳过 openharmony',
      old: 'if (process.platform === "win32") return;',
      new: 'if (process.platform === "win32" || process.platform === "openharmony") return;',
      marker: 'process.platform === "openharmony"',
    }],
  },
  {
    file: 'node_modules/@vscode/ripgrep/lib/index.js',
    patches: [{
      id: 'P4 ripgrep 回退 harmonybrew rg',
      old: '} catch {\n    throw new Error(\n        `Could not find ${platformPkg}. ` +\n        `Ensure optionalDependencies are installed for this platform (${process.platform}-${arch}).`\n    );\n}',
      new: '} catch {\n    // HarmonyOS has no @vscode/ripgrep-openharmony-* package and the\n    // linux-arm64 static binary is stripped (hmdfs refuses exec);\n    // fall back to the harmonybrew-installed system rg.\n    const candidates = [\n        `${require(\'node:os\').homedir()}/.harmonybrew/bin/rg`,\n        \'' + process.env.DSH_HMOS_RG || (homedir() + '/.harmonybrew/bin/rg') + '\',\n    ];\n    if (process.platform === \'openharmony\') {\n        resolved = candidates.find((p) => require(\'node:fs\').existsSync(p));\n    }\n    if (!resolved) {\n        throw new Error(\n            `Could not find ${platformPkg}. ` +\n            `Ensure optionalDependencies are installed for this platform (${process.platform}-${arch}).`\n        );\n    }\n}',
      marker: '.harmonybrew/bin/rg',
    }],
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-fs-local/lib/index.js',
    patches: [{
      id: 'P5 fs-local 原子发布 link→rename 回退',
      old: '\tconst linkFile = internals.linkFile ?? link;',
      new: '\tconst linkFile = internals.linkFile ?? (async (src, dst) => {\n\t\ttry {\n\t\t\tawait link(src, dst);\n\t\t} catch (error) {\n\t\t\tif (!(error instanceof Error && (error.code === "EPERM" || error.code === "ENOTSUP"))) throw error;\n\t\t\t// HarmonyOS hmdfs: hard links unsupported. Preserve the no-replace\n\t\t\t// contract by re-checking the target before falling back to rename.\n\t\t\tlet existing = null;\n\t\t\ttry {\n\t\t\t\texisting = await lstat(dst);\n\t\t\t} catch (statError) {\n\t\t\t\tif (!isENOENT(statError) && !isENOTDIR(statError)) throw error;\n\t\t\t}\n\t\t\tif (existing !== null) throw error;\n\t\t\tawait rename(src, dst);\n\t\t}\n\t});',
      marker: 'internals.linkFile ?? (async',
    }],
  },
  {
    file: 'node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js',
    patches: [{
      id: 'P6a attachment import +rename',
      old: 'import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises";',
      new: 'import { chmod, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";',
      marker: 'readFile, rename, rm, unlink',
    }, {
      id: 'P6b attachment 发布 link→rename 回退',
      old: '\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n\t\t\tif (digest$1(new Uint8Array(await readFile(target))) !== sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");\n\t\t}',
      new: '\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\tif (error instanceof Error && "code" in error && error.code === "EPERM") {\n\t\t\t\t// HarmonyOS hmdfs: hard links unsupported — publish via rename\n\t\t\t\t// (content-addressed store, so overwriting is byte-identical).\n\t\t\t\tawait rename(temporary, target);\n\t\t\t} else if (error instanceof Error && "code" in error && error.code === "EEXIST") {\n\t\t\t\tif (digest$1(new Uint8Array(await readFile(target))) !== sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");\n\t\t\t} else {\n\t\t\t\tthrow error;\n\t\t\t}\n\t\t}',
      marker: 'content-addressed store, so overwriting is byte-identical',
    }, {
      id: 'P7 attachment ensureDurableDirectory 祖先受限停止上行',
      old: '\tlet level = target;\n\twhile (level !== stop) {\n\t\tconst parent = dirname(level);\n\t\tawait syncDirectory(parent);\n\t\t/* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */\n\t\tif (parent === level) return;\n\t\tlevel = parent;\n\t}\n}',
      new: '\tlet level = target;\n\twhile (level !== stop) {\n\t\tconst parent = dirname(level);\n\t\ttry {\n\t\t\tawait syncDirectory(parent);\n\t\t} catch (error) {\n\t\t\t// Restricted filesystems (HarmonyOS protected ancestors, read-only\n\t\t\t// mounts) refuse open-for-fsync above the user\'s home; every\n\t\t\t// directory below the first unopenable one is already synced, so\n\t\t\t// stop the ascent instead of failing the whole save.\n\t\t\tif (error instanceof Error && "code" in error && (error.code === "EPERM" || error.code === "EACCES" || error.code === "EROFS" || error.code === "EINVAL" || error.code === "ENOTSUP")) break;\n\t\t\tthrow error;\n\t\t}\n\t\t/* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */\n\t\tif (parent === level) return;\n\t\tlevel = parent;\n\t}\n}',
      marker: 'stop the ascent instead of failing the whole save',
    }, {
      id: 'P8 attachment rename 发布后容忍 unlink ENOENT',
      old: '\t\tawait syncDirectory(bucket);\n\t\tawait syncDirectory(join(root, "objects"));\n\t\tawait unlink(temporary);\n\t} catch (error) {',
      new: '\t\tawait syncDirectory(bucket);\n\t\tawait syncDirectory(join(root, "objects"));\n\t\t// The EPERM fallback above publishes via rename, which MOVES the\n\t\t// staging file away; a staging file that is already gone is success.\n\t\tawait unlink(temporary).catch((error) => {\n\t\t\tif (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;\n\t\t});\n\t} catch (error) {',
      marker: 'staging file away; a staging file that is already gone is success',
    }],
  },
  {
    file: 'node_modules/koffi/src/koffi/CMakeLists.txt',
    patches: [{
      id: 'P9 koffi CMakeLists HarmonyOS 架构推导',
      old: 'if(CMAKE_SIZEOF_VOID_P EQUAL 8)\n    # CMAKE_SYSTEM_PROCESSOR is wrong on Windows ARM64\n\n    if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch|arm|ARM|AARCH" OR CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64" OR CMAKE_OSX_ARCHITECTURES MATCHES "arm")',
      new: 'if(CMAKE_SIZEOF_VOID_P EQUAL 8)\n    # CMAKE_SYSTEM_PROCESSOR is wrong on Windows ARM64\n\n    # HarmonyOS CMake reports CMAKE_SYSTEM_PROCESSOR as "unknown"; derive it\n    # from the actual compiler target (aarch64-unknown-linux-ohos on ARM64 PCs).\n    if(CMAKE_SYSTEM_PROCESSOR STREQUAL "unknown" AND CMAKE_SYSTEM_NAME STREQUAL "HarmonyOS")\n        execute_process(COMMAND "${CMAKE_CXX_COMPILER}" -dumpmachine\n                        OUTPUT_VARIABLE DSH_CXX_MACHINE\n                        OUTPUT_STRIP_TRAILING_WHITESPACE)\n        if(DSH_CXX_MACHINE MATCHES "aarch64|arm64")\n            set(CMAKE_SYSTEM_PROCESSOR "aarch64")\n        elseif(DSH_CXX_MACHINE MATCHES "x86_64|amd64")\n            set(CMAKE_SYSTEM_PROCESSOR "x86_64")\n        endif()\n    endif()\n\n    if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch|arm|ARM|AARCH" OR CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64" OR CMAKE_OSX_ARCHITECTURES MATCHES "arm")',
      marker: 'DSH_CXX_MACHINE',
    }],
  },
]

let failed = 0
for (const { file, patches } of PATCHES) {
  const abs = join(DSH_DIR, file)
  if (!existsSync(abs)) {
    console.error(`[patch] 文件缺失: ${file}`)
    failed++
    continue
  }
  let content = readFileSync(abs, 'utf8')
  for (const { id, old, new: next, marker } of patches) {
    if (content.includes(marker)) {
      console.log(`[patch] OK (已打)  ${id}  ${file}`)
      continue
    }
    if (checkOnly) {
      console.error(`[patch] 缺失   ${id}  ${file}`)
      failed++
      continue
    }
    if (!content.includes(old)) {
      console.error(`[patch] 找不到旧内容(版本结构可能变化,需人工检查)  ${id}  ${file}`)
      failed++
      continue
    }
    content = content.replace(old, next)
    writeFileSync(abs, content)
    console.log(`[patch] 已打补丁  ${id}  ${file}`)
  }
}

console.log(checkOnly ? `[patch] 检查完成(${failed} 处缺失)` : `[patch] 重放完成(${failed} 处失败)`)
process.exit(failed > 0 ? 1 : 0)

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

function electronShell() {
  try {
    return require("electron").shell;
  } catch {
    return null;
  }
}

const SKIP = new Set([
  "node_modules", ".git", ".svn", ".hg", ".DS_Store",
  "dist", "build", ".next", ".turbo", "coverage", "__pycache__",
  ".omni-voice-desk",
]);

const TEXT_EXT = new Set([
  ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".txt", ".css", ".html",
  ".htm", ".svg", ".xml", ".yml", ".yaml", ".toml", ".ini", ".env", ".sh", ".bash", ".zsh",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".php", ".sql", ".vue", ".svelte", ".astro", ".scss", ".less", ".gradle", ".dockerfile",
  ".gitignore", ".editorconfig", ".conf", ".cfg", ".plist", ".r", ".pl", ".lua",
]);

function assertWorkspace(workspace) {
  if (!workspace) throw new Error("No workspace is set.");
  const root = path.resolve(workspace);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Workspace missing: ${root}`);
  }
  return root;
}

/**
 * Normalize any agent-supplied path to a workspace-relative path.
 * Fixes the common bug where models pass absolute paths (or absolute without
 * leading slash) and naive join recreates Users/... inside the workspace.
 */
function toWorkspaceRel(root, relPath = ".") {
  let raw = String(relPath ?? ".").trim();
  if (!raw || raw === "." || raw === "./") return ".";

  raw = raw.replace(/\\/g, "/");

  const rootAbs = path.resolve(root);
  const rootPosix = rootAbs.replace(/\\/g, "/");
  const rootNoLead = rootPosix.replace(/^\/+/, "");

  // Absolute path (Unix or Windows drive)
  const asAbsCandidate = path.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)
    ? path.resolve(raw)
    : null;

  if (asAbsCandidate) {
    const rel = path.relative(rootAbs, asAbsCandidate);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Path escapes workspace: ${relPath}`);
    }
    return rel.replace(/\\/g, "/") || ".";
  }

  // Absolute path pasted without leading slash: Users/me/proj/foo
  if (raw === rootNoLead || raw.startsWith(`${rootNoLead}/`)) {
    raw = raw.slice(rootNoLead.length).replace(/^\/+/, "") || ".";
  } else if (raw === rootPosix || raw.startsWith(`${rootPosix}/`)) {
    raw = raw.slice(rootPosix.length).replace(/^\/+/, "") || ".";
  }

  // Home-style or accidental leading slash on relative
  raw = raw.replace(/^\/+/, "").replace(/^\.\//, "");

  // Still looks absolute after cleanup? reject
  if (path.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }

  return raw || ".";
}

/** Resolve a relative (or absolute-under-root) path; never escapes the workspace. */
function resolveInWorkspace(workspace, relPath = ".") {
  const root = assertWorkspace(workspace);
  const safeRel = toWorkspaceRel(root, relPath);
  const full = path.resolve(root, safeRel);
  const rel = path.relative(root, full).replace(/\\/g, "/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return { root, full, rel: rel || "." };
}

function list({ workspace, path: rel = ".", depth = 1, max = 120, includeHidden = false } = {}) {
  const { root, full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (!fs.existsSync(full)) throw new Error(`Not found: ${rel}`);
  const out = [];
  const walk = (dir, level, prefix) => {
    if (out.length >= max || level > depth) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      if (out.length >= max) break;
      if (SKIP.has(name)) continue;
      if (!includeHidden && name.startsWith(".") && name !== ".") continue;
      const abs = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      const p = prefix ? `${prefix}/${name}` : name;
      if (st.isSymbolicLink()) {
        out.push({ path: p, type: "symlink", size: st.size });
      } else if (st.isDirectory()) {
        out.push({ path: p, type: "dir" });
        if (level < depth) walk(abs, level + 1, p);
      } else if (st.isFile()) {
        out.push({ path: p, type: "file", size: st.size });
      }
    }
  };
  const prefix = safe === "." ? "" : safe;
  walk(full, 0, prefix);
  return { workspace: root, entries: out };
}

function statPath({ workspace, path: rel } = {}) {
  const { full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (!fs.existsSync(full)) throw new Error(`Not found: ${safe}`);
  const st = fs.lstatSync(full);
  return {
    path: safe,
    type: st.isDirectory() ? "dir" : st.isSymbolicLink() ? "symlink" : "file",
    size: st.size,
    mtime: st.mtime.toISOString(),
    mode: st.mode,
    exists: true,
  };
}

function readFile({
  workspace,
  path: rel,
  maxBytes = 400_000,
  offset = 0,
  offset_lines: offsetLines,
  limit_lines: limitLines,
} = {}) {
  const { full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`File not found: ${safe}`);
  }
  const text = fs.readFileSync(full, "utf8");
  const allLines = text.split(/\r?\n/);
  const lineStart = Math.max(0, Number(offsetLines) || 0);
  const hasLineWindow = offsetLines != null || limitLines != null;
  if (hasLineWindow) {
    const take = Math.max(1, Math.min(2000, Number(limitLines) || 200));
    const slice = allLines.slice(lineStart, lineStart + take);
    const numbered = slice.map((line, i) => `${lineStart + i + 1}|${line}`).join("\n");
    return {
      path: safe,
      bytes: Buffer.byteLength(text, "utf8"),
      lines: allLines.length,
      offset_lines: lineStart,
      limit_lines: take,
      truncated: lineStart + take < allLines.length,
      content: numbered,
    };
  }
  const buf = Buffer.from(text, "utf8");
  const start = Math.max(0, Number(offset) || 0);
  const slice = buf.subarray(start, start + maxBytes);
  const truncated = start + slice.length < buf.length;
  return {
    path: safe,
    bytes: buf.length,
    lines: allLines.length,
    offset: start,
    truncated,
    content: slice.toString("utf8"),
  };
}

function writeFile({ workspace, path: rel, content = "", mkdir: doMkdir = true } = {}) {
  const { root, full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (doMkdir) fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, String(content), "utf8");
  return { path: safe, bytes: Buffer.byteLength(String(content), "utf8"), workspace: root };
}

function appendFile({ workspace, path: rel, content = "", mkdir: doMkdir = true } = {}) {
  const { root, full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (doMkdir) fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, String(content), "utf8");
  const size = fs.statSync(full).size;
  return { path: safe, bytes: size, workspace: root };
}

function mkdir({ workspace, path: rel } = {}) {
  const { full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (safe === "." || safe === "") {
    return { path: ".", created: false, existed: true, message: "Workspace root already exists." };
  }
  const existed = fs.existsSync(full);
  fs.mkdirSync(full, { recursive: true });
  return {
    path: safe,
    created: !existed,
    existed,
    message: existed ? `Already exists: ${safe}` : `Created: ${safe}`,
  };
}

function remove({ workspace, path: rel } = {}) {
  const { full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (safe === "." || safe === "") throw new Error("Refusing to delete workspace root.");
  if (!fs.existsSync(full)) return { path: safe, removed: false };
  fs.rmSync(full, { recursive: true, force: true });
  return { path: safe, removed: true };
}

function rename({ workspace, from, to } = {}) {
  const src = resolveInWorkspace(workspace, from);
  const dst = resolveInWorkspace(workspace, to);
  if (!fs.existsSync(src.full)) throw new Error(`Not found: ${src.rel}`);
  fs.mkdirSync(path.dirname(dst.full), { recursive: true });
  fs.renameSync(src.full, dst.full);
  return { from: src.rel, to: dst.rel };
}

function copy({ workspace, from, to } = {}) {
  const src = resolveInWorkspace(workspace, from);
  const dst = resolveInWorkspace(workspace, to);
  if (!fs.existsSync(src.full)) throw new Error(`Not found: ${src.rel}`);
  fs.mkdirSync(path.dirname(dst.full), { recursive: true });
  fs.cpSync(src.full, dst.full, { recursive: true, force: true });
  return { from: src.rel, to: dst.rel };
}

/** Exact string replace in a file (OpenHands / Claude Code style). */
function strReplace({
  workspace,
  path: rel,
  old_string: oldString,
  new_string: newString,
  replace_all: replaceAll = false,
} = {}) {
  const { full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`File not found: ${safe}`);
  }
  const before = fs.readFileSync(full, "utf8");
  const needle = String(oldString ?? "");
  const next = String(newString ?? "");
  if (!needle) throw new Error("old_string is required");
  if (!before.includes(needle)) {
    throw new Error(`old_string not found in ${safe}`);
  }
  let after;
  let count = 0;
  if (replaceAll) {
    after = before.split(needle).join(next);
    count = before.split(needle).length - 1;
  } else {
    const idx = before.indexOf(needle);
    after = before.slice(0, idx) + next + before.slice(idx + needle.length);
    count = 1;
  }
  fs.writeFileSync(full, after, "utf8");
  return { path: safe, replacements: count, bytes: Buffer.byteLength(after, "utf8") };
}

/** Apply several exact replacements in one file (order matters). */
function applyEdits({ workspace, path: rel, edits = [] } = {}) {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error("edits must be a non-empty array of {old_string, new_string}");
  }
  if (edits.length > 40) throw new Error("Too many edits (max 40).");
  let total = 0;
  let last = null;
  for (const edit of edits) {
    last = strReplace({
      workspace,
      path: rel,
      old_string: edit?.old_string ?? edit?.oldString,
      new_string: edit?.new_string ?? edit?.newString,
      replace_all: Boolean(edit?.replace_all ?? edit?.replaceAll),
    });
    total += last.replacements;
  }
  return { path: last.path, edits: edits.length, replacements: total, bytes: last.bytes };
}

/** Insert text before a 1-based line number (1 = top of file). */
function insertLines({ workspace, path: rel, line = 1, content = "" } = {}) {
  const { full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`File not found: ${safe}`);
  }
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  const at = Math.max(1, Math.min(lines.length + 1, Number(line) || 1)) - 1;
  const chunk = String(content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const insert = chunk.endsWith("\n") ? chunk.slice(0, -1).split("\n") : chunk.split("\n");
  lines.splice(at, 0, ...insert);
  const after = lines.join("\n");
  fs.writeFileSync(full, after, "utf8");
  return {
    path: safe,
    inserted_at: at + 1,
    lines_added: insert.length,
    bytes: Buffer.byteLength(after, "utf8"),
  };
}

/** Replace an inclusive 1-based line range with new content. */
function replaceLines({
  workspace,
  path: rel,
  start_line: startLine = 1,
  end_line: endLine,
  content = "",
} = {}) {
  const { full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`File not found: ${safe}`);
  }
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  const start = Math.max(1, Number(startLine) || 1);
  const end = Math.max(start, Number(endLine) || start);
  if (start > lines.length) throw new Error(`start_line ${start} past end of ${safe} (${lines.length} lines)`);
  const chunk = String(content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const replacement = chunk === ""
    ? []
    : (chunk.endsWith("\n") ? chunk.slice(0, -1).split("\n") : chunk.split("\n"));
  const beforeCount = Math.min(end, lines.length) - start + 1;
  lines.splice(start - 1, beforeCount, ...replacement);
  const after = lines.join("\n");
  fs.writeFileSync(full, after, "utf8");
  return {
    path: safe,
    start_line: start,
    end_line: Math.min(end, start + beforeCount - 1),
    lines_removed: beforeCount,
    lines_added: replacement.length,
    bytes: Buffer.byteLength(after, "utf8"),
  };
}

/** Compact directory tree for orientation. */
function tree({ workspace, path: rel = ".", depth = 2, max = 160 } = {}) {
  const { root, full, rel: safe } = resolveInWorkspace(workspace, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
    throw new Error(`Directory not found: ${safe}`);
  }
  const maxDepth = Math.min(4, Math.max(1, Number(depth) || 2));
  const lines = [`${safe === "." ? "." : safe}/`];
  let count = 0;
  const walk = (dir, level, prefix) => {
    if (count >= max || level > maxDepth) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    names = names.filter((n) => !SKIP.has(n) && !n.startsWith(".")).sort((a, b) => a.localeCompare(b));
    names.forEach((name, idx) => {
      if (count >= max) return;
      const abs = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(abs); } catch { return; }
      const last = idx === names.length - 1;
      const branch = `${prefix}${last ? "└─ " : "├─ "}`;
      if (st.isDirectory()) {
        lines.push(`${branch}${name}/`);
        count += 1;
        if (level < maxDepth) {
          walk(abs, level + 1, `${prefix}${last ? "   " : "│  "}`);
        }
      } else if (st.isFile()) {
        lines.push(`${branch}${name}`);
        count += 1;
      }
    });
  };
  walk(full, 1, "");
  return {
    workspace: root,
    path: safe,
    truncated: count >= max,
    tree: lines.join("\n"),
    entries: count,
  };
}

/**
 * Move files matching a glob into a destination folder (organize).
 * Keeps basenames; skips collisions unless overwrite=true.
 */
function organizeFiles({
  workspace,
  pattern,
  destination,
  path: rel = ".",
  overwrite = false,
  dry_run: dryRun = false,
  max = 80,
} = {}) {
  if (!pattern) throw new Error("pattern is required (e.g. *.md, notes/*.txt)");
  if (!destination) throw new Error("destination folder is required");
  const hits = globFiles({ workspace, pattern, path: rel, max });
  const files = (hits.hits || []).filter((h) => h.type === "file");
  const dest = resolveInWorkspace(workspace, destination);
  if (!dryRun) fs.mkdirSync(dest.full, { recursive: true });
  const moved = [];
  const skipped = [];
  for (const hit of files) {
    const base = path.basename(hit.path);
    const toRel = dest.rel === "." ? base : `${dest.rel}/${base}`;
    if (hit.path === toRel || hit.path.endsWith(`/${base}`) && path.dirname(hit.path) === dest.rel) {
      skipped.push({ path: hit.path, reason: "already in destination" });
      continue;
    }
    const target = resolveInWorkspace(workspace, toRel);
    if (fs.existsSync(target.full) && !overwrite) {
      skipped.push({ path: hit.path, reason: `exists: ${toRel}` });
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(target.full), { recursive: true });
      fs.renameSync(resolveInWorkspace(workspace, hit.path).full, target.full);
    }
    moved.push({ from: hit.path, to: toRel });
  }
  return {
    pattern: String(pattern),
    destination: dest.rel,
    dry_run: Boolean(dryRun),
    moved,
    skipped,
    count: moved.length,
  };
}

/** Find-and-replace across files matching a glob. */
function findReplace({
  workspace,
  pattern,
  old_string: oldString,
  new_string: newString,
  path: rel = ".",
  replace_all: replaceAll = true,
  max = 40,
} = {}) {
  const needle = String(oldString ?? "");
  if (!needle) throw new Error("old_string is required");
  if (!pattern) throw new Error("pattern is required (e.g. *.{js,ts})");
  const hits = globFiles({ workspace, pattern, path: rel, max: max * 2 });
  const files = (hits.hits || []).filter((h) => h.type === "file").slice(0, max);
  const updated = [];
  const missed = [];
  for (const hit of files) {
    try {
      const result = strReplace({
        workspace,
        path: hit.path,
        old_string: needle,
        new_string: String(newString ?? ""),
        replace_all: replaceAll,
      });
      updated.push({ path: result.path, replacements: result.replacements });
    } catch (err) {
      missed.push({ path: hit.path, reason: err?.message || String(err) });
    }
  }
  return {
    pattern: String(pattern),
    files_touched: updated.length,
    replacements: updated.reduce((n, u) => n + u.replacements, 0),
    updated,
    missed: missed.slice(0, 20),
  };
}

function searchFiles({ workspace, query, path: rel = ".", max = 60 } = {}) {
  const needle = String(query || "").toLowerCase().trim();
  if (!needle) throw new Error("query is required");
  const { root, full, rel: safe } = resolveInWorkspace(workspace, rel);
  const hits = [];
  const walk = (dir, prefix) => {
    if (hits.length >= max) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (hits.length >= max) break;
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      const p = prefix ? `${prefix}/${name}` : name;
      if (name.toLowerCase().includes(needle) || p.toLowerCase().includes(needle)) {
        hits.push({ path: p, type: st.isDirectory() ? "dir" : "file", size: st.size });
      }
      if (st.isDirectory()) walk(abs, p);
    }
  };
  walk(full, safe === "." ? "" : safe);
  return { workspace: root, query: needle, hits };
}

function matchGlob(name, glob) {
  if (!glob || glob === "*") return true;
  // Simple glob: *.js, *.{ts,tsx}, prefix*
  const parts = String(glob).split(",");
  return parts.some((g) => {
    const pat = g.trim().replace(/\{([^}]+)\}/g, (_, alts) => `(${alts.split(",").join("|")})`);
    const re = new RegExp(`^${pat.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`, "i");
    return re.test(name);
  });
}

function looksText(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith(".") && !base.includes(".", 1)) return true;
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (!ext && base.toLowerCase().includes("dockerfile")) return true;
  return false;
}

/**
 * Content search (ripgrep when available, else JS walk).
 * Patterned after OpenHands / Claude Code grep tools.
 */
function grep({
  workspace,
  pattern,
  path: rel = ".",
  include,
  max = 80,
  caseInsensitive = false,
} = {}) {
  const { root, full, rel: safe } = resolveInWorkspace(workspace, rel);
  const pat = String(pattern || "");
  if (!pat) throw new Error("pattern is required");

  // Prefer ripgrep for speed/quality when present
  try {
    const args = ["-n", "--no-heading", "--color", "never", "-m", String(Math.max(1, max))];
    if (caseInsensitive) args.push("-i");
    if (include) {
      for (const g of String(include).split(",")) {
        const gg = g.trim();
        if (gg) args.push("--glob", gg);
      }
    }
    for (const skip of SKIP) args.push("--glob", `!${skip}`);
    args.push("--", pat, full);
    const out = execFileSync("rg", args, {
      encoding: "utf8",
      maxBuffer: 2_000_000,
      cwd: root,
      timeout: 30_000,
    });
    const matches = out.split("\n").filter(Boolean).slice(0, max).map((line) => {
      // path:line:content — make path workspace-relative
      const m = line.match(/^(.*?):(\d+):(.*)$/);
      if (!m) return { raw: line };
      let file = m[1];
      if (path.isAbsolute(file)) file = path.relative(root, file).replace(/\\/g, "/");
      else if (file.startsWith(full)) file = path.relative(root, file).replace(/\\/g, "/");
      return { path: file, line: Number(m[2]), text: m[3] };
    });
    return { workspace: root, pattern: pat, engine: "rg", count: matches.length, matches };
  } catch (err) {
    if (err && err.status === 1) {
      return { workspace: root, pattern: pat, engine: "rg", count: 0, matches: [] };
    }
    // fall through to JS
  }

  let re;
  try {
    re = new RegExp(pat, caseInsensitive ? "i" : "");
  } catch {
    throw new Error(`Invalid regex: ${pat}`);
  }

  const matches = [];
  const walk = (dir, prefix) => {
    if (matches.length >= max) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (matches.length >= max) break;
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      const p = prefix ? `${prefix}/${name}` : name;
      if (st.isDirectory()) {
        walk(abs, p);
        continue;
      }
      if (!st.isFile() || st.size > 1_500_000) continue;
      if (include && !matchGlob(name, include) && !matchGlob(p, include)) continue;
      if (!looksText(abs)) continue;
      let text;
      try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= max) break;
        if (re.test(lines[i])) {
          matches.push({ path: p, line: i + 1, text: lines[i].slice(0, 400) });
        }
      }
    }
  };
  walk(full, safe === "." ? "" : safe);
  return { workspace: root, pattern: pat, engine: "js", count: matches.length, matches };
}

function globFiles({ workspace, pattern = "**/*", path: rel = ".", max = 100 } = {}) {
  const { root, full, rel: safe } = resolveInWorkspace(workspace, rel);
  const glob = String(pattern || "**/*");
  const hits = [];
  const walk = (dir, prefix) => {
    if (hits.length >= max) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (hits.length >= max) break;
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      const p = prefix ? `${prefix}/${name}` : name;
      if (st.isDirectory()) {
        if (matchGlob(name, glob) || matchGlob(p, glob)) {
          hits.push({ path: p, type: "dir" });
        }
        walk(abs, p);
      } else if (st.isFile()) {
        if (matchGlob(name, glob) || matchGlob(p, glob)) {
          hits.push({ path: p, type: "file", size: st.size });
        }
      }
    }
  };
  walk(full, safe === "." ? "" : safe);
  return { workspace: root, pattern: glob, hits };
}

/** Block shell that would spam Terminal.app windows — use run_command / open_terminal instead. */
function assertNotTerminalSpawner(cmd) {
  const lower = String(cmd).toLowerCase();
  const bad = [
    /open\s+-a\s+['"]?terminal\b/,
    /open\s+-a\s+['"]?iterm/,
    /tell\s+application\s+["']terminal["']/,
    /do\s+script\b/,
    /x-terminal-emulator\b/,
    /gnome-terminal\b/,
    /start\s+cmd\b/,
    /wt\.exe\b/,
    /windows.?terminal/,
  ];
  if (bad.some((re) => re.test(lower))) {
    throw new Error(
      "Refused: that command would open Terminal windows. "
      + "Use run_command to execute work invisibly, or open_terminal once if the user explicitly asked for a visible Terminal.",
    );
  }
}

/**
 * Run a shell command in the workspace (or a subdir).
 * background:true detaches so long-lived apps keep running.
 * Does NOT open Terminal.app — that is open_terminal only.
 */
function runCommand({
  workspace,
  command,
  cwd: relCwd = ".",
  timeoutMs = 180_000,
  background = false,
} = {}) {
  const root = assertWorkspace(workspace);
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("command is required");
  assertNotTerminalSpawner(cmd);
  const { full: cwd } = resolveInWorkspace(root, relCwd || ".");

  if (background) {
    const child = spawn(cmd, {
      cwd,
      env: process.env,
      shell: true,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return {
      code: null,
      cwd,
      command: cmd,
      background: true,
      pid: child.pid,
      stdout: "",
      stderr: "",
      message: `Started in background (pid ${child.pid}).`,
    };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (c) => { stdout += c; if (stdout.length > 200_000) stdout = stdout.slice(-200_000); });
    child.stderr.on("data", (c) => { stderr += c; if (stderr.length > 80_000) stderr = stderr.slice(-80_000); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        cwd,
        command: cmd,
        background: false,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

/** Rate-limit visible Terminal opens so the agent cannot spam windows. */
let lastTerminalOpenAt = 0;
const TERMINAL_COOLDOWN_MS = 45_000;

function isTerminalAppName(name) {
  const n = String(name || "").trim().toLowerCase();
  return [
    "terminal",
    "terminal.app",
    "iterm",
    "iterm2",
    "iterm.app",
    "windows terminal",
    "wt",
    "cmd",
    "command prompt",
    "powershell",
  ].includes(n);
}

/**
 * Open ONE interactive terminal at the workspace.
 * Reuses an existing Terminal window when possible (macOS).
 * Rate-limited — not for running commands (use run_command).
 */
async function openTerminal({ workspace, path: rel = ".", command, force = false } = {}) {
  const root = assertWorkspace(workspace);
  const { full, rel: safe } = resolveInWorkspace(workspace, rel || ".");
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
    throw new Error(`Not a directory: ${safe}`);
  }

  const now = Date.now();
  if (!force && now - lastTerminalOpenAt < TERMINAL_COOLDOWN_MS) {
    const waitSec = Math.ceil((TERMINAL_COOLDOWN_MS - (now - lastTerminalOpenAt)) / 1000);
    return {
      path: safe,
      opened: "skipped",
      reused: true,
      command: command || null,
      message:
        `Terminal was opened recently — not opening another window (${waitSec}s cooldown). `
        + "Use run_command to execute shell work without opening Terminal.app.",
    };
  }

  if (process.platform === "darwin") {
    const escaped = full.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const body = command
      ? `cd \\"${escaped}\\" && ${String(command).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}`
      : `cd \\"${escaped}\\"`;
    // Reuse front window if Terminal already has one; otherwise create once.
    const script = [
      'tell application "Terminal"',
      "  activate",
      "  if (count of windows) is 0 then",
      `    do script "${body}"`,
      "  else",
      `    do script "${body}" in front window`,
      "  end if",
      "end tell",
    ].join("\n");
    // Bypass assertNotTerminalSpawner — this is the intentional Terminal opener.
    await new Promise((resolve, reject) => {
      const child = spawn(`osascript -e ${JSON.stringify(script)}`, {
        cwd: root,
        env: process.env,
        shell: true,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      child.on("error", reject);
      setTimeout(resolve, 200);
    });
    lastTerminalOpenAt = now;
    return { path: safe, opened: "Terminal", reused: true, command: command || null };
  }

  if (process.platform === "win32") {
    const cmd = command
      ? `start cmd /K "cd /d ${full} && ${command}"`
      : `start cmd /K "cd /d ${full}"`;
    const child = spawn(cmd, { cwd: root, env: process.env, shell: true, detached: true, stdio: "ignore" });
    child.unref();
    lastTerminalOpenAt = now;
    return { path: safe, opened: "cmd", command: command || null };
  }

  const termCmd = command
    ? `x-terminal-emulator -e bash -lc ${JSON.stringify(`cd ${JSON.stringify(full)} && ${command}; exec bash`)}`
    : `x-terminal-emulator --working-directory=${JSON.stringify(full)}`;
  try {
    const child = spawn(termCmd, { cwd: root, env: process.env, shell: true, detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    const child = spawn(`gnome-terminal --working-directory=${JSON.stringify(full)}`, {
      cwd: root, env: process.env, shell: true, detached: true, stdio: "ignore",
    });
    child.unref();
  }
  lastTerminalOpenAt = now;
  return { path: safe, opened: "terminal", command: command || null };
}

/** Open a workspace file/folder with the OS default app, or launch an app by name/path. */
async function openPath({ workspace, path: rel, application } = {}) {
  const root = assertWorkspace(workspace);
  if (application) {
    const appName = String(application).trim();
    // Launching Terminal via open -a always spawns windows — route through openTerminal.
    if (isTerminalAppName(appName)) {
      return openTerminal({
        workspace: root,
        path: rel || ".",
      });
    }
    if (process.platform === "darwin") {
      return runCommand({
        workspace: root,
        command: rel
          ? `open -a ${JSON.stringify(appName)} ${JSON.stringify(resolveInWorkspace(root, rel).full)}`
          : `open -a ${JSON.stringify(appName)}`,
        background: true,
      });
    }
    return runCommand({
      workspace: root,
      command: rel
        ? `${JSON.stringify(appName)} ${JSON.stringify(resolveInWorkspace(root, rel).full)}`
        : JSON.stringify(appName),
      background: true,
    });
  }

  const { full, rel: safe } = resolveInWorkspace(workspace, rel || ".");
  if (!fs.existsSync(full)) throw new Error(`Not found: ${safe}`);
  const shell = electronShell();
  if (shell?.openPath) {
    const err = await shell.openPath(full);
    if (err) throw new Error(err);
  } else if (process.platform === "darwin") {
    await runCommand({ workspace: root, command: `open ${JSON.stringify(full)}`, background: true });
  } else {
    await runCommand({
      workspace: root,
      command: process.platform === "win32"
        ? `start "" ${JSON.stringify(full)}`
        : `xdg-open ${JSON.stringify(full)}`,
      background: true,
    });
  }
  return { path: safe, opened: true };
}

module.exports = {
  list,
  statPath,
  readFile,
  writeFile,
  appendFile,
  mkdir,
  remove,
  rename,
  copy,
  strReplace,
  applyEdits,
  insertLines,
  replaceLines,
  tree,
  organizeFiles,
  findReplace,
  searchFiles,
  grep,
  globFiles,
  runCommand,
  openTerminal,
  openPath,
  resolveInWorkspace,
  toWorkspaceRel,
  assertWorkspace,
};

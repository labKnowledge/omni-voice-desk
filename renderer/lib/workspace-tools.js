/**
 * Shared workspace tools (Claude Code–style action surface).
 * Used by the voice conversation loop and background jobs.
 */

const MAX_TOOL_CHARS = 8_000;

export const pack = (content, summary) => ({
  content: truncate(String(content ?? ""), MAX_TOOL_CHARS),
  details: { summary: summary != null ? String(summary).slice(0, 140) : undefined },
});

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/**
 * @param {object} api window.omniDesktop
 * @param {object} [opts]
 * @param {() => string|null} [opts.getWorkspace]
 * @param {boolean} [opts.includeMarkDone]
 * @param {(summary: string) => void} [opts.onDone]
 */
export function createWorkspaceTools(api, opts = {}) {
  const getWorkspace = opts.getWorkspace || (() => null);
  const ws = () => getWorkspace() || null;

  const needWs = () => {
    const w = ws();
    if (!w) throw new Error("No workspace set. Call pick_workspace first.");
    return w;
  };

  const tools = [
    {
      name: "list_dir",
      activity: "Listing",
      description: "List files/folders under a relative workspace path. Prefer this (or glob) over shell ls/find.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path (default .)" },
          depth: { type: "integer", description: "1–3" },
        },
      },
      async execute(args) {
        const result = await api.fs.list({
          workspace: needWs(),
          path: args?.path ? String(args.path) : ".",
          depth: Math.min(3, Math.max(1, Number(args?.depth) || 1)),
        });
        const lines = (result.entries || []).map((e) =>
          e.type === "dir" ? `${e.path}/` : e.path,
        );
        return pack(lines.join("\n") || "(empty)", `${lines.length} entries`);
      },
    },
    {
      name: "tree",
      activity: "Tree",
      description: "Show a compact folder tree. Prefer this to orient before editing.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative folder (default .)" },
          depth: { type: "integer", description: "1–4 (default 2)" },
        },
      },
      async execute(args) {
        const result = await api.fs.tree({
          workspace: needWs(),
          path: args?.path ? String(args.path) : ".",
          depth: Math.min(4, Math.max(1, Number(args?.depth) || 2)),
        });
        const note = result.truncated ? "\n…[truncated]" : "";
        return pack(`${result.tree}${note}`, `${result.entries} nodes`);
      },
    },
    {
      name: "glob",
      activity: "Globbing",
      description: "Find files by name glob (*.js, package.json).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
        },
        required: ["pattern"],
      },
      async execute(args) {
        const result = await api.fs.glob({
          workspace: needWs(),
          pattern: String(args?.pattern || "*"),
          path: args?.path ? String(args.path) : ".",
        });
        const lines = (result.hits || []).slice(0, 100).map((e) =>
          e.type === "dir" ? `${e.path}/` : e.path,
        );
        return pack(lines.join("\n") || "(no matches)", `${lines.length} hits`);
      },
    },
    {
      name: "search_files",
      activity: "Searching names",
      description: "Find paths whose name contains a substring.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          path: { type: "string" },
        },
        required: ["query"],
      },
      async execute(args) {
        const result = await api.fs.search({
          workspace: needWs(),
          query: String(args?.query || ""),
          path: args?.path ? String(args.path) : ".",
        });
        const lines = (result.hits || []).map((e) =>
          e.type === "dir" ? `${e.path}/` : e.path,
        );
        return pack(lines.join("\n") || "(no matches)", `${lines.length} hits`);
      },
    },
    {
      name: "grep",
      activity: "Grepping",
      description: "Search file contents with a regex (ripgrep when available). Prefer this over shell grep/rg.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          include: { type: "string", description: "Glob filter e.g. *.js,*.ts" },
          case_insensitive: { type: "boolean" },
        },
        required: ["pattern"],
      },
      async execute(args) {
        const result = await api.fs.grep({
          workspace: needWs(),
          pattern: String(args?.pattern || ""),
          path: args?.path ? String(args.path) : ".",
          include: args?.include ? String(args.include) : undefined,
          caseInsensitive: Boolean(args?.case_insensitive),
          max: 80,
        });
        const lines = (result.matches || []).map((m) =>
          m.path != null ? `${m.path}:${m.line}: ${m.text}` : m.raw,
        );
        return pack(lines.join("\n") || "(no matches)", `${result.count} hits`);
      },
    },
    {
      name: "stat_path",
      activity: "Stat",
      description: "Type, size, mtime for a relative path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      async execute(args) {
        const result = await api.fs.stat({
          workspace: needWs(),
          path: String(args?.path || ""),
        });
        return pack(
          `${result.path} · ${result.type} · ${result.size}B · ${result.mtime}`,
          result.path,
        );
      },
    },
    {
      name: "read_file",
      activity: "Reading",
      description:
        "Read a relative text file. Optional offset_lines/limit_lines return numbered slices (prefer for large files). Prefer this over shell cat/head/tail.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset_lines: { type: "integer", description: "0-based line start" },
          limit_lines: { type: "integer", description: "Max lines to return (default 200)" },
        },
        required: ["path"],
      },
      async execute(args) {
        const result = await api.fs.read({
          workspace: needWs(),
          path: String(args?.path || ""),
          maxBytes: 160_000,
          offset_lines: args?.offset_lines != null ? Number(args.offset_lines) : undefined,
          limit_lines: args?.limit_lines != null ? Number(args.limit_lines) : undefined,
        });
        const note = result.truncated ? "\n\n[truncated]" : "";
        const meta = result.lines != null ? ` · ${result.lines} lines` : "";
        return pack(`${result.content}${note}`, `${result.path}${meta}`);
      },
    },
    {
      name: "write_file",
      activity: "Writing",
      description: "Create or overwrite a relative text file. Prefer edit_file/apply_edits for changes to existing files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      async execute(args) {
        const result = await api.fs.write({
          workspace: needWs(),
          path: String(args?.path || ""),
          content: String(args?.content ?? ""),
        });
        return pack(`Wrote ${result.path} (${result.bytes} bytes).`, result.path);
      },
    },
    {
      name: "edit_file",
      activity: "Editing",
      description:
        "Edit a file by replacing an exact string (preferred for single changes). old_string must match uniquely unless replace_all=true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["path", "old_string", "new_string"],
      },
      async execute(args) {
        const result = await api.fs.strReplace({
          workspace: needWs(),
          path: String(args?.path || ""),
          old_string: String(args?.old_string ?? ""),
          new_string: String(args?.new_string ?? ""),
          replace_all: Boolean(args?.replace_all),
        });
        return pack(`Edited ${result.path} ×${result.replacements}`, result.path);
      },
    },
    {
      name: "str_replace",
      activity: "Editing",
      description: "Alias of edit_file — replace an exact string in a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["path", "old_string", "new_string"],
      },
      async execute(args) {
        const result = await api.fs.strReplace({
          workspace: needWs(),
          path: String(args?.path || ""),
          old_string: String(args?.old_string ?? ""),
          new_string: String(args?.new_string ?? ""),
          replace_all: Boolean(args?.replace_all),
        });
        return pack(`Updated ${result.path} ×${result.replacements}`, result.path);
      },
    },
    {
      name: "apply_edits",
      activity: "Multi-edit",
      description: "Apply several exact string replacements to one file in order. Prefer this over many edit_file calls.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          edits: {
            type: "array",
            description: "[{old_string, new_string, replace_all?}]",
            items: {
              type: "object",
              properties: {
                old_string: { type: "string" },
                new_string: { type: "string" },
                replace_all: { type: "boolean" },
              },
            },
          },
        },
        required: ["path", "edits"],
      },
      async execute(args) {
        const result = await api.fs.applyEdits({
          workspace: needWs(),
          path: String(args?.path || ""),
          edits: Array.isArray(args?.edits) ? args.edits : [],
        });
        return pack(
          `Applied ${result.edits} edits to ${result.path} (×${result.replacements})`,
          result.path,
        );
      },
    },
    {
      name: "insert_lines",
      activity: "Inserting",
      description: "Insert text before a 1-based line number (1 = top).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          line: { type: "integer" },
          content: { type: "string" },
        },
        required: ["path", "line", "content"],
      },
      async execute(args) {
        const result = await api.fs.insertLines({
          workspace: needWs(),
          path: String(args?.path || ""),
          line: Number(args?.line) || 1,
          content: String(args?.content ?? ""),
        });
        return pack(
          `Inserted ${result.lines_added} line(s) at ${result.path}:${result.inserted_at}`,
          result.path,
        );
      },
    },
    {
      name: "replace_lines",
      activity: "Replacing lines",
      description: "Replace an inclusive 1-based line range with new content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          start_line: { type: "integer" },
          end_line: { type: "integer" },
          content: { type: "string" },
        },
        required: ["path", "start_line", "content"],
      },
      async execute(args) {
        const result = await api.fs.replaceLines({
          workspace: needWs(),
          path: String(args?.path || ""),
          start_line: Number(args?.start_line) || 1,
          end_line: args?.end_line != null ? Number(args.end_line) : undefined,
          content: String(args?.content ?? ""),
        });
        return pack(
          `Replaced lines ${result.start_line}-${result.end_line} in ${result.path} (−${result.lines_removed}/+${result.lines_added})`,
          result.path,
        );
      },
    },
    {
      name: "append_file",
      activity: "Appending",
      description: "Append text to a relative file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      async execute(args) {
        const result = await api.fs.append({
          workspace: needWs(),
          path: String(args?.path || ""),
          content: String(args?.content ?? ""),
        });
        return pack(`Appended ${result.path} (${result.bytes} bytes).`, result.path);
      },
    },
    {
      name: "find_replace",
      activity: "Find-replace",
      description: "Replace a string across files matching a name glob (e.g. *.{js,ts}).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "File name glob" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          path: { type: "string", description: "Folder to search under" },
          replace_all: { type: "boolean" },
        },
        required: ["pattern", "old_string", "new_string"],
      },
      async execute(args) {
        const result = await api.fs.findReplace({
          workspace: needWs(),
          pattern: String(args?.pattern || "*"),
          old_string: String(args?.old_string ?? ""),
          new_string: String(args?.new_string ?? ""),
          path: args?.path ? String(args.path) : ".",
          replace_all: args?.replace_all !== false,
        });
        const lines = (result.updated || []).map((u) => `${u.path} ×${u.replacements}`);
        return pack(
          lines.join("\n") || "(no files updated)",
          `${result.files_touched} files / ×${result.replacements}`,
        );
      },
    },
    {
      name: "make_dir",
      activity: "mkdir",
      description: "Create a relative folder (e.g. \"notes\"). Never pass absolute paths.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      async execute(args) {
        const result = await api.fs.mkdir({
          workspace: needWs(),
          path: String(args?.path || ""),
        });
        return pack(result.message || `Created ${result.path}/`, result.path);
      },
    },
    {
      name: "organize_files",
      activity: "Organizing",
      description:
        "Move files matching a glob into a destination folder (keeps basenames). Use dry_run=true to preview. Example: pattern=*.md destination=docs.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          destination: { type: "string" },
          path: { type: "string", description: "Folder to search under (default .)" },
          dry_run: { type: "boolean" },
          overwrite: { type: "boolean" },
        },
        required: ["pattern", "destination"],
      },
      async execute(args) {
        const result = await api.fs.organize({
          workspace: needWs(),
          pattern: String(args?.pattern || ""),
          destination: String(args?.destination || ""),
          path: args?.path ? String(args.path) : ".",
          dry_run: Boolean(args?.dry_run),
          overwrite: Boolean(args?.overwrite),
        });
        const moved = (result.moved || []).map((m) => `${m.from} → ${m.to}`);
        const skipped = (result.skipped || []).map((s) => `skip ${s.path}: ${s.reason}`);
        const body = [
          result.dry_run ? "[dry run]" : null,
          ...moved,
          ...skipped.slice(0, 15),
        ].filter(Boolean).join("\n") || "(nothing to move)";
        return pack(body, `${result.count} moved`);
      },
    },
    {
      name: "remove_path",
      activity: "Removing",
      description: "Delete a relative file or folder.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      async execute(args) {
        const result = await api.fs.remove({
          workspace: needWs(),
          path: String(args?.path || ""),
        });
        return pack(
          result.removed ? `Removed ${result.path}` : `Missing ${result.path}`,
          result.path,
        );
      },
    },
    {
      name: "rename_path",
      activity: "Moving",
      description: "Rename or move one path within the workspace.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
      },
      async execute(args) {
        const result = await api.fs.rename({
          workspace: needWs(),
          from: String(args?.from || ""),
          to: String(args?.to || ""),
        });
        return pack(`${result.from} → ${result.to}`, result.to);
      },
    },
    {
      name: "copy_path",
      activity: "Copying",
      description: "Copy a file or folder within the workspace.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
      },
      async execute(args) {
        const result = await api.fs.copy({
          workspace: needWs(),
          from: String(args?.from || ""),
          to: String(args?.to || ""),
        });
        return pack(`Copied ${result.from} → ${result.to}`, result.to);
      },
    },
    {
      name: "run_command",
      activity: "Shell",
      description:
        "Run a shell command INVISIBLY in the workspace (git, npm, builds, scripts). Returns stdout/stderr. NEVER opens Terminal.app. Do NOT use open -a Terminal here. background=true for long-lived processes.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string", description: "Relative working directory" },
          background: { type: "boolean" },
        },
        required: ["command"],
      },
      async execute(args) {
        const result = await api.fs.run({
          workspace: needWs(),
          command: String(args?.command || ""),
          cwd: args?.cwd ? String(args.cwd) : ".",
          background: Boolean(args?.background),
        });
        if (result.background) {
          return pack(result.message || `bg pid ${result.pid}`, `pid ${result.pid}`);
        }
        const body = [
          `$ ${result.command}`,
          `exit ${result.code}`,
          result.stdout || "",
          result.stderr || "",
        ].filter(Boolean).join("\n");
        return pack(body, `exit ${result.code}`);
      },
    },
    {
      name: "open_terminal",
      activity: "Terminal",
      description:
        "RARE: open ONE visible Terminal window. ONLY if the user explicitly asked to open Terminal / Command Prompt. NEVER use this to run commands — use run_command instead. Opening this repeatedly creates many windows.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative folder (default .)" },
          command: {
            type: "string",
            description: "Optional command to run IN that one window after open",
          },
        },
      },
      async execute(args) {
        const result = await api.fs.openTerminal({
          workspace: needWs(),
          path: args?.path ? String(args.path) : ".",
          command: args?.command ? String(args.command) : undefined,
        });
        if (result.opened === "skipped") {
          return pack(result.message || "Skipped extra Terminal window.", "skipped");
        }
        return pack(
          `Opened ${result.opened} @ ${result.path}${result.command ? ` · ${result.command}` : ""}. Do not open another.`,
          result.path,
        );
      },
    },
    {
      name: "open_path",
      activity: "Open",
      description: "Open a workspace file/folder with the OS default app (not for running shell commands).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
      },
      async execute(args) {
        const result = await api.fs.open({
          workspace: needWs(),
          path: args?.path ? String(args.path) : ".",
        });
        return pack(`Opened ${result.path}`, result.path);
      },
    },
    {
      name: "launch_app",
      activity: "App",
      description:
        "Launch a desktop app by name (e.g. Visual Studio Code, Safari, Calculator). Do NOT use for Terminal — use open_terminal once only if the user asked, otherwise run_command.",
      parameters: {
        type: "object",
        properties: {
          application: { type: "string" },
          path: { type: "string" },
        },
        required: ["application"],
      },
      async execute(args) {
        const result = await api.fs.open({
          workspace: needWs(),
          application: String(args?.application || ""),
          path: args?.path ? String(args.path) : undefined,
        });
        return pack(
          result.message || `Launched ${args?.application}`,
          String(args?.application || "app"),
        );
      },
    },
  ];

  if (opts.includeMarkDone) {
    tools.unshift({
      name: "mark_done",
      activity: "Finishing",
      description:
        "Optional: call when a background job is clearly finished. Pass a short summary. You may also just stop calling tools and reply in text.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "What you accomplished" },
        },
        required: ["summary"],
      },
      async execute(args) {
        const summary = String(args?.summary || "Done.").trim() || "Done.";
        opts.onDone?.(summary);
        return pack(`DONE: ${summary}`, summary);
      },
    });
  }

  return tools;
}

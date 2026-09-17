// Render sessions and transcripts as plain text for the CLI.
import type { DatabaseSync } from "node:sqlite";
import type { FullSession, MessageData, PartData, SessionRow } from "./types.js";
import { listSessions, loadFullSession, type SessionFilter } from "./store.js";

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function clip(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + "…" : oneLine;
}

/** `ls`-style table of sessions. */
export function formatSessionList(db: DatabaseSync, filter: SessionFilter = {}): string {
  const rows = listSessions(db, filter);
  if (rows.length === 0) return "(no sessions)";
  const lines = rows.map((s: SessionRow) => {
    const tokens = s.tokens_input + s.tokens_output;
    return [
      s.id.slice(0, 16).padEnd(16),
      fmtTime(s.time_updated),
      (s.agent ?? "-").padEnd(8),
      String(tokens).padStart(8),
      clip(s.title || "(untitled)", 40).padEnd(40),
      clip(s.directory, 32),
    ].join("  ");
  });
  return lines.join("\n");
}

export interface RenderOptions {
  /** include reasoning (agent chain-of-thought) parts; default true */
  showReasoning?: boolean;
  /** include tool call parts; default true */
  showTools?: boolean;
  /** max chars per part body; 0 = unlimited */
  maxPartChars?: number;
}

function renderPart(part: PartData, opts: Required<RenderOptions>): string | null {
  const body = (text: string): string =>
    opts.maxPartChars > 0 && text.length > opts.maxPartChars
      ? text.slice(0, opts.maxPartChars) + `\n… [truncated, ${text.length} chars total]`
      : text;
  switch (part.type) {
    case "text":
      return body(String(part.text ?? ""));
    case "reasoning":
      if (!opts.showReasoning) return null;
      return "⟨reasoning⟩\n" + body(String(part.text ?? ""));
    case "tool": {
      if (!opts.showTools) return null;
      const tool = String(part.tool ?? part.name ?? "?");
      const state = part.state as { status?: string; input?: unknown; output?: unknown } | undefined;
      let out = `[tool: ${tool}]`;
      if (state?.status) out += ` (${state.status})`;
      if (state?.input !== undefined) out += `\ninput: ${body(JSON.stringify(state.input))}`;
      if (state?.output !== undefined) out += `\noutput: ${body(String(state.output))}`;
      return out;
    }
    case "step-start":
    case "step-finish":
      return null;
    case "file":
      return `[file: ${String(part.filename ?? part.url ?? "?")}]`;
    default:
      return `[part: ${part.type}]`;
  }
}

/** Render a full session as a readable transcript. */
export function renderTranscript(full: FullSession, opts: RenderOptions = {}): string {
  const o: Required<RenderOptions> = {
    showReasoning: opts.showReasoning ?? true,
    showTools: opts.showTools ?? true,
    maxPartChars: opts.maxPartChars ?? 0,
  };
  const s = full.session;
  const head = [
    `session ${s.id}`,
    `title:    ${s.title}`,
    `slug:     ${s.slug}`,
    `dir:      ${s.directory}`,
    `agent:    ${s.agent ?? "-"}    model: ${s.model ?? "-"}`,
    `created:  ${fmtTime(s.time_created)}    updated: ${fmtTime(s.time_updated)}`,
    `tokens:   in=${s.tokens_input} out=${s.tokens_output} reasoning=${s.tokens_reasoning} cache(r/w)=${s.tokens_cache_read}/${s.tokens_cache_write}`,
    s.parent_id ? `parent:   ${s.parent_id}` : null,
    "",
  ].filter((l): l is string => l !== null);

  const body: string[] = [];
  for (const { message, parts } of full.messages) {
    const meta = JSON.parse(message.data) as MessageData;
    const role = meta.role ?? "?";
    body.push(`--- ${role.toUpperCase()} ${message.id.slice(0, 16)} ${fmtTime(message.time_created)}`);
    for (const p of parts) {
      const rendered = renderPart(JSON.parse(p.data) as PartData, o);
      if (rendered) body.push(rendered, "");
    }
  }
  return [...head, ...body].join("\n");
}

export function showSession(db: DatabaseSync, sessionId: string, opts?: RenderOptions): string {
  return renderTranscript(loadFullSession(db, sessionId), opts);
}

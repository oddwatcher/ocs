// Row shapes of the opencode session store (SQLite, `data` columns are JSON text).

export interface SessionRow {
  id: string;
  project_id: string;
  workspace_id: string | null;
  parent_id: string | null;
  slug: string;
  directory: string;
  path: string;
  title: string;
  version: string;
  share_url: string | null;
  summary_additions: number;
  summary_deletions: number;
  summary_files: number;
  summary_diffs: string | null;
  metadata: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  revert: string | null;
  permission: string | null;
  agent: string | null;
  model: string | null;
  time_created: number;
  time_updated: number;
  time_compacting: number | null;
  time_archived: number | null;
}

export interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string; // JSON
}

export interface PartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string; // JSON
}

export interface TodoRow {
  session_id: string;
  content: string;
  status: string;
  priority: string;
  position: number;
  time_created: number;
  time_updated: number;
}

/** Decoded part payloads (subset; unknown fields are preserved via index signature). */
export interface PartData {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface MessageData {
  role?: string;
  parentID?: string;
  agent?: string;
  model?: { providerID: string; modelID: string; variant?: string };
  [key: string]: unknown;
}

export interface FullSession {
  session: SessionRow;
  messages: Array<{ message: MessageRow; parts: PartRow[] }>;
  todos: TodoRow[];
}

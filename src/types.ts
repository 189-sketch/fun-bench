export type Protocol = 'openai' | 'anthropic';
export interface ModelConfig {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  maxTokens: number;
  tokenParameter: 'max_tokens' | 'max_completion_tokens';
  hasKey: boolean;
}
export interface ModelTestResult {
  ok: boolean;
  reply?: string;
  latency?: number;
  error?: string;
}
export interface Criterion {
  name: string;
  description: string;
  maxScore: number;
}
export interface Task {
  id?: string;
  title: string;
  prompt: string;
  evaluation: string;
  format: 'text' | 'html';
  criteria: Criterion[];
}
export interface BenchSummary {
  id: string;
  title: string;
  createdAt: string;
  status: 'running' | 'done';
  demo?: boolean;
  taskCount: number;
  modelCount: number;
  revealed: boolean;
}
export interface Entry {
  id: string;
  taskId: string;
  status: 'pending' | 'queued' | 'running' | 'done' | 'failed';
  attempts?: number;
  content?: string;
  html?: string | null;
  truncated?: boolean;
  error?: string;
  outputChars?: number;
  model?: { id: string; name: string; model: string; protocol: string };
  duration?: number;
}
export type Scores = Record<string, number>;
export interface Bench {
  id: string;
  title: string;
  createdAt: string;
  demo?: boolean;
  status: 'running' | 'done';
  tasks: (Task & { id: string })[];
  activeIndex: number;
  participantCount: number;
  owner: boolean;
  sharePath?: string;
  order: Record<string, string[]>;
  revealed: boolean;
  revealedTasks: string[];
  lockedScores: Scores;
  myBallot: { scores: Scores; comment: string } | null;
  entries: Entry[];
  results?: { entryId: string; average: number | null; count: number }[];
  voterCount?: number;
}

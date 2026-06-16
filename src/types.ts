export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  done_at?: string;
}

export interface Deliverable {
  label: string;
  url: string;
}

export interface Link {
  label: string;
  url: string;
}

export const TACK_STATUSES = [
  "pending",
  "in_progress",
  "done",
  "blocked",
  "dropped",
] as const;

export type TackStatus = (typeof TACK_STATUSES)[number];

export interface Tack {
  id: string;
  summary: string;
  status: TackStatus;
  done_at?: string;
  depends_on?: string[];
  deliverable?: Deliverable;
  before?: TodoItem[];
  after?: TodoItem[];
  links?: Link[];
}

export interface Session {
  id: string;
  started_at: string;
  tacks?: string[];
}

export interface Route {
  id: string;
  slug: string;
  created_at: string;
  updated_at: string;
  group?: string;
  depends_on?: string[];
  sessions?: Session[];
  tacks: Tack[];
}

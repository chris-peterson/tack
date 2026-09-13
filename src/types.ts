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
  title?: string;
  description?: string;
  created_at: string;
  updated_at: string;
  group?: string;
  sessions?: Session[];
  tacks: Tack[];
}

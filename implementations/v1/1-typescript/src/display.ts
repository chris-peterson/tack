import type { Route, Tack, TodoItem } from "./types.js";

const STATUS_ICONS: Record<string, string> = {
  pending: " ",
  in_progress: ">",
  done: "x",
  blocked: "!",
  dropped: "-",
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? "?";
}

function formatTodoItem(item: TodoItem): string {
  const icon = item.done ? "x" : " ";
  const doneAt = item.done_at ? ` [${item.done_at}]` : "";
  return `[${icon}] ${item.id}: ${item.text}${doneAt}`;
}

export function formatTack(tack: Tack): string {
  const lines: string[] = [];
  const icon = statusIcon(tack.status);
  const project = tack.project ? ` (${tack.project})` : "";
  const doneAt = tack.done_at ? ` [${tack.done_at}]` : "";

  lines.push(`[${icon}] ${tack.id}: ${tack.summary}${project}${doneAt}`);

  if (tack.deliverable) {
    lines.push(`    deliverable: ${tack.deliverable.label} — ${tack.deliverable.url}`);
  }

  if (tack.depends_on?.length) {
    lines.push(`    depends on: ${tack.depends_on.join(", ")}`);
  }

  if (tack.before?.length) {
    for (const item of tack.before) {
      lines.push(`    before: ${formatTodoItem(item)}`);
    }
  }

  if (tack.after?.length) {
    for (const item of tack.after) {
      lines.push(`    after: ${formatTodoItem(item)}`);
    }
  }

  if (tack.links?.length) {
    for (const link of tack.links) {
      lines.push(`    link: ${link.label} — ${link.url}`);
    }
  }

  return lines.join("\n");
}

export function formatRoute(route: Route): string {
  const lines: string[] = [];
  lines.push(`# ${route.slug}`);
  lines.push(`  id: ${route.id}`);
  lines.push(`  created: ${route.created_at}`);
  lines.push(`  updated: ${route.updated_at}`);

  if (route.depends_on?.length) {
    lines.push(`  depends on routes: ${route.depends_on.join(", ")}`);
  }

  if (route.tacks.length === 0) {
    lines.push("\n  (no tacks)");
  } else {
    lines.push("");
    for (const tack of route.tacks) {
      lines.push(formatTack(tack));
    }
  }

  return lines.join("\n");
}

export function formatList(routes: { slug: string; total: number; open: number }[]): string {
  if (routes.length === 0) {
    return "No routes found.";
  }

  const lines: string[] = [];
  for (const r of routes) {
    lines.push(`${r.slug}  (${r.open} open / ${r.total} total)`);
  }
  return lines.join("\n");
}

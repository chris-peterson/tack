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
  const doneAt = tack.done_at ? ` [${tack.done_at}]` : "";

  lines.push(`[${icon}] ${tack.id}: ${tack.summary}${doneAt}`);

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
  if (route.group) lines.push(`  group: ${route.group}`);
  if (route.origin) lines.push(`  origin: ${route.origin}`);
  lines.push(`  created: ${route.created_at}`);
  lines.push(`  updated: ${route.updated_at}`);

  if (route.depends_on?.length) {
    lines.push(`  depends on routes: ${route.depends_on.join(", ")}`);
  }

  if (route.sessions?.length) {
    lines.push(`  sessions: ${route.sessions.length}`);
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

function formatTackDetails(tack: Tack, indent: string): string[] {
  const lines: string[] = [];
  if (tack.deliverable) {
    lines.push(`${indent}deliverable: ${tack.deliverable.label} — ${tack.deliverable.url}`);
  }
  if (tack.depends_on?.length) {
    lines.push(`${indent}depends on: ${tack.depends_on.join(", ")}`);
  }
  if (tack.before?.length) {
    for (const item of tack.before) {
      lines.push(`${indent}before: ${formatTodoItem(item)}`);
    }
  }
  if (tack.after?.length) {
    for (const item of tack.after) {
      lines.push(`${indent}after: ${formatTodoItem(item)}`);
    }
  }
  if (tack.links?.length) {
    for (const link of tack.links) {
      lines.push(`${indent}link: ${link.label} — ${link.url}`);
    }
  }
  return lines;
}

function globMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const re = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
  );
  return re.test(value);
}

const ASPECTS = ["deliverable", "before", "after", "links", "depends_on"] as const;
type Aspect = (typeof ASPECTS)[number];

function formatAspect(tack: Tack, aspect: Aspect): string | null {
  switch (aspect) {
    case "deliverable":
      return tack.deliverable ? `${tack.deliverable.label} — ${tack.deliverable.url}` : null;
    case "before":
      return tack.before?.length ? tack.before.map((i) => formatTodoItem(i)).join("\n") : null;
    case "after":
      return tack.after?.length ? tack.after.map((i) => formatTodoItem(i)).join("\n") : null;
    case "links":
      return tack.links?.length ? tack.links.map((l) => `${l.label} — ${l.url}`).join("\n") : null;
    case "depends_on":
      return tack.depends_on?.length ? tack.depends_on.join(", ") : null;
  }
}

function hasGlob(path: string): boolean {
  return path.includes("*") || path.includes("?");
}

function expandDoublestar(parts: string[]): string[][] {
  if (!parts.some((p) => p === "**")) return [parts];

  const results: string[][] = [];
  const idx = parts.indexOf("**");
  const before = parts.slice(0, idx);
  const after = parts.slice(idx + 1);

  const maxDepth = 3;
  const minFill = 0;
  const maxFill = maxDepth - before.length - after.length;
  for (let n = minFill; n <= maxFill; n++) {
    const expanded = [...before, ...Array(n).fill("*"), ...after];
    if (expanded.length >= 1 && expanded.length <= maxDepth) {
      const nested = expandDoublestar(expanded);
      results.push(...nested);
    }
  }
  return results;
}

function resolveGlobParts(routes: Route[], parts: string[]): string[] {
  const [slugPat, tackPat, aspectPat] = parts;
  const lines: string[] = [];

  const matchedRoutes = routes.filter((r) => globMatch(slugPat, r.slug));

  if (parts.length === 1) {
    for (const r of matchedRoutes) {
      const open = r.tacks.filter((t) => t.status !== "done" && t.status !== "dropped").length;
      const tag = r.origin === "tangent" ? " [tangent]" : "";
      lines.push(`${r.slug}/${tag}  (${open} open / ${r.tacks.length} total)`);
    }
    return lines;
  }

  if (parts.length === 2) {
    for (const r of matchedRoutes) {
      const matchedTacks = r.tacks.filter((t) => globMatch(tackPat, t.id));
      for (const tack of matchedTacks) {
        const icon = statusIcon(tack.status);
        lines.push(`${r.slug}/${tack.id}  [${icon}] ${tack.summary}`);
      }
    }
    return lines;
  }

  if (parts.length >= 3) {
    const matchedAspects = ASPECTS.filter((a) => globMatch(aspectPat, a));
    for (const r of matchedRoutes) {
      const matchedTacks = r.tacks.filter((t) => globMatch(tackPat, t.id));
      for (const tack of matchedTacks) {
        for (const aspect of matchedAspects) {
          const value = formatAspect(tack, aspect);
          if (value !== null) {
            lines.push(`${r.slug}/${tack.id}/${aspect}`);
            for (const line of value.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        }
      }
    }
    return lines;
  }

  return lines;
}

function resolveGlob(routes: Route[], path: string): string {
  const parts = path.split("/").filter(Boolean);
  const expanded = expandDoublestar(parts);
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const pat of expanded) {
    for (const line of resolveGlobParts(routes, pat)) {
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
    }
  }

  return lines.join("\n") || "No matches.";
}

export function formatTree(routes: Route[], path?: string, depth?: number): string {
  if (path && hasGlob(path)) {
    return resolveGlob(routes, path);
  }

  if (path?.includes("/")) {
    const parts = path.split("/").filter(Boolean);
    const [slug, tackId, aspect] = parts;
    if (tackId) {
      const route = routes.find((r) => r.slug === slug);
      if (!route) return `Route not found: ${slug}`;
      const tack = route.tacks.find((t) => t.id === tackId);
      if (!tack) return `Tack not found: ${tackId} in route ${slug}`;

      if (aspect) {
        const header = `${slug}/${tack.id}/${aspect}`;
        if (!ASPECTS.includes(aspect as Aspect)) return `Unknown aspect: ${aspect}`;
        const value = formatAspect(tack, aspect as Aspect);
        if (value === null) return `${header}\n  (none)`;
        return `${header}\n${value.split("\n").map((l) => `  ${l}`).join("\n")}`;
      }

      return `${slug}/${tack.id}\n` + formatTack(tack);
    }
    path = slug;
  }

  if (path) {
    const route = routes.find((r) => r.slug === path);
    if (!route) return `Route not found: ${path}`;
    const effectiveDepth = depth ?? 2;
    const lines: string[] = [`${route.slug}/`];
    for (const tack of route.tacks) {
      const icon = statusIcon(tack.status);
      lines.push(`  [${icon}] ${tack.id}: ${tack.summary}`);
      if (effectiveDepth >= 3) {
        lines.push(...formatTackDetails(tack, "      "));
      }
    }
    if (route.tacks.length === 0) lines.push("  (no tacks)");
    return lines.join("\n");
  }

  if (routes.length === 0) return "No routes found.";
  const effectiveDepth = depth ?? 1;
  const lines: string[] = [];
  for (const r of routes) {
    const open = r.tacks.filter((t) => t.status !== "done" && t.status !== "dropped").length;
    const tag = r.origin === "tangent" ? " [tangent]" : "";
    lines.push(`${r.slug}/${tag}  (${open} open / ${r.tacks.length} total)`);
    if (effectiveDepth >= 2) {
      for (const tack of r.tacks) {
        const icon = statusIcon(tack.status);
        lines.push(`  [${icon}] ${tack.id}: ${tack.summary}`);
        if (effectiveDepth >= 3) {
          lines.push(...formatTackDetails(tack, "      "));
        }
      }
      if (r.tacks.length === 0) lines.push("  (no tacks)");
    }
  }
  return lines.join("\n");
}

export function formatRecent(routes: { slug: string; group?: string; origin: string; updated_at: string; total: number; open: number }[]): string {
  if (routes.length === 0) {
    return "No recent routes found.";
  }

  const lines: string[] = [];
  for (const r of routes) {
    const tag = r.origin === "tangent" ? " [tangent]" : "";
    const updated = r.updated_at.slice(0, 16).replace("T", " ");
    lines.push(`${r.slug}${tag}  ${updated}  (${r.open} open / ${r.total} total)`);
  }
  return lines.join("\n");
}

export function formatList(routes: { slug: string; group?: string; origin: string; total: number; open: number }[]): string {
  if (routes.length === 0) {
    return "No routes found.";
  }

  const lines: string[] = [];
  for (const r of routes) {
    const tag = r.origin === "tangent" ? " [tangent]" : "";
    lines.push(`${r.slug}${tag}  (${r.open} open / ${r.total} total)`);
  }
  return lines.join("\n");
}

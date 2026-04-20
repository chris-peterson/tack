#!/usr/bin/env node

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as route from "./route.js";
import { formatRoute, formatTack, formatList, formatRecent, formatTree, formatFind } from "./display.js";
import { ZSH_COMPLETION } from "./completions.js";

function usage(): never {
  console.log(`tack — route tracker for AI-assisted development

Usage:
  tack init <slug> [--group <slug>]
  tack status [slug] [--all]
  tack list [--json]
  tack recent [--count <n>] [--since <date>]
  tack tree [path] [-d <depth>]    (path supports glob: */*/deliverable)
  tack add <slug> <summary> [--depends-on <id,...>]
  tack edit <slug> <tack-id> <summary>
  tack merge <slug> <source-id> <target-id>
  tack start <slug> <tack-id>
  tack done <slug> <tack-id>
  tack drop <slug> <tack-id>
  tack remove <slug> <tack-id> [--force]
  tack deliverable <slug> <tack-id> <label> <url>
  tack before <slug> <tack-id> <text>
  tack after <slug> <tack-id> <text>
  tack todo done <slug> <tack-id> <todo-id>
  tack todo rm <slug> <tack-id> <todo-id>
  tack link <slug> <tack-id> <label> <url>
  tack session <slug> <session-id>
  tack find <url> [--json]
  tack rm <slug> [--force]
  tack completions zsh`);
  process.exit(1);
}

function run(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case "init": {
      if (!rest[0]) usage();
      const { values: initValues } = parseArgs({
        args: rest,
        options: {
          group: { type: "string" },
        },
        allowPositionals: true,
      });
      const slug = rest.filter((a) => !a.startsWith("--"))[0];
      const r = route.init(slug, {
        group: initValues.group as string | undefined,
      });
      console.log(formatRoute(r));
      break;
    }

    case "status": {
      const jsonFlag = rest.includes("--json");
      const allFlag = rest.includes("--all");
      const slug = rest.filter((a) => a !== "--json" && a !== "--all")[0];
      if (slug) {
        const r = route.load(slug);
        const displayRoute = allFlag
          ? r
          : { ...r, tacks: r.tacks.filter((t) => t.status !== "dropped") };
        console.log(jsonFlag ? JSON.stringify(displayRoute, null, 2) : formatRoute(displayRoute));
      } else {
        const routes = route.list();
        console.log(jsonFlag ? JSON.stringify(routes, null, 2) : formatList(routes));
      }
      break;
    }

    case "list": {
      const jsonFlag = rest.includes("--json");
      if (jsonFlag) {
        console.log(JSON.stringify(route.loadAll(), null, 2));
      } else {
        console.log(formatList(route.list()));
      }
      break;
    }

    case "recent": {
      const { values: recentValues } = parseArgs({
        args: rest,
        options: {
          count: { type: "string" },
          since: { type: "string" },
        },
        allowPositionals: true,
      });
      const count = recentValues.count ? parseInt(recentValues.count as string, 10) : undefined;
      const since = recentValues.since as string | undefined;
      const recentRoutes = route.recent({ count, since });
      console.log(formatRecent(recentRoutes));
      break;
    }

    case "tree": {
      const { values: treeValues } = parseArgs({
        args: rest,
        options: {
          depth: { type: "string", short: "d" },
        },
        allowPositionals: true,
      });
      const treePath = rest.filter((a) => !a.startsWith("-") && a !== treeValues.depth)[0];
      const depth = treeValues.depth ? parseInt(treeValues.depth as string, 10) : undefined;
      const hasGlob = treePath && (treePath.includes("*") || treePath.includes("?"));
      const slugs = !treePath || hasGlob
        ? route.list().map((r) => r.slug)
        : [treePath.split("/")[0]];
      const routes = slugs.map((s) => route.load(s));
      console.log(formatTree(routes, treePath, depth));
      break;
    }

    case "add": {
      if (!rest[0] || !rest[1]) usage();
      const slug = rest[0];
      const summary = rest[1];

      const { values } = parseArgs({
        args: rest.slice(2),
        options: {
          "depends-on": { type: "string" },
        },
        strict: false,
      });

      const dependsOn = values["depends-on"]
        ? (values["depends-on"] as string).split(",")
        : undefined;

      const tack = route.addTack(slug, summary, {
        dependsOn,
      });
      console.log(formatTack(tack));
      break;
    }

    case "start": {
      if (!rest[0] || !rest[1]) usage();
      const tack = route.startTack(rest[0], rest[1]);
      console.log(formatTack(tack));
      break;
    }

    case "done": {
      if (!rest[0] || !rest[1]) usage();
      const { tack, pendingTodo } = route.markDone(rest[0], rest[1]);
      console.log(formatTack(tack));
      if (pendingTodo.length) {
        console.log("\nPending todo items:");
        for (const text of pendingTodo) {
          console.log(`  [ ] ${text}`);
        }
      }
      break;
    }

    case "drop": {
      if (!rest[0] || !rest[1]) usage();
      const tack = route.markDropped(rest[0], rest[1]);
      console.log(formatTack(tack));
      break;
    }

    case "deliverable": {
      if (rest.length < 4) usage();
      const tack = route.setDeliverable(rest[0], rest[1], rest[2], rest[3]);
      console.log(formatTack(tack));
      break;
    }

    case "before": {
      if (rest.length < 3) usage();
      const tack = route.addBefore(rest[0], rest[1], rest[2]);
      console.log(formatTack(tack));
      break;
    }

    case "after": {
      if (rest.length < 3) usage();
      const tack = route.addAfter(rest[0], rest[1], rest[2]);
      console.log(formatTack(tack));
      break;
    }

    case "todo": {
      const subcommand = rest[0];
      if (subcommand === "done") {
        if (rest.length < 4) usage();
        const tack = route.completeTodo(rest[1], rest[2], rest[3]);
        console.log(formatTack(tack));
      } else if (subcommand === "rm") {
        if (rest.length < 4) usage();
        const tack = route.dropTodo(rest[1], rest[2], rest[3]);
        console.log(formatTack(tack));
      } else {
        usage();
      }
      break;
    }

    case "edit": {
      if (rest.length < 3) usage();
      const tack = route.editTack(rest[0], rest[1], rest[2]);
      console.log(formatTack(tack));
      break;
    }

    case "merge": {
      if (rest.length < 3) usage();
      const tack = route.mergeTacks(rest[0], rest[1], rest[2]);
      console.log(formatTack(tack));
      break;
    }

    case "link": {
      if (rest.length < 4) usage();
      const tack = route.addLink(rest[0], rest[1], rest[2], rest[3]);
      console.log(formatTack(tack));
      break;
    }

    case "session": {
      if (!rest[0] || !rest[1]) usage();
      const r = route.recordSession(rest[0], rest[1]);
      console.log(formatRoute(r));
      break;
    }

    case "find": {
      const jsonFlag = rest.includes("--json");
      const url = rest.filter((a) => a !== "--json")[0];
      if (!url) usage();
      const matches = route.find(url);
      console.log(jsonFlag ? JSON.stringify(matches, null, 2) : formatFind(matches));
      break;
    }

    case "rm": {
      if (!rest[0]) usage();
      const force = rest.includes("--force");
      if (!force) {
        console.log(`Delete route ${rest[0]}? Pass --force to confirm.`);
        process.exit(1);
      }
      route.remove(rest[0]);
      console.log(`Deleted: ${rest[0]}`);
      break;
    }

    case "remove": {
      if (!rest[0] || !rest[1]) usage();
      const force = rest.includes("--force");
      const r = route.removeTack(rest[0], rest[1], { force });
      console.log(`Removed: ${rest[0]}/${rest[1]}`);
      console.log(formatRoute(r));
      break;
    }

    case "completions": {
      const shell = rest[0];
      if (shell === "zsh") {
        const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
        const zshrc = join(home, ".zshrc");
        const dir = join(home, ".zsh", "completions");
        const file = join(dir, "_tack");
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, ZSH_COMPLETION);
        console.log(`Installed: ${file}`);

        let zshrcContent = "";
        try { zshrcContent = readFileSync(zshrc, "utf-8"); } catch {}
        const hasFpath = zshrcContent.includes(".zsh/completions");
        const hasCompinit = zshrcContent.includes("compinit");
        const fpathLine = `fpath=(~/.zsh/completions $fpath)`;

        if (!hasFpath && hasCompinit) {
          const updated = zshrcContent.replace(
            /(.*compinit.*)/,
            `${fpathLine}\n$1`,
          );
          writeFileSync(zshrc, updated);
          console.log("Updated ~/.zshrc (added fpath before compinit).");
        } else if (!hasFpath && !hasCompinit) {
          const block = `\n${fpathLine}\nautoload -Uz compinit && compinit\n`;
          execSync(`echo '${block}' >> ${zshrc}`);
          console.log("Updated ~/.zshrc (added fpath + compinit).");
        }
        console.log("Restart your shell to activate.");
      } else {
        console.error(shell ? `Unsupported shell: ${shell}` : "Usage: tack completions <shell>");
        console.error("Supported shells: zsh");
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

run();

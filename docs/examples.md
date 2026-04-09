# Examples & Visualizations

The tack schema is intentionally view-agnostic. The same YAML files can power different visualizations depending on context. This page shows seven example routes rendered as five views — all derived from schema fields alone.

Source files: [`examples/`](https://github.com/chris-peterson/tack/tree/main/examples)

---

## View: Effort Flow (Sankey)

Shows how work flows from group through routes into projects. Each link is weighted by tack count. Ungrouped routes appear individually.

```mermaid
---
config:
  look: handDrawn
---
sankey-beta

q2,q2-session-setup,2
q2,q2-auth-rewrite,4
q2,q2-dependency-cleanup,7
q2,q2-usage-dashboard,5
hotfix-rate-limiter,acme/api-gateway,1
tangent-ci-flake,acme/api-server,1
tangent-ci-flake,acme/test-utils,1
tangent-docs-typo,acme/docs,1

q2-session-setup,acme/infra,1
q2-session-setup,acme/api-server,1
q2-auth-rewrite,acme/api-server,2
q2-auth-rewrite,acme/sdk-js,1
q2-auth-rewrite,acme/docs,1
q2-dependency-cleanup,acme/logging-lib,2
q2-dependency-cleanup,acme/api-server,1
q2-dependency-cleanup,acme/api-gateway,1
q2-dependency-cleanup,acme/worker-service,1
q2-dependency-cleanup,acme/batch-processor,1
q2-dependency-cleanup,acme/notification-service,1
q2-usage-dashboard,acme/analytics,2
q2-usage-dashboard,acme/api-gateway,1
q2-usage-dashboard,acme/web-app,2
```

Reads left to right: group → route → project. The width of each flow is proportional to tack count. `q2-dependency-cleanup` fans out the widest (7 tacks across 6 repos), and `acme/api-server` receives work from three different routes.

---

## View: Dependency Graph

Shows both intra-route and cross-route dependencies. The `q2-dependency-cleanup` route demonstrates the fan-out pattern: one library upgrade cascading to five consumer updates — a pattern no single-repo issue tracker captures well.

```mermaid
---
config:
  look: handDrawn
---
flowchart LR
  subgraph q2-session-setup
    S1[t1 Redis cluster]
    S2[t2 Session client]
    S1 --> S2
  end

  subgraph q2-auth-rewrite
    A1[t1 JWT middleware]
    A2[t2 SDK token refresh]
    A3[t3 Migrate tests]
    A4[t4 API docs]
    A1 --> A2
    A1 --> A3
    A2 --> A4
    A3 --> A4
  end

  subgraph q2-dependency-cleanup
    D1[t1 Logging v3]
    D2[t2 api-server]
    D3[t3 api-gateway]
    D4[t4 worker-service]
    D5[t5 batch-processor]
    D6[t6 notification-svc]
    D7[t7 Remove v2]
    D1 --> D2
    D1 --> D3
    D1 --> D4
    D1 --> D5
    D1 --> D6
    D2 --> D7
    D3 --> D7
    D4 --> D7
    D5 --> D7
    D6 --> D7
  end

  subgraph q2-usage-dashboard
    U1[t1 Metrics schema]
    U2[t2 Event emitter]
    U3[t3 Dashboard frontend]
    U4[t4 Drill-down]
    U5[t5 Alerting]
    U1 --> U2
    U2 --> U3
    U3 --> U4
    U2 --> U5
  end

  S2 -.->|route depends_on| A1

  style S1 fill:#2d6a2d,color:#fff
  style S2 fill:#2d6a2d,color:#fff
  style A1 fill:#2d6a2d,color:#fff
  style A2 fill:#2d6a2d,color:#fff
  style A3 fill:#b8860b,color:#fff
  style A4 fill:#555,color:#fff
  style D1 fill:#2d6a2d,color:#fff
  style D2 fill:#2d6a2d,color:#fff
  style D3 fill:#2d6a2d,color:#fff
  style D4 fill:#2d6a2d,color:#fff
  style D5 fill:#2d6a2d,color:#fff
  style D6 fill:#b8860b,color:#fff
  style D7 fill:#555,color:#fff
  style U1 fill:#2d6a2d,color:#fff
  style U2 fill:#2d6a2d,color:#fff
  style U3 fill:#b8860b,color:#fff
  style U4 fill:#555,color:#fff
  style U5 fill:#555,color:#fff
```

**Color key:** green = done, amber = in progress, grey = pending.

---

## View: Quarterly Report (Gantt)

Maps tack completion dates onto a timeline. Routes become sections; tacks become bars. Ungrouped work renders as `crit` to highlight interruptions.

Timespans are derived from `created_at` and `done_at` — no timeframe field needed.

```mermaid
---
config:
  look: handDrawn
---
gantt
  title Q2 Route Progress (Mar 10 – Apr 1)
  dateFormat YYYY-MM-DD
  axisFormat %b %d

  section q2-session-setup
    Provision Redis cluster          :done, ses1, 2026-03-10, 2026-03-12
    Session client library           :done, ses2, 2026-03-12, 2026-03-14

  section q2-auth-rewrite
    JWT middleware                    :done, auth1, 2026-03-15, 2026-03-18
    SDK token refresh                :done, auth2, 2026-03-22, 2026-03-25
    Migrate integration tests        :active, auth3, 2026-03-28, 5d
    API documentation                :auth4, after auth3, 3d

  section q2-dependency-cleanup
    Modernize logging lib to v3      :done, dep1, 2026-03-17, 2026-03-19
    Update api-server                :done, dep2, 2026-03-19, 2026-03-21
    Update api-gateway               :done, dep3, 2026-03-21, 2026-03-22
    Update worker-service            :done, dep4, 2026-03-22, 2026-03-23
    Update batch-processor           :done, dep5, 2026-03-23, 2026-03-24
    Update notification-service      :active, dep6, 2026-03-28, 4d
    Remove deprecated logging v2     :dep7, after dep6, 2d

  section q2-usage-dashboard
    Metrics schema                   :done, dash1, 2026-03-20, 2026-03-22
    Event emitter                    :done, dash2, 2026-03-22, 2026-03-26
    Dashboard frontend               :active, dash3, 2026-03-26, 7d
    Drill-down by tenant             :dash4, after dash3, 4d
    Alerting thresholds              :dash5, 2026-03-28, 5d

  section ungrouped
    Rate limiter hotfix              :crit, done, hot1, 2026-03-28, 2026-03-29
    CI Redis flake fix               :crit, done, ci1, 2026-03-20, 2026-03-20
    CI retry logic                   :crit, done, ci2, 2026-03-20, 2026-03-21
    Docs typo fix                    :crit, done, doc1, 2026-03-26, 2026-03-26
```

Ungrouped work (`crit` bars) appears as interruptions in the grouped timeline — useful for retrospectives to quantify reactive vs. intentional work.

---

## Deriving Views from Schema

> [!NOTE]
> Every visualization on this page maps directly to schema fields. No view requires data outside the schema. Any tool that reads conforming YAML can produce these visualizations.

| View | Key fields used |
|------|----------------|
| Effort flow (Sankey) | `group`, `slug`, `tacks[].deliverable.url` |
| Dependency graph | `depends_on` (route + tack level), `tacks[].status` |
| Quarterly Gantt | `created_at`, `tacks[].done_at`, `tacks[].depends_on`, `group` |

Time is always derived from timestamps on tacks and deliverables — never declared. Quarterliness is a reporting concern, not a schema concern.

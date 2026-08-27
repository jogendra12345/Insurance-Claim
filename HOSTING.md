# Hosting Reference

Notes on where/how to deploy ClaimFlow AI online for free (or near-free),
should that become necessary. Nothing here is set up yet — this is a
reference for when it is.

## Constraint that shapes everything

Self-managed Camunda 8 (Zeebe + Operate + Tasklist) is resource-heavy. The
local `camunda-docker/` stack already needed its `orchestration` container's
`mem_limit` bumped from 1g to 2g just to stay responsive under light load
(see `RUNNING-LOCALLY.md` step 6). Typical free-tier VMs (AWS/GCP/Azure
~1GB RAM) cannot run it. Plan around this rather than fighting it.

## Recommended split

| Piece | Platform | Why |
|---|---|---|
| Frontend (`frontend/portal`, Next.js) | **Vercel** | Zero-config Next.js deploy, generous free tier |
| Camunda (Zeebe/Operate/Tasklist) | **Camunda SaaS free tier** | Hosted cluster, no infra to manage — avoids the RAM problem entirely. Backend/workers point at the SaaS gRPC endpoint instead of `localhost:26500` |
| Postgres (`claims` DB) | **Supabase** or **Neon** | Free managed Postgres tier |
| Object storage (documents, replacing local MinIO) | Supabase Storage, or a free-tier S3-compatible bucket | MinIO itself is self-managed only |
| Backend API + job workers (Node/TS) | **Render** or **Railway** free/hobby tier | Needs to run continuously to poll Zeebe jobs; check whether the free tier sleeps on idle (would break job polling) |

## Alternative: fully self-managed on one free VM

If SaaS dependency is undesirable, **Oracle Cloud "Always Free" tier** is
the outlier among free VM offers — up to 24GB RAM on ARM (Ampere)
instances, enough to run the entire `docker-compose.yaml` +
`camunda-docker/docker-compose.yaml` stack (Postgres, MinIO, Camunda) on
one box. Trade-off: you own all patching/uptime/ops, and Oracle's free-tier
availability can be inconsistent by region.

## Open questions to resolve before actually deploying

- Does the chosen backend/worker host's free tier stay always-on? Job
  workers need to keep polling Zeebe continuously — a sleep-on-idle free
  tier (e.g. Render's) will silently stall claim processing.
- Camunda SaaS free tier limits (cluster size, retention) — check current
  terms before committing.
- CORS/env config changes needed once frontend and backend are on
  different domains (currently `RUNNING-LOCALLY.md` assumes both on
  `localhost`).
- Secrets management for `GEMINI_API_KEY` and DB credentials on whichever
  platforms are chosen.

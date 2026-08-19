# Guide

Plain-language walkthrough of each step in `ROADMAP.md` — what it is, why it exists, and what implementing it actually looks like. Written for zero prior knowledge of any of these tools.

## Step 1 — Database

**What it is:** A place to permanently store claim data — claimant info, documents, fraud flags, and the audit trail. Camunda does *not* store any of this (see the "Global limit" badges in `claim-lifecycle.html`) — it only tracks which step a process is on. The actual claim records live in a separate database: **PostgreSQL**.

**What implementing it means:** Writing a "schema" — a definition of tables and columns (like `claims` with columns `id`, `policy_number`, `claim_amount`, etc.) — and a "migration" file that creates those tables when run. In practice: a Postgres database running in Docker, and a folder of `.sql` files that define the four tables from `SPEC.md` §8. You run the migration once, and the empty tables exist, ready to be filled in as claims flow through.

## Step 2 — Camunda process (BPMN + DMN)

**What it is:** The actual flowchart Camunda runs. Two files: a **BPMN diagram** (the process — boxes and arrows: validate → extract evidence → route → review → settle) and a **DMN decision table** (the routing logic — "if fraud indicators, send to investigator").

**What implementing it means:** Opening Camunda Modeler (already installed) and either drawing the diagram by hand using its palette (drag boxes, connect arrows, name each one) or having the underlying XML file hand-written for you to open and inspect. Each box gets configured with a "job type" name — a string like `validate-claim` that tells Camunda which worker should handle it later. Once built, you click "Deploy" in Modeler, which uploads it to your local Camunda instance so it's ready to run.

## Step 3 — Backend API

**What it is:** A small web server — code that listens for requests over HTTP. Two jobs: accept a new claim submission from the frontend, and answer "what's the status of claim X?" when asked.

**What implementing it means:** A Node.js project (JavaScript's runtime) with a web framework like Express. `POST /api/claims` is one function: it takes the submitted form data, writes a row into the `claims` table, saves uploaded files, then tells Camunda "start a new process instance for this claim." `GET /api/claims/:id` is a second function: it just reads that claim's row back out of Postgres and returns it as data the frontend can display.

## Step 4 — Job workers

**What it is:** The actual "doers." Camunda's BPMN diagram has boxes like "Extract Evidence" — but Camunda itself can't extract anything. A **worker** is a small standalone program that connects to Camunda, says "give me any 'extract-evidence' jobs," and when one arrives, does the real work (in this case, calling the Claude API) and reports the result back.

**What implementing it means:** Eight small Node.js scripts, one per box in the diagram — `validate-claim`, `extract-evidence`, `detect-fraud-indicators`, `score-risk`, `trigger-settlement`, `draft-denial-letter`, `notify-claimant`, `close-case`. Each one is a loop: "wait for a job → do the work → send the result back to Camunda so it can move to the next step." Three of them (extract, detect-fraud, score-risk) call the Claude API; two (settle, notify) are "mocked" for now — meaning they pretend to succeed instead of actually charging a card or sending an email, since we don't have those real accounts set up yet.

## Step 5 — Frontend

**What it is:** The web pages a person actually sees and clicks — a form to submit a claim, and a page to check its status.

**What implementing it means:** A React app (using Next.js, a common React framework) with two pages. The submit page is an HTML form — text fields for claimant info, a file upload for documents — that, when submitted, calls the backend's `POST /api/claims` from Step 3. The status page calls `GET /api/claims/:id` and displays whatever comes back.

## Step 6 — Human review

**What it is:** This is where actual people — the triage staffer, adjuster, investigator, legal reviewer — do their part, inside **Tasklist**, the task queue screen that ships with Camunda for free (already running at `localhost:8080/tasklist`).

**What implementing it means:** Less coding, more configuration and testing. You set up which users belong to which "candidate group" (`adjusters`, `investigators`, etc.) so tasks land in front of the right people, then manually walk a test claim through: open Tasklist, see the triage task appear, confirm the AI's suggested routing, see it land in the right reviewer's queue, approve or deny it. This is where we verify the human-in-the-loop part of the design actually works as intended.

## Step 7 — End-to-end test

**What it is:** Running the whole thing, several times, with different kinds of claims, to prove every path works — not just the happy path.

**What implementing it means:** Submitting four test claims through the real frontend: one small and clean (should auto-approve with no human involved), one with fraud signals (should land with an investigator), one large or liability-type (should land with legal), and one that gets denied. Then checking the `audit_log` table for each one to confirm it tells the full story of what happened and why.

## A note on order

Each step needs the one before it — workers (4) need the process deployed (2) and the database ready (1); the frontend (5) needs the API (3) to call. So this list is also the literal build sequence.

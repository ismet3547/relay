# Relay — AI Operations Agent demo

A standalone, interactive local product demo for the fictional **Northline Auto** service shop. Built with Next.js App Router, TypeScript, Tailwind CSS, and Lucide. No credentials, cloud services, or existing repositories are needed.

## Run locally

Use Node.js **20.9 or newer** (Node 22/24 LTS recommended). Unzip the project, then run in its folder:

```sh
cd ai-operations-agent
npm ci
npm run dev
```

Open **http://localhost:3000**. Keep this terminal open. Windows PowerShell uses the same commands. If port 3000 is occupied, Next prints the alternative address.

For a production build: `npm run build`, then `npm start`.

## Walkthrough

1. In **Operations**, select **Successful appointment** and press **Start Demo Call**.
2. You play the customer. Use reply buttons or type a request such as `I'd like to book an oil change tomorrow morning.`
3. Give a vehicle, for example `My car is a 2021 Honda Civic.` The vehicle is deliberately not copied from the seeded customer record; the agent asks you to supply it.
4. Choose a returned time, then explicitly confirm. No appointment is written before this confirmation.
5. Switch to **AI Engine** at any point. The same call continues, and its conversation console also accepts customer input. Inspect active stages, entities, decisions, tool arguments/results, and expandable timestamped events.
6. After confirmation, find the saved appointment in Operations and inspect the final evaluation. The engine performs a real booking lookup before reporting success.
7. Run **Scheduling conflict**. Tomorrow at **9:00 AM** is occupied by a seeded appointment. Accept a returned alternative or decline; these produce different stored outcomes.
8. Run **Human handoff** and request a warranty refund. The tool saves a handoff in a local queue. It does not contact an actual advisor.
9. **Pause** stops new calls; the current conversation can finish. **End call** closes a waiting call without booking. **Reset demo** restores the seeded examples and clears session data so every scenario can be replayed.

For free text, the deterministic parser recognizes oil changes, `today`, `tomorrow`, ISO dates (`YYYY-MM-DD`), `morning` / `afternoon`, times such as `10:00` or `10 AM`, vehicle descriptions starting with a year, and explicit confirmation/cancellation. Dates must be valid and within 30 days. Other services and unsupported requests are routed to a human. This is a bounded workflow, not an open-ended conversational model.

## What is real and what is simulated

| Real local application behavior | Simulated / absent integrations |
| --- | --- |
| Call sessions, transcripts, structured events and shared screen state | Phone connection and customer audio |
| `check_availability` reads persisted appointments | Speech-to-text passes typed text through |
| `create_booking` validates and saves an appointment | Intent/entity detection uses deterministic rules |
| `lookup_booking` reads and verifies that appointment | Decision layer uses approved workflow rules |
| `request_human_handoff` saves a local queue record | Agent responses are templates, with no LLM or speech provider |
| SSE streams backend state transitions to both screens | No actual advisor notification or model training |
| Outcome reports use actual tool results and call state | Four historical example calls are labeled **Seeded example** |

New conversations and appointments are labeled **This session**. Pipeline stages never replay a fixed animation: they activate when the backend emits the corresponding transition. AI-related stages are explicitly labeled **Simulated**. The inspector shows observable decisions and execution metadata, not private model reasoning.

## Structure

```text
src/app/                 App Router page, styles, and API route handlers
src/components/          Operations, call console, engine, inspector, and timeline
src/hooks/use-demo.ts    Shared SSE subscription and HTTP actions
src/lib/                 Shared types and display/date helpers
src/server/store.ts     Atomic local JSON persistence and state subscriptions
src/server/seed.ts      Fictional business, customers, and labeled examples
src/server/orchestrator.ts  Call manager and deterministic conversation workflow
src/server/tools.ts     Validated local tool registry and booking safeguards
src/server/events.ts    Structured events and processing-stage transitions
src/server/evaluation.ts  Reports from recorded outcomes and tool results
tests/                  Workflow and data-protection regression tests
scripts/smoke.mjs        Temporary dev-server HTTP/SSE integration checks
```

Persistence is **`.demo-data/state.json`**, created automatically at first use and excluded from the download. Writes use a temporary file and atomic rename in one Node process. A call ID is the booking idempotency key; a persisted date/time has one-bay capacity. Replayed inputs do not repeat operations. A conflict arising after availability was checked is caught again when the booking is written. Restarting the server preserves committed appointments and safely closes interrupted calls.

Schedule times use **UTC**, not your computer's timezone. Reset refreshes the relative dates in seeded appointments if you return on another day. Local font assets require no runtime font service.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:api
npm run build
```

The HTTP test starts an isolated dev server on port 3100, uses a temporary data folder, verifies all scenarios plus SSE synchronization and duplicate booking protection, then stops its server. Override `TEST_PORT` if needed.

## Boundaries and future integrations

This is a single-process local demo, with one active call and one service bay. There is no production authentication, multi-tenancy, real telephony, billing, CRM, real customer data, autonomous learning, or production database locking. The server binds to loopback; do not expose this demo as a production service. The JSON store is intended for one Node process, not multiple workers or multiple servers sharing the same file.

To integrate later, replace the text transport with a voice/telephony adapter, add a reviewed structured decision provider behind the orchestrator, and replace the store with transactional persistence. Retain tool validation, explicit customer confirmation, slot uniqueness, idempotency, result verification, and observable event contracts. Evaluation is a report for human review, not automatic self-modification.

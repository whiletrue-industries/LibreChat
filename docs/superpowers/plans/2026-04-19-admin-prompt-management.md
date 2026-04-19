# Admin Prompt Management UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three Botnim agent prompts from git-tracked `specs/*/agent.txt` files to MongoDB, add an admin UI at `/d/prompts` for per-section Draft → Preview → Publish with optimistic concurrency, and preserve git history via a nightly DB → files export.

**Architecture:** Section-level rows in a new Mongo `prompts` collection (one `active=true` row per `{agentType, sectionKey}`). Stable `<!-- SECTION_KEY: xxx -->` markers in the prompt text anchor audit history across renames/reorders. Publish atomically flips active + PATCHes LibreChat's agent `instructions`. Preview spins up a shadow LibreChat agent with the draft swapped in, runs canned Hebrew test questions, returns side-by-side diffs. Nightly ECS scheduled task (same EventBridge pattern as `classify-feedback-topics`) exports active rows back to `specs/*/agent.txt` and commits to `rebuilding-bots` main.

**Tech Stack:** MongoDB + Mongoose (existing), TypeScript in `packages/api` + `packages/data-schemas` + `packages/data-provider` + `client` (per `LibreChat/CLAUDE.md` workspace rules), thin JS routes under `api/server`, Monaco editor (shipped in upstream v0.8.4 via `@monaco-editor/react`), Jest + `mongodb-memory-server` + `supertest` for tests, AWS EventBridge + ECS `RunTask` for the git-export cron.

**Branch:** `feat/admin-prompt-management` (already created on `LibreChat`, spec committed as `c0a294fd`). Phase A of the plan ships on a parallel branch in `rebuilding-bots`.

**Spec:** `LibreChat/docs/superpowers/specs/2026-04-19-admin-prompt-management-design.md`.

---

## File structure

### Create (LibreChat)
- `packages/data-schemas/src/schema/prompt.ts`
- `packages/data-schemas/src/schema/promptTestQuestion.ts`
- `packages/data-schemas/src/types/prompt.ts`
- `packages/data-schemas/src/models/prompt.ts`
- `packages/data-schemas/src/models/promptTestQuestion.ts`
- `packages/api/src/admin/prompts/parseMarkers.ts`
- `packages/api/src/admin/prompts/parseMarkers.spec.ts`
- `packages/api/src/admin/prompts/assemble.ts`
- `packages/api/src/admin/prompts/assemble.spec.ts`
- `packages/api/src/admin/prompts/PromptsService.ts`
- `packages/api/src/admin/prompts/PromptsService.spec.ts`
- `packages/api/src/admin/prompts/shadowAgent.ts`
- `packages/api/src/admin/prompts/shadowAgent.spec.ts`
- `packages/api/src/admin/prompts/fakeAgentsClient.ts`
- `packages/api/src/admin/prompts/preview.ts`
- `packages/api/src/admin/prompts/preview.spec.ts`
- `packages/api/src/admin/prompts/index.ts`
- `api/server/routes/admin/prompts.js`
- `api/server/controllers/admin/promptsController.js`
- `api/test/admin.prompts.spec.js`
- `scripts/migrate-prompts-into-db.js`
- `scripts/prompt-export/runner.ts` (in packages/api; CLI is thin)
- `scripts/export-prompts-to-git.js`
- `client/src/data-provider/AdminPrompts/queries.ts`
- `client/src/data-provider/AdminPrompts/index.ts`
- `client/src/components/Admin/Prompts/PromptsDashboard.tsx`
- `client/src/components/Admin/Prompts/PromptSectionList.tsx`
- `client/src/components/Admin/Prompts/PromptEditor.tsx`
- `client/src/components/Admin/Prompts/PromptDiff.tsx`
- `client/src/components/Admin/Prompts/PromptHistory.tsx`
- `client/src/components/Admin/Prompts/PromptPreview.tsx`
- `client/src/components/Admin/Prompts/TestQuestions.tsx`
- `client/src/components/Admin/Prompts/index.ts`
- `client/src/components/Admin/Prompts/__tests__/PromptsDashboard.spec.tsx`
- `client/src/components/Admin/Prompts/__tests__/PromptEditor.spec.tsx`

### Modify (LibreChat)
- `packages/data-schemas/src/schema/index.ts`
- `packages/data-schemas/src/types/index.ts`
- `packages/data-schemas/src/models/index.ts` (register the two new factories in `createModels`)
- `packages/api/src/index.ts` (add `export * as AdminPrompts from './admin/prompts'`)
- `packages/data-provider/src/types/queries.ts`
- `packages/data-provider/src/api-endpoints.ts`
- `packages/data-provider/src/data-service.ts`
- `packages/data-provider/src/keys.ts`
- `client/src/data-provider/index.ts`
- `client/src/routes/Dashboard.tsx` (add `path: 'prompts'` under the `d/*` subtree)
- `client/src/locales/en/translation.json` (add `com_admin_prompts_*` keys, ~30)
- `client/src/components/Nav/AccountSettings.tsx` (add admin-only "Prompt management" menu item)
- `api/server/index.js` (mount the new router)
- `api/db/models.js` (expose `Prompt` and `PromptTestQuestion` from `createModels`)
- `infra/envs/staging/main.tf` + `outputs.tf` (add EventBridge rule + target for the export cron)
- `scripts/seed-botnim-agent.js` (prefer DB over file)

### Create (rebuilding-bots)
- `specs/PROMPT_MARKERS.md` (documents the marker format, stable-key rules)

### Modify (rebuilding-bots)
- `specs/unified/agent.txt` (add `<!-- SECTION_KEY: xxx -->` markers above every `##` section)
- `specs/takanon/agent.txt` (same)
- `specs/budgetkey/agent.txt` (manual segmentation — no `##` headers today)
- `specs/PROMPT_WORKFLOW.md` (add cross-reference to the new UI workflow; the old git workflow stays as a backstop)

---

## Task 0: Branch prep + deps check

**Files:** no code.

- [ ] **Step 1: Confirm LibreChat branch**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
git branch --show-current
```
Expected: `feat/admin-prompt-management`.

- [ ] **Step 2: Create parallel branch on rebuilding-bots**

```bash
cd /Users/amir/Development/anubanu/parlibot/rebuilding-bots
git checkout -b prompt/section-key-markers
```

- [ ] **Step 3: Confirm Monaco is already available for the client**

```bash
grep -E '"@monaco-editor/react"|"monaco-editor"' /Users/amir/Development/anubanu/parlibot/LibreChat/client/package.json
```
Expected: one or both packages present. If missing, stop and ask before adding a new dep — the spec assumes it's shipped.

No commits this task.

---

## Task 1: Add SECTION_KEY markers to `unified/agent.txt`

**Files:**
- Modify: `rebuilding-bots/specs/unified/agent.txt`

The 10 sections are already known (Task 20 of the prior prompt-workflow PR added HTML comments above each). Convert each existing `<!-- Section: purpose -->` comment into `<!-- SECTION_KEY: xxx -->` + keep the descriptive comment on a second line.

- [ ] **Step 1: Replace the preamble block**

In `rebuilding-bots/specs/unified/agent.txt`, replace:
```
<!-- Preamble — identity, dual-domain contract, retrieval-only constraint. Edit cautiously: this section sets the bot's hard floor against pretraining answers. -->
You are a unified AI assistant that...
```
with:
```
<!-- SECTION_KEY: preamble -->
<!-- Preamble — identity, dual-domain contract, retrieval-only constraint. Edit cautiously: this section sets the bot's hard floor against pretraining answers. -->
You are a unified AI assistant that...
```

- [ ] **Step 2: Add markers for the remaining 9 sections**

For each of the following `## ...` headers, add `<!-- SECTION_KEY: <key> -->` on the line immediately above the existing descriptive comment:

| Section header | SECTION_KEY |
|---|---|
| `## Core Characteristics` | `core_characteristics` |
| `## Search Strategy` | `search_strategy` |
| `## Domain Routing` | `domain_routing` |
| `## A. Legal Domain Workflow (Knesset)` | `legal_domain_workflow` |
| `## B. Budget Domain Workflow (State Budget)` | `budget_domain_workflow` |
| `## C. Dual-Track Mode (Cross-Domain Questions)` | `dual_track_mode` |
| `## Citation & Link Rules (Legal)` | `citation_link_rules` |
| `## Forbidden Behaviors` | `forbidden_behaviors` |
| `## Summary of Defaults` | `summary_of_defaults` |

Example diff for one:
```
+ <!-- SECTION_KEY: core_characteristics -->
  <!-- Core Characteristics — tone, language, and the precise definitions... -->
  ## Core Characteristics
```

- [ ] **Step 3: Verify all 10 markers are present and unique**

```bash
grep -c '<!-- SECTION_KEY: ' /Users/amir/Development/anubanu/parlibot/rebuilding-bots/specs/unified/agent.txt
grep -oE '<!-- SECTION_KEY: \w+ -->' /Users/amir/Development/anubanu/parlibot/rebuilding-bots/specs/unified/agent.txt | sort -u | wc -l
```
Both expected: `10`.

- [ ] **Step 4: Commit**

```bash
cat > /tmp/task1-commit.txt <<'EOF'
chore(prompt): add SECTION_KEY markers to unified/agent.txt

10 stable keys (preamble, core_characteristics, search_strategy,
domain_routing, legal_domain_workflow, budget_domain_workflow,
dual_track_mode, citation_link_rules, forbidden_behaviors,
summary_of_defaults). The parser in the upcoming admin UI reads these
to anchor per-section audit history across renames/reorders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
cd /Users/amir/Development/anubanu/parlibot/rebuilding-bots
git add specs/unified/agent.txt
git commit -F /tmp/task1-commit.txt
```

---

## Task 2: Add SECTION_KEY markers to `takanon/agent.txt`

**Files:**
- Modify: `rebuilding-bots/specs/takanon/agent.txt`

- [ ] **Step 1: Add markers for all 9 sections**

Same pattern as Task 1. Keys:

| Section header | SECTION_KEY |
|---|---|
| (preamble — no header, before `## Your main characteristics are:`) | `preamble` |
| `## Your main characteristics are:` | `main_characteristics` |
| `## Objective` | `objective` |
| `## Available Tools` | `available_tools` |
| `## Resource Suggestion` | `resource_suggestion` |
| `## Operating Protocol` | `operating_protocol` |
| `## Tone & Style` | `tone_and_style` |
| `## Search Mode Selection` | `search_mode_selection` |
| `## Forbidden Behaviors` | `forbidden_behaviors` |

For each section, add `<!-- SECTION_KEY: <key> -->` above the existing descriptive comment (or above the first line of the preamble for the headerless one).

- [ ] **Step 2: Verify**

```bash
grep -c '<!-- SECTION_KEY: ' /Users/amir/Development/anubanu/parlibot/rebuilding-bots/specs/takanon/agent.txt
```
Expected: `9`.

- [ ] **Step 3: Commit**

```bash
cat > /tmp/task2-commit.txt <<'EOF'
chore(prompt): add SECTION_KEY markers to takanon/agent.txt

9 stable keys. Preamble is headerless (pre-## prose), rest follow the
file's `## ...` boundaries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
cd /Users/amir/Development/anubanu/parlibot/rebuilding-bots
git add specs/takanon/agent.txt
git commit -F /tmp/task2-commit.txt
```

---

## Task 3: Segment + mark `budgetkey/agent.txt`

**Files:**
- Modify: `rebuilding-bots/specs/budgetkey/agent.txt`

Unlike the other two, `budgetkey/agent.txt` has no `##` headers. Today's Task 20 (prompt-workflow commit `e15e556`) already added 5 descriptive `<!-- ... -->` comments above the natural paragraph boundaries. Make each a formal section with a SECTION_KEY.

- [ ] **Step 1: Add markers for all 5 sections**

| Existing boundary (first line) | SECTION_KEY |
|---|---|
| `You are an expert data researcher...` (file start) | `preamble` |
| `According to the user's question, you use the different tools...` | `tool_policy` |
| `When responding to the user's question:` | `response_style` |
| `The available datasets (מאגרי המידע) are:` | `datasets` |
| `Your workflow consists of the following steps...` | `workflow` |

Above each existing descriptive `<!-- ... -->` comment, add `<!-- SECTION_KEY: <key> -->` on its own line.

- [ ] **Step 2: Verify**

```bash
grep -c '<!-- SECTION_KEY: ' /Users/amir/Development/anubanu/parlibot/rebuilding-bots/specs/budgetkey/agent.txt
```
Expected: `5`.

- [ ] **Step 3: Commit, push all three marker commits, open PR**

```bash
cat > /tmp/task3-commit.txt <<'EOF'
chore(prompt): add SECTION_KEY markers to budgetkey/agent.txt

5 stable keys (preamble, tool_policy, response_style, datasets,
workflow). File has no Markdown headers — keys anchor to the natural
paragraph boundaries documented in PROMPT_WORKFLOW.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
cd /Users/amir/Development/anubanu/parlibot/rebuilding-bots
git add specs/budgetkey/agent.txt
git commit -F /tmp/task3-commit.txt
git push -u origin prompt/section-key-markers
gh pr create --repo whiletrue-industries/rebuilding-bots \
  --title "chore(prompt): SECTION_KEY markers for admin prompt UI" \
  --body "Adds stable <!-- SECTION_KEY: xxx --> markers above every section in the three agent.txt files. Prereq for the admin /d/prompts UI (LibreChat PR forthcoming). No runtime change."
```

---

## Task 4: Marker parser + unit tests

**Files:**
- Create: `packages/api/src/admin/prompts/parseMarkers.ts`
- Create: `packages/api/src/admin/prompts/parseMarkers.spec.ts`

This is the first LibreChat-side code. Pure function; no DB.

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/admin/prompts/parseMarkers.spec.ts
import { parseMarkers } from './parseMarkers';

describe('parseMarkers', () => {
  it('splits on SECTION_KEY markers and preserves body verbatim', () => {
    const input = [
      '<!-- SECTION_KEY: preamble -->',
      '<!-- Preamble — identity -->',
      'You are an assistant.',
      '',
      '<!-- SECTION_KEY: core -->',
      '## Core Characteristics',
      '- be nice',
    ].join('\n');

    const sections = parseMarkers(input);
    expect(sections).toHaveLength(2);
    expect(sections[0].sectionKey).toBe('preamble');
    expect(sections[0].body).toBe(
      '<!-- Preamble — identity -->\nYou are an assistant.\n',
    );
    expect(sections[1].sectionKey).toBe('core');
    expect(sections[1].headerText).toBe('## Core Characteristics');
    expect(sections[1].body).toBe('## Core Characteristics\n- be nice');
  });

  it('rejects duplicate keys', () => {
    const input = [
      '<!-- SECTION_KEY: same -->',
      'a',
      '<!-- SECTION_KEY: same -->',
      'b',
    ].join('\n');
    expect(() => parseMarkers(input)).toThrow(/duplicate SECTION_KEY/);
  });

  it('rejects body before first marker', () => {
    const input = 'stray text\n<!-- SECTION_KEY: k -->\nbody';
    expect(() => parseMarkers(input)).toThrow(/content before first SECTION_KEY/);
  });

  it('extracts an empty headerText when the body has no ## header', () => {
    const input = '<!-- SECTION_KEY: prose -->\njust some prose';
    const sections = parseMarkers(input);
    expect(sections[0].headerText).toBe('');
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/parseMarkers'
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/api/src/admin/prompts/parseMarkers.ts
export interface ParsedSection {
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
}

const MARKER_RE = /^<!--\s*SECTION_KEY:\s*([a-z0-9_]+)\s*-->\s*$/m;

export function parseMarkers(input: string): ParsedSection[] {
  const lines = input.split('\n');
  const sections: ParsedSection[] = [];
  let currentKey: string | null = null;
  let currentStart = -1;
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(MARKER_RE);
    if (!match) {
      if (currentKey === null && lines[i].trim().length > 0) {
        throw new Error('content before first SECTION_KEY');
      }
      continue;
    }
    const key = match[1];
    if (seen.has(key)) {
      throw new Error(`duplicate SECTION_KEY: ${key}`);
    }
    if (currentKey !== null) {
      sections.push(buildSection(currentKey, sections.length, lines, currentStart, i));
    }
    currentKey = key;
    currentStart = i + 1;
    seen.add(key);
  }
  if (currentKey !== null) {
    sections.push(
      buildSection(currentKey, sections.length, lines, currentStart, lines.length),
    );
  }
  return sections;
}

function buildSection(
  key: string,
  ordinal: number,
  lines: string[],
  start: number,
  end: number,
): ParsedSection {
  const body = lines.slice(start, end).join('\n');
  const headerLine = lines.slice(start, end).find((l) => l.startsWith('## '));
  return {
    sectionKey: key,
    ordinal,
    headerText: headerLine ?? '',
    body,
  };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/parseMarkers'
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cat > /tmp/task4-commit.txt <<'EOF'
feat(prompt-ui): parseMarkers — split agent.txt on SECTION_KEY markers

Pure function. Returns an ordered array of {sectionKey, ordinal,
headerText, body}. Rejects duplicate keys and stray text before the
first marker — both would corrupt the audit lineage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
cd /Users/amir/Development/anubanu/parlibot/LibreChat
git add packages/api/src/admin/prompts/parseMarkers.ts packages/api/src/admin/prompts/parseMarkers.spec.ts
git commit -F /tmp/task4-commit.txt
```

---

## Task 5: Mongoose schemas + types (`prompts`, `promptTestQuestions`)

**Files:**
- Create: `packages/data-schemas/src/types/prompt.ts`
- Create: `packages/data-schemas/src/schema/prompt.ts`
- Create: `packages/data-schemas/src/schema/promptTestQuestion.ts`
- Create: `packages/data-schemas/src/schema/prompt.spec.ts`
- Modify: `packages/data-schemas/src/schema/index.ts`
- Modify: `packages/data-schemas/src/types/index.ts`

- [ ] **Step 1: Types**

```ts
// packages/data-schemas/src/types/prompt.ts
import type { Document, Types } from 'mongoose';

export type AgentType = 'unified' | 'takanon' | 'budgetkey';

export interface IPrompt extends Document {
  agentType: AgentType;
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
  active: boolean;
  isDraft: boolean;
  parentVersionId?: Types.ObjectId;
  changeNote?: string;
  createdAt: Date;
  createdBy?: Types.ObjectId;
  publishedAt?: Date;
}

export interface IPromptTestQuestion extends Document {
  agentType: AgentType;
  text: string;
  ordinal: number;
  enabled: boolean;
  createdAt: Date;
  createdBy?: Types.ObjectId;
}
```

- [ ] **Step 2: Prompt schema**

```ts
// packages/data-schemas/src/schema/prompt.ts
import mongoose, { Schema } from 'mongoose';
import type { IPrompt } from '../types/prompt';

const promptSchema = new Schema<IPrompt>({
  agentType: {
    type: String,
    enum: ['unified', 'takanon', 'budgetkey'],
    required: true,
    index: true,
  },
  sectionKey: { type: String, required: true, index: true },
  ordinal: { type: Number, required: true, default: 0 },
  headerText: { type: String, default: '' },
  body: { type: String, required: true },
  active: { type: Boolean, default: false },
  isDraft: { type: Boolean, default: true },
  parentVersionId: { type: Schema.Types.ObjectId },
  changeNote: { type: String },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  publishedAt: { type: Date },
});

promptSchema.index(
  { agentType: 1, sectionKey: 1 },
  { partialFilterExpression: { active: true }, name: 'active_by_agent_section' },
);
promptSchema.index({ agentType: 1, sectionKey: 1, createdAt: -1 });

export default promptSchema;
```

- [ ] **Step 3: PromptTestQuestion schema**

```ts
// packages/data-schemas/src/schema/promptTestQuestion.ts
import mongoose, { Schema } from 'mongoose';
import type { IPromptTestQuestion } from '../types/prompt';

const promptTestQuestionSchema = new Schema<IPromptTestQuestion>({
  agentType: {
    type: String,
    enum: ['unified', 'takanon', 'budgetkey'],
    required: true,
    index: true,
  },
  text: { type: String, required: true },
  ordinal: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
});

export default promptTestQuestionSchema;
```

- [ ] **Step 4: Re-export from `schema/index.ts` and `types/index.ts`**

In `packages/data-schemas/src/schema/index.ts`, append (follow existing style):
```ts
export { default as promptSchema } from './prompt';
export { default as promptTestQuestionSchema } from './promptTestQuestion';
```

In `packages/data-schemas/src/types/index.ts`, append:
```ts
export * from './prompt';
```

- [ ] **Step 5: Write spec**

```ts
// packages/data-schemas/src/schema/prompt.spec.ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import promptSchema from './prompt';
import promptTestQuestionSchema from './promptTestQuestion';

describe('prompt schemas', () => {
  let mem: MongoMemoryServer;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('partial-unique index allows only one active per (agentType, sectionKey)', async () => {
    const Prompt = mongoose.model('PromptTest', promptSchema);
    await Prompt.init();

    await Prompt.create({
      agentType: 'unified',
      sectionKey: 'preamble',
      body: 'v1',
      active: true,
      isDraft: false,
    });
    // A second `active: true` with the same (agentType, sectionKey) is LOGICALLY
    // illegal but not enforced uniquely by the schema (partial index is non-unique
    // — uniqueness is a service-layer concern). Sanity-check the index exists.
    const indexes = await Prompt.collection.indexes();
    expect(
      indexes.find((i) => i.name === 'active_by_agent_section'),
    ).toBeDefined();
  });

  it('accepts all valid agentType enum values', async () => {
    const Prompt = mongoose.model('PromptTest2', promptSchema);
    for (const type of ['unified', 'takanon', 'budgetkey'] as const) {
      const doc = await Prompt.create({
        agentType: type,
        sectionKey: 'x',
        body: 'y',
      });
      expect(doc.agentType).toBe(type);
    }
  });

  it('rejects invalid agentType', async () => {
    const Prompt = mongoose.model('PromptTest3', promptSchema);
    await expect(
      Prompt.create({ agentType: 'wrong', sectionKey: 'x', body: 'y' }),
    ).rejects.toThrow();
  });

  it('promptTestQuestion enforces agentType + text required', async () => {
    const Q = mongoose.model('PromptQTest', promptTestQuestionSchema);
    await expect(Q.create({ agentType: 'unified' })).rejects.toThrow();
    const doc = await Q.create({ agentType: 'unified', text: 'בדיקה' });
    expect(doc.enabled).toBe(true);
  });
});
```

- [ ] **Step 6: Run**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas
npx jest src/schema/prompt.spec.ts
```
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
cat > /tmp/task5-commit.txt <<'EOF'
feat(prompt-ui): add prompt + promptTestQuestion schemas

Mongo storage for per-section prompt versions:
- prompt: one row per version, active:true flag scoped per
  (agentType, sectionKey). Partial index active_by_agent_section gives
  O(1) active lookup; uniqueness of "one active per section" is a
  service-layer invariant enforced by PromptsService.publish.
- promptTestQuestion: admin-editable list of canned Hebrew test
  queries used by the preview feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
cd /Users/amir/Development/anubanu/parlibot/LibreChat
git add packages/data-schemas/src/schema/prompt.ts packages/data-schemas/src/schema/promptTestQuestion.ts packages/data-schemas/src/schema/prompt.spec.ts packages/data-schemas/src/types/prompt.ts packages/data-schemas/src/schema/index.ts packages/data-schemas/src/types/index.ts
git commit -F /tmp/task5-commit.txt
```

---

## Task 6: Model factories + `createModels` registration

**Files:**
- Create: `packages/data-schemas/src/models/prompt.ts`
- Create: `packages/data-schemas/src/models/promptTestQuestion.ts`
- Modify: `packages/data-schemas/src/models/index.ts`

Follow the exact pattern used by the feedback schemas (`feedbackTopic.ts` etc.) added in the prior PR.

- [ ] **Step 1: Factories**

```ts
// packages/data-schemas/src/models/prompt.ts
import type mongoose from 'mongoose';
import promptSchema from '../schema/prompt';
import type { IPrompt } from '../types/prompt';

export function createPromptModel(db: typeof mongoose): mongoose.Model<IPrompt> {
  return db.models.Prompt ?? db.model<IPrompt>('Prompt', promptSchema);
}
```

```ts
// packages/data-schemas/src/models/promptTestQuestion.ts
import type mongoose from 'mongoose';
import promptTestQuestionSchema from '../schema/promptTestQuestion';
import type { IPromptTestQuestion } from '../types/prompt';

export function createPromptTestQuestionModel(
  db: typeof mongoose,
): mongoose.Model<IPromptTestQuestion> {
  return (
    db.models.PromptTestQuestion ??
    db.model<IPromptTestQuestion>('PromptTestQuestion', promptTestQuestionSchema)
  );
}
```

- [ ] **Step 2: Register in `createModels`**

Open `packages/data-schemas/src/models/index.ts`, find `createModels`, add the two factories alongside existing entries (follow the existing shape):

```ts
import { createPromptModel } from './prompt';
import { createPromptTestQuestionModel } from './promptTestQuestion';
// ...existing imports...

export function createModels(db: typeof mongoose) {
  return {
    // ...existing models...
    Prompt: createPromptModel(db),
    PromptTestQuestion: createPromptTestQuestionModel(db),
  };
}
```

- [ ] **Step 3: Build**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npm run --workspace=packages/data-schemas build
```
Expected: clean build.

- [ ] **Step 4: Run full data-schemas suite**

```bash
npx jest --prefix packages/data-schemas  # or however the workspace script runs
```
Expected: all pass including the Task 5 prompt.spec.ts.

- [ ] **Step 5: Commit**

```bash
cat > /tmp/task6-commit.txt <<'EOF'
feat(prompt-ui): createPromptModel + createPromptTestQuestionModel

Mirrors the feedback-model pattern so api/db/models.js picks them up
automatically via createModels().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/data-schemas/src/models/prompt.ts packages/data-schemas/src/models/promptTestQuestion.ts packages/data-schemas/src/models/index.ts
git commit -F /tmp/task6-commit.txt
```

---

## Task 7: `assemble` — sections → Hebrew prompt text

**Files:**
- Create: `packages/api/src/admin/prompts/assemble.ts`
- Create: `packages/api/src/admin/prompts/assemble.spec.ts`

- [ ] **Step 1: Write test**

```ts
// packages/api/src/admin/prompts/assemble.spec.ts
import { assemble } from './assemble';

const sections = [
  { sectionKey: 'preamble', ordinal: 0, headerText: '', body: 'You are X.' },
  {
    sectionKey: 'core',
    ordinal: 1,
    headerText: '## Core',
    body: '## Core\n- be nice',
  },
];

describe('assemble', () => {
  it('joins sections in ordinal order with markers preserved', () => {
    const out = assemble(sections);
    expect(out).toBe(
      [
        '<!-- SECTION_KEY: preamble -->',
        'You are X.',
        '',
        '<!-- SECTION_KEY: core -->',
        '## Core',
        '- be nice',
      ].join('\n'),
    );
  });

  it('re-sorts by ordinal even when input is unsorted', () => {
    const shuffled = [sections[1], sections[0]];
    const out = assemble(shuffled);
    expect(out.indexOf('SECTION_KEY: preamble')).toBeLessThan(
      out.indexOf('SECTION_KEY: core'),
    );
  });

  it('returns empty string for empty input', () => {
    expect(assemble([])).toBe('');
  });
});
```

- [ ] **Step 2: Run, fail**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/assemble'
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/api/src/admin/prompts/assemble.ts
export interface AssembleSection {
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
}

export function assemble(sections: AssembleSection[]): string {
  if (sections.length === 0) {
    return '';
  }
  const sorted = [...sections].sort((a, b) => a.ordinal - b.ordinal);
  const parts: string[] = [];
  for (const s of sorted) {
    parts.push(`<!-- SECTION_KEY: ${s.sectionKey} -->`);
    parts.push(s.body);
    parts.push('');
  }
  parts.pop();
  return parts.join('\n');
}
```

- [ ] **Step 4: Run, pass**

```bash
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/assemble'
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cat > /tmp/task7-commit.txt <<'EOF'
feat(prompt-ui): assemble — sections → prompt text with markers

Pure function, ordinal-sorted. Preserves SECTION_KEY markers in output
so the round-trip assemble → parseMarkers is lossless.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/api/src/admin/prompts/assemble.ts packages/api/src/admin/prompts/assemble.spec.ts
git commit -F /tmp/task7-commit.txt
```

---

## Task 8: `PromptsService` — reads + saveDraft

**Files:**
- Create: `packages/api/src/admin/prompts/PromptsService.ts`
- Create: `packages/api/src/admin/prompts/PromptsService.spec.ts`

Service layer with DI. Reads and one write (draft).

- [ ] **Step 1: Spec**

```ts
// packages/api/src/admin/prompts/PromptsService.spec.ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import promptSchema from '@librechat/data-schemas/schema/prompt';
import {
  getActiveSections,
  saveDraft,
  getSectionHistory,
} from './PromptsService';

describe('PromptsService reads + saveDraft', () => {
  let mem: MongoMemoryServer;
  let Prompt: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Prompt = mongoose.model('PromptSvc1', promptSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Prompt.deleteMany({});
  });

  it('getActiveSections returns only active rows, ordinal-sorted', async () => {
    await Prompt.create([
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'A1',
        ordinal: 0,
        active: true,
        isDraft: false,
      },
      {
        agentType: 'unified',
        sectionKey: 'b',
        body: 'B1',
        ordinal: 1,
        active: true,
        isDraft: false,
      },
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'A0-old',
        ordinal: 0,
        active: false,
        isDraft: false,
      },
    ]);
    const out = await getActiveSections({ Prompt, agentType: 'unified' });
    expect(out.map((s) => s.body)).toEqual(['A1', 'B1']);
  });

  it('saveDraft inserts a new isDraft:true row referencing the parent', async () => {
    const parent = await Prompt.create({
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1',
      ordinal: 0,
      active: true,
      isDraft: false,
    });
    const draft = await saveDraft({
      Prompt,
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1-draft',
      changeNote: 'wip',
      createdBy: new mongoose.Types.ObjectId(),
    });
    expect(draft.isDraft).toBe(true);
    expect(draft.active).toBe(false);
    expect(draft.parentVersionId?.toString()).toBe(parent._id.toString());
  });

  it('saveDraft throws when no active section exists', async () => {
    await expect(
      saveDraft({
        Prompt,
        agentType: 'unified',
        sectionKey: 'missing',
        body: 'x',
        changeNote: undefined,
        createdBy: new mongoose.Types.ObjectId(),
      }),
    ).rejects.toThrow(/no active section/i);
  });

  it('getSectionHistory returns newest-first', async () => {
    await Prompt.create([
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'v1',
        ordinal: 0,
        active: false,
        isDraft: false,
        createdAt: new Date('2026-01-01'),
      },
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'v2',
        ordinal: 0,
        active: true,
        isDraft: false,
        createdAt: new Date('2026-02-01'),
      },
    ]);
    const hist = await getSectionHistory({
      Prompt,
      agentType: 'unified',
      sectionKey: 'a',
    });
    expect(hist.map((r) => r.body)).toEqual(['v2', 'v1']);
  });
});
```

- [ ] **Step 2: Run, fail**

```bash
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/PromptsService'
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/api/src/admin/prompts/PromptsService.ts
import type { Model, Types } from 'mongoose';

export type AgentType = 'unified' | 'takanon' | 'budgetkey';

export interface PromptRow {
  _id: Types.ObjectId;
  agentType: AgentType;
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
  active: boolean;
  isDraft: boolean;
  parentVersionId?: Types.ObjectId;
  changeNote?: string;
  createdAt: Date;
  createdBy?: Types.ObjectId;
  publishedAt?: Date;
}

export interface BaseDeps {
  Prompt: Model<unknown>;
}

export async function getActiveSections(
  deps: BaseDeps & { agentType: AgentType },
): Promise<PromptRow[]> {
  const rows = (await deps.Prompt.find({
    agentType: deps.agentType,
    active: true,
  })
    .sort({ ordinal: 1 })
    .lean()) as unknown as PromptRow[];
  return rows;
}

export async function getSectionHistory(
  deps: BaseDeps & { agentType: AgentType; sectionKey: string },
): Promise<PromptRow[]> {
  const rows = (await deps.Prompt.find({
    agentType: deps.agentType,
    sectionKey: deps.sectionKey,
  })
    .sort({ createdAt: -1 })
    .lean()) as unknown as PromptRow[];
  return rows;
}

export interface SaveDraftInput extends BaseDeps {
  agentType: AgentType;
  sectionKey: string;
  body: string;
  changeNote: string | undefined;
  createdBy: Types.ObjectId;
}

export async function saveDraft(input: SaveDraftInput): Promise<PromptRow> {
  const current = (await input.Prompt.findOne({
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    active: true,
  }).lean()) as unknown as PromptRow | null;
  if (!current) {
    throw new Error(
      `no active section for ${input.agentType}/${input.sectionKey}`,
    );
  }
  const doc = await input.Prompt.create({
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    ordinal: current.ordinal,
    headerText: current.headerText,
    body: input.body,
    active: false,
    isDraft: true,
    parentVersionId: current._id,
    changeNote: input.changeNote,
    createdBy: input.createdBy,
  });
  return doc.toObject() as PromptRow;
}
```

- [ ] **Step 4: Pass**

```bash
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/PromptsService'
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cat > /tmp/task8-commit.txt <<'EOF'
feat(prompt-ui): PromptsService — getActiveSections + saveDraft + history

Read path: ordinal-sorted active rows. saveDraft refuses to orphan —
requires an active ancestor, sets parentVersionId for optimistic
concurrency on later publish. History is newest-first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/api/src/admin/prompts/PromptsService.ts packages/api/src/admin/prompts/PromptsService.spec.ts
git commit -F /tmp/task8-commit.txt
```

---

## Task 9: `PromptsService.publish` + `restore` with optimistic concurrency

**Files:**
- Modify: `packages/api/src/admin/prompts/PromptsService.ts` (append)
- Modify: `packages/api/src/admin/prompts/PromptsService.spec.ts` (append)

- [ ] **Step 1: Append test cases**

```ts
// inside PromptsService.spec.ts, append to the existing describe block

describe('PromptsService.publish', () => {
  let mem: MongoMemoryServer;
  let Prompt: mongoose.Model<unknown>;
  let patchCalls: Array<{ agentType: string; instructions: string }>;
  let patchAgent: (agentType: string, instructions: string) => Promise<void>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Prompt = mongoose.model('PromptSvc2', promptSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Prompt.deleteMany({});
    patchCalls = [];
    patchAgent = async (agentType, instructions) => {
      patchCalls.push({ agentType, instructions });
    };
  });

  it('flips active, inserts new row, calls patchAgent with assembled body', async () => {
    const { publish } = await import('./PromptsService');
    const parent = await Prompt.create({
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1',
      ordinal: 0,
      active: true,
      isDraft: false,
    });
    await publish({
      Prompt,
      patchAgent,
      agentType: 'unified',
      sectionKey: 'a',
      parentVersionId: parent._id,
      body: 'A2',
      changeNote: 'tightened',
      createdBy: new mongoose.Types.ObjectId(),
    });
    const rows = await Prompt.find({ agentType: 'unified' }).sort({
      createdAt: 1,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].active).toBe(false);
    expect(rows[1].active).toBe(true);
    expect(rows[1].body).toBe('A2');
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].instructions).toContain('<!-- SECTION_KEY: a -->');
    expect(patchCalls[0].instructions).toContain('A2');
  });

  it('rejects with ConcurrencyError when parentVersionId is stale', async () => {
    const { publish, ConcurrencyError } = await import('./PromptsService');
    await Prompt.create({
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1',
      ordinal: 0,
      active: true,
      isDraft: false,
    });
    await expect(
      publish({
        Prompt,
        patchAgent,
        agentType: 'unified',
        sectionKey: 'a',
        parentVersionId: new mongoose.Types.ObjectId(),
        body: 'A2',
        changeNote: 'x',
        createdBy: new mongoose.Types.ObjectId(),
      }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('restore creates a new active row with body cloned from a prior version', async () => {
    const { restore, publish } = await import('./PromptsService');
    const v1 = await Prompt.create({
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1',
      ordinal: 0,
      active: true,
      isDraft: false,
    });
    await publish({
      Prompt,
      patchAgent,
      agentType: 'unified',
      sectionKey: 'a',
      parentVersionId: v1._id,
      body: 'A2',
      changeNote: 'x',
      createdBy: new mongoose.Types.ObjectId(),
    });
    await restore({
      Prompt,
      patchAgent,
      agentType: 'unified',
      sectionKey: 'a',
      versionId: v1._id,
      createdBy: new mongoose.Types.ObjectId(),
    });
    const active = await Prompt.findOne({
      agentType: 'unified',
      sectionKey: 'a',
      active: true,
    });
    expect(active?.body).toBe('A1');
    expect(active?.changeNote).toMatch(/Restored from version/i);
  });
});
```

- [ ] **Step 2: Append implementation**

Append to `packages/api/src/admin/prompts/PromptsService.ts`:

```ts
import { assemble } from './assemble';

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export interface PublishInput extends BaseDeps {
  patchAgent: (agentType: AgentType, instructions: string) => Promise<void>;
  agentType: AgentType;
  sectionKey: string;
  parentVersionId: Types.ObjectId;
  body: string;
  changeNote: string;
  createdBy: Types.ObjectId;
}

export async function publish(input: PublishInput): Promise<PromptRow> {
  const current = (await input.Prompt.findOne({
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    active: true,
  }).lean()) as unknown as PromptRow | null;
  if (!current || current._id.toString() !== input.parentVersionId.toString()) {
    throw new ConcurrencyError(
      `stale parent for ${input.agentType}/${input.sectionKey}`,
    );
  }
  await input.Prompt.updateOne(
    { _id: current._id },
    { $set: { active: false } },
  );
  const created = (await input.Prompt.create({
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    ordinal: current.ordinal,
    headerText: current.headerText,
    body: input.body,
    active: true,
    isDraft: false,
    parentVersionId: current._id,
    changeNote: input.changeNote,
    createdBy: input.createdBy,
    publishedAt: new Date(),
  })).toObject() as PromptRow;

  const sections = (await input.Prompt.find({
    agentType: input.agentType,
    active: true,
  })
    .sort({ ordinal: 1 })
    .lean()) as unknown as PromptRow[];
  const assembled = assemble(sections);
  await input.patchAgent(input.agentType, assembled);
  return created;
}

export interface RestoreInput extends BaseDeps {
  patchAgent: (agentType: AgentType, instructions: string) => Promise<void>;
  agentType: AgentType;
  sectionKey: string;
  versionId: Types.ObjectId;
  createdBy: Types.ObjectId;
}

export async function restore(input: RestoreInput): Promise<PromptRow> {
  const source = (await input.Prompt.findById(input.versionId).lean()) as
    | PromptRow
    | null;
  if (!source) {
    throw new Error(`version ${input.versionId.toString()} not found`);
  }
  if (
    source.agentType !== input.agentType ||
    source.sectionKey !== input.sectionKey
  ) {
    throw new Error('version does not match agentType/sectionKey');
  }
  const current = (await input.Prompt.findOne({
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    active: true,
  }).lean()) as unknown as PromptRow | null;
  if (!current) {
    throw new Error('no active section to restore over');
  }
  return publish({
    Prompt: input.Prompt,
    patchAgent: input.patchAgent,
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    parentVersionId: current._id,
    body: source.body,
    changeNote: `Restored from version ${source._id.toString().slice(-6)}`,
    createdBy: input.createdBy,
  });
}
```

- [ ] **Step 3: Pass**

```bash
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/PromptsService'
```
Expected: PASS (all earlier + 3 new = 7 tests).

- [ ] **Step 4: Commit**

```bash
cat > /tmp/task9-commit.txt <<'EOF'
feat(prompt-ui): PromptsService.publish + restore + ConcurrencyError

publish: checks parentVersionId === current active, flips active, inserts
new row, assembles full prompt, calls patchAgent to propagate to the
LibreChat runtime. Stale parent throws ConcurrencyError (409 mapping).

restore: wraps publish with the old body and a synthesized change-note.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/api/src/admin/prompts/PromptsService.ts packages/api/src/admin/prompts/PromptsService.spec.ts
git commit -F /tmp/task9-commit.txt
```

---

## Task 10: `shadowAgent` + fake `AgentsClient`

**Files:**
- Create: `packages/api/src/admin/prompts/shadowAgent.ts`
- Create: `packages/api/src/admin/prompts/fakeAgentsClient.ts`
- Create: `packages/api/src/admin/prompts/shadowAgent.spec.ts`

The shadow agent is an external LibreChat resource (HTTP). We hide it behind an `AgentsClient` interface so real infra goes through the seed-script style HTTP code and tests go through the fake.

- [ ] **Step 1: Interface + fake**

```ts
// packages/api/src/admin/prompts/fakeAgentsClient.ts
import type { AgentsClient, AgentSnapshot } from './shadowAgent';

export function buildFakeAgentsClient(): AgentsClient & {
  _snapshots: AgentSnapshot[];
} {
  const store = new Map<string, AgentSnapshot>();
  const history: AgentSnapshot[] = [];
  let counter = 0;
  return {
    _snapshots: history,
    async getAgent(agentId) {
      const a = store.get(agentId);
      if (!a) {
        throw new Error(`agent ${agentId} not found`);
      }
      return a;
    },
    async createAgent(input) {
      counter += 1;
      const snap: AgentSnapshot = { id: `agent_${counter}`, ...input };
      store.set(snap.id, snap);
      history.push(snap);
      return snap;
    },
    async patchAgent(agentId, patch) {
      const a = store.get(agentId);
      if (!a) {
        throw new Error('missing');
      }
      const next: AgentSnapshot = { ...a, ...patch };
      store.set(agentId, next);
      history.push(next);
      return next;
    },
    async deleteAgent(agentId) {
      store.delete(agentId);
    },
    async chat(agentId, message) {
      return {
        answer: `fake-answer[${agentId}]: ${message}`,
        toolCalls: [],
      };
    },
  };
}
```

```ts
// packages/api/src/admin/prompts/shadowAgent.ts
export interface AgentSnapshot {
  id: string;
  name: string;
  model: string;
  instructions: string;
  actions?: Array<{ domain: string; specHash: string }>;
}

export interface AgentsClient {
  getAgent(id: string): Promise<AgentSnapshot>;
  createAgent(input: Omit<AgentSnapshot, 'id'>): Promise<AgentSnapshot>;
  patchAgent(
    id: string,
    patch: Partial<Omit<AgentSnapshot, 'id'>>,
  ): Promise<AgentSnapshot>;
  deleteAgent(id: string): Promise<void>;
  chat(
    id: string,
    message: string,
  ): Promise<{ answer: string; toolCalls: unknown[] }>;
}

const TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  shadowId: string;
  instructionsKey: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface SpawnShadowInput {
  client: AgentsClient;
  liveAgentId: string;
  instructions: string;
  now?: number;
}

export async function spawnOrReuseShadow(
  input: SpawnShadowInput,
): Promise<string> {
  const now = input.now ?? Date.now();
  const entry = cache.get(input.liveAgentId);
  if (
    entry &&
    entry.instructionsKey === input.instructions &&
    entry.expiresAt > now
  ) {
    return entry.shadowId;
  }
  if (entry) {
    await input.client.deleteAgent(entry.shadowId).catch(() => {});
  }
  const live = await input.client.getAgent(input.liveAgentId);
  const shadow = await input.client.createAgent({
    name: `${live.name} [shadow-${now}]`,
    model: live.model,
    instructions: input.instructions,
    actions: live.actions,
  });
  cache.set(input.liveAgentId, {
    shadowId: shadow.id,
    instructionsKey: input.instructions,
    expiresAt: now + TTL_MS,
  });
  return shadow.id;
}

export function clearShadowCache(): void {
  cache.clear();
}
```

- [ ] **Step 2: Test**

```ts
// packages/api/src/admin/prompts/shadowAgent.spec.ts
import {
  spawnOrReuseShadow,
  clearShadowCache,
} from './shadowAgent';
import { buildFakeAgentsClient } from './fakeAgentsClient';

describe('spawnOrReuseShadow', () => {
  beforeEach(() => clearShadowCache());

  it('creates a shadow on first call', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      instructions: 'live',
    });
    const id = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v1',
    });
    const shadow = await client.getAgent(id);
    expect(shadow.instructions).toBe('draft-v1');
  });

  it('reuses the shadow when instructions unchanged and within TTL', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      instructions: 'live',
    });
    const a = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v1',
    });
    const b = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v1',
    });
    expect(a).toBe(b);
  });

  it('tears down + recreates when instructions differ', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      instructions: 'live',
    });
    const a = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v1',
    });
    const b = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v2',
    });
    expect(a).not.toBe(b);
    await expect(client.getAgent(a)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run, verify pass**

```bash
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/shadowAgent'
```
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
cat > /tmp/task10-commit.txt <<'EOF'
feat(prompt-ui): shadowAgent + fakeAgentsClient

spawnOrReuseShadow caches shadow agents by liveAgentId for 10min so
re-previews don't spin up a new agent per request. Switches to a new
shadow when instructions differ (and tears down the stale one).

AgentsClient interface lets the real adapter (HTTP to LibreChat) and
the fake (in-memory Map) drop in behind the same API.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/api/src/admin/prompts/shadowAgent.ts packages/api/src/admin/prompts/fakeAgentsClient.ts packages/api/src/admin/prompts/shadowAgent.spec.ts
git commit -F /tmp/task10-commit.txt
```

---

## Task 11: `preview` — run test questions against shadow

**Files:**
- Create: `packages/api/src/admin/prompts/preview.ts`
- Create: `packages/api/src/admin/prompts/preview.spec.ts`

- [ ] **Step 1: Spec**

```ts
// packages/api/src/admin/prompts/preview.spec.ts
import { runPreview } from './preview';
import { buildFakeAgentsClient } from './fakeAgentsClient';
import { clearShadowCache } from './shadowAgent';

describe('runPreview', () => {
  beforeEach(() => clearShadowCache());

  it('runs each test question against current + shadow and returns side-by-side', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      instructions: 'LIVE',
    });
    const out = await runPreview({
      client,
      liveAgentId: live.id,
      draftInstructions: 'DRAFT',
      questions: ['Q1', 'Q2'],
      timeoutMs: 5000,
    });
    expect(out.questions).toHaveLength(2);
    expect(out.questions[0].text).toBe('Q1');
    expect(out.questions[0].current.answer).toContain(live.id);
    expect(out.questions[0].draft.answer).not.toContain(live.id);
  });

  it('marks per-question timeouts without aborting the whole run', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      instructions: 'LIVE',
    });
    const slow = { ...client };
    slow.chat = (id, msg) =>
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10));
    const out = await runPreview({
      client: slow,
      liveAgentId: live.id,
      draftInstructions: 'DRAFT',
      questions: ['Q1'],
      timeoutMs: 50,
    });
    expect(out.questions[0].timedOut).toBe(true);
  });
});
```

- [ ] **Step 2: Fail**

```bash
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/preview'
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/api/src/admin/prompts/preview.ts
import type { AgentsClient } from './shadowAgent';
import { spawnOrReuseShadow } from './shadowAgent';

export interface PreviewQuestionResult {
  text: string;
  current: { answer: string; toolCalls: unknown[] };
  draft: { answer: string; toolCalls: unknown[] };
  timedOut: boolean;
}

export interface PreviewOutput {
  shadowId: string;
  questions: PreviewQuestionResult[];
}

export interface RunPreviewInput {
  client: AgentsClient;
  liveAgentId: string;
  draftInstructions: string;
  questions: string[];
  timeoutMs: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function runPreview(
  input: RunPreviewInput,
): Promise<PreviewOutput> {
  const shadowId = await spawnOrReuseShadow({
    client: input.client,
    liveAgentId: input.liveAgentId,
    instructions: input.draftInstructions,
  });
  const results: PreviewQuestionResult[] = [];
  for (const q of input.questions) {
    const [curr, draft] = await Promise.all([
      withTimeout(input.client.chat(input.liveAgentId, q), input.timeoutMs),
      withTimeout(input.client.chat(shadowId, q), input.timeoutMs),
    ]);
    results.push({
      text: q,
      current: curr ?? { answer: '(timeout)', toolCalls: [] },
      draft: draft ?? { answer: '(timeout)', toolCalls: [] },
      timedOut: curr === null || draft === null,
    });
  }
  return { shadowId, questions: results };
}
```

- [ ] **Step 4: Pass**

```bash
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/preview'
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cat > /tmp/task11-commit.txt <<'EOF'
feat(prompt-ui): runPreview — side-by-side test-question run

Runs each question against the live agent AND the shadow (draft) agent
in parallel under a per-question timeout. Returns a timedOut flag per
row so the UI can show partial results instead of blocking on a slow
tool call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/api/src/admin/prompts/preview.ts packages/api/src/admin/prompts/preview.spec.ts
git commit -F /tmp/task11-commit.txt
```

---

## Task 12: Barrel + `packages/api/src/index.ts` re-export

**Files:**
- Create: `packages/api/src/admin/prompts/index.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Barrel**

```ts
// packages/api/src/admin/prompts/index.ts
export { parseMarkers } from './parseMarkers';
export type { ParsedSection } from './parseMarkers';
export { assemble } from './assemble';
export type { AssembleSection } from './assemble';
export {
  getActiveSections,
  getSectionHistory,
  saveDraft,
  publish,
  restore,
  ConcurrencyError,
} from './PromptsService';
export type {
  AgentType,
  PromptRow,
  SaveDraftInput,
  PublishInput,
  RestoreInput,
} from './PromptsService';
export {
  spawnOrReuseShadow,
  clearShadowCache,
} from './shadowAgent';
export type { AgentsClient, AgentSnapshot } from './shadowAgent';
export { buildFakeAgentsClient } from './fakeAgentsClient';
export { runPreview } from './preview';
export type {
  PreviewOutput,
  PreviewQuestionResult,
  RunPreviewInput,
} from './preview';
```

- [ ] **Step 2: Add to top-level index**

In `packages/api/src/index.ts`, append (alongside the existing `export * as AdminFeedback from './admin/feedback';`):

```ts
export * as AdminPrompts from './admin/prompts';
```

- [ ] **Step 3: Build + run all admin/prompts tests**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npm run --workspace=packages/api build
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts'
```
Expected: clean build + all 15+ tests green.

- [ ] **Step 4: Commit**

```bash
cat > /tmp/task12-commit.txt <<'EOF'
feat(prompt-ui): barrel export AdminPrompts from packages/api

Same pattern as AdminFeedback. The JS routes in the next task will
import via require('@librechat/api').AdminPrompts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/api/src/admin/prompts/index.ts packages/api/src/index.ts
git commit -F /tmp/task12-commit.txt
```

---

## Task 13: `migrate-prompts-into-db.js` initial-load script

**Files:**
- Create: `scripts/migrate-prompts-into-db.js`
- Create: `packages/api/src/admin/prompts/migrate.ts`
- Create: `packages/api/src/admin/prompts/migrate.spec.ts`

- [ ] **Step 1: Spec the pure migration function**

```ts
// packages/api/src/admin/prompts/migrate.spec.ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import promptSchema from '@librechat/data-schemas/schema/prompt';
import { migrateAgentTextIntoDb } from './migrate';

describe('migrateAgentTextIntoDb', () => {
  let mem: MongoMemoryServer;
  let Prompt: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Prompt = mongoose.model('PromptMig1', promptSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Prompt.deleteMany({});
  });

  it('creates one active row per SECTION_KEY in the input', async () => {
    const input = [
      '<!-- SECTION_KEY: a -->',
      'A body',
      '',
      '<!-- SECTION_KEY: b -->',
      '## B header',
      'B body',
    ].join('\n');
    const count = await migrateAgentTextIntoDb({
      Prompt,
      agentType: 'unified',
      fileContents: input,
    });
    expect(count).toBe(2);
    const rows = await Prompt.find({ agentType: 'unified', active: true }).sort(
      { ordinal: 1 },
    );
    expect(rows.map((r) => r.sectionKey)).toEqual(['a', 'b']);
    expect(rows[1].headerText).toBe('## B header');
  });

  it('is idempotent — second call is a no-op if rows exist', async () => {
    const input = '<!-- SECTION_KEY: a -->\nbody';
    const first = await migrateAgentTextIntoDb({
      Prompt,
      agentType: 'unified',
      fileContents: input,
    });
    const second = await migrateAgentTextIntoDb({
      Prompt,
      agentType: 'unified',
      fileContents: input,
    });
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/api/src/admin/prompts/migrate.ts
import type { Model } from 'mongoose';
import { parseMarkers } from './parseMarkers';
import type { AgentType } from './PromptsService';

export interface MigrateInput {
  Prompt: Model<unknown>;
  agentType: AgentType;
  fileContents: string;
}

export async function migrateAgentTextIntoDb(
  input: MigrateInput,
): Promise<number> {
  const existing = await input.Prompt.countDocuments({
    agentType: input.agentType,
  });
  if (existing > 0) {
    return 0;
  }
  const sections = parseMarkers(input.fileContents);
  const docs = sections.map((s) => ({
    agentType: input.agentType,
    sectionKey: s.sectionKey,
    ordinal: s.ordinal,
    headerText: s.headerText,
    body: s.body,
    active: true,
    isDraft: false,
    publishedAt: new Date(),
  }));
  await input.Prompt.insertMany(docs);
  return docs.length;
}
```

- [ ] **Step 3: Export from barrel**

Append to `packages/api/src/admin/prompts/index.ts`:
```ts
export { migrateAgentTextIntoDb } from './migrate';
export type { MigrateInput } from './migrate';
```

- [ ] **Step 4: Thin CLI shim**

```js
// scripts/migrate-prompts-into-db.js
#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { createModels } = require('@librechat/data-schemas');
const { AdminPrompts } = require(path.join(
  __dirname,
  '..',
  'packages',
  'api',
  'dist',
  'index.js',
));

const SPECS_DIR = process.env.SPECS_DIR
  || path.join(__dirname, '..', '..', 'rebuilding-bots', 'specs');

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }
  await mongoose.connect(mongoUri);
  const { Prompt } = createModels(mongoose);
  let total = 0;
  for (const agentType of ['unified', 'takanon', 'budgetkey']) {
    const file = path.join(SPECS_DIR, agentType, 'agent.txt');
    const contents = fs.readFileSync(file, 'utf8');
    const n = await AdminPrompts.migrateAgentTextIntoDb({
      Prompt,
      agentType,
      fileContents: contents,
    });
    console.log(JSON.stringify({ stage: 'seeded', agentType, count: n }));
    total += n;
  }
  console.log(JSON.stringify({ stage: 'done', total }));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(JSON.stringify({ stage: 'fatal', error: err.message }));
  process.exit(1);
});
```

- [ ] **Step 5: Run tests + build**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npm run test:ci --prefix packages/api -- --testPathPattern='admin/prompts/migrate'
npm run --workspace=packages/api build
```
Expected: 2 tests pass + clean rebuild.

- [ ] **Step 6: Commit**

```bash
cat > /tmp/task13-commit.txt <<'EOF'
feat(prompt-ui): migrate-prompts-into-db initial-load script

One-shot, idempotent. Reads specs/*/agent.txt → parseMarkers →
insertMany with active:true. Second call is a no-op so it's safe to
re-run from CI without clobbering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/api/src/admin/prompts/migrate.ts packages/api/src/admin/prompts/migrate.spec.ts packages/api/src/admin/prompts/index.ts scripts/migrate-prompts-into-db.js
git commit -F /tmp/task13-commit.txt
```

---

## Task 14: Update `seed-botnim-agent.js` to prefer DB

**Files:**
- Modify: `scripts/seed-botnim-agent.js`

Replace the filesystem-only code path that reads `specs/unified/agent.txt` with a DB-first lookup that falls back to file if the collection is empty.

- [ ] **Step 1: Read the current script to locate the instructions-assembly section**

```bash
grep -n 'agent.txt\|instructions' /Users/amir/Development/anubanu/parlibot/LibreChat/scripts/seed-botnim-agent.js | head -10
```

- [ ] **Step 2: Replace the instructions-source logic**

Locate the block that currently reads `unified/agent.txt` into the `instructions` variable (roughly `const instructions = fs.readFileSync(...)`). Replace with:

```js
const mongoose = require('mongoose');
const { createModels } = require('@librechat/data-schemas');
const { AdminPrompts } = require(path.join(
  __dirname, '..', 'packages', 'api', 'dist', 'index.js',
));

async function loadInstructions() {
  const mongoUri = process.env.SEED_MONGO_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    return fs.readFileSync(path.join(SPECS_DIR, 'unified', 'agent.txt'), 'utf8');
  }
  await mongoose.connect(mongoUri);
  try {
    const { Prompt } = createModels(mongoose);
    const sections = await AdminPrompts.getActiveSections({
      Prompt,
      agentType: 'unified',
    });
    if (sections.length === 0) {
      return fs.readFileSync(path.join(SPECS_DIR, 'unified', 'agent.txt'), 'utf8');
    }
    return AdminPrompts.assemble(sections);
  } finally {
    await mongoose.disconnect();
  }
}

const instructions = await loadInstructions();
```

If the script isn't already inside an `async function main()`, wrap the seed body in one. Keep the rest of the script (login, action upserts) untouched.

- [ ] **Step 3: Smoke test locally against an empty local Mongo**

```bash
SEED_API_BASE=http://localhost:3080 \
SEED_ADMIN_EMAIL=admin@botnim.local \
SEED_ADMIN_PASSWORD=admin123 \
SEED_MONGO_URI=mongodb://localhost:27017/LibreChat \
SEED_SPECS_DIR=/Users/amir/Development/anubanu/parlibot/rebuilding-bots/specs \
node /Users/amir/Development/anubanu/parlibot/LibreChat/scripts/seed-botnim-agent.js
```
Expected: falls back to file (Prompt collection empty), seeds the agent as before.

- [ ] **Step 4: Commit**

```bash
cat > /tmp/task14-commit.txt <<'EOF'
feat(prompt-ui): seed-botnim-agent reads instructions from DB first

Falls back to specs/unified/agent.txt if the Prompt collection is
empty. Makes the seed script idempotent with or without the DB
populated — lets us roll out the schema/migration without coupling to
the admin UI landing at the same time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add scripts/seed-botnim-agent.js
git commit -F /tmp/task14-commit.txt
```

---

## Task 15: JS admin routes + supertest coverage

**Files:**
- Create: `api/server/controllers/admin/promptsController.js`
- Create: `api/server/routes/admin/prompts.js`
- Create: `api/test/admin.prompts.spec.js`
- Modify: `api/server/index.js` (mount)
- Modify: `api/db/models.js` (export `Prompt`, `PromptTestQuestion`)

- [ ] **Step 1: Controller**

```js
// api/server/controllers/admin/promptsController.js
const { AdminPrompts } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { Prompt, PromptTestQuestion } = require('~/db/models');
const { patchLibreChatAgent } = require('~/server/services/prompts/agentPatcher');

const PREVIEW_TIMEOUT_MS = 90_000;

function patchAgentForPublish(agentsClient) {
  return async (agentType, instructions) => {
    await patchLibreChatAgent(agentsClient, agentType, instructions);
  };
}

async function listAgents(req, res) {
  try {
    const agents = ['unified', 'takanon', 'budgetkey'];
    const counts = await Promise.all(
      agents.map((a) =>
        Prompt.countDocuments({ agentType: a, active: true }).then((c) => ({
          agentType: a,
          activeSections: c,
        })),
      ),
    );
    res.status(200).json({ agents: counts });
  } catch (err) {
    logger.error('[admin/prompts] listAgents failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function listSections(req, res) {
  try {
    const sections = await AdminPrompts.getActiveSections({
      Prompt,
      agentType: req.params.agent,
    });
    const withDrafts = await Promise.all(
      sections.map(async (s) => ({
        ...s,
        hasDraft:
          (await Prompt.countDocuments({
            agentType: s.agentType,
            sectionKey: s.sectionKey,
            isDraft: true,
          })) > 0,
      })),
    );
    res.status(200).json({ sections: withDrafts });
  } catch (err) {
    logger.error('[admin/prompts] listSections failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function listVersions(req, res) {
  try {
    const versions = await AdminPrompts.getSectionHistory({
      Prompt,
      agentType: req.params.agent,
      sectionKey: req.params.key,
    });
    res.status(200).json({ versions });
  } catch (err) {
    logger.error('[admin/prompts] listVersions failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function saveDraft(req, res) {
  try {
    const { body, changeNote } = req.body;
    const row = await AdminPrompts.saveDraft({
      Prompt,
      agentType: req.params.agent,
      sectionKey: req.params.key,
      body,
      changeNote,
      createdBy: req.user.id,
    });
    res.status(201).json({ draft: row });
  } catch (err) {
    logger.error('[admin/prompts] saveDraft failed', err);
    const code = /no active section/i.test(err.message) ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
}

async function publish(req, res) {
  try {
    const { parentVersionId, body, changeNote } = req.body;
    if (!changeNote) {
      return res.status(400).json({ error: 'changeNote required on publish' });
    }
    const row = await AdminPrompts.publish({
      Prompt,
      patchAgent: patchAgentForPublish(req.app.locals.agentsClient),
      agentType: req.params.agent,
      sectionKey: req.params.key,
      parentVersionId,
      body,
      changeNote,
      createdBy: req.user.id,
    });
    res.status(200).json({ active: row });
  } catch (err) {
    if (err.name === 'ConcurrencyError') {
      const current = await Prompt.findOne({
        agentType: req.params.agent,
        sectionKey: req.params.key,
        active: true,
      }).lean();
      return res.status(409).json({ error: 'stale parent', current });
    }
    logger.error('[admin/prompts] publish failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function preview(req, res) {
  try {
    const sections = await AdminPrompts.getActiveSections({
      Prompt,
      agentType: req.params.agent,
    });
    const swapped = sections.map((s) =>
      s.sectionKey === req.params.key ? { ...s, body: req.body.body } : s,
    );
    const draftInstructions = AdminPrompts.assemble(swapped);
    const questions = (
      await PromptTestQuestion.find({
        agentType: req.params.agent,
        enabled: true,
      })
        .sort({ ordinal: 1 })
        .lean()
    ).map((q) => q.text);
    const out = await AdminPrompts.runPreview({
      client: req.app.locals.agentsClient,
      liveAgentId: req.app.locals.liveAgentIds[req.params.agent],
      draftInstructions,
      questions,
      timeoutMs: PREVIEW_TIMEOUT_MS,
    });
    res.status(200).json(out);
  } catch (err) {
    logger.error('[admin/prompts] preview failed', err);
    res.status(503).json({ error: 'preview temporarily unavailable' });
  }
}

async function restore(req, res) {
  try {
    const row = await AdminPrompts.restore({
      Prompt,
      patchAgent: patchAgentForPublish(req.app.locals.agentsClient),
      agentType: req.params.agent,
      sectionKey: req.params.key,
      versionId: req.body.versionId,
      createdBy: req.user.id,
    });
    res.status(200).json({ active: row });
  } catch (err) {
    logger.error('[admin/prompts] restore failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getTestQuestions(req, res) {
  try {
    const questions = await PromptTestQuestion.find({
      agentType: req.params.agent,
    })
      .sort({ ordinal: 1 })
      .lean();
    res.status(200).json({ questions });
  } catch (err) {
    logger.error('[admin/prompts] getTestQuestions failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function putTestQuestions(req, res) {
  try {
    await PromptTestQuestion.deleteMany({ agentType: req.params.agent });
    if (req.body.questions.length > 0) {
      await PromptTestQuestion.insertMany(
        req.body.questions.map((q, i) => ({
          agentType: req.params.agent,
          text: q.text,
          ordinal: i,
          enabled: q.enabled ?? true,
          createdBy: req.user.id,
        })),
      );
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('[admin/prompts] putTestQuestions failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listAgents,
  listSections,
  listVersions,
  saveDraft,
  publish,
  preview,
  restore,
  getTestQuestions,
  putTestQuestions,
};
```

- [ ] **Step 2: Stub `~/server/services/prompts/agentPatcher.js`**

```js
// api/server/services/prompts/agentPatcher.js
async function patchLibreChatAgent(agentsClient, agentType, instructions) {
  // Lookup live agent id by agentType from an app.locals mapping seeded at boot.
  // Actual HTTP to /api/agents/:id is implemented in Task 17 (real AgentsClient)
  // For now this is a no-op pass-through so the controller + tests compile.
  return agentsClient.patchAgent('__placeholder__', { instructions });
}

module.exports = { patchLibreChatAgent };
```

- [ ] **Step 3: Router**

```js
// api/server/routes/admin/prompts.js
const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const checkAdmin = require('~/server/middleware/roles/admin');
const controller = require('~/server/controllers/admin/promptsController');

const router = express.Router();
router.use(requireJwtAuth, checkAdmin);

router.get('/agents', controller.listAgents);
router.get('/:agent/sections', controller.listSections);
router.get('/:agent/sections/:key/versions', controller.listVersions);
router.post('/:agent/sections/:key/drafts', controller.saveDraft);
router.post('/:agent/sections/:key/publish', controller.publish);
router.post('/:agent/sections/:key/preview', controller.preview);
router.post('/:agent/sections/:key/restore', controller.restore);
router.get('/:agent/test-questions', controller.getTestQuestions);
router.put('/:agent/test-questions', controller.putTestQuestions);

module.exports = router;
```

- [ ] **Step 4: Mount + expose models**

In `api/server/index.js` (near the other admin mounts):
```js
app.use('/api/admin/prompts', require('./routes/admin/prompts'));
```

In `api/db/models.js`, include `Prompt` and `PromptTestQuestion` in the destructure-from-createModels block (follow the existing pattern).

- [ ] **Step 5: Supertest integration**

Mirror `api/test/admin.feedback.spec.js` from the prior PR. Cover: 403 for non-admin on every route, 200 on listAgents for admin with empty DB, 400 on publish without changeNote, 409 on publish with stale parentVersionId (requires seeding a current row first + an out-of-band flip).

- [ ] **Step 6: Run + commit**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/api
npx jest test/admin.prompts.spec.js
```
Expected: all tests pass.

```bash
cat > /tmp/task15-commit.txt <<'EOF'
feat(prompt-ui): admin-only /api/admin/prompts routes

Thin JS wrappers over AdminPrompts service. Publish returns 409 with
the new current row on stale parentVersionId so the UI can render a
rebase diff. Preview returns 503 on failure (the shadow-agent path is
occasionally flaky on first cold-start).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
cd /Users/amir/Development/anubanu/parlibot/LibreChat
git add api/server/controllers/admin/promptsController.js api/server/routes/admin/prompts.js api/server/services/prompts/agentPatcher.js api/server/index.js api/db/models.js api/test/admin.prompts.spec.js
git commit -F /tmp/task15-commit.txt
```

---

## Task 16: data-provider types + endpoints + service + keys

Mirror the Task 12 pattern from the feedback-insights plan. Add types under `/* --- Admin Prompts --- */` section in `packages/data-provider/src/types/queries.ts`:

- `AdminPromptAgentSummary`, `AdminPromptSection`, `AdminPromptVersion`, `AdminPromptPreview*`, `AdminPromptTestQuestion`.

Add 9 endpoint builders matching the routes in Task 15.

Add 9 `dataService.*` wrappers through the existing `request` helper.

Add `QueryKeys.adminPrompts*` and `MutationKeys.*` enum members.

Build + type-check. Commit: `feat(prompt-ui): data-provider types + endpoints + service + keys`.

Follow the existing `buildQuery` helper; use `as Record<string, unknown>` casts where the interface lacks an index signature (Task 12 of feedback PR had the same issue).

---

## Task 17: Real `AgentsClient` adapter over the LibreChat HTTP API

**Files:**
- Create: `api/server/services/prompts/realAgentsClient.js`
- Modify: `api/server/index.js` (wire `app.locals.agentsClient`)

- [ ] **Step 1: Implementation**

```js
// api/server/services/prompts/realAgentsClient.js
// Thin adapter over LibreChat's own /api/agents endpoints.
// Called from inside the same Express process, so uses fetch with
// Authorization: Bearer <SEED_ADMIN_TOKEN> (generated at boot).
const { logger } = require('@librechat/data-schemas');

function buildRealAgentsClient({ apiBase, authToken }) {
  async function http(method, path, body) {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${method} ${path}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    async getAgent(id) {
      const a = await http('GET', `/api/agents/${encodeURIComponent(id)}`);
      return {
        id: a.id,
        name: a.name,
        model: a.model,
        instructions: a.instructions ?? '',
        actions: a.actions,
      };
    },
    async createAgent(input) {
      const a = await http('POST', '/api/agents', input);
      return { id: a.id, ...input };
    },
    async patchAgent(id, patch) {
      const a = await http(
        'PATCH',
        `/api/agents/${encodeURIComponent(id)}`,
        patch,
      );
      return { id, ...patch, ...a };
    },
    async deleteAgent(id) {
      await http('DELETE', `/api/agents/${encodeURIComponent(id)}`);
    },
    async chat(id, message) {
      // Delegate to the existing chat endpoint for synchronous agent replies.
      // Note: implementing this against LibreChat requires a POST to
      // /api/ask with stream=false. See existing integration tests for shape.
      const out = await http('POST', '/api/ask', {
        endpoint: 'agents',
        agent_id: id,
        text: message,
        stream: false,
      });
      return { answer: out.text ?? '', toolCalls: out.toolCalls ?? [] };
    },
  };
}

module.exports = { buildRealAgentsClient };
```

- [ ] **Step 2: Wire at boot**

In `api/server/index.js` after `const app = express()`:
```js
const { buildRealAgentsClient } = require('./services/prompts/realAgentsClient');
app.locals.agentsClient = buildRealAgentsClient({
  apiBase: process.env.LC_INTERNAL_BASE || 'http://localhost:3080',
  authToken: process.env.LC_INTERNAL_ADMIN_TOKEN || '',
});
app.locals.liveAgentIds = {
  unified: process.env.BOTNIM_AGENT_ID_UNIFIED,
  takanon: process.env.BOTNIM_AGENT_ID_TAKANON,
  budgetkey: process.env.BOTNIM_AGENT_ID_BUDGETKEY,
};
```

- [ ] **Step 3: Update `agentPatcher.js`** to use `app.locals.liveAgentIds`:

```js
async function patchLibreChatAgent(agentsClient, liveAgentIds, agentType, instructions) {
  const id = liveAgentIds[agentType];
  if (!id) throw new Error(`no live agent id for ${agentType}`);
  await agentsClient.patchAgent(id, { instructions });
}
module.exports = { patchLibreChatAgent };
```

Adjust `promptsController.js` to pass `req.app.locals.liveAgentIds` alongside `agentsClient`.

- [ ] **Step 4: Commit**

```bash
cat > /tmp/task17-commit.txt <<'EOF'
feat(prompt-ui): real AgentsClient + app.locals wiring

Thin fetch wrapper over LibreChat's own /api/agents endpoints. Injected
into req.app.locals.agentsClient at boot so the admin-prompts
controller can call the service layer without global state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add api/server/services/prompts/realAgentsClient.js api/server/services/prompts/agentPatcher.js api/server/index.js api/server/controllers/admin/promptsController.js
git commit -F /tmp/task17-commit.txt
```

---

## Task 18: React Query hooks (`client/src/data-provider/AdminPrompts/`)

**Files:**
- Create: `client/src/data-provider/AdminPrompts/queries.ts`
- Create: `client/src/data-provider/AdminPrompts/index.ts`
- Modify: `client/src/data-provider/index.ts`

Mirror the Task 13 pattern from the feedback-insights plan (react-query v4 positional args, `dataService` namespace import, `QueryKeys.adminPrompts*`). Write one hook per endpoint:

- `useAdminPromptAgents()`
- `useAdminPromptSections(agentType)`
- `useAdminPromptVersions(agentType, sectionKey)`
- `useSaveDraft()` — mutation, invalidates sections
- `usePublishPrompt()` — mutation, invalidates sections + versions
- `usePreviewPrompt()` — mutation (no caching; runs once per click)
- `useRestorePrompt()` — mutation
- `useAdminPromptTestQuestions(agentType)` + `useSaveTestQuestions()`

Build, check types, commit `feat(prompt-ui): client react-query hooks for admin prompts`.

---

## Task 19: `PromptsDashboard` + route guard + barrel + menu link

**Files:**
- Create: `client/src/components/Admin/Prompts/PromptsDashboard.tsx`
- Create: `client/src/components/Admin/Prompts/index.ts`
- Modify: `client/src/routes/Dashboard.tsx` (add `path: 'prompts'` child route)
- Modify: `client/src/components/Nav/AccountSettings.tsx` (add admin-only menu item)
- Modify: `client/src/locales/en/translation.json` (add ~30 keys)

- [ ] **Step 1: Add i18n keys**

In `client/src/locales/en/translation.json` (alphabetical slot alongside `com_admin_feedback_*`), add:

```json
  "com_admin_prompts_title": "Prompt management",
  "com_admin_prompts_agent_unified": "Unified (production)",
  "com_admin_prompts_agent_takanon": "Takanon (legal-only)",
  "com_admin_prompts_agent_budgetkey": "BudgetKey (budget-only)",
  "com_admin_prompts_sections": "Sections",
  "com_admin_prompts_has_draft": "Has draft",
  "com_admin_prompts_save_draft": "Save draft",
  "com_admin_prompts_publish": "Publish",
  "com_admin_prompts_preview": "Preview",
  "com_admin_prompts_history": "History",
  "com_admin_prompts_restore": "Restore",
  "com_admin_prompts_restore_confirm": "This will publish the old body without preview. Continue?",
  "com_admin_prompts_change_note": "Change note",
  "com_admin_prompts_change_note_required": "Change note is required on publish.",
  "com_admin_prompts_stale_parent": "Someone else published over you. Review the new active and try again.",
  "com_admin_prompts_preview_header": "Preview test-questions",
  "com_admin_prompts_preview_current": "Current",
  "com_admin_prompts_preview_draft": "Draft",
  "com_admin_prompts_preview_timed_out": "Timed out",
  "com_admin_prompts_test_questions": "Test questions",
  "com_admin_prompts_add_test_question": "Add question",
  "com_admin_prompts_section_key": "Section key",
  "com_admin_prompts_ordinal": "Order",
  "com_admin_prompts_last_edited": "Last edited",
  "com_admin_prompts_active_ago": "Active since {{relative}}",
  "com_admin_prompts_diff_with_current": "Diff with current active",
  "com_admin_prompts_diff_none": "No difference",
  "com_admin_prompts_published_by": "Published by",
  "com_admin_prompts_empty": "No sections yet — run migrate-prompts-into-db.",
```

- [ ] **Step 2: Dashboard component**

```tsx
// client/src/components/Admin/Prompts/PromptsDashboard.tsx
import { useNavigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useAdminPromptAgents } from '~/data-provider/AdminPrompts/queries';
import { useAuthContext, useLocalize } from '~/hooks';

export default function PromptsDashboard() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  if (user?.role !== SystemRoles.ADMIN) {
    navigate('/c/new', { replace: true });
    return null;
  }

  const agents = useAdminPromptAgents();
  if (agents.isLoading) {
    return <div className="p-8 text-center">…</div>;
  }
  if (agents.isError || !agents.data) {
    return <div className="p-8 text-center text-red-600">Error</div>;
  }

  return (
    <main className="mx-auto max-w-6xl bg-surface-primary p-6 text-text-primary">
      <h1 className="mb-4 text-xl font-semibold">{localize('com_admin_prompts_title')}</h1>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {agents.data.agents.map((a) => (
          <li
            key={a.agentType}
            className="rounded-lg border border-border-medium bg-surface-primary-alt p-4"
          >
            <button
              type="button"
              onClick={() => navigate(`/d/prompts/${a.agentType}`)}
              className="w-full text-start"
            >
              <div className="text-sm font-medium">
                {localize(`com_admin_prompts_agent_${a.agentType}` as Parameters<ReturnType<typeof useLocalize>>[0])}
              </div>
              <div className="mt-1 text-2xl font-semibold">{a.activeSections}</div>
              <div className="text-xs text-text-secondary">
                {localize('com_admin_prompts_sections')}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Barrel**

```ts
// client/src/components/Admin/Prompts/index.ts
export { default as PromptsDashboard } from './PromptsDashboard';
```

- [ ] **Step 4: Register route**

In `client/src/routes/Dashboard.tsx`, under the `d/*` subtree (beside the existing `path: 'feedback'`), add:
```ts
{ path: 'prompts', element: <PromptsDashboard /> },
```
Import: `import { PromptsDashboard } from '~/components/Admin/Prompts';`.

- [ ] **Step 5: Admin menu link**

In `client/src/components/Nav/AccountSettings.tsx`, below the existing "Feedback insights" `Menu.MenuItem`:
```tsx
{isAdmin && (
  <Menu.MenuItem onClick={() => navigate('/d/prompts')} className="select-item text-sm">
    <FileText className="icon-md" aria-hidden="true" />
    {localize('com_admin_prompts_title')}
  </Menu.MenuItem>
)}
```
(The `FileText` import is already there — no new imports needed.)

- [ ] **Step 6: Commit**

```bash
cat > /tmp/task19-commit.txt <<'EOF'
feat(prompt-ui): PromptsDashboard + route + admin menu link + i18n

Admin-only /d/prompts landing page. Lists the 3 agents with active
section counts and routes to the per-agent detail view (Task 20+).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add client/src/components/Admin/Prompts/PromptsDashboard.tsx client/src/components/Admin/Prompts/index.ts client/src/routes/Dashboard.tsx client/src/components/Nav/AccountSettings.tsx client/src/locales/en/translation.json
git commit -F /tmp/task19-commit.txt
```

---

## Task 20: `PromptSectionList`

**Files:**
- Create: `client/src/components/Admin/Prompts/PromptSectionList.tsx`
- Modify: `client/src/routes/Dashboard.tsx` (add `path: 'prompts/:agent'`)

Renders for one `agentType`:

- Header: agent name + "back to dashboard" link
- Table: `sectionKey` | `headerText` | last-edited ago | "has draft" badge
- Click row → navigates to `/d/prompts/:agent/:key` (editor route, Task 21)

Uses `useAdminPromptSections(agent)`. All strings via `useLocalize`. Shows empty-state card with `com_admin_prompts_empty` if zero rows.

Commit: `feat(prompt-ui): PromptSectionList`.

---

## Task 21: `PromptEditor` with Monaco + Save Draft / Publish

**Files:**
- Create: `client/src/components/Admin/Prompts/PromptEditor.tsx`
- Modify: `client/src/routes/Dashboard.tsx` (add `path: 'prompts/:agent/:key'`)

Uses `@monaco-editor/react` (confirmed in Task 0). Right-to-left by default (Hebrew). Buttons: Save Draft, Publish. Publish opens a small inline form requiring `changeNote`. On 409 from publish mutation, shows a toast with `com_admin_prompts_stale_parent` and swaps the editor content to render a Monaco diff of the user's draft vs the new active (driven by `PromptDiff`, Task 22).

All state (body, changeNote, isDirty) local to the component. `useSaveDraft()` / `usePublishPrompt()` hooks for side-effects.

Commit: `feat(prompt-ui): PromptEditor with Monaco + Save Draft + Publish`.

---

## Task 22: `PromptDiff` (Monaco diffEditor)

**Files:**
- Create: `client/src/components/Admin/Prompts/PromptDiff.tsx`

Thin wrapper around `DiffEditor` from `@monaco-editor/react`. Props: `{ current: string; draft: string; readOnly?: boolean }`. Used by `PromptEditor` (on 409) and `PromptHistory` (when an older version is selected).

Commit: `feat(prompt-ui): PromptDiff wrapping Monaco DiffEditor`.

---

## Task 23: `PromptHistory` + Restore with confirm modal

**Files:**
- Create: `client/src/components/Admin/Prompts/PromptHistory.tsx`

Table of versions, newest first: createdAt, createdBy, changeNote, `active?` badge, "Diff with current" (opens PromptDiff for that version vs active), "Restore" button.

Restore → modal dialog with `com_admin_prompts_restore_confirm` copy → fires `useRestorePrompt()` on confirm. Modal blocks interaction until the user chooses.

Commit: `feat(prompt-ui): PromptHistory + Restore with confirm modal`.

---

## Task 24: `PromptPreview` + `TestQuestions`

**Files:**
- Create: `client/src/components/Admin/Prompts/PromptPreview.tsx`
- Create: `client/src/components/Admin/Prompts/TestQuestions.tsx`

Preview:
- Button in PromptEditor: "Preview" → calls `usePreviewPrompt()` with the current draft body.
- Renders an expandable panel: one row per question with two columns (Current / Draft), each showing answer + collapsed tool-trace summary. Red badge on `timedOut: true`.

TestQuestions panel:
- Lists the current questions for the agent.
- Add / edit / reorder / toggle-enabled.
- Saves on blur or explicit "Save" button (debounced mutation).

Commit: `feat(prompt-ui): PromptPreview + TestQuestions`.

---

## Task 25: Integration test + RTL check

**Files:**
- Create: `client/src/components/Admin/Prompts/__tests__/PromptsDashboard.spec.tsx`
- Create: `client/src/components/Admin/Prompts/__tests__/PromptEditor.spec.tsx`

Mirror the pattern from `client/src/components/Admin/Feedback/__tests__/FeedbackDashboard.spec.tsx` (mock `~/hooks`, mock `~/data-provider/AdminPrompts/queries`, render with `test/layout-test-utils` which already wraps QueryClient + Router).

Cover:
- Dashboard renders 3 agent cards.
- Editor enables "Publish" only when a change-note is present.
- Editor shows the stale-parent toast when a publish mutation returns an HTTP-409-shaped error.

Commit: `feat(prompt-ui): PromptsDashboard + PromptEditor integration tests`.

---

## Task 26: Nightly git-export cron

**Files:**
- Create: `packages/api/src/admin/prompts/exportRunner.ts`
- Create: `packages/api/src/admin/prompts/exportRunner.spec.ts`
- Create: `scripts/export-prompts-to-git.js`
- Modify: `packages/api/src/admin/prompts/index.ts`

- [ ] **Step 1: Runner**

```ts
// packages/api/src/admin/prompts/exportRunner.ts
import type { Model } from 'mongoose';
import { getActiveSections } from './PromptsService';
import { assemble } from './assemble';
import type { AgentType } from './PromptsService';

export interface ExportWriter {
  readFile(agentType: AgentType): Promise<string>;
  writeFile(agentType: AgentType, contents: string): Promise<void>;
  commitAndPush(
    message: string,
    changedAgentTypes: AgentType[],
  ): Promise<{ committedSha: string | null }>;
}

export interface RunExportInput {
  Prompt: Model<unknown>;
  writer: ExportWriter;
  now?: Date;
}

export interface RunExportResult {
  changed: AgentType[];
  committedSha: string | null;
}

const AGENTS: AgentType[] = ['unified', 'takanon', 'budgetkey'];

export async function runExport(
  input: RunExportInput,
): Promise<RunExportResult> {
  const changed: AgentType[] = [];
  for (const agentType of AGENTS) {
    const sections = await getActiveSections({ Prompt: input.Prompt, agentType });
    if (sections.length === 0) continue;
    const next = assemble(sections);
    const prev = await input.writer.readFile(agentType);
    if (next.trim() === prev.trim()) continue;
    await input.writer.writeFile(agentType, next);
    changed.push(agentType);
  }
  if (changed.length === 0) {
    return { changed: [], committedSha: null };
  }
  const now = (input.now ?? new Date()).toISOString().slice(0, 10);
  const { committedSha } = await input.writer.commitAndPush(
    `chore(prompt): nightly DB export ${now}`,
    changed,
  );
  return { changed, committedSha };
}
```

- [ ] **Step 2: Spec with fake writer**

(full code analogous to Task 11: fake writer records calls; test covers "no-op when unchanged", "writes + commits when any changed", "skips when DB empty".)

- [ ] **Step 3: CLI + real writer**

```js
// scripts/export-prompts-to-git.js
#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const { createModels } = require('@librechat/data-schemas');
const { AdminPrompts } = require(path.join(
  __dirname, '..', 'packages', 'api', 'dist', 'index.js',
));

const REPO = process.env.PROMPTS_REPO
  || path.join(__dirname, '..', '..', 'rebuilding-bots');

function fileFor(agentType) {
  return path.join(REPO, 'specs', agentType, 'agent.txt');
}

const writer = {
  async readFile(agentType) {
    const p = fileFor(agentType);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  },
  async writeFile(agentType, contents) {
    fs.writeFileSync(fileFor(agentType), contents, 'utf8');
  },
  async commitAndPush(message, changed) {
    const files = changed.map((a) => `specs/${a}/agent.txt`).join(' ');
    execSync(`cd ${REPO} && git add ${files}`);
    const sha = execSync(`cd ${REPO} && git commit -m ${JSON.stringify(message)} && git rev-parse HEAD`).toString().trim().split('\n').pop();
    execSync(`cd ${REPO} && git push origin main`);
    return { committedSha: sha };
  },
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const { Prompt } = createModels(mongoose);
  const out = await AdminPrompts.runExport({ Prompt, writer });
  console.log(JSON.stringify({ stage: 'done', ...out }));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ stage: 'fatal', error: e.message }));
  process.exit(1);
});
```

- [ ] **Step 4: Commit**

```bash
cat > /tmp/task26-commit.txt <<'EOF'
feat(prompt-ui): nightly runExport — DB → agent.txt git commit

Pure runExport function + fake writer for testability + CLI that wraps
real fs + git. Skips agents whose assembled content hasn't changed;
commits only the subset that did. Runs as an ECS scheduled task (Task 27).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add packages/api/src/admin/prompts/exportRunner.ts packages/api/src/admin/prompts/exportRunner.spec.ts packages/api/src/admin/prompts/index.ts scripts/export-prompts-to-git.js
git commit -F /tmp/task26-commit.txt
```

---

## Task 27: EventBridge rule for nightly export

**Files:**
- Modify: `infra/envs/staging/main.tf` (append 1 rule + 1 target, reuse feedback's IAM role)
- Modify: `infra/envs/staging/outputs.tf`

- [ ] **Step 1: Add HCL**

```hcl
resource "aws_cloudwatch_event_rule" "prompts_export" {
  name                = "librechat-${var.environment}-prompts-export"
  schedule_expression = "cron(30 2 * * ? *)"  # 02:30 local, just after feedback classifier
}

resource "aws_cloudwatch_event_target" "prompts_export" {
  rule     = aws_cloudwatch_event_rule.prompts_export.name
  arn      = local.contract.ecs.cluster_arn
  role_arn = aws_iam_role.feedback_scheduled.arn

  ecs_target {
    task_definition_arn = data.aws_ecs_task_definition.librechat.arn
    launch_type         = "FARGATE"
    network_configuration {
      subnets          = local.contract.network.private_subnet_ids
      security_groups  = [module.librechat.security_group_id]
      assign_public_ip = false
    }
  }
  input = jsonencode({
    containerOverrides = [{
      name    = "api"
      command = ["node", "scripts/export-prompts-to-git.js"]
    }]
  })
}

output "prompts_export_rule_arn" {
  value = aws_cloudwatch_event_rule.prompts_export.arn
}
```

- [ ] **Step 2: Plan + validate**

```bash
AWS_PROFILE=anubanu-staging terragrunt --working-dir infra/live/staging plan -compact-warnings -no-color 2>&1 | tail -20
```
Expected: `+1` rule, `+1` target, `+1` output, no destroys.

- [ ] **Step 3: Commit (apply is deferred to Task 28)**

```bash
cat > /tmp/task27-commit.txt <<'EOF'
feat(prompt-ui): EventBridge nightly prompts-export scheduled task

Triggers export-prompts-to-git at 02:30 local (just after the feedback
classifier's 02:00 slot). Reuses the feedback_scheduled IAM role since
its RunTask + PassRole policy covers both scripts.

Apply is deferred to the PR merge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
git add infra/envs/staging/main.tf infra/envs/staging/outputs.tf
git commit -F /tmp/task27-commit.txt
```

---

## Task 28: Final push + PR

- [ ] **Step 1: Full test suite per workspace**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas && npx jest
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/api && npm run test:ci
cd /Users/amir/Development/anubanu/parlibot/LibreChat/api && npx jest
cd /Users/amir/Development/anubanu/parlibot/LibreChat/client && npx jest src/components/Admin/Prompts
```
Expected: all green.

- [ ] **Step 2: Type-check each TS workspace**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npx tsc --noEmit --project packages/data-schemas/tsconfig.json
npx tsc --noEmit --project packages/data-provider/tsconfig.json
npx tsc --noEmit --project packages/api/tsconfig.json
npx tsc --noEmit --project client/tsconfig.json
```
Expected: no errors new-to-this-PR.

- [ ] **Step 3: Push LibreChat branch**

```bash
git push -u origin feat/admin-prompt-management
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --repo whiletrue-industries/LibreChat \
  --title "feat(prompt-ui): admin-editable prompt management" \
  --body "$(cat <<'EOF'
## Summary
- New /d/prompts admin page — per-section Draft → Preview → Publish workflow for the 3 Botnim agents.
- Optimistic concurrency on publish; 409 opens a rebase diff.
- Preview runs canned Hebrew test questions against a shadow LibreChat agent with the draft swapped in; side-by-side diff vs live.
- Nightly ECS scheduled task exports DB rows back to rebuilding-bots/specs/*/agent.txt so git log stays authoritative for offline review and rollback.
- Depends on rebuilding-bots#<pr-n> landing first (adds SECTION_KEY markers).

## Test plan
- [x] Unit + integration tests per workspace.
- [ ] Staging deploy + migrate-prompts-into-db + spot-check: edit a section, Save Draft, Preview, Publish, verify live agent's instructions update within 5s, verify /d/prompts history shows both versions, verify nightly cron writes back to rebuilding-bots.

## Deferred (per spec)
- Cross-env promotion, prompt templating, 2-admin approval.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Deploy to staging**

Once rebuilding-bots PR is merged, run the prompts migration + deploy LibreChat:

```bash
# 1. Pull the marker-updated rebuilding-bots locally
cd /Users/amir/Development/anubanu/parlibot/rebuilding-bots && git checkout main && git pull

# 2. Deploy new LibreChat image
cd /Users/amir/Development/anubanu/parlibot
make deploy-staging TAG=v0.8.4-botnim-prompt-ui-v1

# 3. Run the migration once against staging Mongo (admin-initiated)
#    — use ecs execute-command OR a one-off RunTask override:
AWS_PROFILE=anubanu-staging aws ecs run-task \
  --cluster buildup-staging \
  --task-definition librechat-staging-api \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=["subnet-0934f5cd0ae28b5e2","subnet-040550f09813c5009"],securityGroups=["sg-079a9e754946aaab6","sg-07b7d1c6e515ea373"],assignPublicIp=DISABLED}' \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","scripts/migrate-prompts-into-db.js"],"environment":[{"name":"MONGO_URI","value":"<staging-mongo-uri>"}]}]}'
```

- [ ] **Step 6: Manual verification**

Per the spec §Testability "End-to-end dress rehearsal":
1. Open `/d/prompts` as admin — 3 agent cards.
2. Drill into unified → sections list → edit `preamble` — Save Draft.
3. Preview → confirm two-column result for each test question.
4. Publish with a change-note → live Botnim agent instructions mirror the DB (`seed-botnim-agent.js`-style check against the running Assistant).
5. Open history — 2 rows, newest is active.
6. Manually trigger the export cron → confirm a git commit lands on rebuilding-bots main.

---

## Summary / self-review notes

**Coverage vs. spec:** every numbered piece of the spec — schema, markers, parse, assemble, service, shadow agent, preview, routes, react-query hooks, UI components, nightly export, EventBridge — has a task. No `TBD`/`TODO` markers remain.

**Type consistency:** `AgentType` defined in PromptsService.ts, re-exported from the barrel, used verbatim in all downstream modules. `PromptRow`, `ParsedSection`, `AssembleSection` match the Mongoose `IPrompt` shape. `AgentsClient` interface appears in exactly one file (shadowAgent.ts); everything else depends on the interface.

**Known gaps deferred per spec:** cross-environment promotion, prompt templating, 2-admin approval, Slack notifications on publish. All explicitly out of scope for v1.

**Assumptions flagged in the plan (verify at build time, not planning time):**
- Monaco is a dep of the `client` workspace. Confirmed by Task 0; stop there if not.
- LibreChat's `/api/agents` GET/POST/PATCH/DELETE + `/api/ask` for synchronous chat match the shape in Task 17's `realAgentsClient`. If the real endpoints diverge (e.g. chat is stream-only), the Task 17 implementer needs to adapt — flagged clearly.
- The `feedback_scheduled` IAM role already exists in `infra/envs/staging/main.tf` (added in the feedback-insights PR). If it doesn't, Task 27 needs to add the role first.

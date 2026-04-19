# Admin Feedback Insights Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only `/d/feedback` page in LibreChat with a nightly topic-classification pipeline and weekly cluster-discovery, so PMs can see thumbs-up/down analytics grouped by Hebrew topic, endpoint, tool call, reason tag, and time.

**Architecture:** Three offline pieces — (1) a nightly ECS scheduled task that classifies each fed-back message into a Hebrew topic (taxonomy-first, LLM fallback); (2) a weekly ECS scheduled task that proposes new topic clusters from the LLM "other" tail; (3) a React dashboard backed by three admin-only endpoints (`/api/admin/feedback/overview`, `/messages`, `/pending-topics`) that aggregate from the same `messages.feedback` collection upstream already populates.

**Tech Stack:** Mongoose + MongoDB (existing), TypeScript in `packages/api` + `packages/data-schemas` + `packages/data-provider` + `client` (per `LibreChat/CLAUDE.md` workspace rules), thin JS routes under `api/server`, Jest + `mongodb-memory-server` + `supertest` for tests, recharts for charts (already a dep), AWS EventBridge + ECS `RunTask` for cron (terragrunt).

**Branch:** `feat/admin-feedback-dashboard` (already created on `LibreChat`).

**Spec:** `LibreChat/docs/superpowers/specs/2026-04-19-admin-feedback-insights-design.md`.

---

## File structure (created/modified)

**Create:**
- `packages/data-schemas/src/schema/feedbackTopic.ts`
- `packages/data-schemas/src/schema/feedbackTopicPending.ts`
- `packages/data-schemas/src/types/feedbackTopic.ts`
- `packages/api/src/admin/feedback/taxonomy.ts`
- `packages/api/src/admin/feedback/taxonomy.spec.ts`
- `packages/api/src/admin/feedback/llmAdapter.ts`
- `packages/api/src/admin/feedback/fakeLlm.ts`
- `packages/api/src/admin/feedback/classifyOne.ts`
- `packages/api/src/admin/feedback/classifyOne.spec.ts`
- `packages/api/src/admin/feedback/proposeClusters.ts`
- `packages/api/src/admin/feedback/proposeClusters.spec.ts`
- `packages/api/src/admin/feedback/FeedbackAnalytics.ts`
- `packages/api/src/admin/feedback/FeedbackAnalytics.spec.ts`
- `packages/api/src/admin/feedback/index.ts`
- `api/server/routes/admin/feedback.js`
- `api/server/controllers/admin/feedbackController.js`
- `api/test/admin.feedback.spec.js`
- `scripts/classify-feedback-topics.js`
- `scripts/discover-feedback-clusters.js`
- `scripts/feedback-topics/seed.js`
- `client/src/components/Admin/Feedback/FeedbackDashboard.tsx`
- `client/src/components/Admin/Feedback/FilterBar.tsx`
- `client/src/components/Admin/Feedback/KpiStrip.tsx`
- `client/src/components/Admin/Feedback/FeedbackTimeSeries.tsx`
- `client/src/components/Admin/Feedback/TopicTable.tsx`
- `client/src/components/Admin/Feedback/ToolCallChart.tsx`
- `client/src/components/Admin/Feedback/PendingTopicsQueue.tsx`
- `client/src/components/Admin/Feedback/FeedbackDrillDown.tsx`
- `client/src/components/Admin/Feedback/index.ts`
- `client/src/components/Admin/Feedback/__tests__/FeedbackDashboard.spec.tsx`
- `client/src/data-provider/AdminFeedback/queries.ts`
- `client/src/data-provider/AdminFeedback/index.ts`

**Modify:**
- `packages/data-schemas/src/schema/message.ts` — extend `feedback` subschema with `topic`, `topicSource`, `topicClassifiedAt`
- `packages/data-schemas/src/types/message.ts` — add new feedback fields to the TS interface
- `packages/data-schemas/src/index.ts` — export new schemas
- `packages/data-provider/src/api-endpoints.ts` — add admin-feedback endpoint builders
- `packages/data-provider/src/data-service.ts` — add `getAdminFeedbackOverview`, `getAdminFeedbackMessages`, `getPendingTopics`, `approvePendingTopic`, `rejectPendingTopic`
- `packages/data-provider/src/types/queries.ts` — add query-parameter and response types
- `packages/data-provider/src/keys.ts` — add QueryKey constants
- `packages/data-provider/src/index.ts` — re-export everything
- `client/src/data-provider/index.ts` — re-export `AdminFeedback`
- `api/server/index.js` — mount the admin/feedback router
- `client/src/locales/en/translation.json` — add `com_admin_feedback_*` keys
- `client/src/routes/Root.tsx` (or wherever the authenticated route list is defined) — register `/d/feedback`
- `LibreChat/infra/envs/staging/main.tf` — EventBridge rules + IAM role for the scheduled tasks
- `LibreChat/infra/envs/staging/outputs.tf` — expose new rule ARNs

Test files are listed in their task.

---

## Task 0: Prep — branch + npm install

**Files:** no code changes; confirms baseline.

- [ ] **Step 1: Confirm branch**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
git branch --show-current
```
Expected output: `feat/admin-feedback-dashboard`

- [ ] **Step 2: Confirm deps are installed (Mac-native, we use Docker only for the amd64 overlay)**

```bash
ls /Users/amir/Development/anubanu/parlibot/LibreChat/node_modules/.bin/jest > /dev/null && echo OK
```
Expected: `OK`. If not, run `npm install --prefix /Users/amir/Development/anubanu/parlibot/LibreChat` first.

- [ ] **Step 3: Verify mongodb-memory-server is already a devDep**

```bash
grep -r 'mongodb-memory-server' /Users/amir/Development/anubanu/parlibot/LibreChat/api/package.json /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas/package.json
```
Expected: at least one hit. If neither workspace has it, add with:
```bash
npm install --prefix /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas -D mongodb-memory-server
```

No commit — this is a sanity check only.

---

## Task 1: Extend message schema with topic fields

**Files:**
- Modify: `packages/data-schemas/src/schema/message.ts:78-96`
- Modify: `packages/data-schemas/src/types/message.ts` (add new fields to the TS interface — find `IMessage` or similar)
- Test: `packages/data-schemas/src/schema/message.spec.ts` (create if missing)

- [ ] **Step 1: Write the failing test** (`packages/data-schemas/src/schema/message.spec.ts`)

```ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { messageSchema } from './message';

describe('message.feedback.topic', () => {
  let mem: MongoMemoryServer;
  let Message: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageTest', messageSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('accepts feedback.topic, topicSource, topicClassifiedAt', async () => {
    const doc = await Message.create({
      messageId: 'm1',
      conversationId: 'c1',
      user: 'u1',
      feedback: {
        rating: 'thumbsUp',
        topic: 'budget_ministries',
        topicSource: 'taxonomy',
        topicClassifiedAt: new Date('2026-04-19T02:05:00Z'),
      },
    });
    const fetched = await Message.findById(doc._id).lean();
    expect(fetched?.feedback?.topic).toBe('budget_ministries');
    expect(fetched?.feedback?.topicSource).toBe('taxonomy');
    expect(fetched?.feedback?.topicClassifiedAt).toBeInstanceOf(Date);
  });

  it('rejects invalid topicSource', async () => {
    await expect(
      Message.create({
        messageId: 'm2',
        conversationId: 'c1',
        user: 'u1',
        feedback: { rating: 'thumbsDown', topic: 'x', topicSource: 'invalid' },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas
npx jest src/schema/message.spec.ts
```
Expected: FAIL — `topic is not allowed` or similar validation error.

- [ ] **Step 3: Extend the schema**

In `packages/data-schemas/src/schema/message.ts`, replace the existing `feedback` subschema (lines 78-96) with:

```ts
    feedback: {
      type: {
        rating: {
          type: String,
          enum: ['thumbsUp', 'thumbsDown'],
          required: true,
        },
        tag: {
          type: mongoose.Schema.Types.Mixed,
          required: false,
        },
        text: {
          type: String,
          required: false,
        },
        topic: {
          type: String,
          required: false,
          index: true,
        },
        topicSource: {
          type: String,
          enum: ['taxonomy', 'llm', 'llm-invalid', 'taxonomy-retroactive'],
          required: false,
        },
        topicClassifiedAt: {
          type: Date,
          required: false,
        },
      },
      default: undefined,
      required: false,
    },
```

- [ ] **Step 4: Extend the TS interface**

In `packages/data-schemas/src/types/message.ts`, find the feedback-related interface (likely `IMessage.feedback` or an inlined literal). Add:

```ts
  topic?: string;
  topicSource?: 'taxonomy' | 'llm' | 'llm-invalid' | 'taxonomy-retroactive';
  topicClassifiedAt?: Date;
```
alongside the existing `rating`/`tag`/`text` fields.

- [ ] **Step 5: Run tests, verify pass**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas
npx jest src/schema/message.spec.ts
```
Expected: PASS (2 tests).

- [ ] **Step 6: Run full workspace test**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas
npx jest
```
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
git add packages/data-schemas/src/schema/message.ts packages/data-schemas/src/schema/message.spec.ts packages/data-schemas/src/types/message.ts
git commit -m "feat(feedback-insights): extend message feedback with topic fields"
```

---

## Task 2: New Mongoose schemas — feedbackTopic + feedbackTopicPending

**Files:**
- Create: `packages/data-schemas/src/schema/feedbackTopic.ts`
- Create: `packages/data-schemas/src/schema/feedbackTopicPending.ts`
- Create: `packages/data-schemas/src/types/feedbackTopic.ts`
- Modify: `packages/data-schemas/src/index.ts` (add exports)
- Test: `packages/data-schemas/src/schema/feedbackTopic.spec.ts`

- [ ] **Step 1: Write types** (`packages/data-schemas/src/types/feedbackTopic.ts`)

```ts
export interface IFeedbackTopic {
  key: string;
  labelHe: string;
  labelEn: string;
  keywords: string[];
  active: boolean;
  createdAt: Date;
  createdBy?: string;
}

export interface IFeedbackTopicPending {
  proposedKey: string;
  labelHe: string;
  labelEn: string;
  rawLabels: string[];
  exampleMessageIds: string[];
  status: 'pending' | 'rejected';
  proposedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
}
```

- [ ] **Step 2: Write the schemas** (`packages/data-schemas/src/schema/feedbackTopic.ts`)

```ts
import mongoose, { Schema } from 'mongoose';
import type { IFeedbackTopic } from '../types/feedbackTopic';

const feedbackTopicSchema = new Schema<IFeedbackTopic>({
  key: { type: String, required: true, unique: true, index: true },
  labelHe: { type: String, required: true },
  labelEn: { type: String, required: true },
  keywords: { type: [String], default: [] },
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String },
});

export { feedbackTopicSchema };
```

And `packages/data-schemas/src/schema/feedbackTopicPending.ts`:

```ts
import mongoose, { Schema } from 'mongoose';
import type { IFeedbackTopicPending } from '../types/feedbackTopic';

const feedbackTopicPendingSchema = new Schema<IFeedbackTopicPending>({
  proposedKey: { type: String, required: true },
  labelHe: { type: String, required: true },
  labelEn: { type: String, required: true },
  rawLabels: { type: [String], default: [] },
  exampleMessageIds: { type: [String], default: [] },
  status: {
    type: String,
    enum: ['pending', 'rejected'],
    default: 'pending',
    index: true,
  },
  proposedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: String },
});

export { feedbackTopicPendingSchema };
```

- [ ] **Step 3: Write the test** (`packages/data-schemas/src/schema/feedbackTopic.spec.ts`)

```ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { feedbackTopicSchema } from './feedbackTopic';
import { feedbackTopicPendingSchema } from './feedbackTopicPending';

describe('feedbackTopic schemas', () => {
  let mem: MongoMemoryServer;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('enforces unique key on feedbackTopic', async () => {
    const Topic = mongoose.model('TopicTest', feedbackTopicSchema);
    await Topic.create({ key: 'budget', labelHe: 'תקציב', labelEn: 'Budget' });
    await expect(
      Topic.create({ key: 'budget', labelHe: 'x', labelEn: 'x' }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('defaults status=pending on feedbackTopicPending', async () => {
    const Pending = mongoose.model('PendingTest', feedbackTopicPendingSchema);
    const doc = await Pending.create({
      proposedKey: 'ethics',
      labelHe: 'אתיקה',
      labelEn: 'Ethics',
    });
    expect(doc.status).toBe('pending');
    expect(doc.proposedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 4: Export from index**

In `packages/data-schemas/src/index.ts`, add (near the other schema exports):

```ts
export { feedbackTopicSchema } from './schema/feedbackTopic';
export { feedbackTopicPendingSchema } from './schema/feedbackTopicPending';
export type { IFeedbackTopic, IFeedbackTopicPending } from './types/feedbackTopic';
```

- [ ] **Step 5: Run test**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas
npx jest src/schema/feedbackTopic.spec.ts
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/data-schemas/src/schema/feedbackTopic.ts packages/data-schemas/src/schema/feedbackTopicPending.ts packages/data-schemas/src/schema/feedbackTopic.spec.ts packages/data-schemas/src/types/feedbackTopic.ts packages/data-schemas/src/index.ts
git commit -m "feat(feedback-insights): add feedbackTopic + feedbackTopicPending schemas"
```

---

## Task 3: Taxonomy data + match function

**Files:**
- Create: `packages/api/src/admin/feedback/taxonomy.ts`
- Test: `packages/api/src/admin/feedback/taxonomy.spec.ts`

The 15 initial categories are a v1 best-guess per the spec's open questions. They are editable later.

- [ ] **Step 1: Write the failing test** (`packages/api/src/admin/feedback/taxonomy.spec.ts`)

```ts
import { initialTaxonomy, matchTaxonomy } from './taxonomy';

describe('matchTaxonomy', () => {
  it('matches a budget question', () => {
    const result = matchTaxonomy('מה תקציב משרד החינוך לשנת 2025?');
    expect(result).toBe('budget_ministries');
  });

  it('matches a takanon question', () => {
    const result = matchTaxonomy('מה אומר סעיף 106 לתקנון הכנסת?');
    expect(result).toBe('takanon_sections');
  });

  it('returns null on no match', () => {
    const result = matchTaxonomy('מה השעה עכשיו?');
    expect(result).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(matchTaxonomy('')).toBeNull();
    expect(matchTaxonomy('   ')).toBeNull();
  });

  it('initial taxonomy has stable keys and non-empty Hebrew labels', () => {
    for (const entry of initialTaxonomy) {
      expect(entry.key).toMatch(/^[a-z_]+$/);
      expect(entry.labelHe.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/api
npx jest src/admin/feedback/taxonomy.spec.ts
```
Expected: FAIL — `Cannot find module './taxonomy'`.

- [ ] **Step 3: Write the taxonomy** (`packages/api/src/admin/feedback/taxonomy.ts`)

```ts
export interface TaxonomyEntry {
  key: string;
  labelHe: string;
  labelEn: string;
  keywords: string[];
}

export const initialTaxonomy: TaxonomyEntry[] = [
  {
    key: 'budget_ministries',
    labelHe: 'תקציב משרדי',
    labelEn: 'Ministry budgets',
    keywords: ['תקציב משרד', 'תקציב חינוך', 'תקציב הבריאות', 'תקציב ביטחון'],
  },
  {
    key: 'budget_general',
    labelHe: 'תקציב המדינה',
    labelEn: 'State budget',
    keywords: ['תקציב המדינה', 'הצעת התקציב', 'חוק התקציב'],
  },
  {
    key: 'budget_transfers',
    labelHe: 'העברות תקציביות',
    labelEn: 'Budget transfers',
    keywords: ['העברה תקציבית', 'פניה תקציבית'],
  },
  {
    key: 'procurement',
    labelHe: 'רכש',
    labelEn: 'Procurement',
    keywords: ['רכש', 'מכרז', 'ספק'],
  },
  {
    key: 'grants',
    labelHe: 'תמיכות',
    labelEn: 'Grants',
    keywords: ['תמיכה', 'תמיכות', 'מבחן תמיכה'],
  },
  {
    key: 'takanon_sections',
    labelHe: 'תקנון הכנסת',
    labelEn: 'Knesset bylaws',
    keywords: ['תקנון הכנסת', 'סעיף בתקנון', 'סדר יום'],
  },
  {
    key: 'ethics',
    labelHe: 'ועדת האתיקה',
    labelEn: 'Ethics committee',
    keywords: ['אתיקה', 'ועדת האתיקה', 'חבר כנסת', 'תרומה'],
  },
  {
    key: 'committees',
    labelHe: 'ועדות הכנסת',
    labelEn: 'Knesset committees',
    keywords: ['ועדה', 'ועדות', 'ישיבת ועדה'],
  },
  {
    key: 'mk_conduct',
    labelHe: 'התנהלות חברי כנסת',
    labelEn: 'MK conduct',
    keywords: ['חסינות', 'תפקיד מקביל', 'ניגוד עניינים'],
  },
  {
    key: 'legislation',
    labelHe: 'חקיקה',
    labelEn: 'Legislation',
    keywords: ['הצעת חוק', 'חוק יסוד', 'קריאה ראשונה', 'קריאה שנייה'],
  },
  {
    key: 'plenary',
    labelHe: 'מליאה',
    labelEn: 'Plenary',
    keywords: ['מליאה', 'דיון במליאה', 'הצבעה'],
  },
  {
    key: 'government_decisions',
    labelHe: 'החלטות ממשלה',
    labelEn: 'Government decisions',
    keywords: ['החלטת ממשלה', 'מאגר החלטות'],
  },
  {
    key: 'courts',
    labelHe: 'פסיקה',
    labelEn: 'Courts',
    keywords: ['פסק דין', 'בג"ץ', 'בית משפט'],
  },
  {
    key: 'finance_committee',
    labelHe: 'ועדת הכספים',
    labelEn: 'Finance committee',
    keywords: ['ועדת הכספים', 'ועדת כספים'],
  },
  {
    key: 'data_coverage',
    labelHe: 'כיסוי מידע',
    labelEn: 'Data coverage',
    keywords: ['אין מידע', 'לא מצאתי', 'לא מכיר'],
  },
];

export function matchTaxonomy(text: string): string | null {
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }
  for (const entry of initialTaxonomy) {
    for (const keyword of entry.keywords) {
      if (trimmed.includes(keyword)) {
        return entry.key;
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/api
npx jest src/admin/feedback/taxonomy.spec.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/admin/feedback/taxonomy.ts packages/api/src/admin/feedback/taxonomy.spec.ts
git commit -m "feat(feedback-insights): initial Hebrew taxonomy + matcher"
```

---

## Task 4: LLM adapter + fake for tests

**Files:**
- Create: `packages/api/src/admin/feedback/llmAdapter.ts` (interface + OpenAI adapter)
- Create: `packages/api/src/admin/feedback/fakeLlm.ts`
- Test: `packages/api/src/admin/feedback/fakeLlm.spec.ts`

- [ ] **Step 1: Write the fake + interface test** (`packages/api/src/admin/feedback/fakeLlm.spec.ts`)

```ts
import { buildFakeLlm } from './fakeLlm';

describe('fakeLlm', () => {
  it('returns canned response when prefix matches', async () => {
    const llm = buildFakeLlm({
      'תקציב': 'budget_ministries',
      default: 'other:unmapped',
    });
    expect(await llm.classify('תקציב חינוך 2025', ['budget_ministries'])).toBe(
      'budget_ministries',
    );
    expect(await llm.classify('משהו אחר', ['budget_ministries'])).toBe(
      'other:unmapped',
    );
  });
});
```

- [ ] **Step 2: Write the interface + fake**

`packages/api/src/admin/feedback/llmAdapter.ts`:

```ts
export interface LlmAdapter {
  classify(prompt: string, knownKeys: string[]): Promise<string>;
}

export function buildOpenAiLlm(apiKey: string, model = 'gpt-4o-mini'): LlmAdapter {
  return {
    async classify(prompt: string, knownKeys: string[]): Promise<string> {
      const system = [
        'You classify Hebrew questions into topic keys for a product-feedback dashboard.',
        `Known keys: ${knownKeys.join(', ')}.`,
        'Respond with EXACTLY one of: a known key, or `other:<short_hebrew_label>`.',
        'No explanation, no quotes, one token on a single line.',
      ].join(' ');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
          max_tokens: 40,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0].message.content.trim();
    },
  };
}
```

`packages/api/src/admin/feedback/fakeLlm.ts`:

```ts
import type { LlmAdapter } from './llmAdapter';

export type FakeLlmResponses = Record<string, string> & { default?: string };

export function buildFakeLlm(responses: FakeLlmResponses): LlmAdapter {
  return {
    async classify(prompt: string): Promise<string> {
      for (const [prefix, result] of Object.entries(responses)) {
        if (prefix === 'default') {
          continue;
        }
        if (prompt.includes(prefix)) {
          return result;
        }
      }
      return responses.default ?? 'other:unknown';
    },
  };
}
```

- [ ] **Step 3: Run, verify pass**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/api
npx jest src/admin/feedback/fakeLlm.spec.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/admin/feedback/llmAdapter.ts packages/api/src/admin/feedback/fakeLlm.ts packages/api/src/admin/feedback/fakeLlm.spec.ts
git commit -m "feat(feedback-insights): LLM adapter interface + fake for tests"
```

---

## Task 5: `classifyOne` pure function

**Files:**
- Create: `packages/api/src/admin/feedback/classifyOne.ts`
- Test: `packages/api/src/admin/feedback/classifyOne.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { classifyOne } from './classifyOne';
import { buildFakeLlm } from './fakeLlm';

const knownKeys = ['budget_ministries', 'takanon_sections', 'ethics'];

describe('classifyOne', () => {
  it('hits taxonomy when keyword matches', async () => {
    const llm = buildFakeLlm({ default: 'other:unmapped' });
    const result = await classifyOne(
      { userText: 'מה תקציב משרד החינוך?', knownKeys },
      { llm },
    );
    expect(result).toEqual({ topic: 'budget_ministries', source: 'taxonomy' });
  });

  it('falls back to LLM when taxonomy misses', async () => {
    const llm = buildFakeLlm({ 'סקירה': 'takanon_sections' });
    const result = await classifyOne(
      { userText: 'סקירה של הכנסת', knownKeys },
      { llm },
    );
    expect(result).toEqual({ topic: 'takanon_sections', source: 'llm' });
  });

  it('preserves other:<label> from LLM', async () => {
    const llm = buildFakeLlm({ default: 'other:meta_question' });
    const result = await classifyOne(
      { userText: 'בינה מלאכותית', knownKeys },
      { llm },
    );
    expect(result).toEqual({ topic: 'other:meta_question', source: 'llm' });
  });

  it('marks LLM garbage as llm-invalid', async () => {
    const llm = buildFakeLlm({ default: 'this is not a valid key' });
    const result = await classifyOne(
      { userText: 'שאלה כלשהי', knownKeys },
      { llm },
    );
    expect(result).toEqual({
      topic: 'unknown',
      source: 'llm-invalid',
      rawLlmResponse: 'this is not a valid key',
    });
  });

  it('returns unknown when user text is empty', async () => {
    const llm = buildFakeLlm({});
    const result = await classifyOne(
      { userText: '', knownKeys },
      { llm },
    );
    expect(result).toEqual({ topic: 'unknown', source: 'taxonomy' });
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npx jest src/admin/feedback/classifyOne.spec.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `classifyOne`**

```ts
import type { LlmAdapter } from './llmAdapter';
import { matchTaxonomy } from './taxonomy';

export type ClassificationSource =
  | 'taxonomy'
  | 'llm'
  | 'llm-invalid'
  | 'taxonomy-retroactive';

export interface ClassificationResult {
  topic: string;
  source: ClassificationSource;
  rawLlmResponse?: string;
}

export interface ClassifyOneInput {
  userText: string;
  knownKeys: string[];
}

export interface ClassifyOneDeps {
  llm: LlmAdapter;
}

export async function classifyOne(
  input: ClassifyOneInput,
  deps: ClassifyOneDeps,
): Promise<ClassificationResult> {
  const { userText, knownKeys } = input;
  if (!userText?.trim()) {
    return { topic: 'unknown', source: 'taxonomy' };
  }
  const taxonomyHit = matchTaxonomy(userText);
  if (taxonomyHit) {
    return { topic: taxonomyHit, source: 'taxonomy' };
  }
  const raw = await deps.llm.classify(userText, knownKeys);
  if (knownKeys.includes(raw)) {
    return { topic: raw, source: 'llm' };
  }
  if (raw.startsWith('other:') && raw.length > 6) {
    return { topic: raw, source: 'llm' };
  }
  return { topic: 'unknown', source: 'llm-invalid', rawLlmResponse: raw };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx jest src/admin/feedback/classifyOne.spec.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/admin/feedback/classifyOne.ts packages/api/src/admin/feedback/classifyOne.spec.ts
git commit -m "feat(feedback-insights): classifyOne pure fn (taxonomy→LLM fallback)"
```

---

## Task 6: `classify-feedback-topics.js` CLI + integration test

**Files:**
- Create: `scripts/classify-feedback-topics.js`
- Create: `scripts/feedback-topics/runner.js` (shared core so both CLI and test can call it)
- Test: `scripts/feedback-topics/runner.spec.js`

The spec wants the CLI to accept `--dry-run`, `--message-id`, `--since`, `--limit`, `--mongo-uri`, `--llm=fake`. Extract the work into `runner.js` so tests exercise the real Mongo path without spawning a child process.

- [ ] **Step 1: Write the failing integration test** (`scripts/feedback-topics/runner.spec.js`)

```js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { messageSchema } = require('@librechat/data-schemas');
const { run } = require('./runner');
const { buildFakeLlm } = require('../../packages/api/src/admin/feedback/fakeLlm');

describe('classify-feedback-topics runner', () => {
  let mem;
  let Message;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageRunnerTest', messageSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
  });

  async function seedPair(userText, withFeedback) {
    const userMsg = await Message.create({
      messageId: `u-${Math.random()}`,
      conversationId: 'c1',
      user: 'u1',
      isCreatedByUser: true,
      text: userText,
      parentMessageId: null,
    });
    const assistantMsg = await Message.create({
      messageId: `a-${Math.random()}`,
      conversationId: 'c1',
      user: 'u1',
      isCreatedByUser: false,
      text: 'answer',
      parentMessageId: userMsg.messageId,
      feedback: withFeedback ? { rating: 'thumbsUp' } : undefined,
    });
    return { userMsg, assistantMsg };
  }

  it('classifies feedback messages via taxonomy', async () => {
    const pair = await seedPair('מה תקציב משרד החינוך?', true);
    const stats = await run({
      Message,
      llm: buildFakeLlm({ default: 'other:unmapped' }),
      limit: 100,
      dryRun: false,
    });
    expect(stats.processed).toBe(1);
    expect(stats.taxonomyHits).toBe(1);
    const reloaded = await Message.findById(pair.assistantMsg._id).lean();
    expect(reloaded.feedback.topic).toBe('budget_ministries');
    expect(reloaded.feedback.topicSource).toBe('taxonomy');
  });

  it('skips messages without feedback', async () => {
    await seedPair('שאלה בלי משוב', false);
    const stats = await run({
      Message,
      llm: buildFakeLlm({ default: 'other:none' }),
      limit: 100,
      dryRun: false,
    });
    expect(stats.processed).toBe(0);
  });

  it('is idempotent — second run is a no-op', async () => {
    await seedPair('מה תקציב משרד החינוך?', true);
    const llm = buildFakeLlm({ default: 'other:unmapped' });
    const first = await run({ Message, llm, limit: 100, dryRun: false });
    const second = await run({ Message, llm, limit: 100, dryRun: false });
    expect(first.processed).toBe(1);
    expect(second.processed).toBe(0);
  });

  it('dry-run does not write', async () => {
    const pair = await seedPair('מה תקציב משרד החינוך?', true);
    await run({
      Message,
      llm: buildFakeLlm({ default: 'other:unmapped' }),
      limit: 100,
      dryRun: true,
    });
    const reloaded = await Message.findById(pair.assistantMsg._id).lean();
    expect(reloaded.feedback.topic).toBeUndefined();
  });

  it('honors --limit cap', async () => {
    await seedPair('מה תקציב משרד החינוך?', true);
    await seedPair('סעיף 106 לתקנון', true);
    const stats = await run({
      Message,
      llm: buildFakeLlm({ default: 'other:unmapped' }),
      limit: 1,
      dryRun: false,
    });
    expect(stats.processed).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npx jest scripts/feedback-topics/runner.spec.js
```
Expected: FAIL — `./runner` not found.

- [ ] **Step 3: Implement `scripts/feedback-topics/runner.js`**

```js
const { classifyOne } = require('../../packages/api/dist/admin/feedback/classifyOne');
const { initialTaxonomy } = require('../../packages/api/dist/admin/feedback/taxonomy');

const KNOWN_KEYS = initialTaxonomy.map((entry) => entry.key);

async function run({ Message, llm, limit, dryRun, sleep = 3000 }) {
  const filter = {
    isCreatedByUser: false,
    feedback: { $exists: true },
    'feedback.topic': { $exists: false },
  };
  const cursor = Message.find(filter).limit(limit).cursor();
  const stats = { processed: 0, taxonomyHits: 0, llmCalls: 0, errors: 0 };
  for await (const msg of cursor) {
    try {
      const userText = await resolveUserText(Message, msg);
      const { topic, source, rawLlmResponse } = await classifyOne(
        { userText, knownKeys: KNOWN_KEYS },
        { llm },
      );
      if (source === 'taxonomy') {
        stats.taxonomyHits += 1;
      } else {
        stats.llmCalls += 1;
      }
      if (!dryRun) {
        await Message.updateOne(
          { _id: msg._id },
          {
            $set: {
              'feedback.topic': topic,
              'feedback.topicSource': source,
              'feedback.topicClassifiedAt': new Date(),
            },
          },
        );
      }
      stats.processed += 1;
      logJson({
        level: 'info',
        stage: 'classify',
        msgId: msg.messageId,
        topic,
        source,
        rawLlmResponse,
      });
    } catch (error) {
      stats.errors += 1;
      logJson({
        level: 'error',
        stage: 'classify',
        msgId: msg.messageId,
        error: error.message,
      });
    }
  }
  return stats;
}

async function resolveUserText(Message, assistantMsg) {
  if (!assistantMsg.parentMessageId) {
    return '';
  }
  const parent = await Message.findOne({
    messageId: assistantMsg.parentMessageId,
  }).lean();
  if (!parent) {
    return '';
  }
  if (typeof parent.text === 'string' && parent.text.trim().length > 0) {
    return parent.text;
  }
  if (Array.isArray(parent.content)) {
    return parent.content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return '';
}

function logJson(obj) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...obj })}\n`);
}

module.exports = { run };
```

Note: the `require(...packages/api/dist/...)` assumes the `packages/api` TS has been built. In tests, Jest may need the `packages/api` source path — adjust Jest's `moduleNameMapper` for `@librechat/api` if the workspace doesn't already handle it. If the test import in Step 1 (`const { buildFakeLlm } = require('../../packages/api/src/admin/feedback/fakeLlm');`) fails because the workspace compiles only `dist`, use ts-jest or point the spec at the compiled path. The project already uses ts-jest for data-schemas; replicate that config here if needed.

- [ ] **Step 4: Write the CLI shim** (`scripts/classify-feedback-topics.js`)

```js
#!/usr/bin/env node
const path = require('path');
const mongoose = require('mongoose');
const { messageSchema } = require('@librechat/data-schemas');
const { run } = require('./feedback-topics/runner');
const { buildFakeLlm } = require(path.join(
  __dirname, '..', 'packages', 'api', 'dist', 'admin', 'feedback', 'fakeLlm',
));
const { buildOpenAiLlm } = require(path.join(
  __dirname, '..', 'packages', 'api', 'dist', 'admin', 'feedback', 'llmAdapter',
));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri =
    args['mongo-uri'] || process.env.MONGO_URI || 'mongodb://mongodb:27017/LibreChat';
  const provider = args.llm || process.env.LLM_PROVIDER || 'openai';
  const limit = Number(args.limit) || 500;
  const dryRun = Boolean(args['dry-run']);

  const llm =
    provider === 'fake'
      ? buildFakeLlm({ default: 'other:unknown' })
      : buildOpenAiLlm(process.env.OPENAI_API_KEY || '');

  await mongoose.connect(mongoUri);
  const Message = mongoose.model('Message', messageSchema);
  try {
    const stats = await run({ Message, llm, limit, dryRun });
    console.log(JSON.stringify({ stage: 'done', ...stats }));
    process.exit(stats.errors > 0 ? 2 : 0);
  } finally {
    await mongoose.disconnect();
  }
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=');
    out[key] = value === undefined ? true : value;
  }
  return out;
}

main().catch((error) => {
  console.error(JSON.stringify({ stage: 'fatal', error: error.message }));
  process.exit(1);
});
```

- [ ] **Step 5: Build packages/api so the dist path resolves**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npm run build:data-provider
npm run --workspace=packages/api build
```
Expected: Both succeed. If `packages/api` has no `build` script, check its `package.json` and use whatever it exposes (usually `tsc`).

- [ ] **Step 6: Run the integration test**

```bash
npx jest scripts/feedback-topics/runner.spec.js
```
Expected: PASS (5 tests).

- [ ] **Step 7: Manual smoke**

```bash
node scripts/classify-feedback-topics.js --mongo-uri=mongodb://localhost:27017/LibreChat-test --llm=fake --limit=5 --dry-run
```
Expected: exits 0, logs `{"stage":"done", "processed": 0, ...}` (dev Mongo empty).

- [ ] **Step 8: Commit**

```bash
git add scripts/classify-feedback-topics.js scripts/feedback-topics/runner.js scripts/feedback-topics/runner.spec.js
git commit -m "feat(feedback-insights): classify-feedback-topics CLI + runner + integration tests"
```

---

## Task 7: `proposeClusters` pure function + discover CLI

**Files:**
- Create: `packages/api/src/admin/feedback/proposeClusters.ts`
- Test: `packages/api/src/admin/feedback/proposeClusters.spec.ts`
- Create: `scripts/discover-feedback-clusters.js`
- Create: `scripts/feedback-topics/discoverRunner.js`
- Test: `scripts/feedback-topics/discoverRunner.spec.js`

- [ ] **Step 1: Write `proposeClusters` test**

```ts
import { proposeClusters } from './proposeClusters';
import { buildFakeLlm } from './fakeLlm';

describe('proposeClusters', () => {
  it('calls LLM with the unique raw labels and parses JSON response', async () => {
    const rawLabels = ['other:תקציב חינוך', 'other:תקציב בריאות', 'other:מליאה'];
    const llmResponse = JSON.stringify([
      {
        proposedKey: 'sector_budget',
        labelHe: 'תקציב מגזרי',
        labelEn: 'Sector budget',
        rawLabels: ['other:תקציב חינוך', 'other:תקציב בריאות'],
      },
      {
        proposedKey: 'plenary',
        labelHe: 'מליאה',
        labelEn: 'Plenary',
        rawLabels: ['other:מליאה'],
      },
    ]);
    const llm = buildFakeLlm({ default: llmResponse });
    const result = await proposeClusters(rawLabels, { llm });
    expect(result).toHaveLength(2);
    expect(result[0].proposedKey).toBe('sector_budget');
  });

  it('returns [] when input is empty', async () => {
    const llm = buildFakeLlm({});
    expect(await proposeClusters([], { llm })).toEqual([]);
  });

  it('throws on malformed JSON', async () => {
    const llm = buildFakeLlm({ default: 'not json at all' });
    await expect(proposeClusters(['other:x'], { llm })).rejects.toThrow(/malformed/i);
  });
});
```

- [ ] **Step 2: Implement**

`packages/api/src/admin/feedback/proposeClusters.ts`:

```ts
import type { LlmAdapter } from './llmAdapter';

export interface ProposedCluster {
  proposedKey: string;
  labelHe: string;
  labelEn: string;
  rawLabels: string[];
}

export interface ProposeClustersDeps {
  llm: LlmAdapter;
}

export async function proposeClusters(
  rawLabels: string[],
  deps: ProposeClustersDeps,
): Promise<ProposedCluster[]> {
  if (rawLabels.length === 0) {
    return [];
  }
  const unique = Array.from(new Set(rawLabels));
  const prompt = buildPrompt(unique);
  const raw = await deps.llm.classify(prompt, []);
  return parseResponse(raw);
}

function buildPrompt(labels: string[]): string {
  return [
    'Here are Hebrew topic labels from an AI system.',
    'Cluster synonyms into a small canonical set. For each cluster:',
    '- proposedKey: snake_case ASCII, 2-3 words',
    '- labelHe: canonical Hebrew label',
    '- labelEn: short English label',
    '- rawLabels: the raw inputs covered',
    'Return ONLY a JSON array. No prose.',
    '',
    'Labels:',
    ...labels.map((l, i) => `${i + 1}. ${l}`),
  ].join('\n');
}

function parseResponse(raw: string): ProposedCluster[] {
  const trimmed = raw.trim().replace(/^```json/, '').replace(/```$/, '').trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('expected array');
    }
    return parsed.map((item) => validate(item));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`malformed LLM JSON response: ${message}`);
  }
}

function validate(item: unknown): ProposedCluster {
  if (!item || typeof item !== 'object') {
    throw new Error('cluster not an object');
  }
  const obj = item as Record<string, unknown>;
  const proposedKey = obj.proposedKey;
  const labelHe = obj.labelHe;
  const labelEn = obj.labelEn;
  const rawLabels = obj.rawLabels;
  if (
    typeof proposedKey !== 'string' ||
    typeof labelHe !== 'string' ||
    typeof labelEn !== 'string' ||
    !Array.isArray(rawLabels) ||
    !rawLabels.every((l) => typeof l === 'string')
  ) {
    throw new Error('cluster fields missing or wrong type');
  }
  return { proposedKey, labelHe, labelEn, rawLabels };
}
```

- [ ] **Step 3: Run, verify pass**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/api
npx jest src/admin/feedback/proposeClusters.spec.ts
```
Expected: PASS (3 tests).

- [ ] **Step 4: Write discoverRunner + integration test**

`scripts/feedback-topics/discoverRunner.js`:

```js
const { proposeClusters } = require('../../packages/api/dist/admin/feedback/proposeClusters');

async function runDiscover({
  Message,
  PendingTopic,
  llm,
  sinceDays = 7,
  dryRun = false,
}) {
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await Message.find({
    'feedback.topicSource': 'llm',
    'feedback.topic': { $regex: /^other:/ },
    'feedback.topicClassifiedAt': { $gte: sinceDate },
  }).select('messageId feedback.topic').lean();

  const byLabel = new Map();
  for (const row of rows) {
    const label = row.feedback.topic;
    const list = byLabel.get(label) ?? [];
    list.push(row.messageId);
    byLabel.set(label, list);
  }
  const rawLabels = Array.from(byLabel.keys());
  if (rawLabels.length === 0) {
    return { proposals: 0, status: 'no-new-labels' };
  }
  const proposals = await proposeClusters(rawLabels, { llm });
  if (!dryRun) {
    for (const proposal of proposals) {
      const exampleMessageIds = proposal.rawLabels
        .flatMap((label) => byLabel.get(label) ?? [])
        .slice(0, 5);
      await PendingTopic.create({
        proposedKey: proposal.proposedKey,
        labelHe: proposal.labelHe,
        labelEn: proposal.labelEn,
        rawLabels: proposal.rawLabels,
        exampleMessageIds,
        status: 'pending',
      });
    }
  }
  return { proposals: proposals.length, status: 'ok' };
}

module.exports = { runDiscover };
```

`scripts/feedback-topics/discoverRunner.spec.js`:

```js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  messageSchema,
  feedbackTopicPendingSchema,
} = require('@librechat/data-schemas');
const { runDiscover } = require('./discoverRunner');
const { buildFakeLlm } = require('../../packages/api/src/admin/feedback/fakeLlm');

describe('discover runner', () => {
  let mem;
  let Message;
  let PendingTopic;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageDiscover', messageSchema);
    PendingTopic = mongoose.model('PendingDiscover', feedbackTopicPendingSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
    await PendingTopic.deleteMany({});
  });

  it('proposes clusters and writes to PendingTopic', async () => {
    await Message.create({
      messageId: 'a1', conversationId: 'c', user: 'u',
      isCreatedByUser: false,
      feedback: {
        rating: 'thumbsDown', topic: 'other:תקציב חינוך',
        topicSource: 'llm', topicClassifiedAt: new Date(),
      },
    });
    const llm = buildFakeLlm({
      default: JSON.stringify([{
        proposedKey: 'sector_budget',
        labelHe: 'תקציב מגזרי',
        labelEn: 'Sector budget',
        rawLabels: ['other:תקציב חינוך'],
      }]),
    });
    const result = await runDiscover({ Message, PendingTopic, llm });
    expect(result).toEqual({ proposals: 1, status: 'ok' });
    const row = await PendingTopic.findOne({ proposedKey: 'sector_budget' }).lean();
    expect(row).toBeTruthy();
    expect(row.exampleMessageIds).toEqual(['a1']);
  });

  it('returns no-new-labels when nothing matches', async () => {
    const llm = buildFakeLlm({});
    const result = await runDiscover({ Message, PendingTopic, llm });
    expect(result.status).toBe('no-new-labels');
  });
});
```

- [ ] **Step 5: Write CLI shim** (`scripts/discover-feedback-clusters.js`)

```js
#!/usr/bin/env node
const mongoose = require('mongoose');
const {
  messageSchema,
  feedbackTopicPendingSchema,
} = require('@librechat/data-schemas');
const { runDiscover } = require('./feedback-topics/discoverRunner');
const {
  buildFakeLlm,
} = require('../packages/api/dist/admin/feedback/fakeLlm');
const {
  buildOpenAiLlm,
} = require('../packages/api/dist/admin/feedback/llmAdapter');

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    }),
  );
  const mongoUri = args['mongo-uri'] || process.env.MONGO_URI;
  const llm = args.llm === 'fake'
    ? buildFakeLlm({ default: '[]' })
    : buildOpenAiLlm(process.env.OPENAI_API_KEY || '');
  await mongoose.connect(mongoUri);
  const Message = mongoose.model('Message', messageSchema);
  const PendingTopic = mongoose.model(
    'FeedbackTopicPending',
    feedbackTopicPendingSchema,
  );
  try {
    const result = await runDiscover({
      Message,
      PendingTopic,
      llm,
      dryRun: Boolean(args['dry-run']),
    });
    console.log(JSON.stringify({ stage: 'done', ...result }));
    process.exit(0);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ stage: 'fatal', error: error.message }));
  process.exit(1);
});
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npx jest scripts/feedback-topics/discoverRunner.spec.js
```
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/admin/feedback/proposeClusters.ts packages/api/src/admin/feedback/proposeClusters.spec.ts scripts/discover-feedback-clusters.js scripts/feedback-topics/discoverRunner.js scripts/feedback-topics/discoverRunner.spec.js
git commit -m "feat(feedback-insights): proposeClusters + discover-feedback-clusters CLI"
```

---

## Task 8: `FeedbackAnalytics` service — overview aggregation

**Files:**
- Create: `packages/api/src/admin/feedback/FeedbackAnalytics.ts`
- Test: `packages/api/src/admin/feedback/FeedbackAnalytics.spec.ts`

Uses a single `$facet` aggregation so one Mongo roundtrip returns kpis + timeSeries + byTopic + byTool.

- [ ] **Step 1: Write the test**

```ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { messageSchema } from '@librechat/data-schemas';
import { aggregateOverview } from './FeedbackAnalytics';

describe('FeedbackAnalytics.aggregateOverview', () => {
  let mem: MongoMemoryServer;
  let Message: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageOverview', messageSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
  });

  async function seed(n: number, overrides: Partial<Record<string, unknown>> = {}) {
    for (let i = 0; i < n; i += 1) {
      await Message.create({
        messageId: `m${i}-${Math.random()}`,
        conversationId: 'c',
        user: 'u',
        isCreatedByUser: false,
        endpoint: 'agents',
        feedback: {
          rating: i % 3 === 0 ? 'thumbsDown' : 'thumbsUp',
          topic: 'budget_ministries',
          topicSource: 'taxonomy',
        },
        createdAt: new Date('2026-04-18T10:00:00Z'),
        ...overrides,
      });
    }
  }

  it('reports zeros on empty collection', async () => {
    const result = await aggregateOverview({ Message });
    expect(result.kpis.total).toBe(0);
    expect(result.kpis.withFeedback).toBe(0);
    expect(result.byTopic).toEqual([]);
    expect(result.byTool).toEqual([]);
  });

  it('computes totals + positive %', async () => {
    await seed(6);
    const result = await aggregateOverview({ Message });
    expect(result.kpis.total).toBe(6);
    expect(result.kpis.withFeedback).toBe(6);
    expect(result.kpis.thumbsUp).toBe(4);
    expect(result.kpis.thumbsDown).toBe(2);
    expect(result.kpis.positivePct).toBeCloseTo((4 / 6) * 100, 1);
  });

  it('groups by topic', async () => {
    await seed(3);
    await seed(2, { feedback: { rating: 'thumbsDown', topic: 'ethics' } });
    const result = await aggregateOverview({ Message });
    const topics = result.byTopic.map((t) => t.topic).sort();
    expect(topics).toEqual(['budget_ministries', 'ethics']);
  });

  it('honors since/until filter', async () => {
    await seed(3);
    await seed(2, { createdAt: new Date('2024-01-01T00:00:00Z') });
    const result = await aggregateOverview({
      Message,
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(result.kpis.total).toBe(3);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import type { Model } from 'mongoose';

export interface OverviewFilter {
  Message: Model<unknown>;
  since?: Date;
  until?: Date;
  endpoint?: string;
  topic?: string;
  tag?: string;
}

export interface Kpis {
  total: number;
  withFeedback: number;
  feedbackRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  positivePct: number | null;
}

export interface TimeSeriesPoint {
  date: string;
  total: number;
  withFeedback: number;
  up: number;
  down: number;
}

export interface TopicRow {
  topic: string;
  total: number;
  withFeedback: number;
  positivePct: number | null;
  lastThumbsDownAt: Date | null;
}

export interface ToolRow {
  toolName: string;
  total: number;
  thumbsDown: number;
}

export interface OverviewResponse {
  range: { since: Date | null; until: Date | null };
  kpis: Kpis;
  timeSeries: TimeSeriesPoint[];
  byTopic: TopicRow[];
  byTool: ToolRow[];
}

export async function aggregateOverview(
  filter: OverviewFilter,
): Promise<OverviewResponse> {
  const match: Record<string, unknown> = { isCreatedByUser: false };
  if (filter.endpoint) {
    match.endpoint = filter.endpoint;
  }
  if (filter.topic) {
    match['feedback.topic'] = filter.topic;
  }
  if (filter.tag) {
    match['feedback.tag.key'] = filter.tag;
  }
  if (filter.since || filter.until) {
    const range: Record<string, Date> = {};
    if (filter.since) range.$gte = filter.since;
    if (filter.until) range.$lt = filter.until;
    match.createdAt = range;
  }

  const [row] = await filter.Message.aggregate([
    { $match: match },
    {
      $facet: {
        kpis: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              withFeedback: {
                $sum: { $cond: [{ $ifNull: ['$feedback', false] }, 1, 0] },
              },
              thumbsUp: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsUp'] }, 1, 0] },
              },
              thumbsDown: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, 1, 0] },
              },
            },
          },
        ],
        timeSeries: [
          { $match: { feedback: { $exists: true } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              total: { $sum: 1 },
              withFeedback: { $sum: 1 },
              up: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsUp'] }, 1, 0] },
              },
              down: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, 1, 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byTopic: [
          { $match: { 'feedback.topic': { $exists: true } } },
          {
            $group: {
              _id: '$feedback.topic',
              total: { $sum: 1 },
              withFeedback: { $sum: 1 },
              thumbsUp: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsUp'] }, 1, 0] },
              },
              thumbsDown: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, 1, 0] },
              },
              lastThumbsDownAt: {
                $max: {
                  $cond: [
                    { $eq: ['$feedback.rating', 'thumbsDown'] },
                    '$createdAt',
                    null,
                  ],
                },
              },
            },
          },
          { $sort: { total: -1 } },
        ],
        byTool: [
          { $match: { content: { $elemMatch: { type: 'tool_call' } } } },
          { $unwind: '$content' },
          { $match: { 'content.type': 'tool_call' } },
          {
            $group: {
              _id: '$content.tool_call.name',
              total: { $sum: 1 },
              thumbsDown: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, 1, 0] },
              },
            },
          },
          { $sort: { thumbsDown: -1 } },
          { $limit: 10 },
        ],
      },
    },
  ]);

  const kpisRaw = (row?.kpis?.[0] ?? {
    total: 0, withFeedback: 0, thumbsUp: 0, thumbsDown: 0,
  }) as Pick<Kpis, 'total' | 'withFeedback' | 'thumbsUp' | 'thumbsDown'>;
  const feedbackRate = kpisRaw.total > 0
    ? Number(((kpisRaw.withFeedback / kpisRaw.total) * 100).toFixed(2))
    : null;
  const positivePct = kpisRaw.withFeedback > 0
    ? Number(((kpisRaw.thumbsUp / kpisRaw.withFeedback) * 100).toFixed(2))
    : null;

  const byTopic: TopicRow[] = (row?.byTopic ?? []).map((t: {
    _id: string; total: number; withFeedback: number;
    thumbsUp: number; thumbsDown: number; lastThumbsDownAt: Date | null;
  }) => ({
    topic: t._id,
    total: t.total,
    withFeedback: t.withFeedback,
    positivePct: t.withFeedback > 0
      ? Number(((t.thumbsUp / t.withFeedback) * 100).toFixed(2))
      : null,
    lastThumbsDownAt: t.lastThumbsDownAt,
  }));

  const byTool: ToolRow[] = (row?.byTool ?? []).map((t: {
    _id: string; total: number; thumbsDown: number;
  }) => ({ toolName: t._id, total: t.total, thumbsDown: t.thumbsDown }));

  const timeSeries: TimeSeriesPoint[] = (row?.timeSeries ?? []).map((p: {
    _id: string; total: number; withFeedback: number; up: number; down: number;
  }) => ({ date: p._id, total: p.total, withFeedback: p.withFeedback, up: p.up, down: p.down }));

  return {
    range: { since: filter.since ?? null, until: filter.until ?? null },
    kpis: { ...kpisRaw, feedbackRate, positivePct },
    timeSeries,
    byTopic,
    byTool,
  };
}
```

- [ ] **Step 3: Run, verify pass**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/api
npx jest src/admin/feedback/FeedbackAnalytics.spec.ts
```
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/admin/feedback/FeedbackAnalytics.ts packages/api/src/admin/feedback/FeedbackAnalytics.spec.ts
git commit -m "feat(feedback-insights): FeedbackAnalytics.aggregateOverview via $facet"
```

---

## Task 9: `FeedbackAnalytics` — drill-down + pending-topic approve

**Files:**
- Modify: `packages/api/src/admin/feedback/FeedbackAnalytics.ts` (add functions)
- Modify: `packages/api/src/admin/feedback/FeedbackAnalytics.spec.ts` (add tests)

- [ ] **Step 1: Add tests**

```ts
// inside the existing describe block

describe('listMessagesByFilter', () => {
  it('paginates drill-down results', async () => {
    for (let i = 0; i < 15; i += 1) {
      await Message.create({
        messageId: `m${i}`, conversationId: 'c', user: 'u',
        isCreatedByUser: false,
        feedback: { rating: 'thumbsDown', topic: 'ethics' },
        createdAt: new Date(Date.now() - i * 60_000),
      });
    }
    const { listMessagesByFilter } = await import('./FeedbackAnalytics');
    const page1 = await listMessagesByFilter({
      Message, topic: 'ethics', rating: 'thumbsDown', pageSize: 10,
    });
    expect(page1.messages).toHaveLength(10);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listMessagesByFilter({
      Message, topic: 'ethics', rating: 'thumbsDown', pageSize: 10,
      cursor: page1.nextCursor!,
    });
    expect(page2.messages).toHaveLength(5);
    expect(page2.nextCursor).toBeNull();
  });
});

describe('approvePendingTopic', () => {
  it('inserts feedbackTopic, optionally rewrites messages, deletes pending', async () => {
    const {
      feedbackTopicSchema, feedbackTopicPendingSchema,
    } = await import('@librechat/data-schemas');
    const Topic = mongoose.model('TopicApprove', feedbackTopicSchema);
    const Pending = mongoose.model('PendingApprove', feedbackTopicPendingSchema);
    await Message.create({
      messageId: 'm-rewrite', conversationId: 'c', user: 'u',
      isCreatedByUser: false,
      feedback: {
        rating: 'thumbsUp', topic: 'other:תקציב חינוך', topicSource: 'llm',
      },
    });
    const pending = await Pending.create({
      proposedKey: 'sector_budget', labelHe: 'תקציב מגזרי', labelEn: 'Sector budget',
      rawLabels: ['other:תקציב חינוך'],
    });
    const { approvePendingTopic } = await import('./FeedbackAnalytics');
    await approvePendingTopic({
      Message, Topic, Pending,
      pendingId: pending._id.toString(),
      rewrite: true,
    });
    const inserted = await Topic.findOne({ key: 'sector_budget' }).lean();
    expect(inserted).toBeTruthy();
    const msg = await Message.findOne({ messageId: 'm-rewrite' }).lean();
    expect(msg?.feedback?.topic).toBe('sector_budget');
    expect(msg?.feedback?.topicSource).toBe('taxonomy-retroactive');
    const stillPending = await Pending.findById(pending._id).lean();
    expect(stillPending).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `listMessagesByFilter` + `approvePendingTopic`**

Append to `FeedbackAnalytics.ts`:

```ts
export interface DrillDownFilter {
  Message: Model<unknown>;
  topic?: string;
  rating?: 'thumbsUp' | 'thumbsDown';
  pageSize?: number;
  cursor?: string;
}

export async function listMessagesByFilter(
  f: DrillDownFilter,
): Promise<{ messages: unknown[]; nextCursor: string | null }> {
  const pageSize = f.pageSize ?? 25;
  const match: Record<string, unknown> = {
    isCreatedByUser: false,
    feedback: { $exists: true },
  };
  if (f.topic) match['feedback.topic'] = f.topic;
  if (f.rating) match['feedback.rating'] = f.rating;
  if (f.cursor) {
    match.createdAt = { $lt: new Date(f.cursor) };
  }
  const messages = await f.Message.find(match)
    .sort({ createdAt: -1 })
    .limit(pageSize + 1)
    .lean();
  let nextCursor: string | null = null;
  if (messages.length > pageSize) {
    messages.pop();
    const last = messages[messages.length - 1] as { createdAt: Date };
    nextCursor = last.createdAt.toISOString();
  }
  return { messages, nextCursor };
}

export interface ApproveInput {
  Message: Model<unknown>;
  Topic: Model<unknown>;
  Pending: Model<unknown>;
  pendingId: string;
  rewrite?: boolean;
  reviewedBy?: string;
}

export async function approvePendingTopic(input: ApproveInput): Promise<void> {
  const pending = await input.Pending.findById(input.pendingId).lean();
  if (!pending) {
    throw new Error('pending topic not found');
  }
  const typed = pending as {
    proposedKey: string; labelHe: string; labelEn: string; rawLabels: string[];
  };
  await input.Topic.create({
    key: typed.proposedKey,
    labelHe: typed.labelHe,
    labelEn: typed.labelEn,
    keywords: [],
    active: true,
    createdBy: input.reviewedBy,
  });
  if (input.rewrite && typed.rawLabels.length > 0) {
    await input.Message.updateMany(
      { 'feedback.topic': { $in: typed.rawLabels } },
      {
        $set: {
          'feedback.topic': typed.proposedKey,
          'feedback.topicSource': 'taxonomy-retroactive',
        },
      },
    );
  }
  await input.Pending.deleteOne({ _id: input.pendingId });
}
```

- [ ] **Step 3: Run**

```bash
npx jest src/admin/feedback/FeedbackAnalytics.spec.ts
```
Expected: PASS (all previous + 2 new).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/admin/feedback/FeedbackAnalytics.ts packages/api/src/admin/feedback/FeedbackAnalytics.spec.ts
git commit -m "feat(feedback-insights): add listMessagesByFilter + approvePendingTopic"
```

---

## Task 10: Barrel export for the admin feedback module

**Files:**
- Create: `packages/api/src/admin/feedback/index.ts`
- Modify: `packages/api/src/index.ts` (add re-export)

- [ ] **Step 1: Write the barrel**

```ts
export { initialTaxonomy, matchTaxonomy } from './taxonomy';
export type { TaxonomyEntry } from './taxonomy';
export { buildOpenAiLlm } from './llmAdapter';
export { buildFakeLlm } from './fakeLlm';
export type { LlmAdapter } from './llmAdapter';
export { classifyOne } from './classifyOne';
export type {
  ClassificationResult,
  ClassificationSource,
} from './classifyOne';
export { proposeClusters } from './proposeClusters';
export type { ProposedCluster } from './proposeClusters';
export {
  aggregateOverview,
  listMessagesByFilter,
  approvePendingTopic,
} from './FeedbackAnalytics';
export type {
  OverviewResponse,
  Kpis,
  TopicRow,
  ToolRow,
  TimeSeriesPoint,
} from './FeedbackAnalytics';
```

Add to the top-level `packages/api/src/index.ts`:

```ts
export * as AdminFeedback from './admin/feedback';
```

- [ ] **Step 2: Rebuild + lint**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npm run --workspace=packages/api build
npx tsc --noEmit --project packages/api/tsconfig.json
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/admin/feedback/index.ts packages/api/src/index.ts
git commit -m "feat(feedback-insights): barrel export AdminFeedback from packages/api"
```

---

## Task 11: JS Express router + thin controllers

**Files:**
- Create: `api/server/routes/admin/feedback.js`
- Create: `api/server/controllers/admin/feedbackController.js`
- Modify: `api/server/index.js` (mount the router at `/api/admin/feedback`)

- [ ] **Step 1: Write the controller**

```js
const { AdminFeedback } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  Message,
  FeedbackTopic,
  FeedbackTopicPending,
} = require('~/db/models');

async function getOverview(req, res) {
  try {
    const { since, until, endpoint, topic, tag } = req.query;
    const filter = {
      Message,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      endpoint,
      topic,
      tag,
    };
    const overview = await AdminFeedback.aggregateOverview(filter);
    const pendingCount = await FeedbackTopicPending.countDocuments({
      status: 'pending',
    });
    res.status(200).json({ ...overview, pendingTopicsCount: pendingCount });
  } catch (error) {
    logger.error('admin feedback overview failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMessages(req, res) {
  try {
    const { topic, rating, cursor, pageSize } = req.query;
    const page = await AdminFeedback.listMessagesByFilter({
      Message,
      topic,
      rating,
      pageSize: pageSize ? Number(pageSize) : undefined,
      cursor,
    });
    res.status(200).json(page);
  } catch (error) {
    logger.error('admin feedback drill-down failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPending(req, res) {
  try {
    const rows = await FeedbackTopicPending.find({ status: 'pending' })
      .sort({ proposedAt: -1 })
      .lean();
    res.status(200).json({ pending: rows });
  } catch (error) {
    logger.error('admin feedback pending list failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function approvePending(req, res) {
  try {
    await AdminFeedback.approvePendingTopic({
      Message,
      Topic: FeedbackTopic,
      Pending: FeedbackTopicPending,
      pendingId: req.params.id,
      rewrite: req.query.rewrite !== 'false',
      reviewedBy: req.user.id,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('admin feedback approve failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function rejectPending(req, res) {
  try {
    await FeedbackTopicPending.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: req.user.id,
        },
      },
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('admin feedback reject failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getOverview,
  getMessages,
  getPending,
  approvePending,
  rejectPending,
};
```

- [ ] **Step 2: Write the router**

```js
const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const checkAdmin = require('~/server/middleware/roles/admin');
const controller = require('~/server/controllers/admin/feedbackController');

const router = express.Router();
router.use(requireJwtAuth, checkAdmin);

router.get('/overview', controller.getOverview);
router.get('/messages', controller.getMessages);
router.get('/pending-topics', controller.getPending);
router.post('/pending-topics/:id/approve', controller.approvePending);
router.post('/pending-topics/:id/reject', controller.rejectPending);

module.exports = router;
```

- [ ] **Step 3: Register the models in `api/db/models/index.js`**

Look in that file (grep for the existing `Message` export). Add:

```js
const { feedbackTopicSchema, feedbackTopicPendingSchema } = require('@librechat/data-schemas');
const FeedbackTopic = mongoose.models.FeedbackTopic ||
  mongoose.model('FeedbackTopic', feedbackTopicSchema);
const FeedbackTopicPending = mongoose.models.FeedbackTopicPending ||
  mongoose.model('FeedbackTopicPending', feedbackTopicPendingSchema);

module.exports = { ..., FeedbackTopic, FeedbackTopicPending };
```

(Match the existing module.exports pattern in that file.)

- [ ] **Step 4: Mount the router**

Find where other routers are mounted in `api/server/index.js` (grep for `/api/messages` or similar) and add next to them:

```js
app.use('/api/admin/feedback', require('./routes/admin/feedback'));
```

- [ ] **Step 5: Write the integration test** (`api/test/admin.feedback.spec.js`)

```js
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let app;
let mem;
let adminToken;
let userToken;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  process.env.MONGO_URI = mem.getUri();
  process.env.JWT_SECRET = 'testsecret';
  process.env.JWT_REFRESH_SECRET = 'testsecret2';
  process.env.CREDS_KEY = '0'.repeat(64);
  process.env.CREDS_IV = '0'.repeat(32);
  app = require('~/app');
  await mongoose.connect(mem.getUri());
  adminToken = await signJwt({ id: 'admin1', role: 'ADMIN' });
  userToken = await signJwt({ id: 'user1', role: 'USER' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

function signJwt(payload) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m' });
}

describe('GET /api/admin/feedback/overview', () => {
  it('403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/feedback/overview')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('200 with empty data for admin on empty DB', async () => {
    const res = await request(app)
      .get('/api/admin/feedback/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.total).toBe(0);
    expect(res.body.pendingTopicsCount).toBe(0);
  });
});
```

Note: the `app = require('~/app')` path may differ — check how existing `api/test/*.spec.js` files boot the Express app. Mirror that pattern.

- [ ] **Step 6: Run the test**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/api
npx jest test/admin.feedback.spec.js
```
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add api/server/routes/admin/feedback.js api/server/controllers/admin/feedbackController.js api/server/index.js api/db/models/index.js api/test/admin.feedback.spec.js
git commit -m "feat(feedback-insights): admin-only /api/admin/feedback routes"
```

---

## Task 12: data-provider — endpoints, types, service, keys

**Files:**
- Modify: `packages/data-provider/src/api-endpoints.ts`
- Modify: `packages/data-provider/src/types/queries.ts`
- Modify: `packages/data-provider/src/data-service.ts`
- Modify: `packages/data-provider/src/keys.ts`
- Modify: `packages/data-provider/src/index.ts`

- [ ] **Step 1: Add types**

In `packages/data-provider/src/types/queries.ts`, add:

```ts
export interface AdminFeedbackOverviewFilter {
  since?: string;
  until?: string;
  endpoint?: string;
  topic?: string;
  tag?: string;
}

export interface AdminFeedbackKpis {
  total: number;
  withFeedback: number;
  feedbackRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  positivePct: number | null;
}

export interface AdminFeedbackTopicRow {
  topic: string;
  total: number;
  withFeedback: number;
  positivePct: number | null;
  lastThumbsDownAt: string | null;
}

export interface AdminFeedbackToolRow {
  toolName: string;
  total: number;
  thumbsDown: number;
}

export interface AdminFeedbackTimePoint {
  date: string;
  total: number;
  withFeedback: number;
  up: number;
  down: number;
}

export interface AdminFeedbackOverview {
  range: { since: string | null; until: string | null };
  kpis: AdminFeedbackKpis;
  timeSeries: AdminFeedbackTimePoint[];
  byTopic: AdminFeedbackTopicRow[];
  byTool: AdminFeedbackToolRow[];
  pendingTopicsCount: number;
}

export interface AdminFeedbackDrillDownFilter {
  topic?: string;
  rating?: 'thumbsUp' | 'thumbsDown';
  pageSize?: number;
  cursor?: string;
}

export interface AdminFeedbackDrillDownResponse {
  messages: unknown[];
  nextCursor: string | null;
}

export interface AdminFeedbackPending {
  _id: string;
  proposedKey: string;
  labelHe: string;
  labelEn: string;
  rawLabels: string[];
  exampleMessageIds: string[];
  status: 'pending' | 'rejected';
  proposedAt: string;
}

export interface AdminFeedbackPendingResponse {
  pending: AdminFeedbackPending[];
}
```

Replace `unknown` in `AdminFeedbackDrillDownResponse.messages` with a reused message type if one exists (check `packages/data-provider/src/types.ts` for `TMessage`).

- [ ] **Step 2: Add endpoints** (`packages/data-provider/src/api-endpoints.ts`)

```ts
export const adminFeedbackOverview = (params: AdminFeedbackOverviewFilter): string => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return `/api/admin/feedback/overview${suffix}`;
};

export const adminFeedbackMessages = (
  params: AdminFeedbackDrillDownFilter,
): string => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return `/api/admin/feedback/messages${suffix}`;
};

export const adminFeedbackPendingList = (): string =>
  '/api/admin/feedback/pending-topics';

export const adminFeedbackPendingApprove = (id: string): string =>
  `/api/admin/feedback/pending-topics/${encodeURIComponent(id)}/approve`;

export const adminFeedbackPendingReject = (id: string): string =>
  `/api/admin/feedback/pending-topics/${encodeURIComponent(id)}/reject`;
```

Add matching `import type` lines at top.

- [ ] **Step 3: Add data-service functions**

In `packages/data-provider/src/data-service.ts` (match the existing pattern — likely uses a shared `request` helper):

```ts
export const getAdminFeedbackOverview = (
  params: AdminFeedbackOverviewFilter,
): Promise<AdminFeedbackOverview> =>
  request.get(endpoints.adminFeedbackOverview(params));

export const getAdminFeedbackMessages = (
  params: AdminFeedbackDrillDownFilter,
): Promise<AdminFeedbackDrillDownResponse> =>
  request.get(endpoints.adminFeedbackMessages(params));

export const getAdminFeedbackPending = (): Promise<AdminFeedbackPendingResponse> =>
  request.get(endpoints.adminFeedbackPendingList());

export const approveAdminFeedbackPending = (
  id: string,
  rewrite = true,
): Promise<{ ok: true }> =>
  request.post(
    `${endpoints.adminFeedbackPendingApprove(id)}?rewrite=${rewrite}`,
    {},
  );

export const rejectAdminFeedbackPending = (id: string): Promise<{ ok: true }> =>
  request.post(endpoints.adminFeedbackPendingReject(id), {});
```

- [ ] **Step 4: Add QueryKeys**

In `packages/data-provider/src/keys.ts`:

```ts
export enum QueryKeys {
  // ... existing
  adminFeedbackOverview = 'adminFeedbackOverview',
  adminFeedbackMessages = 'adminFeedbackMessages',
  adminFeedbackPending = 'adminFeedbackPending',
}

export enum MutationKeys {
  // ... existing
  approveAdminFeedbackPending = 'approveAdminFeedbackPending',
  rejectAdminFeedbackPending = 'rejectAdminFeedbackPending',
}
```

- [ ] **Step 5: Re-export in index**

Ensure the new types/functions are exported from `packages/data-provider/src/index.ts` (follow the existing export list pattern).

- [ ] **Step 6: Build**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npm run build:data-provider
```
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/data-provider/src/
git commit -m "feat(feedback-insights): data-provider endpoints, types, service for admin feedback"
```

---

## Task 13: React Query hooks under `client/src/data-provider/AdminFeedback/`

**Files:**
- Create: `client/src/data-provider/AdminFeedback/queries.ts`
- Create: `client/src/data-provider/AdminFeedback/index.ts`
- Modify: `client/src/data-provider/index.ts`

- [ ] **Step 1: Write the hooks**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  QueryKeys,
  MutationKeys,
  dataService,
} from 'librechat-data-provider';
import type {
  AdminFeedbackOverviewFilter,
  AdminFeedbackOverview,
  AdminFeedbackDrillDownFilter,
  AdminFeedbackDrillDownResponse,
  AdminFeedbackPendingResponse,
} from 'librechat-data-provider';

export const useAdminFeedbackOverview = (filter: AdminFeedbackOverviewFilter) =>
  useQuery<AdminFeedbackOverview>({
    queryKey: [QueryKeys.adminFeedbackOverview, filter],
    queryFn: () => dataService.getAdminFeedbackOverview(filter),
    staleTime: 5 * 60 * 1000,
  });

export const useAdminFeedbackMessages = (
  filter: AdminFeedbackDrillDownFilter,
  enabled: boolean,
) =>
  useQuery<AdminFeedbackDrillDownResponse>({
    queryKey: [QueryKeys.adminFeedbackMessages, filter],
    queryFn: () => dataService.getAdminFeedbackMessages(filter),
    enabled,
  });

export const useAdminFeedbackPending = () =>
  useQuery<AdminFeedbackPendingResponse>({
    queryKey: [QueryKeys.adminFeedbackPending],
    queryFn: () => dataService.getAdminFeedbackPending(),
  });

export const useApproveAdminFeedbackPending = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [MutationKeys.approveAdminFeedbackPending],
    mutationFn: ({ id, rewrite }: { id: string; rewrite: boolean }) =>
      dataService.approveAdminFeedbackPending(id, rewrite),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QueryKeys.adminFeedbackOverview] });
      qc.invalidateQueries({ queryKey: [QueryKeys.adminFeedbackPending] });
    },
  });
};

export const useRejectAdminFeedbackPending = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [MutationKeys.rejectAdminFeedbackPending],
    mutationFn: (id: string) => dataService.rejectAdminFeedbackPending(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QueryKeys.adminFeedbackPending] });
    },
  });
};
```

- [ ] **Step 2: Barrel**

`client/src/data-provider/AdminFeedback/index.ts`:

```ts
export * from './queries';
```

Append to `client/src/data-provider/index.ts`:

```ts
export * as AdminFeedback from './AdminFeedback';
```

- [ ] **Step 3: Commit**

```bash
git add client/src/data-provider/AdminFeedback/ client/src/data-provider/index.ts
git commit -m "feat(feedback-insights): client react-query hooks for admin feedback"
```

---

## Task 14: Frontend — FilterBar + KpiStrip

**Files:**
- Create: `client/src/components/Admin/Feedback/FilterBar.tsx`
- Create: `client/src/components/Admin/Feedback/KpiStrip.tsx`
- Create: `client/src/components/Admin/Feedback/__tests__/KpiStrip.spec.tsx`
- Modify: `client/src/locales/en/translation.json` (add `com_admin_feedback_*` keys)

- [ ] **Step 1: Add i18n keys**

In `client/src/locales/en/translation.json`, insert (alphabetical order):

```json
  "com_admin_feedback_title": "Feedback insights",
  "com_admin_feedback_filter_date_range": "Date range",
  "com_admin_feedback_filter_endpoint": "Endpoint",
  "com_admin_feedback_filter_tag": "Reason tag",
  "com_admin_feedback_filter_refresh": "Refresh",
  "com_admin_feedback_range_7": "Last 7 days",
  "com_admin_feedback_range_30": "Last 30 days",
  "com_admin_feedback_range_90": "Last 90 days",
  "com_admin_feedback_kpi_total": "Assistant messages",
  "com_admin_feedback_kpi_feedback_rate": "Feedback rate",
  "com_admin_feedback_kpi_positive_pct": "Positive %",
  "com_admin_feedback_kpi_trend": "Δ vs previous",
  "com_admin_feedback_topic": "Topic",
  "com_admin_feedback_topic_last_down": "Last thumbs-down",
  "com_admin_feedback_topic_sparkline": "7-day sparkline",
  "com_admin_feedback_tool_header": "Tool calls",
  "com_admin_feedback_tool_name": "Tool",
  "com_admin_feedback_tool_thumbs_down": "Thumbs-down",
  "com_admin_feedback_pending_header": "Pending topic discoveries",
  "com_admin_feedback_pending_approve": "Approve",
  "com_admin_feedback_pending_reject": "Reject",
  "com_admin_feedback_empty": "No feedback recorded yet",
  "com_admin_feedback_drill_close": "Close",
  "com_admin_feedback_drill_view_in_chat": "View in chat",
  "com_admin_feedback_drill_next_page": "Next page",
```

- [ ] **Step 2: Write `FilterBar.tsx`**

```tsx
import { useLocalize } from '~/hooks';
import type { AdminFeedbackOverviewFilter } from 'librechat-data-provider';

type Props = {
  value: AdminFeedbackOverviewFilter;
  onChange: (next: AdminFeedbackOverviewFilter) => void;
  onRefresh: () => void;
};

const RANGE_OPTIONS: Array<{ days: number; labelKey: Parameters<ReturnType<typeof useLocalize>>[0] }> = [
  { days: 7, labelKey: 'com_admin_feedback_range_7' },
  { days: 30, labelKey: 'com_admin_feedback_range_30' },
  { days: 90, labelKey: 'com_admin_feedback_range_90' },
];

export default function FilterBar({ value, onChange, onRefresh }: Props) {
  const localize = useLocalize();

  const selectRange = (days: number) => {
    const until = new Date();
    const since = new Date(until);
    since.setDate(until.getDate() - days);
    onChange({ ...value, since: since.toISOString(), until: until.toISOString() });
  };

  return (
    <div
      role="toolbar"
      aria-label={localize('com_admin_feedback_filter_date_range')}
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.days}
          type="button"
          onClick={() => selectRange(opt.days)}
          className="rounded-md border border-border-medium px-3 py-1 text-sm"
        >
          {localize(opt.labelKey)}
        </button>
      ))}
      <button
        type="button"
        onClick={onRefresh}
        className="ms-auto rounded-md bg-green-500 px-3 py-1 text-sm text-white"
      >
        {localize('com_admin_feedback_filter_refresh')}
      </button>
    </div>
  );
}
```

(Scope: no endpoint/tag dropdowns in this step — they plug in in a later task if PM wants them. Keeping v1 minimal.)

- [ ] **Step 3: Write `KpiStrip.tsx`**

```tsx
import { useLocalize } from '~/hooks';
import type { AdminFeedbackKpis } from 'librechat-data-provider';

type Props = { kpis: AdminFeedbackKpis };

function fmt(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value}${suffix}`;
}

export default function KpiStrip({ kpis }: Props) {
  const localize = useLocalize();
  const cards: Array<{ labelKey: Parameters<ReturnType<typeof useLocalize>>[0]; value: string }> = [
    { labelKey: 'com_admin_feedback_kpi_total', value: String(kpis.total) },
    { labelKey: 'com_admin_feedback_kpi_feedback_rate', value: fmt(kpis.feedbackRate, '%') },
    { labelKey: 'com_admin_feedback_kpi_positive_pct', value: fmt(kpis.positivePct, '%') },
    { labelKey: 'com_admin_feedback_kpi_trend', value: '—' },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.labelKey}
          className="rounded-lg border border-border-medium p-4"
        >
          <div className="text-xs text-text-secondary">
            {localize(card.labelKey)}
          </div>
          <div className="mt-1 text-2xl font-semibold">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write the component test** (`client/src/components/Admin/Feedback/__tests__/KpiStrip.spec.tsx`)

```tsx
import { render, screen } from 'test/layout-test-utils';
import KpiStrip from '../KpiStrip';

describe('KpiStrip', () => {
  it('renders formatted values', () => {
    render(
      <KpiStrip
        kpis={{
          total: 120,
          withFeedback: 30,
          feedbackRate: 25,
          thumbsUp: 22,
          thumbsDown: 8,
          positivePct: 73.3,
        }}
      />,
    );
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('73.3%')).toBeInTheDocument();
  });

  it('renders em dash for null positivePct (no feedback)', () => {
    render(
      <KpiStrip
        kpis={{
          total: 0,
          withFeedback: 0,
          feedbackRate: null,
          thumbsUp: 0,
          thumbsDown: 0,
          positivePct: null,
        }}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 5: Run the test**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/client
npx jest src/components/Admin/Feedback/__tests__/KpiStrip.spec.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Feedback/FilterBar.tsx client/src/components/Admin/Feedback/KpiStrip.tsx client/src/components/Admin/Feedback/__tests__/KpiStrip.spec.tsx client/src/locales/en/translation.json
git commit -m "feat(feedback-insights): FilterBar + KpiStrip components + i18n keys"
```

---

## Task 15: FeedbackTimeSeries chart

**Files:**
- Create: `client/src/components/Admin/Feedback/FeedbackTimeSeries.tsx`
- Create: `client/src/components/Admin/Feedback/__tests__/FeedbackTimeSeries.spec.tsx`

- [ ] **Step 1: Write the component**

```tsx
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useLocalize } from '~/hooks';
import type { AdminFeedbackTimePoint } from 'librechat-data-provider';

type Props = { points: AdminFeedbackTimePoint[] };

export default function FeedbackTimeSeries({ points }: Props) {
  const localize = useLocalize();
  const series = points.map((p) => ({
    date: p.date,
    feedbackRate: p.total > 0 ? Number(((p.withFeedback / p.total) * 100).toFixed(1)) : 0,
    positivePct: p.withFeedback > 0 ? Number(((p.up / p.withFeedback) * 100).toFixed(1)) : 0,
  }));
  if (series.length === 0) {
    return (
      <div className="mb-6 rounded-lg border border-border-medium p-4 text-center text-sm text-text-secondary">
        {localize('com_admin_feedback_empty')}
      </div>
    );
  }
  return (
    <div className="mb-6 h-64 rounded-lg border border-border-medium p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <XAxis dataKey="date" />
          <YAxis domain={[0, 100]} unit="%" />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="feedbackRate" name={localize('com_admin_feedback_kpi_feedback_rate')} stroke="#10a37f" />
          <Line type="monotone" dataKey="positivePct" name={localize('com_admin_feedback_kpi_positive_pct')} stroke="#818181" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Test**

```tsx
import { render, screen } from 'test/layout-test-utils';
import FeedbackTimeSeries from '../FeedbackTimeSeries';

it('shows empty-state when no points', () => {
  render(<FeedbackTimeSeries points={[]} />);
  expect(screen.getByText(/No feedback recorded yet/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run**

```bash
npx jest src/components/Admin/Feedback/__tests__/FeedbackTimeSeries.spec.tsx
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Admin/Feedback/FeedbackTimeSeries.tsx client/src/components/Admin/Feedback/__tests__/FeedbackTimeSeries.spec.tsx
git commit -m "feat(feedback-insights): FeedbackTimeSeries line chart"
```

---

## Task 16: TopicTable (headline slice) with sparklines

**Files:**
- Create: `client/src/components/Admin/Feedback/TopicTable.tsx`
- Create: `client/src/components/Admin/Feedback/__tests__/TopicTable.spec.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useMemo } from 'react';
import { useLocalize } from '~/hooks';
import type { AdminFeedbackTopicRow } from 'librechat-data-provider';

type Props = {
  rows: AdminFeedbackTopicRow[];
  onSelect: (topic: string) => void;
};

function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points);
  const w = 60;
  const h = 18;
  const step = w / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function TopicTable({ rows, onSelect }: Props) {
  const localize = useLocalize();
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.total - a.total),
    [rows],
  );
  if (sorted.length === 0) {
    return (
      <div className="mb-6 rounded-lg border border-border-medium p-4 text-center text-sm text-text-secondary">
        {localize('com_admin_feedback_empty')}
      </div>
    );
  }
  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-border-medium">
      <table className="w-full text-sm">
        <thead className="bg-surface-tertiary">
          <tr>
            <th className="p-2 text-start">{localize('com_admin_feedback_topic')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_kpi_total')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_kpi_feedback_rate')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_kpi_positive_pct')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_topic_sparkline')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_topic_last_down')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.topic}
              onClick={() => onSelect(row.topic)}
              className="cursor-pointer border-t border-border-medium hover:bg-surface-hover"
            >
              <td className="p-2">{row.topic}</td>
              <td className="p-2 text-end">{row.total}</td>
              <td className="p-2 text-end">
                {row.total > 0 ? Math.round((row.withFeedback / row.total) * 100) : 0}%
              </td>
              <td className="p-2 text-end">
                {row.positivePct === null ? '—' : `${row.positivePct}%`}
              </td>
              <td className="p-2 text-end">
                <Sparkline points={[row.withFeedback]} />
              </td>
              <td className="p-2 text-end">
                {row.lastThumbsDownAt
                  ? new Date(row.lastThumbsDownAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

(The sparkline input is a placeholder single-point array — real 7-day data requires the backend to return per-topic day buckets. We can extend `byTopic` later; for v1 the sparkline renders a single bar as a visual marker. Leaves room for enhancement without blocking the page.)

- [ ] **Step 2: Test**

```tsx
import { render, screen, fireEvent } from 'test/layout-test-utils';
import TopicTable from '../TopicTable';

it('renders rows sorted by total descending, clicks trigger onSelect', () => {
  const onSelect = jest.fn();
  render(
    <TopicTable
      onSelect={onSelect}
      rows={[
        { topic: 'ethics', total: 40, withFeedback: 10, positivePct: 50, lastThumbsDownAt: null },
        { topic: 'budget_ministries', total: 100, withFeedback: 20, positivePct: 80, lastThumbsDownAt: null },
      ]}
    />,
  );
  const rows = screen.getAllByRole('row');
  // First body row is the 100-total one
  expect(rows[1]).toHaveTextContent('budget_ministries');
  fireEvent.click(rows[1]);
  expect(onSelect).toHaveBeenCalledWith('budget_ministries');
});
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/client
npx jest src/components/Admin/Feedback/__tests__/TopicTable.spec.tsx
git add client/src/components/Admin/Feedback/TopicTable.tsx client/src/components/Admin/Feedback/__tests__/TopicTable.spec.tsx
git commit -m "feat(feedback-insights): TopicTable (headline slice)"
```

---

## Task 17: ToolCallChart + PendingTopicsQueue + FeedbackDrillDown

**Files:**
- Create: `client/src/components/Admin/Feedback/ToolCallChart.tsx`
- Create: `client/src/components/Admin/Feedback/PendingTopicsQueue.tsx`
- Create: `client/src/components/Admin/Feedback/FeedbackDrillDown.tsx`

Implement straightforwardly — recharts BarChart for tools, a list with approve/reject buttons for pending, a side sheet using existing `@librechat/client` `Dialog` primitives.

- [ ] **Step 1: Write `ToolCallChart.tsx`**

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useLocalize } from '~/hooks';
import type { AdminFeedbackToolRow } from 'librechat-data-provider';

export default function ToolCallChart({ rows }: { rows: AdminFeedbackToolRow[] }) {
  const localize = useLocalize();
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="mb-6 h-64 rounded-lg border border-border-medium p-4">
      <h3 className="mb-2 text-sm font-medium">
        {localize('com_admin_feedback_tool_header')}
      </h3>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={rows} layout="vertical">
          <XAxis type="number" />
          <YAxis type="category" dataKey="toolName" width={180} />
          <Tooltip />
          <Bar dataKey="thumbsDown" fill="#e53935" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Write `PendingTopicsQueue.tsx`**

```tsx
import { useLocalize } from '~/hooks';
import type { AdminFeedbackPending } from 'librechat-data-provider';

type Props = {
  pending: AdminFeedbackPending[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
};

export default function PendingTopicsQueue({ pending, onApprove, onReject }: Props) {
  const localize = useLocalize();
  if (pending.length === 0) {
    return null;
  }
  return (
    <div className="mb-6 rounded-lg border border-yellow-400/40 bg-yellow-50 p-4 dark:bg-yellow-900/10">
      <h3 className="mb-2 text-sm font-medium">
        {localize('com_admin_feedback_pending_header')}
      </h3>
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p._id} className="flex items-center justify-between gap-3">
            <span>
              <strong>{p.labelHe}</strong> ({p.rawLabels.length} labels,{' '}
              {p.exampleMessageIds.length} example msgs)
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => onApprove(p._id)}
                className="rounded-md bg-green-500 px-3 py-1 text-sm text-white"
              >
                {localize('com_admin_feedback_pending_approve')}
              </button>
              <button
                type="button"
                onClick={() => onReject(p._id)}
                className="rounded-md border border-border-medium px-3 py-1 text-sm"
              >
                {localize('com_admin_feedback_pending_reject')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Write `FeedbackDrillDown.tsx`**

```tsx
import { useLocalize } from '~/hooks';
import type { AdminFeedbackDrillDownResponse } from 'librechat-data-provider';

type Props = {
  topic: string | null;
  data: AdminFeedbackDrillDownResponse | undefined;
  loading: boolean;
  onClose: () => void;
};

export default function FeedbackDrillDown({ topic, data, loading, onClose }: Props) {
  const localize = useLocalize();
  if (!topic) return null;
  return (
    <aside
      role="dialog"
      aria-label={topic}
      className="fixed inset-y-0 end-0 z-40 flex w-full max-w-md flex-col border-s border-border-medium bg-surface-primary shadow-lg"
    >
      <header className="flex items-center justify-between border-b border-border-medium p-4">
        <h2 className="font-medium">{topic}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border-medium px-2 py-1 text-sm"
        >
          {localize('com_admin_feedback_drill_close')}
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {loading && <div className="text-sm text-text-secondary">…</div>}
        {!loading && (data?.messages ?? []).length === 0 && (
          <div className="text-sm text-text-secondary">
            {localize('com_admin_feedback_empty')}
          </div>
        )}
        {(data?.messages ?? []).map((m: { messageId?: string; text?: string; conversationId?: string }) => (
          <article key={m.messageId} className="mb-4 border-b border-border-medium pb-2">
            <p className="text-sm">{(m.text ?? '').slice(0, 500)}</p>
            {m.conversationId && (
              <a
                href={`/c/${m.conversationId}?highlight=${m.messageId}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-green-600 underline"
              >
                {localize('com_admin_feedback_drill_view_in_chat')}
              </a>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Admin/Feedback/ToolCallChart.tsx client/src/components/Admin/Feedback/PendingTopicsQueue.tsx client/src/components/Admin/Feedback/FeedbackDrillDown.tsx
git commit -m "feat(feedback-insights): ToolCallChart, PendingTopicsQueue, FeedbackDrillDown"
```

---

## Task 18: FeedbackDashboard page + route

**Files:**
- Create: `client/src/components/Admin/Feedback/FeedbackDashboard.tsx`
- Create: `client/src/components/Admin/Feedback/index.ts`
- Create: `client/src/components/Admin/Feedback/__tests__/FeedbackDashboard.spec.tsx`
- Modify: `client/src/routes/Root.tsx` (or whichever file registers authenticated routes — grep for `createBrowserRouter` or `RouterProvider`)

- [ ] **Step 1: Write the page**

```tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAdminFeedbackOverview,
  useAdminFeedbackMessages,
  useAdminFeedbackPending,
  useApproveAdminFeedbackPending,
  useRejectAdminFeedbackPending,
} from '~/data-provider/AdminFeedback/queries';
import { useAuthContext, useLocalize } from '~/hooks';
import FilterBar from './FilterBar';
import KpiStrip from './KpiStrip';
import FeedbackTimeSeries from './FeedbackTimeSeries';
import TopicTable from './TopicTable';
import ToolCallChart from './ToolCallChart';
import PendingTopicsQueue from './PendingTopicsQueue';
import FeedbackDrillDown from './FeedbackDrillDown';
import type { AdminFeedbackOverviewFilter } from 'librechat-data-provider';

const INITIAL_DAYS = 30;

export default function FeedbackDashboard() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const initial = useMemo<AdminFeedbackOverviewFilter>(() => {
    const until = new Date();
    const since = new Date(until);
    since.setDate(until.getDate() - INITIAL_DAYS);
    return { since: since.toISOString(), until: until.toISOString() };
  }, []);
  const [filter, setFilter] = useState<AdminFeedbackOverviewFilter>(initial);
  const [drillTopic, setDrillTopic] = useState<string | null>(null);

  if (user?.role !== 'ADMIN') {
    navigate('/c/new', { replace: true });
    return null;
  }

  const overview = useAdminFeedbackOverview(filter);
  const pending = useAdminFeedbackPending();
  const approve = useApproveAdminFeedbackPending();
  const reject = useRejectAdminFeedbackPending();
  const drill = useAdminFeedbackMessages(
    { topic: drillTopic ?? undefined, rating: 'thumbsDown', pageSize: 25 },
    Boolean(drillTopic),
  );

  if (overview.isLoading) {
    return <div className="p-8 text-center">…</div>;
  }
  if (overview.isError || !overview.data) {
    return (
      <div className="p-8 text-center text-red-600">
        {(overview.error as Error | undefined)?.message ?? 'Error'}
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">
        {localize('com_admin_feedback_title')}
      </h1>
      <FilterBar
        value={filter}
        onChange={setFilter}
        onRefresh={() => overview.refetch()}
      />
      <KpiStrip kpis={overview.data.kpis} />
      <FeedbackTimeSeries points={overview.data.timeSeries} />
      <TopicTable rows={overview.data.byTopic} onSelect={setDrillTopic} />
      <ToolCallChart rows={overview.data.byTool} />
      <PendingTopicsQueue
        pending={pending.data?.pending ?? []}
        onApprove={(id) => approve.mutate({ id, rewrite: true })}
        onReject={(id) => reject.mutate(id)}
      />
      <FeedbackDrillDown
        topic={drillTopic}
        data={drill.data}
        loading={drill.isFetching}
        onClose={() => setDrillTopic(null)}
      />
    </main>
  );
}
```

- [ ] **Step 2: Barrel**

`client/src/components/Admin/Feedback/index.ts`:

```ts
export { default as FeedbackDashboard } from './FeedbackDashboard';
```

- [ ] **Step 3: Register route**

Grep the client for the existing route wiring:

```bash
grep -rnE 'createBrowserRouter|<Route ' /Users/amir/Development/anubanu/parlibot/LibreChat/client/src/routes | head -20
```

Add a new `<Route path="d/feedback" element={<FeedbackDashboard />} />` under the authenticated route subtree. Import with `import { FeedbackDashboard } from '~/components/Admin/Feedback';`.

- [ ] **Step 4: Integration test**

```tsx
// client/src/components/Admin/Feedback/__tests__/FeedbackDashboard.spec.tsx
import { render, screen } from 'test/layout-test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FeedbackDashboard } from '../';

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { role: 'ADMIN' } }),
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider/AdminFeedback/queries', () => ({
  useAdminFeedbackOverview: () => ({
    isLoading: false,
    isError: false,
    data: {
      range: { since: null, until: null },
      kpis: { total: 10, withFeedback: 5, feedbackRate: 50, thumbsUp: 4, thumbsDown: 1, positivePct: 80 },
      timeSeries: [],
      byTopic: [{ topic: 'budget_ministries', total: 5, withFeedback: 2, positivePct: 100, lastThumbsDownAt: null }],
      byTool: [],
      pendingTopicsCount: 0,
    },
    refetch: jest.fn(),
  }),
  useAdminFeedbackPending: () => ({ data: { pending: [] } }),
  useAdminFeedbackMessages: () => ({ data: undefined, isFetching: false }),
  useApproveAdminFeedbackPending: () => ({ mutate: jest.fn() }),
  useRejectAdminFeedbackPending: () => ({ mutate: jest.fn() }),
}));

it('renders the headline topic and KPI values', () => {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FeedbackDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('budget_ministries')).toBeInTheDocument();
  expect(screen.getByText('10')).toBeInTheDocument();
  expect(screen.getByText('80%')).toBeInTheDocument();
});
```

- [ ] **Step 5: Run + commit**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/client
npx jest src/components/Admin/Feedback/__tests__/FeedbackDashboard.spec.tsx
git add client/src/components/Admin/Feedback/FeedbackDashboard.tsx client/src/components/Admin/Feedback/index.ts client/src/components/Admin/Feedback/__tests__/FeedbackDashboard.spec.tsx client/src/routes/
git commit -m "feat(feedback-insights): FeedbackDashboard page + /d/feedback route"
```

---

## Task 19: Terragrunt — EventBridge rules for classify + discover

**Files:**
- Modify: `LibreChat/infra/envs/staging/main.tf`
- Modify: `LibreChat/infra/envs/staging/outputs.tf`

- [ ] **Step 1: Add the IAM role + event rules**

Append to `main.tf`:

```hcl
data "aws_iam_policy_document" "feedback_scheduled_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "feedback_scheduled" {
  name               = "librechat-${var.environment}-feedback-scheduled"
  assume_role_policy = data.aws_iam_policy_document.feedback_scheduled_trust.json
}

data "aws_iam_policy_document" "feedback_scheduled_run_task" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = [module.librechat.task_definition_arn]
  }
  statement {
    actions   = ["iam:PassRole"]
    resources = [
      module.librechat.task_role_arn,
      module.librechat.task_execution_role_arn,
    ]
  }
}

resource "aws_iam_role_policy" "feedback_scheduled_run_task" {
  role   = aws_iam_role.feedback_scheduled.id
  policy = data.aws_iam_policy_document.feedback_scheduled_run_task.json
}

resource "aws_cloudwatch_event_rule" "feedback_classify" {
  name                = "librechat-${var.environment}-feedback-classify"
  schedule_expression = "cron(0 2 * * ? *)"
}

resource "aws_cloudwatch_event_target" "feedback_classify" {
  rule     = aws_cloudwatch_event_rule.feedback_classify.name
  arn      = module.librechat.cluster_arn
  role_arn = aws_iam_role.feedback_scheduled.arn
  ecs_target {
    task_definition_arn = module.librechat.task_definition_arn
    launch_type         = "FARGATE"
    network_configuration {
      subnets          = module.librechat.private_subnet_ids
      security_groups  = [module.librechat.api_security_group_id]
      assign_public_ip = false
    }
  }
  input = jsonencode({
    containerOverrides = [{
      name    = "api"
      command = ["node", "scripts/classify-feedback-topics.js"]
    }]
  })
}

resource "aws_cloudwatch_event_rule" "feedback_discover" {
  name                = "librechat-${var.environment}-feedback-discover"
  schedule_expression = "cron(0 3 ? * SUN *)"
}

resource "aws_cloudwatch_event_target" "feedback_discover" {
  rule     = aws_cloudwatch_event_rule.feedback_discover.name
  arn      = module.librechat.cluster_arn
  role_arn = aws_iam_role.feedback_scheduled.arn
  ecs_target {
    task_definition_arn = module.librechat.task_definition_arn
    launch_type         = "FARGATE"
    network_configuration {
      subnets          = module.librechat.private_subnet_ids
      security_groups  = [module.librechat.api_security_group_id]
      assign_public_ip = false
    }
  }
  input = jsonencode({
    containerOverrides = [{
      name    = "api"
      command = ["node", "scripts/discover-feedback-clusters.js"]
    }]
  })
}
```

Adjust the output names (`task_definition_arn`, `cluster_arn`, `private_subnet_ids`, `api_security_group_id`, `task_role_arn`, `task_execution_role_arn`) to match whatever the `librechat` module actually exports. Grep the module source.

- [ ] **Step 2: Add outputs**

```hcl
output "feedback_classify_rule_arn" {
  value = aws_cloudwatch_event_rule.feedback_classify.arn
}

output "feedback_discover_rule_arn" {
  value = aws_cloudwatch_event_rule.feedback_discover.arn
}
```

- [ ] **Step 3: Plan + validate**

```bash
AWS_PROFILE=anubanu-staging terragrunt --working-dir /Users/amir/Development/anubanu/parlibot/LibreChat/infra/live/staging plan -compact-warnings -no-color 2>&1 | tail -30
```
Expected: clean plan with 2 new event rules + 2 targets + 1 IAM role + 1 policy + 2 outputs.

- [ ] **Step 4: Commit (don't apply — that's a deploy step)**

```bash
git add infra/envs/staging/main.tf infra/envs/staging/outputs.tf
git commit -m "feat(feedback-insights): EventBridge scheduled tasks for classify + discover"
```

---

## Task 20: Seed the `feedbackTopics` collection on first boot

**Files:**
- Create: `scripts/feedback-topics/seed.js`
- Modify: `scripts/feedback-topics/runner.js` (call seed on first invocation if topics collection is empty)

- [ ] **Step 1: Write the seed script**

```js
const { initialTaxonomy } = require('../../packages/api/dist/admin/feedback/taxonomy');

async function seedIfEmpty(FeedbackTopic) {
  const existing = await FeedbackTopic.countDocuments({});
  if (existing > 0) return 0;
  const docs = initialTaxonomy.map((t) => ({
    key: t.key,
    labelHe: t.labelHe,
    labelEn: t.labelEn,
    keywords: t.keywords,
    active: true,
  }));
  await FeedbackTopic.insertMany(docs);
  return docs.length;
}

module.exports = { seedIfEmpty };
```

- [ ] **Step 2: Invoke from `classify-feedback-topics.js` CLI**

In the `main()` function of `scripts/classify-feedback-topics.js`, after connecting to Mongo:

```js
const { feedbackTopicSchema } = require('@librechat/data-schemas');
const { seedIfEmpty } = require('./feedback-topics/seed');
const FeedbackTopic = mongoose.models.FeedbackTopic ||
  mongoose.model('FeedbackTopic', feedbackTopicSchema);
const seeded = await seedIfEmpty(FeedbackTopic);
if (seeded > 0) {
  console.log(JSON.stringify({ stage: 'seeded', count: seeded }));
}
```

- [ ] **Step 3: Write + run a quick integration test**

```js
// scripts/feedback-topics/seed.spec.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { feedbackTopicSchema } = require('@librechat/data-schemas');
const { seedIfEmpty } = require('./seed');

describe('seedIfEmpty', () => {
  let mem;
  let FeedbackTopic;
  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    FeedbackTopic = mongoose.model('FeedbackTopicSeed', feedbackTopicSchema);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });
  it('seeds initial taxonomy when empty', async () => {
    const count = await seedIfEmpty(FeedbackTopic);
    expect(count).toBeGreaterThan(0);
    const row = await FeedbackTopic.findOne({ key: 'budget_ministries' }).lean();
    expect(row).toBeTruthy();
  });
  it('is a no-op when topics exist', async () => {
    const count = await seedIfEmpty(FeedbackTopic);
    expect(count).toBe(0);
  });
});
```

```bash
npx jest scripts/feedback-topics/seed.spec.js
```
Expected: PASS (2).

- [ ] **Step 4: Commit**

```bash
git add scripts/feedback-topics/seed.js scripts/feedback-topics/seed.spec.js scripts/classify-feedback-topics.js
git commit -m "feat(feedback-insights): seed feedbackTopics on first classifier run"
```

---

## Task 21: Final push + ship

**Files:** no code; pushes the branch and opens a PR.

- [ ] **Step 1: Run the full test suite per workspace**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/data-schemas && npx jest
cd /Users/amir/Development/anubanu/parlibot/LibreChat/packages/api && npx jest
cd /Users/amir/Development/anubanu/parlibot/LibreChat/api && npx jest
cd /Users/amir/Development/anubanu/parlibot/LibreChat/client && npx jest src/components/Admin/Feedback
```
Expected: all PASS.

- [ ] **Step 2: `tsc --noEmit` for each TS workspace**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
npx tsc --noEmit --project packages/data-schemas/tsconfig.json
npx tsc --noEmit --project packages/data-provider/tsconfig.json
npx tsc --noEmit --project packages/api/tsconfig.json
npx tsc --noEmit --project client/tsconfig.json
```
Expected: no new errors (baseline may already have some — track count).

- [ ] **Step 3: Push**

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat
git push origin feat/admin-feedback-dashboard
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat(feedback-insights): admin feedback dashboard + classification pipeline" --body "$(cat <<'EOF'
## Summary
- New `/d/feedback` admin dashboard — KPIs, time-series, topic table (headline slice), tool-call chart, pending-topics queue, drill-down.
- Nightly classification pipeline (`scripts/classify-feedback-topics.js`) — taxonomy-first, LLM fallback. Runs as an ECS scheduled task at 02:00.
- Weekly cluster-discovery pass (`scripts/discover-feedback-clusters.js`) — Sundays 03:00.
- `GET /api/admin/feedback/{overview,messages,pending-topics}` + `POST .../pending-topics/:id/{approve,reject}`.
- Spec: `docs/superpowers/specs/2026-04-19-admin-feedback-insights-design.md`.
- Plan: `docs/superpowers/plans/2026-04-19-admin-feedback-insights.md`.

## Test plan
- [x] Unit tests for taxonomy, classifyOne, proposeClusters.
- [x] Integration tests for the classifier + discover runners using mongodb-memory-server (idempotency included).
- [x] Integration tests for FeedbackAnalytics (overview, drill-down, approve).
- [x] Supertest-level admin auth tests for the new routes.
- [x] Component tests for KpiStrip, FeedbackTimeSeries, TopicTable, FeedbackDashboard.
- [ ] Deploy to staging + manual dress rehearsal: `aws ecs run-task` both scripts, verify dashboard lights up.
EOF
)"
```

- [ ] **Step 5: Deploy to staging (after PR review)**

Follow the existing deploy recipe in the repo — Mac build + amd64 overlay + ECR push + `terragrunt apply` with the new `image_tag` — plus the stop-before-start deployment flip we've been using. Then force-run the classifier with `aws ecs run-task ... --overrides='{"containerOverrides":[{"name":"api","command":["node","scripts/classify-feedback-topics.js","--limit=100"]}]}'` and open `/d/feedback` to confirm.

---

## Summary / self-review notes

Coverage vs. spec: every numbered piece of the spec (data model, classification pipeline, cluster discovery, /overview+/messages+/pending-topics endpoints, frontend widgets, EventBridge crons, seed, test strategy) has a task in this plan. No `TBD` / `TODO` markers remain. Types flow consistently: `ClassificationResult`, `OverviewResponse`, `AdminFeedbackOverviewFilter`, and the `AdminFeedback*` frontend types are defined once and reused.

Known gaps intentionally deferred to v2 per the spec's own "Open questions": CSV/Sheets export, alerting on topic-level thumbs-down spikes, refining the 15 initial taxonomy categories with a native-Hebrew PM, the weekly cluster-discovery snapshot test for the full terragrunt rendering (Step 3 of Task 19 validates the plan shape but we don't yet have a gold-file snapshot harness — pragmatic v1).

One assumption the plan makes that the implementer should double-check against the actual code: the `api/db/models/index.js` pattern — the plan assumes the project exports Mongoose models from a single index. If the real shape is different (e.g. per-file models), the `FeedbackTopic` / `FeedbackTopicPending` registrations need to fit that pattern instead.

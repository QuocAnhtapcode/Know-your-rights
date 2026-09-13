import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  evidenceSchema,
  MAX_MESSAGES,
  messageSchema,
  userFactSchema,
} from '../../../shared/contracts';
import { demoRuntimeSchema, usageBucketSchema } from '../security/demo-policy';
import { requireMockRuntime } from '../security/runtime';
import type {
  ConversationRecord,
  DemoGrant,
  DemoRuntime,
  UsageBucket,
  SessionRepository,
  SessionTransaction,
} from './repository';

const MAX_TIMESTAMP_MILLIS = 253_402_300_799_999;
const MAX_ATTEMPTS = 40;
const MAX_START_REQUESTS = 20;
const uuidSchema = z.uuid();
const epochMillisSchema = z.number().int().min(0).max(MAX_TIMESTAMP_MILLIS);
const firestoreTimestampSchema = z.instanceof(Timestamp).refine(
  (value) => {
    const millis = value.toMillis();
    return Number.isFinite(millis) && millis >= 0 && millis <= MAX_TIMESTAMP_MILLIS;
  },
  'Firestore Timestamp is outside the supported range.',
);

const storedMessageSchema = messageSchema.extend({
  sourceIds: z.array(z.string().min(1).max(100)).max(20),
});
const storedEvidenceSchema = evidenceSchema.extend({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  url: z.url().max(2_048).refine((value) => new URL(value).protocol === 'https:', 'HTTPS required'),
});
const attemptSchema = z.strictObject({
  userMessageId: uuidSchema,
  messageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['pending', 'completed', 'failed', 'cancelled']),
});
const storedActiveAttemptSchema = z.strictObject({
  attemptId: uuidSchema,
  fencingToken: uuidSchema,
  leaseUntil: firestoreTimestampSchema,
});
const attemptsSchema = z.record(uuidSchema, attemptSchema).refine(
  (value) => Object.keys(value).length <= MAX_ATTEMPTS,
  `At most ${MAX_ATTEMPTS} attempts may be stored.`,
);

const storedConversationSchema = z.strictObject({
  id: uuidSchema,
  ownerUid: z.string().min(1).max(128),
  generation: uuidSchema,
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  status: z.literal('active'),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema,
  messages: z.array(storedMessageSchema).max(MAX_MESSAGES),
  userFacts: z.array(userFactSchema).max(100),
  conversationState: z.strictObject({
    language: z.enum(['vi', 'en']),
    currentTopic: z.string().max(200).nullable(),
    pendingQuestion: z.string().max(500).nullable(),
  }),
  evidenceLedger: z.array(storedEvidenceSchema).max(100),
  attempts: attemptsSchema,
  activeAttempt: storedActiveAttemptSchema.nullable(),
}).superRefine((record, context) => {
  if (record.updatedAt.toMillis() < record.createdAt.toMillis()
    || record.expiresAt.toMillis() < record.updatedAt.toMillis()) {
    context.addIssue({ code: 'custom', message: 'Conversation timestamps are not ordered.' });
  }

  const messageIds = new Set<string>();
  const userMessageIds = new Set<string>();
  for (const message of record.messages) {
    if (messageIds.has(message.id)) {
      context.addIssue({ code: 'custom', message: 'Message IDs must be unique.' });
    }
    messageIds.add(message.id);
    if (message.role === 'user') userMessageIds.add(message.id);
  }

  const evidenceIds = new Set<string>();
  for (const evidence of record.evidenceLedger) {
    if (evidenceIds.has(evidence.id)) {
      context.addIssue({ code: 'custom', message: 'Evidence IDs must be unique.' });
    }
    evidenceIds.add(evidence.id);
  }
  for (const message of record.messages) {
    if (message.sourceIds.some((sourceId) => !evidenceIds.has(sourceId))) {
      context.addIssue({ code: 'custom', message: 'A message references unknown evidence.' });
    }
  }

  const factIds = new Set<string>();
  for (const fact of record.userFacts) {
    if (factIds.has(fact.id)) {
      context.addIssue({ code: 'custom', message: 'User-fact IDs must be unique.' });
    }
    factIds.add(fact.id);
    if (!userMessageIds.has(fact.sourceMessageId)) {
      context.addIssue({ code: 'custom', message: 'A user fact references an unknown user message.' });
    }
  }

  const pendingAttemptIds = Object.entries(record.attempts)
    .filter(([, attempt]) => attempt.status === 'pending')
    .map(([attemptId]) => attemptId);
  if (record.activeAttempt === null) {
    if (pendingAttemptIds.length !== 0) {
      context.addIssue({ code: 'custom', message: 'A pending attempt requires an active lease.' });
    }
  } else {
    const active = record.attempts[record.activeAttempt.attemptId];
    if (!active || active.status !== 'pending' || pendingAttemptIds.length !== 1) {
      context.addIssue({ code: 'custom', message: 'The active lease must identify the only pending attempt.' });
    }
  }
  for (const attempt of Object.values(record.attempts)) {
    if (!userMessageIds.has(attempt.userMessageId)) {
      context.addIssue({ code: 'custom', message: 'An attempt references an unknown user message.' });
    }
  }
});

const storedGrantSchema = z.strictObject({
  expiresAt: firestoreTimestampSchema,
  activeConversationId: uuidSchema.nullable(),
  startRequests: z.record(uuidSchema, uuidSchema).refine(
    (value) => Object.keys(value).length <= MAX_START_REQUESTS,
    `At most ${MAX_START_REQUESTS} start requests may be stored.`,
  ),
});

const storedUsageSchema = z.strictObject({
  starts: z.number().int().min(0).max(10_000_000),
  sends: z.number().int().min(0).max(10_000_000),
  failedStarts: z.number().int().min(0).max(10_000_000),
  expiresAt: firestoreTimestampSchema,
});

type StoredConversation = z.infer<typeof storedConversationSchema>;
type StoredGrant = z.infer<typeof storedGrantSchema>;
type StoredUsage = z.infer<typeof storedUsageSchema>;

function invalidStoredData(kind: string): Error {
  return new Error(`Stored ${kind} data is invalid.`);
}

function parseStored<T>(schema: z.ZodType<T>, value: unknown, kind: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidStoredData(kind);
  return result.data;
}

function toTimestamp(value: number, kind: string): Timestamp {
  const result = epochMillisSchema.safeParse(value);
  if (!result.success) throw invalidStoredData(kind);
  return Timestamp.fromMillis(result.data);
}

/** Exported for focused unit tests; callers must not log raw rejected values. */
export function encodeConversationForFirestore(record: ConversationRecord): StoredConversation {
  return parseStored(storedConversationSchema, {
    ...record,
    createdAt: toTimestamp(record.createdAt, 'conversation'),
    updatedAt: toTimestamp(record.updatedAt, 'conversation'),
    expiresAt: toTimestamp(record.expiresAt, 'conversation'),
    activeAttempt: record.activeAttempt === null ? null : {
      ...record.activeAttempt,
      leaseUntil: toTimestamp(record.activeAttempt.leaseUntil, 'conversation'),
    },
  }, 'conversation');
}

/** Exported for focused unit tests; document ID is part of the integrity check. */
export function decodeConversationFromFirestore(documentId: string, value: unknown): ConversationRecord {
  const id = uuidSchema.safeParse(documentId);
  if (!id.success) throw invalidStoredData('conversation');
  const record = parseStored(storedConversationSchema, value, 'conversation');
  if (record.id !== id.data) throw invalidStoredData('conversation');
  return {
    ...record,
    createdAt: record.createdAt.toMillis(),
    updatedAt: record.updatedAt.toMillis(),
    expiresAt: record.expiresAt.toMillis(),
    activeAttempt: record.activeAttempt === null ? null : {
      ...record.activeAttempt,
      leaseUntil: record.activeAttempt.leaseUntil.toMillis(),
    },
  };
}

export function encodeGrantForFirestore(grant: DemoGrant): StoredGrant {
  return parseStored(storedGrantSchema, {
    ...grant,
    expiresAt: toTimestamp(grant.expiresAt, 'demo grant'),
  }, 'demo grant');
}

export function decodeGrantFromFirestore(value: unknown): DemoGrant {
  const grant = parseStored(storedGrantSchema, value, 'demo grant');
  return { ...grant, expiresAt: grant.expiresAt.toMillis() };
}

export function encodeUsageForFirestore(bucket: UsageBucket): StoredUsage {
  const domainBucket = usageBucketSchema.safeParse(bucket);
  if (!domainBucket.success) throw invalidStoredData('usage bucket');
  return parseStored(storedUsageSchema, {
    ...domainBucket.data,
    expiresAt: toTimestamp(domainBucket.data.expiresAt, 'usage bucket'),
  }, 'usage bucket');
}

export function decodeUsageFromFirestore(value: unknown): UsageBucket {
  const bucket = parseStored(storedUsageSchema, value, 'usage bucket');
  const domainBucket = usageBucketSchema.safeParse({ ...bucket, expiresAt: bucket.expiresAt.toMillis() });
  if (!domainBucket.success) throw invalidStoredData('usage bucket');
  return domainBucket.data;
}

export function decodeRuntimeFromFirestore(value: unknown): DemoRuntime {
  const runtime = demoRuntimeSchema.safeParse(value);
  if (!runtime.success) throw invalidStoredData('runtime configuration');
  return runtime.data;
}

export class FirestoreSessionRepository implements SessionRepository {
  constructor(private readonly database: Firestore) {}

  transaction<T>(callback: (transaction: SessionTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction(async (transaction) => callback({
      getConversation: async (id) => {
        const snapshot = await transaction.get(this.database.collection('conversations').doc(id));
        if (!snapshot.exists) return null;
        return decodeConversationFromFirestore(snapshot.id, snapshot.data());
      },
      getGrant: async (uid) => {
        const snapshot = await transaction.get(this.database.collection('demoGrants').doc(uid));
        if (!snapshot.exists) return null;
        return decodeGrantFromFirestore(snapshot.data());
      },
      getRuntime: async () => {
        const snapshot = await transaction.get(this.database.doc('runtime/demo'));
        return snapshot.exists ? decodeRuntimeFromFirestore(snapshot.data()) : null;
      },
      getUsage: async (id) => {
        const snapshot = await transaction.get(this.database.collection('usageBuckets').doc(id));
        if (!snapshot.exists) return null;
        return decodeUsageFromFirestore(snapshot.data());
      },
      putConversation: (record) => {
        transaction.set(
          this.database.collection('conversations').doc(record.id),
          encodeConversationForFirestore(record),
        );
      },
      putGrant: (uid, grant) => {
        transaction.set(this.database.collection('demoGrants').doc(uid), encodeGrantForFirestore(grant));
      },
      putUsage: (id, bucket) => {
        transaction.set(this.database.collection('usageBuckets').doc(id), encodeUsageForFirestore(bucket));
      },
      deleteConversation: (id) => {
        transaction.delete(this.database.collection('conversations').doc(id));
      },
    }));
  }
}

/** Lazy: module loading, builds and cloud discovery cannot initialize Admin. */
export function guardedMockFirestore(): Firestore {
  requireMockRuntime(process.env);
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  const app = getApps().find((candidate) => candidate.name === 'kyr-session-repository')
    ?? initializeApp({ projectId }, 'kyr-session-repository');
  if (app.options.projectId !== projectId) throw new Error('Session repository project mismatch.');
  return getFirestore(app);
}

/** Lazy: module loading, builds and cloud discovery cannot initialize Admin. */
export function guardedMockRepository(): FirestoreSessionRepository {
  return new FirestoreSessionRepository(guardedMockFirestore());
}

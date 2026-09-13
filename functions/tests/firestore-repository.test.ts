import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import type { ConversationRecord, DemoGrant, UsageBucket } from '../src/session/repository';
import {
  decodeConversationFromFirestore,
  decodeGrantFromFirestore,
  decodeRuntimeFromFirestore,
  decodeUsageFromFirestore,
  encodeConversationForFirestore,
  encodeGrantForFirestore,
  encodeUsageForFirestore,
} from '../src/session/firestore-repository';

const now = Date.parse('2026-09-13T00:00:00.000Z');

function conversationFixture(): ConversationRecord {
  const id = randomUUID();
  const userMessageId = randomUUID();
  const attemptId = randomUUID();
  return {
    id,
    ownerUid: 'anonymousOwner123',
    generation: randomUUID(),
    version: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now + 1_000,
    expiresAt: now + 30 * 60_000,
    messages: [{
      id: userMessageId,
      role: 'user',
      text: 'Synthetic question only.',
      createdAt: new Date(now + 1_000).toISOString(),
      sourceIds: [],
      provenance: 'user_reported',
    }],
    userFacts: [],
    conversationState: { language: 'vi', currentTopic: null, pendingQuestion: null },
    evidenceLedger: [],
    attempts: {
      [attemptId]: {
        userMessageId,
        messageDigest: 'a'.repeat(64),
        status: 'pending',
      },
    },
    activeAttempt: { attemptId, fencingToken: randomUUID(), leaseUntil: now + 150_000 },
  };
}

describe('Firestore session storage codecs', () => {
  it('round-trips a conversation and uses native Timestamp values, including the lease', () => {
    const record = conversationFixture();
    const stored = encodeConversationForFirestore(record);

    expect(stored.createdAt).toBeInstanceOf(Timestamp);
    expect(stored.updatedAt).toBeInstanceOf(Timestamp);
    expect(stored.expiresAt).toBeInstanceOf(Timestamp);
    expect(stored.activeAttempt?.leaseUntil).toBeInstanceOf(Timestamp);
    expect(decodeConversationFromFirestore(record.id, stored)).toEqual(record);
  });

  it('fails closed on a mismatched document ID, non-Timestamp fields and unknown data', () => {
    const record = conversationFixture();
    const stored = encodeConversationForFirestore(record);

    expect(() => decodeConversationFromFirestore(randomUUID(), stored)).toThrow('Stored conversation data is invalid.');
    expect(() => decodeConversationFromFirestore(record.id, { ...stored, expiresAt: record.expiresAt })).toThrow(
      'Stored conversation data is invalid.',
    );
    expect(() => decodeConversationFromFirestore(record.id, {
      ...stored,
      activeAttempt: { ...stored.activeAttempt, leaseUntil: record.activeAttempt?.leaseUntil },
    })).toThrow('Stored conversation data is invalid.');
    expect(() => decodeConversationFromFirestore(record.id, { ...stored, unexpected: true })).toThrow(
      'Stored conversation data is invalid.',
    );
  });

  it('rejects malformed attempt relationships, digests and referenced evidence', () => {
    const record = conversationFixture();
    const stored = encodeConversationForFirestore(record);
    const [attemptId] = Object.keys(stored.attempts);
    const attempt = stored.attempts[attemptId]!;

    expect(() => decodeConversationFromFirestore(record.id, {
      ...stored,
      attempts: { [attemptId]: { ...attempt, messageDigest: 'not-a-digest' } },
    })).toThrow('Stored conversation data is invalid.');
    expect(() => decodeConversationFromFirestore(record.id, { ...stored, activeAttempt: null })).toThrow(
      'Stored conversation data is invalid.',
    );
    expect(() => decodeConversationFromFirestore(record.id, {
      ...stored,
      messages: [{ ...stored.messages[0], sourceIds: ['missing-source'] }],
    })).toThrow('Stored conversation data is invalid.');
  });

  it('round-trips bounded grant metadata without accepting raw access-code fields', () => {
    const grant: DemoGrant = {
      expiresAt: now + 24 * 60 * 60_000,
      activeConversationId: randomUUID(),
      startRequests: { [randomUUID()]: randomUUID() },
    };
    const stored = encodeGrantForFirestore(grant);

    expect(stored.expiresAt).toBeInstanceOf(Timestamp);
    expect(decodeGrantFromFirestore(stored)).toEqual(grant);
    expect(() => decodeGrantFromFirestore({ ...stored, accessCode: 'must-not-be-stored' })).toThrow(
      'Stored demo grant data is invalid.',
    );
    expect(() => decodeGrantFromFirestore({ ...stored, expiresAt: grant.expiresAt })).toThrow(
      'Stored demo grant data is invalid.',
    );
  });

  it('round-trips usage metadata and strictly validates runtime configuration', () => {
    const usage: UsageBucket = { starts: 1, sends: 2, failedStarts: 3, expiresAt: now + 24 * 60 * 60_000 };
    const stored = encodeUsageForFirestore(usage);
    const runtime = {
      enabled: true,
      syntheticOnly: true,
      maxStartsPerUidPerHour: 20,
      maxSendsPerUidPerHour: 60,
      maxFailedStartsPerUidPerHour: 5,
      maxFailedStartsGlobalPerHour: 100,
      maxStartsGlobalPerHour: 50,
      maxSendsGlobalPerHour: 200,
    } as const;

    expect(stored.expiresAt).toBeInstanceOf(Timestamp);
    expect(decodeUsageFromFirestore(stored)).toEqual(usage);
    expect(decodeRuntimeFromFirestore(runtime)).toEqual(runtime);
    expect(() => decodeUsageFromFirestore({ ...stored, sends: -1 })).toThrow('Stored usage bucket data is invalid.');
    expect(() => decodeRuntimeFromFirestore({ ...runtime, accessCode: 'must-not-be-stored' })).toThrow(
      'Stored runtime configuration data is invalid.',
    );
  });
});

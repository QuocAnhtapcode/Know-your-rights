import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { MAX_MESSAGES } from '../../../shared/contracts';
import type {
  ClearConversationRequest, ClearConversationResponse, GetConversationRequest,
  GetConversationResponse, SendMessageRequest, SendMessageResponse,
  StartConversationRequest, StartConversationResponse,
} from '../../../shared/contracts';
import { LegacyReplyEngineAdapter, type ConversationEngine } from '../ai/conversation-engine';
import { applyPlannerCorrection } from '../ai/planner';
import type { ReplyProvider } from '../ai/provider';
import { checkFailedStarts, readDemoPolicy, recordFailedStart, reserveQuota } from '../security/demo-policy';
import { publicView } from './repository';
import type { ConversationRecord, SessionRepository } from './repository';

export const EMULATOR_ACCESS_CODE = 'emulator-only-code';
export const SESSION_MS = 30 * 60_000;
export const METADATA_MS = 24 * 60 * 60_000;
const LEASE_MS = 150_000;
export const MAX_CONVERSATION_DOCUMENT_BYTES = 512 * 1024;
export const FIRESTORE_ENCODING_RESERVE_BYTES = 32 * 1024;
const MAX_STARTS = 20;
const MAX_ATTEMPTS = 40;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validFixtureCode(value: string | undefined): boolean {
  return typeof value === 'string'
    && timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(EMULATOR_ACCESS_CODE)));
}

function requireConversation(record: ConversationRecord | null, ownerUid: string): ConversationRecord {
  if (!record || record.ownerUid !== ownerUid) {
    throw new HttpsError('not-found', 'Conversation not found.');
  }
  return record;
}

function requireActive(record: ConversationRecord, now: number): void {
  if (record.expiresAt <= now || record.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Conversation has expired. Start a new session.');
  }
}

function structuralValueCount(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + value.reduce((total, item) => total + structuralValueCount(item), 0);
  }
  if (value !== null && typeof value === 'object') {
    return 1 + Object.values(value).reduce<number>((total, item) => total + structuralValueCount(item), 0);
  }
  return 1;
}

/**
 * Conservative application budget, not an exact Firestore wire-size calculation.
 * UTF-8 JSON includes all field names and values; the fixed reserve and per-value
 * allowance cover document names, type tags, lengths, map/array metadata and timestamps.
 */
export function estimateConversationDocumentBytes(record: ConversationRecord): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8')
    + FIRESTORE_ENCODING_RESERVE_BYTES
    + structuralValueCount(record) * 16;
}

export function requireBounded(record: ConversationRecord): void {
  if (record.messages.length > MAX_MESSAGES
    || record.userFacts.length > 100
    || record.evidenceLedger.length > 100
    || Object.keys(record.attempts).length > MAX_ATTEMPTS
    || estimateConversationDocumentBytes(record) >= MAX_CONVERSATION_DOCUMENT_BYTES) {
    throw new HttpsError('resource-exhausted', 'Session limit reached. Please clear and start a new session.');
  }
}

/** Synthetic service: isolated emulators, or explicitly authorized M2 cloud-mock runtime.
 * Deferred before live AI: planner/corrections/source gate, full failure/reclaim policy,
 * operational telemetry and cloud acceptance checks. No legal output is generated here.
 */
export class MockConversationService {
  private readonly engine: ConversationEngine;

  constructor(
    private readonly repository: SessionRepository,
    engineOrProvider: ConversationEngine | ReplyProvider,
    private readonly now: () => number = Date.now,
    private readonly options: {
      verifyAccessCode?: (candidate: string | undefined) => boolean;
      enforceRuntimePolicy?: boolean;
    } = {},
  ) {
    this.engine = 'plan' in engineOrProvider
      ? engineOrProvider
      : new LegacyReplyEngineAdapter(engineOrProvider);
  }

  async start(ownerUid: string, input: StartConversationRequest): Promise<StartConversationResponse> {
    const id = randomUUID();
    const generation = randomUUID();
    const result = await this.repository.transaction(async (transaction) => {
      const now = this.now();
      const previousGrant = await transaction.getGrant(ownerUid);
      const priorId = previousGrant?.startRequests[input.requestId];
      const validGrant = previousGrant !== null && previousGrant.expiresAt > now;
      if (priorId && validGrant) {
        const existing = requireConversation(await transaction.getConversation(priorId), ownerUid);
        requireActive(existing, now);
        return { denied: false as const, response: { mode: this.engine.mode, conversation: publicView(existing) } };
      }

      const activeId = previousGrant?.activeConversationId;
      const active = activeId ? await transaction.getConversation(activeId) : null;
      if (active) requireConversation(active, ownerUid);
      const policy = this.options.enforceRuntimePolicy ? await readDemoPolicy(transaction, ownerUid, now) : null;
      if (!validGrant) {
        if (policy) checkFailedStarts(policy);
        if (!(this.options.verifyAccessCode ?? validFixtureCode)(input.accessCode)) {
          if (policy) recordFailedStart(transaction, policy);
          // Return instead of throwing in the callback so the failed-attempt counter commits.
          return { denied: true as const };
        }
      }
      if (priorId) {
        // An expired grant/request mapping cannot be used to read old content. A renewed
        // request receives a fresh server ID and follows the normal replacement rules.
        if (input.replaceConversationId && input.replaceConversationId !== activeId) {
          throw new HttpsError('not-found', 'Conversation not found.');
        }
      }
      if (active && active.expiresAt > now) {
        if (!input.replaceConversationId) {
          throw new HttpsError('failed-precondition', 'Confirm replacement of the current conversation first.');
        }
        if (input.replaceConversationId !== active.id) {
          throw new HttpsError('not-found', 'Conversation not found.');
        }
      } else if (input.replaceConversationId && input.replaceConversationId !== active?.id) {
        throw new HttpsError('not-found', 'Conversation not found.');
      }
      const startRequests = validGrant ? previousGrant.startRequests : {};
      if (Object.keys(startRequests).length >= MAX_STARTS) {
        throw new HttpsError('resource-exhausted', 'Emulator session-start limit reached.');
      }
      const record: ConversationRecord = {
        id, ownerUid, generation, version: 0, status: 'active',
        createdAt: now, updatedAt: now, expiresAt: now + SESSION_MS,
        messages: [], userFacts: [], evidenceLedger: [], attempts: {}, activeAttempt: null,
        conversationState: { language: 'vi', currentTopic: null, pendingQuestion: null },
      };
      requireBounded(record);
      if (policy) reserveQuota(transaction, policy, 'starts');
      if (active) transaction.deleteConversation(active.id);
      transaction.putConversation(record);
      transaction.putGrant(ownerUid, {
        expiresAt: validGrant ? previousGrant.expiresAt : now + METADATA_MS,
        activeConversationId: id,
        startRequests: { ...startRequests, [input.requestId]: id },
      });
      return { denied: false as const, response: { mode: this.engine.mode, conversation: publicView(record) } };
    });
    if (result.denied) throw new HttpsError('permission-denied', 'Demo access code is not valid.');
    return result.response;
  }

  get(ownerUid: string, input: GetConversationRequest): Promise<GetConversationResponse> {
    return this.repository.transaction(async (transaction) => {
      const record = requireConversation(await transaction.getConversation(input.conversationId), ownerUid);
      const grant = await transaction.getGrant(ownerUid);
      requireActive(record, this.now());
      if (!grant || grant.expiresAt <= this.now()) throw new HttpsError('permission-denied', 'Demo grant expired.');
      // Reading or polling does not extend the expiry time.
      return { mode: this.engine.mode, conversation: publicView(record) };
    });
  }

  async send(ownerUid: string, input: SendMessageRequest): Promise<SendMessageResponse> {
    const fencingToken = randomUUID();
    const messageDigest = digest(input.message);
    const reserved = await this.repository.transaction(async (transaction) => {
      const record = requireConversation(await transaction.getConversation(input.conversationId), ownerUid);
      const grant = await transaction.getGrant(ownerUid);
      const now = this.now();
      requireActive(record, now);
      if (!grant || grant.expiresAt <= now) throw new HttpsError('permission-denied', 'Demo grant expired.');
      const prior = record.attempts[input.attemptId];
      if (prior) {
        if (prior.userMessageId !== input.userMessageId || prior.messageDigest !== messageDigest) {
          throw new HttpsError('already-exists', 'Attempt ID was already used with a different message.');
        }
        if (prior.status === 'failed' || prior.status === 'cancelled') {
          throw new HttpsError('failed-precondition', 'Use a new attempt ID to retry this message.');
        }
        return { kind: 'replay' as const, record, status: prior.status };
      }
      const policy = this.options.enforceRuntimePolicy ? await readDemoPolicy(transaction, ownerUid, now) : null;
      if (record.version !== input.contextVersion) {
        throw new HttpsError('aborted', 'Context changed. Refresh the conversation before sending.');
      }
      if (record.activeAttempt && record.activeAttempt.leaseUntil > now) {
        throw new HttpsError('aborted', 'A message is still being processed.');
      }
      const existingUser = record.messages.find((message) => message.id === input.userMessageId);
      if (existingUser && (existingUser.role !== 'user' || existingUser.text !== input.message)) {
        throw new HttpsError('already-exists', 'Message ID was already used with different content.');
      }
      if (Object.values(record.attempts).some((attempt) => (
        attempt.userMessageId === input.userMessageId && attempt.status === 'completed'
      ))) {
        throw new HttpsError('already-exists', 'Message has already completed. Replay its original attempt.');
      }
      if (Object.keys(record.attempts).length >= MAX_ATTEMPTS) {
        throw new HttpsError('resource-exhausted', 'Emulator attempt limit reached.');
      }
      if (record.activeAttempt) {
        const abandoned = record.attempts[record.activeAttempt.attemptId];
        if (abandoned) abandoned.status = 'cancelled';
      }
      if (record.messages.length + (existingUser ? 1 : 2) > MAX_MESSAGES) {
        throw new HttpsError('resource-exhausted', 'Session message limit reached.');
      }
      if (!existingUser) record.messages.push({
        id: input.userMessageId, role: 'user', text: input.message,
        createdAt: new Date(now).toISOString(), sourceIds: [], provenance: 'user_reported',
      });
      record.attempts[input.attemptId] = {
        userMessageId: input.userMessageId, messageDigest, status: 'pending',
      };
      record.activeAttempt = { attemptId: input.attemptId, fencingToken, leaseUntil: now + LEASE_MS };
      record.version += 1;
      record.updatedAt = now;
      record.expiresAt = now + SESSION_MS;
      requireBounded(record);
      if (policy) reserveQuota(transaction, policy, 'sends');
      transaction.putConversation(record);
      return { kind: 'reserved' as const, record, status: 'pending' as const };
    });
    if (reserved.kind === 'replay') {
      return { mode: this.engine.mode, status: reserved.status, attemptId: input.attemptId, conversation: publicView(reserved.record) };
    }

    try {
      // Outside transactions: Firestore callback retries must never call OpenAI.
      const decision = await this.engine.plan(publicView(reserved.record));
      const corrected = await this.repository.transaction(async (transaction) => {
        const record = requireConversation(await transaction.getConversation(input.conversationId), ownerUid);
        const now = this.now();
        requireActive(record, now);
        if (record.generation !== reserved.record.generation || record.version !== reserved.record.version
          || record.activeAttempt?.fencingToken !== fencingToken || record.activeAttempt.leaseUntil <= now) {
          throw new HttpsError('aborted', 'This attempt can no longer apply its plan.');
        }
        applyPlannerCorrection(record, decision, now);
        record.version += 1;
        requireBounded(record);
        transaction.putConversation(record);
        return record;
      });

      // A kill switch changed after planning must stop a new web call. Corrections already
      // committed above remain authoritative and can be retried with a fresh attempt.
      if (this.options.enforceRuntimePolicy && this.engine.usesExternalAI && decision.needsNewEvidence) {
        await this.repository.transaction(async (transaction) => {
          await readDemoPolicy(transaction, ownerUid, this.now());
        });
      }
      const answer = await this.engine.answer(publicView(corrected), decision);
      if (answer.text.length > 16_000 || answer.sourceIds.length > 20 || answer.evidence.length > 20) {
        throw new HttpsError('internal', 'Provider response exceeds the conversation contract.');
      }
      return await this.repository.transaction(async (transaction) => {
        const record = requireConversation(await transaction.getConversation(input.conversationId), ownerUid);
        const now = this.now();
        requireActive(record, now);
        if (record.generation !== reserved.record.generation || record.version !== corrected.version
          || record.activeAttempt?.fencingToken !== fencingToken || record.activeAttempt.leaseUntil <= now) {
          throw new HttpsError('aborted', 'This attempt can no longer commit.');
        }
        const evidenceById = new Map(record.evidenceLedger.map((item) => [item.id, item]));
        for (const item of answer.evidence) {
          const existing = evidenceById.get(item.id);
          if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
            throw new HttpsError('internal', 'Evidence identity conflict.');
          }
          evidenceById.set(item.id, item);
        }
        record.evidenceLedger = [...evidenceById.values()];
        const evidenceIds = new Set(record.evidenceLedger.map((item) => item.id));
        if (answer.sourceIds.some((id) => !evidenceIds.has(id))) {
          throw new HttpsError('internal', 'Assistant response references unknown evidence.');
        }
        record.messages.push({
          id: randomUUID(), role: 'assistant', text: answer.text, createdAt: new Date(now).toISOString(),
          sourceIds: answer.sourceIds, provenance: answer.provenance,
        });
        record.attempts[input.attemptId]!.status = 'completed';
        record.activeAttempt = null;
        record.version += 1;
        record.updatedAt = now;
        requireBounded(record);
        // Record existence was checked in this same transaction. A late result cannot upsert after clear.
        transaction.putConversation(record);
        return { mode: this.engine.mode, status: 'completed', attemptId: input.attemptId, conversation: publicView(record) };
      });
    } catch (error) {
      await this.repository.transaction(async (transaction) => {
        const record = await transaction.getConversation(input.conversationId);
        if (record?.ownerUid !== ownerUid || record.activeAttempt?.fencingToken !== fencingToken) return;
        record.activeAttempt = null;
        const attempt = record.attempts[input.attemptId];
        if (attempt) attempt.status = 'failed';
        record.version += 1;
        record.updatedAt = Math.min(this.now(), record.expiresAt);
        transaction.putConversation(record);
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'The reply could not be completed. Refresh and retry with a new attempt ID.');
    }
  }

  clear(ownerUid: string, input: ClearConversationRequest): Promise<ClearConversationResponse> {
    return this.repository.transaction(async (transaction) => {
      const record = await transaction.getConversation(input.conversationId);
      const grant = await transaction.getGrant(ownerUid);
      if (record) {
        requireConversation(record, ownerUid);
      } else {
        const knownOwnedId = grant !== null
          && Object.values(grant.startRequests).includes(input.conversationId);
        if (!knownOwnedId) throw new HttpsError('not-found', 'Conversation not found.');
      }
      // Deliberately no expiry/grant/AI-quota check on owner-initiated deletion.
      if (record) transaction.deleteConversation(record.id);
      if (grant?.activeConversationId === input.conversationId) {
        transaction.putGrant(ownerUid, { ...grant, activeConversationId: null });
      }
      return { mode: this.engine.mode, conversationId: input.conversationId, cleared: true };
    });
  }
}

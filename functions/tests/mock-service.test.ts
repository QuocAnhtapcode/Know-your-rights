import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callableContracts } from '../../shared/contracts';
import type { SendMessageRequest } from '../../shared/contracts';
import { FakeReplyProvider } from '../src/ai/provider';
import {
  EMULATOR_ACCESS_CODE,
  MAX_CONVERSATION_DOCUMENT_BYTES,
  SESSION_MS,
  MockConversationService,
  estimateConversationDocumentBytes,
  requireBounded,
} from '../src/session/mock-service';
import { MemorySessionRepository } from './memory-repository';

describe('isolated synthetic service', () => {
  let repository: MemorySessionRepository;
  let now: number;
  let service: MockConversationService;
  const owner = 'synthetic-owner';

  beforeEach(() => {
    repository = new MemorySessionRepository();
    now = Date.parse('2026-09-12T00:00:00.000Z');
    service = new MockConversationService(repository, new FakeReplyProvider(), () => now);
  });

  async function start() {
    return service.start(owner, { requestId: randomUUID(), accessCode: EMULATOR_ACCESS_CODE });
  }
  function message(conversationId: string, contextVersion = 0): SendMessageRequest {
    return { conversationId, contextVersion, message: 'Tình huống hư cấu 🙂', userMessageId: randomUUID(), attemptId: randomUUID() };
  }

  it('dedupes start, does not expose/store an access code, and permits an existing grant', async () => {
    const input = { requestId: randomUUID(), accessCode: EMULATOR_ACCESS_CODE };
    const first = await service.start(owner, input);
    const again = await service.start(owner, { requestId: input.requestId });
    expect(again).toEqual(first);
    expect(repository.conversations.size).toBe(1);
    expect(JSON.stringify([...repository.grants.values()])).not.toContain(EMULATOR_ACCESS_CODE);
    expect(callableContracts.startConversation.response.safeParse(first).success).toBe(true);
    await expect(service.start('other', { requestId: randomUUID(), accessCode: 'wrong' })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('dedupes concurrent double-click starts into one server-owned conversation', async () => {
    const input = { requestId: randomUUID(), accessCode: EMULATOR_ACCESS_CODE };
    const [first, second] = await Promise.all([
      service.start(owner, input),
      service.start(owner, input),
    ]);
    expect(second).toEqual(first);
    expect(repository.conversations.size).toBe(1);
    expect(repository.grants.get(owner)?.startRequests[input.requestId]).toBe(first.conversation.conversationId);
  });

  it('requires explicit replacement, verifies the active owner and deletes the old payload atomically', async () => {
    const first = await start();
    const requestId = randomUUID();
    await expect(service.start(owner, { requestId })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(service.start(owner, {
      requestId,
      replaceConversationId: randomUUID(),
    })).rejects.toMatchObject({ code: 'not-found' });

    const replacementInput = {
      requestId,
      replaceConversationId: first.conversation.conversationId,
    };
    const replacement = await service.start(owner, replacementInput);
    expect(replacement.conversation.conversationId).not.toBe(first.conversation.conversationId);
    expect(repository.conversations.has(first.conversation.conversationId)).toBe(false);
    expect(repository.conversations.size).toBe(1);
    expect(await service.start(owner, replacementInput)).toEqual(replacement);

    const other = 'other-owner';
    const otherStart = await service.start(other, {
      requestId: randomUUID(), accessCode: EMULATOR_ACCESS_CODE,
    });
    const otherGrant = repository.grants.get(other)!;
    repository.grants.set(other, { ...otherGrant, activeConversationId: replacement.conversation.conversationId });
    await expect(service.start(other, {
      requestId: randomUUID(),
      replaceConversationId: replacement.conversation.conversationId,
    })).rejects.toMatchObject({ code: 'not-found' });
    expect(repository.conversations.has(replacement.conversation.conversationId)).toBe(true);
    expect(repository.conversations.has(otherStart.conversation.conversationId)).toBe(true);
  });

  it('blocks cross-owner read/send/clear and unknown IDs without exposing content', async () => {
    const { conversation } = await start();
    const input = { conversationId: conversation.conversationId };
    await expect(service.get('other', input)).rejects.toMatchObject({ code: 'not-found' });
    await expect(service.send('other', message(input.conversationId))).rejects.toMatchObject({ code: 'not-found' });
    await expect(service.clear('other', input)).rejects.toMatchObject({ code: 'not-found' });
    await expect(service.clear(owner, { conversationId: randomUUID() })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('keeps a bounded multi-turn history and exact attempt replay does not call the provider twice', async () => {
    const reply = vi.fn(new FakeReplyProvider().reply);
    service = new MockConversationService(repository, { reply }, () => now);
    const { conversation } = await start();
    const input = message(conversation.conversationId);
    const first = await service.send(owner, input);
    const replay = await service.send(owner, input);
    expect(replay).toEqual(first);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(first.conversation.messages).toHaveLength(2);
    expect(first.conversation.messages[1]?.provenance).toBe('mock');
    expect(first.conversation.evidenceLedger).toEqual([]);
    const second = await service.send(owner, message(conversation.conversationId, first.conversation.contextVersion));
    expect(second.conversation.messages).toHaveLength(4);
    expect(second.conversation.messages[3]?.text).toContain('lượt 2');
    expect(callableContracts.sendMessage.response.safeParse(second).success).toBe(true);
  });

  it('rejects stale context and mutation of deduped IDs', async () => {
    const { conversation } = await start();
    const input = message(conversation.conversationId);
    const result = await service.send(owner, input);
    await expect(service.send(owner, message(conversation.conversationId))).rejects.toMatchObject({ code: 'aborted' });
    await expect(service.send(owner, { ...input, message: 'Different' })).rejects.toMatchObject({ code: 'already-exists' });
    await expect(service.send(owner, { ...input, contextVersion: result.conversation.contextVersion, attemptId: randomUUID() })).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('requires actual expiry checks and read does not prolong the session; expired owners can clear', async () => {
    const { conversation } = await start();
    now += 10_000;
    expect((await service.get(owner, { conversationId: conversation.conversationId })).conversation.expiresAt).toBe(conversation.expiresAt);
    now += 30 * 60_000;
    await expect(service.get(owner, { conversationId: conversation.conversationId })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(service.send(owner, message(conversation.conversationId))).rejects.toMatchObject({ code: 'failed-precondition' });
    await service.clear(owner, { conversationId: conversation.conversationId });
    expect(repository.conversations.size).toBe(0);
  });

  it('calls provider outside transactions, reports duplicate pending and cannot resurrect after clear', async () => {
    let release!: (text: string) => void;
    let entered!: () => void;
    const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const providerReply = new Promise<string>((resolve) => { release = resolve; });
    const reply = vi.fn(() => {
      expect(repository.inTransaction).toBe(false);
      entered();
      return providerReply;
    });
    service = new MockConversationService(repository, { reply }, () => now);
    const { conversation } = await start();
    const input = message(conversation.conversationId);
    const pending = service.send(owner, input);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'not-found' });
    await providerEntered;
    const replay = await service.send(owner, input);
    expect(replay.status).toBe('pending');
    expect(reply).toHaveBeenCalledTimes(1);
    await service.clear(owner, { conversationId: conversation.conversationId });
    release('[MOCK] Late result');
    await rejected;
    expect(repository.conversations.size).toBe(0);
    expect((await service.clear(owner, { conversationId: conversation.conversationId })).cleared).toBe(true);
    await expect(service.clear('other', { conversationId: conversation.conversationId })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('fences a provider result that arrives after the access expiry without reviving an assistant reply', async () => {
    let release!: (text: string) => void;
    let entered!: () => void;
    const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const reply = vi.fn(() => new Promise<string>((resolve) => {
      release = resolve;
      entered();
    }));
    service = new MockConversationService(repository, { reply }, () => now);
    const { conversation } = await start();
    const input = message(conversation.conversationId);
    const pending = service.send(owner, input);
    await providerEntered;
    now += SESSION_MS + 1;
    release('[MOCK] Too late');
    await expect(pending).rejects.toMatchObject({ code: 'failed-precondition' });
    const stored = repository.conversations.get(conversation.conversationId)!;
    expect(stored.messages).toHaveLength(1);
    expect(stored.messages[0]?.role).toBe('user');
    expect(stored.attempts[input.attemptId]?.status).toBe('failed');
    expect(stored.activeAttempt).toBeNull();
  });

  it('keeps failed user message and allows explicit retry without duplication', async () => {
    const reply = vi.fn().mockRejectedValueOnce(new Error('Synthetic error')).mockResolvedValue('[MOCK] Retry result');
    service = new MockConversationService(repository, { reply }, () => now);
    const { conversation } = await start();
    const input = message(conversation.conversationId);
    await expect(service.send(owner, input)).rejects.toMatchObject({ code: 'unavailable' });
    const current = await service.get(owner, { conversationId: conversation.conversationId });
    const result = await service.send(owner, { ...input, attemptId: randomUUID(), contextVersion: current.conversation.contextVersion });
    expect(result.conversation.messages).toHaveLength(2);
  });

  it('allows exactly 40 total messages and rejects the next user/assistant pair', async () => {
    const { conversation } = await start();
    const record = repository.conversations.get(conversation.conversationId)!;
    record.messages = Array.from({ length: 38 }, (_, index) => ({
      id: randomUUID(),
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `Synthetic ${index}`,
      createdAt: new Date(now).toISOString(),
      sourceIds: [],
      provenance: index % 2 === 0 ? 'user_reported' as const : 'mock' as const,
    }));
    repository.conversations.set(record.id, record);
    const atLimit = await service.send(owner, message(record.id, record.version));
    expect(atLimit.conversation.messages).toHaveLength(40);
    await expect(service.send(owner, message(record.id, atLimit.conversation.contextVersion)))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('uses UTF-8 and conservative Firestore overhead in the 512 KiB application budget', async () => {
    const { conversation } = await start();
    const base = repository.conversations.get(conversation.conversationId)!;
    const ascii = structuredClone(base);
    const unicode = structuredClone(base);
    ascii.messages = [{
      id: randomUUID(), role: 'assistant', text: 'a'.repeat(1_000),
      createdAt: new Date(now).toISOString(), sourceIds: [], provenance: 'mock',
    }];
    unicode.messages = [{ ...ascii.messages[0]!, text: '🙂'.repeat(1_000) }];
    expect(estimateConversationDocumentBytes(unicode)).toBeGreaterThan(estimateConversationDocumentBytes(ascii));

    const nearLimit = structuredClone(base);
    nearLimit.messages = Array.from({ length: 32 }, () => ({
      id: randomUUID(), role: 'assistant' as const, text: 'a'.repeat(15_200),
      createdAt: new Date(now).toISOString(), sourceIds: [], provenance: 'mock' as const,
    }));
    expect(estimateConversationDocumentBytes(nearLimit)).toBeGreaterThanOrEqual(MAX_CONVERSATION_DOCUMENT_BYTES);
    expect(() => requireBounded(nearLimit)).toThrowError(expect.objectContaining({ code: 'resource-exhausted' }));
  });

  it('rejects injected authority fields at all request boundaries', () => {
    const startInput = { requestId: randomUUID() };
    const sendInput = message(randomUUID());
    for (const injection of [
      { ownerUid: 'attacker' }, { role: 'system' }, { history: [] },
      { allowedDomains: ['evil.example'] }, { evidenceLedger: [] },
    ]) {
      expect(callableContracts.startConversation.request.safeParse({ ...startInput, ...injection }).success).toBe(false);
      expect(callableContracts.sendMessage.request.safeParse({ ...sendInput, ...injection }).success).toBe(false);
      expect(callableContracts.getConversation.request.safeParse({ conversationId: sendInput.conversationId, ...injection }).success).toBe(false);
      expect(callableContracts.clearConversation.request.safeParse({ conversationId: sendInput.conversationId, ...injection }).success).toBe(false);
    }
  });
});

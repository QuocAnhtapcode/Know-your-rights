import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeReplyProvider } from '../src/ai/provider';
import { verifyRuntimeAccessCode } from '../src/security/access-code';
import { demoRuntimeSchema, usageBucketSchema } from '../src/security/demo-policy';
import { MockConversationService } from '../src/session/mock-service';
import { MemorySessionRepository } from './memory-repository';

describe('M2 synthetic cloud policy (unit fixtures only)', () => {
  let repository: MemorySessionRepository;
  let service: MockConversationService;
  const fixtureCode = 'synthetic-test-only-access';
  const now = Date.parse('2026-09-12T00:00:00.000Z');

  beforeEach(() => {
    repository = new MemorySessionRepository();
    repository.runtime = {
      enabled: true, syntheticOnly: true, maxStartsPerUidPerHour: 2,
      maxSendsPerUidPerHour: 2, maxFailedStartsPerUidPerHour: 2,
      maxFailedStartsGlobalPerHour: 3,
      maxStartsGlobalPerHour: 2, maxSendsGlobalPerHour: 2,
    };
    service = new MockConversationService(repository, new FakeReplyProvider(), () => now, {
      enforceRuntimePolicy: true,
      verifyAccessCode: (candidate) => verifyRuntimeAccessCode(candidate, () => fixtureCode),
    });
  });

  const startInput = () => ({ requestId: randomUUID(), accessCode: fixtureCode });

  it('checks runtime schema and refuses missing/disabled runtime before granting access', async () => {
    expect(demoRuntimeSchema.safeParse({ enabled: true }).success).toBe(false);
    repository.runtime = null;
    await expect(service.start('owner', startInput())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(repository.grants.size).toBe(0);
  });

  it('does not read secret when no candidate is supplied and compares synthetic values safely', () => {
    const readFixture = vi.fn(() => fixtureCode);
    expect(verifyRuntimeAccessCode(undefined, readFixture)).toBe(false);
    expect(readFixture).not.toHaveBeenCalled();
    expect(verifyRuntimeAccessCode('incorrect', readFixture)).toBe(false);
    expect(verifyRuntimeAccessCode(fixtureCode, readFixture)).toBe(true);
  });

  it('commits failed-start throttle even though the caller receives an error', async () => {
    for (let index = 0; index < 2; index += 1) {
      await expect(service.start('owner', { ...startInput(), accessCode: 'incorrect' })).rejects.toMatchObject({ code: 'permission-denied' });
    }
    await expect(service.start('owner', startInput())).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(repository.grants.size).toBe(0);
    expect([...repository.usage.values()][0]?.failedStarts).toBe(2);
  });

  it('caps failed access attempts across fresh anonymous UIDs', async () => {
    for (let index = 0; index < 3; index += 1) {
      await expect(service.start(`owner-${index}`, { ...startInput(), accessCode: 'wrong' })).rejects.toMatchObject({ code: 'permission-denied' });
    }
    await expect(service.start('new-owner', startInput())).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('rejects missing, negative, NaN and non-integer usage metadata rather than bypassing limits', async () => {
    const good = { starts: 0, sends: 0, failedStarts: 0, expiresAt: now + 3_600_000 };
    for (const bad of [
      {}, { ...good, sends: -1 }, { ...good, sends: NaN },
      { ...good, starts: 0.5 }, { ...good, expiresAt: Infinity },
    ]) expect(usageBucketSchema.safeParse(bad).success).toBe(false);
    const first = await service.start('owner', startInput());
    await service.clear('owner', { conversationId: first.conversation.conversationId });
    for (const bucket of repository.usage.values()) bucket.sends = NaN;
    await expect(service.start('owner', startInput())).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('reserves global start quota, preserves it across clear and does not bill start replay twice', async () => {
    const input = startInput();
    const first = await service.start('owner', input);
    await service.start('owner', { requestId: input.requestId });
    await service.clear('owner', { conversationId: first.conversation.conversationId });
    await service.start('second-owner', startInput());
    await expect(service.start('third-owner', startInput())).rejects.toMatchObject({ code: 'resource-exhausted' });
    const global = [...repository.usage.entries()].find(([id]) => id.endsWith('-global'))?.[1];
    expect(global?.starts).toBe(2);
  });

  it('does not reset quota or dedupe metadata when replacing the active conversation', async () => {
    const firstInput = startInput();
    const first = await service.start('owner', firstInput);
    const replacementInput = {
      requestId: randomUUID(),
      replaceConversationId: first.conversation.conversationId,
    };
    const replacement = await service.start('owner', replacementInput);
    expect((await service.start('owner', replacementInput)).conversation.conversationId)
      .toBe(replacement.conversation.conversationId);
    const grant = repository.grants.get('owner')!;
    expect(Object.keys(grant.startRequests)).toHaveLength(2);
    expect(grant.activeConversationId).toBe(replacement.conversation.conversationId);
    const uidUsage = [...repository.usage.entries()].find(([id]) => id.includes('-uid-'))?.[1];
    expect(uidUsage?.starts).toBe(2);
    await expect(service.start('owner', {
      requestId: randomUUID(),
      replaceConversationId: replacement.conversation.conversationId,
    })).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(repository.conversations.has(replacement.conversation.conversationId)).toBe(true);
  });

  it('requires grant for get, but clear works with revoked grant and disabled runtime', async () => {
    const first = await service.start('owner', startInput());
    const input = { conversationId: first.conversation.conversationId };
    repository.grants.delete('owner');
    await expect(service.get('owner', input)).rejects.toMatchObject({ code: 'permission-denied' });
    repository.runtime!.enabled = false;
    expect((await service.clear('owner', input)).cleared).toBe(true);
    expect(repository.conversations.size).toBe(0);
  });

  it('enforces send cap and kill switch before provider, without blocking clear', async () => {
    const reply = vi.fn(new FakeReplyProvider().reply);
    service = new MockConversationService(repository, { reply }, () => now, {
      enforceRuntimePolicy: true, verifyAccessCode: (candidate) => candidate === fixtureCode,
    });
    const first = await service.start('owner', startInput());
    let conversation = first.conversation;
    const makeMessage = () => ({
      conversationId: conversation.conversationId, contextVersion: conversation.contextVersion,
      userMessageId: randomUUID(), attemptId: randomUUID(), message: 'Synthetic only',
    });
    for (let index = 0; index < 2; index += 1) {
      conversation = (await service.send('owner', makeMessage())).conversation;
    }
    await expect(service.send('owner', makeMessage())).rejects.toMatchObject({ code: 'resource-exhausted' });
    repository.runtime!.enabled = false;
    await expect(service.send('owner', makeMessage())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(reply).toHaveBeenCalledTimes(2);
    await service.clear('owner', { conversationId: conversation.conversationId });
    expect(repository.conversations.size).toBe(0);
  });

  it('replays a completed attempt after the kill switch without another provider call', async () => {
    const reply = vi.fn(new FakeReplyProvider().reply);
    service = new MockConversationService(repository, { reply }, () => now, {
      enforceRuntimePolicy: true, verifyAccessCode: (candidate) => candidate === fixtureCode,
    });
    const first = await service.start('owner', startInput());
    const input = {
      conversationId: first.conversation.conversationId,
      contextVersion: first.conversation.contextVersion,
      userMessageId: randomUUID(), attemptId: randomUUID(), message: 'Synthetic replay',
    };
    const completed = await service.send('owner', input);
    repository.runtime!.enabled = false;
    expect(await service.send('owner', input)).toEqual(completed);
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

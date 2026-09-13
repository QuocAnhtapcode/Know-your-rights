import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { callableContracts, sendMessageRequestSchema, startConversationRequestSchema } from '../../shared/contracts';

describe('shared strict v4 contracts', () => {
  const send = () => ({ conversationId: randomUUID(), message: 'Synthetic question', userMessageId: randomUUID(), attemptId: randomUUID(), contextVersion: 0 });
  it('accepts only the four bounded client contracts', () => {
    expect(Object.keys(callableContracts)).toEqual(['startConversation', 'getConversation', 'sendMessage', 'clearConversation']);
    expect(startConversationRequestSchema.parse({ requestId: randomUUID() })).toBeDefined();
    expect(startConversationRequestSchema.parse({
      requestId: randomUUID(), replaceConversationId: randomUUID(),
    })).toBeDefined();
    expect(sendMessageRequestSchema.parse(send())).toBeDefined();
  });
  it.each(['ownerUid', 'role', 'history', 'messages', 'system', 'allowedDomains', 'domainList', 'sourceLedger', 'evidenceLedger', 'model'])('rejects server-owned %s', (key) => {
    expect(sendMessageRequestSchema.safeParse({ ...send(), [key]: 'forged' }).success).toBe(false);
  });
  it('rejects empty/oversized text, negative versions and malformed identifiers', () => {
    for (const patch of [{ message: '  ' }, { message: 'x'.repeat(4001) }, { contextVersion: -1 }, { conversationId: '../other' }]) {
      expect(sendMessageRequestSchema.safeParse({ ...send(), ...patch }).success).toBe(false);
    }
  });
});

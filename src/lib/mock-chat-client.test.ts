import { describe, expect, it } from 'vitest';
import { createMockChatClient } from './mock-chat-client';

describe('synthetic in-memory browser client', () => {
  it('deduplicates start and send using the public contract', async () => {
    const client = createMockChatClient();
    const request = { requestId: crypto.randomUUID() };
    const start = await client.startConversation(request);
    const repeated = await client.startConversation(request);
    expect(repeated.conversation.conversationId).toBe(start.conversation.conversationId);
    const send = { conversationId: start.conversation.conversationId, message: 'Tình huống hư cấu', userMessageId: crypto.randomUUID(), attemptId: crypto.randomUUID(), contextVersion: 0 };
    const response = await client.sendMessage(send);
    const retry = await client.sendMessage(send);
    expect(retry).toEqual(response);
    expect(response.mode).toBe('mock');
    expect(response.conversation.messages).toHaveLength(2);
    expect(response.conversation.evidenceLedger).toEqual([]);
    expect(response.conversation.messages[1]?.provenance).toBe('mock');
  });

  it('rejects privileged request fields and stale context', async () => {
    const client = createMockChatClient();
    await expect(client.startConversation({ requestId: crypto.randomUUID(), ownerUid: 'fake' } as never)).rejects.toThrow();
    const { conversation } = await client.startConversation({ requestId: crypto.randomUUID() });
    await expect(client.sendMessage({ conversationId: conversation.conversationId, message: 'Tình huống hư cấu', userMessageId: crypto.randomUUID(), attemptId: crypto.randomUUID(), contextVersion: 9 })).rejects.toThrow('Ngữ cảnh');
  });

  it('cannot restore across a page-lifetime client or resurrect after clear', async () => {
    const client = createMockChatClient();
    const { conversation } = await client.startConversation({ requestId: crypto.randomUUID() });
    await expect(createMockChatClient().getConversation({ conversationId: conversation.conversationId })).rejects.toThrow('Phiên mock');
    expect((await client.clearConversation({ conversationId: conversation.conversationId })).cleared).toBe(true);
    await expect(client.getConversation({ conversationId: conversation.conversationId })).rejects.toThrow('Phiên mock');
    await expect(client.sendMessage({ conversationId: conversation.conversationId, message: 'Tin nhắn muộn', userMessageId: crypto.randomUUID(), attemptId: crypto.randomUUID(), contextVersion: 0 })).rejects.toThrow('Phiên mock');
  });

  it('requires an exact replacement ID, preserves the old session on failure and deduplicates replacement', async () => {
    const client = createMockChatClient();
    const first = await client.startConversation({ requestId: crypto.randomUUID() });
    await expect(client.startConversation({ requestId: crypto.randomUUID() })).rejects.toThrow('xác nhận thay phiên');
    await expect(client.startConversation({ requestId: crypto.randomUUID(), replaceConversationId: crypto.randomUUID() })).rejects.toThrow('không khớp');
    expect((await client.getConversation({ conversationId: first.conversation.conversationId })).conversation).toEqual(first.conversation);

    const replaceRequest = { requestId: crypto.randomUUID(), replaceConversationId: first.conversation.conversationId };
    const replacement = await client.startConversation(replaceRequest);
    const duplicate = await client.startConversation(replaceRequest);
    expect(duplicate).toEqual(replacement);
    expect(replacement.conversation.conversationId).not.toBe(first.conversation.conversationId);
    await expect(client.getConversation({ conversationId: first.conversation.conversationId })).rejects.toThrow('Phiên mock');

    await client.clearConversation({ conversationId: replacement.conversation.conversationId });
    const afterClear = await client.startConversation({ requestId: crypto.randomUUID() });
    expect(afterClear.conversation.conversationId).not.toBe(replacement.conversation.conversationId);
  });
});

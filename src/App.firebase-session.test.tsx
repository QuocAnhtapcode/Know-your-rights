// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ChatClient, ConversationView } from '../shared/contracts';

const backend = vi.hoisted(() => {
  const state: { conversation: ConversationView | null } = { conversation: null };
  return {
    state,
    getConversation: vi.fn(),
    startConversation: vi.fn(),
    sendMessage: vi.fn(),
    clearConversation: vi.fn(),
  };
});

vi.mock('./lib/chat-client', () => {
  const client: ChatClient = {
    startConversation: backend.startConversation,
    getConversation: backend.getConversation,
    sendMessage: backend.sendMessage,
    clearConversation: backend.clearConversation,
  };
  return {
    chatMode: 'firebase',
    getClientSession: vi.fn(async () => ({ client, close: async () => undefined })),
    closeClientSession: vi.fn(async () => undefined),
  };
});

import { App } from './App';

function emptyConversation(): ConversationView {
  return {
    conversationId: crypto.randomUUID(),
    contextVersion: 0,
    status: 'active',
    messages: [],
    userFacts: [],
    conversationState: { language: 'vi', currentTopic: null, pendingQuestion: null },
    evidenceLedger: [],
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  backend.state.conversation = null;
  Element.prototype.scrollTo = vi.fn();
  backend.startConversation.mockImplementation(async () => {
    backend.state.conversation = emptyConversation();
    return { mode: 'mock' as const, conversation: structuredClone(backend.state.conversation) };
  });
  backend.getConversation.mockImplementation(async ({ conversationId }: { conversationId: string }) => {
    if (!backend.state.conversation || backend.state.conversation.conversationId !== conversationId) throw new Error('not found');
    return { mode: 'mock' as const, conversation: structuredClone(backend.state.conversation) };
  });
  backend.sendMessage.mockImplementation(async (request: {
    conversationId: string;
    message: string;
    userMessageId: string;
    attemptId: string;
    contextVersion: number;
  }) => {
    const conversation = backend.state.conversation;
    if (!conversation || conversation.conversationId !== request.conversationId) throw new Error('not found');
    const createdAt = new Date().toISOString();
    conversation.messages.push(
      { id: request.userMessageId, role: 'user', text: request.message, createdAt, sourceIds: [], provenance: 'user_reported' },
      { id: crypto.randomUUID(), role: 'assistant', text: '[MOCK] Synthetic durable reply', createdAt, sourceIds: [], provenance: 'mock' },
    );
    conversation.contextVersion += 2;
    return { mode: 'mock' as const, status: 'completed' as const, attemptId: request.attemptId, conversation: structuredClone(conversation) };
  });
  backend.clearConversation.mockImplementation(async ({ conversationId }: { conversationId: string }) => {
    backend.state.conversation = null;
    return { mode: 'mock' as const, conversationId, cleared: true as const };
  });
});

afterEach(cleanup);

describe('Firebase-mode same-tab restore boundary', () => {
  it('restores transcript from the callable backend using only the session pointer', async () => {
    const firstPage = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu trò chuyện' }));
    await screen.findByRole('heading', { name: /Cuộc trò chuyện mới/ });

    const syntheticMessage = 'Synthetic same-tab refresh message';
    fireEvent.change(screen.getByRole('textbox', { name: 'Tin nhắn của bạn' }), { target: { value: syntheticMessage } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
    await screen.findByText('[MOCK] Synthetic durable reply');

    const pointer = sessionStorage.getItem('kyr:conversation');
    expect(pointer).toBe(backend.state.conversation?.conversationId);
    expect(JSON.stringify(sessionStorage)).not.toContain(syntheticMessage);
    expect(localStorage.length).toBe(0);

    firstPage.unmount();
    render(<MemoryRouter initialEntries={['/chat']}><App /></MemoryRouter>);

    await screen.findByText(syntheticMessage);
    expect(screen.getByText('[MOCK] Synthetic durable reply')).toBeTruthy();
    expect(backend.getConversation).toHaveBeenCalledWith({ conversationId: pointer });
    expect(backend.startConversation).toHaveBeenCalledTimes(1);
  });
});

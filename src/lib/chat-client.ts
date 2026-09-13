import type { ChatClient } from '../../shared/contracts';
import { createMockChatClient } from './mock-chat-client';

export type ChatMode = 'mock' | 'firebase' | 'emulator';
export interface ClientSession { client: ChatClient; close: () => Promise<void> }

export function resolveChatMode(value: string | undefined): ChatMode {
  if (!value || value === 'mock') return 'mock';
  if (value === 'firebase' || value === 'emulator') return value;
  throw new Error('VITE_CHAT_MODE không hợp lệ. Chỉ chấp nhận mock, firebase hoặc emulator.');
}

export const chatMode = resolveChatMode(import.meta.env.VITE_CHAT_MODE);
let session: Promise<ClientSession> | undefined;

export function getClientSession() {
  session ??= (chatMode === 'mock'
    ? Promise.resolve({ client: createMockChatClient(), close: async () => undefined })
    : import('./firebase-client').then((module) => module.createFirebaseClient(chatMode))
  ).catch((error: unknown) => {
    session = undefined;
    throw error;
  });
  return session;
}

export async function closeClientSession() {
  const previous = session;
  session = undefined;
  if (previous) await (await previous).close();
}

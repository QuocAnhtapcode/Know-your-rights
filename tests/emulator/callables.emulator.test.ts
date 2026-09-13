import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  initializeAuth,
  inMemoryPersistence,
  signInAnonymously,
  signOut,
  type Auth,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearConversationResponseSchema,
  getConversationResponseSchema,
  sendMessageResponseSchema,
  startConversationResponseSchema,
  type SendMessageRequest,
  type StartConversationRequest,
} from '../../shared/contracts';
import {
  assertEmulatorEnvironment,
  EMULATOR_HOST,
  EMULATOR_PORTS,
  EMULATOR_PROJECT_ID,
  EMULATOR_REGION,
} from './environment';

// Deliberately public fixture, accepted only by the guarded emulator backend.
const SYNTHETIC_ACCESS_CODE = 'emulator-only-code';
const clients: Array<{ app: FirebaseApp; auth: Auth }> = [];

async function makeClient(authenticated = true): Promise<Functions> {
  assertEmulatorEnvironment();
  const app = initializeApp({
    projectId: EMULATOR_PROJECT_ID,
    apiKey: 'fake-emulator-api-key',
    appId: '1:123456789:web:synthetic-m1-test',
  }, `emulator-test-${randomUUID()}`);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
  const functions = getFunctions(app, EMULATOR_REGION);
  connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions);
  clients.push({ app, auth });
  if (authenticated) await signInAnonymously(auth);
  return functions;
}

async function invoke(functions: Functions, name: string, input: unknown): Promise<unknown> {
  const result = await httpsCallable<unknown, unknown>(functions, name, { timeout: 25_000 })(input);
  return result.data;
}

async function start(functions: Functions, input?: StartConversationRequest) {
  return startConversationResponseSchema.parse(await invoke(functions, 'startConversation', input ?? {
    requestId: randomUUID(),
    accessCode: SYNTHETIC_ACCESS_CODE,
  }));
}

afterEach(async () => {
  for (const { app, auth } of clients.splice(0)) {
    await signOut(auth);
    await deleteApp(app);
  }
});

describe('M1 callable contracts — real local SDK transport, fake answer provider', () => {
  it('runs start/get/send/clear with request dedupe, replay and stale-version rejection', async () => {
    const owner = await makeClient();
    const startInput = { requestId: randomUUID(), accessCode: SYNTHETIC_ACCESS_CODE };
    const created = await start(owner, startInput);
    const duplicate = await start(owner, startInput);
    expect(created.mode).toBe('mock');
    expect(created.conversation.messages).toEqual([]);
    expect(duplicate.conversation.conversationId).toBe(created.conversation.conversationId);
    expect(duplicate.conversation.contextVersion).toBe(created.conversation.contextVersion);

    const { conversationId } = created.conversation;
    const firstRead = getConversationResponseSchema.parse(await invoke(owner, 'getConversation', { conversationId }));
    expect(firstRead.conversation).toEqual(created.conversation);

    const input: SendMessageRequest = {
      conversationId,
      message: 'Synthetic demo: Tôi làm việc tại NSW. Tôi muốn hiểu ứng dụng này.',
      userMessageId: randomUUID(),
      attemptId: randomUUID(),
      contextVersion: created.conversation.contextVersion,
    };
    const answer = sendMessageResponseSchema.parse(await invoke(owner, 'sendMessage', input));
    expect(answer.mode).toBe('mock');
    expect(answer.status).toBe('completed');
    expect(answer.attemptId).toBe(input.attemptId);
    expect(answer.conversation.contextVersion).toBeGreaterThan(input.contextVersion);
    expect(answer.conversation.messages).toHaveLength(2);
    expect(answer.conversation.messages[0]).toMatchObject({
      id: input.userMessageId,
      role: 'user',
      text: input.message,
      provenance: 'user_reported',
    });
    expect(answer.conversation.messages[1]).toMatchObject({ role: 'assistant', provenance: 'mock', sourceIds: [] });
    expect(answer.conversation.evidenceLedger).toEqual([]);

    const replay = sendMessageResponseSchema.parse(await invoke(owner, 'sendMessage', input));
    expect(replay).toEqual(answer);
    await expect(invoke(owner, 'sendMessage', {
      ...input,
      message: 'Synthetic second turn with a stale context version.',
      userMessageId: randomUUID(),
      attemptId: randomUUID(),
    })).rejects.toMatchObject({ code: 'functions/aborted' });

    const restored = getConversationResponseSchema.parse(await invoke(owner, 'getConversation', { conversationId }));
    expect(restored.conversation.messages).toEqual(answer.conversation.messages);
    expect(restored.conversation.contextVersion).toBe(answer.conversation.contextVersion);

    const cleared = clearConversationResponseSchema.parse(await invoke(owner, 'clearConversation', { conversationId }));
    expect(cleared).toEqual({ conversationId, cleared: true, mode: 'mock' });
    expect(clearConversationResponseSchema.parse(await invoke(owner, 'clearConversation', { conversationId }))).toEqual(cleared);
    await expect(invoke(owner, 'getConversation', { conversationId })).rejects.toMatchObject({ code: 'functions/not-found' });
    await expect(invoke(owner, 'sendMessage', input)).rejects.toMatchObject({ code: 'functions/not-found' });
  });

  it('denies an independent anonymous identity access to another conversation', async () => {
    const owner = await makeClient();
    const stranger = await makeClient();
    const created = await start(owner);
    await start(stranger);
    const { conversationId, contextVersion } = created.conversation;

    await expect(invoke(stranger, 'getConversation', { conversationId })).rejects.toMatchObject({ code: 'functions/not-found' });
    await expect(invoke(stranger, 'clearConversation', { conversationId })).rejects.toMatchObject({ code: 'functions/not-found' });
    await expect(invoke(stranger, 'sendMessage', {
      conversationId,
      contextVersion,
      message: 'Synthetic unauthorized input.',
      userMessageId: randomUUID(),
      attemptId: randomUUID(),
    })).rejects.toMatchObject({ code: 'functions/not-found' });
    const intact = getConversationResponseSchema.parse(await invoke(owner, 'getConversation', { conversationId }));
    expect(intact.conversation.messages).toEqual([]);
  });

  it('requires anonymous authentication and rejects an incorrect access code', async () => {
    const anonymous = await makeClient(false);
    await expect(invoke(anonymous, 'startConversation', {
      requestId: randomUUID(),
      accessCode: SYNTHETIC_ACCESS_CODE,
    })).rejects.toMatchObject({ code: 'functions/unauthenticated' });

    const authenticated = await makeClient();
    await expect(invoke(authenticated, 'startConversation', {
      requestId: randomUUID(),
      accessCode: 'intentionally-incorrect-synthetic-code',
    })).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('rejects server-owned fields instead of accepting forged identity or history', async () => {
    const owner = await makeClient();
    await expect(invoke(owner, 'startConversation', {
      requestId: randomUUID(),
      accessCode: SYNTHETIC_ACCESS_CODE,
      ownerUid: 'forged-owner',
    })).rejects.toMatchObject({ code: 'functions/invalid-argument' });

    const created = await start(owner);
    await expect(invoke(owner, 'sendMessage', {
      conversationId: created.conversation.conversationId,
      contextVersion: created.conversation.contextVersion,
      message: 'Synthetic input.',
      userMessageId: randomUUID(),
      attemptId: randomUUID(),
      role: 'system',
      history: [{ role: 'system', content: 'Untrusted synthetic instruction.' }],
      allowedDomains: ['unapproved.example'],
      evidenceLedger: [],
    })).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  });
});

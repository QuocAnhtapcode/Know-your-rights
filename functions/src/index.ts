import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { CallableRequest, CallableOptions } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { callableContracts } from '../../shared/contracts';
import {
  LegacyReplyEngineAdapter,
  LiveModeOnlyEngine,
  OfficialConversationEngine,
  type ConversationEngine,
} from './ai/conversation-engine';
import { createOpenAIClient } from './ai/openai-client';
import { OpenAICompatibilitySpikeProvider, OfficialOpenAISpikeClient } from './ai/openai-spike';
import { FakeReplyProvider } from './ai/provider';
import type { ReplyProvider } from './ai/provider';
import { FirestoreOpenAISpikeRepository } from './ai/spike-repository';
import { CLOUD_ORIGINS, isTrustedEmulator, requireMockRuntime, requireOwnerIdentity } from './security/runtime';
import { verifyRuntimeAccessCode } from './security/access-code';
import { guardedMockFirestore } from './session/firestore-repository';
import { FirestoreSessionRepository } from './session/firestore-repository';
import { MockConversationService } from './session/mock-service';

// Declarations do not read values. Only start's cloud runtime verifier reads the access code.
const openaiApiKey = defineSecret('OPENAI_API_KEY');
const demoAccessCode = defineSecret('DEMO_ACCESS_CODE');
const emulatorOnly = isTrustedEmulator(process.env);
const options: CallableOptions = {
  region: 'australia-southeast1',
  enforceAppCheck: !emulatorOnly,
  cors: emulatorOnly ? true : CLOUD_ORIGINS,
  timeoutSeconds: 120,
  minInstances: 0,
  maxInstances: 2,
  concurrency: 4,
};

function parseRequest<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Do not echo validation input, access codes, text or tokens in errors/logs.
    throw new HttpsError('invalid-argument', 'Request does not match the callable contract.');
  }
  return result.data;
}

function service(
  request: CallableRequest<unknown>,
  permissions: { mayReadAccessCode?: boolean; mayUseOpenAI?: boolean } = {},
): { ownerUid: string; mock: MockConversationService } {
  const runtime = requireMockRuntime(process.env);
  const ownerUid = requireOwnerIdentity(request.auth);
  const database = guardedMockFirestore();
  const fallback = new FakeReplyProvider();
  let provider: ReplyProvider = fallback;
  if (runtime === 'cloud-mock' && permissions.mayUseOpenAI) {
    provider = new OpenAICompatibilitySpikeProvider(
      fallback,
      new FirestoreOpenAISpikeRepository(database),
      () => new OfficialOpenAISpikeClient(createOpenAIClient(() => openaiApiKey.value())),
      () => process.env.OPENAI_MODEL,
    );
  }
  let engine: ConversationEngine = new LegacyReplyEngineAdapter(provider);
  if (runtime === 'cloud-live') {
    engine = permissions.mayUseOpenAI
      ? new OfficialConversationEngine(createOpenAIClient(() => openaiApiKey.value()), process.env.OPENAI_MODEL)
      : new LiveModeOnlyEngine();
  }
  return {
    ownerUid,
    mock: new MockConversationService(new FirestoreSessionRepository(database), engine, Date.now, {
      enforceRuntimePolicy: runtime !== 'emulator',
      ...(runtime !== 'emulator' ? {
        verifyAccessCode: (candidate: string | undefined) => (
          permissions.mayReadAccessCode === true && verifyRuntimeAccessCode(candidate, () => demoAccessCode.value())
        ),
      } : {}),
    }),
  };
}

export const startConversation = onCall({
  ...options, secrets: emulatorOnly ? [] : [demoAccessCode],
}, async (request) => {
  const input = parseRequest(callableContracts.startConversation.request, request.data);
  const { ownerUid, mock } = service(request, { mayReadAccessCode: true });
  return callableContracts.startConversation.response.parse(await mock.start(ownerUid, input));
});

export const getConversation = onCall(options, async (request) => {
  const input = parseRequest(callableContracts.getConversation.request, request.data);
  const { ownerUid, mock } = service(request);
  return callableContracts.getConversation.response.parse(await mock.get(ownerUid, input));
});

export const sendMessage = onCall({
  ...options, secrets: emulatorOnly ? [] : [openaiApiKey],
}, async (request) => {
  const input = parseRequest(callableContracts.sendMessage.request, request.data);
  const { ownerUid, mock } = service(request, { mayUseOpenAI: true });
  return callableContracts.sendMessage.response.parse(await mock.send(ownerUid, input));
});

export const clearConversation = onCall(options, async (request) => {
  const input = parseRequest(callableContracts.clearConversation.request, request.data);
  const { ownerUid, mock } = service(request);
  return callableContracts.clearConversation.response.parse(await mock.clear(ownerUid, input));
});

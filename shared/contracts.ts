import { z } from 'zod';

/** Public wire contracts only: never add owner IDs, grants, prompts or secrets. */
export const CONTRACT_VERSION = 'v4-m8' as const;
export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_MESSAGES = 40;
const id = z.uuid();
const timestamp = z.iso.datetime();

export const startConversationRequestSchema = z.strictObject({
  requestId: id,
  accessCode: z.string().min(1).max(256).optional(),
  /** Exact current conversation selected in the UI's explicit replacement confirmation. */
  replaceConversationId: id.optional(),
});
export const getConversationRequestSchema = z.strictObject({ conversationId: id });
export const sendMessageRequestSchema = z.strictObject({
  conversationId: id,
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  userMessageId: id,
  attemptId: id,
  contextVersion: z.number().int().min(0),
});
export const clearConversationRequestSchema = z.strictObject({ conversationId: id });

export const messageSchema = z.strictObject({
  id,
  role: z.enum(['user', 'assistant']),
  text: z.string().max(16_000),
  createdAt: timestamp,
  sourceIds: z.array(z.string()).max(20),
  provenance: z.enum(['user_reported', 'assistant_generated', 'mock', 'web_grounded']),
});
export const userFactSchema = z.strictObject({
  id,
  key: z.string().max(100),
  value: z.string().max(500),
  sourceMessageId: id,
  quote: z.string().max(MAX_MESSAGE_LENGTH),
  status: z.enum(['user_reported', 'superseded']),
});
export const evidenceSchema = z.strictObject({
  id: z.string().max(100),
  title: z.string().max(500),
  url: z.url().refine((value) => new URL(value).protocol === 'https:', 'HTTPS required'),
  retrievedAt: timestamp,
  jurisdiction: z.string().max(100),
});
export const conversationViewSchema = z.strictObject({
  conversationId: id,
  contextVersion: z.number().int().min(0),
  status: z.literal('active'),
  messages: z.array(messageSchema).max(MAX_MESSAGES),
  userFacts: z.array(userFactSchema).max(100),
  conversationState: z.strictObject({
    language: z.enum(['vi', 'en']),
    currentTopic: z.string().max(200).nullable(),
    pendingQuestion: z.string().max(500).nullable(),
  }),
  evidenceLedger: z.array(evidenceSchema).max(100),
  expiresAt: timestamp,
});
export const startConversationResponseSchema = z.strictObject({
  mode: z.enum(['mock', 'live']),
  conversation: conversationViewSchema,
});
export const getConversationResponseSchema = startConversationResponseSchema;
export const sendMessageResponseSchema = z.strictObject({
  mode: z.enum(['mock', 'live']),
  status: z.enum(['completed', 'pending']),
  attemptId: id,
  conversation: conversationViewSchema,
});
export const clearConversationResponseSchema = z.strictObject({
  conversationId: id,
  cleared: z.literal(true),
  mode: z.enum(['mock', 'live']),
});

export type StartConversationRequest = z.infer<typeof startConversationRequestSchema>;
export type GetConversationRequest = z.infer<typeof getConversationRequestSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type ClearConversationRequest = z.infer<typeof clearConversationRequestSchema>;
export type StartConversationResponse = z.infer<typeof startConversationResponseSchema>;
export type GetConversationResponse = z.infer<typeof getConversationResponseSchema>;
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
export type ClearConversationResponse = z.infer<typeof clearConversationResponseSchema>;
export type ConversationView = z.infer<typeof conversationViewSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;

export interface ChatClient {
  startConversation(input: StartConversationRequest): Promise<StartConversationResponse>;
  getConversation(input: GetConversationRequest): Promise<GetConversationResponse>;
  sendMessage(input: SendMessageRequest): Promise<SendMessageResponse>;
  clearConversation(input: ClearConversationRequest): Promise<ClearConversationResponse>;
}

export const callableContracts = {
  startConversation: { request: startConversationRequestSchema, response: startConversationResponseSchema },
  getConversation: { request: getConversationRequestSchema, response: getConversationResponseSchema },
  sendMessage: { request: sendMessageRequestSchema, response: sendMessageResponseSchema },
  clearConversation: { request: clearConversationRequestSchema, response: clearConversationResponseSchema },
} as const;

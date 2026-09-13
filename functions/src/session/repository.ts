import type { ConversationView } from '../../../shared/contracts';

export interface AttemptRecord {
  userMessageId: string;
  messageDigest: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
}

export interface ConversationRecord extends Omit<ConversationView, 'conversationId' | 'contextVersion' | 'expiresAt'> {
  id: string;
  ownerUid: string;
  generation: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  attempts: Record<string, AttemptRecord>;
  activeAttempt: { attemptId: string; fencingToken: string; leaseUntil: number } | null;
}

export interface DemoGrant {
  expiresAt: number;
  activeConversationId: string | null;
  startRequests: Record<string, string>;
}

export interface DemoRuntime {
  enabled: boolean;
  syntheticOnly: true;
  maxStartsPerUidPerHour: number;
  maxSendsPerUidPerHour: number;
  maxFailedStartsPerUidPerHour: number;
  maxFailedStartsGlobalPerHour: number;
  maxStartsGlobalPerHour: number;
  maxSendsGlobalPerHour: number;
}

export interface UsageBucket {
  starts: number;
  sends: number;
  failedStarts: number;
  expiresAt: number;
}

/** Adapters provide atomic transactions. Providers must never run in callbacks. */
export interface SessionTransaction {
  getConversation(id: string): Promise<ConversationRecord | null>;
  getGrant(uid: string): Promise<DemoGrant | null>;
  getRuntime(): Promise<DemoRuntime | null>;
  getUsage(id: string): Promise<UsageBucket | null>;
  putConversation(record: ConversationRecord): void;
  putGrant(uid: string, grant: DemoGrant): void;
  putUsage(id: string, bucket: UsageBucket): void;
  deleteConversation(id: string): void;
}

export interface SessionRepository {
  transaction<T>(callback: (transaction: SessionTransaction) => Promise<T>): Promise<T>;
}

export function publicView(record: ConversationRecord): ConversationView {
  return {
    conversationId: record.id,
    contextVersion: record.version,
    status: record.status,
    messages: record.messages,
    userFacts: record.userFacts,
    conversationState: record.conversationState,
    evidenceLedger: record.evidenceLedger,
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

import type {
  ConversationRecord, DemoGrant, DemoRuntime, UsageBucket, SessionRepository, SessionTransaction,
} from '../src/session/repository';

/** Test-only adapter, never imported by the deployed Functions entrypoint. */
export class MemorySessionRepository implements SessionRepository {
  conversations = new Map<string, ConversationRecord>();
  grants = new Map<string, DemoGrant>();
  usage = new Map<string, UsageBucket>();
  runtime: DemoRuntime | null = null;
  inTransaction = false;
  private previous: Promise<unknown> = Promise.resolve();

  transaction<T>(callback: (transaction: SessionTransaction) => Promise<T>): Promise<T> {
    const result = this.previous.then(async () => {
      this.inTransaction = true;
      const conversations = structuredClone(this.conversations);
      const grants = structuredClone(this.grants);
      const usage = structuredClone(this.usage);
      try {
        const value = await callback({
          getConversation: (id) => Promise.resolve(structuredClone(conversations.get(id) ?? null)),
          getGrant: (uid) => Promise.resolve(structuredClone(grants.get(uid) ?? null)),
          getRuntime: () => Promise.resolve(structuredClone(this.runtime)),
          getUsage: (id) => Promise.resolve(structuredClone(usage.get(id) ?? null)),
          putConversation: (record) => { conversations.set(record.id, structuredClone(record)); },
          putGrant: (uid, grant) => { grants.set(uid, structuredClone(grant)); },
          putUsage: (id, bucket) => { usage.set(id, structuredClone(bucket)); },
          deleteConversation: (id) => { conversations.delete(id); },
        });
        this.conversations = conversations;
        this.grants = grants;
        this.usage = usage;
        return value;
      } finally {
        this.inTransaction = false;
      }
    });
    this.previous = result.catch(() => undefined);
    return result;
  }
}

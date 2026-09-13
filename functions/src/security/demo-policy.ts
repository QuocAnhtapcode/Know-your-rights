import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { DemoRuntime, SessionTransaction, UsageBucket } from '../session/repository';

const limit = z.number().int().min(1).max(10_000);
export const demoRuntimeSchema = z.strictObject({
  enabled: z.boolean(), syntheticOnly: z.literal(true),
  maxStartsPerUidPerHour: limit,
  maxSendsPerUidPerHour: limit,
  maxFailedStartsPerUidPerHour: limit,
  maxFailedStartsGlobalPerHour: limit,
  maxStartsGlobalPerHour: limit,
  maxSendsGlobalPerHour: limit,
});

export const usageBucketSchema = z.strictObject({
  starts: z.number().int().min(0).max(10_000_000),
  sends: z.number().int().min(0).max(10_000_000),
  failedStarts: z.number().int().min(0).max(10_000_000),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export interface PolicySnapshot {
  config: DemoRuntime;
  uidId: string;
  globalId: string;
  uid: UsageBucket;
  global: UsageBucket;
}

export async function readDemoPolicy(transaction: SessionTransaction, ownerUid: string, now: number): Promise<PolicySnapshot> {
  const config = demoRuntimeSchema.safeParse(await transaction.getRuntime());
  if (!config.success || !config.data.enabled) {
    throw new HttpsError('failed-precondition', 'Synthetic demo is not enabled. Help and deletion remain available.');
  }
  const hour = Math.floor(now / 3_600_000);
  const uidId = `${hour}-uid-${createHash('sha256').update(ownerUid).digest('hex')}`;
  const globalId = `${hour}-global`;
  const empty = (): UsageBucket => ({ starts: 0, sends: 0, failedStarts: 0, expiresAt: now + 24 * 3_600_000 });
  const uid = usageBucketSchema.safeParse(await transaction.getUsage(uidId) ?? empty());
  const global = usageBucketSchema.safeParse(await transaction.getUsage(globalId) ?? empty());
  if (!uid.success || !global.success || uid.data.expiresAt <= now || global.data.expiresAt <= now) {
    throw new HttpsError('failed-precondition', 'Demo quota metadata is invalid. Contact the operator.');
  }
  return { config: config.data, uidId, globalId, uid: uid.data, global: global.data };
}

export function checkFailedStarts(policy: PolicySnapshot): void {
  if (policy.uid.failedStarts >= policy.config.maxFailedStartsPerUidPerHour
    || policy.global.failedStarts >= policy.config.maxFailedStartsGlobalPerHour) {
    throw new HttpsError('resource-exhausted', 'Too many access-code attempts. Try again later.');
  }
}

export function recordFailedStart(transaction: SessionTransaction, policy: PolicySnapshot): void {
  transaction.putUsage(policy.uidId, { ...policy.uid, failedStarts: policy.uid.failedStarts + 1 });
  transaction.putUsage(policy.globalId, { ...policy.global, failedStarts: policy.global.failedStarts + 1 });
}

export function reserveQuota(transaction: SessionTransaction, policy: PolicySnapshot, kind: 'starts' | 'sends'): void {
  const uidLimit = kind === 'starts' ? policy.config.maxStartsPerUidPerHour : policy.config.maxSendsPerUidPerHour;
  const globalLimit = kind === 'starts' ? policy.config.maxStartsGlobalPerHour : policy.config.maxSendsGlobalPerHour;
  if (policy.uid[kind] >= uidLimit || policy.global[kind] >= globalLimit) {
    throw new HttpsError('resource-exhausted', 'Synthetic demo quota reached. Help and deletion remain available.');
  }
  transaction.putUsage(policy.uidId, { ...policy.uid, [kind]: policy.uid[kind] + 1 });
  transaction.putUsage(policy.globalId, { ...policy.global, [kind]: policy.global[kind] + 1 });
}

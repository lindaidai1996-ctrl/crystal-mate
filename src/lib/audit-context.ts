import { AsyncLocalStorage } from 'node:async_hooks';

export type AuditActor = { id: string; username: string; nickname: string };
export type AuditContext = {
  operationId: string;
  source: string;
  actor?: AuditActor;
};

export const auditContext = new AsyncLocalStorage<AuditContext>();

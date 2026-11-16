import { Prisma, PrismaClient } from '@prisma/client';
import { auditContext, type AuditContext } from './audit-context';

const mutations = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

function encodedContext(context: AuditContext) {
  if (!context.actor) throw new Error('An authenticated audit actor is required.');
  return JSON.stringify(context);
}
async function identifyTransaction(tx: Prisma.TransactionClient, context: AuditContext) {
  await tx.$queryRaw`SELECT set_config('crystal.audit_context', ${encodedContext(context)}, true)`;
}

// Triggers capture nested/bulk writes. The identity setting is transaction-local,
// on the same connection as the business writes; pooled sessions cannot leak actors.
export function withDatabaseAudit(client: PrismaClient): PrismaClient {
  const delegates = new Map<string, object>();
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return (operation: unknown, options?: object) => {
          const context = auditContext.getStore();
          if (!context) return Reflect.apply(target.$transaction, target, [operation, options]);
          if (Array.isArray(operation)) {
            const identity = target.$queryRaw`SELECT set_config('crystal.audit_context', ${encodedContext(context)}, true)`;
            return target
              .$transaction([identity, ...operation], options)
              .then(([, ...results]) => results);
          }
          if (typeof operation !== 'function') throw new Error('Invalid transaction operation.');
          return target.$transaction(async (tx) => {
            await identifyTransaction(tx, context);
            return operation(tx);
          }, options);
        };
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || property.startsWith('$') || property.startsWith('_')) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      if (!value || typeof value !== 'object' || !('findMany' in value)) return value;
      if (!delegates.has(property)) {
        delegates.set(
          property,
          new Proxy(value, {
            get(delegate, method) {
              const call = Reflect.get(delegate, method);
              if (typeof method !== 'string' || !mutations.has(method)) {
                return typeof call === 'function' ? call.bind(delegate) : call;
              }
              return (args: unknown) => {
                const context = auditContext.getStore();
                const query = call.call(delegate, args);
                if (!context) return query;
                let execution: Promise<unknown> | undefined;
                const execute = () =>
                  (execution ??= target.$transaction(async (tx) => {
                    await identifyTransaction(tx, context);
                    const transactionDelegate = Reflect.get(tx, property);
                    return Reflect.get(transactionDelegate, method).call(transactionDelegate, args);
                  }));
                // Preserve PrismaPromise laziness and requestTransaction so batch writes
                // execute inside their batch, instead of committing before it starts.
                return new Proxy(query, {
                  get(promise, key) {
                    if (key === 'then')
                      return (...callbacks: Parameters<Promise<unknown>['then']>) =>
                        execute().then(...callbacks);
                    if (key === 'catch')
                      return (...callbacks: Parameters<Promise<unknown>['catch']>) =>
                        execute().catch(...callbacks);
                    if (key === 'finally')
                      return (...callbacks: Parameters<Promise<unknown>['finally']>) =>
                        execute().finally(...callbacks);
                    const member = Reflect.get(promise, key);
                    return typeof member === 'function' ? member.bind(promise) : member;
                  },
                });
              };
            },
          }),
        );
      }
      return delegates.get(property);
    },
  });
}

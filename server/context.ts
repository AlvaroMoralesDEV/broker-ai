// Usuario de la petición en curso. Cada petición HTTP corre dentro de withUser(); todo el acceso a
// datos (server/store.ts) filtra por currentUser(), así que un usuario nunca ve los datos de otro.
import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_USER = "default";
const als = new AsyncLocalStorage<string>();

export const withUser = <T>(userId: string, fn: () => T): T => als.run(userId, fn);

/** Fuera de una petición (servidor MCP, tests) se usa BROKER_USER o el usuario por defecto. */
export const currentUser = (): string => als.getStore() ?? process.env.BROKER_USER ?? DEFAULT_USER;

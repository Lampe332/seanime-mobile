// Vitest runs in Node without Expo's native modules; Node's crypto has the same randomUUID.
export { randomUUID } from "node:crypto"

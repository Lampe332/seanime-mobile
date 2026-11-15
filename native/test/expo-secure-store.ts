// Vitest runs in Node, which has no Android Keystore. This alias keeps the secrets in memory, so a test can see what
// was put into the secured storage (and that nothing else was).
export const secrets = new Map<string, string>()

export const getItemAsync = async (key: string) => secrets.get(key) ?? null

export const setItemAsync = async (key: string, value: string) => {
    secrets.set(key, value)
}

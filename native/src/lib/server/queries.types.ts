export type SeaWebsocketEvent<T> = { type: string, payload: T }
export type SeaWebsocketPluginEvent<T> = { type: string, extensionId: string, payload: T }
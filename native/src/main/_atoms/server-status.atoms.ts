import { Status } from "@/api/generated/types"
import { atom } from "jotai"
import { atomWithStorage } from "@/lib/storage"

export const SERVER_AUTH_TOKEN_STORAGE_KEY = "sea-server-auth-token"

export const serverStatusAtom = atom<Status | undefined>(undefined)

export const isLoginModalOpenAtom = atom(false)

export const serverAuthTokenAtom = atomWithStorage<string | undefined>(SERVER_AUTH_TOKEN_STORAGE_KEY, undefined)

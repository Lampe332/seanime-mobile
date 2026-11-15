import { coreRequestFor, serverOffError } from "@/api/client/core-switch"
import { toast } from "@/components/ui/toast/toast-store"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { requestErrorSummary } from "@/lib/helpers/log-safe"
import { useMutation, UseMutationOptions, useQuery, UseQueryOptions } from "@tanstack/react-query"
import { AxiosError } from "axios"
import { getDefaultStore, useAtomValue } from "jotai"
import { RESET } from "jotai/utils"
import { useEffect } from "react"

export type SeaError = AxiosError<{ error: string }>

let authRedirectInProgress = false

type SeaQuery<D> = {
    endpoint: string
    method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT"
    data?: D
    params?: D
    password?: string
}

export function useSeaQuery() {
    const password = useAtomValue(serverAuthTokenAtom)

    return {
        seaFetch: <T, D extends any = any>(endpoint: string, method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT", data?: D, params?: D) => {
            return buildSeaQuery<T, D>({
                endpoint,
                method,
                data,
                params,
                password,
            })
        },
    }
}

function getSeaErrorMessage(data: unknown): string {
    if (typeof data === "string") {
        return data.trim()
    }

    if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") {
        return data.error.trim()
    }

    return ""
}

function isAuthFailureResponse(status: number | undefined, data: unknown): boolean {
    const errorMessage = getSeaErrorMessage(data).toLowerCase()

    if (status === 401) {
        return errorMessage === "" || errorMessage.includes("unauthenticated") || errorMessage.includes("unauthorized")
    }

    return status === 429 && errorMessage.includes("too many authentication attempts")
}

/**
 * The web app removed the stored server password and reloaded on /public/auth. The native app has no page to reload: it
 * resets the token atom (which also removes the stored value).
 */
function _handleAuthFailure() {
    if (authRedirectInProgress) return
    authRedirectInProgress = true
    getDefaultStore().set(serverAuthTokenAtom, RESET)
    authRedirectInProgress = false
}

function checkAuthError(error: SeaError | AxiosError | null | undefined) {
    if (!error) return

    if (isAuthFailureResponse(error.response?.status, error.response?.data)) {
        _handleAuthFailure()
    }
}

/**
 * A request of the hooks, answered by the app's own core (docs/EIGENER-KERN.md) without HTTP.
 * - First generic: Return type
 * - Second generic: Params/Data type
 *
 * What the core has no code for needed the Go server, which is no longer in the app since stage 8a-1 (§4s): it fails at
 * once, as a server error with status 503 (§4p, phase 5c-1), and the hooks show their error as before.
 */
export async function buildSeaQuery<T, D extends any = any>(
    {
        endpoint,
        method,
        data,
        params,
    }: SeaQuery<D>): Promise<T | undefined> {
    const fromCore = coreRequestFor<T>(method, endpoint)
    if (fromCore) return fromCore(data, params)
    throw serverOffError(method, endpoint)
}

type ServerMutationProps<R, V = void> = UseMutationOptions<R | undefined, SeaError, V, unknown> & {
    endpoint: string
    method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT"
}

/**
 * Create mutation hook to the server
 * - First generic: Return type
 * - Second generic: Params/Data type
 */
export function useServerMutation<R = void, V = void>(
    {
        endpoint,
        method,
        ...options
    }: ServerMutationProps<R, V>) {

    const password = useAtomValue(serverAuthTokenAtom)

    return useMutation<R | undefined, SeaError, V>({
        onError: error => {
            checkAuthError(error)
            if (isAuthFailureResponse(error.response?.status, error.response?.data)) {
                return
            }
            console.log("Mutation error", requestErrorSummary(error))
            const errorMsg = _handleSeaError(error.response?.data)
            if (errorMsg.includes("feature disabled")) {
                toast.warning("This feature is disabled")
                return
            }
            toast.error(errorMsg)
        },
        mutationFn: async (variables) => {
            return buildSeaQuery<R, V>({
                endpoint: endpoint,
                method: method,
                data: variables,
                password: password,
            })
        },
        ...options,
    })
}


type ServerQueryProps<R, V> = UseQueryOptions<R | undefined, SeaError, R | undefined> & {
    endpoint: string
    method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT"
    params?: V
    data?: V
    muteError?: boolean
}

/**
 * Create query hook to the server
 * - First generic: Return type
 * - Second generic: Params/Data type
 */
export function useServerQuery<R, V = any>(
    {
        endpoint,
        method,
        params,
        data,
        muteError,
        ...options
    }: ServerQueryProps<R | undefined, V>) {

    const password = useAtomValue(serverAuthTokenAtom)

    const props = useQuery<R | undefined, SeaError>({
        queryFn: async () => {
            return buildSeaQuery<R, V>({
                endpoint: endpoint,
                method: method,
                params: params,
                data: data,
                password: password,
            })
        },
        ...options,
    })

    useEffect(() => {
        if (!muteError && props.isError) {
            if (isAuthFailureResponse(props.error?.response?.status, props.error?.response?.data)) {
                _handleAuthFailure()
                return
            }
            console.log("Server error", requestErrorSummary(props.error))
            const errorMsg = _handleSeaError(props.error?.response?.data)
            if (errorMsg.includes("feature disabled")) {
                return
            }
            if (!!errorMsg) {
                toast.error(errorMsg)
            }
        }
    }, [props.error, props.isError, muteError])

    return props
}

//----------------------------------------------------------------------------------------------------------------------

function _handleSeaError(data: any): string {
    if (typeof data === "string") return "Server Error: " + data

    const err = data?.error as string

    if (!err) return "Unknown error"

    if (err.includes("Too many requests"))
        return "AniList: Too many requests, please wait a moment and try again."

    try {
        const graphqlErr = JSON.parse(err) as any
        console.log("AniList error", graphqlErr)
        if (graphqlErr.graphqlErrors && graphqlErr.graphqlErrors.length > 0 && !!graphqlErr.graphqlErrors[0]?.message) {
            return "AniList error: " + graphqlErr.graphqlErrors[0]?.message
        }
        return "AniList error"
    }
    catch (e) {
        if (err.includes("no cached data") || err.includes("cache lookup failed")) {
            return ""
        }
        return "Error: " + err
    }
}

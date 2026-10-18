import { useCallback, useEffect, useRef, useState } from "react"

type QueryOptions<T> = {
    queryFn: () => Promise<T>, initialData?: T, initialDataUpdatedAt?: number,
    enabled?: boolean, staleTime?: number,
}

export function useQuery<T>(options: QueryOptions<T>) {
    const queryFn = useRef(options.queryFn)
    queryFn.current = options.queryFn
    const [state, setState] = useState(() => ({
        data: options.initialData,
        error: undefined as Error | undefined,
        isLoading: options.initialData === undefined,
        isFetching: false,
    }))
    const active = useRef<Promise<unknown> | undefined>(undefined)

    const refetch = useCallback(() => {
        if (active.current) return active.current
        setState(previous => ({ ...previous, error: undefined, isFetching: true, isLoading: previous.data === undefined }))
        const request = Promise.resolve().then(() => queryFn.current()).then(
            data => {
                setState(previous => ({ ...previous, data, error: undefined, isLoading: false, isFetching: true }))
                return { data }
            },
            error => {
                setState(previous => ({ ...previous, error: error as Error, isLoading: false, isFetching: true }))
                return { error }
            },
        ).finally(() => {
            active.current = undefined
            setState(previous => ({ ...previous, isLoading: false, isFetching: false }))
        })
        active.current = request
        return request
    }, [])

    useEffect(() => {
        if (options.enabled && options.initialDataUpdatedAt === 0) void refetch()
    }, [options.enabled, options.initialDataUpdatedAt, refetch])

    return { ...state, refetch }
}

export function useMutation() { throw new Error("Unexpected desktop update mutation") }

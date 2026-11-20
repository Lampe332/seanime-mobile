import type { UpdateHomeItems_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Models_HomeItem } from "@/api/generated/types"
import type { QueryClient } from "@tanstack/react-query"

/*
 * Saving Home's sections (Customize Home, an empty carousel's "Reset options") without waiting for the core:
 * - the change shows at once: the saved list in the query cache is replaced before the save starts;
 * - a load of the list that was on its way is cancelled first, so its older answer cannot overwrite the change;
 * - the saves run one after the other (one scope), each with the whole list, so the last tap wins;
 * - a failed save puts back the list from before it and says so (onFailed);
 * - the list is loaded again only after the last save of a row of quick taps (an earlier answer would flicker back).
 */

export const HOME_ITEMS_QUERY_KEY = [API_ENDPOINTS.STATUS.GetHomeItems.key]
export const HOME_ITEMS_MUTATION_KEY = [API_ENDPOINTS.STATUS.UpdateHomeItems.key]

type Snapshot = { previous: Models_HomeItem[] | null | undefined }

export function homeItemsSaveOptions(qc: QueryClient, onFailed: () => void) {
    return {
        mutationKey: HOME_ITEMS_MUTATION_KEY,
        scope: { id: "home-items" },
        onMutate: async ({ items }: UpdateHomeItems_Variables): Promise<Snapshot> => {
            await qc.cancelQueries({ queryKey: HOME_ITEMS_QUERY_KEY })
            const previous = qc.getQueryData<Models_HomeItem[] | null>(HOME_ITEMS_QUERY_KEY)
            qc.setQueryData(HOME_ITEMS_QUERY_KEY, items)
            return { previous }
        },
        onError: (_error: unknown, _variables: UpdateHomeItems_Variables, snapshot: unknown) => {
            const previous = (snapshot as Snapshot | undefined)?.previous
            if (previous !== undefined) qc.setQueryData(HOME_ITEMS_QUERY_KEY, previous)
            onFailed()
        },
        onSettled: async () => {
            // this save still counts: more than one means another one is queued behind it
            if (qc.isMutating({ mutationKey: HOME_ITEMS_MUTATION_KEY }) > 1) return
            await qc.invalidateQueries({ queryKey: HOME_ITEMS_QUERY_KEY })
        },
    }
}

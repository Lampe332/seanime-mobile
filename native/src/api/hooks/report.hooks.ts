import { useServerMutation } from "@/api/client/requests"
import { SaveIssueReport_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"

export function useSaveIssueReport() {
    return useServerMutation<boolean, SaveIssueReport_Variables>({
        endpoint: API_ENDPOINTS.REPORT.SaveIssueReport.endpoint,
        method: API_ENDPOINTS.REPORT.SaveIssueReport.methods[0],
        mutationKey: [API_ENDPOINTS.REPORT.SaveIssueReport.key],
        onSuccess: async () => {

        },
    })
}

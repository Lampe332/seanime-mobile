import { useListOnlinestreamProviderExtensions } from "@/api/hooks/extensions.hooks"
import { __onlinestream_selectedProviderAtom } from "@/main/onlinestream/_lib/onlinestream.atoms"
import { useAtom } from "jotai"
import React from "react"

/**
 * The installed online stream providers (web handle-onlinestream-providers.ts). The stored provider gives way to the
 * first installed one when it is gone; none installed clears it.
 */
export function useHandleOnlinestreamProviderExtensions() {
    const { data: providerExtensions } = useListOnlinestreamProviderExtensions()
    const [provider, setProvider] = useAtom(__onlinestream_selectedProviderAtom)

    React.useLayoutEffect(() => {
        if (!providerExtensions) return
        if (provider === null || !providerExtensions.find(p => p.id === provider)) {
            setProvider(providerExtensions.length > 0 ? providerExtensions[0].id : null)
        }
    }, [providerExtensions, provider, setProvider])

    const options = React.useMemo(() => (providerExtensions ?? [])
        .map(item => ({ label: item.name, value: item.id }))
        .sort((a, b) => a.label.localeCompare(b.label)), [providerExtensions])

    return {
        providerExtensions: providerExtensions ?? [],
        providerExtensionOptions: options,
    }
}

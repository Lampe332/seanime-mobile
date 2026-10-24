import { Extension_Extension, Extension_InvalidExtension } from "@/api/generated/types"
import { useGetExtensionUserConfig, useSaveExtensionUserConfig } from "@/api/hooks/extensions.hooks"
import { LuffyError } from "@/components/shared/luffy-error"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Modal } from "@/components/ui/modal"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { TextInput } from "@/components/ui/text-input"
import { Translate, useTr } from "@/lib/app-language"
import React from "react"

type ExtensionUserConfigModalProps = {
    children?: React.ReactElement
    extension: Extension_Extension
    userConfigError?: Extension_InvalidExtension | undefined
}

export function ExtensionUserConfigModal({ children, extension, userConfigError }: ExtensionUserConfigModalProps) {
    const t = useTr()
    return (
        <Modal
            contentClass="mex-sheet"
            trigger={children}
            title={t("Preferences", "Einstellungen")}
            onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus() }}
        >
            <Content extension={extension} userConfigError={userConfigError} t={t} />
        </Modal>
    )
}

function Content({ extension, userConfigError, t }: { extension: Extension_Extension, userConfigError?: Extension_InvalidExtension | undefined, t: Translate }) {

    const { data: extUserConfig, isLoading } = useGetExtensionUserConfig(extension.id)

    const { mutate: saveExtUserConfig, isPending } = useSaveExtensionUserConfig()

    // Per extension: the form starts from what this extension saved, never from another one's typed values
    const [userConfigFormValues, setUserConfigFormValues] = React.useState<Record<string, string>>({})
    const setValue = (name: string, value: string) => setUserConfigFormValues(prev => ({ ...prev, [name]: value }))

    React.useLayoutEffect(() => {
        if (extUserConfig) setUserConfigFormValues({ ...extUserConfig.savedUserConfig?.values })
    }, [extUserConfig])

    function handleSave() {
        let values: Record<string, string> = {}
        for (const field of extUserConfig?.userConfig?.fields || []) {
            values[field.name] = userConfigFormValues[field.name] || field.default || ""
        }
        saveExtUserConfig({
            id: extension.id,
            version: extUserConfig?.userConfig?.version || 0,
            values: values,
        })
    }

    if (isLoading) return <LoadingSpinner />

    if (!extUserConfig) return <LuffyError />

    return (
        <>
            <div>
                <p>
                    {extension.name}
                </p>
                <div className="text-sm text-[--muted]">
                    {t("You can edit the preferences for this extension here.", "Hier änderst du die Einstellungen dieser Erweiterung.")}
                </div>
            </div>

            {userConfigError && (
                <Alert
                    intent="warning"
                    description={userConfigError.reason.includes("user config is missing")
                        ? t("Fill out the required configuration options.", "Fülle die nötigen Einstellungen aus.")
                        : userConfigError.reason}
                />
            )}

            {extUserConfig?.userConfig?.fields?.map(field => {
                if (field.type === "text") {
                    return (
                        <TextInput
                            key={field.name}
                            label={field.label}
                            value={userConfigFormValues[field.name] || field.default}
                            onValueChange={v => setValue(field.name, v)}
                            help={!!field.default ? `${t("Default", "Standard")}: ${field.default}` : undefined}
                        />
                    )
                }
                if (field.type === "switch") {
                    return (
                        <Switch
                            key={field.name}
                            label={field.label}
                            value={userConfigFormValues[field.name] ? userConfigFormValues[field.name] === "true" : field.default === "true"}
                            onValueChange={v => setValue(field.name, v ? "true" : "false")}
                            help={!!field.default ? `${t("Default", "Standard")}: ${field.default}` : undefined}
                        />
                    )
                }
                if (field.type === "select" && field.options) {
                    return (
                        <Select
                            key={field.name}
                            label={field.label}
                            value={userConfigFormValues[field.name] || field.default}
                            onValueChange={v => setValue(field.name, v)}
                            options={field.options}
                            help={!!field.default ? `${t("Default", "Standard")}: ${field.options.find(n => n.value === field.default)?.label ?? "N/A"}` : undefined}
                        />
                    )
                }
            })}

            <div className="flex">
                <Button
                    intent="white"
                    loading={isPending}
                    onClick={handleSave}
                    className={cn(!!userConfigError && "animate-pulse")}
                >
                    {t("Save", "Speichern")}
                </Button>
                <div className="flex flex-1"></div>
            </div>
        </>
    )
}

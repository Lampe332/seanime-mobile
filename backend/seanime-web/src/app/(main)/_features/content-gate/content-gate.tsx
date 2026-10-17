import { isLoginModalOpenAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { isContentGateAllowedPath } from "@/app/(main)/_features/content-gate/content-gate-paths"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaLink } from "@/components/shared/sea-link"
import { Button } from "@/components/ui/button"
import { useTr } from "@/lib/app-language"
import { usePathname } from "@/lib/navigation"
import { useSetAtom } from "jotai"
import React from "react"
import { FiLogIn } from "react-icons/fi"
import { LuBlocks } from "react-icons/lu"

/** Hides all anime/manga until the user added an AniList token or installed an extension (Android, see backend contentgate). */
export function ContentGate({ children }: { children: React.ReactNode }) {
    const serverStatus = useServerStatus()
    const pathname = usePathname()

    if (!serverStatus?.contentLocked || isContentGateAllowedPath(pathname)) return <>{children}</>

    return <ContentGateScreen />
}

function ContentGateScreen() {
    const t = useTr()
    const setLoginModal = useSetAtom(isLoginModalOpenAtom)

    return (
        <PageWrapper className="p-4 sm:p-8 pt-16 sm:pt-24" data-content-gate>
            <div className="max-w-md mx-auto text-center space-y-6">
                <h2>{t("No content yet", "Noch keine Inhalte")}</h2>
                <p className="text-[--muted]">
                    {t(
                        "This app does not include any anime or manga. Add your AniList token or install an extension to get started.",
                        "Diese App enthält keine Animes oder Mangas. Füge deinen AniList-Token hinzu oder installiere eine Erweiterung, um loszulegen.",
                    )}
                </p>
                <div className="flex flex-col gap-3">
                    <Button intent="white" leftIcon={<FiLogIn />} onClick={() => setLoginModal(true)}>
                        {t("Add AniList token", "AniList-Token hinzufügen")}
                    </Button>
                    <SeaLink href="/extensions">
                        <Button intent="gray-subtle" leftIcon={<LuBlocks />} className="w-full">
                            {t("Install extension", "Erweiterung installieren")}
                        </Button>
                    </SeaLink>
                </div>
            </div>
        </PageWrapper>
    )
}

import { __home_settingsModalOpen } from "@/app/(main)/_features/home/home-settings-modal"
import { Button, IconButton } from "@/components/ui/button"
import { useTr } from "@/lib/app-language"
import { Tooltip } from "@/components/ui/tooltip"
import { useAtom } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { LuSettings2 } from "react-icons/lu"

// by default, the button will be highlighted until the user clicks it for the first time
// this is not applied to the empty home page
export const __home_settingsToolbarButtonDiscovered = atomWithStorage("sea-v3-home-settings-toolbar-button-discovered", false)

type HomeSettingsButtonProps = {
    type: "toolbar" | "empty-home"
    labeled?: boolean
    icon?: boolean
}

export function HomeSettingsButton(props: HomeSettingsButtonProps) {
    const { type } = props
    const tr = useTr()
    const [discoveredOnce, setDiscoveredOnce] = useAtom(__home_settingsToolbarButtonDiscovered)
    const [isModalOpen, setIsModalOpen] = useAtom(__home_settingsModalOpen)

    // if(type === "toolbar" && !discoveredOnce) return (
    //     <>
    //         <Tooltip
    //             open
    //             className="bg-fuchsia-500/100 flex gap-2 items-center font-semibold"
    //             sideOffset={5}
    //             trigger={<IconButton
    //                 data-library-toolbar-switch-view-button
    //                 intent="white-subtle"
    //                 icon={<BsHouseGear className="text-2xl" />}
    //                 className={cn(
    //                     "animate-bounce",
    //                 )}
    //                 onClick={() => {
    //                     setDiscoveredOnce(true)
    //                     setIsModalOpen(true)
    //                 }}
    //             />}
    //         >
    //             <LuSparkles /> New
    //         </Tooltip>
    //     </>
    // )

    if (props.icon) return <button type="button" data-library-toolbar-switch-view-button className="home-header-action" aria-label={tr("Customize", "Anpassen")}
        onClick={() => setIsModalOpen(true)}><LuSettings2 aria-hidden /></button>

    if (props.labeled) return <Button data-library-toolbar-switch-view-button className="home-labeled-action" leftIcon={<LuSettings2 aria-hidden />} onClick={() => setIsModalOpen(true)}>{tr("Customize", "Anpassen")}</Button>

    if (type === "toolbar") return (
        <>
            <Tooltip
                trigger={<IconButton
                    data-library-toolbar-switch-view-button
                    intent="white-subtle"
                    icon={<LuSettings2 className="text-2xl" />}
                    onClick={() => {
                        setIsModalOpen(true)
                    }}
                />}
            >
                Home Settings
            </Tooltip>
        </>
    )


}

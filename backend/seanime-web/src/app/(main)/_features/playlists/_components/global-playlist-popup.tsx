import { Button } from "@/components/ui/button"
import { MobileWorkspace } from "@/components/shared/mobile-workspace"
import { tr } from "@/lib/app-language"
import React, { useState } from "react"
import { BiX } from "react-icons/bi"
import { RiPlayList2Fill } from "react-icons/ri"

/** Floating button that opens the playing playlist in a sheet. */
export function PlaylistManagerPopup(props: { title: React.ReactNode, footer: React.ReactNode, children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false)

    return <div className="fixed bottom-24 right-4 z-[25]">
        <MobileWorkspace open={isOpen} onOpenChange={setIsOpen} title={props.title || tr("Playing playlist", "Laufende Playlist")} className="mobile-playing-playlist" footer={props.footer}>
            {props.children}
        </MobileWorkspace>
        <Button
            intent="white"
            onClick={() => setIsOpen(!isOpen)}
            className="shadow-xl w-14 h-14 rounded-full flex items-center justify-center hover:shadow-lg hover:shadow-black/30 transition-all duration-300"
            aria-label={tr("Open playing playlist", "Laufende Playlist öffnen")}
        >
            {isOpen ? <BiX className="h-6 w-6" /> : <RiPlayList2Fill className="h-6 w-6" />}
        </Button>
    </div>
}

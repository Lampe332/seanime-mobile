import React from "react"
import { createRoot } from "react-dom/client"
import { getDefaultStore } from "jotai"
import { useAtomValue } from "jotai/react"
import Page from "../backend/seanime-web/src/app/(main)/lists/page"
import { __myLists_selectedTypeAtom } from "../backend/seanime-web/src/app/(main)/lists/_lib/handle-user-anilist-lists"
import { animeLibraryCollectionAtom } from "../backend/seanime-web/src/app/(main)/_atoms/anime-library-collection.atoms"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

const w = window as any
// The local anime library (for "Add to playlist" without streaming) comes from the fixture.
if (w.server.library) getDefaultStore().set(animeLibraryCollectionAtom, w.server.library)

// Home's "My lists" item reads this atom; the phone tab must leave it alone. The test reads window.homeType.
function HomeAtomProbe() {
    const type = useAtomValue(__myLists_selectedTypeAtom)
    React.useEffect(() => { w.homeType = type }, [type])
    return null
}

createRoot(document.getElementById("root")!).render(<><Page /><HomeAtomProbe /></>)

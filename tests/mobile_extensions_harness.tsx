import React from "react"
import { createRoot } from "react-dom/client"
import Page from "../backend/seanime-web/src/app/(main)/extensions/page"
import { TourOverlay } from "../backend/seanime-web/src/app/(main)/_features/tour/tour-overlay"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

// The page with the app's tour overlay, so the setup tour can be walked on the new screen.
createRoot(document.getElementById("root")!).render(<><Page /><TourOverlay /></>)

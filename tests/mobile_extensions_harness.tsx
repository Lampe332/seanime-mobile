import React from "react"
import { createRoot } from "react-dom/client"
import Page from "../backend/seanime-web/src/app/(main)/extensions/page"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

createRoot(document.getElementById("root")!).render(<Page />)

import React from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "jotai"
import { MobileUpdateModal } from "../backend/seanime-web/src/app/(main)/_features/update/mobile-update-modal"

createRoot(document.getElementById("update-react-root")!).render(
    <Provider><MobileUpdateModal /></Provider>,
)

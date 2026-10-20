import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"
import { createRoot } from "react-dom/client"
import { ChapterReaderSettings } from "../backend/seanime-web/src/app/(main)/manga/_containers/chapter-reader/chapter-reader-settings"

createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={new QueryClient()}>
        <div style={{ minHeight: "100vh", background: "#000", padding: 8 }}>
            <ChapterReaderSettings mediaId={117460} />
        </div>
    </QueryClientProvider>,
)

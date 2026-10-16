import Page from "@/app/(main)/android-downloads/page"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

export const Route = createFileRoute("/_main/android-downloads/")({
    validateSearch: z.object({ anime: z.string().optional(), kind: z.enum(["anime", "manga"]).optional(), manga: z.coerce.string().optional() }),
    component: Page,
})

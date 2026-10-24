import { Updater_Update } from "@/api/generated/types"
import React from "react"
import { useTr } from "@/lib/app-language"
import { AiFillExclamationCircle } from "react-icons/ai"

type UpdateChangelogBodyProps = {
    updateData: Updater_Update | undefined
    children?: React.ReactNode
}

export function UpdateChangelogBody(props: UpdateChangelogBodyProps) {

    const {
        updateData,
        children,
        ...rest
    } = props

    const { body } = useUpdateChangelogBody(updateData)
    const t = useTr()

    function RenderLines({ lines }: { lines: string[] }) {
        return <>
            {lines.map((line, index) => {
                if (line.includes("🚑️")) return <p key={index} className="text-red-300 font-semibold flex gap-2 items-center">{line}
                    <AiFillExclamationCircle /></p>
                if (line.includes("🎉")) return <p key={index} className="text-white">{line}</p>
                if (line.includes("✨")) return <p key={index} className="text-white">{line}</p>
                if (line.includes("⚡️")) return <p key={index} className="">{line}</p>
                if (line.includes("💄")) return <p key={index} className="">{line}</p>
                if (line.includes("🦺")) return <p key={index} className="">{line}</p>
                if (line.includes("⬆️")) return <p key={index} className="">{line}</p>
                if (line.includes("🏗️")) return <p key={index} className="">{line}</p>
                if (line.includes("🚀")) return <p key={index} className="">{line}</p>
                if (line.includes("🔧")) return <p key={index} className="">{line}</p>
                if (line.includes("🔍")) return <p key={index} className="">{line}</p>
                if (line.includes("🔒")) return <p key={index} className="">{line}</p>
                if (line.includes("🔑")) return <p key={index} className="">{line}</p>
                if (line.includes("🔗")) return <p key={index} className="">{line}</p>
                if (line.includes("🔨")) return <p key={index} className="">{line}</p>
                if (line.includes("🎨")) return <p key={index} className="">{line}</p>
                if (line.includes("📝")) return <p key={index} className="">{line}</p>
                if (line.includes("♻️")) return <p key={index} className="">{line}</p>
                if (line.includes("🔄")) return <p key={index} className="">{line}</p>
                if (line.includes("⏪️")) return <p key={index} className="">{line}</p>
                if (line.includes("🩹")) return <p key={index} className="">{line}</p>
                return (
                    <p key={index} className="opacity-75 pl-4 text-sm">{line}<br /></p>
                )
            })}
        </>
    }

    return (
        <>
            <div className="bg-gray-950/50 rounded-[--radius] p-4 max-h-[70vh] overflow-y-auto halo-2">
                {body.some(n => n.includes("🚑️")) &&
                    <p className="text-red-300 font-semibold flex gap-2 items-center">{t("This update includes a critical patch", "Dieses Update enthält eine kritische Korrektur")}</p>}
                <div className="rounded-[--radius] space-y-1">
                    <h5>{t("What’s new", "Was ist neu?")}</h5>
                    {!body.length && <p>{t("No release notes provided.", "Keine Releaseinformationen vorhanden.")}</p>}
                    <RenderLines lines={body} />
                </div>
            </div>
        </>
    )
}

function useUpdateChangelogBody(updateData: Updater_Update | undefined) {
    const body = React.useMemo(() => {
        if (!updateData || !updateData.release) return []
        let body = updateData.release.body
        if (body.includes("---")) {
            body = body.split("---")[0]
        }
        return body.split(/\n/).filter((line) => line.trim() !== "" && line.trim().startsWith("-"))
    }, [updateData])

    return {
        body,
    }
}

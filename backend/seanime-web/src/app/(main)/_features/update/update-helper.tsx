import { Updater_Update } from "@/api/generated/types"
import { useGetChangelog } from "@/api/hooks/releases.hooks"
import React from "react"
import { useTr } from "@/lib/app-language"
import { IS_MOBILE_APP } from "@/lib/app-updates"
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

    const { data: changelog } = useGetChangelog(updateData?.release?.version!,
        updateData?.current_version!,
        !IS_MOBILE_APP && !!updateData?.release?.version! && !!updateData?.current_version)

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
                    <p className="text-red-300 font-semibold flex gap-2 items-center">{IS_MOBILE_APP ? t("This update includes a critical patch", "Dieses Update enthält eine kritische Korrektur") : "This update includes a critical patch"}</p>}
                <div className="rounded-[--radius] space-y-1">
                    <h5>{IS_MOBILE_APP ? t("What’s new", "Was ist neu?") : "What's new?"}</h5>
                    {IS_MOBILE_APP && !body.length && <p>{t("No release notes provided.", "Keine Releaseinformationen vorhanden.")}</p>}
                    <RenderLines lines={body} />
                </div>
            </div>

            {!!changelog?.length && <>
                <p className="text-center font-semibold">Other updates you've missed</p>
                <div className="bg-gray-950/50 rounded-[--radius] p-4 max-h-[40vh] overflow-y-auto space-y-1.5">
                    {changelog?.map((item) => (
                        <div key={item.version} className="rounded-[--radius]">
                            <p key={item.version} className="text-center font-bold">{item.version}</p>
                            <div className="text-sm">
                                <RenderLines lines={item.lines} />
                            </div>
                        </div>
                    ))}
                </div>
            </>}
        </>
    )
}


export function useUpdateChangelogBody(updateData: Updater_Update | undefined) {
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

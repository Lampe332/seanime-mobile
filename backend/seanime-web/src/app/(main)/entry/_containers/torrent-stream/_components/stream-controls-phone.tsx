import { PhoneNotice, PhoneSwitch } from "@/app/(main)/_features/phone-screen/phone-screen"
import { useTr } from "@/lib/app-language"
import React from "react"

/**
 * The controls above the episode list of the torrent and debrid sources on phones. A batch's episode file
 * is always picked automatically on a phone, so only the choice of the torrent itself is offered.
 */
export function StreamControlsPhone({ kind, autoSelect, onAutoSelect, batchName, onForgetBatch, forgetting, mappingError }: {
    kind: "torrent" | "debrid"
    autoSelect: boolean
    onAutoSelect: (value: boolean) => void
    /** Name of the batch torrent the next episodes come from, if one is remembered */
    batchName?: string
    onForgetBatch: () => void
    forgetting?: boolean
    mappingError?: boolean
}) {
    const t = useTr()
    return <div className="ssc" data-stream-controls-phone={kind}>
        <div className="ps-rows">
            <PhoneSwitch label={t("Pick the best torrent", "Besten Torrent wählen")} checked={autoSelect} onChange={onAutoSelect}
                note={autoSelect ? t("An episode starts as soon as you tap it.", "Eine Folge startet, sobald du sie antippst.")
                    : t("Tapping an episode shows the torrents to choose from.", "Beim Antippen einer Folge wählst du den Torrent selbst.")}
                data-stream-auto-select />
        </div>
        {!autoSelect && !!batchName && <div className="ssc-batch" data-stream-batch>
            <p><span>{t("Episodes come from your last batch", "Folgen kommen aus deinem letzten Batch")}</span><small>{batchName}</small></p>
            <button type="button" className="ps-text-action" onClick={onForgetBatch} disabled={forgetting}>{t("Stop", "Beenden")}</button>
        </div>}
        {mappingError && <PhoneNotice text={t("This anime has no episode data, so pick the torrent yourself.",
            "Für diesen Anime fehlen Folgendaten, wähle den Torrent deshalb selbst.")} data-stream-mapping-error />}
    </div>
}

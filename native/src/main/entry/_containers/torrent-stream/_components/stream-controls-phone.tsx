import { Notice, RowGroup, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Dialog } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import React from "react"
import { View } from "react-native"

/**
 * The controls above the episode list of the torrent and debrid sources (stream-controls-phone.tsx, `.ssc`). A batch's
 * episode file is always picked automatically on a phone, so only the choice of the torrent itself is offered.
 */
export function StreamControlsPhone({ autoSelect, onAutoSelect, batchName, onForgetBatch, forgetting, mappingError }: {
    autoSelect: boolean
    onAutoSelect: (value: boolean) => void
    /** Name of the batch torrent the next episodes come from, if one is remembered */
    batchName?: string
    onForgetBatch: () => void
    forgetting?: boolean
    mappingError?: boolean
}) {
    const t = useTr()
    return <View className="mt-4 gap-3">
        <RowGroup>
            <SwitchRow label={t("Pick the best torrent", "Besten Torrent wählen")} checked={autoSelect} onCheckedChange={onAutoSelect}
                description={autoSelect ? t("An episode starts as soon as you tap it.", "Eine Folge startet, sobald du sie antippst.")
                    : t("Tapping an episode shows the torrents to choose from.", "Beim Antippen einer Folge wählst du den Torrent selbst.")} />
        </RowGroup>
        {!autoSelect && !!batchName && <View className="flex-row items-center gap-3 rounded-surface bg-sm-surface-raised py-2 pl-4 pr-2">
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-[15px]">{t("Episodes come from your last batch", "Folgen kommen aus deinem letzten Batch")}</Text>
                <Muted numberOfLines={2}>{batchName}</Muted>
            </View>
            <TextAction label={t("Stop", "Beenden")} onPress={onForgetBatch} disabled={forgetting} />
        </View>}
        {mappingError && <Notice text={t("This anime has no episode data, so pick the torrent yourself.",
            "Für diesen Anime fehlen Folgendaten, wähle den Torrent deshalb selbst.")} />}
    </View>
}

/** "Stop" of the remembered batch: stop using it for now, or delete the saved history (torrent-stream-page.tsx) */
export function ForgetBatchDialog({ open, onOpenChange, onDisable, onDelete }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onDisable: () => void
    onDelete: () => void
}) {
    const t = useTr()
    return <Dialog open={open} onOpenChange={onOpenChange} title={t("Disable previous torrent", "Vorherigen Torrent nicht nutzen")}
        description={t("Disable using the saved previous batch for now, or delete the saved history entirely.",
            "Den gespeicherten Batch vorerst nicht nutzen oder den gespeicherten Verlauf ganz löschen.")}
        footer={<>
            <Button intent="secondary" onPress={() => {
                onOpenChange(false)
                onDisable()
            }}>{t("Disable only", "Nur nicht nutzen")}</Button>
            <Button intent="danger" onPress={() => {
                onOpenChange(false)
                onDelete()
            }}>{t("Delete history", "Verlauf löschen")}</Button>
        </>} />
}

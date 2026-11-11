import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { Card, CardDescription, CardTitle, EmptyState } from "@/components/ui/card/card"
import { ListCover, ListGroup, ListIcon, ListRow } from "@/components/ui/list-row/list-row"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover/popover"
import { Select, SelectField } from "@/components/ui/select/select"
import { Dialog, Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Slider } from "@/components/ui/slider/slider"
import { Switch, SwitchRow } from "@/components/ui/switch/switch"
import { TabPanel, Tabs } from "@/components/ui/tabs/tabs"
import { Muted, SectionTitle, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { appLanguageAtom, useTr } from "@/lib/app-language"
import { MobileIcon } from "@/lib/mobile-icons"
import { cssBezier, DRAWER_EASE, DURATION, MOTION_EASE_OUT, PHONE_EASE, POP_EASE, WAIT_MS } from "@/lib/motion"
import { colors, colorSwatches, radii, spacingScale } from "@/lib/theme/tokens"
import { useAtom } from "jotai"
import React from "react"
import { View } from "react-native"

/*
 * Building blocks: every UI building block of the native app in its states, and the design tokens (colours, radii,
 * spacing, curves). Reached from the Menu. All values on this page are the components' own; nothing here talks to the
 * server, so it shows no AniList data. The language switch is the real setting (seanime-mobile-language).
 */
function Block({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <View className="gap-3">
            <SectionTitle>{title}</SectionTitle>
            {children}
        </View>
    )
}

export default function BuildingBlocksScreen() {
    const t = useTr()
    const [language, setLanguage] = useAtom(appLanguageAtom)
    const [segment, setSegment] = React.useState("anime")
    const [pill, setPill] = React.useState("watching")
    const [switchA, setSwitchA] = React.useState(true)
    const [switchB, setSwitchB] = React.useState(false)
    const [rowSwitch, setRowSwitch] = React.useState(true)
    const [quality, setQuality] = React.useState<string | undefined>("1080")
    const [slider, setSlider] = React.useState(40)
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const [dialogOpen, setDialogOpen] = React.useState(false)

    return (
        <PhoneScreen title={t("Building blocks", "Bausteine")} subtitle={t("Components, states and tokens of the app", "Bausteine, Zustände und Tokens der App")}>
            <Block title={t("Language", "Sprache")}>
                <Tabs
                    value={language}
                    onValueChange={value => setLanguage(value === "de" ? "de" : "en")}
                    items={[{ value: "en", label: "English" }, { value: "de", label: "Deutsch" }]}
                />
            </Block>

            <Block title={t("Buttons", "Knöpfe")}>
                <View className="flex-row flex-wrap gap-2">
                    <Button intent="primary">{t("Primary", "Primär")}</Button>
                    <Button intent="secondary">{t("Secondary", "Sekundär")}</Button>
                    <Button intent="danger">{t("Delete", "Löschen")}</Button>
                </View>
                <View className="flex-row flex-wrap items-center gap-2">
                    <Button intent="primary" disabled>{t("Disabled", "Gesperrt")}</Button>
                    <Button intent="secondary" loading>{t("Loading", "Lädt")}</Button>
                    <Button intent="text">{t("See all", "Alle ansehen")}</Button>
                    <Button intent="icon" accessibilityLabel={t("Settings", "Einstellungen")}>
                        <MobileIcon name="settings" size={22} color={colors.smTextMuted} />
                    </Button>
                </View>
            </Block>

            <Block title={t("Cards", "Karten")}>
                <Card>
                    <CardTitle>{t("Card", "Karte")}</CardTitle>
                    <CardDescription>{t("A block of text on the raised surface, 16dp corners.", "Ein Textblock auf der erhöhten Fläche, 16dp Ecken.")}</CardDescription>
                </Card>
                <EmptyState
                    title={t("Nothing here yet", "Noch nichts hier")}
                    description={t("Empty states say what is missing and what to do.", "Leere Zustände sagen, was fehlt und was zu tun ist.")}
                >
                    <Button intent="secondary">{t("Action", "Aktion")}</Button>
                </EmptyState>
            </Block>

            <Block title={t("Tabs", "Tabs")}>
                <Tabs
                    value={segment}
                    onValueChange={setSegment}
                    items={[
                        { value: "anime", label: "Anime" },
                        { value: "schedule", label: t("Schedule", "Sendeplan") },
                        { value: "manga", label: "Manga" },
                    ]}
                >
                    <TabPanel value={segment} className="pt-3">
                        <Muted>{t("Shown panel", "Gezeigtes Feld")}: {segment}</Muted>
                    </TabPanel>
                </Tabs>
                <Tabs
                    variant="pills"
                    value={pill}
                    onValueChange={setPill}
                    items={[
                        { value: "watching", label: t("Watching", "Am Schauen"), count: 12 },
                        { value: "planning", label: t("Planning", "Geplant"), count: 4 },
                        { value: "completed", label: t("Completed", "Fertig"), count: 30 },
                        { value: "paused", label: t("Paused", "Pausiert"), count: 0 },
                    ]}
                />
            </Block>

            <Block title={t("Switches", "Schalter")}>
                <View className="flex-row items-center gap-4">
                    <Switch checked={switchA} onCheckedChange={setSwitchA} accessibilityLabel="A" />
                    <Switch checked={switchB} onCheckedChange={setSwitchB} accessibilityLabel="B" />
                    <Switch checked disabled onCheckedChange={() => {}} accessibilityLabel="C" />
                </View>
                <ListGroup>
                    <SwitchRow
                        label={t("Switch row", "Schalter-Zeile")}
                        description={t("The whole row toggles.", "Die ganze Zeile schaltet.")}
                        checked={rowSwitch}
                        onCheckedChange={setRowSwitch}
                    />
                    <SwitchRow label={t("Disabled", "Gesperrt")} checked={false} disabled onCheckedChange={() => {}} />
                </ListGroup>
            </Block>

            <Block title={t("Select", "Auswahl")}>
                <SelectField
                    label={t("Quality", "Qualität")}
                    value={quality}
                    onValueChange={setQuality}
                    placeholder={t("Choose…", "Wählen …")}
                    options={[{ value: "1080", label: "1080p" }, { value: "720", label: "720p" }, { value: "480", label: "480p" }]}
                />
                <Select value={undefined} onValueChange={() => {}} placeholder={t("Disabled", "Gesperrt")} options={[]} disabled />
            </Block>

            <Block title={t("Slider", "Regler")}>
                <View className="rounded-surface bg-sm-surface-raised px-4 py-2">
                    <View className="flex-row justify-between">
                        <Text className="text-[15px]">{t("Value", "Wert")}</Text>
                        <Text className="text-[15px] font-semibold">{slider}</Text>
                    </View>
                    <Slider value={slider} onValueChange={setSlider} min={0} max={100} step={5} accessibilityLabel={t("Value", "Wert")} />
                    <Slider value={70} onValueChange={() => {}} disabled accessibilityLabel={t("Disabled", "Gesperrt")} />
                </View>
            </Block>

            <Block title={t("Overlays", "Überlagerungen")}>
                <View className="flex-row flex-wrap gap-2">
                    <Button intent="secondary" onPress={() => setSheetOpen(true)}>{t("Sheet", "Blatt")}</Button>
                    <Button intent="secondary" onPress={() => setDialogOpen(true)}>Dialog</Button>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button intent="secondary">Popover</Button>
                        </PopoverTrigger>
                        <PopoverContent align="start">
                            <Text className="px-3 py-2 text-[15px] font-semibold">Popover</Text>
                            <Muted className="px-3 pb-2">{t("Opens out of what was tapped.", "Öffnet sich aus dem Angetippten.")}</Muted>
                        </PopoverContent>
                    </Popover>
                </View>
                <View className="flex-row flex-wrap gap-2">
                    <Button intent="secondary" onPress={() => toast.success(t("Saved", "Gespeichert"))}>{t("Success", "Erfolg")}</Button>
                    <Button intent="secondary" onPress={() => toast.error(t("Something failed", "Etwas ging schief"))}>{t("Error", "Fehler")}</Button>
                    <Button intent="secondary" onPress={() => toast.warning(t("Careful", "Vorsicht"))}>{t("Warning", "Warnung")}</Button>
                    <Button intent="secondary" onPress={() => toast.info(t("Good to know", "Gut zu wissen"), { description: t("With a second line.", "Mit einer zweiten Zeile.") })}>Info</Button>
                </View>
            </Block>

            <Block title={t("List rows", "Listenzeilen")}>
                <ListGroup>
                    <ListRow title={t("Plain row", "Einfache Zeile")} side="24 min" />
                    <ListRow title={t("Row that opens a page", "Zeile, die eine Seite öffnet")} meta={t("With a second line", "Mit einer zweiten Zeile")} chevron onPress={() => {}} />
                    <ListRow
                        title={t("Row with an icon", "Zeile mit Symbol")}
                        meta={t("Areas and menus", "Bereiche und Menüs")}
                        leading={<ListIcon><MobileIcon name="calendar" size={22} color={colors.smTextMuted} /></ListIcon>}
                        chevron
                        onPress={() => {}}
                    />
                    <ListRow title={t("Row with a cover slot", "Zeile mit Cover-Platz")} meta={t("Episode 5", "Folge 5")} leading={<ListCover />} side="4:00" onPress={() => {}} />
                    <ListRow title={t("Disabled row", "Gesperrte Zeile")} disabled onPress={() => {}} />
                </ListGroup>
            </Block>

            <Block title={t("Colours", "Farben")}>
                <View className="flex-row flex-wrap gap-3">
                    {colorSwatches.map(swatch => (
                        <View key={swatch.name} className="w-[30%] gap-1">
                            <View className="h-12 rounded-surface-sm border border-sm-line" style={{ backgroundColor: swatch.value }} />
                            <Text numberOfLines={1} className="text-xs text-sm-text-muted">{swatch.name}</Text>
                        </View>
                    ))}
                </View>
            </Block>

            <Block title={t("Radii", "Radien")}>
                <View className="flex-row flex-wrap gap-3">
                    {Object.entries(radii).filter(([name]) => name !== "full").map(([name, value]) => (
                        <View key={name} className="items-center gap-1">
                            <View className="h-14 w-14 bg-sm-surface-control" style={{ borderRadius: value }} />
                            <Text className="text-xs text-sm-text-muted">{name} {value}</Text>
                        </View>
                    ))}
                </View>
            </Block>

            <Block title={t("Spacing", "Abstände")}>
                <View className="gap-1.5 rounded-surface bg-sm-surface-raised p-4">
                    {spacingScale.filter(v => v > 0).map(value => (
                        <View key={value} className="flex-row items-center gap-3">
                            <Text className="w-10 text-xs text-sm-text-muted">{value}dp</Text>
                            <View className="h-2 rounded-full bg-sm-accent-strong" style={{ width: value * 4 }} />
                        </View>
                    ))}
                </View>
            </Block>

            <Block title={t("Curves and durations", "Kurven und Dauern")}>
                <ListGroup>
                    <ListRow title={t("Phone", "Handy")} meta={cssBezier(PHONE_EASE)} side={`${DURATION.swapPhone} ms`} />
                    <ListRow title={t("Tablet / ease-out", "Tablet / Ease-out")} meta={cssBezier(MOTION_EASE_OUT)} side={`${DURATION.swapTablet} ms`} />
                    <ListRow title={t("Sheets and drawers", "Blätter und Schubladen")} meta={cssBezier(DRAWER_EASE)} side={`${DURATION.sheetPhone} ms`} />
                    <ListRow title={t("Pop", "Aufploppen")} meta={cssBezier(POP_EASE)} side={`${DURATION.toastCheck} ms`} />
                    <ListRow title={t("Press", "Drücken")} meta="scale .97" side={`${DURATION.press} ms`} />
                    <ListRow title="WAIT_MS" meta={t("Cover flight waits for the picture", "Cover-Flug wartet aufs Bild")} side={`${WAIT_MS} ms`} />
                </ListGroup>
            </Block>

            <Sheet
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                title={t("Sheet", "Blatt")}
                description={t("Rises from the bottom on a phone, slides in from the right on a wide tablet.", "Steigt am Handy von unten auf, kommt am breiten Tablet von rechts.")}
                footer={<>
                    <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setSheetOpen(false)}>{t("Cancel", "Abbrechen")}</Button>
                    <Button intent="primary" wrapperClassName="flex-[2]" onPress={() => setSheetOpen(false)}>{t("Done", "Fertig")}</Button>
                </>}
            >
                <SheetGroup title={t("Group", "Gruppe")} note={t("Groups hold related options.", "Gruppen halten zusammengehörige Optionen.")}>
                    <ListGroup>
                        <SwitchRow label={t("Option", "Option")} checked={rowSwitch} onCheckedChange={setRowSwitch} />
                    </ListGroup>
                </SheetGroup>
            </Sheet>

            <Dialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                title={t("Delete episode from phone?", "Folge vom Handy löschen?")}
                description={t("The dialog of the building blocks deletes nothing.", "Der Dialog der Bausteine löscht nichts.")}
                footer={<>
                    <Button intent="secondary" onPress={() => setDialogOpen(false)}>{t("Cancel", "Abbrechen")}</Button>
                    <Button intent="danger" onPress={() => setDialogOpen(false)}>{t("Delete", "Löschen")}</Button>
                </>}
            />
        </PhoneScreen>
    )
}

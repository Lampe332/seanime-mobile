import { StaffPhone } from "@/main/staff/_screens/staff-phone"
import { useLocalSearchParams } from "expo-router"

// A person's works at "/staff?id=…&name=…&kind=anime|manga" (a staff name on an anime or manga page)
export default function StaffScreen() {
    const { id, name, kind } = useLocalSearchParams<{ id?: string, name?: string, kind?: string }>()
    return <StaffPhone id={Number(id)} name={name || undefined} kind={kind === "manga" ? "manga" : kind === "anime" ? "anime" : undefined} />
}

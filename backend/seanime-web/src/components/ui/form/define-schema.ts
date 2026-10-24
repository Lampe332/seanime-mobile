import { z as zod } from "zod"

const presets = { datePicker: zod.date() }

type DataSchemaCallback<S extends zod.ZodRawShape> = ({ z, presets }: {
    z: typeof zod,
    presets: { datePicker: zod.ZodDate }
}) => zod.ZodObject<S>

export const defineSchema = <S extends zod.ZodRawShape>(callback: DataSchemaCallback<S>): zod.ZodObject<S> => {
    return callback({ z: zod, presets })
}

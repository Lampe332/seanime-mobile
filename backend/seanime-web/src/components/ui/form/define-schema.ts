import { z as zod } from "zod"
import { schemaPresets } from "./schema-presets"

/* -------------------------------------------------------------------------------------------------
 * Helper type
 * -----------------------------------------------------------------------------------------------*/

/* -------------------------------------------------------------------------------------------------
 * Helper functions
 * -----------------------------------------------------------------------------------------------*/

type DataSchemaCallback<S extends zod.ZodRawShape> = ({ z, presets }: {
    z: typeof zod,
    presets: typeof schemaPresets
}) => zod.ZodObject<S>

export const defineSchema = <S extends zod.ZodRawShape>(callback: DataSchemaCallback<S>): zod.ZodObject<S> => {
    return callback({ z: zod, presets: schemaPresets })
}

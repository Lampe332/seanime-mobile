import appVariants from "../../app-variants.json"

/**
 * Which app this build is: the test app next to the real one (default in the repository) or the release that replaces
 * Seanime Mobile 2.0.33 (com.seanime.app.local). app-variants.json is the one source of package, name, scheme, port and
 * versionCode: app.config.js reads it for the native side (and the Kotlin port via plugins/with-server-port.js),
 * this module for the JS side. scripts/build-android.ps1 -Release switches `current` in its staged copy only.
 */
export type AppVariantName = keyof typeof appVariants.variants

export type AppVariant = (typeof appVariants.variants)[AppVariantName]

export function variantNamed(name: string): AppVariant {
    const variant = (appVariants.variants as Record<string, AppVariant | undefined>)[name]
    if (!variant) throw new Error(`app-variants.json: unknown variant "${name}"`)
    return variant
}

export const APP_VARIANT_NAME = appVariants.current as AppVariantName

export const APP_VARIANT: AppVariant = variantNamed(appVariants.current)

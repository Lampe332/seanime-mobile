/** A download, callback or matching version name alone never proves package replacement (UpdateInstallPolicy.kt). */
export function installed(before: number, target: number, actual: number): boolean {
    return before > 0 && target > before && actual >= target && actual > before
}

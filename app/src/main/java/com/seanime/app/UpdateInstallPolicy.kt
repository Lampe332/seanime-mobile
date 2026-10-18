package com.seanime.app

/** A download, callback or matching version name alone never proves package replacement. */
internal object UpdateInstallPolicy {
    fun installed(before: Long, target: Long, actual: Long): Boolean =
        before > 0 && target > before && actual >= target && actual > before
}

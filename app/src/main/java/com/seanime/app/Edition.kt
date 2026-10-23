package com.seanime.app

/** Tablet edition (-PseanimeEdition=tablet): the same app with the phone UI on tablet screens. */
object Edition {
    val TABLET = BuildConfig.EDITION == "tablet"
}

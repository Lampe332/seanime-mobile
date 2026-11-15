// geschrieben nach: öffentlicher Android-Doku (WifiManager.MulticastLock, Berechtigung CHANGE_WIFI_MULTICAST_STATE) und der öffentlichen Doku von Nitro Modules (HybridObject in Kotlin, NitroModules.applicationContext); keine Vorlage
package com.margelo.nitro.seanime.corecast

import android.content.Context
import android.net.wifi.WifiManager
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules

/** Android's multicast filter: held only while the core's search listens (src/core/cast/cast.ts) */
@DoNotStrip
@Keep
class HybridCoreCastLock : HybridCoreCastLockSpec() {
  private var lock: WifiManager.MulticastLock? = null

  @Synchronized
  override fun hold(): Boolean {
    if (lock?.isHeld == true) return true
    val wifi = NitroModules.applicationContext?.applicationContext?.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return false
    val next = wifi.createMulticastLock("seanime-cast-search").apply { setReferenceCounted(false) }
    next.acquire()
    lock = next
    return true
  }

  @Synchronized
  override fun release() {
    lock?.takeIf { it.isHeld }?.release()
    lock = null
  }
}

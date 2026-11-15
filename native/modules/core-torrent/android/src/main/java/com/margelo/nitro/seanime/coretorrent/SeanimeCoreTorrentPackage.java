// geschrieben nach: Plan „Eigener Kern" Stufe 6b-1 (Muster: modules/core-sandbox) und der öffentlichen Doku von Nitro Modules (Package eines Nitro-Moduls unter Android); keine Vorlage
package com.margelo.nitro.seanime.coretorrent;

import androidx.annotation.Nullable;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfoProvider;

import java.util.HashMap;

/**
 * The module's entry for React Native's autolinking. It offers no module of the old kind: loading the class loads the
 * C++ library, which makes the torrent session known to Nitro.
 */
public class SeanimeCoreTorrentPackage extends BaseReactPackage {
  @Nullable
  @Override
  public NativeModule getModule(String name, ReactApplicationContext reactContext) {
    return null;
  }

  @Override
  public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return () -> new HashMap<>();
  }

  static {
    SeanimeCoreTorrentOnLoad.initializeNative();
  }
}

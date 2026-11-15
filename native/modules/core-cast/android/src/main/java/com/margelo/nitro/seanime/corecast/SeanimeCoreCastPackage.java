// geschrieben nach: Plan „Eigener Kern" Phase 7c-1 und der öffentlichen Doku von Nitro Modules (Package eines Nitro-Moduls unter Android); keine Vorlage
package com.margelo.nitro.seanime.corecast;

import androidx.annotation.Nullable;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfoProvider;

import java.util.HashMap;

/**
 * The module's entry for React Native's autolinking. It offers no module of the old kind: loading the class loads the
 * C++ library, which makes the search and the lock known to Nitro.
 */
public class SeanimeCoreCastPackage extends BaseReactPackage {
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
    SeanimeCoreCastOnLoad.initializeNative();
  }
}

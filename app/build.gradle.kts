plugins {
    id("com.android.application")
}

android {
    namespace = "com.seanime.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.seanime.app.local"
        minSdk = 21
        targetSdk = 36
        versionCode = providers.gradleProperty("seanimeBaselineCode").orNull?.toInt() ?: 31126
        versionName = providers.gradleProperty("seanimeBaselineVersion").orNull ?: "2.0.31"
        testInstrumentationRunner = providers.gradleProperty("seanimeAuditRunner").orNull
            ?: "com.seanime.app.audit.OfflineInstrumentation"
        ndk { abiFilters += setOf("arm64-v8a", "armeabi-v7a") }
        // -PseanimeAppIdSuffix=.fresh installs a separate copy next to the real app (fresh-install testing)
        providers.gradleProperty("seanimeAppIdSuffix").orNull?.let { applicationIdSuffix = it }
    }

    sourceSets["main"].jniLibs.srcDirs("src/main/jniLibs")
    sourceSets["main"].assets.srcDir("../backend/seanime-web/src/lib/mobile-icons")
    testBuildType = "release"

    packaging {
        jniLibs {
            // libseanime.so is an executable Go binary packaged as a native library.
            // It must be extracted so ProcessBuilder can execute it from nativeLibraryDir.
            useLegacyPackaging = true
        }
    }

    val releaseStore = providers.environmentVariable("SEANIME_SIGNING_STORE").orNull
        ?.let { file(it) } ?: rootProject.file("../seanime-mobile-signing/seanime-android.p12")
    val releasePassword = providers.environmentVariable("SEANIME_SIGNING_PASSWORD").orNull
    if (releaseStore.isFile && !releasePassword.isNullOrBlank()) {
        signingConfigs.create("localRelease") {
            storeFile = releaseStore
            storePassword = releasePassword
            keyAlias = providers.environmentVariable("SEANIME_SIGNING_ALIAS").orNull ?: "seanime-android"
            keyPassword = releasePassword
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("localRelease")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation("androidx.media3:media3-exoplayer:1.8.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.8.1")
    implementation("androidx.media3:media3-ui:1.8.1")
    // FFmpeg audio decoders (AC3, E-AC3, DTS, TrueHD …) for the app's own players; the WebView and many devices have none
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:1.8.0+1")
    // Google TV / Chromecast casting with Google's default receiver
    implementation("com.google.android.gms:play-services-cast-framework:22.1.0")
}

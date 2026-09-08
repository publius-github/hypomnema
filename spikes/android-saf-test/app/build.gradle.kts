plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hypomnema.safspike"
    compileSdk = 36

    defaultConfig {
        // Deliberately its own applicationId (not com.hypomnema.app) so this
        // spike installs side by side with the real app on the same test
        // device instead of colliding with it.
        applicationId = "com.hypomnema.safspike"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        getByName("debug") {
            isDebuggable = true
        }
        getByName("release") {
            // No signing config on purpose - this app is never distributed,
            // only side-loaded as a debug build. `assembleDebug` is the only
            // build type this project is meant to be run through.
            isMinifyEnabled = false
        }
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.documentfile:documentfile:1.0.1")
}

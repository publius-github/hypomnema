plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hypomnema.googleauth"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    // Google Identity Services: AuthorizationClient, the current way to
    // ask for an OAuth scope on Android (Google Sign-In is deprecated).
    implementation("com.google.android.gms:play-services-auth:21.4.0")
    implementation(project(":tauri-android"))
}

// Standalone throwaway app for ROADMAP.md Phase 0 / Spike A - not part of the
// Tauri project (src-tauri/gen/android). Versions here are pinned to match
// that project's toolchain (see its build.gradle.kts / gradle-wrapper.properties)
// so both share the same already-downloaded Gradle/AGP/Kotlin distributions.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}

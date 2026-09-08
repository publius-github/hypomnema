package com.hypomnema.safspike

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.method.ScrollingMovementMethod
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.documentfile.provider.DocumentFile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Throwaway spike app for docs/android/ROADMAP.md Phase 0 / Spike A -
 * NOT part of the real app (see spikes/android-saf-test/README.md).
 *
 * Question this answers: can a normal Android app get read/write access to
 * a folder that a Dropbox sync client keeps live-synced, via the Storage
 * Access Framework, and does that access survive an app restart / device
 * reboot? No Rust, no Tauri, no vault logic - just the raw SAF calls
 * FilesystemSyncProvider would need to build on.
 *
 * Manual test flow (see README.md for the full checklist):
 *  1. Pick the Dropbox-synced vault folder (or a subfolder of it).
 *  2. Write a test file from the phone; confirm it shows up on desktop.
 *  3. Edit that file from desktop; confirm the phone can read the new
 *     content once Dropbox has synced it down.
 *  4. Force-stop / restart the app, and separately reboot the device, and
 *     confirm the folder access is still there without re-picking (that's
 *     the "persisted across restarts/reboots" exit criterion).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusView: TextView
    private lateinit var logView: TextView
    private var treeUri: Uri? = null

    private val pickFolder =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri == null) {
                log("Folder pick cancelled.")
                return@registerForActivityResult
            }
            val flags =
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            try {
                contentResolver.takePersistableUriPermission(uri, flags)
            } catch (e: SecurityException) {
                log("takePersistableUriPermission failed: $e")
                return@registerForActivityResult
            }
            prefs().edit().putString(KEY_TREE_URI, uri.toString()).apply()
            treeUri = uri
            log("Picked folder and took a persistable permission grant:\n  $uri")
            refreshStatus()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        restoreFolder()
    }

    // Built in code rather than an XML layout - this app is throwaway and
    // small enough that a res/layout file would be pure overhead.
    private fun buildUi(): ViewGroup {
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        // Android 15+ (targetSdk 36) draws content edge-to-edge by default -
        // without this, the status/nav bars overlap the top and bottom of
        // the layout instead of pushing it down (button 1 and the status
        // line end up hidden under the status bar).
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(pad + bars.left, pad + bars.top, pad + bars.right, pad + bars.bottom)
            insets
        }

        statusView = TextView(this).apply {
            textSize = 14f
            setPadding(0, 0, 0, pad)
        }
        root.addView(statusView)

        fun button(label: String, onClick: () -> Unit) = Button(this).apply {
            text = label
            setOnClickListener { onClick() }
        }
        root.addView(button("1. Pick synced folder") { pickFolder.launch(null) })
        root.addView(button("2. Write test file") { writeTestFile() })
        root.addView(button("3. Read test file") { readTestFile() })
        root.addView(button("4. List folder contents") { listFolder() })
        root.addView(button("5. Forget folder (reset)") { forgetFolder() })

        logView = TextView(this).apply {
            textSize = 12f
            setPadding(0, pad, 0, 0)
            movementMethod = ScrollingMovementMethod()
            setTextIsSelectable(true)
        }
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
            )
            addView(logView)
        }
        root.addView(scroll)
        return root
    }

    private fun prefs() = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Runs on every launch - this is the actual "survived a restart?" check. */
    private fun restoreFolder() {
        val saved = prefs().getString(KEY_TREE_URI, null)
        if (saved == null) {
            log("No folder saved yet - tap 'Pick synced folder' first.")
            refreshStatus()
            return
        }
        val uri = Uri.parse(saved)
        // Ask the OS directly rather than trusting our own SharedPreferences
        // copy - this is the real signal for whether the grant survived.
        val stillGranted = contentResolver.persistedUriPermissions.any {
            it.uri == uri && it.isReadPermission && it.isWritePermission
        }
        if (!stillGranted) {
            log("Saved a folder before, but the OS no longer lists a persisted " +
                "permission for it (revoked, or app data was cleared):\n  $uri")
            refreshStatus()
            return
        }
        val doc = DocumentFile.fromTreeUri(this, uri)
        if (doc == null || !doc.isDirectory) {
            log("Permission is still persisted, but the URI no longer resolves " +
                "to a directory:\n  $uri")
            refreshStatus()
            return
        }
        treeUri = uri
        log("Restored access to the previously picked folder without re-prompting " +
            "(permission survived this app restart):\n  $uri\n" +
            "  (${doc.listFiles().size} entries visible right now)")
        refreshStatus()
    }

    private fun refreshStatus() {
        statusView.text = treeUri?.let { "Linked folder:\n$it" } ?: "No folder linked yet."
    }

    private fun requireFolder(): DocumentFile? {
        val uri = treeUri
        if (uri == null) {
            log("No folder picked yet - tap 'Pick synced folder' first.")
            return null
        }
        val doc = DocumentFile.fromTreeUri(this, uri)
        if (doc == null || !doc.isDirectory) {
            log("Linked folder no longer resolves - pick it again.")
            return null
        }
        return doc
    }

    private fun writeTestFile() {
        val dir = requireFolder() ?: return
        try {
            val file = dir.findFile(TEST_FILE_NAME) ?: dir.createFile("text/plain", TEST_FILE_NAME)
            if (file == null) {
                log("createFile returned null - write failed.")
                return
            }
            val stamp = timestamp()
            val body = "Hypomnema SAF spike test file\n" +
                "written by: ${Build.MANUFACTURER} ${Build.MODEL}\n" +
                "at: $stamp\n"
            val out = contentResolver.openOutputStream(file.uri, "wt")
            if (out == null) {
                log("openOutputStream returned null - write failed.")
                return
            }
            out.use { it.write(body.toByteArray()) }
            log("Wrote $TEST_FILE_NAME at $stamp.\n" +
                "Now check on desktop that this file exists in the synced Dropbox " +
                "folder with this content (give Dropbox a few seconds to sync up).")
        } catch (e: Exception) {
            log("Write failed: $e")
        }
    }

    private fun readTestFile() {
        val dir = requireFolder() ?: return
        val file = dir.findFile(TEST_FILE_NAME)
        if (file == null) {
            log("$TEST_FILE_NAME not found in the folder.\n" +
                "Create/edit it on desktop, wait for Dropbox to sync it down, then retry.")
            return
        }
        try {
            val text = contentResolver.openInputStream(file.uri)
                ?.bufferedReader()?.use { it.readText() }
            log("Read $TEST_FILE_NAME (${file.length()}B, modified ${fmtTime(file.lastModified())}):\n" +
                "---\n${text ?: "<empty>"}---")
        } catch (e: Exception) {
            log("Read failed: $e")
        }
    }

    private fun listFolder() {
        val dir = requireFolder() ?: return
        val entries = dir.listFiles()
        if (entries.isEmpty()) {
            log("Folder is empty (as seen from this app).")
            return
        }
        val lines = entries.joinToString("\n") { f ->
            "  ${f.name}  (${f.length()}B, modified ${fmtTime(f.lastModified())})"
        }
        log("Folder contents (${entries.size} entries):\n$lines")
    }

    private fun forgetFolder() {
        treeUri?.let { uri ->
            try {
                contentResolver.releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
            } catch (e: SecurityException) {
                log("releasePersistableUriPermission failed (ignoring): $e")
            }
        }
        prefs().edit().remove(KEY_TREE_URI).apply()
        treeUri = null
        refreshStatus()
        log("Forgot the folder. Pick again to re-test the permission flow from scratch.")
    }

    private fun timestamp() = fmtTime(System.currentTimeMillis())

    private fun fmtTime(ms: Long) =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(ms))

    private fun log(msg: String) {
        logView.append("[${timestamp()}] $msg\n\n")
    }

    private companion object {
        const val PREFS_NAME = "saf_spike_prefs"
        const val KEY_TREE_URI = "tree_uri"
        const val TEST_FILE_NAME = "hypomnema-saf-test.txt"
    }
}

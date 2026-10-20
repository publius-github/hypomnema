package com.hypomnema.widget

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
class PublishArgs {
  lateinit var json: String
  lateinit var queuePath: String
}

/**
 * The core's door to the widget: `publish` replaces the data file and
 * redraws every placed widget, `takeLaunchTarget` says which list a
 * widget tap opened the app for. The target comes in the launch intent
 * - the one the activity was created with, or a later one through
 * onNewIntent - and is handed over once, then forgotten, so a return
 * from recents does not reopen it.
 */
@TauriPlugin
class WidgetPlugin(private val activity: Activity) : Plugin(activity) {
  private var launchList: Long? = null
  private var launchAdd: Boolean = false

  override fun load(webView: WebView) {
    takeFrom(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    takeFrom(intent)
  }

  private fun takeFrom(intent: Intent?) {
    if (intent == null || !intent.hasExtra(WidgetStore.EXTRA_LIST)) return
    val list = intent.getLongExtra(WidgetStore.EXTRA_LIST, -1L)
    launchAdd = intent.getBooleanExtra(WidgetStore.EXTRA_ADD, false)
    launchList = if (list >= 0) list else null
    // consumed: an activity recreated from recents keeps its intent
    intent.removeExtra(WidgetStore.EXTRA_LIST)
    intent.removeExtra(WidgetStore.EXTRA_ADD)
  }

  @Command
  fun publish(invoke: Invoke) {
    val args = invoke.parseArgs(PublishArgs::class.java)
    try {
      WidgetStore.write(activity, args.json, args.queuePath)
      ListWidgetProvider.refreshAll(activity)
    } catch (e: Exception) {
      invoke.reject("widget data could not be written: ${e.message}")
      return
    }
    invoke.resolve()
  }

  @Command
  fun takeLaunchTarget(invoke: Invoke) {
    val out = JSObject()
    val list = launchList
    if (list == null) {
      out.put("list", JSONObject.NULL)
      out.put("add", false)
    } else {
      out.put("list", list)
      out.put("add", launchAdd)
    }
    launchList = null
    launchAdd = false
    invoke.resolve(out)
  }
}

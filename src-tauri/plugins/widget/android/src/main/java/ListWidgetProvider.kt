package com.hypomnema.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews

/**
 * The home-screen widget: one list, its name and open count over its
 * tasks as a scrolling checklist. A row tap ticks the task (or unticks
 * it on a checklist); the name opens the app on the list; + opens it
 * with the add field ready. The widget never runs the core: it draws
 * from the file the core publishes and queues its taps for the core to
 * apply (WidgetStore).
 */
class ListWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { id -> draw(context, manager, id) }
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    WidgetStore.forget(context, ids)
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION_TOGGLE) {
      val task = intent.getLongExtra(EXTRA_TASK, -1L)
      val status = intent.getStringExtra(EXTRA_STATUS)
      if (task >= 0 && (status == "done" || status == "todo")) {
        WidgetStore.queue(context, task, status)
        refreshAll(context)
      }
      return
    }
    super.onReceive(context, intent)
  }

  companion object {
    const val ACTION_TOGGLE = "com.hypomnema.widget.TOGGLE"
    const val EXTRA_TASK = "com.hypomnema.widget.TASK"
    const val EXTRA_STATUS = "com.hypomnema.widget.STATUS"
    private const val FALLBACK_COLOR = 0xFF3B82F6.toInt()

    /** Redraws every placed widget from the current data file. */
    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, ListWidgetProvider::class.java))
      ids.forEach { id -> draw(context, manager, id) }
    }

    fun draw(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.hw_widget)
      val list = WidgetStore.listFor(context, widgetId)
      val listId = WidgetStore.listIdFor(context, widgetId)

      views.setTextViewText(R.id.hw_name, list?.name ?: context.getString(R.string.hw_missing_list))
      views.setTextViewText(R.id.hw_count, list?.open?.toString() ?: "")
      views.setInt(R.id.hw_dot, "setColorFilter", parseColor(list?.color))
      views.setTextViewText(
        R.id.hw_empty,
        context.getString(if (list == null) R.string.hw_missing_hint else R.string.hw_empty),
      )

      // the rows come from ListWidgetService; the intent's data URI makes
      // each widget's adapter its own (extras alone do not tell intents apart)
      val adapter = Intent(context, ListWidgetService::class.java)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      adapter.data = Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME))
      views.setRemoteAdapter(R.id.hw_tasks, adapter)
      views.setEmptyView(R.id.hw_tasks, R.id.hw_empty)

      // one template for every row; the row fills in the task and status
      val toggle = Intent(context, ListWidgetProvider::class.java).setAction(ACTION_TOGGLE)
      toggle.data = Uri.parse("hypomnema-widget://toggle/$widgetId")
      views.setPendingIntentTemplate(
        R.id.hw_tasks,
        PendingIntent.getBroadcast(context, widgetId, toggle, mutableFlags()),
      )

      views.setOnClickPendingIntent(R.id.hw_name, launch(context, widgetId * 2, listId, false))
      views.setOnClickPendingIntent(R.id.hw_add, launch(context, widgetId * 2 + 1, listId, true))

      manager.updateAppWidget(widgetId, views)
      manager.notifyAppWidgetViewDataChanged(widgetId, R.id.hw_tasks)
    }

    private fun launch(context: Context, code: Int, listId: Long, add: Boolean): PendingIntent? {
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(WidgetStore.EXTRA_LIST, listId)
        .putExtra(WidgetStore.EXTRA_ADD, add)
      intent.data = Uri.parse("hypomnema-widget://open/$listId/${if (add) "add" else "view"}")
      return PendingIntent.getActivity(context, code, intent, immutableFlags())
    }

    private fun parseColor(hex: String?): Int =
      try {
        if (hex.isNullOrEmpty()) FALLBACK_COLOR else Color.parseColor(hex)
      } catch (e: IllegalArgumentException) {
        FALLBACK_COLOR
      }

    private fun immutableFlags(): Int {
      var flags = PendingIntent.FLAG_UPDATE_CURRENT
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
      return flags
    }

    /** A template a row fills in has to stay mutable. */
    private fun mutableFlags(): Int {
      var flags = PendingIntent.FLAG_UPDATE_CURRENT
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
      return flags
    }
  }
}

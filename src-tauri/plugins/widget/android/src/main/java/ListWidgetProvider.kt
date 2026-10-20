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
import android.view.View
import android.widget.RemoteViews

/**
 * The home-screen widgets: a name over a scrolling list. A widget never
 * runs the core: it draws from the file the core publishes and queues
 * its taps for the core to apply (WidgetStore). DayWidgetProvider shows
 * today as the Day screen lays it out: a row tap ticks the task, the
 * name opens the app on the Day and + opens it with the add field
 * ready. ListWidgetProvider shows every list with its open count: a row
 * tap opens the app on that list, the name opens the app. The two are
 * one class apart so the launcher offers them as two widgets.
 */
abstract class TaskWidgetProvider : AppWidgetProvider() {
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

    /** Redraws every placed widget of both kinds from the current data file. */
    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      listOf(ListWidgetProvider::class.java, DayWidgetProvider::class.java).forEach { kind ->
        manager.getAppWidgetIds(ComponentName(context, kind)).forEach { id -> draw(context, manager, id) }
      }
    }

    fun draw(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.hw_widget)
      val day = WidgetStore.isDay(context, widgetId)
      val view = WidgetStore.viewFor(context, widgetId)

      views.setTextViewText(
        R.id.hw_name,
        view?.name ?: context.getString(if (day) R.string.hw_today else R.string.hw_lists),
      )
      views.setTextViewText(R.id.hw_count, view?.open?.toString() ?: "")
      views.setInt(R.id.hw_dot, "setColorFilter", FALLBACK_COLOR)
      views.setViewVisibility(R.id.hw_dot, if (day) View.VISIBLE else View.GONE)
      views.setViewVisibility(R.id.hw_add, if (day) View.VISIBLE else View.GONE)
      views.setTextViewText(
        R.id.hw_empty,
        context.getString(
          when {
            view == null -> R.string.hw_no_data
            day -> R.string.hw_empty
            else -> R.string.hw_no_lists
          },
        ),
      )

      // the rows come from ListWidgetService; the intent's data URI makes
      // each widget's adapter its own (extras alone do not tell intents apart)
      val adapter = Intent(context, ListWidgetService::class.java)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      adapter.data = Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME))
      views.setRemoteAdapter(R.id.hw_tasks, adapter)
      views.setEmptyView(R.id.hw_tasks, R.id.hw_empty)

      // one template for every row: a task row fills in the task and
      // status of a tick, a list row the list to open the app on
      if (day) {
        val toggle = Intent(context, DayWidgetProvider::class.java).setAction(ACTION_TOGGLE)
        toggle.data = Uri.parse("hypomnema-widget://toggle/$widgetId")
        views.setPendingIntentTemplate(
          R.id.hw_tasks,
          PendingIntent.getBroadcast(context, widgetId, toggle, mutableFlags()),
        )
      } else {
        launchIntent(context)?.let { open ->
          open.data = Uri.parse("hypomnema-widget://open/list/$widgetId")
          views.setPendingIntentTemplate(
            R.id.hw_tasks,
            PendingIntent.getActivity(context, widgetId, open, mutableFlags()),
          )
        }
      }

      views.setOnClickPendingIntent(R.id.hw_name, launch(context, widgetId * 2, day, false))
      views.setOnClickPendingIntent(R.id.hw_add, launch(context, widgetId * 2 + 1, day, true))

      manager.updateAppWidget(widgetId, views)
      manager.notifyAppWidgetViewDataChanged(widgetId, R.id.hw_tasks)
    }

    private fun launchIntent(context: Context): Intent? =
      context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)

    /** Opens the app: on the Day for the today widget, as is for the lists widget. */
    private fun launch(context: Context, code: Int, day: Boolean, add: Boolean): PendingIntent? {
      val intent = launchIntent(context) ?: return null
      intent.putExtra(WidgetStore.EXTRA_DAY, day)
        .putExtra(WidgetStore.EXTRA_LIST, -1L)
        .putExtra(WidgetStore.EXTRA_ADD, add)
      val where = if (day) "day" else "app"
      intent.data = Uri.parse("hypomnema-widget://open/$where/${if (add) "add" else "view"}")
      return PendingIntent.getActivity(context, code, intent, immutableFlags())
    }

    fun parseColor(hex: String?): Int =
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

/** Every list with its open count; a row opens the app on the list. */
class ListWidgetProvider : TaskWidgetProvider()

/** Today, with no configuration: the widget marks itself as the day's on its first draw. */
class DayWidgetProvider : TaskWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { id -> WidgetStore.setDay(context, id) }
    super.onUpdate(context, manager, ids)
  }
}

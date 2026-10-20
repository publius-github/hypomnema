package com.hypomnema.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** The widget's rows, one list's tasks, for the ListView in hw_widget. */
class ListWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
    val widgetId = intent.getIntExtra(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID,
    )
    return Factory(applicationContext, widgetId)
  }

  private class Factory(private val context: Context, private val widgetId: Int) : RemoteViewsFactory {
    private var rows: List<WidgetTask> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
      rows = WidgetStore.listFor(context, widgetId)?.tasks ?: emptyList()
    }

    override fun onDestroy() {}

    override fun getCount() = rows.size

    override fun getViewAt(position: Int): RemoteViews {
      val row = rows[position]
      val views = RemoteViews(context.packageName, R.layout.hw_widget_row)
      views.setImageViewResource(
        R.id.hw_check,
        if (row.done) R.drawable.hw_check_done else R.drawable.hw_check_empty,
      )
      views.setTextViewText(R.id.hw_title, row.title)
      val flags = Paint.ANTI_ALIAS_FLAG or if (row.done) Paint.STRIKE_THRU_TEXT_FLAG else 0
      views.setInt(R.id.hw_title, "setPaintFlags", flags)
      views.setTextColor(
        R.id.hw_title,
        context.getColor(if (row.done) R.color.hw_muted else R.color.hw_text),
      )
      views.setViewVisibility(R.id.hw_priority, if (row.priority && !row.done) View.VISIBLE else View.GONE)
      val fillIn = Intent()
        .putExtra(ListWidgetProvider.EXTRA_TASK, row.id)
        .putExtra(ListWidgetProvider.EXTRA_STATUS, if (row.done) "todo" else "done")
      views.setOnClickFillInIntent(R.id.hw_row, fillIn)
      return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount() = 1

    override fun getItemId(position: Int) = rows[position].id

    override fun hasStableIds() = true
  }
}

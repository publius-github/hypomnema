package com.hypomnema.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** The widget's rows - plates and tasks, or lists - for the ListView in hw_widget. */
class ListWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
    val widgetId = intent.getIntExtra(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID,
    )
    return Factory(applicationContext, widgetId)
  }

  private class Factory(private val context: Context, private val widgetId: Int) : RemoteViewsFactory {
    private var rows: List<WidgetRow> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
      rows = WidgetStore.viewFor(context, widgetId)?.rows ?: emptyList()
    }

    override fun onDestroy() {}

    override fun getCount() = rows.size

    override fun getViewAt(position: Int): RemoteViews {
      val row = when (val entry = rows[position]) {
        is WidgetRow.Header -> {
          val header = RemoteViews(context.packageName, R.layout.hw_widget_header)
          header.setTextViewText(R.id.hw_header, entry.label)
          return header
        }
        is WidgetRow.ListEntry -> {
          val list = RemoteViews(context.packageName, R.layout.hw_widget_list_row)
          list.setTextViewText(R.id.hw_list_name, entry.name)
          list.setTextViewText(R.id.hw_list_count, if (entry.open > 0) entry.open.toString() else "")
          list.setInt(R.id.hw_list_dot, "setColorFilter", TaskWidgetProvider.parseColor(entry.color))
          list.setOnClickFillInIntent(
            R.id.hw_list_row,
            Intent()
              .putExtra(WidgetStore.EXTRA_DAY, false)
              .putExtra(WidgetStore.EXTRA_LIST, entry.id)
              .putExtra(WidgetStore.EXTRA_ADD, false),
          )
          return list
        }
        is WidgetRow.Task -> entry.task
      }
      val views = RemoteViews(context.packageName, R.layout.hw_widget_row)
      views.setImageViewResource(
        R.id.hw_check,
        if (row.done) R.drawable.hw_check_done else R.drawable.hw_check_empty,
      )
      // struck through by a span: setPaintFlags is not a method
      // RemoteViews may call, and a refused call fails the row
      val title = SpannableString(row.title)
      if (row.done) title.setSpan(StrikethroughSpan(), 0, title.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      views.setTextViewText(R.id.hw_title, title)
      views.setTextColor(
        R.id.hw_title,
        context.getColor(if (row.done) R.color.hw_muted else R.color.hw_text),
      )
      views.setViewVisibility(R.id.hw_priority, if (row.priority && !row.done) View.VISIBLE else View.GONE)
      val fillIn = Intent()
        .putExtra(TaskWidgetProvider.EXTRA_TASK, row.id)
        .putExtra(TaskWidgetProvider.EXTRA_STATUS, if (row.done) "todo" else "done")
      views.setOnClickFillInIntent(R.id.hw_row, fillIn)
      return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount() = 3

    override fun getItemId(position: Int) = when (val entry = rows[position]) {
      is WidgetRow.Header -> -(position + 1).toLong()
      is WidgetRow.Task -> entry.task.id
      is WidgetRow.ListEntry -> entry.id
    }

    override fun hasStableIds() = true
  }
}

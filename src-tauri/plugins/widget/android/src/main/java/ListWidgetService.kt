package com.hypomnema.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** The widget's rows - plates and tasks, or list cards - for the ListView in hw_widget. */
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

    override fun getViewAt(position: Int): RemoteViews =
      when (val entry = rows[position]) {
        is WidgetRow.Header -> {
          val header = RemoteViews(context.packageName, R.layout.hw_widget_header)
          header.setTextViewText(R.id.hw_header, entry.label)
          header
        }
        is WidgetRow.Task -> taskRow(entry.task)
        is WidgetRow.ListCard -> listCard(entry.list)
      }

    /** A task as the Day screen reads it: the category chip, the weekday marker, the text. */
    private fun styled(task: WidgetTask): CharSequence {
      val text = SpannableStringBuilder()
      if (task.category != null) {
        val start = text.length
        text.append(task.category)
        text.setSpan(StyleSpan(android.graphics.Typeface.BOLD), start, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        text.setSpan(
          ForegroundColorSpan(TaskWidgetProvider.parseColor(task.categoryColor)),
          start,
          text.length,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        text.append("  ")
      }
      if (task.dow != null) {
        val start = text.length
        text.append("[").append(task.dow).append("] ")
        text.setSpan(
          ForegroundColorSpan(context.getColor(R.color.hw_muted)),
          start,
          text.length,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
      }
      val start = text.length
      text.append(task.title)
      // struck through by a span: setPaintFlags is not a method
      // RemoteViews may call, and a refused call fails the row
      if (task.done) {
        text.setSpan(StrikethroughSpan(), start, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        text.setSpan(
          ForegroundColorSpan(context.getColor(R.color.hw_muted)),
          start,
          text.length,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
      }
      return text
    }

    /** A row of the today widget; a tap opens the app on the Day. */
    private fun taskRow(task: WidgetTask): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.hw_widget_row)
      views.setTextViewText(R.id.hw_title, styled(task))
      views.setViewVisibility(R.id.hw_priority, if (task.priority) View.VISIBLE else View.GONE)
      views.setOnClickFillInIntent(R.id.hw_row, Intent())
      return views
    }

    /** One list with its tasks numbered under its name; a tap opens the app on the list. */
    private fun listCard(list: WidgetList): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.hw_widget_list_row)
      views.setTextViewText(
        R.id.hw_list_name,
        if (list.group != null) "${list.group} / ${list.name}" else list.name,
      )
      views.setTextViewText(R.id.hw_list_count, if (list.open > 0) list.open.toString() else "")
      views.setInt(R.id.hw_list_dot, "setColorFilter", TaskWidgetProvider.parseColor(list.color))
      if (list.tasks.isEmpty()) {
        views.setTextViewText(R.id.hw_list_items, context.getString(R.string.hw_list_empty))
        views.setTextColor(R.id.hw_list_items, context.getColor(R.color.hw_muted))
      } else {
        val items = SpannableStringBuilder()
        list.tasks.forEachIndexed { i, task ->
          if (i > 0) items.append("\n")
          items.append("${i + 1}. ").append(styled(task))
        }
        views.setTextViewText(R.id.hw_list_items, items)
        views.setTextColor(R.id.hw_list_items, context.getColor(R.color.hw_text))
      }
      views.setOnClickFillInIntent(
        R.id.hw_list_row,
        Intent()
          .putExtra(WidgetStore.EXTRA_DAY, false)
          .putExtra(WidgetStore.EXTRA_LIST, list.id)
          .putExtra(WidgetStore.EXTRA_ADD, false),
      )
      return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount() = 3

    override fun getItemId(position: Int) = when (val entry = rows[position]) {
      is WidgetRow.Header -> -(position + 1).toLong()
      is WidgetRow.Task -> entry.task.id
      is WidgetRow.ListCard -> entry.list.id
    }

    override fun hasStableIds() = true
  }
}

package com.hypomnema.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** The widget's rows - plates, category headers and tasks, or list cards (head, rows, foot) - for the ListView in hw_widget. */
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
    private var theme: WidgetTheme = WidgetStore.fallbackTheme(context)

    override fun onCreate() {}

    override fun onDataSetChanged() {
      rows = WidgetStore.viewFor(context, widgetId)?.rows ?: emptyList()
      theme = WidgetStore.data(context)?.theme ?: WidgetStore.fallbackTheme(context)
    }

    override fun onDestroy() {}

    override fun getCount() = rows.size

    override fun getViewAt(position: Int): RemoteViews =
      when (val entry = rows[position]) {
        is WidgetRow.Header -> {
          val header = RemoteViews(context.packageName, R.layout.hw_widget_header)
          val color = entry.color?.let { TaskWidgetProvider.parseColor(it, theme.content) }
          header.setTextViewText(R.id.hw_header, "${entry.label} \u00b7 ${entry.count}")
          header.setTextColor(R.id.hw_header, color ?: theme.content)
          // the app's plate: the colour on its own 15% wash (`tintStyle`) -
          // the filter paints the drawable, the image alpha washes it
          // (a translucent filter would blend with the drawable's white)
          header.setInt(R.id.hw_header_bg, "setColorFilter", color ?: theme.line)
          header.setInt(R.id.hw_header_bg, "setImageAlpha", if (color != null) 0x26 else 0x66)
          header
        }
        is WidgetRow.Category -> {
          val category = RemoteViews(context.packageName, R.layout.hw_widget_category)
          category.setTextViewText(R.id.hw_category, entry.label)
          category.setTextColor(R.id.hw_category, TaskWidgetProvider.parseColor(entry.color, theme.accent))
          card(category, R.id.hw_category_bg, entry.inCard)
          category.setOnClickFillInIntent(R.id.hw_category_row, Intent())
          category
        }
        is WidgetRow.Task -> taskRow(entry)
        is WidgetRow.ListHead -> listHead(entry.list)
        is WidgetRow.ListFoot -> {
          val foot = RemoteViews(context.packageName, R.layout.hw_widget_list_foot)
          foot.setInt(R.id.hw_list_foot_bg, "setColorFilter", theme.surfaceAlt)
          foot.setOnClickFillInIntent(R.id.hw_list_foot, openList(entry.list))
          foot
        }
      }

    /** Paints a row on the card's surface (lists), or leaves it on the widget's (today). */
    private fun card(views: RemoteViews, bg: Int, inCard: Boolean) {
      views.setViewVisibility(bg, if (inCard) View.VISIBLE else View.GONE)
      if (inCard) views.setInt(bg, "setColorFilter", theme.surfaceAlt)
    }

    private fun openList(list: WidgetList): Intent =
      Intent()
        .putExtra(WidgetStore.EXTRA_DAY, false)
        .putExtra(WidgetStore.EXTRA_LIST, list.id)
        .putExtra(WidgetStore.EXTRA_ADD, false)

    private fun span(text: SpannableStringBuilder, from: Int, vararg spans: Any) {
      spans.forEach { text.setSpan(it, from, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    }

    /** A task as the Day screen reads it: the category chip (when not in a header), the weekday marker, the text. */
    private fun styled(task: WidgetTask, chip: Boolean): CharSequence {
      val text = SpannableStringBuilder()
      if (chip && task.category != null) {
        val start = text.length
        text.append(task.category)
        span(
          text,
          start,
          StyleSpan(Typeface.BOLD),
          ForegroundColorSpan(TaskWidgetProvider.parseColor(task.categoryColor, theme.accent)),
        )
        text.append("  ")
      }
      if (task.dow != null) {
        val start = text.length
        text.append("[").append(task.dow).append("] ")
        span(text, start, ForegroundColorSpan(if (task.done) theme.contentMuted else theme.dowLabel))
      }
      val start = text.length
      text.append(task.title)
      // struck through by a span: setPaintFlags is not a method
      // RemoteViews may call, and a refused call fails the row
      if (task.done) span(text, start, StrikethroughSpan(), ForegroundColorSpan(theme.contentMuted))
      return text
    }

    /** A task row: on the today widget a tap opens the Day, in a list card the list. */
    private fun taskRow(row: WidgetRow.Task): RemoteViews {
      val task = row.task
      val views = RemoteViews(context.packageName, R.layout.hw_widget_row)
      views.setTextViewText(R.id.hw_title, styled(task, row.chip))
      views.setTextColor(R.id.hw_title, theme.content)
      views.setInt(R.id.hw_priority, "setColorFilter", theme.accent)
      views.setViewVisibility(R.id.hw_priority, if (task.priority) View.VISIBLE else View.GONE)
      views.setInt(R.id.hw_rule, "setColorFilter", theme.line)
      // the card's foot closes it: no hairline under the last task
      views.setViewVisibility(R.id.hw_rule, if (row.inCard && row.last) View.INVISIBLE else View.VISIBLE)
      card(views, R.id.hw_row_bg, row.inCard)
      views.setOnClickFillInIntent(R.id.hw_row, Intent())
      return views
    }

    /** A list's card head: dot, "group / name", open count; a tap opens the app on the list. */
    private fun listHead(list: WidgetList): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.hw_widget_list_row)
      views.setInt(R.id.hw_list_bg, "setColorFilter", theme.surfaceAlt)
      views.setTextViewText(
        R.id.hw_list_name,
        if (list.group != null) "${list.group} / ${list.name}" else list.name,
      )
      views.setTextColor(R.id.hw_list_name, theme.content)
      views.setTextViewText(R.id.hw_list_count, if (list.open > 0) list.open.toString() else "")
      views.setTextColor(R.id.hw_list_count, theme.contentMuted)
      views.setInt(R.id.hw_list_dot, "setColorFilter", TaskWidgetProvider.parseColor(list.color, theme.accent))
      views.setTextViewText(R.id.hw_list_empty, context.getString(R.string.hw_list_empty))
      views.setTextColor(R.id.hw_list_empty, theme.contentMuted)
      views.setViewVisibility(R.id.hw_list_empty, if (list.tasks.isEmpty()) View.VISIBLE else View.GONE)
      views.setInt(R.id.hw_list_rule, "setColorFilter", theme.line)
      views.setViewVisibility(R.id.hw_list_rule, if (list.tasks.isEmpty()) View.INVISIBLE else View.VISIBLE)
      views.setOnClickFillInIntent(R.id.hw_list_row, openList(list))
      return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount() = 5

    override fun getItemId(position: Int) = when (val entry = rows[position]) {
      is WidgetRow.Header, is WidgetRow.Category, is WidgetRow.ListFoot -> -(position + 1).toLong()
      is WidgetRow.Task -> entry.task.id
      is WidgetRow.ListHead -> entry.list.id
    }

    override fun hasStableIds() = true
  }
}

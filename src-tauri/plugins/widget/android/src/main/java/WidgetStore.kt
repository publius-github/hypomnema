package com.hypomnema.widget

import android.content.Context
import android.content.SharedPreferences
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * One task the widget draws: the title without its category, the
 * category and the chip colour the app gives it, the weekday marker of
 * a rule's task ("MON,SAT").
 */
data class WidgetTask(
  val id: Long,
  val title: String,
  val category: String?,
  val categoryColor: String?,
  val dow: String?,
  val priority: Boolean,
  val done: Boolean,
)

/** A row of a widget: a section plate or a task (today), or a whole list (lists). */
sealed class WidgetRow {
  data class Header(val label: String) : WidgetRow()
  data class Task(val task: WidgetTask) : WidgetRow()
  data class ListCard(val list: WidgetList) : WidgetRow()
}

/** What one widget draws: its name, open count (none on the lists widget) and rows. */
data class WidgetView(val name: String, val open: Int?, val rows: List<WidgetRow>)

/** Today as the core published it: the Day screen's sections. */
data class WidgetDay(val date: String, val sections: List<Pair<String, List<WidgetTask>>>)

/** One list as the core published it. */
data class WidgetList(
  val id: Long,
  val name: String,
  val color: String?,
  val group: String?,
  val tasks: List<WidgetTask>,
) {
  val open get() = tasks.count { !it.done }
}

/**
 * The widget's files and preferences, shared by the provider, the row
 * factory and the plugin. The core publishes the data file after every
 * export; the widgets only read it.
 */
object WidgetStore {
  private const val PREFS = "hypomnema.widget"
  private const val KEY_DAY = "day."

  const val EXTRA_LIST = "com.hypomnema.widget.LIST"
  const val EXTRA_DAY = "com.hypomnema.widget.DAY"
  const val EXTRA_ADD = "com.hypomnema.widget.ADD"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun dataFile(context: Context) = File(context.filesDir, "widget/data.json")

  /** Replaces the data file whole: a reader never sees a half-written one. */
  fun write(context: Context, json: String) {
    val file = dataFile(context)
    file.parentFile?.mkdirs()
    val tmp = File(file.parentFile, ".data.json.tmp")
    tmp.writeText(json)
    if (!tmp.renameTo(file)) {
      file.writeText(json)
      tmp.delete()
    }
  }

  private fun data(context: Context): Pair<WidgetDay, List<WidgetList>>? {
    val file = dataFile(context)
    if (!file.exists()) return null
    return try {
      parse(file.readText())
    } catch (e: Exception) {
      null
    }
  }

  private fun tasks(array: JSONArray?): List<WidgetTask> {
    val tasks = array ?: JSONArray()
    return (0 until tasks.length()).map { j ->
      val task = tasks.getJSONObject(j)
      WidgetTask(
        id = task.getLong("id"),
        title = task.getString("title"),
        category = task.optString("category", "").ifEmpty { null },
        categoryColor = task.optString("category_color", "").ifEmpty { null },
        dow = task.optString("dow", "").ifEmpty { null },
        priority = task.optBoolean("priority"),
        done = task.optBoolean("done"),
      )
    }
  }

  private fun parse(json: String): Pair<WidgetDay, List<WidgetList>> {
    val root = JSONObject(json)
    val day = root.optJSONObject("day")
    val sections = day?.optJSONArray("sections") ?: JSONArray()
    val today = WidgetDay(
      date = day?.optString("date", "") ?: "",
      sections = (0 until sections.length()).map { i ->
        val section = sections.getJSONObject(i)
        section.optString("label", "") to tasks(section.optJSONArray("tasks"))
      },
    )
    val lists = root.optJSONArray("lists") ?: JSONArray()
    val parsed = (0 until lists.length()).map { i ->
      val list = lists.getJSONObject(i)
      WidgetList(
        id = list.getLong("id"),
        name = list.getString("name"),
        color = list.optString("color", "").ifEmpty { null },
        group = list.optString("group", "").ifEmpty { null },
        tasks = tasks(list.optJSONArray("tasks")),
      )
    }
    return today to parsed
  }

  fun isDay(context: Context, widgetId: Int): Boolean =
    prefs(context).getBoolean(KEY_DAY + widgetId, false)

  fun setDay(context: Context, widgetId: Int) {
    prefs(context).edit().putBoolean(KEY_DAY + widgetId, true).apply()
  }

  fun forget(context: Context, widgetIds: IntArray) {
    val editor = prefs(context).edit()
    widgetIds.forEach { editor.remove(KEY_DAY + it) }
    editor.apply()
  }

  /** What a widget draws, or null before the core has published. */
  fun viewFor(context: Context, widgetId: Int): WidgetView? {
    val (day, lists) = data(context) ?: return null
    if (isDay(context, widgetId)) {
      val rows = ArrayList<WidgetRow>()
      var open = 0
      day.sections.forEach { (label, tasks) ->
        if (tasks.isEmpty()) return@forEach
        if (day.sections.size > 1) rows.add(WidgetRow.Header(label))
        tasks.forEach { rows.add(WidgetRow.Task(it)) }
        open += tasks.size
      }
      return WidgetView(context.getString(R.string.hw_today), open, rows)
    }
    return WidgetView(context.getString(R.string.hw_lists), null, lists.map { WidgetRow.ListCard(it) })
  }
}

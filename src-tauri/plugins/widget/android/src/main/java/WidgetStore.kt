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

/**
 * A row of a widget: a section plate, a category header or a task
 * (today); a list's head, its category headers and tasks, and its foot
 * (lists). `inCard` paints the row on the card's surface, `last` drops
 * the hairline under the card's last task.
 */
sealed class WidgetRow {
  data class Header(val label: String, val color: String?, val count: Int) : WidgetRow()
  data class Category(val label: String, val color: String?, val inCard: Boolean) : WidgetRow()
  data class Task(val task: WidgetTask, val chip: Boolean, val inCard: Boolean, val last: Boolean) : WidgetRow()
  data class ListHead(val list: WidgetList) : WidgetRow()
  data class ListFoot(val list: WidgetList) : WidgetRow()
}

/** What one widget draws: its name, open count (none on the lists widget) and rows. */
data class WidgetView(val name: String, val open: Int?, val rows: List<WidgetRow>)

/** One Day section: its plate's label and colour, its tasks. */
data class WidgetSection(val label: String, val color: String?, val tasks: List<WidgetTask>)

/** Today as the core published it: the Day screen's sections. */
data class WidgetDay(val date: String, val sections: List<WidgetSection>)

/** The app's chrome on this device, as the core resolved it (theme palette under colors.yml). */
data class WidgetTheme(
  val surface: Int,
  val surfaceAlt: Int,
  val content: Int,
  val contentMuted: Int,
  val accent: Int,
  val line: Int,
  val dowLabel: Int,
)

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

  /** The published data: the theme, the category-headers rule, the day and the lists. */
  data class Data(val theme: WidgetTheme, val categoryHeaders: Boolean, val day: WidgetDay, val lists: List<WidgetList>)

  fun data(context: Context): Data? {
    val file = dataFile(context)
    if (!file.exists()) return null
    return try {
      parse(file.readText())
    } catch (e: Exception) {
      null
    }
  }

  /** A string field, or null for a missing or JSON-null one (optString turns null into "null"). */
  private fun str(obj: JSONObject, key: String): String? =
    if (obj.isNull(key)) null else obj.optString(key, "").ifEmpty { null }

  private fun tasks(array: JSONArray?): List<WidgetTask> {
    val tasks = array ?: JSONArray()
    return (0 until tasks.length()).map { j ->
      val task = tasks.getJSONObject(j)
      WidgetTask(
        id = task.getLong("id"),
        title = task.getString("title"),
        category = str(task, "category"),
        categoryColor = str(task, "category_color"),
        dow = str(task, "dow"),
        priority = task.optBoolean("priority"),
        done = task.optBoolean("done"),
      )
    }
  }

  private fun parse(json: String): Data {
    val root = JSONObject(json)
    val theme = root.optJSONObject("theme") ?: JSONObject()
    val color = { key: String, fallback: Int -> str(theme, key)?.let { TaskWidgetProvider.parseColor(it, fallback) } ?: fallback }
    val dark = theme.optBoolean("dark", true)
    val contentMuted = color("content_muted", if (dark) 0xFFBFBFBF.toInt() else 0xFF606060.toInt())
    val dowOpacity = theme.optInt("dow_label_opacity", 100).coerceIn(0, 100)
    val parsedTheme = WidgetTheme(
      surface = color("surface", if (dark) 0xFF1E1E1E.toInt() else 0xFFFFFFFF.toInt()),
      surfaceAlt = color("surface_alt", if (dark) 0xFF252526.toInt() else 0xFFF3F3F3.toInt()),
      content = color("content", if (dark) 0xFFD4D4D4.toInt() else 0xFF333333.toInt()),
      contentMuted = contentMuted,
      accent = color("accent", if (dark) 0xFF55A5FF.toInt() else 0xFF005FB8.toInt()),
      line = color("line", if (dark) 0xFF3C3C3C.toInt() else 0xFFE0E0E0.toInt()),
      dowLabel = withAlpha(color("dow_label", contentMuted), dowOpacity * 255 / 100),
    )
    val day = root.optJSONObject("day")
    val sections = day?.optJSONArray("sections") ?: JSONArray()
    val today = WidgetDay(
      date = day?.optString("date", "") ?: "",
      sections = (0 until sections.length()).map { i ->
        val section = sections.getJSONObject(i)
        WidgetSection(
          label = section.optString("label", ""),
          color = str(section, "color"),
          tasks = tasks(section.optJSONArray("tasks")),
        )
      },
    )
    val lists = root.optJSONArray("lists") ?: JSONArray()
    val parsed = (0 until lists.length()).map { i ->
      val list = lists.getJSONObject(i)
      WidgetList(
        id = list.getLong("id"),
        name = list.getString("name"),
        color = str(list, "color"),
        group = str(list, "group"),
        tasks = tasks(list.optJSONArray("tasks")),
      )
    }
    return Data(parsedTheme, root.optBoolean("category_headers", true), today, parsed)
  }

  /** Before the core has published: the widget's own light/dark pair (values / values-night). */
  fun fallbackTheme(context: Context) = WidgetTheme(
    surface = context.getColor(R.color.hw_bg),
    surfaceAlt = context.getColor(R.color.hw_card),
    content = context.getColor(R.color.hw_text),
    contentMuted = context.getColor(R.color.hw_muted),
    accent = context.getColor(R.color.hw_accent),
    line = context.getColor(R.color.hw_line),
    dowLabel = context.getColor(R.color.hw_muted),
  )

  fun withAlpha(color: Int, alpha: Int): Int = (color and 0x00FFFFFF) or (alpha.coerceIn(0, 255) shl 24)

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

  /**
   * The rows of a block of tasks as the app's columns lay them out: the
   * block's category named once over its rows under `category_headers`,
   * else a chip on each row (`layout` in useColumnSections.ts).
   */
  private fun blockRows(tasks: List<WidgetTask>, headers: Boolean, inCard: Boolean): List<WidgetRow> {
    val rows = ArrayList<WidgetRow>()
    var block: String? = null
    tasks.forEachIndexed { i, task ->
      // a header where the label changes, on the first row included
      if (headers && task.category != null && (i == 0 || task.category != block)) {
        rows.add(WidgetRow.Category(task.category, task.categoryColor, inCard))
      }
      block = task.category
      rows.add(WidgetRow.Task(task, chip = !headers, inCard = inCard, last = i == tasks.size - 1))
    }
    return rows
  }

  /** What a widget draws, or null before the core has published. */
  fun viewFor(context: Context, widgetId: Int): WidgetView? {
    val data = data(context) ?: return null
    if (isDay(context, widgetId)) {
      val rows = ArrayList<WidgetRow>()
      var open = 0
      data.day.sections.forEach { section ->
        if (section.tasks.isEmpty()) return@forEach
        if (data.day.sections.size > 1) rows.add(WidgetRow.Header(section.label, section.color, section.tasks.size))
        rows.addAll(blockRows(section.tasks, data.categoryHeaders, inCard = false))
        open += section.tasks.size
      }
      return WidgetView(context.getString(R.string.hw_today), open, rows)
    }
    val rows = ArrayList<WidgetRow>()
    data.lists.forEach { list ->
      rows.add(WidgetRow.ListHead(list))
      rows.addAll(blockRows(list.tasks, data.categoryHeaders, inCard = true))
      rows.add(WidgetRow.ListFoot(list))
    }
    return WidgetView(context.getString(R.string.hw_lists), null, rows)
  }

  /** Before the core has published: the widget's own light/dark pair (values / values-night). */
  fun fallbackTheme(context: Context) = WidgetTheme(
    surface = context.getColor(R.color.hw_bg),
    surfaceAlt = context.getColor(R.color.hw_card),
    content = context.getColor(R.color.hw_text),
    contentMuted = context.getColor(R.color.hw_muted),
    accent = context.getColor(R.color.hw_accent),
    line = context.getColor(R.color.hw_line),
    dowLabel = context.getColor(R.color.hw_muted),
  )

  fun withAlpha(color: Int, alpha: Int): Int = (color and 0x00FFFFFF) or (alpha.coerceIn(0, 255) shl 24)

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
}

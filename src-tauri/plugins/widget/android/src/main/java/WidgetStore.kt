package com.hypomnema.widget

import android.content.Context
import android.content.SharedPreferences
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** One row the widget draws. */
data class WidgetTask(val id: Long, val title: String, val priority: Boolean, val done: Boolean)

/** A row of a widget: a section plate or a task. */
sealed class WidgetRow {
  data class Header(val label: String) : WidgetRow()
  data class Task(val task: WidgetTask) : WidgetRow()
}

/** What one widget draws: its name, tint and rows, pending taps applied. */
data class WidgetView(val name: String, val color: String?, val open: Int, val rows: List<WidgetRow>)

/** Today as the core published it: the Day screen's sections. */
data class WidgetDay(val date: String, val sections: List<Pair<String, List<WidgetTask>>>)

/** One list as the core published it. */
data class WidgetList(
  val id: Long,
  val name: String,
  val color: String?,
  val checklist: Boolean,
  val group: String?,
  val tasks: List<WidgetTask>,
) {
  val open get() = tasks.count { !it.done }
}

/**
 * The widget's files and preferences, shared by the provider, the row
 * factory, the configure screen and the plugin.
 *
 * The core publishes the data file after every export; a tap appends a
 * line to the queue file the core watches. Until the core has applied a
 * tap and published again, the tap is remembered here as pending, so the
 * row flips at once and stays flipped through a republish that predates
 * the drain.
 */
object WidgetStore {
  private const val PREFS = "hypomnema.widget"
  private const val KEY_QUEUE = "queue"
  private const val KEY_LIST = "list."
  private const val KEY_DAY = "day."
  private const val KEY_PENDING = "pending."

  const val EXTRA_LIST = "com.hypomnema.widget.LIST"
  const val EXTRA_DAY = "com.hypomnema.widget.DAY"
  const val EXTRA_ADD = "com.hypomnema.widget.ADD"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun dataFile(context: Context) = File(context.filesDir, "widget/data.json")

  /** Replaces the data file whole: a reader never sees a half-written one. */
  fun write(context: Context, json: String, queuePath: String) {
    val file = dataFile(context)
    file.parentFile?.mkdirs()
    val tmp = File(file.parentFile, ".data.json.tmp")
    tmp.writeText(json)
    if (!tmp.renameTo(file)) {
      file.writeText(json)
      tmp.delete()
    }
    prefs(context).edit().putString(KEY_QUEUE, queuePath).apply()
    reconcilePending(context, load(context))
  }

  fun load(context: Context): List<WidgetList> = data(context)?.second ?: emptyList()

  fun loadDay(context: Context): WidgetDay? = data(context)?.first

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
        checklist = list.optString("kind") == "checklist",
        group = list.optString("group", "").ifEmpty { null },
        tasks = tasks(list.optJSONArray("tasks")),
      )
    }
    return today to parsed
  }

  fun listIdFor(context: Context, widgetId: Int): Long =
    prefs(context).getLong(KEY_LIST + widgetId, -1L)

  fun setListFor(context: Context, widgetId: Int, listId: Long) {
    prefs(context).edit().putLong(KEY_LIST + widgetId, listId).apply()
  }

  fun isDay(context: Context, widgetId: Int): Boolean =
    prefs(context).getBoolean(KEY_DAY + widgetId, false)

  fun setDay(context: Context, widgetId: Int) {
    prefs(context).edit().putBoolean(KEY_DAY + widgetId, true).apply()
  }

  fun forget(context: Context, widgetIds: IntArray) {
    val editor = prefs(context).edit()
    widgetIds.forEach {
      editor.remove(KEY_LIST + it)
      editor.remove(KEY_DAY + it)
    }
    editor.apply()
  }

  private fun withPending(tasks: List<WidgetTask>, pending: Map<Long, String>): List<WidgetTask> =
    if (pending.isEmpty()) tasks
    else tasks.map { task ->
      when (pending[task.id]) {
        "done" -> task.copy(done = true)
        "todo" -> task.copy(done = false)
        else -> task
      }
    }

  /** What a widget draws, pending taps applied, or null when its source is gone. */
  fun viewFor(context: Context, widgetId: Int): WidgetView? {
    val pending = pending(context)
    if (isDay(context, widgetId)) {
      val day = loadDay(context) ?: return null
      val rows = ArrayList<WidgetRow>()
      var open = 0
      day.sections.forEach { (label, tasks) ->
        // a ticked task leaves the day, as a done todo leaves a list
        val shown = withPending(tasks, pending).filter { !it.done }
        if (shown.isEmpty()) return@forEach
        if (day.sections.size > 1) rows.add(WidgetRow.Header(label))
        shown.forEach { rows.add(WidgetRow.Task(it)) }
        open += shown.size
      }
      return WidgetView(context.getString(R.string.hw_today), null, open, rows)
    }
    val id = listIdFor(context, widgetId)
    val list = load(context).firstOrNull { it.id == id } ?: return null
    val tasks = withPending(list.tasks, pending)
    // a todo list sweeps a ticked task off the widget; a checklist keeps
    // it at the bottom, as the core publishes it
    val shown = if (list.checklist) tasks.sortedBy { it.done } else tasks.filter { !it.done }
    return WidgetView(list.name, list.color, shown.count { !it.done }, shown.map { WidgetRow.Task(it) })
  }

  /** Queues a tap for the core and remembers it until the core confirms. */
  fun queue(context: Context, taskId: Long, status: String) {
    val path = prefs(context).getString(KEY_QUEUE, null) ?: return
    try {
      val file = File(path)
      file.parentFile?.mkdirs()
      file.appendText("{\"task\":$taskId,\"status\":\"$status\"}\n")
      prefs(context).edit().putString(KEY_PENDING + taskId, status).apply()
    } catch (e: Exception) {
      // nowhere to queue to: the next tap tries again
    }
  }

  private fun pending(context: Context): Map<Long, String> =
    prefs(context).all.entries
      .filter { it.key.startsWith(KEY_PENDING) }
      .mapNotNull { entry ->
        val id = entry.key.removePrefix(KEY_PENDING).toLongOrNull() ?: return@mapNotNull null
        val status = entry.value as? String ?: return@mapNotNull null
        id to status
      }
      .toMap()

  /** Drops every pending tap the published data already reflects. */
  private fun reconcilePending(context: Context, lists: List<WidgetList>) {
    val pending = pending(context)
    if (pending.isEmpty()) return
    val byId = HashMap<Long, WidgetTask>()
    lists.forEach { list -> list.tasks.forEach { byId[it.id] = it } }
    val editor = prefs(context).edit()
    pending.forEach { (id, status) ->
      val task = byId[id]
      // gone from the data (swept, deleted) or already in the asked
      // state: the core has it
      if (task == null || task.done == (status == "done")) editor.remove(KEY_PENDING + id)
    }
    editor.apply()
  }
}

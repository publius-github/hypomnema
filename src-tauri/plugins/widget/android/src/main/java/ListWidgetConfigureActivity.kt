package com.hypomnema.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView

/**
 * The screen the launcher shows when the widget is placed (and on
 * "reconfigure"): pick the list it shows. The choices are the lists the
 * core last published; before the app has run once there are none, and
 * the screen says so instead of offering an empty picker.
 */
class ListWidgetConfigureActivity : Activity() {
  private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // cancelled until a list is picked: backing out leaves no widget
    setResult(RESULT_CANCELED)
    widgetId = intent?.extras?.getInt(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID,
    ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }
    setContentView(R.layout.hw_configure)

    val lists = WidgetStore.load(this)
    val picker = findViewById<ListView>(R.id.hw_lists)
    val empty = findViewById<TextView>(R.id.hw_configure_empty)
    val open = findViewById<TextView>(R.id.hw_open_app)
    if (lists.isEmpty()) {
      picker.visibility = View.GONE
      empty.visibility = View.VISIBLE
      open.visibility = View.VISIBLE
      open.setOnClickListener {
        packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
        finish()
      }
      return
    }
    picker.adapter = Adapter(lists)
    picker.setOnItemClickListener { _, _, position, _ -> choose(lists[position]) }
  }

  private fun choose(list: WidgetList) {
    WidgetStore.setListFor(this, widgetId, list.id)
    ListWidgetProvider.draw(this, AppWidgetManager.getInstance(this), widgetId)
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    finish()
  }

  private inner class Adapter(lists: List<WidgetList>) :
    ArrayAdapter<WidgetList>(this, R.layout.hw_configure_row, lists) {
    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
      val view = convertView
        ?: LayoutInflater.from(context).inflate(R.layout.hw_configure_row, parent, false)
      val list = getItem(position)!!
      val dot = view.findViewById<ImageView>(R.id.hw_row_dot)
      val color = try {
        if (list.color.isNullOrEmpty()) FALLBACK_COLOR else Color.parseColor(list.color)
      } catch (e: IllegalArgumentException) {
        FALLBACK_COLOR
      }
      dot.setColorFilter(color)
      view.findViewById<TextView>(R.id.hw_row_name).text =
        if (list.group != null) "${list.group} / ${list.name}" else list.name
      view.findViewById<TextView>(R.id.hw_row_count).text = list.open.toString()
      return view
    }
  }

  private companion object {
    const val FALLBACK_COLOR = 0xFF3B82F6.toInt()
  }
}

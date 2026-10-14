package com.hypomnema.googleauth

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

private const val CHANNEL = "sync"
private const val NOTIFICATION_ID = 1
const val ACTION_STOP = "com.hypomnema.googleauth.STOP_SYNC_KEEP_ALIVE"

/**
 * Holds the app in the foreground while a sync pass runs. The pass itself
 * is a Rust thread that knows nothing about Android; what stops it when
 * the user puts the app away is the system freezing a backgrounded
 * process. A foreground service (with its required notification) is the
 * sanctioned way to say "this work is still going on".
 *
 * Every start, the stop included, calls startForeground first: a service
 * started with startForegroundService must do that before it may go
 * away, and the start and the stop can arrive back to back for a pass
 * that had nothing to do.
 */
class SyncKeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    goForeground()
    if (intent?.action == ACTION_STOP) {
      stopSelf()
    }
    return START_NOT_STICKY
  }

  /** Android 15 caps dataSync services; a pass that long is better cut than the app killed. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  private fun goForeground() {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Sync", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("Syncing with Google Drive")
      .setProgress(0, 0, true)
      .setOngoing(true)
      .setSilent(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }
}

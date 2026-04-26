package expo.modules.loopnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Reschedules the UsageMonitorWorker after a device reboot.
 * WorkManager's PeriodicWorkRequest survives reboots on its own in API 23+,
 * but this receiver is a belt-and-suspenders fallback.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

    val prefs = context.getSharedPreferences("loop_shared", Context.MODE_PRIVATE)
    val wasMonitoring = prefs.getBoolean("native_monitoring_active", false)
    if (wasMonitoring) {
      UsageMonitorWorker.schedule(context, emptyMap())
    }
  }
}

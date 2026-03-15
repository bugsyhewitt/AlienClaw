package ai.alienclaw.app.node

import ai.alienclaw.app.protocol.AlienClawCalendarCommand
import ai.alienclaw.app.protocol.AlienClawCanvasA2UICommand
import ai.alienclaw.app.protocol.AlienClawCanvasCommand
import ai.alienclaw.app.protocol.AlienClawCameraCommand
import ai.alienclaw.app.protocol.AlienClawCapability
import ai.alienclaw.app.protocol.AlienClawContactsCommand
import ai.alienclaw.app.protocol.AlienClawDeviceCommand
import ai.alienclaw.app.protocol.AlienClawLocationCommand
import ai.alienclaw.app.protocol.AlienClawMotionCommand
import ai.alienclaw.app.protocol.AlienClawNotificationsCommand
import ai.alienclaw.app.protocol.AlienClawPhotosCommand
import ai.alienclaw.app.protocol.AlienClawScreenCommand
import ai.alienclaw.app.protocol.AlienClawSmsCommand
import ai.alienclaw.app.protocol.AlienClawSystemCommand

data class NodeRuntimeFlags(
  val cameraEnabled: Boolean,
  val locationEnabled: Boolean,
  val smsAvailable: Boolean,
  val voiceWakeEnabled: Boolean,
  val motionActivityAvailable: Boolean,
  val motionPedometerAvailable: Boolean,
  val debugBuild: Boolean,
)

enum class InvokeCommandAvailability {
  Always,
  CameraEnabled,
  LocationEnabled,
  SmsAvailable,
  MotionActivityAvailable,
  MotionPedometerAvailable,
  DebugBuild,
}

enum class NodeCapabilityAvailability {
  Always,
  CameraEnabled,
  LocationEnabled,
  SmsAvailable,
  VoiceWakeEnabled,
  MotionAvailable,
}

data class NodeCapabilitySpec(
  val name: String,
  val availability: NodeCapabilityAvailability = NodeCapabilityAvailability.Always,
)

data class InvokeCommandSpec(
  val name: String,
  val requiresForeground: Boolean = false,
  val availability: InvokeCommandAvailability = InvokeCommandAvailability.Always,
)

object InvokeCommandRegistry {
  val capabilityManifest: List<NodeCapabilitySpec> =
    listOf(
      NodeCapabilitySpec(name = AlienClawCapability.Canvas.rawValue),
      NodeCapabilitySpec(name = AlienClawCapability.Screen.rawValue),
      NodeCapabilitySpec(name = AlienClawCapability.Device.rawValue),
      NodeCapabilitySpec(name = AlienClawCapability.Notifications.rawValue),
      NodeCapabilitySpec(name = AlienClawCapability.System.rawValue),
      NodeCapabilitySpec(name = AlienClawCapability.AppUpdate.rawValue),
      NodeCapabilitySpec(
        name = AlienClawCapability.Camera.rawValue,
        availability = NodeCapabilityAvailability.CameraEnabled,
      ),
      NodeCapabilitySpec(
        name = AlienClawCapability.Sms.rawValue,
        availability = NodeCapabilityAvailability.SmsAvailable,
      ),
      NodeCapabilitySpec(
        name = AlienClawCapability.VoiceWake.rawValue,
        availability = NodeCapabilityAvailability.VoiceWakeEnabled,
      ),
      NodeCapabilitySpec(
        name = AlienClawCapability.Location.rawValue,
        availability = NodeCapabilityAvailability.LocationEnabled,
      ),
      NodeCapabilitySpec(name = AlienClawCapability.Photos.rawValue),
      NodeCapabilitySpec(name = AlienClawCapability.Contacts.rawValue),
      NodeCapabilitySpec(name = AlienClawCapability.Calendar.rawValue),
      NodeCapabilitySpec(
        name = AlienClawCapability.Motion.rawValue,
        availability = NodeCapabilityAvailability.MotionAvailable,
      ),
    )

  val all: List<InvokeCommandSpec> =
    listOf(
      InvokeCommandSpec(
        name = AlienClawCanvasCommand.Present.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawCanvasCommand.Hide.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawCanvasCommand.Navigate.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawCanvasCommand.Eval.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawCanvasCommand.Snapshot.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawCanvasA2UICommand.Push.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawCanvasA2UICommand.PushJSONL.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawCanvasA2UICommand.Reset.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawScreenCommand.Record.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienClawSystemCommand.Notify.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawCameraCommand.List.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = AlienClawCameraCommand.Snap.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = AlienClawCameraCommand.Clip.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = AlienClawLocationCommand.Get.rawValue,
        availability = InvokeCommandAvailability.LocationEnabled,
      ),
      InvokeCommandSpec(
        name = AlienClawDeviceCommand.Status.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawDeviceCommand.Info.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawDeviceCommand.Permissions.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawDeviceCommand.Health.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawNotificationsCommand.List.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawNotificationsCommand.Actions.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawPhotosCommand.Latest.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawContactsCommand.Search.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawContactsCommand.Add.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawCalendarCommand.Events.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawCalendarCommand.Add.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienClawMotionCommand.Activity.rawValue,
        availability = InvokeCommandAvailability.MotionActivityAvailable,
      ),
      InvokeCommandSpec(
        name = AlienClawMotionCommand.Pedometer.rawValue,
        availability = InvokeCommandAvailability.MotionPedometerAvailable,
      ),
      InvokeCommandSpec(
        name = AlienClawSmsCommand.Send.rawValue,
        availability = InvokeCommandAvailability.SmsAvailable,
      ),
      InvokeCommandSpec(
        name = "debug.logs",
        availability = InvokeCommandAvailability.DebugBuild,
      ),
      InvokeCommandSpec(
        name = "debug.ed25519",
        availability = InvokeCommandAvailability.DebugBuild,
      ),
      InvokeCommandSpec(name = "app.update"),
    )

  private val byNameInternal: Map<String, InvokeCommandSpec> = all.associateBy { it.name }

  fun find(command: String): InvokeCommandSpec? = byNameInternal[command]

  fun advertisedCapabilities(flags: NodeRuntimeFlags): List<String> {
    return capabilityManifest
      .filter { spec ->
        when (spec.availability) {
          NodeCapabilityAvailability.Always -> true
          NodeCapabilityAvailability.CameraEnabled -> flags.cameraEnabled
          NodeCapabilityAvailability.LocationEnabled -> flags.locationEnabled
          NodeCapabilityAvailability.SmsAvailable -> flags.smsAvailable
          NodeCapabilityAvailability.VoiceWakeEnabled -> flags.voiceWakeEnabled
          NodeCapabilityAvailability.MotionAvailable -> flags.motionActivityAvailable || flags.motionPedometerAvailable
        }
      }
      .map { it.name }
  }

  fun advertisedCommands(flags: NodeRuntimeFlags): List<String> {
    return all
      .filter { spec ->
        when (spec.availability) {
          InvokeCommandAvailability.Always -> true
          InvokeCommandAvailability.CameraEnabled -> flags.cameraEnabled
          InvokeCommandAvailability.LocationEnabled -> flags.locationEnabled
          InvokeCommandAvailability.SmsAvailable -> flags.smsAvailable
          InvokeCommandAvailability.MotionActivityAvailable -> flags.motionActivityAvailable
          InvokeCommandAvailability.MotionPedometerAvailable -> flags.motionPedometerAvailable
          InvokeCommandAvailability.DebugBuild -> flags.debugBuild
        }
      }
      .map { it.name }
  }
}

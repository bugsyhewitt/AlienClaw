package ai.alienclaw.app.node

import ai.alienclaw.app.protocol.AlienClawCalendarCommand
import ai.alienclaw.app.protocol.AlienClawCameraCommand
import ai.alienclaw.app.protocol.AlienClawCapability
import ai.alienclaw.app.protocol.AlienClawContactsCommand
import ai.alienclaw.app.protocol.AlienClawDeviceCommand
import ai.alienclaw.app.protocol.AlienClawLocationCommand
import ai.alienclaw.app.protocol.AlienClawMotionCommand
import ai.alienclaw.app.protocol.AlienClawNotificationsCommand
import ai.alienclaw.app.protocol.AlienClawPhotosCommand
import ai.alienclaw.app.protocol.AlienClawSmsCommand
import ai.alienclaw.app.protocol.AlienClawSystemCommand
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InvokeCommandRegistryTest {
  private val coreCapabilities =
    setOf(
      AlienClawCapability.Canvas.rawValue,
      AlienClawCapability.Screen.rawValue,
      AlienClawCapability.Device.rawValue,
      AlienClawCapability.Notifications.rawValue,
      AlienClawCapability.System.rawValue,
      AlienClawCapability.AppUpdate.rawValue,
      AlienClawCapability.Photos.rawValue,
      AlienClawCapability.Contacts.rawValue,
      AlienClawCapability.Calendar.rawValue,
    )

  private val optionalCapabilities =
    setOf(
      AlienClawCapability.Camera.rawValue,
      AlienClawCapability.Location.rawValue,
      AlienClawCapability.Sms.rawValue,
      AlienClawCapability.VoiceWake.rawValue,
      AlienClawCapability.Motion.rawValue,
    )

  private val coreCommands =
    setOf(
      AlienClawDeviceCommand.Status.rawValue,
      AlienClawDeviceCommand.Info.rawValue,
      AlienClawDeviceCommand.Permissions.rawValue,
      AlienClawDeviceCommand.Health.rawValue,
      AlienClawNotificationsCommand.List.rawValue,
      AlienClawNotificationsCommand.Actions.rawValue,
      AlienClawSystemCommand.Notify.rawValue,
      AlienClawPhotosCommand.Latest.rawValue,
      AlienClawContactsCommand.Search.rawValue,
      AlienClawContactsCommand.Add.rawValue,
      AlienClawCalendarCommand.Events.rawValue,
      AlienClawCalendarCommand.Add.rawValue,
      "app.update",
    )

  private val optionalCommands =
    setOf(
      AlienClawCameraCommand.Snap.rawValue,
      AlienClawCameraCommand.Clip.rawValue,
      AlienClawCameraCommand.List.rawValue,
      AlienClawLocationCommand.Get.rawValue,
      AlienClawMotionCommand.Activity.rawValue,
      AlienClawMotionCommand.Pedometer.rawValue,
      AlienClawSmsCommand.Send.rawValue,
    )

  private val debugCommands = setOf("debug.logs", "debug.ed25519")

  @Test
  fun advertisedCapabilities_respectsFeatureAvailability() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags())

    assertContainsAll(capabilities, coreCapabilities)
    assertMissingAll(capabilities, optionalCapabilities)
  }

  @Test
  fun advertisedCapabilities_includesFeatureCapabilitiesWhenEnabled() {
    val capabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(
          cameraEnabled = true,
          locationEnabled = true,
          smsAvailable = true,
          voiceWakeEnabled = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
        ),
      )

    assertContainsAll(capabilities, coreCapabilities + optionalCapabilities)
  }

  @Test
  fun advertisedCommands_respectsFeatureAvailability() {
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags())

    assertContainsAll(commands, coreCommands)
    assertMissingAll(commands, optionalCommands + debugCommands)
  }

  @Test
  fun advertisedCommands_includesFeatureCommandsWhenEnabled() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(
          cameraEnabled = true,
          locationEnabled = true,
          smsAvailable = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
          debugBuild = true,
        ),
      )

    assertContainsAll(commands, coreCommands + optionalCommands + debugCommands)
  }

  @Test
  fun advertisedCommands_onlyIncludesSupportedMotionCommands() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        NodeRuntimeFlags(
          cameraEnabled = false,
          locationEnabled = false,
          smsAvailable = false,
          voiceWakeEnabled = false,
          motionActivityAvailable = true,
          motionPedometerAvailable = false,
          debugBuild = false,
        ),
      )

    assertTrue(commands.contains(AlienClawMotionCommand.Activity.rawValue))
    assertFalse(commands.contains(AlienClawMotionCommand.Pedometer.rawValue))
  }

  private fun defaultFlags(
    cameraEnabled: Boolean = false,
    locationEnabled: Boolean = false,
    smsAvailable: Boolean = false,
    voiceWakeEnabled: Boolean = false,
    motionActivityAvailable: Boolean = false,
    motionPedometerAvailable: Boolean = false,
    debugBuild: Boolean = false,
  ): NodeRuntimeFlags =
    NodeRuntimeFlags(
      cameraEnabled = cameraEnabled,
      locationEnabled = locationEnabled,
      smsAvailable = smsAvailable,
      voiceWakeEnabled = voiceWakeEnabled,
      motionActivityAvailable = motionActivityAvailable,
      motionPedometerAvailable = motionPedometerAvailable,
      debugBuild = debugBuild,
    )

  private fun assertContainsAll(actual: List<String>, expected: Set<String>) {
    expected.forEach { value -> assertTrue(actual.contains(value)) }
  }

  private fun assertMissingAll(actual: List<String>, forbidden: Set<String>) {
    forbidden.forEach { value -> assertFalse(actual.contains(value)) }
  }
}

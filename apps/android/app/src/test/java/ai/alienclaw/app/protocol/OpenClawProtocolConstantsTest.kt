package ai.alienclaw.app.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class AlienClawProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", AlienClawCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", AlienClawCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", AlienClawCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", AlienClawCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", AlienClawCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", AlienClawCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", AlienClawCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", AlienClawCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", AlienClawCapability.Canvas.rawValue)
    assertEquals("camera", AlienClawCapability.Camera.rawValue)
    assertEquals("screen", AlienClawCapability.Screen.rawValue)
    assertEquals("voiceWake", AlienClawCapability.VoiceWake.rawValue)
    assertEquals("location", AlienClawCapability.Location.rawValue)
    assertEquals("sms", AlienClawCapability.Sms.rawValue)
    assertEquals("device", AlienClawCapability.Device.rawValue)
    assertEquals("notifications", AlienClawCapability.Notifications.rawValue)
    assertEquals("system", AlienClawCapability.System.rawValue)
    assertEquals("appUpdate", AlienClawCapability.AppUpdate.rawValue)
    assertEquals("photos", AlienClawCapability.Photos.rawValue)
    assertEquals("contacts", AlienClawCapability.Contacts.rawValue)
    assertEquals("calendar", AlienClawCapability.Calendar.rawValue)
    assertEquals("motion", AlienClawCapability.Motion.rawValue)
  }

  @Test
  fun cameraCommandsUseStableStrings() {
    assertEquals("camera.list", AlienClawCameraCommand.List.rawValue)
    assertEquals("camera.snap", AlienClawCameraCommand.Snap.rawValue)
    assertEquals("camera.clip", AlienClawCameraCommand.Clip.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", AlienClawScreenCommand.Record.rawValue)
  }

  @Test
  fun notificationsCommandsUseStableStrings() {
    assertEquals("notifications.list", AlienClawNotificationsCommand.List.rawValue)
    assertEquals("notifications.actions", AlienClawNotificationsCommand.Actions.rawValue)
  }

  @Test
  fun deviceCommandsUseStableStrings() {
    assertEquals("device.status", AlienClawDeviceCommand.Status.rawValue)
    assertEquals("device.info", AlienClawDeviceCommand.Info.rawValue)
    assertEquals("device.permissions", AlienClawDeviceCommand.Permissions.rawValue)
    assertEquals("device.health", AlienClawDeviceCommand.Health.rawValue)
  }

  @Test
  fun systemCommandsUseStableStrings() {
    assertEquals("system.notify", AlienClawSystemCommand.Notify.rawValue)
  }

  @Test
  fun photosCommandsUseStableStrings() {
    assertEquals("photos.latest", AlienClawPhotosCommand.Latest.rawValue)
  }

  @Test
  fun contactsCommandsUseStableStrings() {
    assertEquals("contacts.search", AlienClawContactsCommand.Search.rawValue)
    assertEquals("contacts.add", AlienClawContactsCommand.Add.rawValue)
  }

  @Test
  fun calendarCommandsUseStableStrings() {
    assertEquals("calendar.events", AlienClawCalendarCommand.Events.rawValue)
    assertEquals("calendar.add", AlienClawCalendarCommand.Add.rawValue)
  }

  @Test
  fun motionCommandsUseStableStrings() {
    assertEquals("motion.activity", AlienClawMotionCommand.Activity.rawValue)
    assertEquals("motion.pedometer", AlienClawMotionCommand.Pedometer.rawValue)
  }
}

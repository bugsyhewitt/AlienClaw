import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-alienclaw writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.alienclaw.mac"
let gatewayLaunchdLabel = "ai.alienclaw.gateway"
let onboardingVersionKey = "alienclaw.onboardingVersion"
let onboardingSeenKey = "alienclaw.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "alienclaw.pauseEnabled"
let iconAnimationsEnabledKey = "alienclaw.iconAnimationsEnabled"
let swabbleEnabledKey = "alienclaw.swabbleEnabled"
let swabbleTriggersKey = "alienclaw.swabbleTriggers"
let voiceWakeTriggerChimeKey = "alienclaw.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "alienclaw.voiceWakeSendChime"
let showDockIconKey = "alienclaw.showDockIcon"
let defaultVoiceWakeTriggers = ["alienclaw"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "alienclaw.voiceWakeMicID"
let voiceWakeMicNameKey = "alienclaw.voiceWakeMicName"
let voiceWakeLocaleKey = "alienclaw.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "alienclaw.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "alienclaw.voicePushToTalkEnabled"
let talkEnabledKey = "alienclaw.talkEnabled"
let iconOverrideKey = "alienclaw.iconOverride"
let connectionModeKey = "alienclaw.connectionMode"
let remoteTargetKey = "alienclaw.remoteTarget"
let remoteIdentityKey = "alienclaw.remoteIdentity"
let remoteProjectRootKey = "alienclaw.remoteProjectRoot"
let remoteCliPathKey = "alienclaw.remoteCliPath"
let canvasEnabledKey = "alienclaw.canvasEnabled"
let cameraEnabledKey = "alienclaw.cameraEnabled"
let systemRunPolicyKey = "alienclaw.systemRunPolicy"
let systemRunAllowlistKey = "alienclaw.systemRunAllowlist"
let systemRunEnabledKey = "alienclaw.systemRunEnabled"
let locationModeKey = "alienclaw.locationMode"
let locationPreciseKey = "alienclaw.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "alienclaw.peekabooBridgeEnabled"
let deepLinkKeyKey = "alienclaw.deepLinkKey"
let modelCatalogPathKey = "alienclaw.modelCatalogPath"
let modelCatalogReloadKey = "alienclaw.modelCatalogReload"
let cliInstallPromptedVersionKey = "alienclaw.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "alienclaw.heartbeatsEnabled"
let debugPaneEnabledKey = "alienclaw.debugPaneEnabled"
let debugFileLogEnabledKey = "alienclaw.debug.fileLogEnabled"
let appLogLevelKey = "alienclaw.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26

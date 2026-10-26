# API d'extensions exposées par Electron

Mesure faite par `npm run phase0:probe` : Electron 45.0.0 (Chromium 156.0.8078.48), 2026-10-25T17:04:38.864Z.

Une extension MV3 de test déclare toutes les permissions connues ; son service worker liste les espaces de noms `chrome.*` et appelle une fonction représentative de chacun.

**Utilisables (18)** : `action`, `alarms`, `declarativeNetRequest`, `dns`, `extension`, `i18n`, `idle`, `offscreen`, `permissions`, `power`, `printerProvider`, `proxy`, `runtime`, `scripting`, `storage`, `system`, `tabs`, `webRequest`

**Absents (31)** : `bookmarks`, `browsingData`, `commands`, `contentSettings`, `contextMenus`, `cookies`, `debugger`, `declarativeContent`, `desktopCapture`, `downloads`, `fontSettings`, `gcm`, `history`, `identity`, `management`, `notifications`, `omnibox`, `pageCapture`, `privacy`, `readingList`, `search`, `sessions`, `sidePanel`, `tabCapture`, `tabGroups`, `topSites`, `tts`, `ttsEngine`, `userScripts`, `webNavigation`, `windows`

**Non mesurables depuis un service worker** : `devtools`

## Détail des appels

| Fonction | Résultat |
| --- | --- |
| `chrome.runtime.getPlatformInfo` | ok |
| `chrome.runtime.getManifest` | ok |
| `chrome.runtime.connectNative` | exists |
| `chrome.runtime.sendNativeMessage` | error: Access to the native messaging host was disabled by the system administrator. |
| `chrome.runtime.getContexts` | ok |
| `chrome.storage.local.get` | ok |
| `chrome.storage.sync.get` | error: "sync" is not available in this instance of Chrome |
| `chrome.storage.session.get` | ok |
| `chrome.tabs.query` | ok |
| `chrome.tabs.get` | exists |
| `chrome.tabs.sendMessage` | exists |
| `chrome.tabs.captureVisibleTab` | missing (undefined) |
| `chrome.windows.getAll` | missing (undefined) |
| `chrome.windows.getCurrent` | missing (undefined) |
| `chrome.cookies.getAll` | missing (undefined) |
| `chrome.cookies.getAllCookieStores` | missing (undefined) |
| `chrome.alarms.getAll` | ok |
| `chrome.scripting.getRegisteredContentScripts` | ok |
| `chrome.scripting.executeScript` | exists |
| `chrome.action.getBadgeText` | ok |
| `chrome.contextMenus.removeAll` | missing (undefined) |
| `chrome.declarativeNetRequest.getDynamicRules` | ok |
| `chrome.declarativeNetRequest.updateDynamicRules` | ok |
| `chrome.downloads.search` | missing (undefined) |
| `chrome.history.search` | missing (undefined) |
| `chrome.bookmarks.getTree` | missing (undefined) |
| `chrome.sessions.getRecentlyClosed` | missing (undefined) |
| `chrome.topSites.get` | missing (undefined) |
| `chrome.management.getAll` | missing (undefined) |
| `chrome.notifications.getAll` | missing (undefined) |
| `chrome.permissions.getAll` | ok |
| `chrome.commands.getAll` | missing (undefined) |
| `chrome.idle.queryState` | ok |
| `chrome.i18n.getUILanguage` | ok |
| `chrome.sidePanel.getOptions` | missing (undefined) |
| `chrome.tabGroups.query` | missing (undefined) |
| `chrome.webNavigation.getAllFrames` | missing (undefined) |
| `chrome.identity.getRedirectURL` | missing (undefined) |
| `chrome.identity.launchWebAuthFlow` | missing (undefined) |
| `chrome.identity.getAuthToken` | missing (undefined) |
| `chrome.tabCapture.getCapturedTabs` | missing (undefined) |
| `chrome.desktopCapture.chooseDesktopMedia` | missing (undefined) |
| `chrome.proxy.settings.get` | error: Access to extension API denied. |
| `chrome.privacy.services.autofillAddressEnabled.get` | missing (undefined) |
| `chrome.browsingData.settings` | missing (undefined) |
| `chrome.system.memory.getInfo` | ok |
| `chrome.system.cpu.getInfo` | ok |
| `chrome.search.query` | missing (undefined) |
| `chrome.readingList.query` | missing (undefined) |
| `chrome.offscreen.createDocument` | exists |
| `chrome.declarativeContent.onPageChanged.addRules` | missing (undefined) |
| `chrome.webRequest.onBeforeRequest.addListener` | exists |
| `chrome.webRequest.onBeforeSendHeaders.addListener` | exists |
| `chrome.tts.getVoices` | missing (undefined) |
| `chrome.power.requestKeepAwake` | exists |
| `chrome.dns.resolve` | exists |
| `chrome.debugger.getTargets` | missing (undefined) |
| `chrome.gcm.register` | missing (undefined) |
| `chrome.fontSettings.getFontList` | missing (undefined) |
| `chrome.pageCapture.saveAsMHTML` | missing (undefined) |
| `chrome.contentSettings.cookies.get` | missing (undefined) |
| `chrome.omnibox.setDefaultSuggestion` | missing (undefined) |
| `chrome.userScripts.getScripts` | missing (undefined) |
| `chrome.userScripts.register` | missing (undefined) |

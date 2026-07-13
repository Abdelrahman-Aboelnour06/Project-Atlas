// background.js
// Owns: toolbar icon click -> tells the active tab's content script to
// toggle Atlas on/off. No DOM access here (service workers can't touch it).
// Also relays the "open options page" request from content.js, since only
// the extension's own privileged contexts (background/options) can call
// chrome.runtime.openOptionsPage().

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'ATLAS_TOGGLE' })
})

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ATLAS_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage()
  }
})

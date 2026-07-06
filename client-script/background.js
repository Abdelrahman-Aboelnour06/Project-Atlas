// background.js
// Owns: toolbar icon click -> tells the active tab's content script to
// toggle Atlas on/off. No DOM access here (service workers can't touch it).

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'ATLAS_TOGGLE' })
})

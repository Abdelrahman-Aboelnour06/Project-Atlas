

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "dom-serializer.js",
        "websocket-client.js",
        "executor.js",
        "speech.js",
        "sidebar.js",
        "content.js",
      ]
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["sidebar.css"]
    });
  } catch (err) {
    // If injection fails (e.g., chrome:// pages), do nothing
    console.error("Atlas: injection failed", err);
    return;
  }

  // Now the content script is loaded; send the toggle command
  chrome.tabs.sendMessage(tab.id, { type: 'ATLAS_TOGGLE' });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ATLAS_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
  }
});
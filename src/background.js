// background.js - Student-friendly version (no API key needed!)

console.log("🚀 FactGuard background service worker started");

// Your Cloudflare Worker URL
const BACKEND_URL = 'https://factguard-api.jacobcrainic2008.workers.dev';

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "analyzeText") {
    (async () => {
      try {
        const result = await analyzeText(req.text);
        sendResponse({ success: true, result });
      } catch (err) {
        console.error("❌ Error:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  return false;
});

async function analyzeText(text) {
  if (!text || text.trim().length < 10) {
    return {
      hasMisinformation: false,
      hasHateSpeech: false,
      confidenceScore: 0,
      reasoning: "Text too short to analyze",
      flaggedContent: [],
      category: "skipped",
      status: "skipped"
    };
  }

  console.log("🔍 Analyzing via backend...");

  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: text.slice(0, 1000)
      })
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Analysis complete:", result);
    
    result.status = "success";
    return result;

  } catch (error) {
    console.error("❌ Error:", error);
    return {
      hasMisinformation: false,
      hasHateSpeech: false,
      confidenceScore: 0,
      reasoning: `Error: ${error.message}`,
      flaggedContent: [],
      category: "error",
      status: "error"
    };
  }
}

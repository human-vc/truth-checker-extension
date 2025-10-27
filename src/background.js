// background.js – SECURE VERSION - API key stored in Chrome storage

console.log("🚀 FactGuard background service worker started");

let CONFIG = {
  MODEL: 'gpt-4o-mini',
  TEMPERATURE: 0.2,
  MAX_TOKENS: 500,
  DEBUG: true,
  OPENAI_API_KEY: null
};

let configLoaded = false;

// ---------------------------
// Load API key from Chrome storage on startup
// ---------------------------
(async function loadConfig() {
  try {
    // Try to get API key from Chrome storage
    const result = await chrome.storage.local.get(['openai_api_key']);
    
    if (result.openai_api_key) {
      CONFIG.OPENAI_API_KEY = result.openai_api_key;
      configLoaded = true;
      console.log("✅ API key loaded from secure storage");
    } else {
      console.warn("⚠️ No API key found. Please set it using the extension popup.");
      configLoaded = true; // Mark as loaded even without key so we can show error
    }
  } catch (err) {
    console.error("❌ Failed to load config:", err);
    configLoaded = true;
  }
})();

// ---------------------------
// Wait for config readiness with better error handling
// ---------------------------
async function waitForConfig(timeout = 10000) {
  const start = Date.now();
  while (!configLoaded) {
    if (Date.now() - start > timeout) {
      console.error("❌ Config load timeout after", timeout, "ms");
      throw new Error("Config load timeout");
    }
    await new Promise(r => setTimeout(r, 100));
  }
  
  if (!CONFIG.OPENAI_API_KEY) {
    throw new Error("API key not configured. Please set it in the extension settings.");
  }
  
  console.log("✅ Config ready, API key present");
}

// ---------------------------
// Debug helper
// ---------------------------
function debug(...args) {
  if (CONFIG?.DEBUG) console.log("[FactGuard]", ...args);
}

// ---------------------------
// Message listener - FIXED for service worker lifecycle
// ---------------------------
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "analyzeText") {
    // Immediately start the async work and keep the port open
    (async () => {
      try {
        const result = await analyzeText(req.text);
        sendResponse({ success: true, result });
      } catch (err) {
        console.error("❌ Error in message handler:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    
    return true; // CRITICAL: Keep message channel open for async response
  }
  
  if (req.action === "setApiKey") {
    // Save API key to secure storage
    (async () => {
      try {
        await chrome.storage.local.set({ openai_api_key: req.apiKey });
        CONFIG.OPENAI_API_KEY = req.apiKey;
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  
  if (req.action === "getApiKeyStatus") {
    sendResponse({ hasKey: !!CONFIG.OPENAI_API_KEY });
    return false;
  }
  
  return false; // Close channel for other message types
});

// ---------------------------
// Core: analyzeText
// ---------------------------
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

  await waitForConfig();
  debug("🛰️ Analyzing text:", text.slice(0, 80) + "...");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: CONFIG.MODEL,
        temperature: CONFIG.TEMPERATURE,
        max_tokens: CONFIG.MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `You are a content analyzer that detects misinformation and hate speech.
Return ONLY valid JSON (no markdown, no explanations):

{
  "hasMisinformation": boolean,
  "hasHateSpeech": boolean,
  "confidenceScore": number,
  "reasoning": "short explanation",
  "flaggedContent": ["phrases"],
  "category": "type of issue"
}

Flag hate speech for:
- Slurs or dehumanizing language toward protected groups
- Calls for violence or harm
- Bigotry or explicit hate

Flag misinformation for:
- False factual claims
- Misrepresented data
- Debunked conspiracy theories

Do NOT flag political opinions, satire, or jokes.`
          },
          {
            role: "user",
            content: text.slice(0, 1000)
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`API error ${response.status}: ${err.error?.message || "Unknown"}`);
    }

    const data = await response.json();
    console.log("✅ GPT-4o-mini response received:", data);

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty API response");

    const clean = content.replace(/```json\n?|```/g, "");
    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      console.warn("⚠️ Could not parse JSON:", clean);
      result = {
        hasMisinformation: false,
        hasHateSpeech: false,
        confidenceScore: 0,
        reasoning: "Failed to parse JSON output",
        flaggedContent: [],
        category: "parse_error"
      };
    }

    result.status = "success";
    debug("✅ Final analysis result:", result);
    return result;

  } catch (error) {
    console.error("❌ Analysis error:", error);
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

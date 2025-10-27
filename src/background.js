// background.js — FINAL GPT-5-nano compatible build for FactGuard

console.log("🚀 FactGuard background service worker started");

let CONFIG = null;
let configLoaded = false;

// ---------------------------
// Load config.js on startup
// ---------------------------
(async function loadConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL("src/config.js"));
    const text = await res.text();
    const match = text.match(/const CONFIG\s*=\s*({[\s\S]*?});/);

    if (!match) throw new Error("Could not parse config.js");
    CONFIG = eval("(" + match[1] + ")");
    configLoaded = true;
    console.log("✅ FactGuard config loaded successfully");
  } catch (err) {
    console.error("❌ Failed to load config:", err);
  }
})();

// ---------------------------
// Wait for config readiness
// ---------------------------
async function waitForConfig(timeout = 7000) {
  const start = Date.now();
  while (!configLoaded || !CONFIG?.OPENAI_API_KEY) {
    if (Date.now() - start > timeout) throw new Error("Config load timeout");
    await new Promise(r => setTimeout(r, 100));
  }
}

// ---------------------------
// Debug helper
// ---------------------------
function debug(...args) {
  if (CONFIG?.DEBUG) console.log("[FactGuard]", ...args);
}

// ---------------------------
// Message listener
// ---------------------------
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "analyzeText") {
    analyzeText(req.text)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open
  }
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
        model: CONFIG.MODEL || "gpt-5-nano",
        temperature: CONFIG.TEMPERATURE ?? 0.2,
        max_tokens: CONFIG.MAX_TOKENS ?? 500,
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
    console.log("✅ GPT-5-nano response received:", data);

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
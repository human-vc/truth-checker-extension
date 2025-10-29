

console.log('FactGuard Google Docs Check');


const RATE_LIMIT = {
  maxRequestsPerMinute: 3,
  requestTimestamps: [],
  minDelayBetweenRequests: 20000, 
  isProcessing: false
};

const analyzedParagraphs = new WeakSet();

// Start scanning after page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('GDocs DOMContentLoaded, starting scan in 3s...');
    setTimeout(startScanning, 3000);
  });
} else {
  console.log('GDocs DOM already loaded, starting scan in 3s...');
  setTimeout(startScanning, 3000);
}

function startScanning() {
  console.log('GDocs startScanning() called.');
  
  scanDocument();
  
  let scanTimeout;
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      if (!RATE_LIMIT.isProcessing) {
        console.log('MutationObserver fired, calling scanDocument()');
        scanDocument();
      }
    }, 5000); 
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true 
  });
  
  console.log('GDocs observer started.');
}

// Check if we can make a request based on time
function canMakeRequest() {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  RATE_LIMIT.requestTimestamps = RATE_LIMIT.requestTimestamps.filter(
    timestamp => timestamp > oneMinuteAgo
  );
  if (RATE_LIMIT.requestTimestamps.length >= RATE_LIMIT.maxRequestsPerMinute) {
    const oldestTimestamp = Math.min(...RATE_LIMIT.requestTimestamps);
    const timeUntilNextRequest = 60000 - (now - oldestTimestamp);
    console.log(`⏳ Rate limit reached. Next request in ${Math.ceil(timeUntilNextRequest / 1000)}s`);
    return false;
  }
  return true;
}

// Record that we made a request
function recordRequest() {
  RATE_LIMIT.requestTimestamps.push(Date.now());
}

// Get time until next request is allowed
function getTimeUntilNextRequest() {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  RATE_LIMIT.requestTimestamps = RATE_LIMIT.requestTimestamps.filter(
    timestamp => timestamp > oneMinuteAgo
  );
  if (RATE_LIMIT.requestTimestamps.length < RATE_LIMIT.maxRequestsPerMinute) {
    return 0;
  }
  const oldestTimestamp = Math.min(...RATE_LIMIT.requestTimestamps);
  return Math.max(0, 60000 - (now - oldestTimestamp));
}

async function scanDocument() {
  console.log('scanDocument() called.');
  if (RATE_LIMIT.isProcessing) {
    console.log('⏭️ Scan already in progress, skipping...');
    return;
  }
  
  try {
    RATE_LIMIT.isProcessing = true;
    
    
    const selector = 'div.kix-paragraphrenderer';
    const allParagraphs = Array.from(document.querySelectorAll(selector));
    
    if (allParagraphs.length === 0) {
      console.log('⚠️ No paragraphs found. ');
      return;
    }

    const unanalyzedParagraphs = allParagraphs.filter(p => !analyzedParagraphs.has(p));

    if (unanalyzedParagraphs.length === 0) {
      console.log('✅ All visible paragraphs have been analyzed.');
      return;
    }
    
    console.log(`Found ${allParagraphs.length} total paragraphs, ${unanalyzedParagraphs.length} are new.`);

    // Process only ONE unanalyzed paragraph per scan
    const paragraphToAnalyze = unanalyzedParagraphs[0];

    try {
      const text = paragraphToAnalyze.textContent;
      
      if (!text || text.trim().length < 20) {
        console.log('⏭️ Skipping short paragraph');
        analyzedParagraphs.add(paragraphToAnalyze);
        return;
      }
      
      if (!canMakeRequest()) {
        const waitTime = getTimeUntilNextRequest();
        console.log(`⏳ Rate limit active. Next analysis in ${Math.ceil(waitTime / 1000)}s`);
        return; // Stop scanning if rate limited
      }
      
      console.log(`🔍 Analyzing GDocs paragraph:`, text.substring(0, 50) + '...');
      recordRequest();
      
      // Mark as analyzed
      analyzedParagraphs.add(paragraphToAnalyze);
      
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Request timeout')), 30000);
        chrome.runtime.sendMessage(
          { action: 'analyzeText', text: text },
          (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              console.error('❌ chrome.runtime.lastError:', chrome.runtime.lastError.message);
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          }
        );
      });
      
      if (response && response.success) {
        const result = response.result;
        console.log('✅ GDocs Analysis complete:', result);
        
        if (result.hasMisinformation || result.hasHateSpeech) {
          // Send a message to the background to show the UI
          chrome.runtime.sendMessage({
            action: "showFactGuardResult",
            result: result
          });
          
          // Add a simple visual marker
          addWarningIndicator(paragraphToAnalyze, result);
        }
      } else {
        console.error('❌ GDocs Analysis failed:', response?.error);
      }
      
    } catch (error) {
      console.error('❌ Error analyzing doc paragraph:', error);
    }
    
  } catch (error) {
    console.error('❌ Error in scanDocument:', error);
  } finally {
    RATE_LIMIT.isProcessing = false;
  }
}
function addWarningIndicator(paragraphElement, result) {
  try {
    // Don't add duplicate warnings mainly because of the iframe issue I was having earlier 
    if (paragraphElement.querySelector('.factguard-marker')) {
      return;
    }
    
    const marker = document.createElement('div');
    marker.className = 'factguard-marker';
    
    const bgColor = result.hasHateSpeech ? '#dc2626' : '#f59e0b';
    const issueType = result.hasHateSpeech ? '⚠️ Hate Speech' : '⚠️ Misinformation';
    
    marker.style.cssText = `
      background: ${bgColor};
      color: white;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      margin-top: 4px;
      display: inline-block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    
    marker.textContent = `${issueType} Detected (FactGuard)`;
    
    // Insert marker
    paragraphElement.appendChild(marker);
    
  } catch (error) {
    console.error('❌ Error adding warning marker:', error);
  }
}


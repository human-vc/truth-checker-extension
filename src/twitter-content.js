// twitter-content.js - Scans Twitter posts and sends to background for analysis
// IMPROVED VERSION - Better rate limiting and scanning logic

console.log('FactGuard is running on Twitter!');
console.log('Current URL:', window.location.href);

// Global state management
const RATE_LIMIT = {
  maxRequestsPerMinute: 3,
  requestTimestamps: [],
  minDelayBetweenRequests: 20000, // 20 seconds between requests (3 per minute)
  isProcessing: false // Flag to prevent concurrent scans
};

// Keep track of ALL analyzed tweets globally
const analyzedTweets = new WeakSet();

// Start scanning after page loads
console.log('Setting up scan timeout...');
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      console.log('Page loaded - starting scanner');
      startScanning();
    }, 3000);
  });
} else {
  setTimeout(() => {
    console.log('Timeout triggered - starting scanner');
    startScanning();
  }, 3000);
}

function startScanning() {
  // Initial scan
  scanTweets();
  
  // Watch for new tweets with HEAVY debouncing (only scan every 5 seconds at most)
  let scanTimeout;
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      // Only scan if not currently processing
      if (!RATE_LIMIT.isProcessing) {
        scanTweets();
      }
    }, 5000); // Wait 5 seconds after DOM stops changing
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log('Tweet observer started with heavy debouncing (5s)');
}

// Check if we can make a request based on time
function canMakeRequest() {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  
  // Remove timestamps older than 1 minute
  RATE_LIMIT.requestTimestamps = RATE_LIMIT.requestTimestamps.filter(
    timestamp => timestamp > oneMinuteAgo
  );
  
  // Check if we're under the limit
  if (RATE_LIMIT.requestTimestamps.length >= RATE_LIMIT.maxRequestsPerMinute) {
    const oldestTimestamp = Math.min(...RATE_LIMIT.requestTimestamps);
    const timeUntilNextRequest = 60000 - (now - oldestTimestamp);
    console.log(`⏳ Rate limit reached. Next request available in ${Math.ceil(timeUntilNextRequest / 1000)}s`);
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
  
  // Clean old timestamps
  RATE_LIMIT.requestTimestamps = RATE_LIMIT.requestTimestamps.filter(
    timestamp => timestamp > oneMinuteAgo
  );
  
  if (RATE_LIMIT.requestTimestamps.length < RATE_LIMIT.maxRequestsPerMinute) {
    return 0; // Can make request now
  }
  
  // Calculate when the oldest request will expire
  const oldestTimestamp = Math.min(...RATE_LIMIT.requestTimestamps);
  return Math.max(0, 60000 - (now - oldestTimestamp));
}

// Helper: compute a unique hash for a tweet based on data-testid and textContent
function computeTweetHash(tweetElement) {
  // Prefer data-testid and textContent
  const dataTestId = tweetElement.getAttribute('data-testid') || '';
  const text = tweetElement.textContent || '';
  // Simple hash function (djb2)
  let hash = 5381;
  let str = dataTestId + '|' + text;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0xffffffff; // 32 bit
  }
  return hash.toString();
}

// Helper: reapply stored warnings from sessionStorage to matching tweets in DOM
function reapplyStoredWarnings() {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("factguard_")) {
        try {
          const stored = JSON.parse(sessionStorage.getItem(key));
          if (!stored) continue;
          // Find tweet in DOM matching this hash
          // Try all selectors
          const selectors = [
            '[data-testid="tweetText"]',
            'article [lang]',
            '[data-testid="tweet"]',
            'article div[lang][dir="auto"]'
          ];
          let foundTweet = null;
          for (const selector of selectors) {
            const candidates = document.querySelectorAll(selector);
            for (const el of candidates) {
              if (computeTweetHash(el) === key.replace("factguard_", "")) {
                foundTweet = el;
                break;
              }
            }
            if (foundTweet) break;
          }
          if (foundTweet) {
            // Only add if not present
            if (!foundTweet.parentElement.querySelector('.factguard-warning')) {
              addWarningIndicator(foundTweet, stored.result);
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      }
    }
  } catch (err) {
    // Defensive: ignore all errors
  }
}

// Main scanning function - now processes ONE tweet at a time
async function scanTweets() {
  // Reapply previous warnings before scanning
  reapplyStoredWarnings();

  // Prevent concurrent scans
  if (RATE_LIMIT.isProcessing) {
    console.log('⏭️ Scan already in progress, skipping...');
    return;
  }
  
  RATE_LIMIT.isProcessing = true;
  
  try {
    // Try multiple selectors for better compatibility
    const selectors = [
      '[data-testid="tweetText"]',
      'article [lang]',
      '[data-testid="tweet"]',
      'article div[lang][dir="auto"]'
    ];
    
    let allTweets = new Set();
    
    // Collect tweets from all selectors
    selectors.forEach(selector => {
      const found = document.querySelectorAll(selector);
      found.forEach(el => allTweets.add(el));
    });
    
    // Filter out already analyzed tweets
    const unanalyzedTweets = Array.from(allTweets).filter(tweet => !analyzedTweets.has(tweet));
    
    console.log(`📊 Found ${allTweets.size} tweets total, ${unanalyzedTweets.length} unanalyzed`);
    
    // Debug info if no tweets found
    if (allTweets.size === 0) {
      console.log('⚠️ No tweets found. Checking page structure...');
      console.log('Articles on page:', document.querySelectorAll('article').length);
    }
    
    // Process only ONE unanalyzed tweet per scan
    if (unanalyzedTweets.length > 0) {
      const tweetToAnalyze = unanalyzedTweets[0]; // Just take the first one
      
      try {
        const text = tweetToAnalyze.textContent;
        
        // Skip very short tweets
        if (!text || text.length < 10) {
          console.log('⏭️ Skipping short text');
          analyzedTweets.add(tweetToAnalyze);
          return;
        }
        
        // Check if we can make a request
        if (!canMakeRequest()) {
          const waitTime = getTimeUntilNextRequest();
          console.log(`⏳ Rate limit active. ${unanalyzedTweets.length} tweets queued. Next analysis in ${Math.ceil(waitTime / 1000)}s`);
          return;
        }
        
        console.log(`🔍 Analyzing tweet (${unanalyzedTweets.length} remaining):`, text.substring(0, 50) + '...');
        recordRequest();
        
        // Mark as analyzed before making the request
        analyzedTweets.add(tweetToAnalyze);
        
        // Send to background script for secure analysis
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Request timeout after 30s'));
          }, 30000);
          
          chrome.runtime.sendMessage(
            { 
              action: 'analyzeText', 
              text: text 
            },
            (response) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                console.error('❌ Message error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
                return;
              }
              resolve(response);
            }
          );
        });
        
        if (response && response.success) {
          const result = response.result;
          console.log('✅ Analysis complete:', result);
          
          // If issues found, add warning indicator
          if (result.hasMisinformation || result.hasHateSpeech) {
            addWarningIndicator(tweetToAnalyze, result);
          }
        } else {
          console.error('❌ Analysis failed:', response?.error);
        }
        
      } catch (error) {
        console.error('❌ Error analyzing tweet:', error);
      }
    } else {
      console.log('✅ All visible tweets have been analyzed');
    }
    
  } catch (error) {
    console.error('❌ Error in scanTweets:', error);
  } finally {
    RATE_LIMIT.isProcessing = false;
    
    // If there are more tweets to process, schedule next scan
    const selectors = ['[data-testid="tweetText"]', 'article [lang]'];
    let allTweets = new Set();
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => allTweets.add(el));
    });
    const remaining = Array.from(allTweets).filter(tweet => !analyzedTweets.has(tweet)).length;
    
    if (remaining > 0 && canMakeRequest()) {
      console.log(`🔄 Scheduling next scan for ${remaining} remaining tweets...`);
      setTimeout(() => scanTweets(), RATE_LIMIT.minDelayBetweenRequests);
    } else if (remaining > 0) {
      const waitTime = getTimeUntilNextRequest();
      console.log(`⏳ ${remaining} tweets queued. Next scan in ${Math.ceil(waitTime / 1000)}s`);
      setTimeout(() => scanTweets(), waitTime + 1000);
    }
  }
}

// Add warning indicator and persist its state in sessionStorage
function addWarningIndicator(tweetElement, result) {
  try {
    // Don't add duplicate warnings
    if (tweetElement.parentElement.querySelector('.factguard-warning')) {
      return;
    }
    
    // Create warning badge
    const warning = document.createElement('div');
    warning.className = 'factguard-warning';
    
    // Style the warning
    const bgColor = result.hasHateSpeech ? '#dc2626' : '#f59e0b';
    const issueType = result.hasHateSpeech ? '⚠️ Hate Speech Detected' : '⚠️ Potential Misinformation';
    
    warning.style.cssText = `
      background: ${bgColor};
      color: white;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      margin-top: 12px;
      cursor: pointer;
      display: inline-block;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      transition: all 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    
    const displayConfidence = Math.round(result.confidenceScore * 100);
    warning.textContent = `${issueType} (${displayConfidence}% confidence)`;

    // Extract tweet link (if available)
    let tweetLink = null;
    try {
      const article = tweetElement.closest('article');
      if (article) {
        const anchor = article.querySelector('a[href*="/status/"]');
        if (anchor) tweetLink = "https://twitter.com" + anchor.getAttribute('href');
      }
    } catch (err) {
      console.error("Couldn't extract tweet link:", err);
    }

    // Persist this warning in sessionStorage
    try {
      const hash = computeTweetHash(tweetElement);
      sessionStorage.setItem(
        "factguard_" + hash,
        JSON.stringify({
          tweetLink: tweetLink,
          result: result
        })
      );
    } catch (err) {
      // Defensive: ignore sessionStorage errors
    }

    // Show popup alert for hate speech or misinformation, including tweet link and sources
    if (result.hasHateSpeech || result.hasMisinformation) {
      const alert = document.createElement('div');
      const isHate = result.hasHateSpeech;

      alert.innerHTML = `
        <div style="text-align:center;">
          <strong>${isHate ? '🚨 Hate Speech Detected' : '⚠️ Misinformation Detected'}</strong><br>
          <span style="font-size:1rem;opacity:0.9;">${result.reasoning || 'AI-flagged content'}</span><br>
          ${tweetLink ? `<a href="${tweetLink}" target="_blank" style="color:#fff;text-decoration:underline;">View Tweet</a>` : ''}
          ${result.sources && result.sources.length > 0 ? 
            `<div style="margin-top:8px;font-size:0.9rem;opacity:0.9;">Source: <a href="${result.sources[0]}" target="_blank" style="color:#fff;text-decoration:underline;">${result.sources[0]}</a></div>` 
            : ''}
        </div>
      `;

      alert.style.cssText = `
        position: fixed;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        background: ${isHate ? '#dc2626' : '#f59e0b'};
        color: #fff;
        font-weight: bold;
        font-size: 1.4rem;
        padding: 20px 40px;
        border-radius: 0 0 18px 18px;
        z-index: 99999;
        box-shadow: 0 6px 32px rgba(0,0,0,0.22);
        max-width: 90%;
        text-align: center;
        letter-spacing: 0.5px;
        opacity: 1;
        transition: opacity 0.8s;
      `;
      document.body.appendChild(alert);
      setTimeout(() => {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 800);
      }, 7000);
    }
    
    // Hover effect
    warning.addEventListener('mouseenter', () => {
      warning.style.transform = 'translateY(-2px)';
      warning.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
    });
    
    warning.addEventListener('mouseleave', () => {
      warning.style.transform = 'translateY(0)';
      warning.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    });
    
    // Click to show details
    warning.addEventListener('click', (e) => {
      e.stopPropagation();
      showDetailModal(result);
    });
    
    // Insert warning after tweet text
    tweetElement.parentElement.appendChild(warning);
    
    console.log('🚨 Warning indicator added to tweet');
  } catch (error) {
    console.error('❌ Error adding warning indicator:', error);
  }
}

function showDetailModal(result) {
  try {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    `;
    
    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      padding: 24px;
      border-radius: 16px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    `;
    
    const issueColor = result.hasHateSpeech ? '#dc2626' : '#f59e0b';
    const issueIcon = result.hasHateSpeech ? '⚠️' : '⚠️';
    
    const displayConfidence = Math.round(result.confidenceScore * 100);
    modal.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px 0; color: ${issueColor}; font-size: 24px;">
          ${issueIcon} FactGuard Analysis
        </h2>
        <p style="margin: 0; color: #666; font-size: 14px;">AI-powered content detection</p>
      </div>
      
      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
        <div style="font-weight: 600; margin-bottom: 8px; color: #374151;">Issue Type</div>
        <div style="color: ${issueColor}; font-weight: 600;">${result.category || 'Unknown'}</div>
      </div>
      
      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
        <div style="font-weight: 600; margin-bottom: 8px; color: #374151;">Confidence</div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="flex: 1; background: #e5e7eb; border-radius: 999px; height: 8px; overflow: hidden;">
            <div style="background: ${issueColor}; height: 100%; width: ${displayConfidence}%; transition: width 0.3s;"></div>
          </div>
          <div style="font-weight: 600; color: ${issueColor};">${displayConfidence}%</div>
        </div>
      </div>
      
      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
        <div style="font-weight: 600; margin-bottom: 8px; color: #374151;">Analysis</div>
        <div style="color: #4b5563; line-height: 1.6;">${result.reasoning}</div>
      </div>
      
      ${result.flaggedContent && result.flaggedContent.length > 0 ? `
        <div style="background: #fef2f2; padding: 16px; border-radius: 8px; border: 1px solid #fecaca;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #991b1b;">Flagged Content</div>
          <ul style="margin: 0; padding-left: 20px; color: #7f1d1d;">
            ${result.flaggedContent.map(item => `<li style="margin-bottom: 4px;">${item}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      
      <button id="factguard-close" style="
        width: 100%;
        margin-top: 20px;
        padding: 12px;
        background: #374151;
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s;
      ">Close</button>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Close on click
    document.getElementById('factguard-close').addEventListener('click', () => {
      overlay.remove();
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  } catch (error) {
    console.error('❌ Error showing detail modal:', error);
  }
}

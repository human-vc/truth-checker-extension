// Highlight then rightclick to check specific text

console.log("General content check");

// Listen for the result from the background script
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "showFactGuardResult" && req.result) {
    console.log("Received analysis result from context menu:", req.result);
    
    // Show the pop-up alert
    // We only show the alert if there's an actual issue
    if (req.result.hasMisinformation || req.result.hasHateSpeech) {
      showWarningAlert(req.result);
    } else if (req.result.reasoning) {
      showDetailModal(req.result);
    }
    return true;
  }
});

// Copied from your stuff on twitter
function showDetailModal(result) {
  try {
    const existingOverlay = document.getElementById('factguard-overlay');
    if (existingOverlay) existingOverlay.remove();
  
    const overlay = document.createElement('div');
    overlay.id = 'factguard-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483645;
      backdrop-filter: blur(4px);
    `;
    
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
      z-index: 2147483646;
    `;
    
    const issueColor = result.hasHateSpeech ? '#dc2626' : (result.hasMisinformation ? '#f59e0b' : '#374151');
    const issueIcon = result.hasHateSpeech ? '🚨' : (result.hasMisinformation ? '⚠️' : '✅');
    const displayConfidence = Math.round(result.confidenceScore * 100);
    const title = result.hasHateSpeech ? 'Hate Speech Detected' : (result.hasMisinformation ? 'Misinformation Detected' : 'Analysis Complete');

    modal.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px 0; color: ${issueColor}; font-size: 24px;">
          ${issueIcon} ${title}
        </h2>
        <p style="margin: 0; color: #666; font-size: 14px;">AI-powered content detection</p>
      </div>
      ${result.hasMisinformation || result.hasHateSpeech ? `
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #374151;">Issue Type</div>
          <div style="color: ${issueColor}; font-weight: 600;">${result.category || 'Unknown'}</div>
        </div>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #374151;">Confidence</div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="flex: 1; background: #e5e7eb; border-radius: 999px; height: 8px; overflow: hidden;">
              <div style="background: ${issueColor}; height: 100%; width: ${displayConfidence}%;"></div>
            </div>
            <div style="font-weight: 600; color: ${issueColor};">${displayConfidence}%</div>
          </div>
        </div>
      ` : ''}
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
      <button id="factguard-close" style="width: 100%; margin-top: 20px; padding: 12px; background: #374151; color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer;">
        Close
      </button>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
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


// More from your twitter stuff
// This shows the pop-up alert at the top of the screen.
function showWarningAlert(result) {
  try {
    // Remove any existing alert
    const existingAlert = document.querySelector('.factguard-alert-popup');
    if (existingAlert) existingAlert.remove();
  
    const alert = document.createElement('div');
    alert.className = 'factguard-alert-popup';
    const isHate = result.hasHateSpeech;

    alert.innerHTML = `
      <div style="text-align:center; cursor: pointer;">
        <strong>${isHate ? '🚨 Hate Speech Detected' : '⚠️ Misinformation Detected'} in Selected Text</strong><br>
        <span style="font-size:1rem;opacity:0.9;">${result.reasoning || 'AI-flagged content'}</span><br>
        <span style="font-size:0.9rem;opacity:0.8;text-decoration:underline;margin-top:5px;display:inline-block;">Click for details</span>
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
      z-index: 2147483647; 
      box-shadow: 0 6px 32px rgba(0,0,0,0.22);
      max-width: 90%;
      text-align: center;
      letter-spacing: 0.5px;
      opacity: 1;
      transition: opacity 0.8s;
      cursor: pointer;
    `;
    
    // Click the alert to open the full modal
    alert.addEventListener('click', () => {
      showDetailModal(result);
      alert.remove();
    });
    
    document.body.appendChild(alert);
    
    // Auto-dismiss after 7 seconds
    setTimeout(() => {
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 800);
Next: 800
    }, 7000);
    
  } catch (error) {
    console.error('❌ Error adding warning alert:', error);
  }
}


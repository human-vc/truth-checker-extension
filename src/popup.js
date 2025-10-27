// popup.js - Handles API key configuration

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');
  
  // Check if API key is already set
  const response = await chrome.runtime.sendMessage({ action: 'getApiKeyStatus' });
  
  if (response.hasKey) {
    showStatus('✅ API key is configured', 'success');
    apiKeyInput.placeholder = '••••••••••••••••••••';
  } else {
    showStatus('⚠️ Please enter your OpenAI API key', 'info');
  }
  
  // Save API key
  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      showStatus('❌ Please enter an API key', 'error');
      return;
    }
    
    if (!apiKey.startsWith('sk-')) {
      showStatus('❌ Invalid API key format', 'error');
      return;
    }
    
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'setApiKey',
        apiKey: apiKey
      });
      
      if (response.success) {
        showStatus('✅ API key saved successfully!', 'success');
        apiKeyInput.value = '';
        apiKeyInput.placeholder = '••••••••••••••••••••';
        
        setTimeout(() => {
          window.close();
        }, 1500);
      } else {
        showStatus('❌ Failed to save: ' + response.error, 'error');
      }
    } catch (error) {
      showStatus('❌ Error: ' + error.message, 'error');
    } finally {
      saveBtn.textContent = 'Save API Key';
      saveBtn.disabled = false;
    }
  });
  
  // Allow Enter key to save
  apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  });
});

function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
}

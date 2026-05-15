const SYSTEM_PROMPT = `You are Stupify, an assistant that makes technical documentation easy to understand for developers who lack deep context.

When given documentation to simplify:
1. Start with "## TL;DR" — 2-3 plain sentences covering what this is and why it matters
2. Break the rest into short sections using ## headers
3. Replace jargon with plain English and real-world analogies
4. **Bold** the key terms the first time they appear
5. End with "## What you actually need to know" — 3 practical bullet points

When answering follow-up questions, be concise (1-3 sentences). Refer back to the documentation context when relevant. Use plain language.`;

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL   = 'llama-3.3-70b-versatile';

let apiKey = '';
let conversationHistory = [];
let isLoading = false;

const $ = id => document.getElementById(id);

const apiSetup   = $('apiSetup');
const mainUI     = $('mainUI');
const apiKeyInput = $('apiKeyInput');
const saveKeyBtn = $('saveKeyBtn');
const simplifyBtn = $('simplifyBtn');
const output     = $('output');
const emptyState = $('emptyState');
const chatDivider = $('chatDivider');
const chat       = $('chat');
const userInput  = $('userInput');
const sendBtn    = $('sendBtn');
const settingsBtn    = $('settingsBtn');
const newSessionBtn  = $('newSessionBtn');

chrome.storage.local.get(['groqApiKey'], result => {
  if (result.groqApiKey) {
    apiKey = result.groqApiKey;
    showMain();
  } else {
    showSetup();
  }
});

function showSetup() {
  apiSetup.style.display = 'flex';
  mainUI.style.display = 'none';
}

function showMain() {
  apiSetup.style.display = 'none';
  mainUI.style.display = 'flex';
}

saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  apiKey = key;
  chrome.storage.local.set({ groqApiKey: key });
  showMain();
});

settingsBtn.addEventListener('click', () => {
  apiKeyInput.value = '';
  showSetup();
});

newSessionBtn.addEventListener('click', () => {
  conversationHistory = [];
  output.innerHTML = '';
  output.style.display = 'none';
  chat.innerHTML = '';
  chatDivider.style.display = 'none';
  emptyState.style.display = 'flex';
  userInput.disabled = true;
  sendBtn.disabled = true;
  newSessionBtn.style.display = 'none';
});

simplifyBtn.addEventListener('click', async () => {
  if (isLoading) return;

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {}
  if (!tab) return;

  let pageText;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText
    });
    pageText = results[0]?.result?.trim();
  } catch (err) {
    showError(output, "Can't read this page. Try a regular webpage.");
    return;
  }

  if (!pageText) return;

  conversationHistory = [];
  output.innerHTML = '';
  chat.innerHTML = '';
  chatDivider.style.display = 'none';
  emptyState.style.display = 'none';
  output.style.display = 'block';

  const truncated = pageText.slice(0, 60000);
  conversationHistory.push({
    role: 'user',
    parts: [{ text: `Simplify this documentation page:\n\n${truncated}` }]
  });

  simplifyBtn.disabled = true;
  simplifyBtn.textContent = 'Simplifying...';

  const responseText = await streamToElement(output);

  simplifyBtn.disabled = false;
  simplifyBtn.textContent = '▶ Simplify this page';

  if (responseText) {
    conversationHistory.push({ role: 'model', parts: [{ text: responseText }] });
    enableChat();
  }
});

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isLoading || conversationHistory.length === 0) return;

  userInput.value = '';
  appendMessage('user', text);
  conversationHistory.push({ role: 'user', parts: [{ text }] });

  const modelEl = appendMessage('model', '');
  const responseText = await streamToElement(modelEl);

  if (responseText) {
    conversationHistory.push({ role: 'model', parts: [{ text: responseText }] });
  }
}

function enableChat() {
  chatDivider.style.display = 'block';
  userInput.disabled = false;
  sendBtn.disabled = false;
  newSessionBtn.style.display = 'block';
  userInput.focus();
}

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (text) div.innerHTML = renderMarkdown(text);
  chat.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return div;
}

function showError(el, msg) {
  el.style.display = 'block';
  el.innerHTML = `<p style="color:#e53e3e">${msg}</p>`;
  emptyState.style.display = 'none';
}

async function streamToElement(el) {
  isLoading = true;
  userInput.disabled = true;
  sendBtn.disabled = true;

  let fullText = '';

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory.map(m => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.parts[0].text }))
    ];

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true, temperature: 0.4, max_tokens: 2048 })
    });

    if (!response.ok) {
      const err = await response.json();
      const msg = err.error?.message || 'API error';
      showError(el, msg.includes('API_KEY') ? 'Invalid API key. Click ⚙ to update it.' : `Error: ${msg}`);
      return null;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.choices?.[0]?.delta?.content || '';
          if (chunk) {
            fullText += chunk;
            el.innerHTML = renderMarkdown(fullText);
            el.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
        } catch {}
      }
    }
  } catch (err) {
    showError(el, `Network error: ${err.message}`);
    return null;
  } finally {
    isLoading = false;
    if (conversationHistory.length > 0) {
      userInput.disabled = false;
      sendBtn.disabled = false;
    }
  }

  return fullText || null;
}

function renderMarkdown(raw) {
  // Escape HTML in source text first, then apply markdown patterns
  let text = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = text.split('\n');
  const out = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
    } else if (/^[-*] /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<br>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${inline(line)}</p>`);
    }
  }

  if (inList) out.push('</ul>');
  return out.join('');
}

function inline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

document.getElementById("simplifyBtn").addEventListener("click", simplify())

async function simplify() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.body.innerText
        })
    
        const pageText = results[0].result;
        console.log("Extracted Text:", pageText);
    }
}
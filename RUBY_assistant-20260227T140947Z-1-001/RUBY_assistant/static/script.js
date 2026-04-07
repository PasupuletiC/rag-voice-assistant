
async function addResearchReport(data) {
  // Hide send/pause buttons
  sendBtn.style.display = "inline-block";
  pauseBtn.style.display = "none";

  // Build the Agent Trace Timeline
  const traceContainer = document.createElement("div");
  traceContainer.className = "agent-trace-container";
  
  const title = document.createElement("div");
  title.className = "trace-title";
  title.textContent = "AGENT TRACE";
  traceContainer.appendChild(title);

  const steps = [
    { agent: "[Supervisor]", action: "decision: Research" },
    { agent: "[Research]", action: "gathering_data: " + (data.search_data ? data.search_data.substring(0,80) + "..." : "DuckDuckGo Execution...") },
    { agent: "[Supervisor]", action: "decision: Analysis" },
    { agent: "[Analysis]", action: "generating_final: Report generated." },
    { agent: "[Supervisor]", action: "decision: FINISH" }
  ];

  chatBox.appendChild(traceContainer);
  chatBox.scrollTop = chatBox.scrollHeight;

  // Animate the trace dots sequentially
  for (let i = 0; i < steps.length; i++) {
    await new Promise(r => setTimeout(r, 600)); // 600ms delay between dots
    const node = document.createElement("div");
    node.className = "trace-node";
    
    const agt = document.createElement("div");
    agt.className = "trace-agent";
    agt.textContent = steps[i].agent;
    
    const act = document.createElement("div");
    act.className = "trace-action";
    act.textContent = steps[i].action;
    
    node.appendChild(agt);
    node.appendChild(act);
    traceContainer.appendChild(node);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  await new Promise(r => setTimeout(r, 800));

  // Build the Final Report Card
  const reportCard = document.createElement("div");
  reportCard.className = "final-report-card";
  
  const header = document.createElement("div");
  header.className = "report-header";
  header.innerHTML = `
    <h2 class="report-title">Comprehensive Research Report</h2>
    <span class="token-badge">Tokens: ${data.tokens || 1250}</span>
  `;
  
  const body = document.createElement("div");
  body.className = "report-body";
  
  // Basic markdown-to-html conversion for the report text
  let rawText = data.reply;
  rawText = rawText.replace(/\n/g, "<br>");
  // Note: app.py already striped ** bold, but if it didn't:
  rawText = rawText.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  body.innerHTML = rawText;
  
  reportCard.appendChild(header);
  reportCard.appendChild(body);
  
  chatBox.appendChild(reportCard);
  chatBox.scrollTop = chatBox.scrollHeight;
  
  // Read it out loud
  speakText("Deep research complete. Here is the final report.");
}

const chatBox   = document.getElementById("chatBox");
const inputEl   = document.getElementById("chatInput");
const sendBtn   = document.getElementById("sendBtn");
const micBtn    = document.getElementById("micBtn");
const clearBtn  = document.getElementById("clearBtn");
const jarvisBtn = document.getElementById("jarvisBtn");
const exportBtn = document.getElementById("exportBtn");
const pauseBtn  = document.getElementById("pauseBtn");
const statusEl  = document.getElementById("status");

const useRagCheckbox = document.getElementById("useRag");
const docFileInput = document.getElementById("docFile");
const uploadDocBtn = document.getElementById("uploadDocBtn");
const uploadStatus = document.getElementById("uploadStatus");
const docList = document.getElementById("docList");

let isAnimating = false;
let shouldStop = false;

const jarvisOverlay = document.getElementById("jarvisOverlay");
const jarvisMic     = document.getElementById("jarvisMic");
const jarvisClose   = document.getElementById("jarvisClose");

const sidebar = document.getElementById("leftSidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const floatingReopen = document.getElementById("floatingReopen");

let recognition = null;
let isSpeaking  = false;
let currentLang = "en-US";
let isListening = false;

// ================= UI HELPERS =================
function addMessage(text, role) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  const who = role === "user" ? "You" : "Ruby";

  // build structure so we can animate text separately
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = who;

  const content = document.createElement("span");
  content.className = "message-text";

  div.appendChild(label);
  div.appendChild(document.createElement("br"));
  div.appendChild(content);
  chatBox.appendChild(div);

  // if it's Ruby's reply animate word-by-word, otherwise just set text
  if (role === "ruby") {
    return animateText(content, text);
  } else {
    content.textContent = text;
    chatBox.scrollTop = chatBox.scrollHeight;
    return Promise.resolve();
  }
}

// animate a block of text character-by-character
function animateText(container, text) {
  return new Promise((resolve) => {
    shouldStop = false;
    isAnimating = true;
    let idx = 0;
    function step() {
      // stop animation if pause button was clicked
      if (shouldStop) {
        isAnimating = false;
        resolve();
        return;
      }
      if (idx >= text.length) {
        isAnimating = false;
        chatBox.scrollTop = chatBox.scrollHeight;
        resolve();
        return;
      }
      const char = text[idx];
      
      // Parse markdown dynamically
      let currentText = text.substring(0, idx + 1);
      // Fallback if marked is missing
      if (typeof marked !== 'undefined') {
        container.innerHTML = marked.parse(currentText);
      } else {
        container.textContent = currentText;
      }
      idx++;
      chatBox.scrollTop = chatBox.scrollHeight;
      setTimeout(step, 50); // adjust delay for speed (lower = faster)
    }
    step();
  });
}

function setStatus(text) {
  statusEl.textContent = `Status: ${text}`;
}

// ================= RAG FUNCTIONS =================
async function loadDocumentList() {
  try {
    const res = await fetch("/list-documents");
    const data = await res.json();
    updateDocListUI(data.documents);
  } catch (err) {
    console.error("Failed to load documents:", err);
  }
}

function updateDocListUI(documents) {
  docList.innerHTML = "";
  if (documents.length === 0) {
    docList.classList.remove("active");
    uploadStatus.textContent = "No documents uploaded";
    return;
  }
  docList.classList.add("active");
  uploadStatus.textContent = `${documents.length} document(s) uploaded`;

  documents.forEach((doc) => {
    const item = document.createElement("div");
    item.className = "doc-item";
    
    const docIcon = doc.type === "pdf" ? "📄" : doc.type === "image" ? "🖼️" : "📝";
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "doc-item-name";
    nameSpan.textContent = `${docIcon} ${doc.name}`;
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "doc-item-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.onclick = async () => {
      try {
        await fetch(`/delete-document/${doc.id}`, { method: "DELETE" });
        loadDocumentList();
      } catch (err) {
        console.error("Failed to delete document:", err);
      }
    };
    
    item.appendChild(nameSpan);
    item.appendChild(deleteBtn);
    docList.appendChild(item);
  });
}

uploadDocBtn.onclick = async () => {
  const files = docFileInput.files;
  if (files.length === 0) {
    uploadStatus.textContent = "Select files first";
    return;
  }

  uploadStatus.textContent = "Uploading...";
  uploadDocBtn.disabled = true;

  let uploadedCount = 0;
  let errorCount = 0;

  for (let file of files) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch("/upload-document", {
        method: "POST",
        body: formData,
      });
      
      if (res.ok) {
        uploadedCount++;
      } else {
        errorCount++;
      }
    } catch (err) {
      console.error("Upload error:", err);
      errorCount++;
    }
  }

  uploadDocBtn.disabled = false;
  docFileInput.value = "";
  
  if (errorCount === 0) {
    uploadStatus.textContent = `✅ Uploaded ${uploadedCount} file(s)`;
  } else {
    uploadStatus.textContent = `⚠️ Uploaded ${uploadedCount}, failed ${errorCount}`;
  }

  loadDocumentList();
};

// Load documents on page load
document.addEventListener("DOMContentLoaded", () => {
  loadDocumentList();
});

// ================= TEXT TO SPEECH =================
function speakText(text) {
  if (!("speechSynthesis" in window)) return;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = currentLang;

  isSpeaking = true;
  setStatus("Speaking...");
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);

  utter.onend = () => {
    isSpeaking = false;
    setStatus("Idle");
    // show send button, hide pause button after speech finishes
    sendBtn.style.display = "inline-block";
    pauseBtn.style.display = "none";
  };
}

// ================= SEND MESSAGE =================
async function sendMessage(message) {
  const msg = message.trim();
  if (!msg) return;

  addMessage(msg, "user");
      if (!jarvisOverlay.classList.contains("hidden") && pxText) { pxText.textContent = "Retrieving data..."; }

  // intercept common queries locally
  if (handleLocalQuery(msg.toLowerCase())) {
    return;
  }

  try {
    const useWebCheckbox = document.getElementById("useWeb");
    const isJarvisActive = !jarvisOverlay.classList.contains("hidden");
    const isWebSearchEnabled = isJarvisActive || (useWebCheckbox ? useWebCheckbox.checked : false);

    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        message: msg,
        use_rag: useRagCheckbox.checked,
        use_web: isWebSearchEnabled
      })
    });

    const data = await res.json();

    if (data.type === "research_report") {
      await addResearchReport(data);
    } else if (data.reply) {
      // show pause button, hide send button
      sendBtn.style.display = "none";
      pauseBtn.style.display = "inline-block";
      
      let replyText = data.reply;

      // Trigger speech instantly alongside animation
      if (!shouldStop) {
        speakText(replyText);
      }
      
            addMessage(replyText, "ruby").then(() => {
        if (!jarvisOverlay.classList.contains("hidden") && pxText) {
          if (typeof marked !== 'undefined') { pxText.innerHTML = marked.parse(replyText); } 
          else { pxText.textContent = replyText; }
        }

        // Only handle UI state after animation finishes
        if (shouldStop) {
          sendBtn.style.display = "inline-block";
          pauseBtn.style.display = "none";
        }
      });
    }

    if (data.action === "open_url" && data.url) {
      window.open(data.url, "_blank");
    }

    if (data.action === "set_lang" && data.lang) {
      currentLang = data.lang;
    }

  } catch (err) {
    console.error(err);
    addMessage("Ruby hit a network error.", "ruby");
  }
}

// ================= SPEECH RECOGNITION =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SR) {
  console.warn("SpeechRecognition API not supported in this browser.");
  setStatus("Voice recognition not supported in this browser");
} else {
  console.log("SpeechRecognition available");
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = true;

  recognition.onstart = () => {
    isListening = true;
    console.log("recognition.onstart");
    setStatus("Listening…");
  };

  recognition.onend = () => {
  stopRadarAudioVisualizer();
    isListening = false;
    console.log("recognition.onend");
    // Reset mic button style
    micBtn.style.background = "";
    micBtn.style.color = "";
    micBtn.textContent = "🎤";
    // auto-restart while jarvis overlay is open for continuous listen
    if (!jarvisOverlay.classList.contains("hidden") && !isSpeaking) {
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to restart recognition:", e);
      }
    } else {
      setStatus("Idle");
    }
  };

  recognition.onerror = (e) => {
    console.error("recognition.onerror", e);
    setStatus("Mic error");
  };

  recognition.onnomatch = (e) => {
    console.log("recognition.onnomatch", e);
  };

  recognition.onaudioend = () => {
    console.log("recognition.onaudioend");
  };

  // Voice result handler
  recognition.onresult = (event) => {
    console.log("recognition.onresult", event);
    if (isSpeaking) return;

    const last = event.results[event.results.length - 1];
    let transcript = last[0].transcript.trim();

    console.log("Raw transcript:", transcript);

    if (transcript.toLowerCase().startsWith("hey ruby")) {
      transcript = transcript.substring(8).trim();
    }

    
    const visionTriggers = ["what am i holding", "what is this", "look at this", "describe this", "what do you see", "ruby look"];
    const isVision = visionTriggers.some(t => transcript.toLowerCase().includes(t));
    if (isVision) {
        captureVisionFrame(transcript);
        return; // Skip normal chat
    }
    
    const wasUICommand = handleVoiceUICommands(transcript.toLowerCase());
    
    // Update PX text perfectly
    if (!jarvisOverlay.classList.contains("hidden") && pxText) {
      pxText.style.animation = "none";
      pxText.textContent = transcript + "...";
    }
    if (!wasUICommand && transcript.length > 0) {
      // Insert into chat input
      inputEl.value = transcript;
      inputEl.focus();
      console.log("Inserted to input:", transcript);
      
      // Auto-send immediately if we are in Jarvis full-screen mode
      if (!jarvisOverlay.classList.contains("hidden")) {
        sendBtn.click();
      }
    }
  };
}

// ================= LOCAL COMMANDS =================
function handleLocalQuery(text) {
  // simple rules for offline responses
  // returns true if message was handled
  const now = new Date();
  if (/\bhello\b|\bhi\b|\bhey\b/.test(text)) {
    const resp = "Hello! How can I help you today?";
    addMessage(resp, "ruby");
    speakText(resp);
    return true;
  }
  if (text.includes("what can you do")) {
    const resp = "I can chat with you, answer questions, and help with voice commands.";
    addMessage(resp, "ruby");
    speakText(resp);
    return true;
  }
  if (text.includes("bye") || text.includes("goodbye")) {
    const resp = "Goodbye! Have a great day.";
    addMessage(resp, "ruby");
    speakText(resp);
    return true;
  }
  if (text.includes("time")) {
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const resp = `The current time is ${hours}:${minutes}.`;
    addMessage(resp, "ruby");
    speakText(resp);
    return true;
  }
  if (text.includes("date")) {
    const resp = `Today is ${now.toDateString()}.`;
    addMessage(resp, "ruby");
    speakText(resp);
    return true;
  }
  if (/\bhow are you\b/.test(text)) {
    const resp = "I'm just code, but I'm functioning properly!";
    addMessage(resp, "ruby");
    speakText(resp);
    return true;
  }
  if (text.includes("thank")) {
    const resp = "You're welcome!";
    addMessage(resp, "ruby");
    speakText(resp);
    return true;
  }
  if (text.includes("joke")) {
    const resp = "Why did the programmer quit his job? Because he didn't get arrays.";
    addMessage(resp, "ruby");
    speakText(resp);
    return true;
  }
  return false;
}

// ================= BUTTON EVENTS =================
micBtn.onclick = async () => {
  // toggle speech recognition for chat input
  if (!recognition) {
    alert("Microphone not supported in this browser. Try using Google Chrome or Edge.");
    setStatus("Voice recognition unavailable");
    return;
  }
  
  // Try to force grab mic permission and catch any user-denied conditions
  if (!isListening) {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      alert("Microphone prompt denied or no microphone found. Please allow microphone access in your browser settings URL bar.");
      setStatus("Mic blocked");
      return;
    }
  }

  try {
    if (isListening) {
      recognition.stop();
      micBtn.style.background = "";
      micBtn.style.color = "";
      micBtn.textContent = "🎤";
      setStatus("Stopped listening");
    } else {
      recognition.start();
      // Visual feedback: highlight mic button during listening
      micBtn.style.background = "#ff6b6b";
      micBtn.style.color = "white";
      micBtn.textContent = "🎤";
      setStatus("Listening…");
    }
  } catch (e) {
    if (e.name === "NotAllowedError") {
      alert("Microphone blocked! You may need to access this app via localhost explicitly (http://localhost:5000).");
    }
    console.error("micBtn toggle error", e);
    setStatus("Mic error");
  }
};

jarvisClose.onclick = () => {
  jarvisOverlay.classList.add("hidden");
  if (recognition) recognition.stop();
};

jarvisMic.onclick = async () => {
  if (!recognition) {
    alert("Voice recognition unavailable in this browser. Try Chrome/Edge.");
    setStatus("Voice recognition unavailable");
    return;
  }
  
  // Try to force grab mic permission
  if (!isListening) {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      alert("Microphone prompt denied or no microphone found. Please allow microphone access in your browser settings URL bar.");
      setStatus("Mic blocked");
      return;
    }
  }

  try {
    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  } catch (e) {
    if (e.name === "NotAllowedError") {
      alert("Microphone blocked! You may need to access this app via localhost explicitly (http://localhost:5000).");
    }
    console.error("jarvisMic toggle error", e);
    setStatus("Mic error");
  }
};

sendBtn.onclick = () => {
  if (isSpeaking) return;
  const msg = inputEl.value;
  inputEl.value = "";
  sendMessage(msg);
};

// Pause button - stop animation and speaking
pauseBtn.onclick = () => {
  shouldStop = true;
  if (isSpeaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
  }
  // show send button, hide pause button
  sendBtn.style.display = "inline-block";
  pauseBtn.style.display = "none";
  setStatus("Paused - Ready for next query");
};

// Enter key
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendBtn.click();
  }
});

// Clear chat
clearBtn.onclick = () => {
  chatBox.innerHTML = "";
  setStatus("History cleared");
};

// Jarvis mode from toolbar
if (jarvisBtn) {
  jarvisBtn.onclick = async () => {
    jarvisOverlay.classList.remove("hidden");
    
    // Force grab mic permission on overlay open
    if (recognition && !isListening) {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        recognition.start();
      } catch (e) {
        if (e.name === "NotAllowedError" || e.name === "NotFoundError") {
          alert("Microphone blocked or not found. Cannot start Jarvis auto-listen.");
        }
        console.error("jarvisBtn listen error", e);
      }
    }
  };
}

// Export chat
exportBtn.onclick = () => {
  let text = "";
  chatBox.querySelectorAll(".message").forEach((m) => {
    text += m.innerText + "\n\n";
  });

  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ruby_chat.txt";
  a.click();
};

// ================= TEMPLATE SYSTEM (AUTO SEND) =================
document.querySelectorAll(".template-card").forEach(card => {
  card.onclick = () => {
    const prompt = card.dataset.prompt;

    // ✅ Put text into input
    inputEl.value = prompt;
    inputEl.focus();

    // // ✅ Auto-send after small delay (natural feel)
    // setTimeout(() => {
    //   sendBtn.click();
    // }, 200);

    // ✅ OPTIONAL: Auto-close sidebar after sending
    // if (sidebar && floatingReopen) {
    //   sidebar.classList.add("closed");
    //   floatingReopen.classList.remove("hidden");
    // }
  };
});


// Live search
const templateSearch = document.getElementById("templateSearch");
if (templateSearch) {
  templateSearch.addEventListener("input", () => {
    const value = templateSearch.value.toLowerCase();
    document.querySelectorAll(".template-card").forEach(card => {
      card.style.display = card.innerText.toLowerCase().includes(value)
        ? "block"
        : "none";
    });
  });
}

// ================= SIDEBAR SYSTEM =================
// if (sidebarToggle && floatingReopen) {
//   sidebarToggle.onclick = () => {
//     sidebar.classList.add("closed");
//     floatingReopen.classList.remove("hidden");
//   };

//   floatingReopen.onclick = () => {
//     sidebar.classList.remove("closed");
//     floatingReopen.classList.add("hidden");
//   };
// }

// ================= VOICE UI CONTROLS =================
function handleVoiceUICommands(text) {
  text = text.toLowerCase();

  if (text.includes("open templates")) {
    sidebar.classList.remove("closed");
    floatingReopen.classList.add("hidden");
    speakText("Templates opened");
    return true;
  }

  if (text.includes("close templates")) {
    sidebar.classList.add("closed");
    floatingReopen.classList.remove("hidden");
    speakText("Templates closed");
    return true;
  }

  if (text.includes("clear chat")) {
    chatBox.innerHTML = "";
    speakText("Chat cleared");
    return true;
  }

  if (text.includes("export chat")) {
    exportBtn.click();
    speakText("Chat exported");
    return true;
  }

  return false;
}


// ================= DEEP RESEARCH & JARVIS FIXES =================
const researchBtn = document.getElementById("researchBtn");
const researchOverlay = document.getElementById("researchOverlay");
const researchClose = document.getElementById("researchClose");
const researchInput = document.getElementById("researchInput");
const researchSubmitBtn = document.getElementById("researchSubmitBtn");

// 1. Deep Research Overlay Toggles
if (researchBtn) {
  researchBtn.onclick = () => {
    researchOverlay.classList.remove("hidden");
    researchInput.focus();
  };
}

if (researchClose) {
  researchClose.onclick = () => {
    researchOverlay.classList.add("hidden");
  };
}

// 2. Submit Deep Research
if (researchSubmitBtn) {
  researchSubmitBtn.onclick = async () => {
    const query = researchInput.value.trim();
    if (!query) return;

    researchOverlay.classList.add("hidden");
    inputEl.value = query;
    addMessage(query, "user");
    inputEl.value = "";
    
    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: query,
          use_rag: typeof useRagCheckbox !== "undefined" && useRagCheckbox ? useRagCheckbox.checked : false,
          use_web: true,
          use_research: true
        })
      });

      const data = await res.json();
      if (data.type === "research_report") {
        await addResearchReport(data);
      } else if (data.reply) {
        addMessage(data.reply, "ruby");
      }
    } catch (err) {
      console.error("Research Error:", err);
      addMessage("Deep Research Protocols failed to connect.", "ruby");
    }
  };
}

if (recognition) {
  recognition.addEventListener("end", () => {
    if (typeof inputEl !== 'undefined' && inputEl.value !== "") {
      addMessage("Processing Request...", "ruby", "processing-msg");
    }
    isListening = false;
    micBtn.style.background = "";
    micBtn.style.color = "";
    micBtn.textContent = "🎤";
    if (jarvisMic) jarvisMic.classList.remove("glow-active");
  });
}

if (jarvisMic) {
  jarvisMic.onclick = async () => {
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      jarvisMic.classList.remove("glow-active");
    } else {
      try {
        if (navigator.mediaDevices) {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        recognition.start();
        jarvisMic.classList.add("glow-active");
      } catch (err) {
        console.error("Jarvis Mic Start Error:", err);
        if (err.name === "InvalidStateError") {
           // It's already listening, ignore.
        } else {
           alert("Microphone Error: " + err.message + "\n\nPlease make sure you access the site via http://localhost:5000 instead of 127.0.0.1 for proper secure context!");
        }
      }
    }
  };
}
// ================= WAKE WORD ENGINE (HEY RUBY) =================
const wakeWordToggle = document.getElementById("wakeWordToggle");
const wakeDot = document.getElementById("wakeDot");

let wakeWordRecognition;
let isWakeListening = false;

if (window.SpeechRecognition || window.webkitSpeechRecognition) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  wakeWordRecognition = new SpeechRec();
  wakeWordRecognition.continuous = true;
  wakeWordRecognition.interimResults = true;
  
  wakeWordRecognition.onstart = () => {
    isWakeListening = true;
    if(wakeDot) {
      wakeDot.style.background = "#00ff88";
      wakeDot.style.boxShadow = "0 0 10px #00ff88";
    }
  };

  wakeWordRecognition.onresult = (evt) => {
    let final_transcript = "";
    for (let i = evt.resultIndex; i < evt.results.length; ++i) {
      final_transcript += evt.results[i][0].transcript.toLowerCase();
    }
    
    // Check for Wake Word Trigger
    if (final_transcript.includes("hey ruby") || final_transcript.includes("ruby wake up")) {
      console.log("Wake Word Detected!");
      wakeWordRecognition.stop(); // Pause wake listener
      
      // Open Jarvis Overlay
      const jarvisOverlay = document.getElementById("jarvisOverlay");
      if (jarvisOverlay.classList.contains("hidden")) {
         document.getElementById("jarvisBtn").click();
      }
      
      // Reaction Protocols
      console.log("Reacting to Wake Word.");
      setTimeout(() => {
         const jOverlay = document.getElementById("jarvisOverlay");
         const jMic = document.getElementById("jarvisMic");
         if(!jMic.classList.contains("glow-active")) {
             try { recognition.start(); jMic.classList.add("glow-active"); startRadarAudioVisualizer(); } catch(e) { console.log(e); }
         }
      }, 500);
    }
  };

  wakeWordRecognition.onend = () => {
    isWakeListening = false;
    if(wakeDot) {
       wakeDot.style.background = "var(--danger)";
       wakeDot.style.boxShadow = "0 0 5px var(--danger)";
    }
    
    // Auto Restart loop robustly if checked and Jarvis is not actively listening
    const jarvisOverlay = document.getElementById("jarvisOverlay");
    const jMicActive = jarvisOverlay && !jarvisOverlay.classList.contains("hidden") && document.getElementById("jarvisMic").classList.contains("glow-active");
    
    if (wakeWordToggle && wakeWordToggle.checked && !jMicActive) {
      setTimeout(() => {
        try { wakeWordRecognition.start(); } catch(e){}
      }, 1000);
    }
  };
  
  // Initial Start
  if (wakeWordToggle && wakeWordToggle.checked) {
      try { wakeWordRecognition.start(); } catch(e){}
  }
}

if(wakeWordToggle) {
    wakeWordToggle.onchange = () => {
        if(wakeWordToggle.checked) {
            try { wakeWordRecognition.start(); } catch(e){}
        } else {
            if(isWakeListening) wakeWordRecognition.stop();
        }
    }
}

// ================= AUDIO-REACTIVE JARVIS RADAR =================
let audioContext = null;
let audioAnalyser = null;
let audioDataArray = null;
let microphoneStream = null;

let sphereRadius = 110;
let baseRadius = 110;
let particles = [];
let rotationAngles = { x: 0, y: 0, z: 0 };
let currentAudioScale = 0;

function initParticles() {
  particles = [];
  const numParticles = 800;
  for (let i = 0; i < numParticles; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / numParticles);
    const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
    particles.push({
      x: Math.cos(theta) * Math.sin(phi),
      y: Math.sin(theta) * Math.sin(phi),
      z: Math.cos(phi)
    });
  }
}

function drawSphere() {
  const c = document.getElementById('jarvisCanvas');
  const ctx = c ? c.getContext('2d') : null;
  if(!ctx) return;
  
  ctx.clearRect(0, 0, c.width, c.height);
  
  // React to audio
  sphereRadius = baseRadius + (currentAudioScale * 70);
  
  rotationAngles.y += 0.003;
  rotationAngles.x += 0.001;

  const cx = c.width / 2;
  const cy = c.height / 2;

  const cosY = Math.cos(rotationAngles.y);
  const sinY = Math.sin(rotationAngles.y);
  const cosX = Math.cos(rotationAngles.x);
  const sinX = Math.sin(rotationAngles.x);

  for (let i = 0; i < particles.length; i++) {
    let p = particles[i];

    let x1 = p.x * cosY - p.z * sinY;
    let z1 = p.x * sinY + p.z * cosY;
    let y1 = p.y;

    let y2 = y1 * cosX - z1 * sinX;
    let z2 = y1 * sinX + z1 * cosX;
    let x2 = x1;

    const scale = 300 / (300 - z2 * sphereRadius);
    const projX = cx + x2 * sphereRadius * scale;
    const projY = cy + y2 * sphereRadius * scale;

    const size = Math.max(0.1, (z2 + 1) * 1.5 * scale);
    const alpha = Math.max(0.1, (z2 + 1.2) / 2.2);
    
    ctx.fillStyle = "rgba(255, 255, 255, " + alpha + ")";

    ctx.beginPath();
    ctx.arc(projX, projY, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function animatePX() {
  requestAnimationFrame(animatePX);
  if (audioAnalyser) {
    audioAnalyser.getByteFrequencyData(audioDataArray);
    let sum = 0;
    for(let i=0; i<audioDataArray.length; i++) { sum += audioDataArray[i]; }
    let avg = sum / audioDataArray.length;
    currentAudioScale = avg / 255; 
  } else {
    currentAudioScale = 0;
  }
  drawSphere();
}

initParticles();
animatePX();

async function startRadarAudioVisualizer() {
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    
    const source = audioContext.createMediaStreamSource(microphoneStream);
    source.connect(audioAnalyser);
    audioDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  } catch (err) {
    console.error("Audio visualizer error:", err);
  }
}

function stopRadarAudioVisualizer() {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (microphoneStream) {
    microphoneStream.getTracks().forEach(track => track.stop());
    microphoneStream = null;
  }
  audioAnalyser = null;
}


// ================= LIVE COMPUTER VISION =================
const visionContainer = document.getElementById("visionContainer");
const liveVideo = document.getElementById("liveVideo");
const liveCanvas = document.getElementById("liveCanvas");
let cameraStream = null;

async function startCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if(liveVideo) liveVideo.srcObject = cameraStream;
        if(visionContainer) visionContainer.style.display = "block";
        return true;
    } catch (e) {
        console.error("Camera error:", e);
        return false;
    }
}

async function captureVisionFrame(promptText) {
    if (!cameraStream) {
        const ok = await startCamera();
        if (!ok) {
            addMessage("Camera access denied or not found.", "ruby");
            return;
        }
        await new Promise(r => setTimeout(r, 1500)); // wait for cam to boot
    }
    
    // Draw to canvas
    liveCanvas.width = liveVideo.videoWidth;
    liveCanvas.height = liveVideo.videoHeight;
    const ctx = liveCanvas.getContext("2d");
    ctx.drawImage(liveVideo, 0, 0);
    const base64Image = liveCanvas.toDataURL("image/jpeg", 0.7);
    
    speakText("Processing visual data. Please hold.");
    
    // Update PX text perfectly
    const jarvisOverlay = document.getElementById("jarvisOverlay");
    const pxText = document.getElementById("pxText");
    if (jarvisOverlay && !jarvisOverlay.classList.contains("hidden") && pxText) {
        pxText.style.animation = "none";
        pxText.textContent = "Analyzing realtime visual matrix...";
    }
    
    try {
        const res = await fetch("/vision", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: base64Image, prompt: promptText })
        });
        const data = await res.json();
        
        speakText(data.reply);
        addMessage(data.reply, "ruby").then(() => {
            if (jarvisOverlay && !jarvisOverlay.classList.contains("hidden") && pxText) {
                if (typeof marked !== 'undefined') { pxText.innerHTML = marked.parse(data.reply); } 
                else { pxText.textContent = data.reply; }
            }
        });
        
    } catch (err) {
        console.error(err);
        addMessage("Failed to connect visual cortex.", "ruby");
    }
}

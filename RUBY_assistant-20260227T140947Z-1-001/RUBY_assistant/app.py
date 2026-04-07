import os, json, webbrowser, re
import logging
from datetime import datetime
import requests, dateparser
from werkzeug.utils import secure_filename
import base64
from io import BytesIO

from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

from langchain_groq import ChatGroq
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from PIL import Image
    import pytesseract
    HAS_OCR = True
except ImportError:
    HAS_OCR = False

    import PyPDF2
    HAS_PDF = True
except ImportError:
    HAS_PDF = False

# ================= ENV ================= #
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
NEWS_API_KEY = os.getenv("NEWS_API_KEY")
DEFAULT_CITY = os.getenv("DEFAULT_CITY", "Madurai,IN")
7
if not GROQ_API_KEY:
    raise RuntimeError("Set GROQ_API_KEY in .env")

# ================= FLASK ================= #
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# ================= RAG DOCUMENT STORE ================= #
rag_documents_metadata = {}
rag_counter = 0

embed_model = None
vector_store = None
text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)

def init_embed_model():
    global embed_model
    if embed_model is None:
        logger.info("Initializing HuggingFace Embeddings...")
        embed_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

def rebuild_vector_store():
    global vector_store, embed_model
    init_embed_model()
    
    docs = []
    for doc_id, data in rag_documents_metadata.items():
        chunks = text_splitter.split_text(data["text"])
        for chunk in chunks:
            docs.append(Document(page_content=chunk, metadata={"doc_id": doc_id, "name": data["name"]}))
            
    if docs:
        vector_store = FAISS.from_documents(docs, embed_model)
    else:
        vector_store = None


def extract_text_from_pdf(file_bytes):
    """Extract text from PDF file bytes."""
    if not HAS_PDF:
        return "PDF support not installed. Install PyPDF2."
    try:
        pdf_reader = PyPDF2.PdfReader(BytesIO(file_bytes))
        
        # Admit Cards and Bank Statements are usually encrypted
        if pdf_reader.is_encrypted:
            # Try empty password first (standard owner-lock)
            decrypted = pdf_reader.decrypt('')
            if not decrypted:
                return "[CRITICAL]: This PDF (Admit Card) is Password Protected. Artificial Intelligence cannot read password-locked files without the password. Please unlock the PDF or print to PDF before uploading."
                
        text = "".join([page.extract_text() for page in pdf_reader.pages if page.extract_text()])
        return text if text.strip() else "[PDF has no extractable text]"
    except Exception as e:
        if "PyCryptodome" in str(e):
            return "THE ADMIT CARD PDF IS PASSWORD LOCKED! The AI cannot read it. Please open the Admit Card PDF on your computer, click 'Print', choose 'Save as PDF', and upload the new unlocked version to Ruby!"
        logger.error(f"Error reading PDF: {str(e)}")
        return f"Error reading PDF: {str(e)}"


def extract_text_from_image(file_bytes):
    """Extract text from image using OCR."""
    if not HAS_OCR:
        return "[Image uploaded - OCR not installed. Install Pillow and pytesseract.]"
    try:
        image = Image.open(BytesIO(file_bytes))
        text = pytesseract.image_to_string(image)
        return text if text.strip() else "[Image has no extractable text]"
    except Exception as e:
        logger.error(f"OCR failed: {str(e)}")
        return f"[Image uploaded but OCR failed: {str(e)}]"


def extract_text_from_txt(file_bytes):
    """Extract text from text file."""
    try:
        return file_bytes.decode("utf-8")
    except Exception:
        return "[Text file could not be decoded]"


def retrieve_relevant_docs(query, top_k=3):
    """Semantic vector-based retrieval."""
    if vector_store is None:
        return []
        
    try:
        results = vector_store.similarity_search(query, k=top_k)
        unique_docs = {}
        for doc in results:
            doc_id = doc.metadata.get("doc_id")
            if doc_id not in unique_docs:
                unique_docs[doc_id] = {
                    "name": doc.metadata.get("name", "Unknown"),
                    "text": doc.page_content
                }
        return list(unique_docs.values())
    except Exception as e:
        logger.error(f"Error during semantic retrieval: {e}")
        return []


def find_app_shortcut(app_name):
    """Dynamically search Windows Start Menu for shortcuts."""
    common_paths = [
        os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs"),
        os.path.expandvars(r"%ProgramData%\Microsoft\Windows\Start Menu\Programs")
    ]
    
    app_target_lower = app_name.lower().replace(" ", "")
    
    for base_dir in common_paths:
        if not os.path.exists(base_dir): continue
        for root, dirs, files in os.walk(base_dir):
            for file in files:
                if file.endswith(".lnk"):
                    file_clean = file.lower().replace(" ", "").replace(".lnk", "")
                    if app_target_lower in file_clean or file_clean in app_target_lower:
                        return os.path.join(root, file)
    return None

# ================= GROQ ================= #
llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="llama-3.3-70b-versatile",
    temperature=0.6,
)

from langchain_core.messages import HumanMessage, AIMessage

CHAT_HISTORY_FILE = "ruby_chat_history.json"
store = {}

def load_chat_history(session_id):
    history = InMemoryChatMessageHistory()
    if os.path.exists(CHAT_HISTORY_FILE):
        try:
            with open(CHAT_HISTORY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                session_data = data.get(session_id, [])
                # Limit memory to last 50 exchanges
                session_data = session_data[-50:] 
                for msg in session_data:
                    if msg.get("type") == "human":
                        history.add_message(HumanMessage(content=msg.get("content", "")))
                    else:
                        history.add_message(AIMessage(content=msg.get("content", "")))
        except Exception as e:
            logger.error(f"Failed to load chat history: {e}")
    return history

def save_chat_history():
    data = {}
    for sid, history in store.items():
        messages = []
        for msg in history.messages:
            if isinstance(msg, HumanMessage):
                messages.append({"type": "human", "content": msg.content})
            else:
                messages.append({"type": "ai", "content": msg.content})
        data[sid] = messages
        
    try:
        with open(CHAT_HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save chat history: {e}")

def get_session_history(session_id):
    if session_id not in store:
        store[session_id] = load_chat_history(session_id)
    return store[session_id]


prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are Ruby, a smart personal voice assistant. "
            "answer user queries in elaborated and concise bullet points."
        ),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{input}"),
    ]
)

chain = prompt | llm
conversation = RunnableWithMessageHistory(
    chain,
    get_session_history,
    input_messages_key="input",
    history_messages_key="history",
)

# ================= PERMANENT MEMORY ================= #
MEMORY_FILE = "ruby_memory.json"


def empty_memory():
    return {"name": None, "facts": [], "events": [], "likes": []}


def load_ruby_memory():
    if not os.path.exists(MEMORY_FILE):
        return empty_memory()
    try:
        with open(MEMORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return empty_memory()

    data.setdefault("name", None)
    data.setdefault("facts", [])
    data.setdefault("events", [])
    data.setdefault("likes", [])
    return data


def save_ruby_memory(data):
    with open(MEMORY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ================= STRONG DATE PARSER ================= #
def extract_natural_datetime(text: str):
    text_low = text.lower()

    dt = dateparser.parse(
        text_low,
        settings={"PREFER_DATES_FROM": "future", "STRICT_PARSING": False},
    )
    if dt:
        return dt

    MONTHS = {
        "january": 1,
        "february": 2,
        "march": 3,
        "april": 4,
        "may": 5,
        "june": 6,
        "july": 7,
        "august": 8,
        "september": 9,
        "october": 10,
        "november": 11,
        "december": 12,
    }

    for name, num in MONTHS.items():
        if name in text_low:
            match = re.search(
                rf"{name}\s+(\d{{1,2}})|(\d{{1,2}})\s+{name}", text_low
            )
            if match:
                day = int(match.group(1) or match.group(2))
                year = datetime.now().year
                return datetime(year, num, day)
    return None


# ================= MEMORY HELPERS ================= #
def add_event(desc, date_obj, ev_type):
    data = load_ruby_memory()
    if not date_obj:
        date_obj = extract_natural_datetime(desc)

    event = {
        "description": desc,
        "type": ev_type,
        "date": date_obj.strftime("%Y-%m-%d") if date_obj else None,
        "created_at": datetime.utcnow().isoformat(),
    }

    data["events"].append(event)
    save_ruby_memory(data)


def add_like(text):
    data = load_ruby_memory()
    clean = re.sub(r"i like", "", text, flags=re.I).strip().title()
    if clean and clean not in data["likes"]:
        data["likes"].append(clean)
        save_ruby_memory(data)


def find_events_by_date(text):
    dt = extract_natural_datetime(text)
    if not dt:
        return []
    target = dt.strftime("%Y-%m-%d")
    data = load_ruby_memory()
    return [e for e in data["events"] if e.get("date") == target]


# ================= WEATHER & NEWS ================= #
def get_weather():
    if not OPENWEATHER_API_KEY:
        return "Weather API key not set."
    try:
        url = (
            f"https://api.openweathermap.org/data/2.5/weather"
            f"?q={DEFAULT_CITY}&appid={OPENWEATHER_API_KEY}&units=metric"
        )
        r = requests.get(url, timeout=8).json()
        temp = r["main"]["temp"]
        desc = r["weather"][0]["description"]
        return f"{DEFAULT_CITY}: {temp}°C, {desc}"
    except Exception:
        return "⚠️ Weather service unavailable right now."


def get_news():
    if not NEWS_API_KEY:
        return "News API key not set."
    try:
        url = (
            f"https://newsapi.org/v2/top-headlines"
            f"?country=in&apiKey={NEWS_API_KEY}"
        )
        r = requests.get(url, timeout=8).json()
        titles = [a["title"] for a in r.get("articles", [])[:5]]
        if not titles:
            return "⚠️ No news articles available."
        return "\n".join(f"• {t}" for t in titles)
    except Exception:
        return "⚠️ News service unavailable right now."


# ================= ROUTES ================= #
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload-document", methods=["POST"])
def upload_document():
    """Upload a document (PDF, TXT, or image) for RAG."""
    global rag_counter
    
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400
    
    filename = secure_filename(file.filename)
    file_bytes = file.read()
    
    # Determine file type and extract text
    file_ext = filename.lower().split(".")[-1]
    
    if file_ext == "pdf":
        text = extract_text_from_pdf(file_bytes)
        doc_type = "pdf"
    elif file_ext in ["txt"]:
        text = extract_text_from_txt(file_bytes)
        doc_type = "txt"
    elif file_ext in ["jpg", "jpeg", "png", "gif", "bmp"]:
        text = extract_text_from_image(file_bytes)
        doc_type = "image"
    else:
        return jsonify({"error": f"Unsupported file type: {file_ext}"}), 400
    
    # Store document metadata & rebuild index
    doc_id = rag_counter
    rag_counter += 1
    rag_documents_metadata[doc_id] = {
        "name": filename,
        "text": text,
        "type": doc_type,
        "uploaded_at": datetime.now().isoformat(),
    }
    
    rebuild_vector_store()
    
    return jsonify({
        "success": True,
        "doc_id": doc_id,
        "filename": filename,
        "doc_count": len(rag_documents_metadata),
    })


@app.route("/list-documents", methods=["GET"])
def list_documents():
    """List all uploaded documents."""
    docs = [
        {"id": doc_id, "name": data["name"], "type": data["type"]}
        for doc_id, data in rag_documents_metadata.items()
    ]
    return jsonify({"documents": docs})


@app.route("/delete-document/<int:doc_id>", methods=["DELETE"])
def delete_document(doc_id):
    """Delete a document by ID."""
    if doc_id in rag_documents_metadata:
        name = rag_documents_metadata[doc_id]["name"]
        del rag_documents_metadata[doc_id]
        rebuild_vector_store()
        return jsonify({"success": True, "deleted": name})
    return jsonify({"error": "Document not found"}), 404


from flask import jsonify

@app.route("/vision", methods=["POST"])
def vision():
    try:
        data = request.json
        img_data = data.get("image", "")
        if "base64," in img_data:
            img_b64 = img_data.split("base64,")[-1]
        else:
            img_b64 = img_data
            
        prompt = data.get("prompt", "Analyze this image and describe exactly what you see.")
        
        from langchain_core.messages import HumanMessage
        from langchain_groq import ChatGroq
        vision_llm = ChatGroq(
            groq_api_key=GROQ_API_KEY,
            model_name="llama-3.2-11b-vision-preview",
            temperature=0.5,
        )
        
        msg = HumanMessage(
            content=[
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
            ]
        )
        
        res = vision_llm.invoke([msg])
        return jsonify({"reply": res.content})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"reply": f"Visual cortex error: {str(e)}"}), 500

@app.route("/chat", methods=["POST"])
def chat():
    mem = load_ruby_memory()
    user_raw = request.json.get("message", "").strip()
    use_rag = request.json.get("use_rag", False)
    use_web = request.json.get("use_web", False)

    # helper to log everything to a text file with timestamp
    def log_chat(user, reply):
        try:
            with open("chat_log.txt", "a", encoding="utf-8") as f:
                ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                f.write(f"[{ts}] User: {user}\n")
                f.write(f"[{ts}] Ruby: {reply}\n\n")
        except Exception:
            pass

    def respond(reply, action=None, **extras):
        log_chat(user_raw, reply)
        out = {"reply": reply, "action": action}
        out.update(extras)
        return jsonify(out)

    if not user_raw:
        return respond("I didn't receive any message.")

    user_msg = user_raw.lower()

    # ---------- NAME MEMORY ----------
    if "my name is" in user_msg:
        name = user_raw.split("is", 1)[-1].strip().title()
        mem["name"] = name
        save_ruby_memory(mem)
        return respond(f"✅ I saved your name as {name}.")

    if "what is my name" in user_msg:
        if mem.get("name"):
            return respond(f"✅ Your name is {mem['name']}.")
        return respond("❌ I don't know your name yet.")

    # ---------- LIKES MEMORY ----------
    if "i like" in user_msg:
        add_like(user_msg)
        return respond("✅ Got it! I'll remember your likes.")

    if (
        "what do i like" in user_msg
        or "who i like" in user_msg
        or "my likes" in user_msg
    ):
        if not mem.get("likes"):
            return respond("❌ You haven't told me what you like yet.")
        return respond(f"✅ You like: {', '.join(mem['likes'])}")

    # ---------- SIMPLE LANGUAGE SWITCH FOR VOICE ----------
    if "speak telugu" in user_msg:
        return respond("Switching to Telugu voice.", action="set_lang", lang="te-IN")

    if "speak hindi" in user_msg:
        return respond(" Switching to Hindi voice.", action="set_lang", lang="hi-IN")

    if "speak tamil" in user_msg:
        return respond("Switching to Tamil voice.", action="set_lang", lang="ta-IN")

    if "speak english" in user_msg:
        return respond(" Switching back to English voice.", action="set_lang", lang="en-US")

    # ---------- EVENTS ----------
    if any(k in user_msg for k in ["exam", "meeting", "birthday", "remind"]):
        dt = extract_natural_datetime(user_raw)
        if "exam" in user_msg:
            ev_type = "exam"
        elif "meeting" in user_msg:
            ev_type = "meeting"
        elif "birthday" in user_msg:
            ev_type = "birthday"
        else:
            ev_type = "note"

        add_event(user_raw, dt, ev_type)

        if dt:
            nice = dt.strftime("%d %B %Y")
            return respond(f"✅ Saved your {ev_type} on {nice}.")
        return respond(f"✅ Saved your {ev_type}, but I couldn't detect a date.")

    if any(k in user_msg for k in ["event", "exam"]) and re.search(r"\d", user_msg):
        events = find_events_by_date(user_raw)
        if not events:
            return respond("❌ You have no events on that date.")
        e = events[0]
        if e.get("date"):
            nice_date = datetime.strptime(e["date"], "%Y-%m-%d").strftime("%d %B")
            return respond(f"✅ You have an {e['type']} on {nice_date}.")
        else:
            return respond(
                f"✅ You saved: {e['description']}, but there is no exact date."
            )

    # ---------- WEATHER & NEWS ----------
    if "weather" in user_msg:
        return respond(get_weather())

    if "news" in user_msg:
        return respond(get_news())

    # ---------- WEBSITE + PC APP OPEN ----------
    if user_msg.startswith("open "):
        # raw text after "open"
        target_raw = user_raw.split(" ", 1)[1].strip()
        target = target_raw.lower()

        # 💻 PC apps (update paths if needed)
        apps = {
            "chrome": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "notepad": r"C:\Windows\System32\notepad.exe",
            "calculator": r"C:\Windows\System32\calc.exe",
            "explorer": r"C:\Windows\explorer.exe",
            # change this path if your VS Code is elsewhere
            "vscode": r"C:\Users\Dell\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Visual Studio Code",
        }

        # 📁 Common folders (change TEJA if your username different)
        folders = {
            "downloads": r"C:\Users\tejak\Downloads",
            "documents": r"C:\Users\tejak\OneDrive\Documents",
            "desktop":   r"C:\Users\tejak\OneDrive\Desktop",
        }

        # 1) If exact app name in hardcoded apps
        if target in apps:
            try:
                os.startfile(apps[target])
                return respond(f" Opening {target_raw} on your PC.")
            except Exception as e:
                logger.error(f"Failed to open {target}: {e}")
                return respond(f" I couldn't open {target_raw}.")

        # 1.5) Dynamic Start Menu Search
        shortcut_path = find_app_shortcut(target)
        if shortcut_path:
            try:
                os.startfile(shortcut_path)
                return respond(f"Opening {target_raw} from Start Menu.")
            except Exception as e:
                logger.error(f"Failed to open shortcut {shortcut_path}: {e}")
                return respond(f"I couldn't launch {target_raw}.")

        # 2) If folder
        if target in folders:
            try:
                os.startfile(folders[target])
                return respond(f"Opening your {target_raw} folder.")
            except Exception as e:
                logger.error(f"Failed to open folder {target}: {e}")
                return respond(f"I couldn't open {target_raw} folder.")

        # 3) Otherwise treat as website
        site = target.replace(" ", "")
        if "." in site:
            url = f"https://{site}" if not site.startswith("http") else site
        else:
            url = f"https://www.{site}.com"

        return respond(f"Opening {target}", action="open_url", url=url)

    # ---------- GOOGLE SEARCH ----------
    if user_msg.startswith("search "):
        query = user_msg.replace("search", "", 1).strip()
        url = f"https://www.google.com/search?q={query}"
        return respond(
            f"Searching Google for {query}", action="open_url", url=url
        )

    # ---------- RAG-ENHANCED AI CHAT ----------
    rag_context = ""
    if use_rag and rag_documents_metadata:
        relevant_docs = retrieve_relevant_docs(user_raw)
        if relevant_docs:
            rag_context = "\n\n📄 Relevant Information from your documents:\n"
            for i, doc in enumerate(relevant_docs, 1):
                rag_context += f"\n[Document {i}: {doc['name']}]\n{doc['text'][:500]}...\n"

    # ---------- PERPLEXITY WEB SEARCH & DEEP RESEARCH ----------
    web_context = ""
    use_research = request.json.get("use_research", False)
    use_web = request.json.get("use_web", False)
    user_raw = request.json.get("message", "")
    
    if use_web or use_research:
        try:
            logger.info(f"Running Web Search for: {user_raw}")
            from langchain_community.tools import DuckDuckGoSearchResults
            ddg = DuckDuckGoSearchResults(num_results=5 if use_research else 3)
            search_results = ddg.invoke(user_raw)
            if search_results:
                web_context += f"\n\n🌐 Live Web Context from DuckDuckGo:\n{search_results}\n"
        except Exception as e:
            logger.error(f"Web Search failed: {e}")
            web_context += "\n\n(Note: Web search was requested but currently failed to execute.)\n"

    # Build the prompt with RAG and WEB context if available
    prompt_text = user_raw
    if use_research:
        prompt_text = f"You are an expert AI Deep Research Assistant analyzing a highly complex topic.\nUser Question: {user_raw}\n{rag_context}{web_context}\n\nPlease analyze the above contexts methodically, cross-reference data points, ignore noise, and synthesize an incredibly detailed, comprehensive Research Report. Present your analysis using professional markdown formatting (clear bolded headings, bullet points, and actionable takeaways)."
    elif rag_context or web_context:
        prompt_text = f"User Question: {user_raw}\n{rag_context}{web_context}\n\nAnswer the user\'s question accurately using ONLY the context provided above if applicable. Cite sources if providing factual data."

    result = conversation.invoke(
        {"input": f"Reply in short bullet points:\n{prompt_text}"},
        config={"configurable": {"session_id": "ruby"}},
    )

    # Save memory state automatically
    save_chat_history()

    text = result.content

    # remove bold markdown **like this**
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    # convert list bullets "* something" or "- something" into "• something"
    text = re.sub(r"^\s*[\*\-]\s*", "• ", text, flags=re.M)

    if use_research:
        # ATTEMPT TO CALL TRUE LANGGRAPH FASTAPI ENGINE
        try:
            import requests
            api_resp = requests.post("http://127.0.0.1:8000/v1/execute", json={"query": user_raw}, timeout=30)
            if api_resp.status_code == 200:
                data = api_resp.json()
                from flask import current_app
                current_app.logger.info("Successfully fetched report from LangGraph FastAPI Engine!")
                return respond(data.get("final_answer", ""), type="research_report", search_data="LangGraph Autonomous Agent Trace Active...", tokens=data.get("token_usage", 500))
        except Exception as e:
            # Server not running or failed
            pass

        # FALLBACK: Simulated Agent Trace
        search_snippet = search_results if 'search_results' in locals() and search_results else "Analyzing local knowledge matrices..."
        if len(search_snippet) > 150: search_snippet = search_snippet[:150] + "..."
        approx_tokens = int(len(text) * 0.3)
        return respond(text, type="research_report", search_data=search_snippet, tokens=approx_tokens)
    return respond(text)


# ================= RUN ================= #
if __name__ == "__main__":
    # Avoid double-open in debug mode
    # if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        # webbrowser.open("http://127.0.0.1:5000")
    app.run(debug=True)

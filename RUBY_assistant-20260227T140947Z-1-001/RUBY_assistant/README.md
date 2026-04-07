# Ruby Voice Assistant 🤖✨

Ruby is an advanced, AI-powered personal voice assistant built with Python and Flask. She is equipped with long-term memory, semantic document retrieval (RAG), dynamic application launching, live web search capabilities, computer vision, and more. Powered by Groq's fast LLaMA models, Ruby is designed to be your capable, daily operational assistant.

---

## 🌟 Key Features

* **🧠 Persistent User Memory:** Remembers your name, preferences, likes, and events across sessions.
* **📂 Document Intelligence (RAG):** Upload and chat with PDFs, TXTs, and Images. Includes built-in OCR (Optical Character Recognition) for images and text extraction for PDFs.
* **🌐 True Live Web Search:** Integrates with DuckDuckGo for live context and Perplexity-style deep research.
* **🚀 Dynamic PC App Launcher:** Tell Ruby to "Open Chrome" or "Open Calculator," and she will dynamically find and launch standard Windows apps or your custom Start Menu shortcuts.
* **👁️ Computer Vision:** Capable of analyzing images (via LLaMA Vision) and describing their contents.
* **🌦️ Weather & News Updates:** Get real-time weather and the latest news headlines.
* **🗣️ Multi-Lingual Support:** Easily switch between English, Hindi, Tamil, and Telugu voice modes.

---

## 💻 Prerequisites

Before you download and run Ruby daily, ensure you have the following installed on your Windows machine:

1. **Python 3.9+**: Download from [python.org](https://www.python.org/downloads/). Ensure you check "Add Python to PATH" during installation.
2. **Tesseract OCR (Required for Image Reading)**: 
   - Download the Windows installer from [UB-Mannheim Tesseract](https://github.com/UB-Mannheim/tesseract/wiki).
   - Install it, and ensure the installation directory (usually `C:\Program Files\Tesseract-OCR`) is added to your Windows PATH environment variable.

---

## 📥 How to Download & Install

### Step 1: Download the Application
If you haven't already, download or clone the `RUBY_assistant` folder to your computer (e.g., to your Downloads or Documents folder).

### Step 2: Set Up a Virtual Environment (Recommended)
Open your terminal (Command Prompt or PowerShell), navigate to the `RUBY_assistant` folder, and run:
```bash
cd path\to\RUBY_assistant
python -m venv .venv
```

Activate the virtual environment:
```bash
# On Windows Command Prompt
.venv\Scripts\activate.bat

# On Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

### Step 3: Install Required Dependencies
With your virtual environment activated, install all necessary Python packages:
```bash
pip install flask python-dotenv langchain-groq langchain-core langchain-community langchain-huggingface langchain-text-splitters faiss-cpu requests dateparser Pillow pytesseract PyPDF2
```

### Step 4: Configure API Keys (.env File)
In the `RUBY_assistant` folder, open or create a file named `.env` and add your API keys. It should look like this:

```env
GROQ_API_KEY="your_groq_api_key_here"
OPENWEATHER_API_KEY="your_openweather_api_key_here"
NEWS_API_KEY="your_news_api_key_here"
DEFAULT_CITY="Madurai,IN"
```
* **Groq API**: Get your free LLM API key from [console.groq.com](https://console.groq.com/).
* **OpenWeather API**: Get a free API key from [openweathermap.org](https://openweathermap.org/api).
* **News API**: Get a free key from [newsapi.org](https://newsapi.org/).

---

## 🚀 How to Run Ruby (Daily Usage)

To start Ruby for your daily tasks, follow these simple steps:

1. **Open PowerShell or Command Prompt.**
2. **Navigate to the folder:**
   ```bash
   cd c:\Users\<YourUsername>\Downloads\RUBY_assistant-20260227T140947Z-1-001\RUBY_assistant
   ```
3. **Activate Environment (if you closed the terminal previously):**
   ```bash
   .\.venv\Scripts\Activate
   ```
4. **Start the Server:**
   ```bash
   python app.py
   ```
5. **Open Ruby in your Browser:**
   Once the server starts, open your web browser and navigate to:
   **http://127.0.0.1:5000**

---

## 🛠️ Daily Usage Examples

Here are some things you can ask Ruby once she is running:

* **General Chat & Memory**
  * *"My name is Teja."*
  * *"I like programming."*
  * *"Remind me I have a meeting on 15th April."*
  
* **Computer Control**
  * *"Open Chrome."*
  * *"Open Calculator."*
  * *"Open Downloads folder."*
  * *"Open vscode."*
  
* **Web Search & Deep Research**
  * *"Search Google for Python tutorials."*
  * (Toggle the **Web Search** icon in the UI before asking): *"Who won the latest cricket match?"*
  * (Toggle the **Deep Research** icon taking advantage of LangGraph if configured): *"Give me a deep research report on quantum computing."*

* **News & Weather**
  * *"What is the weather today?"*
  * *"Tell me the news."*

* **Document Analysis (RAG)**
  * Click the Upload button in the UI, upload a PDF/Image.
  * (Toggle **RAG** mode in the UI): *"Summarize the document I just uploaded."*

### Notes for Smooth Operation:
* **Password Protected PDFs**: Ruby cannot read encrypted PDFs (like Bank Statements or Admit Cards). Please print them to an unlocked PDF before uploading!
* **Memory Limits**: Ruby maintains the last 50 conversational exchanges in her active short-term memory to keep responses lightning fast without hitting token limits. Permanent facts are stored safely in `ruby_memory.json`.

Enjoy your new personal assistant!

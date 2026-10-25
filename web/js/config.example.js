// Bu dosyayı config.local.js adıyla kopyalayın ve anahtarınızı yazın. config.local.js git'e girmez.
// Anahtar tarayıcıda görünür; yalnızca yerel demo için kullanın, yayına almayın.
window.LLM_CONFIG = {
  geminiKey: '',                 // Google AI Studio > Get API key
  geminiModel: 'gemini-2.5-flash',
  // Anahtarsız yerel seçenek: Ollama (https://ollama.com). Gemini anahtarı boşsa bu kullanılır.
  ollamaModel: '',               // ör. 'llama3:8b'; boşsa kapalı
  ollamaUrl: 'http://localhost:11434'
};

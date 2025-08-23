import axios from "axios";
import { logger } from "../../config";

export interface PiperTTSOptions {
  text: string;
  voice?: string;
  language?: string; // Add language parameter for multi-language support
  serverUrl?: string;
  speakingRate?: number;
  lengthScale?: number;
  noiseScale?: number;
  noiseW?: number;
}

export class PiperTTS {
  private serverUrl: string;
  private fallbackUrls: string[];

  constructor(serverUrl: string = "http://piper-tts:5001") {
    this.serverUrl = serverUrl;
    this.fallbackUrls = [
      "http://piper-tts:5001",
      "http://localhost:5001",
      "http://127.0.0.1:5001"
    ];
  }

  private detectMixedLanguage(text: string): { segments: Array<{text: string, language: string}>, primaryLanguage: string } {
    // Common English tech/business terms in Turkish context
    const englishPatterns = [
      /\b(API|HTTP|JSON|XML|REST|GraphQL|SQL|NoSQL|HTML|CSS|JavaScript|TypeScript|React|Node\.js|Docker|Kubernetes|AWS|Azure|Google Cloud)\b/gi,
      /\b(startup|e-commerce|fintech|blockchain|AI|ML|deep learning|machine learning|data science|big data|cloud computing)\b/gi,
      /\b(software|hardware|framework|library|database|server|client|frontend|backend|fullstack|mobile app|web app)\b/gi,
      /\b(GitHub|GitLab|npm|yarn|webpack|babel|eslint|prettier|jest|cypress|selenium)\b/gi,
      /\b(iPhone|iPad|Android|iOS|Windows|MacOS|Linux|Ubuntu)\b/gi,
      /\b(email|password|login|logout|signup|dashboard|profile|settings|notifications)\b/gi
    ];

    // Split text into segments and detect language
    const segments: Array<{text: string, language: string}> = [];
    let remainingText = text;
    let primaryLanguage = 'tr'; // Default to Turkish
    let englishWordCount = 0;
    let totalWords = text.split(/\s+/).length;

    // Find English segments
    for (const pattern of englishPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        englishWordCount += matches.length;
      }
    }

    // If more than 30% English words, consider it mixed/English dominant
    if (englishWordCount / totalWords > 0.3) {
      primaryLanguage = 'mixed';
    }

    // For now, return the whole text as primary language
    // TODO: Implement actual segmentation
    segments.push({ text: remainingText, language: primaryLanguage });

    return { segments, primaryLanguage };
  }

  private normalizeEnglishTerms(text: string): string {
    // Comprehensive English-to-Turkish phonetic mapping
    const phoneticMap: Record<string, string> = {
      // AI/ML Terms
      'Faster-Whisper': 'Faster Visper',
      'Faster Whisper': 'Faster Visper', 
      'whisper': 'visper',
      'Whisper': 'Visper',
      'ChatGPT': 'Çet Ci Pi Ti',
      'OpenAI': 'Open Eyi',
      'machine learning': 'makine lerning',
      'deep learning': 'dip lerning',
      'AI': 'Eyi',
      'ML': 'Em El',
      
      // Model Terms
      'base model': 'beys model',
      'medium model': 'medyım model',
      'large model': 'larc model',
      'fine-tuning': 'fayn tuning',
      'training': 'treyning',
      'inference': 'inferans',
      
      // Tech Terms
      'API': 'Eyi Pi Ay',
      'REST API': 'Rest Eyi Pi Ay',
      'HTTP': 'Eç Ti Ti Pi',
      'HTTPS': 'Eç Ti Ti Pi Es',
      'JSON': 'Ceyson',
      'XML': 'İks Em El',
      'SQL': 'Es Kü El',
      'NoSQL': 'No Es Kü El',
      'GraphQL': 'Graf Kü El',
      
      // Development
      'JavaScript': 'Java Skript',
      'TypeScript': 'Tayp Skript',
      'React': 'Riakt',
      'Node.js': 'Nod Cey Es',
      'Docker': 'Dokır',
      'Kubernetes': 'Kubırnitis',
      'GitHub': 'Git Hab',
      'GitLab': 'Git Lab',
      
      // Cloud/Platforms
      'AWS': 'Eyi Dabıl Yu Es',
      'Azure': 'Azür',
      'Google Cloud': 'Gugl Klaud',
      'Firebase': 'Fayr Beys',
      
      // Business Terms
      'startup': 'startap',
      'e-commerce': 'i komırs',
      'fintech': 'fintek',
      'blockchain': 'blokçeyn',
      'cryptocurrency': 'kripto para',
      
      // Common Words
      'software': 'softvır',
      'hardware': 'hardvır',
      'database': 'deytabeys',
      'server': 'sırvır',
      'client': 'klayınt',
      'frontend': 'front end',
      'backend': 'bek end',
      'fullstack': 'ful stak',
      'framework': 'freymvörk',
      'library': 'laybıreri',
      
      // Mobile/OS
      'iPhone': 'Ay Fon',
      'iPad': 'Ay Ped',
      'Android': 'Android',
      'iOS': 'Ay O Es',
      'Windows': 'Vindovs',
      'MacOS': 'Mek O Es',
      'Linux': 'Linuks',
      
      // Web Terms
      'website': 'veb sayt',
      'browser': 'bravzır',
      'Chrome': 'Krom',
      'Firefox': 'Fayr Foks',
      'Safari': 'Safari',
      
      // User Interface
      'login': 'login',
      'logout': 'logavt',
      'signup': 'sayn ap',
      'dashboard': 'deşbord',
      'profile': 'profayl',
      'settings': 'setings',
      'notifications': 'notifikeyşıns',
      
      // File/Data
      'download': 'davnlod',
      'upload': 'aplod',
      'backup': 'bekap',
      'sync': 'sink',
      'cache': 'keş',
      'cookie': 'kuki',
      
      // Testing/Tools
      'test': 'test',
      'debug': 'dibag',
      'deploy': 'diploy',
      'build': 'bild',
      'compile': 'kompayl',
      'npm': 'En Pi Em',
      'yarn': 'Yarn'
    };

    let normalizedText = text;
    
    // Apply phonetic mapping
    for (const [english, turkish] of Object.entries(phoneticMap)) {
      const regex = new RegExp(`\\b${english}\\b`, 'gi');
      normalizedText = normalizedText.replace(regex, turkish);
    }
    
    return normalizedText;
  }

  private enhanceTextForNaturalSpeech(text: string, language: string = 'tr'): string {
    // Detect mixed language content
    const languageAnalysis = this.detectMixedLanguage(text);
    
    let enhancedText = text;
    
    // Apply different strategies based on language detection
    if (languageAnalysis.primaryLanguage === 'mixed') {
      // For mixed content, use aggressive phonetic normalization
      enhancedText = this.normalizeEnglishTerms(text);
      // Add extra pauses around English terms for clarity
      enhancedText = enhancedText.replace(/\b(Eyi Pi Ay|Ci Pi Ti|Git Hab|React|Docker)\b/g, '... $1 ...');
    } else if (language === 'tr') {
      // For Turkish with some English terms
      enhancedText = this.normalizeEnglishTerms(text);
    } else {
      // For pure foreign languages, minimal processing
      enhancedText = text;
    }
    
    // Add natural pauses after sentences and punctuation
    enhancedText = enhancedText
      // Add longer pause after sentences
      .replace(/([.!?])\s+/g, '$1... ')
      // Add medium pause after commas
      .replace(/,\s+/g, ', ')
      // Add short pause after colons and semicolons  
      .replace(/([;:])\s+/g, '$1. ')
      // Ensure proper spacing around numbers
      .replace(/(\d+)\s*([a-zA-ZçğıöşüÇĞIİÖŞÜ])/g, '$1 $2');

    // Split into sentences for better prosody
    const sentences = enhancedText.split(/([.!?])/);
    const processedSentences = [];
    
    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i];
      const punctuation = sentences[i + 1] || '';
      
      if (sentence && sentence.trim()) {
        // Add natural breathing pause between sentences
        processedSentences.push(sentence.trim() + punctuation + (punctuation ? '...' : ''));
      }
    }
    
    return processedSentences.join(' ');
  }

  async generateAudio(options: PiperTTSOptions): Promise<ArrayBuffer> {
        const {
      text,
      voice,
      language = "tr",
      speakingRate = 1.0,
      lengthScale = 1.1, // Slightly slower for more natural speech
      noiseScale = 0.667, // Add slight randomness for naturalness
      noiseW = 0.8 // Slight prosody variation
    } = options;
    
    // Auto-select voice based on language if not specified
    const selectedVoice = voice || this.getVoiceForLanguage(language);
    
    // Enhance text for more natural speech
    const enhancedText = this.enhanceTextForNaturalSpeech(text, language);
    
    logger.debug({ 
      originalText: text, 
      enhancedText, 
      voice: selectedVoice,
      language,
      speakingRate, 
      lengthScale 
    }, "Generating enhanced audio with Piper TTS");

    // Try each URL until one works
    for (const url of this.fallbackUrls) {
      try {
        logger.debug({ url }, "Trying Piper TTS server");
        
        const requestData = {
          text: enhancedText,
          voice: selectedVoice,
          speaker_id: 0,
          length_scale: lengthScale,
          noise_scale: noiseScale,
          noise_w: noiseW
        };
        
        const response = await axios.post(
          `${url}/tts`,
          requestData,
          {
            responseType: "arraybuffer",
            timeout: 15000, // Increased timeout for larger models
          }
        );

        if (response.status === 200) {
          logger.debug(
            { 
              originalText: text,
              enhancedText, 
              voice, 
              audioSize: response.data.byteLength, 
              url,
              speakingRate,
              lengthScale
            },
            "Enhanced audio generated successfully with Piper TTS"
          );
          // Update serverUrl to working one for future requests
          this.serverUrl = url;
          return response.data;
        }
      } catch (error: any) {
        logger.warn({ error: error.message, url }, "Failed to connect to Piper TTS server, trying next URL");
        continue;
      }
    }

    // If all URLs failed, throw error
    const error = new Error(`All Piper TTS servers failed. Tried: ${this.fallbackUrls.join(', ')}`);
    logger.error({ error, options }, "Error generating audio with Piper TTS");
    throw error;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.serverUrl}/health`);
      return response.status === 200;
    } catch (error) {
      logger.error({ error }, "Piper TTS health check failed");
      return false;
    }
  }

  getAvailableVoices(): Record<string, string[]> {
    return {
      "tr": [
        "tr_TR-dfki-medium", // Turkish - DFKI - Medium quality
        "tr_TR-dfki-low",    // Turkish - DFKI - Low quality
        "tr_TR-dfki-high",   // Turkish - DFKI - High quality
      ],
      "en": [
        "en_US-ljspeech-medium", // English - LJ Speech - Medium quality
        "en_US-ljspeech-high",   // English - LJ Speech - High quality
        "en_GB-alba-medium",     // British English - Alba - Medium
      ],
      "de": [
        "de_DE-thorsten-medium", // German - Thorsten - Medium quality
        "de_DE-thorsten-high",   // German - Thorsten - High quality
      ],
      "fr": [
        "fr_FR-upmc-medium",     // French - UPMC - Medium quality
        "fr_FR-siwis-medium",    // French - SiwiS - Medium quality
      ],
      "es": [
        "es_ES-sharvard-medium", // Spanish - Sharvard - Medium quality
        "es_MX-claude-high",     // Mexican Spanish - Claude - High
      ],
      "it": [
        "it_IT-riccardo-medium", // Italian - Riccardo - Medium quality
      ],
      "ru": [
        "ru_RU-dmitri-medium",   // Russian - Dmitri - Medium quality
      ],
      "ar": [
        "ar_JO-kareem-medium",   // Arabic - Kareem - Medium quality
      ],
      "zh": [
        "zh_CN-huayan-medium",   // Chinese - Huayan - Medium quality
      ],
      "ja": [
        "ja_JP-hiroshiba-medium", // Japanese - Hiroshiba - Medium
      ]
    };
  }

  getVoiceForLanguage(language: string): string {
    const voices = this.getAvailableVoices();
    const langVoices = voices[language] || voices["en"]; // Fallback to English
    return langVoices[0]; // Return first (usually medium quality)
  }
}

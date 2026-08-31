"use client";

import { useState, useEffect, useRef } from "react";
import { X, Mic, MicOff, Send, Bot, ExternalLink, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/translations";

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  videoId?: string | null;
  /** Offered instead of an embed when nothing relevant was embeddable. */
  searchUrl?: string | null;
};

/**
 * `craftType` comes from the dashboard, which already holds the artisan's
 * profile. It used to be hardcoded to 'Pattachitra' for every user, so a
 * Banarasi weaver was asking about — and being shown videos of — someone
 * else's craft.
 */
export function LearningAssistantModal({
  isOpen,
  onClose,
  craftType,
}: {
  isOpen: boolean;
  onClose: () => void;
  craftType?: string | null;
}) {
  const { t, language } = useLanguage();
  const craft = (craftType || '').trim() || t('your_craft');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Seeded here rather than in useState so the greeting names the artisan's
  // real craft once the dashboard has handed it down.
  useEffect(() => {
    if (!isOpen) return;
    const kickoff = setTimeout(() => {
      setMessages((prev) =>
        prev.length > 0 ? prev : [{ role: 'assistant', text: `${t('learn_greeting')} ${craft}?` }]
      );
    }, 0);
    return () => clearTimeout(kickoff);
  }, [isOpen, craft, t]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;

        recognition.onresult = (event: any) => {
          let currentTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            currentTranscript += event.results[i][0].transcript;
          }
          setInput(currentTranscript);
        };

        recognition.onend = () => setIsListening(false);
        recognition.onerror = () => setIsListening(false);
        
        recognitionRef.current = recognition;
      }
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert(t('speech_unsupported'));
      return;
    }
    
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setInput("");
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error(e);
        setIsListening(false);
      }
    }
  };

  if (!isOpen) return null;

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch('/api/artisan/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, craftType: craft, language })
      });
      const data = await res.json();
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: data.reply || t('chat_no_answer'),
        videoId: data.videoId ?? null,
        searchUrl: data.searchUrl ?? null,
      }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: t('chat_network_error') }]);
    }
    
    setIsTyping(false);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 animate-fade-in-up">
      <div className="bg-white w-full sm:max-w-md h-[85vh] sm:h-[600px] sm:rounded-3xl flex flex-col shadow-2xl rounded-t-3xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#24332C] text-white px-6 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Bot size={20} />
            </div>
            <div>
              <h2 className="font-bold text-lg leading-tight">{t('learn_and_grow')}</h2>
              <p className="text-xs text-white/70">Powered by Gemini</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50 flex flex-col gap-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl p-4 ${msg.role === 'user' ? 'bg-[#3D624F] text-white rounded-tr-none' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'}`}>
                <p className="text-sm leading-relaxed">{msg.text}</p>
                
                {/* A relevant embeddable tutorial, or a search link when there
                    was none — never a random unrelated embed. */}
                {!msg.videoId && msg.searchUrl && msg.role === 'assistant' && (
                  <a
                    href={msg.searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#3D624F] hover:underline"
                  >
                    {t('search_on_youtube')} <ExternalLink size={12} />
                  </a>
                )}

                {msg.videoId && (
                  <div className="mt-4 rounded-xl overflow-hidden border border-gray-100 shadow-sm bg-black aspect-video relative group cursor-pointer">
                    <iframe 
                      width="100%" 
                      height="100%" 
                      src={`https://www.youtube.com/embed/${msg.videoId}?controls=1`} 
                      title="YouTube video player" 
                      frameBorder="0" 
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                      allowFullScreen
                      className="absolute inset-0"
                    ></iframe>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
               <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-none p-4 shadow-sm flex items-center gap-2">
                 <Loader2 size={16} className="animate-spin text-[#3D624F]" />
                 <span className="text-sm text-gray-500 font-medium">{t('typing')}</span>
               </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-gray-100 flex items-center gap-2 shrink-0">
          <button 
            onClick={toggleListening}
            className={`p-3 rounded-full transition-colors shrink-0 ${
              isListening 
                ? 'bg-red-100 text-red-600 animate-pulse' 
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t('chat_placeholder')} 
            className="flex-1 bg-gray-50 border border-gray-200 rounded-full px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3D624F] focus:border-transparent"
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-3 rounded-full bg-[#24332C] text-white hover:bg-[#1a2520] transition-colors shrink-0 disabled:opacity-50"
          >
            <Send size={18} className="ml-1" />
          </button>
        </div>

      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Globe, MessageSquare, Send, X } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const LANGUAGES = ['English', 'हिन्दी (Hindi)', 'Hinglish'] as const;

const QUICK_PROMPTS: Record<string, string[]> = {
  English: [
    'How do I use HimRudra Shilajit Resin?',
    'What is the price and shipping policy?',
    'Tell me about batch lab testing.',
  ],
  'हिन्दी (Hindi)': [
    'हिमरुद्रा शिलाजीत रेज़िन का उपयोग कैसे करें?',
    'इसकी कीमत और डिलीवरी शुल्क क्या है?',
    'बैच लैब रिपोर्ट के बारे में बताएं।',
  ],
  Hinglish: [
    'HimRudra Shilajit Resin kaise use karna hai?',
    '20g jar ka price aur shipping kitna hai?',
    'Batch lab report kaise check kar sakte hain?',
  ],
};

export const SupportChatbot: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>('English');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Namaste. I am the HimRudra Ritual & Quality Concierge. Ask me about our 20 g Himalayan Shilajit Resin, usage guidance, batch lab reports, or shipping.',
    },
  ]);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;

    const nextHistory = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          language,
          history: nextHistory.slice(-6),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.error || 'Unable to connect to support assistant right now.',
          },
        ]);
        return;
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Network error while reaching the HimRudra support server.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="himrudra-floating-action fixed bottom-18 lg:bottom-6 right-3 sm:right-5 z-40">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open HimRudra AI Support Concierge"
          className="inline-flex h-11 w-11 sm:h-auto sm:w-auto items-center justify-center sm:gap-2.5 rounded-full bg-[#281A15] border border-[#C69B51]/45 sm:px-5 sm:py-3 text-xs font-semibold text-[#FAF8F4] shadow-xl hover:bg-[#3A2720] transition-transform hover:-translate-y-0.5"
        >
          <MessageSquare className="h-4 w-4 text-[#C69B51]" />
          <span className="hidden sm:inline">Ritual Concierge</span>
        </button>
      ) : (
        <div
          role="dialog"
          aria-label="HimRudra Multilingual Support Concierge"
          className="himrudra-chat-panel w-[min(340px,calc(100vw-1.5rem))] sm:w-[385px] rounded-2xl border border-[#79543D]/25 bg-[#FAF8F4] shadow-2xl overflow-hidden flex flex-col max-h-[min(520px,calc(100dvh-7.5rem))]"
        >
          {/* Header */}
          <div className="bg-[#281A15] text-[#FAF8F4] px-4 py-3.5 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-semibold leading-none">
                HimRudra Concierge
              </h3>
              <p className="text-[11px] text-[#C69B51] mt-1">
                Multilingual Product & Quality Guide
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close support chat"
              className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-[#FAF8F4]/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Language Selector */}
          <div className="bg-[#F3EDE5] border-b border-[#79543D]/15 px-3.5 py-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#79543D] font-medium">
              <Globe className="h-3.5 w-3.5" />
              <span>Language</span>
            </span>
            <div className="flex gap-1">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    language === lang
                      ? 'bg-[#281A15] text-[#FAF8F4]'
                      : 'text-[#281A15]/75 hover:bg-[#FAF8F4]'
                  }`}
                >
                  {lang.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-[#281A15] text-[#FAF8F4]'
                      : 'bg-[#F3EDE5] text-[#241B17] border border-[#79543D]/15'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="text-[11px] text-[#79543D] italic">Concierge is typing...</div>
            )}

            {/* Quick Prompt Buttons */}
            <div className="pt-2 flex flex-wrap gap-1.5">
              {(QUICK_PROMPTS[language] || QUICK_PROMPTS.English).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendMessage(q)}
                  className="rounded-lg border border-[#79543D]/25 bg-[#FAF8F4] px-2.5 py-1.5 text-left text-[11px] text-[#281A15] hover:bg-[#F3EDE5]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
            className="border-t border-[#79543D]/15 bg-[#FAF8F4] p-2.5 flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask in English, Hindi, or Hinglish..."
              aria-label="Chat message"
              className="flex-1 rounded-lg border border-[#79543D]/30 bg-[#FAF8F4] px-3 py-2 text-xs focus:border-[#281A15] focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="h-9 w-9 rounded-lg bg-[#281A15] text-[#FAF8F4] flex items-center justify-center disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

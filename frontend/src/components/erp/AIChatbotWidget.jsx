import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageCircle, X, Send, Bot, User, Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { IconButton } from './IconButton';

const API = process.env.REACT_APP_BACKEND_URL;

const SUGGESTIONS = [
  'Berapa output hari ini?',
  'Tampilkan WO yang overdue',
  'Apa QC fail rate minggu ini?',
  'Berapa downtime mesin hari ini?',
];

export default function AIChatbotWidget({ headers, user }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `chat-${(user?.id || 'u')?.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`);
  const bottomRef = useRef(null);

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { if (open) scrollToBottom(); }, [messages, open]);

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/api/rahaza/ai/history`, { headers, params: { session_id: sessionId } });
      setMessages(data.messages || []);
    } catch (e) {}
  }, [headers, sessionId]);

  useEffect(() => { if (open && messages.length === 0) loadHistory(); }, [open, loadHistory, messages.length]);

  const sendMessage = async (text) => {
    const msg = text || input.trim();
    if (!msg) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, created_at: new Date().toISOString() }]);
    setLoading(true);
    try {
      const { data } = await axios.post(`${API}/api/rahaza/ai/chat`, { message: msg, session_id: sessionId }, { headers });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, created_at: data.created_at }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Maaf, AI tidak dapat merespons saat ini.', created_at: new Date().toISOString() }]);
    } finally { setLoading(false); }
  };

  const clearChat = () => setMessages([]);

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(o => !o)}
        data-testid="ai-chat-toggle"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
      >
        <AnimatePresence mode="wait">
          {open
            ? <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}><X className="w-6 h-6 text-primary-foreground" /></motion.div>
            : <motion.div key="chat" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}><MessageCircle className="w-6 h-6 text-primary-foreground" /></motion.div>
          }
        </AnimatePresence>
      </button>

      {/* Chat Window */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 shadow-2xl rounded-2xl border bg-background overflow-hidden"
            data-testid="ai-chat-window"
          >
            {/* Header */}
            <div className="bg-primary px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary-foreground" />
                <span className="font-semibold text-primary-foreground text-sm">Asisten ERP Triyasa</span>
              </div>
              <div className="flex gap-1">
                <IconButton label="Hapus riwayat chat" onClick={clearChat} className="text-primary-foreground/70 hover:text-primary-foreground p-1" data-testid="ai-chat-clear"><RefreshCw className="w-3.5 h-3.5" /></IconButton>
                <IconButton label="Tutup chat" onClick={() => setOpen(false)} className="text-primary-foreground/70 hover:text-primary-foreground p-1" data-testid="ai-chat-close"><ChevronDown className="w-4 h-4" /></IconButton>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="h-72">
              <div className="p-3 space-y-3">
                {messages.length === 0 && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <Bot className="w-6 h-6 text-primary mt-0.5 flex-shrink-0" />
                      <div className="bg-muted rounded-xl rounded-tl-sm p-3 text-sm">
                        Halo! Saya asisten ERP Triyasa. Tanyakan apa saja tentang produksi, QC, atau operasional.
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground px-2">Saran pertanyaan:</p>
                    {SUGGESTIONS.map(s => (
                      <button key={s} onClick={() => sendMessage(s)} className="text-xs bg-muted/50 hover:bg-muted px-3 py-1.5 rounded-full text-left w-full transition-colors">{s}</button>
                    ))}
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex items-start gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    {msg.role === 'assistant'
                      ? <Bot className="w-6 h-6 text-primary mt-0.5 flex-shrink-0" />
                      : <User className="w-6 h-6 text-muted-foreground mt-0.5 flex-shrink-0" />
                    }
                    <div className={`max-w-[80%] rounded-xl p-3 text-sm whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-muted rounded-tl-sm'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-start gap-2">
                    <Bot className="w-6 h-6 text-primary mt-0.5" />
                    <div className="bg-muted rounded-xl rounded-tl-sm p-3">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="border-t p-3 flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Tanya sesuatu..."
                className="text-sm"
                disabled={loading}
              />
              <Button size="icon" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

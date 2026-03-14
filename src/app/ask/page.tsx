'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getDb } from '@/lib/firebase';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { Send, Brain, User as UserIcon, Play, Video, Sparkles, Clock, X, FileVideo } from 'lucide-react';

interface Source {
  documentName: string;
  documentId: string;
  timestamp: string;
  score: number;
  text: string;
  // Enriched fields from API
  title?: string;
  storageUrl?: string | null;
  thumbnailUrl?: string | null;
  timestampSeconds?: number | null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  timestamp: Date;
}

/** Format seconds into MM:SS or H:MM:SS */
function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AskPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Auto-seek video when source modal opens
  const handleVideoReady = useCallback(() => {
    if (videoRef.current && selectedSource?.timestampSeconds != null) {
      videoRef.current.currentTime = selectedSource.timestampSeconds;
      videoRef.current.play().catch(() => {/* autoplay may be blocked */});
    }
  }, [selectedSource]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || loading || !user) return;

    const userMsg: Message = {
      id: Math.random().toString(36).slice(2),
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      // Fetch recordings map from Firestore (client SDK, already authenticated)
      // This provides title/storageUrl/thumbnailUrl data for source enrichment
      let recordingsMap: Record<string, { title?: string; storageUrl?: string; thumbnailUrl?: string }> = {};
      try {
        const recRef = collection(getDb(), 'recordings');
        const recQuery = query(recRef, where('userId', '==', user.uid));
        const recSnap = await getDocs(recQuery);
        recSnap.docs.forEach((d) => {
          const data = d.data();
          const recInfo = {
            title: data.title || undefined,
            storageUrl: data.storageUrl || undefined,
            thumbnailUrl: data.thumbnailUrl || undefined,
          };
          // Key by ragieDocumentId for direct match
          if (data.ragieDocumentId) {
            recordingsMap[data.ragieDocumentId] = recInfo;
          }
          // Also key by fileName for fallback match (Ragie chunk documentId may differ)
          if (data.fileName) {
            recordingsMap[`fn:${data.fileName}`] = recInfo;
          }
        });
      } catch (err) {
        console.error('Recordings map fetch error (non-fatal):', err);
      }

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          userId: user.uid,
          recordingsMap,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to get answer');
      }

      const data = await response.json();

      const assistantMsg: Message = {
        id: Math.random().toString(36).slice(2),
        role: 'assistant',
        content: data.answer,
        sources: data.sources || [],
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Save query to Firestore
      try {
        await addDoc(collection(getDb(), 'queries'), {
          userId: user.uid,
          question,
          answer: data.answer,
          sources: data.sources || [],
          createdAt: new Date().toISOString(),
        });
      } catch {
        // Non-critical — don't block UI
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      const errorMsg: Message = {
        id: Math.random().toString(36).slice(2),
        role: 'assistant',
        content: `Error: ${errMsg}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const autoResize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  };

  // Parse [Source N] references in text
  const renderContent = (content: string) => {
    const parts = content.split(/(\[Source \d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[Source (\d+)\]/);
      if (match) {
        return (
          <span
            key={i}
            style={{
              color: 'var(--accent)',
              fontWeight: 600,
              cursor: 'pointer',
              borderBottom: '1px dashed var(--accent)',
            }}
            title="Click to view source"
          >
            {part}
          </span>
        );
      }
      // Render code blocks
      if (part.includes('```')) {
        const codeBlocks = part.split(/(```[\s\S]*?```)/g);
        return codeBlocks.map((block, j) => {
          if (block.startsWith('```')) {
            const code = block.replace(/```\w*\n?/, '').replace(/```$/, '');
            return (
              <pre key={`${i}-${j}`} style={{
                background: 'var(--bg-elevated)',
                padding: 'var(--space-md)',
                borderRadius: 'var(--radius-md)',
                overflow: 'auto',
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                margin: '8px 0',
              }}>
                <code>{code}</code>
              </pre>
            );
          }
          return <span key={`${i}-${j}`}>{block}</span>;
        });
      }

      // Split by newlines for proper paragraph rendering
      return part.split('\n').map((line, j) => (
        <React.Fragment key={`${i}-${j}`}>
          {j > 0 && <br />}
          {line}
        </React.Fragment>
      ));
    });
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>
          <Sparkles size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, color: 'var(--accent)' }} />
          Ask VisualBrain
        </h1>
        <p className="page-subtitle" style={{ marginTop: 4 }}>
          Query your video recordings with natural language
        </p>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state" style={{ flex: 1 }}>
            <Brain size={56} style={{ color: 'var(--accent)', opacity: 0.3 }} />
            <h3>What do you want to find?</h3>
            <p>Ask anything about your Google Meet recordings. I&apos;ll search through both the audio transcripts and visual screen content.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', width: '100%', maxWidth: 420 }}>
              {[
                'How did we implement the auth middleware?',
                'What was discussed about the database schema?',
                'Show me the code review feedback from last week',
              ].map((q) => (
                <button
                  key={q}
                  className="card card-interactive"
                  style={{
                    textAlign: 'left',
                    fontSize: 13,
                    padding: 'var(--space-sm) var(--space-md)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setInput(q);
                    textareaRef.current?.focus();
                  }}
                >
                  &ldquo;{q}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message chat-message-${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="message-avatar ai">
                <Brain size={16} />
              </div>
            )}
            <div className="message-content">
              {renderContent(msg.content)}

              {/* Source References */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="source-references">
                  <h4>📹 Video Sources</h4>
                  {msg.sources.map((src, i) => (
                    <button
                      key={i}
                      className="source-card"
                      onClick={() => setSelectedSource(src)}
                    >
                      <div className="play-icon">
                        <Play size={12} />
                      </div>
                      <div className="source-info">
                        <div className="source-title">{src.title || src.documentName}</div>
                        <div className="source-timestamp">
                          {src.timestampSeconds != null
                            ? <><Clock size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{formatTimestamp(src.timestampSeconds)}</>
                            : src.timestamp || 'Full recording'
                          }
                        </div>
                      </div>
                      <span className="badge badge-ready" style={{ fontSize: 10 }}>
                        {(src.score * 100).toFixed(0)}%
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="message-avatar user">
                <UserIcon size={16} />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="chat-message">
            <div className="message-avatar ai">
              <Brain size={16} />
            </div>
            <div className="message-content">
              <div className="loading-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-container">
        <form className="chat-input-wrapper" onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoResize(); }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your recordings..."
            rows={1}
            disabled={loading}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={!input.trim() || loading}
          >
            <Send size={18} />
          </button>
        </form>
      </div>

      {/* Source Video Player Modal */}
      {selectedSource && (
        <div className="modal-overlay" onClick={() => setSelectedSource(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, width: '90vw' }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, flex: 1, overflow: 'hidden' }}>
                <Video size={18} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedSource.title || selectedSource.documentName}
                </span>
              </h2>
              <button className="btn btn-icon btn-ghost" onClick={() => setSelectedSource(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {/* Video player or fallback */}
              {selectedSource.storageUrl ? (
                <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#000', marginBottom: 'var(--space-md)' }}>
                  <video
                    ref={videoRef}
                    controls
                    src={selectedSource.storageUrl}
                    poster={selectedSource.thumbnailUrl || undefined}
                    style={{ width: '100%', maxHeight: 360, display: 'block' }}
                    preload="auto"
                    onLoadedData={handleVideoReady}
                  >
                    Your browser does not support video playback.
                  </video>
                </div>
              ) : (
                <div style={{
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-elevated)',
                  border: '1px dashed var(--border)',
                  height: 120,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-md)',
                  fontSize: 13,
                }}>
                  <FileVideo size={28} />
                  <span>Video not available — re-upload to enable playback</span>
                </div>
              )}

              {/* Badges */}
              <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
                <span className="badge badge-ready">
                  Relevance: {(selectedSource.score * 100).toFixed(0)}%
                </span>
                {selectedSource.timestampSeconds != null && (
                  <span className="badge" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                    <Clock size={10} /> {formatTimestamp(selectedSource.timestampSeconds)}
                  </span>
                )}
              </div>

              {/* Source chunk text */}
              <div className="card" style={{ background: 'var(--bg-elevated)' }}>
                <div className="input-label" style={{ marginBottom: 8 }}>Relevant Content</div>
                <div style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {selectedSource.text}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

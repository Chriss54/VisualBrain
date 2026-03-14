'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getDb } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Video, MessageSquare, Clock, Activity, Upload, ArrowRight, Lightbulb } from 'lucide-react';
import Link from 'next/link';

/** Simple count-up animation hook */
function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target === prevTarget.current) return;
    prevTarget.current = target;
    if (target === 0) { setValue(0); return; }

    const start = performance.now();
    const from = 0;

    function animate(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }, [target, duration]);

  return value;
}

interface Recording {
  id: string;
  fileName: string;
  title?: string;
  status: string;
  createdAt: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ recordings: 0, queries: 0, ready: 0, processing: 0, ideas: 0 });
  const [recentRecordings, setRecentRecordings] = useState<Recording[]>([]);

  // Animated counters
  const animRecordings = useCountUp(stats.recordings);
  const animReady = useCountUp(stats.ready);
  const animProcessing = useCountUp(stats.processing);
  const animQueries = useCountUp(stats.queries);
  const animIdeas = useCountUp(stats.ideas);

  useEffect(() => {
    if (!user) return;

    async function loadData() {
      try {
        // Load recordings — no orderBy to avoid requiring a composite Firestore index
        const recRef = collection(getDb(), 'recordings');
        const recQuery = query(recRef, where('userId', '==', user!.uid));
        const recSnap = await getDocs(recQuery);
        const allRecs = recSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Recording));

        // Sort client-side: newest first, take top 5
        allRecs.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
        const recs = allRecs.slice(0, 5);
        setRecentRecordings(recs);

        const readyCount = allRecs.filter((r) => r.status === 'ready').length;
        const processingCount = allRecs.filter((r) =>
          r.status === 'processing' || r.status === 'uploading'
        ).length;

        // Load query count
        const qRef = collection(getDb(), 'queries');
        const qQuery = query(qRef, where('userId', '==', user!.uid));
        const qSnap = await getDocs(qQuery);

        // Load ideas count
        const iRef = collection(getDb(), 'ideas');
        const iQuery = query(iRef, where('userId', '==', user!.uid));
        const iSnap = await getDocs(iQuery);

        setStats({
          recordings: allRecs.length,
          queries: qSnap.size,
          ready: readyCount,
          processing: processingCount,
          ideas: iSnap.size,
        });
      } catch (err) {
        console.error('Dashboard load error:', err);
      }
    }

    loadData();
  }, [user]);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">
          {greeting()}, {user?.displayName?.split(' ')[0] || 'there'}
        </h1>
        <p className="page-subtitle">Your video knowledge base at a glance</p>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon red">
            <Video size={20} />
          </div>
          <div className="stat-value">{animRecordings}</div>
          <div className="stat-label">Total Recordings</div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <Activity size={20} />
          </div>
          <div className="stat-value">{animReady}</div>
          <div className="stat-label">Ready to Query</div>
        </div>

        <div className="stat-card">
          <div className="stat-icon yellow">
            <Clock size={20} />
          </div>
          <div className="stat-value">{animProcessing}</div>
          <div className="stat-label">Processing</div>
        </div>

        <div className="stat-card">
          <div className="stat-icon blue">
            <MessageSquare size={20} />
          </div>
          <div className="stat-value">{animQueries}</div>
          <div className="stat-label">Questions Asked</div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)' }}>
            <Lightbulb size={20} style={{ color: '#f59e0b' }} />
          </div>
          <div className="stat-value">{animIdeas}</div>
          <div className="stat-label">Ideas</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <Link href="/upload" className="card card-interactive" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div className="stat-icon red" style={{ flexShrink: 0 }}>
            <Upload size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Upload Recording</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Add a new Google Meet video</div>
          </div>
          <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
        </Link>

        <Link href="/ask" className="card card-interactive" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div className="stat-icon blue" style={{ flexShrink: 0 }}>
            <MessageSquare size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Ask a Question</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Query your video knowledge base</div>
          </div>
          <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
        </Link>

        <Link href="/ideas" className="card card-interactive" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div className="stat-icon" style={{ flexShrink: 0, backgroundColor: 'rgba(245, 158, 11, 0.15)' }}>
            <Lightbulb size={20} style={{ color: '#f59e0b' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>New Idea</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Capture an improvement idea</div>
          </div>
          <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
        </Link>
      </div>

      {/* Recent Recordings */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Recent Recordings</h2>
          <Link href="/library" className="btn btn-ghost btn-sm">
            View all <ArrowRight size={14} />
          </Link>
        </div>

        {recentRecordings.length === 0 ? (
          <div className="empty-state">
            <Video size={48} />
            <h3>No recordings yet</h3>
            <p>Upload your first Google Meet recording to start building your knowledge base.</p>
            <Link href="/upload" className="btn btn-primary">
              <Upload size={16} /> Upload First Video
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {recentRecordings.map((rec) => (
              <div key={rec.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)' }}>
                <Video size={20} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {rec.title || rec.fileName}
                  </div>
                </div>
                <span className={`badge badge-${rec.status}`}>{rec.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

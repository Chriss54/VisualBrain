'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getDb } from '@/lib/firebase';
import { generateSmartTitle } from '@/lib/smart-titles';
import { collection, query, where, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { MessageSquare, Trash2, Calendar, HardDrive, Search, FileVideo, RefreshCw, AlertTriangle, Play, X, Pencil, Check } from 'lucide-react';
import Link from 'next/link';

interface Recording {
  id: string;
  fileName: string;
  title?: string;
  fileSize: number;
  status: string;
  description: string;
  createdAt: string;
  ragieDocumentId: string | null;
  storageUrl: string | null;
  thumbnailUrl: string | null;
}

export default function LibraryPage() {
  const { user } = useAuth();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<Recording | null>(null);
  // Custom delete confirmation state (replaces native confirm() which breaks inside modals)
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');

  const loadRecordings = useCallback(async (): Promise<Recording[]> => {
    if (!user) return [];
    try {
      const recRef = collection(getDb(), 'recordings');
      const recQuery = query(recRef, where('userId', '==', user.uid));
      const snap = await getDocs(recQuery);
      const recs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Recording));
      recs.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      setRecordings(recs);
      return recs;
    } catch (err) {
      console.error('Library load error:', err);
      return [];
    }
  }, [user]);

  const syncPending = useCallback(async (recs: Recording[]) => {
    const pending = recs.filter(
      (r) => r.status === 'processing' || r.status === 'uploading'
    );
    if (pending.length === 0 || !user) return;

    try {
      // Bulk sync: query Ragie for ALL docs in this user's partition,
      // matched by recordingId stored in Ragie metadata.
      // This is robust even when ragieDocumentId is null in Firestore.
      const res = await fetch(`/api/recordings/sync?userId=${encodeURIComponent(user.uid)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Bulk sync API error:', err);
        return;
      }
      const { recordingMap } = await res.json() as {
        recordingMap: Record<string, { ragieDocumentId: string; ragieStatus: string; appStatus: string }>;
      };

      console.log('Sync result:', recordingMap);

      for (const rec of pending) {
        const match = recordingMap[rec.id];
        if (!match) continue;

        if (match.appStatus === 'ready' || match.appStatus === 'error') {
          try {
            await updateDoc(doc(getDb(), 'recordings', rec.id), {
              status: match.appStatus,
              ragieDocumentId: match.ragieDocumentId, // fill in if it was missing
              updatedAt: new Date().toISOString(),
            });
            setRecordings((prev) =>
              prev.map((r) => (r.id === rec.id ? { ...r, status: match.appStatus, ragieDocumentId: match.ragieDocumentId } : r))
            );
            console.log(`Updated ${rec.id} → ${match.appStatus} (Ragie: ${match.ragieStatus})`);
          } catch (err) {
            console.error('Firestore update error for', rec.id, err);
          }
        }
      }
    } catch (err) {
      console.error('syncPending error:', err);
    }
  }, [user]);

  // Backfill titles for recordings that don't have one
  const backfillTitles = useCallback(async (recs: Recording[]) => {
    const untitled = recs.filter((r) => !r.title);
    if (untitled.length === 0) return;
    for (const rec of untitled) {
      const title = generateSmartTitle(rec.fileName, rec.createdAt, rec.description);
      try {
        await updateDoc(doc(getDb(), 'recordings', rec.id), { title });
        setRecordings((prev) =>
          prev.map((r) => (r.id === rec.id ? { ...r, title } : r))
        );
      } catch (err) {
        console.error('Backfill title error for', rec.id, err);
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    async function init() {
      const recs = await loadRecordings();
      await syncPending(recs);
      await backfillTitles(recs);
      setLoading(false);
    }
    init();
  }, [user, loadRecordings, syncPending, backfillTitles]);

  const handleManualSync = async () => {
    setSyncing(true);
    const recs = await loadRecordings();
    await syncPending(recs);
    await backfillTitles(recs);
    setSyncing(false);
  };

  const handleCleanupFailed = async () => {
    const orphans = recordings.filter((r) => r.status === 'uploading' && !r.ragieDocumentId);
    if (orphans.length === 0) return;
    for (const r of orphans) {
      await deleteDoc(doc(getDb(), 'recordings', r.id)).catch(console.error);
    }
    setRecordings((prev) => prev.filter((r) => !(r.status === 'uploading' && !r.ragieDocumentId)));
  };

  // Custom delete — called after user confirms in our custom dialog
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.ragieDocumentId) {
        await fetch(`/api/recordings/${deleteTarget.id}?ragieDocId=${deleteTarget.ragieDocumentId}`, {
          method: 'DELETE',
        });
      }
      await deleteDoc(doc(getDb(), 'recordings', deleteTarget.id));
      setRecordings((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      if (selectedVideo?.id === deleteTarget.id) setSelectedVideo(null);
    } catch {
      alert('Failed to delete recording. Please try again.');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Save edited title
  const saveTitle = async () => {
    if (!selectedVideo || !editTitleValue.trim()) return;
    const newTitle = editTitleValue.trim();
    try {
      await updateDoc(doc(getDb(), 'recordings', selectedVideo.id), {
        title: newTitle,
        updatedAt: new Date().toISOString(),
      });
      setRecordings((prev) =>
        prev.map((r) => (r.id === selectedVideo.id ? { ...r, title: newTitle } : r))
      );
      setSelectedVideo({ ...selectedVideo, title: newTitle });
      setEditingTitle(false);
    } catch (err) {
      console.error('Title save error:', err);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoStr: string) => {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const filtered = recordings.filter(
    (r) =>
      r.fileName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const orphanCount = recordings.filter((r) => r.status === 'uploading' && !r.ragieDocumentId).length;

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-3xl)' }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-subtitle">{recordings.length} recording{recordings.length !== 1 ? 's' : ''} in your knowledge base</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          {orphanCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={handleCleanupFailed} style={{ color: 'var(--error)' }}>
              <AlertTriangle size={14} /> Clean up {orphanCount} failed
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleManualSync} disabled={syncing}>
            <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
            {syncing ? 'Syncing…' : 'Sync Status'}
          </button>
        </div>
      </div>

      {/* Search */}
      {recordings.length > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="input-field"
              placeholder="Search recordings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 44 }}
            />
          </div>
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <FileVideo size={48} />
          <h3>{recordings.length === 0 ? 'No recordings yet' : 'No results found'}</h3>
          <p>{recordings.length === 0 ? 'Upload your first Google Meet recording to get started.' : 'Try adjusting your search.'}</p>
          {recordings.length === 0 && <Link href="/upload" className="btn btn-primary">Upload Video</Link>}
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((rec) => (
            <div key={rec.id} className="video-card" onClick={() => setSelectedVideo(rec)} style={{ cursor: 'pointer' }}>
              <div
                className="video-card-thumbnail"
                style={rec.thumbnailUrl ? {
                  backgroundImage: `url(${rec.thumbnailUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                } : undefined}
              >
                {!rec.thumbnailUrl && <FileVideo size={36} style={{ color: 'var(--text-muted)' }} />}
                <div className="play-overlay" style={{ background: rec.thumbnailUrl ? 'rgba(0,0,0,0.45)' : undefined }}>
                  <div className="play-btn">
                    {rec.status === 'ready' ? <Play size={20} /> : (
                      <RefreshCw size={18} style={{ animation: rec.status === 'processing' ? 'spin 1s linear infinite' : 'none' }} />
                    )}
                  </div>
                </div>
              </div>
              <div className="video-card-body">
                <div className="video-card-title" title={rec.title || rec.fileName}>{rec.title || rec.fileName}</div>
                {rec.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {rec.description}
                  </div>
                )}
                <div className="video-card-meta">
                  <span><Calendar size={12} /> {formatDate(rec.createdAt)}</span>
                  <span><HardDrive size={12} /> {formatSize(rec.fileSize)}</span>
                  <span className={`badge badge-${rec.status}`}>{rec.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Video Detail Modal ─── */}
      {selectedVideo && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedVideo(null)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 720, width: '90vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header with editable title */}
            <div className="modal-header">
              {editingTitle ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <input
                    className="input-field"
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                    onFocus={(e) => e.target.select()}
                    autoFocus
                    style={{ fontSize: 15, fontWeight: 600, padding: '6px 10px' }}
                  />
                  <button className="btn btn-icon btn-ghost" onClick={saveTitle} title="Save">
                    <Check size={16} style={{ color: 'var(--success)' }} />
                  </button>
                  <button className="btn btn-icon btn-ghost" onClick={() => setEditingTitle(false)} title="Cancel">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {selectedVideo.title || selectedVideo.fileName}
                  </h2>
                  <button
                    className="btn btn-icon btn-ghost"
                    onClick={() => { setEditTitleValue(selectedVideo.title || selectedVideo.fileName); setEditingTitle(true); }}
                    title="Edit title"
                    style={{ flexShrink: 0 }}
                  >
                    <Pencil size={14} style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
              )}
              <button className="btn btn-icon btn-ghost" onClick={() => { setSelectedVideo(null); setEditingTitle(false); }}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {/* Video player */}
              {selectedVideo.storageUrl ? (
                <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#000', marginBottom: 'var(--space-md)' }}>
                  <video
                    controls
                    src={selectedVideo.storageUrl}
                    poster={selectedVideo.thumbnailUrl || undefined}
                    style={{ width: '100%', maxHeight: 360, display: 'block' }}
                    preload="metadata"
                  >
                    Your browser does not support video playback.
                  </video>
                </div>
              ) : (
                <div style={{
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-elevated)',
                  border: '1px dashed var(--border)',
                  height: 160,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-md)',
                  fontSize: 13,
                }}>
                  <FileVideo size={32} />
                  <span>No video stored — uploaded before Storage was enabled</span>
                  <span style={{ fontSize: 11 }}>Re-upload this video to enable playback</span>
                </div>
              )}

              {/* Metadata */}
              <div className="card" style={{ background: 'var(--bg-elevated)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-md)' }}>
                  <div>
                    <div className="input-label">Status</div>
                    <span className={`badge badge-${selectedVideo.status}`}>{selectedVideo.status}</span>
                  </div>
                  <div>
                    <div className="input-label">Size</div>
                    <div style={{ fontSize: 14 }}>{formatSize(selectedVideo.fileSize)}</div>
                  </div>
                  <div>
                    <div className="input-label">Uploaded</div>
                    <div style={{ fontSize: 14 }}>{formatDate(selectedVideo.createdAt)}</div>
                  </div>
                </div>
                {selectedVideo.description && (
                  <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border)' }}>
                    <div className="input-label">Description</div>
                    <div style={{ fontSize: 14, marginTop: 4 }}>{selectedVideo.description}</div>
                  </div>
                )}
              </div>

              {/* Filename (secondary text) */}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-md)', fontFamily: 'var(--font-mono)' }}>
                {selectedVideo.fileName}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                {selectedVideo.status === 'ready' && (
                  <Link href="/ask" className="btn btn-primary btn-sm" onClick={() => setSelectedVideo(null)}>
                    <MessageSquare size={14} /> Ask about this video
                  </Link>
                )}
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(224,16,32,0.12)', color: 'var(--error)', border: '1px solid rgba(224,16,32,0.25)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(selectedVideo);
                  }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Custom Delete Confirmation Dialog ─── */}
      {deleteTarget && (
        <div
          className="modal-overlay"
          style={{ zIndex: 200 }}
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 440, padding: 'var(--space-xl)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(224,16,32,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Trash2 size={18} style={{ color: 'var(--error)' }} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Delete Recording</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>{deleteTarget.fileName}</strong>?
                  This will remove it from your library and from Ragie.ai. This cannot be undone.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--error)', color: '#fff' }}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Deleting…</> : <><Trash2 size={14} /> Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

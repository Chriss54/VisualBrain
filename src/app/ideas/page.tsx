'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getDb, getStorage } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  Lightbulb,
  Plus,
  Search,
  X,
  Pencil,
  Check,
  Trash2,
  Image as ImageIcon,
  Link as LinkIcon,
  Upload,
} from 'lucide-react';

interface Idea {
  id: string;
  userId: string;
  userName: string;
  title: string;
  description: string;
  screenshots: string[];
  status: 'new' | 'in-progress' | 'done' | 'archived';
  createdAt: string;
  updatedAt: string;
  linkedRecordingId?: string;
}

interface Recording {
  id: string;
  title?: string;
  fileName: string;
}

const STATUS_CONFIG = {
  new: { label: 'New', color: '#3b82f6' },
  'in-progress': { label: 'In Progress', color: '#f59e0b' },
  done: { label: 'Done', color: '#22c55e' },
  archived: { label: 'Archived', color: '#6b7280' },
} as const;

type StatusKey = keyof typeof STATUS_CONFIG;
const STATUSES = Object.keys(STATUS_CONFIG) as StatusKey[];

export default function IdeasPage() {
  const { user } = useAuth();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StatusKey>('all');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);

  // Create form states
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newScreenshots, setNewScreenshots] = useState<File[]>([]);
  const [newScreenshotPreviews, setNewScreenshotPreviews] = useState<string[]>([]);
  const [newLinkedRecording, setNewLinkedRecording] = useState('');
  const [saving, setSaving] = useState(false);

  // Detail modal edit states
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [editDescValue, setEditDescValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const loadIdeas = useCallback(async () => {
    if (!user) return;
    try {
      const ideasRef = collection(getDb(), 'ideas');
      const ideasQuery = query(ideasRef, where('userId', '==', user.uid));
      const snap = await getDocs(ideasQuery);
      const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Idea));
      loaded.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      setIdeas(loaded);
    } catch (err) {
      console.error('Load ideas error:', err);
    }
  }, [user]);

  const loadRecordings = useCallback(async () => {
    if (!user) return;
    try {
      const recRef = collection(getDb(), 'recordings');
      const recQuery = query(recRef, where('userId', '==', user.uid));
      const snap = await getDocs(recQuery);
      setRecordings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Recording)));
    } catch (err) {
      console.error('Load recordings error:', err);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    async function init() {
      await Promise.all([loadIdeas(), loadRecordings()]);
      setLoading(false);
    }
    init();
  }, [user, loadIdeas, loadRecordings]);

  // Filter ideas
  const filteredIdeas = ideas.filter((idea) => {
    const matchesStatus = statusFilter === 'all' || idea.status === statusFilter;
    const matchesSearch =
      !searchQuery ||
      idea.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      idea.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // Handle screenshot file selection for create modal
  const handleScreenshotSelect = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).slice(0, 5 - newScreenshots.length);
    const validFiles = newFiles.filter(
      (f) => f.type.startsWith('image/') && f.size <= 5 * 1024 * 1024
    );
    setNewScreenshots((prev) => [...prev, ...validFiles]);
    // Generate previews
    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setNewScreenshotPreviews((prev) => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeNewScreenshot = (index: number) => {
    setNewScreenshots((prev) => prev.filter((_, i) => i !== index));
    setNewScreenshotPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  // Create new idea
  const handleCreate = async () => {
    if (!user || !newTitle.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const ideaData = {
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown',
        title: newTitle.trim(),
        description: newDescription.trim(),
        screenshots: [] as string[],
        status: 'new' as const,
        createdAt: now,
        updatedAt: now,        linkedRecordingId: newLinkedRecording || undefined,
      };

      const docRef = await addDoc(collection(getDb(), 'ideas'), ideaData);

      // Upload screenshots
      if (newScreenshots.length > 0) {
        const urls: string[] = [];
        for (let i = 0; i < newScreenshots.length; i++) {
          const file = newScreenshots[i];
          const storageRef = ref(getStorage(), `ideas/${docRef.id}/${Date.now()}_${file.name}`);
          await uploadBytes(storageRef, file);
          const url = await getDownloadURL(storageRef);
          urls.push(url);
        }
        await updateDoc(doc(getDb(), 'ideas', docRef.id), { screenshots: urls });
        ideaData.screenshots = urls;
      }

      setIdeas((prev) => [{ id: docRef.id, ...ideaData }, ...prev]);
      resetCreateForm();
      setShowCreateModal(false);
    } catch (err) {
      console.error('Create idea error:', err);
    } finally {
      setSaving(false);
    }
  };

  const resetCreateForm = () => {
    setNewTitle('');
    setNewDescription('');
    setNewScreenshots([]);
    setNewScreenshotPreviews([]);
    setNewLinkedRecording('');
  };

  // Update idea field
  const updateIdea = async (ideaId: string, updates: Partial<Idea>) => {
    try {
      await updateDoc(doc(getDb(), 'ideas', ideaId), {
        ...updates,
        updatedAt: new Date().toISOString(),
      });
      setIdeas((prev) =>
        prev.map((i) => (i.id === ideaId ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i))
      );
      if (selectedIdea?.id === ideaId) {
        setSelectedIdea((prev) => (prev ? { ...prev, ...updates, updatedAt: new Date().toISOString() } : prev));
      }
    } catch (err) {
      console.error('Update idea error:', err);
    }
  };

  // Save title
  const saveTitle = async () => {
    if (!selectedIdea || !editTitleValue.trim()) return;
    await updateIdea(selectedIdea.id, { title: editTitleValue.trim() });
    setEditingTitle(false);
  };

  // Save description
  const saveDescription = async () => {
    if (!selectedIdea) return;
    await updateIdea(selectedIdea.id, { description: editDescValue.trim() });
    setEditingDescription(false);
  };

  // Delete idea
  const handleDelete = async () => {
    if (!selectedIdea) return;
    try {
      // Delete screenshots from Storage
      for (const url of selectedIdea.screenshots) {
        try {
          const storageRef = ref(getStorage(), url);
          await deleteObject(storageRef);
        } catch {
          // Screenshot may already be deleted
        }
      }
      await deleteDoc(doc(getDb(), 'ideas', selectedIdea.id));
      setIdeas((prev) => prev.filter((i) => i.id !== selectedIdea.id));
      setSelectedIdea(null);
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error('Delete idea error:', err);
    }
  };

  // Add screenshot to existing idea
  const handleAddScreenshot = async (files: FileList | null) => {
    if (!files || !selectedIdea) return;
    if (selectedIdea.screenshots.length >= 5) return;
    setUploadingScreenshot(true);
    try {
      const file = files[0];
      if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return;
      const storageRef = ref(getStorage(), `ideas/${selectedIdea.id}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      const newScreenshots = [...selectedIdea.screenshots, url];
      await updateIdea(selectedIdea.id, { screenshots: newScreenshots });
    } catch (err) {
      console.error('Add screenshot error:', err);
    } finally {
      setUploadingScreenshot(false);
    }
  };

  const formatDate = (isoStr: string) => {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">
            <Lightbulb size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, color: 'var(--accent)' }} />
            Ideas
          </h1>
          <p className="page-subtitle">Capture and share improvement ideas</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={16} /> New Idea
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="input-field"
              placeholder="Search ideas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setStatusFilter('all')}
          >
            All
          </button>
          {STATUSES.filter(s => s !== 'archived').map((status) => (
            <button
              key={status}
              className={`btn btn-sm ${statusFilter === status ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatusFilter(status)}
              style={statusFilter === status ? {} : { borderColor: STATUS_CONFIG[status].color, color: STATUS_CONFIG[status].color }}
            >
              {STATUS_CONFIG[status].label}
            </button>
          ))}
        </div>
      </div>

      {/* Ideas Grid */}
      {filteredIdeas.length === 0 ? (
        <div className="empty-state">
          <Lightbulb size={48} />
          <h3>{ideas.length === 0 ? 'No ideas yet' : 'No matching ideas'}</h3>
          <p>{ideas.length === 0 ? 'Capture your first improvement idea.' : 'Try adjusting your filters.'}</p>
        </div>
      ) : (
        <div className="ideas-grid">
          {filteredIdeas.map((idea) => (
            <div
              key={idea.id}
              className="card card-interactive idea-card"
              onClick={() => {
                setSelectedIdea(idea);
                setEditTitleValue(idea.title);
                setEditDescValue(idea.description);
              }}
            >
              {/* Screenshot thumbnail */}
              {idea.screenshots.length > 0 && (
                <div className="idea-thumbnail">
                  <img src={idea.screenshots[0]} alt="" />
                  {idea.screenshots.length > 1 && (
                    <span className="idea-screenshot-count">+{idea.screenshots.length - 1}</span>
                  )}
                </div>
              )}
              <div className="idea-card-body">
                <h3 className="idea-card-title">{idea.title}</h3>
                {idea.description && (
                  <p className="idea-card-desc">{idea.description}</p>
                )}
                <div className="idea-card-meta">
                  <span
                    className="badge"
                    style={{
                      backgroundColor: `${STATUS_CONFIG[idea.status].color}22`,
                      color: STATUS_CONFIG[idea.status].color,
                      borderColor: `${STATUS_CONFIG[idea.status].color}44`,
                    }}
                  >
                    {STATUS_CONFIG[idea.status].label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {idea.userName} · {formatDate(idea.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== CREATE MODAL ===== */}
      {showCreateModal && (
        <div className="modal-overlay show" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
          <div
            className="modal-content"
            style={{ maxWidth: 560 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>New Idea</h2>
              <button className="btn btn-icon btn-ghost" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {/* Title */}
              <div className="input-group">
                <label className="input-label">Title *</label>
                <input
                  className="input-field"
                  placeholder="What's your idea?"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="input-group">
                <label className="input-label">Description</label>
                <textarea
                  className="input-field"
                  placeholder="Describe your idea..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={4}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Screenshots */}
              <div className="input-group">
                <label className="input-label">Screenshots ({newScreenshots.length}/5)</label>
                {newScreenshotPreviews.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {newScreenshotPreviews.map((preview, i) => (
                      <div key={i} style={{ position: 'relative', width: 80, height: 60 }}>
                        <img
                          src={preview}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                        />
                        <button
                          className="btn btn-icon btn-ghost"
                          onClick={() => removeNewScreenshot(i)}
                          style={{ position: 'absolute', top: -8, right: -8, width: 20, height: 20, padding: 0, background: 'var(--bg-surface)', borderRadius: '50%', border: '1px solid var(--border)' }}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {newScreenshots.length < 5 && (
                  <label
                    className="dropzone"
                    style={{ padding: 'var(--space-md)', cursor: 'pointer', minHeight: 'auto' }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('active'); }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('active')}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('active'); handleScreenshotSelect(e.dataTransfer.files); }}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => handleScreenshotSelect(e.target.files)}
                    />
                    <ImageIcon size={20} style={{ color: 'var(--text-muted)', marginBottom: 4 }} />
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Drop images or click to browse</span>
                  </label>
                )}
              </div>

              {/* Link to Recording */}
              <div className="input-group">
                <label className="input-label">
                  <LinkIcon size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  Link to Recording (optional)
                </label>
                <select
                  className="input-field"
                  value={newLinkedRecording}
                  onChange={(e) => setNewLinkedRecording(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">None</option>
                  {recordings.map((rec) => (
                    <option key={rec.id} value={rec.id}>
                      {rec.title || rec.fileName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 'var(--space-md)', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!newTitle.trim() || saving}>
                {saving ? <div className="spinner" /> : <><Plus size={14} /> Create Idea</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DETAIL MODAL ===== */}
      {selectedIdea && !lightboxImage && (
        <div className="modal-overlay show" onClick={() => { setSelectedIdea(null); setEditingTitle(false); setEditingDescription(false); setShowDeleteConfirm(false); }}>
          <div
            className="modal-content"
            style={{ maxWidth: 640, maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with editable title */}
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
                  <button className="btn btn-icon btn-ghost" onClick={saveTitle}><Check size={16} style={{ color: 'var(--success)' }} /></button>
                  <button className="btn btn-icon btn-ghost" onClick={() => setEditingTitle(false)}><X size={16} /></button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {selectedIdea.title}
                  </h2>
                  <button className="btn btn-icon btn-ghost" onClick={() => { setEditTitleValue(selectedIdea.title); setEditingTitle(true); }}>
                    <Pencil size={14} style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
              )}
              <button className="btn btn-icon btn-ghost" onClick={() => { setSelectedIdea(null); setEditingTitle(false); setEditingDescription(false); }}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {/* Status selector */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    className={`btn btn-sm ${selectedIdea.status === status ? '' : 'btn-ghost'}`}
                    style={{
                      backgroundColor: selectedIdea.status === status ? `${STATUS_CONFIG[status].color}22` : undefined,
                      color: STATUS_CONFIG[status].color,
                      borderColor: `${STATUS_CONFIG[status].color}44`,
                      fontSize: 12,
                    }}
                    onClick={() => updateIdea(selectedIdea.id, { status })}
                  >
                    {STATUS_CONFIG[status].label}
                  </button>
                ))}
              </div>

              {/* Description */}
              <div style={{ marginBottom: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</span>
                  {!editingDescription && (
                    <button className="btn btn-icon btn-ghost" onClick={() => { setEditDescValue(selectedIdea.description); setEditingDescription(true); }}>
                      <Pencil size={12} style={{ color: 'var(--text-muted)' }} />
                    </button>
                  )}
                </div>
                {editingDescription ? (
                  <div>
                    <textarea
                      className="input-field"
                      value={editDescValue}
                      onChange={(e) => setEditDescValue(e.target.value)}
                      rows={4}
                      autoFocus
                      style={{ resize: 'vertical', marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={saveDescription}>Save</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditingDescription(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 14, color: selectedIdea.description ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {selectedIdea.description || 'No description yet. Click the pencil to add one.'}
                  </p>
                )}
              </div>

              {/* Screenshots */}
              <div style={{ marginBottom: 'var(--space-lg)' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 8 }}>
                  Screenshots ({selectedIdea.screenshots.length}/5)
                </span>
                {selectedIdea.screenshots.length > 0 && (
                  <div className="idea-screenshot-gallery">
                    {selectedIdea.screenshots.map((url, i) => (
                      <div key={i} className="idea-screenshot-item" onClick={() => setLightboxImage(url)}>
                        <img src={url} alt={`Screenshot ${i + 1}`} />
                      </div>
                    ))}
                  </div>
                )}
                {selectedIdea.screenshots.length < 5 && (
                  <label className="dropzone" style={{ padding: 'var(--space-sm)', cursor: 'pointer', minHeight: 'auto', marginTop: 8 }}>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => handleAddScreenshot(e.target.files)}
                      disabled={uploadingScreenshot}
                    />
                    {uploadingScreenshot ? (
                      <div className="spinner" />
                    ) : (
                      <>
                        <Upload size={16} style={{ color: 'var(--text-muted)', marginRight: 8 }} />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Add screenshot</span>
                      </>
                    )}
                  </label>
                )}
              </div>

              {/* Linked recording */}
              {selectedIdea.linkedRecordingId && (
                <div style={{ marginBottom: 'var(--space-md)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Linked Recording</span>
                  <span style={{ fontSize: 14 }}>
                    {recordings.find((r) => r.id === selectedIdea.linkedRecordingId)?.title || 'Unknown recording'}
                  </span>
                </div>
              )}

              {/* Meta */}
              <div style={{ display: 'flex', gap: 'var(--space-lg)', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
                <span>By {selectedIdea.userName}</span>
                <span>Created {formatDate(selectedIdea.createdAt)}</span>
                {selectedIdea.updatedAt !== selectedIdea.createdAt && (
                  <span>Updated {formatDate(selectedIdea.updatedAt)}</span>
                )}
              </div>
            </div>

            {/* Footer with delete */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-md)', borderTop: '1px solid var(--border)' }}>
              {showDeleteConfirm ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--error)' }}>Delete this idea?</span>
                  <button className="btn btn-sm" style={{ borderColor: 'var(--error)', color: 'var(--error)' }} onClick={handleDelete}>Yes, delete</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                </div>
              ) : (
                <button className="btn btn-sm btn-ghost" style={{ color: 'var(--error)' }} onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== LIGHTBOX ===== */}
      {lightboxImage && (
        <div
          className="modal-overlay show"
          style={{ zIndex: 1001 }}
          onClick={() => setLightboxImage(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={lightboxImage}
              alt="Full size"
              style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 'var(--radius-lg)', objectFit: 'contain' }}
            />
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => setLightboxImage(null)}
              style={{ position: 'absolute', top: -40, right: 0, color: '#fff' }}
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

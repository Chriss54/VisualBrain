'use client';

import React, { useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getDb, getStorage } from '@/lib/firebase';
import { generateSmartTitle } from '@/lib/smart-titles';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { ref, uploadBytesResumable, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useDropzone } from 'react-dropzone';
import { Upload, FileVideo, CheckCircle, AlertCircle, X, Loader } from 'lucide-react';

interface UploadFile {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'processing' | 'ready' | 'error';
  progress: number;
  error?: string;
  docId?: string;
  thumbnailPreview?: string; // object URL for local preview
}

/** Extract first frame of a video file as a JPEG Blob using Canvas */
async function generateThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    video.onerror = () => { cleanup(); resolve(null); };

    video.onloadeddata = () => {
      // Seek to 0.1s instead of 0 — avoids black frames on some codecs
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        // 16:9 thumbnail at 640×360
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        if (!ctx) { cleanup(); resolve(null); return; }

        // Draw video frame to canvas with letterbox/pillarbox handling
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 360;
        const scale = Math.min(640 / vw, 360 / vh);
        const drawW = vw * scale;
        const drawH = vh * scale;
        const offsetX = (640 - drawW) / 2;
        const offsetY = (360 - drawH) / 2;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, 640, 360);
        ctx.drawImage(video, offsetX, offsetY, drawW, drawH);

        canvas.toBlob(
          (blob) => { cleanup(); resolve(blob); },
          'image/jpeg',
          0.82
        );
      } catch {
        cleanup();
        resolve(null);
      }
    };
  });
}

export default function UploadPage() {
  const { user } = useAuth();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [description, setDescription] = useState('');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: UploadFile[] = acceptedFiles.map((file) => ({
      file,
      id: Math.random().toString(36).slice(2),
      status: 'pending',
      progress: 0,
      thumbnailPreview: URL.createObjectURL(file),
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'] },
    maxSize: 500 * 1024 * 1024,
  });

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const f = prev.find((f) => f.id === id);
      if (f?.thumbnailPreview) URL.revokeObjectURL(f.thumbnailPreview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const setFileStatus = (id: string, patch: Partial<UploadFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const uploadFile = async (uploadFile: UploadFile) => {
    if (!user) return;

    setFileStatus(uploadFile.id, { status: 'uploading', progress: 5 });

    try {
      // 1. Generate thumbnail from first frame
      const thumbnailBlob = await generateThumbnail(uploadFile.file);

      // 2. Create Firestore record with smart title
      const now = new Date().toISOString();
      const title = generateSmartTitle(uploadFile.file.name, now, description);
      const recRef = await addDoc(collection(getDb(), 'recordings'), {
        userId: user.uid,
        fileName: uploadFile.file.name,
        title,
        fileSize: uploadFile.file.size,
        mimeType: uploadFile.file.type,
        description: description || '',
        status: 'uploading',
        ragieDocumentId: null,
        storageUrl: null,
        thumbnailUrl: null,
        createdAt: now,
        updatedAt: now,
      });

      setFileStatus(uploadFile.id, { docId: recRef.id, progress: 10 });

      // 3. Upload thumbnail to Firebase Storage (fast — small JPEG)
      let thumbnailUrl: string | null = null;
      if (thumbnailBlob) {
        const thumbRef = ref(
          getStorage(),
          `recordings/${user.uid}/${recRef.id}/thumbnail.jpg`
        );
        await uploadBytes(thumbRef, thumbnailBlob, { contentType: 'image/jpeg' });
        thumbnailUrl = await getDownloadURL(thumbRef);
        await updateDoc(doc(getDb(), 'recordings', recRef.id), { thumbnailUrl });
      }

      setFileStatus(uploadFile.id, { progress: 20 });

      // 4. Upload video to Firebase Storage (for playback)
      const videoRef = ref(
        getStorage(),
        `recordings/${user.uid}/${recRef.id}/${uploadFile.file.name}`
      );
      const uploadTask = uploadBytesResumable(videoRef, uploadFile.file);

      const storageUrl = await new Promise<string>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 40);
            setFileStatus(uploadFile.id, { progress: 20 + pct });
          },
          reject,
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          }
        );
      });

      await updateDoc(doc(getDb(), 'recordings', recRef.id), {
        storageUrl,
        updatedAt: new Date().toISOString(),
      });

      setFileStatus(uploadFile.id, { progress: 65 });

      // 5. Send to Ragie for AI indexing
      const formData = new FormData();
      formData.append('file', uploadFile.file);
      formData.append('recordingId', recRef.id);
      formData.append('userId', user.uid);
      formData.append('description', description || '');

      const response = await fetch('/api/recordings/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Ragie upload failed');
      }

      const data = await response.json();

      await updateDoc(doc(getDb(), 'recordings', recRef.id), {
        ragieDocumentId: data.ragieDocumentId,
        status: 'processing',
        updatedAt: new Date().toISOString(),
      });

      setFileStatus(uploadFile.id, { status: 'processing', progress: 100 });
      pollStatus(recRef.id, uploadFile.id, data.ragieDocumentId);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setFileStatus(uploadFile.id, { status: 'error', error: errorMessage });
    }
  };

  const pollStatus = async (recordingId: string, fileId: string, ragieDocId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/recordings/${recordingId}/status?ragieDocId=${ragieDocId}`);
        const data = await res.json();
        if (data.status === 'ready') {
          await updateDoc(doc(getDb(), 'recordings', recordingId), {
            status: 'ready',
            updatedAt: new Date().toISOString(),
          });
          setFileStatus(fileId, { status: 'ready' });
          return;
        }
        if (data.status === 'error') {
          setFileStatus(fileId, { status: 'error', error: 'Processing failed in Ragie' });
          return;
        }
        setTimeout(poll, 5000);
      } catch {
        setTimeout(poll, 10000);
      }
    };
    setTimeout(poll, 5000);
  };

  const uploadAll = () => {
    files.filter((f) => f.status === 'pending').forEach(uploadFile);
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusLabel = (f: UploadFile) => {
    if (f.status === 'uploading') return 'Uploading to Storage…';
    if (f.status === 'processing') return 'Processing with Ragie.ai…';
    if (f.status === 'ready') return 'Ready to query!';
    if (f.error) return f.error;
    return '';
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ready': return <CheckCircle size={18} style={{ color: 'var(--success)' }} />;
      case 'error': return <AlertCircle size={18} style={{ color: 'var(--error)' }} />;
      case 'uploading':
      case 'processing': return <Loader size={18} style={{ color: 'var(--warning)', animation: 'spin 1s linear infinite' }} />;
      default: return <FileVideo size={18} style={{ color: 'var(--text-muted)' }} />;
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Upload</h1>
        <p className="page-subtitle">Add Google Meet recordings to your knowledge base</p>
      </div>

      {/* Dropzone */}
      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <Upload size={48} />
        <h3>{isDragActive ? 'Drop your videos here' : 'Drag & drop video files here'}</h3>
        <p>or click to browse — MP4, WebM, MOV up to 500 MB</p>
      </div>

      {/* Description */}
      {files.length > 0 && (
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <div className="input-group">
            <label className="input-label" htmlFor="desc">Description (optional)</label>
            <input
              id="desc"
              className="input-field"
              type="text"
              placeholder="e.g., Sprint planning meeting — auth discussion"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* File List with thumbnail previews */}
      {files.length > 0 && (
        <div style={{ marginTop: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {files.map((f) => (
            <div key={f.id} className="upload-progress">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                {/* Thumbnail preview */}
                {f.thumbnailPreview ? (
                  <div style={{
                    width: 56,
                    height: 36,
                    borderRadius: 6,
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: '#111',
                    position: 'relative',
                  }}>
                    <video
                      src={f.thumbnailPreview}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      muted
                      preload="metadata"
                    />
                  </div>
                ) : (
                  statusIcon(f.status)
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.file.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {formatSize(f.file.size)}{statusLabel(f) ? ` — ${statusLabel(f)}` : ''}
                  </div>
                </div>

                <span className={`badge badge-${f.status}`}>{f.status}</span>
                {f.status === 'pending' && (
                  <button className="btn btn-icon btn-ghost" onClick={() => removeFile(f.id)}>
                    <X size={16} />
                  </button>
                )}
              </div>
              {(f.status === 'uploading' || f.status === 'processing') && (
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${f.progress}%` }} />
                </div>
              )}
            </div>
          ))}

          {pendingCount > 0 && (
            <div style={{ marginTop: 'var(--space-md)', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={uploadAll}>
                <Upload size={16} />
                Upload {pendingCount} {pendingCount === 1 ? 'Video' : 'Videos'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

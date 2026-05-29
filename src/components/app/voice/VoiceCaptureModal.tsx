'use client';

/**
 * VoiceCaptureModal — voice → pipeline pursuit (#119)
 *
 * 4-step flow:
 *   1. idle: show big mic button, "Hold to record"
 *   2. recording: stream waveform feedback, show "Tap to stop"
 *   3. processing: "Transcribing… → Extracting…"
 *   4. confirm: pre-filled card the user can edit + save
 *
 * MediaRecorder gotchas:
 * - Safari only supports audio/mp4; Chrome/Firefox prefer audio/webm.
 *   We probe `isTypeSupported()` and pick the first match.
 * - getUserMedia rejects without HTTPS or localhost — production is
 *   HTTPS via Vercel so this is fine, but the dev server needs
 *   localhost (not 127.0.0.1) to work.
 * - Max recording = 2 min; we auto-stop with a timer.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Square, X, Loader2, Check, MessageCircle, HelpCircle } from 'lucide-react';

interface VoiceCaptureModalProps {
  email: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;        // called after pursuit successfully posted to /api/pipeline
  onPivotToChat?: (seedMessage: string) => void;  // called when transcript is a question — parent should switch panel + seed the chat
}

type VoiceIntent = 'pursuit' | 'question' | 'unclear';

interface ExtractedPursuit {
  intent: VoiceIntent;
  title: string | null;
  agency: string | null;
  sub_agency: string | null;
  notice_type: string | null;
  set_aside: string | null;
  naics_code: string | null;
  psc_code: string | null;
  value_estimate: string | null;
  stage: 'tracking' | 'pursuing' | 'bidding' | 'submitted' | null;
  priority: 'low' | 'medium' | 'high' | null;
  notes: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  due_date: string | null;
  is_prime: boolean | null;
}

type Phase = 'idle' | 'recording' | 'transcribing' | 'extracting' | 'confirm' | 'pivot' | 'saving' | 'error';

const MAX_RECORDING_MS = 120_000;

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export default function VoiceCaptureModal({ email, isOpen, onClose, onSaved, onPivotToChat }: VoiceCaptureModalProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [extracted, setExtracted] = useState<ExtractedPursuit | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedNotes, setEditedNotes] = useState('');
  const [recordingMs, setRecordingMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up everything on close
  const cleanup = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      cleanup();
      setPhase('idle');
      setError(null);
      setTranscript('');
      setExtracted(null);
      setEditedTitle('');
      setEditedNotes('');
      setRecordingMs(0);
    }
  }, [isOpen, cleanup]);

  const startRecording = async () => {
    setError(null);
    chunksRef.current = [];
    const mimeType = pickMimeType();
    if (!mimeType) {
      setError("Your browser doesn't support audio recording. Try Chrome or Safari.");
      setPhase('error');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg = (err as Error).name === 'NotAllowedError'
        ? 'Microphone permission denied. Enable it in your browser settings.'
        : `Couldn't access mic: ${(err as Error).message}`;
      setError(msg);
      setPhase('error');
      return;
    }
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
      await processAudio(blob);
    };

    recorder.start();
    startTimeRef.current = Date.now();
    setPhase('recording');
    setRecordingMs(0);

    tickRef.current = setInterval(() => {
      setRecordingMs(Date.now() - startTimeRef.current);
    }, 100);
    autoStopRef.current = setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
    }, MAX_RECORDING_MS);
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  const processAudio = async (blob: Blob) => {
    setPhase('transcribing');
    try {
      const fd = new FormData();
      fd.append('email', email);
      fd.append('audio', blob, `capture.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);

      const tRes = await fetch('/api/app/voice/transcribe', {
        method: 'POST',
        body: fd,
      });
      const tData = await tRes.json();
      if (!tRes.ok) throw new Error(tData.error || `Transcription failed (${tRes.status})`);
      const text = String(tData.transcript || '').trim();
      if (!text) throw new Error("Couldn't hear anything — try again.");
      setTranscript(text);

      setPhase('extracting');
      const eRes = await fetch('/api/app/voice/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, transcript: text }),
      });
      const eData = await eRes.json();
      if (!eRes.ok) throw new Error(eData.error || `Extraction failed (${eRes.status})`);

      const ext = eData.extracted as ExtractedPursuit;
      setExtracted(ext);
      setEditedTitle(ext.title || '');
      setEditedNotes(ext.notes || '');
      // Branch by intent: pursuits go to the editable confirm card,
      // questions/unclear input go to the pivot view that offers
      // sending to Mindy Chat instead of saving a hollow row.
      if (ext.intent === 'question' || ext.intent === 'unclear') {
        setPhase('pivot');
      } else {
        setPhase('confirm');
      }
    } catch (err) {
      setError((err as Error).message || 'Something went wrong.');
      setPhase('error');
    }
  };

  const handlePivotToChat = () => {
    const seed = transcript.trim();
    if (!seed || !onPivotToChat) return;
    onPivotToChat(seed);
    onClose();
  };

  const handleSaveAnyway = () => {
    // User wants to save even though we classified as question/unclear.
    // Drop them into the regular confirm card so they can edit fields.
    setPhase('confirm');
  };

  const handleSave = async () => {
    if (!extracted || !editedTitle.trim()) return;
    setPhase('saving');
    setError(null);
    try {
      const payload = {
        user_email: email,
        title: editedTitle.trim(),
        agency: extracted.agency || undefined,
        sub_agency: extracted.sub_agency || undefined,
        notice_type: extracted.notice_type || undefined,
        set_aside: extracted.set_aside || undefined,
        naics_code: extracted.naics_code || undefined,
        psc_code: extracted.psc_code || undefined,
        value_estimate: extracted.value_estimate || undefined,
        stage: extracted.stage || 'tracking',
        priority: extracted.priority || 'medium',
        notes: editedNotes.trim() || undefined,
        contact_name: extracted.contact_name || undefined,
        contact_phone: extracted.contact_phone || undefined,
        contact_email: extracted.contact_email || undefined,
        due_date: extracted.due_date || undefined,
        is_prime: extracted.is_prime ?? true,
        source: 'voice_capture',
      };
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setPhase('confirm'); // back to confirm so user can retry
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-purple-900/20 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-purple-400" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold text-white">Add by voice</h2>
          </div>
          <button
            onClick={onClose}
            disabled={phase === 'recording' || phase === 'transcribing' || phase === 'extracting' || phase === 'saving'}
            className="text-slate-500 hover:text-white disabled:opacity-30"
            aria-label="Close"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 min-h-[280px]">
          {phase === 'idle' && (
            <div className="flex flex-col items-center justify-center text-center py-6">
              <button
                onClick={startRecording}
                className="w-24 h-24 rounded-full bg-purple-600 hover:bg-purple-500 transition-colors flex items-center justify-center mb-4 shadow-lg shadow-purple-900/40"
                aria-label="Start recording"
              >
                <Mic className="w-10 h-10 text-white" strokeWidth={1.5} />
              </button>
              <p className="text-sm text-slate-300 font-medium">Tap to start recording</p>
              <p className="text-xs text-slate-500 mt-1">Speak naturally about an opportunity — agency, contact, value, deadlines.</p>
              <p className="text-xs text-slate-600 mt-4">Mindy will transcribe + extract a pursuit for you to confirm.</p>
            </div>
          )}

          {phase === 'recording' && (
            <div className="flex flex-col items-center justify-center text-center py-6">
              <div className="relative mb-4">
                <button
                  onClick={stopRecording}
                  className="w-24 h-24 rounded-full bg-red-600 hover:bg-red-500 transition-colors flex items-center justify-center shadow-lg shadow-red-900/40 animate-pulse"
                  aria-label="Stop recording"
                >
                  <Square className="w-8 h-8 text-white fill-white" strokeWidth={0} />
                </button>
              </div>
              <p className="text-sm text-slate-200 font-medium">Recording…</p>
              <p className="text-3xl font-mono text-purple-300 mt-2 tabular-nums">
                {formatDuration(recordingMs)}
              </p>
              <p className="text-xs text-slate-500 mt-3">Tap the square to stop. Max 2:00.</p>
            </div>
          )}

          {(phase === 'transcribing' || phase === 'extracting') && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-purple-400 animate-spin mb-4" strokeWidth={1.5} />
              <p className="text-sm text-slate-300 font-medium">
                {phase === 'transcribing' ? 'Transcribing…' : 'Extracting opportunity…'}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                {phase === 'transcribing' ? 'Whisper is converting your audio.' : 'Mindy is structuring the details.'}
              </p>
            </div>
          )}

          {phase === 'confirm' && extracted && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Title</label>
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="Opportunity title"
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-md text-sm text-white placeholder-slate-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <CapturedField label="Agency" value={extracted.agency} />
                <CapturedField label="Sub-Agency" value={extracted.sub_agency} />
                <CapturedField label="Notice Type" value={extracted.notice_type} />
                <CapturedField label="Set-Aside" value={extracted.set_aside} />
                <CapturedField label="Value" value={extracted.value_estimate} />
                <CapturedField label="Due Date" value={extracted.due_date} />
                <CapturedField label="NAICS" value={extracted.naics_code} mono />
                <CapturedField label="PSC" value={extracted.psc_code} mono />
              </div>
              {(extracted.contact_name || extracted.contact_phone || extracted.contact_email) && (
                <div className="rounded-lg bg-slate-950/50 border border-slate-800 p-3">
                  <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">Contact</div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-slate-200">
                    {extracted.contact_name && <div>👤 {extracted.contact_name}</div>}
                    {extracted.contact_phone && <div>📞 {extracted.contact_phone}</div>}
                    {extracted.contact_email && <div className="col-span-2 break-all">✉️ {extracted.contact_email}</div>}
                  </div>
                </div>
              )}
              <div>
                <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Notes</label>
                <textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  placeholder="Anything else worth remembering"
                  rows={3}
                  className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-md text-sm text-white placeholder-slate-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none resize-none"
                />
              </div>
              {transcript && (
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-400">Transcript</summary>
                  <div className="mt-2 p-3 rounded bg-slate-950/60 border border-slate-800/60 text-slate-400 whitespace-pre-wrap font-mono">
                    {transcript}
                  </div>
                </details>
              )}
              {error && (
                <div className="text-xs text-red-300 bg-red-950/30 border border-red-900/50 rounded p-2">{error}</div>
              )}
            </div>
          )}

          {phase === 'pivot' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-purple-950/30 border border-purple-900/50 p-4">
                <HelpCircle className="w-5 h-5 text-purple-300 mt-0.5 shrink-0" strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-purple-100">
                    {extracted?.intent === 'question'
                      ? 'That sounded like a question, not a pursuit.'
                      : "I couldn't pick out an opportunity to track."}
                  </p>
                  <p className="text-xs text-purple-200/70 mt-1">
                    Want Mindy to answer it in chat instead?
                  </p>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1">What I heard</div>
                <div className="rounded-md bg-slate-950/60 border border-slate-800 p-3 text-sm text-slate-200 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {transcript}
                </div>
              </div>

              {extracted?.notes && (
                <div className="text-xs text-slate-500 italic">{extracted.notes}</div>
              )}
            </div>
          )}

          {phase === 'saving' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" strokeWidth={1.5} />
              <p className="text-sm text-slate-300">Saving to pipeline…</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <MicOff className="w-10 h-10 text-red-400 mb-3" strokeWidth={1.5} />
              <p className="text-sm text-red-300 max-w-sm">{error || 'Something went wrong.'}</p>
              <button
                onClick={() => { setError(null); setPhase('idle'); }}
                className="mt-4 px-4 py-2 text-xs rounded bg-slate-800 hover:bg-slate-700 text-white"
              >
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Footer actions — pivot phase */}
        {phase === 'pivot' && (
          <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
            <button
              onClick={() => { setPhase('idle'); setExtracted(null); setTranscript(''); }}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              ← Re-record
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveAnyway}
                className="px-3 py-2 text-xs rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Save anyway
              </button>
              <button
                onClick={handlePivotToChat}
                disabled={!onPivotToChat || !transcript.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium"
              >
                <MessageCircle className="w-4 h-4" strokeWidth={2} />
                Send to Mindy Chat
              </button>
            </div>
          </div>
        )}

        {/* Footer actions — only on confirm */}
        {phase === 'confirm' && (
          <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
            <button
              onClick={() => { setPhase('idle'); setExtracted(null); setTranscript(''); }}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              ← Re-record
            </button>
            <button
              onClick={handleSave}
              disabled={!editedTitle.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium"
            >
              <Check className="w-4 h-4" strokeWidth={2} />
              Add to pipeline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CapturedField({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-950/50 border border-slate-800 p-2.5">
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-sm mt-0.5 ${value ? 'text-slate-200' : 'text-slate-600'} ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SparklesIcon, UploadIcon, Wand2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentMap } from '@/lib/agentMapContext';
import { API_BASE_URL, buildFileUrl } from '@/lib/api';

interface AgentDialogProps {
  className?: string;
  onRunCompleted?: (sessionId: string) => void;
}

const AgentDialog: React.FC<AgentDialogProps> = ({ className, onRunCompleted }) => {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  const {
    setSpecfilename,
    setManifest,
    setGeojson,
    setVisualStructure,
    appendAgentEvent,
    clearAgentEvents,
    setActiveRunId,
    setIsAgentRunning,
  } = useAgentMap();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeEventSource = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  };

  useEffect(() => closeEventSource, []);

  const clearImage = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      clearImage();
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE_URL}/api/upload-image`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error('Upload API response error');

      const data = await res.json();
      setSelectedImage(data.filepath);
      setImagePreview(buildFileUrl(data.filepath));
    } catch (err) {
      console.error("Image upload failed:", err);
      alert('Image upload failed, please try again');
      clearImage();
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedImage) return alert('Please upload a reference image first');
    if (!message.trim()) return alert('Please enter a travel requirement description');
    
    setLoading(true);
    setProgress('Starting agent run...');
    clearAgentEvents();
    setActiveRunId(null);
    setIsAgentRunning(true);
    closeEventSource();
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/multimodal/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          imageFilename: selectedImage,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '请求失败');
      }

      const data = await response.json();
      const runId = data.run_id;
      setActiveRunId(runId);
      setProgress('Agents are running...');

      await new Promise<void>((resolve, reject) => {
        const source = new EventSource(`${API_BASE_URL}/api/multimodal/runs/${runId}/events`);
        eventSourceRef.current = source;
        let settled = false;

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          closeEventSource();
          fn();
        };

        const handleEvent = (event: MessageEvent) => {
          const parsed = JSON.parse(event.data);
          appendAgentEvent(parsed);

          if (parsed.type === 'node_started') {
            setProgress(`${parsed.label || parsed.node_id} running...`);
          }
          if (parsed.type === 'node_completed') {
            setProgress(`${parsed.label || parsed.node_id} completed`);
            const payload = parsed.payload || {};
            if (parsed.node_id === 'visual' && payload.visual_structure) {
              setVisualStructure(payload.visual_structure);
            }
            if (parsed.node_id === 'geojson' && payload.geojson) {
              setGeojson(payload.geojson);
            }
            if (parsed.node_id === 'style' && payload.style_code) {
              setManifest(payload.style_code);
            }
            if (parsed.node_id === 'icon_generation' && payload.style_code) {
              setManifest(payload.style_code);
            }
          }
          if (parsed.type === 'workflow_completed') {
            const result = parsed.payload || {};
            const completedSessionId = result.session_id || runId;
            setGeojson(result.geojson || null);
            setManifest(result.style_code || null);
            setVisualStructure(result.visual_structure || null);
            setSpecfilename(completedSessionId);
            onRunCompleted?.(completedSessionId);
            setProgress('Processing completed!');
            finish(resolve);
          }
          if (parsed.type === 'workflow_error') {
            finish(() => reject(new Error(parsed.payload?.error || 'Agent workflow failed')));
          }
        };

        [
          'workflow_started',
          'node_started',
          'node_completed',
          'node_validation',
          'node_retry',
          'artifact_saved',
          'workflow_completed',
          'workflow_error',
        ].forEach((eventName) => source.addEventListener(eventName, handleEvent));

        source.onerror = () => {
          finish(() => reject(new Error('Agent event stream disconnected')));
        };
      });

    } catch (error: any) {
      console.error('Agent error:', error);
      alert(error.message || 'Analysis failed, please check network or try again');
      setProgress('');
    } finally {
      setLoading(false);
      setIsAgentRunning(false);
      setTimeout(() => setProgress(''), 3000);
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* <Separator/> */}
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Upload Reference Image</h3> 
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleImageSelect}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="flex-1"
          disabled={loading}
        >
          <UploadIcon className="w-4 h-4 mr-2" />
          {selectedImage ? selectedImage.slice(-10) : 'Select reference image'}
        </Button>
        
        <Button 
          onClick={handleSubmit} 
          disabled={loading || !selectedImage || !message.trim()}
          className="bg-gray-800 hover:bg-gray-700 text-white transition-colors"
          size="sm"
        >
          {loading ? (
            <Wand2Icon className="w-4 h-4 animate-pulse" />
          ) : (
            <SparklesIcon className="w-4 h-4" />
          )}
        </Button>
      </div>

      {imagePreview && (
        <div 
          className="relative rounded-md overflow-hidden border cursor-pointer hover:opacity-90 transition-opacity bg-gray-50"
          onClick={() => setImageModalOpen(true)}
        >
          <img 
            src={imagePreview} 
            alt="Reference Image Preview" 
            className="h-32 w-auto mx-auto object-cover"
          />
          <button
            onClick={clearImage}
            className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-black/80 transition-colors"
            title="Remove image"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {imageModalOpen && imagePreview && (
        <div 
          className="bg-black/80 z-50 flex items-center justify-center p-2 backdrop-blur-sm"
          onClick={() => setImageModalOpen(false)}
        >
          <div className="relative max-w-full max-h-full">
            <img 
              src={imagePreview} 
              alt="Reference Image" 
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setImageModalOpen(false);
              }}
              className="absolute -top-12 right-0 bg-white/20 hover:bg-white/40 text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors"
            >
              <XIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
      
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Enter your travel requirements, e.g. I want to go to Beijing for 3 days, budget 5000 yuan..."
        className="w-full min-h-[60px] p-2 text-[11px] border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-gray-800/50"
        disabled={loading}
      />
      
      {progress && (
        <div className="rounded-md bg-[#F2F2F2] p-2 text-sm text-[#131722] animate-in fade-in slide-in-from-top-1">
          {progress}
        </div>
      )}
    </div>
  );
};

export default AgentDialog;

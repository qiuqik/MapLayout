'use client';

import React, { useRef, useState } from 'react';
import { SparklesIcon, UploadIcon, Wand2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentMap } from '@/lib/agentMapContext';
import { API_BASE_URL, buildFileUrl } from '@/lib/api';
import { Separator } from '@/components/ui/separator';

interface AgentDialogProps {
  className?: string;
}

const AgentDialog: React.FC<AgentDialogProps> = ({ className }) => {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  const { setSpecfilename, setManifest, setGeojson } = useAgentMap();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setProgress('Generating route and map data...'); // 单一真实的 Loading 状态
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/multimodal/agent`, {
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
      
      // 并行拉取地图数据，减少实际等待时间
      const fetchPromises = [];

      if (data.geofilepath) {
        const geoPromise = fetch(buildFileUrl(data.geofilepath))
          .then(res => res.json())
          .then(setGeojson);
        fetchPromises.push(geoPromise);
      }
      
      if (data.specfilepath) {
        const specPromise = fetch(buildFileUrl(data.specfilepath))
          .then(res => res.json())
          .then(specData => {
            setManifest(specData);
            setSpecfilename(data.specfilepath);
          });
        fetchPromises.push(specPromise);
      }

      await Promise.all(fetchPromises);
      setProgress('Processing completed!');

    } catch (error: any) {
      console.error('Agent error:', error);
      alert(error.message || 'Analysis failed, please check network or try again');
      setProgress('');
    } finally {
      setLoading(false);
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
        <div className="text-sm text-blue-700 bg-blue-50 p-2 rounded-md animate-in fade-in slide-in-from-top-1">
          {progress}
        </div>
      )}
    </div>
  );
};

export default AgentDialog;
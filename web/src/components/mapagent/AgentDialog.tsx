'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button"
import { UploadIcon, Wand2Icon, SparklesIcon } from "lucide-react"
import { useAgentMap } from '@/lib/agentMapContext';

interface AgentDialogProps {
  className?: string;
}

const AgentDialog: React.FC<AgentDialogProps> = ({ className }) => {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const { setSpecfilename, setManifest, setGeojson } = useAgentMap();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  useEffect(() => {
  }, []);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch("http://localhost:8000/api/upload-image", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      const imageName = data.filepath;
      setSelectedImage(imageName);
      
      const previewUrl = `http://localhost:8000/files/${imageName}`;
      setImagePreview(previewUrl);
    } catch (err) {
      console.error("图片上传失败:", err);
      alert('图片上传失败');
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSubmit = async () => {
    if (!selectedImage) return;
    
    if (!message.trim()) {
      alert('请输入旅行需求描述');
      return;
    }
    
    setLoading(true);
    
    const apiEndpoint = 'http://localhost:8000/api/multimodal/agent';
    
    setProgress('正在启动多模态地图生成 Agent...');
    
    try {
      const response = await fetch(apiEndpoint, {
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
      
      setProgress('正在分析用户意图...');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setProgress('正在提取视觉特征...');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setProgress('正在生成 GeoJSON 数据...');
      
      if (data.geofilepath) {
        const geoRes = await fetch(`http://localhost:8000/files/${encodeURIComponent(data.geofilepath)}`);
        const geoData = await geoRes.json();
        setGeojson(geoData);
      }
      
      setProgress('正在生成 Mapbox 样式...');
      
      if (data.specfilepath) {
        const specRes = await fetch(`http://localhost:8000/files/${encodeURIComponent(data.specfilepath)}`);
        const specData = await specRes.json();
        setManifest(specData);
        setSpecfilename(data.specfilepath);
      }
      
      setProgress('完成！');

    } catch (error: any) {
      console.error('Agent 错误:', error);
      alert(error.message || '分析失败，请重试');
      setProgress('');
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(''), 3000);
    }
  };

  const resetForm = () => {
    setMessage('');
    setSelectedImage(null);
    setImagePreview(null);
    setProgress('');
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
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
          {selectedImage ? selectedImage : 'Select Reference Image'}
        </Button>
        
        <Button 
          onClick={handleSubmit} 
          disabled={loading || !selectedImage || !message.trim()}
          className="bg-gray-800 hover:bg-gray-700 text-white"
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
          className="relative rounded-md overflow-hidden border cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => setImageModalOpen(true)}
        >
          <img 
            src={imagePreview} 
            alt="Reference Image Preview" 
            className="h-32 w-auto mx-auto"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedImage(null);
              setImagePreview(null);
            }}
            className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm hover:bg-black/70"
          >
            ×
          </button>
        </div>
      )}
      
      {imageModalOpen && imagePreview && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setImageModalOpen(false)}
        >
          <img 
            src={imagePreview} 
            alt="Reference Image" 
            className="max-w-full max-h-full object-contain"
          />
          <button
            onClick={() => setImageModalOpen(false)}
            className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 text-white rounded-full w-10 h-10 flex items-center justify-center text-2xl"
          >
            ×
          </button>
        </div>
      )}
      
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Please enter your travel requirements, e.g., I want to travel to Beijing for 3 days with a budget of 5000 yuan..."
        className="w-full min-h-[80px] p-2 text-sm border rounded-md resize-none"
        disabled={loading}
      />
      
      {progress && (
        <div className="text-sm text-blue-600 bg-blue-50 p-2 rounded-md">
          {progress}
        </div>
      )}
    </div>
  );
};

export default AgentDialog;

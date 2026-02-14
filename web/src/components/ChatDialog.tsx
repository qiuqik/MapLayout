"use client";

import React, { useEffect, useState, useContext } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowUpIcon, X } from "lucide-react"
import { MapDataContext } from '@/lib/mapContext'
import { IconCheck, IconInfoCircle, IconPlus } from "@tabler/icons-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"


interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
}

const ChatDialog = () => {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { 
    imagename,
    setGeofilename, 
    setImagename,
    setStylename
  } = useContext(MapDataContext);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 提交 input 和 image
  const handleSend = async () => {
    if (!input.trim() || loading || !imagename) return;

    // 用户消息
    const userMsg = input.trim();
    
    setInput("");
    setLoading(true);

    // 调用 Agent
    try {
      const res = await fetch("http://localhost:8000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: userMsg,
          imageFilename: imagename
         }),
      });
      const data = await res.json();
      setGeofilename(data.geofilepath);
      setStylename(data.stylefilepath);
    } catch (err) {
      console.error("发送失败:", err);
    } finally {
      setLoading(false);
    }
  };

  // 发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) handleSend();
  };
  
  
  // 处理图片上传
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch("http://localhost:8000/api/upload-image", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      const imageName = data.filepath;
      setImagename(imageName);
    } catch (err) {
      console.error("图片上传失败:", err);
      alert('图片上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 触发文件选择器
  const handleUploadButtonClick = () => {
    fileInputRef.current?.click();
  };

  // 删除图片
  const handleDeleteImage = () => {
    setImagename(null);
  };

  return (
    <div className="z-20 w-[100%]">
        <InputGroup className='shadow-md'>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <InputGroupTextarea 
          placeholder="Input..." 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          />
          <InputGroupAddon align="block-end">
            <div className="flex items-center gap-2">
              <InputGroupButton
                variant="outline"
                size="icon-sm"
                onClick={handleUploadButtonClick}
                disabled={uploading || !!imagename}
              >
                {uploading ? (
                  <img 
                    src="/loading.svg"
                    className="w-4 h-4 animate-spin"
                  />
                ) : (
                  <img 
                    src="/imageUpload.svg"
                    className="w-5 h-5"
                  />
                )}
              </InputGroupButton>
              {imagename && (
                <div className="relative w-6 h-6 group">
                  <img
                    src={imagename ? `http://localhost:8000/files/${encodeURIComponent(imagename)}` : ''}
                    alt="reference"
                    className="w-6 h-6 rounded border border-gray-300"
                  />
                  <button
                    onClick={handleDeleteImage}
                    className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-0 w-3 h-3 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除图片"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>
            <InputGroupButton
              onClick={handleSend} 
              variant="outline"
              className="ml-auto rounded-full"
              size="icon-sm"
              aria-label="Submit"
              disabled={loading}
            >
              {loading? 
                <img 
                  src="/loading.svg"
                  className="w-4 h-4 animate-spin"
                />
                : <ArrowUpIcon />} 
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
    </div>
  );
};

export default ChatDialog;
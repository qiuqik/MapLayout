"use client";

import React, { useEffect, useState, useContext } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowUpIcon } from "lucide-react"
import { MapDataContext } from '@/lib/mapContext'


interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
}

const ChatDialog = () => {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const { setGeojson, setGeofilename } = useContext(MapDataContext);


  const handleSend = async () => {
    if (!input.trim() || loading) return;

    // 用户消息
    const userMsg: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      role: "user",
    };
    
    setInput("");
    setLoading(true);
    console.log("enter")
    try {
      // 后端接口
      const res = await fetch("http://localhost:8000/api/travelagent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content }),
      });

      const data = await res.json();

      setGeofilename(data.filepath);

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

  return (
    <div className="
    absolute top-[8%] left-1/2 -translate-x-1/2 z-20 
    p-1
    w-[40%]  flex flex-wrap items-center gap-1
    ">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="input..."
          disabled={loading}
          className="flex-1 bg-white shadow-md"
        />
        <Button 
        onClick={handleSend} 
        variant="outline" 
        size="icon-lg"
        disabled={loading}
        aria-label="Submit"
        className="shadow-md"
        >
         {loading? 
          <img 
            src="/loading.svg"
            className="w-4 h-4 animate-spin"
          />
          : <ArrowUpIcon />} 
        </Button>
    </div>
  );
};

export default ChatDialog;
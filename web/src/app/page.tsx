'use client';
import Header from "@/components/Header"
// import CoreMap from "@/components/CoreMap"
import LeftCard from "@/components/leftCard"
import RightCard from "@/components/rightCard";
import { MapProvider } from '@/lib/mapContext'
// import ChatDialog from '@/components/ChatDialog';
import dynamic from 'next/dynamic';

const CoreMap = dynamic(() => import('@/components/CoreMap'), { 
  ssr: false,
  loading: () => <div className="w-full h-full bg-gray-100 animate-pulse" /> // 可选：加载时的占位图
});

export default function Page() {
  return (
      <MapProvider>
        <div className="flex flex-col w-screen h-screen overflow-hidden">
          <Header />
          <div className="flex flex-1 overflow-hidden">
            <LeftCard />
            <CoreMap />
            {/* <RightCard /> */}
          </div>
        </div>
      </MapProvider>
  )
}